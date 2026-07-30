import React, { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import {
  neighborFidelityResultAtom,
  neighborFidelitySettingsAtom,
} from '@/store'
import type { NeighborFidelityRecord } from '@/shared/lib/api'
import {
  CANVAS_HEIGHT,
  CANVAS_OFFSET_X,
  CANVAS_OFFSET_Y,
  CANVAS_WIDTH,
} from '../constants'

type Props = {
  rawEmbeddings: Array<{
    id: string | number
    type: string
    point?: [number, number]
  }>
}

const COLORS = {
  preserved: 0x22c55e,
  projectionOnly: 0xef4444,
  clipOnly: 0x38bdf8,
}

export const NeighborFidelityOverlay: React.FC<Props> = ({
  rawEmbeddings,
}) => {
  const settings = useAtomValue(neighborFidelitySettingsAtom)
  const result = useAtomValue(neighborFidelityResultAtom)
  const pointsById = useMemo(
    () =>
      new Map(
        rawEmbeddings
          .filter((item) => item.type === 'image' && item.point)
          .map((item) => [Number(item.id), item.point as [number, number]])
      ),
    [rawEmbeddings]
  )

  if (!settings.enabled || !result) return null
  const selected = pointsById.get(result.selected_image_id)
  if (!selected) return null

  return (
    <pixiContainer position={{ x: CANVAS_OFFSET_X, y: CANVAS_OFFSET_Y }}>
      <pixiGraphics
        draw={(graphics) => {
          graphics.clear()
          const start = {
            x: selected[0] * CANVAS_WIDTH,
            y: selected[1] * CANVAS_HEIGHT,
          }

          const drawSolid = (
            records: NeighborFidelityRecord[],
            color: number
          ) => {
            records.forEach((record) => {
              const point = pointsById.get(record.image_id)
              if (!point) return
              const end = {
                x: point[0] * CANVAS_WIDTH,
                y: point[1] * CANVAS_HEIGHT,
              }
              graphics.moveTo(start.x, start.y)
              graphics.lineTo(end.x, end.y)
              graphics.stroke({ color, width: 3, alpha: 0.78 })
              graphics.circle(end.x, end.y, 6)
              graphics.fill({ color, alpha: 0.9 })
            })
          }

          const drawDashed = (records: NeighborFidelityRecord[]) => {
            records.forEach((record) => {
              const point = pointsById.get(record.image_id)
              if (!point) return
              const end = {
                x: point[0] * CANVAS_WIDTH,
                y: point[1] * CANVAS_HEIGHT,
              }
              const dx = end.x - start.x
              const dy = end.y - start.y
              const distance = Math.hypot(dx, dy)
              if (distance === 0) return
              for (let offset = 0; offset < distance; offset += 20) {
                const from = offset / distance
                const to = Math.min(offset + 12, distance) / distance
                graphics.moveTo(start.x + dx * from, start.y + dy * from)
                graphics.lineTo(start.x + dx * to, start.y + dy * to)
              }
              graphics.stroke({
                color: COLORS.clipOnly,
                width: 3,
                alpha: 0.82,
              })
              graphics.circle(end.x, end.y, 6)
              graphics.fill({ color: COLORS.clipOnly, alpha: 0.9 })
            })
          }

          drawSolid(result.neighbors.preserved, COLORS.preserved)
          drawSolid(result.neighbors.projection_only, COLORS.projectionOnly)
          drawDashed(result.neighbors.clip_only)
          graphics.circle(start.x, start.y, 10)
          graphics.stroke({ color: 0xffffff, width: 3, alpha: 0.95 })
        }}
        eventMode="none"
      />
    </pixiContainer>
  )
}
