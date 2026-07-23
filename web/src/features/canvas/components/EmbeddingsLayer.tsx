import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTick } from '@pixi/react'
import * as PIXI from 'pixi.js'
import {
  activeDatasetIdAtom,
  displaySettingsAtom,
  filterSettingsAtom,
  graphNetworksAtom,
  hoveredTextAtom,
  projectionSettingsAtom,
  searchQueryAtom,
  selectedEmbeddingIdsAtom,
  steerSeedIdsAtom,
  steerSeedCountAtom,
  steerRadiusAtom,
  steerSuggestedIdsAtom,
  steerSuggestedResultsAtom,
  steerSuggestionsAtom,
  steerTaggedIdsAtom,
  steerTargetPointAtom,
  viewportFitScaleAtom,
  viewportScaleAtom,
  recentlyTaggedIdsAtom,
  selectedTagsAtom,
} from '@/store'
import {
  clusterPreviewImageUrl,
  fetchClusterPreviewManifest,
  type ClusterPreview,
  type ClusterPreviewManifest,
} from '@/shared/lib/api'
import {
  BASE_SCALE,
  CANVAS_HEIGHT,
  CANVAS_OFFSET_X,
  CANVAS_OFFSET_Y,
  CANVAS_WIDTH,
  TEXT_BASE_SIZE,
  TEXT_HOVER_SIZE,
  TEXT_LERP,
} from '../constants'
import type { CustomParticle } from '../types'
import { colorForMetadata } from '../utils'
import type { AtlasMeta } from '../hooks/useAtlasLoader'
import { state } from '../canvasState'

const clusterTextureCache = new Map<string, Promise<PIXI.Texture>>()
const CLUSTER_LEVEL_ZOOM_STEP = 2

const textureFromUrl = async (url: string) => {
  const asset = await PIXI.Assets.load(url)
  if (asset instanceof PIXI.Texture) return asset
  if (asset?.texture instanceof PIXI.Texture) return asset.texture
  throw new Error(`Cluster preview did not load as a Pixi texture: ${url}`)
}

const clusterPreviewSize = (cluster: ClusterPreview) => {
  const width = Math.max(0, Number(cluster.bounds.width) || 0) * CANVAS_WIDTH
  const height = Math.max(0, Number(cluster.bounds.height) || 0) * CANVAS_HEIGHT
  return Math.sqrt(Math.max(width * height, 0) * 0.25)
}

const clusterLevel = (cluster: ClusterPreview) =>
  Math.max(1, Math.floor(Number(cluster.level) || 1))

const clusterWorldBounds = (cluster: ClusterPreview) => {
  const minX = Number(cluster.bounds.min_x) * CANVAS_WIDTH
  const minY = Number(cluster.bounds.min_y) * CANVAS_HEIGHT
  return {
    x: minX,
    y: minY,
    width: Math.max(0, Number(cluster.bounds.width) || 0) * CANVAS_WIDTH,
    height: Math.max(0, Number(cluster.bounds.height) || 0) * CANVAS_HEIGHT,
  }
}

const clusterIntersectsBounds = (cluster: ClusterPreview, bounds?: PIXI.Rectangle | null) => {
  if (!bounds) return true
  const clusterBounds = clusterWorldBounds(cluster)
  if (clusterBounds.width === 0 && clusterBounds.height === 0) {
    const [nx, ny] = cluster.centroid
    const x = nx * CANVAS_WIDTH
    const y = ny * CANVAS_HEIGHT
    return (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    )
  }
  return (
    clusterBounds.x <= bounds.x + bounds.width &&
    clusterBounds.x + clusterBounds.width >= bounds.x &&
    clusterBounds.y <= bounds.y + bounds.height &&
    clusterBounds.y + clusterBounds.height >= bounds.y
  )
}

export const EmbeddingsLayer: React.FC<{
  type: 'main' | 'minimap'
  masterAtlas: Record<number, PIXI.Spritesheet>
  atlasMeta: AtlasMeta
  particleContainerRefs: React.RefObject<PIXI.ParticleContainer | null>[]
  rawEmbeddings: any[]
  visibleBounds?: PIXI.Rectangle | null
}> = ({
  type,
  masterAtlas,
  atlasMeta,
  particleContainerRefs,
  rawEmbeddings,
  visibleBounds,
}) => {
  const searchQuery = useAtomValue(searchQueryAtom)
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const displaySettings = useAtomValue(displaySettingsAtom)
  const filterSettings = useAtomValue(filterSettingsAtom)
  const projectionSettings = useAtomValue(projectionSettingsAtom)
  const graphNetworks = useAtomValue(graphNetworksAtom)
  const hoveredText = useAtomValue(hoveredTextAtom)
  const selectedEmbeddingIds = useAtomValue(selectedEmbeddingIdsAtom)
  const steerSuggestions = useAtomValue(steerSuggestionsAtom)
  const steerTaggedIds = useAtomValue(steerTaggedIdsAtom)
  const steerSuggestedIds = useAtomValue(steerSuggestedIdsAtom)
  const steerTargetPoint = useAtomValue(steerTargetPointAtom)
  const steerSeedIds = useAtomValue(steerSeedIdsAtom)
  const steerSeedCount = useAtomValue(steerSeedCountAtom)
  const steerRadius = useAtomValue(steerRadiusAtom)
  const setSteerTargetPoint = useSetAtom(steerTargetPointAtom)
  const setSteerSeedIds = useSetAtom(steerSeedIdsAtom)
  const setSteerSuggestedResults = useSetAtom(steerSuggestedResultsAtom)
  const viewportScale = useAtomValue(viewportScaleAtom)
  const viewportFitScale = useAtomValue(viewportFitScaleAtom)
  const setSelectedTags = useSetAtom(selectedTagsAtom)
  const recentlyTaggedIds = useAtomValue(recentlyTaggedIdsAtom)
  const graphRootId =
    datasetId && projectionSettings.type === 'graph'
      ? graphNetworks[datasetId]?.root_image_id
      : null

  const textEmbeddings = rawEmbeddings.filter((e: any) => e.type === 'text')
  const usesDefaultClusterProjection =
    projectionSettings.type === 'umap' &&
    Number(projectionSettings.nNeighbors) === 15 &&
    Number(projectionSettings.minDist) === 0.1 &&
    Number(projectionSettings.spread) === 1 &&
    Number(projectionSettings.seed) === 1 &&
    !filterSettings.year &&
    !filterSettings.photographer
  const [clusterManifest, setClusterManifest] =
    useState<ClusterPreviewManifest | null>(null)
  const bakedClusters = useMemo(
    () => clusterManifest?.clusters.filter((cluster) => cluster.has_image) ?? [],
    [clusterManifest]
  )
  const maxClusterLevel = useMemo(
    () => Math.max(1, ...bakedClusters.map((cluster) => clusterLevel(cluster))),
    [bakedClusters]
  )
  const activeClusterLevel = useMemo(() => {
    if (maxClusterLevel <= 1 || bakedClusters.length === 0) return 1
    const zoomSpanRatio = Math.max(
      1,
      viewportScale / Math.max(1e-6, viewportFitScale)
    )
    return Math.min(
      maxClusterLevel,
      Math.max(1, 1 + Math.floor(Math.log(zoomSpanRatio) / Math.log(CLUSTER_LEVEL_ZOOM_STEP)))
    )
  }, [
    bakedClusters,
    maxClusterLevel,
    viewportFitScale,
    viewportScale,
  ])
  const visibleClusterPreviews = useMemo(
    () =>
      bakedClusters.filter((cluster) => {
        if (clusterLevel(cluster) !== activeClusterLevel) return false
        return (
          clusterIntersectsBounds(cluster, visibleBounds)
        )
      }),
    [activeClusterLevel, bakedClusters, visibleBounds]
  )
  const preloadClusterPreviews = useMemo(
    () =>
      bakedClusters.filter((cluster) => {
        const level = clusterLevel(cluster)
        return (
          level >= activeClusterLevel &&
          level <= Math.min(maxClusterLevel, activeClusterLevel + 1) &&
          clusterIntersectsBounds(cluster, visibleBounds)
        )
      }),
    [activeClusterLevel, bakedClusters, maxClusterLevel, visibleBounds]
  )
  const showClusterImages = displaySettings.showClusterImages !== false
  const [clusterTextures, setClusterTextures] = useState<Map<string, PIXI.Texture>>(
    () => new Map()
  )
  const shouldCullSao = projectionSettings.type === 'sao' && !projectionSettings.saoOnlyDataset
  const displayedTextEmbeddings =
    shouldCullSao && visibleBounds
      ? textEmbeddings.filter((embed: any) => {
          const [nx, ny] = embed.point ? embed.point : [0, 0]
          const x = nx * CANVAS_WIDTH + CANVAS_OFFSET_X
          const y = ny * CANVAS_HEIGHT + CANVAS_OFFSET_Y
          const margin = 300
          return (
            x >= visibleBounds.x - margin &&
            x <= visibleBounds.x + visibleBounds.width + margin &&
            y >= visibleBounds.y - margin &&
            y <= visibleBounds.y + visibleBounds.height + margin
          )
        })
      : textEmbeddings
  const textRefs = useRef(new Map<string, PIXI.Text>())
  const textSizes = useRef(
    new Map<string, { current: number; target: number }>()
  )
  const particlesByIdRef = useRef(new Map<number, CustomParticle>())
  const rawEmbeddingsById = useMemo(() => {
    const map = new Map<number, any>()
    rawEmbeddings.forEach((embed: any) => {
      const id = Number(embed.id)
      if (!Number.isNaN(id)) {
        map.set(id, embed)
      }
    })
    return map
  }, [rawEmbeddings])
  const selectedIdSet = useMemo(
    () => new Set(selectedEmbeddingIds.map((id) => String(id))),
    [selectedEmbeddingIds]
  )
  const steerTaggedSet = useMemo(
    () => new Set(steerTaggedIds.map((id) => String(id))),
    [steerTaggedIds]
  )
  const steerSuggestedSet = useMemo(
    () => new Set(steerSuggestedIds.map((id) => String(id))),
    [steerSuggestedIds]
  )
  const steerTaggedCentroid = useMemo(() => {
    if (!steerSuggestions || projectionSettings.type !== 'umap') return null
    const points = rawEmbeddings
      .filter((embed: any) => embed.type === 'image')
      .filter((embed: any) => steerTaggedSet.has(String(embed.id)))
      .map((embed: any) => embed.point)
      .filter((point: any) => Array.isArray(point) && point.length >= 2)
    if (points.length === 0) return null
    const sum = points.reduce(
      (acc: { x: number; y: number }, point: [number, number]) => {
        return {
          x: acc.x + point[0],
          y: acc.y + point[1],
        }
      },
      { x: 0, y: 0 }
    )
    return {
      x: sum.x / points.length,
      y: sum.y / points.length,
    }
  }, [projectionSettings.type, rawEmbeddings, steerSuggestions, steerTaggedSet])

  useEffect(() => {
    if (type !== 'main' || !usesDefaultClusterProjection || !datasetId) {
      setClusterManifest(null)
      return
    }

    let cancelled = false
    fetchClusterPreviewManifest(datasetId)
      .then((manifest) => {
        if (!cancelled) setClusterManifest(manifest)
      })
      .catch(() => {
        if (!cancelled) setClusterManifest(null)
      })

    return () => {
      cancelled = true
    }
  }, [datasetId, type, usesDefaultClusterProjection])

  useEffect(() => {
    if (
      type !== 'main' ||
      !usesDefaultClusterProjection ||
      !datasetId ||
      !showClusterImages
    ) {
      setClusterTextures(new Map())
      return
    }

    let cancelled = false
    const loadClusterTextures = async () => {
      for (const cluster of preloadClusterPreviews) {
        if (cancelled) break
        const key = `${datasetId}:${cluster.id}`
        if (!clusterTextureCache.has(key)) {
          const url = clusterPreviewImageUrl(datasetId, cluster.id)
          clusterTextureCache.set(
            key,
            textureFromUrl(url)
          )
        }

        try {
          const texture = await clusterTextureCache.get(key)
          if (!texture || cancelled) return
          setClusterTextures((prev) => {
            if (prev.get(cluster.id) === texture) return prev
            const next = new Map(prev)
            next.set(cluster.id, texture)
            return next
          })
        } catch (error) {
          clusterTextureCache.delete(key)
          console.error('Failed to generate cluster preview:', error)
        }
      }
    }

    loadClusterTextures()
    return () => {
      cancelled = true
    }
  }, [
    datasetId,
    showClusterImages,
    type,
    usesDefaultClusterProjection,
    preloadClusterPreviews,
  ])

  const steerDisplayPoint = steerTargetPoint ?? steerTaggedCentroid
  const steerDragActiveRef = useRef(false)
  const steerDragMovedRef = useRef(false)
  const steerLastPointRef = useRef<{ x: number; y: number } | null>(null)
  const steerDragTargetRef = useRef<PIXI.Graphics | null>(null)
  const [isSteerDragging, setIsSteerDragging] = useState(false)

  const computeNearestSeedIds = (point: { x: number; y: number }) => {
    const radiusSq =
      typeof steerRadius === 'number' && steerRadius > 0
        ? steerRadius * steerRadius
        : null
    const candidates = rawEmbeddings
      .filter((embed: any) => embed.type === 'image' && embed.point)
      .map((embed: any) => {
        const dx = embed.point[0] - point.x
        const dy = embed.point[1] - point.y
        const dist = dx * dx + dy * dy
        return { id: Number(embed.id), dist }
      })
      .filter((candidate) => (radiusSq ? candidate.dist <= radiusSq : true))
    candidates.sort((a, b) => a.dist - b.dist)
    return candidates.slice(0, Math.max(1, steerSeedCount)).map((item) => item.id)
  }

  const seedIdsEqual = (a: number[], b: number[]) =>
    a.length === b.length && a.every((value, index) => value === b[index])

  const computeParticleVisuals = useCallback((
    embed: any,
    isSelected: boolean,
    isSteerActive: boolean,
    isSteerTagged: boolean,
    isSteerSuggested: boolean
  ) => {
    let targetScale = BASE_SCALE * displaySettings.scale
    let tint = displaySettings.colorPhotographer
      ? colorForMetadata(embed.meta)
      : 0xffffff

    if (type === 'minimap') {
      if (embed.meta.matched) {
        targetScale = BASE_SCALE * displaySettings.scale * 100
      } else if (searchQuery.length) {
        targetScale = BASE_SCALE * displaySettings.scale * 2
      } else {
        targetScale = BASE_SCALE * displaySettings.scale * 5
      }
      return { targetScale, tint }
    }

    if (
      projectionSettings.type === 'umap' ||
      projectionSettings.type === 'graph'
    ) {
      targetScale = BASE_SCALE * displaySettings.scale * 5
    }
    if (searchQuery.length && !embed.meta.matched) {
      targetScale = BASE_SCALE * 0.1
    }
    if (!isSelected) {
      if (isSteerSuggested) {
        tint = 0xf5d547
      } else if (isSteerTagged) {
        tint = 0x37d67a
      }
    }
    if (isSteerActive && !isSteerTagged && !isSteerSuggested && !isSelected) {
      targetScale *= 0.5
    }
    if (projectionSettings.type === 'graph' && Number(embed.id) === graphRootId) {
      targetScale *= 1.8
      tint = 0xffaa33
    } else if (isSelected) {
      targetScale *= 1.6
      tint = 0xffaa33
    }

    return { targetScale, tint }
  }, [
    displaySettings,
    graphRootId,
    projectionSettings.type,
    searchQuery,
    type,
  ])

  useEffect(() => {
    if (!steerSuggestions || projectionSettings.type !== 'umap') return
    if (isSteerDragging) return
    if (!steerTargetPoint) return
    const nextSeedIds = computeNearestSeedIds(steerTargetPoint)
    if (!seedIdsEqual(nextSeedIds, steerSeedIds)) {
      setSteerSeedIds(nextSeedIds)
    }
  }, [
    isSteerDragging,
    projectionSettings.type,
    setSteerSeedIds,
    steerRadius,
    steerSeedCount,
    steerSeedIds,
    steerSuggestions,
    steerTargetPoint,
  ])

  const finishSteerDrag = () => {
    if (!steerDragActiveRef.current) return
    steerDragActiveRef.current = false
    setIsSteerDragging(false)
    const viewport = state.viewport
    if (viewport && viewport.plugins?.resume) {
      viewport.plugins.resume('drag')
    }
    const app = state.pixiApp
    if (app) {
      app.stage.off('pointermove')
      app.stage.off('pointerup')
      app.stage.off('pointerupoutside')
    }
    if (!steerDragMovedRef.current) return
    steerDragMovedRef.current = false
    const finalPoint = steerLastPointRef.current
    if (!finalPoint) return
    const seedIds = computeNearestSeedIds(finalPoint)
    setSteerSeedIds(seedIds)
  }


  useEffect(() => {
    if (!steerSuggestions || projectionSettings.type !== 'umap') return
    if (!steerTargetPoint && steerTaggedCentroid) {
      setSteerTargetPoint(steerTaggedCentroid)
      setSteerSeedIds([])
      setSteerSuggestedResults(null)
    }
  }, [
    projectionSettings.type,
    setSteerSeedIds,
    setSteerSuggestedResults,
    setSteerTargetPoint,
    steerSuggestions,
    steerTaggedCentroid,
    steerTargetPoint,
  ])

  useEffect(() => {
    return () => {
    }
  }, [])

  useEffect(() => {
    if (!steerSuggestions || projectionSettings.type !== 'umap') return
    if (!steerTargetPoint) return
    if (isSteerDragging) return
    if (steerSeedIds.length > 0) return
    const seedIds = computeNearestSeedIds(steerTargetPoint)
    setSteerSeedIds(seedIds)
  }, [
    isSteerDragging,
    projectionSettings.type,
    setSteerSeedIds,
    steerSeedIds.length,
    steerSuggestions,
    steerTargetPoint,
  ])

  useTick(() => {
    const now = Date.now()
    particleContainerRefs.forEach((ref) => {
      if (!ref.current) return
      for (const particle of ref.current.particleChildren as CustomParticle[]) {
        const data = particle.data
        if (!data) continue
        const dx = data.x - particle.x
        const dy = data.y - particle.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const lerp = 0.1
        if (dist > 0.1) {
          particle.x += dx * lerp
          particle.y += dy * lerp
        }
        let targetScale = data.targetScale || BASE_SCALE
        if (data.flashUntil && data.flashUntil > now) {
          const remaining = data.flashUntil - now
          const progress = 1 - Math.min(1, remaining / 600)
          const pulse = 1 + 0.25 * Math.sin(progress * Math.PI)
          targetScale *= pulse
          particle.alpha = 0.95
        } else {
          data.flashUntil = null
          particle.alpha = 1
        }
        const ds = targetScale - particle.scaleX
        if (Math.abs(ds) > 0.01) {
          particle.scaleX += ds * lerp
          particle.scaleY += ds * lerp
        }
      }
      ref.current.update()
    })

    if (projectionSettings.type !== 'sao' && projectionSettings.type !== 'tagged') {
      textSizes.current.forEach((state, key) => {
        const node = textRefs.current.get(key)
        if (!node) return
        const next = state.current + (state.target - state.current) * TEXT_LERP
        state.current = Math.abs(state.target - next) < 0.05 ? state.target : next
        node.style.fontSize = state.current
      })
    }
  })

  useEffect(() => {
    if (projectionSettings.type === 'sao' || projectionSettings.type === 'tagged') return
    displayedTextEmbeddings.forEach((embed: any, index: number) => {
      const textKey = String(embed.id ?? embed.text ?? index)
      const state = textSizes.current.get(textKey) || {
        current: TEXT_BASE_SIZE,
        target: TEXT_BASE_SIZE,
      }
      if (hoveredText && embed.text === hoveredText) {
        state.target = TEXT_HOVER_SIZE
      } else if (!hoveredText) {
        state.target = TEXT_BASE_SIZE
      }
      textSizes.current.set(textKey, state)
    })
  }, [hoveredText, displayedTextEmbeddings])

  useEffect(() => {
    const byId = particlesByIdRef.current
    const activeIds = new Set<number>()

    rawEmbeddings.forEach((embed: any) => {
      const id = Number(embed.id)
      if (Number.isNaN(id)) return

      const atlasInfo = (atlasMeta as any)[embed.id]
      if (!atlasInfo) return

      const sheetIndex: number = atlasInfo.sheet
      const container = particleContainerRefs[sheetIndex]?.current
      const texture = masterAtlas[sheetIndex]?.textures[embed.id]
      if (!container || !texture) return

      activeIds.add(id)

      let particle = byId.get(id)
      const [nx, ny] = embed.point
      const x = nx * CANVAS_WIDTH
      const y = ny * CANVAS_HEIGHT

      if (!particle) {
        const isSelected = selectedIdSet.has(String(id))
        const isSteerActive =
          steerSuggestions && projectionSettings.type === 'umap' && type === 'main'
        const isSteerTagged = isSteerActive && steerTaggedSet.has(String(id))
        const isSteerSuggested =
          isSteerActive && steerSuggestedSet.has(String(id))
        const { targetScale, tint } = computeParticleVisuals(
          embed,
          isSelected,
          isSteerActive,
          isSteerTagged,
          isSteerSuggested
        )

        particle = new PIXI.Particle({
          texture,
          x,
          y,
          scaleX: targetScale,
          scaleY: targetScale,
          anchorX: 0.5,
          anchorY: 0.5,
          tint,
        }) as CustomParticle

        particle.data = {
          embedding: embed,
          x,
          y,
          originalX: x,
          originalY: y,
          targetScale,
          flashUntil: null,
        }

        container.addParticle(particle)
        byId.set(id, particle)
      } else {
        particle.data.embedding = embed
        particle.data.x = x
        particle.data.y = y
      }
    })

    for (const [id, particle] of byId) {
      if (!activeIds.has(id)) {
        particleContainerRefs.forEach((ref) => {
          const container = ref.current
          if (container?.particleChildren.includes(particle)) {
            container.removeParticle(particle)
          }
        })
        byId.delete(id)
      }
    }
  }, [
    rawEmbeddings,
    particleContainerRefs,
    masterAtlas,
    atlasMeta,
    computeParticleVisuals,
    projectionSettings.type,
    selectedIdSet,
    steerSuggestions,
    steerTaggedSet,
    steerSuggestedSet,
    type,
  ])

  useEffect(() => {
    const byId = particlesByIdRef.current
    const isSteerActive =
      steerSuggestions && projectionSettings.type === 'umap' && type === 'main'
    for (const [id, particle] of byId) {
      const embed = rawEmbeddingsById.get(id)
      if (!embed) continue
      particle.data.embedding = embed
      const isSelected = selectedIdSet.has(String(id))
      const isSteerTagged = isSteerActive && steerTaggedSet.has(String(id))
      const isSteerSuggested = isSteerActive && steerSuggestedSet.has(String(id))
      const { targetScale, tint } = computeParticleVisuals(
        embed,
        isSelected,
        isSteerActive,
        isSteerTagged,
        isSteerSuggested
      )
      particle.data.targetScale = targetScale
      particle.tint = tint
    }
  }, [
    computeParticleVisuals,
    rawEmbeddingsById,
    searchQuery,
    filterSettings,
    displaySettings,
    projectionSettings,
    selectedIdSet,
    steerSuggestions,
    steerTaggedSet,
    steerSuggestedSet,
    type,
  ])

  useEffect(() => {
    if (recentlyTaggedIds.length === 0) return
    const byId = particlesByIdRef.current
    const now = Date.now()
    recentlyTaggedIds.forEach((id) => {
      const particle = byId.get(Number(id))
      if (particle?.data) {
        particle.data.flashUntil = now + 600
      }
    })
  }, [recentlyTaggedIds])

  useEffect(() => {
    const particlesById = particlesByIdRef.current
    return () => {
      particlesById.clear()
      particleContainerRefs.forEach((ref) => {
        if (ref.current) {
          ref.current.removeParticles()
          ref.current.particleChildren = []
        }
      })
    }
  }, [particleContainerRefs])

  return (
    <>
      {particleContainerRefs.map((ref, i) => (
        <pixiParticleContainer
          key={`pc_${i}`}
          ref={ref}
          position={{ x: CANVAS_OFFSET_X, y: CANVAS_OFFSET_Y }}
          dynamicProperties={{
            position: true,
            scale: true,
            rotation: false,
            alpha: false,
          }}
        />
      ))}

      <pixiContainer position={{ x: CANVAS_OFFSET_X, y: CANVAS_OFFSET_Y }}>
        {type === 'main' && steerSuggestions && steerDisplayPoint && (
          <pixiGraphics
            draw={(g) => {
              g.clear()
              const radius = 48
              g.circle(0, 0, radius)
              g.fill({ color: 0x37d67a, alpha: 0.12 })
              g.stroke({ color: 0x37d67a, width: 5, alpha: 0.95 })
              g.circle(0, 0, 10)
              g.fill({ color: 0x37d67a, alpha: 0.95 })
            }}
            x={steerDisplayPoint.x * CANVAS_WIDTH}
            y={steerDisplayPoint.y * CANVAS_HEIGHT}
            eventMode="static"
            cursor="grab"
            onPointerDown={(e: any) => {
              if (!steerSuggestions) return
              if (steerDragActiveRef.current) return
              steerDragActiveRef.current = true
              setIsSteerDragging(true)
              if (typeof e?.stopPropagation === 'function') e.stopPropagation()
              if (typeof e?.data?.originalEvent?.preventDefault === 'function') {
                e.data.originalEvent.preventDefault()
              }
              steerDragMovedRef.current = false
              const viewport = state.viewport
              if (viewport && viewport.plugins?.pause) {
                viewport.plugins.pause('drag')
              }
              setSteerSeedIds([])
              setSteerSuggestedResults(null)

              const app = state.pixiApp
              if (!app) return
              app.stage.eventMode = 'static'
              app.stage.hitArea = app.screen

              const handleMove = (event: any) => {
                const target = steerDragTargetRef.current
                if (!target?.parent) return
                target.parent.toLocal(event.global, undefined, target.position)
                const nextPoint = {
                  x: target.position.x / CANVAS_WIDTH,
                  y: target.position.y / CANVAS_HEIGHT,
                }
                steerDragMovedRef.current = true
                steerLastPointRef.current = nextPoint
                setSteerTargetPoint(nextPoint)
              }

              const handleUp = () => {
                finishSteerDrag()
              }

              app.stage.on('pointermove', handleMove)
              app.stage.on('pointerup', handleUp)
              app.stage.on('pointerupoutside', handleUp)
            }}
            ref={(node) => {
              steerDragTargetRef.current = node
            }}
          />
        )}
        {type === 'main' &&
          usesDefaultClusterProjection &&
          showClusterImages &&
          visibleClusterPreviews.map((cluster) => {
            const texture = clusterTextures.get(cluster.id)
            const [nx, ny] = cluster.centroid
            const x = nx * CANVAS_WIDTH
            const y = ny * CANVAS_HEIGHT
            const size = clusterPreviewSize(cluster) * displaySettings.scale
            if (!texture) {
              return null
            }
            return (
              <pixiContainer key={`cluster_image_${cluster.id}`} x={x} y={y}>
                <pixiSprite
                  texture={texture}
                  anchor={0.5}
                  width={size}
                  height={size}
                  eventMode="none"
                />
              </pixiContainer>
            )
          })}
        {displayedTextEmbeddings.map((embed: any, index: number) => {
          const [nx, ny] = embed.point ? embed.point : [0, 0]
          const textKey = String(embed.id ?? embed.text ?? index)
          const isSao = projectionSettings.type === 'sao'
          const isTaggedHeaders = projectionSettings.type === 'tagged'
          const saoFontSize = Math.max(
            1.5,
            Math.min(18, 16 / Math.max(0.2, viewportScale))
          )
          const taggedFontSize = 8
          return (
            <pixiText
              key={textKey}
              text={embed.text}
              x={nx * CANVAS_WIDTH}
              y={ny * CANVAS_HEIGHT - (isTaggedHeaders ? 0 : 12)}
              rotation={projectionSettings.type === 'year' ? -Math.PI / 4 : 0}
              anchor={isTaggedHeaders ? 0 : 0.5}
              eventMode={isSao || isTaggedHeaders ? 'static' : 'static'}
              cursor={isSao || isTaggedHeaders ? 'pointer' : 'pointer'}
              onPointerDown={(e: any) => {
                if (!isSao && !isTaggedHeaders) return
                if (typeof embed.text === 'string' && embed.text.trim()) {
                  const label = embed.text.trim()
                  const isShift = !!e?.data?.originalEvent?.shiftKey
                  setSelectedTags((prev) => {
                    if (!isShift) return [label]
                    const exists = prev.includes(label)
                    if (exists) return prev.filter((t) => t !== label)
                    return [...prev, label]
                  })
                  if (typeof e?.stopPropagation === 'function') {
                    e.stopPropagation()
                  }
                }
              }}
              onPointerOver={() => {
                if (isSao || isTaggedHeaders) return
                const state = textSizes.current.get(textKey) || {
                  current: TEXT_BASE_SIZE,
                  target: TEXT_BASE_SIZE,
                }
                state.target = TEXT_HOVER_SIZE
                textSizes.current.set(textKey, state)
              }}
              onPointerOut={() => {
                if (isSao || isTaggedHeaders) return
                const state = textSizes.current.get(textKey) || {
                  current: TEXT_BASE_SIZE,
                  target: TEXT_BASE_SIZE,
                }
                state.target = TEXT_BASE_SIZE
                textSizes.current.set(textKey, state)
              }}
              ref={(node) => {
                if (node) {
                  textRefs.current.set(textKey, node)
                  if (!textSizes.current.has(textKey)) {
                    textSizes.current.set(textKey, {
                      current: isTaggedHeaders ? taggedFontSize : TEXT_BASE_SIZE,
                      target: isTaggedHeaders ? taggedFontSize : TEXT_BASE_SIZE,
                    })
                  }
                  node.style.fontSize = isSao
                    ? saoFontSize
                    : isTaggedHeaders
                      ? taggedFontSize
                      : textSizes.current.get(textKey)?.current ?? TEXT_BASE_SIZE
                  if (isSao) {
                    node.resolution = Math.min(
                      6,
                      Math.max(2, viewportScale * 2)
                    )
                  } else if (isTaggedHeaders) {
                    node.resolution = 2
                  }
                } else {
                  textRefs.current.delete(textKey)
                  textSizes.current.delete(textKey)
                }
              }}
              style={{
                fontSize: isSao
                  ? saoFontSize
                  : isTaggedHeaders
                    ? taggedFontSize
                    : TEXT_BASE_SIZE,
                fill: embed.meta.matched ? 0xff5555 : 0xffffff,
                align: 'center',
              }}
            />
          )
        })}
      </pixiContainer>
    </>
  )
}
