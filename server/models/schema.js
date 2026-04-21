/**
 * Validation and repair helpers for all pipeline data structures.
 *
 * No external schema library required — plain JS only.
 *
 * Covers:
 *   - OCR response validation (validateOCRResponse)
 *   - Raw deck plan validation/repair (validateRawDeckPlan / repairRawDeckPlan)
 *   - Legacy geometry response validation (kept for backward compatibility)
 */

const DIRECTIONS = ['RIGHT', 'LEFT', 'UP', 'DOWN']
const VALID_UNITS = ['m', 'ft', 'in', 'meters', 'feet', 'inches', 'cm']
const VALID_OCR_TYPES = ['dimension', 'depth', 'note', 'unknown']

// ─── OCR Response ─────────────────────────────────────────────────────────────

/**
 * Validate an OCR API response object.
 */
function validateOCRResponse(obj) {
  const errors = []
  if (!obj || typeof obj !== 'object') {
    errors.push('Response is not an object')
    return { valid: false, errors }
  }
  if (!Array.isArray(obj.items)) {
    errors.push('Response missing "items" array')
    return { valid: false, errors }
  }
  obj.items.forEach((item, i) => {
    if (typeof item.text !== 'string') errors.push(`items[${i}].text must be a string`)
    if (item.bbox) {
      const { x, y, w, h } = item.bbox
      if ([x, y, w, h].some((v) => typeof v !== 'number')) {
        errors.push(`items[${i}].bbox must have numeric x,y,w,h`)
      }
    }
    if (item.type && !VALID_OCR_TYPES.includes(item.type)) {
      errors.push(`items[${i}].type "${item.type}" must be one of ${VALID_OCR_TYPES.join(', ')}`)
    }
  })
  return { valid: errors.length === 0, errors }
}

// ─── Raw Deck Plan (new schema) ───────────────────────────────────────────────

/**
 * Validate a raw deck plan produced by geometry.js.
 */
function validateRawDeckPlan(obj) {
  const errors = []

  if (!obj || typeof obj !== 'object') {
    errors.push('Response is not an object')
    return { valid: false, errors }
  }

  if (!Array.isArray(obj.outerBoundary)) {
    errors.push('outerBoundary must be an array')
  } else {
    if (obj.outerBoundary.length < 3) {
      errors.push(`outerBoundary has only ${obj.outerBoundary.length} vertices (need >= 3)`)
    }
    obj.outerBoundary.forEach((pt, i) => {
      if (typeof pt.x !== 'number' || typeof pt.y !== 'number') {
        errors.push(`outerBoundary[${i}] must have numeric x and y`)
      }
    })
  }

  if (obj.cutouts !== undefined && !Array.isArray(obj.cutouts)) {
    errors.push('"cutouts" must be an array if present')
  }

  if (obj.segments !== undefined && !Array.isArray(obj.segments)) {
    errors.push('"segments" must be an array if present')
  } else if (Array.isArray(obj.segments)) {
    obj.segments.forEach((seg, i) => {
      if (!seg.start || typeof seg.start.x !== 'number') errors.push(`segments[${i}].start is invalid`)
      if (!seg.end || typeof seg.end.x !== 'number') errors.push(`segments[${i}].end is invalid`)
    })
  }

  if (typeof obj.confidence !== 'number') {
    errors.push('"confidence" must be a number')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Repair common issues in a raw deck plan response.
 * - Ensures all required arrays exist
 * - Converts string numbers to numbers
 * - Normalizes unit string
 * - Ensures confidence is in [0,1]
 * - Adds missing ids to segments / depthPoints
 */
function repairRawDeckPlan(obj) {
  if (!obj || typeof obj !== 'object') return { outerBoundary: [], cutouts: [], segments: [], depthPoints: [], notes: [], confidence: 0, warnings: [] }

  // Unit
  if (typeof obj.unit !== 'string' || !obj.unit) {
    obj.unit = 'unknown'
  }

  // outerBoundary
  if (!Array.isArray(obj.outerBoundary)) {
    obj.outerBoundary = []
  } else {
    obj.outerBoundary = obj.outerBoundary
      .filter((pt) => pt && typeof pt === 'object')
      .map((pt) => ({
        x: toFloat(pt.x, 0),
        y: toFloat(pt.y, 0),
      }))
  }

  // cutouts
  if (!Array.isArray(obj.cutouts)) {
    obj.cutouts = []
  } else {
    obj.cutouts = obj.cutouts
      .filter((c) => Array.isArray(c))
      .map((cutout) =>
        cutout
          .filter((pt) => pt && typeof pt === 'object')
          .map((pt) => ({ x: toFloat(pt.x, 0), y: toFloat(pt.y, 0) }))
      )
      .filter((c) => c.length >= 3)
  }

  // segments
  if (!Array.isArray(obj.segments)) {
    obj.segments = []
  } else {
    obj.segments = obj.segments
      .filter((s) => s && typeof s === 'object' && s.start && s.end)
      .map((s, i) => {
        const repaired = {
          id: s.id || `s${i + 1}`,
          start: { x: toFloat(s.start?.x, 0), y: toFloat(s.start?.y, 0) },
          end: { x: toFloat(s.end?.x, 0), y: toFloat(s.end?.y, 0) },
          inferred: typeof s.inferred === 'boolean' ? s.inferred : false,
          confidence: clamp01(toFloat(s.confidence, 0.5)),
        }
        if (s.lengthLabel && typeof s.lengthLabel === 'object') {
          repaired.lengthLabel = {
            rawText: String(s.lengthLabel.rawText || ''),
            value: toFloat(s.lengthLabel.value, null),
            unit: s.lengthLabel.unit || obj.unit || null,
            confidence: clamp01(toFloat(s.lengthLabel.confidence, 0.5)),
          }
        } else {
          repaired.lengthLabel = null
        }
        return repaired
      })
  }

  // depthPoints
  if (!Array.isArray(obj.depthPoints)) {
    obj.depthPoints = []
  } else {
    obj.depthPoints = obj.depthPoints
      .filter((dp) => dp && dp.position)
      .map((dp, i) => {
        const repaired = {
          id: dp.id || `p${i + 1}`,
          position: { x: toFloat(dp.position?.x, 0), y: toFloat(dp.position?.y, 0) },
          confidence: clamp01(toFloat(dp.confidence, 0.5)),
        }
        if (dp.depthLabel && typeof dp.depthLabel === 'object') {
          repaired.depthLabel = {
            rawText: String(dp.depthLabel.rawText || ''),
            value: toFloat(dp.depthLabel.value, null),
            unit: dp.depthLabel.unit || 'in',
            confidence: clamp01(toFloat(dp.depthLabel.confidence, 0.5)),
          }
        } else {
          repaired.depthLabel = null
        }
        return repaired
      })
  }

  // notes
  if (!Array.isArray(obj.notes)) {
    obj.notes = []
  } else {
    obj.notes = obj.notes.filter((n) => n && typeof n.text === 'string').map((n) => ({
      text: n.text,
      bbox: n.bbox || null,
      confidence: clamp01(toFloat(n.confidence, 0.4)),
    }))
  }

  // confidence
  obj.confidence = clamp01(toFloat(obj.confidence, 0.5))

  // warnings
  if (!Array.isArray(obj.warnings)) obj.warnings = []

  return obj
}

// ─── Legacy geometry response (directed walk) — kept for compatibility ────────

/**
 * Validate a legacy directed-walk geometry response (old pipeline format).
 */
function validateGeometryResponse(obj) {
  const errors = []
  if (!obj || typeof obj !== 'object') {
    errors.push('Response is not an object')
    return { valid: false, errors }
  }
  if (!Array.isArray(obj.segments)) {
    errors.push('Response missing "segments" array')
    return { valid: false, errors }
  }
  if (obj.segments.length === 0) errors.push('segments array is empty')
  obj.segments.forEach((seg, i) => {
    if (!DIRECTIONS.includes(seg.direction)) {
      errors.push(`segments[${i}].direction "${seg.direction}" must be one of ${DIRECTIONS.join(', ')}`)
    }
    if (typeof seg.distance !== 'number' || seg.distance <= 0) {
      errors.push(`segments[${i}].distance must be a positive number`)
    }
  })
  return { valid: errors.length === 0, errors }
}

/**
 * Repair a legacy directed-walk geometry response.
 */
function repairGeometryResponse(obj) {
  if (!obj || typeof obj !== 'object') return obj

  if (Array.isArray(obj.segments)) {
    obj.segments = obj.segments
      .map((seg) => {
        if (!seg || typeof seg !== 'object') return null
        const r = { ...seg }
        if (typeof r.direction === 'string') {
          r.direction = r.direction.toUpperCase().trim()
          if (r.direction === 'NORTH' || r.direction === 'U') r.direction = 'UP'
          if (r.direction === 'SOUTH' || r.direction === 'D') r.direction = 'DOWN'
          if (r.direction === 'EAST' || r.direction === 'R') r.direction = 'RIGHT'
          if (r.direction === 'WEST' || r.direction === 'L') r.direction = 'LEFT'
        }
        if (typeof r.distance === 'string') r.distance = parseFloat(r.distance)
        if (typeof r.inferred !== 'boolean') r.inferred = false
        if (!r.labelSource) r.labelSource = 'unknown'
        return r
      })
      .filter((s) => s !== null && DIRECTIONS.includes(s.direction) && typeof s.distance === 'number' && s.distance > 0)
  }

  if (!Array.isArray(obj.cutouts)) obj.cutouts = []
  else {
    obj.cutouts = obj.cutouts
      .filter((c) => Array.isArray(c))
      .map((cutout) =>
        cutout
          .map((seg) => {
            if (!seg || typeof seg !== 'object') return null
            const r = { ...seg }
            if (typeof r.direction === 'string') r.direction = r.direction.toUpperCase().trim()
            if (typeof r.distance === 'string') r.distance = parseFloat(r.distance)
            if (typeof r.inferred !== 'boolean') r.inferred = false
            if (!r.labelSource) r.labelSource = 'unknown'
            return r
          })
          .filter((s) => s !== null && DIRECTIONS.includes(s.direction) && typeof s.distance === 'number' && s.distance > 0)
      )
      .filter((c) => c.length > 0)
  }

  if (typeof obj.unit !== 'string' || !obj.unit) obj.unit = 'ft'
  if (typeof obj.confidence !== 'number') obj.confidence = 0.5
  if (!Array.isArray(obj.warnings)) obj.warnings = []

  // Preserve depthPoints and notes if present (new prompt format)
  if (!Array.isArray(obj.depthPoints)) obj.depthPoints = []
  if (!Array.isArray(obj.notes)) obj.notes = []

  return obj
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function toFloat(val, fallback) {
  if (val === null || val === undefined) return fallback
  const n = parseFloat(val)
  return isNaN(n) ? fallback : n
}

function clamp01(n) {
  if (n === null || n === undefined || isNaN(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

module.exports = {
  validateOCRResponse,
  validateRawDeckPlan,
  repairRawDeckPlan,
  validateGeometryResponse,
  repairGeometryResponse,
  DIRECTIONS,
  VALID_UNITS,
}
