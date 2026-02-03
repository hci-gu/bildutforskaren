import type { Application } from 'pixi.js'
import type { Viewport } from './ViewPort'

export const state: {
  pixiApp: Application | null
  viewport: Viewport | null
} = {
  pixiApp: null,
  viewport: null,
}
