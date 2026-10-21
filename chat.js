import { save, persist } from './meta.js';
import { rpc } from './net.js';

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
    .chatIntro { color:var(--muted); font-size:13px; line-height:1.5; }
    #chatMessages { height:min(42vh,360px); min-height:150px; overflow-y:auto; display:flex; flex-direction:column; gap:10px; padding:4px; overscroll-behavior:contain; }
    .chatMessage { padding:10px 12px; background:rgba(255,255,255,.06); border-radius:12px; flex-shrink:0; }
    .chatMessage.mine { border-left:3px solid var(--gold); }
    .chatByline { display:flex; align-items:center; gap:8px; font-size:13px; }
    .chatByline time { color:var(--muted); margin-left:auto; font-size:11px; }
    .chatBody { white-space:pre-wrap; overflow-wrap:anywhere; margin-top:5px; font-size:14px; line-height:1.5; user-select:text; }
    .chatActions { display:flex; gap:12px; margin-top:5px; }
    .chatActions button { background:none; border:0; padding:2px 0; color:var(--muted); font:inherit; font-size:11px; cursor:pointer; }
    #chatForm { display:flex; gap:8px; }
    #chatInput { min-width:0; flex:1; font:inherit; padding:11px; border-radius:12px; border:1px solid rgba(255,255,255,.2); background:rgba(0,0,0,.18); color:var(--text,#fff); }
    #chatStatus { min-height:20px; font-size:12px; color:var(--muted); }
    #chatForm .btn { width:auto; margin:0; }
    .chatCount { color:var(--muted); font-size:11px; text-align:right; }
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
    const html = visible.length ? visible.map(m => {
      const date = new Date(m.created_at), time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<article class="chatMessage ${m.isMe ? 'mine' : ''}"><div class="chatByline"><b>${escape(m.name)}${m.isMe ? ' · you' : ''}</b><time datetime="${escape(m.created_at)}" title="${escape(date.toLocaleString())}">${escape(time)}</time></div>
        <div class="chatBody">${escape(m.body)}</div>${!m.isMe ? `<div class="chatActions"><button type="button" data-block="${escape(m.author)}">Mute player</button><button type="button" data-report="${m.id}">Report</button></div>` : ''}</article>`;
    }).join('') : '<div class="note">The mountain is quiet. Say hello!</div>';
    if (el.innerHTML === html) return;
    const firstRender = el.dataset.loaded !== 'true';
    el.innerHTML = html; el.dataset.loaded = 'true';
    el.querySelectorAll('[data-block]').forEach(b => b.onclick = () => {
      blocked.add(b.dataset.block);
      try { localStorage.setItem('peakflip_chat_blocked', JSON.stringify([...blocked])); } catch {}
      render(); setStatus('Player muted on this device. Use Unmute players to undo.');
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
    if (loading || !isOpen() || document.hidden) return;
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

  function openChat() {
    generation++;
    openPanel('Global chat', `<div class="chatIntro">Chat with riders across Peak Flip. Keep it friendly and don’t share personal information.</div>
      <div id="chatName"></div><div id="chatMessages" role="log" aria-label="Global messages" aria-live="polite"><div class="note">Connecting…</div></div>
      <form id="chatForm"><input id="chatInput" aria-label="Message" maxlength="240" autocomplete="off" placeholder="Say something to the mountain…" ${save.name ? '' : 'disabled'}><button class="btn primary" id="chatSend" type="submit" ${save.name ? '' : 'disabled'}>Send</button></form>
      <div class="chatCount" id="chatCount">0 / 240</div><div id="chatStatus" role="status">Connected · updates every 5 seconds</div>
      <button class="btn" id="chatUnmute" type="button">Unmute players${blocked.size ? ` (${blocked.size})` : ''}</button>`);
    if (!save.name) nameForm($('chatName'), openChat);
    else $('chatName').textContent = `Playing as ${save.name}`;
    $('chatUnmute').onclick = () => { blocked.clear(); try { localStorage.removeItem('peakflip_chat_blocked'); } catch {} render(); $('chatUnmute').textContent = 'Unmute players'; setStatus('All players unmuted.'); };
    const input = $('chatInput');
    input.oninput = () => { $('chatCount').textContent = `${input.value.length} / 240`; };
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup']) input.addEventListener(type, e => e.stopPropagation());
    $('chatForm').onsubmit = async e => {
      e.preventDefault();
      const body = input.value.trim(); if (!body || sending) return;
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
