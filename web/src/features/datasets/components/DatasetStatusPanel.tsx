import { translate, t, useLanguage } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { EmbeddingProgressBar } from '@/features/datasets/components/EmbeddingProgressBar'
import type { ReactNode } from 'react'

type DatasetStatusPanelProps = {
  variant: 'loading' | 'error' | 'pending'
  className?: string
  useGlassPanel?: boolean
  loadingText?: string
  errorText?: string
  title?: string
  description?: string
  stage?: string
  showProgress?: boolean
  progressPercent?: number | null
  progressLabel?: string
  action?: ReactNode
  textClassName?: string
  progressLabelClassName?: string
}

export const DatasetStatusPanel = ({
  variant,
  className,
  useGlassPanel = true,
  loadingText = 'Laddar…',
  errorText = t('Något gick fel.'),
  title,
  description,
  stage,
  showProgress,
  progressPercent,
  progressLabel = 'Embeddings',
  action,
  textClassName,
  progressLabelClassName,
}: DatasetStatusPanelProps) => {
  useLanguage()
  const baseClassName = useGlassPanel
    ? 'glass-panel rounded-2xl p-6'
    : 'rounded-xl p-3'

  if (variant === 'loading') {
    return (
      <div className={cn(baseClassName, className, textClassName ?? 'text-sm')}>
        {translate(loadingText)}
      </div>
    )
  }

  if (variant === 'error') {
    return (
      <div className={cn(baseClassName, className, textClassName ?? 'text-sm')}>
        {translate(errorText)}
      </div>
    )
  }

  return (
    <div className={cn(baseClassName, className)}>
      {title && <h1 className="text-xl font-semibold">{translate(title)}</h1>}
      {description && (
        <p className={cn('mt-2 text-sm', textClassName)}>{translate(description)}</p>
      )}
      {stage && (
        <div className={cn('mt-3 text-sm', textClassName)}>
          {t('Steg:')} {translate(stage)}
          {typeof progressPercent === 'number' ? ` (${progressPercent}%)` : ''}
        </div>
      )}
      {showProgress && typeof progressPercent === 'number' && (
        <EmbeddingProgressBar
          className="mt-4"
          percent={progressPercent}
          label={progressLabel}
          labelClassName={progressLabelClassName}
        />
      )}
      {action && <div className="mt-5 flex flex-wrap gap-2">{action}</div>}
    </div>
  )
}
