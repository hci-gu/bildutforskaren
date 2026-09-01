import type {
  AnchorSemanticConcept,
  AnchorSemantics,
} from '@/shared/lib/api'

type Props = {
  semantics: AnchorSemantics
}

const EmptyMessage = () => (
  <p className="text-xs text-white/45">Inga relevanta taggar hittades.</p>
)

const MeaningCard = ({
  setName,
  concepts,
}: {
  setName: 'A' | 'B'
  concepts: AnchorSemanticConcept[]
}) => (
  <section className="rounded-xl border border-white/10 bg-white/5 p-4">
    <p className="mb-1 text-[10px] font-medium tracking-widest text-white/45 uppercase">
      Set {setName}
    </p>
    <h3 className="mb-3 text-sm font-semibold text-white/90">
      Tag meaning
    </h3>
    {concepts.length === 0 ? (
      <EmptyMessage />
    ) : (
      <div className="flex flex-wrap gap-2">
        {concepts.map((concept) => (
          <span
            key={`${setName}:${concept.concept_id}`}
            className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/80"
            title={concept.scope_note || undefined}
          >
            {concept.label}
          </span>
        ))}
      </div>
    )}
  </section>
)

const ChangeCard = ({
  direction,
  concepts,
}: {
  direction: 'increasing' | 'decreasing'
  concepts: AnchorSemanticConcept[]
}) => {
  const increasing = direction === 'increasing'

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-sm ${
            increasing
              ? 'bg-cyan-400/15 text-cyan-300'
              : 'bg-amber-400/15 text-amber-300'
          }`}
          aria-hidden="true"
        >
          {increasing ? '↗' : '↘'}
        </span>
        <h3 className="text-sm font-semibold text-white/90">
          {increasing ? 'Increases toward B' : 'Decreases toward B'}
        </h3>
      </div>
      {concepts.length === 0 ? (
        <EmptyMessage />
      ) : (
        <ul className="space-y-2">
          {concepts.map((concept) => (
            <li
              key={`${direction}:${concept.concept_id}`}
              className="flex items-center gap-2 text-xs text-white/75"
              title={concept.scope_note || undefined}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  increasing ? 'bg-cyan-300' : 'bg-amber-300'
                }`}
              />
              {concept.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export const AnchorSemanticAnalysis = ({ semantics }: Props) => {
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

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="mx-auto grid max-w-3xl gap-3 pb-1 sm:grid-cols-2">
        <MeaningCard setName="A" concepts={semantics.endpoint_a} />
        <MeaningCard setName="B" concepts={semantics.endpoint_b} />
        <ChangeCard
          direction="increasing"
          concepts={semantics.increasing}
        />
        <ChangeCard
          direction="decreasing"
          concepts={semantics.decreasing}
        />
      </div>
    </div>
  )
}
