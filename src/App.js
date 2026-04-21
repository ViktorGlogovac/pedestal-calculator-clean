import React, { Suspense } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'

import './scss/style.scss'
import RequireAuth from './components/RequireAuth'

const DefaultLayout = React.lazy(() => import('./layout/DefaultLayout'))
const Login = React.lazy(() => import('./views/pages/login/Login'))
const Register = React.lazy(() => import('./views/pages/register/Register'))
const Page404 = React.lazy(() => import('./views/pages/page404/Page404'))
const Page500 = React.lazy(() => import('./views/pages/page500/Page500'))

const App = () => {
  return (
    <HashRouter>
      <Suspense
        fallback={
          <div style={{ paddingTop: 40, textAlign: 'center' }}>
            <span className="app-spinner" />
          </div>
        }
      >
        <Routes>
          <Route exact path="/login" name="Login Page" element={<Login />} />
          <Route exact path="/register" name="Register Page" element={<Register />} />
          <Route exact path="/404" name="Page 404" element={<Page404 />} />
          <Route exact path="/500" name="Page 500" element={<Page500 />} />
          <Route
            path="*"
            name="Home"
            element={
              <RequireAuth>
                <DefaultLayout />
              </RequireAuth>
            }
          />
        </Routes>
      </Suspense>
    </HashRouter>
  )
}

export default App
