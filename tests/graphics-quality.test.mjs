import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
function quality(dpr) {
  const calls = [];
  const context = vm.createContext({ window: { devicePixelRatio: dpr }, innerWidth: 1000, innerHeight: 800,
    renderer: { setPixelRatio: r => calls.push(r), setSize() {} } });
  vm.runInContext(source.slice(source.indexOf('const Quality = {'), source.indexOf('Quality.apply();')) + '\nthis.quality = Quality;', context);
  context.quality.apply();
  return { q: context.quality, calls };
}
test('graphics are always full quality: anti-aliased and sharp up to 2x', () => {
  assert.match(source, /new THREE\.WebGLRenderer\(\{ antialias: true/);
  assert.equal(quality(1).q.ratio, 1);
  assert.equal(quality(2).q.ratio, 2);
  assert.equal(quality(3).calls[0], 2);
});
test('there is no low quality mode left to pick', () => {
  assert.doesNotMatch(source, /\bLITE\b|\bLOW\b|save\.quality/);
  assert.doesNotMatch(ui, /Graphics|data-q=/);
  assert.equal(typeof quality(2).q.sample, 'undefined');
});
