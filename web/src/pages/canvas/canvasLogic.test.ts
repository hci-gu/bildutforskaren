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
  // Updated createParticle to match the Particle interface in utils.ts
  const createParticle = (id: string, x: number, y: number, scale: number, textureWidth: number = mockTextureWidth): Particle => ({
    id,
    x,
    y,
    scaleX: scale, 
    scaleY: scale,
    texture: { width: textureWidth, height: textureWidth }, // Assuming square textures for simplicity
  });

  it('Scenario 1: should move overlapping particles apart', () => {
    const p1 = createParticle("p1", 0, 0, 0.5); // radius = 0.5 * 64 / 2 = 16
    const p2 = createParticle("p2", 10, 0, 0.5); // radius = 16. Sum of radii = 32. Distance = 10. Overlap.
    
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
    const p1 = createParticle("p1", 0, 0, 0.1); // radius = 0.1 * 64 / 2 = 3.2
    const p2 = createParticle("p2", 10, 0, 0.1); // radius = 3.2. Sum of radii = 6.4. Distance = 10. No overlap.
    
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
    const p1 = createParticle("p1", 0, 0, 0.5); // radius = 16
    const p2 = createParticle("p2", 32, 0, 0.5); // radius = 16. Sum of radii = 32. Distance = 32. Touching.
    
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
    const p1 = createParticle("p1", 0, 0, 0.5);
    const p2 = createParticle("p2", 0, 0, 0.5);
        
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
    const p1: Particle = { id: "p1", x: 0, y: 0, scaleX: 0.5, scaleY: 0.5, texture: null as any };
    const p2: Particle = { id: "p2", x: 1, y: 1, scaleX: 0.5, scaleY: 0.5, texture: {width: 64, height: 64}};
    
    const { p1Moved, p2Moved } = resolveOverlap(p1, p2, repulsionFactor);
    expect(p1Moved).toBe(false);
    expect(p2Moved).toBe(false);

    const p3: Particle = { id: "p3", x: 0, y: 0, scaleX: 0.5, scaleY: 0.5, texture: {width: 64, height: 64}};
    const p4: Particle = { id: "p4", x: 1, y: 1, scaleX: 0.5, scaleY: 0.5, texture: null as any };
    const { p1Moved: p3Moved, p2Moved: p4Moved } = resolveOverlap(p3, p4, repulsionFactor);
    expect(p3Moved).toBe(false);
    expect(p4Moved).toBe(false);
  });

   it('Scenario 5: Overlap on Y axis', () => {
    const p1 = createParticle("p1", 0, 0, 0.5); // radius = 16
    const p2 = createParticle("p2", 0, 10, 0.5); // radius = 16. Sum = 32. Dist = 10. Overlap.
    
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
    const p1 = createParticle("p1", 0, 0, 0.5); 
    const p2 = createParticle("p2", 7, 7, 0.5); 
    
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

// Tests for performIterativeOverlapResolution
import { performIterativeOverlapResolution } from './utils';

describe('performIterativeOverlapResolution', () => {
  const mockTextureWidthIter = 64;
  const createParticleIter = (id: string, x: number, y: number, scale: number): Particle => ({
    id,
    x,
    y,
    scaleX: scale,
    scaleY: scale,
    texture: { width: mockTextureWidthIter, height: mockTextureWidthIter },
  });

  const calculateOverlapAmount = (p1: Particle, p2: Particle): number => {
    const r1 = (p1.scaleX * p1.texture.width) / 2;
    const r2 = (p2.scaleX * p2.texture.width) / 2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return Math.max(0, r1 + r2 - dist);
  };

  const totalOverlap = (particles: Particle[]): number => {
    let currentTotalOverlap = 0;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        currentTotalOverlap += calculateOverlapAmount(particles[i], particles[j]);
      }
    }
    return currentTotalOverlap;
  };


  it('Scenario 1: Basic Overlap Resolution - should reduce total overlap', () => {
    const particles: Particle[] = [
      createParticleIter("1", 0, 0, 0.5), // r=16
      createParticleIter("2", 10, 0, 0.5), // r=16. Overlap with 1
      createParticleIter("3", 0, 10, 0.5), // r=16. Overlap with 1
    ];
    const initialTotalOverlap = totalOverlap(particles);
    expect(initialTotalOverlap).toBeGreaterThan(0);

    const resolvedParticles = performIterativeOverlapResolution(particles, 50, 0.2, 0.1);
    const finalTotalOverlap = totalOverlap(resolvedParticles);
    
    expect(finalTotalOverlap).toBeLessThan(initialTotalOverlap);
    // Ideally, it should be close to 0 for simple cases with enough iterations
    expect(finalTotalOverlap).toBeLessThan(1); // Allowing for minor floating point inaccuracies
  });

  it('Scenario 2: MAX_ITERATIONS Limit - should run up to maxIterations if not stabilized', () => {
    // Create a scenario that is unlikely to stabilize quickly
    // e.g., many particles tightly packed.
    const particles: Particle[] = [];
    for(let i=0; i<10; i++) {
        particles.push(createParticleIter(String(i), Math.random()*5, Math.random()*5, 0.5));
    }
    
    // We can't directly spy on resolveOverlap easily without a spy framework like Jest/Vitest's jest.spyOn
    // So, we'll infer by checking that particles have moved, implying resolveOverlap was called.
    // And we'll trust the internal iteration counting of performIterativeOverlapResolution.
    // The function itself doesn't return iteration count.
    // For this test, we'll assume if it runs and modifies particles, it's respecting iterations.
    // A more robust test would require a spy or modifying the function to return iteration count.
    
    const initialPositions = particles.map(p => ({ x: p.x, y: p.y }));
    const resolvedParticles = performIterativeOverlapResolution(particles, 10, 0.1, 0.001); // Low stabilization threshold to force more iterations

    let moved = false;
    for(let i=0; i<resolvedParticles.length; i++) {
        if(resolvedParticles[i].x !== initialPositions[i].x || resolvedParticles[i].y !== initialPositions[i].y) {
            moved = true;
            break;
        }
    }
    expect(moved).toBe(true); // Check that particles actually moved, implying iterations happened.
  });


  it('Scenario 3: Stabilization - should terminate earlier than maxIterations', () => {
    const particles: Particle[] = [
      createParticleIter("1", 0, 0, 0.5),
      createParticleIter("2", 100, 0, 0.5), // Far apart, should stabilize in few iterations
    ];
    // To test stabilization, we'd ideally want to know how many iterations it ran.
    // Since the function doesn't return this, we can test that the state is stable.
    // For this, we run it, then run it again with 1 iteration and see if anything changes.
    
    const resolvedParticles1 = performIterativeOverlapResolution([...particles.map(p => ({...p}))], 100, 0.2, 0.1);
    const positionsAfterFirstRun = resolvedParticles1.map(p => ({x: p.x, y: p.y}));

    // Run again for a single iteration. If already stable, positions shouldn't change.
    const resolvedParticles2 = performIterativeOverlapResolution([...resolvedParticles1.map(p => ({...p}))], 1, 0.2, 0.1);
    
    for(let i=0; i<resolvedParticles2.length; i++) {
        expect(resolvedParticles2[i].x).toBeCloseTo(positionsAfterFirstRun[i].x);
        expect(resolvedParticles2[i].y).toBeCloseTo(positionsAfterFirstRun[i].y);
    }
    // This indirectly tests stabilization: if it was stable, 1 more iteration shouldn't change much.
    // A direct test of iteration count would require modifying the function or a more complex spy setup.
  });

  it('Scenario 4: No Overlaps Initially - positions should remain unchanged', () => {
    const particles: Particle[] = [
      createParticleIter("1", 0, 0, 0.1),   // r = 3.2
      createParticleIter("2", 100, 0, 0.1), // r = 3.2. Sum of radii = 6.4. Dist = 100.
      createParticleIter("3", 0, 100, 0.1),
    ];
    const initialPositions = particles.map(p => ({ x: p.x, y: p.y }));
    
    const resolvedParticles = performIterativeOverlapResolution(particles, 50, 0.2, 0.1);

    for (let i = 0; i < resolvedParticles.length; i++) {
      expect(resolvedParticles[i].x).toBe(initialPositions[i].x);
      expect(resolvedParticles[i].y).toBe(initialPositions[i].y);
    }
  });

  it('should handle an empty array of particles', () => {
    const particles: Particle[] = [];
    const resolvedParticles = performIterativeOverlapResolution(particles, 50, 0.2, 0.1);
    expect(resolvedParticles).toEqual([]);
  });
});
