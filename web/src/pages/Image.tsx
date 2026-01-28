import { activeDatasetIdAtom, datasetApiUrl, embeddingAtom } from '@/state'
import { useAtomValue } from 'jotai'
import { useParams } from 'react-router'

function colorMap(value: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, value))
  const r = Math.floor(
    255 * Math.max(Math.min(1.5 - Math.abs(1 - 4 * (clamped - 0.5)), 1), 0)
  )
  const g = Math.floor(
    255 * Math.max(Math.min(1.5 - Math.abs(2 - 4 * (clamped - 0.5)), 1), 0)
  )
  const b = Math.floor(
    255 * Math.max(Math.min(1.5 - Math.abs(3 - 4 * (clamped - 0.5)), 1), 0)
  )
  return [r, g, b]
}

function ImagePage() {
  const { id } = useParams<{ id: string }>()
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const embedding = useAtomValue(embeddingAtom(id ?? ''))

  if (!datasetId) {
    return <div className="p-4">No dataset selected.</div>
  }

  if (!embedding || embedding.length === 0) {
    return <div className="p-4">No embedding available.</div>
  }

  const maxValue = Math.max(...embedding)
  const minValue = Math.min(...embedding)

  return (
    <div className="flex min-h-screen text-white">
      <div className="glass-panel w-1/2 border-r border-white/20 p-6">
        <div className="grid grid-cols-12 gap-2">
          {embedding.map((value: number, index: number) => (
            <span
              key={index}
              className="h-4 w-12 border border-white/20 text-center text-xs"
              style={{
                backgroundColor: `rgb(${colorMap(
                  (value - minValue) / (maxValue - minValue)
                ).join(',')})`,
                color: value > 0 ? 'black' : 'white',
              }}
            >
              {value.toFixed(4)}
            </span>
          ))}
        </div>
      </div>
      <div className="flex w-1/2 items-center justify-center p-6">
        <div className="glass-panel rounded-2xl p-6 shadow-lg">
          <img
            src={datasetApiUrl(datasetId, `/image/${id}`)}
            alt={`Image ${id}`}
            className="w-full max-w-md"
          />
        </div>
      </div>
    </div>
  )
}

export default ImagePage
