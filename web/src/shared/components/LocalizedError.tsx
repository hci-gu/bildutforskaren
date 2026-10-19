import { renderMessage, t, translate, useLanguage, type Message } from '@/shared/i18n'
import { messages } from '@/shared/i18n/messages'

export function LocalizedError({ value }: { value: Message | string | null | undefined }) {
  useLanguage()
  if (!value) return null
  if (typeof value !== 'string') return <>{renderMessage(value)}</>
  const key = value.replace(/^Error: /, '')
  if (Object.prototype.hasOwnProperty.call(messages, key)) return <>{translate(key)}</>
  return (
    <span>
      {t('Request failed')}{' '}
      <span tabIndex={0} aria-label={t('Technical details')} title={value}>ⓘ</span>
    </span>
  )
}
