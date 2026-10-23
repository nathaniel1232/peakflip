// ============================================================
//  CrazyGames: their SDK, plus what a game on crazygames.com has to respect. Saves go to the player's
//  CrazyGames account (the SDK's Data module), their CrazyGames username becomes the leaderboard name,
//  and their site settings can switch chat off or mute the game. Off crazygames.com it all stays off.
//  `npm run build:crazygames` sets platform: 'crazygames' in config.js for the upload.
// ============================================================
const cfg = window.PEAKFLIP_CONFIG || {};
const settingsFns = [];

export const CG = {
  sdk: null,
  build: cfg.platform === 'crazygames',   // the build made for CrazyGames (known before the SDK has loaded)
  // the SDK runs for real on crazygames.com, and as a 'local' test version on localhost
  get on() { return !!this.sdk && /^(crazygames|local)$/.test(this.sdk.environment); },

  async init() {
    try {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
        setTimeout(rej, 5000);
      });
      await window.CrazyGames.SDK.init();
      this.sdk = window.CrazyGames.SDK;
    } catch { this.sdk = null; }
    if (!this.on) return;
    try { this.sdk.game.addSettingsChangeListener(() => settingsFns.forEach(f => f())); } catch {}
    settingsFns.forEach(f => f());
  },

  get settings() { try { return (this.on && this.sdk.game.settings) || {}; } catch { return {}; } },
  get chatOff() { return !!this.settings.disableChat; },
  get audioOff() { return !!this.settings.muteAudio; },
  // runs now-ish (once the SDK is ready) and whenever the player changes a CrazyGames setting
  onSettings(fn) { settingsFns.push(fn); if (this.on) fn(); },

  // the save in the player's CrazyGames account (kept on the device for guests, synced once they log in)
  get store() { try { return this.on ? this.sdk.data : null; } catch { return null; } },

  // only real CrazyGames accounts (the localhost test SDK has a pretend user, who mustn't claim a leaderboard name)
  async user() {
    try { return this.sdk?.environment === 'crazygames' && this.sdk.user.isUserAccountAvailable ? await this.sdk.user.getUser() : null; } catch { return null; }
  },
  onLogin(fn) { try { if (this.on) this.sdk.user.addAuthListener(u => { if (u) fn(u); }); } catch {} },
};
