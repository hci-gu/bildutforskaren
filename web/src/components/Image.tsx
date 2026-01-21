import { activeDatasetIdAtom, datasetApiUrl } from '@/state'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { useAtomValue } from 'jotai'

export default function Image({
  image,
  index,
}: {
  image: string
  index: number
}) {
  const datasetId = useAtomValue(activeDatasetIdAtom)

  if (!datasetId) return null

  return (
    <Dialog>
      <DialogTrigger>
        <div className="w-full h-48 bg-gray-200 relative">
          <img
            src={datasetApiUrl(datasetId, `/image/${image}`)}
            alt={`Image ${index}`}
            className="w-full h-full object-cover"
          />
          <span className="absolute bottom-2 right-2 bg-black text-white text-xs px-2 py-1 rounded">
            {image}
          </span>
        </div>
      </DialogTrigger>
      <DialogContent
        style={{ width: 1024, maxWidth: 1024, height: 600, top: 300 }}
      >
        <img
          src={datasetApiUrl(datasetId, `/original/${image}`)}
          alt={`Full size image ${index}`}
          className="w-full h-full"
        />
      </DialogContent>
    </Dialog>
  )
}
