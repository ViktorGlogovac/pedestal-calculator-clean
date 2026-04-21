import React from 'react'

const Typography = React.lazy(() => import('./views/theme/typography/Typography'))
const MyProjects = React.lazy(() => import('./views/projects/MyProjects'))

const routes = [
  { path: '/pedestal-calculator', name: 'Pedestal Calculator', element: Typography },
  { path: '/my-projects', name: 'My Projects', element: MyProjects },
]

export default routes
