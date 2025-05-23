import { Input } from '@/components/ui/input'
import {
  projectionSettingsAtom,
  searchQueryAtom,
  searchSettingsAtom,
} from '@/state'
import { useAtom } from 'jotai'
import { useEffect, useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const Search = () => {
  const [settings, setSettings] = useAtom(searchSettingsAtom)
  const [query, setQuery] = useState('')
  const [_, setDebouncedQuery] = useAtom(searchQueryAtom)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query)
    }, 300)

    return () => {
      clearTimeout(handler)
    }
  }, [query])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setSettings((prev) => ({
      ...prev,
      [name]: parseFloat(value),
    }))
  }

  return (
    <div className="flex gap-2">
      <Input
        type="text"
        placeholder="Search..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="text-black bg-white border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2 flex-3"
      />
      <Input
        type="number"
        name="topK"
        value={settings.topK}
        onChange={handleChange}
        placeholder="topK"
        step={1}
        className="text-black bg-white border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2 flex-1"
      />
    </div>
  )
}

const ProjectionSettings = () => {
  const [settings, setSettings] = useAtom(projectionSettingsAtom)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setSettings((prev) => ({
      ...prev,
      [name]: parseFloat(value),
    }))
  }
  return (
    <div className="flex flex-col gap-2 mt-2">
      <Input
        type="number"
        name="minDist"
        value={settings.minDist}
        onChange={handleChange}
        placeholder="minDist"
        step={0.1}
        className="text-black bg-white border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2"
      />
      <Input
        type="number"
        name="nNeighbors"
        value={settings.nNeighbors}
        onChange={handleChange}
        placeholder="nNeighbors"
        step={1}
        className="text-black bg-white border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2"
      />
      <Input
        type="number"
        name="spread"
        value={settings.spread}
        onChange={handleChange}
        placeholder="spread"
        step={0.25}
        className="text-black bg-white border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2"
      />
    </div>
  )
}

export default function Panel() {
  return (
    <Card className="absolute top-8 right-8 z-10 w-1/6 bg-white border border-gray-300 shadow-lg">
      <CardContent>
        <Search />
        <ProjectionSettings />
      </CardContent>
    </Card>
  )
}
