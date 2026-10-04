import { useEffect, useRef, useState } from 'react'
import { LogOut, Plane, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { teamLabel } from '../utils/teams'
import { firstName } from '../utils/names'
import { checkForUpdates } from '../utils/appUpdates'
import { APP_VERSION } from '../version'
import { Button } from './ui'

/** Initials from "First Last" (nickname in brackets wins, like the schedule's names). */
function initials(displayName, email) {
  const parts = (displayName || '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean)
  const first = firstName(displayName) || parts[0] || email || '?'
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  return (first[0] + (last[0] || '')).toUpperCase()
}

const UPDATE_TEXT = {
  checking: 'Checking…',
  latest: `You’re on the latest version (v${APP_VERSION}).`,
  offline: 'Can’t check right now — are you online?',
  updating: 'Updating…',
}

/**
 * Header button showing who's signed in, opening a small panel with their
 * name, email, team and a Sign out button. Sign-in is remembered on each
 * device, so this is the way to switch accounts on a shared computer.
 */
export default function AccountMenu() {
  const { user, profile, signOutUser } = useAuth()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [updateStatus, setUpdateStatus] = useState('') // '' | checking | latest | offline | updating
  const ref = useRef(null)

  // Close on a tap anywhere else, or on Escape.
  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!user) return null
  const name = profile?.displayName || user.displayName || user.email

  async function checkUpdates() {
    setUpdateStatus('checking')
    setUpdateStatus(await checkForUpdates())
  }

  async function signOut() {
    setSigningOut(true)
    try {
      await signOutUser()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="account-menu" ref={ref}>
      <button
        type="button"
        className="account-button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Signed in as ${name}`}
        title={`Signed in as ${name}`}
        onClick={() => setOpen(o => !o)}
      >
        {initials(profile?.displayName || user.displayName, user.email)}
      </button>
      {open && (
        <div className="account-panel" role="dialog" aria-label="Your account">
          <span className="overline">Signed in as</span>
          <span className="account-name">{name}</span>
          {user.email && <span className="account-detail">{user.email}</span>}
          <span className="account-detail">
            {profile?.team ? teamLabel(profile.team) : 'No team yet'}{profile?.role === 'admin' ? ' · Admin' : ''}
          </span>
          <Link to="/out-of-town" className="account-link" onClick={() => setOpen(false)}>
            <Plane size={16} aria-hidden="true" />Out-of-town report
          </Link>
          <button
            type="button"
            className="account-action"
            onClick={checkUpdates}
            disabled={updateStatus === 'checking' || updateStatus === 'updating'}
          >
            <RefreshCw size={16} aria-hidden="true" />Check for updates
          </button>
          <span className="account-detail" aria-live="polite">{UPDATE_TEXT[updateStatus] || `Version ${APP_VERSION}`}</span>
          <Button variant="secondary" size="sm" block onClick={signOut} disabled={signingOut} iconLeft={<LogOut size={16} />}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      )}
    </div>
  )
}
