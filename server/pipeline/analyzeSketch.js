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
        required: ['dir', 'dist', 'source', 'label'],
        properties: {
          dir: { type: 'string', enum: ['RIGHT', 'LEFT', 'UP', 'DOWN'] },
          dist: { type: 'number' },
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

async function analyzeSketch(imagePath, userNotes = '') {
  if (!fs.existsSync(imagePath)) throw new Error('Image not found: ' + imagePath)

  const response = await callCodexCli({
    imagePath,
    outputSchema: WALK_SCHEMA,
    prompt: buildPrompt(userNotes),
  })
  console.log('[analyzeSketch] codex response:\n', response)

  const parsed = parseJsonObject(response)
  if (!parsed || !Array.isArray(parsed.walk)) {
    throw new Error('Codex CLI did not return a valid JSON walk')
  }

  const unit = normalizeUnit(parsed.unit)
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

function buildPrompt(userNotes) {
  return `Look at the attached hand-drawn deck/patio plan and return the same kind of basic geometry answer a careful human would give.

Task:
- Trace only the dark outer perimeter.
- Ignore ruled notebook paper lines, text boxes, arrows, and visual noise.
- Treat the shape as rectilinear: only RIGHT, DOWN, LEFT, UP moves.
- Start at the top-left outer corner of the shape and walk clockwise.
- Follow the visible dark outline exactly. Every move must lie on a drawn boundary edge.
- Do not cross empty gaps to connect separate horizontal levels. If a horizontal segment is lower than the previous one, include the vertical DOWN step between them.
- Use visible labels for edge distances.
- A dimension label belongs to the edge it is drawn beside. A bottom label is not a top label.
- If a required edge is unlabeled, infer the shortest value that makes the polygon close and set "source": "inferred".
- The walk must close exactly: total RIGHT must equal total LEFT, and total DOWN must equal total UP.
- If two sides look similar, do not mirror one side onto the other. Preserve asymmetry from the drawing.
- Do not run OCR-style overthinking. Do not invent extra steps. Do not create diagonals.
- Return JSON only.

Output exactly:
{
  "unit": "m",
  "walk": [
    { "dir": "RIGHT", "dist": 10, "source": "label", "label": "10m" },
    { "dir": "DOWN", "dist": 3, "source": "label", "label": "3m" },
    { "dir": "RIGHT", "dist": 5, "source": "inferred", "label": "" }
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
    const dist = parseFloat(step.dist ?? step.distance ?? step.length)
    if (!['RIGHT', 'LEFT', 'UP', 'DOWN'].includes(dir) || Number.isNaN(dist) || dist <= 0) {
      continue
    }

    const normalizedStep = {
      dir,
      dist: +dist.toFixed(4),
      source: String(step.source || 'label').toLowerCase() === 'inferred' ? 'inferred' : 'label',
      label: String(step.label || '').trim(),
    }
    cleaned.push(normalizedStep)
  }

  let merged = mergeConsecutiveSameDirection(cleaned)
  const totals = walkTotals(merged)
  const closeX = +(-(totals.right - totals.left)).toFixed(4)
  const closeY = +(-(totals.down - totals.up)).toFixed(4)

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
      `(dx=${closeX.toFixed(2)}, dy=${closeY.toFixed(2)}) to prevent a diagonal canvas edge.`
    )
  }

  merged = mergeConsecutiveSameDirection(merged)
  return { walk: merged, warnings }
}

function mergeConsecutiveSameDirection(walk) {
  const merged = []

  for (const step of walk || []) {
    const previous = merged[merged.length - 1]
    if (previous && previous.dir === step.dir) {
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

function walkTotals(walk) {
  return (walk || []).reduce((totals, step) => {
    if (step.dir === 'RIGHT') totals.right += step.dist
    else if (step.dir === 'LEFT') totals.left += step.dist
    else if (step.dir === 'DOWN') totals.down += step.dist
    else if (step.dir === 'UP') totals.up += step.dist
    return totals
  }, { right: 0, left: 0, down: 0, up: 0 })
}

function walkToPolygon(walk) {
  if (!Array.isArray(walk) || walk.length < 4) return null

  let x = 0
  let y = 0
  const pts = [{ x: 0, y: 0 }]

  for (const step of walk) {
    const dir = String(step.dir || '').toUpperCase().trim()
    const dist = parseFloat(step.dist ?? step.distance ?? step.length)
    if (Number.isNaN(dist) || dist <= 0) continue

    if (dir === 'RIGHT') x += dist
    else if (dir === 'LEFT') x -= dist
    else if (dir === 'DOWN') y += dist
    else if (dir === 'UP') y -= dist
    else continue

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

function normalizeUnit(unit) {
  if (!unit) return 'ft'
  const s = String(unit).toLowerCase().trim()
  if (s === 'm' || s.startsWith('meter') || s.startsWith('metre')) return 'm'
  if (s === 'ft' || s.startsWith('feet') || s.startsWith('foot') || s === "'") return 'ft'
  if (s === 'in' || s.startsWith('inch') || s === '"') return 'in'
  return 'ft'
}

module.exports = { analyzeSketch }
