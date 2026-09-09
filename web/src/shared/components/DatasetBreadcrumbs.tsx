import { Link } from 'react-router'

export function DatasetBreadcrumbs({
  datasetId,
  currentPage = 'dataset',
}: {
  datasetId: string | null
  currentPage?: 'dataset' | 'canvas'
}) {
  const linkClassName =
    'underline underline-offset-4 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white'

  return (
    <nav
      aria-label="Brödsmulor"
      data-canvas-ui="true"
      className="fixed top-4 left-4 z-20 text-xs text-white/70"
    >
      <ol className="flex items-center gap-2">
        <li>
          <Link to="/" className={linkClassName}>Start</Link>
        </li>
        {currentPage === 'canvas' && datasetId && (
          <>
            <li aria-hidden="true">/</li>
            <li>
              <Link to={`/dataset/${datasetId}`} className={linkClassName}>
                Dataset
              </Link>
            </li>
          </>
        )}
        <li aria-hidden="true">/</li>
        <li aria-current="page" className="text-white/50">
          {currentPage === 'canvas' ? 'Canvas' : 'Dataset'}
        </li>
      </ol>
    </nav>
  )
}
