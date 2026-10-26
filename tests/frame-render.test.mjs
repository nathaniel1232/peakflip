import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { FixedClock } from '../game-clock.js';
const source = readFileSync(new URL('../game.js', import.meta.url), 'utf8');
function harness() {
  const counts = { ticks: 0, renders: 0, rear: 0, flush: 0, samples: [] };
  const context = vm.createContext({
    performance: { now: () => 0 }, FixedClock, requestAnimationFrame() {},
    paused: false, document: { hidden: false }, state: 'play', demo: false,
    mode: 'endless', p: {}, Quality: { sample: ms => counts.samples.push(ms) },
    simulate: () => counts.ticks++, allPools: [{ flush: () => counts.flush++ }],
    renderer: { render: () => counts.renders++ }, scene: {}, camera: {},
    renderRearView: () => counts.rear++,
  });
  vm.runInContext(source.slice(source.indexOf('let last = performance.now();'), source.indexOf('function simulate(dt)')) + '\nthis.run = frame;', context);
  return { context, counts };
}
test('draws only new simulation states on 30, 60, 144 and 165 Hz displays', () => {
  for (const hz of [30, 60, 144, 165]) {
    const { context, counts } = harness();
    for (let i = 1; i <= hz * 10; i++) context.run(i * 1000 / hz);
    assert.equal(counts.ticks, 600, `${hz} Hz physics`);
    assert.equal(counts.renders, Math.min(hz, 60) * 10, `${hz} Hz draws`);
    assert.equal(counts.flush, counts.renders);
    assert.equal(counts.rear, counts.renders);
    assert.ok(Math.abs(counts.samples.reduce((a, b) => a + b, 0) - 10000) < 0.001);
  }
});
test('paused and background tabs do no work and resume without a catch-up burst', () => {
  const { context, counts } = harness();
  context.paused = true; context.run(30000);
  context.paused = false; context.document.hidden = true; context.run(60000);
  assert.equal(counts.ticks, 0); assert.equal(counts.renders, 0);
  context.document.hidden = false; context.run(60000 + 1000 / 60);
  assert.equal(counts.ticks, 1); assert.equal(counts.renders, 1);
  assert.ok(counts.samples[0] < 17);
});
