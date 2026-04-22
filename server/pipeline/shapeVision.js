const fs = require('fs')
const path = require('path')
const { repairRawDeckPlan } = require('../models/schema')
const { callCodexCli, messagesToPrompt, parseJsonObject } = require('./codexCli')

const POLYGON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['unit', 'outerBoundary', 'confidence', 'warnings'],
  properties: {
    unit: { type: 'string' },
    outerBoundary: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
        },
      },
    },
    confidence: { type: 'number' },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
  },
}

async function extractShapeVision(imagePath, userNotes = '', ocrItems = []) {
  if (!imagePath || !fs.existsSync(imagePath)) return null

  const ext = path.extname(imagePath).slice(1).toLowerCase()
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
  const base64 = ''

  const ocrHintText = summarizeOcrHints(ocrItems)

  const step1Messages = [
    {
      role: 'system',
      content:
        'You are reading a sketch of a hand-drawn deck plan. It may be preprocessed, but faint ruled-paper lines, text boxes, and dimension callout fragments may still remain. The image may be rotated or held sideways in the original photo.\n' +
        'Your job: extract ONLY the outer perimeter polygon.\n\n' +
        'Rules:\n' +
        '1. Ignore faint evenly spaced notebook/background lines even if they survived preprocessing.\n' +
        '2. Ignore arrows, witness lines, dimension tick marks, text boxes, and tiny staircase artefacts from hand drawing.\n' +
        '3. The labeled dimensions are ground truth. Trust the numbers over the drawn outline when they conflict.\n' +
        '4. ORIENTATION: Use the OCR label positions to determine which dimensions are horizontal vs vertical.\n' +
        '   - A label sitting on the LEFT or RIGHT side of the image (image-x < 0.25 or > 0.75) measures a VERTICAL height.\n' +
        '   - A label sitting near the TOP or BOTTOM of the image (image-y < 0.20 or > 0.80) measures a HORIZONTAL width.\n' +
        '   - The largest vertical label is the overall HEIGHT of the deck. The largest horizontal label is the overall WIDTH.\n' +
        '   - If the deck is taller than wide, the first segment in your clockwise walk should be a short HORIZONTAL (the width), not the long vertical.\n' +
        '5. List each segment as: RIGHT/LEFT/UP/DOWN <distance> <unit> (e.g. "RIGHT 5 m").\n' +
        '6. Preserve units exactly as written. Do NOT convert units.\n' +
        '7. Start at the top-left outer corner of the DECK (not the page) and walk clockwise.\n' +
        '8. Trace EVERY corner faithfully — notches, steps, and cutouts are real architectural features even if they are small (e.g. 1m on a 20m deck).\n' +
        '   Only combine consecutive steps if they are clearly the same direction due to a shaky hand (e.g. RIGHT 0.05m RIGHT 0.03m).\n' +
        '   Do NOT combine a RIGHT then DOWN then RIGHT into a single RIGHT — that is a notch.\n' +
        '9. Do NOT create diagonal edges for a rectilinear deck. If a photographed vertical side is slightly slanted, output it as UP/DOWN, not as a diagonal.\n' +
        (userNotes ? `User notes: "${userNotes}"\n` : ''),
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'Step 1 — Determine orientation:\n' +
            'Look at the OCR hints below. Identify which label is the overall HEIGHT (vertical) and which is the WIDTH (horizontal) of the deck.\n' +
            'State: "ORIENTATION: deck is [TALLER/WIDER]. Height = X m, Width = Y m."\n\n' +
            'Step 2 — Trace the perimeter clockwise from the top-left corner of the deck.\n' +
            'Output one segment per line. Trace ALL corners — complex shapes with notches may need 10-20 segments.\n' +
            'Do NOT skip notch corners to keep the count low.\n\n' +
            'OCR hints (image coords range 0..1, likely= inferred direction):\n' +
            `${ocrHintText}\n\n` +
            'After the walk, list uncertain dimensions under "UNCERTAIN:".',
        },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
      ],
    },
  ]

  const step1 = await callCodexCli({
    imagePath,
    prompt: messagesToPrompt(step1Messages),
  })

  console.log('[shapeVision] step1 walk:\n', step1)

  // ── Step 2: deterministic walk parser (no LLM — LLM steps 2 and 3 were
  //   collapsing complex shapes to rectangles).  Parse "RIGHT/LEFT/UP/DOWN
  //   <distance> <unit>" lines directly into polygon coordinates.
  let parsed = parseWalkToPolygon(step1)
  console.log('[shapeVision] deterministic parse corners:', parsed?.outerBoundary?.length ?? 0)

  // Fall back to a single Codex CLI JSON conversion only if the deterministic
  // parser couldn't extract enough segments (e.g. walk text was malformed).
  if (!parsed || parsed.outerBoundary.length < 4) {
    console.log('[shapeVision] deterministic parse failed — trying Codex CLI JSON fallback')
    const jsonFallbackMessages = [
      {
        role: 'system',
        content:
          'Convert this perimeter walk into a JSON polygon. ' +
          'RIGHT increases x, DOWN increases y, origin (0,0) at top-left. ' +
          'Preserve EVERY corner — do NOT simplify or reduce. ' +
          'Output JSON only: {"unit":"m","outerBoundary":[{"x":0,"y":0},...]}',
      },
      {
        role: 'user',
        content: `Walk:\n${step1}`,
      },
    ]
    const jsonFallback = await callCodexCli({
      outputSchema: POLYGON_SCHEMA,
      prompt: messagesToPrompt(jsonFallbackMessages),
    })
    console.log('[shapeVision] Codex CLI JSON fallback:\n', jsonFallback)
    parsed = parseJsonObject(jsonFallback)
  }

  if (!parsed || !Array.isArray(parsed.outerBoundary) || parsed.outerBoundary.length < 4) {
    console.log('[shapeVision] all parse attempts failed — returning null')
    return null
  }
  console.log('[shapeVision] final corners:', parsed.outerBoundary.length, JSON.stringify(parsed.outerBoundary))

  // Force all edges to be purely horizontal or vertical.
  // The vision model sometimes produces slightly skewed edges (e.g. from (0,0) to (1,6)
  // instead of (0,0) to (0,6)) which appear as diagonals on the canvas.
  // This must run before the orientation check so that the bounding box
  // used by maybeRotate90 is axis-aligned.
  parsed = forceOrthogonal(parsed)

  // Merge consecutive same-direction edges that forceOrthogonal or step3 left
  // as separate collinear segments (e.g. RIGHT 3 then RIGHT 4 → RIGHT 7).
  // Also removes intermediate collinear vertices introduced by staircase collapse.
  parsed = mergeCollinearEdges(parsed)

  // Deterministic orientation check: if the polygon is wider than it is tall,
  // but the evidence says the deck should be taller than wide, rotate 90° CCW.
  // We use the step1 reasoning text as the primary signal (the model states
  // "ORIENTATION: deck is TALLER/WIDER" explicitly), falling back to OCR bbox
  // positions if the step1 statement is absent.
  parsed = maybeRotate90(parsed, ocrItems, step1)

  const rawPlan = repairRawDeckPlan({
    unit: normalizeOutputUnit(parsed.unit),
    outerBoundary: parsed.outerBoundary,
    cutouts: [],
    segments: buildSegments(parsed.outerBoundary),
    depthPoints: [],
    notes: [
      {
        text: 'Shape fallback generated by Codex CLI perimeter reasoning',
        confidence: 0.6,
      },
    ],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.55,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
  })

  rawPlan._alreadyScaled = true
  rawPlan._visionTrace = step1
  return rawPlan
}

function buildSegments(points) {
  return points.map((start, i) => {
    const end = points[(i + 1) % points.length]
    return {
      id: `s${i + 1}`,
      start,
      end,
      geometricLength: Math.hypot(end.x - start.x, end.y - start.y),
      lengthLabel: null,
      inferred: true,
      confidence: 0.5,
    }
  })
}

function normalizeOutputUnit(unit) {
  if (!unit) return 'ft'
  const s = String(unit).toLowerCase()
  if (s === 'feet' || s === 'foot' || s === 'ft') return 'ft'
  if (s === 'meters' || s === 'meter' || s === 'metres' || s === 'metre' || s === 'm') return 'm'
  if (s === 'inches' || s === 'inch' || s === 'in') return 'in'
  return 'ft'
}

/**
 * Parse a Codex CLI perimeter walk ("RIGHT 6 m", "DOWN 20 m", ...) directly into
 * polygon coordinates.  This is deterministic — no LLM involvement — so it
 * preserves every corner exactly as stated in the walk without any simplification.
 *
 * Handles:
 *   - "RIGHT 6 m" / "DOWN 20m"
 *   - Feet-inch notation: "RIGHT 31'6\""
 *   - Lines with extra text before/after the direction word
 */
function parseWalkToPolygon(walkText) {
  const lines = String(walkText || '').split('\n')
  const segments = []
  let unit = null

  for (const line of lines) {
    // Match direction + distance + optional unit on same line
    const m = line.match(/\b(RIGHT|LEFT|UP|DOWN)\s+([\d]+(?:['.]\s*[\d]+"?)?(?:\.\d+)?)\s*(m(?:eters?)?|ft|feet|['"])?/i)
    if (!m) continue

    const dir = m[1].toUpperCase()
    const rawDist = m[2].trim()
    const rawUnit = (m[3] || '').toLowerCase().replace(/\s/g, '')

    // Detect unit
    if (!unit) {
      if (rawUnit.startsWith('m')) unit = 'm'
      else if (rawUnit === 'ft' || rawUnit === 'feet' || rawUnit === "'") unit = 'ft'
    }

    // Parse value — handle feet-inch "31'6"" and plain numbers
    let value
    const feetInchMatch = rawDist.match(/^(\d+)'\s*(\d+)"?$/)
    const feetOnlyMatch = rawDist.match(/^(\d+)'$/)
    if (feetInchMatch) {
      value = parseInt(feetInchMatch[1]) + parseInt(feetInchMatch[2]) / 12
      if (!unit) unit = 'ft'
    } else if (feetOnlyMatch) {
      value = parseFloat(feetOnlyMatch[1])
      if (!unit) unit = 'ft'
    } else {
      value = parseFloat(rawDist)
    }

    if (isNaN(value) || value <= 0) continue
    segments.push({ dir, value })
  }

  if (segments.length < 4) return null

  // Accumulate absolute coordinates
  let x = 0, y = 0
  const pts = [{ x: 0, y: 0 }]
  for (const seg of segments) {
    if      (seg.dir === 'RIGHT') x += seg.value
    else if (seg.dir === 'LEFT')  x -= seg.value
    else if (seg.dir === 'DOWN')  y += seg.value
    else if (seg.dir === 'UP')    y -= seg.value
    pts.push({ x: +x.toFixed(3), y: +y.toFixed(3) })
  }

  // Drop closing point if it duplicates the first
  const first = pts[0], last = pts[pts.length - 1]
  if (Math.abs(first.x - last.x) < 0.01 && Math.abs(first.y - last.y) < 0.01) pts.pop()

  // Normalize so min x/y = 0
  const minX = Math.min(...pts.map(p => p.x))
  const minY = Math.min(...pts.map(p => p.y))
  const normalized = pts.map(p => ({ x: +(p.x - minX).toFixed(3), y: +(p.y - minY).toFixed(3) }))

  if (normalized.length < 4) return null
  return { unit: unit || 'ft', outerBoundary: normalized, confidence: 0.7 }
}

module.exports = { extractShapeVision }

/**
 * Detect and correct a 90° orientation error in a vision-generated polygon.
 *
 * Vision models can produce a landscape polygon for portrait sketches.
 * We detect this by checking whether the polygon is wider than tall, then
 * confirm it should be portrait using two signals (in priority order):
 *
 *   1. step1 reasoning text — the model explicitly states
 *      "ORIENTATION: deck is TALLER" or "ORIENTATION: deck is WIDER"
 *   2. OCR bbox positions — labels at cx < 0.25 or cx > 0.75 measure
 *      vertical heights; labels at cy < 0.20 or cy > 0.80 measure widths.
 *
 * If the polygon is wider than tall AND the evidence says it should be
 * taller than wide, rotate 90° CCW: (x,y) → (maxY − y, x).
 */
function maybeRotate90(parsedPlan, ocrItems, step1Text) {
  const pts = parsedPlan.outerBoundary
  if (!pts || pts.length < 4) return parsedPlan

  const xs = pts.map(p => p.x)
  const ys = pts.map(p => p.y)
  const polyW = Math.max(...xs) - Math.min(...xs)
  const polyH = Math.max(...ys) - Math.min(...ys)

  // Already portrait or square — no rotation needed.
  if (polyH >= polyW) return parsedPlan

  // ── Signal 1: explicit orientation statement in step1 reasoning ────────────
  // The model is prompted to write "ORIENTATION: deck is TALLER" or "WIDER".
  // This is the most reliable signal because it comes from the model reading the
  // actual sketch — no dependence on OCR bbox accuracy.
  const orientMatch = String(step1Text || '').match(/ORIENTATION[^:]*:\s*deck\s+is\s+(TALLER|WIDER|PORTRAIT|LANDSCAPE)/i)
  if (orientMatch) {
    const word = orientMatch[1].toUpperCase()
    const shouldBeTaller = word === 'TALLER' || word === 'PORTRAIT'
    if (shouldBeTaller) return applyRotate90ccw(parsedPlan)
    // Explicitly WIDER/LANDSCAPE → polygon is already correct.
    return parsedPlan
  }

  // ── Signal 2: OCR label bbox positions ─────────────────────────────────────
  // Fall back to heuristic position analysis when step1 has no orientation line.
  let maxVertical = 0
  let maxHorizontal = 0

  for (const item of (ocrItems || [])) {
    const val = item.parsedValue
    if (val == null || val <= 0) continue
    const cx = item.bbox ? item.bbox.x + item.bbox.w / 2 : 0.5
    const cy = item.bbox ? item.bbox.y + item.bbox.h / 2 : 0.5

    if (cx < 0.25 || cx > 0.75) maxVertical  = Math.max(maxVertical,  val)
    else if (cy < 0.20 || cy > 0.80) maxHorizontal = Math.max(maxHorizontal, val)
  }

  if (maxVertical > 0 && maxHorizontal > 0 && maxVertical > maxHorizontal) {
    return applyRotate90ccw(parsedPlan)
  }

  return parsedPlan
}

/**
 * Snap every edge of a vision polygon to be purely horizontal or vertical.
 *
 * Vision models sometimes return slightly off-axis coordinates (e.g. going from
 * (0,0) to (1.2, 6) instead of a clean (0, 6) vertical), producing visible
 * diagonal sides on the canvas.
 *
 * Algorithm: walk the polygon edge by edge. For each edge decide whether it
 * is "more horizontal" (|dx| >= |dy|) or "more vertical" (|dy| > |dx|), then
 * snap the destination vertex so that the non-dominant component equals the
 * source vertex's value. This preserves the dominant dimension exactly.
 *
 * The closing edge is handled by adjusting the first vertex after the walk
 * so that the last edge also closes orthogonally.
 */
function forceOrthogonal(parsedPlan) {
  const pts = parsedPlan.outerBoundary
  if (!pts || pts.length < 4) return parsedPlan

  // Check if there are any non-axis-aligned edges at all.
  const hasSkew = pts.some((p, i) => {
    const n = pts[(i + 1) % pts.length]
    const dx = Math.abs(n.x - p.x)
    const dy = Math.abs(n.y - p.y)
    // Both dx and dy are non-trivial → diagonal edge
    return dx > 0.01 && dy > 0.01
  })
  if (!hasSkew) return parsedPlan

  // Walk forward snapping each destination vertex.
  const result = [{ x: +pts[0].x.toFixed(3), y: +pts[0].y.toFixed(3) }]
  for (let i = 1; i < pts.length; i++) {
    const prev = result[result.length - 1]
    const curr = pts[i]
    const dx = Math.abs(curr.x - prev.x)
    const dy = Math.abs(curr.y - prev.y)
    if (dx >= dy) {
      // Horizontal edge — lock y to previous vertex
      result.push({ x: +curr.x.toFixed(3), y: prev.y })
    } else {
      // Vertical edge — lock x to previous vertex
      result.push({ x: prev.x, y: +curr.y.toFixed(3) })
    }
  }

  // The closing edge connects result[last] back to result[0].
  // For the polygon to close orthogonally the last vertex must share either
  // x or y with the first vertex.  Adjust the last vertex to enforce this:
  // choose whichever axis (x or y) has the smaller correction needed.
  const first = result[0]
  const last  = result[result.length - 1]
  const fixX  = Math.abs(last.x - first.x)
  const fixY  = Math.abs(last.y - first.y)
  if (fixX > 0.01 && fixY > 0.01) {
    // Neither axis is already aligned — pick the smaller correction
    if (fixX <= fixY) {
      result[result.length - 1] = { x: first.x, y: last.y }
    } else {
      result[result.length - 1] = { x: last.x, y: first.y }
    }
  }

  // Remove any degenerate (zero-length) edges introduced by the snapping.
  const deduped = result.filter((p, i) => {
    const n = result[(i + 1) % result.length]
    return Math.abs(p.x - n.x) > 0.001 || Math.abs(p.y - n.y) > 0.001
  })

  if (deduped.length < 4) return parsedPlan
  return { ...parsedPlan, outerBoundary: deduped }
}

/**
 * Remove intermediate vertices where two consecutive edges travel in the
 * same direction (same axis, same sign).  These arise when the model emits
 * two adjacent RIGHT/LEFT/UP/DOWN moves that were not collapsed by step3.
 *
 * Example: (0,0)→(3,0)→(7,0) — the vertex at (3,0) is collinear and
 * redundant; removing it gives (0,0)→(7,0).
 *
 * Runs iteratively until no more vertices can be removed.
 */
function mergeCollinearEdges(parsedPlan) {
  const pts = parsedPlan.outerBoundary
  if (!pts || pts.length < 4) return parsedPlan

  const sameDir = (ax, ay, bx, by) => {
    const bothH = Math.abs(ay) < 0.001 && Math.abs(by) < 0.001
    const bothV = Math.abs(ax) < 0.001 && Math.abs(bx) < 0.001
    if (bothH) return Math.sign(ax) === Math.sign(bx)
    if (bothV) return Math.sign(ay) === Math.sign(by)
    return false
  }

  let result = [...pts]
  let changed = true

  while (changed && result.length >= 4) {
    changed = false
    const next = []
    for (let i = 0; i < result.length; i++) {
      const prev = result[(i - 1 + result.length) % result.length]
      const curr = result[i]
      const nxt  = result[(i + 1) % result.length]
      // Edge entering curr
      const ax = curr.x - prev.x, ay = curr.y - prev.y
      // Edge leaving curr
      const bx = nxt.x  - curr.x, by = nxt.y  - curr.y
      if (sameDir(ax, ay, bx, by)) {
        changed = true  // Drop curr — the two edges merge into one
      } else {
        next.push(curr)
      }
    }
    if (next.length >= 4) result = next
  }

  if (result.length < 4) return parsedPlan
  return { ...parsedPlan, outerBoundary: result }
}

function applyRotate90ccw(parsedPlan) {
  const pts = parsedPlan.outerBoundary
  const ys  = pts.map(p => p.y)
  const maxY = Math.max(...ys)

  // (x, y) → (maxY − y, x)
  const rotated = pts.map(p => ({ x: maxY - p.y, y: p.x }))
  const rMinX = Math.min(...rotated.map(p => p.x))
  const rMinY = Math.min(...rotated.map(p => p.y))
  const normalized = rotated.map(p => ({
    x: +(p.x - rMinX).toFixed(3),
    y: +(p.y - rMinY).toFixed(3),
  }))
  return { ...parsedPlan, outerBoundary: normalized, _rotated90ccw: true }
}

function summarizeOcrHints(ocrItems) {
  const dims = (ocrItems || [])
    .filter(item => item && item.parsedValue != null)
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, 12)

  if (dims.length === 0) return '- none'

  return dims.map(item => {
    const cx = item.bbox ? (item.bbox.x + item.bbox.w / 2) : null
    const cy = item.bbox ? (item.bbox.y + item.bbox.h / 2) : null

    // Trust the axis reported by OCR first. Only fall back to position
    // heuristics if OCR didn't provide a direction.
    let inferredDir = item.measureDir && item.measureDir !== 'note' ? item.measureDir : null
    if (!inferredDir && cx !== null && cy !== null) {
      if (cx < 0.25 || cx > 0.75) inferredDir = 'vertical'
      else if (cy < 0.20 || cy > 0.80) inferredDir = 'horizontal'
    }
    inferredDir = inferredDir || 'unknown'

    const cxStr = cx !== null ? cx.toFixed(2) : '?'
    const cyStr = cy !== null ? cy.toFixed(2) : '?'
    return `- ${item.text} @ image(${cxStr}, ${cyStr}) likely=${inferredDir} conf=${(item.confidence || 0).toFixed(2)}`
  }).join('\n')
}
