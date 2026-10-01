import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { toISO, weekStartOf, addDaysISO, fromISO, dayMonth, normalizeSchedule, weekdaysInRange, WEEK_DAYS, DAY_SHORT, MONTHS_LONG } from '../utils/week'
import { holidayOn } from '../utils/holidays'
import { describeDay, STATUS, INK } from '../utils/status'
import { shortNames } from '../utils/names'
import { groupByTeam } from '../utils/teams'
import { writeLeaveRange, writeSchedule } from '../utils/scheduleStore'
import { logActivity } from '../utils/activityLog'
import { useUsers, useSchedules } from '../hooks/useScheduleData'
import LeaveDrawer from '../components/LeaveDrawer'
import PeopleFilter, { filterPeople } from '../components/PeopleFilter'
import Legend from '../components/Legend'
import Toast, { useToast } from '../components/Toast'
import { IconButton, Loading } from '../components/ui'

const MAX_ITEMS = 4

/** One calendar day back/forward, skipping weekends — leave only ever runs Mon–Fri. */
const prevWeekday = iso => { let d = addDaysISO(iso, -1); while ([0, 6].includes(fromISO(d).getDay())) d = addDaysISO(d, -1); return d }
const nextWeekday = iso => { let d = addDaysISO(iso, 1); while ([0, 6].includes(fromISO(d).getDay())) d = addDaysISO(d, 1); return d }

/** Every weekday of the month (plus the edges of its first/last weeks), in Monday-first weeks. */
function monthWeeks(year, month) {
  const first = new Date(year, month, 1)
  // A month starting on a weekend begins with the following Monday's week.
  let monday = weekStartOf(first.getDay() === 0 || first.getDay() === 6 ? new Date(year, month, 3) : first)
  const weeks = []
  while (fromISO(monday).getMonth() === month || weeks.length === 0) {
    weeks.push(monday)
    monday = addDaysISO(monday, 7)
    if (weeks.length > 6) break
  }
  return weeks
}

export default function LeaveCalendar() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const now = new Date()
  const [monthOff, setMonthOff] = useState(0)
  const [booking, setBooking] = useState(null) // the day tapped, as YYYY-MM-DD
  const [query, setQuery] = useState('')
  const [teamSel, setTeamSel] = useState([])
  const [toast, showToast] = useToast()
  const shown = new Date(now.getFullYear(), now.getMonth() + monthOff, 1)
  const year = shown.getFullYear()
  const month = shown.getMonth()
  const weeks = monthWeeks(year, month)

  const { users, loading: usersLoading } = useUsers()
  const { byWeek, loading: schedLoading, patch } = useSchedules(weeks)
  const names = useMemo(() => shortNames(users), [users])
  const sorted = useMemo(() => [...users].sort((a, b) => names.get(a.uid).localeCompare(names.get(b.uid))), [users, names])
  const today = toISO(now)
  // The search and team tags narrow who shows on the calendar — booking
  // still offers everyone you're allowed to book for.
  const shownPeople = filterPeople(sorted, names, query, teamSel)
  const filtering = !!query.trim() || teamSel.length > 0

  const days = weeks.flatMap(w => [0, 1, 2, 3, 4].map(i => {
    const iso = addDaysISO(w, i)
    const holiday = holidayOn(iso)
    const items = []
    if (!holiday) {
      for (const u of shownPeople) {
        const d = describeDay(byWeek[w]?.[u.uid]?.days?.[i])
        if (d.status === 'leave') items.push({ uid: u.uid, name: names.get(u.uid), bg: STATUS.leave.bg })
        else if (d.status === 'training') items.push({ uid: u.uid, name: `${names.get(u.uid)} · Training`, bg: STATUS.training.bg })
      }
    }
    return { iso, dow: i, holiday, items, inMonth: fromISO(iso).getMonth() === month }
  }))
  const agenda = days.filter(d => d.inMonth && (d.holiday || d.items.length))

  // Everyone can book their own leave; admins can book anyone's — the same
  // rule the database enforces, so nobody is offered a save that will fail.
  const bookable = isAdmin ? sorted : sorted.filter(u => u.uid === user?.uid)

  /** One person's day, read straight out of the weeks already loaded for this month. */
  function dayFor(iso, uid) {
    const ws = weekStartOf(fromISO(iso))
    const dayIdx = (fromISO(iso).getDay() + 6) % 7
    return byWeek[ws]?.[uid]?.days?.[dayIdx]
  }

  /**
   * The full run of consecutive days this booking actually covers — not just
   * the one day tapped. Walks outward from it while the same leave (or
   * training) type keeps showing up, tunnelling through any public holiday
   * in between (a booking can span one without breaking) but stopping at a
   * genuine gap or a different type. Only ever looks at weeks already loaded
   * for the month in view — a booking extending past that reads as ending there.
   */
  function leaveRangeFor(uid, dateIso, status, text) {
    const matches = iso => {
      const h = holidayOn(iso)
      if (h) return null // tunnel through — neither a match nor a break
      const d = describeDay(dayFor(iso, uid), h)
      return d.status === status && d.text === text
    }
    let from = dateIso
    for (let cursor = dateIso, guard = 0; guard < 60; guard++) {
      const prev = prevWeekday(cursor)
      const m = matches(prev)
      if (m === null) { cursor = prev; continue }
      if (!m) break
      from = prev
      cursor = prev
    }
    let to = dateIso
    for (let cursor = dateIso, guard = 0; guard < 60; guard++) {
      const next = nextWeekday(cursor)
      const m = matches(next)
      if (m === null) { cursor = next; continue }
      if (!m) break
      to = next
      cursor = next
    }
    return { from, to }
  }

  /** Every "already booked" row covering the tapped day — one per person, grouped into its full run. */
  function groupLeaveOnDay(dateIso) {
    const out = []
    for (const u of sorted) {
      const d = describeDay(dayFor(dateIso, u.uid))
      if (d.status !== 'leave' && d.status !== 'training') continue
      const { from, to } = leaveRangeFor(u.uid, dateIso, d.status, d.text)
      out.push({ uid: u.uid, name: names.get(u.uid), bg: d.status === 'leave' ? STATUS.leave.bg : STATUS.training.bg, type: d.text, from, to })
    }
    return out
  }

  const bookingGroups = booking ? groupLeaveOnDay(booking) : []

  /** Clears one person's leave/training on exactly these days — the shared primitive behind both editing and deleting a booking. */
  async function clearLeaveDays(uid, isoList) {
    const person = sorted.find(u => u.uid === uid)
    if (!person || !isoList.length) return
    const byWeekIdx = new Map()
    for (const iso of isoList) {
      const ws = weekStartOf(fromISO(iso))
      const dayIdx = (fromISO(iso).getDay() + 6) % 7
      byWeekIdx.set(ws, [...(byWeekIdx.get(ws) || []), dayIdx])
    }
    for (const [ws, idxs] of byWeekIdx) {
      const existing = byWeek[ws]?.[uid]
      const daysArr = normalizeSchedule(existing?.days).map((d, i) => (idxs.includes(i) ? { location: '', onCall: d.onCall } : d))
      const saved = await writeSchedule({ person, weekStart: ws, days: daysArr, comments: existing?.comments || '', editorUid: user.uid, existing })
      patch(ws, uid, saved)
    }
  }

  /**
   * Books the leave, then updates what's on screen without a reload. When
   * this is editing an existing booking (`replacing` carries its original
   * from/to), whatever the old range covered that the new one no longer does
   * gets cleared too — otherwise shrinking a booking would just leave the
   * trimmed-off days still marked as leave.
   */
  async function bookLeave({ person, from, to, type, replacing }) {
    const count = weekdaysInRange(from, to).filter(d => !holidayOn(d.iso)).length
    try {
      const written = await writeLeaveRange({ person, from, to, type, editorUid: user.uid })
      for (const w of written) patch(w.weekStart, person.uid, w.saved)
      if (replacing) {
        const keep = new Set(weekdaysInRange(from, to).map(d => d.iso))
        const drop = weekdaysInRange(replacing.from, replacing.to).filter(d => !holidayOn(d.iso) && !keep.has(d.iso)).map(d => d.iso)
        if (drop.length) await clearLeaveDays(person.uid, drop)
      }
      setBooking(null)
      showToast(`${type} booked for ${names.get(person.uid)} — ${count} ${count === 1 ? 'day' : 'days'}.`)
      logActivity(user, `${replacing ? 'Updated' : 'Booked'} ${type} for ${names.get(person.uid)}, ${dayMonth(from)} – ${dayMonth(to)} (${count} ${count === 1 ? 'day' : 'days'}).`)
    } catch (e) {
      console.error(e)
      showToast(e.code === 'permission-denied'
        ? 'Not allowed — you can only book your own leave.'
        : 'Could not book that leave — try again.')
    }
  }

  /**
   * Un-books a whole run in one go — the way it's offered in the drawer
   * ("Already booked"): one × clears every day from..to, not day by day.
   */
  async function removeLeaveRange(uid, from, to) {
    const isoList = weekdaysInRange(from, to).filter(d => !holidayOn(d.iso)).map(d => d.iso)
    const type = describeDay(dayFor(from, uid)).text
    const range = from === to ? dayMonth(from) : `${dayMonth(from)} – ${dayMonth(to)}`
    try {
      await clearLeaveDays(uid, isoList)
      showToast(`${type || 'Leave'} removed for ${names.get(uid)}, ${range}.`)
      logActivity(user, `Removed ${type || 'leave'} for ${names.get(uid)}, ${range}.`)
    } catch (e) {
      console.error(e)
      showToast(e.code === 'permission-denied'
        ? 'Not allowed — you can only remove your own leave.'
        : 'Could not remove that — try again.')
    }
  }

  const loading = usersLoading || schedLoading

  return (
    <div className="page">
      <PeopleFilter query={query} onQuery={setQuery} teams={groupByTeam(sorted)} selected={teamSel} onChange={setTeamSel} />
      <div className="hide-narrow"><Legend /></div>

      <div className="month-nav">
        <IconButton label="Previous month" onClick={() => setMonthOff(m => m - 1)}><ChevronLeft size={20} /></IconButton>
        <span className="month-label">{MONTHS_LONG[month]} {year}</span>
        <IconButton label="Next month" onClick={() => setMonthOff(m => m + 1)}><ChevronRight size={20} /></IconButton>
        <span className="month-caption">
          Leave, training and public holidays. Weekdays only — tap a day to book {isAdmin ? 'leave for anyone' : 'your leave'}.
        </span>
      </div>

      {loading ? <Loading /> : (
        <>
          <div className="month-grid">
            {WEEK_DAYS.map(d => <div key={d} className="month-head">{d}</div>)}
            {days.map(d => (
              <button
                key={d.iso}
                type="button"
                className={`month-cell${d.inMonth ? '' : ' outside'}`}
                style={d.holiday ? { background: STATUS.holiday.bg, color: INK } : undefined}
                onClick={() => setBooking(d.iso)}
              >
                <span className={`month-num${d.iso === today ? ' today' : ''}`}>{fromISO(d.iso).getDate()}</span>
                {d.holiday && <span className="month-holiday">{d.holiday}</span>}
                {d.items.slice(0, MAX_ITEMS).map(it => (
                  <span key={it.uid} className="month-item" style={{ background: it.bg }}>{it.name}</span>
                ))}
                {d.items.length > MAX_ITEMS && <span className="month-more">+{d.items.length - MAX_ITEMS} more</span>}
              </button>
            ))}
          </div>

          <div className="month-agenda">
            {agenda.map(d => (
              <button key={d.iso} type="button" className="agenda-row" style={d.holiday ? { background: STATUS.holiday.bg, color: INK } : undefined} onClick={() => setBooking(d.iso)}>
                <span className="agenda-date">
                  <span className="agenda-dow">{DAY_SHORT[d.dow]}</span>
                  <span className="agenda-num">{fromISO(d.iso).getDate()}</span>
                </span>
                <span className="agenda-items">
                  {d.holiday && <span className="month-holiday">{d.holiday}</span>}
                  {d.items.map(it => <span key={it.uid} className="month-item" style={{ background: it.bg }}>{it.name}</span>)}
                </span>
              </button>
            ))}
            {!agenda.length && <p className="empty-note" style={{ padding: 14 }}>{filtering ? 'No leave matching that search this month.' : 'No leave booked this month.'}</p>}
          </div>
        </>
      )}

      {booking && (
        <LeaveDrawer
          date={booking}
          people={bookable}
          names={names}
          defaultUid={user?.uid}
          canPickOthers={isAdmin}
          canDelete={uid => isAdmin || uid === user?.uid}
          booked={bookingGroups}
          onSave={bookLeave}
          onDelete={(uid, from, to) => removeLeaveRange(uid, from, to)}
          onOpenDay={() => navigate(`/day?date=${booking}`)}
          onClose={() => setBooking(null)}
        />
      )}

      <Toast message={toast} />
    </div>
  )
}
