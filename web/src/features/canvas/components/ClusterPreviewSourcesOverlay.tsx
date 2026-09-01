import React, { useMemo } from 'react'
import type { ClusterPreview } from '@/shared/lib/api'
import {
  CANVAS_HEIGHT,
  CANVAS_OFFSET_X,
  CANVAS_OFFSET_Y,
  CANVAS_WIDTH,
} from '../constants'

type Props = {
  cluster: ClusterPreview | null
  rawEmbeddings: Array<{
    id: string | number
    type: string
    point?: [number, number]
  }>
}

const SOURCE_LINE_COLOR = 0x3b82f6

export const ClusterPreviewSourcesOverlay: React.FC<Props> = ({
  cluster,
  rawEmbeddings,
}) => {
  const sourcePoints = useMemo(() => {
    if (!cluster) return []
    const sourceIds = new Set(cluster.image_ids.map(Number))
    return rawEmbeddings
      .filter(
        (item) =>
          item.type === 'image' &&
          item.point &&
          sourceIds.has(Number(item.id))
      )
      .map((item) => item.point as [number, number])
  }, [cluster, rawEmbeddings])

  if (!cluster || sourcePoints.length === 0) return null

  return (
    <pixiContainer position={{ x: CANVAS_OFFSET_X, y: CANVAS_OFFSET_Y }}>
      <pixiGraphics
        draw={(graphics) => {
          graphics.clear()
          const start = {
            x: cluster.centroid[0] * CANVAS_WIDTH,
            y: cluster.centroid[1] * CANVAS_HEIGHT,
          }

          sourcePoints.forEach(([nx, ny]) => {
            graphics.moveTo(start.x, start.y)
            graphics.lineTo(nx * CANVAS_WIDTH, ny * CANVAS_HEIGHT)
          })
          graphics.stroke({
            color: SOURCE_LINE_COLOR,
            width: 3,
            alpha: 0.85,
          })
        }}
        eventMode="none"
      />
    </pixiContainer>
  )
}
