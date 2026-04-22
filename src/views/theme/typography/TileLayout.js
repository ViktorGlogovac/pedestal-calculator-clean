import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Delaunay } from 'd3-delaunay'
import polygonClipping from 'polygon-clipping'
import PropTypes from 'prop-types'

import {
  pointInTriangle,
  findContainingTriangle,
  barycentricCoordinates,
  subdivideTileRect,
  dedupeAndSnapPedestals,
} from '../../components/PedestalCalculator/geometryUtils'

import TileCanvas from '../../components/PedestalCalculator/TileCanvas'
import TileOptionsPanel from '../../components/PedestalCalculator/TileOptionsPanel'

const TILE_TYPES = [
  { id: 'tile16-16', name: 'Tile 16×16 in', width: 40.64, height: 40.64 },
  { id: 'tile60-60', name: 'Tile 60×60 cm', width: 60, height: 60 },
  { id: 'tile40-60', name: 'Tile 40×60 cm', width: 60, height: 40 },
  { id: 'tile60-120', name: 'Tile 60×120 cm', width: 120, height: 60 },
  { id: 'tile30-120', name: 'Tile 30×120 cm', width: 120, height: 30 },
]

const EPSILON = 1e-6

const isCoordinatePair = (point) =>
  Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number'

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

const collapsePolygonState = (rings) => {
  if (!rings.length) return []
  return rings.length === 1 ? rings[0] : rings
}

const normalizeBoundaryPolygons = (boundary) => {
  if (!Array.isArray(boundary) || boundary.length === 0) return []
  if (isCoordinatePair(boundary[0])) return [boundary]
  if (Array.isArray(boundary[0]) && isCoordinatePair(boundary[0][0])) return boundary
  return []
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
  const [showRedPedestals, setShowRedPedestals] = useState(true)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)

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
      (tileId === 'tile16-16' || tileId === 'tile60-60' || tileId === 'tile40-60') &&
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
    let tileWidthCm = selectedTileTypeState.width
    let tileHeightCm = selectedTileTypeState.height

    // Swap dimensions if in portrait orientation
    if (orientationState === 'portrait') {
      ;[tileWidthCm, tileHeightCm] = [tileHeightCm, tileWidthCm]
    }

    const stepCm = 60 // subdividing step for smaller polygons
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
    const newPedestals = []
    const pedestalPositions = new Set()

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
            const subRects = subdivideTileRect(x, y, curTileW, curTileH, stepCm)
            const mergedSubRectShape = []
            subRects.forEach((subRect) => {
              const intersection = polygonClipping.intersection(subRect, projectGeometry)
              if (intersection.length > 0) {
                mergedSubRectShape.push(...intersection)
                // For each vertex, find pedestal height
                const flattened = intersection.flat(2)
                const verticesSet = new Set()
                flattened.forEach(([px, py]) => {
                  verticesSet.add(`${px},${py}`)
                })
                const vertices = Array.from(verticesSet).map((k) => {
                  const [vx, vy] = k.split(',').map(Number)
                  return [vx, vy]
                })
                vertices.forEach(([vx, vy]) => {
                  const key = `${vx},${vy}`
                  if (!pedestalPositions.has(key)) {
                    let height
                    const point = { x: vx, y: vy }
                    const tri = findContainingTriangle(point, triangles)
                    if (tri) {
                      const { l0, l1, l2 } = barycentricCoordinates(vx, vy, ...tri)
                      height = l0 * tri[0].height + l1 * tri[1].height + l2 * tri[2].height
                    } else {
                      const nearestIndex = delaunay.find(vx, vy)
                      height = controlPoints[nearestIndex].height
                    }
                    newPedestals.push({ x: vx, y: vy, height })
                    pedestalPositions.add(key)
                  }
                })
              }
            })
            if (mergedSubRectShape.length > 0) {
              newTiles.push({
                x,
                y,
                width: curTileW,
                height: curTileH,
                shape: mergedSubRectShape,
              })
            }
          }
        }
        // Continue with the offset pattern for the rest of the column
        for (let y = minY + offsetY; y <= maxY + EPSILON; y += tileHeightCm) {
          const curTileW = Math.min(tileWidthCm, maxX - x)
          const curTileH = Math.min(tileHeightCm, maxY - y)
          if (curTileW <= 0 || curTileH <= 0) continue

          const subRects = subdivideTileRect(x, y, curTileW, curTileH, stepCm)
          const mergedSubRectShape = []

          subRects.forEach((subRect) => {
            const intersection = polygonClipping.intersection(subRect, projectGeometry)
            if (intersection.length > 0) {
              mergedSubRectShape.push(...intersection)

              // For each vertex, find pedestal height
              const flattened = intersection.flat(2)
              const verticesSet = new Set()
              flattened.forEach(([px, py]) => {
                verticesSet.add(`${px},${py}`)
              })
              const vertices = Array.from(verticesSet).map((k) => {
                const [vx, vy] = k.split(',').map(Number)
                return [vx, vy]
              })

              vertices.forEach(([vx, vy]) => {
                const key = `${vx},${vy}`
                if (!pedestalPositions.has(key)) {
                  let height
                  const point = { x: vx, y: vy }
                  const tri = findContainingTriangle(point, triangles)
                  if (tri) {
                    const { l0, l1, l2 } = barycentricCoordinates(vx, vy, ...tri)
                    height = l0 * tri[0].height + l1 * tri[1].height + l2 * tri[2].height
                  } else {
                    const nearestIndex = delaunay.find(vx, vy)
                    height = controlPoints[nearestIndex].height
                  }
                  newPedestals.push({ x: vx, y: vy, height })
                  pedestalPositions.add(key)
                }
              })
            }
          })

          if (mergedSubRectShape.length > 0) {
            newTiles.push({
              x,
              y,
              width: curTileW,
              height: curTileH,
              shape: mergedSubRectShape,
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

          const subRects = subdivideTileRect(x, y, curTileW, curTileH, stepCm)
          const mergedSubRectShape = []

          subRects.forEach((subRect) => {
            const intersection = polygonClipping.intersection(subRect, projectGeometry)
            if (intersection.length > 0) {
              mergedSubRectShape.push(...intersection)

              // For each vertex, find pedestal height
              const flattened = intersection.flat(2)
              const verticesSet = new Set()
              flattened.forEach(([px, py]) => {
                verticesSet.add(`${px},${py}`)
              })
              const vertices = Array.from(verticesSet).map((k) => {
                const [vx, vy] = k.split(',').map(Number)
                return [vx, vy]
              })

              vertices.forEach(([vx, vy]) => {
                const key = `${vx},${vy}`
                if (!pedestalPositions.has(key)) {
                  let height
                  const point = { x: vx, y: vy }
                  const tri = findContainingTriangle(point, triangles)
                  if (tri) {
                    const { l0, l1, l2 } = barycentricCoordinates(vx, vy, ...tri)
                    height = l0 * tri[0].height + l1 * tri[1].height + l2 * tri[2].height
                  } else {
                    const nearestIndex = delaunay.find(vx, vy)
                    height = controlPoints[nearestIndex].height
                  }
                  newPedestals.push({ x: vx, y: vy, height })
                  pedestalPositions.add(key)
                }
              })
            }
          })

          if (mergedSubRectShape.length > 0) {
            newTiles.push({
              x,
              y,
              width: curTileW,
              height: curTileH,
              shape: mergedSubRectShape,
            })
          }
        }
      })
    }

    setTiles(newTiles)

    // Merge close pedestals (within 60cm) except for tile corners
    function isOnBoundary(pedestal, boundary, tol = 2) {
      const polygons = normalizeBoundaryPolygons(boundary)
      if (polygons.length > 1) {
        return polygons.some((polygon) => isOnBoundary(pedestal, polygon, tol))
      }
      // 2 cm tolerance
      // Check if the pedestal is close to any boundary vertex
      for (let i = 0; i < boundary.length; i++) {
        const [vx, vy] = boundary[i]
        if (Math.abs(pedestal.x - vx) < tol && Math.abs(pedestal.y - vy) < tol) {
          return true
        }
      }
      // Check if the pedestal is close to any segment of the boundary polygon
      for (let i = 0; i < boundary.length; i++) {
        const [x1, y1] = boundary[i]
        const [x2, y2] = boundary[(i + 1) % boundary.length]
        // Compute projection of pedestal onto segment
        const dx = x2 - x1
        const dy = y2 - y1
        const lengthSq = dx * dx + dy * dy
        if (lengthSq < EPSILON) continue
        const t = ((pedestal.x - x1) * dx + (pedestal.y - y1) * dy) / lengthSq
        if (t >= -0.05 && t <= 1.05) {
          // allow a little extra margin
          // Closest point on segment
          const px = x1 + t * dx
          const py = y1 + t * dy
          const dist = Math.sqrt((pedestal.x - px) ** 2 + (pedestal.y - py) ** 2)
          if (dist < tol) return true
        }
      }
      return false
    }

    function isTileCornerPedestal(pedestal, tiles) {
      // A pedestal is a tile corner if it matches any tile's corner
      return tiles.some((tile) => {
        const corners = [
          [tile.x, tile.y],
          [tile.x + tile.width, tile.y],
          [tile.x, tile.y + tile.height],
          [tile.x + tile.width, tile.y + tile.height],
        ]
        return corners.some(
          ([cx, cy]) => Math.abs(cx - pedestal.x) < EPSILON && Math.abs(cy - pedestal.y) < EPSILON,
        )
      })
    }

    function isTileCornerOrBoundaryPedestal(pedestal, tiles, boundary) {
      return isTileCornerPedestal(pedestal, tiles) || (boundary && isOnBoundary(pedestal, boundary))
    }

    function mergeClosePedestalsAdaptive(
      pedestals,
      tiles,
      boundary,
      maxDist = 60,
      orientation = 'landscape',
    ) {
      const merged = []
      const used = new Array(pedestals.length).fill(false)
      const tol = 2 // cm tolerance for grouping by row/col
      // Helper to group by row or column
      function getGroupKey(p) {
        return orientation === 'landscape'
          ? Math.round(p.y / tol) * tol
          : Math.round(p.x / tol) * tol
      }
      // Group pedestals by row (landscape) or column (portrait)
      const groups = {}
      pedestals.forEach((p, i) => {
        if (isTileCornerOrBoundaryPedestal(p, tiles, boundary)) {
          merged.push(p)
          used[i] = true
        } else {
          const key = getGroupKey(p)
          if (!groups[key]) groups[key] = []
          groups[key].push({ ...p, _idx: i })
        }
      })
      // For each group, merge close pedestals
      Object.values(groups).forEach((group) => {
        // Sort by x (landscape) or y (portrait)
        group.sort((a, b) => (orientation === 'landscape' ? a.x - b.x : a.y - b.y))
        for (let i = 0; i < group.length; i++) {
          if (used[group[i]._idx]) continue
          let cluster = [group[i]]
          used[group[i]._idx] = true
          for (let j = i + 1; j < group.length; j++) {
            if (used[group[j]._idx]) continue
            const dx = group[i].x - group[j].x
            const dy = group[i].y - group[j].y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist <= maxDist + EPSILON) {
              cluster.push(group[j])
              used[group[j]._idx] = true
            }
          }
          if (cluster.length === 1) {
            merged.push(cluster[0])
          } else {
            // Merge to average
            const avg = cluster.reduce(
              (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, height: acc.height + p.height }),
              { x: 0, y: 0, height: 0 },
            )
            merged.push({
              x: avg.x / cluster.length,
              y: avg.y / cluster.length,
              height: avg.height / cluster.length,
            })
          }
        }
      })
      return merged
    }
    const mergedPedestals = mergeClosePedestalsAdaptive(
      dedupeAndSnapPedestals(newPedestals, userPolygonState),
      newTiles,
      userPolygonState,
      60,
      orientationState,
    )
    setPedestals(mergedPedestals)

    // Callback with data if needed
    if (onDataCalculated) {
      onDataCalculated({
        tiles: newTiles,
        pedestals: mergedPedestals,
        userPolygon: userPolygonState,
        tileCount: newTiles.length,
      })
    }
  }, [points, selectedTileTypeState, isOffsetState, gridSize, onDataCalculated, orientationState])

  useEffect(() => {
    if (points.length > 0) {
      generateTilesAndPedestals()
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
