import { useMemo } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getCurrentWeekStart, addDaysISO, dayMonth, weekDates, normalizeCalls, WEEK_DAYS, DAY_SHORT } from '../utils/week'
import { holidayOn } from '../utils/holidays'
import { shortNames } from '../utils/names'
import { callsCover, callsCoverUids, weekConflicts } from '../utils/weekInsights'
import { writeOnCall, writeCallsCover } from '../utils/scheduleStore'
import { useUsers, useSchedules, useOnCall } from '../hooks/useScheduleData'
import Toast, { useToast } from '../components/Toast'
import { Alert, Badge, Loading } from '../components/ui'

const WEEKS_SHOWN = 8

export default function OnCall() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const thisWeek = getCurrentWeekStart(0)
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => addDaysISO(thisWeek, i * 7))

  const { users, loading: usersLoading } = useUsers()
  const { byWeek, loading: schedLoading } = useSchedules(weeks)
  const { byWeek: oncall, blocked, set } = useOnCall(weeks)
  const [toast, showToast] = useToast()

  const names = useMemo(() => shortNames(users), [users])
  const engineers = useMemo(
    () => users.filter(u => u.team === 'Engineers').sort((a, b) => names.get(a.uid).localeCompare(names.get(b.uid))),
    [users, names]
  )

  const rows = weeks.map(w => {
    const schedules = byWeek[w] || {}
    const current = oncall[w]
    const issue = weekConflicts({ weekStart: w, users, schedules, oncall: current, names }).find(c => c.type === 'oncall')
    const rostered = normalizeCalls(current?.calls)
    const cover = callsCoverUids({ users, schedules, oncall: current })
    return {
      week: w,
      range: `${dayMonth(w)} – ${dayMonth(addDaysISO(w, 4))}`,
      current,
      name: current?.uid ? names.get(current.uid) || current.displayName : '',
      holidays: weekDates(w).map(holidayOn),
      rostered,
      // Anyone covering calls because their own entry says so rather than the
      // roster — shown next to the picker so the two never quietly disagree.
      extra: cover.map((uids, i) => uids.filter(uid => uid !== rostered[i]).map(uid => names.get(uid)).filter(Boolean)),
      calls: callsCover({ weekStart: w, users, schedules, oncall: current, names }),
      status: issue ? issue.short : 'Covered',
      tone: issue ? 'critical' : 'green',
    }
  })

  async function assign(week, uid) {
    const person = uid ? users.find(u => u.uid === uid) : null
    try {
      const saved = await writeOnCall(week, person, user.uid, oncall[week])
      set(week, saved)
      showToast(person ? `${names.get(uid)} is on call for the week starting ${dayMonth(week)}.` : `On call cleared for ${dayMonth(week)}.`)
    } catch (e) {
      console.error(e)
      showToast(e.code === 'permission-denied' ? 'Not allowed yet — the updated database rules need publishing.' : 'Could not save — try again.')
    }
  }

  /** Customer calls cover for one weekday — rostered here, not by each person. */
  async function assignCalls(week, dayIdx, uid) {
    const person = uid ? users.find(u => u.uid === uid) : null
    const day = `${WEEK_DAYS[dayIdx]} ${dayMonth(weekDates(week)[dayIdx])}`
    try {
      const saved = await writeCallsCover(week, dayIdx, person, user.uid, oncall[week])
      set(week, saved)
      showToast(person ? `${names.get(uid)} has customer calls on ${day}.` : `Customer calls cleared for ${day}.`)
    } catch (e) {
      console.error(e)
      showToast(e.code === 'permission-denied' ? 'Not allowed yet — the updated database rules need publishing.' : 'Could not save — try again.')
    }
  }

  const who = r => isAdmin ? (
    <select value={r.current?.uid || ''} onChange={e => assign(r.week, e.target.value)} aria-label={`On call, week starting ${dayMonth(r.week)}`}>
      <option value="">Unassigned</option>
      {engineers.map(u => <option key={u.uid} value={u.uid}>{names.get(u.uid)}</option>)}
    </select>
  ) : (r.name ? `${r.name} - OnCall` : 'Unassigned')

  const callsCell = (r, i) => {
    if (r.holidays[i]) return <span className="oc-call-holiday">{r.holidays[i]}</span>
    if (!isAdmin) return r.calls[i]
    return (
      <>
        <select
          value={r.rostered[i]}
          onChange={e => assignCalls(r.week, i, e.target.value)}
          aria-label={`Customer calls, ${WEEK_DAYS[i]} ${dayMonth(weekDates(r.week)[i])}`}
        >
          <option value="">Unassigned</option>
          {engineers.map(u => <option key={u.uid} value={u.uid}>{names.get(u.uid)}</option>)}
        </select>
        {!!r.extra[i].length && <span className="oc-call-extra">also {r.extra[i].join(', ')}</span>}
      </>
    )
  }

  const loading = usersLoading || schedLoading

  return (
    <div className="page">
      <div className="page-head-text">
        <h1 className="page-title">On-call roster</h1>
        <span className="page-sub">
          {isAdmin
            ? 'One engineer on call per week, and who covers customer calls each day — both set here.'
            : 'One engineer on call per week, plus who covers customer calls each day.'}
        </span>
      </div>

      {blocked && isAdmin && (
        <Alert tone="warning" icon={<ShieldAlert size={20} />} title="Roster not switched on yet">
          The database rules need updating before on-call can be saved — publish the latest <code>firestore.rules</code> in the Firebase Console (Firestore → Rules).
        </Alert>
      )}

      {loading ? <Loading /> : (
        <>
          <div className="oc-table">
            <div className="oc-cols oc-headrow">
              <div>Week starting</div>
              <div>On call</div>
              {WEEK_DAYS.map(d => <div key={d} className="calls-head">{d} calls</div>)}
              <div>Status</div>
            </div>
            {rows.map(r => (
              <div key={r.week} className={`oc-cols oc-row${r.week === thisWeek ? ' current' : ''}`}>
                <div className="oc-week">
                  <span className="oc-week-label">{dayMonth(r.week)}</span>
                  <span className="oc-week-range">{r.range}</span>
                </div>
                <div className={`oc-who${r.current?.uid ? ' assigned' : ''}`}>{who(r)}</div>
                {WEEK_DAYS.map((_, i) => <div key={i} className="oc-call">{callsCell(r, i)}</div>)}
                <div className="oc-status"><Badge tone={r.tone}>{r.status}</Badge></div>
              </div>
            ))}
          </div>

          <div className="oc-cards">
            {rows.map(r => (
              <div key={r.week} className={`oc-card${r.week === thisWeek ? ' current' : ''}`}>
                <div className="oc-card-head">
                  <div className="oc-week">
                    <span className="oc-week-label">{dayMonth(r.week)}{r.week === thisWeek ? ' · this week' : ''}</span>
                    <span className="oc-week-range">{r.range}</span>
                  </div>
                  <Badge tone={r.tone}>{r.status}</Badge>
                </div>
                <div className={`oc-card-body${r.current?.uid ? ' assigned' : ''}`}>{who(r)}</div>
                <div className="oc-card-calls">
                  {isAdmin ? (
                    <div className="oc-call-grid">
                      {WEEK_DAYS.map((_, i) => (
                        <label key={i} className="oc-call-pick">
                          <span className="oc-call-day">{DAY_SHORT[i]} calls</span>
                          {callsCell(r, i)}
                        </label>
                      ))}
                    </div>
                  ) : `Calls: ${r.calls.map((c, i) => `${DAY_SHORT[i]} ${c}`).join(' · ')}`}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Toast message={toast} />
    </div>
  )
}
