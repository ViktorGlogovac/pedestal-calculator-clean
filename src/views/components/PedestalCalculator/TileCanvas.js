import React, { useEffect, useRef, useCallback, useState } from 'react'
import PropTypes from 'prop-types'
import { polygonSignedArea } from './geometryUtils'
import polygonClipping from 'polygon-clipping'

export const CANVAS_WIDTH = 900
export const CANVAS_HEIGHT = 600
export const DIMENSION_OFFSET_PX = 15

const isCoordinatePair = (point) =>
  Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number'

const normalizeUserPolygons = (userPolygon) => {
  if (!Array.isArray(userPolygon) || userPolygon.length === 0) return []
  if (isCoordinatePair(userPolygon[0])) return [userPolygon]
  if (Array.isArray(userPolygon[0]) && isCoordinatePair(userPolygon[0][0])) return userPolygon
  return []
}

const TileCanvas = ({
  userPolygon,
  dimensionLabels = [],
  tiles,
  pedestals,
  showSubTiles,
  unitSystem,
  cmToPx,
  onPedestalClick,
  // Zoom & Pan from parent
  zoom,
  panOffset,
  setPanOffset,
  setZoom,
  userPedestals = [],
  edgePedestals,
  selectedRowY,
  isDraggingRow,
  onRowDragStart,
  onRowDragMove,
  onRowDragEnd,
  selectionStart,
  selectionEnd,
  isSelecting,
  onSelectionStart,
  onSelectionMove,
  onSelectionEnd,
  showRedPedestals = true,
  width = CANVAS_WIDTH,
  height = CANVAS_HEIGHT,
}) => {
  const canvasRef = useRef(null)
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0 })

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#faf9f6'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(panOffset.x, panOffset.y)
    ctx.scale(zoom, zoom)

    const userPolygons = normalizeUserPolygons(userPolygon)

    // 1. Draw dimension lines around userPolygon
    userPolygons.forEach((polygon) => {
      if (!polygon || polygon.length < 2) return

      const signedArea = polygonSignedArea(polygon)
      const isClockwise = signedArea < 0
      const labelsForPolygon = userPolygons.length === 1 ? dimensionLabels : []

      for (let i = 0; i < polygon.length; i++) {
        const pt = polygon[i]
        const next = polygon[(i + 1) % polygon.length]
        const dx = next[0] - pt[0]
        const dy = next[1] - pt[1]
        const lengthCm = Math.sqrt(dx * dx + dy * dy)

        if (lengthCm < 1e-6) continue

        let label, unitLabel
        const exactLabel = labelsForPolygon[i] || null
        const exactUnit = String(exactLabel?.unit || '').toLowerCase()
        const canUseExactImperial =
          unitSystem === 'imperial' &&
          exactLabel?.value != null &&
          ['ft', 'feet', 'foot'].includes(exactUnit)
        const canUseExactMetric =
          unitSystem !== 'imperial' &&
          exactLabel?.value != null &&
          ['m', 'meter', 'meters', 'metre', 'metres'].includes(exactUnit)

        if (canUseExactImperial || canUseExactMetric) {
          label = Number(exactLabel.value).toFixed(2)
          unitLabel = unitSystem === 'imperial' ? 'ft' : 'm'
        } else if (unitSystem === 'imperial') {
          const distFt = lengthCm / 30.48
          label = distFt.toFixed(2)
          unitLabel = 'ft'
        } else {
          const distM = lengthCm / 100
          label = distM.toFixed(2)
          unitLabel = 'm'
        }

        const px1 = cmToPx(pt[0])
        const py1 = cmToPx(pt[1])
        const px2 = cmToPx(next[0])
        const py2 = cmToPx(next[1])

        const edx = px2 - px1
        const edy = py2 - py1
        const edist = Math.sqrt(edx * edx + edy * edy)

        // unit direction
        const ux = edx / edist
        const uy = edy / edist

        // normal vector
        let nx = -uy
        let ny = ux
        if (!isClockwise) {
          nx = -nx
          ny = -ny
        }

        const offsetX1 = px1 + nx * DIMENSION_OFFSET_PX
        const offsetY1 = py1 + ny * DIMENSION_OFFSET_PX
        const offsetX2 = px2 + nx * DIMENSION_OFFSET_PX
        const offsetY2 = py2 + ny * DIMENSION_OFFSET_PX
        const midX = (offsetX1 + offsetX2) / 2
        const midY = (offsetY1 + offsetY2) / 2

        // dimension line
        ctx.beginPath()
        ctx.moveTo(offsetX1, offsetY1)
        ctx.lineTo(offsetX2, offsetY2)
        ctx.strokeStyle = '#3a3a38'
        ctx.lineWidth = 1
        ctx.stroke()

        // text
        ctx.fillStyle = '#3a3a38'
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${label} ${unitLabel}`, midX, midY)
      }
    })

    // 2. Outline of user polygon
    userPolygons.forEach((polygon) => {
      if (!polygon || polygon.length === 0) return
      ctx.beginPath()
      polygon.forEach((pt, i) => {
        const x = cmToPx(pt[0])
        const y = cmToPx(pt[1])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.closePath()
      ctx.strokeStyle = '#1d4ed8'
      ctx.lineWidth = 2
      ctx.stroke()
    })

    // 3. Pedestals (red circles)
    // Calculate min and max heights for relative scaling
    const heights = pedestals.map((p) => p.height || 0)
    const minHeight = Math.min(...heights)
    const maxHeight = Math.max(...heights)
    const heightRange = maxHeight - minHeight
    const hasHeightValues = maxHeight > 0 // Check if any pedestal has a height value

    pedestals.forEach((p) => {
      const cx = cmToPx(p.x)
      const cy = cmToPx(p.y)

      // If this pedestal is user-set, color it green
      const isUserSet = userPedestals.some((up) => {
        const dx = Math.abs(up.x - p.x)
        const dy = Math.abs(up.y - p.y)
        // Use a more generous tolerance for coordinate comparison
        return dx < 0.1 && dy < 0.1
      })

      // Skip red pedestals if showRedPedestals is false
      if (!isUserSet && !showRedPedestals) {
        return
      }

      // Only draw shadow if we have height values and this pedestal has a height
      if (hasHeightValues && p.height > 0) {
        // Calculate relative height (0 to 1) within this project's range
        const relativeHeight = heightRange > 0 ? (p.height - minHeight) / heightRange : 0.5

        // Draw shadow first
        const shadowSize = Math.max(8, Math.min(20, 8 + relativeHeight * 12)) // Base size + relative scaling
        const shadowOpacity = Math.max(0.1, Math.min(0.3, 0.1 + relativeHeight * 0.2)) // Base opacity + relative scaling

        ctx.beginPath()
        ctx.arc(cx, cy + 4, shadowSize, 0, 2 * Math.PI)
        ctx.fillStyle = `rgba(0, 0, 0, ${shadowOpacity})`
        ctx.fill()
      }

      // Draw pedestal on top
      ctx.beginPath()
      ctx.arc(cx, cy, 4, 0, 2 * Math.PI)

      ctx.fillStyle = isUserSet ? '#16a34a' : '#dc2626'
      ctx.fill()
    })

    // Draw AI/manual anchor overlays so imported AI depth locations remain
    // visible even when they snap onto an existing pedestal node.
    userPedestals.forEach((anchor) => {
      const overlappingPedestal = pedestals.find((p) => {
        const dx = Math.abs(p.x - anchor.x)
        const dy = Math.abs(p.y - anchor.y)
        return dx < 0.1 && dy < 0.1
      })

      const anchorX = overlappingPedestal ? overlappingPedestal.x : anchor.x
      const anchorY = overlappingPedestal ? overlappingPedestal.y : anchor.y
      const cx = cmToPx(anchorX)
      const cy = cmToPx(anchorY)
      const isAiDepthAnchor = anchor.source === 'ai-depth'

      ctx.beginPath()
      ctx.arc(cx, cy, isAiDepthAnchor ? 7 : 5, 0, 2 * Math.PI)
      ctx.lineWidth = isAiDepthAnchor ? 2.5 : 2
      ctx.strokeStyle = isAiDepthAnchor ? '#0ea5e9' : '#166534'
      ctx.stroke()

      if (!overlappingPedestal) {
        ctx.beginPath()
        ctx.arc(cx, cy, isAiDepthAnchor ? 4 : 5, 0, 2 * Math.PI)
        ctx.fillStyle = isAiDepthAnchor ? 'rgba(14, 165, 233, 0.9)' : 'rgba(34, 197, 94, 0.9)'
        ctx.fill()
      } else if (isAiDepthAnchor) {
        ctx.beginPath()
        ctx.arc(cx, cy, 1.75, 0, 2 * Math.PI)
        ctx.fillStyle = '#0ea5e9'
        ctx.fill()
      }
    })

    // 4. Tiles
    ctx.lineWidth = 1
    ctx.strokeStyle = '#d9d8d2'

    tiles.forEach((tile) => {
      let finalPolygons = []
      const validTileShapes = (tile.shape || []).filter(
        (polygon) =>
          Array.isArray(polygon) &&
          polygon.every(
            (ring) =>
              Array.isArray(ring) &&
              ring.every(
                (point) =>
                  Array.isArray(point) &&
                  point.length >= 2 &&
                  Number.isFinite(point[0]) &&
                  Number.isFinite(point[1]),
              ),
          ),
      )
      if (validTileShapes.length === 0) return

      const unioned = polygonClipping.union(...validTileShapes)
      finalPolygons = unioned.flat() // depends on shape

      finalPolygons.forEach((poly) => {
        ctx.beginPath()
        poly.forEach(([sx, sy], idx) => {
          if (!Number.isFinite(sx) || !Number.isFinite(sy)) return
          const px = cmToPx(sx)
          const py = cmToPx(sy)
          if (!Number.isFinite(px) || !Number.isFinite(py)) return
          if (idx === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
        ctx.closePath()
        ctx.stroke()
      })
    })

    // Draw selected row highlight
    if (selectedRowY != null) {
      const yPx = cmToPx(selectedRowY)
      ctx.save()
      ctx.globalAlpha = 0.18
      ctx.fillStyle = '#007bff'
      ctx.fillRect(0, yPx - 10, canvas.width, 20)
      ctx.restore()
    }

    // Draw selection rectangle (now in canvas coordinates, after pan/zoom)
    if (isSelecting && selectionStart && selectionEnd) {
      ctx.save()
      ctx.globalAlpha = 0.18
      ctx.fillStyle = '#28a745'
      ctx.fillRect(
        Math.min(selectionStart.x, selectionEnd.x),
        Math.min(selectionStart.y, selectionEnd.y),
        Math.abs(selectionEnd.x - selectionStart.x),
        Math.abs(selectionEnd.y - selectionStart.y),
      )
      ctx.restore()
    }

    ctx.restore()
  }, [
    userPolygon,
    tiles,
    pedestals,
    showSubTiles,
    unitSystem,
    cmToPx,
    zoom,
    panOffset,
    userPedestals,
    selectedRowY,
    selectionStart,
    selectionEnd,
    isSelecting,
    showRedPedestals,
  ])

  useEffect(() => {
    drawCanvas()
  }, [drawCanvas])

  // Add wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const wheelHandler = (e) => {
      e.preventDefault()
      const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9
      setZoom((prev) => prev * scaleFactor)
    }

    canvas.addEventListener('wheel', wheelHandler, { passive: false })

    return () => {
      canvas.removeEventListener('wheel', wheelHandler)
    }
  }, [setZoom])

  // --------------------------
  // Mouse Events for Pan/Zoom
  // --------------------------
  const handleMouseDown = (e) => {
    if (e.shiftKey) {
      // Selection mode
      const rect = canvasRef.current.getBoundingClientRect()
      const offsetX = e.clientX - rect.left
      const offsetY = e.clientY - rect.top
      const canvasX = (offsetX - panOffset.x) / zoom
      const canvasY = (offsetY - panOffset.y) / zoom
      if (onSelectionStart) onSelectionStart(canvasX, canvasY)
    } else {
      // Pan mode
      isPanningRef.current = true
      panStartRef.current = { x: e.clientX, y: e.clientY }
    }
  }

  const handleMouseMove = (e) => {
    if (isSelecting) {
      const rect = canvasRef.current.getBoundingClientRect()
      const offsetX = e.clientX - rect.left
      const offsetY = e.clientY - rect.top
      const canvasX = (offsetX - panOffset.x) / zoom
      const canvasY = (offsetY - panOffset.y) / zoom
      if (onSelectionMove) onSelectionMove(canvasX, canvasY)
    } else if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      panStartRef.current = { x: e.clientX, y: e.clientY }
      setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
    }
  }

  const handleMouseUp = (e) => {
    if (isSelecting) {
      const rect = canvasRef.current.getBoundingClientRect()
      const offsetX = e.clientX - rect.left
      const offsetY = e.clientY - rect.top
      const canvasX = (offsetX - panOffset.x) / zoom
      const canvasY = (offsetY - panOffset.y) / zoom
      if (onSelectionEnd) onSelectionEnd(canvasX, canvasY)
    }
    isPanningRef.current = false
  }

  // --------------------------
  // Detect clicks for pedestal editing
  // --------------------------
  const handleCanvasClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top

    // Convert from screen px to "canvas cm" coords
    const canvasX = (offsetX - panOffset.x) / zoom
    const canvasY = (offsetY - panOffset.y) / zoom
    onPedestalClick(canvasX, canvasY)
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        border: '0',
        borderRadius: '10px',
        display: 'block',
        cursor: isSelecting ? 'crosshair' : isPanningRef.current ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleCanvasClick}
    />
  )
}

export default TileCanvas

TileCanvas.propTypes = {
  userPolygon: PropTypes.array.isRequired,
  dimensionLabels: PropTypes.array,
  tiles: PropTypes.array.isRequired,
  pedestals: PropTypes.array.isRequired,
  showSubTiles: PropTypes.bool.isRequired,
  unitSystem: PropTypes.oneOf(['metric', 'imperial']).isRequired,
  cmToPx: PropTypes.func.isRequired,
  onPedestalClick: PropTypes.func.isRequired,
  zoom: PropTypes.number.isRequired,
  panOffset: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }).isRequired,
  setPanOffset: PropTypes.func.isRequired,
  setZoom: PropTypes.func.isRequired,
  userPedestals: PropTypes.array,
  edgePedestals: PropTypes.array,
  selectedRowY: PropTypes.number,
  isDraggingRow: PropTypes.bool,
  onRowDragStart: PropTypes.func,
  onRowDragMove: PropTypes.func,
  onRowDragEnd: PropTypes.func,
  selectionStart: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }),
  selectionEnd: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }),
  isSelecting: PropTypes.bool,
  onSelectionStart: PropTypes.func,
  onSelectionMove: PropTypes.func,
  onSelectionEnd: PropTypes.func,
  showRedPedestals: PropTypes.bool,
}
