/**
 * Stage 8 — Candidate polygon scoring.
 *
 * Each candidate polygon is scored using five heuristics.
 * The best candidate is the one most likely to be the deck boundary.
 *
 * Scoring components (weights sum to 1.0):
 *   area          0.30 — decks cover a significant fraction of the image
 *   orthogonality 0.25 — all edges should be exactly H or V
 *   regularity    0.15 — 4-12 edges is typical for a deck
 *   ocrCoverage   0.20 — how many dimension labels lie near this polygon's edges
 *   labelPlacement 0.10 — labels should sit on the correct side/orientation
 *   aspectRatio   0.05 — avoid extreme aspect ratios
 */

const EDGE_ASSOC_DIST = 0.12  // Normalised distance: label considered "near" edge

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * Score and sort candidates.
 *
 * @param {Array} candidates - from generateCandidates()
 * @param {Array} ocrItems   - from ocr.js
 * @returns {Array} Same candidates with .score and .scoreDetails, sorted desc
 */
function scoreCandidates(candidates, ocrItems) {
  const dims = (ocrItems || []).filter(i =>
    i.type === 'dimension' || (i.parsedValue != null && i.type !== 'depth')
  )

  return candidates
    .map(c => {
      const details = computeDetails(c, dims)
      const score =
        details.areaScore          * 0.30 +
        details.orthogonalityScore * 0.25 +
        details.regularityScore   * 0.15 +
        details.ocrCoverageScore  * 0.20 +
        details.labelPlacementScore * 0.10 +
        details.aspectRatioScore  * 0.05
      return { ...c, score: +score.toFixed(4), scoreDetails: details }
    })
    .sort((a, b) => b.score - a.score)
}

// ─── Score Components ─────────────────────────────────────────────────────────

function computeDetails(candidate, dims) {
  const { vertices, area, edgeCount } = candidate
  const edgeSegs = buildEdges(vertices)

  // ── Area ──────────────────────────────────────────────────────────────────
  // Sigmoid rises from 0 at small areas toward 1.0 at large areas (center=0.12).
  // A second sigmoid dampens candidates that nearly fill the whole image (> ~0.90)
  // since those are likely the graph's exterior face, not the actual deck boundary.
  const areaScore = sigmoid(area, 0.12, 20) * (1 - 0.5 * sigmoid(area, 0.90, 20))

  // ── Orthogonality ─────────────────────────────────────────────────────────
  // Fraction of edges within 5° of H or V
  const orthCount = edgeSegs.filter(e => {
    const dx = Math.abs(e.x2 - e.x1)
    const dy = Math.abs(e.y2 - e.y1)
    const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI
    return angleDeg < 5 || angleDeg > 85
  }).length
  const orthogonalityScore = edgeSegs.length > 0 ? orthCount / edgeSegs.length : 0

  // ── Regularity ────────────────────────────────────────────────────────────
  // Count actual direction changes (H→V or V→H turns) instead of raw vertex count.
  // A 13-vertex L-shape has only 6 turns — same as a "clean" 6-vertex L-shape.
  // This prevents penalising shapes that have intermediate intersection nodes
  // on otherwise straight edges.
  const cornerCount = countCorners(vertices)
  let regularityScore = 0
  if (cornerCount >= 4 && cornerCount <= 8)  regularityScore = 1.0
  else if (cornerCount > 8 && cornerCount <= 16) regularityScore = 1.0 - (cornerCount - 8) / 12
  else if (cornerCount < 4)                  regularityScore = 0

  // ── OCR coverage ──────────────────────────────────────────────────────────
  let associatedCount = 0
  for (const item of dims) {
    if (!item.bbox) continue
    const cx = item.bbox.x + item.bbox.w / 2
    const cy = item.bbox.y + item.bbox.h / 2
    const nearEdge = edgeSegs.some(e =>
      ptSegDist({ x: cx, y: cy }, { x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }) < EDGE_ASSOC_DIST
    )
    if (nearEdge) associatedCount++
  }
  const ocrCoverageScore = dims.length > 0 ? Math.min(1, associatedCount / dims.length) : 0.5
  const labelPlacementScore = computeLabelPlacementScore(candidate, dims)

  // ── Aspect ratio ──────────────────────────────────────────────────────────
  const xs = vertices.map(v => v.x)
  const ys = vertices.map(v => v.y)
  const bw = Math.max(...xs) - Math.min(...xs)
  const bh = Math.max(...ys) - Math.min(...ys)
  const aspect = bw > 0 && bh > 0 ? Math.max(bw / bh, bh / bw) : 10
  const aspectRatioScore = aspect <= 1 ? 1 : Math.max(0, 1 - (aspect - 1) / 9)

  return {
    areaScore:         +areaScore.toFixed(3),
    orthogonalityScore:+orthogonalityScore.toFixed(3),
    regularityScore:   +regularityScore.toFixed(3),
    ocrCoverageScore:  +ocrCoverageScore.toFixed(3),
    labelPlacementScore:+labelPlacementScore.toFixed(3),
    aspectRatioScore:  +aspectRatioScore.toFixed(3),
  }
}

function computeLabelPlacementScore(candidate, dims) {
  if (!Array.isArray(dims) || dims.length === 0) return 0.5

  const edges = buildEdges(candidate.vertices).map(edge => ({
    ...edge,
    len: Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1),
    isHorizontal: Math.abs(edge.x2 - edge.x1) >= Math.abs(edge.y2 - edge.y1),
  }))

  const xs = candidate.vertices.map(v => v.x)
  const ys = candidate.vertices.map(v => v.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(0.001, maxX - minX)
  const spanY = Math.max(0.001, maxY - minY)

  let total = 0
  let count = 0

  for (const item of dims) {
    if (!item.bbox) continue
    const cx = item.bbox.x + item.bbox.w / 2
    const cy = item.bbox.y + item.bbox.h / 2
    const wantHorizontal = item.measureDir === 'horizontal'
    const wantVertical = item.measureDir === 'vertical'

    const relevantEdges = edges.filter(edge => {
      if (wantHorizontal) return edge.isHorizontal
      if (wantVertical) return !edge.isHorizontal
      return true
    })
    if (relevantEdges.length === 0) continue

    const preferredSide = inferPreferredSide(item)
    let bestCost = Infinity

    for (const edge of relevantEdges) {
      const dist = ptSegDist({ x: cx, y: cy }, { x: edge.x1, y: edge.y1 }, { x: edge.x2, y: edge.y2 })
      const spanPenalty = edgeSpanPenalty(edge, cx, cy)
      const edgeSide = classifyEdgeSide(edge, minX, maxX, minY, maxY, spanX, spanY)
      const sidePenalty = preferredSide && edgeSide && preferredSide !== edgeSide ? 1.8 : 1.0
      const lengthBonus = 0.35 + Math.min(1, edge.len / 0.35)
      const cost = (dist * spanPenalty * sidePenalty) / lengthBonus
      if (cost < bestCost) bestCost = cost
    }

    total += Math.max(0, 1 - bestCost / 0.18)
    count++
  }

  return count > 0 ? total / count : 0.5
}

function inferPreferredSide(item) {
  if (!item?.bbox) return null
  const cx = item.bbox.x + item.bbox.w / 2
  const cy = item.bbox.y + item.bbox.h / 2

  if (item.measureDir === 'vertical') {
    if (cx <= 0.4) return 'left'
    if (cx >= 0.6) return 'right'
  }

  if (item.measureDir === 'horizontal') {
    if (cy <= 0.4) return 'top'
    if (cy >= 0.6) return 'bottom'
  }

  return null
}

function edgeSpanPenalty(edge, cx, cy) {
  if (edge.isHorizontal) {
    const min = Math.min(edge.x1, edge.x2)
    const max = Math.max(edge.x1, edge.x2)
    if (cx >= min && cx <= max) return 1
    return 1 + Math.min(1, Math.min(Math.abs(cx - min), Math.abs(cx - max)) / 0.08) * 3
  }

  const min = Math.min(edge.y1, edge.y2)
  const max = Math.max(edge.y1, edge.y2)
  if (cy >= min && cy <= max) return 1
  return 1 + Math.min(1, Math.min(Math.abs(cy - min), Math.abs(cy - max)) / 0.08) * 3
}

function classifyEdgeSide(edge, minX, maxX, minY, maxY, spanX, spanY) {
  const midX = (edge.x1 + edge.x2) / 2
  const midY = (edge.y1 + edge.y2) / 2
  const tolX = Math.max(0.03, spanX * 0.12)
  const tolY = Math.max(0.03, spanY * 0.12)

  if (edge.isHorizontal) {
    if (Math.abs(midY - minY) <= tolY) return 'top'
    if (Math.abs(midY - maxY) <= tolY) return 'bottom'
    return null
  }

  if (Math.abs(midX - minX) <= tolX) return 'left'
  if (Math.abs(midX - maxX) <= tolX) return 'right'
  return null
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Count the number of true direction changes (H→V or V→H corners) in a
 * rectilinear polygon. Intermediate nodes on a straight segment do not
 * count as corners, so a 13-vertex L-shape with 6 true corners returns 6.
 */
function countCorners(vertices) {
  if (vertices.length <= 3) return vertices.length
  let corners = 0
  for (let i = 0; i < vertices.length; i++) {
    const prev = vertices[(i - 1 + vertices.length) % vertices.length]
    const curr = vertices[i]
    const next = vertices[(i + 1) % vertices.length]
    const dx1 = curr.x - prev.x
    const dy1 = curr.y - prev.y
    const dx2 = next.x - curr.x
    const dy2 = next.y - curr.y
    const wasH = Math.abs(dx1) > Math.abs(dy1)
    const isH  = Math.abs(dx2) > Math.abs(dy2)
    if (wasH !== isH) corners++
  }
  return corners || vertices.length  // fallback to raw count if all collinear
}

function buildEdges(vertices) {
  return vertices.map((v, i) => {
    const n = vertices[(i + 1) % vertices.length]
    return { x1: v.x, y1: v.y, x2: n.x, y2: n.y }
  })
}

function ptSegDist(pt, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-12) return Math.hypot(pt.x - a.x, pt.y - a.y)
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2))
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy))
}

function sigmoid(x, center, k) {
  return 1 / (1 + Math.exp(-k * (x - center)))
}

module.exports = { scoreCandidates }
