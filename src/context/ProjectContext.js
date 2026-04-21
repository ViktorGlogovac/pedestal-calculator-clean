import React, { createContext, useContext, useState } from 'react'

const ProjectContext = createContext(null)

export const ProjectProvider = ({ children }) => {
  const [projects, setProjects] = useState([])
  const [activeProjectId, setActiveProjectId] = useState(null)
  const [activeProjectName, setActiveProjectName] = useState('Untitled Project')
  const [pendingLoadId, setPendingLoadId] = useState(null)

  return (
    <ProjectContext.Provider
      value={{
        projects,
        setProjects,
        activeProjectId,
        setActiveProjectId,
        activeProjectName,
        setActiveProjectName,
        pendingLoadId,
        setPendingLoadId,
      }}
    >
      {children}
    </ProjectContext.Provider>
  )
}

export const useProject = () => useContext(ProjectContext)
