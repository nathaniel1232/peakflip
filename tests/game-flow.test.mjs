import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../game.js', import.meta.url), 'utf8');
// Exercise the production flow functions with the DOM and platform boundary stubbed.
function lessonHarness() {
  const elements = new Map();
  const visible = new Map();
  const save = {};
  const context = vm.createContext({
    CG: { build: false }, isTouch: false, save, state: 'play', p: { grounded: true, z: 0 },
    $: id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); },
    show: (id, on) => visible.set(id, on), persist: () => {},
  });
  const block = source.slice(source.indexOf('let replayLesson = false;'), source.indexOf('// ---------- Endless stages:'));
  vm.runInContext(block + '\nlesson.active = true; this.update = updateLesson;', context);
  return { context, elements, visible, save };
}

test('lesson only celebrates a grab after landing, then saves completion', () => {
  const h = lessonHarness();
  h.context.update(0);
  assert.match(h.elements.get('lessonStep').textContent, /1 \/ 3/);
  h.context.p.grounded = false;
  h.context.p.trick = { grabTotal: 0 };
  h.context.update(1 / 60);
  assert.match(h.elements.get('lessonTitle').textContent, /Hold G/);
  h.context.p.trick.grabTotal = 0.4;
  h.context.update(1 / 60);
  assert.match(h.elements.get('lessonStep').textContent, /3 \/ 3/);
  assert.equal(h.save.lessonSeen, undefined);
  h.context.p.grounded = true;
  h.context.p.trick = null;
  h.context.update(1 / 60);
  assert.equal(h.elements.get('lessonStep').textContent, 'NICE LANDING');
  h.context.update(3);
  assert.equal(h.save.lessonSeen, true);
  assert.equal(h.visible.get('lesson'), false);
});

test('missed grab offers another attempt and Skip immediately hides the lesson', () => {
  const h = lessonHarness();
  h.context.p.grounded = false;
  h.context.update(1);
  h.context.p.grounded = true;
  h.context.update(1);
  assert.match(h.elements.get('lessonStep').textContent, /NEXT JUMP/);
  assert.equal(h.save.lessonSeen, undefined);
  h.elements.get('skipLesson').onclick();
  assert.equal(h.visible.get('lesson'), false);
  assert.equal(h.save.lessonSeen, true);
});

test('SDK receives gameplay start when a player starts before initialization finishes', async () => {
  let finishInit;
  const events = [];
  const CG = { sdk: { game: { loadingStop: () => events.push('loaded'), gameplayStart: () => events.push('start'), gameplayStop: () => events.push('stop') } }, init: () => new Promise(resolve => { finishInit = resolve; }) };
  const context = vm.createContext({ CG, Ads: {}, ADS_ENABLED: true });
  vm.runInContext(source.slice(source.indexOf('const Platform = {'), source.indexOf('// ---------- audio')) + '\nthis.platform = Platform;', context);
  const pending = context.platform.init();
  context.platform.gameplayStart();
  assert.deepEqual(events, []);
  finishInit(); await pending;
  assert.deepEqual(events, ['loaded', 'start']);
  context.platform.gameplayStop();
  assert.deepEqual(events, ['loaded', 'start', 'stop']);
});

test('SDK initialization does not report playing if the player paused during loading', async () => {
  let finishInit;
  const events = [];
  const CG = { sdk: { game: { gameplayStart: () => events.push('start') } }, init: () => new Promise(resolve => { finishInit = resolve; }) };
  const context = vm.createContext({ CG, Ads: {}, ADS_ENABLED: true });
  vm.runInContext(source.slice(source.indexOf('const Platform = {'), source.indexOf('// ---------- audio')) + '\nthis.platform = Platform;', context);
  const pending = context.platform.init();
  context.platform.gameplayStart(); context.platform.gameplayStop();
  finishInit(); await pending;
  assert.deepEqual(events, []);
});
