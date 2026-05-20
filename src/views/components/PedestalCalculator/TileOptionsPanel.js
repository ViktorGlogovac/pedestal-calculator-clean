import React from 'react'
import PropTypes from 'prop-types'
import { useLanguage } from '../../../context/LanguageContext'

export const TILE_TYPES = [
  { id: 'tile16-16', name: 'Tile 16x16 in', width: 40.64, height: 40.64 },
  { id: 'tile60-60', name: 'Tile 60x60 cm', width: 60, height: 60, imperialWidth: 60.96, imperialHeight: 60.96 },
  { id: 'tile40-60', name: 'Tile 40x60 cm', width: 60, height: 40, imperialWidth: 60.96, imperialHeight: 40.64 },
  { id: 'tile60-120', name: 'Tile 60x120 cm', width: 120, height: 60, imperialWidth: 121.92, imperialHeight: 60.96 },
  { id: 'tile30-120', name: 'Tile 30x120 cm', width: 120, height: 30, imperialWidth: 121.92, imperialHeight: 30.48 },
]

export const CANVAS_HEIGHT = 600

function TileOptionsPanel({
  selectedTileType,
  setSelectedTileType,
  isOffset,
  setIsOffset,
  showRedPedestals,
  setShowRedPedestals,
  unitSystem,
  onZoomIn,
  onZoomOut,
  orientation,
  setOrientation,
  onShowInstructions,
}) {
  const { t } = useLanguage()
  const isOffsetEnabled =
    selectedTileType.id === 'tile60-120' || selectedTileType.id === 'tile30-120'
  const isThirdOffsetEnabled = selectedTileType.id === 'tile30-120'
  const getTileDimensions = (tile) => {
    if (unitSystem === 'imperial') {
      return {
        width: tile.imperialWidth || tile.width,
        height: tile.imperialHeight || tile.height,
      }
    }
    return { width: tile.width, height: tile.height }
  }

  return (
    <aside
      className="pc-panel"
      style={{
        width: 'min(280px, 100%)',
        maxWidth: '100%',
        padding: 14,
        background: 'var(--pc-surface)',
        color: 'var(--pc-ink)',
        maxHeight: 'min(640px, calc(100vh - 220px))',
        overflowY: 'auto',
        boxSizing: 'border-box',
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
            {t('calculator.stepInstructions')}
          </button>
        </PanelSection>
      )}

      <PanelSection title={t('calculator.tileSize')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {TILE_TYPES.map((tile) => {
            const tileDims = getTileDimensions(tile)
            const dim1 = unitSystem === 'imperial' ? tileDims.width / 2.54 : tileDims.width
            const dim2 = unitSystem === 'imperial' ? tileDims.height / 2.54 : tileDims.height
            const smaller = Math.min(dim1, dim2)
            const larger = Math.max(dim1, dim2)
            const unit = unitSystem === 'imperial' ? 'in' : 'cm'
            const roundDimension = (value) => {
              const rounded = Math.round(value)
              return unitSystem === 'imperial' && rounded === 47 ? 48 : rounded
            }
            const active = selectedTileType.id === tile.id

            return (
              <button
                key={tile.id}
                type="button"
                className={`pc-btn${active ? ' primary' : ''}`}
                onClick={() => setSelectedTileType(tile)}
                style={{
                  width: '100%',
                  justifyContent: 'space-between',
                  background: active ? 'var(--pc-ink)' : 'var(--pc-surface-2)',
                }}
              >
                <span>{`${roundDimension(smaller)}x${roundDimension(larger)} ${unit}`}</span>
                <TileSwatch width={tileDims.width} height={tileDims.height} active={active} />
              </button>
            )
          })}
        </div>
      </PanelSection>

      <PanelSection title={t('calculator.orientation')}>
        <div className="pc-seg" style={{ width: '100%' }}>
          <button
            type="button"
            className={orientation === 'landscape' ? 'on' : ''}
            onClick={() => setOrientation('landscape')}
            style={{ flex: 1 }}
          >
            {t('calculator.landscape')}
          </button>
          <button
            type="button"
            className={orientation === 'portrait' ? 'on' : ''}
            onClick={() => setOrientation('portrait')}
            style={{ flex: 1 }}
          >
            {t('calculator.portrait')}
          </button>
        </div>
      </PanelSection>

      <PanelSection title={t('calculator.pattern')}>
        <div className="pc-seg" style={{ width: '100%' }}>
          <button
            type="button"
            className={!isOffset ? 'on' : ''}
            onClick={() => setIsOffset(false)}
            style={{ flex: 1 }}
          >
            {t('calculator.stacked')}
          </button>
          <button
            type="button"
            className={isOffset === 'half' ? 'on' : ''}
            onClick={() => setIsOffset('half')}
            disabled={!isOffsetEnabled}
            style={{ flex: 1 }}
          >
            1/2
          </button>
          <button
            type="button"
            className={isOffset === 'third' ? 'on' : ''}
            onClick={() => setIsOffset('third')}
            disabled={!isThirdOffsetEnabled}
            style={{ flex: 1 }}
          >
            1/3
          </button>
        </div>
      </PanelSection>

      <PanelSection title={t('calculator.canvas')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button className="pc-btn" type="button" onClick={onZoomIn}>
            {t('calculator.zoomIn')}
          </button>
          <button className="pc-btn" type="button" onClick={onZoomOut}>
            {t('calculator.zoomOut')}
          </button>
        </div>
      </PanelSection>

      {typeof showRedPedestals === 'boolean' && setShowRedPedestals && (
        <PanelSection title={t('calculator.pedestals')}>
          <button
            className="pc-btn"
            type="button"
            onClick={() => setShowRedPedestals(!showRedPedestals)}
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <span>{t('calculator.calculatedPedestals')}</span>
            <span className="pc-chip">{showRedPedestals ? t('calculator.visible') : t('calculator.hidden')}</span>
          </button>
        </PanelSection>
      )}
    </aside>
  )
}

const PanelSection = ({ title, children }) => (
  <section style={{ marginBottom: 16 }}>
    {title && <div className="pc-rail-label">{title}</div>}
    {children}
  </section>
)

const TileSwatch = ({ width, height, active }) => {
  const scale = 22
  const swatchWidth = Math.max(8, (Math.min(width, height) / 120) * scale)
  const swatchHeight = Math.max(8, (Math.max(width, height) / 120) * scale)

  return (
    <span
      style={{
        width: 30,
        height: 24,
        borderRadius: 4,
        border: active ? '1px solid rgba(255,255,255,0.35)' : '1px solid var(--pc-line)',
        background: active ? 'rgba(255,255,255,0.12)' : 'var(--pc-surface-3)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: swatchWidth,
          height: swatchHeight,
          borderRadius: 2,
          background: active ? '#fff' : 'var(--pc-accent)',
          opacity: active ? 0.9 : 0.72,
        }}
      />
    </span>
  )
}

TileOptionsPanel.propTypes = {
  selectedTileType: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    width: PropTypes.number.isRequired,
    height: PropTypes.number.isRequired,
  }).isRequired,
  setSelectedTileType: PropTypes.func.isRequired,
  isOffset: PropTypes.oneOfType([PropTypes.bool, PropTypes.string]).isRequired,
  setIsOffset: PropTypes.func.isRequired,
  showSubTiles: PropTypes.bool,
  setShowSubTiles: PropTypes.func,
  unitSystem: PropTypes.oneOf(['metric', 'imperial']).isRequired,
  onZoomIn: PropTypes.func.isRequired,
  onZoomOut: PropTypes.func.isRequired,
  orientation: PropTypes.oneOf(['landscape', 'portrait']).isRequired,
  setOrientation: PropTypes.func.isRequired,
  showRedPedestals: PropTypes.bool,
  setShowRedPedestals: PropTypes.func,
  isCollapsed: PropTypes.bool,
  onToggleCollapse: PropTypes.func,
  onShowInstructions: PropTypes.func,
}

PanelSection.propTypes = {
  title: PropTypes.string,
  children: PropTypes.node.isRequired,
}

TileSwatch.propTypes = {
  width: PropTypes.number.isRequired,
  height: PropTypes.number.isRequired,
  active: PropTypes.bool.isRequired,
}

export default TileOptionsPanel
