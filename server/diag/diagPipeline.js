/**
 * Diagnostic script — traces lineGraph + candidateGen on latest session image.
 * Run: node server/diag/diagPipeline.js
 */

const path = require('path')
const { extractGeometryCV }  = require('../pipeline/cvExtract')
const { classifySegments }   = require('../pipeline/segmentClassify')
const { buildLineGraph }     = require('../pipeline/lineGraph')
const { generateCandidates } = require('../pipeline/candidateGen')

const IMAGE = path.join(__dirname, '../uploads/dccf8c0d-3540-4a87-979c-3ac475b85ef4_corrected.png')

async function main() {
  console.log('=== Stage 1: CV Extract ===')
  const cv = await extractGeometryCV(IMAGE)
  console.log(`  Total lines: ${cv.lines.length}`)
  const ortho = cv.lines.filter(l => {
    const a = ((l.angle % 180) + 180) % 180
    return a <= 15 || a >= 165 || Math.abs(a - 90) <= 15
  })
  console.log(`  Orthogonal:  ${ortho.length}`)
  // Show length distribution
  const lengths = cv.lines.map(l => l.length).sort((a,b) => b - a)
  console.log(`  Top 10 lengths: ${lengths.slice(0,10).map(l => l.toFixed(3)).join(', ')}`)

  console.log('\n=== Stage 2: Classify ===')
  const classified = classifySegments(cv.lines, [], cv.imageSize.width, cv.imageSize.height)
  const byClass = {}
  for (const s of classified) byClass[s.bestClass] = (byClass[s.bestClass]||0) + 1
  console.log('  By class:', byClass)

  const structural = classified.filter(s => s.bestClass === 'structural_boundary' && s.classConfidence > 0.40)
  console.log(`  Structural (conf>0.4): ${structural.length}`)
  console.log('  Top structural lengths:', structural.map(s => s.length?.toFixed(3)||'?').sort((a,b)=>b-a).slice(0,10).join(', '))

  const useLines = structural.length >= 4 ? structural
    : classified.filter(s => s.bestClass !== 'noise' && s.bestClass !== 'notebook_line' && (s.length||0) >= 0.04)
  console.log(`  Lines going into graph: ${useLines.length}`)

  console.log('\n=== Stage 3: Line Graph ===')
  const graph = buildLineGraph(useLines)
  console.log(`  Nodes: ${graph.nodes.length}, Edges: ${graph.edges.length}`)
  console.log(`  H-levels: ${graph.hLevels.length}, V-columns: ${graph.vColumns.length}`)

  if (graph.hLevels.length > 0) {
    console.log('  H-levels y-coords:', graph.hLevels.map(l => `y=${l.coord.toFixed(3)} ranges=${JSON.stringify(l.ranges.map(r => `[${r.start.toFixed(3)},${r.end.toFixed(3)}]`))}`).join('\n    '))
  }
  if (graph.vColumns.length > 0) {
    console.log('  V-columns x-coords:', graph.vColumns.map(c => `x=${c.coord.toFixed(3)} ranges=${JSON.stringify(c.ranges.map(r => `[${r.start.toFixed(3)},${r.end.toFixed(3)}]`))}`).join('\n    '))
  }

  // Check adjacency
  const adj = new Map(graph.nodes.map(n => [n.id, []]))
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  for (const e of graph.edges) {
    adj.get(e.fromId)?.push({ toId: e.toId, dir: e.horizontal ? 'H' : 'V' })
    adj.get(e.toId)?.push({ toId: e.fromId, dir: e.horizontal ? 'H' : 'V' })
  }
  const degrees = graph.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, deg: adj.get(n.id).length }))
  const deg2plus = degrees.filter(d => d.deg >= 2)
  console.log(`  Nodes with degree >= 2: ${deg2plus.length}`)
  console.log('  Node degrees:', degrees.map(d => `n${d.id}(${d.x.toFixed(2)},${d.y.toFixed(2)})=deg${d.deg}`).join(', '))

  console.log('\n=== Stage 4: Candidate Gen ===')
  const candidates = generateCandidates(graph)
  console.log(`  Candidates: ${candidates.length}`)
  if (candidates.length > 0) {
    for (const c of candidates.slice(0, 5)) {
      console.log(`  - area=${c.area.toFixed(4)}, verts=${c.edgeCount}, winding=${c.winding}`)
    }
  }

  // Manual traversal test — try to trace a rectangle from the corner nodes
  // Show ALL edges
  console.log('\n=== All edges ===')
  for (const e of graph.edges) {
    const f = nodeById.get(e.fromId), t = nodeById.get(e.toId)
    if (f && t) {
      console.log(`  e${e.id}: (${f.x.toFixed(3)},${f.y.toFixed(3)}) → (${t.x.toFixed(3)},${t.y.toFixed(3)}) [${e.horizontal?'H':'V'}]`)
    }
  }

  // Try to manually trace the outer rectangle
  console.log('\n=== Tracing outer rectangle ===')
  // Expected: TL=(0.035,0.038), TR=(0.989,0.038), BR=(0.989,0.997), BL=(0.035,0.997)
  const TL = graph.nodes.find(n => Math.abs(n.x-0.035)<0.01 && Math.abs(n.y-0.038)<0.01)
  const TR = graph.nodes.find(n => Math.abs(n.x-0.989)<0.01 && Math.abs(n.y-0.038)<0.01)
  const BR = graph.nodes.find(n => Math.abs(n.x-0.989)<0.01 && Math.abs(n.y-0.997)<0.01)
  const BL = graph.nodes.find(n => Math.abs(n.x-0.035)<0.01 && Math.abs(n.y-0.997)<0.01)
  console.log(`  TL: ${TL ? `n${TL.id}(${TL.x},${TL.y}) deg=${adj.get(TL.id).length}` : 'NOT FOUND'}`)
  console.log(`  TR: ${TR ? `n${TR.id}(${TR.x},${TR.y}) deg=${adj.get(TR.id).length}` : 'NOT FOUND'}`)
  console.log(`  BR: ${BR ? `n${BR.id}(${BR.x},${BR.y}) deg=${adj.get(BR.id).length}` : 'NOT FOUND'}`)
  console.log(`  BL: ${BL ? `n${BL.id}(${BL.x},${BL.y}) deg=${adj.get(BL.id).length}` : 'NOT FOUND'}`)

  if (TR) {
    console.log(`  TR adj:`, adj.get(TR.id).map(a => {
      const t = nodeById.get(a.toId)
      return t ? `→n${a.toId}(${t.x.toFixed(3)},${t.y.toFixed(3)})${a.dir}` : `→n${a.toId}`
    }).join(', '))
  }
  if (BR) {
    console.log(`  BR adj:`, adj.get(BR.id).map(a => {
      const t = nodeById.get(a.toId)
      return t ? `→n${a.toId}(${t.x.toFixed(3)},${t.y.toFixed(3)})${a.dir}` : `→n${a.toId}`
    }).join(', '))
  }
}

main().catch(console.error)
