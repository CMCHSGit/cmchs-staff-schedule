import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { TEAMS, getTeamConfig } from '../utils/teams'

function hasTeam(profile) {
  return Boolean(profile?.team?.trim())
}

export default function TeamOnboarding() {
  const { user, profile, profileReady, refreshProfile, patchProfile } = useAuth()
  const [selected, setSelected] = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  // Wait for Firestore profile — avoids showing popup on every refresh while profile is null
  if (!user || !profileReady || hasTeam(profile)) return null

  async function saveTeam() {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      await updateDoc(doc(db, 'users', user.uid), { team: selected })
      patchProfile({ team: selected })
      await refreshProfile()
    } catch (e) {
      setError('Could not save — try again.')
    } finally {
      setSaving(false)
    }
  }

  const preview = getTeamConfig(selected)

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <h2 className="onboarding-title">Which team are you on?</h2>
        <p className="text-sm text-muted" style={{ lineHeight: 1.5, marginBottom: 16 }}>
          We’ll remember this for next time. Your schedule defaults and team view will match your group.
        </p>

        <div className="onboarding-teams">
          {TEAMS.map(team => {
            const cfg = getTeamConfig(team)
            return (
              <button
                key={team}
                type="button"
                className={`onboarding-team${selected === team ? ' selected' : ''}`}
                style={{ '--team-color': cfg?.color }}
                onClick={() => setSelected(team)}
              >
                <span className="onboarding-team-name">{team}</span>
                <span className="onboarding-team-hint">{cfg?.hint}</span>
              </button>
            )
          })}
        </div>

        {preview && (
          <p className="text-sm text-muted" style={{ marginTop: 12, lineHeight: 1.4 }}>
            {preview.defaultLocation
              ? `New weeks default to “${preview.defaultLocation}”.`
              : 'You’ll choose a location for each day.'}
          </p>
        )}

        {error && <p style={{ color: 'var(--leave-text)', fontSize: 14, marginTop: 12 }}>{error}</p>}

        <button
          className="btn btn-primary btn-full"
          style={{ marginTop: 20, padding: 13 }}
          disabled={!selected || saving}
          onClick={saveTeam}
        >
          {saving ? <span className="spinner" style={{ width: 18, height: 18, borderTopColor: 'var(--bg)' }} /> : 'Continue'}
        </button>
      </div>
    </div>
  )
}
