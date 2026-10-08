import { useCallback, useEffect, useState } from 'react'
import { useSetAtom } from 'jotai'
import { observeEmbeddingModelAtom } from '@/store'
import { fetchDatasetStatus } from '@/shared/lib/api'
import {
  hasSameDatasetData,
  isDatasetActive,
  type DatasetStatus,
} from '@/features/datasets/types/datasets'

const STATUS_POLL_INTERVAL_MS = 5_000

export const useDatasetStatus = (datasetId?: string | null) => {
  const observeEmbeddingModel = useSetAtom(observeEmbeddingModelAtom)
  const [status, setStatus] = useState<DatasetStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(
    async (showLoading = true, isCancelled?: () => boolean) => {
      if (!datasetId) {
        if (!isCancelled?.()) {
          setStatus(null)
          setLoading(false)
        }
        return
      }
      if (!isCancelled?.() && showLoading) setLoading(true)
      if (!isCancelled?.()) setError(null)
      try {
        const data = await fetchDatasetStatus(datasetId)
        if (!isCancelled?.()) {
          if (data.embedding_fingerprint) {
            observeEmbeddingModel({ datasetId, fingerprint: data.embedding_fingerprint })
          }
          setStatus((current) =>
            hasSameDatasetData(current, data) ? current : data
          )
        }
      } catch {
        if (!isCancelled?.()) setError('Kunde inte läsa status för datasetet.')
      } finally {
        if (!isCancelled?.() && showLoading) setLoading(false)
      }
    },
    [datasetId, observeEmbeddingModel]
  )

  useEffect(() => {
    let cancelled = false
    void reload(true, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [reload])

  useEffect(() => {
    if (!isDatasetActive(status)) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      await reload(false, () => cancelled)
      if (!cancelled) timer = setTimeout(poll, STATUS_POLL_INTERVAL_MS)
    }

    timer = setTimeout(poll, STATUS_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [reload, status])

  return { status, loading, error, reload }
}
