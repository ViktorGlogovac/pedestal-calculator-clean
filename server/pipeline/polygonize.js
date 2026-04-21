/**
 * Shapely-based polygon extraction from line segments.
 *
 * This module is the primary polygon recovery path for sketches where the
 * JS face-traversal (candidateGen.js) fails due to corner gaps.
 *
 * It calls cv_ops.py `polygonize` which:
 *   1. Adds orthogonal gap-bridging segments between near-miss endpoints
 *   2. Runs Shapely polygonize() to find all closed rings
 *
 * The gap-bridging step is the key difference from candidateGen: the face
 * traversal requires a perfectly closed planar graph, but polygonize can
 * stitch partial linework into closed polygons.
 *
 * Shapely must be installed in the Python environment:
 *   pip install shapely
 *
 * If Shapely is missing, this function returns [] and the pipeline falls
 * through to the existing contour/trace/bbox fallbacks unchanged.
 */

const { runCV } = require('../utils/cvLoader')

/**
 * Extract closed polygon candidates from a set of line segments using
 * Shapely's polygonize after orthogonal gap-closure.
 *
 * @param {Array}  segments  - Line segments [{p1:{x,y}, p2:{x,y}, ...}] in [0,1]
 * @param {number} width     - Source image pixel width (for gap calculation)
 * @param {number} height    - Source image pixel height
 * @param {object} [opts]
 * @param {number} [opts.gapTolerance=0.030] - Max gap fraction of max(W,H) to bridge
 * @returns {Promise<Array>} Candidates [{id, vertices, area, edgeCount, score, scoreDetails}]
 */
async function polygonizeLines(segments, width, height, opts = {}) {
  if (!segments || segments.length < 3) return []

  let result
  try {
    result = await runCV('polygonize', {
      segments,
      width:        width  || 1000,
      height:       height || 1000,
      gapTolerance: opts.gapTolerance ?? 0.012,
    })
  } catch (err) {
    // Shapely not installed or Python error — degrade silently
    return []
  }

  if (!result || !Array.isArray(result.polygons) || result.polygons.length === 0) {
    return []
  }

  // Convert to the candidate format expected by scorer.js
  return result.polygons.map((poly, i) => ({
    id:           `shapely-${i}`,
    vertices:     poly.vertices,
    area:         poly.area,
    edgeCount:    poly.vertices.length,
    score:        0,           // filled in by scoreCandidates()
    scoreDetails: {},
  }))
}

module.exports = { polygonizeLines }
