import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { projectionSettingsAtom } from '@/store'
import { canvasWidgetEnabled, uiConfigAtom } from '../uiConfig'

// eslint-disable-next-line react-refresh/only-export-components
export function useCanvasWidget(name: string) {
  const config = useAtomValue(uiConfigAtom)
  const { type } = useAtomValue(projectionSettingsAtom)
  return canvasWidgetEnabled(config, type, name)
}

export function CanvasWidget({ name, children }: { name: string; children: ReactNode }) {
  const enabled = useCanvasWidget(name)
  return enabled ? children : null
}
