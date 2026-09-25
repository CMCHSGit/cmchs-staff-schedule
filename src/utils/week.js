/**
 * Returns the Monday of the current (or next) week as a YYYY-MM-DD string.
 * If today is Friday afternoon or later, defaults to next week.
 */
export function getCurrentWeekStart(offsetWeeks = 0) {
  const d = new Date()
  const day = d.getDay() // 0=Sun, 1=Mon ... 6=Sat
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // adjust to Monday
  d.setDate(diff + offsetWeeks * 7)
  return toISO(d)
}

export function toISO(date) {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function weekLabel(isoMonday) {
  const start = new Date(isoMonday + 'T00:00:00')
  const end   = new Date(start)
  end.setDate(start.getDate() + 4)
  const fmt = (d) => d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

export const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

export const DEFAULT_LOCATION = 'Cass Office'

/** Days start blank — people pick a location rather than have one silently pre-selected. */
export function emptySchedule() {
  return WEEK_DAYS.map(() => ({ location: '', onCall: false }))
}

/** One location (+ on-call flag) per day; migrate legacy { am, pm } records. */
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
