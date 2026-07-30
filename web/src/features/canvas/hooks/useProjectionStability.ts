import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  explanationPanelOpenAtom,
  explanationTabAtom,
  loadableProjectedEmbeddingsAtom,
  projectionRevisionAtom,
  projectionSettingsAtom,
  projectionStabilityErrorAtom,
  projectionStabilityProgressAtom,
  projectionStabilityResultAtom,
  projectionStabilityStatusAtom,
  projectionViewModeAtom,
  selectedStabilityClusterAtom,
} from '@/store'
import {
  cancelProjectionStabilityJob,
  fetchProjectionStabilityJob,
  startProjectionStabilityJob,
} from '@/shared/lib/api'

type ProjectedItem = {
  id: string | number
  point?: readonly number[]
  type?: string
}

const POLL_INTERVAL_MS = 750

export const useProjectionStability = () => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const settings = useAtomValue(projectionSettingsAtom)
  const viewMode = useAtomValue(projectionViewModeAtom)
  const projectionRevision = useAtomValue(projectionRevisionAtom)
  const projection = useAtomValue(loadableProjectedEmbeddingsAtom('main'))
  const status = useAtomValue(projectionStabilityStatusAtom)
  const setStatus = useSetAtom(projectionStabilityStatusAtom)
  const setProgress = useSetAtom(projectionStabilityProgressAtom)
  const setError = useSetAtom(projectionStabilityErrorAtom)
  const setResult = useSetAtom(projectionStabilityResultAtom)
  const setSelectedCluster = useSetAtom(selectedStabilityClusterAtom)
  const setExplanationOpen = useSetAtom(explanationPanelOpenAtom)
  const setExplanationTab = useSetAtom(explanationTabAtom)
  const activeJobRef = useRef<{ datasetId: string; jobId: string } | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestControllerRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const previousAnalysisKeyRef = useRef<string | null>(null)
  const previousViewModeRef = useRef(viewMode)

  const projectedImages = useMemo(
    () =>
      projection.state === 'hasData'
        ? (projection.data as ProjectedItem[]).filter(
            (item) =>
              (item.type === undefined || item.type === 'image') &&
              Array.isArray(item.point) &&
              item.point.length === 2 &&
              item.point.every(Number.isFinite) &&
              Number.isInteger(Number(item.id))
          )
        : [],
    [projection]
  )

  const analysisKey = useMemo(
    () =>
      [
        datasetId ?? 'none',
        settings.type,
        settings.nNeighbors,
        settings.minDist,
        settings.spread,
        settings.seed,
        projectionRevision,
        projectedImages.map((item) => item.id).join(','),
      ].join('|'),
    [datasetId, projectedImages, projectionRevision, settings]
  )

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
  }, [])

  const cancelActiveJob = useCallback(() => {
    const active = activeJobRef.current
    activeJobRef.current = null
    generationRef.current += 1
    stopPolling()
    if (active) {
      cancelProjectionStabilityJob(active.datasetId, active.jobId).catch(
        () => undefined
      )
    }
  }, [stopPolling])

  const clearResult = useCallback(() => {
    setResult(null)
    setStatus('idle')
    setProgress(0)
    setError(null)
    setSelectedCluster(null)
  }, [
    setError,
    setProgress,
    setResult,
    setSelectedCluster,
    setStatus,
  ])

  useEffect(() => {
    if (
      previousAnalysisKeyRef.current !== null &&
      previousAnalysisKeyRef.current !== analysisKey
    ) {
      cancelActiveJob()
      clearResult()
    }
    previousAnalysisKeyRef.current = analysisKey
  }, [analysisKey, cancelActiveJob, clearResult])

  useEffect(() => {
    const previous = previousViewModeRef.current
    previousViewModeRef.current = viewMode
    if (
      previous !== viewMode &&
      viewMode !== '2d' &&
      (status === 'starting' || status === 'running')
    ) {
      cancelActiveJob()
      clearResult()
    }
  }, [cancelActiveJob, clearResult, status, viewMode])

  useEffect(
    () => () => {
      cancelActiveJob()
    },
    [cancelActiveJob]
  )

  const pollJob = useCallback(
    async (
      targetDatasetId: string,
      jobId: string,
      generation: number
    ) => {
      if (
        generationRef.current !== generation ||
        activeJobRef.current?.jobId !== jobId
      ) {
        return
      }
      const controller = new AbortController()
      requestControllerRef.current = controller
      try {
        const job = await fetchProjectionStabilityJob(
          targetDatasetId,
          jobId,
          controller.signal
        )
        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          activeJobRef.current?.jobId !== jobId
        ) {
          return
        }
        setProgress(Math.max(0, Math.min(1, job.progress ?? 0)))
        if (job.status === 'complete' && job.result) {
          activeJobRef.current = null
          setResult(job.result)
          setStatus('ready')
          setProgress(1)
          setError(null)
          const mostStable = [...job.result.clusters].sort(
            (a, b) =>
              b.stability - a.stability || a.cluster_id - b.cluster_id
          )[0]
          setSelectedCluster(mostStable?.cluster_id ?? null)
          setExplanationOpen(true)
          setExplanationTab('stability')
          return
        }
        if (job.status === 'error' || job.status === 'cancelled') {
          activeJobRef.current = null
          setStatus(job.status === 'error' ? 'error' : 'idle')
          setError(
            job.status === 'error'
              ? job.error || 'Kunde inte analysera klusterstabiliteten.'
              : null
          )
          return
        }
        setStatus('running')
        pollTimerRef.current = setTimeout(
          () => pollJob(targetDatasetId, jobId, generation),
          POLL_INTERVAL_MS
        )
      } catch (error) {
        if (controller.signal.aborted) return
        activeJobRef.current = null
        cancelProjectionStabilityJob(targetDatasetId, jobId).catch(
          () => undefined
        )
        setStatus('error')
        setError(
          error instanceof Error
            ? error.message
            : 'Kunde inte hämta klusterstabiliteten.'
        )
      }
    },
    [
      setError,
      setExplanationOpen,
      setExplanationTab,
      setProgress,
      setResult,
      setSelectedCluster,
      setStatus,
    ]
  )

  const start = useCallback(async () => {
    if (
      !datasetId ||
      settings.type !== 'umap' ||
      viewMode !== '2d' ||
      projectedImages.length < 10 ||
      status === 'starting' ||
      status === 'running'
    ) {
      return
    }
    cancelActiveJob()
    const generation = generationRef.current
    setResult(null)
    setSelectedCluster(null)
    setStatus('starting')
    setProgress(0)
    setError(null)
    const controller = new AbortController()
    requestControllerRef.current = controller
    try {
      const job = await startProjectionStabilityJob(
        datasetId,
        {
          image_ids: projectedImages.map((item) => Number(item.id)),
          projection_points: projectedImages.map(
            (item) => [...(item.point ?? [0, 0])] as [number, number]
          ),
          params: {
            n_neighbors: Math.round(Number(settings.nNeighbors)),
            min_dist: Number(settings.minDist),
            spread: Number(settings.spread),
            seed: Math.round(Number(settings.seed)),
          },
        },
        controller.signal
      )
      if (controller.signal.aborted || generationRef.current !== generation) {
        return
      }
      activeJobRef.current = { datasetId, jobId: job.job_id }
      setStatus('running')
      pollJob(datasetId, job.job_id, generation)
    } catch (error) {
      if (controller.signal.aborted) return
      setStatus('error')
      setError(
        error instanceof Error
          ? error.message
          : 'Kunde inte starta klusterstabilitetsanalysen.'
      )
    }
  }, [
    cancelActiveJob,
    datasetId,
    pollJob,
    projectedImages,
    setError,
    setProgress,
    setResult,
    setSelectedCluster,
    setStatus,
    settings,
    status,
    viewMode,
  ])

  return {
    start,
    imageCount: projectedImages.length,
    canStart:
      !!datasetId &&
      settings.type === 'umap' &&
      viewMode === '2d' &&
      projectedImages.length >= 10 &&
      status !== 'starting' &&
      status !== 'running',
  }
}
