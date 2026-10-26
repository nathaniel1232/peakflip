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
        try {
          window.adBreak({
            type: 'reward', name: 'reward_unlock',
            beforeAd: () => onMute(true), afterAd: () => onMute(false),
            beforeReward: showAdFn => { offered = true; showAdFn(); },
            adViewed: () => { viewed = true; },
            adDismissed: () => { viewed = false; },
            adBreakDone: () => { if (!offered) Ads.noFill = true; finish(viewed); },   // no ad was available
          });
        } catch { Ads.noFill = true; finish(false); }
      } else if (provider === 'dev') {
        devAd(3, () => finish(true), () => finish(false));
      } else finish(false);
      // SDK ad calls settle through adFinished/adError (or adBreakDone for Google). Releasing the UI on a
      // timer is unsafe: an ad can start after the timer and play over the next run.
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
        try { window.adBreak({ type: 'next', name: 'between_runs', beforeAd: begin, afterAd: () => onMute(false), adBreakDone: finish }); } catch { finish(); }
      } else finish();
      // Keep the results screen blocked until the provider reports adFinished/adError. A timeout could
      // let the next run begin before a delayed ad starts.
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
