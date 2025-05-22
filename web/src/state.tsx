import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import { UMAP } from 'umap-js'
import seedrandom from 'seedrandom'

export const API_URL = 'http://localhost:3000'

const getTextEmbeddings = async (texts: string[]) => {
  let embeddings = []
  for (let text of texts) {
    console.log('Fetching embedding for text:', text)
    const res = await fetch(
      `${API_URL}/embedding-for-text?query=${encodeURIComponent(text)}`
    )
    const embedding = await res.json()
    embeddings.push({
      embedding,
      text: text,
    })
  }
  return embeddings
}

export const textEmbeddingsAtom = atom([])

// async function plotEmbeddings(embeddingsData: any[]) {
//   let embeddings = embeddingsData.map(
//     (item: { id: string; embedding: number[] }) => item.embedding
//   )
//   const textEmbeddings = await getTextEmbeddings([
//     // 'Waves crashing on cliffs, grayscale photograph',
//     // 'People browsing wares in a market, black and white photograph',
//     // 'Cat',
//     // 'Scifi painting of a futuristic city',
//   ])

//   embeddings = embeddings.concat(
//     textEmbeddings.map((item: { embedding: number[] }) => item.embedding)
//   )

//   for (let i = 0; i < textEmbeddings.length; i++) {
//     embeddingMap.push({
//       id: `text_${i}`,
//       point: embedding2d[embeddings.length - 1 - i],
//       type: 'text',
//       text: textEmbeddings[textEmbeddings.length - 1 - i].text,
//       meta: {
//         matched: false,
//       },
//     })
//   }

//   return embeddingMap
// }

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

export const searchQueryAtom = atom('')
export const searchSettingsAtom = atom({
  topK: 100,
})

export const searchImagesAtom = atomFamily((query: string) =>
  atom(async (get) => {
    const searchSettings = get(searchSettingsAtom)

    if (!query) {
      return []
    }

    try {
      const response = await fetch(
        `${API_URL}/search?query=${encodeURIComponent(query)}&top_k=${
          searchSettings.topK
        }`,
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
    const res = await fetch(`${API_URL}/embeddings`)
    const embeddingsData = await res.json()

    return embeddingsData
  } catch (error) {
    console.error('Failed to fetch images:', error)
    return []
  }
})

export const projectionSettingsAtom = atom({
  nNeighbors: 15,
  minDist: 0.1,
  spread: 1,
  seed: 1,
})

export const embeddingProjection = atom(async (get) => {
  const embeddingsData = await get(embeddingsAtom)
  const projectionSettings = get(projectionSettingsAtom)

  // const result = await fetch(
  //   `${API_URL}/umap?n_neighbors=${projectionSettings.nNeighbors}&min_dist=${projectionSettings.minDist}&spread=${projectionSettings.spread}&seed=${projectionSettings.seed}`
  // )
  // const embedding2d = await result.json()

  let embeddings = embeddingsData.map(
    (item: { id: string; embedding: number[] }) => item.embedding
  )
  const umap = new UMAP({
    nNeighbors: projectionSettings.nNeighbors,
    minDist: projectionSettings.minDist,
    spread: projectionSettings.spread,
    random: seedrandom(projectionSettings.seed),
  })
  const embedding2d = await umap.fitAsync(embeddings)

  return embedding2d
})

export const projectedEmbeddingsAtom = atom(async (get) => {
  const embeddingsData = await get(embeddingsAtom)
  const texts = await get(textEmbeddingsAtom)
  const projection = await get(embeddingProjection)

  // const textEmbeddings = await getTextEmbeddings(texts)

  const projectedEmbeddings = embeddingsData.map(
    (item: any, index: number) => ({
      id: item.id,
      point: projection[index],
      type: 'image',
      meta: {
        ...item.metadata,
        matched: false,
      },
    })
  )
  return projectedEmbeddings
})

export const filteredEmbeddingsAtom = atom(async (get) => {
  const query = get(searchQueryAtom)
  const result = await get(searchImagesAtom(query))

  const embeddings = await get(projectedEmbeddingsAtom)

  return embeddings.map((embedding: any) => {
    const found = result.find((res: any) => res.id === embedding.id)
    return {
      ...embedding,
      meta: {
        ...embedding.meta,
        matched: !!found,
        matchedDistance: found ? found.distance : null,
      },
    }
  })
})

export const selectedEmbeddingAtom = atom(null)

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
