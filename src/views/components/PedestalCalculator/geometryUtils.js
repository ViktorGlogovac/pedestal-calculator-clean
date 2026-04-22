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

// 2. Subdivide a rectangle into 60×60 sub-tiles (or any step)
export function subdivideTileRect(x, y, w, h, step = 60) {
  const polygons = []
  const endX = x + w
  const endY = y + h

  let rowY = y
  while (rowY < endY - EPSILON) {
    const subH = Math.min(step, endY - rowY)
    let colX = x
    while (colX < endX - EPSILON) {
      const subW = Math.min(step, endX - colX)
      const subTile = [
        [
          [colX, rowY],
          [colX + subW, rowY],
          [colX + subW, rowY + subH],
          [colX, rowY + subH],
          [colX, rowY],
        ],
      ]
      polygons.push(subTile)
      colX += step
    }
    rowY += step
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

export function dedupeAndSnapPedestals(pedestals, polygon, tolerance = 0.35) {
  if (!Array.isArray(pedestals) || pedestals.length === 0) return []

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
      if (!snappedVertex) {
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
