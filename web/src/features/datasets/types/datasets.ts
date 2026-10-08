export type DatasetLifecycleStatus =
  | 'created'
  | 'uploading'
  | 'upload_failed'
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'error'
  | 'deleted'

export type EmbeddingModel = 'openai/clip-vit-large-patch14' | 'google/embeddinggemma-2'

export const embeddingModels: { id: EmbeddingModel; label: string }[] = [
  { id: 'openai/clip-vit-large-patch14', label: 'CLIP ViT-L/14' },
  { id: 'google/embeddinggemma-2', label: 'EmbeddingGemma 2' },
]

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
  target?: EmbeddingModel
}

export type DatasetStatus = {
  dataset_id?: string
  name?: string
  status?: DatasetLifecycleStatus | string
  metadata_source?: string
  has_metadata_xlsx?: boolean
  embeddings_cached?: boolean
  embedding_model?: EmbeddingModel
  embedding_fingerprint?: string
  embedding_switch?: {
    target: EmbeddingModel
    status: 'queued' | 'running' | 'complete' | 'error'
    error: string | null
  }
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
  'embedding-model',
])

export const isDatasetActive = (dataset?: DatasetStatus | null) =>
  dataset?.status === 'uploading' ||
  dataset?.status === 'uploaded' ||
  dataset?.status === 'processing' ||
  dataset?.embedding_switch?.status === 'queued' ||
  dataset?.embedding_switch?.status === 'running' ||
  (!!dataset?.job?.stage && activeJobStages.has(dataset.job.stage))

export const hasSameDatasetData = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right)

export type TagStats = {
  total_images: number
  tagged_images: number
  tagged_percent: number
}
