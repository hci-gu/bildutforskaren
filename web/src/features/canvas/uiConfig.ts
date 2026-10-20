import { atom } from 'jotai'
import defaults from '../../../../config.json'

export type UiConfig = typeof defaults
export type ViewType = keyof UiConfig['views']
export const uiConfigAtom = atom<UiConfig>(defaults)

