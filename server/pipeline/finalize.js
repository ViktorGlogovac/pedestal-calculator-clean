/**
 * Finalization stage: convert a normalized deck plan into canvas-ready shapes.
 *
 * Canvas coordinate system:
 *   gridSize pixels = 100 cm (1 metre)
 *   px = (cm / 100) * gridSize
 *
 * Also produces the structured JSON matching the full canonical output schema
 * (imageMetadata + deckPlan + debug) so the frontend can both render and
 * allow the user to edit all dimensions, depth values, and notes.
 */

const { toCm } = require('../utils/units')

// ─── Entry Points ─────────────────────────────────────────────────────────────

/**
 * Convert the deck plan to canvas pixel shapes for direct rendering.
 *
 * @param {object} deckPlan - output from reason.js buildDeckPlan
 * @param {number} [gridSize=35] - canvas grid size in pixels (1 m = gridSize px)
 * @returns {Array<CanvasShape>}
 */
function toCanvasShapes(deckPlan, gridSize = 35) {
  if (!deckPlan || !deckPlan.outerBoundary || deckPlan.outerBoundary.length < 3) {
    return []
  }

  const unit = deckPlan.unit || 'meters'
  const shapes = []

  // Convert real-world point to canvas pixels
  function toPx(pt) {
    return {
      x: Math.round((toCm(pt.x, unit) / 100) * gridSize),
      y: Math.round((toCm(pt.y, unit) / 100) * gridSize),
    }
  }

  // Determine global offset (normalise to top-left origin with margin)
  const allPts = [...deckPlan.outerBoundary, ...(deckPlan.cutouts || []).flat()]
  if (allPts.length === 0) return []

  const minXcm = Math.min(...allPts.map((p) => toCm(p.x, unit)))
  const minYcm = Math.min(...allPts.map((p) => toCm(p.y, unit)))

  const marginPx = 2 * gridSize

  function convertPoints(pts) {
    return pts.map((pt) => ({
      x: marginPx + Math.round(((toCm(pt.x, unit) - minXcm) / 100) * gridSize),
      y: marginPx + Math.round(((toCm(pt.y, unit) - minYcm) / 100) * gridSize),
    }))
  }

  function toCanvasDimensionLabels(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return []

    return segments.map((seg) => {
      if (!seg?.lengthLabel) return null
      return {
        rawText: seg.lengthLabel.rawText || '',
        value: seg.lengthLabel.value,
        unit: seg.lengthLabel.unit || unit,
      }
    })
  }

  // Main deck shape
  shapes.push({
    name: 'main deck',
    type: 'add',
    isLoopClosed: true,
    points: convertPoints(deckPlan.outerBoundary),
    dimensionLabels: toCanvasDimensionLabels(deckPlan.segments),
  })

  // Cutout shapes
  ;(deckPlan.cutouts || []).forEach((cutout, i) => {
    if (cutout.length >= 3) {
      shapes.push({
        name: `cutout ${i + 1}`,
        type: 'sub',
        isLoopClosed: true,
        points: convertPoints(cutout),
      })
    }
  })

  return shapes
}

function toCanvasDepthPoints(deckPlan, gridSize = 35) {
  if (!deckPlan || !Array.isArray(deckPlan.depthPoints) || deckPlan.depthPoints.length === 0) {
    return []
  }

  const unit = deckPlan.unit || 'meters'
  const allPts = [...(deckPlan.outerBoundary || []), ...((deckPlan.cutouts || []).flat())]
  if (allPts.length === 0) return []

  const minXcm = Math.min(...allPts.map((p) => toCm(p.x, unit)))
  const minYcm = Math.min(...allPts.map((p) => toCm(p.y, unit)))
  const marginPx = 2 * gridSize

  return deckPlan.depthPoints.map((dp) => {
    const xCm = toCm(dp.x, unit)
    const yCm = toCm(dp.y, unit)
    return {
      ...dp,
      canvasPosition: {
        x: marginPx + Math.round(((xCm - minXcm) / 100) * gridSize),
        y: marginPx + Math.round(((yCm - minYcm) / 100) * gridSize),
      },
    }
  })
}

/**
 * Build the full canonical output document for the API response and frontend storage.
 * This includes everything the frontend needs to render AND edit the plan.
 *
 * @param {object} deckPlan   - normalized deck plan from reason.js
 * @param {Array}  canvasShapes - from toCanvasShapes()
 * @param {object} imageMetadata - {width, height} of the original image
 * @param {object} debugData  - raw intermediate pipeline outputs for debug mode
 * @returns {object} Full output document
 */
function buildOutputDocument(deckPlan, canvasShapes, imageMetadata, debugData) {
  if (!deckPlan) {
    return {
      imageMetadata: imageMetadata || { width: 0, height: 0 },
      deckPlan: buildEmptyDeckPlanDoc([]),
      canvasShapes: [],
      debug: debugData || {},
    }
  }

  const unit = deckPlan.unit || 'unknown'

  // Build segments in canonical format
  const segments = (deckPlan.segments || []).map((seg) => ({
    id: seg.id,
    start: seg.start,
    end: seg.end,
    lengthLabel: seg.lengthLabel || null,
    inferred: seg.inferred || false,
    confidence: seg.confidence || 0,
  }))

  // Build depth points in canonical format
  const depthPoints = (deckPlan.depthPoints || []).map((dp) => ({
    id: dp.id,
    position: dp.position,
    depthLabel: dp.depthLabel || null,
    confidence: dp.confidence || 0,
  }))

  // Collect all warnings
  const warnings = deckPlan.allWarnings || []

  return {
    imageMetadata: imageMetadata || { width: 0, height: 0 },
    deckPlan: {
      unit,
      outerBoundary: deckPlan.outerBoundary || [],
      cutouts: deckPlan.cutouts || [],
      segments,
      depthPoints,
      notes: deckPlan.notes || [],
      confidence: deckPlan.confidence || 0,
      boundingBox: deckPlan.boundingBox || null,
      area: deckPlan.area || 0,
      warnings,
    },
    canvasShapes,
    debug: debugData || {},
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildEmptyDeckPlanDoc(warnings) {
  return {
    unit: 'unknown',
    outerBoundary: [],
    cutouts: [],
    segments: [],
    depthPoints: [],
    notes: [],
    confidence: 0,
    boundingBox: null,
    area: 0,
    warnings,
  }
}

module.exports = { toCanvasShapes, toCanvasDepthPoints, buildOutputDocument }
