import React, { useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import enmonLogo from '../../../assets/brand/enmon-logo.svg'
import { useLanguage } from '../../../context/LanguageContext'
import TileCanvas from '../../components/PedestalCalculator/TileCanvas'

/* ---------- CONSTANTS ------------------------------------------- */
const CANVAS_WIDTH = 900
const CANVAS_HEIGHT = 580

const PRINT_W = 370
const PRINT_H = 530
const PRINT_MARGIN = 14

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
  '#2563EB', '#16A34A', '#DC2626', '#D97706', '#7C3AED',
  '#0891B2', '#BE185D', '#65A30D', '#EA580C', '#0F766E',
]

/* ---------- HELPERS --------------------------------------------- */
const convertToMm = (heightCm) => Math.max(0, Math.round(heightCm * 10))

const formatHeight = (heightCm, unit) => {
  if (unit === 'imperial') return `${(heightCm / 2.54).toFixed(2)} in`
  return `${heightCm.toFixed(2)} cm`
}

const makeColourMap = (ids) => {
  const map = {}
  ids.forEach((id, i) => { map[id] = PALETTE[i % PALETTE.length] })
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
    if (Array.isArray(polygon[0]) && isCoordinatePair(polygon[0][0]))
      return polygon.filter((ring) => Array.isArray(ring) && isCoordinatePair(ring[0]))
    return []
  })

/* ---------- SCREEN SUB-COMPONENTS ------------------------------- */
const SectionLabel = ({ children }) => (
  <div style={{
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.6px', color: 'var(--pc-ink-3)', marginBottom: 8,
  }}>
    {children}
  </div>
)

const StatCard = ({ label, value, sub }) => (
  <div style={{
    padding: '10px 12px',
    background: 'var(--pc-surface-2)',
    border: '1px solid var(--pc-line)',
    borderRadius: 8,
  }}>
    <div style={{ fontSize: 10, color: 'var(--pc-ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--pc-ink)', marginTop: 2 }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: 'var(--pc-ink-3)', marginTop: 1 }}>{sub}</div>}
  </div>
)

/* ---------- COMPONENT ------------------------------------------- */
const QuoteStep = ({
  calcData,
  unitSystem,
  onShowInstructions,
  projectName,
  userEmail,
  metrics,
  gridSize,
  zoom,
  setZoom,
  panOffset,
  setPanOffset,
}) => {
  const { t, language } = useLanguage()
  const [selectedCategory, setSelectedCategory] = useState('Pro Series')
  const [notes, setNotes] = useState('')
  const canvasContainerRef = useRef(null)
  const [canvasSize, setCanvasSize] = useState({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT })

  const { grouped, idsUsed } = useMemo(() => {
    const g = {}, ids = new Set()
    calcData.pedestals?.forEach((p) => {
      const mm = convertToMm(p.height)
      const prod = pedestalOptions[selectedCategory].find((o) => mm >= o.min && mm <= o.max)
      const id = prod ? prod.id : t('calculator.unmatched')
      ids.add(id)
      g[id] = (g[id] || 0) + 1
    })
    return { grouped: g, idsUsed: [...ids] }
  }, [calcData.pedestals, selectedCategory])

  const colourMap = useMemo(() => makeColourMap(idsUsed), [idsUsed])
  const userPolygons = useMemo(() => normalizeUserPolygons(calcData.userPolygon), [calcData.userPolygon])
  const polygonPoints = userPolygons.flat()

  useEffect(() => {
    const element = canvasContainerRef.current
    if (!element) return undefined

    const updateSize = () => {
      const rect = element.getBoundingClientRect()
      setCanvasSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const totalPedestals = calcData.pedestals?.length || 0
  const totalTiles = calcData.tileCount || 0
  const unitToPixel = Number.isFinite(gridSize) && gridSize > 0 ? gridSize / 100 : 0.5
  const cmToPx = (val) => val * unitToPixel
  const quotePedestalColor = useMemo(() => (pedestal) => {
    const mm = convertToMm(pedestal.height)
    const prod = pedestalOptions[selectedCategory].find((o) => mm >= o.min && mm <= o.max)
    const id = prod ? prod.id : t('calculator.unmatched')
    return colourMap[id] || '#64748B'
  }, [colourMap, selectedCategory, t])
  const quoteFontFamily =
    language === 'zh'
      ? '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "Heiti SC", sans-serif'
      : '"Helvetica Neue", Arial, sans-serif'
  const quoteStyles = `
        ${language === 'zh' ? "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;800&display=swap');" : ''}
        .qs-print { display: none !important; }
        @media print {
          @page { margin: 0.4in; size: letter portrait; }
          body * { visibility: hidden !important; }
          .qs-print, .qs-print * { visibility: visible !important; }
          .qs-print {
            display: block !important;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            padding: 0.4in;
            box-sizing: border-box;
            margin: 0;
            font-family: ${quoteFontFamily};
            font-size: 12px;
          }
          .qs-print-inner {
            max-width: 700px;
            margin: 0 auto;
          }
          .qs-screen { display: none !important; }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
        }
      `

  const today = new Date().toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const quoteRef = `QT-${Date.now().toString(36).toUpperCase().slice(-6)}`

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%' }}>
      <style>{quoteStyles}</style>

      {/* ===== PRINT LAYOUT ===== */}
      <div className="qs-print" style={{ fontFamily: quoteFontFamily, color: '#0F172A' }}>
      <div className="qs-print-inner">

        {/* Print Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          paddingBottom: 12, borderBottom: '3px solid #0F172A', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src={enmonLogo} alt="ENMON" style={{ height: 30, width: 'auto' }} />
            <div>
              <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>{t('calculator.pedestalsOutdoorFlooring')}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.3px' }}>{t('calculator.materialQuote')}</div>
            <div style={{ fontSize: 10, color: '#64748B', marginTop: 3 }}>{t('calculator.reference')}: {quoteRef} &nbsp;·&nbsp; {today}</div>
          </div>
        </div>

        {/* Project Info Bar */}
        <div style={{
          display: 'flex', gap: 0, marginBottom: 14,
          border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden',
        }}>
          {[
            { label: t('projects.project'), value: projectName || t('projects.untitled') },
            { label: t('calculator.preparedFor'), value: userEmail || '—' },
            { label: t('calculator.category'), value: selectedCategory },
            { label: t('calculator.date'), value: today },
          ].map(({ label, value }, i, arr) => (
            <div key={label} style={{
              flex: 1, padding: '8px 12px',
              borderRight: i < arr.length - 1 ? '1px solid #E2E8F0' : 'none',
              background: i === 0 ? '#F8FAFC' : '#fff',
            }}>
              <div style={{ fontSize: 8, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Summary Stats Row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[
            { label: t('calculator.tiles'), value: totalTiles.toLocaleString(), color: '#2563EB' },
            { label: t('calculator.pedestals'), value: totalPedestals.toLocaleString(), color: '#16A34A' },
            { label: t('calculator.skus'), value: Object.keys(grouped).length, color: '#7C3AED' },
            { label: metrics?.area ? `${t('projects.area')} (${metrics.areaUnit})` : t('projects.area'), value: metrics?.area || '—', color: '#0891B2' },
            { label: t('calculator.avgHeight'), value: metrics?.averageHeight ? `${metrics.averageHeight} ${metrics.heightUnit}` : '—', color: '#D97706' },
          ].map(({ label, value, color, highlight }) => (
            <div key={label} style={{
              flex: 1, padding: '8px 10px',
              background: highlight ? '#0F172A' : '#F8FAFC',
              border: `1px solid ${highlight ? '#0F172A' : '#E2E8F0'}`,
              borderRadius: 8,
              borderTop: `3px solid ${color}`,
            }}>
              <div style={{ fontSize: 8, color: highlight ? 'rgba(255,255,255,0.6)' : '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: highlight ? '#fff' : '#0F172A', whiteSpace: 'nowrap' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Two-column body */}
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', pageBreakInside: 'avoid', breakInside: 'avoid' }}>

          {/* Left: Layout Plan */}
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
              {t('calculator.layoutPlan')}
            </div>
            <div style={{ border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden', lineHeight: 0 }}>
              <svg width={PRINT_W} height={PRINT_H} style={{ display: 'block', background: '#FAFAFA' }}>
                <rect width={PRINT_W} height={PRINT_H} fill="#FAFAFA" />
                {(() => {
                  if (!polygonPoints.length) return (
                    <text x={PRINT_W / 2} y={PRINT_H / 2} textAnchor="middle" fontSize={11} fill="#94A3B8" fontFamily="Arial">{t('calculator.noLayoutData')}</text>
                  )
                  const xs = polygonPoints.map((p) => p[0])
                  const ys = polygonPoints.map((p) => p[1])
                  const w = Math.max(...xs) - Math.min(...xs)
                  const h = Math.max(...ys) - Math.min(...ys)
                  const ps = Math.min((PRINT_W - PRINT_MARGIN * 2) / w, (PRINT_H - PRINT_MARGIN * 2) / h)
                  const ox = (PRINT_W - w * ps) / 2 - Math.min(...xs) * ps
                  const oy = (PRINT_H - h * ps) / 2 - Math.min(...ys) * ps
                  const Pp = ([x, y]) => [x * ps + ox, y * ps + oy]
                  const printPolyStrings = userPolygons.map((polygon) => polygon.map((p) => Pp(p).join(',')).join(' '))
                  return (
                    <>
                      {printPolyStrings.map((points, index) => (
                        <polygon key={index} points={points} fill="#EFF6FF" stroke="#0F172A" strokeWidth="1.5" />
                      ))}
                      {calcData.tiles?.map((tile, i) => (
                        <g key={i}>
                          {normalizeTileShapeRings(tile.shape).map((poly, j) => (
                            <polygon key={j} points={poly.map((pt) => Pp(pt).join(',')).join(' ')} fill="none" stroke="#CBD5E1" strokeWidth="0.4" />
                          ))}
                        </g>
                      ))}
                      {calcData.pedestals?.map((p, i) => {
                        const mm = convertToMm(p.height)
                        const prod = pedestalOptions[selectedCategory].find((o) => mm >= o.min && mm <= o.max)
                        const id = prod ? prod.id : t('calculator.unmatched')
                        const [cx, cy] = Pp([p.x, p.y])
                        return <circle key={i} cx={cx} cy={cy} r={2.5} fill={colourMap[id] || '#64748B'} />
                      })}
                    </>
                  )
                })()}
              </svg>
            </div>
            {/* Print legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 8 }}>
              {Object.entries(grouped).map(([id, qty]) => (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: colourMap[id] || '#64748B', display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, color: '#0F172A' }}>{id}</span>
                  <span style={{ color: '#64748B' }}>×{qty}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Schedule + Pricing */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
              {t('calculator.pedestalSchedule')}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: '#0F172A' }}>
                  {['', 'SKU', t('calculator.rangeMm'), t('calculator.qty')].map((h, i) => (
                    <th key={i} style={{
                      padding: '8px 10px',
                      textAlign: i === 3 ? 'right' : 'left',
                      color: '#fff', fontWeight: 700, fontSize: 9,
                      whiteSpace: 'nowrap',
                      width: i === 0 ? 16 : 'auto',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(grouped).map(([id, qty], idx) => {
                  const opt = Object.values(pedestalOptions).flat().find((o) => o.id === id)
                  const range = opt ? `${opt.min}–${opt.max}` : '—'
                  return (
                    <tr key={id} style={{ background: idx % 2 === 0 ? '#fff' : '#F8FAFC' }}>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colourMap[id] || '#64748B', display: 'inline-block' }} />
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap' }}>{id}</td>
                      <td style={{ padding: '8px 10px', color: '#475569' }}>{range}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>{qty}</td>
                    </tr>
                  )
                })}
                {totalTiles > 0 && (
                  <tr style={{ background: Object.keys(grouped).length % 2 === 0 ? '#fff' : '#F8FAFC' }}>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#94A3B8', display: 'inline-block' }} />
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0F172A' }}>{t('calculator.tiles600')}</td>
                    <td style={{ padding: '8px 10px', color: '#475569' }}>—</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>{totalTiles}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #0F172A', background: '#0F172A' }}>
                  <td colSpan={2} style={{ padding: '10px 10px', fontWeight: 800, color: '#fff', fontSize: 12 }}>{t('calculator.total')}</td>
                  <td style={{ padding: '10px 10px', color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>{totalTiles} {t('calculator.tiles').toLowerCase()}</td>
                  <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 800, color: '#fff', fontSize: 13 }}>{totalPedestals}</td>
                </tr>
              </tfoot>
            </table>

            {/* Notes on print */}
            {notes.trim() && (
              <div style={{ marginTop: 12, padding: '8px 10px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>{t('calculator.projectNotes')}</div>
                <div style={{ fontSize: 10, color: '#78350F', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{notes}</div>
              </div>
            )}

            {/* Disclaimer */}
            <div style={{
              marginTop: 14, padding: '8px 10px',
              background: '#F8FAFC', border: '1px solid #E2E8F0',
              borderRadius: 6, fontSize: 8, color: '#94A3B8', lineHeight: 1.6,
            }}>
              <strong style={{ color: '#64748B' }}>{t('calculator.disclaimerLabel')}:</strong> {t('calculator.disclaimerText')}
            </div>

            {/* Print footer */}
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#94A3B8' }}>
              <span>{t('calculator.generatedBy')}</span>
              <span>enmon.ae &nbsp;·&nbsp; {today}</span>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* ===== SCREEN LAYOUT ===== */}
      <div
        className="qs-screen"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 16,
          flex: 1,
          width: '100%',
          minHeight: 0,
          fontFamily: quoteFontFamily,
        }}
      >

        {/* Canvas area */}
        <div
          ref={canvasContainerRef}
          className="pc-panel"
          style={{
            flex: '1 1 0',
            minWidth: 0,
            overflow: 'hidden',
            background: 'var(--pc-canvas-bg)',
            position: 'relative',
          }}
        >
          <TileCanvas
            userPolygon={calcData.userPolygon || []}
            dimensionLabels={[]}
            tiles={calcData.tiles || []}
            pedestals={calcData.pedestals || []}
            showSubTiles={true}
            unitSystem={unitSystem}
            cmToPx={cmToPx}
            onPedestalClick={() => {}}
            zoom={zoom}
            panOffset={panOffset}
            setPanOffset={setPanOffset}
            setZoom={setZoom}
            showPedestalShadows={false}
            pedestalColorResolver={quotePedestalColor}
            pedestalTooltipFormatter={(pedestal) => formatHeight(pedestal.height || 0, unitSystem)}
            width={canvasSize.width}
            height={canvasSize.height}
          />
        </div>

        {/* Right panel */}
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
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {onShowInstructions && (
            <button
              className="pc-btn"
              type="button"
              onClick={onShowInstructions}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {t('calculator.stepInstructions')}
            </button>
          )}

          {/* Summary section */}
          <div>
            <SectionLabel>{t('calculator.summary')}</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <StatCard label={t('calculator.tiles')} value={totalTiles.toLocaleString()} />
              <StatCard label={t('calculator.pedestals')} value={totalPedestals.toLocaleString()} />
              {metrics?.area && <StatCard label={`${t('projects.area')} (${metrics.areaUnit})`} value={metrics.area} />}
              {metrics?.averageHeight && metrics.averageHeight !== '--' && (
                <StatCard label={`${t('calculator.avgHeight')} (${metrics.heightUnit})`} value={metrics.averageHeight} />
              )}
            </div>
          </div>

          {/* Category */}
          <div>
            <SectionLabel>{t('calculator.pedestalCategory')}</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {Object.keys(pedestalOptions).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: '9px 8px',
                    borderRadius: 8,
                    border: `1.5px solid ${selectedCategory === cat ? '#0F172A' : 'var(--pc-line)'}`,
                    backgroundColor: selectedCategory === cat ? '#0F172A' : 'var(--pc-surface-2)',
                    color: selectedCategory === cat ? '#fff' : 'var(--pc-ink)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* SKU Breakdown */}
          <div>
            <SectionLabel>{t('calculator.skuBreakdown')}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {Object.entries(grouped).map(([id, qty]) => {
                const opt = Object.values(pedestalOptions).flat().find((o) => o.id === id)
                return (
                  <div key={id} style={{
                    display: 'flex', alignItems: 'center',
                    padding: '9px 10px',
                    background: 'var(--pc-surface-2)',
                    border: '1px solid var(--pc-line)',
                    borderRadius: 8,
                    borderLeft: `4px solid ${colourMap[id] || '#64748B'}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--pc-ink)' }}>{id}</div>
                      {opt && <div style={{ fontSize: 10, color: 'var(--pc-ink-3)', marginTop: 1 }}>{opt.min}–{opt.max} mm</div>}
                    </div>
                    <div style={{
                      fontSize: 14, fontWeight: 800, color: 'var(--pc-ink)',
                      background: 'var(--pc-surface)',
                      border: '1px solid var(--pc-line)',
                      borderRadius: 20,
                      padding: '2px 10px',
                      minWidth: 36, textAlign: 'center',
                    }}>{qty}</div>
                  </div>
                )
              })}
              {Object.keys(grouped).length === 0 && (
                <div style={{ padding: '12px 10px', color: 'var(--pc-ink-3)', fontSize: 12, textAlign: 'center', background: 'var(--pc-surface-2)', border: '1px solid var(--pc-line)', borderRadius: 8 }}>
                  {t('calculator.noPedestalData')}
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <SectionLabel>{t('calculator.notes')}</SectionLabel>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('calculator.addProjectNotes')}
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 10px', fontSize: 12, lineHeight: 1.5,
                border: '1px solid var(--pc-line)', borderRadius: 8,
                background: 'var(--pc-surface-2)', color: 'var(--pc-ink)',
                resize: 'vertical', fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>
        </aside>
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
  projectName: PropTypes.string,
  userEmail: PropTypes.string,
  metrics: PropTypes.shape({
    area: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    areaUnit: PropTypes.string,
    averageHeight: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    heightUnit: PropTypes.string,
  }),
  gridSize: PropTypes.number.isRequired,
  zoom: PropTypes.number.isRequired,
  setZoom: PropTypes.func.isRequired,
  panOffset: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }).isRequired,
  setPanOffset: PropTypes.func.isRequired,
}

export default QuoteStep
