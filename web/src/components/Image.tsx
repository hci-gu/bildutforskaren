import { API_URL } from '@/state'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'

export default function Image({
  image,
  index,
}: {
  image: string
  index: number
}) {
  return (
    <Dialog>
      <DialogTrigger>
        <div className="w-full h-48 bg-gray-200 relative">
          <img
            src={`${API_URL}/image/${image}`}
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
          src={`${API_URL}/original/${image}`}
          alt={`Full size image ${index}`}
          className="w-full h-full"
        />
      </DialogContent>
    </Dialog>
  )
}
