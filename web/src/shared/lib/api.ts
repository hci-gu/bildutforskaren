type Json = Record<string, any>

export const API_URL = 'http://localhost:3000'
// export const API_URL = 'https://bildutforskaren-api.prod.appadem.in'
// export const API_URL = 'https://leviathan.itit.gu.se'

export const datasetApiUrl = (datasetId: string | null, path: string) => {
  if (!datasetId) {
    throw new Error('No active dataset selected')
  }
  const clean = path.startsWith('/') ? path : `/${path}`
  return `${API_URL}/datasets/${encodeURIComponent(datasetId)}${clean}`
}

const fetchJson = async <T>(input: RequestInfo, init?: RequestInit) => {
  const res = await fetch(input, init)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const message = (data as Json)?.error ?? 'Request failed'
    throw new Error(message)
  }
  return (await res.json()) as T
}

export const fetchBlob = async (input: RequestInfo, init?: RequestInit) => {
  const res = await fetch(input, init)
  if (!res.ok) {
    throw new Error('Request failed')
  }
  return await res.blob()
}

const fetchJsonWithTimeout = async <T>(
  input: RequestInfo,
  init: RequestInit | undefined,
  timeoutMs: number
) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchJson<T>(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export const fetchDatasets = async () => {
  return await fetchJson<any[]>(`${API_URL}/datasets`)
}

export const createDataset = async (name: string) => {
  return await fetchJson<{ dataset_id: string }>(`${API_URL}/datasets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export const uploadDatasetZip = async (datasetId: string, file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  return await fetchJson<Json>(`${API_URL}/datasets/${datasetId}/upload-zip`, {
    method: 'POST',
    body: formData,
  })
}

export const fetchDatasetStatus = async (datasetId: string) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/status`
  )
}

export const fetchTagStats = async (datasetId: string) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/tag-stats`
  )
}

export const seedTagsFromMetadata = async (datasetId: string) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/seed-tags-from-metadata`,
    { method: 'POST' }
  )
}

export const resumeProcessing = async (datasetId: string) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/resume-processing`,
    { method: 'POST' }
  )
}

export const fetchImageMetadata = async (datasetId: string, imageId: number) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/metadata/${imageId}`
  )
}

export const fetchDatasetImages = async (datasetId: string) => {
  return await fetchJson<Json[]>(datasetApiUrl(datasetId, '/images'))
}

export const fetchTaggedImages = async (datasetId: string) => {
  return await fetchJson<Json>(datasetApiUrl(datasetId, '/tagged-images'))
}

export const fetchDatasetTags = async (datasetId: string) => {
  return await fetchJson<Json[]>(datasetApiUrl(datasetId, '/tags'))
}

export const fetchTagsWithImages = async (datasetId: string) => {
  return await fetchJson<Json[]>(datasetApiUrl(datasetId, '/tags/with-images'))
}

export const fetchSaoTermsUmap = async () => {
  return await fetchJson<Json>(`${API_URL}/terms/sao/umap`)
}

export const searchSaoTerms = async (query: string, limit = 20) => {
  return await fetchJson<Json[]>(
    `${API_URL}/terms/sao?q=${encodeURIComponent(query)}&limit=${limit}`
  )
}

export const searchByImage = async (
  datasetId: string,
  file: File,
  topK: number,
  imageIds?: string[] | null
) => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('top_k', String(topK))
  if (imageIds) {
    formData.append('image_ids', JSON.stringify(imageIds))
  }
  return await fetchJson<Json>(datasetApiUrl(datasetId, '/search-by-image'), {
    method: 'POST',
    body: formData,
  })
}

export const searchByText = async (
  datasetId: string,
  query: string,
  topK: number,
  imageIds?: string[] | null
) => {
  const payload: Json = { query, top_k: topK }
  if (imageIds) {
    payload.image_ids = imageIds
  }
  return await fetchJson<Json[]>(datasetApiUrl(datasetId, '/search'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export const fetchEmbeddings = async (datasetId: string, timeoutMs = 60000) => {
  return await fetchJsonWithTimeout<Json[]>(
    datasetApiUrl(datasetId, '/embeddings'),
    undefined,
    timeoutMs
  )
}

export const fetchUmapProjection = async (
  datasetId: string,
  imageIds: number[],
  texts: string[],
  params: {
    n_neighbors: number
    min_dist: number
    n_components: number
    spread: number
    seed: number
  }
) => {
  return await fetchJson<Json>(datasetApiUrl(datasetId, '/umap'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_ids: imageIds, texts, params }),
  })
}

export const fetchEmbeddingById = async (datasetId: string, id: string) => {
  return await fetchJson<Json>(datasetApiUrl(datasetId, `/embedding/${id}`))
}

export const fetchAtlasMeta = async (datasetId: string) => {
  return await fetchJson<Json>(datasetApiUrl(datasetId, '/atlas/meta'))
}

export const fetchImageTags = async (datasetId: string, imageId: number) => {
  return await fetchJson<Json[]>(
    datasetApiUrl(datasetId, `/images/${imageId}/tags`)
  )
}

export const fetchImageTagSuggestions = async (
  datasetId: string,
  imageId: number,
  limit = 3
) => {
  return await fetchJson<Json[]>(
    datasetApiUrl(datasetId, `/images/${imageId}/tag-suggestions?limit=${limit}`)
  )
}

export const addImageTags = async (
  datasetId: string,
  imageId: number,
  labels: string[],
  source = 'manual'
) => {
  return await fetchJson<Json>(
    datasetApiUrl(datasetId, `/images/${imageId}/tags`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels, source }),
    }
  )
}

export const removeImageTags = async (
  datasetId: string,
  imageId: number,
  tagIds: number[],
  source = 'manual'
) => {
  return await fetchJson<Json>(
    datasetApiUrl(datasetId, `/images/${imageId}/tags`),
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_ids: tagIds, source }),
    }
  )
}

export const fetchTagsImagesMulti = async (
  datasetId: string,
  labels: string[]
) => {
  return await fetchJson<Json>(datasetApiUrl(datasetId, '/tags/images-multi'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels }),
  })
}

export const fetchTagSuggestionsSteered = async (
  datasetId: string,
  labels: string[],
  seedImageIds: number[],
  blendAlpha: number,
  limit = 24
) => {
  return await fetchJson<Json>(
    datasetApiUrl(datasetId, '/tags/suggestions-steered'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        labels,
        seed_image_ids: seedImageIds,
        blend_alpha: blendAlpha,
        limit,
      }),
    }
  )
}

export const fetchTagSuggestionsMulti = async (
  datasetId: string,
  labels: string[],
  limit = 24
) => {
  return await fetchJson<Json>(
    datasetApiUrl(datasetId, '/tags/suggestions-multi'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels, limit }),
    }
  )
}

export const fetchTagsCooccurrence = async (
  datasetId: string,
  labels: string[],
  limit = 20
) => {
  return await fetchJson<Json>(datasetApiUrl(datasetId, '/tags/cooccurrence'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels, limit }),
  })
}

export const assignTagsToImages = async (
  datasetId: string,
  labels: string[],
  imageIds: number[],
  source = 'manual'
) => {
  return await fetchJson<Json>(datasetApiUrl(datasetId, '/tags/assign'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels, image_ids: imageIds, source }),
  })
}

export const updateMetadataSource = async (
  datasetId: string,
  source: string
) => {
  return await fetchJson<Json>(datasetApiUrl(datasetId, '/metadata-source'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
}
