import { MONTHS_LONG } from './week.js'

/**
 * The FBT vehicle unavailability report that goes to the managers — plain text,
 * laid out exactly like the one already being sent: a header, the vehicle,
 * the quarter and the total, then one record per trip (its place and each date).
 */
export const FBT_REASON = 'Away from home - car not available for personal use'

const RULE = 50
// "Sept", not "Sep" — that is how the report has always read.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "6 Jul 2026", "14 Sept 2026" */
export function fbtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTH_ABBR[m - 1]} ${y}`
}

/** "Monday, 5 October 2026" — fixed English names, so every browser writes it the same. */
const longDate = date => `${DAY_NAMES[date.getDay()]}, ${date.getDate()} ${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`

const days = n => `${n} ${n === 1 ? 'day' : 'days'}`

/**
 * The report text. `trips` is [{ notes, dates }] with each trip's dates as
 * YYYY-MM-DD in order; `quarter` is from describeQuarter().
 */
export function fbtReport({ vehicle, quarter, trips, generated = new Date() }) {
  const total = trips.reduce((n, t) => n + t.dates.length, 0)
  const lines = [
    'FBT VEHICLE UNAVAILABILITY REPORT',
    '='.repeat(RULE),
    `Vehicle: ${vehicle}`,
    `Quarter: ${quarter.label}`,
    `Total Unavailable Days: ${total}`,
    '',
    'DETAILED RECORDS',
    '-'.repeat(RULE),
  ]
  if (!trips.length) lines.push('', 'No days recorded for this quarter.')
  for (const t of trips) {
    lines.push('', `Reason: ${FBT_REASON}`, `Notes: ${t.notes}`, `Dates (${days(t.dates.length)}):`, ...t.dates.map(d => `  - ${fbtDate(d)}`))
  }
  lines.push('', '='.repeat(RULE), `Report generated: ${longDate(generated)}`, '')
  return lines.join('\n')
}

/** "FBT-Report-Q2--Jul-Sep--2026.txt" */
export const fbtFileName = quarter => `FBT-Report-${quarter.label.replace(/[^A-Za-z0-9]/g, '-')}.txt`

/** Saves the report text as a file from the browser. */
export function downloadFbtReport({ quarter, text }) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fbtFileName(quarter)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
