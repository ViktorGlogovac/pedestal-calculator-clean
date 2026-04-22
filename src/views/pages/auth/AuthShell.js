import React from 'react'
import PropTypes from 'prop-types'

// ─── Tile deck geometry ───────────────────────────────────────────────────────
const COLS = 6
const ROWS = 5
const T = 150      // tile side length (SVG units)
const G = 12       // grout width  =  2 × pedestal radius
const R = G / 2    //  pedestal radius = 6

// SVG canvas: each column/row gets T+G units, plus one G margin on each side
const VW = COLS * (T + G) + G   // 984
const VH = ROWS * (T + G) + G   // 822

// Tile origins (top-left corner of each tile)
const TILES = []
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    TILES.push({ x: G + c * (T + G), y: G + r * (T + G), c, r })
  }
}

// Pedestal centres — (COLS+1)×(ROWS+1) = 7×6 = 42 intersections.
// Each pedestal sits at the corner shared by up to four adjacent tiles.
const PEDS = []
for (let ir = 0; ir <= ROWS; ir++) {
  for (let ic = 0; ic <= COLS; ic++) {
    // pseudo-random height in [0,1] based on position — gives realistic variation
    const h = (Math.sin(ic * 2.9 + ir * 4.1) * 0.5 + 0.5) * 0.7 + 0.15
    PEDS.push({ cx: R + ic * (T + G), cy: R + ir * (T + G), ic, ir, h })
  }
}

// ─── SVG component ───────────────────────────────────────────────────────────
const AuthTileDeck = () => (
  <svg
    viewBox={`0 0 ${VW} ${VH}`}
    width="100%"
    height="100%"
    style={{ display: 'block' }}
    aria-hidden="true"
  >
    <defs>
      {/* Fine inner grid texture applied to each tile */}
      <pattern
        id="auth-tile-lines"
        x="0" y="0"
        width={T / 5} height={T / 5}
        patternUnits="userSpaceOnUse"
      >
        <path
          d={`M ${T / 5} 0 L 0 0 0 ${T / 5}`}
          fill="none"
          stroke="rgba(245,244,239,0.045)"
          strokeWidth="1"
        />
      </pattern>

      {/* Clipping rect so outer pedestals are half-clipped at the edges (realistic) */}
      <clipPath id="auth-deck-clip">
        <rect x="0" y="0" width={VW} height={VH} />
      </clipPath>
    </defs>

    <g clipPath="url(#auth-deck-clip)">
      {/* ── Tiles ── */}
      {TILES.map(({ x, y, c, r }) => (
        <g key={`t-${c}-${r}`}>
          <rect
            x={x} y={y}
            width={T} height={T}
            rx={7} ry={7}
            fill="rgba(245,244,239,0.042)"
            stroke="rgba(245,244,239,0.07)"
            strokeWidth="1"
          />
          <rect
            x={x} y={y}
            width={T} height={T}
            rx={7} ry={7}
            fill="url(#auth-tile-lines)"
          />
        </g>
      ))}

      {/* ── Pedestals — size and brightness vary by pseudo-height ── */}
      {PEDS.map(({ cx, cy, ic, ir, h }) => (
        <circle
          key={`p-${ic}-${ir}`}
          cx={cx}
          cy={cy}
          r={R * (0.55 + h * 0.45)}
          fill="rgba(245,244,239,1)"
          opacity={0.18 + h * 0.22}
        />
      ))}
    </g>
  </svg>
)

// ─── Shell ────────────────────────────────────────────────────────────────────
const AuthShell = ({ children }) => {
  return (
    <div className="pc-root pc-auth">
      <section className="pc-auth-hero">
        <div className="pc-auth-logo">
          <span className="pc-auth-logo-mark">P</span>
          <span>Pedestal Calc</span>
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'rgba(245,244,239,0.56)', marginBottom: 12 }}>
            Deck takeoffs, pedestal schedules, and quote-ready layouts.
          </div>
          <div className="pc-auth-deck" aria-hidden="true">
            <AuthTileDeck />
          </div>
          <blockquote className="pc-auth-testimonial">
            Built for fast rooftop layout review without losing the project history.
            <span className="author">ENMON project workspace</span>
          </blockquote>
        </div>

        <div className="pc-auth-trust">
          <span className="pc-auth-trust-item">
            <span className="dot" /> Saved projects
          </span>
          <span className="pc-auth-trust-item">
            <span className="dot" /> AI plan import
          </span>
          <span className="pc-auth-trust-item">
            <span className="dot" /> PDF quotes
          </span>
        </div>
      </section>

      <main className="pc-auth-form">
        <div className="pc-auth-form-inner">{children}</div>
      </main>
    </div>
  )
}

export default AuthShell

AuthShell.propTypes = {
  children: PropTypes.node.isRequired,
}
