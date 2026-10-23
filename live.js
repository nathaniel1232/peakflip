// ============================================================
//  Live messages from the game's owner, run from Supabase (see supabase/admin.sql): announcements that pop
//  up for everyone playing, "go to Off-piste" calls for one player or everybody, and admins (who can fly
//  on the Off-piste mountain and send those from its chat). Every player asks for news every 10 seconds.
// ============================================================
import { save, persist } from './meta.js';
import { rpc } from './net.js';

const AFTER_KEY = 'peakflip_live_after';
let after = 0;
try { after = +localStorage.getItem(AFTER_KEY) || 0; } catch {}

const style = document.createElement('style');
style.textContent = `
  #liveNotice { position:fixed; left:50%; top:16px; transform:translate(-50%,-140%); z-index:60; max-width:min(560px,calc(100vw - 32px));
    padding:12px 18px 12px 14px; border-radius:16px; display:flex; gap:12px; align-items:center; pointer-events:none;
    background:linear-gradient(180deg,#ff8a4c,#e5551a); color:#fff; box-shadow:0 10px 30px rgba(0,0,0,.35); transition:transform .45s cubic-bezier(.2,1.3,.4,1); }
  #liveNotice.on { transform:translate(-50%,0); }
  #liveNotice .lnIc { font-size:24px; flex:none; }
  #liveNotice small { display:block; font:800 10px system-ui,sans-serif; letter-spacing:.12em; opacity:.85; }
  #liveNotice b { display:block; font:700 16px system-ui,sans-serif; line-height:1.35; overflow-wrap:anywhere; }
`;
document.head.appendChild(style);
const box = document.createElement('div'); box.id = 'liveNotice'; box.setAttribute('role', 'status');
box.innerHTML = '<span class="lnIc">📣</span><div><small>MESSAGE FROM PEAK FLIP</small><b></b></div>';
document.body.appendChild(box);
const queue = []; let showing = false;
function showNext() {
  if (showing || !queue.length) return;
  showing = true;
  const { text, title, icon } = queue.shift();
  box.querySelector('b').textContent = text;
  box.querySelector('small').textContent = title;
  box.querySelector('.lnIc').textContent = icon;
  box.classList.add('on');
  setTimeout(() => { box.classList.remove('on'); setTimeout(() => { showing = false; showNext(); }, 500); }, Math.min(14000, 4500 + text.length * 60));
}

const listeners = { notice: [], offpiste: [], admin: [] };
export const Live = {
  admin: false, fly: false,
  on(event, fn) { listeners[event].push(fn); },
  notify(text, title = 'MESSAGE FROM PEAK FLIP', icon = '📣') { queue.push({ text: String(text), title, icon }); showNext(); },

  async poll() {
    if (!save.pid || document.hidden) return;
    let r;
    try { r = await rpc('get_game_events', { p_pid: save.pid, p_after: after }); } catch { return; }   // not set up yet, or offline
    if (!r || typeof r !== 'object') return;
    const was = Live.admin && Live.fly;
    Live.admin = !!r.admin; Live.fly = !!r.fly;
    if (was !== (Live.admin && Live.fly)) listeners.admin.forEach(f => f(Live));
    for (const e of r.events || []) {
      if (e.kind === 'notice' && e.body) { Live.notify(e.body); listeners.notice.forEach(f => f(e.body)); }
      if (e.kind === 'offpiste') listeners.offpiste.forEach(f => f(e));
    }
    if (Number.isFinite(r.last) && r.last !== after) { after = r.last; try { localStorage.setItem(AFTER_KEY, String(after)); } catch {} }
  },

  // admins only: "/say hello", "/send Name" or "/send all" (typed into the Off-piste chat)
  async command(cmd, arg) {
    if (!save.name) return { ok: false, error: 'name_required' };
    if (!save.chatToken) { save.chatToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''); persist(); }
    try {
      const s = await rpc('open_chat_session', { p_pid: save.pid, p_token: save.chatToken });
      if (!s?.ok) return s || { ok: false };
      return await rpc('admin_command', { p_pid: save.pid, p_token: save.chatToken, p_cmd: cmd, p_arg: arg });
    } catch { return { ok: false, error: 'offline' }; }
  },
};

setTimeout(() => Live.poll(), 2500);
setInterval(() => Live.poll(), 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) Live.poll(); });
