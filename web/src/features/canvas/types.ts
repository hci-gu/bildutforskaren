import type * as PIXI from 'pixi.js'

export type CustomParticle = PIXI.Particle & {
  data?: any
}
