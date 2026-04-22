import React from 'react'
import { AppContent } from '../components/index'

const DefaultLayout = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <AppContent />
    </div>
  )
}

export default DefaultLayout
