// PedestalCalculatorMain.js
import React, { useState, useCallback, useEffect } from 'react'
import PropTypes from 'prop-types'
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../../../components/Modal'
import PedestalGrid from './PedestalGrid'
import QuoteStep from './QuoteStep'
import TileLayout from './TileLayout'
import PedestalHeightAdjuster from './PedestalHeightAdjuster'
import { useAuth } from '../../../context/AuthContext'
import { useProject } from '../../../context/ProjectContext'
import { buildProjectState, applyProjectState, clearProjectDraft } from '../../../lib/projectState'
import { deleteProject, getProject, listProjects, saveProject } from '../../../lib/projectService'
import AIDesignImport from './AIDesignImport'

const PedestalCalculatorMain = () => {
  const { user, signOut, isConfigured } = useAuth()
  const {
    projects,
    setProjects,
    activeProjectId,
    setActiveProjectId,
    activeProjectName,
    setActiveProjectName,
    pendingLoadId,
    setPendingLoadId,
  } = useProject()
  const [step, setStep] = useState(1)
  const [showInstructions, setShowInstructions] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const totalSteps = 4

  // Shared zoom and pan state across all steps
  const [zoom, setZoom] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const setSmoothZoom = useCallback((zoomValue) => {
    const clampZoom = (value) => Math.min(4, Math.max(0.25, value))
    setZoom((prev) => clampZoom(typeof zoomValue === 'function' ? zoomValue(prev) : zoomValue))
  }, [])

  // Load initial state from localStorage
  const getInitialPoints = () => {
    try {
      const saved = localStorage.getItem('pedestal_points')
      if (saved) return JSON.parse(saved)
    } catch (e) {}
    return []
  }
  const getInitialGridSize = () => {
    try {
      const saved = localStorage.getItem('pedestal_gridSize')
      if (saved) return parseInt(saved)
    } catch (e) {}
    return 35
  }
  const getInitialUnitSystem = () => {
    try {
      const saved = localStorage.getItem('pedestal_unitSystem')
      if (saved) return saved
    } catch (e) {}
    return 'imperial'
  }
  const getInitialCalcData = () => {
    let adjustedPedestals = {}
    try {
      const saved = localStorage.getItem('pedestal_adjustedPedestals')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          adjustedPedestals = parsed
        }
      }
    } catch (e) {}
    return {
      tiles: [],
      pedestals: [],
      userPolygon: [],
      tileCount: 0,
      adjustedPedestals,
    }
  }

  const [points, setPoints] = useState(getInitialPoints())
  const [gridSize, setGridSize] = useState(getInitialGridSize())
  const [unitSystem, setUnitSystem] = useState(getInitialUnitSystem())
  const [calcData, setCalcData] = useState(getInitialCalcData())
  const [projectRevision, setProjectRevision] = useState(0)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectNameInput, setProjectNameInput] = useState('')
  const [saveModalVisible, setSaveModalVisible] = useState(false)
  const [saveAsMode, setSaveAsMode] = useState(false)
  const [projectNotice, setProjectNotice] = useState('')
  const [projectError, setProjectError] = useState('')
  const [projectSubmitting, setProjectSubmitting] = useState(false)
  const [editingProjectName, setEditingProjectName] = useState(false)
  const [aiImportVisible, setAiImportVisible] = useState(false)

  // Persist to localStorage on change
  useEffect(() => {
    localStorage.setItem('pedestal_points', JSON.stringify(points))
  }, [points])
  useEffect(() => {
    localStorage.setItem('pedestal_gridSize', gridSize)
  }, [gridSize])
  useEffect(() => {
    localStorage.setItem('pedestal_unitSystem', unitSystem)
  }, [unitSystem])
  useEffect(() => {
    localStorage.setItem(
      'pedestal_adjustedPedestals',
      JSON.stringify(calcData.adjustedPedestals || {}),
    )
  }, [calcData.adjustedPedestals])

  const refreshProjects = useCallback(async () => {
    if (!isConfigured || !user) return
    setProjectsLoading(true)
    const { data, error } = await listProjects(user.id)
    setProjectsLoading(false)
    if (error) {
      setProjectError(error.message)
      return
    }
    setProjects(data)
  }, [isConfigured, user])

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  // Load a project when the sidebar requests it
  useEffect(() => {
    if (!pendingLoadId) return
    handleLoadProject(pendingLoadId)
    setPendingLoadId(null)
  }, [pendingLoadId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Steps data (number + label)
  const steps = [
    { number: 1, label: 'Outline' },
    { number: 2, label: 'Tiles' },
    { number: 3, label: 'Heights' },
    { number: 4, label: 'Quote' },
  ]

  const stepInstructions = {
    1: {
      title: 'Outline',
      content:
        'Draw your desired layout on the grid. Click and drag to create shapes. You can create multiple shapes to represent different areas of your space. Use the grid size controls to adjust the scale of your design.',
    },
    2: {
      title: 'Tile Layout',
      content:
        "In this step, you'll see how tiles will be arranged in your design. The system will automatically calculate the optimal tile placement based on your design. You can adjust tile sizes and patterns here.",
    },
    3: {
      title: 'Pedestal Heights',
      content:
        'Set the height for each pedestal in your design. This is crucial for proper drainage and leveling. You can adjust heights individually or use the bulk adjustment tools for efficiency.',
    },
    4: {
      title: 'Quote',
      content:
        "Review your complete design specifications and get a detailed quote. You'll see a breakdown of materials, quantities, and costs. You can make final adjustments before proceeding.",
    },
  }

  const handleStepChange = (newStep) => {
    if (isAnimating) return

    setIsAnimating(true)

    setTimeout(() => {
      setStep(newStep)
      setIsAnimating(false)
    }, 300)
  }

  const handleNext = () => {
    if (step < totalSteps) handleStepChange(step + 1)
  }

  const handleBack = () => {
    if (step > 1) handleStepChange(step - 1)
  }

  const handlePrintInvoice = () => {
    window.print()
  }

  const resetProjectState = useCallback(() => {
    clearProjectDraft()
    setPoints([])
    setGridSize(35)
    setUnitSystem('imperial')
    setCalcData({
      tiles: [],
      pedestals: [],
      userPolygon: [],
      tileCount: 0,
      adjustedPedestals: {},
    })
    setZoom(1)
    setPanOffset({ x: 0, y: 0 })
    setStep(1)
    setActiveProjectId(null)
    setActiveProjectName('Untitled Project')
    setProjectRevision((prev) => prev + 1)
  }, [])

  const openSaveModal = (useCurrentName = false, createCopy = false) => {
    setProjectError('')
    setProjectNotice('')
    setSaveAsMode(createCopy)
    setProjectNameInput(useCurrentName ? activeProjectName : '')
    setSaveModalVisible(true)
  }

  const handleSaveProject = async (explicitName, forceNew = false) => {
    if (!user || !isConfigured) {
      setProjectError('Supabase is not configured.')
      return
    }

    const trimmedName = (explicitName ?? projectNameInput).trim()
    if (!trimmedName) {
      setProjectError('Enter a project name.')
      return
    }

    setProjectSubmitting(true)
    setProjectError('')

    const state = buildProjectState({
      points,
      gridSize,
      unitSystem,
      calcData,
      zoom,
      panOffset,
      step,
    })

    const { data, error } = await saveProject({
      projectId: forceNew ? null : activeProjectId,
      userId: user.id,
      name: trimmedName,
      state,
    })

    setProjectSubmitting(false)

    if (error) {
      setProjectError(error.message)
      return
    }

    setActiveProjectId(data.id)
    setActiveProjectName(data.name)
    setSaveModalVisible(false)
    setSaveAsMode(false)
    setProjectNotice(`Saved "${data.name}".`)
    refreshProjects()
  }

  const handleLoadProject = async (projectId) => {
    if (!user || !isConfigured) return
    setProjectError('')
    setProjectNotice('')
    setProjectSubmitting(true)

    const { data, error } = await getProject(projectId, user.id)
    setProjectSubmitting(false)

    if (error) {
      setProjectError(error.message)
      return
    }

    applyProjectState(data.state, {
      setPoints,
      setGridSize,
      setUnitSystem,
      setCalcData,
      setZoom,
      setPanOffset,
      setStep,
    })
    setActiveProjectId(data.id)
    setActiveProjectName(data.name)
    setProjectRevision((prev) => prev + 1)
    setProjectNotice(`Loaded "${data.name}".`)
  }

  const handleDeleteProject = async (projectId) => {
    if (!user || !isConfigured) return
    const { error } = await deleteProject(projectId, user.id)
    if (error) {
      setProjectError(error.message)
      return
    }
    if (projectId === activeProjectId) {
      setActiveProjectId(null)
      setActiveProjectName('Untitled Project')
    }
    refreshProjects()
  }

  const handleSaveCurrentProject = async () => {
    if (!activeProjectId) {
      openSaveModal(true, true)
      return
    }
    await handleSaveProject(activeProjectName, false)
  }

  const handleSignOut = async () => {
    await signOut()
  }

  // Convert PedestalGrid points to centimeters before passing to TileGrid
  const handlePointsChange = useCallback(
    (newPoints) => {
      const converted = newPoints.map((shape) => ({
        ...shape,
        points: shape.points.map((pt) => ({
          ...pt,
          x: (pt.x / gridSize) * 100,
          y: (pt.y / gridSize) * 100,
        })),
      }))

      // Reset calcData when shape structure changes significantly:
      // - All shapes are empty (no points)
      // - Number of shapes changed (shape was deleted)
      const hasAnyPoints = converted.some((shape) => shape.points && shape.points.length > 0)
      setPoints((prevPoints) => {
        const shapeCountChanged = prevPoints.length !== converted.length

        if (!hasAnyPoints || shapeCountChanged) {
          setCalcData({
            tiles: [],
            pedestals: [],
            userPolygon: [],
            tileCount: 0,
            adjustedPedestals: {},
          })
        }

        if (JSON.stringify(prevPoints) === JSON.stringify(converted)) {
          return prevPoints
        }

        return converted
      })
    },
    [gridSize],
  )

  const handleAIImport = useCallback((shapes, depthPoints = []) => {
    // Write shapes to localStorage so PedestalGrid picks them up on remount
    localStorage.setItem('pedestalGrid_shapes', JSON.stringify(shapes))
    localStorage.setItem('pedestalGrid_activeShapeIndex', '0')
    // AI-imported canvasShapes are generated server-side at 35 px = 1 m.
    // Keep the editor gridSize aligned with that scale or imported
    // measurements will be interpreted incorrectly.
    localStorage.setItem('pedestalGrid_gridSize', '35')
    setGridSize(35)

    // Store AI-extracted depth points (in deck metres + mm) for Step 3
    if (depthPoints.length > 0) {
      localStorage.setItem('aiDepthPoints', JSON.stringify(depthPoints))
    } else {
      localStorage.removeItem('aiDepthPoints')
    }

    // Also clear any stale adjusted pedestals from a previous project
    localStorage.removeItem('pedestal_adjustedPedestals')
    localStorage.removeItem('pedestalHeightAdjuster_adjustedPedestals')
    localStorage.removeItem('pedestalHeightAdjuster_dismissedAiAnchors')

    // Force PedestalGrid to remount by bumping the revision counter
    setProjectRevision((prev) => prev + 1)
    setStep(1)
  }, [])

  const metrics = buildCalculatorMetrics(points, calcData, unitSystem)
  const currentStep = steps.find((item) => item.number === step) || steps[0]

  return (
    <div className="pc-root pc-workspace">
      <header className="pc-topbar">
        <div className="pc-topbar-brand">
          <span className="mark">P</span>
          <span>Pedestal Calc</span>
          <span className="pc-chip pc-mono">v2.1</span>
        </div>

        <div className="pc-topbar-steps" data-tour="topbar-modes">
          {steps.map((item) => (
            <button
              key={item.number}
              type="button"
              className={step === item.number ? 'on' : ''}
              onClick={() => handleStepChange(item.number)}
              disabled={isAnimating}
            >
              <span className="num">{item.number}</span>
              {item.label}
            </button>
          ))}
        </div>

        <div className="pc-topbar-spacer" />

        <button className="pc-btn ghost" type="button" onClick={() => setShowInstructions(true)}>
          Help
        </button>
        <button className="pc-btn accent" type="button" onClick={() => setAiImportVisible(true)}>
          AI Import
        </button>
        <button className="pc-btn" type="button" onClick={handleSaveCurrentProject}>
          Save
        </button>
        <button className="pc-btn ghost" type="button" onClick={handleSignOut}>
          Sign Out
        </button>
      </header>

      {(!isConfigured || projectError || projectNotice) && (
        <div className="pc-alert-stack">
          {!isConfigured && (
            <div className="pc-auth-alert warn" style={{ marginBottom: 8 }}>
              Supabase is not configured yet. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
              to your env file to enable auth and project persistence.
            </div>
          )}
          {projectError && (
            <div className="pc-auth-alert danger" style={{ marginBottom: 8 }}>
              {projectError}
            </div>
          )}
          {projectNotice && (
            <div className="pc-auth-alert ok">
              {projectNotice}
            </div>
          )}
        </div>
      )}

      <div className="pc-workspace-body">
        <ProjectRail
          user={user}
          activeProjectName={activeProjectName}
          editingProjectName={editingProjectName}
          setEditingProjectName={setEditingProjectName}
          projectNameInput={projectNameInput}
          setProjectNameInput={setProjectNameInput}
          setActiveProjectName={setActiveProjectName}
          projects={projects}
          activeProjectId={activeProjectId}
          projectsLoading={projectsLoading}
          projectSubmitting={projectSubmitting}
          metrics={metrics}
          onLoadProject={handleLoadProject}
          onDeleteProject={handleDeleteProject}
          onSave={handleSaveCurrentProject}
          onSaveAs={() => openSaveModal(false, true)}
          onNewProject={resetProjectState}
          onShowInstructions={() => setShowInstructions(true)}
        />

        <main className="pc-canvas-area">
          <div className="pc-canvas-inner" data-tour="canvas">
            {step === 1 && (
              <PedestalGrid
                key={`project-${projectRevision}-step-1`}
                onPointsChange={handlePointsChange}
                onGridSizeChange={setGridSize}
                unitSystem={unitSystem}
                onUnitSystemChange={setUnitSystem}
                onShowInstructions={() => setShowInstructions(true)}
                zoom={zoom}
                setZoom={setSmoothZoom}
                panOffset={panOffset}
                setPanOffset={setPanOffset}
              />
            )}

            {step === 2 && (
              <TileLayout
                key={`project-${projectRevision}-step-2`}
                points={points}
                gridSize={gridSize}
                unitSystem={unitSystem}
                onDataCalculated={setCalcData}
                onShowInstructions={() => setShowInstructions(true)}
                zoom={zoom}
                setZoom={setSmoothZoom}
                panOffset={panOffset}
                setPanOffset={setPanOffset}
              />
            )}

            {step === 3 && (
              <PedestalHeightAdjuster
                key={`project-${projectRevision}-step-3`}
                points={points}
                gridSize={gridSize}
                unitSystem={unitSystem}
                calcData={calcData}
                onDataCalculated={setCalcData}
                onShowInstructions={() => setShowInstructions(true)}
                zoom={zoom}
                setZoom={setSmoothZoom}
                panOffset={panOffset}
                setPanOffset={setPanOffset}
              />
            )}

            {step === 4 && (
              <QuoteStep
                key={`project-${projectRevision}-step-4`}
                calcData={calcData}
                unitSystem={unitSystem}
                onShowInstructions={() => setShowInstructions(true)}
                projectName={activeProjectName}
                userEmail={user?.email}
                metrics={metrics}
              />
            )}
          </div>
        </main>
      </div>

      <MetricsDock
        metrics={metrics}
        step={step}
        totalSteps={totalSteps}
        isAnimating={isAnimating}
        onBack={handleBack}
        onNext={handleNext}
        onPrint={handlePrintInvoice}
      />

      <Modal
        visible={showInstructions}
        onClose={() => setShowInstructions(false)}
        alignment="center"
      >
        <ModalHeader closeButton onClose={() => setShowInstructions(false)}>
          <h5 style={{ margin: 0 }}>{stepInstructions[step].title}</h5>
        </ModalHeader>
        <ModalBody style={{ padding: '20px' }}>
          <p style={{ margin: 0 }}>{stepInstructions[step].content}</p>
        </ModalBody>
        <ModalFooter>
          <div style={{ flex: 1 }} />
          <button className="pc-btn primary" type="button" onClick={() => setShowInstructions(false)}>
            Got it
          </button>
        </ModalFooter>
      </Modal>

      <Modal
        visible={saveModalVisible}
        onClose={() => {
          setSaveModalVisible(false)
          setSaveAsMode(false)
        }}
        alignment="center"
      >
        <ModalHeader
          closeButton
          onClose={() => {
            setSaveModalVisible(false)
            setSaveAsMode(false)
          }}
        >
          <h5 style={{ margin: 0 }}>{saveAsMode ? 'Save Project As' : 'Save Project'}</h5>
        </ModalHeader>
        <ModalBody style={{ padding: '20px' }}>
          <input
            className="pc-project-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            placeholder="Project name"
            value={projectNameInput}
            onChange={(event) => setProjectNameInput(event.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveProject(undefined, saveAsMode) }}
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <div style={{ flex: 1 }} />
          <button
            className="pc-btn"
            type="button"
            onClick={() => {
              setSaveModalVisible(false)
              setSaveAsMode(false)
            }}
          >
            Cancel
          </button>
          <button
            className="pc-btn primary"
            type="button"
            onClick={() => handleSaveProject(undefined, saveAsMode)}
            disabled={projectSubmitting}
          >
            Save
          </button>
        </ModalFooter>
      </Modal>

      <AIDesignImport
        visible={aiImportVisible}
        onClose={() => setAiImportVisible(false)}
        onImport={handleAIImport}
        gridSize={gridSize}
      />
    </div>
  )
}

const ProjectRail = ({
  user,
  activeProjectName,
  editingProjectName,
  setEditingProjectName,
  projectNameInput,
  setProjectNameInput,
  setActiveProjectName,
  projects,
  activeProjectId,
  projectsLoading,
  projectSubmitting,
  metrics,
  onLoadProject,
  onDeleteProject,
  onSave,
  onSaveAs,
  onNewProject,
  onShowInstructions,
}) => {
  const finishRename = () => {
    const name = projectNameInput.trim() || 'Untitled Project'
    setActiveProjectName(name)
    setProjectNameInput(name)
    setEditingProjectName(false)
  }

  return (
    <aside className="pc-rail">
      <div className="pc-rail-section">
        <div className="pc-rail-label">Project</div>
        {editingProjectName ? (
          <input
            autoFocus
            className="pc-project-input"
            value={projectNameInput}
            onChange={(event) => setProjectNameInput(event.target.value)}
            onBlur={finishRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') finishRename()
              if (event.key === 'Escape') setEditingProjectName(false)
            }}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div className="pc-project-title" style={{ flex: 1 }}>
              {activeProjectName}
            </div>
            <button
              className="pc-btn ghost"
              type="button"
              title="Rename project"
              onClick={() => {
                setProjectNameInput(activeProjectName)
                setEditingProjectName(true)
              }}
            >
              Edit
            </button>
          </div>
        )}
        <div style={{ color: 'var(--pc-ink-3)', fontSize: 12, marginTop: 4 }}>
          {user?.email || 'Local draft'}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          <span className="pc-chip pc-mono">Grid {metrics.gridScale}</span>
          <span className="pc-chip">{activeProjectId ? 'Saved' : 'Draft'}</span>
        </div>
      </div>

      <div className="pc-rail-section">
        <div className="pc-rail-label">Actions</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button className="pc-btn primary" type="button" onClick={onSave}>
            Save
          </button>
          <button className="pc-btn" type="button" onClick={onSaveAs}>
            Save As
          </button>
          <button className="pc-btn" type="button" onClick={onNewProject}>
            New
          </button>
          <button className="pc-btn" type="button" onClick={onShowInstructions}>
            Help
          </button>
        </div>
      </div>

      <div className="pc-rail-section">
        <div className="pc-rail-label">Overview</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <RailStat label="Shapes" value={metrics.shapeCount} />
          <RailStat label="Vertices" value={metrics.vertexCount} />
          <RailStat label="Area" value={`${metrics.area} ${metrics.areaUnit}`} />
          <RailStat label="Perimeter" value={`${metrics.perimeter} ${metrics.lengthUnit}`} />
        </div>
      </div>

      <div className="pc-rail-section">
        <div className="pc-rail-label">Saved Projects</div>
        {projectsLoading && (
          <div style={{ color: 'var(--pc-ink-3)', fontSize: 12 }}>Loading projects...</div>
        )}
        {!projectsLoading && projects.length === 0 && (
          <div style={{ color: 'var(--pc-ink-3)', fontSize: 12, lineHeight: 1.5 }}>
            Save this project to see it here.
          </div>
        )}
        {!projectsLoading && projects.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {projects.slice(0, 5).map((project) => (
              <div
                key={project.id}
                style={{
                  padding: '8px 10px',
                  border: '1px solid var(--pc-line)',
                  borderRadius: 'var(--pc-radius)',
                  background:
                    activeProjectId === project.id
                      ? 'var(--pc-accent-soft)'
                      : 'var(--pc-surface-2)',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pc-ink)' }}>
                  {project.name}
                </div>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6 }}
                >
                  <button
                    type="button"
                    className="pc-link-btn"
                    disabled={projectSubmitting}
                    onClick={() => onLoadProject(project.id)}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className="pc-link-btn"
                    style={{ color: 'var(--pc-danger)' }}
                    disabled={projectSubmitting}
                    onClick={() => onDeleteProject(project.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

const RailStat = ({ label, value }) => (
  <div
    style={{
      padding: '8px 10px',
      background: 'var(--pc-surface-2)',
      border: '1px solid var(--pc-line)',
      borderRadius: 'var(--pc-radius)',
      minWidth: 0,
    }}
  >
    <div className="pc-rail-label" style={{ marginBottom: 2 }}>
      {label}
    </div>
    <div className="pc-mono" style={{ fontSize: 13, color: 'var(--pc-ink)', fontWeight: 650 }}>
      {value}
    </div>
  </div>
)

const MetricsDock = ({ metrics, step, totalSteps, isAnimating, onBack, onNext, onPrint }) => (
  <div className="pc-metrics-dock" data-tour="metrics">
    <MetricItem label="Area" value={metrics.area} unit={metrics.areaUnit} />
    <MetricItem label="Perimeter" value={metrics.perimeter} unit={metrics.lengthUnit} />
    <MetricItem label="Pedestals" value={metrics.pedestals} unit="pcs" />
    <MetricItem label="Tiles" value={metrics.tiles} unit="pcs" />
    <MetricItem label="Avg Height" value={metrics.averageHeight} unit={metrics.heightUnit} />
    <MetricItem label="Estimate" value={metrics.estimate} unit="AED" accent />
    <div style={{ flex: 1 }} />
    <button className="pc-btn" type="button" onClick={onBack} disabled={step === 1 || isAnimating}>
      Previous
    </button>
    {step === totalSteps ? (
      <button className="pc-btn primary" type="button" onClick={onPrint} disabled={isAnimating}>
        Print Invoice
      </button>
    ) : (
      <button className="pc-btn primary" type="button" onClick={onNext} disabled={isAnimating}>
        Next
      </button>
    )}
  </div>
)

const MetricItem = ({ label, value, unit, accent }) => (
  <div className={`metric${accent ? ' accent' : ''}`}>
    <span className="label">{label}</span>
    <span className="value">
      {value} <span style={{ color: 'var(--pc-ink-3)', fontWeight: 500 }}>{unit}</span>
    </span>
  </div>
)

const metricsPropType = PropTypes.shape({
  shapeCount: PropTypes.number.isRequired,
  vertexCount: PropTypes.number.isRequired,
  area: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  areaUnit: PropTypes.string.isRequired,
  perimeter: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  lengthUnit: PropTypes.string.isRequired,
  pedestals: PropTypes.number.isRequired,
  tiles: PropTypes.number.isRequired,
  averageHeight: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  heightUnit: PropTypes.string.isRequired,
  estimate: PropTypes.string.isRequired,
  gridScale: PropTypes.string.isRequired,
})

ProjectRail.propTypes = {
  user: PropTypes.shape({
    email: PropTypes.string,
  }),
  activeProjectName: PropTypes.string.isRequired,
  editingProjectName: PropTypes.bool.isRequired,
  setEditingProjectName: PropTypes.func.isRequired,
  projectNameInput: PropTypes.string.isRequired,
  setProjectNameInput: PropTypes.func.isRequired,
  setActiveProjectName: PropTypes.func.isRequired,
  projects: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      name: PropTypes.string.isRequired,
    }),
  ).isRequired,
  activeProjectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  projectsLoading: PropTypes.bool.isRequired,
  projectSubmitting: PropTypes.bool.isRequired,
  metrics: metricsPropType.isRequired,
  onLoadProject: PropTypes.func.isRequired,
  onDeleteProject: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onSaveAs: PropTypes.func.isRequired,
  onNewProject: PropTypes.func.isRequired,
  onShowInstructions: PropTypes.func.isRequired,
}

RailStat.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
}

MetricsDock.propTypes = {
  metrics: metricsPropType.isRequired,
  step: PropTypes.number.isRequired,
  totalSteps: PropTypes.number.isRequired,
  isAnimating: PropTypes.bool.isRequired,
  onBack: PropTypes.func.isRequired,
  onNext: PropTypes.func.isRequired,
  onPrint: PropTypes.func.isRequired,
}

MetricItem.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  unit: PropTypes.string.isRequired,
  accent: PropTypes.bool,
}

function buildCalculatorMetrics(points, calcData, unitSystem) {
  const shapes = Array.isArray(points) ? points : []
  const shapeCount = shapes.filter((shape) => shape.points?.length > 0).length
  const vertexCount = shapes.reduce((sum, shape) => sum + (shape.points?.length || 0), 0)
  const primaryShape = shapes.find((shape) => shape.type === 'add' && shape.points?.length >= 3)
  const primaryPoints = primaryShape?.points || []
  const areaCm2 = polygonAreaCm2(primaryPoints)
  const perimeterCmValue = polygonPerimeterCm(primaryPoints)
  const pedestals = calcData?.pedestals?.length || 0
  const tiles = calcData?.tileCount || calcData?.tiles?.length || 0
  const averageHeightCm =
    pedestals > 0
      ? calcData.pedestals.reduce((sum, pedestal) => sum + (pedestal.height || 0), 0) / pedestals
      : 0

  if (unitSystem === 'imperial') {
    return {
      shapeCount,
      vertexCount,
      area: areaCm2 ? (areaCm2 / 929.0304).toFixed(1) : '--',
      areaUnit: 'sq ft',
      perimeter: perimeterCmValue ? (perimeterCmValue / 30.48).toFixed(1) : '--',
      lengthUnit: 'ft',
      pedestals,
      tiles,
      averageHeight: pedestals ? (averageHeightCm / 2.54).toFixed(1) : '--',
      heightUnit: 'in',
      estimate: (pedestals * 14 + tiles * 38).toLocaleString(),
      gridScale: 'imperial',
    }
  }

  return {
    shapeCount,
    vertexCount,
    area: areaCm2 ? (areaCm2 / 10000).toFixed(1) : '--',
    areaUnit: 'm2',
    perimeter: perimeterCmValue ? (perimeterCmValue / 100).toFixed(1) : '--',
    lengthUnit: 'm',
    pedestals,
    tiles,
    averageHeight: pedestals ? averageHeightCm.toFixed(1) : '--',
    heightUnit: 'cm',
    estimate: (pedestals * 14 + tiles * 38).toLocaleString(),
    gridScale: 'metric',
  }
}

function polygonAreaCm2(points) {
  if (!points || points.length < 3) return 0
  let area = 0
  for (let index = 0; index < points.length; index++) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return Math.abs(area) / 2
}

function polygonPerimeterCm(points) {
  if (!points || points.length < 2) return 0
  let perimeter = 0
  for (let index = 0; index < points.length; index++) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    perimeter += Math.hypot(next.x - current.x, next.y - current.y)
  }
  return perimeter
}

export default PedestalCalculatorMain
