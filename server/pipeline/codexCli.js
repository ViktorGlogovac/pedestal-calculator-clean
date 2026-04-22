const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const DEFAULT_TIMEOUT_MS = 90000

function callCodexCli({ prompt, imagePath = null, outputSchema = null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sketch-codex-'))
    const outputPath = path.join(tmpDir, 'last-message.txt')
    const schemaPath = outputSchema ? path.join(tmpDir, 'schema.json') : null

    if (schemaPath) {
      fs.writeFileSync(schemaPath, JSON.stringify(outputSchema, null, 2))
    }

    const codexBin = process.env.CODEX_CLI_PATH || 'codex'
    const model = process.env.CODEX_SKETCH_MODEL || process.env.OPENAI_SKETCH_MODEL || process.env.OPENAI_MODEL
    const args = [
      'exec',
      '--color', 'never',
      '--sandbox', 'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '-o', outputPath,
    ]

    if (model) args.push('-m', model)
    if (imagePath) args.push('--image', imagePath)
    if (schemaPath) args.push('--output-schema', schemaPath)
    args.push('-')

    const child = spawn(codexBin, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        // Avoid terminal control sequences and interactive prompts in server logs.
        NO_COLOR: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', err => {
      clearTimeout(timer)
      try {
        reject(new Error(`Codex CLI failed to start: ${err.message}`))
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
    child.on('close', code => {
      clearTimeout(timer)
      try {
        if (timedOut) {
          reject(new Error(`Codex CLI timed out after ${Math.round(timeoutMs / 1000)}s`))
          return
        }

        if (code !== 0) {
          const detail = String(stderr || stdout || `exit code ${code}`).trim()
          reject(new Error(`Codex CLI failed: ${detail.slice(0, 800)}`))
          return
        }

        let content = ''
        if (fs.existsSync(outputPath)) {
          content = fs.readFileSync(outputPath, 'utf8')
        }
        if (!content.trim()) {
          content = String(stdout || '').trim()
        }

        if (!content.trim()) {
          const detail = String(stderr || stdout || '').trim()
          reject(new Error(`Codex CLI returned an empty response${detail ? `: ${detail.slice(0, 500)}` : ''}`))
          return
        }

        resolve(content.trim())
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    child.stdin.end(prompt)
  })
}

function messagesToPrompt(messages) {
  return (messages || [])
    .map((message) => {
      const role = String(message.role || 'user').toUpperCase()
      const content = Array.isArray(message.content)
        ? message.content
            .filter((part) => part?.type === 'text')
            .map((part) => part.text || '')
            .join('\n\n')
        : String(message.content || '')

      return content.trim() ? `${role}:\n${content.trim()}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function parseJsonObject(content) {
  const cleaned = String(content || '')
    .replace(/^```[a-z]*\n?/im, '')
    .replace(/\n?```\s*$/m, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch (_) {
      return null
    }
  }
}

module.exports = { callCodexCli, messagesToPrompt, parseJsonObject }
