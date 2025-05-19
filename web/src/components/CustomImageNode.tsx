import { API_URL } from '@/state'
import React from 'react'
import { NodeProps } from 'reactflow'

type CustomData = {
  id: number
  size: number
}

export const CustomImageNode: React.FC<NodeProps<CustomData>> = ({ data }) => {
  return (
    <div
      style={{
        width: data.size * 0.25,
        height: data.size * 0.25,
        overflow: 'hidden',
        borderRadius: 4,
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
