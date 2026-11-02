// ============================================================
//  Secret: Idiot, the card game. Type "idiot" on the home screen, tap the Best chip five times, or go to
//  peakflip.io/idiot to open it.
//  Play against bots, or make a lobby and send friends its code or invite link (?idiot=CODE).
//
//  Online games use a Supabase Realtime broadcast channel spoken directly over a WebSocket, like mp.js. The
//  lobby's creator is the host: it holds the game, applies everyone's moves with idiot-rules.js, plays the
//  bots and sends the whole table to the others after every change. If the host leaves, the next player in
//  seat order carries on from the last table everyone was sent. Nothing is stored in the database.
// ============================================================
import { save, persist } from './meta.js';
import { rpc } from './net.js';
import { CG } from './crazy.js';
import { deal, act, botMove, rank, suit, live, need, source, withUp } from './idiot-rules.js';

const SB = window.PEAKFLIP_CONFIG || {};
const ONLINE = !!(SB.supabaseUrl && SB.supabaseKey);
const STAKES = [0, 5, 10, 20, 50, 100];
const MAX = 6, TURN_MS = 30000, SWAP_MS = 45000, AWAY_MS = 10000;
const BOT_NAMES = ['Kari', 'Ola', 'Nora', 'Emil', 'Ingrid', 'Jakob', 'Sofie', 'Lars', 'Maja', 'Henrik'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RN = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }, RW = { 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' };
const SU = ['♣', '♦', '♥', '♠'].map(s => s + '︎');
const rn = r => RN[r] || String(r);
const plural = r => (RW[r] || String(r)) + 's';
const cardName = c => rn(rank(c)) + SU[suit(c)];
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

let myId = null;
try { myId = sessionStorage.getItem('peakflip_idiot_id'); } catch {}
if (!myId) { myId = uid(); try { sessionStorage.setItem('peakflip_idiot_id', myId); } catch {} }
const NAME_KEY = 'peakflip_idiot_name';
function myName() {
  let n = null;
  try { n = localStorage.getItem(NAME_KEY); } catch {}
  return (n ?? save.name ?? '').trim().slice(0, 16);
}
// points identity: a secret key in the save (so it follows the cloud save), and the public id lobbies see,
// the first 16 hex characters of its sha256 (supabase/idiot.sql computes the same)
if (!save.idiotKey) { save.idiotKey = (uid() + uid() + uid()).replace(/[^a-z0-9]/g, '').slice(0, 32); persist(); }
let myPid = '';
crypto.subtle?.digest('SHA-256', new TextEncoder().encode(save.idiotKey))
  .then(h => { myPid = [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16); })
  .catch(() => {});
const PID = /^[0-9a-f]{16}$/;

// ---------- styles ----------
const style = document.createElement('style');
style.textContent = `
#idiot { position: fixed; inset: 0; z-index: 80; background: #0a2f21; color: #fff; overflow-y: auto; overflow-x: hidden;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; user-select: none; -webkit-user-select: none;
  --cw: clamp(50px, 8.2vh, 72px); --ch: calc(var(--cw) * 1.42); --gold: #ffc93c; padding: max(12px, env(safe-area-inset-top)) 16px max(12px, env(safe-area-inset-bottom)); }
#idiot * { box-sizing: border-box; }
#idiot .wrap { max-width: 780px; min-height: 100%; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; padding-bottom: 72px; }
#idiot h2 { margin: 0; font: 400 44px/1 'Lilita One', system-ui, sans-serif; letter-spacing: .01em; }
#idiot h3 { margin: 0; font: 800 13px system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #a9d9c0; }
#idiot p { margin: 0; color: #cfe9db; line-height: 1.45; }
#idiot .btn { background: rgba(255,255,255,.12); border-radius: 99px; padding: 13px 20px; font-size: 16px; }
#idiot .btn:hover { background: rgba(255,255,255,.18); }
#idiot .btn.primary { background: var(--accent, #ff6b2c); }
#idiot .btn.primary:hover { background: var(--accent-2, #e5551a); }
#idiot .btn.small { padding: 8px 14px; font-size: 14px; }
#idiot .btn:disabled { opacity: .4; cursor: default; }
#idiot .panel { background: rgba(255,255,255,.05); border-radius: 18px; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
#idiot .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
#idiot .row > .grow { flex: 1; min-width: 0; }
#idiot input { font: 700 16px system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.28); border: 2px solid transparent; border-radius: 99px;
  padding: 11px 16px; outline: none; width: 100%; user-select: text; -webkit-user-select: text; }
#idiot input:focus { border-color: rgba(255,255,255,.45); }
#idiot input.code { text-transform: uppercase; letter-spacing: .2em; font-size: 18px; }
#idiot .note { font-size: 14px; color: #a9d9c0; }
#idiot .err { color: #ffb4a0; font-size: 14px; font-weight: 700; min-height: 1em; }
#idiot .stepper { display: flex; align-items: center; gap: 4px; background: rgba(0,0,0,.25); border-radius: 99px; padding: 4px; }
#idiot .stepper button { width: 38px; height: 38px; border-radius: 50%; font-size: 20px; font-weight: 800; background: rgba(255,255,255,.1); }
#idiot .stepper b { min-width: 74px; text-align: center; font-size: 15px; }
#idiot .top { display: flex; align-items: center; gap: 10px; min-height: 44px; }
#idiot .top .title { flex: 1; font: 400 26px/1 'Lilita One', system-ui, sans-serif; }
#idiot .codeChip { font: 800 14px system-ui, sans-serif; letter-spacing: .14em; background: rgba(0,0,0,.25); border-radius: 99px; padding: 8px 14px; }
#idiot ul.rules { margin: 0; padding-left: 20px; color: #cfe9db; line-height: 1.5; font-size: 15px; display: flex; flex-direction: column; gap: 4px; }
#idiot ul.rules b { color: #fff; }
#idiot .seat { display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,.2); border-radius: 14px; padding: 10px 12px; font-weight: 700; }
#idiot .seat .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#idiot .tag { font: 800 10px system-ui, sans-serif; letter-spacing: .08em; background: rgba(255,255,255,.16); color: #dff3e8; border-radius: 6px; padding: 3px 6px; vertical-align: 2px; }
#idiot .tag.host { background: var(--gold); color: #3a2a00; }
#idiot .x { width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,.1); font-size: 18px; line-height: 1; }
#idiot .ava { width: 34px; height: 34px; border-radius: 50%; flex: none; display: grid; place-items: center; font: 400 17px/1 'Lilita One', system-ui, sans-serif;
  color: #fff; box-shadow: 0 0 0 2px rgba(255,255,255,.18); }
#idiot .lobbyRow { display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,.2); border-radius: 14px; padding: 8px 8px 8px 12px; }
#idiot .lobbyRow .grow { flex: 1; min-width: 0; }
#idiot .lobbyRow b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#idiot .lobbyRow small { color: #a9d9c0; font-size: 13px; }

/* cards: a corner index top left and bottom right, a big pip (or the letter for court cards) in the middle */
#idiot .cd { position: relative; width: var(--cw); height: var(--ch); border-radius: calc(var(--cw) * .11); flex: none; display: block; padding: 0; overflow: hidden;
  background: #fffdf7; color: #1d2230; border: 1px solid #ddd6c6; box-shadow: 0 2px 0 rgba(0,0,0,.18), 0 6px 14px rgba(0,0,0,.28);
  transition: transform .14s, opacity .14s, box-shadow .14s; font-variant-emoji: text; }
#idiot .cd.red { color: #c62a2f; }
#idiot .cd .ix { position: absolute; left: calc(var(--cw) * .07); top: calc(var(--cw) * .06); display: flex; flex-direction: column; align-items: center;
  font: 800 calc(var(--cw) * .25)/.95 system-ui, sans-serif; letter-spacing: -.05em; }
#idiot .cd .ix i { font: 400 calc(var(--cw) * .2)/1 system-ui, sans-serif; font-style: normal; letter-spacing: 0; }
#idiot .cd .ix.br { left: auto; top: auto; right: calc(var(--cw) * .07); bottom: calc(var(--cw) * .06); transform: rotate(180deg); }
#idiot .cd .pip { position: absolute; inset: 0; display: grid; place-items: center; font: 400 calc(var(--cw) * .52)/1 system-ui, sans-serif; }
#idiot .cd .pip.court { font: 400 calc(var(--cw) * .5)/1 'Lilita One', system-ui, sans-serif; }
#idiot .cd.back { border: calc(var(--cw) * .05) solid #fffdf7; background-color: #1c3f74;
  background-image: repeating-linear-gradient(45deg, rgba(255,255,255,.12) 0 2px, transparent 2px 8px), repeating-linear-gradient(-45deg, rgba(255,255,255,.12) 0 2px, transparent 2px 8px); }
#idiot .cd.slot { background: rgba(0,0,0,.16); border: 2px dashed rgba(255,255,255,.14); box-shadow: none; }
#idiot button.cd { cursor: pointer; }
#idiot button.cd:hover:not(.sel) { transform: translateY(-4px); }
#idiot .cd.sel { transform: translateY(-16px); box-shadow: 0 0 0 3px var(--gold), 0 10px 18px rgba(0,0,0,.35); }
#idiot .cd.dim { filter: brightness(.62); }
#idiot .cd.pick, #idiot .cd.tap { box-shadow: 0 0 0 3px var(--gold), 0 6px 14px rgba(0,0,0,.28); }
#idiot .mini { --cw: 26px; --ch: 37px; }
#idiot .mini .cd { box-shadow: 0 1px 2px rgba(0,0,0,.35); }
#idiot .mini .cd .ix { font-size: 11px; left: 2px; top: 2px; }
#idiot .mini .cd .ix i { font-size: 10px; }
#idiot .mini .cd .ix.br, #idiot .mini .cd .pip { display: none; }
#idiot .stack { position: relative; width: var(--cw); height: calc(var(--ch) + 8px); flex: none; }
#idiot .stack > .cd { position: absolute; left: 0; top: 8px; }
#idiot .stack > .cd + .cd { top: 0; left: 0; }
#idiot .stacks { display: flex; gap: 10px; justify-content: center; }
#idiot .mini .stacks { gap: 3px; }

/* the table: green baize inside a wooden rail */
#idiot .felt { position: relative; background: #13603f; border-radius: 40px; padding: 18px 14px 14px;
  box-shadow: inset 0 0 0 10px #6b4426, inset 0 0 0 12px #4e3019, inset 0 0 70px rgba(0,0,0,.35), 0 10px 30px rgba(0,0,0,.35);
  display: flex; flex-direction: column; gap: 10px; }
#idiot .opps { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; padding: 0 6px; }
#idiot .opp { position: relative; background: rgba(0,0,0,.2); border-radius: 16px; padding: 8px 10px; min-width: 112px; display: flex; flex-direction: column; gap: 6px; align-items: center;
  box-shadow: inset 0 0 0 2px transparent; transition: box-shadow .2s; }
#idiot .opp.turn { box-shadow: inset 0 0 0 2px var(--gold); }
#idiot .opp.turn .ava { box-shadow: 0 0 0 3px var(--gold); }
#idiot .opp .who { display: flex; align-items: center; gap: 7px; max-width: 150px; }
#idiot .opp .nm { font-weight: 800; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.15; }
#idiot .opp .nm small { display: block; font: 700 11px system-ui, sans-serif; color: #a9d9c0; }
#idiot .opp .ava { width: 28px; height: 28px; font-size: 14px; }
#idiot .opp .say { position: absolute; left: 50%; top: -6px; transform: translate(-50%, -100%); max-width: 180px; background: #fffdf7; color: #1d2230;
  font: 700 13px/1.3 system-ui, sans-serif; padding: 6px 10px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,.3); z-index: 2; overflow-wrap: anywhere; animation: iqIn .2s; }
#idiot .count { font: 800 12px system-ui, sans-serif; background: rgba(0,0,0,.3); border-radius: 99px; padding: 3px 8px; white-space: nowrap; }
#idiot .place { font: 400 15px 'Lilita One', system-ui, sans-serif; color: var(--gold); }
#idiot .timer { font: 800 12px system-ui, sans-serif; color: var(--gold); font-variant-numeric: tabular-nums; }
#idiot .center { display: flex; justify-content: center; align-items: flex-end; gap: 34px; padding: 10px 0 2px; }
#idiot .pileBox { display: flex; flex-direction: column; align-items: center; gap: 8px; }
#idiot .deck .cd { box-shadow: 1px 1px 0 #e9e2d2, 2px 2px 0 #c9c1b0, 3px 3px 0 #e9e2d2, 4px 4px 0 #b7ae9c, 0 8px 16px rgba(0,0,0,.3); }
#idiot .pile { position: relative; width: calc(var(--cw) + 36px); height: calc(var(--ch) + 10px); }
#idiot .pile .cd { position: absolute; top: 5px; }
#idiot .pile .cd.new { animation: iqIn .25s ease-out; }
@keyframes iqIn { from { opacity: 0; } to { opacity: 1; } }
#idiot .lbl { font: 700 12px system-ui, sans-serif; color: #cfe9db; text-align: center; white-space: nowrap; background: rgba(0,0,0,.25); border-radius: 99px; padding: 4px 10px; }
#idiot .lbl b { color: #fff; }
#idiot .burn { position: absolute; inset: 0; display: grid; place-items: center; font: 400 28px 'Lilita One', system-ui, sans-serif; color: var(--gold); animation: iqBurn 1.4s ease-out forwards; pointer-events: none; }
@keyframes iqBurn { 0% { opacity: 0; } 15% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }
#idiot .ev { text-align: center; font-size: 14px; color: #e4f5ec; min-height: 20px; }
#idiot .status { align-self: center; text-align: center; font-weight: 800; font-size: 15px; min-height: 22px; padding: 7px 16px; border-radius: 99px; background: rgba(255,255,255,.07); }
#idiot .mine.turn .status { background: var(--gold); color: #3a2a00; }
#idiot .mine.turn .status .timer { color: #3a2a00; }
#idiot .mine { display: flex; flex-direction: column; gap: 12px; align-items: center; padding: 4px 0 8px; }
#idiot .mine .cards { display: flex; gap: 22px; align-items: flex-end; justify-content: center; width: 100%; }
#idiot .hand { display: flex; justify-content: center; flex: 0 1 auto; min-width: 0; padding-top: 16px; min-height: calc(var(--ch) + 16px); }
#idiot .mine .cards .stacks { flex: none; }
@media (max-width: 620px) { #idiot .mine .cards { flex-direction: column; align-items: center; gap: 10px; } #idiot .hand { width: 100%; flex: none; } }
#idiot .hand .cd + .cd { margin-left: var(--ov, 6px); }
#idiot .actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
#idiot .actions .btn { min-width: 130px; }
#idiot .result { display: flex; flex-direction: column; gap: 8px; }
#idiot .result .seat.idiot { background: var(--gold); color: #3a2a00; }
#idiot .bigName { font: 400 34px/1.05 'Lilita One', system-ui, sans-serif; color: var(--gold); text-align: center; overflow-wrap: anywhere; }

/* chat: a button bottom right and a sheet above it; kept outside the redrawn page so typing survives updates */
#idiot .chatBtn { position: fixed; right: 16px; bottom: max(16px, env(safe-area-inset-bottom)); z-index: 3; border-radius: 99px; padding: 12px 18px;
  background: #fffdf7; color: #0a2f21; font: 800 15px system-ui, sans-serif; box-shadow: 0 6px 18px rgba(0,0,0,.35); display: flex; gap: 8px; align-items: center; }
#idiot .chatBtn i { font-style: normal; min-width: 20px; height: 20px; border-radius: 99px; background: var(--accent, #ff6b2c); color: #fff; font-size: 12px; display: grid; place-items: center; padding: 0 6px; }
#idiot .sheet { position: fixed; right: 16px; bottom: calc(max(16px, env(safe-area-inset-bottom)) + 58px); z-index: 3; width: min(380px, calc(100vw - 32px)); height: min(440px, 60vh);
  background: #0f3a2a; border-radius: 20px; box-shadow: 0 16px 40px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.08); display: flex; flex-direction: column; overflow: hidden; }
#idiot .sheet .msgs { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; user-select: text; -webkit-user-select: text; }
#idiot .sheet .msg { max-width: 85%; align-self: flex-start; background: rgba(255,255,255,.09); border-radius: 14px; padding: 7px 11px; font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; }
#idiot .sheet .msg b { display: block; font-size: 12px; color: #a9d9c0; }
#idiot .sheet .msg.me { align-self: flex-end; background: #fffdf7; color: #1d2230; }
#idiot .sheet .msg.me b { display: none; }
#idiot .sheet form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid rgba(255,255,255,.08); margin: 0; }
#idiot .sheet .empty { color: #a9d9c0; font-size: 14px; text-align: center; margin: auto 0; }

@media (max-width: 520px) {
  #idiot { --cw: 56px; }
  #idiot h2 { font-size: 38px; }
  #idiot .felt { border-radius: 28px; padding: 16px 8px 12px; }
  #idiot .center { gap: 22px; }
  #idiot .opp { min-width: 100px; padding: 7px 8px; }
  #idiot .actions .btn { min-width: 0; flex: 1; padding: 13px 10px; }
  #idiot .sheet { height: 46vh; }
}
`;
document.head.appendChild(style);

// ---------- sound (respects the game's mute) ----------
let ac = null;
function tone(f, d = 0.08, v = 0.05, type = 'triangle') {
  if (save.muted) return;
  try {
    ac = ac || new AudioContext();
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d);
  } catch {}
}

// ---------- the realtime channel ----------
function channel(code, onMsg, onStatus) {
  const url = `${SB.supabaseUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${SB.supabaseKey}&vsn=1.0.0`;
  const topic = `realtime:idiot-${code}`;
  let ws = null, ref = 0, joined = false, closed = false, beat = null, retry = 0;
  const raw = (t, event, payload) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ topic: t, event, payload, ref: String(++ref) })); };
  function connect() {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      raw(topic, 'phx_join', { config: { broadcast: { self: false }, presence: { key: '' } } });
      clearInterval(beat); beat = setInterval(() => raw('phoenix', 'heartbeat', {}), 25000);
    };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.topic !== topic) return;
      if (m.event === 'phx_reply' && m.payload?.status === 'ok' && !joined) { joined = true; retry = 0; onStatus(true); }
      if (m.event === 'broadcast' && m.payload?.payload && typeof m.payload.event === 'string') onMsg(m.payload.event, m.payload.payload);
    };
    ws.onclose = () => {
      const was = joined;
      joined = false; clearInterval(beat);
      if (closed) return;
      if (was) onStatus(false);
      setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
    };
  }
  connect();
  return {
    send(event, payload) { if (joined) raw(topic, 'broadcast', { type: 'broadcast', event, payload }); return joined; },
    close() { closed = true; clearInterval(beat); setTimeout(() => ws?.close(), 80); },
    get online() { return joined; },
  };
}

// ---------- session ----------
// S.room is the shared table: { code, host, v, seats: [{ id, name, bot, away }], game, acks: { id: last action key } }
let S = null, root = null, view = 'menu', menuErr = '', botCount = 3, showRules = false;
let board = null, boardBack = 'menu';
let dir = null, dirSweep = null;                   // the open-lobbies channel, while Idiot is open
const lobbies = new Map();                         // code -> what its host last announced
let chat = [], chatOpen = false, unread = 0;
const said = new Map();                            // player id -> { t, at }: the bubble over their seat
let sel = new Set(), swapPick = null, lastEvN = 0, lastTurnMine = false, leaveArmed = 0;

const isOpen = () => !!root;
const game = () => S?.room?.game;
const meIdx = () => game() ? game().players.findIndex(p => p.id === myId) : -1;
const seatOf = id => S.room.seats.find(s => s.id === id);
// a seat the host plays for: a bot, or someone who has gone quiet
const auto = i => { const p = game().players[i], s = seatOf(p.id); return p.bot || !s || !!s.away; };

function open(code) {
  if (root) return;
  root = document.createElement('div');
  root.id = 'idiot';
  root.innerHTML = `<div id="iqMain"></div><div id="iqChat"><button class="chatBtn hidden" data-a="chat">Chat <i class="hidden"></i></button>
    <div class="sheet hidden"><div class="msgs"></div><form data-chat><input id="iqSay" maxlength="140" placeholder="Say something" autocomplete="off">
    <button class="btn primary small" type="submit">Send</button></form></div></div>`;
  root.querySelector('form[data-chat]').addEventListener('submit', e => { e.preventDefault(); say(); });
  document.body.appendChild(root);
  openDir();
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  view = 'menu'; menuErr = '';
  if (code) join(code); else render();
}

function close() {
  endSession();
  dir?.close(); dir = null; clearInterval(dirSweep); lobbies.clear();
  root?.remove(); root = null;
}

function endSession() {
  if (!S) return;
  if (S.ch) { S.ch.send('bye', { id: myId }); S.ch.close(); }
  if (S.host && S.code) dir?.send('lobby', { code: S.code, closed: true });
  clearInterval(S.tick);
  S = null; sel = new Set(); swapPick = null;
  chat = []; unread = 0; chatOpen = false; said.clear();
  drawChat();
}

// ---------- open lobbies: hosts of open lobbies announce them every few seconds on a shared channel ----------
function openDir() {
  if (dir || !ONLINE) return;
  dir = channel('lobbies', (ev, p) => {
    if (ev !== 'lobby' || typeof p.code !== 'string' || !/^[A-Z0-9]{5}$/.test(p.code)) return;
    if (p.closed) lobbies.delete(p.code);
    else lobbies.set(p.code, { code: p.code, host: String(p.host || '').slice(0, 16), n: +p.n || 1, stake: +p.stake || 0, playing: !!p.playing, at: Date.now() });
    drawLobbies();
  }, () => {});
  clearInterval(dirSweep);
  dirSweep = setInterval(() => {
    let gone = false;
    for (const [k, l] of lobbies) if (Date.now() - l.at > 9000) { lobbies.delete(k); gone = true; }
    if (gone) drawLobbies();
  }, 2000);
}

function announce() {
  const r = S.room;
  if (!dir || !r.open) return;
  dir.send('lobby', { code: r.code, host: seatOf(myId)?.name || myName(), n: r.seats.length, stake: r.stake || 0, playing: !!r.game && r.game.phase !== 'over' });
}

function drawLobbies() {
  const el = root?.querySelector('#iqLobbies');
  if (!el) return;
  const list = [...lobbies.values()].filter(l => l.code !== S?.code).sort((a, b) => a.playing - b.playing || b.n - a.n);
  el.innerHTML = list.length ? list.map(l => `<div class="lobbyRow"><div class="ava" style="background:${hue(l.host)}">${esc(l.host.slice(0, 1).toUpperCase() || '?')}</div>
    <div class="grow"><b>${esc(l.host)}'s table</b><small>${l.n}/${MAX} players · ${l.stake ? `${l.stake} points` : 'for fun'}${l.playing ? ' · playing' : ''}</small></div>
    <button class="btn small ${l.playing || l.n >= MAX ? '' : 'primary'}" data-a="joinCode" data-code="${l.code}">${l.playing ? 'Wait' : l.n >= MAX ? 'Full' : 'Join'}</button></div>`).join('')
    : '<p class="note">No open tables right now. Create one and it shows up here for everyone.</p>';
}

// ---------- chat: broadcast to the table; the host keeps the last few in the room so late joiners see them ----------
function say() {
  const input = root?.querySelector('#iqSay'), t = (input?.value || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!t || !S?.ch || !S.ch.online) return;
  const m = { mid: uid(), id: myId, name: myName(), t };
  S.ch.send('chat', m);
  input.value = '';
  addChat(m);
}

function addChat(m, quiet) {
  if (!m || typeof m.mid !== 'string' || typeof m.t !== 'string' || chat.some(x => x.mid === m.mid)) return;
  const msg = { mid: m.mid, id: String(m.id), name: String(m.name || 'Player').slice(0, 16), t: m.t.slice(0, 140) };
  chat.push(msg); if (chat.length > 80) chat.shift();
  if (S?.host && S.room) { S.room.chat = [...(S.room.chat || []), msg].slice(-30); }
  if (quiet) return drawChat();
  if (msg.id !== myId) { if (!chatOpen) unread++; tone(990, 0.05, 0.03); }
  said.set(msg.id, { t: msg.t, at: Date.now() });
  setTimeout(() => { if (view === 'table') render(); }, 5100);
  drawChat();
  if (view === 'table') render();
}

function drawChat() {
  const box = root?.querySelector('#iqChat');
  if (!box) return;
  const on = !!S && S.kind === 'online' && !!S.room && !CG.chatOff && (view === 'lobby' || view === 'table');
  const btn = box.querySelector('.chatBtn'), sheet = box.querySelector('.sheet'), badge = btn.querySelector('i');
  btn.classList.toggle('hidden', !on);
  sheet.classList.toggle('hidden', !on || !chatOpen);
  if (chatOpen) unread = 0;
  badge.textContent = unread > 9 ? '9+' : unread;
  badge.classList.toggle('hidden', !unread);
  btn.firstChild.textContent = chatOpen ? 'Close ' : 'Chat ';
  const msgs = sheet.querySelector('.msgs'), atEnd = msgs.scrollTop + msgs.clientHeight >= msgs.scrollHeight - 30;
  msgs.innerHTML = chat.length ? chat.map(m => `<div class="msg ${m.id === myId ? 'me' : ''}"><b>${esc(m.name)}</b>${esc(m.t)}</div>`).join('')
    : '<p class="empty">Say hi to the table.</p>';
  if (atEnd || chatOpen) msgs.scrollTop = msgs.scrollHeight;
}

// a steady colour per name for the round avatars
const HUES = ['#e8594f', '#f29b38', '#3aa776', '#3b82c4', '#8a63d2', '#d0538f', '#2aa6a6', '#b08a2e'];
const hue = name => HUES[[...String(name)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % HUES.length];

function startSession(kind, code, host) {
  endSession();
  S = { kind, code, host, room: null, ch: null, seen: new Map(), lastHost: Date.now(), pending: null, lastK: 0,
    deadline: 0, dlKey: '', botDue: 0, swapDue: {}, lastBeat: 0, lastPing: 0, seated: false, joinedAt: Date.now(), status: 'connecting' };
  S.tick = setInterval(tick, 200);
}

function playBots() {
  startSession('solo', null, true);
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  S.room = { code: '', host: myId, v: 1, acks: {}, game: null,
    seats: [{ id: myId, name: myName(), pid: myPid }, ...names.slice(0, botCount).map(n => ({ id: uid(), name: n, bot: true }))] };
  S.seated = true;
  startGame();
}

function createLobby() {
  const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  startSession('online', code, true);
  S.room = { code, host: myId, v: 1, acks: {}, game: null, stake: 0, open: true, chat: [], seats: [{ id: myId, name: myName(), pid: myPid, ok: true }] };
  S.seated = true;
  S.ch = channel(code, onMsg, up => { S.status = up ? 'online' : 'offline'; if (up) broadcast(); render(); });
  view = 'lobby'; render();
}

function join(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 5) { menuErr = 'Lobby codes are 5 letters.'; view = 'menu'; return render(); }
  if (!ONLINE) { menuErr = 'Online play is not available here.'; view = 'menu'; return render(); }
  startSession('online', code, false);
  S.ch = channel(code, onMsg, up => { S.status = up ? 'online' : 'offline'; if (up) hello(); render(); });
  view = 'lobby'; render();
}

function hello() { S?.ch?.send('hi', { id: myId, name: myName(), pid: myPid }); }

// ---------- host side ----------
function startGame() {
  const r = S.room;
  r.seats = r.seats.filter(s => s.bot || !s.gone);
  r.game = deal(r.seats.map(s => ({ id: s.id, name: s.name, bot: !!s.bot })));
  r.game.gid = (uid() + uid()).replace(/[^a-z0-9]/g, '');
  r.game.stake = S.kind === 'online' ? r.stake || 0 : 0;
  S.swapDue = {};
  commit();
  view = 'table'; render();
}

function commit() {
  const r = S.room, g = r.game;
  if (g?.phase === 'over' && !g.result) settle(g);
  r.v++;
  // a fresh clock for every new turn (and once for the swap)
  const key = g ? (g.phase === 'swap' ? 'swap' : `${g.phase}:${g.turn}:${g.evN}`) : '';
  if (key !== S.dlKey) {
    S.dlKey = key; S.botDue = 0;
    S.deadline = S.kind !== 'online' || !g ? 0 : g.phase === 'swap' ? Date.now() + SWAP_MS : g.phase === 'play' ? Date.now() + TURN_MS : 0;
  }
  broadcast();
  render();
}

// the stake: the first human out wins it from the last human out (the Idiot, unless a bot came last)
function settle(g) {
  const humans = g.players.filter(p => !p.bot && PID.test(seatOf(p.id)?.pid || '')).sort((a, b) => a.place - b.place);
  if (!g.stake || humans.length < 2) { g.result = { stake: 0 }; return; }
  const w = humans[0], l = humans[humans.length - 1], pid = p => seatOf(p.id).pid;
  g.result = { stake: g.stake, winner: w.name, loser: l.name };
  const args = { p_game: g.gid, p_stake: g.stake, p_winner: pid(w), p_loser: pid(l), p_players: humans.map(p => ({ pid: pid(p), name: p.name })) };
  const report = (tries = 0) => rpc('idiot_result', args).catch(() => { if (tries < 5) setTimeout(() => report(tries + 1), 3000 * (tries + 1)); });
  report();
}

function broadcast() {
  if (!S?.ch || !S.host) return;
  S.lastBeat = Date.now();
  S.ch.send('st', { ...S.room, left: S.deadline ? Math.max(0, S.deadline - Date.now()) : 0 });
}

function hostAct(id, a) {
  const g = game(), i = g ? g.players.findIndex(p => p.id === id) : -1;
  if (i < 0) return 'seat';
  const err = act(g, i, a);
  if (!err) commit();
  return err;
}

function hostTick(now) {
  const r = S.room, g = r.game;
  const mine = seatOf(myId);
  if (mine && !mine.pid && myPid) mine.pid = myPid;
  if (S.kind === 'online') {
    // presence: quiet humans leave the lobby, or get a bot playing for them in a game
    let changed = false;
    for (const s of [...r.seats]) {
      if (s.bot || s.id === myId) continue;
      const gone = s.gone || now - (S.seen.get(s.id) || 0) > AWAY_MS;
      if (!g) { if (gone) { r.seats.splice(r.seats.indexOf(s), 1); changed = true; } }
      else if (!!s.away !== gone) { s.away = gone; changed = true; }
    }
    if (changed) return commit();
    if (now - S.lastBeat > 2000) { broadcast(); if (now - (S.lastAnnounce || 0) > 3000) { S.lastAnnounce = now; announce(); } }
  }
  if (!g) return;
  if (g.phase === 'swap') {
    g.players.forEach((p, i) => {
      if (p.ready) return;
      if (auto(i)) {
        S.swapDue[i] = S.swapDue[i] || now + 900 + Math.random() * 1800;
        if (now < S.swapDue[i]) return;
        let a, guard = 0;
        do { a = botMove(g, i); act(g, i, a); } while (a.t !== 'ready' && ++guard < 6);
        if (a.t !== 'ready') act(g, i, { t: 'ready' });
        commit();
      } else if (S.deadline && now > S.deadline) { act(g, i, { t: 'ready' }); commit(); }   // out of time: play what you have
    });
    return;
  }
  if (g.phase !== 'play') return;
  const i = g.turn;
  if (auto(i)) {
    if (!S.botDue) S.botDue = now + 750 + Math.random() * 650;
    else if (now >= S.botDue) { S.botDue = 0; act(g, i, botMove(g, i)); commit(); }
  } else if (S.deadline && now > S.deadline) { S.deadline = 0; act(g, i, botMove(g, i)); commit(); }
}

// ---------- messages ----------
function onMsg(ev, p) {
  if (!S || typeof p !== 'object') return;
  const now = Date.now();
  if (typeof p.id === 'string') S.seen.set(p.id, now);
  if (ev === 'chat') return addChat(p);
  if (ev === 'st') return onState(p);
  if (ev === 'bye') {
    if (p.id === S.room?.host) { S.lastHost = 0; return; }   // the host left: someone takes over at once
    if (S.host) { const s = seatOf(p.id); if (s && !s.bot) { s.gone = true; S.seen.delete(p.id); } }
    return;
  }
  if (!S.host) return;
  const r = S.room;
  if (ev === 'hi' && typeof p.id === 'string') {
    const name = String(p.name || 'Player').slice(0, 16);
    const s = seatOf(p.id);
    if (s) { if (s.gone || s.away) { s.gone = false; s.away = false; commit(); } else broadcast(); return; }
    const pid = PID.test(p.pid) && !r.seats.some(q => q.pid === p.pid) ? p.pid : '';
    if ((!r.game || r.game.phase === 'over') && r.seats.length < MAX) { r.seats.push({ id: p.id, name, pid }); commit(); }
    else broadcast();
    return;
  }
  if (ev === 'ping') {   // a points id that wasn't ready when they joined
    const s = seatOf(p.id);
    if (s && !s.pid && PID.test(p.pid) && !r.seats.some(q => q.pid === p.pid)) { s.pid = p.pid; commit(); }
    return;
  }
  if (ev === 'ok' && typeof p.id === 'string') {
    const s = seatOf(p.id);
    if (s && !s.bot) { s.ok = !!p.ok && p.stake === r.stake; commit(); }
    return;
  }
  if (ev === 'act' && typeof p.id === 'string' && p.a && typeof p.a.k === 'number') {
    if ((r.acks[p.id] || 0) >= p.a.k) return broadcast();   // a repeat of something already done
    r.acks[p.id] = p.a.k;
    if (hostAct(p.id, p.a)) commit();                       // refused: still confirm so they stop resending
  }
}

function onState(p) {
  if (!p || !Array.isArray(p.seats) || typeof p.v !== 'number') return;
  if (Array.isArray(p.chat) && p.code === S.code) for (const m of p.chat) addChat(m, true);
  const r = S.room;
  if (r && p.v <= r.v && !(p.host !== r.host && p.v === r.v)) { if (p.host === r.host) S.lastHost = Date.now(); return; }
  if (p.code !== S.code) return;
  if (S.host && p.host !== myId) S.host = false;   // someone else took over while we were away
  const { left, ...room } = p;
  S.room = room; S.lastHost = Date.now();
  S.deadline = left ? Date.now() + left : 0;
  if (S.pending && (room.acks?.[myId] || 0) >= S.pending.a.k) S.pending = null;
  const seated = room.seats.some(s => s.id === myId);
  if (S.seated && !seated && !room.game) { endSession(); menuErr = 'You were removed from the lobby.'; view = 'menu'; return render(); }
  S.seated = seated;
  const next = room.game && meIdx() >= 0 ? 'table' : 'lobby';
  if (view === 'board') boardBack = next; else view = next;
  render();
}

function send(a) {
  if (!S || !game()) return;
  if (S.host) { hostAct(myId, a); return; }
  const k = S.lastK = Math.max(Date.now(), S.lastK + 1);
  S.pending = { a: { ...a, k }, at: Date.now(), tries: 0 };
  S.ch.send('act', { id: myId, a: S.pending.a });
  render();
}

function tick() {
  if (!S) return;
  const now = Date.now();
  if (S.host) hostTick(now);
  if (S.kind === 'online' && !S.host) {
    if (now - S.lastPing > 2000) { S.lastPing = now; S.ch.send(S.seated ? 'ping' : 'hi', { id: myId, name: myName(), pid: myPid }); }
    if (S.pending && now - S.pending.at > 1500) {
      if (++S.pending.tries > 6) S.pending = null;
      else { S.pending.at = now; S.ch.send('act', { id: myId, a: S.pending.a }); }
    }
    if (!S.room && now - S.joinedAt > 9000 && S.status === 'online') {
      const code = S.code; endSession(); menuErr = `No lobby with the code ${code}. Check it and try again.`; view = 'menu'; return render();
    }
    // the host went quiet: the first player still here (in seat order) takes over with the last table
    if (S.room && S.seated && now - S.lastHost > 8000) {
      const r = S.room;
      const next = r.seats.find(s => !s.bot && !s.gone && s.id !== r.host && (s.id === myId || now - (S.seen.get(s.id) || 0) < 6000));
      if (next?.id === myId) {
        const old = seatOf(r.host);
        if (old) { if (r.game) old.away = true; else r.seats.splice(r.seats.indexOf(old), 1); }
        r.host = myId; r.v += 1000; S.host = true; S.pending = null; S.dlKey = '';
        commit();
      }
    }
  }
  showClock();
}

function showClock() {
  for (const t of root?.querySelectorAll('[data-timer]') || []) {
    const s = S?.deadline ? Math.ceil((S.deadline - Date.now()) / 1000) : 0;
    t.textContent = s > 0 && s <= 15 ? `${s}s` : '';
  }
}

// ---------- input ----------
function onInput(e) {
  if (e.target.id === 'iqName') { try { localStorage.setItem(NAME_KEY, e.target.value.trim().slice(0, 16)); } catch {} }
  if (e.target.id === 'iqCode') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function onClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b || b.disabled) return;
  const a = b.dataset.a;
  tone(660, 0.04, 0.03);
  if (a === 'close') return close();
  if (a === 'chat') { chatOpen = !chatOpen; drawChat(); if (chatOpen) root.querySelector('#iqSay')?.focus(); return; }
  if (a === 'joinCode') {
    if (!myName()) { menuErr = 'Choose a name first.'; render(); root.querySelector('#iqName')?.focus(); return; }
    return join(b.dataset.code);
  }
  if (a === 'open' && S?.host) { S.room.open = !S.room.open; if (!S.room.open) dir?.send('lobby', { code: S.code, closed: true }); else announce(); return commit(); }
  if (a === 'rules') { showRules = !showRules; return render(); }
  if (a === 'bots-') { botCount = Math.max(1, botCount - 1); return render(); }
  if (a === 'bots+') { botCount = Math.min(MAX - 1, botCount + 1); return render(); }
  if ((a === 'solo' || a === 'create' || a === 'join') && !myName()) {
    menuErr = 'Choose a name first.'; render(); root.querySelector('#iqName')?.focus(); return;
  }
  if (a === 'solo') return playBots();
  if (a === 'create') return createLobby();
  if (a === 'join') return join(root.querySelector('#iqCode')?.value);
  if (a === 'board') { boardBack = view; view = 'board'; return loadBoard(); }
  if (a === 'back') { view = S ? boardBack : 'menu'; return render(); }
  if (a === 'paid') {
    b.disabled = true;
    rpc('idiot_paid', { p_key: save.idiotKey, p_id: +b.dataset.id }).then(loadBoard, () => { b.disabled = false; });
    return;
  }
  if (a === 'stake' && S?.host && !game()) {
    S.room.stake = +b.dataset.v;
    for (const s of S.room.seats) s.ok = s.id === myId;
    return commit();
  }
  if (a === 'agree' && S && !S.host && S.room && !game()) {
    const s = seatOf(myId), ok = !s?.ok;
    if (s) s.ok = ok;
    S.ch.send('ok', { id: myId, ok, stake: S.room.stake });
    return render();
  }
  if (a === 'leave') {
    if (game()?.phase === 'play' && meIdx() >= 0 && !game().players[meIdx()].place && Date.now() - leaveArmed > 2500) { leaveArmed = Date.now(); setTimeout(render, 2600); return render(); }
    leaveArmed = 0; endSession(); view = 'menu'; menuErr = ''; return render();
  }
  if (a === 'invite') return invite(b);
  if (a === 'addbot' && S?.host && !game() && S.room.seats.length < MAX) {
    const used = new Set(S.room.seats.map(s => s.name));
    S.room.seats.push({ id: uid(), name: BOT_NAMES.find(n => !used.has(n)) || 'Bot', bot: true });
    return commit();
  }
  if (a === 'kick' && S?.host && !game()) {
    S.room.seats = S.room.seats.filter(s => s.id !== b.dataset.id || s.id === myId);
    return commit();
  }
  if (a === 'start' && S?.host && canStart()) return startGame();
  if (a === 'again' && S?.host) return startGame();
  if (a === 'lobby' && S?.host) {
    if (S.kind === 'solo') { endSession(); view = 'menu'; return render(); }
    S.room.game = null; S.room.seats = S.room.seats.filter(s => s.bot || !s.gone); view = 'lobby';
    return commit();
  }
  // the table
  const g = game(), mi = meIdx();
  if (!g || mi < 0) return;
  const me = g.players[mi];
  if (g.phase === 'swap' && !me.ready) {
    if (a === 'ready') { swapPick = null; return send({ t: 'ready' }); }
    if (a === 'hand') {
      const c = +b.dataset.c;
      if (swapPick?.up != null) { send({ t: 'swap', h: c, u: swapPick.up }); swapPick = null; }
      else swapPick = swapPick?.h === c ? null : { h: c };
      return render();
    }
    if (a === 'up') {
      const u = +b.dataset.slot;
      if (swapPick?.h != null) { send({ t: 'swap', h: swapPick.h, u }); swapPick = null; }
      else swapPick = swapPick?.up === u ? null : { up: u };
      return render();
    }
    return;
  }
  if (g.phase !== 'play') return;
  const from = source(me), mine = g.turn === mi;
  if ((a === 'hand' && from === 'hand') || (a === 'up' && (from === 'up' || from === 'hand'))) {
    const c = a === 'hand' ? +b.dataset.c : me.up[+b.dataset.slot];
    const pool = playPool(g, me);
    if (sel.has(c)) sel.delete(c);
    else if (!sel.size || rank([...sel][0]) !== rank(c)) sel = new Set(pool.filter(x => rank(x) === rank(c)));
    else sel.add(c);
    return render();
  }
  if (!mine || S.pending) return;
  if (a === 'down' && from === 'down') return send({ t: 'blind', i: +b.dataset.slot });
  if (a === 'play' && sel.size) { const cards = [...sel]; sel = new Set(); return send({ t: 'play', cards }); }
  if (a === 'pickup') { sel = new Set(); return send({ t: 'pickup' }); }
  if (a === 'chance') { sel = new Set(); return send({ t: 'chance' }); }
}

// the cards you can pick from: the hand (plus matching face-up cards once the deck is empty), or the face-up cards
function playPool(g, p) {
  const from = source(p);
  if (from === 'up') return live(p.up);
  if (from !== 'hand') return [];
  return withUp(g, p, rank(p.hand[0])) ? [...p.hand, ...live(p.up).filter(c => rank(c) === rank(p.hand[0]))] : p.hand;
}

function canStart() {
  const r = S.room;
  return r.seats.length >= 2 && (!r.stake || r.seats.every(s => s.bot || s.ok));
}

async function loadBoard() {
  board = board || { loading: true };
  render();
  try { board = await rpc('idiot_board', { p_key: save.idiotKey }); }
  catch { board = { error: true }; }
  if (view === 'board') render();
}

async function invite(b) {
  const link = /^(localhost|127\.)/.test(location.hostname) ? `${location.origin}/?idiot=${S.code}` : `${location.origin}/idiot/${S.code}`;
  const text = SB.platform === 'crazygames' ? S.code : link;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches && SB.platform !== 'crazygames') await navigator.share({ title: 'Idiot', text: `Join my Idiot game: ${S.code}`, url: link });
    else { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; setTimeout(() => { if (b.isConnected) b.textContent = SB.platform === 'crazygames' ? 'Copy code' : 'Copy invite link'; }, 1600); }
  } catch {}
}

// keys: nothing reaches the mountain while the table is open
addEventListener('keydown', e => {
  if (!root) return;
  e.stopImmediatePropagation();
  if (e.key === 'Escape' && chatOpen) { chatOpen = false; return drawChat(); }
  if (e.key === 'Escape' && view === 'menu') close();
  if (e.key === 'Enter' && e.target?.id === 'iqCode') join(e.target.value);
}, true);

// ---------- drawing ----------
const cardEl = (c, cls = '', attrs = '', tag = 'div') => {
  const r = rank(c), su = SU[suit(c)], ix = `<b>${rn(r)}</b><i>${su}</i>`;
  return `<${tag} class="cd ${suit(c) === 1 || suit(c) === 2 ? 'red' : ''} ${cls}" ${attrs} aria-label="${rn(r)} of ${['clubs', 'diamonds', 'hearts', 'spades'][suit(c)]}">`
    + `<span class="ix">${ix}</span><span class="pip ${r > 10 && r < 14 ? 'court' : ''}">${r > 10 && r < 14 ? rn(r) : su}</span><span class="ix br">${ix}</span></${tag}>`;
};
const backEl = (cls = '', attrs = '', tag = 'div') => `<${tag} class="cd back ${cls}" ${attrs}></${tag}>`;
const ordinal = n => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

function render() {
  if (!root) return;
  const main = root.querySelector('#iqMain');
  if (view === 'board') main.innerHTML = `<div class="wrap">${boardView()}</div>`;
  else if (view === 'menu' || !S) main.innerHTML = `<div class="wrap">${menuView()}</div>`;
  else if (view === 'lobby') main.innerHTML = `<div class="wrap">${lobbyView()}</div>`;
  else main.innerHTML = `<div class="wrap">${tableView()}</div>`;
  drawLobbies();
  drawChat();
  fitHand();
  showClock();
}

function menuView() {
  return `
  <div class="top"><span class="title"></span><button class="btn small" data-a="close">Close</button></div>
  <h2>Idiot</h2>
  <p>The card game. Get rid of all your cards. The last one still holding cards is the Idiot.</p>
  <div class="panel">
    <h3>Your name</h3>
    <input id="iqName" maxlength="16" value="${esc(myName())}" placeholder="Choose a name" autocomplete="off" spellcheck="false">
    <p class="note">Shown at the table and on the points board.</p>
  </div>
  <div class="panel">
    <h3>Play with bots</h3>
    <div class="row">
      <div class="stepper"><button data-a="bots-" aria-label="Fewer bots">−</button><b>${botCount} bot${botCount > 1 ? 's' : ''}</b><button data-a="bots+" aria-label="More bots">+</button></div>
      <button class="btn primary grow" data-a="solo">Deal</button>
    </div>
  </div>
  <div class="panel">
    <h3>Play with friends</h3>
    ${ONLINE ? `
    <button class="btn primary" data-a="create">Create a lobby</button>
    <div class="row"><input id="iqCode" class="code grow" maxlength="5" placeholder="CODE" autocomplete="off" spellcheck="false" aria-label="Lobby code"><button class="btn" data-a="join">Join</button></div>
    ` : '<p class="note">Online play is not available in this version.</p>'}
    <div class="err">${esc(menuErr)}</div>
  </div>
  ${ONLINE ? `<div class="panel"><h3>Open tables</h3><div id="iqLobbies" style="display:flex;flex-direction:column;gap:8px"></div></div>` : ''}
  ${ONLINE ? '<button class="btn" data-a="board">Points board</button>' : ''}
  <div class="panel">
    <button class="btn small" data-a="rules" style="align-self:flex-start">${showRules ? 'Hide rules' : 'How to play'}</button>
    ${showRules ? rulesList() : ''}
  </div>`;
}

const rulesList = () => `<ul class="rules">
  <li>Everyone gets 3 cards face down, 3 face up on top of them, and 3 in hand. Before play, swap hand cards with your face-up cards. Put your best ones face up.</li>
  <li>The lowest card starts. Play one or more cards of the same rank, <b>equal to or higher</b> than the top of the pile. Aces are high. Draw back up to 3 while the deck lasts.</li>
  <li><b>2</b> goes on anything and resets the pile. <b>10</b> goes on anything and burns the pile. <b>Four of a kind</b> in a row burns it too. After a burn you go again.</li>
  <li>Instead of playing you can always <b>pick up</b> the whole pile, or <b>try the deck</b>, even with good cards in hand: turn over its top card and it is played if it fits. If not, you take it with the pile.</li>
  <li>No building: once you have played and drawn back up, your turn is over.</li>
  <li>When the deck is empty and your hand only holds one rank, you can play those cards together with your face-up cards of the same rank.</li>
  <li>When your hand is gone, play your face-up cards, then your face-down cards blind. If a blind card doesn't fit, you pick up the pile with it.</li>
  <li>The last player holding cards is the <b>Idiot</b>.</li>
  <li>Playing for points: the lobby agrees on a stake. The first person out wins it, the last person out loses it and owes it to the winner. Everyone else is even. Bots don't count.</li>
</ul>`;

function lobbyView() {
  const r = S.room;
  if (!r) return `
    <div class="top"><button class="btn small" data-a="leave">Leave</button><span class="title"></span><span class="codeChip">${esc(S.code)}</span></div>
    <div class="panel"><p>${S.status === 'online' ? 'Looking for the lobby…' : 'Connecting…'}</p></div>`;
  if (!S.seated || r.game) return `
    <div class="top"><button class="btn small" data-a="leave">Leave</button><span class="title">Lobby</span><span class="codeChip">${esc(S.code)}</span></div>
    <div class="panel"><p>${r.game ? (S.seated ? 'You have a seat. You play from the next deal.' : 'A game is on at this table. You get a seat when it ends.')
      : r.seats.length >= MAX ? 'This lobby is full. You get a seat if one opens.' : 'Joining…'}</p></div>`;
  const host = S.host;
  return `
  <div class="top"><button class="btn small" data-a="leave">Leave</button><span class="title">Lobby</span></div>
  <div class="panel">
    <h3>Code</h3>
    <div class="row"><b style="font:400 40px/1 'Lilita One',system-ui,sans-serif;letter-spacing:.12em" class="grow">${esc(r.code)}</b>
    <button class="btn small" data-a="invite">${SB.platform === 'crazygames' ? 'Copy code' : 'Copy invite link'}</button></div>
    <p class="note">Friends open Idiot and type this code, or open the link.</p>
    ${S.host ? `<button class="btn small" data-a="open" style="align-self:flex-start">${r.open ? 'Open table: anyone can find it. Make private' : 'Private: code only. Make open'}</button>`
      : ''}
    ${S.status !== 'online' ? '<p class="err">Connection lost. Reconnecting…</p>' : ''}
  </div>
  ${stakePanel(r)}
  <div class="panel">
    <h3>Players ${r.seats.length}/${MAX}</h3>
    ${r.seats.map(s => `<div class="seat"><span class="grow">${esc(s.name)}${s.id === myId ? ' (you)' : ''}</span>
      ${r.stake && !s.bot ? `<span class="tag" style="${s.ok ? 'background:#3ddc84;color:#06301a' : ''}">${s.ok ? 'AGREED' : 'NOT YET'}</span>` : ''}
      ${s.bot ? '<span class="tag">BOT</span>' : ''}${s.id === r.host ? '<span class="tag host">HOST</span>' : ''}
      ${host && s.id !== myId ? `<button class="x" data-a="kick" data-id="${esc(s.id)}" aria-label="Remove ${esc(s.name)}">×</button>` : ''}</div>`).join('')}
    ${host ? `<div class="row">
      <button class="btn" data-a="addbot" ${r.seats.length >= MAX ? 'disabled' : ''}>Add a bot</button>
      <button class="btn primary grow" data-a="start" ${canStart() ? '' : 'disabled'}>Start game</button></div>
      ${r.seats.length < 2 ? '<p class="note">Wait for a friend or add a bot.</p>' : !canStart() ? '<p class="note">Everyone has to agree to the stake.</p>' : ''}`
      : '<p class="note">Waiting for the host to start.</p>'}
  </div>`;
}

function stakePanel(r) {
  const me = seatOf(myId), humans = r.seats.filter(s => !s.bot).length;
  return `<div class="panel">
    <h3>Playing for points</h3>
    ${S.host ? `<div class="row" style="gap:6px;flex-wrap:nowrap">${STAKES.map(v => `<button class="btn small" data-a="stake" data-v="${v}" style="flex:1;min-width:0;padding:8px 0;${r.stake === v ? 'background:#fff;color:#0f4a33' : ''}">${v || 'Fun'}</button>`).join('')}</div>`
      : `<b style="font-size:20px">${r.stake ? `${r.stake} points` : 'Fun, no points'}</b>`}
    ${r.stake ? `<p class="note">The winner gets ${r.stake} points from the Idiot. Everyone else is even.${humans < 2 ? ' Points only count with at least 2 people.' : ''}</p>
      ${!S.host ? `<button class="btn ${me?.ok ? '' : 'primary'}" data-a="agree">${me?.ok ? 'Agreed. Tap to take it back' : `Agree to ${r.stake} points`}</button>` : ''}` : ''}
  </div>`;
}

function boardView() {
  const b = board || {};
  const sign = n => n > 0 ? `+${n}` : String(n);
  const players = b.players || [], debts = b.debts || [];
  return `
  <div class="top"><button class="btn small" data-a="back">Back</button><span class="title">Points</span></div>
  ${b.loading && !b.players ? '<div class="panel"><p>Loading…</p></div>' : b.error ? '<div class="panel"><p class="err">Could not load the board. Check your connection.</p></div>' : `
  <div class="panel">
    <h3>Points board</h3>
    ${players.length ? players.map((p, k) => `<div class="seat" style="${p.me ? 'box-shadow:inset 0 0 0 2px #ffc93c' : ''}">
      <span class="place" style="min-width:28px">${k + 1}</span>
      <span class="grow">${esc(p.name)}${p.me ? ' (you)' : ''}<br><small class="note">${p.wins} won · ${p.losses} lost · ${p.games} game${p.games === 1 ? '' : 's'}</small></span>
      <b style="font-size:18px;color:${p.points > 0 ? '#3ddc84' : p.points < 0 ? '#ffb4a0' : '#fff'}">${sign(p.points)}</b></div>`).join('')
      : '<p class="note">No games for points yet. Agree on a stake in a lobby to get on the board.</p>'}
  </div>
  <div class="panel">
    <h3>Who owes whom</h3>
    ${debts.length ? debts.map(d => `<div class="seat" style="${d.mine || d.owe ? 'box-shadow:inset 0 0 0 2px #ffc93c' : ''}">
      <span class="grow">${d.owe ? 'You owe' : `${esc(d.debtor)} owes`} ${d.mine ? 'you' : esc(d.creditor)}</span><b>${d.amount}</b>
      ${d.mine ? `<button class="btn small" data-a="paid" data-id="${+d.id}">Paid</button>` : ''}</div>`).join('')
      : '<p class="note">Nobody owes anybody.</p>'}
    <p class="note">Only the person who is owed can mark a debt as paid.</p>
  </div>`}`;
}

function evText(g, ev, mi) {
  if (!ev) return '';
  const who = i => i === mi ? 'You' : esc(g.players[i].name);
  const n = ev.cards?.length || 0, c0 = ev.cards?.[0];
  const out = g.players[ev.p]?.place && g.players[ev.p].place < g.players.length && ev.k !== 'start' ? (ev.p === mi ? '. You are out!' : ' and is out!') : '';
  const burn = ev.burn ? ' Burned!' : '';
  switch (ev.k) {
    case 'start': return `${who(ev.p)} ${ev.p === mi ? 'have' : 'has'} the lowest card and start${ev.p === mi ? '' : 's'}`;
    case 'play': return `${who(ev.p)} played ${n > 1 ? `${n} ${plural(rank(c0))}` : cardName(c0)}${out}${burn}`;
    case 'blind': return `${who(ev.p)} turned over ${cardName(c0)}. It fits${out}${burn}`;
    case 'chance': return `${who(ev.p)} tried the deck: ${cardName(c0)}. It fits${out}${burn}`;
    case 'blindMiss': return `${who(ev.p)} turned over ${cardName(c0)} and picked up ${ev.n}`;
    case 'chanceMiss': return `${who(ev.p)} tried the deck: ${cardName(c0)}. Picked up ${ev.n}`;
    case 'pickup': return `${who(ev.p)} picked up ${ev.n}`;
  }
  return '';
}

function tableView() {
  const g = game(), mi = meIdx(), me = g.players[mi], n = g.players.length;
  const myTurn = g.phase === 'play' && g.turn === mi, from = source(me);
  // sounds and selection housekeeping for what just happened
  const isNew = !!g.ev && g.ev.n !== lastEvN;
  if (isNew) {
    const fresh = lastEvN !== 0; lastEvN = g.ev.n;
    if (fresh) { if (g.ev.burn) { tone(180, 0.25, 0.06, 'sawtooth'); } else if (/Miss|pickup/.test(g.ev.k)) tone(240, 0.12, 0.05); else tone(520, 0.06, 0.04); }
  }
  if (myTurn && !lastTurnMine && S.kind === 'online') tone(880, 0.1, 0.05);
  lastTurnMine = myTurn;
  const pool = g.phase === 'play' ? playPool(g, me) : [];
  sel = new Set([...sel].filter(c => pool.includes(c)));
  if (g.phase !== 'swap' || me.ready) swapPick = null;

  const opps = [];
  for (let k = 1; k < n; k++) opps.push((mi + k) % n);
  const timer = i => g.phase === 'play' && g.turn === i ? '<span class="timer" data-timer></span>' : '';
  const oppEl = i => {
    const p = g.players[i], s = seatOf(p.id);
    const status = p.place ? `<span class="place">${p.place === n ? 'IDIOT' : ordinal(p.place)}</span>`
      : g.phase === 'swap' ? `<span class="count">${p.ready ? 'Ready' : 'Swapping'}</span>` : `<span class="count">${p.hand.length} in hand</span>`;
    const bubble = said.get(p.id), talk = bubble && Date.now() - bubble.at < 5000 ? `<div class="say">${esc(bubble.t)}</div>` : '';
    return `<div class="opp ${g.turn === i ? 'turn' : ''}">${talk}
      <div class="who"><div class="ava" style="background:${hue(p.name)}">${esc(p.name.slice(0, 1).toUpperCase())}</div>
        <div class="nm">${esc(p.name)}<small>${p.bot ? 'Bot' : s?.away ? 'Away, a bot plays' : g.turn === i ? 'Playing…' : '&nbsp;'}</small></div></div>
      <div class="mini"><div class="stacks">${[0, 1, 2].map(k => stack(p, k)).join('')}</div></div>
      <div class="meta">${status}${timer(i)}</div></div>`;
  };
  const stack = (p, k, mineStack) => {
    const d = p.down[k], u = p.up[k];
    if (d == null && u == null) return `<div class="stack"><div class="cd slot"></div></div>`;
    const downAttrs = mineStack && myTurn && from === 'down' && d != null ? `data-a="down" data-slot="${k}"` : '';
    const upTap = mineStack && u != null && ((g.phase === 'swap' && !me.ready) || (g.phase === 'play' && pool.includes(u)));
    const upCls = mineStack && u != null ? (sel.has(u) ? 'sel' : swapPick?.up === k ? 'pick' : g.phase === 'play' && from === 'up' && myTurn && !canPlay(g, u) ? 'dim' : '') : '';
    return `<div class="stack">${d != null ? backEl(downAttrs ? 'tap' : '', downAttrs, downAttrs ? 'button' : 'div') : '<div class="cd slot"></div>'}${u != null ? cardEl(u, upCls, upTap ? `data-a="up" data-slot="${k}"` : '', upTap ? 'button' : 'div') : ''}</div>`;
  };

  // the pile: the top few cards, fanned
  const top = g.pile.slice(-4);
  const pileCards = top.map((c, k) => cardEl(c, k === top.length - 1 && isNew ? 'new' : '', `style="left:${k * 12}px;transform:rotate(${((c * 37) % 11) - 5}deg)"`)).join('');
  const needR = need(g.pile);
  const pileLbl = g.pile.length ? `${g.pile.length} in pile · ${needR ? `beat <b>${rn(needR)}</b>` : '<b>anything goes</b>'}` : 'Empty pile';

  let status = '';
  if (g.phase === 'swap') status = me.ready ? 'Waiting for the others to swap…' : 'Swap: tap a hand card, then a face-up card. Best cards face up.';
  else if (g.phase === 'over') status = '';
  else if (me.place) status = `You're out. ${ordinal(me.place)} place!`;
  else if (myTurn) status = from === 'down' ? 'Your turn. Turn over a face-down card.'
    : !g.pile.length || !needR ? 'Your turn. Play anything.' : `Your turn. Play ${rn(needR)} or higher, a 2 or a 10.`;
  else status = `${esc(g.players[g.turn].name)}'s turn`;

  const selCards = [...sel], selOk = selCards.length && canPlay(g, selCards[0]);
  const canAct = myTurn && !S.pending;
  const actions = g.phase === 'swap' ? (me.ready ? '' : `<button class="btn primary" data-a="ready">Ready</button>`)
    : myTurn && from !== 'down' ? `
      <button class="btn" data-a="pickup" ${canAct && g.pile.length ? '' : 'disabled'}>Pick up</button>
      ${from === 'hand' && g.deck.length ? `<button class="btn" data-a="chance" ${canAct ? '' : 'disabled'}>Try the deck</button>` : ''}
      <button class="btn primary" data-a="play" ${canAct && selOk ? '' : 'disabled'}>${selCards.length > 1 ? `Play ${selCards.length}` : 'Play'}</button>`
    : myTurn && from === 'down' && g.pile.length ? `<button class="btn" data-a="pickup" ${canAct ? '' : 'disabled'}>Pick up instead</button>` : '';

  const handTap = (g.phase === 'swap' && !me.ready) || (g.phase === 'play' && from === 'hand');
  const hand = me.hand.map(c => {
    const cls = sel.has(c) ? 'sel' : swapPick?.h === c ? 'pick' : myTurn && from === 'hand' && !canPlay(g, c) ? 'dim' : '';
    return cardEl(c, cls, handTap ? `data-a="hand" data-c="${c}"` : '', handTap ? 'button' : 'div');
  }).join('');

  const leaving = leaveArmed && Date.now() - leaveArmed < 2500;
  return `
  <div class="top">
    <button class="btn small" data-a="leave">${leaving ? 'Tap again to leave' : 'Leave'}</button>
    <span class="title">Idiot</span>
    ${S.kind === 'online' ? `<span class="codeChip">${esc(S.code)}</span>` : ''}
  </div>
  ${S.kind === 'online' && S.status !== 'online' ? '<p class="err" style="text-align:center">Connection lost. Reconnecting…</p>' : ''}
  <div class="felt">
  <div class="opps">${opps.map(oppEl).join('')}</div>
  <div class="center">
    <div class="pileBox deck"><div class="stack" style="height:calc(var(--ch) + 10px)">${g.deck.length ? backEl('', 'style="top:5px"') : '<div class="cd slot" style="top:5px"></div>'}</div>
      <div class="lbl">${g.deck.length ? `Deck <b>${g.deck.length}</b>` : 'Deck empty'}</div></div>
    <div class="pileBox"><div class="pile">${pileCards || '<div class="cd slot"></div>'}${isNew && g.ev.burn && !g.pile.length ? '<div class="burn">BURN</div>' : ''}</div>
      <div class="lbl">${pileLbl}</div></div>
  </div>
  <div class="ev">${evText(g, g.ev, mi)}</div>
  </div>
  ${g.phase === 'over' ? overView(g, mi) : `
  <div class="mine ${myTurn ? 'turn' : ''}">
    <div class="status">${status} ${myTurn ? '<span class="timer" data-timer></span>' : ''}</div>
    <div class="cards"><div class="stacks">${[0, 1, 2].map(k => stack(me, k, true)).join('')}</div>
    <div class="hand">${hand}</div></div>
    <div class="actions">${actions}</div>
  </div>`}`;
}

function overView(g, mi) {
  const n = g.players.length, order = g.players.map((p, i) => ({ p, i })).sort((a, b) => a.p.place - b.p.place);
  const idiot = order[n - 1];
  return `<div class="panel">
    <div class="bigName">${idiot.i === mi ? 'You are the Idiot' : `${esc(idiot.p.name)} is the Idiot`}</div>
    ${g.result?.stake ? `<p style="text-align:center"><b>${esc(g.result.winner)}</b> wins ${g.result.stake} points. <b>${esc(g.result.loser)}</b> owes ${esc(g.result.winner)} ${g.result.stake}.</p>
      <button class="btn small" data-a="board" style="align-self:center">Points board</button>` : ''}
    <div class="result">${order.map(({ p, i }) => `<div class="seat ${p.place === n ? 'idiot' : ''}"><span class="place" style="${p.place === n ? 'color:inherit' : ''}">${p.place === n ? 'IDIOT' : ordinal(p.place)}</span>
      <span class="grow">${esc(p.name)}${i === mi ? ' (you)' : ''}</span>${p.bot ? '<span class="tag">BOT</span>' : ''}</div>`).join('')}</div>
    ${S.host ? `<div class="row"><button class="btn primary grow" data-a="again">Play again</button>
      <button class="btn" data-a="lobby">${S.kind === 'solo' ? 'Menu' : 'Back to lobby'}</button></div>`
      : '<p class="note">Waiting for the host to deal again.</p>'}
  </div>`;
}

const canPlay = (g, c) => { const r = rank(c); return r === 2 || r === 10 || r >= need(g.pile); };

// overlap the hand so it always fits on one row
function fitHand() {
  const h = root?.querySelector('.hand');
  if (!h || !h.children.length) return;
  const n = h.children.length, cw = h.children[0].offsetWidth, w = h.clientWidth;
  const step = n > 1 ? Math.min(cw + 6, (w - cw) / (n - 1)) : cw;
  h.style.setProperty('--ov', `${Math.round(step - cw)}px`);
}
addEventListener('resize', () => { if (root) fitHand(); });

// ---------- the secret ways in ----------
const onHome = () => {
  const menu = document.getElementById('menu'), panel = document.getElementById('panel');
  return menu && !menu.classList.contains('hidden') && (!panel || panel.classList.contains('hidden'));
};
let typed = '';
addEventListener('keydown', e => {
  if (root || !onHome() || /^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '')) return;
  if (e.key.length !== 1) return;
  typed = (typed + e.key.toLowerCase()).slice(-5);
  if (typed === 'idiot') { typed = ''; open(); }
});
// five quick taps on the Best chip
const bestChip = document.getElementById('menuBest')?.parentElement;
if (bestChip) {
  let taps = 0, at = 0;
  bestChip.style.cursor = 'default';
  bestChip.addEventListener('click', () => {
    taps = performance.now() - at < 700 ? taps + 1 : 1; at = performance.now();
    if (taps >= 5 && onHome()) { taps = 0; open(); }
  });
}
// links: peakflip.io/idiot opens it, peakflip.io/idiot/CODE joins a lobby (vercel.json redirects both to ?idiot)
const invited = new URLSearchParams(location.search).get('idiot');
if (invited != null) {
  try { const u = new URL(location.href); u.searchParams.delete('idiot'); history.replaceState(null, '', u); } catch {}
  setTimeout(() => open(invited || undefined), 400);
}
addEventListener('pagehide', () => { if (S?.ch) S.ch.send('bye', { id: myId }); });

addEventListener('idiot:open', () => open());   // the Idiot button on the home screen

export const Idiot = { open, close };
