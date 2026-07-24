import type { AnchorAnalysisResponse } from '@/shared/lib/api'
import type { AnchorAnalysisTab, AnchorGraphMode } from '@/store'

export const ANCHOR_ANALYSIS_PATH_COLORS = {
  axis: 0xf8fafc,
  interpolation: 0xa78bfa,
  graph: 0x34d399,
} as const

export type AnchorAnalysisDisplayPath = {
  key: keyof typeof ANCHOR_ANALYSIS_PATH_COLORS
  ids: number[]
  color: number
}

export const getAnchorAnalysisDisplayPaths = (
  result: AnchorAnalysisResponse | null,
  tab: AnchorAnalysisTab,
  graphMode: AnchorGraphMode,
  compare: boolean
): AnchorAnalysisDisplayPath[] => {
  if (!result) return []

  const graphPath = result.graph[graphMode].path_ids
  if (compare) {
    return [
      {
        key: 'axis',
        ids: result.axis.path_ids,
        color: ANCHOR_ANALYSIS_PATH_COLORS.axis,
      },
      {
        key: 'interpolation',
        ids: result.interpolation.path_ids,
        color: ANCHOR_ANALYSIS_PATH_COLORS.interpolation,
      },
      {
        key: 'graph',
        ids: graphPath,
        color: ANCHOR_ANALYSIS_PATH_COLORS.graph,
      },
    ]
  }

  if (tab === 'interpolation') {
    return [
      {
        key: 'interpolation',
        ids: result.interpolation.path_ids,
        color: ANCHOR_ANALYSIS_PATH_COLORS.interpolation,
      },
    ]
  }
  if (tab === 'graph') {
    return [
      {
        key: 'graph',
        ids: graphPath,
        color: ANCHOR_ANALYSIS_PATH_COLORS.graph,
      },
    ]
  }
  return [
    {
      key: 'axis',
      ids: result.axis.path_ids,
      color: ANCHOR_ANALYSIS_PATH_COLORS.axis,
    },
  ]
}
