import React, { useRef, useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import avatar8 from './../../assets/images/avatars/8.jpg'

const AppHeaderDropdown = () => {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <img
          src={avatar8}
          alt="User"
          style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            background: 'var(--pc-surface, #fff)',
            border: '1px solid var(--pc-line, #e5e5e5)',
            borderRadius: 8,
            boxShadow: 'var(--pc-shadow-2, 0 8px 24px rgba(0,0,0,0.1))',
            minWidth: 180,
            zIndex: 1040,
            padding: '4px 0',
            fontSize: 13,
            color: 'var(--pc-ink, #111)',
          }}
        >
          {user?.email && (
            <div
              style={{
                padding: '8px 14px',
                borderBottom: '1px solid var(--pc-line, #e5e5e5)',
                fontSize: 12,
                color: 'var(--pc-ink-3, #666)',
                marginBottom: 4,
              }}
            >
              {user.email}
            </div>
          )}
          <button
            type="button"
            onClick={async () => {
              setOpen(false)
              await signOut()
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 14px',
              background: 'transparent',
              border: 0,
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--pc-ink-2, #333)',
            }}
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  )
}

export default AppHeaderDropdown
