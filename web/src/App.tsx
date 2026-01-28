import { Route, Routes, Navigate, useParams, Link } from 'react-router'
import IndexPage from './pages'
import ImagePage from './pages/Image'
import DatasetPage from './pages/Dataset'
import EmbeddingsCanvas from './pages/canvas'
import { PhotoProvider } from 'react-photo-view'
import { useAtomValue, useSetAtom } from 'jotai'
import { activeDatasetIdAtom, selectedEmbeddingAtom, API_URL } from './state'
import StreetViewPage from './pages/streetview'
import { ThemeProvider } from './components/ThemeProvider'
import { useEffect, useMemo, useState } from 'react'
import { Button } from './components/ui/button'

type DatasetStatus = {
  status?: string
  job?: {
    stage?: string
    progress?: number
    processed?: number
    skipped?: number
  }
}

const DatasetCanvasRoute = () => {
  const { id } = useParams<{ id: string }>()
  const setActiveDatasetId = useSetAtom(activeDatasetIdAtom)
  const [status, setStatus] = useState<DatasetStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (id) setActiveDatasetId(id)
  }, [id, setActiveDatasetId])

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const res = await fetch(
          `${API_URL}/datasets/${encodeURIComponent(id)}/status`
        )
        if (!res.ok) throw new Error('Failed to load dataset status')
        const data = (await res.json()) as DatasetStatus
        if (!cancelled) setStatus(data)
      } catch (err) {
        if (!cancelled) setLoadError('Kunde inte läsa status för datasetet.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  const isPending = useMemo(() => {
    const current = status?.status
    return current === 'created' || current === 'uploaded' || current === 'processing'
  }, [status?.status])
  const isError = status?.status === 'error'

  if (loading) {
    return (
      <div className="min-h-svh text-white">
        <div className="mx-auto w-full max-w-3xl px-6 py-12">
          <div className="glass-panel rounded-2xl p-6 text-sm text-white/70">
            Laddar status…
          </div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-svh text-white">
        <div className="mx-auto w-full max-w-3xl px-6 py-12">
          <div className="glass-panel rounded-2xl p-6 text-sm text-red-200">
            {loadError}
          </div>
        </div>
      </div>
    )
  }

  if (isPending) {
    const job = status?.job
    const progress =
      typeof job?.progress === 'number'
        ? Math.round(job.progress * 100)
        : null
    const showEmbeddingProgress =
      job?.stage === 'embeddings' && typeof job?.progress === 'number'
    return (
      <div className="min-h-svh text-white">
        <div className="mx-auto w-full max-w-3xl px-6 py-12">
          <div className="glass-panel rounded-2xl p-6">
            <h1 className="text-xl font-semibold">Datasetet är pending</h1>
            <p className="mt-2 text-sm text-white/70">
              Bilderna bearbetas just nu. Canvas blir tillgänglig när arbetet är
              klart.
            </p>
            {job?.stage && (
              <div className="mt-3 text-sm text-white/70">
                Steg: {job.stage}
                {progress !== null ? ` (${progress}%)` : ''}
              </div>
            )}
            {showEmbeddingProgress && (
              <div className="mt-4">
                <div className="text-sm text-white/70">
                  Embeddings {progress}%
                </div>
                <div className="mt-2 h-2 w-full rounded-full bg-white/10">
                  <div
                    className="h-2 rounded-full bg-amber-400"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              {id && (
                <Link to={`/dataset/${id}`}>
                  <Button variant="secondary" size="sm">
                    Visa status
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="min-h-svh text-white">
        <div className="mx-auto w-full max-w-3xl px-6 py-12">
          <div className="glass-panel rounded-2xl p-6 text-sm text-red-200">
            Datasetet kunde inte färdigställas. Kontrollera statusen för mer info.
            {id && (
              <div className="mt-4">
                <Link to={`/dataset/${id}`}>
                  <Button variant="secondary" size="sm">
                    Visa status
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return <EmbeddingsCanvas />
}

const DatasetStreetViewRoute = () => {
  const { id } = useParams<{ id: string }>()
  const setActiveDatasetId = useSetAtom(activeDatasetIdAtom)

  useEffect(() => {
    if (id) setActiveDatasetId(id)
  }, [id, setActiveDatasetId])

  return <StreetViewPage />
}

const DatasetInfoRoute = () => {
  const { id } = useParams<{ id: string }>()
  const setActiveDatasetId = useSetAtom(activeDatasetIdAtom)

  useEffect(() => {
    if (id) setActiveDatasetId(id)
  }, [id, setActiveDatasetId])

  return <DatasetPage />
}

const ActiveDatasetCanvasRedirect = () => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  if (!datasetId) return <Navigate to="/" replace />
  return <Navigate to={`/dataset/${datasetId}/canvas`} replace />
}

const ActiveDatasetStreetViewRedirect = () => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  if (!datasetId) return <Navigate to="/" replace />
  return <Navigate to={`/dataset/${datasetId}/street-view`} replace />
}

function App() {
  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)

  return (
    <ThemeProvider defaultTheme="dark">
      <PhotoProvider
        onVisibleChange={(visible) => {
          if (!visible) {
            setSelectedEmbedding(null)
          }
        }}
        onIndexChange={(index: number, state: any) => {
          try {
            const item = state?.images?.[index]
            const src = item?.src as string | undefined
            if (!src) return
            const match = src.match(/\/datasets\/([^/]+)\/original\/(\d+)/)
            if (!match) return
            const datasetId = match[1]
            const imageId = Number(match[2])
            if (!datasetId || Number.isNaN(imageId)) return
            setSelectedEmbedding({ id: imageId, meta: {} })
            void fetch(
              `${API_URL}/datasets/${encodeURIComponent(datasetId)}/metadata/${imageId}`
            )
              .then((res) => (res.ok ? res.json() : null))
              .then((meta) => {
                if (meta) {
                  setSelectedEmbedding({ id: imageId, meta })
                }
              })
              .catch(() => {})
          } catch (err) {
            // Ignore handler errors.
          }
        }}
      >
        <Routes>
          <Route path="/" element={<IndexPage />} />

          <Route path="/dataset/:id" element={<DatasetInfoRoute />} />
          <Route path="/datset/:id" element={<DatasetInfoRoute />} />
          <Route path="/dataset/:id/canvas" element={<DatasetCanvasRoute />} />
          <Route path="/dataset/:id/street-view" element={<DatasetStreetViewRoute />} />

          {/* Backwards compatible routes */}
          <Route path="/canvas" element={<ActiveDatasetCanvasRedirect />} />
          <Route path="/street-view" element={<ActiveDatasetStreetViewRedirect />} />

          <Route path="/images/:id" element={<ImagePage />} />
        </Routes>
      </PhotoProvider>
    </ThemeProvider>
  )
}

export default App
