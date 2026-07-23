import React, { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import {
  activeDatasetIdAtom,
  graphLayoutAtom,
  graphNetworksAtom,
} from '@/store'
import {
  CANVAS_HEIGHT,
  CANVAS_OFFSET_X,
  CANVAS_OFFSET_Y,
  CANVAS_WIDTH,
} from '../constants'

export const GraphNetworkLayer: React.FC = () => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const networks = useAtomValue(graphNetworksAtom)
  const layout = useAtomValue(graphLayoutAtom)
  const graph = datasetId ? networks[datasetId] : null

  const nodesById = useMemo(
    () => new Map(graph?.nodes.map((node) => [node.id, node]) ?? []),
    [graph]
  )

  if (!graph) return null

  const maxDepth = Math.max(0, ...graph.nodes.map((node) => node.depth))
  const threshold = graph.parameters.min_similarity
  const edgeAlpha = (similarity: number, base: number, range: number) => {
    const denominator = Math.max(0.001, 1 - threshold)
    const strength = Math.max(0, Math.min(1, (similarity - threshold) / denominator))
    return base + range * strength
  }

  return (
    <pixiContainer position={{ x: CANVAS_OFFSET_X, y: CANVAS_OFFSET_Y }}>
      {layout === 'concentric' &&
        Array.from({ length: maxDepth }, (_, index) => index + 1).map((depth) => (
          <pixiGraphics
            key={`graph_ring_${depth}`}
            draw={(graphics) => {
              graphics.clear()
              graphics.ellipse(
                CANVAS_WIDTH / 2,
                CANVAS_HEIGHT / 2,
                (CANVAS_WIDTH * 0.45 * depth) / maxDepth,
                (CANVAS_HEIGHT * 0.45 * depth) / maxDepth
              )
              graphics.stroke({
                color: 0xffffff,
                width: 1,
                alpha: 0.1,
              })
            }}
            eventMode="none"
          />
        ))}

      <pixiGraphics
        draw={(graphics) => {
          graphics.clear()
          graph.edges.forEach((edge) => {
            const source = nodesById.get(edge.source)
            const target = nodesById.get(edge.target)
            if (!source || !target) return
            const [sourceX, sourceY] = source.positions[layout]
            const [targetX, targetY] = target.positions[layout]
            graphics.moveTo(sourceX * CANVAS_WIDTH, sourceY * CANVAS_HEIGHT)
            graphics.lineTo(targetX * CANVAS_WIDTH, targetY * CANVAS_HEIGHT)
            graphics.stroke({
              color: edge.kind === 'tree' ? 0xffffff : 0x67e8f9,
              width: edge.kind === 'tree' ? 2 : 1,
              alpha:
                edge.kind === 'tree'
                  ? edgeAlpha(edge.similarity, 0.35, 0.35)
                  : edgeAlpha(edge.similarity, 0.18, 0.25),
            })
          })
        }}
        eventMode="none"
      />

      <pixiGraphics
        x={CANVAS_WIDTH / 2}
        y={CANVAS_HEIGHT / 2}
        draw={(graphics) => {
          graphics.clear()
          graphics.circle(0, 0, 46)
          graphics.fill({ color: 0xffaa33, alpha: 0.08 })
          graphics.stroke({ color: 0xffaa33, width: 5, alpha: 0.95 })
        }}
        eventMode="none"
      />
    </pixiContainer>
  )
}
