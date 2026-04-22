import React from 'react'
import PropTypes from 'prop-types'

function SidePanel(props) {
  const {
    unitSystem,
    onUnitSystemChange,
    shapes,
    activeShapeIndex,
    setActiveShapeIndex,
    activeEditIndex,
    setActiveEditIndex,
    handleRenameShape,
    handleDeleteShape,
    handleZoomIn,
    handleZoomOut,
    handleUndo,
    handleRedo,
    handleNewShape,
    canUndo,
    canRedo,
    onShowInstructions,
    overlayImage,
    overlayOpacity,
    onOverlayUpload,
    onOverlayOpacityChange,
    onOverlayClear,
  } = props

  return (
    <aside
      className="pc-panel"
      style={{
        width: 'min(280px, 100%)',
        maxWidth: '100%',
        padding: 14,
        background: 'var(--pc-surface)',
        color: 'var(--pc-ink)',
        overflowY: 'auto',
        boxSizing: 'border-box',
        flex: '0 0 280px',
      }}
    >
      {onShowInstructions && (
        <PanelSection>
          <button
            className="pc-btn"
            type="button"
            onClick={onShowInstructions}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            Step Instructions
          </button>
        </PanelSection>
      )}

      <PanelSection title="Units">
        <div className="pc-seg" style={{ width: '100%' }}>
          <button
            type="button"
            className={unitSystem === 'imperial' ? 'on' : ''}
            onClick={() => onUnitSystemChange('imperial')}
            style={{ flex: 1 }}
          >
            Imperial
          </button>
          <button
            type="button"
            className={unitSystem === 'metric' ? 'on' : ''}
            onClick={() => onUnitSystemChange('metric')}
            style={{ flex: 1 }}
          >
            Metric
          </button>
        </div>
      </PanelSection>

      <PanelSection title="Canvas">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button className="pc-btn" type="button" onClick={handleUndo} disabled={!canUndo}>
            Undo
          </button>
          <button className="pc-btn" type="button" onClick={handleRedo} disabled={!canRedo}>
            Redo
          </button>
        </div>
      </PanelSection>

      <PanelSection title="Shapes">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span style={{ color: 'var(--pc-ink-3)', fontSize: 12 }}>
            {shapes.length} region{shapes.length === 1 ? '' : 's'}
          </span>
          <button className="pc-btn primary" type="button" onClick={handleNewShape}>
            New Shape
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shapes.map((shape, index) => {
            const active = index === activeShapeIndex
            return (
              <div
                key={index}
                role="button"
                tabIndex={0}
                onClick={() => setActiveShapeIndex?.(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') setActiveShapeIndex?.(index)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 9px',
                  borderRadius: 'var(--pc-radius)',
                  border: `1px solid ${active ? 'var(--pc-accent)' : 'var(--pc-line)'}`,
                  background: active ? 'var(--pc-accent-soft)' : 'var(--pc-surface-2)',
                  cursor: 'pointer',
                }}
              >
                {activeEditIndex === index ? (
                  <input
                    type="text"
                    value={shape.name}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => handleRenameShape(index, event.target.value)}
                    onBlur={() => setActiveEditIndex(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') setActiveEditIndex(null)
                    }}
                    autoFocus
                    className="pc-project-input"
                    style={{ padding: '4px 6px', fontSize: 12 }}
                  />
                ) : (
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 650,
                        color: active ? 'var(--pc-accent-ink)' : 'var(--pc-ink)',
                      }}
                    >
                      {shape.name}
                    </div>
                    <div
                      className="pc-mono"
                      style={{ fontSize: 10, color: 'var(--pc-ink-3)', marginTop: 2 }}
                    >
                      {shape.points.length} points {shape.isLoopClosed ? 'closed' : 'open'}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    className="pc-btn ghost"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      setActiveEditIndex(index)
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="pc-btn ghost"
                    type="button"
                    style={{ color: 'var(--pc-danger)' }}
                    onClick={(event) => {
                      event.stopPropagation()
                      handleDeleteShape(index)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </PanelSection>

      <PanelSection title="Reference Image">
        {!overlayImage ? (
          <button className="pc-btn" type="button" onClick={onOverlayUpload} style={{ width: '100%', justifyContent: 'center' }}>
            Upload Image
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--pc-ink-3)' }}>Opacity</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pc-ink)' }}>
                {Math.round(overlayOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={overlayOpacity}
              onChange={(e) => onOverlayOpacityChange(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--pc-accent, #2563EB)' }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button className="pc-btn" type="button" onClick={onOverlayUpload}>
                Replace
              </button>
              <button className="pc-btn ghost" type="button" style={{ color: 'var(--pc-danger)' }} onClick={onOverlayClear}>
                Remove
              </button>
            </div>
          </div>
        )}
      </PanelSection>

      <PanelSection title="Shortcuts">
        <div
          style={{
            display: 'grid',
            gap: 6,
            fontSize: 12,
            color: 'var(--pc-ink-3)',
            lineHeight: 1.5,
          }}
        >
          <Shortcut keys="Space" label="pan canvas" />
          <Shortcut keys="Ctrl/Cmd Z" label="undo point" />
          <Shortcut keys="Ctrl/Cmd Shift Z" label="redo point" />
          <Shortcut keys="Ctrl/Cmd Y" label="redo point" />
          <Shortcut keys="Esc" label="pause or cancel edit" />
          <Shortcut keys="Right click" label="corner and edge options" />
        </div>
      </PanelSection>
    </aside>
  )
}

const PanelSection = ({ title, children }) => (
  <section style={{ marginBottom: 16 }}>
    {title && <div className="pc-rail-label">{title}</div>}
    {children}
  </section>
)

const Shortcut = ({ keys, label }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
    <span className="pc-kbd">{keys}</span>
    <span>{label}</span>
  </div>
)

SidePanel.propTypes = {
  unitSystem: PropTypes.oneOf(['metric', 'imperial']).isRequired,
  onUnitSystemChange: PropTypes.func.isRequired,
  shapes: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      points: PropTypes.array.isRequired,
      isLoopClosed: PropTypes.bool.isRequired,
    }),
  ).isRequired,
  activeShapeIndex: PropTypes.number.isRequired,
  setActiveShapeIndex: PropTypes.func,
  activeEditIndex: PropTypes.number,
  setActiveEditIndex: PropTypes.func.isRequired,
  handleRenameShape: PropTypes.func.isRequired,
  handleDeleteShape: PropTypes.func.isRequired,
  handleZoomIn: PropTypes.func.isRequired,
  handleZoomOut: PropTypes.func.isRequired,
  handleUndo: PropTypes.func.isRequired,
  handleRedo: PropTypes.func.isRequired,
  handleNewShape: PropTypes.func.isRequired,
  canUndo: PropTypes.bool.isRequired,
  canRedo: PropTypes.bool.isRequired,
  onShowInstructions: PropTypes.func,
  overlayImage: PropTypes.string,
  overlayOpacity: PropTypes.number,
  onOverlayUpload: PropTypes.func,
  onOverlayOpacityChange: PropTypes.func,
  onOverlayClear: PropTypes.func,
}

PanelSection.propTypes = {
  title: PropTypes.string,
  children: PropTypes.node.isRequired,
}

Shortcut.propTypes = {
  keys: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
}

export default SidePanel
