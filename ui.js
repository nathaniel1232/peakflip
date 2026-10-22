// ============================================================
//  Menus, item shop, locker, missions, results, leaderboards
// ============================================================
import {
  save, persist, CATALOG, RARITY, KIND_NAME, SETS, FITS, fitOwned,
  collectionCount, missionText, adProgress, adWatched, adUsesLeft, useAd,
  isLimited, setDaysLeft, setAvailable, grantScoreRewards, grantSecret,
  shopToday, msToNewShop, buyItem, buyBundle, giftReady, claimGift, GIFT, fitOffer, buyFit,
} from './meta.js';
import { icon } from './icons.js';
import { rpc } from './net.js';
import { Cloud } from './cloud.js';
import { initChat } from './chat.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const today = () => new Date().toISOString().slice(0, 10);
const coin = '<span class="coin"></span>';
let cfg = null;

if (!save.pid) { save.pid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); persist(); }

// ---------- leaderboard / ghost client (Supabase RPC over plain fetch) ----------
const LB = {
  async get(board, day, limit = 20, period = 'all') {
    try { return await rpc('get_leaderboard_v2', { p_board: board, p_day: day || '', p_pid: save.pid, p_limit: limit, p_period: period }); }
    catch { return null; }
  },
  // null = network trouble (try again later); { ok: false } = the server turned it down for good
  async submit(board, value, day, time, ghost) {
    if (!save.name) return null;
    try { return await rpc('submit_score_v2', { p_board: board, p_day: day || '', p_pid: save.pid, p_name: save.name, p_value: value, p_time: time ?? null, p_ghost: ghost || null }); }
    catch (e) { return /\b4\d\d\b/.test(e.message) ? { ok: false } : null; }
  },
};

// ---------- score queue ----------
// Every finished run goes into a small queue (best per board and day), saved with the rest of the progress.
// It's sent as soon as there's a name and a connection, so no run is ever lost to "no name yet" or a bad network.
const better = (a, b) => a.value > b.value || (a.value === b.value && (a.time ?? 0) < (b.time ?? 0));
const daysAgo = day => (Date.parse(today()) - Date.parse(day)) / 864e5;
let raceGhost = null;   // today's best race recording is too big for the save, so it rides along in memory
function queueScore(e) {
  const q = save.lbQueue = (save.lbQueue || []).filter(x => !(x.board === e.board && x.day === e.day && !better(x, e)));
  if (!q.some(x => x.board === e.board && x.day === e.day)) q.push(e);
  persist();
}
let flushing = null;
function flushScores() {
  if (flushing) return flushing.then(() => flushScores());
  flushing = (async () => {
    if (!save.name) return;
    // the server only takes Endless days from the last week and the race for today or yesterday
    save.lbQueue = (save.lbQueue || []).filter(e => daysAgo(e.day) <= (e.board === 'racepts' ? 1 : 6));
    for (const e of save.lbQueue.slice()) {
      const ghost = e.board === 'racepts' && raceGhost?.day === e.day && raceGhost.score === e.value ? raceGhost.ghost : undefined;
      let res = await LB.submit(e.board, e.value, e.day, e.time, ghost);
      // an older database only knows players who registered there: register this name, then send again
      if (res && !res.ok) { await LB.register(save.name); res = await LB.submit(e.board, e.value, e.day, e.time, ghost); }
      if (!res) continue;   // offline: keep it for next time
      save.lbQueue = save.lbQueue.filter(x => x !== e);
    }
    persist(false);
  })().finally(() => { flushing = null; });
  return flushing;
}
// queue this run, send everything, and report whether this run made it to the server
async function submitRun(r) {
  const { board, day, value, time, ghost } = lbArgs(r);
  if (ghost) raceGhost = { day, score: value, ghost };
  queueScore({ board, day: day || today(), value, time: time ?? null });
  await flushScores();
  const sent = !!save.name && !save.lbQueue.some(x => x.board === board && x.day === (day || today()));
  if (sent) { miniCache = {}; refreshLeader(true); }
  return sent;
}
LB.register = async name => {
  try { return await rpc('register_name', { p_pid: save.pid, p_name: name }); }
  catch { return null; }
};
// undefined = the database doesn't have change_name yet (404); null = network trouble
LB.rename = async name => {
  try { return await rpc('change_name', { p_pid: save.pid, p_name: name }); }
  catch (e) { return /\b404\b/.test(e.message) ? undefined : null; }
};
export async function fetchGhosts(day) {
  try { return (await rpc('get_ghosts_v2', { p_day: day, p_pid: save.pid })) || []; }
  catch { return []; }
}

// ---------- swatches ----------
const RAINBOW = 'linear-gradient(90deg,#ff5a5a,#ffb35a,#ffe45a,#5aff8a,#5ac8ff,#b05aff)';
const ACC_SVG = {
  hat: '<path d="M6 16h12M8 16c0-6 2-9 4-9s4 3 4 9"/>',
  face: '<circle cx="8" cy="12" r="3"/><circle cx="16" cy="12" r="3"/><path d="M11 12h2"/>',
  back: '<path d="M8 5h8l2 15H6z"/><path d="M9 5c0-2 6-2 6 0"/>',
};
// item pictures are small 3D renders (made by the game, filled in as they're ready); old flat swatches are only a fallback
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function thumb(key) {
  const url = cfg.thumb(key);
  return url === false ? null : `<img class="thumb ${url ? 'ready' : ''}" data-thumb="${key}" src="${url || BLANK}" alt="" draggable="false">`;
}
function swatch(kind, it) {
  if (!(kind === 'hat' || kind === 'face' || kind === 'back') || it.id !== 'none') { const t = thumb(`${kind}:${it.id}`); if (t) return t; }
  return swatch2d(kind, it);
}
function swatch2d(kind, it) {
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
  $('panelTitle').textContent = title; $('panelTitle').dataset.text = title;
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

const fmtCooldown = ms => { const m = Math.ceil(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
export function showMenuUI() {
  $('menuBest').textContent = save.best.toLocaleString();
  $('menuCoins').textContent = save.coins.toLocaleString();
  const rs = save.raceScores?.[today()];
  if ($('avaSub') && save.avaBest) $('avaSub').textContent = `Outrun the snow · best ${save.avaBest.toLocaleString()}`;
  $('raceSub').textContent = rs ? `Forest course · ${Number(rs.score || 0).toLocaleString()} points` : 'Forest course · new every day';
  const pb = $('profileBtn');
  pb.classList.toggle('claim', !save.name);
  pb.innerHTML = save.name ? `${icon('user')}<b>${esc(save.name)}</b>` : `${icon('user')}<b>Claim your name</b>`;
  miniBoard();
  const ready = giftReady();
  $('chestBadge').classList.toggle('hidden', !ready);
  $('shopSub').textContent = ready ? 'Daily gift ready!' : `New items in ${fmtLeft(msToNewShop())}`;
  const { have } = collectionCount();
  $('lockerSub').textContent = `${have} owned`;
  $('missionSub').textContent = `${save.missions.length} active`;
}

// ---------- menu leaderboard preview ----------
let miniTab = 'endless', miniPeriod = 'all', miniCache = {}, miniRequest = 0, leaderRequest = 0;
let leaderPromise = null, leaderFetchedAt = 0;
async function miniBoard(force) {
  const el = $('miniLb'); if (!el) return;
  document.querySelectorAll('[data-mlb]').forEach(b => b.classList.toggle('on', b.dataset.mlb === miniTab));
  document.querySelectorAll('[data-ml-period]').forEach(b => b.classList.toggle('on', b.dataset.mlPeriod === miniPeriod));
  document.querySelector('.miniPeriod')?.classList.toggle('hidden', miniTab === 'race');
  const key = `${today()}:${miniTab}:${miniPeriod}`, token = ++miniRequest, c = miniCache[key];
  if (c && !force && Date.now() - c.at < 60000) { el.innerHTML = c.html; return; }
  if (!c) el.innerHTML = '<div class="note">Loading…</div>';
  const board = miniTab === 'race' ? 'racepts' : 'endless', period = board === 'racepts' ? 'all' : miniPeriod;
  const data = await LB.get(board, board === 'racepts' ? today() : null, 5, period);
  let html = lbRows(data, board, 5);
  if (data && !data.me) html += `<div class="note">${board === 'racepts' ? "You haven't raced today." : 'Set a score to get on the board.'}</div>`;
  miniCache[key] = { at: Date.now(), html };
  if (token === miniRequest && miniTab === (board === 'racepts' ? 'race' : 'endless') && (board === 'racepts' || miniPeriod === period)) el.innerHTML = html;
}

async function refreshLeader(force = false) {
  if (!save.name) {
    window.dispatchEvent(new CustomEvent('peakflip-leader', { detail: { active: false } }));
    return;
  }
  if (leaderPromise) {
    if (!force) return leaderPromise;
    ++leaderRequest;
    await leaderPromise;
  }
  if (!force && Date.now() - leaderFetchedAt < 25000) return;
  const token = ++leaderRequest;
  leaderPromise = Promise.all([
    LB.get('endless', null, 1, 'all'), LB.get('endless', null, 1, 'weekly'),
    LB.get('endless', null, 1, 'daily'), LB.get('racepts', today(), 1, 'all'),
  ]).then(results => {
    leaderFetchedAt = Date.now();
    if (token === leaderRequest) window.dispatchEvent(new CustomEvent('peakflip-leader', { detail: { active: results.some(data => data?.me?.rank === 1) } }));
  }).finally(() => { leaderPromise = null; });
  return leaderPromise;
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

// ---------- settings ----------
function renderSettings() {
  const q = save.quality || 'auto', seg = (attr, opts, cur) => `<div class="tabs">${opts.map(([v, label]) => `<button class="tab ${String(cur) === String(v) ? 'on' : ''}" data-${attr}="${v}">${label}</button>`).join('')}</div>`;
  openPanel('Settings', `
    <div class="setRow"><span>Graphics</span>${seg('q', [['auto', 'Auto'], ['high', 'High'], ['low', 'Low']], q)}</div>
    <div class="note">Low is much smoother: lower resolution, no anti-aliasing, fewer trees and particles, simpler mountains and less falling snow. Auto picks Low on slower devices. Changing this restarts the game.</div>
    <div class="setRow"><span>Music</span>${seg('music', [[1, 'On'], [0, 'Off']], cfg.music.on ? 1 : 0)}</div>
    <div class="setRow"><span>All sound</span>${seg('sound', [[1, 'On'], [0, 'Off']], cfg.sfx.muted ? 0 : 1)}</div>`);
  const B = $('panelBody');
  B.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { if (b.dataset.q === q) return; save.quality = b.dataset.q; persist(); location.reload(); });
  B.querySelectorAll('[data-music]').forEach(b => b.onclick = () => { if (+b.dataset.music !== (cfg.music.on ? 1 : 0)) { cfg.sfx.init(); cfg.music.toggle(); cfg.soundUI(); } renderSettings(); });
  B.querySelectorAll('[data-sound]').forEach(b => b.onclick = () => { if (+b.dataset.sound === (cfg.sfx.muted ? 1 : 0)) { cfg.sfx.init(); cfg.sfx.toggle(); } renderSettings(); });
}

// ---------- how to play ----------
function renderHelp() {
  openPanel('How to play', `<div class="help">
    <h4>Controls</h4><div class="item">${cfg.hints}</div>
    <h4>Endless</h4><div class="item">Ride as far as you can. Speed and tricks score points, and coins buy items in the daily Item Shop. Landing upside down or hitting trees and rocks ends the run.</div>
    <h4>Daily Race</h4><div class="item">A new forest course every day, the same for everyone. Score points across all 11 checkpoints; higher points rank first, and elapsed time breaks ties. Each checkpoint reached adds 500 bonus points. Race against other players' ghosts.
      </div>
    <h4>Leaderboards</h4><div class="item">Pick any name and every run goes on the board automatically. You can change your name any time. Endless has all time, weekly, and daily boards. A golden crown marks the current leader.</div>
  </div>`);
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

// ---------- item shop: today's rotation, bought with coins (like an item shop, no chests) ----------
let shopSel = null;   // { kind, id } the item shown in the detail bar
const KINDS = Object.keys(CATALOG);
const daysText = d => d <= 0 ? 'last day' : d === 1 ? '1 day left' : `${d} days left`;
const shortNum = n => n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}k` : String(n);
const fmtLeft = ms => { const m = Math.max(1, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const owns = (kind, id) => save.inv[kind].includes(id);
function sourceText(it) {
  if (it.ad) return `Watch ${it.ad} ad${it.ad > 1 ? 's' : ''} to unlock`;
  if (it.score) return `Reach a score of ${it.score.toLocaleString()} (your best: ${save.best.toLocaleString()})`;
  if (it.secret) return 'A secret. Keep exploring…';
  if (isLimited(it)) return setAvailable(it.set) ? `Limited edition · ${daysText(setDaysLeft(it.set))} · shows up in the Limited row` : 'Limited edition, retired';
  return 'Shows up in the item shop from time to time';
}
// score rewards unlocked by the run that just ended (or a best that came from the cloud)
export function checkRewards() {
  for (const { it } of grantScoreRewards()) note(`Unlocked ${it.name} for scoring ${it.score.toLocaleString()}!`);
}
export function findSecret(kind, id, text) {
  if (!grantSecret(kind, id)) return;
  note(text); cfg.sfx.perfect(); if (!$('menu').classList.contains('hidden')) showMenuUI();
}
// one item card: big for Featured, small for everything else
function offerCard(o, big) {
  const { kind, it } = o, own = owns(kind, it.id), sel = shopSel?.kind === kind && shopSel.id === it.id, rc = RARITY[it.rarity].color;
  return `<button class="offer ${big ? 'big' : ''} ${sel ? 'sel' : ''} ${own ? 'owned' : ''}" style="--rc:${rc}" data-offer="${kind}:${it.id}">
    ${o.deal ? '<span class="offerTag">ITEM OF THE DAY</span>' : isLimited(it) ? '<span class="offerTag lim">LIMITED</span>' : ''}
    <div class="offerArt">${swatch(kind, it)}</div>
    <div class="offerName">${esc(it.name)}</div>
    <div class="offerKind">${RARITY[it.rarity].name} ${KIND_NAME[kind]}</div>
    <div class="offerPrice">${own ? `${icon('check')} Owned` : `${o.was ? `<s>${o.was}</s> ` : ''}${coin} ${o.price.toLocaleString()}`}</div>
  </button>`;
}
function shopHtml() {
  const shop = shopToday(), gift = giftReady(), streak = save.giftDay === new Date(Date.now() - 864e5).toISOString().slice(0, 10) ? (save.streak || 0) + 1 : 1;
  const b = shop.bundle, bundleOwned = b && b.pieces.every(x => owns(x.kind, x.it.id));
  const limitedLeft = Math.min(...Object.keys(SETS).filter(k => SETS[k].until && setAvailable(k)).map(setDaysLeft));
  const adItems = KINDS.flatMap(kind => CATALOG[kind].filter(it => it.ad).map(it => ({ kind, it })));
  return `
    <div class="shopTop">
      <div class="chip"><span class="coin"></span><b>${save.coins.toLocaleString()}</b></div>
      <div class="chip">New items in <b>${fmtLeft(msToNewShop())}</b></div>
    </div>
    <button class="giftBar ${gift ? 'ready' : ''}" id="giftBtn" ${gift ? '' : 'disabled'}>${icon('gift')}
      <span>${gift ? `Daily gift · day ${Math.min(streak, GIFT.length)} streak` : `Gift claimed · come back tomorrow (day ${Math.min((save.streak || 0) + 1, GIFT.length)})`}</span>
      <b>${coin} ${gift ? GIFT[Math.min(streak, GIFT.length) - 1] : GIFT[Math.min((save.streak || 0) + 1, GIFT.length) - 1]}</b></button>
    <div class="secHead">Featured</div>
    <div class="offers featured">${shop.featured.map(o => offerCard(o, true)).join('')}</div>
    ${b ? `<div class="secHead">Bundle <small>${esc(SETS[b.fit.set].name)} · 30% off</small></div>
    <div class="bundle" style="--c:${SETS[b.fit.set].color}">
      <div class="bundleHead"><b>${esc(b.fit.name)}</b><span>${b.pieces.length} items</span></div>
      <div class="fitPieces">${b.pieces.map(x => `<div class="fp ${owns(x.kind, x.it.id) ? '' : 'miss'}" title="${esc(x.it.name)}">${swatch(x.kind, x.it)}</div>`).join('')}</div>
      <div class="row"><button class="btn" id="tryBundle">Try on</button>
      <button class="btn go" id="buyBundle" ${bundleOwned || save.coins < b.price ? 'disabled' : ''}>${bundleOwned ? `${icon('check')} Owned` : `<s>${b.was}</s> ${coin} ${b.price}`}</button></div>
    </div>` : ''}
    <div class="secHead">Daily</div>
    <div class="offers">${shop.daily.map(o => offerCard(o)).join('')}</div>
    ${shop.limited.length ? `<div class="secHead">Limited <small>leaves the shop for good · ${daysText(limitedLeft)}</small></div>
    <div class="offers">${shop.limited.map(o => offerCard(o)).join('')}</div>` : ''}
    ${adItems.length ? `<div class="secHead">Watch to unlock</div>
    <div class="offers">${adItems.map(({ kind, it }) => `<button class="offer ${owns(kind, it.id) ? 'owned' : ''}" style="--rc:${RARITY[it.rarity].color}" data-offer="${kind}:${it.id}">
      <div class="offerArt">${swatch(kind, it)}</div><div class="offerName">${esc(it.name)}</div><div class="offerKind">${KIND_NAME[kind]}</div>
      <div class="offerPrice">${owns(kind, it.id) ? `${icon('check')} Owned` : `${icon('play')} ${adWatched(kind, it.id)}/${it.ad}`}</div></button>`).join('')}</div>` : ''}
    ${cfg.ads.available ? `<button class="btn" id="adCoins" ${adUsesLeft('coins') > 0 ? '' : 'disabled'}>${icon('play')} +75 coins <small style="opacity:.7">(${adUsesLeft('coins')} left today)</small></button>` : ''}
    <div class="note">The shop changes every day at 00:00 UTC, the same for everyone. Coins are earned only by playing. No real money involved.</div>`;
}
// the buy bar: pinned to the bottom of the shop, so whatever you tap can be bought right where you are
function detailBar() {
  if (shopSel?.fit) {
    const f = FITS.find(x => x.id === shopSel.fit), o = fitOffer(f), owned = !o.missing.length;
    const action = owned ? `<button class="btn" disabled>${icon('check')} Owned</button>`
      : `<button class="btn go" data-buyfit="${f.id}" ${save.coins >= o.price && o.available ? '' : 'disabled'}>Buy ${coin} ${o.price.toLocaleString()}</button>`;
    return `<div class="buyDock">${thumb('fit:' + f.id) || ''}<span><b>${esc(f.name)}</b><small>${owned ? 'You own the whole outfit' : save.coins >= o.price ? `Whole outfit · ${o.missing.length} item${o.missing.length > 1 ? 's' : ''} you don't have` : `You need ${(o.price - save.coins).toLocaleString()} more coins`}</small></span>${action}<button class="btn" id="tryReset" title="Take off">${icon('close')}</button></div>`;
  }
  if (!shopSel) return '';
  const { kind, id } = shopSel, it = CATALOG[kind].find(i => i.id === id), own = owns(kind, id);
  const shop = shopToday(), offer = [...shop.featured, ...shop.daily, ...shop.limited].find(x => x.kind === kind && x.it.id === id);
  let action;
  if (own) action = save.eq[kind] === id ? `<button class="btn" disabled>${icon('check')} Wearing</button>` : `<button class="btn go" id="shopEquip">Wear</button>`;
  else if (it.ad) action = `<button class="btn go" id="shopAd" ${cfg.ads.available ? '' : 'disabled'}>${icon('play')} ${adWatched(kind, id)}/${it.ad}</button>`;
  else if (offer) action = `<button class="btn go" id="shopBuy" ${save.coins >= offer.price ? '' : 'disabled'}>Buy ${coin} ${offer.price.toLocaleString()}</button>`;
  else action = `<button class="btn" disabled>${icon('lock')}</button>`;
  return `<div class="buyDock">${swatch(kind, it)}<span><b>${esc(it.name)}</b><small style="color:${RARITY[it.rarity].color}">${isLimited(it) ? 'Limited ' : ''}${RARITY[it.rarity].name} ${KIND_NAME[kind]}</small>
    <small>${own ? 'In your locker' : offer ? (save.coins >= offer.price ? 'In the shop today' : `You need ${(offer.price - save.coins).toLocaleString()} more coins`) : sourceText(it)}</small></span>${action}<button class="btn" id="tryReset" title="Take off">${icon('close')}</button></div>`;
}
// whole outfits: every look and themed fit, bought in one go
function outfitsHtml() {
  const fits = FITS.filter(f => setAvailable(f.set) || Object.entries(f.pieces).every(([k, id]) => id === 'none' || owns(k, id)));
  return `<div class="looks">${fits.map(f => {
    const set = SETS[f.set], o = fitOffer(f), owned = !o.missing.length;
    return `<div class="look" style="--c:${set.color}">
      ${set.until ? `<span class="offerTag lim">LIMITED · ${daysText(setDaysLeft(f.set))}</span>` : ''}
      <div class="lookArt">${thumb('fit:' + f.id) || ''}</div>
      <div class="offerName">${esc(f.name)}</div>
      <div class="offerKind" style="color:${set.color}">${set.name} · ${Object.values(f.pieces).filter(id => id !== 'none').length} items</div>
      <div class="row"><button class="btn" data-tryfit="${f.id}">Try on</button>
      <button class="btn go" data-buyfit="${f.id}" ${owned || save.coins < o.price ? 'disabled' : ''}>${owned ? `${icon('check')} Owned` : `<s>${o.was}</s> ${coin} ${o.price.toLocaleString()}`}</button></div>
    </div>`;
  }).join('')}</div>
  <div class="note">Whole outfits are 20% off, and you only pay for the pieces you don't own yet.</div>`;
}
let shopTimer = null, shopTab = 'today';
function renderShop(tab) {
  if (tab === 'today' || tab === 'outfits') shopTab = tab;
  const tabs = `<div class="tabs"><button class="tab ${shopTab === 'today' ? 'on' : ''}" data-stab="today">${icon('shop')} Today</button><button class="tab ${shopTab === 'outfits' ? 'on' : ''}" data-stab="outfits">${icon('gift')} Outfits</button></div>`;
  openPanel('Item Shop', `${tabs}${shopTab === 'outfits' ? `<div class="shopTop"><div class="chip"><span class="coin"></span><b>${save.coins.toLocaleString()}</b></div></div>${outfitsHtml()}` : shopHtml()}${detailBar()}`, true, true);
  clearInterval(shopTimer);   // keep the countdown fresh (and roll over to the new shop at midnight UTC)
  shopTimer = setInterval(() => { if ($('panelTitle').textContent === 'Item Shop' && !$('panel').classList.contains('hidden')) renderShop(); else clearInterval(shopTimer); }, 60000);
  const B = $('panelBody');
  B.querySelectorAll('[data-stab]').forEach(b => b.onclick = () => renderShop(b.dataset.stab));
  B.querySelectorAll('[data-tryfit]').forEach(b => b.onclick = () => { shopSel = { fit: b.dataset.tryfit }; preview({ ...FITS.find(x => x.id === b.dataset.tryfit).pieces }); renderShop(); });
  B.querySelectorAll('[data-buyfit]').forEach(b => b.onclick = () => {
    const f = FITS.find(x => x.id === b.dataset.buyfit);
    if (buyFit(f.id)) { for (const [k, id] of Object.entries(f.pieces)) if (id === 'none' || owns(k, id)) save.eq[k] = id; persist(); shopSel = null; preview(null); cfg.onCosmetics(); cfg.sfx.perfect(); celebrate(`${f.name} is yours!`); }
    renderShop();
  });
  B.querySelectorAll('[data-offer]').forEach(b => b.onclick = () => {
    const [kind, id] = b.dataset.offer.split(':'), t = { ...(tryOn || {}) };
    if (t[kind] === id) { delete t[kind]; shopSel = null; } else { t[kind] = id; shopSel = { kind, id }; }   // tap again to take it off
    preview(t); renderShop();
  });
  if ($('tryReset')) $('tryReset').onclick = () => { shopSel = null; preview(null); renderShop(); };
  if ($('tryBundle')) $('tryBundle').onclick = () => { shopSel = null; preview({ ...shopToday().bundle.fit.pieces }); renderShop(); };
  if ($('buyBundle')) $('buyBundle').onclick = () => { if (buyBundle()) { cfg.sfx.perfect(); celebrate('Bundle unlocked!'); } renderShop(); };
  if ($('shopBuy')) $('shopBuy').onclick = () => {
    const { kind, id } = shopSel;
    if (buyItem(kind, id)) { save.eq[kind] = id; persist(); cfg.sfx.perfect(); celebrate(`${CATALOG[kind].find(i => i.id === id).name} is yours!`); preview(tryOn); }
    renderShop();
  };
  if ($('shopEquip')) $('shopEquip').onclick = () => { save.eq[shopSel.kind] = shopSel.id; persist(); preview(tryOn); cfg.sfx.perfect(); renderShop(); };
  if ($('shopAd')) $('shopAd').onclick = async () => {
    $('shopAd').disabled = true;
    const { kind, id } = shopSel;
    if (await watchAd() && adProgress(kind, id)) { save.eq[kind] = id; persist(); cfg.sfx.perfect(); }
    preview(tryOn); renderShop();
  };
  if ($('giftBtn')) $('giftBtn').onclick = () => {
    const g = claimGift(); if (!g) return;
    cfg.sfx.coin(); celebrate(`+${g.amount} coins · day ${g.streak} streak`); renderShop(); showMenuUI();
  };
  const adC = $('adCoins');
  if (adC) adC.onclick = async () => { adC.disabled = true; if (await watchAd()) { useAd('coins'); save.coins += 75; persist(); cfg.sfx.coin(); } renderShop(); };
}
// a quick sparkle burst with a message (purchases, gifts)
function celebrate(text) {
  note(text);
  const c = document.createElement('canvas'); c.id = 'confetti'; c.style.zIndex = 8; document.body.appendChild(c);
  confetti(140); setTimeout(() => c.remove(), 3600);
}

// ---------- locker ----------
// ---------- locker: only what you own; tap to wear ----------
let lockerTab = 'outfit', tryOn = null;   // tryOn: { kind: id } previewed on the avatar in the Shop, not equipped
function preview(t) { tryOn = t && Object.keys(t).length ? t : null; cfg.preview(tryOn); }
function lockerFitsHtml() {
  // a fit shows up once you own at least one of its pieces, listing just the pieces you have
  const mine = FITS.filter(f => Object.entries(f.pieces).some(([k, id]) => id !== 'none' && save.inv[k].includes(id)));
  if (!mine.length) return emptyLocker('No fits yet. Bundles in the Item Shop give you a whole look at once.');
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
const emptyLocker = text => `<div class="note" style="padding:18px 0">${text}</div><button class="btn primary" id="toShop">${icon('shop')} Go to the Item Shop</button>`;
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
  if ($('toShop')) $('toShop').onclick = () => renderShop(lockerTab === 'fits' ? 'outfits' : 'today');
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
let lbTab = 'endless', lbPeriod = 'all', lbRequest = 0;
async function renderLeaderboard() {
  const token = ++lbRequest;
  const tabs = `<div class="tabs"><button class="tab ${lbTab === 'endless' ? 'on' : ''}" data-lb="endless">Endless</button><button class="tab ${lbTab === 'race' ? 'on' : ''}" data-lb="race">Daily Race</button></div>`;
  const periods = `<div class="tabs lbPeriods ${lbTab === 'race' ? 'hidden' : ''}"><button class="tab ${lbPeriod === 'all' ? 'on' : ''}" data-lb-period="all">All time</button><button class="tab ${lbPeriod === 'weekly' ? 'on' : ''}" data-lb-period="weekly">Weekly</button><button class="tab ${lbPeriod === 'daily' ? 'on' : ''}" data-lb-period="daily">Daily</button></div>`;
  openPanel('Leaderboard', `${tabs}${periods}<div id="nameSlot"></div><div class="note">${lbTab === 'race' ? 'Points rank first; faster time breaks ties. This board resets daily at 00:00 UTC.' : 'Leaders earn a golden crown while they hold first place. Weekly resets Monday at 00:00 UTC; daily resets at 00:00 UTC.'}</div><div id="lbList" class="list"><div class="note">Loading…</div></div>`);
  $('panelBody').querySelectorAll('[data-lb]').forEach(b => b.onclick = () => { lbTab = b.dataset.lb; renderLeaderboard(); });
  $('panelBody').querySelectorAll('[data-lb-period]').forEach(b => b.onclick = () => { lbPeriod = b.dataset.lbPeriod; renderLeaderboard(); });
  nameForm($('nameSlot'), () => renderLeaderboard());
  const board = lbTab === 'race' ? 'racepts' : 'endless';
  const data = await LB.get(board, board === 'racepts' ? today() : null, 20, board === 'racepts' ? 'all' : lbPeriod);
  if (token !== lbRequest || !$('lbList')) return;
  $('lbList').innerHTML = lbRows(data, lbTab, 20);
}

// Claim a leaderboard name, or (with a name already) change it whenever you like. Any name works (several
// players can share one), and old scores follow the new name.
const NAME_ERR = {
  taken: 'That name is taken. Try another.', too_short: 'Pick a longer name.',
  too_soon: 'You just changed your name. Try again in a few minutes.',
};
function nameForm(slot, after, compact, editing = false) {
  if (!slot) return;
  if (save.name && !editing) {
    slot.innerHTML = compact ? '' : `<div class="nameChip">Playing as <b>${esc(save.name)}</b><button class="btn" id="nameEdit">Change</button></div><div class="note">A golden crown marks the current leaderboard leader.</div>`;
    if (!compact) $('nameEdit').onclick = () => nameForm(slot, after, compact, true);
    return;
  }
  const renaming = !!save.name;
  slot.innerHTML = `${compact && !renaming ? '' : `<div class="note" style="margin-bottom:6px">${renaming ? 'Pick a new name. Your scores move with you.' : 'Pick any name for the leaderboard. You can change it later.'}</div>`}
    <div class="nameRow"><input id="nameIn" maxlength="20" placeholder="Your name" autocomplete="off" value="${renaming ? esc(save.name) : ''}"><button class="btn primary" id="nameSave">${renaming ? 'Save' : 'Claim'}</button>${renaming ? '<button class="btn" id="nameCancel">Cancel</button>' : ''}</div>
    <div class="note" id="nameErr" style="color:#ff8a8a"></div>`;
  const btn = $('nameSave'), input = $('nameIn');
  input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') btn.click(); };   // typing never reaches the game
  setTimeout(() => { input?.focus(); input?.select(); }, 50);
  if (renaming) $('nameCancel').onclick = () => nameForm(slot, after, compact);
  btn.onclick = async () => {
    const v = input.value.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!v) { $('nameErr').textContent = 'Type a name first.'; return; }
    if (renaming && v === save.name) { nameForm(slot, after, compact); return; }
    btn.disabled = true; btn.textContent = '…';
    // change_name also claims when there's no name yet; fall back to register_name if the database hasn't been updated
    let res = await LB.rename(v);
    if (res === undefined && !renaming) res = await LB.register(v);
    btn.disabled = false; btn.textContent = renaming ? 'Save' : 'Claim';
    if (!res) { $('nameErr').textContent = res === undefined && renaming ? "Name changes aren't switched on yet." : "Couldn't reach the leaderboard. Try again in a moment."; return; }
    if (!res.ok) { $('nameErr').textContent = NAME_ERR[res.error] || 'Something went wrong. Try another name.'; return; }
    save.name = res.name; persist(); miniCache = {};
    await flushScores(); refreshLeader(true); showMenuUI();
    if (renaming) nameForm(slot, after, compact);
    after && after();
  };
}

function lbRows(data, board, limit) {
  if (!data) {
    const raceScore = save.raceScores?.[today()]?.score;
    return `<div class="note">Couldn't reach the leaderboard.<br>Your best: <b>${board === 'race' || board === 'racepts' ? (Number.isFinite(raceScore) ? `${raceScore.toLocaleString()} points` : '—') : save.best.toLocaleString()}</b></div>`;
  }
  if (!data.top.length) return `<div class="note">No entries yet. Be the first.</div>`;
  const race = board === 'race' || board === 'racepts';
  const fmt = v => Math.round(v).toLocaleString();
  const rows = data.top.slice(0, limit).map((r, i) => rowHtml(r.rank ?? i + 1, r.name, fmt(r.value), r.isMe, '', race ? fmtTime(r.time) : '')).join('');
  const me = data.me && !data.top.slice(0, limit).some(r => r.isMe) ? rowHtml(data.me.rank, save.name || 'You', fmt(data.me.value), true, '', race ? fmtTime(data.me.time) : '') : '';
  return rows + me;
}
const rowHtml = (rank, name, val, me, extra = '', time = '') =>
  `<div class="item ${me ? 'me' : ''} ${rank === 1 ? 'first' : ''} ${extra}"><span class="rank">${rank === 1 ? icon('crown') : rank}</span><span class="grow">${esc(name)}</span>${time ? `<span class="rowTime">${time}</span>` : ''}<span class="val">${val}</span></div>`;

// ---------- results ----------
// A new record goes straight to the leaderboard moment; everything else shows the results card.
// Players without a name get the same moment after any run, with a name box, until they pick one
// (skipping it only quiets the prompt for ordinary runs until the page reloads).
let skippedName = false;
export function showResults(r) {
  const token = ++resultToken;
  setTimeout(checkRewards, 1200);
  if (r.mode === 'avalanche') { resultsCard(r, token); return; }   // its own local best, no world board
  if (r.newBest || (!save.name && !skippedName)) recordMoment(r, () => { if (token === resultToken) resultsCard(r, token); }, token);
  else { resultsCard(r, token); }
}

let resultToken = 0;
function resultsCard(r, token = resultToken) {
  const el = $('over');
  const earned = r.coins + r.bonus + r.missions.total;
  let body;
  if (r.mode === 'race') {
    const field = r.field.length > 1
      ? `<div class="list">${r.field.map((f, i) => rowHtml(f.rank ?? i + 1, f.name, Math.round(f.score).toLocaleString(), f.me, '', fmtTime(f.t))).join('')}</div>` : '';
    body = `
      ${r.newBest ? '<div class="tag">PERSONAL BEST</div>' : ''}
      <div class="big-num"><small>RACE POINTS</small><span class="snowy" data-text="${r.score.toLocaleString()}">${r.score.toLocaleString()}</span></div>
      <div class="sub">${fmtTime(r.time)} elapsed · ${r.gates}/${r.gateTotal} checkpoints${r.penalty ? ` · +${r.penalty}s penalty` : ''} · points rank first, time breaks ties</div>
      ${field}`;
  } else if (r.mode === 'avalanche') {
    body = `
      ${r.newBest ? '<div class="tag">NEW AVALANCHE RECORD</div>' : ''}
      <div class="big-num"><small>AVALANCHE SCORE</small><span class="snowy" data-text="${r.score.toLocaleString()}">${r.score.toLocaleString()}</span></div>
      <div class="sub">${esc(r.reason)} · ${r.dist.toLocaleString()} m · survived ${Math.floor(r.time)} s · best ${r.best.toLocaleString()}</div>`;
  } else {
    body = `
      ${r.newBest ? '<div class="tag">NEW RECORD</div>' : ''}
      <div class="big-num"><small>SCORE</small><span class="snowy" data-text="${r.score.toLocaleString()}">${r.score.toLocaleString()}</span></div>
      <div class="sub">${esc(r.reason)} · ${r.dist.toLocaleString()} m · best ${save.best.toLocaleString()}</div>`;
  }
  const missions = r.missions.done.length
    ? `<div class="list">${r.missions.done.map(m => `<div class="item">${icon('check')}<span class="grow">${esc(missionText(m))}</span><span class="val">${coin} ${m.reward}</span></div>`).join('')}</div>` : '';

  el.innerHTML = `<div class="card">
    ${body}
    <div class="earn"><span>Coins earned</span><b>${coin} +${earned}</b></div>
    ${missions}
    <div id="resLb"></div>
    <button id="againBtn" class="btn primary big">${icon('retry')}${r.mode === 'race' ? 'Race again' : 'Ride again'}</button>
    <div class="row btnGrid">
      <button class="btn" id="menuBtn">${icon('home')}Menu</button>
      <button class="btn" id="toLb">${icon('trophy')}Ranks</button>
      <button class="btn" id="toChests">${icon('shop')}Shop</button>
      <button class="btn" id="shareBtn">${icon('share')}Share</button>
    </div>
  </div>`;
  el.classList.remove('hidden');
  arm(el);
  $('againBtn').onclick = () => { const b = $('againBtn'); b.disabled = true; b.innerHTML = `${icon('retry')}Loading…`; cfg.onAgain(); };
  $('menuBtn').onclick = () => cfg.onMenu();
  if ($('toChests')) $('toChests').onclick = () => { cfg.onMenu(); renderShop(); };
  $('toLb').onclick = () => { lbTab = r.mode === 'race' ? 'race' : 'endless'; cfg.onMenu(); renderLeaderboard(); };
  $('shareBtn').onclick = () => share(r);
  if (r.mode !== 'avalanche') rankRow(r, token);
  miniCache = {};
}
// small "World rank #n" row on the results card (submits silently if the record moment didn't already)
async function rankRow(r, token) {
  const { board, day } = lbArgs(r);
  if (!r.submitted) r.submitted = await submitRun(r);
  if (!r.submitted) {
    // no name yet: the score waits in the queue, and claiming a name right here sends it
    const lb = $('resLb');
    if (token !== resultToken || !lb || save.name) return;
    lb.innerHTML = `<div class="saveBox"><div class="note">Pick a name to put this run on the leaderboard</div><div id="resName"></div></div>`;
    nameForm($('resName'), () => { lb.innerHTML = ''; rankRow(r, token); }, true);
    return;
  }
  if (token !== resultToken) return;
  const data = await LB.get(board, day, 10, 'all');
  if (token !== resultToken) return;
  const lb = $('resLb');
  if (!lb || !data?.me) return;
  lb.innerHTML = `<button class="earn" id="rankRow" style="width:100%"><span>${board === 'racepts' ? "Today's race rank · points first" : 'World rank'}</span><b>${data.me.rank === 1 ? icon('crown') : ''}#${data.me.rank} <small style="color:var(--muted);font-weight:600">of ${data.total}</small></b></button>`;
  $('rankRow').onclick = () => { const o = overlay(); revealBoard(o, data, board, () => o.remove()); };
}
const lbArgs = r => ({ board: r.mode === 'race' ? 'racepts' : 'endless', day: r.mode === 'race' ? r.day : null, value: r.score, time: r.mode === 'race' ? r.time : null, ghost: r.mode === 'race' && r.newBest && r.ghost ? { t: r.ghost.t, score: r.score, f: r.ghost.f } : undefined });

function overlay() {
  document.getElementById('lbReveal')?.remove();
  const el = document.createElement('div');
  el.id = 'lbReveal';
  el.innerHTML = `<canvas id="confetti"></canvas><div class="card rv" id="rvCard"></div><button class="rvClose" id="rvClose" aria-label="Close">${icon('close')}</button>`;
  document.body.appendChild(el);
  // there's always a way out: the corner X or Esc (not a tap outside: on phones that's usually a jump tap)
  el.querySelector('#rvClose').onclick = () => (el._done || (() => el.remove()))();
  arm(el);
  return el;
}
// Screens that pop up when you crash ignore taps for a moment, so taps meant as jumps don't hit Ride again
function arm(el) {
  el.classList.add('arming');
  clearTimeout(el._armT); el._armT = setTimeout(() => el.classList.remove('arming'), 900);
}

// The new-record moment: big number → (claim a name) → animated leaderboard with your row flying into place.
function recordMoment(r, done, token) {
  const el = overlay(), card = el.querySelector('#rvCard');
  const finish = () => { el.remove(); done(); };
  el._done = finish;
  const big = r.score.toLocaleString();
  card.innerHTML = `<div class="rv-kicker">${!r.newBest ? (r.mode === 'race' ? 'RACE POINTS' : 'YOUR SCORE') : r.mode === 'race' ? 'NEW PERSONAL BEST' : 'NEW RECORD'}</div>
    <div class="rv-score"><span class="snowy" data-text="${big}">${big}</span></div>${r.mode === 'race' ? `<div class="rv-sub">RACE POINTS · ${fmtTime(r.time)} elapsed · time breaks ties</div>` : ''}<div id="rvStep"></div>`;
  if (r.newBest) cfg.sfx.perfect();
  const step = $('rvStep');
  const go = async () => {
    if (token !== resultToken || !document.body.contains(el)) return;
    step.innerHTML = '<div class="note">Checking the leaderboard…</div>';
    const { board, day } = lbArgs(r);
    if (!r.submitted) r.submitted = await submitRun(r);
    if (token !== resultToken || !document.body.contains(el)) return;
    const data = r.submitted ? await LB.get(board, day, 7, 'all') : null;
    if (token !== resultToken || !document.body.contains(el)) return;
    if (!data?.me) {
      step.innerHTML = `<div class="note">Couldn't reach the leaderboard right now. Your score is saved and will be sent automatically.</div><button class="btn primary" id="rvOk">Continue</button>`;
      $('rvOk').onclick = finish; return;
    }
    revealBoard(el, data, board, finish);
  };
  if (save.name) go();
  else {
    // the run is queued right away, so it reaches the board the moment a name is picked (here or later)
    const { board, day, value, time, ghost } = lbArgs(r);
    if (ghost) raceGhost = { day, score: value, ghost };
    queueScore({ board, day: day || today(), value, time: time ?? null });
    step.innerHTML = `<div class="rv-sub" style="margin:6px 0 10px">Pick any name to put this on the ${r.mode === 'race' ? "today's race" : 'world'} leaderboard. You can change it later.</div><div id="rvName"></div><button class="btn" id="rvSkip" style="margin-top:8px;width:100%">Not now</button>`;
    nameForm($('rvName'), go, true);
    $('rvSkip').onclick = () => { skippedName = true; finish(); };
  }
}

function revealBoard(el, data, board, done) {
  el._done = done;
  const card = el.querySelector('#rvCard');
  const fmt = v => Math.round(v).toLocaleString();
  const me = data.me, inTop = data.top.some(r => r.isMe);
  let rows = data.top.map((r, i) => ({ rank: i + 1, ...r }));
  if (!inTop) rows = rows.slice(0, 5).concat([{ gap: true }, { rank: me.rank, name: save.name, value: me.value, time: me.time, isMe: true }]);
  const from = Math.min(data.total, me.rank + 40);
  card.innerHTML = `
    <div class="rv-kicker">${board === 'race' || board === 'racepts' ? "TODAY'S RACE · POINTS FIRST" : 'WORLD LEADERBOARD'}</div>
    ${me.rank === 1 ? `<div class="rv-crown">${icon('crown')}</div>` : ''}
    <div class="rv-rank">#<span id="rvRank">${from}</span></div>
    <div class="rv-sub">${me.rank === 1 ? 'You are number one!' : `out of ${data.total} player${data.total === 1 ? '' : 's'}`}</div>
    <div class="list">${rows.map((r, i) => r.gap ? '<div class="rv-gap">···</div>'
      : rowHtml(r.rank, r.name, fmt(r.value), r.isMe, r.isMe ? 'rv-row rv-me' : 'rv-row', board === 'racepts' ? fmtTime(r.time) : '').replace('class="item', `style="animation-delay:${r.isMe ? 1.0 : 0.15 + i * 0.06}s" class="item`)).join('')}</div>
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
    ? `I scored ${r.score.toLocaleString()} points in today's Peak Flip race in ${fmtTime(r.time)}. Race points rank first, with elapsed time as the tiebreak. Can you beat my ghost?`
    : r.mode === 'avalanche' ? `I outran the avalanche for ${Math.floor(r.time)} s and scored ${r.score.toLocaleString()} in Peak Flip. Can you beat it?`
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
  put('logoIc', 'mountain'); put('icPlay', 'play'); put('icFlag', 'flag'); put('icAva', 'mountain');
  put('icShop', 'shop'); put('icSkis', 'skis'); put('icTarget', 'target'); put('icTrophy', 'trophy'); put('icHelp', 'help'); put('icGear', 'gear');
  put('panelClose', 'close'); put('pauseBtn', 'pause');
  $('icGo1').innerHTML = $('icGo2').innerHTML = '<svg class="ic go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  $('playBtn').onclick = () => c.onPlay('endless');
  $('raceBtn').onclick = () => c.onPlay('race');
  $('avaBtn').onclick = () => c.onPlay('avalanche');
  $('shopBtn').onclick = () => { c.sfx.init(); shopSel = null; renderShop(); };
  $('lockerBtn').onclick = () => { c.sfx.init(); renderLocker(); };
  $('missionsBtn').onclick = () => { c.sfx.init(); renderMissions(); };
  $('lbBtn').onclick = () => { c.sfx.init(); lbTab = 'endless'; lbPeriod = 'all'; renderLeaderboard(); };
  $('helpBtn').onclick = () => { c.sfx.init(); renderHelp(); };
  $('settingsBtn').onclick = () => { c.sfx.init(); renderSettings(); };
  $('miniMore').onclick = () => { c.sfx.init(); lbTab = miniTab; lbPeriod = miniPeriod; renderLeaderboard(); };
  $('profileBtn').onclick = () => { c.sfx.init(); renderProfile(); };
  document.querySelectorAll('[data-mlb]').forEach(b => b.onclick = () => { miniTab = b.dataset.mlb; miniBoard(); });
  document.querySelectorAll('[data-ml-period]').forEach(b => b.onclick = () => { miniPeriod = b.dataset.mlPeriod; miniBoard(true); });
  // Easter eggs: the Konami code, and tapping the title seven times in a row
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
  let konami = 0;
  addEventListener('keydown', e => {
    konami = e.code === KONAMI[konami] ? konami + 1 : e.code === KONAMI[0] ? 1 : 0;
    if (konami === KONAMI.length) { konami = 0; findSecret('outfit', 'arcade', 'Secret found! The Arcade outfit is in your Locker.'); }
  });
  let taps = 0, tapT = 0;
  const brand = document.querySelector('.brand');
  brand.onclick = () => {
    taps = performance.now() - tapT < 1500 ? taps + 1 : 1; tapT = performance.now();
    brand.classList.remove('flip'); void brand.offsetWidth; brand.classList.add('flip');
    c.sfx.tone(500 + taps * 90, 0.08, 'triangle', 0.08);
    if (taps >= 7) { taps = 0; findSecret('hat', 'bunny', 'Secret found! Bunny Ears are in your Locker.'); }
  };
  const chat = initChat({ openPanel, nameForm });
  $('globalChatBtn').onclick = () => chat.openChat();
  $('panelClose').onclick = closePanel;
  $('panel').onclick = e => { if (e.target === $('panel')) closePanel(); };
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('lbReveal')) $('rvClose').click();
    else if (!$('panel').classList.contains('hidden')) closePanel();
  });
  refreshLeader();
  setTimeout(checkRewards, 1500);   // a best score from before this update (or another device) earns its rewards
  flushScores().then(() => { miniCache = {}; if (!$('menu').classList.contains('hidden')) miniBoard(true); });
  addEventListener('online', () => flushScores());
  setInterval(() => {
    if (document.hidden) return;
    if (!$('menu').classList.contains('hidden')) showMenuUI();
    if (save.lbQueue?.length) flushScores();
    refreshLeader();
  }, 30000);
}
