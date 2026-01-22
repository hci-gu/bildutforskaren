import { atom } from 'jotai'
import { atomFamily, loadable } from 'jotai/utils'

export const API_URL = 'http://localhost:3000'
// export const API_URL = 'https://bildutforskaren-api.prod.appadem.in'
// export const API_URL = 'https://leviathan.itit.gu.se'

export const activeDatasetIdAtom = atom<string | null>(null)

export const datasetsRevisionAtom = atom(0)
export const embeddingsRevisionAtom = atom(0)
export const taggedImagesRevisionAtom = atom(0)
export const viewportScaleAtom = atom(1)

export const datasetsAtom = atom(async (get) => {
  // Force refresh when revision changes
  get(datasetsRevisionAtom)

  try {
    const res = await fetch(`${API_URL}/datasets`)
    if (!res.ok) throw new Error('Failed to fetch datasets')
    return await res.json()
  } catch (error) {
    console.error('Failed to fetch datasets:', error)
    return []
  }
})

export const datasetApiUrl = (datasetId: string | null, path: string) => {
  if (!datasetId) {
    throw new Error('No active dataset selected')
  }
  const clean = path.startsWith('/') ? path : `/${path}`
  return `${API_URL}/datasets/${encodeURIComponent(datasetId)}${clean}`
}

export const textsAtom = atom<string[]>([])
export const textItemsAtom = atom((get) => {
  const texts = get(textsAtom)
  return texts.map((text) => ({ text, type: 'text' }))
})

const getImages = async (datasetId: string) => {
  const response = await fetch(datasetApiUrl(datasetId, '/images'))
  if (!response.ok) {
    throw new Error('Network response was not ok')
  }
  const data = await response.json()
  return data
}

export const imagesAtom = atom(async (get) => {
  const datasetId = get(activeDatasetIdAtom)
  if (!datasetId) return []

  try {
    const images = await getImages(datasetId)
    return images
  } catch (error) {
    console.error('Failed to fetch images:', error)
    return []
  }
})

export const taggedImagesAtom = atom(async (get) => {
  const datasetId = get(activeDatasetIdAtom)
  get(taggedImagesRevisionAtom)
  if (!datasetId) return { tagged: [], untagged: [] }

  try {
    const response = await fetch(datasetApiUrl(datasetId, '/tagged-images'))
    if (!response.ok) {
      throw new Error('Network response was not ok')
    }
    const data = await response.json()
    return {
      tagged: Array.isArray(data.tagged) ? data.tagged : [],
      untagged: Array.isArray(data.untagged) ? data.untagged : [],
    }
  } catch (error) {
    console.error('Failed to fetch tagged images:', error)
    return { tagged: [], untagged: [] }
  }
})

export const datasetTagsAtom = atom(async (get) => {
  const datasetId = get(activeDatasetIdAtom)
  if (!datasetId) return []
  try {
    const response = await fetch(datasetApiUrl(datasetId, '/tags'))
    if (!response.ok) {
      throw new Error('Network response was not ok')
    }
    const data = await response.json()
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.error('Failed to fetch dataset tags:', error)
    return []
  }
})

export const tagsWithImagesAtom = atom(async (get) => {
  const datasetId = get(activeDatasetIdAtom)
  if (!datasetId) return []
  try {
    const response = await fetch(datasetApiUrl(datasetId, '/tags/with-images'))
    if (!response.ok) {
      throw new Error('Network response was not ok')
    }
    const data = await response.json()
    return Array.isArray(data) ? data : []
  } catch (error) {
    console.error('Failed to fetch tags with images:', error)
    return []
  }
})

type SaoUmapData = {
  items: { id: string; text: string; point: [number, number] }[]
  bins: Record<string, number[]>
}

export const saoTermsUmapAtom = atom(async () => {
  try {
    const response = await fetch(`${API_URL}/terms/sao/umap`)
    if (!response.ok) {
      throw new Error('Network response was not ok')
    }
    const data = await response.json()
    const items = Array.isArray(data.items) ? data.items : []
    const mapped = items.map((item: any, index: number) => ({
      id: item.id ?? `sao_${index}`,
      text: item.label,
      point: item.point as [number, number],
    }))

    if (mapped.length === 0) {
      return { items: [], bins: {} } as SaoUmapData
    }

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const item of mapped) {
      const [x, y] = item.point
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }

    const spanX = Math.max(1e-6, maxX - minX)
    const spanY = Math.max(1e-6, maxY - minY)

    const levels = [20, 40, 80, 120]
    const bins: Record<string, number[]> = {}

    for (const level of levels) {
      const seen = new Set<string>()
      const picked: number[] = []
      mapped.forEach((item, index) => {
        const nx = (item.point[0] - minX) / spanX
        const ny = (item.point[1] - minY) / spanY
        const gx = Math.min(level - 1, Math.max(0, Math.floor(nx * level)))
        const gy = Math.min(level - 1, Math.max(0, Math.floor(ny * level)))
        const key = `${gx}:${gy}`
        if (seen.has(key)) return
        seen.add(key)
        picked.push(index)
      })
      bins[String(level)] = picked
    }

    return { items: mapped, bins } as SaoUmapData
  } catch (error) {
    console.error('Failed to fetch SAO term projection:', error)
    return { items: [], bins: {} } as SaoUmapData
  }
})
export const searchQueryAtom = atom('')
export const searchImageAtom = atom<File | null>(null)
export const hoveredTextAtom = atom<string | null>(null)
export const searchSettingsAtom = atom({
  topK: 100,
  filter: false,
})

export const searchImagesAtom = atom(async (get) => {
  const datasetId = get(activeDatasetIdAtom)
  const query = get(searchQueryAtom)
  const image = get(searchImageAtom)
  const searchSettings = get(searchSettingsAtom)
  const activeEmbeddingIds = get(activeEmbeddingIdsAtom)

  if (!datasetId) {
    return []
  }

  if (!query && !image) {
    return []
  }

  if (image) {
    const formData = new FormData()
    formData.append('file', image)
    formData.append('top_k', String(searchSettings.topK))
    if (activeEmbeddingIds) {
      formData.append('image_ids', JSON.stringify(activeEmbeddingIds))
    }

    try {
      const response = await fetch(datasetApiUrl(datasetId, '/search-by-image'), {
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
    const payload: any = {
      query,
      top_k: searchSettings.topK,
    }
    if (activeEmbeddingIds) {
      payload.image_ids = activeEmbeddingIds
    }

    const response = await fetch(datasetApiUrl(datasetId, '/search'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      throw new Error('Network response was not ok')
    }
    const data = await response.json()

    if (activeEmbeddingIds) {
      const activeSet = new Set(activeEmbeddingIds.map(String))
      return data.filter((item: any) => activeSet.has(String(item.id)))
    }

    return data
  } catch (error) {
    console.error('Failed to fetch search results:', error)
    return []
  }
})

export const embeddingsAtom = atom(async (get) => {
  const datasetId = get(activeDatasetIdAtom)
  get(embeddingsRevisionAtom)
  if (!datasetId) return []

  try {
    const controller = new AbortController()
    const timeout = 60000 // 60s
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    let res
    try {
      res = await fetch(datasetApiUrl(datasetId, '/embeddings'), {
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!res.ok) {
      throw new Error('Network response was not ok')
    }

    const embeddingsData = await res.json()
    return embeddingsData
  } catch (error) {
    console.error('Failed to fetch embeddings:', error)
    return []
  }
})
export const loadableEmbeddingsAtom = loadable(embeddingsAtom)

export const filteredEmbeddingsAtom = atom(async (get) => {
  let embeddingsData = await get(embeddingsAtom)
  const textItems = get(textItemsAtom)
  const filterSettings = get(filterSettingsAtom)
  const activeEmbeddingIds = get(activeEmbeddingIdsAtom)

  let filtered = embeddingsData.filter((item: any) => {
    const matchesYear =
      !filterSettings.year || item.metadata?.year === filterSettings.year
    const matchesPhotographer =
      !filterSettings.photographer ||
      item.metadata?.photographer === filterSettings.photographer

    return matchesYear && matchesPhotographer
  })

  if (activeEmbeddingIds && activeEmbeddingIds.length > 0) {
    const activeIds = new Set(activeEmbeddingIds.map(String))
    filtered = filtered.filter((item: any) => activeIds.has(String(item.id)))
  } else if (activeEmbeddingIds && activeEmbeddingIds.length === 0) {
    filtered = []
  }

  if (
    !activeEmbeddingIds &&
    !filterSettings.year &&
    !filterSettings.photographer
  ) {
    return [...filtered, ...textItems]
  }

  return filtered
})

export const projectionSettingsAtom = atom({
  type: 'grid',
  nNeighbors: 15,
  minDist: 0.1,
  spread: 1,
  seed: 1,
  saoOnlyDataset: false,
  groupTaggedByTag: false,
})

export const displaySettingsAtom = atom({
  colorPhotographer: false,
  scale: 1,
})

export const filterSettingsAtom = atom({
  year: null,
  photographer: null,
})

export const activeEmbeddingIdsAtom = atom<string[] | null>(null)
export const selectionHistoryAtom = atom<(string[] | null)[]>([])
export const projectionRevisionAtom = atom(0)

export const embeddingProjection = atomFamily((type: string) =>
  atom(async (get) => {
    const datasetId = get(activeDatasetIdAtom)
    const embeddingsData = await get(filteredEmbeddingsAtom)
    const projectionSettings = get(projectionSettingsAtom)
    const filterSettings = get(filterSettingsAtom)

    if (!datasetId) {
      const gridSize = Math.ceil(Math.sqrt(embeddingsData.length))
      const embedding2d = []
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          embedding2d.push([j / gridSize, i / gridSize])
        }
      }
      return embedding2d
    }

    const projectionType = type === 'minimap' ? 'umap' : projectionSettings.type

    if (projectionType === 'tagged') {
      const items = embeddingsData.filter((item: any) => item.type !== 'text')
      const tagInfo = await get(taggedImagesAtom)
      const taggedSet = new Set(tagInfo.tagged.map(String))

      const tagged = items
        .filter((item: any) => taggedSet.has(String(item.id)))
        .sort((a: any, b: any) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      const untagged = items
        .filter((item: any) => !taggedSet.has(String(item.id)))
        .sort((a: any, b: any) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

      const positions = new Map<number, [number, number]>()
      const gutter = 0.06
      const blockWidth = (1 - gutter) / 2
      const leftX = 0
      const rightX = blockWidth + gutter

      const placeGrid = (list: any[], originX: number, width: number) => {
        if (list.length === 0) return
        const gridSize = Math.ceil(Math.sqrt(list.length))
        const rows = Math.ceil(list.length / gridSize)
        const denomX = Math.max(1, gridSize - 1)
        const denomY = Math.max(1, rows - 1)
        list.forEach((item: any, index: number) => {
          const row = Math.floor(index / gridSize)
          const col = index % gridSize
          const x = originX + (denomX === 0 ? width / 2 : (col / denomX) * width)
          const y = denomY === 0 ? 0.5 : row / denomY
          positions.set(item.id, [x, y])
        })
      }

      placeGrid(tagged, leftX, blockWidth)
      placeGrid(untagged, rightX, blockWidth)

      return items.map((item: any) => positions.get(item.id) ?? [0, 0])
    }

    if (projectionType === 'umap') {
      const imageItems = embeddingsData.filter((item: any) => item.type !== 'text')
      const imageIds = imageItems.map((item: any) => item.id)
      const includeTexts = !filterSettings.year && !filterSettings.photographer
      const texts = includeTexts ? get(textsAtom) : []

      const res = await fetch(datasetApiUrl(datasetId, '/umap'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_ids: imageIds,
          texts,
          params: {
            n_neighbors: projectionSettings.nNeighbors,
            min_dist: projectionSettings.minDist,
            n_components: 2,
            spread: projectionSettings.spread,
            seed: projectionSettings.seed,
          },
        }),
      })

      if (!res.ok) {
        throw new Error('UMAP request failed')
      }

      const data = await res.json()
      const imagePointsById = new Map<number, [number, number]>()
      for (let i = 0; i < data.image_ids.length; i++) {
        imagePointsById.set(data.image_ids[i], data.image_points[i])
      }

      let textIndex = 0
      const embedding2d = embeddingsData.map((item: any) => {
        if (item.type === 'text') {
          const point = data.text_points?.[textIndex]
          textIndex += 1
          return point ?? [0, 0]
        }
        return imagePointsById.get(item.id) ?? [0, 0]
      })

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
        (item: any) => item.metadata?.year !== undefined && item.metadata.year !== null
      )

      const uniqueYears = [
        ...new Set(embeddingsWithYear.map((item: any) => item.metadata.year)),
      ].sort()

      const yearToColumn = new Map(uniqueYears.map((year, i) => [year, i]))

      const totalColumns = uniqueYears.length + 1 // extra column for items without a year
      const rowSpacing = 0.01

      // Prepare columns
      const columns: number[][][] = Array.from({ length: totalColumns }, () => [])
      embeddingsData.sort((a: any, b: any) => {
        const aYear = a.metadata?.year
        const bYear = b.metadata?.year
        if (aYear === undefined || aYear === null) {
          return 1
        } else if (bYear === undefined || bYear === null) {
          return -1
        }
        return 0
      })

      embeddingsData.forEach((item: any, index: number) => {
        let year = item.metadata?.year
        let estimate = 0
        if (year === undefined || year === null) {
          year = item.metadata?.year_estimate?.toString()
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

    if (projectionSettings.type === 'sao') {
      const saoData = await get(saoTermsUmapAtom)
      const items = saoData.items
      const scale = get(viewportScaleAtom)
      let level = 20
      if (scale >= 0.8) level = 40
      if (scale >= 1.4) level = 80
      if (scale >= 2.2) level = 120

      const indices = saoData.bins[String(level)] || []
      if (projectionSettings.saoOnlyDataset) {
        const tagRows = await get(datasetTagsAtom)
        const tagSet = new Set(
          tagRows.map((row: any) => String(row.label || '').toLowerCase())
        )
        const filtered = items.filter((item: any) =>
          tagSet.has(String(item.text || '').toLowerCase())
        )
        return filtered.map((item: any) => ({
          id: item.id,
          point: item.point,
          type: 'text',
          text: item.text,
          meta: {
            matched: false,
          },
        }))
      }
      let sampled = indices.map((idx) => items[idx]).filter(Boolean)
      const maxLabels = scale >= 2.5 ? 3500 : scale >= 1.4 ? 2500 : 1500
      if (sampled.length > maxLabels) {
        const step = Math.ceil(sampled.length / maxLabels)
        sampled = sampled.filter((_, index) => index % step === 0)
      }

      return sampled.map((item: any) => ({
        id: item.id,
        point: item.point,
        type: 'text',
        text: item.text,
        meta: {
          matched: false,
        },
      }))
    }

    if (projectionSettings.type === 'tagged' && projectionSettings.groupTaggedByTag) {
      const items = embeddingsData.filter((item: any) => item.type !== 'text')
      const tagsWithImages = await get(tagsWithImagesAtom)
      const itemById = new Map<number, any>(
        items.map((item: any) => [Number(item.id), item])
      )
      const taggedMap: Array<{ label: string; image_ids: number[] }> = tagsWithImages
        .map((entry: any) => ({
          label: entry.label,
          image_ids: Array.isArray(entry.image_ids) ? entry.image_ids : [],
        }))
        .filter((entry) => entry.image_ids.length > 0)

      const taggedSet = new Set<number>()
      taggedMap.forEach((entry) => {
        entry.image_ids.forEach((id) => taggedSet.add(Number(id)))
      })
      const untagged = items.filter((item: any) => !taggedSet.has(Number(item.id)))

      const positions = new Map<number, [number, number]>()
      const textHeaders: { id: string; point: [number, number]; text: string }[] = []

      const gutter = 0.05
      const taggedWidth = 0.7
      const untaggedWidth = 1 - taggedWidth - gutter
      const taggedX = 0
      const untaggedX = taggedWidth + gutter

      const groupCount = taggedMap.length || 1
      const groupCols = groupCount >= 14 ? 3 : 2
      const colGutter = 0.03
      const cellW = (taggedWidth - colGutter * (groupCols - 1)) / groupCols

      const truncateLabel = (label: string) => {
        const maxChars = groupCols === 3 ? 16 : 20
        if (label.length <= maxChars) return label
        return `${label.slice(0, maxChars - 1)}…`
      }

      const gridCols = 26
      const dx = cellW / gridCols
      const dy = dx
      const padX = cellW * 0.03
      const padY = 0.01
      const headerH = 0.035

      const columns: Array<{ height: number }> = Array.from({ length: groupCols }, () => ({
        height: 0,
      }))

      const assigned = new Set<number>()

      const sortedTagged = [...taggedMap].sort(
        (a, b) => b.image_ids.length - a.image_ids.length
      )

      sortedTagged.forEach((group, groupIndex) => {
        const ids = group.image_ids
          .map((id) => Number(id))
          .filter((id) => itemById.has(id) && !assigned.has(id))
        if (!ids.length) return

        const cols = gridCols
        const rows = Math.ceil(ids.length / cols)
        const blockHeight = headerH + padY + (rows - 1) * dy + dy * 0.6

        let targetCol = 0
        for (let i = 1; i < columns.length; i++) {
          if (columns[i].height < columns[targetCol].height) {
            targetCol = i
          }
        }

        const originX = taggedX + targetCol * (cellW + colGutter)
        const originY = columns[targetCol].height

        const label = truncateLabel(group.label || 'Tagg')
        textHeaders.push({
          id: `tag_${groupIndex}`,
          text: label,
          point: [originX + padX, originY + headerH * 0.5],
        })

        ids.forEach((id, index) => {
          const r = Math.floor(index / cols)
          const c = index % cols
          const x = originX + padX + c * dx
          const y = originY + headerH + padY + r * dy
          positions.set(id, [x, y])
          assigned.add(id)
        })

        columns[targetCol].height = originY + blockHeight + dy * 0.4
      })

      if (untagged.length) {
        const gridSize = Math.ceil(Math.sqrt(untagged.length))
        const rows = Math.ceil(untagged.length / gridSize)
        const denomX = Math.max(1, gridSize - 1)
        const denomY = Math.max(1, rows - 1)
        untagged.forEach((item: any, index: number) => {
          const r = Math.floor(index / gridSize)
          const c = index % gridSize
          const x = untaggedX + (denomX === 0 ? untaggedWidth * 0.1 : (c / denomX) * untaggedWidth)
          const y = denomY === 0 ? 0.1 : r * dy
          positions.set(Number(item.id), [x, y])
        })
        textHeaders.push({
          id: 'untagged_header',
          text: 'Otaggade',
          point: [untaggedX + untaggedWidth / 2, 0.03],
        })
      }

      const imageEmbeddings = items.map((item: any) => ({
        id: item.id,
        point: positions.get(Number(item.id)) ?? [0, 0],
        type: 'image',
        text: item.text,
        meta: {
          ...item.metadata,
          matched: false,
        },
      }))

      if (type === 'minimap') {
        return imageEmbeddings
      }

      const headerEmbeddings = textHeaders.map((header) => ({
        id: header.id,
        point: header.point,
        type: 'text',
        text: header.text,
        meta: { matched: false },
      }))

      return [...imageEmbeddings, ...headerEmbeddings]
    }

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
          return -1
        } else if (bFound) {
          return 1
        }
        return 0
      })
    } else if (projectionSettings.type === 'grid') {
      embeddingsData = embeddingsData.sort((a: any, b: any) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      )
    } else if (projectionSettings.type === 'tagged') {
      embeddingsData = embeddingsData.filter((item: any) => item.type !== 'text')
    }

    const projectedEmbeddings = embeddingsData.map((item: any, index: number) => ({
      id: item.id,
      point: projection[index],
      type: item.type === 'text' ? 'text' : 'image',
      text: item.text,
      meta: {
        ...item.metadata,
        matched: false,
      },
    }))

    if (projectionSettings.type == 'year') {
      const embeddingsWithYear = embeddingsData.filter(
        (item: any) => item.metadata?.year !== undefined && item.metadata.year !== null
      )
      const uniqueYears = [
        ...new Set(embeddingsWithYear.map((item: any) => item.metadata.year)),
      ].sort()

      const yearToColumn = new Map(uniqueYears.map((year, i) => [year, i]))
      const totalColumns = uniqueYears.length + 1

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

export const loadableProjectedEmbeddingsAtom = atomFamily((type: string) =>
  loadable(projectedEmbeddingsAtom(type))
)

export const selectedEmbeddingAtom = atom(null)
export const selectedEmbeddingIdsAtom = atom<string[]>([])
export const selectedTagAtom = atom<string | null>(null)

export const embeddingAtom = atomFamily((id: string) =>
  atom(async (get) => {
    const datasetId = get(activeDatasetIdAtom)
    if (!datasetId) return null

    try {
      const response = await fetch(datasetApiUrl(datasetId, `/embedding/${id}`))
      if (!response.ok) {
        throw new Error('Network response was not ok')
      }
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Failed to fetch image embedding:', error)
      return null
    }
  })
)

export const loadableDatasetsAtom = loadable(datasetsAtom)
