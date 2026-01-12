import React, { useEffect, useMemo, useRef } from 'react'
import * as PIXI from 'pixi.js'
import type { Viewport } from '../ViewPort'
import { computeProjectionBounds } from '../utils'
import { MINIMAP_MARGIN, MINIMAP_PADDING, MINIMAP_SIZE } from '../constants'
import { EmbeddingsLayer } from './EmbeddingsLayer'

export const Minimap: React.FC<{
  allLoaded: boolean
  masterAtlas: Record<number, PIXI.Spritesheet>
  particleContainerRefs: React.RefObject<PIXI.ParticleContainer | null>[]
  rawEmbeddings: any[]
  windowSize: { width: number; height: number }
  viewportRef: React.RefObject<Viewport | null>
  projectionType: string
}> = ({
  allLoaded,
  masterAtlas,
  particleContainerRefs,
  rawEmbeddings,
  windowSize,
  viewportRef,
  projectionType,
}) => {
  const minimapFrameRef = useRef<PIXI.Graphics>(null)

  const minimapBounds = useMemo(
    () => computeProjectionBounds(rawEmbeddings),
    [rawEmbeddings]
  )

  const minimapTransform = useMemo(() => {
    if (!minimapBounds) {
      return {
        scale: 0.015,
        position: { x: 0, y: 0 },
        pivot: { x: 0, y: 0 },
      }
    }
    const innerSize = MINIMAP_SIZE - MINIMAP_PADDING * 2
    const scale = Math.min(
      innerSize / minimapBounds.width,
      innerSize / minimapBounds.height
    )
    return {
      scale,
      position: {
        x: MINIMAP_PADDING + innerSize / 2,
        y: MINIMAP_PADDING + innerSize / 2,
      },
      pivot: {
        x: minimapBounds.x + minimapBounds.width / 2,
        y: minimapBounds.y + minimapBounds.height / 2,
      },
    }
  }, [minimapBounds])

  useEffect(() => {
    const viewport = viewportRef.current
    const g = minimapFrameRef.current
    if (!viewport || !g) return

    const computeWorldBounds = () => {
      if (typeof (viewport as any).getVisibleBounds === 'function') {
        return (viewport as any).getVisibleBounds()
      }
      const topLeft = viewport.toWorld(new PIXI.Point(0, 0))
      const bottomRight = viewport.toWorld(
        new PIXI.Point(viewport.screenWidth, viewport.screenHeight)
      )
      return new PIXI.Rectangle(
        topLeft.x,
        topLeft.y,
        bottomRight.x - topLeft.x,
        bottomRight.y - topLeft.y
      )
    }

    const draw = () => {
      const b = computeWorldBounds()

      g.clear()
      if (projectionType === 'umap' && b.width < 25000) {
        g.rect(b.x, b.y, b.width, b.height)
        g.fill({ color: 'white', alpha: 0.1 })
        g.stroke({ color: 'white', width: 100 })
        g.fill()
      }
    }

    draw()
    viewport.on('moved', draw)
    return () => {
      viewport.off('moved', draw)
    }
  }, [projectionType, viewportRef])

  if (!allLoaded) return null

  return (
    <pixiContainer
      position={{
        x: windowSize.width - MINIMAP_SIZE - MINIMAP_MARGIN,
        y: windowSize.height - MINIMAP_SIZE - MINIMAP_MARGIN,
      }}
      width={MINIMAP_SIZE}
      height={MINIMAP_SIZE}
    >
      <pixiGraphics
        draw={(g) => {
          g.rect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE)
          g.fill({ color: 'black', alpha: 0.75 })
          g.stroke({ color: 'white', width: 1 })
          g.fill()
        }}
      />
      <pixiContainer
        scale={minimapTransform.scale}
        position={minimapTransform.position}
        pivot={minimapTransform.pivot}
      >
        <EmbeddingsLayer
          type="minimap"
          masterAtlas={masterAtlas}
          particleContainerRefs={particleContainerRefs}
        />
        {/* @ts-ignore */}
        <pixiGraphics ref={minimapFrameRef} />
      </pixiContainer>
    </pixiContainer>
  )
}
