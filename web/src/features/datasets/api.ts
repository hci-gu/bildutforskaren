import { API_URL, datasetApiUrl } from '@/store'
import type { DatasetStatus, TagStats } from '@/features/datasets/types/datasets'

type Json = Record<string, any>

const fetchJson = async <T>(input: RequestInfo, init?: RequestInit) => {
  const res = await fetch(input, init)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const message = (data as Json)?.error ?? 'Request failed'
    throw new Error(message)
  }
  return (await res.json()) as T
}

export const fetchDatasets = async () => {
  try {
    return await fetchJson<any[]>(`${API_URL}/datasets`)
  } catch (error) {
    console.error('Failed to fetch datasets:', error)
    return []
  }
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
  return await fetchJson<DatasetStatus>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/status`
  )
}

export const fetchTagStats = async (datasetId: string) => {
  return await fetchJson<TagStats>(
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
