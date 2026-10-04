/**
 * Reads the company's weekly Excel schedule — one sheet per week, a person
 * per pair of AM/PM rows, Monday–Friday across, the week's comment at the end.
 *
 * Plain functions over an ExcelJS workbook: no Firebase, no DOM. That's
 * deliberate — the same reader runs in the browser (Admin → Excel) and can
 * run in a Node script for an automatic link later.
 *
 * Two layouts exist in the file. Every sheet since late July 2025 has a team
 * label column in front (team | name | AM/PM | Mon … Fri | comments); the 22
 * sheets before it don't (name | AM/PM | Mon … Fri | comments). The AM/PM
 * label column is the anchor for both, so nothing here assumes a position.
 * Sheet names are inconsistent ("07-Sept", "14-April-25", "16-Jun 25"), so a
 * week is identified by the Monday date in the sheet's header row instead.
 */

const MAX_HEADER_SCAN_ROWS = 30

/** Collapses runs of whitespace (including non-breaking spaces) and trims. */
export const squash = value => String(value ?? '').replace(/[\s ]+/g, ' ').trim()

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A date someone typed into a text cell (Excel turns "3/10" into one) — shown as "3 Oct 2025" rather than lost. */
const dateLabel = d => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`

/** The plain text of a cell, whatever Excel stored it as (text, number, formula, rich text, link). */
export function cellText(cell) {
  const v = cell?.value
  if (v == null) return ''
  if (typeof v === 'string') return squash(v)
  if (typeof v === 'number') return String(v)
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : dateLabel(v)
  if (typeof v === 'boolean') return ''
  if (v.richText) return squash(v.richText.map(part => part.text).join(''))
  if ('result' in v) return cellText({ value: v.result })
  if (typeof v.text === 'string') return squash(v.text)
  return ''
}

const isoFromUTC = date => date.toISOString().slice(0, 10)
const isMonday = iso => new Date(`${iso}T00:00:00Z`).getUTCDay() === 1

/** A date cell as YYYY-MM-DD, or null. Handles real dates, formula results, serial numbers and dd/mm/yyyy text. */
export function cellDate(cell) {
  const v = cell?.value
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : isoFromUTC(v)
  if (v && typeof v === 'object' && 'result' in v) return cellDate({ value: v.result })
  if (typeof v === 'number' && v > 30000 && v < 80000) return isoFromUTC(new Date(Date.UTC(1899, 11, 30) + v * 864e5))
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
    if (m) {
      const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
      return `${year}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
    }
  }
  return null
}

/** Where things sit on this sheet, found from the "AM" label column; null if it has no schedule on it. */
export function sheetLayout(ws) {
  for (let r = 2; r <= MAX_HEADER_SCAN_ROWS; r++) {
    for (let c = 1; c <= 5; c++) {
      if (cellText(ws.getCell(r, c)).toUpperCase() === 'AM') {
        return { amCol: c, nameCol: c - 1, groupCol: c >= 3 ? c - 2 : 0, firstDayCol: c + 1, commentCol: c + 6 }
      }
    }
  }
  return null
}

/** The sheet's Monday (YYYY-MM-DD), read from its header row; null if there isn't a sound one. */
export function sheetWeekStart(ws, layout) {
  for (const col of [layout.firstDayCol, layout.amCol]) {
    const iso = cellDate(ws.getCell(1, col))
    if (iso) return isMonday(iso) ? iso : null
  }
  return null
}

const TEAM_LABELS = { admin: 'Admin', management: 'Management', engineers: 'Engineers', sales: 'Sales', applications: 'Application', application: 'Application' }
const teamFromLabel = label => TEAM_LABELS[label.toLowerCase()] || label

/** "Starship" + "Cass Office" → "Starship / Cass Office"; same or one blank → just the one. */
export function combineHalves(am, pm) {
  if (!am) return pm
  if (!pm || pm.toLowerCase() === am.toLowerCase()) return am
  const seen = new Set()
  return `${am} / ${pm}`.split('/').map(part => part.trim()).filter(part => {
    if (!part || seen.has(part.toLowerCase())) return false
    seen.add(part.toLowerCase())
    return true
  }).join(' / ')
}

const ON_CALL_SUFFIX = /\s*-\s*on\s*call\s*$/i

/**
 * Everyone on one sheet: { name, team, onCall, days: [5 texts], comment }.
 * `onCall` is the weekly on-call engineer, written as "Name - OnCall" in the
 * Excel; the suffix is stripped from the name. `team` is '' on the older layout.
 */
export function readPeople(ws, layout) {
  const people = []
  let team = ''
  for (let r = 2; r <= ws.rowCount; r++) {
    if (layout.groupCol) {
      const label = cellText(ws.getCell(r, layout.groupCol))
      if (label) team = teamFromLabel(label)
    }
    if (cellText(ws.getCell(r, layout.amCol)).toUpperCase() !== 'AM') continue
    const rawName = cellText(ws.getCell(r, layout.nameCol))
    if (!rawName) continue
    const days = [0, 1, 2, 3, 4].map(i =>
      combineHalves(cellText(ws.getCell(r, layout.firstDayCol + i)), cellText(ws.getCell(r + 1, layout.firstDayCol + i)))
    )
    people.push({
      name: squash(rawName.replace(ON_CALL_SUFFIX, '')),
      team,
      onCall: ON_CALL_SUFFIX.test(rawName),
      days,
      comment: cellText(ws.getCell(r, layout.commentCol)) || cellText(ws.getCell(r + 1, layout.commentCol)),
    })
  }
  return people
}

/**
 * Finds which sheet is which week without reading anyone yet (cheap).
 * Returns { weeks: Map(weekStart → { ws, layout }), skipped: [{ sheet, reason }] }.
 */
export function indexWorkbook(workbook) {
  const weeks = new Map()
  const skipped = []
  for (const ws of workbook.worksheets) {
    if (/template/i.test(ws.name)) continue
    const layout = sheetLayout(ws)
    if (!layout) { skipped.push({ sheet: ws.name, reason: 'no schedule found on it' }); continue }
    const weekStart = sheetWeekStart(ws, layout)
    if (!weekStart) { skipped.push({ sheet: ws.name, reason: 'its week-starting date is missing or isn’t a Monday' }); continue }
    if (weeks.has(weekStart)) { skipped.push({ sheet: ws.name, reason: `another sheet already covers the week of ${weekStart}` }); continue }
    weeks.set(weekStart, { ws, layout, sheet: ws.name })
  }
  return { weeks, skipped }
}
