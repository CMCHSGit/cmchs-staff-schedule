/**
 * scripts/sync-excel.mjs — run by .github/workflows/excel-sync.yml every 15
 * minutes. Copies every schedule saved (or edited) since the last run into
 * the company's existing Excel schedule via Microsoft Graph — one-way, app →
 * Excel; see TODO.md for why. Never the source of truth: a week with no sheet
 * yet, or a person with no excelName, is simply skipped.
 *
 * Where it got to is kept in Firestore (meta/excelSync.lastRun), so a failed
 * or skipped run just catches up next time.
 *
 * Env (GitHub Actions secrets): FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
 * FIREBASE_PRIVATE_KEY, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET,
 * SHAREPOINT_SITE_ID (e.g. "cassmedical.sharepoint.com,<site-guid>,<web-guid>"),
 * EXCEL_ITEM_ID (the file's own item ID, from its share link's sourcedoc={...}).
 * The repo is public and so are its Action logs — only ever log counts.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp }      from 'firebase-admin/firestore'
import { excelCellText }                from '../src/utils/status.js'
import { holidayOn }                    from '../src/utils/holidays.js'
import { weekDates, normalizeSchedule } from '../src/utils/week.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const DRIVE_ROOT = `${GRAPH}/sites/${process.env.SHAREPOINT_SITE_ID}/drive/items/${process.env.EXCEL_ITEM_ID}`
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000

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

async function getGraphToken() {
  const res = await fetch(`https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     process.env.AZURE_CLIENT_ID,
      client_secret: process.env.AZURE_CLIENT_SECRET,
      scope:         'https://graph.microsoft.com/.default',
    }),
  })
  if (!res.ok) throw new Error(`Graph auth failed (${res.status})`)
  return (await res.json()).access_token
}

async function graphGet(token, path) {
  const res = await fetch(`${DRIVE_ROOT}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Graph GET failed (${res.status})`)
  return res.json()
}

async function graphPatch(token, path, body) {
  const res = await fetch(`${DRIVE_ROOT}${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Graph PATCH failed (${res.status})`)
  return res.json()
}

const sheetPath = name => `/workbook/worksheets('${encodeURIComponent(name)}')`

function toISODate(graphDateValue) {
  // Date cells can come back as ISO strings or Excel serial numbers.
  if (typeof graphDateValue === 'number') {
    return new Date(Date.UTC(1899, 11, 30) + graphDateValue * 864e5).toISOString().slice(0, 10)
  }
  const d = new Date(graphDateValue)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/**
 * Sheet names are inconsistent ("08-APR-24", "2-Sep-24"…), so weeks are
 * matched by the real date in D1 instead, newest sheets first.
 */
async function findWeekSheet(token, weekStart) {
  const { value: sheets } = await graphGet(token, '/workbook/worksheets?$select=name')
  for (let i = sheets.length - 1; i >= 0; i--) {
    const name = sheets[i].name
    if (/template/i.test(name)) continue
    try {
      const cell = await graphGet(token, `${sheetPath(name)}/range(address='D1')`)
      if (toISODate(cell.values?.[0]?.[0]) === weekStart) return name
    } catch {
      // Unreadable/unexpected sheet shape — skip it, keep searching.
    }
  }
  return null
}

/**
 * Column B as normalised names. The on-call engineer's cell carries a suffix
 * ("Sam - OnCall") and some have stray spaces — both stripped, otherwise that
 * person's row would never match on their on-call week.
 */
function normaliseName(value) {
  return (value || '').toString().replace(/\s*-\s*on\s*call\s*$/i, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

async function readNameColumn(token, sheetName) {
  const col = await graphGet(token, `${sheetPath(sheetName)}/range(address='B1:B120')`)
  return (col.values || []).map(r => normaliseName(r[0]))
}

async function main() {
  initFirebase()
  const db = getFirestore()
  const stateRef = db.collection('meta').doc('excelSync')
  const runStart = Timestamp.now()
  const since = (await stateRef.get()).data()?.lastRun || Timestamp.fromMillis(Date.now() - FIRST_RUN_LOOKBACK_MS)

  const changed = await db.collection('schedules').where('submittedAt', '>', since).get()
  if (changed.empty) {
    await stateRef.set({ lastRun: runStart })
    console.log('Excel sync: nothing new.')
    return
  }

  const users = new Map((await db.collection('users').get()).docs.map(d => [d.id, d.data()]))
  const byWeek = new Map()
  for (const d of changed.docs) {
    const s = d.data()
    const excelName = users.get(s.uid)?.excelName
    if (!excelName) continue
    if (!byWeek.has(s.weekStart)) byWeek.set(s.weekStart, [])
    byWeek.get(s.weekStart).push({ excelName, schedule: s })
  }

  let written = 0, noRow = 0, noSheet = 0
  if (byWeek.size) {
    const token = await getGraphToken()
    for (const [weekStart, entries] of byWeek) {
      const sheetName = await findWeekSheet(token, weekStart)
      if (!sheetName) { noSheet += entries.length; continue }
      const names = await readNameColumn(token, sheetName)
      const dates = weekDates(weekStart)
      for (const { excelName, schedule } of entries) {
        const index = names.indexOf(normaliseName(excelName))
        if (index < 0) { noRow++; continue }
        const row = index + 1
        const cells = normalizeSchedule(schedule.days).map((day, i) => excelCellText(day, holidayOn(dates[i])))
        await graphPatch(token, `${sheetPath(sheetName)}/range(address='D${row}:I${row}')`, { values: [[...cells, schedule.comments || '']] })
        written++
      }
    }
  }

  await stateRef.set({ lastRun: runStart })
  console.log(`Excel sync: ${changed.size} changed, ${written} rows written, ${noSheet} with no sheet for their week yet, ${noRow} not found in their sheet.`)
}

main().catch(err => {
  console.error('Excel sync failed:', err.message)
  process.exit(1)
})
