/**
 * Debug overlay generation.
 *
 * Produces annotated PNG images for each pipeline stage using cv_ops.py.
 * All overlay functions return the output path on success, null on failure.
 */

const { runCV } = require('../utils/cvLoader')

// RGB colors (cv_ops.py takes RGB and converts to BGR internally)
const COLORS = {
  structural_boundary: [0,   220,  0  ],
  dimension_line:      [255, 165,  0  ],
  witness_line:        [255, 255,  0  ],
  notebook_line:       [160, 160, 160 ],
  leader_line:         [0,   255, 255 ],
  noise:               [180,   0, 180 ],
  text_box:            [255,   0,  0  ],
  graph_node:          [0,   255,  0  ],
  graph_edge:          [50,  200,  0  ],
  candidate_0:         [0,   255,  0  ],
  candidate_1:         [255, 200,  0  ],
  candidate_2:         [255, 100,  0  ],
  candidate_3:         [200,  50,  0  ],
}

// ─── Overlay: text bounding boxes ────────────────────────────────────────────

async function drawTextBoxes(imagePath, textBoxes, outputPath) {
  try {
    const ops = textBoxes.map(box => ({
      type: 'rect',
      x1: box.x,
      y1: box.y,
      x2: box.x + box.w,
      y2: box.y + box.h,
      color: COLORS.text_box,
      thickness: 2,
    }))
    await runCV('draw_overlay', { imagePath, ops, outputPath })
    return outputPath
  } catch (err) {
    console.warn('[debugOverlay] drawTextBoxes failed:', err.message)
    return null
  }
}

// ─── Overlay: classified segments ────────────────────────────────────────────

async function drawClassifiedSegments(imagePath, classifiedSegments, outputPath) {
  try {
    const ops = classifiedSegments.map(seg => ({
      type: 'line',
      x1: seg.p1.x, y1: seg.p1.y,
      x2: seg.p2.x, y2: seg.p2.y,
      color: COLORS[seg.bestClass] || [200, 200, 200],
      thickness: seg.bestClass === 'structural_boundary' ? 3 : 1,
    }))
    await runCV('draw_overlay', { imagePath, ops, outputPath })
    return outputPath
  } catch (err) {
    console.warn('[debugOverlay] drawClassifiedSegments failed:', err.message)
    return null
  }
}

// ─── Overlay: structural graph ────────────────────────────────────────────────

async function drawLineGraph(imagePath, graph, outputPath) {
  try {
    const nodeById = new Map((graph.nodes || []).map(n => [n.id, n]))
    const ops = []

    for (const edge of (graph.edges || [])) {
      const from = nodeById.get(edge.fromId)
      const to   = nodeById.get(edge.toId)
      if (!from || !to) continue
      ops.push({
        type: 'line',
        x1: from.x, y1: from.y,
        x2: to.x,   y2: to.y,
        color: COLORS.graph_edge,
        thickness: 2,
      })
    }

    for (const node of (graph.nodes || [])) {
      ops.push({
        type: 'circle',
        cx: node.x, cy: node.y,
        radius: 4,
        color: COLORS.graph_node,
        thickness: -1,
      })
    }

    await runCV('draw_overlay', { imagePath, ops, outputPath })
    return outputPath
  } catch (err) {
    console.warn('[debugOverlay] drawLineGraph failed:', err.message)
    return null
  }
}

// ─── Overlay: candidate polygons ──────────────────────────────────────────────

async function drawCandidates(imagePath, candidates, outputPath) {
  try {
    const ops = candidates.slice(0, 4).map((cand, i) => ({
      type: 'polyline',
      points: cand.vertices,
      closed: true,
      color: COLORS[`candidate_${i}`] || [255, 255, 0],
      thickness: i === 0 ? 3 : 1,
    }))
    await runCV('draw_overlay', { imagePath, ops, outputPath })
    return outputPath
  } catch (err) {
    console.warn('[debugOverlay] drawCandidates failed:', err.message)
    return null
  }
}

module.exports = { drawTextBoxes, drawClassifiedSegments, drawLineGraph, drawCandidates }
