// ============================================================
//  Meta-game: save data, cosmetics, chests, missions
// ============================================================

import { CG } from './crazy.js';

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
  // on CrazyGames, a copy in the player's account (without today's race ghost, which is big and stays on the device)
  if (CG.store) try { const { ghost, ...rest } = save; CG.store.setItem(SAVE_KEY, JSON.stringify(rest)); } catch {}
  if (changed && onPersist.fn) onPersist.fn();
};
// the save in the player's CrazyGames account, when it's newer than this device's
export function accountSave() {
  try { const d = JSON.parse(CG.store?.getItem(SAVE_KEY) || 'null'); return d && (d.savedAt || 0) > (save.savedAt || 0) ? d : null; }
  catch { return null; }
}

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
  mythic:    { name: 'Mythic',    color: '#ffe066', dupe: 0 },
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
    O('ninja', 'Ninja', 'rare', '#1b1b1b', '#1b1b1b', '#1b1b1b', 0, { tex: 'ninja', sw: 'linear-gradient(#1b1b1b 70%,#d00000 70% 80%,#1b1b1b 80%)' }),
    O('astronaut', 'Astronaut', 'legendary', '#f1f1f1', '#d9d9d9', '#ffffff', 0, { tex: 'astro', sw: 'linear-gradient(135deg,#fff,#cfd6dd)' }),
    O('ocean', 'Ocean', 'common', '#0077b6', '#03045e', '#90e0ef'),
    O('sand', 'Desert Sand', 'common', '#d4a373', '#6b4f2a', '#fefae0'),
    O('grape', 'Grape', 'common', '#7b2cbf', '#240046', '#e0aaff'),
    O('teal', 'Teal Team', 'common', '#14b8a6', '#134e4a', '#f0fdfa'),
    O('coral', 'Coral', 'common', '#ff6f59', '#254441', '#fff1e6'),
    O('olive', 'Field Olive', 'common', '#6b705c', '#3a3a2c', '#ddbea9'),
    O('retro', 'Retro 80s', 'rare', '#06d6a0', '#7209b7', '#ff4fa3'),
    O('police', 'Ski Patrol', 'rare', '#d62828', '#1d3557', '#ffffff'),
    O('sakura', 'Sakura', 'rare', '#ffb7c5', '#6d2e46', '#ffffff'),
    O('storm', 'Storm', 'rare', '#495867', '#1b2631', '#ffd60a'),
    O('emerald', 'Emerald', 'rare', '#2a9d8f', '#0b3d36', '#e9c46a'),
    O('royal', 'Royal Blue', 'rare', '#1d4ed8', '#0b1d51', '#ffd23f'),
    O('frost', 'Frostbite', 'epic', '#caf0f8', '#48cae4', '#0077b6'),
    O('toxic', 'Toxic Waste', 'epic', '#b5ff5c', '#1a1a1a', '#39ff14'),
    O('ruby', 'Ruby', 'epic', '#9b111e', '#2b0007', '#ff8fa3'),
    O('midnight', 'Midnight', 'epic', '#14213d', '#000000', '#fca311'),
    O('aurora', 'Aurora', 'legendary', '#3cf2a6', '#3a0ca3', '#c77dff'),
    O('lavender', 'Lavender', 'common', '#b8a1e3', '#4a3b6b', '#ffffff'),
    O('peach', 'Peach', 'common', '#ffb38a', '#7a3e2a', '#fff1e6'),
    O('woodland', 'Woodland', 'common', '#4f772d', '#31572c', '#ecf39e'),
    O('denim', 'Denim', 'common', '#3b5b92', '#22355a', '#f1f1f1'),
    O('mono', 'Monochrome', 'rare', '#f1f1f1', '#111111', '#111111'),
    O('firefighter', 'Firefighter', 'rare', '#c58b2a', '#3b2a12', '#d62828'),
    O('doctor', 'Snow Doctor', 'rare', '#e8f6f3', '#2a9d8f', '#ffffff'),
    O('tropical', 'Tropical', 'rare', '#06d6a0', '#ef476f', '#ffd166'),
    O('sunflower', 'Sunflower', 'rare', '#ffd60a', '#386641', '#6b4a2f'),
    O('camo', 'Snow Camo', 'rare', '#9aa5b1', '#4a5560', '#e5e5e5', 0, { tex: 'camo', sw: 'radial-gradient(circle at 30% 30%,#e5e5e5 20%,transparent 21%),radial-gradient(circle at 70% 60%,#4a5560 22%,transparent 23%),#9aa5b1' }),
    O('zebra', 'Zebra', 'epic', '#f8f8f8', '#111111', '#111111', 0, { tex: 'zebra', sw: 'repeating-linear-gradient(60deg,#f8f8f8 0 6px,#111 6px 10px)' }),
    O('checker', 'Checkered', 'epic', '#111111', '#111111', '#ffffff', 0, { tex: 'checker', sw: 'conic-gradient(#111 25%,#fff 0 50%,#111 0 75%,#fff 0) 0 0/14px 14px' }),
    O('polka', 'Polka Party', 'rare', '#ff4fa3', '#3a0ca3', '#ffd60a', 0, { tex: 'dots', sw: 'radial-gradient(circle,#fff 25%,transparent 26%) 0 0/12px 12px,#ff4fa3' }),
    O('cyber', 'Cyber Grid', 'epic', '#0b0b1e', '#05050f', '#00f0ff', 0, { tex: 'grid', glow: '#00f0ff', sw: 'linear-gradient(#00f0ff 1px,transparent 1px) 0 0/10px 10px,linear-gradient(90deg,#00f0ff 1px,#0b0b1e 1px) 0 0/10px 10px' }),
    O('flames', 'Hot Rod', 'epic', '#111111', '#111111', '#ff4800', 0, { tex: 'flames', glow: '#ff7b00', sw: 'linear-gradient(0deg,#ff4800 25%,#ffba08 40%,#111 55%)' }),
    O('pilot', 'Sky Pilot', 'rare', '#6b4a2f', '#3b2a1a', '#c9a227'),
    O('racer', 'Speed Racer', 'epic', '#ffffff', '#d62828', '#d62828'),
    O('iceking', 'Ice King', 'legendary', '#bfe8ff', '#4a7fb5', '#ffffff', 0, { tex: 'grid', glow: '#bfe8ff', sw: 'linear-gradient(135deg,#bfe8ff,#4a7fb5)' }),
    O('shadow', 'Shadow Ninja', 'legendary', '#14081f', '#050208', '#7b2cbf', 0, { tex: 'ninja', glow: '#7b2cbf', sw: 'linear-gradient(#14081f 70%,#7b2cbf 70% 80%,#14081f 80%)' }),
    O('phoenix', 'Phoenix', 'legendary', '#ff4800', '#6a040f', '#ffd60a'),
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
    ...inSet('xmas', [
      O('santa', 'Santa', 'legendary', '#d00000', '#d00000', '#ffffff'),
      O('elf', 'Workshop Elf', 'rare', '#2a9d4f', '#d62839', '#2a9d4f'),
      O('reindeer', 'Reindeer', 'epic', '#8b5a2b', '#5a3d22', '#e8d5b5'),
      O('gingerbread', 'Gingerbread', 'epic', '#b5651d', '#7a3e12', '#fff5f8'),
      O('snowman', 'Snowman', 'rare', '#f8fbff', '#e2ebf5', '#111111'),
    ]),
    // score rewards: unlocked by reaching a best score, never from chests
    O('medalist', 'Medalist', 'rare', '#cd7f32', '#3b2416', '#ffe0b3', 0, { score: 10000 }),
    O('champion', 'Champion', 'epic', '#c0c0c0', '#2b2d42', '#ffd23f', 0, { score: 100000 }),
    O('legend', 'Peak Legend', 'legendary', '#ffd23f', '#111111', '#ffffff', 0, { score: 500000 }),
    // secret: found, not bought
    O('arcade', 'Arcade', 'legendary', '#ff00e6', '#00f0ff', '#39ff14', 0, { secret: true }),
    // never owned: only whoever is #1 on the all-time Endless board can wear it, and only while they stay there
    O('numberone', 'World #1', 'mythic', '#15100a', '#0c0905', '#ffd23f', 0, { leader: true, tex: 'leader', glow: '#ffd23f', sw: 'radial-gradient(circle at 50% 38%,#fff3b0 0 12%,#ffd23f 13% 22%,transparent 23%),linear-gradient(135deg,#15100a 40%,#ffd23f 40% 52%,#15100a 52%)' }),
    // the vault: 10,000,000 coins and only 5 can ever exist. The database hands out the copies (supabase/vault.sql).
    O('horizon', 'Event Horizon', 'mythic', '#05030c', '#030208', '#0a0614', 0, { vault: true, tex: 'horizon', ptex: 'stars', glow: '#c77dff', sw: 'radial-gradient(circle at 50% 45%,#000 0 16%,#fff 17% 19%,#3cf2ff 20% 26%,#c77dff 27% 36%,#ff4fd8 37% 42%,transparent 43%),radial-gradient(circle at 20% 20%,#fff 0 2%,transparent 3%),radial-gradient(circle at 80% 75%,#c77dff 0 2%,transparent 3%),#05030c' }),
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
    A('beret', 'Beret', 'common', '#d62839', '#111111'),
    A('wizard', 'Wizard Hat', 'epic', '#3a0ca3', '#ffd23f'),
    A('sombrero', 'Sombrero', 'rare', '#e9c46a', '#d62839'),
    A('headphones', 'Headphones', 'rare', '#111111', '#ff4fa3'),
    A('goldhelm', 'Golden Helmet', 'epic', '#ffd23f', '#fff3b0', 0), A('peakcrown', 'Ice Crown', 'legendary', '#bfe8ff', '#3cf2ff', 0),
    A('bunny', 'Bunny Ears', 'legendary', '#ffffff', '#ffb7c5', 0),
    A('ushanka', 'Ushanka', 'rare', '#6b4a2f', '#d9c7a7'),
    A('bandana', 'Bandana', 'common', '#d62828', '#ffffff'),
    A('catears', 'Cat Ears', 'rare', '#111111', '#ff8fab'),
    A('mohawk', 'Mohawk', 'epic', '#39ff14', '#111111'),
    A('flowers', 'Flower Crown', 'rare', '#ff8fab', '#80b918'),
    A('gradcap', 'Graduation Cap', 'rare', '#111111', '#ffd23f'),
    A('spikehelm', 'Spiked Helmet', 'epic', '#2b2d42', '#c0c0c0'),
    A('unicorn', 'Unicorn Horn', 'legendary', '#ffffff', '#ff8fab'),
    ...inSet('xmas', [A('santahat', 'Santa Hat', 'rare', '#d62839', '#ffffff'), A('antlers', 'Antlers', 'epic', '#6b4a2f', '#d62839'), A('elfhat', 'Elf Hat', 'common', '#2a9d4f', '#ffd23f')]),
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
    A('monocle', 'Monocle', 'rare', '#ffd23f', '#bde0fe'),
    A('eyepatch', 'Eye Patch', 'common', '#111111', '#111111'),
    A('scarf', 'Cozy Scarf', 'common', '#e63946', '#ffffff'),
    A('nerd', 'Big Glasses', 'rare', '#111111', '#bde0fe'),
    A('starshades', 'Star Shades', 'epic', '#ffd23f', '#ff4fa3'),
    A('visor', 'Cyber Visor', 'epic', '#00f0ff', '#111111'),
    A('grin', 'Big Grin', 'common', '#ffffff', '#c1121f'),
    A('bubblegum', 'Bubblegum', 'rare', '#ff8fab', '#ffffff'),
    ...inSet('xmas', [A('rudolph', 'Rudolph Nose', 'epic', '#ff2020', '#ffb3b3')]),
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
    A('guitar', 'Guitar', 'rare', '#c1121f', '#f1e3c8'),
    A('shield', 'Knight Shield', 'epic', '#1d4ed8', '#ffd23f'),
    A('trophy', 'Trophy', 'legendary', '#ffd23f', '#8a5a35', 0),
    A('katana', 'Katana', 'epic', '#c0c0c0', '#111111'),
    A('balloons', 'Balloons', 'rare', '#ff4fa3', '#4cc3ff'),
    A('boardback', 'Spare Board', 'common', '#ff7b00', '#111111'),
    A('quiver', 'Quiver', 'rare', '#8a5a35', '#d62828'),
    A('teddy', 'Teddy Bear', 'legendary', '#a0703f', '#f3d9b1'),
    ...inSet('xmas', [A('giftsack', "Santa's Sack", 'epic', '#8b5a2b', '#d62839')]),
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
    S('ocean', 'Ocean', 'common', '#0077b6', '#90e0ef'),
    S('grape', 'Grape', 'common', '#7b2cbf', '#e0aaff'),
    S('sakura', 'Sakura', 'rare', '#ffb7c5', '#ffffff'),
    S('carbon', 'Carbon', 'rare', '#2b2d42', '#ef233c'),
    S('ice', 'Ice Blade', 'epic', '#bfe8ff', '#ffffff', true),
    S('ruby', 'Ruby', 'epic', '#9b111e', '#ff8fa3', true),
    S('silver', 'Silver Medal', 'epic', '#c0c0c0', '#ffffff', true),
    S('void', 'Void', 'legendary', '#240046', '#c77dff', true),
    S('zebra', 'Zebra', 'rare', '#f8f8f8', '#111111'),
    S('flame', 'Flame', 'epic', '#ff4800', '#ffba08', true),
    S('mint', 'Mint', 'common', '#5ee0b5', '#ffffff'),
    S('sunset', 'Sunset', 'rare', '#ff7b00', '#ff4fa3'),
    S('galaxy', 'Galaxy', 'legendary', '#3a0ca3', '#4cc9f0', true),
    S('camo', 'Camo', 'common', '#6b705c', '#3a3a2c'),
    S('checker', 'Checker', 'rare', '#111111', '#ffffff'),
    S('ghost', 'Ghost', 'epic', '#f1f5ff', '#bde0fe', true),
    ...inSet('xmas', [S('candycane', 'Candy Cane', 'rare', '#d62839', '#ffffff')]),
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
    Tr('sakura', 'Petals', 'rare', ['#ffb7c5', '#ffe5ec', '#ffffff']),
    Tr('ocean', 'Sea Spray', 'common', ['#0077b6', '#90e0ef', '#ffffff']),
    Tr('ember', 'Embers', 'epic', ['#ff4800', '#2b0a00', '#ffba08']),
    Tr('matrix', 'Matrix', 'epic', ['#00ff41', '#008f11', '#003b00']),
    Tr('stardust', 'Stardust', 'legendary', ['#ffffff', '#ffd23f', '#c77dff', '#4cc3ff']),
    Tr('comet', 'Comet', 'legendary', ['#ffffff', '#bfe8ff', '#4cc3ff']),
    Tr('confetti', 'Confetti', 'rare', ['#ff4fa3', '#ffd23f', '#4cc3ff', '#3ddc84']),
    Tr('lightning', 'Lightning', 'epic', ['#fff3b0', '#4cc3ff', '#ffffff']),
    Tr('galaxy', 'Galaxy', 'legendary', ['#3a0ca3', '#7b2cbf', '#4cc9f0', '#ffffff']),
    Tr('pixel', 'Pixels', 'rare', ['#39ff14', '#ff00e6', '#00f0ff']),
    Tr('smoke', 'Smoke', 'common', ['#d6dde4', '#9aa5b1']),
    Tr('sunrise', 'Sunrise', 'rare', ['#ff7b00', '#ffd60a', '#ff4fa3']),
    Tr('frostfire', 'Frostfire', 'epic', ['#4cc3ff', '#ff4800', '#ffffff']),
    Tr('leaves', 'Autumn Leaves', 'common', ['#d97706', '#b45309', '#facc15']),
    ...inSet('xmas', [Tr('tinsel', 'Tinsel', 'epic', ['#d62839', '#2a9d4f', '#ffd23f', '#ffffff'])]),
    ...inSet('agartha', [Tr('aurora', 'Inner Aurora', 'legendary', ['#3cf2ff', '#c264ff', '#7cf7d4'])]),
    ...inSet('halloween', [Tr('spooky', 'Spooky', 'epic', ['#ff7518', '#8a2be2', '#3ddc84'])]),
  ],
};
// score rewards and secrets that aren't outfits (the A/S/Tr helpers don't take extras)
const tag = (kind, id, extra) => Object.assign(CATALOG[kind].find(i => i.id === id), extra);
tag('hat', 'goldhelm', { score: 50000 }); tag('hat', 'peakcrown', { score: 1000000 }); tag('back', 'trophy', { score: 250000 });
tag('ski', 'silver', { score: 25000 }); tag('trail', 'comet', { score: 750000 });
tag('hat', 'bunny', { secret: true });

// Full looks for the Locker's Fits tab. Wearing a fit equips every piece you own; missing pieces stay as they are.
// Limited sets: their chest is only in the Shop until `until` (UTC, inclusive), and their items never drop
// from ordinary chests. Anything you got stays yours forever. Change the dates to run a set again.
export const SETS = {
  agartha:   { name: 'Agartha',   color: '#3cf2ff', blurb: 'Glowing crystals from the inner earth' },
  halloween: { name: 'Halloween', color: '#ff7518', blurb: 'Pumpkins, bones and bats', until: '2026-11-08' },
  tradition: { name: 'Shabbat',   color: '#9db8ff', blurb: 'Traditional Jewish dress', until: '2026-11-30' },
  xmas:      { name: 'Christmas', color: '#2a9d4f', blurb: 'Santa, elves and reindeer', until: '2027-01-06' },
  looks:     { name: 'Looks',     color: '#4cc3ff', blurb: 'Complete outfits made from shop items' },
};
const utcToday = () => new Date().toISOString().slice(0, 10);
export const isLimited = it => !!SETS[it?.set]?.until;
// days left (0 = last day) for a limited set, or -1 once it's gone; Infinity for sets that never leave
export function setDaysLeft(set) {
  const until = SETS[set]?.until; if (!until) return Infinity;
  return Math.round((Date.parse(until) - Date.parse(utcToday())) / 864e5);
}
export const setAvailable = set => setDaysLeft(set) >= 0;
// score rewards: everything whose `score` your best has reached. Returns the items that were just unlocked.
export function grantScoreRewards() {
  const fresh = [];
  for (const kind of Object.keys(CATALOG)) for (const it of CATALOG[kind]) {
    if (it.score && save.best >= it.score && !save.inv[kind].includes(it.id)) { save.inv[kind].push(it.id); fresh.push({ kind, it }); }
  }
  if (fresh.length) persist();
  return fresh;
}
// secrets (Easter eggs): returns true the first time
export function grantSecret(kind, id) {
  if (save.inv[kind].includes(id)) return false;
  save.inv[kind].push(id); persist(); return true;
}
export const FITS = [
  { id: 'patrol', name: 'Ski Patrol', set: 'looks', pieces: { outfit: 'police', hat: 'beanie', face: 'aviators', back: 'backpack', ski: 'red', trail: 'snow' } },
  { id: 'westerner', name: 'Wild West', set: 'looks', pieces: { outfit: 'cocoa', hat: 'cowboy', face: 'mustache', back: 'none', ski: 'forest', trail: 'none' } },
  { id: 'captain', name: 'Pirate Captain', set: 'looks', pieces: { outfit: 'phantom', hat: 'pirate', face: 'eyepatch', back: 'none', ski: 'blackgold', trail: 'void' } },
  { id: 'royalty', name: 'Royalty', set: 'looks', pieces: { outfit: 'royal', hat: 'crown', face: 'monocle', back: 'cape', ski: 'gold', trail: 'gold' } },
  { id: 'eighties', name: 'Retro 80s', set: 'looks', pieces: { outfit: 'retro', hat: 'headphones', face: 'pixel', back: 'surfboard', ski: 'pink', trail: 'rainbow' } },
  { id: 'archmage', name: 'Archmage', set: 'looks', pieces: { outfit: 'galaxy', hat: 'wizard', face: 'nerd', back: 'cape', ski: 'void', trail: 'stardust' } },
  { id: 'jarl', name: 'Viking Jarl', set: 'looks', pieces: { outfit: 'slate', hat: 'viking', face: 'beard', back: 'shield', ski: 'chrome', trail: 'ice' } },
  { id: 'chef', name: 'Le Chef', set: 'looks', pieces: { outfit: 'arctic', hat: 'chef', face: 'mustache', back: 'baguette', ski: 'pizza', trail: 'none' } },
  { id: 'rockstar', name: 'Rock Star', set: 'looks', pieces: { outfit: 'midnight', hat: 'tophat', face: 'aviators', back: 'guitar', ski: 'carbon', trail: 'fire' } },
  { id: 'phoenix', name: 'Phoenix', set: 'looks', pieces: { outfit: 'phoenix', hat: 'halo', face: 'hearts', back: 'wings', ski: 'lava', trail: 'ember' } },
  { id: 'warrior', name: 'Ninja Warrior', set: 'looks', pieces: { outfit: 'shadow', hat: 'bandana', face: 'none', back: 'katana', ski: 'void', trail: 'smoke' } },
  { id: 'party', name: 'Party Animal', set: 'looks', pieces: { outfit: 'polka', hat: 'party', face: 'starshades', back: 'balloons', ski: 'sunset', trail: 'confetti' } },
  { id: 'cyberpunk', name: 'Cyber Punk', set: 'looks', pieces: { outfit: 'cyber', hat: 'mohawk', face: 'visor', back: 'boardback', ski: 'neon', trail: 'lightning' } },
  { id: 'explorer', name: 'Arctic Explorer', set: 'looks', pieces: { outfit: 'camo', hat: 'ushanka', face: 'scarf', back: 'backpack', ski: 'white', trail: 'snow' } },
  { id: 'fairy', name: 'Snow Fairy', set: 'looks', pieces: { outfit: 'lavender', hat: 'unicorn', face: 'bubblegum', back: 'teddy', ski: 'ghost', trail: 'galaxy' } },
  { id: 'hotrod', name: 'Hot Rod', set: 'looks', pieces: { outfit: 'flames', hat: 'spikehelm', face: 'aviators', back: 'none', ski: 'flame', trail: 'frostfire' } },
  { id: 'spacewalk', name: 'Spacewalker', set: 'looks', pieces: { outfit: 'astronaut', hat: 'none', face: 'none', back: 'backpack', ski: 'chrome', trail: 'void' } },
  { id: 'agartha', name: 'Agartha Guardian', set: 'agartha', pieces: { outfit: 'agartha', hat: 'crystal', face: 'thirdeye', back: 'innersun', ski: 'crystal', trail: 'aurora' } },
  { id: 'hollow', name: 'Hollow Earth Explorer', set: 'agartha', pieces: { outfit: 'hollow', hat: 'none', face: 'thirdeye', back: 'none', ski: 'crystal', trail: 'aurora' } },
  { id: 'reaper', name: 'Grim Reaper', set: 'halloween', pieces: { outfit: 'skeleton', hat: 'none', face: 'none', back: 'scythe', ski: 'bone', trail: 'spooky' } },
  { id: 'jack', name: "Jack-o'-Lantern", set: 'halloween', pieces: { outfit: 'pumpkin', hat: 'pumpkinhead', face: 'none', back: 'none', trail: 'spooky' } },
  { id: 'count', name: 'The Count', set: 'halloween', pieces: { outfit: 'vampire', hat: 'none', face: 'fangs', back: 'batwings', trail: 'spooky' } },
  { id: 'witch', name: 'Witch', set: 'halloween', pieces: { outfit: 'witch', hat: 'witchhat', face: 'none', back: 'none', trail: 'spooky' } },
  { id: 'santa', name: 'Santa Claus', set: 'xmas', pieces: { outfit: 'santa', hat: 'santahat', face: 'none', back: 'giftsack', ski: 'candycane', trail: 'tinsel' } },
  { id: 'elf', name: 'Workshop Elf', set: 'xmas', pieces: { outfit: 'elf', hat: 'elfhat', face: 'none', back: 'none', ski: 'candycane' } },
  { id: 'rudolph', name: 'Rudolph', set: 'xmas', pieces: { outfit: 'reindeer', hat: 'antlers', face: 'rudolph', back: 'none', trail: 'tinsel' } },
  { id: 'shabbat', name: 'Shabbat Best', set: 'tradition', pieces: { outfit: 'shabbat', hat: 'shtreimel', face: 'payot', back: 'tallitshawl' } },
  { id: 'shul', name: 'Tallit & Kippah', set: 'tradition', pieces: { outfit: 'tallit', hat: 'kippah', face: 'none', back: 'none' } },
  { id: 'mensch', name: 'Fedora Classic', set: 'tradition', pieces: { outfit: 'shabbat', hat: 'fedora', face: 'none', back: 'none' } },
];

// The CrazyGames version is simpler: none of the themed sets (Agartha, Christmas and the limited ones), so their
// items aren't in the shop, chests, bundles, locker or fits. Anyone who had one equipped falls back to the first item.
if (CG.build) {
  const themed = Object.keys(SETS).filter(k => k !== 'looks');
  for (const kind of Object.keys(CATALOG)) CATALOG[kind] = CATALOG[kind].filter(it => !themed.includes(it.set));
  for (let i = FITS.length - 1; i >= 0; i--) if (themed.includes(FITS[i].set)) FITS.splice(i, 1);
  for (const k of themed) delete SETS[k];
}
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
// ---------- the World #1 outfit ----------
// Nobody owns it: it's wearable while the leaderboard (the server's own ranking) says you're #1 all-time in
// Endless. Lose first place and you're back in whatever you wore before. Outfits never leave this device, so
// a faked one fools nobody but yourself; that's why this is checked here and not in the database.
export const leader = { on: false };
export const canWear = (kind, id) => item(kind, id).leader ? leader.on : save.inv[kind].includes(id);
const fallback = kind => {
  const prev = save.beforeLeader?.[kind];
  return prev && save.inv[kind].includes(prev) ? prev : save.inv[kind][0] || CATALOG[kind][0].id;
};
export const equipped = kind => {
  const it = item(kind, save.eq[kind]);
  return it.leader && !leader.on ? item(kind, fallback(kind)) : it;
};
export function wear(kind, id) {
  if (!canWear(kind, id)) return false;
  if (item(kind, id).leader && !item(kind, save.eq[kind]).leader) save.beforeLeader = { ...save.beforeLeader, [kind]: save.eq[kind] };
  save.eq[kind] = id; persist();
  return true;
}
// `known` is false when the leaderboard couldn't be reached: then nothing is taken off, it just isn't shown
// until first place is confirmed again. Returns true when what you're wearing changed.
export function setLeader(on, known) {
  const was = leader.on; leader.on = !!on;
  let changed = was !== leader.on;
  if (!leader.on && known) for (const kind of Object.keys(CATALOG)) {
    if (item(kind, save.eq[kind]).leader) { save.eq[kind] = fallback(kind); changed = true; persist(); }
  }
  return changed;
}

// ---------- the vault ----------
// Event Horizon costs 10,000,000 coins and only VAULT.max players can ever own one. The server checks the
// coins in your cloud save, takes them, and records you as an owner, so the cap holds for everyone.
export const VAULT = { kind: 'outfit', id: 'horizon', price: 10000000, max: 5 };

// ---------- item shop: a new rotation every day at 00:00 UTC, the same for everyone ----------
// Featured (big, epic/legendary, the first one is the Item of the Day at a discount), Daily, Limited (only while
// a limited set is on sale) and one Bundle (a whole fit at 30% off). Score rewards, secrets and ad items are never sold.
export const PRICE = { common: 120, rare: 300, epic: 650, legendary: 1200 };
export const DEAL = 0.75;   // Item of the Day: 25% off
const mulberry = a => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const round50 = n => Math.max(50, Math.round(n / 50) * 50);
export function shopToday(day = utcToday()) {
  const rng = mulberry(hash('peakflip-shop-' + day));
  const all = [];
  for (const kind of Object.keys(CATALOG)) for (const it of CATALOG[kind])
    if (it.id !== 'none' && !it.ad && !it.score && !it.secret && !it.leader && !it.vault && (!isLimited(it) || setAvailable(it.set))) all.push({ kind, it, price: PRICE[it.rarity] });
  const take = (list, n) => { const out = [], pool = list.slice(); while (out.length < n && pool.length) out.push(pool.splice((rng() * pool.length) | 0, 1)[0]); return out; };
  const normal = all.filter(x => !isLimited(x.it));
  const featured = take(normal.filter(x => x.it.rarity === 'legendary' || x.it.rarity === 'epic'), 2);
  featured[0] = featured[0] && { ...featured[0], deal: true, was: featured[0].price, price: round50(featured[0].price * DEAL) };
  const daily = take(normal.filter(x => !featured.some(f => f.it === x.it)), 9).sort((a, b) => a.price - b.price);
  const limited = take(all.filter(x => isLimited(x.it)), 4);
  const fits = FITS.filter(f => setAvailable(f.set));
  const fit = fits[(rng() * fits.length) | 0];
  let bundle = null;
  if (fit) {
    const pieces = Object.entries(fit.pieces).filter(([, id]) => id !== 'none').map(([kind, id]) => ({ kind, it: item(kind, id) }));
    const full = pieces.reduce((n, x) => n + PRICE[x.it.rarity], 0);
    bundle = { fit, pieces, was: full, price: round50(full * 0.7) };
  }
  return { day, featured, daily, limited, bundle };
}
export const msToNewShop = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime(); };
// buy something that's in today's shop (prices come from shopToday, so a stale page can't buy at an old price)
export function buyItem(kind, id) {
  const shop = shopToday(), offer = [...shop.featured, ...shop.daily, ...shop.limited].find(x => x.kind === kind && x.it.id === id);
  if (!offer || save.inv[kind].includes(id) || save.coins < offer.price) return false;
  save.coins -= offer.price; save.inv[kind].push(id); save.bought = (save.bought || 0) + 1; persist();
  return true;
}
export function buyBundle() {
  const b = shopToday().bundle; if (!b) return false;
  const missing = b.pieces.filter(x => !save.inv[x.kind].includes(x.it.id));
  if (!missing.length || save.coins < b.price) return false;
  save.coins -= b.price; for (const x of missing) save.inv[x.kind].push(x.it.id); persist();
  return true;
}
// whole outfits: every look (and themed fit) can be bought at once, 20% off the pieces you don't have yet.
// Ad, score and secret pieces are never part of the price; limited fits only while their set is on sale.
export const FIT_DISCOUNT = 0.8;
export function fitOffer(f) {
  const missing = Object.entries(f.pieces).filter(([k, id]) => id !== 'none' && !save.inv[k].includes(id))
    .map(([kind, id]) => ({ kind, it: item(kind, id) })).filter(x => !x.it.ad && !x.it.score && !x.it.secret && !x.it.leader && !x.it.vault);
  const full = missing.reduce((n, x) => n + PRICE[x.it.rarity], 0);
  return { missing, was: full, price: missing.length ? round50(full * FIT_DISCOUNT) : 0, available: setAvailable(f.set) };
}
export function buyFit(id) {
  const f = FITS.find(x => x.id === id); if (!f) return false;
  const o = fitOffer(f);
  if (!o.available || !o.missing.length || save.coins < o.price) return false;
  save.coins -= o.price; for (const x of o.missing) save.inv[x.kind].push(x.it.id); persist();
  return true;
}
// daily gift: free coins once per UTC day, growing with a login streak (day 7 and beyond pays the most)
export const GIFT = [50, 75, 100, 150, 200, 250, 400];
export const giftReady = () => save.giftDay !== utcToday();
export function claimGift() {
  if (!giftReady()) return null;
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  save.streak = save.giftDay === y ? (save.streak || 0) + 1 : 1;
  const amount = GIFT[Math.min(save.streak, GIFT.length) - 1];
  save.giftDay = utcToday(); save.coins += amount; persist();
  return { amount, streak: save.streak };
}
export const collectionCount = () => {
  let have = 0, total = 0;
  for (const k of Object.keys(CATALOG)) { total += CATALOG[k].filter(i => !i.leader && !i.vault).length; have += save.inv[k].filter(id => !item(k, id).vault).length; }
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
export const AD_DAILY = { coins: 5, chest: 3, double: 5 };   // per-day caps for the "watch an ad for…" rewards
const todayStr = () => new Date().toISOString().slice(0, 10);
export function adUsesLeft(kind) {
  if (save.adDay !== todayStr()) { save.adDay = todayStr(); save.adCount = {}; }
  return AD_DAILY[kind] - (save.adCount[kind] || 0);
}
export function useAd(kind) { adUsesLeft(kind); save.adCount[kind] = (save.adCount[kind] || 0) + 1; persist(); }
// CrazyGames doesn't allow one reward to take several ads, and wants another way to get it too: there, every ad
// item unlocks with a single ad, or can be bought for coins
if (CG.build) for (const kind of Object.keys(CATALOG)) for (const it of CATALOG[kind]) if (it.ad) it.ad = 1;
export const adItemPrice = it => CG.build && it.ad ? PRICE[it.rarity] * 2 : 0;
export function buyAdItem(kind, id) {
  const it = item(kind, id), price = adItemPrice(it);
  if (!price || save.inv[kind].includes(id) || save.coins < price) return false;
  save.coins -= price; save.inv[kind].push(id); save.bought = (save.bought || 0) + 1; persist();
  return true;
}
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
