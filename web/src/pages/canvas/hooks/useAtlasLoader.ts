import { useEffect, useState } from 'react'
import * as PIXI from 'pixi.js'
import atlasMeta from '@/assets/atlas.json'
import atlas0 from '@/assets/atlas_0.png'
import atlas1 from '@/assets/atlas_1.png'
import atlas2 from '@/assets/atlas_2.png'
import atlas3 from '@/assets/atlas_3.png'
import atlas4 from '@/assets/atlas_4.png'
import atlas5 from '@/assets/atlas_5.png'
import atlas6 from '@/assets/atlas_6.png'
import atlas7 from '@/assets/atlas_7.png'
import { NUM_ATLASES } from '../constants'

export const useAtlasLoader = () => {
  const [allLoaded, setAllLoaded] = useState(false)
  const [masterAtlas, setMasterAtlas] = useState<Record<number, PIXI.Spritesheet>>(
    {}
  )

  useEffect(() => {
    const atlasImageSrcs = [
      atlas0,
      atlas1,
      atlas2,
      atlas3,
      atlas4,
      atlas5,
      atlas6,
      atlas7,
    ]

    let cancelled = false
    let loaded = 0

    atlasImageSrcs.forEach((imgSrc, index) => {
      const frames: any = {}
      for (const key in atlasMeta as any) {
        const { x, y, width: w, height: h, sheet } = (atlasMeta as any)[key]
        if (sheet !== index) continue
        frames[key] = {
          frame: { x, y, w, h },
          spriteSourceSize: { x: 0, y: 0, w, h },
          sourceSize: { w: 128, h: 128 },
        }
      }

      const data = {
        frames,
        meta: {
          image: imgSrc,
          scale: '1',
          format: 'RGBA8888',
          size: { w: 2990, h: 2990 },
        },
      }

      PIXI.Assets.load(data.meta.image).then((baseTexture: any) => {
        if (cancelled) return
        const sheet = new PIXI.Spritesheet(baseTexture.baseTexture, data)
        sheet.parse().then(() => {
          if (cancelled) return
          setMasterAtlas((prev) => ({ ...prev, [index]: sheet }))
          loaded += 1
          if (loaded === Math.min(NUM_ATLASES, atlasImageSrcs.length)) {
            setAllLoaded(true)
          }
        })
      })
    })

    return () => {
      cancelled = true
    }
  }, [])

  return {
    allLoaded,
    masterAtlas,
  }
}
