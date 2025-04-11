import { embeddingsAtom } from '@/state'
import { useAtomValue } from 'jotai'
import React from 'react'
import ReactFlow, {
  Background,
  Controls,
  Node,
  useNodesState,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { CustomImageNode } from './CustomImageNode' // 👈 import your node

type Props = {
  width?: number
  height?: number
  nodeSize?: number
}

function normalizePoints(points: [number, number][]): [number, number][] {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)

  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1

  return points.map(([x, y]) => [(x - minX) / rangeX, (y - minY) / rangeY])
}

const nodeTypes = {
  image: CustomImageNode,
}

export const EmbeddingsCanvas: React.FC<Props> = ({
  width = 800,
  height = 600,
  nodeSize = 64,
}) => {
  const rawEmbeddings = useAtomValue(embeddingsAtom)

  const normalized = normalizePoints(rawEmbeddings.map((e: any) => e.point))

  const initialNodes: Node[] = normalized.map(([x, y], i) => {
    const id = rawEmbeddings[i].id
    return {
      id: `node-${id}`,
      type: 'image', // 👈 use our custom type
      position: { x: x * width, y: y * height },
      data: {
        id,
        size: nodeSize,
      },
    }
  })

  const [nodes, _, onNodesChange] = useNodesState(initialNodes)

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edges={[]}
        fitView
        minZoom={0.01}
        maxZoom={20}
        nodeOrigin={[0.5, 0.5]}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
