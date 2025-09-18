import { LoadScript } from '@react-google-maps/api'
import Map from './Map'
// import './styles.css'

const lib = ['places']

function StreetViewPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen mt-4">
      <LoadScript
        googleMapsApiKey={import.meta.env.VITE_GOOGLE_API_KEY || ''}
        libraries={lib as any}
      >
        <Map />
      </LoadScript>
    </div>
  )
}

export default StreetViewPage
