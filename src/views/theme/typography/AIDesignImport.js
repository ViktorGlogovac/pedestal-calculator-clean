import React, { useState, useRef, useCallback, useEffect } from 'react'
import PropTypes from 'prop-types'
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../../../components/Modal'
import { analyzeSketch } from '../../../lib/sketchApi'

const BACKEND_BASE = 'http://localhost:3001'
const IMPORT_STEPS = [
  { id: 'units', label: 'Units' },
  { id: 'plan', label: 'Deck Plan' },
  { id: 'depth', label: 'Depths' },
]

const AIDesignImport = ({ visible, onClose, onImport, gridSize = 35, unitSystem = 'metric' }) => {
  const [activeStep, setActiveStep] = useState(0)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [depthImageFile, setDepthImageFile] = useState(null)
  const [depthImagePreview, setDepthImagePreview] = useState(null)
  const [sketchUnitSystem, setSketchUnitSystem] = useState(unitSystem === 'imperial' ? 'imperial' : 'metric')
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isDepthDraggingOver, setIsDepthDraggingOver] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [progressEvents, setProgressEvents] = useState([])
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const fileInputRef = useRef(null)
  const depthFileInputRef = useRef(null)
  const analyzeWatchdogRef = useRef(null)

  useEffect(() => {
    return () => {
      if (analyzeWatchdogRef.current) clearTimeout(analyzeWatchdogRef.current)
    }
  }, [])

  const handleClose = () => {
    if (analyzeWatchdogRef.current) clearTimeout(analyzeWatchdogRef.current)
    setImageFile(null)
    setImagePreview(null)
    setDepthImageFile(null)
    setDepthImagePreview(null)
    setSketchUnitSystem(unitSystem === 'imperial' ? 'imperial' : 'metric')
    setError('')
    setResult(null)
    setIsAnalyzing(false)
    setProgressEvents([])
    setStreamText('')
    setActiveStep(0)
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

  const handleAnalyze = async () => {
    if (!imageFile) return
    setIsAnalyzing(true)
    setError('')
    setResult(null)
    setProgressEvents([])
    setStreamText('')
    if (analyzeWatchdogRef.current) clearTimeout(analyzeWatchdogRef.current)
    analyzeWatchdogRef.current = setTimeout(() => {
      setIsAnalyzing(false)
      setError('Analysis timed out. Check that the backend server and Codex CLI are running, then try again.')
      // Last-resort net: must exceed the fetch abort (600s) so analyzeSketch's own
      // timeout handling fires first with a more specific message.
    }, 620000)

    try {
      const apiResult = await analyzeSketch(
        imageFile,
        depthImageFile || null,
        sketchUnitSystem,
        (event) => {
          if (event.type === 'stream') {
            setStreamText((prev) => prev + (event.delta || ''))
          } else {
            setProgressEvents((prev) => [...prev, event])
          }
        },
      )

      if (analyzeWatchdogRef.current) clearTimeout(analyzeWatchdogRef.current)

      if (!apiResult.success) {
        setError(apiResult.error || 'Analysis failed. Please try again.')
      } else {
        setResult(apiResult)
      }
    } catch (err) {
      if (analyzeWatchdogRef.current) clearTimeout(analyzeWatchdogRef.current)
      setError(err.message || 'Analysis failed. Please try again.')
    } finally {
      if (analyzeWatchdogRef.current) clearTimeout(analyzeWatchdogRef.current)
      setIsAnalyzing(false)
    }
  }

  const handleApply = () => {
    if (!result || !result.canvasShapes || result.canvasShapes.length === 0) return
    const depthPoints = result.deckPlan?.depthPoints || []
    onImport(result.canvasShapes, depthPoints, sketchUnitSystem)
    handleClose()
  }

  const resolveImageUrl = (relativePath) => {
    if (!relativePath) return null
    if (relativePath.startsWith('http')) return relativePath
    return `${BACKEND_BASE}${relativePath}`
  }
  const isLastStep = activeStep === IMPORT_STEPS.length - 1
  const canGoNext = activeStep < IMPORT_STEPS.length - 1
  const nextDisabled = isAnalyzing || (activeStep === 1 && !imageFile)
  const goNext = () => setActiveStep((step) => Math.min(IMPORT_STEPS.length - 1, step + 1))
  const goBack = () => setActiveStep((step) => Math.max(0, step - 1))

  return (
    <Modal
      className="pc-ai-modal"
      visible={visible}
      onClose={handleClose}
      size="xl"
      alignment="center"
      scrollable
    >
      <style>{exampleGuideStyles}</style>
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
              <ImportStepper activeStep={activeStep} steps={IMPORT_STEPS} />

              {activeStep === 0 && (
                <StepPanel
                  eyebrow="Step 1"
                  title="Choose the units used in your sketch"
                  description="Pick the unit system that matches the handwritten dimensions. The AI will use this to scale the canvas."
                >
                  <UnitSelector
                    value={sketchUnitSystem}
                    onChange={setSketchUnitSystem}
                    disabled={isAnalyzing}
                  />
                </StepPanel>
              )}

              {activeStep === 1 && (
                <StepPanel
                  eyebrow="Step 2"
                  title="Upload the deck outline"
                  description="Use a clear photo like the example: one closed outside shape with readable edge dimensions."
                >
                  <ExampleSketchInline
                    title="Deck plan example"
                    description="Draw the perimeter as one closed outline. Put edge lengths next to the matching sides."
                    variant="plan"
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
                  <Tips />
                </StepPanel>
              )}

              {activeStep === 2 && (
                <StepPanel
                  eyebrow="Step 3"
                  title="Add optional pedestal heights, then analyze"
                  description="If you have spot heights or pedestal depths, upload a second sketch. Otherwise leave this blank and run the import."
                >
                  <ExampleSketchInline
                    title="Depth sketch example"
                    description="Use a second sketch only when you have spot heights or pedestal depths to include."
                    variant="depth"
                  />
                  <DropZone
                    label="Pedestal depths sketch"
                    optionalText="optional second image with mm/in values written on the shape"
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
                </StepPanel>
              )}

              {isAnalyzing && (
                <StageProgress
                  events={progressEvents}
                  streamText={streamText}
                />
              )}

              {error && !isAnalyzing && <Alert tone="danger" label="Analysis error" text={error} />}

              {result && !isAnalyzing && <ResultDetails result={result} />}

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
          {activeStep > 0 && (
            <button className="pc-btn" type="button" onClick={goBack} disabled={isAnalyzing}>
              Back
            </button>
          )}
          {canGoNext && (
            <button className="pc-btn primary lg" type="button" onClick={goNext} disabled={nextDisabled}>
              Next
            </button>
          )}
          {isLastStep && (
            <button
              className="pc-btn accent lg"
              type="button"
              onClick={handleAnalyze}
              disabled={isAnalyzing || !imageFile}
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

const ImportStepper = ({ steps, activeStep }) => (
  <nav
    aria-label="AI import steps"
    style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
      gap: 8,
    }}
  >
    {steps.map((step, index) => {
      const isActive = index === activeStep
      const isDone = index < activeStep
      return (
        <div
          key={step.id}
          style={{
            padding: '9px 10px',
            borderRadius: 10,
            border: `1px solid ${isActive ? 'var(--pc-accent)' : 'var(--pc-line)'}`,
            background: isActive ? 'var(--pc-accent-soft)' : isDone ? 'oklch(97% 0.04 150)' : 'var(--pc-surface)',
            color: isActive ? 'var(--pc-accent-ink)' : 'var(--pc-ink-3)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              display: 'grid',
              placeItems: 'center',
              background: isActive ? 'var(--pc-accent)' : isDone ? 'var(--pc-ok)' : 'var(--pc-line-2)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {isDone ? '✓' : index + 1}
          </span>
          <span style={{ fontSize: 12, fontWeight: isActive ? 750 : 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {step.label}
          </span>
        </div>
      )
    })}
  </nav>
)

const StepPanel = ({ eyebrow, title, description, children }) => (
  <section
    style={{
      padding: 16,
      borderRadius: 14,
      border: '1px solid var(--pc-line)',
      background: 'var(--pc-surface)',
      display: 'grid',
      gap: 14,
    }}
  >
    <div>
      <div className="pc-rail-label" style={{ marginBottom: 4 }}>
        {eyebrow}
      </div>
      <h3 style={{ margin: 0, color: 'var(--pc-ink)', fontSize: 18, fontWeight: 780 }}>
        {title}
      </h3>
      <p style={{ margin: '6px 0 0', color: 'var(--pc-ink-3)', fontSize: 13, lineHeight: 1.5 }}>
        {description}
      </p>
    </div>
    {children}
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

const ExampleSketchGuide = () => (
  <section
    className="pc-ai-example-guide"
    style={{
      padding: 14,
      borderRadius: 14,
      border: '1px solid var(--pc-line)',
      background: 'linear-gradient(135deg, #fff 0%, oklch(98% 0.02 240) 100%)',
      overflow: 'hidden',
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
      <div>
        <div className="pc-rail-label" style={{ marginBottom: 4 }}>
          Example sketch format
        </div>
        <div style={{ fontSize: 13, color: 'var(--pc-ink-3)', lineHeight: 1.45 }}>
          Draw a clean outside outline, then write dimensions beside the matching edges.
        </div>
      </div>
      <span
        className="pc-ai-example-pill"
        style={{
          alignSelf: 'flex-start',
          padding: '4px 8px',
          borderRadius: 999,
          background: 'var(--pc-accent-soft)',
          color: 'var(--pc-accent-ink)',
          fontSize: 11,
          fontWeight: 700,
          whiteSpace: 'nowrap',
        }}
      >
        Animated guide
      </span>
    </div>

    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 12,
      }}
    >
      <ExampleSketchCard
        title="Deck plan image"
        subtitle="Use feet/meters for edge lengths."
        variant="plan"
      />
      <ExampleSketchCard
        title="Depth image, optional"
        subtitle="Use inch/mm spot heights if you have them."
        variant="depth"
      />
    </div>
  </section>
)

const ExampleSketchInline = ({ title, description, variant }) => (
  <section
    className="pc-ai-example-guide"
    style={{
      padding: 12,
      borderRadius: 14,
      border: '1px solid var(--pc-line)',
      background: 'linear-gradient(135deg, #fff 0%, oklch(98% 0.02 240) 100%)',
      display: 'grid',
      gap: 10,
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div className="pc-rail-label" style={{ marginBottom: 4 }}>
          Example
        </div>
        <div style={{ fontSize: 14, fontWeight: 750, color: 'var(--pc-ink)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--pc-ink-3)', lineHeight: 1.45, marginTop: 2 }}>
          {description}
        </div>
      </div>
      <span
        style={{
          alignSelf: 'flex-start',
          padding: '4px 8px',
          borderRadius: 999,
          background: 'var(--pc-accent-soft)',
          color: 'var(--pc-accent-ink)',
          fontSize: 11,
          fontWeight: 700,
          whiteSpace: 'nowrap',
        }}
      >
        Animated
      </span>
    </div>
    <ExampleSketchCard
      title={variant === 'plan' ? 'Deck plan image' : 'Depth image, optional'}
      subtitle={variant === 'plan' ? 'Use feet/meters for edge lengths.' : 'Use inch/mm spot heights if you have them.'}
      variant={variant}
    />
  </section>
)

const ExampleSketchCard = ({ title, subtitle, variant }) => {
  const isDepth = variant === 'depth'
  const path = isDepth
    ? 'M38 18 H210 V70 H138 V190 H215 V242 H38 L38 18'
    : 'M30 18 H218 V78 H148 V190 H225 V242 H30 L30 18'
  const labels = isDepth
    ? [
        ['4"', 45, 38],
        ['2"', 196, 37],
        ['2"', 198, 75],
        ['4"', 126, 82],
        ['6 3/4"', 84, 104],
        ['7"', 90, 194],
        ['3"', 133, 195],
        ['2"', 205, 205],
        ['4"', 45, 235],
        ['3"', 204, 235],
      ]
    : [
        ["32'", 116, 16],
        ["10'", 226, 54],
        ["12'", 176, 84],
        ["24'", 156, 144],
        ["12'", 180, 198],
        ["10'", 228, 224],
        ["44'", 18, 144],
        ["32'", 118, 252],
      ]

  return (
    <div
      style={{
        border: '1px solid var(--pc-line)',
        borderRadius: 12,
        background: '#fff',
        overflow: 'hidden',
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.06)',
      }}
    >
      <div style={{ padding: '10px 12px 8px' }}>
        <div style={{ fontSize: 13, fontWeight: 750, color: 'var(--pc-ink)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--pc-ink-3)', marginTop: 2 }}>{subtitle}</div>
      </div>
      <svg
        viewBox="0 0 256 270"
        role="img"
        aria-label={title}
        style={{
          '--pc-ai-example-duration': isDepth ? '20s' : '12s',
          display: 'block',
          width: '100%',
          height: 210,
          background: '#fbfdff',
        }}
      >
        {Array.from({ length: 12 }).map((_, index) => (
          <line
            key={index}
            x1="0"
            x2="256"
            y1={22 + index * 20}
            y2={22 + index * 20}
            stroke="#b9cff5"
            strokeWidth="0.7"
          />
        ))}
        <path
          d={path}
          fill="rgba(37, 99, 235, 0.035)"
          stroke="#292929"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.28"
        />
        <path
          className="pc-ai-example-outline"
          d={path}
          pathLength="100"
          fill="none"
          stroke="#292929"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {labels.map(([label, x, y], index) => (
          <text
            key={`${label}-${x}-${y}`}
            className="pc-ai-example-label"
            x={x}
            y={y}
            style={{ animationDelay: `${isDepth ? 3.4 + index * 0.46 : 2.2 + index * 0.34}s` }}
            textAnchor="middle"
          >
            {label}
          </text>
        ))}
        <circle
          className="pc-ai-example-pen"
          r="4"
          fill="var(--pc-accent)"
          style={{ offsetPath: `path("${path}")`, offsetRotate: '0deg' }}
        />
      </svg>
    </div>
  )
}

const StageProgress = ({ events, streamText }) => {
  const visibleEvents = events.length > 0
    ? events
    : [{ stage: 'start', message: 'Starting analysis', elapsedMs: 0 }]

  const streamRef = useRef(null)
  const cleanedStream = cleanCodexStream(streamText)
  useEffect(() => {
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [cleanedStream])

  return (
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
        {visibleEvents.map((event, index) => {
          const isLatest = index === visibleEvents.length - 1
          return (
            <div
              key={`${event.stage || 'stage'}-${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: isLatest ? 'oklch(38% 0.18 240)' : 'oklch(42% 0.13 150)',
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
                  background: isLatest ? 'var(--pc-accent)' : 'var(--pc-ok)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {isLatest ? <span className="pc-spin" style={spinnerStyle} /> : '✓'}
              </span>
              <span style={{ fontWeight: isLatest ? 650 : 500, flex: 1 }}>{event.message}</span>
              <span className="pc-mono" style={{ color: 'var(--pc-ink-4)', fontSize: 11 }}>
                {formatElapsed(event.elapsedMs)}
              </span>
            </div>
          )
        })}
      </div>
      {cleanedStream && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 650, color: 'oklch(36% 0.14 240)', marginBottom: 6, fontSize: 12 }}>
            Live AI output
          </div>
          <pre
            ref={streamRef}
            className="pc-mono"
            style={{
              margin: 0,
              maxHeight: 200,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 11,
              lineHeight: 1.5,
              color: 'oklch(40% 0.04 240)',
              background: 'oklch(99% 0.01 240)',
              border: '1px solid oklch(88% 0.05 240)',
              borderRadius: 8,
              padding: '10px 12px',
            }}
          >
            {cleanedStream}
            <span className="pc-stream-caret">▋</span>
          </pre>
        </div>
      )}
      <div style={{ color: 'var(--pc-ink-4)', fontSize: 11, marginTop: 10, lineHeight: 1.45 }}>
        Progress shows pipeline events and the model&rsquo;s streamed output as it reasons through the sketch.
      </div>
    </section>
  )
}

/**
 * Trim the noisy session header / metadata that `codex exec` prints before the
 * actual model output so the live panel shows what Codex is reasoning toward,
 * not workdir/model/sandbox boilerplate.
 */
function cleanCodexStream(raw) {
  if (!raw) return ''
  return String(raw)
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      if (/^-{3,}$/.test(t)) return false
      if (/^\[?\d{4}-\d{2}-\d{2}/.test(t)) return false // ISO timestamp lines
      if (/^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|tokens used|OpenAI Codex)\b/i.test(t)) return false
      if (/^User instructions:?$/i.test(t)) return false
      return true
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart()
}

function formatElapsed(elapsedMs) {
  const seconds = Math.max(0, Math.round((elapsedMs || 0) / 1000))
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const rem = seconds % 60
  return `${mins}m ${rem}s`
}

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

const exampleGuideStyles = `
  .pc-ai-example-outline {
    stroke-dasharray: 100;
    stroke-dashoffset: 100;
    animation: pc-ai-draw-outline var(--pc-ai-example-duration, 12s) ease-in-out infinite;
  }

  .pc-ai-example-label {
    font-family: "Comic Sans MS", "Bradley Hand", cursive;
    font-size: 16px;
    font-weight: 700;
    fill: #303030;
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: pc-ai-write-label var(--pc-ai-example-duration, 12s) ease-in-out infinite;
  }

  .pc-ai-example-pen {
    animation: pc-ai-pen-path var(--pc-ai-example-duration, 12s) ease-in-out infinite;
    opacity: 0;
  }

  @keyframes pc-ai-draw-outline {
    0% { stroke-dashoffset: 100; }
    72%, 92% { stroke-dashoffset: 0; }
    100% { stroke-dashoffset: 100; }
  }

  @keyframes pc-ai-write-label {
    0%, 52% { opacity: 0; transform: translateY(4px) rotate(-2deg) scale(0.96); }
    68%, 92% { opacity: 1; transform: translateY(0) rotate(-2deg) scale(1); }
    100% { opacity: 0; transform: translateY(-2px) rotate(-2deg) scale(0.98); }
  }

  @keyframes pc-ai-pen-path {
    0% { offset-distance: 0%; opacity: 0; }
    8% { opacity: 1; }
    72% { offset-distance: 100%; opacity: 1; }
    80%, 100% { offset-distance: 100%; opacity: 0; }
  }

  .pc-stream-caret {
    display: inline-block;
    margin-left: 1px;
    color: var(--pc-accent);
    animation: pc-stream-blink 1s steps(2, start) infinite;
  }

  @keyframes pc-stream-blink {
    0%, 50% { opacity: 1; }
    50.01%, 100% { opacity: 0; }
  }
`

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

ImportStepper.propTypes = {
  steps: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    }),
  ).isRequired,
  activeStep: PropTypes.number.isRequired,
}

StepPanel.propTypes = {
  eyebrow: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
}

UnitSelector.propTypes = {
  value: PropTypes.oneOf(['metric', 'imperial']).isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
}

ExampleSketchCard.propTypes = {
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.string.isRequired,
  variant: PropTypes.oneOf(['plan', 'depth']).isRequired,
}

ExampleSketchInline.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  variant: PropTypes.oneOf(['plan', 'depth']).isRequired,
}

StageProgress.propTypes = {
  events: PropTypes.arrayOf(
    PropTypes.shape({
      stage: PropTypes.string,
      message: PropTypes.string.isRequired,
      elapsedMs: PropTypes.number,
    }),
  ).isRequired,
  streamText: PropTypes.string,
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
