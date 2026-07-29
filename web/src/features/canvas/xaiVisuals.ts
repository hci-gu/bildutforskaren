import type { ConceptLensImage } from '@/shared/lib/api'

export const CLUSTER_COLORS = [
  0x38bdf8,
  0xfb923c,
  0x34d399,
  0xc084fc,
  0xf472b6,
  0xfacc15,
  0x60a5fa,
  0xa3e635,
]

const channels = (color: number) => ({
  r: (color >> 16) & 0xff,
  g: (color >> 8) & 0xff,
  b: color & 0xff,
})

const mixColor = (start: number, end: number, amount: number) => {
  const a = channels(start)
  const b = channels(end)
  const t = Math.max(0, Math.min(1, amount))
  return (
    (Math.round(a.r + (b.r - a.r) * t) << 16) |
    (Math.round(a.g + (b.g - a.g) * t) << 8) |
    Math.round(a.b + (b.b - a.b) * t)
  )
}

const sequentialColor = (percentile: number) => {
  const t = Math.max(0, Math.min(1, percentile))
  if (t < 0.5) return mixColor(0x440154, 0x21918c, t * 2)
  return mixColor(0x21918c, 0xfde725, (t - 0.5) * 2)
}

export const conceptLensVisual = (
  record: ConceptLensImage,
  conceptIds: string[],
  thresholdPercentile: number,
  maximumAbsoluteDelta: number
) => {
  const scores = conceptIds
    .map((conceptId) => record.scores[conceptId])
    .filter(Boolean)
  const evidence = Math.max(0, ...scores.map((score) => score.percentile))
  const threshold = thresholdPercentile / 100
  const alpha = evidence >= threshold ? 1 : 0.3

  if (conceptIds.length === 1) {
    return {
      tint: sequentialColor(scores[0]?.percentile ?? 0),
      alpha,
    }
  }

  const delta = record.comparison_delta ?? 0
  const normalizedDelta =
    maximumAbsoluteDelta > 1e-12
      ? Math.max(-1, Math.min(1, delta / maximumAbsoluteDelta))
      : 0
  const target = normalizedDelta >= 0 ? 0x38bdf8 : 0xfb923c
  return {
    tint: mixColor(0xb8bec9, target, Math.abs(normalizedDelta) * evidence),
    alpha,
  }
}

export const colorToCss = (color: number) =>
  `#${color.toString(16).padStart(6, '0')}`
