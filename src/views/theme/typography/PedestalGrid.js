import React, { useRef, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import CanvasArea from '../../components/PedestalCalculator/CanvasArea'
import SidePanel from '../../components/PedestalCalculator/SidePanel'
import HeightPopup from '../../components/PedestalCalculator/HeightPopup'
import LinePopup from '../../components/PedestalCalculator/LinePopup'

const CANVAS_WIDTH = 900
const CANVAS_HEIGHT = 600

const CELL_PHYSICAL_LENGTH = 100 // each grid cell = 100 cm
const LINE_WIDTH = 2
const POINT_RADIUS = 5

const PedestalGrid = ({
  onPointsChange,
  onGridSizeChange,
  unitSystem,
  onUnitSystemChange,
  onShowInstructions,
  zoom,
  setZoom,
  panOffset,
  setPanOffset,
}) => {
  // Load initial state from localStorage or use defaults
  const [shapes, setShapes] = useState(() => {
    const savedShapes = localStorage.getItem('pedestalGrid_shapes')
    return savedShapes
      ? JSON.parse(savedShapes)
      : [{ name: 'region1', points: [], isLoopClosed: false, type: 'add' }]
  })
  const [activeShapeIndex, setActiveShapeIndex] = useState(() => {
    const savedIndex = localStorage.getItem('pedestalGrid_activeShapeIndex')
    return savedIndex ? parseInt(savedIndex) : 0
  })
  const [gridSize, setGridSize] = useState(() => {
    const savedGridSize = localStorage.getItem('pedestalGrid_gridSize')
    return savedGridSize ? parseInt(savedGridSize) : 35
  })
  // Zoom and pan are now passed as props from parent component

  // Save state to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('pedestalGrid_shapes', JSON.stringify(shapes))
    // Save all pedestal heights separately
    const allHeights = []
    shapes.forEach((shape, shapeIndex) => {
      shape.points.forEach((pt, pointIndex) => {
        if (typeof pt.height !== 'undefined') {
          allHeights.push({ shapeIndex, pointIndex, height: pt.height })
        }
      })
    })
    localStorage.setItem('pedestalGrid_heights', JSON.stringify(allHeights))
  }, [shapes])

  useEffect(() => {
    localStorage.setItem('pedestalGrid_activeShapeIndex', activeShapeIndex.toString())
  }, [activeShapeIndex])

  useEffect(() => {
    localStorage.setItem('pedestalGrid_gridSize', gridSize.toString())
  }, [gridSize])

  // Zoom and panOffset are now managed by parent component, no need to save to localStorage

  // For hooking into onPointsChange
  useEffect(() => {
    onPointsChange?.(shapes)
  }, [shapes, onPointsChange])

  // Popup states (height, line-length)
  const [heightPopupIndex, setHeightPopupIndex] = useState(null)
  const [popupX, setPopupX] = useState(0)
  const [popupY, setPopupY] = useState(0)
  const [tempHeight, setTempHeight] = useState('')
  const [linePopup, setLinePopup] = useState(null)

  // History states
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  // Point-level undo/redo for individual lines
  const [pointHistory, setPointHistory] = useState([]) // Array of { shapeIndex, point, action: 'add' | 'remove' }
  const [pointHistoryIndex, setPointHistoryIndex] = useState(0)

  // A few other states controlling shape editing
  const [isDragging, setIsDragging] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(null)
  const [isPanning, setIsPanning] = useState(false)
  const [isSpaceDown, setIsSpaceDown] = useState(false)
  const panStart = useRef({ x: 0, y: 0 })
  const panInitialOffset = useRef({ x: 0, y: 0 })
  const [clickedPointIndex, setClickedPointIndex] = useState(null)
  const [initialMouseDownPos, setInitialMouseDownPos] = useState(null)
  const [drawingPaused, setDrawingPaused] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)

  // State for inline renaming shapes
  const [activeEditIndex, setActiveEditIndex] = useState(null)
  // Counter for new shape naming
  const [nextShapeNumber, setNextShapeNumber] = useState(2)
  // Brief highlight after creating a new shape
  const [highlightNewShape, setHighlightNewShape] = useState(false)

  // Canvas ref and dynamic sizing
  const canvasRef = useRef(null)
  const canvasContainerRef = useRef(null)
  const [canvasSize, setCanvasSize] = useState({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT })

  // Resize canvas to fill container
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

  // Convenience
  const activeShape = shapes[activeShapeIndex]

  const calculateLineLength = React.useCallback(
    (start, end) => {
      const dx = end.x - start.x
      const dy = end.y - start.y
      const rawDistance = Math.sqrt(dx * dx + dy * dy)
      return (rawDistance / gridSize) * CELL_PHYSICAL_LENGTH
    },
    [gridSize],
  )

  const formatDistance = React.useCallback(
    (distanceCm) => {
      if (unitSystem === 'imperial') return `${(distanceCm / 30.48).toFixed(2)} ft`
      return `${(distanceCm / 100).toFixed(2)} m`
    },
    [unitSystem],
  )

  //------------------------------------------------------------------
  //  History management
  //------------------------------------------------------------------
  const pushHistorySnapshot = React.useCallback(
    (snapshot) => {
      /* Trim any "redo" states, then append the new snapshot */
      setHistory((prev) => {
        const trimmed = prev.slice(0, historyIndex + 1)
        const newHistory = [...trimmed, snapshot]
        /* update index to the end of the array */
        setHistoryIndex(newHistory.length - 1)
        return newHistory
      })
    },
    [historyIndex],
  )

  const handleUndo = React.useCallback(() => {
    if (historyIndex <= 0) return
    const prevSnapshot = history[historyIndex - 1]
    setShapes(prevSnapshot.shapes)
    setGridSize(prevSnapshot.gridSize)
    setPanOffset(prevSnapshot.panOffset)
    setActiveShapeIndex(prevSnapshot.activeShapeIndex)
    setHistoryIndex(historyIndex - 1)
  }, [history, historyIndex, setShapes, setGridSize, setPanOffset, setActiveShapeIndex])

  const handleRedo = React.useCallback(() => {
    if (historyIndex >= history.length - 1) return
    const newIndex = historyIndex + 1
    const snapshot = history[newIndex]
    setShapes(snapshot.shapes)
    setGridSize(snapshot.gridSize)
    setPanOffset(snapshot.panOffset)
    setActiveShapeIndex(snapshot.activeShapeIndex)
    setHistoryIndex(newIndex)
  }, [history, historyIndex, setShapes, setGridSize, setPanOffset, setActiveShapeIndex])

  // Point-level undo: remove the last point (line) from the active shape
  const handlePointUndo = React.useCallback(() => {
    const activeShape = shapes[activeShapeIndex]
    if (!activeShape || activeShape.points.length === 0) {
      handleUndo()
      return
    }

    const lastPoint = activeShape.points[activeShape.points.length - 1]
    const wasLoopClosed = activeShape.isLoopClosed

    const newShapes = shapes.map((shape, index) => {
      if (index !== activeShapeIndex) return shape
      return {
        ...shape,
        points: shape.points.slice(0, -1),
        isLoopClosed: false,
      }
    })

    // Add to point history for redo
    // pointHistoryIndex tracks how many items we can redo
    // When we undo, we add the point and increment the index
    setPointHistory((prev) => {
      // Trim any future redo items if we're not at the end
      const trimmed = prev.slice(0, pointHistoryIndex)
      return [...trimmed, { shapeIndex: activeShapeIndex, point: lastPoint, wasLoopClosed }]
    })
    setPointHistoryIndex((prev) => prev + 1)

    setShapes(newShapes)
    // Also update the main history for consistency
    pushHistorySnapshot({ shapes: newShapes, gridSize, panOffset, activeShapeIndex })
  }, [
    shapes,
    activeShapeIndex,
    pointHistoryIndex,
    setShapes,
    pushHistorySnapshot,
    gridSize,
    panOffset,
    handleUndo,
  ])

  // Point-level redo: restore the last removed point
  const handlePointRedo = React.useCallback(() => {
    // pointHistoryIndex represents how many items can be redone
    // The most recently undone point is always at the end of pointHistory
    // We can redo if pointHistoryIndex > 0 (meaning we have undone items)
    if (pointHistoryIndex <= 0 || pointHistory.length === 0) {
      return
    }

    // Get the most recently undone point.
    const operation = pointHistory[pointHistoryIndex - 1]
    if (!operation) return

    const newShapes = shapes.map((shape, index) => {
      if (index !== operation.shapeIndex) return shape
      const nextPoints = [...shape.points, operation.point]
      return {
        ...shape,
        points: nextPoints,
        isLoopClosed: operation.wasLoopClosed && nextPoints.length >= 3,
      }
    })

    // Decrement the redo stack cursor.
    setPointHistoryIndex((prev) => prev - 1)

    setShapes(newShapes)
    // Also update the main history for consistency
    pushHistorySnapshot({ shapes: newShapes, gridSize, panOffset, activeShapeIndex })
  }, [
    pointHistory,
    pointHistoryIndex,
    shapes,
    setShapes,
    pushHistorySnapshot,
    gridSize,
    panOffset,
    activeShapeIndex,
  ])

  // Push initial snapshot on mount
  useEffect(() => {
    pushHistorySnapshot({ shapes, gridSize, panOffset, activeShapeIndex })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track when new points are added (to clear redo history)
  const prevPointsLengthRef = useRef({})
  const isRedoingRef = useRef(false)

  useEffect(() => {
    // Skip tracking if we're in the middle of a redo operation
    if (isRedoingRef.current) {
      isRedoingRef.current = false
      return
    }

    shapes.forEach((shape, shapeIndex) => {
      const prevLength = prevPointsLengthRef.current[shapeIndex] || 0
      const currentLength = shape.points.length

      // If a new point was added naturally (not from redo), clear redo history
      if (currentLength > prevLength && !shape.isLoopClosed) {
        // When a new point is added after undoing, we should clear all redo history
        // pointHistoryIndex tells us how many items are in the redo stack
        // If it's greater than 0, we have undone items that should be cleared
        if (pointHistoryIndex > 0) {
          // Clear all redo history when a new point is added
          setPointHistory([])
          setPointHistoryIndex(0)
        }
      }

      prevPointsLengthRef.current[shapeIndex] = currentLength
    })
  }, [shapes, pointHistoryIndex])

  // Update handlePointRedo to set the flag
  const handlePointRedoWithFlag = React.useCallback(() => {
    isRedoingRef.current = true
    handlePointRedo()
  }, [handlePointRedo])

  //------------------------------------------------------------------
  //  Popups
  //------------------------------------------------------------------
  const handleHeightSave = () => {
    const newShapes = [...shapes]
    const pt = newShapes[activeShapeIndex].points[heightPopupIndex]
    newShapes[activeShapeIndex].points[heightPopupIndex] = {
      ...pt,
      height: unitSystem === 'imperial' ? parseFloat(tempHeight) * 2.54 : parseFloat(tempHeight),
    }
    setShapes(newShapes)
    pushHistorySnapshot({ shapes: newShapes, gridSize, panOffset, activeShapeIndex })
    setHeightPopupIndex(null)
  }

  const handleHeightCancel = () => {
    setHeightPopupIndex(null)
  }

  const handleDeleteCorner = () => {
    const newShapes = [...shapes]
    newShapes[activeShapeIndex].points = newShapes[activeShapeIndex].points.filter(
      (_, i) => i !== heightPopupIndex,
    )
    if (newShapes[activeShapeIndex].points.length < 3) {
      newShapes[activeShapeIndex].isLoopClosed = false
    }
    setShapes(newShapes)
    pushHistorySnapshot({ shapes: newShapes, gridSize, panOffset, activeShapeIndex })
    setHeightPopupIndex(null)
  }

  const handleLinePopupSave = () => {
    const inputValue = parseFloat(linePopup.tempLength)
    if (isNaN(inputValue) || inputValue <= 0) {
      alert('Please enter a valid positive number for length.')
      return
    }
    // Convert popup value to cm or m
    const desiredLengthCm = unitSystem === 'imperial' ? inputValue * 30.48 : inputValue * 100
    const desiredPixelLength = (desiredLengthCm / CELL_PHYSICAL_LENGTH) * gridSize

    const shapeIdx = linePopup.shapeIndex
    const p1 = shapes[shapeIdx].points[linePopup.startIndex]
    const p2 = shapes[shapeIdx].points[linePopup.endIndex]
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const currentPixelLength = Math.sqrt(dx * dx + dy * dy)
    if (currentPixelLength === 0) return

    const factor = desiredPixelLength / currentPixelLength
    const newDx = dx * factor
    const newDy = dy * factor
    const newP2 = { ...p2, x: p1.x + newDx, y: p1.y + newDy }

    const newShapes = [...shapes]
    newShapes[shapeIdx].points[linePopup.endIndex] = newP2
    setShapes(newShapes)
    pushHistorySnapshot({ shapes: newShapes, gridSize, panOffset, activeShapeIndex })
    setLinePopup(null)
  }

  const handleLinePopupCancel = () => {
    setLinePopup(null)
  }

  const handleLinePopupDelete = () => {
    const shapeIdx = linePopup.shapeIndex
    const newShapes = [...shapes]

    // Remove the end point of the line (which will remove the line segment)
    newShapes[shapeIdx].points = newShapes[shapeIdx].points.filter(
      (_, i) => i !== linePopup.endIndex,
    )

    // If we removed too many points, close the shape
    if (newShapes[shapeIdx].points.length < 3) {
      newShapes[shapeIdx].isLoopClosed = false
    }

    setShapes(newShapes)
    pushHistorySnapshot({ shapes: newShapes, gridSize, panOffset, activeShapeIndex })
    setLinePopup(null)
  }

  //------------------------------------------------------------------
  //  Canvas context menu actions
  //------------------------------------------------------------------
  const removePointFromShape = (shapeIndex, pointIndex) => {
    const newShapes = shapes.map((shape, index) => {
      if (index !== shapeIndex) return shape
      const nextPoints = shape.points.filter((_, i) => i !== pointIndex)
      return {
        ...shape,
        points: nextPoints,
        isLoopClosed: nextPoints.length >= 3 ? shape.isLoopClosed : false,
      }
    })

    setShapes(newShapes)
    pushHistorySnapshot({ shapes: newShapes, gridSize, panOffset, activeShapeIndex })
    setHeightPopupIndex(null)
    setLinePopup(null)
    setContextMenu(null)
  }

  const handleContextMenuOpen = (menu) => {
    setContextMenu(menu)
    setHeightPopupIndex(null)
    setLinePopup(null)
  }

  const handleContextSetHeight = () => {
    if (!contextMenu || contextMenu.type !== 'vertex') return
    const point = shapes[activeShapeIndex]?.points[contextMenu.pointIndex]
    if (!point) return

    setHeightPopupIndex(contextMenu.pointIndex)
    setPopupX(contextMenu.screenX + 12)
    setPopupY(contextMenu.screenY - 28)
    const displayHeight =
      unitSystem === 'imperial' && point.height
        ? (point.height / 2.54).toFixed(2)
        : point.height || ''
    setTempHeight(displayHeight)
    setContextMenu(null)
  }

  const handleContextDeleteVertex = () => {
    if (!contextMenu || contextMenu.type !== 'vertex') return
    removePointFromShape(activeShapeIndex, contextMenu.pointIndex)
  }

  const handleContextEditLength = () => {
    if (!contextMenu || contextMenu.type !== 'edge') return
    const shape = shapes[activeShapeIndex]
    const start = shape?.points[contextMenu.startIndex]
    const end = shape?.points[contextMenu.endIndex]
    if (!start || !end) return

    setLinePopup({
      shapeIndex: activeShapeIndex,
      startIndex: contextMenu.startIndex,
      endIndex: contextMenu.endIndex,
      popupX: contextMenu.screenX,
      popupY: Math.max(8, contextMenu.screenY - 30),
      tempLength: formatDistance(calculateLineLength(start, end)),
      isClosing: false,
    })
    setContextMenu(null)
  }

  const handleContextDeleteEdge = () => {
    if (!contextMenu || contextMenu.type !== 'edge') return
    removePointFromShape(activeShapeIndex, contextMenu.endIndex)
  }

  const handlePauseDrawing = () => {
    setDrawingPaused(true)
    setCursorPosition(null)
    setContextMenu(null)
  }

  const handleResumeDrawing = () => {
    setDrawingPaused(false)
    setContextMenu(null)
  }

  //------------------------------------------------------------------
  //  Side panel actions
  //------------------------------------------------------------------
  const handleZoomIn = () => {
    setZoom((prev) => prev * 1.1)
  }

  const handleZoomOut = () => {
    setZoom((prev) => prev * 0.9)
  }

  const handleNewShape = () => {
    const newShape = {
      name: `region${nextShapeNumber}`,
      points: [],
      isLoopClosed: false,
      type: 'add',
    }
    const newShapes = [...shapes, newShape]
    setShapes(newShapes)
    setActiveShapeIndex(newShapes.length - 1)
    setNextShapeNumber(nextShapeNumber + 1)
    setDrawingPaused(false)
    setContextMenu(null)
    // highlight new shape briefly
    setHighlightNewShape(true)
    setTimeout(() => setHighlightNewShape(false), 1000)
    pushHistorySnapshot({
      shapes: newShapes,
      gridSize,
      panOffset,
      activeShapeIndex: newShapes.length - 1,
    })
  }

  const handleRenameShape = (index, newName) => {
    const newShapes = [...shapes]
    newShapes[index].name = newName
    setShapes(newShapes)
    pushHistorySnapshot({ shapes: newShapes, gridSize, panOffset, activeShapeIndex })
  }

  const handleDeleteShape = (index) => {
    let newShapes = shapes.filter((_, i) => i !== index)
    let newActiveShapeIndex = activeShapeIndex

    // If we deleted the last shape, create a new empty one
    if (newShapes.length === 0) {
      newShapes = [
        {
          name: `region${nextShapeNumber}`,
          points: [],
          isLoopClosed: false,
          type: 'add',
        },
      ]
      newActiveShapeIndex = 0
      setNextShapeNumber(nextShapeNumber + 1)
    } else if (index === activeShapeIndex) {
      newActiveShapeIndex = 0
    } else if (index < activeShapeIndex) {
      newActiveShapeIndex = activeShapeIndex - 1
    }

    // Clear all related localStorage data when a shape is deleted
    try {
      // Clear pedestal heights
      localStorage.removeItem('pedestalGrid_heights')
      // Clear points data (used by Typography.js)
      localStorage.removeItem('pedestal_points')
      // Clear adjusted pedestals
      localStorage.removeItem('pedestal_adjustedPedestals')
      localStorage.removeItem('pedestalHeightAdjuster_adjustedPedestals')
      // Clear tile layout data
      localStorage.removeItem('tileLayout_selectedTileType')
      localStorage.removeItem('tileLayout_isOffset')
      localStorage.removeItem('tileLayout_orientation')
      // Clear tile grid data
      localStorage.removeItem('tileGrid_selectedTileType')
      localStorage.removeItem('tileGrid_isOffset')
      localStorage.removeItem('tileGrid_orientation')
      localStorage.removeItem('tileGrid_adjustedPedestals')
    } catch (error) {
      console.warn('Failed to clear related localStorage data:', error)
    }

    setShapes(newShapes)
    setActiveShapeIndex(newActiveShapeIndex)
    setContextMenu(null)
    pushHistorySnapshot({
      shapes: newShapes,
      gridSize,
      panOffset,
      activeShapeIndex: newActiveShapeIndex,
    })
  }

  // Toggle the shape type (add / sub) - you can re-enable as desired
  const toggleActiveShapeType = () => {
    const newShapes = [...shapes]
    newShapes[activeShapeIndex].type = newShapes[activeShapeIndex].type === 'add' ? 'sub' : 'add'
    setShapes(newShapes)
    pushHistorySnapshot({ shapes: newShapes, gridSize, panOffset, activeShapeIndex })
  }

  // Key handlers for panning and undo/redo
  useEffect(() => {
    const handleKeyDown = (e) => {
      const target = e.target

      if (e.key === 'Escape') {
        if (target instanceof HTMLElement && target.closest('.pc-ai-modal')) return
        e.preventDefault()
        setContextMenu(null)

        if (linePopup) {
          setLinePopup(null)
          return
        }
        if (heightPopupIndex !== null) {
          setHeightPopupIndex(null)
          return
        }
        if (activeEditIndex !== null) {
          setActiveEditIndex(null)
          return
        }
        if (isDragging || clickedPointIndex !== null) {
          setIsDragging(false)
          setClickedPointIndex(null)
          setInitialMouseDownPos(null)
          return
        }
        const shape = shapes[activeShapeIndex]
        if (shape && !shape.isLoopClosed && shape.points.length > 0 && !drawingPaused) {
          setDrawingPaused(true)
          setCursorPosition(null)
        }
        return
      }

      // Don't interfere with input fields
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return
      }

      // Handle Space for panning
      if (e.code === 'Space') {
        e.preventDefault()
        setIsSpaceDown(true)
        return
      }

      // Handle Ctrl+Z (or Cmd+Z on Mac) for point-level undo
      // Check both e.key and e.code for better compatibility
      const isZKey = e.key.toLowerCase() === 'z' || e.code === 'KeyZ'
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && isZKey
      if (isUndo) {
        e.preventDefault()
        e.stopPropagation()
        handlePointUndo()
        return false
      }

      // Handle Ctrl+Shift+Z (or Cmd+Shift+Z on Mac) for point-level redo
      const isYKey = e.key.toLowerCase() === 'y' || e.code === 'KeyY'
      const isRedo =
        (e.ctrlKey || e.metaKey) && !e.altKey && ((e.shiftKey && isZKey) || (!e.shiftKey && isYKey))
      if (isRedo) {
        e.preventDefault()
        e.stopPropagation()
        handlePointRedoWithFlag()
        return false
      }
    }
    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        setIsSpaceDown(false)
      }
    }
    // Use capture phase to catch shortcuts before browser-level canvas interactions.
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [
    activeEditIndex,
    activeShapeIndex,
    clickedPointIndex,
    drawingPaused,
    handlePointRedoWithFlag,
    handlePointUndo,
    heightPopupIndex,
    isDragging,
    linePopup,
    shapes,
  ])

  //------------------------------------------------------------------
  //  Render
  //------------------------------------------------------------------
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: '14px', flex: 1, minHeight: 0 }}>
      {/* Canvas area */}
      <div
        ref={canvasContainerRef}
        className="pc-panel"
        onMouseDown={() => setContextMenu(null)}
        style={{
          position: 'relative',
          flex: '1 1 0',
          minWidth: 0,
          overflow: 'hidden',
          background: 'var(--pc-canvas-bg)',
        }}
      >
        <CanvasArea
          {...{
            shapes,
            setShapes,
            activeShapeIndex,
            setActiveShapeIndex,
            gridSize,
            setGridSize,
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
            onGridSizeChange,
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
            zoom,
            setZoom,
            drawingPaused,
            setDrawingPaused,
            onContextMenuOpen: handleContextMenuOpen,
          }}
          canvasRef={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
        />

        {drawingPaused && activeShape?.points.length > 0 && !activeShape?.isLoopClosed && (
          <div
            style={{
              position: 'absolute',
              left: 14,
              top: 14,
              zIndex: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              borderRadius: 999,
              border: '1px solid var(--pc-line)',
              background: 'var(--pc-surface)',
              boxShadow: 'var(--pc-shadow-1)',
              color: 'var(--pc-ink-3)',
              fontSize: 12,
            }}
          >
            Drawing paused
            <button className="pc-link-btn" type="button" onClick={handleResumeDrawing}>
              Resume
            </button>
          </div>
        )}

        {contextMenu && (
          <CanvasContextMenu
            menu={contextMenu}
            drawingPaused={drawingPaused}
            onClose={() => setContextMenu(null)}
            onSetHeight={handleContextSetHeight}
            onDeleteVertex={handleContextDeleteVertex}
            onEditLength={handleContextEditLength}
            onDeleteEdge={handleContextDeleteEdge}
            onPauseDrawing={handlePauseDrawing}
            onResumeDrawing={handleResumeDrawing}
            onNewShape={handleNewShape}
          />
        )}

        {/* Height Popup Modal */}
        {heightPopupIndex !== null && (
          <HeightPopup
            top={popupY}
            left={popupX}
            unitSystem={unitSystem}
            tempHeight={tempHeight}
            setTempHeight={setTempHeight}
            onConfirm={handleHeightSave}
            onDelete={handleDeleteCorner}
            onCancel={handleHeightCancel}
          />
        )}

        {/* Line Popup Modal */}
        {linePopup !== null && (
          <LinePopup
            top={linePopup.popupY}
            left={linePopup.popupX}
            tempLength={linePopup.tempLength}
            setTempLength={(val) => setLinePopup({ ...linePopup, tempLength: val })}
            unitSystem={unitSystem}
            onConfirm={handleLinePopupSave}
            onCancel={handleLinePopupCancel}
            onDelete={handleLinePopupDelete}
          />
        )}
      </div>

      {/* Right-hand side panel */}
      <SidePanel
        unitSystem={unitSystem}
        onUnitSystemChange={onUnitSystemChange}
        gridSize={gridSize}
        shapes={shapes}
        activeShapeIndex={activeShapeIndex}
        setActiveShapeIndex={setActiveShapeIndex}
        highlightNewShape={highlightNewShape}
        activeEditIndex={activeEditIndex}
        setActiveEditIndex={setActiveEditIndex}
        handleRenameShape={handleRenameShape}
        handleDeleteShape={handleDeleteShape}
        handleZoomIn={handleZoomIn}
        handleZoomOut={handleZoomOut}
        handleUndo={handlePointUndo}
        handleRedo={handlePointRedoWithFlag}
        handleNewShape={handleNewShape}
        canUndo={historyIndex > 0 || shapes[activeShapeIndex]?.points.length > 0}
        canRedo={pointHistoryIndex > 0}
        onShowInstructions={onShowInstructions}
        // toggleActiveShapeType={toggleActiveShapeType} // Uncomment to use
      />
    </div>
  )
}

PedestalGrid.propTypes = {
  onPointsChange: PropTypes.func,
  onGridSizeChange: PropTypes.func,
  unitSystem: PropTypes.oneOf(['metric', 'imperial']),
  onUnitSystemChange: PropTypes.func,
  onShowInstructions: PropTypes.func,
  zoom: PropTypes.number,
  setZoom: PropTypes.func,
  panOffset: PropTypes.shape({ x: PropTypes.number, y: PropTypes.number }),
  setPanOffset: PropTypes.func,
}

const CanvasContextMenu = ({
  menu,
  drawingPaused,
  onClose,
  onSetHeight,
  onDeleteVertex,
  onEditLength,
  onDeleteEdge,
  onPauseDrawing,
  onResumeDrawing,
  onNewShape,
}) => {
  const title =
    menu.type === 'vertex'
      ? 'Corner options'
      : menu.type === 'edge'
        ? 'Edge options'
        : 'Canvas options'

  return (
    <div
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        position: 'absolute',
        left: menu.screenX,
        top: menu.screenY,
        zIndex: 20,
        width: 190,
        padding: 6,
        borderRadius: 8,
        border: '1px solid var(--pc-line)',
        background: 'var(--pc-surface)',
        boxShadow: 'var(--pc-shadow-2)',
        color: 'var(--pc-ink)',
      }}
    >
      <div className="pc-rail-label" style={{ margin: '3px 6px 6px', color: 'var(--pc-ink-3)' }}>
        {title}
      </div>

      {menu.type === 'vertex' && (
        <>
          <ContextMenuButton onClick={onSetHeight}>Set corner height</ContextMenuButton>
          <ContextMenuButton danger onClick={onDeleteVertex}>
            Delete corner
          </ContextMenuButton>
        </>
      )}

      {menu.type === 'edge' && (
        <>
          <ContextMenuButton onClick={onEditLength}>Edit edge length</ContextMenuButton>
          <ContextMenuButton danger onClick={onDeleteEdge}>
            Delete edge point
          </ContextMenuButton>
        </>
      )}

      {menu.type === 'empty' && (
        <>
          {drawingPaused ? (
            <ContextMenuButton onClick={onResumeDrawing}>Resume drawing</ContextMenuButton>
          ) : (
            <ContextMenuButton onClick={onPauseDrawing}>Pause cursor line</ContextMenuButton>
          )}
          <ContextMenuButton onClick={onNewShape}>New shape</ContextMenuButton>
        </>
      )}

      <ContextMenuButton muted onClick={onClose}>
        Close
      </ContextMenuButton>
    </div>
  )
}

const ContextMenuButton = ({ children, onClick, danger = false, muted = false }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    style={{
      display: 'flex',
      width: '100%',
      alignItems: 'center',
      border: 0,
      borderRadius: 6,
      background: 'transparent',
      color: danger ? 'var(--pc-danger)' : muted ? 'var(--pc-ink-3)' : 'var(--pc-ink-2)',
      padding: '7px 8px',
      fontSize: 12,
      fontWeight: 550,
      textAlign: 'left',
      cursor: 'pointer',
    }}
  >
    {children}
  </button>
)

CanvasContextMenu.propTypes = {
  menu: PropTypes.shape({
    type: PropTypes.oneOf(['vertex', 'edge', 'empty']).isRequired,
    pointIndex: PropTypes.number,
    startIndex: PropTypes.number,
    endIndex: PropTypes.number,
    screenX: PropTypes.number.isRequired,
    screenY: PropTypes.number.isRequired,
  }).isRequired,
  drawingPaused: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSetHeight: PropTypes.func.isRequired,
  onDeleteVertex: PropTypes.func.isRequired,
  onEditLength: PropTypes.func.isRequired,
  onDeleteEdge: PropTypes.func.isRequired,
  onPauseDrawing: PropTypes.func.isRequired,
  onResumeDrawing: PropTypes.func.isRequired,
  onNewShape: PropTypes.func.isRequired,
}

ContextMenuButton.propTypes = {
  children: PropTypes.node.isRequired,
  onClick: PropTypes.func.isRequired,
  danger: PropTypes.bool,
  muted: PropTypes.bool,
}

export default PedestalGrid
