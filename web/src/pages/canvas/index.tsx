import React, { use, useEffect, useMemo, useState } from 'react'
import '@pixi/events'
import { Application, useApplication, extend, useTick } from '@pixi/react'
import * as PIXI from 'pixi.js'
import atlasMeta from '@/assets/atlas.json'
import atlasImageSrc from '@/assets/atlas.png'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  API_URL,
  filteredEmbeddingsAtom,
  searchQueryAtom,
  selectedEmbeddingAtom,
} from '@/state'
import { Input } from '../../components/ui/input'
import { PhotoView } from 'react-photo-view'
import { state } from './canvasState'
import { Viewport } from './ViewPort'
import Panel from './Panel'

extend({
  Viewport,
  ParticleContainer: PIXI.ParticleContainer,
  Particle: PIXI.Particle,
  Container: PIXI.Container,
  Sprite: PIXI.Sprite,
  Text: PIXI.Text,
})

function normalizePoints(points: [number, number][]): [number, number][] {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  return points.map(([x, y]) => [(x - minX) / rangeX, (y - minY) / rangeY])
}

type Props = {
  width?: number
  height?: number
  nodeSize?: number
}

const colorForMetadata = (metadata: any) => {
  if (metadata.photographer == '1') {
    return 0x5555ff
  } else if (metadata.photographer == '2') {
    return 0x55ff55
  } else if (metadata.photographer == '3') {
    return 0xffff55
  } else if (metadata.photographer == '4') {
    return 0xff55ff
  }
  return 0xffffff
}

const Embeddings: React.FC<{
  atlas: PIXI.Spritesheet
  particleContainerRef: React.RefObject<PIXI.ParticleContainer | null>
}> = ({ atlas, particleContainerRef }) => {
  const rawEmbeddings = useAtomValue(filteredEmbeddingsAtom)
  const matchedEmbeddings = rawEmbeddings.filter(
    (embed: any) => embed.meta.matched
  )

  const defaultScale = 0.05
  const maxScale = 0.7
  const minMatchedScale = 0.2

  let minMatchDist = 0
  let maxMatchDist = 0

  if (matchedEmbeddings.length > 0) {
    const distances = matchedEmbeddings.map(
      (embed: any) => embed.meta.matchedDistance
    )
    minMatchDist = Math.min(...distances)
    maxMatchDist = Math.max(...distances)
  }

  const normalized = useMemo(
    () => normalizePoints(rawEmbeddings.map((e: any) => e.point)),
    [rawEmbeddings]
  )
  const textEmbeddings = rawEmbeddings.filter(
    (embed: any) => embed.type === 'text'
  )

  // useEffect to pre-calculate target positions and scales, including overlap resolution
  useEffect(() => {
    if (!rawEmbeddings.length || !atlas) return;

    // Create a temporary list of "particle-like" objects for pre-calculation
    const tempParticlesForPreCalculation: Particle[] = rawEmbeddings.map((embed: any, i: number) => {
      const [nx, ny] = normalized[i];
      const initialTargetX = nx * 1920;
      const initialTargetY = ny * 1200;
      const scale = calculateTargetScale(
        embed.meta.matchedDistance,
        minMatchDist,
        maxMatchDist,
        defaultScale,
        minMatchedScale,
        maxScale,
        embed.meta.matched
      );
      // Ensure texture exists for this particle index in the atlas
      // The atlas keys are based on the original index of embeddings
      const textureKey = embed.id // Assuming embed.id is the key for atlas.textures, or use index 'i' if that's the case
      const texture = atlas.textures[textureKey] || atlas.textures[i] || Object.values(atlas.textures)[0]; // Fallback texture

      return {
        id: embed.id, // Keep id for mapping back
        x: initialTargetX,
        y: initialTargetY,
        scaleX: scale,
        scaleY: scale,
        texture: texture ? { width: texture.width, height: texture.height } : { width: 64, height: 64 }, // Use actual texture dimensions or fallback
        data: embed, // Keep original embedding data
      };
    });

    // Use the refactored iterative overlap resolution
    const repulsionFactor = 0.2;
    const MAX_ITERATIONS = 100;
    const stabilizationThresholdPerParticle = 0.1; 
    
    // performIterativeOverlapResolution modifies tempParticlesForPreCalculation in place
    performIterativeOverlapResolution(
      tempParticlesForPreCalculation,
      MAX_ITERATIONS,
      repulsionFactor,
      stabilizationThresholdPerParticle
    );

    // Update the actual PIXI particles' data with these pre-calculated target positions and scales
    if (particleContainerRef.current) {
      for (let i = 0; i < particleContainerRef.current.particleChildren.length; i++) {
        const pixiParticle = particleContainerRef.current.particleChildren[i] as (PIXI.Particle & { data?: any });
        // Ensure pixiParticle.data and pixiParticle.data.id exist before trying to find
        if (!pixiParticle.data || pixiParticle.data.id === undefined) continue;
        
        const correspondingTempParticle = tempParticlesForPreCalculation.find(tp => tp.id === pixiParticle.data.id);

        if (pixiParticle && correspondingTempParticle) {
          pixiParticle.data.targetX = correspondingTempParticle.x; // Store resolved X
          pixiParticle.data.targetY = correspondingTempParticle.y; // Store resolved Y
          pixiParticle.data.targetScale = correspondingTempParticle.scaleX; // Store calculated scale

          // If PIXI particles are already created, assign initial rawEmbedding data if not already done
          // This part depends on when PIXI particles are created vs. when this effect runs.
          // Assuming particle.data is already set with rawEmbeddings[i] from the creation useEffect.
        }
      }
    }
     // This effect primarily updates the .data properties of existing PIXI particles.
     // If PIXI particles are not yet created, this data needs to be available when they are.
     // One way is to update rawEmbeddings or a derived state that the particle creation effect uses.
     // For now, assuming particles are there and we're updating their .data

  }, [rawEmbeddings, normalized, atlas, minMatchDist, maxMatchDist, defaultScale, minMatchedScale, maxScale, particleContainerRef]);


  useTick((_: PIXI.Ticker) => {
    if (particleContainerRef.current) {
      const currentParticles = particleContainerRef.current.particleChildren as (PIXI.Particle & {data?: any})[]

      for (let particle of currentParticles) {
        const data = particle.data;
        if (data) {
          // Lerp position towards pre-calculated targetX and targetY
          const targetX = data.targetX !== undefined ? data.targetX : data.x; // Fallback to data.x if targetX not set
          const targetY = data.targetY !== undefined ? data.targetY : data.y; // Fallback to data.y if targetY not set
          
          const dx = targetX - particle.x;
          const dy = targetY - particle.y;
          const currentDistance = Math.sqrt(dx * dx + dy * dy);
          const speed = 0.1;
          if (currentDistance > 0.5) { // Adjusted threshold for movement
            particle.x += dx * speed;
            particle.y += dy * speed;
          } else if (currentDistance > 0) { // Snap if very close
            particle.x = targetX;
            particle.y = targetY;
          }

          // Lerp scale towards targetScale (already calculated and stored in data.targetScale)
          const targetScaleValue = data.targetScale !== undefined ? data.targetScale : defaultScale;
          const scaleDiff = targetScaleValue - particle.scale.x;
          if (Math.abs(scaleDiff) > 0.001) { // Adjusted threshold for scaling
            particle.scale.x += scaleDiff * speed;
            particle.scale.y += scaleDiff * speed;
          } else if (scaleDiff !== 0) {
            particle.scale.x = targetScaleValue;
            particle.scale.y = targetScaleValue;
          }
        }
      }
      // particleContainerRef.current.update() // update is not a method on ParticleContainer
      // The PIXI ticker automatically handles rendering updates.
    }
  })

  // useEffect for initial particle creation
  useEffect(() => {
    if (particleContainerRef.current && atlas && rawEmbeddings.length && normalized.length) { // Added normalized.length check
       // Clear existing particles before adding new ones to prevent duplicates if rawEmbeddings changes
      particleContainerRef.current.removeChildren();

      for (let i = 0; i < rawEmbeddings.length; i++) {
        const embedData = rawEmbeddings[i];
        // Ensure normalized[i] exists to prevent errors
        if (!normalized[i]) {
          console.warn(`Normalized data missing for embedding index: ${i}, ID: ${embedData.id}`);
          continue;
        }
        const [nx, ny] = normalized[i];
        
        // Initial position before pre-calculation (will be quickly updated by useTick lerping to targetX/Y)
        const initialX = nx * 1920;
        const initialY = ny * 1200;

        // Initial scale (will be quickly updated by useTick lerping to targetScale)
        // Use calculateTargetScale here for a more accurate initial scale before pre-calc effect runs
        const initialTargetMetaScale = calculateTargetScale(
            embedData.meta.matchedDistance,
            minMatchDist, maxMatchDist, defaultScale, minMatchedScale, maxScale, embedData.meta.matched
        );
        
        const textureKey = embedData.id // Or use index i if that's the key for atlas.textures
        const texture = atlas.textures[textureKey] || atlas.textures[String(i)] || Object.values(atlas.textures)[0];


        if (!texture) {
          console.warn(`Texture not found for embedding id: ${embedData.id} or index: ${i}`);
          continue; // Skip creating particle if texture is missing
        }

        const particle = new PIXI.Particle({
          texture: texture,
          x: initialX,
          y: initialY,
          scaleX: initialTargetMetaScale, // Use more accurate initial scale
          scaleY: initialTargetMetaScale, // Use more accurate initial scale
          anchorX: 0.5,
          anchorY: 0.5,
          tint: colorForMetadata(embedData.meta),
        });
        
        // Store all necessary data on the particle for pre-calculation and rendering logic
        particle.data = {
          ...embedData, // Original embedding data
          id: embedData.id, // Ensure id is present for mapping
          targetX: initialX, // Initialize targetX to initialX
          targetY: initialY, // Initialize targetY to initialY
          targetScale: initialTargetMetaScale, // Initialize targetScale
          // These will be updated by the pre-calculation useEffect
          x: initialX, // Store initial normalized position as data.x, data.y (used as fallback in useTick)
          y: initialY,
        };
        particleContainerRef.current.addParticle(particle);
      }
    }

    return () => {
      if (particleContainerRef.current) {
        // particleContainerRef.current.removeParticles() // .removeParticles() is not a method
        particleContainerRef.current.removeChildren(); // Correct method
      }
    }
  }, [rawEmbeddings, atlas, normalized, particleContainerRef, minMatchDist, maxMatchDist, defaultScale, minMatchedScale, maxScale]); // Added scale dependencies


  useEffect(() => {
    if (particleContainerRef.current) {
      for (let i = 0; i < rawEmbeddings.length; i++) {
        const [nx, ny] = normalized[i]
        const x = nx * 1920
        const y = ny * 1200
        const particle = new PIXI.Particle({
          texture: atlas.textures[i],
          x,
          y,
          scaleX: 0.05,
          scaleY: 0.05,
          anchorX: 0.5,
          anchorY: 0.5,
          tint: colorForMetadata(rawEmbeddings[i].meta),
        })
        particle.data = rawEmbeddings[i]
        particle.data.x = x
        particle.data.y = y
        particleContainerRef.current.addParticle(particle)
      }
    }

    return () => {
      if (particleContainerRef.current) {
        particleContainerRef.current.removeParticles()
      }
    }
  }, [particleContainerRef])

  return (
          resolveOverlap(
            tempParticlesForPreCalculation[i],
            tempParticlesForPreCalculation[j],
            repulsionFactor
          );
        }
      }
    }

    // Update the actual PIXI particles' data with these pre-calculated target positions and scales
    if (particleContainerRef.current) {
      for (let i = 0; i < particleContainerRef.current.particleChildren.length; i++) {
        const pixiParticle = particleContainerRef.current.particleChildren[i] as (PIXI.Particle & { data?: any });
        const correspondingTempParticle = tempParticlesForPreCalculation.find(tp => tp.id === pixiParticle.data.id);

          // This part depends on when PIXI particles are created vs. when this effect runs.
          // Assuming particle.data is already set with rawEmbeddings[i] from the creation useEffect.
        }
      }
    }
     // This effect primarily updates the .data properties of existing PIXI particles.
     // If PIXI particles are not yet created, this data needs to be available when they are.
     // One way is to update rawEmbeddings or a derived state that the particle creation effect uses.
     // For now, assuming particles are there and we're updating their .data

  }, [rawEmbeddings, normalized, atlas, minMatchDist, maxMatchDist, defaultScale, minMatchedScale, maxScale, particleContainerRef]);


  useTick((_: PIXI.Ticker) => {
    if (particleContainerRef.current) {
      const currentParticles = particleContainerRef.current.particleChildren as (PIXI.Particle & {data?: any})[]

      for (let particle of currentParticles) {
        const data = particle.data;
        if (data) {
          // Lerp position towards pre-calculated targetX and targetY
          const targetX = data.targetX !== undefined ? data.targetX : data.x; // Fallback to data.x if targetX not set
          const targetY = data.targetY !== undefined ? data.targetY : data.y; // Fallback to data.y if targetY not set
          
          const dx = targetX - particle.x;
          const dy = targetY - particle.y;
          const currentDistance = Math.sqrt(dx * dx + dy * dy);
          const speed = 0.1;
          if (currentDistance > 0.5) { // Adjusted threshold for movement
            particle.x += dx * speed;
            particle.y += dy * speed;
          } else if (currentDistance > 0) { // Snap if very close
            particle.x = targetX;
            particle.y = targetY;
          }

            particle.scale.x += scaleDiff * speed;
            particle.scale.y += scaleDiff * speed;
          } else if (scaleDiff !== 0) {
            particle.scale.x = targetScaleValue;
            particle.scale.y = targetScaleValue;
          }
        }
      }
      // particleContainerRef.current.update() // update is not a method on ParticleContainer
      // The PIXI ticker automatically handles rendering updates.
    }
  })

  // useEffect for initial particle creation
  useEffect(() => {
    if (particleContainerRef.current && atlas && rawEmbeddings.length) {
       // Clear existing particles before adding new ones to prevent duplicates if rawEmbeddings changes
      particleContainerRef.current.removeChildren();

      for (let i = 0; i < rawEmbeddings.length; i++) {
        const embedData = rawEmbeddings[i];
        const [nx, ny] = normalized[i] || [0.5, 0.5]; // Fallback if normalized[i] is undefined
        
        // Initial position before pre-calculation (will be quickly updated by useTick lerping to targetX/Y)
        const initialX = nx * 1920;
        const initialY = ny * 1200;


        if (!texture) {
          console.warn(`Texture not found for embedding id: ${embedData.id} or index: ${i}`);
          continue; // Skip creating particle if texture is missing
        }

        const particle = new PIXI.Particle({
          texture: texture,
          x: initialX,
          y: initialY,
          scaleX: initialScale,
          scaleY: initialScale,
          anchorX: 0.5,
          anchorY: 0.5,
          tint: colorForMetadata(embedData.meta),
        });
        
        // Store all necessary data on the particle for pre-calculation and rendering logic
        particle.data = {
          ...embedData, // Original embedding data
          id: embedData.id, // Ensure id is present for mapping
  // This useEffect seems redundant now as its logic is incorporated into the main particle creation useEffect.
  // I will remove it.
  // useEffect(() => {
  //   if (particleContainerRef.current) {
  //     for (let i = 0; i < rawEmbeddings.length; i++) {
  //       const [nx, ny] = normalized[i]
  //       const x = nx * 1920
  //       const y = ny * 1200
  //       const particle = new PIXI.Particle({
  //         texture: atlas.textures[i],
  //         x,
  //         y,
  //         scaleX: 0.05,
  //         scaleY: 0.05,
  //         anchorX: 0.5,
  //         anchorY: 0.5,
  //         tint: colorForMetadata(rawEmbeddings[i].meta),
  //       })
  //       particle.data = rawEmbeddings[i]
  //       particle.data.x = x
  //       particle.data.y = y
  //       particleContainerRef.current.addParticle(particle)
  //     }
  //   }

  //   return () => {
  //     if (particleContainerRef.current) {
  //       particleContainerRef.current.removeParticles()
  //     }
  //   }
  // }, [particleContainerRef])

  return (
    <>
      <pixiParticleContainer
        ref={particleContainerRef}
        dynamicProperties={{
          position: true,
          scale: true,
          rotation: false,
          alpha: false,
        }}
      />
      <pixiContainer>
        {textEmbeddings.map((embed: any, i: number) => {
          const [nx, ny] = normalized[i]
          const x = nx * 1920
          const y = ny * 1200

          return (
            <pixiText
              key={embed.id}
              text={embed.text}
              x={x}
              y={y}
              anchor={0.5}
              style={{
                fontSize: 12,
                fill: embed.meta.matched ? 0xff5555 : 0xffffff,
                align: 'center',
              }}
            />
          )
        })}
      </pixiContainer>
    </>
  )
}

const pointIntersectsParticle = (
  x: number,
  y: number,
  particles: PIXI.Particle[]
) => {
  for (const particle of particles) {
    const dx = x - particle.x
    const dy = y - particle.y
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared < 5) {
      return particle
    }
  }
  return null
}

const ImageDisplayer = () => {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const selectedEmbedding = useAtomValue<any>(selectedEmbeddingAtom)

  useEffect(() => {
    if (buttonRef.current && selectedEmbedding) {
      setTimeout(() => {
        buttonRef.current?.click()
      }, 100)
    }
  }, [buttonRef, selectedEmbedding])

  if (!selectedEmbedding) return null

  return (
    <PhotoView
      key={`Image_${selectedEmbedding.id}`}
      src={`${API_URL}/original/${selectedEmbedding.id}`}
    >
      <button ref={buttonRef}></button>
    </PhotoView>
  )
}

const EmbeddingsCanvas: React.FC<Props> = ({ width = 1920, height = 1200 }) => {
  const setSelectedEmbedding = useSetAtom(selectedEmbeddingAtom)
  const viewportRef = React.useRef<Viewport>(null)
  const particleContainerRef = React.useRef<PIXI.ParticleContainer>(null)
  const [atlas, setAtlas] = useState<PIXI.Spritesheet | null>(null)

  useEffect(() => {
    const sourceSize = {
      w: 64,
      h: 64,
    }
    const frames: any = {}

    for (const key in atlasMeta) {
      const { x, y, width, height } = (atlasMeta as any)[key]
      frames[key] = {
        frame: { x, y, w: width, h: height },
        spriteSourceSize: { x: 0, y: 0, w: width, h: height },
        sourceSize,
      }
    }

    const atlasData = {
      frames,
      meta: {
        scale: '1',
        image: atlasImageSrc,
        format: 'RGBA8888',
        size: { w: 8450, h: 8450 },
      },
    }

    // Load the image first
    PIXI.Assets.load(atlasData.meta.image).then((baseTexture) => {
      const spritesheet = new PIXI.Spritesheet(
        baseTexture.baseTexture,
        atlasData
      )
      spritesheet.parse().then(() => {
        setAtlas(spritesheet)
      })
    })
  }, [])

  if (!atlas) return <div>Loading...</div>

  return (
    <>
      <ImageDisplayer />
      <Panel />
      <Application
        width={window.innerWidth}
        height={window.innerHeight}
        onInit={(app) => {
          state.pixiApp = app
        }}
      >
        <viewport
          ref={viewportRef}
          width={width}
          height={height}
          onClick={(e: any) => {
            const point = viewportRef.current?.toWorld(e.data.global)

            const particles = particleContainerRef.current?.particleChildren
            if (particles && point) {
              // const zoom = viewportRef.current?.lastViewport?.scaleX
              const particle = pointIntersectsParticle(
                point.x,
                point.y,
                particles as PIXI.Particle[]
              )
              if (particle) {
                const data = particle.data
                setSelectedEmbedding(data)
              } else {
                setSelectedEmbedding(null)
              }
            }
          }}
        >
          <Embeddings
            atlas={atlas}
            particleContainerRef={particleContainerRef}
          />
        </viewport>
      </Application>
    </>
  )
}

export default EmbeddingsCanvas
