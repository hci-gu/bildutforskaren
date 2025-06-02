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
export const searchImageAtom = atom(null)
export const searchSettingsAtom = atom({
  topK: 100,
})

export const searchImagesAtom = atom(async (get) => {
  const query = get(searchQueryAtom)
  const image = get(searchImageAtom)
  const searchSettings = get(searchSettingsAtom)

  if (!query && !image) {
    return []
  }

  if (image) {
    const formData = new FormData()
    formData.append('file', image)
    console.log('searching by image', formData)

    try {
      const response = await fetch(`${API_URL}/search-by-image`, {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Failed to fetch search results by image:', error)
      return []
    }
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

export const filteredEmbeddingsAtom = atom(async (get) => {
  let embeddingsData = await get(embeddingsAtom)
  const projectionSettings = get(projectionSettingsAtom)
  const filterSettings = get(filterSettingsAtom)

  if (projectionSettings.type === 'year') {
    // Filter out items without a year
    embeddingsData = embeddingsData.filter(
      (item: any) =>
        item.metadata?.year !== undefined && item.metadata.year !== null
    )
  }

  if (!filterSettings.year && !filterSettings.photographer) {
    return embeddingsData
  }

  return embeddingsData.filter((item: any) => {
    const matchesYear =
      !filterSettings.year || item.metadata?.year === filterSettings.year
    const matchesPhotographer =
      !filterSettings.photographer ||
      item.metadata?.photographer === filterSettings.photographer

    return matchesYear && matchesPhotographer
  })
})

export const projectionSettingsAtom = atom({
  type: 'grid',
  nNeighbors: 2,
  minDist: 0.1,
  spread: 1,
  seed: 1,
})

export const displaySettingsAtom = atom({
  colorPhotographer: false,
  scale: 1,
})

export const filterSettingsAtom = atom({
  year: null,
  photographer: null,
})

const projectionCache = new Map()

export const embeddingProjection = atom(async (get) => {
  const embeddingsData = await get(filteredEmbeddingsAtom)
  const projectionSettings = get(projectionSettingsAtom)

  if (projectionSettings.type === 'umap') {
    let embeddings = embeddingsData.map(
      (item: { id: string; embedding: number[] }) => item.embedding
    )
    const umap = new UMAP({
      nNeighbors: projectionSettings.nNeighbors,
      minDist: projectionSettings.minDist,
      spread: projectionSettings.spread,
      random: seedrandom(projectionSettings.seed),
    })
    const cacheKey = `${projectionSettings.nNeighbors}-${projectionSettings.minDist}-${projectionSettings.spread}-${projectionSettings.seed}`
    if (projectionCache.has(cacheKey)) {
      return projectionCache.get(cacheKey)
    }
    const embedding2d = await umap.fitAsync(embeddings)
    projectionCache.set(cacheKey, embedding2d)

    return embedding2d
  } else if (projectionSettings.type === 'grid') {
    const gridSize = Math.ceil(Math.sqrt(embeddingsData.length))
    const embedding2d = []
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        embedding2d.push([i / gridSize, j / gridSize])
      }
    }
    return embedding2d
  } else if (projectionSettings.type === 'year') {
    const embeddingsWithYear = embeddingsData.filter(
      (item: any) =>
        item.metadata?.year !== undefined && item.metadata.year !== null
    )

    const uniqueYears = [
      ...new Set(embeddingsWithYear.map((item: any) => item.metadata.year)),
    ].sort()

    const yearToColumn = new Map(uniqueYears.map((year, i) => [year, i]))

    const totalColumns = uniqueYears.length + 1 // extra column for items without a year
    const rowSpacing = 1

    // Prepare columns
    const columns: number[][][] = Array.from({ length: totalColumns }, () => [])
    embeddingsData.forEach((item: any, index: number) => {
      const year = item.metadata?.year
      const colIndex = yearToColumn.get(year)!
      columns[colIndex].push([index])
    })

    // Assign coordinates
    const positions = new Array(embeddingsData.length)
    for (let col = 0; col < totalColumns; col++) {
      const colItems = columns[col]
      for (let row = 0; row < colItems.length; row++) {
        const [originalIndex] = colItems[row]
        const x = totalColumns === 1 ? 0.5 : col / (totalColumns - 1)
        const y = row * rowSpacing * 10
        positions[originalIndex] = [x, y]
      }
    }

    return positions
  }
})

export const projectedEmbeddingsAtom = atom(async (get) => {
  const projectionSettings = get(projectionSettingsAtom)
  let embeddingsData = await get(filteredEmbeddingsAtom)
  // const texts = await get(textEmbeddingsAtom)
  const projection = await get(embeddingProjection)
  const result = await get(searchImagesAtom)
  // const textEmbeddings = await getTextEmbeddings(texts)

  if (projectionSettings.type === 'grid' && result.length > 0) {
    // sort by search results, all matches will be at the top
    const resultIds = new Set(result.map((res: any) => res.id))
    console.log('resultIds', resultIds)

    embeddingsData = embeddingsData.sort((a: any, b: any) => {
      const aFound = result.find((res: any) => res.id === a.id)
      const bFound = result.find((res: any) => res.id === b.id)
      if (aFound && bFound) {
        const aIsCloser = aFound.distance < bFound.distance
        const bIsCloser = bFound.distance < aFound.distance
        return aIsCloser ? -1 : bIsCloser ? 1 : 0
      } else if (aFound) {
        return -1 // a is found, b is not
      } else if (bFound) {
        return 1 // b is found, a is not
      }
      return 0 // neither are found
    })
  }

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
  if (projectionSettings.type == 'year') {
    const embeddingsWithYear = embeddingsData.filter(
      (item: any) =>
        item.metadata?.year !== undefined && item.metadata.year !== null
    )
    const uniqueYears = [
      ...new Set(embeddingsWithYear.map((item: any) => item.metadata.year)),
    ].sort()
    // const yearMap = {}
    // uniqueYears.forEach((year, index) => {
    //   yearMap[year] = 0
    // })
    // for (let item of embeddingsWithYear) {
    //   if (item.metadata?.year !== undefined && item.metadata.year !== null) {
    //     yearMap[item.metadata.year] += 1
    //   }
    // }

    const yearToColumn = new Map(uniqueYears.map((year, i) => [year, i]))
    const totalColumns = uniqueYears.length + 1 // extra column for items without a year

    for (let year of uniqueYears) {
      const columnIndex = yearToColumn.get(year)!
      projectedEmbeddings.push({
        id: `year_${year}`,
        point: [columnIndex / (totalColumns - 1), 0],
        text: year,
        type: 'text',
        meta: {
          matched: false,
        },
      })
    }
  }

  return projectedEmbeddings.map((embedding: any) => {
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
