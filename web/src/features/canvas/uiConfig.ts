import { atom } from 'jotai'
import defaults from '../../../../config.json'

export type UiConfig = typeof defaults
export type ViewType = keyof UiConfig['views']
export const uiConfigAtom = atom<UiConfig>(defaults)

export function enabledViewTypes(config: UiConfig): ViewType[] {
  return (Object.keys(defaults.views) as ViewType[]).filter((view) => config.views[view]?.enabled !== false)
}

export function availableViewType(config: UiConfig, current: string, hasGraph: boolean): ViewType | null {
  const available = enabledViewTypes(config).filter((view) => view !== 'graph' || hasGraph)
  return available.find((view) => view === current) ?? available[0] ?? null
}

