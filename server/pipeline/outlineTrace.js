const { runCV } = require('../utils/cvLoader')

async function traceOutline(imagePath, opts = {}) {
  const result = await runCV('trace_outline', {
    imagePath,
    minContourArea: 800,
    approxEpsilonFactor: opts.approxEpsilonFactor ?? 0.004,
  })

  return {
    polygon: Array.isArray(result.polygon) ? result.polygon : [],
    area: typeof result.area === 'number' ? result.area : 0,
  }
}

module.exports = { traceOutline }
