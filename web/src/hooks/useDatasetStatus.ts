import { useCallback, useEffect, useState } from 'react'
import { fetchDatasetStatus } from '@/lib/api'
import type { DatasetStatus } from '@/types/datasets'

export const useDatasetStatus = (datasetId?: string | null) => {
  const [status, setStatus] = useState<DatasetStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!datasetId) {
      setStatus(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDatasetStatus(datasetId)
      setStatus(data)
    } catch (err) {
      setError('Kunde inte läsa status för datasetet.')
    } finally {
      setLoading(false)
    }
  }, [datasetId])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!datasetId) {
        setStatus(null)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const data = await fetchDatasetStatus(datasetId)
        if (!cancelled) setStatus(data)
      } catch (err) {
        if (!cancelled) setError('Kunde inte läsa status för datasetet.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [datasetId])

  return { status, loading, error, reload }
}
