// ============================================================
//  RIDE: the engine behind Peak Surf and Peak Bike
// ============================================================
// Each mode has its own scene, camera, HUD and physics. game.js hands over the renderer and the synth while the mode
// is open and calls update(dt) / render() from its main loop.
// You ride downhill along -z. The track is a lane that winds a little; ramps (waves, dirt kickers, a whale's back)
// rise out of it and throw you in the air: flip, spin, grab, land straight.
// A spot on the slope is (u, z): u is metres across from the middle of the lane.
// A kit (surf.js, bike.js) supplies everything you see: the ground, the ramps' meshes, the things in the way,
// the scenery, the rider and the words on the cards. This file runs the physics, camera, HUD and flow.
import * as THREE from './lib/three.module.min.js';
import { save, persist } from './meta.js';
import { maxHeading, steerRate } from './landscape.js';

// ---------- helpers, shared with the kits ----------
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const TAU = Math.PI * 2;
export const rgb = hex => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
export const wrap = (v, m) => ((v % m) + m) % m;
export const pick = a => a[(Math.random() * a.length) | 0];
export const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
export const unitBox = (w, d) => new THREE.BoxGeometry(w, 1, d).translate(0, 0.5, 0);
export const mix = (o, k, a, b, t) => { o[k] = a[0] + (b[0] - a[0]) * t; o[k + 1] = a[1] + (b[1] - a[1]) * t; o[k + 2] = a[2] + (b[2] - a[2]) * t; };
export const put3 = (arr, k, c, m = 1) => { arr[k] = c[0] * m; arr[k + 1] = c[1] * m; arr[k + 2] = c[2] * m; };
// Halloween runs from October to the week after: the haunted conditions open first
export const spooky = (d = new Date()) => d.getMonth() === 9 || (d.getMonth() === 10 && d.getDate() <= 8);
// a strip of quads, rows along z and columns across, rebuilt every frame
export function grid(nx, ny) {
  const g = new THREE.BufferGeometry(), idx = [];
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < ny - 1; j++) { const a = i * ny + j, b = (i + 1) * ny + j; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nx * ny * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nx * ny * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nx * ny * 3), 3).setUsage(THREE.DynamicDrawUsage));
  return g;
}
// limbs: a unit box stretched from joint a to joint b, and a knee or elbow between two joints
const _Y = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
export function place(m, a, b) { _d.subVectors(b, a); const L = Math.max(0.01, _d.length()); m.position.copy(a); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(_Y, _d.multiplyScalar(1 / L)); }
export function knee(a, b, len, bend, out) {
  const half = a.distanceTo(b) / 2, h = Math.sqrt(Math.max(0, len * len - half * half));
  return out.addVectors(a, b).multiplyScalar(0.5).addScaledVector(bend, h);
}
const fmt = n => Math.round(n).toLocaleString('en-US');
// When the player lets go of a rotation, finish it to the nearest landable angle (the same rule as game.js).
function settle(angle, vel, step, rate, dt) {
  const tgt = Math.round(angle / step) * step, err = tgt - angle;
  if (Math.abs(err) < 1.0) return damp(vel, err * 8, 14, dt);
  const dir = Math.sign(vel) || Math.sign(err);
  return damp(vel, dir * rate * 0.7, 8, dt);
}

const PITCH_OK = 0.6, PITCH_MAX = 1.15, YAW_OK = 0.6, YAW_MAX = 1.25;   // how far off straight (rad) a landing can be: clean, sketchy
const COMBO_WINDOW = 3.2, COMBO_MAX = 10;   // seconds to land the next trick and keep the combo; the highest multiplier

export function createRideMode(host, kit) {
  const { renderer, Sfx, isTouch } = host;
  const T = { SPEED0: 20, SPEED_MAX: 48, SPEED_GAIN: 0.004, SCORE_SPEED: 14, SLOPE: 0.2, LAT: 11, G: 30, JUMP: 10, VY_MAX: 17, FLIP: 7, SPIN: 8.5, ...kit.tune };
  const { SPEED0, SPEED_MAX, SPEED_GAIN, SCORE_SPEED, SLOPE, LAT, G, JUMP, VY_MAX, FLIP, SPIN } = T;
  const YAW_UNIT = kit.yawUnit || Math.PI;   // a board can land backwards after a 180; a bike needs the full 360
  const S = { open: false, state: 'off', mult: 1, bonus: null, t: 0, runT: 0, wipeT: 0, theme: 0, shake: 0, resT: 0, hintI: 0, prompt: '' };
  const laneX = kit.laneX, laneHW = kit.laneHW, base = z => z * SLOPE;

  // ---------- scene ----------
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 70, 320);
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 4000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x336688, 1.3); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2); scene.add(sun); scene.add(sun.target);

  // sky dome, sun or moon, stars and clouds
  const skyGeo = new THREE.SphereGeometry(1800, 32, 18);
  skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10; scene.add(sky);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(55, 40), new THREE.MeshBasicMaterial({ fog: false, depthWrite: false }));
  const sunGlow = new THREE.Mesh(new THREE.CircleGeometry(150, 40), new THREE.MeshBasicMaterial({ fog: false, transparent: true, opacity: 0.16, depthWrite: false }));
  sunDisc.renderOrder = sunGlow.renderOrder = -9; scene.add(sunGlow, sunDisc);
  const starGeo = new THREE.BufferGeometry(), starPos = [];
  for (let i = 0; i < 600; i++) {
    const u = Math.random() * TAU, v = rand(0.06, 1);
    starPos.push(Math.cos(u) * Math.sqrt(1 - v * v) * 1700, v * 1700, Math.sin(u) * Math.sqrt(1 - v * v) * 1700);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
  stars.renderOrder = -9; scene.add(stars);
  const cloudMat = lam(0xffffff, { fog: false });
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(16, 30), 1), cloudMat);
      m.position.set(k * 22 - 55 + rand(-6, 6), rand(-4, 8) + (k > 1 && k < 4 ? 8 : 0), rand(-8, 8)); m.scale.y = 0.55; g.add(m);
    }
    g.userData = { x: i * 200 + rand(-60, 60), y: rand(60, 170), z: rand(0, 900) };
    clouds.push(g); scene.add(g);
  }
  // ---------- particles: spray, dust, sparks ----------
  const PMAX = 1400;
  const pMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), PMAX);
  pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); pMesh.frustumCulled = false; pMesh.count = 0;
  pMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PMAX * 3), 3); pMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  pMesh.renderOrder = 2; scene.add(pMesh);
  const pp = new Float32Array(PMAX * 3), pv = new Float32Array(PMAX * 3), pc = new Float32Array(PMAX * 3), pl = new Float32Array(PMAX), pm = new Float32Array(PMAX), ps = new Float32Array(PMAX), pg = new Float32Array(PMAX);
  let pN = 0;
  let C = {};   // the theme's colours as [r, g, b]
  function emit(x, y, z, vx, vy, vz, size, life, color = C.spray, grav = 9) {
    if (pN >= PMAX) return;
    const i = pN++, k = i * 3, c = typeof color === 'number' ? rgb(color) : color;
    pp[k] = x; pp[k + 1] = y; pp[k + 2] = z; pv[k] = vx; pv[k + 1] = vy; pv[k + 2] = vz;
    pc[k] = c[0]; pc[k + 1] = c[1]; pc[k + 2] = c[2]; pl[i] = pm[i] = life; ps[i] = size; pg[i] = grav;
  }
  function burst(x, y, z, n, speed, up, size, life, color, grav = 9) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * speed;
      emit(x, y, z, Math.cos(a) * r, rand(0.3, 1) * up, Math.sin(a) * r, size * rand(0.6, 1.3), life * rand(0.6, 1.2), color, grav);
    }
  }
  function updateParticles(dt) {
    const M = pMesh.instanceMatrix.array, CC = pMesh.instanceColor.array;
    for (let i = 0; i < pN; i++) {
      pl[i] -= dt;
      if (pl[i] <= 0) {   // swap the last live one into this slot
        const j = --pN, a = i * 3, b = j * 3;
        for (let q = 0; q < 3; q++) { pp[a + q] = pp[b + q]; pv[a + q] = pv[b + q]; pc[a + q] = pc[b + q]; }
        pl[i] = pl[j]; pm[i] = pm[j]; ps[i] = ps[j]; pg[i] = pg[j]; i--; continue;
      }
      const k = i * 3;
      pv[k + 1] -= pg[i] * dt;
      const dr = Math.exp(-1.2 * dt); pv[k] *= dr; pv[k + 2] *= dr;
      pp[k] += pv[k] * dt; pp[k + 1] += pv[k + 1] * dt; pp[k + 2] += pv[k + 2] * dt;
      const sc = ps[i] * Math.sqrt(pl[i] / pm[i]), m = i * 16;
      M[m] = sc; M[m + 1] = 0; M[m + 2] = 0; M[m + 3] = 0; M[m + 4] = 0; M[m + 5] = sc; M[m + 6] = 0; M[m + 7] = 0;
      M[m + 8] = 0; M[m + 9] = 0; M[m + 10] = sc; M[m + 11] = 0; M[m + 12] = pp[k]; M[m + 13] = pp[k + 1]; M[m + 14] = pp[k + 2]; M[m + 15] = 1;
      CC[k] = pc[k]; CC[k + 1] = pc[k + 1]; CC[k + 2] = pc[k + 2];
    }
    pMesh.count = pN; pMesh.instanceMatrix.needsUpdate = true; pMesh.instanceColor.needsUpdate = true;
  }
  const dummy = new THREE.Object3D();
  const COIN_N = 160;
  const coinMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 16).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8a5a00 }), COIN_N);
  coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); coinMesh.frustumCulled = false; coinMesh.renderOrder = 2; scene.add(coinMesh);
  const GOLD = new THREE.Color(0xffcc33);
  const RING_N = 24;
  const ringMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(1.35, 0.13, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffe27a }), RING_N);
  ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); ringMesh.frustumCulled = false; ringMesh.renderOrder = 2; ringMesh.count = 0; scene.add(ringMesh);
  for (let i = 0; i < COIN_N; i++) coinMesh.setColorAt(i, GOLD);

  // ---------- ramps: they rise out of the lane, some roll up the slope at you ----------
  // r: { z (the crest), ua, ub (how far across), h, wv (m/s up the slope), LF, LB (face and back length), p (face curve),
  //      fade (edge softness), kind, age, big, bonus: [name, pts] for launching off it }
  const ramps = [];
  function rampF(r, dz) {
    if (dz >= 0) return dz < r.LF ? (r.round ? 0.5 + 0.5 * Math.cos(Math.PI * dz / r.LF) : Math.pow(1 - dz / r.LF, r.p)) : 0;
    return dz > -r.LB ? 0.5 + 0.5 * Math.cos(Math.PI * dz / r.LB) : 0;
  }
  const rampE = (r, u, hw) => kit.rampE ? kit.rampE(r, u, hw) : smooth(0, r.fade, hw - Math.abs(u)) * smooth(r.ua - r.fade, r.ua, u) * (1 - smooth(r.ub, r.ub + r.fade, u));
  const rampAmp = r => r.h * smooth(0, r.grow, r.age);
  function rampsH(u, z) {
    let y = 0;
    if (ramps.length) {
      const hw = laneHW(z);
      for (const r of ramps) { const dz = z - r.z; if (dz < r.LF && dz > -r.LB) y += rampAmp(r) * rampF(r, dz) * rampE(r, u, hw); }
    }
    return y;
  }
  const surfaceH = (u, z) => kit.baseH(u, z) + rampsH(u, z);
  function updateRamps(dt) {
    for (let i = ramps.length - 1; i >= 0; i--) {
      const r = ramps[i];
      r.z += r.wv * dt; r.age += dt;
      if (r.z - r.LB > camera.position.z + 30) { kit.rampOff?.(r); ramps.splice(i, 1); continue; }
      kit.drawRamp?.(r, S.t, dt);
    }
  }

  // ---------- run state ----------
  const P = {};
  let nextZ = 0;
  const V = () => new THREE.Vector3();
  const pos = V(), nrm = V(), fwd = V(), side = V(), slopeN = new THREE.Vector3(0, 1, -SLOPE).normalize();
  const mat4 = new THREE.Matrix4(), qGround = new THREE.Quaternion(), qSlope = new THREE.Quaternion(), qAir = new THREE.Quaternion();
  const camPos = V(), camLook = V(), camTmp = V(), lookTmp = V();
  const wipeGear = { p: V(), v: V(), r: V() }, wipeBody = { p: V(), v: V(), r: V() };
  // faster the further you go, and faster again the more you score: up to +14 m/s from points alone
  const scoreSpeed = () => SCORE_SPEED * (1 - Math.exp(-(P.score || 0) / 20000));
  const speedAt = d => Math.min(SPEED_MAX, SPEED0 + d * SPEED_GAIN + scoreSpeed());
  function resetPlayer() {
    Object.assign(P, {
      z: 0, z0: 0, u: 0, lat: 0, v: SPEED0, slow: 0, y: 0, vy: -SPEED0 * SLOPE, air: false, yaw: 0, pitch: 0, grab: false, grabT: 0, airT: 0, launchVy: 0,
      wx: 0, wy: 0, wz: 0, landT: 9, score: 0, coins: 0, combo: 0, comboT: 9, bestCombo: 0, bestTrick: null, launches: 0, steer: 0, flip: 0,
      tricks: 0, edge: null, onRamp: null, comboTotal: 0, fakie: false, heading: 0,
    });
  }
  const dist = () => P.z0 - P.z;
  const comboOn = () => P.combo > 0 && P.comboT < COMBO_WINDOW;

  // ---------- things in the way ----------
  const things = [], coins = [];
  function addThing(kind, z, u, extra = {}) {
    const o = { kind, z, u, done: false, ph: rand(0, TAU), ...extra };
    o.g = kit.KIND[kind].make(o, C); o.g.renderOrder = 2; scene.add(o.g); things.push(o); return o;
  }
  function clearStuff() {
    for (const o of things) scene.remove(o.g);
    things.length = 0; coins.length = 0;
    for (const r of ramps) kit.rampOff?.(r);
    ramps.length = 0;
  }
  // a ramp is aimed at the spot (zm) where it will meet you, so there's always room to land after it
  const launchVy = (A, v, r) => Math.min(VY_MAX, 1.6 * A * (v + r.wv) / r.LF - SLOPE * v) + SLOPE * v;   // upward speed off a crest, measured against the slope
  function airTime(A, v, r) { const vy = launchVy(A, v, r); return (vy + Math.sqrt(vy * vy + 2 * G * A)) / G; }
  function addRamp(zm, o) {
    const r = { ua: -99, ub: 99, wv: 0, LF: 7, LB: 10, p: 1.6, fade: 3, grow: 1.5, kind: 'ramp', big: false, ...o, age: 0, warned: false };
    if (!r.wv) r.age = r.grow;   // a fixed ramp is there in full from the start
    const tMeet = Math.max(0.4, (P.z - zm) / Math.max(8, P.v));
    r.z = zm - r.wv * tMeet;
    r.zm = zm;
    ramps.push(r); kit.rampOn?.(r);
    const hw = laneHW(zm);
    if (o.coins !== false && (o.ring || Math.random() < 0.55)) {   // half the ramps carry a line of coins along the flight off their crest
      const cu = clamp(rand(Math.max(-hw + 4, r.ua + 2), Math.min(hw - 4, r.ub - 2)), -hw + 3, hw - 3);
      for (let i = 0; i < 7; i++) if (!o.ring || i !== 3) coins.push({ r, tau: 0.18 + i * 0.13, u: cu });
      if (o.ring) coins.push({ r, tau: 0.57, u: cu, ring: true });   // a ring at the top of the arc
    }
    const v = speedAt(P.z0 - zm);
    return airTime(r.h, v, r) * v + 10;
  }
  function coinLine(z, u, wiggle, n = 7) { const hw = laneHW(z) - 1.5; for (let i = 0; i < n; i++) coins.push({ z: z - i * 3, u: clamp(u + wiggle * Math.sin(i * 0.7), -hw, hw), lift: 0.8 }); }
  // where a coin is right now: on the ground, or riding along the arc you'd fly off its ramp
  function coinPos(c, out) {
    if (!c.r) return out.set(laneX(c.z) + c.u, surfaceH(c.u, c.z) + c.lift, c.z);
    const r = c.r, A = rampAmp(r) * rampE(r, c.u, laneHW(r.z)), v = Math.max(P.v, 12), rel = v + r.wv, vy = launchVy(A, v, r);
    const z = r.z - rel * c.tau, lift = A + vy * c.tau - 0.5 * G * c.tau * c.tau;
    return out.set(laneX(z) + c.u, base(z) + Math.max(0.6, lift + 0.9), z);
  }

  // ---------- input: ← → steer (spin in the air), ↑ ↓ flip, Space jumps (hold it in the air to grab) ----------
  // Touch: left thumb steers and spins, right thumb taps to jump, swipes up or down to flip, holds to grab
  const K = { left: false, right: false, up: false, down: false, jump: false };
  // the mountain's keys: Space or J jumps; Space, J, Shift, K or G held in the air grabs
  const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    Space: 'jump', KeyJ: 'jump', ShiftLeft: 'grab', ShiftRight: 'grab', KeyK: 'grab', KeyG: 'grab' };
  // and its touch layout: a floating stick on the left (across steers and spins, up and down flips), a jump button on the right
  const touch = { stick: null, act: null }, STICK_R = 56;
  function stickInput() {
    const st = touch.stick; if (!st) return [0, 0];
    const dx = (st.x - st.ax) / STICK_R, dy = (st.y - st.ay) / STICK_R, m = Math.hypot(dx, dy);
    if (m < 0.18) return [0, 0];
    const k = Math.min(1, (m - 0.18) / 0.72) / m;
    return [dx * k, -dy * k];
  }
  const steerInput = () => clamp((K.right ? 1 : 0) - (K.left ? 1 : 0) + stickInput()[0], -1, 1);
  const flipInput = () => clamp((K.up ? 1 : 0) - (K.down ? 1 : 0) + stickInput()[1], -1, 1);
  const jumpHeld = () => K.jump || K.grab || !!touch.act;
  function onKey(e, down) {
    if (!S.open || S.state === 'results') return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = KEYMAP[e.code];
    if (k) {
      e.preventDefault(); e.stopPropagation();
      if (down && e.repeat) return;
      K[k] = down;
      if (down && k === 'jump' && S.state === 'ride' && !host.paused()) jump();
      return;
    }
  }
  const kd = e => onKey(e, true), ku = e => onKey(e, false);
  function release() { for (const k in K) K[k] = false; touch.stick = touch.act = null; drawTouch(); }

  // ---------- the HUD: the ski game's own elements, so both modes look and read the same ----------
  // This file only adds the underwater wash for a wipeout and a layer that catches touches.
  const hud = host.hud;
  const root = document.createElement('div');
  root.id = 'ride-' + kit.id; root.className = 'rd off'; root.dataset.s = 'off';
  root.innerHTML = '<div class="rd-under"></div><div class="rd-touch"></div>';
  document.body.insertBefore(root, document.getElementById('hud'));   // under the HUD, so its buttons stay tappable
  if (!document.getElementById('rideCss')) { const st = document.createElement('style'); st.id = 'rideCss'; st.textContent = CSS; document.head.appendChild(st); }
  const el = { under: root.querySelector('.rd-under'), tl: root.querySelector('.rd-touch') };
  el.tl.addEventListener('pointerdown', e => {
    if (S.state !== 'ride' || host.paused()) return;
    e.preventDefault(); Sfx.init();
    try { el.tl.setPointerCapture(e.pointerId); } catch {}
    if (e.clientX < innerWidth * 0.5) { if (!touch.stick) touch.stick = { id: e.pointerId, ax: e.clientX, ay: e.clientY, x: e.clientX, y: e.clientY }; }
    else if (!touch.act) { touch.act = { id: e.pointerId }; jump(); }
    drawTouch();
  });
  el.tl.addEventListener('pointermove', e => {
    const st = touch.stick; if (!st || st.id !== e.pointerId) return;
    st.x = e.clientX; st.y = e.clientY;
    drawTouch();
  });
  const tUp = e => { if (touch.stick?.id === e.pointerId) touch.stick = null; if (touch.act?.id === e.pointerId) touch.act = null; drawTouch(); };
  el.tl.addEventListener('pointerup', tUp); el.tl.addEventListener('pointercancel', tUp);
  el.tl.addEventListener('contextmenu', e => e.preventDefault());
  // the same floating stick and jump button as on the mountain
  function drawTouch() {
    const st = touch.stick;
    hud.stick.classList.toggle('on', !!st);
    if (st) { hud.stick.style.transform = `translate(${st.ax - STICK_R}px, ${st.ay - STICK_R}px)`; hud.knob.style.transform = `translate(${st.x - st.ax}px, ${st.y - st.ay}px)`; }
    else { hud.stick.style.transform = ''; hud.knob.style.transform = ''; }
    hud.jump.classList.toggle('down', !!touch.act);
  }
  // like the mountain: a hidden tab pauses; losing focus only lets go of held keys
  const blurPause = () => release();
  const visPause = () => { if (document.hidden && S.open && S.state === 'ride') host.pause(); release(); };

  function setState(s) { S.state = s; root.dataset.s = s; }
  // trick names, warnings and announcements all pop up under the rider, like on the mountain
  function pop(name, pts, kind = '', note = '') {
    hud.trickName.textContent = name;
    hud.trickPts.textContent = pts ? `+${fmt(pts)}${note ? `  ${note}` : ''}` : note;
    hud.trick.classList.remove('show', 'perfect', 'warn'); void hud.trick.offsetWidth;
    if (kind === 'big') hud.trick.classList.add('perfect');
    if (kind === 'warn') hud.trick.classList.add('warn');
    hud.trick.classList.add('show');
  }
  const banner = (text, sub = '') => pop(text, 0, 'big', sub);
  // tricks and hops chain into a combo, like on the mountain; the whirlpool doubles everything
  function trick(name, pts, kind = '') {
    if (!comboOn()) P.comboTotal = 0;
    P.combo = comboOn() ? Math.min(COMBO_MAX, P.combo + 1) : 1;
    P.comboT = 0; P.bestCombo = Math.max(P.bestCombo, P.combo); P.tricks++;
    const total = Math.round(pts * P.combo * S.mult);
    P.score += total; P.comboTotal += total;
    if (!P.bestTrick || total > P.bestTrick.pts) P.bestTrick = { name, pts: total };
    pop(name, total, kind, P.combo > 1 ? `x${P.combo}` : '');
  }
  // what you're doing in the air, named the way the mountain names it
  function trickName(pitch, yaw, grabT) {
    const kP = Math.round(pitch / TAU), flips = Math.abs(kP), turns = Math.abs(Math.round(yaw / YAW_UNIT));
    const parts = [];
    if (flips) parts.push(['', '', 'Double ', 'Triple ', 'Quad '][flips] + (kP > 0 ? 'Backflip' : 'Frontflip'));
    if (turns) parts.push(`${Math.round(turns * YAW_UNIT * 180 / Math.PI)}`);
    if (grabT > 0.3) parts.push(parts.length ? kit.grab : `${kit.grab}${kit.grabSuffix ?? ' Grab'}`);
    return { name: parts.join(' '), flips, turns };
  }

  // ---------- riding ----------
  function rampUnder() {
    const hw = laneHW(P.z);
    for (const r of ramps) { const dz = P.z - r.z; if (dz < r.LF && dz > -1.5 && rampE(r, P.u, hw) > 0.3) return r; }
    return null;
  }
  function takeoff(bot) {
    P.air = true; P.airT = 0; P.yaw = 0; P.pitch = 0; P.yawV = 0; P.pitchV = 0; P.grabT = 0; P.launchVy = P.vy;
    qAir.copy(rider.root.quaternion);
    const r = P.vy > 5 ? rampUnder() : null;
    if (r) {
      P.launches++; kit.sfxLaunch?.(Sfx, r);
      if (!bot && r.bonus) trick(r.bonus[0], r.bonus[1], 'big');
    }
    burst(P.wx, P.wy, P.wz, r ? 26 : 12, 3, r ? 6 : 3, 0.14, 0.7, C.spray);
    if (bot) P.botFlip = P.vy > 13 ? (Math.random() < 0.5 ? 1 : -1) : 0;
  }
  function jump() {
    if (P.air || S.state !== 'ride') return;
    P.vy = Math.max(P.vy, -P.v * SLOPE) + JUMP;
    Sfx.ollie?.();
    takeoff(false);
  }
  function ride(dt, bot) {
    const d = dist(), top = speedAt(d), hw = laneHW(P.z);
    const x = bot ? botSteer() : steerInput(), fl = bot ? 0 : flipInput();
    P.steer = x; P.flip = fl;
    // carving, the same as skis: steering sets a heading, you travel along it, and in the air you keep the line you took off on
    if (!P.air) {
      P.heading = damp(P.heading, x * maxHeading(P.v, true), steerRate(true, !!x), dt);
      P.lat = Math.sin(P.heading) * P.v;
    }
    P.u += P.lat * dt;
    const [lo, hi] = kit.uLimit ? kit.uLimit(hw) : [-hw - 2.2, hw + 2.2];
    if (P.u < lo || P.u > hi) { P.u = clamp(P.u, lo, hi); P.lat = 0; P.heading *= 0.5; }
    // leaving the lane (sand, grass, deep water) drags you down
    const edge = P.air ? null : kit.edge(P.u, P.z, hw);
    if (edge && edge !== P.edge && !bot) { pop(edge.msg, 0, 'warn'); Sfx.noise(0.3, 0.3, 300); }
    P.edge = edge;
    P.slow = edge ? Math.min(edge.slow, P.slow + dt * 0.9) : Math.max(0, P.slow - dt * 0.5);
    P.v = top * (1 - P.slow) * (1 - 0.12 * Math.abs(Math.sin(P.heading)));   // carving scrubs a little speed
    const z0 = P.z;
    P.z -= (P.air ? P.v : Math.cos(P.heading) * P.v) * dt;
    if (!bot) { P.score += (z0 - P.z) * S.mult; if (!P.air) P.comboT += dt; }   // the combo clock stops while you're in the air, like on skis
    const g = surfaceH(P.u, P.z);
    if (P.air) {
      P.airT += dt; P.vy -= G * dt; P.y += P.vy * dt;
      let sx = x, fx = bot ? (P.botFlip && Math.abs(P.pitch) < TAU - 0.5 ? P.botFlip : 0) : fl;
      // just before touchdown the rider commits to the nearest landing, like on skis
      if (P.vy < 0 && (P.y - g) / -P.vy < 0.2) sx = fx = 0;
      P.grab = !bot && jumpHeld() && P.airT > 0.15;
      if (P.grab) P.grabT += dt;
      // spins and flips build up speed; let go and they carry on round to the nearest landable angle
      const mul = P.grab ? 0.65 : 1;
      P.yawV = sx ? damp(P.yawV, -sx * SPIN * mul, 10, dt) : settle(P.yaw, P.yawV, YAW_UNIT, SPIN, dt);
      P.pitchV = fx ? damp(P.pitchV, fx * FLIP * mul, 10, dt) : settle(P.pitch, P.pitchV, TAU, FLIP, dt);
      P.yaw += P.yawV * dt; P.pitch += P.pitchV * dt;
      if (P.y <= g) { P.y = g; land(bot); }
    } else {
      // stay on the ground unless it drops away faster than you fall: that's a launch off a crest
      const pred = P.y + P.vy * dt - 0.5 * G * dt * dt;
      if (pred > g + 0.04 && P.vy > -P.v * SLOPE + 3) { P.y = pred; P.vy = Math.min(VY_MAX, P.vy - G * dt); takeoff(bot); }
      else { P.vy = (g - P.y) / dt; P.y = g; }
    }
    if (!bot) passThings(z0, P.z);
  }
  function botSteer() { const tgt = laneHW(P.z) * 0.45 * Math.sin(S.t * 0.35); return clamp((tgt - P.u) * 0.4, -1, 1); }

  function land(bot) {
    P.air = false; P.landT = 0;
    P.vy = -P.v * SLOPE;
    burst(P.wx, P.wy + 0.1, P.wz, P.airT > 0.6 ? 26 : 10, 3.5, 3, 0.16, 0.7, C.spray);
    const kP = Math.round(P.pitch / TAU), eP = Math.abs(P.pitch - kP * TAU);
    const kY = Math.round(P.yaw / YAW_UNIT), eY = Math.abs(P.yaw - kY * YAW_UNIT);
    const tn = trickName(P.pitch, P.yaw, P.grabT), air = P.airT;
    P.pitch = 0; P.yaw = 0; P.pitchV = 0; P.yawV = 0;
    if (bot || (air < 0.3 && !tn.turns && !tn.flips)) return;   // a hop 180 counts too
    if (eP > PITCH_MAX) return wipe(Math.abs(eP - Math.PI) < 1 ? 'Landed on your head' : 'Landed nose first', 'Let go of ↑ ↓ before you land so you level out');
    if (eY > YAW_MAX) return wipe('Landed sideways', 'Let go of ← → before you land so you straighten out');
    // an odd number of half turns and you ride on backwards (fakie), the way skis ride switch
    if (YAW_UNIT < 4 && Math.abs(kY) % 2 === 1) P.fakie = !P.fakie;
    if (eP > PITCH_OK || eY > YAW_OK) { P.slow = Math.max(P.slow, 0.35); pop('Sketchy!', 0, 'warn'); Sfx.land?.(true); P.comboT = COMBO_WINDOW; S.shake = 0.15; return; }
    Sfx.land?.(air > 1);
    if (tn.name) {
      const pts = tn.flips * 1000 + tn.turns * (YAW_UNIT > 4 ? 500 : 250) + Math.round(Math.min(P.grabT, 1.5) * 500) + (tn.flips && tn.turns ? 400 : 0) + (tn.flips >= 2 ? 1000 : 0);
      trick(tn.name, pts, tn.flips >= 2 || pts >= 2000 ? 'big' : '');
      Sfx.trick?.(Math.min(3, tn.flips + (tn.turns > 1 ? 1 : 0) + 1));
    } else if (air > 1.1) trick('Big Air', Math.round(air * 150));
  }

  // anything you passed this frame: did you hit it, clear it or skim past it?
  function passThings(z0, z1) {
    for (const o of things) {
      if (o.done || o.z > z0 + 0.3 || o.z <= z1) continue;   // a little slack for things swimming up at you
      o.done = true;
      const Kd = kit.KIND[o.kind];
      const du = Math.abs(P.u - o.u), dl = Kd.span ? Math.max(0, du - Kd.span(o)) : du;
      const w = Kd.w(o);
      if (dl < w) {
        if (P.y - surfaceH(o.u, o.z) > Kd.clear) { if (Kd.hop) { trick(Kd.hop, Kd.pts); Sfx.near?.(); } continue; }
        if (Kd.hit === 'wipe') return wipe(...Kd.why);
        P.slow = Math.max(P.slow, Kd.slow); pop(Kd.msg, 0, 'warn'); S.shake = 0.12;
        Sfx.noise(0.25, 0.4, 500); burst(laneX(o.z) + o.u, surfaceH(o.u, o.z), o.z, 16, 2, 3, 0.14, 0.6, Kd.splash ?? C.spray);
      } else if (Kd.hit === 'wipe' && dl < w + 1.1 && !P.air) { P.score += 75; pop('Close!', 75); Sfx.near?.(); }
    }
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      coinPos(c, pos);
      if (c.ring) {
        if (Math.abs(pos.z - P.z) < 1.4 && Math.abs(c.u - P.u) < 1.5 && Math.abs(pos.y - (P.y + 0.8)) < 1.6) {
          coins.splice(i, 1); trick('Ring', 300, 'big'); Sfx.perfect?.();
          burst(pos.x, pos.y, pos.z, 30, 4, 3, 0.12, 0.7, 0xffe27a, 0);
        }
        continue;
      }
      if (Math.abs(pos.z - P.z) < 1.3 && Math.abs(c.u - P.u) < 1.1 && Math.abs(pos.y - (P.y + 0.7)) < 1.3) {
        coins.splice(i, 1); P.coins++; P.score += 25; Sfx.coin?.();
        burst(pos.x, pos.y, pos.z, 8, 2, 2, 0.1, 0.5, 0xffd23f, 0);
      }
    }
  }

  function wipe(reason, sub) {
    if (S.state !== 'ride') return;
    setState('wipe'); S.wipeT = 0; S.reason = reason; S.reasonSub = sub;
    hud.race.classList.add('hidden'); hud.combo.classList.add('hidden'); hudRace = ''; setPrompt('');
    P.air = false; release();
    host.platform?.gameplayStop();
    Sfx.crash?.(); Sfx.noise(1.2, 0.5, 500);
    S.shake = 0.35;
    rider.root.getWorldPosition(wipeBody.p);
    wipeBody.v.set(rand(-2, 2), 5, -P.v * 0.45); wipeBody.r.set(rand(-6, 6), rand(-4, 4), rand(-9, 9));
    scene.attach(rider.gear);
    wipeGear.p.copy(rider.gear.position); wipeGear.v.set(rand(-3, 3), 9, -P.v * 0.6); wipeGear.r.set(rand(-9, 9), rand(-6, 6), rand(-12, 12));
    burst(wipeBody.p.x, wipeBody.p.y, wipeBody.p.z, 90, 6, 8, 0.24, 1.2, C.spray);
    finishRun();
  }
  function finishRun() {
    const dd = Math.max(0, dist()), score = Math.round(P.score);
    const sv = save[kit.saveKey] = Object.assign({ best: 0, runs: 0, far: 0 }, save[kit.saveKey]);
    S.result = { mode: kit.id, score, dist: Math.round(dd), coins: P.coins, bonus: Math.floor(dd / 100), reason: S.reason,
      newBest: score > sv.best && score > 0, prevBest: sv.best, trick: P.bestTrick, launches: P.launches, combo: P.bestCombo };
    sv.best = Math.max(sv.best, score); sv.runs++; sv.far = Math.max(sv.far, Math.round(dd));
    save.coins += P.coins + S.result.bonus;
    persist();
  }
  function wipeStep(dt) {
    S.wipeT += dt;
    const b = wipeBody, bd = wipeGear;
    for (const o of [b, bd]) {
      o.v.y -= 20 * dt; o.p.addScaledVector(o.v, dt);
      const fl = surfaceH(o.p.x - laneX(o.p.z), o.p.z) - (kit.sink ?? 0.3);
      if (o.p.y < fl) { o.p.y = fl; o.v.multiplyScalar(0.6); o.v.y = Math.abs(o.v.y) * 0.25; if (o === b && S.wipeT < 1) burst(o.p.x, o.p.y + 0.3, o.p.z, 8, 3, 4, 0.18, 0.7, C.spray); }
    }
    rider.root.position.copy(b.p); rider.root.rotation.x += b.r.x * dt; rider.root.rotation.y += b.r.y * dt; rider.root.rotation.z += b.r.z * dt;
    rider.gear.position.copy(bd.p); rider.gear.rotation.x += bd.r.x * dt; rider.gear.rotation.y += bd.r.y * dt; rider.gear.rotation.z += bd.r.z * dt;
    pose.mode = 'wipe'; pose.crouch = 0.2; pose.lean = 0.5; pose.bend = 0.6;
    kit.pose(rider, pose, S.t, dt, P);
    el.under.style.opacity = kit.under ? smooth(0.4, 0.9, S.wipeT) * (1 - smooth(1.6, 2.1, S.wipeT)) * 0.9 : 0;
    if (kit.under && S.wipeT > 0.5 && Math.random() < dt * 40) emit(b.p.x + rand(-1, 1), b.p.y, b.p.z + rand(0, 1), 0, rand(1, 3), 0, rand(0.05, 0.12), 0.8, C.spray, -2);
    if (S.wipeT > 1.6) { setState('results'); S.resT = 0; rider.root.visible = false; el.under.style.opacity = 0; host.onResult(S.result); }
  }

  function updateThings(dt) {
    const api = E;
    for (let i = things.length - 1; i >= 0; i--) {
      const o = things[i], Kd = kit.KIND[o.kind];
      Kd.move?.(o, dt, api);
      if (o.z > camera.position.z + 10) { scene.remove(o.g); things.splice(i, 1); continue; }
      const y = surfaceH(o.u, o.z), sl = surfaceH(o.u, o.z + 0.6) - surfaceH(o.u, o.z - 0.6);
      o.g.position.set(laneX(o.z) + o.u, y + (Kd.bob ? Kd.bob(o, S.t) : 0), o.z);
      o.g.rotation.set(-Math.atan(sl / 1.2), 0, 0);
      Kd.anim?.(o, S.t, dt, api);
    }
    let n = 0, nr = 0;
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      if (c.r ? !ramps.includes(c.r) : c.z > camera.position.z + 10) { coins.splice(i, 1); continue; }
      if (c.ring) {
        if (nr >= RING_N) continue;
        coinPos(c, dummy.position); dummy.position.y += 0.1;
        dummy.rotation.set(0, 0, S.t * 1.5); dummy.scale.setScalar(1 + 0.06 * Math.sin(S.t * 6)); dummy.updateMatrix();
        ringMesh.setMatrixAt(nr++, dummy.matrix);
        continue;
      }
      if (n >= COIN_N) continue;
      coinPos(c, dummy.position);
      dummy.rotation.set(0, S.t * 3 + c.u + (c.z || c.tau * 9), 0);
      dummy.scale.setScalar(1.1); dummy.updateMatrix();
      coinMesh.setMatrixAt(n, dummy.matrix); coinMesh.setColorAt(n, GOLD); n++;
    }
    ringMesh.count = nr; ringMesh.instanceMatrix.needsUpdate = true;
    coinMesh.count = n; coinMesh.instanceMatrix.needsUpdate = true; if (coinMesh.instanceColor) coinMesh.instanceColor.needsUpdate = true;
  }

  // ---------- the rider ----------
  const pose = { crouch: 0.35, lean: 0, bend: 0, mode: 'ride', arm: 0, steer: 0 };
  let rider = kit.makeRider(); rider.root.renderOrder = 2; scene.add(rider.root);
  const _v = V();
  function placeRider(dt) {
    pos.set(laneX(P.z) + P.u, P.y + 0.03, P.z);
    if (P.air) {
      // keep the take-off tilt for a moment, then settle to the slope; flips and spins go on top
      qSlope.setFromRotationMatrix(mat4.makeBasis(fwd.set(0, -SLOPE, -1).normalize(), slopeN, side.crossVectors(fwd, slopeN)));
      _q.copy(qAir).slerp(qSlope, smooth(0, 0.5, P.airT));
      _q2.setFromAxisAngle(_Y, P.yaw); _q.multiply(_q2);
      _q2.setFromAxisAngle(_Z, P.pitch); _q.multiply(_q2);
      rider.root.quaternion.copy(_q);
      // turn around the middle of the body, not the feet
      _v.set(0, 0.8, 0).applyQuaternion(_q);
      pos.y += 0.8; pos.sub(_v);
    } else {
      const hx = surfaceH(P.u + 0.3, P.z) - surfaceH(P.u - 0.3, P.z), hz = surfaceH(P.u, P.z + 0.3) - surfaceH(P.u, P.z - 0.3);
      nrm.set(-hx / 0.6, 1, -hz / 0.6).normalize();
      fwd.set(Math.sin(P.heading), 0, -Math.cos(P.heading)); fwd.addScaledVector(nrm, -fwd.dot(nrm)).normalize();
      side.crossVectors(fwd, nrm);
      qGround.setFromRotationMatrix(mat4.makeBasis(fwd, nrm, side));
      if (P.fakie) qGround.multiply(_q2.setFromAxisAngle(_Y, Math.PI));
      rider.root.quaternion.slerp(qGround, 1 - Math.exp(-18 * dt));
    }
    rider.root.position.copy(pos);
    P.wx = laneX(P.z) + P.u; P.wy = P.y; P.wz = P.z;
    // lean into the turns, tuck through flips, crouch for the landing
    pose.lean = damp(pose.lean, P.air ? 0 : P.lat * 0.035, 8, dt);
    pose.steer = damp(pose.steer, P.air ? 0 : P.steer, 8, dt);
    const flipping = P.air && Math.abs(P.pitch) > 0.4;
    pose.crouch = damp(pose.crouch, P.air ? (P.grab || flipping ? 1 : 0.6) : 0.45 + (P.landT < 0.25 ? 0.35 : 0), 10, dt);
    pose.mode = P.air ? (P.grab ? 'grab' : flipping ? 'tuck' : 'ride') : 'ride';
    pose.bend = P.grab ? 0.2 : 0; pose.arm = damp(pose.arm, P.air ? 1 : clamp(P.lat * 0.08, -0.5, 1), 6, dt);
    kit.pose(rider, pose, S.t, dt, P);
    P.landT += dt;
    if (!P.air && S.state !== 'wipe') {
      const rate = (P.v * 0.5 + Math.abs(P.lat) * 3) * dt, col = P.edge?.trail ?? C.trail;
      for (let i = 0; i < rate; i++) emit(P.wx + rand(-0.3, 0.3), P.wy + 0.05, P.wz + 0.9, -P.lat * 0.2 + rand(-1, 1), rand(1, 3), rand(1, 4), rand(0.04, 0.12), rand(0.3, 0.6), col, 10);
    }
  }

  // ---------- camera: behind and above you, looking down the slope ----------
  let fov = 62;
  function updateCamera(dt, snap = false) {
    const portrait = innerHeight > innerWidth * 1.05, st = S.state;
    let tx = P.wx, ty = P.wy, tz = P.wz;
    if (st === 'wipe') { tx = wipeBody.p.x; ty = wipeBody.p.y; tz = wipeBody.p.z; }
    if (st === 'results') { tz = P.z; tx = laneX(tz); ty = base(tz); }
    const back = (portrait ? 10 : 8) + P.v * 0.06, up = portrait ? 4.2 : 3.1, ahead = 18;
    const lift = Math.max(0, ty - base(tz));
    camTmp.set(lerp(laneX(tz + back), tx, 0.75), base(tz + back) + up + lift * 0.72, tz + back);
    lookTmp.set(lerp(laneX(tz - ahead), tx, 0.6), base(tz - ahead) + 2.2 + lift * 0.8, tz - ahead);
    if (st === 'results') { camTmp.set(tx + Math.sin(S.t * 0.3) * 3, base(tz + 9) + 5, tz + 9); lookTmp.set(tx, base(tz - 20), tz - 20); }
    if (st === 'intro' && !portrait) lookTmp.x -= 4;   // the card sits on the left
    if (snap) { camPos.copy(camTmp); camLook.copy(lookTmp); }
    else {
      camPos.x = damp(camPos.x, camTmp.x, 5, dt); camPos.y = damp(camPos.y, camTmp.y, 4, dt); camPos.z = camTmp.z;
      camLook.x = damp(camLook.x, lookTmp.x, 4, dt); camLook.y = damp(camLook.y, lookTmp.y, 4, dt); camLook.z = lookTmp.z;
    }
    camera.position.copy(camPos);
    // a short, smooth shudder on a hard hit (no random jitter every frame)
    if (S.shake > 0) { S.shake = Math.max(0, S.shake - dt); const a = S.shake * 0.5; camera.position.x += Math.sin(S.t * 41) * a; camera.position.y += Math.sin(S.t * 53 + 1) * a * 0.7; }
    camera.up.set(0, 1, 0);
    camera.lookAt(camLook);
    fov = damp(fov, (portrait ? 76 : 62) + (st === 'ride' ? Math.min(10, (P.v - SPEED0) * 0.5) : 0), 2, dt);
    if (Math.abs(camera.fov - fov) > 0.01 || camera.aspect !== innerWidth / innerHeight) { camera.fov = fov; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  }

  function updateSky(dt) {
    sky.position.copy(camera.position); stars.position.copy(camera.position);
    const Th = kit.themes[S.theme], sd = camTmp.set(...(Th.skySun || Th.sun)).normalize();
    sunDisc.position.copy(camera.position).addScaledVector(sd, 1500); sunGlow.position.copy(camera.position).addScaledVector(sd, 1520);
    sunDisc.lookAt(camera.position); sunGlow.lookAt(camera.position);
    sun.position.copy(rider.root.position).addScaledVector(lookTmp.set(...Th.sun).normalize(), 100); sun.target.position.copy(rider.root.position);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    // clouds hang out past the bottom of the slope and drift slowly by
    for (const c of clouds) { const u = c.userData; c.position.set(cx + wrap(u.x + S.t * 2, 1800) - 900, cy + u.y - 80, cz - 700 - u.z * 0.5); }
  }

  // ---------- conditions ----------
  function setTheme(i) {
    S.theme = i; const Th = kit.themes[i];
    C = { spray: rgb(Th.spray), trail: rgb(Th.trail ?? Th.spray) };
    scene.fog.color.setHex(Th.fog); scene.fog.near = Th.fogNear ?? 70; scene.fog.far = Th.fogFar ?? 320; scene.background = new THREE.Color(Th.fog);
    hemi.color.setHex(Th.hemi[0]); hemi.groundColor.setHex(Th.hemi[1]); hemi.intensity = Th.hemi[2];
    sun.color.setHex(Th.sunCol); sun.intensity = Th.light;
    sunDisc.material.color.setHex(Th.moon ?? (Th.night ? 0xf2f4ff : Th.sunCol)); sunGlow.material.color.setHex(Th.moon ?? Th.sunCol);
    sunDisc.scale.setScalar(Th.discScale ?? (Th.night ? 0.7 : 1));
    stars.visible = !!Th.night;
    cloudMat.color.setHex(Th.cloud); cloudMat.emissive.setHex(Th.cloud).multiplyScalar(0.5);
    for (const c of clouds) c.visible = !Th.noClouds;
    const sc = skyGeo.attributes.color.array, sp = skyGeo.attributes.position.array, [top, mid, hor] = Th.sky.map(rgb), fg = rgb(Th.fog), tmp = [0, 0, 0];
    for (let k = 0; k < sp.length; k += 3) {
      const y = sp[k + 1] / 1800;
      if (y < 0) { sc[k] = fg[0]; sc[k + 1] = fg[1]; sc[k + 2] = fg[2]; continue; }
      mix(tmp, 0, hor, mid, smooth(0, 0.22, y)); mix(sc, k, tmp, top, smooth(0.15, 0.85, y));
    }
    skyGeo.attributes.color.needsUpdate = true;
    kit.applyTheme(Th, E);
  }

  // ---------- flow: choose it and you're riding, like Endless ----------
  function open() {
    if (S.open) return;
    S.open = true;
    root.classList.remove('off');
    addEventListener('keydown', kd, true); addEventListener('keyup', ku, true);
    addEventListener('blur', blurPause); document.addEventListener('visibilitychange', visPause);
    Ambience.start();
    begin();
  }
  function close() {
    if (!S.open) return;
    S.open = false;
    root.classList.add('off'); setState('off');
    removeEventListener('keydown', kd, true); removeEventListener('keyup', ku, true);
    removeEventListener('blur', blurPause); document.removeEventListener('visibilitychange', visPause);
    release(); clearStuff(); endBonus(true);
    hud.trick.classList.remove('warn');
    Ambience.stop();
    if (host.platform?.playing) host.platform.gameplayStop();
  }
  function resetRider() {
    if (rider.gear.parent !== rider.root) rider.root.add(rider.gear);
    rider.gear.position.set(0, 0, 0); rider.gear.rotation.set(0, 0, 0);
    rider.root.rotation.set(0, 0, 0); rider.root.visible = true;
  }
  function freshRun() {
    clearStuff(); resetRider(); resetPlayer(); pN = 0;
    nextZ = -20; kit.reset(false, E);
    P.y = surfaceH(0, 0);
    while (nextZ > P.z - 170) nextZ -= kit.spawn(nextZ, P.z0 - nextZ, false, E);
    placeRider(0); updateCamera(0, true); kit.updateScenery?.(camera.position.z, true, 0, E); refresh();
  }
  // a new run: a fresh outfit from the Locker and a new sky, the way each mountain stage changes the light
  function begin() {
    Sfx.init(); document.activeElement?.blur?.();
    release(); endBonus(true);
    scene.remove(rider.root); rider = kit.makeRider(); rider.root.renderOrder = 2; scene.add(rider.root);
    setTheme(kit.pickTheme());
    S.t = 0; S.runT = 0; S.hintI = 0; S.speedStep = Math.floor(SPEED0 * 3.6 / 10); S.learning = (save[kit.saveKey]?.runs || 0) < 3;
    hudScore = hudCoins = hudCombo = hudSpeed = -1; shownScore = 0; setPrompt('');
    el.under.style.opacity = 0;
    setState('ride');
    freshRun();
    banner(...kit.copy.drop);
    Sfx.noise(0.6, 0.35, 900); Sfx.tone(392, 0.25, 'triangle', 0.1, 587);
    host.platform?.gameplayStart();
  }

  // ---------- bonus zones: a whirlpool pulls you under and out into a lagoon worth double points ----------
  function suckIn(cu, cz) {
    if (S.state !== 'ride') return;
    setState('sucked'); S.suckT = 0; S.suck = { u: cu, z: cz, y: P.y };
    P.air = false; release();
    Sfx.noise(1.4, 0.45, 300); Sfx.tone(520, 1.1, 'sine', 0.12, 90);
  }
  function suckStep(dt) {
    S.suckT += dt;
    const k = smooth(0, 1.1, S.suckT), s = S.suck;
    P.u = lerp(P.u, s.u, 1 - Math.exp(-5 * dt)); P.z = lerp(P.z, s.z, 1 - Math.exp(-5 * dt));
    P.y = surfaceH(P.u, P.z) - k * 2.4;
    rider.root.position.set(laneX(P.z) + P.u, P.y, P.z);
    rider.root.rotation.y += dt * (6 + 14 * k);
    P.wx = rider.root.position.x; P.wy = P.y; P.wz = P.z;
    if (Math.random() < 0.6) emit(P.wx + rand(-1, 1), surfaceH(P.u, P.z) + 0.1, P.wz + rand(-1, 1), rand(-2, 2), rand(1, 4), rand(-2, 2), rand(0.08, 0.16), 0.6, C.spray, 8);
    el.under.style.opacity = smooth(0.5, 1.1, S.suckT);
    if (S.suckT > 1.2) startBonus();
  }
  function startBonus() {
    const z = kit.bonus;
    S.bonus = { end: dist() + z.len, prev: S.theme }; S.mult = 2;
    setTheme(z.theme);
    clearStuff(); resetRider();
    P.u = 0; P.lat = 0; P.heading = 0; P.slow = 0; P.y = surfaceH(0, P.z); P.vy = -P.v * SLOPE; P.air = false;
    nextZ = P.z - 25; kit.reset(false, E);
    while (nextZ > P.z - 170) nextZ -= kit.spawn(nextZ, P.z0 - nextZ, false, E);
    placeRider(0); updateCamera(0, true); kit.updateScenery?.(camera.position.z, true, 0, E);
    setState('ride');
    host.fade(z.fade); el.under.style.opacity = 0;
    host.zone(kit.id + 'Bonus');
    banner(z.name, 'Double points!'); Sfx.perfect?.();
  }
  function endBonus(quiet) {
    if (!S.bonus) { S.mult = 1; hud.race.classList.add('hidden'); return; }
    const prev = S.bonus.prev; S.bonus = null; S.mult = 1;
    hud.race.classList.add('hidden');
    if (quiet) return;
    setTheme(prev);
    clearStuff();
    nextZ = P.z - 30; kit.reset(false, E);
    kit.updateScenery?.(camera.position.z, true, 0, E);
    host.fade('#fff'); host.zone(null);
    banner(kit.bonus.back, ''); Sfx.perfect?.();
  }

  // the background sound: filtered noise (the surf's wash, wind through the trees) that swells with your speed
  const Ambience = {
    src: null, g: null, f: null,
    start() {
      if (this.src || !Sfx.ctx || !Sfx.noiseBuf) return;
      const c = Sfx.ctx, a = kit.ambience || {};
      this.src = c.createBufferSource(); this.src.buffer = Sfx.noiseBuf; this.src.loop = true;
      this.f = c.createBiquadFilter(); this.f.type = a.type || 'lowpass'; this.f.frequency.value = 400; this.f.Q.value = a.q ?? 1;
      this.g = c.createGain(); this.g.gain.value = 0;
      this.src.connect(this.f).connect(this.g).connect(Sfx.fx || Sfx.master);
      this.src.start();
    },
    set(k) {
      if (!this.g) return this.start();
      const a = kit.ambience || {}, [l0, l1] = a.level || [0.07, 0.19], [f0, f1] = a.freq || [350, 1150];
      const t = Sfx.ctx.currentTime; this.g.gain.setTargetAtTime(lerp(l0, l1, k), t, 0.2); this.f.frequency.setTargetAtTime(lerp(f0, f1, k), t, 0.25);
    },
    stop() { if (!this.src) return; try { this.src.stop(); } catch {} this.src.disconnect(); this.src = this.g = this.f = null; },
  };

  // ---------- per frame ----------
  const HINTS = isTouch ? kit.copy.hintsTouch : kit.copy.hintsKeys;
  let hudScore = -1, hudCoins = -1, hudCombo = -1, hudSpeed = -1, shownScore = 0, hudRace = '';
  function setPrompt(text) {
    if (S.prompt === text) return; S.prompt = text;
    if (text) hud.hint.innerHTML = text;
    hud.hint.style.opacity = text ? 1 : 0;
  }
  function updateHud(dt) {
    if (S.state === 'results') return;
    shownScore = Math.abs(P.score - shownScore) < 1 ? P.score : damp(shownScore, P.score, 12, dt);
    const sc = Math.round(shownScore);
    if (sc !== hudScore) { hudScore = sc; hud.score.textContent = sc.toLocaleString(); }
    if (P.coins !== hudCoins) { hudCoins = P.coins; hud.coins.textContent = P.coins; }
    const kmh = Math.round(P.v * 3.6); if (kmh !== hudSpeed) { hudSpeed = kmh; hud.speed.textContent = `${kmh} km/h`; }
    const on = comboOn() && P.combo > 1 && S.state === 'ride';
    hud.combo.classList.toggle('hidden', !on);
    hud.combo.classList.toggle('max', on && P.combo >= COMBO_MAX);
    if (on) {
      if (P.combo * 1e9 + P.comboTotal !== hudCombo) { hudCombo = P.combo * 1e9 + P.comboTotal; hud.comboText.textContent = `${P.combo >= COMBO_MAX ? 'MAX ' : ''}COMBO x${P.combo}  ·  ${P.comboTotal.toLocaleString()}`; }
      hud.comboFill.style.width = `${(1 - P.comboT / COMBO_WINDOW) * 100}%`;
    }
    // in a bonus zone: how far to the way out, like the special worlds on the mountain
    const race = S.bonus ? `${kit.bonus.name.toUpperCase()}  ·  x2 points  ·  ${Math.max(0, Math.ceil(S.bonus.end - dist()))} m to the exit` : '';
    if (race !== hudRace) { hudRace = race; hud.race.textContent = race; hud.race.classList.toggle('hidden', !race); }
    // the first rides talk you through it
    if (S.learning && S.state === 'ride') {
      if (S.hintI < HINTS.length && S.runT > HINTS[S.hintI][0]) { setPrompt(HINTS[S.hintI][1]); S.hintI++; S.hintOff = S.runT + 4.5; }
      if (S.hintOff && S.runT > S.hintOff) { setPrompt(''); S.hintOff = 0; }
    } else setPrompt('');
  }

  function update(dt) {
    if (!S.open) return;
    dt = Math.min(dt, 1 / 20);
    if (S.state === 'wipe' && S.wipeT < 0.5) dt *= 0.35;
    S.t += dt;
    if (S.state === 'ride') {
      S.runT += dt;
      while (nextZ > P.z - 170) nextZ -= kit.spawn(nextZ, P.z0 - nextZ, false, E);
      const d = dist();
      // every 10 km/h more top speed (from distance or points) gets called out
      const step = Math.floor(speedAt(d) * 3.6 / 10);
      if (step > S.speedStep) { S.speedStep = step; banner('Faster', `${step * 10} km/h`); Sfx.tone(330, 0.5, 'triangle', 0.12, 494); }
      // a big one gets a heads-up
      for (const r of ramps) if (r.warn && !r.warned && r.z - P.z > -(P.v + r.wv) * 2.2 && r.z < P.z) { r.warned = true; banner(...r.warn); Sfx.tone(220, 0.6, 'triangle', 0.1, 330); }
      ride(dt, false);
      if (S.bonus && d > S.bonus.end && !P.air && S.state === 'ride') endBonus(false);
    } else if (S.state === 'wipe') wipeStep(dt);
    else if (S.state === 'sucked') suckStep(dt);
    else if (S.state === 'results') { S.resT += dt; P.z -= SPEED0 * 0.4 * dt; }
    if (S.state === 'ride') placeRider(dt);
    updateRamps(dt);
    updateCamera(dt);
    const focus = S.state === 'wipe' ? wipeBody.p.z : P.z;
    kit.updateGround(camera.position.z, S.t, E);
    updateThings(dt);
    kit.updateScenery?.(camera.position.z, false, dt, E);
    kit.update?.(dt, focus, E);
    updateParticles(dt);
    updateSky(dt);
    updateHud(dt);
    Ambience.set(S.state === 'ride' ? clamp((P.v - 15) / 25, 0, 1) : 0.3);
  }
  // build the world around the camera now, so a paused first frame still shows the scene
  function refresh() { updateRamps(0); kit.updateGround(camera.position.z, S.t, E); updateThings(0); updateSky(0); }
  function render() { renderer.render(scene, camera); }

  // what a kit can reach
  const E = {
    THREE, scene, camera, S, P, T, base, laneX, laneHW, surfaceH, rampsH, rampF, rampE, rampAmp, ramps, things, coins,
    emit, burst, banner, pop, trick, addRamp, addThing, coinLine, speedAt, Sfx, suckIn,
    get C() { return C; }, get theme() { return kit.themes[S.theme]; },
  };
  kit.build?.(E);
  setTheme(0);

  return { open, close, update, render, release, restart: begin, get on() { return S.open; }, debug: E };   // debug: for tests and window.__game
}


// The HUD itself is the ski game's (index.html); this is only the wipeout wash and the touch layer.
const CSS = `
.rd { position: fixed; inset: 0; pointer-events: none; }
.rd.off { display: none; }
.rd-under { position: absolute; inset: 0; opacity: 0; background: #06325a; }
.rd-touch { position: absolute; inset: 0; pointer-events: none; touch-action: none; }
body.touch .rd[data-s="ride"] .rd-touch { pointer-events: auto; }
body.riding #camBtn, body.riding #lesson { display: none !important; }
#trick.warn #trickName { color: #ffd9cf; }
`;
