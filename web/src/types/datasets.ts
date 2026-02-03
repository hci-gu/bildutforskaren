export type DatasetJob = {
  stage?: string
  progress?: number
  processed?: number
  skipped?: number
  error?: string
}

export type DatasetStatus = {
  dataset_id?: string
  name?: string
  status?: string
  metadata_source?: string
  has_metadata_xlsx?: boolean
  embeddings_cached?: boolean
  created_at?: string
  error?: string | null
  job?: DatasetJob
}

export type TagStats = {
  total_images: number
  tagged_images: number
  tagged_percent: number
}
