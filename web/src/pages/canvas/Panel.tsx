import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  activeDatasetIdAtom,
  datasetApiUrl,
  displaySettingsAtom,
  filterSettingsAtom,
  hoveredTextAtom,
  projectionSettingsAtom,
  searchQueryAtom,
  searchSettingsAtom,
  tagRefreshTriggerAtom,
  taggedImagesRevisionAtom,
  textsAtom,
} from '@/state'
import { useAtom, useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
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
          className="border border-white/20 bg-white/10 text-white placeholder:text-white/40 shadow-sm focus-visible:ring-white/30"
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
          className="flex-1 border border-white/20 bg-white/10 text-white placeholder:text-white/40 shadow-sm focus-visible:ring-white/30"
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
        <SelectTrigger className="w-[180px] border-white/20 bg-white/10 text-white">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="umap">Projektion</SelectItem>
          <SelectItem value="grid">Rutnät</SelectItem>
          <SelectItem value="tagged">Taggade/otaggade</SelectItem>
          <SelectItem value="sao">SAO-termer</SelectItem>
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
              className="border border-white/20 bg-white/10 text-white placeholder:text-white/40 shadow-sm focus-visible:ring-white/30"
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
              className="border border-white/20 bg-white/10 text-white placeholder:text-white/40 shadow-sm focus-visible:ring-white/30"
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
              className="border border-white/20 bg-white/10 text-white placeholder:text-white/40 shadow-sm focus-visible:ring-white/30"
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
      {settings.type === 'sao' && (
        <div className="flex items-center space-x-2">
          <Checkbox
            id="saoOnlyDataset"
            name="saoOnlyDataset"
            onCheckedChange={(checked) =>
              setSettings((prev) => ({
                ...prev,
                saoOnlyDataset: !!checked,
              }))
            }
            checked={settings.saoOnlyDataset}
          />
          <label
            htmlFor="saoOnlyDataset"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Visa bara termer i datasetet
          </label>
        </div>
      )}
      {settings.type === 'tagged' && (
        <div className="flex items-center space-x-2">
          <Checkbox
            id="groupTaggedByTag"
            name="groupTaggedByTag"
            onCheckedChange={(checked) =>
              setSettings((prev) => ({
                ...prev,
                groupTaggedByTag: !!checked,
              }))
            }
            checked={settings.groupTaggedByTag}
          />
          <label
            htmlFor="groupTaggedByTag"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Gruppera taggade efter tagg
          </label>
        </div>
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
        className="border border-white/20 bg-white/10 text-white placeholder:text-white/40 shadow-sm focus-visible:ring-white/30"
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
      <SelectTrigger className="w-[180px] border-white/20 bg-white/10 text-white">
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

const TextPanel = () => {
  const [texts, setTexts] = useAtom(textsAtom)
  const [, setHoveredText] = useAtom(hoveredTextAtom)
  const [newText, setNewText] = useState('')

  const addText = () => {
    const trimmed = newText.trim()
    if (!trimmed) return
    if (texts.includes(trimmed)) {
      setNewText('')
      return
    }
    setTexts((prev) => [...prev, trimmed])
    setNewText('')
  }

  const removeText = (text: string) => {
    setTexts((prev) => prev.filter((t) => t !== text))
  }

  return (
    <Card
      className="glass-panel absolute top-4 left-4 z-10 w-1/5 text-white shadow-lg"
      data-canvas-ui="true"
    >
      <CardContent className="px-4">
        <CardHeader className="p-0 mt-2">
          <CardTitle>Ord i rummet</CardTitle>
          <CardDescription>Lägg till eller ta bort ord</CardDescription>
        </CardHeader>
        <div className="flex flex-wrap gap-2 mt-2">
          {texts.map((text) => (
            <div
              key={text}
              className="flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-sm"
              onMouseEnter={() => setHoveredText(text)}
              onMouseLeave={() => setHoveredText(null)}
            >
              <span>{text}</span>
              <button
                type="button"
                onClick={() => removeText(text)}
                className="text-white/60 hover:text-white"
                aria-label={`Remove ${text}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <Input
            type="text"
            placeholder="Lägg till ord..."
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addText()
            }}
          />
          <Button type="button" onClick={addText}>
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

const TaggedInfoPanel = () => {
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshUntilRef = useRef(0)
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const taggedRevision = useAtomValue(taggedImagesRevisionAtom)
  const tagRefreshTrigger = useAtomValue(tagRefreshTriggerAtom)
  const [stats, setStats] = useState<{
    total_images: number
    tagged_images: number
    tagged_percent: number
  } | null>(null)
  const [showRefresh, setShowRefresh] = useState(false)

  useEffect(() => {
    if (!datasetId) {
      setStats(null)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(datasetApiUrl(datasetId, '/tag-stats'))
        if (!res.ok) throw new Error('Failed to fetch tag stats')
        const data = await res.json()
        if (!cancelled) {
          setStats({
            total_images: data.total_images ?? 0,
            tagged_images: data.tagged_images ?? 0,
            tagged_percent: data.tagged_percent ?? 0,
          })
        }
      } catch (err) {
        if (!cancelled) setStats(null)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [datasetId, taggedRevision])

  useEffect(() => {
    if (!tagRefreshTrigger) return
    const minDurationMs = 1200
    const now = Date.now()
    refreshUntilRef.current = Math.max(refreshUntilRef.current, now + minDurationMs)
    setShowRefresh(true)
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
    }
    const remaining = Math.max(0, refreshUntilRef.current - Date.now())
    refreshTimerRef.current = setTimeout(() => {
      setShowRefresh(false)
    }, remaining)
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
    }
  }, [tagRefreshTrigger])

  return (
    <Card
      className="glass-panel absolute top-4 left-4 z-10 w-64 shadow-lg"
      data-canvas-ui="true"
    >
      <CardContent className="px-4 py-1 text-sm text-white">
        <div className="mb-2 text-xs font-semibold text-white/80">
          Datasetstatus
        </div>
        {showRefresh && (
          <div className="mb-2 flex items-center gap-2 text-[11px] text-white/60">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-white/40 border-t-transparent" />
            Uppdaterar…
          </div>
        )}
        <div className="space-y-1 text-xs text-white/80">
          <div className="flex justify-between">
            <span>Antal bilder</span>
            <span>{stats ? stats.total_images : '-'}</span>
          </div>
          <div className="flex justify-between">
            <span>Taggade</span>
            <span>
              {stats
                ? `${stats.tagged_images} (${stats.tagged_percent}%)`
                : '-'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Panel() {
  const settings = useAtomValue(projectionSettingsAtom)

  return (
    <>
      {settings.type === 'tagged' ? <TaggedInfoPanel /> : <TextPanel />}
      <Card
        className="glass-panel absolute top-4 right-4 z-10 w-1/6 text-white shadow-lg"
        data-canvas-ui="true"
      >
        <CardContent className="px-4">
          <Search />
          <ProjectionSettings />
          <DisplaySettings />
          <FilterSettings />
        </CardContent>
      </Card>
    </>
  )
}
