import { useState, useEffect, useCallback } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { Bell, Share, Phone, Info, CalendarClock } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { getCurrentWeekStart, weekDates, toISO, WEEK_DAYS, dayMonth, emptySchedule, scheduleId, normalizeSchedule, DEFAULT_LOCATION } from '../utils/week'
import { holidayOn } from '../utils/holidays'
import { describeDay } from '../utils/status'
import { getTeamConfig, teamLabel, quickFillsForTeam, doesCustomerCalls } from '../utils/teams'
import { canUsePush, needsHomeScreenInstall, pushEnabledOnThisDevice, enablePush, onForegroundMessage } from '../utils/push'
import { writeSchedule, addNewLocations } from '../utils/scheduleStore'
import { useLocations, useOnCall } from '../hooks/useScheduleData'
import WeekNav from '../components/WeekNav'
import Toast, { useToast } from '../components/Toast'
import LocationCombobox from '../components/LocationCombobox'
import { Alert, Badge, Button, Switch, Tag, Loading, Spinner } from '../components/ui'

export default function MySchedule() {
  const { user, profile } = useAuth()
  const team = profile?.team
  const teamCfg = getTeamConfig(team)

  const [weekOffset,  setWeekOffset]  = useState(0)
  const [schedule,    setSchedule]    = useState(() => emptySchedule())
  const [comments,    setComments]    = useState('')
  const [existing,    setExisting]    = useState(null)
  const [locations,   setLocations]   = useLocations()
  const [pendingLocations, setPendingLocations] = useState([]) // typed this session, not yet in Firestore
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [nextWeekDue, setNextWeekDue] = useState(false)
  const [toast,       showToast]      = useToast()
  const [pushEnabled, setPushEnabled] = useState(pushEnabledOnThisDevice)
  const [enablingPush, setEnablingPush] = useState(false)

  const weekStart = getCurrentWeekStart(weekOffset)
  const dates = weekDates(weekStart)
  const holidays = dates.map(holidayOn)
  const { byWeek: oncall } = useOnCall([weekStart])
  const onCallThisWeek = oncall[weekStart]?.uid === user?.uid
  const showCalls = doesCustomerCalls(team) || schedule.some(d => d.onCall)

  useEffect(() => {
    let unsubscribe = () => {}
    onForegroundMessage(({ title, body }) => showToast(body || title || 'New reminder')).then(fn => { unsubscribe = fn })
    return () => unsubscribe()
  }, [showToast])

  async function handleEnablePush() {
    if (!user) return
    setEnablingPush(true)
    try {
      await enablePush(user.uid)
      setPushEnabled(true)
      showToast('Reminders are on.')
    } catch (e) {
      showToast(e.message || 'Could not turn on reminders.')
    } finally {
      setEnablingPush(false)
    }
  }

  const loadSchedule = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const snap = await getDoc(doc(db, 'schedules', scheduleId(weekStart, user.uid)))
      if (snap.exists()) {
        const data = snap.data()
        setSchedule(normalizeSchedule(data.days))
        setComments(data.comments || '')
        setExisting({ ...data, submittedAt: data.submittedAt?.toDate() })
      } else {
        setSchedule(emptySchedule())
        setComments('')
        setExisting(null)
      }
    } finally {
      setLoading(false)
    }
  }, [user, weekStart])

  useEffect(() => { loadSchedule() }, [loadSchedule])

  // Thursday is when next week's schedule is due (and the reminder goes out) —
  // on Thursday and Friday, nudge toward next week if it isn't filled in yet.
  useEffect(() => {
    const dow = new Date().getDay()
    if (!user || weekOffset !== 0 || (dow !== 4 && dow !== 5)) { setNextWeekDue(false); return }
    getDoc(doc(db, 'schedules', scheduleId(getCurrentWeekStart(1), user.uid)))
      .then(snap => setNextWeekDue(!snap.exists() || !!snap.data().needsConfirm))
      .catch(() => setNextWeekDue(false))
  }, [user, weekOffset])

  function updateDay(dayIdx, patch) {
    setSchedule(prev => prev.map((d, i) => (i === dayIdx ? { ...d, ...patch } : d)))
  }

  /** Public holidays are left alone — they already show as the holiday. */
  function fillAllDays(value) {
    setSchedule(prev => prev.map((d, i) => (holidays[i] ? d : { ...d, location: value })))
  }

  const locationOptions = [
    ...new Set([
      ...(teamCfg?.defaultLocation ? [teamCfg.defaultLocation] : []),
      DEFAULT_LOCATION,
      ...locations,
      ...schedule.map(d => d.location).filter(Boolean),
    ]),
  ]

  function registerNewLocation(name) {
    const isKnown = l => l.toLowerCase() === name.toLowerCase()
    setLocations(prev => prev.some(isKnown) ? prev : [...prev, name])
    setPendingLocations(prev => prev.some(isKnown) ? prev : [...prev, name])
  }

  async function saveSchedule() {
    if (!user) return
    setSaving(true)
    try {
      await addNewLocations(pendingLocations, [])
      setPendingLocations([])
      const person = { uid: user.uid, displayName: profile?.displayName || user.displayName, email: user.email, team }
      const saved = await writeSchedule({ person, weekStart, days: schedule, comments, editorUid: user.uid, existing })
      setExisting(saved)
      showToast('Schedule saved.')
    } catch (e) {
      showToast('Save failed — try again.')
    } finally {
      setSaving(false)
    }
  }

  const isComplete = schedule.every((d, i) => d.location || d.onCall || holidays[i])
  const savedAt = existing?.submittedAt

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">My week</h1>
          <span className="page-sub">
            {team ? `${teamLabel(team)}${teamCfg?.hint ? ` · ${teamCfg.hint}` : ''}` : 'Choose your team to get started'}
          </span>
          {savedAt && (
            <span className="page-sub">
              Saved {dayMonth(toISO(savedAt))}, {savedAt.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
        <Badge tone={isComplete ? 'green' : 'orange'}>{isComplete ? 'Complete' : 'Incomplete'}</Badge>
      </div>

      <WeekNav
        weekStart={weekStart}
        isThisWeek={weekOffset === 0}
        onPrev={() => setWeekOffset(w => w - 1)}
        onNext={() => setWeekOffset(w => w + 1)}
        onThisWeek={() => setWeekOffset(0)}
      />

      {nextWeekDue && (
        <Alert
          tone="warning"
          icon={<CalendarClock size={20} />}
          title="Next week is due"
          action={<Button size="sm" variant="secondary" onClick={() => setWeekOffset(1)}>Fill in</Button>}
        >
          Let the team know where you’ll be from {dayMonth(getCurrentWeekStart(1))}.
        </Alert>
      )}

      {existing?.needsConfirm && (
        <Alert tone="info" icon={<Info size={20} />} title="Filled in for you">
          An admin started this week for you. Check each day, then tap Save to confirm it.
        </Alert>
      )}

      {onCallThisWeek && (
        <div className="oncall-banner"><Phone size={18} aria-hidden="true" />You’re on call this week</div>
      )}

      {!pushEnabled && needsHomeScreenInstall() && (
        <Alert tone="info" icon={<Share size={20} />} title="Get Thursday reminders">
          Add this app to your Home Screen — tap <strong>Share</strong>, then <strong>Add to Home Screen</strong> in Safari.
        </Alert>
      )}

      {!pushEnabled && !needsHomeScreenInstall() && canUsePush() && (
        <Alert
          tone="info"
          icon={<Bell size={20} />}
          title="Get Thursday reminders"
          action={<Button size="sm" onClick={handleEnablePush} disabled={enablingPush}>{enablingPush ? <Spinner size={16} light /> : 'Turn on'}</Button>}
        >
          A nudge on this device before your schedule is due.
        </Alert>
      )}

      <div className="quick-picks">
        <span className="text-sm text-muted">Fill every day:</span>
        {quickFillsForTeam(team).map(loc => (
          <Tag key={loc} onClick={() => fillAllDays(loc)}>{loc}</Tag>
        ))}
      </div>

      {loading ? <Loading /> : (
        <div className="day-cards">
          {WEEK_DAYS.map((day, i) => {
            const value = schedule[i]?.location ?? ''
            const onCall = schedule[i]?.onCall ?? false
            const { bg, fg } = describeDay({ location: value, onCall })
            return (
              <div className="card day-card" key={day}>
                <div className="day-card-head">
                  <span className="day-card-day">{day}</span>
                  <span className="day-card-date">{dayMonth(dates[i])}</span>
                  {holidays[i] && <Badge tone="purple">{holidays[i]}</Badge>}
                </div>
                <LocationCombobox
                  value={value}
                  options={locationOptions}
                  onChange={val => updateDay(i, { location: val })}
                  onNewValue={registerNewLocation}
                  tint={bg}
                  tintFg={fg}
                  placeholder={holidays[i] ? `${holidays[i]} — or type where you’ll be` : undefined}
                />
                {showCalls && (
                  <Switch checked={onCall} onChange={val => updateDay(i, { onCall: val })} label="Customer calls" />
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="field">
        <label className="field-label" htmlFor="week-comments">Comments</label>
        <span className="text-sm text-muted">e.g. back from leave on the 5th, client visits, anything the team should know.</span>
        <textarea
          id="week-comments"
          className="input"
          rows={3}
          placeholder="Optional notes for the week…"
          value={comments}
          onChange={e => setComments(e.target.value)}
        />
      </div>

      <Button size="lg" block onClick={saveSchedule} disabled={saving || loading}>
        {saving ? <Spinner size={20} light /> : 'Save schedule'}
      </Button>

      <Toast message={toast} />
    </div>
  )
}
