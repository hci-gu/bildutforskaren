import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { Link } from 'react-router'
import { API_URL } from '@/shared/lib/api'
import { Button } from '@/shared/ui/button'
import { t, useLanguage } from '@/shared/i18n'
import { uiConfigAtom, type UiConfig, type ViewType } from './uiConfig'
import { requestUiConfig, UiConfigRequestError } from './uiConfigRequest'

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
  const [error, setError] = useState<UiConfigRequestError | null>(null)
  const [failedAction, setFailedAction] = useState<'load' | 'save'>('load')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    requestUiConfig(`${API_URL}/ui-config`, { cache: 'no-store', signal: controller.signal })
      .then((config) => {
        setSaved(config)
        setDraft(config)
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFailedAction('load')
          setError(error instanceof UiConfigRequestError ? error : new UiConfigRequestError('invalid'))
        }
      })
    return () => controller.abort()
  }, [setSaved, loadAttempt])

  const update = (config: UiConfig) => {
    setDraft(config)
    setSuccess(false)
  }
  const save = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const config = await requestUiConfig(`${API_URL}/ui-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      })
      setSaved(config)
      setDraft(config)
      setSuccess(true)
    } catch (error) {
      setFailedAction('save')
      setError(error instanceof UiConfigRequestError ? error : new UiConfigRequestError('invalid'))
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
        {error && (
          <div role="alert" className="space-y-2 rounded-xl border border-red-300/25 p-4 text-red-300">
            <p>{failedAction === 'load' ? t('Could not load configuration.') : t('Could not save configuration.')}</p>
            <p className="text-sm">{
              error.reason === 'missing' ? t('The backend does not have the configuration endpoint (404). Update the backend code and restart the API on its machine.')
                : error.reason === 'network' ? t('Cannot reach the backend. Check that the API is running and accessible from this browser.')
                  : error.reason === 'invalid' ? t('The backend returned an invalid configuration response. Check the API address and backend version.')
                    : t('The backend rejected the request (HTTP {0}). Check its logs and access to config.json.', [error.status])
            }</p>
            <p className="break-all text-xs text-white/60">{API_URL}/ui-config</p>
            <Button variant="outline" onClick={() => failedAction === 'load' ? setLoadAttempt((attempt) => attempt + 1) : void save()} disabled={saving}>{t('Try again')}</Button>
          </div>
        )}
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
                  <Toggle label={t('Show this view type')} checked={draft.views[view].enabled !== false} onChange={() => update({
                    ...draft, views: { ...draft.views, [view]: { ...draft.views[view], enabled: draft.views[view].enabled === false } },
                  })} />
                  {Object.entries(draft.views[view]).filter(([widget]) => widget !== 'enabled').map(([widget, enabled]) => (
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
