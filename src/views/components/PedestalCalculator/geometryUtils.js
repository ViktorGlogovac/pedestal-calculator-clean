export const EPSILON = 1e-6

// 1. Shoelace formula for signed area
export function polygonSignedArea(points) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    const [x1, y1] = points[i]
    const [x2, y2] = points[j]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

function midpointSubdivisions(start, end, maxStep) {
  if (!Number.isFinite(maxStep)) return [start, end]
  if (Math.abs(end - start) <= maxStep + EPSILON) return [start, end]

  const mid = (start + end) / 2
  const left = midpointSubdivisions(start, mid, maxStep)
  const right = midpointSubdivisions(mid, end, maxStep)
  return [...left.slice(0, -1), ...right]
}

// 2. Subdivide a rectangle by repeatedly adding exact midpoints until no
// adjacent pedestal spacing exceeds the max step.
export function subdivideTileRect(x, y, w, h, maxStepX = 60, maxStepY = maxStepX) {
  const polygons = []
  const xStops = midpointSubdivisions(x, x + w, maxStepX)
  const yStops = midpointSubdivisions(y, y + h, maxStepY)

  for (let r = 0; r < yStops.length - 1; r++) {
    const rowY = yStops[r]
    const nextY = yStops[r + 1]
    for (let c = 0; c < xStops.length - 1; c++) {
      const colX = xStops[c]
      const nextX = xStops[c + 1]
      polygons.push([
        [
          [colX, rowY],
          [nextX, rowY],
          [nextX, nextY],
          [colX, nextY],
          [colX, rowY],
        ],
      ])
    }
  }
  return polygons
}

// 3. Barycentric coordinates for a point in a triangle
export function barycentricCoordinates(x, y, p0, p1, p2) {
  const denom = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y)
  if (Math.abs(denom) < EPSILON) return { l0: -1, l1: -1, l2: -1 }
  const l0 = ((p1.y - p2.y) * (x - p2.x) + (p2.x - p1.x) * (y - p2.y)) / denom
  const l1 = ((p2.y - p0.y) * (x - p2.x) + (p0.x - p2.x) * (y - p2.y)) / denom
  const l2 = 1 - l0 - l1
  return { l0, l1, l2 }
}

// 4. Check if point lies in triangle
export function pointInTriangle(pt, p0, p1, p2) {
  const { x, y } = pt
  const { l0, l1, l2 } = barycentricCoordinates(x, y, p0, p1, p2)
  return (
    l0 >= -EPSILON &&
    l1 >= -EPSILON &&
    l2 >= -EPSILON &&
    l0 <= 1 + EPSILON &&
    l1 <= 1 + EPSILON &&
    l2 <= 1 + EPSILON &&
    Math.abs(l0 + l1 + l2 - 1) <= EPSILON
  )
}

// 5. Find which triangle contains a given point
export function findContainingTriangle(pt, triangles) {
  for (let tri of triangles) {
    if (pointInTriangle(pt, tri[0], tri[1], tri[2])) {
      return tri
    }
  }
  return null
}

export function getXY(pt) {
  if (Array.isArray(pt)) return { x: pt[0], y: pt[1] }
  return pt
}

export function midpointSegmentPoints(a, b, maxStep) {
  const start = getXY(a)
  const end = getXY(b)
  if (!start || !end) return []
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  if (!Number.isFinite(maxStep) || distance <= maxStep + EPSILON) {
    return [
      [start.x, start.y],
      [end.x, end.y],
    ]
  }

  const mid = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  }
  const left = midpointSegmentPoints(start, mid, maxStep)
  const right = midpointSegmentPoints(mid, end, maxStep)
  return [...left.slice(0, -1), ...right]
}

export function fillLongPedestalSpans(pedestals, maxSpacing = 60, tolerance = 0.35) {
  if (!Array.isArray(pedestals) || pedestals.length < 2) return pedestals || []

  const result = [...pedestals]
  const seen = new Set(result.map((p) => `${Number(p.x).toFixed(6)},${Number(p.y).toFixed(6)}`))

  const addMidpoints = (a, b) => {
    const distance = distanceBetweenPoints(a, b)
    if (distance <= maxSpacing + EPSILON) return

    const midpoint = {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      height: ((a.height || 0) + (b.height || 0)) / 2,
    }
    const key = `${Number(midpoint.x).toFixed(6)},${Number(midpoint.y).toFixed(6)}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(midpoint)
    }

    addMidpoints(a, midpoint)
    addMidpoints(midpoint, b)
  }

  const fillAxis = (fixedAxis, movingAxis) => {
    const groups = new Map()
    pedestals.forEach((pedestal) => {
      const groupKey = Math.round(pedestal[fixedAxis] / tolerance)
      if (!groups.has(groupKey)) groups.set(groupKey, [])
      groups.get(groupKey).push(pedestal)
    })

    groups.forEach((group) => {
      group.sort((a, b) => a[movingAxis] - b[movingAxis])
      for (let i = 0; i < group.length - 1; i++) {
        const a = group[i]
        const b = group[i + 1]
        if (Math.abs(a[fixedAxis] - b[fixedAxis]) <= tolerance) {
          addMidpoints(a, b)
        }
      }
    })
  }

  fillAxis('y', 'x')
  fillAxis('x', 'y')

  return result
}

function isCoordinatePair(point) {
  return Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number'
}

function normalizePolygonList(polygonOrPolygons) {
  if (!Array.isArray(polygonOrPolygons) || polygonOrPolygons.length === 0) return []
  if (isCoordinatePair(polygonOrPolygons[0])) return [polygonOrPolygons]
  if (Array.isArray(polygonOrPolygons[0]) && isCoordinatePair(polygonOrPolygons[0][0])) {
    return polygonOrPolygons
  }
  return []
}

export function distanceBetweenPoints(a, b) {
  const p1 = getXY(a)
  const p2 = getXY(b)
  return Math.hypot(p1.x - p2.x, p1.y - p2.y)
}

export function getClosestPolygonVertex(point, polygon, tolerance = 0.35) {
  const polygons = normalizePolygonList(polygon)
  if (!polygons.length) return null

  const target = getXY(point)
  let best = null
  let bestDistance = tolerance

  for (const currentPolygon of polygons) {
    for (const vertex of currentPolygon) {
      const current = getXY(vertex)
      const distance = distanceBetweenPoints(target, current)
      if (distance <= bestDistance) {
        bestDistance = distance
        best = current
      }
    }
  }

  return best
}

export function getPerimeterPosition(point, polygon) {
  const polygons = normalizePolygonList(polygon)
  if (!polygons.length) return null

  const target = getXY(point)
  let best = null
  let cumulative = 0

  polygons.forEach((currentPolygon, polygonIndex) => {
    for (let i = 0; i < currentPolygon.length; i++) {
      const a = getXY(currentPolygon[i])
      const b = getXY(currentPolygon[(i + 1) % currentPolygon.length])
      const dx = b.x - a.x
      const dy = b.y - a.y
      const length = Math.hypot(dx, dy)

      if (length < EPSILON) {
        continue
      }

      const rawT = ((target.x - a.x) * dx + (target.y - a.y) * dy) / (length * length)
      const t = Math.max(0, Math.min(1, rawT))
      const projX = a.x + t * dx
      const projY = a.y + t * dy
      const distanceToEdge = Math.hypot(target.x - projX, target.y - projY)

      if (!best || distanceToEdge < best.distanceToEdge) {
        best = {
          edgeIndex: i,
          polygonIndex,
          t,
          x: projX,
          y: projY,
          distance: cumulative + t * length,
          distanceToEdge,
        }
      }

      cumulative += length
    }
  })

  return best ? { ...best, perimeterLength: cumulative } : null
}

export function dedupeAndSnapPedestals(pedestals, polygon, tolerance = 0.35, options = {}) {
  if (!Array.isArray(pedestals) || pedestals.length === 0) return []

  const { preserveAnchor = false } = options

  const normalized = pedestals.map((pedestal) => {
    const snappedVertex = getClosestPolygonVertex(pedestal, polygon, tolerance)
    return snappedVertex ? { ...pedestal, x: snappedVertex.x, y: snappedVertex.y } : { ...pedestal }
  })

  // Spatial hash for O(n) lookup instead of O(n²) linear scan.
  // Cell size = tolerance so nearby pedestals land in adjacent cells.
  const inv = 1 / Math.max(tolerance, EPSILON)
  const spatialMap = new Map() // "cx,cy" -> cluster index
  const clusters = []

  normalized.forEach((pedestal) => {
    const cx = Math.floor(pedestal.x * inv)
    const cy = Math.floor(pedestal.y * inv)
    let foundIdx = -1

    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const idx = spatialMap.get(`${cx + dx},${cy + dy}`)
        if (idx !== undefined && distanceBetweenPoints(clusters[idx].anchor, pedestal) <= tolerance) {
          foundIdx = idx
          break outer
        }
      }
    }

    if (foundIdx !== -1) {
      const cluster = clusters[foundIdx]
      cluster.members.push(pedestal)
      const snappedVertex = getClosestPolygonVertex(cluster.anchor, polygon, tolerance)
      if (!snappedVertex && !preserveAnchor) {
        const count = cluster.members.length
        cluster.anchor = {
          x: (cluster.anchor.x * (count - 1) + pedestal.x) / count,
          y: (cluster.anchor.y * (count - 1) + pedestal.y) / count,
        }
        // Re-register anchor cell after averaging
        spatialMap.set(
          `${Math.floor(cluster.anchor.x * inv)},${Math.floor(cluster.anchor.y * inv)}`,
          foundIdx,
        )
      }
    } else {
      const idx = clusters.length
      clusters.push({
        anchor: { x: pedestal.x, y: pedestal.y },
        members: [pedestal],
      })
      spatialMap.set(`${cx},${cy}`, idx)
    }
  })

  return clusters.map(({ anchor, members }) => {
    const snappedVertex = getClosestPolygonVertex(anchor, polygon, tolerance)
    const x = snappedVertex?.x ?? anchor.x
    const y = snappedVertex?.y ?? anchor.y
    const height = members.reduce((sum, member) => sum + (member.height || 0), 0) / members.length
    const representative = members.find((member) => member.source) || members[0]
    return { ...representative, x, y, height }
  })
}

export function findNearestPointIndex(points, target, maxDistance) {
  if (!Array.isArray(points) || points.length === 0) return -1

  const origin = getXY(target)
  let bestIndex = -1
  let bestDistance = maxDistance

  points.forEach((point, index) => {
    const distance = distanceBetweenPoints(point, origin)
    if (distance <= bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })

  return bestIndex
}
