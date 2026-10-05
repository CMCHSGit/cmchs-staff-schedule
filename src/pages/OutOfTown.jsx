import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { Download } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { useUsers } from '../hooks/useScheduleData'
import { shortNames } from '../utils/names'
import { scheduleId, normalizeSchedule, fromISO, dayMonth } from '../utils/week'
import { recentQuarters, quarterSlices, partLabel, summariseWeek } from '../utils/outOfTown'
import { downloadOutOfTown } from '../utils/outOfTownExcel'
import Toast, { useToast } from '../components/Toast'
import { Button, Loading, Switch } from '../components/ui'

const ddmmyyyy = iso => { const d = fromISO(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` }

/**
 * Quarterly out-of-town days, worked out from someone's schedule — pick the
 * quarter, check (or tweak) each week, download the Excel to send on.
 * Everyone sees their own; admins can pick anyone.
 */
export default function OutOfTown() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const quarters = useMemo(() => recentQuarters(8), [])
  const [quarterIdx, setQuarterIdx] = useState(0)
  const [uid, setUid] = useState(user.uid)
  const [countLeave, setCountLeave] = useState(false)
  const [schedules, setSchedules] = useState(null) // { [weekStart]: days }
  const [edits, setEdits] = useState({})           // { [weekStart]: { days?, reason? } }
  const [downloading, setDownloading] = useState(false)
  const [toast, showToast] = useToast()

  const { users } = useUsers()
  const names = useMemo(() => shortNames(users), [users])
  const people = useMemo(() => [...users].sort((a, b) => (names.get(a.uid) || '').localeCompare(names.get(b.uid) || '')), [users, names])
  const quarter = quarters[quarterIdx]
  const slices = useMemo(() => quarterSlices(quarter), [quarter])
  const weekStarts = useMemo(() => slices.map(s => s.weekStart), [slices])
  const personName = (users.find(u => u.uid === uid)?.displayName) || profile?.displayName || user.displayName || 'Me'

  useEffect(() => {
    let cancelled = false
    setSchedules(null)
    setEdits({})
    Promise.all(weekStarts.map(w => getDoc(doc(db, 'schedules', scheduleId(w, uid))).then(s => [w, s.exists() ? s.data().days : null])))
      .then(entries => { if (!cancelled) setSchedules(Object.fromEntries(entries)) })
      .catch(e => { console.error(e); if (!cancelled) setSchedules({}) })
    return () => { cancelled = true }
  }, [weekStarts, uid])

  // Leave counting changes the automatic figures — drop hand edits with it.
  useEffect(() => setEdits({}), [countLeave])

  // One row per week the quarter touches. A week that crosses the quarter's edge
  // only counts the days inside it (`only`); the rest belong to the neighbouring quarter.
  const rows = slices.map(s => {
    const auto = summariseWeek(normalizeSchedule(schedules?.[s.weekStart]), { countLeave, only: s.indices, weekStart: s.weekStart })
    const e = edits[s.weekStart] || {}
    return {
      weekStart: s.weekStart,
      start: s.start,
      part: partLabel(s.indices),
      maxDays: s.indices.length,
      days: e.days ?? auto.days,
      reason: e.reason ?? auto.reason,
      edited: !!edits[s.weekStart],
    }
  })
  const total = rows.reduce((n, r) => n + (Number(r.days) || 0), 0)
  const edit = (w, field, value) => setEdits(prev => ({ ...prev, [w]: { ...prev[w], [field]: value } }))

  async function download() {
    setDownloading(true)
    try {
      await downloadOutOfTown({ person: names.get(uid) || personName, quarter, rows })
    } catch (e) {
      console.error(e)
      showToast('Could not make the Excel file — try again.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="page oot-page">
      <div className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">Out of town</h1>
          <span className="page-sub">
            Days at a site or on a course, counted from the schedule. Check each week, change anything that’s off, then download the Excel for your manager.
          </span>
        </div>
      </div>

      <div className="oot-controls">
        <label className="field">
          <span className="field-label">Quarter</span>
          <select value={quarterIdx} onChange={e => setQuarterIdx(Number(e.target.value))}>
            {quarters.map((q, i) => <option key={q.label} value={i}>{q.title}{i === 0 ? ' (this quarter)' : ''}</option>)}
          </select>
        </label>
        {isAdmin && (
          <label className="field">
            <span className="field-label">Person</span>
            <select value={uid} onChange={e => setUid(e.target.value)}>
              {people.map(u => <option key={u.uid} value={u.uid}>{names.get(u.uid)}{u.uid === user.uid ? ' (me)' : ''}</option>)}
            </select>
          </label>
        )}
        <Switch checked={countLeave} onChange={setCountLeave} label="Count leave days" />
        <Button className="oot-download" iconLeft={<Download size={18} />} onClick={download} disabled={!schedules || downloading}>
          {downloading ? 'Preparing…' : 'Download Excel'}
        </Button>
      </div>

      <p className="oot-note">
        Counted by the date of each day: {quarter.title} is {dayMonth(quarter.from)} to {dayMonth(quarter.to)}.
        {slices.some(s => s.indices.length < 5) && ' A week that runs over either end is split, so every day is counted in one quarter only.'}
      </p>

      {!schedules ? <Loading /> : (
        <div className="card oot-table" role="table" aria-label={`Out-of-town days, ${quarter.title}`}>
          <div className="oot-row oot-head" role="row">
            <span role="columnheader">Week starting</span>
            <span role="columnheader">Days</span>
            <span role="columnheader">Out of town reason</span>
          </div>
          {rows.map(r => (
            <div key={r.weekStart} className={`oot-row${r.days ? '' : ' oot-zero'}`} role="row">
              <span role="cell" className="oot-week">
                {ddmmyyyy(r.start)}
                {r.part && <span className="oot-part" title={`Only ${r.part} of the week of ${dayMonth(r.weekStart)} falls in ${quarter.title}`}>{r.part} only</span>}
                {r.edited && <span className="oot-edited">edited</span>}
              </span>
              <span role="cell">
                <input
                  className="input oot-days"
                  type="number"
                  min="0"
                  max={r.maxDays}
                  inputMode="numeric"
                  aria-label={`Days, week of ${ddmmyyyy(r.start)}`}
                  value={r.days}
                  onChange={e => edit(r.weekStart, 'days', e.target.value === '' ? '' : Math.max(0, Math.min(r.maxDays, Number(e.target.value))))}
                />
              </span>
              <span role="cell">
                <input
                  className="input"
                  aria-label={`Reason, week of ${ddmmyyyy(r.start)}`}
                  value={r.reason}
                  placeholder="—"
                  onChange={e => edit(r.weekStart, 'reason', e.target.value)}
                />
              </span>
            </div>
          ))}
          <div className="oot-row oot-total" role="row">
            <span role="cell">Total</span>
            <span role="cell">{total}</span>
            <span role="cell">{total === 1 ? 'day' : 'days'} out of town in {quarter.title}</span>
          </div>
        </div>
      )}

      <Toast message={toast} />
    </div>
  )
}
