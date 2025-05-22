import { type UnprefixedPixiElements } from '@pixi/react'
import { type Viewport } from 'pixi-viewport'

declare module '@pixi/react' {
  interface PixiElements extends UnprefixedPixiElements {
    viewport: PixiReactElementProps<typeof Viewport>
  }
}
