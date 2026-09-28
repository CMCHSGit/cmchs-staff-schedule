import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toISO, weekStartOf, addDaysISO, fromISO, WEEK_DAYS, DAY_SHORT, MONTHS_LONG } from '../utils/week'
import { holidayOn } from '../utils/holidays'
import { describeDay, STATUS } from '../utils/status'
import { shortNames } from '../utils/names'
import { useUsers, useSchedules } from '../hooks/useScheduleData'
import { IconButton, Loading } from '../components/ui'

const MAX_ITEMS = 4

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
  const now = new Date()
  const [monthOff, setMonthOff] = useState(0)
  const shown = new Date(now.getFullYear(), now.getMonth() + monthOff, 1)
  const year = shown.getFullYear()
  const month = shown.getMonth()
  const weeks = monthWeeks(year, month)

  const { users, loading: usersLoading } = useUsers()
  const { byWeek, loading: schedLoading } = useSchedules(weeks)
  const names = useMemo(() => shortNames(users), [users])
  const sorted = useMemo(() => [...users].sort((a, b) => names.get(a.uid).localeCompare(names.get(b.uid))), [users, names])
  const today = toISO(now)

  const days = weeks.flatMap(w => [0, 1, 2, 3, 4].map(i => {
    const iso = addDaysISO(w, i)
    const holiday = holidayOn(iso)
    const items = []
    if (!holiday) {
      for (const u of sorted) {
        const d = describeDay(byWeek[w]?.[u.uid]?.days?.[i])
        if (d.status === 'leave') items.push({ uid: u.uid, name: names.get(u.uid), bg: STATUS.leave.bg })
        else if (d.status === 'training') items.push({ uid: u.uid, name: `${names.get(u.uid)} · Training`, bg: STATUS.training.bg })
      }
    }
    return { iso, dow: i, holiday, items, inMonth: fromISO(iso).getMonth() === month }
  }))
  const agenda = days.filter(d => d.inMonth && (d.holiday || d.items.length))
  const open = iso => navigate(`/day?date=${iso}`)
  const loading = usersLoading || schedLoading

  return (
    <div className="page">
      <div className="month-nav">
        <IconButton label="Previous month" onClick={() => setMonthOff(m => m - 1)}><ChevronLeft size={20} /></IconButton>
        <span className="month-label">{MONTHS_LONG[month]} {year}</span>
        <IconButton label="Next month" onClick={() => setMonthOff(m => m + 1)}><ChevronRight size={20} /></IconButton>
        <span className="month-caption">Leave, training and public holidays. Weekdays only — tap a day to see who’s where.</span>
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
                style={d.holiday ? { background: STATUS.holiday.bg } : undefined}
                onClick={() => open(d.iso)}
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
              <button key={d.iso} type="button" className="agenda-row" style={d.holiday ? { background: STATUS.holiday.bg } : undefined} onClick={() => open(d.iso)}>
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
            {!agenda.length && <p className="empty-note" style={{ padding: 14 }}>No leave booked this month.</p>}
          </div>
        </>
      )}
    </div>
  )
}
