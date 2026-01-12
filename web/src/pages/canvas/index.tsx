import { useAtomValue } from 'jotai'
import { loadableEmbeddingsAtom } from '@/state'
import { CanvasScene } from './CanvasScene'

const EmbeddingsFetchWrapper = () => {
  const embeddings = useAtomValue(loadableEmbeddingsAtom)

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

  return <CanvasScene />
}

export default EmbeddingsFetchWrapper
