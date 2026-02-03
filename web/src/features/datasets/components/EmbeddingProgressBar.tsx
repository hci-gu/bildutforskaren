import { cn } from '@/shared/lib/utils'

type EmbeddingProgressBarProps = {
  percent: number
  label?: string
  className?: string
  labelClassName?: string
  trackClassName?: string
  barClassName?: string
}

export const EmbeddingProgressBar = ({
  percent,
  label = 'Embeddings',
  className,
  labelClassName,
  trackClassName,
  barClassName,
}: EmbeddingProgressBarProps) => {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className={cn('mt-2', className)}>
      <div className={cn('text-xs', labelClassName)}>
        {label} {clamped}%
      </div>
      <div
        className={cn('mt-1 h-2 w-full rounded-full bg-white/10', trackClassName)}
      >
        <div
          className={cn('h-2 rounded-full bg-amber-400', barClassName)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}
