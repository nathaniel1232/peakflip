// ============================================================
//  Menus, chests, locker, missions, results, leaderboards
// ============================================================
import {
  save, persist, CATALOG, RARITY, CHESTS, KIND_NAME, PITY, SETS, FITS, fitOwned,
  openChest, collectionCount, missionText, adProgress, adWatched, adUsesLeft, useAd,
} from './meta.js';
import { icon } from './icons.js';
import { rpc } from './net.js';
import { Cloud } from './cloud.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const today = () => new Date().toISOString().slice(0, 10);
const coin = '<span class="coin"></span>';
let cfg = null;

if (!save.pid) { save.pid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); persist(); }

// ---------- leaderboard / ghost client (Supabase RPC over plain fetch) ----------
const LB = {
  async get(board, day, limit = 20) {
    try { return await rpc('get_leaderboard', { p_board: board, p_day: day || '', p_pid: save.pid, p_limit: limit }); }
    catch { return null; }
  },
  async submit(board, value, day, ghost) {
    if (!save.name) return null;
    try { return await rpc('submit_score', { p_board: board, p_day: day || '', p_pid: save.pid, p_name: save.name, p_value: value, p_ghost: ghost || null }); }
    catch { return null; }
  },
};
LB.register = async name => {
  try { return await rpc('register_name', { p_pid: save.pid, p_name: name }); }
  catch { return null; }
};
export async function fetchGhosts(day) {
  try { return (await rpc('get_ghosts', { p_day: day, p_pid: save.pid })) || []; }
  catch { return []; }
}

// ---------- swatches ----------
const RAINBOW = 'linear-gradient(90deg,#ff5a5a,#ffb35a,#ffe45a,#5aff8a,#5ac8ff,#b05aff)';
const ACC_SVG = {
  hat: '<path d="M6 16h12M8 16c0-6 2-9 4-9s4 3 4 9"/>',
  face: '<circle cx="8" cy="12" r="3"/><circle cx="16" cy="12" r="3"/><path d="M11 12h2"/>',
  back: '<path d="M8 5h8l2 15H6z"/><path d="M9 5c0-2 6-2 6 0"/>',
};
function swatch(kind, it) {
  if (kind === 'hat' || kind === 'face' || kind === 'back') {
    if (it.id === 'none') return '<div class="sw trail"><span>—</span></div>';
    return `<div class="sw acc" style="background:${it.color2 || 'rgba(255,255,255,.12)'}"><svg viewBox="0 0 24 24" fill="${it.color}" stroke="rgba(0,0,0,.35)" stroke-width="1.2">${ACC_SVG[kind]}</svg></div>`;
  }
  if (kind === 'outfit') return `<div class="sw" style="background:${it.sw || it.jacket}"><i style="background:${it.pants}"></i><b style="background:${it.helmet}"></b></div>`;
  if (kind === 'ski') {
    const c = it.color === 'rainbow' ? RAINBOW : it.color;
    return `<div class="sw ski"><i style="background:${c}"></i><i style="background:${c}"></i><em style="background:${it.tip}"></em></div>`;
  }
  const c = !it.colors ? 'transparent' : it.colors === 'rainbow' ? RAINBOW : `linear-gradient(90deg,${it.colors.join(',')})`;
  return `<div class="sw trail"><i style="background:${c}"></i>${!it.colors ? '<span>—</span>' : ''}</div>`;
}

// ---------- panel ----------
// closet: the Locker docks to one side and the menu steps away so the 3D avatar shows in its wardrobe
let inCloset = false;
function openPanel(title, html, wide, closet = false) {
  const card = $('panel').querySelector('.card'), keep = $('panelTitle').textContent === title && !$('panel').classList.contains('hidden') ? card.scrollTop : 0;
  $('panelTitle').textContent = title;
  $('panelBody').innerHTML = html;
  $('panel').classList.toggle('wide', !!wide);
  $('panel').classList.toggle('closet', closet);
  $('panel').classList.remove('hidden');
  card.scrollTop = keep;   // re-rendering after a tap shouldn't jump back to the top
  if (closet !== inCloset) { inCloset = closet; cfg.closet(closet); $('menu').classList.toggle('hidden', closet); }
}
function closePanel() {
  $('panel').classList.add('hidden');
  if (inCloset) { inCloset = false; tryOn = null; cfg.closet(false); $('menu').classList.remove('hidden'); }
  showMenuUI();
}

// ---------- menu ----------
const freeChestReady = () => Date.now() >= (save.freeChestAt || 0);
const fmtCooldown = ms => { const m = Math.ceil(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
export function showMenuUI() {
  $('menuBest').textContent = save.best.toLocaleString();
  $('menuCoins').textContent = save.coins.toLocaleString();
  const rb = save.raceBest?.[today()];
  $('raceSub').textContent = rb ? `Forest course · your best ${fmtTime(rb)}` : 'Forest course · new every day';
  const pb = $('profileBtn');
  pb.classList.toggle('claim', !save.name);
  pb.innerHTML = save.name ? `${icon('user')}<b>${esc(save.name)}</b>` : `${icon('user')}<b>Claim your name</b>`;
  miniBoard();
  const ready = freeChestReady();
  $('chestBadge').classList.toggle('hidden', !ready);
  $('shopSub').textContent = ready ? 'Free chest!' : 'Chests & items';
  const { have } = collectionCount();
  $('lockerSub').textContent = `${have} owned`;
  $('missionSub').textContent = `${save.missions.length} active`;
}

// ---------- menu leaderboard preview ----------
let miniTab = 'race', miniCache = {};
async function miniBoard(force) {
  const el = $('miniLb'); if (!el) return;
  document.querySelectorAll('[data-mlb]').forEach(b => b.classList.toggle('on', b.dataset.mlb === miniTab));
  const key = miniTab, c = miniCache[key];
  if (c && !force && Date.now() - c.at < 60000) { el.innerHTML = c.html; return; }
  if (!c) el.innerHTML = '<div class="note">Loading…</div>';
  const data = await LB.get(key, key === 'race' ? today() : null, 5);
  let html = lbRows(data, key, 5);
  if (data && !data.me) html += `<div class="note">${key === 'race' ? "You haven't raced today." : 'Set a score to get on the board.'}</div>`;
  miniCache[key] = { at: Date.now(), html };
  if (miniTab === key) el.innerHTML = html;
}

// ---------- profile ----------
const statusText = () => ({
  synced: `${icon('check')} Your coins and items are saved automatically`, syncing: 'Saving…', offline: 'Saved on this device · will back up when online', off: 'Connecting…',
})[Cloud.status];
function renderProfile() {
  openPanel('Profile', `
    <div id="nameSlot"></div>
    <div class="saveBox"><div class="syncLine ${Cloud.status}" id="syncLine">${statusText()}</div></div>
    <button class="btn" id="profLb">${icon('trophy')} Leaderboard</button>`);
  nameForm($('nameSlot'), () => renderProfile());
  $('profLb').onclick = () => renderLeaderboard();
}
Cloud.onStatus(() => { const l = $('syncLine'); if (l) { l.className = `syncLine ${Cloud.status}`; l.innerHTML = statusText(); } });

// ---------- how to play ----------
function renderHelp() {
  openPanel('How to play', `<div class="help">
    <h4>Controls</h4><div class="item">${cfg.hints}</div>
    <h4>Endless</h4><div class="item">Ride as far as you can. Speed and tricks score points, coins buy chests. Landing upside down or hitting trees and rocks ends the run.</div>
    <h4>Daily Race</h4><div class="item">A new forest course every day, the same for everyone. Ride through all 11 checkpoints and reach the finish as fast as you can.
      Missing a checkpoint costs 3 seconds. Race against other players' ghosts.</div>
    <h4>Leaderboards</h4><div class="item">Claim a name once and your best Endless score and today's race score go on the world boards automatically.</div>
  </div>`);
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
  const tag = c.set === 'halloween' && new Date().getMonth() === 9 ? '<div class="evTag">HALLOWEEN</div>' : '';
  return `<div class="chestCard ${c.set ? 'themed' : ''}" style="--c:${c.color}">${tag}<div class="chest" style="--c:${c.color}"><div class="lid"></div><div class="base"></div></div>
    <div class="cname">${c.name}</div><div class="odds">${odds}</div>${btn}</div>`;
}
// rewarded ad with a friendly message when there's no ad to show right now
async function watchAd() {
  const ok = await cfg.ads.rewarded();
  if (!ok && cfg.ads.noFill) note('No ad available right now. Try again in a bit.');
  return ok;
}
function note(text) {
  const el = document.createElement('div'); el.className = 'flashNote'; el.textContent = text;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2600);
}

// ---------- shop: every item, previewed on your avatar, unlocked from chests ----------
let shopTab = 'chests', shopSel = null;   // shopSel: { kind, id } the item shown in the detail bar
const KINDS = Object.keys(CATALOG);
const chestFor = it => it.set ? Object.keys(CHESTS).find(k => CHESTS[k].set === it.set) : it.rarity === 'common' ? 'basic' : 'epic';
function sourceText(it) {
  if (it.ad) return `Watch ${it.ad} ad${it.ad > 1 ? 's' : ''} to unlock`;
  if (it.set) return `${CHESTS[chestFor(it)].name}, or any chest`;
  return it.rarity === 'common' ? 'Free & Snow Chests' : 'Snow & Epic Chests';
}
function chestsHtml() {
  const pityLeft = Math.max(1, PITY - (save.pity || 0));
  return `
    <div class="chestRow">${chestCard('free')}${chestCard('basic')}${chestCard('epic')}</div>
    <div class="secHead">Themed chests <small>only drop items from their set</small></div>
    <div class="chestRow">${chestCard('spooky')}${chestCard('agartha')}${chestCard('tradition')}</div>
    ${cfg.ads.available ? `<div class="row">
      <button class="btn" id="adCoins" ${adUsesLeft('coins') > 0 ? '' : 'disabled'}>${icon('play')} +75 coins <small style="opacity:.7">(${adUsesLeft('coins')} left today)</small></button>
      <button class="btn" id="adChest" ${adUsesLeft('chest') > 0 ? '' : 'disabled'}>${icon('play')} Free Snow Chest <small style="opacity:.7">(${adUsesLeft('chest')})</small></button>
    </div>` : ''}
    <div class="note">Epic or better guaranteed within <b>${pityLeft}</b> Free/Snow chest${pityLeft > 1 ? 's' : ''}. Duplicates turn into coins.<br>Coins are earned only by playing. No real money involved.</div>`;
}
function shopItemsHtml(kind) {
  return `<div class="grid">${CATALOG[kind].filter(it => it.id !== 'none').map(it => {
    const owned = save.inv[kind].includes(it.id), on = tryOn?.[kind] === it.id || (shopSel?.kind === kind && shopSel.id === it.id);
    return `<button class="skin ${on ? 'trying' : ''}" data-shop="${kind}:${it.id}">
      <div class="swWrap">${swatch(kind, it)}${owned ? `<span class="lockBadge own">${icon('check')}</span>` : ''}</div>
      <div class="nm">${esc(it.name)}</div><div class="rr" style="color:${RARITY[it.rarity].color}">${it.ad ? 'Ad exclusive' : RARITY[it.rarity].name}</div></button>`;
  }).join('')}</div>`;
}
function shopFitsHtml() {
  return `<div class="fits">${FITS.map(f => {
    const set = SETS[f.set], have = fitOwned(f), total = Object.keys(f.pieces).length, ck = Object.keys(CHESTS).find(k => CHESTS[k].set === f.set);
    const pieces = Object.entries(f.pieces).filter(([, id]) => id !== 'none').map(([k, id]) => {
      const it = CATALOG[k].find(i => i.id === id);
      return `<div class="fp" title="${esc(it.name)}">${swatch(k, it)}</div>`;
    }).join('');
    return `<div class="fit" style="--c:${set.color}">
      <div class="fitHead"><b>${esc(f.name)}</b><span>${set.name} · ${have}/${total} owned</span></div>
      <div class="fitPieces">${pieces}</div>
      <div class="row"><button class="btn" data-tryfit="${f.id}">Try on</button>
      <button class="btn go" data-chest="${ck}" ${save.coins >= CHESTS[ck].price ? '' : 'disabled'}>${coin} ${CHESTS[ck].price}</button></div>
    </div>`;
  }).join('')}</div><div class="note">The coin button opens that set's themed chest.</div>`;
}
function detailBar() {
  if (!shopSel) return tryOn ? `<div class="tryBar"><span>Trying on a fit</span><button class="btn" id="tryReset">Take off</button></div>` : '';
  const { kind, id } = shopSel, it = CATALOG[kind].find(i => i.id === id), owned = save.inv[kind].includes(id);
  let action;
  if (owned) action = save.eq[kind] === id ? `<button class="btn" disabled>${icon('check')} Wearing</button>` : `<button class="btn go" id="shopEquip">Wear</button>`;
  else if (it.ad) action = `<button class="btn go" id="shopAd" ${cfg.ads.available ? '' : 'disabled'}>${icon('play')} ${adWatched(kind, id)}/${it.ad}</button>`;
  else { const ck = chestFor(it), c = CHESTS[ck]; action = `<button class="btn go" data-chest="${ck}" ${save.coins >= c.price ? '' : 'disabled'}>${c.name.replace(' Chest', '')} ${coin} ${c.price}</button>`; }
  return `<div class="tryBar"><span><b>${esc(it.name)}</b> <small style="color:${RARITY[it.rarity].color}">${RARITY[it.rarity].name} ${KIND_NAME[kind]}</small><br>
    <small>${owned ? 'In your locker' : `Get it: ${sourceText(it)}`}</small></span>${action}<button class="btn" id="tryReset" title="Take off">${icon('close')}</button></div>`;
}
function renderShop(tab) {
  if (tab) shopTab = tab;
  const tabs = `<button class="tab ${shopTab === 'chests' ? 'on' : ''}" data-stab="chests">${icon('chest')} Chests</button>
    <button class="tab ${shopTab === 'fits' ? 'on' : ''}" data-stab="fits">${icon('gift')} Fits</button>` +
    KINDS.map(k => `<button class="tab ${shopTab === k ? 'on' : ''}" data-stab="${k}">${KIND_NAME[k]}</button>`).join('');
  const body = shopTab === 'chests' ? chestsHtml() : shopTab === 'fits' ? shopFitsHtml()
    : `${shopItemsHtml(shopTab)}<div class="note">Tap anything to see it on your rider. Items unlock from chests; ${icon('check')} = you own it.</div>`;
  openPanel('Shop', `<div class="chips"><div class="chip"><span class="coin"></span><b>${save.coins.toLocaleString()}</b></div></div>
    ${detailBar()}<div class="tabs">${tabs}</div>${body}`, true, true);
  const B = $('panelBody');
  B.querySelectorAll('[data-stab]').forEach(b => b.onclick = () => renderShop(b.dataset.stab));
  B.querySelectorAll('[data-chest]').forEach(b => b.onclick = () => doOpen(b.dataset.chest));
  B.querySelectorAll('[data-shop]').forEach(b => b.onclick = () => {
    const [kind, id] = b.dataset.shop.split(':'), t = { ...(tryOn || {}) };
    if (t[kind] === id) { delete t[kind]; shopSel = null; } else { t[kind] = id; shopSel = { kind, id }; }   // tap again to take it off
    preview(t); renderShop();
  });
  B.querySelectorAll('[data-tryfit]').forEach(b => b.onclick = () => { shopSel = null; preview({ ...FITS.find(x => x.id === b.dataset.tryfit).pieces }); renderShop(); });
  if ($('tryReset')) $('tryReset').onclick = () => { shopSel = null; preview(null); renderShop(); };
  if ($('shopEquip')) $('shopEquip').onclick = () => { save.eq[shopSel.kind] = shopSel.id; persist(); preview(tryOn); cfg.sfx.perfect(); renderShop(); };
  if ($('shopAd')) $('shopAd').onclick = async () => {
    $('shopAd').disabled = true;
    const { kind, id } = shopSel;
    if (await watchAd() && adProgress(kind, id)) { save.eq[kind] = id; persist(); cfg.sfx.perfect(); }
    preview(tryOn); renderShop();
  };
  const adC = $('adCoins'), adX = $('adChest');
  if (adC) adC.onclick = async () => { adC.disabled = true; if (await watchAd()) { useAd('coins'); save.coins += 75; persist(); cfg.sfx.coin(); } renderShop(); };
  if (adX) adX.onclick = async () => { adX.disabled = true; if (await watchAd()) { useAd('chest'); doOpen('basic', true); } else renderShop(); };
}
function doOpen(key, paidByAd) {
  const res = openChest(key, paidByAd);
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
    if (eq) eq.onclick = () => { save.eq[res.kind] = it.id; persist(); ov.classList.add('hidden'); preview(tryOn); renderShop(); };
    $('openMore').onclick = () => { ov.classList.add('hidden'); renderShop(); };
  }, 1300);
}

// ---------- locker ----------
// ---------- locker: only what you own; tap to wear ----------
let lockerTab = 'outfit', tryOn = null;   // tryOn: { kind: id } previewed on the avatar in the Shop, not equipped
function preview(t) { tryOn = t && Object.keys(t).length ? t : null; cfg.preview(tryOn); }
function lockerFitsHtml() {
  // a fit shows up once you own at least one of its pieces, listing just the pieces you have
  const mine = FITS.filter(f => Object.entries(f.pieces).some(([k, id]) => id !== 'none' && save.inv[k].includes(id)));
  if (!mine.length) return emptyLocker('No fits yet. Themed chests in the Shop drop Agartha, Halloween and Shabbat pieces.');
  return `<div class="fits">${mine.map(f => {
    const set = SETS[f.set], owned = Object.entries(f.pieces).filter(([k, id]) => id !== 'none' && save.inv[k].includes(id));
    const worn = owned.every(([k, id]) => save.eq[k] === id);
    return `<div class="fit" style="--c:${set.color}">
      <div class="fitHead"><b>${esc(f.name)}</b><span>${set.name}</span></div>
      <div class="fitPieces">${owned.map(([k, id]) => `<div class="fp">${swatch(k, CATALOG[k].find(i => i.id === id))}</div>`).join('')}</div>
      <button class="btn ${worn ? '' : 'go'}" data-fit="${f.id}" ${worn ? 'disabled' : ''}>${worn ? `${icon('check')} Wearing` : 'Wear fit'}</button>
    </div>`;
  }).join('')}</div>`;
}
const emptyLocker = text => `<div class="note" style="padding:18px 0">${text}</div><button class="btn primary" id="toShop">${icon('chest')} Go to the Shop</button>`;
function renderLocker() {
  if (tryOn) preview(null);
  const tabs = KINDS.map(k => `<button class="tab ${k === lockerTab ? 'on' : ''}" data-tab="${k}">${KIND_NAME[k]} <small>${save.inv[k].filter(id => id !== 'none').length}</small></button>`).join('')
    + `<button class="tab ${lockerTab === 'fits' ? 'on' : ''}" data-tab="fits">${icon('gift')} Fits</button>`;
  let body;
  if (lockerTab === 'fits') body = lockerFitsHtml();
  else {
    const mine = CATALOG[lockerTab].filter(it => save.inv[lockerTab].includes(it.id));
    body = mine.length > 1 || lockerTab === 'outfit' || lockerTab === 'ski'
      ? `<div class="grid">${mine.map(it => `<button class="skin ${save.eq[lockerTab] === it.id ? 'sel' : ''}" data-id="${it.id}">
          ${swatch(lockerTab, it)}<div class="nm">${esc(it.name)}</div><div class="rr" style="color:${RARITY[it.rarity].color}">${RARITY[it.rarity].name}</div></button>`).join('')}</div>`
      : emptyLocker(`You don't have any ${KIND_NAME[lockerTab].toLowerCase()} items yet.`);
  }
  const gear = `<div class="tabs gear"><button class="tab ${save.gear !== 'board' ? 'on' : ''}" data-gear="ski">${icon('skis')} Skis</button><button class="tab ${save.gear === 'board' ? 'on' : ''}" data-gear="board">${icon('board')} Snowboard</button></div>`;
  openPanel('Locker', `${gear}<div class="tabs">${tabs}</div>${body}<div class="note closetTip">Drag your rider to spin it. Want more? Everything is in the Shop.</div>`, true, true);
  const B = $('panelBody');
  B.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { lockerTab = b.dataset.tab; renderLocker(); });
  B.querySelectorAll('[data-gear]').forEach(b => b.onclick = () => { save.gear = b.dataset.gear; persist(); cfg.onCosmetics(); renderLocker(); });
  B.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { save.eq[lockerTab] = b.dataset.id; persist(); cfg.onCosmetics(); renderLocker(); });
  B.querySelectorAll('[data-fit]').forEach(b => b.onclick = () => {
    const f = FITS.find(x => x.id === b.dataset.fit);
    for (const [k, id] of Object.entries(f.pieces)) if (save.inv[k].includes(id)) save.eq[k] = id;
    persist(); cfg.onCosmetics(); cfg.sfx.perfect(); renderLocker();
  });
  if ($('toShop')) $('toShop').onclick = () => renderShop(lockerTab === 'fits' ? 'fits' : lockerTab);
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
  openPanel('Leaderboard', `${tabs}<div id="nameSlot"></div><div id="lbList" class="list"><div class="note">Loading…</div></div>`);
  $('panelBody').querySelectorAll('[data-lb]').forEach(b => b.onclick = () => { lbTab = b.dataset.lb; renderLeaderboard(); });
  nameForm($('nameSlot'), () => renderLeaderboard());
  const data = await LB.get(lbTab, lbTab === 'race' ? today() : null);
  const el = $('lbList'); if (el) el.innerHTML = lbRows(data, lbTab, 20);
}

// Names are claimed once per browser and can't be changed afterwards (enforced in the database too).
function nameForm(slot, after, compact) {
  if (!slot) return;
  if (save.name) { slot.innerHTML = compact ? '' : `<div class="chip" style="align-self:center">Playing as <b>${esc(save.name)}</b></div>`; return; }
  slot.innerHTML = `<div class="note" style="margin-bottom:6px">Pick a name for the leaderboard. You can't change it later.</div>
    <div class="nameRow"><input id="nameIn" maxlength="14" placeholder="Your name" autocomplete="off" onkeydown="if(event.key==='Enter')document.getElementById('nameSave').click()"><button class="btn primary" id="nameSave">Claim</button></div>
    <div class="note" id="nameErr" style="color:#ff8a8a"></div>`;
  const btn = $('nameSave'), input = $('nameIn');
  setTimeout(() => input?.focus(), 50);
  btn.onclick = async () => {
    const v = input.value.trim().replace(/\s+/g, ' ').slice(0, 14);
    if (v.length < 2) { $('nameErr').textContent = 'At least 2 characters.'; return; }
    btn.disabled = true; btn.textContent = '…';
    const res = await LB.register(v);
    btn.disabled = false; btn.textContent = 'Claim';
    if (!res) { $('nameErr').textContent = "Couldn't reach the leaderboard. Try again in a moment."; return; }
    if (!res.ok) { $('nameErr').textContent = res.error === 'taken' ? 'That name is taken. Try another.' : 'Pick a longer name.'; return; }
    save.name = res.name; persist(); miniCache = {};
    after && after();
  };
}

function lbRows(data, board, limit) {
  if (!data) return `<div class="note">Couldn't reach the leaderboard.<br>Your best: <b>${board === 'race' ? (save.raceBest?.[today()] ? fmtTime(save.raceBest[today()]) : '—') : save.best.toLocaleString()}</b></div>`;
  if (!data.top.length) return `<div class="note">No entries yet. Be the first.</div>`;
  const fmt = v => board === 'race' ? fmtTime(v) : Math.round(v).toLocaleString();
  const rows = data.top.slice(0, limit).map((r, i) => rowHtml(i + 1, r.name, fmt(r.value), r.isMe)).join('');
  const me = data.me && data.me.rank > limit ? rowHtml(data.me.rank, save.name || 'You', fmt(data.me.value), true) : '';
  return rows + me;
}
const rowHtml = (rank, name, val, me, extra = '') =>
  `<div class="item ${me ? 'me' : ''} ${rank === 1 ? 'first' : ''} ${extra}"><span class="rank">${rank === 1 ? icon('crown') : rank}</span><span class="grow">${esc(name)}</span><span class="val">${val}</span></div>`;

// ---------- results ----------
// A new record goes straight to the leaderboard moment; everything else shows the results card.
export function showResults(r) {
  if (r.newBest) recordMoment(r, () => resultsCard(r));
  else resultsCard(r);
}

function resultsCard(r) {
  const el = $('over');
  const earned = r.coins + r.bonus + r.missions.total;
  let body;
  if (r.mode === 'race') {
    const field = r.field.length > 1
      ? `<div class="list">${r.field.map((f, i) => rowHtml(i + 1, f.name, fmtTime(f.t), f.me)).join('')}</div>` : '';
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
    <div class="row btnGrid">
      <button class="btn" id="menuBtn">${icon('home')}Menu</button>
      <button class="btn" id="toLb">${icon('trophy')}Ranks</button>
      ${chestReady ? `<button class="btn" id="toChests">${icon('chest')}Chests</button>` : ''}
      <button class="btn" id="shareBtn">${icon('share')}Share</button>
    </div>
  </div>`;
  el.classList.remove('hidden');
  $('againBtn').onclick = () => cfg.onAgain();
  $('menuBtn').onclick = () => cfg.onMenu();
  if ($('toChests')) $('toChests').onclick = () => { cfg.onMenu(); renderShop('chests'); };
  $('toLb').onclick = () => { lbTab = r.mode; cfg.onMenu(); renderLeaderboard(); };
  $('shareBtn').onclick = () => share(r);
  if (save.name) rankRow(r);
  miniCache = {};
}
// small "World rank #n" row on the results card (submits silently if the record moment didn't already)
async function rankRow(r) {
  const { board, day, value, ghost } = lbArgs(r);
  if (!r.submitted) { r.submitted = !!(await LB.submit(board, value, day, ghost)); if (!r.submitted) return; }
  const data = await LB.get(board, day, 10);
  const lb = $('resLb');
  if (!lb || !data?.me) return;
  lb.innerHTML = `<button class="earn" id="rankRow" style="width:100%"><span>${board === 'race' ? "Today's rank" : 'World rank'}</span><b>${data.me.rank === 1 ? icon('crown') : ''}#${data.me.rank} <small style="color:var(--muted);font-weight:600">of ${data.total}</small></b></button>`;
  $('rankRow').onclick = () => { const o = overlay(); revealBoard(o, data, board, () => o.remove()); };
}
const lbArgs = r => ({ board: r.mode, day: r.mode === 'race' ? r.day : null, value: r.mode === 'race' ? r.best : save.best, ghost: r.ghost ? { t: r.ghost.t, f: r.ghost.f } : undefined });

function overlay() {
  document.getElementById('lbReveal')?.remove();
  const el = document.createElement('div');
  el.id = 'lbReveal';
  el.innerHTML = `<canvas id="confetti"></canvas><div class="card rv" id="rvCard"></div><button class="rvClose" id="rvClose" aria-label="Close">${icon('close')}</button>`;
  document.body.appendChild(el);
  // there's always a way out: the corner X, a tap outside the card, or Esc
  const close = () => (el._done || (() => el.remove()))();
  el.querySelector('#rvClose').onclick = close;
  el.onclick = e => { if (e.target === el) close(); };
  return el;
}

// The new-record moment: big number → (claim a name) → animated leaderboard with your row flying into place.
function recordMoment(r, done) {
  const el = overlay(), card = el.querySelector('#rvCard');
  const finish = () => { el.remove(); done(); };
  el._done = finish;
  const big = r.mode === 'race' ? fmtTime(r.time) : r.score.toLocaleString();
  card.innerHTML = `<div class="rv-kicker">${r.mode === 'race' ? 'NEW PERSONAL BEST' : 'NEW RECORD'}</div>
    <div class="rv-score">${big}</div><div id="rvStep"></div>`;
  cfg.sfx.perfect();
  const step = $('rvStep');
  const go = async () => {
    step.innerHTML = '<div class="note">Checking the leaderboard…</div>';
    const { board, day, value, ghost } = lbArgs(r);
    r.submitted = !!(await LB.submit(board, value, day, ghost));
    const data = r.submitted ? await LB.get(board, day, 7) : null;
    if (!data?.me) {
      step.innerHTML = `<div class="note">Couldn't reach the leaderboard right now.</div><button class="btn primary" id="rvOk">Continue</button>`;
      $('rvOk').onclick = finish; return;
    }
    revealBoard(el, data, board, finish);
  };
  if (save.name) go();
  else {
    step.innerHTML = `<div class="rv-sub" style="margin:6px 0 10px">Claim your spot on the ${r.mode === 'race' ? "today's race" : 'world'} leaderboard</div><div id="rvName"></div><button class="btn" id="rvSkip" style="margin-top:8px;width:100%">Not now</button>`;
    nameForm($('rvName'), go);
    $('rvSkip').onclick = finish;
  }
}

function revealBoard(el, data, board, done) {
  el._done = done;
  const card = el.querySelector('#rvCard');
  const fmt = v => board === 'race' ? fmtTime(v) : Math.round(v).toLocaleString();
  const me = data.me, inTop = me.rank <= data.top.length;
  let rows = data.top.map((r, i) => ({ rank: i + 1, ...r }));
  if (!inTop) rows = rows.slice(0, 5).concat([{ gap: true }, { rank: me.rank, name: save.name, value: me.value, isMe: true }]);
  const from = Math.min(data.total, me.rank + 40);
  card.innerHTML = `
    <div class="rv-kicker">${board === 'race' ? "TODAY'S RACE" : 'WORLD LEADERBOARD'}</div>
    ${me.rank === 1 ? `<div class="rv-crown">${icon('crown')}</div>` : ''}
    <div class="rv-rank">#<span id="rvRank">${from}</span></div>
    <div class="rv-sub">${me.rank === 1 ? 'You are number one!' : `out of ${data.total} player${data.total === 1 ? '' : 's'}`}</div>
    <div class="list">${rows.map((r, i) => r.gap ? '<div class="rv-gap">···</div>'
      : rowHtml(r.rank, r.name, fmt(r.value), r.isMe, r.isMe ? 'rv-row rv-me' : 'rv-row').replace('class="item', `style="animation-delay:${r.isMe ? 1.0 : 0.15 + i * 0.06}s" class="item`)).join('')}</div>
    <button class="btn primary" id="rvOk">Continue</button>`;
  $('rvOk').onclick = done;
  const start = performance.now(), D = 1150;
  const tick = now => {
    const k = Math.min(1, (now - start) / D), e = 1 - Math.pow(1 - k, 3);
    const n = Math.round(from - (from - me.rank) * e);
    const node = $('rvRank'); if (!node) return;
    if (node.textContent !== String(n)) { node.textContent = n; cfg.sfx.tone(500 + (1 - k) * 300, 0.03, 'square', 0.03); }
    if (k < 1) requestAnimationFrame(tick);
    else {
      node.parentElement.classList.add('landed'); el.querySelector('.rv-crown')?.classList.add('on');
      cfg.sfx.perfect(); if (me.rank <= 10) confetti(me.rank === 1 ? 280 : 160);
    }
  };
  requestAnimationFrame(tick);
}
function confetti(n) {
  const c = $('confetti'); if (!c) return;
  const g = c.getContext('2d'), W = c.width = innerWidth, H = c.height = innerHeight;
  const cols = ['#ff6b2c', '#ffc93c', '#4cc3ff', '#3ddc84', '#c264ff', '#ffffff'];
  const ps = Array.from({ length: n }, () => ({ x: W / 2 + (Math.random() - .5) * 120, y: H * .3, vx: (Math.random() - .5) * 16, vy: -Math.random() * 15 - 4, r: Math.random() * 6, vr: (Math.random() - .5) * .4, w: 5 + Math.random() * 6, h: 8 + Math.random() * 8, c: cols[(Math.random() * cols.length) | 0] }));
  const t0 = performance.now();
  const step = now => {
    if (!document.body.contains(c)) return;
    g.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.vy += 0.38; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); g.restore();
    }
    if (now - t0 < 3500) requestAnimationFrame(step); else g.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(step);
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
  put('icShop', 'shop'); put('icSkis', 'skis'); put('icTarget', 'target'); put('icTrophy', 'trophy'); put('icHelp', 'help');
  put('panelClose', 'close'); put('pauseBtn', 'pause');
  $('icGo1').innerHTML = $('icGo2').innerHTML = '<svg class="ic go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  $('playBtn').onclick = () => c.onPlay('endless');
  $('raceBtn').onclick = () => c.onPlay('race');
  $('shopBtn').onclick = () => { c.sfx.init(); shopSel = null; renderShop(freeChestReady() ? 'chests' : shopTab); };
  $('lockerBtn').onclick = () => { c.sfx.init(); renderLocker(); };
  $('missionsBtn').onclick = () => { c.sfx.init(); renderMissions(); };
  $('lbBtn').onclick = () => { c.sfx.init(); lbTab = miniTab; renderLeaderboard(); };
  $('helpBtn').onclick = () => { c.sfx.init(); renderHelp(); };
  $('profileBtn').onclick = () => { c.sfx.init(); renderProfile(); };
  document.querySelectorAll('[data-mlb]').forEach(b => b.onclick = () => { miniTab = b.dataset.mlb; miniBoard(); });
  $('panelClose').onclick = closePanel;
  $('panel').onclick = e => { if (e.target === $('panel')) closePanel(); };
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('lbReveal')) $('rvClose').click();
    else if (!$('panel').classList.contains('hidden')) closePanel();
  });
  setInterval(() => { if (!$('menu').classList.contains('hidden')) showMenuUI(); }, 30000);
}
