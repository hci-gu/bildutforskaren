import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router'
import { useSetAtom } from 'jotai'
import { activeDatasetIdAtom, API_URL } from '@/state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

type DatasetStatus = {
  dataset_id: string
  name?: string
  status?: string
  metadata_source?: string
  has_metadata_xlsx?: boolean
  created_at?: string
  error?: string | null
  job?: {
    stage?: string
    progress?: number
    processed?: number
    skipped?: number
    error?: string
  }
}

type TagStats = {
  total_images: number
  tagged_images: number
  tagged_percent: number
}

export default function DatasetPage() {
  const { id } = useParams<{ id: string }>()
  const setActiveDatasetId = useSetAtom(activeDatasetIdAtom)

  const [dataset, setDataset] = useState<DatasetStatus | null>(null)
  const [tagStats, setTagStats] = useState<TagStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [seedResult, setSeedResult] = useState<string | null>(null)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  const statusValue = dataset?.status
  const isPending =
    statusValue === 'created' || statusValue === 'uploaded' || statusValue === 'processing'
  const isReady = statusValue === 'ready'
  const statusLabel = isPending ? 'pending' : statusValue || '-'
  const showEmbeddingProgress =
    isPending &&
    dataset?.job?.stage === 'embeddings' &&
    typeof dataset?.job?.progress === 'number'
  const embeddingProgress = showEmbeddingProgress
    ? Math.round((dataset?.job?.progress ?? 0) * 100)
    : 0

  useEffect(() => {
    if (id) setActiveDatasetId(id)
  }, [id, setActiveDatasetId])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [statusRes, statsRes] = await Promise.all([
          fetch(`${API_URL}/datasets/${encodeURIComponent(id)}/status`),
          fetch(`${API_URL}/datasets/${encodeURIComponent(id)}/tag-stats`),
        ])

        if (!statusRes.ok) throw new Error('Failed to fetch dataset status')
        const data = (await statusRes.json()) as DatasetStatus
        if (!cancelled) setDataset(data)

        if (statsRes.ok) {
          const stats = (await statsRes.json()) as TagStats
          if (!cancelled) setTagStats(stats)
        } else if (!cancelled) {
          setTagStats(null)
        }
      } catch (err) {
        if (!cancelled) setDataset(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  const canSeed =
    isReady &&
    !!dataset?.has_metadata_xlsx &&
    (dataset?.metadata_source || 'none') !== 'none'

  const handleSeed = async () => {
    if (!id || !canSeed) return
    setSeeding(true)
    setSeedResult(null)
    setSeedError(null)
    try {
      const res = await fetch(
        `${API_URL}/datasets/${encodeURIComponent(id)}/seed-tags-from-metadata`,
        { method: 'POST' }
      )
      if (!res.ok) throw new Error('Seeding failed')
      const data = await res.json()
      setSeedResult(
        `Infogade ${data.inserted ?? 0} taggar (skippade ${data.skipped_manual ?? 0} bilder med manuella taggar).`
      )
    } catch (err) {
      setSeedError('Kunde inte skapa taggar från metadata.')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="min-h-screen text-white">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Dataset</h1>
            <p className="text-sm text-white/60">{id}</p>
          </div>
          <div className="flex gap-2">
            {id && (
              <>
                {isReady ? (
                  <>
                    <Link to={`/dataset/${id}/canvas`}>
                      <Button variant="secondary" size="sm">
                        Canvas
                      </Button>
                    </Link>
                    <Link to={`/dataset/${id}/street-view`}>
                      <Button variant="secondary" size="sm">
                        Street View
                      </Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" size="sm" disabled>
                      Canvas
                    </Button>
                    <Button variant="secondary" size="sm" disabled>
                      Street View
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <Card className="glass-panel text-white">
          <CardHeader>
            <CardTitle>Översikt</CardTitle>
            <CardDescription className="text-white/60">
              Status och metadata för datasetet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading && <div className="text-sm text-white/60">Laddar…</div>}
            {!loading && !dataset && (
              <div className="text-sm text-red-300">Kunde inte läsa dataset.</div>
            )}
            {dataset && (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <div className="text-white/50">Namn</div>
                  <div>{dataset.name || 'Untitled dataset'}</div>
                </div>
                <div>
                  <div className="text-white/50">Status</div>
                  <div>{statusLabel}</div>
                </div>
                <div>
                  <div className="text-white/50">Antal bilder</div>
                  <div>{tagStats ? tagStats.total_images : '-'}</div>
                </div>
                <div>
                  <div className="text-white/50">Taggade bilder</div>
                  <div>
                    {tagStats
                      ? `${tagStats.tagged_images} (${tagStats.tagged_percent}%)`
                      : '-'}
                  </div>
                </div>
                <div>
                  <div className="text-white/50">Metadata-källa</div>
                  <div>{dataset.metadata_source || 'none'}</div>
                </div>
                <div>
                  <div className="text-white/50">Metadata.xlsx</div>
                  <div>{dataset.has_metadata_xlsx ? 'Ja' : 'Nej'}</div>
                </div>
                <div>
                  <div className="text-white/50">Skapad</div>
                  <div>{dataset.created_at || '-'}</div>
                </div>
                {dataset.error && (
                  <div className="sm:col-span-2">
                    <div className="text-white/50">Fel</div>
                    <div className="text-red-300">{dataset.error}</div>
                  </div>
                )}
                {isPending && (
                  <div className="sm:col-span-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
                    Datasetet bearbetas. Canvas och Street View blir tillgängliga när
                    statusen är klar.
                    {showEmbeddingProgress && (
                      <div className="mt-3">
                        <div>Embeddings {embeddingProgress}%</div>
                        <div className="mt-2 h-2 w-full rounded-full bg-white/10">
                          <div
                            className="h-2 rounded-full bg-amber-400"
                            style={{ width: `${embeddingProgress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-panel mt-6 text-white">
          <CardHeader>
            <CardTitle>Metadata → Taggar</CardTitle>
            <CardDescription className="text-white/60">
              Förifyll taggar från metadata.xlsx (matchar SAO-termer).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              type="button"
              onClick={handleSeed}
              disabled={!canSeed || seeding}
            >
              {seeding ? 'Kör...' : 'Skapa taggar från metadata'}
            </Button>
            {!canSeed && (
              <div className="text-xs text-white/50">
                Metadata måste vara kopplad till datasetet för att köra detta.
              </div>
            )}
            {seedResult && <div className="text-xs text-green-300">{seedResult}</div>}
            {seedError && <div className="text-xs text-red-300">{seedError}</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
