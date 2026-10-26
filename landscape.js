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

const TREE_CANDIDATE_CACHE_LIMIT = 4096;
const treeCandidateCache = new Map();
const treeCandidateCacheStats = { hits: 0, misses: 0, evictions: 0 };

/** Internal cache diagnostics for deterministic regression tests. */
export function __landscapeTreeCacheStats() {
  let nullEntries = 0;
  for (const candidate of treeCandidateCache.values()) if (candidate === null) nullEntries += 1;
  return { ...treeCandidateCacheStats, size: treeCandidateCache.size, nullEntries, limit: TREE_CANDIDATE_CACHE_LIMIT };
}

/** Reset the bounded candidate cache between deterministic tests/measurements. */
export function __resetLandscapeTreeCache() {
  treeCandidateCache.clear();
  treeCandidateCacheStats.hits = 0;
  treeCandidateCacheStats.misses = 0;
  treeCandidateCacheStats.evictions = 0;
}

function treeCandidate(ix, iz, sideIndex, inner, outer, cell, forest) {
  // ix only ranges from -1 through 7 (including neighbor checks), so a 64-slot
  // integer stride keeps forest, side, and x-cell identities distinct without
  // allocating a string for every candidate lookup.
  const key = iz * 64 + (forest ? 32 : 0) + sideIndex * 16 + ix + 1;
  const cached = treeCandidateCache.get(key);
  if (cached !== undefined) {
    treeCandidateCacheStats.hits += 1;
    return cached;
  }
  treeCandidateCacheStats.misses += 1;

  if (ix < 0) return cacheTreeCandidate(key, null);
  const side = sideIndex === 0 ? 1 : -1;
  const seed = sideIndex * 7919;
  const xAbs = inner + (ix + hash2(ix, iz, seed + 43)) * cell;
  if (xAbs > outer) return cacheTreeCandidate(key, null);
  const x = side * xAbs;
  const z = (iz + hash2(ix, iz, seed + 5)) * cell;
  if (hash2(ix, iz, seed + 61) > groveDensity(x, z, sideIndex, forest)) return cacheTreeCandidate(key, null);

  // Favor moderate, gently rolling elevations while leaving ridge silhouettes open.
  const elevation = terrainHeight(x, z);
  const gx = (terrainHeight(x + 1.5, z) - terrainHeight(x - 1.5, z)) / 3;
  const gz = (terrainHeight(x, z + 1.5) - terrainHeight(x, z - 1.5)) / 3;
  if (elevation > (forest ? 63 : 57) || Math.hypot(gx, gz) > 0.48) return cacheTreeCandidate(key, null);

  const priority = hash2(ix, iz, seed + 179);
  const size = hash2(ix, iz, seed + 83);
  const candidate = {
    x,
    z,
    scale: 0.82 + size * 0.83,
    rotation: hash2(ix, iz, seed + 107) * Math.PI * 2,
    variant: hash2(ix, iz, seed + 131) < 0.5 ? 0 : 1,
    _priority: priority,
  };
  return cacheTreeCandidate(key, candidate);
}

function cacheTreeCandidate(key, candidate) {
  if (treeCandidateCache.size >= TREE_CANDIDATE_CACHE_LIMIT) {
    treeCandidateCache.delete(treeCandidateCache.keys().next().value);
    treeCandidateCacheStats.evictions += 1;
  }
  treeCandidateCache.set(key, candidate);
  return candidate;
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
        // Cached candidates retain their priority for neighbor checks. Return a
        // fresh public object so consumers cannot mutate the cached tree.
        const { _priority, ...tree } = candidate;
        trees.push(tree);
      }
    }
  }

  // Stable order makes results identical regardless of how strips are requested.
  trees.sort((a, b) => a.z - b.z || a.x - b.x);
  return trees;
}

// ---------- fair tree lines (Endless) ----------
// Endless keeps getting faster, so every tree line is checked against the rider's real carving at the speed
// they'll be going: from anywhere across the slope there's a way through, nothing sits too close to react to,
// and whatever would make a section impossible is taken out. Hard is fine; unfair isn't.

export const RIDER_HALF = 0.32, RIDER_REACH = 0.5;   // the collision box in game.js: |dx| < r + 0.32, |dz| < r + 0.5
/** The steepest heading (radians off the fall line) skis or a board can hold at this speed. */
export const maxHeading = (speed, board = false) =>
  board ? 0.72 * clamp(26 / speed, 0.6, 1) : 0.62 * clamp(24 / speed, 0.55, 1);
/** How quickly the heading follows the stick, per second. */
export const steerRate = (board, steering) => board ? (steering ? 10 : 9) : (steering ? 7 : 8);
/** Half-width of the safe lane that hazards never fill: wider the faster you go. */
export const laneHalfWidth = speed => clamp(2.8 + (speed - 30) * 0.03, 2.8, 4.2);

// The check is deliberately stricter than the game: a little extra room around every obstacle, only 85% of the
// carve, a moment of riding straight before you react, and skis (which turn slower than a board).
export const FAIR = { margin: 0.2, grip: 0.85, react: 0.2, hold: 0.15, step: 0.6, cellX: 0.3, cellH: 0.04, beam: 240 };
const STATIC = o => o && Number.isFinite(o.x) && Number.isFinite(o.z) && Number.isFinite(o.r);

function bucketed(obstacles) {
  const map = new Map();
  for (const o of obstacles) {
    const k = Math.floor(o.z / 2);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(o);
  }
  return (x, z) => {
    const k = Math.floor(z / 2);
    for (let b = k - 2; b <= k + 2; b += 1) {
      const list = map.get(b);
      if (!list) continue;
      for (const o of list) {
        if (Math.abs(o.z - z) < o.r + RIDER_REACH + FAIR.margin && Math.abs(o.x - x) < o.r + RIDER_HALF + FAIR.margin) return o;
      }
    }
    return null;
  };
}

/**
 * Can a rider entering at (x0, zTop), riding straight, get past zBot with the game's carving at `speed`?
 * First tries following the safe lane (`laneX`, if given) and riding straight, then searches every
 * left/straight/right sequence (each held FAIR.hold seconds), so a "yes" always means a real line exists.
 * On a "no", `blocker` is the obstacle that stopped the run that got furthest.
 */
export function findLine(obstacles, { zTop, zBot, xLimit = 13, speed, board = false, laneX = null }, x0) {
  const hitAt = bucketed(obstacles);
  const top = maxHeading(speed, board) * FAIR.grip, dt = Math.min(1 / 30, FAIR.step / speed);
  // past the last obstacle there's nothing left to hit
  let last = zTop;
  for (const o of obstacles) last = Math.min(last, o.z - o.r - RIDER_REACH - FAIR.margin);
  const end = Math.max(zBot, last);
  let deepest = null;
  const ride = (s, control, seconds) => {
    let { x, z, h } = s;
    const kOn = 1 - Math.exp(-steerRate(board, true) * dt), kOff = 1 - Math.exp(-steerRate(board, false) * dt);
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      const input = typeof control === 'function' ? control(x, z) : control;
      let target = input * top;
      // game.js pushes you back in near the course edge
      if (Math.abs(x) > xLimit - 1.5 && Math.sign(x) === Math.sign(target || h)) target = -Math.sign(x) * 0.25;
      h += (target - h) * (input ? kOn : kOff);
      x += Math.sin(h) * speed * dt;
      z -= Math.cos(h) * speed * dt;
      if (Math.abs(x) > xLimit) { x = Math.sign(x) * xLimit; h *= 0.5; }
      const hit = hitAt(x, z);
      if (hit) { if (!deepest || z < deepest.z) deepest = { z, o: hit }; return null; }
      if (z <= end) return { x, z, h, done: true };
    }
    return { x, z, h };
  };
  const first = ride({ x: x0, z: zTop, h: 0 }, 0, FAIR.react);
  if (!first) return { ok: false, blocker: deepest.o };
  if (first.done) return { ok: true };
  // quick tries: chase the safe lane like a player would (tap left/right), or just ride straight
  const forever = (zTop - zBot) / (speed * 0.5) + 1;
  if (laneX) {
    // into the lane, or alongside it at the distance you came in at (outside a chute's wall)
    const lead = speed * 0.25;
    for (const offset of [0, first.x - laneX(first.z)]) {
      const chase = (x, z) => { const e = laneX(z - lead) + offset - x; return Math.abs(e) < 0.4 ? 0 : Math.sign(e); };
      if (ride(first, chase, forever)?.done) return { ok: true };
    }
  }
  if (ride(first, 0, forever)?.done) return { ok: true };
  let states = [first];
  while (states.length) {
    const next = new Map();
    for (const s of states) {
      for (const input of [-1, 0, 1]) {
        const n = ride(s, input, FAIR.hold);
        if (!n) continue;
        if (n.done) return { ok: true };
        const key = `${Math.round(n.x / FAIR.cellX)},${Math.round(n.h / FAIR.cellH)}`;
        const had = next.get(key);
        if (!had || n.z < had.z) next.set(key, n);
      }
    }
    // keep the search bounded; every state kept is one a rider can really reach, so a "yes" stays a real line
    states = [...next.values()];
    if (states.length > FAIR.beam) states = states.filter((_, i) => i % Math.ceil(states.length / FAIR.beam) === 0);
  }
  return { ok: false, blocker: deepest?.o ?? null };
}

/** Entry points checked across the slope, 1 m apart. */
export const entryPoints = (xLimit = 13) => {
  const xs = [];
  for (let x = -xLimit + 0.5; x <= xLimit - 0.5 + 1e-9; x += 1) xs.push(x);
  return xs;
};

/**
 * Make sure every entry point has a line through [zBot, zTop]: whatever stops the furthest run is removed
 * (through `remove`, so the game can take it out of the world) until one gets through. Returns what was removed.
 */
export function ensurePassable(obstacles, opts, remove = () => {}) {
  const live = obstacles.filter(o => STATIC(o) && o.z < opts.zTop + 3 && o.z > opts.zBot - 3);
  const removed = [];
  for (const x0 of entryPoints(opts.xLimit)) {
    for (let guard = 0; guard < 400; guard += 1) {
      const res = findLine(live, opts, x0);
      if (res.ok) break;
      const o = res.blocker;
      if (!o) break;   // nothing in the way (can't happen with static obstacles, but never loop forever)
      live.splice(live.indexOf(o), 1);
      removed.push(o);
      remove(o);
    }
  }
  return removed;
}

/** Room to react before the first tree of a section: a third of a second plus a few metres. */
export const runway = speed => 4 + speed * 0.35;

/**
 * Pure layouts for Endless's tree features. `rand` returns [0, 1), `laneX(z)` is the safe lane, `speed` is how fast
 * the rider will be going there. Trees come back as { x, z, s } (radius 0.55 s, like game.js), already kept out of
 * the speed-scaled safe lane; the caller adds them and then runs ensurePassable over the finished section.
 */
export function treeLine(kind, { rand, z, d, speed, laneX, xLimit = 13 }) {
  const wr = (a, b) => a + rand() * (b - a);
  const lane = laneHalfWidth(speed), top = z - runway(speed);
  const trees = [], coins = [];
  const tree = (x, zz, s) => {
    if (Math.abs(x) > xLimit - 0.5) x = Math.sign(x) * (xLimit - 0.5);
    if (Math.abs(x - laneX(zz)) < lane + 0.55 * s) return;
    trees.push({ x, z: zz, s });
  };
  if (kind === 'slalom') {
    const n = 4 + Math.floor(d * 7), gapZ = Math.max(9, speed * 0.16);
    for (let i = 0; i < n; i += 1) tree((i % 2 ? 1 : -1) * wr(1.5, 9), top - i * gapZ, wr(0.8, 1.1));
    for (let i = 0; i < n; i += 1) coins.push({ x: Math.sin(i * 1.2) * 3, y: 1.2, z: top - i * gapZ - gapZ / 2 });
    return { trees, coins, len: z - top + n * gapZ + 18, gx: 0 };
  }
  if (kind === 'field') {
    const n = 10 + Math.floor(d * 16), rocks = [];
    for (let i = 0; i < n; i += 1) {
      const zz = top - wr(0, 60);
      if (rand() < 0.5) {
        const x = wr(-12, 12), s = wr(0.7, 1.2);
        if (Math.abs(x - laneX(zz)) >= lane + s) rocks.push({ x, z: zz, s });   // rocks are 1.0 s wide
      } else tree(wr(-12, 12), zz, wr(0.8, 1.1));
    }
    return { trees, rocks, coins, len: z - top + 70, gx: 0 };
  }
  if (kind === 'chute') {
    // a narrow corridor of trees along the safe lane: narrower deeper in, but never narrower than the lane at speed
    const L = Math.round(70 + Math.min(d, 1.3) * 40);
    const gap = Math.max(4.3 - Math.min(0.5, d * 0.35), lane + 0.75);
    for (let zz = top; zz > top - L; zz -= 4.5) {
      const c = laneX(zz);
      for (const side of [-1, 1]) {
        const x = c + side * (gap + wr(0, 0.5));
        // an outside wall this close to the course edge would pin anyone riding outside it: leave it open
        if (Math.abs(x) > xLimit - 2.4) continue;
        tree(x, zz, wr(0.85, 1.05));
      }
    }
    for (let zz = top - 4; zz > top - L + 4; zz -= 6) coins.push({ x: laneX(zz), y: 1.2, z: zz });
    return { trees, coins, len: z - top + L + 26, gx: laneX(z), chute: { zTop: top, zBot: top - L } };
  }
  throw new Error(`unknown tree line: ${kind}`);
}
