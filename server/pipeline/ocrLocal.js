/**
 * Stage 3 — OCR + label parsing (fully deterministic, no LLM).
 *
 * Uses Tesseract.js for text recognition and a custom construction-unit
 * parser to extract structured dimension labels.
 *
 * Construction notation handled:
 *   31'6"  → 31.5 ft
 *   25'6"  → 25.5 ft
 *   7'     → 7 ft
 *   10 ft  → 10 ft
 *   150mm  → 150 mm
 *   40cm   → 40 cm
 *   6"     → 6 in
 *   4.25   → 4.25 (unit inferred from context)
 *
 * Each item is classified as: dimension | depth | note | unknown
 */

const { parseTextDimension, normalizeUnit } = require('../utils/units')

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * @param {string} imagePath
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {Promise<Array<OcrItem>>}
 */
async function extractTextLocal(imagePath, imageWidth, imageHeight) {
  let Tesseract
  try {
    Tesseract = require('tesseract.js')
  } catch (err) {
    console.warn('[ocrLocal] tesseract.js not installed — returning empty OCR results')
    return []
  }

  let data
  try {
    const result = await Tesseract.recognize(imagePath, 'eng', {
      logger: () => {},
      tessedit_pageseg_mode: '11',  // Sparse text — most permissive
    })
    data = result.data
  } catch (err) {
    console.warn('[ocrLocal] Tesseract.recognize failed:', err.message)
    return []
  }

  const W = imageWidth  || 800
  const H = imageHeight || 600

  const items = []
  const seenKeys = new Set()

  // Process individual words
  for (const word of (data.words || [])) {
    if (!word.text || !word.bbox) continue
    if (word.confidence < 20) continue

    const raw = word.text.trim()
    if (raw.length === 0) continue

    const item = buildItem(raw, word.bbox, word.confidence / 100, W, H)
    if (!item) continue

    const key = `${item.bbox.x.toFixed(3)},${item.bbox.y.toFixed(3)}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    items.push(item)
  }

  // Pass 2: Try compound dimensions from adjacent words on the same line
  // e.g. Tesseract reads "31" and "6\"" as separate words — combine them
  for (const line of (data.lines || [])) {
    const words = (line.words || []).filter(w => w.confidence > 20 && w.text?.trim())
    for (let i = 0; i < words.length - 1; i++) {
      const a = words[i]
      const b = words[i + 1]
      const combined = a.text.trim() + b.text.trim()
      const parsed = parseTextDimension(combined)
      if (!parsed || parsed.unit === 'unknown') continue
      // Only keep if it adds a fractional feet value not already captured
      if (parsed.unit !== 'feet' || Number.isInteger(parsed.value)) continue

      const bbox = {
        x0: Math.min(a.bbox.x0, b.bbox.x0),
        y0: Math.min(a.bbox.y0, b.bbox.y0),
        x1: Math.max(a.bbox.x1, b.bbox.x1),
        y1: Math.max(a.bbox.y1, b.bbox.y1),
      }
      const conf = Math.min(a.confidence, b.confidence) / 100
      const item = buildItem(combined, bbox, conf, W, H)
      if (!item) continue

      const key = `${item.bbox.x.toFixed(3)},${item.bbox.y.toFixed(3)}`
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        items.push(item)
      }
    }
  }

  return items
}

// ─── Item construction ────────────────────────────────────────────────────────

function buildItem(rawText, tessBbox, confidence, W, H) {
  // Try to parse as a construction dimension
  const clean = rawText.replace(/[^0-9'".ftinmcFTINMCmm°\-\/\s]/g, '').trim()
  const parsed = parseTextDimension(clean) || parseTextDimension(rawText)
                  || tryFallbackParse(rawText)

  const { x0, y0, x1, y1 } = tessBbox
  const bbox = {
    x: x0 / W,
    y: y0 / H,
    w: Math.max(0.005, (x1 - x0) / W),
    h: Math.max(0.005, (y1 - y0) / H),
  }

  const bw = x1 - x0
  const bh = y1 - y0
  const orientation = bh > bw * 1.6 ? 'rotated_90' : 'normal'

  return {
    text:        rawText,
    normalized:  clean,
    parsedValue: parsed?.value  ?? null,
    parsedUnit:  parsed?.unit   ? normalizeUnit(parsed.unit) : null,
    bbox,
    confidence,
    type:        classifyLabel(rawText, parsed),
    orientation,
  }
}

/**
 * Try alternate parse strategies for tricky OCR output.
 * e.g. "316" might be "31'6"" misread, "31 6" split by spaces.
 */
function tryFallbackParse(text) {
  // "31 6" → "31'6""
  const spaceMatch = text.match(/^(\d+)\s+(\d+)$/)
  if (spaceMatch) {
    const feet = parseInt(spaceMatch[1], 10)
    const inches = parseInt(spaceMatch[2], 10)
    if (inches < 12) return { value: feet + inches / 12, unit: 'feet' }
  }

  // Plain number in plausible deck dimension range → assume feet
  const plain = parseFloat(text.replace(/[^0-9.]/g, ''))
  if (!isNaN(plain) && plain >= 3 && plain <= 120 && /^\d+(\.\d+)?$/.test(text.trim())) {
    return { value: plain, unit: 'feet' }
  }

  return null
}

function classifyLabel(text, parsed) {
  if (!parsed || parsed.value == null) return 'note'

  const unit = parsed.unit ? normalizeUnit(parsed.unit) : null

  // Small inch/mm values are likely pedestal depths
  if (unit === 'inches' && parsed.value < 24) return 'depth'
  if (unit === 'mm'     && parsed.value < 600) return 'depth'

  // Foot/metre/cm values are likely edge dimensions
  if (unit === 'feet'   && parsed.value >= 1) return 'dimension'
  if (unit === 'meters' && parsed.value >= 0.5) return 'dimension'
  if (unit === 'cm'     && parsed.value >= 30) return 'dimension'

  return 'unknown'
}

module.exports = { extractTextLocal }
