/**
 * Stage 2 — Text region detection.
 *
 * Uses Tesseract.js to locate text bounding boxes in the preprocessed image.
 * Produces:
 *   1. Array of text region objects with normalised bboxes
 *   2. A binary PNG text mask (white = text, black = background)
 *
 * Mask is built via cv_ops.py (Python OpenCV) or Sharp fallback.
 */

const path  = require('path')
const sharp = require('sharp')
const { runCV } = require('../utils/cvLoader')

const EXPAND = 0.012

// ─── Entry Point ─────────────────────────────────────────────────────────────

async function detectTextRegions(imagePath, sessionId, outputDir) {
  const meta = await sharp(imagePath).metadata()
  const W = meta.width  || 800
  const H = meta.height || 600

  let textBoxes = []

  try {
    const Tesseract = require('tesseract.js')
    textBoxes = await runTesseractDetect(Tesseract, imagePath, W, H)
  } catch (err) {
    console.warn('[textDetect] Tesseract unavailable or failed:', err.message)
  }

  const maskPath = path.join(outputDir, `${sessionId}_textmask.png`)
  await buildTextMask(textBoxes, W, H, maskPath)

  return { textBoxes, maskPath, imageSize: { width: W, height: H } }
}

// ─── Tesseract detection ──────────────────────────────────────────────────────

async function runTesseractDetect(Tesseract, imagePath, W, H) {
  const { data } = await Tesseract.recognize(imagePath, 'eng', {
    logger: () => {},
    tessedit_pageseg_mode: '11',
  })

  const boxes = []
  for (const word of (data.words || [])) {
    if (!word.text || !word.bbox) continue
    if (word.confidence < 15) continue
    if (word.text.trim().length === 0) continue

    const { x0, y0, x1, y1 } = word.bbox
    const nx = x0 / W
    const ny = y0 / H
    const nw = (x1 - x0) / W
    const nh = (y1 - y0) / H

    boxes.push({
      x: Math.max(0, nx - EXPAND),
      y: Math.max(0, ny - EXPAND),
      w: Math.min(1 - nx, nw + EXPAND * 2),
      h: Math.min(1 - ny, nh + EXPAND * 2),
      text: word.text.trim(),
      confidence: word.confidence / 100,
    })
  }

  return boxes
}

// ─── Text mask construction ───────────────────────────────────────────────────

async function buildTextMask(textBoxes, W, H, maskPath) {
  // Try Python/OpenCV first
  try {
    await runCV('build_mask', {
      textBoxes,
      width: W,
      height: H,
      outputPath: maskPath,
    })
    return
  } catch (err) {
    // Fall through to Sharp fallback
  }

  // Sharp fallback
  const base = sharp({
    create: { width: W, height: H, channels: 1, background: { r: 0, g: 0, b: 0 } },
  })

  if (textBoxes.length === 0) {
    await base.png().toFile(maskPath)
    return
  }

  const overlays = textBoxes.map(box => ({
    input: Buffer.alloc(
      Math.max(1, Math.round(box.w * W)) * Math.max(1, Math.round(box.h * H)),
      255
    ),
    raw: {
      width:    Math.max(1, Math.round(box.w * W)),
      height:   Math.max(1, Math.round(box.h * H)),
      channels: 1,
    },
    top:  Math.max(0, Math.round(box.y * H)),
    left: Math.max(0, Math.round(box.x * W)),
  }))

  await base.composite(overlays).png().toFile(maskPath)
}

module.exports = { detectTextRegions }
