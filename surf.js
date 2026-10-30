// ============================================================
//  PEAK SURF: ride one endless wave
// ============================================================
// A kit for the ride engine (ride.js). You ride along the face of a wave that never ends, and like the mountain it
// keeps going downhill. The wall rises on your left to a curling lip; at its foot on the right the sea runs flat
// to the beach. Carve down the face for speed, up to the lip to launch an aerial, over foam sections for airs, and
// into the barrel where the lip throws over the face. Sharks, jellyfish, reefs, buoys and other surfers are in
// the way; now and then a whale breaches out behind the wave, and a whirlpool at its foot pulls you into the lagoon.
// The surfer is the rider you dressed in the Locker, on a board in your Locker colours.
import * as THREE from './lib/three.module.min.js';
import { equipped } from './meta.js';
import { createRideMode, lerp, clamp, rand, smooth, hash, TAU, rgb, wrap, pick, lam, unitBox, mix, put3, grid } from './ride.js';

const SLOPE = 0.16;
// the wave winds a little and its face gets wider and narrower as you go
const laneX = z => 4 * Math.sin(z * 0.005) + 1.5 * Math.sin(z * 0.015 + 1);
const laneHW = z => 9.5 + Math.sin(z * 0.008 + 0.5);
const base = z => z * SLOPE;
const FACE_H = 8, BEACH = 42;
// how far the wave stands above the sea at u: from the trough on the right up the face to the crest at -hw,
// then down the back of the wave
function faceH(u, hw) {
  if (u >= hw) return 0;
  if (u >= -hw) { const k = (hw - u) / (2 * hw); return FACE_H * k * k * (0.35 + 0.65 * k); }   // gentle at the foot, steep up top
  return FACE_H * smooth(-hw - 10, -hw, u);
}
// the beach past the flat water: a wet strip at the water's edge, then dunes
function sandH(o, z) {
  return 0.3 * smooth(0, 1.5, o) + 1.0 * smooth(2, 12, o) + 0.03 * o + 1.6 * smooth(10, 30, o) * (0.5 + 0.5 * Math.sin(z * 0.045 + 2.1 + o * 0.15)) + 2.5 * smooth(40, 70, o);
}
function groundH(u, z) { const hw = laneHW(z), o = u - hw - BEACH; return base(z) + (o > 0 ? sandH(o, z) : faceH(u, hw)); }

// ---------- conditions ----------
const THEMES = [
  { id: 'noon', name: 'Tropic noon', fogNear: 150, fogFar: 700, sky: [0x2b86e8, 0x8fd3ff, 0xe6f8ff], fog: 0xd2f0ff, sun: [0.3, 0.8, -0.5], sunCol: 0xfff3d1, light: 1.8, skySun: [0.25, 0.55, -0.8],
    hemi: [0xe8f7ff, 0x8a7a5a, 1.25], shallow: 0x3fd6cf, water: 0x139dbc, deep: 0x0a5f93, face: 0x1bb5c8, glow: 0x7cf2e4, foam: 0xffffff, spray: 0xffffff,
    sand: 0xf1d8a5, wet: 0xc79f68, green: 0x4c9a45, leaf: 0x3f9a46, trunk: 0x8a6a45, cloud: 0xffffff, spec: 0x6a8a99 },
  { id: 'gold', name: 'Golden hour', fogNear: 150, fogFar: 700, sky: [0x4d4aa6, 0xff9168, 0xffe2a8], fog: 0xffcf9e, sun: [-0.15, 0.3, -1], sunCol: 0xffbd73, light: 1.5, skySun: [-0.15, 0.12, -1],
    hemi: [0xffd9b8, 0x6a4a50, 1.4], shallow: 0x58b9b0, water: 0x2a7f9c, deep: 0x1d4c74, face: 0x2f8aa0, glow: 0xffc98a, foam: 0xfff3e2, spray: 0xfff1da,
    sand: 0xe9b98a, wet: 0xa9785a, green: 0x5a7a3a, leaf: 0x4c7a3a, trunk: 0x6a4a35, cloud: 0xffb08c, spec: 0xffb070 },
  { id: 'night', name: 'Glow night', night: true, fogNear: 150, fogFar: 700, sky: [0x05031f, 0x221058, 0x5a2a8c], fog: 0x2a1662, sun: [0.35, 0.42, -1], sunCol: 0xd8e0ff, light: 0.8,
    hemi: [0x7466d8, 0x0a0c2e, 1.05], shallow: 0x1a7aa8, water: 0x0a4a88, deep: 0x06205a, face: 0x0d5c9c, glow: 0x19e3ff, foam: 0xb6fcff, spray: 0x9cf8ff,
    sand: 0x5a5a8e, wet: 0x34366a, green: 0x23395a, leaf: 0x1c4a5a, trunk: 0x2e2848, cloud: 0x3a2e7c, spec: 0x8899ff, emissive: 0x0a1c44 },
  // through the whirlpool: a glowing lagoon at dusk, worth double points (never picked for a normal run)
  { id: 'lagoon', name: 'Whirlpool lagoon', night: true, noClouds: true, fogNear: 120, moon: 0xd8fff8, discScale: 1.2, sky: [0x041a2e, 0x0d5a72, 0x46d8c4], fog: 0x0f5262, fogFar: 560,
    sun: [0.25, 0.7, -0.6], skySun: [0.3, 0.3, -1], sunCol: 0xc8fff6, light: 1.15, hemi: [0x9ffcff, 0x10283e, 1.25],
    shallow: 0x36f0d4, water: 0x0bb0be, deep: 0x075478, face: 0x18ccd2, glow: 0xb4fff2, foam: 0xf0fffc, spray: 0xd8fff8,
    sand: 0x5e4f94, wet: 0x382c6e, green: 0x1c2f58, leaf: 0x34b48e, trunk: 0x3a2c5a, cloud: 0x2a6a7a, spec: 0xb0ffff, emissive: 0x05303c },
];

// ---------- the surfboard ----------
const finMat = lam(0x1f2a36), white = lam(0xffffff);
function boardGeo(len = 2.05, wid = 0.54) {
  const g = new THREE.BoxGeometry(len, 0.08, wid, 10, 1, 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / (len / 2), wk = u > 0 ? 1 - Math.pow(u, 2.2) * 0.82 : 1 - Math.pow(-u, 3) * 0.45;
    p.setZ(i, p.getZ(i) * wk); p.setY(i, p.getY(i) + (u > 0.55 ? (u - 0.55) * 0.16 : 0) + (u < -0.8 ? (-u - 0.8) * 0.06 : 0));
  }
  g.computeVertexNormals(); return g;
}
// the Locker rider, standing sideways on the board facing the wave
const V = () => new THREE.Vector3();

export function createSurf(host) {
  function makeRider() {
    const L = host.rider(), sk = equipped('ski'), o = equipped('outfit');
    const deck = sk.color === 'rainbow' ? '#ff4fd8' : sk.color || '#fff6e6';
    const root = new THREE.Group(), gear = new THREE.Group(); root.add(gear);
    gear.add(new THREE.Mesh(boardGeo(2.1, 0.56), lam(new THREE.Color(deck).getHex())));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.012, 0.08), lam(new THREE.Color(sk.tip || o.jacket || '#ffffff').getHex())); stripe.position.y = 0.047; gear.add(stripe);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.03), finMat); fin.position.set(-0.85, -0.12, 0); fin.rotation.z = -0.3; gear.add(fin);
    const stance = new THREE.Group(); root.add(stance); stance.add(L.root);
    L.root.rotation.y = -Math.PI / 2;   // the rider's front (−Z) along the board
    L.legs.rotation.set(0, Math.PI / 2, 0, 'YXZ'); L.legs.scale.set(1.7, 1, 1);
    return { root, gear, stance, L };
  }
  // crouch over the board, arms out for balance, lean into the turn, tuck for flips, reach down to grab
  function poseRider(r, pose, t) {
    const { L } = r, c = pose.crouch, m = pose.mode;
    r.stance.rotation.x = m === 'wipe' ? 0 : pose.lean * 0.9;
    L.body.position.y = 0.88 - 0.14 * c; L.legs.scale.y = 1 - 0.16 * c;
    const bend = m === 'tuck' ? 0.9 : m === 'grab' ? 0.75 : 0.18 + 0.32 * c;
    L.upper.rotation.set(-bend, Math.PI / 2 + (m === 'wipe' ? Math.sin(t * 8) * 0.6 : 0), 0, 'YXZ');
    L.arms.forEach((a, i) => {
      const sx = i ? 1 : -1;
      if (m === 'grab') a.rotation.set(i ? 1.5 : 0.4, 0, sx * (i ? 0.1 : 1.1));
      else if (m === 'tuck') a.rotation.set(1.2, 0, sx * 0.35);
      else if (m === 'wipe') a.rotation.set(Math.sin(t * 11 + i * 2) * 1.5, 0, sx * (1.2 + Math.cos(t * 9 + i) * 0.5));
      else a.rotation.set(0.25 + pose.arm * 0.3 + Math.sin(t * 2.1 + i) * 0.05, 0, sx * (1.05 + 0.2 * pose.arm));
    });
  }

  // ---------- materials the themes recolour ----------
  // the sea and the wave share one smooth material; part of its colour glows, the way light comes through a wave
  const seaMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x6a8a99, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const lipMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x6a8a99, side: THREE.DoubleSide });
  const chopMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x6a8a99, side: THREE.DoubleSide });
  const glowFace = { value: 0.34 };
  const glowLip = { value: 0.62 };   // the curl is thin, so light comes through it most of all
  for (const mtl of [seaMat, lipMat, chopMat]) mtl.onBeforeCompile = sh => {
    sh.uniforms.glowFace = mtl === lipMat ? glowLip : glowFace;
    sh.fragmentShader = 'uniform float glowFace;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * glowFace;');
  };
  const sandMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const swashMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const trunkMat = lam(0x8a6a45), leafMat = lam(0x3fa34d), nutMat = lam(0x5a3a1e), rockMat = lam(0x3b342f), barnMat = lam(0x5d5146);
  const sharkMat = lam(0x55657a), whaleMat = lam(0x2f3d55), whaleBelly = lam(0xc9d2dc);
  const jellyMat = new THREE.MeshLambertMaterial({ color: 0xff8ad0, emissive: 0x7a2a6a, transparent: true, opacity: 0.78 });
  const jellyCore = new THREE.MeshBasicMaterial({ color: 0xffd0f0 });
  const shellMat = lam(0x5a7a3a), turtleSkin = lam(0x8fbf6a), buoyRed = lam(0xff4b3e);
  const skinMat = lam(0xf0c49a), hairMat = lam(0x3a2716);
  let C = {}, T = null;
  const tmpA = [0, 0, 0], tmpB = [0, 0, 0], tmpW = [0, 0, 0];
  let E;   // the engine, once it's built

  // ---------- the sea: the back of the wave, its face, the flat water in front, the beach ----------
  const DZ = 2, NEAR = 140, NR = 200, FAR_DZ = 9;   // 2 m rows close up, 9 m rows out to ~820 m
  const BACK = [-80, -50, -30, -19, -13, -9.5, -7, -5, -3.4, -2, -0.9];   // behind the crest, from -hw
  const NF = 30, TROUGH = [1.2, 3, 6, 10, 16, 24, 32, 38, BEACH - 0.5];   // the face, then out from its foot
  const WC = BACK.length + NF + TROUGH.length;
  const SAND = [0, 0.7, 2, 4, 7, 11, 17, 26, 40, 56, 75, 100];
  const sea = new THREE.Mesh(grid(NR, WC), seaMat), sand = new THREE.Mesh(grid(NR, SAND.length), sandMat), swash = new THREE.Mesh(grid(NR, 6), swashMat);
  for (const mm of [sea, sand, swash]) mm.frustumCulled = false;
  const colU = (j, hw) => j < BACK.length ? -hw + BACK[j] : j < BACK.length + NF ? -hw + 2 * hw * (j - BACK.length) / (NF - 1) : hw + TROUGH[j - BACK.length - NF];
  // the colour of the sea at a spot: dark at the foot of the face, glassy turquoise up it, white along the crest
  function waterCol(u, z, t, hw, out) {
    const streak = 0.5 + 0.5 * Math.sin(z * 0.61 + u * 0.4) * Math.sin(z * 0.17 - 1.3);
    if (u <= hw && u >= -hw) {
      const k = (hw - u) / (2 * hw);
      mix(out, 0, C.trough, C.face, smooth(0, 0.6, k));
      mix(out, 0, out, C.glow, smooth(0.45, 0.95, k) * C.glowK);
      mix(out, 0, out, C.foam, smooth(0.9, 0.995, k) * (0.45 + 0.55 * streak));
    } else if (u < -hw) {
      mix(out, 0, C.face, C.deep, smooth(-hw, -hw - 14, u));
      mix(out, 0, out, C.foam, smooth(-hw - 2.5, -hw, u) * (0.4 + 0.5 * streak));
    } else {
      mix(out, 0, C.trough, C.water, smooth(hw, hw + 10, u));
      mix(out, 0, out, C.shallow, smooth(hw + 22, hw + BEACH, u));
      mix(out, 0, out, C.foam, smooth(hw + 4, hw, u) * 0.35 * streak);   // whitewater left at the foot by the last break
    }
    return out;
  }
  function updateGround(zc, t) {
    const z0 = Math.ceil((zc + 30) / DZ) * DZ;
    const WP = sea.geometry.attributes.position.array, WCo = sea.geometry.attributes.color.array;
    const SP = sand.geometry.attributes.position.array, SC = sand.geometry.attributes.color.array, SN = SAND.length;
    const FP = swash.geometry.attributes.position.array, FC = swash.geometry.attributes.color.array;
    for (let i = 0; i < NR; i++) {
      const z = z0 - (i < NEAR ? i * DZ : NEAR * DZ + (i - NEAR) * FAR_DZ), hw = laneHW(z), cx = laneX(z), b = base(z), row = Math.round(z / DZ);
      for (let j = 0, k = i * WC * 3; j < WC; j++, k += 3) {
        const u = colU(j, hw);
        WP[k] = cx + u; WP[k + 1] = b + faceH(u, hw) + (u >= hw ? 0.03 * Math.sin(u * 0.9 + z * 0.7 - t * 1.7) : 0); WP[k + 2] = z;
        waterCol(u, z, t, hw, tmpA); put3(WCo, k, tmpA, 0.97 + 0.05 * hash(row * 31 + j));
      }
      // the beach: wet at the waterline, dry dunes, then the jungle behind it
      for (let j = 0, k = i * SN * 3; j < SN; j++, k += 3) {
        const o = SAND[j], hs = hash(row * 17 + j);
        SP[k] = cx + hw + BEACH + o; SP[k + 1] = b + sandH(o, z); SP[k + 2] = z;
        mix(tmpA, 0, C.wet, C.sand, smooth(0.5, 3.5, o)); mix(tmpA, 0, tmpA, C.green, smooth(45, 70, o));
        put3(SC, k, tmpA, 0.93 + 0.1 * hs);
      }
      // the swash: water running up the sand and sliding back, leaving a lacy line of foam
      const reach = 0.6 + 2.4 * (0.5 + 0.5 * Math.sin(t * 0.85 + z * 0.045)) * (0.6 + 0.4 * Math.sin(z * 0.13 + 1.7)), e0 = hw + BEACH;
      const cols = [e0 - 3, e0 - 1, e0 + reach - 0.9, e0 + reach - 0.35, e0 + reach, e0 + reach + 0.6];
      for (let j = 0, k = i * 6 * 3; j < 6; j++, k += 3) {
        const u = cols[j], o = Math.max(0, u - e0), lace = 0.55 + 0.45 * hash(row * 7 + j);
        FP[k] = cx + u; FP[k + 1] = b + (u < e0 ? 0 : sandH(o, z)) + 0.035; FP[k + 2] = z;
        waterCol(Math.min(u, e0), z, t, hw, tmpW);
        if (j === 0) put3(FC, k, tmpW);
        else if (j === 1) { mix(tmpA, 0, tmpW, C.foam, 0.25 * lace); put3(FC, k, tmpA); }
        else if (j === 2) { mix(tmpA, 0, C.shallow, C.foam, 0.55 * lace); put3(FC, k, tmpA); }
        else if (j === 3) { mix(tmpA, 0, C.wet, C.foam, 0.9 * lace); put3(FC, k, tmpA); }
        else if (j === 4) { mix(tmpA, 0, C.wet, C.foam, 0.35); put3(FC, k, tmpA); }
        else put3(FC, k, C.wet, 0.97);
      }
    }
    for (const mm of [sea, sand, swash]) { mm.geometry.attributes.position.needsUpdate = true; mm.geometry.attributes.color.needsUpdate = true; mm.geometry.computeVertexNormals(); }
  }

  // ---------- barrels: stretches where the lip throws right over the face ----------
  const barrels = [];   // { za (where it opens), zb (where it closes), warned }
  function barrelK(z) {
    let k = 0;
    for (const b of barrels) if (z < b.za && z > b.zb) k = Math.max(k, smooth(b.za, b.za - 18, z) * smooth(b.zb, b.zb + 18, z));
    return k;
  }
  // the curl's cross-section at z: an arc from the crest, up and over; in a barrel it reaches far out over the face
  const curl = z => { const k = barrelK(z); return { k, rx: lerp(1.1, 4.2, k), ry: lerp(1.2, 3.6, k), end: lerp(0.15, -0.2, k) * Math.PI }; };
  const tubeReach = z => { const c = curl(z); return c.rx * (1 + Math.cos(c.end)); };   // how far out from the crest the lip lands

  // ---------- the lip: a sheet curling over the top of the wave, rebuilt every frame ----------
  const LROWS = 120, LCOLS = 18;
  const lip = new THREE.Mesh(grid(LROWS, LCOLS), lipMat); lip.frustumCulled = false;
  function updateLip(zc, t) {
    const z0 = Math.ceil((zc + 30) / DZ) * DZ;
    const Pa = lip.geometry.attributes.position.array, Ca = lip.geometry.attributes.color.array;
    for (let i = 0; i < LROWS; i++) {
      const z = z0 - i * DZ, hw = laneHW(z), cx = laneX(z), b = base(z), c = curl(z), row = Math.round(z / DZ);
      const wob = 0.12 * Math.sin(z * 0.4 + t * 2.3);
      for (let j = 0, k = i * LCOLS * 3; j < LCOLS; j++, k += 3) {
        const s = j / (LCOLS - 1), th = lerp(Math.PI, c.end, s);
        const u = -hw + c.rx + c.rx * Math.cos(th), y = FACE_H + c.ry * Math.sin(th) + wob * s;
        Pa[k] = cx + u; Pa[k + 1] = b + y; Pa[k + 2] = z;
        // white water tumbling over the top, glassy green-blue underneath, a fringe of foam where it lands
        const n = 0.5 + 0.5 * Math.sin(z * 0.9 + s * 7 + t * 3) * Math.sin(z * 0.31 - t);
        mix(tmpA, 0, C.face, C.glow, 0.45 + 0.55 * s);
        // foam rolling over the top of a small curl; in a barrel the sheet is glassy, with foam only along its edge
        const top = smooth(0.05, 0.4, s) * (1 - smooth(0.55, 0.85, s)) * (0.55 + 0.45 * n) * (1 - 0.75 * c.k);
        const edge = smooth(0.86, 1, s) * (0.5 + 0.5 * n);
        mix(Ca, k, tmpA, C.foam, Math.max(top, edge));
        Ca[k] *= 0.97 + 0.05 * hash(row * 13 + j);
      }
    }
    lip.geometry.attributes.position.needsUpdate = true; lip.geometry.attributes.color.needsUpdate = true; lip.geometry.computeVertexNormals();
  }

  // ---------- foam sections: whitewater bumps on the face that kick you into the air ----------
  const FACE_ROWS = [1, 0.8, 0.62, 0.46, 0.32, 0.2, 0.11, 0.05, 0.015, 0], BACK_ROWS = [0.08, 0.2, 0.36, 0.55, 0.78, 1];
  const CROWS = FACE_ROWS.length + BACK_ROWS.length, CCOLS = 22, CMAX = 12;
  const chopPool = [];
  const chopF = (r, dz) => dz >= 0 ? (dz < r.LF ? Math.pow(1 - dz / r.LF, r.p) : 0) : (dz > -r.LB ? 0.5 + 0.5 * Math.cos(Math.PI * dz / r.LB) : 0);
  function drawChop(r, t) {
    const m = r.mesh; if (!m) return;
    const Pa = m.geometry.attributes.position.array, Ca = m.geometry.attributes.color.array, amp = E.rampAmp(r);
    for (let i = 0; i < CROWS; i++) {
      const face = i < FACE_ROWS.length, dz = face ? FACE_ROWS[i] * r.LF : -BACK_ROWS[i - FACE_ROWS.length] * r.LB;
      const z = r.z + dz, hw = laneHW(z), cx = laneX(z), f = chopF(r, dz);
      for (let j = 0, k = i * CCOLS * 3; j < CCOLS; j++, k += 3) {
        const u = lerp(r.ua - r.fade, r.ub + r.fade, j / (CCOLS - 1)), e = E.rampE(r, u, hw);
        Pa[k] = cx + u; Pa[k + 1] = groundH(u, z) + amp * f * e + 0.05; Pa[k + 2] = z;
        const n = 0.5 + 0.5 * Math.sin(u * 2.1 + r.seed + t * 2) * Math.sin(z * 0.8 - t * 1.4);
        waterCol(u, z, t, hw, tmpW);
        mix(tmpA, 0, tmpW, C.glow, smooth(0.2, 0.7, f) * 0.5);
        mix(tmpB, 0, tmpA, C.foam, smooth(0.35, 0.95, f) * (0.55 + 0.45 * n) + (face ? 0 : 0.3 * f));
        mix(Ca, k, tmpW, tmpB, smooth(0, 0.5, e));
      }
    }
    m.geometry.attributes.position.needsUpdate = true; m.geometry.attributes.color.needsUpdate = true; m.geometry.computeVertexNormals();
  }


  // ---------- whales breach out behind the wave ----------
  function makeWhale() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), whaleMat); g.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, TAU, Math.PI * 0.55, Math.PI * 0.45), whaleBelly); body.add(belly);
    const tail = new THREE.Group(); g.add(tail);
    const stock = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 4, 10).rotateX(Math.PI / 2), whaleMat); stock.position.z = -2; tail.add(stock);
    for (const s of [-1, 1]) { const fl = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 1.3), whaleMat); fl.position.set(s * 1.25, 0, -4.1); fl.rotation.y = s * 0.35; tail.add(fl); }
    for (const s of [-1, 1]) { const pf = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 0.9), whaleMat); pf.position.set(s * 2.6, -0.6, 2.2); pf.rotation.set(0, s * -0.5, s * -0.4); g.add(pf); }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), finMat);
    for (const s of [-1, 1]) { const e = eye.clone(); e.position.set(s * 2.25, 0.05, 5.1); g.add(e); }
    g.userData = { body, tail };
    return g;
  }
  const whale = makeWhale();
  const breach = { on: false, t: 0, next: 18 };
  function updateBreach(dt, zc) {
    const g = whale;
    if (!breach.on) {
      breach.next -= dt;
      if (breach.next <= 0 && E.S.state !== 'results') {
        breach.on = true; breach.t = 0; breach.z = zc - rand(110, 160); breach.u = -laneHW(breach.z) - rand(30, 70); breach.dir = Math.random() < 0.5 ? 1 : -1;
        g.visible = true; g.userData.body.scale.set(2.6, 2.2, 7); g.userData.tail.position.set(0, 0, -6.4);
      }
      return;
    }
    breach.t += dt;
    const k = breach.t / 3.4, b = base(breach.z), x = laneX(breach.z) + breach.u;
    // up out of the water nose first, twist, and crash back down on its side
    const y = b - 4 + Math.sin(k * Math.PI) * 13;
    g.position.set(x + breach.dir * k * 6, y, breach.z);
    g.rotation.set(-1.25 + k * 2.3, breach.dir * 0.4, breach.dir * k * 1.4);
    g.userData.tail.rotation.x = Math.sin(breach.t * 5) * 0.2;
    const splash = (n, up) => E.burst(x + breach.dir * k * 6, b + 0.2, breach.z, n, 5, up, 0.5, 1.6, C.sprayHex, 12);
    if (breach.t > 0.15 && !breach.s1) { breach.s1 = true; splash(70, 14); }
    if (k > 0.86 && !breach.s2) { breach.s2 = true; splash(140, 18); E.Sfx.noise(1.4, 0.35, 260); }
    if (k >= 1) { breach.on = false; breach.s1 = breach.s2 = false; g.visible = false; breach.next = rand(22, 40); }
  }

  // ---------- things in the water ----------
  function makeRock(r) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), rockMat); m.scale.set(r, r * 1.4, r * 0.9); m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); m.position.y = r * 0.45; g.add(m);
    const b = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), barnMat); b.scale.setScalar(r * 0.42); b.position.set(r * 0.4, r * 1.2, r * 0.2); g.add(b);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.15, 0.12, 4, 18).rotateX(Math.PI / 2), white); ring.position.y = 0.28; g.add(ring);
    g.userData.ring = ring; return g;
  }
  const finGeo = (() => {   // a curved dorsal fin: a thin, swept-back triangle
    const s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(0.15, 0.6, -0.35, 1.05); s.quadraticCurveTo(-0.3, 0.5, -0.75, 0); s.lineTo(0, 0);
    return new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false }).translate(0.3, 0, -0.04).rotateY(-Math.PI / 2);
  })();
  function makeShark() {
    const g = new THREE.Group();
    const fin = new THREE.Mesh(finGeo, sharkMat); fin.scale.setScalar(1.05); g.add(fin);
    const back = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), sharkMat); back.scale.set(0.45, 0.32, 1.9); back.position.set(0, -0.2, -0.2); g.add(back);
    const tail = new THREE.Mesh(finGeo, sharkMat); tail.scale.setScalar(0.5); tail.position.set(0, -0.05, -2.2); g.add(tail);
    const wake = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.6, 16, 1, Math.PI * 0.15, Math.PI * 0.7).rotateX(-Math.PI / 2), white); wake.position.set(0, 0.03, 0.35); g.add(wake);
    g.userData = { tail, wake }; return g;
  }
  function makeJelly() {
    const g = new THREE.Group(), bell = new THREE.Group(); g.add(bell);
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 8, 0, TAU, 0, Math.PI * 0.55), jellyMat); bell.add(d);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), jellyCore); core.position.y = 0.12; bell.add(core);
    const tent = [];
    for (let k = 0; k < 7; k++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.012, 0.9, 4).translate(0, -0.45, 0), jellyMat);
      const a = k / 7 * TAU; t.position.set(Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3); g.add(t); tent.push(t);
    }
    g.userData = { bell, tent }; return g;
  }
  function makeTurtle() {
    const g = new THREE.Group();
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 6, 0, TAU, 0, Math.PI / 2), shellMat); sh.scale.y = 0.55; sh.position.y = 0.02; g.add(sh);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), turtleSkin); h.scale.z = 1.4; h.position.set(0, 0.06, 0.75); g.add(h);
    const fl = [];
    for (const [x, z] of [[-0.55, 0.3], [0.55, 0.3], [-0.45, -0.4], [0.45, -0.4]]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.05, 0.2), turtleSkin); f.position.set(x, 0, z); g.add(f); fl.push(f); }
    g.userData.fl = fl; return g;
  }
  const PADDLE_COLS = [0xff6b5b, 0xffc24b, 0x7b6cff, 0x2ec27e, 0xff7eb6];
  function makePaddler() {
    const g = new THREE.Group(), bd = new THREE.Mesh(boardGeo(2.3, 0.6), lam(pick(PADDLE_COLS))); bd.rotation.y = -Math.PI / 2; g.add(bd);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.75), lam(pick(PADDLE_COLS))); torso.position.set(0, 0.16, 0.15); g.add(torso);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.7), lam(0x23324a)); legs.position.set(0, 0.12, -0.55); g.add(legs);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), skinMat); head.position.set(0, 0.3, 0.66); g.add(head);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.26), hairMat); hair.position.y = 0.14; head.add(hair);
    const arms = [0.22, -0.22].map(x => { const a = new THREE.Mesh(unitBox(0.09, 0.09), skinMat); a.position.set(x * 1.1, 0.2, 0.4); a.scale.y = 0.6; g.add(a); return a; });
    g.userData.arms = arms; return g;
  }
  function makeBuoy() {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.5, 12), buoyRed); b.position.y = 0.15; g.add(b);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.3, 12), white); w.position.y = 0.55; g.add(w);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.45, 12), buoyRed); top.position.y = 0.92; g.add(top);
    return g;
  }
  // a thing that swims: wanders across the lane, turning back before the sand
  function swim(o, dt, sp) {
    const hw = laneHW(o.z) - 1.5;
    if ((o.u > hw && o.vu > 0) || (o.u < -hw && o.vu < 0)) o.vu = -o.vu;
    o.u += (o.vu + Math.sin(E.S.t * 0.9 + o.ph) * sp * 0.4) * dt; o.z += o.vz * dt;
  }
  const facing = o => Math.atan2(o.vu, o.vz);
  // hit: wipe (ends the run) or slow; clear: how high above the water you need to be to pass over it
  const KIND = {
    rock: { make: o => makeRock(o.r), w: o => o.r + 0.3, clear: 1.7, hit: 'wipe', why: ['Hit a rock', 'Steer round the reef, or jump it'],
      bob: () => -0.25, anim: (o, t) => { o.g.userData.ring.scale.setScalar(1 + 0.12 * Math.sin(t * 2.4 + o.ph)); } },
    shark: { make: () => makeShark(), w: () => 0.95, clear: 1.2, hit: 'wipe', hop: 'Shark Jump', pts: 400, why: ['Bitten by a shark', 'Steer round the fins, or jump them'],
      move: (o, dt) => swim(o, dt, 3), bob: (o, t) => Math.sin(t * 1.7 + o.ph) * 0.05,
      anim: (o, t) => { o.g.rotation.y = facing(o); o.g.userData.tail.rotation.y = Math.sin(t * 6 + o.ph) * 0.35; o.g.userData.wake.scale.setScalar(1 + 0.15 * Math.sin(t * 8)); if (Math.random() < 0.25) E.emit(o.g.position.x, o.g.position.y + 0.1, o.g.position.z, rand(-1, 1), rand(0.5, 1.5), rand(-1, 1), rand(0.05, 0.1), 0.4, C.sprayHex, 6); } },
    jelly: { make: () => makeJelly(), w: () => 0.6, clear: 0.5, hit: 'slow', slow: 0.35, msg: 'Stung!', splash: 0xff8ad0,
      move: (o, dt) => swim(o, dt, 1), bob: (o, t) => -0.1 + Math.sin(t * 2.4 + o.ph) * 0.12,
      anim: (o, t) => {
        const p = Math.sin(t * 3.2 + o.ph), { bell, tent } = o.g.userData;
        bell.scale.set(1 - 0.14 * p, 1 + 0.22 * p, 1 - 0.14 * p);
        tent.forEach((tt, k) => { tt.rotation.x = 0.35 + Math.sin(t * 3.2 + o.ph + k) * 0.3; tt.rotation.z = Math.cos(t * 2.6 + k * 1.3) * 0.25; });
      } },
    turtle: { make: () => makeTurtle(), w: () => 0.8, clear: 0.6, hit: 'slow', hop: 'Turtle Hop', pts: 200, slow: 0.45, msg: 'Bonk!',
      move: (o, dt) => swim(o, dt, 1.5), anim: (o, t) => { o.g.rotation.y = facing(o); o.g.userData.fl.forEach((f, k) => { f.rotation.y = Math.sin(t * 4 + k * 1.6) * 0.5; f.rotation.z = Math.cos(t * 4 + k) * 0.3; }); } },
    kook: { make: () => makePaddler(), w: () => 0.85, clear: 0.95, hit: 'wipe', hop: 'Kook Hop!', pts: 300, why: ['Ran over a surfer', 'Steer round them, or jump right over'],
      move: (o, dt) => { o.z += 1.6 * dt; }, anim: (o, t) => { o.g.userData.arms.forEach((a, k) => { a.rotation.x = t * 5 + o.ph + k * Math.PI; }); } },
    buoy: { make: () => makeBuoy(), w: () => 0.65, clear: 1.15, hit: 'wipe', hop: 'Buoy Hop', pts: 250, why: ['Hit a buoy', 'Steer round buoys, or jump them'],
      bob: (o, t) => Math.sin(t * 2.5 + o.ph) * 0.08 - 0.12, anim: (o, t) => { o.g.rotation.z = Math.sin(t * 1.7 + o.ph) * 0.12; } },
  };

  // ---------- the beach: palms, umbrellas, huts, a lifeguard tower ----------
  const BRIGHT = [0xff5d5d, 0xffc24b, 0x2ec2b5, 0xff7eb6, 0x4f7cff, 0xffffff];
  function makePalm() {
    const g = new THREE.Group(), h = rand(5.5, 9), lean = rand(0.1, 0.45);   // they lean out towards the water
    let x = 0, y = 0;
    for (let k = 0; k < 6; k++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.19 - k * 0.015, 0.23 - k * 0.015, h / 6 + 0.1, 7), trunkMat);
      const nx = x + Math.sin(lean) * (h / 6) * (k / 3), ny = y + h / 6;
      s.position.set((x + nx) / 2, (y + ny) / 2, 0); s.rotation.z = -lean * k / 5; g.add(s); x = nx; y = ny;
    }
    const n = 8;
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU + rand(-0.2, 0.2), lf = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.05, 0.6).translate(1.4, 0, 0), leafMat); blade.rotation.z = -rand(0.3, 0.7); lf.add(blade);
      lf.position.set(x, y, 0); lf.rotation.y = a; g.add(lf);
    }
    for (let k = 0; k < 3; k++) { const nt = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), nutMat); nt.position.set(x + Math.cos(k * 2) * 0.25, y - 0.2, Math.sin(k * 2) * 0.25); g.add(nt); }
    return g;
  }
  function makeUmbrella() {
    const g = new THREE.Group(), col = pick(BRIGHT);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5), white); pole.position.y = 1.2; pole.rotation.z = rand(-0.15, 0.15); g.add(pole);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.7, 10), lam(col)); top.position.y = 2.45; g.add(top);
    const towel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 1.9), lam(pick(BRIGHT))); towel.position.set(rand(0.8, 1.4), 0.03, rand(-0.5, 0.5)); towel.rotation.y = rand(-0.4, 0.4); g.add(towel);
    return g;
  }
  function makeHut() {
    const g = new THREE.Group(), col = pick([0xffd6a5, 0xa8e6cf, 0xffaaa5, 0xbde0fe]);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2.2), lam(col)); box.position.y = 1; g.add(box);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1.9, 1.1, 4, 1), lam(0xc9774a)); roof.position.y = 2.55; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.85); g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 0.7), lam(0x6a4a35)); door.position.set(1.21, 0.6, 0); g.add(door);
    return g;
  }
  function makeTower() {
    const g = new THREE.Group();
    for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), white); l.position.set(x, 1.3, z); g.add(l); }
    const hut = new THREE.Mesh(new THREE.BoxGeometry(2, 1.3, 2), buoyRed); hut.position.y = 3.2; g.add(hut);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 2.4), white); roof.position.y = 3.95; g.add(roof);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.4, 0.6), lam(0xffc24b)); flag.position.set(0, 4.9, 0.3); g.add(flag);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 4), white); mast.position.set(0, 4.5, 0); g.add(mast);
    return g;
  }
  function makeStuckBoard() {
    const g = new THREE.Group(), b = new THREE.Mesh(boardGeo(2.2, 0.6), lam(pick(BRIGHT)));
    b.rotation.z = Math.PI / 2 - 0.12; b.position.y = 1; g.add(b);
    return g;
  }
  const coralMats = [0xff5fa8, 0xff9a4a, 0x7cf3ff, 0xb68cff].map(c => lam(c, { emissive: c, emissiveIntensity: 0.55 }));
  const crystalMat = new THREE.MeshLambertMaterial({ color: 0xa8fff4, emissive: 0x2ad6c8, emissiveIntensity: 0.8, transparent: true, opacity: 0.85, flatShading: true });
  function makeCoral() {
    const g = new THREE.Group(), m = pick(coralMats), n = 3 + (Math.random() * 4 | 0);
    for (let k = 0; k < n; k++) {
      const h = rand(1.2, 4.5), b = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, h, 6).translate(0, h / 2, 0), m);
      b.rotation.set(rand(-0.5, 0.5), rand(0, TAU), rand(-0.5, 0.5)); g.add(b);
      const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.25, 0.45), 0), m); tip.position.copy(new THREE.Vector3(0, h, 0).applyEuler(b.rotation)); g.add(tip);
    }
    return g;
  }
  function makeCrystal() {
    const g = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const h = rand(3, 9) * (k ? 0.6 : 1), c = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), crystalMat);
      c.scale.set(rand(0.6, 1.1), h / 2, rand(0.6, 1.1)); c.position.set(rand(-1.5, 1.5), h / 2 - 0.5, rand(-1.5, 1.5)); c.rotation.set(rand(-0.25, 0.25), rand(0, 3), rand(-0.25, 0.25)); g.add(c);
    }
    return g;
  }
  const PROPS = () => T.id === 'lagoon' ? [[makeCoral, 0.5], [makeCrystal, 0.3], [makePalm, 0.2]] : [[makePalm, 0.44], [makeUmbrella, 0.28], [makeHut, 0.1], [makeTower, 0.07], [makeStuckBoard, 0.11]];
  const PROP_N = 46, PROP_GAP = 9;
  let props = [];
  function buildProps() {
    for (const p of props) E.scene.remove(p.g);
    props = [];
    const list = PROPS();
    for (let i = 0; i < PROP_N; i++) {
      let r = Math.random(), mk = list[0][0];
      for (const [f, p] of list) { if (r < p) { mk = f; break; } r -= p; }
      const g = mk(); E.scene.add(g);
      props.push({ g, z: 0, off: 0, palm: mk === makePalm });
    }
  }
  // out to sea behind the wave: sailboats and little islands drifting past on the horizon
  const sailMat = lam(0xffffff), hullMat = lam(0x30425a), islandMat = lam(0x3f7a40), islandSand = lam(0xe8cf9a);
  const farOut = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    if (i < 4) {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 5), hullMat); hull.position.y = 0.3; g.add(hull);
      const sail = new THREE.Mesh(new THREE.ConeGeometry(2, 7, 3), sailMat); sail.scale.set(0.12, 1, 1); sail.position.y = 4.2; g.add(sail);
      g.scale.setScalar(1.6);
    } else {
      const isl = new THREE.Mesh(new THREE.ConeGeometry(30, 9, 9), islandMat); isl.scale.y = 0.7; g.add(isl);
      const beach = new THREE.Mesh(new THREE.CylinderGeometry(34, 36, 1.5, 12), islandSand); beach.position.y = -2.3; g.add(beach);
    }
    g.userData = { u: i < 4 ? rand(90, 260) : rand(320, 420), dz: rand(150, 650), sp: i < 4 ? rand(-1.5, 1.5) : 0 };
    farOut.push(g);
  }
  function updateScenery(zc, reset, dt) {
    props.forEach((p, i) => {
      if (reset) { p.z = zc - 20 - i * PROP_GAP; p.off = 0; }
      if (p.z > zc + 25 || !p.off) {
        if (!reset && p.off) p.z -= PROP_N * PROP_GAP;
        p.off = p.palm ? rand(3.5, 40) : rand(3, 18);
        p.g.rotation.y = Math.PI + (p.palm ? rand(-0.5, 0.5) : rand(-0.6, 0.6));   // facing the water
      }
      const hw = laneHW(p.z);
      p.g.position.set(laneX(p.z) + hw + BEACH + p.off, base(p.z) + sandH(p.off, p.z) - 0.05, p.z);
    });
    for (const g of farOut) {
      const u = g.userData; u.u += u.sp * dt * 0.3;
      const z = zc - u.dz; g.position.set(laneX(z) - laneHW(z) - u.u, base(z) - 0.2, z);
      g.rotation.y = 0.6;
      u.dz -= dt * 2.5;
      if (u.dz < 140) u.dz += 520;
    }
  }

  // ---------- the whirlpool: ride into it and it pulls you under, out into the lagoon (double points) ----------
  // A disc of water laid on the sea: spiral foam arms winding into a dark core, a churning lip of foam at the rim,
  // and normals shaped like a funnel so the light falls into it. Its edge matches the water around it.
  const WR = 8, WRINGS = 28, WSEGS = 80;
  const whirlGeo = (() => {
    const g = new THREE.BufferGeometry(), n = (WRINGS + 1) * WSEGS, idx = [];
    for (let i = 0; i < WRINGS; i++) for (let j = 0; j < WSEGS; j++) {
      const a = i * WSEGS + j, b = i * WSEGS + (j + 1) % WSEGS, c = a + WSEGS, d = b + WSEGS;
      idx.push(a, b, c, b, d, c);   // wound so the faces point up
    }
    g.setIndex(idx);
    for (const k of ['position', 'normal', 'color']) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    return g;
  })();
  const whirlMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x4a6a78, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const whirlG = new THREE.Group(), whirlMesh = new THREE.Mesh(whirlGeo, whirlMat);
  whirlMesh.frustumCulled = false; whirlG.add(whirlMesh); whirlG.visible = false;
  const CORE = rgb(0x031423), tmpV = [0, 0, 0], tmpF = [0, 0, 0];
  function drawWhirl(t, x0, z0, hw) {
    const Pa = whirlGeo.attributes.position.array, Na = whirlGeo.attributes.normal.array, Ca = whirlGeo.attributes.color.array;
    for (let i = 0; i <= WRINGS; i++) {
      const k = i / WRINGS, r = 0.15 + (WR - 0.15) * Math.pow(k, 0.85), q = r / WR;
      // the funnel the light sees: steep near the middle, flattening out to the sea
      const slope = 3.2 * Math.pow(1 - q, 1.4) / WR * 6;
      const lip = Math.exp(-Math.pow((q - 0.8) / 0.09, 2));   // a ring of churned water three quarters of the way out
      for (let j = 0; j < WSEGS; j++) {
        const a = j / WSEGS * TAU, ca = Math.cos(a), sa = Math.sin(a), o = (i * WSEGS + j) * 3;
        Pa[o] = ca * r; Pa[o + 1] = 0.035 + lip * 0.45 * (0.6 + 0.4 * Math.sin(a * 5 + t * 7)); Pa[o + 2] = sa * r;
        const nl = Math.hypot(slope, 1); Na[o] = -ca * slope / nl; Na[o + 1] = 1 / nl; Na[o + 2] = -sa * slope / nl;
        // colour: the sea at the rim, darkening to a black-blue core; foam arms spiral in and spin faster near the middle
        waterCol(clamp(x0 + ca * r - laneX(z0), -hw - 1, hw + 60), z0 + sa * r, t, hw, tmpV);
        mix(tmpF, 0, tmpV, CORE, Math.pow(1 - q, 1.1));
        const arm = Math.sin(4 * a - 7.5 * Math.log(q + 0.08) + t * (3 + 5 * (1 - q)));
        const foam = Math.max(smooth(0.25, 0.85, arm) * smooth(0.05, 0.35, q) * (1 - smooth(0.9, 1, q)), lip * (0.75 + 0.25 * Math.sin(a * 9 - t * 6)));
        mix(Ca, o, tmpF, C.foam, foam);
      }
    }
    whirlGeo.attributes.position.needsUpdate = true; whirlGeo.attributes.normal.needsUpdate = true; whirlGeo.attributes.color.needsUpdate = true;
  }
  let whirl = null, nextWhirlD = 0;
  function placeWhirl(z, u) {
    whirl = { z, u, warned: false };
    whirlG.visible = false;
    // a line of coins curving in, and the waves kept away from it
    for (let i = 0; i < 8; i++) E.coins.push({ z: z + 30 - i * 3.4, u: u * (i / 7) + Math.sin(i * 0.8) * 0.6, lift: 0.8 });
  }
  function updateWhirl(dt) {
    if (!whirl) { whirlG.visible = false; return; }
    const P = E.P, cz = E.camera.position.z;
    if (whirl.z > cz + 8) { whirl = null; whirlG.visible = false; return; }
    const ahead = P.z - whirl.z;
    whirlG.visible = ahead < 95;
    whirlG.position.set(laneX(whirl.z) + whirl.u, base(whirl.z), whirl.z);
    whirlG.rotation.set(-Math.atan(SLOPE), 0, 0);
    if (whirlG.visible) drawWhirl(E.S.t, whirlG.position.x, whirl.z, laneHW(whirl.z));
    if (whirlG.visible) for (let n = dt * 110; n > Math.random(); n--) {   // spray whipped off the lip, circling and falling inwards
      const a = Math.random() * TAU, r = WR * rand(0.72, 0.86), x = whirlG.position.x + Math.cos(a) * r, z = whirl.z + Math.sin(a) * r;
      E.emit(x, base(z) + 0.3, z, -Math.sin(a) * 6 - Math.cos(a) * 2, rand(1.5, 4), Math.cos(a) * 6 - Math.sin(a) * 2, rand(0.07, 0.15), 0.8, C.sprayHex, 6);
    }
    if (E.S.state !== 'ride') return;
    if (!whirl.warned && ahead < 75) { whirl.warned = true; E.banner('Whirlpool', 'Ride in for double points'); E.Sfx.tone(196, 0.8, 'sine', 0.1, 392); }
    // it drags you in when you get close, and swallows you at the middle
    const du = whirl.u - P.u, dz = whirl.z - P.z;
    if (!P.air && Math.abs(dz) < 12 && Math.abs(du) < 9) P.u += clamp(du, -1, 1) * dt * 7 * (1 - Math.abs(dz) / 12);
    if (!P.air && Math.hypot(du, dz) < 3) { E.suckIn(whirl.u, whirl.z); whirl = null; }
  }

  // ---------- what turns up ahead ----------
  let nextChop = 0, nextBarrelD = 0, tube = null, high = false;
  function addChop(zm, d) {
    const hw = laneHW(zm), hard = clamp(d / 2500, 0, 1), lagoon = !!E.S.bonus;
    const w = lagoon ? 2 * hw : rand(4.5, 7.5), uc = lagoon ? 0 : rand(-0.65, 0.7) * hw;
    const h = lagoon ? rand(2.8, 3.4) : rand(1.7, 2.3) + hard * 0.6;
    return E.addRamp(zm, { kind: 'chop', wv: 0, LF: 5.5, LB: 3.5, p: 1.4, h, ua: uc - w / 2, ub: uc + w / 2, fade: 1.6, ring: lagoon, seed: rand(0, 50) });
  }
  function spawn(z, d) {
    const hw = laneHW(z), hard = clamp(d / 2500, 0, 1);
    // a barrel: the lip throws over the top of the face for a stretch; nothing in the way inside, coins down the tube
    if (!E.S.bonus && d > nextBarrelD && !E.ramps.some(r => r.zm < z + 25 && r.zm > z - 140)) {
      const len = rand(80, 130);
      barrels.push({ za: z, zb: z - len, warned: false });
      for (let i = 0; i < len / 4 - 6; i++) E.coins.push({ z: z - 20 - i * 4, u: -hw + 3.2 + Math.sin(i * 0.5) * 0.8, lift: 0.9 });
      nextBarrelD = d + len + rand(260, 460); nextChop = Math.min(nextChop, z - len - 20);
      return len + 10;
    }
    if (z <= nextChop) {
      const gap = addChop(z, d);
      nextChop = z - gap - rand(Math.max(10, 30 - d * 0.006), Math.max(22, 55 - d * 0.01));
      return gap;
    }
    if (d < 50) { E.coinLine(z, rand(-0.3, 0.3) * hw, 1.5, 5); return 16; }
    // a whirlpool in the flat water at the foot of the wave
    if (!E.S.bonus && !whirl && d > nextWhirlD) {
      placeWhirl(z, hw + 4);
      nextWhirlD = d + rand(1000, 1400);
      return 30;
    }
    if (E.S.bonus && Math.random() < 0.55) {   // the lagoon: coins everywhere, fewer things in the way
      E.coinLine(z, rand(-0.6, 0.6) * hw, rand(1, 3), 9);
      return rand(16, 22);
    }
    const busy = 0.6 + 0.33 * hard;
    if (Math.random() > busy) {
      if (Math.random() < 0.45) {   // coins up over the lip: carve up and launch for them
        for (let i = 0; i < 6; i++) { const a = Math.sin(i / 5 * Math.PI); E.coins.push({ z: z - i * 3, u: -hw + 0.4 - a * 0.6, lift: 1.4 + a * 3.2 }); }
      } else E.coinLine(z, rand(-0.6, 0.6) * hw, rand(1, 3));
      return rand(16, 22);
    }
    const k = Math.random(), side = () => (Math.random() < 0.5 ? -1 : 1);
    if (k < 0.2) {   // a reef breaking the surface low on the face, with one way through
      const lanes = [-0.2, 0.15, 0.45, 0.75, 1.05], free = (Math.random() * lanes.length) | 0;
      lanes.filter((_, i) => i !== free).sort(() => Math.random() - 0.5).slice(0, 2 + Math.round(hard * 2)).forEach(f => E.addThing('rock', z - rand(-2, 2), f * hw + rand(-0.4, 0.4), { r: rand(0.75, 1.15) }));
      E.coinLine(z - 6, lanes[free] * hw, 0.2, 4);
    } else if (k < 0.42 && d > 80) {   // sharks cruising along the face
      for (let i = 0, n = 1 + Math.round(hard * 2); i < n; i++) E.addThing('shark', z - i * 11, rand(-0.7, 0.8) * hw, { vu: side() * rand(3, 4 + 2.5 * hard), vz: rand(1.5, 3.5) });
    } else if (k < 0.56) {   // a bloom of jellyfish
      for (let i = 0, n = 4 + Math.round(hard * 4) + (Math.random() * 3 | 0); i < n; i++) E.addThing('jelly', z - i * rand(2.5, 4.5), rand(-0.85, 0.9) * hw, { vu: rand(-1.2, 1.2), vz: rand(0, 0.8) });
    } else if (k < 0.68) {   // buoys across the bottom of the face
      const n = 3 + Math.round(hard * 2), gap = (1.4 * hw) / n, off = rand(0, gap), skip = (Math.random() * n) | 0;
      for (let i = 0; i < n; i++) if (i !== skip) E.addThing('buoy', z, -0.2 * hw + off + i * gap);
    } else if (k < 0.86) {   // surfers paddling out over the wave
      for (let i = 0, n = 1 + Math.round(hard * 2); i < n; i++) E.addThing('kook', z - i * 7, rand(-0.6, 0.8) * hw);
    } else {
      for (let i = 0, n = 1 + Math.round(hard); i < n; i++) E.addThing('turtle', z - i * 9, rand(-0.4, 0.8) * hw, { vu: rand(-1.5, 1.5), vz: rand(0.5, 1.2) });
    }
    return rand(18, 27) * (1 - 0.3 * hard);
  }
  // the barrel: inside it you score for every second; up under the lip there's no room
  function updateTube(dt) {
    const P = E.P, hw = laneHW(P.z), k = barrelK(P.z);
    for (const b of barrels) if (!b.warned && P.z - b.za < 80 && P.z > b.za) { b.warned = true; E.banner('Barrel', 'Stay up the face, under the lip'); E.Sfx.tone(262, 0.7, 'triangle', 0.1, 392); }
    while (barrels.length && barrels[0].zb > E.camera.position.z + 20) barrels.shift();
    if (E.S.state !== 'ride') { tube = null; return; }
    if (k > 0.5 && P.u < -hw + 1.4) {   // the lip is right overhead: no launching out of a barrel
      P.u = -hw + 1.4; P.lat = Math.max(0, P.lat); P.heading = Math.max(0, P.heading);
      if (!high) { high = true; E.pop('Too high!', 0, 'warn'); }
    } else high = false;
    const inside = k > 0.6 && !P.air && P.u < -hw + tubeReach(P.z) * 0.85;
    if (inside) {
      if (!tube) { tube = { t: 0 }; E.pop('In the barrel!', 0, 'big'); E.Sfx.noise(0.8, 0.25, 600); }
      tube.t += dt;
      if (Math.random() < dt * 25) { const z = P.z - rand(2, 8), u = -hw + rand(1, tubeReach(z)); E.emit(laneX(z) + u, groundH(u, z) + rand(1, 4), z, rand(-0.5, 0.5), rand(-0.5, 0.5), rand(2, 5), rand(0.05, 0.1), 0.8, C.sprayHex, 0); }
    } else if (tube) {
      if (tube.t > 0.4) E.trick(`Barrel ${tube.t.toFixed(1)} s`, Math.round(300 + tube.t * 700), 'big');
      tube = null;
    }
  }

  const kit = {
    id: 'surf', saveKey: 'surf', yawUnit: Math.PI, grab: 'Indy', under: true, sink: 0.3,
    tune: { SLOPE },
    laneX, laneHW, themes: THEMES, KIND, camSide: 3, camFollow: 0.95,
    pickTheme: () => (Math.random() * 3) | 0,
    bonus: { name: 'Whirlpool', theme: 3, len: 650, fade: '#0b5f7a', back: 'Back on the wave' },
    ambience: { type: 'lowpass', freq: [350, 1150], level: [0.07, 0.19] },
    copy: {
      drop: ['Drop in', 'Carve up to the lip to launch'],
      hintsTouch: [[0.6, 'Drag your left thumb to carve. Down the wave is faster'], [4, 'Carve up to the top of the wave to launch off the lip'], [10, 'In the air, push the stick up or down to flip, across to spin'], [17, 'Tap the button to jump. Hold it in the air to grab']],
      hintsKeys: [[0.6, '<kbd>←</kbd> <kbd>→</kbd> to carve. Down the wave is faster'], [4, 'Carve <kbd>←</kbd> up to the top of the wave to launch off the lip'], [10, 'In the air, <kbd>↑</kbd> <kbd>↓</kbd> flip and <kbd>←</kbd> <kbd>→</kbd> spin. Let go to land straight'], [17, '<kbd>Space</kbd> jumps. Hold it in the air to grab']],
    },
    baseH: groundH,
    rampE(r, u) { return smooth(r.ua - r.fade, r.ua, u) * (1 - smooth(r.ub, r.ub + r.fade, u)); },
    edge(u, z, hw) { return u > hw + 6 ? OFF_EDGE : null; },
    uLimit: hw => [-hw - 0.4, hw + 16],
    // down the face is faster, up it is slower, like a real wave
    speedK: P => 1 + 0.1 * Math.sin(P.heading),
    // carve over the crest and the wave throws you up, and back towards the face
    onTakeoff(e, r) {
      const P = e.P, hw = laneHW(P.z);
      if (r || P.u > -hw + 1.3 || P.lat > -3) return;
      P.vy = Math.max(P.vy, 8.5 + P.v * 0.13); P.lat = 3.2; P.launches++;
      e.Sfx.noise(0.4, 0.3, 1500, 'highpass');
      e.burst(P.wx, P.wy + 0.4, P.wz, 30, 3, 5, 0.14, 0.8, C.sprayHex);
    },
    makeRider, pose: poseRider,
    sfxLaunch: Sfx => Sfx.noise(0.35, 0.3, 1400, 'highpass'),
    build(e) {
      E = e;
      e.scene.add(sea, sand, swash, lip);
      for (let i = 0; i < CMAX; i++) { const m = new THREE.Mesh(grid(CROWS, CCOLS), chopMat); m.frustumCulled = false; m.visible = false; e.scene.add(m); chopPool.push(m); }
      whale.visible = false; e.scene.add(whale);
      for (const g of farOut) e.scene.add(g);
      e.scene.add(whirlG);
      e.placeWhirl = placeWhirl; e.barrels = barrels;
    },
    applyTheme(th) {
      T = th;
      C = { shallow: rgb(th.shallow), water: rgb(th.water), deep: rgb(th.deep), trough: rgb(th.deep).map(v => v * 0.6), face: rgb(th.face), glow: rgb(th.glow), foam: rgb(th.foam),
        sand: rgb(th.sand), wet: rgb(th.wet), green: rgb(th.green), sprayHex: rgb(th.spray), glowK: th.night ? 0.75 : 0.6 };
      for (const mtl of [seaMat, lipMat, chopMat]) { mtl.specular.setHex(th.spec).multiplyScalar(0.6); mtl.emissive.setHex(th.emissive ?? 0); }
      sandMat.emissive.setHex(th.night ? 0x0a0a20 : 0);
      white.color.setHex(th.foam); white.emissive.setHex(th.night ? th.foam : 0).multiplyScalar(0.35);
      trunkMat.color.setHex(th.trunk); leafMat.color.setHex(th.leaf);
      sailMat.color.setHex(th.night ? 0x8a8aa8 : 0xffffff); islandMat.color.setHex(th.leaf); islandSand.color.setHex(th.sand);
      jellyMat.emissive.setHex(th.night ? 0xa03a90 : 0x7a2a6a);
      buildProps();
    },
    // a new run starts the schedule over; coming out of the lagoon (or into it) carries on from here
    reset() {
      const P = E.P, fresh = P.z0 - P.z < 5;
      nextChop = P.z - (fresh ? 60 : 40); whirl = null; whirlG.visible = false; barrels.length = 0; tube = null; high = false;
      if (fresh) { nextBarrelD = rand(220, 320); nextWhirlD = rand(500, 700); breach.next = rand(10, 18); }
      breach.on = false; whale.visible = false;
    },
    spawn,
    rampOn(r) { r.mesh = chopPool.pop() || null; if (r.mesh) r.mesh.visible = true; },
    rampOff(r) { if (r.mesh) { r.mesh.visible = false; chopPool.push(r.mesh); r.mesh = null; } },
    drawRamp(r, t) { drawChop(r, t); },
    updateGround: (zc, t) => { updateGround(zc, t); updateLip(zc, t); },
    updateScenery: (zc, reset, dt) => updateScenery(zc, reset, dt),
    update(dt, focus) {
      // spray blowing back off the lip
      for (let n = dt * 30; n > Math.random(); n--) {
        const z = focus - rand(-5, 70), hw = laneHW(z), c = curl(z), th = lerp(Math.PI, c.end, rand(0.3, 1));
        const u = -hw + c.rx + c.rx * Math.cos(th);
        E.emit(laneX(z) + u, base(z) + FACE_H + c.ry * Math.sin(th) + 0.2, z, rand(-2.5, -0.5), rand(1, 3), rand(-1, 1), rand(0.06, 0.13), 0.9, C.sprayHex, 7);
      }
      updateBreach(dt, focus);
      updateWhirl(dt);
      updateTube(dt);
      // the lagoon glows: plankton drifting up around you
      if (T.id === 'lagoon') {
        const cam = E.camera.position;
        for (let i = 0, n = dt * 45; i < n; i++) {
          const z = cam.z - rand(22, 110), u = rand(-10, 40);
          E.emit(laneX(z) + u, groundH(u, z) + rand(0.2, 5), z, rand(-0.3, 0.3), rand(0.2, 0.8), rand(-0.3, 0.3), rand(0.05, 0.09), rand(2, 3.5), pick(PLANKTON), -0.05);
        }
      }
    },
  };
  const PLANKTON = [rgb(0x9dfff0), rgb(0x7cf3ff), rgb(0xffa8e0), rgb(0xfff2a8)];
  const OFF_EDGE = { slow: 0.45, msg: 'Off the wave!' };
  return createRideMode(host, kit);
}
