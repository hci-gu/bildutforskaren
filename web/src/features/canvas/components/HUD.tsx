import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Focus } from 'lucide-react'
import { PhotoView } from 'react-photo-view'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  activeEmbeddingIdsAtom,
  anchorAnalysisCandidateIdsAtom,
  anchorAnalysisErrorAtom,
  anchorAnalysisResultAtom,
  anchorAnalysisStaleAtom,
  anchorAnalysisStatusAtom,
  anchorAnalysisTrayOpenAtom,
  anchorGroupsAtom,
  graphLayoutAtom,
  graphNetworksAtom,
  projectionSettingsAtom,
  projectionViewModeAtom,
  projectionRevisionAtom,
  selectedEmbeddingAtom,
  selectedEmbeddingIdsAtom,
  selectionHistoryAtom,
  selectedTagsAtom,
} from '@/store'
import {
  createGraphNetwork,
  datasetApiUrl,
  type GraphLayout,
} from '@/shared/lib/api'
import { TaggerPanel } from './TaggerPanel'
import { TagResultsPanel } from './TagResultsPanel'
import {
  MINIMAP_DEAD_ZONE,
  MINIMAP_MARGIN,
  MINIMAP_SIZE,
} from '../constants'
import { useAnchorAnalysis } from '../hooks/useAnchorAnalysis'

const ImageDisplayer = ({ bottomOffset = 0 }: { bottomOffset?: number }) => {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const selectedEmbedding = useAtomValue(selectedEmbeddingAtom)
  const datasetId = useAtomValue(activeDatasetIdAtom)

  useEffect(() => {
    if (buttonRef.current && selectedEmbedding) {
      setTimeout(() => buttonRef.current?.click(), 100)
    }
  }, [selectedEmbedding])

  if (!selectedEmbedding || !datasetId) return null

  const meta = selectedEmbedding.meta || {}
  Object.keys(meta).forEach((key) => {
    if (meta[key] === null || meta[key] === undefined || meta[key] === '') {
      delete meta[key]
    }
    if (typeof meta[key] === 'number') {
      meta[key] = Math.round(meta[key] * 100) / 100
    }
  })

  return (
    <>
      <PhotoView
        key="active-photo"
        src={datasetApiUrl(datasetId, `/original/${selectedEmbedding.id}`)}
      >
        <button ref={buttonRef} />
      </PhotoView>
      <div className="metadata-panel-anchor" data-has-meta={Object.keys(meta).length > 0 ? '1' : '0'} />
      {Object.keys(meta).length > 0 && (
      <div
        className="glass-panel fixed left-4 z-10000 max-w-sm rounded-lg p-3 text-xs text-white"
        style={{ bottom: 16 + bottomOffset }}
      >
          <div className="mb-2 text-[10px] uppercase tracking-wide text-white/60">
            From metadata
          </div>
          <div className="space-y-1">
            {Object.entries(meta).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <span className="w-24 shrink-0 text-white/60">{key}</span>
                <span className="truncate">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export const HUD = ({
  canFitProjection = false,
  onFitProjection,
  candidateIds = [],
  bottomOffset = 0,
}: {
  canFitProjection?: boolean
  onFitProjection?: () => void
  candidateIds?: number[]
  bottomOffset?: number
} = {}) => {
  const [selectionHistory, setSelectionHistory] = useAtom(selectionHistoryAtom)
  const setActiveEmbeddingIds = useSetAtom(activeEmbeddingIdsAtom)
  const activeEmbeddingIds = useAtomValue(activeEmbeddingIdsAtom)
  const setProjectionRevision = useSetAtom(projectionRevisionAtom)
  const setGraphNetworks = useSetAtom(graphNetworksAtom)
  const setGraphLayout = useSetAtom(graphLayoutAtom)
  const setProjectionSettings = useSetAtom(projectionSettingsAtom)
  const setProjectionViewMode = useSetAtom(projectionViewModeAtom)
  const [anchorGroups, setAnchorGroups] = useAtom(anchorGroupsAtom)
  const setAnchorResult = useSetAtom(anchorAnalysisResultAtom)
  const setAnchorStatus = useSetAtom(anchorAnalysisStatusAtom)
  const setAnchorAnalysisError = useSetAtom(anchorAnalysisErrorAtom)
  const setAnchorStale = useSetAtom(anchorAnalysisStaleAtom)
  const [analyzedCandidates, setAnalyzedCandidates] = useAtom(
    anchorAnalysisCandidateIdsAtom
  )
  const setAnchorTrayOpen = useSetAtom(anchorAnalysisTrayOpenAtom)
  const analyzeAnchors = useAnchorAnalysis(candidateIds)
  const previousDatasetId = useRef<string | null>(null)

  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const setSelectedEmbeddingIds = useSetAtom(selectedEmbeddingIdsAtom)
  const selectedEmbeddingIds = useAtomValue(selectedEmbeddingIdsAtom)
  const selectedTags = useAtomValue(selectedTagsAtom)
  const selectedEmbedding = useAtomValue(selectedEmbeddingAtom)
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const [showGraphForm, setShowGraphForm] = useState(false)
  const [graphForm, setGraphForm] = useState({
    maxDepth: 3,
    neighborsPerNode: 4,
    maxNodes: 60,
    minSimilarity: 0.75,
    layout: 'concentric' as GraphLayout,
  })
  const [isCreatingGraph, setIsCreatingGraph] = useState(false)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [anchorSelectionError, setAnchorSelectionError] = useState<string | null>(
    null
  )
  const hasMeta =
    !!selectedEmbedding &&
    selectedEmbedding.meta &&
    Object.keys(selectedEmbedding.meta).length > 0

  const validSelectedIds = useMemo(
    () =>
      selectedEmbeddingIds.filter((id) => {
        const numericId = Number(id)
        return Number.isInteger(numericId) && candidateIds.includes(numericId)
      }),
    [candidateIds, selectedEmbeddingIds]
  )
  const selectionOverlapsA = validSelectedIds.some((id) =>
    anchorGroups.a.includes(id)
  )
  const selectionOverlapsB = validSelectedIds.some((id) =>
    anchorGroups.b.includes(id)
  )

  const resetAnchors = useCallback(() => {
    setAnchorGroups({ a: [], b: [] })
    setAnchorResult(null)
    setAnchorStatus('idle')
    setAnchorAnalysisError(null)
    setAnchorSelectionError(null)
    setAnchorStale(false)
    setAnalyzedCandidates([])
    setAnchorTrayOpen(false)
    setSelectedEmbeddingIds([])
    setSelectedEmbedding(null)
  }, [
    setAnalyzedCandidates,
    setAnchorAnalysisError,
    setAnchorGroups,
    setAnchorResult,
    setAnchorStale,
    setAnchorStatus,
    setAnchorTrayOpen,
    setSelectedEmbedding,
    setSelectedEmbeddingIds,
  ])

  const setAnchor = (target: 'a' | 'b') => {
    const opposite = target === 'a' ? anchorGroups.b : anchorGroups.a
    if (!validSelectedIds.length) {
      setAnchorSelectionError('Select one or more dataset images first.')
      return
    }
    if (validSelectedIds.some((id) => opposite.includes(id))) {
      setAnchorSelectionError('Anchor groups A and B cannot share an image.')
      return
    }
    setAnchorGroups((previous) => ({
      ...previous,
      [target]: [...validSelectedIds],
    }))
    setAnchorResult(null)
    setAnchorStatus('idle')
    setAnchorAnalysisError(null)
    setAnchorStale(false)
    setAnchorTrayOpen(false)
    setAnchorSelectionError(null)
    setSelectedEmbeddingIds([])
    setSelectedEmbedding(null)
  }

  useEffect(() => {
    if (previousDatasetId.current === null) {
      previousDatasetId.current = datasetId
      return
    }
    if (previousDatasetId.current !== datasetId) {
      previousDatasetId.current = datasetId
      resetAnchors()
    }
  }, [datasetId, resetAnchors])

  useEffect(() => {
    if (!analyzedCandidates.length) return
    const current = [...candidateIds].sort((a, b) => a - b)
    if (
      current.length !== analyzedCandidates.length ||
      current.some((id, index) => id !== analyzedCandidates[index])
    ) {
      setAnchorStale(true)
    }
  }, [analyzedCandidates, candidateIds, setAnchorStale])

  useEffect(() => {
    if (selectedEmbeddingIds.length !== 1) {
      setShowGraphForm(false)
      setGraphError(null)
    }
  }, [selectedEmbeddingIds.length])

  const createSelectedGraph = async () => {
    if (!datasetId || selectedEmbeddingIds.length !== 1) return
    const rootImageId = Number(selectedEmbeddingIds[0])
    if (!Number.isInteger(rootImageId)) {
      setGraphError('The selected image does not have a valid ID.')
      return
    }
    if (
      graphForm.maxDepth < 1 ||
      graphForm.maxDepth > 5 ||
      graphForm.neighborsPerNode < 1 ||
      graphForm.neighborsPerNode > 10 ||
      graphForm.maxNodes < 2 ||
      graphForm.maxNodes > 200 ||
      graphForm.minSimilarity < 0 ||
      graphForm.minSimilarity > 1
    ) {
      setGraphError('Check the allowed ranges before creating the graph.')
      return
    }

    setIsCreatingGraph(true)
    setGraphError(null)
    try {
      const graph = await createGraphNetwork(datasetId, {
        root_image_id: rootImageId,
        max_depth: graphForm.maxDepth,
        neighbors_per_node: graphForm.neighborsPerNode,
        max_nodes: graphForm.maxNodes,
        min_similarity: graphForm.minSimilarity,
      })
      setGraphNetworks((previous) => ({
        ...previous,
        [datasetId]: graph,
      }))
      setGraphLayout(graphForm.layout)
      setProjectionViewMode('2d')
      setProjectionSettings((previous) => ({
        ...previous,
        type: 'graph',
      }))
      setProjectionRevision((value) => value + 1)
      setSelectedEmbeddingIds([])
      setSelectedEmbedding(null)
      setShowGraphForm(false)
    } catch (error) {
      setGraphError(
        error instanceof Error ? error.message : 'Could not create graph network.'
      )
    } finally {
      setIsCreatingGraph(false)
    }
  }

  return (
    <>
      <ImageDisplayer bottomOffset={bottomOffset} />
      {onFitProjection && <button
        type="button"
        className="glass-panel fixed z-10000 flex items-center gap-2 rounded-full px-3 py-2 text-xs text-white shadow-lg transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          right: MINIMAP_MARGIN + MINIMAP_DEAD_ZONE,
          bottom:
            MINIMAP_MARGIN +
            MINIMAP_SIZE +
            MINIMAP_DEAD_ZONE * 2 +
            12 +
            bottomOffset,
        }}
        onClick={onFitProjection}
        disabled={!canFitProjection}
        aria-label="Centrera och visa alla bilder"
        title="Centrera och visa alla bilder (Home)"
        data-canvas-ui="true"
      >
        <Focus aria-hidden="true" className="size-4" />
        <span>Visa alla bilder</span>
      </button>}
      {(selectedTags.length === 0 || selectedEmbedding) && (
        <TaggerPanel
          position={selectedTags.length > 0 ? 'left' : 'right'}
          offsetBottom={
            (selectedEmbedding && hasMeta ? 220 : 24) + bottomOffset
          }
        />
      )}
      {selectedTags.length > 0 && <TagResultsPanel />}


      {selectionHistory.length > 0 && (
        <div
          className="fixed left-6 z-10000"
          style={{ bottom: 24 + bottomOffset }}
        >
          <button
            className="glass-panel rounded-full px-3 py-2 text-xs text-white transition hover:bg-white/15"
            onClick={() => {
              setSelectionHistory((prev) => {
                if (prev.length === 0) return prev
                const next = [...prev]
                const last = next.pop() ?? null
                setActiveEmbeddingIds(last)
                setSelectedEmbeddingIds([])
                setSelectedEmbedding(null)
                setProjectionRevision((v) => v + 1)
                return next
              })
            }}
          >
            Back ({selectionHistory.length})
          </button>
        </div>
      )}

      {(selectedEmbeddingIds.length > 0 ||
        anchorGroups.a.length > 0 ||
        anchorGroups.b.length > 0) && (
        <div
          className="glass-panel fixed left-1/2 z-10000 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm text-white"
          style={{ bottom: 24 + bottomOffset }}
          data-canvas-ui="true"
        >
          {showGraphForm && selectedEmbeddingIds.length === 1 && (
            <div className="glass-panel-strong absolute bottom-full left-1/2 mb-3 w-80 -translate-x-1/2 rounded-xl p-4 text-xs text-white shadow-xl">
              <div className="mb-3 text-sm font-medium">Create graph network</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-white/70">Depth (1–5)</span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    step={1}
                    value={graphForm.maxDepth}
                    onChange={(event) =>
                      setGraphForm((previous) => ({
                        ...previous,
                        maxDepth: Number(event.target.value),
                      }))
                    }
                    className="w-full rounded-md border border-white/20 bg-black/30 px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Neighbors (1–10)</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={graphForm.neighborsPerNode}
                    onChange={(event) =>
                      setGraphForm((previous) => ({
                        ...previous,
                        neighborsPerNode: Number(event.target.value),
                      }))
                    }
                    className="w-full rounded-md border border-white/20 bg-black/30 px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Maximum nodes</span>
                  <input
                    type="number"
                    min={2}
                    max={200}
                    step={1}
                    value={graphForm.maxNodes}
                    onChange={(event) =>
                      setGraphForm((previous) => ({
                        ...previous,
                        maxNodes: Number(event.target.value),
                      }))
                    }
                    className="w-full rounded-md border border-white/20 bg-black/30 px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Minimum similarity</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={graphForm.minSimilarity}
                    onChange={(event) =>
                      setGraphForm((previous) => ({
                        ...previous,
                        minSimilarity: Number(event.target.value),
                      }))
                    }
                    className="w-full rounded-md border border-white/20 bg-black/30 px-2 py-1.5"
                  />
                </label>
              </div>
              <div className="mt-3">
                <div className="mb-1 text-white/70">Initial layout</div>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['concentric', 'Concentric shells'],
                    ['force', 'Free force'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`rounded-md border px-2 py-1.5 ${
                        graphForm.layout === value
                          ? 'border-white/70 bg-white/20'
                          : 'border-white/20 hover:bg-white/10'
                      }`}
                      onClick={() =>
                        setGraphForm((previous) => ({
                          ...previous,
                          layout: value,
                        }))
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-3 text-[11px] text-white/55">
                The similarity cutoff may produce fewer than the requested nodes.
              </p>
              {graphError && (
                <p className="mt-2 text-[11px] text-red-300">{graphError}</p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-full border border-white/25 px-3 py-1.5 hover:bg-white/10"
                  onClick={() => setShowGraphForm(false)}
                  disabled={isCreatingGraph}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-full bg-white px-3 py-1.5 text-black hover:bg-white/90 disabled:opacity-50"
                  onClick={createSelectedGraph}
                  disabled={isCreatingGraph}
                >
                  {isCreatingGraph ? 'Creating…' : 'Create graph'}
                </button>
              </div>
            </div>
          )}
          {selectedEmbeddingIds.length > 0 && (
            <>
              <span>{selectedEmbeddingIds.length} images selected</span>
              <button
                className="rounded-full border border-white/30 px-3 py-1 text-xs hover:bg-white/10"
                onClick={() => {
                  setSelectedEmbeddingIds([])
                  setSelectedEmbedding(null)
                }}
              >
                Deselect
              </button>
              <button
                className="rounded-full bg-white/90 px-3 py-1 text-xs text-black hover:bg-white"
                onClick={() => {
                  setSelectionHistory((prev) => [...prev, activeEmbeddingIds])
                  setActiveEmbeddingIds(selectedEmbeddingIds)
                  setSelectedEmbeddingIds([])
                  setSelectedEmbedding(null)
                  setProjectionRevision((v) => v + 1)
                }}
              >
                Reproject with selection
              </button>
            </>
          )}
          {anchorGroups.a.length === 0 && selectedEmbeddingIds.length > 0 && (
            <button
              type="button"
              className="rounded-full bg-amber-300 px-3 py-1 text-xs text-black hover:bg-amber-200"
              onClick={() => setAnchor('a')}
              disabled={selectionOverlapsB}
              title={
                selectionOverlapsB
                  ? 'Selection overlaps anchor B'
                  : 'Use selection as anchor A'
              }
            >
              Set as A
            </button>
          )}
          {anchorGroups.a.length > 0 &&
            anchorGroups.b.length === 0 &&
            selectedEmbeddingIds.length > 0 && (
              <>
                <button
                  type="button"
                  className="rounded-full border border-amber-300/60 px-3 py-1 text-xs text-amber-100 hover:bg-amber-300/10"
                  onClick={() => setAnchor('a')}
                  disabled={selectionOverlapsB}
                  title={
                    selectionOverlapsB
                      ? 'Selection overlaps anchor B'
                      : 'Replace anchor A'
                  }
                >
                  Replace A
                </button>
                <button
                  type="button"
                  className="rounded-full bg-cyan-300 px-3 py-1 text-xs text-black hover:bg-cyan-200"
                  onClick={() => setAnchor('b')}
                  disabled={selectionOverlapsA}
                  title={
                    selectionOverlapsA
                      ? 'Selection overlaps anchor A'
                      : 'Use selection as anchor B'
                  }
                >
                  Set as B
                </button>
              </>
            )}
          {anchorGroups.a.length > 0 &&
            anchorGroups.b.length > 0 &&
            selectedEmbeddingIds.length > 0 && (
              <>
                <button
                  type="button"
                  className="rounded-full border border-amber-300/60 px-3 py-1 text-xs text-amber-100 hover:bg-amber-300/10"
                  onClick={() => setAnchor('a')}
                  disabled={selectionOverlapsB}
                  title={
                    selectionOverlapsB
                      ? 'Selection overlaps anchor B'
                      : 'Replace anchor A'
                  }
                >
                  Replace A
                </button>
                <button
                  type="button"
                  className="rounded-full border border-cyan-300/60 px-3 py-1 text-xs text-cyan-100 hover:bg-cyan-300/10"
                  onClick={() => setAnchor('b')}
                  disabled={selectionOverlapsA}
                  title={
                    selectionOverlapsA
                      ? 'Selection overlaps anchor A'
                      : 'Replace anchor B'
                  }
                >
                  Replace B
                </button>
              </>
            )}
          {anchorGroups.a.length > 0 && (
            <span className="rounded-full bg-amber-400/15 px-2 py-1 text-xs text-amber-100">
              A · {anchorGroups.a.length}
            </span>
          )}
          {anchorGroups.b.length > 0 && (
            <span className="rounded-full bg-cyan-400/15 px-2 py-1 text-xs text-cyan-100">
              B · {anchorGroups.b.length}
            </span>
          )}
          {anchorGroups.a.length > 0 && anchorGroups.b.length > 0 && (
            <button
              type="button"
              className="rounded-full bg-emerald-300 px-3 py-1 text-xs text-black hover:bg-emerald-200"
              onClick={() => void analyzeAnchors()}
            >
              Analyze paths
            </button>
          )}
          {(anchorGroups.a.length > 0 || anchorGroups.b.length > 0) && (
            <button
              type="button"
              className="rounded-full border border-white/25 px-3 py-1 text-xs hover:bg-white/10"
              onClick={resetAnchors}
            >
              Clear anchors
            </button>
          )}
          {selectedEmbeddingIds.length === 1 && (
            <button
              type="button"
              className="rounded-full bg-cyan-200 px-3 py-1 text-xs text-black hover:bg-cyan-100"
              onClick={() => {
                setGraphError(null)
                setShowGraphForm((visible) => !visible)
              }}
            >
              Create graph network
            </button>
          )}
          {anchorSelectionError && (
            <span className="w-full text-center text-[11px] text-red-300">
              {anchorSelectionError}
            </span>
          )}
          {!anchorSelectionError &&
            selectedEmbeddingIds.length > 0 &&
            (selectionOverlapsA || selectionOverlapsB) && (
              <span className="w-full text-center text-[11px] text-amber-200">
                This selection overlaps an existing anchor; the conflicting
                replace action is disabled.
              </span>
            )}
        </div>
      )}
    </>
  )
}
