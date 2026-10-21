// ============================================================
//  Cloud saves: every change (coins, items, missions, name) is copied to Supabase, keyed by the browser's
//  player id, so it's backed up automatically. The save code is internal: it only carries progress across
//  when the game moves to a new domain (see canonicalHost in config.js). Players never see it.
// ============================================================
import { save, persist, onPersist, normalizeSave, ensureMissions } from './meta.js';
import { rpc } from './net.js';

const cfg = window.PEAKFLIP_CONFIG || {};
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I mix-ups
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => CODE_CHARS[b % 32]).join('');
const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const devHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

// the race ghost is big and only matters for today, so it stays on this device
const payload = () => { const { ghost, ...rest } = save; return rest; };
function adopt(data, savedAt) {
  const ghost = save.ghost;
  for (const k of Object.keys(save)) delete save[k];
  Object.assign(save, data, { savedAt });
  if (ghost && !save.ghost) save.ghost = ghost;
  normalizeSave(); ensureMissions();
  persist(false);
}

// resolves true when https://host answers at all (an opaque no-cors response is fine; DNS or network failure rejects)
async function reachable(host) {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    await fetch(`https://${host}/config.js?probe=${Date.now()}`, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
    clearTimeout(t); return true;
  } catch { return false; }
}

// Bring progress from another address into this one when this browser already has progress of its own:
// items are combined, the bigger numbers win, and if only the incoming save has a leaderboard name, that
// identity (player id + name) comes along so the name isn't "taken" by your own old save.
function merge(inc) {
  for (const k of Object.keys(inc.inv || {})) save.inv[k] = [...new Set([...(save.inv[k] || []), ...inc.inv[k]])];
  for (const k of ['coins', 'best', 'runs', 'chestsOpened', 'missionsDone']) save[k] = Math.max(+save[k] || 0, +inc[k] || 0);
  for (const [k, v] of Object.entries(inc.adProgress || {})) save.adProgress[k] = Math.max(save.adProgress[k] || 0, v);
  for (const [d, t] of Object.entries(inc.raceBest || {})) if (!save.raceBest?.[d] || t < save.raceBest[d]) (save.raceBest ||= {})[d] = t;
  for (const [d, result] of Object.entries(inc.raceScores || {})) {
    const prev = save.raceScores?.[d];
    if (!prev || result.score > prev.score || (result.score === prev.score && result.time < prev.time)) (save.raceScores ||= {})[d] = result;
  }
  if (!save.name && inc.name) { save.pid = inc.pid; save.name = inc.name; save.code = inc.code || save.code; }
  if (save.pid === inc.pid && inc.chatToken && !save.chatToken) save.chatToken = inc.chatToken;
  normalizeSave(); ensureMissions();
  persist();   // a real change: back it up
}

let timer = null, listeners = [];
export const Cloud = {
  status: 'off',   // off · syncing · synced · offline
  get code() { return save.code || ''; },
  onStatus(fn) { listeners.push(fn); },
  setStatus(s) { this.status = s; listeners.forEach(f => f(s)); },

  async push(keepalive = false) {
    clearTimeout(timer); timer = null;
    if (!save.pid) return false;
    if (!save.code) { save.code = newCode(); persist(false); }
    this.setStatus('syncing');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await rpc('save_progress', { p_pid: save.pid, p_code: save.code, p_data: payload(), p_saved_at: save.savedAt || 0 }, keepalive);
        if (r?.ok) { if (r.code && r.code !== save.code) { save.code = r.code; persist(false); } this.setStatus('synced'); return true; }
        if (r?.error === 'code_taken') { save.code = newCode(); persist(false); continue; }
        break;
      } catch { break; }
    }
    this.setStatus('offline'); return false;
  },
  schedule() { clearTimeout(timer); timer = setTimeout(() => this.push(), 1500); },

  // onReplaced: called when newer progress from the cloud replaced what this device had
  async init(onReplaced) {
    onPersist.fn = () => this.schedule();
    addEventListener('pagehide', () => { if (timer) this.push(true); });
    // arriving from another address with "#restore=CODE" (see canonicalHost in config.js)
    const m = location.hash.match(/restore=([A-Za-z0-9-]+)/);
    if (m) {
      history.replaceState(null, '', location.pathname + location.search);
      try {
        const r = await rpc('restore_progress', { p_code: cleanCode(m[1]) });
        // a brand-new browser here has a fresh (but empty) save, so the incoming progress wins unless this one has real progress
        const fresh = !save.runs && !save.coins && !save.chestsOpened && (save.inv?.outfit?.length || 0) <= 1;
        if (r?.found && (fresh || (r.saved_at || 0) > (save.savedAt || 0))) { adopt(r.data, r.saved_at); save.code = cleanCode(m[1]); persist(false); onReplaced(); }
        else if (r?.found) { merge({ ...r.data, code: cleanCode(m[1]) }); onReplaced(); }
      } catch {}
    }
    // moved to a new domain: hand this browser's progress over before redirecting
    if (cfg.canonicalHost && location.hostname !== cfg.canonicalHost && !devHost && !/crazygames/.test(location.hostname)) {
      // only move people if their browser can actually reach the new address (fresh domains take a while to
      // show up in every internet provider's DNS); otherwise they keep playing here
      if (await reachable(cfg.canonicalHost) && await this.push()) { location.replace(`https://${cfg.canonicalHost}/#restore=${save.code}`); return; }
    }
    try {
      const r = await rpc('load_progress', { p_pid: save.pid });
      if (r?.found && (r.saved_at || 0) > (save.savedAt || 0)) { adopt(r.data, r.saved_at); if (r.code) save.code = r.code; persist(false); onReplaced(); this.setStatus('synced'); }
      else await this.push();
    } catch { this.setStatus('offline'); }
  },
};
