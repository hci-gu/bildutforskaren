import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  clusterFocusRequestAtom,
  clusterProfilesAlgorithmAtom,
  clusterProfilesErrorAtom,
  clusterProfilesResultAtom,
  clusterProfilesStatusAtom,
  conceptAxisEnabledAtom,
  conceptLensErrorAtom,
  conceptLensResultAtom,
  conceptLensSelectionAtom,
  conceptLensStatusAtom,
  conceptLensThresholdAtom,
  explanationPanelOpenAtom,
  explanationRegionRevealRequestAtom,
  explanationTabAtom,
  loadableProjectedEmbeddingsAtom,
  projectionSettingsAtom,
  projectionStabilityErrorAtom,
  projectionStabilityResultAtom,
  projectionStabilityStatusAtom,
  projectionViewModeAtom,
  selectedEmbeddingAtom,
  selectedEmbeddingIdsAtom,
  selectedExplainedClusterAtom,
  selectedStabilityClusterAtom,
  stabilityClusterFocusRequestAtom,
  xaiImageFocusRequestAtom,
} from '@/store'
import {
  datasetApiUrl,
  fetchClusterProfiles,
  searchSaoTerms,
} from '@/shared/lib/api'
import type {
  ClusterProfileConcept,
  ExplainedCluster,
  SaoConceptMetadata,
} from '@/shared/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Slider } from '@/shared/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { CLUSTER_COLORS, colorToCss } from '../xaiVisuals'

type SearchTerm = {
  id: string
  label: string
  scope_note?: string
}

type ProjectedItem = {
  id: string | number
  point?: [number, number]
  type?: string
  meta?: Record<string, unknown>
}

type ClusterParameters = {
  kmeansMaxClusters: number
  kmeansRandomState: number
  kmeansLevels: number
  dbscanEps: number
  dbscanMinSamples: number
  hdbscanMinClusterSize: number
  hdbscanMinSamples: number
  hdbscanSelectionEpsilon: number
  hdbscanAllowSingleCluster: boolean
}

const ConceptPicker = ({
  label,
  selected,
  excludedId,
  onSelect,
  onClear,
}: {
  label: string
  selected: SaoConceptMetadata | null
  excludedId?: string
  onSelect: (concept: SaoConceptMetadata) => void
  onClear: () => void
}) => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchTerm[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!query.trim() || selected) {
      setResults([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      searchSaoTerms(query.trim(), 12)
        .then((items) => {
          if (cancelled) return
          setResults(
            (items as SearchTerm[]).filter((item) => item.id !== excludedId)
          )
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [excludedId, query, selected])

  if (selected) {
    return (
      <div className="rounded-md border border-white/15 bg-black/20 p-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-white/45">
              {label}
            </div>
            <div className="text-sm font-medium">{selected.label}</div>
            {selected.scope_note && (
              <div className="mt-1 text-[11px] text-white/55">
                {selected.scope_note}
              </div>
            )}
          </div>
          <button
            type="button"
            className="text-sm text-white/55 hover:text-white"
            onClick={() => {
              onClear()
              setQuery('')
            }}
            aria-label={`Ta bort ${selected.label}`}
          >
            ×
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-white/45">
        {label}
      </div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Sök svenska SAO-termer…"
        className="border-white/20 bg-black/25"
      />
      {loading && <div className="text-[11px] text-white/50">Söker…</div>}
      {results.length > 0 && (
        <div className="max-h-44 overflow-y-auto rounded-md border border-white/15 bg-[#111722]">
          {results.map((term) => (
            <button
              key={term.id}
              type="button"
              className="block w-full border-b border-white/10 px-2 py-2 text-left last:border-0 hover:bg-white/10"
              title={term.scope_note || undefined}
              onClick={() => {
                onSelect({
                  concept_id: term.id,
                  label: term.label,
                  scope_note: term.scope_note ?? '',
                })
                setQuery('')
                setResults([])
              }}
            >
              <div className="text-xs font-medium">{term.label}</div>
              {term.scope_note && (
                <div className="line-clamp-2 text-[10px] text-white/45">
                  {term.scope_note}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const scoreText = (value: number) =>
  `${value >= 0 ? '+' : ''}${value.toFixed(3)}`

const stabilityColor = (stability: number) =>
  stability >= 0.8 ? '#22c55e' : stability >= 0.6 ? '#f59e0b' : '#ef4444'

const ConceptRankings = ({
  concept,
}: {
  concept: SaoConceptMetadata
}) => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const result = useAtomValue(conceptLensResultAtom)
  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const setSelectedIds = useSetAtom(selectedEmbeddingIdsAtom)
  const setFocusRequest = useSetAtom(xaiImageFocusRequestAtom)
  const ranked = useMemo(
    () =>
      [...(result?.images ?? [])]
        .filter((image) => image.scores[concept.concept_id])
        .sort(
          (a, b) =>
            b.scores[concept.concept_id].similarity -
              a.scores[concept.concept_id].similarity ||
            a.image_id - b.image_id
        )
        .slice(0, 10),
    [concept.concept_id, result]
  )

  if (!datasetId || ranked.length === 0) return null
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold">{concept.label}: starkast</div>
      <div className="max-h-52 space-y-1 overflow-y-auto">
        {ranked.map((image, index) => {
          const score = image.scores[concept.concept_id]
          return (
            <button
              key={image.image_id}
              type="button"
              className="flex w-full items-center gap-2 rounded border border-white/10 bg-black/20 p-1 text-left hover:bg-white/10"
              onClick={() => {
                setSelectedIds([String(image.image_id)])
                setSelectedEmbedding({ id: image.image_id, meta: {} })
                setFocusRequest({
                  imageId: image.image_id,
                  requestId: Date.now(),
                })
              }}
            >
              <img
                src={datasetApiUrl(datasetId, `/image/${image.image_id}`)}
                className="h-9 w-9 rounded object-cover"
                alt=""
              />
              <div className="min-w-0 flex-1">
                <div className="text-[11px]">
                  {index + 1}. Bild {image.image_id}
                </div>
                <div className="text-[10px] text-white/50">
                  {score.similarity.toFixed(3)} ·{' '}
                  {Math.round(score.percentile * 100)} percentil
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const ProfileList = ({
  title,
  concepts,
}: {
  title: string
  concepts: ClusterProfileConcept[]
}) => (
  <div className="space-y-1">
    <div className="text-xs font-semibold">{title}</div>
    {concepts.length === 0 ? (
      <div className="text-[11px] text-white/45">
        Inga tillräckligt relevanta begrepp.
      </div>
    ) : (
      concepts.slice(0, 3).map((concept) => (
        <div
          key={concept.concept_id}
          className="rounded border border-white/10 bg-black/20 px-2 py-1.5"
          title={concept.scope_note || undefined}
        >
          <div className="flex justify-between gap-2 text-[11px]">
            <span>{concept.label}</span>
            <span
              className={
                concept.delta > 0 ? 'text-sky-300' : 'text-orange-300'
              }
            >
              {scoreText(concept.delta)}
            </span>
          </div>
          <div className="text-[10px] text-white/45">
            Kluster {concept.cluster_score.toFixed(3)} · urval{' '}
            {concept.baseline_score.toFixed(3)}
          </div>
        </div>
      ))
    )}
  </div>
)

export const ExplanationPanel = () => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const projectionSettings = useAtomValue(projectionSettingsAtom)
  const viewMode = useAtomValue(projectionViewModeAtom)
  const projection = useAtomValue(loadableProjectedEmbeddingsAtom('main'))
  const [open, setOpen] = useAtom(explanationPanelOpenAtom)
  const regionRevealRequest = useAtomValue(
    explanationRegionRevealRequestAtom
  )
  const [tab, setTab] = useAtom(explanationTabAtom)
  const [selection, setSelection] = useAtom(conceptLensSelectionAtom)
  const [threshold, setThreshold] = useAtom(conceptLensThresholdAtom)
  const [axisEnabled, setAxisEnabled] = useAtom(conceptAxisEnabledAtom)
  const lensResult = useAtomValue(conceptLensResultAtom)
  const lensStatus = useAtomValue(conceptLensStatusAtom)
  const lensError = useAtomValue(conceptLensErrorAtom)
  const stabilityResult = useAtomValue(projectionStabilityResultAtom)
  const stabilityStatus = useAtomValue(projectionStabilityStatusAtom)
  const stabilityError = useAtomValue(projectionStabilityErrorAtom)
  const [selectedStabilityCluster, setSelectedStabilityCluster] = useAtom(
    selectedStabilityClusterAtom
  )
  const setStabilityFocus = useSetAtom(stabilityClusterFocusRequestAtom)
  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const setSelectedIds = useSetAtom(selectedEmbeddingIdsAtom)
  const setFocusRequest = useSetAtom(xaiImageFocusRequestAtom)
  const [algorithm, setAlgorithm] = useAtom(clusterProfilesAlgorithmAtom)
  const [clusterParameters, setClusterParameters] = useState<ClusterParameters>({
    kmeansMaxClusters: 9,
    kmeansRandomState: 1999,
    kmeansLevels: 4,
    dbscanEps: 0.5,
    dbscanMinSamples: 5,
    hdbscanMinClusterSize: 5,
    hdbscanMinSamples: 5,
    hdbscanSelectionEpsilon: 0,
    hdbscanAllowSingleCluster: false,
  })
  const [clusterResult, setClusterResult] = useAtom(clusterProfilesResultAtom)
  const [clusterStatus, setClusterStatus] = useAtom(clusterProfilesStatusAtom)
  const [clusterError, setClusterError] = useAtom(clusterProfilesErrorAtom)
  const [selectedClusterId, setSelectedClusterId] = useAtom(
    selectedExplainedClusterAtom
  )
  const setClusterFocus = useSetAtom(clusterFocusRequestAtom)
  const controllerRef = useRef<AbortController | null>(null)
  const clusterItemRefs = useRef(new Map<number, HTMLButtonElement>())
  const stabilityItemRefs = useRef(new Map<number, HTMLButtonElement>())
  const previousUniverseKey = useRef<string | null>(null)

  const projectedItems = useMemo(
    () =>
      projection.state === 'hasData'
        ? (projection.data as ProjectedItem[]).filter(
            (item) =>
              item.type === 'image' &&
              Array.isArray(item.point) &&
              item.point.length === 2 &&
              item.point.every(Number.isFinite)
          )
        : [],
    [projection]
  )
  const universeKey = useMemo(
    () =>
      [
        datasetId,
        projectionSettings.type,
        viewMode,
        projectionSettings.nNeighbors,
        projectionSettings.minDist,
        projectionSettings.spread,
        projectionSettings.seed,
        algorithm,
        JSON.stringify(clusterParameters),
        projectedItems.map((item) => item.id).join(','),
      ].join(':'),
    [
      algorithm,
      clusterParameters,
      datasetId,
      projectedItems,
      projectionSettings,
      viewMode,
    ]
  )

  const clearClusters = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setClusterResult(null)
    setClusterStatus('idle')
    setClusterError(null)
    setSelectedClusterId(null)
  }, [
    setClusterError,
    setClusterResult,
    setClusterStatus,
    setSelectedClusterId,
  ])

  useEffect(() => {
    if (
      previousUniverseKey.current !== null &&
      previousUniverseKey.current !== universeKey
    ) {
      clearClusters()
    }
    previousUniverseKey.current = universeKey
  }, [clearClusters, universeKey])

  useEffect(
    () => () => {
      controllerRef.current?.abort()
    },
    []
  )

  const calculateClusters = async () => {
    if (!datasetId || viewMode !== '2d' || projectedItems.length < 2) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setClusterResult(null)
    setSelectedClusterId(null)
    setClusterStatus('loading')
    setClusterError(null)
    try {
      const parameters =
        algorithm === 'kmeans'
          ? {
              max_clusters: clusterParameters.kmeansMaxClusters,
              random_state: clusterParameters.kmeansRandomState,
            }
          : algorithm === 'dbscan'
            ? {
                eps: clusterParameters.dbscanEps,
                min_samples: clusterParameters.dbscanMinSamples,
              }
            : {
                min_cluster_size: clusterParameters.hdbscanMinClusterSize,
                min_samples: clusterParameters.hdbscanMinSamples,
                cluster_selection_epsilon:
                  clusterParameters.hdbscanSelectionEpsilon,
                allow_single_cluster:
                  clusterParameters.hdbscanAllowSingleCluster,
              }
      const result = await fetchClusterProfiles(
        datasetId,
        {
          image_ids: projectedItems.map((item) => Number(item.id)),
          projection_points: projectedItems.map(
            (item) => [...(item.point ?? [0, 0])] as [number, number]
          ),
          clustering: { algorithm, parameters },
          levels:
            algorithm === 'kmeans' ? clusterParameters.kmeansLevels : 1,
        },
        controller.signal
      )
      if (controller.signal.aborted) return
      setClusterResult(result)
      const largest = [...result.clusters].sort(
        (a, b) => b.image_count - a.image_count || a.cluster_id - b.cluster_id
      )[0]
      setSelectedClusterId(largest?.cluster_id ?? null)
      setClusterStatus('ready')
    } catch (error) {
      if (controller.signal.aborted) return
      setClusterResult(null)
      setClusterStatus('error')
      setClusterError(
        error instanceof Error
          ? error.message
          : 'Kunde inte beräkna klusterprofiler.'
      )
    }
  }

  const selectedCluster: ExplainedCluster | null =
    clusterResult?.clusters.find(
      (cluster) => cluster.cluster_id === selectedClusterId
    ) ?? null
  const sortedStabilityClusters = useMemo(
    () =>
      [...(stabilityResult?.clusters ?? [])].sort(
        (a, b) => b.stability - a.stability || a.cluster_id - b.cluster_id
      ),
    [stabilityResult]
  )

  useEffect(() => {
    if (!open || tab !== 'cluster' || selectedClusterId === null) return
    const frame = requestAnimationFrame(() => {
      clusterItemRefs.current
        .get(selectedClusterId)
        ?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, selectedClusterId, tab])

  useEffect(() => {
    if (!open || tab !== 'stability' || selectedStabilityCluster === null) return
    const frame = requestAnimationFrame(() => {
      stabilityItemRefs.current
        .get(selectedStabilityCluster)
        ?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, selectedStabilityCluster, tab])

  useEffect(() => {
    if (!open || !regionRevealRequest || regionRevealRequest.tab !== tab) return
    const refs =
      tab === 'cluster' ? clusterItemRefs.current : stabilityItemRefs.current
    const frame = requestAnimationFrame(() => {
      refs
        .get(regionRevealRequest.clusterId)
        ?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, regionRevealRequest, tab])

  if (projectionSettings.type !== 'umap') return null

  const panelRight = 'calc(16.6667% + 1.5rem)'
  if (!open) {
    return (
      <Button
        type="button"
        className="glass-panel absolute top-4 z-20 h-11 px-5 text-base text-white shadow-lg hover:bg-white/15"
        style={{ right: panelRight }}
        onClick={() => setOpen(true)}
        data-canvas-ui="true"
      >
        Förklaring (XAI)
      </Button>
    )
  }

  return (
    <Card
      className="glass-panel absolute top-4 z-20 w-[380px] gap-3 py-3 text-white shadow-xl"
      style={{ right: panelRight, maxHeight: 'calc(100vh - 2rem)' }}
      data-canvas-ui="true"
    >
      <CardHeader className="flex items-start justify-between px-3">
        <CardTitle className="pt-1">Förklaring</CardTitle>
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md bg-red-500/20 text-lg leading-none text-red-300 transition hover:bg-red-500/35 hover:text-red-100"
          onClick={() => setOpen(false)}
          aria-label="Stäng förklaringspanelen"
        >
          ×
        </button>
      </CardHeader>
      <CardContent className="overflow-y-auto px-3 pb-0">
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setTab(value as 'concept' | 'cluster' | 'stability')
          }
        >
          <TabsList className="grid w-full grid-cols-3 bg-black/25">
            <TabsTrigger value="concept">Begrepp</TabsTrigger>
            <TabsTrigger value="cluster">Kluster</TabsTrigger>
            <TabsTrigger value="stability">Stabilitet</TabsTrigger>
          </TabsList>

          <TabsContent value="concept" className="space-y-3">
            <ConceptPicker
              label="Begrepp A"
              selected={selection.a}
              excludedId={selection.b?.concept_id}
              onSelect={(concept) =>
                setSelection((previous) => ({ ...previous, a: concept }))
              }
              onClear={() => setSelection({ a: null, b: null })}
            />
            {selection.a && (
              <ConceptPicker
                label="Jämför med begrepp B (valfritt)"
                selected={selection.b}
                excludedId={selection.a.concept_id}
                onSelect={(concept) =>
                  setSelection((previous) => ({ ...previous, b: concept }))
                }
                onClear={() =>
                  setSelection((previous) => ({ ...previous, b: null }))
                }
              />
            )}

            {selection.a && (
              <div className="space-y-2 rounded-md border border-white/10 bg-black/15 p-2">
                <div className="flex justify-between text-xs">
                  <span>Visa från percentil</span>
                  <span>{threshold}</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[threshold]}
                  onValueChange={(values) => setThreshold(values[0] ?? 75)}
                />
                <div
                  className="h-2 rounded"
                  style={{
                    background: selection.b
                      ? 'linear-gradient(90deg, #fb923c, #b8bec9, #38bdf8)'
                      : 'linear-gradient(90deg, #440154, #21918c, #fde725)',
                  }}
                />
                <div className="text-[10px] text-white/50">
                  {selection.b
                    ? `${selection.b.label} ← liknande → ${selection.a.label}`
                    : 'Låg semantisk likhet ← → hög semantisk likhet'}
                </div>
                <div className="border-t border-white/10 pt-2">
                  <button
                    type="button"
                    className={`flex w-full items-center justify-between rounded border px-2 py-1.5 text-xs transition ${
                      axisEnabled
                        ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-100'
                        : 'border-white/15 bg-black/20 text-white/70 hover:bg-white/10'
                    }`}
                    aria-pressed={axisEnabled}
                    title="En linjär riktning anpassad i den aktuella UMAP-projektionen, inte en huvudkomponent i CLIP-rummet."
                    onClick={() => setAxisEnabled((enabled) => !enabled)}
                  >
                    <span>Visa konceptaxel</span>
                    <span>{axisEnabled ? 'På' : 'Av'}</span>
                  </button>
                  {lensResult?.axis.available && (
                    <div className="mt-1.5 flex gap-3 text-[10px] text-white/55">
                      <span>R² {lensResult.axis.r_squared.toFixed(2)}</span>
                      <span>
                        Stabilitet{' '}
                        {Math.round(lensResult.axis.stability * 100)} %
                      </span>
                    </div>
                  )}
                  {lensResult && !lensResult.axis.available && (
                    <div className="mt-1.5 text-[10px] text-white/45">
                      Ingen stabil rak axel kunde anpassas till bildmolnet.
                    </div>
                  )}
                  {lensResult?.axis.available && (
                    <div className="mt-1 text-[10px] text-white/45">
                      {selection.b
                        ? `${selection.b.label} → ${selection.a.label}`
                        : `Lägre → högre ${selection.a.label}`}
                    </div>
                  )}
                </div>
              </div>
            )}

            {lensStatus === 'loading' && (
              <div className="text-xs text-white/55">Beräknar begreppslins…</div>
            )}
            {lensStatus === 'error' && (
              <div className="text-xs text-red-300">{lensError}</div>
            )}
            {lensResult &&
              lensResult.concepts.map((concept) => (
                <ConceptRankings key={concept.concept_id} concept={concept} />
              ))}
          </TabsContent>

          <TabsContent value="cluster" className="space-y-3">
            {viewMode === '3d' ? (
              <div className="rounded-md border border-white/10 bg-black/20 p-3 text-xs text-white/60">
                Klusterprofiler är tillgängliga i 2D-UMAP. Begreppslinsen kan
                fortfarande användas i 3D.
              </div>
            ) : (
              <>
                <p className="text-[11px] text-white/55">
                  Medlemskap bestäms i 2D-UMAP. Profilerna beräknas från
                  bildernas fullständiga CLIP-inbäddningar.
                </p>
                <Select
                  value={algorithm}
                  onValueChange={(value: 'kmeans' | 'dbscan' | 'hdbscan') => {
                    setAlgorithm(value)
                    clearClusters()
                  }}
                >
                  <SelectTrigger className="w-full border-white/20 bg-black/25">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hdbscan">HDBSCAN</SelectItem>
                    <SelectItem value="dbscan">DBSCAN</SelectItem>
                    <SelectItem value="kmeans">K-means</SelectItem>
                  </SelectContent>
                </Select>
                {algorithm === 'kmeans' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Label className="space-y-1 text-[11px]">
                      <span>Max kluster</span>
                      <Input
                        type="number"
                        min={2}
                        step={1}
                        value={clusterParameters.kmeansMaxClusters}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber
                          if (!Number.isFinite(value)) return
                          setClusterParameters((previous) => ({
                            ...previous,
                            kmeansMaxClusters: Math.max(2, Math.round(value)),
                          }))
                        }}
                        className="h-8 border-white/20 bg-black/25"
                      />
                    </Label>
                    <Label className="space-y-1 text-[11px]">
                      <span>Underklusternivåer</span>
                      <Input
                        type="number"
                        min={1}
                        max={6}
                        step={1}
                        value={clusterParameters.kmeansLevels}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber
                          if (!Number.isFinite(value)) return
                          setClusterParameters((previous) => ({
                            ...previous,
                            kmeansLevels: Math.max(
                              1,
                              Math.min(6, Math.round(value))
                            ),
                          }))
                        }}
                        className="h-8 border-white/20 bg-black/25"
                      />
                    </Label>
                    <Label className="space-y-1 text-[11px]">
                      <span>Slumpfrö</span>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={clusterParameters.kmeansRandomState}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber
                          if (!Number.isFinite(value)) return
                          setClusterParameters((previous) => ({
                            ...previous,
                            kmeansRandomState: Math.max(0, Math.round(value)),
                          }))
                        }}
                        className="h-8 border-white/20 bg-black/25"
                      />
                    </Label>
                  </div>
                )}
                {algorithm === 'dbscan' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Label className="space-y-1 text-[11px]">
                      <span>Epsilon</span>
                      <Input
                        type="number"
                        min={0.001}
                        step={0.05}
                        value={clusterParameters.dbscanEps}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber
                          if (!Number.isFinite(value)) return
                          setClusterParameters((previous) => ({
                            ...previous,
                            dbscanEps: Math.max(0.001, value),
                          }))
                        }}
                        className="h-8 border-white/20 bg-black/25"
                      />
                    </Label>
                    <Label className="space-y-1 text-[11px]">
                      <span>Minsta antal punkter</span>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={clusterParameters.dbscanMinSamples}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber
                          if (!Number.isFinite(value)) return
                          setClusterParameters((previous) => ({
                            ...previous,
                            dbscanMinSamples: Math.max(1, Math.round(value)),
                          }))
                        }}
                        className="h-8 border-white/20 bg-black/25"
                      />
                    </Label>
                  </div>
                )}
                {algorithm === 'hdbscan' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Label className="space-y-1 text-[11px]">
                      <span>Minsta klusterstorlek</span>
                      <Input
                        type="number"
                        min={2}
                        step={1}
                        value={clusterParameters.hdbscanMinClusterSize}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber
                          if (!Number.isFinite(value)) return
                          setClusterParameters((previous) => ({
                            ...previous,
                            hdbscanMinClusterSize: Math.max(
                              2,
                              Math.round(value)
                            ),
                          }))
                        }}
                        className="h-8 border-white/20 bg-black/25"
                      />
                    </Label>
                    <Label className="space-y-1 text-[11px]">
                      <span>Minsta antal punkter</span>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={clusterParameters.hdbscanMinSamples}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber
                          if (!Number.isFinite(value)) return
                          setClusterParameters((previous) => ({
                            ...previous,
                            hdbscanMinSamples: Math.max(1, Math.round(value)),
                          }))
                        }}
                        className="h-8 border-white/20 bg-black/25"
                      />
                    </Label>
                    <Label className="space-y-1 text-[11px]">
                      <span>Urvals-epsilon</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.05}
                        value={clusterParameters.hdbscanSelectionEpsilon}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber
                          if (!Number.isFinite(value)) return
                          setClusterParameters((previous) => ({
                            ...previous,
                            hdbscanSelectionEpsilon: Math.max(0, value),
                          }))
                        }}
                        className="h-8 border-white/20 bg-black/25"
                      />
                    </Label>
                    <Label className="flex items-center gap-2 self-end pb-2 text-[11px]">
                      <Checkbox
                        checked={
                          clusterParameters.hdbscanAllowSingleCluster
                        }
                        onCheckedChange={(checked) =>
                          setClusterParameters((previous) => ({
                            ...previous,
                            hdbscanAllowSingleCluster: !!checked,
                          }))
                        }
                      />
                      Tillåt ett kluster
                    </Label>
                  </div>
                )}
                <Button
                  type="button"
                  className="w-full"
                  onClick={calculateClusters}
                  disabled={
                    clusterStatus === 'loading' || projectedItems.length < 2
                  }
                >
                  {clusterStatus === 'loading'
                    ? 'Beräknar…'
                    : 'Beräkna kluster'}
                </Button>
                {clusterStatus === 'error' && (
                  <div className="text-xs text-red-300">{clusterError}</div>
                )}
                {clusterResult && clusterResult.clusters.length === 0 && (
                  <div className="text-xs text-white/55">
                    Inga kluster hittades. Alla{' '}
                    {clusterResult.noise_image_ids.length} bilder klassades som
                    brus.
                  </div>
                )}
                {clusterResult && clusterResult.clusters.length > 0 && (
                  <>
                    <div className="max-h-44 space-y-1 overflow-y-auto">
                      {clusterResult.clusters.map((cluster) => {
                        const color =
                          CLUSTER_COLORS[
                            cluster.cluster_id % CLUSTER_COLORS.length
                          ]
                        const selected =
                          cluster.cluster_id === selectedClusterId
                        return (
                          <button
                            key={cluster.cluster_id}
                            ref={(node) => {
                              if (node) {
                                clusterItemRefs.current.set(
                                  cluster.cluster_id,
                                  node
                                )
                              } else {
                                clusterItemRefs.current.delete(
                                  cluster.cluster_id
                                )
                              }
                            }}
                            type="button"
                            className={`w-full rounded border p-2 text-left ${
                              selected
                                ? 'border-white/60 bg-white/15'
                                : 'border-white/10 bg-black/20 hover:bg-white/10'
                            }`}
                            onClick={() => {
                              if (selected) {
                                setClusterFocus({
                                  clusterId: cluster.cluster_id,
                                  requestId: Date.now(),
                                })
                              } else {
                                setSelectedClusterId(cluster.cluster_id)
                              }
                            }}
                          >
                            <div className="flex items-center gap-2 text-xs">
                              <span
                                className="h-3 w-3 rounded-full"
                                style={{ backgroundColor: colorToCss(color) }}
                              />
                              <span className="font-medium">
                                Kluster {cluster.cluster_id + 1}
                              </span>
                              <span className="ml-auto text-white/50">
                                {cluster.image_count} bilder
                              </span>
                            </div>
                            <div className="mt-1 truncate text-[10px] text-white/50">
                              {cluster.profile.strongest
                                .slice(0, 3)
                                .map((concept) => concept.label)
                                .join(' · ')}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                    {clusterResult.noise_image_ids.length > 0 && (
                      <div className="text-[10px] text-white/45">
                        {clusterResult.noise_image_ids.length} bilder ligger
                        utanför klustren.
                      </div>
                    )}
                  </>
                )}

                {selectedCluster && (
                  <div className="space-y-3 border-t border-white/10 pt-3">
                    <ProfileList
                      title="Starkaste SAO-begrepp"
                      concepts={selectedCluster.profile.strongest}
                    />
                    <ProfileList
                      title="Mer framträdande än urvalet"
                      concepts={selectedCluster.profile.more_prominent}
                    />
                    <ProfileList
                      title="Mindre framträdande än urvalet"
                      concepts={selectedCluster.profile.less_prominent}
                    />
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="stability" className="space-y-3">
            {viewMode === '3d' ? (
              <div className="rounded-md border border-white/10 bg-black/20 p-3 text-xs text-white/60">
                Klusterstabilitet visas för 2D-UMAP. Återgå till 2D för att se
                det sparade resultatet.
              </div>
            ) : stabilityStatus === 'error' ? (
              <div className="text-xs text-red-300">
                {stabilityError ?? 'Kunde inte analysera klusterstabiliteten.'}
              </div>
            ) : !stabilityResult ? (
              <div className="rounded-md border border-white/10 bg-black/20 p-3 text-xs text-white/55">
                Starta analysen med knappen Cluster stability analysis i
                projektionsinställningarna.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-white/10 bg-black/20 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-white/45">
                      Övergripande stabilitet
                    </div>
                    <div className="mt-1 text-xl font-semibold">
                      {Math.round(stabilityResult.overall_stability * 100)} %
                    </div>
                  </div>
                  <div className="rounded-md border border-white/10 bg-black/20 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-white/45">
                      Osäkra bilder
                    </div>
                    <div className="mt-1 text-xl font-semibold">
                      {stabilityResult.ambiguous_images.length}
                    </div>
                  </div>
                </div>

                {stabilityResult.clusters.length === 0 ? (
                  <div className="text-xs text-white/55">
                    Referensprojektionen innehöll bara brus och inga stabila
                    regioner kunde visas.
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold">Regioner</div>
                    <div className="max-h-52 space-y-1 overflow-y-auto">
                      {sortedStabilityClusters.map((cluster) => {
                        const selected =
                          cluster.cluster_id === selectedStabilityCluster
                        return (
                          <button
                            key={cluster.cluster_id}
                            ref={(node) => {
                              if (node) {
                                stabilityItemRefs.current.set(
                                  cluster.cluster_id,
                                  node
                                )
                              } else {
                                stabilityItemRefs.current.delete(
                                  cluster.cluster_id
                                )
                              }
                            }}
                            type="button"
                            className={`w-full rounded border p-2 text-left ${
                              selected
                                ? 'border-white/60 bg-white/15'
                                : 'border-white/10 bg-black/20 hover:bg-white/10'
                            }`}
                            onClick={() => {
                              if (selected) {
                                setStabilityFocus({
                                  clusterId: cluster.cluster_id,
                                  requestId: Date.now(),
                                })
                              } else {
                                setSelectedStabilityCluster(cluster.cluster_id)
                              }
                            }}
                          >
                            <div className="flex items-center gap-2 text-xs">
                              <span
                                className="h-3 w-3 rounded-full"
                                style={{
                                  backgroundColor: stabilityColor(
                                    cluster.stability
                                  ),
                                }}
                              />
                              <span className="font-medium">
                                Region {cluster.cluster_id + 1}
                              </span>
                              <span className="ml-auto text-white/55">
                                {Math.round(cluster.stability * 100)} % ·{' '}
                                {cluster.image_count} bilder
                              </span>
                            </div>
                            <div className="mt-1 truncate text-[10px] text-white/50">
                              {cluster.concepts
                                .map((concept) => concept.label)
                                .join(' · ')}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {stabilityResult.ambiguous_images.length > 0 && datasetId && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold">
                      Minst stabila bilder
                    </div>
                    <div className="max-h-52 space-y-1 overflow-y-auto">
                      {stabilityResult.ambiguous_images
                        .slice(0, 10)
                        .map((image) => (
                          <button
                            key={image.image_id}
                            type="button"
                            className="flex w-full items-center gap-2 rounded border border-white/10 bg-black/20 p-1 text-left hover:bg-white/10"
                            onClick={() => {
                              setSelectedIds([String(image.image_id)])
                              setSelectedEmbedding({
                                id: image.image_id,
                                meta: {},
                              })
                              setFocusRequest({
                                imageId: image.image_id,
                                requestId: Date.now(),
                              })
                            }}
                          >
                            <img
                              src={datasetApiUrl(
                                datasetId,
                                `/image/${image.image_id}`
                              )}
                              className="h-9 w-9 rounded object-cover"
                              alt=""
                            />
                            <div className="min-w-0 flex-1 text-[11px]">
                              <div>Bild {image.image_id}</div>
                              <div className="text-[10px] text-white/50">
                                Stabilitet{' '}
                                {Math.round(image.stability * 100)} %
                              </div>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
