import React, { useEffect, useState, useCallback } from 'react'
import { Delaunay } from 'd3-delaunay'
import polygonClipping from 'polygon-clipping'
import PropTypes from 'prop-types'

import {
  pointInTriangle,
  findContainingTriangle,
  barycentricCoordinates,
  subdivideTileRect,
  dedupeAndSnapPedestals,
  findNearestPointIndex,
} from '../../components/PedestalCalculator/geometryUtils'

import TileCanvas from '../../components/PedestalCalculator/TileCanvas'
import PedestalEditor from '../../components/PedestalCalculator/PedestalEditor'
import TileOptionsPanel from '../../components/PedestalCalculator/TileOptionsPanel'

const TILE_TYPES = [
  { id: 'tile16-16', name: 'Tile 16×16 in', width: 40.64, height: 40.64 },
  { id: 'tile60-60', name: 'Tile 60×60 cm', width: 60, height: 60 },
  { id: 'tile40-60', name: 'Tile 40×60 cm', width: 60, height: 40 },
  { id: 'tile60-120', name: 'Tile 60×120 cm', width: 120, height: 60 },
  { id: 'tile30-120', name: 'Tile 30×120 cm', width: 120, height: 30 },
]

const EPSILON = 1e-6

const TileGridArchitectUI = ({ points, gridSize, unitSystem, onDataCalculated }) => {
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
      const saved = localStorage.getItem('tileGrid_selectedTileType')
      if (saved) {
        const parsed = JSON.parse(saved)
        return TILE_TYPES.find((t) => t.id === parsed.id) || TILE_TYPES[0]
      }
    } catch (e) {}
    return TILE_TYPES[0]
  }

  const getInitialIsOffset = () => {
    try {
      const saved = localStorage.getItem('tileGrid_isOffset')
      if (saved) return saved
    } catch (e) {}
    return 'none'
  }

  const getInitialOrientation = () => {
    try {
      const saved = localStorage.getItem('tileGrid_orientation')
      if (saved) return saved
    } catch (e) {}
    return 'landscape'
  }

  const getInitialAdjustedPedestals = () => {
    try {
      const saved = localStorage.getItem('tileGrid_adjustedPedestals')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && Array.isArray(parsed)) {
          return parsed
        }
      }
    } catch (e) {}
    return []
  }

  const [selectedTileTypeState, setSelectedTileTypeState] = useState(getInitialSelectedTileType())
  const [isOffsetState, setIsOffsetState] = useState(getInitialIsOffset())
  const [orientationState, setOrientationState] = useState(getInitialOrientation())
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)

  // Keep track of user overrides for pedestal heights
  const [adjustedPedestals, setAdjustedPedestals] = useState(getInitialAdjustedPedestals())

  // Save state to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('tileGrid_selectedTileType', JSON.stringify(selectedTileTypeState))
  }, [selectedTileTypeState])

  useEffect(() => {
    localStorage.setItem('tileGrid_isOffset', isOffsetState)
  }, [isOffsetState])

  useEffect(() => {
    localStorage.setItem('tileGrid_orientation', orientationState)
  }, [orientationState])

  useEffect(() => {
    localStorage.setItem('tileGrid_adjustedPedestals', JSON.stringify(adjustedPedestals))
  }, [adjustedPedestals])

  useEffect(() => {
    const tileId = selectedTileTypeState.id

    if (
      (tileId === 'tile16-16' || tileId === 'tile60-60' || tileId === 'tile40-60') &&
      isOffsetState !== false &&
      isOffsetState !== 'none'
    ) {
      setIsOffsetState(false)
    } else if (tileId === 'tile60-120' && isOffsetState === 'third') {
      setIsOffsetState(false)
    }
  }, [selectedTileTypeState, isOffsetState])

  // For editing pedestal
  const [editingPedestalIndex, setEditingPedestalIndex] = useState(null)
  const [pedestalModalPos, setPedestalModalPos] = useState({ x: 0, y: 0 })
  const [pedestalTempHeight, setPedestalTempHeight] = useState('')

  // Convert centimeters to pixels
  const unitToPixel = gridSize / 100
  const cmToPx = (val) => val * unitToPixel

  // ----------------------------
  // Zoom & Pan moved here
  // ----------------------------
  const [zoom, setZoom] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })

  const handleZoomIn = () => {
    setZoom((prev) => prev * 1.1)
  }
  const handleZoomOut = () => {
    setZoom((prev) => prev * 0.9)
  }

  // --------------------------------
  // Generate tiles & pedestals logic
  // --------------------------------
  const generateTilesAndPedestals = useCallback(() => {
    // 1. Merge all "additive" polygons
    const additivePolygons = points
      .filter((shape) => shape.type === 'add' && shape.points.length)
      .map((shape) =>
        shape.points.map((p) => ({
          x: p.x, // already cm
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

    let mainPoly
    if (additivePolygons.length === 1) {
      mainPoly = additivePolygons[0].map((p) => [p.x, p.y])
    } else {
      const additivePolysFormatted = additivePolygons.map((poly) => [poly.map((p) => [p.x, p.y])])
      const unionPoly = polygonClipping.union(...additivePolysFormatted)
      if (unionPoly && unionPoly.length > 0 && unionPoly[0].length > 0) {
        mainPoly = unionPoly[0][0]
      }
    }

    // 3. Apply subtractions
    if (subtractivePolygons.length > 0 && mainPoly) {
      const subtractPolysFormatted = subtractivePolygons.map((poly) => [poly])
      const diffPoly = polygonClipping.difference([mainPoly], ...subtractPolysFormatted)
      if (diffPoly && diffPoly.length > 0 && diffPoly[0].length > 0) {
        mainPoly = diffPoly[0][0]
      }
    }

    setUserPolygon(mainPoly || [])
    const mainAddShape = points.find((shape) => shape.type === 'add' && shape.points.length)
    if (
      mainAddShape &&
      Array.isArray(mainAddShape.dimensionLabels) &&
      mainAddShape.dimensionLabels.length === (mainPoly || []).length
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
    adjustedPedestals.forEach((p) => {
      controlPoints.push(p)
    })

    if (controlPoints.length < 3 || !mainPoly) {
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

    gridYPositions.forEach((y, rowIndex) => {
      /* ---------- 1. absolute row number ---------- */
      const rowNum = rowIndex // 0,1,2,3…

      /* ---------- 2. horizontal shift for this row ---------- */
      let offsetX = 0
      if (
        isOffsetState === 'third' &&
        (selectedTileTypeState.id === 'tile60-120' || selectedTileTypeState.id === 'tile30-120')
      ) {
        // True 1/3 offset: 0, 1/3, 2/3, repeat
        offsetX = (rowNum % 2) * (tileWidthCm / 2)
      } else if (
        isOffsetState === 'half' &&
        (selectedTileTypeState.id === 'tile60-120' || selectedTileTypeState.id === 'tile30-120')
      ) {
        // 1/2 running bond
        offsetX = (rowNum % 2) * (tileWidthCm / 2) // 0 → ½ → 0 → …
      }

      /* ---------- 3. start x far enough to the left ---------- */
      // left-most tile whose left edge ≤ minX after shift
      const firstTileX = Math.floor((minX - offsetX) / tileWidthCm) * tileWidthCm + offsetX

      for (let x = firstTileX; x < maxX + EPSILON; x += tileWidthCm) {
        const curTileW = Math.min(tileWidthCm, maxX - x)
        const curTileH = Math.min(tileHeightCm, maxY - y)
        if (curTileW <= 0 || curTileH <= 0) continue

        const subRects = subdivideTileRect(x, y, curTileW, curTileH, stepCm)
        const mergedSubRectShape = []

        subRects.forEach((subRect) => {
          const intersection = polygonClipping.intersection(subRect, [mainPoly])
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
                const adjP = adjustedPedestals.find((p) => p.x === vx && p.y === vy)
                if (adjP) {
                  height = adjP.height
                } else {
                  const point = { x: vx, y: vy }
                  const tri = findContainingTriangle(point, triangles)
                  if (tri) {
                    const { l0, l1, l2 } = barycentricCoordinates(vx, vy, ...tri)
                    height = l0 * tri[0].height + l1 * tri[1].height + l2 * tri[2].height
                  } else {
                    const nearestIndex = delaunay.find(vx, vy)
                    height = controlPoints[nearestIndex].height
                  }
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
            shape: mergedSubRectShape, // array of polygons
          })
        }
      }
    })

    const normalizedPedestals = dedupeAndSnapPedestals(newPedestals, mainPoly)

    setTiles(newTiles)
    setPedestals(normalizedPedestals)

    // Callback with data if needed
    if (onDataCalculated) {
      onDataCalculated({
        tiles: newTiles,
        pedestals: normalizedPedestals,
        userPolygon: mainPoly,
        tileCount: newTiles.length,
      })
    }
  }, [
    points,
    adjustedPedestals,
    selectedTileTypeState,
    isOffsetState,
    gridSize,
    onDataCalculated,
    orientationState,
  ])

  useEffect(() => {
    if (points.length > 0) {
      generateTilesAndPedestals()
    }
  }, [points, generateTilesAndPedestals, adjustedPedestals, orientationState])

  // --------------------------------
  // Pedestal editing logic
  // --------------------------------
  const handlePedestalClick = (canvasX, canvasY) => {
    // Convert from canvas coords (px) -> cm
    const cmX = canvasX / unitToPixel
    const cmY = canvasY / unitToPixel
    const threshold = 5 / unitToPixel

    const pedestalIndex = findNearestPointIndex(pedestals, { x: cmX, y: cmY }, threshold)
    if (pedestalIndex !== -1) {
      const p = pedestals[pedestalIndex]
      setEditingPedestalIndex(pedestalIndex)
      let currentHeight = p.height
      if (unitSystem === 'imperial') {
        currentHeight = (p.height / 2.54).toFixed(2)
      } else {
        currentHeight = p.height.toFixed(2)
      }
      setPedestalTempHeight(currentHeight)

      const modalX = p.x * unitToPixel * zoom + panOffset.x + 10
      const modalY = p.y * unitToPixel * zoom + panOffset.y - 30
      setPedestalModalPos({ x: modalX, y: modalY })
    }
  }

  const savePedestalEdit = () => {
    if (editingPedestalIndex == null) return
    const numericVal = parseFloat(pedestalTempHeight)
    if (isNaN(numericVal)) {
      alert('Invalid height entered. Please enter a number.')
      return
    }
    // Convert back to cm if in imperial
    const newHeight = unitSystem === 'imperial' ? numericVal * 2.54 : numericVal

    const updatedPed = { ...pedestals[editingPedestalIndex], height: newHeight }

    // Update adjustedPedestals
    setAdjustedPedestals((prev) => {
      const idx = prev.findIndex((p) => p.x === updatedPed.x && p.y === updatedPed.y)
      if (idx !== -1) {
        const clone = [...prev]
        clone[idx] = updatedPed
        return clone
      } else {
        return [...prev, updatedPed]
      }
    })

    // Update pedestals state
    setPedestals((prev) => {
      const clone = [...prev]
      clone[editingPedestalIndex] = updatedPed
      return clone
    })

    setEditingPedestalIndex(null)
  }

  const cancelPedestalEdit = () => {
    setEditingPedestalIndex(null)
  }

  const deletePedestal = () => {
    if (editingPedestalIndex == null) return
    const { x, y } = pedestals[editingPedestalIndex]
    setAdjustedPedestals((prev) => prev.filter((p) => !(p.x === x && p.y === y)))
    setEditingPedestalIndex(null)
  }

  // Add orientation change handler
  const handleOrientationChange = (newOrientation) => {
    setOrientationState(newOrientation)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: '16px',
        position: 'relative',
        zIndex: 1,
        overflow: 'visible',
      }}
    >
      {/* The Canvas */}
      <div style={{ flex: '1 1 640px', minWidth: 0, overflowX: 'auto' }}>
        <TileCanvas
          userPolygon={userPolygon}
          dimensionLabels={dimensionLabels}
          tiles={tiles}
          pedestals={pedestals}
          showSubTiles={true}
          unitSystem={unitSystem}
          cmToPx={cmToPx}
          onPedestalClick={handlePedestalClick}
          zoom={zoom}
          panOffset={panOffset}
          setPanOffset={setPanOffset}
          setZoom={setZoom}
        />
      </div>

      {/* Pedestal Editor (Modal) */}
      {editingPedestalIndex !== null && pedestals[editingPedestalIndex] && (
        <PedestalEditor
          pedestal={pedestals[editingPedestalIndex]}
          unitSystem={unitSystem}
          pedestalTempHeight={pedestalTempHeight}
          setPedestalTempHeight={setPedestalTempHeight}
          onSave={savePedestalEdit}
          onDelete={deletePedestal}
          onCancel={cancelPedestalEdit}
          modalPosition={pedestalModalPos}
        />
      )}

      {/* Side Options Panel */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          overflow: 'visible',
          width: isPanelCollapsed ? '48px' : 'min(280px, 100%)',
          maxWidth: '100%',
          transition: 'width 0.3s ease',
          flex: '0 1 280px',
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
          setOrientation={handleOrientationChange}
          isCollapsed={isPanelCollapsed}
          onToggleCollapse={() => setIsPanelCollapsed(!isPanelCollapsed)}
        />
      </div>
    </div>
  )
}

TileGridArchitectUI.propTypes = {
  points: PropTypes.array.isRequired,
  gridSize: PropTypes.number.isRequired,
  unitSystem: PropTypes.string.isRequired,
  onDataCalculated: PropTypes.func,
}

export default TileGridArchitectUI
