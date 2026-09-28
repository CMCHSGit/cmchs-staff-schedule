/**
 * api/sync-excel.js — Vercel Serverless Function
 *
 * Fired (fire-and-forget) by the app right after a schedule saves — My week,
 * a Team week edit, or an admin's "Copy last week" (several people at once). Mirrors that save into the company's existing Excel
 * schedule via Microsoft Graph — one-way (app → Excel) only; see
 * atomic-baking-noodle.md / TODO.md for why. Never the source of truth,
 * so every expected non-error case (no sheet for that week yet, no
 * excelName configured) returns 200 with a `skipped` reason, not a 4xx/5xx.
 *
 * Required env vars (set in Vercel project settings):
 *   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY  (already set for api/remind.js)
 *   VITE_AZURE_TENANT_ID     (already set — reused as-is)
 *   AZURE_CLIENT_ID          same Azure app registration used for Microsoft sign-in
 *   AZURE_CLIENT_SECRET      a NEW secret on that same app registration, scoped to
 *                            this server-only use (kept separate from whatever
 *                            secret Firebase Auth's own OAuth exchange uses)
 *   SHAREPOINT_SITE_ID       e.g. "cassmedical.sharepoint.com,<site-guid>,<web-guid>"
 *                            — resolve via Graph Explorer:
 *                            GET https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{site-path}
 *   EXCEL_ITEM_ID            the file's own permanent item ID (not a path) — found in its
 *                            SharePoint share link's `sourcedoc={...}` parameter (strip the
 *                            curly braces). Survives the file being renamed or moved to a
 *                            different folder within the same site, unlike a path lookup.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth }                       from 'firebase-admin/auth'
import { getFirestore }                  from 'firebase-admin/firestore'

function initFirebase() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    })
  }
}

const GRAPH = 'https://graph.microsoft.com/v1.0'
const DRIVE_ROOT = `${GRAPH}/sites/${process.env.SHAREPOINT_SITE_ID}/drive/items/${process.env.EXCEL_ITEM_ID}`

async function getGraphToken() {
  const tenant = process.env.VITE_AZURE_TENANT_ID
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     process.env.AZURE_CLIENT_ID,
      client_secret: process.env.AZURE_CLIENT_SECRET,
      scope:         'https://graph.microsoft.com/.default',
    }),
  })
  if (!res.ok) throw new Error(`Graph auth failed: ${await res.text()}`)
  const { access_token } = await res.json()
  return access_token
}

async function graphGet(token, path) {
  const res = await fetch(`${DRIVE_ROOT}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Graph GET ${path} failed: ${await res.text()}`)
  return res.json()
}

async function graphPatch(token, path, body) {
  const res = await fetch(`${DRIVE_ROOT}${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Graph PATCH ${path} failed: ${await res.text()}`)
  return res.json()
}

function toISODate(graphDateValue) {
  // Graph returns Excel dates as serial numbers when read via range values,
  // but date-formatted cells come back as ISO strings through this API —
  // normalize either way to a plain YYYY-MM-DD for comparison.
  const d = new Date(graphDateValue)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/** Finds the worksheet whose row-1 D1 date matches weekStart, searching most-recent-first. */
async function findWeekSheet(token, weekStart) {
  const { value: sheets } = await graphGet(token, '/workbook/worksheets?$select=name')
  for (let i = sheets.length - 1; i >= 0; i--) {
    const name = sheets[i].name
    if (name === "Template (don't use)") continue
    try {
      const cell = await graphGet(token, `/workbook/worksheets('${encodeURIComponent(name)}')/range(address='D1')`)
      if (toISODate(cell.values?.[0]?.[0]) === weekStart) return name
    } catch {
      // Unreadable/unexpected sheet shape — skip it, keep searching.
    }
  }
  return null
}

/**
 * Column B of a week's sheet as a list of normalised names, so row lookups
 * need only one read. The weekly on-call engineer's cell carries a suffix
 * ("Sam - OnCall") and some have stray spaces — both stripped, otherwise
 * that person's row would never match on their on-call week.
 */
async function readNameColumn(token, sheetName) {
  const col = await graphGet(token, `/workbook/worksheets('${encodeURIComponent(sheetName)}')/range(address='B1:B120')`)
  return (col.values || []).map(r => normaliseName(r[0]))
}

function normaliseName(value) {
  return (value || '').toString().replace(/\s*-\s*on\s*call\s*$/i, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    initFirebase()

    const authHeader = req.headers['authorization'] || ''
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!idToken) return res.status(401).json({ error: 'Missing auth token' })

    const decoded = await getAuth().verifyIdToken(idToken)
    const uid = decoded.uid

    // { weekStart, entries: [{ uid, cells: [5 texts], comments }] }. The older
    // { weekStart, days, comments } shape (the caller's own week) still works,
    // for app copies cached from before the change.
    const body = req.body || {}
    const { weekStart } = body
    const entries = Array.isArray(body.entries)
      ? body.entries
      : [{ uid, cells: (body.days || []).map(d => d?.location || ''), comments: body.comments }]
    if (!weekStart || !entries.length || entries.some(e => !Array.isArray(e.cells) || e.cells.length !== 5)) {
      return res.status(400).json({ error: 'weekStart and entries with 5 cells each are required' })
    }

    const db = getFirestore()
    const targets = entries.map(e => ({ ...e, uid: e.uid || uid }))
    if (targets.some(e => e.uid !== uid)) {
      const caller = await db.collection('users').doc(uid).get()
      if (caller.data()?.role !== 'admin') return res.status(403).json({ error: 'Only admins can sync other people' })
    }

    const userSnaps = await db.getAll(...targets.map(e => db.collection('users').doc(e.uid)))
    const excelNames = new Map(userSnaps.map(s => [s.id, s.data()?.excelName]))
    const configured = targets.filter(e => excelNames.get(e.uid))
    if (!configured.length) {
      return res.status(200).json({ skipped: 'no excelName configured for these people' })
    }

    const token = await getGraphToken()

    const sheetName = await findWeekSheet(token, weekStart)
    if (!sheetName) {
      return res.status(200).json({ skipped: `no Excel sheet exists yet for week ${weekStart}` })
    }

    const names = await readNameColumn(token, sheetName)
    const results = []
    for (const e of configured) {
      const excelName = excelNames.get(e.uid)
      const index = names.indexOf(normaliseName(excelName))
      if (index < 0) { results.push({ uid: e.uid, skipped: `"${excelName}" not found in sheet "${sheetName}"` }); continue }
      const row = index + 1
      const values = [[...e.cells.map(c => (c || '').toString()), (e.comments || '').toString()]]
      await graphPatch(token, `/workbook/worksheets('${encodeURIComponent(sheetName)}')/range(address='D${row}:I${row}')`, { values })
      results.push({ uid: e.uid, synced: true, row })
    }

    return res.status(200).json({ sheet: sheetName, results })
  } catch (err) {
    console.error('Excel sync failed:', err)
    // Best-effort mirror — a failure here should never look like the
    // schedule itself failed to save, so this is logged, not surfaced.
    return res.status(200).json({ skipped: 'sync failed', detail: err.message })
  }
}
