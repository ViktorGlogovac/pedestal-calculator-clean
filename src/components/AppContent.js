import React, { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import routes from '../routes'

const AppContent = () => {
  return (
    <div style={{ width: '100%' }}>
      <Suspense
        fallback={
          <div style={{ paddingTop: 40, textAlign: 'center' }}>
            <span className="app-spinner" />
          </div>
        }
      >
        <Routes>
          {routes.map((route, idx) => {
            return (
              route.element && (
                <Route
                  key={idx}
                  path={route.path}
                  exact={route.exact}
                  name={route.name}
                  element={<route.element />}
                />
              )
            )
          })}
          <Route path="/" element={<Navigate to="pedestal-calculator" replace />} />
        </Routes>
      </Suspense>
    </div>
  )
}

export default React.memo(AppContent)
