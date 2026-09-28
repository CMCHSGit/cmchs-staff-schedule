/**
 * api/sync-excel.js — Vercel Serverless Function
 *
 * Fired (fire-and-forget) from MySchedule.jsx right after a schedule saves
 * successfully. Mirrors that save into the company's existing Excel
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
 *   EXCEL_FILE_PATH          path to the .xlsx within that site's default document
 *                            library, e.g. "CMCHS Files/Admin/Cass Admin/Staff Schedule/CMCHS Staff Schedule 2024.xlsx"
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
const DRIVE_ROOT = `${GRAPH}/sites/${process.env.SHAREPOINT_SITE_ID}/drive/root:/${encodeURI(process.env.EXCEL_FILE_PATH || '')}:`

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

/** Finds the row number (1-indexed) whose column B matches excelName, or null. */
async function findPersonRow(token, sheetName, excelName) {
  const target = excelName.trim().toLowerCase()
  const col = await graphGet(token, `/workbook/worksheets('${encodeURIComponent(sheetName)}')/range(address='B1:B120')`)
  const rows = col.values || []
  for (let i = 0; i < rows.length; i++) {
    const cell = (rows[i][0] || '').toString().trim().toLowerCase()
    if (cell === target) return i + 1
  }
  return null
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

    const { weekStart, days, comments } = req.body || {}
    if (!weekStart || !Array.isArray(days) || days.length !== 5) {
      return res.status(400).json({ error: 'weekStart and 5 days are required' })
    }

    const userSnap = await getFirestore().collection('users').doc(uid).get()
    const excelName = userSnap.data()?.excelName
    if (!excelName) {
      return res.status(200).json({ skipped: 'no excelName configured for this user' })
    }

    const token = await getGraphToken()

    const sheetName = await findWeekSheet(token, weekStart)
    if (!sheetName) {
      return res.status(200).json({ skipped: `no Excel sheet exists yet for week ${weekStart}` })
    }

    const row = await findPersonRow(token, sheetName, excelName)
    if (!row) {
      return res.status(200).json({ skipped: `"${excelName}" not found in sheet "${sheetName}"` })
    }

    const values = [[...days.map(d => d.location || ''), comments || '']]
    await graphPatch(token, `/workbook/worksheets('${encodeURIComponent(sheetName)}')/range(address='D${row}:I${row}')`, { values })

    return res.status(200).json({ synced: true, sheet: sheetName, row })
  } catch (err) {
    console.error('Excel sync failed:', err)
    // Best-effort mirror — a failure here should never look like the
    // schedule itself failed to save, so this is logged, not surfaced.
    return res.status(200).json({ skipped: 'sync failed', detail: err.message })
  }
}
