import { useState, useEffect } from 'react'
import {
  collection, getDocs, addDoc, deleteDoc, doc, setDoc, updateDoc,
  query, orderBy, serverTimestamp
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import Toast from '../components/Toast'
import { TEAMS } from '../utils/teams'
import { APP_VERSION } from '../version'

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
        <div className="topbar-title" style={{ color: 'var(--admin-color)' }}>Admin</div>
      </div>

      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
        {['locations', 'users'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '10px 0', fontSize: 14, background: 'none',
              border: 'none', cursor: 'pointer', color: tab === t ? 'var(--admin-color)' : 'var(--text-3)',
              fontWeight: tab === t ? 500 : 400,
              borderBottom: tab === t ? '2px solid var(--admin-color)' : '2px solid transparent',
              textTransform: 'capitalize', fontFamily: 'inherit'
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'locations' && <LocationsTab />}
      {tab === 'users'     && <UsersTab />}

      <p className="text-sm text-muted" style={{ textAlign: 'center', padding: '24px 16px' }}>
        CMCHS Staff Schedule v{APP_VERSION}
      </p>
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
  const [users,      setUsers]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [toast,      setToast]      = useState(null)
  const [rosterText, setRosterText] = useState('')
  const [showImport, setShowImport] = useState(false)

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

      <div style={{ padding: '0 16px 16px' }}>
        <button className="btn btn-sm" onClick={() => setShowImport(v => !v)}>
          {showImport ? 'Cancel import' : 'Import staff from Excel'}
        </button>
        {showImport && (
          <div style={{ marginTop: 8 }}>
            <p className="text-sm text-muted" style={{ marginBottom: 6, lineHeight: 1.4 }}>
              Paste one person per line, as <code>Name, Team</code> — e.g. <code>Karen, Admin</code>
              or <code>Mark Henderwood, Application</code> for someone who shares a first name
              with someone else on the list. Adds a placeholder for anyone who hasn't signed in
              yet (safe to run more than once — already-imported or already-real people are
              skipped). When someone first signs in for real, this app automatically finds and
              adopts their matching placeholder's team — by email guess (first.last@) when a
              full name was pasted, otherwise by first name, and only when that's unambiguous.
              A first-name-only entry that turns out to collide with someone else is left for
              you to sort out by hand rather than guessed at.
            </p>
            <textarea
              className="input"
              rows={8}
              style={{ fontFamily: 'monospace', fontSize: 13 }}
              placeholder={'Karen, Admin\nJan, Admin\nMark, Management\n...'}
              value={rosterText}
              onChange={e => setRosterText(e.target.value)}
            />
            <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={importFromExcel}>
              Import
            </button>
          </div>
        )}
      </div>

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
                  {u.pending ? '⏳ Not signed in yet' : u.email}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <select
                  value={u.team || ''}
                  onChange={e => { updateUser(u.uid, 'team', e.target.value || null); showToast('Saved') }}
                  style={{ width: 132, fontSize: 16 }}
                >
                  <option value="">No team</option>
                  {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select
                  value={u.role || 'user'}
                  onChange={e => { updateUser(u.uid, 'role', e.target.value); showToast('Saved') }}
                  style={{ width: 100, fontSize: 16 }}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <input
                  className="input"
                  defaultValue={u.excelName || ''}
                  placeholder="Excel name"
                  title="First name as it appears in the Excel schedule's Name column — used to sync this person's saves into the right row. Leave blank to skip syncing them."
                  onBlur={e => {
                    const val = e.target.value.trim()
                    if (val !== (u.excelName || '')) {
                      updateUser(u.uid, 'excelName', val || null)
                      showToast('Saved')
                    }
                  }}
                  style={{ width: 110, fontSize: 16 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <Toast message={toast} />}
    </div>
  )
}
