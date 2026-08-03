import { useCallback, useEffect, useState } from 'react'
import { fetchDatasetStatus } from '@/shared/lib/api'
import {
  isDatasetActive,
  type DatasetStatus,
} from '@/features/datasets/types/datasets'

const STATUS_POLL_INTERVAL_MS = 5_000

export const useDatasetStatus = (datasetId?: string | null) => {
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
        if (!isCancelled?.()) setStatus(data)
      } catch {
        if (!isCancelled?.()) setError('Kunde inte läsa status för datasetet.')
      } finally {
        if (!isCancelled?.() && showLoading) setLoading(false)
      }
    },
    [datasetId]
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
