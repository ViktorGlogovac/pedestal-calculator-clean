import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useProject } from '../../context/ProjectContext'
import { deleteProject, listProjects } from '../../lib/projectService'

const MyProjects = () => {
  const { user, isConfigured } = useAuth()
  const { projects, setProjects, activeProjectId, setPendingLoadId } = useProject()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!user || !isConfigured) return
    setLoading(true)
    listProjects(user.id).then(({ data, error: err }) => {
      setLoading(false)
      if (err) { setError(err.message); return }
      setProjects(data)
    })
  }, [user, isConfigured, setProjects])

  const handleLoad = (projectId) => {
    setPendingLoadId(projectId)
    navigate('/pedestal-calculator')
  }

  const handleDelete = async (projectId, projectName) => {
    if (!window.confirm(`Delete "${projectName}"? This cannot be undone.`)) return
    const { error: err } = await deleteProject(projectId, user.id)
    if (err) { setError(err.message); return }
    setProjects((prev) => prev.filter((p) => p.id !== projectId))
    setNotice(`Deleted "${projectName}".`)
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#0F172A', margin: 0 }}>My Projects</h2>
        <p style={{ color: '#64748B', marginTop: '4px', marginBottom: 0 }}>
          {projects.length > 0
            ? `${projects.length} saved project${projects.length !== 1 ? 's' : ''}`
            : 'No saved projects yet'}
        </p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'oklch(96% 0.03 25)', color: 'oklch(40% 0.14 25)', border: '1px solid oklch(85% 0.08 25)', marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
          {error}
          <button type="button" onClick={() => setError('')} style={{ background: 'transparent', border: 0, cursor: 'pointer', color: 'inherit', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8 }}>×</button>
        </div>
      )}
      {notice && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'oklch(96% 0.04 150)', color: 'oklch(40% 0.12 150)', border: '1px solid oklch(85% 0.08 150)', marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
          {notice}
          <button type="button" onClick={() => setNotice('')} style={{ background: 'transparent', border: 0, cursor: 'pointer', color: 'inherit', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8 }}>×</button>
        </div>
      )}

      {!isConfigured && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'oklch(96% 0.03 80)', color: 'oklch(38% 0.1 65)', border: '1px solid oklch(85% 0.08 80)', marginBottom: 12 }}>
          Supabase is not configured. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to enable project saving.
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748B', padding: '40px 0', textAlign: 'center' }}>Loading projects…</div>
      ) : projects.length === 0 ? (
        <div style={{ border: '1px dashed #CBD5E1', backgroundColor: '#F8FAFC', borderRadius: 12, textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📂</div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: '#475569', marginBottom: '8px' }}>No saved projects</div>
          <div style={{ fontSize: '14px', color: '#94A3B8', marginBottom: '20px' }}>
            Save a project from the calculator to see it here.
          </div>
          <button
            type="button"
            onClick={() => navigate('/pedestal-calculator')}
            style={{
              padding: '10px 20px',
              backgroundColor: '#0F172A',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Go to Calculator
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {projects.map((project) => {
            const isActive = project.id === activeProjectId
            return (
              <div
                key={project.id}
                style={{
                  border: isActive ? '2px solid #2563EB' : '1px solid #E2E8F0',
                  backgroundColor: isActive ? '#EFF6FF' : '#fff',
                  borderRadius: 12,
                  transition: 'box-shadow 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '16px 20px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      {isActive && (
                        <span style={{
                          backgroundColor: '#DBEAFE',
                          color: '#1D4ED8',
                          fontSize: '11px',
                          fontWeight: '700',
                          padding: '2px 8px',
                          borderRadius: '10px',
                        }}>
                          Active
                        </span>
                      )}
                      <span style={{ fontSize: '16px', fontWeight: '600', color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {project.name}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                      Last updated: {new Date(project.updated_at).toLocaleString()}
                    </div>
                    <div style={{ fontSize: '12px', color: '#CBD5E1', marginTop: '2px' }}>
                      Created: {new Date(project.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => handleLoad(project.id)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: isActive ? '#DBEAFE' : '#0F172A',
                        color: isActive ? '#1D4ED8' : '#fff',
                        border: isActive ? '1px solid #BFDBFE' : 'none',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      {isActive ? 'Reload' : 'Load'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(project.id, project.name)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#fff',
                        color: '#B91C1C',
                        border: '1px solid #FECACA',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default MyProjects
