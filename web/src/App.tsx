import { Route, Routes, Navigate, useParams } from 'react-router'
import IndexPage from './pages'
import ImagePage from './pages/Image'
import DatasetPage from './pages/Dataset'
import EmbeddingsCanvas from './pages/canvas'
import { PhotoProvider } from 'react-photo-view'
import { useAtomValue, useSetAtom } from 'jotai'
import { activeDatasetIdAtom, selectedEmbeddingAtom, API_URL } from './state'
import StreetViewPage from './pages/streetview'
import { ThemeProvider } from './components/ThemeProvider'
import { useEffect } from 'react'

const DatasetCanvasRoute = () => {
  const { id } = useParams<{ id: string }>()
  const setActiveDatasetId = useSetAtom(activeDatasetIdAtom)

  useEffect(() => {
    if (id) setActiveDatasetId(id)
  }, [id, setActiveDatasetId])

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
