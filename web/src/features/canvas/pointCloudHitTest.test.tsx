import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { pointCloudImageAtPoint } from './pointCloudHitTest'

const bounds = { left: 50, top: 30, width: 800, height: 600 }
const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 100)
const cloud = (id: number, aspect = 1, depth = 10, size = 62) => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -depth], 3))
  geometry.setAttribute('imageAspect', new THREE.Float32BufferAttribute([aspect], 1))
  const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms: { pointSize: { value: size } },
  }))
  points.userData.ids = [id]
  return points
}

test('3D images accept clicks at visible corners beyond the old fixed radius', () => {
  assert.equal(pointCloudImageAtPoint(480, 360, [cloud(1)], camera, bounds, bounds), 1)
  assert.equal(pointCloudImageAtPoint(482, 330, [cloud(1)], camera, bounds, bounds), null)
})

test('3D portrait and landscape letterboxing is not clickable', () => {
  assert.equal(pointCloudImageAtPoint(475, 340, [cloud(1, 2)], camera, bounds, bounds), 1)
  assert.equal(pointCloudImageAtPoint(450, 350, [cloud(1, 2)], camera, bounds, bounds), null)
  assert.equal(pointCloudImageAtPoint(460, 355, [cloud(1, 0.5)], camera, bounds, bounds), 1)
  assert.equal(pointCloudImageAtPoint(470, 330, [cloud(1, 0.5)], camera, bounds, bounds), null)
})

test('3D hit areas follow camera depth, image size, and display pixel density', () => {
  assert.equal(pointCloudImageAtPoint(497, 377, [cloud(1, 1, 2)], camera, bounds, bounds), 1)
  assert.equal(pointCloudImageAtPoint(460, 330, [cloud(1, 1, 50)], camera, bounds, bounds), null)
  assert.equal(pointCloudImageAtPoint(460, 330, [cloud(1, 1, 10, 10)], camera, bounds, bounds), null)
  const retinaBuffer = { width: 1600, height: 1200 }
  assert.equal(pointCloudImageAtPoint(465, 345, [cloud(1)], camera, bounds, retinaBuffer), 1)
  assert.equal(pointCloudImageAtPoint(470, 330, [cloud(1)], camera, bounds, retinaBuffer), null)
})

test('3D selection chooses the frontmost visible image and ignores hidden images', () => {
  const front = cloud(1, 1, 5)
  const back = cloud(2, 1, 10)
  front.position.x = 0.1
  assert.equal(pointCloudImageAtPoint(450, 330, [back, front], camera, bounds, bounds), 1)
  front.visible = false
  assert.equal(pointCloudImageAtPoint(450, 330, [back, front], camera, bounds, bounds), 2)
  assert.equal(pointCloudImageAtPoint(450, 330, [cloud(3, 1, -10)], camera, bounds, bounds), null)
})
