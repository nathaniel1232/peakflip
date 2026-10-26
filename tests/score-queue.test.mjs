import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../ui.js', import.meta.url), 'utf8');
const queueSource = source.slice(source.indexOf('const better ='), source.indexOf('LB.register ='));

function harness({ submit, name = 'Rider', best = 0 } = {}) {
  const save = { name, best, pid: 'test-player', lbQueue: [] };
  const calls = [];
  let persistCount = 0;
  const LB = {
    submit: async (...args) => { calls.push(args); return submit ? submit(...args, calls.length) : { ok: true }; },
    register: async () => { calls.push(['register']); return { ok: true }; },
  };
  const today = () => '2026-10-26';
  const factory = new Function('save', 'persist', 'today', 'LB', 'miniCache', 'refreshLeader', 'lbArgs',
    `${queueSource}\nreturn { queueScore, flushScores, submitRun, get raceGhost() { return raceGhost; } };`);
  const q = factory(save, () => { persistCount++; }, today, LB, {}, () => {}, r => ({ board: 'endless', value: r.score }));
  return { ...q, save, calls, get persistCount() { return persistCount; } };
}

test('retains scores rejected by the server and retries them later', async () => {
  let reject = true;
  const h = harness({ submit: async () => reject ? { ok: false } : { ok: true } });
  h.queueScore({ board: 'endless', day: '2026-10-26', value: 3_000_000, time: null });
  await h.flushScores();
  assert.equal(h.save.lbQueue.length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'register').length, 1);
  reject = false;
  await h.flushScores();
  assert.equal(h.save.lbQueue.length, 0);
});

test('retains scores through network failure', async () => {
  const h = harness({ submit: async () => null });
  h.queueScore({ board: 'endless', day: '2026-10-26', value: 25, time: null });
  await h.flushScores();
  assert.equal(h.save.lbQueue.length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'register').length, 0);
});

test('registers an unregistered name then removes only after accepted retry', async () => {
  const h = harness({ submit: async (_board, _score, _day, _time, _ghost, count) => count === 1 ? { ok: false } : { ok: true } });
  h.queueScore({ board: 'endless', day: '2026-10-26', value: 100, time: null });
  await h.flushScores();
  assert.equal(h.calls.filter(c => c[0] === 'register').length, 1);
  assert.equal(h.calls.filter(c => c[0] !== 'register').length, 2);
  assert.equal(h.save.lbQueue.length, 0);
});

test('keeps a better score queued during an in-flight submission', async () => {
  let release;
  const h = harness({ submit: () => new Promise(resolve => { release = resolve; }) });
  h.queueScore({ board: 'endless', day: '2026-10-26', value: 100, time: null });
  const pending = h.flushScores();
  await new Promise(resolve => setImmediate(resolve));
  h.queueScore({ board: 'endless', day: '2026-10-26', value: 200, time: null });
  release({ ok: true });
  await new Promise(resolve => setImmediate(resolve));
  release({ ok: true });
  await pending;
  assert.equal(h.save.lbQueue.length, 0);
  assert.deepEqual(h.calls.filter(c => c[0] !== 'register').map(c => c[1]), [100, 200]);
});

test('resends a legitimate best score at exactly 3,000,000', async () => {
  const start = source.indexOf('async function resendBigBest()');
  const end = source.indexOf('\nLB.register =', start);
  const functionSource = source.slice(start, end);
  const save = { name: 'Rider', best: 3_000_000, bigBestSent: null };
  let submitted;
  const resend = new Function('save', 'LB', 'today', 'persist', 'miniCache',
    `${functionSource}\nreturn resendBigBest;`)(save, { get: async () => ({ me: null }), submit: async (...args) => { submitted = args; return { ok: true }; } }, () => '2026-10-26', () => {}, {});
  await resend();
  assert.equal(submitted[1], 3_000_000);
  assert.equal(save.bigBestSent, 3_000_000);
});


test('rejected submission is not reported as a saved leaderboard record', async () => {
  const h = harness({ submit: async () => ({ ok: false }) });
  assert.equal(await h.submitRun({ score: 3_049_725 }), false);
  assert.equal(h.save.lbQueue[0].value, 3_049_725);
});

test('one rejected run does not prevent other valid queued runs from syncing', async () => {
  const h = harness({ submit: async board => ({ ok: board === 'endless' }) });
  h.queueScore({ board: 'racepts', day: '2026-10-26', value: 100, time: 10 });
  h.queueScore({ board: 'endless', day: '2026-10-26', value: 3_049_725 });
  await h.flushScores();
  assert.equal(h.save.lbQueue.length, 1);
  assert.equal(h.save.lbQueue[0].board, 'racepts');
  assert.ok(h.calls.some(c => c[0] === 'endless' && c[1] === 3_049_725));
});


test('a recovered lifetime best is acknowledged without inventing a new daily score', async () => {
  const start = source.indexOf('async function resendBigBest()');
  const end = source.indexOf('\nLB.register =', start);
  const save = { name: 'Rider', best: 3_049_725 };
  let submitted = false;
  const LB = { get: async () => ({ me: { value: 3_049_725 } }), submit: async () => { submitted = true; } };
  const resend = new Function('save', 'LB', 'today', 'persist', 'miniCache',
    `${source.slice(start, end)}\nreturn resendBigBest;`)(save, LB, () => '2026-10-26', () => {}, {});
  await resend();
  assert.equal(submitted, false);
  assert.equal(save.bigBestSent, 3_049_725);
});
