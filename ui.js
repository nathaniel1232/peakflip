// ============================================================
//  Menus, chests, locker, missions, results, leaderboards
// ============================================================
import {
  save, persist, CATALOG, RARITY, CHESTS, KIND_NAME, PITY,
  openChest, collectionCount, missionText,
} from './meta.js';
import { icon } from './icons.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const today = () => new Date().toISOString().slice(0, 10);
const coin = '<span class="coin"></span>';
let cfg = null;

if (!save.pid) { save.pid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); persist(); }

// ---------- leaderboard / ghost client ----------
// Works when hosted on Vercel with the /api functions + a Redis store. Anywhere else it reports "offline".
const LB = {
  async get(board, day) {
    try {
      const r = await fetch(`/api/leaderboard?board=${board}${day ? `&day=${day}` : ''}&pid=${encodeURIComponent(save.pid)}`);
      if (!r.ok) throw 0;
      return await r.json();
    } catch { return null; }
  },
  async submit(board, value, day, ghost) {
    if (!save.name) return null;
    try {
      const r = await fetch('/api/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ board, day, value, pid: save.pid, name: save.name, ghost }) });
      if (!r.ok) throw 0;
      return await r.json();
    } catch { return null; }
  },
};
export async function fetchGhosts(day) {
  try {
    const r = await fetch(`/api/ghosts?day=${day}&pid=${encodeURIComponent(save.pid)}`);
    if (!r.ok) return [];
    return (await r.json()).ghosts || [];
  } catch { return []; }
}

// ---------- swatches ----------
const RAINBOW = 'linear-gradient(90deg,#ff5a5a,#ffb35a,#ffe45a,#5aff8a,#5ac8ff,#b05aff)';
function swatch(kind, it) {
  if (kind === 'outfit') return `<div class="sw" style="background:${it.jacket}"><i style="background:${it.pants}"></i><b style="background:${it.helmet}"></b></div>`;
  if (kind === 'ski') {
    const c = it.color === 'rainbow' ? RAINBOW : it.color;
    return `<div class="sw ski"><i style="background:${c}"></i><i style="background:${c}"></i><em style="background:${it.tip}"></em></div>`;
  }
  const c = !it.colors ? 'transparent' : it.colors === 'rainbow' ? RAINBOW : `linear-gradient(90deg,${it.colors.join(',')})`;
  return `<div class="sw trail"><i style="background:${c}"></i>${!it.colors ? '<span>—</span>' : ''}</div>`;
}

// ---------- panel ----------
function openPanel(title, html, wide) {
  $('panelTitle').textContent = title;
  $('panelBody').innerHTML = html;
  $('panel').classList.toggle('wide', !!wide);
  $('panel').classList.remove('hidden');
}
function closePanel() { $('panel').classList.add('hidden'); showMenuUI(); }

// ---------- menu ----------
const freeChestReady = () => Date.now() >= (save.freeChestAt || 0);
const fmtCooldown = ms => { const m = Math.ceil(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
export function showMenuUI() {
  $('menuBest').textContent = save.best.toLocaleString();
  $('menuCoins').textContent = save.coins.toLocaleString();
  $('menuControls').innerHTML = cfg.hints;
  const rb = save.raceBest?.[today()];
  $('raceSub').textContent = rb ? `Forest course · your best ${fmtTime(rb)}` : 'Forest course · new every day';
  const ready = freeChestReady();
  $('chestBadge').classList.toggle('hidden', !ready);
  $('chestSub').textContent = ready ? 'Free chest!' : fmtCooldown(save.freeChestAt - Date.now());
  const { have, total } = collectionCount();
  $('lockerSub').textContent = `${have}/${total}`;
  $('missionSub').textContent = `${save.missions.length} active`;
}

// ---------- chests ----------
function chestCard(key) {
  const c = CHESTS[key];
  const odds = Object.entries(c.odds).filter(([, v]) => v > 0).map(([k, v]) => `<span style="color:${RARITY[k].color}">${RARITY[k].name} ${v}%</span>`).join('');
  let btn;
  if (key === 'free') {
    const ready = freeChestReady();
    btn = `<button class="btn ${ready ? 'go' : ''}" data-chest="free" ${ready ? '' : 'disabled'}>${ready ? 'Open free' : fmtCooldown(save.freeChestAt - Date.now())}</button>`;
  } else {
    const can = save.coins >= c.price;
    btn = `<button class="btn ${can ? 'go' : ''}" data-chest="${key}" ${can ? '' : 'disabled'}>${coin} ${c.price}</button>`;
  }
  return `<div class="chestCard"><div class="chest" style="--c:${c.color}"><div class="lid"></div><div class="base"></div></div>
    <div class="cname">${c.name}</div><div class="odds">${odds}</div>${btn}</div>`;
}
function renderChests() {
  const pityLeft = Math.max(1, PITY - (save.pity || 0));
  openPanel('Chests', `
    <div class="chips"><div class="chip"><span class="coin"></span><b>${save.coins.toLocaleString()}</b></div></div>
    <div class="chestRow">${chestCard('free')}${chestCard('basic')}${chestCard('epic')}</div>
    <div class="note">Epic or better guaranteed within <b>${pityLeft}</b> Free/Snow chest${pityLeft > 1 ? 's' : ''}. Duplicates turn into coins.<br>Coins are earned only by playing. No real money involved.</div>`, true);
  $('panelBody').querySelectorAll('[data-chest]').forEach(b => b.onclick = () => doOpen(b.dataset.chest));
}
function doOpen(key) {
  const res = openChest(key);
  if (!res) { cfg.sfx.tone(200, 0.15, 'square', 0.1); return; }
  const rc = RARITY[res.rarity].color;
  const ov = $('chestOpen');
  ov.innerHTML = `<div class="chest big shaking" style="--c:${CHESTS[key].color};--glow:${rc}"><div class="lid"></div><div class="base"></div></div><div class="tapHint">Opening…</div>`;
  ov.classList.remove('hidden');
  const S = cfg.sfx;
  // suspense: ticks speed up, the glow colour hints at the rarity before the reveal
  [0, 300, 550, 750, 900, 1020, 1120].forEach((t, i) => setTimeout(() => S.tone(300 + i * 60, 0.06, 'square', 0.05), t));
  setTimeout(() => ov.querySelector('.chest')?.classList.add('glowing'), 650);
  setTimeout(() => {
    const it = res.item;
    if (res.rarity === 'legendary' || res.rarity === 'epic') { S.perfect(); setTimeout(() => S.perfect(), 200); }
    else S.trick(['common', 'rare'].indexOf(res.rarity));
    ov.innerHTML = `
      <div class="burst" style="--glow:${rc}"></div>
      <div class="reveal" style="--glow:${rc}">
        <div class="rar" style="color:${rc}">${RARITY[res.rarity].name.toUpperCase()}</div>
        <div class="bigSw">${swatch(res.kind, it)}</div>
        <div class="iname">${esc(it.name)}</div>
        <div class="ikind">${KIND_NAME[res.kind]}</div>
        ${res.dupe ? `<div class="dupe">Duplicate · ${coin} +${res.refund}</div>` : '<div class="newTag">NEW</div>'}
        <div class="row">
          <button class="btn" id="openMore">Back</button>
          ${res.dupe ? '' : `<button class="btn primary" id="equipNow">Equip</button>`}
        </div>
      </div>`;
    const eq = $('equipNow');
    if (eq) eq.onclick = () => { save.eq[res.kind] = it.id; persist(); cfg.onCosmetics(); ov.classList.add('hidden'); renderChests(); };
    $('openMore').onclick = () => { ov.classList.add('hidden'); renderChests(); };
  }, 1300);
}

// ---------- locker ----------
let lockerTab = 'outfit';
function renderLocker() {
  const tabs = Object.keys(CATALOG).map(k => `<button class="tab ${k === lockerTab ? 'on' : ''}" data-tab="${k}">${KIND_NAME[k]} ${save.inv[k].length}/${CATALOG[k].length}</button>`).join('');
  const grid = CATALOG[lockerTab].map(it => {
    const owned = save.inv[lockerTab].includes(it.id), on = save.eq[lockerTab] === it.id;
    const rc = RARITY[it.rarity].color;
    return `<button class="skin ${on ? 'sel' : ''}" data-id="${it.id}" ${owned ? '' : 'disabled'}>
      ${owned ? swatch(lockerTab, it) : `<div class="sw q">${icon('lock')}</div>`}
      <div class="nm">${owned ? esc(it.name) : 'Locked'}</div><div class="rr" style="color:${rc}">${RARITY[it.rarity].name}</div></button>`;
  }).join('');
  openPanel('Locker', `<div class="tabs">${tabs}</div><div class="grid">${grid}</div><div class="note">Unlock more from chests.</div>`, true);
  $('panelBody').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { lockerTab = b.dataset.tab; renderLocker(); });
  $('panelBody').querySelectorAll('[data-id]').forEach(b => b.onclick = () => { save.eq[lockerTab] = b.dataset.id; persist(); cfg.onCosmetics(); renderLocker(); });
}

// ---------- missions ----------
function renderMissions() {
  const list = save.missions.map(m => `<div class="item"><span class="grow">${esc(missionText(m))}</span><span class="val">${coin} ${m.reward}</span></div>`).join('');
  openPanel('Missions', `<div class="list">${list}</div><div class="note">Finish them within a single run. Rewards pay out when the run ends, then a harder mission takes its place.<br>Completed so far: <b>${save.missionsDone}</b></div>`);
}
const toastQ = []; let toastBusy = false;
export function missionToast(list) {
  if (!list || !list.length) return;
  toastQ.push(...list);
  if (!toastBusy) nextToast();
}
function nextToast() {
  const m = toastQ.shift();
  if (!m) { toastBusy = false; return; }
  toastBusy = true;
  const t = $('toast');
  t.innerHTML = `${icon('check')}<span>${esc(missionText(m))}</span><b>${coin} ${m.reward}</b>`;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  cfg.sfx.tone(1047, 0.12, 'triangle', 0.12); cfg.sfx.tone(1568, 0.2, 'triangle', 0.12, null, 0.1);
  setTimeout(nextToast, 2200);
}

// ---------- leaderboards ----------
let lbTab = 'race';
async function renderLeaderboard() {
  const tabs = `<div class="tabs"><button class="tab ${lbTab === 'race' ? 'on' : ''}" data-lb="race">Daily Race</button><button class="tab ${lbTab === 'endless' ? 'on' : ''}" data-lb="endless">Endless</button></div>`;
  openPanel('Leaderboard', `${tabs}${nameRow()}<div id="lbList" class="list"><div class="note">Loading…</div></div>`);
  $('panelBody').querySelectorAll('[data-lb]').forEach(b => b.onclick = () => { lbTab = b.dataset.lb; renderLeaderboard(); });
  wireName();
  const data = await LB.get(lbTab, lbTab === 'race' ? today() : null);
  const el = $('lbList'); if (el) el.innerHTML = lbRows(data, lbTab, 20);
}
const nameRow = () => `<div class="nameRow"><input id="nameIn" maxlength="14" placeholder="Your name" value="${esc(save.name || '')}" onkeydown="if(event.key==='Enter')document.getElementById('nameSave').click()"><button class="btn primary" id="nameSave">Save</button></div>`;
function wireName(after) {
  const b = $('nameSave'); if (!b) return;
  b.onclick = async () => {
    const v = $('nameIn').value.trim().replace(/\s+/g, ' ').slice(0, 14);
    if (!v) return;
    save.name = v; persist();
    b.textContent = 'Saved';
    if (save.best) await LB.submit('endless', save.best);
    const rb = save.raceBest?.[today()];
    if (rb) await LB.submit('race', rb, today(), save.ghost?.day === today() ? { t: save.ghost.t, f: save.ghost.f } : undefined);
    after ? after() : renderLeaderboard();
  };
}
function lbRows(data, board, limit) {
  if (!data) return `<div class="note">Online rankings switch on when the game is hosted on Vercel with a database connected.<br>Your best: <b>${board === 'race' ? (save.raceBest?.[today()] ? fmtTime(save.raceBest[today()]) : '—') : save.best.toLocaleString()}</b></div>`;
  if (!data.top.length) return `<div class="note">No entries yet. Be the first.</div>`;
  const fmt = v => board === 'race' ? fmtTime(v) : Math.round(v).toLocaleString();
  const rows = data.top.slice(0, limit).map((r, i) => `<div class="item ${r.isMe ? 'me' : ''}"><span class="rank">${i + 1}</span><span class="grow">${esc(r.name)}</span><span class="val">${fmt(r.value)}</span></div>`).join('');
  const me = data.me && data.me.rank > limit ? `<div class="item me"><span class="rank">${data.me.rank}</span><span class="grow">${esc(save.name || 'You')}</span><span class="val">${fmt(data.me.value)}</span></div>` : '';
  return rows + me;
}

// ---------- results ----------
export function showResults(r) {
  const el = $('over');
  const earned = r.coins + r.bonus + r.missions.total;
  let body;
  if (r.mode === 'race') {
    const field = r.field.length > 1
      ? `<div class="list">${r.field.map((f, i) => `<div class="item ${f.me ? 'me' : ''}"><span class="rank">${i + 1}</span><span class="grow">${esc(f.name)}</span><span class="val">${fmtTime(f.t)}</span></div>`).join('')}</div>` : '';
    body = `
      ${r.newBest ? '<div class="tag">PERSONAL BEST</div>' : ''}
      <div class="big-num"><small>FINISH TIME</small>${fmtTime(r.time)}</div>
      <div class="sub">${r.gates}/${r.gateTotal} checkpoints${r.penalty ? ` · +${r.penalty}s penalty` : ''} · best today ${fmtTime(r.best)}</div>
      ${field}`;
  } else {
    body = `
      ${r.newBest ? '<div class="tag">NEW RECORD</div>' : ''}
      <div class="big-num"><small>SCORE</small>${r.score.toLocaleString()}</div>
      <div class="sub">${esc(r.reason)} · ${r.dist.toLocaleString()} m · best ${save.best.toLocaleString()}</div>`;
  }
  const missions = r.missions.done.length
    ? `<div class="list">${r.missions.done.map(m => `<div class="item">${icon('check')}<span class="grow">${esc(missionText(m))}</span><span class="val">${coin} ${m.reward}</span></div>`).join('')}</div>` : '';
  const chestReady = save.coins >= CHESTS.basic.price || freeChestReady();
  el.innerHTML = `<div class="card">
    ${body}
    <div class="earn"><span>Coins earned</span><b>${coin} +${earned}</b></div>
    ${missions}
    <div id="resLb"></div>
    <button id="againBtn" class="btn primary big">${icon('retry')}${r.mode === 'race' ? 'Race again' : 'Ride again'}</button>
    <div class="row">
      <button class="btn" id="menuBtn">${icon('home')}Menu</button>
      ${chestReady ? `<button class="btn" id="toChests">${icon('chest')}Chests</button>` : ''}
      <button class="btn" id="shareBtn">${icon('share')}Share</button>
    </div>
  </div>`;
  el.classList.remove('hidden');
  $('againBtn').onclick = () => cfg.onAgain();
  $('menuBtn').onclick = () => cfg.onMenu();
  if ($('toChests')) $('toChests').onclick = () => { cfg.onMenu(); renderChests(); };
  $('shareBtn').onclick = () => share(r);

  const board = r.mode, day = r.mode === 'race' ? r.day : null, value = r.mode === 'race' ? r.best : save.best;
  const ghost = r.ghost ? { t: r.ghost.t, f: r.ghost.f } : undefined;
  const lb = $('resLb');
  if (!save.name) {
    lb.innerHTML = `<div class="note" style="margin-bottom:6px">Add your name to join the ${board === 'race' ? 'Daily Race' : 'Endless'} rankings${board === 'race' ? ' and appear as a ghost for other racers' : ''}</div>${nameRow()}`;
    wireName(() => resultsRank(board, day, value, ghost));
  } else resultsRank(board, day, value, ghost);
}
async function resultsRank(board, day, value, ghost) {
  const lb = $('resLb'); if (!lb) return;
  const sub = await LB.submit(board, value, day, ghost);
  if (!sub) { lb.innerHTML = ''; return; }
  const data = await LB.get(board, day);
  if ($('resLb') && data?.me) lb.innerHTML = `<div class="earn"><span>${board === 'race' ? "Today's rank" : 'All-time rank'}</span><b>#${data.me.rank}</b></div>`;
}

async function share(r) {
  const url = location.origin + location.pathname;
  const text = r.mode === 'race'
    ? `I did today's Peak Flip race in ${fmtTime(r.time)}. Can you beat my ghost?`
    : `I scored ${r.score.toLocaleString()} in Peak Flip. Can you beat it?`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Peak Flip', text, url }); return; }
    await navigator.clipboard.writeText(`${text} ${url}`);
    $('shareBtn').innerHTML = `${icon('check')}Copied`;
  } catch {}
}

// ---------- init ----------
export function initUI(c) {
  cfg = c;
  const put = (id, name) => { const e = $(id); if (e) e.innerHTML = icon(name); };
  put('logoIc', 'mountain'); put('icPlay', 'play'); put('icFlag', 'flag');
  put('icChest', 'chest'); put('icSkis', 'skis'); put('icTarget', 'target'); put('icTrophy', 'trophy');
  put('panelClose', 'close'); put('pauseBtn', 'pause');
  $('icGo1').innerHTML = $('icGo2').innerHTML = '<svg class="ic go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  $('playBtn').onclick = () => c.onPlay('endless');
  $('raceBtn').onclick = () => c.onPlay('race');
  $('chestsBtn').onclick = () => { c.sfx.init(); renderChests(); };
  $('lockerBtn').onclick = () => { c.sfx.init(); renderLocker(); };
  $('missionsBtn').onclick = () => { c.sfx.init(); renderMissions(); };
  $('lbBtn').onclick = () => { c.sfx.init(); renderLeaderboard(); };
  $('panelClose').onclick = closePanel;
  $('panel').onclick = e => { if (e.target === $('panel')) closePanel(); };
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('panel').classList.contains('hidden')) closePanel(); });
  setInterval(() => { if (!$('menu').classList.contains('hidden')) showMenuUI(); }, 30000);
}
