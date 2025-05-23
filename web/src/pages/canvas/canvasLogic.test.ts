import { calculateTargetScale, resolveOverlap, Particle } from './utils';

// Constants for scaling tests, mirroring implementation
const defaultScale = 0.05;
const minMatchedScale = 0.2;
const maxScale = 0.7;

describe('calculateTargetScale', () => {
  it('should return maxScale when distance is at minMatchDist', () => {
    expect(calculateTargetScale(10, 10, 20, defaultScale, minMatchedScale, maxScale, true)).toBe(maxScale);
  });

  it('should return minMatchedScale when distance is at maxMatchDist', () => {
    expect(calculateTargetScale(20, 10, 20, defaultScale, minMatchedScale, maxScale, true)).toBe(minMatchedScale);
  });

  it('should return a scale between minMatchedScale and maxScale when distance is between min and max', () => {
    const scale = calculateTargetScale(15, 10, 20, defaultScale, minMatchedScale, maxScale, true);
    expect(scale).toBeGreaterThanOrEqual(minMatchedScale);
    expect(scale).toBeLessThanOrEqual(maxScale);
    // Specifically, for 15, it should be (0.7 - ( (15-10)/(20-10) * (0.7-0.2) )) = 0.7 - (0.5 * 0.5) = 0.7 - 0.25 = 0.45
    expect(scale).toBeCloseTo(0.45); 
  });

  it('should return maxScale when minMatchDist equals maxMatchDist for a matched item', () => {
    expect(calculateTargetScale(10, 10, 10, defaultScale, minMatchedScale, maxScale, true)).toBe(maxScale);
  });

  it('should return defaultScale when isMatched is false', () => {
    expect(calculateTargetScale(15, 10, 20, defaultScale, minMatchedScale, maxScale, false)).toBe(defaultScale);
  });

  it('should return defaultScale when distance is undefined for a matched item (though usually guarded by isMatched)', () => {
    // This scenario tests the function's robustness if isMatched was true but distance was somehow undefined.
    // The function is designed to return defaultScale if distance is undefined or null.
    expect(calculateTargetScale(undefined, 10, 20, defaultScale, minMatchedScale, maxScale, true)).toBe(defaultScale);
  });

  it('should return defaultScale when distance is null for a matched item', () => {
    expect(calculateTargetScale(null, 10, 20, defaultScale, minMatchedScale, maxScale, true)).toBe(defaultScale);
  });

  it('should clamp to minMatchedScale if calculated scale is lower', () => {
    // e.g. if maxScale - normalizedDistance * (maxScale - minMatchedScale) results in value < minMatchedScale
    // This can happen if distance > maxMatchDist, but our clamping should handle it.
    // Let distance be 25, min 10, max 20. Normalized distance = (25-10)/(20-10) = 1.5
    // Scale = 0.7 - 1.5 * (0.7-0.2) = 0.7 - 1.5 * 0.5 = 0.7 - 0.75 = -0.05. Should be clamped to 0.2
    expect(calculateTargetScale(25, 10, 20, defaultScale, minMatchedScale, maxScale, true)).toBe(minMatchedScale);
  });

  it('should clamp to maxScale if calculated scale is higher', () => {
    // e.g. if distance < minMatchDist. Normalized distance = (5-10)/(20-10) = -0.5
    // Scale = 0.7 - (-0.5) * (0.7-0.2) = 0.7 + 0.25 = 0.95. Should be clamped to 0.7
    expect(calculateTargetScale(5, 10, 20, defaultScale, minMatchedScale, maxScale, true)).toBe(maxScale);
  });
});

// Constants for overlap tests
const repulsionFactor = 0.1;
const mockTextureWidth = 64; // Standard texture width assumed in implementation

describe('resolveOverlap', () => {
  const createParticle = (x: number, y: number, scale: number): Particle => ({
    x,
    y,
    scale: { x: scale, y: scale }, // Assuming uniform scaling for radius calculation
    texture: { width: mockTextureWidth, height: mockTextureWidth },
  });

  it('Scenario 1: should move overlapping particles apart', () => {
    const p1 = createParticle(0, 0, 0.5); // radius = 0.5 * 64 / 2 = 16
    const p2 = createParticle(10, 0, 0.5); // radius = 16. Sum of radii = 32. Distance = 10. Overlap.
    
    const initialP1X = p1.x;
    const initialP1Y = p1.y;
    const initialP2X = p2.x;
    const initialP2Y = p2.y;

    const { p1Moved, p2Moved } = resolveOverlap(p1, p2, repulsionFactor);

    expect(p1Moved).toBe(true);
    expect(p2Moved).toBe(true);

    // Check they moved apart along the x-axis
    expect(p1.x).toBeLessThan(initialP1X); // p1 moves left
    expect(p2.x).toBeGreaterThan(initialP2X); // p2 moves right
    expect(p1.y).toBe(initialP1Y); // No y movement
    expect(p2.y).toBe(initialP2Y); // No y movement

    const finalDistance = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
    // They should be further apart, ideally not overlapping anymore if repulsion is sufficient
    // The exact final distance depends on the repulsion factor and overlap depth.
    // Overlap = 32 - 10 = 22. Move amount = 22 * 0.1 = 2.2. p1.x = -2.2, p2.x = 10 + 2.2 = 12.2
    // New distance = 12.2 - (-2.2) = 14.4
    expect(p1.x).toBeCloseTo(0 - (1 * 22 * repulsionFactor));
    expect(p2.x).toBeCloseTo(10 + (1 * 22 * repulsionFactor));
    expect(finalDistance).toBeGreaterThan(10);
  });

  it('Scenario 2: should not move non-overlapping particles', () => {
    const p1 = createParticle(0, 0, 0.1); // radius = 0.1 * 64 / 2 = 3.2
    const p2 = createParticle(10, 0, 0.1); // radius = 3.2. Sum of radii = 6.4. Distance = 10. No overlap.
    
    const initialP1X = p1.x;
    const initialP1Y = p1.y;
    const initialP2X = p2.x;
    const initialP2Y = p2.y;

    const { p1Moved, p2Moved } = resolveOverlap(p1, p2, repulsionFactor);

    expect(p1Moved).toBe(false);
    expect(p2Moved).toBe(false);
    expect(p1.x).toBe(initialP1X);
    expect(p1.y).toBe(initialP1Y);
    expect(p2.x).toBe(initialP2X);
    expect(p2.y).toBe(initialP2Y);
  });

  it('Scenario 3: should not move particles that are just touching (distance === sum of radii)', () => {
    const p1 = createParticle(0, 0, 0.5); // radius = 16
    const p2 = createParticle(32, 0, 0.5); // radius = 16. Sum of radii = 32. Distance = 32. Touching.
    
    const initialP1X = p1.x;
    const initialP1Y = p1.y;
    const initialP2X = p2.x;
    const initialP2Y = p2.y;

    const { p1Moved, p2Moved } = resolveOverlap(p1, p2, repulsionFactor);
    
    expect(p1Moved).toBe(false);
    expect(p2Moved).toBe(false);
    expect(p1.x).toBe(initialP1X);
    expect(p1.y).toBe(initialP1Y);
    expect(p2.x).toBe(initialP2X);
    expect(p2.y).toBe(initialP2Y);
  });

  it('Scenario 4: should move particles apart if they are at the exact same position (distance = 0)', () => {
    const p1 = createParticle(0, 0, 0.5);
    const p2 = createParticle(0, 0, 0.5);
        
    const { p1Moved, p2Moved } = resolveOverlap(p1, p2, repulsionFactor);

    expect(p1Moved).toBe(true);
    expect(p2Moved).toBe(true);
    // Check they are no longer at the same spot
    expect(p1.x !== 0 || p1.y !== 0 || p2.x !== 0 || p2.y !== 0).toBe(true);
    // Check they moved in opposite directions (or at least away from the origin)
    // The exact direction is random, so we check they are not in the same spot and both moved.
    expect(p1.x !== p2.x || p1.y !== p2.y).toBe(true);
  });

  it('should handle particles with missing textures gracefully', () => {
    const p1: Particle = { x: 0, y: 0, scale: { x: 0.5, y: 0.5 }, texture: null as any };
    const p2: Particle = { x: 1, y: 1, scale: { x: 0.5, y: 0.5 }, texture: {width: 64, height: 64}};
    
    const { p1Moved, p2Moved } = resolveOverlap(p1, p2, repulsionFactor);
    expect(p1Moved).toBe(false);
    expect(p2Moved).toBe(false);

    const p3: Particle = { x: 0, y: 0, scale: { x: 0.5, y: 0.5 }, texture: {width: 64, height: 64}};
    const p4: Particle = { x: 1, y: 1, scale: { x: 0.5, y: 0.5 }, texture: null as any };
    const { p1Moved: p3Moved, p2Moved: p4Moved } = resolveOverlap(p3, p4, repulsionFactor);
    expect(p3Moved).toBe(false);
    expect(p4Moved).toBe(false);
  });

   it('Scenario 5: Overlap on Y axis', () => {
    const p1 = createParticle(0, 0, 0.5); // radius = 16
    const p2 = createParticle(0, 10, 0.5); // radius = 16. Sum = 32. Dist = 10. Overlap.
    
    const initialP1X = p1.x;
    const initialP1Y = p1.y;
    const initialP2X = p2.x;
    const initialP2Y = p2.y;

    const { p1Moved, p2Moved } = resolveOverlap(p1, p2, repulsionFactor);

    expect(p1Moved).toBe(true);
    expect(p2Moved).toBe(true);

    expect(p1.y).toBeLessThan(initialP1Y); // p1 moves up
    expect(p2.y).toBeGreaterThan(initialP2Y); // p2 moves down
    expect(p1.x).toBe(initialP1X); 
    expect(p2.x).toBe(initialP2X);
  });

  it('Scenario 6: Overlap on diagonal', () => {
    // p1 at (0,0), p2 at (7,7). scale 0.5 -> radius 16.
    // Distance = sqrt(7^2 + 7^2) = sqrt(49+49) = sqrt(98) approx 9.89
    // Sum of radii = 32. Overlap.
    const p1 = createParticle(0, 0, 0.5); 
    const p2 = createParticle(7, 7, 0.5); 
    
    const initialP1X = p1.x;
    const initialP1Y = p1.y;
    const initialP2X = p2.x;
    const initialP2Y = p2.y;

    const { p1Moved, p2Moved } = resolveOverlap(p1, p2, repulsionFactor);

    expect(p1Moved).toBe(true);
    expect(p2Moved).toBe(true);

    // p1 should move towards negative x and negative y
    expect(p1.x).toBeLessThan(initialP1X);
    expect(p1.y).toBeLessThan(initialP1Y);
    // p2 should move towards positive x and positive y
    expect(p2.x).toBeGreaterThan(initialP2X);
    expect(p2.y).toBeGreaterThan(initialP2Y);
  });
});
