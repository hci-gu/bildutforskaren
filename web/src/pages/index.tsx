import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  API_URL,
  activeDatasetIdAtom,
  datasetApiUrl,
  datasetsRevisionAtom,
  searchImageAtom,
  searchImagesAtom,
  searchQueryAtom,
} from '../state'
import { useState, useEffect } from 'react'
import { Input } from '../components/ui/input'
import { PhotoView } from 'react-photo-view'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Link } from 'react-router'
import { DatasetPicker } from '@/components/DatasetPicker'

function IndexPage() {
  const [query, setQuery] = useState('')
  const [_, setFile] = useAtom(searchImageAtom)
  const [__, setDebouncedQuery] = useAtom(searchQueryAtom)
  const searchResults = useAtomValue(searchImagesAtom)

  const [datasetId, setDatasetId] = useAtom(activeDatasetIdAtom)
  const bumpDatasetsRevision = useSetAtom(datasetsRevisionAtom)

  const [newDatasetName, setNewDatasetName] = useState('')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query)
    }, 300)
    return () => {
      clearTimeout(handler)
    }
  }, [query])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setDebouncedQuery('')
    const selectedFile = event.target.files?.[0]

    if (!datasetId) {
      console.warn('No active dataset selected')
      return
    }

    if (selectedFile) {
      setFile(selectedFile as any)
      const formData = new FormData()
      formData.append('file', selectedFile)

      fetch(datasetApiUrl(datasetId, '/search-by-image'), {
        method: 'POST',
        body: formData,
      }).catch((error) => {
        console.error('Error searching by image:', error)
      })
    }
  }

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

  return (
    <div className="flex flex-col items-center min-h-svh mt-4">
      <div className="p-12 w-full max-w-4xl">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Bildutforskaren</h1>
            <p className="text-gray-600">
              Utforska dina bilder med AI! Välj dataset, sök eller ladda upp en
              bild.
            </p>
          </div>
          <DatasetPicker />
        </div>

        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="col-span-3">
            <h2 className="text-lg font-semibold">Create a new dataset</h2>
            <p className="text-sm text-muted-foreground">
              Datasets are immutable: pick a name, upload a zip, then create.
            </p>
          </div>

          <div className="col-span-2">
            <Label className="p-1" htmlFor="dataset-name">
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

          <div className="col-span-1">
            <Label className="p-1" htmlFor="dataset-zip">
              Images (zip)
            </Label>
            <Input
              id="dataset-zip"
              type="file"
              accept=".zip"
              onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="col-span-3">
            <Button
              className="w-full"
              onClick={createAndUploadDataset}
              disabled={!canCreate}
            >
              {uploading ? 'Creating & uploading…' : 'Create dataset & upload'}
            </Button>
            {!canCreate && (
              <div className="mt-2 text-xs text-muted-foreground">
                Enter a name and choose a zip to enable.
              </div>
            )}
          </div>

          {uploadStatus && (
            <div className="col-span-3 text-sm text-muted-foreground">
              {uploadStatus}
            </div>
          )}
        </div>

        <div className="flex gap-4 justify-center mb-8">
          {datasetId ? (
            <>
              <Link to={`/dataset/${datasetId}/canvas`}>
                <Button>Canvas</Button>
              </Link>
              <Link to={`/dataset/${datasetId}/street-view`}>
                <Button>Street view</Button>
              </Link>
            </>
          ) : (
            <>
              <Button disabled>Canvas</Button>
              <Button disabled>Street view</Button>
            </>
          )}
        </div>

        <div className="flex gap-4 justify-center mb-8">
          <div className="w-1/2">
            <Label className="p-1" htmlFor="search">
              Sök
            </Label>
            <Input
              id="search"
              type="text"
              placeholder={datasetId ? 'Skriv något...' : 'Create/select a dataset first'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!datasetId}
            />
          </div>
          <div className="w-1/2">
            <Label className="p-1" htmlFor="image-search">
              Sök med bild
            </Label>
            <Input
              id="image-search"
              type="file"
              placeholder="Sök..."
              onChange={handleFileChange}
              disabled={!datasetId}
            />
          </div>
        </div>

        <div className="w-full">
          <div className="grid grid-cols-6 gap-4">
            {datasetId &&
              searchResults.map(
                (
                  { id, distance }: { id: number; distance: number },
                  index: number
                ) => (
                  <PhotoView
                    key={`Image_${id}_${distance}_${index}`}
                    src={datasetApiUrl(datasetId, `/original/${id}`)}
                  >
                    <div>
                      <img src={datasetApiUrl(datasetId, `/image/${id}`)} />
                      <span>{distance.toFixed(4)}</span>
                    </div>
                  </PhotoView>
                )
              )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default IndexPage
