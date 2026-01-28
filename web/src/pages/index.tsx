import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  API_URL,
  activeDatasetIdAtom,
  datasetsRevisionAtom,
  loadableDatasetsAtom,
} from '../state'
import { useState } from 'react'
import { Input } from '../components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router'

function IndexPage() {
  const [datasetId, setDatasetId] = useAtom(activeDatasetIdAtom)
  const bumpDatasetsRevision = useSetAtom(datasetsRevisionAtom)
  const datasetsLoadable = useAtomValue(loadableDatasetsAtom)
  const navigate = useNavigate()

  const [newDatasetName, setNewDatasetName] = useState('')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const canCreate = newDatasetName.trim().length > 0 && !!zipFile && !uploading

  const createAndUploadDataset = async () => {
    const name = newDatasetName.trim()
    if (!name || !zipFile) return

    setUploading(true)
    setUploadStatus(null)

    try {
      // 1) Create dataset
      const createRes = await fetch(`${API_URL}/datasets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      })

      if (!createRes.ok) {
        const data = await createRes.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Failed to create dataset')
      }

      const created = await createRes.json()
      const newId = created.dataset_id as string

      setDatasetId(newId)
      bumpDatasetsRevision((v) => v + 1)

      // 2) Upload zip
      const formData = new FormData()
      formData.append('file', zipFile)

      const uploadRes = await fetch(`${API_URL}/datasets/${newId}/upload-zip`, {
        method: 'POST',
        body: formData,
      })

      const uploadData = await uploadRes.json().catch(() => ({}))
      if (!uploadRes.ok) {
        throw new Error(uploadData?.error ?? 'Upload failed')
      }

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
    }
  }

  const datasets =
    datasetsLoadable.state === 'hasData' ? (datasetsLoadable.data as any[]) : []

  return (
    <div className="min-h-svh">
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
                <div className="glass-panel rounded-xl p-4 text-sm text-slate-200">
                  Laddar datasets…
                </div>
              )}

              {datasetsLoadable.state === 'hasError' && (
                <div className="rounded-xl border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-200 backdrop-blur">
                  Kunde inte läsa datasets just nu.
                </div>
              )}

              {datasetsLoadable.state === 'hasData' && datasets.length === 0 && (
                <div className="glass-panel rounded-xl p-4 text-sm text-slate-200">
                  Inga datasets ännu. Skapa ett nytt för att börja utforska.
                </div>
              )}

              {datasets.map((dataset) => {
                const isActive = datasetId === dataset.dataset_id
                const label = dataset.name ?? dataset.dataset_id
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
                    <div>
                      <div className="text-sm font-semibold">{label}</div>
                      <div className="text-xs text-slate-400">
                        {dataset.dataset_id}
                      </div>
                    </div>
                    <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Open
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
