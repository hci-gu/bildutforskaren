import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTick } from '@pixi/react'
import * as PIXI from 'pixi.js'
import {
  displaySettingsAtom,
  filterSettingsAtom,
  hoveredTextAtom,
  projectedEmbeddingsAtom,
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
  viewportScaleAtom,
  selectedTagsAtom,
} from '@/store'
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

export const EmbeddingsLayer: React.FC<{
  type: 'main' | 'minimap'
  masterAtlas: Record<number, PIXI.Spritesheet>
  atlasMeta: AtlasMeta
  particleContainerRefs: React.RefObject<PIXI.ParticleContainer | null>[]
  visibleBounds?: PIXI.Rectangle | null
}> = ({ type, masterAtlas, atlasMeta, particleContainerRefs, visibleBounds }) => {
  const searchQuery = useAtomValue(searchQueryAtom)
  const rawEmbeddings = useAtomValue(projectedEmbeddingsAtom(type))
  const displaySettings = useAtomValue(displaySettingsAtom)
  const filterSettings = useAtomValue(filterSettingsAtom)
  const projectionSettings = useAtomValue(projectionSettingsAtom)
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
  const setSelectedTags = useSetAtom(selectedTagsAtom)

  const textEmbeddings = rawEmbeddings.filter((e: any) => e.type === 'text')
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

  const finishSteerDrag = (reason: string) => {
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
        const targetScale = data.targetScale || BASE_SCALE
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
    particleContainerRefs.forEach((ref) => {
      if (!ref.current) return
      for (const particle of ref.current.particleChildren as CustomParticle[]) {
        const embeddingId = particle.data.embedding.id
        const rawEmbedding = rawEmbeddings.find((e: any) => e.id === embeddingId)
        if (!rawEmbedding) continue

        const [nx, ny] = rawEmbedding.point
        const x = nx * CANVAS_WIDTH
        const y = ny * CANVAS_HEIGHT
        particle.data.embedding = rawEmbedding
        particle.data.x = x
        particle.data.y = y

        const isSelected = selectedIdSet.has(String(embeddingId))
        const isSteerActive =
          steerSuggestions && projectionSettings.type === 'umap' && type === 'main'
        const isSteerTagged = isSteerActive && steerTaggedSet.has(String(embeddingId))
        const isSteerSuggested =
          isSteerActive && steerSuggestedSet.has(String(embeddingId))
        if (type === 'minimap') {
          let targetScale = BASE_SCALE * displaySettings.scale * 10
          if (particle.data.embedding.meta.matched) {
            targetScale = BASE_SCALE * displaySettings.scale * 100
          } else if (searchQuery.length) {
            targetScale = BASE_SCALE * displaySettings.scale * 2
          } else {
            targetScale = BASE_SCALE * displaySettings.scale * 5
          }
          particle.data.targetScale = targetScale
          particle.tint = displaySettings.colorPhotographer
            ? colorForMetadata(rawEmbedding.meta)
            : 0xffffff
        } else {
          let targetScale = BASE_SCALE * displaySettings.scale
          if (projectionSettings.type === 'umap') {
            targetScale = BASE_SCALE * displaySettings.scale * 5
          }
          let tint = displaySettings.colorPhotographer
            ? colorForMetadata(rawEmbedding.meta)
            : 0xffffff

          if (searchQuery.length && !particle.data.embedding.meta.matched) {
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

          if (isSelected) {
            targetScale *= 1.6
            tint = 0xffaa33
          }

          particle.data.targetScale = targetScale
          particle.tint = tint
        }
      }
    })
  }, [
    rawEmbeddings,
    searchQuery,
    filterSettings,
    displaySettings,
    projectionSettings,
    selectedIdSet,
    steerSuggestions,
    steerTaggedSet,
    steerSuggestedSet,
    particleContainerRefs,
    type,
  ])

  useEffect(() => {
    rawEmbeddings.forEach((embed: any) => {
      const atlasInfo = (atlasMeta as any)[embed.id]
      if (!atlasInfo) return

      const sheetIndex: number = atlasInfo.sheet
      const container = particleContainerRefs[sheetIndex]?.current
      const texture = masterAtlas[sheetIndex]?.textures[embed.id]
      if (!container || !texture) return

      const [nx, ny] = embed.point
      const x = nx * CANVAS_WIDTH
      const y = ny * CANVAS_HEIGHT
      const isSelected = selectedIdSet.has(String(embed.id))
      const isSteerActive =
        steerSuggestions && projectionSettings.type === 'umap' && type === 'main'
      const isSteerTagged = isSteerActive && steerTaggedSet.has(String(embed.id))
      const isSteerSuggested = isSteerActive && steerSuggestedSet.has(String(embed.id))
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
      } else {
        if (projectionSettings.type === 'umap') {
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
        if (isSelected) {
          targetScale *= 1.6
          tint = 0xffaa33
        }
      }

      const particle = new PIXI.Particle({
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
      }

      container.addParticle(particle)
    })

    return () => {
      particleContainerRefs.forEach((ref) => {
        if (ref.current) {
          ref.current.removeParticles()
          ref.current.particleChildren = []
        }
      })
    }
  }, [
    rawEmbeddings,
    particleContainerRefs,
    masterAtlas,
    atlasMeta,
    displaySettings,
    searchQuery,
    projectionSettings,
    selectedIdSet,
    steerSuggestions,
    steerTaggedSet,
    steerSuggestedSet,
    type,
  ])

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
                if (!target) return
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
                finishSteerDrag('pointerup')
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
        {displayedTextEmbeddings.map((embed: any, index: number) => {
          const [nx, ny] = embed.point ? embed.point : [0, 0]
          const textKey = String(embed.id ?? embed.text ?? index)
          const isSao = projectionSettings.type === 'sao'
          const isTaggedHeaders = projectionSettings.type === 'tagged'
          const saoFontSize = Math.max(
            40,
            Math.min(120, 160 / Math.max(0.6, viewportScale))
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
                  if (isTaggedHeaders) {
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
