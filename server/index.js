require('dotenv').config()

const express = require('express')
const cors = require('cors')
const path = require('path')
const sketchRoutes = require('./routes/sketch')

const app = express()
const PORT = process.env.PORT || 3001

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'https://enmon-pedestal.web.app',
    'https://enmon-pedestal.firebaseapp.com',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// Serve uploaded files as static assets
const uploadsPath = path.resolve(__dirname, 'uploads')
app.use('/uploads', express.static(uploadsPath))

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/sketch', sketchRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    codexCli: process.env.CODEX_CLI_PATH || 'codex',
    codexModel: process.env.CODEX_SKETCH_MODEL || process.env.OPENAI_SKETCH_MODEL || process.env.OPENAI_MODEL || 'default',
  })
})

// ── Error Handler ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message, err.stack)

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      error: 'File is too large. Maximum size is 20MB.',
    })
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      error: 'Unexpected field name. Use "image" as the field name for file uploads.',
    })
  }

  const status = err.status || err.statusCode || 500
  return res.status(status).json({
    success: false,
    error: err.message || 'Internal server error',
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Sketch Server] Running on http://localhost:${PORT}`)
  console.log(`[Sketch Server] Codex CLI: ${process.env.CODEX_CLI_PATH || 'codex'}`)
  console.log(`[Sketch Server] Uploads directory: ${uploadsPath}`)
})

module.exports = app
