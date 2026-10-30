import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('CrazyGames midgame request keeps the next run blocked through delayed ad callbacks', async () => {
  globalThis.window = { PEAKFLIP_CONFIG: { platform: 'crazygames' } };
  const { Ads } = await import('../ads.js?crazygames-lifecycle');
  let callbacks;
  const muted = [];
  Ads.init({ environment: 'crazygames', ad: { requestAd: (_type, cbs) => { callbacks = cbs; } } }, value => muted.push(value));

  let settled = false;
  const pending = Ads.interstitial().then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, 'the result screen stays blocked while the SDK auction is pending');
  callbacks.adStarted();
  assert.deepEqual(muted, [true]);
  callbacks.adError();
  await pending;
  assert.equal(settled, true);
  assert.deepEqual(muted, [true, false]);
  callbacks.adStarted();
  assert.deepEqual(muted, [true, false], 'late duplicate callbacks cannot mute the next run');
});

test('CrazyGames rewarded ads grant only on finish and always restore audio on errors', async () => {
  globalThis.window = { PEAKFLIP_CONFIG: { platform: 'crazygames' } };
  const { Ads } = await import('../ads.js?crazygames-rewarded');
  let callbacks;
  const muted = [];
  Ads.init({ environment: 'crazygames', ad: { requestAd: (_type, cbs) => { callbacks = cbs; } } }, value => muted.push(value));

  const failed = Ads.rewarded();
  callbacks.adStarted();
  callbacks.adError();
  assert.equal(await failed, false);
  assert.equal(Ads.noFill, true);
  assert.deepEqual(muted, [true, false]);
  callbacks.adStarted();
  assert.deepEqual(muted, [true, false], 'callbacks after completion do not leave audio muted');

  Ads.noFill = false;
  const watched = Ads.rewarded();
  callbacks.adStarted();
  callbacks.adFinished();
  assert.equal(await watched, true);
  assert.ok(Ads.lastReward > 0);
  assert.deepEqual(muted, [true, false, true, false]);
});

test('CrazyGames build never selects Google ads after SDK failure but keeps localhost ad testing', async () => {
  globalThis.window = { PEAKFLIP_CONFIG: { platform: 'crazygames', adsenseClient: 'ca-pub-test', h5GamesAds: true } };
  globalThis.location = { hostname: 'play.crazygames.com' };
  globalThis.document = { querySelector: () => { throw new Error('third-party ad loader should not be inspected'); } };
  const { Ads } = await import('../ads.js?crazygames-provider-guard');
  Ads.init(null);
  assert.equal(Ads.provider, 'none');

  globalThis.location.hostname = 'localhost';
  const { Ads: localAds } = await import('../ads.js?crazygames-local-provider');
  localAds.init({ environment: 'local' });
  assert.equal(localAds.provider, 'dev');
});

test('Google rewarded callback grants only after adViewed and calls showAdFn', async () => {
  globalThis.window = { PEAKFLIP_CONFIG: { adsenseClient: 'ca-pub-test', h5GamesAds: true }, adsbygoogle: [] };
  globalThis.location = { hostname: 'peakflip.example' };
  globalThis.document = { querySelector: () => ({}) };
  const { Ads } = await import('../ads.js?google-rewarded-success');
  const muted = [];
  Ads.init(null, value => muted.push(value));
  assert.equal(Ads.provider, 'google');

  let callbacks;
  window.adBreak = options => { callbacks = options; };
  const pending = Ads.rewarded();
  let shown = false;
  callbacks.beforeAd();
  callbacks.beforeReward(() => { shown = true; callbacks.adViewed(); });
  callbacks.afterAd();
  callbacks.adBreakDone();
  assert.equal(await pending, true);
  assert.equal(shown, true);
  assert.equal(muted[0], true);
  assert.equal(muted.at(-1), false);
});

test('synchronous Google ad request failures settle without granting a reward', async () => {
  globalThis.window = { PEAKFLIP_CONFIG: { adsenseClient: 'ca-pub-test', h5GamesAds: true }, adsbygoogle: [] };
  globalThis.location = { hostname: 'peakflip.example' };
  globalThis.document = { querySelector: () => ({}) };
  const { Ads } = await import('../ads.js?google-request-throws');
  Ads.init(null);
  window.adBreak = () => { throw new Error('blocked ad API'); };

  assert.equal(await Ads.rewarded(), false);
  assert.equal(Ads.noFill, true);
  await assert.doesNotReject(Ads.interstitial());
});

test('CrazyGames upload remains CrazyGames-only and packages imports at the zip root', () => {
  execFileSync(process.execPath, ['tools/build-crazygames.mjs'], { cwd: root, stdio: 'pipe' });
  const config = readFileSync(resolve(root, 'dist/crazygames/config.js'), 'utf8');
  const html = readFileSync(resolve(root, 'dist/crazygames/index.html'), 'utf8');
  const archive = execFileSync('unzip', ['-Z1', 'peak-flip-crazygames.zip'], { cwd: root, encoding: 'utf8' }).trim().split('\n');

  const mainHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
  assert.match(mainHtml, /data-text="ski">ski<\/span>/);
  assert.match(mainHtml, /data-text="surf">surf<\/span>/);
  assert.doesNotMatch(mainHtml, /crazygames\.css|homeTagline|#ff9558/);
  assert.match(html, /<link rel="stylesheet" href="crazygames\.css">/);
  assert.match(html, /data-text="surf">surf<\/span>/);
  assert.ok(['ride.js', 'surf.js'].every(f => archive.includes(f)), 'Surf ships in the upload');
  assert.ok(archive.includes('crazygames.css'));
  assert.match(config, /platform:\s*'crazygames'/);
  assert.match(config, /adsenseClient:\s*''/);
  assert.match(config, /h5GamesAds:\s*false/);
  assert.doesNotMatch(html, /adsbygoogle|pagead2\.googlesyndication\.com/);
  assert.doesNotMatch(html, /data-text="\.io"/);
  assert.ok(archive.includes('index.html'), 'index.html is at the zip root');
  assert.ok(archive.includes('crazy.js') && archive.includes('ads.js') && archive.includes('game-clock.js') && archive.includes('lib/three.module.min.js'));
});
