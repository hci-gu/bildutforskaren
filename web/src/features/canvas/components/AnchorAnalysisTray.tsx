import React, { useEffect, useMemo, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  ChevronDown,
  ChevronUp,
  RefreshCw,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import {
  activeDatasetIdAtom,
  anchorAnalysisCompareAtom,
  anchorAnalysisErrorAtom,
  anchorAnalysisParametersAtom,
  anchorAnalysisResultAtom,
  anchorAnalysisStaleAtom,
  anchorAnalysisStatusAtom,
  anchorAnalysisTabAtom,
  anchorAnalysisTrayCollapsedAtom,
  anchorAnalysisTrayHeightAtom,
  anchorAnalysisTrayOpenAtom,
  anchorGraphModeAtom,
  anchorGroupsAtom,
  selectedEmbeddingAtom,
  selectedEmbeddingIdsAtom,
  type AnchorAnalysisTab,
} from '@/store'
import {
  datasetApiUrl,
  type AnchorAnalysisPoint,
} from '@/shared/lib/api'
import type { AtlasMeta, AtlasMetaEntry } from '../hooks/useAtlasLoader'
import { useAnchorAnalysis } from '../hooks/useAnchorAnalysis'
import { state } from '../canvasState'
import {
  CANVAS_HEIGHT,
  CANVAS_OFFSET_X,
  CANVAS_OFFSET_Y,
  CANVAS_WIDTH,
} from '../constants'

type Props = {
  candidateIds: number[]
  rawEmbeddings: Array<{
    id: string | number
    type: string
    point?: [number, number]
    meta?: Record<string, unknown>
  }>
  atlasMeta: AtlasMeta
}

const SCATTER_WIDTH = 920
const SCATTER_HEIGHT = 210
const SCATTER_MARGIN = { left: 58, right: 18, top: 14, bottom: 40 } as const

const tabs: Array<[AnchorAnalysisTab, string]> = [
  ['axis', 'Axis'],
  ['affinity', 'Affinity'],
  ['interpolation', 'Interpolation'],
  ['graph', 'Graph'],
]

const AtlasThumbnail = ({
  datasetId,
  imageId,
  atlasMeta,
  className = '',
  size = 40,
}: {
  datasetId: string
  imageId: number
  atlasMeta: AtlasMeta
  className?: string
  size?: number
}) => {
  const entry = atlasMeta[String(imageId)]
  if (!entry?.atlas) {
    return <div className={`bg-white/10 ${className}`} aria-hidden="true" />
  }
  const scale = size / entry.width
  return (
    <div
      className={`bg-no-repeat ${className}`}
      style={{
        backgroundImage: `url(${datasetApiUrl(datasetId, `/atlas/sheet/${entry.sheet}.png`)})`,
        backgroundSize: `${entry.atlas.w * scale}px ${entry.atlas.h * scale}px`,
        backgroundPosition: `${-entry.x * scale}px ${-entry.y * scale}px`,
      }}
      aria-hidden="true"
    />
  )
}

const atlasImage = (
  entry: AtlasMetaEntry,
  datasetId: string,
  imageId: number,
  x: number,
  y: number,
  size: number
) => {
  if (!entry.atlas) return null
  const scale = size / entry.width
  const clipId = `anchor_scatter_clip_${imageId}`
  return (
    <g key={`thumb_${imageId}`}>
      <defs>
        <clipPath id={clipId}>
          <rect x={x - size / 2} y={y - size / 2} width={size} height={size} rx={4} />
        </clipPath>
      </defs>
      <image
        href={datasetApiUrl(datasetId, `/atlas/sheet/${entry.sheet}.png`)}
        x={x - size / 2 - entry.x * scale}
        y={y - size / 2 - entry.y * scale}
        width={entry.atlas.w * scale}
        height={entry.atlas.h * scale}
        clipPath={`url(#${clipId})`}
        preserveAspectRatio="none"
      />
      <rect
        x={x - size / 2}
        y={y - size / 2}
        width={size}
        height={size}
        rx={4}
        fill="none"
        stroke="rgba(255,255,255,0.8)"
        strokeWidth={1}
      />
    </g>
  )
}

const ScatterPlot = ({
  datasetId,
  atlasMeta,
  points,
  pathIds,
  anchorA,
  anchorB,
  xKey,
  yKey,
  xLabel,
  yLabel,
  onSelect,
}: {
  datasetId: string
  atlasMeta: AtlasMeta
  points: AnchorAnalysisPoint[]
  pathIds: number[]
  anchorA: string[]
  anchorB: string[]
  xKey: 't' | 'contrast'
  yKey: 'segment_residual' | 'commonality'
  xLabel: string
  yLabel: string
  onSelect: (imageId: number) => void
}) => {
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const width = SCATTER_WIDTH
  const height = SCATTER_HEIGHT
  const margin = SCATTER_MARGIN
  const anchorASet = useMemo(() => new Set(anchorA.map(Number)), [anchorA])
  const anchorBSet = useMemo(() => new Set(anchorB.map(Number)), [anchorB])
  const pathSet = useMemo(() => new Set(pathIds), [pathIds])

  const geometry = useMemo(() => {
    const xs = points.map((point) => point[xKey])
    const ys = points.map((point) => point[yKey])
    let minX = Math.min(...xs, xKey === 't' ? 0 : Infinity)
    let maxX = Math.max(...xs, xKey === 't' ? 1 : -Infinity)
    let minY = Math.min(...ys)
    let maxY = Math.max(...ys)
    const padX = Math.max((maxX - minX) * 0.05, 0.01)
    const padY = Math.max((maxY - minY) * 0.08, 0.01)
    minX -= padX
    maxX += padX
    minY -= padY
    maxY += padY
    const plotWidth = width - margin.left - margin.right
    const plotHeight = height - margin.top - margin.bottom
    const position = (point: AnchorAnalysisPoint) => ({
      x: margin.left + ((point[xKey] - minX) / (maxX - minX)) * plotWidth,
      y:
        margin.top +
        (1 - (point[yKey] - minY) / (maxY - minY)) * plotHeight,
    })

    const priority = [
      ...points.filter((point) => anchorASet.has(point.image_id)),
      ...points.filter((point) => anchorBSet.has(point.image_id)),
      ...points.filter((point) => pathSet.has(point.image_id)),
      ...points,
    ]
    const occupied = new Set<string>()
    const thumbnailIds: number[] = []
    const seen = new Set<number>()
    for (const point of priority) {
      if (seen.has(point.image_id)) continue
      seen.add(point.image_id)
      const pointPosition = position(point)
      const cell = `${Math.floor(pointPosition.x / 42)}:${Math.floor(pointPosition.y / 34)}`
      const forced =
        anchorASet.has(point.image_id) ||
        anchorBSet.has(point.image_id) ||
        pathSet.has(point.image_id)
      if (forced || (!occupied.has(cell) && thumbnailIds.length < 30)) {
        thumbnailIds.push(point.image_id)
        occupied.add(cell)
      }
    }
    return { minX, maxX, minY, maxY, position, thumbnailIds }
  }, [
    anchorASet,
    anchorBSet,
    height,
    margin.bottom,
    margin.left,
    margin.right,
    margin.top,
    pathSet,
    points,
    width,
    xKey,
    yKey,
  ])

  const hovered = points.find((point) => point.image_id === hoveredId)
  return (
    <div className="relative h-full min-h-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        role="img"
        aria-label={`${xLabel} by ${yLabel} for ${points.length} images`}
      >
        <line
          x1={margin.left}
          x2={width - margin.right}
          y1={height - margin.bottom}
          y2={height - margin.bottom}
          stroke="rgba(255,255,255,0.3)"
        />
        <line
          x1={margin.left}
          x2={margin.left}
          y1={margin.top}
          y2={height - margin.bottom}
          stroke="rgba(255,255,255,0.3)"
        />
        {xKey === 't' &&
          [0, 1].map((value) => {
            const x =
              margin.left +
              ((value - geometry.minX) / (geometry.maxX - geometry.minX)) *
                (width - margin.left - margin.right)
            return (
              <line
                key={value}
                x1={x}
                x2={x}
                y1={margin.top}
                y2={height - margin.bottom}
                stroke="rgba(255,255,255,0.18)"
                strokeDasharray="4 4"
              />
            )
          })}
        {points.map((point) => {
          const position = geometry.position(point)
          const isA = anchorASet.has(point.image_id)
          const isB = anchorBSet.has(point.image_id)
          const isPath = pathSet.has(point.image_id)
          return (
            <circle
              key={point.image_id}
              cx={position.x}
              cy={position.y}
              r={isA || isB ? 4 : isPath ? 3.5 : 2}
              fill={
                isA
                  ? '#f59e0b'
                  : isB
                    ? '#22d3ee'
                    : isPath
                      ? '#a78bfa'
                      : 'rgba(255,255,255,0.4)'
              }
              onMouseEnter={() => setHoveredId(point.image_id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelect(point.image_id)}
              className="cursor-pointer"
            />
          )
        })}
        {geometry.thumbnailIds.map((imageId) => {
          const point = points.find((item) => item.image_id === imageId)
          const entry = atlasMeta[String(imageId)]
          if (!point || !entry) return null
          const position = geometry.position(point)
          return (
            <g
              key={`interactive_thumb_${imageId}`}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredId(imageId)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelect(imageId)}
            >
              {atlasImage(entry, datasetId, imageId, position.x, position.y, 24)}
            </g>
          )
        })}
        <text
          x={(margin.left + width - margin.right) / 2}
          y={height - 8}
          fill="rgba(255,255,255,0.75)"
          textAnchor="middle"
          fontSize={12}
        >
          {xLabel}
        </text>
        <text
          x={14}
          y={(margin.top + height - margin.bottom) / 2}
          fill="rgba(255,255,255,0.75)"
          textAnchor="middle"
          fontSize={12}
          transform={`rotate(-90 14 ${(margin.top + height - margin.bottom) / 2})`}
        >
          {yLabel}
        </text>
        <text
          x={margin.left}
          y={height - margin.bottom + 16}
          fill="rgba(255,255,255,0.55)"
          fontSize={10}
        >
          {geometry.minX.toFixed(2)}
        </text>
        <text
          x={width - margin.right}
          y={height - margin.bottom + 16}
          fill="rgba(255,255,255,0.55)"
          textAnchor="end"
          fontSize={10}
        >
          {geometry.maxX.toFixed(2)}
        </text>
      </svg>
      {hovered && (
        <div className="glass-panel-strong pointer-events-none absolute top-2 right-2 flex items-center gap-2 rounded-lg p-2 text-xs text-white">
          <AtlasThumbnail
            datasetId={datasetId}
            imageId={hovered.image_id}
            atlasMeta={atlasMeta}
            className="h-10 w-10 rounded"
          />
          <div>
            <div>Image {hovered.image_id}</div>
            <div className="text-white/60">
              {xLabel}: {hovered[xKey].toFixed(3)} · {yLabel}:{' '}
              {hovered[yKey].toFixed(3)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export const AnchorAnalysisTray: React.FC<Props> = ({
  candidateIds,
  rawEmbeddings,
  atlasMeta,
}) => {
  const [open, setOpen] = useAtom(anchorAnalysisTrayOpenAtom)
  const [collapsed, setCollapsed] = useAtom(anchorAnalysisTrayCollapsedAtom)
  const [height, setHeight] = useAtom(anchorAnalysisTrayHeightAtom)
  const [tab, setTab] = useAtom(anchorAnalysisTabAtom)
  const [graphMode, setGraphMode] = useAtom(anchorGraphModeAtom)
  const [compare, setCompare] = useAtom(anchorAnalysisCompareAtom)
  const [parameters, setParameters] = useAtom(anchorAnalysisParametersAtom)
  const groups = useAtomValue(anchorGroupsAtom)
  const activeDatasetId = useAtomValue(activeDatasetIdAtom)
  const result = useAtomValue(anchorAnalysisResultAtom)
  const status = useAtomValue(anchorAnalysisStatusAtom)
  const error = useAtomValue(anchorAnalysisErrorAtom)
  const stale = useAtomValue(anchorAnalysisStaleAtom)
  const setStale = useSetAtom(anchorAnalysisStaleAtom)
  const setSelectedIds = useSetAtom(selectedEmbeddingIdsAtom)
  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const analyze = useAnchorAnalysis(candidateIds)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) return
    const onMove = (event: PointerEvent) => {
      const next = window.innerHeight - event.clientY
      setHeight(Math.max(240, Math.min(window.innerHeight * 0.6, next)))
    }
    const onUp = () => setDragging(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, setHeight])

  const pointByImage = useMemo(
    () =>
      new Map(
        rawEmbeddings
          .filter((item) => item.type === 'image' && item.point)
          .map((item) => [Number(item.id), item])
      ),
    [rawEmbeddings]
  )

  const selectImage = (imageId: number) => {
    const item = pointByImage.get(imageId)
    setSelectedIds([String(imageId)])
    setSelectedEmbedding({ id: imageId, meta: item?.meta ?? {} })
    if (item?.point && state.viewport) {
      state.viewport.moveCenter({
        x: CANVAS_OFFSET_X + item.point[0] * CANVAS_WIDTH,
        y: CANVAS_OFFSET_Y + item.point[1] * CANVAS_HEIGHT,
      })
    }
  }

  const graphPath = result?.graph[graphMode]
  const pathIds =
    tab === 'interpolation'
      ? result?.interpolation.path_ids ?? []
      : tab === 'graph'
        ? graphPath?.path_ids ?? []
        : result?.axis.path_ids ?? []

  const updateParameter = (
    key: keyof typeof parameters,
    value: number
  ) => {
    if (!Number.isFinite(value)) return
    const ranges = {
      path_steps: [5, 31],
      retrieval_count: [1, 20],
      graph_k: [2, 50],
    } as const
    const [minimum, maximum] = ranges[key]
    const clamped = Math.max(minimum, Math.min(maximum, Math.round(value)))
    setParameters((previous) => ({ ...previous, [key]: clamped }))
    if (result) setStale(true)
  }

  if (!open) return null
  const datasetId = result?.dataset_id

  return (
    <section
      className="glass-panel-strong fixed right-0 bottom-0 left-0 z-[10020] flex flex-col border-t border-white/20 text-white shadow-2xl"
      style={{ height: collapsed ? 52 : height }}
      data-canvas-ui="true"
      aria-label="Anchor analysis"
    >
      {!collapsed && (
        <button
          type="button"
          aria-label="Resize analysis tray"
          className="absolute top-0 left-0 h-2 w-full cursor-row-resize bg-transparent"
          onPointerDown={() => setDragging(true)}
        />
      )}
      <header className="flex min-h-13 items-center gap-3 border-b border-white/15 px-4">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="flex items-center gap-1 rounded-full bg-amber-400/20 pr-2 text-amber-100">
            {activeDatasetId && groups.a.length > 0 && (
              <AtlasThumbnail
                datasetId={activeDatasetId}
                imageId={result?.anchors.a.medoid_id ?? Number(groups.a[0])}
                atlasMeta={atlasMeta}
                className="h-7 w-7 rounded-full"
                size={28}
              />
            )}
            A · {groups.a.length}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-cyan-400/20 pr-2 text-cyan-100">
            {activeDatasetId && groups.b.length > 0 && (
              <AtlasThumbnail
                datasetId={activeDatasetId}
                imageId={result?.anchors.b.medoid_id ?? Number(groups.b[0])}
                atlasMeta={atlasMeta}
                className="h-7 w-7 rounded-full"
                size={28}
              />
            )}
            B · {groups.b.length}
          </span>
          {result && (
            <span className="hidden text-white/55 sm:inline">
              centroid similarity {result.anchors.similarity.toFixed(3)}
            </span>
          )}
        </div>
        <nav className="flex flex-1 justify-center gap-1" aria-label="Analysis view">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs ${
                tab === value ? 'bg-white text-black' : 'hover:bg-white/10'
              }`}
              aria-pressed={tab === value}
              onClick={() => {
                setTab(value)
                setCollapsed(false)
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <label className="hidden items-center gap-2 text-xs md:flex">
          <input
            type="checkbox"
            checked={compare}
            onChange={(event) => setCompare(event.target.checked)}
          />
          Compare paths
        </label>
        <button
          type="button"
          className="rounded-full p-1.5 hover:bg-white/10"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Expand analysis' : 'Collapse analysis'}
        >
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <button
          type="button"
          className="rounded-full p-1.5 hover:bg-white/10"
          onClick={() => setOpen(false)}
          aria-label="Close analysis tray"
        >
          <X size={16} />
        </button>
      </header>

      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-3">
          <div className="flex items-center justify-between gap-3 py-2 text-xs">
            <div>
              {status === 'loading' && 'Calculating anchor paths…'}
              {status === 'error' && (
                <span className="text-red-300">{error ?? 'Analysis failed.'}</span>
              )}
              {stale && status !== 'loading' && (
                <span className="text-amber-200">
                  Results are out of date for the current selection or settings.
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-1 rounded-full border border-white/20 px-3 py-1.5 hover:bg-white/10">
                  <SlidersHorizontal size={14} /> Advanced
                </summary>
                <div className="glass-panel-strong absolute right-0 bottom-full z-30 mb-2 grid w-64 grid-cols-3 gap-2 rounded-xl p-3 shadow-xl">
                  <label className="space-y-1">
                    <span className="text-white/60">Steps</span>
                    <input
                      className="w-full rounded border border-white/20 bg-black/30 px-2 py-1"
                      type="number"
                      min={5}
                      max={31}
                      value={parameters.path_steps}
                      onChange={(event) =>
                        updateParameter('path_steps', Number(event.target.value))
                      }
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-white/60">Results</span>
                    <input
                      className="w-full rounded border border-white/20 bg-black/30 px-2 py-1"
                      type="number"
                      min={1}
                      max={20}
                      value={parameters.retrieval_count}
                      onChange={(event) =>
                        updateParameter(
                          'retrieval_count',
                          Number(event.target.value)
                        )
                      }
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-white/60">Graph k</span>
                    <input
                      className="w-full rounded border border-white/20 bg-black/30 px-2 py-1"
                      type="number"
                      min={2}
                      max={50}
                      value={parameters.graph_k}
                      onChange={(event) =>
                        updateParameter('graph_k', Number(event.target.value))
                      }
                    />
                  </label>
                </div>
              </details>
              {(stale || status === 'error') && (
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-black disabled:opacity-50"
                  onClick={() => void analyze()}
                  disabled={status === 'loading'}
                >
                  <RefreshCw size={14} /> Recalculate
                </button>
              )}
            </div>
          </div>

          {status === 'loading' && (
            <div className="flex flex-1 items-center justify-center text-sm text-white/65">
              <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border border-white/50 border-t-transparent" />
              Computing full-embedding metrics and graph paths
            </div>
          )}

          {result && datasetId && status !== 'loading' && (
            <div className="min-h-0 flex-1">
              {tab === 'axis' && (
                <ScatterPlot
                  datasetId={datasetId}
                  atlasMeta={atlasMeta}
                  points={result.points}
                  pathIds={pathIds}
                  anchorA={groups.a}
                  anchorB={groups.b}
                  xKey="t"
                  yKey="segment_residual"
                  xLabel="A–B position (t)"
                  yLabel="Segment residual"
                  onSelect={selectImage}
                />
              )}
              {tab === 'affinity' && (
                <ScatterPlot
                  datasetId={datasetId}
                  atlasMeta={atlasMeta}
                  points={result.points}
                  pathIds={pathIds}
                  anchorA={groups.a}
                  anchorB={groups.b}
                  xKey="contrast"
                  yKey="commonality"
                  xLabel="B affinity − A affinity"
                  yLabel="Common affinity"
                  onSelect={selectImage}
                />
              )}
              {tab === 'interpolation' && (
                <div className="flex h-full gap-3 overflow-x-auto pb-2">
                  {result.interpolation.steps.map((step) => (
                    <div
                      key={step.index}
                      className="min-w-28 border-l border-white/15 pl-3 text-xs"
                    >
                      <div className="mb-2 text-white/60">
                        t={step.t.toFixed(2)}
                      </div>
                      <div className="space-y-2">
                        {step.retrievals.map((retrieval, index) => (
                          <button
                            key={retrieval.image_id}
                            type="button"
                            className={`flex w-full items-center gap-2 rounded-lg p-1 text-left hover:bg-white/10 ${
                              index === 0 ? 'bg-violet-400/10' : ''
                            }`}
                            onClick={() => selectImage(retrieval.image_id)}
                          >
                            <AtlasThumbnail
                              datasetId={datasetId}
                              imageId={retrieval.image_id}
                              atlasMeta={atlasMeta}
                              className="h-10 w-10 shrink-0 rounded"
                            />
                            <span>
                              <span className="block">#{retrieval.image_id}</span>
                              <span className="text-white/55">
                                {retrieval.similarity.toFixed(3)}
                              </span>
                            </span>
                          </button>
                        ))}
                        {!step.retrievals.length && (
                          <span className="text-white/45">No candidate</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {tab === 'graph' && (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="mb-3 flex items-center gap-2 text-xs">
                    {(['shortest', 'supported'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`rounded-full px-3 py-1.5 capitalize ${
                          graphMode === mode
                            ? 'bg-emerald-300 text-black'
                            : 'border border-white/20 hover:bg-white/10'
                        }`}
                        onClick={() => setGraphMode(mode)}
                      >
                        {mode}
                      </button>
                    ))}
                    {graphPath?.connected && (
                      <span className="text-white/55">
                        {graphPath.path_ids.length} images · total{' '}
                        {graphPath.total_length?.toFixed(3)} rad · largest jump{' '}
                        {graphPath.maximum_jump?.toFixed(3)} rad
                      </span>
                    )}
                  </div>
                  {!graphPath?.connected ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-white/60">
                      No mutual-kNN path at k={result.graph.k}. Increase graph k
                      in Advanced settings and recalculate.
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto pb-2">
                      {graphPath.path_ids.map((imageId, index) => {
                        const incoming = graphPath.edges[index - 1]
                        return (
                          <React.Fragment key={`${imageId}_${index}`}>
                            {index > 0 && (
                              <div className="mt-8 min-w-16 text-center text-[10px] text-white/45">
                                →<br />
                                {incoming?.similarity.toFixed(3)}
                              </div>
                            )}
                            <button
                              type="button"
                              className="min-w-24 rounded-lg p-2 text-center text-xs hover:bg-white/10"
                              onClick={() => selectImage(imageId)}
                            >
                              <AtlasThumbnail
                                datasetId={datasetId}
                              imageId={imageId}
                              atlasMeta={atlasMeta}
                              className="mx-auto mb-1 h-16 w-16 rounded-lg"
                              size={64}
                            />
                              <span>#{imageId}</span>
                            </button>
                          </React.Fragment>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
