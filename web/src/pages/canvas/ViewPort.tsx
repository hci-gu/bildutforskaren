import { Viewport as BaseViewport, type IViewportOptions } from 'pixi-viewport'
import { state } from './canvasState'

export class Viewport extends BaseViewport {
  constructor(options: Omit<IViewportOptions, 'events'> = {}) {
    if (!state.pixiApp) throw new Error('no pixi app')
    super({
      ...options,
      events: state.pixiApp.renderer.events,
    })
    this.drag().pinch().wheel().decelerate()
  }
}
