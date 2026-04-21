/**
 * CV operations via Python subprocess (real OpenCV, not WASM).
 *
 * Replaces @techstark/opencv-js with a Python child process that runs
 * cv_ops.py. This avoids the emscripten main-loop issue that blocks
 * the Node.js event loop.
 *
 * Usage:
 *   const { runCV } = require('./cvLoader')
 *   const result = await runCV('extract', { imagePath, ... })
 */

const { spawn } = require('child_process')
const path = require('path')

const SCRIPT = path.join(__dirname, 'cv_ops.py')
const PYTHON = process.env.PYTHON_BIN || 'python3'

/**
 * Run a CV operation via the Python script.
 *
 * @param {string} cmd  - Command name: 'preprocess' | 'extract' | 'build_mask' | 'draw_overlay'
 * @param {object} args - Command arguments (merged with {cmd})
 * @returns {Promise<object>} Result object from the Python script
 */
function runCV(cmd, args) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ cmd, ...args })
    const proc = spawn(PYTHON, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`cv_ops.py [${cmd}] exited ${code}: ${stderr.trim() || stdout.trim()}`))
      }
      try {
        const parsed = JSON.parse(stdout.trim())
        if (!parsed.ok) {
          return reject(new Error(`cv_ops.py [${cmd}] error: ${parsed.error}`))
        }
        resolve(parsed.result)
      } catch (e) {
        reject(new Error(`cv_ops.py [${cmd}] invalid JSON: ${stdout.slice(0, 200)}`))
      }
    })

    proc.on('error', err => reject(new Error(`Failed to spawn python3: ${err.message}`)))

    proc.stdin.write(payload)
    proc.stdin.end()
  })
}

// Legacy compat shim — some files still call loadOpenCV()
// They will be updated to use runCV() directly
function loadOpenCV() {
  return Promise.resolve({ _usePython: true })
}

module.exports = { runCV, loadOpenCV }
