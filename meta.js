// ============================================================
//  Meta-game: save data, cosmetics, chests, missions
// ============================================================

// ---------- save ----------
const SAVE_KEY = 'peakflip_v1';
export const save = Object.assign({
  best: 0, coins: 0, muted: false, runs: 0, gear: 'ski',
  inv: { outfit: ['rookie'], ski: ['navy'], trail: ['none'] },
  eq: { outfit: 'rookie', ski: 'navy', trail: 'none' },
  freeChestAt: 0, pity: 0, chestsOpened: 0, missions: [], missionsDone: 0,
}, (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } })());
export const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} };

// migrate the old "owned skins by index" format
if (Array.isArray(save.owned)) {
  const old = ['rookie', 'glacier', 'lime', 'sunset', 'phantom', 'golden'];
  for (const i of save.owned) if (old[i] && !save.inv.outfit.includes(old[i])) save.inv.outfit.push(old[i]);
  if (old[save.skin]) save.eq.outfit = old[save.skin];
  delete save.owned; delete save.skin; persist();
}

// ---------- catalog ----------
export const RARITY = {
  common:    { name: 'Common',    color: '#9fb3c8', dupe: 20 },
  rare:      { name: 'Rare',      color: '#4dabf7', dupe: 60 },
  epic:      { name: 'Epic',      color: '#c264ff', dupe: 150 },
  legendary: { name: 'Legendary', color: '#ffb627', dupe: 400 },
};
const O = (id, name, rarity, jacket, pants, helmet) => ({ id, name, rarity, jacket, pants, helmet });
const S = (id, name, rarity, color, tip, glow = false) => ({ id, name, rarity, color, tip, glow });
const Tr = (id, name, rarity, colors) => ({ id, name, rarity, colors });
export const CATALOG = {
  outfit: [
    O('rookie', 'Rookie', 'common', '#e94f37', '#2d3142', '#ffffff'),
    O('glacier', 'Glacier', 'common', '#3a86ff', '#1b263b', '#e0fbfc'),
    O('lime', 'Lime', 'common', '#8ac926', '#283618', '#ffca3a'),
    O('cocoa', 'Cocoa', 'common', '#8d5b3c', '#3b2416', '#f2e8cf'),
    O('mint', 'Mint', 'common', '#5ee0b5', '#1d3b34', '#ffffff'),
    O('slate', 'Slate', 'common', '#6c7a89', '#22272e', '#d6dde4'),
    O('sunset', 'Sunset', 'rare', '#ff7b00', '#6a040f', '#ffd60a'),
    O('phantom', 'Phantom', 'rare', '#2b2d42', '#0d0d0d', '#ef233c'),
    O('bubblegum', 'Bubblegum', 'rare', '#ff6fb5', '#4a1942', '#ffffff'),
    O('arctic', 'Arctic Ops', 'rare', '#d9e3ea', '#56636f', '#2f3e46'),
    O('cherry', 'Cherry', 'rare', '#d00000', '#f8f9fa', '#111111'),
    O('golden', 'Golden', 'epic', '#ffd23f', '#3d2c00', '#fff3b0'),
    O('neon', 'Neon Rush', 'epic', '#39ff14', '#111111', '#ff00e6'),
    O('galaxy', 'Galaxy', 'epic', '#3a0ca3', '#10002b', '#4cc9f0'),
    O('lava', 'Lava', 'epic', '#ff4800', '#2b0a00', '#ffba08'),
    O('diamond', 'Diamond', 'legendary', '#b9f2ff', '#e0fbfc', '#ffffff'),
    O('king', 'Shadow King', 'legendary', '#0b0b0b', '#000000', '#ffd700'),
  ],
  ski: [
    S('navy', 'Classic', 'common', '#1d3557', '#1d3557'),
    S('red', 'Racer Red', 'common', '#d62828', '#ffffff'),
    S('white', 'Powder', 'common', '#f1f5f9', '#94a3b8'),
    S('forest', 'Forest', 'common', '#2d6a4f', '#95d5b2'),
    S('pink', 'Hot Pink', 'rare', '#ff4fa3', '#ffe3f1'),
    S('tiger', 'Tiger', 'rare', '#ff8800', '#111111'),
    S('blackgold', 'Black Gold', 'rare', '#111111', '#ffcc00'),
    S('neon', 'Neon', 'epic', '#39ff14', '#00f0ff', true),
    S('chrome', 'Chrome', 'epic', '#dfe7ee', '#9aa9b8', true),
    S('gold', 'Solid Gold', 'legendary', '#ffd23f', '#fff3b0', true),
    S('rainbow', 'Prism', 'legendary', 'rainbow', '#ffffff', true),
  ],
  trail: [
    Tr('none', 'No Trail', 'common', null),
    Tr('snow', 'Snow Puff', 'common', ['#ffffff']),
    Tr('ice', 'Ice Shards', 'rare', ['#9bf6ff', '#ffffff']),
    Tr('fire', 'Fire', 'rare', ['#ff4800', '#ffba08', '#ff7b00']),
    Tr('toxic', 'Toxic', 'epic', ['#39ff14', '#b5ff5c']),
    Tr('void', 'Void', 'epic', ['#7b2cbf', '#c77dff', '#240046']),
    Tr('rainbow', 'Rainbow', 'legendary', 'rainbow'),
    Tr('gold', 'Gold Rush', 'legendary', ['#ffd23f', '#fff3b0', '#ffb627']),
  ],
};
export const KIND_NAME = { outfit: 'Outfit', ski: 'Skis/Board', trail: 'Trail' };
export const item = (kind, id) => CATALOG[kind].find(i => i.id === id) || CATALOG[kind][0];
export const equipped = kind => item(kind, save.eq[kind]);

// ---------- chests ----------
export const CHESTS = {
  free:  { name: 'Free Chest',  price: 0,   odds: { common: 72, rare: 22, epic: 5, legendary: 1 }, color: '#8d6e4f' },
  basic: { name: 'Snow Chest',  price: 150, odds: { common: 72, rare: 22, epic: 5, legendary: 1 }, color: '#4dabf7' },
  epic:  { name: 'Epic Chest',  price: 600, odds: { common: 0, rare: 60, epic: 32, legendary: 8 }, color: '#c264ff' },
};
export const FREE_CHEST_COOLDOWN = 3 * 60 * 60 * 1000;
export const PITY = 10; // a Snow/Free chest is guaranteed Epic+ after this many without one

function rollRarity(chest) {
  if (chest !== 'epic' && save.pity >= PITY - 1) return Math.random() < 0.85 ? 'epic' : 'legendary';
  const odds = CHESTS[chest].odds;
  let r = Math.random() * 100;
  for (const k of ['legendary', 'epic', 'rare', 'common']) { if ((r -= odds[k]) < 0) return k; }
  return 'common';
}
export function openChest(chest) {
  const c = CHESTS[chest];
  if (chest === 'free') { if (Date.now() < save.freeChestAt) return null; save.freeChestAt = Date.now() + FREE_CHEST_COOLDOWN; }
  else { if (save.coins < c.price) return null; save.coins -= c.price; }
  const rarity = rollRarity(chest);
  if (chest !== 'epic') save.pity = (rarity === 'epic' || rarity === 'legendary') ? 0 : save.pity + 1;
  // pick a kind weighted by how many items it has in that rarity; prefer unowned items
  const pool = [];
  for (const kind of Object.keys(CATALOG)) for (const it of CATALOG[kind]) if (it.rarity === rarity && it.id !== 'none') pool.push({ kind, it });
  const unowned = pool.filter(({ kind, it }) => !save.inv[kind].includes(it.id));
  const src = unowned.length && Math.random() < 0.7 ? unowned : pool;
  const { kind, it } = src[(Math.random() * src.length) | 0];
  const dupe = save.inv[kind].includes(it.id);
  let refund = 0;
  if (dupe) { refund = RARITY[rarity].dupe; save.coins += refund; }
  else save.inv[kind].push(it.id);
  save.chestsOpened++;
  persist();
  return { kind, item: it, rarity, dupe, refund };
}
export const collectionCount = () => {
  let have = 0, total = 0;
  for (const k of Object.keys(CATALOG)) { total += CATALOG[k].length; have += save.inv[k].length; }
  return { have, total };
};

// ---------- missions ----------
// All missions are "in a single run" so every run is a fresh shot at them.
const MISSION_TYPES = [
  { type: 'score', text: n => `Score ${n.toLocaleString()} in one run`, tiers: [3000, 8000, 15000, 30000, 60000] },
  { type: 'dist', text: n => `Ride ${n.toLocaleString()} m in one run`, tiers: [400, 900, 1600, 2500, 4000] },
  { type: 'coins', text: n => `Collect ${n} coins in one run`, tiers: [10, 25, 45, 70, 100] },
  { type: 'flips', text: n => `Land ${n} flips in one run`, tiers: [1, 3, 6, 10, 16] },
  { type: 'spin', text: n => `Land a ${n} spin`, tiers: [360, 540, 720, 900, 1080] },
  { type: 'oneFlips', text: n => n === 1 ? 'Land a flip off a kicker' : `Land a ${['', '', 'Double', 'Triple', 'Quad'][n]} flip`, tiers: [1, 2, 2, 3, 4] },
  { type: 'rails', text: n => `Slide ${n} rail${n > 1 ? 's' : ''} in one run`, tiers: [1, 2, 4, 6, 9] },
  { type: 'perfect', text: n => `Land ${n} Perfect trick${n > 1 ? 's' : ''} in one run`, tiers: [1, 2, 4, 7, 10] },
  { type: 'combo', text: n => `Chain a ${n}-trick combo`, tiers: [2, 3, 5, 7, 10] },
  { type: 'near', text: n => `Get ${n} close calls in one run`, tiers: [2, 4, 7, 10, 15] },
  { type: 'crevasse', text: n => `Clear ${n} crevasse${n > 1 ? 's' : ''} in one run`, tiers: [1, 2, 4, 6, 9] },
  { type: 'grab', text: n => `Hold a grab for ${n}s`, tiers: [0.5, 0.8, 1.1, 1.4, 1.8] },
];
const REWARDS = [60, 100, 160, 240, 350];

function newMission(exclude) {
  const level = Math.min(4, Math.floor(save.missionsDone / 4));
  const choices = MISSION_TYPES.filter(t => !exclude.includes(t.type));
  const t = choices[(Math.random() * choices.length) | 0];
  const tier = Math.max(0, Math.min(4, level + ((Math.random() * 2) | 0) - (level > 0 ? 1 : 0)));
  return { type: t.type, n: t.tiers[tier], reward: REWARDS[tier], done: false };
}
export function ensureMissions() {
  save.missions = (save.missions || []).filter(m => MISSION_TYPES.some(t => t.type === m.type));
  while (save.missions.length < 3) save.missions.push(newMission(save.missions.map(m => m.type)));
  persist();
}
export const missionText = m => MISSION_TYPES.find(t => t.type === m.type).text(m.n);

// per-run stats the game feeds in
export const run = {};
export function resetRun() {
  Object.assign(run, { score: 0, dist: 0, coins: 0, flips: 0, spin: 0, oneFlips: 0, rails: 0, perfect: 0, combo: 0, near: 0, crevasse: 0, grab: 0, completed: [] });
}
resetRun();

// returns missions newly completed by this update (so the HUD can toast them)
export function track(key, value, mode = 'add') {
  if (mode === 'max') run[key] = Math.max(run[key], value); else run[key] += value;
  const fresh = [];
  for (const m of save.missions) {
    if (m.done || run.completed.includes(m)) continue;
    if (run[m.type] >= m.n) { run.completed.push(m); fresh.push(m); }
  }
  return fresh;
}
// called at game over: pays out and rerolls finished missions
export function settleMissions() {
  let total = 0;
  const done = run.completed.slice();
  for (const m of done) { total += m.reward; save.missionsDone++; }
  save.coins += total;
  save.missions = save.missions.filter(m => !done.includes(m));
  ensureMissions();
  return { done, total };
}
ensureMissions();
