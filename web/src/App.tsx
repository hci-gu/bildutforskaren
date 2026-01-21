import { Route, Routes, Navigate, useParams } from 'react-router'
import IndexPage from './pages'
import ImagePage from './pages/Image'
import EmbeddingsCanvas from './pages/canvas'
import { PhotoProvider } from 'react-photo-view'
import { useAtomValue, useSetAtom } from 'jotai'
import { activeDatasetIdAtom, selectedEmbeddingAtom } from './state'
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
      >
        <Routes>
          <Route path="/" element={<IndexPage />} />

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
