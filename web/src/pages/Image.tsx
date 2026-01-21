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
    <div className="flex h-screen">
      <div className="w-1/2 border-r border-gray-300 flex items-center justify-center overflow-y-scroll h-300">
        <div className="grid grid-cols-12 gap-2">
          {embedding.map((value: number, index: number) => (
            <span
              key={index}
              className="w-12 h-4 border border-gray-300 text-sm text-center"
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
      <div className="w-1/2 flex flex-col items-center justify-center">
        <img
          src={datasetApiUrl(datasetId, `/image/${id}`)}
          alt={`Image ${id}`}
          className="w-full h-auto max-w-md"
        />
      </div>
    </div>
  )
}

export default ImagePage
