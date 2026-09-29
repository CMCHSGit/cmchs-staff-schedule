import { useState, useEffect } from 'react'
import {
  collection, getDocs, addDoc, deleteDoc, doc, setDoc, updateDoc,
  query, orderBy, serverTimestamp
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { Bell, Lock } from 'lucide-react'
import Toast from '../components/Toast'
import { TEAMS, teamLabel } from '../utils/teams'
import { Badge, Button, Loading } from '../components/ui'
import { APP_VERSION } from '../version'

/**
 * Admin also asks for a password — a second step on top of the admin role,
 * useful on an admin's unlocked phone or computer. Only its SHA-256 is kept
 * here (this repo is public), but this is a lock on the door, not a safe:
 * it runs in the browser. What actually protects admin actions is the role
 * check plus firestore.rules. Stays unlocked until the tab/app is closed.
 */
const ADMIN_PASSWORD_SHA256 = '8c1d16397760afa8d5301e4461e28f5f48f7e8ba20de33e32a259e9bedd7fecb'
const UNLOCK_KEY = 'css_admin_unlocked'

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function isUnlocked() {
  try { return sessionStorage.getItem(UNLOCK_KEY) === ADMIN_PASSWORD_SHA256 } catch { return false }
}

function AdminLock({ onUnlock }) {
  const [password, setPassword] = useState('')
  const [wrong, setWrong] = useState(false)
  const [checking, setChecking] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setChecking(true)
    const hash = await sha256(password)
    setChecking(false)
    if (hash !== ADMIN_PASSWORD_SHA256) { setWrong(true); setPassword(''); return }
    try { sessionStorage.setItem(UNLOCK_KEY, hash) } catch { /* private mode — unlocked for this visit only */ }
    onUnlock()
  }

  return (
    <div className="page page-narrow">
      <form className="card admin-lock" onSubmit={submit}>
        <Lock size={28} aria-hidden="true" className="admin-lock-icon" />
        <h1 className="page-title">Admin</h1>
        <p className="text-sm text-muted">Enter the admin password to continue.</p>
        <input
          className="input"
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Admin password"
          value={password}
          onChange={e => { setPassword(e.target.value); setWrong(false) }}
        />
        {wrong && <p className="login-error">That password isn’t right — try again.</p>}
        <Button type="submit" block disabled={!password || checking}>Unlock</Button>
      </form>
    </div>
  )
}

export default function Admin() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('locations')
  const [unlocked, setUnlocked] = useState(isUnlocked)

  if (profile?.role !== 'admin') {
    return (
      <div className="page page-narrow">
        <p className="text-muted">Admin access only.</p>
      </div>
    )
  }

  if (!unlocked) return <AdminLock onUnlock={() => setUnlocked(true)} />

  return (
    <div className="page admin-page">
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
    <div className="admin-layout">
      <div className="admin-side">
      <h2 className="admin-side-title">Add a location</h2>
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
      </div>

      <div className="admin-main">
      {loading ? <Loading /> : (
        <div className="card admin-list admin-list-grid">
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
      </div>

      <Toast message={toast} />
    </div>
  )
}

/* ── Users tab ── */
function UsersTab() {
  const [users,      setUsers]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [toast,      setToast]      = useState(null)
  const [newName,    setNewName]    = useState('')
  const [newTeam,    setNewTeam]    = useState('')

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
   * Adds someone who hasn't signed in yet, so they can be scheduled (and
   * show up in Team week) straight away. It's a placeholder: the first time
   * they sign in, AuthContext.jsx adopts it — matching their email against
   * first.last@ guessed from the full name, else an unambiguous first name —
   * and carries over their team and any weeks already filled in for them.
   */
  async function addPerson() {
    const name = newName.trim().replace(/\s+/g, ' ')
    if (!name) return
    if (!newTeam) return showToast('Pick a team for them too.')
    if (users.some(u => (u.displayName || '').trim().toLowerCase() === name.toLowerCase())) {
      return showToast(`${name} is already on the list.`)
    }
    const id = 'pending-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')
    const person = { displayName: name, team: newTeam, role: 'user', pending: true, createdAt: serverTimestamp() }
    try {
      await setDoc(doc(db, 'users', id), person)
      setUsers(prev => [...prev, { uid: id, ...person }])
      setNewName('')
      showToast(`Added ${name}.`)
    } catch (e) {
      console.error(e)
      showToast('Could not add them — try again.')
    }
  }

  /** Only for people who haven't signed in yet — e.g. a typo when adding them. */
  async function removePerson(u) {
    if (!confirm(`Remove ${u.displayName}? They haven't signed in yet, so this only removes the placeholder.`)) return
    await deleteDoc(doc(db, 'users', u.uid))
    setUsers(prev => prev.filter(x => x.uid !== u.uid))
    showToast(`Removed ${u.displayName}.`)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="admin-layout">
      <div className="admin-side">
      <h2 className="admin-side-title">People</h2>
      <p className="text-sm text-muted">
        Assign teams and roles. Most people pick their team on first sign-in; change it here if needed.
        Admins can update anyone’s schedule from Team week and run the on-call roster.
      </p>

      <h2 className="admin-side-title">Add a person</h2>
      <p className="text-sm text-muted">
        For someone who hasn’t signed in yet, so they can be scheduled now. Use their full name —
        it links to their account automatically when they first sign in.
      </p>
      <input
        className="input"
        placeholder="Full name…"
        value={newName}
        onChange={e => setNewName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && addPerson()}
        aria-label="New person's full name"
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={newTeam} onChange={e => setNewTeam(e.target.value)} aria-label="New person's team" style={{ flex: 1 }}>
          <option value="">Team…</option>
          {TEAMS.map(t => <option key={t} value={t}>{teamLabel(t)}</option>)}
        </select>
        <Button onClick={addPerson}>Add</Button>
      </div>

      </div>

      <div className="admin-main">
      {loading ? <Loading /> : (
        <div className="card admin-list admin-people">
          <div className="admin-item admin-people-head" aria-hidden="true">
            <span>Name</span><span>Team</span><span>Role</span>
          </div>
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
                {u.pending && (
                  <Button variant="ghost" size="sm" className="admin-remove" style={{ color: 'var(--status-critical)' }} onClick={() => removePerson(u)}>Remove</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      <Toast message={toast} />
    </div>
  )
}
