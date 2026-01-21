import React, { useEffect, useMemo, useRef } from 'react'
import { useAtomValue } from 'jotai'
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
} from '@/state'
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

export const EmbeddingsLayer: React.FC<{
  type: 'main' | 'minimap'
  masterAtlas: Record<number, PIXI.Spritesheet>
  atlasMeta: AtlasMeta
  particleContainerRefs: React.RefObject<PIXI.ParticleContainer | null>[]
}> = ({ type, masterAtlas, atlasMeta, particleContainerRefs }) => {
  const searchQuery = useAtomValue(searchQueryAtom)
  const rawEmbeddings = useAtomValue(projectedEmbeddingsAtom(type))
  const displaySettings = useAtomValue(displaySettingsAtom)
  const filterSettings = useAtomValue(filterSettingsAtom)
  const projectionSettings = useAtomValue(projectionSettingsAtom)
  const hoveredText = useAtomValue(hoveredTextAtom)
  const selectedEmbeddingIds = useAtomValue(selectedEmbeddingIdsAtom)

  const textEmbeddings = rawEmbeddings.filter((e: any) => e.type === 'text')
  const textRefs = useRef(new Map<string, PIXI.Text>())
  const textSizes = useRef(
    new Map<string, { current: number; target: number }>()
  )
  const selectedIdSet = useMemo(
    () => new Set(selectedEmbeddingIds.map((id) => String(id))),
    [selectedEmbeddingIds]
  )

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

    textSizes.current.forEach((state, key) => {
      const node = textRefs.current.get(key)
      if (!node) return
      const next = state.current + (state.target - state.current) * TEXT_LERP
      state.current = Math.abs(state.target - next) < 0.05 ? state.target : next
      node.style.fontSize = state.current
    })
  })

  useEffect(() => {
    textEmbeddings.forEach((embed: any, index: number) => {
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
  }, [hoveredText, textEmbeddings])

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
        {textEmbeddings.map((embed: any, index: number) => {
          const [nx, ny] = embed.point ? embed.point : [0, 0]
          const textKey = String(embed.id ?? embed.text ?? index)
          return (
            <pixiText
              key={textKey}
              text={embed.text}
              x={nx * CANVAS_WIDTH}
              y={ny * CANVAS_HEIGHT - 12}
              rotation={projectionSettings.type === 'year' ? -Math.PI / 4 : 0}
              anchor={0.5}
              eventMode="static"
              cursor="pointer"
              onPointerOver={() => {
                const state = textSizes.current.get(textKey) || {
                  current: TEXT_BASE_SIZE,
                  target: TEXT_BASE_SIZE,
                }
                state.target = TEXT_HOVER_SIZE
                textSizes.current.set(textKey, state)
              }}
              onPointerOut={() => {
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
                      current: TEXT_BASE_SIZE,
                      target: TEXT_BASE_SIZE,
                    })
                  }
                  node.style.fontSize =
                    textSizes.current.get(textKey)?.current ?? TEXT_BASE_SIZE
                } else {
                  textRefs.current.delete(textKey)
                  textSizes.current.delete(textKey)
                }
              }}
              style={{
                fontSize: TEXT_BASE_SIZE,
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
