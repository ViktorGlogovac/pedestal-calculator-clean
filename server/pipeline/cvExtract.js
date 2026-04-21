/**
 * Classical computer vision stage — uses Python + real OpenCV via cv_ops.py.
 *
 * Replaces the @techstark/opencv-js WASM approach. Python subprocess runs
 * real OpenCV C++ (same algorithms, 10-50x faster, no event-loop blocking).
 *
 * Pipeline:
 *   1. Resize image to CV_MAX_DIM via Sharp
 *   2. Run cv_ops.py 'extract' → Canny + HoughLinesP + findContours
 *   3. Apply orthogonal snapping + collinear merge in JS (same as before)
 *
 * Output: { imageSize, lines, contours, corners, textRegions, stats }
 * All coordinates normalised to [0, 1].
 */

const sharp = require('sharp')
const path  = require('path')
const os    = require('os')
const fs    = require('fs')
const { runCV } = require('../utils/cvLoader')

const CV_MAX_DIM          = 800
const HOUGH_MIN_VOTES     = 50
const HOUGH_MIN_LINE_LEN  = 30
const HOUGH_MAX_LINE_GAP  = 10
const LINE_MERGE_DISTANCE = 0.020  // normalised units
const LINE_MERGE_ANGLE    = 5      // degrees

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function extractGeometryCV(imagePath) {
  // Resize to CV_MAX_DIM via Sharp, save temp file for Python
  const tmpPath = path.join(os.tmpdir(), `cv_extract_${Date.now()}.png`)
  try {
    await sharp(imagePath)
      .resize(CV_MAX_DIM, CV_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .png()
      .toFile(tmpPath)

    const result = await runCV('extract', {
      imagePath: tmpPath,
      blurKsize: 5,
      cannyLow: 40,
      cannyHigh: 120,
      houghRho: 1,
      houghMinVotes: HOUGH_MIN_VOTES,
      houghMinLen: HOUGH_MIN_LINE_LEN,
      houghMaxGap: HOUGH_MAX_LINE_GAP,
      minContourArea: 500,
      approxEpsilonFactor: 0.01,
    })

    // Apply orthogonal snapping + collinear merge in JS
    const snapped = snapOrthogonal(result.lines)
    const merged  = mergeCollinearLines(snapped)

    return {
      imageSize:   result.imageSize,
      lines:       merged,
      contours:    result.contours,
      corners:     result.corners,
      textRegions: result.textRegions,
      stats: {
        ...result.stats,
        lineCount: merged.length,
      },
    }
  } finally {
    fs.unlink(tmpPath, () => {})
  }
}

// ─── Orthogonal Snapping ──────────────────────────────────────────────────────

const SNAP_DEG = 8

function snapOrthogonal(lines) {
  return lines.map(l => {
    const angle = ((l.angle % 180) + 180) % 180
    const isNearH = angle <= SNAP_DEG || angle >= 180 - SNAP_DEG
    const isNearV = Math.abs(angle - 90) <= SNAP_DEG

    if (!isNearH && !isNearV) return l

    const { p1, p2 } = l
    if (isNearH) {
      const y = (p1.y + p2.y) / 2
      return { ...l, p1: { x: p1.x, y }, p2: { x: p2.x, y }, angle: 0 }
    } else {
      const x = (p1.x + p2.x) / 2
      return { ...l, p1: { x, y: p1.y }, p2: { x, y: p2.y }, angle: 90 }
    }
  })
}

// ─── Merge Collinear Lines ────────────────────────────────────────────────────

function mergeCollinearLines(lines) {
  if (lines.length === 0) return lines

  const merged = new Array(lines.length).fill(false)
  const result = []

  for (let i = 0; i < lines.length; i++) {
    if (merged[i]) continue
    const group = [lines[i]]

    for (let j = i + 1; j < lines.length; j++) {
      if (merged[j]) continue
      const li = lines[i]
      const lj = lines[j]

      const ai = ((li.angle % 180) + 180) % 180
      const aj = ((lj.angle % 180) + 180) % 180
      let angleDiff = Math.abs(ai - aj)
      if (angleDiff > 90) angleDiff = 180 - angleDiff
      if (angleDiff > LINE_MERGE_ANGLE) continue

      const mi = { x: (li.p1.x + li.p2.x) / 2, y: (li.p1.y + li.p2.y) / 2 }
      const mj = { x: (lj.p1.x + lj.p2.x) / 2, y: (lj.p1.y + lj.p2.y) / 2 }
      const dx = mi.x - mj.x
      const dy = mi.y - mj.y
      if (Math.sqrt(dx * dx + dy * dy) > LINE_MERGE_DISTANCE) continue

      group.push(lj)
      merged[j] = true
    }

    const best = group.reduce((a, b) => (b.length > a.length ? b : a))
    result.push({ ...best, votes: group.length })
  }

  return result
}

module.exports = { extractGeometryCV }
