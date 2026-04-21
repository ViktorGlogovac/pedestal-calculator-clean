import React from 'react'
import { useSelector } from 'react-redux'
import { AppContent, AppSidebar } from '../components/index'

const SIDEBAR_WIDTH = 256

const DefaultLayout = () => {
  const sidebarShow = useSelector((state) => state.sidebarShow)

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <AppSidebar />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          marginLeft: sidebarShow ? SIDEBAR_WIDTH : 0,
          transition: 'margin-left 0.15s',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ flex: 1, padding: '12px' }}>
          <AppContent />
        </div>
      </div>
    </div>
  )
}

export default DefaultLayout
