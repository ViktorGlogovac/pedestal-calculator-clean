/**
 * Simple Codex CLI sketch analysis.
 *
 * One image in, one orthogonal perimeter walk out.  No OCR pipeline, no CV
 * fallback, no second-pass verifier.
 */

const fs = require('fs')
const { callCodexCli, parseJsonObject } = require('./codexCli')

const WALK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['unit', 'walk', 'warnings'],
  properties: {
    unit: { type: 'string' },
    walk: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dir', 'dist', 'dx', 'dy', 'source', 'label'],
        properties: {
          dir: { type: 'string', enum: ['RIGHT', 'LEFT', 'UP', 'DOWN', 'DIAGONAL'] },
          dist: { type: 'number' },
          // Signed deltas, only meaningful for DIAGONAL: dx>0 right / <0 left,
          // dy>0 down / <0 up. Orthogonal moves set both to 0 (dist is used).
          dx: { type: 'number' },
          dy: { type: 'number' },
          source: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
  },
}

async function analyzeSketch(imagePath, userNotes = '', unitSystem = 'metric', onStream = null) {
  if (!fs.existsSync(imagePath)) throw new Error('Image not found: ' + imagePath)

  const response = await callCodexCli({
    imagePath,
    outputSchema: WALK_SCHEMA,
    prompt: buildPrompt(userNotes, unitSystem),
    onChunk: typeof onStream === 'function' ? onStream : null,
  })
  console.log('[analyzeSketch] codex response:\n', response)

  const parsed = parseJsonObject(response)
  if (!parsed || !Array.isArray(parsed.walk)) {
    throw new Error('Codex CLI did not return a valid JSON walk')
  }

  const unit = normalizeUnit(parsed.unit, unitSystem)
  const normalized = normalizeWalk(parsed.walk)
  const polygon = removeCollinearPoints(walkToPolygon(normalized.walk))
  if (!polygon || polygon.length < 4) {
    throw new Error(`Codex CLI walk produced only ${polygon?.length ?? 0} corners — not a valid polygon`)
  }

  const segments = buildSegments(polygon, normalized.walk, unit)
  const warnings = [
    ...(Array.isArray(parsed.warnings) ? parsed.warnings.filter(Boolean).map(String) : []),
    ...normalized.warnings,
  ]

  return {
    unit,
    outerBoundary: polygon,
    segments,
    ocrItems: [],
    warnings,
    rawResponse: response,
  }
}

function buildPrompt(userNotes, unitSystem) {
  const isImperial = unitSystem === 'imperial'
  const unitInstruction = isImperial
    ? 'The user says this sketch uses imperial units. Interpret bare numbers and foot marks as feet. Return "unit": "ft".'
    : 'The user says this sketch uses metric units. Interpret bare numbers and m labels as meters. Return "unit": "m".'

  return `Look at the attached hand-drawn deck/patio plan and return the same kind of basic geometry answer a careful human would give.

Task:
- Trace only the dark outer perimeter.
- Ignore ruled notebook paper lines, text boxes, arrows, and visual noise.
- Most edges are rectilinear: RIGHT, DOWN, LEFT, UP moves.
- ANGLED / SLOPED walls are allowed and must be preserved. A wall drawn at an angle
  (a chamfered or 45-degree cut corner, often labeled with a slanted length such as "√2")
  is a SINGLE "DIAGONAL" move — do NOT break it into separate RIGHT + DOWN rectilinear steps.
  A √2 edge is ONE diagonal, not "DOWN 1 then RIGHT 1". Staircasing a sloped wall is WRONG.
- Start at the top-left outer corner of the shape and walk clockwise.
- Follow the visible dark outline exactly. Every move must lie on a drawn boundary edge.
- Do not cross empty gaps to connect separate horizontal levels. If a horizontal segment is lower than the previous one, include the vertical DOWN step between them.
- Use visible labels for edge distances.
- A dimension label belongs to the edge it is drawn beside. A bottom label is not a top label.
- If a required edge is unlabeled, infer the shortest value that makes the polygon close and set "source": "inferred".
- Every step MUST include "dx" and "dy":
    - For RIGHT/LEFT/UP/DOWN set dx=0 and dy=0 ("dist" carries the length).
    - For DIAGONAL set dx = horizontal change (right positive, left negative) and
      dy = vertical change (down positive, up negative), and set "dist" to the wall's
      labeled length (or the straight-line length if unlabeled).
- The walk must close exactly: total horizontal change (RIGHT minus LEFT, plus each diagonal dx)
  must be 0, and total vertical change (DOWN minus UP, plus each diagonal dy) must be 0.
- If two sides look similar, do not mirror one side onto the other. Preserve asymmetry from the drawing.
- Do not run OCR-style overthinking. Do not invent extra steps. Do not turn a straight rectilinear
  wall into a diagonal — only use DIAGONAL for a wall that is genuinely drawn at an angle.
- ${unitInstruction}
- Return JSON only.

Output exactly:
{
  "unit": "m",
  "walk": [
    { "dir": "RIGHT", "dist": 10, "dx": 0, "dy": 0, "source": "label", "label": "10m" },
    { "dir": "DIAGONAL", "dist": 1.41, "dx": 1, "dy": 1, "source": "label", "label": "√2m" },
    { "dir": "DOWN", "dist": 8, "dx": 0, "dy": 0, "source": "label", "label": "8m" },
    { "dir": "RIGHT", "dist": 5, "dx": 0, "dy": 0, "source": "inferred", "label": "" }
  ],
  "warnings": ["short human-readable warning for inferred/missing dimensions"]
}

Rules for "source":
- "label" means the distance was visibly written beside that edge.
- "inferred" means the distance was not visibly labeled and was calculated from closure.

If the sketch is ambiguous, still return the best simple closed walk and put the ambiguity in warnings.
Before returning, check that there are no consecutive moves in the same direction. If there are, combine them into one move.
${userNotes ? `User notes: ${userNotes}` : ''}`
}

function normalizeWalk(walk) {
  const cleaned = []
  const warnings = []

  for (const step of walk || []) {
    const dir = String(step.dir || '').toUpperCase().trim()
    const source = String(step.source || 'label').toLowerCase() === 'inferred' ? 'inferred' : 'label'
    const label = String(step.label || '').trim()

    if (dir === 'DIAGONAL') {
      const dx = parseFloat(step.dx)
      const dy = parseFloat(step.dy)
      if (Number.isNaN(dx) || Number.isNaN(dy) || (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001)) {
        continue
      }
      cleaned.push({
        dir,
        dx: +dx.toFixed(4),
        dy: +dy.toFixed(4),
        dist: +Math.hypot(dx, dy).toFixed(4),
        source,
        label,
      })
      continue
    }

    const dist = parseFloat(step.dist ?? step.distance ?? step.length)
    if (!['RIGHT', 'LEFT', 'UP', 'DOWN'].includes(dir) || Number.isNaN(dist) || dist <= 0) {
      continue
    }

    cleaned.push({ dir, dist: +dist.toFixed(4), dx: 0, dy: 0, source, label })
  }

  let merged = mergeConsecutiveSameDirection(cleaned)
  const net = walkNet(merged)
  const closeX = +(-net.x).toFixed(4)
  const closeY = +(-net.y).toFixed(4)

  if (Math.abs(closeX) > 0.01) {
    merged.push({
      dir: closeX > 0 ? 'RIGHT' : 'LEFT',
      dist: +Math.abs(closeX).toFixed(4),
      source: 'inferred',
      label: '',
    })
  }

  if (Math.abs(closeY) > 0.01) {
    merged.push({
      dir: closeY > 0 ? 'DOWN' : 'UP',
      dist: +Math.abs(closeY).toFixed(4),
      source: 'inferred',
      label: '',
    })
  }

  if (Math.abs(closeX) > 0.01 || Math.abs(closeY) > 0.01) {
    warnings.push(
      `Codex returned an open walk; appended inferred orthogonal closure ` +
      `(dx=${closeX.toFixed(2)}, dy=${closeY.toFixed(2)}).`
    )
  }

  merged = mergeConsecutiveSameDirection(merged)
  return { walk: merged, warnings }
}

function mergeConsecutiveSameDirection(walk) {
  const merged = []

  for (const step of walk || []) {
    const previous = merged[merged.length - 1]
    // Only merge consecutive identical ORTHOGONAL moves. Diagonals are kept as
    // distinct edges (two angled walls should never collapse into one).
    if (previous && previous.dir === step.dir && step.dir !== 'DIAGONAL') {
      const bothLabeled = previous.source === 'label' && step.source === 'label'
      previous.dist = +(previous.dist + step.dist).toFixed(4)
      previous.source = bothLabeled ? 'label' : 'inferred'
      previous.label = bothLabeled
        ? [previous.label, step.label].filter(Boolean).join(' + ')
        : ''
    } else {
      merged.push({ ...step })
    }
  }

  return merged
}

// Signed (dx, dy) displacement of a single walk step. DIAGONAL carries its own
// dx/dy; orthogonal moves derive it from dir + dist.
function stepDelta(step) {
  const dir = String(step.dir || '').toUpperCase().trim()
  if (dir === 'DIAGONAL') {
    const dx = parseFloat(step.dx)
    const dy = parseFloat(step.dy)
    return { dx: Number.isNaN(dx) ? 0 : dx, dy: Number.isNaN(dy) ? 0 : dy }
  }
  const dist = parseFloat(step.dist ?? step.distance ?? step.length)
  if (Number.isNaN(dist) || dist <= 0) return { dx: 0, dy: 0 }
  if (dir === 'RIGHT') return { dx: dist, dy: 0 }
  if (dir === 'LEFT') return { dx: -dist, dy: 0 }
  if (dir === 'DOWN') return { dx: 0, dy: dist }
  if (dir === 'UP') return { dx: 0, dy: -dist }
  return { dx: 0, dy: 0 }
}

// Net displacement of the whole walk (0,0 when it closes perfectly).
function walkNet(walk) {
  return (walk || []).reduce((net, step) => {
    const { dx, dy } = stepDelta(step)
    net.x += dx
    net.y += dy
    return net
  }, { x: 0, y: 0 })
}

function walkToPolygon(walk) {
  if (!Array.isArray(walk) || walk.length < 4) return null

  let x = 0
  let y = 0
  const pts = [{ x: 0, y: 0 }]

  for (const step of walk) {
    const { dx, dy } = stepDelta(step)
    if (dx === 0 && dy === 0) continue
    x += dx
    y += dy
    pts.push({ x: +x.toFixed(4), y: +y.toFixed(4) })
  }

  if (pts.length > 1) {
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (Math.abs(first.x - last.x) < 0.01 && Math.abs(first.y - last.y) < 0.01) pts.pop()
  }

  if (pts.length < 4) return null

  const minX = Math.min(...pts.map((pt) => pt.x))
  const minY = Math.min(...pts.map((pt) => pt.y))
  return pts.map((pt) => ({ x: +(pt.x - minX).toFixed(4), y: +(pt.y - minY).toFixed(4) }))
}

function removeCollinearPoints(points) {
  if (!Array.isArray(points) || points.length < 4) return points

  const result = []
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length]
    const curr = points[i]
    const next = points[(i + 1) % points.length]
    const sameX = Math.abs(prev.x - curr.x) < 0.001 && Math.abs(curr.x - next.x) < 0.001
    const sameY = Math.abs(prev.y - curr.y) < 0.001 && Math.abs(curr.y - next.y) < 0.001
    if (sameX || sameY) continue
    result.push(curr)
  }

  return result.length >= 4 ? result : points
}

function buildSegments(points, walk, unit) {
  return points.map((start, i) => {
    const end = points[(i + 1) % points.length]
    const step = walk[i] || {}
    const source = String(step.source || '').toLowerCase()
    const label = String(step.label || '').trim()
    const value = typeof step.dist === 'number' ? step.dist : parseFloat(step.dist)

    return {
      id: `s${i + 1}`,
      start,
      end,
      geometricLength: +Math.hypot(end.x - start.x, end.y - start.y).toFixed(4),
      lengthLabel: source === 'label' && Number.isFinite(value)
        ? {
            rawText: label || `${value}${unit}`,
            value,
            unit,
            confidence: 0.9,
          }
        : null,
      inferred: source !== 'label',
      confidence: source === 'label' ? 0.9 : 0.65,
    }
  })
}

function normalizeUnit(unit, unitSystem = 'metric') {
  if (!unit) return unitSystem === 'imperial' ? 'ft' : 'm'
  const s = String(unit).toLowerCase().trim()
  if (s === 'm' || s.startsWith('meter') || s.startsWith('metre')) return 'm'
  if (s === 'ft' || s.startsWith('feet') || s.startsWith('foot') || s === "'") return 'ft'
  if (s === 'in' || s.startsWith('inch') || s === '"') return 'in'
  return unitSystem === 'imperial' ? 'ft' : 'm'
}

module.exports = { analyzeSketch }
