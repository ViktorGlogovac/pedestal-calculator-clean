/**
 * OCR-to-geometry label association.
 *
 * Purpose: Spatially link OCR-detected text labels to the nearest geometric
 * element (segment, vertex, or area) so that dimensions can be attached to
 * the correct edge and depth values to the correct pedestal point.
 *
 * Association strategy (in priority order):
 *   1. Leader-line proximity: if a label is close to a line endpoint/start, prefer it
 *   2. Perpendicular distance: labels beside a segment are associated to that segment
 *   3. Orientation alignment: a label's text orientation should match the segment
 *   4. Proximity to vertex: depth/height labels near a corner → that vertex
 *   5. Nearest-only fallback: assign to closest candidate
 *
 * Ambiguity handling:
 *   - If two candidates score similarly (within AMBIGUITY_THRESHOLD), mark ambiguous
 *   - Include both candidates in the result for UI review
 *
 * All spatial reasoning uses normalised [0,1] image coordinates.
 * Distances are in normalised units.
 */

// ─── Tuning Constants ─────────────────────────────────────────────────────────

const MAX_ASSOCIATION_DIST = 0.55  // Labels farther than this are not associated
const AMBIGUITY_THRESHOLD  = 0.3   // Two candidates within this ratio are ambiguous
const PERPENDICULAR_WEIGHT = 2.0   // Perpendicular distance matters more than midpoint dist
const ORIENTATION_BONUS    = 0.5   // Score multiplier for matching orientation (< 1 = better)
const DIR_MISMATCH_PENALTY = 3.0   // Multiply score by this when measureDir contradicts seg orientation
const DEPTH_VERTEX_RADIUS  = 0.12  // Depth labels must be within this of a vertex

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * Associate OCR items with segments and vertices.
 *
 * @param {Array} ocrItems - From ocr.js: [{text, type, bbox: {x,y,w,h}, confidence, parsedValue, parsedUnit}]
 * @param {Array} segments - From normalize.js: [{id, start, end, geometricLength, lengthLabel, ...}]
 * @param {Array} vertices - Polygon vertices [{x, y}]
 * @returns {{
 *   enrichedSegments: Array,     // Segments with lengthLabel attached
 *   depthPoints: Array,          // Depth values associated to vertices
 *   unassociatedItems: Array,    // OCR items not confidently associated
 *   warnings: string[]
 * }}
 */
function associateLabels(ocrItems, segments, vertices) {
  const warnings = []
  const enrichedSegments = segments.map((s) => ({ ...s }))
  const depthPoints = []
  const unassociatedItems = []

  const dimensionItems = ocrItems.filter(
    (item) => (item.type === 'dimension' || (item.parsedValue != null && item.type !== 'depth')) && item.bbox
  )
  const depthItems = ocrItems.filter(
    (item) => item.type === 'depth' && item.bbox
  )
  const noteItems = ocrItems.filter(
    (item) => item.type === 'note' || (item.type === 'unknown' && item.bbox)
  )

  // ── Associate dimension labels to segments ──────────────────────────────────
  for (const item of dimensionItems) {
    const labelCenter = bboxCenter(item.bbox)
    const candidates = enrichedSegments.map((seg) => ({
      seg,
      score: segmentAssociationScore(labelCenter, seg, item),
    })).filter((c) => c.score < MAX_ASSOCIATION_DIST)

    if (candidates.length === 0) {
      unassociatedItems.push({ ...item, reason: 'No segment within association distance' })
      continue
    }

    candidates.sort((a, b) => a.score - b.score)
    const best = candidates[0]
    const secondBest = candidates[1]

    const isAmbiguous = secondBest && (secondBest.score / best.score) < (1 + AMBIGUITY_THRESHOLD)

    if (isAmbiguous) {
      warnings.push(
        `Dimension label "${item.text}" near (${fmt(labelCenter.x)}, ${fmt(labelCenter.y)}) ` +
        `is ambiguous — could map to ${best.seg.id} or ${secondBest.seg.id}. ` +
        `Assigned to ${best.seg.id} (better score). Manual check recommended.`
      )
    }

    // Attach the label to the best segment (prefer the one from AI if already attached)
    if (!best.seg.lengthLabel || best.seg.lengthLabel.confidence < (item.confidence || 0.5)) {
      best.seg.lengthLabel = {
        rawText: item.text,
        value: item.parsedValue != null ? item.parsedValue : null,
        unit: item.parsedUnit || null,
        confidence: item.confidence || 0.5,
      }
      best.seg.confidence = Math.max(best.seg.confidence || 0, (item.confidence || 0.5) * 0.9)
    }

    if (isAmbiguous) {
      best.seg._ambiguousCandidates = [best.seg.id, secondBest.seg.id]
    }
  }

  // ── Associate depth/height labels to vertices ────────────────────────────────
  for (const item of depthItems) {
    if (!item.bbox) continue
    const labelCenter = bboxCenter(item.bbox)

    // Find nearest vertex within radius
    let bestVertex = null
    let bestDist = DEPTH_VERTEX_RADIUS

    for (let i = 0; i < vertices.length; i++) {
      const d = euclidean(labelCenter, vertices[i])
      if (d < bestDist) {
        bestDist = d
        bestVertex = { index: i, ...vertices[i] }
      }
    }

    if (bestVertex) {
      depthPoints.push({
        id: `p${depthPoints.length + 1}`,
        position: { x: bestVertex.x, y: bestVertex.y },
        depthLabel: {
          rawText: item.text,
          value: item.parsedValue != null ? item.parsedValue : null,
          unit: item.parsedUnit || 'in',
          confidence: item.confidence || 0.5,
        },
        confidence: item.confidence || 0.5,
      })
    } else {
      // No vertex nearby — create a floating depth point at label position
      depthPoints.push({
        id: `p${depthPoints.length + 1}`,
        position: labelCenter,
        depthLabel: {
          rawText: item.text,
          value: item.parsedValue != null ? item.parsedValue : null,
          unit: item.parsedUnit || 'in',
          confidence: (item.confidence || 0.5) * 0.6,
        },
        confidence: (item.confidence || 0.5) * 0.6,
        _floating: true,
      })
      warnings.push(
        `Depth label "${item.text}" at (${fmt(labelCenter.x)}, ${fmt(labelCenter.y)}) ` +
        `has no vertex within ${DEPTH_VERTEX_RADIUS} units — stored as floating point`
      )
    }
  }

  // ── Collect note items ────────────────────────────────────────────────────────
  const notes = noteItems.map((item) => ({
    text: item.text,
    bbox: item.bbox,
    confidence: item.confidence || 0.4,
  }))

  // ── Collect truly unassociated items ─────────────────────────────────────────
  const associatedTexts = new Set(
    enrichedSegments
      .filter((s) => s.lengthLabel)
      .map((s) => s.lengthLabel.rawText)
  )

  for (const item of dimensionItems) {
    if (!associatedTexts.has(item.text)) {
      unassociatedItems.push({ ...item, reason: 'Confidence too low for any segment' })
    }
  }

  return {
    enrichedSegments,
    depthPoints,
    notes,
    unassociatedItems,
    warnings,
  }
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Compute an association score between a label and a segment.
 * Lower score = better match.
 *
 * Components:
 *   - Perpendicular distance from label center to segment line
 *   - Distance from label to segment midpoint (proximity)
 *   - Orientation alignment — heavily penalised when measureDir contradicts seg type
 */
function segmentAssociationScore(labelCenter, seg, item) {
  const { start, end } = seg

  // Perpendicular distance from label center to the infinite line through start→end
  const perpDist = pointToSegmentDistance(labelCenter, start, end)

  // Distance from label to segment midpoint (proximity)
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const midDist = euclidean(labelCenter, mid)

  const segAngle = Math.abs(Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI)
  const segIsHorizontal = segAngle < 30 || segAngle > 150

  let multiplier = 1.0

  // 1. Direction hint from vision OCR (strongest signal)
  if (item.measureDir === 'horizontal' && !segIsHorizontal) {
    multiplier *= DIR_MISMATCH_PENALTY  // H label should NOT go on V segment
  } else if (item.measureDir === 'vertical' && segIsHorizontal) {
    multiplier *= DIR_MISMATCH_PENALTY  // V label should NOT go on H segment
  } else if (
    (item.measureDir === 'horizontal' && segIsHorizontal) ||
    (item.measureDir === 'vertical'   && !segIsHorizontal)
  ) {
    multiplier *= ORIENTATION_BONUS     // Correct direction — reward
  }

  // 2. Bbox aspect ratio as a fallback orientation signal
  if (!item.measureDir && item.bbox) {
    const labelAspect = item.bbox.w / (item.bbox.h || 0.001)
    const labelIsHorizontal = labelAspect > 1.5
    if (segIsHorizontal === labelIsHorizontal) {
      multiplier *= ORIENTATION_BONUS
    }
  }

  const score = (perpDist * PERPENDICULAR_WEIGHT + midDist) * multiplier
  return score
}

/**
 * Perpendicular distance from a point to a line segment (clamped to segment).
 */
function pointToSegmentDistance(pt, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy

  if (len2 < 1e-12) return euclidean(pt, a)

  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2))
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return euclidean(pt, { x: projX, y: projY })
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function bboxCenter(bbox) {
  return { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }
}

function euclidean(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function fmt(n) {
  return typeof n === 'number' ? n.toFixed(3) : '?'
}

module.exports = { associateLabels }
