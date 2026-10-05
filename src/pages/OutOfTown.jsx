import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { Download } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { scheduleId, dayMonth } from '../utils/week'
import { AUCKLAND_PLACES, awayDays, parsePlaces, quarterSlices, recentQuarters, tripLabel, tripsOf } from '../utils/outOfTown'
import { downloadFbtReport, fbtReport } from '../utils/fbtReport'
import Toast, { useToast } from '../components/Toast'
import { Button, Loading } from '../components/ui'

const VEHICLE_KEY = 'css_oot_vehicle'
const AUCKLAND_KEY = 'css_oot_auckland'
const DEFAULT_AUCKLAND = AUCKLAND_PLACES.join(', ')

/** A string kept in this browser, so the vehicle and the Auckland list are typed once. */
function useRemembered(key, fallback) {
  const [value, setValue] = useState(() => { try { return localStorage.getItem(key) ?? fallback } catch { return fallback } })
  const set = next => {
    setValue(next)
    try { localStorage.setItem(key, next) } catch { /* private mode — it just won't be remembered */ }
  }
  return [value, set]
}

/**
 * The quarterly FBT vehicle report: the days spent out of Auckland, worked out from
 * the signed-in person's schedule, grouped into trips to check, then downloaded as
 * the text report the managers get. A day at a site inside Auckland isn't out of town.
 */
export default function OutOfTown() {
  const { user } = useAuth()
  const quarters = useMemo(() => recentQuarters(8), [])
  const [quarterIdx, setQuarterIdx] = useState(0)
  const [vehicle, setVehicle] = useRemembered(VEHICLE_KEY, '')
  const [aucklandText, setAucklandText] = useRemembered(AUCKLAND_KEY, DEFAULT_AUCKLAND)
  const [schedules, setSchedules] = useState(null) // { [weekStart]: days }
  const [edits, setEdits] = useState({})           // { [trip id]: { include?, notes? } }
  const [toast, showToast] = useToast()

  const quarter = quarters[quarterIdx]
  const slices = useMemo(() => quarterSlices(quarter), [quarter])
  const weekStarts = useMemo(() => slices.map(s => s.weekStart), [slices])
  const aucklandPlaces = useMemo(() => parsePlaces(aucklandText), [aucklandText])

  useEffect(() => {
    let cancelled = false
    setSchedules(null)
    setEdits({})
    Promise.all(weekStarts.map(w => getDoc(doc(db, 'schedules', scheduleId(w, user.uid))).then(s => [w, s.exists() ? s.data().days : null])))
      .then(entries => { if (!cancelled) setSchedules(Object.fromEntries(entries)) })
      .catch(e => { console.error(e); if (!cancelled) setSchedules({}) })
    return () => { cancelled = true }
  }, [weekStarts, user.uid])

  const { away, skipped } = useMemo(() => awayDays(slices, schedules, { aucklandPlaces }), [slices, schedules, aucklandPlaces])
  const rows = useMemo(() => tripsOf(away).map(t => {
    const id = `${t.dates[0]}|${t.key}`
    const e = edits[id] || {}
    return { ...t, id, include: e.include ?? true, text: e.notes ?? t.notes }
  }), [away, edits])
  const counted = rows.filter(r => r.include)
  const total = counted.reduce((n, r) => n + r.dates.length, 0)
  const report = fbtReport({ vehicle: vehicle.trim(), quarter, trips: counted.map(r => ({ notes: r.text.trim(), dates: r.dates })) })

  const edit = (id, patch) => setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  /** "It's in Auckland" — remember the place so it's skipped from now on. */
  function markAuckland(places) {
    const known = new Set(aucklandPlaces.map(p => p.toLowerCase()))
    const added = places.filter(p => !known.has(p.toLowerCase()))
    if (!added.length) return
    setAucklandText([...aucklandPlaces, ...added].join(', '))
    showToast(`${added.join(', ')} will count as Auckland from now on.`)
  }

  function download() {
    try {
      downloadFbtReport({ quarter, text: report })
    } catch (e) {
      console.error(e)
      showToast('Could not save the report — try again.')
    }
  }

  return (
    <div className="page oot-page">
      <div className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">Out of town</h1>
          <span className="page-sub">
            Days you were away from Auckland, worked out from your schedule. Check them, then download the FBT vehicle report for your manager.
          </span>
        </div>
      </div>

      <div className="oot-controls">
        <label className="field">
          <span className="field-label">Quarter</span>
          <select value={quarterIdx} onChange={e => setQuarterIdx(Number(e.target.value))}>
            {quarters.map((q, i) => <option key={q.label} value={i}>{q.label}{i === 0 ? ' (this quarter)' : ''}</option>)}
          </select>
        </label>
        <label className="field oot-vehicle">
          <span className="field-label">Vehicle</span>
          <input className="input" value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="e.g. 2025 Toyota RAV4 (ABC123)" />
        </label>
        <Button
          className="oot-download"
          iconLeft={<Download size={18} />}
          onClick={download}
          disabled={!schedules || !vehicle.trim()}
          title={vehicle.trim() ? undefined : 'Enter the vehicle first — it’s printed on the report'}
        >
          Download report
        </Button>
      </div>

      <p className="oot-note">
        {quarter.label} is {dayMonth(quarter.from)} to {dayMonth(quarter.to)}, counted by the date of each day. A day at a site in Auckland — NSH, Waitakere and so on — isn’t out of town, so it isn’t counted.
        The vehicle is printed on the report and remembered on this computer.
      </p>

      {!schedules ? <Loading /> : (
        <>
          <div className="card oot-table" role="table" aria-label={`Days out of Auckland, ${quarter.label}`}>
            <div className="oot-row oot-head" role="row">
              <span role="columnheader" />
              <span role="columnheader">Dates</span>
              <span role="columnheader">Days</span>
              <span role="columnheader">Notes</span>
              <span role="columnheader" />
            </div>
            {!rows.length && <div className="oot-empty" role="row">No days out of Auckland in {quarter.label}.</div>}
            {rows.map(r => (
              <div key={r.id} className={`oot-row${r.include ? '' : ' oot-off'}`} role="row">
                <span role="cell">
                  <input
                    type="checkbox"
                    className="oot-check"
                    checked={r.include}
                    aria-label={`Include ${tripLabel(r.dates)}`}
                    onChange={e => edit(r.id, { include: e.target.checked })}
                  />
                </span>
                <span role="cell" className="oot-week">{tripLabel(r.dates)}</span>
                <span role="cell" className="oot-count">{r.dates.length}</span>
                <span role="cell">
                  <input
                    className="input"
                    aria-label={`Notes, ${tripLabel(r.dates)}`}
                    value={r.text}
                    onChange={e => edit(r.id, { notes: e.target.value })}
                  />
                </span>
                <span role="cell">
                  <button type="button" className="link-btn" title="Count this place as Auckland from now on" onClick={() => markAuckland(r.places)}>It’s in Auckland</button>
                </span>
              </div>
            ))}
            <div className="oot-row oot-total" role="row">
              <span role="cell" />
              <span role="cell">Total</span>
              <span role="cell" className="oot-count">{total}</span>
              <span role="cell">{total === 1 ? 'day' : 'days'} out of town in {quarter.label}</span>
              <span role="cell" />
            </div>
          </div>

          <details className="excel-details oot-details">
            <summary>In Auckland, not counted ({skipped.length} {skipped.length === 1 ? 'day' : 'days'})</summary>
            {skipped.length
              ? <ul>{skipped.map(s => <li key={s.iso}>{tripLabel([s.iso])} — {s.places.join(', ')}</li>)}</ul>
              : <p className="oot-hint">No days at a site inside Auckland this quarter.</p>}
          </details>

          <details className="excel-details oot-details">
            <summary>Places that count as Auckland</summary>
            <p className="oot-hint">A day at one of these isn’t out of town; anywhere not listed is. Separate them with commas.</p>
            <textarea
              className="input"
              rows={5}
              aria-label="Places that count as Auckland"
              value={aucklandText}
              onChange={e => setAucklandText(e.target.value)}
            />
            <button type="button" className="link-btn" onClick={() => setAucklandText(DEFAULT_AUCKLAND)}>Reset to the standard list</button>
          </details>

          <details className="excel-details oot-details">
            <summary>Preview the report</summary>
            <pre className="oot-preview">{report}</pre>
          </details>
        </>
      )}

      <Toast message={toast} />
    </div>
  )
}
