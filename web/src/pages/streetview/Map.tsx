import { Button } from '@/components/ui/button'
import { API_URL, searchImageAtom, searchImagesAtom } from '@/state'
import { GoogleMap, StreetViewPanorama } from '@react-google-maps/api'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import Draggable from 'react-draggable'
import { Slider } from '@/components/ui/slider'

const SelectedDraggableImage = ({
  id,
  close,
}: {
  id: string
  close: () => void
}) => {
  const draggableRef = useRef<any>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  return (
    <Draggable defaultPosition={{ x: 0, y: 0 }} nodeRef={draggableRef}>
      <div ref={draggableRef} className="relative z-50 w-300">
        <img
          ref={imageRef}
          src={`${API_URL}/original/${id}`}
          className="pointer-events-none select-none w-full h-full object-cover"
          draggable={false}
          alt=""
        />
        <Slider
          className="absolute left-16 w-9/10 z-100"
          style={{ bottom: '-16px' }}
          defaultValue={[100]}
          max={100}
          min={0}
          step={1}
          onValueChange={(value) => {
            const scale = value[0] / 100
            if (imageRef.current) {
              imageRef.current.style.opacity = `${scale}`
            }
          }}
        />
        <Slider
          className="absolute left-16 w-9/10 z-100"
          style={{ bottom: '-32px' }}
          defaultValue={[100]}
          max={100}
          min={0}
          step={1}
          onValueChange={(value) => {
            const scale = value[0] / 100
            if (imageRef.current) {
              imageRef.current.style.transform = `scale(${scale})`
            }
          }}
        />
        <Button
          className="absolute top-2 right-2 z-100"
          onClick={close}
          variant="destructive"
        >
          Close
        </Button>
      </div>
    </Draggable>
  )
}

function Map() {
  const [instance, setInstance] =
    useState<google.maps.StreetViewPanorama | null>()
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [position, setPosition] = useState({ lat: 57.6947298, lng: 11.9258134 })
  const setSearchImage = useSetAtom<any>(searchImageAtom)
  const searchResults = useAtomValue(searchImagesAtom)

  const containerStyle = {
    height: '100vh',
    width: '100%',
  }

  useEffect(() => {
    console.log('Map component mounted', instance)
  }, [instance])

  return (
    <GoogleMap mapContainerStyle={containerStyle} center={position} zoom={10}>
      <StreetViewPanorama
        id="street-view"
        mapContainerStyle={containerStyle}
        position={position}
        onPositionChanged={() => {
          if (instance) {
            const pos = instance.getPosition()
            const lat = pos?.lat() || 0
            const lng = pos?.lng() || 0
            console.log('Street View position changed:', { lat, lng })
            if (position.lat !== lat || position.lng !== lng) {
              // Update the position state if it has changed
              setPosition({ lat, lng })
            }
          }
        }}
        visible={true}
        onLoad={(pano) => {
          setInstance(pano)
          console.log('Street View Panorama loaded:', pano)
        }}
        ononPovChanged={() => {
          console.log('Street View POV changed')
        }}
        onPanoChanged={() => {
          if (instance) {
            console.log('Street View Panorama changed:', instance.getLinks())
          }
        }}
      />
      {selectedImage && (
        <SelectedDraggableImage
          id={selectedImage}
          close={() => setSelectedImage(null)}
        />
      )}
      {!selectedImage && searchResults.length > 0 && (
        <div className="absolute top-20 left-4 bg-white p-2 rounded shadow z-50 w-75 h-full overflow-y-scroll no-scrollbar">
          <h2 className="text-lg font-bold">Search Results</h2>
          <div className="grid grid-cols-1 gap-4">
            {searchResults.map(({ id }: { id: number; distance: number }) => (
              <div
                onClick={() => setSelectedImage(id.toString())}
                className="cursor-pointer"
              >
                <img src={`${API_URL}/image/${id}`} />
              </div>
            ))}
          </div>
        </div>
      )}
      <Button
        className="absolute bottom-6 right-16 text-white p-2 rounded z-50"
        onClick={async () => {
          if (instance) {
            const pov = instance.getPov()
            const pos = instance.getPosition()
            const url = `https://maps.googleapis.com/maps/api/streetview?size=800x600&location=${pos?.lat()},${pos?.lng()}&heading=${
              pov.heading
            }&pitch=${pov.pitch}&key=${
              import.meta.env.VITE_GOOGLE_API_KEY || ''
            }`

            const response = await fetch(url)
            const blob = await response.blob()
            setSearchImage(blob)
          }
        }}
      >
        Search
      </Button>
    </GoogleMap>
  )
}

export default Map
