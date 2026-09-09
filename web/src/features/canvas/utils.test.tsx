import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Container, Particle, ParticleContainer, Rectangle, Texture } from 'pixi.js'
import { pointIntersectsParticle } from './utils'

const image = (width = 400, height = 200) => new Particle({
  texture: new Texture({ source: Texture.WHITE.source, orig: new Rectangle(0, 0, width, height) }),
  x: 100,
  y: 200,
  scaleX: 0.5,
  scaleY: 0.5,
  anchorX: 0.5,
  anchorY: 0.5,
})

const layer = (...particles: Particle[]) => {
  const container = new ParticleContainer()
  container.addParticle(...particles)
  return { current: container }
}

test('the whole visible image is clickable, including its edges and corners', () => {
  const particle = image()
  const refs = [layer(particle)]
  for (const [x, y] of [[0, 150], [200, 150], [0, 250], [200, 250], [190, 240]]) {
    assert.equal(pointIntersectsParticle(x, y, refs), particle, `missed ${x}, ${y}`)
  }
  assert.equal(pointIntersectsParticle(201, 200, refs), null)
  assert.equal(pointIntersectsParticle(100, 251, refs), null)
})

test('portrait bounds and current animated size determine the hit area', () => {
  const particle = image(200, 400)
  const refs = [layer(particle)]
  assert.equal(pointIntersectsParticle(149, 299, refs), particle)
  assert.equal(pointIntersectsParticle(151, 200, refs), null)
  particle.scaleX = 0.1
  particle.scaleY = 0.1
  assert.equal(pointIntersectsParticle(109, 219, refs), particle)
  assert.equal(pointIntersectsParticle(111, 200, refs), null)
  particle.x = 300
  assert.equal(pointIntersectsParticle(309, 219, refs), particle)
  assert.equal(pointIntersectsParticle(109, 219, refs), null)
})

test('hit testing follows the image anchor, rotation, and flipped scale', () => {
  const particle = image()
  particle.anchorX = 0
  particle.anchorY = 0
  particle.rotation = Math.PI / 2
  particle.scaleX = -0.5
  assert.equal(pointIntersectsParticle(10, 10, [layer(particle)]), particle)
  assert.equal(pointIntersectsParticle(110, 210, [layer(particle)]), null)
})

test('trimmed atlas images do not have a hit area in the transparent margin', () => {
  const particle = image()
  particle.texture = new Texture({
    source: particle.texture.source,
    orig: particle.texture.orig,
    trim: new Rectangle(100, 50, 200, 100),
  })
  const refs = [layer(particle)]
  assert.equal(pointIntersectsParticle(149, 224, refs), particle)
  assert.equal(pointIntersectsParticle(49, 200, refs), null)
})

test('viewport pan and zoom plus layer offsets preserve the image hit area', () => {
  const viewport = new Container()
  viewport.position.set(350, -120)
  viewport.scale.set(3)
  const particle = image()
  const ref = layer(particle)
  ref.current.position.set(50, 70)
  ref.current.scale.set(2)
  viewport.addChild(ref.current)
  const screen = ref.current.toGlobal({ x: 190, y: 240 })
  const world = viewport.toLocal(screen)
  assert.equal(pointIntersectsParticle(world.x, world.y, [ref]), particle)
})

test('overlapping images select the one drawn on top, across atlas sheets too', () => {
  const back = image()
  const front = image()
  assert.equal(pointIntersectsParticle(100, 200, [layer(back, front)]), front)
  assert.equal(pointIntersectsParticle(100, 200, [layer(back), layer(front)]), front)
})

test('invisible images and layers cannot intercept clicks', () => {
  const back = image()
  const front = image()
  front.alpha = 0
  assert.equal(pointIntersectsParticle(100, 200, [layer(back, front)]), back)
  const hidden = layer(image())
  hidden.current.visible = false
  assert.equal(pointIntersectsParticle(100, 200, [hidden]), null)
  assert.equal(pointIntersectsParticle(100, 200, [{ current: null }]), null)
  back.scaleX = 0
  assert.equal(pointIntersectsParticle(100, 200, [layer(back)]), null)
})
