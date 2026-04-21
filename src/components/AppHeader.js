import React, { useEffect, useRef, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'

import { AppBreadcrumb } from './index'
import { AppHeaderDropdown } from './header/index'

const useTheme = () => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('pc-theme') || 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('pc-theme', theme)
  }, [theme])

  return { theme, setTheme }
}

const AppHeader = () => {
  const headerRef = useRef()
  const { theme, setTheme } = useTheme()
  const dispatch = useDispatch()
  const sidebarShow = useSelector((state) => state.sidebarShow)

  useEffect(() => {
    const handler = () => {
      if (headerRef.current) {
        headerRef.current.style.boxShadow =
          document.documentElement.scrollTop > 0
            ? '0 2px 8px rgba(0,0,0,0.08)'
            : 'none'
      }
    }
    document.addEventListener('scroll', handler)
    return () => document.removeEventListener('scroll', handler)
  }, [])

  return (
    <header
      ref={headerRef}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1020,
        background: 'var(--pc-surface, #fff)',
        borderBottom: '1px solid var(--pc-line, #e5e5e5)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'box-shadow 0.15s',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 16px',
          minHeight: 52,
          borderBottom: '1px solid var(--pc-line, #e5e5e5)',
        }}
      >
        <button
          type="button"
          onClick={() => dispatch({ type: 'set', sidebarShow: !sidebarShow })}
          style={{
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            padding: '6px 4px',
            color: 'var(--pc-ink-2, #333)',
            fontSize: 18,
            lineHeight: 1,
            marginLeft: -4,
          }}
          aria-label="Toggle sidebar"
        >
          ☰
        </button>

        <div style={{ flex: 1 }} />

        <ThemeToggle theme={theme} setTheme={setTheme} />

        <div style={{ width: 1, height: 20, background: 'var(--pc-line, #e5e5e5)', margin: '0 4px' }} />

        <AppHeaderDropdown />
      </div>

      <div style={{ padding: '4px 16px' }}>
        <AppBreadcrumb />
      </div>
    </header>
  )
}

const ThemeToggle = ({ theme, setTheme }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const icon = theme === 'dark' ? '🌙' : theme === 'auto' ? '⚙' : '☀'

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          fontSize: 16,
          padding: 4,
          color: 'var(--pc-ink-2, #333)',
        }}
        aria-label="Toggle theme"
      >
        {icon}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            background: 'var(--pc-surface, #fff)',
            border: '1px solid var(--pc-line, #e5e5e5)',
            borderRadius: 8,
            boxShadow: 'var(--pc-shadow-2, 0 8px 24px rgba(0,0,0,0.1))',
            zIndex: 1040,
            padding: '4px 0',
            minWidth: 120,
          }}
        >
          {[
            { value: 'light', label: '☀ Light' },
            { value: 'dark', label: '🌙 Dark' },
            { value: 'auto', label: '⚙ Auto' },
          ].map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTheme(value === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value)
                setOpen(false)
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 14px',
                background: theme === value ? 'var(--pc-surface-3, #f0f0ed)' : 'transparent',
                border: 0,
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--pc-ink-2, #333)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default AppHeader
