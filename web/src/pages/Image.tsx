import { API_URL, embeddingAtom } from '@/state'
import { useAtomValue } from 'jotai'
import { useParams } from 'react-router'

function drawEmbeddingColor(embedding: number[], canvas: HTMLCanvasElement) {
  const width = 32
  const height = 16

  if (embedding.length !== width * height) {
    console.error(`Expected ${width * height} values, got ${embedding.length}`)
    return
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = width
  canvas.height = height

  const imageData = ctx.createImageData(width, height)
  const data = imageData.data

  for (let i = 0; i < embedding.length; i++) {
    const raw = embedding[i] ?? 0

    // Normalize from [-1, 1] → [0, 1]
    const normalized = (raw + 1) / 2
    const color = colorMap(normalized)

    const pixelIndex = i * 4
    data[pixelIndex + 0] = color[0]
    data[pixelIndex + 1] = color[1]
    data[pixelIndex + 2] = color[2]
    data[pixelIndex + 3] = 255
  }

  ctx.putImageData(imageData, 0, 0)
}

// Simple Jet-like colormap for demonstration
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
  //   const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const { id } = useParams<{ id: string }>()
  const embedding = useAtomValue(embeddingAtom(id ?? ''))
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
        {/* <canvas
          ref={(canvasRef) => {
            if (canvasRef && embedding) {
              drawEmbeddingColor(embedding, canvasRef)
            }
          }}
          className="border border-gray-300"
          style={{
            imageRendering: 'pixelated',
            width: '640px',
            height: '320px',
          }}
        /> */}
      </div>
      <div className="w-1/2 flex flex-col items-center justify-center">
        <img
          src={`${API_URL}/image/${id}`} // Replace with your image URL
          alt={`Image ${id}`}
          className="w-full h-auto max-w-md"
        />
      </div>
    </div>
  )
}

export default ImagePage
