import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { PEAKFLIP_CONFIG: {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.location = { hostname: 'localhost' };

const { save, normalizeSave } = await import('../meta.js');
const { adopt, merge } = await import('../cloud.js');

function resetSave(values = {}) {
  for (const key of Object.keys(save)) delete save[key];
  Object.assign(save, { inv: {}, eq: {}, adProgress: {}, adCount: {}, missions: [], lbQueue: [], ...values });
  normalizeSave();
}

test('cloud adoption retains same-player best and merges unacknowledged best per board and day', () => {
  resetSave({ pid: 'player-a', name: 'Rider', best: 900, lbQueue: [
    { board: 'endless', day: '2026-10-26', value: 900, time: null },
    { board: 'racepts', day: '2026-10-26', value: 50, time: 9 },
  ] });

  adopt({ pid: 'player-a', name: 'Rider', best: 700, lbQueue: [
    { board: 'endless', day: '2026-10-26', value: 800, time: null },
    { board: 'racepts', day: '2026-10-26', value: 50, time: 4 },
    { board: 'endless', day: '2026-10-27', value: 10, time: null },
  ] }, 20);

  assert.equal(save.best, 900);
  assert.deepEqual(save.lbQueue, [
    { board: 'endless', day: '2026-10-26', value: 900, time: null },
    { board: 'racepts', day: '2026-10-26', value: 50, time: 4 },
    { board: 'endless', day: '2026-10-27', value: 10, time: null },
  ]);
});

test('adopting another player does not carry over the previous player queue', () => {
  resetSave({ pid: 'player-a', name: 'Rider', best: 900, lbQueue: [
    { board: 'endless', day: '2026-10-26', value: 900, time: null },
  ] });

  adopt({ pid: 'player-b', name: 'Skier', best: 100, lbQueue: [
    { board: 'endless', day: '2026-10-26', value: 100, time: null },
  ] }, 20);

  assert.equal(save.pid, 'player-b');
  assert.equal(save.best, 100);
  assert.deepEqual(save.lbQueue, [{ board: 'endless', day: '2026-10-26', value: 100, time: null }]);
});

test('merge combines same-player queues and keeps eligible incoming queue when adopting a named identity', () => {
  resetSave({ pid: 'player-a', name: 'Rider', best: 50, lbQueue: [
    { board: 'racepts', day: '2026-10-26', value: 10, time: 7 },
  ] });
  merge({ pid: 'player-a', name: 'Rider', best: 40, lbQueue: [
    { board: 'racepts', day: '2026-10-26', value: 12, time: 9 },
  ] });
  assert.equal(save.best, 50);
  assert.deepEqual(save.lbQueue, [{ board: 'racepts', day: '2026-10-26', value: 12, time: 9 }]);

  resetSave({ pid: 'fresh-device', name: '', best: 0, lbQueue: [
    { board: 'endless', day: '2026-10-26', value: 999, time: null },
  ] });
  merge({ pid: 'migrated-player', name: 'Rider', best: 30, lbQueue: [
    { board: 'endless', day: '2026-10-26', value: 30, time: null },
  ] });
  assert.equal(save.pid, 'migrated-player');
  assert.deepEqual(save.lbQueue, [{ board: 'endless', day: '2026-10-26', value: 30, time: null }]);
});
