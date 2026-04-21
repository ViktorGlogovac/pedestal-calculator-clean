/**
 * Image preprocessing stage.
 *
 * Purpose: Improve sketch image quality before classical CV and AI reasoning.
 * Applying preprocessing significantly reduces noise, improves line detection,
 * and makes handwritten text more legible for OCR.
 *
 * Steps applied (in order):
 *   1. Resize — cap at MAX_DIMENSION to limit downstream compute cost
 *   2. Grayscale — remove color noise; construction sketches are monochrome
 *   3. Normalise — auto-levels (stretch histogram to full range)
 *   4. Sharpen — enhance edge contrast with a mild sigma
 *   5. Linear contrast boost — make pen/pencil strokes stand out from paper
 *   6. Adaptive contrast via modulate — final brightness adjustment
 *   7. Perspective correction — rough deskew using document corner detection
 *      (best-effort; falls back gracefully if no clear document boundary found)
 *   8. Lined-paper suppression — remove regular horizontal notebook lines
 *      by detecting them as horizontal edges and attenuating them
 *
 * All operations use Sharp (no native OpenCV bindings required).
 */

const sharp = require('sharp')
const path = require('path')
const fs = require('fs')
const { runCV } = require('../utils/cvLoader')

const MAX_DIMENSION = 1024 // Cap long edge — smaller is faster and less noisy for CV

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * Preprocess an image and save the result alongside the original.
 *
 * @param {string} originalPath - absolute path to uploaded image
 * @param {string} sessionId    - used to name the output file
 * @param {string} [uploadsDir] - directory for output (defaults to same dir as original)
 * @returns {Promise<{preprocessedPath, width, height, base64}>}
 */
async function preprocessImage(originalPath, sessionId, uploadsDir) {
  if (!fs.existsSync(originalPath)) {
    throw new Error(`Original image not found at: ${originalPath}`)
  }

  const outputDir = uploadsDir || path.dirname(originalPath)
  const preprocessedPath = path.join(outputDir, `${sessionId}_preprocessed.png`)

  // Fetch original metadata
  const metadata = await sharp(originalPath).metadata()
  const origWidth = metadata.width || 0
  const origHeight = metadata.height || 0

  // ── Step 1-6: Core quality pipeline ───────────────────────────────────────
  // Each step is applied sequentially; order matters:
  //   grayscale first so later ops work on single-channel data,
  //   normalise before sharpen so sharpening uses full dynamic range.
  let pipeline = sharp(originalPath)
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .grayscale()          // Remove color noise
    .normalise()          // Auto-levels: stretch to [0, 255]
    .sharpen({ sigma: 1.5, m1: 1.0, m2: 3.0 }) // Enhance edges
    .linear(1.35, -25)    // Contrast boost: out = 1.35*in - 25
    .modulate({ brightness: 1.08, saturation: 0 }) // Final brightness nudge

  // ── Step 7: Lined-paper suppression ───────────────────────────────────────
  // Notebook lines are evenly-spaced horizontal lines that confuse the CV stage.
  // We detect if the image likely has regular horizontal lines and attenuate them
  // using a mild vertical blur pass (which smears and weakens horizontal features).
  //
  // We use a selective approach: detect horizontal line periodicity from the pixel
  // data, and if strong regular lines are found, apply a targeted vertical median
  // filter via a sharp convolution kernel.
  //
  // Implementation: a 1×3 vertical averaging kernel reduces regular horizontal
  // fine lines without significantly blurring the sketch geometry.
  const hasLinedPaper = await detectLinedPaper(originalPath)
  if (hasLinedPaper) {
    // Apply a subtle vertical 1×3 mean kernel to attenuate horizontal lines.
    // This is less aggressive than full line removal (which could erase thin segment lines).
    pipeline = pipeline.convolve({
      width: 1,
      height: 3,
      kernel: [1, 2, 1], // Weighted vertical average (emphasises centre pixel)
      scale: 4,
      offset: 0,
    })
  }

  // Save intermediate image
  await pipeline.png().toFile(preprocessedPath)

  // ── Step 7b: OpenCV adaptive threshold + morphological close ───────────────
  // Replaces the simple linear contrast with a locally-adaptive binarisation
  // that handles uneven lighting across the sketch.
  // Also applies a morphological close to bridge tiny gaps in drawn lines.
  const enhancedPath = await applyAdaptiveThreshold(preprocessedPath, sessionId, outputDir)
    .catch(() => preprocessedPath)  // Fall back if OpenCV unavailable

  // ── Step 8: Perspective correction (best-effort) ───────────────────────────
  // Try to detect if the document was photographed at an angle and correct it.
  // This uses Sharp's metadata + a simple crop-to-content approach.
  // Full homography-based correction requires OpenCV; here we do a best-effort
  // affine approximation by detecting the document bounding quad.
  const correctedPath = await tryPerspectiveCorrection(enhancedPath, sessionId, outputDir)

  // Get final dimensions
  const finalMeta = await sharp(correctedPath).metadata()

  // Read back as base64
  const base64 = fs.readFileSync(correctedPath).toString('base64')

  return {
    preprocessedPath: correctedPath,
    width: finalMeta.width || origWidth,
    height: finalMeta.height || origHeight,
    base64,
  }
}

// ─── OpenCV Adaptive Threshold + Morphological Close ─────────────────────────

/**
 * Apply adaptive thresholding (handles uneven lighting) and morphological
 * closing (bridges small gaps in hand-drawn lines).
 *
 * Uses OpenCV WASM if available; falls back to the Sharp-processed image on error.
 *
 * @param {string} imagePath
 * @param {string} sessionId
 * @param {string} outputDir
 * @returns {Promise<string>} path to enhanced image
 */
async function applyAdaptiveThreshold(imagePath, sessionId, outputDir) {
  const outPath = path.join(outputDir, `${sessionId}_adaptive.png`)
  const result = await runCV('preprocess', {
    imagePath,
    outputPath: outPath,
  })
  return result.outputPath
}

// ─── Lined Paper Detection ────────────────────────────────────────────────────

/**
 * Detect whether the image likely contains regular horizontal notebook lines.
 *
 * Strategy: compute row-wise average intensity. If many rows have similar
 * low intensity values (dark lines) with a regular spacing, flag as lined paper.
 *
 * @param {string} imagePath
 * @returns {Promise<boolean>}
 */
async function detectLinedPaper(imagePath) {
  try {
    // Downscale to speed up analysis
    const { data, info } = await sharp(imagePath)
      .grayscale()
      .resize(200, 300, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    const { width, height } = info
    const pixels = new Uint8Array(data)

    // Compute mean intensity per row
    const rowMeans = new Float32Array(height)
    for (let y = 0; y < height; y++) {
      let sum = 0
      for (let x = 0; x < width; x++) {
        sum += pixels[y * width + x]
      }
      rowMeans[y] = sum / width
    }

    // Find rows that are noticeably darker than their neighbors (potential lines)
    const globalMean = rowMeans.reduce((a, b) => a + b, 0) / height
    const darkRows = []
    for (let y = 1; y < height - 1; y++) {
      if (rowMeans[y] < globalMean * 0.85) darkRows.push(y)
    }

    if (darkRows.length < 4) return false

    // Check if dark rows have roughly regular spacing (hallmark of notebook lines)
    const gaps = []
    for (let i = 1; i < darkRows.length; i++) {
      gaps.push(darkRows[i] - darkRows[i - 1])
    }
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const gapVariance = gaps.reduce((s, g) => s + (g - meanGap) ** 2, 0) / gaps.length
    const gapStdDev = Math.sqrt(gapVariance)

    // Regular lines: mean gap 5-20px (at 300px height), std dev < 30% of mean
    const isRegular = meanGap >= 4 && meanGap <= 25 && gapStdDev < meanGap * 0.35

    return isRegular && darkRows.length >= 6
  } catch (err) {
    // If detection fails, assume no lined paper (safe fallback)
    return false
  }
}

// ─── Perspective Correction ───────────────────────────────────────────────────

/**
 * Best-effort perspective correction.
 *
 * Full homography correction is not possible with Sharp alone.
 * This function detects the largest rectangular content region
 * and crops/trims to it, which handles minor rotation and framing.
 *
 * For severe perspective distortion (e.g. image taken at >30° angle),
 * this will not fully correct the image but will reduce the effect.
 *
 * @param {string} imagePath     - path to preprocessed image
 * @param {string} sessionId
 * @param {string} outputDir
 * @returns {Promise<string>} path to corrected image (may be same as input)
 */
async function tryPerspectiveCorrection(imagePath, sessionId, outputDir) {
  try {
    const correctedPath = path.join(outputDir, `${sessionId}_corrected.png`)

    // Detect dominant rotation angle by analyzing edge pixel distribution
    const angle = await detectDocumentRotation(imagePath)

    // Only rotate if there's a meaningful skew angle (> 0.5° and < 15°)
    // Larger angles may indicate a legitimate perspective that shouldn't be corrected here
    if (Math.abs(angle) > 0.5 && Math.abs(angle) < 15) {
      await sharp(imagePath)
        .rotate(angle, { background: { r: 255, g: 255, b: 255 } })
        .trim({ background: '#ffffff', threshold: 10 })
        .png()
        .toFile(correctedPath)
      return correctedPath
    }

    // No significant rotation — trim whitespace/padding only
    await sharp(imagePath)
      .trim({ background: '#ffffff', threshold: 15 })
      .png()
      .toFile(correctedPath)
      .catch(() => {
        // trim can fail if the entire image is one color — just copy
        fs.copyFileSync(imagePath, correctedPath)
      })

    return correctedPath
  } catch (err) {
    // Any failure → return original preprocessed image unchanged
    console.warn('[preprocess] Perspective correction failed, using preprocessed image:', err.message)
    return imagePath
  }
}

/**
 * Estimate the dominant rotation angle of a document in an image.
 *
 * Strategy: compute the Sobel gradient on a small version of the image,
 * then look at the distribution of edge orientations. The dominant
 * orientation of ~vertical edges reveals the document tilt.
 *
 * Returns the estimated rotation in degrees (positive = clockwise).
 * Returns 0 if no clear rotation is detected.
 */
async function detectDocumentRotation(imagePath) {
  try {
    const { data, info } = await sharp(imagePath)
      .grayscale()
      .resize(300, 400, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    const { width, height } = info
    const pixels = new Uint8Array(data)

    // Simple Sobel horizontal/vertical gradient
    const angles = []
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const gx =
          -pixels[(y - 1) * width + (x - 1)] + pixels[(y - 1) * width + (x + 1)] +
          -2 * pixels[y * width + (x - 1)] + 2 * pixels[y * width + (x + 1)] +
          -pixels[(y + 1) * width + (x - 1)] + pixels[(y + 1) * width + (x + 1)]

        const gy =
          -pixels[(y - 1) * width + (x - 1)] - 2 * pixels[(y - 1) * width + x] - pixels[(y - 1) * width + (x + 1)] +
          pixels[(y + 1) * width + (x - 1)] + 2 * pixels[(y + 1) * width + x] + pixels[(y + 1) * width + (x + 1)]

        const mag = Math.sqrt(gx * gx + gy * gy)
        if (mag > 40) {
          // Edge pixel — record orientation
          const angle = Math.atan2(gy, gx) * 180 / Math.PI
          angles.push(angle)
        }
      }
    }

    if (angles.length < 100) return 0

    // Build histogram of angles in [-90, 90] range
    // Dominant near-vertical edges (around 90°) indicate document boundaries
    const bucketSize = 1 // 1° resolution
    const buckets = new Int32Array(180)
    for (const a of angles) {
      const normalized = ((a % 180) + 180) % 180
      const bucket = Math.floor(normalized)
      if (bucket >= 0 && bucket < 180) buckets[bucket]++
    }

    // Find peak in region near-vertical (60-120°)
    let maxCount = 0
    let peakAngle = 90
    for (let a = 65; a <= 115; a++) {
      if (buckets[a] > maxCount) {
        maxCount = buckets[a]
        peakAngle = a
      }
    }

    // Convert peak to rotation correction
    const rotation = peakAngle - 90
    return rotation
  } catch (err) {
    return 0
  }
}

module.exports = { preprocessImage }
