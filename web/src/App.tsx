import { Route, Routes } from 'react-router'
import IndexPage from './pages'
import ImagePage from './pages/Image'
import EmbeddingsCanvas from './pages/canvas'
import { PhotoProvider } from 'react-photo-view'
import { useSetAtom } from 'jotai'
import { selectedEmbeddingAtom } from './state'
import StreetViewPage from './pages/streetview'
import { ThemeProvider } from './components/ThemeProvider'

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
          <Route path="/canvas" element={<EmbeddingsCanvas />} />
          <Route path="/street-view" element={<StreetViewPage />} />
          <Route path="/images/:id" element={<ImagePage />} />
        </Routes>
      </PhotoProvider>
    </ThemeProvider>
  )
}

export default App
