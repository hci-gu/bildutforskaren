import { useAtomValue } from 'jotai'
import { API_URL, imagesAtom, searchImagesAtom } from '../state'
import { useState, useEffect } from 'react'
import { Input } from '../components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmbeddingsCanvas } from '../components/EmbeddingsCanvas'
import Image from '@/components/Image'

function IndexPage() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  // const images = useAtomValue(imagesAtom)
  const images: any = []
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
        <div className="w-full">
          <h1 className="text-2xl font-bold">Matches</h1>
          <div className="grid grid-cols-6 gap-4">
            {searchResults.map((image: string, index: number) => (
              <Image key={index} image={image} index={index} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default IndexPage
