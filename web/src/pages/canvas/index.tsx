import React, { useEffect, useMemo, useState } from 'react'
import '@pixi/events'
import { Application, extend, useTick } from '@pixi/react'
import * as PIXI from 'pixi.js'
import atlasMeta from '@/assets/atlas.json'
import atlasImageSrc from '@/assets/atlas.png'
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
})

type Props = {
  width?: number
  height?: number
  nodeSize?: number
}

type CustomParticle = PIXI.Particle & {
  data?: any
}

const CANVAS_WIDTH = 1920 / 2
const CANVAS_HEIGHT = 1200 / 2
const CANVAS_OFFSET_X = 0
const CANVAS_OFFSET_Y = 0
const BASE_SCALE = 0.075

const colorForMetadata = (metadata: any) => {
  if (metadata.photographer == '1') {
    return 0x5555ff
  } else if (metadata.photographer == '2') {
    return 0x55ff55
  } else if (metadata.photographer == '3') {
    return 0xffff55
  } else if (metadata.photographer == '4') {
    return 0xff55ff
  }
  return 0xffffff
}

const Embeddings: React.FC<{
  atlas: PIXI.Spritesheet
  particleContainerRef: React.RefObject<PIXI.ParticleContainer | null>
}> = ({ atlas, particleContainerRef }) => {
  const rawEmbeddings = useAtomValue(projectedEmbeddingsAtom)
  const matchedEmbeddings = rawEmbeddings.filter(
    (embed: any) => embed.meta.matched
  )
  const displaySettings = useAtomValue(displaySettingsAtom)
  const filterSettings = useAtomValue(filterSettingsAtom)
  const projectionSettings = useAtomValue(projectionSettingsAtom)
  const textEmbeddings = rawEmbeddings.filter(
    (embed: any) => embed.type === 'text'
  )

  useTick((_: PIXI.Ticker) => {
    if (particleContainerRef.current) {
      for (let particle of particleContainerRef.current
        .particleChildren as CustomParticle[]) {
        // lerp position towards data position
        const data = particle.data
        if (data) {
          const targetX = data.x
          const targetY = data.y
          const dx = targetX - particle.x
          const dy = targetY - particle.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          const speed = 0.0001
          if (distance > 0.1) {
            particle.x += dx * speed
            particle.y += dy * speed
          }
          // lerp scale towards targetScale
          const targetScale =
            (data.targetScale || BASE_SCALE) * displaySettings.scale

          const scaleDiff = targetScale - particle.scaleX
          if (Math.abs(scaleDiff) > 0.01) {
            particle.scaleX += scaleDiff * speed
            particle.scaleY += scaleDiff * speed
          }
        }
      }
      particleContainerRef.current.update()
    }
  })

  useEffect(() => {
    if (particleContainerRef.current) {
      console.log('updating particle data')
      for (let particle of particleContainerRef.current
        .particleChildren as CustomParticle[]) {
        const embeddingId = particle.data.embedding.id
        const rawEmbedding = rawEmbeddings.find(
          (e: any) => e.id === embeddingId
        )
        if (rawEmbedding) {
          const [nx, ny] = rawEmbedding.point
          const x = nx * CANVAS_WIDTH
          const y = ny * CANVAS_HEIGHT
          particle.data.embedding = rawEmbedding
          particle.tint = displaySettings.colorPhotographer
            ? colorForMetadata(rawEmbedding.meta)
            : 0xffffff
          particle.data.x = x
          particle.data.y = y
          // if (particle.data.meta.matched) {
          //   particle.data.targetScale = BASE_SCALE * displaySettings.scale
          // } else {
          // }
          particle.data.targetScale = BASE_SCALE * displaySettings.scale
        }
      }
    }
  }, [rawEmbeddings, filterSettings, displaySettings, projectionSettings])

  useEffect(() => {
    if (particleContainerRef.current) {
      console.log('recreating particles')
      for (let i = 0; i < rawEmbeddings.length; i++) {
        const [nx, ny] = rawEmbeddings[i].point
        const x = nx * CANVAS_WIDTH
        const y = ny * CANVAS_HEIGHT
        const particle = new PIXI.Particle({
          texture: atlas.textures[rawEmbeddings[i].id],
          x,
          y,
          scaleX: BASE_SCALE * displaySettings.scale,
          scaleY: BASE_SCALE * displaySettings.scale,
          anchorX: 0.5,
          anchorY: 0.5,
          tint: displaySettings.colorPhotographer
            ? colorForMetadata(rawEmbeddings[i].meta)
            : 0xffffff,
        }) as CustomParticle
        particle.data = {}
        particle.data.embedding = rawEmbeddings[i]
        particle.data.x = x
        particle.data.y = y
        particle.data.originalX = x
        particle.data.originalY = y
        particleContainerRef.current.addParticle(particle)
      }
    }

    return () => {
      if (particleContainerRef.current) {
        particleContainerRef.current.removeParticles()
        particleContainerRef.current.particleChildren = []
      }
    }
  }, [rawEmbeddings, filterSettings, projectionSettings, particleContainerRef])

  return (
    <>
      <pixiParticleContainer
        position={{
          x: CANVAS_OFFSET_X,
          y: CANVAS_OFFSET_Y,
        }}
        ref={particleContainerRef}
        dynamicProperties={{
          position: true,
          scale: true,
          rotation: false,
          alpha: false,
        }}
      />
      <pixiContainer
        position={{
          x: CANVAS_OFFSET_X,
          y: CANVAS_OFFSET_Y,
        }}
      >
        {textEmbeddings.map((embed: any) => {
          const originalIndex = rawEmbeddings.findIndex(
            (e: any) => e.id === embed.id
          )
          const [nx, ny] = rawEmbeddings[originalIndex].point
          const x = nx * CANVAS_WIDTH
          const y = ny * CANVAS_HEIGHT

          // console.log('Rendering text embed:', embed, x, y)

          return (
            <pixiText
              key={embed.id}
              text={embed.text}
              x={x}
              y={y - 12}
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

const pointIntersectsParticle = (
  x: number,
  y: number,
  particles: CustomParticle[]
) => {
  for (const particle of particles) {
    const dx = x - particle.x
    const dy = y - particle.y
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared < 10) {
      return particle
    }
  }
  return null
}

const ImageDisplayer = () => {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const selectedEmbedding = useAtomValue<any>(selectedEmbeddingAtom)

  useEffect(() => {
    if (buttonRef.current && selectedEmbedding) {
      setTimeout(() => {
        buttonRef.current?.click()
      }, 100)
    }
  }, [buttonRef, selectedEmbedding])

  if (!selectedEmbedding) return null

  return (
    <PhotoView
      key={`Image_${selectedEmbedding.id}`}
      src={`${API_URL}/original/${selectedEmbedding.id}`}
      // overlay={<ImageOverlay embedding={selectedEmbedding} />}
    >
      <button ref={buttonRef}></button>
    </PhotoView>
  )
}

const EmbeddingsCanvas: React.FC<Props> = ({ width = 1920, height = 1200 }) => {
  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const viewportRef = React.useRef<Viewport>(null)
  const particleContainerRef = React.useRef<PIXI.ParticleContainer>(null)
  const [atlas, setAtlas] = useState<PIXI.Spritesheet | null>(null)

  useEffect(() => {
    const sourceSize = {
      w: 64,
      h: 64,
    }
    const frames: any = {}

    for (const key in atlasMeta) {
      const { x, y, width, height } = (atlasMeta as any)[key]
      frames[key] = {
        frame: { x, y, w: width, h: height },
        spriteSourceSize: { x: 0, y: 0, w: width, h: height },
        sourceSize,
      }
    }

    const atlasData = {
      frames,
      meta: {
        scale: '1',
        image: atlasImageSrc,
        format: 'RGBA8888',
        size: { w: 8450, h: 8450 },
      },
    }

    // Load the image first
    PIXI.Assets.load(atlasData.meta.image).then((baseTexture) => {
      const spritesheet = new PIXI.Spritesheet(
        baseTexture.baseTexture,
        atlasData
      )
      spritesheet.parse().then(() => {
        setAtlas(spritesheet)
      })
    })
  }, [])

  if (!atlas) return <div>Loading...</div>

  return (
    <>
      <ImageDisplayer />
      <Panel />
      <Application
        width={window.innerWidth}
        height={window.innerHeight}
        onInit={(app) => {
          state.pixiApp = app
        }}
      >
        <viewport
          ref={viewportRef}
          width={width}
          height={height}
          onClick={(e: any) => {
            const point = viewportRef.current?.toWorld(e.data.global)

            const particles = particleContainerRef.current?.particleChildren
            if (particles && point) {
              // const zoom = viewportRef.current?.lastViewport?.scaleX
              const particle = pointIntersectsParticle(
                point.x,
                point.y,
                particles as PIXI.Particle[]
              )
              if (particle) {
                console.log('Particle clicked:', point, particle)
                const data = particle.data
                setSelectedEmbedding(data.embedding)
              } else {
                setSelectedEmbedding(null)
              }
            }
          }}
        >
          <Embeddings
            atlas={atlas}
            particleContainerRef={particleContainerRef}
          />
        </viewport>
      </Application>
    </>
  )
}

export default EmbeddingsCanvas
