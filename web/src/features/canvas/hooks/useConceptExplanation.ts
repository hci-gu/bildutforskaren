import { useEffect, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  conceptExplanationComparisonIdAtom,
  conceptExplanationErrorAtom,
  conceptExplanationResultAtom,
  conceptExplanationStatusAtom,
  conceptExplanationTabAtom,
  selectedEmbeddingIdsAtom,
} from '@/store'
import { fetchConceptExplanation } from '@/shared/lib/api'

type ProjectedItem = {
  id: string | number
  type?: string
}

export const useConceptExplanation = (
  items: ProjectedItem[],
  active: boolean
) => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const selectedIds = useAtomValue(selectedEmbeddingIdsAtom)
  const tab = useAtomValue(conceptExplanationTabAtom)
  const comparisonImageId = useAtomValue(conceptExplanationComparisonIdAtom)
  const setResult = useSetAtom(conceptExplanationResultAtom)
  const setStatus = useSetAtom(conceptExplanationStatusAtom)
  const setError = useSetAtom(conceptExplanationErrorAtom)

  const payload = useMemo(() => {
    if (!active || tab !== 'explain' || selectedIds.length !== 1) return null
    const selectedImageId = Number(selectedIds[0])
    if (!Number.isInteger(selectedImageId)) return null

    const imageIds = Array.from(
      new Set(
        items
          .filter((item) => item.type === undefined || item.type === 'image')
          .map((item) => Number(item.id))
          .filter(Number.isInteger)
      )
    )
    if (!imageIds.includes(selectedImageId)) return null
    const validComparisonId =
      comparisonImageId !== null &&
      comparisonImageId !== selectedImageId &&
      imageIds.includes(comparisonImageId)
        ? comparisonImageId
        : undefined

    return {
      image_ids: imageIds,
      selected_image_id: selectedImageId,
      ...(validComparisonId === undefined
        ? {}
        : { comparison_image_id: validComparisonId }),
    }
  }, [active, comparisonImageId, items, selectedIds, tab])

  useEffect(() => {
    if (!datasetId || !payload) {
      setResult(null)
      setStatus('idle')
      setError(null)
      return
    }

    const controller = new AbortController()
    setResult(null)
    setStatus('loading')
    setError(null)
    fetchConceptExplanation(datasetId, payload, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setResult(result)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setResult(null)
        setStatus('error')
        setError(
          error instanceof Error
            ? error.message
            : 'Kunde inte beräkna begreppsförklaringen.'
        )
      })

    return () => controller.abort()
  }, [datasetId, payload, setError, setResult, setStatus])
}
