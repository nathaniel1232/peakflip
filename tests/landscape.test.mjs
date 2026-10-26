import test from 'node:test';
import assert from 'node:assert/strict';
import { landscapeTrees, terrainHeight } from '../landscape.js';

test('terrain is finite, bounded, and flat across the full playable run', () => {
  for (const x of [-160, -75, -44, -19, 0, 19, 44, 75, 160]) {
    for (const z of [-50000, -37, 0, 91, 50000]) {
      const y = terrainHeight(x, z);
      assert.ok(Number.isFinite(y), `height at ${x}, ${z} is finite`);
      assert.ok(y >= 0 && y <= 110, `height at ${x}, ${z} stays bounded`);
    }
  }
  for (let x = -19; x <= 19; x += 0.5) {
    for (const z of [-1200, -1, 0, 947]) assert.equal(terrainHeight(x, z), 0);
  }
});

test('terrain crosses strip and ridge transitions continuously', () => {
  for (const boundary of [-132, -44, -38, -19, 19, 38, 44, 132]) {
    for (const z of [-420, 0, 730]) {
      const delta = Math.abs(terrainHeight(boundary - 0.01, z) - terrainHeight(boundary + 0.01, z));
      assert.ok(delta < 0.2, `no height seam at x=${boundary}, z=${z}: ${delta}`);
    }
  }
  for (const z of [-11000, -11, 0, 11000]) {
    const delta = Math.abs(terrainHeight(83, z - 0.01) - terrainHeight(83, z + 0.01));
    assert.ok(delta < 0.15, `no height seam around z=${z}: ${delta}`);
  }
});

test('foothills rise into broad, snow-ready slopes at both valley shoulders', () => {
  for (const x of [-44, 44]) {
    for (let z = -900; z <= 900; z += 90) {
      const height = terrainHeight(x, z);
      assert.ok(height >= 5 && height <= 10, `shoulder height ${height} at ${x}, ${z}`);
      const slope = Math.abs(terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2;
      assert.ok(slope < 0.08, `shoulder remains gently rolling at ${x}, ${z}`);
    }
  }
});

test('tree strips are deterministic, half-open, and compose without duplicates', () => {
  const allAtOnce = landscapeTrees(120, 80);
  assert.deepEqual(landscapeTrees(120, 80), allAtOnce);
  const strips = [
    ...landscapeTrees(56, 16),
    ...landscapeTrees(72, 16),
    ...landscapeTrees(88, 16),
    ...landscapeTrees(104, 16),
    ...landscapeTrees(120, 16),
  ].sort((a, b) => a.z - b.z || a.x - b.x);
  assert.deepEqual(strips, allAtOnce);
  for (const tree of allAtOnce) {
    assert.ok(tree.z > 40 && tree.z <= 120);
    assert.ok(Math.abs(tree.x) >= 23 && Math.abs(tree.x) <= 75);
    assert.ok(tree.scale >= 0.82 && tree.scale <= 1.65);
    assert.ok(tree.variant === 0 || tree.variant === 1);
  }
});

test('tree scatter has spacing, broad patch variation, and no repeated rows or mirror pairs', () => {
  const trees = landscapeTrees(360, 260);
  assert.ok(trees.length >= 35 && trees.length <= 220, `expected sensible density, got ${trees.length}`);
  let minDistance = Infinity;
  let mirroredPairs = 0;
  const zBins = new Map();
  const xGaps = [];
  const bySide = [[], []];
  for (const tree of trees) {
    const side = tree.x < 0 ? 0 : 1;
    bySide[side].push(tree);
    const bin = Math.floor(tree.z / 22);
    zBins.set(bin, (zBins.get(bin) ?? 0) + 1);
  }
  for (let i = 0; i < trees.length; i += 1) {
    for (let j = i + 1; j < trees.length; j += 1) {
      const dx = trees[i].x - trees[j].x;
      const dz = trees[i].z - trees[j].z;
      const distance = Math.hypot(dx, dz);
      if (distance < minDistance) minDistance = distance;
      if (trees[i].z === trees[j].z && trees[i].x === -trees[j].x) mirroredPairs += 1;
    }
  }
  assert.ok(minDistance >= 4, `minimum spacing should be 4m, got ${minDistance}`);
  assert.equal(mirroredPairs, 0);
  assert.ok(new Set(trees.map(tree => tree.z.toFixed(3))).size > trees.length * 0.7, 'z positions are irregular');

  for (const sideTrees of bySide) {
    const ordered = [...sideTrees].sort((a, b) => a.z - b.z);
    const gaps = ordered.slice(1).map((tree, i) => tree.z - ordered[i].z);
    xGaps.push(...gaps);
  }
  assert.ok(xGaps.some(gap => gap > 16), 'groves leave substantial clearings');
  assert.ok(xGaps.some(gap => gap < 8), 'groves contain local clusters');
  const binCounts = [...zBins.values()];
  assert.ok(Math.max(...binCounts) >= Math.min(...binCounts) + 3, 'grove density varies across broad patches');
});

test('forest scatter supports the wider, lower race-side range without changing heightfield', () => {
  const ordinary = landscapeTrees(90, 100, false);
  const forest = landscapeTrees(90, 100, true);
  assert.ok(forest.length > 0);
  assert.ok(forest.every(tree => Math.abs(tree.x) >= 15 && Math.abs(tree.x) <= 65));
  assert.ok(ordinary.every(tree => Math.abs(tree.x) >= 23 && Math.abs(tree.x) <= 75));
  assert.equal(terrainHeight(10, 90), 0);
  assert.deepEqual(landscapeTrees(10, 0), []);
});

test('long-course tree sections keep bounded, irregular scatter in both directions', () => {
  for (const zTop of [-12000, -4000, 0, 4000, 12000]) {
    const trees = landscapeTrees(zTop, 260);
    assert.ok(trees.length >= 20 && trees.length <= 220, `${zTop}: ${trees.length} trees`);
    assert.ok(trees.some(tree => tree.x < 0) && trees.some(tree => tree.x > 0), `${zTop}: both sides populated`);
    assert.ok(trees.every(tree => tree.z > zTop - 260 && tree.z <= zTop), `${zTop}: strip ownership`);
    assert.ok(new Set(trees.map(tree => tree.z.toFixed(3))).size > trees.length * 0.95, `${zTop}: no repeated rows`);
    const sorted = [...trees].sort((a, b) => a.z - b.z);
    const gaps = sorted.slice(1).map((tree, i) => tree.z - sorted[i].z);
    const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const variance = gaps.reduce((sum, gap) => sum + (gap - averageGap) ** 2, 0) / gaps.length;
    assert.ok(variance > 12, `${zTop}: z scatter does not settle into rows`);
    for (const tree of trees) {
      assert.ok(tree.scale <= 1.65);
      assert.ok(tree.variant === 0 || tree.variant === 1);
    }
  }
});

test('full-cell scatter has no 11m residual bands and keeps spacing across adjacent strips', () => {
  const stripTrees = [];
  for (let strip = 1; strip <= 65; strip += 1) {
    const top = strip * 4;
    const trees = landscapeTrees(top, 4);
    assert.deepEqual(landscapeTrees(top, 4), trees, `${top}: deterministic strip`);
    stripTrees.push(...trees);
  }
  assert.ok(stripTrees.length >= 30 && stripTrees.length <= 150, `${stripTrees.length} trees across 260m`);
  for (let i = 0; i < stripTrees.length; i += 1) {
    for (let j = i + 1; j < stripTrees.length; j += 1) {
      const distance = Math.hypot(stripTrees[i].x - stripTrees[j].x, stripTrees[i].z - stripTrees[j].z);
      assert.ok(distance >= 4.5, `minimum spacing across strips: ${distance}`);
    }
  }

  const longSample = landscapeTrees(12000, 2600);
  const xResidualBins = Array(8).fill(0);
  const zResidualBins = Array(8).fill(0);
  const cell = 8.5;
  for (const tree of longSample) {
    const xResidual = ((Math.abs(tree.x) - 23) % cell + cell) % cell;
    const zResidual = ((tree.z % cell) + cell) % cell;
    xResidualBins[Math.floor(xResidual / cell * 8)] += 1;
    zResidualBins[Math.floor(zResidual / cell * 8)] += 1;
  }
  for (const [axis, bins] of [['x', xResidualBins], ['z', zResidualBins]]) {
    for (const count of bins) {
      assert.ok(count > longSample.length * 0.05 && count < longSample.length * 0.2,
        `${axis} residuals spread across full cells: ${bins.join(',')}`);
    }
  }
});

// ---------- fair tree lines ----------
import { treeLine, ensurePassable, findLine, laneHalfWidth, maxHeading, runway, entryPoints } from '../landscape.js';

const mulberry = a => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// the same lane as game.js
const makeLane = rand => { const a = rand() * 6.28, b = rand() * 6.28; return z => Math.max(-10.5, Math.min(10.5, Math.sin(z * 0.02 + a) * 7 + Math.sin(z * 0.05 + b) * 2.5)); };
const toObstacles = t => [...t.trees.map(o => ({ kind: 'tree', x: o.x, z: o.z, r: 0.55 * o.s })), ...(t.rocks || []).map(o => ({ kind: 'rock', x: o.x, z: o.z, r: 1.0 * o.s }))];
function section(kind, seed, speed, d) {
  const rand = mulberry(seed * 7919 + Math.round(speed) * 31 + Math.round(d * 10)), laneX = makeLane(rand), z = -2000;
  const t = treeLine(kind, { rand, z, d, speed, laneX });
  const obstacles = toObstacles(t);
  const opts = { zTop: z, zBot: z - t.len, speed, laneX };
  const removed = ensurePassable(obstacles, opts);
  return { t, laneX, opts, before: obstacles.length, obstacles: obstacles.filter(o => !removed.includes(o)), removed };
}

// An independent rider written straight from updatePlayer in game.js (skis turn slower than a board, so they're
// the worst case): exact hitbox, 60 fps, and a search over left/straight/right taps every 0.1 s.
function riderGetsThrough(obstacles, { zTop, zBot, speed, laneX }, x0, xLimit = 13) {
  const H = 0.62 * Math.min(1, Math.max(0.55, 24 / speed)), dt = 1 / 60;
  const last = Math.min(zTop, ...obstacles.map(o => o.z - o.r - 0.5)), end = Math.max(zBot, last);
  const hit = (x, z) => obstacles.some(o => Math.abs(o.z - z) < o.r + 0.5 && Math.abs(o.x - x) < o.r + 0.32);
  const step = (s, pick) => {
    let { x, z, h } = s;
    for (let f = 0; f < 6; f += 1) {
      const inp = typeof pick === 'function' ? pick(x, z) : pick;
      let target = inp * H;
      if (Math.abs(x) > xLimit - 1.5 && Math.sign(x) === Math.sign(target || h)) target = -Math.sign(x) * 0.25;
      h += (target - h) * (1 - Math.exp(-(inp ? 7 : 8) * dt));
      x += Math.sin(h) * speed * dt; z -= Math.cos(h) * speed * dt;
      if (Math.abs(x) > xLimit) { x = Math.sign(x) * xLimit; h *= 0.5; }
      if (hit(x, z)) return null;
      if (z <= end) return { x, z, h, done: true };
    }
    return { x, z, h };
  };
  // ride along the lane (or parallel to it), else search
  for (const offset of [0, x0 - laneX(zTop)]) {
    let s = { x: x0, z: zTop, h: 0 };
    const chase = (x, z) => { const e = laneX(z - speed * 0.25) + offset - x; return Math.abs(e) < 0.4 ? 0 : Math.sign(e); };
    while (s && !s.done) s = step(s, chase);
    if (s?.done) return true;
  }
  let states = [{ x: x0, z: zTop, h: 0 }];
  while (states.length) {
    const next = new Map();
    for (const s of states) for (const inp of [-1, 0, 1]) {
      const n = step(s, inp);
      if (!n) continue;
      if (n.done) return true;
      const key = `${Math.round(n.x / 0.15)},${Math.round(n.h / 0.02)}`;
      if (!next.has(key)) next.set(key, n);
    }
    states = [...next.values()];
    if (states.length > 600) states = states.filter((_, i) => i % Math.ceil(states.length / 600) === 0);
  }
  return false;
}

const SPEEDS = [22, 35, 50, 66, 80, 95];   // Endless starts ~24 m/s and caps ~66 tucked; boosts go higher

test('every Endless tree line has a way through from anywhere on the slope, at every speed', () => {
  for (const kind of ['slalom', 'field', 'chute']) {
    for (const speed of SPEEDS) {
      for (const d of [0.3, 1.4]) {
        for (let seed = 1; seed <= 8; seed += 1) {
          const { obstacles, opts } = section(kind, seed, speed, d);
          for (const x0 of entryPoints()) {
            assert.ok(riderGetsThrough(obstacles, opts, x0), `${kind} seed ${seed} at ${speed} m/s, d=${d}: stuck entering at x=${x0}`);
          }
        }
      }
    }
  }
});

test('tree lines stay hard: the fairness pass only takes out a few trees', () => {
  for (const kind of ['field', 'chute', 'slalom']) {
    let before = 0, removed = 0;
    for (const speed of SPEEDS) for (let seed = 1; seed <= 6; seed += 1) {
      const s = section(kind, seed, speed, 1.4);
      before += s.before; removed += s.removed.length;
    }
    assert.ok(removed / before < 0.1, `${kind}: removed ${removed} of ${before}`);
  }
  const { t } = section('chute', 3, 66, 1.4);
  assert.ok(t.trees.length >= 30, `the chute still has walls (${t.trees.length} trees)`);
});

test('the safe gap widens with speed and nothing in a tree line sits inside it', () => {
  for (let v = 20; v < 100; v += 5) assert.ok(laneHalfWidth(v + 5) >= laneHalfWidth(v));
  assert.ok(laneHalfWidth(66) > laneHalfWidth(24) + 0.8);
  for (const kind of ['slalom', 'field', 'chute']) for (const speed of SPEEDS) for (let seed = 1; seed <= 6; seed += 1) {
    const rand = mulberry(seed * 131 + speed), laneX = makeLane(rand), t = treeLine(kind, { rand, z: -500, d: 1.4, speed, laneX });
    for (const o of toObstacles(t)) {
      // the gap is wide enough for the rider (hitbox ±0.32) with metres to spare
      assert.ok(Math.abs(o.x - laneX(o.z)) - o.r >= laneHalfWidth(speed) - 1e-9, `${kind} at ${speed}: obstacle inside the lane`);
      assert.ok(laneHalfWidth(speed) * 2 - 0.64 > 4.5);
    }
  }
});

test('nothing in a tree line appears too late to react to', () => {
  for (const kind of ['slalom', 'field', 'chute']) for (const speed of SPEEDS) for (let seed = 1; seed <= 6; seed += 1) {
    const rand = mulberry(seed * 977 + speed), t = treeLine(kind, { rand, z: -800, d: 1.4, speed, laneX: makeLane(rand) });
    for (const o of toObstacles(t)) assert.ok(o.z <= -800 - runway(speed) + 1e-9, `${kind} at ${speed}: something ${(-800 - o.z).toFixed(1)} m in`);
    assert.ok(runway(speed) >= speed * 0.35, 'at least a third of a second to react');
  }
});

test('the fairness check finds impossible sections and opens them up', () => {
  const opts = { zTop: 0, zBot: -60, speed: 60 };
  // a solid wall of trees right across the slope
  const wall = [];
  for (let x = -12; x <= 12; x += 2) wall.push({ kind: 'tree', x, z: -30, r: 0.55 });
  assert.equal(findLine(wall, opts, 0).ok, false);
  const removed = ensurePassable(wall, opts);
  const left = wall.filter(o => !removed.includes(o));
  assert.ok(removed.length > 0 && removed.length < wall.length * 0.6, `opened gaps with ${removed.length} of ${wall.length} trees`);
  for (const x0 of entryPoints()) assert.ok(riderGetsThrough(left, { ...opts, laneX: () => 0 }, x0));
  // a tree straight ahead too close to dodge at this speed gets taken out
  const late = [{ kind: 'tree', x: 0, z: -3, r: 0.55 }];
  assert.equal(findLine(late, opts, 0).ok, false);
  assert.equal(ensurePassable(late, opts).length, 1);
  // an open slope needs nothing removed
  assert.deepEqual(ensurePassable([], opts), []);
  // faster means less steering per metre, until the board/skis bottom out
  assert.ok(maxHeading(60) < maxHeading(25) && maxHeading(60, true) > maxHeading(60));
});
