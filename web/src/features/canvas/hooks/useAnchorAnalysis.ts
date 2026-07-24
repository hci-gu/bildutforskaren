import { useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  anchorAnalysisCandidateIdsAtom,
  anchorAnalysisErrorAtom,
  anchorAnalysisParametersAtom,
  anchorAnalysisResultAtom,
  anchorAnalysisStaleAtom,
  anchorAnalysisStatusAtom,
  anchorAnalysisTrayCollapsedAtom,
  anchorAnalysisTrayHeightAtom,
  anchorAnalysisTrayOpenAtom,
  anchorGroupsAtom,
  projectionSettingsAtom,
  projectionViewModeAtom,
} from '@/store'
import { createAnchorAnalysis } from '@/shared/lib/api'

let activeController: AbortController | null = null

export const useAnchorAnalysis = (candidateIds: number[]) => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const groups = useAtomValue(anchorGroupsAtom)
  const parameters = useAtomValue(anchorAnalysisParametersAtom)
  const setResult = useSetAtom(anchorAnalysisResultAtom)
  const setStatus = useSetAtom(anchorAnalysisStatusAtom)
  const setError = useSetAtom(anchorAnalysisErrorAtom)
  const setStale = useSetAtom(anchorAnalysisStaleAtom)
  const setAnalyzedCandidates = useSetAtom(anchorAnalysisCandidateIdsAtom)
  const setTrayOpen = useSetAtom(anchorAnalysisTrayOpenAtom)
  const setTrayCollapsed = useSetAtom(anchorAnalysisTrayCollapsedAtom)
  const setTrayHeight = useSetAtom(anchorAnalysisTrayHeightAtom)
  const projectionViewMode = useAtomValue(projectionViewModeAtom)
  const setProjectionSettings = useSetAtom(projectionSettingsAtom)

  return useCallback(async () => {
    if (!datasetId || !groups.a.length || !groups.b.length) return
    const anchorA = groups.a.map(Number)
    const anchorB = groups.b.map(Number)
    const overlap = anchorA.some((id) => anchorB.includes(id))
    if (overlap) {
      setError('Anchor groups A and B must be disjoint.')
      setStatus('error')
      return
    }

    activeController?.abort()
    const controller = new AbortController()
    activeController = controller

    if (projectionViewMode === '2d') {
      setProjectionSettings((previous) => ({ ...previous, type: 'umap' }))
    }
    setTrayOpen(true)
    setTrayCollapsed(false)
    setTrayHeight((previous) => {
      if (previous >= 240) return previous
      return Math.max(240, Math.round(window.innerHeight * 0.34))
    })
    setStatus('loading')
    setError(null)

    try {
      const result = await createAnchorAnalysis(
        datasetId,
        {
          anchor_a_ids: anchorA,
          anchor_b_ids: anchorB,
          candidate_ids: candidateIds,
          parameters,
        },
        controller.signal
      )
      if (controller.signal.aborted) return
      setResult(result)
      setAnalyzedCandidates([...candidateIds].sort((a, b) => a - b))
      setStale(false)
      setStatus('ready')
    } catch (error) {
      if (controller.signal.aborted) return
      setError(error instanceof Error ? error.message : 'Analysis failed.')
      setStatus('error')
    } finally {
      if (activeController === controller) {
        activeController = null
      }
    }
  }, [
    candidateIds,
    datasetId,
    groups.a,
    groups.b,
    parameters,
    projectionViewMode,
    setAnalyzedCandidates,
    setError,
    setProjectionSettings,
    setResult,
    setStale,
    setStatus,
    setTrayCollapsed,
    setTrayHeight,
    setTrayOpen,
  ])
}
