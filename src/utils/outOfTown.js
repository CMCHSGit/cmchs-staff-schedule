import { statusOf } from './status'
import { addDaysISO, fromISO, toISO, weekStartOf } from './week'

/**
 * Out-of-town days, for the quarterly report people send their manager.
 * A day counts when any place in it is a site visit or a course/training
 * ("Waikato", "NSH", "EAS course", "Starship / Cass Office"). Office, remote,
 * work from home, non-working days, holidays and customer calls don't —
 * and leave only when the report asks for it.
 */
const AWAY = new Set(['site', 'training'])

const parts = location => (location || '').split('/').map(p => p.trim()).filter(Boolean)

/** The places that make one day "out of town" (empty when it doesn't count). */
export function awayPlaces(day, { countLeave = false } = {}) {
  return parts(day?.location).filter(p => {
    const status = statusOf({ location: p })
    return AWAY.has(status) || (countLeave && status === 'leave')
  })
}

/** { days, reason } for one week — reason lists each place once, in order. */
export function summariseWeek(days, options) {
  const seen = new Map()
  let count = 0
  for (const day of days || []) {
    const away = awayPlaces(day, options)
    if (away.length) count++
    for (const p of away) if (!seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p)
  }
  return { days: count, reason: [...seen.values()].join(', ') }
}

/** Calendar quarters (Q1 = Jan–Mar), as { year, q, label }. */
export function quarterOf(date) {
  const d = new Date(date)
  const q = Math.floor(d.getMonth() / 3) + 1
  return { year: d.getFullYear(), q, label: `${d.getFullYear()} Q${q}` }
}

/** The current quarter and the ones before it, newest first. */
export function recentQuarters(count = 8) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => quarterOf(new Date(now.getFullYear(), now.getMonth() - i * 3, 1)))
}

/**
 * Every week whose Monday falls inside the quarter — the way the sheet does it,
 * so the week of 29 Sep counts towards Jul–Sep even though it ends in October.
 */
export function quarterWeeks({ year, q }) {
  const firstMonth = (q - 1) * 3
  const start = new Date(year, firstMonth, 1)
  const end = toISO(new Date(year, firstMonth + 3, 0)) // last day of the quarter
  let monday = weekStartOf(start)
  if (fromISO(monday) < start) monday = addDaysISO(monday, 7)
  const weeks = []
  for (; monday <= end; monday = addDaysISO(monday, 7)) weeks.push(monday)
  return weeks
}
