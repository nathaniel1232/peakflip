// ============================================================
//  Ads: one interface over whichever ad network is available.
//   • CrazyGames  — their SDK (automatic when the game runs on crazygames.com)
//   • Google H5 Games Ads (AdSense "Ad Placement API") — when config.js has adsenseClient + h5GamesAds: true
//   • dev         — a fake 3-second ad on localhost so you can test the flow
//  Rewarded ads are always opt-in (the player clicks "Watch ad").
// ============================================================
const cfg = window.PEAKFLIP_CONFIG || {};
let provider = 'none', sdk = null, onMute = () => {};

export const Ads = {
  get provider() { return provider; },
  get available() { return provider !== 'none'; },

  init(crazySdk, muteFn) {
    onMute = muteFn || onMute;
    // The upload build must never fall through to another ad provider, even if SDK loading fails.
    if (cfg.platform === 'crazygames') {
      if (crazySdk && crazySdk.environment === 'crazygames') { sdk = crazySdk; provider = 'crazygames'; }
      else if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) provider = 'dev';
      return;
    }
    // the CrazyGames SDK also loads elsewhere but only serves ads on crazygames.com
    if (crazySdk && crazySdk.environment === 'crazygames') { sdk = crazySdk; provider = 'crazygames'; return; }
    // localhost always gets the fake test ad, so the reward flow can be tried while developing
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) { provider = 'dev'; return; }
    if (cfg.adsenseClient && cfg.h5GamesAds && !/crazygames/.test(location.hostname)) {
      // Google's H5 games ad loader (adBreak / adConfig)
      if (!document.querySelector('script[src*="adsbygoogle.js"]')) {
        const s = document.createElement('script');
        s.async = true; s.crossOrigin = 'anonymous';
        s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cfg.adsenseClient}`;
        if (cfg.adsTestMode) s.setAttribute('data-adbreak-test', 'on');
        document.head.appendChild(s);
      }
      window.adsbygoogle = window.adsbygoogle || [];
      window.adBreak = window.adConfig = o => window.adsbygoogle.push(o);
      window.adConfig({ preloadAdBreaks: 'on', sound: 'on' });
      provider = 'google'; return;
    }
  },

  noFill: false,   // set when the last rewarded request had no ad to show
  lastReward: 0,   // when the last rewarded ad was watched to the end
  // a rewarded ad watched in the last 3 minutes counts as the player's ad: no midgame ad straight after it, and
  // the results screen doesn't offer another one yet (CrazyGames: no chained ads, rewarded offers not too often)
  get recentReward() { return Ads.lastReward > 0 && performance.now() - Ads.lastReward < 180000; },

  // resolves true only if the player watched the whole ad
  rewarded() {
    Ads.noFill = false;
    return new Promise(resolve => {
      let done = false;
      const finish = ok => { if (done) return; done = true; onMute(false); if (ok) Ads.lastReward = performance.now(); resolve(ok); };
      if (provider === 'crazygames') {
        try {
          sdk.ad.requestAd('rewarded', { adStarted: () => { if (!done) onMute(true); }, adFinished: () => finish(true), adError: () => { Ads.noFill = true; finish(false); } });
        } catch { Ads.noFill = true; finish(false); }
      } else if (provider === 'google') {
        let viewed = false, offered = false;
        let offerTimeout, maxTimeout;
        const settle = ok => {
          if (done) return;
          done = true;
          clearTimeout(offerTimeout);
          clearTimeout(maxTimeout);
          onMute(false);
          if (ok) Ads.lastReward = performance.now();
          resolve(ok);
        };
        try {
          window.adBreak({
            type: 'reward', name: 'reward_unlock',
            beforeAd: () => { if (!done) onMute(true); },
            afterAd: () => { if (!done) onMute(false); },
            beforeReward: showAdFn => {
              if (done) return;
              offered = true;
              showAdFn();
            },
            adViewed: () => { if (!done) viewed = true; },
            adDismissed: () => { if (!done) viewed = false; },
            adBreakDone: () => { if (done) return; if (!offered) Ads.noFill = true; settle(viewed); },   // no ad was available
          });
          // Google can fail to call adBreakDone when the request is blocked or the loader stalls.
          // Once settled, callback guards above also prevent a delayed reward offer from opening.
          if (!done) {
            offerTimeout = setTimeout(() => { if (!done && !offered) { Ads.noFill = true; settle(false); } }, 8000);
            maxTimeout = setTimeout(() => { if (!done) { if (!offered) Ads.noFill = true; settle(false); } }, 60000);
          }
        } catch { Ads.noFill = true; settle(false); }
      } else if (provider === 'dev') {
        devAd(3, () => finish(true), () => finish(false));
      } else finish(false);
      // CrazyGames waits for SDK completion. Google offers expire when its loader does not answer.
    });
  },

  // between runs; never blocks for long
  interstitial() {
    if (Ads.recentReward) return Promise.resolve();
    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (done) return; done = true; onMute(false); resolve(); };
      const begin = () => { if (!done) onMute(true); };
      if (provider === 'crazygames') {
        try { sdk.ad.requestAd('midgame', { adStarted: begin, adFinished: finish, adError: finish }); } catch { finish(); }
      } else if (provider === 'google') {
        let noStartTimeout, maxTimeout, started = false;
        const settle = () => {
          if (done) return;
          done = true;
          clearTimeout(noStartTimeout);
          clearTimeout(maxTimeout);
          onMute(false);
          resolve();
        };
        const start = () => {
          if (done) return;
          started = true;
          begin();
        };
        try {
          window.adBreak({
            type: 'next', name: 'between_runs',
            beforeAd: start,
            afterAd: settle,
            adBreakDone: settle,
          });
          // If the Google placement never starts or completes, let the player continue.
          // Callback guards prevent a late placement callback from muting a later run.
          if (!done) {
            noStartTimeout = setTimeout(() => { if (!started) settle(); }, 1500);
            maxTimeout = setTimeout(settle, 60000);
          }
        } catch { settle(); }
      } else finish();
      // CrazyGames still settles only from its documented SDK callbacks. Google gets a bounded wait
      // because its placement callback can be lost when the loader is blocked or stalls.
    });
  },
};

// local stand-in so the reward flow can be tested without an ad network
function devAd(seconds, ok, cancel) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:20;background:#000d;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;color:#fff;font:700 18px system-ui';
  el.innerHTML = `<div>Test ad (localhost only)</div><div id="devAdT" style="font-size:48px">${seconds}</div><button style="font:inherit;background:#fff2;color:#fff;border:0;border-radius:10px;padding:8px 16px;cursor:pointer">Skip (no reward)</button>`;
  document.body.appendChild(el);
  let t = seconds;
  const iv = setInterval(() => { t--; const n = el.querySelector('#devAdT'); if (n) n.textContent = t; if (t <= 0) { clearInterval(iv); el.remove(); ok(); } }, 1000);
  el.querySelector('button').onclick = () => { clearInterval(iv); el.remove(); cancel(); };
}
