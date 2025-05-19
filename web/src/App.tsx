import React from 'react'
import { Route, Routes } from 'react-router'
import IndexPage from './pages'
import ImagePage from './pages/Image'
import { EmbeddingsCanvas } from './components/EmbeddingsCanvas'

function App() {
  return (
    <Routes>
      <Route path="/" element={<IndexPage />} />
      <Route path="/canvas" element={<EmbeddingsCanvas />} />
      <Route path="/images/:id" element={<ImagePage />} />
    </Routes>
  )
}

export default App
