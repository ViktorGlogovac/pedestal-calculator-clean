import React from 'react'

const Typography = React.lazy(() => import('./views/theme/typography/Typography'))
const MyProjects = React.lazy(() => import('./views/projects/MyProjects'))

const routes = [
  { path: '/pedestal-calculator', nameKey: 'nav.pedestalCalculator', element: Typography },
  { path: '/my-projects', nameKey: 'nav.myProjects', element: MyProjects },
]

export default routes
