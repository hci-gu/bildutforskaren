import { useEffect, useState } from 'react'
import { PhotoView } from 'react-photo-view'
import { useAtomValue } from 'jotai'
import { activeDatasetIdAtom, datasetApiUrl, selectedTagAtom } from '@/state'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

type TagImagesResponse = {
  label: string
  tag_id: number | null
  image_ids: number[]
}

export const TagResultsPanel = () => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const selectedTag = useAtomValue(selectedTagAtom)

  const [loading, setLoading] = useState(false)
  const [imageIds, setImageIds] = useState<number[]>([])
  const [suggestedIds, setSuggestedIds] = useState<number[]>([])
  const [selectedSuggested, setSelectedSuggested] = useState<Set<number>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'tagged' | 'suggested'>('tagged')

  useEffect(() => {
    if (!datasetId || !selectedTag) {
      setImageIds([])
      setSuggestedIds([])
      setSelectedSuggested(new Set())
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [res, suggestRes] = await Promise.all([
          fetch(
            datasetApiUrl(
              datasetId,
              `/tags/images?label=${encodeURIComponent(selectedTag)}&limit=48`
            )
          ),
          fetch(
            datasetApiUrl(
              datasetId,
              `/tags/suggestions?label=${encodeURIComponent(selectedTag)}&limit=24`
            )
          ),
        ])
        if (!res.ok) throw new Error('Failed to fetch images for tag')
        const data = (await res.json()) as TagImagesResponse
        if (!cancelled) setImageIds(data.image_ids || [])
        if (suggestRes.ok) {
          const suggestData = (await suggestRes.json()) as TagImagesResponse
          if (!cancelled) setSuggestedIds(suggestData.image_ids || [])
        } else if (!cancelled) {
          setSuggestedIds([])
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
  }, [datasetId, selectedTag, refreshKey])

  if (!datasetId || !selectedTag) return null

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

  const addSelectedToTag = async () => {
    if (!datasetId || !selectedTag || selectedSuggested.size === 0) return
    setLoading(true)
    setError(null)
    try {
      const resAssign = await fetch(
        datasetApiUrl(datasetId, `/tags/assign`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: selectedTag,
            image_ids: Array.from(selectedSuggested),
            source: 'manual',
          }),
        }
      )
      if (!resAssign.ok) {
        throw new Error('Failed to assign tags')
      }
      setSelectedSuggested(new Set())
      setRefreshKey((v) => v + 1)
    } catch (err) {
      setError('Kunde inte lägga till taggar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card
      className="fixed inset-y-0 right-0 z-10000 w-[32rem] border border-white/10 bg-black/80 text-white shadow-xl backdrop-blur"
      data-canvas-ui="true"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          Tagg: {selectedTag}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex h-[calc(100vh-4rem)] flex-col space-y-3 overflow-hidden">
        {loading && <div className="text-xs text-white/60">Laddar...</div>}
        {error && <div className="text-xs text-red-300">{error}</div>}
        {!loading && !error && imageIds.length === 0 && (
          <div className="text-xs text-white/60">Inga bilder för denna tagg.</div>
        )}
        <div className="flex items-center gap-2 text-xs">
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
            Förslag ({suggestedIds.length})
          </button>
        </div>
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
              {suggestedIds.map((id) => {
                const selected = selectedSuggested.has(id)
                return (
                  <button
                    key={`suggested_${id}`}
                    type="button"
                    onClick={() => toggleSuggested(id)}
                    className={`relative h-44 w-full overflow-hidden rounded border ${
                      selected ? 'border-white' : 'border-white/10'
                    }`}
                  >
                    <PhotoView src={datasetApiUrl(datasetId, `/original/${id}`)}>
                      <img
                        src={datasetApiUrl(datasetId, `/image/${id}`)}
                        className={`h-full w-full object-cover ${
                          selected ? 'opacity-100' : 'opacity-70'
                        }`}
                      />
                    </PhotoView>
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
              {suggestedIds.length === 0 && (
                <div className="text-xs text-white/60">Inga förslag.</div>
              )}
            </div>
          )}
        </div>
        {activeTab === 'suggested' && (
          <div className="sticky bottom-0 left-0 right-0 border-t border-white/10 bg-black/85 p-3">
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
