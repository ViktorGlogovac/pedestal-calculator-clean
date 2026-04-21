/**
 * Stage 5 — Deterministic segment classification.
 *
 * Labels each detected line segment with its most likely role in the drawing.
 * Uses rule-based scoring only — no ML, no AI.
 *
 * Classes (in priority order):
 *   structural_boundary  — actual deck perimeter edge
 *   dimension_line       — annotation line parallel+offset to a structural edge
 *   witness_line         — short perpendicular connectors at dimension ends
 *   notebook_line        — regular horizontal background lines from lined paper
 *   leader_line          — arrow/line pointing from text label to geometry
 *   noise                — short, weak, or isolated fragments
 *
 * Each segment receives:
 *   classScores    — score [0,1] for every class
 *   bestClass      — class with the highest score
 *   classConfidence — score of the best class
 */

// ─── Tuning constants ─────────────────────────────────────────────────────────

const MIN_STRUCTURAL_LEN    = 0.05   // Must be ≥ this fraction of max(W,H) to be structural
const MAX_TEXT_OVERLAP_STR  = 0.25   // Structural segments tolerate ≤ this text overlap
const PARALLEL_SEARCH_DIST  = 0.10   // Look for parallel neighbours within this distance
const PARALLEL_ANGLE_TOL    = 12     // Degrees — angles within this → parallel
const WITNESS_MAX_LEN       = 0.055  // Witness lines are short
const NOTEBOOK_FULL_WIDTH   = 0.60   // Spans ≥ this fraction of image width → possibly H-notebook
const NOTEBOOK_FULL_HEIGHT  = 0.65   // Spans ≥ this fraction of image height → possibly V-notebook
const NOTEBOOK_PERIOD_TOL   = 0.014  // Y/X cluster tolerance for periodicity detection
const MIN_NOTEBOOK_COUNT    = 5      // Need ≥ this many to declare a notebook pattern

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * Classify a set of line segments.
 *
 * @param {Array}  segments    - normalised line segments [{p1,p2,angle,length,votes}]
 * @param {Array}  textBoxes   - normalised text bboxes [{x,y,w,h}]
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {Array} segments augmented with classScores, bestClass, classConfidence
 */
function classifySegments(segments, textBoxes, imageWidth, imageHeight) {
  if (!segments || segments.length === 0) return []

  const boxes = textBoxes || []

  // Detect notebook y-values (horizontal lines) and x-values (vertical lines)
  const notebookYs = detectNotebookYValues(segments)
  const notebookXs = detectNotebookXValues(segments)

  // Compute features for every segment
  const featured = segments.map(seg => ({
    ...seg,
    _feat: computeFeatures(seg, segments, boxes, notebookYs, notebookXs),
  }))

  // Score and assign class
  return featured.map(seg => {
    const scores = scoreClasses(seg._feat)
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1])
    const [bestClass, classConfidence] = entries[0]
    // Clean up internal feature object
    const { _feat, ...rest } = seg
    return { ...rest, classScores: scores, bestClass, classConfidence }
  })
}

// ─── Feature computation ──────────────────────────────────────────────────────

function computeFeatures(seg, allSegs, textBoxes, notebookYs, notebookXs) {
  const len       = segLength(seg)
  const angle     = normaliseAngle(seg.angle ?? computeAngle(seg))
  const angleDev  = Math.min(angle, Math.abs(angle - 90), Math.abs(angle - 180))

  const textOverlap      = computeTextOverlap(seg, textBoxes)
  const endpointNearText = isEndpointNearText(seg, textBoxes, 0.07)

  const midY      = (seg.p1.y + seg.p2.y) / 2
  const midX      = (seg.p1.x + seg.p2.x) / 2
  const isNBY     = notebookYs.some(y => Math.abs(y - midY) < NOTEBOOK_PERIOD_TOL)
  const isNBX     = notebookXs.some(x => Math.abs(x - midX) < NOTEBOOK_PERIOD_TOL)
  const isFullW   = Math.abs(seg.p2.x - seg.p1.x) >= NOTEBOOK_FULL_WIDTH
  const isFullH   = Math.abs(seg.p2.y - seg.p1.y) >= NOTEBOOK_FULL_HEIGHT

  const parallelInfo       = findParallel(seg, allSegs)
  const hasStrongerParallel = parallelInfo !== null && parallelInfo.otherLen > len * 1.05

  // Strength proxy: longer + more votes → stronger
  const strength = Math.min(1, len / 0.18) * 0.6 + Math.min(1, (seg.votes || 1) / 6) * 0.4

  return {
    len,
    angleDev,
    isH: angle <= 20 || angle >= 160,
    isV: Math.abs(angle - 90) <= 20,
    textOverlap,
    endpointNearText,
    isNotebookY: isNBY,
    isNotebookX: isNBX,
    isFullWidth:  isFullW,
    isFullHeight: isFullH,
    parallelOffset: parallelInfo?.offset ?? null,
    hasParallel: parallelInfo !== null,
    hasStrongerParallel,
    strength,
  }
}

// ─── Class scoring ────────────────────────────────────────────────────────────

function scoreClasses(f) {
  return {
    structural_boundary: scoreStructural(f),
    dimension_line:      scoreDimension(f),
    witness_line:        scoreWitness(f),
    notebook_line:       scoreNotebook(f),
    leader_line:         scoreLeader(f),
    noise:               scoreNoise(f),
  }
}

function scoreStructural(f) {
  // Hard disqualifiers
  if (f.len < MIN_STRUCTURAL_LEN)                    return 0
  if (f.angleDev > 20)                               return 0
  if (f.isNotebookY && f.isFullWidth)                return 0
  if (f.isNotebookX && f.isFullHeight)               return 0  // Vertical notebook lines
  if (f.textOverlap > MAX_TEXT_OVERLAP_STR)          return 0

  let s = 0
  s += clamp(f.len / 0.18)       * 0.30   // Length: longer = more structural
  s += (1 - f.angleDev / 20)     * 0.20   // Orthogonality
  s += (1 - f.textOverlap)       * 0.15   // Low text overlap
  s += f.strength                 * 0.20   // Stroke strength
  if (!f.hasStrongerParallel)    s += 0.10  // No stronger parallel = not a dim line
  if (!f.endpointNearText)       s += 0.05  // Endpoints away from text

  return clamp(s)
}

function scoreDimension(f) {
  if (f.angleDev > 20)           return 0
  if (f.len < 0.025)             return 0
  if (f.isNotebookY && f.isFullWidth) return 0

  let s = 0
  if (f.endpointNearText)  s += 0.35
  if (f.hasParallel)       s += 0.25
  if (f.textOverlap > 0.05) s += 0.10
  s += clamp(f.len / 0.30)     * 0.15   // Medium length preferred
  if (f.len < 0.03 || f.len > 0.45) s *= 0.5

  return clamp(s)
}

function scoreWitness(f) {
  if (f.len > WITNESS_MAX_LEN)  return 0
  if (f.len < 0.006)            return 0
  if (f.angleDev > 20)          return 0

  let s = 0.20
  if (f.endpointNearText)  s += 0.30
  if (f.hasParallel && f.parallelOffset != null && f.parallelOffset < 0.04) s += 0.20
  if (f.textOverlap > 0.1) s += 0.10

  return clamp(s)
}

function scoreNotebook(f) {
  let s = 0

  if (f.isH) {
    // Horizontal notebook lines (ruled paper)
    if (f.isNotebookY) s += 0.55
    if (f.isFullWidth) s += 0.35
    if (f.textOverlap < 0.08) s += 0.10
  } else if (f.isV) {
    // Vertical notebook lines (column-ruled paper)
    if (f.isNotebookX) s += 0.55
    if (f.isFullHeight) s += 0.35
    if (f.textOverlap < 0.08) s += 0.10
  }

  return clamp(s)
}

function scoreLeader(f) {
  if (!f.endpointNearText) return 0
  if (f.len < 0.015 || f.len > 0.20) return 0

  let s = 0.25
  if (f.textOverlap > 0.1)    s += 0.20
  if (f.angleDev > 5)         s += 0.15  // Leaders often slightly off-orthogonal
  if (!f.hasStrongerParallel) s += 0.10

  return clamp(s)
}

function scoreNoise(f) {
  let s = 0
  if (f.len < 0.015) s += 0.55
  if (f.len < 0.008) s += 0.25
  if ((f.seg?.votes ?? 1) <= 1 && f.len < 0.04) s += 0.15
  if (f.textOverlap > 0.60) s += 0.20

  return clamp(s)
}

// ─── Notebook Y-value detection ───────────────────────────────────────────────

function detectNotebookYValues(segments) {
  const longH = segments.filter(s => {
    const angle = normaliseAngle(s.angle ?? computeAngle(s))
    const isH   = angle <= 20 || angle >= 160
    const wid   = Math.abs(s.p2.x - s.p1.x)
    return isH && wid >= NOTEBOOK_FULL_WIDTH
  })

  if (longH.length < MIN_NOTEBOOK_COUNT) return []

  const ys = longH.map(s => (s.p1.y + s.p2.y) / 2).sort((a, b) => a - b)
  const gaps = []
  for (let i = 1; i < ys.length; i++) gaps.push(ys[i] - ys[i - 1])
  if (gaps.length === 0) return []

  const sorted = [...gaps].sort((a, b) => a - b)
  const med    = sorted[Math.floor(sorted.length / 2)]
  if (med < 0.008 || med > 0.12) return []

  const variance = gaps.reduce((s, g) => s + (g - med) ** 2, 0) / gaps.length
  if (Math.sqrt(variance) > med * 0.45) return []  // Not regular enough

  return ys
}

/**
 * Detect x-coordinates of regularly-spaced vertical lines (column-ruled paper).
 * Mirror of detectNotebookYValues but for vertical lines.
 */
function detectNotebookXValues(segments) {
  const longV = segments.filter(s => {
    const angle = normaliseAngle(s.angle ?? computeAngle(s))
    const isV   = Math.abs(angle - 90) <= 20
    const ht    = Math.abs(s.p2.y - s.p1.y)
    return isV && ht >= NOTEBOOK_FULL_HEIGHT
  })

  if (longV.length < MIN_NOTEBOOK_COUNT) return []

  const xs = longV.map(s => (s.p1.x + s.p2.x) / 2).sort((a, b) => a - b)
  const gaps = []
  for (let i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1])
  if (gaps.length === 0) return []

  const sorted = [...gaps].sort((a, b) => a - b)
  const med    = sorted[Math.floor(sorted.length / 2)]
  if (med < 0.008 || med > 0.12) return []

  const variance = gaps.reduce((s, g) => s + (g - med) ** 2, 0) / gaps.length
  if (Math.sqrt(variance) > med * 0.45) return []  // Not regular enough

  return xs
}

// ─── Spatial helpers ──────────────────────────────────────────────────────────

function computeTextOverlap(seg, textBoxes) {
  if (textBoxes.length === 0) return 0
  const STEPS = 20
  let inText = 0
  for (let t = 0; t <= STEPS; t++) {
    const frac = t / STEPS
    const px = seg.p1.x + frac * (seg.p2.x - seg.p1.x)
    const py = seg.p1.y + frac * (seg.p2.y - seg.p1.y)
    if (textBoxes.some(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h)) {
      inText++
    }
  }
  return inText / (STEPS + 1)
}

function isEndpointNearText(seg, textBoxes, radius) {
  for (const ep of [seg.p1, seg.p2]) {
    for (const b of textBoxes) {
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      if (Math.hypot(ep.x - cx, ep.y - cy) < radius) return true
    }
  }
  return false
}

function findParallel(seg, allSegs) {
  const a1  = normaliseAngle(seg.angle ?? computeAngle(seg))
  const mid = { x: (seg.p1.x + seg.p2.x) / 2, y: (seg.p1.y + seg.p2.y) / 2 }
  const len = segLength(seg)

  for (const other of allSegs) {
    if (other === seg) continue
    const a2   = normaliseAngle(other.angle ?? computeAngle(other))
    let diff   = Math.abs(a1 - a2)
    if (diff > 90) diff = 180 - diff
    if (diff > PARALLEL_ANGLE_TOL) continue

    const omid = { x: (other.p1.x + other.p2.x) / 2, y: (other.p1.y + other.p2.y) / 2 }
    const dist = Math.hypot(mid.x - omid.x, mid.y - omid.y)
    if (dist < PARALLEL_SEARCH_DIST && dist > 0.005) {
      return { offset: dist, otherLen: segLength(other) }
    }
  }
  return null
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function segLength(seg) {
  return Math.hypot(seg.p2.x - seg.p1.x, seg.p2.y - seg.p1.y)
}

function computeAngle(seg) {
  return Math.atan2(seg.p2.y - seg.p1.y, seg.p2.x - seg.p1.x) * 180 / Math.PI
}

function normaliseAngle(deg) {
  return ((deg % 180) + 180) % 180
}

function clamp(v) { return Math.max(0, Math.min(1, v)) }

module.exports = { classifySegments }
