import React, { useEffect, useMemo, useRef, useState } from 'react'
import '@pixi/events'
import { Application, extend, useTick } from '@pixi/react'
import * as PIXI from 'pixi.js'
import atlasMeta from '@/assets/atlas.json'
import atlas0 from '@/assets/atlas_0.png'
import atlas1 from '@/assets/atlas_1.png'
import atlas2 from '@/assets/atlas_2.png'
import atlas3 from '@/assets/atlas_3.png'
import atlas4 from '@/assets/atlas_4.png'
import atlas5 from '@/assets/atlas_5.png'
import atlas6 from '@/assets/atlas_6.png'
import atlas7 from '@/assets/atlas_7.png'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  API_URL,
  displaySettingsAtom,
  filterSettingsAtom,
  projectedEmbeddingsAtom,
  projectionSettingsAtom,
  searchQueryAtom,
  selectedEmbeddingAtom,
} from '@/state'
import { PhotoView } from 'react-photo-view'
import { state } from './canvasState'
import { Viewport } from './ViewPort'
import Panel from './Panel'

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
  nodeSize?: number
}

type CustomParticle = PIXI.Particle & {
  data?: any
}

const CANVAS_WIDTH = 1920
const CANVAS_HEIGHT = 1200
const CANVAS_OFFSET_X = 0
const CANVAS_OFFSET_Y = 0
const BASE_SCALE = 0.075
const NUM_ATLASES = 8
const CLICK_EPS = 8

const colorForMetadata = (metadata: any) => {
  switch (metadata.photographer) {
    case '1':
      return 0x5555ff
    case '2':
      return 0x55ff55
    case '3':
      return 0xffff55
    case '4':
      return 0xff55ff
    default:
      return 0xffffff
  }
}

///////////////////////////////////////////////////////////////////////////////
// Embeddings layer – now uses one ParticleContainer per atlas image
///////////////////////////////////////////////////////////////////////////////
const Embeddings: React.FC<{
  type: 'main' | 'minimap'
  masterAtlas: { [key: string]: PIXI.Spritesheet }
  particleContainerRefs: React.RefObject<PIXI.ParticleContainer | null>[]
}> = ({ type, masterAtlas, particleContainerRefs }) => {
  const searchQuery = useAtomValue(searchQueryAtom)
  const rawEmbeddings = useAtomValue(projectedEmbeddingsAtom(type))
  const displaySettings = useAtomValue(displaySettingsAtom)
  const filterSettings = useAtomValue(filterSettingsAtom)
  const projectionSettings = useAtomValue(projectionSettingsAtom)
  const textEmbeddings = rawEmbeddings.filter((e: any) => e.type === 'text')

  // ────────────────────────────────────────────────────────────────────────────
  // Animate particles every frame
  // ────────────────────────────────────────────────────────────────────────────
  useTick(() => {
    particleContainerRefs.forEach((ref) => {
      if (!ref.current) return
      for (const particle of ref.current.particleChildren as CustomParticle[]) {
        const data = particle.data
        if (!data) continue
        // Lerp position
        const dx = data.x - particle.x
        const dy = data.y - particle.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const lerp = 0.1
        if (dist > 0.1) {
          particle.x += dx * lerp
          particle.y += dy * lerp
        }
        // Lerp scale
        const targetScale = data.targetScale || BASE_SCALE
        const ds = targetScale - particle.scaleX
        if (Math.abs(ds) > 0.01) {
          particle.scaleX += ds * lerp
          particle.scaleY += ds * lerp
        }
      }
      ref.current.update()
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Sync particle data when atoms change (positions / colours / scales)
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    particleContainerRefs.forEach((ref) => {
      if (!ref.current) return
      for (const particle of ref.current.particleChildren as CustomParticle[]) {
        const embeddingId = particle.data.embedding.id
        const rawEmbedding = rawEmbeddings.find(
          (e: any) => e.id === embeddingId
        )
        if (!rawEmbedding) continue

        const [nx, ny] = rawEmbedding.point
        const x = nx * CANVAS_WIDTH
        const y = ny * CANVAS_HEIGHT
        particle.data.embedding = rawEmbedding
        particle.data.x = x
        particle.data.y = y
        if (type === 'minimap') {
          if (particle.data.embedding.meta.matched) {
            particle.data.targetScale = BASE_SCALE * displaySettings.scale * 100
          } else if (searchQuery.length) {
            particle.data.targetScale = BASE_SCALE * displaySettings.scale * 2
          } else {
            particle.data.targetScale = BASE_SCALE * displaySettings.scale * 5
          }
          particle.tint = displaySettings.colorPhotographer
            ? colorForMetadata(rawEmbedding.meta)
            : 0xffffff
        } else {
          if (projectionSettings.type === 'umap') {
            particle.data.targetScale = BASE_SCALE * displaySettings.scale * 5
          } else {
            particle.data.targetScale = BASE_SCALE * displaySettings.scale
          }
          if (
            projectionSettings.type !== 'grid' &&
            particle.data.embedding.meta.matched
          ) {
            // golden tint
            particle.tint = 0x00d7ff
          } else {
            particle.tint = displaySettings.colorPhotographer
              ? colorForMetadata(rawEmbedding.meta)
              : 0xffffff
          }
        }
      }
    })
  }, [
    rawEmbeddings,
    searchQuery,
    filterSettings,
    displaySettings,
    projectionSettings,
    particleContainerRefs,
  ])

  // ────────────────────────────────────────────────────────────────────────────
  // (Re-)create all particles whenever projection/filter set changes
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    rawEmbeddings.forEach((embed: any) => {
      const atlasInfo = (atlasMeta as any)[embed.id]
      if (!atlasInfo) return
      const sheetIndex: number = atlasInfo.sheet
      const container = particleContainerRefs[sheetIndex].current
      const texture = masterAtlas[sheetIndex]?.textures[embed.id]
      if (!container || !texture) return

      const [nx, ny] = embed.point
      const x = nx * CANVAS_WIDTH
      const y = ny * CANVAS_HEIGHT
      let scale = BASE_SCALE * displaySettings.scale
      if (type === 'minimap') {
        scale = BASE_SCALE * displaySettings.scale * 10
      }

      const particle = new PIXI.Particle({
        texture,
        x,
        y,
        scaleX: scale,
        scaleY: scale,
        anchorX: 0.5,
        anchorY: 0.5,
        tint: displaySettings.colorPhotographer
          ? colorForMetadata(embed.meta)
          : 0xffffff,
      }) as CustomParticle

      particle.data = {
        embedding: embed,
        x,
        y,
        originalX: x,
        originalY: y,
        targetScale: scale,
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
  }, [filterSettings, particleContainerRefs, masterAtlas])

  // ────────────────────────────────────────────────────────────────────────────
  // Render – one <pixiParticleContainer> per atlas sheet
  // ────────────────────────────────────────────────────────────────────────────
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

      {/* Text labels that float above */}
      <pixiContainer position={{ x: CANVAS_OFFSET_X, y: CANVAS_OFFSET_Y }}>
        {textEmbeddings.map((embed: any) => {
          const [nx, ny] = embed.point
          return (
            <pixiText
              key={embed.id}
              text={embed.text}
              x={nx * CANVAS_WIDTH}
              y={ny * CANVAS_HEIGHT - 12}
              rotation={-Math.PI / 4}
              anchor={0.5}
              style={{
                fontSize: 12,
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

///////////////////////////////////////////////////////////////////////////////
// Utility – hit-test a point against the particles of ALL containers
///////////////////////////////////////////////////////////////////////////////

const pointIntersectsParticle = (
  x: number,
  y: number,
  containerRefs: React.RefObject<PIXI.ParticleContainer | null>[]
): CustomParticle | null => {
  for (const ref of containerRefs) {
    if (!ref.current) continue
    for (const particle of ref.current.particleChildren as CustomParticle[]) {
      const dx = x - particle.x
      const dy = y - particle.y
      if (dx * dx + dy * dy < 50) return particle
    }
  }
  return null
}

///////////////////////////////////////////////////////////////////////////////
// Light-box helper
///////////////////////////////////////////////////////////////////////////////

const ImageDisplayer = () => {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const selectedEmbedding = useAtomValue<any>(selectedEmbeddingAtom)

  useEffect(() => {
    if (buttonRef.current && selectedEmbedding) {
      setTimeout(() => buttonRef.current?.click(), 100)
    }
  }, [selectedEmbedding])

  if (!selectedEmbedding) return null

  return (
    <PhotoView
      key={`Image_${selectedEmbedding.id}`}
      src={`${API_URL}/original/${selectedEmbedding.id}`}
    >
      <button ref={buttonRef} />
    </PhotoView>
  )
}

///////////////////////////////////////////////////////////////////////////////
// Top-level canvas component
///////////////////////////////////////////////////////////////////////////////

const EmbeddingsCanvas: React.FC<Props> = ({ width = 1920, height = 1200 }) => {
  const dragStart = useRef<PIXI.PointData | null>(null)
  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const projectionSettings = useAtomValue(projectionSettingsAtom)
  const viewportRef = useRef<Viewport>(null)
  const minimapFrameRef = useRef<PIXI.Graphics>(null)
  const particleContainerRefs = useMemo(
    () =>
      Array.from({ length: NUM_ATLASES }, () =>
        React.createRef<PIXI.ParticleContainer>()
      ),
    []
  )
  const minimapParticleContainerRefs = useMemo(
    () =>
      Array.from({ length: NUM_ATLASES }, () =>
        React.createRef<PIXI.ParticleContainer>()
      ),
    []
  )
  const [allLoaded, setAllLoaded] = useState(false)
  const [masterAtlas, setMasterAtlas] = useState<{
    [key: string]: PIXI.Spritesheet
  }>({})

  // ────────────────────────────────────────────────────────────────────────────
  // Load all atlas PNGs & build masterAtlas
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const atlasImageSrcs = [
      atlas0,
      atlas1,
      atlas2,
      atlas3,
      atlas4,
      atlas5,
      atlas6,
      atlas7,
    ]
    let loaded = 0

    atlasImageSrcs.forEach((imgSrc, index) => {
      const frames: any = {}
      for (const key in atlasMeta) {
        const { x, y, width: w, height: h, sheet } = (atlasMeta as any)[key]
        if (sheet !== index) continue
        frames[key] = {
          frame: { x, y, w, h },
          spriteSourceSize: { x: 0, y: 0, w, h },
          sourceSize: { w: 128, h: 128 },
        }
      }

      const data = {
        frames,
        meta: {
          image: imgSrc,
          scale: '1',
          format: 'RGBA8888',
          size: { w: 2990, h: 2990 },
        },
      }

      PIXI.Assets.load(data.meta.image).then((baseTexture: any) => {
        const sheet = new PIXI.Spritesheet(baseTexture.baseTexture, data)
        sheet.parse().then(() => {
          setMasterAtlas((prev) => ({ ...prev, [index]: sheet }))
          if (++loaded === atlasImageSrcs.length) setAllLoaded(true)
        })
      })
    })
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    const g = minimapFrameRef.current
    if (!viewport || !g) return

    // helper in case your Viewport wrapper doesn’t expose getVisibleBounds()
    const computeWorldBounds = () => {
      if (typeof viewport.getVisibleBounds === 'function') {
        return viewport.getVisibleBounds()
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
      if (projectionSettings.type === 'umap' && b.width < 25000) {
        g.rect(b.x, b.y, b.width, b.height)
        g.fill({ color: 'white', alpha: 0.1 })
        g.stroke({ color: 'white', width: 100 })
        g.fill()
      }
    }

    draw() // first paint
    viewport.on('moved', draw)
    return () => {
      viewport.off('moved', draw)
    }
  }, [projectionSettings, viewportRef, minimapFrameRef])

  return (
    <>
      <ImageDisplayer />
      <Panel />
      <Application
        width={window.innerWidth}
        height={window.innerHeight}
        onInit={(app) => (state.pixiApp = app)}
      >
        <viewport
          ref={viewportRef}
          width={width}
          height={height}
          events={['move']}
          onPointerDown={(e: any) => {
            const screen = viewportRef.current?.toScreen(e.data.global)
            dragStart.current = screen ?? null
          }}
          onPointerUp={(e: any) => {
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
            setSelectedEmbedding(hit ? hit.data.embedding : null)
          }}
        >
          {allLoaded && (
            <Embeddings
              type="main"
              masterAtlas={masterAtlas}
              particleContainerRefs={particleContainerRefs}
            />
          )}
        </viewport>
        <pixiContainer
          position={{ x: window.innerWidth - 215, y: window.innerHeight - 235 }}
          width={250}
          height={250}
        >
          <pixiGraphics
            draw={(g) => {
              g.rect(-220, -50, 420, 275)
              g.fill({ color: 'black', alpha: 0.75 })
              g.stroke({ color: 'white', width: 1 })
              g.fill()
            }}
          />
          <pixiContainer scale={0.015}>
            {allLoaded && (
              <Embeddings
                type="minimap"
                masterAtlas={masterAtlas}
                particleContainerRefs={minimapParticleContainerRefs}
              />
            )}
            <pixiGraphics ref={minimapFrameRef} />
          </pixiContainer>
        </pixiContainer>
      </Application>
    </>
  )
}

export default EmbeddingsCanvas
