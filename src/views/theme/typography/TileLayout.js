import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Delaunay } from 'd3-delaunay'
import polygonClipping from 'polygon-clipping'
import PropTypes from 'prop-types'

import {
  findContainingTriangle,
  barycentricCoordinates,
  midpointSegmentPoints,
  dedupeAndSnapPedestals,
} from '../../components/PedestalCalculator/geometryUtils'

import TileCanvas from '../../components/PedestalCalculator/TileCanvas'
import TileOptionsPanel from '../../components/PedestalCalculator/TileOptionsPanel'
import LoadingOverlay from '../../components/PedestalCalculator/LoadingOverlay'

const TILE_TYPES = [
  { id: 'tile16-16', name: 'Tile 16×16 in', width: 40.64, height: 40.64 },
  { id: 'tile16-48', name: 'Tile 16×48 in', width: 121.92, height: 40.64 },
  { id: 'tile50-50', name: 'Tile 50×50 cm', width: 50, height: 50, imperialWidth: 50.8, imperialHeight: 50.8 },
  { id: 'tile60-60', name: 'Tile 60×60 cm', width: 60, height: 60, imperialWidth: 60.96, imperialHeight: 60.96 },
  { id: 'tile30-60', name: 'Tile 30×60 cm', width: 60, height: 30, imperialWidth: 60.96, imperialHeight: 30.48 },
  { id: 'tile40-60', name: 'Tile 40×60 cm', width: 60, height: 40, imperialWidth: 60.96, imperialHeight: 40.64 },
  { id: 'tile60-120', name: 'Tile 60×120 cm', width: 120, height: 60, imperialWidth: 121.92, imperialHeight: 60.96 },
  { id: 'tile30-120', name: 'Tile 30×120 cm', width: 120, height: 30, imperialWidth: 121.92, imperialHeight: 30.48 },
]

const EPSILON = 1e-6

const ensureClosedRing = (ring) => {
  if (!ring.length) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return ring
  return [...ring, first]
}

const extractOuterRings = (multiPolygon) =>
  (Array.isArray(multiPolygon) ? multiPolygon : [])
    .map((polygon) => polygon?.[0])
    .filter((ring) => Array.isArray(ring) && ring.length >= 3)

const extractBoundaryRings = (multiPolygon) =>
  (Array.isArray(multiPolygon) ? multiPolygon : [])
    .flatMap((polygon) => (Array.isArray(polygon) ? polygon : []))
    .filter((ring) => Array.isArray(ring) && ring.length >= 3)

const collapsePolygonState = (rings) => {
  if (!rings.length) return []
  return rings.length === 1 ? rings[0] : rings
}

const pointInRing = ([x, y], ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

const orientation = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

const segmentsIntersect = (a, b, c, d) => {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  return o1 * o2 < -EPSILON && o3 * o4 < -EPSILON
}

const geometryCanUseInteriorFastPath = (geometry) =>
  Array.isArray(geometry) && geometry.length > 0 && geometry.every((polygon) => polygon.length === 1)

const rectIsFullyInsideGeometry = (rectRing, geometry) => {
  if (!geometryCanUseInteriorFastPath(geometry)) return false

  const corners = rectRing.slice(0, 4)
  const rectEdges = corners.map((point, index) => [point, corners[(index + 1) % corners.length]])

  return geometry.some((polygon) => {
    const outer = polygon[0]
    if (!corners.every((corner) => pointInRing(corner, outer))) return false

    for (let i = 0; i < outer.length; i++) {
      const edgeStart = outer[i]
      const edgeEnd = outer[(i + 1) % outer.length]
      if (rectEdges.some(([rectStart, rectEnd]) => segmentsIntersect(rectStart, rectEnd, edgeStart, edgeEnd))) {
        return false
      }
    }
    return true
  })
}

const getTileIntersection = (subRect, geometry) => {
  const rectRing = subRect?.[0]
  if (Array.isArray(rectRing) && rectIsFullyInsideGeometry(rectRing, geometry)) {
    return [subRect]
  }
  return polygonClipping.intersection(subRect, geometry)
}

const pointInProjectGeometry = (point, geometry) =>
  (Array.isArray(geometry) ? geometry : []).some((polygon) => {
    const outer = polygon?.[0]
    if (!Array.isArray(outer) || !pointInRing(point, outer)) return false
    return !polygon.slice(1).some((hole) => pointInRing(point, hole))
  })

const createTileRect = (x, y, w, h) => [
  [
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y],
    ],
  ],
]

const getTileDimensions = (tile, unitSystem) => {
  if (unitSystem === 'imperial') {
    return {
      width: tile.imperialWidth || tile.width,
      height: tile.imperialHeight || tile.height,
    }
  }
  return { width: tile.width, height: tile.height }
}

const mergeTileShape = (shape) => {
  if (!Array.isArray(shape) || shape.length <= 1) return shape
  try {
    const merged = polygonClipping.union(...shape)
    return Array.isArray(merged) && merged.length ? merged : shape
  } catch (_) {
    return shape
  }
}

const TileLayout = ({
  points,
  gridSize,
  unitSystem,
  onDataCalculated,
  onShowInstructions,
  zoom,
  setZoom,
  panOffset,
  setPanOffset,
}) => {
  const canvasContainerRef = useRef(null)
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 600 })

  useEffect(() => {
    const el = canvasContainerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) setCanvasSize({ width: Math.floor(width), height: Math.floor(height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const [selectedTileType, setSelectedTileType] = useState(TILE_TYPES[0])
  const [isOffset, setIsOffset] = useState('none')
  const [showSubTiles, setShowSubTiles] = useState(true)
  const [orientation, setOrientation] = useState('landscape')

  const [tiles, setTiles] = useState([])
  const [pedestals, setPedestals] = useState([])
  const [userPolygon, setUserPolygon] = useState([])
  const [dimensionLabels, setDimensionLabels] = useState([])

  // Load initial state from localStorage
  const getInitialSelectedTileType = () => {
    try {
      const saved = localStorage.getItem('tileLayout_selectedTileType')
      if (saved) {
        const parsed = JSON.parse(saved)
        return TILE_TYPES.find((t) => t.id === parsed.id) || TILE_TYPES[0]
      }
    } catch (e) {}
    return TILE_TYPES[0]
  }

  const getInitialIsOffset = () => {
    try {
      const saved = localStorage.getItem('tileLayout_isOffset')
      if (saved) return saved
    } catch (e) {}
    return 'none'
  }

  const getInitialOrientation = () => {
    try {
      const saved = localStorage.getItem('tileLayout_orientation')
      if (saved) return saved
    } catch (e) {}
    return 'landscape'
  }

  const [selectedTileTypeState, setSelectedTileTypeState] = useState(getInitialSelectedTileType())
  const [isOffsetState, setIsOffsetState] = useState(getInitialIsOffset())
  const [orientationState, setOrientationState] = useState(getInitialOrientation())
  const [showRedPedestals, setShowRedPedestals] = useState(false)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [isComputing, setIsComputing] = useState(false)

  // Save state to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('tileLayout_selectedTileType', JSON.stringify(selectedTileTypeState))
  }, [selectedTileTypeState])

  useEffect(() => {
    localStorage.setItem('tileLayout_isOffset', isOffsetState)
  }, [isOffsetState])

  useEffect(() => {
    localStorage.setItem('tileLayout_orientation', orientationState)
  }, [orientationState])

  // Reset offset to 'stuck' if current offset is not allowed for selected tile
  useEffect(() => {
    const tileId = selectedTileTypeState.id

    // square and short rectangular tiles: no offset allowed
    if (
      (tileId === 'tile16-16' ||
        tileId === 'tile16-48' ||
        tileId === 'tile50-50' ||
        tileId === 'tile60-60' ||
        tileId === 'tile30-60' ||
        tileId === 'tile40-60') &&
      isOffsetState !== false &&
      isOffsetState !== 'none'
    ) {
      setIsOffsetState(false)
    }
    // tile60-120: only 1/2 offset allowed, not 1/3
    else if (tileId === 'tile60-120' && isOffsetState === 'third') {
      setIsOffsetState(false)
    }
    // tile30-120: both offsets allowed, no change needed
  }, [selectedTileTypeState, isOffsetState])

  // Convert centimeters to pixels
  const unitToPixel = gridSize / 100
  const cmToPx = (val) => val * unitToPixel

  // Zoom and pan are now passed as props from parent component

  const handleZoomIn = () => {
    setZoom((prev) => prev * 1.1)
  }
  const handleZoomOut = () => {
    setZoom((prev) => prev * 0.9)
  }

  // Generate tiles & pedestals logic
  const generateTilesAndPedestals = useCallback(() => {
    // 1. Merge all "additive" polygons
    const additivePolygons = points
      .filter((shape) => shape.type === 'add' && shape.points.length)
      .map((shape) =>
        shape.points.map((p) => ({
          x: p.x,
          y: p.y,
          height: parseFloat(p.height) || 0,
        })),
      )
    // 2. Merge all "subtractive" polygons
    const subtractivePolygons = points
      .filter((shape) => shape.type === 'sub' && shape.points.length)
      .map((shape) => shape.points.map((p) => [p.x, p.y]))

    if (additivePolygons.length === 0) {
      setTiles([])
      setPedestals([])
      setUserPolygon([])
      setDimensionLabels([])
      return
    }

    const additivePolysFormatted = additivePolygons.map((poly) => [
      ensureClosedRing(poly.map((p) => [p.x, p.y])),
    ])
    let projectGeometry = polygonClipping.union(...additivePolysFormatted)

    // 3. Apply subtractions
    if (subtractivePolygons.length > 0 && projectGeometry?.length) {
      const subtractPolysFormatted = subtractivePolygons.map((poly) => [ensureClosedRing(poly)])
      projectGeometry = polygonClipping.difference(projectGeometry, ...subtractPolysFormatted)
    }

    const layoutPolygons = extractOuterRings(projectGeometry)
    const boundaryRings = extractBoundaryRings(projectGeometry)
    const userPolygonState = collapsePolygonState(layoutPolygons)

    setUserPolygon(userPolygonState)
    const mainAddShape = points.find((shape) => shape.type === 'add' && shape.points.length)
    if (
      layoutPolygons.length === 1 &&
      mainAddShape &&
      Array.isArray(mainAddShape.dimensionLabels) &&
      mainAddShape.dimensionLabels.length === layoutPolygons[0].length
    ) {
      setDimensionLabels(mainAddShape.dimensionLabels)
    } else {
      setDimensionLabels([])
    }

    // 4. Create control points for triangulation
    const controlPoints = []
    additivePolygons.forEach((poly) => {
      poly.forEach((p) => {
        controlPoints.push(p)
      })
    })

    if (controlPoints.length < 3 || layoutPolygons.length === 0) {
      setTiles([])
      setPedestals([])
      return
    }

    // 5. Triangulate
    const delaunay = Delaunay.from(
      controlPoints,
      (p) => p.x,
      (p) => p.y,
    )
    const triangles = []
    for (let i = 0; i < delaunay.triangles.length; i += 3) {
      const triIndices = delaunay.triangles.slice(i, i + 3)
      const p0 = controlPoints[triIndices[0]]
      const p1 = controlPoints[triIndices[1]]
      const p2 = controlPoints[triIndices[2]]
      triangles.push([p0, p1, p2])
    }

    // 6. Generate tile placements
    const selectedTileDims = getTileDimensions(selectedTileTypeState, unitSystem)
    let tileWidthCm = selectedTileDims.width
    let tileHeightCm = selectedTileDims.height

    // Swap dimensions if in portrait orientation
    if (orientationState === 'portrait') {
      ;[tileWidthCm, tileHeightCm] = [tileHeightCm, tileWidthCm]
    }

    // Pedestal on every tile corner, then repeatedly add exact midpoints on
    // spans longer than the maximum allowed support spacing.
    const createTilePiece = (px, py, w, h) => createTileRect(px, py, w, h)
    const xs = controlPoints.map((p) => p.x)
    const ys = controlPoints.map((p) => p.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    const gridYPositions = []
    let currentY = minY
    while (currentY <= maxY + EPSILON) {
      gridYPositions.push(currentY)
      currentY += tileHeightCm
    }

    const newTiles = []
    const maxSupportSpacingCm = unitSystem === 'imperial' ? 60.96 : 60
    const getPedestalHeight = (vx, vy) => {
      const point = { x: vx, y: vy }
      const tri = findContainingTriangle(point, triangles)
      if (tri) {
        const { l0, l1, l2 } = barycentricCoordinates(vx, vy, ...tri)
        return l0 * tri[0].height + l1 * tri[1].height + l2 * tri[2].height
      }
      const nearestIndex = delaunay.find(vx, vy)
      return controlPoints[nearestIndex].height
    }

    if (orientationState === 'portrait') {
      // Portrait: loop over columns (x), offset y
      for (let x = minX; x <= maxX + EPSILON; x += tileWidthCm) {
        let colIndex = Math.round((x - minX) / tileWidthCm)
        let offsetY = 0
        if (
          isOffsetState === 'third' &&
          (selectedTileTypeState.id === 'tile60-120' || selectedTileTypeState.id === 'tile30-120')
        ) {
          offsetY = (colIndex % 3) * (tileHeightCm / 3)
        } else if (
          isOffsetState === 'half' &&
          (selectedTileTypeState.id === 'tile60-120' || selectedTileTypeState.id === 'tile30-120')
        ) {
          offsetY = (colIndex % 2) * (tileHeightCm / 2)
        }
        // Only add a tile at the top edge if offsetY > 0 and offsetY < tileHeightCm
        if (offsetY > 0 && offsetY < tileHeightCm) {
          let y = minY
          const curTileW = Math.min(tileWidthCm, maxX - x)
          // Only use the offset portion for the height
          const curTileH = Math.min(offsetY, tileHeightCm, maxY - y)
          // Only create if the tile is not a thin sliver (e.g., > 2cm)
          if (curTileW > 0 && curTileH > 2) {
            const subRects = createTilePiece(x, y, curTileW, curTileH)
            const mergedSubRectShape = []
            subRects.forEach((subRect) => {
              const intersection = getTileIntersection(subRect, projectGeometry)
              if (intersection.length > 0) {
                mergedSubRectShape.push(...intersection)
              }
            })
            if (mergedSubRectShape.length > 0) {
              newTiles.push({
                x,
                y,
                width: curTileW,
                height: curTileH,
                shape: mergeTileShape(mergedSubRectShape),
              })
            }
          }
        }
        // Continue with the offset pattern for the rest of the column
        for (let y = minY + offsetY; y <= maxY + EPSILON; y += tileHeightCm) {
          const curTileW = Math.min(tileWidthCm, maxX - x)
          const curTileH = Math.min(tileHeightCm, maxY - y)
          if (curTileW <= 0 || curTileH <= 0) continue

          const subRects = createTilePiece(x, y, curTileW, curTileH)
          const mergedSubRectShape = []

          subRects.forEach((subRect) => {
            const intersection = getTileIntersection(subRect, projectGeometry)
            if (intersection.length > 0) {
              mergedSubRectShape.push(...intersection)
            }
          })

          if (mergedSubRectShape.length > 0) {
            newTiles.push({
              x,
              y,
              width: curTileW,
              height: curTileH,
              shape: mergeTileShape(mergedSubRectShape),
            })
          }
        }
      }
    } else {
      // Landscape: loop over rows (y), offset x
      gridYPositions.forEach((y, rowIndex) => {
        let offsetX = 0
        if (
          isOffsetState === 'third' &&
          (selectedTileTypeState.id === 'tile60-120' || selectedTileTypeState.id === 'tile30-120')
        ) {
          offsetX = (rowIndex % 3) * (tileWidthCm / 3)
        } else if (
          isOffsetState === 'half' &&
          (selectedTileTypeState.id === 'tile60-120' || selectedTileTypeState.id === 'tile30-120')
        ) {
          offsetX = (rowIndex % 2) * (tileWidthCm / 2)
        }
        const startX = minX + offsetX
        const firstTileX = Math.floor((minX - offsetX) / tileWidthCm) * tileWidthCm + offsetX
        for (let x = firstTileX; x <= maxX + EPSILON; x += tileWidthCm) {
          const curTileW = Math.min(tileWidthCm, maxX - x)
          const curTileH = Math.min(tileHeightCm, maxY - y)
          if (curTileW <= 0 || curTileH <= 0) continue

          const subRects = createTilePiece(x, y, curTileW, curTileH)
          const mergedSubRectShape = []

          subRects.forEach((subRect) => {
            const intersection = getTileIntersection(subRect, projectGeometry)
            if (intersection.length > 0) {
              mergedSubRectShape.push(...intersection)
            }
          })

          if (mergedSubRectShape.length > 0) {
            newTiles.push({
              x,
              y,
              width: curTileW,
              height: curTileH,
              shape: mergeTileShape(mergedSubRectShape),
            })
          }
        }
      })
    }

    const supportPedestals = []
    const supportPositions = new Set()
    const addSupportPedestal = (vx, vy) => {
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) return
      const key = `${Number(vx).toFixed(6)},${Number(vy).toFixed(6)}`
      if (supportPositions.has(key)) return
      supportPositions.add(key)
      supportPedestals.push({ x: vx, y: vy, height: getPedestalHeight(vx, vy) })
    }

    boundaryRings.forEach((polygon) => {
      const closed = ensureClosedRing(polygon)
      for (let i = 0; i < closed.length - 1; i++) {
        midpointSegmentPoints(closed[i], closed[i + 1], maxSupportSpacingCm).forEach(([vx, vy]) => {
          addSupportPedestal(vx, vy)
        })
      }
    })

    for (let x = minX; x <= maxX + EPSILON; x += maxSupportSpacingCm) {
      for (let y = minY; y <= maxY + EPSILON; y += maxSupportSpacingCm) {
        if (pointInProjectGeometry([x, y], projectGeometry)) addSupportPedestal(x, y)
      }
    }

    boundaryRings.forEach((polygon) => {
      polygon.forEach(([vx, vy]) => {
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) return
        addSupportPedestal(vx, vy)
      })
    })

    setTiles(newTiles)

    const filledPedestals = dedupeAndSnapPedestals(supportPedestals, boundaryRings, 0.35, {
      preserveAnchor: true,
    })
    setPedestals(filledPedestals)

    // Callback with data if needed
    if (onDataCalculated) {
      onDataCalculated({
        tiles: newTiles,
        pedestals: filledPedestals,
        userPolygon: userPolygonState,
        tileCount: newTiles.length,
      })
    }
  }, [points, selectedTileTypeState, isOffsetState, gridSize, onDataCalculated, orientationState, unitSystem])

  useEffect(() => {
    if (points.length > 0) {
      setIsComputing(true)
      const timer = setTimeout(() => {
        generateTilesAndPedestals()
        setIsComputing(false)
      }, 0)
      return () => clearTimeout(timer)
    } else {
      setTiles([])
      setPedestals([])
      setUserPolygon([])
    }
  }, [points, generateTilesAndPedestals, orientationState])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: '16px',
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* The Canvas */}
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
          userPolygon={userPolygon}
          dimensionLabels={dimensionLabels}
          tiles={tiles}
          pedestals={pedestals}
          showSubTiles={true}
          unitSystem={unitSystem}
          cmToPx={cmToPx}
          onPedestalClick={() => {}}
          zoom={zoom}
          panOffset={panOffset}
          setPanOffset={setPanOffset}
          setZoom={setZoom}
          showRedPedestals={showRedPedestals}
          width={canvasSize.width}
          height={canvasSize.height}
        />
        <LoadingOverlay visible={isComputing} label="Computing layout…" />
      </div>

      {/* Side Options Panel */}
      <div
        style={{
          overflow: 'auto',
          width: isPanelCollapsed ? '48px' : 'min(280px, 100%)',
          maxWidth: '100%',
          transition: 'width 0.3s ease',
          flex: '0 0 280px',
          position: 'relative',
        }}
      >
        <TileOptionsPanel
          selectedTileType={selectedTileTypeState}
          setSelectedTileType={setSelectedTileTypeState}
          isOffset={isOffsetState}
          setIsOffset={setIsOffsetState}
          showSubTiles={showSubTiles}
          setShowSubTiles={setShowSubTiles}
          unitSystem={unitSystem}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          orientation={orientationState}
          setOrientation={setOrientationState}
          showRedPedestals={showRedPedestals}
          setShowRedPedestals={setShowRedPedestals}
          isCollapsed={isPanelCollapsed}
          onToggleCollapse={() => setIsPanelCollapsed(!isPanelCollapsed)}
          onShowInstructions={onShowInstructions}
        />
      </div>
    </div>
  )
}

TileLayout.propTypes = {
  points: PropTypes.arrayOf(
    PropTypes.shape({
      type: PropTypes.oneOf(['add', 'sub']).isRequired,
      points: PropTypes.arrayOf(
        PropTypes.shape({
          x: PropTypes.number.isRequired,
          y: PropTypes.number.isRequired,
          height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
        }),
      ).isRequired,
    }),
  ).isRequired,
  gridSize: PropTypes.number.isRequired,
  unitSystem: PropTypes.oneOf(['metric', 'imperial']).isRequired,
  onDataCalculated: PropTypes.func,
  onShowInstructions: PropTypes.func,
  zoom: PropTypes.number.isRequired,
  setZoom: PropTypes.func.isRequired,
  panOffset: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }).isRequired,
  setPanOffset: PropTypes.func.isRequired,
}

export default TileLayout
