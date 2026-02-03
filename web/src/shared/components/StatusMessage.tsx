import { cn } from '@/shared/lib/utils'

type StatusMessageProps = {
  variant?: 'default' | 'error'
  className?: string
  textClassName?: string
  children: React.ReactNode
}

export const StatusMessage = ({
  variant = 'default',
  className,
  textClassName,
  children,
}: StatusMessageProps) => {
  const base =
    variant === 'error'
      ? 'rounded-xl border border-rose-500/50 bg-rose-500/10 p-4 backdrop-blur'
      : 'glass-panel rounded-xl p-4'

  const text =
    variant === 'error'
      ? 'text-sm text-rose-200'
      : 'text-sm text-slate-200'

  return (
    <div className={cn(base, className, textClassName ?? text)}>{children}</div>
  )
}
