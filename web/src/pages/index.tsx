import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  datasetsRevisionAtom,
  loadableDatasetsAtom,
} from '../state'
import { useState } from 'react'
import { Input } from '../components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router'
import { createDataset, uploadDatasetZip } from '@/lib/api'
import { EmbeddingProgressBar } from '@/components/EmbeddingProgressBar'
import { StatusMessage } from '@/components/StatusMessage'

function IndexPage() {
  const [datasetId, setDatasetId] = useAtom(activeDatasetIdAtom)
  const bumpDatasetsRevision = useSetAtom(datasetsRevisionAtom)
  const datasetsLoadable = useAtomValue(loadableDatasetsAtom)
  const navigate = useNavigate()

  const [newDatasetName, setNewDatasetName] = useState('')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'creating' | 'uploading'>(
    'idle'
  )

  const canCreate = newDatasetName.trim().length > 0 && !!zipFile && !uploading

  const createAndUploadDataset = async () => {
    const name = newDatasetName.trim()
    if (!name || !zipFile) return

    setUploading(true)
    setUploadPhase('creating')
    setUploadStatus(null)

    try {
      // 1) Create dataset
      const created = await createDataset(name)
      const newId = created.dataset_id as string

      setDatasetId(newId)
      bumpDatasetsRevision((v) => v + 1)
      setUploadPhase('uploading')
      setUploadStatus('Dataset created. Uploading images…')

      // 2) Upload zip
      const uploadData = await uploadDatasetZip(newId, zipFile)

      bumpDatasetsRevision((v) => v + 1)
      setUploadStatus(
        `Created ${newId} and started processing (status: ${uploadData.status}).`
      )

      // Keep selection on the new dataset; clear inputs
      setNewDatasetName('')
      setZipFile(null)
    } catch (e) {
      setUploadStatus(String(e))
    } finally {
      setUploading(false)
      setUploadPhase('idle')
    }
  }

  const datasets =
    datasetsLoadable.state === 'hasData' ? (datasetsLoadable.data as any[]) : []

  return (
    <div className="relative min-h-svh">
      {uploading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm">
          <div className="glass-panel flex items-center gap-4 rounded-2xl px-6 py-4 text-slate-100">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-transparent" />
            <div className="text-sm">
              {uploadPhase === 'creating'
                ? 'Skapar dataset…'
                : 'Laddar upp bilder…'}
            </div>
          </div>
        </div>
      )}
      <div
        className={`mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pb-16 pt-12 ${
          uploading ? 'pointer-events-none opacity-60' : ''
        }`}
        aria-busy={uploading}
      >
        <header className="glass-panel flex flex-col gap-6 rounded-2xl p-8 shadow-lg shadow-black/20">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Bildutforskaren
              </p>
              <h1 className="mt-3 text-4xl font-semibold text-white sm:text-5xl">
                Utforska dina bildsamlingar med AI.
              </h1>
            </div>
            <div className="max-w-sm text-sm text-slate-300">
              Välj ett dataset för att komma igång, eller skapa ett nytt direkt här
              på startsidan.
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <section className="glass-panel rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Skapa ett nytt dataset
                </h2>
                <p className="text-sm text-slate-300">
                  Datasets är immutabla. Välj ett namn, ladda upp en zip och skapa.
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label className="p-1 text-slate-200" htmlFor="dataset-name">
                  Dataset name
                </Label>
                <Input
                  id="dataset-name"
                  type="text"
                  placeholder="My dataset"
                  value={newDatasetName}
                  onChange={(e) => setNewDatasetName(e.target.value)}
                  disabled={uploading}
                />
              </div>

              <div>
                <Label className="p-1 text-slate-200" htmlFor="dataset-zip">
                  Images (zip)
                </Label>
                <Input
                  id="dataset-zip"
                  type="file"
                  accept=".zip"
                  onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
                  disabled={uploading}
                />
              </div>
            </div>

            <div className="mt-5">
              <Button
                className="w-full"
                onClick={createAndUploadDataset}
                disabled={!canCreate}
              >
                {uploading ? 'Creating & uploading…' : 'Create dataset & upload'}
              </Button>
              {!canCreate && (
                <div className="mt-2 text-xs text-slate-400">
                  Enter a name and choose a zip to enable.
                </div>
              )}
            </div>

            {uploadStatus && (
              <div className="mt-3 text-sm text-slate-300">{uploadStatus}</div>
            )}
          </section>

          <section className="glass-panel rounded-2xl p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Tillgängliga datasets
                </h2>
                <p className="text-sm text-slate-300">
                  Klicka för att öppna ett dataset och gå vidare.
                </p>
              </div>
              <span className="text-xs text-slate-400">
                {datasets.length} totalt
              </span>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {datasetsLoadable.state === 'loading' && (
                <StatusMessage>Laddar datasets…</StatusMessage>
              )}

              {datasetsLoadable.state === 'hasError' && (
                <StatusMessage variant="error">
                  Kunde inte läsa datasets just nu.
                </StatusMessage>
              )}

              {datasetsLoadable.state === 'hasData' && datasets.length === 0 && (
                <StatusMessage>
                  Inga datasets ännu. Skapa ett nytt för att börja utforska.
                </StatusMessage>
              )}

              {datasets.map((dataset) => {
                const isActive = datasetId === dataset.dataset_id
                const label = dataset.name ?? dataset.dataset_id
                const status = dataset.status ?? 'unknown'
                const isPending = ['created', 'uploaded', 'processing'].includes(status)
                const isError = status === 'error'
                const job = dataset.job
                const showEmbeddingProgress =
                  isPending &&
                  job?.stage === 'embeddings' &&
                  typeof job?.progress === 'number'
                const progressPct = showEmbeddingProgress
                  ? Math.round(job.progress * 100)
                  : 0
                return (
                  <button
                    key={dataset.dataset_id}
                    type="button"
                    className={`glass-panel glass-panel-hover flex items-center justify-between gap-4 rounded-xl p-4 text-left transition ${
                      isActive
                        ? 'text-white'
                        : 'text-slate-100'
                    }`}
                    onClick={() => {
                      setDatasetId(dataset.dataset_id)
                      navigate(`/datset/${dataset.dataset_id}`)
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{label}</div>
                      <div className="text-xs text-slate-400">
                        {dataset.dataset_id}
                      </div>
                      {showEmbeddingProgress && (
                        <EmbeddingProgressBar
                          className="mt-2"
                          percent={progressPct}
                          label="Embeddings"
                          labelClassName="text-[11px] text-slate-400"
                        />
                      )}
                    </div>
                    <span
                      className={`text-xs uppercase tracking-[0.2em] ${
                        isPending
                          ? 'text-amber-300'
                          : isError
                          ? 'text-rose-300'
                          : 'text-slate-400'
                      }`}
                    >
                      {isPending ? 'Pending' : isError ? 'Error' : 'Open'}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default IndexPage
