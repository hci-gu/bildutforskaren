export const calculateTargetScale = (
  distance: number | undefined | null,
  minMatchDist: number,
  maxMatchDist: number,
  defaultScale: number,
  minMatchedScale: number,
  maxScale: number,
  isMatched: boolean
): number => {
  if (!isMatched || distance === undefined || distance === null) {
    return defaultScale;
  }

  if (minMatchDist === maxMatchDist) {
    return maxScale;
  }

  const normalizedDistance =
    (distance - minMatchDist) / (maxMatchDist - minMatchDist);
  let targetScale =
    maxScale - normalizedDistance * (maxScale - minMatchedScale);
  
  // Clamp targetScale to [minMatchedScale, maxScale]
  targetScale = Math.max(
    minMatchedScale,
    Math.min(maxScale, targetScale)
  );
  return targetScale;
};

export interface Particle {
  id: any; // Or specific type like string | number
  x: number;
  y: number;
  scaleX: number;
  scaleY: number; 
  texture: { width: number; height: number }; 
  data?: any; 
}

export const resolveOverlap = (
  p1: Particle,
  p2: Particle,
  repulsionFactor: number
): { p1Moved: boolean; p2Moved: boolean } => {
  if (!p1.texture || !p2.texture) {
    // Cannot determine radii if textures are missing
    return { p1Moved: false, p2Moved: false };
  }

  const radius1 = (p1.scaleX * p1.texture.width) / 2;
  const radius2 = (p2.scaleX * p2.texture.width) / 2;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let distance = Math.sqrt(dx * dx + dy * dy);

  let p1Moved = false;
  let p2Moved = false;

  if (distance < radius1 + radius2) {
    const overlap = radius1 + radius2 - distance;
    let normDx = 0;
    let normDy = 0;

    if (distance === 0) {
      // Handle exact overlap: apply a small random displacement
      normDx = (Math.random() - 0.5) * 0.1; // Keep small to avoid large jumps
      normDy = (Math.random() - 0.5) * 0.1;
       // Recalculate distance to ensure it's non-zero for the move calculation
      distance = Math.sqrt(normDx*normDx + normDy*normDy); 
      // If distance is still zero (highly unlikely with random values), force a minimal non-zero vector
      if (distance === 0) {
        normDx = 0.01; 
        normDy = 0;
        distance = 0.01;
      }

    } else {
      normDx = dx / distance;
      normDy = dy / distance;
    }
    
    const moveX = normDx * overlap * repulsionFactor;
    const moveY = normDy * overlap * repulsionFactor;

    p1.x -= moveX;
    p1.y -= moveY;
    p2.x += moveX;
    p2.y += moveY;
    
    p1Moved = true;
    p2Moved = true;
  }
  return { p1Moved, p2Moved };
};

export const performIterativeOverlapResolution = (
  particles: Particle[],
  maxIterations: number,
  repulsionFactor: number,
  stabilizationThresholdPerParticle: number // Threshold per particle for clarity
): Particle[] => {
  if (!particles || particles.length === 0) {
    return [];
  }

  const stabilizationThresholdTotal = stabilizationThresholdPerParticle * particles.length;

  for (let iter = 0; iter < maxIterations; iter++) {
    let totalMovement = 0;
    for (let i = 0; i < particles.length; i++) {
      const p1 = particles[i];
      const p1InitialX = p1.x;
      const p1InitialY = p1.y;
      let p1HasMovedThisIteration = false;

      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const p2InitialX = p2.x;
        const p2InitialY = p2.y;

        // resolveOverlap directly modifies p1 and p2 if they overlap
        const { p1Moved, p2Moved } = resolveOverlap(p1, p2, repulsionFactor);
        
        // Track if p1 moved due to this interaction or a previous one in this iteration
        if (p1Moved) p1HasMovedThisIteration = true;

        // For totalMovement, we sum the movement of p2 if it moved.
        // p1's movement will be accounted for after its inner loop finishes.
        if (p2Moved) {
          totalMovement += Math.sqrt((p2.x - p2InitialX) ** 2 + (p2.y - p2InitialY) ** 2);
        }
      }
      // Add p1's total movement in this iteration
      if (p1HasMovedThisIteration) {
         totalMovement += Math.sqrt((p1.x - p1InitialX) ** 2 + (p1.y - p1InitialY) ** 2);
      }
    }

    // Start checking for stabilization after a few initial iterations
    // to allow gross overlaps to resolve first.
    if (iter > 10 && totalMovement < stabilizationThresholdTotal) {
      // console.log(`Stabilized after ${iter + 1} iterations. Total movement: ${totalMovement}`);
      break;
    }
  }
  return particles; // Return the modified particles array
};
