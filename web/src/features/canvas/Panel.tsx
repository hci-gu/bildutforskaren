import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import {
  activeDatasetIdAtom,
  displaySettingsAtom,
  filterSettingsAtom,
  graphLayoutAtom,
  graphNetworksAtom,
  hoveredTextAtom,
  neighborFidelitySettingsAtom,
  projectionSettingsAtom,
  projectionStabilityErrorAtom,
  projectionStabilityProgressAtom,
  projectionStabilityStatusAtom,
  projectionViewModeAtom,
  searchQueryAtom,
  searchSettingsAtom,
  tagRefreshTriggerAtom,
  tagStatsRevisionAtom,
  textsAtom,
} from '@/store'
import { fetchTagStats } from '@/shared/lib/api'
import { useAtom, useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { Checkbox } from '@/shared/ui/checkbox'
import { Label } from '@/shared/ui/label'
import { ExplanationPanel } from './components/ExplanationPanel'
import { useProjectionStability } from './hooks/useProjectionStability'

const Search = () => {
  const [settings, setSettings] = useAtom(searchSettingsAtom)
  const [query, setQuery] = useState('')
  const [, setDebouncedQuery] = useAtom(searchQueryAtom)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query)
    }, 300)

    return () => {
      clearTimeout(handler)
    }
  }, [query, setDebouncedQuery])

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
  const [viewMode, setViewMode] = useAtom(projectionViewModeAtom)
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const graphNetworks = useAtomValue(graphNetworksAtom)
  const hasGraph = !!datasetId && !!graphNetworks[datasetId]

  return (
    <div className="flex flex-col gap-2 mt-2">
      <CardHeader className="p-0 mt-2">
        <CardTitle>Typ av visning</CardTitle>
      </CardHeader>
      <Select
        value={settings.type}
        onValueChange={(value) => {
          setSettings((prev) => ({ ...prev, type: value }))
          if (value !== 'umap') setViewMode('2d')
        }}
      >
        <SelectTrigger className="w-[180px] border-white/20 bg-white/10 text-white">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="umap">Projektion</SelectItem>
          <SelectItem value="grid">Rutnät</SelectItem>
          <SelectItem value="tagged">Taggade/otaggade</SelectItem>
          <SelectItem value="sao">SAO-termer</SelectItem>
          <SelectItem value="graph" disabled={!hasGraph}>
            Graph network
          </SelectItem>
          <SelectItem value="year">År</SelectItem>
        </SelectContent>
      </Select>
      {settings.type === 'umap' && (
        <>
          <Select
            value={viewMode}
            onValueChange={(value: '2d' | '3d') => setViewMode(value)}
          >
            <SelectTrigger className="w-[180px] border-white/20 bg-white/10 text-white">
              <SelectValue placeholder="Dimension" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2d">2D</SelectItem>
              <SelectItem value="3d">3D</SelectItem>
            </SelectContent>
          </Select>
        </>
      )}
    </div>
  )
}

const AdvancedSettings = ({
  stability,
}: {
  stability: ReturnType<typeof useProjectionStability>
}) => {
  const [settings, setSettings] = useAtom(projectionSettingsAtom)
  const [fidelitySettings, setFidelitySettings] = useAtom(
    neighborFidelitySettingsAtom
  )
  const [displaySettings, setDisplaySettings] = useAtom(displaySettingsAtom)
  const [viewMode] = useAtom(projectionViewModeAtom)
  const [graphLayout, setGraphLayout] = useAtom(graphLayoutAtom)
  const stabilityStatus = useAtomValue(projectionStabilityStatusAtom)
  const stabilityError = useAtomValue(projectionStabilityErrorAtom)

  const handleProjectionChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const { name, value } = event.target
    setSettings((previous) => ({
      ...previous,
      [name]: parseFloat(value),
    }))
  }

  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      {settings.type === 'umap' && (
        <>
          {viewMode === '3d' && (
            <div className="text-xs text-white/70">
              Vänsterklick + dra: rotera. Högerklick + dra: panorera. Hjul:
              zooma.
            </div>
          )}
          {viewMode === '2d' && (
            <>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full px-3 py-2 text-xs"
                onClick={stability.start}
                disabled={!stability.canStart}
                title={
                  stability.imageCount < 10
                    ? 'Minst tio bilder krävs'
                    : 'Analysera hur stabila klustren är mellan upprepade UMAP-projektioner'
                }
              >
                {stabilityStatus === 'starting' ||
                stabilityStatus === 'running'
                  ? 'Analysis running…'
                  : 'Cluster stability analysis'}
              </Button>
              {stabilityError && (
                <div className="text-[11px] text-red-300">
                  {stabilityError}
                </div>
              )}
            </>
          )}

          <div className="flex items-center space-x-2">
            <Checkbox
              id="neighborFidelity"
              checked={fidelitySettings.enabled}
              onCheckedChange={(checked) =>
                setFidelitySettings((previous) => ({
                  ...previous,
                  enabled: !!checked,
                }))
              }
            />
            <Label htmlFor="neighborFidelity">Neighbor fidelity</Label>
          </div>
          {fidelitySettings.enabled && (
            <div className="flex items-center space-x-2">
              <Label htmlFor="neighborFidelityK" className="w-24">
                Neighbors
              </Label>
              <Input
                id="neighborFidelityK"
                type="number"
                min={2}
                max={50}
                step={1}
                value={fidelitySettings.k}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (!Number.isFinite(value)) return
                  setFidelitySettings((previous) => ({
                    ...previous,
                    k: Math.max(2, Math.min(50, Math.round(value))),
                  }))
                }}
                className="border border-white/20 bg-white/10 text-white shadow-sm focus-visible:ring-white/30"
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-semibold text-white/80">
              Projektionsparametrar
            </div>
            <div className="flex items-center space-x-2">
              <Label htmlFor="minDist" className="w-24">
                Min distans
              </Label>
              <Input
                id="minDist"
                type="number"
                name="minDist"
                value={settings.minDist}
                onChange={handleProjectionChange}
                step={0.1}
                className="border border-white/20 bg-white/10 text-white shadow-sm focus-visible:ring-white/30"
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
                onChange={handleProjectionChange}
                step={1}
                className="border border-white/20 bg-white/10 text-white shadow-sm focus-visible:ring-white/30"
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
                onChange={handleProjectionChange}
                step={0.25}
                className="border border-white/20 bg-white/10 text-white shadow-sm focus-visible:ring-white/30"
              />
            </div>
          </div>
        </>
      )}

      {viewMode === '2d' && settings.type === 'graph' && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-white/80">Graph layout</div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={graphLayout === 'concentric' ? 'secondary' : 'outline'}
              onClick={() => setGraphLayout('concentric')}
              className="h-auto px-2 py-2 text-xs"
            >
              Concentric shells
            </Button>
            <Button
              type="button"
              variant={graphLayout === 'force' ? 'secondary' : 'outline'}
              onClick={() => setGraphLayout('force')}
              className="h-auto px-2 py-2 text-xs"
            >
              Free force
            </Button>
          </div>
        </div>
      )}

      {viewMode === '2d' && settings.type === 'sao' && (
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

      {viewMode === '2d' && settings.type === 'tagged' && (
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

      {viewMode === '2d' && (
        <>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="colorPhotographer"
              checked={displaySettings.colorPhotographer}
              onCheckedChange={(checked) =>
                setDisplaySettings((previous) => ({
                  ...previous,
                  colorPhotographer: !!checked,
                }))
              }
            />
            <Label htmlFor="colorPhotographer">Färga fotograf</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="showClusterImages"
              checked={displaySettings.showClusterImages}
              onCheckedChange={(checked) =>
                setDisplaySettings((previous) => ({
                  ...previous,
                  showClusterImages: !!checked,
                }))
              }
            />
            <Label htmlFor="showClusterImages">Visa klusterbilder</Label>
          </div>
        </>
      )}

      <FilterSettings />
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
        value={settings.photographer ?? 'none'}
        onValueChange={(value) =>
          setSettings((previous) => ({
            ...previous,
            photographer: value === 'none' ? null : value,
          }))
        }
      >
        <SelectTrigger className="w-[180px] border-white/20 bg-white/10 text-white">
          <SelectValue placeholder="Fotograf" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Ingen</SelectItem>
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
      className="glass-panel absolute top-20 left-4 z-10 w-1/5 text-white shadow-lg"
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
  const tagStatsRevision = useAtomValue(tagStatsRevisionAtom)
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
        const data = await fetchTagStats(datasetId)
        if (!cancelled) {
          setStats({
            total_images: data.total_images ?? 0,
            tagged_images: data.tagged_images ?? 0,
            tagged_percent: data.tagged_percent ?? 0,
          })
        }
      } catch {
        if (!cancelled) setStats(null)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [datasetId, tagStatsRevision])

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
      className="glass-panel absolute top-20 left-4 z-10 w-64 shadow-lg"
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

const ProjectionStabilityProgressOverlay = () => {
  const status = useAtomValue(projectionStabilityStatusAtom)
  const progress = useAtomValue(projectionStabilityProgressAtom)
  if (status !== 'starting' && status !== 'running') return null
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100)
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
      <div
        className="glass-panel-strong w-80 rounded-xl px-5 py-4 text-white shadow-2xl"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
          <span>Analyserar klusterstabilitet</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-cyan-300 transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-1.5 text-right text-xs text-white/60">
          {percent} %
        </div>
      </div>
    </div>
  )
}

export default function Panel() {
  const settings = useAtomValue(projectionSettingsAtom)
  const viewMode = useAtomValue(projectionViewModeAtom)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const stability = useProjectionStability()

  return (
    <>
      {viewMode === '2d' && settings.type === 'tagged' ? (
        <TaggedInfoPanel />
      ) : (
        <TextPanel />
      )}
      <Card
        className="glass-panel absolute top-4 right-4 z-10 max-h-[calc(100vh-2rem)] w-1/6 overflow-hidden text-white shadow-lg"
        data-canvas-ui="true"
      >
        <CardContent className="max-h-[calc(100vh-2rem)] overflow-y-auto px-4 pb-4">
          <Search />
          <ProjectionSettings />
          <DisplaySettings />
          <button
            type="button"
            className="mt-4 flex w-full items-center justify-between rounded-md border border-white/15 bg-white/5 px-3 py-2 text-left text-sm font-medium transition hover:bg-white/10"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <span>Avancerad</span>
            <span
              aria-hidden="true"
              className={`text-white/55 transition-transform ${
                advancedOpen ? 'rotate-180' : ''
              }`}
            >
              ▾
            </span>
          </button>
          {advancedOpen && <AdvancedSettings stability={stability} />}
        </CardContent>
      </Card>
      <ExplanationPanel />
      <ProjectionStabilityProgressOverlay />
    </>
  )
}
