import React, { use, useEffect, useMemo, useState } from 'react'
import '@pixi/events'
import { Application, useApplication, extend, useTick } from '@pixi/react'
import * as PIXI from 'pixi.js'
import atlasMeta from '@/assets/atlas.json'
import atlasImageSrc from '@/assets/atlas.png'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  API_URL,
  filteredEmbeddingsAtom,
  searchQueryAtom,
  selectedEmbeddingAtom,
} from '@/state'
import { Input } from '../../components/ui/input'
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

function normalizePoints(points: [number, number][]): [number, number][] {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  return points.map(([x, y]) => [(x - minX) / rangeX, (y - minY) / rangeY])
}

type Props = {
  width?: number
  height?: number
  nodeSize?: number
}

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
  const rawEmbeddings = useAtomValue(filteredEmbeddingsAtom)
  const matchedEmbeddings = rawEmbeddings.filter(
    (embed: any) => embed.meta.matched
  )

  const normalized = useMemo(
    () => normalizePoints(rawEmbeddings.map((e: any) => e.point)),
    [rawEmbeddings, matchedEmbeddings]
  )
  const textEmbeddings = rawEmbeddings.filter(
    (embed: any) => embed.type === 'text'
  )

  useTick((_: PIXI.Ticker) => {
    if (particleContainerRef.current) {
      for (let particle of particleContainerRef.current.particleChildren) {
        // lerp position towards data position
        const data = particle.data
        if (data) {
          const targetX = data.x
          const targetY = data.y
          const dx = targetX - particle.x
          const dy = targetY - particle.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          const speed = 0.1
          if (distance > 1) {
            particle.x += dx * speed
            particle.y += dy * speed
          }
          // lerp scale towards targetScale
          const targetScale = data.targetScale || 0.05
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
      for (let i = 0; i < normalized.length; i++) {
        const [nx, ny] = normalized[i]
        const x = nx * 1920
        const y = ny * 1200
        const particle = particleContainerRef.current.particleChildren[i]
        if (particle) {
          particle.data = rawEmbeddings[i]
          particle.data.x = x
          particle.data.y = y
          if (particle.data.meta.matched) {
            particle.data.targetScale = 0.5
          } else {
            particle.data.targetScale = 0.05
          }
        }
      }
    }
  }, [normalized])

  useEffect(() => {
    if (particleContainerRef.current) {
      for (let i = 0; i < rawEmbeddings.length; i++) {
        const [nx, ny] = normalized[i]
        const x = nx * 1920
        const y = ny * 1200
        const particle = new PIXI.Particle({
          texture: atlas.textures[i],
          x,
          y,
          scaleX: 0.05,
          scaleY: 0.05,
          anchorX: 0.5,
          anchorY: 0.5,
          tint: colorForMetadata(rawEmbeddings[i].meta),
        })
        particle.data = rawEmbeddings[i]
        particle.data.x = x
        particle.data.y = y
        particleContainerRef.current.addParticle(particle)
      }
    }

    return () => {
      if (particleContainerRef.current) {
        particleContainerRef.current.removeParticles()
      }
    }
  }, [particleContainerRef])

  return (
    <>
      <pixiParticleContainer
        ref={particleContainerRef}
        dynamicProperties={{
          position: true,
          scale: true,
          rotation: false,
          alpha: false,
        }}
      />
      <pixiContainer>
        {textEmbeddings.map((embed: any, i: number) => {
          const [nx, ny] = normalized[i]
          const x = nx * 1920
          const y = ny * 1200

          return (
            <pixiText
              key={embed.id}
              text={embed.text}
              x={x}
              y={y}
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
  particles: PIXI.Particle[]
) => {
  for (const particle of particles) {
    const dx = x - particle.x
    const dy = y - particle.y
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared < 5) {
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
                const data = particle.data
                setSelectedEmbedding(data)
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
