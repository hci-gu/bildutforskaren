import React, { useEffect } from 'react'
import { PhotoView } from 'react-photo-view'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  API_URL,
  activeEmbeddingIdsAtom,
  projectionRevisionAtom,
  selectedEmbeddingAtom,
  selectedEmbeddingIdsAtom,
  selectionHistoryAtom,
} from '@/state'

const ImageDisplayer = () => {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const selectedEmbedding = useAtomValue<any>(selectedEmbeddingAtom)

  useEffect(() => {
    if (buttonRef.current && selectedEmbedding) {
      setTimeout(() => buttonRef.current?.click(), 100)
    }
  }, [selectedEmbedding])

  if (!selectedEmbedding) return null

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
        key={`Image_${selectedEmbedding.id}`}
        src={`${API_URL}/original/${selectedEmbedding.id}`}
      >
        <button ref={buttonRef} />
      </PhotoView>
      <div className="fixed bottom-0 left-0 p-2 text-white z-10000 text-xs bg-black/75">
        <pre>{JSON.stringify(meta, null, 2)}</pre>
      </div>
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

  return (
    <>
      <ImageDisplayer />

      {selectionHistory.length > 0 && (
        <div className="fixed bottom-6 left-6 z-10000">
          <button
            className="rounded-full border border-white/30 bg-black/70 px-3 py-2 text-xs text-white backdrop-blur hover:bg-black/80"
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-10000 flex items-center gap-3 rounded-full border border-white/20 bg-black/70 px-4 py-2 text-sm text-white backdrop-blur">
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
