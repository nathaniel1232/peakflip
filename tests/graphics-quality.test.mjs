import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../game.js', import.meta.url), 'utf8');
function quality({ quality = 'auto', weak = false, touch = false } = {}) {
  const context = vm.createContext({ LOW: quality === 'low', LITE: quality === 'low' || (quality !== 'high' && weak), WEAK: weak,
    save: { quality }, isTouch: touch, window: { devicePixelRatio: 3 }, innerWidth: 1000, innerHeight: 800,
    renderer: { setPixelRatio() {}, setSize() {} } });
  vm.runInContext(source.slice(source.indexOf('const Quality = {'), source.indexOf('Quality.apply();')) + '\nthis.quality = Quality;', context);
  return context.quality;
}
const windowAt = (q, fps) => { for (let i = 0; i < Math.ceil(fps * 1.5); i++) q.sample(1000 / fps); };
test('automatic graphics reserve pixel headroom and High preserves its sharper cap', () => {
  assert.equal(quality().max, 1.5);
  assert.equal(quality({ touch: true }).max, 1.25);
  assert.equal(quality({ weak: true }).max, 1);
  assert.equal(quality({ quality: 'high' }).max, 1.75);
});
test('graphics respond to sustained missed frames and recover only after consecutive smooth windows', () => {
  const q = quality();
  windowAt(q, 50); assert.equal(q.ratio, 1.35);
  windowAt(q, 60); windowAt(q, 60); assert.equal(q.ratio, 1.35);
  windowAt(q, 56); assert.equal(q.good, 0);
  windowAt(q, 60); windowAt(q, 60); assert.equal(q.ratio, 1.35);
  windowAt(q, 60); assert.equal(q.ratio, 1.45);
});
