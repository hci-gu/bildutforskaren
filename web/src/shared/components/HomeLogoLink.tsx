import { Link } from 'react-router'
import appIcon from '@/assets/bildutforskaren-icon.png'
import { cn } from '@/shared/lib/utils'

type HomeLogoLinkProps = {
  className?: string
}

export function HomeLogoLink({ className }: HomeLogoLinkProps) {
  return (
    <Link
      to="/"
      aria-label="Tillbaka till dataset"
      title="Tillbaka till dataset"
      data-canvas-ui="true"
      className={cn(
        'absolute top-4 left-4 z-20 block h-12 w-12 overflow-hidden rounded-xl shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
        className
      )}
    >
      <img
        src={appIcon}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
      />
    </Link>
  )
}
