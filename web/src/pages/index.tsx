import { useAtomValue } from 'jotai'
import { API_URL, imagesAtom, searchImagesAtom } from '../state'
import { useState, useEffect } from 'react'
import { Input } from '../components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmbeddingsCanvas } from '../components/EmbeddingsCanvas'

function IndexPage() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  const images = useAtomValue(imagesAtom)
  const searchResults = useAtomValue(searchImagesAtom(debouncedQuery))

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query)
    }, 300) // Adjust debounce delay as needed

    return () => {
      clearTimeout(handler)
    }
  }, [query])

  return (
    <div className="flex flex-col items-center justify-center min-h-svh mt-4">
      <Input
        type="text"
        placeholder="Search..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-4 w-1/2"
      />

      <div className="flex flex-row w-9/10 justify-around gap-16 margin-x-4">
        <div className="w-1/2">
          <h1 className="text-2xl font-bold">Matches</h1>
          <div className="grid grid-cols-3 gap-4">
            {searchResults.map((image: string, index: number) => (
              <div key={index} className="w-full h-48 bg-gray-200 relative">
                <img
                  src={`${API_URL}/image/${image}`}
                  alt={`Image ${index}`}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-2 right-2 bg-black text-white text-xs px-2 py-1 rounded">
                  {image}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="w-1/2">
          <h1 className="text-2xl font-bold">Images ( {images.length} )</h1>
          <div className="grid grid-cols-3 gap-4">
            {images.map((image: string, index: number) => (
              <div key={index} className="w-full h-48 bg-gray-200 relative">
                <img
                  src={`${API_URL}/image/${image}`}
                  alt={`Image ${index}`}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-2 right-2 bg-black text-white text-xs px-2 py-1 rounded">
                  {image}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default IndexPage
