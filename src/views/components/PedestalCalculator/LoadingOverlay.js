import React from 'react'
import PropTypes from 'prop-types'

// Geometry constants (px)
const T = 44   // tile size
const R = 3.5  // pedestal radius  — gap = 2R so pedestals fill the space between tiles exactly
const G = R * 2
const M = R    // outer margin so edge pedestals aren't clipped

// SVG canvas
const W = M + T + G + T + M   // 3.5 + 44 + 7 + 44 + 3.5 = 102
const H = W

// Tile top-left positions [x, y]
const TILES = [
  [M, M],
  [M + T + G, M],
  [M, M + T + G],
  [M + T + G, M + T + G],
]

// Pedestal centers — 3×3 grid at tile-corner intersections
const PX = [M, M + T + R, M + T + G + T]   // left, center-gap, right
const PY = [M, M + T + R, M + T + G + T]
const PEDS = PY.flatMap((cy) => PX.map((cx) => [cx, cy]))  // 9 total

const PED_COUNT = PEDS.length

// Subtle tile grid lines — 3×3 inner grid per tile
function TileGrid({ x, y }) {
  const step = T / 4
  const lines = []
  for (let i = 1; i < 4; i++) {
    lines.push(
      <line key={`h${i}`} x1={x} y1={y + step * i} x2={x + T} y2={y + step * i}
        stroke="var(--pc-canvas-grid)" strokeWidth="0.6" />,
      <line key={`v${i}`} x1={x + step * i} y1={y} x2={x + step * i} y2={y + T}
        stroke="var(--pc-canvas-grid)" strokeWidth="0.6" />,
    )
  }
  return <>{lines}</>
}

const LoadingOverlay = ({ label = 'Computing…', visible = true }) => {
  const [active, setActive] = React.useState(0)

  React.useEffect(() => {
    if (!visible) return
    const id = setInterval(() => setActive((a) => (a + 1) % PED_COUNT), 280)
    return () => clearInterval(id)
  }, [visible])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        background: 'var(--pc-overlay-bg)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        borderRadius: 10,
        zIndex: 10,
        animation: 'pc-fade-in 0.18s ease both',
        pointerEvents: 'none',
      }}
    >
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ overflow: 'visible' }}
      >
        <defs>
          {/* Glow filter for active pedestal */}
          <filter id="pc-ped-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Tiles */}
        {TILES.map(([x, y], i) => (
          <g key={i}>
            <rect
              x={x} y={y}
              width={T} height={T}
              rx={3} ry={3}
              fill="var(--pc-surface-3)"
              stroke="var(--pc-line-2)"
              strokeWidth="1"
            />
            <TileGrid x={x} y={y} />
          </g>
        ))}

        {/* Pedestals at every corner/intersection */}
        {PEDS.map(([cx, cy], i) => {
          const isActive = i === active
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={isActive ? R + 1 : R}
              fill={isActive ? 'var(--pc-accent)' : 'var(--pc-line-2)'}
              filter={isActive ? 'url(#pc-ped-glow)' : undefined}
              style={{ transition: 'r 0.2s ease, fill 0.2s ease' }}
            />
          )
        })}
      </svg>

      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--pc-ink-3)',
          fontFamily: 'var(--pc-font-sans)',
          letterSpacing: '0.01em',
        }}
      >
        {label}
      </span>
    </div>
  )
}

LoadingOverlay.propTypes = {
  label: PropTypes.string,
  visible: PropTypes.bool,
}

export default LoadingOverlay
