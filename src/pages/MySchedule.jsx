import { useState, useEffect, useCallback } from 'react'
import { doc, getDoc, setDoc, addDoc, serverTimestamp, collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { getCurrentWeekStart, weekLabel, WEEK_DAYS, emptySchedule, scheduleId, normalizeSchedule, DEFAULT_LOCATION } from '../utils/week'
import { getTeamConfig, quickFillsForTeam } from '../utils/teams'
import { canUsePush, needsHomeScreenInstall, pushEnabledOnThisDevice, enablePush, onForegroundMessage } from '../utils/push'
import WeekNav from '../components/WeekNav'
import Toast   from '../components/Toast'
import LocationCombobox from '../components/LocationCombobox'

const MAX_WEEKS_AHEAD = 2
const MAX_WEEKS_BACK  = 4

export default function MySchedule() {
  const { user, profile } = useAuth()
  const team = profile?.team
  const teamCfg = getTeamConfig(team)

  const [weekOffset,  setWeekOffset]  = useState(0)
  const [schedule,    setSchedule]    = useState(() => emptySchedule())
  const [comments,    setComments]    = useState('')
  const [savedAt,     setSavedAt]     = useState(null)
  const [locations,   setLocations]   = useState([])
  const [pendingLocations, setPendingLocations] = useState([]) // typed this session, not yet in Firestore
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [toast,       setToast]       = useState(null)
  const [pushEnabled, setPushEnabled] = useState(pushEnabledOnThisDevice)
  const [enablingPush, setEnablingPush] = useState(false)

  const weekStart = getCurrentWeekStart(weekOffset)

  useEffect(() => {
    let unsubscribe = () => {}
    onForegroundMessage(({ title, body }) => showToast(body || title || 'New reminder')).then(fn => { unsubscribe = fn })
    return () => unsubscribe()
  }, [])

  async function handleEnablePush() {
    if (!user) return
    setEnablingPush(true)
    try {
      await enablePush(user.uid)
      setPushEnabled(true)
      showToast('Reminders on ✓')
    } catch (e) {
      showToast(e.message || 'Could not enable reminders')
    } finally {
      setEnablingPush(false)
    }
  }

  useEffect(() => {
    async function loadLocations() {
      const q = query(
        collection(db, 'locations'),
        where('active', '==', true),
        orderBy('order')
      )
      const snap = await getDocs(q)
      setLocations(snap.docs.map(d => d.data().name))
    }
    loadLocations()
  }, [])

  const loadSchedule = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const ref  = doc(db, 'schedules', scheduleId(weekStart, user.uid))
      const snap = await getDoc(ref)
      if (snap.exists()) {
        const data = snap.data()
        setSchedule(normalizeSchedule(data.days))
        setComments(data.comments || '')
        setSavedAt(data.submittedAt?.toDate())
      } else {
        setSchedule(emptySchedule())
        setComments('')
        setSavedAt(null)
      }
    } finally {
      setLoading(false)
    }
  }, [user, weekStart, team])

  useEffect(() => { loadSchedule() }, [loadSchedule])

  function updateDay(dayIdx, value) {
    setSchedule(prev => {
      const next = prev.map(d => ({ ...d }))
      next[dayIdx] = { location: value }
      return next
    })
  }

  function fillAllDays(value) {
    setSchedule(WEEK_DAYS.map(() => ({ location: value })))
  }

  const locationOptions = [
    ...new Set([
      ...(teamCfg?.defaultLocation ? [teamCfg.defaultLocation] : []),
      DEFAULT_LOCATION,
      ...locations,
      ...schedule.map(d => d.location).filter(Boolean),
    ]),
  ]

  const quickFills = quickFillsForTeam(team, locations)

  function registerNewLocation(name) {
    const isKnown = l => l.toLowerCase() === name.toLowerCase()
    setLocations(prev => prev.some(isKnown) ? prev : [...prev, name])
    setPendingLocations(prev => prev.some(isKnown) ? prev : [...prev, name])
  }

  /** Anything typed this session that isn't in Firestore yet becomes a shared option for everyone. */
  async function persistPendingLocations() {
    if (pendingLocations.length === 0) return
    try {
      await Promise.all(pendingLocations.map(name => addDoc(collection(db, 'locations'), {
        name, order: Date.now(), active: true, createdAt: serverTimestamp(),
      })))
      setPendingLocations([])
    } catch (e) {
      // Don't let a failure to register a new location block saving the actual schedule.
      console.error('Failed to save new location(s):', e)
    }
  }

  async function saveSchedule() {
    if (!user) return
    setSaving(true)
    try {
      await persistPendingLocations()
      const ref = doc(db, 'schedules', scheduleId(weekStart, user.uid))
      await setDoc(ref, {
        uid:         user.uid,
        displayName: profile?.displayName || user.displayName,
        email:       user.email,
        team:        profile?.team || null,
        weekStart,
        days:        schedule,
        comments:    comments.trim(),
        submittedAt: serverTimestamp(),
      })
      setSavedAt(new Date())
      showToast('Schedule saved ✓')
    } catch (e) {
      showToast('Save failed — try again')
    } finally {
      setSaving(false)
    }
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const isComplete = schedule.every(d => d.location)

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">My schedule</div>
          <div className="topbar-sub">
            {team ? `${team} team` : 'Set your team on first visit'}
            {teamCfg?.hint && <> · {teamCfg.hint}</>}
          </div>
          {savedAt && (
            <div className="topbar-sub" style={{ marginTop: 2 }}>
              Saved {savedAt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
        <span className={`pill ${isComplete ? 'pill-submitted' : 'pill-pending'}`}>
          {isComplete ? 'Complete' : 'Incomplete'}
        </span>
      </div>

      <WeekNav
        label={weekLabel(weekStart)}
        onPrev={() => setWeekOffset(w => w - 1)}
        onNext={() => setWeekOffset(w => w + 1)}
        canPrev={weekOffset > -MAX_WEEKS_BACK}
        canNext={weekOffset < MAX_WEEKS_AHEAD}
      />

      {!pushEnabled && needsHomeScreenInstall() && (
        <div className="card" style={{ padding: 14, margin: '10px 16px' }}>
          <p className="text-sm" style={{ lineHeight: 1.5 }}>
            🔔 Add this app to your Home Screen to get a reminder here when your schedule is due
            — tap <strong>Share</strong> → <strong>Add to Home Screen</strong> in Safari.
          </p>
        </div>
      )}

      {!pushEnabled && !needsHomeScreenInstall() && canUsePush() && (
        <div className="card" style={{ padding: 14, margin: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <p className="text-sm" style={{ lineHeight: 1.4 }}>
            Get a reminder on this phone before your schedule is due.
          </p>
          <button className="btn btn-sm" onClick={handleEnablePush} disabled={enablingPush} style={{ flexShrink: 0 }}>
            {enablingPush ? '…' : '🔔 Enable'}
          </button>
        </div>
      )}

      {quickFills.length > 0 && (
        <div style={{ padding: '10px 16px 4px', display: 'flex', gap: 8, overflowX: 'auto', flexWrap: 'wrap' }}>
          <span className="text-sm text-muted" style={{ flexShrink: 0, lineHeight: '28px' }}>Fill all:</span>
          {quickFills.map(loc => (
            <button key={loc} className="btn btn-sm" onClick={() => fillAllDays(loc)}>
              {loc}
            </button>
          ))}
        </div>
      )}

      <div className="schedule-panel">
        <div style={{ paddingTop: 8 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <div className="spinner" />
            </div>
          ) : (
            WEEK_DAYS.map((day, i) => {
              const date = new Date(weekStart + 'T00:00:00')
              date.setDate(date.getDate() + i)
              const dateLabel = date.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
              const value = schedule[i]?.location ?? ''

              return (
                <div className="card" key={day}>
                  <div className="card-header">
                    <span className="card-day">{day}</span>
                    <span className="card-date">{dateLabel}</span>
                  </div>
                  <div className="card-row card-row-location">
                    <LocationCombobox
                      value={value}
                      options={locationOptions}
                      onChange={val => updateDay(i, val)}
                      onNewValue={registerNewLocation}
                    />
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="comments-section">
          <label className="comments-label" htmlFor="week-comments">Comments</label>
          <p className="text-sm text-muted" style={{ marginBottom: 8, lineHeight: 1.4 }}>
            e.g. returning from leave, client visits, or anything the team should know this week.
          </p>
          <textarea
            id="week-comments"
            className="input comments-input"
            rows={3}
            placeholder="Optional notes for the week…"
            value={comments}
            onChange={e => setComments(e.target.value)}
          />
        </div>

        <div style={{ padding: '0 16px 24px' }}>
          <button
            className="btn btn-primary btn-full"
            style={{ padding: 13, fontSize: 15 }}
            onClick={saveSchedule}
            disabled={saving}
          >
            {saving ? <span className="spinner" style={{ width: 18, height: 18, borderTopColor: 'var(--bg)' }} /> : 'Save & share schedule'}
          </button>
        </div>
      </div>

      {toast && <Toast message={toast} />}
    </>
  )
}
