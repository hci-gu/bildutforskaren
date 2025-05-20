import React, { useEffect, useMemo, useState } from 'react'
import { Application, useApplication, extend } from '@pixi/react'
import * as PIXI from 'pixi.js'
import atlasMeta from '@/assets/atlas.json'
import atlasImageSrc from '@/assets/atlas.png'
import { useAtomValue } from 'jotai'
import { embeddingsAtom } from '@/state'

extend({
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

const ZoomableContainer: React.FC<{
  atlas: PIXI.Spritesheet
  normalized: [number, number][]
  rawEmbeddings: any[]
  nodeSize: number
}> = ({ atlas, normalized, rawEmbeddings, nodeSize }) => {
  const { app } = useApplication()
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [last, setLast] = useState({ x: 0, y: 0 })

  const containerRef = React.useRef<PIXI.Container>(null)

  useEffect(() => {
    const canvas = app.view
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const scaleFactor = 1.05
      const direction = e.deltaY > 0 ? 1 : -1
      const newScale = direction > 0 ? scale / scaleFactor : scale * scaleFactor
      const mouse = app.renderer.events.pointer.global

      const worldPos = {
        x: (mouse.x - pos.x) / scale,
        y: (mouse.y - pos.y) / scale,
      }
      setScale(newScale)
      setPos({
        x: mouse.x - worldPos.x * newScale,
        y: mouse.y - worldPos.y * newScale,
      })
    }
    canvas.addEventListener('wheel', handleWheel)
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [scale, pos, app])

  useEffect(() => {
    if (app && app.canvas) {
    }

    const canvas = app.canvas
    const onMouseDown = (e: MouseEvent) => {
      setDragging(true)
      setLast({ x: e.clientX, y: e.clientY })
    }
    const onMouseUp = () => setDragging(false)
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      setPos((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
      setLast({ x: e.clientX, y: e.clientY })
    }
    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('mousemove', onMouseMove)
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('mousemove', onMouseMove)
    }
  }, [dragging, last])

  return (
    <pixiContainer
      ref={containerRef}
      scale={scale}
      position={{ x: pos.x, y: pos.y }}
    >
      {rawEmbeddings.map((embed, i) => {
        const [nx, ny] = normalized[i]
        const x = nx * 1920
        const y = ny * 1200
        const screenX = x * scale + pos.x
        const screenY = y * scale + pos.y

        // Cull based on viewport (you can adjust buffer)
        if (
          screenX + nodeSize < 0 ||
          screenX - nodeSize > window.innerWidth ||
          screenY + nodeSize < 0 ||
          screenY - nodeSize > window.innerHeight
        ) {
          return null
        }

        return (
          <pixiSprite
            key={embed.id}
            texture={atlas.textures[embed.id]}
            x={x}
            y={y}
            width={nodeSize}
            height={nodeSize}
            anchor={0.5}
            tint={embed.meta.matched ? 0xff5555 : 0xffffff}
          />
        )
      })}
    </pixiContainer>
  )
}

export const EmbeddingsCanvas: React.FC<Props> = ({
  width = 1920,
  height = 1200,
  nodeSize = 1,
}) => {
  const rawEmbeddings = useAtomValue(embeddingsAtom)
  const normalized = useMemo(
    () => normalizePoints(rawEmbeddings.map((e: any) => e.point)),
    [rawEmbeddings]
  )
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
        console.log('Spritesheet parsed')
        setAtlas(spritesheet)
      })
    })
  }, [])

  if (!atlas) return <div>Loading...</div>

  return (
    <Application width={window.innerWidth} height={window.innerHeight}>
      <ZoomableContainer
        atlas={atlas}
        normalized={normalized}
        rawEmbeddings={rawEmbeddings}
        nodeSize={nodeSize}
      />
    </Application>
  )
}
