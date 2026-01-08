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
  loadableEmbeddingsAtom,
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
const MINIMAP_SIZE = 250
const MINIMAP_PADDING = 16
const MINIMAP_MARGIN = 32

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

const computeProjectionBounds = (embeddings: any[]) => {
  if (!embeddings.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  embeddings.forEach((embedding) => {
    if (!embedding?.point) return
    const [nx, ny] = embedding.point
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return
    const x = nx * CANVAS_WIDTH
    const y = ny * CANVAS_HEIGHT
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  })
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
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
          // if (
          //   projectionSettings.type !== 'grid' &&
          //   particle.data.embedding.meta.matched
          // ) {
          //   // golden tint
          //   // particle.tint = 0x00d7ff
          // } else {
          //   particle.tint = displaySettings.colorPhotographer
          //     ? colorForMetadata(rawEmbedding.meta)
          //     : 0xffffff
          // }
          particle.tint = displaySettings.colorPhotographer
            ? colorForMetadata(rawEmbedding.meta)
            : 0xffffff

          if (searchQuery.length && !particle.data.embedding.meta.matched) {
            particle.data.targetScale = BASE_SCALE * 0.1
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

  const meta = selectedEmbedding.meta || {}
  Object.keys(meta).forEach((key) => {
    if (meta[key] === null || meta[key] === undefined || meta[key] === '') {
      delete meta[key]
    }
    // round numbers to 2 decimal places
    if (typeof meta[key] === 'number') {
      meta[key] = Math.round(meta[key] * 100) / 100
    }
  })

  return (
    <>
      <PhotoView
        key={`Image_${selectedEmbedding.id}`}
        src={`${API_URL}/original/${selectedEmbedding.id}`}
      >
        <button ref={buttonRef} />
      </PhotoView>
      <div className="fixed bottom-0 left-0 p-2 text-white z-10000 text-xs bg-black/75">
        <pre>{JSON.stringify(meta, null, 2)}</pre>
      </div>
    </>
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
  const [windowSize, setWindowSize] = useState(() => ({
    width: typeof window === 'undefined' ? width : window.innerWidth,
    height: typeof window === 'undefined' ? height : window.innerHeight,
  }))
  const rawEmbeddings = useAtomValue(projectedEmbeddingsAtom('main'))
  const rawMinimapEmbeddings = useAtomValue(projectedEmbeddingsAtom('minimap'))
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
  const projectionBounds = useMemo(
    () => computeProjectionBounds(rawEmbeddings),
    [rawEmbeddings]
  )
  const minimapBounds = useMemo(
    () => computeProjectionBounds(rawMinimapEmbeddings),
    [rawMinimapEmbeddings]
  )
  const projectionKey = useMemo(
    () => JSON.stringify(projectionSettings),
    [projectionSettings]
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
  const lastProjectionKeyRef = useRef<string | null>(null)

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

  console.log('rendering canvas', rawEmbeddings.length)

  return (
    <>
      {(!allLoaded || rawEmbeddings.length == 0) && (
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
      <ImageDisplayer />
      <Panel />
      <Application
        width={windowSize.width}
        height={windowSize.height}
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
        {allLoaded && (
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
              {allLoaded && (
                <Embeddings
                  type="minimap"
                  masterAtlas={masterAtlas}
                  particleContainerRefs={minimapParticleContainerRefs}
                />
              )}
              {/* @ts-ignore */}
              <pixiGraphics ref={minimapFrameRef} />
            </pixiContainer>
          </pixiContainer>
        )}
      </Application>
    </>
  )
}

const EmbeddingsFetchWrapper = () => {
  const embeddings = useAtomValue(loadableEmbeddingsAtom)

  if (embeddings.state === 'loading') {
    return (
      <h1
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'white',
          fontSize: 24,
          zIndex: 1000,
        }}
      >
        Laddar in embeddings<br></br> ( det kan ta upp till en minut )
      </h1>
    )
  }

  return <EmbeddingsCanvas />
}

export default EmbeddingsFetchWrapper
