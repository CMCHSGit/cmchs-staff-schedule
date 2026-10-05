import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Printer, Copy, MessageSquare } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getCurrentWeekStart, addDaysISO, weekDates, weekLabel, fromISO, todayIndex, normalizeSchedule, daysWithCalls, WEEK_DAYS, DAY_SHORT, dayMonth } from '../utils/week'
import { holidayOn } from '../utils/holidays'
import { describeDay, INK } from '../utils/status'
import { groupByTeam } from '../utils/teams'
import { shortNames } from '../utils/names'
import { onLeave } from '../utils/weekInsights'
import { writeSchedule, addNewLocations } from '../utils/scheduleStore'
import { logActivity } from '../utils/activityLog'
import { useUsers, useSchedules, useOnCall, useLocations } from '../hooks/useScheduleData'
import useWeekGrid from '../hooks/useWeekGrid'
import WeekNav from '../components/WeekNav'
import DayPills from '../components/DayPills'
import PeopleFilter, { filterPeople } from '../components/PeopleFilter'
import LeavePin from '../components/LeavePin'
import Legend from '../components/Legend'
import EditDrawer from '../components/EditDrawer'
import CommentDrawer from '../components/CommentDrawer'
import Toast, { useToast } from '../components/Toast'
import { Button, Loading } from '../components/ui'

const PHONE_VIEW_KEY = 'css_team_phone_view'

export default function TeamWeek() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  // Arriving from My week's Save: open on the week just saved, then scroll to
  // and briefly highlight that person's row (see the effect further down).
  const location = useLocation()
  const navigate = useNavigate()
  const arrival = location.state
  const [weekOffset, setWeekOffset] = useState(() => arrival?.weekStart
    ? Math.round((fromISO(arrival.weekStart) - fromISO(getCurrentWeekStart(0))) / (7 * 864e5))
    : 0)
  const weekStart = getCurrentWeekStart(weekOffset)
  const prevWeek = addDaysISO(weekStart, -7)
  const [dayIdx, setDayIdx] = useState(() => Math.max(0, todayIndex(getCurrentWeekStart(0))))
  const [query, setQuery] = useState('')
  const [teamSel, setTeamSel] = useState([])
  const [editing, setEditing] = useState(null) // { uid, dayIdx }
  const [commenting, setCommenting] = useState(null) // uid
  const [copying, setCopying] = useState(false)
  // Phones: 'day' (one day per person, picked with the day pills) or 'week'
  // (everyone's whole week, swiped sideways). Remembered on the device.
  const [phoneView, setPhoneView] = useState(() => {
    try { return localStorage.getItem(PHONE_VIEW_KEY) === 'week' ? 'week' : 'day' } catch { return 'day' }
  })
  function choosePhoneView(v) {
    setPhoneView(v)
    try { localStorage.setItem(PHONE_VIEW_KEY, v) } catch { /* private mode — just not remembered */ }
  }
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

  // Each person's week with the roster's customer-calls cover folded in —
  // calls are rostered on the On-call page, not entered by each person.
  const weekOf = useMemo(
    () => new Map(sorted.map(u => [u.uid, daysWithCalls(schedules[u.uid]?.days, oncall, u.uid)])),
    [sorted, schedules, oncall]
  )

  const people = filterPeople(sorted, names, query, teamSel)
  const groups = groupByTeam(people)
  const teamOptions = groupByTeam(sorted)
  const leaveToday = onLeave({ weekStart, dayIdx, users: people, schedules })
  const hasEntries = Object.keys(schedules).length > 0
  const notFilled = sorted.filter(u => !weekOf.get(u.uid).some(d => d.location || d.onCall)).length

  const canEdit = u => isAdmin || u.uid === user.uid
  const cell = (u, i) => describeDay(weekOf.get(u.uid)?.[i], holidays[i])
  const commentOf = u => schedules[u.uid]?.comments || ''
  const nameLabel = u => (oncall?.uid === u.uid ? `${names.get(u.uid)} - OnCall` : names.get(u.uid))
  /** Up to two initials for the person's avatar, from their full name. */
  const initialsOf = u => {
    const parts = (u.displayName || names.get(u.uid) || '?').trim().split(/\s+/).filter(Boolean)
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
  }

  // The desktop grid's own row order — the on-screen order people are
  // listed in, across every team group, which is what a row index in a
  // selection or a pasted block of rows actually means.
  const gridRows = groups.flatMap(g => g.members)
  const gridRowOf = new Map(gridRows.map((u, i) => [u.uid, i]))
  const locationOf = (r, c) => normalizeSchedule(schedules[gridRows[r]?.uid]?.days)[c]?.location || ''

  // ── the Excel-style grid's saving ──
  // A change shows on screen at once and is saved in the background, one person's week at a time. What
  // each save writes is that person's latest days (not the last copy the database confirmed), so a second
  // edit made before the first is confirmed builds on it instead of overwriting it.
  const saving = useRef(new Map())            // `${week}_${uid}` → { person, week, days, saved, comments, cells, writing, dirty }
  const history = useRef({ undo: [], redo: [] }) // { weekStart, changes: [{ uid, c, before, after }] }
  const newLocations = useRef(new Set())
  const latest = useRef({})
  latest.current = { schedules, locations, names }

  /** The days to build a change on: unsaved changes included. */
  const daysFor = person => saving.current.get(`${weekStart}_${person.uid}`)?.days ?? normalizeSchedule(schedules[person.uid]?.days)

  async function drain(key) {
    const slot = saving.current.get(key)
    if (!slot || slot.writing) return
    slot.writing = true
    try {
      while (slot.dirty) {
        slot.dirty = false
        const comments = latest.current.schedules[slot.person.uid]?.comments ?? slot.comments
        slot.saved = await writeSchedule({ person: slot.person, weekStart: slot.week, days: slot.days, comments, editorUid: user.uid, existing: slot.saved })
      }
      saving.current.delete(key)
      patch(slot.week, slot.person.uid, { ...slot.saved, days: slot.days })
      logActivity(user, `Updated ${slot.cells} ${slot.cells === 1 ? 'cell' : 'cells'} for ${latest.current.names.get(slot.person.uid)} in Team week (week of ${weekLabel(slot.week)}).`)
      if (!saving.current.size && !slot.quiet) showToast('Saved.')
    } catch (e) {
      saving.current.delete(key)
      history.current = { undo: [], redo: [] } // what's on screen no longer matches what these would undo
      patch(slot.week, slot.person.uid, slot.saved || { uid: slot.person.uid, weekStart: slot.week, comments: slot.comments, days: normalizeSchedule(null) })
      saveFailed(e)
    }
  }

  /** `quiet`: an undo or redo, which already said "Undone." — no "Saved." on top of it. */
  function queueSave(person, days, cells, quiet = false) {
    const key = `${weekStart}_${person.uid}`
    let slot = saving.current.get(key)
    if (!slot) {
      const doc = schedules[person.uid] || null
      slot = { person, week: weekStart, saved: doc, comments: doc?.comments || '', cells: 0, quiet, writing: false, dirty: false }
      saving.current.set(key, slot)
    } else {
      slot.quiet = slot.quiet && quiet
    }
    slot.days = days
    slot.cells += cells
    slot.dirty = true
    patch(weekStart, person.uid, { ...(slot.saved || { uid: person.uid, weekStart, comments: '' }), days })
    if (!slot.writing) drain(key)
  }

  /** Typed-in places that aren't known yet become suggestions for everyone, once each. */
  function rememberLocations(typed) {
    const fresh = typed.filter(name => !newLocations.current.has(name.toLowerCase()))
    if (!fresh.length) return
    fresh.forEach(name => newLocations.current.add(name.toLowerCase()))
    addNewLocations(fresh, latest.current.locations).then(added => { if (added.length) setLocations(prev => [...prev, ...added]) })
  }

  /**
   * Sets cells, given as [{ uid, c, location }]: works out what changes, keeps it for Undo, and saves.
   * Returns how many cells actually changed.
   */
  function applyByUid(list, { record = true } = {}) {
    const touched = new Map()
    const done = []
    for (const { uid, c, location } of list) {
      const person = users.find(u => u.uid === uid)
      if (!person) continue
      const entry = touched.get(uid) || { person, days: daysFor(person), cells: 0 }
      const before = entry.days[c]?.location || ''
      if (before === location) continue
      done.push({ uid, c, before, after: location })
      entry.days = entry.days.map((d, i) => (i === c ? { ...d, location } : d))
      entry.cells++
      touched.set(uid, entry)
    }
    if (!done.length) return 0
    if (record) history.current = { undo: [...history.current.undo.slice(-99), { weekStart, changes: done }], redo: [] }
    for (const { person, days, cells } of touched.values()) queueSave(person, days, cells, !record)
    rememberLocations(done.map(d => d.after).filter(Boolean))
    if (done.length > 12) showToast(`Changed ${done.length} cells — Ctrl+Z undoes it.`)
    return done.length
  }

  /** Cells changed by typing, pasting, filling or clearing in the grid (rows are positions in the grid). */
  function applyGridChanges(changes) {
    applyByUid(changes.filter(ch => gridRows[ch.r]).map(ch => ({ uid: gridRows[ch.r].uid, c: ch.c, location: ch.location })))
  }

  /** Ctrl+Z / Ctrl+Y: the last change made in this week, put back (or put in again). */
  function stepHistory(which) {
    const from = history.current[which]
    const to = history.current[which === 'undo' ? 'redo' : 'undo']
    const entry = from.at(-1)
    if (!entry) return showToast(which === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.')
    if (entry.weekStart !== weekStart) return showToast(`That change was in the week of ${dayMonth(entry.weekStart)} — go back to it to ${which} it.`)
    from.pop()
    to.push(entry)
    const list = entry.changes.map(ch => ({ uid: ch.uid, c: ch.c, location: which === 'undo' ? ch.before : ch.after }))
    applyByUid(list, { record: false })
    grid.selectCells(list.map(ch => [gridRowOf.get(ch.uid), ch.c]).filter(([r]) => r !== undefined))
    showToast(which === 'undo' ? 'Undone.' : 'Redone.')
  }

  // Anything still on its way to the database when the page is closed would be lost — ask first.
  useEffect(() => {
    const warn = e => { if (saving.current.size) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  const grid = useWeekGrid({
    rowCount: gridRows.length,
    colCount: 5,
    valueOf: locationOf,
    canEdit: r => canEdit(gridRows[r]),
    onApply: applyGridChanges,
    onDenied: () => showToast('Not allowed — you can only edit your own row.'),
    onUndo: () => stepHistory('undo'),
    onRedo: () => stepHistory('redo'),
    resetKey: `${weekStart}:${gridRows.map(u => u.uid).join()}`,
  })

  function saveFailed(e) {
    console.error(e)
    showToast(e.code === 'permission-denied'
      ? 'Not allowed yet — the updated database rules need publishing.'
      : 'Save failed — try again.')
  }

  async function saveEdit(person, days, typed) {
    const comments = commentOf(person)
    try {
      const fresh = await addNewLocations(typed, locations)
      if (fresh.length) setLocations(prev => [...prev, ...fresh])
      const saved = await writeSchedule({ person, weekStart, days, comments, editorUid: user.uid, existing: schedules[person.uid] })
      patch(weekStart, person.uid, saved)
      setEditing(null)
      showToast('Saved.')
      logActivity(user, `Updated ${names.get(person.uid)}'s whole week in Team week (week of ${weekLabel(weekStart)}).`)
    } catch (e) {
      saveFailed(e)
    }
  }

  /** The week's comment on its own — the whereabouts panel no longer carries it. */
  async function saveComment(person, comments) {
    const existing = schedules[person.uid]
    const days = normalizeSchedule(existing?.days)
    try {
      const saved = await writeSchedule({ person, weekStart, days, comments, editorUid: user.uid, existing })
      patch(weekStart, person.uid, saved)
      setCommenting(null)
      showToast(comments.trim() ? 'Comment saved.' : 'Comment cleared.')
      logActivity(user, comments.trim()
        ? `Set ${names.get(person.uid)}'s comment for week of ${weekLabel(weekStart)}: "${comments.trim()}"`
        : `Cleared ${names.get(person.uid)}'s comment for week of ${weekLabel(weekStart)}.`)
    } catch (e) {
      saveFailed(e)
    }
  }

  /**
   * Fills this week for everyone who hasn't started it, from what they had
   * last week — never overwrites anything already entered. Leave and public
   * holidays aren't carried over, and neither is customer calls cover, which
   * is rostered per week on the On-call page. Marked needsConfirm, so people
   * still get Thursday's reminder to check it.
   */
  async function copyLastWeek() {
    const last = byWeek[prevWeek] || {}
    if (!Object.keys(last).length) return showToast('Last week has no entries to copy.')
    const targets = sorted.filter(u => last[u.uid] && !schedules[u.uid])
    if (!targets.length) return showToast('Everyone with last week filled in has started this week already.')
    if (!confirm(`Copy last week into this week for ${targets.length} ${targets.length === 1 ? 'person' : 'people'} who haven’t filled it in yet? Nothing already entered is changed.`)) return
    setCopying(true)
    try {
      for (const u of targets) {
        const days = normalizeSchedule(last[u.uid].days).map((d, i) => {
          const status = describeDay(d).status
          const carry = holidays[i] || status === 'leave' || status === 'holiday' ? '' : d.location
          return { location: carry, onCall: false }
        })
        const saved = await writeSchedule({ person: u, weekStart, days, comments: '', editorUid: user.uid, existing: null, extra: { copiedFrom: prevWeek } })
        patch(weekStart, u.uid, saved)
      }
      showToast(`Copied from week starting ${dayMonth(prevWeek)}. Leave and holidays were not carried over.`)
      logActivity(user, `Copied last week into week of ${weekLabel(weekStart)} for ${targets.length} ${targets.length === 1 ? 'person' : 'people'}.`)
    } catch (e) {
      console.error(e)
      showToast(e.code === 'permission-denied'
        ? 'Not allowed yet — the updated database rules need publishing.'
        : 'Copy stopped part-way — try again to finish.')
    } finally {
      setCopying(false)
    }
  }

  /** The Comments column — its own button, so leaving a note never means opening a day. */
  const commentCell = u => {
    const text = commentOf(u)
    if (!canEdit(u) && !text) return <div className="wk-comment" />
    return (
      <button
        type="button"
        className={`wk-comment${text ? '' : ' wk-comment-empty'}`}
        title={text || `Add a comment for ${names.get(u.uid)}`}
        onClick={() => setCommenting(u.uid)}
      >
        {text || <><MessageSquare size={13} aria-hidden="true" />Comment</>}
      </button>
    )
  }

  /** The same button on a phone, where the grid only has room for an icon. */
  const commentButton = u => {
    const text = commentOf(u)
    if (!canEdit(u) && !text) return null
    return (
      <button
        type="button"
        className={`wkm-comment${text ? ' has-note' : ''}`}
        aria-label={text ? `Comment for ${names.get(u.uid)}` : `Add a comment for ${names.get(u.uid)}`}
        onClick={() => setCommenting(u.uid)}
      >
        <MessageSquare size={18} aria-hidden="true" />
      </button>
    )
  }

  const editPerson = editing && users.find(u => u.uid === editing.uid)
  const commentPerson = commenting && users.find(u => u.uid === commenting)
  const loading = usersLoading || schedLoading

  useEffect(() => {
    if (loading || !arrival?.focusUid) return
    if (arrival.toast) showToast(arrival.toast)
    // Whichever layout is showing (desktop grid or phone list) has the row visible.
    const row = [...document.querySelectorAll(`[data-uid="${arrival.focusUid}"]`)].find(el => el.offsetParent)
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      row.classList.add('row-flash')
      setTimeout(() => row.classList.remove('row-flash'), 2400)
    }
    // Forget the arrival, so a refresh or coming back later doesn't replay it.
    navigate(location.pathname, { replace: true, state: null })
  }, [loading, arrival, showToast, navigate, location.pathname])

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">Team week</h1>
          {!loading && (
            <span className="page-sub">
              {sorted.length} people · {notFilled ? `${notFilled} not filled in yet` : 'everyone has filled in'} · tap {isAdmin ? 'anyone' : 'your row'} to update, or Comments to leave a note
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

      <div className="show-narrow phone-view-switch" role="tablist" aria-label="Show">
        {[['day', 'Day'], ['week', 'Week']].map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={phoneView === v} className={phoneView === v ? 'active' : ''} onClick={() => choosePhoneView(v)}>
            {label}
          </button>
        ))}
      </div>
      {phoneView === 'day' && <div className="show-narrow"><DayPills weekStart={weekStart} value={dayIdx} onChange={setDayIdx} /></div>}

      <div className={phoneView === 'week' ? 'hide-narrow' : undefined}>
        <LeavePin weekStart={weekStart} dayIdx={dayIdx} people={leaveToday} names={names} />
      </div>
      <div className="hide-narrow"><Legend /></div>

      {loading ? <Loading /> : (
        <>
          {!hasEntries && (
            <p className="empty-note">No entries for this week yet. Public holidays are shown already.</p>
          )}

          {/* Desktop: the whole week, like the Excel sheet — click and type,
              drag or Shift-click to select a range, Ctrl+C/Ctrl+V to copy and
              paste, just as you would in Excel (including pasting a block
              Excel itself copied). Click a person's name for their whole week
              at once — quick fills, clearing the week, their comment. */}
          <div className="wk-desktop">
            <textarea {...grid.catcherProps} />
            <p className="wk-hint">
              Works like Excel: click a cell and type · Ctrl+C / Ctrl+X / Ctrl+V to copy, cut and paste (Excel too) · drag the square on the corner to fill · Ctrl+Z to undo
            </p>
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
                {g.members.map(u => {
                  const r = gridRowOf.get(u.uid)
                  return (
                    <div key={u.uid} className="wk-cols wk-row" data-uid={u.uid}>
                      {canEdit(u) ? (
                        <button
                          type="button"
                          className={`wk-name${oncall?.uid === u.uid ? ' oncall' : ''}`}
                          title={`${u.displayName} — open their whole week`}
                          onClick={() => setEditing({ uid: u.uid, dayIdx })}
                        >
                          <span className="wk-name-avatar" aria-hidden="true">{initialsOf(u)}</span>
                          <span className="wk-name-label">{nameLabel(u)}</span>
                        </button>
                      ) : (
                        <div className={`wk-name${oncall?.uid === u.uid ? ' oncall' : ''}`} title={u.displayName}>
                          <span className="wk-name-avatar" aria-hidden="true">{initialsOf(u)}</span>
                          <span className="wk-name-label">{nameLabel(u)}</span>
                        </div>
                      )}
                      {WEEK_DAYS.map((_, i) => {
                        const c = cell(u, i)
                        const isEditingHere = grid.editing?.r === r && grid.editing?.c === i
                        return (
                          <div
                            key={i}
                            className={`wk-cell${grid.isSelected(r, i) ? ' wk-cell-selected' : ''}${grid.isAnchor(r, i) ? ' wk-cell-anchor' : ''}${grid.isFillPreview(r, i) ? ' wk-cell-fillpreview' : ''}${canEdit(u) ? '' : ' wk-cell-readonly'} ${grid.clipEdges(r, i)}`}
                            style={isEditingHere ? undefined : { background: c.bg, ...(c.filled && { color: INK }) }}
                            title={isEditingHere ? undefined : c.text || undefined}
                            {...grid.cellHandlers(r, i)}
                          >
                            {isEditingHere ? <input className="wk-cell-edit" {...grid.editingInputProps} /> : c.text}
                            {grid.isHandle(r, i) && canEdit(u) && <span className="wk-fill-handle" title="Drag to fill" {...grid.fillHandleProps} />}
                          </div>
                        )
                      })}
                      {commentCell(u)}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Phone, Week: everyone's whole week in one table that swipes
              sideways, names pinned on the left — full text, no initials. */}
          {phoneView === 'week' && (
            <div className="wk-mobile">
              <div className="wkw-scroll">
                <div className="wkw-table">
                  <div className="wkw-row wkw-head">
                    <span className="wkw-name">Name</span>
                    {WEEK_DAYS.map((d, i) => (
                      <span key={d} className={`wkw-cell${i === today ? ' today' : ''}`}>{DAY_SHORT[i]} {dayMonth(dates[i])}</span>
                    ))}
                    <span className="wkw-note" />
                  </div>
                  {groups.map(g => (
                    <div key={g.team} className="wkw-group">
                      <div className="wkw-band" style={{ background: g.band }}><span>{g.label}</span></div>
                      {g.members.map(u => {
                        const Tagname = canEdit(u) ? 'button' : 'div'
                        return (
                          <div key={u.uid} className="wkw-row" data-uid={u.uid}>
                            <Tagname
                              type={canEdit(u) ? 'button' : undefined}
                              className="wkw-main"
                              onClick={canEdit(u) ? () => setEditing({ uid: u.uid, dayIdx: Math.max(0, today) }) : undefined}
                            >
                              <span className={`wkw-name${oncall?.uid === u.uid ? ' oncall' : ''}`}>{nameLabel(u)}</span>
                              {WEEK_DAYS.map((_, i) => {
                                const c = cell(u, i)
                                return (
                                  <span key={i} className={`wkw-cell${c.empty ? ' blank' : ''}`} style={{ background: c.bg, ...(c.filled && { color: INK }) }}>
                                    {c.text || '—'}
                                  </span>
                                )
                              })}
                            </Tagname>
                            <span className="wkw-note">{commentButton(u)}</span>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Phone, Day: one day at a time, picked with the day pills */}
          {phoneView === 'day' && (
          <div className="wk-mobile">
            {groups.map(g => (
              <div key={g.team} className="wkm-group">
                <div className="wkm-band" style={{ background: g.band }}>{g.label}</div>
                {g.members.map(u => {
                  const c = cell(u, dayIdx)
                  const Tagname = canEdit(u) ? 'button' : 'div'
                  return (
                    <div key={u.uid} className="wkm-row" data-uid={u.uid}>
                      <Tagname
                        type={canEdit(u) ? 'button' : undefined}
                        className="wkm-main"
                        onClick={canEdit(u) ? () => setEditing({ uid: u.uid, dayIdx }) : undefined}
                      >
                        <span className={`wkm-name${oncall?.uid === u.uid ? ' oncall' : ''}`}>
                          <span className="wk-name-avatar" aria-hidden="true">{initialsOf(u)}</span>
                          {nameLabel(u)}
                        </span>
                        <span className={`wkm-day${c.empty ? ' blank' : ''}`} style={{ background: c.bg, ...(c.filled && { color: INK }) }}>{c.text || 'No entry'}</span>
                      </Tagname>
                      {commentButton(u)}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          )}
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
          lastWeek={normalizeSchedule(byWeek[prevWeek]?.[editPerson.uid]?.days)}
          locations={locations}
          calls={weekOf.get(editPerson.uid)?.map(d => d.onCall) || []}
          onSave={(days, typed) => saveEdit(editPerson, days, typed)}
          onClose={() => setEditing(null)}
        />
      )}

      {commentPerson && (
        <CommentDrawer
          name={names.get(commentPerson.uid)}
          isSelf={commentPerson.uid === user.uid}
          weekStart={weekStart}
          comments={commentOf(commentPerson)}
          readOnly={!canEdit(commentPerson)}
          onSave={comments => saveComment(commentPerson, comments)}
          onClose={() => setCommenting(null)}
        />
      )}

      <Toast message={toast} />
    </div>
  )
}
