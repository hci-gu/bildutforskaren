import { useEffect, useMemo, useState } from 'react'
import {
  datasetApiUrl,
  type AnchorSemanticConcept,
  type AnchorSemanticObservedPoint,
  type AnchorSemantics,
} from '@/shared/lib/api'

type ObservedMode =
  | 'interpolation'
  | 'axis'
  | 'graph_supported'
  | 'graph_shortest'

type Props = {
  datasetId: string
  semantics: AnchorSemantics
  onSelectImage: (imageId: number) => void
}

const WIDTH = 960
const HEIGHT = 270
const MARGIN = { left: 56, right: 24, top: 18, bottom: 38 } as const

const INCREASING_COLORS = ['#22d3ee', '#34d399', '#60a5fa']
const DECREASING_COLORS = ['#f59e0b', '#f472b6', '#a78bfa']

const conceptColor = (concept: AnchorSemanticConcept) => {
  const palette =
    concept.delta_direction === 'decreasing'
      ? DECREASING_COLORS
      : INCREASING_COLORS
  return palette[Math.max(0, (concept.delta_rank ?? 1) - 1) % palette.length]
}

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(3)}`

const EndpointProfile = ({
  title,
  concepts,
  endpoint,
}: {
  title: string
  concepts: AnchorSemanticConcept[]
  endpoint: 'a' | 'b'
}) => (
  <section className="rounded-lg border border-white/10 bg-white/5 p-3">
    <h3 className="mb-2 text-xs font-semibold text-white/80">{title}</h3>
    <div className="space-y-1.5">
      {concepts.map((concept) => (
        <div
          key={`${endpoint}:${concept.concept_id}`}
          className="flex items-center justify-between gap-2 text-[11px]"
          title={concept.scope_note || undefined}
        >
          <span className="min-w-0 truncate">{concept.label}</span>
          <span className="flex shrink-0 items-center gap-2">
            {concept.delta_direction && (
              <span
                className={
                  concept.delta_direction === 'increasing'
                    ? 'text-cyan-300'
                    : 'text-amber-300'
                }
              >
                {concept.delta_direction === 'increasing' ? '↗' : '↘'}{' '}
                {signed(concept.delta)}
              </span>
            )}
            <span className="text-white/50">
              {(endpoint === 'a' ? concept.score_a : concept.score_b).toFixed(3)}
            </span>
          </span>
        </div>
      ))}
    </div>
  </section>
)

const DeltaProfile = ({
  title,
  concepts,
}: {
  title: string
  concepts: AnchorSemanticConcept[]
}) => (
  <section>
    <h3 className="mb-2 text-xs font-semibold text-white/80">{title}</h3>
    <div className="space-y-1.5">
      {concepts.length === 0 ? (
        <div className="text-[10px] text-white/45">
          Inga relevanta begrepp passerade tröskeln.
        </div>
      ) : (
        concepts.map((concept) => (
          <div
            key={`${title}:${concept.concept_id}`}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5"
            title={concept.scope_note || undefined}
          >
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate">{concept.label}</span>
              <span style={{ color: conceptColor(concept) }}>
                {signed(concept.delta)}
              </span>
            </div>
            <div className="text-[9px] text-white/45">
              A {concept.score_a.toFixed(3)} · B {concept.score_b.toFixed(3)}
            </div>
          </div>
        ))
      )}
    </div>
  </section>
)

export const AnchorSemanticAnalysis = ({
  datasetId,
  semantics,
  onSelectImage,
}: Props) => {
  const [mode, setMode] = useState<ObservedMode>('interpolation')
  const [visibleConceptIds, setVisibleConceptIds] = useState<Set<string>>(
    new Set()
  )
  const [hovered, setHovered] = useState<{
    concept: AnchorSemanticConcept
    point: AnchorSemanticObservedPoint
  } | null>(null)

  const trajectoryConcepts = useMemo(
    () => [...semantics.increasing, ...semantics.decreasing],
    [semantics.decreasing, semantics.increasing]
  )
  const trajectoryById = useMemo(
    () =>
      new Map(
        semantics.trajectories.map((trajectory) => [
          trajectory.concept_id,
          trajectory,
        ])
      ),
    [semantics.trajectories]
  )

  useEffect(() => {
    setVisibleConceptIds(
      new Set(trajectoryConcepts.map((concept) => concept.concept_id))
    )
    setHovered(null)
  }, [trajectoryConcepts])

  const chart = useMemo(() => {
    const active = trajectoryConcepts.filter((concept) =>
      visibleConceptIds.has(concept.concept_id)
    )
    const scores = active.flatMap((concept) => {
      const trajectory = trajectoryById.get(concept.concept_id)
      if (!trajectory) return []
      return [
        ...trajectory.ideal.map((point) => point.score),
        ...trajectory[mode]
          .map((point) => point.score)
          .filter((score): score is number => score !== null),
      ]
    })
    const rawMin = scores.length ? Math.min(...scores) : -0.1
    const rawMax = scores.length ? Math.max(...scores) : 0.1
    const padding = Math.max((rawMax - rawMin) * 0.12, 0.02)
    const min = rawMin - padding
    const max = rawMax + padding
    const plotWidth = WIDTH - MARGIN.left - MARGIN.right
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
    const x = (progress: number) => MARGIN.left + progress * plotWidth
    const y = (score: number) =>
      MARGIN.top + (1 - (score - min) / Math.max(max - min, 1e-9)) * plotHeight
    return { active, min, max, x, y }
  }, [mode, trajectoryById, trajectoryConcepts, visibleConceptIds])

  if (!semantics.available) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-300">
        {semantics.error ?? 'SAO-begreppen är inte tillgängliga.'}
      </div>
    )
  }

  if (
    semantics.endpoint_a.length === 0 &&
    semantics.endpoint_b.length === 0
  ) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/55">
        Inga SAO-begrepp kunde analyseras.
      </div>
    )
  }

  const modeLabels: Array<[ObservedMode, string]> = [
    ['interpolation', 'Interpolation'],
    ['axis', 'Axis'],
    ['graph_supported', 'Understödd graf'],
    ['graph_shortest', 'Kortaste graf'],
  ]
  const hasObservedPoints = chart.active.some(
    (concept) =>
      (trajectoryById.get(concept.concept_id)?.[mode] ?? []).some(
        (point) => point.score !== null
      )
  )

  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-4 overflow-hidden">
      <aside className="min-h-0 space-y-3 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-2">
          <EndpointProfile
            title="A beskriver"
            concepts={semantics.endpoint_a}
            endpoint="a"
          />
          <EndpointProfile
            title="B beskriver"
            concepts={semantics.endpoint_b}
            endpoint="b"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <DeltaProfile
            title="Minskar mot B"
            concepts={semantics.decreasing}
          />
          <DeltaProfile
            title="Ökar mot B"
            concepts={semantics.increasing}
          />
        </div>
        <div className="rounded-md border border-white/10 p-2 text-[9px] leading-relaxed text-white/45">
          Ändpunktspoängen beskriver ankargrupperna. Delta beskriver den
          semantiska förändringen från A till B. Detta är semantisk
          överensstämmelse i CLIP-rummet, inte en kausal pixelförklaring.
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {modeLabels.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`rounded-full px-2.5 py-1 text-[10px] ${
                  mode === value
                    ? 'bg-white text-black'
                    : 'border border-white/15 hover:bg-white/10'
                }`}
                onClick={() => {
                  setMode(value)
                  setHovered(null)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            {trajectoryConcepts.map((concept) => {
              const visible = visibleConceptIds.has(concept.concept_id)
              return (
                <button
                  key={concept.concept_id}
                  type="button"
                  className={`rounded-full border px-2 py-1 text-[9px] ${
                    visible ? 'text-white' : 'text-white/35'
                  }`}
                  style={{
                    borderColor: conceptColor(concept),
                    backgroundColor: visible
                      ? `${conceptColor(concept)}22`
                      : 'transparent',
                  }}
                  onClick={() =>
                    setVisibleConceptIds((previous) => {
                      const next = new Set(previous)
                      if (next.has(concept.concept_id)) {
                        next.delete(concept.concept_id)
                      } else {
                        next.add(concept.concept_id)
                      }
                      return next
                    })
                  }
                  aria-pressed={visible}
                >
                  {concept.label}
                </button>
              )
            })}
          </div>
        </div>

        {trajectoryConcepts.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-white/55">
            Inga relevanta ökande eller minskande begrepp hittades.
          </div>
        ) : chart.active.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-white/55">
            Välj minst ett begrepp i teckenförklaringen.
          </div>
        ) : !hasObservedPoints ? (
          <div className="flex flex-1 items-center justify-center text-sm text-white/55">
            Ingen observerad sökväg är tillgänglig för detta läge.
          </div>
        ) : (
          <div className="relative min-h-0 flex-1">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-full w-full"
              role="img"
              aria-label="Semantiska konceptbanor från ankare A till B"
            >
              {[0, 0.25, 0.5, 0.75, 1].map((progress) => (
                <g key={progress}>
                  <line
                    x1={chart.x(progress)}
                    x2={chart.x(progress)}
                    y1={MARGIN.top}
                    y2={HEIGHT - MARGIN.bottom}
                    stroke="rgba(255,255,255,0.08)"
                  />
                  <text
                    x={chart.x(progress)}
                    y={HEIGHT - 12}
                    fill="rgba(255,255,255,0.55)"
                    textAnchor="middle"
                    fontSize={10}
                  >
                    {progress.toFixed(2)}
                  </text>
                </g>
              ))}
              {[chart.min, (chart.min + chart.max) / 2, chart.max].map(
                (score) => (
                  <g key={score}>
                    <line
                      x1={MARGIN.left}
                      x2={WIDTH - MARGIN.right}
                      y1={chart.y(score)}
                      y2={chart.y(score)}
                      stroke="rgba(255,255,255,0.1)"
                    />
                    <text
                      x={MARGIN.left - 8}
                      y={chart.y(score) + 3}
                      fill="rgba(255,255,255,0.5)"
                      textAnchor="end"
                      fontSize={9}
                    >
                      {score.toFixed(2)}
                    </text>
                  </g>
                )
              )}
              {chart.active.map((concept) => {
                const trajectory = trajectoryById.get(concept.concept_id)
                if (!trajectory) return null
                const color = conceptColor(concept)
                const idealPath = trajectory.ideal
                  .map(
                    (point, index) =>
                      `${index === 0 ? 'M' : 'L'} ${chart.x(point.progress)} ${chart.y(point.score)}`
                  )
                  .join(' ')
                const observed = trajectory[mode]
                const observedSegments: AnchorSemanticObservedPoint[][] = []
                let segment: AnchorSemanticObservedPoint[] = []
                observed.forEach((point) => {
                  if (point.score === null) {
                    if (segment.length) observedSegments.push(segment)
                    segment = []
                  } else {
                    segment.push(point)
                  }
                })
                if (segment.length) observedSegments.push(segment)
                return (
                  <g key={concept.concept_id}>
                    <path
                      d={idealPath}
                      fill="none"
                      stroke={color}
                      strokeWidth={2.5}
                      opacity={0.9}
                    />
                    {observedSegments.map((points, index) => (
                      <path
                        key={index}
                        d={points
                          .map(
                            (point, pointIndex) =>
                              `${pointIndex === 0 ? 'M' : 'L'} ${chart.x(point.progress)} ${chart.y(point.score as number)}`
                          )
                          .join(' ')}
                        fill="none"
                        stroke={color}
                        strokeWidth={1.8}
                        strokeDasharray="6 5"
                        opacity={0.65}
                      />
                    ))}
                    {observed
                      .filter(
                        (
                          point
                        ): point is AnchorSemanticObservedPoint & {
                          image_id: number
                          score: number
                        } =>
                          point.image_id !== null && point.score !== null
                      )
                      .map((point, index) => (
                        <circle
                          key={`${point.image_id}:${index}`}
                          cx={chart.x(point.progress)}
                          cy={chart.y(point.score)}
                          r={4}
                          fill={color}
                          stroke="rgba(0,0,0,0.7)"
                          strokeWidth={1}
                          className="cursor-pointer"
                          onMouseEnter={() => setHovered({ concept, point })}
                          onMouseLeave={() => setHovered(null)}
                          onClick={() => onSelectImage(point.image_id)}
                        />
                      ))}
                  </g>
                )
              })}
              <text
                x={(MARGIN.left + WIDTH - MARGIN.right) / 2}
                y={HEIGHT - 1}
                fill="rgba(255,255,255,0.65)"
                textAnchor="middle"
                fontSize={10}
              >
                A → B
              </text>
              <text
                x={12}
                y={(MARGIN.top + HEIGHT - MARGIN.bottom) / 2}
                fill="rgba(255,255,255,0.65)"
                textAnchor="middle"
                fontSize={10}
                transform={`rotate(-90 12 ${(MARGIN.top + HEIGHT - MARGIN.bottom) / 2})`}
              >
                CLIP–SAO-likhet
              </text>
            </svg>
            {hovered && hovered.point.image_id !== null && (
              <div className="glass-panel-strong pointer-events-none absolute top-2 right-2 flex items-center gap-2 rounded-lg p-2 text-[10px] text-white">
                <img
                  src={datasetApiUrl(
                    datasetId,
                    `/image/${hovered.point.image_id}`
                  )}
                  alt=""
                  className="h-10 w-10 rounded object-cover"
                />
                <div>
                  <div className="font-medium">{hovered.concept.label}</div>
                  <div>Bild #{hovered.point.image_id}</div>
                  <div className="text-white/55">
                    observerad {hovered.point.score?.toFixed(3)} · ideal{' '}
                    {hovered.point.ideal_score.toFixed(3)} · gap{' '}
                    {hovered.point.gap?.toFixed(3)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
