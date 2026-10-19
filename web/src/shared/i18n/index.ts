import { atom, getDefaultStore, useAtomValue } from 'jotai'
import { messages, type MessageKey } from './messages'

export type Language = 'sv' | 'en'
export type Labels = { sv: string; en: string }
const storageKey = 'bildutforskaren.language'

export function readLanguage(storage?: Pick<Storage, 'getItem'>): Language {
  try {
    return (storage ?? window.localStorage).getItem(storageKey) === 'en' ? 'en' : 'sv'
  } catch {
    return 'sv'
  }
}

export const languageAtom = atom<Language>(readLanguage())
export const currentLanguage = () => getDefaultStore().get(languageAtom)

export function setLanguage(language: Language) {
  getDefaultStore().set(languageAtom, language)
  if (typeof document !== 'undefined') document.documentElement.lang = language
  try {
    window.localStorage.setItem(storageKey, language)
  } catch {
    // The preference still works for this session if storage is unavailable.
  }
}

// Subscribe in presenting components; never in analytical atoms or API requests.
export const useLanguage = () => useAtomValue(languageAtom)

export function translate(key: string, values: readonly unknown[] = [], language = currentLanguage()): string {
  const pair = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key as MessageKey] : undefined
  const text = pair?.[language === 'sv' ? 0 : 1] ?? key
  return text.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)]
    return typeof value === 'number'
      ? new Intl.NumberFormat(language === 'sv' ? 'sv-SE' : 'en-GB', { maximumFractionDigits: 6 }).format(value)
      : String(value ?? match)
  })
}

export function t(key: MessageKey, values: readonly unknown[] = []): string {
  return translate(key, values)
}

export type Message = { key: MessageKey; values?: readonly unknown[] }
export const message = (key: MessageKey, values?: readonly unknown[]): Message => ({ key, values })
export const renderMessage = (value: Message | string | null | undefined) =>
  typeof value === 'string' ? translate(value) : value ? t(value.key, value.values) : ''

export const displayLabel = (item: { label?: string; labels?: Labels | null }, language = currentLanguage()) =>
  item.labels?.[language] || (item.labels !== null && !ambiguousLabels.has(item.label ?? '')
    ? vocabularyLabels.get(item.label ?? '')?.[language] : '') || item.label || ''

const vocabularyLabels = new Map<string, Labels>()
const ambiguousLabels = new Set<string>()

// Keep presentation metadata separate from canonical values held by the store.
export function rememberLabels(value: unknown): void {
  if (Array.isArray(value)) {
    if (!value.length || typeof value[0] !== 'object') return
    value.forEach(rememberLabels)
  } else if (value && typeof value === 'object') {
    const item = value as { label?: unknown; labels?: Partial<Labels> | null }
    if (typeof item.label === 'string' && item.labels === null) ambiguousLabels.add(item.label)
    if (typeof item.label === 'string' && typeof item.labels?.sv === 'string' && typeof item.labels.en === 'string') {
      const previous = vocabularyLabels.get(item.label)
      if (previous && (previous.sv !== item.labels.sv || previous.en !== item.labels.en)) ambiguousLabels.add(item.label)
      vocabularyLabels.set(item.label, item.labels as Labels)
    }
    Object.values(value).forEach(rememberLabels)
  }
}

export const displayTag = (label: string) => displayLabel({ label })
export const canvasText = (label: string, id: string) =>
  id === 'untagged_header'
    ? t('Otaggade')
    : id.startsWith('tag_fallback_') ? t('Tagg') : displayTag(label)

export const scopeNote = (text?: string) => text
  ? `${t('Original Swedish scope note')}: ${text}`
  : ''

export const formatNumber = (value: number, maximumFractionDigits = 0) =>
  new Intl.NumberFormat(currentLanguage() === 'sv' ? 'sv-SE' : 'en-GB', { maximumFractionDigits }).format(value)

export function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(
    currentLanguage() === 'sv' ? 'sv-SE' : 'en-GB',
    { dateStyle: 'medium', timeStyle: 'short' }
  ).format(date)
}

export const plural = (key: 'selectedImages', count: number) =>
  t(`${key}_${new Intl.PluralRules(currentLanguage()).select(count) === 'one' ? 'one' : 'other'}`, [formatNumber(count)])
