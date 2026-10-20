import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { projectionSettingsAtom } from '@/store'
import { uiConfigAtom, type ViewType } from '../uiConfig'

// eslint-disable-next-line react-refresh/only-export-components
export function useCanvasWidget(name: string) {
  const config = useAtomValue(uiConfigAtom)
  const { type } = useAtomValue(projectionSettingsAtom)
  const widgets = config.views[type as ViewType] as Record<string, boolean> | undefined
  return widgets?.[name] ?? true
}

export function CanvasWidget({ name, children }: { name: string; children: ReactNode }) {
  const enabled = useCanvasWidget(name)
  return enabled ? children : null
}
