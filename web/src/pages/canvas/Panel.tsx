import { Input } from '@/components/ui/input'
import {
  displaySettingsAtom,
  filterSettingsAtom,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'

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
      <CardHeader className="p-0 mt-2">
        <CardTitle>Projection Settings</CardTitle>
        <CardDescription>Settings for the projection algorithm</CardDescription>
      </CardHeader>
      <Select
        value={settings.type}
        onValueChange={(value) =>
          setSettings((prev) => ({ ...prev, type: value }))
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="umap">U-Map</SelectItem>
          <SelectItem value="grid">Grid</SelectItem>
          <SelectItem value="year">Year</SelectItem>
          <SelectItem value="spreadsheet">Spreadsheet</SelectItem>
        </SelectContent>
      </Select>
      Copy
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

const DisplaySettings = () => {
  const [settings, setSettings] = useAtom(displaySettingsAtom)

  return (
    <div className="flex flex-col gap-2 mt-2">
      <CardHeader className="p-0 mt-2">
        <CardTitle>Display Settings</CardTitle>
        <CardDescription>Settings for the display</CardDescription>
      </CardHeader>
      <div className="flex items-center space-x-2">
        <Checkbox
          id="terms"
          name="colorPhotographer"
          onCheckedChange={(checked) =>
            setSettings((prev) => ({
              ...prev,
              colorPhotographer: !!checked,
            }))
          }
          checked={settings.colorPhotographer}
        />
        <label
          htmlFor="terms"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          Color by Photographer
        </label>
      </div>
      <Input
        type="number"
        name="scale"
        value={settings.scale}
        onChange={(e) =>
          setSettings((prev) => ({
            ...prev,
            scale: parseFloat(e.target.value),
          }))
        }
        placeholder="Scale"
        step={0.25}
        className="text-black bg-white border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2"
      />
    </div>
  )
}

const FilterSettings = () => {
  const [settings, setSettings] = useAtom(filterSettingsAtom)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setSettings((prev) => ({
      ...prev,
      [name]: value || null,
    }))
  }

  return (
    <div className="flex flex-col gap-2 mt-2">
      <CardHeader className="p-0 mt-2">
        <CardTitle>Filters</CardTitle>
      </CardHeader>
      <Select
        value={settings.photographer || ''}
        onValueChange={(value) =>
          setSettings((prev: any) => ({ ...prev, photographer: value }))
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Photographer" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={null}>Ingen</SelectItem>
          <SelectItem value="1">1</SelectItem>
          <SelectItem value="2">2</SelectItem>
          <SelectItem value="3">3</SelectItem>
          <SelectItem value="4">4</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export default function Panel() {
  return (
    <Card className="absolute top-8 right-8 z-10 w-1/6 bg-white border border-gray-300 shadow-lg">
      <CardContent>
        <Search />
        <ProjectionSettings />
        <DisplaySettings />
        <FilterSettings />
      </CardContent>
    </Card>
  )
}
