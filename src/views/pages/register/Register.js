import React, { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import AuthShell from '../auth/AuthShell'

const Register = () => {
  const navigate = useNavigate()
  const { user, signUp, isConfigured } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  if (user) {
    return <Navigate to="/pedestal-calculator" replace />
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')

    if (!email || !password) {
      setErrorMessage('Enter an email and password.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const { data, error } = await signUp(email, password)
    setSubmitting(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    if (data.session) {
      navigate('/pedestal-calculator', { replace: true })
      return
    }

    setSuccessMessage('Account created. Check your email if confirmation is enabled in Supabase.')
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit}>
        <h1 className="pc-auth-title">Create Account</h1>
        <p className="pc-auth-sub">Save project revisions and return to quotes later.</p>

        {!isConfigured && (
          <div className="pc-auth-alert warn">
            Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your env file.
          </div>
        )}
        {errorMessage && (
          <div className="pc-auth-alert danger">{errorMessage}</div>
        )}
        {successMessage && (
          <div className="pc-auth-alert success">{successMessage}</div>
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
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <label className="pc-field">
          <span>Confirm Password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>

        <button
          className="pc-btn primary lg"
          type="submit"
          disabled={submitting || !isConfigured}
          style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
        >
          {submitting ? 'Creating account...' : 'Create Account'}
        </button>

        <div style={{ marginTop: 18, color: 'var(--pc-ink-3)', fontSize: 13 }}>
          Already registered?{' '}
          <Link to="/login" className="pc-link-btn">
            Sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}

export default Register
