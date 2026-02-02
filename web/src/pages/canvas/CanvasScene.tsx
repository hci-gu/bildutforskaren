import React, { useEffect, useMemo, useRef, useState } from 'react'
import '@pixi/events'
import { Application, extend } from '@pixi/react'
import * as PIXI from 'pixi.js'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  loadableProjectedEmbeddingsAtom,
  projectionRevisionAtom,
  projectionSettingsAtom,
  selectedEmbeddingAtom,
  selectedEmbeddingIdsAtom,
  tagRefreshTriggerAtom,
  viewportScaleAtom,
} from '@/state'
import { state } from './canvasState'
import { Viewport } from './ViewPort'
import Panel from './Panel'
import { CANVAS_HEIGHT, CANVAS_WIDTH, CLICK_EPS } from './constants'
import { buildSelectionRect, computeProjectionBounds, pointIntersectsParticle } from './utils'
import { useAtlasLoader } from './hooks/useAtlasLoader'
import { EmbeddingsLayer } from './components/EmbeddingsLayer'
import { SelectionRect } from './components/SelectionRect'
import { Minimap } from './components/Minimap'
import { HUD } from './components/HUD'

extend({
  Viewport,
  ParticleContainer: PIXI.ParticleContainer,
  Particle: PIXI.Particle,
  Container: PIXI.Container,
  Sprite: PIXI.Sprite,
  Text: PIXI.Text,
  Graphics: PIXI.Graphics,
})

type Props = {
  width?: number
  height?: number
}

export const CanvasScene: React.FC<Props> = ({ width = 1920, height = 1200 }) => {
  const dragStart = useRef<PIXI.PointData | null>(null)
  const selectionStart = useRef<PIXI.PointData | null>(null)
  const selectionActiveRef = useRef(false)
  const [selectionRect, setSelectionRect] = useState<PIXI.Rectangle | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshUntilRef = useRef(0)

  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const setSelectedEmbeddingIds = useSetAtom(selectedEmbeddingIdsAtom)
  const setViewportScale = useSetAtom(viewportScaleAtom)

  const projectionSettings = useAtomValue(projectionSettingsAtom)
  const projectionRevision = useAtomValue(projectionRevisionAtom)
  const tagRefreshTrigger = useAtomValue(tagRefreshTriggerAtom)

  const [showTagRefresh, setShowTagRefresh] = useState(false)

  const viewportRef = useRef<Viewport>(null)

  const [windowSize, setWindowSize] = useState(() => ({
    width: typeof window === 'undefined' ? width : window.innerWidth,
    height: typeof window === 'undefined' ? height : window.innerHeight,
  }))

  const mainEmbeddingsLoadable = useAtomValue(loadableProjectedEmbeddingsAtom('main'))
  const minimapEmbeddingsLoadable = useAtomValue(
    loadableProjectedEmbeddingsAtom('minimap')
  )

  const [rawEmbeddings, setRawEmbeddings] = useState<any[]>([])
  const [rawMinimapEmbeddings, setRawMinimapEmbeddings] = useState<any[]>([])
  const [visibleBounds, setVisibleBounds] = useState<PIXI.Rectangle | null>(null)

  useEffect(() => {
    if (mainEmbeddingsLoadable.state === 'hasData') {
      setRawEmbeddings(mainEmbeddingsLoadable.data as any[])
    }
  }, [mainEmbeddingsLoadable])

  useEffect(() => {
    if (minimapEmbeddingsLoadable.state === 'hasData') {
      setRawMinimapEmbeddings(minimapEmbeddingsLoadable.data as any[])
    }
  }, [minimapEmbeddingsLoadable])

  useEffect(() => {
    if (!tagRefreshTrigger) return
    const minDurationMs = 1200
    const now = Date.now()
    refreshUntilRef.current = Math.max(refreshUntilRef.current, now + minDurationMs)
    setShowTagRefresh(true)
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
    }
    const remaining = Math.max(0, refreshUntilRef.current - Date.now())
    refreshTimerRef.current = setTimeout(() => {
      setShowTagRefresh(false)
    }, remaining)
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
    }
  }, [tagRefreshTrigger])

  const isProjecting =
    mainEmbeddingsLoadable.state === 'loading' ||
    minimapEmbeddingsLoadable.state === 'loading'

  const { allLoaded, masterAtlas, atlasMeta, numSheets } = useAtlasLoader()

  const particleContainerRefs = useMemo(() => {
    const count = Math.max(1, numSheets || 1)
    return Array.from({ length: count }, () =>
      React.createRef<PIXI.ParticleContainer>()
    )
  }, [numSheets])

  const minimapParticleContainerRefs = useMemo(() => {
    const count = Math.max(1, numSheets || 1)
    return Array.from({ length: count }, () =>
      React.createRef<PIXI.ParticleContainer>()
    )
  }, [numSheets])

  const projectionBounds = useMemo(
    () => computeProjectionBounds(rawEmbeddings),
    [rawEmbeddings]
  )

  const projectionKey = useMemo(
    () =>
      JSON.stringify({
        projectionSettings,
        projectionRevision,
      }),
    [projectionSettings, projectionRevision]
  )

  const lastProjectionKeyRef = useRef<string | null>(null)

  const isCanvasEvent = (e: any) => {
    const target = e?.data?.originalEvent?.target as HTMLElement | null
    if (!target || typeof target.closest !== 'function') return true
    return !target.closest('[data-canvas-ui="true"]')
  }

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (typeof (viewport as any).resize === 'function') {
      ;(viewport as any).resize(
        windowSize.width,
        windowSize.height,
        width,
        height
      )
    } else {
      viewport.screenWidth = windowSize.width
      viewport.screenHeight = windowSize.height
    }
  }, [windowSize.width, windowSize.height, width, height])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const updateScale = () => {
      setViewportScale(viewport.scale?.x ?? 1)
    }
    const updateBounds = () => {
      if (typeof (viewport as any).getVisibleBounds === 'function') {
        setVisibleBounds((viewport as any).getVisibleBounds())
        return
      }
      const topLeft = viewport.toWorld(new PIXI.Point(0, 0))
      const bottomRight = viewport.toWorld(
        new PIXI.Point(viewport.screenWidth, viewport.screenHeight)
      )
      setVisibleBounds(
        new PIXI.Rectangle(
          topLeft.x,
          topLeft.y,
          bottomRight.x - topLeft.x,
          bottomRight.y - topLeft.y
        )
      )
    }
    updateScale()
    updateBounds()
    viewport.on('moved', updateScale)
    viewport.on('zoomed', updateScale)
    viewport.on('moved', updateBounds)
    viewport.on('zoomed', updateBounds)
    return () => {
      viewport.off('moved', updateScale)
      viewport.off('zoomed', updateScale)
      viewport.off('moved', updateBounds)
      viewport.off('zoomed', updateBounds)
    }
  }, [setViewportScale])

  useEffect(() => {
    if (projectionSettings.type !== 'sao') return
    const viewport = viewportRef.current
    if (!viewport) return
    let lastScale = viewport.scale?.x ?? 1
    const tick = () => {
      const nextScale = viewport.scale?.x ?? 1
      if (Math.abs(nextScale - lastScale) > 0.01) {
        lastScale = nextScale
        setViewportScale(nextScale)
        if (typeof (viewport as any).getVisibleBounds === 'function') {
          setVisibleBounds((viewport as any).getVisibleBounds())
        } else {
          const topLeft = viewport.toWorld(new PIXI.Point(0, 0))
          const bottomRight = viewport.toWorld(
            new PIXI.Point(viewport.screenWidth, viewport.screenHeight)
          )
          setVisibleBounds(
            new PIXI.Rectangle(
              topLeft.x,
              topLeft.y,
              bottomRight.x - topLeft.x,
              bottomRight.y - topLeft.y
            )
          )
        }
      }
    }
    const interval = setInterval(tick, 150)
    return () => clearInterval(interval)
  }, [projectionSettings.type, setViewportScale])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !projectionBounds) return
    if (lastProjectionKeyRef.current === projectionKey) return
    lastProjectionKeyRef.current = projectionKey
    const paddingFactor = 0.08
    const paddedWidth = projectionBounds.width * (1 + paddingFactor * 2)
    const paddedHeight = projectionBounds.height * (1 + paddingFactor * 2)
    viewport.fit(false, paddedWidth, paddedHeight)
    viewport.moveCenter({
      x: projectionBounds.x + projectionBounds.width / 2,
      y: projectionBounds.y + projectionBounds.height / 2,
    })
  }, [projectionBounds, projectionKey])

  return (
    <>
      {(!allLoaded || rawEmbeddings.length === 0) && (
        <h1
          style={{
            position: 'absolute',
            top: 44,
            left: 44,
            color: 'white',
            fontSize: 24,
            zIndex: 1000,
          }}
        >
          Laddar...
        </h1>
      )}

      {isProjecting && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="glass-panel-strong rounded-xl px-5 py-3 text-sm text-white shadow-lg">
            Uppdaterar rummet...
          </div>
        </div>
      )}

      {showTagRefresh && !isProjecting && (
        <div className="fixed top-6 left-1/2 z-[9998] -translate-x-1/2">
          <div className="glass-panel-strong flex items-center gap-2 rounded-full px-4 py-2 text-xs text-white shadow-lg">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-white/40 border-t-transparent" />
            Uppdaterar…
          </div>
        </div>
      )}

      <HUD />
      <Panel />

      <Application
        width={windowSize.width}
        height={windowSize.height}
        backgroundAlpha={0}
        onInit={(app) => (state.pixiApp = app)}
      >
        <viewport
          ref={viewportRef}
          width={width}
          height={height}
          events={['move']}
          onPointerDown={(e: any) => {
            if (!isCanvasEvent(e)) return
            const viewport = viewportRef.current
            const isShift = !!e.data?.originalEvent?.shiftKey
            if (isShift && viewport) {
              const world = viewport.toWorld(e.data.global)
              selectionStart.current = world
              selectionActiveRef.current = true
              setSelectionRect(new PIXI.Rectangle(world.x, world.y, 0, 0))
              setSelectedEmbedding(null)
              setSelectedEmbeddingIds([])
              viewport.plugins?.pause?.('drag')
              return
            }
            const screen = viewport?.toScreen(e.data.global)
            dragStart.current = screen ?? null
          }}
          onPointerMove={(e: any) => {
            if (!isCanvasEvent(e)) return
            if (!selectionActiveRef.current || !selectionStart.current) return
            const viewport = viewportRef.current
            if (!viewport) return
            const world = viewport.toWorld(e.data.global)
            setSelectionRect(buildSelectionRect(selectionStart.current, world))
          }}
          onPointerUp={(e: any) => {
            if (!isCanvasEvent(e)) return
            const viewport = viewportRef.current

            if (selectionActiveRef.current) {
              const start = selectionStart.current
              const world = viewport?.toWorld(e.data.global)
              if (start && world) {
                const rect = buildSelectionRect(start, world)
                const selectedIds = rawEmbeddings
                  .filter((embed: any) => embed.type === 'image' && embed.point)
                  .filter((embed: any) => {
                    const [nx, ny] = embed.point
                    const x = nx * CANVAS_WIDTH
                    const y = ny * CANVAS_HEIGHT
                    return (
                      x >= rect.x &&
                      x <= rect.x + rect.width &&
                      y >= rect.y &&
                      y <= rect.y + rect.height
                    )
                  })
                  .map((embed: any) => String(embed.id))
                setSelectedEmbeddingIds(selectedIds)
              } else {
                setSelectedEmbeddingIds([])
              }
              setSelectedEmbedding(null)
              setSelectionRect(null)
              selectionStart.current = null
              selectionActiveRef.current = false
              viewport?.plugins?.resume?.('drag')
              return
            }

            const world = viewportRef.current?.toWorld(e.data.global)
            const screen = viewportRef.current?.toScreen(e.data.global)
            if (!screen || !world || !dragStart.current) {
              dragStart.current = null
              return
            }

            const dx = screen.x - dragStart.current.x
            const dy = screen.y - dragStart.current.y
            const movedSq = dx * dx + dy * dy
            dragStart.current = null
            if (movedSq > CLICK_EPS) {
              return
            }

            const hit = pointIntersectsParticle(
              world.x,
              world.y,
              particleContainerRefs
            )
            if (hit) {
              setSelectedEmbedding(hit.data.embedding)
              setSelectedEmbeddingIds([String(hit.data.embedding.id)])
            } else {
              setSelectedEmbedding(null)
              setSelectedEmbeddingIds([])
            }
          }}
        >
          {allLoaded && (
          <EmbeddingsLayer
            type="main"
            masterAtlas={masterAtlas}
            atlasMeta={atlasMeta}
            particleContainerRefs={particleContainerRefs}
            visibleBounds={visibleBounds}
          />
          )}
          <SelectionRect selectionRect={selectionRect} />
        </viewport>

        {allLoaded && projectionSettings.type === 'umap' && (
          <Minimap
            allLoaded={allLoaded}
            masterAtlas={masterAtlas}
            atlasMeta={atlasMeta}
            particleContainerRefs={minimapParticleContainerRefs}
            rawEmbeddings={rawMinimapEmbeddings}
            windowSize={windowSize}
            viewportRef={viewportRef}
            projectionType={projectionSettings.type}
          />
        )}
      </Application>
    </>
  )
}
