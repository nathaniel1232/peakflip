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
