import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { FileSpreadsheet, TriangleAlert, Check } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { indexWorkbook, readPeople } from '../utils/excelSchedule'
import { excelPeople, matchPeople, buildMapping, planImport, nameKey } from '../utils/excelPlan'
import { loadExisting, applyImportPlan } from '../utils/excelImportWrite'
import { logActivity } from '../utils/activityLog'
import { getCurrentWeekStart, weekDates, dayMonth, dayMonthYear, DAY_SHORT } from '../utils/week'
import { recentQuarters, quarterWeeks } from '../utils/outOfTown'
import { teamLabel } from '../utils/teams'
import { shortNames } from '../utils/names'
import { Alert, Badge, Button, Loading, Switch } from './ui'

/** Where an import starts from — the end is always the newest sheet. */
const RANGES = [
  { value: 'upcoming', label: 'This week and later', from: () => getCurrentWeekStart(0) },
  { value: 'month',    label: 'From 4 weeks ago',    from: () => getCurrentWeekStart(-4) },
  { value: 'lastq',    label: 'From the start of last quarter', from: () => quarterWeeks(recentQuarters(2)[1])[0] },
  { value: 'year',     label: 'From 12 months ago',  from: () => getCurrentWeekStart(-52) },
  { value: 'all',      label: 'Every week in the file', from: () => '0000-00-00' },
]

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-NZ')} ${n === 1 ? one : many}`
const savedLabel = ms => new Date(ms).toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Admin → Excel: fills the schedule from the company Excel file. Pick the
 * file (it's read in this browser — nothing is uploaded anywhere but the
 * resulting entries), see exactly what would change, then press Import.
 * Nothing is written until then, and nothing in the app is overwritten
 * unless asked (see utils/excelPlan.js for the rules).
 */
export default function ExcelImport() {
  const { user } = useAuth()
  const workbook = useRef(null)          // the parsed file — large, so kept out of React state
  const peopleCache = useRef(new Map())  // weekStart → people read from that sheet

  const [stage, setStage] = useState('idle') // idle | reading | ready | importing
  const [error, setError] = useState('')
  const [file, setFile] = useState(null)     // { name, savedAt }
  const [index, setIndex] = useState(null)   // { weeks: Map, skipped: [] }
  const [users, setUsers] = useState([])
  const [range, setRange] = useState('upcoming')
  const [addNew, setAddNew] = useState(true)
  const [excelWins, setExcelWins] = useState(false)
  const [overrides, setOverrides] = useState({})
  const [existing, setExisting] = useState(null) // what the app already holds for the chosen weeks
  const [progress, setProgress] = useState(null)
  const [done, setDone] = useState(null)

  async function chooseFile(chosen) {
    if (!chosen) return
    setStage('reading'); setError(''); setDone(null); setOverrides({}); setExisting(null)
    try {
      await new Promise(resolve => setTimeout(resolve, 30)) // let "Reading…" appear before the heavy part
      const [{ default: ExcelJS }, usersSnap] = await Promise.all([import('exceljs'), getDocs(collection(db, 'users'))])
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(await chosen.arrayBuffer())
      const found = indexWorkbook(wb)
      if (!found.weeks.size) throw new Error('No weekly schedule sheets were found in that file.')
      workbook.current = wb
      peopleCache.current = new Map()
      setIndex(found)
      setUsers(usersSnap.docs.map(d => ({ uid: d.id, ...d.data() })))
      setFile({ name: chosen.name, savedAt: chosen.lastModified })
      setStage('ready')
    } catch (e) {
      console.error(e)
      setError(`Couldn’t read that file. ${e.message || ''} Choose the staff schedule workbook (.xlsx).`.trim())
      setStage('idle')
    }
  }

  const readWeek = weekStart => {
    if (!peopleCache.current.has(weekStart)) {
      const { ws, layout } = index.weeks.get(weekStart)
      peopleCache.current.set(weekStart, readPeople(ws, layout))
    }
    return peopleCache.current.get(weekStart)
  }

  const allWeeks = useMemo(() => (index ? [...index.weeks.keys()].sort() : []), [index])
  const newestWeek = allWeeks[allWeeks.length - 1]
  const fromWeek = RANGES.find(r => r.value === range).from()
  const selected = useMemo(() => allWeeks.filter(w => w >= fromWeek), [allWeeks, fromWeek])

  const newest = useMemo(() => (index ? readWeek(newestWeek) : []), [index, newestWeek]) 
  const weeksPeople = useMemo(() => new Map(selected.map(w => [w, readWeek(w)])), [selected, index]) 
  const people = useMemo(() => excelPeople(weeksPeople, newest), [weeksPeople, newest])
  const currentKeys = useMemo(() => new Set(newest.map(p => nameKey(p.name))), [newest])
  const matching = useMemo(() => matchPeople(people, users), [people, users])
  const mapping = useMemo(() => buildMapping(people, matching, users, { addNew, overrides, currentKeys }), [people, matching, users, addNew, overrides, currentKeys])
  const names = useMemo(() => shortNames(users), [users])

  // What the app already holds for the weeks in range — needed to know what's new.
  useEffect(() => {
    if (stage !== 'ready' || !selected.length) return
    let cancelled = false
    setExisting(null)
    loadExisting(selected)
      .then(found => { if (!cancelled) setExisting(found) })
      .catch(e => { console.error(e); if (!cancelled) setError('Couldn’t check what’s already in the app — try again.') })
    return () => { cancelled = true }
  }, [stage, selected])

  const plan = useMemo(() => (existing
    ? planImport({ weeks: weeksPeople, selected, mapping, users, existing: existing.schedules, existingOnCall: existing.onCall, excelWins })
    : null), [existing, weeksPeople, selected, mapping, users, excelWins])

  const matchedCount = people.filter(p => mapping.get(p.key)?.kind === 'user').length
  const newCount = people.filter(p => mapping.get(p.key)?.kind === 'new').length
  const needChoice = people.filter(p => matching.get(p.key)?.status === 'ambiguous' && !overrides[p.key]).length
  const rows = [...people].sort((a, b) => {
    const rank = p => ({ ambiguous: 0, none: 1, matched: 2 })[matching.get(p.key)?.status] ?? 3
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })
  const sortedUsers = useMemo(() => [...users].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')), [users])
  const hasWork = !!plan && (plan.schedules.length > 0 || plan.onCall.length > 0 || plan.newPeople.size > 0 || plan.userUpdates.size > 0)

  async function runImport() {
    if (!plan || stage === 'importing') return
    setStage('importing'); setError(''); setProgress({ done: 0, total: 1 })
    try {
      await applyImportPlan(plan, { editorUid: user.uid, onProgress: (d, total) => setProgress({ done: d, total }) })
      const s = plan.stats
      const summary = { entries: s.added + s.updated + s.replaced, people: s.people, weeks: s.weeks, newPeople: plan.newPeople.size, onCall: plan.onCall.length, kept: s.conflict }
      logActivity(user, `Imported ${plural(summary.entries, 'entry', 'entries')} from Excel for ${plural(summary.people, 'person', 'people')} across ${plural(summary.weeks, 'week')}${summary.newPeople ? `, adding ${plural(summary.newPeople, 'new person', 'new people')}` : ''}.`)
      setDone(summary)
      // Re-read what's in the app, so the preview now shows nothing left to do.
      const usersSnap = await getDocs(collection(db, 'users'))
      setUsers(usersSnap.docs.map(d => ({ uid: d.id, ...d.data() })))
      setOverrides({})
      // (the effect above re-reads what's in the app once the stage returns to 'ready')
    } catch (e) {
      console.error(e)
      setError(e.code === 'permission-denied'
        ? 'The database wouldn’t allow that — you need to be an admin, and the latest firestore.rules published.'
        : 'The import stopped part-way. Nothing is lost — press Import again to finish.')
    } finally {
      setStage('ready'); setProgress(null)
    }
  }

  const selectValue = key => {
    const m = mapping.get(key)
    return m?.kind === 'user' ? m.uid : m?.kind === 'new' ? 'new' : 'skip'
  }

  return (
    <div className="admin-layout">
      <div className="admin-side">
        <h2 className="admin-side-title">Import from Excel</h2>
        <p className="text-sm text-muted">
          Fills in the schedule from the company Excel file. Choose the file from your OneDrive folder, check what
          would change, then import. Nothing is written until you press Import, and nothing already entered in
          the app is overwritten unless you ask.
        </p>
        <label className={`btn btn-primary btn-md excel-pick${stage === 'reading' || stage === 'importing' ? ' is-disabled' : ''}`}>
          <FileSpreadsheet size={18} aria-hidden="true" />
          {file ? 'Choose a different file' : 'Choose Excel file'}
          <input
            type="file"
            accept=".xlsx"
            hidden
            disabled={stage === 'reading' || stage === 'importing'}
            onChange={e => { chooseFile(e.target.files[0]); e.target.value = '' }}
          />
        </label>
        {file && (
          <p className="text-sm text-muted">
            <strong>{file.name}</strong><br />Last saved {savedLabel(file.savedAt)}
          </p>
        )}
        <p className="text-sm text-muted">
          Run it again whenever the Excel has changed: changes made in Excel come across, and entries people have
          since edited in the app are kept.
        </p>
      </div>

      <div className="admin-main">
        {error && <Alert tone="critical" icon={<TriangleAlert size={20} />} title="Something went wrong">{error}</Alert>}

        {stage === 'idle' && !file && !error && (
          <div className="card excel-empty">
            <FileSpreadsheet size={32} aria-hidden="true" />
            <p>Choose the staff schedule workbook to begin.</p>
          </div>
        )}

        {stage === 'reading' && <div className="card excel-empty"><Loading /><p>Reading the workbook…</p></div>}

        {index && (stage === 'ready' || stage === 'importing') && (
          <>
            {done && (
              <Alert tone="success" icon={<Check size={20} />} title="Import finished">
                Added or updated {plural(done.entries, 'entry', 'entries')} for {plural(done.people, 'person', 'people')}
                {done.newPeople ? `, including ${plural(done.newPeople, 'person', 'people')} who haven’t signed in yet` : ''}.
                {done.kept ? ` ${plural(done.kept, 'entry', 'entries')} that differ were left as they are in the app.` : ''}{' '}
                <Link to="/">See it in Team week</Link>
              </Alert>
            )}

            <div className="card excel-section">
              <h3 className="excel-heading">1 · Which weeks</h3>
              <p className="text-sm text-muted">
                The file has {plural(allWeeks.length, 'weekly sheet')}, {dayMonthYear(allWeeks[0])} to {dayMonthYear(newestWeek)}
                {index.skipped.length > 0 && <> ({plural(index.skipped.length, 'sheet')} skipped: {index.skipped.map(s => `${s.sheet} — ${s.reason}`).join('; ')})</>}.
              </p>
              <div className="excel-row">
                <select value={range} onChange={e => { setRange(e.target.value); setDone(null) }} aria-label="Which weeks to import">
                  {RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <span className="text-sm text-muted">
                  {selected.length ? `${plural(selected.length, 'week')}, ${dayMonth(selected[0])} – ${dayMonth(selected[selected.length - 1])}` : 'No sheets in that range yet.'}
                </span>
              </div>
            </div>

            <div className="card excel-section">
              <h3 className="excel-heading">2 · People</h3>
              <p className="text-sm text-muted">
                Each name in the Excel is matched to someone in the app by name and team. Check the list and change any that are wrong:
                {' '}{matchedCount} matched, {newCount} will be added as new people
                {needChoice > 0 && <strong>, {needChoice} need you to choose who they are</strong>}.
                {people.some(p => !currentKeys.has(p.key)) && ' People who only appear in older weeks have left, so they’re not added.'}
              </p>
              <Switch checked={addNew} onChange={setAddNew} label="Add people who aren’t in the app yet (shown as “not signed in yet” until they sign in)" />
              <div className="excel-people" role="table" aria-label="Names in the Excel and who they match">
                {rows.map(p => {
                  const status = matching.get(p.key)?.status
                  const chosen = overrides[p.key]
                  return (
                    <div className="excel-person" role="row" key={p.key}>
                      <span role="cell" className="excel-person-name">
                        {p.name}
                        <span className="text-sm text-muted"> {p.team ? teamLabel(p.team) : ''}</span>
                      </span>
                      <span role="cell">
                        <select value={selectValue(p.key)} onChange={e => setOverrides(o => ({ ...o, [p.key]: e.target.value }))} aria-label={`Who is ${p.name}?`}>
                          <option value="new">Add as a new person</option>
                          <option value="skip">Don’t import</option>
                          {sortedUsers.map(u => <option key={u.uid} value={u.uid}>{u.displayName || names.get(u.uid)}{u.pending ? ' — not signed in yet' : ''}</option>)}
                        </select>
                      </span>
                      <span role="cell" className="excel-person-status">
                        {chosen ? <Badge tone="purple">Chosen</Badge>
                          : status === 'matched' ? <Badge tone="green">Matched</Badge>
                          : status === 'ambiguous' ? <Badge tone="orange">Several fit</Badge>
                          : currentKeys.has(p.key) ? <Badge tone="neutral">Not in the app</Badge>
                          : <Badge tone="neutral">No longer on the sheet</Badge>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="card excel-section">
              <h3 className="excel-heading">3 · What will change</h3>
              <Switch checked={excelWins} onChange={setExcelWins} label="If the app and Excel disagree, use the Excel’s" />
              {!plan ? <Loading /> : (
                <>
                  <div className="excel-stats">
                    <div><strong>{plan.stats.added.toLocaleString('en-NZ')}</strong><span>new entries</span></div>
                    <div><strong>{(plan.stats.updated + plan.stats.replaced).toLocaleString('en-NZ')}</strong><span>updated from Excel</span></div>
                    <div><strong>{plan.stats.same.toLocaleString('en-NZ')}</strong><span>already the same</span></div>
                    <div><strong>{plan.stats.conflict.toLocaleString('en-NZ')}</strong><span>differ — app kept</span></div>
                    <div><strong>{plan.newPeople.size.toLocaleString('en-NZ')}</strong><span>new people</span></div>
                    <div><strong>{plan.onCall.length.toLocaleString('en-NZ')}</strong><span>on-call weeks set</span></div>
                  </div>

                  {plan.warnings.length > 0 && <Alert tone="warning" icon={<TriangleAlert size={20} />} title="Worth a look">{plan.warnings.slice(0, 5).join(' ')}</Alert>}

                  {plan.conflicts.length > 0 && (
                    <details className="excel-details">
                      <summary>{plural(plan.conflicts.length, 'entry', 'entries')} where the app and Excel differ{excelWins ? ' (the Excel’s will be used)' : ' (the app’s is kept)'}</summary>
                      <ul>
                        {plan.conflicts.slice(0, 40).map((c, i) => (
                          <li key={i}>
                            <strong>{c.name}</strong>, {DAY_SHORT[c.day]} {dayMonth(weekDates(c.weekStart)[c.day])} — app: “{c.app}”, Excel: “{c.excel}”
                          </li>
                        ))}
                      </ul>
                      {plan.conflicts.length > 40 && <p className="text-sm text-muted">…and {plan.conflicts.length - 40} more.</p>}
                    </details>
                  )}

                  {plan.weekRows.length > 1 && (
                    <details className="excel-details">
                      <summary>Week by week</summary>
                      <div className="excel-weeks">
                        {plan.weekRows.map(r => (
                          <div key={r.weekStart}><span>{dayMonthYear(r.weekStart)}</span><span>{plural(r.people, 'person', 'people')}</span><span>{r.added} new</span><span>{r.updated + r.replaced} updated</span></div>
                        ))}
                      </div>
                    </details>
                  )}

                  <div className="excel-actions">
                    <Button size="lg" onClick={runImport} disabled={!hasWork || stage === 'importing'}>
                      {stage === 'importing' ? `Saving… ${progress ? Math.round((progress.done / progress.total) * 100) : 0}%` : hasWork ? 'Import' : 'Nothing to import'}
                    </Button>
                    {!hasWork && selected.length > 0 && <span className="text-sm text-muted">The app already matches the Excel for these weeks.</span>}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
