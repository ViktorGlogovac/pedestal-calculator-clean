import React from 'react'
import { Link, useLocation } from 'react-router-dom'

import routes from '../routes'

const AppBreadcrumb = () => {
  const currentLocation = useLocation().pathname

  const getRouteName = (pathname, routeList) => {
    const currentRoute = routeList.find((route) => route.path === pathname)
    return currentRoute ? currentRoute.name : false
  }

  const getBreadcrumbs = (location) => {
    const breadcrumbs = []
    location.split('/').reduce((prev, curr, index, array) => {
      const currentPathname = `${prev}/${curr}`
      const routeName = getRouteName(currentPathname, routes)
      routeName &&
        breadcrumbs.push({
          pathname: currentPathname,
          name: routeName,
          active: index + 1 === array.length,
        })
      return currentPathname
    })
    return breadcrumbs
  }

  const breadcrumbs = getBreadcrumbs(currentLocation)

  return (
    <nav aria-label="breadcrumb" style={{ padding: '6px 0', fontSize: 12, color: 'var(--pc-ink-3, #666)' }}>
      <Link to="/" style={{ color: 'var(--pc-ink-3, #666)', textDecoration: 'none' }}>
        Home
      </Link>
      {breadcrumbs.map((breadcrumb, index) => (
        <span key={index}>
          <span style={{ margin: '0 6px' }}>/</span>
          {breadcrumb.active ? (
            <span style={{ color: 'var(--pc-ink, #111)' }}>{breadcrumb.name}</span>
          ) : (
            <Link
              to={breadcrumb.pathname}
              style={{ color: 'var(--pc-ink-3, #666)', textDecoration: 'none' }}
            >
              {breadcrumb.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}

export default React.memo(AppBreadcrumb)
