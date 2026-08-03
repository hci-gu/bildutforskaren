export type DatasetLifecycleStatus =
  | 'created'
  | 'uploading'
  | 'upload_failed'
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'error'
  | 'deleted'

export type DatasetJob = {
  stage?: string
  progress?: number
  processed?: number
  skipped?: number
  remaining?: number
  total_work?: number
  eta_seconds?: number | null
  seconds_per_item?: number | null
  eta_window?: number
  error?: string
}

export type DatasetStatus = {
  dataset_id?: string
  name?: string
  status?: DatasetLifecycleStatus | string
  metadata_source?: string
  has_metadata_xlsx?: boolean
  embeddings_cached?: boolean
  image_roundtrip?: {
    total: number
    complete: number
    missing: number
    missing_by_kind?: Record<string, number>
    existing_by_kind?: Record<string, number>
    existing_groups?: {
      clip?: number
      florence?: number
      sdxl?: number
      ip_adapter?: number
    }
    root?: string
  } | null
  cluster_previews?: {
    exists: boolean
    levels: number
    requested_levels?: number
    clusters: number
    images: number
    root?: string
    created_at?: string
    params?: Record<string, unknown>
    clustering?: {
      algorithm: 'kmeans' | 'dbscan' | 'hdbscan'
      method: 'recursive' | 'single_run'
      feature_space: 'umap_2d'
      parameters: Record<string, unknown>
    }
    image_generation?: {
      method: 'average_ip_adapter_embedding'
      size: number
    }
  } | null
  created_at?: string
  error?: string | null
  job?: DatasetJob
}

const activeJobStages = new Set([
  'queued',
  'thumbnails',
  'indexing',
  'embeddings',
  'atlas',
  'image-roundtrip',
  'cluster-previews',
])

export const isDatasetActive = (dataset?: DatasetStatus | null) =>
  dataset?.status === 'uploading' ||
  dataset?.status === 'uploaded' ||
  dataset?.status === 'processing' ||
  (!!dataset?.job?.stage && activeJobStages.has(dataset.job.stage))

export type TagStats = {
  total_images: number
  tagged_images: number
  tagged_percent: number
}
