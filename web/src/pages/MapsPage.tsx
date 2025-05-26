import React, { useState, useCallback, useRef } from 'react';
import { useJsApiLoader, StreetViewPanorama } from '@react-google-maps/api';
import { API_URL } from '../state'; // Adjusted import path

const GOOGLE_API_KEY = '// TODO: Replace with your Google Maps API Key'; // Placeholder for API Key

const containerStyle = {
  width: '100%',
  height: 'calc(100vh - 200px)', // Adjusted height for more UI elements
};

// Default position: Eiffel Tower
const defaultPosition = { lat: 48.8584, lng: 2.2945 };
const imageSize = "600x400"; // Define image size for the API

interface SimilarImage {
  id: number;
  distance: number;
}

const MapsPage: React.FC = () => {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_API_KEY,
  });

  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null);

  // State for API results
  const [similarImages, setSimilarImages] = useState<SimilarImage[]>([]);
  const [isLoadingApi, setIsLoadingApi] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);


  const onLoad = useCallback((panorama: google.maps.StreetViewPanorama) => {
    panoramaRef.current = panorama;
  }, []);

  const onUnmount = useCallback(() => {
    panoramaRef.current = null;
  }, []);

  const handleCaptureView = () => {
    if (panoramaRef.current) {
      const location = panoramaRef.current.getPosition();
      const pov = panoramaRef.current.getPov();

      if (location && pov) {
        const lat = location.lat();
        const lng = location.lng();
        const heading = pov.heading;
        const pitch = pov.pitch;
        const fov = 90; 

        const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=${imageSize}&location=${lat},${lng}&heading=${heading}&pitch=${pitch}&fov=${fov}&key=${GOOGLE_API_KEY}`;
        setCapturedImageUrl(imageUrl);
        // Reset previous search results when a new view is captured
        setSimilarImages([]);
        setApiError(null);
      } else {
        alert("Could not get current Street View location or POV.");
      }
    } else {
      alert("Street View panorama not loaded yet.");
    }
  };

  const handleSearchSimilar = async () => {
    if (!capturedImageUrl) {
      setApiError("No image captured to search for.");
      return;
    }

    setIsLoadingApi(true);
    setApiError(null);
    setSimilarImages([]);

    try {
      const response = await fetch(`${API_URL}/search_by_image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_url: capturedImageUrl,
          k: 10, // Get top 10 results
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to parse error response" }));
        throw new Error(errorData.error || `API request failed with status ${response.status}`);
      }

      const results: SimilarImage[] = await response.json();
      setSimilarImages(results);

    } catch (error) {
      if (error instanceof Error) {
        setApiError(error.message);
      } else {
        setApiError("An unknown error occurred while searching for similar images.");
      }
      setSimilarImages([]);
    } finally {
      setIsLoadingApi(false);
    }
  };


  if (loadError) {
    return <div>Error loading maps. Please ensure the API key is correct and the Google Maps JavaScript API is enabled.</div>;
  }

  if (!isLoaded) {
    return <div>Loading Street View...</div>;
  }

  return (
    <div style={{ padding: '20px' }}>
      <h1>Street View Maps</h1>
      <p>
        Navigate the Street View below, capture the view, then find similar images.
      </p>
      <button onClick={handleCaptureView} style={{ margin: '10px 0', padding: '10px', marginRight: '10px' }}>
        Capture View
      </button>
      
      {capturedImageUrl && (
        <button onClick={handleSearchSimilar} style={{ margin: '10px 0', padding: '10px' }} disabled={isLoadingApi}>
          {isLoadingApi ? 'Searching...' : 'Find Similar Images'}
        </button>
      )}

      {capturedImageUrl && (
        <div style={{ marginTop: '20px' }}>
          <h3>Captured Image Preview:</h3>
          <img src={capturedImageUrl} alt="Captured Street View" style={{ maxWidth: '100%', width: imageSize.split('x')[0] + 'px', border: '1px solid #ccc', marginBottom: '20px' }} />
        </div>
      )}

      {isLoadingApi && <p>Loading similar images...</p>}
      {apiError && <p style={{ color: 'red' }}>Error: {apiError}</p>}

      {similarImages.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <h3>Similar Images:</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {similarImages.map((image) => (
              <div key={image.id} style={{ border: '1px solid #eee', padding: '10px', width: '150px' }}>
                <img 
                  src={`${API_URL}/image/${image.id}`} 
                  alt={`Similar image ${image.id}`} 
                  style={{ width: '100%', height: '100px', objectFit: 'cover' }} 
                />
                <p style={{ fontSize: '0.9em', marginTop: '5px' }}>ID: {image.id}</p>
                <p style={{ fontSize: '0.8em' }}>Distance: {image.distance.toFixed(4)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {!isLoadingApi && !apiError && similarImages.length === 0 && capturedImageUrl && (
        <p>No similar images found, or search not yet performed for the current captured view.</p>
      )}


      <div style={containerStyle}>
        <StreetViewPanorama
          position={defaultPosition}
          visible={true}
          onLoad={onLoad}
          onUnmount={onUnmount}
          options={{
            addressControl: true,
            enableCloseButton: false,
            fullscreenControl: true,
            zoomControl: true,
            linksControl: true,
            panControl: true,
          }}
        />
      </div>
    </div>
  );
};

export default MapsPage;
