import * as THREE from './lib/three.module.min.js';

// ============================================================
//  PEAK FLIP — low-poly ski trick runner
// ============================================================

// ---------- tuning ----------
const G = 28;              // gravity (m/s^2)
const SLOPE = 0.2;         // visual tilt of the mountain (rad)
const FLIP_RATE = 8.5;     // rad/s
const SPIN_RATE = 10.5;    // rad/s
const STEER = 13;          // lateral m/s
let X_LIMIT = 13;           // course half-width (narrower in the forest race)
const ROLL_RATE = 8;        // sideflip rad/s
const VIEW = 260;          // how far ahead we spawn
const COMBO_WINDOW = 3.0;  // seconds on the ground before a combo banks
const TAU = Math.PI * 2;

const baseSpeed = d => Math.min(62, 22 + d * 0.0105);   // gets brutal past ~3 km

// ---------- helpers ----------
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;

// ---------- save data / meta-game ----------
import { save, persist, equipped, item, CATALOG, track, resetRun, run as runStats, settleMissions } from './meta.js';
import { initUI, missionToast, showMenuUI, showResults, fetchGhosts } from './ui.js';
import { icon } from './icons.js';
import { Ads } from './ads.js';
import { Cloud } from './cloud.js';

// ---------- CrazyGames SDK wrapper (safe no-op when not on CrazyGames) ----------
const ADS_ENABLED = false;   // TEMP: midgame ads switched off — set to true before publishing
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
  ctx: null, master: null, windGain: null, windFilter: null, noiseBuf: null, muted: save.muted, ad: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master); src.start();
    this.apply();
  },
  apply() { if (this.master) this.master.gain.value = (this.muted || this.ad) ? 0 : 0.55; },
  adMute(v) { this.ad = v; this.apply(); },
  toggle() { this.muted = !this.muted; save.muted = this.muted; persist(); this.apply(); updateMuteBtn(); },
  wind(level, freq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(level, t, 0.12);
    this.windFilter.frequency.setTargetAtTime(freq, t, 0.12);
  },
  tone(f, dur, type = 'sine', vol = 0.25, f2 = null, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol, freq, type = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  },
  coin() { this.tone(988, 0.07, 'square', 0.08); this.tone(1480, 0.12, 'square', 0.08, null, 0.06); },
  land(hard) { this.noise(0.18, hard ? 0.7 : 0.4, 700); },
  ollie() { this.noise(0.1, 0.25, 1800, 'highpass'); },
  trick(n) { [523, 659, 784, 1047].slice(0, 2 + Math.min(2, n)).forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.13, null, i * 0.07)); },
  perfect() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.13, null, i * 0.06)); },
  crash() { this.noise(0.6, 0.9, 450); this.tone(160, 0.4, 'sawtooth', 0.18, 40); },
  grind() { this.tone(1900, 0.06, 'sawtooth', 0.03); },
  near() { this.tone(660, 0.1, 'sine', 0.1, 990); },
};

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
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
world.rotation.x = -SLOPE;
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
  constructor(geo, material, cap) {
    allPools.push(this);
    this.mesh = new THREE.InstancedMesh(geo, material, cap);
    this.mesh.frustumCulled = false;
    this.free = [];
    for (let i = cap - 1; i >= 0; i--) { this.free.push(i); this.mesh.setMatrixAt(i, ZERO); }
    world.add(this.mesh);
    this.dirty = true;
  }
  set(i, x, y, z, s = 1, ry = 0, sy = s) {
    dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(s, sy, s);
    dummy.updateMatrix(); this.mesh.setMatrixAt(i, dummy.matrix); this.dirty = true;
  }
  add(x, y, z, s, ry, sy) { const i = this.free.pop(); if (i === undefined) return -1; this.set(i, x, y, z, s, ry, sy); return i; }
  remove(i) { if (i < 0) return; this.mesh.setMatrixAt(i, ZERO); this.free.push(i); this.dirty = true; }
  flush() { if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; } }
}
const trees = new Pool(treeGeo, vcol, 520);
const rocks = new Pool(rockGeo, vcol, 90);
const coinPool = new Pool(coinGeo, coinMat, 420);
const patches = new Pool(patchGeo, mat.patch, 260);

// ---------- ground ----------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 600).rotateX(-Math.PI / 2), mat.snow);
world.add(ground);

// ---------- sky & horizon (not tilted, follow the camera so they always sit on the horizon) ----------
const mountains = new THREE.Group();
const mountMats = [lam(0xe6eef5, { fog: false }), lam(0xcdd9e5, { fog: false }), lam(0xb7c7d8, { fog: false })];
const capMatSky = lam(0xffffff, { fog: false });
{
  // two rings of peaks: a far pale range and a nearer one with snow caps
  for (const [n, dist, hMin, hMax, rMin, rMax, y0] of [[16, 400, 90, 170, 70, 120, -170], [12, 330, 60, 120, 50, 90, -150]]) {
    for (let i = 0; i < n; i++) {
      const h = rand(hMin, hMax), r = rand(rMin, rMax);
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), mountMats[dist < 350 ? 1 : 0]);   // one shade per range
      const a = (i / n - 0.5) * 2.6 + rand(-0.05, 0.05);
      m.position.set(Math.sin(a) * dist, h / 2 + y0, -Math.cos(a) * dist);
      m.rotation.y = rand(0, 3);
      // the cap is a bit wider than the peak where they meet, so the two surfaces never share depth (that flickered)
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.42, h * 0.38, 6), capMatSky); cap.position.y = h * 0.31 + 0.5; m.add(cap);
      mountains.add(m);
    }
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
  clouds.group.visible = !!t.clouds; clouds.mat.color.set(t.cloud);
  stars.visible = !!t.stars; aurora.group.visible = !!t.aurora;
  headlamp.intensity = t.lamp || 0;
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
  const skiMat = skinMats.ski, bootMat = lam(0x222831), skinMat = lam(0xf1c27d), goggle = lam(0xff9f1c), poleMat = lam(0xbfc7d1);
  // skis (relative to body centre, feet at y=-0.9)
  const skis = new THREE.Group(); body.add(skis);
  for (const sx of [-0.17, 0.17]) {
    add(skis, box(0.16, 0.05, 1.9), skiMat, sx, -0.875, -0.05);
    const tip = add(skis, box(0.16, 0.05, 0.25), skinMats.tip, sx, -0.83, -1.05); tip.rotation.x = 0.5;
  }
  // snowboard: one wide deck with kicked nose & tail; the rider stands sideways on it
  const board = new THREE.Group(); body.add(board); board.visible = false;
  add(board, box(0.4, 0.06, 1.35), skiMat, 0, -0.875, 0);
  for (const sz of [-1, 1]) { const k = add(board, box(0.4, 0.06, 0.3), skinMats.tip, 0, -0.84, sz * 0.78); k.rotation.x = sz * -0.45; }
  const legs = new THREE.Group(); legs.position.y = -0.85; body.add(legs);
  for (const sx of [-0.15, 0.15]) {
    add(legs, box(0.2, 0.16, 0.32), bootMat, sx, 0.08, -0.02);
    add(legs, box(0.17, 0.5, 0.2), skinMats.pants, sx, 0.4, 0);
  }
  const upper = new THREE.Group(); upper.position.y = -0.2; body.add(upper);
  add(upper, box(0.46, 0.2, 0.28), skinMats.pants, 0, 0.0, 0);
  add(upper, box(0.5, 0.55, 0.32), skinMats.jacket, 0, 0.35, 0);
  add(upper, box(0.28, 0.28, 0.28), skinMat, 0, 0.8, 0);
  add(upper, box(0.32, 0.16, 0.32), skinMats.helmet, 0, 0.94, 0.01);
  add(upper, box(0.3, 0.09, 0.06), goggle, 0, 0.82, -0.15);
  const arms = [], poles = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sx * 0.31, 0.56, 0); upper.add(arm);
    add(arm, box(0.13, 0.48, 0.14), skinMats.jacket, 0, -0.22, 0);
    add(arm, box(0.12, 0.1, 0.12), bootMat, 0, -0.49, 0);
    const pole = add(arm, new THREE.CylinderGeometry(0.018, 0.018, 1.15, 4), poleMat, 0, -0.95, 0.12); poles.push(pole);
    pole.rotation.x = -0.25;
    arm.rotation.x = 0.35; arm.rotation.z = sx * 0.18;
    arms.push(arm);
  }
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 14).rotateX(-Math.PI / 2), mat.shadow);
  world.add(shadow);
  world.add(root);
  return { root, body, legs, upper, arms, shadow, skis, board, poles };
})();

// ---------- accessories (hats, face, back) ----------
const slots = {
  hat: new THREE.Group(), face: new THREE.Group(), back: new THREE.Group(),
};
slots.hat.position.set(0, 1.02, 0.01); slots.face.position.set(0, 0.82, -0.15); slots.back.position.set(0, 0.36, 0.17);
for (const k in slots) skier.upper.add(slots[k]);
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
    // ---- face ----
    case 'aviators': for (const sx of [-1, 1]) add(B(0.11, 0.07, 0.02), c, sx * 0.07, 0, -0.01); add(B(0.06, 0.012, 0.02), c2, 0, 0.025, -0.01); break;
    case 'mustache': for (const sx of [-1, 1]) { const m = add(B(0.11, 0.035, 0.03), c, sx * 0.05, -0.08, -0.01); m.rotation.z = sx * 0.3; } break;
    case 'clown': add(S(0.055), c, 0, -0.04, -0.03); break;
    case 'hearts': for (const sx of [-1, 1]) { const h = add(B(0.075, 0.075, 0.02), c, sx * 0.075, 0, -0.01); h.rotation.z = Math.PI / 4; } break;
    case 'beard': add(B(0.27, 0.2, 0.1), c, 0, -0.15, 0.02); add(B(0.2, 0.12, 0.08), c, 0, -0.29, 0.02); break;
    case 'pixel': add(B(0.3, 0.06, 0.02), c, 0, 0, -0.01); for (const sx of [-1, 1]) add(B(0.03, 0.03, 0.022), c2, sx * 0.09 - 0.02, 0.01, -0.012); break;
    case 'mask': add(B(0.3, 0.08, 0.02), c, 0, 0, -0.005); break;
    case 'lasers': { const lg = new THREE.Group(); g.add(lg); accAnim.lasers = lg;
      for (const sx of [-1, 1]) { const l = new THREE.Mesh(B(0.025, 0.025, 6), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 })); l.position.set(sx * 0.07, 0, -3); lg.add(l); add(S(0.025), c2, sx * 0.07, 0, -0.01, glow(0xff0000)); } } break;
    // ---- back ----
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
    case 'thirdeye': { const e = add(new THREE.OctahedronGeometry(0.04, 0), c, 0, 0.13, 0.02, glow(0x1aa6b8)); e.scale.y = 1.4;
      const r = add(new THREE.TorusGeometry(0.05, 0.012, 4, 10), c2, 0, 0.13, 0.025, glow(0x553300)); } break;
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
function applyAccessories() {
  accAnim.prop = accAnim.cape = accAnim.lasers = accAnim.sun = accAnim.crystal = null; accAnim.wings = []; accAnim.jet = false;
  for (const kind of ['hat', 'face', 'back']) {
    const slot = slots[kind]; slot.clear();
    const it = worn(kind);
    if (it && it.id !== 'none') slot.add(buildAccessory(kind, it));
  }
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
  const N = 500, R = 30;
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = rand(-R, R); pos[i * 3 + 1] = rand(-15, 15); pos[i * 3 + 2] = rand(-R, R); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.12, color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
  pts.frustumCulled = false; scene.add(pts);
  return {
    update(dt, cam) {
      pts.position.copy(cam.position);
      for (let i = 0; i < N; i++) {
        pos[i * 3 + 1] -= 3 * dt; pos[i * 3] += Math.sin(time + i) * 0.4 * dt;
        if (pos[i * 3 + 1] < -15) pos[i * 3 + 1] += 30;
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
    splat(x, z) {
      const [gh] = groundAt(x, z);
      for (let i = 0; i < 6; i++) {
        const r = i ? rand(0.12, 0.3) : rand(0.8, 1.1), m = new THREE.Mesh(new THREE.CircleGeometry(r, 9).rotateX(-Math.PI / 2), splatMat);
        m.position.set(x + (i ? rand(-1.6, 1.6) : 0), gh + 0.03, z + (i ? rand(-2.2, 1) : 0)); m.scale.z = rand(0.6, 1.3);
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
  skier.skis.visible = skier.board.visible = slots.hat.visible = legs[2].visible = legs[3].visible = false;
  for (const pl of skier.poles) pl.visible = false;
  // cartoon gore: a red burst from the hip and a splat on the snow
  Particles.emit(p.x, p.y + 0.6, p.z, 30, 3.5, 6, 0xc1121f, -3);
  Particles.emit(p.x, p.y + 0.6, p.z, 14, 2.5, 4, 0x6a040f, -2);
  Debris.splat(p.x, p.z - 1.5);
}
function fixRider() {
  const legs = skier.legs.children;
  legs[2].visible = legs[3].visible = slots.hat.visible = true;
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

function addRamp(x, z0, L, H, W) {
  L = Math.round(L * 2) / 2; H = Math.round(H * 4) / 4;
  const g = new THREE.Group(); g.position.set(x, 0, z0);
  g.add(new THREE.Mesh(rampGeo(L, H, W), mat.ramp));
  const lip = new THREE.Mesh(box(W + 0.05, 0.1, 0.35), mat.rampEdge); lip.position.set(0, H - 0.02, -L + 0.15); g.add(lip);
  for (const sx of [-1, 1]) { const st = new THREE.Mesh(box(0.12, 0.12, L * 0.9), mat.rampEdge); st.position.set(sx * W / 2, H * 0.35, -L * 0.62); st.rotation.x = Math.atan(H / L) * 1.2; g.add(st); }
  world.add(g);
  ramps.push({ x, z0, L, H, W, mesh: g });
}
function addRail(x, z0, L, top = 0.9) {
  const g = new THREE.Group(); g.position.set(x, 0, z0);
  const bar = new THREE.Mesh(box(0.16, 0.14, L), mat.rail); bar.position.set(0, top, -L / 2); g.add(bar);
  for (const pz of [-0.4, -L / 2, -L + 0.4]) { const p = new THREE.Mesh(box(0.1, top, 0.1), mat.railPost); p.position.set(0, top / 2, pz); g.add(p); }
  world.add(g);
  rails.push({ x, z0, L, top, mesh: g });
}
const blocked = (x, z, pad = 1.5) => checkpoints.some(c => Math.abs(z - c.z) < 5 && Math.abs(x - c.x) < c.w / 2 + pad);
// A smooth, always-steerable lane that hazards can't fill, so every section has a way through.
let laneSeed = [0, 0];
const laneX = z => clamp(Math.sin(z * 0.02 + laneSeed[0]) * 7 + Math.sin(z * 0.05 + laneSeed[1]) * 2.5, -X_LIMIT + 2.5, X_LIMIT - 2.5);
const inLane = (x, z, r = 0.6) => Math.abs(x - laneX(z)) < 2.2 + r;
function addTree(x, z, s, obstacle) {
  if (obstacle) { x = clamp(x, -X_LIMIT + 0.5, X_LIMIT - 0.5); if (blocked(x, z) || inLane(x, z, 0.55 * s)) return; }
  const idx = trees.add(x, 0, z, s, rand(0, 6));
  if (obstacle) obstacles.push({ kind: 'tree', x, z, r: 0.55 * s, h: 3.8 * s, idx, pool: trees });
  else decor.push({ z, idx, pool: trees });
}
function addRock(x, z, s) {
  x = clamp(x, -X_LIMIT + 0.5, X_LIMIT - 0.5); if (blocked(x, z) || inLane(x, z, s)) return;
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
function addCrevasse(z0, L) {
  const g = new THREE.Group(); g.position.set(0, 0, z0);
  const hole = new THREE.Mesh(box(31, 0.05, L), crevMat); hole.position.set(0, 0.03, -L / 2); g.add(hole);
  for (const ez of [0, -L]) for (let x = -15; x < 15.5; x += 1.5) {
    const ice = new THREE.Mesh(box(1.4, 0.3, 0.5), iceMat); ice.position.set(x + rand(-0.2, 0.2), 0.1, ez + (ez ? 0.15 : -0.15)); ice.rotation.y = rand(-0.3, 0.3); g.add(ice);
  }
  for (const sx of [-1, 1]) { const f = new THREE.Mesh(box(0.08, 1.6, 0.08), gateMats[1]); f.position.set(sx * 13.5, 0.8, 6); g.add(f); const fl = new THREE.Mesh(box(0.6, 0.35, 0.04), mat.rail); fl.position.set(sx * 13.5 + 0.3 * -sx, 1.45, 6); g.add(fl); }
  world.add(g);
  crevasses.push({ z0, L, mesh: g, passed: false });
}
function addCoin(x, y, z) {
  const idx = coinPool.add(x, y, z);
  if (idx >= 0) coins.push({ x, y, z, idx, taken: false });
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
  const pad = { kind, x, z, r: kind === 'bounce' ? 2 : 1.6, len: kind === 'bounce' ? 2 : 2.5, mesh: g, used: false, squash: 0 };
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
  if (big && crng() < 0.4) addPad('boost', x, z + 12);
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
function featureRocks(z, d) {
  const n = 5 + Math.floor(d * 10);
  for (let i = 0; i < n; i++) addRock(wr(-12, 12), z - wr(0, 32), wr(0.7, 1.3));
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
  addPad('boost', x, z + 14);
  addRamp(x, z, L, H, W);
  const at = airTime(sp + 6, H, L), ls = lipSpeed(sp + 6, H);
  for (let i = 1; i < 10; i++) { const t = at * i / 10; addCoin(x, arcY(sp + 6, H, L, t) + 1.2, z - L - ls * t); }
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
function featureBounce(z) {
  const n = 2 + (crng() < 0.5 ? 1 : 0), x0 = wr(-6, 6);
  for (let i = 0; i < n; i++) { const x = clamp(x0 + wr(-3, 3), -10, 10); addPad('bounce', x, z - i * 19); for (let k = 1; k < 4; k++) addCoin(x, 3 + k * 1.6, z - i * 19 - k * 3.5); }
  return [n * 19 + 30, x0];
}
function featureBoost(z, d) {
  const x = wr(-8, 8);
  addPad('boost', x, z); addPad('boost', x + wr(-2, 2), z - 10);
  for (let i = 0; i < 8; i++) addCoin(x, 1.2, z - 14 - i * 3);
  if (d > 0.2) for (let i = 0; i < 3; i++) addRock(wr(-12, 12), z - wr(20, 40), wr(0.7, 1));
  return [48, x];
}

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
function pickFeature(d) {
  const w = [
    ['ramp', 16], ['big', 10], ['rollers', 9], ['table', 8], ['stepdown', d > 0.05 ? 5 : 0], ['mega', d > 0.1 ? 4 : 0], ['line', 7], ['bounce', 6], ['boost', 5], ['rail', 10], ['railKick', 7], ['rocks', 12 + 10 * d], ['slalom', 10 + 6 * d], ['snake', 6 - 4 * d],
    ['crevasse', d > 0.05 ? 7 + 10 * d : 0], ['logs', d > 0.02 ? 6 + 10 * d : 0], ['balls', d > 0.12 ? 12 * d : 0], ['field', d > 0.2 ? 12 * d : 0],
  ];
  let r = crng() * w.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of w) if ((r -= v) < 0) return k;
  return 'ramp';
}
function spawnFeature() {
  const z = spawnZ, D = -z, d = clamp(D / 1600, 0, 1), sp = baseSpeed(D);
  if (mode === 'race' && D > RACE_LEN - 40) { if (!finish) addFinish(-RACE_LEN); spawnZ -= 400; return; }
  const k = pickFeature(mode === 'race' ? Math.min(1, d * 1.6) : d);
  const f = {
    ramp: () => featureRamp(z, false, sp), big: () => featureRamp(z, true, sp), rail: () => featureRail(z, sp, false), railKick: () => featureRail(z, sp, true),
    rocks: () => featureRocks(z, d), slalom: () => featureSlalom(z, d), snake: () => featureCoinSnake(z), crevasse: () => featureCrevasse(z, d),
    logs: () => featureLogs(z, d), balls: () => featureBalls(z, d), field: () => featureField(z, d),
    rollers: () => featureRollers(z, d), table: () => featureTabletop(z, sp, d), stepdown: () => featureStepDown(z, sp),
    mega: () => featureMega(z, sp), line: () => featureKickerLine(z, sp), bounce: () => featureBounce(z), boost: () => featureBoost(z, d),
  }[k];
  const [len, gx] = f();
  // extra scattered hazards get more common the further you go
  if (!['ramp', 'big', 'railKick', 'crevasse', 'mega', 'line', 'bounce', 'table', 'stepdown', 'rollers'].includes(k) && crng() < 0.2 + d * 0.8) {
    for (let i = 0, n = 1 + Math.floor(d * 5); i < n; i++) addRock(wr(-12, 12), z - wr(5, len - 5), wr(0.6, 1));
  }
  spawnZ -= len;
}
const liftMat = lam(0x5b6573), chairMat = lam(0xe63946), cabinWall = lam(0x8a5a35), cabinRoof = lam(0x3b4a5a);
function addLiftTower(z) {
  const g = new THREE.Group(); g.position.set(-21, 0, z);
  const pole = new THREE.Mesh(box(0.45, 11, 0.45), liftMat); pole.position.y = 5.5; g.add(pole);
  const bar = new THREE.Mesh(box(5, 0.3, 0.3), liftMat); bar.position.y = 11; g.add(bar);
  for (const sx of [-2.2, 2.2]) {
    const cable = new THREE.Mesh(box(0.05, 0.05, 48), liftMat); cable.position.set(sx, 10.8, -24); g.add(cable);
    for (const cz of [-12, -36]) {
      const ch = new THREE.Group(); ch.position.set(sx, 10.8, cz + (sx > 0 ? 6 : 0));
      const hang = new THREE.Mesh(box(0.06, 1.6, 0.06), liftMat); hang.position.y = -0.8; ch.add(hang);
      const seat = new THREE.Mesh(box(1.2, 0.12, 0.5), chairMat); seat.position.y = -1.6; ch.add(seat);
      const back = new THREE.Mesh(box(1.2, 0.5, 0.1), chairMat); back.position.set(0, -1.35, 0.22); ch.add(back);
      g.add(ch);
    }
  }
  world.add(g); decor.push({ z: z - 50, mesh: g });
}
function addCabin(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rand(-0.4, 0.4);
  const w = new THREE.Mesh(box(4, 2.6, 3.4), cabinWall); w.position.y = 1.3; g.add(w);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.8, 4), cabinRoof); roof.position.y = 3.5; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.8); g.add(roof);
  const snow = new THREE.Mesh(new THREE.ConeGeometry(3.1, 0.7, 4), mat.snow); snow.position.y = 4.15; snow.rotation.y = Math.PI / 4; snow.scale.set(1, 1, 0.8); g.add(snow);
  const win = new THREE.Mesh(box(0.9, 0.7, 0.05), lam(0xffd166, { emissive: 0x7a5a00 })); win.position.set(0, 1.5, 1.72); g.add(win);
  world.add(g); decor.push({ z: z - 4, mesh: g });
}
const lanternMat = lam(0xffd27a, { emissive: 0xffb347, emissiveIntensity: 0.15 }), postMat = lam(0x3b4a5a);
const snowmanParts = { body: lam(0xf8fbff), coal: lam(0x222222), carrot: lam(0xff7b00), scarf: lam(0xe63946) };
function addSnowman(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rand(-0.6, 0.6) + Math.PI * 0.1;
  const ball = (r, y) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), snowmanParts.body); m.position.y = y; g.add(m); };
  ball(0.9, 0.75); ball(0.65, 1.95); ball(0.45, 2.85);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 5), snowmanParts.carrot); nose.rotation.x = -Math.PI / 2; nose.position.set(0, 2.85, -0.6); g.add(nose);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(box(0.08, 0.08, 0.05), snowmanParts.coal); e.position.set(sx * 0.15, 3, -0.4); g.add(e); }
  const sc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 5, 10), snowmanParts.scarf); sc.rotation.x = Math.PI / 2; sc.position.y = 2.45; g.add(sc);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.45, 8), snowmanParts.coal); hat.position.y = 3.45; g.add(hat);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 8), snowmanParts.coal); brim.position.y = 3.24; g.add(brim);
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(box(0.06, 0.06, 1.2), cabinWall); arm.position.set(sx * 0.9, 2.1, 0); arm.rotation.set(0, Math.PI / 2, sx * 0.5); g.add(arm); }
  world.add(g); decor.push({ z: z - 2, mesh: g });
}
function addIgloo(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rand(-0.8, 0.8);
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
  if (theme.lamp) { const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc56b, transparent: true, depthWrite: false, opacity: 0.8 })); gl.scale.set(3.2, 3.2, 1); gl.position.y = 2.75; g.add(gl); }
  world.add(g); decor.push({ z, mesh: g });
}
function spawnDecor(z) {
  const forest = mode === 'race';
  for (const side of [-1, 1]) {
    const n = forest ? 3 + (Math.random() < 0.5 ? 1 : 0) : Math.random() < 0.55 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const x = forest ? side * (X_LIMIT + 1.6 + Math.pow(Math.random(), 1.6) * 30) : side * rand(15.5, 48);
      addTree(x, z - rand(0, 4), forest ? rand(1, 2.1) : rand(0.8, 1.7), false);
    }
  }
  if (!forest && Math.round(z) % 48 === 0) addLiftTower(z);
  if (!forest && Math.random() < 0.025) addCabin((Math.random() < 0.5 ? -1 : 1) * rand(19, 34), z);
  if (!forest && Math.random() < 0.02) addSnowman((Math.random() < 0.5 ? -1 : 1) * rand(16.5, 24), z);
  if (!forest && Math.random() < 0.01) addIgloo((Math.random() < 0.5 ? -1 : 1) * rand(22, 36), z);
  if (!forest && theme.lamp && Math.round(z) % 32 === 0) for (const sx of [-1, 1]) addLantern(sx * (X_LIMIT + 1.8), z);
  if (Math.random() < 0.85) decor.push({ z, idx: patches.add(rand(-40, 40), 0.02, z - rand(0, 4), rand(0.8, 3), rand(0, 6), 1), pool: patches });
}

function cleanup(pz) {
  const behind = pz + 30;
  const keep = (arr, zOf, kill) => { let j = 0; for (const o of arr) { if (zOf(o) > behind) kill(o); else arr[j++] = o; } arr.length = j; };
  keep(ramps, r => r.z0 - r.L, r => world.remove(r.mesh));
  keep(rails, r => r.z0 - r.L, r => world.remove(r.mesh));
  keep(obstacles, o => o.z, o => o.pool ? o.pool.remove(o.idx) : world.remove(o.mesh));
  keep(movers, o => o.z, () => {});
  keep(crevasses, c => c.z0 - c.L, c => world.remove(c.mesh));
  keep(gates, g => g.z, g => world.remove(g.mesh));
  keep(pads, q => q.z - 3, q => world.remove(q.mesh));
  keep(coins, c => c.z, c => { if (!c.taken) coinPool.remove(c.idx); });
  keep(decor, o => o.z, o => o.pool ? o.pool.remove(o.idx) : world.remove(o.mesh));
  keep(shapes, q => q.z0 - q.L, q => world.remove(q.mesh));
}
function clearWorld() {
  cleanup(-1e9);
  if (finish) { world.remove(finish.mesh); finish = null; }
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
  });
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
  p.vy = Math.max(17, Math.abs(p.vy) * 0.5 + 15);
  startAir(); p.fromRamp = true;
  Sfx.tone(180, 0.3, 'sine', 0.3, 720); Sfx.tone(90, 0.15, 'square', 0.12, 60); shake = 0.25;
  Particles.emit(p.x, 0.5, p.z, 18, 3, 6, 0xff2d78, 0); Particles.emit(p.x, 0.5, p.z, 10, 2, 5, 0xffc93c, 0);
}
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
  for (const c of ['Space', 'KeyJ', 'ShiftLeft', 'ShiftRight', 'KeyK']) if (keys[c]) latched.add(c);
}
const AIR_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'KeyJ', 'ShiftLeft', 'ShiftRight', 'KeyK'];
const LAND_KEYS = ['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'Space', 'KeyJ', 'ShiftLeft', 'ShiftRight', 'KeyK'];
const JUMP_KEYS = ['Space', 'KeyJ'];
let jumpQueued = false, jumpPower = 0;
const ptr = { down: false, x: 0, y: 0, sx: 0, sy: 0, ax: 0, ay: 0, t0: 0, moved: 0 };
const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const MAX_CHARGE = 0.45;
const popFromCharge = t => 7.5 + 6 * clamp(t / MAX_CHARGE, 0, 1);
const JUMP_POP = 11;
const typing = e => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
addEventListener('keydown', e => {
  if (typing(e)) return;
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true; keyTime[e.code] = performance.now();
  latched.delete(e.code);
  Sfx.init();
  // hold jump to crouch & charge, release to pop
  if (JUMP_KEYS.includes(e.code) && state === 'play') { jumpQueued = true; jumpPower = JUMP_POP; }
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
const reanchor = () => { ptr.ax = ptr.x; ptr.ay = ptr.y; };

function readInput() {
  const held = (...cs) => cs.some(c => keys[c] && !latched.has(c));
  const L = held('ArrowLeft', 'KeyA'), R = held('ArrowRight', 'KeyD');
  const U = held('ArrowUp', 'KeyW'), D = held('ArrowDown', 'KeyS');
  let h = (R ? 1 : 0) - (L ? 1 : 0), v = (U ? 1 : 0) - (D ? 1 : 0);
  let grab = held('Space', 'KeyJ', 'ShiftLeft', 'ShiftRight', 'KeyK');
  if (ptr.down) {
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
const GRABS = ['Mute', 'Safety', 'Japan', 'Tail', 'Indy'], BOARD_GRABS = ['Indy', 'Melon', 'Method', 'Stalefish', 'Nose'];
function startAir() {
  p.fromRamp = p.y > 0.3 || !!p.grinding;   // hops from flat snow can never crash
  p.grounded = false; p.airTime = 0; p.maxH = 0;
  latchAtTakeoff();
  if (p.charging) {          // held jump off a lip → auto-pop with the stored charge
    p.charging = false; p.vy += popFromCharge(p.chargeT) * 0.8; Sfx.ollie();
  }
  p.trick = { pitch: 0, yaw: 0, roll: 0, grab: 0, switch: Math.abs(wrap(p.yaw)) > Math.PI / 2, grabName: (isBoard() ? BOARD_GRABS : GRABS)[(Math.random() * 5) | 0] };
  ptr.ax = ptr.x;   // keep the vertical anchor: a held up/down drag starts a flip right away
}

function award(name, pts, perfect) {
  if (p.comboTimer > 0) p.combo++; else { p.combo = 1; p.comboTotal = 0; }
  p.comboTimer = COMBO_WINDOW;
  const mult = Math.min(1 + 0.5 * (p.combo - 1), 8);
  const total = Math.round(pts * mult);
  p.trickScore += total; p.comboTotal += total;
  showTrick(name, `+${total.toLocaleString()}${mult > 1 ? `  x${mult}` : ''}`, perfect);
  missionToast(track('combo', p.combo, 'max'));
  if (!p.happy && (p.combo >= 6 || total >= 6000)) { p.happy = true; Platform.happytime(); }
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
  const grabbed = t.grab > 0.25;
  let pts = flips * 1000 + rolls * 1100 + (spins / 180) * 300 + (grabbed ? Math.round(t.grab * 10) * 70 : 0);
  if (p.airTime > 1.4) pts += Math.round(p.airTime * 120);
  if (pts === 0) return;
  const parts = [];
  if (t.switch) parts.push('Switch');
  if (spins) parts.push((isBoard() ? (t.yaw < 0 ? 'Frontside ' : 'Backside ') : '') + (rolls ? 'Cork ' : '') + spins);
  if (rolls && !spins) parts.push((['', '', 'Double ', 'Triple ', 'Quad '][rolls] ?? rolls + 'x ') + 'Sideflip');
  if (flips) parts.push((['', '', 'Double ', 'Triple ', 'Quad ', 'Quint '][flips] ?? flips + 'x ') + (t.pitch < 0 ? 'Frontflip' : 'Backflip'));
  if (grabbed) parts.push(t.grabName);
  if (!parts.length) parts.push('Big Air');
  missionToast([...track('flips', flips + rolls), ...track('spin', spins, 'max'), ...(p.fromRamp ? track('oneFlips', flips, 'max') : []), ...track('grab', t.grab, 'max'), ...(perfect && !sketchy ? track('perfect', 1) : [])]);
  if (sketchy) { pts = Math.round(pts * 0.4); parts.unshift('Sketchy'); p.comboTimer = 0; Sfx.trick(0); }
  else if (perfect) { pts = Math.round(pts * 1.5); parts.unshift('Perfect'); p.speed += 4; Sfx.perfect(); }
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
  p.grinding = r; p.grindTime = 0; p.grounded = false; p.vy = 0; p.y = r.top; p.lastRail = r; p.pitch = 0; p.pitchVel = 0; p.yawVel = 0; p.roll = 0; p.rollVel = 0;
  p.yaw = Math.abs(wrap(p.yaw)) > Math.PI / 2 ? Math.PI : 0;
  Sfx.land(false);
}
function leaveRail(pop) {
  const r = p.grinding; p.grinding = null;
  if (p.grindTime > 0.2) { award(r.L > 17 ? 'Long Rail Slide' : 'Rail Slide', 150 + Math.round(p.grindTime * 600), false); missionToast(track('rails', 1)); }
  p.vy = pop; startAir();
  if (pop > 5) Sfx.ollie();
}

function crash(reason) {
  if (p.crashed) return;
  p.crashed = true; p.crashT = 0; p.reason = reason; p.grinding = null;
  p.spinX = rand(-14, 14); p.spinZ = rand(-10, 10);
  if (p.grounded) p.vy = 8;
  p.grounded = false;
  state = 'crash';
  Sfx.crash(); Sfx.tone(90, 0.5, 'sawtooth', 0.22, 30); Sfx.noise(0.3, 0.8, 2400, 'highpass'); shake = 1.2;
  Particles.emit(p.x, p.y + 0.5, p.z, 80, 6, 8, 0xffffff, -4);
  breakRider();
  Platform.gameplayStop();
}

// ---------- per-frame player update ----------
function updatePlayer(dt) {
  const inp = readInput();
  const [gh0, gs0] = groundAt(p.x, p.z);
  p.distScore += p.speed * dt * Math.max(1, p.speed / 25);   // going faster scores faster

  // --- speed: gravity pulls you downhill, drag caps it (cap rises with distance) ---
  if (p.grounded) {
    const brake = inp.v < -0.3;   // you're always tucked; S slows you down
    const vt = baseSpeed(-p.z) * 1.1 * (brake ? 0.55 : 1);
    let acc = 12 * (1 - (p.speed / vt) ** 2);              // downhill pull vs drag
    acc -= 0.35 * G * gs0 / Math.sqrt(1 + gs0 * gs0);      // climbing a kicker costs a bit of speed
    acc -= 7 * Math.abs(Math.sin(p.heading));               // carving scrubs speed
    if (brake) { acc -= 10; if (p.speed > 10 && Math.random() < 0.7) Particles.emit(p.x, 0.05, p.z - 0.6, 2, 2, 2.5, 0xffffff, -2); }
    p.speed = Math.max(8, p.speed + acc * dt);
  } else if (!p.grinding) {
    p.speed = Math.max(8, p.speed - 0.6 * dt);
  }
  // charging a jump
  if (p.charging) p.chargeT = Math.min(MAX_CHARGE, p.chargeT + dt);
  const jumpPop = jumpPower;

  if (p.grinding) {
    const r = p.grinding;
    p.x = damp(p.x, r.x, 20, dt); p.y = r.top; p.vx = 0; p.heading = 0;
    p.z -= p.speed * dt;
    p.grindTime += dt;
    if (Math.random() < 0.6) Particles.emit(p.x, p.y + 0.05, p.z + 0.4, 2, 1.5, 3, 0xffb347, 4);
    if (Math.random() < 0.25) Sfx.grind();
    if (p.z < r.z0 - r.L) leaveRail(4);
    else if (inp.jump) leaveRail(jumpPop + 1);
  } else if (p.grounded) {
    p.groundTime += dt;
    // --- carving: steer sets a heading; velocity follows the skis ---
    const maxHead = 0.62 * clamp(24 / p.speed, 0.55, 1);
    let targetHead = inp.h * maxHead;
    if (Math.abs(p.x) > X_LIMIT - 1.5 && Math.sign(p.x) === Math.sign(targetHead || p.heading)) targetHead = -Math.sign(p.x) * 0.25;
    p.heading = damp(p.heading, targetHead, inp.h ? 7 : 8, dt);
    p.vx = Math.sin(p.heading) * p.speed;
    const prevX = p.x;
    p.x += p.vx * dt;
    p.z -= Math.cos(p.heading) * p.speed * dt;
    if (Math.abs(p.x) > X_LIMIT) { p.x = Math.sign(p.x) * X_LIMIT; p.heading *= 0.5; }
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
    if (p.grounded && inp.jump) { p.vy = Math.max(p.vy, 0) + jumpPop; startAir(); Sfx.ollie(); }
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
    if (p.groundTime > 0.7) p.yaw = damp(p.yaw, Math.round(p.yaw / TAU) * TAU, 3, dt);
    if (Math.abs(p.heading) > 0.3 && Math.random() < 0.6) Particles.emit(p.x - Math.sign(p.heading) * 0.4, p.y + 0.05, p.z + 0.5, 2, 1.2, 2.5, 0xffffff, 3);
    if (p.comboTimer > 0 && !p.grinding) { p.comboTimer -= dt; if (p.comboTimer <= 0) p.combo = 0; }
  } else {
    // airborne — keep the momentum you took off with
    p.airTime += dt;
    p.x += p.vx * dt;
    p.z -= Math.cos(p.heading) * p.speed * dt;
    if (Math.abs(p.x) > X_LIMIT) { p.x = Math.sign(p.x) * X_LIMIT; p.vx = 0; }
    const prevY = p.y;
    p.vy -= G * (p.vy < 0 ? 1.15 : 1) * dt; p.y += p.vy * dt;   // slightly heavier fall = snappier
    p.maxH = Math.max(p.maxH, p.y - gh0);
    p.grabbing = inp.grab && p.airTime > 0.12;
    const mul = p.grabbing ? 0.65 : 1;
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
      if (inp.v) p.pitchVel = damp(p.pitchVel, -inp.v * FLIP_RATE * mul, 10, dt);
      else p.pitchVel = settle(p.pitch, p.pitchVel, TAU, FLIP_RATE, dt);
      if (inp.h) p.yawVel = damp(p.yawVel, -inp.h * SPIN_RATE * mul, 10, dt);
      else p.yawVel = settle(p.yaw, p.yawVel, Math.PI, SPIN_RATE, dt);
    }
    p.pitch += p.pitchVel * dt; p.yaw += p.yawVel * dt; p.roll += p.rollVel * dt;
    if (p.trick) { p.trick.pitch += p.pitchVel * dt; p.trick.yaw += p.yawVel * dt; p.trick.roll += p.rollVel * dt; if (p.grabbing) p.trick.grab += dt; }

    const r = p.vy < 0 ? railAt(p.x, p.z) : null;
    if (r && prevY >= r.top - 0.2 && p.y <= r.top + 0.1) {
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
    if (Math.abs(dz) < o.r + 0.5 && Math.abs(dx) < o.r + 0.32 && p.y < o.h)
      return crash({ tree: 'Hugged a tree', rock: 'Hit a rock', ball: 'Flattened by a snowball' }[o.kind]);
    if (!o.passed && p.z < o.z - o.r) {
      o.passed = true;
      if (Math.abs(dx) < o.r + 1.1 && p.y < o.h + 0.8) { p.trickScore += 50; showTrick('Close call!', '+50', false); Sfx.near(); missionToast(track('near', 1)); }
    }
  }
  for (const c of crevasses) {
    if (!c.passed && p.z < c.z0 - c.L) { c.passed = true; p.trickScore += 300; showTrick('Crevasse cleared!', '+300', false); Sfx.trick(1); missionToast(track('crevasse', 1)); }
  }
  // race checkpoints & finish
  if (mode === 'race') {
    for (const g of gates) {
      if (g.passed || p.z > g.z) continue;
      g.passed = true;
      const t = race.t + race.penalty;
      if (Math.abs(p.x - g.x) < g.w / 2 + 0.3) {
        race.gates++; race.splits[g.n - 1] = t;
        const pb = save.raceSplits?.[race.day]?.[g.n - 1];
        showTrick(`Checkpoint ${g.n}/${checkpoints.length}`, pb != null ? `${t - pb <= 0 ? '−' : '+'}${Math.abs(t - pb).toFixed(2)}s` : fmtTime(t), pb != null && t <= pb);
        Sfx.tone(988, 0.1, 'triangle', 0.14); Sfx.tone(1319, 0.14, 'triangle', 0.14, null, 0.08);
      } else {
        race.penalty += 3; race.splits[g.n - 1] = t + 3;
        showTrick('Missed checkpoint', '+3.0s', false); Sfx.tone(180, 0.25, 'square', 0.1);
      }
    }
    if (p.z < -RACE_LEN) return finishRace();
  }
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
      c.taken = true; coinPool.remove(c.idx);
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
  if (!p.crashed) p.lean = damp(p.lean, p.grounded ? clamp(-p.heading * clamp(p.speed / 25, 0.4, 1.2), -0.62, 0.62) : 0, 8, dt);
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
  skier.arms[1].rotation.x = p.grabbing ? -0.9 : 0.35 + 0.2 * Math.sin(time * 6) * (p.grounded ? 0.3 : 0);
  skier.arms[0].rotation.x = p.grabbing ? 0.9 : 0.35;
  skier.arms[0].rotation.z = p.grabbing ? -0.8 : isBoard() ? -0.75 : -0.18;
  skier.arms[1].rotation.z = p.grabbing ? 0.3 : isBoard() ? 0.75 : 0.18;
  if (isBoard() && !p.grabbing) { skier.arms[0].rotation.x = skier.arms[1].rotation.x = 0.1; }
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
  ground.position.z = Math.round((state === 'menu' ? 0 : p.z) / 10) * 10 - 200;
  ground.position.x = 0;
}

function updateCoins() {
  const ry = time * 3;
  for (const c of coins) if (!c.taken) coinPool.set(c.idx, c.x, c.y + Math.sin(time * 4 + c.z) * 0.12, c.z, 1, ry);
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
  if (!data || !Array.isArray(data.f) || data.f.length < 60 || ghosts.length >= 4) return;
  const color = GHOST_COLORS[ghosts.length % GHOST_COLORS.length];
  const root = skier.root.clone(true);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false });
  root.traverse(o => { if (o.isMesh) o.material = m; });
  root.add(nameTag(name, color));
  world.add(root);
  ghosts.push({ name, t: data.t, f: data.f, n: Math.floor(data.f.length / 6), root, body: root.children[0] });
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
function racePosition() {
  let ahead = 0;
  for (const g of ghosts) { const s = ghostState(g); if (s.done || s.z < p.z) ahead++; }
  return ahead + 1;
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

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
  if (mode === 'race') {
    const t = race.t + race.penalty;
    hud.score.textContent = fmtTime(t);
    hud.race.textContent = `${ghosts.length ? ordinal(racePosition()) + ' of ' + (ghosts.length + 1) + '  ·  ' : ''}${Math.max(0, Math.ceil(RACE_LEN + p.z))} m  ·  CP ${race.gates}/${checkpoints.length}${race.penalty ? `  ·  +${race.penalty}s` : ''}`;
  } else {
    const s = totalScore();
    if (s !== lastScore) { hud.score.textContent = s.toLocaleString(); lastScore = s; }
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
const HINT_DESKTOP = '<kbd>A</kbd> <kbd>D</kbd> steer &nbsp; <kbd>Space</kbd> jump &nbsp; <kbd>S</kbd> slow down<br>In the air: <kbd>W</kbd> <kbd>S</kbd> flip &nbsp; <kbd>A</kbd> <kbd>D</kbd> spin &nbsp; both = sideflip &nbsp; hold <kbd>Space</kbd> grab<br><kbd>C</kbd> camera &nbsp; <kbd>P</kbd> pause &nbsp; <kbd>M</kbd> mute';
const HINT_TOUCH = 'Drag to steer, tap to jump<br>In the air: drag up/down to flip, sideways to spin, diagonally to sideflip, hold still to grab';

// ---------- game flow ----------
let state = 'menu', paused = false, overlayBusy = false, mode = 'endless';
const race = { t: 0, gates: 0, penalty: 0, day: '' };
const today = () => new Date().toISOString().slice(0, 10);
function show(id, on) { $(id).classList.toggle('hidden', !on); }

function startRun(m = mode) {
  mode = m;
  SkiTracks.clear(); Debris.clear(); fixRider();
  if (closet.on) setCloset(false);
  Sfx.init();
  jumpQueued = false; latched.clear();
  clearWorld();
  resetPlayer(); resetRun();
  Object.assign(race, { t: 0, gates: 0, penalty: 0, day: today(), splits: [], rec: [], recT: 0 });
  X_LIMIT = mode === 'race' ? 11 : 13;
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
  setTheme(mode === 'race' ? 'day' : pickTheme());   // the Daily Race keeps its original daytime look
  crng = mode === 'race' ? mulberry32(hashStr('peakflip-' + race.day)) : Math.random;
  laneSeed = [crng() * 6.28, crng() * 6.28];
  spawnZ = -55; decorZ = 30;
  checkpoints.forEach((c, i) => addCheckpointArch(c, i + 1));
  while (decorZ > -VIEW) { spawnDecor(decorZ); decorZ -= 4; }
  state = 'play'; paused = false;
  show('menu', false); show('over', false); show('pause', false); show('panel', false); show('hud', true);
  show('raceInfo', mode === 'race');
  camera.position.set(0, 6, 12);
  camLook.set(0, 0, -10);
  lastScore = lastCoins = -1;
  if (save.runs < 3) { hintT = 9; hud.hint.style.opacity = 1; } else { hintT = 0; hud.hint.style.opacity = 0; }
  hud.hint.innerHTML = isTouch ? HINT_TOUCH : HINT_DESKTOP;
  Platform.gameplayStart();
}

function endCommon() {
  save.runs++;
  save.coins += p.coins;
  const missions = settleMissions();
  persist();
  show('hud', false);
  Sfx.wind(0, 300);
  return missions;
}

function gameOver() {
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
  const time = +(race.t + race.penalty).toFixed(2);
  save.raceBest = save.raceBest || {};
  const prev = save.raceBest[race.day];
  const newBest = !prev || time < prev;
  const ghost = { t: time, f: race.rec };
  if (newBest) {
    save.raceBest[race.day] = time;
    save.ghost = { day: race.day, ...ghost };
    save.raceSplits = { [race.day]: race.splits };
    for (const d of Object.keys(save.raceBest)) if (d < race.day) delete save.raceBest[d];
  }
  const beat = ghosts.filter(g => time < g.t).length;
  const field = ghosts.map(g => ({ name: g.name, t: g.t })).concat([{ name: 'You', t: time, me: true }]).sort((a, b) => a.t - b.t);
  const bonus = 40 + race.gates * 5 + beat * 25;
  save.coins += bonus;
  const missions = endCommon();
  Sfx.perfect();
  showResults({ mode: 'race', time, raw: race.t, penalty: race.penalty, gates: race.gates, gateTotal: checkpoints.length, field, ghost: newBest ? ghost : null, newBest, best: save.raceBest[race.day], day: race.day, coins: p.coins, bonus, missions });
}

async function restartWithAd() {
  if (overlayBusy) return;
  overlayBusy = true;
  await Platform.midgameAd();
  overlayBusy = false;
  startRun(mode);
}

function toMenu() {
  SkiTracks.clear(); Debris.clear(); fixRider();
  state = 'menu'; paused = false; mode = 'endless'; X_LIMIT = 13; checkpoints = []; clearGhosts();
  scene.fog.near = 70; scene.fog.far = 230;
  clearWorld(); resetPlayer();
  decorZ = 30; while (decorZ > -VIEW) { spawnDecor(decorZ); decorZ -= 4; }
  show('over', false); show('pause', false); show('hud', false); show('menu', true);
  showMenuUI();
  Sfx.wind(0, 300);
}

function togglePause(force) {
  if (state !== 'play') return;
  paused = force === true ? true : !paused;
  show('pause', paused);
  if (paused) { Platform.gameplayStop(); Sfx.wind(0, 300); }
  else { Platform.gameplayStart(); last = performance.now(); }
}
function updateMuteBtn() { $('muteBtn').innerHTML = icon(Sfx.muted ? 'soundOff' : 'soundOn'); }

$('resumeBtn').onclick = () => togglePause(false);
$('quitBtn').onclick = () => { Platform.gameplayStop(); toMenu(); };
$('pauseBtn').onclick = () => togglePause(true);
$('camBtn').innerHTML = icon('camera');
$('camBtn').onclick = () => cycleView();
$('muteBtn').onclick = () => { Sfx.init(); Sfx.toggle(); };
addEventListener('keydown', e => {
  if ((e.code === 'Enter') && state === 'over' && !e.repeat && !typing(e)) restartWithAd();
});

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (state === 'crash' && mode !== 'race' && p.crashT < 0.45) dt *= 0.3;   // brief slow-mo on impact (not in the race: it would slow the clock)
  if (paused) return;
  time += dt;
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
    while (decorZ > p.z - VIEW) { spawnDecor(decorZ); decorZ -= 4; }
    cleanup(p.z);
    for (const o of movers) {
      o.x += o.vx * dt;
      if (Math.abs(o.x) > 12.5) { o.x = Math.sign(o.x) * 12.5; o.vx = -o.vx; }
      o.mesh.position.x = o.x; o.mesh.rotation.z -= o.vx * dt / 1.15;
    }
    if (state === 'play') {
      missionToast(track('score', totalScore(), 'max'));
      missionToast(track('dist', Math.floor(-p.z), 'max'));
    }
    Sfx.wind(state === 'play' ? clamp(p.speed / 60, 0, 0.5) * (p.grounded ? 1 : 0.6) : 0, 250 + p.speed * 25);
  }
  if (state === 'menu') {
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
  closet: on => setCloset(on), preview: tryOn => applyCosmetics(tryOn),
});
toMenu();
requestAnimationFrame(frame);
Platform.init().then(() => { Platform.loadingStop(); Ads.init(Platform.sdk, v => Sfx.adMute(v)); showMenuUI(); });
// cloud save: if newer progress comes back from the server (another device, a new domain), show it
Cloud.init(() => { Sfx.muted = save.muted; Sfx.apply(); updateMuteBtn(); applyCosmetics(); if (state === 'menu') showMenuUI(); });

// debug handle for testing
window.__game = { p, race, camera, get gates() { return gates; }, get coins() { return coins; }, get state() { return state; }, get ramps() { return ramps; }, get rails() { return rails; }, get obstacles() { return obstacles; }, get crevasses() { return crevasses; }, get shapes() { return shapes; }, laneX: z => laneX(z), startRun, applyCosmetics, crash, addPad };
