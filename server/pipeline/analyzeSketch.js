/**
 * Pure multimodal sketch analysis.
 *
 * The model reads the sketch directly, emits a structured perimeter walk, then
 * performs a second verification pass against the same image. The second pass
 * can correct the first, but must still return the same strict JSON schema.
 */

const fs = require('fs')
const path = require('path')

const MODEL = process.env.OPENAI_SKETCH_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4'
const MAX_TOKENS = 3500

async function analyzeSketch(imagePath, userNotes = '') {
  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY
  if (!apiKey) throw new Error('No OpenAI API key configured')
  if (!fs.existsSync(imagePath)) throw new Error('Image not found: ' + imagePath)

  const base64 = fs.readFileSync(imagePath).toString('base64')
  const ext = path.extname(imagePath).slice(1).toLowerCase()
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'

  const initial = await callOpenAI(apiKey, buildInitialMessages(base64, mimeType, userNotes))
  console.log('[analyzeSketch] initial response:\n', initial)

  const initialParsed = parseJsonObject(initial)
  if (!initialParsed || !Array.isArray(initialParsed.walk)) {
    throw new Error('Initial multimodal pass did not return a valid JSON walk')
  }

  const verification = await callOpenAI(apiKey, buildVerificationMessages(base64, mimeType, initialParsed, userNotes))
  console.log('[analyzeSketch] verification response:\n', verification)

  const verifiedParsed = parseJsonObject(verification)
  const chosen = verifiedParsed && Array.isArray(verifiedParsed.walk) ? verifiedParsed : initialParsed

  const unit = normalizeUnit(chosen.unit)
  const polygon = walkToPolygon(chosen.walk)
  if (!polygon || polygon.length < 4) {
    throw new Error(`Verified walk produced only ${polygon?.length ?? 0} corners — not a valid polygon`)
  }

  const { normalizeUnit: normalizeParsedUnit } = require('../utils/units')
  const ocrItems = (chosen.labels || [])
    .map((lbl) => {
      const val = typeof lbl.value === 'number' ? lbl.value : parseFloat(lbl.value)
      const rawText = String(lbl.text || val || '').trim()
      if (!rawText || Number.isNaN(val) || val <= 0) return null

      const parsedUnit = lbl.unit ? normalizeParsedUnit(String(lbl.unit)) : unit
      const axis = String(lbl.axis || '').toLowerCase()
      const side = String(lbl.side || '').toLowerCase()

      return {
        text: rawText,
        normalized: rawText,
        parsedValue: val,
        parsedUnit,
        bbox: syntheticBboxForLabel(axis, side),
        confidence: typeof lbl.confidence === 'number' ? Math.max(0.5, Math.min(0.95, lbl.confidence)) : 0.82,
        type: 'dimension',
        orientation: 'normal',
        measureDir: axis === 'y' ? 'vertical' : axis === 'x' ? 'horizontal' : 'unknown',
        source: 'gpt-multimodal',
      }
    })
    .filter(Boolean)

  return {
    unit,
    outerBoundary: polygon,
    ocrItems,
    rawResponse: verification || initial,
  }
}

function buildInitialMessages(base64, mimeType, userNotes) {
  const systemPrompt =
    'You read hand-drawn deck or patio perimeter sketches from a single image.\n' +
    'The sketch may be drawn on lined/ruled notebook paper. The faint evenly-spaced horizontal lines are PAPER BACKGROUND — ignore them completely. Only the darker hand-drawn pen/pencil lines form the deck boundary.\n' +
    'You must recover the OUTER boundary only and list every visible dimension label.\n' +
    'Some real designs include diagonal edges, but you must only use a diagonal if the boundary itself is clearly drawn diagonal.\n' +
    'If the sketch shows stepped notches or staircase cutouts, count the distinct visible steps carefully:\n' +
    '  - A SINGLE notch/recess (one horizontal + one vertical cut) = exactly 2 extra edges.\n' +
    '  - A 2-STEP staircase (two distinct steps visually) = 4 extra edges.\n' +
    'Two dimension labels near a notch (e.g. "2m" for width and "4m" for depth) describe ONE notch — not a 2-step staircase.\n' +
    'Do not smooth, simplify, mirror, or symmetrize the shape.\n' +
    'Output only valid JSON matching the requested schema.'

  const userPrompt =
    'Return a JSON object matching this schema. Three reference shapes are shown:\n\n' +
    'EXAMPLE A — single notch (L-shape): 20m top, 14m left, one bottom-right notch 2m wide × 4m deep (right=10m, bottom=18m):\n' +
    '{"unit":"m","walk":[{"dir":"RIGHT","dist":20},{"dir":"DOWN","dist":10},{"dir":"LEFT","dist":2},{"dir":"DOWN","dist":4},{"dir":"LEFT","dist":18},{"dir":"UP","dist":14}],"labels":[{"text":"20m","value":20,"unit":"m","axis":"x","side":"top"},{"text":"14m","value":14,"unit":"m","axis":"y","side":"left"},{"text":"10m","value":10,"unit":"m","axis":"y","side":"right"},{"text":"18m","value":18,"unit":"m","axis":"x","side":"bottom"},{"text":"2m","value":2,"unit":"m","axis":"x","side":"inner"},{"text":"4m","value":4,"unit":"m","axis":"y","side":"inner"}]}\n\n' +
    'EXAMPLE B — two symmetric bottom tabs (U-shape): 20m top, 8m both sides, two bottom-corner tabs each 2m wide × 2m deep, 16m bottom middle. top(20) = left-tab(2) + bottom(16) + right-tab(2) = 20 ✓. The top is ONE edge = RIGHT 20, not split:\n' +
    '{"unit":"m","walk":[{"dir":"RIGHT","dist":20},{"dir":"DOWN","dist":8},{"dir":"LEFT","dist":2},{"dir":"DOWN","dist":2},{"dir":"LEFT","dist":16},{"dir":"UP","dist":2},{"dir":"LEFT","dist":2},{"dir":"UP","dist":8}],"labels":[{"text":"20m","value":20,"unit":"m","axis":"x","side":"top"},{"text":"8m","value":8,"unit":"m","axis":"y","side":"left"},{"text":"8m","value":8,"unit":"m","axis":"y","side":"right"},{"text":"16m","value":16,"unit":"m","axis":"x","side":"bottom"},{"text":"2m","value":2,"unit":"m","axis":"x","side":"inner"},{"text":"2m","value":2,"unit":"m","axis":"y","side":"inner"},{"text":"2m","value":2,"unit":"m","axis":"x","side":"inner"},{"text":"2m","value":2,"unit":"m","axis":"y","side":"inner"}]}\n\n' +
    'EXAMPLE C — two-step staircase: 390" wide, 785" tall, TWO visually distinct steps on upper-right (4 extra edges):\n' +
    '{"unit":"in","walk":[{"dir":"RIGHT","dist":390},{"dir":"DOWN","dist":127},{"dir":"RIGHT","dist":98},{"dir":"DOWN","dist":127},{"dir":"RIGHT","dist":98},{"dir":"DOWN","dist":531},{"dir":"LEFT","dist":586},{"dir":"UP","dist":785}],"labels":[{"text":"390\\"","value":390,"unit":"in","axis":"x","side":"top"},{"text":"785\\"","value":785,"unit":"in","axis":"y","side":"left"},{"text":"586\\"","value":586,"unit":"in","axis":"x","side":"bottom"},{"text":"531\\"","value":531,"unit":"in","axis":"y","side":"right"},{"text":"127\\"","value":127,"unit":"in","axis":"y","side":"inner"},{"text":"98\\"","value":98,"unit":"in","axis":"x","side":"inner"}]}\n\n' +
    'Rules:\n' +
    '- Start at the top-left outer corner and walk clockwise.\n' +
    '- Use one object per actual edge — even if there are 10–20 edges.\n' +
    '- ONE label = ONE edge. A single dimension label (e.g. "20m" above the top) describes the ENTIRE edge it is next to. Never split one labeled edge into multiple walk segments. Do not invent unlabeled segments to fill gaps.\n' +
    '- Unlabeled edges: derive their length from the closure constraint, not by guessing.\n' +
    '- Count drawn steps by looking at the outline, not by counting labels. One step cut = 2 extra edges. Two distinct drawn steps = 4 extra edges.\n' +
    '- Two dimension labels near a single notch (e.g. "2m" width + "2m" depth) describe ONE notch — do not split it into a staircase.\n' +
    '- CRITICAL: The walk MUST close exactly. Verify: sum of all RIGHT = sum of all LEFT, and sum of DOWN = sum of UP. Adjust if needed.\n' +
    '- CRITICAL: The labeled top dimension must equal sum(RIGHT). The labeled full-height dimension must equal sum(DOWN). If they do not match, your walk is wrong — fix it before returning.\n' +
    '- CRITICAL: Every dist value in your walk MUST come from either (a) a dimension label visible in the sketch, or (b) the closure constraint (one unlabeled segment whose length is calculated so the walk closes). NEVER invent a distance that does not appear in a label. If the sketch looks wider or taller than the labels suggest, trust the labels — not your visual estimate of proportions.\n' +
    '- Ignore any faint evenly-spaced horizontal lines in the image — those are ruled paper background, not deck edges.\n' +
    '- For each label, include axis "x" for horizontal dimensions, axis "y" for vertical dimensions.\n' +
    '- For each label, include side: one of top, right, bottom, left, inner, unknown.\n' +
    '- If there is no diagonal boundary, do not invent one.\n' +
    (userNotes ? `- User notes: "${userNotes}"\n` : '')

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
      ],
    },
  ]
}

function buildVerificationMessages(base64, mimeType, initialParsed, userNotes) {
  const systemPrompt =
    'You are verifying a previously extracted perimeter walk against the image itself.\n' +
    'Your job is to catch mistakes such as mirrored notches, collapsed steps, wrong totals, or invented diagonals.\n' +
    'If the candidate is wrong, return a corrected JSON object in the same schema.\n' +
    'If it is correct, return it unchanged.\n' +
    'Output only valid JSON.'

  const userPrompt =
    'Check this candidate JSON against the image and correct it if needed.\n' +
    'Reject it if any of these happen:\n' +
    '- the largest vertical label does not match the total DOWN distance in the walk (e.g. sketch says 14m on the left wall but walk only sums to 10m DOWN — wrong)\n' +
    '- the largest horizontal label does not match the total RIGHT distance in the walk\n' +
    '- a step/notch appears on the wrong side of the polygon\n' +
    '- two dimension labels near a notch (e.g. "2m" width + "4m" depth) were misread as a 2-step staircase instead of a single notch with 2 extra edges\n' +
    '- a staircase/stepped corner was collapsed into fewer segments than the number of distinct drawn steps\n' +
    '- a diagonal replaces a stepped orthogonal edge even though the boundary is not diagonal\n' +
    '- the walk does not close exactly (sum of RIGHT ≠ sum of LEFT, or sum of DOWN ≠ sum of UP)\n\n' +
    'ARITHMETIC CHECK — do this before accepting the candidate:\n' +
    '  1. Sum all RIGHT distances in the walk. Write that number down.\n' +
    '  2. Find the label with side="top" (or the largest x-axis label). Its value must equal step 1. If not, the walk is wrong.\n' +
    '  3. Sum all DOWN distances. Find the label with side="left" or the tallest outer wall label. They must match. If not, the walk is wrong.\n' +
    '  4. Check: sum(RIGHT) == sum(LEFT), sum(DOWN) == sum(UP). If either fails, the walk is wrong.\n' +
    'If any arithmetic check fails, rewrite the walk from scratch using only the labeled dimensions and the closure constraint.\n' +
    'A single top label (e.g. "20m") means the ENTIRE top edge is 20m — one RIGHT segment. Never split it.\n' +
    'EVERY dist in the walk must come from a visible label or from the closure constraint. If any dist in the candidate is not backed by a label and is not a closure remainder, the candidate is wrong.\n\n' +
    'Count visible drawn steps in each corner. Two labels near a notch describe one notch (2 extra edges), not a staircase.\n' +
    'Faint evenly-spaced horizontal lines are ruled paper background — ignore them.\n\n' +
    `Candidate JSON:\n${JSON.stringify(initialParsed, null, 2)}\n\n` +
    (userNotes ? `User notes: "${userNotes}"\n` : '')

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
      ],
    },
  ]
}

async function callOpenAI(apiKey, messages) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: MAX_TOKENS,
      messages,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`OpenAI API error ${response.status}: ${err.slice(0, 200)}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

function parseJsonObject(content) {
  const cleaned = String(content || '')
    .replace(/^```[a-z]*\n?/im, '')
    .replace(/\n?```\s*$/m, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch (_) {
      return null
    }
  }
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

function normalizeUnit(unit) {
  if (!unit) return 'ft'
  const s = String(unit).toLowerCase().trim()
  if (s === 'm' || s.startsWith('meter') || s.startsWith('metre')) return 'm'
  if (s === 'ft' || s.startsWith('feet') || s.startsWith('foot') || s === "'") return 'ft'
  if (s === 'in' || s.startsWith('inch') || s === '"') return 'in'
  return 'ft'
}

function syntheticBboxForLabel(axis, side) {
  if (axis === 'y') {
    return side === 'left'
      ? { x: 0.04, y: 0.35, w: 0.06, h: 0.18 }
      : { x: 0.90, y: 0.35, w: 0.06, h: 0.18 }
  }

  if (axis === 'x') {
    return side === 'bottom'
      ? { x: 0.38, y: 0.88, w: 0.18, h: 0.06 }
      : { x: 0.38, y: 0.04, w: 0.18, h: 0.06 }
  }

  return { x: 0.45, y: 0.45, w: 0.08, h: 0.04 }
}

module.exports = { analyzeSketch }
