import React from 'react'
import { Route, Routes } from 'react-router'
import IndexPage from './pages'
import ImagePage from './pages/Image'
import EmbeddingsCanvas from './pages/canvas'
import { PhotoProvider } from 'react-photo-view'
import { useSetAtom } from 'jotai'
import { selectedEmbeddingAtom } from './state'

function App() {
  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)

  return (
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
        <Route path="/images/:id" element={<ImagePage />} />
      </Routes>
    </PhotoProvider>
  )
}

export default App
