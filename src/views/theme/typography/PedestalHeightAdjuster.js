import React, { useState, useCallback, useEffect } from 'react'
import PropTypes from 'prop-types'
import { Delaunay } from 'd3-delaunay'
import polygonClipping from 'polygon-clipping'
import TileCanvas from '../../components/PedestalCalculator/TileCanvas'
import PedestalEditor from '../../components/PedestalCalculator/PedestalEditor'
import {
  findContainingTriangle,
  barycentricCoordinates,
  subdivideTileRect,
  getXY,
  getPerimeterPosition,
  findNearestPointIndex,
  distanceBetweenPoints,
} from '../../components/PedestalCalculator/geometryUtils'

const DISMISSED_AI_ANCHORS_KEY = 'pedestalHeightAdjuster_dismissedAiAnchors'

function getPedestalKey(x, y) {
  return `${Number(x).toFixed(4)},${Number(y).toFixed(4)}`
}

function arePedestalListsEqual(a = [], b = [], epsilon = 1e-4) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i++) {
    const left = a[i]
    const right = b[i]
    if (!left || !right) return false
    if (Math.abs((left.x || 0) - (right.x || 0)) > epsilon) return false
    if (Math.abs((left.y || 0) - (right.y || 0)) > epsilon) return false
    if (Math.abs((left.height || 0) - (right.height || 0)) > epsilon) return false
    if ((left.source || '') !== (right.source || '')) return false
  }

  return true
}

function aiDepthValueToCm(value, unit) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value)
  if (!Number.isFinite(numericValue)) return null

  const normalizedUnit = String(unit || 'mm')
    .trim()
    .toLowerCase()
  if (['in', 'inch', 'inches', '"', '”', '″'].includes(normalizedUnit)) return numericValue * 2.54
  if (['ft', 'foot', 'feet', "'", '’', '′'].includes(normalizedUnit)) return numericValue * 30.48
  if (['cm'].includes(normalizedUnit)) return numericValue
  if (['m', 'meter', 'meters', 'metre', 'metres'].includes(normalizedUnit))
    return numericValue * 100
  return numericValue / 10
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function estimatePedestalSpacing(pedestals) {
  if (!Array.isArray(pedestals) || pedestals.length < 2) return 60

  const collectMinPositiveDiff = (values) => {
    const sorted = [...new Set(values.map((value) => Number(value).toFixed(3)))]
      .map(Number)
      .sort((a, b) => a - b)
    let minDiff = Infinity
    for (let i = 1; i < sorted.length; i++) {
      const diff = sorted[i] - sorted[i - 1]
      if (diff > 0.1 && diff < minDiff) minDiff = diff
    }
    return Number.isFinite(minDiff) ? minDiff : null
  }

  const xSpacing = collectMinPositiveDiff(pedestals.map((pedestal) => pedestal.x))
  const ySpacing = collectMinPositiveDiff(pedestals.map((pedestal) => pedestal.y))
  return xSpacing || ySpacing || 60
}

function buildSpatialIndex(points, cellSize) {
  const index = new Map()
  const safeCellSize = Math.max(cellSize || 60, 1)

  points.forEach((point) => {
    const cellX = Math.floor(point.x / safeCellSize)
    const cellY = Math.floor(point.y / safeCellSize)
    const key = `${cellX},${cellY}`
    if (!index.has(key)) index.set(key, [])
    index.get(key).push(point)
  })

  return { index, cellSize: safeCellSize }
}

function getNearbyPoints(spatialIndex, point, radius) {
  if (!spatialIndex?.index) return []

  const effectiveRadius = Math.max(radius || spatialIndex.cellSize, 1)
  const cellRadius = Math.ceil(effectiveRadius / spatialIndex.cellSize)
  const centerX = Math.floor(point.x / spatialIndex.cellSize)
  const centerY = Math.floor(point.y / spatialIndex.cellSize)
  const nearby = []

  for (let dx = -cellRadius; dx <= cellRadius; dx++) {
    for (let dy = -cellRadius; dy <= cellRadius; dy++) {
      const bucket = spatialIndex.index.get(`${centerX + dx},${centerY + dy}`)
      if (!bucket) continue
      nearby.push(...bucket)
    }
  }

  return nearby
}

function buildAiDepthAnchors(rawDepthPoints, gridSize, userPolygon, pedestals, dismissedKeys = []) {
  if (!rawDepthPoints) return []

  let depthPoints
  try {
    depthPoints = typeof rawDepthPoints === 'string' ? JSON.parse(rawDepthPoints) : rawDepthPoints
  } catch {
    return []
  }

  if (!Array.isArray(depthPoints) || depthPoints.length === 0) return []
  if (!Array.isArray(pedestals) || pedestals.length === 0) return []

  const gs = gridSize || 35
  // canvasPosition is in pixels → cm = px * 100 / gridSize
  const dpCm = depthPoints
    .filter((dp) => dp?.canvasPosition && typeof dp.canvasPosition.x === 'number')
    .map((dp) => {
      const heightCm = aiDepthValueToCm(dp.value, dp.unit)
      if (!Number.isFinite(heightCm)) return null
      return {
        x: (dp.canvasPosition.x * 100) / gs,
        y: (dp.canvasPosition.y * 100) / gs,
        height: heightCm,
        description: dp.description || '',
        source: 'ai-depth',
      }
    })
    .filter(Boolean)

  if (dpCm.length === 0) return []

  const seeded = []
  const dismissed = new Set(dismissedKeys)

  // Each depth point now has an accurate position (GPT uses exact vertex coords for corners).
  // Snap each one to the nearest pedestal and add as a height anchor.
  for (const dp of dpCm) {
    let best = null
    let bestDist = 200 // max 2m snap radius
    for (const ped of pedestals) {
      const d = Math.hypot(ped.x - dp.x, ped.y - dp.y)
      if (d < bestDist) {
        bestDist = d
        best = ped
      }
    }
    if (!best) continue

    const pedestalKey = getPedestalKey(best.x, best.y)
    if (dismissed.has(pedestalKey)) continue

    // Avoid duplicate pedestal entries (keep the first one)
    const duplicate = seeded.some((s) => getPedestalKey(s.x, s.y) === pedestalKey)
    if (duplicate) continue

    seeded.push({
      x: best.x,
      y: best.y,
      height: dp.height,
      source: 'ai-depth',
      description: dp.description,
    })
  }

  return seeded
}

const PedestalHeightAdjuster = ({
  points,
  gridSize,
  unitSystem,
  calcData,
  onDataCalculated,
  onShowInstructions,
  zoom,
  setZoom,
  panOffset,
  setPanOffset,
}) => {
  const [pedestals, setPedestals] = useState(calcData.pedestals || [])
  const [userPolygon, setUserPolygon] = useState(calcData.userPolygon || [])
  const [tiles, setTiles] = useState(calcData.tiles || [])
  const [dimensionLabels, setDimensionLabels] = useState([])
  const [aiDepthAnchors, setAiDepthAnchors] = useState([])
  const [dismissedAiAnchors, setDismissedAiAnchors] = useState(() => {
    try {
      const saved = localStorage.getItem(DISMISSED_AI_ANCHORS_KEY)
      const parsed = saved ? JSON.parse(saved) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })

  // Initialize adjustedPedestals from localStorage, seeding from AI depth points if present
  const [adjustedPedestals, setAdjustedPedestals] = useState(() => {
    try {
      const saved = localStorage.getItem('pedestalHeightAdjuster_adjustedPedestals')
      if (saved) return JSON.parse(saved)

      // Seed from AI-extracted depth points if available
      const rawDepthPoints = localStorage.getItem('aiDepthPoints')
      if (rawDepthPoints) {
        const dismissed = localStorage.getItem(DISMISSED_AI_ANCHORS_KEY)
        const dismissedKeys = dismissed ? JSON.parse(dismissed) : []
        return buildAiDepthAnchors(
          rawDepthPoints,
          gridSize,
          calcData.userPolygon || [],
          calcData.pedestals || [],
          Array.isArray(dismissedKeys) ? dismissedKeys : [],
        )
      }

      return []
    } catch (error) {
      console.warn('Failed to load adjusted pedestals from localStorage:', error)
      return []
    }
  })

  // Save adjustedPedestals to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(
        'pedestalHeightAdjuster_adjustedPedestals',
        JSON.stringify(adjustedPedestals),
      )
    } catch (error) {
      console.warn('Failed to save adjusted pedestals to localStorage:', error)
    }
  }, [adjustedPedestals])

  useEffect(() => {
    try {
      localStorage.setItem(DISMISSED_AI_ANCHORS_KEY, JSON.stringify(dismissedAiAnchors))
    } catch (error) {
      console.warn('Failed to save dismissed AI anchors to localStorage:', error)
    }
  }, [dismissedAiAnchors])

  useEffect(() => {
    try {
      const rawDepthPoints = localStorage.getItem('aiDepthPoints')
      if (!rawDepthPoints) return
      if (!calcData?.pedestals?.length) return

      setAdjustedPedestals((prev) => {
        const hasManualAnchors = (prev || []).some((p) => p.source !== 'ai-depth')
        if (hasManualAnchors) return prev
        return buildAiDepthAnchors(
          rawDepthPoints,
          gridSize,
          calcData.userPolygon || [],
          calcData.pedestals || [],
          dismissedAiAnchors,
        )
      })
    } catch (error) {
      console.warn('Failed to reseed AI depth points:', error)
    }
  }, [calcData?.pedestals, calcData?.userPolygon, dismissedAiAnchors, gridSize])

  useEffect(() => {
    try {
      const rawDepthPoints = localStorage.getItem('aiDepthPoints')
      if (!rawDepthPoints || !calcData?.pedestals?.length) {
        setAiDepthAnchors([])
        return
      }

      setAiDepthAnchors(
        buildAiDepthAnchors(
          rawDepthPoints,
          gridSize,
          calcData.userPolygon || [],
          calcData.pedestals || [],
          dismissedAiAnchors,
        ),
      )
    } catch (error) {
      console.warn('Failed to build visible AI depth anchors:', error)
      setAiDepthAnchors([])
    }
  }, [calcData?.pedestals, calcData?.userPolygon, dismissedAiAnchors, gridSize])

  // Function to clear saved adjusted pedestals
  const clearSavedPedestals = () => {
    try {
      localStorage.removeItem('pedestalHeightAdjuster_adjustedPedestals')
      localStorage.removeItem(DISMISSED_AI_ANCHORS_KEY)
      const emptyAdjustedPedestals = []
      setAdjustedPedestals(emptyAdjustedPedestals)
      setDismissedAiAnchors([])

      // Recalculate all pedestal heights without any manual adjustments
      const cps = buildControlPoints(points, emptyAdjustedPedestals)
      if (cps.length >= 3) {
        const recalculatedPedestals = recalculatePedestalHeights(cps, calcData.pedestals || [])
        setPedestals(recalculatedPedestals)

        // Update calcData with recalculated pedestals
        if (onDataCalculated) {
          onDataCalculated({
            ...calcData,
            pedestals: recalculatedPedestals,
            adjustedPedestals: {},
          })
        }
      } else {
        // Fallback to original pedestals if not enough control points
        setPedestals(calcData.pedestals || [])
        if (onDataCalculated) {
          onDataCalculated({
            ...calcData,
            pedestals: calcData.pedestals || [],
            adjustedPedestals: {},
          })
        }
      }
    } catch (error) {
      console.warn('Failed to clear adjusted pedestals from localStorage:', error)
    }
  }

  // For editing pedestal
  const [editingPedestalIndex, setEditingPedestalIndex] = useState(null)
  const [pedestalModalPos, setPedestalModalPos] = useState({ x: 0, y: 0 })
  const [pedestalTempHeight, setPedestalTempHeight] = useState('')

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

  // Utility: Check if a point is on the edge of any polygon in userPolygon (array of arrays)
  function isPointOnPolygonEdge(point, userPolygon, epsilon = 0.2) {
    if (!userPolygon || userPolygon.length === 0) return false
    const first = userPolygon[0]
    // Single polygon as array of {x,y} objects
    if (first && !Array.isArray(first) && first.x !== undefined) {
      return isPointOnSinglePolygonEdge(point, userPolygon, epsilon)
    }
    // Single polygon as array of [x, y] numeric pairs — the common calcData format
    if (Array.isArray(first) && typeof first[0] === 'number') {
      return isPointOnSinglePolygonEdge(point, userPolygon, epsilon)
    }
    // Array of polygons (each element is itself a polygon)
    for (const poly of userPolygon) {
      if (isPointOnSinglePolygonEdge(point, poly, epsilon)) return true
    }
    return false
  }
  // Helper: Check if a point is on the edge of a single polygon
  function isPointOnSinglePolygonEdge(point, polygon, epsilon = 0.2) {
    if (!polygon || polygon.length < 2) return false
    const pt = getXY(point)
    for (let i = 0; i < polygon.length; i++) {
      const a = getXY(polygon[i])
      const b = getXY(polygon[(i + 1) % polygon.length])
      const dx = b.x - a.x
      const dy = b.y - a.y
      const lengthSq = dx * dx + dy * dy
      if (lengthSq === 0) continue
      let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lengthSq
      t = Math.max(0, Math.min(1, t))
      const projX = a.x + t * dx
      const projY = a.y + t * dy
      const distSq = (pt.x - projX) ** 2 + (pt.y - projY) ** 2
      if (distSq < epsilon * epsilon) return true
    }
    return false
  }

  // Recalculate pedestal heights using triangulation
  const recalculatePedestalHeights = useCallback(
    (controlPoints, currentPedestals) => {
      // Identify all edge pedestals
      const edgePedestals = currentPedestals.filter((p) => isPointOnPolygonEdge(p, userPolygon))
      // Identify manually edited edge pedestals (manual anchors)
      const manualEdgeAnchors = adjustedPedestals.filter((p) =>
        isPointOnPolygonEdge(p, userPolygon),
      )
      // Find the maximum height among all pedestals
      const maxHeight = Math.max(...currentPedestals.map((p) => p.height || 0), 0)
      const edgePoints = edgePedestals
        .map((pedestal) => ({
          pedestal,
          perimeter: getPerimeterPosition(pedestal, userPolygon),
        }))
        .filter((entry) => entry.perimeter)
        .sort((a, b) => a.perimeter.distance - b.perimeter.distance)

      const anchorPoints = manualEdgeAnchors
        .map((anchor) => ({
          anchor,
          perimeter: getPerimeterPosition(anchor, userPolygon),
        }))
        .filter((entry) => entry.perimeter)
        .sort((a, b) => a.perimeter.distance - b.perimeter.distance)

      // Build a map of edge pedestal heights
      const edgeHeights = {}
      if (anchorPoints.length >= 2 && edgePoints.length > 0) {
        const perimeterLength = edgePoints[0].perimeter.perimeterLength || 0
        for (let i = 0; i < anchorPoints.length; i++) {
          const anchorA = anchorPoints[i]
          const anchorB = anchorPoints[(i + 1) % anchorPoints.length]
          const start = anchorA.perimeter.distance
          const end = anchorB.perimeter.distance
          const span = end >= start ? end - start : perimeterLength - start + end

          edgeHeights[`${anchorA.anchor.x},${anchorA.anchor.y}`] = anchorA.anchor.height

          edgePoints.forEach(({ pedestal, perimeter }) => {
            const offset =
              perimeter.distance >= start
                ? perimeter.distance - start
                : perimeterLength - start + perimeter.distance
            const withinArc = span === 0 ? offset === 0 : offset >= 0 && offset <= span
            if (!withinArc) return
            const t = span === 0 ? 0 : offset / span
            edgeHeights[`${pedestal.x},${pedestal.y}`] =
              anchorA.anchor.height * (1 - t) + anchorB.anchor.height * t
          })
        }
      } else if (anchorPoints.length === 1) {
        for (const { pedestal } of edgePoints) {
          edgeHeights[`${pedestal.x},${pedestal.y}`] = anchorPoints[0].anchor.height
        }
      } else {
        // Anchor all edge pedestals to the maximum height
        for (const { pedestal } of edgePoints) {
          edgeHeights[`${pedestal.x},${pedestal.y}`] = maxHeight
        }
      }

      // Build Delaunay for interior interpolation.
      // Override control-point heights with perimeter-corrected values where available,
      // so the 2D triangulation uses the correct boundary conditions (not raw AI-scan heights).
      const correctedControlPoints = controlPoints.map((cp) => {
        const key = `${cp.x},${cp.y}`
        return edgeHeights[key] !== undefined ? { ...cp, height: edgeHeights[key] } : cp
      })
      const delaunay = Delaunay.from(
        correctedControlPoints,
        (p) => p.x,
        (p) => p.y,
      )
      const triangles = []
      for (let i = 0; i < delaunay.triangles.length; i += 3) {
        const triIdx = delaunay.triangles.slice(i, i + 3)
        const tri = [
          correctedControlPoints[triIdx[0]],
          correctedControlPoints[triIdx[1]],
          correctedControlPoints[triIdx[2]],
        ]
        if (tri.every((p) => p.height !== undefined && p.height !== null)) {
          triangles.push(tri)
        }
      }

      // Recompute heights for all pedestals
      const recalculatedPedestals = currentPedestals.map((pedestal) => {
        // Check for manual override
        const manual = adjustedPedestals.find((p) => p.x === pedestal.x && p.y === pedestal.y)
        if (manual) return { ...manual }
        // Edge pedestals: use edgeHeights
        if (isPointOnPolygonEdge(pedestal, userPolygon)) {
          const key = `${pedestal.x},${pedestal.y}`
          return {
            ...pedestal,
            height: edgeHeights[key] !== undefined ? edgeHeights[key] : maxHeight,
          }
        }
        // Interior pedestals: use all control points as before
        const tri = findContainingTriangle(pedestal, triangles)
        if (tri) {
          const { l0, l1, l2 } = barycentricCoordinates(pedestal.x, pedestal.y, ...tri)
          const height = l0 * tri[0].height + l1 * tri[1].height + l2 * tri[2].height
          return { ...pedestal, height: height || 0 }
        }
        // If outside convex hull, use nearest anchor point
        const nearestIdx = delaunay.find(pedestal.x, pedestal.y)
        const nearestHeight = correctedControlPoints[nearestIdx]?.height || 0
        return { ...pedestal, height: nearestHeight }
      })

      const manualAnchors = adjustedPedestals.filter(
        (anchor) => anchor.height !== undefined && anchor.height !== null,
      )
      if (manualAnchors.length === 0) {
        return recalculatedPedestals
      }

      const estimatedSpacing = estimatePedestalSpacing(recalculatedPedestals)
      const spatialIndex = buildSpatialIndex(recalculatedPedestals, estimatedSpacing * 1.5)
      const localSpacingByAnchor = new Map()
      manualAnchors.forEach((anchor) => {
        const nearbyPedestals = getNearbyPoints(spatialIndex, anchor, estimatedSpacing * 2.2)
          .map((pedestal) => distanceBetweenPoints(pedestal, anchor))
          .filter((distance) => distance > 0.1)
          .sort((a, b) => a - b)
        localSpacingByAnchor.set(
          getPedestalKey(anchor.x, anchor.y),
          nearbyPedestals[0] || estimatedSpacing,
        )
      })

      const constrainedPedestalKeys = new Set()
      const lineConstraintTolerance = 0.35

      // Edge pedestals were set by the perimeter pass and act as boundary conditions.
      // Include them as bracket anchors so interior pedestals interpolate outward from
      // the perimeter rather than from the (potentially far-away) polygon corners.
      const edgeConstraintAnchors = recalculatedPedestals.filter(
        (p) => isPointOnPolygonEdge(p, userPolygon) && Number.isFinite(p.height),
      )
      const edgeAnchorKeys = new Set(edgeConstraintAnchors.map((ep) => getPedestalKey(ep.x, ep.y)))

      const constraintAnchors = [
        ...manualAnchors,
        ...edgeConstraintAnchors.filter(
          (ep) =>
            !manualAnchors.some(
              (anchor) => Math.abs(anchor.x - ep.x) < 1e-4 && Math.abs(anchor.y - ep.y) < 1e-4,
            ),
        ),
      ]

      // For each pedestal, find its immediate bracket anchors on the same row or column
      // and interpolate exactly once. This prevents multiple anchor pairs from fighting
      // over the same pedestal (which caused values lower than the nearest anchor).
      //
      // Key rule: only apply 1D bracket interpolation when at least one bracket is an
      // interior (non-edge) manual anchor. When both brackets are edge pedestals, the
      // 2D Delaunay triangulation already accounts for interior anchors (like a 10in
      // anchor on a nearby row), so overriding it with a flat edge-to-edge interpolation
      // would lose that influence (e.g. the diagonal neighbor of a 10in anchor getting 4in).
      const constrainedPedestals = recalculatedPedestals.map((pedestal) => {
        const manual = adjustedPedestals.find((p) => p.x === pedestal.x && p.y === pedestal.y)
        if (manual) return pedestal

        // Perimeter pedestals were already set by the perimeter pass above — preserve them
        // and mark them so the proximity influence pass below also skips them.
        if (isPointOnPolygonEdge(pedestal, userPolygon)) {
          constrainedPedestalKeys.add(getPedestalKey(pedestal.x, pedestal.y))
          return pedestal
        }

        const isEdgeAnchor = (a) => edgeAnchorKeys.has(getPedestalKey(a.x, a.y))
        const getAnchorSpacing = (anchor) =>
          localSpacingByAnchor.get(getPedestalKey(anchor.x, anchor.y)) || 60

        // Row interpolation: anchors aligned on the same y-row
        const rowAnchors = constraintAnchors.filter(
          (a) => Math.abs(a.y - pedestal.y) <= lineConstraintTolerance,
        )
        if (rowAnchors.length >= 2) {
          const left = rowAnchors
            .filter((a) => a.x <= pedestal.x - 1e-6)
            .sort((a, b) => b.x - a.x)[0]
          const right = rowAnchors
            .filter((a) => a.x >= pedestal.x + 1e-6)
            .sort((a, b) => a.x - b.x)[0]
          if (left && right && (!isEdgeAnchor(left) || !isEdgeAnchor(right))) {
            const span = right.x - left.x
            const allowedSpan = Math.max(
              120,
              (getAnchorSpacing(left) + getAnchorSpacing(right)) * 1.8,
            )
            if (span > 1e-6 && span <= allowedSpan) {
              const t = Math.max(0, Math.min(1, (pedestal.x - left.x) / span))
              constrainedPedestalKeys.add(getPedestalKey(pedestal.x, pedestal.y))
              return { ...pedestal, height: left.height * (1 - t) + right.height * t }
            }
          }
        }

        // Column interpolation: anchors aligned on the same x-column
        const colAnchors = constraintAnchors.filter(
          (a) => Math.abs(a.x - pedestal.x) <= lineConstraintTolerance,
        )
        if (colAnchors.length >= 2) {
          const above = colAnchors
            .filter((a) => a.y <= pedestal.y - 1e-6)
            .sort((a, b) => b.y - a.y)[0]
          const below = colAnchors
            .filter((a) => a.y >= pedestal.y + 1e-6)
            .sort((a, b) => a.y - b.y)[0]
          if (above && below && (!isEdgeAnchor(above) || !isEdgeAnchor(below))) {
            const span = below.y - above.y
            const allowedSpan = Math.max(
              120,
              (getAnchorSpacing(above) + getAnchorSpacing(below)) * 1.8,
            )
            if (span > 1e-6 && span <= allowedSpan) {
              const t = Math.max(0, Math.min(1, (pedestal.y - above.y) / span))
              constrainedPedestalKeys.add(getPedestalKey(pedestal.x, pedestal.y))
              return { ...pedestal, height: above.height * (1 - t) + below.height * t }
            }
          }
        }

        return pedestal
      })

      const locallyInfluencedPedestals = constrainedPedestals.map((pedestal) => {
        const manual = adjustedPedestals.find((p) => p.x === pedestal.x && p.y === pedestal.y)
        if (manual) return pedestal
        const isConstrained = constrainedPedestalKeys.has(getPedestalKey(pedestal.x, pedestal.y))
        const nearbyAnchors = []

        for (const anchor of manualAnchors) {
          const spacing = localSpacingByAnchor.get(getPedestalKey(anchor.x, anchor.y)) || 60
          const distance = distanceBetweenPoints(anchor, pedestal)
          const reach = spacing * 1.6
          if (distance > reach) continue

          let falloff = 0
          if (distance <= spacing * 0.95) {
            falloff = 1
          } else {
            falloff = 1 - (distance - spacing * 0.95) / Math.max(spacing * 0.65, 1)
          }

          if (falloff <= 0) continue

          nearbyAnchors.push({
            anchor,
            distance,
            spacing,
            weight: falloff * falloff,
          })
        }

        if (nearbyAnchors.length === 0) {
          return pedestal
        }

        const totalWeight = nearbyAnchors.reduce((sum, entry) => sum + entry.weight, 0)
        if (totalWeight <= 0) {
          return pedestal
        }

        const weightedAnchorHeight =
          nearbyAnchors.reduce((sum, entry) => sum + entry.anchor.height * entry.weight, 0) /
          totalWeight

        const strongestLocalWeight = Math.max(...nearbyAnchors.map((entry) => entry.weight))
        const baseInfluence = isConstrained ? 0.22 : 0.35
        const maxExtraInfluence = isConstrained ? 0.28 : 0.45
        const multiAnchorBonus = nearbyAnchors.length >= 2 ? 0.06 : 0
        const influence = Math.min(
          isConstrained ? 0.55 : 0.86,
          baseInfluence + maxExtraInfluence * strongestLocalWeight + multiAnchorBonus,
        )

        return {
          ...pedestal,
          height: pedestal.height * (1 - influence) + weightedAnchorHeight * influence,
        }
      })

      const fixedPedestalKeys = new Set([
        ...manualAnchors.map((anchor) => getPedestalKey(anchor.x, anchor.y)),
        ...edgeConstraintAnchors.map((anchor) => getPedestalKey(anchor.x, anchor.y)),
      ])

      let smoothedPedestals = locallyInfluencedPedestals.map((pedestal) => ({ ...pedestal }))
      const smoothingPasses = 2

      for (let pass = 0; pass < smoothingPasses; pass++) {
        const sourcePedestals = smoothedPedestals
        const passSpatialIndex = buildSpatialIndex(sourcePedestals, estimatedSpacing * 1.5)
        smoothedPedestals = sourcePedestals.map((pedestal) => {
          const pedestalKey = getPedestalKey(pedestal.x, pedestal.y)
          if (fixedPedestalKeys.has(pedestalKey)) {
            return pedestal
          }

          const baseSpacing = estimatedSpacing
          const neighborRadius = Math.max(baseSpacing * 1.35, 45)
          const neighbors = getNearbyPoints(passSpatialIndex, pedestal, neighborRadius).filter(
            (candidate) => {
              const candidateKey = getPedestalKey(candidate.x, candidate.y)
              if (candidateKey === pedestalKey) return false
              return distanceBetweenPoints(candidate, pedestal) <= neighborRadius
            },
          )

          if (neighbors.length < 2) {
            return pedestal
          }

          const neighborAverage =
            neighbors.reduce((sum, candidate) => sum + candidate.height, 0) / neighbors.length
          const maxNeighborDiff = Math.max(
            ...neighbors.map((candidate) => Math.abs(candidate.height - pedestal.height)),
          )
          const isConstraintDriven = constrainedPedestalKeys.has(pedestalKey)
          const smoothingStrength = isConstraintDriven ? 0.18 : 0.32
          const blendedHeight =
            pedestal.height * (1 - smoothingStrength) + neighborAverage * smoothingStrength

          // Prevent one-step jumps between adjacent pedestals unless the location is fixed by
          // a manual anchor or the perimeter. The cap is intentionally conservative so the
          // existing interpolation shape still dominates over broad areas.
          const maxAllowedStep = isConstraintDriven ? 3.5 : 2.75
          if (maxNeighborDiff <= maxAllowedStep) {
            return { ...pedestal, height: blendedHeight }
          }

          const minNeighborHeight = Math.min(...neighbors.map((candidate) => candidate.height))
          const maxNeighborHeight = Math.max(...neighbors.map((candidate) => candidate.height))
          return {
            ...pedestal,
            height: clamp(
              blendedHeight,
              minNeighborHeight - maxAllowedStep,
              maxNeighborHeight + maxAllowedStep,
            ),
          }
        })
      }

      return smoothedPedestals
    },
    [adjustedPedestals, userPolygon],
  )

  // Pedestal editing logic
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
    // Update the edited pedestal
    const updatedPedestals = [...pedestals]
    const updatedPed = { ...updatedPedestals[editingPedestalIndex], height: newHeight }
    updatedPedestals[editingPedestalIndex] = updatedPed

    // --- NEW LOGIC: update points if this pedestal matches a corner ---
    let updatedPoints = points.map((shape) => {
      if (shape.type === 'add' && shape.points && shape.points.length > 0) {
        const newShapePoints = shape.points.map((p) => {
          if (Math.abs(p.x - updatedPed.x) < 1e-6 && Math.abs(p.y - updatedPed.y) < 1e-6) {
            return { ...p, height: newHeight }
          }
          return p
        })
        return { ...shape, points: newShapePoints }
      }
      return shape
    })

    // Create new adjustedPedestals array with the updated pedestal
    const newAdjustedPedestals = [...adjustedPedestals]
    const idx = newAdjustedPedestals.findIndex((p) => p.x === updatedPed.x && p.y === updatedPed.y)
    if (idx !== -1) {
      newAdjustedPedestals[idx] = updatedPed
    } else {
      newAdjustedPedestals.push(updatedPed)
    }
    setAdjustedPedestals(newAdjustedPedestals)
    setDismissedAiAnchors((prev) =>
      prev.filter((key) => key !== getPedestalKey(updatedPed.x, updatedPed.y)),
    )

    // Immediately recalculate all pedestal heights
    const cps = buildControlPoints(updatedPoints, newAdjustedPedestals)

    if (cps.length >= 3) {
      const newPeds = recalculatePedestalHeights(cps, updatedPedestals)
      setPedestals(newPeds)

      if (onDataCalculated) {
        onDataCalculated({
          ...calcData,
          pedestals: newPeds,
        })
      }
    } else {
      setPedestals(updatedPedestals)
      if (onDataCalculated) {
        onDataCalculated({
          ...calcData,
          pedestals: updatedPedestals,
        })
      }
    }

    setEditingPedestalIndex(null)
  }

  const cancelPedestalEdit = () => {
    setEditingPedestalIndex(null)
  }

  const deletePedestal = () => {
    if (editingPedestalIndex == null) return
    const currentPedestal = pedestals[editingPedestalIndex]
    const { x, y } = currentPedestal
    const pedestalKey = getPedestalKey(x, y)
    const isAiPrediction = adjustedPedestals.some(
      (p) => getPedestalKey(p.x, p.y) === pedestalKey && p.source === 'ai-depth',
    )

    // Remove from adjustedPedestals (this removes the user's manual adjustment)
    const nextAdjustedPedestals = adjustedPedestals.filter((p) => !(p.x === x && p.y === y))
    setAdjustedPedestals(nextAdjustedPedestals)
    if (isAiPrediction) {
      setDismissedAiAnchors((prev) => (prev.includes(pedestalKey) ? prev : [...prev, pedestalKey]))
    }

    // Recalculate the pedestal height without the manual adjustment
    const cps = buildControlPoints(points, nextAdjustedPedestals)

    if (cps.length >= 3) {
      // Recalculate all pedestal heights
      const newPeds = recalculatePedestalHeights(cps, pedestals)
      setPedestals(newPeds)

      if (onDataCalculated) {
        onDataCalculated({
          ...calcData,
          pedestals: newPeds,
        })
      }
    } else {
      // If not enough control points, just update the current pedestal to its original calculated height
      // Find the pedestal in the original calcData
      const originalPedestal = calcData.pedestals?.find(
        (p) => Math.abs(p.x - x) < 0.1 && Math.abs(p.y - y) < 0.1,
      )
      if (originalPedestal) {
        const updatedPedestals = pedestals.map((p) =>
          Math.abs(p.x - x) < 0.1 && Math.abs(p.y - y) < 0.1 ? originalPedestal : p,
        )
        setPedestals(updatedPedestals)

        if (onDataCalculated) {
          onDataCalculated({
            ...calcData,
            pedestals: updatedPedestals,
          })
        }
      }
    }

    setEditingPedestalIndex(null)
  }

  useEffect(() => {
    if (!calcData?.pedestals?.length) return
    setPedestals(calcData.pedestals)
    setUserPolygon(calcData.userPolygon)
    const mainAddShape = points.find((shape) => shape.type === 'add' && shape.points.length)
    if (
      mainAddShape &&
      Array.isArray(mainAddShape.dimensionLabels) &&
      mainAddShape.dimensionLabels.length === (calcData.userPolygon || []).length
    ) {
      setDimensionLabels(mainAddShape.dimensionLabels)
    } else {
      setDimensionLabels([])
    }
  }, [calcData, points])

  const buildControlPoints = useCallback((points, adjustedPedestals) => {
    const cps = []

    // Add original points as control points
    points.forEach((shape) => {
      if (shape.type === 'add' && shape.points && shape.points.length > 0) {
        shape.points.forEach((p) => {
          if (p.x !== undefined && p.y !== undefined) {
            const height = parseFloat(p.height) || 0
            cps.push({
              x: p.x,
              y: p.y,
              height,
            })
          }
        })
      }
    })

    // Add all adjusted pedestals as control points
    adjustedPedestals.forEach((p) => {
      if (p.x !== undefined && p.y !== undefined) {
        const height = parseFloat(p.height) || 0
        cps.push({
          x: p.x,
          y: p.y,
          height,
        })
      }
    })

    return cps
  }, [])

  // Update the effect hook to properly handle recalculation
  useEffect(() => {
    if (!points?.length) return

    const basePedestals = calcData?.pedestals || []
    if (!basePedestals.length) return

    const cps = buildControlPoints(points, adjustedPedestals)
    if (cps.length < 3) return

    const newPeds = recalculatePedestalHeights(cps, basePedestals)
    if (arePedestalListsEqual(newPeds, pedestals)) return

    setPedestals(newPeds)

    if (onDataCalculated && !arePedestalListsEqual(newPeds, calcData?.pedestals || [])) {
      onDataCalculated({
        ...calcData,
        pedestals: newPeds,
      })
    }
  }, [
    points,
    adjustedPedestals,
    buildControlPoints,
    recalculatePedestalHeights,
    calcData,
    onDataCalculated,
    pedestals,
  ])

  // For visual debug: collect edge pedestals
  const edgePedestals = pedestals.filter((p) => isPointOnPolygonEdge(p, userPolygon, 0.2))
  const visibleAnchors = (() => {
    const merged = new Map()
    aiDepthAnchors.forEach((anchor) => merged.set(getPedestalKey(anchor.x, anchor.y), anchor))
    adjustedPedestals.forEach((anchor) => merged.set(getPedestalKey(anchor.x, anchor.y), anchor))
    return Array.from(merged.values())
  })()

  // Multi-pedestal selection state
  const [selectionStart, setSelectionStart] = useState(null)
  const [selectionEnd, setSelectionEnd] = useState(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedPedestals, setSelectedPedestals] = useState([])
  const [multiHeightInput, setMultiHeightInput] = useState('')
  const [showMultiHeightModal, setShowMultiHeightModal] = useState(false)

  // Handler for selection drag start (Shift+drag)
  const handleSelectionStart = (canvasX, canvasY) => {
    setIsSelecting(true)
    setSelectionStart({ x: canvasX, y: canvasY })
    setSelectionEnd({ x: canvasX, y: canvasY })
  }
  // Handler for selection drag move
  const handleSelectionMove = (canvasX, canvasY) => {
    if (isSelecting) setSelectionEnd({ x: canvasX, y: canvasY })
  }
  // Handler for selection drag end
  const handleSelectionEnd = (canvasX, canvasY) => {
    setIsSelecting(false)
    setSelectionEnd({ x: canvasX, y: canvasY })
    // Find all pedestals within the selection rectangle
    if (selectionStart) {
      const minX = Math.min(selectionStart.x, canvasX)
      const maxX = Math.max(selectionStart.x, canvasX)
      const minY = Math.min(selectionStart.y, canvasY)
      const maxY = Math.max(selectionStart.y, canvasY)
      const tolerance = 0.5 // cm
      const selected = pedestals.filter(
        (p) =>
          p.x >= minX - tolerance &&
          p.x <= maxX + tolerance &&
          p.y >= minY - tolerance &&
          p.y <= maxY + tolerance,
      )
      setSelectedPedestals(selected)
      if (selected.length > 0) {
        setShowMultiHeightModal(true)
        setMultiHeightInput('')
      }
    }
  }

  // Apply height to all selected pedestals (for PedestalEditor)
  const saveMultiPedestalEdit = (heightValue) => {
    if (!selectedPedestals.length) return
    const numericVal = parseFloat(heightValue)
    if (isNaN(numericVal)) {
      alert('Invalid height entered. Please enter a number.')
      return
    }
    const newAdjusted = [...adjustedPedestals]
    selectedPedestals.forEach((p) => {
      const idx = newAdjusted.findIndex((ap) => ap.x === p.x && ap.y === p.y)
      const newHeight = unitSystem === 'imperial' ? numericVal * 2.54 : numericVal
      const updatedPed = { ...p, height: newHeight }
      if (idx !== -1) {
        newAdjusted[idx] = updatedPed
      } else {
        newAdjusted.push(updatedPed)
      }
    })
    setAdjustedPedestals(newAdjusted)
    setShowMultiHeightModal(false)
    setSelectedPedestals([])
    setSelectionStart(null)
    setSelectionEnd(null)
    setMultiHeightInput('')
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: '16px',
        position: 'relative',
      }}
    >
      {/* The Canvas */}
      <div
        className="pc-panel"
        style={{
          flex: '1 1 640px',
          minWidth: 0,
          overflow: 'auto',
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
          onPedestalClick={handlePedestalClick}
          zoom={zoom}
          panOffset={panOffset}
          setPanOffset={setPanOffset}
          setZoom={setZoom}
          userPedestals={visibleAnchors}
          edgePedestals={edgePedestals}
          selectionStart={selectionStart}
          selectionEnd={selectionEnd}
          isSelecting={isSelecting}
          onSelectionStart={handleSelectionStart}
          onSelectionMove={handleSelectionMove}
          onSelectionEnd={handleSelectionEnd}
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

      {/* Multi-Height Modal (now using PedestalEditor) */}
      {showMultiHeightModal && (
        <PedestalEditor
          pedestal={{ x: 0, y: 0, height: '', multi: true }}
          unitSystem={unitSystem}
          pedestalTempHeight={multiHeightInput}
          setPedestalTempHeight={setMultiHeightInput}
          onSave={() => saveMultiPedestalEdit(multiHeightInput)}
          onDelete={null}
          onCancel={() => {
            setShowMultiHeightModal(false)
            setSelectedPedestals([])
            setSelectionStart(null)
            setSelectionEnd(null)
            setMultiHeightInput('')
          }}
          modalPosition={{ x: 300, y: 200 }}
        />
      )}

      <aside
        className="pc-panel"
        style={{
          width: 'min(280px, 100%)',
          maxWidth: '100%',
          padding: 14,
          background: 'var(--pc-surface)',
          color: 'var(--pc-ink)',
          maxHeight: 'min(640px, calc(100vh - 220px))',
          overflowY: 'auto',
          boxSizing: 'border-box',
          flex: '0 1 280px',
        }}
      >
        {onShowInstructions && (
          <div style={{ marginBottom: '16px' }}>
            <button
              className="pc-btn"
              type="button"
              onClick={onShowInstructions}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Step Instructions
            </button>
          </div>
        )}

        <div className="pc-rail-label">Pedestal Heights</div>
        <div style={{ color: 'var(--pc-ink-3)', fontSize: 12, lineHeight: 1.5, marginBottom: 16 }}>
          Click a pedestal to edit one height. Hold Shift and drag to set multiple pedestals.
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div className="pc-rail-label">Canvas</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button className="pc-btn" type="button" onClick={handleZoomIn}>
              Zoom In
            </button>
            <button className="pc-btn" type="button" onClick={handleZoomOut}>
              Zoom Out
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div className="pc-rail-label">Data</div>
          <button
            className="pc-btn"
            type="button"
            onClick={clearSavedPedestals}
            style={{
              color: 'var(--pc-danger)',
              width: '100%',
              justifyContent: 'center',
            }}
          >
            Clear Saved Heights
          </button>
        </div>
      </aside>
    </div>
  )
}

export default PedestalHeightAdjuster

PedestalHeightAdjuster.propTypes = {
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
      dimensionLabels: PropTypes.array,
    }),
  ).isRequired,
  gridSize: PropTypes.number.isRequired,
  unitSystem: PropTypes.oneOf(['metric', 'imperial']).isRequired,
  calcData: PropTypes.shape({
    pedestals: PropTypes.array,
    userPolygon: PropTypes.array,
    tiles: PropTypes.array,
    tileCount: PropTypes.number,
    adjustedPedestals: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  }).isRequired,
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
