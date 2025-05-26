import { useAtomValue } from 'jotai'
import { API_URL, searchImagesAtom } from '../state'
import { useState, useEffect } from 'react'
import { Input } from '../components/ui/input'
import { PhotoView } from 'react-photo-view'
import { Link } from 'react-router-dom'

function IndexPage() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  const searchResults = useAtomValue(searchImagesAtom(debouncedQuery))

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query)
    }, 300)
    return () => {
      clearTimeout(handler)
    }
  }, [query])

  return (
    <div className="flex flex-col items-center justify-center min-h-svh mt-4">
      <Link to="/maps" className="mb-4 text-blue-500 hover:text-blue-700">Go to Maps</Link>
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
            {searchResults.map(
              ({ id, distance }: { id: number; distance: number }) => (
                <PhotoView
                  key={`Image_${id}`}
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
