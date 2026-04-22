/**
 * Frontend API client for the sketch analysis pipeline.
 * Communicates with the Express backend at /api/sketch (proxied via Vite).
 */

const BACKEND_BASE = '/api/sketch'

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
async function analyzeSketch(imageFile, depthImageFile = null) {
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
  if (imageFile._userNotes) {
    formData.append('notes', imageFile._userNotes)
  }
  if (depthImageFile) {
    formData.append('depthImage', depthImageFile)
  }

  let response
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 100000)
  try {
    response = await fetch(`${BACKEND_BASE}/analyze`, {
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

  let data
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
    const response = await fetch('/api/health', { method: 'GET' })
    if (!response.ok) return { ok: false, openaiConfigured: false }
    const data = await response.json()
    return { ok: true, openaiConfigured: data.openaiConfigured || false }
  } catch {
    return { ok: false, openaiConfigured: false }
  }
}

export { analyzeSketch, withNotes, getDebugData, checkServerHealth }
