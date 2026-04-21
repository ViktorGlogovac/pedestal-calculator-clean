const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')

// Ensure uploads directory exists
const uploadsDir = path.resolve(__dirname, '../../server/uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

/**
 * Multer configuration for accepting image uploads.
 * dest: server/uploads/, maxSize: 20MB, accept image/* only
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (req, file, cb) => {
    const sessionId = uuidv4()
    // Stash the sessionId on the req so we can reference it later
    req._sessionId = sessionId
    const ext = path.extname(file.originalname) || '.png'
    cb(null, `${sessionId}_original${ext}`)
  },
})

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true)
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Only image files are accepted.`), false)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
})

/**
 * Process a multer-uploaded file and return ingest metadata.
 * Call AFTER the multer middleware has run.
 * @param {object} file - req.file from multer
 * @param {string} [existingSessionId] - optional session ID if already generated
 * @returns {{sessionId: string, originalPath: string, mimeType: string, sizeBytes: number}}
 */
function processUpload(file, existingSessionId) {
  if (!file) {
    throw new Error('No file was uploaded. Please attach an image with field name "image".')
  }

  if (!file.mimetype.startsWith('image/')) {
    throw new Error(`Invalid file type: ${file.mimetype}. Only image files are accepted.`)
  }

  const maxSize = 20 * 1024 * 1024
  if (file.size > maxSize) {
    throw new Error(`File size ${file.size} exceeds the 20MB limit.`)
  }

  // Extract sessionId from filename (set by storage.filename)
  let sessionId = existingSessionId
  if (!sessionId) {
    // Try to extract from filename: "{sessionId}_original.ext"
    const baseName = path.basename(file.filename, path.extname(file.filename))
    const parts = baseName.split('_original')
    sessionId = parts[0] || uuidv4()
  }

  return {
    sessionId,
    originalPath: file.path,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    originalFilename: file.originalname,
  }
}

module.exports = { upload, processUpload, uploadsDir }
