import React from 'react'
import { Link } from 'react-router-dom'

const Page404 = () => {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--pc-bg, #f5f5f3)',
        fontFamily: 'var(--pc-font-sans, sans-serif)',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 72, fontWeight: 700, color: 'var(--pc-ink, #111)', lineHeight: 1 }}>
          404
        </div>
        <h4 style={{ margin: '12px 0 8px', color: 'var(--pc-ink, #111)' }}>
          {"Oops! You're lost."}
        </h4>
        <p style={{ color: 'var(--pc-ink-3, #666)', marginBottom: 24 }}>
          The page you are looking for was not found.
        </p>
        <Link
          to="/"
          className="pc-btn primary"
          style={{ textDecoration: 'none', display: 'inline-flex' }}
        >
          Go Home
        </Link>
      </div>
    </div>
  )
}

export default Page404
