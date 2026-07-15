import { lazy, Suspense } from 'react'
import { useAtomValue } from 'jotai'
import { loadableEmbeddingsAtom, projectionViewModeAtom } from '@/store'
import { CanvasScene } from './CanvasScene'

const Umap3DScene = lazy(() =>
  import('./Umap3DScene').then((module) => ({ default: module.Umap3DScene }))
)

const EmbeddingsFetchWrapper = () => {
  const embeddings = useAtomValue(loadableEmbeddingsAtom)
  const viewMode = useAtomValue(projectionViewModeAtom)

  if (embeddings.state === 'loading') {
    return (
      <h1
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'white',
          fontSize: 24,
          zIndex: 1000,
        }}
      >
        Laddar in embeddings<br /> ( det kan ta upp till en minut )
      </h1>
    )
  }

  return viewMode === '3d' ? (
    <Suspense
      fallback={
        <div className="fixed inset-0 flex items-center justify-center bg-[#07090e] text-white">
          Laddar 3D-visning…
        </div>
      }
    >
      <Umap3DScene />
    </Suspense>
  ) : (
    <CanvasScene />
  )
}

export default EmbeddingsFetchWrapper
