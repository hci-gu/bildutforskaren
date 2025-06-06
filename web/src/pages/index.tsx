import { useAtom, useAtomValue } from 'jotai'
import {
  API_URL,
  searchImageAtom,
  searchImagesAtom,
  searchQueryAtom,
} from '../state'
import { useState, useEffect } from 'react'
import { Input } from '../components/ui/input'
import { PhotoView } from 'react-photo-view'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Link } from 'react-router'

function IndexPage() {
  const [query, setQuery] = useState('')
  const [_, setFile] = useAtom(searchImageAtom)
  const [__, setDebouncedQuery] = useAtom(searchQueryAtom)
  const searchResults = useAtomValue(searchImagesAtom)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query)
    }, 300)
    return () => {
      clearTimeout(handler)
    }
  }, [query])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setDebouncedQuery('')
    const selectedFile = event.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      // Assuming you want to handle the file upload here
      const formData = new FormData()
      formData.append('file', selectedFile)
      console.log('formData', formData, selectedFile)

      fetch(`${API_URL}/search-by-image`, {
        method: 'POST',
        body: formData,
      })
        .then((response) => response.json())
        .then((data) => {
          console.log('search result:', data)
          // Optionally, you can trigger a search after uploading
        })
        .catch((error) => {
          console.error('Error uploading file:', error)
        })
    }
  }

  return (
    <div className="flex flex-col items-center min-h-svh mt-4">
      <div className="p-32">
        <h1 className="text-3xl font-bold mb-4">Bildutforskaren</h1>
        <p className="text-gray-600 mb-8">
          Utforksa dina bilder med AI! Skriv in en sökterm eller ladda upp en
          bild för att hitta liknande bilder i din samling.
        </p>
        <div className="flex gap-4 justify-center mb-8">
          <Link to="/canvas">
            <Button>Canvas</Button>
          </Link>
          <Link to="/street-view">
            <Button>Street view</Button>
          </Link>
        </div>
      </div>
      <div className="flex gap-4 justify-center mb-8">
        <div className="w-1/2">
          <Label className="p-1" htmlFor="search">
            Sök
          </Label>
          <Input
            id="search"
            type="text"
            placeholder="Skriv något..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="w-1/2">
          <Label className="p-1" htmlFor="image-search">
            Sök med bild
          </Label>
          <Input
            id="image-search"
            type="file"
            placeholder="Sök..."
            onChange={handleFileChange}
          />
        </div>
      </div>

      <div className="flex flex-row w-9/10 justify-around gap-16 margin-x-4">
        <div className="w-full">
          <div className="grid grid-cols-6 gap-4">
            {searchResults.map(
              (
                { id, distance }: { id: number; distance: number },
                index: number
              ) => (
                <PhotoView
                  key={`Image_${id}_${distance}_${index}`}
                  src={`${API_URL}/original/${id}`}
                >
                  <div>
                    <img src={`${API_URL}/image/${id}`} />
                    <span>{distance.toFixed(4)}</span>
                  </div>
                </PhotoView>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default IndexPage
