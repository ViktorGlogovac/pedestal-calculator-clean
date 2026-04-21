import React from 'react'
import PropTypes from 'prop-types'

function CanvasArea(props) {
  const {
    shapes,
    setShapes,
    activeShapeIndex,
    gridSize,
    panOffset,
    setPanOffset,
    isSpaceDown,
    isPanning,
    setIsPanning,
    panStart,
    panInitialOffset,
    isDragging,
    setIsDragging,
    cursorPosition,
    setCursorPosition,
    clickedPointIndex,
    setClickedPointIndex,
    initialMouseDownPos,
    setInitialMouseDownPos,
    pushHistorySnapshot,
    historyIndex,
    CELL_PHYSICAL_LENGTH,
    LINE_WIDTH,
    POINT_RADIUS,
    unitSystem,
    setHeightPopupIndex,
    setPopupX,
    setPopupY,
    setTempHeight,
    setLinePopup,
    canvasRef,
    width,
    height,
    zoom,
    setZoom,
    drawingPaused = false,
    setDrawingPaused,
    onContextMenuOpen,
  } = props

  const activeShape = shapes[activeShapeIndex]

  const pointToSegmentDist = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1
    const dy = y2 - y1
    if (dx === 0 && dy === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    const cx = x1 + t * dx
    const cy = y1 + t * dy
    return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
  }

  const handleContextMenu = (e) => {
    e.preventDefault()
    if (!onContextMenuOpen) return

    const rect = e.currentTarget.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const rawX = (screenX - panOffset.x) / zoom
    const rawY = (screenY - panOffset.y) / zoom
    const shape = shapes[activeShapeIndex]

    if (shape) {
      for (let i = 0; i < shape.points.length; i += 1) {
        const point = shape.points[i]
        if (distance(point.x, point.y, rawX, rawY) < POINT_RADIUS * 2.2) {
          onContextMenuOpen({ type: 'vertex', pointIndex: i, screenX, screenY })
          return
        }
      }

      const segmentCount = shape.isLoopClosed ? shape.points.length : shape.points.length - 1
      for (let i = 0; i < segmentCount; i += 1) {
        const start = shape.points[i]
        const end = shape.points[(i + 1) % shape.points.length]
        if (pointToSegmentDist(rawX, rawY, start.x, start.y, end.x, end.y) < 8 / zoom) {
          onContextMenuOpen({
            type: 'edge',
            startIndex: i,
            endIndex: (i + 1) % shape.points.length,
            screenX,
            screenY,
          })
          return
        }
      }
    }

    onContextMenuOpen({ type: 'empty', screenX, screenY, rawX, rawY })
  }

  // Distance helpers
  const distance = (x1, y1, x2, y2) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
  const calculateLineLength = (start, end) => {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const rawDist = Math.sqrt(dx * dx + dy * dy)
    const steps = rawDist / gridSize
    return steps * CELL_PHYSICAL_LENGTH
  }

  // Mouse handlers
  const handleCanvasMouseDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (isSpaceDown) {
      setIsPanning(true)
      panStart.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      panInitialOffset.current = { ...panOffset }
      return
    }
    const rawX = (e.clientX - rect.left - panOffset.x) / zoom
    const rawY = (e.clientY - rect.top - panOffset.y) / zoom

    // Check if user clicked on a line label (popup to edit length)
    const shapePoints = activeShape.points
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return

    for (let i = 1; i < shapePoints.length; i++) {
      const { labelX, labelY } = midpointLabel(shapePoints[i - 1], shapePoints[i])
      const text = formatDistance(calculateLineLength(shapePoints[i - 1], shapePoints[i]))
      ctx.font = `${14 / zoom}px Arial`
      const textMetrics = ctx.measureText(text)
      const padding = 10 / zoom
      const rectWidth = textMetrics.width + padding * 2
      const rectHeight = 24 / zoom
      const rectX = labelX - rectWidth / 2
      const rectY = labelY - rectHeight / 2
      if (
        rawX >= rectX &&
        rawX <= rectX + rectWidth &&
        rawY >= rectY &&
        rawY <= rectY + rectHeight
      ) {
        props.setLinePopup({
          shapeIndex: activeShapeIndex,
          startIndex: i - 1,
          endIndex: i,
          popupX: panOffset.x + labelX * zoom,
          popupY: panOffset.y + labelY * zoom - 30,
          tempLength: text,
          isClosing: false,
        })
        return
      }
    }

    // Attempt to close shape if near first point
    let snappedX = Math.round(rawX / gridSize) * gridSize
    let snappedY = Math.round(rawY / gridSize) * gridSize
    if (activeShape.points.length > 0) {
      const lastPt = activeShape.points[activeShape.points.length - 1]
      const THRESHOLD = gridSize / 2
      if (Math.abs(snappedX - lastPt.x) < THRESHOLD) snappedX = lastPt.x
      if (Math.abs(snappedY - lastPt.y) < THRESHOLD) snappedY = lastPt.y
    }
    if (
      !activeShape.isLoopClosed &&
      activeShape.points.length > 2 &&
      distance(snappedX, snappedY, activeShape.points[0].x, activeShape.points[0].y) <
        POINT_RADIUS * 2
    ) {
      const updatedShapes = [...shapes]
      updatedShapes[activeShapeIndex].isLoopClosed = true
      setShapes(updatedShapes)
      pushHistorySnapshot({ shapes: updatedShapes, gridSize, panOffset, activeShapeIndex })
      return
    }

    // Check for clicking an existing point
    for (let i = 0; i < activeShape.points.length; i++) {
      if (
        distance(activeShape.points[i].x, activeShape.points[i].y, rawX, rawY) <
        POINT_RADIUS * 2
      ) {
        setClickedPointIndex(i)
        setInitialMouseDownPos({ x: rawX, y: rawY })
        return
      }
    }

    // Otherwise, add new point
    if (!activeShape.isLoopClosed) {
      if (drawingPaused) setDrawingPaused?.(false)
      const newShapes = [...shapes]
      newShapes[activeShapeIndex].points = [
        ...newShapes[activeShapeIndex].points,
        { x: snappedX, y: snappedY },
      ]
      setShapes(newShapes)
      pushHistorySnapshot({ shapes: newShapes, gridSize, panOffset, activeShapeIndex })
    }
  }

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (isPanning) {
      const current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const dx = current.x - panStart.current.x
      const dy = current.y - panStart.current.y
      setPanOffset({
        x: panInitialOffset.current.x + dx,
        y: panInitialOffset.current.y + dy,
      })
      return
    }
    const worldX = (e.clientX - rect.left - panOffset.x) / zoom
    const worldY = (e.clientY - rect.top - panOffset.y) / zoom
    let gridX = Math.round(worldX / gridSize) * gridSize
    let gridY = Math.round(worldY / gridSize) * gridSize
    if (activeShape.points.length > 0) {
      const lastPt = activeShape.points[activeShape.points.length - 1]
      const THRESHOLD = gridSize / 2
      if (Math.abs(gridX - lastPt.x) < THRESHOLD) gridX = lastPt.x
      if (Math.abs(gridY - lastPt.y) < THRESHOLD) gridY = lastPt.y
    }

    if (drawingPaused && clickedPointIndex === null && !isDragging) return

    setCursorPosition({ x: gridX, y: gridY })

    if (clickedPointIndex !== null && initialMouseDownPos) {
      // If the mouse has moved more than 5 px from mousedown, consider it a drag
      if (distance(initialMouseDownPos.x, initialMouseDownPos.y, gridX, gridY) > 5) {
        setIsDragging(true)
      }
    }
    if (isDragging && clickedPointIndex !== null) {
      const newShapes = [...shapes]
      newShapes[activeShapeIndex].points[clickedPointIndex] = {
        ...newShapes[activeShapeIndex].points[clickedPointIndex],
        x: gridX,
        y: gridY,
      }
      setShapes(newShapes)
    }
  }

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false)
      pushHistorySnapshot({ shapes, gridSize, panOffset, activeShapeIndex })
    }
    if (isDragging) {
      pushHistorySnapshot({ shapes, gridSize, panOffset, activeShapeIndex })
      setIsDragging(false)
    }
    if (!isDragging && clickedPointIndex !== null) {
      const shape = shapes[activeShapeIndex]
      if (clickedPointIndex === 0 && !shape.isLoopClosed && shape.points.length > 2) {
        setClickedPointIndex(null)
        setInitialMouseDownPos(null)
        return
      }

      const point = shape.points[clickedPointIndex]
      setHeightPopupIndex(clickedPointIndex)
      setPopupX(panOffset.x + point.x * zoom + 12)
      setPopupY(panOffset.y + point.y * zoom - 28)
      const displayHeight =
        unitSystem === 'imperial' && point.height
          ? (point.height / 2.54).toFixed(2)
          : point.height || ''
      setTempHeight(displayHeight)
    }
    setClickedPointIndex(null)
    setInitialMouseDownPos(null)
  }

  // Redraw canvas on every relevant change
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    drawEverything(ctx)
    // eslint-disable-next-line
  }, [
    shapes,
    panOffset,
    cursorPosition,
    unitSystem,
    gridSize,
    activeShapeIndex,
    zoom,
    drawingPaused,
  ])

  // Add wheel event listener with passive: false to allow preventDefault
  React.useEffect(() => {
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
  }, [zoom, panOffset, setPanOffset, setZoom])

  const drawEverything = (ctx) => {
    ctx.clearRect(0, 0, width, height)
    ctx.save()

    // Apply pan and zoom transformations
    ctx.translate(panOffset.x, panOffset.y)
    ctx.scale(zoom, zoom)

    // Draw the grid
    drawGrid(ctx)

    ctx.lineWidth = LINE_WIDTH / zoom // Scale line width with zoom
    ctx.setLineDash([])

    // Draw non-active shapes first
    shapes.forEach((shape, index) => {
      if (index !== activeShapeIndex) drawShape(ctx, shape)
    })
    // Then draw active shape
    drawShape(ctx, activeShape)

    // If active shape not closed, show a dashed preview line
    if (
      !activeShape.isLoopClosed &&
      activeShape.points.length > 0 &&
      !drawingPaused &&
      !isDragging &&
      cursorPosition
    ) {
      ctx.strokeStyle = '#3a3a38'
      ctx.setLineDash([6 / zoom, 3 / zoom]) // Scale dash pattern with zoom

      const lastPt = activeShape.points[activeShape.points.length - 1]

      // dashed preview line
      ctx.beginPath()
      ctx.moveTo(lastPt.x, lastPt.y)
      ctx.lineTo(cursorPosition.x, cursorPosition.y)
      ctx.stroke()

      const lengthInCm = calculateLineLength(lastPt, cursorPosition)
      const { labelX, labelY } = midpointLabel(lastPt, cursorPosition)
      const text = formatDistance(lengthInCm)
      drawLengthLabel(ctx, text, labelX, labelY - 26 / zoom) // Scale offset with zoom

      ctx.setLineDash([])
    }

    ctx.restore()
  }

  const drawGrid = (ctx) => {
    ctx.save()
    ctx.strokeStyle = '#e5e3dd'
    ctx.lineWidth = 1 / zoom // Scale grid lines with zoom

    // Calculate grid bounds based on viewport
    const startX = Math.floor(-panOffset.x / (gridSize * zoom)) * gridSize
    const startY = Math.floor(-panOffset.y / (gridSize * zoom)) * gridSize
    const endX = Math.ceil((width - panOffset.x) / (gridSize * zoom)) * gridSize
    const endY = Math.ceil((height - panOffset.y) / (gridSize * zoom)) * gridSize

    // Draw vertical lines
    for (let x = startX; x <= endX; x += gridSize) {
      ctx.beginPath()
      ctx.moveTo(x, startY)
      ctx.lineTo(x, endY)
      ctx.stroke()
    }

    // Draw horizontal lines
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.beginPath()
      ctx.moveTo(startX, y)
      ctx.lineTo(endX, y)
      ctx.stroke()
    }

    ctx.restore()
  }

  // Draw single shape with point circles & line length overlays
  const drawShape = (ctx, shape) => {
    if (!shape || shape.points.length === 0) return

    const strokeColor = shape.type === 'sub' ? '#dc2626' : '#1d4ed8'
    const fillColor = shape.type === 'sub' ? 'rgba(220, 38, 38, 0.08)' : 'rgba(29, 78, 216, 0.08)'

    if (shape.isLoopClosed && shape.points.length > 2) {
      ctx.save()
      ctx.fillStyle = fillColor
      ctx.beginPath()
      ctx.moveTo(shape.points[0].x, shape.points[0].y)
      for (let i = 1; i < shape.points.length; i += 1) {
        ctx.lineTo(shape.points[i].x, shape.points[i].y)
      }
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    shape.points.forEach((pt, i) => {
      // segment lines
      if (i > 0) {
        ctx.strokeStyle = strokeColor
        ctx.beginPath()
        ctx.moveTo(shape.points[i - 1].x, shape.points[i - 1].y)
        ctx.lineTo(pt.x, pt.y)
        ctx.stroke()

        // line length
        const lengthInCm = calculateLineLength(shape.points[i - 1], pt)
        const { labelX, labelY } = midpointLabel(shape.points[i - 1], pt)
        const text = formatDistance(lengthInCm)
        drawLengthLabel(ctx, text, labelX, labelY)
      }
      // point circle
      ctx.fillStyle = '#111110'
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, POINT_RADIUS, 0, 2 * Math.PI)
      ctx.fill()
    })

    // If shape is closed
    if (shape.isLoopClosed && shape.points.length > 1) {
      ctx.strokeStyle = strokeColor
      ctx.beginPath()
      const last = shape.points[shape.points.length - 1]
      ctx.moveTo(last.x, last.y)
      ctx.lineTo(shape.points[0].x, shape.points[0].y)
      ctx.stroke()

      const lengthInCm = calculateLineLength(last, shape.points[0])
      const { labelX, labelY } = midpointLabel(last, shape.points[0])
      const text = formatDistance(lengthInCm)
      drawLengthLabel(ctx, text, labelX, labelY)
    }
  }

  // Draw length label with a small rounded rect behind it
  const drawLengthLabel = (ctx, text, labelX, labelY) => {
    ctx.save()
    ctx.font = `${14 / zoom}px Arial` // Scale font size with zoom
    const textMetrics = ctx.measureText(text)
    const padding = 10 / zoom // Scale padding with zoom
    const rectWidth = textMetrics.width + padding * 2
    const rectHeight = 24 / zoom // Scale height with zoom
    const rectX = labelX - rectWidth / 2
    const rectY = labelY - rectHeight / 2

    // background
    ctx.fillStyle = '#ffffff'
    drawRoundedRect(ctx, rectX, rectY, rectWidth, rectHeight, 6 / zoom) // Scale corner radius with zoom

    ctx.strokeStyle = '#d9d8d2'
    ctx.stroke()

    // text
    ctx.fillStyle = '#111110'
    const textX = labelX - textMetrics.width / 2
    const textY = labelY + 5 / zoom // Scale text offset with zoom
    ctx.fillText(text, textX, textY)
    ctx.restore()
  }

  const drawRoundedRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
    ctx.fill()
  }

  // For line label placement
  const midpointLabel = (p1, p2) => ({
    labelX: (p1.x + p2.x) / 2,
    labelY: (p1.y + p2.y) / 2,
  })

  // Helper: distance label in correct units
  const formatDistance = (distanceCm) => {
    if (unitSystem === 'imperial') {
      const distanceInFeet = distanceCm / 30.48
      return `${distanceInFeet.toFixed(2)} ft`
    } else {
      const distanceInMeters = distanceCm / 100
      return `${distanceInMeters.toFixed(2)} m`
    }
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        border: '0',
        backgroundColor: '#faf9f6',
        borderRadius: '10px',
        cursor: isSpaceDown ? 'grab' : drawingPaused ? 'default' : 'crosshair',
        display: 'block',
      }}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
      onMouseLeave={() => {
        setIsDragging(false)
        setClickedPointIndex(null)
        setInitialMouseDownPos(null)
        if (isPanning) {
          setIsPanning(false)
          pushHistorySnapshot({ shapes, gridSize, panOffset, activeShapeIndex })
        }
      }}
    />
  )
}

CanvasArea.propTypes = {
  shapes: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      points: PropTypes.arrayOf(
        PropTypes.shape({
          x: PropTypes.number.isRequired,
          y: PropTypes.number.isRequired,
          height: PropTypes.number,
        }),
      ).isRequired,
      isLoopClosed: PropTypes.bool.isRequired,
      type: PropTypes.oneOf(['add', 'sub']).isRequired,
    }),
  ).isRequired,
  setShapes: PropTypes.func.isRequired,
  activeShapeIndex: PropTypes.number.isRequired,
  gridSize: PropTypes.number.isRequired,
  panOffset: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }).isRequired,
  setPanOffset: PropTypes.func.isRequired,
  isSpaceDown: PropTypes.bool.isRequired,
  isPanning: PropTypes.bool.isRequired,
  setIsPanning: PropTypes.func.isRequired,
  panStart: PropTypes.object.isRequired,
  panInitialOffset: PropTypes.object.isRequired,
  isDragging: PropTypes.bool.isRequired,
  setIsDragging: PropTypes.func.isRequired,
  cursorPosition: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }),
  setCursorPosition: PropTypes.func.isRequired,
  clickedPointIndex: PropTypes.number,
  setClickedPointIndex: PropTypes.func.isRequired,
  initialMouseDownPos: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }),
  setInitialMouseDownPos: PropTypes.func.isRequired,
  onGridSizeChange: PropTypes.func,
  pushHistorySnapshot: PropTypes.func.isRequired,
  historyIndex: PropTypes.number.isRequired,
  CELL_PHYSICAL_LENGTH: PropTypes.number.isRequired,
  LINE_WIDTH: PropTypes.number.isRequired,
  POINT_RADIUS: PropTypes.number.isRequired,
  unitSystem: PropTypes.oneOf(['metric', 'imperial']).isRequired,
  setHeightPopupIndex: PropTypes.func.isRequired,
  setPopupX: PropTypes.func.isRequired,
  setPopupY: PropTypes.func.isRequired,
  setTempHeight: PropTypes.func.isRequired,
  setLinePopup: PropTypes.func.isRequired,
  canvasRef: PropTypes.object.isRequired,
  width: PropTypes.number.isRequired,
  height: PropTypes.number.isRequired,
  zoom: PropTypes.number.isRequired,
  setZoom: PropTypes.func.isRequired,
  drawingPaused: PropTypes.bool,
  setDrawingPaused: PropTypes.func,
  onContextMenuOpen: PropTypes.func,
}

export default CanvasArea
