import * as THREE from './lib/three.module.min.js';
import { terrainHeight, landscapeTrees } from './landscape.js';

// ============================================================
//  PEAK FLIP — low-poly ski trick runner
// ============================================================

// ---------- tuning ----------
const G = 28;              // gravity (m/s^2)
const SLOPES = { race: 0.2, endless: 0.27 };   // visual tilt of the mountain (rad); the race keeps its original 0.2; special worlds set their own
const FLIP_RATE = 8.5;     // rad/s
const SPIN_RATE = 10.5;    // rad/s
const STEER = 13;          // lateral m/s
let X_LIMIT = 13;           // course half-width (narrower in the forest race)
const OFF_LIMIT = 18.4;     // Endless: you can leave the run into deep powder up to here (slow going)
const ROLL_RATE = 8;        // sideflip rad/s
const VIEW = 260;          // how far ahead we spawn
const COMBO_WINDOW = 3.0;  // seconds on the ground before a combo banks
const TAU = Math.PI * 2;

// gets brutal past ~3 km; the steeper Endless slope (and Agartha) run a little faster, the race is unchanged
const baseSpeed = d => Math.min(62, 22 + d * 0.0105) * speedK();
const speedK = () => mode === 'race' ? 1 : mode === 'level' ? (level.def.speed ?? 1.1) * levelDiff().speed : (WORLDS[zone]?.speed ?? 1.07);

// ---------- helpers ----------
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', isTouch);
// the menu's attract mode: a bot rides the course behind the menu (no sound, no missions, never dies)
let demo = false;
const track = (...a) => demo ? [] : trackRun(...a);

// ---------- save data / meta-game ----------
import { save, persist, equipped, item, CATALOG, FITS, track as trackRun, resetRun, run as runStats, settleMissions } from './meta.js';
import { initUI, missionToast, showMenuUI, showResults, fetchGhosts } from './ui.js';
import { icon } from './icons.js';
import { Ads } from './ads.js';
import { Cloud } from './cloud.js';

// ---------- CrazyGames SDK wrapper (safe no-op when not on CrazyGames) ----------
const ADS_ENABLED = true;   // an ad between runs (when you press Ride again); the ad network decides how often
const Platform = {
  sdk: null,
  async init() {
    try {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
        setTimeout(rej, 5000);
      });
      await window.CrazyGames.SDK.init();
      this.sdk = window.CrazyGames.SDK;
    } catch { this.sdk = null; }
  },
  call(fn) { try { fn(this.sdk); } catch {} },
  loadingStop() { if (this.sdk) this.call(s => s.game.loadingStop()); },
  gameplayStart() { if (this.sdk) this.call(s => s.game.gameplayStart()); },
  gameplayStop() { if (this.sdk) this.call(s => s.game.gameplayStop()); },
  happytime() { if (this.sdk) this.call(s => s.game.happytime()); },
  midgameAd() { return ADS_ENABLED ? Ads.interstitial() : Promise.resolve(); },
};

// ---------- audio (tiny synth, no asset files) ----------
const Sfx = {
  ctx: null, master: null, fx: null, noiseBuf: null, muted: save.muted, ad: false, quiet: false, last: {},
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    // effects get their own, quieter channel with the harsh top end rounded off; the music has its own level
    this.fx = ctx.createGain(); this.fx.gain.value = 0.5;
    const soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 3500;
    this.fx.connect(soft).connect(this.master);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.apply();
    Music.start(ctx, this.master);
  },
  apply() { if (this.master) this.master.gain.value = (this.muted || this.ad) ? 0 : 0.55; },
  adMute(v) { this.ad = v; this.apply(); },
  toggle() { this.muted = !this.muted; save.muted = this.muted; persist(); this.apply(); updateMuteBtn(); },
  // the same sound twice within 60 ms is one sound (coin bursts, rank ticks and grinds don't pile up)
  again(key) { const now = this.ctx.currentTime; if (now - (this.last[key] || -1) < 0.06) return true; this.last[key] = now; return false; },
  tone(f, dur, type = 'sine', vol = 0.25, f2 = null, delay = 0) {
    if (!this.ctx || this.quiet || (!delay && this.again('t' + f))) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    // buzzy square/sawtooth waves become rounder triangles, and nothing is louder than a gentle chime
    o.type = type === 'sine' ? 'sine' : 'triangle'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    vol = Math.min(vol, 0.14);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.fx); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol, freq, type = 'lowpass') {
    if (!this.ctx || this.quiet || this.again('n' + freq)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    // no bright hiss: highs become a soft band, and every burst is a muffled whoosh at a fraction of the level
    const f = ctx.createBiquadFilter(); f.type = type === 'highpass' ? 'bandpass' : type; f.frequency.value = Math.min(freq, type === 'lowpass' ? 1100 : 1600); f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol * 0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.fx); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  },
  coin() { this.tone(988, 0.07, 'square', 0.08); this.tone(1480, 0.12, 'square', 0.08, null, 0.06); },
  land(hard) { this.noise(0.18, hard ? 0.7 : 0.4, 700); },
  ollie() { this.noise(0.1, 0.25, 1800, 'highpass'); },
  trick(n) { [523, 659, 784, 1047].slice(0, 2 + Math.min(2, n)).forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.13, null, i * 0.07)); },
  perfect() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.13, null, i * 0.06)); },
  crash() { this.noise(0.6, 0.9, 450); this.tone(160, 0.4, 'sawtooth', 0.18, 40); },
  grind() { if (!this.ctx || this.again('grind')) return; this.tone(1300, 0.08, 'triangle', 0.025); },
  near() { this.tone(660, 0.1, 'sine', 0.1, 990); },
};

// ---------- music: soft looping synth songs, scheduled ahead on the audio clock (no audio files) ----------
// Each world has its own song; a change waits for the next bar so the beat never stumbles.
// TUNE has one entry per eighth note over the four bars (null = rest); `every` = melody on every Nth loop.
const SONGS = {
  // the mountain: 100 bpm in D major (D · A · Bm · G)
  mountain: { bpm: 100, chords: [[62, 66, 69], [61, 64, 69], [59, 62, 66], [59, 62, 67]], bass: [38, 33, 35, 31], every: 2, arp: 2, kick: [0, 8],
    tune: [74, null, 76, 78, null, 76, 74, null, 76, null, 73, null, 69, null, null, null, 71, null, 74, 76, null, 74, 71, null, 74, null, 78, 76, 74, null, null, null] },
  // Agartha: slow and mysterious, D minor (Dm · Bb · F · C), bell melody, no drums
  agartha: { bpm: 76, chords: [[62, 65, 69], [58, 62, 65], [60, 65, 69], [60, 64, 67]], bass: [38, 34, 41, 36], every: 1, arp: 4, kick: [], bell: true,
    tune: [81, null, null, 77, null, 76, 74, null, 72, null, 74, null, 69, null, null, null, 81, null, 84, null, 81, 77, null, 76, 74, null, null, 72, 74, null, null, null] },
  // North Pole: bright and bouncy in C (C · F · G · C) with sleigh bells; the melody is the traditional "Jingle Bells" chorus
  xmas: { bpm: 132, chords: [[60, 64, 67], [60, 65, 69], [59, 62, 67], [60, 64, 67]], bass: [36, 41, 43, 36], every: 1, arp: 2, kick: [0, 8], sleigh: true,
    tune: [76, null, 76, null, 76, null, null, null, 76, null, 76, null, 76, null, null, null, 76, null, 79, null, 72, null, 74, null, 76, null, null, null, null, null, null, null] },
};
const Music = (() => {
  const midi = n => 440 * 2 ** ((n - 69) / 12);
  let ctx, bus, step = 0, next = 0, song = SONGS.mountain, pending = null;
  const STEP = () => 60 / song.bpm / 4;   // a sixteenth note
  function note(f, t, dur, type, vol, attack = 0.005) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  function play(i, t) {
    const S = song, st = STEP(), s = i % 16, bar = (i >> 4) % 4, chord = S.chords[bar], loop = i >> 6;
    if (s === 0) for (const n of chord) { note(midi(n), t, st * 16, 'sine', 0.035, S.bell ? 0.9 : 0.5); note(midi(n) * 1.004, t, st * 16, 'triangle', 0.02, 0.6); }
    if (S.bell ? s === 0 || s === 8 : s === 0 || s === 6 || s === 8 || s === 14) note(midi(S.bass[bar] + (s === 14 ? 7 : 0)), t, st * (S.bell ? 8 : 3), 'triangle', 0.15, 0.01);
    if (s % S.arp === 0) note(midi(chord[[0, 1, 2, 1, 0, 2, 1, 2][(s / S.arp) % 8]] + 12), t, st * 2.5, 'triangle', 0.032);
    if (S.kick.includes(s)) {   // soft kick: a quick sine drop
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
      g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(bus); o.start(t); o.stop(t + 0.25);
    }
    if (S.sleigh && s % 2 === 1) note(2350 + (s % 4) * 90, t, 0.06, 'triangle', 0.012);   // little sleigh-bell ticks
    const m = S.tune[(i >> 1) % 32];
    if (loop % S.every === S.every - 1 && s % 2 === 0 && m) note(midi(m), t, st * (S.bell ? 7 : 3.5), 'sine', S.bell ? 0.06 : 0.07, 0.02);
  }
  return {
    on: save.music !== false,
    start(c, out) {
      if (ctx) return;
      ctx = c; bus = ctx.createGain(); bus.gain.value = this.on ? 1 : 0;
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3200;
      const echo = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain();
      echo.delayTime.value = 0.42; fb.gain.value = 0.3; wet.gain.value = 0.22;
      const level = ctx.createGain(); level.gain.value = 0.5;
      bus.connect(tone).connect(level).connect(out);
      tone.connect(echo); echo.connect(fb).connect(echo); echo.connect(wet).connect(out);
      setInterval(() => {
        if (ctx.state !== 'running') return;
        if (next < ctx.currentTime) next = ctx.currentTime + 0.05;   // after a pause, pick up the beat instead of rushing
        while (next < ctx.currentTime + 0.3) {
          if (pending && step % 16 === 0) { song = pending; pending = null; step = 0; }
          play(step++, next); next += STEP();
        }
      }, 60);
    },
    // switch to another world's song at the next bar
    play(name) { const S = SONGS[name] || SONGS.mountain; if (S !== song) pending = S; else pending = null; },
    toggle() {
      this.on = !this.on; save.music = this.on; persist();
      if (bus) bus.gain.setTargetAtTime(this.on ? 1 : 0, ctx.currentTime, 0.1);
    },
  };
})();
// no sound (and no music) while the tab is in the background
document.addEventListener('visibilitychange', () => { if (Sfx.ctx) document.hidden ? Sfx.ctx.suspend() : Sfx.ctx.resume(); });
// music starts with the first tap or key press anywhere (browsers only allow audio after one)
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => Sfx.init(), { once: true, capture: true });

// ---------- renderer / scene ----------
// weaker phones/laptops (few cores or little memory) start in a lighter mode
const WEAK = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
const LITE = save.quality === 'low' || (save.quality !== 'high' && WEAK);   // Settings → Graphics (Auto / High / Low)
const LOW = save.quality === 'low';                                         // the user asked for the smoothest mode
const renderer = new THREE.WebGLRenderer({ antialias: !LITE && window.devicePixelRatio < 2, powerPreference: 'high-performance' });
// Adaptive resolution: if frames get slow, render fewer pixels (the biggest cost on phones); raise it again when there's headroom
const Quality = {
  max: LOW ? 0.85 : Math.min(window.devicePixelRatio, isTouch ? 1.5 : 1.75), min: LOW ? 0.5 : 0.6,
  ratio: LOW ? 0.75 : Math.min(window.devicePixelRatio, LITE ? 1 : 1.5),
  t: 0, frames: 0, good: 0,
  cap: Infinity,
  apply() { renderer.setPixelRatio(Math.min(this.ratio, this.cap)); renderer.setSize(innerWidth, innerHeight); },
  sample(ms) {
    if (ms > 250) return;   // tab was in the background
    this.t += ms; this.frames++;
    if (this.t < 1500) return;
    const fps = this.frames * 1000 / this.t; this.t = this.frames = 0;
    if (fps < 48 && this.ratio > this.min) { this.ratio = Math.max(this.min, +(this.ratio - 0.15).toFixed(2)); this.good = 0; this.apply(); }
    else if (fps > 57 && this.ratio < this.max && ++this.good >= 3) { this.ratio = Math.min(this.max, +(this.ratio + 0.1).toFixed(2)); this.good = 0; this.apply(); }
  },
};
Quality.apply();
$('game').appendChild(renderer.domElement);
const canvas = renderer.domElement;

const SKY = 0xbfe3f5;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 70, 230);
const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.25, 500);
const hemi = new THREE.HemisphereLight(0xffffff, 0x9bb8cc, 1.6); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2); sun.position.set(-30, 60, 25); scene.add(sun);
// a soft lamp that rides with the player, only switched on at night
const headlamp = new THREE.PointLight(0xcfe0ff, 0, 40, 1.2); scene.add(headlamp);

const world = new THREE.Group();
world.rotation.x = -SLOPES.race;
function setSlope(a) { world.rotation.x = -a; world.updateMatrixWorld(true); }
scene.add(world);
world.updateMatrixWorld(true);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (typeof setViewOffset === 'function' && closet.on) setViewOffset();
});

// ---------- materials & geometry ----------
const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const vcol = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const mat = {
  snow: lam(0xf5f9fc),
  ramp: lam(0xe8f0f7),
  rampEdge: lam(0x3a86ff),
  rampSide: lam(0xc9dbe9),
  rail: lam(0xff7b00),
  railPost: lam(0x4a5563),
  shadow: new THREE.MeshBasicMaterial({ color: 0x1b3550, transparent: true, opacity: 0.2, depthWrite: false }),
  patch: new THREE.MeshLambertMaterial({ color: 0xdce9f3, polygonOffset: true, polygonOffsetFactor: -1 }),
};

// Merge several primitives into one vertex-coloured geometry (one draw call per instanced pool)
function merged(parts) {
  const pos = [], col = [], c = new THREE.Color();
  for (const { geo, color, m } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    const p = g.attributes.position; c.set(color);
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); col.push(c.r, c.g, c.b); }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

const treeGeo = merged([
  { geo: new THREE.CylinderGeometry(0.16, 0.22, 0.9, 5), color: 0x6b4a2f, m: T(0, 0.45, 0) },
  { geo: new THREE.ConeGeometry(1.35, 1.9, 7), color: 0x2f6b4f, m: T(0, 1.65, 0) },
  { geo: new THREE.ConeGeometry(1.05, 1.6, 7), color: 0x377a5a, m: T(0, 2.55, 0) },
  { geo: new THREE.ConeGeometry(0.7, 1.3, 7), color: 0x2f6b4f, m: T(0, 3.35, 0) },
  { geo: new THREE.ConeGeometry(0.33, 0.5, 7), color: 0xf5f9fc, m: T(0, 3.9, 0) },
]);
// Scenery spruces have uneven, snow-heavy branches; course hazards retain their familiar silhouette.
function spruceGeometry(tall) {
  const parts = [{ geo: new THREE.CylinderGeometry(0.12, 0.23, 1.25, 5), color: 0x66554a, m: T(0, 0.6, 0) }];
  const tiers = tall ? [[1.22, 1.8, 1.45], [1.0, 1.7, 2.35], [0.72, 1.6, 3.25], [0.4, 1.3, 4.05]]
    : [[1.5, 1.8, 1.4], [1.15, 1.7, 2.3], [0.77, 1.4, 3.1], [0.4, 1.0, 3.75]];
  tiers.forEach(([radius, height, y], i) => {
    const offset = Math.sin(i * 2.7) * 0.13;
    parts.push({ geo: new THREE.ConeGeometry(radius, height, 6), color: tall ? 0x294b48 : 0x355e57, m: T(offset, y, 0) });
    parts.push({ geo: new THREE.ConeGeometry(radius * 0.89, height * 0.76, 6), color: i % 2 ? 0xe0edf2 : 0xf4f8fa, m: T(offset, y + height * 0.16, -0.025) });
  });
  return merged(parts);
}
const rockGeo = merged([
  { geo: new THREE.DodecahedronGeometry(1, 0), color: 0x7f8a99, m: new THREE.Matrix4().makeScale(1.1, 0.75, 1) },
  { geo: new THREE.DodecahedronGeometry(0.75, 0), color: 0xf2f7fb, m: new THREE.Matrix4().makeScale(1.1, 0.35, 1).premultiply(T(0, 0.55, 0)) },
]);
const coinGeo = merged([
  { geo: new THREE.CylinderGeometry(0.5, 0.5, 0.12, 12), color: 0xffcc22, m: new THREE.Matrix4().makeRotationX(Math.PI / 2) },
  { geo: new THREE.CylinderGeometry(0.28, 0.28, 0.16, 12), color: 0xfff1a8, m: new THREE.Matrix4().makeRotationX(Math.PI / 2) },
]);
const coinMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x5a3c00 });
const patchGeo = new THREE.CircleGeometry(1, 6).rotateX(-Math.PI / 2);

// ---------- instanced pools ----------
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const dummy = new THREE.Object3D();
const allPools = [];
class Pool {
  // Hands out the lowest free slot and only draws up to the highest slot in use, so a pool of 520 trees with
  // 80 on screen costs 80 trees on the GPU, not 520 (empty slots still cost vertex work if they're drawn).
  constructor(geo, material, cap) {
    allPools.push(this);
    this.mesh = new THREE.InstancedMesh(geo, material, cap);
    this.mesh.frustumCulled = false;
    this.used = new Uint8Array(cap); this.lo = 0; this.hi = 0;
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, ZERO);
    this.mesh.count = 0; this.mesh.visible = false;
    world.add(this.mesh);
    this.dirty = true;
  }
  set(i, x, y, z, s = 1, ry = 0, sy = s) {
    dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(s, sy, s);
    dummy.updateMatrix(); this.mesh.setMatrixAt(i, dummy.matrix); this.dirty = true;
  }
  add(x, y, z, s, ry, sy) {
    const cap = this.used.length;
    let i = this.lo; while (i < cap && this.used[i]) i++;
    if (i >= cap) return -1;
    this.used[i] = 1; this.lo = i + 1; if (i >= this.hi) this.hi = i + 1;
    this.set(i, x, y, z, s, ry, sy); return i;
  }
  remove(i) {
    if (i < 0 || !this.used[i]) return;
    this.used[i] = 0; this.mesh.setMatrixAt(i, ZERO); this.dirty = true;
    if (i < this.lo) this.lo = i;
    while (this.hi > 0 && !this.used[this.hi - 1]) this.hi--;
  }
  flush() {
    this.mesh.count = this.hi; this.mesh.visible = this.hi > 0;
    if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; }
  }
}
const trees = new Pool(treeGeo, vcol, 520);
const sceneryTrees = [new Pool(spruceGeometry(false), vcol, 260), new Pool(spruceGeometry(true), vcol, 260)];
const rocks = new Pool(rockGeo, vcol, 90);
const coinPool = new Pool(coinGeo, coinMat, 420);
// golden coins: rare (Endless only, so the Daily Race stays fair), bigger, glowing, worth 10 coins
const goldCoinPool = new Pool(coinGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xffa000, emissiveIntensity: 0.9 }), 40);
const patches = new Pool(patchGeo, mat.patch, 260);

// ---------- ground ----------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(380, 600).rotateX(-Math.PI / 2), mat.snow);
world.add(ground);

// ---------- sky & horizon (not tilted, follow the camera so they always sit on the horizon) ----------
const mountains = new THREE.Group();
// Hazy distant ranges keep their atmospheric tint rather than becoming dark, unlit cliff faces.
const mountMats = [0xe6eef5, 0xcdd9e5, 0xb7c7d8].map(color => new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide }));
const capMatSky = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, side: THREE.DoubleSide });
{
  // Continuous overlapping ranges give the valley depth, with a low central pass and irregular ridgelines.
  for (let layer = 0; layer < 3; layer++) {
    const pos = [], snow = [], rows = [], dist = 420 - layer * 48;
    for (let i = 0; i <= 32; i++) {
      const a = -1.52 + i / 32 * 3.04;
      const ridge = Math.sin(i * 0.69 + layer * 1.9) * 23 + Math.sin(i * 1.57 + layer * 0.7) * 12;
      const pass = 34 * Math.exp(-Math.pow((i - 16 - layer * 2) / 4.8, 2));
      const h = -27 - layer * 15 + ridge - pass;
      const x = Math.sin(a) * dist, z = -Math.cos(a) * dist;
      rows.push([[x, h, z], [x, h - 9 - 7 * (0.5 + 0.5 * Math.sin(i * 0.8)), z + 2], [x, -175, z + 32]]);
    }
    for (let i = 0; i < 32; i++) {
      const [a, b, c] = rows[i], [d, e, f] = rows[i + 1];
      for (const q of [b, c, e, e, c, f]) pos.push(...q);
      for (const q of [a, b, d, d, b, e]) snow.push(...q);
    }
    const mesh = (positions, material) => {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, material); m.material.side = THREE.DoubleSide; mountains.add(m);
    };
    mesh(pos, mountMats[layer]);
    // The nearest crest catches light; distant snow blends into its own hazy range.
    mesh(snow, layer === 2 ? capMatSky : mountMats[layer]);
  }
}
scene.add(mountains);
const sky = new THREE.Group(); scene.add(sky);
const skyGeo = new THREE.SphereGeometry(460, 24, 16);
skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
const skyDome = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
skyDome.renderOrder = -2; sky.add(skyDome);
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,.95)'); gr.addColorStop(0.3, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
})();
const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, fog: false, depthWrite: false, transparent: true }));
sunDisc.scale.set(120, 120, 1); sky.add(sunDisc);
const stars = (() => {
  const N = 900, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = rand(0, TAU), e = Math.asin(rand(0.05, 1)), r = 440;
    pos[i * 3] = Math.cos(a) * Math.cos(e) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: 0xffffff, fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
  sky.add(pts); return pts;
})();
// aurora: a few wavy vertical ribbons, colour fades from green at the bottom to violet at the top
const aurora = (() => {
  const g = new THREE.Group(), ribbons = [];
  for (let r = 0; r < 3; r++) {
    const N = 48, pos = new Float32Array(N * 2 * 3), idx = [];
    for (let i = 0; i < N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // RGBA per vertex: the bottom edge glows green, fading to transparent violet at the top
    const c4 = new Float32Array(N * 2 * 4);
    for (let i = 0; i < N; i++) { c4.set([0.25, 1, 0.65, 0.7], i * 8); c4.set([0.6, 0.35, 1, 0], i * 8 + 4); }
    geo.setAttribute('color', new THREE.BufferAttribute(c4, 4));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    m.renderOrder = -1; m.frustumCulled = false;
    g.add(m); ribbons.push({ geo, pos, N, seed: rand(0, 10), z: -260 - r * 40, y: 90 + r * 18, h: 70 + r * 15, x: rand(-80, 80) });
  }
  sky.add(g);
  return {
    group: g,
    update(t) {
      if (!g.visible) return;
      for (const rb of ribbons) {
        for (let i = 0; i < rb.N; i++) {
          const u = i / (rb.N - 1), x = rb.x + (u - 0.5) * 520, z = rb.z + Math.sin(u * 6 + t * 0.35 + rb.seed) * 40 + Math.sin(u * 13 + t * 0.6) * 10;
          const y = rb.y + Math.sin(u * 4 + rb.seed + t * 0.2) * 15;
          rb.pos.set([x, y, z], i * 6); rb.pos.set([x, y + rb.h * (0.75 + 0.25 * Math.sin(u * 9 + t + rb.seed)), z], i * 6 + 3);
        }
        rb.geo.attributes.position.needsUpdate = true;
      }
    },
  };
})();
// low-poly clouds drifting around the horizon
const clouds = (() => {
  const g = new THREE.Group(), cm = lam(0xffffff, { fog: false });
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(8, 16), 0), cm); b.position.set(k * 12 - 24 + rand(-4, 4), rand(-3, 5), rand(-6, 6)); b.scale.y = 0.6; c.add(b); }
    const a = rand(-1.4, 1.4), d = rand(260, 360);
    c.position.set(Math.sin(a) * d, rand(40, 110), -Math.cos(a) * d); c.userData.a = a; c.userData.d = d;
    g.add(c);
  }
  sky.add(g);
  return { group: g, mat: cm, update(dt) { for (const c of g.children) { c.userData.a += dt * 0.004; if (c.userData.a > 1.5) c.userData.a = -1.5; c.position.x = Math.sin(c.userData.a) * c.userData.d; c.position.z = -Math.cos(c.userData.a) * c.userData.d; } } };
})();

// ---------- time-of-day themes ----------
const THEMES = {
  day: {
    top: 0x4f9fe3, horizon: 0xd8eef9, hemi: [0xffffff, 0x9bb8cc, 1.6], sun: [0xfff4e0, 2.2], disc: [0xfff8e0, 0, 150, -380, 110],
    mountains: [0xe6eef5, 0xcdd9e5, 0xb7c7d8], cap: 0xffffff, cloud: 0xffffff, clouds: true,
  },
  golden: {
    top: 0x3d4f9a, horizon: 0xf6bf98, hemi: [0xffe2c8, 0x8f7fa8, 1.35], sun: [0xffb36b, 2.5], disc: [0xffc27a, -120, 25, -380, 170],
    mountains: [0xf1cfc0, 0xd6aeb4, 0xb294ad], cap: 0xffe9dc, cloud: 0xffcfb8, clouds: true,
  },
  agartha: {
    top: 0x34237a, horizon: 0xd9c5ef, hemi: [0xf4ecff, 0x7c6cab, 1.55], sun: [0xffe2ac, 2.2], disc: [0xffe39a, 25, 16, -380, 95],
    mountains: [0xcfc4ea, 0xb3a5da, 0x9787c6], cap: 0xffffff, cloud: 0xc9b8ec, clouds: false, stars: false, aurora: true, lamp: 0,
    snow: 0xf6f3ff, patch: 0xdcd6f7, patchGlow: 0x221a40,
  },
  xmas: {
    top: 0x07123a, horizon: 0x2f5a8f, hemi: [0xe2ebff, 0x34405e, 1.4], sun: [0xcfe0ff, 1.1], disc: [0xf3f6ff, -120, 150, -360, 60],
    mountains: [0x6a82ab, 0x56709a, 0x45608a], cap: 0xffffff, cloud: 0x56688f, clouds: false, stars: true, aurora: true, lamp: 1.4, fall: 'heavy',
  },
  night: {
    top: 0x030817, horizon: 0x1d335f, hemi: [0x9ab8ff, 0x1c2848, 1.05], sun: [0xbcd4ff, 1.0], disc: [0xe8f0ff, 140, 170, -360, 55],
    mountains: [0x3a4d78, 0x2d3d63, 0x223052], cap: 0x8fa4cc, cloud: 0x3b4b70, clouds: false, stars: true, aurora: true, lamp: 1.4,
  },
};
let theme = THEMES.day;
const tmpCol = new THREE.Color(), tmpCol2 = new THREE.Color();
function setTheme(name) {
  theme = THEMES[name] || THEMES.day; theme.id = name;
  const t = theme;
  scene.background.set(t.horizon); scene.fog.color.set(t.horizon);   // one colour, so snow, haze and sky meet without a band
  hemi.color.set(t.hemi[0]); hemi.groundColor.set(t.hemi[1]); hemi.intensity = t.hemi[2];
  sun.color.set(t.sun[0]); sun.intensity = t.sun[1];
  // sky gradient: horizon colour near the ground, fading to the top colour overhead
  const pos = skyGeo.attributes.position, col = skyGeo.attributes.color;
  tmpCol.set(t.horizon); tmpCol2.set(t.top);
  for (let i = 0; i < pos.count; i++) {
    const k = clamp(pos.getY(i) / 460, -0.2, 1), f = Math.pow(clamp((k + 0.05) / 0.75, 0, 1), 0.7);
    const c = tmpCol.clone().lerp(tmpCol2, f); col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  sunDisc.material.color.set(t.disc[0]); sunDisc.position.set(t.disc[1], t.disc[2], t.disc[3]); sunDisc.scale.setScalar(t.disc[4]);
  mountMats.forEach((m, i) => m.color.set(t.mountains[i])); capMatSky.color.set(t.cap);
  clouds.group.visible = !!t.clouds && !LOW; clouds.mat.color.set(t.cloud);
  stars.visible = !!t.stars; aurora.group.visible = !!t.aurora && !LOW;
  headlamp.intensity = t.lamp || 0;
  mat.snow.color.set(t.snow ?? 0xf5f9fc); mat.patch.color.set(t.patch ?? 0xdce9f3); mat.patch.emissive.set(t.patchGlow ?? 0);
  Snowfall.style(t.fall);
  lanternMat.emissiveIntensity = t.lamp ? 1 : 0.15;
  document.body.style.background = '#' + tmpCol.set(t.horizon).getHexString();
}
const pickTheme = (r = Math.random()) => r < 0.45 ? 'day' : r < 0.75 ? 'golden' : 'night';

// ---------- ramp geometry ----------
const rampCache = new Map();
function rampGeo(L, H, W) {
  const key = `${L}|${H}|${W}`;
  if (rampCache.has(key)) return rampCache.get(key);
  const pos = [], hw = W / 2, seg = 8, h = t => H * t * t;
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg, z0 = -t0 * L, z1 = -t1 * L, y0 = h(t0), y1 = h(t1);
    quad([-hw, y0, z0], [hw, y0, z0], [hw, y1, z1], [-hw, y1, z1]);
    quad([-hw, 0, z0], [-hw, y0, z0], [-hw, y1, z1], [-hw, 0, z1]);
    quad([hw, 0, z1], [hw, y1, z1], [hw, y0, z0], [hw, 0, z0]);
  }
  quad([-hw, H, -L], [hw, H, -L], [hw, 0, -L], [-hw, 0, -L]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  rampCache.set(key, g);
  return g;
}
const boxCache = new Map();
const box = (w, h, d) => { const k = `${w}|${h}|${d}`; if (!boxCache.has(k)) boxCache.set(k, new THREE.BoxGeometry(w, h, d)); return boxCache.get(k); };

// ---------- skier ----------
const skinMats = { jacket: lam(0xe94f37), pants: lam(0x2d3142), helmet: lam(0xffffff), ski: lam(0x1d3557), tip: lam(0x1d3557) };
const skier = (() => {
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.9; body.rotation.order = 'YXZ'; root.add(body);
  const add = (parent, geo, material, x, y, z) => { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); parent.add(m); return m; };
  const skiMat = skinMats.ski, bootMat = lam(0x222831), skinMat = lam(0xf1c27d), goggle = lam(0xff9f1c, { emissive: 0x6a3500 }), poleMat = lam(0xbfc7d1);
  const trim = lam(0x1d2430), metal = lam(0xc9d3dc), hairMat = lam(0x5a3a22), eyeMat = lam(0x1b1b1b), noseMat = lam(0xe7b06f);
  // an eight-sided prism with flat faces front, back and sides (so round hats and flat glasses both sit flush)
  const oct = (r, h) => new THREE.CylinderGeometry(r, r, h, 8).rotateY(Math.PI / 8);
  // skis (relative to body centre, feet at y=-0.9)
  const skis = new THREE.Group(); body.add(skis);
  for (const sx of [-0.17, 0.17]) {
    add(skis, box(0.16, 0.05, 1.9), skiMat, sx, -0.875, -0.05);
    const tip = add(skis, box(0.16, 0.05, 0.25), skinMats.tip, sx, -0.83, -1.05); tip.rotation.x = 0.5;
    const tail = add(skis, box(0.16, 0.05, 0.16), skinMats.tip, sx, -0.86, 0.95); tail.rotation.x = -0.35;
    add(skis, box(0.13, 0.07, 0.36), trim, sx, -0.83, -0.02);          // binding
    add(skis, box(0.1, 0.03, 0.08), metal, sx, -0.79, -0.22);          // toe piece
  }
  // snowboard: one wide deck with kicked nose & tail; the rider stands sideways on it
  const board = new THREE.Group(); body.add(board); board.visible = false;
  add(board, box(0.4, 0.06, 1.35), skiMat, 0, -0.875, 0);
  for (const sz of [-1, 1]) { const k = add(board, box(0.4, 0.06, 0.3), skinMats.tip, 0, -0.84, sz * 0.78); k.rotation.x = sz * -0.45; }
  const legs = new THREE.Group(); legs.position.y = -0.85; body.add(legs);
  for (const sx of [-0.15, 0.15]) {
    add(legs, box(0.2, 0.16, 0.32), bootMat, sx, 0.08, -0.02);
    add(legs, box(0.21, 0.035, 0.26), metal, sx, 0.13, -0.02);           // buckles
    add(legs, box(0.21, 0.035, 0.26), metal, sx, 0.2, -0.0);
    add(legs, box(0.17, 0.5, 0.2), skinMats.pants, sx, 0.4, 0);
    add(legs, box(0.19, 0.08, 0.22), skinMats.pants, sx, 0.2, 0);        // cuff over the boot
    add(legs, box(0.175, 0.1, 0.03), trim, sx, 0.48, -0.105);            // knee patch
  }
  const upper = new THREE.Group(); upper.position.y = -0.2; body.add(upper);
  add(upper, box(0.46, 0.2, 0.28), skinMats.pants, 0, 0.0, 0);
  add(upper, box(0.5, 0.55, 0.32), skinMats.jacket, 0, 0.35, 0);
  add(upper, box(0.52, 0.07, 0.34), trim, 0, 0.1, 0);                    // hem
  add(upper, box(0.025, 0.46, 0.01), trim, 0, 0.38, -0.162);             // zipper
  add(upper, box(0.11, 0.07, 0.01), metal, 0.13, 0.5, -0.162);           // chest badge
  add(upper, box(0.32, 0.09, 0.3), skinMats.jacket, 0, 0.66, 0.0);       // collar
  // head: face, ears, a helmet with ear covers and goggles (a hat swaps the helmet for hair; glasses swap the goggles)
  const head = new THREE.Group(); upper.add(head);
  add(head, oct(0.155, 0.3), skinMat, 0, 0.8, 0);
  add(head, box(0.05, 0.065, 0.045), noseMat, 0, 0.775, -0.158);
  for (const sx of [-1, 1]) {
    add(head, box(0.04, 0.05, 0.02), eyeMat, sx * 0.06, 0.83, -0.146);
    add(head, box(0.035, 0.07, 0.06), skinMat, sx * 0.158, 0.8, 0);
  }
  add(head, box(0.09, 0.02, 0.02), noseMat, 0, 0.715, -0.146);           // mouth
  const helmet = new THREE.Group(); head.add(helmet);
  add(helmet, oct(0.172, 0.15), skinMats.helmet, 0, 0.965, 0);
  add(helmet, box(0.06, 0.03, 0.3), trim, 0, 1.05, 0.02);                // vent stripe
  for (const sx of [-1, 1]) add(helmet, box(0.04, 0.14, 0.17), skinMats.helmet, sx * 0.168, 0.86, 0.02);   // ear covers
  add(helmet, box(0.3, 0.06, 0.12), skinMats.helmet, 0, 0.88, 0.11);     // back of the shell
  const goggles = new THREE.Group(); head.add(goggles);
  add(goggles, box(0.33, 0.045, 0.33), trim, 0, 0.84, 0.0);              // strap
  add(goggles, box(0.31, 0.11, 0.035), trim, 0, 0.835, -0.163);          // frame
  add(goggles, box(0.27, 0.08, 0.03), goggle, 0, 0.835, -0.178);         // lens
  const hair = new THREE.Group(); head.add(hair); hair.visible = false;
  add(hair, oct(0.165, 0.07), hairMat, 0, 0.935, 0.0);
  add(hair, box(0.3, 0.18, 0.06), hairMat, 0, 0.86, 0.13);
  const arms = [], poles = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sx * 0.31, 0.56, 0); upper.add(arm);
    add(arm, box(0.13, 0.48, 0.14), skinMats.jacket, 0, -0.22, 0);
    add(arm, box(0.14, 0.06, 0.15), trim, 0, -0.42, 0);                   // cuff
    add(arm, box(0.13, 0.11, 0.13), trim, 0, -0.5, 0);                    // glove
    const pole = add(arm, new THREE.CylinderGeometry(0.018, 0.018, 1.15, 4), poleMat, 0, -0.95, 0.12); poles.push(pole);
    add(pole, box(0.05, 0.12, 0.05), trim, 0, 0.52, 0);                   // grip
    add(pole, new THREE.CylinderGeometry(0.07, 0.07, 0.015, 6), trim, 0, -0.48, 0);   // basket
    pole.rotation.x = -0.25;
    arm.rotation.x = 0.35; arm.rotation.z = sx * 0.18;
    arms.push(arm);
  }
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 14).rotateX(-Math.PI / 2), mat.shadow);
  world.add(shadow);
  world.add(root);
  Object.assign(skis, { name: 'skis' }); Object.assign(board, { name: 'board' }); Object.assign(legs, { name: 'legs' }); Object.assign(upper, { name: 'upper' });
  Object.assign(head, { name: 'head' }); Object.assign(helmet, { name: 'helmet' }); Object.assign(goggles, { name: 'goggles' }); Object.assign(hair, { name: 'hair' }); body.name = 'body';
  return { root, body, legs, upper, arms, shadow, skis, board, poles, head, helmet, goggles, hair };
})();

// ---------- accessories (hats, face, back) ----------
const slots = {
  hat: new THREE.Group(), face: new THREE.Group(), back: new THREE.Group(),
};
slots.hat.position.set(0, 0.95, 0); slots.face.position.set(0, 0.82, -0.148); slots.back.position.set(0, 0.36, 0.17);
for (const k in slots) { slots[k].name = 'slot-' + k; skier.upper.add(slots[k]); }
// Leader crown is a separate, temporary marker so cosmetic refreshes cannot remove it.
const leaderCrown = new THREE.Group();
const leaderGold = lam(0xffd33d, { emissive: 0x7a4b00, emissiveIntensity: 0.7 });
leaderCrown.add(new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.09, 10), leaderGold));
for (let i = 0; i < 5; i++) {
  const a = i / 5 * TAU;
  const point = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 5), leaderGold);
  point.position.set(Math.cos(a) * 0.17, 0.12, Math.sin(a) * 0.17);
  leaderCrown.add(point);
}
leaderCrown.position.set(0, 1.31, 0.01);
leaderCrown.name = 'leader-crown';
leaderCrown.visible = false;
skier.upper.add(leaderCrown);
addEventListener('peakflip-leader', e => { leaderCrown.visible = !!e.detail?.active; });
const accAnim = { prop: null, cape: null, wings: [], jet: false, lasers: null, sun: null, crystal: null };
function accMesh(geo, color, x = 0, y = 0, z = 0, extra) {
  const m = new THREE.Mesh(geo, lam(color, extra)); m.position.set(x, y, z); return m;
}
const glow = c => ({ emissive: c, emissiveIntensity: 0.8 });
function buildAccessory(kind, it) {
  const g = new THREE.Group(), c = it.color, c2 = it.color2;
  const C = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const S = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const add = (...a) => { const m = accMesh(...a); g.add(m); return m; };
  switch (it.id) {
    // ---- hats ----
    case 'beanie': add(C(0.17, 0.18, 0.15), c, 0, 0.05); add(C(0.185, 0.185, 0.05), c2, 0, -0.01); break;
    case 'bobble': add(C(0.16, 0.18, 0.16), c, 0, 0.06); add(S(0.075), c2, 0, 0.18); break;
    case 'cap': add(C(0.17, 0.18, 0.09), c, 0, 0.02); add(B(0.2, 0.025, 0.16), c, 0, -0.01, 0.2); add(S(0.025), c2, 0, 0.075); break;
    case 'party': add(new THREE.ConeGeometry(0.12, 0.34, 8), c, 0, 0.16); add(S(0.05), c2, 0, 0.34); break;
    case 'cone': add(new THREE.ConeGeometry(0.16, 0.5, 8), c, 0, 0.25); add(C(0.11, 0.125, 0.07), c2, 0, 0.2); add(B(0.36, 0.04, 0.36), c, 0, 0.0); break;
    case 'cowboy': add(C(0.34, 0.34, 0.03, 12), c, 0, 0); add(C(0.14, 0.17, 0.2), c, 0, 0.11); add(C(0.172, 0.172, 0.04), c2, 0, 0.04); break;
    case 'chef': add(C(0.16, 0.16, 0.12), c, 0, 0.05); { const p = add(S(0.2), c, 0, 0.22); p.scale.set(1, 0.7, 1); } break;
    case 'tophat': add(C(0.25, 0.25, 0.02, 12), c, 0, 0); add(C(0.15, 0.15, 0.34), c, 0, 0.18); add(C(0.153, 0.153, 0.05), c2, 0, 0.05); break;
    case 'viking': { const d = add(S(0.2, 10, 6), c, 0, -0.02); d.scale.y = 0.7;
      for (const sx of [-1, 1]) { const h = add(new THREE.ConeGeometry(0.045, 0.26, 6), c2, sx * 0.22, 0.08); h.rotation.z = -sx * 1.0; } } break;
    case 'pirate': add(C(0.3, 0.3, 0.05, 3), c, 0, 0.02).rotation.y = Math.PI; add(C(0.15, 0.17, 0.14), c, 0, 0.1); add(B(0.07, 0.07, 0.02), c2, 0, 0.1, -0.17); break;
    case 'crown': add(C(0.15, 0.15, 0.1, 8), c, 0, 0.05, 0, glow(0x3a2a00));
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(new THREE.ConeGeometry(0.035, 0.1, 4), c, Math.sin(a) * 0.14, 0.14, Math.cos(a) * 0.14, glow(0x3a2a00)); }
      add(S(0.03), c2, 0, 0.06, -0.15, glow(0x550000)); break;
    case 'duck': { const b = add(S(0.16), c, 0, 0.1); b.scale.set(1, 0.8, 1.15); add(S(0.1), c, 0, 0.26, -0.1); add(B(0.08, 0.035, 0.08), c2, 0, 0.25, -0.22); add(S(0.02), '#111111', 0.05, 0.29, -0.18); add(S(0.02), '#111111', -0.05, 0.29, -0.18); } break;
    case 'halo': { const t = add(new THREE.TorusGeometry(0.17, 0.025, 6, 16), c, 0, 0.22, 0, glow(0xfff3b0)); t.rotation.x = Math.PI / 2; } break;
    case 'propeller': add(C(0.17, 0.18, 0.09), c, 0, 0.02); add(C(0.012, 0.012, 0.1), '#333333', 0, 0.11);
      { const pr = new THREE.Group(); pr.position.y = 0.16; g.add(pr); for (const r of [0, Math.PI / 2]) { const bl = accMesh(B(0.42, 0.012, 0.06), c2); bl.rotation.y = r; pr.add(bl); } accAnim.prop = pr; } break;
    case 'banana': { const t = add(new THREE.TorusGeometry(0.24, 0.075, 6, 12, Math.PI * 0.85), c, 0, -0.05); t.rotation.set(0, Math.PI / 2, Math.PI * 0.075);
      add(C(0.03, 0.02, 0.06), c2, 0, 0.17, 0.21); } break;
    case 'beret': { const b = add(C(0.2, 0.17, 0.06, 12), c, 0.03, 0.02); b.rotation.z = -0.15; add(S(0.025), c2, 0.03, 0.06); } break;
    case 'wizard': add(C(0.3, 0.3, 0.025, 14), c, 0, 0); { const t = add(new THREE.ConeGeometry(0.16, 0.55, 10), c, 0, 0.28); t.rotation.z = 0.12; }
      for (const [x, y, z] of [[0.08, 0.12, -0.12], [-0.06, 0.25, -0.08], [0.03, 0.4, -0.05]]) add(new THREE.OctahedronGeometry(0.03, 0), c2, x, y, z, glow(0x664400)); break;
    case 'sombrero': add(C(0.42, 0.42, 0.03, 16), c, 0, 0); add(C(0.13, 0.17, 0.2, 10), c, 0, 0.1); add(C(0.172, 0.172, 0.04, 10), c2, 0, 0.03);
      add(new THREE.TorusGeometry(0.4, 0.02, 4, 20), c2, 0, 0.01).rotation.x = Math.PI / 2; break;
    case 'headphones': { const band = add(new THREE.TorusGeometry(0.17, 0.025, 5, 14, Math.PI), c, 0, -0.07); band.rotation.y = Math.PI / 2;
      for (const sx of [-1, 1]) { add(C(0.07, 0.07, 0.06, 10), c, sx * 0.17, -0.13).rotation.z = Math.PI / 2; add(C(0.055, 0.055, 0.062, 10), c2, sx * 0.172, -0.13).rotation.z = Math.PI / 2; } } break;
    case 'goldhelm': { const d = add(S(0.19, 10, 6, ), c, 0, -0.03, 0, glow(0x3a2a00)); d.scale.y = 0.75; add(B(0.05, 0.12, 0.34), c2, 0, 0.12, 0.02, glow(0x3a2a00)); } break;
    case 'peakcrown': add(C(0.16, 0.16, 0.08, 8), c, 0, 0.04, 0, glow(0x1a6a8a));
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, sp = add(new THREE.OctahedronGeometry(0.05, 0), i % 2 ? c2 : c, Math.sin(a) * 0.15, 0.15 + (i % 2) * 0.05, Math.cos(a) * 0.15, glow(0x1aa6b8)); sp.scale.y = 2.4; } break;
    case 'bunny': for (const sx of [-1, 1]) { const e = add(B(0.07, 0.34, 0.035), c, sx * 0.07, 0.17, 0.02); e.rotation.z = -sx * 0.18; const i = add(B(0.035, 0.26, 0.01), c2, sx * 0.07, 0.17, -0.0); i.rotation.z = -sx * 0.18; } break;
    case 'santahat': add(C(0.185, 0.185, 0.07, 12), c2, 0, 0.0); { const t = add(new THREE.ConeGeometry(0.16, 0.36, 10), c, 0.03, 0.2); t.rotation.z = -0.5; } add(S(0.05), c2, 0.19, 0.29); break;
    case 'elfhat': { const t = add(new THREE.ConeGeometry(0.17, 0.42, 8), c, 0, 0.2); t.rotation.x = 0.35; } add(C(0.18, 0.18, 0.05, 10), '#d62839', 0, 0.01); add(S(0.035), c2, 0, 0.38, 0.13); break;
    case 'antlers': for (const sx of [-1, 1]) {
        const a = add(B(0.035, 0.24, 0.035), c, sx * 0.1, 0.1, 0); a.rotation.z = -sx * 0.4;
        const b = add(B(0.035, 0.14, 0.035), c, sx * 0.19, 0.22, 0); b.rotation.z = -sx * 1.1;
        const d = add(B(0.035, 0.12, 0.035), c, sx * 0.13, 0.27, 0.03); d.rotation.z = sx * 0.2;
      } add(S(0.025), c2, 0.1, 0.02, -0.12); break;
    case 'ushanka': add(C(0.19, 0.19, 0.16, 10), c, 0, 0.06); add(C(0.2, 0.2, 0.05, 10), c2, 0, 0.0);
      for (const sx of [-1, 1]) add(B(0.05, 0.16, 0.18), c2, sx * 0.18, -0.08, 0); add(B(0.2, 0.06, 0.04), c2, 0, 0.05, -0.19); break;
    case 'bandana': add(C(0.165, 0.165, 0.07, 8), c, 0, 0.0); for (let i = 0; i < 5; i++) add(S(0.012), c2, Math.sin(i * 1.3) * 0.16, 0.0, Math.cos(i * 1.3) * 0.16);
      { const k = add(B(0.06, 0.12, 0.03), c, 0.05, -0.04, 0.18); k.rotation.z = 0.4; } break;
    case 'catears': for (const sx of [-1, 1]) { const e = add(new THREE.ConeGeometry(0.06, 0.13, 4), c, sx * 0.1, 0.06, 0); e.rotation.y = Math.PI / 4; const i = add(new THREE.ConeGeometry(0.035, 0.08, 4), c2, sx * 0.1, 0.05, -0.025); i.rotation.y = Math.PI / 4; } break;
    case 'mohawk': for (let i = 0; i < 6; i++) add(new THREE.ConeGeometry(0.03, 0.14 + Math.sin(i / 5 * Math.PI) * 0.06, 4), c, 0, 0.06, -0.12 + i * 0.05, glow(0x0a3a00)); break;
    case 'flowers': { const ring = add(new THREE.TorusGeometry(0.155, 0.02, 4, 16), c2, 0, 0.005); ring.rotation.x = Math.PI / 2;
      for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; add(S(0.035, 6, 4), i % 2 ? c : '#fff3b0', Math.sin(a) * 0.155, 0.02, Math.cos(a) * 0.155); } } break;
    case 'gradcap': add(C(0.16, 0.17, 0.08, 10), c, 0, 0.02); add(B(0.36, 0.025, 0.36), c, 0, 0.07); add(B(0.012, 0.14, 0.012), c2, 0.15, 0.0, -0.1); add(S(0.022), c2, 0, 0.09); break;
    case 'spikehelm': { const d = add(S(0.185, 10, 6), c, 0, -0.02); d.scale.y = 0.72; for (let i = 0; i < 5; i++) add(new THREE.ConeGeometry(0.025, 0.1, 4), c2, 0, 0.11 - Math.abs(i - 2) * 0.02, -0.12 + i * 0.06); } break;
    case 'unicorn': { const h = add(new THREE.ConeGeometry(0.045, 0.26, 8), '#ffd23f', 0, 0.11, -0.08, glow(0x553300)); h.rotation.x = -0.35;
      for (let i = 0; i < 5; i++) add(B(0.06, 0.05, 0.08), [c2, '#c77dff', '#4cc3ff', '#ffd23f', '#3ddc84'][i], 0, -0.02 - i * 0.02, 0.1 + i * 0.03); } break;
    // ---- face ----
    case 'starshades': for (const sx of [-1, 1]) { add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 5), c, sx * 0.075, 0.01, -0.012).rotation.x = Math.PI / 2; add(B(0.03, 0.012, 0.3), c2, sx * 0.152, 0.03, 0.14); } break;
    case 'visor': add(B(0.33, 0.06, 0.03), c, 0, 0.01, -0.012, glow(0x00a0b0)); add(B(0.335, 0.025, 0.33), c2, 0, 0.01, 0.15); break;
    case 'grin': add(B(0.11, 0.035, 0.015), c, 0, -0.085, -0.004); add(B(0.11, 0.01, 0.016), c2, 0, -0.1, -0.004); break;
    case 'bubblegum': { const b = add(S(0.06, 10, 8), c, 0, -0.08, -0.05); b.material.transparent = true; b.material.opacity = 0.9; } break;
    case 'monocle': add(new THREE.TorusGeometry(0.045, 0.01, 5, 14), c, 0.06, 0.01, -0.012); add(C(0.04, 0.04, 0.005, 12), c2, 0.06, 0.01, -0.012).rotation.x = Math.PI / 2;
      add(B(0.006, 0.12, 0.006), c, 0.1, -0.06, -0.012); break;
    case 'eyepatch': add(B(0.07, 0.06, 0.02), c, -0.06, 0.01, -0.012); { const st = add(B(0.33, 0.015, 0.33), c2, 0, 0.02, 0.15); st.rotation.z = 0.25; } break;
    case 'nerd': for (const sx of [-1, 1]) { add(B(0.12, 0.1, 0.012), c, sx * 0.07, 0.01, -0.01); add(B(0.09, 0.07, 0.014), c2, sx * 0.07, 0.01, -0.012); add(B(0.02, 0.015, 0.3), c, sx * 0.152, 0.03, 0.14); } break;
    case 'scarf': add(C(0.19, 0.19, 0.09, 8), c, 0, -0.16, 0.0); add(C(0.192, 0.192, 0.025, 8), c2, 0, -0.16, 0.0);
      { const tail = add(B(0.07, 0.22, 0.04), c, 0.08, -0.27, -0.16); tail.rotation.z = 0.15; } break;
    case 'rudolph': add(S(0.055), c, 0, -0.045, -0.03, { emissive: 0xff1010, emissiveIntensity: 1 }); break;
    case 'aviators': for (const sx of [-1, 1]) { add(B(0.12, 0.08, 0.025), c, sx * 0.07, 0.01, -0.012); add(B(0.04, 0.012, 0.3), c2, sx * 0.152, 0.03, 0.14); } add(B(0.06, 0.014, 0.02), c2, 0, 0.035, -0.012); break;
    case 'mustache': for (const sx of [-1, 1]) { const m = add(B(0.11, 0.035, 0.03), c, sx * 0.05, -0.08, -0.01); m.rotation.z = sx * 0.3; } break;
    case 'clown': add(S(0.055), c, 0, -0.04, -0.03); break;
    case 'hearts': for (const sx of [-1, 1]) { const h = add(B(0.085, 0.085, 0.025), c, sx * 0.075, 0.01, -0.012); h.rotation.z = Math.PI / 4; add(B(0.04, 0.012, 0.3), c, sx * 0.152, 0.03, 0.14); } break;
    case 'beard': add(B(0.27, 0.2, 0.1), c, 0, -0.15, 0.02); add(B(0.2, 0.12, 0.08), c, 0, -0.29, 0.02); break;
    case 'pixel': add(B(0.32, 0.07, 0.025), c, 0, 0.01, -0.012); for (const sx of [-1, 1]) { add(B(0.035, 0.035, 0.027), c2, sx * 0.09 - 0.02, 0.02, -0.014); add(B(0.03, 0.03, 0.3), c, sx * 0.155, 0.02, 0.14); } break;
    case 'mask': add(B(0.32, 0.09, 0.025), c, 0, 0.01, -0.01); add(B(0.33, 0.04, 0.33), c, 0, 0.01, 0.15); break;
    case 'lasers': { const lg = new THREE.Group(); g.add(lg); accAnim.lasers = lg;
      for (const sx of [-1, 1]) { const l = new THREE.Mesh(B(0.025, 0.025, 6), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 })); l.position.set(sx * 0.07, 0, -3); lg.add(l); add(S(0.025), c2, sx * 0.07, 0, -0.01, glow(0xff0000)); } } break;
    // ---- back ----
    case 'katana': { const k = new THREE.Group(); k.position.set(0, 0.02, 0.12); k.rotation.z = 0.7; g.add(k);
      k.add(accMesh(B(0.035, 0.72, 0.012), c, 0, 0.18, 0, { emissive: 0x223344 })); k.add(accMesh(B(0.12, 0.025, 0.04), '#ffd23f', 0, -0.19, 0)); k.add(accMesh(B(0.045, 0.22, 0.045), c2, 0, -0.32, 0)); } break;
    case 'balloons': for (const [x, y, z, col] of [[-0.12, 0.75, 0.2, c], [0.08, 0.85, 0.25, c2], [0.2, 0.7, 0.15, '#ffd23f']]) {
        add(S(0.11, 10, 8), col, x, y, z); const st = add(B(0.006, 0.6, 0.006), '#ffffff', x * 0.5, y - 0.4, z * 0.7); st.rotation.z = -x;
      } break;
    case 'boardback': { const b = add(B(0.3, 0.95, 0.04), c, 0, 0.0, 0.13); b.rotation.z = 0.15; const st = add(B(0.31, 0.06, 0.045), c2, 0, 0.15, 0.13); st.rotation.z = 0.15; } break;
    case 'quiver': { const q = add(C(0.07, 0.06, 0.42, 8), c, 0.08, 0.05, 0.13); q.rotation.z = -0.35;
      for (let i = 0; i < 3; i++) { const a = add(B(0.012, 0.3, 0.012), '#d9c7a7', 0.17 + i * 0.025, 0.32 + i * 0.01, 0.13 - i * 0.02); a.rotation.z = -0.35; add(new THREE.ConeGeometry(0.025, 0.06, 3), c2, 0.22 + i * 0.025, 0.47, 0.13 - i * 0.02).rotation.z = -0.35; } } break;
    case 'teddy': add(B(0.22, 0.24, 0.14), c, 0, -0.02, 0.17); add(B(0.17, 0.16, 0.13), c, 0, 0.18, 0.17); add(B(0.08, 0.06, 0.03), c2, 0, 0.16, 0.24);
      for (const sx of [-1, 1]) { add(S(0.04, 6, 4), c, sx * 0.08, 0.28, 0.17); add(B(0.06, 0.13, 0.07), c, sx * 0.14, 0.0, 0.2); add(S(0.012), '#111111', sx * 0.035, 0.2, 0.235); } break;
    case 'guitar': { const gt = new THREE.Group(); gt.position.set(0, -0.05, 0.1); gt.rotation.z = 0.5; g.add(gt);
      gt.add(accMesh(S(0.17, 10, 6), c, 0, -0.18, 0)); gt.add(accMesh(S(0.13, 10, 6), c, 0, 0.02, 0)); gt.children.forEach(m => m.scale.z = 0.35);
      gt.add(accMesh(C(0.04, 0.04, 0.012, 10), '#111111', 0, -0.1, -0.06));
      gt.add(accMesh(B(0.05, 0.5, 0.03), c2, 0, 0.35, 0)); gt.add(accMesh(B(0.08, 0.1, 0.035), '#3b2416', 0, 0.62, 0)); } break;
    case 'shield': { const sh = add(C(0.24, 0.24, 0.04, 6), c, 0, 0, 0.1); sh.rotation.x = Math.PI / 2; sh.scale.set(1, 1, 1.25);
      add(B(0.06, 0.4, 0.045), c2, 0, 0, 0.12); add(B(0.3, 0.06, 0.045), c2, 0, 0.05, 0.12); } break;
    case 'trophy': add(C(0.13, 0.06, 0.2, 10), c, 0, 0.08, 0.12, glow(0x3a2a00)); add(C(0.02, 0.02, 0.1, 6), c, 0, -0.06, 0.12, glow(0x3a2a00)); add(B(0.16, 0.06, 0.1), c2, 0, -0.13, 0.12);
      for (const sx of [-1, 1]) add(new THREE.TorusGeometry(0.05, 0.012, 4, 8), c, sx * 0.14, 0.1, 0.12, glow(0x3a2a00)); break;
    case 'giftsack': { const sk = add(S(0.24, 8, 6), c, 0, -0.02, 0.17); sk.scale.set(1, 1.15, 0.8); add(C(0.05, 0.08, 0.1, 6), c, 0, 0.26, 0.17); add(C(0.06, 0.06, 0.03, 6), c2, 0, 0.21, 0.17);
      add(B(0.12, 0.12, 0.12), '#2a9d4f', 0.04, 0.32, 0.17); add(B(0.1, 0.1, 0.1), '#ffd23f', -0.06, 0.3, 0.12); } break;
    case 'backpack': add(B(0.32, 0.38, 0.16), c, 0, 0, 0.06); add(B(0.33, 0.12, 0.17), c2, 0, 0.14, 0.06); break;
    case 'cape': { const cp = new THREE.Group(); cp.position.set(0, 0.2, 0.02); g.add(cp); const m = accMesh(B(0.46, 0.75, 0.02), c); m.position.y = -0.37; cp.add(m); accAnim.cape = cp; } break;
    case 'baguette': { const b = add(C(0.055, 0.05, 0.85, 7), c, 0, 0, 0.06); b.rotation.z = 0.7; for (let i = -1; i <= 1; i++) { const sl = add(B(0.02, 0.1, 0.02), c2, i * 0.18 * Math.cos(0.7), i * 0.18 * Math.sin(0.7), 0.11); sl.rotation.z = 0.7 + 0.9; } } break;
    case 'surfboard': { const b = add(B(0.28, 1.05, 0.04), c, 0, 0.05, 0.08); b.rotation.z = 0.25; const st = add(B(0.05, 1.0, 0.045), c2, 0, 0.05, 0.081); st.rotation.z = 0.25; } break;
    case 'wings': case 'dragon': {
      for (const sx of [-1, 1]) {
        const w = new THREE.Group(); w.position.set(sx * 0.08, 0.05, 0.06); g.add(w);
        const geo = it.id === 'wings' ? B(0.5, 0.26, 0.03) : new THREE.ConeGeometry(0.3, 0.6, 3);
        const m = accMesh(geo, c); m.position.x = sx * 0.28; m.rotation.z = it.id === 'wings' ? sx * 0.35 : sx * Math.PI / 2; w.add(m);
        const f = accMesh(B(0.3, 0.12, 0.031), c2); f.position.set(sx * 0.38, -0.12, 0); f.rotation.z = sx * 0.5; w.add(f);
        accAnim.wings.push({ g: w, sx });
      } } break;
    case 'jetpack': for (const sx of [-1, 1]) { add(C(0.07, 0.07, 0.38), c, sx * 0.09, 0, 0.08); add(new THREE.ConeGeometry(0.06, 0.1, 8), c2, sx * 0.09, -0.24, 0.08).rotation.x = Math.PI; } accAnim.jet = true; break;
    // ---- Agartha ----
    case 'crystal': {
      add(C(0.17, 0.18, 0.05, 8), c2, 0, 0, 0, glow(0x40105a));
      [[0, 0.2, -0.02, 0.09, 0.32], [-0.1, 0.12, -0.04, 0.06, 0.2], [0.1, 0.12, -0.04, 0.06, 0.2], [-0.06, 0.1, 0.1, 0.05, 0.16], [0.07, 0.1, 0.1, 0.05, 0.15]].forEach(([x, y, z, r, h], i) => {
        const cr = add(new THREE.OctahedronGeometry(r, 0), c, x, y, z, glow(0x1aa6b8)); cr.scale.y = h / r / 2; cr.rotation.z = x * 2.5; cr.rotation.y = i;
      });
      accAnim.crystal = g; } break;
    case 'thirdeye': { const e = add(new THREE.OctahedronGeometry(0.04, 0), c, 0, 0.07, -0.02, glow(0x1aa6b8)); e.scale.y = 1.4;
      const r = add(new THREE.TorusGeometry(0.05, 0.012, 4, 10), c2, 0, 0.07, -0.012, glow(0x553300)); } break;
    case 'innersun': {
      const sunG = new THREE.Group(); sunG.position.set(0, 0.12, 0.32); g.add(sunG);
      sunG.add(accMesh(S(0.15, 12, 8), c, 0, 0, 0, glow(0xffaa00)));
      const ring = accMesh(new THREE.TorusGeometry(0.28, 0.018, 6, 24), c2, 0, 0, 0, glow(0x1aa6b8)); sunG.add(ring);
      const ring2 = accMesh(new THREE.TorusGeometry(0.36, 0.01, 4, 24), c2, 0, 0, 0, glow(0x1aa6b8)); ring2.rotation.x = 1.2; sunG.add(ring2);
      for (let i = 0; i < 8; i++) { const ray = accMesh(new THREE.ConeGeometry(0.025, 0.12, 4), c, 0, 0, 0, glow(0xffaa00)); const a = i / 8 * TAU; ray.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0); ray.rotation.z = a - Math.PI / 2; sunG.add(ray); }
      accAnim.sun = sunG; } break;
    // ---- Halloween ----
    case 'pumpkinhead': {
      const pk = add(S(0.27, 12, 8), c, 0, -0.2, 0, glow(0x331400)); pk.scale.y = 0.85;
      for (let i = 0; i < 6; i++) { const rib = add(S(0.272, 12, 8), c, 0, -0.2, 0); rib.scale.set(0.35, 0.86, 1.01); rib.rotation.y = i / 6 * Math.PI; rib.material.color.offsetHSL(0, 0, -0.06); }
      add(C(0.03, 0.04, 0.1, 5), '#4a7a2a', 0, 0.05, 0);
      const face = new THREE.MeshBasicMaterial({ color: c2 });
      for (const sx of [-1, 1]) { const eye = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.06, 3), face); eye.position.set(sx * 0.09, -0.14, -0.25); eye.rotation.x = -Math.PI / 2; g.add(eye); }
      const mouth = new THREE.Mesh(B(0.2, 0.04, 0.03), face); mouth.position.set(0, -0.29, -0.235); g.add(mouth);
      for (const mx of [-0.05, 0.05]) { const t = new THREE.Mesh(B(0.03, 0.03, 0.031), new THREE.MeshLambertMaterial({ color: c })); t.position.set(mx, -0.275, -0.235); g.add(t); }
    } break;
    case 'witchhat': {
      add(C(0.34, 0.34, 0.025, 14), c, 0, 0); add(C(0.17, 0.17, 0.06, 10), c2, 0, 0.04);
      const t1 = add(new THREE.ConeGeometry(0.16, 0.34, 10), c, 0, 0.22); const t2 = add(new THREE.ConeGeometry(0.08, 0.22, 8), c, 0.06, 0.44, 0.02); t2.rotation.z = -0.6;
      add(B(0.07, 0.07, 0.02), '#ffd23f', 0, 0.04, -0.17); } break;
    case 'fangs': for (const sx of [-1, 1]) { const f = add(new THREE.ConeGeometry(0.018, 0.06, 4), c, sx * 0.04, -0.11, -0.01); f.rotation.x = Math.PI; } add(B(0.1, 0.012, 0.01), c2, 0, -0.085, -0.01); break;
    case 'batwings': for (const sx of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(sx * 0.08, 0.1, 0.06); g.add(w);
      const bone = accMesh(B(0.62, 0.03, 0.03), c); bone.position.x = sx * 0.3; bone.rotation.z = sx * 0.35; w.add(bone);
      for (let k = 0; k < 3; k++) { const m = accMesh(new THREE.ConeGeometry(0.12, 0.42, 3), c2); m.position.set(sx * (0.18 + k * 0.17), -0.12 + k * 0.05, 0); m.rotation.z = Math.PI + sx * 0.2; m.scale.z = 0.15; w.add(m); }
      accAnim.wings.push({ g: w, sx });
    } break;
    case 'scythe': { const sc = new THREE.Group(); sc.position.set(0, 0.05, 0.14); sc.rotation.z = -0.5; g.add(sc);
      sc.add(accMesh(C(0.025, 0.025, 1.5, 6), c2, 0, 0, 0));                 // handle, top end at y = 0.75
      sc.add(accMesh(C(0.04, 0.04, 0.08, 6), '#555f6a', 0, 0.72, 0));        // metal collar
      // curved blade: short tapering segments that hook out and down from the top of the handle
      const pts = [[0, 0.74], [-0.16, 0.8], [-0.32, 0.8], [-0.46, 0.74], [-0.57, 0.63], [-0.63, 0.5]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], len = Math.hypot(x1 - x0, y1 - y0);
        const seg = accMesh(B(len + 0.02, 0.11 * (1 - i / pts.length) + 0.025, 0.018), c, (x0 + x1) / 2, (y0 + y1) / 2 - 0.035, 0, { emissive: 0x223344 });
        seg.rotation.z = Math.atan2(y1 - y0, x1 - x0); sc.add(seg);
      }
    } break;
    // ---- Shabbat / traditional ----
    case 'kippah': { const k = add(new THREE.SphereGeometry(0.15, 12, 4, 0, TAU, 0, Math.PI / 2), c, 0, -0.035); k.scale.y = 0.45;
      const r = add(new THREE.TorusGeometry(0.11, 0.008, 4, 16), c2, 0, 0.0); r.rotation.x = Math.PI / 2; } break;
    case 'fedora': add(C(0.28, 0.28, 0.025, 14), c, 0, 0); add(C(0.15, 0.17, 0.17, 10), c, 0, 0.1); add(C(0.172, 0.172, 0.04, 10), c2, 0, 0.035);
      add(B(0.05, 0.02, 0.28), c, 0, 0.19, 0); break;
    case 'shtreimel': {
      add(C(0.15, 0.15, 0.13, 10), c2, 0, 0.07);   // velvet top
      for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, f = add(S(0.07, 6, 4), i % 2 ? c : '#6e4a28', Math.sin(a) * 0.2, 0.06, Math.cos(a) * 0.2); f.scale.set(1, 1.4, 1); }
    } break;
    case 'payot': for (const sx of [-1, 1]) for (let k = 0; k < 6; k++) {
      const a = k * 1.4; add(S(0.022, 5, 4), c, sx * (0.16 + Math.cos(a) * 0.015), -0.02 - k * 0.035, 0.1 + Math.sin(a) * 0.015);
    } break;
    case 'tallitshawl': {
      add(B(0.58, 0.46, 0.03), c, 0, 0.06, 0.02);
      for (const y of [0.22, 0.18, -0.1, -0.14]) add(B(0.59, 0.025, 0.032), c2, 0, y, 0.02);
      add(B(0.62, 0.05, 0.3), c, 0, 0.27, -0.12);   // over the shoulders
      for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) add(C(0.008, 0.008, 0.2, 3), c, sx * (0.25 + k * 0.012), -0.27, 0.03);
    } break;
  }
  return g;
}
// what the avatar is wearing: equipped items, unless the closet is previewing (trying on) something
let preview = null;
const worn = kind => preview?.[kind] ? item(kind, preview[kind]) : equipped(kind);
// face items that cover the eyes replace the goggles, so they're never hidden inside them
const EYE_ITEMS = new Set(['aviators', 'hearts', 'pixel', 'mask', 'lasers', 'thirdeye', 'monocle', 'eyepatch', 'nerd', 'starshades', 'visor']);
function applyAccessories() {
  accAnim.prop = accAnim.cape = accAnim.lasers = accAnim.sun = accAnim.crystal = null; accAnim.wings = []; accAnim.jet = false;
  for (const kind of ['hat', 'face', 'back']) {
    const slot = slots[kind]; slot.clear();
    const it = worn(kind);
    if (it && it.id !== 'none') slot.add(buildAccessory(kind, it));
  }
  const hat = worn('hat'), face = worn('face'), hasHat = !!hat && hat.id !== 'none';
  skier.helmet.visible = !hasHat; skier.hair.visible = hasHat;
  skier.goggles.visible = !hasHat && !EYE_ITEMS.has(face?.id);
  skier.head.visible = hat?.id !== 'pumpkinhead';
  slots.hat.position.y = hat?.id === 'pumpkinhead' ? 1.02 : 0.95;
}
function animateAccessories(dt) {
  if (accAnim.prop) accAnim.prop.rotation.y += dt * (8 + p.speed * 0.6);
  if (accAnim.sun) { accAnim.sun.rotation.z += dt * 1.5; accAnim.sun.children[1].rotation.y += dt * 2; }
  if (accAnim.crystal) accAnim.crystal.position.y = Math.sin(time * 3) * 0.015;
  if (accAnim.cape) accAnim.cape.rotation.x = clamp(0.25 + p.speed * 0.025, 0.2, 1.3) + Math.sin(time * 14) * 0.08;
  const flap = p.grounded ? 0.15 : Math.sin(time * 10) * 0.5;
  for (const w of accAnim.wings) w.g.rotation.y = -w.sx * (0.3 + flap);
  if (accAnim.jet && state === 'play' && !p.grounded && !p.grinding) {
    tmpV.set(0, -0.2, 0.25); slots.back.localToWorld(tmpV); world.worldToLocal(tmpV);
    Particles.emit(tmpV.x, tmpV.y, tmpV.z, 2, 0.3, 0.2, Math.random() < 0.5 ? 0xff7b00 : 0xffd60a, 3);
  }
}
// Pattern textures for themed outfits (painted on a small canvas, wrapped on every face of the jacket / legs)
const texCache = {};
function outfitTexture(kind, o) {
  const key = kind + o.id;
  if (texCache[key]) return texCache[key];
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const e = document.createElement('canvas'); e.width = e.height = S; const ge = e.getContext('2d');   // emissive (glow) layer
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  g.fillStyle = o.jacket; g.fillRect(0, 0, S, S);
  const both = (fn) => { fn(g); if (o.glow) fn(ge); };
  switch (kind) {
    case 'runes': both(k => { k.strokeStyle = o.glow; k.lineWidth = 3; k.beginPath();
      k.moveTo(8, 8); k.lineTo(32, 20); k.lineTo(56, 8); k.moveTo(32, 20); k.lineTo(32, 56); k.moveTo(14, 40); k.lineTo(32, 32); k.lineTo(50, 40); k.stroke();
      k.beginPath(); k.arc(32, 44, 6, 0, TAU); k.stroke(); }); break;
    case 'crystal': for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#1c8c84' : '#147570'; g.beginPath(); const x = (i % 3) * 22, y = Math.floor(i / 3) * 22; g.moveTo(x, y + 22); g.lineTo(x + 11, y); g.lineTo(x + 22, y + 22); g.fill(); }
      both(k => { k.strokeStyle = o.glow; k.lineWidth = 2; for (let i = 0; i < 3; i++) { k.beginPath(); k.moveTo(i * 22, 22 + i * 20); k.lineTo(i * 22 + 11, i * 20 + 2); k.stroke(); } }); break;
    case 'skeleton': g.fillStyle = '#f1f1f1'; g.fillRect(29, 4, 6, 56);
      for (let i = 0; i < 4; i++) { g.fillRect(10, 10 + i * 11, 44, 5); } g.fillStyle = o.jacket; g.fillRect(29, 46, 6, 2); break;
    case 'bones': g.fillStyle = '#f1f1f1'; g.fillRect(28, 0, 8, 64); g.beginPath(); g.arc(32, 32, 8, 0, TAU); g.fill(); break;
    case 'jack': both(k => { k.fillStyle = k === g ? '#111' : '#ffb000';
      k.beginPath(); k.moveTo(12, 26); k.lineTo(22, 12); k.lineTo(28, 26); k.fill(); k.beginPath(); k.moveTo(36, 26); k.lineTo(42, 12); k.lineTo(52, 26); k.fill();
      k.beginPath(); k.moveTo(10, 38); for (let i = 0; i <= 8; i++) k.lineTo(10 + i * 5.5, i % 2 ? 46 : 38); k.lineTo(54, 50); k.lineTo(10, 50); k.fill(); }); break;
    case 'vampire': g.fillStyle = '#b3001b'; g.beginPath(); g.moveTo(16, 0); g.lineTo(32, 40); g.lineTo(48, 0); g.fill();
      g.fillStyle = '#eee'; g.beginPath(); g.moveTo(24, 0); g.lineTo(32, 22); g.lineTo(40, 0); g.fill(); break;
    case 'suit': g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(20, 0); g.lineTo(32, 34); g.lineTo(44, 0); g.fill();
      g.fillStyle = '#111'; g.fillRect(30, 2, 4, 26); g.fillStyle = '#333'; g.fillRect(31, 40, 2, 2); g.fillRect(31, 50, 2, 2); break;
    case 'tallit': g.fillStyle = '#1d4ed8'; for (const y of [8, 16, 44, 52]) g.fillRect(0, y, S, 4); break;
    case 'ninja': g.fillStyle = '#d00000'; g.fillRect(0, 44, S, 7); g.fillStyle = '#333'; g.fillRect(0, 0, S, 3); break;
    case 'camo': for (let i = 0; i < 14; i++) { g.fillStyle = ['#e5e5e5', '#4a5560', '#7a8590'][i % 3]; g.beginPath(); g.ellipse((i * 37) % S, (i * 23) % S, 6 + (i % 4) * 3, 4 + (i % 3) * 3, i, 0, TAU); g.fill(); } break;
    case 'zebra': g.fillStyle = '#111'; for (let i = -2; i < 8; i++) { g.beginPath(); g.moveTo(i * 12, 0); g.lineTo(i * 12 + 7, 0); g.lineTo(i * 12 + 22, S); g.lineTo(i * 12 + 14, S); g.fill(); } break;
    case 'checker': g.fillStyle = '#fff'; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) g.fillRect(x * 16, y * 16, 16, 16); break;
    case 'dots': g.fillStyle = '#fff'; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc(x * 16 + 8 + (y % 2) * 8, y * 16 + 8, 4, 0, TAU); g.fill(); } break;
    case 'grid': both(k => { k.strokeStyle = o.glow; k.lineWidth = 2; for (let i = 0; i <= S; i += 16) { k.beginPath(); k.moveTo(i, 0); k.lineTo(i, S); k.moveTo(0, i); k.lineTo(S, i); k.stroke(); } }); break;
    case 'flames': both(k => { const grd = k.createLinearGradient(0, S, 0, 20); grd.addColorStop(0, '#ff4800'); grd.addColorStop(1, '#ffba08'); k.fillStyle = k === g ? grd : o.glow;
      k.beginPath(); k.moveTo(0, S); for (let x = 0; x <= S; x += 8) k.lineTo(x, x % 16 ? 34 : 20 + (x % 24)); k.lineTo(S, S); k.fill(); }); break;
    case 'astro': g.strokeStyle = '#b8c2cc'; g.lineWidth = 2; g.strokeRect(6, 6, 52, 52); g.fillStyle = '#1d70d6'; g.fillRect(40, 10, 14, 9);
      g.fillStyle = '#e63946'; g.fillRect(10, 12, 12, 4); g.fillStyle = '#ffd23f'; g.fillRect(22, 34, 20, 8); break;
  }
  const mk = cv => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t; };
  return (texCache[key] = { map: mk(c), emissiveMap: o.glow ? mk(e) : null });
}
function setPattern(m, tex, color, glowColor) {
  const map = tex ? tex.map : null, em = tex ? tex.emissiveMap : null;
  if (m.map !== map || m.emissiveMap !== em) { m.map = map; m.emissiveMap = em; m.needsUpdate = true; }
  m.color.set(map ? '#ffffff' : color);
  if (em) m.emissive.set(glowColor).multiplyScalar(1.2); else m.emissive.set('#000000');
}
const isBoard = () => save.gear === 'board';
function applyCosmetics(tryOn) {
  if (tryOn !== undefined) preview = tryOn;
  applyAccessories();
  skier.skis.visible = !isBoard(); skier.board.visible = isBoard();
  for (const pl of skier.poles) pl.visible = !isBoard();
  // sideways stance on a board
  skier.legs.rotation.y = skier.upper.rotation.y = isBoard() ? Math.PI / 2 : 0;
  skier.legs.scale.x = isBoard() ? 1.6 : 1;
  const o = worn('outfit'), k = worn('ski');
  setPattern(skinMats.jacket, o.tex ? outfitTexture(o.tex, o) : null, o.jacket, o.glow);
  setPattern(skinMats.pants, o.ptex ? outfitTexture(o.ptex, { ...o, jacket: o.pants, id: o.id + 'p', glow: null }) : null, o.pants);
  skinMats.helmet.color.set(o.helmet);
  skinMats.helmet.emissive.set(o.rarity === 'legendary' ? o.helmet : '#000000').multiplyScalar(0.35);
  if (k.color !== 'rainbow') skinMats.ski.color.set(k.color);
  skinMats.tip.color.set(k.tip);
  skinMats.ski.emissive.set(k.glow && k.color !== 'rainbow' ? k.color : '#000000').multiplyScalar(0.4);
}
const hsl = new THREE.Color();
function updateCosmetics() {
  if (worn('ski').color === 'rainbow') { skinMats.ski.color.setHSL((time * 0.25) % 1, 0.9, 0.55); skinMats.ski.emissive.copy(skinMats.ski.color).multiplyScalar(0.3); }
  // air trail
  const tr = worn('trail');
  if (tr.colors && !p.grounded && !p.grinding && !p.crashed && (state === 'play')) {
    const col = tr.colors === 'rainbow' ? hsl.setHSL((time * 0.8) % 1, 1, 0.6).getHex() : tr.colors[(Math.random() * tr.colors.length) | 0];
    Particles.emit(p.x, p.y + 0.5, p.z + 0.4, 2, 0.25, 0.6, col, 1);
  }
}

// ---------- item pictures: small 3D renders of every item (and whole looks) for the shop and locker ----------
// A copy of the rider with its own materials is dressed and photographed on a separate little renderer, so the
// main scene is never touched. Pictures are cached and made a few per frame, so opening the shop never stalls.
const Thumbs = (() => {
  const SIZE = 192, cache = new Map(), queue = [], waiting = new Set();
  let r = null, scene, cam, rig, mats, part, extra, failed = false;
  function init() {
    try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { failed = true; return; }
    r.setPixelRatio(1); r.setSize(SIZE, SIZE); r.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7f93ad, 1.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(-2, 4, -4); scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfe3ff, 1.2); rim.position.set(3, 2, 4); scene.add(rim);
    cam = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
    rig = skier.root.clone(true);
    mats = new Map();
    rig.traverse(o => { if (o.isMesh) { if (!mats.has(o.material)) mats.set(o.material, o.material.clone()); o.material = mats.get(o.material); } });
    rig.getObjectByName('leader-crown').visible = false;
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
    const body = rig.getObjectByName('body'); body.rotation.set(0, 0, 0); body.position.set(0, 0.9, 0);
    const up = rig.getObjectByName('upper'); up.rotation.set(0, 0, 0); rig.getObjectByName('legs').rotation.set(0, 0, 0);
    scene.add(rig);
    const n = k => rig.getObjectByName(k);
    part = { slots: { hat: n('slot-hat'), face: n('slot-face'), back: n('slot-back') }, head: n('head'), helmet: n('helmet'), goggles: n('goggles'), hair: n('hair'), skis: n('skis'), board: n('board'), upper: up, legs: n('legs') };
    extra = new THREE.Group(); scene.add(extra);
  }
  const m = orig => mats.get(orig);
  // put a whole look on the rig: { outfit, hat, face, back, ski } (missing pieces = the plain defaults)
  function dress(look) {
    const o = item('outfit', look.outfit || 'rookie'), k = item('ski', look.ski || 'navy');
    setPattern(m(skinMats.jacket), o.tex ? outfitTexture(o.tex, o) : null, o.jacket, o.glow);
    setPattern(m(skinMats.pants), o.ptex ? outfitTexture(o.ptex, { ...o, jacket: o.pants, id: o.id + 'p', glow: null }) : null, o.pants);
    m(skinMats.helmet).color.set(o.helmet);
    m(skinMats.ski).color.set(k.color === 'rainbow' ? '#ff4fd8' : k.color); m(skinMats.tip).color.set(k.tip);
    m(skinMats.ski).emissive.set(k.glow && k.color !== 'rainbow' ? k.color : '#000000').multiplyScalar(0.4);
    // building accessories registers their animations on the main rider: keep those as they were
    const saved = { ...accAnim, wings: accAnim.wings };
    for (const kind of ['hat', 'face', 'back']) {
      const slot = part.slots[kind]; slot.clear();
      const it = item(kind, look[kind] || 'none');
      if (it.id !== 'none') slot.add(buildAccessory(kind, it));
    }
    Object.assign(accAnim, saved);
    const hat = look.hat && look.hat !== 'none';
    part.helmet.visible = !hat; part.hair.visible = hat;
    part.goggles.visible = !hat && !EYE_ITEMS.has(look.face);
    part.head.visible = look.hat !== 'pumpkinhead';
    part.slots.hat.position.y = look.hat === 'pumpkinhead' ? 1.02 : 0.95;
    part.skis.visible = true; part.board.visible = false; part.upper.visible = part.legs.visible = true; rig.visible = true;
    extra.clear();
  }
  // a sweep of little glowing cubes in a trail's colours
  function trailArt(it) {
    rig.visible = false;
    const cols = it.colors === 'rainbow' ? ['#ff5a5a', '#ffb35a', '#ffe45a', '#5aff8a', '#5ac8ff', '#b05aff'] : it.colors;
    for (let i = 0; i < 26; i++) {
      const u = i / 25, c = new THREE.Mesh(box(0.16 - u * 0.08, 0.16 - u * 0.08, 0.16 - u * 0.08), new THREE.MeshLambertMaterial({ color: cols[i % cols.length], emissive: cols[i % cols.length], emissiveIntensity: 0.5 }));
      c.position.set(-0.9 + u * 1.8, 0.9 + Math.sin(u * Math.PI) * 0.7 + Math.sin(i * 2.1) * 0.08, Math.cos(i * 1.3) * 0.15);
      c.rotation.set(i, i * 0.7, 0); extra.add(c);
    }
  }
  const frame = (x, y, z, lx, ly, lz, fov = 28) => { cam.fov = fov; cam.updateProjectionMatrix(); cam.position.set(x, y, z); cam.lookAt(lx, ly, lz); };
  function shoot(key) {
    const [kind, id] = key.split(':');
    if (kind === 'fit') { const f = FITS.find(x => x.id === id); dress(f ? f.pieces : {}); frame(1.3, 1.55, -3.6, 0, 0.98, 0); }
    else if (kind === 'outfit') { dress({ outfit: id }); frame(1.3, 1.55, -3.6, 0, 0.98, 0); }
    else if (kind === 'hat') { dress({ hat: id }); frame(0.45, 1.85, -1.25, 0, 1.68, 0, 32); }
    else if (kind === 'face') { dress({ face: id }); frame(0.3, 1.58, -0.95, 0, 1.5, 0, 32); }
    else if (kind === 'back') { dress({ back: id }); frame(-1.1, 1.6, 2.6, 0, 1.2, 0, 30); }
    else if (kind === 'ski') { dress({ ski: id }); part.upper.visible = part.legs.visible = false; frame(1.5, 1.1, -1.4, 0, 0.0, -0.05, 34); }
    else if (kind === 'trail') { dress({}); trailArt(item('trail', id)); frame(0, 0.95, -3.4, 0, 1.05, 0); }
    r.render(scene, cam);
    return r.domElement.toDataURL('image/png');
  }
  function pump() {
    for (let n = 0; n < 4 && queue.length; n++) {
      const key = queue.shift(); waiting.delete(key);
      let url = null; try { url = shoot(key); } catch {}
      if (!url) continue;
      cache.set(key, url);
      document.querySelectorAll(`img[data-thumb="${key}"]`).forEach(img => { img.src = url; img.classList.add('ready'); });
    }
    if (queue.length) requestAnimationFrame(pump);
  }
  return {
    // the picture for "kind:id" (or "fit:id") if it's ready; otherwise it's queued and filled in when done.
    // Returns false if this device can't make pictures (the shop then falls back to colour swatches).
    get(key) {
      if (!r && !failed) init();
      if (failed) return false;
      if (cache.has(key)) return cache.get(key);
      if (!waiting.has(key)) { waiting.add(key); queue.push(key); if (queue.length === 1) requestAnimationFrame(pump); }
      return null;
    },
  };
})();

// ---------- 3D closet (Locker): a wardrobe set around the menu avatar ----------
const closet = (() => {
  const g = new THREE.Group(); g.visible = false;
  const wood = lam(0x8a5a35), dark = lam(0x5c3a20), metal = lam(0xc9d3dc);
  const put = (geo, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; g.add(o); return o; };
  put(new THREE.CylinderGeometry(1.7, 1.7, 0.05, 20), lam(0x9b2335), 0, 0.03, 0.2);                 // rug
  put(new THREE.CylinderGeometry(1.25, 1.25, 0.06, 20), lam(0xd9a441), 0, 0.045, 0.2);              // turntable
  put(box(4.6, 3.4, 0.16), wood, 0, 1.7, 1.75);                                                   // back
  for (const sx of [-1, 1]) {
    put(box(0.16, 3.4, 1.5), wood, sx * 2.3, 1.7, 1.05);                                          // sides
    const door = new THREE.Group(); door.position.set(sx * 2.3, 0, 0.3); door.rotation.y = sx * 1.0;   // swung open toward the camera g.add(door);
    const d = new THREE.Mesh(box(1.3, 3.2, 0.1), dark); d.position.set(sx * 0.65, 1.65, 0); door.add(d);
    if (sx > 0) { const mir = new THREE.Mesh(box(0.9, 2.4, 0.02), lam(0xbfe3f5, { emissive: 0x2a4a5a })); mir.position.set(0.65, 1.7, -0.06); door.add(mir); }
    else { const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), metal); knob.position.set(-1.15, 1.6, -0.08); door.add(knob); }
  }
  put(box(4.8, 0.22, 1.7), dark, 0, 3.45, 1.05);                                                  // top
  put(box(4.4, 0.08, 0.7), wood, 0, 2.95, 1.35);                                                  // hat shelf
  const rod = put(new THREE.CylinderGeometry(0.03, 0.03, 4.3, 6), metal, 0, 2.55, 1.2); rod.rotation.z = Math.PI / 2;
  // a few hanging jackets in catalog colours, either side of the avatar
  const fits = CATALOG.outfit.filter(o => o.rarity !== 'common').slice(0, 10);
  fits.forEach((o, i) => {
    const x = (i < 5 ? -2.05 + i * 0.22 : 1.15 + (i - 5) * 0.22);
    const hook = put(box(0.02, 0.18, 0.02), metal, x, 2.47, 1.2);
    const j = put(box(0.08, 0.7, 0.5), lam(o.jacket), x, 2.05, 1.2); j.rotation.z = (i % 2 ? 0.04 : -0.04);
  });
  // hat boxes and a couple of hats on the shelf
  [[-1.7, 0xff6b2c], [-1.2, 0x4cc3ff], [1.3, 0xc264ff], [1.8, 0x3ddc84]].forEach(([x, c]) => put(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 10), lam(c), x, 3.12, 1.35));
  put(new THREE.ConeGeometry(0.14, 0.4, 8), lam(0x2b1240), -0.4, 3.19, 1.35); put(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 12), lam(0x2b1240), -0.4, 3.0, 1.35);
  put(new THREE.SphereGeometry(0.17, 8, 6), lam(0xff7518), 0.4, 3.15, 1.35);
  // a warm lamp over the avatar
  const shade = put(new THREE.ConeGeometry(0.35, 0.3, 10, 1, true), lam(0xffd27a, { emissive: 0xffb347, side: THREE.DoubleSide }), 0, 3.15, 0.2);
  const light = new THREE.PointLight(0xffe2b0, 0, 9, 1.2); light.position.set(0, 2.9, -0.6); g.add(light);
  world.add(g);
  return { group: g, light, on: false, yaw: 0, dragging: false };
})();
function setCloset(on) {
  closet.on = on; closet.group.visible = on; closet.light.intensity = on ? 3 : 0; closet.yaw = 0;
  if (state === 'menu') { if (on) menuStill(); else startDemo(); }
  if (!on) applyCosmetics(null);
  setViewOffset(); snapCam = false;
}
// frame the avatar beside the Locker panel: to the left on wide screens, at the top on phones
function setViewOffset() {
  const W = innerWidth, H = innerHeight;
  if (!closet.on) camera.clearViewOffset();
  else if (W > 760) camera.setViewOffset(W, H, W * 0.22, 0, W, H);
  else camera.setViewOffset(W, H, 0, H * 0.27, W, H);
  // on phones only the top ~45% is free, so stand further back to fit the whole avatar there
  closet.dist = W > 760 ? 5.8 : 7.8;
  camera.updateProjectionMatrix();
}

// ---------- particles (snow spray / sparks / coin sparkle) ----------
const Particles = (() => {
  const N = 360;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3), life = new Float32Array(N);
  for (let i = 0; i < N; i++) pos[i * 3 + 1] = -9999;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  pts.frustumCulled = false;
  world.add(pts);
  let head = 0;
  const c = new THREE.Color();
  return {
    emit(x, y, z, n, spread, up, color, vz = 0) {
      if (LITE) n = Math.ceil(n * (LOW ? 0.35 : 0.6));
      c.set(color);
      for (let k = 0; k < n; k++) {
        const i = head; head = (head + 1) % N;
        pos[i * 3] = x + rand(-0.3, 0.3); pos[i * 3 + 1] = y; pos[i * 3 + 2] = z + rand(-0.3, 0.3);
        vel[i * 3] = rand(-spread, spread); vel[i * 3 + 1] = rand(up * 0.4, up); vel[i * 3 + 2] = vz + rand(-spread, spread);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        life[i] = rand(0.35, 0.8);
      }
    },
    update(dt) {
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { pos[i * 3 + 1] = -9999; continue; }
        vel[i * 3 + 1] -= 14 * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
})();

// falling snow around the camera
const Snowfall = (() => {
  const N = LOW ? 110 : LITE ? 220 : 500, R = 30;
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = rand(-R, R); pos[i * 3 + 1] = rand(-15, 15); pos[i * 3 + 2] = rand(-R, R); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.12, color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
  pts.frustumCulled = false; scene.add(pts);
  let vy = -3;
  return {
    style(kind) {
      vy = kind === 'spores' ? 0.9 : kind === 'heavy' ? -5 : -3;
      pts.material.color.set(kind === 'spores' ? 0x7cf7d4 : 0xffffff);
      pts.material.size = kind === 'spores' ? 0.16 : kind === 'heavy' ? 0.18 : 0.12;
    },
    update(dt, cam) {
      pts.position.copy(cam.position);
      for (let i = 0; i < N; i++) {
        pos[i * 3 + 1] += vy * dt; pos[i * 3] += Math.sin(time + i) * 0.4 * dt;
        if (pos[i * 3 + 1] < -15) pos[i * 3 + 1] += 30; else if (pos[i * 3 + 1] > 15) pos[i * 3 + 1] -= 30;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
})();

// ---------- ski tracks: grooves left in the snow behind you ----------
// A ring of samples along your path (every 0.5 m). Each sample draws a short quad per ski (one wide one on a
// board); samples taken in the air are invisible, so jumps leave a gap. Older track fades out.
const SkiTracks = (() => {
  const N = 240, STEP = 0.5, LINES = 2;
  const pos = new Float32Array(N * LINES * 2 * 3), col = new Float32Array(N * LINES * 2 * 4), idx = [];
  for (let i = 0; i < N - 1; i++) for (let l = 0; l < LINES; l++) {
    const a = (i * LINES + l) * 2, b = ((i + 1) * LINES + l) * 2;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mesh.frustumCulled = false; mesh.renderOrder = 1; world.add(mesh);
  const samples = []; let lastZ = Infinity;
  const tint = new THREE.Color(0x8fa9c2);
  return {
    clear() { samples.length = 0; lastZ = Infinity; this.rebuild(); },
    update() {
      if (lastZ - p.z < STEP) return;
      lastZ = p.z;
      const on = p.grounded && !p.crashed;
      const prev = samples[samples.length - 1];
      if (prev && Math.hypot(p.x - prev.x, p.z - prev.z) > 3) prev.on = false;   // respawned or teleported: don't bridge the gap
      samples.push({ x: p.x, y: p.y + 0.025, z: p.z, h: p.heading, on, board: isBoard() });
      if (samples.length > N) samples.shift();
      this.rebuild();
    },
    rebuild() {
      col.fill(0);
      for (let i = 0; i < samples.length; i++) {
        const sm = samples[i], rx = Math.cos(sm.h), rz = Math.sin(sm.h);   // sideways across the skis
        const fade = sm.on ? 0.55 * Math.min(1, i / 40) : 0;                 // oldest part fades out
        const lines = sm.board ? [[0, 0.2]] : [[-0.17, 0.065], [0.17, 0.065]];
        for (let l = 0; l < LINES; l++) {
          const [off, w] = lines[Math.min(l, lines.length - 1)], v = (i * LINES + l) * 2;
          const cx = sm.x + rx * off, cz = sm.z + rz * off;
          pos.set([cx - rx * w, sm.y, cz - rz * w, cx + rx * w, sm.y, cz + rz * w], v * 3);
          const a = sm.board && l === 1 ? 0 : fade;   // a board only uses the first line
          col.set([tint.r, tint.g, tint.b, a, tint.r, tint.g, tint.b, a], v * 4);
        }
      }
      // only the segments between real samples (unused slots would otherwise stretch a strip back to the start)
      geo.setDrawRange(0, Math.max(0, samples.length - 1) * LINES * 6);
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
})();

// ---------- crash debris: skis, poles, hat and a leg come off and tumble across the snow ----------
const Debris = (() => {
  const items = [], wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3(), inv = new THREE.Quaternion();
  const splatMat = new THREE.MeshBasicMaterial({ color: 0x9b111e, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  return {
    // copies `parts` (meshes sharing one parent on the rider) into a loose piece at the same spot and throws it
    throwParts(parts, vel, spin) {
      if (!parts.length) return;
      const parent = parts[0].parent;
      parent.updateWorldMatrix(true, false);
      parent.matrixWorld.decompose(wp, wq, ws);
      const g = new THREE.Group();
      world.worldToLocal(g.position.copy(wp));
      g.quaternion.copy(inv.copy(world.quaternion).invert().multiply(wq));
      g.scale.copy(ws);
      for (const m of parts) g.add(m.clone(true));
      world.add(g);
      items.push({ g, vel, spin, settled: false });
    },
    mark(x, z, r) {   // a single drop of the blood trail
      const [gh] = groundAt(x, z), m = new THREE.Mesh(new THREE.CircleGeometry(r, 7).rotateX(-Math.PI / 2), splatMat);
      m.position.set(x, gh + 0.03, z); m.scale.z = rand(0.7, 1.6); world.add(m); items.push({ g: m, settled: true });
    },
    splat(x, z) {
      const [gh] = groundAt(x, z);
      for (let i = 0; i < 12; i++) {
        const r = i ? rand(0.12, 0.38) : rand(1.1, 1.5), m = new THREE.Mesh(new THREE.CircleGeometry(r, 9).rotateX(-Math.PI / 2), splatMat);
        m.position.set(x + (i ? rand(-2.4, 2.4) : 0), gh + 0.03, z + (i ? rand(-3.2, 1.2) : 0)); m.scale.z = rand(0.6, 1.3);
        world.add(m); items.push({ g: m, settled: true });
      }
    },
    update(dt) {
      for (const d of items) {
        if (d.settled) continue;
        const g = d.g, v = d.vel;
        v.y -= G * dt;
        g.position.addScaledVector(v, dt);
        g.rotateX(d.spin.x * dt); g.rotateY(d.spin.y * dt); g.rotateZ(d.spin.z * dt);
        const [gh] = groundAt(g.position.x, g.position.z);
        if (g.position.y < gh + 0.06) {
          // bounce, skid and lose spin; lies still once it has run out of energy
          g.position.y = gh + 0.06; v.y = Math.abs(v.y) > 1.5 ? -v.y * 0.35 : 0; v.x *= 0.7; v.z *= 0.7; d.spin.multiplyScalar(0.55);
          if (Math.abs(v.y) < 0.1 && v.lengthSq() < 0.5) d.settled = true;
          if (Math.random() < 0.5) Particles.emit(g.position.x, gh + 0.1, g.position.z, 2, 1.5, 2, 0xffffff, 0);
        }
      }
    },
    clear() { for (const d of items) world.remove(d.g); items.length = 0; },
  };
})();

const fling = (up, side = 0) => new THREE.Vector3(p.vx * 0.5 + side + rand(-2.5, 2.5), up + rand(0, 3), -p.speed * 0.55 + rand(-3, 3));
const tumble = (k = 12) => new THREE.Vector3(rand(-k, k), rand(-k, k), rand(-k, k));
// the brutal part: everything loose flies off, and so does a leg
function breakRider() {
  skier.root.updateMatrixWorld(true);
  const sk = skier.skis.children, legs = skier.legs.children;
  if (isBoard()) Debris.throwParts([...skier.board.children], fling(7), tumble(10));
  else { Debris.throwParts([sk[0], sk[1]], fling(6, -2), tumble(14)); Debris.throwParts([sk[2], sk[3]], fling(8, 2), tumble(14)); }
  for (const pl of skier.poles) if (pl.visible) Debris.throwParts([pl], fling(9), tumble(16));
  if (slots.hat.children.length) Debris.throwParts([...slots.hat.children], fling(11), tumble(9));
  Debris.throwParts([legs[2], legs[3]], fling(10, 1.5), tumble(15));
  const arm = skier.arms[1];
  Debris.throwParts(arm.children.filter(m => !skier.poles.includes(m)), fling(12, -1.5), tumble(18));
  skier.skis.visible = skier.board.visible = slots.hat.visible = legs[2].visible = legs[3].visible = arm.visible = false;
  for (const pl of skier.poles) pl.visible = false;
  // cartoon gore: a red burst from the hip and a splat on the snow
  Particles.emit(p.x, p.y + 0.6, p.z, 45, 4.5, 7, 0xc1121f, -3);
  Particles.emit(p.x, p.y + 1.1, p.z, 25, 3.5, 6, 0x6a040f, -2);
  Debris.splat(p.x, p.z - 1.5);
  p.bleedZ = p.z;
  // bone crunch, and the screen flashes red
  Sfx.noise(0.08, 1, 3000, 'highpass'); Sfx.noise(0.12, 0.9, 900); Sfx.tone(55, 0.6, 'square', 0.2, 28, 0.05);
  const hurt = $('hurt'); hurt.classList.remove('on'); void hurt.offsetWidth; hurt.classList.add('on');
}
function fixRider() {
  const legs = skier.legs.children;
  legs[2].visible = legs[3].visible = slots.hat.visible = skier.arms[1].visible = true;
  applyCosmetics();   // puts the skis/board and poles back
}

// ---------- world content ----------
let ramps = [], rails = [], obstacles = [], coins = [], decor = [], crevasses = [], gates = [], movers = [], pads = [];
let shapes = [];        // smooth terrain: rollers, tabletops (height profile along z)
let checkpoints = [];   // race only: [{x, z, w}] known up front so hazards can avoid them
let spawnZ = 0, decorZ = 0, finish = null;

// Course generation uses its own RNG so the Daily Race is identical for every player.
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
let crng = Math.random;
const wr = (a, b) => a + crng() * (b - a);

const logMat = lam(0x7a5230), capMat = lam(0xf5f9fc), crevMat = lam(0x0e2a47), iceMat = lam(0x9fd3f2);
const gateMats = [lam(0xe63946), lam(0x1d70d6)], bannerMat = lam(0xffffff);
const ballGeo = new THREE.IcosahedronGeometry(1.15, 1);
const finishTex = (() => {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64; const g = c.getContext('2d');
  for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 16, j * 16, 16, 16); }
  g.fillStyle = '#ff5a1f'; g.fillRect(150, 6, 212, 52); g.fillStyle = '#fff'; g.font = '900 44px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('FINISH', 256, 48);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

function addRamp(x, z0, L, H, W, pro = false) {
  L = Math.round(L * 2) / 2; H = Math.round(H * 4) / 4;
  const g = new THREE.Group(); g.position.set(x, 0, z0);
  g.add(new THREE.Mesh(rampGeo(L, H, W), mat.ramp));
  const lip = new THREE.Mesh(box(W + 0.05, 0.1, 0.35), mat.rampEdge); lip.position.set(0, H - 0.02, -L + 0.15); g.add(lip);
  for (const sx of [-1, 1]) { const st = new THREE.Mesh(box(0.12, 0.12, L * 0.9), mat.rampEdge); st.position.set(sx * W / 2, H * 0.35, -L * 0.62); st.rotation.x = Math.atan(H / L) * 1.2; g.add(st); }
  if (pro) {   // the big line: black-and-gold flags on both sides
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(box(0.1, 3.2, 0.1), mat.railPost); pole.position.set(sx * (W / 2 + 0.6), 1.6, -L + 0.5); g.add(pole);
      const flag = new THREE.Mesh(box(0.06, 0.9, 1.4), proFlagMat); flag.position.set(sx * (W / 2 + 0.6), 2.8, -L + 1); g.add(flag);
    }
  }
  world.add(g);
  ramps.push({ x, z0, L, H, W, pro, mesh: g });
  keepClear(x, W / 2 + 1, z0 + 20, z0 - L - 2);
}
// a rail; with a drop it runs downhill from `top` at the start to `top - drop` at the end
function addRail(x, z0, L, top = 0.9, drop = 0) {
  const g = new THREE.Group(); g.position.set(x, 0, z0);
  const bar = new THREE.Mesh(box(0.16, 0.14, Math.hypot(L, drop)), mat.rail); bar.position.set(0, top - drop / 2, -L / 2); bar.rotation.x = -Math.atan2(drop, L); g.add(bar);
  for (const pz of [-0.4, -L / 2, -L + 0.4]) { const h = top + drop * pz / L; const p = new THREE.Mesh(box(0.1, h, 0.1), mat.railPost); p.position.set(0, h / 2, pz); g.add(p); }
  world.add(g);
  rails.push({ x, z0, L, top, drop, mesh: g });
  keepClear(x, 1.8, z0 + 24, z0 - L - 3);
}
const blocked = (x, z, pad = 1.5) => checkpoints.some(c => Math.abs(z - c.z) < 5 && Math.abs(x - c.x) < c.w / 2 + pad);
// A smooth, always-steerable lane that hazards can't fill, so every section has a way through.
let laneSeed = [0, 0];
const laneX = z => clamp(Math.sin(z * 0.02 + laneSeed[0]) * 7 + Math.sin(z * 0.05 + laneSeed[1]) * 2.5, -X_LIMIT + 2.5, X_LIMIT - 2.5);
const inLane = (x, z, r = 0.6) => Math.abs(x - laneX(z)) < 2.2 + r;
// The run-up to rails, kickers, cave mouths and the exit portal stays free of rocks, crystals, presents and trees:
// whatever is already there is removed, and nothing new is placed there afterwards.
const CLEARABLE = new Set(['rock', 'crystal', 'gift', 'tree']);
let approaches = [];   // { x, hw, zTop, zBot }
const inApproach = (x, z, r) => approaches.some(a => z < a.zTop && z > a.zBot && Math.abs(x - a.x) < a.hw + r);
function keepClear(x, hw, zTop, zBot) {
  approaches.push({ x, hw, zTop, zBot });
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    if (!o.pool || !CLEARABLE.has(o.kind) || o.z >= zTop || o.z <= zBot || Math.abs(o.x - x) >= hw + o.r) continue;
    o.pool.remove(o.idx); obstacles.splice(i, 1);
  }
}
function addTree(x, z, s, obstacle, ry = rand(0, 6), variant = 0) {
  if (obstacle) { x = clamp(x, -X_LIMIT + 0.5, X_LIMIT - 0.5); if (blocked(x, z) || inLane(x, z, 0.55 * s) || inApproach(x, z, 0.55 * s)) return; }
  const pool = zone === 'xmas' ? xmasTrees : !obstacle && zone === 'normal' ? sceneryTrees[variant % 2] : trees;
  // A small buried base follows the faceted hillside without leaving trunks hanging above it.
  const idx = pool.add(x, obstacle ? 0 : Math.max(0, wallH(x, z) - 0.18), z, s, ry);
  if (obstacle) obstacles.push({ kind: 'tree', x, z, r: 0.55 * s, h: 3.8 * s, idx, pool });
  else decor.push({ z, idx, pool });
}
function addRock(x, z, s) {
  x = clamp(x, -X_LIMIT + 0.5, X_LIMIT - 0.5); if (blocked(x, z) || inLane(x, z, s) || inApproach(x, z, s)) return;
  if (zone === 'agartha') {
    const idx = crystals.add(x, 0, z, s * 1.1, rand(0, 6), s * 1.5);
    obstacles.push({ kind: 'crystal', x, z, r: 0.75 * s, h: 3 * s, idx, pool: crystals });
    return;
  }
  if (zone === 'xmas') {   // giant presents instead of rocks
    const pool = Math.random() < 0.5 ? giftsRed : giftsGreen, idx = pool.add(x, 0, z, s * 1.1, rand(0, 6));
    obstacles.push({ kind: 'gift', x, z, r: 0.95 * s, h: 1.9 * s, idx, pool });
    return;
  }
  const idx = rocks.add(x, 0.15 * s, z, s, rand(0, 6));
  obstacles.push({ kind: 'rock', x, z, r: 1.0 * s, h: 1.0 * s, idx, pool: rocks });
}
function addLog(x, z, hw) {
  if (blocked(x, z, hw)) return;
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, hw * 2, 7), logMat); log.rotation.z = Math.PI / 2; log.position.y = 0.3; g.add(log);
  const cap = new THREE.Mesh(box(hw * 2 - 0.2, 0.1, 0.4), capMat); cap.position.y = 0.62; g.add(cap);
  world.add(g);
  obstacles.push({ kind: 'log', x, z, hw, r: 0.4, h: 0.45, mesh: g });   // forgiving: any hop clears it
}
function addBall(z) {
  if (checkpoints.some(c => Math.abs(z - c.z) < 6)) return;
  const m = new THREE.Mesh(ballGeo, mat.snow); m.position.set(0, 1.15, z); world.add(m);
  const o = { kind: 'ball', x: wr(-10, 10), z, r: 1.15, h: 2.3, vx: (crng() < 0.5 ? -1 : 1) * wr(5, 8), mesh: m };
  obstacles.push(o); movers.push(o);
}
// ---------- crevasse: an icy chasm with jagged edges, snow lips and warning tape ----------
const crevTex = (() => {
  // looking down into it: pale ice at the lips fading to a dark blue depth, with cracks running down
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#bfeaff'); gr.addColorStop(0.12, '#4aa3d8'); gr.addColorStop(0.3, '#123a66'); gr.addColorStop(0.5, '#050f22');
  gr.addColorStop(0.7, '#123a66'); gr.addColorStop(0.88, '#4aa3d8'); gr.addColorStop(1, '#bfeaff');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 256);
  g.strokeStyle = 'rgba(190,235,255,.35)'; g.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) {
    let x = Math.random() * 128, y = Math.random() < 0.5 ? 0 : 256; const dir = y ? -1 : 1;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 14; y += dir * (8 + Math.random() * 12); g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const crevHoleMat = new THREE.MeshBasicMaterial({ map: crevTex });
const crevMist = new THREE.MeshBasicMaterial({ map: glowTex, color: 0x7fd8ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
const toothColors = [0xbfeaff, 0x8fd0f0, 0xeaf8ff], toothGeo = new THREE.ConeGeometry(0.32, 1, 4);
const toothMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x0e2a3d });
const tapeTex = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 16; const g = c.getContext('2d');
  for (let i = -16; i < 128; i += 16) { g.fillStyle = (i / 16) % 2 ? '#ffffff' : '#e63946'; g.beginPath(); g.moveTo(i, 16); g.lineTo(i + 8, 0); g.lineTo(i + 16, 0); g.lineTo(i + 8, 16); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const tapeMat = new THREE.MeshBasicMaterial({ map: tapeTex, side: THREE.DoubleSide });
const warnTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#ffd60a'; g.beginPath(); g.moveTo(32, 4); g.lineTo(62, 58); g.lineTo(2, 58); g.fill();
  g.strokeStyle = '#111'; g.lineWidth = 4; g.stroke(); g.fillStyle = '#111'; g.fillRect(29, 20, 6, 22); g.fillRect(29, 46, 6, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const warnMat = new THREE.MeshBasicMaterial({ map: warnTex, transparent: true, side: THREE.DoubleSide });
function addCrevasse(z0, L) {
  const g = new THREE.Group(); g.position.set(0, 0, z0);
  const hole = new THREE.Mesh(box(31, 0.05, L), [crevMat, crevMat, crevHoleMat, crevMat, crevMat, crevMat]); hole.position.set(0, 0.03, -L / 2); g.add(hole);
  const mist = new THREE.Mesh(new THREE.PlaneGeometry(31, L).rotateX(-Math.PI / 2), crevMist); mist.position.set(0, 0.25, -L / 2); g.add(mist);
  // a snow lip overhanging each edge, with jagged ice teeth leaning out over the drop (all teeth in one mesh)
  const teeth = [], q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  for (const [ez, toward] of [[0, -1], [-L, 1]]) {
    const lip = new THREE.Mesh(box(31, 0.28, 0.9), capMat); lip.position.set(0, 0.12, ez + toward * 0.15); g.add(lip);
    for (let x = -15.2; x < 15.5; x += rand(0.6, 1.1)) {
      const h = rand(0.4, 1.4);
      q.setFromEuler(e.set(toward * rand(0.25, 0.6), rand(0, 3), rand(-0.25, 0.25)));
      teeth.push({ geo: toothGeo, color: toothColors[(Math.random() * 3) | 0], m: new THREE.Matrix4().compose(v.set(x, h / 2 + 0.1, ez + toward * rand(0.2, 0.55)), q, sc.set(rand(0.7, 1.3), h, rand(0.7, 1.3))) });
    }
  }
  const teethGeo = merged(teeth); g.add(new THREE.Mesh(teethGeo, toothMat));
  // warning poles with striped tape along the edge, just outside the run
  for (const sx of [-1, 1]) {
    for (const pz of [7, 0.6]) { const pole = new THREE.Mesh(box(0.12, 1.4, 0.12), gateMats[0]); pole.position.set(sx * 14.2, 0.7, pz); g.add(pole); }
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.22), tapeMat); tape.rotation.y = Math.PI / 2; tape.position.set(sx * 14.2, 1.2, 3.8); g.add(tape);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), warnMat); sign.position.set(sx * 14.2, 1.95, 7.06); g.add(sign);
  }
  world.add(g);
  crevasses.push({ z0, L, mesh: g, passed: false, dispose: teethGeo });
}
function addCoin(x, y, z) {
  const gold = mode !== 'race' && Math.random() < 0.025;
  const pool = gold ? goldCoinPool : coinPool, idx = pool.add(x, y, z, gold ? 1.5 : 1);
  if (idx >= 0) coins.push({ x, y, z, idx, taken: false, pool, gold });
}
function addGate(x, z, w = 6) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const m = gateMats[gates.length % 2];
  for (const sx of [-1, 1]) { const pole = new THREE.Mesh(box(0.14, 2.4, 0.14), m); pole.position.set(sx * w / 2, 1.2, 0); g.add(pole); }
  const ban = new THREE.Mesh(box(w, 0.45, 0.05), m); ban.position.y = 2.25; g.add(ban);
  world.add(g);
  gates.push({ x, z, w, mesh: g, passed: false });
}
function addFinish(z) {
  const g = new THREE.Group(); g.position.set(0, 0, z);
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(box(0.4, 6, 0.4), gateMats[0]); p.position.set(sx * 14, 3, 0); g.add(p); }
  const b = new THREE.Mesh(new THREE.BoxGeometry(28, 3.2, 0.2), [bannerMat, bannerMat, bannerMat, bannerMat, new THREE.MeshBasicMaterial({ map: finishTex }), new THREE.MeshBasicMaterial({ map: finishTex })]);
  b.position.y = 5.2; g.add(b);
  const line = new THREE.Mesh(box(28, 0.03, 0.8), new THREE.MeshBasicMaterial({ map: finishTex })); line.position.y = 0.02; g.add(line);
  world.add(g);
  finish = { z, mesh: g };
}

// ---------- smooth terrain ----------
function shapeGeo(L, W, fn, seg = 28) {
  const pos = [], hw = W / 2;
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg, z0 = -t0 * L, z1 = -t1 * L, y0 = fn(t0)[0], y1 = fn(t1)[0];
    quad([-hw, y0, z0], [hw, y0, z0], [hw, y1, z1], [-hw, y1, z1]);
    quad([-hw, 0, z0], [-hw, y0, z0], [-hw, y1, z1], [-hw, 0, z1]);
    quad([hw, 0, z1], [hw, y1, z1], [hw, y0, z0], [hw, 0, z0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
const tableMat = lam(0xeaf2f8), tableEdge = lam(0x3a86ff);
function addShape(x, z0, L, W, fn, material, edges) {
  const m = new THREE.Mesh(shapeGeo(L, W, fn), material); m.position.set(x, 0, z0);
  if (edges) for (const sx of [-1, 1]) { const e = new THREE.Mesh(box(0.14, 0.14, L), tableEdge); e.position.set(sx * W / 2, 0.05, -L / 2); m.add(e); }
  world.add(m);
  shapes.push({ x, z0, L, W, fn, mesh: m });
}
// bump: smooth hill, h = H·sin²(πt)
const bump = H => t => [H * Math.sin(Math.PI * t) ** 2, H * Math.PI * Math.sin(2 * Math.PI * t)];
// tabletop: curved take-off → flat deck → long landing slope (landing on the slope keeps your speed)
const table = (H, a = 0.24, b = 0.5) => t => t < a ? [H * (t / a) ** 2, 2 * H * (t / a) / a]
  : t < b ? [H, 0] : [H * (1 - (t - b) / (1 - b)), -H / (1 - b)];

// ---------- pads: boost strips and trampolines ----------
const padMats = {
  boostBase: lam(0x1b2333), boostEdge: lam(0x22d3ee, { emissive: 0x22d3ee, emissiveIntensity: 0.9 }),
  // one material per chevron row: they light up back-to-front in turn, so the strip looks like it's flowing downhill
  chev: [0, 1, 2].map(() => lam(0x9bf6ff, { emissive: 0x22d3ee, emissiveIntensity: 0.3 })),
  frame: lam(0xffc93c), spring: lam(0xc9d3dc), leg: lam(0x3b4a5a),
};
const trampTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#1b1f3b'; g.fillRect(0, 0, 128, 128);
  for (const [r, col] of [[60, '#ff2d78'], [46, '#1b1f3b'], [36, '#ffc93c'], [24, '#1b1f3b']]) { g.fillStyle = col; g.beginPath(); g.arc(64, 64, r, 0, TAU); g.fill(); }
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(64, 34); g.lineTo(88, 62); g.lineTo(74, 62); g.lineTo(74, 92); g.lineTo(54, 92); g.lineTo(54, 62); g.lineTo(40, 62); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const trampTop = new THREE.MeshLambertMaterial({ map: trampTex });
// an upward chevron "^" in the plane facing the camera
function chevron(material, w = 0.9, t = 0.14) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(box(w, t, 0.03), material); arm.position.set(sx * w * 0.38, 0, 0); arm.rotation.z = -sx * 0.62; g.add(arm); }
  return g;
}
function addPad(kind, x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const pad = { kind, x, z, r: kind === 'bounce' ? 2.3 : 1.6, len: kind === 'bounce' ? 2.6 : 2.5, mesh: g, used: false, squash: 0 };
  if (kind === 'bounce') {
    // trampoline: legs, yellow frame, springs and a target mat with an up arrow
    const H = 0.32;
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU, l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, H, 5), padMats.leg); l.position.set(Math.cos(a) * 1.8, H / 2, Math.sin(a) * 1.8); g.add(l); }
    const fr = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.13, 6, 18), padMats.frame); fr.rotation.x = Math.PI / 2; fr.position.y = H; g.add(fr);
    for (let i = 0; i < 18; i++) { const a = i / 18 * TAU, sp = new THREE.Mesh(box(0.38, 0.04, 0.05), padMats.spring); sp.position.set(Math.cos(a) * 1.55, H, Math.sin(a) * 1.55); sp.rotation.y = -a; g.add(sp); }
    const mat = new THREE.Mesh(new THREE.CylinderGeometry(1.38, 1.38, 0.05, 20), [padMats.leg, trampTop, padMats.leg]); mat.position.y = H - 0.02; mat.rotation.y = Math.PI / 2; g.add(mat);
    // floating arrows that rise and fade above it
    pad.holo = [0, 1, 2].map(k => {
      const m = new THREE.MeshBasicMaterial({ color: 0xff4d8d, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const c = chevron(m, 1.1, 0.16); g.add(c); return { c, m, k };
    });
    pad.mat = mat;
  } else {
    // boost strip: dark base, glowing edges, three chevrons pointing downhill
    const base = new THREE.Mesh(box(3.2, 0.07, 5), padMats.boostBase); base.position.y = 0.035; g.add(base);
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(box(0.16, 0.1, 5), padMats.boostEdge); e.position.set(sx * 1.6, 0.05, 0); g.add(e); }
    [1.6, 0, -1.6].forEach((cz, row) => {
      for (const sx of [-1, 1]) {
        // the arms meet at the front (downhill, -z), so the arrow points the way you're going
        const c = new THREE.Mesh(box(1.25, 0.06, 0.34), padMats.chev[row]); c.position.set(sx * 0.46, 0.09, cz); c.rotation.y = -sx * 0.6; g.add(c);
      }
    });
  }
  world.add(g);
  pads.push(pad);
}
function updatePads(dt) {
  padMats.chev.forEach((m, row) => { m.emissiveIntensity = 0.25 + 1.4 * Math.max(0, Math.sin(time * 9 - row * 1.3)); });
  for (const q of pads) {
    if (q.kind !== 'bounce') continue;
    for (const h of q.holo) { const u = (time * 0.7 + h.k / 3) % 1; h.c.position.y = 0.8 + u * 2.6; h.m.opacity = Math.sin(u * Math.PI) * 0.7; }
    if (q.squash > 0) { q.squash = Math.max(0, q.squash - dt * 3); const k = Math.sin(q.squash * Math.PI * 3) * q.squash; q.mat.position.y = 0.3 - k * 0.25; q.mat.scale.set(1 + k * 0.08, 1, 1 + k * 0.08); }
  }
}
const archMat = lam(0x6b4a2f), archBanner = lam(0xff6b2c);
function cpTexture(n) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
  g.fillStyle = '#ff6b2c'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#fff'; g.font = '900 54px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(`CHECKPOINT ${n}`, 256, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function addCheckpointArch(cp, n) {
  const g = new THREE.Group(); g.position.set(cp.x, 0, cp.z);
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 5, 6), archMat); p.position.set(sx * cp.w / 2, 2.5, 0); g.add(p);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.6, 6), mat.snow); cap.position.set(sx * cp.w / 2, 5.25, 0); g.add(cap);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, cp.w + 0.6, 6), archMat); beam.rotation.z = Math.PI / 2; beam.position.y = 4.7; g.add(beam);
  const tex = new THREE.MeshBasicMaterial({ map: cpTexture(n) });
  const ban = new THREE.Mesh(new THREE.BoxGeometry(Math.min(cp.w - 0.6, 6.4), 1.2, 0.08), [archBanner, archBanner, archBanner, archBanner, tex, tex]); ban.position.y = 3.9; g.add(ban);
  world.add(g);
  gates.push({ ...cp, n, mesh: g, passed: false });
}

// predicted hang time off a kicker (matches the in-game physics closely enough for coin arcs)
function lipSpeed(sp, H) { return Math.sqrt(Math.max(64, sp * sp - 2 * 0.35 * G * H)); }
function airTime(sp, H, L) {
  const v = lipSpeed(sp, H), vy = v * 2 * H / L, up = vy / G, apex = H + vy * vy / (2 * G);
  return up + Math.sqrt(2 * apex / (G * 1.15));
}
function arcY(sp, H, L, t) {
  const v = lipSpeed(sp, H), vy = v * 2 * H / L, up = vy / G;
  if (t < up) return H + vy * t - G * t * t / 2;
  const apex = H + vy * vy / (2 * G), f = t - up;
  return apex - G * 1.15 * f * f / 2;
}

// Each feature returns [length consumed, x the race gate should sit at]
function featureRamp(z, big, sp) {
  const L = big ? wr(10, 12) : wr(6, 8), H = big ? wr(3.6, 4.6) : wr(1.9, 2.7), W = big ? 7 : 5;
  const x = wr(-8, 8);
  addRamp(x, z, L, H, W);
  const at = airTime(sp, H, L), ls = lipSpeed(sp, H);
  if (crng() < 0.75) for (let i = 1; i < 7; i++) {
    const t = at * i / 7;
    addCoin(x, arcY(sp, H, L, t) + 1.2, z - L - ls * t);
  }
  if (!big && crng() < 0.35) {
    const x2 = x > 0 ? x - wr(8, 12) : x + wr(8, 12);
    if (Math.abs(x2) < 12) addRamp(x2, z - wr(-4, 4), wr(6, 8), wr(1.9, 2.7), 5);
  }
  return [L + ls * at + 22, x];
}
function featureRail(z, sp, withKicker) {
  const x = wr(-7, 7), L = wr(12, 22);
  addRail(x, z, L);
  for (let i = 1; i < L / 3; i++) addCoin(x, 2.2, z - i * 3);
  let len = L + 20;
  if (withKicker) { addRamp(x, z - L - 12, 7, 2.25, 5); len += 12 + 7 + sp * airTime(sp, 2.25, 7); }
  return [len, x];
}
// kicker straight onto a long down rail: land on it and slide
function featureGapRail(z, sp) {
  const x = wr(-6, 6), L = 34;
  addRamp(x, z, 6, 1.5, 4);
  addRail(x, z - 9, L, 2, 1.1);
  for (let i = 1; i < L / 3; i++) addCoin(x, 3.2 - 1.1 * i * 3 / L, z - 9 - i * 3);
  return [6 + 9 + L + 20, x];
}
// three staggered rails side by side: jump off one sideways (jump + steer) onto the next for a Transfer
function featureRailGarden(z) {
  const dir = crng() < 0.5 ? -1 : 1, L = 26;
  [-5, 0, 5].forEach((x, i) => { addRail(dir * x, z - i * 7, L); addCoin(dir * x, 2.2, z - i * 7 - L / 2); });
  return [14 + L + 20, 0];
}
// pick your line: a normal kicker, or the big PRO kicker next to it that pays x1.3
function featureProLine(z, sp) {
  const side = crng() < 0.5 ? -1 : 1, xs = -side * 6, xb = side * 5;
  addRamp(xs, z, 7, 2.2, 5);
  addRamp(xb, z + 2, 11, 4.4, 6.5, true);
  const at = airTime(sp, 4.4, 11), ls = lipSpeed(sp, 4.4);
  for (let i = 1; i < 8; i++) { const t = at * i / 8; addCoin(xb, arcY(sp, 4.4, 11, t) + 1.2, z + 2 - 11 - ls * t); }
  return [11 + ls * at + 26, xs];
}
// rail, kicker, rail: a line built for combos
function featureJibLine(z, sp) {
  const x = wr(-5, 5);
  addRail(x, z, 14);
  const kz = z - 14 - 10; addRamp(x, kz, 7, 2.3, 5);
  const at = airTime(sp, 2.3, 7), ls = lipSpeed(sp, 2.3), rz = kz - 7 - ls * at - 6;
  for (let k = 1; k < 5; k++) { const t = at * k / 5; addCoin(x, arcY(sp, 2.3, 7, t) + 1.2, kz - 7 - ls * t); }
  addRail(x, rz, 16);
  return [z - rz + 16 + 20, x];
}
function featureRocks(z, d) {
  const n = 4 + Math.floor(d * 5);
  for (let i = 0; i < n; i++) addRock(wr(-12, 12), z - wr(0, 32), wr(0.7, 1.2));
  return [45, wr(-6, 6)];
}
function featureSlalom(z, d) {
  const n = 4 + Math.floor(d * 7);
  for (let i = 0; i < n; i++) addTree((i % 2 ? 1 : -1) * wr(1.5, 9), z - i * 9, wr(0.8, 1.1), true);
  for (let i = 0; i < n; i++) addCoin(Math.sin(i * 1.2) * 3, 1.2, z - i * 9 - 4.5);
  return [n * 9 + 18, 0];
}
function featureCoinSnake(z) {
  const x0 = wr(-6, 6);
  for (let i = 0; i < 14; i++) addCoin(x0 + Math.sin(i * 0.45) * 4, 1.2, z - i * 3);
  return [50, x0];
}
function featureCrevasse(z, d) {
  const L = Math.round(4 + d * 5 + wr(0, 2));
  addCrevasse(z - 8, L);
  for (let i = 0; i < 4; i++) addCoin(wr(-8, 8), 2.6, z - 8 - L * (i + 0.5) / 4);
  return [L + 38, wr(-6, 6)];
}
function featureLogs(z, d) {
  const n = 2 + Math.floor(d * 3);
  for (let i = 0; i < n; i++) {
    const hw = wr(3, 5 + d * 3), x = clamp(wr(-10, 10), -13 + hw, 13 - hw);
    addLog(x, z - i * 14, hw);
    addCoin(x, 2.3, z - i * 14);
  }
  return [n * 14 + 22, wr(-6, 6)];
}
function featureBalls(z, d) {
  const n = 1 + Math.floor(d * 2.5);
  for (let i = 0; i < n; i++) addBall(z - i * 16);
  return [n * 16 + 24, 0];
}
function featureField(z, d) {
  const n = 10 + Math.floor(d * 16);
  for (let i = 0; i < n; i++) { const zz = z - wr(0, 60); if (crng() < 0.5) addRock(wr(-12, 12), zz, wr(0.7, 1.2)); else addTree(wr(-12, 12), zz, wr(0.8, 1.1), true); }
  return [70, 0];
}

function featureMega(z, sp) {
  const L = 16, H = 7, W = 9, x = wr(-4, 4);
  addRamp(x, z, L, H, W);
  const at = airTime(sp, H, L), ls = lipSpeed(sp, H);
  for (let i = 1; i < 10; i++) { const t = at * i / 10; addCoin(x, arcY(sp, H, L, t) + 1.2, z - L - ls * t); }
  return [L + ls * at + 30, x];
}
function featureKickerLine(z, sp) {
  const x = wr(-7, 7); let zz = z;
  for (let i = 0; i < 3; i++) {
    const L = 6.5, H = 2.25; addRamp(x, zz, L, H, 5);
    const at = airTime(sp, H, L), ls = lipSpeed(sp, H);
    for (let k = 1; k < 5; k++) { const t = at * k / 5; addCoin(x, arcY(sp, H, L, t) + 1.2, zz - L - ls * t); }
    zz -= L + ls * at + 9;
  }
  return [z - zz + 14, x];
}
// trampoline vertical speed for the n-th bounce in a row (Endless); the race keeps its original single bounce
const bounceVy = n => 20 + 3.5 * Math.min(n, 3);
function bounceAirTime(vy) { const up = vy / G, apex = vy * vy / (2 * G); return up + Math.sqrt(2 * apex / (G * 1.15)); }
function featureRollers(z, d) {
  const n = 3 + Math.floor(crng() * 3); let zz = z;
  for (let i = 0; i < n; i++) {
    const L = wr(13, 18), H = wr(1.2, 1.8 + d);
    addShape(0, zz, L, 34, bump(H), mat.snow, false);
    addCoin(wr(-6, 6), H + 2.2, zz - L / 2);
    zz -= L;
  }
  return [z - zz + 16, wr(-5, 5)];
}
function featureTabletop(z, sp, d) {
  const H = wr(2.2, 2.8 + d), L = wr(40, 48), x = wr(-6, 6), W = 9;
  addShape(x, z, L, W, table(H, 0.36, 0.55), tableMat, true);
  for (let i = 0; i < 6; i++) addCoin(x, H + 1.6 + Math.sin(i / 5 * Math.PI) * 1.6, z - L * (0.36 + i * 0.07));
  return [L + 22, x];
}
function featureStepDown(z, sp) {
  // big kicker into a long downhill landing — huge hang time, soft landing
  const x = wr(-5, 5);
  addRamp(x, z, 8, 2.6, 7);
  addShape(x, z - 8 - 6, 46, 14, table(3.2, 0.28, 0.3), tableMat, true);   // rises under your flight, then a long landing slope
  return [8 + 6 + 46 + 18, x];
}

const RACE_LEN = 1500;

// ---------- zones: the normal mountain, or the underground Agartha level (Endless only) ----------
let zone = 'normal', zoneEndZ = 0, nextCaveD = 900, prevTheme = 'day', portal = null;
const caves = [];
// special worlds you can ride into from the normal mountain (Endless only); they pay double points
const WORLDS = {
  agartha: { name: 'AGARTHA', theme: 'agartha', slope: 0.34, speed: 1.15, len: 750, fog: [45, 200], fade: '#000', tune: [110, 165, 220, 330], ring: 0xffd166 },
  xmas: { name: 'NORTH POLE', theme: 'xmas', slope: 0.3, speed: 1.1, len: 750, fog: [55, 210], fade: '#fff', tune: [523, 659, 784, 1047], ring: 0xff2d55 },
};
const special = () => zone !== 'normal';
let nextWorld = 'agartha';

// polar bears: decoration beside the slope, and (in Endless) the odd one wandering across it
const bearMat = lam(0xf4f1e6), bearDark = lam(0x1d1d1d);
const animals = [];
function makeBear() {
  const g = new THREE.Group(), legs = [];
  const part = (w, h, d, x, y, z, m = bearMat) => { const o = new THREE.Mesh(box(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
  part(1.3, 1.1, 2.2, 0, 1.2, 0); part(1.1, 0.4, 0.9, 0, 1.8, -0.4);                        // body, shoulder hump
  part(0.75, 0.7, 0.8, 0, 1.5, -1.35); part(0.42, 0.36, 0.45, 0, 1.36, -1.9);               // head, snout
  part(0.16, 0.12, 0.06, 0, 1.47, -2.13, bearDark);
  for (const sx of [-1, 1]) { part(0.08, 0.08, 0.04, sx * 0.2, 1.66, -1.76, bearDark); part(0.18, 0.18, 0.1, sx * 0.27, 1.9, -1.2); }
  part(0.25, 0.25, 0.2, 0, 1.4, 1.15);                                                      // tail
  for (const [x, z] of [[-0.42, -0.75], [0.42, -0.75], [-0.42, 0.75], [0.42, 0.75]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 1.0, z); g.add(pivot);
    const leg = new THREE.Mesh(box(0.38, 1.0, 0.42), bearMat); leg.position.y = -0.5; pivot.add(leg);
    legs.push(pivot);
  }
  return { g, legs };
}
function addBear(x, z, vx, vz, crossing) {
  if (crossing && checkpoints.some(c => Math.abs(z - c.z) < 6)) return;
  const { g, legs } = makeBear(); g.position.set(x, 0, z); g.scale.setScalar(1.15); world.add(g);
  const a = { g, legs, vx, vz, ph: rand(0, 6) };
  animals.push(a);
  if (crossing) {
    const o = { kind: 'bear', x, z, r: 1.4, h: 2.4, vx, mesh: g };
    obstacles.push(o); movers.push(o); a.mover = o;
  } else decor.push({ z: z - 3, mesh: g });
}
function updateAnimals(dt) {
  for (const a of animals) {
    if (!a.mover) { a.g.position.x += a.vx * dt; a.g.position.z += a.vz * dt; a.g.position.y = wallH(a.g.position.x, a.g.position.z); }
    const vx = a.mover ? a.mover.vx : a.vx, vz = a.mover ? 0 : a.vz;
    a.g.rotation.y = Math.atan2(-vx, -vz);   // face the way it's walking
    const sw = Math.sin(time * 5 + a.ph) * 0.5;
    a.legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3) ? sw : -sw; });   // diagonal gait
  }
}
function featureBear(z, d) {
  const n = 1 + (d > 0.5 && crng() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) addBear(wr(-10, 10), z - 10 - i * 22, (crng() < 0.5 ? -1 : 1) * wr(3, 4.5), 0, true);
  return [n * 22 + 26, 0];
}

// Agartha crystals: decoration, and obstacles that replace rocks underground
const crystalGeo = merged([
  { geo: new THREE.OctahedronGeometry(0.5, 0), color: 0x3cf2ff, m: new THREE.Matrix4().makeScale(1, 2.4, 1).premultiply(T(0, 1.2, 0)) },
  { geo: new THREE.OctahedronGeometry(0.35, 0), color: 0xc264ff, m: new THREE.Matrix4().makeRotationZ(0.5).multiply(new THREE.Matrix4().makeScale(1, 2, 1)).premultiply(T(0.45, 0.6, 0.1)) },
  { geo: new THREE.OctahedronGeometry(0.3, 0), color: 0x7cf7d4, m: new THREE.Matrix4().makeRotationZ(-0.6).multiply(new THREE.Matrix4().makeScale(1, 2, 1)).premultiply(T(-0.4, 0.5, -0.15)) },
  { geo: new THREE.OctahedronGeometry(0.25, 0), color: 0xe0aaff, m: new THREE.Matrix4().makeRotationX(0.5).multiply(new THREE.Matrix4().makeScale(1, 1.8, 1)).premultiply(T(0, 0.4, 0.4)) },
]);
const crystals = new Pool(crystalGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x2a1650 }), 420);
// ---------- Agartha extras: floating islands, glowing mushrooms, ancient rune arches ----------
const R = (rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
const S3 = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
const islands = new Pool(merged([
  { geo: new THREE.ConeGeometry(4, 8, 7), color: 0x3a2466, m: R(Math.PI).premultiply(T(0, -4, 0)) },
  { geo: new THREE.CylinderGeometry(4.2, 4, 1, 7), color: 0x2dd4bf, m: T(0, 0.3, 0) },
  { geo: new THREE.OctahedronGeometry(0.7, 0), color: 0x3cf2ff, m: S3(1, 2.2, 1).premultiply(T(1.4, 2.2, 0.6)) },
  { geo: new THREE.OctahedronGeometry(0.5, 0), color: 0xc264ff, m: S3(1, 2, 1).premultiply(T(-1.6, 1.7, -0.8)) },
  { geo: new THREE.ConeGeometry(1.2, 2.2, 6), color: 0x1f8a7a, m: T(-0.4, 1.9, 1.5) },
]), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x1a0b30 }), 60);
const mushGeo = cap => merged([
  { geo: new THREE.CylinderGeometry(0.16, 0.22, 1.3, 6), color: 0xe9ddff, m: T(0, 0.65, 0) },
  { geo: new THREE.SphereGeometry(0.8, 8, 4, 0, TAU, 0, Math.PI / 2), color: cap, m: S3(1, 0.65, 1).premultiply(T(0, 1.25, 0)) },
]);
const mushBasic = new THREE.MeshBasicMaterial({ vertexColors: true });   // unlit, so they read as glowing
const mushCyan = new Pool(mushGeo(0x3cf2ff), mushBasic, 120), mushPink = new Pool(mushGeo(0xff4fd8), mushBasic, 120);
const runeMat = lam(0xffd98a, { emissive: 0xffc35a, emissiveIntensity: 0.9 }), ancientStone = lam(0xcfc5ea);
function addRuneArch(z) {
  const g = new THREE.Group(); g.position.set(0, 0, z);
  for (const sx of [-1, 1]) {
    const pil = new THREE.Mesh(box(2, 14, 2), ancientStone); pil.position.set(sx * 15, 7, 0); g.add(pil);
    for (const y of [3, 7, 11]) { const band = new THREE.Mesh(box(2.1, 0.25, 2.1), runeMat); band.position.set(sx * 15, y, 0); g.add(band); }
    const top = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), caveCrystal); top.position.set(sx * 15, 15.4, 0); top.scale.y = 1.6; g.add(top);
  }
  const beam = new THREE.Mesh(box(33, 1.8, 2), ancientStone); beam.position.y = 14; g.add(beam);
  const strip = new THREE.Mesh(box(30, 0.3, 2.05), runeMat); strip.position.y = 13.5; g.add(strip);
  const hang = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), caveCrystal); hang.position.y = 11.6; hang.scale.y = 1.8; g.add(hang);
  world.add(g); decor.push({ z: z - 2, mesh: g });
}

// ---------- Easter egg: a shy Yeti now and then beside the run, waving. Ride past it for a bonus ----------
const yetiFur = lam(0xf4f8fb), yetiFace = lam(0x8fa3b8), yetis = [];
function addYeti(x, z) {
  const g = new THREE.Group(); g.position.set(x, wallH(x, z), z); g.rotation.y = x < 0 ? -0.6 : 0.6;
  const part = (w, h, d, px, py, pz, m = yetiFur, parent = g) => { const o = new THREE.Mesh(box(w, h, d), m); o.position.set(px, py, pz); parent.add(o); return o; };
  part(1.7, 2.2, 1.2, 0, 2.3, 0); part(1.1, 1.0, 1.0, 0, 3.85, -0.05);
  part(0.75, 0.55, 0.1, 0, 3.75, -0.58, yetiFace);
  for (const sx of [-1, 1]) { part(0.14, 0.14, 0.05, sx * 0.18, 3.85, -0.64, bearDark); part(0.55, 1.2, 0.6, sx * 0.45, 0.6, 0); }
  part(0.4, 0.12, 0.05, 0, 3.58, -0.64, bearDark);
  const arms = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * 1.0, 3.1, 0); g.add(pivot);
    part(0.45, 1.5, 0.5, 0, -0.7, 0, yetiFur, pivot); arms.push(pivot);
  }
  world.add(g); decor.push({ z: z - 2, mesh: g });
  yetis.push({ g, arm: arms[x < 0 ? 1 : 0], z, seen: false });
}
function updateYetis() {
  for (let i = yetis.length - 1; i >= 0; i--) {
    const y = yetis[i];
    if (!y.g.parent) { yetis.splice(i, 1); continue; }
    y.arm.rotation.z = (y.g.position.x < 0 ? 1 : -1) * (2.4 + Math.sin(time * 7) * 0.4);   // waving
    if (!y.seen && state === 'play' && p.z < y.z) { y.seen = true; p.trickScore += 1000; showTrick('YETI SPOTTED!', '+1,000', true); Sfx.perfect(); }
  }
}

// ---------- Agartha city: snowy stepped pyramids, carved spires and stone blocks in pale lavender stone ----------
const STONE = [0xddd5f2, 0xc9bfe8], STONE_DARK = 0x51457f, SNOWCAP = 0xffffff, TEMPLE_GOLD = 0xffd98a;
const agPyramid = new Pool(merged((() => {
  const parts = [];
  let y = 0;
  [26, 21, 16.5, 12.5, 9, 6].forEach((w, i) => {
    parts.push({ geo: new THREE.BoxGeometry(w, 4, w), color: STONE[i % 2], m: T(0, y + 2, 0) });
    parts.push({ geo: new THREE.BoxGeometry(w - 0.6, 0.5, w - 0.6), color: SNOWCAP, m: T(0, y + 4.1, 0) });   // snow on each step
    for (let k = -2; k <= 2; k++) if (Math.abs(k) * 3 < w / 2 - 1.5)   // carved doorways along the front of each tier
      parts.push({ geo: new THREE.BoxGeometry(1, 1.8, 0.3), color: STONE_DARK, m: T(k * 3, y + 1.6, w / 2) });
    y += 4;
  });
  parts.push({ geo: new THREE.BoxGeometry(3.4, 1, 34), color: STONE[1], m: R(-0.72, 0, 0).premultiply(T(0, 11.5, 9.2)) });   // the grand stair
  parts.push({ geo: new THREE.BoxGeometry(4.2, 3.6, 4.2), color: STONE[0], m: T(0, y + 1.8, 0) });                          // shrine on top
  parts.push({ geo: new THREE.ConeGeometry(3.4, 3.4, 4), color: SNOWCAP, m: R(0, Math.PI / 4, 0).premultiply(T(0, y + 5.3, 0)) });
  parts.push({ geo: new THREE.BoxGeometry(1.4, 2.2, 0.3), color: TEMPLE_GOLD, m: T(0, y + 1.3, 2.15) });
  return parts;
})()), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x1c1430 }), 16);
const agSpire = new Pool(merged((() => {
  const parts = [{ geo: new THREE.BoxGeometry(8, 10, 8), color: STONE[1], m: T(0, 5, 0) }, { geo: new THREE.BoxGeometry(8.4, 0.6, 8.4), color: SNOWCAP, m: T(0, 10.2, 0) }];
  let y = 10;
  [[3.6, 3.1, 9], [3.0, 2.5, 8], [2.4, 1.9, 7], [1.8, 1.4, 6]].forEach(([rb, rt, h], i) => {
    parts.push({ geo: new THREE.CylinderGeometry(rt, rb, h, 8), color: STONE[i % 2], m: T(0, y + h / 2, 0) });
    for (let a = 0; a < 4; a++) parts.push({ geo: new THREE.BoxGeometry(0.5, h * 0.55, 0.3), color: STONE_DARK, m: R(0, a * Math.PI / 2, 0).multiply(T(0, y + h / 2, rb * 0.93)) });   // window slits
    y += h;
    parts.push({ geo: new THREE.CylinderGeometry(rt + 0.45, rt + 0.45, 0.7, 8), color: SNOWCAP, m: T(0, y, 0) });   // snowy ledge
  });
  parts.push({ geo: new THREE.ConeGeometry(1.6, 9, 8), color: STONE[0], m: T(0, y + 4.5, 0) });
  parts.push({ geo: new THREE.OctahedronGeometry(0.9, 0), color: TEMPLE_GOLD, m: S3(1, 1.6, 1).premultiply(T(0, y + 9.6, 0)) });
  return parts;
})()), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x1c1430 }), 16);
const agBlock = new Pool(merged([
  { geo: new THREE.BoxGeometry(6, 5, 8), color: STONE[0], m: T(0, 2.5, 0) },
  { geo: new THREE.BoxGeometry(5, 1.6, 7), color: STONE[1], m: T(0, 5.8, 0) },
  { geo: new THREE.BoxGeometry(5.2, 0.45, 7.2), color: SNOWCAP, m: T(0, 6.8, 0) },
  { geo: new THREE.SphereGeometry(2, 8, 4, 0, TAU, 0, Math.PI / 2), color: SNOWCAP, m: T(0, 6.9, 0) },
  ...[-2.4, -0.8, 0.8, 2.4].flatMap(z => [-1, 1].map(sx => ({ geo: new THREE.BoxGeometry(0.2, 1.4, 0.7), color: STONE_DARK, m: T(sx * 3.05, 2.6, z) }))),
  { geo: new THREE.BoxGeometry(0.25, 2.6, 1.6), color: TEMPLE_GOLD, m: T(-3.05, 1.3, 0) },
]), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x1c1430 }), 40);
const goldGlow = new THREE.SpriteMaterial({ map: glowTex, color: 0xffd98a, transparent: true, depthWrite: false, opacity: 0.85, fog: false });
function addGlow(x, y, z, size, m = goldGlow) { const gl = new THREE.Sprite(m); gl.scale.setScalar(size); gl.position.set(x, y, z); world.add(gl); decor.push({ z: z - 5, mesh: gl }); }
function addPyramid(x, z) {
  const s = rand(0.9, 1.5), ry = x < 0 ? Math.PI / 2 : -Math.PI / 2;   // the stair faces the slope
  decor.push({ z: z - 15 * s, idx: agPyramid.add(x, wallH(x, z) - 1, z, s, ry), pool: agPyramid });
  addGlow(x, wallH(x, z) - 1 + 27.5 * s, z, 9 * s);
}
function addSpire(x, z) {
  const s = rand(0.9, 1.4);
  decor.push({ z: z - 6 * s, idx: agSpire.add(x, wallH(x, z) - 0.5, z, s, rand(0, 1)), pool: agSpire });
  addGlow(x, wallH(x, z) - 0.5 + 49.6 * s, z, 6 * s);
}

// woolly mammoths and robed travellers trudge up the valley in a caravan
const mammothFur = lam(0x6e4a33), mammothDark = lam(0x4a3122), tuskMat = lam(0xf3ead8), blanketMat = lam(0xb5303f), blanketGold = lam(0xe8b54a);
function makeMammoth() {
  const g = new THREE.Group(), legs = [];
  const part = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
  part(box(2.2, 2.1, 3.6), mammothFur, 0, 2.9, 0);
  part(box(2.35, 0.9, 3.7), mammothDark, 0, 2.0, 0);                  // shaggy skirt
  part(box(1.9, 1.0, 1.6), mammothFur, 0, 4.1, -0.9);                 // shoulder hump
  part(box(1.6, 1.6, 1.4), mammothFur, 0, 3.6, -2.3);                 // head
  for (const sx of [-1, 1]) {
    part(box(0.25, 0.9, 0.7), mammothDark, sx * 0.85, 3.6, -2.1);     // ears
    const tusk = part(new THREE.TorusGeometry(0.75, 0.11, 5, 8, Math.PI * 0.9), tuskMat, sx * 0.55, 2.6, -2.9); tusk.rotation.set(0, Math.PI / 2, Math.PI * 0.55);
  }
  let ty = 2.9, tz = -3.0;
  for (let i = 0; i < 4; i++) { part(box(0.42 - i * 0.05, 0.6, 0.42 - i * 0.05), mammothFur, 0, ty, tz); ty -= 0.55; tz -= 0.12 * (3 - i); }   // trunk
  part(box(2.3, 0.18, 2.2), blanketMat, 0, 4.0, 0.6); part(box(2.35, 0.6, 0.18), blanketGold, 0, 3.6, 1.6);   // saddle blanket
  part(box(1.2, 0.9, 1.2), blanketGold, 0, 4.5, 0.6);                 // a little howdah
  for (const [x, z] of [[-0.65, -1.2], [0.65, -1.2], [-0.65, 1.2], [0.65, 1.2]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 2.0, z); g.add(pivot);
    const leg = new THREE.Mesh(box(0.7, 2.0, 0.7), mammothFur); leg.position.y = -1.0; pivot.add(leg);
    legs.push(pivot);
  }
  return { g, legs };
}
const robeMats = [0x7b5ea7, 0xd9cdb8, 0x4f6fa8].map(c => lam(c)), faceMat = lam(0xe8c39e);
function makeTraveller() {
  const g = new THREE.Group();
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.6, 6), robeMats[(Math.random() * 3) | 0]); robe.position.y = 0.8; g.add(robe);
  const head = new THREE.Mesh(box(0.32, 0.34, 0.32), faceMat); head.position.y = 1.75; g.add(head);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 6), robe.material); hood.position.y = 2.05; g.add(hood);
  const staff = new THREE.Mesh(box(0.06, 2.2, 0.06), mammothDark); staff.position.set(0.4, 1.1, -0.2); g.add(staff);
  return { g, legs: [] };
}
function addCaravan(x, z) {
  for (let i = 0; i < 4; i++) {
    const zz = z - i * 9, m = makeMammoth();
    m.g.position.set(x, 0, zz); m.g.scale.setScalar(0.9); world.add(m.g);
    animals.push({ g: m.g, legs: m.legs, vx: 0, vz: 1.4, ph: i * 1.3 }); decor.push({ z: zz - 4, mesh: m.g });
    const t = makeTraveller(); t.g.position.set(x + (x < 0 ? 1.8 : -1.8), 0, zz - 4.5); world.add(t.g);
    animals.push({ g: t.g, legs: [], vx: 0, vz: 1.4, ph: 0 }); decor.push({ z: zz - 6, mesh: t.g });
  }
}

// the sky of Agartha: giant icicles hanging over the horizon, and a radiant winged guardian above the city
const agarthaSky = (() => {
  const g = new THREE.Group(); g.visible = false; sky.add(g);
  const ice = [];
  for (let i = 0; i < 70; i++) {
    const a = -1.9 + i / 69 * 3.8 + rand(-0.03, 0.03), d = rand(300, 360), h = rand(30, 120) * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7)));
    ice.push({ geo: new THREE.ConeGeometry(rand(5, 13), h, 5), color: i % 3 ? 0xe6f2ff : 0xc6dcff, m: R(Math.PI, rand(0, 3), 0).premultiply(T(Math.sin(a) * d, 235 - h / 2, -Math.cos(a) * d)) });
  }
  g.add(new THREE.Mesh(merged(ice), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false, emissive: 0x4a4f8a })));
  const angel = new THREE.Group(); angel.position.set(55, 105, -320); g.add(angel);
  const nb = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, fog: false, transparent: o < 1, opacity: o, depthWrite: o >= 1 });
  const robe = new THREE.Mesh(new THREE.ConeGeometry(5, 20, 8), nb(0xfff6dc)); robe.position.y = -5; angel.add(robe);
  const head = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), nb(0xffeccc)); head.position.y = 7; angel.add(head);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(3, 0.35, 6, 20), nb(0xffd98a)); halo.position.set(0, 10, -0.5); angel.add(halo);
  const wings = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(sx * 1.5, 3, 0.5); angel.add(w);
    for (let k = 0; k < 5; k++) { const f = new THREE.Mesh(box(16 - k * 2, 2.6, 0.4), nb(0xfffaf0, 0.92)); f.position.set(sx * (8 - k), 4 - k * 2.2, 0); f.rotation.z = sx * (0.55 - k * 0.12); w.add(f); }
    wings.push({ w, sx });
  }
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe8b0, fog: false, transparent: true, depthWrite: false, opacity: 0.8 })); aura.scale.setScalar(90); angel.add(aura);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(4, 16, 220, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0c4, fog: false, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.position.y = -118; angel.add(beam);
  return {
    update(t) {
      g.visible = zone === 'agartha';
      if (!g.visible) return;
      angel.position.y = 105 + Math.sin(t * 0.6) * 3;
      for (const { w, sx } of wings) w.rotation.y = -sx * (0.15 + Math.sin(t * 1.2) * 0.12);
      halo.rotation.z = t * 0.3; aura.material.opacity = 0.7 + Math.sin(t * 1.5) * 0.12;
    },
  };
})();

// ---------- North Pole landmarks: giant glowing trees, Santa's workshop, warm lamp posts ----------
const bulbBasic = [0xff3b3b, 0xffd23f, 0x4cc3ff, 0xff4fd8, 0x3bff6b].map(c => new THREE.MeshBasicMaterial({ color: c }));
const starMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
const warmGlow = new THREE.SpriteMaterial({ map: glowTex, color: 0xffc56b, transparent: true, depthWrite: false, opacity: 0.85 });
const pineDark = lam(0x1f5c40), pineLight = lam(0x2a7552), trunkMat = lam(0x5b3a24), snowMat = lam(0xffffff);
function addGiantTree(x, z) {
  const g = new THREE.Group(); g.position.set(x, wallH(x, z), z);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 4, 7), trunkMat); trunk.position.y = 2; g.add(trunk);
  const tiers = [[7, 7, 6], [5.8, 6, 10], [4.5, 5.2, 13.6], [3.2, 4.4, 16.8], [2, 3.6, 19.6]];
  tiers.forEach(([r, h, y], i) => {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9), i % 2 ? pineLight : pineDark); c.position.y = y; g.add(c);
    const sn = new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, h * 0.3, 9), snowMat); sn.position.y = y + h * 0.36; g.add(sn);
    for (let k = 0; k < 9 - i; k++) {   // glowing baubles around each tier
      const a = k / (9 - i) * TAU + i, b = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 4), bulbBasic[(k + i) % 5]);
      b.position.set(Math.cos(a) * r * 0.72, y - h * 0.22, Math.sin(a) * r * 0.72); g.add(b);
    }
  });
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(1.3, 0), starMat); star.position.y = 22.6; star.scale.y = 1.3; g.add(star);
  const sg = new THREE.Sprite(warmGlow); sg.scale.setScalar(10); sg.position.y = 22.6; g.add(sg);
  world.add(g); decor.push({ z: z - 8, mesh: g });
}
function addWorkshop(x, z) {
  const g = new THREE.Group(); g.position.set(x, wallH(x, z), z); g.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
  const wall = lam(0x9e2a2b), trim = lam(0xf3e9d2), win = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  const body = new THREE.Mesh(box(14, 7, 9), wall); body.position.y = 3.5; g.add(body);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 7.6, 5, 4, 1), snowMat); roof.position.y = 9.5; roof.rotation.y = Math.PI / 4; roof.scale.set(1.45, 1, 0.95); g.add(roof);
  const chim = new THREE.Mesh(box(1.4, 4, 1.4), lam(0x6b3b2a)); chim.position.set(4, 10, -1.5); g.add(chim);
  for (let i = -2; i <= 2; i++) for (const y of [2.2, 5]) { const w = new THREE.Mesh(box(1.3, 1.5, 0.1), win); w.position.set(i * 2.6, y, 4.55); g.add(w); }
  const door = new THREE.Mesh(box(2.2, 3.2, 0.12), trim); door.position.set(0, 1.6, 4.56); g.add(door);
  const sign = new THREE.Mesh(box(6, 1.1, 0.2), lam(0x1f5c40)); sign.position.set(0, 7.6, 4.6); g.add(sign);
  const glowS = new THREE.Sprite(warmGlow); glowS.scale.setScalar(18); glowS.position.set(0, 3.5, 6); g.add(glowS);
  world.add(g); decor.push({ z: z - 10, mesh: g });
}
const lampPole = lam(0x1d3b2a), lampHead = new THREE.MeshBasicMaterial({ color: 0xffe2a0 });
function addLampPost(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const pole = new THREE.Mesh(box(0.2, 4.2, 0.2), lampPole); pole.position.y = 2.1; g.add(pole);
  const head = new THREE.Mesh(box(0.5, 0.6, 0.5), lampHead); head.position.y = 4.4; g.add(head);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.4, 4), snowMat); cap.position.y = 4.9; cap.rotation.y = Math.PI / 4; g.add(cap);
  const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1, 5, 10), pineLight); wreath.position.set(0, 3.4, -0.15); g.add(wreath);
  const gl = new THREE.Sprite(warmGlow); gl.scale.setScalar(4); gl.position.y = 4.4; g.add(gl);
  world.add(g); decor.push({ z: z - 1, mesh: g });
}

// ---------- North Pole: decorated trees, presents, candy canes, string lights, reindeer, Santa ----------
const xmasTrees = new Pool(merged([
  { geo: new THREE.CylinderGeometry(0.16, 0.22, 0.9, 5), color: 0x6b4a2f, m: T(0, 0.45, 0) },
  { geo: new THREE.ConeGeometry(1.35, 1.9, 7), color: 0x2f6b4f, m: T(0, 1.65, 0) },
  { geo: new THREE.ConeGeometry(1.05, 1.6, 7), color: 0x377a5a, m: T(0, 2.55, 0) },
  { geo: new THREE.ConeGeometry(0.7, 1.3, 7), color: 0x2f6b4f, m: T(0, 3.35, 0) },
  ...[[0.9, 1.2, 0.5, 0xe63946], [-0.8, 1.4, 0.6, 0xffd23f], [0.2, 1.1, -1, 0x4cc3ff], [0.6, 2.3, -0.5, 0xffd23f], [-0.5, 2.2, 0.6, 0xe63946], [0.3, 3.0, 0.45, 0x4cc3ff], [-0.4, 2.9, -0.3, 0xff4fd8]]
    .map(([x, y, z, c]) => ({ geo: new THREE.OctahedronGeometry(0.17, 0), color: c, m: T(x, y, z) })),
  { geo: new THREE.OctahedronGeometry(0.32, 0), color: 0xffd23f, m: T(0, 4.15, 0) },
]), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x1a1406 }), 520);
const giftGeo = (c, rib) => merged([
  { geo: new THREE.BoxGeometry(1.6, 1.6, 1.6), color: c, m: T(0, 0.8, 0) },
  { geo: new THREE.BoxGeometry(1.64, 1.64, 0.3), color: rib, m: T(0, 0.8, 0) },
  { geo: new THREE.BoxGeometry(0.3, 1.64, 1.64), color: rib, m: T(0, 0.8, 0) },
  { geo: new THREE.TorusGeometry(0.28, 0.09, 5, 8), color: rib, m: R(0, 0.6, 0).premultiply(T(-0.2, 1.75, 0)) },
  { geo: new THREE.TorusGeometry(0.28, 0.09, 5, 8), color: rib, m: R(0, -0.6, 0).premultiply(T(0.2, 1.75, 0)) },
]);
const giftsRed = new Pool(giftGeo(0xd62839, 0xffd23f), vcol, 160), giftsGreen = new Pool(giftGeo(0x2a9d4f, 0xf8f9fa), vcol, 160);
const candyCanes = new Pool(merged([
  ...Array.from({ length: 8 }, (_, i) => ({ geo: new THREE.CylinderGeometry(0.2, 0.2, 0.42, 8), color: i % 2 ? 0xffffff : 0xe63946, m: T(0, 0.21 + i * 0.42, 0) })),
  { geo: new THREE.TorusGeometry(0.5, 0.2, 6, 10, Math.PI), color: 0xe63946, m: T(-0.5, 3.36, 0) },
]), vcol, 120);
// string lights over the slope; the four bulb colours chase each other
const bulbMats = [0xff3b3b, 0x3bff6b, 0xffd23f, 0x4cc3ff].map(c => new THREE.MeshBasicMaterial({ color: c }));
const bulbGeo = new THREE.SphereGeometry(0.18, 6, 4);
function addLightString(z) {
  const g = new THREE.Group(); g.position.set(0, 0, z);
  for (const sx of [-1, 1]) { const post = new THREE.Mesh(box(0.3, 9, 0.3), candyPost); post.position.set(sx * 14.5, 4.5, 0); g.add(post); }
  const bulbs = bulbMats.map(m => new THREE.InstancedMesh(bulbGeo, m, 16)), count = [0, 0, 0, 0];
  for (const [y0, sag] of [[8.6, 2.4], [7.4, 1.6]]) for (let i = 0; i <= 28; i++) {
    const u = i / 28, k = i % 4;
    dummy.position.set(-14.5 + u * 29, y0 - sag * Math.sin(Math.PI * u), 0); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
    bulbs[k].setMatrixAt(count[k]++, dummy.matrix);
  }
  bulbs.forEach((b, k) => { b.count = count[k]; b.frustumCulled = false; g.add(b); });
  world.add(g); decor.push({ z: z - 1, mesh: g });
}
const candyPost = lam(0xe63946);
function addGingerHouse(x, z) {
  const g = new THREE.Group(); g.position.set(x, wallH(x, z), z); g.rotation.y = rand(-0.5, 0.5);
  const w = new THREE.Mesh(box(4, 2.8, 3.6), lam(0xb5651d)); w.position.y = 1.4; g.add(w);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.5, 2, 4), lam(0xfff5f8)); roof.position.y = 3.8; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.85); g.add(roof);
  for (const [dx, c] of [[-1.1, 0xe63946], [0, 0x3bff6b], [1.1, 0xffd23f]]) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), lam(c)); d.position.set(dx, 2.6, 1.85); g.add(d); }
  const door = new THREE.Mesh(box(0.9, 1.4, 0.05), lam(0xfff5f8)); door.position.set(0, 0.7, 1.82); g.add(door);
  const win = new THREE.Mesh(box(0.8, 0.6, 0.05), lam(0xffd166, { emissive: 0xc28a00 })); win.position.set(1.2, 1.7, 1.82); g.add(win);
  world.add(g); decor.push({ z: z - 4, mesh: g });
}
// Santa's sleigh crosses the sky now and then at the North Pole
const sleigh = (() => {
  const g = new THREE.Group(), nf = c => new THREE.MeshLambertMaterial({ color: c, fog: false, flatShading: true });
  const body = new THREE.Mesh(box(3, 1.4, 2), nf(0xd62839)); body.position.y = 1; g.add(body);
  const back = new THREE.Mesh(box(3, 1.4, 0.4), nf(0xd62839)); back.position.set(0, 2, 0.8); g.add(back);
  for (const sx of [-1, 1]) { const run = new THREE.Mesh(box(0.15, 0.15, 3.4), nf(0xffd23f)); run.position.set(sx * 1.2, 0, -0.3); g.add(run); }
  const sack = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), nf(0x8b5a2b)); sack.position.set(0.6, 2, 0.4); g.add(sack);
  const santa = new THREE.Mesh(box(0.9, 1.1, 0.8), nf(0xd62839)); santa.position.set(-0.5, 2, -0.2); g.add(santa);
  const head = new THREE.Mesh(box(0.5, 0.5, 0.5), nf(0xf1c27d)); head.position.set(-0.5, 2.8, -0.2); g.add(head);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 6), nf(0xd62839)); hat.position.set(-0.5, 3.3, -0.2); g.add(hat);
  for (let i = 0; i < 4; i++) {
    const deer = new THREE.Mesh(box(0.6, 0.6, 1.4), nf(0x8b5a2b)); deer.position.set((i % 2 ? 0.6 : -0.6), 1.2, -3 - Math.floor(i / 2) * 2.2); g.add(deer);
    const dh = new THREE.Mesh(box(0.35, 0.35, 0.5), nf(i === 0 ? 0x8b5a2b : 0x8b5a2b)); dh.position.set(deer.position.x, 1.75, deer.position.z - 0.85); g.add(dh);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020, fog: false })); nose.position.set(-0.6, 1.75, -4.35); g.add(nose);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd27a, fog: false, transparent: true, depthWrite: false, opacity: 0.7 })); glow.scale.setScalar(12); g.add(glow);
  g.scale.setScalar(2.2); g.visible = false; sky.add(g);
  return {
    update(t) {
      g.visible = zone === 'xmas';
      if (!g.visible) return;
      const u = ((t * 0.06) % 1.4) - 0.2;   // a pass every ~23 s, with a gap between passes
      g.position.set(-260 + u * 520, 95 + Math.sin(t * 1.3) * 6, -230); g.rotation.y = -Math.PI / 2;
    },
  };
})();
// reindeer wander beside the slope at the North Pole (same walking rig as the bears)
const deerMat = lam(0x8b5a2b), deerLight = lam(0xe8d5b5), antlerMat = lam(0x5a3d22);
function makeReindeer() {
  const g = new THREE.Group(), legs = [];
  const part = (w, h, d, x, y, z, m = deerMat) => { const o = new THREE.Mesh(box(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
  part(0.9, 0.85, 1.9, 0, 1.55, 0); part(0.4, 0.8, 0.45, 0, 2.1, -0.95).rotation.x = 0.5;    // body, neck
  part(0.45, 0.45, 0.75, 0, 2.5, -1.35); part(0.22, 0.2, 0.06, 0, 2.45, -1.74, deerLight);    // head, muzzle
  part(0.3, 0.25, 0.2, 0, 1.75, 1.0, deerLight);                                             // tail
  for (const sx of [-1, 1]) {
    const a = part(0.08, 0.7, 0.08, sx * 0.18, 3.05, -1.25, antlerMat); a.rotation.z = -sx * 0.35;
    const b = part(0.08, 0.4, 0.08, sx * 0.4, 3.3, -1.35, antlerMat); b.rotation.z = -sx * 1.0;
    const c = part(0.08, 0.35, 0.08, sx * 0.3, 3.35, -1.05, antlerMat); c.rotation.x = 0.6;
  }
  for (const [x, z] of [[-0.3, -0.7], [0.3, -0.7], [-0.3, 0.7], [0.3, 0.7]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 1.2, z); g.add(pivot);
    const leg = new THREE.Mesh(box(0.2, 1.2, 0.22), deerMat); leg.position.y = -0.6; pivot.add(leg);
    legs.push(pivot);
  }
  return { g, legs };
}
function addReindeer(x, z, vz) {
  const { g, legs } = makeReindeer(); g.position.set(x, wallH(x, z), z); world.add(g);
  animals.push({ g, legs, vx: 0, vz, ph: rand(0, 6) }); decor.push({ z: z - 3, mesh: g });
}

// ---------- alpine terrain: broad snowfields and asymmetric ridges around the playable piste ----------
// Adjacent chunks sample the same world coordinates, so ridges and groves continue without seams.
const WALL_IN = 19, WALL_CHUNK = 40, WALL_COLS = [-1.5, 0, 1.5, 3.5, 6, 9, 13, 18, 25, 34, 46, 62];
const ALPINE_COLS = [-1.5, 0, 4, 10, 18, 29, 43, 60, 81, 106, 138];
const WALL_COLORS = {
  normal: { rock: [0x8a94a3, 0x77818f], snow: 0xf2f7fb, snowLine: 22 },
  agartha: { rock: [0xc4bbe3, 0xb2a8d8], snow: 0xf7f5ff, snowLine: 8, snowSlope: 0.55 },
  xmas: { rock: [0x8a94a3, 0x77818f], snow: 0xf8fbff, snowLine: 12 },
};
let wallZ = 30;
function wallH(x, z) {
  const ax = Math.abs(x);
  if (mode === 'race' || ax <= WALL_IN) return 0;
  if (zone === 'normal') return terrainHeight(x, z);
  const sd = x < 0 ? 0 : 1.7, u = ax - WALL_IN;
  const ridge = 34 + 10 * Math.sin(z * 0.013 + sd) + 6 * Math.sin(z * 0.041 + 2 * sd);
  const rise = 1 - Math.exp(-u / 13);                       // steep near the slope, flattening toward the ridge
  const jag = 2.4 * Math.sin(x * 0.45 + z * 0.31 + sd) * Math.sin(z * 0.17 - x * 0.2) * Math.min(1, u / 5);
  return Math.max(0, ridge * rise + jag);
}
const wallMats = {
  normal: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  agartha: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x120c26 }),
};
function addWallChunk(z0) {
  const pal = WALL_COLORS[zone] || WALL_COLORS.normal, pos = [], col = [], c = new THREE.Color();
  const alpine = zone === 'normal', all = alpine ? ALPINE_COLS : WALL_COLS;
  const cols = LOW ? all.filter((o, i) => i < 2 || i % 2 === 1 || i === all.length - 1) : all;   // Low: half the wall detail
  const rows = WALL_CHUNK / 4 + 1, a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  for (const side of [-1, 1]) {
    const P = [];
    for (let r = 0; r < rows; r++) {
      const z = z0 - r * 4;
      P.push(cols.map((o, k) => {
        const shift = alpine && k > 1 ? Math.sin(z * 1.713 + k * 8.37 + side) * Math.min(1.4, o * 0.08) : 0;
        const x = side * (WALL_IN + o + shift);
        return [x, o < 0 ? -0.15 : wallH(x, z), z];
      }));
    }
    for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols.length - 1; k++) {
      for (let [p0, p1, p2] of [[P[r][k], P[r + 1][k], P[r][k + 1]], [P[r][k + 1], P[r + 1][k], P[r + 1][k + 1]]]) {
        a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); b.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
        n.crossVectors(a, b); if (n.y < 0) { [p1, p2] = [p2, p1]; n.negate(); }   // always face up / into the valley
        n.normalize();
        const h = (p0[1] + p1[1] + p2[1]) / 3, hash = Math.sin(p0[0] * 12.9 + p0[2] * 78.2) * 43758.5 % 1;
        // flat-ish or high faces hold snow; steep faces show rock (with glowing veins underground)
        if (alpine) {
          // Snow blankets the foothills; only steep faces on the upper ridges expose pale slate.
          if (n.y > 0.69 || h < 13 || h > 64) c.set(0xedf4f8);
          else c.set(0xa1b1c0);
          c.multiplyScalar(0.985 + Math.abs(hash) * 0.025);
        }
        else if (n.y > (pal.snowSlope ?? 0.82) || h > pal.snowLine + hash * 6) c.set(pal.snow);
        else if (pal.vein && Math.abs(hash) < 0.06) c.set(pal.vein);
        else c.set(pal.rock[Math.abs(hash) < 0.5 ? 0 : 1]);
        for (const q of [p0, p1, p2]) { pos.push(q[0], q[1], q[2]); col.push(c.r, c.g, c.b); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, wallMats[zone] || wallMats.normal);
  world.add(m); decor.push({ z: z0 - WALL_CHUNK, mesh: m, dispose: g });
}
function spawnWalls(toZ) {
  if (mode === 'race') return;
  while (wallZ > toZ) { addWallChunk(wallZ); wallZ -= WALL_CHUNK; }
}

// the cave: a mountain beside the slope with a glowing mouth you can ride into
const caveRock = lam(0x737d8c), caveSnow = lam(0xf2f7fb), caveDark = new THREE.MeshBasicMaterial({ color: 0x07020f });
const caveGlow = lam(0x7b2cbf, { emissive: 0x9d4edd, emissiveIntensity: 1 }), caveCrystal = lam(0x3cf2ff, { emissive: 0x1aa6b8, emissiveIntensity: 1 });
const caveSignTex = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d');
  g.fillStyle = '#1b0b33'; g.fillRect(0, 0, 256, 96); g.strokeStyle = '#7cf7d4'; g.lineWidth = 5; g.strokeRect(4, 4, 248, 88);
  g.fillStyle = '#7cf7d4'; g.font = '900 40px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('AGARTHA', 128, 50);
  g.fillStyle = '#ffd166'; g.font = '800 20px system-ui, sans-serif'; g.fillText('x2 POINTS', 128, 80);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
// the next special world's entrance: alternates between the Agartha cave and the North Pole gate
function featureEntrance(z) {
  const w = nextWorld; nextWorld = w === 'agartha' ? 'xmas' : 'agartha';
  return w === 'xmas' ? featureXmasGate(z) : featureCave(z);
}
const northTex = (() => {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#d62839'; g.fillRect(0, 0, 512, 128); g.fillStyle = '#ffd23f'; g.fillRect(0, 0, 512, 10); g.fillRect(0, 118, 512, 10);
  g.fillStyle = '#fff'; g.font = '900 64px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('NORTH POLE', 256, 84);
  g.fillStyle = '#ffd23f'; g.font = '800 22px system-ui, sans-serif'; g.fillText('x2 POINTS  ★  THIS WAY', 256, 112);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
function featureXmasGate(z) {
  const side = crng() < 0.5 ? -1 : 1, mz = z - 70, cx = side * 10.5;
  const g = new THREE.Group(); g.position.set(0, 0, mz);
  // two giant candy canes, a banner, a wreath, presents piled at the feet, and a glowing portal between them
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 14; i++) { const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 10), i % 2 ? lam(0xffffff) : candyPost); seg.position.set(cx + sx * 3.4, 0.3 + i * 0.6, 0); g.add(seg); }
    const hook = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.55, 8, 12, Math.PI), candyPost); hook.position.set(cx + sx * 3.4 - sx * 1.1, 8.4, 0); hook.rotation.y = sx > 0 ? 0 : Math.PI; g.add(hook);
  }
  const banner = new THREE.Mesh(box(7.4, 1.6, 0.15), [candyPost, candyPost, candyPost, candyPost, new THREE.MeshBasicMaterial({ map: northTex }), candyPost]); banner.position.set(cx, 7.2, 0); g.add(banner);
  const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.3, 8, 16), lam(0x1f7a3d)); wreath.position.set(cx, 9.4, 0); g.add(wreath);
  const bow = new THREE.Mesh(box(0.6, 0.4, 0.2), candyPost); bow.position.set(cx, 8.5, 0.1); g.add(bow);
  const shimmer = new THREE.Mesh(new THREE.PlaneGeometry(6, 6.4), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  shimmer.position.set(cx, 3.2, -0.2); g.add(shimmer);
  for (const [dx, dz, sc] of [[-4.6, 1, 0.8], [-5.4, -0.4, 0.55], [4.7, 0.8, 0.7], [5.6, -0.6, 0.9], [4.2, 2.2, 0.5]]) {
    const gx = cx + dx; if (Math.abs(gx) < 13.6) continue;   // keep the slope itself clear
    const gift = new THREE.Mesh(box(1.6 * sc, 1.6 * sc, 1.6 * sc), Math.random() < 0.5 ? candyPost : lam(0x2a9d4f)); gift.position.set(gx, 0.8 * sc, dz); g.add(gift);
  }
  // sign and arrows pointing into the gate
  const sign = new THREE.Group(); sign.position.set(side * 3.5, 0, 32); g.add(sign);
  for (const sx of [-1.1, 1.1]) { const post = new THREE.Mesh(box(0.15, 2.6, 0.15), candyPost); post.position.set(sx, 1.3, 0); sign.add(post); }
  const board = new THREE.Mesh(box(3.2, 0.8, 0.1), [candyPost, candyPost, candyPost, candyPost, new THREE.MeshBasicMaterial({ map: northTex }), candyPost]); board.position.y = 2.6; sign.add(board);
  for (const [t, zz] of [[0.25, 22], [0.55, 13], [0.85, 5]]) {
    const ch = chevron(bulbMats[2], 1.6, 0.3); ch.rotation.x = -Math.PI / 2; ch.rotation.z = -side * 0.9; ch.position.set(cx * t, 0.06, zz); g.add(ch);
  }
  world.add(g); decor.push({ z: mz - 10, mesh: g });
  caves.push({ x: cx, z: mz, used: false, to: 'xmas' });
  keepClear(cx / 2, Math.abs(cx) / 2 + 3, mz + 45, mz - 3);
  for (const sx of [3.4, -3.4]) { const px = cx + sx; if (Math.abs(px) < 13.5) obstacles.push({ kind: 'cane', x: px, z: mz, r: 0.6, h: 9, mesh: new THREE.Group() }); }
  for (let i = 0; i < 12; i++) { const t = i / 11; addCoin(cx * (1 - Math.cos(Math.PI * t)) / 2, 1.2, mz + 40 - t * 40); }
  return [90, 0];
}
function featureCave(z) {
  const side = crng() < 0.5 ? -1 : 1, mz = z - 70, cx = side * 10.5;
  const g = new THREE.Group(); g.position.set(0, 0, mz);
  const R = (geo, m, x, y, zz, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, zz); o.scale.set(sx, sy, sz); g.add(o); return o; };
  // the mountain stays outside the slope (|x| > 13.5) apart from the arch around the mouth
  R(new THREE.ConeGeometry(26, 42, 7), caveRock, side * 38, 19, -22);
  R(new THREE.ConeGeometry(10.5, 16, 7), caveSnow, side * 38, 33.2, -22);
  R(new THREE.DodecahedronGeometry(8, 0), caveRock, side * 25, 6, -8, 1, 1.3, 1.2);
  R(new THREE.DodecahedronGeometry(6, 0), caveRock, side * 18, 9, -18);
  R(new THREE.DodecahedronGeometry(3.6, 0), caveSnow, side * 18, 14.5, -18, 1, 0.5, 1);
  R(box(1.6, 7, 3.5), caveRock, side * 7, 3.5, -0.8);                     // inner pillar of the mouth
  R(box(1.6, 7, 3.5), caveRock, side * 14, 3.5, -0.8);                    // outer pillar
  R(box(8.6, 2.4, 4), caveRock, cx, 7.6, -0.8);                           // lintel
  R(new THREE.DodecahedronGeometry(4, 0), caveRock, cx, 10.2, -2.5, 1.4, 0.8, 1);
  R(new THREE.DodecahedronGeometry(2.6, 0), caveSnow, cx, 12.6, -2.5, 1.3, 0.4, 1);
  R(box(5.6, 6.4, 0.4), caveDark, cx, 3.2, -2.6);                         // the dark mouth
  R(box(4.2, 4.6, 0.1), caveGlow, cx, 2.6, -2.3);                          // purple glow deep inside
  for (const [dx, y, s] of [[-2.2, 0.6, 1.4], [2.3, 0.5, 1.2], [-1.6, 6, 0.8], [1.8, 5.8, 0.9]]) {
    const c = R(new THREE.OctahedronGeometry(0.5, 0), caveCrystal, cx + dx, y, -1.6, s, s * 2, s); c.rotation.z = dx * 0.15;
  }
  // sign and glowing arrows on the snow pointing into the mouth
  const sign = new THREE.Group(); sign.position.set(side * 3.5, 0, 32); g.add(sign);
  for (const sx of [-1.1, 1.1]) { const post = new THREE.Mesh(box(0.15, 2.6, 0.15), postMat); post.position.set(sx, 1.3, 0); sign.add(post); }
  const board = new THREE.Mesh(box(3, 1.15, 0.1), [postMat, postMat, postMat, postMat, new THREE.MeshBasicMaterial({ map: caveSignTex }), postMat]); board.position.y = 2.7; sign.add(board);
  for (const [t, zz] of [[0.25, 22], [0.55, 13], [0.85, 5]]) {
    const ch = chevron(caveGlow, 1.6, 0.3); ch.rotation.x = -Math.PI / 2; ch.rotation.z = -side * 0.9; ch.position.set(cx * t, 0.06, zz); g.add(ch);
  }
  world.add(g); decor.push({ z: mz - 40, mesh: g });
  caves.push({ x: cx, z: mz, used: false, to: 'agartha' });
  keepClear(cx / 2, Math.abs(cx) / 2 + 3, mz + 45, mz - 3);
  for (const sx of [7, 14]) obstacles.push({ kind: 'rock', x: side * sx, z: mz - 0.8, r: 0.9, h: 7, mesh: new THREE.Group() });
  for (let i = 0; i < 12; i++) { const t = i / 11; addCoin(cx * (1 - Math.cos(Math.PI * t)) / 2, 1.2, mz + 40 - t * 40); }
  return [90, 0];
}
// the way back out of Agartha: a ring of light across the whole slope
function addPortal(z) {
  const g = new THREE.Group(); g.position.set(0, 0, z);
  const rc = WORLDS[zone]?.ring ?? 0xffd166;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(13.5, 0.7, 8, 40), lam(rc, { emissive: rc, emissiveIntensity: 0.9 })); ring.position.y = 4; g.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(13, 40), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  disc.position.y = 4; g.add(disc);
  world.add(g); decor.push({ z: z - 5, mesh: g });
  portal = { z, mesh: g, disc };
  keepClear(0, Infinity, z + 35, z - 5);
}
function pickSpecial() {
  const w = [['ramp', 16], ['big', 12], ['rollers', 9], ['table', 9], ['stepdown', 6], ['mega', 6], ['line', 9], ['rail', 9], ['railKick', 7], ['rocks', 8], ['snake', 7]];
  if (zone === 'xmas') w.push(['slalom', 10], ['logs', 7]);   // decorated-tree slaloms and yule logs
  let r = crng() * w.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of w) if ((r -= v) < 0) return k;
  return 'ramp';
}
const raceDayBefore = day => race.day < day;
function pickFeature(d) {
  const race_ = mode === 'race';
  const w = [
    ['ramp', 16], ['big', 10], ['rollers', 9], ['table', 8], ['stepdown', d > 0.05 ? 5 : 0], ['mega', d > 0.1 ? 4 : 0], ['line', 7], ['rail', 10], ['railKick', 7], ['rocks', 9 + 5 * d], ['slalom', 10 + 6 * d], ['snake', race_ ? 6 - 4 * d : 3 - 2 * d],
    // crevasses are gone; the daily race keeps today's course as it was until tomorrow
    ['crevasse', race_ && raceDayBefore('2026-10-23') && d > 0.05 ? 7 + 10 * d : 0],
    ['gapRail', race_ ? 0 : 8], ['garden', race_ ? 0 : 7], ['proLine', race_ ? 0 : 9], ['jibLine', race_ ? 0 : 7], ['logs', d > 0.02 ? 6 + 10 * d : 0], ['balls', d > 0.12 ? 12 * d : 0], ['field', d > 0.2 ? 12 * d : 0],
    ['bear', mode === 'race' ? 0 : d > 0.08 ? 6 : 0],
  ];
  // featureWeights in config.js can change how often each thing shows up in Endless (0 = never)
  const cw = !race_ && window.PEAKFLIP_CONFIG?.featureWeights || {};
  for (const e of w) if (Number.isFinite(cw[e[0]])) e[1] = Math.max(0, cw[e[0]]);
  let r = crng() * w.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of w) if ((r -= v) < 0) return k;
  return 'ramp';
}
// the attract-mode bot only gets the showy features: kickers, rails, tables, trampolines
const DEMO_FEATURES = [['ramp', 14], ['big', 12], ['mega', 5], ['line', 8], ['rail', 8], ['railKick', 8], ['table', 7], ['stepdown', 6], ['rollers', 4], ['snake', 3]];
function pickDemo() {
  let r = Math.random() * DEMO_FEATURES.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of DEMO_FEATURES) if ((r -= v) < 0) return k;
  return 'ramp';
}
let forcedFeature = null;   // for testing: window.__game.forceFeature('garden')
function spawnFeature() {
  const z = spawnZ, D = -z, sp = baseSpeed(D);
  let d = clamp(D / 1600, 0, 1), k;
  if (mode === 'level') {
    // the level's own sequence, then the finish line
    if (D > level.def.len - 40) { if (!finish) addFinish(-level.def.len); spawnZ -= 400; return; }
    k = level.def.seq[level.idx++ % level.def.seq.length]; d = level.def.d * levelDiff().dK;
  } else {
    if (mode === 'race' && D > RACE_LEN - 40) { if (!finish) addFinish(-RACE_LEN); spawnZ -= 400; return; }
    if (mode !== 'race') {
      if (special()) { if (D > -zoneEndZ - 60) { if (!portal) addPortal(zoneEndZ); spawnZ -= 80; return; } }
      else if (D > nextCaveD) { nextCaveD = Infinity; spawnZ -= featureEntrance(z)[0]; return; }
    }
    k = forcedFeature || (special() ? pickSpecial() : demo ? pickDemo() : pickFeature(mode === 'race' ? Math.min(1, d * 1.6) : d)); forcedFeature = null;
  }
  const f = {
    ramp: () => featureRamp(z, false, sp), big: () => featureRamp(z, true, sp), rail: () => featureRail(z, sp, false), railKick: () => featureRail(z, sp, true),
    rocks: () => featureRocks(z, d), slalom: () => featureSlalom(z, d), snake: () => featureCoinSnake(z), crevasse: () => featureCrevasse(z, d),
    logs: () => featureLogs(z, d), balls: () => featureBalls(z, d), field: () => featureField(z, d),
    rollers: () => featureRollers(z, d), table: () => featureTabletop(z, sp, d), stepdown: () => featureStepDown(z, sp),
    mega: () => featureMega(z, sp), line: () => featureKickerLine(z, sp),
    bear: () => featureBear(z, d),
    gapRail: () => featureGapRail(z, sp), garden: () => featureRailGarden(z), proLine: () => featureProLine(z, sp), jibLine: () => featureJibLine(z, sp),
  }[k];
  const [len, gx] = f();
  // extra scattered hazards get more common the further you go
  // (hard levels scatter them around the jumps and rails too; their run-ups stay clear)
  if (!demo && (hardLevel() || !['ramp', 'big', 'railKick', 'crevasse', 'mega', 'line', 'table', 'stepdown', 'rollers', 'gapRail', 'garden', 'proLine', 'jibLine'].includes(k)) && crng() < (mode === 'level' ? levelDiff().extra + d * 0.3 : 0.12 + d * 0.4)) {
    for (let i = 0, n = 1 + Math.floor(d * 2.5) + (mode === 'level' ? levelDiff().more : 0); i < n; i++) addRock(wr(-12, 12), z - wr(5, len - 5), wr(0.6, 1));
  }
  spawnZ -= len;
}
const cabinWall = lam(0x8a5a35), cabinRoof = lam(0x3b4a5a);
// one merged mesh per tower (pole, bar, cables, four chairs) instead of ~20 separate draw calls
const liftGeo = (() => {
  const parts = [
    { geo: new THREE.BoxGeometry(0.45, 11, 0.45), color: 0x5b6573, m: T(0, 5.5, 0) },
    { geo: new THREE.BoxGeometry(5, 0.3, 0.3), color: 0x5b6573, m: T(0, 11, 0) },
  ];
  for (const sx of [-2.2, 2.2]) {
    parts.push({ geo: new THREE.BoxGeometry(0.05, 0.05, 48), color: 0x5b6573, m: T(sx, 10.8, -24) });
    for (const cz of [-12, -36]) {
      const z = cz + (sx > 0 ? 6 : 0);
      parts.push({ geo: new THREE.BoxGeometry(0.06, 1.6, 0.06), color: 0x5b6573, m: T(sx, 10.0, z) });
      parts.push({ geo: new THREE.BoxGeometry(1.2, 0.12, 0.5), color: 0xe63946, m: T(sx, 9.2, z) });
      parts.push({ geo: new THREE.BoxGeometry(1.2, 0.5, 0.1), color: 0xe63946, m: T(sx, 9.45, z + 0.22) });
    }
  }
  return merged(parts);
})();
function addLiftTower(z) {
  // Keep the lift on the flat shoulder just outside the run so its supports and cable follow the same slope.
  const m = new THREE.Mesh(liftGeo, vcol); m.position.set(-17.5, 0, z);
  world.add(m); decor.push({ z: z - 50, mesh: m });
  solids.push({ x: -17.5, z, hx: 0.45, hz: 0.45, h: 11, name: 'Hit a lift tower' });
}
// things standing off the side of the run that you can now ski into (off-road)
let solids = [];
const offroadOK = () => mode === 'endless' && zone === 'normal' && !demo;
const edgeX = () => offroadOK() ? OFF_LIMIT : X_LIMIT;
function addCabin(x, z, rotation = rand(-0.4, 0.4), secret = false) {
  const g = new THREE.Group(); g.position.set(x, wallH(x, z), z); g.rotation.y = rotation;
  if (secret) { addSecretDoor(g, x, z); solids.push({ x, z, hx: 2.1, hz: 1.8, h: 4.5, name: 'Ran into a cabin' }); }
  const w = new THREE.Mesh(box(4, 2.6, 3.4), cabinWall); w.position.y = 1.3; g.add(w);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.8, 4), cabinRoof); roof.position.y = 3.5; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.8); g.add(roof);
  const snow = new THREE.Mesh(new THREE.ConeGeometry(3.1, 0.7, 4), mat.snow); snow.position.y = 4.15; snow.rotation.y = Math.PI / 4; snow.scale.set(1, 1, 0.8); g.add(snow);
  const win = new THREE.Mesh(box(0.9, 0.7, 0.05), lam(0xffd166, { emissive: 0x7a5a00 })); win.position.set(0, 1.5, 1.72); g.add(win);
  world.add(g); decor.push({ z: z - 4, mesh: g });
}
// ---------- Easter egg: the secret cabin. Ride into its side door and meet who lives there... then run ----------
// The face on the suited guy is read from secret/bibi.png (drop your own picture there); until then a cartoon face stands in.
let secretCabin = null;
const doorMat = lam(0x4a2c17), doorDark = new THREE.MeshBasicMaterial({ color: 0x1a0d05 }), doorLight = new THREE.MeshBasicMaterial({ color: 0xffb04a });
function addSecretDoor(g, x, z) {
  // a door in the wall that faces the run, left ajar with firelight spilling out, and a doormat
  const frame = new THREE.Mesh(box(0.12, 2.1, 1.5), doorMat); frame.position.set(-2.02, 1.05, 0); g.add(frame);
  const glow = new THREE.Mesh(box(0.05, 1.8, 1.1), doorLight); glow.position.set(-2.06, 0.95, 0); g.add(glow);
  const leaf = new THREE.Mesh(box(0.08, 1.8, 1.1), doorMat); leaf.position.set(-2.35, 0.95, 0.45); leaf.rotation.y = -0.9; g.add(leaf);
  const mat_ = new THREE.Mesh(box(1, 0.04, 1.3), lam(0x9b2226)); mat_.position.set(-2.6, 0.02, 0); g.add(mat_);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.36), new THREE.MeshBasicMaterial({ map: knockTex, transparent: true })); sign.rotation.y = -Math.PI / 2; sign.position.set(-2.1, 2.3, 0); g.add(sign);
  secretCabin = { x: x - 2, z, used: false };
  keepClear(X_LIMIT, 4, z + 30, z - 3);
}
const knockTex = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 100; const g = c.getContext('2d');
  g.fillStyle = '#5a3418'; g.fillRect(0, 0, 256, 100); g.strokeStyle = '#2b170a'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 92);
  g.fillStyle = '#ffe2a0'; g.font = '900 34px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('COME IN :)', 128, 62);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const nearSecretDoor = () => secretCabin && !secretCabin.used && p.x > 0 && Math.abs(p.z - secretCabin.z) < 14;

// ---- the two residents ----
const bibiFace = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 300; const g = c.getContext('2d');
  g.fillStyle = '#e8b796'; g.beginPath(); g.ellipse(128, 160, 100, 125, 0, 0, TAU); g.fill();
  g.fillStyle = '#c9ccd1'; for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(128 + sx * 92, 120, 22, 60, sx * 0.2, 0, TAU); g.fill(); }
  g.beginPath(); g.ellipse(128, 48, 80, 28, 0, Math.PI, TAU); g.fill();
  g.fillStyle = '#444'; for (const sx of [-1, 1]) g.fillRect(128 + sx * 42 - 22, 112, 44, 9);
  g.fillStyle = '#fff'; for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(128 + sx * 42, 140, 18, 12, 0, 0, TAU); g.fill(); }
  g.fillStyle = '#2a3a55'; for (const sx of [-1, 1]) { g.beginPath(); g.arc(128 + sx * 42, 141, 7, 0, TAU); g.fill(); }
  g.strokeStyle = '#a8705a'; g.lineWidth = 5; g.beginPath(); g.moveTo(128, 150); g.lineTo(118, 196); g.lineTo(132, 198); g.stroke();
  g.strokeStyle = '#7a3b2e'; g.lineWidth = 7; g.beginPath(); g.arc(128, 214, 34, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const bibiFaceMat = new THREE.MeshBasicMaterial({ map: bibiFace, transparent: true, alphaTest: 0.05 });
let bibiTried = false;
function loadBibi() {
  if (bibiTried) return; bibiTried = true;
  new THREE.TextureLoader().load('secret/bibi.png', t => { t.colorSpace = THREE.SRGBColorSpace; bibiFaceMat.map = t; bibiFaceMat.needsUpdate = true; }, undefined, () => {});
}
const wood = lam(0xb98250), woodDark = lam(0x6b4423), woodRing = lam(0xe0b07a), suit = lam(0x1f2a44), shirt = lam(0xf4f4f4), tie = lam(0x1d4ed8), skin = lam(0xe8b796), hairGrey = lam(0xc9ccd1);
const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xffffff }), pupil = new THREE.MeshBasicMaterial({ color: 0x111111 });
const glassMat = new THREE.MeshLambertMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.35 }), milkMat = lam(0x7b4a2a), strawMat = lam(0xff4fa3);
const bangTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#ff2d2d'; g.strokeStyle = '#fff'; g.lineWidth = 6; g.font = '900 120px system-ui, sans-serif'; g.textAlign = 'center';
  g.strokeText('!', 32, 112); g.fillText('!', 32, 112);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
function chocolateMilk() {
  const g = new THREE.Group();
  const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.26, 10), glassMat); gl.position.y = 0.13; g.add(gl);
  const milk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.068, 0.2, 10), milkMat); milk.position.y = 0.11; g.add(milk);
  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 5), strawMat); straw.position.set(0.03, 0.27, 0); straw.rotation.z = -0.25; g.add(straw);
  return g;
}
// a resident: origin at the feet, front facing +z. Returns the limbs so the cutscene and the chase can pose them.
function makeResident(kind) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const M = (geo, m, x, y, z, parent = body) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };
  const limb = (x, y, geo, m, len, parent = body) => { const pv = new THREE.Group(); pv.position.set(x, y, 0); parent.add(pv); M(geo, m, 0, -len / 2, 0, pv); return pv; };
  let legs, arms, head, hipY, glass, bat;
  if (kind === 'tung') {
    // Tung Tung Tung Sahur: a tall wooden log with a face, skinny limbs and a baseball bat
    hipY = 0.75;
    M(new THREE.CylinderGeometry(0.36, 0.4, 1.45, 12), wood, 0, 1.47, 0);
    M(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 12), woodRing, 0, 2.2, 0);
    for (const y of [1.0, 1.3, 1.95]) M(new THREE.TorusGeometry(0.39, 0.012, 3, 16), woodDark, 0, y, 0).rotation.x = Math.PI / 2;
    head = new THREE.Group(); head.position.set(0, 1.75, 0); body.add(head);
    for (const sx of [-1, 1]) {
      M(new THREE.SphereGeometry(0.1, 10, 8), eyeWhite, sx * 0.14, 0.02, 0.33, head).scale.z = 0.5;
      M(new THREE.SphereGeometry(0.045, 8, 6), pupil, sx * 0.13, 0.01, 0.38, head);
      M(box(0.17, 0.045, 0.04), woodDark, sx * 0.15, 0.15, 0.37, head).rotation.z = sx * 0.3;   // angry brows
    }
    M(box(0.18, 0.035, 0.03), woodDark, 0, -0.2, 0.38, head);
    legs = [-1, 1].map(sx => limb(sx * 0.16, hipY, new THREE.CylinderGeometry(0.045, 0.045, 0.75, 6), woodDark, 0.75));
    arms = [-1, 1].map(sx => limb(sx * 0.42, 1.65, new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), woodDark, 0.7));
    bat = new THREE.Group(); bat.position.set(0, -0.68, 0.05); arms[1].add(bat);
    M(new THREE.CylinderGeometry(0.07, 0.035, 0.95, 8), woodRing, 0, 0.42, 0, bat);
    glass = chocolateMilk(); glass.position.set(0, -0.72, 0.06); arms[0].add(glass);
  } else {
    // the guy in the suit, with a cardboard-cutout face
    hipY = 0.88;
    M(box(0.62, 0.8, 0.34), suit, 0, 1.28, 0);
    M(box(0.2, 0.55, 0.02), shirt, 0, 1.4, 0.175); M(box(0.07, 0.42, 0.02), tie, 0, 1.36, 0.19);
    M(box(0.14, 0.12, 0.14), skin, 0, 1.74, 0);
    head = new THREE.Group(); head.position.set(0, 2.0, 0); body.add(head);
    M(box(0.44, 0.5, 0.36), hairGrey, 0, 0, -0.03, head);
    M(new THREE.PlaneGeometry(0.66, 0.78), bibiFaceMat, 0, 0, 0.17, head);
    legs = [-1, 1].map(sx => limb(sx * 0.16, hipY, box(0.2, 0.88, 0.22), suit, 0.88));
    for (const l of legs) M(box(0.22, 0.1, 0.32), pupil, 0, -0.86, 0.05, l);
    arms = [-1, 1].map(sx => limb(sx * 0.4, 1.62, box(0.15, 0.68, 0.17), suit, 0.68));
    glass = chocolateMilk(); glass.position.set(0, -0.72, 0.06); arms[1].add(glass);
  }
  const bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: bangTex, transparent: true, depthTest: false })); bang.scale.set(0.35, 0.7, 1); bang.position.set(0, 2.75, 0); bang.visible = false; g.add(bang);
  return { g, body, legs, arms, head, hipY, glass, bat, bang, kind };
}
function poseSit(r, sip) {
  r.body.position.y = 0.5 - r.hipY;
  for (const l of r.legs) l.rotation.x = -Math.PI / 2;
  const cup = r.kind === 'tung' ? r.arms[0] : r.arms[1], other = r.arms[r.kind === 'tung' ? 1 : 0];
  cup.rotation.x = -0.9 - sip * 1.6; cup.rotation.z = (r.kind === 'tung' ? 1 : -1) * sip * 0.5;
  r.glass.rotation.x = 0.9 + sip * 1.4;
  other.rotation.x = r.bat ? -0.4 : -0.2;
  if (r.bat) r.bat.rotation.x = 1.1;
}
function poseRun(r, t) {
  const s = Math.sin(t * 15);
  r.body.position.y = Math.abs(Math.cos(t * 15)) * 0.12;
  r.legs[0].rotation.x = s * 0.9; r.legs[1].rotation.x = -s * 0.9;
  r.arms[0].rotation.x = -s * 1.1; r.arms[1].rotation.x = s * 1.1;
  r.arms[0].rotation.z = r.arms[1].rotation.z = 0;
  r.glass.rotation.x = 0;
  if (r.bat) { r.arms[1].rotation.x = -2.6 + Math.sin(t * 9) * 0.6; r.bat.rotation.x = 0.4; }   // bat raised, ready to tung
}

// ---- the inside of the cabin: a separate little scene, lit by the fire ----
const cabinScene = new THREE.Scene(); cabinScene.background = new THREE.Color(0x1a0e07);
const cabinCam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 60);
const fireLight = new THREE.PointLight(0xff8a2a, 3, 16, 1);
const fireParts = [];
const cabinFolks = [makeResident('bibi'), makeResident('tung')];
(() => {
  const S = cabinScene, A = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); S.add(o); return o; };
  S.add(new THREE.HemisphereLight(0xffd6a8, 0x3a2414, 0.55));
  fireLight.position.set(0, 1.3, 0); S.add(fireLight);
  const logA = lam(0x8a5a35), logB = lam(0x76492a), floor = lam(0x5e3a1e), stone = lam(0x8d8f94), stoneDark = lam(0x55575c);
  A(box(11, 0.1, 15), floor, 0, -0.05, 2);
  for (let i = -5; i <= 5; i++) A(box(0.03, 0.02, 15), woodDark, i, 0.005, 2);
  // log walls
  for (let i = 0; i < 9; i++) {
    const y = 0.2 + i * 0.4, m = i % 2 ? logA : logB;
    A(new THREE.CylinderGeometry(0.21, 0.21, 11, 8), m, 0, y, -4.6).rotation.z = Math.PI / 2;
    for (const sx of [-1, 1]) A(new THREE.CylinderGeometry(0.21, 0.21, 15, 8), m, sx * 5.4, y, 2).rotation.x = Math.PI / 2;
  }
  A(box(11, 0.15, 15), lam(0x3e2613), 0, 3.6, 2);
  for (const z of [-3, 0, 3, 6]) A(box(11, 0.3, 0.3), woodDark, 0, 3.4, z);
  // a window onto the snowy night, antlers above it, a shelf of mugs
  A(box(1.8, 1.2, 0.05), new THREE.MeshBasicMaterial({ color: 0x1b2f5c }), -2.6, 2, -4.38);
  A(box(1.9, 0.08, 0.1), lam(0xf5f9fc), -2.6, 1.42, -4.34); A(box(0.08, 1.25, 0.08), woodDark, -2.6, 2, -4.33); A(box(1.85, 0.08, 0.08), woodDark, -2.6, 2, -4.33);
  for (let i = 0; i < 14; i++) A(new THREE.SphereGeometry(0.025, 4, 3), eyeWhite, -2.6 + rand(-0.8, 0.8), 2 + rand(-0.5, 0.5), -4.34);
  for (const sx of [-1, 1]) { const an = A(new THREE.ConeGeometry(0.05, 0.7, 5), woodRing, 2.6 + sx * 0.3, 3.0, -4.4); an.rotation.z = -sx * 0.6; }
  A(box(0.35, 0.3, 0.15), woodDark, 2.6, 2.75, -4.4);
  A(box(2, 0.08, 0.4), woodDark, 2.6, 1.9, -4.25);
  for (let i = 0; i < 4; i++) A(new THREE.CylinderGeometry(0.09, 0.08, 0.2, 8), [lam(0xe63946), lam(0x1d70d6), lam(0xffd166), lam(0x2a9d4f)][i], 1.9 + i * 0.45, 2.04, -4.25);
  A(new THREE.CylinderGeometry(2.2, 2.2, 0.02, 24), lam(0x9b2226), 0, 0.01, 0.6);
  // the fireplace: a low stone hearth in the middle of the room with a fire on top
  A(box(2.4, 0.7, 1.5), stone, 0, 0.35, 0);
  A(box(2.6, 0.12, 1.7), stoneDark, 0, 0.74, 0);
  for (let i = 0; i < 3; i++) { const lg = A(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 6), logA, 0, 0.88, -0.25 + i * 0.25); lg.rotation.z = Math.PI / 2; lg.rotation.y = (i - 1) * 0.5; }
  [[0xff4a12, 0.3, 0.7], [0xff9a1a, 0.22, 0.55], [0xffe066, 0.12, 0.38]].forEach(([c, r, h], i) => {
    for (let k = 0; k < 3; k++) {
      const f = A(new THREE.ConeGeometry(r * (k === 1 ? 1 : 0.7), h, 6), new THREE.MeshBasicMaterial({ color: c }), (k - 1) * 0.38, 0.85 + h / 2, (k - 1) * 0.05 + i * 0.02);
      fireParts.push({ m: f, h, ph: rand(0, 6) });
    }
  });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff9a3c, transparent: true, depthWrite: false, opacity: 0.7, blending: THREE.AdditiveBlending }));
  halo.scale.set(4, 4, 1); halo.position.set(0, 1.3, 0); S.add(halo);
  // a sofa behind the fire, where the two of them sit
  const sofa = lam(0x2f5d50);
  A(box(3.2, 0.45, 1.0), sofa, 0, 0.25, -2.6); A(box(3.2, 0.9, 0.3), sofa, 0, 0.75, -3.05);
  for (const sx of [-1, 1]) A(box(0.3, 0.7, 1.0), sofa, sx * 1.65, 0.45, -2.6);
  cabinFolks.forEach((r, i) => { r.g.position.set(i ? 0.7 : -0.7, 0, -2.75); S.add(r.g); });
})();

// ---- the cutscene: in through the door, they notice you, and come for you ----
const cabin = { phase: '', t: 0 };
function enterCabin() {
  state = 'cabin'; cabin.phase = 'in'; cabin.t = 0; loadBibi();
  const f = $('fade'); f.style.transition = 'opacity 0.45s ease-in'; f.style.background = '#000'; f.style.opacity = 1;
  Sfx.tone(300, 0.25, 'triangle', 0.12, 120); Sfx.noise(0.4, 0.25, 600);
  p.trickScore += 2500; showTrick('SECRET CABIN!', '+2,500', true);
}
function updateCabin(dt) {
  cabin.t += dt;
  const t = cabin.t, [bibi, tung] = cabinFolks;
  if (cabin.phase === 'in') {
    // ride on into the doorway while the screen goes dark
    p.x += 6 * dt; p.z -= p.speed * 0.3 * dt; p.y = 0;
    updateSkierVisual(dt); updateCamera(dt);
    renderer.render(scene, camera);
    if (t > 0.55) {
      cabin.phase = 'inside'; cabin.t = 0;
      fadeScreen('#000');
      for (const r of cabinFolks) { r.g.position.z = -2.75; r.g.position.x = r.kind === 'tung' ? 0.7 : -0.7; r.g.rotation.y = 0; r.bang.visible = false; }
    }
    return;
  }
  // fire flicker
  for (const f of fireParts) f.m.scale.set(1, 0.75 + 0.35 * Math.abs(Math.sin(time * 9 + f.ph) + 0.4 * Math.sin(time * 23 + f.ph)), 1);
  fireLight.intensity = 3 + Math.sin(time * 17) * 0.4 + Math.sin(time * 41) * 0.25;
  if (Math.random() < dt * 6) Sfx.noise(0.04, 0.12, 3200, 'highpass');
  const NOTICE = 4.2, RUN = 5.1, OUT = 6.6;
  cabinCam.aspect = camera.aspect;
  let fov = 62;
  if (t < NOTICE) {
    // a slow swoop from the doorway in towards the fire; they sip their chocolate milk
    const k = 1 - Math.pow(1 - Math.min(1, t / 3.2), 3);
    cabinCam.position.set(lerp(3.2, 0.6, k), lerp(2.9, 2.35, k), lerp(8.5, 4.2, k));
    cabinCam.lookAt(0, lerp(1.6, 1.45, k), lerp(-1.5, -2.7, k));
    cabinCam.rotateZ(Math.sin(t * 0.9) * 0.03);
    fov = lerp(75, 58, k);
    poseSit(bibi, Math.max(0, Math.sin(t * 2.1)) ** 2);
    poseSit(tung, Math.max(0, Math.sin(t * 2.1 + 2.4)) ** 2);
    for (const r of cabinFolks) r.head.rotation.set(0, Math.sin(t * 0.8 + r.g.position.x) * 0.25, 0);
    if (Math.floor(t * 2.1 / Math.PI) !== Math.floor((t - dt) * 2.1 / Math.PI)) Sfx.noise(0.3, 0.18, 900);   // slurp
  } else if (t < RUN) {
    // they freeze and stare straight at you
    if (!bibi.bang.visible) {
      for (const r of cabinFolks) { r.bang.visible = true; r.head.rotation.set(0, 0, 0); }
      Sfx.tone(880, 0.12, 'square', 0.16); Sfx.tone(880, 0.12, 'square', 0.16, null, 0.15);
      Sfx.tone(196, 0.9, 'sawtooth', 0.18, 98, 0.3);
    }
    for (const r of cabinFolks) { r.bang.position.y = 2.75 + Math.abs(Math.sin(t * 18)) * 0.12; poseSit(r, 0); }
    cabinCam.position.set(0.15, 2.25, lerp(4.2, 2.6, Math.min(1, (t - NOTICE) * 4)));
    cabinCam.lookAt(0, 1.75, -2.7);
    fov = 46;
  } else {
    // up and over the hearth, straight at the camera
    if (bibi.bang.visible) { for (const r of cabinFolks) r.bang.visible = false; showTrick('RUN!!!', 'They saw you', true); }
    const rt = t - RUN;
    for (const r of cabinFolks) {
      poseRun(r, rt + (r.kind === 'tung' ? 0.2 : 0));
      r.g.position.z = -2.75 + rt * 6.5;
      r.g.position.x = (r.kind === 'tung' ? 1 : -1) * (0.7 + Math.min(1, rt * 2) * 0.9);
      r.g.position.y = Math.max(0, Math.sin(clamp((r.g.position.z + 1.6) / 3.2, 0, 1) * Math.PI)) * 1.1;   // leap the fireplace
    }
    if (Math.floor(rt * 6) !== Math.floor((rt - dt) * 6)) Sfx.tone(170, 0.07, 'square', 0.2, 120);   // tung tung tung
    cabinCam.position.set(0.15 + rand(-1, 1) * 0.05, 2 + rand(-1, 1) * 0.05, 2.6 + rt * 3.2);
    cabinCam.lookAt(0, 1.3, -1);
    fov = 64;
    if (t > OUT - 0.4 && cabin.phase === 'inside') { cabin.phase = 'leaving'; const f = $('fade'); f.style.transition = 'opacity 0.35s ease-in'; f.style.opacity = 1; }
    if (t > OUT) return leaveCabin();
  }
  if (Math.abs(cabinCam.fov - fov) > 0.05) cabinCam.fov = damp(cabinCam.fov, fov, 8, dt);
  cabinCam.updateProjectionMatrix();
  renderer.render(cabinScene, cabinCam);
}
function leaveCabin() {
  state = 'play';
  p.x = X_LIMIT - 2.5; p.y = 0; p.vy = 0; p.heading = -0.15; p.grounded = true; p.speed = Math.max(p.speed, baseSpeed(-p.z));
  snapCam = true; fadeScreen('#000');
  keepClear(0, Infinity, p.z + 5, p.z - 45);   // a clean getaway, not a rock in the face
  startChase();
}

// ---- the chase: they run after you down the slope. Keep your speed up and they'll give up ----
const chase = { on: false, t: 0, gap: 0, folks: [], knock: 0 };
const rearCam = new THREE.PerspectiveCamera(48, 16 / 9, 0.25, 200);
let rearFrame = null;
function startChase() {
  endChase();
  chase.on = true; chase.t = 0; chase.gap = 7; chase.knock = 0;
  chase.folks = [makeResident('bibi'), makeResident('tung')];
  for (const r of chase.folks) world.add(r.g);
  ensureRearFrame();
  rearFrame.style.display = '';
  showTrick('THEY\'RE COMING!', 'Keep your speed up!', true);
}
function ensureRearFrame() {
  if (!rearFrame) {
    rearFrame = document.createElement('div');
    rearFrame.style.cssText = 'position:fixed;right:12px;top:58px;border:3px solid #fff;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.4);pointer-events:none;z-index:1;font:800 12px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000;letter-spacing:.08em';
    rearFrame.innerHTML = '<span style="position:absolute;left:8px;top:4px">REAR VIEW</span><span style="position:absolute;right:8px;top:4px;color:#ff5a5a" id="chaseGap"></span>';
    document.body.appendChild(rearFrame);
  }
}
function endChase(result) {
  if (rearFrame) rearFrame.style.display = 'none';
  for (const r of chase.folks) world.remove(r.g);
  chase.folks = []; chase.on = false;
  if (result === 'escaped') { p.trickScore += 5000; showTrick('ESCAPED!', '+5,000', true); Sfx.perfect(); }
}
function updateChase(dt) {
  if (!chase.on) return;
  if (zone !== 'normal' || state === 'menu') return endChase();
  chase.t += dt;
  if (state === 'crash' && chase.t > 3) return endChase();   // they wander off once you're down
  if (state === 'play') {
    // they run a touch faster than an easy cruise: tuck and ride clean, and you pull away; smash a rock or carve too hard and they close in
    chase.gap += (p.speed - baseSpeed(-p.z) * 1.04) * dt;
    if (chase.gap < 0.9) { chase.gap = 2; chase.t = 0; return crash('Caught by Bibi and Tung Tung Tung Sahur'); }
    if (chase.gap > 24 || chase.t > 16) return endChase('escaped');
  }
  chase.folks.forEach((r, i) => {
    const caught = state === 'crash';
    const x = p.x + (i ? 2.6 : -2.6), z = p.z + (caught ? 2 : chase.gap) + i * 0.6;
    r.g.position.set(damp(r.g.position.x || x, x, 4, dt), groundAt(x, z)[0], z);
    r.g.rotation.y = Math.PI;   // facing downhill, after you
    if (caught) { poseRun(r, 0); r.body.position.y = Math.abs(Math.sin(time * 8 + i)) * 0.6; r.arms[0].rotation.x = r.arms[1].rotation.x = -3; }   // victory hop
    else poseRun(r, time + i * 0.3);
  });
  if (state === 'play' && (chase.knock -= dt) < 0) { chase.knock = 0.18 + chase.gap * 0.02; Sfx.tone(170, 0.06, 'square', clamp(0.25 - chase.gap * 0.008, 0.05, 0.22), 120); }
  const el = $('chaseGap'); if (el) el.textContent = `${Math.max(0, chase.gap).toFixed(0)} m`;
}
function renderRearView() {
  if (!chase.on || !rearFrame) return;
  const w = Math.min(300, innerWidth * 0.36), h = w * 0.56, x = innerWidth - w - 12, y = 58;
  rearFrame.style.width = `${w}px`; rearFrame.style.height = `${h}px`;
  rearCam.aspect = w / h; rearCam.updateProjectionMatrix();
  tmpV.set(p.x, Math.max(0, p.y) + 2.2, p.z - 1); world.localToWorld(tmpV); rearCam.position.copy(tmpV);
  tmpV.set(p.x, 1.2, p.z + 10); world.localToWorld(tmpV); rearCam.lookAt(tmpV);
  const vy = innerHeight - y - h;   // GL viewports count from the bottom
  renderer.setScissorTest(true); renderer.setViewport(x, vy, w, h); renderer.setScissor(x, vy, w, h);
  renderer.render(scene, rearCam);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
}
// ---------- Heaven Island: past 500,000 points, fly so high the mountain whites out, and you land on a bright
// island in the clouds. Ski anywhere you like for a while (no crashes), then drop back onto the run ----------
const ISLAND_ON = false;   // switched off for now; flip back to true to bring the island back
const ISLAND_SCORE = 500000, ISLAND_FADE = [24, 40], ISLAND_TIME = 20, ISLAND_R = 72;
let islandDone = false, skyWhite = 0;
const islandH = (x, z) => {
  const r = Math.hypot(x, z), edge = clamp((ISLAND_R - r) / 14, -1, 1);
  return edge * 1.6 + 7 * Math.exp(-((x * x + (z + 8) ** 2) / 700)) + 0.7 * Math.sin(x * 0.09) * Math.cos(z * 0.08) * Math.max(0, edge);
};
const islandScene = new THREE.Scene();
const islandCam = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.25, 600);
const isl = { x: 0, y: 0, z: 0, vy: 0, heading: 0, speed: 0, t: 0, grounded: true, saved: null, halos: [] };
(() => {
  const S = islandScene;
  const sky = document.createElement('canvas'); sky.width = 4; sky.height = 256; const sg = sky.getContext('2d');
  const gr = sg.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#dff1ff'); gr.addColorStop(0.45, '#ffffff'); gr.addColorStop(0.62, '#fff6df'); gr.addColorStop(1, '#ffffff');
  sg.fillStyle = gr; sg.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(sky); skyTex.colorSpace = THREE.SRGBColorSpace; S.background = skyTex;
  S.fog = new THREE.Fog(0xfffbf0, 70, 260);
  S.add(new THREE.HemisphereLight(0xffffff, 0xfff0c8, 1.25));
  const sun = new THREE.DirectionalLight(0xfff2d0, 1.1); sun.position.set(30, 80, -40); S.add(sun);
  // pale shimmering sea all the way to the white horizon
  const sea = new THREE.Mesh(new THREE.CircleGeometry(400, 48).rotateX(-Math.PI / 2), lam(0xbff3ee, { emissive: 0x2a5a58, emissiveIntensity: 0.25 }));
  sea.position.y = 0.05; S.add(sea);
  // the island: white sand, with a little pale grass up on the hill
  const N = 90, size = ISLAND_R * 2 + 30, ground = new THREE.PlaneGeometry(size, size, N, N).rotateX(-Math.PI / 2);
  const pos = ground.attributes.position, cols = [], c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = islandH(x, z); pos.setY(i, h);
    c.set(h > 6.3 ? 0xeefbe0 : h < 0.6 ? 0xf6eed6 : 0xfffcf2); cols.push(c.r, c.g, c.b);
  }
  ground.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); ground.computeVertexNormals();
  S.add(new THREE.Mesh(ground, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x4a463c })));
  // palm trees, all in one mesh
  const parts = [], spots = [];
  for (let i = 0; i < 46; i++) {
    const a = rand(0, TAU), r = rand(14, ISLAND_R - 6), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x, z + 8) < 12 || (Math.abs(x) < 6 && z > 20)) continue;   // keep the hut and the landing strip clear
    spots.push([x, z]);
    // a trunk that curves over in one direction: offset grows with t², each segment tilted along the curve
    const y0 = islandH(x, z), ry = rand(0, TAU), H = rand(6, 9), B = rand(0.8, 2.6), bx = Math.cos(ry), bz = Math.sin(ry);
    for (let k = 0; k < 7; k++) {
      const t = (k + 0.5) / 7, ang = Math.atan(2 * B * t / H), o = B * t * t;
      parts.push({ geo: new THREE.CylinderGeometry(0.22 - t * 0.08, 0.26 - t * 0.08, H / 7 + 0.15, 7), color: k % 2 ? 0xc9a77a : 0xb8936a, m: R(ang * bz, 0, -ang * bx).premultiply(T(x + bx * o, y0 + H * t, z + bz * o)) });
    }
    const tx = x + bx * B, tz = z + bz * B, ty = y0 + H;
    for (let k = 0; k < 7; k++) {
      const la = k / 7 * TAU + ry;
      parts.push({ geo: new THREE.BoxGeometry(0.9, 0.08, 4.2), color: k % 2 ? 0x8fd46b : 0x7cc35a, m: new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.45, la, 0, 'YXZ')).premultiply(T(tx + Math.sin(la) * 1.8, ty - 0.5, tz + Math.cos(la) * 1.8)) });   // droop, then fan out
    }
    parts.push({ geo: new THREE.SphereGeometry(0.4, 6, 4), color: 0x8a6a3c, m: T(tx, ty - 0.3, tz) });
  }
  S.add(new THREE.Mesh(merged(parts), vcol));
  isl.palms = spots;
  // the bamboo beach hut on stilts, with a thatched roof and a hammock between two palms
  const hut = new THREE.Group(), hx = 0, hz = -8, hy = islandH(hx, hz); hut.position.set(hx, hy, hz); S.add(hut);
  const bamboo = lam(0xe2c48a), bambooDark = lam(0xb8935a), thatch = lam(0xf0d89a), fringe = lam(0xe0c27a);
  const H_ = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); hut.add(o); return o; };
  for (const [sx, sz] of [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]]) H_(new THREE.CylinderGeometry(0.15, 0.15, 2.2, 6), bambooDark, sx, 0.6, sz);
  H_(box(7, 0.25, 6), bambooDark, 0, 1.6, 0);
  for (let i = -3.2; i <= 3.21; i += 0.32) {
    H_(new THREE.CylinderGeometry(0.15, 0.15, 3, 6), bamboo, i, 3.2, -2.85);
    if (Math.abs(i) > 0.8) H_(new THREE.CylinderGeometry(0.15, 0.15, 3, 6), bamboo, i, 3.2, 2.85);
  }
  for (let i = -2.7; i <= 2.71; i += 0.32) for (const sx of [-3.35, 3.35]) H_(new THREE.CylinderGeometry(0.15, 0.15, 3, 6), bamboo, sx, 3.2, i);
  H_(box(1.5, 2.6, 0.1), new THREE.MeshBasicMaterial({ color: 0x5a3b1a }), 0, 3, 2.86);
  for (const sx of [-2, 2]) H_(box(1.1, 0.9, 0.1), new THREE.MeshBasicMaterial({ color: 0xbfefff }), sx, 3.6, 2.92);
  const roof = H_(new THREE.ConeGeometry(6.2, 3.4, 4), thatch, 0, 6.3, 0, 0, Math.PI / 4); roof.scale.set(1, 1, 0.9);
  for (let i = 0; i < 4; i++) { const f = H_(new THREE.CylinderGeometry(4.5, 4.7, 0.5, 4, 1, true), fringe, 0, 4.55 - i * 0.02, 0, 0, Math.PI / 4); f.scale.set(1, 1, 0.9); f.material.side = THREE.DoubleSide; }
  H_(box(2.2, 0.15, 2.4), bambooDark, 0, 1.3, 4.1, -0.5);   // steps down to the sand
  for (const sx of [-1, 1]) H_(new THREE.CylinderGeometry(0.15, 0.15, 3.4, 6), bamboo, sx * 2.6, 1.4, 4.5);
  const ham = H_(new THREE.TorusGeometry(2.2, 0.35, 4, 16, Math.PI), lam(0xf4f1ff), 8.5, 1.6, 1.5, 0, Math.PI / 2, Math.PI); ham.scale.set(1, 0.4, 1);
  for (const sz of [-0.7, 3.7]) H_(new THREE.CylinderGeometry(0.2, 0.25, 4, 7), bambooDark, 8.5, 1.5, sz);
  isl.hut = { x: hx, z: hz, r: 5 };
  // heavenly touches: soft light shafts, golden halos to ride through, drifting glows and cloud puffs on the sea
  const ray = new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(rand(5, 9), 120, 12, 1, true), ray); s.position.set(rand(-50, 50), 60, rand(-60, 40)); s.rotation.z = rand(-0.25, 0.25); S.add(s); }
  const haloMat = lam(0xffd76a, { emissive: 0xffc23a, emissiveIntensity: 0.8 });
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * TAU, r = 30 + (i % 3) * 12, x = Math.cos(a) * r, z = Math.sin(a) * r - 4;
    const m = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.16, 6, 24), haloMat); m.position.set(x, islandH(x, z) + 2, z); m.rotation.y = a; S.add(m);
    isl.halos.push({ m, x, z, ph: rand(0, TAU) });
  }
  const glow = new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
  isl.motes = [];
  for (let i = 0; i < 60; i++) { const s = new THREE.Sprite(glow); s.scale.setScalar(rand(0.6, 1.6)); s.position.set(rand(-70, 70), rand(2, 20), rand(-70, 70)); S.add(s); isl.motes.push({ s, ph: rand(0, TAU), y: s.position.y }); }
  const puff = lam(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.35 });
  for (let i = 0; i < 26; i++) {
    const a = rand(0, TAU), r = rand(110, 190), g = new THREE.Group(); g.position.set(Math.cos(a) * r, rand(-1, 6), Math.sin(a) * r);
    for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(5, 10), 1), puff); b.position.set(rand(-12, 12), rand(0, 4), rand(-6, 6)); g.add(b); }
    S.add(g);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff6d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
  halo.scale.set(140, 140, 1); halo.position.set(40, 110, -220); S.add(halo);
})();

// the sky turns white as you climb, and at the very top you're through
function updateSkyWhite() {
  const want = ISLAND_ON && mode === 'endless' && !islandDone && !special() && state === 'play' && totalScore() > ISLAND_SCORE
    ? clamp((p.y - ISLAND_FADE[0]) / (ISLAND_FADE[1] - ISLAND_FADE[0]), 0, 1) : 0;
  if (want === 0 && skyWhite === 0) return;
  skyWhite = want;
  const f = $('fade'); f.style.transition = 'none'; f.style.background = '#fff'; f.style.opacity = skyWhite;
  if (skyWhite >= 1) enterIsland();
}
function enterIsland() {
  islandDone = true; skyWhite = 0; endChase();
  state = 'island';
  isl.saved = { z: p.z };
  Object.assign(isl, { x: 0, z: 58, y: islandH(0, 58), vy: 0, heading: 0, speed: 20, t: 0, grounded: true });
  for (const h of isl.halos) h.m.visible = true;
  Object.assign(p, { trick: null, grabbing: false, pitch: 0, roll: 0, yaw: 0, pitchVel: 0, rollVel: 0, yawVel: 0, grinding: null, charging: false });
  islandScene.add(skier.root); islandScene.add(skier.shadow);
  islandCam.position.set(0, isl.y + 30, 90); islandCam.lookAt(0, 4, 0);
  fadeScreen('#fff');
  showTrick('HEAVEN ISLAND', `Freemode for ${ISLAND_TIME} s`, true);
  [523, 659, 784, 1047, 1319].forEach((f, i) => Sfx.tone(f, 1.6, 'sine', 0.12, null, i * 0.12));
}
function exitIsland() {
  world.add(skier.root); world.add(skier.shadow);
  Object.assign(p, { x: 0, y: 0, vy: 0, vx: 0, z: isl.saved.z, heading: 0, grounded: true, pitch: 0, roll: 0, yaw: 0, trick: null, grabbing: false, speed: baseSpeed(-isl.saved.z) });
  keepClear(0, Infinity, p.z + 5, p.z - 60);   // a soft landing back on the run
  state = 'play'; snapCam = true; hud.race.classList.add('hidden');
  fadeScreen('#fff'); showTrick('Back on the mountain', '', false); Sfx.perfect();
}
function updateIsland(dt) {
  const inp = readInput();
  isl.t += dt;
  // ride wherever you like: steer turns you, slopes speed you up or slow you down, jump hops
  isl.heading += inp.h * 2.1 * dt;
  const dx = Math.sin(isl.heading), dz = -Math.cos(isl.heading);
  const slope = (islandH(isl.x + dx, isl.z + dz) - islandH(isl.x - dx, isl.z - dz)) / 2;
  isl.speed = clamp(isl.speed + (-slope * 18 + (24 - isl.speed) * 0.4) * dt, 12, 40);
  isl.x += dx * isl.speed * dt; isl.z += dz * isl.speed * dt;
  // the shore turns you back toward land; palms and the hut nudge you around them
  const r = Math.hypot(isl.x, isl.z);
  if (r > ISLAND_R - 3) {
    const toC = Math.atan2(-isl.x, isl.z), diff = wrap(toC - isl.heading);
    isl.heading += clamp(diff, -3 * dt, 3 * dt);
    if (r > ISLAND_R + 2) { isl.x *= (ISLAND_R + 2) / r; isl.z *= (ISLAND_R + 2) / r; }
  }
  for (const [px, pz] of isl.palms) {
    const ddx = isl.x - px, ddz = isl.z - pz, d = Math.hypot(ddx, ddz);
    if (d < 0.9 && isl.y < islandH(px, pz) + 6) { isl.x = px + ddx / d * 0.9; isl.z = pz + ddz / d * 0.9; isl.speed *= 0.9; }
  }
  { const h = isl.hut, ddx = isl.x - h.x, ddz = isl.z - h.z, d = Math.hypot(ddx, ddz); if (d < h.r && isl.y < islandH(h.x, h.z) + 8) { isl.x = h.x + ddx / d * h.r; isl.z = h.z + ddz / d * h.r; } }
  const gh = islandH(isl.x, isl.z);
  if (isl.grounded) {
    if (inp.jump) { isl.vy = 11; isl.grounded = false; Sfx.ollie(); }
    else if (gh < isl.y - 0.4) isl.grounded = false;
    else isl.y = gh;
  }
  if (!isl.grounded) {
    isl.vy -= G * dt; isl.y += isl.vy * dt;
    if (isl.y <= gh) { isl.y = gh; isl.vy = 0; isl.grounded = true; Sfx.land(false); }
  }
  // halos: ride through them for points
  for (const h of isl.halos) {
    if (!h.m.visible) continue;
    h.m.position.y = islandH(h.x, h.z) + 2 + Math.sin(time * 2 + h.ph) * 0.3; h.m.rotation.y += dt;
    if (Math.hypot(isl.x - h.x, isl.z - h.z) < 2 && Math.abs(isl.y + 1 - h.m.position.y) < 2.2) {
      h.m.visible = false; p.trickScore += 1000; showTrick('Halo!', '+1,000', false); Sfx.coin(); Sfx.tone(1568, 0.3, 'sine', 0.12);
    }
  }
  for (const m of isl.motes) m.s.position.y = m.y + Math.sin(time * 0.8 + m.ph) * 0.8;
  p.trickScore += Math.round(isl.speed * dt * 8);
  // pose the rider through the normal visuals, then move it onto the island
  Object.assign(p, { x: isl.x, y: isl.y, z: isl.z, heading: 0, grounded: isl.grounded, speed: isl.speed });
  updateSkierVisual(dt);
  skier.body.rotation.y = -isl.heading; skier.body.rotation.z = clamp(-inp.h * 0.4, -0.4, 0.4);
  skier.shadow.position.set(isl.x, gh + 0.05, isl.z);
  // chase camera
  tmpV.set(isl.x - dx * 9, Math.max(isl.y, gh) + 4.2, isl.z - dz * 9);
  islandCam.position.lerp(tmpV, 1 - Math.exp(-5 * dt));
  camLook.set(isl.x + dx * 8, isl.y + 1.2, isl.z + dz * 8);
  islandCam.lookAt(camLook);
  islandCam.aspect = camera.aspect; islandCam.updateProjectionMatrix();
  updateHUD(dt);
  hud.race.classList.remove('hidden');
  hud.race.textContent = `HEAVEN ISLAND  ·  freemode  ·  ${Math.ceil(ISLAND_TIME - isl.t)} s`;
  renderer.render(islandScene, islandCam);
  if (isl.t > ISLAND_TIME) exitIsland();
}
const lanternGlow = new THREE.SpriteMaterial({ map: glowTex, color: 0xffc56b, transparent: true, depthWrite: false, opacity: 0.8 });
const floatGlows = [0x7cf7d4, 0xc264ff].map(c => new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, depthWrite: false, opacity: 0.8 }));
const lanternMat = lam(0xffd27a, { emissive: 0xffb347, emissiveIntensity: 0.15 }), postMat = lam(0x3b4a5a);
const snowmanParts = { body: lam(0xf8fbff), coal: lam(0x222222), carrot: lam(0xff7b00), scarf: lam(0xe63946) };
function addSnowman(x, z, santa) {
  const g = new THREE.Group(); g.position.set(x, wallH(x, z), z); g.rotation.y = rand(-0.6, 0.6) + Math.PI * 0.1;
  const ball = (r, y) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), snowmanParts.body); m.position.y = y; g.add(m); };
  ball(0.9, 0.75); ball(0.65, 1.95); ball(0.45, 2.85);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 5), snowmanParts.carrot); nose.rotation.x = -Math.PI / 2; nose.position.set(0, 2.85, -0.6); g.add(nose);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(box(0.08, 0.08, 0.05), snowmanParts.coal); e.position.set(sx * 0.15, 3, -0.4); g.add(e); }
  const sc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 5, 10), snowmanParts.scarf); sc.rotation.x = Math.PI / 2; sc.position.y = 2.45; g.add(sc);
  if (santa) {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 8), snowmanParts.scarf); hat.position.y = 3.6; hat.rotation.z = 0.25; g.add(hat);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.1, 6, 12), snowmanParts.body); rim.rotation.x = Math.PI / 2; rim.position.y = 3.2; g.add(rim);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4), snowmanParts.body); pom.position.set(0.2, 4.03, 0); g.add(pom);
  } else {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.45, 8), snowmanParts.coal); hat.position.y = 3.45; g.add(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 8), snowmanParts.coal); brim.position.y = 3.24; g.add(brim);
  }
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(box(0.06, 0.06, 1.2), cabinWall); arm.position.set(sx * 0.9, 2.1, 0); arm.rotation.set(0, Math.PI / 2, sx * 0.5); g.add(arm); }
  world.add(g); decor.push({ z: z - 2, mesh: g });
}
function addIgloo(x, z) {
  const g = new THREE.Group(); g.position.set(x, wallH(x, z), z); g.rotation.y = rand(-0.8, 0.8);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 6, 0, TAU, 0, Math.PI / 2), lam(0xeef6fb)); g.add(dome);
  const door = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 8, 1, false, 0, Math.PI), lam(0xeef6fb)); door.rotation.set(Math.PI / 2, 0, 0); door.position.set(0, 0, -2.6); g.add(door);
  const hole = new THREE.Mesh(box(1.1, 1.1, 0.1), lanternMat); hole.position.set(0, 0.55, -3.35); g.add(hole);
  for (let r = 1; r < 4; r++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6 * Math.cos(r * 0.38), 0.03, 3, 20), lam(0xc9dbe9)); ring.rotation.x = Math.PI / 2; ring.position.y = 2.6 * Math.sin(r * 0.38); g.add(ring); }
  world.add(g); decor.push({ z: z - 3, mesh: g });
}
function addLantern(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const post = new THREE.Mesh(box(0.14, 2.6, 0.14), postMat); post.position.y = 1.3; g.add(post);
  const lamp = new THREE.Mesh(box(0.42, 0.5, 0.42), lanternMat); lamp.position.y = 2.75; g.add(lamp);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.3, 4), postMat); roof.position.y = 3.15; roof.rotation.y = Math.PI / 4; g.add(roof);
  if (theme.lamp) { const gl = new THREE.Sprite(lanternGlow); gl.scale.set(3.2, 3.2, 1); gl.position.y = 2.75; g.add(gl); }
  world.add(g); decor.push({ z, mesh: g });
}
let decorN = 0;   // counts decor rows (4 m apart) for things that repeat every so often
function spawnDecor(z) {
  const forest = mode === 'race' || (mode === 'level' && !!level.def.forest);
  decorN++;
  if (zone === 'agartha') {
    // the inner-earth city: stone blocks along the run, pyramids and spires further out, mammoth caravans
    const side = decorN % 2 ? 1 : -1;
    for (const sd of [-1, 1]) if (Math.random() < 0.3) {   // small ice crystals at the edge of the run
      const x = sd * rand(14.5, 17);
      decor.push({ z, idx: crystals.add(x, 0, z - rand(0, 4), rand(0.4, 0.9), rand(0, 6), rand(0.5, 1.1)), pool: crystals });
    }
    if (decorN % 5 === 0) { const x = side * rand(21, 27); decor.push({ z: z - 5, idx: agBlock.add(x, wallH(x, z) - 0.3, z, rand(0.8, 1.3), x < 0 ? 0 : Math.PI), pool: agBlock }); }
    if (decorN % 18 === 4) addPyramid(side * rand(40, 60), z - 10);
    if (decorN % 18 === 13) addSpire(side * rand(30, 46), z);
    if (decorN % 40 === 0) addRuneArch(z);
    if (decorN % 50 === 25) addCaravan(-side * rand(16, 17.5), z);
    if (Math.random() < 0.85) decor.push({ z, idx: patches.add(rand(-18, 18), 0.02, z - rand(0, 4), rand(0.8, 3), rand(0, 6), 1), pool: patches });
    return;
  }
  if (zone === 'xmas') {
    for (const side of [-1, 1]) {
      for (let i = 0, n = Math.random() < 0.55 ? 1 : 2; i < n; i++) {
        const x = side * rand(15.5, 40), zz = z - rand(0, 4);
        if (wallH(x, zz) < 22) addTree(x, zz, rand(0.9, 1.8), false);
      }
      if (Math.random() < 0.25) decor.push({ z, idx: candyCanes.add(side * rand(14.2, 18), 0, z - rand(0, 4), rand(0.7, 1.3), side > 0 ? Math.PI : 0), pool: candyCanes });
      if (Math.random() < 0.2) { const pool = Math.random() < 0.5 ? giftsRed : giftsGreen; decor.push({ z, idx: pool.add(side * rand(14.5, 19), 0, z - rand(0, 4), rand(0.35, 0.8), rand(0, 6)), pool }); }
    }
    if (decorN % 30 === 0) addLightString(z);
    if (decorN % 7 === 0) for (const sd of [-1, 1]) addLampPost(sd * 14.6, z);
    if (decorN % 26 === 13) addGiantTree((decorN % 52 === 13 ? -1 : 1) * rand(22, 30), z);
    if (decorN % 90 === 45) addWorkshop((Math.random() < 0.5 ? -1 : 1) * rand(30, 36), z);
    if (Math.random() < 0.03) addSnowman((Math.random() < 0.5 ? -1 : 1) * rand(16.5, 19.5), z, true);
    if (Math.random() < 0.014) addReindeer((Math.random() < 0.5 ? -1 : 1) * rand(16, 22), z, (Math.random() < 0.5 ? -1 : 1) * rand(1, 1.8));
    if (Math.random() < 0.012) addGingerHouse((Math.random() < 0.5 ? -1 : 1) * rand(19, 26), z);
    if (Math.random() < 0.85) decor.push({ z, idx: patches.add(rand(-18, 18), 0.02, z - rand(0, 4), rand(0.8, 3), rand(0, 6), 1), pool: patches });
    return;
  }
  // World-space groves have their own deterministic scatter, independent of course generation.
  // A strip owns only its actual tree positions, rather than placing a row at the strip boundary.
  for (const tree of landscapeTrees(z, 4, forest).filter((t, i) => !LITE || i % (LOW ? 3 : 2) === 0)) {
    addTree(tree.x, tree.z, tree.scale, false, tree.rotation, tree.variant);
  }
  if (!forest && decorN % 12 === 0) addLiftTower(z);
  if (!forest && decorN > 20 && Math.random() < 0.004) addYeti((Math.random() < 0.5 ? -1 : 1) * rand(20, 25), z);
  if (!forest && mode === 'endless' && decorN % 160 === 57) {
    addCabin(15.6, z, 0, !demo);
    if (theme.lamp) { addLantern(14.9, z + 5); addLantern(17.5, z + 5); for (const lx of [14.9, 17.5]) solids.push({ x: lx, z: z + 5, hx: 0.25, hz: 0.25, h: 3, name: 'Hugged a lantern' }); }
  }

}

function cleanup(pz) {
  const behind = pz + 30;
  const keep = (arr, zOf, kill) => { let j = 0; for (const o of arr) { if (zOf(o) > behind) kill(o); else arr[j++] = o; } arr.length = j; };
  keep(ramps, r => r.z0 - r.L, r => world.remove(r.mesh));
  keep(rails, r => r.z0 - r.L, r => world.remove(r.mesh));
  keep(obstacles, o => o.z, o => o.pool ? o.pool.remove(o.idx) : world.remove(o.mesh));
  keep(movers, o => o.z, () => {});
  keep(crevasses, c => c.z0 - c.L, c => { world.remove(c.mesh); c.dispose?.dispose(); });
  keep(gates, g => g.z, g => world.remove(g.mesh));
  keep(pads, q => q.z - 3, q => world.remove(q.mesh));
  keep(coins, c => c.z, c => { if (!c.taken) c.pool.remove(c.idx); });
  keep(decor, o => o.z, o => { if (o.pool) o.pool.remove(o.idx); else world.remove(o.mesh); if (o.dispose) o.dispose.dispose(); });
  keep(shapes, q => q.z0 - q.L, q => world.remove(q.mesh));
  keep(caves, c => c.z, () => {});
  keep(approaches, a => a.zBot, () => {});
  keep(solids, o => o.z - 3, () => {});
  keep(animals, a => a.g.position.z - 4, a => { if (a.mover) world.remove(a.g); });   // decor bears are removed with the decor
}
function clearWorld() {
  cleanup(-1e9); secretCabin = null; endChase();
  if (finish) { world.remove(finish.mesh); finish = null; }
}



// ---------- Levels: hand-made courses, each with its own theme and mix. Much harder than Endless: one crash
// and you start over. Reach the finish for a star; enough points earn the second and third ----------
// seq is ridden in order (and repeats until the finish); d is how nasty the hazards are; width narrows the run
const LEVELS = [
  { name: 'First Tracks', diff: 'hard', theme: 'day', len: 700, d: 0.75, tricky: 1.0, seq: ['ramp', 'rocks', 'rail', 'slalom', 'line', 'logs', 'railKick', 'rocks', 'big'] },
  { name: 'Rail Yard', diff: 'hard', theme: 'golden', len: 800, d: 0.75, tricky: 1.4, seq: ['rail', 'garden', 'rocks', 'jibLine', 'gapRail', 'slalom', 'railKick', 'garden', 'logs', 'jibLine'] },
  { name: 'Tree Run', diff: 'hard', theme: 'day', len: 800, d: 0.75, tricky: 0.6, width: 10, forest: true, seq: ['slalom', 'ramp', 'field', 'logs', 'slalom', 'rail', 'field', 'slalom'] },
  { name: 'Sunset Kickers', diff: 'hard', theme: 'golden', len: 900, d: 0.75, tricky: 1.6, seq: ['line', 'rocks', 'proLine', 'table', 'logs', 'big', 'stepdown', 'slalom', 'mega'] },
  { name: 'Polar Pass', diff: 'hard', theme: 'day', len: 900, d: 0.75, tricky: 0.8, seq: ['bear', 'ramp', 'balls', 'logs', 'bear', 'railKick', 'field', 'balls', 'bear'] },
  { name: 'Night Shift', diff: 'hard', theme: 'night', len: 1000, d: 0.75, tricky: 1.2, seq: ['ramp', 'field', 'garden', 'logs', 'proLine', 'balls', 'slalom', 'jibLine', 'bear'] },
  { name: 'North Pole', diff: 'hard', theme: 'xmas', zone: 'xmas', len: 1000, d: 0.75, tricky: 1.0, seq: ['slalom', 'ramp', 'rocks', 'logs', 'rail', 'slalom', 'big', 'rocks', 'line', 'logs'] },
  { name: 'Agartha Depths', diff: 'hard', theme: 'agartha', zone: 'agartha', len: 1100, d: 0.8, tricky: 1.1, seq: ['rocks', 'line', 'rocks', 'gapRail', 'table', 'rocks', 'mega', 'rocks', 'stepdown'] },
  { name: 'Snowball Alley', diff: 'hard', theme: 'golden', len: 1000, d: 0.9, tricky: 0.7, width: 11, seq: ['balls', 'ramp', 'balls', 'logs', 'balls', 'rail', 'balls', 'field'] },
  { name: 'Big Mountain', diff: 'hard', theme: 'day', len: 1200, d: 0.75, tricky: 2.0, speed: 1.2, seq: ['big', 'mega', 'logs', 'stepdown', 'proLine', 'rocks', 'mega', 'line', 'big'] },
  { name: 'The Gauntlet', diff: 'hard', theme: 'night', len: 1300, d: 1.0, tricky: 1.0, width: 11, seq: ['field', 'logs', 'bear', 'balls', 'slalom', 'jibLine', 'field', 'logs', 'proLine', 'balls'] },
  { name: 'Peak Legend', diff: 'hard', theme: 'golden', len: 1600, d: 1.0, tricky: 1.4, speed: 1.15, width: 11, seq: ['mega', 'field', 'garden', 'balls', 'logs', 'proLine', 'bear', 'slalom', 'gapRail', 'field', 'stepdown', 'balls'] },
];
// easy: fewer hazards and rocks only slow you down · hard: twice the hazards, faster, narrower,
// rocks/crystals/presents end the run and a sketchy landing is a crash
const LEVEL_DIFF = {
  easy: { dK: 0.7, extra: 0.15, more: 0, speed: 1, narrow: 0 },
  medium: { dK: 1, extra: 0.35, more: 0, speed: 1.04, narrow: 0 },
  hard: { dK: 1.3, extra: 0.85, more: 2, speed: 1.12, narrow: 1.5 },
};
const levelDiff = () => LEVEL_DIFF[level.def.diff] || LEVEL_DIFF.medium;
const hardLevel = () => mode === 'level' && level.def.diff === 'hard';
// points for the 2nd and 3rd star (special worlds pay double, so their targets are doubled too)
const levelStars = L => {
  const k = L.zone ? 2 : 1, r = v => Math.round(v / 500) * 500;
  // just riding through earns roughly 10 points a metre; the stars ask for real tricks on top
  return [r(L.len * (12 + 10 * L.tricky) * k), r(L.len * (12 + 25 * L.tricky) * k)];
};
const level = { n: 0, def: LEVELS[0], idx: 0 };
const levelInfo = () => LEVELS.map((L, i) => ({ name: L.name, theme: L.theme, diff: L.diff, len: L.len, stars: levelStars(L), n: i }));
function startLevel(n) { level.n = clamp(n, 0, LEVELS.length - 1); startRun('level'); }
function levelOver(done) {
  state = 'over';
  Platform.gameplayStop();
  const L = level.def, score = totalScore(), [s2, s3] = levelStars(L);
  const stars = done ? 1 + (score >= s2) + (score >= s3) : 0;
  const rec = (save.levels ||= {})[level.n] || { stars: 0, best: 0 };
  const newBest = done && score > rec.best;
  save.levels[level.n] = { stars: Math.max(rec.stars, stars), best: done ? Math.max(rec.best, score) : rec.best };
  // coins: a little for trying, more for each star you earn for the first time
  const bonus = Math.floor(score / 500) + Math.max(0, stars - rec.stars) * 50;
  save.coins += bonus;
  const missions = endCommon();
  if (done) Sfx.perfect();
  showResults({ mode: 'level', done, level: level.n, name: L.name, diff: L.diff, score, stars, prevStars: rec.stars, best: save.levels[level.n].best, targets: [s2, s3], newBest, last: level.n === LEVELS.length - 1, reason: p.reason, dist: Math.floor(Math.min(-p.z, L.len)), len: L.len, coins: p.coins, bonus, missions });
}

// ---------- player ----------
const p = {};
function resetPlayer() {
  Object.assign(p, {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, speed: 20, boost: 0, heading: 0, carve: 0, distScore: 0,
    charging: false, chargeT: 0, sketchy: false,
    grounded: true, groundTime: 0, airTime: 0,
    pitch: 0, yaw: 0, roll: 0, pitchVel: 0, yawVel: 0, rollVel: 0, tilt: 0, slideYaw: 0, lean: 0, crouch: 0.2,
    grabbing: false, trick: null, grinding: null, grindTime: 0, lastRail: null,
    trickScore: 0, combo: 0, comboTimer: 0, comboTotal: 0, coins: 0,
    crashed: false, crashT: 0, spinX: 0, spinZ: 0, reason: '', happy: false,
    butter: false, butterT: 0, arch: 0, boostT: 0, bleedZ: 0, bounceN: 0, bestShown: false,
  });
  $('score')?.classList.remove('record');
}

function groundAt(x, z) {
  for (const c of crevasses) if (z <= c.z0 && z >= c.z0 - c.L && Math.abs(x) < 15.5) return [-30, 0];
  let h = 0, s = 0;
  for (const sh of shapes) {
    if (z <= sh.z0 && z >= sh.z0 - sh.L && Math.abs(x - sh.x) <= sh.W / 2) {
      const [hh, dh] = sh.fn((sh.z0 - z) / sh.L);
      if (hh > h) { h = hh; s = dh / sh.L; }
    }
  }
  for (const r of ramps) {
    if (z <= r.z0 && z >= r.z0 - r.L && Math.abs(x - r.x) <= r.W / 2) {
      const t = (r.z0 - z) / r.L, hh = r.H * t * t;
      if (hh > h) { h = hh; s = 2 * r.H * t / r.L; }
    }
  }
  return [h, s];
}
function padAt(x, z, kind) {
  for (const q of pads) if (q.kind === kind && Math.abs(q.z - z) < q.len && Math.abs(q.x - x) < q.r) return q;
  return null;
}
function bounce() {
  const q = padAt(p.x, p.z, 'bounce'); if (q) q.squash = 1;
  if (mode === 'race') { p.vy = Math.max(17, Math.abs(p.vy) * 0.5 + 15); startAir(); p.fromRamp = true; }
  else {
    // each bounce in a row goes higher and pays more; tricks off a trampoline score x1.5
    const n = p.bounceN || 0;
    // launch at exactly the speed the line was spaced for, straight down it, so the next trampoline is under you
    p.vy = bounceVy(n); p.speed = baseSpeed(-p.z) * 1.08; p.heading = 0; p.vx = 0;
    startAir(); p.fromRamp = true; p.trick.tramp = true; p.bounceN = n + 1;
    award(['Bounce', 'Double Bounce', 'Triple Bounce', 'Mega Bounce'][Math.min(n, 3)], 150 * (n + 1), n >= 2);
  }
  Sfx.tone(180, 0.3, 'sine', 0.3, 720); Sfx.tone(90, 0.15, 'square', 0.12, 60); shake = 0.25;
  Particles.emit(p.x, 0.5, p.z, 18, 3, 6, 0xff2d78, 0); Particles.emit(p.x, 0.5, p.z, 10, 2, 5, 0xffc93c, 0);
}
const railTop = (r, z) => r.top - r.drop * clamp((r.z0 - z) / r.L, 0, 1);
const proFlagMat = lam(0xffc400, { emissive: 0x7a5200 });
function railAt(x, z) {
  for (const r of rails) if (z <= r.z0 && z >= r.z0 - r.L && Math.abs(x - r.x) < 0.8) return r;
  return null;
}

// ---------- input ----------
const keys = {};
// Keys that were already held when the rider took off / landed are ignored until released,
// so holding "steer right" into a jump doesn't turn into an accidental spin.
const latched = new Set();
const latch = codes => { for (const c of codes) if (keys[c]) latched.add(c); };
const keyTime = {};
// At takeoff: flip keys (W/S) held from the ground start the flip instantly. A/D only count as a spin if they were
// pressed right before the jump — if you'd been holding them to steer, they're ignored until pressed again.
function latchAtTakeoff() {
  const now = performance.now();
  for (const c of ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD']) if (keys[c] && now - (keyTime[c] || 0) > 350) latched.add(c);
  for (const c of ['Space', 'KeyJ', 'ShiftLeft', 'ShiftRight', 'KeyK', 'KeyG']) if (keys[c]) latched.add(c);
}
const AIR_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'KeyJ', 'ShiftLeft', 'ShiftRight', 'KeyK', 'KeyG'];
const LAND_KEYS = ['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'Space', 'KeyJ', 'ShiftLeft', 'ShiftRight', 'KeyK', 'KeyG'];
const JUMP_KEYS = ['Space', 'KeyJ'];
let jumpQueued = false, jumpPower = 0;
const ptr = { down: false, x: 0, y: 0, sx: 0, sy: 0, ax: 0, ay: 0, t0: 0, moved: 0 };
const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const MAX_CHARGE = 0.45;
const popFromCharge = t => 7.5 + 6 * clamp(t / MAX_CHARGE, 0, 1);
const JUMP_POP = 11;
const typing = e => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
addEventListener('keydown', e => {
  if (typing(e)) return;
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true; keyTime[e.code] = performance.now();
  latched.delete(e.code);
  Sfx.init();
  // hold jump to crouch & charge, release to pop
  if (JUMP_KEYS.includes(e.code) && state === 'play') { jumpQueued = true; jumpPower = JUMP_POP; }
  if (e.code === 'KeyG' && state === 'play') nextGrab();
  if ((e.code === 'Escape' || e.code === 'KeyP') && (state === 'play')) togglePause();
  if (e.code === 'KeyM') Sfx.toggle();
  if (e.code === 'KeyC' || e.code === 'KeyV') cycleView();
  if ((e.code === 'Space' || e.code === 'Enter') && state === 'menu' && !overlayBusy && $('panel').classList.contains('hidden')) startRun();
});
addEventListener('keyup', e => {
  keys[e.code] = false; latched.delete(e.code);
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; p.charging = false; if (state === 'play') togglePause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') togglePause(true); });

// ---------- touch: a floating joystick on the left half, a jump/grab button on the right half ----------
// Both work at once (steer while you jump, flip while you grab). The stick appears wherever the thumb lands.
const STICK_R = 56;
const touch = { stick: null, jump: null };
const stickEl = $('tStick'), knobEl = $('tKnob'), jumpEl = $('tJump');
const touchPlay = () => isTouch && (state === 'play' || state === 'crash') && !paused;
function drawStick() {
  const st = touch.stick;
  stickEl.classList.toggle('on', !!st);
  if (st) {
    stickEl.style.transform = `translate(${st.ax - STICK_R}px, ${st.ay - STICK_R}px)`;
    knobEl.style.transform = `translate(${st.x - st.ax}px, ${st.y - st.ay}px)`;
  } else { stickEl.style.transform = ''; knobEl.style.transform = ''; }
}
// the stick's direction, -1…1 on each axis, with a small dead zone in the middle
function stickInput() {
  const st = touch.stick; if (!st) return [0, 0];
  const dx = (st.x - st.ax) / STICK_R, dy = (st.y - st.ay) / STICK_R, m = Math.hypot(dx, dy);
  if (m < 0.18) return [0, 0];
  const k = Math.min(1, (m - 0.18) / 0.72) / m;
  return [dx * k, -dy * k];
}
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch' || !touchPlay()) return;
  e.stopImmediatePropagation();
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  if (e.clientX < innerWidth * 0.5) {
    if (!touch.stick) { touch.stick = { id: e.pointerId, ax: e.clientX, ay: e.clientY, x: e.clientX, y: e.clientY }; drawStick(); }
  } else if (!touch.jump) {
    touch.jump = { id: e.pointerId };
    if (state === 'play') { jumpQueued = true; jumpPower = JUMP_POP; }
    if (p.trick && !p.grounded && !p.grinding && p.airTime > 0.2) nextGrab();   // tap again in the air: switch grab
    jumpEl.classList.add('down');
  }
});
canvas.addEventListener('pointermove', e => {
  const st = touch.stick;
  if (!st || e.pointerId !== st.id) return;
  e.stopImmediatePropagation();
  st.x = e.clientX; st.y = e.clientY;
  // drag past the edge and the stick follows the thumb, so reversing direction is always quick
  const dx = st.x - st.ax, dy = st.y - st.ay, m = Math.hypot(dx, dy);
  if (m > STICK_R) { st.ax = st.x - dx / m * STICK_R; st.ay = st.y - dy / m * STICK_R; }
  drawStick();
});
const touchUp = e => {
  if (touch.stick?.id === e.pointerId) { touch.stick = null; drawStick(); e.stopImmediatePropagation(); }
  if (touch.jump?.id === e.pointerId) { touch.jump = null; jumpEl.classList.remove('down'); e.stopImmediatePropagation(); }
};
canvas.addEventListener('pointerup', touchUp);
canvas.addEventListener('pointercancel', touchUp);
function clearTouch() { touch.stick = touch.jump = null; drawStick(); jumpEl.classList.remove('down'); }

canvas.addEventListener('pointerdown', e => {
  Sfx.init();
  ptr.down = true; ptr.x = ptr.sx = ptr.ax = e.clientX; ptr.y = ptr.sy = ptr.ay = e.clientY;
  ptr.t0 = performance.now(); ptr.moved = 0;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});
canvas.addEventListener('pointermove', e => {
  if (!ptr.down) return;
  if (closet.on) { closet.yaw += (e.clientX - ptr.x) * 0.012; closet.dragT = performance.now(); }
  ptr.x = e.clientX; ptr.y = e.clientY;
  ptr.moved = Math.max(ptr.moved, Math.hypot(ptr.x - ptr.sx, ptr.y - ptr.sy));
});
const ptrUp = () => {
  if (ptr.down && performance.now() - ptr.t0 < 260 && ptr.moved < 14) { jumpQueued = true; jumpPower = JUMP_POP; }
  ptr.down = false;
};
canvas.addEventListener('pointerup', ptrUp);
canvas.addEventListener('pointercancel', () => { ptr.down = false; });
const reanchor = () => { ptr.ax = ptr.x; ptr.ay = ptr.y; if (touch.stick) { touch.stick.ay = touch.stick.y; drawStick(); } };

function readInput() {
  if (demo) return botInput();
  const held = (...cs) => cs.some(c => keys[c] && !latched.has(c));
  const L = held('ArrowLeft', 'KeyA'), R = held('ArrowRight', 'KeyD');
  const U = held('ArrowUp', 'KeyW'), D = held('ArrowDown', 'KeyS');
  let h = (R ? 1 : 0) - (L ? 1 : 0), v = (U ? 1 : 0) - (D ? 1 : 0);
  let grab = held('Space', 'KeyJ', 'ShiftLeft', 'ShiftRight', 'KeyK', 'KeyG');
  if (touch.stick || touch.jump) {
    const [sx, sy] = stickInput();
    h = clamp(h + sx, -1, 1); v = clamp(v + sy, -1, 1);
    if (touch.jump) grab = true;
  } else if (ptr.down) {
    const unit = Math.min(innerWidth, innerHeight) * 0.16;
    const dx = (ptr.x - ptr.ax) / unit, dy = (ptr.y - ptr.ay) / unit;
    h = clamp(h + dx, -1, 1);
    v = clamp(v - dy, -1, 1);
    if (Math.hypot(dx, dy) < 0.3 && performance.now() - ptr.t0 > 200) grab = true;
  }
  const jump = jumpQueued; jumpQueued = false;
  return { h, v, grab, jump };
}

// ---------- tricks & scoring ----------
const GRABS = ['Mute', 'Safety', 'Japan', 'Tail', 'Indy', 'Truck Driver', 'Critical', 'Seatbelt'], BOARD_GRABS = ['Indy', 'Melon', 'Method', 'Stalefish', 'Nose', 'Crail', 'Roast Beef', 'Tail'];
// arm angles per grab: [left x, left z, right x, right z, body arch]; positive x swings an arm forward
const GRAB_POSE = {
  Mute: [1.3, -0.3, 1.3, 0.3, 0], Safety: [0.35, -0.6, -0.1, 1.0, 0], Japan: [1.4, -0.2, -1.2, 0.4, 0.15],
  Tail: [0.6, -1.2, -1.4, 0.3, -0.25], Indy: [-0.3, -1.3, 1.1, 0.5, 0],
  Melon: [1.2, -0.2, 0.3, 1.4, 0], Method: [-1.2, -0.3, 0.2, 1.5, 0.4], Stalefish: [0.1, -1.5, -1.3, 0.4, 0], Nose: [1.6, 0, 0.4, 1.2, -0.2],
  'Truck Driver': [1.5, -0.35, 1.5, 0.35, -0.2], Critical: [1.1, -0.5, -0.6, 1.2, 0.1], Seatbelt: [1.3, 0.6, 0.2, 0.3, 0.3],
  Crail: [1.4, -0.4, -0.8, 0.9, 0.2], 'Roast Beef': [0.2, -0.4, -0.9, 1.4, -0.1],
};
// what the skis (or board) do during each grab: [pitch, yaw, roll] of the lower body, swung from the hips
const GRAB_TWEAK = {
  Mute: [0.15, 0.25, 0.35], Safety: [-0.2, 0, -0.45], Japan: [0.35, -0.3, 0.6], Tail: [0.6, 0, 0], Indy: [0.1, 0, 0.55],
  'Truck Driver': [-0.55, 0, 0], Critical: [0.2, 0.7, 0.2], Seatbelt: [0.55, 0.15, -0.2],
  Melon: [0.1, 0.2, -0.6], Method: [0.5, 0, 0.7], Stalefish: [-0.1, -0.2, 0.6], Nose: [-0.5, 0, 0], Crail: [-0.35, 0.3, 0.4], 'Roast Beef': [0.2, -0.3, -0.5],
};
const tweakE = new THREE.Euler(0, 0, 0, 'YXZ'), legsV = new THREE.Vector3();
// a grab held long enough "locks in": a sparkle, a click and its name pops up
function grabLocked(name) {
  showTrick(name, '', false);
  Sfx.tone(1175, 0.06, 'triangle', 0.1); Sfx.tone(1568, 0.08, 'triangle', 0.08, null, 0.05);
  Particles.emit(p.x, p.y + 0.9, p.z, 14, 2.5, 2, 0xffe27a, 0);
}
// G in the air: switch to the next grab; grabs you hold long enough all count toward the trick name
function nextGrab() {
  const t = p.trick; if (!t || p.grounded || p.grinding) return;
  const list = isBoard() ? BOARD_GRABS : GRABS;
  if (t.grab > 0.25 && !t.grabs.includes(t.grabName)) t.grabs.push(t.grabName);
  t.grabName = list[(list.indexOf(t.grabName) + 1) % list.length];
  t.grab = 0; t.locked = false;
}
function startAir() {
  p.fromRamp = p.y > 0.3 || !!p.grinding;   // hops from flat snow can never crash
  const pro = ramps.some(r => r.pro && Math.abs(p.x - r.x) < r.W / 2 + 0.5 && p.z <= r.z0 + 0.5 && p.z >= r.z0 - r.L - 1.5);
  p.grounded = false; p.airTime = 0; p.maxH = 0; p.butter = false;
  latchAtTakeoff();
  if (p.charging) {          // held jump off a lip → auto-pop with the stored charge
    p.charging = false; p.vy += popFromCharge(p.chargeT) * 0.8; Sfx.ollie();
  }
  p.trick = { pitch: 0, yaw: 0, roll: 0, grab: 0, switch: Math.abs(wrap(p.yaw)) > Math.PI / 2, grabName: (isBoard() ? BOARD_GRABS : GRABS)[(Math.random() * (isBoard() ? BOARD_GRABS : GRABS).length) | 0], grabs: [], grabTotal: 0, longest: 0, locked: false, pro };
  ptr.ax = ptr.x;   // keep the vertical anchor: a held up/down drag starts a flip right away
  if (touch.stick) { touch.stick.ax = touch.stick.x; drawStick(); }   // same for the stick: steering isn't a spin
}

function award(name, pts, perfect) {
  if (p.comboTimer > 0) p.combo++; else { p.combo = 1; p.comboTotal = 0; }
  p.comboTimer = COMBO_WINDOW;
  const mult = Math.min(1 + 0.5 * (p.combo - 1), 8);
  const total = Math.round(pts * mult * (special() ? 2 : 1));   // special worlds pay double
  p.trickScore += total; p.comboTotal += total;
  showTrick(name, `+${total.toLocaleString()}${mult > 1 ? `  x${mult}` : ''}`, perfect);
  missionToast(track('combo', p.combo, 'max'));
  if (!p.happy && !demo && (p.combo >= 6 || total >= 6000)) { p.happy = true; Platform.happytime(); }
}

// Landing tiers: perfect → clean → sketchy (stumble, lose speed) → crash.
// Small hops can never crash — you just stumble.
function landingCheck() {
  const np = Math.abs(wrap(p.pitch)), ny = wrap(p.yaw);
  const yawErr = Math.min(Math.abs(ny), Math.PI - Math.abs(ny));
  const err = Math.max(np, yawErr * 0.85, Math.abs(wrap(p.roll)));
  const smallHop = !p.fromRamp || (p.maxH < 1.8 && p.airTime < 0.75);
  const ok = err < 1.35 || smallHop;
  return { ok, perfect: err < 0.3, sketchy: ok && err >= 0.6, ny };
}

// When the player lets go of a rotation, finish it to the nearest landable angle.
function settle(angle, vel, step, rate, dt) {
  const tgt = Math.round(angle / step) * step, err = tgt - angle;
  if (Math.abs(err) < 1.0) return damp(vel, err * 8, 14, dt);
  const dir = Math.sign(vel) || Math.sign(err);
  return damp(vel, dir * rate * 0.7, 8, dt);
}

function scoreAirTrick(perfect, sketchy) {
  const t = p.trick; if (!t) return;
  const flips = Math.round(Math.abs(t.pitch) / TAU);
  const rolls = Math.round(Math.abs(t.roll) / TAU);
  const spins = Math.round(Math.abs(t.yaw) / Math.PI) * 180;
  if (t.grab > 0.25 && !t.grabs.includes(t.grabName)) t.grabs.push(t.grabName);
  const grabbed = t.grabs.length > 0;
  // every extra grab chained in the same air adds a bonus
  let pts = flips * 1000 + rolls * 1100 + (spins / 180) * 300 + (grabbed ? Math.round(t.grabTotal * 10) * 70 + (t.grabs.length - 1) * 400 : 0);
  if (p.airTime > 1.4) pts += Math.round(p.airTime * 120);
  if (pts === 0) return;
  const parts = [];
  if (t.switch) parts.push('Switch');
  if (spins) parts.push((isBoard() ? (t.yaw < 0 ? 'Frontside ' : 'Backside ') : '') + (rolls ? 'Cork ' : '') + spins);
  if (rolls && !spins) parts.push((['', '', 'Double ', 'Triple ', 'Quad '][rolls] ?? rolls + 'x ') + 'Sideflip');
  if (flips) parts.push((['', '', 'Double ', 'Triple ', 'Quad ', 'Quint '][flips] ?? flips + 'x ') + (t.pitch < 0 ? 'Frontflip' : 'Backflip'));
  if (grabbed) parts.push(t.grabs.join(' to '));
  if (!parts.length) parts.push('Big Air');
  missionToast([...track('flips', flips + rolls), ...track('spin', spins, 'max'), ...(p.fromRamp ? track('oneFlips', flips, 'max') : []), ...track('grab', t.grabTotal, 'max'), ...(perfect && !sketchy ? track('perfect', 1) : [])]);
  // hold one grab a long time and it's tweaked out
  if (grabbed && t.longest > 1.8) { pts = Math.round(pts * 1.5); parts.unshift('Boned'); }
  else if (grabbed && t.longest > 1.0) { pts = Math.round(pts * 1.25); parts.unshift('Tweaked'); }
  if (sketchy) { pts = Math.round(pts * 0.4); parts.unshift('Sketchy'); p.comboTimer = 0; Sfx.trick(0); }
  else if (perfect) { pts = Math.round(pts * 1.5); parts.unshift('Perfect'); p.speed += 4; Sfx.perfect(); }
  if (t.switch && isBoard()) pts = Math.round(pts * 1.25);   // tricks out of switch are harder on a board
  if (t.tramp) { pts = Math.round(pts * 1.5); parts.unshift('Tramp'); }
  if (t.pro) { pts = Math.round(pts * 1.3); parts.unshift('Pro'); }
  else Sfx.trick(flips + spins / 360);
  award(parts.join(' '), pts, perfect);
}

function land(groundSlope) {
  const lc = landingCheck();
  if (!lc.ok) return crash('Landed upside down');
  p.y = Math.max(p.y, 0);
  p.grounded = true; p.groundTime = 0; p.grabbing = false;
  p.pitch = 0; p.pitchVel = 0; p.yawVel = 0; p.roll = 0; p.rollVel = 0;
  p.yaw = Math.abs(lc.ny) > Math.PI / 2 ? Math.sign(lc.ny) * Math.PI : 0;
  p.vy = groundSlope * p.speed;
  if (!padAt(p.x, p.z, 'bounce')) p.bounceN = 0;   // a bounce chain ends when you land on snow
  if (lc.sketchy && hardLevel() && p.fromRamp) return crash('Sketchy landing (hard level)');
  if (lc.sketchy) {
    p.speed *= 0.8; p.lean = rand(-0.5, 0.5); shake = 0.3;
    if (!p.trick || (Math.abs(p.trick.pitch) < 2 && Math.abs(p.trick.yaw) < 2)) showTrick('Wobble!', '', false);
  }
  scoreAirTrick(lc.perfect, lc.sketchy);
  p.trick = null;
  latch(LAND_KEYS);
  const hard = p.airTime > 1.2;
  Sfx.land(hard);
  Particles.emit(p.x, p.y + 0.1, p.z, hard ? 30 : 16, 3, 4, 0xffffff, 6);
  shake = hard ? 0.35 : 0.15;
  p.crouch = 1;
  reanchor();
}

function startGrind(r) {
  if (p.lastRail && p.lastRail !== r && !p.grounded) { award('Transfer!', 600, false); Sfx.trick(1); }   // rail to rail through the air
  p.grinding = r; p.grindTime = 0; p.grounded = false; p.vy = 0; p.y = railTop(r, p.z); p.lastRail = r; p.pitch = 0; p.pitchVel = 0; p.yawVel = 0; p.roll = 0; p.rollVel = 0;
  p.yaw = Math.abs(wrap(p.yaw)) > Math.PI / 2 ? Math.PI : 0;
  Sfx.land(false);
}
function leaveRail(pop, h = 0) {
  const r = p.grinding; p.grinding = null;
  if (h) { p.heading = Math.sign(h) * 0.24; p.vx = Math.sin(p.heading) * p.speed; }   // hop off sideways (onto the next rail)
  if (p.grindTime > 0.2) {
    const name = isBoard() ? (p.grindTime > 0.9 ? 'Long Boardslide' : 'Boardslide') : (r.L > 17 ? 'Long Rail Slide' : 'Rail Slide');
    award(name, (isBoard() ? 180 : 150) + Math.round(p.grindTime * 600), false); missionToast(track('rails', 1));
  }
  p.vy = pop; startAir();
  if (pop > 5) Sfx.ollie();
}

const SMASHABLE = new Set(['rock', 'crystal', 'gift']);
const SMASH_COL = { rock: 0x9aa5b1, crystal: 0x3cf2ff, gift: 0xd62839 };
function smash(o) {
  o.dead = true; o.passed = true;
  if (o.pool) o.pool.remove(o.idx); else world.remove(o.mesh);
  o.pool = null; o.mesh = new THREE.Group();
  p.speed *= 0.72; p.lean = rand(-0.6, 0.6); p.combo = 0; p.comboTimer = 0; shake = Math.max(shake, 0.3);
  Particles.emit(o.x, 0.6, o.z, 26, 3, 4, SMASH_COL[o.kind], -2); Particles.emit(o.x, 0.3, o.z, 12, 2, 2, 0xffffff, -1);
  Sfx.tone(120, 0.18, 'triangle', 0.12, 60); Sfx.noise(0.2, 0.5, 600);
  showTrick({ rock: 'Smashed a rock!', crystal: 'Shattered a crystal!', gift: 'Unwrapped a present!' }[o.kind], 'Slowed down', false);
}
function crash(reason) {
  if (p.crashed) return;
  if (demo) return demoRecover();
  p.crashed = true; p.crashT = 0; p.reason = reason; p.grinding = null;
  p.spinX = rand(-14, 14); p.spinZ = rand(-10, 10);
  if (p.grounded) p.vy = 8;
  p.grounded = false;
  state = 'crash';
  Sfx.crash(); Sfx.tone(90, 0.5, 'sawtooth', 0.22, 30); Sfx.noise(0.3, 0.8, 2400, 'highpass'); shake = 0.3;
  Particles.emit(p.x, p.y + 0.5, p.z, 80, 6, 8, 0xffffff, -4);
  breakRider();
  Platform.gameplayStop();
}

// ---------- special worlds: in through an entrance, out through the ring of light ----------
function fadeScreen(color) {
  const f = $('fade'); f.style.transition = 'none'; f.style.background = color; f.style.opacity = 1;
  void f.offsetWidth; f.style.transition = 'opacity 1.2s ease-out'; f.style.opacity = 0;
}
function switchZone(z, clear = 40) {
  zone = z; Music.play(z === 'normal' ? 'mountain' : z);
  clearWorld(); portal = null;
  spawnZ = p.z - clear; decorZ = p.z + 30; wallZ = Math.round(p.z) + 40; p.lastRail = null;
}
function enterWorld(w) {
  const W = WORLDS[w];
  if (zone === 'normal') prevTheme = theme.id || 'day';
  switchZone(w); zoneEndZ = p.z - W.len;
  setTheme(W.theme); setSlope(W.slope); Music.play(w);
  scene.fog.near = W.fog[0]; scene.fog.far = W.fog[1];
  fadeScreen(W.fade); p.speed += 6;
  showTrick(W.name, 'Double points!', true);
  W.tune.forEach((f, i) => Sfx.tone(f, w === 'xmas' ? 0.5 : 1.8, w === 'xmas' ? 'triangle' : 'sine', 0.16, null, i * (w === 'xmas' ? 0.16 : 0.14))); Sfx.perfect();
}
function exitWorld() {
  // ~3 s of open snow (with a coin trail down the middle) so you're not thrown straight into a hazard while the screen flashes
  switchZone('normal', 130); nextCaveD = -p.z + rand(1400, 2200);
  p.heading = 0; p.vx = 0;
  for (let i = 0; i < 14; i++) addCoin(p.x * (1 - i / 14), 1.2, p.z - 25 - i * 6);
  setTheme(prevTheme); setSlope(SLOPES.endless);
  scene.fog.near = 70; scene.fog.far = 230;
  fadeScreen('#fff'); showTrick('Back on the mountain', '', false); Sfx.perfect();
}

// ---------- per-frame player update ----------
function updatePlayer(dt) {
  const inp = readInput(), y0 = p.y;
  const [gh0, gs0] = groundAt(p.x, p.z);
  p.distScore += p.speed * dt * Math.max(1, p.speed / 25) * (special() ? 2 : 1);   // going faster scores faster

  // --- speed: gravity pulls you downhill, drag caps it (cap rises with distance) ---
  if (p.grounded) {
    const vt = baseSpeed(-p.z) * 1.1 * (Math.abs(p.x) > X_LIMIT ? 0.55 : 1);   // you're always tucked; deep powder off the run holds you back
    let acc = 12 * (1 - (p.speed / vt) ** 2);              // downhill pull vs drag
    acc -= 0.35 * G * gs0 / Math.sqrt(1 + gs0 * gs0);      // climbing a kicker costs a bit of speed
    acc -= (isBoard() ? 4.5 : 7) * Math.abs(Math.sin(p.heading));   // carving scrubs speed (a board holds its edge better)
    p.speed = Math.max(8, p.speed + acc * dt);
  } else if (!p.grinding) {
    p.speed = Math.max(8, p.speed - 0.6 * dt);
  }
  // charging a jump
  if (p.charging) p.chargeT = Math.min(MAX_CHARGE, p.chargeT + dt);
  const jumpPop = jumpPower;

  if (p.grinding) {
    const r = p.grinding;
    p.x = damp(p.x, r.x, 20, dt); p.y = railTop(r, p.z); p.vx = 0; p.heading = 0;
    if (r.drop) p.speed = Math.min(p.speed + 3 * dt, baseSpeed(-p.z) * 1.25);   // a down rail picks up speed
    p.z -= p.speed * dt;
    p.grindTime += dt;
    if (Math.random() < 0.6) Particles.emit(p.x, p.y + 0.05, p.z + 0.4, 2, 1.5, 3, 0xffb347, 4);
    if (Math.random() < 0.25) Sfx.grind();
    if (p.z < r.z0 - r.L) leaveRail(4);
    else if (inp.jump) leaveRail(jumpPop + 1, inp.h);
  } else if (p.grounded) {
    p.groundTime += dt;
    // --- carving: steer sets a heading; velocity follows the skis ---
    const maxHead = isBoard() ? 0.72 * clamp(26 / p.speed, 0.6, 1) : 0.62 * clamp(24 / p.speed, 0.55, 1);
    let targetHead = inp.h * maxHead;
    if (Math.abs(p.x) > edgeX() - 1.5 && Math.sign(p.x) === Math.sign(targetHead || p.heading) && !nearSecretDoor()) targetHead = -Math.sign(p.x) * 0.25;
    p.heading = damp(p.heading, targetHead, isBoard() ? (inp.h ? 10 : 9) : (inp.h ? 7 : 8), dt);
    p.vx = Math.sin(p.heading) * p.speed;
    const prevX = p.x;
    p.x += p.vx * dt;
    p.z -= Math.cos(p.heading) * p.speed * dt;
    if (Math.abs(p.x) > edgeX()) { p.x = Math.sign(p.x) * edgeX(); p.heading *= 0.5; }
    if (Math.abs(p.x) > X_LIMIT) {   // off the run: deep powder sprays up
      if (Math.random() < 0.7) Particles.emit(p.x, p.y + 0.2, p.z + 0.5, 3, 1.5, 2.5, 0xffffff, 2);
      if (!p.powderT || time - p.powderT > 6) { p.powderT = time; showTrick('Deep powder', 'Slow going off the run', false); }
    }
    const [gh, gs] = groundAt(p.x, p.z);
    if (gh - p.y > 1.3) {
      // ran into the side wall of a ramp/tabletop: bounce off it instead of dying
      p.x = prevX - Math.sign(p.vx) * 0.15; p.heading = -p.heading * 0.4; p.speed *= 0.85; shake = 0.25;
      if (!p.bonkT || time - p.bonkT > 0.5) { p.bonkT = time; showTrick('Bonk!', '', false); Sfx.tone(140, 0.12, 'square', 0.12); }
      return;
    }
    const groundVy = gs * p.speed;
    // leave the snow off a lip, or when a crest drops away faster than gravity can pull you down (rollers, knuckles)
    if (gh < p.y - 0.25 || (p.vy - groundVy) > G * 1.1 * dt + 0.6) startAir();
    else { p.y = gh; p.vy = groundVy; }
    if (p.grounded && inp.jump) {
      p.vy = Math.max(p.vy, 0) + jumpPop * (isBoard() ? 1.15 : 1); startAir(); Sfx.ollie();
      if (isBoard()) Particles.emit(p.x, p.y + 0.05, p.z + 0.6, 10, 1.5, 2.5, 0xffffff, 3);   // tail snap
    }
    if (p.grounded) {
      const bp = padAt(p.x, p.z, 'bounce');
      if (bp) bounce();
      const sp = padAt(p.x, p.z, 'boost');
      if (sp && !sp.used) {
        sp.used = true; p.speed = Math.min(p.speed + 13, baseSpeed(-p.z) * 1.55); p.boostT = 1;
        showTrick('Boost!', '', false); Sfx.tone(440, 0.35, 'sawtooth', 0.12, 1320); Sfx.noise(0.5, 0.6, 1500, 'bandpass');
        Particles.emit(p.x, 0.2, p.z, 24, 1.5, 2, 0x22d3ee, 10);
      }
    }
    if (p.grounded) {
      const r = railAt(p.x, p.z);
      if (r && r !== p.lastRail) startGrind(r);
    }
    if (p.groundTime > 0.7 && !isBoard()) p.yaw = damp(p.yaw, Math.round(p.yaw / TAU) * TAU, 3, dt);   // a board just rides switch
    // snowboard butter: hold W on the snow to press the nose; release for points
    const butter = isBoard() && inp.v > 0.3 && !p.grinding;
    if (butter) { p.butterT = (p.butterT || 0) + dt; if (Math.random() < 0.5) Particles.emit(p.x, p.y + 0.05, p.z - 0.6, 2, 1, 1.5, 0xffffff, -1); }
    else if (p.butterT > 0.5) { award(p.butterT > 1.5 ? 'Long Nose Butter' : 'Nose Butter', 120 + Math.round(p.butterT * 220), false); p.butterT = 0; }
    else p.butterT = 0;
    p.butter = butter;
    if (isBoard() && Math.abs(p.heading) > 0.25) Particles.emit(p.x - Math.sign(p.heading) * 0.5, p.y + 0.05, p.z + 0.3, 3, 1.8, 3.2, 0xffffff, 4);   // edge spray
    if (Math.abs(p.heading) > 0.3 && Math.random() < 0.6) Particles.emit(p.x - Math.sign(p.heading) * 0.4, p.y + 0.05, p.z + 0.5, 2, 1.2, 2.5, 0xffffff, 3);
    if (p.comboTimer > 0 && !p.grinding) { p.comboTimer -= dt; if (p.comboTimer <= 0) p.combo = 0; }
  } else {
    // airborne — keep the momentum you took off with
    p.airTime += dt;
    p.x += p.vx * dt;
    p.z -= Math.cos(p.heading) * p.speed * dt;
    if (Math.abs(p.x) > edgeX()) { p.x = Math.sign(p.x) * edgeX(); p.vx = 0; }
    const prevY = p.y;
    p.vy -= G * (p.vy < 0 ? 1.15 : 1) * dt; p.y += p.vy * dt;   // slightly heavier fall = snappier
    p.maxH = Math.max(p.maxH, p.y - gh0);
    p.grabbing = inp.grab && p.airTime > 0.12;
    const mul = p.grabbing ? 0.65 : 1, spinMul = isBoard() ? 1.15 : 1, flipMul = isBoard() ? 0.92 : 1;
    // just before touchdown the rider commits to the nearest landing
    const nearGround = p.vy < 0 && (p.y - gh0) / -p.vy < 0.2;
    if (nearGround) { inp.v = 0; inp.h = 0; }
    // flip (W/S) · spin (A/D) · both together = sideflip toward the spin direction
    const diag = Math.abs(inp.v) > 0.35 && Math.abs(inp.h) > 0.35;
    if (diag) {
      p.rollVel = damp(p.rollVel, -Math.sign(inp.h) * ROLL_RATE * mul, 10, dt);
      p.pitchVel = settle(p.pitch, p.pitchVel, TAU, FLIP_RATE, dt);
      p.yawVel = settle(p.yaw, p.yawVel, Math.PI, SPIN_RATE, dt);
    } else {
      p.rollVel = settle(p.roll, p.rollVel, TAU, ROLL_RATE, dt);
      if (inp.v) p.pitchVel = damp(p.pitchVel, -inp.v * FLIP_RATE * mul * flipMul, 10, dt);
      else p.pitchVel = settle(p.pitch, p.pitchVel, TAU, FLIP_RATE, dt);
      if (inp.h) p.yawVel = damp(p.yawVel, -inp.h * SPIN_RATE * mul * spinMul, 10, dt);
      else p.yawVel = settle(p.yaw, p.yawVel, Math.PI, SPIN_RATE, dt);
    }
    p.pitch += p.pitchVel * dt; p.yaw += p.yawVel * dt; p.roll += p.rollVel * dt;
    if (p.trick) { p.trick.pitch += p.pitchVel * dt; p.trick.yaw += p.yawVel * dt; p.trick.roll += p.rollVel * dt; if (p.grabbing) { const t = p.trick; t.grab += dt; t.grabTotal += dt; t.longest = Math.max(t.longest, t.grab); if (!t.locked && t.grab > 0.25) { t.locked = true; grabLocked(t.grabName); } } }

    // coming down near a rail pulls you onto it a little, so rail-to-rail transfers and gap-to-rails are makeable
    if (p.vy < 0) for (const rr of rails) {
      if (p.z > rr.z0 || p.z < rr.z0 - rr.L || Math.abs(p.x - rr.x) > 2.4) continue;
      const ty = railTop(rr, p.z); if (p.y > ty - 0.2 && p.y < ty + 3) { p.x = damp(p.x, rr.x, 7, dt); break; }
    }
    const r = p.vy < 0 ? railAt(p.x, p.z) : null;
    if (r && prevY >= railTop(r, p.z) - 0.2 && p.y <= railTop(r, p.z) + 0.1) {
      const lc = landingCheck();
      if (!lc.ok) return crash('Slipped off the rail');
      scoreAirTrick(lc.perfect); p.trick = null;
      startGrind(r);
    } else {
      const [gh, gs] = groundAt(p.x, p.z);
      if (p.y <= gh) { p.y = gh; land(gs); if (p.grounded && padAt(p.x, p.z, 'bounce')) bounce(); }
      else if (p.y < -0.6) return crash('Fell into a crevasse');
    }
  }
  if (p.grounded || p.grinding) p.lastRail = p.grinding || (railAt(p.x, p.z) ? p.lastRail : null);

  // obstacles
  for (const o of obstacles) {
    if (o.dead) continue;
    const dz = o.z - p.z, dx = o.x - p.x;
    if (o.kind === 'log') {
      if (Math.abs(dz) < 0.45 && Math.abs(dx) < o.hw + 0.1 && p.y < o.h && (p.grounded || p.vy < 0)) return crash('Tripped over a log');
      if (!o.passed && p.z < o.z - 0.6) { o.passed = true; if (Math.abs(dx) < o.hw + 0.3 && p.y >= o.h) { p.trickScore += 100; showTrick('Log hop!', '+100', false); Sfx.near(); missionToast(track('near', 1)); } }
      continue;
    }
    if (SMASHABLE.has(o.kind) && !hardLevel()) {
      // a smaller, fairer hitbox, and hitting one is a stumble, not the end of the run
      if (Math.abs(dz) < o.r * 0.6 + 0.25 && Math.abs(dx) < o.r * 0.7 + 0.15 && p.y < o.h * 0.85) smash(o);
      else if (!o.passed && p.z < o.z - o.r) {
        o.passed = true;
        if (Math.abs(dx) < o.r + 1.1 && p.y < o.h + 0.8) { p.trickScore += 50; showTrick('Close call!', '+50', false); Sfx.near(); missionToast(track('near', 1)); }
      }
      continue;
    }
    // dropping onto the very top of a tree bounces you off it instead of killing you
    if (o.kind === 'tree' && o.topT && time - o.topT < 0.6) continue;
    if (o.kind === 'tree' && !p.grounded && !p.grinding && p.vy <= 0 && y0 >= o.h * 0.72 && Math.abs(dz) < o.r + 0.5 && Math.abs(dx) < o.r + 0.32 && p.y < o.h) {
      o.topT = time; o.passed = true;
      p.y = o.h; p.vy = 9;
      p.trickScore += 300; showTrick('Treetop bounce!', '+300', false);
      Sfx.tone(520, 0.12, 'triangle', 0.14, 780); Sfx.noise(0.15, 0.3, 1400);
      Particles.emit(o.x, o.h, o.z, 24, 3, 3, 0xffffff, -2); Particles.emit(o.x, o.h - 0.4, o.z, 10, 2, 2, 0x2f6b3a, -3);
      continue;
    }
    if (Math.abs(dz) < o.r + 0.5 && Math.abs(dx) < o.r + 0.32 && p.y < o.h)
      return crash({ tree: 'Hugged a tree', rock: 'Hit a rock', ball: 'Flattened by a snowball', bear: 'Mauled by a polar bear', crystal: 'Impaled on a crystal', gift: 'Wrapped up by a present', cane: 'Licked a candy cane at full speed' }[o.kind]);
    if (o.kind === 'bear' && !o.roared && dz < 0 && dz > -28) { o.roared = true; Sfx.tone(120, 0.7, 'sawtooth', 0.16, 70); Sfx.noise(0.6, 0.35, 500); }
    if (!o.passed && p.z < o.z - o.r) {
      o.passed = true;
      if (Math.abs(dx) < o.r + 1.1 && p.y < o.h + 0.8) { p.trickScore += 50; showTrick('Close call!', '+50', false); Sfx.near(); missionToast(track('near', 1)); }
    }
  }
  if (Math.abs(p.x) > X_LIMIT - 0.5) for (const o of solids) {
    if (Math.abs(o.z - p.z) < o.hz + 0.3 && Math.abs(o.x - p.x) < o.hx + 0.3 && p.y < o.h) {
      if (o.name === 'Ran into a cabin' && secretCabin && !secretCabin.used && Math.abs(p.z - secretCabin.z) < 1.9) continue;   // that's the door
      return crash(o.name);
    }
  }
  // the cave mouth (ride in to go underground) and the way back out
  for (const c of caves) if (!c.used && p.z < c.z - 1.5) { c.used = true; if (Math.abs(p.x - c.x) < 3.2 && p.y < 6) return enterWorld(c.to); }
  if (special() && portal && p.z < portal.z) return exitWorld();
  if (secretCabin && !secretCabin.used) {
    if (p.x > X_LIMIT - 1.4 && Math.abs(p.z - secretCabin.z) < 1.9 && p.y < 2.5 && !p.grinding) { secretCabin.used = true; return enterCabin(); }
    if (p.z < secretCabin.z - 3) secretCabin.used = true;
  }
  for (const c of crevasses) {
    if (!c.passed && p.z < c.z0 - c.L) { c.passed = true; p.trickScore += 300; showTrick('Crevasse cleared!', '+300', false); Sfx.trick(1); missionToast(track('crevasse', 1)); }
  }
  // race checkpoints & finish
  if (mode === 'race') {
    for (const g of gates) {
      if (g.passed || p.z > g.z) continue;
      g.passed = true;
      const t = race.t;
      if (Math.abs(p.x - g.x) < g.w / 2 + 0.3) {
        race.gates++; race.splits[g.n - 1] = t;
        showTrick(`Checkpoint ${g.n}/${checkpoints.length}`, '+500 pts', true);
        Sfx.tone(988, 0.1, 'triangle', 0.14); Sfx.tone(1319, 0.14, 'triangle', 0.14, null, 0.08);
      } else {
        race.splits[g.n - 1] = t;
        showTrick('Missed checkpoint', '500 pt bonus missed', false); Sfx.tone(180, 0.25, 'square', 0.1);
      }
    }
    if (p.z < -RACE_LEN) return finishRace();
  }
  if (mode === 'level' && p.z < -level.def.len) return levelOver(true);
}

// Coins: tested along the rider's whole path this frame, so nothing tunnels past at 200 km/h.
// Coins never move toward you; the pickup reach is just a little generous.
function collectCoins(x0, y0, z0) {
  const x1 = p.x, y1 = p.y + 0.9, z1 = p.z;
  y0 += 0.9;
  const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0, len2 = sx * sx + sy * sy + sz * sz || 1;
  for (const c of coins) {
    if (c.taken || c.z < z1 - 3 || c.z > z0 + 3) continue;
    // closest point on this frame's path to the coin
    const t = clamp(((c.x - x0) * sx + (c.y - y0) * sy + (c.z - z0) * sz) / len2, 0, 1);
    const dx = c.x - (x0 + sx * t), dy = (c.y - (y0 + sy * t)) * 0.75, dz = c.z - (z0 + sz * t);
    if (Math.hypot(dx, dy, dz) < 1.7) {
      c.taken = true; c.pool.remove(c.idx);
      if (c.gold) { p.coins += 9; p.trickScore += 475; showTrick('GOLDEN COIN!', '+10 coins', true); Sfx.perfect(); Particles.emit(c.x, c.y, c.z, 30, 4, 5, 0xffd23f, -2); }
      p.coins++; p.trickScore += 25; Sfx.coin(); missionToast(track('coins', 1));
      Particles.emit(c.x, c.y, c.z, 8, 2, 3, 0xffd23f, -2);
    }
  }
}

function respawn() {
  for (const c of crevasses) if (p.z <= c.z0 + 2 && p.z >= c.z0 - c.L - 2) p.z = c.z0 - c.L - 3;
  for (const o of obstacles) if (Math.abs(o.z - p.z) < 6) { o.dead = true; if (o.pool) o.pool.remove(o.idx); else world.remove(o.mesh); o.pool = null; o.mesh = new THREE.Group(); }
  Object.assign(p, { crashed: false, y: 0, vy: 0, vx: 0, speed: 14, pitch: 0, yaw: 0, roll: 0, rollVel: 0, lean: 0, heading: 0, grounded: true, trick: null, grinding: null, pitchVel: 0, yawVel: 0, combo: 0, comboTimer: 0 });
  p.x = clamp(p.x, -X_LIMIT, X_LIMIT);
  fixRider();
  state = 'play';
  Platform.gameplayStart();
  showTrick('Back on your feet', '', false);
}
function updateCrash(dt) {
  p.crashT += dt;
  p.speed = damp(p.speed, 0, 1.6, dt);
  p.z -= p.speed * dt; p.x += p.vx * dt; p.vx = damp(p.vx, 0, 2, dt);
  const [gh] = groundAt(p.x, p.z);
  p.vy -= G * dt; p.y += p.vy * dt;
  if (p.y < gh) { p.y = gh; p.vy = Math.abs(p.vy) > 2 ? -p.vy * 0.35 : 0; if (p.speed > 4) Particles.emit(p.x, p.y, p.z, 4, 2, 3, 0xffffff, 0); }
  // a blood trail while the body slides
  if (p.y < gh + 0.4 && p.crashT < 2.2 && p.bleedZ - p.z > 0.7) {
    p.bleedZ = p.z; Debris.mark(p.x + rand(-0.3, 0.3), p.z, rand(0.18, 0.4));
    if (Math.random() < 0.5) Particles.emit(p.x, p.y + 0.3, p.z, 3, 1, 2, 0xc1121f, 0);
  }
  p.pitch += p.spinX * dt; p.lean += p.spinZ * dt;
  p.spinX = damp(p.spinX, 0, 1.2, dt); p.spinZ = damp(p.spinZ, 0, 1.2, dt);
  p.y = Math.max(p.y, -3);
  if (mode === 'race' && p.crashT > 1.1) respawn();
  else if (mode !== 'race' && p.crashT > 1.5) gameOver();
}

// ---------- visuals ----------
let time = 0, shake = 0;
const tmpV = new THREE.Vector3(), camLook = new THREE.Vector3(), camPos = new THREE.Vector3();
function updateSkierVisual(dt) {
  const [gh, gs] = groundAt(p.x, p.z);
  skier.root.position.set(p.x, p.y, p.z);
  const targetTilt = (p.grounded && !p.crashed) ? Math.atan(gs) : 0;
  p.tilt = damp(p.tilt, targetTilt, 12, dt);
  p.slideYaw = damp(p.slideYaw, p.grinding ? Math.PI / 2 : 0, 14, dt);
  const steerYaw = p.crashed ? 0 : -p.heading;
  const leanK = isBoard() ? 1.4 : 1, leanMax = isBoard() ? 0.8 : 0.62;
  if (!p.crashed) p.lean = damp(p.lean, p.grounded ? clamp(-p.heading * clamp(p.speed / 25, 0.4, 1.2) * leanK, -leanMax, leanMax) : 0, 8, dt);
  const b = skier.body;
  b.rotation.y = p.yaw + p.slideYaw + steerYaw;
  b.rotation.x = p.pitch + p.tilt;
  b.rotation.z = p.lean + p.roll;
  // pose
  const targetCrouch = p.crashed ? 0.6 : p.grabbing ? 1 : p.charging ? 0.5 + 0.5 * p.chargeT / MAX_CHARGE : p.grinding ? 0.45 : p.grounded ? (0.3 + Math.min(0.25, p.speed / 140)) : 0.45;
  p.crouch = damp(p.crouch, targetCrouch, 10, dt);
  const c = p.crouch;
  skier.legs.scale.y = 1 - 0.4 * c;
  skier.upper.position.y = -0.2 - 0.22 * c;
  skier.upper.rotation.x = -0.45 * c;
  // arms ease into each grab's own pose (or the riding pose)
  const gp = p.grabbing && p.trick ? GRAB_POSE[p.trick.grabName] : null;
  const ride = isBoard() ? [0.1, -0.75, 0.1, 0.75] : [0.35, -0.18, 0.35 + 0.2 * Math.sin(time * 6) * (p.grounded ? 0.3 : 0), 0.18];
  const tgt = gp || ride, k = 1 - Math.exp(-18 * dt);
  skier.arms[0].rotation.x += (tgt[0] - skier.arms[0].rotation.x) * k; skier.arms[0].rotation.z += (tgt[1] - skier.arms[0].rotation.z) * k;
  skier.arms[1].rotation.x += (tgt[2] - skier.arms[1].rotation.x) * k; skier.arms[1].rotation.z += (tgt[3] - skier.arms[1].rotation.z) * k;
  p.arch = damp(p.arch || 0, gp ? gp[4] : p.butter ? 0.28 : 0, 10, dt);
  b.rotation.x += p.arch;
  // the skis/board swing out into the grab's tweak (the boots go with them), and the poles tuck away
  const tw = gp && GRAB_TWEAK[p.trick.grabName] || [0, 0, 0], tk = 1 - Math.exp(-14 * dt);
  tweakE.set(tweakE.x + (tw[0] - tweakE.x) * tk, tweakE.y + (tw[1] - tweakE.y) * tk, tweakE.z + (tw[2] - tweakE.z) * tk);
  for (const g of [skier.skis, skier.board]) g.rotation.copy(tweakE);
  skier.legs.rotation.set(tweakE.x, tweakE.y + (isBoard() ? Math.PI / 2 : 0), tweakE.z, 'YXZ'); skier.legs.position.copy(legsV.set(0, -0.85, 0).applyEuler(tweakE));
  for (const pl of skier.poles) pl.rotation.x = damp(pl.rotation.x, gp ? -1.2 : -0.25, 12, dt);
  // blob shadow
  const sh = gh, height = Math.max(0, p.y - sh);
  skier.shadow.position.set(p.x, sh + 0.03, p.z);
  const ss = Math.max(0.35, 1 - height * 0.08);
  skier.shadow.scale.set(ss, 1, ss);
  skier.shadow.visible = !p.grinding;
}

let orbit = 0;
// Camera views: chase (default), high, first person, side. Cycle with C or the camera button.
const VIEWS = [{ id: 'chase', name: 'Chase cam' }, { id: 'high', name: 'High cam' }, { id: 'first', name: 'First person' }, { id: 'side', name: 'Side cam' }];
let viewIdx = Math.max(0, VIEWS.findIndex(v => v.id === save.view));
function cycleView() {
  viewIdx = (viewIdx + 1) % VIEWS.length;
  save.view = VIEWS[viewIdx].id; persist();
  if (state === 'play' || state === 'crash') showTrick(VIEWS[viewIdx].name, '', false);
  snapCam = true;
}
let snapCam = false;
const eyeV = new THREE.Vector3(), lookV = new THREE.Vector3(), upV = new THREE.Vector3();
function updateCamera(dt) {
  let view = VIEWS[viewIdx].id;
  if (view === 'first' && (p.crashed || state === 'menu')) view = 'chase';   // tumbling in first person is unreadable
  skier.upper.visible = view !== 'first';
  camera.up.set(0, 1, 0);
  const k = snapCam ? 60 : 1;
  if (state === 'menu' && closet.on) {
    camPos.set(0, 1.4, -(closet.dist || 4.8)); camLook.set(0, 1.1, 0);
    world.localToWorld(camPos); world.localToWorld(camLook);
    camera.position.lerp(camPos, 1 - Math.exp(-6 * dt)); camera.lookAt(camLook);
    if (Math.abs(camera.fov - 40) > 0.05) { camera.fov = damp(camera.fov, 40, 6, dt); camera.updateProjectionMatrix(); }
  } else if (state === 'menu' && demo) {
    // a slow cinematic chase that drifts from side to side
    orbit += dt * 0.12;
    if (Math.abs(camera.fov - 62) > 0.05) { camera.fov = damp(camera.fov, 62, 3, dt); camera.updateProjectionMatrix(); }
    tmpV.set(p.x * 0.6 + Math.sin(orbit) * 4.5 * Math.min(1, camera.aspect), Math.max(0, p.y) * 0.6 + 2.6, p.z + 6.5); world.localToWorld(tmpV);
    if (snapCam) camera.position.copy(tmpV);
    camera.position.x = damp(camera.position.x, tmpV.x, 3, dt);
    camera.position.y = damp(camera.position.y, tmpV.y, 4, dt);
    camera.position.z = damp(camera.position.z, tmpV.z, 10, dt);
    tmpV.set(p.x * 0.85, Math.max(0, p.y) * 0.8 + 4.4, p.z - 6); world.localToWorld(tmpV);   // look a little high, so the rider rides below the menu
    if (snapCam) camLook.copy(tmpV); else camLook.lerp(tmpV, 1 - Math.exp(-8 * dt));
    camera.lookAt(camLook);
  } else if (state === 'menu') {
    if (Math.abs(camera.fov - 66) > 0.05) { camera.fov = damp(camera.fov, 66, 6, dt); camera.updateProjectionMatrix(); }
    orbit += dt * 0.25;
    camPos.set(Math.sin(orbit) * 6.5, 2.6, Math.cos(orbit) * 6.5 - 1);
    camLook.set(0, 1.1, 0);
    world.localToWorld(camPos); world.localToWorld(camLook);
    camera.position.copy(camPos); camera.lookAt(camLook);
  } else if (view === 'first') {
    // eyes sit in the helmet and turn with the body, so flips and spins are felt from the inside
    skier.body.updateMatrixWorld(true);
    eyeV.set(0, 0.62, -0.25).applyMatrix4(skier.body.matrixWorld);
    lookV.set(0, 0.25, -10).applyMatrix4(skier.body.matrixWorld);
    upV.set(0, 1, 0).transformDirection(skier.body.matrixWorld);
    camera.position.copy(eyeV);
    camera.up.copy(upV);
    camLook.copy(lookV);
    camera.lookAt(camLook);
  } else {
    let off, ahead;
    if (view === 'high') { off = [p.x * 0.6, Math.max(0, p.y) * 0.45 + 10, p.z + 15]; ahead = [p.x * 0.8, Math.max(0, p.y) * 0.6, p.z - 14]; }
    else if (view === 'side') { off = [p.x + 9, Math.max(0, p.y) * 0.7 + 2.4, p.z - 1]; ahead = [p.x, p.y + 1, p.z - 3]; }
    else { off = [p.x * 0.75, Math.max(0, p.y) * 0.55 + 4.4, p.z + 10]; ahead = [p.x * 0.85, Math.max(0, p.y) * 0.75 + 1.2, p.z - 9]; }
    tmpV.set(...off); world.localToWorld(tmpV);
    camera.position.x = damp(camera.position.x, tmpV.x, 6 * k, dt);
    camera.position.y = damp(camera.position.y, tmpV.y, 5 * k, dt);
    camera.position.z = damp(camera.position.z, tmpV.z, 12 * k, dt);
    tmpV.set(...ahead); world.localToWorld(tmpV);
    camLook.lerp(tmpV, 1 - Math.exp(-10 * k * dt));
    camera.lookAt(camLook);
  }
  snapCam = false;
  if (state !== 'menu') {
    const fov = (view === 'first' ? 78 : 64) + clamp((p.speed - 20) * 0.5, 0, 14) + (p.boostT || 0) * 12;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = damp(camera.fov, fov, 3, dt); camera.updateProjectionMatrix(); }
  }
  if (view === 'first') shake *= 0.5;
  if (shake > 0) {
    camera.position.x += rand(-1, 1) * shake * 0.4; camera.position.y += rand(-1, 1) * shake * 0.4;
    shake = Math.max(0, shake - dt * 1.8);
  }
  mountains.position.set(camera.position.x, camera.position.y, camera.position.z);
  sky.position.copy(camera.position);
  headlamp.position.set(camera.position.x, camera.position.y + 2, camera.position.z - 4);
  // keep ground under the player
  ground.position.z = Math.round((state === 'menu' && !demo ? 0 : p.z) / 10) * 10 - 200;
  ground.position.x = 0;
}

function updateCoins() {
  const ry = time * 3;
  for (const c of coins) if (!c.taken) c.pool.set(c.idx, c.x, c.y + Math.sin(time * 4 + c.z) * 0.12, c.z, c.gold ? 1.5 : 1, c.gold ? ry * 1.6 : ry);
}

// ---------- race ghosts ----------
// A ghost is a recording of a racer's best run: 10 samples/s of [x, y, z, rotX, rotY, rotZ] × 100 as ints.
const ghosts = [];
const GHOST_COLORS = ['#9bf6ff', '#ffd166', '#c77dff', '#80ffdb'];
function nameTag(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.font = '800 30px system-ui, sans-serif'; const w = Math.min(240, g.measureText(text).width + 36);
  g.fillStyle = 'rgba(15,28,46,.75)'; g.beginPath(); g.roundRect((256 - w) / 2, 8, w, 48, 24); g.fill();
  g.fillStyle = color; g.textAlign = 'center'; g.fillText(text, 128, 43);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(2.6, 0.65, 1); s.position.y = 2.7; return s;
}
function addGhost(name, data) {
  if (!data || !Number.isFinite(data.score) || !Number.isFinite(data.t) || data.t <= 0
    || !Array.isArray(data.f) || data.f.length < 60 || data.f.length > 54000 || data.f.length % 6
    || !data.f.every(Number.isFinite) || ghosts.length >= 4) return;
  const color = GHOST_COLORS[ghosts.length % GHOST_COLORS.length];
  const root = skier.root.clone(true);
  const clonedCrown = root.getObjectByName('leader-crown');
  if (clonedCrown) clonedCrown.visible = false;
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false });
  root.traverse(o => { if (o.isMesh) o.material = m; });
  root.add(nameTag(name, color));
  world.add(root);
  ghosts.push({ name, score: data.score, t: data.t, f: data.f, n: Math.floor(data.f.length / 6), root, body: root.children[0] });
}
function clearGhosts() { for (const g of ghosts) world.remove(g.root); ghosts.length = 0; }
function ghostState(g) {
  const fi = race.t * 10, i = Math.min(Math.floor(fi), g.n - 1), j = Math.min(i + 1, g.n - 1), a = Math.min(1, fi - i);
  const L = o => (g.f[i * 6 + o] + (g.f[j * 6 + o] - g.f[i * 6 + o]) * a) / 100;
  return { done: fi >= g.n - 1, x: L(0), y: L(1), z: L(2), rx: L(3), ry: L(4), rz: L(5) };
}
function updateGhosts() {
  for (const g of ghosts) {
    const s = ghostState(g);
    g.root.position.set(s.x, s.y, s.z);
    g.body.rotation.set(s.rx, s.ry, s.rz);
    g.root.visible = !s.done;
  }
}

// ---------- HUD ----------
const hud = { score: $('score'), coins: $('coinCount'), combo: $('combo'), comboText: $('comboText'), comboFill: $('comboFill'), trick: $('trick'), trickName: $('trickName'), trickPts: $('trickPts'), hint: $('hint'), race: $('raceInfo'), speed: $('speedo') };
let lastScore = -1, lastCoins = -1, hintT = 0;
const totalScore = () => Math.floor(p.distScore) + p.trickScore;
function showTrick(name, pts, perfect) {
  hud.trickName.textContent = name; hud.trickPts.textContent = pts;
  hud.trick.classList.remove('show'); void hud.trick.offsetWidth;
  hud.trick.classList.toggle('perfect', !!perfect);
  hud.trick.classList.add('show');
}
const fmtTime = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
function updateHUD(dt) {
  if (mode === 'level') {
    const s = totalScore(), [s2, s3] = levelStars(level.def);
    if (s !== lastScore) { hud.score.textContent = s.toLocaleString(); lastScore = s; }
    const stars = s >= s3 ? '★★★' : s >= s2 ? '★★☆' : '★☆☆', next = s >= s3 ? '' : `  ·  next ★ at ${(s >= s2 ? s3 : s2).toLocaleString()}`;
    hud.race.textContent = `LEVEL ${level.n + 1} ${level.def.diff.toUpperCase()}  ·  ${Math.max(0, Math.ceil(level.def.len + p.z))} m to go  ·  ${stars}${next}`;
  } else if (mode === 'race') {
    hud.score.textContent = (totalScore() + race.gates * 500).toLocaleString();
    hud.race.textContent = `${fmtTime(race.t)} elapsed  ·  ${Math.max(0, Math.ceil(RACE_LEN + p.z))} m  ·  CP ${race.gates}/${checkpoints.length}`;
  } else {
    const s = totalScore();
    if (s !== lastScore) { hud.score.textContent = s.toLocaleString(); lastScore = s; }
    hud.race.classList.toggle('hidden', !special());
    if (special()) hud.race.textContent = `${WORLDS[zone].name}  ·  x2 points  ·  ${Math.max(0, Math.ceil(p.z - zoneEndZ))} m to the exit`;
  }
  if (p.coins !== lastCoins) { hud.coins.textContent = p.coins; lastCoins = p.coins; }
  hud.speed.textContent = `${Math.round(p.speed * 3.6)} km/h`;
  const showCombo = p.combo > 1 && p.comboTimer > 0;
  hud.combo.classList.toggle('hidden', !showCombo);
  if (showCombo) {
    hud.comboText.textContent = `COMBO x${Math.min(1 + 0.5 * (p.combo - 1), 8)}  ·  ${p.comboTotal.toLocaleString()}`;
    hud.comboFill.style.width = `${(p.comboTimer / COMBO_WINDOW) * 100}%`;
  }
  if (hintT > 0) { hintT -= dt; if (hintT <= 0) hud.hint.style.opacity = 0; }
}
const HINT_DESKTOP = '<kbd>A</kbd> <kbd>D</kbd> steer &nbsp; <kbd>Space</kbd> jump<br>In the air: <kbd>W</kbd> <kbd>S</kbd> flip &nbsp; <kbd>A</kbd> <kbd>D</kbd> spin &nbsp; both = sideflip &nbsp; hold <kbd>G</kbd> grab, tap <kbd>G</kbd> again to switch grab<br><kbd>C</kbd> camera &nbsp; <kbd>P</kbd> pause &nbsp; <kbd>M</kbd> mute';
const HINT_TOUCH = 'Left thumb: steer · Right thumb: jump<br>In the air: stick up/down flips, sideways spins, diagonal sideflips · hold jump to grab';

// ---------- game flow ----------
let state = 'menu', paused = false, overlayBusy = false, mode = 'endless';
const race = { t: 0, gates: 0, penalty: 0, day: '' };
const today = () => new Date().toISOString().slice(0, 10);
function show(id, on) { $(id).classList.toggle('hidden', !on); }

function startRun(m = mode) {
  mode = m; demo = false; Sfx.quiet = false; clearTouch(); Music.play('mountain');
  Quality.cap = Infinity; Quality.apply();
  if (mode === 'level') level.def = LEVELS[level.n], level.idx = 0;
  const LV = mode === 'level' ? level.def : null;
  zone = LV?.zone || 'normal'; portal = null; islandDone = false; nextCaveD = LV ? Infinity : 900 + rand(0, 400); nextWorld = Math.random() < 0.5 ? 'agartha' : 'xmas';
  setSlope(mode === 'race' ? SLOPES.race : LV?.zone ? WORLDS[LV.zone].slope : SLOPES.endless);
  if (LV?.zone) Music.play(LV.zone);
  SkiTracks.clear(); Debris.clear(); fixRider();
  if (closet.on) setCloset(false);
  Sfx.init();
  jumpQueued = false; latched.clear();
  clearWorld();
  resetPlayer(); resetRun();
  Object.assign(race, { t: 0, gates: 0, penalty: 0, day: today(), splits: [], rec: [], recT: 0 });
  X_LIMIT = mode === 'race' ? 11 : LV ? Math.max(8.5, (LV.width ?? 13) - levelDiff().narrow) : 13;
  scene.fog.near = mode === 'race' ? 45 : 70; scene.fog.far = mode === 'race' ? 170 : 230;
  checkpoints = [];
  clearGhosts();
  if (mode === 'race') {
    const cr = mulberry32(hashStr('cp-' + race.day));
    for (let i = 1; i <= 11; i++) checkpoints.push({ x: (cr() * 2 - 1) * 5.5, z: -125 * i, w: 8 });
    if (save.ghost?.day === race.day) addGhost('Your best', save.ghost);
    const day = race.day;
    fetchGhosts(day).then(list => { if (mode === 'race' && race.day === day && state === 'play') for (const g of list) addGhost(g.name, g.ghost); });
  }
  setTheme(mode === 'race' ? 'day' : LV ? LV.theme : pickTheme());   // the Daily Race keeps its original daytime look
  if (LV?.zone) { scene.fog.near = WORLDS[LV.zone].fog[0]; scene.fog.far = WORLDS[LV.zone].fog[1]; }
  crng = mode === 'race' ? mulberry32(hashStr('peakflip-' + race.day)) : LV ? mulberry32(hashStr('peakflip-level-' + level.n)) : Math.random;
  laneSeed = [crng() * 6.28, crng() * 6.28];
  decorN = 0;
  spawnZ = -55; decorZ = 30; wallZ = 40;
  checkpoints.forEach((c, i) => addCheckpointArch(c, i + 1));
  while (decorZ > -VIEW) { spawnDecor(decorZ); decorZ -= 4; }
  state = 'play'; paused = false;
  show('menu', false); show('over', false); show('pause', false); show('panel', false); show('hud', true);
  show('raceInfo', mode === 'race' || mode === 'level');
  if (LV) showTrick(`Level ${level.n + 1}: ${LV.name}`, LV.diff === 'hard' ? 'HARD: rocks kill, no sketchy landings' : 'One crash and you start over', true);
  camera.position.set(0, 6, 12);
  camLook.set(0, 0, -10);
  lastScore = lastCoins = -1;
  if (save.runs < 3) { hintT = 9; hud.hint.style.opacity = 1; } else { hintT = 0; hud.hint.style.opacity = 0; }
  hud.hint.innerHTML = isTouch ? HINT_TOUCH : HINT_DESKTOP;
  Platform.gameplayStart();
}

function endCommon() {
  clearTouch();
  save.runs++;
  save.coins += p.coins;
  const missions = settleMissions();
  persist();
  show('hud', false);
  return missions;
}

function gameOver() {
  if (mode === 'level') return levelOver(false);
  state = 'over';
  const score = totalScore();
  const newBest = score > save.best;
  if (newBest) save.best = score;
  const bonus = Math.floor(score / 400);
  save.coins += bonus;
  const missions = endCommon();
  showResults({ mode: 'endless', score, newBest: newBest && score > 300, reason: p.reason, coins: p.coins, bonus, missions, dist: Math.floor(-p.z) });
}

function finishRace() {
  state = 'over';
  Platform.gameplayStop();
  const time = +race.t.toFixed(2);
  const score = totalScore() + race.gates * 500;
  save.raceScores = save.raceScores || {};
  const prev = save.raceScores[race.day];
  const newBest = !prev || score > prev.score || (score === prev.score && time < prev.time);
  const ghost = { t: time, score, f: race.rec };
  if (newBest) {
    save.ghost = { day: race.day, ...ghost };
    save.raceScores[race.day] = { score, time };
  }
  const field = ghosts.map(g => ({ name: g.name, score: g.score, t: g.t }))
    .concat([{ name: 'You', score, t: time, me: true }])
    .sort((a, b) => b.score - a.score || a.t - b.t);
  field.forEach((row, i) => { row.rank = i > 0 && row.score === field[i - 1].score && row.t === field[i - 1].t ? field[i - 1].rank : i + 1; });
  const beat = ghosts.filter(g => score > g.score || (score === g.score && time < g.t)).length;
  const bonus = 40 + race.gates * 5 + beat * 25;
  save.coins += bonus;
  const missions = endCommon();
  Sfx.perfect();
  showResults({ mode: 'race', score, time, raw: race.t, penalty: 0, gates: race.gates, gateTotal: checkpoints.length, field, ghost: newBest ? ghost : null, newBest, best: save.raceScores[race.day].score, bestTime: save.raceScores[race.day].time, day: race.day, coins: p.coins, bonus, missions });
}

async function restartWithAd() {
  if (overlayBusy) return;
  overlayBusy = true;
  try { await Platform.midgameAd(); } catch {}   // an ad problem must never block the next run
  finally { overlayBusy = false; }
  startRun(mode);
}

function toMenu() {
  zone = 'normal'; portal = null; setSlope(SLOPES.race);
  SkiTracks.clear(); Debris.clear(); fixRider();
  state = 'menu'; paused = false; mode = 'endless'; X_LIMIT = 13; checkpoints = []; clearGhosts();
  scene.fog.near = 70; scene.fog.far = 230;
  if (closet.on) menuStill(); else startDemo();
  show('over', false); show('pause', false); show('hud', false); show('menu', true);
  showMenuUI();
}

// the Locker's still scene: the avatar standing at the top of an empty slope
function menuStill() {
  demo = false;
  setSlope(SLOPES.race); SkiTracks.clear(); Debris.clear(); fixRider();
  clearWorld(); resetPlayer();
  decorZ = 30; decorN = 0; wallZ = 40; spawnWalls(-VIEW); while (decorZ > -VIEW) { spawnDecor(decorZ); decorZ -= 4; }
}

// ---------- attract mode: a bot rides forever behind the menu ----------
const bot = { trick: null, hopT: 2, wipeouts: 0 };
function startDemo() {
  demo = true; Music.play('mountain');
  Quality.cap = 1; Quality.apply();   // the menu backdrop doesn't need full resolution
  zone = 'normal'; portal = null; nextCaveD = Infinity;
  setSlope(SLOPES.endless);
  SkiTracks.clear(); Debris.clear(); fixRider();
  clearWorld(); resetPlayer();
  crng = Math.random; laneSeed = [crng() * 6.28, crng() * 6.28];
  decorN = 0; spawnZ = -40; decorZ = 30; wallZ = 40;
  spawnWalls(-VIEW); while (decorZ > -VIEW) { spawnDecor(decorZ); decorZ -= 4; }
  bot.trick = null; bot.hopT = 2;
  snapCam = true;
}
// a wipeout in attract mode: clear whatever was hit and ride on, upright
function demoRecover() {
  bot.wipeouts++;
  for (const o of obstacles) if (Math.abs(o.z - p.z) < 6) { o.dead = true; if (o.pool) o.pool.remove(o.idx); else world.remove(o.mesh); o.pool = null; o.mesh = new THREE.Group(); }
  Object.assign(p, { y: groundAt(p.x, p.z)[0], vy: 0, vx: 0, pitch: 0, yaw: 0, roll: 0, pitchVel: 0, yawVel: 0, rollVel: 0, lean: 0, heading: 0, grounded: true, trick: null, grinding: null });
  bot.trick = null;
}
// where to ride: line up the next kicker, rail or trampoline; otherwise follow the always-clear lane
function botTarget() {
  let best = null, bz = -Infinity;
  const near = z => z < p.z - 1 && z > p.z - 90 && z > bz;
  for (const r of ramps) if (near(r.z0)) { best = r.x; bz = r.z0; }
  for (const r of rails) if (near(r.z0)) { best = r.x; bz = r.z0; }
  for (const q of pads) if (q.kind === 'bounce' && near(q.z + 2)) { best = q.x; bz = q.z + 2; }
  for (const sh of shapes) if (sh.W < 30 && near(sh.z0)) { best = sh.x; bz = sh.z0; }
  let x = best ?? laneX(p.z - 25);
  // swerve around anything solid in the way
  for (const o of obstacles) {
    if (o.dead || o.z > p.z || o.z < p.z - 30) continue;
    const gap = (o.hw || o.r) + 1.4;
    if (Math.abs(o.x - x) < gap) x = o.x + (x >= o.x ? gap : -gap);
  }
  return clamp(x, -X_LIMIT + 1, X_LIMIT - 1);
}
// seconds until the rider touches down, by stepping the flight forward
function airLeft() {
  let y = p.y, vy = p.vy, z = p.z, x = p.x;
  for (let t = 0; t < 6; t += 1 / 60) {
    vy -= G * (vy < 0 ? 1.15 : 1) / 60; y += vy / 60; z -= Math.cos(p.heading) * p.speed / 60; x += p.vx / 60;
    if (vy < 0 && y <= groundAt(x, z)[0]) return t;
  }
  return 6;
}
// pick a trick that fits the air time; each rotation is let go of early so it settles cleanly upright
function planTrick() {
  const T = airLeft() - 0.45;
  const opts = [];
  const flips = Math.floor(T * FLIP_RATE / TAU), rolls = Math.floor(T * ROLL_RATE / TAU), spins = Math.floor(T * SPIN_RATE / Math.PI);
  if (flips >= 1) opts.push({ v: Math.random() < 0.6 ? -1 : 1, h: 0, axis: 'pitch', n: flips * TAU });
  if (rolls >= 1) opts.push({ v: 1, h: Math.random() < 0.5 ? -1 : 1, axis: 'roll', n: rolls * TAU });
  if (spins >= 2) opts.push({ v: 0, h: Math.random() < 0.5 ? -1 : 1, axis: 'yaw', n: Math.min(spins, 10) * Math.PI });
  if (T > 0.35) opts.push({ v: 0, h: 0, axis: null, n: 0 });   // a stylish grab
  return opts.length ? opts[(Math.random() * opts.length) | 0] : { v: 0, h: 0, axis: null, n: 0 };
}
function botInput() {
  const inp = { h: 0, v: 0, grab: false, jump: false };
  if (p.grounded || p.grinding) {
    bot.trick = null;
    inp.h = clamp((botTarget() - p.x) * 0.45, -1, 1);
    // a little pop now and then on the flats
    bot.hopT -= 1 / 60;
    const quiet = !ramps.some(r => r.z0 < p.z + 2 && r.z0 > p.z - 20) && !pads.some(q => Math.abs(q.z - p.z) < 14);
    if (p.grounded && quiet && bot.hopT < 0 && groundAt(p.x, p.z)[0] < 0.05) { inp.jump = true; bot.hopT = rand(2, 5); }
    if (p.grinding && p.grindTime > 0.6 && Math.random() < 0.02) inp.jump = true;
    return inp;
  }
  if (!bot.trick && p.airTime > 0.05) bot.trick = planTrick();
  const t = bot.trick, tr = p.trick;
  if (!t || !tr) return inp;
  const done = !t.axis || Math.abs(tr[t.axis]) >= t.n - 0.55;
  if (!done) { inp.v = t.v; inp.h = t.h; }
  else inp.grab = airLeft() > 0.25;
  return inp;
}
function demoStep(dt) {
  if (-p.z > 1400) { fadeScreen('#ffffff'); startDemo(); return; }
  Sfx.quiet = true;
  const x0 = p.x, y0 = p.y, z0 = p.z;
  updatePlayer(dt);
  collectCoins(x0, y0, z0); SkiTracks.update();
  while (spawnZ > p.z - VIEW) spawnFeature();
  spawnWalls(p.z - VIEW);
  while (decorZ > p.z - VIEW) { spawnDecor(decorZ); decorZ -= 4; }
  cleanup(p.z);
  for (const o of movers) {
    o.x += o.vx * dt;
    if (Math.abs(o.x) > 12.5) { o.x = Math.sign(o.x) * 12.5; o.vx = -o.vx; }
    o.mesh.position.x = o.x;
  }
  Sfx.quiet = false;
}

function togglePause(force) {
  if (state !== 'play') return;
  paused = force === true ? true : !paused;
  show('pause', paused);
  if (paused) { Platform.gameplayStop(); clearTouch(); }
  else { Platform.gameplayStart(); last = performance.now(); }
}
function updateMuteBtn() {
  $('muteBtn').innerHTML = icon(Sfx.muted ? 'soundOff' : 'soundOn');
  $('musicBtn').innerHTML = icon('music'); $('musicBtn').classList.toggle('off', !Music.on);
}

$('resumeBtn').onclick = () => togglePause(false);
$('quitBtn').onclick = () => { Platform.gameplayStop(); toMenu(); };
$('pauseBtn').onclick = () => togglePause(true);
$('camBtn').innerHTML = icon('camera');
$('camBtn').onclick = () => cycleView();
$('muteBtn').onclick = () => { Sfx.init(); Sfx.toggle(); };
$('musicBtn').onclick = () => { Sfx.init(); Music.toggle(); updateMuteBtn(); };
addEventListener('keydown', e => {
  // Enter restarts only from the results card itself (not during the record screen, and not in its first moment)
  if (e.code === 'Enter' && state === 'over' && !e.repeat && !typing(e) && !$('lbReveal') && !$('over').classList.contains('hidden') && !$('over').classList.contains('arming')) restartWithAd();
});

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rawMs = now - last;
  let dt = Math.min(0.033, rawMs / 1000); last = now;
  if (!paused && (state === 'play' || state === 'crash' || (state === 'menu' && demo))) Quality.sample(rawMs);
  if (state === 'crash' && mode !== 'race' && p.crashT < 0.45) dt *= 0.3;   // brief slow-mo on impact (not in the race: it would slow the clock)
  if (paused) return;
  time += dt;
  if (state === 'cabin') { for (const pl of allPools) pl.flush(); updateCabin(dt); return; }
  if (state === 'island') { updateIsland(dt); return; }
  if (state === 'play') {
    const x0 = p.x, y0 = p.y, z0 = p.z;
    updatePlayer(dt);
    if (state === 'play') { collectCoins(x0, y0, z0); SkiTracks.update(); }
    if (mode === 'race') race.t += dt;
  }
  else if (state === 'crash') { updateCrash(dt); if (mode === 'race') race.t += dt; }
  if (mode === 'race' && (state === 'play' || state === 'crash')) {
    race.recT += dt;
    const b = skier.body.rotation;
    while (race.recT >= 0.1) { race.recT -= 0.1; race.rec.push(...[p.x, p.y, p.z, b.x, b.y, b.z].map(v => Math.round(v * 100))); }
    updateGhosts();
  }
  if (state === 'play' || state === 'crash') {
    while (spawnZ > p.z - VIEW) spawnFeature();
    spawnWalls(p.z - VIEW);
    while (decorZ > p.z - VIEW) { spawnDecor(decorZ); decorZ -= 4; }
    cleanup(p.z);
    for (const o of movers) {
      o.x += o.vx * dt;
      if (Math.abs(o.x) > 12.5) { o.x = Math.sign(o.x) * 12.5; o.vx = -o.vx; }
      o.mesh.position.x = o.x;
      if (o.kind === 'ball') o.mesh.rotation.z -= o.vx * dt / 1.15;
    }
    if (state === 'play') {
      missionToast(track('score', totalScore(), 'max'));
      // passing your record mid-run: a banner, fireworks overhead, and a gold score for the rest of the run
      if (mode === 'endless' && !p.bestShown && save.best > 1000 && totalScore() > save.best) {
        p.bestShown = true; showTrick('NEW BEST!', 'Keep going!', true); Sfx.perfect(); $('score').classList.add('record');
        [0, 250, 500].forEach((d, i) => setTimeout(() => {
          const cols = [0xffd23f, 0xff4fa3, 0x4cc3ff, 0x3ddc84];
          Particles.emit(p.x + rand(-4, 4), p.y + 7 + i, p.z - 12, 40, 7, 6, cols[i % 4], -3);
        }, d));
      }
      missionToast(track('dist', Math.floor(-p.z), 'max'));
    }
  }
  if (state === 'menu' && demo) demoStep(dt);
  else if (state === 'menu') {
    // the closet turntable spins slowly unless you're dragging it
    if (closet.on && !(ptr.down || performance.now() - (closet.dragT || 0) < 1500)) closet.yaw += dt * 0.45;
    p.yaw = closet.on ? closet.yaw : 0;
    p.y = closet.on ? 0.08 : 0;   // stand on the turntable, not inside it
  }
  updateCoins();
  updateCosmetics();
  animateAccessories(dt);
  Particles.update(dt);
  Debris.update(dt);
  updatePads(dt);
  updateAnimals(dt);
  updateChase(dt);
  updateSkyWhite();
  if (portal) portal.disc.material.opacity = 0.25 + 0.15 * Math.sin(time * 4);
  if (zone === 'xmas') bulbMats.forEach((m, i) => m.color.setHSL([0, 0.36, 0.13, 0.55][i], 1, Math.sin(time * 5 - i * 1.6) > 0 ? 0.6 : 0.25));
  sleigh.update(time); agarthaSky.update(time); updateYetis();
  if (p.boostT > 0) {
    p.boostT = Math.max(0, p.boostT - dt * 0.9);
    if (state === 'play') Particles.emit(p.x + rand(-0.4, 0.4), p.y + rand(0.2, 1.4), p.z + 0.8, 2, 0.3, 0.2, Math.random() < 0.5 ? 0x22d3ee : 0x9bf6ff, 14);
  }
  Snowfall.update(dt, camera);
  aurora.update(time); if (clouds.group.visible) clouds.update(dt);
  updateSkierVisual(dt);
  updateCamera(dt);
  if (state === 'play' || state === 'crash') updateHUD(dt);
  for (const pl of allPools) pl.flush();
  renderer.render(scene, camera);
  renderRearView();
}

// ---------- boot ----------
setTheme(pickTheme());
resetPlayer();
applyCosmetics();
updateMuteBtn();
initUI({
  sfx: Sfx, isTouch, hints: isTouch ? HINT_TOUCH : HINT_DESKTOP,
  onPlay: m => startRun(m), onAgain: () => restartWithAd(), onMenu: () => toMenu(),
  onCosmetics: () => applyCosmetics(), raceLength: RACE_LEN, ads: Ads,
  closet: on => setCloset(on), preview: tryOn => applyCosmetics(tryOn), thumb: key => Thumbs.get(key),
  music: Music, soundUI: () => updateMuteBtn(),
  levels: levelInfo(), onLevel: n => startLevel(n),
});
toMenu();
requestAnimationFrame(frame);
Platform.init().then(() => { Platform.loadingStop(); Ads.init(Platform.sdk, v => Sfx.adMute(v)); showMenuUI(); });
// cloud save: if newer progress comes back from the server (another device, a new domain), show it
Cloud.init(() => { Sfx.muted = save.muted; Sfx.apply(); updateMuteBtn(); applyCosmetics(); if (state === 'menu') showMenuUI(); });

// debug handle for testing
window.__game = { LOW, p, race, bot, camera, renderer, get quality() { return Quality.ratio; }, LITE, get raceScore() { return totalScore() + race.gates * 500; }, get gates() { return gates; }, get coins() { return coins; }, get state() { return state; }, get ramps() { return ramps; }, get rails() { return rails; }, get obstacles() { return obstacles; }, get crevasses() { return crevasses; }, get shapes() { return shapes; }, laneX: z => laneX(z), startRun, finishRace, applyCosmetics, crash, addBear, addCrevasse, addRock, enterWorld, exitWorld, get pads() { return pads; }, get zone() { return zone; }, get caves() { return caves; }, enterCabin, enterIsland, startLevel, get level() { return level; }, forceFeature(k) { forcedFeature = k; }, get secretCabin() { return secretCabin; }, get chase() { return chase; }, caveSoon(w) { nextCaveD = -p.z + 20; if (w) nextWorld = w; } };
