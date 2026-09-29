/**
 * Returns the Monday of the current working week as a YYYY-MM-DD string,
 * shifted by offsetWeeks. On Saturday and Sunday the working week just gone
 * is over, so those roll forward to the coming Monday instead.
 */
export function getCurrentWeekStart(offsetWeeks = 0) {
  const d = new Date()
  const day = d.getDay() // 0=Sun, 1=Mon ... 6=Sat
  const toMonday = day === 0 ? 1 : day === 6 ? 2 : 1 - day
  d.setDate(d.getDate() + toMonday + offsetWeeks * 7)
  return toISO(d)
}

export function toISO(date) {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromISO(iso) {
  return new Date(iso + 'T00:00:00')
}

export function addDaysISO(iso, days) {
  const d = fromISO(iso)
  d.setDate(d.getDate() + days)
  return toISO(d)
}

/** Monday (YYYY-MM-DD) of the Mon–Sun week containing the given date. */
export function weekStartOf(date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return toISO(d)
}

/** ISO dates for Monday–Friday of the week starting at weekStart. */
export function weekDates(weekStart) {
  return [0, 1, 2, 3, 4].map(i => addDaysISO(weekStart, i))
}

/** Index (0–4) of today within this week, or -1 when today isn't one of its weekdays. */
export function todayIndex(weekStart) {
  return weekDates(weekStart).indexOf(toISO(new Date()))
}

// Fixed English names rather than toLocaleDateString — browsers disagree on
// short month names ("Sep" vs "Sept"), and the schedule should read the same everywhere.
export const WEEK_DAYS  = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
export const DAY_SHORT  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const MONTHS      = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "28 Sep" */
export function dayMonth(iso) {
  const d = fromISO(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** "28 Sep 2026" */
export function dayMonthYear(iso) {
  return `${dayMonth(iso)} ${fromISO(iso).getFullYear()}`
}

/** "28 Sep – 2 Oct" */
export function weekLabel(weekStart) {
  return `${dayMonth(weekStart)} – ${dayMonth(addDaysISO(weekStart, 4))}`
}

export const DEFAULT_LOCATION = 'Cass Office'

/** Days start blank — people pick a location rather than have one silently pre-selected. */
export function emptySchedule() {
  return WEEK_DAYS.map(() => ({ location: '', onCall: false }))
}

/**
 * One location per day, plus the customer-calls flag (stored as `onCall`
 * for backwards compatibility with schedules saved before the weekly
 * on-call roster existed). Also migrates legacy { am, pm } records.
 */
export function normalizeSchedule(days) {
  return WEEK_DAYS.map((_, i) => {
    const d = days?.[i] || {}
    const onCall = !!d.onCall
    if (d.location !== undefined && d.location !== '') return { location: d.location, onCall }
    const am = d.am || ''
    const pm = d.pm || ''
    const location = am && pm && am !== pm ? am : (am || pm || '')
    return { location, onCall }
  })
}

/**
 * Firestore document ID for a user's schedule
 */
export function scheduleId(weekStart, uid) {
  return `${weekStart}_${uid}`
}

/**
 * Who covers customer calls each weekday, read from the week's on-call doc:
 * five uids, '' where nobody is rostered. Customer calls are set on the
 * on-call roster (one cover per day), not by each person on their own week.
 */
export function normalizeCalls(calls) {
  return WEEK_DAYS.map((_, i) => calls?.[i] || '')
}

/**
 * One person's week with the roster's customer-calls cover folded in — what
 * the views and the Excel mirror show. A day's own `onCall` flag still
 * counts, so weeks filled in before the roster took calls over, and rows
 * imported from Excel reading "… / Customer Calls", keep looking the same.
 */
export function daysWithCalls(days, oncall, uid) {
  const calls = normalizeCalls(oncall?.calls)
  return normalizeSchedule(days).map((d, i) => ({ ...d, onCall: d.onCall || (!!uid && calls[i] === uid) }))
}

/**
 * Every weekday a date range covers, as { weekStart, dayIdx, iso } — weekends
 * are skipped, since the schedule is Monday–Friday only.
 */
export function weekdaysInRange(from, to) {
  const out = []
  if (!from || !to || to < from) return out
  let iso = from
  for (let guard = 0; iso <= to && guard < 400; guard++) {
    const dow = fromISO(iso).getDay()
    if (dow >= 1 && dow <= 5) out.push({ weekStart: weekStartOf(fromISO(iso)), dayIdx: dow - 1, iso })
    iso = addDaysISO(iso, 1)
  }
  return out
}
