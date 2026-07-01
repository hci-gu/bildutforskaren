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
  status?: string
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
    }
    root?: string
  } | null
  created_at?: string
  error?: string | null
  job?: DatasetJob
}

export type TagStats = {
  total_images: number
  tagged_images: number
  tagged_percent: number
}
