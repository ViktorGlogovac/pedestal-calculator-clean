import React from 'react'
import PropTypes from 'prop-types'

const AuthShell = ({ children }) => {
  return (
    <div className="pc-root pc-auth">
      <section className="pc-auth-hero">
        <div className="pc-auth-logo">
          <span className="pc-auth-logo-mark">P</span>
          <span>Pedestal Calc</span>
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'rgba(245,244,239,0.56)', marginBottom: 12 }}>
            Deck takeoffs, pedestal schedules, and quote-ready layouts.
          </div>
          <div className="pc-auth-deck" aria-hidden="true">
            {Array.from({ length: 30 }).map((_, index) => (
              <span
                key={index}
                className={`tile${[2, 8, 13, 19, 25].includes(index) ? ' ped' : ''}`}
              />
            ))}
          </div>
          <blockquote className="pc-auth-testimonial">
            Built for fast rooftop layout review without losing the project history.
            <span className="author">ENMON project workspace</span>
          </blockquote>
        </div>

        <div className="pc-auth-trust">
          <span className="pc-auth-trust-item">
            <span className="dot" /> Saved projects
          </span>
          <span className="pc-auth-trust-item">
            <span className="dot" /> AI plan import
          </span>
          <span className="pc-auth-trust-item">
            <span className="dot" /> PDF quotes
          </span>
        </div>
      </section>

      <main className="pc-auth-form">
        <div className="pc-auth-form-inner">{children}</div>
      </main>
    </div>
  )
}

export default AuthShell

AuthShell.propTypes = {
  children: PropTypes.node.isRequired,
}
