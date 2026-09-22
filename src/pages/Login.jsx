import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { signInWithMicrosoft } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  async function handleSignIn() {
    setLoading(true)
    setError(null)
    try {
      await signInWithMicrosoft()
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') {
        console.error('Sign-in error:', e.code, e.message, e)
        const detail = e.code ? `${e.code}: ${e.message}` : e.message
        setError(`Sign-in failed. ${detail || 'Try again or contact your admin.'}`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-logo">📍</div>
      <div>
        <h1 className="login-title">Where This Week</h1>
        <p className="login-sub mt-8">
          Let your team know where you'll be each day.
        </p>
      </div>

      {error && (
        <p style={{ color: 'var(--leave-text)', fontSize: 14 }}>{error}</p>
      )}

      <button
        className="btn btn-primary"
        style={{ width: '100%', maxWidth: 280, padding: '13px 20px', fontSize: 15 }}
        onClick={handleSignIn}
        disabled={loading}
      >
        {loading ? (
          <span className="spinner" style={{ width: 18, height: 18 }} />
        ) : (
          <>
            <MicrosoftIcon />
            Sign in with Microsoft
          </>
        )}
      </button>

      <p className="text-sm text-muted" style={{ maxWidth: 280 }}>
        Uses your existing company account — no new password needed.
      </p>
    </div>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
      <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
    </svg>
  )
}
