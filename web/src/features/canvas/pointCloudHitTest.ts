import * as THREE from 'three'

type CanvasBounds = { left: number; top: number; width: number; height: number }

export const MIN_IMAGE_POINT_SIZE = 5
export const MAX_IMAGE_POINT_SIZE = 96
export const IMAGE_POINT_DEPTH_SCALE = 10

export const pointCloudImageAtPoint = (
  x: number,
  y: number,
  clouds: readonly THREE.Points[],
  camera: THREE.Camera,
  bounds: CanvasBounds,
  drawingBuffer: { width: number; height: number }
): number | null => {
  if (drawingBuffer.width <= 0 || drawingBuffer.height <= 0) return null
  let best: { id: number; depth: number } | null = null
  const viewPosition = new THREE.Vector3()
  const projected = new THREE.Vector3()
  camera.updateWorldMatrix(true, false)
  for (const cloud of clouds) {
    if (!cloud.visible || !(cloud.material instanceof THREE.ShaderMaterial)) continue
    const positions = cloud.geometry.getAttribute('position')
    const aspects = cloud.geometry.getAttribute('imageAspect')
    const pointSize = Number(cloud.material.uniforms.pointSize?.value)
    if (!positions || !aspects || !Number.isFinite(pointSize)) continue
    cloud.updateWorldMatrix(true, false)
    for (let i = 0; i < positions.count; i++) {
      viewPosition.fromBufferAttribute(positions, i)
        .applyMatrix4(cloud.matrixWorld)
        .applyMatrix4(camera.matrixWorldInverse)
      projected.copy(viewPosition).applyMatrix4(camera.projectionMatrix)
      if (viewPosition.z >= 0 || projected.z < -1 || projected.z > 1) continue
      const aspect = aspects.getX(i)
      if (aspect <= 0) continue

      // Match the vertex shader's point size and fragment shader's aspect crop.
      // gl_PointSize uses drawing-buffer pixels; pointer events use CSS pixels.
      const size = THREE.MathUtils.clamp(
        pointSize * IMAGE_POINT_DEPTH_SCALE / Math.max(1, -viewPosition.z),
        MIN_IMAGE_POINT_SIZE,
        MAX_IMAGE_POINT_SIZE
      )
      const halfWidth =
        size * bounds.width / drawingBuffer.width * Math.min(1, aspect) / 2
      const halfHeight =
        size * bounds.height / drawingBuffer.height * Math.min(1, 1 / aspect) / 2
      const px = bounds.left + ((projected.x + 1) / 2) * bounds.width
      const py = bounds.top + ((1 - projected.y) / 2) * bounds.height
      if (
        Math.abs(x - px) <= halfWidth &&
        Math.abs(y - py) <= halfHeight &&
        (!best || projected.z <= best.depth)
      ) {
        best = { id: cloud.userData.ids[i], depth: projected.z }
      }
    }
  }
  return best?.id ?? null
}
