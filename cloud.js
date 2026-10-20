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
      } catch {}
    }
    // moved to a new domain: hand this browser's progress over before redirecting
    if (cfg.canonicalHost && location.hostname !== cfg.canonicalHost && !devHost && !/crazygames/.test(location.hostname)) {
      if (await this.push()) { location.replace(`https://${cfg.canonicalHost}/#restore=${save.code}`); return; }
    }
    try {
      const r = await rpc('load_progress', { p_pid: save.pid });
      if (r?.found && (r.saved_at || 0) > (save.savedAt || 0)) { adopt(r.data, r.saved_at); if (r.code) save.code = r.code; persist(false); onReplaced(); this.setStatus('synced'); }
      else await this.push();
    } catch { this.setStatus('offline'); }
  },
};
