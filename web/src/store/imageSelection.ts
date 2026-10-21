import { atom } from 'jotai'
import { uiConfigAtom } from '../features/canvas/uiConfig'
import { closePhotoViewer } from '../shared/lib/photoViewer'

export type SelectedEmbedding = {
  id: number
  meta: Record<string, unknown>
}

const selectedEmbeddingValueAtom = atom<SelectedEmbedding | null>(null)
export const selectedEmbeddingAtom = atom(
  (get) => get(selectedEmbeddingValueAtom),
  (_get, set, value: SelectedEmbedding | null) => {
    if (value === null) closePhotoViewer()
    set(selectedEmbeddingValueAtom, value)
  }
)

export type ImageViewerRequest = {
  imageId: number
  requestId: number
}

export const imageViewerRequestAtom = atom<ImageViewerRequest | null>(null)
export const openImageViewerAtom = atom(
  null,
  (get, set, imageId: number) => {
    const previousRequest = get(imageViewerRequestAtom)
    set(imageViewerRequestAtom, {
      imageId,
      requestId: (previousRequest?.requestId ?? 0) + 1,
    })
  }
)

export const selectedEmbeddingIdsAtom = atom<string[]>([])

// Use only for direct canvas image clicks; bulk selection and viewer metadata
// updates should not open or reopen the viewer.
export const selectCanvasImageAtom = atom(
  null,
  (get, set, image: SelectedEmbedding) => {
    if (!Number.isInteger(image.id) || image.id < 0) return
    set(selectedEmbeddingAtom, image)
    set(selectedEmbeddingIdsAtom, [String(image.id)])
    if (get(uiConfigAtom).openImageOnSelection === true) {
      set(openImageViewerAtom, image.id)
    }
  }
)
