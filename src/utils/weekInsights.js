import { describeDay, statusOf } from './status'
import { weekDates, WEEK_DAYS, DAY_SHORT, dayMonth, normalizeCalls } from './week'
import { holidayOn } from './holidays'

const DAYS = [0, 1, 2, 3, 4]

const hasCalls = day => !!day?.onCall || statusOf(day) === 'calls'

/**
 * Who covers customer calls each weekday — one person per day, as a
 * one-element list (empty when nobody). Whoever the on-call roster has down
 * for that day; failing that, whoever's own entry says "Customer Calls"
 * (typed in Team week, or imported from Excel), so it still counts as that
 * day's cover rather than showing as unassigned.
 */
export function callsCoverUids({ users, schedules, oncall }) {
  const rostered = normalizeCalls(oncall?.calls)
  return DAYS.map(i => {
    if (rostered[i]) return [rostered[i]]
    const own = users.find(u => hasCalls(schedules[u.uid]?.days?.[i]))
    return own ? [own.uid] : []
  })
}

/** Names of whoever has customer calls each day, or the holiday, or an em dash. */
export function callsCover({ weekStart, users, schedules, oncall, names }) {
  const dates = weekDates(weekStart)
  const cover = callsCoverUids({ users, schedules, oncall })
  return DAYS.map(i => holidayOn(dates[i]) || cover[i].map(uid => names.get(uid)).filter(Boolean).join(', ') || '—')
}

/** People on leave on one day of the week. */
export function onLeave({ weekStart, dayIdx, users, schedules }) {
  const date = weekDates(weekStart)[dayIdx]
  return users.filter(u => describeDay(schedules[u.uid]?.days?.[dayIdx], holidayOn(date)).status === 'leave')
}

/**
 * The "things to check" list for one week: on-call gaps, days with no
 * customer calls cover, and people with nothing entered. The last two only
 * once somebody has started filling the week in, so a future week that's
 * simply not been done yet doesn't look like a wall of problems.
 */
export function weekConflicts({ weekStart, users, schedules, oncall, names }) {
  const dates = weekDates(weekStart)
  const holidays = dates.map(holidayOn)
  const out = []

  if (!oncall?.uid) {
    out.push({ type: 'oncall', short: 'Unassigned', text: `No one is on call for the week starting ${dayMonth(weekStart)}.` })
  } else {
    const leaveDays = DAYS.filter(i => describeDay(schedules[oncall.uid]?.days?.[i], holidays[i]).status === 'leave')
    if (leaveDays.length) {
      const name = names.get(oncall.uid) || oncall.displayName || 'The on-call engineer'
      out.push({
        type: 'oncall', short: 'On call, on leave',
        text: `${name} is on call but on leave ${leaveDays.map(i => `${DAY_SHORT[i]} ${dayMonth(dates[i])}`).join(', ')}.`,
      })
    }
  }

  if (Object.keys(schedules).length) {
    const cover = callsCoverUids({ users, schedules, oncall })
    for (const i of DAYS) {
      if (holidays[i]) continue
      if (!cover[i].length) {
        out.push({ type: 'calls', short: 'Calls gap', text: `No customer calls cover on ${WEEK_DAYS[i]} ${dayMonth(dates[i])}.` })
      }
    }
    const workDays = DAYS.filter(i => !holidays[i])
    const missing = users
      .map(u => ({ u, days: workDays.filter(i => describeDay(schedules[u.uid]?.days?.[i]).empty) }))
      .filter(m => m.days.length)
      .map(m => `${names.get(m.u.uid)} (${m.days.length === workDays.length ? 'all week' : m.days.map(i => DAY_SHORT[i]).join(', ')})`)
    if (missing.length) out.push({ type: 'empty', short: 'Gaps', text: `No entry: ${missing.join(', ')}.` })
  }

  return out
}
