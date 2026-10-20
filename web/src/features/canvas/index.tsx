import { t, useLanguage } from '@/shared/i18n'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { API_URL } from '@/shared/lib/api'
import { uiConfigAtom } from './uiConfig'
import { loadableEmbeddingsAtom, projectionViewModeAtom } from '@/store'
import { CanvasScene } from './CanvasScene'

const Umap3DScene = lazy(() =>
  import('./Umap3DScene').then((module) => ({ default: module.Umap3DScene }))
)

const EmbeddingsFetchWrapper = () => {
  useLanguage()
  const embeddings = useAtomValue(loadableEmbeddingsAtom)
  const viewMode = useAtomValue(projectionViewModeAtom)
  const setConfig = useSetAtom(uiConfigAtom)
  const [configStatus, setConfigStatus] = useState('loading')

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${API_URL}/ui-config`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Configuration request failed')
        setConfig(await response.json())
        setConfigStatus('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfigStatus('error')
      })
    return () => controller.abort()
  }, [setConfig])

  if (configStatus === 'error') return <p role="alert" className="p-6 text-red-300">{t('Could not load or save configuration. Reload the page or try again.')}</p>
  if (configStatus === 'loading') return <p role="status" className="p-6 text-white">{t('Laddar…')}</p>

  if (embeddings.state === 'loading') {
    return (
      <h1
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'white',
          fontSize: 24,
          zIndex: 1000,
        }}
      >
        {t('Laddar in embeddings')}<br />  {t('( det kan ta upp till en minut )')} </h1>
    )
  }

  return viewMode === '3d' ? (
    <Suspense
      fallback={
        <div className="fixed inset-0 flex items-center justify-center bg-[#07090e] text-white">
          {t('Laddar 3D-visning…')} </div>
      }
    >
      <Umap3DScene />
    </Suspense>
  ) : (
    <CanvasScene />
  )
}

export default EmbeddingsFetchWrapper
