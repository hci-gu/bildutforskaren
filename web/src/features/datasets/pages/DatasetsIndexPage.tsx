import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  activeDatasetUploadAtom,
  datasetsRevisionAtom,
  loadableDatasetsAtom,
} from '@/store'
import { useEffect, useRef, useState } from 'react'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Button } from '@/shared/ui/button'
import { useNavigate } from 'react-router'
import {
  createDataset,
  reportDatasetUploadFailure,
  startDatasetUpload,
  uploadDatasetZip,
} from '@/shared/lib/api'
import { EmbeddingProgressBar } from '@/features/datasets/components/EmbeddingProgressBar'
import { StatusMessage } from '@/shared/components/StatusMessage'
import {
  hasSameDatasetData,
  isDatasetActive,
  type DatasetStatus,
} from '@/features/datasets/types/datasets'

const STATUS_POLL_INTERVAL_MS = 5_000

function DatasetsIndexPage() {
  const [datasetId, setDatasetId] = useAtom(activeDatasetIdAtom)
  const [activeUpload, setActiveUpload] = useAtom(activeDatasetUploadAtom)
  const bumpDatasetsRevision = useSetAtom(datasetsRevisionAtom)
  const datasetsLoadable = useAtomValue(loadableDatasetsAtom)
  const navigate = useNavigate()
  const retryFileInputRef = useRef<HTMLInputElement>(null)

  const [newDatasetName, setNewDatasetName] = useState('')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [retryDatasetId, setRetryDatasetId] = useState<string | null>(null)

  const uploading = creating || !!activeUpload
  const canCreate = newDatasetName.trim().length > 0 && !!zipFile && !uploading
  const loadedDatasets =
    datasetsLoadable.state === 'hasData' ? (datasetsLoadable.data as DatasetStatus[]) : []
  const [datasets, setDatasets] = useState<DatasetStatus[]>([])

  useEffect(() => {
    if (datasetsLoadable.state !== 'hasData') return
    setDatasets((current) =>
      hasSameDatasetData(current, loadedDatasets) ? current : loadedDatasets
    )
  }, [datasetsLoadable.state, loadedDatasets])

  const hasActiveDataset =
    !!activeUpload || datasets.some((dataset) => isDatasetActive(dataset))

  useEffect(() => {
    if (!hasActiveDataset || datasetsLoadable.state === 'loading') return

    const timer = setTimeout(() => {
      bumpDatasetsRevision((revision) => revision + 1)
    }, STATUS_POLL_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [bumpDatasetsRevision, datasetsLoadable.state, hasActiveDataset])

  const startUpload = async (targetDatasetId: string, datasetName: string, file: File) => {
    let attemptStarted = false
    setActiveUpload({
      datasetId: targetDatasetId,
      datasetName,
      phase: 'preparing',
    })
    setUploadStatus(null)

    try {
      await startDatasetUpload(targetDatasetId)
      attemptStarted = true
      setActiveUpload({
        datasetId: targetDatasetId,
        datasetName,
        phase: 'uploading',
      })
      const uploadData = await uploadDatasetZip(targetDatasetId, file)
      bumpDatasetsRevision((revision) => revision + 1)
      setUploadStatus(
        `${datasetName} laddades upp och bearbetas nu (status: ${uploadData.status}).`
      )
    } catch (error) {
      if (attemptStarted) {
        try {
          await reportDatasetUploadFailure(targetDatasetId)
        } catch {
          // The original request error is more useful to the person uploading.
        }
      }
      bumpDatasetsRevision((revision) => revision + 1)
      setUploadStatus(`Uppladdningen misslyckades: ${String(error)}`)
    } finally {
      setActiveUpload(null)
    }
  }

  const createAndUploadDataset = async () => {
    const name = newDatasetName.trim()
    if (!name || !zipFile || uploading) return

    setCreating(true)
    setUploadStatus(null)
    try {
      const created = await createDataset(name)
      const newId = created.dataset_id as string
      setDatasetId(newId)
      bumpDatasetsRevision((revision) => revision + 1)
      setNewDatasetName('')
      setZipFile(null)
      await startUpload(newId, name, zipFile)
    } catch (error) {
      setUploadStatus(`Kunde inte skapa dataset: ${String(error)}`)
    } finally {
      setCreating(false)
    }
  }

  const handleRetry = (targetDatasetId: string) => {
    if (uploading) return
    setRetryDatasetId(targetDatasetId)
    retryFileInputRef.current?.click()
  }

  const handleRetryFileSelected = (file: File | null) => {
    const targetDatasetId = retryDatasetId
    setRetryDatasetId(null)
    if (!targetDatasetId || !file) return

    const dataset = datasets.find((item) => item.dataset_id === targetDatasetId)
    void startUpload(targetDatasetId, dataset?.name ?? targetDatasetId, file)
  }

  return (
    <div className="relative min-h-svh">
      <input
        ref={retryFileInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          event.target.value = ''
          handleRetryFileSelected(file)
        }}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pb-16 pt-12">
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

            {activeUpload && (
              <StatusMessage className="mt-4 text-slate-300">
                {activeUpload.phase === 'preparing'
                  ? `Förbereder uppladdning av ${activeUpload.datasetName}…`
                  : `Laddar upp ${activeUpload.datasetName}… Du kan fortsätta använda sidan under tiden.`}
              </StatusMessage>
            )}

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
                  onChange={(event) => setNewDatasetName(event.target.value)}
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
                  onChange={(event) => setZipFile(event.target.files?.[0] ?? null)}
                  disabled={uploading}
                />
              </div>
            </div>

            <div className="mt-5">
              <Button
                className="w-full"
                onClick={() => void createAndUploadDataset()}
                disabled={!canCreate}
              >
                {uploading ? 'Creating & uploading…' : 'Create dataset & upload'}
              </Button>
              {!canCreate && !uploading && (
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
              <span className="text-xs text-slate-400">{datasets.length} totalt</span>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {datasetsLoadable.state === 'loading' && datasets.length === 0 && (
                <StatusMessage>Laddar datasets…</StatusMessage>
              )}

              {datasetsLoadable.state === 'hasError' && (
                <StatusMessage variant="error">
                  Kunde inte läsa datasets just nu.
                </StatusMessage>
              )}

              {datasetsLoadable.state === 'hasData' && datasets.length === 0 && (
                <StatusMessage>
                  Inga datasets än. Skapa ett nytt för att börja utforska.
                </StatusMessage>
              )}

              {datasets.map((dataset) => {
                const isActive = datasetId === dataset.dataset_id
                const label = dataset.name ?? dataset.dataset_id ?? 'Untitled dataset'
                const status = dataset.status ?? 'unknown'
                const isPending = status === 'created' || isDatasetActive(dataset)
                const isUploadFailed = status === 'upload_failed'
                const isError = status === 'error' || isUploadFailed
                const job = dataset.job
                const showEmbeddingProgress =
                  isPending &&
                  job?.stage === 'embeddings' &&
                  typeof job?.progress === 'number'
                const progressPct = showEmbeddingProgress
                  ? Math.round((job?.progress ?? 0) * 100)
                  : 0
                const statusLabel = status === 'uploading'
                  ? 'Uploading'
                  : isUploadFailed
                  ? 'Upload failed'
                  : isPending
                  ? 'Pending'
                  : isError
                  ? 'Error'
                  : 'Open'

                return (
                  <div
                    key={dataset.dataset_id}
                    className="glass-panel glass-panel-hover flex items-center justify-between gap-4 rounded-xl p-4 transition"
                  >
                    <button
                      type="button"
                      className={`min-w-0 flex-1 text-left ${
                        isActive ? 'text-white' : 'text-slate-100'
                      }`}
                      onClick={() => {
                        if (!dataset.dataset_id) return
                        setDatasetId(dataset.dataset_id)
                        navigate(`/dataset/${dataset.dataset_id}`)
                      }}
                    >
                      <div className="text-sm font-semibold">{label}</div>
                      <div className="text-xs text-slate-400">{dataset.dataset_id}</div>
                      {showEmbeddingProgress && (
                        <EmbeddingProgressBar
                          className="mt-2"
                          percent={progressPct}
                          label="Embeddings"
                          labelClassName="text-[11px] text-slate-400"
                        />
                      )}
                      {isUploadFailed && dataset.error && (
                        <div className="mt-2 text-xs text-rose-300">{dataset.error}</div>
                      )}
                    </button>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span
                        className={`text-xs uppercase tracking-[0.2em] ${
                          isPending
                            ? 'text-amber-300'
                            : isError
                            ? 'text-rose-300'
                            : 'text-slate-400'
                        }`}
                      >
                        {statusLabel}
                      </span>
                      {isUploadFailed && dataset.dataset_id && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={uploading}
                          onClick={() => handleRetry(dataset.dataset_id as string)}
                        >
                          Försök igen
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default DatasetsIndexPage
