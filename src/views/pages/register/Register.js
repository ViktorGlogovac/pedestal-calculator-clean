import React, { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { useLanguage } from '../../../context/LanguageContext'
import AuthShell from '../auth/AuthShell'

const Register = () => {
  const navigate = useNavigate()
  const { user, signUp, isConfigured } = useAuth()
  const { t } = useLanguage()
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
      setErrorMessage(t('auth.enterAccountPassword'))
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage(t('auth.passwordsMismatch'))
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

    setSuccessMessage(t('auth.accountCreated'))
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit}>
        <h1 className="pc-auth-title">{t('auth.createAccount')}</h1>
        <p className="pc-auth-sub">{t('auth.createAccountSubtitle')}</p>

        {!isConfigured && (
          <div className="pc-auth-alert warn">
            {t('auth.envMissing')}
          </div>
        )}
        {errorMessage && (
          <div className="pc-auth-alert danger">{errorMessage}</div>
        )}
        {successMessage && (
          <div className="pc-auth-alert success">{successMessage}</div>
        )}

        <label className="pc-field">
          <span>{t('auth.email')}</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="pc-field">
          <span>{t('auth.password')}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <label className="pc-field">
          <span>{t('auth.confirmPassword')}</span>
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
          {submitting ? t('auth.creatingAccount') : t('auth.createAccount')}
        </button>

        <div style={{ marginTop: 18, color: 'var(--pc-ink-3)', fontSize: 13 }}>
          {t('auth.alreadyRegistered')}{' '}
          <Link to="/login" className="pc-link-btn">
            {t('auth.signInLink')}
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}

export default Register
