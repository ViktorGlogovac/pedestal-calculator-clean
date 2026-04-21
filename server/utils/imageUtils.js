const fs = require('fs')
const path = require('path')

/**
 * Read a file from disk and return its base64 encoded string.
 * @param {string} filePath - absolute or relative path to the image file
 * @returns {string} base64 encoded string (no data URI prefix)
 */
function fileToBase64(filePath) {
  const absPath = path.resolve(filePath)
  const buffer = fs.readFileSync(absPath)
  return buffer.toString('base64')
}

/**
 * Convert a base64 string to a Buffer.
 * Handles both plain base64 and data URI formats.
 * @param {string} b64 - base64 string, optionally with data URI prefix
 * @returns {Buffer}
 */
function base64ToBuffer(b64) {
  // Strip data URI prefix if present (e.g. "data:image/png;base64,...")
  const stripped = b64.includes(',') ? b64.split(',')[1] : b64
  return Buffer.from(stripped, 'base64')
}

/**
 * Get the pixel dimensions of an image file using sharp.
 * @param {string} filePath
 * @returns {Promise<{width: number, height: number}>}
 */
async function getImageDimensions(filePath) {
  const sharp = require('sharp')
  const metadata = await sharp(filePath).metadata()
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
  }
}

module.exports = { fileToBase64, base64ToBuffer, getImageDimensions }
