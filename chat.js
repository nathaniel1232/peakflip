import { save, persist } from './meta.js';
import { rpc } from './net.js';
import { CG } from './crazy.js';
import { clean, isClean } from './clean.js';

const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ERRORS = {
  too_fast: 'Wait 5 seconds between messages.', length: 'Write between 1 and 240 characters.',
  muted: 'Messaging is unavailable for this player.', identity: 'Your chat identity could not be verified. Try your original browser.',
  name_required: 'Claim a player name before chatting.',
};

export function initChat({ openPanel, nameForm }) {
  const style = document.createElement('style');
  style.textContent = `
    .chatIntro { color:var(--muted); font-size:13px; line-height:1.5; text-align:center; }
    #chatName { text-align:center; font-family:var(--snow-font); font-size:15px; color:#cfe8fa; }
    #chatMessages { height:min(46vh,400px); min-height:160px; overflow-y:auto; display:flex; flex-direction:column; gap:2px; padding:10px 6px;
      border-radius:16px; background:linear-gradient(180deg, rgba(0,0,0,.22), rgba(0,0,0,.1)); box-shadow:inset 0 1px 0 rgba(255,255,255,.06); overscroll-behavior:contain; }
    .chatMessage { display:flex; gap:9px; align-items:flex-end; max-width:86%; flex-shrink:0; margin-top:8px; }
    .chatMessage.cont { margin-top:0; }
    .chatMessage.mine { align-self:flex-end; flex-direction:row-reverse; }
    .chatAvatar { width:30px; height:30px; flex:none; border-radius:50%; display:grid; place-items:center; font-family:var(--snow-font); font-size:15px; color:#fff;
      background:hsl(var(--h) 65% 45%); box-shadow:inset 0 -2px 0 rgba(0,0,0,.25); }
    .chatMessage.cont .chatAvatar { visibility:hidden; height:0; }
    .chatBubble { position:relative; padding:8px 12px; border-radius:16px 16px 16px 5px; background:rgba(255,255,255,.1); min-width:0; }
    .chatMessage.mine .chatBubble { border-radius:16px 16px 5px 16px; background:linear-gradient(180deg,#ff8a4c,#e5551a); }
    .chatByline { display:flex; align-items:baseline; gap:8px; font-size:12px; margin-bottom:2px; }
    .chatByline b { font-family:var(--snow-font); font-weight:400; font-size:14px; color:hsl(var(--h) 80% 72%); }
    .chatMessage.mine .chatByline b { color:#fff; }
    .chatByline time { color:var(--muted); font-size:10px; }
    .chatMessage.mine .chatByline time { color:rgba(255,255,255,.75); }
    .chatMessage.cont .chatByline { display:none; }
    .chatBody { white-space:pre-wrap; overflow-wrap:anywhere; font-size:14px; line-height:1.45; user-select:text; }
    .chatActions { display:flex; gap:10px; margin-top:3px; opacity:0; transition:opacity .15s; }
    .chatMessage:hover .chatActions, .chatMessage:focus-within .chatActions { opacity:1; }
    body.touch .chatActions { opacity:.7; }
    .chatActions button { background:none; border:0; padding:0; color:var(--muted); font:inherit; font-size:10px; cursor:pointer; }
    .chatActions button:hover { color:#fff; }
    #chatForm { display:flex; gap:8px; align-items:center; padding:5px 5px 5px 14px; border-radius:99px; background:rgba(0,0,0,.25); box-shadow:inset 0 0 0 1px rgba(190,228,255,.18); }
    #chatForm:focus-within { box-shadow:inset 0 0 0 2px rgba(76,195,255,.6); }
    #chatInput { min-width:0; flex:1; font:600 15px system-ui,sans-serif; padding:8px 0; border:0; outline:none; background:none; color:#fff; }
    #chatInput::placeholder { color:var(--muted); }
    #chatForm .btn { width:44px; height:44px; padding:0; border-radius:50%; margin:0; flex:none; }
    #chatForm .btn .ic { width:20px; height:20px; }
    .chatFoot { display:flex; justify-content:space-between; gap:8px; font-size:11px; color:var(--muted); }
    #chatStatus { min-height:16px; }
    .chatEmpty { margin:auto; text-align:center; color:var(--muted); font-size:13px; }
    .chatEmpty b { display:block; font-family:var(--snow-font); font-weight:400; font-size:22px; color:#fff; margin-bottom:4px; }
  `;
  document.head.appendChild(style);
  let blocked;
  try { blocked = new Set(JSON.parse(localStorage.getItem('peakflip_chat_blocked') || '[]')); }
  catch { blocked = new Set(); }
  const reported = new Set();
  let session = null, messages = [], loading = false, sending = false, generation = 0;
  const isOpen = () => !!$('chatMessages') && !$('panel').classList.contains('hidden');
  const setStatus = text => { const el = $('chatStatus'); if (el) el.textContent = text; };

  async function identity() {
    if (!save.name) return { ok: false, error: 'name_required' };
    if (!save.chatToken) { save.chatToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''); persist(); }
    const key = save.pid + ':' + save.chatToken;
    if (session === key) return { ok: true };
    const result = await rpc('open_chat_session', { p_pid: save.pid, p_token: save.chatToken });
    if (result?.ok) session = key;
    return result;
  }

  function render() {
    const el = $('chatMessages'); if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
    const visible = messages.filter(m => !blocked.has(m.author) && !reported.has(m.id));
    // bubbles: everyone gets a colour from their (anonymous) author id; messages in a row from one rider are grouped
    const html = visible.length ? visible.map((m, i) => {
      const date = new Date(m.created_at), time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const prev = visible[i - 1], cont = prev && prev.author === m.author && date - new Date(prev.created_at) < 5 * 60000;
      const hue = parseInt(String(m.author).slice(0, 6), 16) % 360 || 200, initial = escape([...clean(m.name).trim()][0] || '?').toUpperCase();
      return `<article class="chatMessage ${m.isMe ? 'mine' : ''} ${cont ? 'cont' : ''}" style="--h:${hue}"><div class="chatAvatar">${initial}</div>
        <div class="chatBubble"><div class="chatByline"><b>${escape(clean(m.name))}</b><time datetime="${escape(m.created_at)}" title="${escape(date.toLocaleString())}">${escape(time)}</time></div>
        <div class="chatBody">${escape(clean(m.body))}</div>${!m.isMe ? `<div class="chatActions"><button type="button" data-block="${escape(m.author)}">Mute</button><button type="button" data-report="${m.id}">Report</button></div>` : ''}</div></article>`;
    }).join('') : '<div class="chatEmpty"><b>The mountain is quiet</b>Be the first to say hello!</div>';
    if (el.innerHTML === html) return;
    const firstRender = el.dataset.loaded !== 'true';
    el.innerHTML = html; el.dataset.loaded = 'true';
    el.querySelectorAll('[data-block]').forEach(b => b.onclick = () => {
      blocked.add(b.dataset.block);
      try { localStorage.setItem('peakflip_chat_blocked', JSON.stringify([...blocked])); } catch {}
      render(); setStatus('Player muted on this device.'); $('chatUnmute')?.classList.remove('hidden');
    });
    el.querySelectorAll('[data-report]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      try {
        const auth = await identity();
        if (!auth?.ok) { setStatus(ERRORS[auth?.error] || 'Claim a name to report messages.'); b.disabled = false; return; }
        const id = Number(b.dataset.report);
        const result = await rpc('report_chat_message', { p_pid: save.pid, p_token: save.chatToken, p_id: id });
        if (!result?.ok) { setStatus('Could not report this message. Try again.'); b.disabled = false; return; }
        reported.add(id); render(); setStatus('Message reported and hidden for you.');
      } catch { setStatus('Could not report this message. Try again when connected.'); b.disabled = false; }
    });
    if (nearBottom || firstRender) el.scrollTop = el.scrollHeight;
  }

  async function refresh() {
    if (loading || !isOpen() || document.hidden || CG.chatOff) return;
    const request = generation; loading = true;
    try {
      const data = await rpc('get_chat_messages', { p_pid: save.pid });
      if (request !== generation || !isOpen()) return;
      if (!Array.isArray(data)) throw new Error('bad messages');
      messages = data; render();
      if ($('chatStatus')?.dataset.offline === 'true') { setStatus('Connected · updates every 5 seconds'); $('chatStatus').dataset.offline = 'false'; }
    } catch {
      if (request !== generation || !isOpen()) return;
      if (!messages.length) $('chatMessages').innerHTML = '<div class="note">Chat is unavailable right now. We’ll reconnect automatically.</div>';
      setStatus('Offline · trying to reconnect'); $('chatStatus').dataset.offline = 'true';
    } finally { loading = false; }
  }

  // Neutral age screen before chat (COPPA): asks for a birth year, keeps only "13+" or "under 13" on the device,
  // and doesn't ask again, so a younger player can't just pick another year.
  function ageCheck() {
    if (save.chatAge === 'under13') {
      openPanel('Global chat', '<div class="chatIntro">Chat is for players aged 13 and over. You can still ride, race and climb the leaderboards.</div>');
      return false;
    }
    if (save.chatAge === '13+') return true;
    const now = new Date().getFullYear();
    const years = Array.from({ length: 100 }, (_, i) => now - i).map(y => `<option value="${y}">${y}</option>`).join('');
    openPanel('Global chat', `<div class="chatIntro">What year were you born?</div>
      <form id="chatAgeForm" style="display:flex;flex-direction:column;gap:10px;align-items:center;margin-top:12px">
        <select id="chatYear" aria-label="Birth year" required style="font:600 16px system-ui,sans-serif;padding:10px 16px;border-radius:99px;border:0;background:rgba(0,0,0,.25);color:#fff;box-shadow:inset 0 0 0 1px rgba(190,228,255,.18)"><option value="">Year</option>${years}</select>
        <button class="btn primary" type="submit">Continue</button></form>`);
    $('chatAgeForm').onsubmit = e => {
      e.preventDefault();
      const year = Number($('chatYear').value); if (!year) return;
      // only a year is known, so anyone who might still be 12 counts as under 13
      save.chatAge = now - year > 13 ? '13+' : 'under13'; persist();
      openChat();
    };
    return false;
  }

  function openChat() {
    if (CG.chatOff) return;
    if (!ageCheck()) return;
    generation++;
    openPanel('Global chat', `<div class="chatIntro">Chat with riders across Peak Flip. Keep it friendly and don’t share personal information.</div>
      <div id="chatName"></div><div id="chatMessages" role="log" aria-label="Global messages" aria-live="polite"><div class="chatEmpty">Connecting…</div></div>
      <form id="chatForm"><input id="chatInput" aria-label="Message" maxlength="240" autocomplete="off" placeholder="Say something to the mountain…" ${save.name ? '' : 'disabled'}><button class="btn primary" id="chatSend" type="submit" aria-label="Send" ${save.name ? '' : 'disabled'}><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button></form>
      <div class="chatFoot"><div id="chatStatus" role="status">Connected · updates every 5 seconds</div><div class="chatCount" id="chatCount">0 / 240</div></div>
      ${blocked.size ? `<button class="btn" id="chatUnmute" type="button">Unmute players (${blocked.size})</button>` : '<button class="btn hidden" id="chatUnmute" type="button">Unmute players</button>'}`);
    if (!save.name) nameForm($('chatName'), openChat);
    else $('chatName').textContent = `Chatting as ${save.name}`;
    $('chatUnmute').onclick = () => { blocked.clear(); try { localStorage.removeItem('peakflip_chat_blocked'); } catch {} render(); $('chatUnmute').textContent = 'Unmute players'; setStatus('All players unmuted.'); };
    const input = $('chatInput');
    input.oninput = () => { $('chatCount').textContent = `${input.value.length} / 240`; };
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup']) input.addEventListener(type, e => e.stopPropagation());
    $('chatForm').onsubmit = async e => {
      e.preventDefault();
      const body = input.value.trim(); if (!body || sending) return;
      if (!isClean(body)) { setStatus('Keep it friendly: that message has a word we don’t allow.'); return; }
      const button = $('chatSend'), request = generation;
      sending = true; button.disabled = true; setStatus('Sending…');
      try {
        const auth = await identity();
        if (!auth?.ok) { setStatus(ERRORS[auth?.error] || 'Could not connect to chat.'); return; }
        const result = await rpc('send_chat_message', { p_pid: save.pid, p_token: save.chatToken, p_body: body });
        if (request !== generation || !isOpen()) return;
        if (!result?.ok) { setStatus(ERRORS[result?.error] || 'Message not sent. Try again.'); return; }
        input.value = ''; $('chatCount').textContent = '0 / 240'; setStatus('Sent');
        await refresh(); input.focus();
      } catch { if (request === generation) setStatus('Message not sent. Check your connection and try again.'); }
      finally { sending = false; if (request === generation && isOpen()) button.disabled = false; }
    };
    render(); refresh();
  }
  setInterval(refresh, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  return { openChat };
}
