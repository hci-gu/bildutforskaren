import type { ClusterProfilesResponse } from '@/shared/lib/api'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './constants'

export type WorldPoint = { x: number; y: number }

export type ClusterRegion = {
  clusterId: number
  points: WorldPoint[]
  hull: WorldPoint[]
  centroid: WorldPoint
  area: number
}

const cross = (origin: WorldPoint, a: WorldPoint, b: WorldPoint) =>
  (a.x - origin.x) * (b.y - origin.y) -
  (a.y - origin.y) * (b.x - origin.x)

const convexHull = (points: WorldPoint[]) => {
  const unique = Array.from(
    new Map(points.map((point) => [`${point.x}:${point.y}`, point])).values()
  ).sort((a, b) => a.x - b.x || a.y - b.y)
  if (unique.length <= 2) return unique

  const lower: WorldPoint[] = []
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop()
    }
    lower.push(point)
  }
  const upper: WorldPoint[] = []
  for (let index = unique.length - 1; index >= 0; index--) {
    const point = unique[index]
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop()
    }
    upper.push(point)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

const polygonArea = (points: WorldPoint[]) => {
  if (points.length < 3) return Infinity
  let sum = 0
  for (let index = 0; index < points.length; index++) {
    const next = points[(index + 1) % points.length]
    sum += points[index].x * next.y - next.x * points[index].y
  }
  return Math.abs(sum) / 2
}

export const buildClusterRegions = (
  result: ClusterProfilesResponse | null,
  embeddings: Array<{
    id: string | number
    point?: readonly number[]
    type?: string
  }>
) => {
  if (!result) return []
  const pointsById = new Map<number, WorldPoint>()
  embeddings.forEach((embedding) => {
    if (
      embedding.type !== 'image' ||
      !Array.isArray(embedding.point) ||
      embedding.point.length !== 2
    ) {
      return
    }
    pointsById.set(Number(embedding.id), {
      x: embedding.point[0] * CANVAS_WIDTH,
      y: embedding.point[1] * CANVAS_HEIGHT,
    })
  })

  return result.clusters
    .map((cluster): ClusterRegion | null => {
      const points = cluster.image_ids
        .map((imageId) => pointsById.get(imageId))
        .filter((point): point is WorldPoint => !!point)
      if (points.length === 0) return null
      const hull = convexHull(points)
      const centroid = {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      }
      return {
        clusterId: cluster.cluster_id,
        points,
        hull,
        centroid,
        area: polygonArea(hull),
      }
    })
    .filter((region): region is ClusterRegion => !!region)
}

const distanceToSegment = (
  point: WorldPoint,
  start: WorldPoint,
  end: WorldPoint
) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 1e-12) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
    )
  )
  return Math.hypot(
    point.x - (start.x + t * dx),
    point.y - (start.y + t * dy)
  )
}

const contains = (region: ClusterRegion, point: WorldPoint) => {
  if (region.hull.length === 1) {
    return Math.hypot(
      point.x - region.hull[0].x,
      point.y - region.hull[0].y
    ) <= 34
  }
  if (region.hull.length === 2) {
    return distanceToSegment(point, region.hull[0], region.hull[1]) <= 28
  }
  let inside = false
  for (
    let index = 0, previous = region.hull.length - 1;
    index < region.hull.length;
    previous = index++
  ) {
    const a = region.hull[index]
    const b = region.hull[previous]
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x <
        ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + 1e-12) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

export const clusterAtWorldPoint = (
  regions: ClusterRegion[],
  point: WorldPoint
) =>
  regions
    .filter((region) => contains(region, point))
    .sort(
      (a, b) =>
        a.area - b.area ||
        Math.hypot(point.x - a.centroid.x, point.y - a.centroid.y) -
          Math.hypot(point.x - b.centroid.x, point.y - b.centroid.y)
    )[0] ?? null
