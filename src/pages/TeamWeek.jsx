import { useMemo, useState } from 'react'
import { Printer, Copy } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getCurrentWeekStart, addDaysISO, weekDates, todayIndex, normalizeSchedule, WEEK_DAYS, dayMonth } from '../utils/week'
import { holidayOn } from '../utils/holidays'
import { describeDay } from '../utils/status'
import { groupByTeam, doesCustomerCalls } from '../utils/teams'
import { shortNames } from '../utils/names'
import { weekConflicts, onLeave } from '../utils/weekInsights'
import { writeSchedule, syncToExcel, addNewLocations } from '../utils/scheduleStore'
import { useUsers, useSchedules, useOnCall, useLocations } from '../hooks/useScheduleData'
import WeekNav from '../components/WeekNav'
import DayPills from '../components/DayPills'
import PeopleFilter, { filterPeople } from '../components/PeopleFilter'
import LeavePin from '../components/LeavePin'
import WeekAlerts from '../components/WeekAlerts'
import Legend from '../components/Legend'
import EditDrawer from '../components/EditDrawer'
import Toast, { useToast } from '../components/Toast'
import { Button, Loading } from '../components/ui'

export default function TeamWeek() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [weekOffset, setWeekOffset] = useState(0)
  const weekStart = getCurrentWeekStart(weekOffset)
  const prevWeek = addDaysISO(weekStart, -7)
  const [dayIdx, setDayIdx] = useState(() => Math.max(0, todayIndex(getCurrentWeekStart(0))))
  const [query, setQuery] = useState('')
  const [teamSel, setTeamSel] = useState([])
  const [editing, setEditing] = useState(null) // { uid, dayIdx }
  const [copying, setCopying] = useState(false)
  const [toast, showToast] = useToast()

  const { users, loading: usersLoading } = useUsers()
  const { byWeek, loading: schedLoading, patch } = useSchedules([prevWeek, weekStart])
  const { byWeek: oncallByWeek } = useOnCall([weekStart])
  const [locations, setLocations] = useLocations()

  const names = useMemo(() => shortNames(users), [users])
  const sorted = useMemo(() => [...users].sort((a, b) => names.get(a.uid).localeCompare(names.get(b.uid))), [users, names])
  const schedules = byWeek[weekStart] || {}
  const oncall = oncallByWeek[weekStart]
  const dates = weekDates(weekStart)
  const holidays = dates.map(holidayOn)
  const today = todayIndex(weekStart)

  const people = filterPeople(sorted, names, query, teamSel)
  const groups = groupByTeam(people)
  const teamOptions = groupByTeam(sorted)
  const conflicts = isAdmin ? weekConflicts({ weekStart, users: sorted, schedules, oncall, names }) : []
  const leaveToday = onLeave({ weekStart, dayIdx, users: people, schedules })
  const hasEntries = Object.keys(schedules).length > 0
  const notFilled = sorted.filter(u => !schedules[u.uid]).length

  const canEdit = u => isAdmin || u.uid === user.uid
  const cell = (u, i) => describeDay(schedules[u.uid]?.days?.[i], holidays[i])
  const nameLabel = u => (oncall?.uid === u.uid ? `${names.get(u.uid)} - OnCall` : names.get(u.uid))

  async function saveEdit(person, days, comments, typed) {
    try {
      const fresh = await addNewLocations([typed], locations)
      if (fresh.length) setLocations(prev => [...prev, ...fresh])
      const saved = await writeSchedule({ person, weekStart, days, comments, editorUid: user.uid, existing: schedules[person.uid] })
      patch(weekStart, person.uid, saved)
      setEditing(null)
      showToast('Saved.')
      syncToExcel(user, weekStart, [{ uid: person.uid, days, comments }])
    } catch (e) {
      console.error(e)
      showToast(e.code === 'permission-denied'
        ? 'Not allowed yet — the updated database rules need publishing.'
        : 'Save failed — try again.')
    }
  }

  /**
   * Fills this week for everyone who hasn't started it, from what they had
   * last week — never overwrites anything already entered. Leave and public
   * holidays aren't carried over. Marked needsConfirm, so people still get
   * Thursday's reminder to check it.
   */
  async function copyLastWeek() {
    const last = byWeek[prevWeek] || {}
    if (!Object.keys(last).length) return showToast('Last week has no entries to copy.')
    const targets = sorted.filter(u => last[u.uid] && !schedules[u.uid])
    if (!targets.length) return showToast('Everyone with last week filled in has started this week already.')
    if (!confirm(`Copy last week into this week for ${targets.length} ${targets.length === 1 ? 'person' : 'people'} who haven’t filled it in yet? Nothing already entered is changed.`)) return
    setCopying(true)
    const synced = []
    try {
      for (const u of targets) {
        const days = normalizeSchedule(last[u.uid].days).map((d, i) => {
          const status = describeDay(d).status
          return holidays[i] || status === 'leave' || status === 'holiday' ? { location: '', onCall: false } : d
        })
        const saved = await writeSchedule({ person: u, weekStart, days, comments: '', editorUid: user.uid, existing: null, extra: { copiedFrom: prevWeek } })
        patch(weekStart, u.uid, saved)
        synced.push({ uid: u.uid, days, comments: '' })
      }
      showToast(`Copied from week starting ${dayMonth(prevWeek)}. Leave and holidays were not carried over.`)
      syncToExcel(user, weekStart, synced)
    } catch (e) {
      console.error(e)
      showToast(e.code === 'permission-denied'
        ? 'Not allowed yet — the updated database rules need publishing.'
        : 'Copy stopped part-way — try again to finish.')
    } finally {
      setCopying(false)
    }
  }

  const editPerson = editing && users.find(u => u.uid === editing.uid)
  const loading = usersLoading || schedLoading

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">Team week</h1>
          {!loading && (
            <span className="page-sub">
              {sorted.length} people · {notFilled ? `${notFilled} not filled in yet` : 'everyone has filled in'} · tap {isAdmin ? 'anyone' : 'your row'} to update
            </span>
          )}
        </div>
      </div>

      <WeekNav
        weekStart={weekStart}
        isThisWeek={weekOffset === 0}
        onPrev={() => setWeekOffset(w => w - 1)}
        onNext={() => setWeekOffset(w => w + 1)}
        onThisWeek={() => { setWeekOffset(0); setDayIdx(Math.max(0, todayIndex(getCurrentWeekStart(0)))) }}
      >
        {isAdmin && (
          <Button variant="secondary" size="sm" className="hide-narrow" iconLeft={<Copy size={16} />} onClick={copyLastWeek} disabled={copying || loading}>
            {copying ? 'Copying…' : 'Copy last week'}
          </Button>
        )}
        <Button variant="secondary" size="sm" className="hide-narrow" iconLeft={<Printer size={16} />} onClick={() => window.print()}>Print week</Button>
      </WeekNav>

      <PeopleFilter query={query} onQuery={setQuery} teams={teamOptions} selected={teamSel} onChange={setTeamSel} />

      <div className="show-narrow"><DayPills weekStart={weekStart} value={dayIdx} onChange={setDayIdx} /></div>

      <LeavePin weekStart={weekStart} dayIdx={dayIdx} people={leaveToday} names={names} />
      <WeekAlerts conflicts={conflicts} />
      <div className="hide-narrow"><Legend /></div>

      {loading ? <Loading /> : (
        <>
          {!hasEntries && (
            <p className="empty-note">No entries for this week yet. Public holidays are shown already.</p>
          )}

          {/* Desktop: the whole week, like the Excel sheet */}
          <div className="wk-desktop">
            <div className="wk-cols wk-head">
              <span>Name</span>
              {WEEK_DAYS.map((d, i) => (
                <button key={d} type="button" className={i === dayIdx || i === today ? 'selected' : ''} onClick={() => setDayIdx(i)}>
                  {d} {dayMonth(dates[i])}
                </button>
              ))}
              <span>Comments</span>
            </div>
            {groups.map(g => (
              <div key={g.team} className="wk-group">
                <div className="wk-group-head">
                  <span className="wk-band" style={{ background: g.band }} />
                  <span className="wk-group-name">{g.label}</span>
                  <span className="wk-group-count">{g.members.length} {g.members.length === 1 ? 'person' : 'people'}</span>
                </div>
                {g.members.map(u => (
                  <div key={u.uid} className="wk-cols wk-row">
                    <div className={`wk-name${oncall?.uid === u.uid ? ' oncall' : ''}`} title={u.displayName}>{nameLabel(u)}</div>
                    {WEEK_DAYS.map((_, i) => {
                      const c = cell(u, i)
                      const Tagname = canEdit(u) ? 'button' : 'div'
                      return (
                        <Tagname
                          key={i}
                          type={canEdit(u) ? 'button' : undefined}
                          className="wk-cell"
                          style={{ background: c.bg }}
                          title={c.text || undefined}
                          onClick={canEdit(u) ? () => setEditing({ uid: u.uid, dayIdx: i }) : undefined}
                        >
                          {c.text}
                        </Tagname>
                      )
                    })}
                    <div className="wk-comment" title={schedules[u.uid]?.comments || undefined}>{schedules[u.uid]?.comments}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Phone: one day at a time, picked with the day pills */}
          <div className="wk-mobile">
            {groups.map(g => (
              <div key={g.team} className="wkm-group">
                <div className="wkm-band" style={{ background: g.band }}>{g.label}</div>
                {g.members.map(u => {
                  const c = cell(u, dayIdx)
                  const Tagname = canEdit(u) ? 'button' : 'div'
                  return (
                    <Tagname
                      key={u.uid}
                      type={canEdit(u) ? 'button' : undefined}
                      className="wkm-row"
                      onClick={canEdit(u) ? () => setEditing({ uid: u.uid, dayIdx }) : undefined}
                    >
                      <span className={`wkm-name${oncall?.uid === u.uid ? ' oncall' : ''}`}>{nameLabel(u)}</span>
                      <span className={`wkm-day${c.empty ? ' blank' : ''}`} style={{ background: c.bg }}>{c.text || 'No entry'}</span>
                    </Tagname>
                  )
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {editPerson && (
        <EditDrawer
          person={editPerson}
          name={names.get(editPerson.uid)}
          isSelf={editPerson.uid === user.uid}
          weekStart={weekStart}
          dayIdx={editing.dayIdx}
          schedule={schedules[editPerson.uid]}
          locations={locations}
          showCalls={doesCustomerCalls(editPerson.team) || normalizeSchedule(schedules[editPerson.uid]?.days).some(d => d.onCall)}
          onSave={(days, comments, typed) => saveEdit(editPerson, days, comments, typed)}
          onClose={() => setEditing(null)}
        />
      )}

      <Toast message={toast} />
    </div>
  )
}
