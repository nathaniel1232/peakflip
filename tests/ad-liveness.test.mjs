import test from 'node:test';
import assert from 'node:assert/strict';

function useFakeTimers(t) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let now = 0, nextId = 1;
  const timers = new Map();
  globalThis.setTimeout = (callback, delay = 0) => {
    const id = nextId++;
    timers.set(id, { at: now + delay, callback });
    return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });
  return {
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
  };
}

function configureGoogleAds() {
  globalThis.window = { PEAKFLIP_CONFIG: { adsenseClient: 'ca-pub-test', h5GamesAds: true }, adsbygoogle: [] };
  globalThis.location = { hostname: 'peakflip.example' };
  globalThis.document = { querySelector: () => ({}) };
}

test('Google interstitial releases retry after a missing callback and ignores late callbacks', async t => {
  const clock = useFakeTimers(t);
  configureGoogleAds();
  const { Ads } = await import('../ads.js?google-interstitial-liveness');
  const muted = [];
  Ads.init(null, value => muted.push(value));
  let callbacks;
  window.adBreak = options => { callbacks = options; };

  let settled = false;
  const pending = Ads.interstitial().then(() => { settled = true; });
  clock.tick(1499);
  assert.equal(settled, false);
  clock.tick(1);
  await pending;
  assert.equal(settled, true);
  assert.deepEqual(muted, [false]);

  callbacks.beforeAd();
  callbacks.afterAd();
  callbacks.adBreakDone();
  assert.deepEqual(muted, [false], 'callbacks arriving after retry cannot mute or unmute a later run');
});

test('Google rewarded timeout ignores a late offer and cannot grant stale reward', async t => {
  const clock = useFakeTimers(t);
  configureGoogleAds();
  const { Ads } = await import('../ads.js?google-reward-liveness');
  const muted = [];
  Ads.init(null, value => muted.push(value));
  let callbacks;
  window.adBreak = options => { callbacks = options; };

  const pending = Ads.rewarded();
  clock.tick(8000);
  assert.equal(await pending, false);
  assert.equal(Ads.noFill, true);
  let shown = false;
  callbacks.beforeReward(() => { shown = true; });
  callbacks.beforeAd();
  callbacks.adViewed();
  callbacks.adBreakDone();
  assert.equal(shown, false, 'a timed out request must not open a late rewarded ad');
  assert.equal(Ads.lastReward, 0);
  assert.deepEqual(muted, [false], 'late callbacks cannot change audio state');
});


test('started Google interstitial waits for completion, and afterAd releases replay', async t => {
  const clock = useFakeTimers(t);
  configureGoogleAds();
  const { Ads } = await import('../ads.js?google-started-completes');
  Ads.init(null);
  let callbacks;
  window.adBreak = value => { callbacks = value; };
  let settled = false;
  const pending = Ads.interstitial().then(() => { settled = true; });
  callbacks.beforeAd();
  clock.tick(2000);
  await Promise.resolve();
  assert.equal(settled, false);
  callbacks.afterAd();
  await pending;
  assert.equal(settled, true);
});

test('started Google interstitial recovers even if all completion callbacks disappear', async t => {
  const clock = useFakeTimers(t);
  configureGoogleAds();
  const { Ads } = await import('../ads.js?google-started-stalls');
  Ads.init(null);
  let callbacks;
  window.adBreak = value => { callbacks = value; };
  const pending = Ads.interstitial();
  callbacks.beforeAd();
  clock.tick(60000);
  await pending;
});
