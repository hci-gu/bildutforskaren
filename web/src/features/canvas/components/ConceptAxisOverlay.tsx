import { useAtomValue } from 'jotai'
import {
  conceptAxisEnabledAtom,
  conceptLensResultAtom,
} from '@/store'
import {
  CANVAS_HEIGHT,
  CANVAS_OFFSET_X,
  CANVAS_OFFSET_Y,
  CANVAS_WIDTH,
} from '../constants'

const SINGLE_START = { r: 0x44, g: 0x01, b: 0x54 }
const SINGLE_END = { r: 0xfd, g: 0xe7, b: 0x25 }
const CONTRAST_START = { r: 0xfb, g: 0x92, b: 0x3c }
const CONTRAST_END = { r: 0x38, g: 0xbd, b: 0xf8 }

const mixColor = (
  start: { r: number; g: number; b: number },
  end: { r: number; g: number; b: number },
  amount: number
) =>
  (Math.round(start.r + (end.r - start.r) * amount) << 16) |
  (Math.round(start.g + (end.g - start.g) * amount) << 8) |
  Math.round(start.b + (end.b - start.b) * amount)

export const ConceptAxisOverlay = () => {
  const enabled = useAtomValue(conceptAxisEnabledAtom)
  const result = useAtomValue(conceptLensResultAtom)
  const axis = result?.axis

  if (
    !enabled ||
    !axis?.available ||
    axis.dimension !== 2 ||
    axis.start.length !== 2 ||
    axis.end.length !== 2
  ) {
    return null
  }

  const start = {
    x: axis.start[0] * CANVAS_WIDTH,
    y: axis.start[1] * CANVAS_HEIGHT,
  }
  const end = {
    x: axis.end[0] * CANVAS_WIDTH,
    y: axis.end[1] * CANVAS_HEIGHT,
  }
  const contrast = axis.mode === 'contrast'
  const startColor = contrast ? CONTRAST_START : SINGLE_START
  const endColor = contrast ? CONTRAST_END : SINGLE_END

  return (
    <pixiContainer
      position={{ x: CANVAS_OFFSET_X, y: CANVAS_OFFSET_Y }}
      eventMode="none"
    >
      <pixiGraphics
        eventMode="none"
        draw={(graphics) => {
          graphics.clear()
          const segments = 32
          for (let index = 0; index < segments; index += 1) {
            const from = index / segments
            const to = (index + 1) / segments
            graphics.moveTo(
              start.x + (end.x - start.x) * from,
              start.y + (end.y - start.y) * from
            )
            graphics.lineTo(
              start.x + (end.x - start.x) * to,
              start.y + (end.y - start.y) * to
            )
            graphics.stroke({
              color: mixColor(startColor, endColor, (from + to) / 2),
              width: 6,
              alpha: 0.88,
            })
          }

          const angle = Math.atan2(end.y - start.y, end.x - start.x)
          const arrowLength = 18
          const arrowWidth = 10
          const baseX = end.x - Math.cos(angle) * arrowLength
          const baseY = end.y - Math.sin(angle) * arrowLength
          graphics.poly([
            end.x,
            end.y,
            baseX + Math.sin(angle) * arrowWidth,
            baseY - Math.cos(angle) * arrowWidth,
            baseX - Math.sin(angle) * arrowWidth,
            baseY + Math.cos(angle) * arrowWidth,
          ])
          graphics.fill({
            color: mixColor(startColor, endColor, 1),
            alpha: 0.95,
          })
          graphics.circle(start.x, start.y, 7)
          graphics.fill({
            color: mixColor(startColor, endColor, 0),
            alpha: 0.95,
          })
          graphics.stroke({ color: 0xffffff, width: 2, alpha: 0.75 })
        }}
      />
    </pixiContainer>
  )
}
