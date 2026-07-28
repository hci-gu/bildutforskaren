import { useEffect, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  conceptExplanationComparisonIdAtom,
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
  const setComparisonImageId = useSetAtom(
    conceptExplanationComparisonIdAtom
  )
  const setStatus = useSetAtom(neighborFidelityStatusAtom)
  const setError = useSetAtom(neighborFidelityErrorAtom)

  const payload = useMemo(() => {
    if (!active || !settings.enabled || selectedIds.length !== 1) return null
    const selectedImageId = Number(selectedIds[0])
    if (!Number.isInteger(selectedImageId)) return null

    const images = items.filter(
      (item) =>
        (item.type === undefined || item.type === 'image') &&
        Array.isArray(item.point) &&
        (item.point.length === 2 || item.point.length === 3) &&
        item.point.every(Number.isFinite)
    )
    if (images.length < 2) return null
    const dimension = images[0].point?.length
    if (
      !images.every((item) => item.point?.length === dimension) ||
      !images.some((item) => Number(item.id) === selectedImageId)
    ) {
      return null
    }

    return {
      image_ids: images.map((item) => Number(item.id)),
      projection_points: images.map((item) => [...(item.point ?? [])]),
      selected_image_id: selectedImageId,
      k: settings.k,
    }
  }, [active, items, selectedIds, settings.enabled, settings.k])

  useEffect(() => {
    if (!datasetId || !payload) {
      setResult(null)
      setComparisonImageId(null)
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
        const defaultNeighbor =
          result.neighbors.projection_only[0] ??
          result.neighbors.clip_only[0] ??
          result.neighbors.preserved[0] ??
          null
        setComparisonImageId(defaultNeighbor?.image_id ?? null)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setResult(null)
        setComparisonImageId(null)
        setStatus('error')
        setError(
          error instanceof Error
            ? error.message
            : 'Could not calculate neighbor fidelity.'
        )
      })

    return () => controller.abort()
  }, [
    datasetId,
    payload,
    setComparisonImageId,
    setError,
    setResult,
    setStatus,
  ])
}
