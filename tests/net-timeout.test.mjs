import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../net.js', import.meta.url), 'utf8')).replace('export async function', 'async function');
function harness(fetch) {
  const timers = new Map();
  const rpc = new Function('window', 'fetch', 'setTimeout', 'clearTimeout', `${source}; return rpc;`)(
    { PEAKFLIP_CONFIG: { supabaseUrl: 'https://example.test', supabaseKey: 'test-public-key' } }, fetch,
    (fn, ms) => { timers.set(1, { fn, ms }); return 1; }, id => timers.delete(id));
  return { rpc, timers };
}

test('a stalled request aborts at its deadline so the score queue can retry', async () => {
  const h = harness((_url, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const pending = h.rpc('submit_score_v2', {}, true, { timeoutMs: 8000 });
  assert.equal(h.timers.get(1).ms, 8000);
  h.timers.get(1).fn();
  await assert.rejects(pending, /aborted/);
  assert.equal(h.timers.size, 0);
});

test('the deadline includes a response whose body never finishes downloading', async () => {
  const h = harness(async (_url, options) => ({ ok: true, json: () => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('body aborted')));
  }) }));
  const pending = h.rpc('get_leaderboard_v2', {});
  await new Promise(resolve => setImmediate(resolve));
  h.timers.get(1).fn();
  await assert.rejects(pending, /body aborted/);
  assert.equal(h.timers.size, 0);
});

test('successful requests retain keepalive and cancel their deadline', async () => {
  let request;
  const h = harness(async (_url, options) => { request = options; return { ok: true, json: async () => ({ ok: true }) }; });
  assert.deepEqual(await h.rpc('submit_score_v2', { p_value: 3049725 }, true), { ok: true });
  assert.equal(request.keepalive, true);
  assert.equal(JSON.parse(request.body).p_value, 3049725);
  assert.equal(h.timers.size, 0);
});
