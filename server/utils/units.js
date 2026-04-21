/**
 * Unit normalization and conversion utilities for deck dimension parsing.
 *
 * Handles the full range of construction notation found in hand-drawn plans:
 *   • US feet-inches: 31'6", 25'6", 15'9", 7', 9'
 *   • Metric: 5m, 3.5 meters, 150mm, 40cm
 *   • Plain numbers (unit inferred from context)
 *   • Unicode/OCR variants: ′ (prime), ″ (double prime), backtick, etc.
 */

/**
 * Normalize a unit string to a canonical form.
 * @param {string} str
 * @returns {'meters'|'feet'|'inches'|'cm'|'mm'|'unknown'}
 */
function normalizeUnit(str) {
  if (!str || typeof str !== 'string') return 'unknown'
  const s = str.trim().toLowerCase()

  if (s === 'm' || s === 'meters' || s === 'meter' || s === 'metre' || s === 'metres') {
    return 'meters'
  }
  // Accept Unicode prime (′ U+2032) and backtick as foot marker
  if (s === 'ft' || s === 'feet' || s === 'foot' || s === "'" || s === '\u2032' || s === '`' || s === 'feets') {
    return 'feet'
  }
  // Accept Unicode double prime (″ U+2033)
  if (s === 'in' || s === 'inch' || s === 'inches' || s === '"' || s === '\u2033' || s === '\"') {
    return 'inches'
  }
  if (s === 'cm' || s === 'centimeter' || s === 'centimeters' || s === 'centimetre' || s === 'centimetres') {
    return 'cm'
  }
  if (s === 'mm' || s === 'millimeter' || s === 'millimeters' || s === 'millimetre' || s === 'millimetres') {
    return 'mm'
  }
  return 'unknown'
}

/**
 * Convert a value in the given unit to centimeters.
 * @param {number} value
 * @param {string} unit
 * @returns {number} value in cm
 */
function toCm(value, unit) {
  const normalized = normalizeUnit(unit)
  switch (normalized) {
    case 'meters':  return value * 100
    case 'feet':    return value * 30.48
    case 'inches':  return value * 2.54
    case 'cm':      return value
    case 'mm':      return value * 0.1
    default:
      if (unit === 'm')  return value * 100
      if (unit === 'ft' || unit === "'" || unit === '\u2032') return value * 30.48
      if (unit === 'in' || unit === '"' || unit === '\u2033') return value * 2.54
      if (unit === 'mm') return value * 0.1
      // default: assume feet (most common for US deck plans)
      return value * 30.48
  }
}

/**
 * Parse a text dimension string into { value, unit }.
 *
 * Handles:
 *   "31'6""  → { value: 31.5, unit: 'feet' }
 *   "25'6""  → { value: 25.5, unit: 'feet' }
 *   "15'9""  → { value: 15.75, unit: 'feet' }
 *   "7'"     → { value: 7, unit: 'feet' }
 *   "33"     → { value: 33, unit: 'unknown' }
 *   "5m"     → { value: 5, unit: 'meters' }
 *   "150mm"  → { value: 150, unit: 'mm' }
 *   "4.25"   → { value: 4.25, unit: 'unknown' }
 *
 * @param {string} text
 * @returns {{value: number, unit: string}|null}
 */
function parseTextDimension(text) {
  if (!text || typeof text !== 'string') return null
  const s = text.trim()

  // ── Feet-inches combined ──────────────────────────────────────────────────
  // e.g. 31'6", 25'6", 15'9", 25' 6", 31′6″ (unicode primes)
  // Also handles OCR variants: 31`6" 31'6 (missing closing quote)
  const feetInchesRe = /^(\d+(?:\.\d+)?)\s*['\u2032`]\s*(\d+(?:\.\d+)?)\s*["\u2033]?$/
  const feetInchesMatch = s.match(feetInchesRe)
  if (feetInchesMatch) {
    const feet = parseFloat(feetInchesMatch[1])
    const inches = parseFloat(feetInchesMatch[2])
    return { value: feet + inches / 12, unit: 'feet' }
  }

  // ── Feet only ─────────────────────────────────────────────────────────────
  // e.g. 7', 9', 44', 33', 10.5', 7′
  const feetOnlyRe = /^(\d+(?:\.\d+)?)\s*['\u2032`]$/
  const feetOnlyMatch = s.match(feetOnlyRe)
  if (feetOnlyMatch) {
    return { value: parseFloat(feetOnlyMatch[1]), unit: 'feet' }
  }

  // ── Inches only ───────────────────────────────────────────────────────────
  // e.g. 6", 10", 4.25"
  const inchesOnlyRe = /^(\d+(?:\.\d+)?)\s*["\u2033]$/
  const inchesOnlyMatch = s.match(inchesOnlyRe)
  if (inchesOnlyMatch) {
    return { value: parseFloat(inchesOnlyMatch[1]), unit: 'inches' }
  }

  // ── Number followed by unit string ────────────────────────────────────────
  // e.g. 5m, 10ft, 3.5 meters, 72in, 150mm, 40cm
  const withUnitRe = /^(\d+(?:\.\d+)?)\s*(mm|cm|m|meters?|metres?|ft|feet|foot|in|inches?)$/i
  const withUnitMatch = s.match(withUnitRe)
  if (withUnitMatch) {
    const value = parseFloat(withUnitMatch[1])
    const unit = normalizeUnit(withUnitMatch[2])
    if (unit !== 'unknown') return { value, unit }
  }

  // ── Plain number (no unit) ────────────────────────────────────────────────
  const plainRe = /^(\d+(?:\.\d+)?)$/
  const plainMatch = s.match(plainRe)
  if (plainMatch) {
    return { value: parseFloat(plainMatch[1]), unit: 'unknown' }
  }

  return null
}

module.exports = { normalizeUnit, toCm, parseTextDimension }
