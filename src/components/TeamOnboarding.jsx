import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { TEAMS, getTeamConfig, teamLabel } from '../utils/teams'
import { Button, StripeRule, Spinner } from './ui'

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
      <div className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <StripeRule thickness={5} />
        <div className="onboarding-inner">
          <h2 className="onboarding-title" id="onboarding-title">Which team are you on?</h2>
          <p className="text-sm text-muted">
            We’ll remember this for next time. It puts you in the right group on the team schedule.
          </p>

          <div className="onboarding-teams">
            {TEAMS.map(team => {
              const cfg = getTeamConfig(team)
              return (
                <button
                  key={team}
                  type="button"
                  className={`onboarding-team${selected === team ? ' selected' : ''}`}
                  onClick={() => setSelected(team)}
                >
                  <span className="wk-band" style={{ background: cfg?.color }} />
                  <span>
                    <span className="onboarding-team-name">{teamLabel(team)}</span>
                    <span className="onboarding-team-hint">{cfg?.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {preview && (
            <p className="text-sm text-muted">
              {preview.defaultLocation
                ? `Most days default to “${preview.defaultLocation}”.`
                : 'You’ll choose a location for each day.'}
            </p>
          )}

          {error && <p className="login-error">{error}</p>}

          <Button block disabled={!selected || saving} onClick={saveTeam}>
            {saving ? <Spinner size={18} light /> : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  )
}
