import React from 'react'
import { useSelector, useDispatch } from 'react-redux'

import { AppSidebarNav } from './AppSidebarNav'
import enmonLogo from 'src/assets/brand/enmon-logo.svg'
import navigation from '../_nav'

const SIDEBAR_WIDTH = 256

const AppSidebar = () => {
  const dispatch = useDispatch()
  const sidebarShow = useSelector((state) => state.sidebarShow)

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: SIDEBAR_WIDTH,
        background: '#4a5061',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1030,
        transform: sidebarShow ? 'translateX(0)' : `translateX(-${SIDEBAR_WIDTH}px)`,
        transition: 'transform 0.15s',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px 0',
          minHeight: 100,
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          flexShrink: 0,
        }}
      >
        <img src={enmonLogo} alt="Enmon Logo" style={{ height: 70, maxWidth: 200 }} />
      </div>

      <AppSidebarNav items={navigation} />

      <div
        style={{
          borderTop: '1px solid rgba(255,255,255,0.1)',
          padding: '12px 16px',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => dispatch({ type: 'set', sidebarShow: false })}
          style={{
            width: '100%',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.2)',
            color: 'rgba(255,255,255,0.6)',
            borderRadius: 6,
            padding: '7px 12px',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          ← Collapse
        </button>
      </div>
    </div>
  )
}

export default React.memo(AppSidebar)
