import React, { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import AuthShell from '../auth/AuthShell'

const Login = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, signIn, loading, isConfigured } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const from = location.state?.from?.pathname || '/pedestal-calculator'

  if (user) {
    return <Navigate to={from} replace />
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setErrorMessage('')

    if (!email || !password) {
      setErrorMessage('Enter your email and password.')
      return
    }

    setSubmitting(true)
    const { error } = await signIn(email, password)
    setSubmitting(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    navigate(from, { replace: true })
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit}>
        <h1 className="pc-auth-title">Sign In</h1>
        <p className="pc-auth-sub">Open saved layouts, AI imports, and quote history.</p>

        {!isConfigured && (
          <div className="pc-auth-alert warn">
            Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your env file.
          </div>
        )}
        {errorMessage && (
          <div className="pc-auth-alert danger">{errorMessage}</div>
        )}

        <label className="pc-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="pc-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <button
          className="pc-btn primary lg"
          type="submit"
          disabled={submitting || loading || !isConfigured}
          style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
        >
          {submitting ? 'Signing in...' : 'Sign In'}
        </button>

        <div style={{ marginTop: 18, color: 'var(--pc-ink-3)', fontSize: 13 }}>
          Need an account?{' '}
          <Link to="/register" className="pc-link-btn">
            Create one
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}

export default Login
