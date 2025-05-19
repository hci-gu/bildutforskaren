import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import { UMAP } from 'umap-js'
import seedrandom from 'seedrandom'

export const API_URL = 'http://localhost:3000'

async function loadAndPlotEmbeddings() {
  const res = await fetch(`${API_URL}/embeddings`)
  const embeddingsData = await res.json()

  const embeddings = embeddingsData.map(
    (item: { id: string; embedding: number[] }) => item.embedding
  )
  console.log('embeddings:', embeddings)
  const umap = new UMAP({
    nNeighbors: 15,
    minDist: 0.1,
    random: seedrandom('static'),
  })
  const embedding2d = umap.fit(embeddings)

  const embeddingMap = embeddingsData.map(
    (item: { id: string }, index: number) => ({
      id: item.id,
      point: embedding2d[index],
    })
  )

  console.log('Embedding Map:', embeddingMap)

  return embeddingMap
}

const getImages = async () => {
  const response = await fetch(`${API_URL}/images`)
  if (!response.ok) {
    throw new Error('Network response was not ok')
  }
  const data = await response.json()

  return data
}

export const imagesAtom = atom(async (_) => {
  try {
    const images = await getImages()
    return images
  } catch (error) {
    console.error('Failed to fetch images:', error)
    return []
  }
})

export const searchImagesAtom = atomFamily((query: string) =>
  atom(async () => {
    try {
      const response = await fetch(
        `${API_URL}/search?query=${encodeURIComponent(query)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Failed to fetch search results:', error)
      return []
    }
  })
)

export const embeddingsAtom = atom(async (_) => {
  try {
    const embeddings2D = await loadAndPlotEmbeddings()
    return embeddings2D
  } catch (error) {
    console.error('Failed to fetch images:', error)
    return []
  }
})

export const embeddingAtom = atomFamily((id: string) =>
  atom(async () => {
    try {
      const response = await fetch(`${API_URL}/embedding/${id}`)
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Failed to fetch image:', error)
      return null
    }
  })
)
