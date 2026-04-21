/**
 * OCR via GPT-4o Vision — reads handwritten construction annotations.
 *
 * Tesseract.js struggles with handwritten sketches on lined paper.
 * This module calls GPT-4o Vision twice with a tight, OCR-only prompt
 * and merges the two responses to reduce hallucinations and missed items.
 *
 * Merge strategy:
 *   - Items that appear in both runs (similar text + similar position)
 *     are kept and their confidence is boosted.
 *   - Items that appear in only one run need conf ≥ 0.75 to survive.
 *   - Items that appear in only one run with conf < 0.75 are dropped.
 *
 * Only used as a fallback when Tesseract finds 0 usable results.
 * The geometry pipeline (CV, line graph, candidates) remains fully
 * deterministic — this only provides the text labels.
 */

const fs   = require('fs')
const path = require('path')
const { parseTextDimension, normalizeUnit } = require('../utils/units')

const MODEL      = process.env.OPENAI_SKETCH_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4'
const MAX_TOKENS = 800
const OCR_RUNS   = 2          // Number of independent OCR passes to merge
const MERGE_XY_TOL = 0.06    // Position tolerance for merging items across runs
const SINGLE_RUN_MIN_CONF = 0.60  // Items only seen in 1 run must meet this threshold

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * Extract text annotations from a sketch image using GPT-4o Vision.
 * Runs OCR_RUNS times and merges results for stability.
 *
 * @param {string} imagePath  - absolute path to the image
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {Promise<Array<OcrItem>>}
 */
async function extractTextVision(imagePath, imageWidth, imageHeight) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY
  if (!apiKey) {
    console.warn('[ocrVision] No OpenAI API key configured — skipping vision OCR')
    return []
  }

  if (!fs.existsSync(imagePath)) {
    console.warn('[ocrVision] Image not found:', imagePath)
    return []
  }

  const base64 = fs.readFileSync(imagePath).toString('base64')
  const ext = path.extname(imagePath).slice(1).toLowerCase()
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'

  const prompt = buildPrompt()

  // Run OCR_RUNS times sequentially (sequential = stable, no race conditions)
  const runs = []
  for (let i = 0; i < OCR_RUNS; i++) {
    const items = await runSinglePass(apiKey, base64, mimeType, prompt, imageWidth, imageHeight)
    runs.push(items)
  }

  return mergeVisionRuns(runs)
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt() {
  return `You are reading handwritten annotations on a construction deck plan sketch (a top-down view).
The sketch may be on lined notebook paper. Annotations are often written ROTATED 90° (sideways) alongside walls.

List every text annotation you can read. Output exactly one JSON object per line — no markdown, no brackets, no explanation:
{"text":"44'","x":0.02,"y":0.48,"axis":"y","conf":0.9}

Field definitions:
- text: the exact text as written (e.g. 44', 31'6", 25'6", 6m, 1m, Door, Flat)
- x,y: position of the text centre as image fractions (0.0 = left/top, 1.0 = right/bottom)
- axis: which direction on the PLAN this dimension spans
    "x"  → the dimension measures a LEFT-TO-RIGHT distance (width, horizontal span)
    "y"  → the dimension measures a TOP-TO-BOTTOM distance (height, vertical span)
    "n"  → not a measurement (label like Door, Flat)
- conf: your confidence that you read the text correctly (0.0–1.0)

Rules:
- Annotations written VERTICALLY or SIDEWAYS alongside a wall typically measure that wall's LENGTH (height/vertical span) — use axis "y"
- Annotations written HORIZONTALLY across the top or bottom typically measure width — use axis "x"
- Only include text you are confident you can clearly read — do NOT invent or guess numbers
- If you are unsure, omit it entirely (conf < 0.6 → skip)
- Preserve units exactly: "6m" not "6", "1m" not "1"
- Look for dimension annotation arrows — they show which axis is being measured
- Output only JSON lines, nothing else`
}

// ─── Single OCR pass ─────────────────────────────────────────────────────────

async function runSinglePass(apiKey, base64, mimeType, prompt, imageWidth, imageHeight) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.warn('[ocrVision] API error:', response.status, errText.slice(0, 200))
      return []
    }

    const json = await response.json()
    const content = json.choices?.[0]?.message?.content || ''
    return parseVisionResponse(content, imageWidth, imageHeight)
  } catch (err) {
    console.warn('[ocrVision] Request failed:', err.message)
    return []
  }
}

// ─── Multi-run merge ──────────────────────────────────────────────────────────

/**
 * Merge OCR items from multiple passes.
 *
 * Items from different runs that are spatially nearby (< MERGE_XY_TOL)
 * AND have matching or similar text are grouped together.
 * The representative item for each group is the one with the highest conf.
 * Items confirmed by multiple runs get a confidence boost.
 * Items appearing in only one run with conf < SINGLE_RUN_MIN_CONF are dropped.
 */
function mergeVisionRuns(runs) {
  if (runs.length === 0) return []
  if (runs.length === 1) return runs[0]

  const all = runs.flat()
  const used = new Array(all.length).fill(false)
  const groups = []

  for (let i = 0; i < all.length; i++) {
    if (used[i]) continue
    const group = [i]
    used[i] = true

    for (let j = i + 1; j < all.length; j++) {
      if (used[j]) continue
      if (itemsMatch(all[i], all[j])) {
        group.push(j)
        used[j] = true
      }
    }

    groups.push(group.map(idx => all[idx]))
  }

  const merged = []
  for (const group of groups) {
    // Pick the item with the highest confidence as the representative
    const best = group.reduce((a, b) => (b.confidence > a.confidence ? b : a))
    const runCount = group.length

    // Multi-run boost: each additional observation adds 5% confidence
    const boosted = Math.min(0.95, best.confidence + (runCount - 1) * 0.05)

    // Single-run items need higher confidence to survive
    if (runCount === 1 && best.confidence < SINGLE_RUN_MIN_CONF) continue

    merged.push({ ...best, confidence: boosted })
  }

  // Final dedup by position (same grid cell)
  const seenKeys = new Set()
  return merged.filter(item => {
    const key = `${item.bbox.x.toFixed(2)},${item.bbox.y.toFixed(2)}`
    if (seenKeys.has(key)) return false
    seenKeys.add(key)
    return true
  })
}

/**
 * Returns true if two OCR items likely refer to the same annotation:
 * similar position AND matching text (exact OR common misread).
 */
function itemsMatch(a, b) {
  const acx = a.bbox.x + a.bbox.w / 2
  const acy = a.bbox.y + a.bbox.h / 2
  const bcx = b.bbox.x + b.bbox.w / 2
  const bcy = b.bbox.y + b.bbox.h / 2

  const posClose = Math.hypot(acx - bcx, acy - bcy) < MERGE_XY_TOL
  if (!posClose) return false

  // Exact text match
  if (a.text === b.text) return true

  // Normalise for comparison: strip whitespace, quotes, apostrophes
  const norm = t => t.toLowerCase().replace(/[\s'"″′]/g, '')
  if (norm(a.text) === norm(b.text)) return true

  // Common numeric prefix match (e.g. "37'" and "31'6\"" both start with "3")
  // Only merge if texts are very close in length too
  if (Math.abs(a.text.length - b.text.length) <= 1 && norm(a.text).slice(0, 2) === norm(b.text).slice(0, 2)) {
    return true
  }

  return false
}

// ─── Parse response ───────────────────────────────────────────────────────────

function parseVisionResponse(content, W, H) {
  const items = []
  const seenKeys = new Set()

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const obj = JSON.parse(trimmed)
      if (!obj.text || typeof obj.x !== 'number' || typeof obj.y !== 'number') continue

      // Skip low-confidence items
      if (typeof obj.conf === 'number' && obj.conf < 0.6) continue

      const rawText = String(obj.text).trim()
      if (!rawText) continue

      const x = Math.max(0, Math.min(1, obj.x))
      const y = Math.max(0, Math.min(1, obj.y))
      const key = `${x.toFixed(2)},${y.toFixed(2)}`
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      const clean = rawText.replace(/[^0-9'".ftinmcFTINMCmm°\-\/\s]/g, '').trim()
      const parsed = parseTextDimension(clean) || parseTextDimension(rawText) || tryFallback(rawText)

      const BBOX_W = 0.08
      const BBOX_H = 0.04
      const bbox = {
        x: Math.max(0, x - BBOX_W / 2),
        y: Math.max(0, y - BBOX_H / 2),
        w: BBOX_W,
        h: BBOX_H,
      }

      const dir = obj.axis === 'x' ? 'horizontal' : obj.axis === 'y' ? 'vertical' : 'note'

      items.push({
        text:        rawText,
        normalized:  clean,
        parsedValue: parsed?.value  ?? null,
        parsedUnit:  parsed?.unit   ? normalizeUnit(parsed.unit) : null,
        bbox,
        confidence:  typeof obj.conf === 'number' ? Math.min(0.95, obj.conf) : 0.75,
        type:        classifyLabel(rawText, parsed),
        orientation: 'normal',
        measureDir:  dir,
        source:      'vision',
      })
    } catch (_) {
      // Skip malformed lines
    }
  }

  return items
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tryFallback(text) {
  const spaceMatch = text.match(/^(\d+)\s+(\d+)$/)
  if (spaceMatch) {
    const feet   = parseInt(spaceMatch[1], 10)
    const inches = parseInt(spaceMatch[2], 10)
    if (inches < 12) return { value: feet + inches / 12, unit: 'feet' }
  }
  const plain = parseFloat(text.replace(/[^0-9.]/g, ''))
  if (!isNaN(plain) && plain >= 1 && plain <= 200 && /^\d+(\.\d+)?$/.test(text.trim())) {
    return { value: plain, unit: 'feet' }
  }
  return null
}

function classifyLabel(text, parsed) {
  if (!parsed || parsed.value == null) return 'note'
  const unit = parsed.unit ? normalizeUnit(parsed.unit) : null
  if (unit === 'inches' && parsed.value < 24)  return 'depth'
  if (unit === 'mm'     && parsed.value < 600) return 'depth'
  if (unit === 'feet'   && parsed.value >= 1)  return 'dimension'
  if (unit === 'meters' && parsed.value >= 0.5) return 'dimension'
  if (unit === 'cm'     && parsed.value >= 30) return 'dimension'
  return 'unknown'
}

module.exports = { extractTextVision }
