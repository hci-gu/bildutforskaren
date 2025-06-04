import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

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
  filter: false,
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
  const filterSettings = get(filterSettingsAtom)

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
  nNeighbors: 15,
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

export const embeddingProjection = atomFamily((type: string) =>
  atom(async (get) => {
    const embeddingsData = await get(filteredEmbeddingsAtom)
    const projectionSettings = get(projectionSettingsAtom)

    const projectionType = type === 'minimap' ? 'umap' : projectionSettings.type

    if (projectionType === 'umap') {
      const queryParams = new URLSearchParams({
        n_neighbors: projectionSettings.nNeighbors.toString(),
        min_dist: projectionSettings.minDist.toString(),
        spread: projectionSettings.spread.toString(),
        seed: projectionSettings.seed.toString(),
      })

      const response = await fetch(`${API_URL}/umap?${queryParams.toString()}`)
      const embedding2d = await response.json()

      return embedding2d
    } else if (projectionType === 'grid') {
      const gridSize = Math.ceil(Math.sqrt(embeddingsData.length))
      const embedding2d = []
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          embedding2d.push([j / gridSize, i / gridSize])
        }
      }
      return embedding2d
    } else if (projectionType === 'year') {
      const embeddingsWithYear = embeddingsData.filter(
        (item: any) =>
          item.metadata?.year !== undefined && item.metadata.year !== null
      )

      const uniqueYears = [
        ...new Set(embeddingsWithYear.map((item: any) => item.metadata.year)),
      ].sort()

      const yearToColumn = new Map(uniqueYears.map((year, i) => [year, i]))

      const totalColumns = uniqueYears.length + 1 // extra column for items without a year
      const rowSpacing = 0.01

      // Prepare columns
      const columns: number[][][] = Array.from(
        { length: totalColumns },
        () => []
      )
      embeddingsData.sort((a: any, b: any) => {
        // sort by metadata.year existing, not estimate
        const aYear = a.metadata?.year
        const bYear = b.metadata?.year
        if (aYear === undefined || aYear === null) {
          return 1 // a is estimated, b is not
        } else if (bYear === undefined || bYear === null) {
          return -1 // b is estimated, a is not
        }
        return 0
      })

      embeddingsData.forEach((item: any, index: number) => {
        let year = item.metadata?.year
        let estimate = 0
        if (year === undefined || year === null) {
          year = item.metadata?.year_estimate.toString()
          estimate = 1
        }
        const colIndex = yearToColumn.get(year) ?? totalColumns - 1
        columns[colIndex].push([index, estimate])
      })

      // Assign coordinates
      const positions = new Array(embeddingsData.length)
      for (let col = 0; col < totalColumns; col++) {
        const colItems = columns[col]
        for (let row = 0; row < colItems.length; row++) {
          const [originalIndex, estimate] = colItems[row]
          let x = totalColumns === 1 ? 0.5 : col / (totalColumns - 1)
          if (estimate > 0) {
            x += 0.002
          }
          const y = row * rowSpacing
          positions[originalIndex] = [x, y]
        }
      }

      return positions
    }
  })
)
export const projectedEmbeddingsAtom = atomFamily((type: string) =>
  atom(async (get) => {
    let embeddingsData = await get(filteredEmbeddingsAtom)
    const projectionSettings = get(projectionSettingsAtom)
    const projection = await get(embeddingProjection(type))
    const result = await get(searchImagesAtom)

    if (
      type !== 'minimap' &&
      projectionSettings.type === 'grid' &&
      result.length > 0
    ) {
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
    } else if (projectionSettings.type === 'grid') {
      // sort by id
      embeddingsData = embeddingsData.sort((a: any, b: any) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      )
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
)

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
