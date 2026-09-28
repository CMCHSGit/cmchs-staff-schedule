import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Phone } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getCurrentWeekStart, weekStartOf, weekDates, todayIndex, fromISO, WEEK_DAYS, dayMonth } from '../utils/week'
import { holidayOn } from '../utils/holidays'
import { describeDay, STATUS, STATUS_ORDER, PLAIN, INK } from '../utils/status'
import { groupByTeam, teamLabel } from '../utils/teams'
import { shortNames } from '../utils/names'
import { weekConflicts, onLeave } from '../utils/weekInsights'
import { useUsers, useSchedules, useOnCall } from '../hooks/useScheduleData'
import WeekNav from '../components/WeekNav'
import DayPills from '../components/DayPills'
import PeopleFilter, { filterPeople } from '../components/PeopleFilter'
import LeavePin from '../components/LeavePin'
import WeekAlerts from '../components/WeekAlerts'
import { Loading } from '../components/ui'

const weeksBetween = (fromMonday, toMonday) => Math.round((fromISO(toMonday) - fromISO(fromMonday)) / (7 * 864e5))

/** Who's where on one day — grouped by what they're doing, with counts. ?date=YYYY-MM-DD opens a given day. */
export default function DayView() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [params] = useSearchParams()
  const linked = params.get('date')

  const [weekOffset, setWeekOffset] = useState(() => (linked ? weeksBetween(getCurrentWeekStart(0), weekStartOf(fromISO(linked))) : 0))
  const weekStart = getCurrentWeekStart(weekOffset)
  const [dayIdx, setDayIdx] = useState(() => {
    if (linked) return Math.min(4, Math.max(0, (fromISO(linked).getDay() + 6) % 7))
    return Math.max(0, todayIndex(getCurrentWeekStart(0)))
  })
  const [query, setQuery] = useState('')
  const [teamSel, setTeamSel] = useState([])

  const { users, loading: usersLoading } = useUsers()
  const { byWeek, loading: schedLoading } = useSchedules([weekStart])
  const { byWeek: oncallByWeek } = useOnCall([weekStart])

  const names = useMemo(() => shortNames(users), [users])
  const sorted = useMemo(() => [...users].sort((a, b) => names.get(a.uid).localeCompare(names.get(b.uid))), [users, names])
  const schedules = byWeek[weekStart] || {}
  const oncall = oncallByWeek[weekStart]
  const date = weekDates(weekStart)[dayIdx]
  const holiday = holidayOn(date)

  const people = filterPeople(sorted, names, query, teamSel)
  const conflicts = isAdmin ? weekConflicts({ weekStart, users: sorted, schedules, oncall, names }) : []

  const byStatus = {}
  for (const u of people) {
    const d = describeDay(schedules[u.uid]?.days?.[dayIdx], holiday)
    const key = d.status || 'none'
    ;(byStatus[key] ||= []).push({ uid: u.uid, name: names.get(u.uid), note: d.note, meta: [teamLabel(u.team || null), d.note].filter(Boolean).join(' · ') })
  }
  byStatus.site?.sort((a, b) => a.note.localeCompare(b.note))
  const groups = [...STATUS_ORDER, 'none'].filter(k => byStatus[k]).map(k => ({
    key: k,
    label: k === 'none' ? 'No entry' : STATUS[k].label,
    filled: k !== 'none' && STATUS[k].bg !== PLAIN,
    swatch: k === 'none' || STATUS[k].bg === PLAIN ? 'var(--surface-subtle)' : STATUS[k].bg,
    people: byStatus[k],
  }))
  const count = k => (byStatus[k] || []).length
  const summary = `${people.length} people · ${count('office')} in Cass Office · ${count('site')} on site · ${count('leave')} on leave`

  const loading = usersLoading || schedLoading

  return (
    <div className="page">
      <WeekNav
        weekStart={weekStart}
        isThisWeek={weekOffset === 0}
        onPrev={() => setWeekOffset(w => w - 1)}
        onNext={() => setWeekOffset(w => w + 1)}
        onThisWeek={() => { setWeekOffset(0); setDayIdx(Math.max(0, todayIndex(getCurrentWeekStart(0)))) }}
      />
      <DayPills weekStart={weekStart} value={dayIdx} onChange={setDayIdx} />
      <PeopleFilter query={query} onQuery={setQuery} teams={groupByTeam(sorted)} selected={teamSel} onChange={setTeamSel} />
      <LeavePin weekStart={weekStart} dayIdx={dayIdx} people={onLeave({ weekStart, dayIdx, users: people, schedules })} names={names} />
      <WeekAlerts conflicts={conflicts} />

      <div className="day-title-row">
        <h1 className="page-title">{WEEK_DAYS[dayIdx]} {dayMonth(date)}</h1>
        {!loading && <span className="page-sub">{holiday ? `${holiday} · ` : ''}{summary}</span>}
      </div>

      <div className="oncall-banner oncall-strip">
        <Phone size={18} aria-hidden="true" />
        On call: {oncall ? names.get(oncall.uid) || oncall.displayName : 'Unassigned'}
      </div>

      {loading ? <Loading /> : (
        <div className="day-groups">
          {groups.map(g => (
            <div key={g.key} className="day-group">
              <div className="day-group-head" style={{ background: g.swatch, color: g.filled ? INK : 'var(--text-strong)' }}>
                <span className="day-group-label">{g.label}</span>
                <span className="day-group-count">{g.people.length}</span>
              </div>
              <div className="day-group-people">
                {g.people.map(p => (
                  <div key={p.uid} className="day-person">
                    <span className="day-person-name">{p.name}</span>
                    <span className="day-person-meta">{p.meta}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
