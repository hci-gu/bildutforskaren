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
  x: number;
  y: number;
  scale: { x: number; y: number }; // Keep y for consistency, though only x is used for radius
  texture: { width: number; height: number }; // Keep height for consistency
  data?: any; // Optional: if you need to access other particle data
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

  const radius1 = (p1.scale.x * p1.texture.width) / 2;
  const radius2 = (p2.scale.x * p2.texture.width) / 2;

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
