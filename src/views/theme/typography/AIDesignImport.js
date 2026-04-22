import React, { useState, useRef, useCallback, useEffect } from 'react'
import PropTypes from 'prop-types'
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../../../components/Modal'
import { analyzeSketch } from '../../../lib/sketchApi'

const STAGES = [
  { id: 'ocr', label: 'Extracting text labels...', duration: 5000 },
  { id: 'geometry', label: 'Tracing perimeter...', duration: 6000 },
  { id: 'finalize', label: 'Building deck plan...', duration: 2000 },
]

const BACKEND_BASE = 'http://localhost:3001'

const AIDesignImport = ({ visible, onClose, onImport, gridSize = 35, unitSystem = 'metric' }) => {
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [depthImageFile, setDepthImageFile] = useState(null)
  const [depthImagePreview, setDepthImagePreview] = useState(null)
  const [sketchUnitSystem, setSketchUnitSystem] = useState(unitSystem === 'imperial' ? 'imperial' : 'metric')
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isDepthDraggingOver, setIsDepthDraggingOver] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [currentStage, setCurrentStage] = useState(-1)
  const [completedStages, setCompletedStages] = useState([])
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const fileInputRef = useRef(null)
  const depthFileInputRef = useRef(null)
  const stageTimerRef = useRef(null)
  const analyzeWatchdogRef = useRef(null)

  useEffect(() => {
    return () => {
      if (stageTimerRef.current) clearTimeout(stageTimerRef.current)
      if (analyzeWatchdogRef.current) clearTimeout(analyzeWatchdogRef.current)
    }
  }, [])

  const handleClose = () => {
    if (stageTimerRef.current) clearTimeout(stageTimerRef.current)
    if (analyzeWatchdogRef.current) clearTimeout(analyzeWatchdogRef.current)
    setImageFile(null)
    setImagePreview(null)
    setDepthImageFile(null)
    setDepthImagePreview(null)
    setSketchUnitSystem(unitSystem === 'imperial' ? 'imperial' : 'metric')
    setError('')
    setResult(null)
    setIsAnalyzing(false)
    setCurrentStage(-1)
    setCompletedStages([])
    onClose()
  }

  const loadFile = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPG, WEBP, etc.)')
      return
    }
    setError('')
    setResult(null)
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (event) => setImagePreview(event.target.result)
    reader.readAsDataURL(file)
  }

  const loadDepthFile = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPG, WEBP, etc.)')
      return
    }
    setError('')
    setDepthImageFile(file)
    const reader = new FileReader()
    reader.onload = (event) => setDepthImagePreview(event.target.result)
    reader.readAsDataURL(file)
  }

  const handleFileChange = (event) => {
    const file = event.target.files?.[0]
    if (file) loadFile(file)
  }

  const handleDepthFileChange = (event) => {
    const file = event.target.files?.[0]
    if (file) loadDepthFile(file)
  }

  const handleDrop = useCallback((event) => {
    event.preventDefault()
    setIsDraggingOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) loadFile(file)
  }, [])

  const handleDepthDrop = useCallback((event) => {
    event.preventDefault()
    setIsDepthDraggingOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) loadDepthFile(file)
  }, [])

  const runStageProgress = () => {
    let stageIndex = 0

    const advanceStage = () => {
      if (stageIndex < STAGES.length) {
        setCurrentStage(stageIndex)
        const duration = STAGES[stageIndex].duration
        stageIndex += 1
        stageTimerRef.current = setTimeout(() => {
          setCompletedStages((prev) => [...prev, stageIndex - 1])
          advanceStage()
        }, duration)
      }
    }

    advanceStage()
  }

  const handleAnalyze = async () => {
    if (!imageFile) return
    setIsAnalyzing(true)
    setError('')
    setResult(null)
    setCurrentStage(0)
    setCompletedStages([])
    runStageProgress()
    if (analyzeWatchdogRef.current) clearTimeout(analyzeWatchdogRef.current)
    analyzeWatchdogRef.current = setTimeout(() => {
      if (stageTimerRef.current) clearTimeout(stageTimerRef.current)
      setCurrentStage(-1)
      setCompletedStages([])
      setIsAnalyzing(false)
      setError('Analysis timed out. Check that the backend server and Codex CLI are running, then try again.')
    }, 110000)

    try {
      const apiResult = await analyzeSketch(imageFile, depthImageFile || null, sketchUnitSystem)

      if (analyzeWatchdogRef.current) clearTimeout(analyzeWatchdogRef.current)
      if (stageTimerRef.current) clearTimeout(stageTimerRef.current)
      setCurrentStage(-1)
      setCompletedStages(STAGES.map((_, i) => i))

      if (!apiResult.success) {
        setError(apiResult.error || 'Analysis failed. Please try again.')
      } else {
        setResult(apiResult)
      }
    } catch (err) {
      if (analyzeWatchdogRef.current) clearTimeout(analyzeWatchdogRef.current)
      if (stageTimerRef.current) clearTimeout(stageTimerRef.current)
      setCurrentStage(-1)
      setCompletedStages([])
      setError(err.message || 'Analysis failed. Please try again.')
    } finally {
      if (analyzeWatchdogRef.current) clearTimeout(analyzeWatchdogRef.current)
      setIsAnalyzing(false)
    }
  }

  const handleApply = () => {
    if (!result || !result.canvasShapes || result.canvasShapes.length === 0) return
    const depthPoints = result.deckPlan?.depthPoints || []
    onImport(result.canvasShapes, depthPoints)
    handleClose()
  }

  const resolveImageUrl = (relativePath) => {
    if (!relativePath) return null
    if (relativePath.startsWith('http')) return relativePath
    return `${BACKEND_BASE}${relativePath}`
  }

  return (
    <Modal
      className="pc-ai-modal"
      visible={visible}
      onClose={handleClose}
      size="xl"
      alignment="center"
      scrollable
    >
      <ModalHeader closeButton onClose={handleClose}>
        <div style={{ minWidth: 0 }}>
          <div className="pc-rail-label" style={{ marginBottom: 2 }}>
            Sketch pipeline
          </div>
          <h5 style={{ margin: 0, fontWeight: 750, color: 'var(--pc-ink)', fontSize: 16 }}>
            AI Design Import
          </h5>
        </div>
      </ModalHeader>

      <ModalBody style={{ padding: 0 }}>
        <div className="pc-ai-shell">
          <div className="pc-ai-main">
            <div style={{ display: 'grid', gap: 14 }}>
              <UnitSelector
                value={sketchUnitSystem}
                onChange={setSketchUnitSystem}
                disabled={isAnalyzing}
              />

              <DropZone
                label="Deck plan"
                required
                accentColor="var(--pc-accent)"
                emptyTitle="Drop your deck plan here"
                emptyHint="or click to browse - PNG, JPG, WEBP, screenshot"
                imagePreview={imagePreview}
                fileName={imageFile?.name}
                inputRef={fileInputRef}
                disabled={isAnalyzing}
                dragActive={isDraggingOver}
                onFileChange={handleFileChange}
                onDrop={handleDrop}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDraggingOver(true)
                }}
                onDragLeave={() => setIsDraggingOver(false)}
                onReplace={() => fileInputRef.current?.click()}
                big
              />

              <DropZone
                label="Pedestal depths sketch"
                optionalText="optional second image with mm values written on the shape"
                accentColor="oklch(55% 0.18 290)"
                emptyTitle="Drop depth annotation photo here"
                emptyHint="Pedestal heights, spot levels, or handwritten depth values"
                imagePreview={depthImagePreview}
                fileName={depthImageFile?.name}
                inputRef={depthFileInputRef}
                disabled={isAnalyzing}
                dragActive={isDepthDraggingOver}
                onFileChange={handleDepthFileChange}
                onDrop={handleDepthDrop}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDepthDraggingOver(true)
                }}
                onDragLeave={() => setIsDepthDraggingOver(false)}
                onReplace={() => depthFileInputRef.current?.click()}
                onRemove={() => {
                  setDepthImageFile(null)
                  setDepthImagePreview(null)
                }}
              />

              {isAnalyzing && (
                <StageProgress
                  stages={STAGES}
                  currentStage={currentStage}
                  completedStages={completedStages}
                />
              )}

              {error && !isAnalyzing && <Alert tone="danger" label="Analysis error" text={error} />}

              {result && !isAnalyzing && <ResultDetails result={result} />}

              {!imagePreview && !isAnalyzing && <Tips />}
            </div>
          </div>

          <aside className="pc-ai-aside">
            <div style={{ display: 'grid', gap: 14 }}>
              <StatusCard
                title="Import status"
                items={[
                  ['Plan image', imageFile ? imageFile.name : 'Required'],
                  ['Depth image', depthImageFile ? depthImageFile.name : 'Optional'],
                  ['Sketch units', sketchUnitSystem === 'imperial' ? 'Imperial' : 'Metric'],
                  ['Canvas grid', `${gridSize}px`],
                ]}
              />

              <PipelineCard
                hasPlan={!!imageFile}
                hasDepth={!!depthImageFile}
                isAnalyzing={isAnalyzing}
                result={result}
              />

              {result?.debugImages && (
                <DebugImages debugImages={result.debugImages} resolveImageUrl={resolveImageUrl} />
              )}
            </div>
          </aside>
        </div>
      </ModalBody>

      <ModalFooter style={{ justifyContent: 'space-between', gap: 12 }}>
        <button className="pc-btn" type="button" onClick={handleClose} disabled={isAnalyzing}>
          Cancel
        </button>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {imageFile && (
            <button
              className="pc-btn accent lg"
              type="button"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              style={{ minWidth: 158, justifyContent: 'center' }}
            >
              {isAnalyzing ? (
                <>
                  <span className="pc-spin" style={spinnerStyle} />
                  Analyzing
                </>
              ) : result ? (
                'Re-analyze'
              ) : (
                'Analyze with AI'
              )}
            </button>
          )}
          {result?.canvasShapes?.length > 0 && !isAnalyzing && (
            <button
              className="pc-btn primary lg"
              type="button"
              onClick={handleApply}
              style={{ fontWeight: 650 }}
            >
              Apply to Canvas
            </button>
          )}
        </div>
      </ModalFooter>
    </Modal>
  )
}

const DropZone = ({
  label,
  required,
  optionalText,
  accentColor,
  emptyTitle,
  emptyHint,
  imagePreview,
  fileName,
  inputRef,
  disabled,
  dragActive,
  onFileChange,
  onDrop,
  onDragOver,
  onDragLeave,
  onReplace,
  onRemove,
  big,
}) => (
  <section>
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 10,
        marginBottom: 7,
      }}
    >
      <label style={{ fontSize: 13, fontWeight: 650, color: 'var(--pc-ink-2)' }}>
        {label}
        {required && <span style={{ color: 'var(--pc-danger)', marginLeft: 3 }}>*</span>}
      </label>
      {optionalText && (
        <span style={{ color: 'var(--pc-ink-4)', fontSize: 11, textAlign: 'right' }}>
          {optionalText}
        </span>
      )}
    </div>
    <div
      onClick={() => !disabled && !imagePreview && inputRef.current?.click()}
      onDrop={!disabled ? onDrop : undefined}
      onDragOver={!disabled ? onDragOver : undefined}
      onDragLeave={!disabled ? onDragLeave : undefined}
      style={{
        border: `2px dashed ${dragActive ? accentColor : 'var(--pc-line-2)'}`,
        borderRadius: 12,
        padding: imagePreview ? 12 : big ? '30px 24px' : '20px 24px',
        minHeight: imagePreview ? 0 : big ? 170 : 118,
        background: dragActive ? 'var(--pc-accent-soft)' : 'var(--pc-surface-2)',
        opacity: disabled ? 0.7 : 1,
        cursor: disabled || imagePreview ? 'default' : 'pointer',
        transition: 'border-color 0.16s, background 0.16s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />

      {imagePreview ? (
        <div style={{ width: '100%', display: 'grid', gap: 9, justifyItems: 'center' }}>
          <img
            src={imagePreview}
            alt={`${label} preview`}
            style={{
              maxWidth: '100%',
              maxHeight: big ? 280 : 190,
              borderRadius: 8,
              objectFit: 'contain',
              boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
              background: '#fff',
            }}
          />
          <div
            className="pc-mono"
            style={{
              color: 'var(--pc-ink-3)',
              fontSize: 11,
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fileName}
          </div>
          {!disabled && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="pc-link-btn"
                onClick={(event) => {
                  event.stopPropagation()
                  onReplace()
                }}
              >
                Replace
              </button>
              {onRemove && (
                <button
                  type="button"
                  className="pc-link-btn"
                  style={{ color: 'var(--pc-ink-3)' }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemove()
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
          <div
            aria-hidden="true"
            style={{
              width: big ? 40 : 34,
              height: big ? 40 : 34,
              borderRadius: 10,
              display: 'grid',
              placeItems: 'center',
              border: `1px solid ${accentColor}`,
              color: accentColor,
              fontSize: big ? 20 : 17,
              fontWeight: 700,
            }}
          >
            +
          </div>
          <div style={{ fontWeight: 650, color: 'var(--pc-ink-2)', fontSize: big ? 15 : 14 }}>
            {emptyTitle}
          </div>
          <div style={{ color: 'var(--pc-ink-4)', fontSize: big ? 13 : 12 }}>{emptyHint}</div>
        </div>
      )}
    </div>
  </section>
)

const UnitSelector = ({ value, onChange, disabled }) => (
  <section>
    <div style={{ marginBottom: 7 }}>
      <label style={{ fontSize: 13, fontWeight: 650, color: 'var(--pc-ink-2)' }}>
        What units did you use?
        <span style={{ color: 'var(--pc-danger)', marginLeft: 3 }}>*</span>
      </label>
    </div>
    <div className="pc-seg" style={{ width: '100%' }}>
      <button
        type="button"
        className={value === 'metric' ? 'on' : ''}
        onClick={() => onChange('metric')}
        disabled={disabled}
        style={{ flex: 1 }}
      >
        Metric
      </button>
      <button
        type="button"
        className={value === 'imperial' ? 'on' : ''}
        onClick={() => onChange('imperial')}
        disabled={disabled}
        style={{ flex: 1 }}
      >
        Imperial
      </button>
    </div>
  </section>
)

const StageProgress = ({ stages, currentStage, completedStages }) => (
  <section
    style={{
      padding: '14px 16px',
      background: 'oklch(97% 0.03 240)',
      border: '1px solid oklch(86% 0.08 240)',
      borderRadius: 12,
    }}
  >
    <div style={{ fontWeight: 650, color: 'oklch(36% 0.14 240)', marginBottom: 12 }}>
      Analyzing sketch
    </div>
    <div style={{ display: 'grid', gap: 10 }}>
      {stages.map((stage, index) => {
        const isCompleted = completedStages.includes(index) || currentStage > index
        const isActive = currentStage === index && !isCompleted
        return (
          <div
            key={stage.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: isCompleted
                ? 'oklch(42% 0.13 150)'
                : isActive
                  ? 'oklch(38% 0.18 240)'
                  : 'var(--pc-ink-4)',
              opacity: !isCompleted && !isActive ? 0.55 : 1,
              fontSize: 13,
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
                background: isCompleted
                  ? 'var(--pc-ok)'
                  : isActive
                    ? 'var(--pc-accent)'
                    : 'var(--pc-line-2)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {isCompleted ? (
                '✓'
              ) : isActive ? (
                <span className="pc-spin" style={spinnerStyle} />
              ) : (
                index + 1
              )}
            </span>
            <span style={{ fontWeight: isActive ? 650 : 500 }}>{stage.label}</span>
          </div>
        )
      })}
    </div>
  </section>
)

const ResultDetails = ({ result }) => (
  <section style={{ display: 'grid', gap: 12 }}>
    {result.canvasShapes?.length > 0 && (
      <Alert
        tone="success"
        label={`${result.canvasShapes.length} shape${result.canvasShapes.length === 1 ? '' : 's'} ready for canvas`}
        text={
          result.deckPlan?.unit
            ? `Detected unit: ${result.deckPlan.unit}`
            : 'Review the traced regions below before applying.'
        }
      />
    )}

    {(!result.canvasShapes || result.canvasShapes.length === 0) && (
      <Alert
        tone="warning"
        label="No shapes were produced"
        text="The analysis ran but could not build a valid deck polygon. Add guidance and re-analyze."
      />
    )}

    {result.deckPlan?.ocrItems?.length > 0 && (
      <DetailsGroup
        title={`Detected text - ${result.deckPlan.ocrItems.length} item${result.deckPlan.ocrItems.length === 1 ? '' : 's'}`}
        tone="blue"
      >
        {result.deckPlan.ocrItems.map((item, index) => (
          <ResultRow
            key={`${item.text}-${index}`}
            badge={item.type}
            primary={item.text}
            secondary={item.normalized && item.normalized !== item.text ? item.normalized : null}
            confidence={item.confidence}
          />
        ))}
      </DetailsGroup>
    )}

    {result.deckPlan?.segments?.length > 0 && (
      <DetailsGroup
        title={`Segments - ${result.deckPlan.segments.length} edge${result.deckPlan.segments.length === 1 ? '' : 's'} traced`}
        tone="green"
      >
        {result.deckPlan.segments.map((segment, index) => {
          const label =
            segment.lengthLabel?.value != null
              ? `${segment.lengthLabel.value} ${segment.lengthLabel.unit || result.deckPlan?.unit || ''}`
              : segment.lengthLabel?.rawText || 'no label'
          return (
            <ResultRow
              key={segment.id || index}
              badge={segment.id || `s${index + 1}`}
              primary={label}
              secondary={segment.inferred ? 'inferred' : null}
              confidence={segment.confidence}
            />
          )
        })}
      </DetailsGroup>
    )}

    {result.deckPlan?.depthPoints?.length > 0 && (
      <DetailsGroup
        title={`Depth points - ${result.deckPlan.depthPoints.length} point${result.deckPlan.depthPoints.length === 1 ? '' : 's'}`}
        tone="green"
      >
        {result.deckPlan.depthPoints.map((point, index) => (
          <ResultRow
            key={`${point.x}-${point.y}-${index}`}
            badge={`${index + 1}`}
            primary={point.value != null ? `${point.value} ${point.unit || 'mm'}` : 'No value'}
            secondary={point.description || coordinateLabel(point, result.deckPlan?.unit)}
          />
        ))}
      </DetailsGroup>
    )}

    {result.deckPlan?.notes?.length > 0 && (
      <DetailsGroup
        title={`Notes - ${result.deckPlan.notes.length} annotation${result.deckPlan.notes.length === 1 ? '' : 's'}`}
        tone="violet"
      >
        {result.deckPlan.notes.map((note, index) => (
          <ResultRow
            key={`${note.text}-${index}`}
            badge="note"
            primary={note.text}
            confidence={note.confidence}
          />
        ))}
      </DetailsGroup>
    )}

    {result.canvasShapes?.length > 0 && (
      <DetailsGroup title="Canvas shapes" tone="green" open>
        {result.canvasShapes.map((shape, index) => (
          <ResultRow
            key={`${shape.name}-${index}`}
            badge={shape.type === 'sub' ? 'sub' : 'add'}
            primary={shape.name}
            secondary={`${shape.points.length} corners`}
          />
        ))}
      </DetailsGroup>
    )}

    {result.warnings?.length > 0 && (
      <DetailsGroup
        title={`${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}`}
        tone="amber"
      >
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {result.warnings.map((warning, index) => (
            <li
              key={`${warning}-${index}`}
              style={{ fontSize: 12, color: 'oklch(42% 0.14 65)', marginBottom: 2 }}
            >
              {warning}
            </li>
          ))}
        </ul>
      </DetailsGroup>
    )}
  </section>
)

const DetailsGroup = ({ title, tone = 'blue', open = false, children }) => {
  const toneMap = {
    blue: {
      bg: 'oklch(97% 0.03 240)',
      border: 'oklch(85% 0.09 240)',
      title: 'oklch(38% 0.16 240)',
    },
    green: {
      bg: 'oklch(97% 0.04 150)',
      border: 'oklch(80% 0.14 150)',
      title: 'oklch(34% 0.12 150)',
    },
    violet: {
      bg: 'oklch(97% 0.03 290)',
      border: 'oklch(85% 0.09 290)',
      title: 'oklch(40% 0.16 290)',
    },
    amber: {
      bg: 'oklch(97% 0.05 85)',
      border: 'oklch(82% 0.12 65)',
      title: 'oklch(42% 0.14 65)',
    },
  }
  const selectedTone = toneMap[tone]

  return (
    <details
      open={open}
      style={{
        padding: '12px 14px',
        background: selectedTone.bg,
        border: `1px solid ${selectedTone.border}`,
        borderRadius: 10,
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontWeight: 650,
          color: selectedTone.title,
          fontSize: 13,
          userSelect: 'none',
        }}
      >
        {title}
      </summary>
      <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>{children}</div>
    </details>
  )
}

const ResultRow = ({ badge, primary, secondary, confidence }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 12,
      color: 'var(--pc-ink-2)',
      minWidth: 0,
    }}
  >
    <span
      className="pc-mono"
      style={{
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        background: 'var(--pc-surface)',
        color: 'var(--pc-ink-3)',
        border: '1px solid var(--pc-line)',
        flexShrink: 0,
      }}
    >
      {badge}
    </span>
    <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {primary}
    </span>
    {secondary && <span style={{ color: 'var(--pc-ink-3)' }}>{secondary}</span>}
    {typeof confidence === 'number' && (
      <span className="pc-mono" style={{ marginLeft: 'auto', color: 'var(--pc-ink-4)' }}>
        {Math.round(confidence * 100)}%
      </span>
    )}
  </div>
)

const Alert = ({ tone, label, text }) => {
  const toneStyle = {
    success: {
      bg: 'oklch(96% 0.05 150)',
      border: 'oklch(75% 0.18 150)',
      color: 'oklch(34% 0.12 150)',
    },
    warning: {
      bg: 'oklch(97% 0.05 85)',
      border: 'oklch(82% 0.12 65)',
      color: 'oklch(42% 0.14 65)',
    },
    danger: {
      bg: 'oklch(96% 0.03 25)',
      border: 'oklch(82% 0.13 25)',
      color: 'oklch(40% 0.16 25)',
    },
  }[tone]

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        background: toneStyle.bg,
        border: `1px solid ${toneStyle.border}`,
        color: toneStyle.color,
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <strong>{label}</strong>
      {text && <div style={{ marginTop: 2 }}>{text}</div>}
    </div>
  )
}

const StatusCard = ({ title, items }) => (
  <section
    style={{
      padding: 14,
      borderRadius: 10,
      border: '1px solid var(--pc-line)',
      background: 'var(--pc-surface)',
      display: 'grid',
      gap: 10,
    }}
  >
    <div className="pc-rail-label" style={{ margin: 0 }}>
      {title}
    </div>
    {items.map(([label, value]) => (
      <div key={label} style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--pc-ink-3)', fontSize: 12 }}>{label}</span>
        <span
          className="pc-mono"
          style={{
            color: 'var(--pc-ink)',
            fontSize: 11,
            textAlign: 'right',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </span>
      </div>
    ))}
  </section>
)

const PipelineCard = ({ hasPlan, hasDepth, isAnalyzing, result }) => (
  <section
    style={{
      padding: 14,
      borderRadius: 10,
      border: '1px solid var(--pc-line)',
      background: 'var(--pc-surface)',
      display: 'grid',
      gap: 10,
    }}
  >
    <div className="pc-rail-label" style={{ margin: 0 }}>
      Pipeline
    </div>
    <PipelineStep active={hasPlan} label="Plan image loaded" />
    <PipelineStep active={hasDepth} label="Depth annotations available" optional />
    <PipelineStep active={isAnalyzing || !!result} label="Analysis run" />
  </section>
)

const PipelineStep = ({ active, label, optional }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--pc-ink-3)' }}>
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: 999,
        background: active ? 'var(--pc-ok)' : 'var(--pc-line-2)',
        flexShrink: 0,
      }}
    />
    <span style={{ fontSize: 12, color: active ? 'var(--pc-ink-2)' : 'var(--pc-ink-3)' }}>
      {label}
      {optional && <span style={{ color: 'var(--pc-ink-4)' }}> optional</span>}
    </span>
  </div>
)

const DebugImages = ({ debugImages, resolveImageUrl }) => {
  const entries = Object.entries(debugImages).filter(([, value]) => Boolean(value))
  if (!entries.length) return null

  return (
    <section
      style={{
        padding: 14,
        borderRadius: 10,
        border: '1px solid var(--pc-line)',
        background: 'var(--pc-surface)',
        display: 'grid',
        gap: 10,
      }}
    >
      <div className="pc-rail-label" style={{ margin: 0 }}>
        Debug output
      </div>
      {entries.map(([key, value]) => (
        <a
          key={key}
          href={resolveImageUrl(value)}
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--pc-accent-ink)', fontSize: 12, textDecoration: 'none' }}
        >
          {key}
        </a>
      ))}
    </section>
  )
}

const Tips = () => (
  <section
    style={{
      padding: '13px 15px',
      borderRadius: 10,
      background: 'oklch(97% 0.03 240)',
      border: '1px solid oklch(86% 0.08 240)',
      color: 'oklch(34% 0.14 240)',
      fontSize: 13,
      lineHeight: 1.55,
    }}
  >
    <strong>For best results</strong>
    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
      <li>Make dimension labels readable in the photo.</li>
      <li>Include units in labels when possible.</li>
      <li>Add notes for L, U, notch, or multi-region shapes.</li>
    </ul>
  </section>
)

const coordinateLabel = (point, unit) => {
  if (typeof point.x !== 'number' || typeof point.y !== 'number') return null
  return `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}) ${unit || 'm'}`
}

const spinnerStyle = {
  display: 'inline-block',
  width: 14,
  height: 14,
  borderRadius: 999,
  border: '2px solid rgba(255,255,255,0.35)',
  borderTopColor: '#fff',
}

DropZone.propTypes = {
  label: PropTypes.string.isRequired,
  required: PropTypes.bool,
  optionalText: PropTypes.string,
  accentColor: PropTypes.string.isRequired,
  emptyTitle: PropTypes.string.isRequired,
  emptyHint: PropTypes.string.isRequired,
  imagePreview: PropTypes.string,
  fileName: PropTypes.string,
  inputRef: PropTypes.object.isRequired,
  disabled: PropTypes.bool.isRequired,
  dragActive: PropTypes.bool.isRequired,
  onFileChange: PropTypes.func.isRequired,
  onDrop: PropTypes.func.isRequired,
  onDragOver: PropTypes.func.isRequired,
  onDragLeave: PropTypes.func.isRequired,
  onReplace: PropTypes.func.isRequired,
  onRemove: PropTypes.func,
  big: PropTypes.bool,
}

UnitSelector.propTypes = {
  value: PropTypes.oneOf(['metric', 'imperial']).isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
}

StageProgress.propTypes = {
  stages: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    }),
  ).isRequired,
  currentStage: PropTypes.number.isRequired,
  completedStages: PropTypes.arrayOf(PropTypes.number).isRequired,
}

ResultDetails.propTypes = {
  result: PropTypes.shape({
    canvasShapes: PropTypes.array,
    deckPlan: PropTypes.shape({
      unit: PropTypes.string,
      ocrItems: PropTypes.array,
      segments: PropTypes.array,
      depthPoints: PropTypes.array,
      notes: PropTypes.array,
    }),
    warnings: PropTypes.array,
  }).isRequired,
}

DetailsGroup.propTypes = {
  title: PropTypes.string.isRequired,
  tone: PropTypes.oneOf(['blue', 'green', 'violet', 'amber']),
  open: PropTypes.bool,
  children: PropTypes.node.isRequired,
}

ResultRow.propTypes = {
  badge: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  primary: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  secondary: PropTypes.string,
  confidence: PropTypes.number,
}

Alert.propTypes = {
  tone: PropTypes.oneOf(['success', 'warning', 'danger']).isRequired,
  label: PropTypes.string.isRequired,
  text: PropTypes.string,
}

StatusCard.propTypes = {
  title: PropTypes.string.isRequired,
  items: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.string)).isRequired,
}

PipelineCard.propTypes = {
  hasPlan: PropTypes.bool.isRequired,
  hasDepth: PropTypes.bool.isRequired,
  isAnalyzing: PropTypes.bool.isRequired,
  result: PropTypes.object,
}

PipelineStep.propTypes = {
  active: PropTypes.bool.isRequired,
  label: PropTypes.string.isRequired,
  optional: PropTypes.bool,
}

DebugImages.propTypes = {
  debugImages: PropTypes.object.isRequired,
  resolveImageUrl: PropTypes.func.isRequired,
}

AIDesignImport.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onImport: PropTypes.func.isRequired,
  gridSize: PropTypes.number,
  unitSystem: PropTypes.oneOf(['metric', 'imperial']),
}

export default AIDesignImport
