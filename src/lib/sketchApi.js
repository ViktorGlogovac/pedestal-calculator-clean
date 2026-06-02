/**
 * Frontend API client for the sketch analysis pipeline.
 * Uses the local dev proxy on localhost and calls Cloud Run directly in
 * production to avoid Firebase Hosting rewrite timeouts on long analyses.
 */

const PROD_BACKEND_ORIGIN = 'https://pedestal-sketch-api-ssu6dk7xoq-uc.a.run.app'
const isLocalhost =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname)
const BACKEND_ORIGIN = isLocalhost ? '' : PROD_BACKEND_ORIGIN
const BACKEND_BASE = `${BACKEND_ORIGIN}/api/sketch`
const HEALTH_URL = `${BACKEND_ORIGIN}/api/health`

/**
 * Send an image file to the backend for full pipeline analysis.
 * The backend runs: ingest → preprocess → OCR → geometry → reason → finalize
 *
 * @param {File} imageFile - browser File object from input or drag-drop
 * @returns {Promise<{
 *   success: boolean,
 *   sessionId: string,
 *   deckPlan: object|null,
 *   canvasShapes: Array,
 *   debugImages: {original?: string, preprocessed?: string},
 *   warnings: string[],
 *   error?: string
 * }>}
 */
async function analyzeSketch(imageFile, depthImageFile = null, unitSystem = 'metric', onProgress = null) {
  if (!imageFile) {
    return {
      success: false,
      error: 'No image file provided.',
      canvasShapes: [],
      warnings: [],
      debugImages: {},
    }
  }

  const formData = new FormData()
  formData.append('image', imageFile)
  formData.append('unitSystem', unitSystem === 'imperial' ? 'imperial' : 'metric')
  if (imageFile._userNotes) {
    formData.append('notes', imageFile._userNotes)
  }
  if (depthImageFile) {
    formData.append('depthImage', depthImageFile)
  }

  let response
  const controller = new AbortController()
  // Match the Cloud Run request timeout (600s). The backend runs two Codex calls
  // of up to 180s each, so the browser must not abort before the server can finish.
  const timeoutId = window.setTimeout(() => controller.abort(), 600000)
  try {
    response = await fetch(`${BACKEND_BASE}/analyze?stream=1`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      // Do NOT set Content-Type header — browser sets it automatically with boundary
    })
  } catch (networkErr) {
    if (networkErr.name === 'AbortError') {
      return {
        success: false,
        error: 'Analysis timed out. The Codex CLI did not return a result in time.',
        canvasShapes: [],
        warnings: [],
        debugImages: {},
      }
    }

    const isConnectionRefused =
      networkErr.message.includes('Failed to fetch') ||
      networkErr.message.includes('NetworkError') ||
      networkErr.message.includes('ECONNREFUSED')

    return {
      success: false,
      error: isConnectionRefused
        ? 'Cannot connect to the analysis server. Make sure the backend is running (npm run dev:server).'
        : `Network error: ${networkErr.message}`,
      canvasShapes: [],
      warnings: [],
      debugImages: {},
    }
  } finally {
    window.clearTimeout(timeoutId)
  }

  const contentType = response.headers.get('content-type') || ''
  let data

  if (contentType.includes('application/x-ndjson') && response.body) {
    data = await readStreamingAnalysisResponse(response, onProgress)
  } else {
    try {
      data = await response.json()
    } catch (parseErr) {
      return {
        success: false,
        error: `Server returned an invalid response (status ${response.status}).`,
        canvasShapes: [],
        warnings: [],
        debugImages: {},
      }
    }
  }

  if (!data) {
    return {
      success: false,
      error: `Server returned an empty response (status ${response.status}).`,
      canvasShapes: [],
      warnings: [],
      debugImages: {},
    }
  }

  if (!response.ok || !data.success) {
    return {
      success: false,
      error: data.error || `Server error: ${response.status}`,
      canvasShapes: data.canvasShapes || [],
      warnings: data.warnings || [],
      debugImages: data.debugImages || {},
    }
  }

  return {
    success: true,
    sessionId: data.sessionId,
    deckPlan: data.deckPlan || null,
    outputDoc: data.outputDoc || null,
    canvasShapes: data.canvasShapes || [],
    debugImages: data.debugImages || {},
    warnings: data.warnings || [],
  }
}

async function readStreamingAnalysisResponse(response, onProgress) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalEvent = null

  const consumeLine = (line) => {
    const trimmed = line.trim()
    if (!trimmed) return

    let event
    try {
      event = JSON.parse(trimmed)
    } catch (_) {
      return
    }

    if (event.type === 'progress') {
      onProgress?.(event)
    } else if (event.type === 'complete' || event.type === 'error') {
      finalEvent = event
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    lines.forEach(consumeLine)
  }

  buffer += decoder.decode()
  consumeLine(buffer)

  return finalEvent
}

/**
 * Attach user notes to an image file before sending.
 * Creates a lightweight wrapper so notes are available inside analyzeSketch.
 */
function withNotes(imageFile, notes) {
  if (!notes) return imageFile
  const tagged = imageFile
  tagged._userNotes = notes
  return tagged
}

/**
 * Fetch debug data for a previous analysis session.
 * Useful for troubleshooting.
 *
 * @param {string} sessionId
 * @returns {Promise<object>}
 */
async function getDebugData(sessionId) {
  if (!sessionId) return null

  try {
    const response = await fetch(`${BACKEND_BASE}/debug/${sessionId}`)
    const data = await response.json()
    return data.success ? data.data : null
  } catch {
    return null
  }
}

/**
 * Check if the backend server is reachable and configured.
 * @returns {Promise<{ok: boolean, openaiConfigured: boolean}>}
 */
async function checkServerHealth() {
  try {
    const response = await fetch(HEALTH_URL, { method: 'GET' })
    if (!response.ok) return { ok: false, openaiConfigured: false }
    const data = await response.json()
    return { ok: true, openaiConfigured: data.openaiConfigured || false }
  } catch {
    return { ok: false, openaiConfigured: false }
  }
}

export { analyzeSketch, withNotes, getDebugData, checkServerHealth }
