import type React from 'react'
import * as PIXI from 'pixi.js'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './constants'
import type { CustomParticle } from './types'

export const colorForMetadata = (metadata: any) => {
  switch (metadata.photographer) {
    case '1':
      return 0x5555ff
    case '2':
      return 0x55ff55
    case '3':
      return 0xffff55
    case '4':
      return 0xff55ff
    default:
      return 0xffffff
  }
}

export const computeProjectionBounds = (embeddings: any[]) => {
  if (!embeddings.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  embeddings.forEach((embedding) => {
    if (!embedding?.point) return
    const [nx, ny] = embedding.point
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return
    const x = nx * CANVAS_WIDTH
    const y = ny * CANVAS_HEIGHT
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  })
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

export const computeProjectionFit = (embeddings: any[]) => {
  const validEmbeddings = embeddings.filter((embedding) => {
    if (!embedding?.point) return false
    const [nx, ny] = embedding.point
    return Number.isFinite(nx) && Number.isFinite(ny)
  })
  const imageEmbeddings = validEmbeddings.filter(
    (embedding) => embedding.type === 'image'
  )
  const embeddingsToFit = imageEmbeddings.length > 0
    ? imageEmbeddings
    : validEmbeddings

  if (embeddingsToFit.length === 0) return null

  const points = embeddingsToFit.map((embedding) => ({
    x: embedding.point[0] * CANVAS_WIDTH,
    y: embedding.point[1] * CANVAS_HEIGHT,
  }))
  const center = points.reduce(
    (sum, point) => ({
      x: sum.x + point.x / points.length,
      y: sum.y + point.y / points.length,
    }),
    { x: 0, y: 0 }
  )
  let halfWidth = 0.5
  let halfHeight = 0.5
  points.forEach((point) => {
    halfWidth = Math.max(halfWidth, Math.abs(point.x - center.x))
    halfHeight = Math.max(halfHeight, Math.abs(point.y - center.y))
  })

  return {
    center,
    width: halfWidth * 2,
    height: halfHeight * 2,
  }
}

export const buildSelectionRect = (
  start: PIXI.PointData,
  end: PIXI.PointData
) => {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  return new PIXI.Rectangle(x, y, width, height)
}

export const pointIntersectsParticle = (
  x: number,
  y: number,
  containerRefs: React.RefObject<PIXI.ParticleContainer | null>[]
): CustomParticle | null => {
  for (const ref of containerRefs) {
    if (!ref.current) continue
    for (const particle of ref.current.particleChildren as CustomParticle[]) {
      const dx = x - particle.x
      const dy = y - particle.y
      if (dx * dx + dy * dy < 50) return particle
    }
  }
  return null
}
