import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import {
  explanationTabAtom,
  projectionStabilityResultAtom,
  selectedStabilityClusterAtom,
} from '@/store'
import { buildClusterRegions } from '../clusterGeometry'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../constants'

const stabilityColor = (stability: number) =>
  stability >= 0.8 ? 0x22c55e : stability >= 0.6 ? 0xf59e0b : 0xef4444

export const ProjectionStabilityOverlay = ({
  rawEmbeddings,
}: {
  rawEmbeddings: Array<{
    id: string | number
    point?: readonly number[]
    type?: string
  }>
}) => {
  const tab = useAtomValue(explanationTabAtom)
  const result = useAtomValue(projectionStabilityResultAtom)
  const selectedClusterId = useAtomValue(selectedStabilityClusterAtom)
  const regions = useMemo(
    () => buildClusterRegions(result, rawEmbeddings),
    [rawEmbeddings, result]
  )
  const pointsById = useMemo(
    () =>
      new Map(
        rawEmbeddings
          .filter(
            (item) =>
              item.type === 'image' &&
              Array.isArray(item.point) &&
              item.point.length === 2
          )
          .map((item) => [
            Number(item.id),
            {
              x: Number(item.point?.[0] ?? 0) * CANVAS_WIDTH,
              y: Number(item.point?.[1] ?? 0) * CANVAS_HEIGHT,
            },
          ])
      ),
    [rawEmbeddings]
  )

  if (tab !== 'stability' || !result) return null
  const clusterById = new Map(
    result.clusters.map((cluster) => [cluster.cluster_id, cluster])
  )
  return (
    <pixiContainer eventMode="none">
      {regions.map((region) => {
        const cluster = clusterById.get(region.clusterId)
        if (!cluster) return null
        const color = stabilityColor(cluster.stability)
        const selected = region.clusterId === selectedClusterId
        return (
          <pixiGraphics
            key={region.clusterId}
            eventMode="none"
            draw={(graphics) => {
              graphics.clear()
              if (region.hull.length === 1) {
                graphics.circle(region.hull[0].x, region.hull[0].y, 34)
                graphics.fill({ color, alpha: selected ? 0.22 : 0.11 })
                graphics.stroke({
                  color,
                  width: selected ? 5 : 3,
                  alpha: selected ? 0.95 : 0.62,
                })
                return
              }
              if (region.hull.length === 2) {
                graphics.moveTo(region.hull[0].x, region.hull[0].y)
                graphics.lineTo(region.hull[1].x, region.hull[1].y)
                graphics.stroke({
                  color,
                  width: selected ? 48 : 36,
                  alpha: selected ? 0.22 : 0.11,
                })
                graphics.moveTo(region.hull[0].x, region.hull[0].y)
                graphics.lineTo(region.hull[1].x, region.hull[1].y)
                graphics.stroke({
                  color,
                  width: selected ? 5 : 3,
                  alpha: selected ? 0.95 : 0.62,
                })
                return
              }
              graphics.poly(region.hull.flatMap((point) => [point.x, point.y]))
              graphics.fill({ color, alpha: selected ? 0.2 : 0.09 })
              graphics.stroke({
                color,
                width: selected ? 5 : 3,
                alpha: selected ? 0.95 : 0.58,
              })
            }}
          />
        )
      })}
      <pixiGraphics
        eventMode="none"
        draw={(graphics) => {
          graphics.clear()
          result.ambiguous_images.forEach((image) => {
            const point = pointsById.get(image.image_id)
            if (!point) return
            graphics.circle(point.x, point.y, 13)
            graphics.stroke({
              color: 0xef4444,
              width: 4,
              alpha: 0.9,
            })
          })
        }}
      />
    </pixiContainer>
  )
}
