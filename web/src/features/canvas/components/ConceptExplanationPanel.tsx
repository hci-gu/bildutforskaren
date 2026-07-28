import { useAtom, useAtomValue } from 'jotai'
import {
  activeDatasetIdAtom,
  conceptExplanationComparisonIdAtom,
  conceptExplanationErrorAtom,
  conceptExplanationResultAtom,
  conceptExplanationStatusAtom,
  neighborFidelityResultAtom,
  neighborFidelitySettingsAtom,
} from '@/store'
import {
  datasetApiUrl,
  type ConceptExplanationRecord,
  type NeighborFidelityRecord,
} from '@/shared/lib/api'

type Props = {
  selectedImageId: number
}

type NeighborGroup = {
  key: 'projection_only' | 'clip_only' | 'preserved'
  label: string
  colorClass: string
  records: NeighborFidelityRecord[]
}

const formatRank = (rank: number | null) => (rank === null ? '–' : `#${rank}`)

const ConceptRow = ({
  concept,
  compare = false,
}: {
  concept: ConceptExplanationRecord
  compare?: boolean
}) => {
  const selectedPercentile = Math.round(concept.selected_percentile)
  const comparisonPercentile =
    concept.comparison_percentile === null
      ? null
      : Math.round(concept.comparison_percentile)

  return (
    <div
      className="space-y-1 rounded-md border border-white/10 bg-white/5 px-2 py-2"
      title={concept.scope_note || undefined}
    >
      <div className="flex items-start justify-between gap-2 text-[11px]">
        <span className="font-medium text-white/90">{concept.label}</span>
        <span className="shrink-0 text-white/55">
          {concept.selected_similarity.toFixed(3)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-violet-400"
          style={{ width: `${selectedPercentile}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-white/50">
        <span>Vald bild</span>
        <span>{selectedPercentile}:e percentilen</span>
      </div>
      {compare && comparisonPercentile !== null && (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-cyan-400"
              style={{ width: `${comparisonPercentile}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-white/50">
            <span>Jämförelsebild</span>
            <span>{comparisonPercentile}:e percentilen</span>
          </div>
        </>
      )}
      {concept.scope_note && (
        <div className="line-clamp-2 text-[9px] text-white/45">
          {concept.scope_note}
        </div>
      )}
    </div>
  )
}

const ConceptSection = ({
  title,
  concepts,
  compare = false,
}: {
  title: string
  concepts: ConceptExplanationRecord[]
  compare?: boolean
}) => (
  <section className="space-y-2">
    <h3 className="text-xs font-semibold text-white/80">{title}</h3>
    {concepts.length === 0 ? (
      <div className="text-[10px] text-white/45">Ingen tydlig skillnad.</div>
    ) : (
      concepts.map((concept) => (
        <ConceptRow
          key={`${title}:${concept.concept_id}:${concept.label}`}
          concept={concept}
          compare={compare}
        />
      ))
    )}
  </section>
)

export const ConceptExplanationPanel = ({ selectedImageId }: Props) => {
  const datasetId = useAtomValue(activeDatasetIdAtom)
  const fidelitySettings = useAtomValue(neighborFidelitySettingsAtom)
  const fidelityResult = useAtomValue(neighborFidelityResultAtom)
  const result = useAtomValue(conceptExplanationResultAtom)
  const status = useAtomValue(conceptExplanationStatusAtom)
  const error = useAtomValue(conceptExplanationErrorAtom)
  const [comparisonImageId, setComparisonImageId] = useAtom(
    conceptExplanationComparisonIdAtom
  )

  const neighborGroups: NeighborGroup[] =
    fidelityResult?.selected_image_id === selectedImageId
      ? [
          {
            key: 'projection_only',
            label: 'Endast UMAP',
            colorClass: 'border-red-400/70',
            records: fidelityResult.neighbors.projection_only,
          },
          {
            key: 'clip_only',
            label: 'Saknas i UMAP',
            colorClass: 'border-sky-400/70',
            records: fidelityResult.neighbors.clip_only,
          },
          {
            key: 'preserved',
            label: 'Bevarade',
            colorClass: 'border-green-400/70',
            records: fidelityResult.neighbors.preserved,
          },
        ]
      : []

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      <div className="rounded-md border border-violet-300/20 bg-violet-300/5 p-2 text-[10px] leading-relaxed text-white/60">
        Begreppen visar semantisk överensstämmelse i CLIP-rummet. De är inte
        kausala förklaringar av enskilda pixlar eller modellegenskaper.
      </div>

      {status === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-white/60">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-white/40 border-t-transparent" />
          Beräknar begreppsförklaring…
        </div>
      )}
      {status === 'error' && (
        <div className="text-xs text-red-300" title={error ?? undefined}>
          Kunde inte beräkna begreppsförklaringen.
        </div>
      )}
      {result && (
        <ConceptSection
          title="Starkaste SAO-begrepp"
          concepts={result.selected_concepts}
        />
      )}

      {!fidelitySettings.enabled && (
        <div className="rounded-md border border-white/10 p-2 text-[10px] text-white/55">
          Aktivera grannfidelitet i projektionsinställningarna för att jämföra
          bilden med CLIP- och UMAP-grannar.
        </div>
      )}

      {fidelitySettings.enabled && neighborGroups.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-white/80">
            Jämför med granne
          </h3>
          <div className="max-h-52 space-y-3 overflow-y-auto pr-1">
            {neighborGroups.map((group) =>
              group.records.length > 0 ? (
                <div key={group.key} className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-white/45">
                    {group.label}
                  </div>
                  {group.records.map((neighbor) => (
                    <button
                      key={`${group.key}:${neighbor.image_id}`}
                      type="button"
                      className={`flex w-full items-center gap-2 rounded-md border p-1.5 text-left transition hover:bg-white/10 ${
                        comparisonImageId === neighbor.image_id
                          ? `${group.colorClass} bg-white/10`
                          : 'border-white/10'
                      }`}
                      onClick={() =>
                        setComparisonImageId(neighbor.image_id)
                      }
                    >
                      {datasetId && (
                        <img
                          src={datasetApiUrl(
                            datasetId,
                            `/image/${neighbor.image_id}`
                          )}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded object-cover"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-medium">
                          Bild #{neighbor.image_id}
                        </span>
                        <span className="block truncate text-[9px] text-white/50">
                          CLIP {formatRank(neighbor.clip_rank)} · UMAP{' '}
                          {formatRank(neighbor.projection_rank)}
                        </span>
                        <span className="block truncate text-[9px] text-white/45">
                          likhet {neighbor.clip_similarity.toFixed(3)} · avstånd{' '}
                          {neighbor.projection_distance.toFixed(3)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null
            )}
          </div>
        </section>
      )}

      {result?.comparison && (
        <>
          <ConceptSection
            title="Gemensamma begrepp"
            concepts={result.comparison.shared}
            compare
          />
          <ConceptSection
            title="Utmärkande för vald bild"
            concepts={result.comparison.selected_distinctive}
            compare
          />
          <ConceptSection
            title="Utmärkande för jämförelsebild"
            concepts={result.comparison.comparison_distinctive}
            compare
          />
        </>
      )}
    </div>
  )
}
