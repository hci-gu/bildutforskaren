import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import {
  clusterProfilesResultAtom,
  projectionStabilityOverlayEnabledAtom,
  projectionStabilityResultAtom,
  selectedExplainedClusterAtom,
} from '@/store'
import { buildClusterRegions } from '../clusterGeometry'
import { CLUSTER_COLORS } from '../xaiVisuals'

export const ClusterProfileOverlay = ({
  rawEmbeddings,
}: {
  rawEmbeddings: Array<{
    id: string | number
    point?: readonly number[]
    type?: string
  }>
}) => {
  const result = useAtomValue(clusterProfilesResultAtom)
  const stabilityResult = useAtomValue(projectionStabilityResultAtom)
  const stabilityOverlayEnabled = useAtomValue(
    projectionStabilityOverlayEnabledAtom
  )
  const selectedClusterId = useAtomValue(selectedExplainedClusterAtom)
  const regions = useMemo(
    () => buildClusterRegions(result, rawEmbeddings),
    [rawEmbeddings, result]
  )

  if (
    !result ||
    (stabilityResult !== null && stabilityOverlayEnabled)
  ) {
    return null
  }
  return (
    <pixiContainer eventMode="none">
      {regions.map((region) => {
        const color =
          CLUSTER_COLORS[region.clusterId % CLUSTER_COLORS.length]
        const selected = region.clusterId === selectedClusterId
        return (
          <pixiGraphics
            key={region.clusterId}
            eventMode="none"
            draw={(graphics) => {
              graphics.clear()
              if (region.hull.length === 1) {
                graphics.circle(region.hull[0].x, region.hull[0].y, 34)
                graphics.fill({ color, alpha: selected ? 0.2 : 0.1 })
                graphics.stroke({
                  color,
                  width: selected ? 5 : 3,
                  alpha: selected ? 0.9 : 0.55,
                })
                return
              }
              if (region.hull.length === 2) {
                graphics.moveTo(region.hull[0].x, region.hull[0].y)
                graphics.lineTo(region.hull[1].x, region.hull[1].y)
                graphics.stroke({
                  color,
                  width: selected ? 48 : 36,
                  alpha: selected ? 0.2 : 0.1,
                })
                graphics.moveTo(region.hull[0].x, region.hull[0].y)
                graphics.lineTo(region.hull[1].x, region.hull[1].y)
                graphics.stroke({
                  color,
                  width: selected ? 5 : 3,
                  alpha: selected ? 0.9 : 0.55,
                })
                return
              }
              graphics.poly(region.hull.flatMap((point) => [point.x, point.y]))
              graphics.fill({ color, alpha: selected ? 0.18 : 0.08 })
              graphics.stroke({
                color,
                width: selected ? 5 : 3,
                alpha: selected ? 0.9 : 0.5,
              })
            }}
          />
        )
      })}
    </pixiContainer>
  )
}
