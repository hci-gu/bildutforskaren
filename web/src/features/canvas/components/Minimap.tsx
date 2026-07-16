import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import * as PIXI from 'pixi.js'
import type { Viewport } from '../ViewPort'
import { computeProjectionBounds } from '../utils'
import {
  MINIMAP_DEAD_ZONE,
  MINIMAP_MARGIN,
  MINIMAP_PADDING,
  MINIMAP_SIZE,
} from '../constants'
import { EmbeddingsLayer } from './EmbeddingsLayer'
import type { AtlasMeta } from '../hooks/useAtlasLoader'

export const Minimap: React.FC<{
  allLoaded: boolean
  masterAtlas: Record<number, PIXI.Spritesheet>
  atlasMeta: AtlasMeta
  particleContainerRefs: React.RefObject<PIXI.ParticleContainer | null>[]
  rawEmbeddings: any[]
  windowSize: { width: number; height: number }
  viewportRef: React.RefObject<Viewport | null>
  projectionType: string
}> = ({
  allLoaded,
  masterAtlas,
  atlasMeta,
  particleContainerRefs,
  rawEmbeddings,
  windowSize,
  viewportRef,
  projectionType,
}) => {
  const minimapFrameRef = useRef<PIXI.Graphics>(null)
  const minimapSurfaceRef = useRef<PIXI.Graphics>(null)
  const isPanningRef = useRef(false)
  const redrawViewportFrameRef = useRef<() => void>(() => undefined)

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
    const scale = Math.min(innerSize / minimapBounds.width, innerSize / minimapBounds.height)
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

  const panToPointer = useCallback(
    (event: PIXI.FederatedPointerEvent) => {
      const viewport = viewportRef.current
      const surface = minimapSurfaceRef.current
      if (!viewport || !surface) return

      const point = event.getLocalPosition(surface)
      viewport.moveCenter({
        x:
          (point.x - minimapTransform.position.x) /
            minimapTransform.scale +
          minimapTransform.pivot.x,
        y:
          (point.y - minimapTransform.position.y) /
            minimapTransform.scale +
          minimapTransform.pivot.y,
      })
      redrawViewportFrameRef.current()
    },
    [minimapTransform, viewportRef]
  )

  useEffect(() => {
    const viewport = viewportRef.current
    const g = minimapFrameRef.current
    if (!viewport || !g) return

    const computeWorldBounds = () => {
      if (typeof (viewport as any).getVisibleBounds === 'function') {
        return (viewport as any).getVisibleBounds()
      }
      const topLeft = viewport.toWorld(new PIXI.Point(0, 0))
      const bottomRight = viewport.toWorld(new PIXI.Point(viewport.screenWidth, viewport.screenHeight))
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
        g.stroke({ color: 'white', width: 1 / minimapTransform.scale })
      }
    }

    redrawViewportFrameRef.current = draw
    draw()
    viewport.on('moved', draw)
    viewport.on('zoomed', draw)
    return () => {
      redrawViewportFrameRef.current = () => undefined
      viewport.off('moved', draw)
      viewport.off('zoomed', draw)
    }
  }, [minimapTransform.scale, projectionType, viewportRef])

  if (!allLoaded) return null

  const minimapOuterSize = MINIMAP_SIZE + MINIMAP_DEAD_ZONE * 2

  return (
    <pixiContainer
      position={{
        x: windowSize.width - minimapOuterSize - MINIMAP_MARGIN,
        y: windowSize.height - minimapOuterSize - MINIMAP_MARGIN,
      }}
      width={minimapOuterSize}
      height={minimapOuterSize}
    >
      <pixiGraphics
        draw={(g) => {
          g.rect(0, 0, minimapOuterSize, minimapOuterSize)
          g.fill({ color: 'black', alpha: 0.001 })
        }}
        eventMode="static"
        onPointerDown={(event: PIXI.FederatedPointerEvent) =>
          event.stopPropagation()
        }
        onPointerMove={(event: PIXI.FederatedPointerEvent) =>
          event.stopPropagation()
        }
        onPointerUp={(event: PIXI.FederatedPointerEvent) =>
          event.stopPropagation()
        }
        onPointerUpOutside={(event: PIXI.FederatedPointerEvent) =>
          event.stopPropagation()
        }
        onWheel={(event: PIXI.FederatedWheelEvent) => event.stopPropagation()}
      />
      <pixiContainer
        position={{ x: MINIMAP_DEAD_ZONE, y: MINIMAP_DEAD_ZONE }}
      >
        <pixiGraphics
          ref={minimapSurfaceRef}
          draw={(g) => {
            g.rect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE)
            g.fill({ color: 'black', alpha: 0.75 })
            g.stroke({ color: 'white', width: 1 })
          }}
          eventMode="static"
          cursor="grab"
          onPointerDown={(event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation()
            isPanningRef.current = true
            panToPointer(event)
          }}
          onPointerMove={(event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation()
            if (isPanningRef.current) panToPointer(event)
          }}
          onPointerUp={(event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation()
            isPanningRef.current = false
          }}
          onPointerUpOutside={(event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation()
            isPanningRef.current = false
          }}
          onWheel={(event: PIXI.FederatedWheelEvent) =>
            event.stopPropagation()
          }
        />
        <pixiContainer
          scale={minimapTransform.scale}
          position={minimapTransform.position}
          pivot={minimapTransform.pivot}
        >
          <EmbeddingsLayer
            type="minimap"
            masterAtlas={masterAtlas}
            atlasMeta={atlasMeta}
            particleContainerRefs={particleContainerRefs}
            rawEmbeddings={rawEmbeddings}
          />
          {/* @ts-ignore */}
          <pixiGraphics ref={minimapFrameRef} />
        </pixiContainer>
      </pixiContainer>
    </pixiContainer>
  )
}
