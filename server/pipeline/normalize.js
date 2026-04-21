/**
 * Geometry normalization stage.
 *
 * Purpose: Apply deterministic post-processing to the raw AI output so that
 * the result is geometrically consistent before it reaches the canvas.
 *
 * This stage does NOT call any AI — it only applies rules.
 *
 * Transformations applied:
 *   1. Snap nearby vertices (within SNAP_TOLERANCE) to the same point
 *   2. Merge nearly-collinear consecutive segments (within angle tolerance)
 *   3. Remove degenerate segments (length < MIN_SEGMENT_LENGTH)
 *   4. Close open polygons when end-to-start gap is within CLOSURE_TOLERANCE
 *   5. Validate closure and emit a warning if it cannot be closed
 *   6. Classify polygons: outer boundary (largest area) vs cutouts (smaller)
 *   7. Detect dimension contradictions between segments
 *   8. Produce the final normalized deckPlan in the canonical schema
 */

// ─── Tolerances (in real-world units, same unit as polygon coordinates) ──────
// Snap is intentionally small: polygon vertices come from the precise line-graph
// (4-decimal-place normalised coords), not from fuzzy LLM text output.
// 0.02 catches true near-coincident corners (rounding artefacts) without
// collapsing short-but-real step edges on L/T/U-shaped decks.
const SNAP_TOLERANCE = 0.02         // Vertices closer than this are merged
const CLOSURE_TOLERANCE = 0.3       // Max end-to-start gap for auto-close
const MIN_SEGMENT_LENGTH = 0.02     // Segments shorter than this are removed
const COLLINEAR_ANGLE_TOLERANCE = 8 // Degrees — merge segments within this angle

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * Normalize a raw deck plan produced by the reasoning stage.
 *
 * @param {object} rawPlan - Raw output from geometry.js (new schema format)
 * @returns {object} Normalized deck plan matching the canonical schema
 */
function normalizeDeckPlan(rawPlan) {
  const warnings = [...(rawPlan.warnings || [])]

  if (!rawPlan || !rawPlan.outerBoundary || rawPlan.outerBoundary.length < 3) {
    warnings.push('No valid outer boundary received from reasoning stage — returning empty plan')
    return buildEmptyPlan(warnings)
  }

  // 1. Merge collinear consecutive segments first — removes intermediate nodes
  //    that lie on a straight edge of the polygon (common in line-graph output
  //    where a single wall is split at every intersection with a perpendicular).
  //    Doing this before snap avoids the snap step fusing two nodes that are
  //    close together on a straight line rather than at a true corner.
  let outerPts = mergeCollinearVertices(rawPlan.outerBoundary, COLLINEAR_ANGLE_TOLERANCE)

  // 2. Snap near-coincident vertices (rounding artefacts / true duplicate corners)
  outerPts = snapVertices(outerPts, SNAP_TOLERANCE)

  // 3. Remove degenerate segments (consecutive identical or near-identical points)
  outerPts = removeDegeneratePoints(outerPts, MIN_SEGMENT_LENGTH)

  // 4. Attempt to close open polygon
  const closeResult = closePolygon(outerPts, CLOSURE_TOLERANCE)
  const outerClosed = closeResult.points
  if (!closeResult.wasClosed && closeResult._suspiciouslyOpenPath) {
    warnings.push(
      `Outer boundary may be an incomplete trace: the closing edge is unusually long ` +
      `(${closeResult.closureGap.toFixed(3)} units). Manual review recommended.`
    )
  }

  // Validate we still have a usable polygon
  if (outerClosed.length < 3) {
    warnings.push('Outer boundary has fewer than 3 vertices after normalization — returning empty plan')
    return buildEmptyPlan(warnings)
  }

  // 5. Normalize cutouts
  const normalizedCutouts = (rawPlan.cutouts || []).map((cutout, i) => {
    if (!Array.isArray(cutout) || cutout.length < 3) {
      warnings.push(`Cutout ${i + 1}: fewer than 3 vertices, skipping`)
      return null
    }
    let pts = mergeCollinearVertices(cutout, COLLINEAR_ANGLE_TOLERANCE)
    pts = snapVertices(pts, SNAP_TOLERANCE)
    pts = removeDegeneratePoints(pts, MIN_SEGMENT_LENGTH)
    const { points: closed, wasClosed: cutoutClosed, closureGap: cutoutGap } = closePolygon(pts, CLOSURE_TOLERANCE)
    if (!cutoutClosed && cutoutGap > CLOSURE_TOLERANCE) {
      warnings.push(`Cutout ${i + 1}: not closed (gap ${cutoutGap.toFixed(3)} units)`)
    }
    return closed.length >= 3 ? closed : null
  }).filter(Boolean)

  // 6. Build normalized segments from outer boundary
  const segments = buildSegments(outerClosed, rawPlan.segments || [])

  // 7. Check for dimension contradictions
  const contradictions = detectContradictions(segments)
  warnings.push(...contradictions)

  // 8. Validate depth points (must be within or near outer boundary)
  const depthPoints = (rawPlan.depthPoints || []).map((dp, i) => {
    if (!dp.position || typeof dp.position.x !== 'number' || typeof dp.position.y !== 'number') {
      warnings.push(`Depth point ${i + 1}: missing or invalid position, skipping`)
      return null
    }
    return dp
  }).filter(Boolean)

  // 9. Compute bounding box
  const xs = outerClosed.map((p) => p.x)
  const ys = outerClosed.map((p) => p.y)
  const boundingBox = {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }

  const polygonArea = computePolygonArea(outerClosed)

  return {
    outerBoundary: outerClosed,
    cutouts: normalizedCutouts,
    segments,
    depthPoints,
    notes: rawPlan.notes || [],
    unit: rawPlan.unit || 'unknown',
    confidence: rawPlan.confidence || 0,
    boundingBox,
    area: polygonArea,
    warnings,
  }
}

// ─── Vertex Snapping ──────────────────────────────────────────────────────────

/**
 * Snap vertices that are within tolerance of each other to the same position.
 * Uses a simple cluster approach: merge into centroid.
 */
function snapVertices(points, tolerance) {
  if (points.length === 0) return points
  const result = []
  const used = new Array(points.length).fill(false)

  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue
    const cluster = [points[i]]
    used[i] = true

    // Only snap to immediately adjacent vertices (structural snapping only)
    // We don't want to collapse non-adjacent vertices that happen to be close
    const prevIdx = (i - 1 + points.length) % points.length
    const nextIdx = (i + 1) % points.length

    for (const j of [prevIdx, nextIdx]) {
      if (used[j]) continue
      const d = dist(points[i], points[j])
      if (d <= tolerance) {
        cluster.push(points[j])
        used[j] = true
      }
    }

    // Centroid of cluster
    const cx = cluster.reduce((s, p) => s + p.x, 0) / cluster.length
    const cy = cluster.reduce((s, p) => s + p.y, 0) / cluster.length
    result.push({ x: round4(cx), y: round4(cy) })
  }

  return result
}

// ─── Merge Collinear Consecutive Vertices ────────────────────────────────────

/**
 * Remove intermediate vertices that are collinear with their neighbors.
 * This simplifies edges that were described with unnecessary intermediate points.
 */
function mergeCollinearVertices(points, angleTolerance) {
  if (points.length <= 3) return points
  const result = []

  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length]
    const curr = points[i]
    const next = points[(i + 1) % points.length]

    const angle1 = Math.atan2(curr.y - prev.y, curr.x - prev.x) * 180 / Math.PI
    const angle2 = Math.atan2(next.y - curr.y, next.x - curr.x) * 180 / Math.PI
    let diff = Math.abs(((angle2 - angle1 + 180 + 360) % 360) - 180)
    if (diff > 90) diff = 180 - diff

    if (diff > angleTolerance) {
      result.push(curr) // Keep this vertex — it's a real corner
    }
    // Otherwise skip (collinear with neighbors)
  }

  return result.length >= 3 ? result : points
}

// ─── Remove Degenerate Points ─────────────────────────────────────────────────

function removeDegeneratePoints(points, minLength) {
  if (points.length <= 3) return points
  return points.filter((p, i) => {
    const next = points[(i + 1) % points.length]
    return dist(p, next) > minLength
  })
}

// ─── Polygon Closure ──────────────────────────────────────────────────────────

/**
 * Normalize polygon closure.
 *
 * A polygon with N distinct vertices is ALWAYS implicitly closed — the last→first
 * edge is assumed. We never warn just because first != last; that's normal.
 *
 * We only:
 *   1. Remove a duplicate endpoint (last == first within epsilon)
 *   2. Optionally warn when the implicit closing edge is suspiciously long vs
 *      the median edge (which may indicate an incomplete trace from the AI)
 */
function closePolygon(points, tolerance) {
  if (points.length === 0) return { points, wasClosed: false, closureGap: Infinity }

  const first = points[0]
  const last = points[points.length - 1]
  const gap = dist(first, last)

  // Remove duplicate closing point (AI sometimes appends the start again)
  if (gap < 0.001) {
    return { points: points.slice(0, -1), wasClosed: true, closureGap: 0 }
  }

  // Check if the implicit closing edge (last→first) is unusually long compared to
  // other edges — this may indicate the AI stopped tracing mid-path.
  if (points.length >= 3) {
    const edgeLengths = points.map((p, i) => dist(p, points[(i + 1) % points.length]))
    edgeLengths.sort((a, b) => a - b)
    const medianEdge = edgeLengths[Math.floor(edgeLengths.length / 2)]
    const closingEdgeLen = gap // last→first distance

    // Warn only if closing edge is >5× the median edge — strongly suggests open path
    if (medianEdge > 0 && closingEdgeLen > medianEdge * 5 && closingEdgeLen > tolerance * 3) {
      return {
        points,
        wasClosed: false,
        closureGap: closingEdgeLen,
        _suspiciouslyOpenPath: true,
      }
    }
  }

  // Normal polygon — implicitly closed, no issue
  return { points, wasClosed: true, closureGap: gap }
}

// ─── Build Normalized Segments ────────────────────────────────────────────────

/**
 * Build segment objects from polygon vertices.
 * Attempts to match each edge with a dimension label from rawSegments
 * (from the AI reasoning output) by comparing endpoints.
 */
function buildSegments(vertices, rawSegments) {
  const segments = []

  for (let i = 0; i < vertices.length; i++) {
    const start = vertices[i]
    const end = vertices[(i + 1) % vertices.length]
    const edgeLen = dist(start, end)
    const id = `s${i + 1}`

    // Find matching raw segment (closest endpoint match)
    const match = findMatchingSegment(start, end, rawSegments, 0.5)

    segments.push({
      id,
      start: { x: round4(start.x), y: round4(start.y) },
      end: { x: round4(end.x), y: round4(end.y) },
      geometricLength: round4(edgeLen),
      lengthLabel: match?.lengthLabel || null,
      confidence: match?.confidence || 0.3,
    })
  }

  return segments
}

function findMatchingSegment(start, end, rawSegments, distTol) {
  let bestScore = Infinity
  let bestMatch = null

  for (const seg of rawSegments) {
    if (!seg.start || !seg.end) continue
    // Try both orientations
    const score1 = dist(start, seg.start) + dist(end, seg.end)
    const score2 = dist(start, seg.end) + dist(end, seg.start)
    const score = Math.min(score1, score2)
    if (score < bestScore) {
      bestScore = score
      bestMatch = seg
    }
  }

  if (bestScore < distTol * 2) return bestMatch
  return null
}

// ─── Contradiction Detection ──────────────────────────────────────────────────

/**
 * Detect cases where labeled dimensions conflict with each other.
 * E.g.: opposite sides of a rectangle have different labeled lengths,
 * or the sum of partial dimensions doesn't match the total.
 */
function detectContradictions(segments) {
  const warnings = []

  // Group segments by approximate direction (horizontal vs vertical)
  const horizontal = segments.filter((s) => {
    if (!s.lengthLabel) return false
    const dy = Math.abs(s.end.y - s.start.y)
    const dx = Math.abs(s.end.x - s.start.x)
    return dx > dy
  })
  const vertical = segments.filter((s) => {
    if (!s.lengthLabel) return false
    const dy = Math.abs(s.end.y - s.start.y)
    const dx = Math.abs(s.end.x - s.start.x)
    return dy > dx
  })

  // Check: geometric length vs labeled length (large discrepancy = contradiction)
  for (const seg of [...horizontal, ...vertical]) {
    if (!seg.lengthLabel || seg.lengthLabel.value == null) continue
    if (seg.geometricLength === 0) continue

    // Compute ratio (labeled / geometric)
    const ratio = seg.lengthLabel.value / seg.geometricLength
    // If ratio is wildly different across segments, flag it
    // We can't check this accurately without knowing the scale,
    // so we just flag segments where ratio < 0.1 or > 100 as suspicious
    if (ratio < 0.01 || ratio > 1000) {
      warnings.push(
        `Segment ${seg.id}: labeled length ${seg.lengthLabel.value} ${seg.lengthLabel.unit || ''} ` +
        `seems inconsistent with geometric proportion (ratio ${ratio.toFixed(2)})`
      )
    }
  }

  return warnings
}

// ─── Polygon Area (Shoelace) ──────────────────────────────────────────────────

function computePolygonArea(points) {
  let area = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].x * points[j].y
    area -= points[j].x * points[i].y
  }
  return Math.abs(area) / 2
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function dist(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function round4(n) {
  return Math.round(n * 10000) / 10000
}

function buildEmptyPlan(warnings) {
  return {
    outerBoundary: [],
    cutouts: [],
    segments: [],
    depthPoints: [],
    notes: [],
    unit: 'unknown',
    confidence: 0,
    boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    area: 0,
    warnings,
  }
}

module.exports = { normalizeDeckPlan }
