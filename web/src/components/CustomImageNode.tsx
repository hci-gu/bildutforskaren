import { API_URL } from '@/state'
import React from 'react'
import {
  NodeProps,
  Handle,
  Position,
  useReactFlow,
  useViewport,
} from 'reactflow'

type CustomData = {
  id: number
  size: number
}

export const CustomImageNode: React.FC<NodeProps<CustomData>> = ({ data }) => {
  const { zoom } = useViewport()

  const remappedZoom = zoom / 20

  return (
    <div
      style={{
        width: data.size * remappedZoom,
        height: data.size * remappedZoom,
        overflow: 'hidden',
        borderRadius: 8,
        boxShadow: '0 0 4px rgba(51, 36, 36, 0.3)',
      }}
    >
      <img
        src={`${API_URL}/image/${data.id}`}
        alt={`Image ${data.id}`}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  )
}
