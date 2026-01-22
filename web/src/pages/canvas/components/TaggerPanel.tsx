import { useEffect, useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  API_URL,
  activeDatasetIdAtom,
  datasetApiUrl,
  selectedEmbeddingAtom,
  selectedEmbeddingIdsAtom,
  taggedImagesRevisionAtom,
} from '@/state'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

type ImageTag = {
  id: number
  label: string
  source: string
  created_at: string
}

type SaoTerm = {
  id: string
  label: string
  scope_note?: string
}

type TagSuggestion = {
  id: string
  label: string
  score: number
  source: string
}

export const TaggerPanel = () => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const selectedEmbedding = useAtomValue<any>(selectedEmbeddingAtom)
  const selectedEmbeddingIds = useAtomValue(selectedEmbeddingIdsAtom)
  const bumpTaggedRevision = useSetAtom(taggedImagesRevisionAtom)

  const imageId = useMemo(() => {
    if (selectedEmbedding?.id !== undefined && selectedEmbedding?.id !== null) {
      return Number(selectedEmbedding.id)
    }
    if (selectedEmbeddingIds.length === 1) {
      return Number(selectedEmbeddingIds[0])
    }
    return null
  }, [selectedEmbedding, selectedEmbeddingIds])

  const [tags, setTags] = useState<ImageTag[]>([])
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<SaoTerm[]>([])
  const [autoSuggestions, setAutoSuggestions] = useState<TagSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingAuto, setLoadingAuto] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const existingLabels = useMemo(
    () => new Set(tags.map((tag) => tag.label.toLowerCase())),
    [tags]
  )

  useEffect(() => {
    if (!datasetId || imageId === null || Number.isNaN(imageId)) {
      setTags([])
      return
    }

    let cancelled = false
    const loadTags = async () => {
      setError(null)
      try {
        const res = await fetch(
          datasetApiUrl(datasetId, `/images/${imageId}/tags`)
        )
        if (!res.ok) throw new Error('Failed to load tags')
        const data = (await res.json()) as ImageTag[]
        if (!cancelled) setTags(data)
      } catch (err) {
        if (!cancelled) setError('Kunde inte läsa taggar.')
      }
    }

    loadTags()
    return () => {
      cancelled = true
    }
  }, [datasetId, imageId, refreshKey])

  useEffect(() => {
    if (!datasetId || imageId === null || Number.isNaN(imageId)) {
      setAutoSuggestions([])
      return
    }

    let cancelled = false
    const loadAuto = async () => {
      setLoadingAuto(true)
      try {
        const res = await fetch(
          datasetApiUrl(datasetId, `/images/${imageId}/tag-suggestions?limit=3`)
        )
        if (!res.ok) throw new Error('Failed to load suggestions')
        const data = (await res.json()) as TagSuggestion[]
        if (!cancelled) setAutoSuggestions(data)
      } catch (err) {
        if (!cancelled) setAutoSuggestions([])
      } finally {
        if (!cancelled) setLoadingAuto(false)
      }
    }

    loadAuto()
    return () => {
      cancelled = true
    }
  }, [datasetId, imageId, refreshKey])

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([])
      return
    }

    let cancelled = false
    const handle = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `${API_URL}/terms/sao?q=${encodeURIComponent(query.trim())}&limit=20`
        )
        if (!res.ok) throw new Error('Search failed')
        const data = (await res.json()) as SaoTerm[]
        if (!cancelled) setSuggestions(data)
      } catch (err) {
        if (!cancelled) setSuggestions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query])

  const addTag = async (label: string) => {
    if (!datasetId || imageId === null || Number.isNaN(imageId)) return
    if (existingLabels.has(label.toLowerCase())) return

    setSaving(label)
    try {
      const res = await fetch(
        datasetApiUrl(datasetId, `/images/${imageId}/tags`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ labels: [label], source: 'manual' }),
        }
      )
      if (!res.ok) throw new Error('Failed to add tag')
      setQuery('')
      setSuggestions([])
      setRefreshKey((v) => v + 1)
      bumpTaggedRevision((v) => v + 1)
    } catch (err) {
      setError('Kunde inte lägga till tagg.')
    } finally {
      setSaving(null)
    }
  }

  const removeTag = async (tagId: number) => {
    if (!datasetId || imageId === null || Number.isNaN(imageId)) return
    setSaving(String(tagId))
    try {
      const res = await fetch(
        datasetApiUrl(datasetId, `/images/${imageId}/tags`),
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag_ids: [tagId], source: 'manual' }),
        }
      )
      if (!res.ok) throw new Error('Failed to remove tag')
      setRefreshKey((v) => v + 1)
      bumpTaggedRevision((v) => v + 1)
    } catch (err) {
      setError('Kunde inte ta bort tagg.')
    } finally {
      setSaving(null)
    }
  }

  if (!datasetId) return null
  if (imageId === null || Number.isNaN(imageId)) {
    if (selectedEmbeddingIds.length > 1) {
      return (
        <Card
          className="fixed bottom-6 right-6 z-10000 w-80 border border-white/10 bg-black/70 text-white backdrop-blur"
          data-canvas-ui="true"
        >
          <CardContent className="py-3 text-sm">
            Välj en bild för att tagga.
          </CardContent>
        </Card>
      )
    }
    return null
  }

  const filteredSuggestions = suggestions.filter(
    (term) => !existingLabels.has(term.label.toLowerCase())
  )

  return (
    <Card
      className="fixed bottom-6 right-6 z-10000 flex h-[32rem] max-h-[calc(100vh-3rem)] w-96 flex-col border border-white/10 bg-black/70 text-white shadow-xl backdrop-blur"
      data-canvas-ui="true"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Tagga bild</CardTitle>
        <div className="text-xs text-white/70">Bild ID: {imageId}</div>
      </CardHeader>
      <CardContent className="flex flex-1 min-h-0 flex-col gap-3 overflow-hidden">
        {error && <div className="text-xs text-red-300">{error}</div>}

        <div className="flex flex-wrap gap-2">
          {tags.length === 0 && (
            <span className="text-xs text-white/50">Inga taggar ännu.</span>
          )}
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs"
            >
              {tag.label}
              <button
                type="button"
                onClick={() => removeTag(tag.id)}
                className="text-white/60 hover:text-white"
                aria-label={`Remove ${tag.label}`}
                disabled={saving !== null}
              >
                ×
              </button>
            </span>
          ))}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-white/80">
            Förslag (AI)
          </div>
          {loadingAuto && (
            <div className="text-xs text-white/60">Hämtar förslag…</div>
          )}
          {!loadingAuto && autoSuggestions.length === 0 && (
            <div className="text-xs text-white/50">Inga förslag just nu.</div>
          )}
          <div className="flex flex-wrap gap-2">
            {autoSuggestions.map((term) => (
              <button
                key={`${term.id}:${term.label}`}
                type="button"
                onClick={() => addTag(term.label)}
                className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10"
                disabled={saving !== null}
                aria-label={`Add ${term.label}`}
              >
                {term.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-1 min-h-0 flex-col gap-2">
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök SAO-termer..."
            className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
          />
          {loading && (
            <div className="text-xs text-white/60">Söker...</div>
          )}
          {!loading && query.trim() && filteredSuggestions.length === 0 && (
            <div className="text-xs text-white/60">
              Inga träffar på SAO-termer.
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
            {filteredSuggestions.map((term) => (
              <div
                key={`${term.id}:${term.label}`}
                className="flex items-start justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2"
              >
                <div>
                  <div className="text-xs font-semibold">{term.label}</div>
                  {term.scope_note && (
                    <div className="text-[10px] text-white/60">
                      {term.scope_note}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-7"
                  onClick={() => addTag(term.label)}
                  disabled={saving !== null}
                >
                  Lägg till
                </Button>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
