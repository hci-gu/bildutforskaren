import React from 'react'
import type * as PIXI from 'pixi.js'

export const SelectionRect: React.FC<{ selectionRect: PIXI.Rectangle | null }> = ({
  selectionRect,
}) => {
  return (
    <pixiGraphics
      draw={(g) => {
        g.clear()
        if (!selectionRect) return
        g.rect(
          selectionRect.x,
          selectionRect.y,
          selectionRect.width,
          selectionRect.height
        )
        g.fill({ color: 0x55aaff, alpha: 0.15 })
        g.stroke({ color: 0x55aaff, width: 2 })
        g.fill()
      }}
    />
  )
}
