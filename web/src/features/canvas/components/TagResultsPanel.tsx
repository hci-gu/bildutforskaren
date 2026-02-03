import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { PhotoView } from 'react-photo-view'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  projectionSettingsAtom,
  projectionRevisionAtom,
  selectedTagsAtom,
  selectedEmbeddingAtom,
  steerBlendAlphaAtom,
  steerSuggestionsAtom,
  steerSuggestedResultsAtom,
  steerSuggestedIdsAtom,
  steerTaggedIdsAtom,
  steerSeedCountAtom,
  steerSeedIdsAtom,
  steerRadiusAtom,
  steerTargetPointAtom,
  tagRefreshTriggerAtom,
  taggedImagesRevisionAtom,
} from '@/store'
import {
  assignTagsToImages,
  datasetApiUrl,
  fetchImageMetadata,
  fetchTagSuggestionsMulti,
  fetchTagSuggestionsSteered,
  fetchTagsCooccurrence,
  fetchTagsImagesMulti,
} from '@/shared/lib/api'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'

type TagImagesResponse = {
  labels: string[]
  tag_ids: number[]
  image_ids: number[]
}

type TagCooccurrenceResponse = {
  labels: string[]
  items: Array<{ label: string; count: number }>
}

export const TagResultsPanel = () => {
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshUntilRef = useRef(0)
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const selectedTags = useAtomValue(selectedTagsAtom)
  const selectedEmbedding = useAtomValue(selectedEmbeddingAtom)
  const tagRefreshTrigger = useAtomValue(tagRefreshTriggerAtom)
  const [projectionSettings, setProjectionSettings] = useAtom(
    projectionSettingsAtom
  )
  const [steerSuggestions, setSteerSuggestions] = useAtom(steerSuggestionsAtom)
  const [steerSuggestedResults, setSteerSuggestedResults] = useAtom(
    steerSuggestedResultsAtom
  )
  const [steerSeedCount, setSteerSeedCount] = useAtom(steerSeedCountAtom)
  const [steerRadius, setSteerRadius] = useAtom(steerRadiusAtom)
  const [steerBlendAlpha, setSteerBlendAlpha] = useAtom(steerBlendAlphaAtom)
  const setSelectedTags = useSetAtom(selectedTagsAtom)
  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const bumpTaggedRevision = useSetAtom(taggedImagesRevisionAtom)
  const bumpProjectionRevision = useSetAtom(projectionRevisionAtom)
  const bumpTagRefreshTrigger = useSetAtom(tagRefreshTriggerAtom)
  const setSteerTaggedIds = useSetAtom(steerTaggedIdsAtom)
  const setSteerSuggestedIds = useSetAtom(steerSuggestedIdsAtom)
  const steerSeedIds = useAtomValue(steerSeedIdsAtom)
  const setSteerSeedIds = useSetAtom(steerSeedIdsAtom)
  const setSteerTargetPoint = useSetAtom(steerTargetPointAtom)

  const [loading, setLoading] = useState(false)
  const [imageIds, setImageIds] = useState<number[]>([])
  const [suggestedIds, setSuggestedIds] = useState<number[]>([])
  const [selectedSuggested, setSelectedSuggested] = useState<Set<number>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [showRefresh, setShowRefresh] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'tagged' | 'suggested'>('tagged')
  const [cooccurrence, setCooccurrence] = useState<
    Array<{ label: string; count: number }>
  >([])
  const [cooccurrenceLoading, setCooccurrenceLoading] = useState(false)
  const previousProjectionTypeRef = useRef<string | null>(null)

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

  useEffect(() => {
    if (!datasetId || selectedTags.length === 0) {
      setImageIds([])
      setSuggestedIds([])
      setSelectedSuggested(new Set())
      setCooccurrence([])
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = (await fetchTagsImagesMulti(
          datasetId,
          selectedTags
        )) as TagImagesResponse
        let suggestData: TagImagesResponse | null = null
        try {
          if (steerSuggestions && steerSeedIds.length > 0) {
            suggestData = (await fetchTagSuggestionsSteered(
              datasetId,
              selectedTags,
              steerSeedIds,
              steerBlendAlpha,
              24
            )) as TagImagesResponse
          } else {
            suggestData = (await fetchTagSuggestionsMulti(
              datasetId,
              selectedTags,
              24
            )) as TagImagesResponse
          }
        } catch (suggestError) {
          suggestData = null
        }
        if (!cancelled) setImageIds(data.image_ids || [])
        if (!cancelled) {
          const nextSuggested = suggestData?.image_ids || []
          setSuggestedIds(nextSuggested)
          if (steerSuggestions) {
            setSteerSuggestedResults(nextSuggested)
          } else if (steerSuggestedResults) {
            setSteerSuggestedResults(null)
          }
        }
        if (!cancelled) {
          setActiveTab((prev) => {
            if (prev === 'tagged' && (data.image_ids || []).length === 0) {
              return 'suggested'
            }
            return prev
          })
        }
        if (!cancelled) setSelectedSuggested(new Set())
      } catch (err) {
        if (!cancelled) setError('Kunde inte hämta bilder för taggen.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [
    datasetId,
    refreshKey,
    selectedTags,
    steerBlendAlpha,
    steerSeedIds,
    steerSuggestions,
    setSteerSuggestedResults,
  ])

  useEffect(() => {
    if (!datasetId || selectedTags.length === 0) {
      setCooccurrence([])
      return
    }
    let cancelled = false
    const load = async () => {
      setCooccurrenceLoading(true)
      try {
        const data = (await fetchTagsCooccurrence(
          datasetId,
          selectedTags,
          20
        )) as TagCooccurrenceResponse
        if (!cancelled) {
          setCooccurrence(data.items || [])
        }
      } catch (err) {
        if (!cancelled) setCooccurrence([])
      } finally {
        if (!cancelled) setCooccurrenceLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [datasetId, selectedTags, refreshKey])

  useEffect(() => {
    setSteerTaggedIds(imageIds)
  }, [imageIds, setSteerTaggedIds])

  useEffect(() => {
    if (steerSuggestions && steerSuggestedResults) {
      setSteerSuggestedIds(steerSuggestedResults)
      return
    }
    setSteerSuggestedIds(suggestedIds)
  }, [
    setSteerSuggestedIds,
    steerSuggestedResults,
    steerSuggestions,
    suggestedIds,
  ])

  useEffect(() => {
    return () => {
      if (previousProjectionTypeRef.current) {
        const previous = previousProjectionTypeRef.current
        previousProjectionTypeRef.current = null
        setProjectionSettings((current) => ({
          ...current,
          type: previous,
        }))
      }
      setSteerSuggestions(false)
      setSteerTaggedIds([])
      setSteerSuggestedIds([])
      setSteerSeedIds([])
      setSteerTargetPoint(null)
      setSteerSuggestedResults(null)
    }
  }, [
    setProjectionSettings,
    setSteerSeedIds,
    setSteerSuggestedResults,
    setSteerSuggestions,
    setSteerTargetPoint,
    setSteerTaggedIds,
    setSteerSuggestedIds,
  ])

  if (!datasetId || selectedTags.length === 0) return null
  const effectiveSuggestedIds =
    steerSuggestions && steerSuggestedResults ? steerSuggestedResults : suggestedIds

  const toggleSuggested = (id: number) => {
    setSelectedSuggested((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const refreshSelectedEmbeddingMeta = async (id: number) => {
    if (!datasetId) return
    try {
      const meta = await fetchImageMetadata(datasetId, id)
      setSelectedEmbedding({ id, meta })
    } catch (err) {
      // Ignore metadata fetch errors.
    }
  }

  const addSelectedToTag = async () => {
    if (!datasetId || selectedTags.length === 0 || selectedSuggested.size === 0)
      return
    setLoading(true)
    setError(null)
    try {
      await assignTagsToImages(
        datasetId,
        selectedTags,
        Array.from(selectedSuggested),
        'manual'
      )
      bumpTaggedRevision((v) => v + 1)
      bumpProjectionRevision((v) => v + 1)
      bumpTagRefreshTrigger((v) => v + 1)
      setSelectedSuggested(new Set())
      setRefreshKey((v) => v + 1)
      if (
        selectedEmbedding &&
        selectedSuggested.has(Number(selectedEmbedding.id))
      ) {
        await refreshSelectedEmbeddingMeta(Number(selectedEmbedding.id))
      }
    } catch (err) {
      setError('Kunde inte lägga till taggar.')
    } finally {
      setLoading(false)
    }
  }

  const openImage = async (id: number) => {
    if (!datasetId) return
    setSelectedEmbedding({ id, meta: {} })
    try {
      const meta = await fetchImageMetadata(datasetId, id)
      setSelectedEmbedding({ id, meta })
    } catch (err) {
      // Ignore metadata fetch errors.
    }
  }

  const handleSuggestedContextMenu = (event: MouseEvent, id: number) => {
    event.preventDefault()
    event.stopPropagation()
    openImage(id)
  }

  const toggleSteerSuggestions = () => {
    setSteerSuggestions((prev) => {
      const next = !prev
      if (next) {
        if (!previousProjectionTypeRef.current) {
          previousProjectionTypeRef.current = projectionSettings.type
        }
        setProjectionSettings((current) => ({
          ...current,
          type: 'umap',
        }))
        setSteerSeedIds([])
        setSteerTargetPoint(null)
        setSteerSuggestedResults(null)
      } else {
        if (previousProjectionTypeRef.current) {
          const previous = previousProjectionTypeRef.current
          previousProjectionTypeRef.current = null
          setProjectionSettings((current) => ({
            ...current,
            type: previous,
          }))
        }
        setSteerSeedIds([])
        setSteerTargetPoint(null)
        setSteerSuggestedResults(null)
      }
      return next
    })
  }

  return (
    <Card
      className="glass-panel fixed inset-y-0 right-0 z-10000 w-[32rem] text-white shadow-xl"
      data-canvas-ui="true"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Valda taggar</CardTitle>
        <div className="flex flex-wrap gap-2 pt-2">
          {selectedTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() =>
                setSelectedTags((prev) => prev.filter((t) => t !== tag))
              }
              className="flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
            >
              {tag}
              <span className="text-white/50">×</span>
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex h-[calc(100vh-4rem)] flex-col space-y-3 overflow-hidden">
        {loading && <div className="text-xs text-white/60">Laddar...</div>}
        {error && <div className="text-xs text-red-300">{error}</div>}
        <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-[11px] font-semibold text-white/70">
            Förekomst av andra taggar
          </div>
          {cooccurrenceLoading && (
            <div className="text-[11px] text-white/50">Laddar…</div>
          )}
          {!cooccurrenceLoading && cooccurrence.length === 0 && (
            <div className="text-[11px] text-white/50">Inga träffar.</div>
          )}
          {!cooccurrenceLoading && cooccurrence.length > 0 && (
            <div className="flex max-h-32 flex-wrap gap-1 overflow-auto pr-1">
              {cooccurrence.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() =>
                    setSelectedTags((prev) =>
                      prev.includes(item.label)
                        ? prev
                        : [...prev, item.label]
                    )
                  }
                  className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/20"
                  title={`${item.label} (${item.count})`}
                >
                  {item.label} ({item.count})
                </button>
              ))}
            </div>
          )}
        </div>
        {!loading && !error && imageIds.length === 0 && (
          <div className="text-xs text-white/60">Inga bilder för denna tagg.</div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('tagged')}
              className={`rounded-full px-3 py-1 ${
                activeTab === 'tagged'
                  ? 'bg-white text-black'
                  : 'border border-white/20 text-white/70'
              }`}
            >
            Taggade ({imageIds.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('suggested')}
            className={`rounded-full px-3 py-1 ${
              activeTab === 'suggested'
                ? 'bg-white text-black'
                : 'border border-white/20 text-white/70'
            }`}
          >
            Förslag ({effectiveSuggestedIds.length})
          </button>
        </div>
          <button
            type="button"
            onClick={toggleSteerSuggestions}
            className={`rounded-full px-3 py-1 ${
              steerSuggestions
                ? 'bg-emerald-300 text-black'
                : 'border border-white/20 text-white/70'
            }`}
          >
            Styr förslag
          </button>
        </div>
        {steerSuggestions && (
          <div className="space-y-2 text-[11px] text-white/60">
            <div>Visar UMAP: taggade i grönt, förslag i gult.</div>
            <div className="space-y-1">
              <label className="block text-[10px] uppercase tracking-wide text-white/50">
                Seed count
              </label>
              <input
                type="range"
                min={4}
                max={128}
                step={4}
                value={steerSeedCount}
                onChange={(e) => setSteerSeedCount(Number(e.target.value))}
                className="w-full accent-emerald-300"
              />
              <div className="text-[10px] text-white/50">{steerSeedCount}</div>
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] uppercase tracking-wide text-white/50">
                Radius (UMAP)
              </label>
              <input
                type="range"
                min={0}
                max={10}
                step={0.1}
                value={steerRadius ?? 0}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setSteerRadius(next <= 0 ? null : next)
                }}
                className="w-full accent-emerald-300"
              />
              <div className="text-[10px] text-white/50">
                {steerRadius ? steerRadius.toFixed(1) : 'off'}
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] uppercase tracking-wide text-white/50">
                Blend α
              </label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={steerBlendAlpha}
                onChange={(e) => setSteerBlendAlpha(Number(e.target.value))}
                className="w-full accent-emerald-300"
              />
              <div className="text-[10px] text-white/50">
                {steerBlendAlpha.toFixed(2)} (0=tag mean, 1=centroid, 2=push)
              </div>
            </div>
          </div>
        )}
        <div className="text-[11px] text-white/50">
          Högerklicka på en bild för att visa i helskärm.
        </div>
        {showRefresh && (
          <div className="flex items-center gap-2 text-[11px] text-white/60">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-white/40 border-t-transparent" />
            Uppdaterar…
          </div>
        )}
        <div className="flex-1 overflow-auto pr-1 pb-24">
          {activeTab === 'tagged' && (
            <div className="grid grid-cols-2 gap-3 pr-2">
              {imageIds.map((id) => (
                <PhotoView
                  key={id}
                  src={datasetApiUrl(datasetId, `/original/${id}`)}
                >
                  <img
                    src={datasetApiUrl(datasetId, `/image/${id}`)}
                    className="h-44 w-full rounded object-cover cursor-pointer"
                    onClick={() => openImage(id)}
                  />
                </PhotoView>
              ))}
              {imageIds.length === 0 && (
                <div className="text-xs text-white/60">Inga taggade bilder.</div>
              )}
            </div>
          )}
          {activeTab === 'suggested' && (
            <div className="grid grid-cols-2 gap-3 pr-2">
              {effectiveSuggestedIds.map((id) => {
                const selected = selectedSuggested.has(id)
                return (
                  <button
                    key={`suggested_${id}`}
                    type="button"
                    onClick={() => toggleSuggested(id)}
                    onContextMenu={(event) =>
                      handleSuggestedContextMenu(event, id)
                    }
                    className={`relative h-44 w-full overflow-hidden rounded border ${
                      selected ? 'border-white' : 'border-white/10'
                    }`}
                  >
                    <img
                      src={datasetApiUrl(datasetId, `/image/${id}`)}
                      className={`h-full w-full object-cover ${
                        selected ? 'opacity-100' : 'opacity-70'
                      }`}
                    />
                    {selected && (
                      <div className="absolute inset-0 bg-white/10">
                        <div className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[10px] text-black">
                          Vald
                        </div>
                      </div>
                    )}
                  </button>
                )
              })}
              {effectiveSuggestedIds.length === 0 && (
                <div className="text-xs text-white/60">Inga förslag.</div>
              )}
            </div>
          )}
        </div>
        {activeTab === 'suggested' && (
          <div className="glass-panel sticky bottom-0 left-0 right-0 p-3">
            <div className="flex items-center justify-between text-xs text-white/70">
              <span>{selectedSuggested.size} valda</span>
              <button
                type="button"
                onClick={addSelectedToTag}
                disabled={selectedSuggested.size === 0 || loading}
                className="rounded bg-white/90 px-3 py-2 text-xs text-black disabled:opacity-50"
              >
                Tagga valda
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
