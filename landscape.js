// Deterministic alpine terrain and tree scatter. All coordinates are world-space.

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const smoothstep = (lo, hi, value) => {
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash2(ix, iz, seed = 0) {
  let n = Math.imul(ix | 0, 0x1f123bb5) ^ Math.imul(iz | 0, 0x5f356495) ^ Math.imul(seed | 0, 0x6c8e9cf5);
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

function valueNoise(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uz;
}

/** Smooth height field in meters. The playable center and its shoulder are flat. */
export function terrainHeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const ax = Math.abs(x);
  if (ax <= 19) return 0;

  // A shallow, wide transition keeps the runout clear of a sudden wall.
  const foothill = smoothstep(19, 44, ax);
  if (ax < 44) {
    const side = x < 0 ? 1 : 0;
    const roll = Math.sin(z * 0.017 + side * 1.7 + ax * 0.055) * 1.25
      + Math.sin(z * 0.0081 - ax * 0.031 + side * 2.4) * 0.9;
    return clamp(foothill * (7.3 + roll), 0, 11);
  }

  const side = x < 0 ? 1 : 0;
  const edgeProfile = 7.3
    + Math.sin(z * 0.017 + side * 1.7 + ax * 0.055) * 1.25
    + Math.sin(z * 0.0081 - ax * 0.031 + side * 2.4) * 0.9;
  const rise = smoothstep(38, 132, ax);
  const crossRidge = Math.sin(ax * 0.035 + z * 0.008 + side * 1.9);
  const longRidge = Math.sin(z * 0.0125 + ax * 0.006 + side * 2.7);
  const broad = valueNoise((ax + side * 37) / 78, (z + side * 91) / 145, 17 + side * 31) - 0.5;
  const mid = valueNoise((ax + side * 83) / 39, (z - side * 47) / 72, 43 + side * 13) - 0.5;

  // Two differently phased, low-frequency bands make wide ridges and open valleys.
  const mountain = 8
    + rise * (43 + 13 * longRidge + 10 * crossRidge + 18 * broad + 7 * mid)
    + 2.2 * Math.sin(z * 0.0043 + side * 2.2) * rise;
  const height = edgeProfile + (mountain - edgeProfile) * smoothstep(44, 64, ax);
  return clamp(height, 0, 104);
}

function groveDensity(x, z, side, forest) {
  // Broad coherent patches (roughly 100–250 m along the course), with a smaller
  // cross-slope component so clearings and groves do not form straight bands.
  const patch = valueNoise((x + side * 61) / 29, (z + side * 117) / 132, 101 + side * 37);
  const patch2 = valueNoise((x - side * 103) / 52, (z - side * 79) / 207, 211 + side * 19);
  const patchMix = patch * 0.67 + patch2 * 0.33;
  const base = forest ? 0.27 : 0.23;
  return clamp(base + (patchMix - 0.5) * 0.48, 0.04, forest ? 0.52 : 0.48);
}

function treeCandidate(ix, iz, sideIndex, inner, outer, cell, forest) {
  if (ix < 0) return null;
  const side = sideIndex === 0 ? 1 : -1;
  const seed = sideIndex * 7919;
  const xAbs = inner + (ix + hash2(ix, iz, seed + 43)) * cell;
  if (xAbs > outer) return null;
  const x = side * xAbs;
  const z = (iz + hash2(ix, iz, seed + 5)) * cell;
  if (hash2(ix, iz, seed + 61) > groveDensity(x, z, sideIndex, forest)) return null;

  // Favor moderate, gently rolling elevations while leaving ridge silhouettes open.
  const elevation = terrainHeight(x, z);
  const gx = (terrainHeight(x + 1.5, z) - terrainHeight(x - 1.5, z)) / 3;
  const gz = (terrainHeight(x, z + 1.5) - terrainHeight(x, z - 1.5)) / 3;
  if (elevation > (forest ? 63 : 57) || Math.hypot(gx, gz) > 0.48) return null;

  const priority = hash2(ix, iz, seed + 179);
  const size = hash2(ix, iz, seed + 83);
  return {
    x,
    z,
    scale: 0.82 + size * 0.83,
    rotation: hash2(ix, iz, seed + 107) * Math.PI * 2,
    variant: hash2(ix, iz, seed + 131) < 0.5 ? 0 : 1,
    _priority: priority,
  };
}

/**
 * Return deterministic trees whose world z lies in (zTop - depth, zTop].
 * Tree y is intentionally omitted; the caller can place it on its terrain mode.
 */
export function landscapeTrees(zTop, depth = 4, forest = false) {
  if (!Number.isFinite(zTop) || !Number.isFinite(depth) || depth <= 0) return [];
  const inner = forest ? 15 : 23;
  const outer = forest ? 65 : 75;
  const cell = 8.5;
  const zMin = zTop - depth;
  const firstZ = Math.floor(zMin / cell) - 1;
  const lastZ = Math.floor(zTop / cell) + 1;
  const xCount = Math.ceil((outer - inner) / cell);
  const trees = [];

  for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
    for (let iz = firstZ; iz <= lastZ; iz += 1) {
      for (let ix = 0; ix < xCount; ix += 1) {
        const candidate = treeCandidate(ix, iz, sideIndex, inner, outer, cell, forest);
        if (!candidate) continue;
        const { x, z } = candidate;
        if (!(z > zMin && z <= zTop)) continue;
        // Keep only deterministic local priority winners. Because candidate
        // positions are hashed over the entire cell, no cell bands survive.
        let winner = true;
        for (let dz = -1; dz <= 1 && winner; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dz === 0) continue;
            const neighbor = treeCandidate(ix + dx, iz + dz, sideIndex, inner, outer, cell, forest);
            if (!neighbor) continue;
            if (Math.hypot(candidate.x - neighbor.x, candidate.z - neighbor.z) < 4.5
              && (neighbor._priority < candidate._priority
                || (neighbor._priority === candidate._priority && (dz < 0 || (dz === 0 && dx < 0))))) {
              winner = false;
              break;
            }
          }
        }
        if (!winner) continue;
        delete candidate._priority;
        trees.push(candidate);
      }
    }
  }

  // Stable order makes results identical regardless of how strips are requested.
  trees.sort((a, b) => a.z - b.z || a.x - b.x);
  return trees;
}
