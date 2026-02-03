import { useEffect, useMemo, useState } from 'react'
import * as PIXI from 'pixi.js'
import { activeDatasetIdAtom, datasetApiUrl } from '@/store'
import { useAtomValue } from 'jotai'

export type AtlasMetaEntry = {
  sheet: number
  x: number
  y: number
  width: number
  height: number
  atlas?: { w: number; h: number }
}

export type AtlasMeta = Record<string, AtlasMetaEntry>

const computeNumSheets = (meta: AtlasMeta) => {
  let maxSheet = -1
  for (const key in meta) {
    const s = meta[key]?.sheet
    if (typeof s === 'number' && s > maxSheet) maxSheet = s
  }
  return Math.max(0, maxSheet + 1)
}

export const useAtlasLoader = () => {
  const datasetId = useAtomValue(activeDatasetIdAtom)

  const [allLoaded, setAllLoaded] = useState(false)
  const [atlasMeta, setAtlasMeta] = useState<AtlasMeta>({})
  const [masterAtlas, setMasterAtlas] = useState<Record<number, PIXI.Spritesheet>>(
    {}
  )

  const numSheets = useMemo(() => computeNumSheets(atlasMeta), [atlasMeta])

  useEffect(() => {
    let cancelled = false

    setAllLoaded(false)
    setAtlasMeta({})
    setMasterAtlas({})

    if (!datasetId) {
      setAllLoaded(true)
      return () => {
        cancelled = true
      }
    }

    const load = async () => {
      const metaRes = await fetch(datasetApiUrl(datasetId, '/atlas/meta'))
      if (!metaRes.ok) {
        throw new Error('Failed to load atlas metadata')
      }
      const meta = (await metaRes.json()) as AtlasMeta
      if (cancelled) return

      setAtlasMeta(meta)

      const sheets = computeNumSheets(meta)
      if (sheets === 0) {
        setAllLoaded(true)
        return
      }

      let loaded = 0

      for (let index = 0; index < sheets; index++) {
        const frames: any = {}
        let sheetSize: { w: number; h: number } | null = null

        for (const key in meta) {
          const entry = meta[key]
          if (entry.sheet !== index) continue
          const { x, y, width: w, height: h } = entry
          if (!sheetSize && entry.atlas) sheetSize = entry.atlas
          frames[key] = {
            frame: { x, y, w, h },
            spriteSourceSize: { x: 0, y: 0, w, h },
            sourceSize: { w, h },
          }
        }

        const imageUrl = datasetApiUrl(datasetId, `/atlas/sheet/${index}.png`)
        const data = {
          frames,
          meta: {
            image: imageUrl,
            scale: '1',
            format: 'RGBA8888',
            size: sheetSize ?? { w: 0, h: 0 },
          },
        }

        PIXI.Assets.load(data.meta.image)
          .then((baseTexture: any) => {
            if (cancelled) return
            const sheet = new PIXI.Spritesheet(baseTexture.baseTexture, data)
            return sheet.parse().then(() => {
              if (cancelled) return
              setMasterAtlas((prev) => ({ ...prev, [index]: sheet }))
              loaded += 1
              if (loaded === sheets) {
                setAllLoaded(true)
              }
            })
          })
          .catch(() => {
            if (cancelled) return
            loaded += 1
            if (loaded === sheets) {
              setAllLoaded(true)
            }
          })
      }
    }

    load().catch((err) => {
      console.error(err)
      if (!cancelled) {
        setAllLoaded(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [datasetId])

  return {
    allLoaded,
    masterAtlas,
    atlasMeta,
    numSheets,
  }
}
