import React, { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { useLanguage } from '../../../context/LanguageContext'
import AuthShell from '../auth/AuthShell'

const Login = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, isGuest, signIn, continueAsGuest, loading, isConfigured } = useAuth()
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const from = location.state?.from?.pathname || '/pedestal-calculator'

  if (user || isGuest) {
    return <Navigate to={from} replace />
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setErrorMessage('')

    if (!email || !password) {
      setErrorMessage(t('auth.enterEmailPassword'))
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

  const handleGuest = () => {
    continueAsGuest()
    navigate(from, { replace: true })
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit}>
        <h1 className="pc-auth-title">{t('auth.signIn')}</h1>
        <p className="pc-auth-sub">{t('auth.signInSubtitle')}</p>

        {!isConfigured && (
          <div className="pc-auth-alert warn">
            {t('auth.envMissing')}
          </div>
        )}
        {errorMessage && (
          <div className="pc-auth-alert danger">{errorMessage}</div>
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
          {submitting ? t('auth.signingIn') : t('auth.signIn')}
        </button>

        <button
          className="pc-btn lg"
          type="button"
          onClick={handleGuest}
          disabled={submitting || loading}
          style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
        >
          {t('auth.continueAsGuest')}
        </button>

        <div style={{ marginTop: 18, color: 'var(--pc-ink-3)', fontSize: 13 }}>
          {t('auth.needAccount')}{' '}
          <Link to="/register" className="pc-link-btn">
            {t('auth.createOne')}
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}

export default Login
