import { useCallback, useEffect, useRef } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  activeDatasetIdAtom,
  displaySettingsAtom,
  loadableProjectedEmbeddings3dAtom,
  selectedEmbeddingAtom,
  selectedEmbeddingIdsAtom,
} from '@/store'
import { datasetApiUrl, fetchAtlasMeta } from '@/shared/lib/api'
import type { AtlasMeta } from './hooks/useAtlasLoader'
import Panel from './Panel'
import { HUD } from './components/HUD'
import { HomeLogoLink } from '@/shared/components/HomeLogoLink'

type ProjectedImage = {
  id: number
  point: [number, number, number]
  meta: Record<string, unknown> & { matched?: boolean }
}

type PointCloudUserData = {
  ids: number[]
  selectedAttribute: THREE.BufferAttribute
}

const vertexShader = `
  attribute vec4 atlasRect;
  attribute float imageAspect;
  attribute float selected;
  attribute float matched;
  varying vec4 vAtlasRect;
  varying float vImageAspect;
  varying float vSelected;
  varying float vMatched;
  uniform float pointSize;

  void main() {
    vAtlasRect = atlasRect;
    vImageAspect = imageAspect;
    vSelected = selected;
    vMatched = matched;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(pointSize * (10.0 / max(1.0, -viewPosition.z)), 5.0, 96.0);
  }
`

const fragmentShader = `
  uniform sampler2D atlas;
  varying vec4 vAtlasRect;
  varying float vImageAspect;
  varying float vSelected;
  varying float vMatched;

  void main() {
    vec2 local = gl_PointCoord;
    if (vImageAspect > 1.0) {
      float visibleHeight = 1.0 / vImageAspect;
      local.y = (local.y - (1.0 - visibleHeight) * 0.5) / visibleHeight;
    } else {
      float visibleWidth = vImageAspect;
      local.x = (local.x - (1.0 - visibleWidth) * 0.5) / visibleWidth;
    }
    if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) discard;

    vec2 uv = vec2(
      vAtlasRect.x + local.x * vAtlasRect.z,
      vAtlasRect.y + local.y * vAtlasRect.w
    );
    vec4 color = texture2D(atlas, uv);
    if (color.a < 0.05) discard;

    float edge = min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y));
    if (vSelected > 0.5 && edge < 0.07) {
      color = mix(color, vec4(0.20, 1.0, 0.52, 1.0), 0.9);
    } else if (vMatched > 0.5 && edge < 0.055) {
      color = mix(color, vec4(1.0, 0.78, 0.18, 1.0), 0.85);
    } else if (vMatched < 0.5) {
      color.rgb *= 0.82;
    }
    gl_FragColor = color;
  }
`

const normalizePoints = (items: ProjectedImage[]) => {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  items.forEach((item) => {
    min.min(new THREE.Vector3(...item.point))
    max.max(new THREE.Vector3(...item.point))
  })
  const center = min.clone().add(max).multiplyScalar(0.5)
  const span = max.clone().sub(min)
  const scale = 14 / Math.max(1e-6, span.x, span.y, span.z)
  return new Map(
    items.map((item) => [
      item.id,
      new THREE.Vector3(...item.point).sub(center).multiplyScalar(scale),
    ])
  )
}

export const Umap3DScene = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const resetCameraRef = useRef<() => void>(() => undefined)
  const pointCloudsRef = useRef<THREE.Points[]>([])
  const selectedIdsRef = useRef<string[]>([])
  const pointsByIdRef = useRef(new Map<number, THREE.Vector3>())
  const itemsByIdRef = useRef(new Map<number, ProjectedImage>())
  const selectedIds = useAtomValue(selectedEmbeddingIdsAtom)
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const displaySettings = useAtomValue(displaySettingsAtom)
  const projection = useAtomValue(loadableProjectedEmbeddings3dAtom)
  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const setSelectedEmbeddingIds = useSetAtom(selectedEmbeddingIdsAtom)

  const clearSelection = useCallback(() => {
    setSelectedEmbedding(null)
    setSelectedEmbeddingIds([])
  }, [setSelectedEmbedding, setSelectedEmbeddingIds])

  selectedIdsRef.current = selectedIds

  useEffect(() => {
    const selected = new Set(selectedIds.map(Number))
    pointCloudsRef.current.forEach((cloud) => {
      const userData = cloud.userData as PointCloudUserData
      userData.ids.forEach((id, index) => {
        userData.selectedAttribute.setX(index, selected.has(id) ? 1 : 0)
      })
      userData.selectedAttribute.needsUpdate = true
    })
  }, [selectedIds])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !datasetId || projection.state !== 'hasData') return

    const items = projection.data as ProjectedImage[]
    let disposed = false
    let frame = 0
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x07090e)
    scene.fog = new THREE.FogExp2(0x07090e, 0.018)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(renderer.domElement)

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.05,
      500
    )
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.zoomToCursor = true
    controls.minDistance = 1
    controls.maxDistance = 100

    const normalizedPoints = normalizePoints(items)
    pointsByIdRef.current = normalizedPoints
    itemsByIdRef.current = new Map(items.map((item) => [item.id, item]))
    const radius = Math.max(
      4,
      ...Array.from(normalizedPoints.values()).map((point) => point.length())
    )
    const resetCamera = () => {
      controls.target.set(0, 0, 0)
      camera.position.set(radius * 0.75, radius * 0.55, radius * 2.35)
      camera.near = Math.max(0.01, radius / 1000)
      camera.far = radius * 50
      camera.updateProjectionMatrix()
      controls.update()
    }
    resetCameraRef.current = resetCamera
    resetCamera()

    const textureLoader = new THREE.TextureLoader()
    const resources: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = []
    const textures: THREE.Texture[] = []

    const buildClouds = async () => {
      const atlasMeta = (await fetchAtlasMeta(datasetId)) as AtlasMeta
      if (disposed) return

      const bySheet = new Map<number, ProjectedImage[]>()
      items.forEach((item) => {
        const entry = atlasMeta[String(item.id)]
        if (!entry) return
        const list = bySheet.get(entry.sheet) ?? []
        list.push(item)
        bySheet.set(entry.sheet, list)
      })

      for (const [sheet, sheetItems] of bySheet) {
        const texture = await textureLoader.loadAsync(
          datasetApiUrl(datasetId, `/atlas/sheet/${sheet}.png`)
        )
        if (disposed) {
          texture.dispose()
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        texture.minFilter = THREE.LinearMipmapLinearFilter
        texture.magFilter = THREE.LinearFilter
        textures.push(texture)

        const positions = new Float32Array(sheetItems.length * 3)
        const rects = new Float32Array(sheetItems.length * 4)
        const aspects = new Float32Array(sheetItems.length)
        const selected = new Float32Array(sheetItems.length)
        const matched = new Float32Array(sheetItems.length)

        sheetItems.forEach((item, index) => {
          const point = normalizedPoints.get(item.id)!
          const entry = atlasMeta[String(item.id)]
          const atlasWidth = entry.atlas?.w ?? texture.image.width
          const atlasHeight = entry.atlas?.h ?? texture.image.height
          positions.set([point.x, point.y, point.z], index * 3)
          rects.set(
            [
              entry.x / atlasWidth,
              1 - (entry.y + entry.height) / atlasHeight,
              entry.width / atlasWidth,
              entry.height / atlasHeight,
            ],
            index * 4
          )
          aspects[index] = entry.width / Math.max(1, entry.height)
          selected[index] = selectedIdsRef.current.includes(String(item.id)) ? 1 : 0
          matched[index] = item.meta.matched ? 1 : 0
        })

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geometry.setAttribute('atlasRect', new THREE.BufferAttribute(rects, 4))
        geometry.setAttribute('imageAspect', new THREE.BufferAttribute(aspects, 1))
        const selectedAttribute = new THREE.BufferAttribute(selected, 1)
        geometry.setAttribute('selected', selectedAttribute)
        geometry.setAttribute('matched', new THREE.BufferAttribute(matched, 1))

        const material = new THREE.ShaderMaterial({
          uniforms: {
            atlas: { value: texture },
            pointSize: { value: 62 * Number(displaySettings.scale || 1) },
          },
          vertexShader,
          fragmentShader,
          transparent: true,
          depthTest: true,
          depthWrite: true,
        })
        const cloud = new THREE.Points(geometry, material)
        cloud.frustumCulled = false
        cloud.userData = {
          ids: sheetItems.map((item) => item.id),
          selectedAttribute,
        } satisfies PointCloudUserData
        pointCloudsRef.current.push(cloud)
        resources.push({ geometry, material })
        scene.add(cloud)
      }
    }

    buildClouds().catch((error) => {
      console.error('Failed to build 3D UMAP scene:', error)
    })

    let pointerStart: { x: number; y: number } | null = null
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button === 0) pointerStart = { x: event.clientX, y: event.clientY }
    }
    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerStart || event.button !== 0) return
      const distance = Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y
      )
      pointerStart = null
      if (distance > 6) return

      const bounds = renderer.domElement.getBoundingClientRect()
      let best: { id: number; distance: number; depth: number } | null = null
      for (const [id, point] of normalizedPoints) {
        const projected = point.clone().project(camera)
        if (projected.z < -1 || projected.z > 1) continue
        const x = bounds.left + ((projected.x + 1) / 2) * bounds.width
        const y = bounds.top + ((1 - projected.y) / 2) * bounds.height
        const screenDistance = Math.hypot(event.clientX - x, event.clientY - y)
        if (
          screenDistance <= 22 &&
          (!best || screenDistance < best.distance - 2 ||
            (Math.abs(screenDistance - best.distance) <= 2 && projected.z < best.depth))
        ) {
          best = { id, distance: screenDistance, depth: projected.z }
        }
      }

      if (!best) {
        clearSelection()
        return
      }
      const item = itemsByIdRef.current.get(best.id)
      if (item) {
        setSelectedEmbedding({ id: item.id, meta: item.meta })
        setSelectedEmbeddingIds([String(item.id)])
      }
    }
    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)

    const handleResize = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      camera.aspect = width / Math.max(1, height)
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)

    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('pointerup', handlePointerUp)
      resources.forEach(({ geometry, material }) => {
        geometry.dispose()
        material.dispose()
      })
      textures.forEach((texture) => texture.dispose())
      pointCloudsRef.current = []
      pointsByIdRef.current.clear()
      itemsByIdRef.current.clear()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [
    clearSelection,
    datasetId,
    displaySettings.scale,
    projection,
    setSelectedEmbedding,
    setSelectedEmbeddingIds,
  ])

  const isLoading = projection.state === 'loading'
  const hasError = projection.state === 'hasError'

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#07090e]">
      <div ref={containerRef} className="absolute inset-0" />
      <HomeLogoLink />
      <HUD />
      <Panel />
      <div
        className="glass-panel absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 text-xs text-white"
        data-canvas-ui="true"
      >
        <span>Drag: rotera · Högerdrag: panorera · Hjul: zooma</span>
        <button
          type="button"
          className="rounded-full border border-white/20 px-3 py-1 hover:bg-white/10"
          onClick={() => resetCameraRef.current()}
        >
          Återställ kamera
        </button>
      </div>
      {isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 text-white backdrop-blur-sm">
          Beräknar 3D-projektion…
        </div>
      )}
      {hasError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 text-white">
          Kunde inte skapa 3D-projektionen.
        </div>
      )}
    </div>
  )
}
