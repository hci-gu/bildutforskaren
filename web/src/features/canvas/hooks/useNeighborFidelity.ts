import { useEffect, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  neighborFidelityErrorAtom,
  neighborFidelityResultAtom,
  neighborFidelitySettingsAtom,
  neighborFidelityStatusAtom,
  selectedEmbeddingIdsAtom,
} from '@/store'
import { fetchNeighborFidelity } from '@/shared/lib/api'

type ProjectedItem = {
  id: string | number
  point?: readonly number[]
  type?: string
}

export const useNeighborFidelity = (
  items: ProjectedItem[],
  active: boolean
) => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const selectedIds = useAtomValue(selectedEmbeddingIdsAtom)
  const settings = useAtomValue(neighborFidelitySettingsAtom)
  const setResult = useSetAtom(neighborFidelityResultAtom)
  const setStatus = useSetAtom(neighborFidelityStatusAtom)
  const setError = useSetAtom(neighborFidelityErrorAtom)

  const payload = useMemo(() => {
    if (!active || !settings.enabled || selectedIds.length !== 1) return null
    const selectedItemId = selectedIds[0]

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

    if (images.length < 2) return null
    const dimension = images[0].point?.length
    const selectedImage = images.find(
      (item) => String(item.id) === selectedItemId
    )
    if (
      !images.every((item) => item.point?.length === dimension) ||
      !selectedImage
    ) {
      return null
    }

    return {
      image_ids: images.map((item) => item.imageId),
      projection_points: images.map((item) => [...(item.point ?? [])]),
      selected_image_id: selectedImage.imageId,
      k: settings.k,
    }
  }, [active, items, selectedIds, settings.enabled, settings.k])

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
    fetchNeighborFidelity(datasetId, payload, controller.signal)
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
            : 'Could not calculate neighbor fidelity.'
        )
      })

    return () => controller.abort()
  }, [datasetId, payload, setError, setResult, setStatus])
}
