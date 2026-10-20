// ============================================================
//  Meta-game: save data, cosmetics, chests, missions
// ============================================================

// ---------- save ----------
const SAVE_KEY = 'peakflip_v1';
export const save = Object.assign({
  best: 0, coins: 0, muted: false, runs: 0, gear: 'ski',
  inv: { outfit: ['rookie'], hat: ['none'], face: ['none'], back: ['none'], ski: ['navy'], trail: ['none'] },
  eq: { outfit: 'rookie', hat: 'none', face: 'none', back: 'none', ski: 'navy', trail: 'none' },
  adProgress: {}, adDay: '', adCount: {},
  freeChestAt: 0, pity: 0, chestsOpened: 0, missions: [], missionsDone: 0,
}, (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } })());
// persist(true) marks a real change (bumps savedAt and queues a cloud sync); persist(false) only writes locally
export const onPersist = { fn: null };
export const persist = (changed = true) => {
  if (changed) save.savedAt = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {}
  if (changed && onPersist.fn) onPersist.fn();
};

// migrate the old "owned skins by index" format
if (Array.isArray(save.owned)) {
  const old = ['rookie', 'glacier', 'lime', 'sunset', 'phantom', 'golden'];
  for (const i of save.owned) if (old[i] && !save.inv.outfit.includes(old[i])) save.inv.outfit.push(old[i]);
  if (old[save.skin]) save.eq.outfit = old[save.skin];
  delete save.owned; delete save.skin; persist();
}

for (const k of ['hat', 'face', 'back']) { save.inv[k] = save.inv[k] || ['none']; save.eq[k] = save.eq[k] || 'none'; }
save.adProgress = save.adProgress || {}; save.adCount = save.adCount || {};

// ---------- catalog ----------
export const RARITY = {
  common:    { name: 'Common',    color: '#9fb3c8', dupe: 20 },
  rare:      { name: 'Rare',      color: '#4dabf7', dupe: 60 },
  epic:      { name: 'Epic',      color: '#c264ff', dupe: 150 },
  legendary: { name: 'Legendary', color: '#ffb627', dupe: 400 },
};
// outfits may carry `tex` (a pattern painted on the jacket, see outfitTexture in game.js), `glow` and a CSS `sw` for the swatch
const O = (id, name, rarity, jacket, pants, helmet, ad, extra) => ({ id, name, rarity, jacket, pants, helmet, ad, ...extra });
const S = (id, name, rarity, color, tip, glow = false) => ({ id, name, rarity, color, tip, glow });
const Tr = (id, name, rarity, colors, ad) => ({ id, name, rarity, colors, ad });
// accessories: color/color2 tint the 3D model; `ad: n` = unlocked by watching n rewarded ads (never in chests)
const A = (id, name, rarity, color, color2, ad) => ({ id, name, rarity, color, color2, ad });
// themed items belong to a set: themed chests only drop that set, and the Fits tab equips a whole look at once
const inSet = (set, items) => items.map(i => ({ ...i, set }));
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
    O('banana', 'Banana Suit', 'epic', '#ffe135', '#ffe135', '#6b4a2f'),
    O('tux', 'Tuxedo', 'epic', '#111111', '#111111', '#ffffff', 2),
    O('santa', 'Santa', 'legendary', '#d00000', '#d00000', '#ffffff'),
    O('ninja', 'Ninja', 'rare', '#1b1b1b', '#1b1b1b', '#1b1b1b', 0, { tex: 'ninja', sw: 'linear-gradient(#1b1b1b 70%,#d00000 70% 80%,#1b1b1b 80%)' }),
    O('astronaut', 'Astronaut', 'legendary', '#f1f1f1', '#d9d9d9', '#ffffff', 0, { tex: 'astro', sw: 'linear-gradient(135deg,#fff,#cfd6dd)' }),
    ...inSet('agartha', [
      O('agartha', 'Agartha Guardian', 'legendary', '#3b1f6e', '#1a0f33', '#ffd166', 0, { tex: 'runes', glow: '#3cf2ff', sw: 'repeating-linear-gradient(45deg,#3b1f6e 0 6px,#3cf2ff 6px 8px)' }),
      O('hollow', 'Hollow Earth', 'epic', '#0f5e5a', '#062a28', '#7cf7d4', 0, { tex: 'crystal', glow: '#7cf7d4', sw: 'conic-gradient(#0f5e5a,#7cf7d4,#0f5e5a,#1c8c84,#0f5e5a)' }),
    ]),
    ...inSet('halloween', [
      O('skeleton', 'Skeleton', 'epic', '#111111', '#111111', '#f1f1f1', 0, { tex: 'skeleton', ptex: 'bones', sw: 'repeating-linear-gradient(#111 0 5px,#f1f1f1 5px 8px)' }),
      O('pumpkin', 'Pumpkin Suit', 'rare', '#ff7518', '#2b1a0e', '#2b1a0e', 0, { tex: 'jack', glow: '#ffb000', sw: 'radial-gradient(circle at 35% 40%,#111 12%,transparent 13%),radial-gradient(circle at 65% 40%,#111 12%,transparent 13%),#ff7518' }),
      O('vampire', 'Vampire', 'epic', '#14070a', '#0b0b0b', '#8b0000', 0, { tex: 'vampire', sw: 'linear-gradient(90deg,#14070a 35%,#b3001b 35% 65%,#14070a 65%)' }),
      O('witch', 'Witch', 'rare', '#4b1d6b', '#111111', '#3ddc84'),
    ]),
    ...inSet('tradition', [
      O('shabbat', 'Shabbat Best', 'rare', '#111111', '#111111', '#ffffff', 0, { tex: 'suit', sw: 'linear-gradient(90deg,#111 38%,#fff 38% 62%,#111 62%)' }),
      O('tallit', 'Tallit', 'epic', '#f6f3ea', '#1d2b4a', '#ffffff', 0, { tex: 'tallit', sw: 'linear-gradient(#f6f3ea 20%,#1d4ed8 20% 28%,#f6f3ea 28% 34%,#1d4ed8 34% 42%,#f6f3ea 42%)' }),
    ]),
  ],
  hat: [
    A('none', 'No Hat', 'common'),
    A('beanie', 'Beanie', 'common', '#e63946', '#ffffff'),
    A('cap', 'Backwards Cap', 'common', '#1d70d6', '#ffffff'),
    A('bobble', 'Bobble Hat', 'common', '#2a9d8f', '#ffffff'),
    A('party', 'Party Hat', 'rare', '#ff4fa3', '#ffd60a'),
    A('cone', 'Traffic Cone', 'rare', '#ff7b00', '#ffffff'),
    A('cowboy', 'Cowboy Hat', 'rare', '#8a5a35', '#3b2416'),
    A('chef', 'Chef Hat', 'rare', '#ffffff', '#e5e5e5'),
    A('tophat', 'Top Hat', 'epic', '#111111', '#e63946'),
    A('viking', 'Viking Helmet', 'epic', '#9aa9b8', '#f1e3c8'),
    A('pirate', 'Pirate Hat', 'epic', '#1b1b1b', '#ffffff'),
    A('crown', 'Royal Crown', 'legendary', '#ffd23f', '#e63946'),
    A('duck', 'Rubber Duck', 'legendary', '#ffd60a', '#ff7b00'),
    A('halo', 'Halo', 'legendary', '#fff3b0', '#ffffff'),
    A('propeller', 'Propeller Cap', 'epic', '#3a86ff', '#ffd60a', 2),
    A('banana', 'Banana Head', 'epic', '#ffe135', '#6b4a2f', 3),
    ...inSet('agartha', [A('crystal', 'Crystal Crown', 'legendary', '#3cf2ff', '#c264ff')]),
    ...inSet('halloween', [A('pumpkinhead', 'Pumpkin Head', 'legendary', '#ff7518', '#ffd23f'), A('witchhat', 'Witch Hat', 'epic', '#2b1240', '#3ddc84')]),
    ...inSet('tradition', [A('kippah', 'Kippah', 'common', '#1d4ed8', '#ffffff'), A('fedora', 'Black Fedora', 'rare', '#111111', '#3a3a3a'), A('shtreimel', 'Shtreimel', 'epic', '#5a3a1e', '#111111')]),
  ],
  face: [
    A('none', 'Nothing', 'common'),
    A('aviators', 'Aviators', 'common', '#222222', '#c9a227'),
    A('mustache', 'Mustache', 'rare', '#3b2416'),
    A('clown', 'Clown Nose', 'rare', '#e63946'),
    A('hearts', 'Heart Shades', 'rare', '#ff4fa3', '#ffffff'),
    A('beard', 'Big Beard', 'epic', '#8a5a35'),
    A('pixel', 'Deal-With-It', 'epic', '#111111', '#ffffff'),
    A('mask', 'Hero Mask', 'epic', '#3a0ca3'),
    A('lasers', 'Laser Eyes', 'legendary', '#ff1e1e', '#ffb3b3', 3),
    ...inSet('agartha', [A('thirdeye', 'Third Eye', 'epic', '#3cf2ff', '#ffd166')]),
    ...inSet('halloween', [A('fangs', 'Vampire Fangs', 'rare', '#ffffff', '#8b0000')]),
    ...inSet('tradition', [A('payot', 'Payot', 'rare', '#3b2416')]),
  ],
  back: [
    A('none', 'Nothing', 'common'),
    A('backpack', 'Backpack', 'common', '#2a9d8f', '#264653'),
    A('cape', 'Hero Cape', 'rare', '#e63946'),
    A('baguette', 'Baguette', 'rare', '#d4a056', '#b07a2e'),
    A('surfboard', 'Surfboard', 'epic', '#4cc3ff', '#ffffff'),
    A('wings', 'Angel Wings', 'epic', '#ffffff', '#e0fbfc'),
    A('dragon', 'Dragon Wings', 'legendary', '#2b9348', '#80b918'),
    A('jetpack', 'Jetpack', 'legendary', '#9aa9b8', '#ff7b00', 4),
    ...inSet('agartha', [A('innersun', 'Inner Sun', 'legendary', '#ffd166', '#3cf2ff')]),
    ...inSet('halloween', [A('batwings', 'Bat Wings', 'epic', '#1b1b1b', '#5a0f2e'), A('scythe', 'Reaper Scythe', 'legendary', '#c9d3dc', '#3b2416')]),
    ...inSet('tradition', [A('tallitshawl', 'Tallit Shawl', 'rare', '#f6f3ea', '#1d4ed8')]),
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
    S('banana', 'Banana', 'rare', '#ffe135', '#6b4a2f'),
    S('pizza', 'Pizza Slice', 'epic', '#f4a261', '#e63946'),
    S('lava', 'Lava Flow', 'legendary', '#ff4800', '#ffd60a', true),
    ...inSet('agartha', [S('crystal', 'Crystal', 'epic', '#7cf7d4', '#3cf2ff', true)]),
    ...inSet('halloween', [S('bone', 'Bone', 'rare', '#f1f1f1', '#111111')]),
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
    Tr('hearts', 'Love Trail', 'rare', ['#ff4fa3', '#ff8fab', '#ffffff']),
    Tr('bubbles', 'Bubbles', 'rare', ['#bde0fe', '#a2d2ff', '#ffffff']),
    Tr('money', 'Make It Rain', 'epic', ['#2b9348', '#80b918', '#d8f3dc'], 3),
    ...inSet('agartha', [Tr('aurora', 'Inner Aurora', 'legendary', ['#3cf2ff', '#c264ff', '#7cf7d4'])]),
    ...inSet('halloween', [Tr('spooky', 'Spooky', 'epic', ['#ff7518', '#8a2be2', '#3ddc84'])]),
  ],
};

// Full looks for the Locker's Fits tab. Wearing a fit equips every piece you own; missing pieces stay as they are.
export const SETS = {
  agartha:   { name: 'Agartha',   color: '#3cf2ff', blurb: 'Glowing crystals from the inner earth' },
  halloween: { name: 'Halloween', color: '#ff7518', blurb: 'Pumpkins, bones and bats' },
  tradition: { name: 'Shabbat',   color: '#9db8ff', blurb: 'Traditional Jewish dress' },
};
export const FITS = [
  { id: 'agartha', name: 'Agartha Guardian', set: 'agartha', pieces: { outfit: 'agartha', hat: 'crystal', face: 'thirdeye', back: 'innersun', ski: 'crystal', trail: 'aurora' } },
  { id: 'hollow', name: 'Hollow Earth Explorer', set: 'agartha', pieces: { outfit: 'hollow', hat: 'none', face: 'thirdeye', back: 'none', ski: 'crystal', trail: 'aurora' } },
  { id: 'reaper', name: 'Grim Reaper', set: 'halloween', pieces: { outfit: 'skeleton', hat: 'none', face: 'none', back: 'scythe', ski: 'bone', trail: 'spooky' } },
  { id: 'jack', name: "Jack-o'-Lantern", set: 'halloween', pieces: { outfit: 'pumpkin', hat: 'pumpkinhead', face: 'none', back: 'none', trail: 'spooky' } },
  { id: 'count', name: 'The Count', set: 'halloween', pieces: { outfit: 'vampire', hat: 'none', face: 'fangs', back: 'batwings', trail: 'spooky' } },
  { id: 'witch', name: 'Witch', set: 'halloween', pieces: { outfit: 'witch', hat: 'witchhat', face: 'none', back: 'none', trail: 'spooky' } },
  { id: 'shabbat', name: 'Shabbat Best', set: 'tradition', pieces: { outfit: 'shabbat', hat: 'shtreimel', face: 'payot', back: 'tallitshawl' } },
  { id: 'shul', name: 'Tallit & Kippah', set: 'tradition', pieces: { outfit: 'tallit', hat: 'kippah', face: 'none', back: 'none' } },
  { id: 'mensch', name: 'Fedora Classic', set: 'tradition', pieces: { outfit: 'shabbat', hat: 'fedora', face: 'none', back: 'none' } },
];
export const fitOwned = f => Object.entries(f.pieces).filter(([k, id]) => save.inv[k].includes(id)).length;
// fills in anything a save from an older version (or another device) is missing
export function normalizeSave() {
  save.inv = save.inv || {}; save.eq = save.eq || {};
  for (const k of Object.keys(CATALOG)) {
    if (!Array.isArray(save.inv[k]) || !save.inv[k].length) save.inv[k] = [CATALOG[k][0].id];
    if (!save.eq[k]) save.eq[k] = CATALOG[k][0].id;
  }
  for (const k of ['best', 'coins', 'runs', 'freeChestAt', 'pity', 'chestsOpened', 'missionsDone']) save[k] = +save[k] || 0;
  save.adProgress = save.adProgress || {}; save.adCount = save.adCount || {}; save.missions = save.missions || [];
  save.gear = save.gear || 'ski';
}
export const KIND_NAME = { outfit: 'Outfit', hat: 'Hat', face: 'Face', back: 'Back', ski: 'Skis/Board', trail: 'Trail' };
export const item = (kind, id) => CATALOG[kind].find(i => i.id === id) || CATALOG[kind][0];
export const equipped = kind => item(kind, save.eq[kind]);

// ---------- chests ----------
export const CHESTS = {
  free:  { name: 'Free Chest',  price: 0,   odds: { common: 72, rare: 22, epic: 5, legendary: 1 }, color: '#8d6e4f' },
  basic: { name: 'Snow Chest',  price: 150, odds: { common: 72, rare: 22, epic: 5, legendary: 1 }, color: '#4dabf7' },
  epic:  { name: 'Epic Chest',  price: 600, odds: { common: 0, rare: 60, epic: 32, legendary: 8 }, color: '#c264ff' },
  // themed chests only drop items from their set
  spooky:    { name: 'Spooky Chest',  price: 350, set: 'halloween', odds: { common: 0, rare: 50, epic: 38, legendary: 12 }, color: '#ff7518' },
  agartha:   { name: 'Agartha Chest', price: 450, set: 'agartha',   odds: { common: 0, rare: 0, epic: 70, legendary: 30 }, color: '#3cf2ff' },
  tradition: { name: 'Shabbat Chest', price: 250, set: 'tradition', odds: { common: 30, rare: 45, epic: 25, legendary: 0 }, color: '#9db8ff' },
};
export const FREE_CHEST_COOLDOWN = 3 * 60 * 60 * 1000;
export const PITY = 10; // a Snow/Free chest is guaranteed Epic+ after this many without one

function rollRarity(chest) {
  if ((chest === 'free' || chest === 'basic') && save.pity >= PITY - 1) return Math.random() < 0.85 ? 'epic' : 'legendary';
  const odds = CHESTS[chest].odds;
  let r = Math.random() * 100;
  for (const k of ['legendary', 'epic', 'rare', 'common']) { if ((r -= odds[k]) < 0) return k; }
  return 'common';
}
export function openChest(chest, paidByAd = false) {
  const c = CHESTS[chest];
  if (paidByAd) { /* the player watched a rewarded ad */ }
  else if (chest === 'free') { if (Date.now() < save.freeChestAt) return null; save.freeChestAt = Date.now() + FREE_CHEST_COOLDOWN; }
  else { if (save.coins < c.price) return null; save.coins -= c.price; }
  let rarity = rollRarity(chest);
  if (chest === 'free' || chest === 'basic') save.pity = (rarity === 'epic' || rarity === 'legendary') ? 0 : save.pity + 1;
  // pick a kind weighted by how many items it has in that rarity; prefer unowned items
  const inPool = it => it.id !== 'none' && !it.ad && (!c.set || it.set === c.set);
  let pool = [];
  for (const kind of Object.keys(CATALOG)) for (const it of CATALOG[kind]) if (it.rarity === rarity && inPool(it)) pool.push({ kind, it });
  if (!pool.length) {   // a themed set may have nothing at this rarity: fall back to anything in the set
    for (const kind of Object.keys(CATALOG)) for (const it of CATALOG[kind]) if (inPool(it)) pool.push({ kind, it });
    rarity = pool[0]?.it.rarity || rarity;
  }
  const unowned = pool.filter(({ kind, it }) => !save.inv[kind].includes(it.id));
  const src = unowned.length && Math.random() < 0.7 ? unowned : pool;
  const { kind, it } = src[(Math.random() * src.length) | 0];
  rarity = it.rarity;
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
  const before = (save.missions || []).length;
  save.missions = (save.missions || []).filter(m => MISSION_TYPES.some(t => t.type === m.type));
  let added = save.missions.length !== before;
  while (save.missions.length < 3) { save.missions.push(newMission(save.missions.map(m => m.type))); added = true; }
  if (added) persist();   // don't mark the save as changed on every page load
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

// ---------- rewarded-ad unlocks ----------
export const AD_DAILY = { coins: 5, chest: 3 };   // per-day caps for the "watch an ad for…" rewards
const todayStr = () => new Date().toISOString().slice(0, 10);
export function adUsesLeft(kind) {
  if (save.adDay !== todayStr()) { save.adDay = todayStr(); save.adCount = {}; }
  return AD_DAILY[kind] - (save.adCount[kind] || 0);
}
export function useAd(kind) { adUsesLeft(kind); save.adCount[kind] = (save.adCount[kind] || 0) + 1; persist(); }
// returns true when the item becomes unlocked
export function adProgress(kind, id) {
  const key = `${kind}:${id}`, it = CATALOG[kind].find(i => i.id === id);
  save.adProgress[key] = (save.adProgress[key] || 0) + 1;
  const done = save.adProgress[key] >= it.ad;
  if (done && !save.inv[kind].includes(id)) save.inv[kind].push(id);
  persist();
  return done;
}
export const adWatched = (kind, id) => save.adProgress[`${kind}:${id}`] || 0;
