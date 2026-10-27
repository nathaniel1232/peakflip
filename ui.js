// ============================================================
//  Menus, item shop, locker, missions, results, leaderboards
// ============================================================
import {
  save, persist, CATALOG, RARITY, KIND_NAME, SETS, FITS, fitOwned,
  collectionCount, missionText, adProgress, adWatched, adUsesLeft, useAd,
  isLimited, setDaysLeft, setAvailable, grantScoreRewards, grantSecret,
  shopToday, msToNewShop, buyItem, buyBundle, giftReady, claimGift, GIFT, fitOffer, buyFit, adItemPrice, buyAdItem,
  leader, wear, equipped, setLeader, VAULT,
} from './meta.js';
import { icon } from './icons.js';
import { rpc } from './net.js';
import { Cloud } from './cloud.js';
import { initChat } from './chat.js';
import { CG } from './crazy.js';
import { clean, isClean } from './clean.js';

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
  // most coins right now (supabase/coins.sql); read from the cloud saves, so there's nothing to submit
  async coins(limit = 50) {
    try { return await rpc('get_coin_leaderboard', { p_pid: save.pid, p_limit: limit }); }
    catch { return null; }
  },
  // null = network trouble; only { ok: true } confirms that the server accepted a score.
  async submit(board, value, day, time, ghost) {
    if (!save.name) return null;
    try { return await rpc('submit_score_v2', { p_board: board, p_day: day || '', p_pid: save.pid, p_name: save.name, p_value: value, p_time: time ?? null, p_ghost: ghost || null }, !ghost, { timeoutMs: 8000 }); }
    catch (e) { return /\b4\d\d\b/.test(e.message) ? { ok: false } : null; }
  },
};

// ---------- score queue ----------
// Save each finished run immediately. Only the best per board/day needs to wait in
// the outbox: a lower run cannot improve that leaderboard entry.
const better = (a, b) => a.value > b.value || (a.value === b.value && (a.time ?? 0) < (b.time ?? 0));
let raceGhost = null;   // the large race recording stays in memory; the score survives a reload
function queueScore(e) {
  const q = save.lbQueue = (save.lbQueue || []).filter(x => !(x.board === e.board && x.day === e.day && !better(x, e)));
  if (!q.some(x => x.board === e.board && x.day === e.day)) q.push(e);
  persist();
}
let flushing = null, pumpScores = null, scoreRetryTimer = null, scoreRetryDelay = 2000;
const scoreWaiters = new Set();
function scheduleScoreRetry() {
  clearTimeout(scoreRetryTimer);
  if (!save.name || !save.lbQueue?.length) return;
  scoreRetryTimer = setTimeout(() => { scoreRetryTimer = null; flushScores(); }, scoreRetryDelay);
  scoreRetryDelay = Math.min(scoreRetryDelay * 2, 30000);
}
export function flushScores() {
  if (flushing) { pumpScores?.(); return flushing; }
  clearTimeout(scoreRetryTimer);
  const accepted = [];
  flushing = Promise.resolve().then(async () => {
    if (!save.name) return;
    save.lbQueue ||= [];
    const attempted = new Set();
    // Independent uploads prevent an old rejected or stalled run from holding up a new record.
    const send = async e => {
      const ghost = e.board === 'racepts' && raceGhost?.day === e.day && raceGhost.score === e.value ? raceGhost.ghost : undefined;
      let res = await LB.submit(e.board, e.value, e.day, e.time, ghost);
      if (res && res.ok !== true) { await LB.register(save.name); res = await LB.submit(e.board, e.value, e.day, e.time, ghost); }
      if (res?.ok !== true) return;
      save.lbQueue = save.lbQueue.filter(x => x !== e);
      accepted.push(e);
      persist(); // save each acknowledgement, even if a different upload is still stalled
      for (const acknowledge of scoreWaiters) acknowledge(e);
      scoresSynced([e]);
    };
    const pending = new Set();
    pumpScores = () => {
      const batch = save.lbQueue.filter(e => !attempted.has(e)).sort((a, b) => b.value - a.value).slice(0, 4 - pending.size);
      for (const e of batch) {
        attempted.add(e);
        const task = send(e).finally(() => { pending.delete(task); pumpScores?.(); });
        pending.add(task);
      }
    };
    pumpScores();
    while (pending.size) await Promise.race(pending);
  }).finally(() => {
    flushing = null; pumpScores = null;
    if (accepted.length) scoreRetryDelay = 2000;
    scheduleScoreRetry();
  });
  return flushing;
}
const runSubmissions = new WeakMap();
// Starting this function queues synchronously, before results animation or navigation.
function submitRun(r) {
  if (r.submitted) return Promise.resolve(true);
  if (runSubmissions.has(r)) return runSubmissions.get(r);
  const { board, day, value, time, ghost } = lbArgs(r);
  r.leaderboardDay ||= day || today();
  if (ghost) raceGhost = { day, score: value, ghost };
  queueScore({ board, day: r.leaderboardDay, value, time: time ?? null });
  let acknowledge;
  const receipt = new Promise(resolve => {
    acknowledge = e => {
      if (e.board === board && e.day === r.leaderboardDay && !better({ value, time }, e)) {
        r.submitted = true;
        resolve(true);
      }
    };
    scoreWaiters.add(acknowledge);
  });
  const pending = Promise.race([receipt, flushScores().then(() => {
    if (r.submitted) return true;
    r.submitted = !!save.name && !save.lbQueue.some(x => x.board === board && x.day === r.leaderboardDay);
    return r.submitted;
  })]).finally(() => { runSubmissions.delete(r); scoreWaiters.delete(acknowledge); });
  runSubmissions.set(r, pending);
  return pending;
}
// the server used to turn down scores over 3,000,000; a best like that is sent once more until it's taken
async function resendBigBest() {
  if (!save.name || save.best < 3e6 || save.bigBestSent === save.best) return;
  const value = save.best;
  // A server-side recovery may already have restored this record. Do not resubmit
  // it as a new run today just to acknowledge the recovered lifetime best.
  const record = await LB.get('endless', null, 1, 'all');
  if (record?.me?.value >= value) { save.bigBestSent = value; persist(); miniCache = {}; return; }
  const res = await LB.submit('endless', value, today(), null);
  if (res?.ok === true) { save.bigBestSent = value; persist(); miniCache = {}; }
}
LB.register = async name => {
  try { return await rpc('register_name', { p_pid: save.pid, p_name: name }, true, { timeoutMs: 8000 }); }
  catch { return null; }
};
// undefined = the database's change_name is missing (404) or broken (any other error from the server);
// null = network trouble
LB.rename = async name => {
  try { return await rpc('change_name', { p_pid: save.pid, p_name: name }); }
  catch (e) { return /\b\d{3}\b/.test(e.message) ? undefined : null; }
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

// ---------- other modes: everything that isn't Endless ----------
function renderOther() {
  const rs = save.raceScores?.[today()];
  const ls = Object.values(save.levels || {}).reduce((a, r) => a + (r.stars || 0), 0);
  const go = '<svg class="ic go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  const card = (id, ic, a, b, name, sub) => `<button class="modeCard" id="${id}" style="--a:${a};--b:${b}">${icon(ic)}<span><b>${name}</b><small>${sub}</small></span>${go}</button>`;
  openPanel('Other modes', `<div class="note">Endless is the main game. These are for a change of pace.</div>
    <div class="modeList">
      ${card('oRace', 'flag', '#3a7bd5', '#1f4f99', 'Daily race', rs ? `Forest course · today ${Number(rs.score || 0).toLocaleString()} points` : 'Forest course · new every day · race the ghosts')}
      ${card('oFree', 'mountain', '#2a9d8f', '#1d6b62', 'Off-piste', 'Open mountain · ride anywhere with other players')}
      ${card('oLevels', 'target', '#c0392b', '#7d2318', 'Levels', ls ? `${ls} / ${cfg.levels.length * 3} stars` : `${cfg.levels.length} hard courses · earn stars`)}
    </div>`);
  $('oRace').onclick = () => cfg.onPlay('race');
  $('oFree').onclick = () => cfg.onFreeride();
  $('oLevels').onclick = () => renderLevels();
}

// ---------- menu leaderboard preview ----------
let miniPeriod = 'all', miniCache = {}, miniRequest = 0, leaderRequest = 0;
let leaderPromise = null, leaderFetchedAt = 0;
async function miniBoard(force) {
  const el = $('miniLb'); if (!el) return;
  if (!CG.build && miniPeriod === 'weekly') miniPeriod = 'all';
  if (!CG.build) document.querySelectorAll('[data-ml-period="weekly"]').forEach(b => b.classList.add('hidden'));
  document.querySelectorAll('[data-ml-period]').forEach(b => b.classList.toggle('on', b.dataset.mlPeriod === miniPeriod));
  const period = miniPeriod, key = `${today()}:${period}`, token = ++miniRequest, c = miniCache[key];
  if (c && !force && Date.now() - c.at < 60000) { el.innerHTML = c.html; return; }
  if (!c) el.innerHTML = '<div class="note">Loading…</div>';
  const data = await LB.get('endless', null, 5, period);
  let html = lbRows(data, 'endless', 5);
  if (data && !data.me) html += `<div class="note">${period === 'all' ? 'Set a score to get on the board.' : period === 'weekly' ? 'No run from you this week yet.' : 'No run from you today yet.'}</div>`;
  if (!data && c) html = c.html;   // a network blip keeps the last good board instead of an error
  else miniCache[key] = { at: Date.now(), html };
  if (token === miniRequest && miniPeriod === period) el.innerHTML = html;
}

async function refreshLeader(force = false) {
  if (!save.name) {
    window.dispatchEvent(new CustomEvent('peakflip-leader', { detail: { champion: false, known: true } }));
    return;
  }
  if (leaderPromise) {
    if (!force) return leaderPromise;
    ++leaderRequest;
    await leaderPromise;
  }
  if (!force && Date.now() - leaderFetchedAt < 25000) return;
  const token = ++leaderRequest;
  leaderPromise = LB.get('endless', null, 1, 'all').then(data => {
    leaderFetchedAt = Date.now();
    // champion: #1 all-time in Endless (the World #1 outfit)
    if (token === leaderRequest) window.dispatchEvent(new CustomEvent('peakflip-leader', { detail: {
      champion: data?.me?.rank === 1, known: !!data,
    } }));
  }).finally(() => { leaderPromise = null; });
  return leaderPromise;
}

// the World #1 outfit comes and goes with first place
addEventListener('peakflip-leader', e => {
  const { champion, known } = e.detail || {}, was = leader.on, wasWearing = CATALOG.outfit.find(i => i.id === save.eq.outfit)?.leader;
  if (!setLeader(champion, known)) return;
  cfg.onCosmetics();
  if (leader.on && !was) note(`You're World #1! The World #1 outfit is in your Locker while you hold first place.`);
  else if (!leader.on && wasWearing && known) note(`Someone took first place. You're back in your ${equipped('outfit').name} outfit.`);
  if ($('panelTitle').textContent === 'Locker' && !$('panel').classList.contains('hidden')) renderLocker();
});

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
    <div class="setRow"><span>All sound</span>${seg('sound', [[1, 'On'], [0, 'Off']], cfg.sfx.muted ? 0 : 1)}</div>
    <div class="note setLink"><a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a></div>`);
  const B = $('panelBody');
  B.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { if (b.dataset.q === q) return; save.quality = b.dataset.q; persist(); location.reload(); });
  B.querySelectorAll('[data-music]').forEach(b => b.onclick = () => { if (+b.dataset.music !== (cfg.music.on ? 1 : 0)) { cfg.sfx.init(); cfg.music.toggle(); cfg.soundUI(); } renderSettings(); });
  B.querySelectorAll('[data-sound]').forEach(b => b.onclick = () => { if (+b.dataset.sound === (cfg.sfx.muted ? 1 : 0)) { cfg.sfx.init(); cfg.sfx.toggle(); } renderSettings(); });
}

// ---------- how to play ----------
function renderHelp() {
  openPanel('How to play', `<div class="help">
    ${CG.build ? '<button class="btn primary" id="replayLesson">Play the quick lesson</button>' : ''}
    <h4>Controls</h4><div class="item">${cfg.hints}</div>
    <h4>Endless (the main mode)</h4><div class="item">Ride as far as you can. Speed and tricks score points, and coins buy items in the daily Item Shop. Landing upside down or hitting trees ends the run. ${CG.build ? "The mountain gets faster as you ride. Land tricks and link combos to beat your best score." : "Every kilometre is a new stage: a points bonus, a new time of day and a meaner mountain. From stage 4 rocks are solid too."} There is always a way through, and every jump has room to land.</div>
    <h4>Combos</h4><div class="item">Tricks done within 3 seconds of each other chain into a combo. The multiplier climbs x1.5, x2 … x5, then x6, x7, x8, x9 and the max, <b>x10</b>, at 14 tricks in a row. Rails, grabs and kicker lines keep a combo going.</div>
    <h4>Daily Race</h4><div class="item">A new forest course every day, the same for everyone. Score points across all 11 checkpoints; higher points rank first, and elapsed time breaks ties. Each checkpoint reached adds 500 bonus points. Race against other players' ghosts.
      </div>
    <h4>Leaderboards</h4><div class="item">Pick any name and every run goes on the board automatically. You can change your name any time. Endless has all time${CG.build ? ', weekly' : ''}, and daily boards.</div>
  </div>`);
  if (CG.build) $('replayLesson').onclick = () => { closePanel(); cfg.onLesson(); };
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
  if (it.vault) return `The Vault: only ${VAULT.max} will ever exist, ${VAULT.price.toLocaleString()} coins each`;
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
// ---------- the vault: Event Horizon, 5 copies ever. Ownership lives in the database (supabase/vault.sql). ----------
let vault = null, vaultAt = 0, vaultLoading = false, vaultFailed = false, vaultConfirm = false, vaultBusy = false;
async function loadVault(force = false) {
  if (vaultLoading || (!force && Date.now() - vaultAt < 30000)) return;
  vaultLoading = true;
  try {
    const r = await rpc('get_vault', { p_item: VAULT.id, p_pid: save.pid });
    if (r?.owners) { vault = r; vaultFailed = false; syncVault(); } else vaultFailed = true;
  } catch { vaultFailed = true; } finally { vaultLoading = false; vaultAt = Date.now(); }   // a failed check waits 30s too
  if ($('panelTitle').textContent === 'Item Shop' && !$('panel').classList.contains('hidden') && shopTab === 'today') renderShop();
}
// the database is the only proof of ownership: bring the outfit over from another device, or take back one it never sold
function syncVault() {
  const inv = save.inv[VAULT.kind], has = inv.includes(VAULT.id);
  if (vault.mine && !has) { inv.push(VAULT.id); persist(); }
  else if (!vault.mine && has) {
    inv.splice(inv.indexOf(VAULT.id), 1);
    if (save.eq[VAULT.kind] === VAULT.id) { save.eq[VAULT.kind] = inv[0]; cfg.onCosmetics(); }
    persist();
  }
}
function vaultHtml() {
  const it = CATALOG[VAULT.kind].find(i => i.id === VAULT.id), own = owns(VAULT.kind, VAULT.id);
  const owners = vault?.owners || [], left = VAULT.max - owners.length;
  const slots = Array.from({ length: VAULT.max }, (_, i) => owners[i]
    ? `<li class="${owners[i].isMe ? 'me' : ''}"><span>${i + 1}</span><b>${esc(clean(owners[i].name))}</b>${owners[i].isMe ? '<small>you</small>' : ''}</li>`
    : `<li class="open"><span>${i + 1}</span><b>${vault ? 'Unclaimed' : vaultFailed ? '?' : '…'}</b></li>`).join('');
  let action;
  if (own) action = save.eq[VAULT.kind] === VAULT.id ? `<button class="btn" disabled>${icon('check')} Wearing</button>` : `<button class="btn go" id="vaultWear">Wear</button>`;
  else if (vault && left <= 0) action = `<button class="btn" disabled>${icon('lock')} Sold out</button>`;
  else action = `<button class="btn go ${vaultConfirm ? 'confirm' : ''}" id="vaultBuy" ${!vault || vaultBusy || save.coins < VAULT.price ? 'disabled' : ''}>${vaultBusy ? 'Buying…' : vaultConfirm ? `Tap to confirm ${coin} ${VAULT.price.toLocaleString()}` : `Buy ${coin} ${VAULT.price.toLocaleString()}`}</button>`;
  return `<div class="secHead">The Vault <small>only ${VAULT.max} will ever exist</small></div>
    <div class="vault">
      <div class="vaultArt">${swatch(VAULT.kind, it)}</div>
      <div class="vaultInfo">
        <div class="vaultName">${esc(it.name)}</div>
        <div class="vaultTag">MYTHIC OUTFIT · ${vault ? (left > 0 ? `${left} OF ${VAULT.max} LEFT` : 'SOLD OUT') : vaultFailed ? "CAN'T REACH THE VAULT" : 'CHECKING…'}</div>
        <div class="vaultBlurb">A collapsing star for a jacket. Its glow shifts violet to cyan, an accretion disk orbits you, and stardust falls inward as you ride.</div>
        <div class="vaultOwners"><small>Owners</small><ol>${slots}</ol></div>
        <div class="row"><button class="btn" id="vaultTry">Try on</button>${action}</div>
        ${!own && vault && left > 0 ? `<div class="note">${!save.name ? 'Pick a leaderboard name first: owners are listed by name.' : save.coins < VAULT.price ? `You need ${(VAULT.price - save.coins).toLocaleString()} more coins.` : 'Yours forever, and your name goes on this list.'}</div>` : ''}
      </div>
    </div>`;
}
async function buyVault() {
  if (!save.name) return note('Pick a leaderboard name first (open the Leaderboard). Owners are listed by name.');
  if (!vaultConfirm) { vaultConfirm = true; renderShop(); setTimeout(() => { if (vaultConfirm) { vaultConfirm = false; if ($('vaultBuy')) renderShop(); } }, 4000); return; }
  vaultConfirm = false; vaultBusy = true; renderShop();
  let r = null;
  // the server checks the coins in your cloud save, so it needs this device's latest first
  try { if (await Cloud.push()) r = await rpc('claim_vault', { p_pid: save.pid, p_item: VAULT.id }); } catch {}
  vaultBusy = false;
  if (r?.ok) {
    if (!r.already) save.coins = Math.max(0, save.coins - VAULT.price);
    if (!owns(VAULT.kind, VAULT.id)) save.inv[VAULT.kind].push(VAULT.id);
    save.eq[VAULT.kind] = VAULT.id; save.bought = (save.bought || 0) + 1; persist();
    shopSel = null; preview(null); cfg.onCosmetics(); cfg.sfx.perfect(); celebrate(`${CATALOG[VAULT.kind].find(i => i.id === VAULT.id).name} is yours. Welcome to the five.`);
  } else note(r?.error === 'sold_out' ? 'Too late: all 5 have been claimed.'
    : r?.error === 'coins' ? "Your saved coins don't cover it yet. Play a run and try again."
    : r?.error === 'no_name' ? 'Pick a leaderboard name first.'
    : "Couldn't reach the vault. Nothing was spent. Try again in a moment.");
  await loadVault(true);
  renderShop();
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
    ${vaultHtml()}
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
  else if (it.ad) action = `<button class="btn go" id="shopAd" ${cfg.ads.available ? '' : 'disabled'}>${icon('play')} ${adWatched(kind, id)}/${it.ad}</button>`
    + (adItemPrice(it) ? `<button class="btn" id="shopAdBuy" ${save.coins >= adItemPrice(it) ? '' : 'disabled'}>${coin} ${adItemPrice(it).toLocaleString()}</button>` : '');
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
  if ($('shopAdBuy')) $('shopAdBuy').onclick = () => {
    const { kind, id } = shopSel;
    if (buyAdItem(kind, id)) { save.eq[kind] = id; persist(); cfg.sfx.perfect(); celebrate(`${CATALOG[kind].find(i => i.id === id).name} is yours!`); preview(tryOn); }
    renderShop();
  };
  if (shopTab === 'today') loadVault();
  if ($('vaultTry')) $('vaultTry').onclick = () => { shopSel = null; preview({ [VAULT.kind]: VAULT.id }); renderShop(); };
  if ($('vaultBuy')) $('vaultBuy').onclick = buyVault;
  if ($('vaultWear')) $('vaultWear').onclick = () => { save.eq[VAULT.kind] = VAULT.id; persist(); preview(null); cfg.onCosmetics(); cfg.sfx.perfect(); renderShop(); };
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
    // the World #1 outfit is always shown (it's the one to chase), but only wearable by the current #1
    const mine = CATALOG[lockerTab].filter(it => save.inv[lockerTab].includes(it.id) || it.leader);
    const on = equipped(lockerTab).id;
    body = mine.length > 1 || lockerTab === 'outfit' || lockerTab === 'ski'
      ? `<div class="grid">${mine.map(it => `<button class="skin ${on === it.id ? 'sel' : ''} ${it.leader ? `leaderSkin ${leader.on ? '' : 'locked'}` : ''}" data-id="${it.id}" ${it.leader && !leader.on ? 'title="Only the #1 on the all-time Endless leaderboard can wear this"' : ''}>
          ${swatch(lockerTab, it)}<div class="nm">${esc(it.name)}</div><div class="rr" style="color:${RARITY[it.rarity].color}">${it.leader && !leader.on ? '#1 only' : RARITY[it.rarity].name}</div></button>`).join('')}</div>`
      : emptyLocker(`You don't have any ${KIND_NAME[lockerTab].toLowerCase()} items yet.`);
  }
  const gear = `<div class="tabs gear"><button class="tab ${save.gear !== 'board' ? 'on' : ''}" data-gear="ski">${icon('skis')} Skis</button><button class="tab ${save.gear === 'board' ? 'on' : ''}" data-gear="board">${icon('board')} Snowboard</button></div>`;
  openPanel('Locker', `${gear}<div class="tabs">${tabs}</div>${body}<div class="note closetTip">Drag your rider to spin it. Want more? Everything is in the Shop.</div>`, true, true);
  const B = $('panelBody');
  B.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { lockerTab = b.dataset.tab; renderLocker(); });
  B.querySelectorAll('[data-gear]').forEach(b => b.onclick = () => { save.gear = b.dataset.gear; persist(); cfg.onCosmetics(); renderLocker(); });
  B.querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
    if (!wear(lockerTab, b.dataset.id)) return note('Only the #1 on the all-time Endless leaderboard can wear this. Take first place and it\'s yours for as long as you hold it.');
    cfg.onCosmetics(); renderLocker();
  });
  B.querySelectorAll('[data-fit]').forEach(b => b.onclick = () => {
    const f = FITS.find(x => x.id === b.dataset.fit);
    for (const [k, id] of Object.entries(f.pieces)) if (save.inv[k].includes(id)) save.eq[k] = id;
    persist(); cfg.onCosmetics(); cfg.sfx.perfect(); renderLocker();
  });
  if ($('toShop')) $('toShop').onclick = () => renderShop(lockerTab === 'fits' ? 'outfits' : 'today');
}

// ---------- missions ----------
// ---------- levels ----------
const LEVEL_COLORS = { day: ['#3f8fd8', '#1d5fa8'], golden: ['#f59e3c', '#c2410c'], night: ['#3a3f8f', '#14183f'], xmas: ['#d62839', '#1f7a3d'], agartha: ['#8a5cf6', '#3b1f8a'] };
const starRow = (n, cls = 'stars') => `<div class="${cls}">${[0, 1, 2].map(i => i < n ? '<b>★</b>' : '★').join('')}</div>`;
const levelUnlocked = n => n === 0 || (save.levels?.[n - 1]?.stars || 0) > 0;
function renderLevels() {
  const lv = cfg.levels, total = lv.reduce((a, l) => a + (save.levels?.[l.n]?.stars || 0), 0);
  openPanel('Levels', `<div class="note">Hand-made courses, all of them <b class="diff hard">hard</b>: one crash and you start over, rocks end your run and sketchy landings crash. Reach the finish for ★, score enough for ★★ and ★★★. Finishing a level unlocks the next. <b>${total} / ${lv.length * 3} ★</b></div>
    <div class="levelGrid">${lv.map(l => {
      const rec = save.levels?.[l.n], open = levelUnlocked(l.n), [a, b] = LEVEL_COLORS[l.theme] || LEVEL_COLORS.day;
      return `<button class="lvl" data-level="${l.n}" style="--a:${a};--b:${b}" ${open ? '' : 'disabled'}>
        ${open ? '' : icon('lock')}<span class="num">LEVEL ${l.n + 1} <span class="diff ${l.diff}">${l.diff}</span></span><span class="name">${esc(l.name)}</span>
        ${starRow(rec?.stars || 0)}<span class="meta">${l.len} m · ★★ ${(l.stars[0] / 1000).toFixed(1)}k · ★★★ ${(l.stars[1] / 1000).toFixed(1)}k</span>
        ${rec?.best ? `<span class="meta">Best ${rec.best.toLocaleString()}</span>` : ''}</button>`;
    }).join('')}</div>`, true);
  document.querySelectorAll('[data-level]').forEach(b => b.onclick = () => { closePanel(); cfg.onLevel(+b.dataset.level); });
}

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
  if (!CG.build && lbPeriod === 'weekly') lbPeriod = 'all';
  const token = ++lbRequest;
  const tabs = `<div class="tabs"><button class="tab ${lbTab === 'endless' ? 'on' : ''}" data-lb="endless">Endless</button><button class="tab ${lbTab === 'race' ? 'on' : ''}" data-lb="race">Daily Race</button>${CG.build ? '' : `<button class="tab ${lbTab === 'coins' ? 'on' : ''}" data-lb="coins">Coins</button>`}</div>`;
  const periods = `<div class="tabs lbPeriods ${lbTab !== 'endless' ? 'hidden' : ''}"><button class="tab ${lbPeriod === 'all' ? 'on' : ''}" data-lb-period="all">All time</button>${CG.build ? `<button class="tab ${lbPeriod === 'weekly' ? 'on' : ''}" data-lb-period="weekly">Weekly</button>` : ''}<button class="tab ${lbPeriod === 'daily' ? 'on' : ''}" data-lb-period="daily">Daily</button></div>`;
  openPanel('Leaderboard', `${tabs}${periods}<div id="nameSlot"></div><div class="note">${lbTab === 'coins' ? 'The riders with the most coins right now. Spending coins moves you down.' : lbTab === 'race' ? 'Points rank first; faster time breaks ties. This board resets daily at 00:00 UTC.' : `${CG.build ? 'Weekly resets Monday at 00:00 UTC; daily' : 'Daily'} resets at 00:00 UTC.`}</div><div id="lbList" class="list"><div class="note">Loading…</div></div>`);
  $('panelBody').querySelectorAll('[data-lb]').forEach(b => b.onclick = () => { lbTab = b.dataset.lb; renderLeaderboard(); });
  $('panelBody').querySelectorAll('[data-lb-period]').forEach(b => b.onclick = () => { lbPeriod = b.dataset.lbPeriod; renderLeaderboard(); });
  nameForm($('nameSlot'), () => renderLeaderboard());
  await refreshLeaderboardRows(token);
}
async function refreshLeaderboardRows(token = ++lbRequest) {
  const board = lbTab === 'race' ? 'racepts' : 'endless';
  const data = lbTab === 'coins' ? await LB.coins(50) : await LB.get(board, board === 'racepts' ? today() : null, 50, board === 'racepts' ? 'all' : lbPeriod);
  if (token !== lbRequest || !$('lbList')) return;
  $('lbList').innerHTML = (data?.total ? `<div class="lbCount">${data.total.toLocaleString()} ${data.total === 1 ? 'rider' : 'riders'}${data.me ? ` · you are #${data.me.rank}` : ''}</div>` : '') + lbRows(data, lbTab, 50);
  $('lbList').querySelector('.item.me')?.scrollIntoView({ block: 'center' });
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
    slot.innerHTML = compact ? '' : `<div class="nameChip">Playing as <b>${esc(save.name)}</b><button class="btn" id="nameEdit">Change</button></div>`;
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
    if (!isClean(v)) { $('nameErr').textContent = 'That name has a word we don’t allow. Try another.'; return; }
    if (renaming && v === save.name) { nameForm(slot, after, compact); return; }
    btn.disabled = true; btn.textContent = '…';
    // change_name also claims when there's no name yet; fall back to register_name if the database's change_name
    // is missing or failing, and give the network one more try before giving up
    let res = await LB.rename(v);
    if (res === null) res = await LB.rename(v);
    if (res === undefined && !renaming) res = await LB.register(v) ?? await LB.register(v);
    btn.disabled = false; btn.textContent = renaming ? 'Save' : 'Claim';
    if (!res) { $('nameErr').textContent = res === undefined && renaming ? "Name changes aren't working right now. Try again later." : "Couldn't reach the leaderboard. Try again in a moment."; return; }
    if (!res.ok) { $('nameErr').textContent = NAME_ERR[res.error] || 'Something went wrong. Try another name.'; return; }
    save.name = res.name; persist(); miniCache = {};
    await flushScores(); refreshLeader(true); showMenuUI();
    if (renaming) nameForm(slot, after, compact);
    after && after();
  };
}

// claim a name without the form (a player's CrazyGames username); false when it didn't work
export async function claimName(name) {
  let res = await LB.rename(name);
  if (res === undefined) res = await LB.register(name);
  if (!res?.ok) return false;
  save.name = res.name; persist(); miniCache = {};
  await flushScores(); refreshLeader(true); showMenuUI();
  return true;
}

function lbRows(data, board, limit) {
  if (!data) {
    const raceScore = save.raceScores?.[today()]?.score;
    if (board === 'coins') return `<div class="note">Couldn't reach the leaderboard.<br>Your coins: <b>${save.coins.toLocaleString()}</b></div>`;
    return `<div class="note">Couldn't reach the leaderboard.<br>Your best: <b>${board === 'race' || board === 'racepts' ? (Number.isFinite(raceScore) ? `${raceScore.toLocaleString()} points` : '—') : save.best.toLocaleString()}</b></div>`;
  }
  if (!data.top.length) return `<div class="note">No entries yet. Be the first.</div>`;
  const race = board === 'race' || board === 'racepts';
  const fmt = v => (board === 'coins' ? coin + ' ' : '') + Math.round(v).toLocaleString();
  const rows = data.top.slice(0, limit).map((r, i) => rowHtml(r.rank ?? i + 1, r.name, fmt(r.value), r.isMe, '', race ? fmtTime(r.time) : '')).join('');
  const me = data.me && !data.top.slice(0, limit).some(r => r.isMe) ? '<div class="item gap">⋮</div>' + rowHtml(data.me.rank, save.name || 'You', fmt(data.me.value), true, '', race ? fmtTime(data.me.time) : '') : '';
  return rows + me;
}
const rowHtml = (rank, name, val, me, extra = '', time = '') =>
  `<div class="item ${me ? 'me' : ''} ${rank === 1 ? 'first' : rank <= 3 ? `r${rank}` : ''} ${extra}"><span class="rank">${rank}</span><span class="grow">${esc(clean(name))}</span>${time ? `<span class="rowTime">${time}</span>` : ''}<span class="val">${val}</span></div>`;

// ---------- results ----------
// A new record goes straight to the leaderboard moment; everything else shows the results card.
// Players without a name get the same moment after any run, with a name box, until they pick one
// (skipping it only quiets the prompt for ordinary runs until the page reloads).
let skippedName = false, latestResult = null;
function scoresSynced(entries) {
  miniCache = {};
  refreshLeader(true);
  if (!$('menu').classList.contains('hidden')) miniBoard(true);
  if ($('lbList')) refreshLeaderboardRows();
  const r = latestResult;
  if (!r || r.mode === 'level') return;
  const { board } = lbArgs(r);
  if (entries.some(e => e.board === board && e.day === r.leaderboardDay && !better({ value: r.score, time: r.time }, e))) {
    r.submitted = true;
    r.retryReveal?.();
    if (r.awaitingSync && $('resLb') && !$('over').classList.contains('hidden')) rankRow(r, resultToken);
  }
}
export function showResults(r) {
  const token = ++resultToken;
  latestResult = r;
  if (r.mode !== 'level') submitRun(r);
  setTimeout(checkRewards, 1200);
  if (r.mode === 'level') { resultsCard(r, token); return; }   // stars are kept locally, no world board
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
  } else if (r.mode === 'level') {
    const nextOpen = r.done && !r.last;
    body = `
      <div class="tag">${r.done ? `LEVEL ${r.level + 1} COMPLETE` : `LEVEL ${r.level + 1} FAILED`} · ${r.diff.toUpperCase()}</div>
      ${starRow(r.stars, 'stars bigStars')}
      <div class="big-num"><small>${esc(r.name).toUpperCase()}</small><span class="snowy" data-text="${r.score.toLocaleString()}">${r.score.toLocaleString()}</span></div>
      <div class="sub">${r.done ? `★★ at ${r.targets[0].toLocaleString()} · ★★★ at ${r.targets[1].toLocaleString()} · best ${r.best.toLocaleString()}` : `${esc(r.reason)} · ${r.dist} of ${r.len} m`}</div>
      ${r.stars > r.prevStars && r.prevStars > 0 ? '<div class="tag">MORE STARS!</div>' : ''}
      ${nextOpen ? `<button class="btn primary big" id="nextLevel">Next level ›</button>` : ''}`;
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
    <div class="earn"><span>Coins earned</span><b id="earnedNum">${coin} +${earned}</b></div>
    ${doubleOffer(r)}
    ${missions}
    <div id="resLb"></div>
    <button id="againBtn" class="btn primary big">${icon('retry')}${r.mode === 'race' ? 'Race again' : r.mode === 'level' ? 'Try again' : 'Ride again'}</button>
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
  $('toLb').onclick = () => { lbTab = r.mode; cfg.onMenu(); renderLeaderboard(); };
  $('shareBtn').onclick = () => share(r);
  if ($('doubleBtn')) $('doubleBtn').onclick = () => doubleCoins(r, earned);
  if (r.mode === 'level') {
    if ($('nextLevel')) $('nextLevel').onclick = () => cfg.onLevel(r.level + 1);
    $('toLb').innerHTML = `${icon('target')}Levels`; $('toLb').onclick = () => { cfg.onMenu(); renderLevels(); };
    return;
  }
  rankRow(r, token);
  miniCache = {};
}
// Rewarded "double coins" on the results card: the run's coins once more (mission rewards aren't doubled).
// Only offered when an ad network is there, the run earned something worth doubling, there are uses left today,
// and no rewarded ad was watched in the last 3 minutes, so it isn't on every results screen.
const doubleAmount = r => (r.coins || 0) + (r.bonus || 0);
function doubleOffer(r) {
  const n = doubleAmount(r);
  if (!cfg.ads.available || n < 25 || adUsesLeft('double') <= 0 || cfg.ads.recentReward) return '';
  return `<button class="btn" id="doubleBtn" style="width:100%;white-space:nowrap">${icon('play')} Watch an ad: 2× coins &nbsp;${coin} +${n.toLocaleString()}</button>`;
}
async function doubleCoins(r, earned) {
  const btn = $('doubleBtn'), again = $('againBtn'), n = doubleAmount(r);
  // nothing else on the card works while the ad is loading or playing
  btn.disabled = again.disabled = true; btn.innerHTML = `${icon('play')} Loading ad…`;
  const ok = await watchAd();
  if (again.isConnected) again.disabled = false;
  if (!ok) { if (btn.isConnected) btn.remove(); return; }   // no reward without a finished ad
  useAd('double'); save.coins += n; persist();
  cfg.sfx.coin(); celebrate(`Coins doubled! +${n.toLocaleString()}`);
  if ($('earnedNum')) $('earnedNum').innerHTML = `${coin} +${(earned + n).toLocaleString()}`;
  if (btn.isConnected) btn.outerHTML = `<div class="earn"><span>${icon('check')} Coins doubled</span><b>${coin} +${n.toLocaleString()}</b></div>`;
}

// small "World rank #n" row on the results card (submits silently if the record moment didn't already)
async function rankRow(r, token) {
  const { board, day } = lbArgs(r);
  r.awaitingSync = false;
  if (!r.submitted) {
    if ($('resLb')) $('resLb').innerHTML = '<div class="note">Saving to leaderboard…</div>';
    r.submitted = await submitRun(r);
  }
  if (!r.submitted) {
    const lb = $('resLb');
    if (token !== resultToken || !lb) return;
    if (save.name) {
      r.awaitingSync = true;
      lb.innerHTML = '<div class="saveBox"><div class="note">Score saved on this device. Leaderboard unavailable — retrying automatically…</div></div>';
      return;
    }
    // The score waits in the queue, and claiming a name here sends it.
    lb.innerHTML = `<div class="saveBox"><div class="note">Pick a name to put this run on the leaderboard</div><div id="resName"></div></div>`;
    nameForm($('resName'), () => { lb.innerHTML = ''; rankRow(r, token); }, true);
    return;
  }
  if (token !== resultToken) return;
  if (board === 'endless') {
    // Show the player's standing on the available Endless boards.
    const periods = [['all', 'All time'], ...(CG.build ? [['weekly', 'This week']] : []), ['daily', 'Today']];
    const boards = await Promise.all(periods.map(([p]) => LB.get(board, null, 7, p)));
    const lb = $('resLb');
    if (token !== resultToken || !lb || !boards.some(b => b?.me)) return;
    lb.innerHTML = `<div class="ranks">${periods.map(([p, label], i) => {
      const me = boards[i]?.me;
      return `<button data-rank="${i}"><small>${label}</small><b class="${me?.rank === 1 ? 'top' : ''}">${me ? `#${me.rank}` : '—'}</b><small>${boards[i]?.total ? `of ${boards[i].total}` : ''}</small></button>`;
    }).join('')}</div>`;
    lb.querySelectorAll('[data-rank]').forEach(b => b.onclick = () => {
      const i = +b.dataset.rank;
      if (boards[i]?.me) { const o = overlay(); revealBoard(o, boards[i], board, () => o.remove()); }
    });
    return;
  }
  const data = await LB.get(board, day, 10, 'all');
  if (token !== resultToken) return;
  const lb = $('resLb');
  if (!lb || !data?.me) return;
  lb.innerHTML = `<button class="earn" id="rankRow" style="width:100%"><span>Today's race rank · points first</span><b>#${data.me.rank} <small style="color:var(--muted);font-weight:600">of ${data.total}</small></b></button>`;
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
  const finish = () => { r.retryReveal = null; el.remove(); done(); };
  el._done = finish;
  const big = r.score.toLocaleString();
  card.innerHTML = `<div class="rv-kicker">${!r.newBest ? (r.mode === 'race' ? 'RACE POINTS' : 'YOUR SCORE') : r.mode === 'race' ? 'NEW PERSONAL BEST' : 'NEW RECORD'}</div>
    <div class="rv-score"><span class="snowy" data-text="${big}">${big}</span></div>${r.mode === 'race' ? `<div class="rv-sub">RACE POINTS · ${fmtTime(r.time)} elapsed · time breaks ties</div>` : ''}<div id="rvStep"></div>`;
  if (r.newBest) cfg.sfx.perfect();
  const step = $('rvStep');
  const go = async () => {
    r.retryReveal = null;
    if (token !== resultToken || !document.body.contains(el)) return;
    step.innerHTML = '<div class="note">Checking the leaderboard…</div>';
    const { board, day } = lbArgs(r);
    if (!r.submitted) r.submitted = await submitRun(r);
    if (token !== resultToken || !document.body.contains(el)) return;
    const data = r.submitted ? await LB.get(board, day, 7, 'all') : null;
    if (token !== resultToken || !document.body.contains(el)) return;
    if (!data?.me) {
      if (!r.submitted) r.retryReveal = go;
      step.innerHTML = `<div class="note">Couldn't reach the leaderboard right now. Your score is saved and will be sent automatically.</div><button class="btn primary" id="rvOk">Continue</button>`;
      $('rvOk').onclick = finish; return;
    }
    revealBoard(el, data, board, finish);
  };
  if (save.name) go();
  else {
    step.innerHTML = `<div class="rv-sub" style="margin:6px 0 10px">Pick any name to put this on ${r.mode === 'race' ? "today's race" : 'the world'} leaderboard. You can change it later.</div><div id="rvName"></div><button class="btn" id="rvSkip" style="margin-top:8px;width:100%">Not now</button>`;
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
      node.parentElement.classList.add('landed');
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
    : r.mode === 'level' ? `I got ${'★'.repeat(r.stars)} on level ${r.level + 1} (${r.name}) in Peak Flip with ${r.score.toLocaleString()} points. Can you beat it?`
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
  put('logoIc', 'mountain'); put('icPlay', 'play'); put('icOther', 'flag');
  put('icShop', 'shop'); put('icSkis', 'skis'); put('icTarget', 'target'); put('icTrophy', 'trophy'); put('icHelp', 'help'); put('icGear', 'gear');
  put('panelClose', 'close'); put('pauseBtn', 'pause');
  $('playBtn').onclick = () => c.onPlay('endless');
  $('otherBtn').onclick = () => { c.sfx.init(); renderOther(); };
  // the CrazyGames version keeps it simple: Endless and the daily race, so "other" is just the race
  if (CG.build) {
    $('playSub').textContent = 'Endless · land tricks, collect coins, beat your best';
    const ob = $('otherBtn');
    ob.querySelector('.snowy').textContent = ob.querySelector('.snowy').dataset.text = 'race';
    ob.querySelector('small').textContent = 'Daily forest course · race the ghosts';
    ob.onclick = () => { c.sfx.init(); c.onPlay('race'); };
  }
  $('shopBtn').onclick = () => { c.sfx.init(); shopSel = null; renderShop(); };
  $('lockerBtn').onclick = () => { c.sfx.init(); renderLocker(); };
  $('missionsBtn').onclick = () => { c.sfx.init(); renderMissions(); };
  $('lbBtn').onclick = () => { c.sfx.init(); lbTab = 'endless'; lbPeriod = 'all'; renderLeaderboard(); };
  $('helpBtn').onclick = () => { c.sfx.init(); renderHelp(); };
  $('settingsBtn').onclick = () => { c.sfx.init(); renderSettings(); };
  // new players see a short note about what's saved online until they press OK
  if (!save.privacyOk) {
    $('privacyNote').classList.remove('hidden');
    $('privacyOk').onclick = () => { save.privacyOk = true; persist(); $('privacyNote').classList.add('hidden'); };
  }
  $('miniMore').onclick = () => { c.sfx.init(); lbTab = 'endless'; lbPeriod = miniPeriod; renderLeaderboard(); };
  $('profileBtn').onclick = () => { c.sfx.init(); renderProfile(); };
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
  setTimeout(resendBigBest, 3000);
  $('globalChatBtn').onclick = () => chat.openChat();
  // players can switch chat off in their CrazyGames settings
  CG.onSettings(() => {
    $('globalChatBtn').classList.toggle('hidden', CG.chatOff);
    if (CG.chatOff && $('chatMessages')) closePanel();
  });
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
  addEventListener('online', () => { scoreRetryDelay = 2000; flushScores(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && save.lbQueue?.length) flushScores();
  });
  setInterval(() => {
    if (document.hidden) return;
    if (!$('menu').classList.contains('hidden')) showMenuUI();
    if (save.lbQueue?.length) flushScores();
    refreshLeader();
  }, 30000);
}
