import { Route, Routes, Navigate, useParams, Link } from 'react-router'
import IndexPage from './pages'
import ImagePage from './pages/Image'
import DatasetPage from './pages/Dataset'
import EmbeddingsCanvas from './pages/canvas'
import { PhotoProvider } from 'react-photo-view'
import { useAtomValue, useSetAtom } from 'jotai'
import { activeDatasetIdAtom, selectedEmbeddingAtom } from './state'
import StreetViewPage from './pages/streetview'
import { ThemeProvider } from './components/ThemeProvider'
import { useEffect, useMemo } from 'react'
import { Button } from './components/ui/button'
import { useDatasetStatus } from './hooks/useDatasetStatus'
import { fetchImageMetadata } from './lib/api'
import { DatasetStatusPanel } from './components/DatasetStatusPanel'
import { StatusMessage } from './components/StatusMessage'

const DatasetCanvasRoute = () => {
  const { id } = useParams<{ id: string }>()
  const setActiveDatasetId = useSetAtom(activeDatasetIdAtom)
  const { status, loading, error } = useDatasetStatus(id)

  useEffect(() => {
    if (id) setActiveDatasetId(id)
  }, [id, setActiveDatasetId])

  const isPending = useMemo(() => {
    const current = status?.status
    return current === 'created' || current === 'uploaded' || current === 'processing'
  }, [status?.status])
  const isError = status?.status === 'error'

  if (loading || error) {
    if (loading && !error) {
      return (
        <div className="min-h-svh text-white">
          <div className="mx-auto w-full max-w-3xl px-6 py-12">
            <StatusMessage textClassName="text-white/70">
              Laddar status…
            </StatusMessage>
          </div>
        </div>
      )
    }
    return (
      <div className="min-h-svh text-white">
        <div className="mx-auto w-full max-w-3xl px-6 py-12">
          <StatusMessage variant="error" textClassName="text-red-200">
            {error}
          </StatusMessage>
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
          <DatasetStatusPanel
            variant="pending"
            title="Datasetet är pending"
            description="Bilderna bearbetas just nu. Canvas blir tillgänglig när arbetet är klart."
            stage={job?.stage}
            showProgress={showEmbeddingProgress}
            progressPercent={progress}
            className="text-white"
            textClassName="text-white/70"
            progressLabelClassName="text-sm text-white/70"
            action={
              id ? (
                <Link to={`/dataset/${id}`}>
                  <Button variant="secondary" size="sm">
                    Visa status
                  </Button>
                </Link>
              ) : null
            }
          />
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="min-h-svh text-white">
        <div className="mx-auto w-full max-w-3xl px-6 py-12">
          <DatasetStatusPanel
            variant="error"
            errorText="Datasetet kunde inte färdigställas. Kontrollera statusen för mer info."
            textClassName="text-sm text-red-200"
            action={
              id ? (
                <Link to={`/dataset/${id}`}>
                  <Button variant="secondary" size="sm">
                    Visa status
                  </Button>
                </Link>
              ) : null
            }
          />
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
            void fetchImageMetadata(datasetId, imageId)
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
