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
import { Label } from '@/components/ui/label'

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
      <div className="flex flex-col gap-2 flex-2">
        <Label htmlFor="query">Sök</Label>
        <Input
          id="query"
          type="text"
          placeholder="Skriv något..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2"
        />
      </div>
      <div className="flex flex-col gap-2 flex-1">
        <Label htmlFor="topK">Antal</Label>
        <Input
          id="topK"
          type="number"
          name="topK"
          value={settings.topK}
          onChange={handleChange}
          placeholder="topK"
          step={1}
          className="border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2 flex-1"
        />
      </div>
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
        <CardTitle>Typ av visning</CardTitle>
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
          <SelectItem value="umap">Projektion</SelectItem>
          <SelectItem value="grid">Rutnät</SelectItem>
          <SelectItem value="year">År</SelectItem>
        </SelectContent>
      </Select>
      {settings.type === 'umap' && (
        <>
          <CardHeader className="p-0 mt-2">
            <CardTitle>Inställningar för projektion</CardTitle>
          </CardHeader>
          <div className="flex items-center space-x-2">
            <Label htmlFor="minDist" className="w-24">
              Min distans
            </Label>
            <Input
              id="minDist"
              type="number"
              name="minDist"
              value={settings.minDist}
              onChange={handleChange}
              placeholder="minDist"
              step={0.1}
              className="border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2"
            />
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="nNeighbors" className="w-24">
              Grannar
            </Label>
            <Input
              id="nNeighbors"
              type="number"
              name="nNeighbors"
              value={settings.nNeighbors}
              onChange={handleChange}
              placeholder="nNeighbors"
              step={1}
              className="border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2"
            />
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="spread" className="w-24">
              Spridning
            </Label>
            <Input
              id="spread"
              type="number"
              name="spread"
              value={settings.spread}
              onChange={handleChange}
              placeholder="spread"
              step={0.25}
              className="border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2"
            />
          </div>
          {/* <div className="flex items-center space-x-2">
            <Label htmlFor="seed" className="w-24">
              Seed
            </Label>
            <Input
              id="seed"
              type="number"
              name="seed"
              value={settings.seed}
              onChange={handleChange}
              placeholder="seed"
              step={1}
              className="border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2"
            />
          </div> */}
        </>
      )}
    </div>
  )
}

const DisplaySettings = () => {
  const [settings, setSettings] = useAtom(displaySettingsAtom)

  return (
    <div className="flex flex-col gap-2 mt-2">
      <CardHeader className="p-0 mt-2">
        <CardTitle>Visningsinställningar</CardTitle>
        <CardDescription>Ändra hur bilderna syns</CardDescription>
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
          Färga fotograf
        </label>
      </div>
      <Label htmlFor="scale">Bildstorlek</Label>
      <Input
        id="scale"
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
        className="border border-gray-300 rounded-md shadow-sm focus:ring focus:ring-blue-500 focus:border-blue-500 p-2"
      />
    </div>
  )
}

const FilterSettings = () => {
  const [settings, setSettings] = useAtom(filterSettingsAtom)

  // const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  //   const { name, value } = e.target
  //   setSettings((prev) => ({
  //     ...prev,
  //     [name]: value || null,
  //   }))
  // }

  return (
    <div className="flex flex-col gap-2 mt-2">
      <CardHeader className="p-0 mt-2">
        <CardTitle>Filter</CardTitle>
      </CardHeader>
      <Select
        value={settings.photographer || ''}
        onValueChange={(value) =>
          setSettings((prev: any) => ({ ...prev, photographer: value }))
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Fotograf" />
        </SelectTrigger>
        <SelectContent>
          {/* @ts-ignore */}
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
    <Card className="absolute top-4 right-4 z-10 w-1/6 border border-gray-300 shadow-lg">
      <CardContent className="px-4">
        <Search />
        <ProjectionSettings />
        <DisplaySettings />
        <FilterSettings />
      </CardContent>
    </Card>
  )
}
