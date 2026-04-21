import React, { useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import enmonLogo from '../../../assets/brand/enmon-logo.svg'

/* ---------- CONSTANTS ------------------------------------------- */
const CANVAS_WIDTH = 900
const CANVAS_HEIGHT = 600
const MARGIN = 20

// After header (~54px) + stats (~36px) + labels/gaps (~26px) the remaining body
// height on a letter page with 0.25in margins is roughly 750px. Keep PRINT_H
// comfortably under that so the browser never moves the SVG to page 2.
const PRINT_W = 400
const PRINT_H = 620
const PRINT_MARGIN = 12

const pedestalOptions = {
  'Pro Series': [
    { id: 'EN-CO-A', min: 20, max: 29 },
    { id: 'EN-CO-B', min: 29, max: 42 },
    { id: 'EN-CO-C', min: 42, max: 60 },
    { id: 'EN-CO-D', min: 60, max: 95 },
    { id: 'EN-CO-E', min: 95, max: 185 },
    { id: 'EN-CO-E1', min: 180, max: 315 },
    { id: 'EN-CO-E2', min: 315, max: 475 },
    { id: 'EN-CO-E3', min: 475, max: 635 },
  ],
  'Self-Leveling': [
    { id: 'EN-SLO-A', min: 23, max: 33 },
    { id: 'EN-SLO-B', min: 33, max: 68 },
    { id: 'EN-SLO-C', min: 67, max: 157 },
    { id: 'EN-SLO-D', min: 154, max: 405 },
    { id: 'EN-SLO-D1', min: 272, max: 595 },
    { id: 'EN-SLO-D2', min: 392, max: 785 },
    { id: 'EN-SLO-D3', min: 520, max: 975 },
  ],
}

const PALETTE = [
  '#2563EB',
  '#16A34A',
  '#DC2626',
  '#D97706',
  '#7C3AED',
  '#0891B2',
  '#BE185D',
  '#65A30D',
  '#EA580C',
  '#0F766E',
]

/* ---------- SHARED SCREEN STYLES -------------------------------- */
const buttonStyle = {
  padding: '8px',
  borderRadius: '6px',
  border: '1px solid #e0e0e0',
  backgroundColor: '#fff',
  fontSize: '14px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}
const activeButtonStyle = {
  ...buttonStyle,
  backgroundColor: '#0F172A',
  color: '#fff',
  border: '1px solid #0F172A',
}
const panelStyle = {
  width: '280px',
  padding: '16px',
  backgroundColor: '#fff',
  color: '#000',
  borderRadius: '8px',
  fontFamily: 'Arial, sans-serif',
  height: CANVAS_HEIGHT,
  overflowY: 'auto',
}
const sectionTitle = { fontSize: '18px', margin: '0 0 8px 0', fontWeight: '600' }

/* ---------- HELPERS --------------------------------------------- */
const convertToMm = (heightCm) => Math.max(0, Math.round(heightCm * 10))

const formatHeight = (heightCm, unit) => {
  if (unit === 'imperial') return `${(heightCm / 2.54).toFixed(2)} in`
  return `${heightCm.toFixed(2)} cm`
}

const makeColourMap = (ids) => {
  const map = {}
  ids.forEach((id, i) => {
    map[id] = PALETTE[i % PALETTE.length]
  })
  return map
}

const isCoordinatePair = (point) =>
  Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number'

const normalizeUserPolygons = (userPolygon) => {
  if (!Array.isArray(userPolygon) || userPolygon.length === 0) return []
  if (isCoordinatePair(userPolygon[0])) return [userPolygon]
  if (Array.isArray(userPolygon[0]) && isCoordinatePair(userPolygon[0][0])) return userPolygon
  return []
}

const normalizeTileShapeRings = (shape) =>
  (Array.isArray(shape) ? shape : []).flatMap((polygon) => {
    if (!Array.isArray(polygon) || polygon.length === 0) return []
    if (isCoordinatePair(polygon[0])) return [polygon]
    if (Array.isArray(polygon[0]) && isCoordinatePair(polygon[0][0])) {
      return polygon.filter((ring) => Array.isArray(ring) && isCoordinatePair(ring[0]))
    }
    return []
  })

/* ---------- COMPONENT ------------------------------------------- */
const QuoteStep = ({ calcData, unitSystem, onShowInstructions }) => {
  const [selectedCategory, setSelectedCategory] = useState('Pro Series')
  const [hoveredPedestal, setHoveredPedestal] = useState(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })

  const { grouped, idsUsed } = useMemo(() => {
    const g = {},
      ids = new Set()
    calcData.pedestals?.forEach((p) => {
      const mm = convertToMm(p.height)
      const prod = pedestalOptions[selectedCategory].find((o) => mm >= o.min && mm <= o.max)
      const id = prod ? prod.id : 'Unmatched'
      ids.add(id)
      g[id] = (g[id] || 0) + 1
    })
    return { grouped: g, idsUsed: [...ids] }
  }, [calcData.pedestals, selectedCategory])

  const colourMap = useMemo(() => makeColourMap(idsUsed), [idsUsed])
  const userPolygons = useMemo(
    () => normalizeUserPolygons(calcData.userPolygon),
    [calcData.userPolygon],
  )
  const polygonPoints = userPolygons.flat()

  /* Scale design to fit canvas */
  let scale = 1,
    offsetX = 0,
    offsetY = 0
  if (polygonPoints.length) {
    const xs = polygonPoints.map((p) => p[0])
    const ys = polygonPoints.map((p) => p[1])
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    scale = Math.min((CANVAS_WIDTH - MARGIN * 2) / w, (CANVAS_HEIGHT - MARGIN * 2) / h)
    offsetX = (CANVAS_WIDTH - w * scale) / 2 - Math.min(...xs) * scale
    offsetY = (CANVAS_HEIGHT - h * scale) / 2 - Math.min(...ys) * scale
  }
  const P = ([x, y]) => [x * scale + offsetX, y * scale + offsetY]
  const polyPointStrings = userPolygons.map((polygon) =>
    polygon.map((p) => P(p).join(',')).join(' '),
  )

  const totalPedestals = calcData.pedestals?.length || 0
  const totalTiles = calcData.tileCount || 0
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div>
      <style>{`
        .print-page { display: none !important; }
        @media print {
          @page { margin: 0.25in; size: letter portrait; }
          body * { visibility: hidden !important; }
          .print-page, .print-page * { visibility: visible !important; }
          .print-page {
            display: block !important;
            position: static;
            width: 100%;
            margin: 0;
            padding: 0;
            font-family: 'Helvetica Neue', Arial, sans-serif;
          }
          .screen-only { display: none !important; }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
        }
      `}</style>

      {/* ===== SINGLE-PAGE PRINT LAYOUT ===== */}
      <div className="print-page" style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: 10,
            borderBottom: '2px solid #0F172A',
            marginBottom: 12,
          }}
        >
          <img src={enmonLogo} alt="ENMON" style={{ height: 32, width: 'auto' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>Pedestal Quote</div>
            <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>{today}</div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {[
            { label: 'Tiles', value: totalTiles },
            { label: 'Pedestals', value: totalPedestals },
            { label: 'Category', value: selectedCategory },
            { label: 'SKUs', value: Object.keys(grouped).length },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                flex: 1,
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 6,
                padding: '5px 10px',
              }}
            >
              <div
                style={{
                  fontSize: 8,
                  color: '#94A3B8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.4px',
                  marginBottom: 1,
                }}
              >
                {label}
              </div>
              <div
                style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap' }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Two-column body: plan left, schedule right */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'flex-start',
            pageBreakInside: 'avoid',
            breakInside: 'avoid',
          }}
        >
          {/* Left: plan + legend */}
          <div style={{ flexShrink: 0 }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: '#64748B',
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
                marginBottom: 6,
              }}
            >
              Layout Plan
            </div>
            <div
              style={{
                border: '1px solid #CBD5E1',
                borderRadius: 6,
                overflow: 'hidden',
                lineHeight: 0,
              }}
            >
              <svg
                width={PRINT_W}
                height={PRINT_H}
                style={{ display: 'block', background: '#FAFAFA' }}
              >
                <rect width={PRINT_W} height={PRINT_H} fill="#FAFAFA" />
                {(() => {
                  if (!polygonPoints.length) return null
                  const xs = polygonPoints.map((p) => p[0])
                  const ys = polygonPoints.map((p) => p[1])
                  const w = Math.max(...xs) - Math.min(...xs)
                  const h = Math.max(...ys) - Math.min(...ys)
                  const ps = Math.min(
                    (PRINT_W - PRINT_MARGIN * 2) / w,
                    (PRINT_H - PRINT_MARGIN * 2) / h,
                  )
                  const ox = (PRINT_W - w * ps) / 2 - Math.min(...xs) * ps
                  const oy = (PRINT_H - h * ps) / 2 - Math.min(...ys) * ps
                  const Pp = ([x, y]) => [x * ps + ox, y * ps + oy]
                  const printPolygonPointStrings = userPolygons.map((polygon) =>
                    polygon.map((p) => Pp(p).join(',')).join(' '),
                  )
                  return (
                    <>
                      {printPolygonPointStrings.map((points, index) => (
                        <polygon
                          key={index}
                          points={points}
                          fill="#F1F5F9"
                          stroke="#0F172A"
                          strokeWidth="1.5"
                        />
                      ))}
                      {calcData.tiles?.map((tile, i) => (
                        <g key={i}>
                          {normalizeTileShapeRings(tile.shape).map((poly, j) => (
                            <polygon
                              key={j}
                              points={poly.map((pt) => Pp(pt).join(',')).join(' ')}
                              fill="none"
                              stroke="#CBD5E1"
                              strokeWidth="0.5"
                            />
                          ))}
                        </g>
                      ))}
                      {calcData.pedestals?.map((p, i) => {
                        const mm = convertToMm(p.height)
                        const prod = pedestalOptions[selectedCategory].find(
                          (o) => mm >= o.min && mm <= o.max,
                        )
                        const id = prod ? prod.id : 'Unmatched'
                        const [cx, cy] = Pp([p.x, p.y])
                        return (
                          <circle
                            key={i}
                            cx={cx}
                            cy={cy}
                            r={2.5}
                            fill={colourMap[id] || '#64748B'}
                          />
                        )
                      })}
                    </>
                  )
                })()}
              </svg>
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 14px', marginTop: 8 }}>
              {Object.entries(grouped).map(([id, qty]) => (
                <div
                  key={id}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      backgroundColor: colourMap[id] || '#64748B',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 600, color: '#0F172A' }}>{id}</span>
                  <span style={{ color: '#64748B' }}>({qty})</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: schedule table */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: '#64748B',
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
                marginBottom: 6,
              }}
            >
              Pedestal Schedule
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#0F172A' }}>
                  {['', 'SKU', 'Range (mm)', 'Qty'].map((h, i) => (
                    <th
                      key={i}
                      style={{
                        padding: '12px 12px',
                        textAlign: i === 3 ? 'right' : 'left',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        width: i === 0 ? 18 : 'auto',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(grouped).map(([id, qty], idx) => {
                  const opt = Object.values(pedestalOptions)
                    .flat()
                    .find((o) => o.id === id)
                  const range = opt ? `${opt.min}–${opt.max}` : '—'
                  return (
                    <tr key={id} style={{ background: idx % 2 === 0 ? '#fff' : '#F8FAFC' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 3,
                            backgroundColor: colourMap[id] || '#64748B',
                            display: 'inline-block',
                          }}
                        />
                      </td>
                      <td
                        style={{
                          padding: '10px 12px',
                          fontWeight: 600,
                          color: '#0F172A',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {id}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#475569' }}>{range}</td>
                      <td
                        style={{
                          padding: '10px 12px',
                          textAlign: 'right',
                          fontWeight: 700,
                          color: '#0F172A',
                        }}
                      >
                        {qty}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #0F172A' }}>
                  <td
                    colSpan={2}
                    style={{
                      padding: '12px 12px',
                      fontWeight: 700,
                      color: '#0F172A',
                      fontSize: 12,
                    }}
                  >
                    Total
                  </td>
                  <td style={{ padding: '12px 12px', color: '#475569', fontSize: 11 }}>
                    {totalTiles} tiles
                  </td>
                  <td
                    style={{
                      padding: '12px 12px',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: '#0F172A',
                    }}
                  >
                    {totalPedestals}
                  </td>
                </tr>
              </tfoot>
            </table>

            <div
              style={{
                marginTop: 12,
                padding: '8px 10px',
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 6,
                fontSize: 9,
                color: '#64748B',
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: '#0F172A' }}>Note:</strong> Quantities are based on computed
              pedestal heights. Heights outside defined SKU ranges are listed as Unmatched. Verify
              site conditions prior to ordering.
            </div>
          </div>
        </div>
      </div>

      {/* ===== SCREEN LAYOUT ===== */}
      <div className="screen-only" style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flexGrow: 1 }}>
          <svg
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            style={{ border: '1px solid #e5e7eb', borderRadius: 8 }}
          >
            {polyPointStrings.map((points, index) => (
              <polygon key={index} points={points} fill="none" stroke="#0F172A" strokeWidth="2" />
            ))}
            {calcData.tiles?.map((tile, i) => (
              <g key={i}>
                {normalizeTileShapeRings(tile.shape).map((poly, j) => (
                  <polygon
                    key={j}
                    points={poly.map((pt) => P(pt).join(',')).join(' ')}
                    fill="none"
                    stroke="#d1d5db"
                    strokeWidth="1"
                  />
                ))}
              </g>
            ))}
            {calcData.pedestals?.map((p, i) => {
              const mm = convertToMm(p.height)
              const prod = pedestalOptions[selectedCategory].find((o) => mm >= o.min && mm <= o.max)
              const id = prod ? prod.id : 'Unmatched'
              const [cx, cy] = P([p.x, p.y])
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={3}
                  fill={colourMap[id] || '#000'}
                  onMouseEnter={() => {
                    setHoveredPedestal(p)
                    setTooltipPosition({ x: cx, y: cy })
                  }}
                  onMouseLeave={() => setHoveredPedestal(null)}
                  style={{ cursor: 'pointer' }}
                />
              )
            })}
            {hoveredPedestal &&
              (() => {
                const heightText = formatHeight(hoveredPedestal.height, unitSystem)
                const tooltipWidth = Math.max(60, heightText.length * 7 + 16)
                return (
                  <g>
                    <rect
                      x={tooltipPosition.x - tooltipWidth / 2}
                      y={tooltipPosition.y - 30}
                      width={tooltipWidth}
                      height={22}
                      fill="rgba(0,0,0,0.85)"
                      rx={4}
                      stroke="rgba(255,255,255,0.2)"
                      strokeWidth="1"
                    />
                    <text
                      x={tooltipPosition.x}
                      y={tooltipPosition.y - 15}
                      fill="white"
                      fontSize="12"
                      textAnchor="middle"
                      fontFamily="Arial, sans-serif"
                      fontWeight="500"
                    >
                      {heightText}
                    </text>
                  </g>
                )
              })()}
          </svg>
        </div>

        <div style={panelStyle}>
          {onShowInstructions && (
            <div style={{ marginBottom: '16px' }}>
              <button
                onClick={onShowInstructions}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  backgroundColor: '#F8FAFC',
                  color: '#475569',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#F1F5F9'
                  e.currentTarget.style.borderColor = '#CBD5E1'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#F8FAFC'
                  e.currentTarget.style.borderColor = '#E2E8F0'
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  style={{ flexShrink: 0 }}
                >
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  <path
                    d="M8 7.5V11.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <circle cx="8" cy="5" r="0.75" fill="currentColor" />
                </svg>
                <span>Step Instructions</span>
              </button>
            </div>
          )}

          <h2 style={sectionTitle}>Quote Summary</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <strong>Tiles</strong>
              <div>{totalTiles}</div>
            </div>
            <div>
              <strong>Pedestals</strong>
              <div>{totalPedestals}</div>
            </div>
          </div>

          <h3 style={{ ...sectionTitle, fontSize: 16, marginTop: 8 }}>Pedestal Category</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {Object.keys(pedestalOptions).map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={selectedCategory === cat ? activeButtonStyle : buttonStyle}
              >
                {cat}
              </button>
            ))}
          </div>

          <h3 style={{ ...sectionTitle, fontSize: 16, marginTop: 12 }}>Breakdown</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {Object.entries(grouped).map(([id, q]) => (
              <li
                key={id}
                style={{ display: 'flex', alignItems: 'center', marginBottom: 8, fontSize: 14 }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    backgroundColor: colourMap[id] || '#000',
                    border: '1px solid #000',
                    marginRight: 8,
                    display: 'inline-block',
                    borderRadius: 2,
                  }}
                />
                <span>
                  {id}: <strong>{q}</strong>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

QuoteStep.propTypes = {
  calcData: PropTypes.shape({
    userPolygon: PropTypes.array,
    tiles: PropTypes.array,
    pedestals: PropTypes.array,
    tileCount: PropTypes.number,
  }).isRequired,
  unitSystem: PropTypes.oneOf(['imperial', 'metric']).isRequired,
  onShowInstructions: PropTypes.func,
}

export default QuoteStep
