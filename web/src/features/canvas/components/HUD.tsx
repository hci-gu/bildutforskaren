import React, { useEffect } from 'react'
import { PhotoView } from 'react-photo-view'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  activeEmbeddingIdsAtom,
  projectionRevisionAtom,
  selectedEmbeddingAtom,
  selectedEmbeddingIdsAtom,
  selectionHistoryAtom,
  selectedTagsAtom,
} from '@/store'
import { datasetApiUrl } from '@/shared/lib/api'
import { TaggerPanel } from './TaggerPanel'
import { TagResultsPanel } from './TagResultsPanel'

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

export const HUD = () => {
  const [selectionHistory, setSelectionHistory] = useAtom(selectionHistoryAtom)
  const setActiveEmbeddingIds = useSetAtom(activeEmbeddingIdsAtom)
  const activeEmbeddingIds = useAtomValue(activeEmbeddingIdsAtom)
  const setProjectionRevision = useSetAtom(projectionRevisionAtom)

  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const setSelectedEmbeddingIds = useSetAtom(selectedEmbeddingIdsAtom)
  const selectedEmbeddingIds = useAtomValue(selectedEmbeddingIdsAtom)
  const selectedTags = useAtomValue(selectedTagsAtom)
  const selectedEmbedding = useAtomValue(selectedEmbeddingAtom)
  const hasMeta =
    !!selectedEmbedding &&
    selectedEmbedding.meta &&
    Object.keys(selectedEmbedding.meta).length > 0

  return (
    <>
      <ImageDisplayer />
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
        <div className="glass-panel fixed bottom-6 left-1/2 z-10000 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 text-sm text-white">
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
        </div>
      )}
    </>
  )
}
