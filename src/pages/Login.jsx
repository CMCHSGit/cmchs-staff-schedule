import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Button, Logo, StripeRule, Spinner } from '../components/ui'

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
      <StripeRule thickness={6} />
      <div className="login-body">
        <Logo width={220} />
        <div>
          <h1 className="login-title">Staff schedule</h1>
          <p className="login-sub">Let your team know where you’ll be each day.</p>
        </div>

        {error && <p className="login-error">{error}</p>}

        <Button size="lg" block onClick={handleSignIn} disabled={loading} style={{ maxWidth: 300 }} iconLeft={!loading && <MicrosoftIcon />}>
          {loading ? <Spinner size={20} light /> : 'Sign in with Microsoft'}
        </Button>

        <p className="text-sm text-muted" style={{ maxWidth: 300 }}>
          Uses your existing company account — no new password needed.
        </p>
      </div>
    </div>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
      <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
    </svg>
  )
}
