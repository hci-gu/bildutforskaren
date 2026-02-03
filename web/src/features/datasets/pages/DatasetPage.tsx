import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router'
import { useSetAtom } from 'jotai'
import { activeDatasetIdAtom } from '@/store'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { DatasetStatusPanel } from '@/features/datasets/components/DatasetStatusPanel'
import { StatusMessage } from '@/shared/components/StatusMessage'
import {
  fetchDatasetStatus,
  fetchTagStats,
  resumeProcessing,
  seedTagsFromMetadata,
} from '@/features/datasets/api'
import type { DatasetStatus, TagStats } from '@/features/datasets/types/datasets'

export default function DatasetPage() {
  const { id } = useParams<{ id: string }>()
  const setActiveDatasetId = useSetAtom(activeDatasetIdAtom)

  const [dataset, setDataset] = useState<DatasetStatus | null>(null)
  const [tagStats, setTagStats] = useState<TagStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [seedResult, setSeedResult] = useState<string | null>(null)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [resuming, setResuming] = useState(false)

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
  const jobStage = dataset?.job?.stage
  const isJobActive =
    jobStage === 'queued' ||
    jobStage === 'thumbnails' ||
    jobStage === 'indexing' ||
    jobStage === 'embeddings' ||
    jobStage === 'atlas'
  const canResume =
    !!dataset && !isJobActive && (!dataset.embeddings_cached || isPending)

  const reloadStatus = async (isCancelled?: () => boolean) => {
    if (!id) return
    setLoading(true)
    try {
      const data = await fetchDatasetStatus(id)
      if (isCancelled?.()) return
      setDataset(data)
      try {
        const stats = await fetchTagStats(id)
        if (isCancelled?.()) return
        setTagStats(stats)
      } catch (statsError) {
        if (isCancelled?.()) return
        setTagStats(null)
      }
    } catch (err) {
      if (isCancelled?.()) return
      setDataset(null)
      setTagStats(null)
    } finally {
      if (isCancelled?.()) return
      setLoading(false)
    }
  }

  useEffect(() => {
    if (id) setActiveDatasetId(id)
  }, [id, setActiveDatasetId])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const load = async () => {
      await reloadStatus(() => cancelled)
    }
    load().catch(() => {})
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
      const data = await seedTagsFromMetadata(id)
      setSeedResult(
        `Infogade ${data.inserted ?? 0} taggar (skippade ${data.skipped_manual ?? 0} bilder med manuella taggar).`
      )
    } catch (err) {
      setSeedError('Kunde inte skapa taggar från metadata.')
    } finally {
      setSeeding(false)
    }
  }

  const handleResume = async () => {
    if (!id || !canResume) return
    setResuming(true)
    setResumeError(null)
    try {
      await resumeProcessing(id)
      await reloadStatus()
    } catch (err) {
      setResumeError(String(err))
    } finally {
      setResuming(false)
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
            {loading && (
              <StatusMessage textClassName="text-white/60">Laddar…</StatusMessage>
            )}
            {!loading && !dataset && (
              <StatusMessage variant="error" textClassName="text-red-300">
                Kunde inte läsa dataset.
              </StatusMessage>
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
                  <DatasetStatusPanel
                    variant="pending"
                    useGlassPanel={false}
                    className="sm:col-span-2 border border-white/10 bg-white/5 text-white/70"
                    description="Datasetet bearbetas. Canvas och Street View blir tillgängliga när statusen är klar."
                    showProgress={showEmbeddingProgress}
                    progressPercent={embeddingProgress}
                    textClassName="text-xs text-white/70"
                    progressLabelClassName="text-xs text-white/70"
                  />
                )}
                {canResume && (
                  <div className="sm:col-span-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
                    Det verkar inte finnas någon aktiv bearbetning just nu.
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={handleResume}
                        disabled={resuming}
                      >
                        {resuming ? 'Startar…' : 'Starta om bearbetning'}
                      </Button>
                      {resumeError && (
                        <span className="text-red-300">{resumeError}</span>
                      )}
                    </div>
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
