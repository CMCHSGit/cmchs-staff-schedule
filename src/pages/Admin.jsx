import { useState, useEffect } from 'react'
import {
  collection, getDocs, getDoc, addDoc, deleteDoc, doc, setDoc, updateDoc,
  query, orderBy, serverTimestamp
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { Bell } from 'lucide-react'
import Toast from '../components/Toast'
import { TEAMS, teamLabel } from '../utils/teams'
import { Badge, Button, Loading } from '../components/ui'
import { APP_VERSION } from '../version'

export default function Admin() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('locations')

  if (profile?.role !== 'admin') {
    return (
      <div className="page page-narrow">
        <p className="text-muted">Admin access only.</p>
      </div>
    )
  }

  return (
    <div className="page page-narrow">
      <h1 className="page-title">Admin</h1>

      <div className="tabs" role="tablist">
        {[['locations', 'Locations'], ['users', 'People']].map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'locations' && <LocationsTab />}
      {tab === 'users'     && <UsersTab />}

      <p className="version-note">CMCHS Staff Schedule v{APP_VERSION}</p>
    </div>
  )
}

/* ── Locations tab ── */
function LocationsTab() {
  const [locations, setLocations] = useState([])
  const [newName,   setNewName]   = useState('')
  const [loading,   setLoading]   = useState(true)
  const [toast,     setToast]     = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const q = query(collection(db, 'locations'), orderBy('order'))
    const snap = await getDocs(q)
    setLocations(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLoading(false)
  }

  async function addLocation() {
    const name = newName.trim()
    if (!name) return
    await addDoc(collection(db, 'locations'), {
      name,
      order: locations.length,
      active: true,
      createdAt: serverTimestamp(),
    })
    setNewName('')
    showToast(`Added "${name}"`)
    load()
  }

  async function toggleActive(loc) {
    await updateDoc(doc(db, 'locations', loc.id), { active: !loc.active })
    showToast(loc.active ? `Hidden "${loc.name}"` : `Restored "${loc.name}"`)
    load()
  }

  async function removeLocation(loc) {
    if (!confirm(`Delete "${loc.name}"? This won't affect existing schedules.`)) return
    await deleteDoc(doc(db, 'locations', loc.id))
    showToast(`Deleted "${loc.name}"`)
    load()
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="page-head-text" style={{ gap: 14 }}>
      <p className="text-sm text-muted">
        The suggestions people see when filling in their schedule. Anything typed that isn’t
        here gets added automatically. Hiding a location won’t change schedules already saved.
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          placeholder="New location name…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addLocation()}
          style={{ flex: 1 }}
        />
        <Button onClick={addLocation}>Add</Button>
      </div>

      {loading ? <Loading /> : (
        <div className="card admin-list">
          {locations.length === 0 && <p className="text-sm text-muted" style={{ padding: 16 }}>No locations yet.</p>}
          {locations.map(loc => (
            <div key={loc.id} className="admin-item" style={{ opacity: loc.active ? 1 : 0.5 }}>
              <span className="admin-item-name">
                {loc.name}
                {!loc.active && <Badge tone="neutral">Hidden</Badge>}
              </span>
              <div className="admin-controls">
                <Button variant="secondary" size="sm" onClick={() => toggleActive(loc)}>{loc.active ? 'Hide' : 'Show'}</Button>
                <Button variant="ghost" size="sm" style={{ color: 'var(--status-critical)' }} onClick={() => removeLocation(loc)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Toast message={toast} />
    </div>
  )
}

/* ── Users tab ── */
function UsersTab() {
  const [users,      setUsers]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [toast,      setToast]      = useState(null)
  const [rosterText, setRosterText] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importing,  setImporting]  = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const snap = await getDocs(collection(db, 'users'))
    setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() })))
    setLoading(false)
  }

  async function updateUser(uid, field, value) {
    await updateDoc(doc(db, 'users', uid), { [field]: value })
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, [field]: value } : u))
  }

  /**
   * Creates placeholder records for staff who haven't signed in yet, from a
   * pasted "Name, Team" list (one per line) — deliberately not hardcoded
   * anywhere in this file, since that would put a real staff roster into
   * this repo's (public) git history. AuthContext.jsx auto-claims one of
   * these by first name the first time that person actually signs in, only
   * when the match is unambiguous — see its comment for why.
   */
  async function importFromExcel() {
    const lines = rosterText.split('\n').map(l => l.trim()).filter(Boolean)
    const existingIds = new Set(users.map(u => u.uid))
    const realFirstNames = new Set(
      users.filter(u => !u.pending).map(u => (u.displayName || '').split(' ')[0].toLowerCase())
    )
    let created = 0, skipped = 0, invalid = 0
    for (const line of lines) {
      const [namePart, teamPart] = line.split(',').map(s => s?.trim())
      const team = TEAMS.find(t => t.toLowerCase() === (teamPart || '').toLowerCase())
      if (!namePart || !team) { invalid++; continue }
      const id = 'pending-' + namePart.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')
      const firstName = namePart.split(' ')[0].toLowerCase()
      if (existingIds.has(id) || realFirstNames.has(firstName)) { skipped++; continue }
      await setDoc(doc(db, 'users', id), {
        displayName: namePart,
        team,
        role:        'user',
        excelName:   namePart,
        pending:     true,
        createdAt:   serverTimestamp(),
      })
      created++
    }
    showToast(`Imported ${created} new, skipped ${skipped} existing, ${invalid} invalid lines`)
    setRosterText('')
    setShowImport(false)
    load()
  }

  /** Prefers an exact excelName match, falling back to first-name only when unambiguous. */
  function findUserId(name) {
    const target = name.trim().toLowerCase()
    const exact = users.find(u => (u.excelName || '').trim().toLowerCase() === target)
    if (exact) return exact.uid
    const firstName = target.split(/\s+/)[0]
    const candidates = users.filter(u => (u.displayName || '').trim().split(/\s+/)[0]?.toLowerCase() === firstName)
    return candidates.length === 1 ? candidates[0].uid : null
  }

  /**
   * Backfills past weeks from a { weekStart: [{name, team, days, comments}] }
   * JSON file (pulled from the Excel schedule) — a file upload rather than
   * pasted/hardcoded, since this is real staff schedule data. Never
   * overwrites a schedule that's already there (e.g. from someone actually
   * using the app), only fills in ones that don't exist yet.
   */
  async function importScheduleHistory(file) {
    const text = await file.text()
    let data
    try { data = JSON.parse(text) } catch { showToast('Could not parse that file as JSON'); return }

    setImporting(true)
    let created = 0, skippedExisting = 0, unmatched = 0
    for (const [weekStart, entries] of Object.entries(data)) {
      for (const entry of entries) {
        const uid = findUserId(entry.name)
        if (!uid) { unmatched++; continue }
        const scheduleRef = doc(db, 'schedules', `${weekStart}_${uid}`)
        const existing = await getDoc(scheduleRef)
        if (existing.exists()) { skippedExisting++; continue }
        const user = users.find(u => u.uid === uid)
        await setDoc(scheduleRef, {
          uid,
          displayName: user?.displayName || entry.name,
          email:       user?.email || null,
          team:        user?.team || entry.team || null,
          weekStart,
          days:        entry.days.map(location => ({ location: location || '', onCall: false })),
          comments:    entry.comments || '',
          submittedAt: serverTimestamp(),
          importedFromExcel: true,
        })
        created++
      }
    }
    setImporting(false)
    showToast(`Imported ${created} schedules, skipped ${skippedExisting} existing, ${unmatched} unmatched names`)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="page-head-text" style={{ gap: 14 }}>
      <p className="text-sm text-muted">
        Assign teams and roles. Most people pick their team on first sign-in; change it here if needed.
        Admins can update anyone’s schedule from Team week and run the on-call roster.
      </p>

      <div>
        <Button variant="secondary" size="sm" onClick={() => setShowImport(v => !v)}>
          {showImport ? 'Cancel import' : 'Import staff from Excel'}
        </Button>
        {showImport && (
          <div className="field" style={{ marginTop: 10 }}>
            <p className="text-sm text-muted">
              Paste one person per line, as <code>Name, Team</code> — e.g. <code>Karen, Admin</code>
              or <code>Mark Henderwood, Application</code> for someone who shares a first name
              with someone else on the list. Adds a placeholder for anyone who hasn’t signed in
              yet (safe to run more than once — already-imported or already-real people are
              skipped). When someone first signs in for real, this app automatically finds and
              adopts their matching placeholder’s team — by email guess (first.last@) when a
              full name was pasted, otherwise by first name, and only when that’s unambiguous.
              A first-name-only entry that turns out to collide with someone else is left for
              you to sort out by hand rather than guessed at.
            </p>
            <textarea
              className="input"
              rows={8}
              style={{ fontFamily: 'var(--font-mono)' }}
              placeholder={'Karen, Admin\nJan, Admin\nMark, Management\n...'}
              value={rosterText}
              onChange={e => setRosterText(e.target.value)}
            />
            <div><Button size="sm" onClick={importFromExcel}>Import</Button></div>
          </div>
        )}
      </div>

      <div className="field">
        <label className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
          {importing ? 'Importing…' : 'Import schedule history (.json)'}
          <input
            type="file"
            accept="application/json"
            disabled={importing}
            style={{ display: 'none' }}
            onChange={e => { if (e.target.files[0]) importScheduleHistory(e.target.files[0]); e.target.value = '' }}
          />
        </label>
        <p className="text-sm text-muted">
          Backfills past weeks from an exported Excel schedule file. Matches each entry to an
          existing person (by Excel name, or first name if unambiguous) and only fills in weeks
          that don’t already have a saved schedule — never overwrites one that’s already there.
        </p>
      </div>

      {loading ? <Loading /> : (
        <div className="card admin-list">
          {users.map(u => (
            <div key={u.uid} className="admin-item">
              <div style={{ flex: 1, minWidth: 180 }}>
                <div className="admin-item-name">
                  {u.displayName || '(no name)'}
                  {u.fcmTokens?.length > 0 && (
                    <Bell size={15} color="var(--chs-green)" aria-label="Push reminders on" />
                  )}
                </div>
                <div className="text-sm text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.pending ? <Badge tone="neutral">Not signed in yet</Badge> : u.email}
                </div>
              </div>
              <div className="admin-controls">
                <select
                  value={u.team || ''}
                  onChange={e => { updateUser(u.uid, 'team', e.target.value || null); showToast('Saved.') }}
                  style={{ width: 150 }}
                  aria-label="Team"
                >
                  <option value="">No team</option>
                  {TEAMS.map(t => <option key={t} value={t}>{teamLabel(t)}</option>)}
                </select>
                <select
                  value={u.role || 'user'}
                  onChange={e => { updateUser(u.uid, 'role', e.target.value); showToast('Saved.') }}
                  style={{ width: 110 }}
                  aria-label="Role"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <input
                  className="input"
                  defaultValue={u.excelName || ''}
                  placeholder="Excel name"
                  aria-label="Excel name"
                  title="Name as it appears in the Excel schedule's Name column — also the name the schedule shows. Leave blank to skip syncing them."
                  onBlur={e => {
                    const val = e.target.value.trim()
                    if (val !== (u.excelName || '')) {
                      updateUser(u.uid, 'excelName', val || null)
                      showToast('Saved.')
                    }
                  }}
                  style={{ width: 130 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Toast message={toast} />
    </div>
  )
}
