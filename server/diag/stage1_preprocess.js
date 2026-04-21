#!/usr/bin/env node
/**
 * Stage 1 Diagnostic — Preprocessing
 *
 * Runs each preprocessing step in isolation and saves intermediate images
 * so you can see exactly what each step does to the sketch.
 *
 * Usage:
 *   node server/diag/stage1_preprocess.js [path/to/image.jpg]
 *
 * Outputs to server/diag/out/ :
 *   01_original.png
 *   02_grayscale.png
 *   03_normalised.png
 *   04_sharpened.png
 *   05_contrast.png
 *   06_adaptive_thresh.png   (OpenCV)
 *   07_morph_close.png       (OpenCV)
 *   08_rotation_corrected.png
 *   09_lined_paper_suppressed.png  (if lined paper detected)
 *   REPORT.txt               — what was detected at each step
 */

const path = require('path')
const fs = require('fs')
const sharp = require('sharp')
const { loadOpenCV } = require('../utils/cvLoader')

const INPUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '../uploads/test_sketch.jpg')

// Match what cvExtract.js uses — WASM is slow on large images
const MAX_DIM = 800

const OUT_DIR = path.join(__dirname, 'out')
fs.mkdirSync(OUT_DIR, { recursive: true })

const report = []
function log(msg) { console.log(msg); report.push(msg) }

async function run() {
  log(`Input: ${INPUT}`)
  log(`Output: ${OUT_DIR}\n`)

  if (!fs.existsSync(INPUT)) {
    console.error('File not found:', INPUT)
    process.exit(1)
  }

  // ── 01 Original ────────────────────────────────────────────────────────────
  const meta = await sharp(INPUT).metadata()
  log(`[01] Original: ${meta.width}×${meta.height} ${meta.format}`)
  await sharp(INPUT)
    .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .png().toFile(path.join(OUT_DIR, '01_original.png'))

  // ── 02 Grayscale ───────────────────────────────────────────────────────────
  log(`[02] Grayscale`)
  await sharp(INPUT)
    .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .png().toFile(path.join(OUT_DIR, '02_grayscale.png'))

  // ── 03 Normalised ──────────────────────────────────────────────────────────
  log(`[03] Normalised (auto-levels)`)
  await sharp(INPUT)
    .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .grayscale().normalise()
    .png().toFile(path.join(OUT_DIR, '03_normalised.png'))

  // ── 04 Sharpened ───────────────────────────────────────────────────────────
  log(`[04] Sharpened (sigma=1.5)`)
  await sharp(INPUT)
    .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .grayscale().normalise()
    .sharpen({ sigma: 1.5, m1: 1.0, m2: 3.0 })
    .png().toFile(path.join(OUT_DIR, '04_sharpened.png'))

  // ── 05 Contrast boost ──────────────────────────────────────────────────────
  log(`[05] Contrast boost (1.35×, -25)`)
  await sharp(INPUT)
    .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .grayscale().normalise()
    .sharpen({ sigma: 1.5, m1: 1.0, m2: 3.0 })
    .linear(1.35, -25)
    .png().toFile(path.join(OUT_DIR, '05_contrast.png'))

  // ── 06+07 Adaptive threshold + morph close (OpenCV) ───────────────────────
  log(`[06] Adaptive threshold + [07] Morph close (OpenCV)`)
  await applyOpenCV(INPUT, OUT_DIR)

  // ── 08 Rotation detection ─────────────────────────────────────────────────
  const angle = await detectRotation(path.join(OUT_DIR, '05_contrast.png'))
  log(`[08] Detected rotation: ${angle.toFixed(2)}°`)
  if (Math.abs(angle) > 0.5) {
    log(`     → Applying rotation correction`)
    await sharp(path.join(OUT_DIR, '07_morph_close.png'))
      .rotate(angle, { background: { r: 255, g: 255, b: 255 } })
      .trim({ background: '#ffffff', threshold: 10 })
      .png().toFile(path.join(OUT_DIR, '08_rotation_corrected.png'))
  } else {
    log(`     → No rotation needed`)
    fs.copyFileSync(path.join(OUT_DIR, '07_morph_close.png'), path.join(OUT_DIR, '08_rotation_corrected.png'))
  }

  // ── 09 Lined paper detection ───────────────────────────────────────────────
  const hasLines = await detectLinedPaper(INPUT)
  log(`[09] Lined paper detected: ${hasLines}`)
  if (hasLines) {
    log(`     → Applying vertical suppression kernel`)
    await sharp(path.join(OUT_DIR, '08_rotation_corrected.png'))
      .convolve({ width: 1, height: 3, kernel: [1, 2, 1], scale: 4, offset: 0 })
      .png().toFile(path.join(OUT_DIR, '09_lined_suppressed.png'))
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  log(`\nDone. Files saved to ${OUT_DIR}`)
  log(`Open them in sequence to see what each step contributes.`)
  fs.writeFileSync(path.join(OUT_DIR, 'REPORT.txt'), report.join('\n'))
}

// ─── OpenCV: adaptive threshold + morph close ─────────────────────────────────

async function applyOpenCV(imagePath, outDir) {
  const cv = await loadOpenCV()
  const { data, info } = await sharp(imagePath)
    .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .grayscale().normalise()
    .sharpen({ sigma: 1.5, m1: 1.0, m2: 3.0 })
    .linear(1.35, -25)
    .grayscale()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const src = cv.matFromImageData({ data: new Uint8ClampedArray(data), width: info.width, height: info.height })
  const gray = new cv.Mat()
  const thresh = new cv.Mat()
  const closed = new cv.Mat()

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)

    cv.adaptiveThreshold(gray, thresh, 255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 10)

    await sharp(Buffer.from(thresh.data), {
      raw: { width: info.width, height: info.height, channels: 1 },
    }).png().toFile(path.join(outDir, '06_adaptive_thresh.png'))

    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
    cv.morphologyEx(thresh, closed, cv.MORPH_CLOSE, kernel)
    kernel.delete()

    await sharp(Buffer.from(closed.data), {
      raw: { width: info.width, height: info.height, channels: 1 },
    }).png().toFile(path.join(outDir, '07_morph_close.png'))
  } finally {
    src.delete(); gray.delete(); thresh.delete(); closed.delete()
  }
}

// ─── Rotation detection (mirrors preprocess.js) ──────────────────────────────

async function detectRotation(imagePath) {
  try {
    const { data, info } = await sharp(imagePath)
      .grayscale().resize(300, 400, { fit: 'inside' })
      .raw().toBuffer({ resolveWithObject: true })
    const { width, height } = info
    const pixels = new Uint8Array(data)
    const angles = []
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const gx =
          -pixels[(y-1)*width+(x-1)] + pixels[(y-1)*width+(x+1)] +
          -2*pixels[y*width+(x-1)]   + 2*pixels[y*width+(x+1)] +
          -pixels[(y+1)*width+(x-1)] + pixels[(y+1)*width+(x+1)]
        const gy =
          -pixels[(y-1)*width+(x-1)] - 2*pixels[(y-1)*width+x] - pixels[(y-1)*width+(x+1)] +
          pixels[(y+1)*width+(x-1)]  + 2*pixels[(y+1)*width+x]  + pixels[(y+1)*width+(x+1)]
        const mag = Math.sqrt(gx*gx + gy*gy)
        if (mag > 40) angles.push(Math.atan2(gy, gx) * 180 / Math.PI)
      }
    }
    if (angles.length < 100) return 0
    const buckets = new Int32Array(180)
    for (const a of angles) {
      const b = Math.floor(((a % 180) + 180) % 180)
      if (b >= 0 && b < 180) buckets[b]++
    }
    let maxCount = 0, peakAngle = 90
    for (let a = 65; a <= 115; a++) {
      if (buckets[a] > maxCount) { maxCount = buckets[a]; peakAngle = a }
    }
    return peakAngle - 90
  } catch { return 0 }
}

// ─── Lined paper detection (mirrors preprocess.js) ───────────────────────────

async function detectLinedPaper(imagePath) {
  try {
    const { data, info } = await sharp(imagePath)
      .grayscale().resize(200, 300, { fit: 'inside' })
      .raw().toBuffer({ resolveWithObject: true })
    const { width, height } = info
    const pixels = new Uint8Array(data)
    const rowMeans = new Float32Array(height)
    for (let y = 0; y < height; y++) {
      let sum = 0
      for (let x = 0; x < width; x++) sum += pixels[y * width + x]
      rowMeans[y] = sum / width
    }
    const globalMean = rowMeans.reduce((a, b) => a + b, 0) / height
    const darkRows = []
    for (let y = 1; y < height - 1; y++) {
      if (rowMeans[y] < globalMean * 0.85) darkRows.push(y)
    }
    if (darkRows.length < 4) return false
    const gaps = []
    for (let i = 1; i < darkRows.length; i++) gaps.push(darkRows[i] - darkRows[i-1])
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const gapStdDev = Math.sqrt(gaps.reduce((s, g) => s + (g - meanGap)**2, 0) / gaps.length)
    return meanGap >= 4 && meanGap <= 25 && gapStdDev < meanGap * 0.35 && darkRows.length >= 6
  } catch { return false }
}

run().catch(err => { console.error(err); process.exit(1) })
