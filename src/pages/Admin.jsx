import { useState, useEffect } from 'react'
import {
  collection, getDocs, addDoc, deleteDoc, doc, updateDoc,
  query, orderBy, serverTimestamp
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import Toast from '../components/Toast'
import { TEAMS } from '../utils/teams'

export default function Admin() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('locations')

  if (profile?.role !== 'admin') {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p className="text-muted">Admin access only.</p>
      </div>
    )
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Admin</div>
      </div>

      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
        {['locations', 'users'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '10px 0', fontSize: 14, background: 'none',
              border: 'none', cursor: 'pointer', color: tab === t ? 'var(--text)' : 'var(--text-3)',
              fontWeight: tab === t ? 500 : 400,
              borderBottom: tab === t ? '2px solid var(--text)' : '2px solid transparent',
              textTransform: 'capitalize', fontFamily: 'inherit'
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'locations' && <LocationsTab />}
      {tab === 'users'     && <UsersTab />}
    </>
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
    <div style={{ paddingBottom: 24 }}>
      <div className="section-header">Locations</div>
      <p className="text-sm text-muted px-16" style={{ marginBottom: 12, lineHeight: 1.5 }}>
        Manage the dropdown options people see when filling out their schedule.
        Hiding a location won't affect already-saved schedules.
      </p>

      {/* Add new */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 16px' }}>
        <input
          className="input"
          placeholder="New location name…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addLocation()}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary" onClick={addLocation}>Add</button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
          <div className="spinner" />
        </div>
      ) : (
        <div className="card" style={{ margin: '0 16px' }}>
          {locations.length === 0 && (
            <p className="text-sm text-muted" style={{ padding: 16 }}>No locations yet.</p>
          )}
          {locations.map((loc, i) => (
            <div key={loc.id} className="admin-item" style={{ opacity: loc.active ? 1 : 0.45 }}>
              <div>
                <span style={{ fontSize: 14 }}>{loc.name}</span>
                {!loc.active && <span className="text-sm text-muted" style={{ marginLeft: 8 }}>hidden</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" onClick={() => toggleActive(loc)}>
                  {loc.active ? 'Hide' : 'Show'}
                </button>
                <button
                  className="btn btn-sm"
                  style={{ color: 'var(--leave-text)', borderColor: 'var(--leave-bg)' }}
                  onClick={() => removeLocation(loc)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <Toast message={toast} />}
    </div>
  )
}

/* ── Users tab ── */
function UsersTab() {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [toast,   setToast]   = useState(null)

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

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="section-header">People</div>
      <p className="text-sm text-muted px-16" style={{ marginBottom: 12, lineHeight: 1.5 }}>
        Assign teams and roles. Most people pick their team on first sign-in; change it here if needed.
      </p>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
          <div className="spinner" />
        </div>
      ) : (
        <div className="card" style={{ margin: '0 16px' }}>
          {users.map(u => (
            <div key={u.uid} className="admin-item" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.displayName || '(no name)'}
                  {u.fcmTokens?.length > 0 && (
                    <span title="Push reminders enabled" style={{ marginLeft: 6 }}>🔔</span>
                  )}
                </div>
                <div className="text-sm text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.email}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  value={u.team || ''}
                  onChange={e => { updateUser(u.uid, 'team', e.target.value || null); showToast('Saved') }}
                  style={{ width: 120, fontSize: 13 }}
                >
                  <option value="">No team</option>
                  {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select
                  value={u.role || 'user'}
                  onChange={e => { updateUser(u.uid, 'role', e.target.value); showToast('Saved') }}
                  style={{ width: 90, fontSize: 13 }}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <Toast message={toast} />}
    </div>
  )
}
