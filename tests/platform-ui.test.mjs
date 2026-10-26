import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const game = readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
function configureRun(build, runs = 0) {
  const visibility = {};
  const context = vm.createContext({
    CG: { build }, mode: 'endless', save: { runs }, replayLesson: false,
    lesson: {}, hintT: 0, isTouch: false, hud: { hint: { style: {} } },
    HINT_DESKTOP: 'Original full controls', HINT_TOUCH: 'Original touch controls',
    show: (id, on) => { visibility[id] = on; }, updateLesson() {},
  });
  const start = game.indexOf('  lesson.active = CG.build &&');
  vm.runInContext(game.slice(start, game.indexOf('  Platform.gameplayStart();', start)), context);
  return { context, visibility };
}
test('main game keeps its original hints and never opens the portal lesson', () => {
  const { context, visibility } = configureRun(false);
  assert.equal(context.lesson.active, false);
  assert.equal(visibility.lesson, false);
  assert.equal(context.hud.hint.innerHTML, 'Original full controls');
  assert.equal(context.hintT, 9);
  assert.equal(configureRun(false, 5).context.hintT, 0);
});
test('CrazyGames still starts its new-player lesson', () => {
  const { context, visibility } = configureRun(true);
  assert.equal(context.lesson.active, true);
  assert.equal(visibility.lesson, true);
  assert.equal(context.hintT, 0);
});
test('lesson replay is offered only in CrazyGames help', () => {
  for (const build of [false, true]) {
    let html;
    const context = vm.createContext({ CG: { build }, cfg: { hints: '' }, openPanel: (title, body) => { html = body; }, $: () => ({}) });
    const start = ui.indexOf('function renderHelp()');
    vm.runInContext(ui.slice(start, ui.indexOf('// rewarded ad with a friendly message', start)) + '\nrenderHelp();', context);
    assert.equal(html.includes('id="replayLesson"'), build);
    assert.equal(html.includes('all time, weekly'), build);
  }
});
