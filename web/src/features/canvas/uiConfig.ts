import { atom } from 'jotai'
import defaults from '../../../../config.json'

export type UiConfig = typeof defaults
export type ViewType = keyof UiConfig['views']
export const uiConfigAtom = atom<UiConfig>(defaults)

const advancedWidgets = new Set([
  'stability', 'fidelity', 'projectionParameters', 'graphLayout', 'groupTagged',
  'colorPhotographer', 'clusterImages', 'filter',
])

export function canvasWidgetEnabled(config: UiConfig, view: string, name: string): boolean {
  const viewDefaults = defaults.views[view as ViewType]
  if (!viewDefaults || !(name in viewDefaults)) return false
  const widgets = config.views[view as ViewType] as Record<string, boolean> | undefined
  if (widgets?.enabled === false || widgets?.[name] === false) return false
  return !advancedWidgets.has(name) || widgets?.advanced !== false
}

export function enabledViewTypes(config: UiConfig): ViewType[] {
  return (Object.keys(defaults.views) as ViewType[]).filter((view) => config.views[view]?.enabled !== false)
}

export function availableViewType(config: UiConfig, current: string, hasGraph: boolean): ViewType | null {
  const available = enabledViewTypes(config).filter((view) => view !== 'graph' || hasGraph)
  return available.find((view) => view === current) ?? available[0] ?? null
}

