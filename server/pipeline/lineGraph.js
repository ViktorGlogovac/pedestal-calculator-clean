/**
 * Stage 3 — Line graph construction.
 *
 * Converts detected line segments into a geometric graph:
 *   nodes = intersection and endpoint coordinates
 *   edges = H or V segment pairs connecting nodes
 *
 * Algorithm:
 *   1. Classify lines as H (near 0°/180°) or V (near 90°/270°)
 *   2. Cluster H-lines by y-coordinate → "levels"
 *   3. Cluster V-lines by x-coordinate → "columns"
 *   4. Merge overlapping/nearby ranges within each cluster
 *   5. Compute intersections between levels and columns
 *   6. Split each range at intersection points → graph edges
 *   7. Return { nodes, edges, hLevels, vColumns }
 *
 * Adaptive retry: if the first pass produces fewer than 4 nodes, the
 * pipeline retries with a relaxed EXTEND_TOL to bridge larger corner gaps
 * common in hand-drawn sketches where lines don't quite meet.
 *
 * All coordinates are in normalised [0,1] image space.
 */

// ─── Base Tolerances ──────────────────────────────────────────────────────────

const ORTHOGONAL_THRESHOLD = 15   // Snap lines within 15° of H or V; discard rest
const LEVEL_TOL   = 0.025         // H-lines within this Δy → same level
const COLUMN_TOL  = 0.025         // V-lines within this Δx → same column
const EXTEND_TOL  = 0.22          // How far a perpendicular line can fall short and
                                  // still get an intersection (bridges corner gaps).
                                  // 0.22 bridges inner-step gaps up to ~0.19 in
                                  // normalised coords (common when the inner V-column
                                  // ends ~0.17 before the bottom H-level, even after
                                  // the adaptive GAP_BRIDGE is applied).
                                  // LEVEL_TOL/COLUMN_TOL (0.025) still prevent
                                  // unrelated parallel lines from merging.
const GAP_BRIDGE  = 0.030         // Extend each range by this to bridge small gaps
const MIN_SEG_LEN = 0.025         // Discard INPUT segments shorter than this
const MIN_EDGE_LEN = 0.003        // Skip graph edges shorter than this (near-duplicate split points)

// Relaxed tolerances used on retry when the first pass yields < 4 nodes
const EXTEND_TOL_RELAXED = 0.35
const GAP_BRIDGE_RELAXED = 0.060

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * Build a rectilinear line graph from raw detected line segments.
 * Automatically retries with relaxed tolerances if the first pass yields
 * too few nodes to form any polygon candidate.
 *
 * @param {Array} rawLines - [{p1:{x,y}, p2:{x,y}, angle, length}]
 * @returns {{ nodes, edges, hLevels, vColumns, relaxedTolUsed }}
 */
function buildLineGraph(rawLines) {
  // Compute adaptive GAP_BRIDGE from median line length so the graph
  // self-calibrates to the sketch scale (zoomed-in vs zoomed-out).
  const adaptiveGap = computeAdaptiveGap(rawLines)

  const first = buildLineGraphCore(rawLines, EXTEND_TOL, LEVEL_TOL, COLUMN_TOL, adaptiveGap)

  // Retry with relaxed tolerances when the graph is too sparse to form an L-shape
  // (an L-shape needs ≥8 nodes; raise threshold so inner-step gaps trigger retry)
  if (first.nodes.length < 8 || first.edges.length < 8) {
    const relaxed = buildLineGraphCore(
      rawLines,
      EXTEND_TOL_RELAXED,
      LEVEL_TOL,
      COLUMN_TOL,
      Math.max(adaptiveGap, GAP_BRIDGE_RELAXED)
    )
    if (relaxed.nodes.length >= first.nodes.length) {
      return { ...relaxed, relaxedTolUsed: true }
    }
  }

  return { ...first, relaxedTolUsed: false }
}

/**
 * Compute a data-driven gap bridge size: 8% of median line length,
 * clamped to a sensible range.
 */
function computeAdaptiveGap(rawLines) {
  if (rawLines.length === 0) return GAP_BRIDGE
  const lengths = rawLines
    .map(l => Math.hypot(l.p2.x - l.p1.x, l.p2.y - l.p1.y))
    .sort((a, b) => a - b)
  const median = lengths[Math.floor(lengths.length / 2)]
  return Math.max(0.015, Math.min(0.06, median * 0.08))
}

// ─── Core Graph Builder ───────────────────────────────────────────────────────

function buildLineGraphCore(rawLines, extendTol, levelTol, columnTol, gapBridge) {
  const hLines = []
  const vLines = []

  for (const l of rawLines) {
    const angle = ((l.angle % 180) + 180) % 180  // [0, 180)
    const isH = angle <= ORTHOGONAL_THRESHOLD || angle >= 180 - ORTHOGONAL_THRESHOLD
    const isV = Math.abs(angle - 90) <= ORTHOGONAL_THRESHOLD

    if (!isH && !isV) continue

    if (isH) {
      const y  = (l.p1.y + l.p2.y) / 2
      const x1 = Math.min(l.p1.x, l.p2.x)
      const x2 = Math.max(l.p1.x, l.p2.x)
      if (x2 - x1 >= MIN_SEG_LEN) hLines.push({ y, x1, x2 })
    } else {
      const x  = (l.p1.x + l.p2.x) / 2
      const y1 = Math.min(l.p1.y, l.p2.y)
      const y2 = Math.max(l.p1.y, l.p2.y)
      if (y2 - y1 >= MIN_SEG_LEN) vLines.push({ x, y1, y2 })
    }
  }

  const hLevels  = clusterByCoord(hLines, 'y',  'x1', 'x2', levelTol,  gapBridge)
  const vColumns = clusterByCoord(vLines, 'x',  'y1', 'y2', columnTol, gapBridge)

  // Build node registry
  let nodeId = 0
  const nodeMap = new Map()
  const nodes   = []

  function getNode(x, y) {
    const key = `${r4(x)},${r4(y)}`
    if (!nodeMap.has(key)) {
      const n = { id: nodeId++, x: r4(x), y: r4(y) }
      nodeMap.set(key, n)
      nodes.push(n)
    }
    return nodeMap.get(key)
  }

  let edgeId = 0
  const edges = []

  // H-level edges: split each H-range at the x-coords of intersecting V-columns
  for (const level of hLevels) {
    for (const range of level.ranges) {
      const intersectXs = vColumns
        .filter(col =>
          col.coord >= range.start - extendTol &&
          col.coord <= range.end   + extendTol
        )
        .filter(col =>
          col.ranges.some(r =>
            r.start <= level.coord + extendTol &&
            r.end   >= level.coord - extendTol
          )
        )
        .map(col => col.coord)

      const xPts = unique([
        range.start, range.end,
        ...intersectXs.filter(x => x >= range.start - extendTol && x <= range.end + extendTol),
      ].map(r4))

      for (let i = 0; i < xPts.length - 1; i++) {
        if (xPts[i + 1] - xPts[i] < MIN_EDGE_LEN) continue
        const from = getNode(xPts[i],     level.coord)
        const to   = getNode(xPts[i + 1], level.coord)
        edges.push({ id: edgeId++, fromId: from.id, toId: to.id, horizontal: true })
      }
    }
  }

  // V-column edges: split each V-range at the y-coords of intersecting H-levels
  for (const col of vColumns) {
    for (const range of col.ranges) {
      const intersectYs = hLevels
        .filter(level =>
          level.coord >= range.start - extendTol &&
          level.coord <= range.end   + extendTol
        )
        .filter(level =>
          level.ranges.some(r =>
            r.start <= col.coord + extendTol &&
            r.end   >= col.coord - extendTol
          )
        )
        .map(level => level.coord)

      const yPts = unique([
        range.start, range.end,
        ...intersectYs.filter(y => y >= range.start - extendTol && y <= range.end + extendTol),
      ].map(r4))

      for (let i = 0; i < yPts.length - 1; i++) {
        if (yPts[i + 1] - yPts[i] < MIN_EDGE_LEN) continue
        const from = getNode(col.coord, yPts[i])
        const to   = getNode(col.coord, yPts[i + 1])
        edges.push({ id: edgeId++, fromId: from.id, toId: to.id, horizontal: false })
      }
    }
  }

  return { nodes, edges: deduplicateEdges(edges), hLevels, vColumns }
}

// ─── Cluster + Merge ──────────────────────────────────────────────────────────

function clusterByCoord(lines, coordKey, rangeStartKey, rangeEndKey, coordTol, gapBridge) {
  if (lines.length === 0) return []

  const sorted = [...lines].sort((a, b) => a[coordKey] - b[coordKey])
  const clusters = [[sorted[0]]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = clusters[clusters.length - 1]
    if (Math.abs(sorted[i][coordKey] - prev[prev.length - 1][coordKey]) <= coordTol) {
      prev.push(sorted[i])
    } else {
      clusters.push([sorted[i]])
    }
  }

  return clusters.map(cluster => {
    const totalLen = cluster.reduce((s, l) => s + (l[rangeEndKey] - l[rangeStartKey]), 0)
    const coord = totalLen > 0
      ? cluster.reduce((s, l) => s + l[coordKey] * (l[rangeEndKey] - l[rangeStartKey]), 0) / totalLen
      : cluster.reduce((s, l) => s + l[coordKey], 0) / cluster.length

    const ranges = mergeRanges(
      cluster.map(l => ({ start: l[rangeStartKey] - gapBridge, end: l[rangeEndKey] + gapBridge }))
    )

    return { coord: r4(coord), ranges }
  })
}

function mergeRanges(intervals) {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged = [{ start: sorted[0].start, end: sorted[0].end }]

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end)
    } else {
      merged.push({ start: sorted[i].start, end: sorted[i].end })
    }
  }
  return merged
}

function deduplicateEdges(edges) {
  const seen = new Set()
  return edges.filter(e => {
    const key = `${Math.min(e.fromId, e.toId)}-${Math.max(e.fromId, e.toId)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function r4(n) { return Math.round(n * 10000) / 10000 }
function unique(arr) { return [...new Set(arr)].sort((a, b) => a - b) }

module.exports = { buildLineGraph }
