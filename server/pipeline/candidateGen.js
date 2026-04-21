/**
 * Stage 4 — Polygon candidate generation.
 *
 * Finds all simple closed cycles in the rectilinear line graph using
 * DFS-based enumeration.  This correctly finds convex shapes (rectangles),
 * concave shapes (L-shapes, U-shapes, T-shapes) and any other rectilinear
 * polygon that forms a closed boundary in the graph.
 *
 * The old "tightest clockwise turn" traversal only found convex faces; it
 * would miss any polygon with a reflex (concave) vertex.
 *
 * For large graphs (> MAX_CYCLE_NODES nodes after pruning), the DFS falls
 * back to the original CW-traversal to prevent exponential blowup.
 */

const MIN_AREA       = 0.003   // Minimum candidate area (fraction of image)
const MAX_AREA_FRAC  = 0.99    // Faces larger than this are likely the exterior
                               // 0.99 (was 0.95): a deck filling ~96% of the image
                               // was being excluded; scorer penalises large-area
                               // candidates so the true deck still wins over exterior
const MAX_CYCLE_NODES = 30     // DFS is used only when the pruned graph is this small
const MAX_DFS_PATHS  = 5000    // Hard cap on DFS calls to stay bounded

// CW-traversal fallback constants (used only for large graphs)
const CW_PRIORITY = {
  R: ['D', 'R', 'U'],
  D: ['L', 'D', 'R'],
  L: ['U', 'L', 'D'],
  U: ['R', 'U', 'L'],
}
const REVERSE = { R: 'L', L: 'R', U: 'D', D: 'U' }
const MAX_STEPS = 2000

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * Remove dead-end nodes (degree ≤ 1) iteratively, but stop before
 * pruning would drop the graph below 4 nodes — that would prevent
 * any polygon from being detected.
 */
function pruneDeadEnds(nodes, edges) {
  const nodeIdSet = new Set(nodes.map(n => n.id))
  const edgeIdSet = new Set(edges.map(e => e.id))
  const edgeById  = new Map(edges.map(e => [e.id, e]))

  const nodeEdges = new Map(nodes.map(n => [n.id, new Set()]))
  for (const e of edges) {
    nodeEdges.get(e.fromId)?.add(e.id)
    nodeEdges.get(e.toId)?.add(e.id)
  }

  let changed = true
  while (changed) {
    changed = false
    // Stop pruning if the graph is already at the minimum viable size
    if (nodeIdSet.size <= 4) break

    for (const [nodeId, edgeSet] of nodeEdges.entries()) {
      if (edgeSet.size <= 1) {
        // Safety: don't prune below 4 nodes
        if (nodeIdSet.size <= 4) { changed = false; break }

        for (const edgeId of edgeSet) {
          edgeIdSet.delete(edgeId)
          const e = edgeById.get(edgeId)
          const otherId = e.fromId === nodeId ? e.toId : e.fromId
          nodeEdges.get(otherId)?.delete(edgeId)
        }
        nodeIdSet.delete(nodeId)
        nodeEdges.delete(nodeId)
        changed = true
      }
    }
  }

  return {
    nodes: nodes.filter(n => nodeIdSet.has(n.id)),
    edges: edges.filter(e => edgeIdSet.has(e.id)),
  }
}

/**
 * Generate polygon face candidates from a line graph.
 *
 * @param {{ nodes, edges }} graph - from buildLineGraph()
 * @returns {Array<Candidate>}  sorted by score descending (initial geometric score)
 */
function generateCandidates(graph) {
  const pruned = pruneDeadEnds(graph.nodes, graph.edges)
  const { nodes, edges } = pruned

  if (nodes.length < 4 || edges.length < 4) return []

  const nodeById = new Map(nodes.map(n => [n.id, n]))

  // Build undirected adjacency for DFS and directed adjacency for CW fallback
  const adj    = new Map(nodes.map(n => [n.id, []]))
  const dirAdj = new Map(nodes.map(n => [n.id, []]))

  for (const edge of edges) {
    const from = nodeById.get(edge.fromId)
    const to   = nodeById.get(edge.toId)
    if (!from || !to) continue

    const dx = to.x - from.x
    const dy = to.y - from.y
    const fwd = getDir(dx, dy)
    const bwd = getDir(-dx, -dy)

    // Undirected adjacency (for DFS)
    adj.get(edge.fromId).push({ toId: edge.toId,   edgeId: edge.id })
    adj.get(edge.toId).push(  { toId: edge.fromId, edgeId: edge.id })

    // Directed adjacency (for CW fallback)
    if (fwd && bwd) {
      dirAdj.get(edge.fromId).push({ toId: edge.toId,   dir: fwd, edgeId: edge.id })
      dirAdj.get(edge.toId).push(  { toId: edge.fromId, dir: bwd, edgeId: edge.id })
    }
  }

  // Choose enumeration strategy based on graph size
  let rawFaces
  if (nodes.length <= MAX_CYCLE_NODES) {
    rawFaces = findAllSimpleCycles(nodes, adj, nodeById)
  } else {
    rawFaces = findFacesCW(nodes, dirAdj, nodeById)
  }

  // Deduplicate (same vertex-id set)
  const unique = dedup(rawFaces)

  // Sort by area descending, assign ids, add initial geometric score
  unique.sort((a, b) => b.area - a.area)

  return unique.map((f, i) => ({
    id: i,
    vertices: f.vertices,
    area: f.area,
    edgeCount: f.vertices.length,
    winding: polyWinding(f.vertices),
    score: 0,
    scoreDetails: {},
  }))
}

// ─── DFS simple cycle enumeration ────────────────────────────────────────────

/**
 * Find all simple cycles in the undirected graph using DFS.
 * A "simple cycle" visits each node at most once and returns to the start.
 * Minimum length: 4 nodes (minimum for a closed rectilinear polygon).
 *
 * Determinism: nodes and neighbours are iterated in sorted order.
 */
function findAllSimpleCycles(nodes, adj, nodeById) {
  const cycles = []
  let callCount = 0

  // Sort nodes by id for deterministic output
  const sortedNodes = [...nodes].sort((a, b) => a.id - b.id)

  // To avoid counting the same cycle from each starting node, only start
  // DFS from nodes with id ≤ all other nodes in the cycle.
  // We enforce this by pruning DFS branches that would go to a node with
  // smaller id than the start node (canonical start = smallest id in cycle).

  for (const startNode of sortedNodes) {
    const startId = startNode.id
    const path = [startId]
    const visited = new Set([startId])

    function dfs(curId) {
      if (callCount > MAX_DFS_PATHS) return
      callCount++

      // Sort neighbours by id for determinism
      const neighbours = [...(adj.get(curId) || [])].sort((a, b) => a.toId - b.toId)

      for (const { toId } of neighbours) {
        // Enforce canonical start: only visit nodes with id >= startId
        // (prevents duplicate cycles counted from different start nodes)
        if (toId < startId) continue

        if (toId === startId) {
          // Closed cycle found — must have ≥ 4 nodes
          if (path.length >= 4) {
            const verts = path.map(id => nodeById.get(id)).filter(Boolean)
            const area  = polyArea(verts)
            if (area > MIN_AREA && area < MAX_AREA_FRAC) {
              cycles.push({ vertices: verts, area })
            }
          }
          continue
        }

        if (visited.has(toId)) continue
        if (path.length >= nodes.length) continue  // Safety: can't visit more nodes than exist

        visited.add(toId)
        path.push(toId)
        dfs(toId)
        path.pop()
        visited.delete(toId)
      }
    }

    dfs(startId)
  }

  return cycles
}

// ─── CW traversal fallback (for large graphs) ────────────────────────────────

function findFacesCW(nodes, dirAdj, nodeById) {
  const visitedKeys = new Set()
  const rawFaces = []

  for (const startNode of nodes) {
    for (const startEdge of (dirAdj.get(startNode.id) || [])) {
      const startKey = `${startNode.id}->${startEdge.toId}(${startEdge.dir})`
      if (visitedKeys.has(startKey)) continue

      const vertexIds = []
      let curId  = startNode.id
      let nextId = startEdge.toId
      let curDir = startEdge.dir
      let steps  = 0

      while (steps < MAX_STEPS) {
        const key = `${curId}->${nextId}(${curDir})`
        if (vertexIds.length > 2 && curId === startNode.id && curDir === startEdge.dir) break
        if (visitedKeys.has(key) && vertexIds.length > 0) break

        visitedKeys.add(key)
        vertexIds.push(curId)

        const backDir  = REVERSE[curDir]
        const choices  = (dirAdj.get(nextId) || []).filter(e => e.dir !== backDir)
        const nextEdge = selectNextCW(curDir, choices)
        if (!nextEdge) break

        curId  = nextId
        nextId = nextEdge.toId
        curDir = nextEdge.dir
        steps++
      }

      if (vertexIds.length >= 4 && curId === startNode.id) {
        const verts = vertexIds.map(id => nodeById.get(id)).filter(Boolean)
        const area  = polyArea(verts)
        if (area > MIN_AREA && area < MAX_AREA_FRAC) {
          rawFaces.push({ vertices: verts, area })
        }
      }
    }
  }

  return rawFaces
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDir(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'R' : 'L'
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? 'D' : 'U'
  return null
}

function selectNextCW(arrivedDir, choices) {
  const priority = CW_PRIORITY[arrivedDir] || []
  for (const d of priority) {
    const found = choices.find(c => c.dir === d)
    if (found) return found
  }
  return choices[0] || null
}

function polyArea(pts) {
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

function polyWinding(pts) {
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    sum += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y)
  }
  return sum > 0 ? 'CW' : 'CCW'
}

function dedup(faces) {
  const seen = new Set()
  return faces.filter(f => {
    const key = f.vertices.map(v => v.id).sort((a, b) => a - b).join(',')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

module.exports = { generateCandidates }
