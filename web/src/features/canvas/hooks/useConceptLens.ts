import { useEffect, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  conceptLensErrorAtom,
  conceptLensResultAtom,
  conceptLensSelectionAtom,
  conceptLensStatusAtom,
} from '@/store'
import { fetchConceptLens } from '@/shared/lib/api'

type ProjectedItem = {
  id: string | number
  point?: readonly number[]
  type?: string
}

export const useConceptLens = (
  items: ProjectedItem[],
  active: boolean
) => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const selection = useAtomValue(conceptLensSelectionAtom)
  const setResult = useSetAtom(conceptLensResultAtom)
  const setStatus = useSetAtom(conceptLensStatusAtom)
  const setError = useSetAtom(conceptLensErrorAtom)

  const payload = useMemo(() => {
    if (!active || !selection.a) return null
    const images = items
      .filter(
        (item) =>
          item.type === 'image' &&
        Array.isArray(item.point) &&
        (item.point.length === 2 || item.point.length === 3) &&
        item.point.every(Number.isFinite)
      )
      .map((item) => ({ ...item, imageId: Number(item.id) }))
      .filter(
        (item) => Number.isInteger(item.imageId) && item.imageId >= 0
      )
    if (images.length === 0) return null
    const conceptIds = [
      selection.a.concept_id,
      ...(selection.b ? [selection.b.concept_id] : []),
    ]
    return {
      image_ids: images.map((item) => item.imageId),
      concept_ids: conceptIds,
      projection_points: images.map((item) => [...(item.point ?? [])]),
    }
  }, [active, items, selection.a, selection.b])

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
    fetchConceptLens(datasetId, payload, controller.signal)
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
            : 'Kunde inte beräkna begreppslinsen.'
        )
      })

    return () => controller.abort()
  }, [datasetId, payload, setError, setResult, setStatus])
}
