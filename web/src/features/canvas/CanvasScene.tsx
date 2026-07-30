import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '@pixi/events'
import { Application, extend } from '@pixi/react'
import * as PIXI from 'pixi.js'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  anchorAnalysisCandidateIdsAtom,
  anchorAnalysisStaleAtom,
  anchorAnalysisTrayCollapsedAtom,
  anchorAnalysisTrayHeightAtom,
  anchorAnalysisTrayOpenAtom,
  clusterFocusRequestAtom,
  clusterProfilesResultAtom,
  graphLayoutAtom,
  graphNetworksAtom,
  loadableProjectedEmbeddingsAtom,
  projectionSettingsAtom,
  projectionStabilityOverlayEnabledAtom,
  projectionStabilityResultAtom,
  selectedEmbeddingAtom,
  selectedEmbeddingIdsAtom,
  selectedExplainedClusterAtom,
  selectedStabilityClusterAtom,
  stabilityClusterFocusRequestAtom,
  tagRefreshTriggerAtom,
  viewportFitScaleAtom,
  viewportScaleAtom,
  xaiImageFocusRequestAtom,
} from '@/store'
import { Link } from 'react-router'
import datasetIcon from '@/assets/settings-button.png'
import { state } from './canvasState'
import { Viewport } from './ViewPort'
import Panel from './Panel'
import {
  CANVAS_HEIGHT,
  CANVAS_OFFSET_X,
  CANVAS_OFFSET_Y,
  CANVAS_WIDTH,
  CLICK_EPS,
} from './constants'
import { buildSelectionRect, computeProjectionFit, pointIntersectsParticle } from './utils'
import { useAtlasLoader } from './hooks/useAtlasLoader'
import { EmbeddingsLayer } from './components/EmbeddingsLayer'
import { SelectionRect } from './components/SelectionRect'
import { Minimap } from './components/Minimap'
import { HUD } from './components/HUD'
import { GraphNetworkLayer } from './components/GraphNetworkLayer'
import { AnchorAnalysisOverlay } from './components/AnchorAnalysisOverlay'
import { AnchorAnalysisTray } from './components/AnchorAnalysisTray'
import { NeighborFidelityOverlay } from './components/NeighborFidelityOverlay'
import { HomeLogoLink } from '@/shared/components/HomeLogoLink'
import { useNeighborFidelity } from './hooks/useNeighborFidelity'
import { useConceptLens } from './hooks/useConceptLens'
import { ClusterProfileOverlay } from './components/ClusterProfileOverlay'
import { ConceptAxisOverlay } from './components/ConceptAxisOverlay'
import { ProjectionStabilityOverlay } from './components/ProjectionStabilityOverlay'
import {
  buildClusterRegions,
  clusterAtWorldPoint,
} from './clusterGeometry'

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

type ProjectedEmbedding = {
  id: string | number
  point?: [number, number]
  type: string
  text?: string
  meta?: Record<string, unknown>
}

export const CanvasScene: React.FC<Props> = ({ width = 1920, height = 1200 }) => {
  const dragStart = useRef<PIXI.PointData | null>(null)
  const selectionStart = useRef<PIXI.PointData | null>(null)
  const selectionActiveRef = useRef(false)
  const lastFittedViewTypeRef = useRef<string | null>(null)
  const previousTrayOpenRef = useRef(false)
  const [selectionRect, setSelectionRect] = useState<PIXI.Rectangle | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshUntilRef = useRef(0)

  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const setSelectedEmbeddingIds = useSetAtom(selectedEmbeddingIdsAtom)
  const setViewportScale = useSetAtom(viewportScaleAtom)
  const setViewportFitScale = useSetAtom(viewportFitScaleAtom)
  const setProjectionSettings = useSetAtom(projectionSettingsAtom)
  const setSelectedClusterId = useSetAtom(selectedExplainedClusterAtom)
  const setSelectedStabilityClusterId = useSetAtom(
    selectedStabilityClusterAtom
  )

  const datasetId = useAtomValue(activeDatasetIdAtom)
  const projectionSettings = useAtomValue(projectionSettingsAtom)
  const graphLayout = useAtomValue(graphLayoutAtom)
  const graphNetworks = useAtomValue(graphNetworksAtom)
  const activeGraph = datasetId ? graphNetworks[datasetId] : null
  const tagRefreshTrigger = useAtomValue(tagRefreshTriggerAtom)
  const trayOpen = useAtomValue(anchorAnalysisTrayOpenAtom)
  const trayCollapsed = useAtomValue(anchorAnalysisTrayCollapsedAtom)
  const trayHeight = useAtomValue(anchorAnalysisTrayHeightAtom)
  const analyzedCandidateIds = useAtomValue(anchorAnalysisCandidateIdsAtom)
  const setAnchorAnalysisStale = useSetAtom(anchorAnalysisStaleAtom)
  const clusterProfilesResult = useAtomValue(clusterProfilesResultAtom)
  const clusterFocusRequest = useAtomValue(clusterFocusRequestAtom)
  const stabilityResult = useAtomValue(projectionStabilityResultAtom)
  const stabilityOverlayEnabled = useAtomValue(
    projectionStabilityOverlayEnabledAtom
  )
  const stabilityFocusRequest = useAtomValue(
    stabilityClusterFocusRequestAtom
  )
  const xaiImageFocusRequest = useAtomValue(xaiImageFocusRequestAtom)

  const [showTagRefresh, setShowTagRefresh] = useState(false)

  const viewportRef = useRef<Viewport>(null)
  const [viewportReady, setViewportReady] = useState(false)

  const handleViewportRef = useCallback((viewport: Viewport | null) => {
    viewportRef.current = viewport
    if (viewport) setViewportReady(true)
  }, [])

  const [windowSize, setWindowSize] = useState(() => ({
    width: typeof window === 'undefined' ? width : window.innerWidth,
    height: typeof window === 'undefined' ? height : window.innerHeight,
  }))

  const mainEmbeddingsLoadable = useAtomValue(loadableProjectedEmbeddingsAtom('main'))
  const minimapEmbeddingsLoadable = useAtomValue(
    loadableProjectedEmbeddingsAtom('minimap')
  )
  const fidelityEmbeddings = useMemo(
    () =>
      mainEmbeddingsLoadable.state === 'hasData'
        ? (mainEmbeddingsLoadable.data as ProjectedEmbedding[])
        : [],
    [mainEmbeddingsLoadable]
  )

  const [rawEmbeddings, setRawEmbeddings] = useState<ProjectedEmbedding[]>([])
  const [rawEmbeddingsViewType, setRawEmbeddingsViewType] = useState<
    string | null
  >(null)
  const [rawMinimapEmbeddings, setRawMinimapEmbeddings] = useState<
    ProjectedEmbedding[]
  >([])
  const [visibleBounds, setVisibleBounds] = useState<PIXI.Rectangle | null>(null)
  const candidateIds = useMemo(
    () =>
      rawEmbeddings
        .filter((item) => item.type === 'image')
        .map((item) => Number(item.id))
        .filter((id: number) => Number.isInteger(id)),
    [rawEmbeddings]
  )
  const clusterRegions = useMemo(
    () => buildClusterRegions(clusterProfilesResult, rawEmbeddings),
    [clusterProfilesResult, rawEmbeddings]
  )
  const stabilityRegions = useMemo(
    () => buildClusterRegions(stabilityResult, rawEmbeddings),
    [rawEmbeddings, stabilityResult]
  )
  useNeighborFidelity(
    fidelityEmbeddings,
    projectionSettings.type === 'umap' &&
      mainEmbeddingsLoadable.state === 'hasData'
  )
  useConceptLens(
    fidelityEmbeddings,
    projectionSettings.type === 'umap' &&
      mainEmbeddingsLoadable.state === 'hasData'
  )
  const trayOffset = trayOpen ? (trayCollapsed ? 52 : trayHeight) : 0
  const canvasHeight = Math.max(240, windowSize.height - trayOffset)
  const projectionViewKey =
    projectionSettings.type === 'graph'
      ? [
          projectionSettings.type,
          datasetId,
          activeGraph?.root_image_id,
          activeGraph?.nodes.length,
          activeGraph?.parameters.max_depth,
          activeGraph?.parameters.neighbors_per_node,
          activeGraph?.parameters.max_nodes,
          activeGraph?.parameters.min_similarity,
          graphLayout,
        ].join(':')
      : projectionSettings.type

  useEffect(() => {
    if (projectionSettings.type === 'graph' && !activeGraph) {
      setProjectionSettings((previous) => ({
        ...previous,
        type: 'umap',
      }))
    }
  }, [activeGraph, projectionSettings.type, setProjectionSettings])

  useEffect(() => {
    if (mainEmbeddingsLoadable.state === 'hasData') {
      setRawEmbeddings(mainEmbeddingsLoadable.data as ProjectedEmbedding[])
      setRawEmbeddingsViewType(projectionViewKey)
    }
  }, [mainEmbeddingsLoadable, projectionViewKey])

  useEffect(() => {
    if (minimapEmbeddingsLoadable.state === 'hasData') {
      setRawMinimapEmbeddings(
        minimapEmbeddingsLoadable.data as ProjectedEmbedding[]
      )
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

  const projectionFit = useMemo(
    () => computeProjectionFit(rawEmbeddings),
    [rawEmbeddings]
  )

  const fitProjection = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || !projectionFit) return

    const paddingFactor = 0.08
    viewport.fit(
      false,
      projectionFit.width * (1 + paddingFactor * 2),
      projectionFit.height * (1 + paddingFactor * 2)
    )
    viewport.moveCenter(projectionFit.center)

    const fitScale = viewport.scale?.x ?? 1
    setViewportScale(fitScale)
    setViewportFitScale(fitScale)
  }, [projectionFit, setViewportFitScale, setViewportScale])

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
    state.viewport = viewport
    state.pixiApp?.renderer.resize(windowSize.width, canvasHeight)
    if (typeof (viewport as any).resize === 'function') {
      ;(viewport as any).resize(
        windowSize.width,
        canvasHeight,
        width,
        height
      )
    } else {
      viewport.screenWidth = windowSize.width
      viewport.screenHeight = canvasHeight
    }
  }, [canvasHeight, windowSize.width, width, height])

  useEffect(() => {
    const current = [...candidateIds].sort((a, b) => a - b)
    if (
      analyzedCandidateIds.length > 0 &&
      (current.length !== analyzedCandidateIds.length ||
        current.some((id, index) => id !== analyzedCandidateIds[index]))
    ) {
      setAnchorAnalysisStale(true)
    }
  }, [analyzedCandidateIds, candidateIds, setAnchorAnalysisStale])

  useEffect(() => {
    const trayVisibilityChanged = trayOpen !== previousTrayOpenRef.current
    previousTrayOpenRef.current = trayOpen
    if (!trayVisibilityChanged) return
    const timer = window.setTimeout(() => {
      state.pixiApp?.renderer.resize(windowSize.width, canvasHeight)
      fitProjection()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [canvasHeight, fitProjection, trayOpen, windowSize.width])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    state.viewport = viewport
    return () => {
      if (state.viewport === viewport) {
        state.viewport = null
      }
    }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const updateScale = () => {
      const scale = viewport.scale?.x ?? 1
      setViewportScale(scale)
      setViewportFitScale((prev) => Math.min(prev, scale))
    }
    const updateBounds = () => {
      if (typeof (viewport as any).getVisibleBounds === 'function') {
        const bounds = (viewport as any).getVisibleBounds()
        setVisibleBounds(bounds)
        return
      }
      const topLeft = viewport.toWorld(new PIXI.Point(0, 0))
      const bottomRight = viewport.toWorld(
        new PIXI.Point(viewport.screenWidth, viewport.screenHeight)
      )
      const bounds = new PIXI.Rectangle(
        topLeft.x,
        topLeft.y,
        bottomRight.x - topLeft.x,
        bottomRight.y - topLeft.y
      )
      setVisibleBounds(bounds)
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
  }, [setViewportFitScale, setViewportScale])

  useEffect(() => {
    if (!xaiImageFocusRequest || !viewportReady) return
    const item = rawEmbeddings.find(
      (embedding: any) =>
        embedding.type === 'image' &&
        Number(embedding.id) === xaiImageFocusRequest.imageId
    )
    if (!item?.point || !state.viewport) return
    const position = {
      x: CANVAS_OFFSET_X + item.point[0] * CANVAS_WIDTH,
      y: CANVAS_OFFSET_Y + item.point[1] * CANVAS_HEIGHT,
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      state.viewport.moveCenter(position)
      return
    }
    state.viewport.animate({
      position,
      time: 650,
      ease: 'easeInOutCubic',
      removeOnInterrupt: true,
    })
  }, [rawEmbeddings, viewportReady, xaiImageFocusRequest])

  useEffect(() => {
    if (!clusterFocusRequest || !viewportReady || !state.viewport) return
    const region = clusterRegions.find(
      (candidate) => candidate.clusterId === clusterFocusRequest.clusterId
    )
    if (!region) return
    const xs = region.points.map((point) => point.x)
    const ys = region.points.map((point) => point.y)
    const width = Math.max(120, Math.max(...xs) - Math.min(...xs))
    const height = Math.max(120, Math.max(...ys) - Math.min(...ys))
    state.viewport.fit(false, width * 1.3, height * 1.3)
    state.viewport.moveCenter(region.centroid)
  }, [clusterFocusRequest, clusterRegions, viewportReady])

  useEffect(() => {
    if (!stabilityFocusRequest || !viewportReady || !state.viewport) return
    const region = stabilityRegions.find(
      (candidate) =>
        candidate.clusterId === stabilityFocusRequest.clusterId
    )
    if (!region) return
    const xs = region.points.map((point) => point.x)
    const ys = region.points.map((point) => point.y)
    const width = Math.max(120, Math.max(...xs) - Math.min(...xs))
    const height = Math.max(120, Math.max(...ys) - Math.min(...ys))
    state.viewport.fit(false, width * 1.3, height * 1.3)
    state.viewport.moveCenter(region.centroid)
  }, [stabilityFocusRequest, stabilityRegions, viewportReady])

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
        setViewportFitScale((prev) => Math.min(prev, nextScale))
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
  }, [projectionSettings.type, setViewportFitScale, setViewportScale])

  useEffect(() => {
    if (!viewportReady || !projectionFit) return
    if (rawEmbeddingsViewType !== projectionViewKey) return
    if (lastFittedViewTypeRef.current === projectionViewKey) return
    fitProjection()
    lastFittedViewTypeRef.current = projectionViewKey
  }, [
    fitProjection,
    projectionFit,
    projectionViewKey,
    rawEmbeddingsViewType,
    viewportReady,
  ])

  useEffect(() => {
    const handleHomeKey = (event: KeyboardEvent) => {
      if (event.key !== 'Home' || event.ctrlKey || event.metaKey || event.altKey) {
        return
      }
      const target = event.target as HTMLElement | null
      if (
        target?.isContentEditable ||
        target?.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }
      event.preventDefault()
      fitProjection()
    }

    window.addEventListener('keydown', handleHomeKey)
    return () => window.removeEventListener('keydown', handleHomeKey)
  }, [fitProjection])

  return (
    <>
      <HomeLogoLink />
      {datasetId && (
        <Link
          to={`/dataset/${datasetId}`}
          aria-label="Tillbaka till aktuellt dataset"
          title="Tillbaka till aktuellt dataset"
          data-canvas-ui="true"
          className="absolute top-4 left-18 z-20 block h-12 w-12 overflow-hidden rounded-xl shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <img
            src={datasetIcon}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        </Link>
      )}

      {(!allLoaded || rawEmbeddings.length === 0) && (
        <h1
          style={{
            position: 'absolute',
            top: 44,
            left: 84,
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

      <HUD
        canFitProjection={projectionFit !== null}
        onFitProjection={fitProjection}
        candidateIds={candidateIds}
        bottomOffset={trayOffset}
      />
      <Panel />

      <Application
        width={windowSize.width}
        height={canvasHeight}
        backgroundAlpha={0}
        onInit={(app) => (state.pixiApp = app)}
      >
        <viewport
          ref={handleViewportRef}
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
              const useStabilityRegions =
                stabilityOverlayEnabled && stabilityResult !== null
              const cluster = clusterAtWorldPoint(
                useStabilityRegions ? stabilityRegions : clusterRegions,
                world
              )
              if (cluster) {
                if (useStabilityRegions) {
                  setSelectedStabilityClusterId(cluster.clusterId)
                } else {
                  setSelectedClusterId(cluster.clusterId)
                }
              } else {
                setSelectedEmbedding(null)
                setSelectedEmbeddingIds([])
              }
            }
          }}
        >
          {allLoaded && (
            <>
              {projectionSettings.type === 'graph' && <GraphNetworkLayer />}
              {projectionSettings.type === 'umap' && (
                <ClusterProfileOverlay rawEmbeddings={rawEmbeddings} />
              )}
              {projectionSettings.type === 'umap' && (
                <ProjectionStabilityOverlay
                  rawEmbeddings={rawEmbeddings}
                />
              )}
              {projectionSettings.type === 'umap' && <ConceptAxisOverlay />}
              {projectionSettings.type === 'umap' && (
                <NeighborFidelityOverlay rawEmbeddings={rawEmbeddings} />
              )}
              <EmbeddingsLayer
                type="main"
                masterAtlas={masterAtlas}
                atlasMeta={atlasMeta}
                particleContainerRefs={particleContainerRefs}
                rawEmbeddings={rawEmbeddings}
                visibleBounds={visibleBounds}
              />
              {projectionSettings.type === 'umap' && (
                <AnchorAnalysisOverlay rawEmbeddings={rawEmbeddings} />
              )}
            </>
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
            windowSize={{ ...windowSize, height: canvasHeight }}
            viewportRef={viewportRef}
            projectionType={projectionSettings.type}
          />
        )}
      </Application>
      <AnchorAnalysisTray
        candidateIds={candidateIds}
        rawEmbeddings={rawEmbeddings}
        atlasMeta={atlasMeta}
      />
    </>
  )
}
