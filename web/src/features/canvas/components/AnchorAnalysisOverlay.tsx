import React, { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import {
  anchorAnalysisCompareAtom,
  anchorAnalysisResultAtom,
  anchorAnalysisTabAtom,
  anchorGraphModeAtom,
  anchorGroupsAtom,
} from '@/store'
import {
  CANVAS_HEIGHT,
  CANVAS_OFFSET_X,
  CANVAS_OFFSET_Y,
  CANVAS_WIDTH,
} from '../constants'
import { getAnchorAnalysisDisplayPaths } from '../anchorAnalysisPaths'

type Props = {
  rawEmbeddings: Array<{
    id: string | number
    type: string
    point?: [number, number]
  }>
}

export const AnchorAnalysisOverlay: React.FC<Props> = ({ rawEmbeddings }) => {
  const groups = useAtomValue(anchorGroupsAtom)
  const result = useAtomValue(anchorAnalysisResultAtom)
  const tab = useAtomValue(anchorAnalysisTabAtom)
  const graphMode = useAtomValue(anchorGraphModeAtom)
  const compare = useAtomValue(anchorAnalysisCompareAtom)

  const pointsById = useMemo(
    () =>
      new Map(
        rawEmbeddings
          .filter((item) => item.type === 'image' && item.point)
          .map((item) => [Number(item.id), item.point as [number, number]])
      ),
    [rawEmbeddings]
  )

  const paths = useMemo(() => {
    return getAnchorAnalysisDisplayPaths(result, tab, graphMode, compare)
  }, [compare, graphMode, result, tab])

  if (!groups.a.length && !groups.b.length && !result) return null

  return (
    <pixiContainer position={{ x: CANVAS_OFFSET_X, y: CANVAS_OFFSET_Y }}>
      <pixiGraphics
        draw={(graphics) => {
          graphics.clear()
          paths.forEach((path) => {
            const points = path.ids
              .map((id) => pointsById.get(Number(id)))
              .filter((point): point is [number, number] => !!point)
            points.forEach((point, index) => {
              const x = point[0] * CANVAS_WIDTH
              const y = point[1] * CANVAS_HEIGHT
              if (index === 0) {
                graphics.moveTo(x, y)
              } else {
                graphics.lineTo(x, y)
              }
            })
            if (points.length > 1) {
              graphics.stroke({
                color: path.color,
                width: compare ? 2 : 3,
                alpha: compare ? 0.55 : 0.8,
              })
            }
            points.forEach((point, index) => {
              const x = point[0] * CANVAS_WIDTH
              const y = point[1] * CANVAS_HEIGHT
              graphics.circle(x, y, compare ? 5 : 7)
              graphics.fill({ color: path.color, alpha: 0.9 })
              if (!compare && index > 0) {
                const previous = points[index - 1]
                const px = previous[0] * CANVAS_WIDTH
                const py = previous[1] * CANVAS_HEIGHT
                const angle = Math.atan2(y - py, x - px)
                const arrowX = x - Math.cos(angle) * 11
                const arrowY = y - Math.sin(angle) * 11
                graphics
                  .poly([
                    arrowX,
                    arrowY,
                    arrowX - Math.cos(angle - 0.65) * 8,
                    arrowY - Math.sin(angle - 0.65) * 8,
                    arrowX - Math.cos(angle + 0.65) * 8,
                    arrowY - Math.sin(angle + 0.65) * 8,
                  ])
                  .fill({ color: path.color, alpha: 0.85 })
              }
            })
          })

          const drawAnchor = (ids: string[], color: number) => {
            ids.forEach((id) => {
              const point = pointsById.get(Number(id))
              if (!point) return
              graphics.circle(
                point[0] * CANVAS_WIDTH,
                point[1] * CANVAS_HEIGHT,
                16
              )
              graphics.stroke({ color, width: 4, alpha: 0.95 })
            })
          }
          drawAnchor(groups.a, 0xf59e0b)
          drawAnchor(groups.b, 0x22d3ee)
        }}
        eventMode="none"
      />
    </pixiContainer>
  )
}
