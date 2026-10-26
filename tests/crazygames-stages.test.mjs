import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const stages = source.slice(source.indexOf('const STAGE_LEN ='), source.indexOf('// ---------- game flow'));
function stageHarness(build, mode = 'endless', demo = false) {
  const effects = [];
  const p = { stage: 1, trickScore: 0 };
  const context = vm.createContext({
    CG: { build }, mode, demo, p,
    special: () => false,
    setTheme: theme => effects.push(theme), fadeScreen: () => effects.push('flash'),
    showTrick: label => effects.push(label), Sfx: { perfect() {}, tone() {} },
  });
  vm.runInContext(stages + '\nthis.up = stageUp; this.solid = solidRocks; this.enabled = stagesEnabled;', context);
  return { context, p, effects };
}

test('CrazyGames has no stage bonuses, flashes, lighting transitions, or solid-rock switch', () => {
  const h = stageHarness(true);
  assert.equal(h.context.enabled(), false);
  for (const n of [2, 3, 4, 10]) h.context.up(n);
  assert.deepEqual(h.p, { stage: 1, trickScore: 0 });
  assert.deepEqual(h.effects, []);
  h.p.stage = 4;
  assert.equal(h.context.solid(), false);
});

test('self-hosted Endless keeps its stage rewards, themes, and stage-four rock behavior', () => {
  const h = stageHarness(false);
  assert.equal(h.context.enabled(), true);
  h.context.up(2);
  assert.equal(h.p.stage, 2);
  assert.equal(h.p.trickScore, 1000);
  assert.deepEqual(h.effects, ['golden', 'flash', 'Stage 2']);
  assert.equal(h.context.solid(), false);
  h.context.up(4);
  assert.equal(h.context.solid(), true);
});

test('Daily Race and attract mode do not run Endless stages on either platform', () => {
  for (const build of [true, false]) for (const [mode, demo] of [['race', false], ['endless', true]]) {
    const h = stageHarness(build, mode, demo);
    h.context.up(2);
    assert.equal(h.context.enabled(), false);
    assert.equal(h.p.trickScore, 0);
    assert.deepEqual(h.effects, []);
  }
});

test('CrazyGames Endless HUD shows distance instead of stage progress', () => {
  const makeNode = () => ({ textContent: '', style: {}, classList: { remove() {}, toggle() {} } });
  const hud = Object.fromEntries(['score', 'race', 'coins', 'speed', 'combo', 'comboText', 'comboFill', 'hint'].map(k => [k, makeNode()]));
  const context = vm.createContext({
    hud, CG: { build: true }, mode: 'endless', p: { z: -4275, coins: 0, speed: 40, combo: 0, comboTimer: 0, stage: 1 },
    lastScore: -1, lastCoins: -1, hintT: 0, totalScore: () => 5000,
    special: () => false, updateLesson() {},
  });
  const hudSource = source.slice(source.indexOf('function updateHUD(dt)'), source.indexOf('const HINT_DESKTOP'));
  vm.runInContext(hudSource + '\nupdateHUD(1/60);', context);
  assert.match(hud.race.textContent, /^ENDLESS/);
  assert.match(hud.race.textContent, /4.?275 m/);
  assert.doesNotMatch(hud.race.textContent, /stage/i);
});
