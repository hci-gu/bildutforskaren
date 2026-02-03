import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  activeDatasetIdAtom,
  datasetsRevisionAtom,
  embeddingsRevisionAtom,
  loadableDatasetsAtom,
} from '@/store'
import { useEffect, useState } from 'react'
import { updateMetadataSource } from '@/shared/lib/api'

export const DatasetPicker = () => {
  const [datasetId, setDatasetId] = useAtom(activeDatasetIdAtom)
  const datasetsLoadable = useAtomValue(loadableDatasetsAtom)
  const bumpDatasetsRevision = useSetAtom(datasetsRevisionAtom)
  const bumpEmbeddingsRevision = useSetAtom(embeddingsRevisionAtom)

  const datasets =
    datasetsLoadable.state === 'hasData' ? (datasetsLoadable.data as any[]) : []

  const active = datasetId ? datasets.find((d) => d.dataset_id === datasetId) : null
  const hasMetadataXlsx = !!active?.has_metadata_xlsx

  const [useLegacyMetadata, setUseLegacyMetadata] = useState(false)

  useEffect(() => {
    setUseLegacyMetadata(active?.metadata_source === 'legacy_xlsx')
  }, [active?.metadata_source, datasetId])

  useEffect(() => {
    if (datasetsLoadable.state !== 'hasData') return

    if (datasets.length === 0) {
      if (datasetId !== null) setDatasetId(null)
      return
    }

    const exists = datasets.some((d) => d.dataset_id === datasetId)
    if (!datasetId || !exists) {
      setDatasetId(datasets[0].dataset_id)
    }
  }, [datasetsLoadable.state, datasets, datasetId, setDatasetId])

  const setLegacyMetadataSource = async (enabled: boolean) => {
    if (!datasetId) return

    const next = enabled ? 'legacy_xlsx' : 'none'
    setUseLegacyMetadata(enabled)

    try {
      await updateMetadataSource(datasetId, next)

      bumpDatasetsRevision((v) => v + 1)
      bumpEmbeddingsRevision((v) => v + 1)
    } catch (err) {
      console.error('Failed to update dataset metadata source:', err)
      setUseLegacyMetadata(!enabled)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-muted-foreground">Dataset</label>
      <select
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        value={datasetId ?? ''}
        onChange={(e) => setDatasetId(e.target.value)}
        disabled={datasetsLoadable.state !== 'hasData' || datasets.length === 0}
      >
        {datasets.length === 0 ? (
          <option value="">No datasets</option>
        ) : (
          datasets.map((d) => (
            <option key={d.dataset_id} value={d.dataset_id}>
              {d.name ?? d.dataset_id}
            </option>
          ))
        )}
      </select>

      {datasetId && hasMetadataXlsx && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={useLegacyMetadata}
            onChange={(e) => setLegacyMetadataSource(e.target.checked)}
          />
          Use metadata.xlsx
        </label>
      )}

      {datasetsLoadable.state === 'loading' && (
        <span className="text-xs text-muted-foreground">Loading…</span>
      )}
    </div>
  )
}
