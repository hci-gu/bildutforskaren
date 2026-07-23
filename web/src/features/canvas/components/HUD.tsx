import React, { useEffect, useState } from 'react'
import { Focus } from 'lucide-react'
import { PhotoView } from 'react-photo-view'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  activeEmbeddingIdsAtom,
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

const ImageDisplayer = () => {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const selectedEmbedding = useAtomValue<any>(selectedEmbeddingAtom)
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
      <div className="glass-panel fixed bottom-4 left-4 z-10000 max-w-sm rounded-lg p-3 text-xs text-white">
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
}: {
  canFitProjection?: boolean
  onFitProjection?: () => void
} = {}) => {
  const [selectionHistory, setSelectionHistory] = useAtom(selectionHistoryAtom)
  const setActiveEmbeddingIds = useSetAtom(activeEmbeddingIdsAtom)
  const activeEmbeddingIds = useAtomValue(activeEmbeddingIdsAtom)
  const setProjectionRevision = useSetAtom(projectionRevisionAtom)
  const setGraphNetworks = useSetAtom(graphNetworksAtom)
  const setGraphLayout = useSetAtom(graphLayoutAtom)
  const setProjectionSettings = useSetAtom(projectionSettingsAtom)
  const setProjectionViewMode = useSetAtom(projectionViewModeAtom)

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
  const hasMeta =
    !!selectedEmbedding &&
    selectedEmbedding.meta &&
    Object.keys(selectedEmbedding.meta).length > 0

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
      <ImageDisplayer />
      {onFitProjection && <button
        type="button"
        className="glass-panel fixed z-10000 flex items-center gap-2 rounded-full px-3 py-2 text-xs text-white shadow-lg transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          right: MINIMAP_MARGIN + MINIMAP_DEAD_ZONE,
          bottom:
            MINIMAP_MARGIN + MINIMAP_SIZE + MINIMAP_DEAD_ZONE * 2 + 12,
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
          offsetBottom={selectedEmbedding && hasMeta ? 220 : 24}
        />
      )}
      {selectedTags.length > 0 && <TagResultsPanel />}


      {selectionHistory.length > 0 && (
        <div className="fixed bottom-6 left-6 z-10000">
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

      {selectedEmbeddingIds.length > 0 && (
        <div
          className="glass-panel fixed bottom-6 left-1/2 z-10000 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 text-sm text-white"
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
              if (selectedEmbeddingIds.length > 0) {
                setSelectionHistory((prev) => [...prev, activeEmbeddingIds])
                setActiveEmbeddingIds(selectedEmbeddingIds)
                setSelectedEmbeddingIds([])
                setSelectedEmbedding(null)
                setProjectionRevision((v) => v + 1)
              }
            }}
          >
            Reproject with selection
          </button>
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
        </div>
      )}
    </>
  )
}
