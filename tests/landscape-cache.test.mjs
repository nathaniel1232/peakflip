import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { landscapeTrees, __landscapeTreeCacheStats, __resetLandscapeTreeCache } from '../landscape.js';

const treeHash = (...args) => createHash('sha256').update(JSON.stringify(landscapeTrees(...args))).digest('hex');

test('cached tree scatter matches the pre-cache output across ordinary and forest requests', () => {
  __resetLandscapeTreeCache();
  const fixtures = [
    [[120, 80, false], '93aa837219e590fac28daeb6d044cd919ad0ccd6378603d0db8ece8a225e9b26'],
    [[90, 100, true], '0d54c606ee7e57ecfa0b0a9dd80c659ecff62895a36aa7e2e046e8bf8c5d2d1b'],
    [[-7654, 512, false], '6ba728eb0cdab842ffaf6b38128ff3d55191aeb0e21fe3abaa6d8f7aa3c1b493'],
    [[12345, 2600, false], 'a10b0ca6f37d4ba48063e3f58bf2911e19bfd33531d2d61d064174722b81af8c'],
    [[-4200, 340, true], 'fb4f8eab3ace60fe68212c0c79a01455444ed7bfd22d0031e9927e2d0384d957'],
  ];
  for (const [args, expected] of fixtures) assert.equal(treeHash(...args), expected, `${args.join(', ')}`);

  const before = __landscapeTreeCacheStats();
  assert.ok(before.hits > 0, 'neighbor candidates are reused within and across requests');
  assert.ok(before.misses > 0);
  assert.ok(before.nullEntries > 0, 'candidate misses are cached as well as trees');

  const trees = landscapeTrees(100, 80);
  if (trees.length) {
    const original = trees[0].x;
    trees[0].x = 9999;
    assert.equal(landscapeTrees(100, 80)[0].x, original, 'returned trees do not expose cached candidates');
  }
});

test('tree candidate cache evicts old entries and stays within its fixed bound', () => {
  __resetLandscapeTreeCache();
  for (let z = -100000; z <= 100000; z += 4) landscapeTrees(z, 4, false);
  const stats = __landscapeTreeCacheStats();
  assert.equal(stats.limit, 4096);
  assert.ok(stats.evictions > 0, 'long streams evict old cells');
  assert.ok(stats.size <= stats.limit, `cache size ${stats.size} <= ${stats.limit}`);
});
