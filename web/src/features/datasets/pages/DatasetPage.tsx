import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router'
import { useSetAtom } from 'jotai'
import { activeDatasetIdAtom, datasetsRevisionAtom } from '@/store'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { DatasetStatusPanel } from '@/features/datasets/components/DatasetStatusPanel'
import { StatusMessage } from '@/shared/components/StatusMessage'
import {
  clearClusterPreviews,
  clearImageRoundtripArtifacts,
  deleteDataset,
  fetchDatasetStatus,
  fetchTagStats,
  generateClusterPreviews,
  generateImageRoundtrip,
  resumeProcessing,
  seedTagsFromMetadata,
} from '@/shared/lib/api'
import type { DatasetStatus, TagStats } from '@/features/datasets/types/datasets'
import { HomeLogoLink } from '@/shared/components/HomeLogoLink'

type ArtifactGroup = 'clip' | 'florence' | 'sdxl' | 'ip_adapter'

const artifactGroups: Array<{
  key: ArtifactGroup
  label: string
  description: string
  confirm: string
}> = [
  {
    key: 'clip',
    label: 'CLIP',
    description: 'Sparade CLIP-embeddings från datasetets bildindex.',
    confirm: 'Detta tar bort sparade CLIP-filer för bildmetadata.',
  },
  {
    key: 'florence',
    label: 'Florence-2',
    description: 'Fullständiga bildbeskrivningar. SDXL-filer tas också bort eftersom de bygger på beskrivningen.',
    confirm: 'Detta tar bort Florence-2-beskrivningar och tillhörande SDXL-filer.',
  },
  {
    key: 'sdxl',
    label: 'SDXL',
    description: 'Korta SDXL-prompter och SDXL-textembeddings.',
    confirm: 'Detta tar bort sparade SDXL-prompter och textembeddings.',
  },
  {
    key: 'ip_adapter',
    label: 'IP-Adapter',
    description: 'Bildembeddings för SDXL IP-Adapter.',
    confirm: 'Detta tar bort sparade IP-Adapter-bildembeddings.',
  },
]

const formatEta = (seconds?: number | null) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return null
  }

  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const secs = rounded % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`
  }
  return `${secs}s`
}

export default function DatasetPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const setActiveDatasetId = useSetAtom(activeDatasetIdAtom)
  const bumpDatasetsRevision = useSetAtom(datasetsRevisionAtom)

  const [dataset, setDataset] = useState<DatasetStatus | null>(null)
  const [tagStats, setTagStats] = useState<TagStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [seedResult, setSeedResult] = useState<string | null>(null)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [resuming, setResuming] = useState(false)
  const [roundtripError, setRoundtripError] = useState<string | null>(null)
  const [roundtripStarting, setRoundtripStarting] = useState(false)
  const [clearingArtifact, setClearingArtifact] = useState<ArtifactGroup | null>(null)
  const [clusterError, setClusterError] = useState<string | null>(null)
  const [clusterStarting, setClusterStarting] = useState(false)
  const [clusterClearing, setClusterClearing] = useState(false)
  const [clusterLevels, setClusterLevels] = useState(4)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
    jobStage === 'atlas' ||
    jobStage === 'image-roundtrip' ||
    jobStage === 'cluster-previews'
  const canResume =
    !!dataset && !isJobActive && (!dataset.embeddings_cached || isPending)
  const roundtripStatus = dataset?.image_roundtrip
  const canGenerateRoundtrip =
    isReady &&
    !isJobActive &&
    !!roundtripStatus &&
    (roundtripStatus.missing ?? 0) > 0
  const showRoundtripProgress =
    dataset?.job?.stage === 'image-roundtrip' &&
    typeof dataset?.job?.progress === 'number'
  const roundtripProgress = showRoundtripProgress
    ? Math.round((dataset?.job?.progress ?? 0) * 100)
    : 0
  const roundtripEta = showRoundtripProgress
    ? formatEta(dataset?.job?.eta_seconds)
    : null
  const roundtripProcessed = dataset?.job?.processed ?? 0
  const roundtripTotalWork = dataset?.job?.total_work
  const roundtripRemaining = dataset?.job?.remaining
  const roundtripCounts = roundtripStatus?.existing_groups ?? {}
  const clusterStatus = dataset?.cluster_previews
  const showClusterProgress =
    dataset?.job?.stage === 'cluster-previews' &&
    typeof dataset?.job?.progress === 'number'
  const clusterProgress = showClusterProgress
    ? Math.round((dataset?.job?.progress ?? 0) * 100)
    : 0
  const clusterEta = showClusterProgress
    ? formatEta(dataset?.job?.eta_seconds)
    : null
  const clusterProcessed = dataset?.job?.processed ?? 0
  const clusterTotalWork = dataset?.job?.total_work
  const clusterRemaining = dataset?.job?.remaining

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

  const handleGenerateRoundtrip = async () => {
    if (!id || !canGenerateRoundtrip) return
    setRoundtripStarting(true)
    setRoundtripError(null)
    try {
      await generateImageRoundtrip(id)
      await reloadStatus()
    } catch (err) {
      setRoundtripError(String(err))
    } finally {
      setRoundtripStarting(false)
    }
  }

  const handleClearArtifact = async (artifactGroup: ArtifactGroup) => {
    if (!id || isJobActive) return
    setClearingArtifact(artifactGroup)
    setRoundtripError(null)
    try {
      await clearImageRoundtripArtifacts(id, artifactGroup)
      await reloadStatus()
    } catch (err) {
      setRoundtripError(String(err))
    } finally {
      setClearingArtifact(null)
    }
  }

  const handleGenerateClusters = async () => {
    if (!id) return
    setClusterStarting(true)
    setClusterError(null)
    try {
      await generateClusterPreviews(id, { levels: clusterLevels, size: 512 })
      await reloadStatus()
    } catch (err) {
      setClusterError('Kunde inte starta klusterbakning.')
    } finally {
      setClusterStarting(false)
    }
  }

  const handleClearClusters = async () => {
    if (!id) return
    setClusterClearing(true)
    setClusterError(null)
    try {
      await clearClusterPreviews(id)
      await reloadStatus()
    } catch (err) {
      setClusterError('Kunde inte ta bort klusterförhandsvisningar.')
    } finally {
      setClusterClearing(false)
    }
  }

  const handleDeleteDataset = async () => {
    if (!id || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteDataset(id)
      setActiveDatasetId(null)
      bumpDatasetsRevision((revision) => revision + 1)
      navigate('/')
    } catch (err) {
      setDeleteError(String(err))
      setDeleting(false)
    }
  }

  return (
    <div className="relative min-h-screen text-white">
      <HomeLogoLink />
      <div className="mx-auto w-full max-w-4xl px-6 pt-20 pb-10">
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
                {showRoundtripProgress && (
                  <DatasetStatusPanel
                    variant="pending"
                    useGlassPanel={false}
                    className="sm:col-span-2 border border-white/10 bg-white/5 text-white/70"
                    description={[
                      'Bildbeskrivningar, CLIP-embeddings och SDXL-textembeddings skapas.',
                      typeof roundtripTotalWork === 'number'
                        ? `${roundtripProcessed}/${roundtripTotalWork} klara`
                        : null,
                      typeof roundtripRemaining === 'number'
                        ? `${roundtripRemaining} kvar`
                        : null,
                      roundtripEta ? `cirka ${roundtripEta} återstår` : null,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    stage={dataset?.job?.stage}
                    showProgress
                    progressPercent={roundtripProgress}
                    progressLabel="Bildmetadata"
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
            <CardTitle>Bildmetadata</CardTitle>
            <CardDescription className="text-white/60">
              Skapa Florence-2-beskrivning, CLIP-embedding och SDXL-textembedding
              för varje bild som saknar filer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-white/50">Totalt</div>
                <div>{roundtripStatus?.total ?? '-'}</div>
              </div>
              <div>
                <div className="text-white/50">Klart</div>
                <div>{roundtripStatus?.complete ?? '-'}</div>
              </div>
              <div>
                <div className="text-white/50">Saknas</div>
                <div>{roundtripStatus?.missing ?? '-'}</div>
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
              {artifactGroups.map((artifact) => {
                const count = roundtripCounts[artifact.key] ?? 0
                const isClearing = clearingArtifact === artifact.key
                return (
                  <div
                    key={artifact.key}
                    className="flex flex-col gap-3 border-b border-white/10 py-3 last:border-b-0 last:pb-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="text-sm font-medium">{artifact.label}</div>
                      <div className="mt-1 text-xs text-white/50">
                        {artifact.description}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="min-w-16 text-right text-sm text-white/70">
                        {count}
                      </div>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={!isReady || isJobActive || count === 0 || !!clearingArtifact}
                          >
                            {isClearing ? 'Tar bort…' : 'Ta bort'}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="border-white/10 bg-zinc-950 text-white">
                          <DialogHeader>
                            <DialogTitle>Ta bort {artifact.label}?</DialogTitle>
                            <DialogDescription className="text-white/60">
                              {artifact.confirm} Åtgärden påverkar {count} bilder och kan
                              återskapas genom att köra metadatajobbet igen.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button type="button" variant="secondary">
                                Avbryt
                              </Button>
                            </DialogClose>
                            <DialogClose asChild>
                              <Button
                                type="button"
                                variant="destructive"
                                onClick={() => {
                                  void handleClearArtifact(artifact.key)
                                }}
                              >
                                Ta bort
                              </Button>
                            </DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                )
              })}
            </div>
            <Button
              type="button"
              onClick={handleGenerateRoundtrip}
              disabled={!canGenerateRoundtrip || roundtripStarting}
            >
              {roundtripStarting ? 'Startar…' : 'Skapa saknade filer'}
            </Button>
            {!isReady && (
              <div className="text-xs text-white/50">
                Datasetet måste vara klart innan detta kan köras.
              </div>
            )}
            {isReady && roundtripStatus && roundtripStatus.missing === 0 && (
              <div className="text-xs text-green-300">
                Alla bildmetadatafiler finns redan.
              </div>
            )}
            {roundtripError && (
              <div className="text-xs text-red-300">{roundtripError}</div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-panel mt-6 text-white">
          <CardHeader>
            <CardTitle>Klusterförhandsvisningar</CardTitle>
            <CardDescription className="text-white/60">
              Baka klusterhierarki och genererade genomsnittsbilder för canvasvyn.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <div className="text-white/50">Finns</div>
                <div>{clusterStatus?.exists ? 'Ja' : 'Nej'}</div>
              </div>
              <div>
                <div className="text-white/50">Nivåer</div>
                <div>{clusterStatus?.levels ?? '-'}</div>
              </div>
              <div>
                <div className="text-white/50">Kluster</div>
                <div>{clusterStatus?.clusters ?? '-'}</div>
              </div>
              <div>
                <div className="text-white/50">Bilder</div>
                <div>{clusterStatus?.images ?? '-'}</div>
              </div>
            </div>
            {showClusterProgress && (
              <DatasetStatusPanel
                variant="pending"
                title="Bakar klusterförhandsvisningar"
                description={[
                  typeof clusterTotalWork === 'number'
                    ? `${clusterProcessed}/${clusterTotalWork} klara`
                    : null,
                  typeof clusterRemaining === 'number'
                    ? `${clusterRemaining} kvar`
                    : null,
                  clusterEta ? `cirka ${clusterEta} återstår` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                stage="cluster-previews"
                showProgress
                progressPercent={clusterProgress}
                progressLabel="Kluster"
                progressLabelClassName="text-xs text-white/70"
              />
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-1">
                <label htmlFor="clusterLevels" className="text-xs text-white/60">
                  Nivåer
                </label>
                <input
                  id="clusterLevels"
                  type="number"
                  min={1}
                  max={8}
                  step={1}
                  value={clusterLevels}
                  onChange={(event) =>
                    setClusterLevels(
                      Math.max(1, Math.floor(Number(event.target.value) || 1))
                    )
                  }
                  className="w-24 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                />
              </div>
              <Button
                type="button"
                onClick={handleGenerateClusters}
                disabled={!isReady || isJobActive || clusterStarting}
              >
                {clusterStarting ? 'Startar…' : 'Baka kluster'}
              </Button>
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!isReady || isJobActive || !clusterStatus?.exists || clusterClearing}
                  >
                    {clusterClearing ? 'Tar bort…' : 'Ta bort'}
                  </Button>
                </DialogTrigger>
                <DialogContent className="border-white/10 bg-zinc-950 text-white">
                  <DialogHeader>
                    <DialogTitle>Ta bort klusterförhandsvisningar?</DialogTitle>
                    <DialogDescription className="text-white/60">
                      Detta tar bort bakad klusterhierarki och genererade klusterbilder.
                      De kan återskapas genom att köra bakningen igen.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button type="button" variant="secondary">
                        Avbryt
                      </Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => {
                          void handleClearClusters()
                        }}
                      >
                        Ta bort
                      </Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {!isReady && (
              <div className="text-xs text-white/50">
                Datasetet måste vara klart innan detta kan köras.
              </div>
            )}
            {clusterError && (
              <div className="text-xs text-red-300">{clusterError}</div>
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

        <div className="mt-10 border-t border-red-400/20 pt-6">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-semibold text-red-300">Ta bort dataset</h2>
              <p className="mt-1 text-sm text-white/60">
                Datasetet döljs från listan. Inga filer tas bort.
              </p>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={deleting}>
                  {deleting ? 'Tar bort…' : 'Ta bort dataset'}
                </Button>
              </DialogTrigger>
              <DialogContent className="border-white/10 bg-zinc-950 text-white">
                <DialogHeader>
                  <DialogTitle>Ta bort dataset?</DialogTitle>
                  <DialogDescription className="text-white/60">
                    Datasetet markeras som borttaget och försvinner från listan.
                    Filerna på servern behålls.
                  </DialogDescription>
                </DialogHeader>
                {deleteError && (
                  <div className="text-sm text-red-300">{deleteError}</div>
                )}
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="secondary">
                      Avbryt
                    </Button>
                  </DialogClose>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      void handleDeleteDataset()
                    }}
                    disabled={deleting}
                  >
                    {deleting ? 'Tar bort…' : 'Ta bort dataset'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          {deleteError && (
            <div className="mt-3 text-sm text-red-300">{deleteError}</div>
          )}
        </div>
      </div>
    </div>
  )
}
