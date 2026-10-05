import { statusOf } from './status.js'
import { holidayOn } from './holidays.js'
import { DAY_SHORT, MONTHS_SHORT, addDaysISO, fromISO, toISO, weekStartOf } from './week.js'

/**
 * Out-of-town days, for the quarterly report people send their manager.
 * A day counts when any place in it is a site visit or a course/training
 * ("Waikato", "NSH", "EAS course", "Starship / Cass Office"). Office, remote,
 * work from home, non-working days, holidays and customer calls don't —
 * and leave only when the report asks for it.
 */
const AWAY = new Set(['site', 'training'])

const parts = location => (location || '').split('/').map(p => p.trim()).filter(Boolean)

/**
 * The places that make one day "out of town" (empty when it doesn't count).
 * `holiday` is the public holiday on that date, if any: what's typed about it
 * ("EASTER", "ANZAC", "Kings birthday NZ") is the holiday, not somewhere visited.
 * A place typed on a holiday still counts — someone was working there.
 */
export function awayPlaces(day, { countLeave = false, holiday = '' } = {}) {
  return parts(day?.location).filter(p => {
    const status = statusOf({ location: p }, holiday)
    return AWAY.has(status) || (countLeave && status === 'leave')
  })
}

/**
 * { days, reason } for one week — reason lists each place once, in order.
 * `only` limits it to some of the five weekdays (0 = Monday), for a week that
 * is only partly inside the quarter being reported. `weekStart` (the Monday)
 * lets each day be matched against the public holidays on its date.
 */
export function summariseWeek(days, { only, weekStart, ...options } = {}) {
  const seen = new Map()
  let count = 0
  ;(days || []).forEach((day, i) => {
    if (only && !only.includes(i)) return
    const away = awayPlaces(day, { ...options, holiday: weekStart ? holidayOn(addDaysISO(weekStart, i)) : '' })
    if (away.length) count++
    for (const p of away) if (!seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p)
  })
  return { days: count, reason: [...seen.values()].join(', ') }
}

/**
 * A calendar quarter (Q1 = Jan–Mar): `title` is how the manager's request puts
 * it ("Jul – Sep 2026" — the months, so there's no question which quarter is
 * meant), `from`/`to` its first and last day.
 */
export function describeQuarter(year, q) {
  const first = (q - 1) * 3
  const months = `${MONTHS_SHORT[first]} – ${MONTHS_SHORT[first + 2]}`
  return {
    year,
    q,
    label: `${year} Q${q}`,
    months,
    title: `${months} ${year}`,
    from: toISO(new Date(year, first, 1)),
    to: toISO(new Date(year, first + 3, 0)),
  }
}

export function quarterOf(date) {
  const d = new Date(date)
  return describeQuarter(d.getFullYear(), Math.floor(d.getMonth() / 3) + 1)
}

/** The current quarter and the ones before it, newest first. */
export function recentQuarters(count = 8) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => quarterOf(new Date(now.getFullYear(), now.getMonth() - i * 3, 1)))
}

/**
 * The weeks a quarter touches, each with the weekdays of it that fall inside
 * the quarter — { weekStart, start, indices }, `start` being the first of them.
 * Days are counted by their own date, not by which quarter the week's Monday is
 * in, so "Jul – Sep" means 1 July to 30 September whatever day a week starts.
 * A week that crosses the edge of a quarter is split between the two quarters,
 * so every weekday lands in exactly one of them — none dropped, none twice.
 */
export function quarterSlices({ from, to }) {
  const slices = []
  for (let monday = weekStartOf(fromISO(from)); monday <= to; monday = addDaysISO(monday, 7)) {
    const indices = [0, 1, 2, 3, 4].filter(i => { const day = addDaysISO(monday, i); return day >= from && day <= to })
    if (indices.length) slices.push({ weekStart: monday, start: addDaysISO(monday, indices[0]), indices })
  }
  return slices
}

/** "Wed–Fri", "Mon–Tue" or "Fri" for a week only partly inside the quarter; '' for a whole week. */
export function partLabel(indices) {
  if (indices.length >= 5) return ''
  const first = DAY_SHORT[indices[0]]
  const last = DAY_SHORT[indices[indices.length - 1]]
  return first === last ? first : `${first}–${last}`
}
