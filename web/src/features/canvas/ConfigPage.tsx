import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { Link } from 'react-router'
import { API_URL } from '@/shared/lib/api'
import { Button } from '@/shared/ui/button'
import { t, useLanguage } from '@/shared/i18n'
import { uiConfigAtom, type UiConfig, type ViewType } from './uiConfig'

const viewLabels = { umap: 'Projektion', grid: 'Rutnät', tagged: 'Taggade/otaggade', graph: 'Graph network', year: 'År' } as const
const widgetLabels = {
  search: 'Sök', imageSize: 'Bildstorlek', advanced: 'Avancerad', filter: 'Filter',
  colorPhotographer: 'Färga fotograf', clusterImages: 'Visa klusterbilder', dimension: 'Dimension',
  stability: 'Cluster stability analysis', fidelity: 'Neighbor fidelity',
  projectionParameters: 'Projektionsparametrar', explanation: 'Förklaring (XAI)',
  minimap: 'Minimap', groupTagged: 'Gruppera taggade efter tagg', datasetStatus: 'Datasetstatus', graphLayout: 'Graph layout',
} as const

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-6 py-3">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={onChange} className="peer sr-only" />
      <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-full bg-white/20 transition peer-checked:bg-cyan-500 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-200 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  )
}

export default function ConfigPage() {
  useLanguage()
  const [saved, setSaved] = useAtom(uiConfigAtom)
  const [draft, setDraft] = useState(saved)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${API_URL}/ui-config`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Configuration request failed')
        const config: UiConfig = await response.json()
        setSaved(config)
        setDraft(config)
        setLoading(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
    return () => controller.abort()
  }, [setSaved])

  const update = (config: UiConfig) => {
    setDraft(config)
    setSuccess(false)
  }
  const save = async () => {
    setSaving(true)
    setError(false)
    setSuccess(false)
    try {
      const response = await fetch(`${API_URL}/ui-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      })
      if (!response.ok) throw new Error('Configuration request failed')
      const config: UiConfig = await response.json()
      setSaved(config)
      setDraft(config)
      setSuccess(true)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-svh bg-[#07090e] px-6 py-12 text-white">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link to="/canvas" className="text-sm text-cyan-200 hover:underline">{t('Tillbaka till canvas')}</Link>
        <h1 className="text-3xl font-semibold">{t('Canvas configuration')}</h1>
        <p className="text-white/60">{t('Choose which canvas widgets are available. Settings apply to all datasets and are saved in config.json.')}</p>
        {error && <p role="alert" className="text-red-300">{t('Could not load or save configuration. Reload the page or try again.')}</p>}
        {loading && !error && <p role="status">{t('Laddar…')}</p>}
        <fieldset disabled={loading || saving} className="space-y-6 disabled:opacity-50">
          <section className="glass-panel rounded-xl px-5 py-2">
            <Toggle label={t('Ord i rummet')} checked={draft.words} onChange={() => update({ ...draft, words: !draft.words })} />
            <Toggle label={t('Typ av visning')} checked={draft.viewTypeOptions} onChange={() => update({ ...draft, viewTypeOptions: !draft.viewTypeOptions })} />
          </section>
          <div className="space-y-3">
            {(Object.keys(viewLabels) as ViewType[]).map((view) => (
              <details key={view} className="glass-panel rounded-xl px-5">
                <summary className="cursor-pointer py-4 font-medium">{t(viewLabels[view])}</summary>
                <div className="divide-y divide-white/10 border-t border-white/10 pb-2">
                  {Object.entries(draft.views[view]).map(([widget, enabled]) => (
                    <Toggle key={widget} label={t(widgetLabels[widget as keyof typeof widgetLabels])} checked={enabled} onChange={() => update({
                      ...draft, views: { ...draft.views, [view]: { ...draft.views[view], [widget]: !enabled } },
                    })} />
                  ))}
                </div>
              </details>
            ))}
          </div>
          <Button onClick={() => void save()} disabled={saving}>{saving ? t('Sparar…') : t('Save configuration')}</Button>
        </fieldset>
        {success && <p role="status" className="text-cyan-200">{t('Configuration saved.')}</p>}
      </div>
    </main>
  )
}
