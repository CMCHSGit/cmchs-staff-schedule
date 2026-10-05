import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { Download, TriangleAlert } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { dayMonth } from '../utils/week'
import { AUCKLAND_PLACES, awayDays, chooseSchedules, parsePlaces, quarterSlices, readDays, recentQuarters, reportDays, reportNotes, reportTrips, tripLabel, tripsOf, updateEdits, withEdits } from '../utils/outOfTown'
import { downloadFbtReport, fbtReport } from '../utils/fbtReport'
import Toast, { useToast } from '../components/Toast'
import { Alert, Badge, Button, Loading } from '../components/ui'

const VEHICLE_KEY = 'css_oot_vehicle'
const AUCKLAND_KEY = 'css_oot_auckland'
const TRIPS_KEY = 'css_oot_trips'
const DEFAULT_AUCKLAND = AUCKLAND_PLACES.join(', ')
const VERDICT = { away: 'Out of town', auckland: 'In Auckland', service: 'Car service/repair', no: 'Not on the report', blank: '' }
const KIND_BADGE = { auckland: { tone: 'neutral', label: 'In Auckland' }, service: { tone: 'orange', label: 'Service / repair' } }

/** What was typed against each record last time, so the notes are written once and kept. */
function loadEdits() {
  try {
    const saved = JSON.parse(localStorage.getItem(TRIPS_KEY) || '{}')
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  } catch { return {} }
}

/** A text box that grows to fit what's typed, so a whole line about the job stays in view. It is always one line on the report. */
function NotesBox({ value, onChange, label, placeholder }) {
  const ref = useRef(null)
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px` // the text, plus the border
  }
  useLayoutEffect(fit, [value])
  // Lines wrap differently when the box gets wider or narrower, so fit it again then too.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.offsetWidth
    const watch = new ResizeObserver(() => { if (el.offsetWidth !== width) { width = el.offsetWidth; fit() } })
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  return (
    <textarea
      ref={ref}
      rows={1}
      className="input"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value.replace(/\s*\n\s*/g, ' '))}
      onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
    />
  )
}

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
  const [copies, setCopies] = useState([])         // weeks stored more than once: [[weekStart, [ids]]]
  const [edits, setEdits] = useState(loadEdits)    // { [trip id]: { include?, notes? } } — saved as it changes
  const [toast, showToast] = useToast()

  const quarter = quarters[quarterIdx]
  const slices = useMemo(() => quarterSlices(quarter), [quarter])
  const aucklandPlaces = useMemo(() => parsePlaces(aucklandText), [aucklandText])

  // Read this person's weeks the way Team week does — by the uid saved inside each one —
  // so what the report counts is always what Team week shows.
  useEffect(() => {
    let cancelled = false
    setSchedules(null)
    getDocs(query(collection(db, 'schedules'), where('uid', '==', user.uid)))
      .then(snap => {
        if (cancelled) return
        const chosen = chooseSchedules(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setSchedules(chosen.schedules)
        setCopies(chosen.copies)
      })
      .catch(e => { console.error(e); if (!cancelled) { setSchedules({}); setCopies([]) } })
    return () => { cancelled = true }
  }, [quarter, user.uid])

  const days = useMemo(() => awayDays(slices, schedules, { aucklandPlaces }), [slices, schedules, aucklandPlaces])
  const read = useMemo(() => readDays(slices, schedules, { aucklandPlaces }), [slices, schedules, aucklandPlaces])
  const storedTwice = copies.filter(([w]) => slices.some(s => s.weekStart === w))
  const rows = useMemo(() => withEdits(tripsOf(reportDays(days)), edits), [days, edits])
  const aucklandRows = rows.filter(r => r.kind === 'auckland')
  const total = rows.filter(r => r.include).reduce((n, r) => n + r.dates.length, 0)
  const report = fbtReport({ vehicle: vehicle.trim(), quarter, trips: reportTrips(rows) })

  // Saved as it changes (in this browser), so nothing typed is lost on a reload or a change of quarter.
  useEffect(() => {
    try { localStorage.setItem(TRIPS_KEY, JSON.stringify(edits)) } catch { /* private mode — it just won't be remembered */ }
  }, [edits])
  const edit = (row, patch) => setEdits(prev => updateEdits(prev, row, patch))
  /** Tick or untick every record at a site in Auckland at once. */
  const tickAuckland = include => setEdits(prev => aucklandRows.reduce((all, row) => updateEdits(all, row, { include }), prev))

  /** "It's in Auckland" — remember the place, so it's flagged as Auckland from now on. */
  function markAuckland(places) {
    const known = new Set(aucklandPlaces.map(p => p.toLowerCase()))
    const added = places.filter(p => !known.has(p.toLowerCase()))
    if (!added.length) return
    setAucklandText([...aucklandPlaces, ...added].join(', '))
    showToast(`${added.join(', ')} will be flagged as Auckland from now on.`)
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
            Days at a site, or with the car in for service or repair, worked out from your schedule. Check them, then download the FBT vehicle report for your manager.
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
        {quarter.label} is {dayMonth(quarter.from)} to {dayMonth(quarter.to)}, counted by the date of each day. Days at a site in Auckland — NSH, Waitakere and so on — are listed too, flagged “In Auckland”, and go in the report unless you untick them.
      </p>
      <p className="oot-note">
        To add a day the car was in for a service or repair, write “car service” or “car repair” in that day’s location in your schedule. Put what you did in each record’s Additional notes — the report prints the location and the additional notes together.
        The vehicle, notes and ticks are saved as you type, on this computer.
      </p>

      {!schedules ? <Loading /> : (
        <>
          {storedTwice.length > 0 && (
            <Alert tone="warning" icon={<TriangleAlert size={20} />} title="A week is stored more than once">
              {storedTwice.map(([w]) => `Week of ${dayMonth(w)}`).join(', ')} — the most recently saved copy was used. “What was read from your schedule” below shows which.
            </Alert>
          )}
          {aucklandRows.length > 0 && (
            <p className="oot-hint oot-bulk">
              {aucklandRows.length} {aucklandRows.length === 1 ? 'record is' : 'records are'} at a site in Auckland.
              <button type="button" className="link-btn" onClick={() => tickAuckland(false)}>Untick them all</button>
              <button type="button" className="link-btn" onClick={() => tickAuckland(true)}>Tick them all</button>
            </p>
          )}
          <div className="card oot-table" role="table" aria-label={`Days on the report, ${quarter.label}`}>
            <div className="oot-row oot-head" role="row">
              <span role="columnheader" />
              <span role="columnheader">Dates</span>
              <span role="columnheader">Days</span>
              <span role="columnheader">Location</span>
              <span role="columnheader">Additional notes</span>
              <span role="columnheader" />
            </div>
            {!rows.length && <div className="oot-empty" role="row">No days at a site, or with the car in for service or repair, in {quarter.label}.</div>}
            {rows.map(r => (
              <div key={r.id} className={`oot-row${r.include ? '' : ' oot-off'}`} role="row">
                <span role="cell">
                  <input
                    type="checkbox"
                    className="oot-check"
                    checked={r.include}
                    aria-label={`Include ${tripLabel(r.dates)}`}
                    onChange={e => edit(r, { include: e.target.checked })}
                  />
                </span>
                <span role="cell" className="oot-week">
                  {tripLabel(r.dates)}
                  {KIND_BADGE[r.kind] && <Badge tone={KIND_BADGE[r.kind].tone}>{KIND_BADGE[r.kind].label}</Badge>}
                </span>
                <span role="cell" className="oot-count">{r.dates.length}</span>
                <span role="cell" className="oot-notes-cell">
                  <NotesBox label={`Location, ${tripLabel(r.dates)}`} placeholder="Where" value={r.text} onChange={notes => edit(r, { notes })} />
                  {r.text !== r.notes && (
                    <span className="oot-from">
                      From your schedule: {r.notes}
                      <button type="button" className="link-btn" onClick={() => edit(r, { notes: undefined })}>Use this</button>
                    </span>
                  )}
                </span>
                <span role="cell" className="oot-notes-cell">
                  <NotesBox label={`Additional notes, ${tripLabel(r.dates)}`} placeholder="What you did, e.g. DOR install" value={r.details} onChange={details => edit(r, { details })} />
                  {r.details.trim() && <span className="oot-from">On the report: {reportNotes(r)}</span>}
                </span>
                <span role="cell">
                  {r.kind === 'away' && (
                    <button type="button" className="link-btn" title="Flag this place as Auckland from now on" onClick={() => markAuckland(r.places)}>It’s in Auckland</button>
                  )}
                </span>
              </div>
            ))}
            <div className="oot-row oot-total" role="row">
              <span role="cell" />
              <span role="cell">Total</span>
              <span role="cell" className="oot-count">{total}</span>
              <span role="cell" className="oot-total-text">{total === 1 ? 'day' : 'days'} on the report for {quarter.label}</span>
            </div>
          </div>

          <details className="excel-details oot-details">
            <summary>What was read from your schedule</summary>
            <p className="oot-hint">
              {read.filter(w => w.saved).length} of {read.length} weeks in {quarter.label} have a saved schedule. Each day shows what was found there and how it was counted.
            </p>
            {storedTwice.map(([w, ids]) => (
              <p key={w} className="oot-hint">Week of {dayMonth(w)} is saved {ids.length} times ({ids.join(', ')}) — the most recently saved was used.</p>
            ))}
            <div className="oot-read">
              {read.map(w => (
                <div key={w.weekStart} className="oot-read-week">
                  <div className="oot-read-head">Week of {dayMonth(w.weekStart)}{!w.saved && ' — nothing saved'}</div>
                  {w.days.map(d => (
                    <div key={d.iso} className={`oot-read-day oot-v-${d.verdict}`}>
                      <span>{tripLabel([d.iso])}</span>
                      <span>{d.text || '—'}</span>
                      <span>{VERDICT[d.verdict]}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>

          <details className="excel-details oot-details">
            <summary>Places that count as Auckland</summary>
            <p className="oot-hint">A record at one of these is flagged “In Auckland”, so it’s easy to untick; anywhere not listed is out of town. Separate them with commas.</p>
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
