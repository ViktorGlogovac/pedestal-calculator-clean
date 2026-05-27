/**
 * Pedestal depth extraction from a dedicated depth-annotation image.
 *
 * The user draws the deck shape a second time with pedestal heights written at
 * their locations. Bare numbers (no unit written) are interpreted in the unit
 * system the user selected at the start: metric → cm, imperial → in.
 * Codex CLI reads every depth value and expresses
 * each position as a fraction (fx, fy) of the deck bounding box. The JS code
 * converts those fractions to real deck coordinates using the polygon from
 * the primary analyzeSketch pass.
 */

const fs = require('fs')
const path = require('path')
const { callCodexCli, messagesToPrompt, parseJsonObject } = require('./codexCli')

const DEPTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['depths'],
  properties: {
    depths: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['value', 'unit', 'x', 'y', 'fx', 'fy', 'description'],
        properties: {
          value: { type: 'number' },
          unit: { type: 'string' },
          x: { type: ['number', 'null'] },
          y: { type: ['number', 'null'] },
          fx: { type: ['number', 'null'] },
          fy: { type: ['number', 'null'] },
          description: { type: 'string' },
        },
      },
    },
  },
}

/**
 * Extract pedestal depth points from an annotated depth image.
 *
 * @param {string} imagePath    - absolute path to the depth annotation image
 * @param {Array<{x,y}>} deckPolygon - polygon from analyzeSketch (deck coords)
 * @param {string} deckUnit     - "m" | "ft" | "in"
 * @returns {Promise<Array<{value, unit, x, y, description}>>}
 */
async function analyzeDepths(imagePath, deckPolygon, deckUnit, { isMainSketch = false, unitSystem = 'metric' } = {}) {
  if (!fs.existsSync(imagePath)) throw new Error('Depth image not found: ' + imagePath)

  // Default unit for bare numbers (no unit written next to them) follows the unit
  // system the user picked at the start — NOT a hardcoded inch assumption.
  const defaultDepthUnit = String(unitSystem).toLowerCase() === 'imperial' ? 'in' : 'cm'
  const exampleValues =
    defaultDepthUnit === 'in'
      ? `2", 3", 4", 5", 7", 8", 10"`
      : '2cm, 3cm, 4cm, 5cm, 7cm, 8cm, 10cm'
  const smallRange = defaultDepthUnit === 'in' ? '1"–24"' : '1–60 cm'

  const maxX = Math.max(...deckPolygon.map((p) => p.x))
  const maxY = Math.max(...deckPolygon.map((p) => p.y))

  // Build vertex list string for the prompt
  const vertexList = deckPolygon
    .map((p, i) => `  vertex ${i + 1}: (${+p.x.toFixed(2)}, ${+p.y.toFixed(2)})`)
    .join('\n')

  const ext = path.extname(imagePath).slice(1).toLowerCase()
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
  const base64 = ''

  const systemPrompt =
    'You are a pedestal depth extraction specialist.\n' +
    'Your only job is to find every pedestal height annotation written on a deck plan sketch.\n' +
    (isMainSketch
      ? 'This image is the main deck sketch. It contains both the deck perimeter (with span dimensions on or outside the edges) AND pedestal height values written across the interior and along the perimeter.\n' +
        'Span/length dimensions are large values written alongside the outer boundary with arrows or dimension lines. IGNORE those.\n' +
        `Pedestal heights are small values (${smallRange} range) written densely across the deck interior and along the inner perimeter. EXTRACT those.\n`
      : 'This image is a dedicated pedestal-height markup sheet — not the main perimeter-dimension drawing.\n'
    ) +
    `Repeated handwritten values like ${exampleValues} written across the deck interior or along the deck perimeter are valid pedestal heights and MUST be extracted.\n` +
    'Do not discard a value just because it is repeated many times.\n' +
    'Only ignore labels that are clearly span/length dimensions with dimension lines, arrows, or long outside-the-deck measurement callouts.\n' +
    'Output only valid JSON.'

  const userPrompt =
    `The deck origin is (0, 0) at the top-left. The deck is ${maxX} ${deckUnit} wide (x-axis, left→right) and ${maxY} ${deckUnit} tall (y-axis, top→bottom).\n\n` +
    `The deck has these exact corner vertices (in ${deckUnit}):\n${vertexList}\n\n` +
    'CRITICAL RULE: If an annotation appears to be written at or near a corner/vertex of the deck shape, you MUST use the exact vertex coordinates from the list above — do NOT estimate a nearby position. For example, an annotation written at the top-left corner of the deck = x: 0, y: 0 exactly.\n\n' +
    'Return exactly this JSON:\n' +
    '{\n' +
    '  "depths": [\n' +
    `    {"value": 4, "unit": "${defaultDepthUnit}", "x": 0.0, "y": 0.0, "description": "top-left corner"},\n` +
    `    {"value": 5, "unit": "${defaultDepthUnit}", "x": ${+maxX.toFixed(2)}, "y": ${+maxY.toFixed(2)}, "description": "bottom-right corner"},\n` +
    `    {"value": 10, "unit": "${defaultDepthUnit}", "x": ${+(maxX / 2).toFixed(1)}, "y": ${+(maxY / 2).toFixed(1)}, "description": "centre drain"}\n` +
    '  ]\n' +
    '}\n\n' +
    'Rules:\n' +
    `- x: horizontal distance in ${deckUnit} from the LEFT edge of the deck (0 = left, ${+maxX.toFixed(2)} = right).\n` +
    `- y: vertical distance in ${deckUnit} from the TOP edge of the deck (0 = top, ${+maxY.toFixed(2)} = bottom).\n` +
    '- If the annotation is at/near a vertex listed above, use that vertex\'s EXACT x and y.\n' +
    '- If a height annotation is written on or just outside the perimeter edge, assign it to the nearest deck vertex/corner unless it is clearly marking an interior drain or mid-deck point. Do NOT return a free-floating coordinate along the edge for perimeter corner-height drawings.\n' +
    '- If the annotation is in the interior (drain, mid-deck mark), estimate its position as accurately as possible.\n' +
    '- value: numeric depth/height number only.\n' +
    `- unit: use exactly the unit written next to the number when one IS written ("mm", "cm", "m", "in", inch marks " = in, apostrophe ' = ft). If a number has NO unit written next to it, set unit = "${defaultDepthUnit}" — the unit system the user selected at the start. Do NOT assume inches for bare numbers.\n` +
    '- description: brief label (e.g. "top-right corner", "drain at centre", "bottom-left step").\n' +
    '- Include EVERY depth/height annotation visible — do not skip any.\n' +
    '- Interior repeated handwritten values are valid pedestal heights and must be included.\n' +
    '- Perimeter handwritten values written beside the deck outline are also valid pedestal heights if they describe local support height.\n' +
    '- Diagonal guide lines, drain lines, and notebook ruling lines are NOT measurements by themselves; only the nearby numeric labels are measurements.\n' +
    '- Do NOT include only the single highest/lowest value; include the full field of height annotations.\n' +
    '- Do NOT include obvious outside-the-deck span dimensions with long measurement lines (for example deck width/length callouts).\n' +
    '- For a dense height sketch, it is normal for dozens of depth points to exist.'

  const primaryMessages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
      ],
    },
  ]
  const primaryResponse = await callCodexCli({
    imagePath,
    outputSchema: DEPTH_SCHEMA,
    prompt: messagesToPrompt(primaryMessages),
  })

  console.log('[analyzeDepths] primary response:\n', primaryResponse)

  let parsed = parseJsonObject(primaryResponse)
  let depthPoints = normalizeDepths(parsed?.depths, { maxX, maxY, defaultDepthUnit, deckPolygon })

  if (depthPoints.length === 0) {
    const fallbackMessages = [
      {
        role: 'system',
        content:
          'You are extracting ALL handwritten pedestal heights from a dense deck sketch.\n' +
          `This image may contain many repeated values like ${exampleValues}.\n` +
          'Return as many valid pedestal height points as you can.\n' +
          'If exact deck-unit coordinates are hard, you may return normalized fractions fx and fy from 0 to 1 instead.\n' +
          'Output only valid JSON.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `The deck spans x=0..${+maxX.toFixed(2)} ${deckUnit} and y=0..${+maxY.toFixed(2)} ${deckUnit}.\n` +
              'Return exactly:\n' +
              '{\n' +
              '  "depths": [\n' +
              `    {"value": 4, "unit": "${defaultDepthUnit}", "fx": 0.02, "fy": 0.18, "description": "left edge upper"},\n` +
              `    {"value": 10, "unit": "${defaultDepthUnit}", "fx": 0.50, "fy": 0.66, "description": "centre"}\n` +
              '  ]\n' +
              '}\n' +
              'Rules:\n' +
              '- Include interior and perimeter handwritten height labels.\n' +
              '- Repeated values are valid and should be included.\n' +
              `- Use the unit written next to each number; if none is written, unit = "${defaultDepthUnit}".\n` +
              '- fx is horizontal fraction from left to right, fy is vertical fraction from top to bottom.\n' +
              '- fx and fy must each be between 0 and 1.\n' +
              '- Do not return deck span dimensions; only local pedestal heights.',
          },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
        ],
      },
    ]
    const fallbackResponse = await callCodexCli({
      imagePath,
      outputSchema: DEPTH_SCHEMA,
      prompt: messagesToPrompt(fallbackMessages),
    })

    console.log('[analyzeDepths] fallback response:\n', fallbackResponse)
    parsed = parseJsonObject(fallbackResponse)
    depthPoints = normalizeDepths(parsed?.depths, { maxX, maxY, defaultDepthUnit, deckPolygon })
  }

  if (depthPoints.length === 0) {
    console.warn('[analyzeDepths] No valid depths array returned')
    return []
  }

  console.log('[analyzeDepths] depthPoints:', JSON.stringify(depthPoints))
  return depthPoints
}

function normalizeDepths(rawDepths, { maxX, maxY, defaultDepthUnit, deckPolygon }) {
  if (!Array.isArray(rawDepths)) return []

  const defaultUnit = defaultDepthUnit || 'cm'
  const vertexSnapDistance = Math.max(Math.min(maxX, maxY) * 0.18, 0.01)

  return rawDepths
    .map((d) => {
      const val = typeof d?.value === 'number' ? d.value : parseFloat(d?.value)
      if (Number.isNaN(val) || val <= 0) return null

      let x = typeof d?.x === 'number' ? d.x : null
      let y = typeof d?.y === 'number' ? d.y : null

      if ((x === null || y === null) && typeof d?.fx === 'number' && typeof d?.fy === 'number') {
        x = d.fx * maxX
        y = d.fy * maxY
      }

      if (!Number.isFinite(x) || !Number.isFinite(y)) return null

      const snappedVertex = getDepthPointVertexSnap(
        { x, y, description: d?.description },
        deckPolygon,
        vertexSnapDistance,
      )
      if (snappedVertex) {
        x = snappedVertex.x
        y = snappedVertex.y
      }

      const normalizedUnit = normalizeDepthUnit(d?.unit || defaultUnit, defaultUnit)

      return {
        value: val,
        unit: normalizedUnit,
        x: +Math.max(0, Math.min(maxX, x)).toFixed(4),
        y: +Math.max(0, Math.min(maxY, y)).toFixed(4),
        description: String(d.description || ''),
      }
    })
    .filter(Boolean)
}

function getDepthPointVertexSnap(point, deckPolygon, snapDistance) {
  if (!Array.isArray(deckPolygon) || deckPolygon.length === 0) return null

  const description = String(point?.description || '').toLowerCase()
  const forceCornerSnap =
    /\b(corner|vertex)\b/.test(description) ||
    /\b(top|upper|bottom|lower)[-\s]?(left|right)\b/.test(description) ||
    /\b(left|right)[-\s]?(top|upper|bottom|lower)\b/.test(description) ||
    /\b(left|right)\s+edge\s+(top|upper|bottom|lower)\b/.test(description) ||
    /\b(top|upper|bottom|lower)\s+(left|right)\s+edge\b/.test(description)

  let nearest = null
  let nearestDistance = Infinity
  deckPolygon.forEach((vertex) => {
    const x = Number(vertex?.x)
    const y = Number(vertex?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const distance = Math.hypot(point.x - x, point.y - y)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = { x, y }
    }
  })

  if (!nearest) return null
  return forceCornerSnap || nearestDistance <= snapDistance ? nearest : null
}

function normalizeDepthUnit(rawUnit, fallbackUnit) {
  const unit = String(rawUnit || '').trim().toLowerCase()
  if (!unit) return fallbackUnit

  if (['"', '”', '″', 'in', 'inch', 'inches'].includes(unit)) return 'in'
  if (["'", '’', '′', 'ft', 'foot', 'feet'].includes(unit)) return 'ft'
  if (['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'].includes(unit)) return 'mm'
  if (['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'].includes(unit)) return 'cm'
  if (['m', 'meter', 'meters', 'metre', 'metres'].includes(unit)) return 'm'

  return fallbackUnit
}

module.exports = { analyzeDepths }
