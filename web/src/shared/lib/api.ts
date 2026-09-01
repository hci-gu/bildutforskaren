type Json = Record<string, any>

export type Cluster = {
  centroid_position: [number, number]
  num_points: number
  points: [number, number][]
  point_indices: number[]
  label?: string
  label_score?: number
}

export type ClusteringAlgorithm = 'kmeans' | 'dbscan' | 'hdbscan'

export type ClusteringConfig = {
  algorithm: ClusteringAlgorithm
  parameters?: Record<string, unknown>
}

export type ClusteringMetadata = {
  algorithm: ClusteringAlgorithm
  method: 'recursive' | 'single_run'
  feature_space: 'umap_2d'
  parameters: Record<string, unknown>
}

export type ClusteringResult = {
  clustering: ClusteringMetadata
  clusters: Cluster[]
  ignored_noise_point_indices: number[]
}

export type SaoConceptMetadata = {
  concept_id: string
  label: string
  scope_note: string
}

export type ConceptLensImageScore = {
  similarity: number
  percentile: number
}

export type ConceptLensImage = {
  image_id: number
  scores: Record<string, ConceptLensImageScore>
  comparison_delta?: number
}

export type ConceptLensAxis =
  | {
      available: true
      mode: 'single' | 'contrast'
      dimension: 2 | 3
      start: number[]
      end: number[]
      direction: number[]
      r_squared: number
      stability: number
      bootstrap_samples: number
      boundary: 'convex_hull_inset'
    }
  | {
      available: false
      mode: 'single' | 'contrast'
      dimension?: 2 | 3
      reason: string
    }

export type ConceptLensResponse = {
  dataset_id: string
  concepts: SaoConceptMetadata[]
  images: ConceptLensImage[]
  axis: ConceptLensAxis
}

export type ClusterProfileConcept = SaoConceptMetadata & {
  cluster_score: number
  baseline_score: number
  delta: number
  strongest_rank: number | null
  delta_direction: 'more' | 'less' | null
  delta_rank: number | null
}

export type ExplainedCluster = {
  cluster_id: number
  centroid_position: [number, number]
  image_ids: number[]
  image_count: number
  relevance_threshold: number
  profile: {
    strongest: ClusterProfileConcept[]
    more_prominent: ClusterProfileConcept[]
    less_prominent: ClusterProfileConcept[]
  }
}

export type ClusterProfilesResponse = {
  dataset_id: string
  clustering: ClusteringMetadata
  clusters: ExplainedCluster[]
  noise_image_ids: number[]
}

export type ProjectionStabilityConcept = SaoConceptMetadata & {
  similarity: number
}

export type ProjectionStabilityCluster = {
  cluster_id: number
  image_ids: number[]
  image_count: number
  centroid_position: [number, number]
  stability: number
  concepts: ProjectionStabilityConcept[]
}

export type ProjectionStabilityImage = {
  image_id: number
  reference_cluster_id: number | null
  stability: number
}

export type ProjectionStabilityResult = {
  dataset_id: string
  runs: number
  ambiguity_threshold: number
  overall_stability: number
  clusters: ProjectionStabilityCluster[]
  images: ProjectionStabilityImage[]
  ambiguous_images: ProjectionStabilityImage[]
  noise_image_ids: number[]
  clustering: {
    algorithm: 'hdbscan'
    feature_space: 'umap_2d'
  }
  params: {
    n_neighbors: number
    min_dist: number
    spread: number
    seed: number
  }
}

export type ProjectionStabilityJob = {
  job_id: string
  dataset_id: string
  status:
    | 'queued'
    | 'running'
    | 'complete'
    | 'error'
    | 'cancelled'
    | 'cancelling'
  progress: number
  completed_runs?: number
  total_runs?: number
  result?: ProjectionStabilityResult | null
  error?: string | null
}

export type ClusterPreview = {
  id: string
  parent_id: string | null
  level: number
  image_ids: number[]
  image_count: number
  centroid: [number, number]
  bounds: {
    min_x: number
    min_y: number
    max_x: number
    max_y: number
    width: number
    height: number
  }
  image_path: string
  has_image: boolean
}

export type ClusterPreviewManifest = {
  dataset_id: string
  requested_levels: number
  effective_levels: number
  params: Record<string, unknown>
  clustering: ClusteringMetadata
  image_generation: {
    method: 'average_ip_adapter_embedding'
    size: number
  }
  projection: {
    image_ids: number[]
    image_points: [number, number][]
  }
  clusters: ClusterPreview[]
}

export type GraphLayout = 'force' | 'concentric'

export type GraphNetworkRequest = {
  root_image_id: number
  max_depth: number
  neighbors_per_node: number
  max_nodes: number
  min_similarity: number
}

export type GraphNetworkNode = {
  id: number
  depth: number
  parent_id: number | null
  similarity_to_parent: number | null
  similarity_to_root: number
  positions: Record<GraphLayout, [number, number]>
}

export type GraphNetworkEdge = {
  source: number
  target: number
  similarity: number
  kind: 'tree' | 'cross'
}

export type GraphNetworkResponse = {
  dataset_id: string
  root_image_id: number
  parameters: Omit<GraphNetworkRequest, 'root_image_id'>
  nodes: GraphNetworkNode[]
  edges: GraphNetworkEdge[]
}

export type AnchorAnalysisParameters = {
  path_steps: number
  retrieval_count: number
  graph_k: number
}

export type AnchorAnalysisPoint = {
  image_id: number
  sim_a: number
  sim_b: number
  t: number
  t_clipped: number
  line_residual: number
  segment_residual: number
  contrast: number
  commonality: number
}

export type AnchorAnalysisPath = {
  connected: boolean
  path_ids: number[]
  edges: Array<{
    source: number
    target: number
    distance: number
    similarity: number
  }>
  total_length: number | null
  maximum_jump: number | null
}

export type AnchorSemanticConcept = {
  concept_id: string
  label: string
  scope_note: string
  score_a: number
  score_b: number
  delta: number
  endpoint_a_rank: number | null
  endpoint_b_rank: number | null
  delta_direction: 'increasing' | 'decreasing' | null
  delta_rank: number | null
  in_endpoint_a: boolean
  in_endpoint_b: boolean
  in_trajectory: boolean
}

export type AnchorSemanticIdealPoint = {
  progress: number
  score: number
}

export type AnchorSemanticObservedPoint = {
  progress: number
  image_id: number | null
  score: number | null
  ideal_score: number
  gap: number | null
}

export type AnchorSemanticTrajectory = {
  concept_id: string
  ideal: AnchorSemanticIdealPoint[]
  interpolation: AnchorSemanticObservedPoint[]
  axis: AnchorSemanticObservedPoint[]
  graph_supported: AnchorSemanticObservedPoint[]
}

export type AnchorSemantics = {
  available: boolean
  error: string | null
  relevance_threshold: number | null
  endpoint_a: AnchorSemanticConcept[]
  endpoint_b: AnchorSemanticConcept[]
  increasing: AnchorSemanticConcept[]
  decreasing: AnchorSemanticConcept[]
  trajectories: AnchorSemanticTrajectory[]
}

export type AnchorAnalysisResponse = {
  dataset_id: string
  anchors: {
    a: {
      ids: number[]
      size: number
      coherence: number
      medoid_id: number
      similarity_to_other: number
    }
    b: {
      ids: number[]
      size: number
      coherence: number
      medoid_id: number
      similarity_to_other: number
    }
    similarity: number
  }
  points: AnchorAnalysisPoint[]
  axis: {
    bins: Array<{
      index: number
      t_start: number
      t_end: number
      image_id: number | null
      residual: number | null
    }>
    path_ids: number[]
  }
  interpolation: {
    angle: number
    steps: Array<{
      index: number
      t: number
      angle: number
      retrievals: Array<{ image_id: number; similarity: number }>
      best_similarity: number | null
    }>
    path_ids: number[]
  }
  graph: {
    k: number
    supported: AnchorAnalysisPath
  }
  semantics: AnchorSemantics
  parameters: AnchorAnalysisParameters
}

export const API_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:3000'
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
  return await fetchJson<any[]>(`${API_URL}/datasets`, { cache: 'no-store' })
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

export const startDatasetUpload = async (datasetId: string) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/upload-attempt`,
    { method: 'POST' }
  )
}

export const reportDatasetUploadFailure = async (datasetId: string) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/upload-failed`,
    { method: 'POST' }
  )
}

export const fetchDatasetStatus = async (datasetId: string) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/status`,
    { cache: 'no-store' }
  )
}

export const deleteDataset = async (datasetId: string) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}`,
    { method: 'DELETE' }
  )
}

export const fetchTagStats = async (datasetId: string) => {
  return await fetchJson<{
    total_images: number
    tagged_images: number
    tagged_percent: number
  }>(`${API_URL}/datasets/${encodeURIComponent(datasetId)}/tag-stats`, {
    cache: 'no-store',
  })
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

export const generateImageRoundtrip = async (datasetId: string) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/image-roundtrip/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  )
}

export const clearImageRoundtripArtifacts = async (
  datasetId: string,
  artifactGroup: 'clip' | 'florence' | 'sdxl' | 'ip_adapter'
) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/image-roundtrip/${artifactGroup}`,
    { method: 'DELETE' }
  )
}

export const generateClusterPreviews = async (
  datasetId: string,
  options: {
    levels?: number
    size?: number
    clustering?: ClusteringConfig
  } = {}
) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/cluster-previews/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    }
  )
}

export const clearClusterPreviews = async (datasetId: string) => {
  return await fetchJson<Json>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/cluster-previews`,
    { method: 'DELETE' }
  )
}

export const fetchClusterPreviewManifest = async (datasetId: string) => {
  return await fetchJson<ClusterPreviewManifest>(
    `${API_URL}/datasets/${encodeURIComponent(datasetId)}/cluster-previews/manifest`,
    { cache: 'no-store' }
  )
}

export const clusterPreviewImageUrl = (datasetId: string, clusterId: string) =>
  `${API_URL}/datasets/${encodeURIComponent(datasetId)}/cluster-previews/images/${encodeURIComponent(clusterId)}.png`

export const fetchImageMetadata = async (
  datasetId: string,
  imageId: number
) => {
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
  saoTermIds: string[],
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
    body: JSON.stringify({ image_ids: imageIds, sao_term_ids: saoTermIds, params }),
  })
}

export const createGraphNetwork = async (
  datasetId: string,
  payload: GraphNetworkRequest
) => {
  return await fetchJson<GraphNetworkResponse>(
    datasetApiUrl(datasetId, '/graph-network'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  )
}

export const createAnchorAnalysis = async (
  datasetId: string,
  payload: {
    anchor_a_ids: number[]
    anchor_b_ids: number[]
    candidate_ids: number[]
    parameters: AnchorAnalysisParameters
  },
  signal?: AbortSignal
) => {
  return await fetchJson<AnchorAnalysisResponse>(
    datasetApiUrl(datasetId, '/anchor-analysis'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    }
  )
}

export const fetchClusters = async (
  datasetId: string,
  points: [number, number][],
  imageIds: number[],
  clustering: ClusteringConfig = { algorithm: 'kmeans' }
) => {
  const response = await fetchJson<ClusteringResult>(
    datasetApiUrl(datasetId, '/clustering'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ X: points, image_ids: imageIds, clustering }),
    }
  )
  console.log('Got clusters:', response)
  return response
}

export const fetchConceptLens = async (
  datasetId: string,
  payload: {
    image_ids: number[]
    concept_ids: string[]
    projection_points: number[][]
  },
  signal?: AbortSignal
) => {
  return await fetchJson<ConceptLensResponse>(
    datasetApiUrl(datasetId, '/concept-lens'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    }
  )
}

export const fetchClusterProfiles = async (
  datasetId: string,
  payload: {
    image_ids: number[]
    projection_points: [number, number][]
    clustering: ClusteringConfig
    levels?: number
  },
  signal?: AbortSignal
) => {
  return await fetchJson<ClusterProfilesResponse>(
    datasetApiUrl(datasetId, '/cluster-profiles'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    }
  )
}

export const startProjectionStabilityJob = async (
  datasetId: string,
  payload: {
    image_ids: number[]
    projection_points: [number, number][]
    params: {
      n_neighbors: number
      min_dist: number
      spread: number
      seed: number
    }
  },
  signal?: AbortSignal
) =>
  await fetchJson<ProjectionStabilityJob>(
    datasetApiUrl(datasetId, '/projection-stability/jobs'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    }
  )

export const fetchProjectionStabilityJob = async (
  datasetId: string,
  jobId: string,
  signal?: AbortSignal
) =>
  await fetchJson<ProjectionStabilityJob>(
    datasetApiUrl(datasetId, `/projection-stability/jobs/${jobId}`),
    { signal }
  )

export const cancelProjectionStabilityJob = async (
  datasetId: string,
  jobId: string
) =>
  await fetchJson<ProjectionStabilityJob>(
    datasetApiUrl(datasetId, `/projection-stability/jobs/${jobId}`),
    { method: 'DELETE' }
  )

export const fetchEmbeddingById = async (datasetId: string, id: string) => {
  return await fetchJson<number[]>(datasetApiUrl(datasetId, `/embedding/${id}`))
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
    datasetApiUrl(
      datasetId,
      `/images/${imageId}/tag-suggestions?limit=${limit}`
    )
  )
}

export const fetchSdxlGenerationStatus = async (
  datasetId: string,
  imageId: number
) => {
  return await fetchJson<Json>(
    datasetApiUrl(datasetId, `/images/${imageId}/sdxl-generation-status`)
  )
}

export const generateImageFromSdxlEmbedding = async (
  datasetId: string,
  imageId: number,
  options: { steps?: number; cfg?: number; size?: number; seed?: number } = {}
) => {
  return await fetchBlob(
    datasetApiUrl(datasetId, `/images/${imageId}/generate-from-sdxl-embedding`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    }
  )
}

export const generateImageFromIpAdapterEmbedding = async (
  datasetId: string,
  imageId: number,
  options: {
    prompt?: string
    negative_prompt?: string
    steps?: number
    cfg?: number
    size?: number
    seed?: number
    adapter_scale?: number
  } = {}
) => {
  return await fetchBlob(
    datasetApiUrl(
      datasetId,
      `/images/${imageId}/generate-from-ip-adapter-embedding`
    ),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    }
  )
}

export const fetchAverageSdxlGenerationStatus = async (
  datasetId: string,
  imageIds: number[]
) => {
  return await fetchJson<Json>(
    datasetApiUrl(datasetId, '/sdxl-average-generation-status'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_ids: imageIds }),
    }
  )
}

export const generateImageFromAverageSdxlEmbedding = async (
  datasetId: string,
  imageIds: number[],
  options: { steps?: number; cfg?: number; size?: number; seed?: number } = {}
) => {
  return await fetchBlob(
    datasetApiUrl(datasetId, '/generate-from-average-sdxl-embedding'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_ids: imageIds, ...options }),
    }
  )
}

export const generateImageFromAverageIpAdapterEmbedding = async (
  datasetId: string,
  imageIds: number[],
  options: {
    prompt?: string
    negative_prompt?: string
    steps?: number
    cfg?: number
    size?: number
    seed?: number
    adapter_scale?: number
  } = {}
) => {
  return await fetchBlob(
    datasetApiUrl(datasetId, '/generate-from-average-ip-adapter-embedding'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_ids: imageIds, ...options }),
    }
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

export type NeighborFidelityRecord = {
  image_id: number
  clip_rank: number | null
  projection_rank: number | null
  clip_similarity: number
  projection_distance: number
}

export type NeighborFidelityResponse = {
  dataset_id: string
  selected_image_id: number
  requested_k: number
  effective_k: number
  retention: number
  neighbors: {
    preserved: NeighborFidelityRecord[]
    clip_only: NeighborFidelityRecord[]
    projection_only: NeighborFidelityRecord[]
  }
}

export const fetchNeighborFidelity = async (
  datasetId: string,
  payload: {
    image_ids: number[]
    projection_points: number[][]
    selected_image_id: number
    k: number
  },
  signal?: AbortSignal
) =>
  await fetchJson<NeighborFidelityResponse>(
    datasetApiUrl(datasetId, '/neighbor-fidelity'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    }
  )
