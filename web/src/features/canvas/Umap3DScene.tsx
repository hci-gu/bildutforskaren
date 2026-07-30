import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  activeDatasetIdAtom,
  anchorAnalysisCompareAtom,
  anchorAnalysisResultAtom,
  anchorAnalysisTabAtom,
  anchorAnalysisTrayCollapsedAtom,
  anchorAnalysisTrayHeightAtom,
  anchorAnalysisTrayOpenAtom,
  anchorGraphModeAtom,
  conceptAxisEnabledAtom,
  conceptLensResultAtom,
  conceptLensThresholdAtom,
  displaySettingsAtom,
  explanationPanelOpenAtom,
  explanationTabAtom,
  loadableProjectedEmbeddings3dAtom,
  neighborFidelityResultAtom,
  neighborFidelitySettingsAtom,
  selectedEmbeddingAtom,
  selectedEmbeddingIdsAtom,
  xaiImageFocusRequestAtom,
} from '@/store'
import { datasetApiUrl, fetchAtlasMeta } from '@/shared/lib/api'
import type { AtlasMeta } from './hooks/useAtlasLoader'
import Panel from './Panel'
import { getAnchorAnalysisDisplayPaths } from './anchorAnalysisPaths'
import { AnchorAnalysisTray } from './components/AnchorAnalysisTray'
import { HUD } from './components/HUD'
import { HomeLogoLink } from '@/shared/components/HomeLogoLink'
import { useNeighborFidelity } from './hooks/useNeighborFidelity'
import { useConceptLens } from './hooks/useConceptLens'
import { conceptLensVisual } from './xaiVisuals'
import type { ConceptLensResponse } from '@/shared/lib/api'

type ProjectedImage = {
  id: number
  point: [number, number, number]
  meta: Record<string, unknown> & { matched?: boolean }
}

type PointCloudUserData = {
  ids: number[]
  selectedAttribute: THREE.BufferAttribute
  lensColorAttribute: THREE.BufferAttribute
  lensAlphaAttribute: THREE.BufferAttribute
  lensActiveAttribute: THREE.BufferAttribute
}

type CameraTransition = {
  startedAt: number
  duration: number
  cameraFrom: THREE.Vector3
  cameraTo: THREE.Vector3
  targetFrom: THREE.Vector3
  targetTo: THREE.Vector3
}

const vertexShader = `
  attribute vec4 atlasRect;
  attribute float imageAspect;
  attribute float selected;
  attribute float matched;
  attribute vec3 lensColor;
  attribute float lensAlpha;
  attribute float lensActive;
  varying vec4 vAtlasRect;
  varying float vImageAspect;
  varying float vSelected;
  varying float vMatched;
  varying vec3 vLensColor;
  varying float vLensAlpha;
  varying float vLensActive;
  uniform float pointSize;

  void main() {
    vAtlasRect = atlasRect;
    vImageAspect = imageAspect;
    vSelected = selected;
    vMatched = matched;
    vLensColor = lensColor;
    vLensAlpha = lensAlpha;
    vLensActive = lensActive;
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
  varying vec3 vLensColor;
  varying float vLensAlpha;
  varying float vLensActive;

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
    if (vSelected > 0.5) {
      color.a = 1.0;
      if (edge < 0.07) {
        color = mix(color, vec4(0.20, 1.0, 0.52, 1.0), 0.9);
      }
    } else if (vLensActive > 0.5) {
      color.rgb = mix(color.rgb, vLensColor, 0.5);
      color.rgb *= mix(0.35, 1.0, vLensAlpha);
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

const normalizeProjectionPoint = (
  items: ProjectedImage[],
  coordinates: number[]
) => {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  items.forEach((item) => {
    min.min(new THREE.Vector3(...item.point))
    max.max(new THREE.Vector3(...item.point))
  })
  const center = min.clone().add(max).multiplyScalar(0.5)
  const span = max.clone().sub(min)
  const scale = 14 / Math.max(1e-6, span.x, span.y, span.z)
  return new THREE.Vector3(
    coordinates[0] ?? 0,
    coordinates[1] ?? 0,
    coordinates[2] ?? 0
  )
    .sub(center)
    .multiplyScalar(scale)
}

const clearObjectGroup = (group: THREE.Group) => {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      geometries.add(object.geometry)
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material]
      objectMaterials.forEach((material) => materials.add(material))
    }
  })
  group.clear()
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
}

const addConceptAxis = (
  group: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  contrast: boolean
) => {
  const startColor = new THREE.Color(contrast ? 0xfb923c : 0x440154)
  const endColor = new THREE.Color(contrast ? 0x38bdf8 : 0xfde725)
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
  geometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(
      [
        startColor.r,
        startColor.g,
        startColor.b,
        endColor.r,
        endColor.g,
        endColor.b,
      ],
      3
    )
  )
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
  const line = new THREE.Line(geometry, material)
  line.renderOrder = 1
  group.add(line)

  const direction = end.clone().sub(start).normalize()
  const length = start.distanceTo(end)
  const arrowHeight = Math.min(0.42, Math.max(0.18, length * 0.07))
  const arrowGeometry = new THREE.ConeGeometry(arrowHeight * 0.42, arrowHeight, 16)
  const arrowMaterial = new THREE.MeshBasicMaterial({
    color: endColor,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  })
  const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial)
  arrow.position.copy(end).addScaledVector(direction, -arrowHeight / 2)
  arrow.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction
  )
  arrow.renderOrder = 1
  group.add(arrow)

  const startGeometry = new THREE.SphereGeometry(arrowHeight * 0.24, 12, 8)
  const startMaterial = new THREE.MeshBasicMaterial({
    color: startColor,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  })
  const startMarker = new THREE.Mesh(startGeometry, startMaterial)
  startMarker.position.copy(start)
  startMarker.renderOrder = 1
  group.add(startMarker)
}

const addPathSegment = (
  group: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: number,
  opacity: number,
  width: number,
  showDirection: boolean
) => {
  const direction = end.clone().sub(start)
  const length = direction.length()
  if (length < 1e-6) return
  direction.normalize()

  const geometry = new THREE.CylinderGeometry(width, width, length, 8, 1, true)
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  })
  const segment = new THREE.Mesh(geometry, material)
  segment.position.copy(start).add(end).multiplyScalar(0.5)
  segment.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction
  )
  segment.renderOrder = 4
  group.add(segment)

  if (!showDirection) return
  const arrowGeometry = new THREE.ConeGeometry(width * 3.2, width * 7, 10)
  const arrowMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: Math.min(1, opacity + 0.1),
    depthWrite: false,
  })
  const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial)
  arrow.position.copy(start).lerp(end, 0.72)
  arrow.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction
  )
  arrow.renderOrder = 5
  group.add(arrow)
}

const addPathNode = (
  group: THREE.Group,
  point: THREE.Vector3,
  color: number,
  opacity: number,
  radius: number
) => {
  const geometry = new THREE.SphereGeometry(radius, 12, 8)
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  })
  const marker = new THREE.Mesh(geometry, material)
  marker.position.copy(point)
  marker.renderOrder = 6
  group.add(marker)
}

const addFidelityConnection = (
  group: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: number,
  dashed: boolean
) => {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
  const material = dashed
    ? new THREE.LineDashedMaterial({
        color,
        dashSize: 0.16,
        gapSize: 0.1,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      })
    : new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      })
  const line = new THREE.Line(geometry, material)
  if (dashed) line.computeLineDistances()
  line.renderOrder = 2
  group.add(line)

  const markerGeometry = new THREE.SphereGeometry(0.06, 10, 7)
  const markerMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
  const marker = new THREE.Mesh(markerGeometry, markerMaterial)
  marker.position.copy(end)
  marker.renderOrder = 3
  group.add(marker)
}

export const Umap3DScene = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const resetCameraRef = useRef<() => void>(() => undefined)
  const focusImageRef = useRef<(imageId: number) => void>(() => undefined)
  const pointCloudsRef = useRef<THREE.Points[]>([])
  const selectedIdsRef = useRef<string[]>([])
  const pointsByIdRef = useRef(new Map<number, THREE.Vector3>())
  const itemsByIdRef = useRef(new Map<number, ProjectedImage>())
  const conceptAxisGroupRef = useRef<THREE.Group | null>(null)
  const analysisGroupRef = useRef<THREE.Group | null>(null)
  const fidelityGroupRef = useRef<THREE.Group | null>(null)
  const [atlasMeta, setAtlasMeta] = useState<AtlasMeta>({})
  const selectedIds = useAtomValue(selectedEmbeddingIdsAtom)
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const displaySettings = useAtomValue(displaySettingsAtom)
  const projection = useAtomValue(loadableProjectedEmbeddings3dAtom)
  const fidelitySettings = useAtomValue(neighborFidelitySettingsAtom)
  const fidelityResult = useAtomValue(neighborFidelityResultAtom)
  const conceptAxisEnabled = useAtomValue(conceptAxisEnabledAtom)
  const conceptLensResult = useAtomValue(conceptLensResultAtom)
  const conceptLensThreshold = useAtomValue(conceptLensThresholdAtom)
  const explanationOpen = useAtomValue(explanationPanelOpenAtom)
  const explanationTab = useAtomValue(explanationTabAtom)
  const xaiImageFocusRequest = useAtomValue(xaiImageFocusRequestAtom)
  const analysisResult = useAtomValue(anchorAnalysisResultAtom)
  const analysisTab = useAtomValue(anchorAnalysisTabAtom)
  const graphMode = useAtomValue(anchorGraphModeAtom)
  const comparePaths = useAtomValue(anchorAnalysisCompareAtom)
  const trayOpen = useAtomValue(anchorAnalysisTrayOpenAtom)
  const trayCollapsed = useAtomValue(anchorAnalysisTrayCollapsedAtom)
  const trayHeight = useAtomValue(anchorAnalysisTrayHeightAtom)
  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const setSelectedEmbeddingIds = useSetAtom(selectedEmbeddingIdsAtom)
  const lensStateRef = useRef<{
    result: ConceptLensResponse | null
    threshold: number
  }>({ result: null, threshold: 75 })
  lensStateRef.current = {
    result:
      explanationOpen && explanationTab === 'concept'
        ? conceptLensResult
        : null,
    threshold: conceptLensThreshold,
  }

  const projectedItems = useMemo(
    () =>
      projection.state === 'hasData'
        ? (projection.data as ProjectedImage[])
        : [],
    [projection]
  )
  useNeighborFidelity(projectedItems, projection.state === 'hasData')
  useConceptLens(projectedItems, projection.state === 'hasData')
  useEffect(() => {
    if (xaiImageFocusRequest) {
      focusImageRef.current(xaiImageFocusRequest.imageId)
    }
  }, [xaiImageFocusRequest])
  const candidateIds = useMemo(
    () => projectedItems.map((item) => Number(item.id)),
    [projectedItems]
  )
  const trayEmbeddings = useMemo(
    () =>
      projectedItems.map((item) => ({
        ...item,
        type: 'image',
      })),
    [projectedItems]
  )
  const analysisPaths = useMemo(
    () =>
      getAnchorAnalysisDisplayPaths(
        analysisResult,
        analysisTab,
        graphMode,
        comparePaths
      ),
    [analysisResult, analysisTab, comparePaths, graphMode]
  )
  const trayOffset = trayOpen ? (trayCollapsed ? 52 : trayHeight) : 0

  const clearSelection = useCallback(() => {
    setSelectedEmbedding(null)
    setSelectedEmbeddingIds([])
  }, [setSelectedEmbedding, setSelectedEmbeddingIds])

  const navigateToImage = useCallback(
    (imageId: number) => {
      const item = itemsByIdRef.current.get(imageId)
      setSelectedEmbeddingIds([String(imageId)])
      setSelectedEmbedding({ id: imageId, meta: item?.meta ?? {} })
      focusImageRef.current(imageId)
    },
    [setSelectedEmbedding, setSelectedEmbeddingIds]
  )

  selectedIdsRef.current = selectedIds

  const applyConceptLensToClouds = useCallback(
    (clouds: THREE.Points[] = pointCloudsRef.current) => {
      const { result, threshold } = lensStateRef.current
      const conceptIds =
        result?.concepts.map((concept) => concept.concept_id) ?? []
      const records = new Map(
        (result?.images ?? []).map((image) => [image.image_id, image])
      )
      const maximumAbsoluteDelta = Math.max(
        0,
        ...(result?.images.map((image) =>
          Math.abs(image.comparison_delta ?? 0)
        ) ?? [])
      )

      clouds.forEach((cloud) => {
        const userData = cloud.userData as PointCloudUserData
        userData.ids.forEach((id, index) => {
          const record = records.get(id)
          if (!record || conceptIds.length === 0) {
            userData.lensColorAttribute.setXYZ(index, 1, 1, 1)
            userData.lensAlphaAttribute.setX(index, 1)
            userData.lensActiveAttribute.setX(index, 0)
            return
          }
          const visual = conceptLensVisual(
            record,
            conceptIds,
            threshold,
            maximumAbsoluteDelta
          )
          const color = new THREE.Color(visual.tint)
          userData.lensColorAttribute.setXYZ(index, color.r, color.g, color.b)
          userData.lensAlphaAttribute.setX(index, visual.alpha)
          userData.lensActiveAttribute.setX(index, 1)
        })
        userData.lensColorAttribute.needsUpdate = true
        userData.lensAlphaAttribute.needsUpdate = true
        userData.lensActiveAttribute.needsUpdate = true
      })
    },
    []
  )

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
    applyConceptLensToClouds()
  }, [
    applyConceptLensToClouds,
    conceptLensResult,
    conceptLensThreshold,
    explanationOpen,
    explanationTab,
    projectedItems,
  ])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !datasetId || projection.state !== 'hasData') return

    const items = projectedItems
    let disposed = false
    let frame = 0
    let cameraTransition: CameraTransition | null = null
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x07090e)
    scene.fog = new THREE.FogExp2(0x07090e, 0.018)
    const conceptAxisGroup = new THREE.Group()
    const analysisGroup = new THREE.Group()
    const fidelityGroup = new THREE.Group()
    scene.add(conceptAxisGroup)
    scene.add(fidelityGroup)
    scene.add(analysisGroup)
    conceptAxisGroupRef.current = conceptAxisGroup
    fidelityGroupRef.current = fidelityGroup
    analysisGroupRef.current = analysisGroup

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

    const focusImage = (imageId: number) => {
      const point = normalizedPoints.get(imageId)
      if (!point) return
      const targetFrom = controls.target.clone()
      const targetTo = point.clone()
      const cameraFrom = camera.position.clone()
      const cameraTo = cameraFrom.clone().add(targetTo).sub(targetFrom)
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        controls.target.copy(targetTo)
        camera.position.copy(cameraTo)
        controls.update()
        return
      }
      cameraTransition = {
        startedAt: performance.now(),
        duration: 650,
        cameraFrom,
        cameraTo,
        targetFrom,
        targetTo,
      }
    }
    focusImageRef.current = focusImage
    const cancelCameraTransition = () => {
      cameraTransition = null
    }
    controls.addEventListener('start', cancelCameraTransition)

    const textureLoader = new THREE.TextureLoader()
    const resources: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = []
    const textures: THREE.Texture[] = []

    const buildClouds = async () => {
      const atlasMeta = (await fetchAtlasMeta(datasetId)) as AtlasMeta
      if (disposed) return
      setAtlasMeta(atlasMeta)

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
        const lensColors = new Float32Array(sheetItems.length * 3)
        lensColors.fill(1)
        const lensAlphas = new Float32Array(sheetItems.length)
        lensAlphas.fill(1)
        const lensActive = new Float32Array(sheetItems.length)

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
        const lensColorAttribute = new THREE.BufferAttribute(lensColors, 3)
        const lensAlphaAttribute = new THREE.BufferAttribute(lensAlphas, 1)
        const lensActiveAttribute = new THREE.BufferAttribute(lensActive, 1)
        geometry.setAttribute('selected', selectedAttribute)
        geometry.setAttribute('matched', new THREE.BufferAttribute(matched, 1))
        geometry.setAttribute('lensColor', lensColorAttribute)
        geometry.setAttribute('lensAlpha', lensAlphaAttribute)
        geometry.setAttribute('lensActive', lensActiveAttribute)

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
          lensColorAttribute,
          lensAlphaAttribute,
          lensActiveAttribute,
        } satisfies PointCloudUserData
        pointCloudsRef.current.push(cloud)
        applyConceptLensToClouds([cloud])
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

    const animate = (time: number) => {
      if (cameraTransition) {
        const progress = Math.min(
          1,
          (time - cameraTransition.startedAt) / cameraTransition.duration
        )
        const eased =
          progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2
        camera.position.lerpVectors(
          cameraTransition.cameraFrom,
          cameraTransition.cameraTo,
          eased
        )
        controls.target.lerpVectors(
          cameraTransition.targetFrom,
          cameraTransition.targetTo,
          eased
        )
        if (progress >= 1) cameraTransition = null
      }
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      controls.removeEventListener('start', cancelCameraTransition)
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
      clearObjectGroup(conceptAxisGroup)
      clearObjectGroup(analysisGroup)
      clearObjectGroup(fidelityGroup)
      if (conceptAxisGroupRef.current === conceptAxisGroup) {
        conceptAxisGroupRef.current = null
      }
      if (analysisGroupRef.current === analysisGroup) {
        analysisGroupRef.current = null
      }
      if (fidelityGroupRef.current === fidelityGroup) {
        fidelityGroupRef.current = null
      }
      if (focusImageRef.current === focusImage) {
        focusImageRef.current = () => undefined
      }
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [
    clearSelection,
    applyConceptLensToClouds,
    datasetId,
    displaySettings.scale,
    projection.state,
    projectedItems,
    setSelectedEmbedding,
    setSelectedEmbeddingIds,
  ])

  useEffect(() => {
    const group = conceptAxisGroupRef.current
    if (!group) return
    clearObjectGroup(group)
    const axis = conceptLensResult?.axis
    if (
      !conceptAxisEnabled ||
      !explanationOpen ||
      explanationTab !== 'concept' ||
      !axis?.available ||
      axis.dimension !== 3 ||
      axis.start.length !== 3 ||
      axis.end.length !== 3
    ) {
      return
    }

    addConceptAxis(
      group,
      normalizeProjectionPoint(projectedItems, axis.start),
      normalizeProjectionPoint(projectedItems, axis.end),
      axis.mode === 'contrast'
    )
    return () => clearObjectGroup(group)
  }, [
    conceptAxisEnabled,
    conceptLensResult,
    explanationOpen,
    explanationTab,
    projectedItems,
  ])

  useEffect(() => {
    const group = fidelityGroupRef.current
    if (!group) return
    clearObjectGroup(group)
    if (!fidelitySettings.enabled || !fidelityResult) return

    const start = pointsByIdRef.current.get(fidelityResult.selected_image_id)
    if (!start) return
    const addRecords = (
      records: typeof fidelityResult.neighbors.preserved,
      color: number,
      dashed: boolean
    ) => {
      records.forEach((record) => {
        const end = pointsByIdRef.current.get(record.image_id)
        if (end) addFidelityConnection(group, start, end, color, dashed)
      })
    }
    addRecords(fidelityResult.neighbors.preserved, 0x22c55e, false)
    addRecords(fidelityResult.neighbors.projection_only, 0xef4444, false)
    addRecords(fidelityResult.neighbors.clip_only, 0x38bdf8, true)

    return () => clearObjectGroup(group)
  }, [fidelityResult, fidelitySettings.enabled, projectedItems])

  useEffect(() => {
    const group = analysisGroupRef.current
    if (!group) return
    clearObjectGroup(group)

    analysisPaths.forEach((path) => {
      const points = path.ids
        .map((id) => pointsByIdRef.current.get(Number(id)))
        .filter((point): point is THREE.Vector3 => !!point)
      const opacity = comparePaths ? 0.5 : 0.88
      const width = comparePaths ? 0.018 : 0.028
      points.forEach((point, index) => {
        addPathNode(
          group,
          point,
          path.color,
          opacity,
          comparePaths ? 0.055 : 0.075
        )
        if (index === 0) return
        addPathSegment(
          group,
          points[index - 1],
          point,
          path.color,
          opacity,
          width,
          !comparePaths
        )
      })
    })

    return () => clearObjectGroup(group)
  }, [analysisPaths, comparePaths, displaySettings.scale, projectedItems])

  const isLoading = projection.state === 'loading'
  const hasError = projection.state === 'hasError'

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#07090e]">
      <div
        ref={containerRef}
        className="absolute top-0 right-0 left-0"
        style={{ bottom: trayOffset }}
      />
      <HomeLogoLink />
      <HUD
        canFitProjection={projectedItems.length > 0}
        onFitProjection={() => resetCameraRef.current()}
        candidateIds={candidateIds}
        bottomOffset={trayOffset}
      />
      <Panel />
      <div
        className="glass-panel absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 text-xs text-white"
        style={{ bottom: 20 + trayOffset }}
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
      <AnchorAnalysisTray
        candidateIds={candidateIds}
        rawEmbeddings={trayEmbeddings}
        atlasMeta={atlasMeta}
        onNavigateImage={navigateToImage}
      />
    </div>
  )
}
