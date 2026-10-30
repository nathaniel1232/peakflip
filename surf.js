// ============================================================
//  PEAK SURF: ride down the beach break, launch off the waves
// ============================================================
// A kit for the ride engine (ride.js). The beach is on your left; on your right the ocean runs out to the horizon.
// Waves roll up the slope at you and break onto the sand. Ride into one and it throws you in the air.
// In the water: rocks, sharks, swimming jellyfish, turtles, buoys and other surfers. Now and then a whale surfaces
// in the lane (ride up its back) or breaches out at sea.
import * as THREE from './lib/three.module.min.js';
import { equipped } from './meta.js';
import { createRideMode, lerp, clamp, rand, smooth, hash, TAU, rgb, wrap, pick, lam, unitBox, mix, put3, grid, place, knee } from './ride.js';

const SLOPE = 0.2;
const WV = 7;   // how fast the waves roll up the slope at you
// the water winds a little and gets wider and narrower as you go
const laneX = z => 5 * Math.sin(z * 0.006) + 2 * Math.sin(z * 0.017 + 1);
const laneHW = z => 11 + 2 * Math.sin(z * 0.009 + 0.5);
const base = z => z * SLOPE;
// the beach: a wet strip at the water's edge, then dunes rising away from it
function sandH(o, z) {
  return 0.3 * smooth(0, 1.5, o) + 1.0 * smooth(2, 12, o) + 0.03 * o + 1.6 * smooth(10, 30, o) * (0.5 + 0.5 * Math.sin(z * 0.045 + 2.1 + o * 0.15)) + 2.5 * smooth(40, 70, o);
}

// ---------- conditions ----------
const THEMES = [
  { id: 'noon', name: 'Tropic noon', sky: [0x2b86e8, 0x8fd3ff, 0xe6f8ff], fog: 0xd2f0ff, sun: [0.3, 0.8, -0.5], sunCol: 0xfff3d1, light: 1.8, skySun: [0.25, 0.55, -0.8],
    hemi: [0xe8f7ff, 0x8a7a5a, 1.25], shallow: 0x3fd6cf, water: 0x139dbc, deep: 0x0a5f93, face: 0x1bb5c8, glow: 0x7cf2e4, foam: 0xffffff, spray: 0xffffff,
    sand: 0xf1d8a5, wet: 0xc79f68, green: 0x4c9a45, leaf: 0x3f9a46, trunk: 0x8a6a45, cloud: 0xffffff, spec: 0x6a8a99 },
  { id: 'gold', name: 'Golden hour', sky: [0x4d4aa6, 0xff9168, 0xffe2a8], fog: 0xffcf9e, sun: [-0.15, 0.3, -1], sunCol: 0xffbd73, light: 1.5, skySun: [-0.15, 0.12, -1],
    hemi: [0xffd9b8, 0x6a4a50, 1.4], shallow: 0x58b9b0, water: 0x2a7f9c, deep: 0x1d4c74, face: 0x2f8aa0, glow: 0xffc98a, foam: 0xfff3e2, spray: 0xfff1da,
    sand: 0xe9b98a, wet: 0xa9785a, green: 0x5a7a3a, leaf: 0x4c7a3a, trunk: 0x6a4a35, cloud: 0xffb08c, spec: 0xffb070 },
  { id: 'night', name: 'Glow night', night: true, sky: [0x05031f, 0x221058, 0x5a2a8c], fog: 0x2a1662, sun: [0.35, 0.42, -1], sunCol: 0xd8e0ff, light: 0.8,
    hemi: [0x7466d8, 0x0a0c2e, 1.05], shallow: 0x1a7aa8, water: 0x0a4a88, deep: 0x06205a, face: 0x0d5c9c, glow: 0x19e3ff, foam: 0xb6fcff, spray: 0x9cf8ff,
    sand: 0x5a5a8e, wet: 0x34366a, green: 0x23395a, leaf: 0x1c4a5a, trunk: 0x2e2848, cloud: 0x3a2e7c, spec: 0x8899ff, emissive: 0x0a1c44 },
  // through the whirlpool: a glowing lagoon at dusk, worth double points (never picked for a normal run)
  { id: 'lagoon', name: 'Whirlpool lagoon', night: true, moon: 0xd8fff8, discScale: 1.2, sky: [0x041a2e, 0x0d5a72, 0x46d8c4], fog: 0x0f5262, fogFar: 300,
    sun: [0.25, 0.7, -0.6], skySun: [0.3, 0.3, -1], sunCol: 0xc8fff6, light: 1.15, hemi: [0x9ffcff, 0x10283e, 1.25],
    shallow: 0x36f0d4, water: 0x0bb0be, deep: 0x075478, face: 0x18ccd2, glow: 0xb4fff2, foam: 0xf0fffc, spray: 0xd8fff8,
    sand: 0xd6c8f0, wet: 0x8a78b4, green: 0x2a6a72, leaf: 0x34b48e, trunk: 0x5a4a7a, cloud: 0x2a6a7a, spec: 0xb0ffff, emissive: 0x05303c },
];

// ---------- the surfer ----------
const skinMat = lam(0xf0c49a), hairMat = lam(0x3a2716), finMat = lam(0x1f2a36), white = lam(0xffffff);
function boardGeo(len = 2.05, wid = 0.54) {
  const g = new THREE.BoxGeometry(len, 0.08, wid, 10, 1, 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / (len / 2), wk = u > 0 ? 1 - Math.pow(u, 2.2) * 0.82 : 1 - Math.pow(-u, 3) * 0.45;
    p.setZ(i, p.getZ(i) * wk); p.setY(i, p.getY(i) + (u > 0.55 ? (u - 0.55) * 0.16 : 0) + (u < -0.8 ? (-u - 0.8) * 0.06 : 0));
  }
  g.computeVertexNormals(); return g;
}
function makeRider() {
  const o = equipped('outfit'), jacket = lam(new THREE.Color(o.jacket || '#e94f37').getHex()), pants = lam(new THREE.Color(o.pants || '#2d3142').getHex()), accent = lam(new THREE.Color(o.helmet || '#ffffff').getHex());
  const root = new THREE.Group(), gear = new THREE.Group();
  const board = new THREE.Mesh(boardGeo(), new THREE.MeshLambertMaterial({ color: 0xfff6e6 })); gear.add(board);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.012, 0.07), jacket); stripe.position.y = 0.046; gear.add(stripe);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.012, 0.03), accent); rail.position.set(-0.05, 0.047, 0.12); gear.add(rail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.03), finMat); fin.position.set(-0.82, -0.12, 0); fin.rotation.z = -0.3; gear.add(fin);
  root.add(gear);
  const body = new THREE.Group(); root.add(body);
  const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); body.add(m); return m; };
  const r = {
    root, gear, body,
    thighF: mk(unitBox(0.15, 0.17), pants), thighB: mk(unitBox(0.15, 0.17), pants),
    shinF: mk(unitBox(0.11, 0.12), skinMat), shinB: mk(unitBox(0.11, 0.12), skinMat),
    torso: mk(new THREE.BoxGeometry(0.4, 0.58, 0.23).translate(0, 0.29, 0), jacket),
    shorts: mk(new THREE.BoxGeometry(0.38, 0.22, 0.26).translate(0, 0.02, 0), pants),
    upF: mk(unitBox(0.11, 0.11), jacket), upB: mk(unitBox(0.11, 0.11), jacket),
    loF: mk(unitBox(0.09, 0.09), skinMat), loB: mk(unitBox(0.09, 0.09), skinMat),
    head: mk(new THREE.BoxGeometry(0.25, 0.27, 0.25).translate(0, 0.13, 0), skinMat),
  };
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.28), hairMat); hair.position.y = 0.28; r.head.add(hair);
  const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.08, 0.06), hairMat); fringe.position.set(0, 0.22, 0.12); r.head.add(fringe);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.05, 0.27), accent); band.position.y = 0.2; r.head.add(band);
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.01), finMat); eyes.position.set(0, 0.15, 0.126); r.head.add(eyes);
  return r;
}
const V = () => new THREE.Vector3();
const J = { hip: V(), hipF: V(), hipB: V(), footF: V(), footB: V(), kneeF: V(), kneeB: V(), chest: V(), shF: V(), shB: V(), hF: V(), hB: V(), elF: V(), elB: V(), dir: V(), bend: V() };
const _Y = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
// pose in board space: X along the board (nose forward), Y off the deck, Z the way the rider faces
function poseRider(r, pose, t) {
  const c = pose.crouch, lean = pose.lean, tb = lean + 0.45 * c + pose.bend;
  const hipH = 0.92 - 0.36 * c;
  J.hip.set(-0.02, hipH * Math.cos(lean), hipH * Math.sin(lean) - 0.08 * c);
  J.footF.set(0.36, 0.05, 0.02); J.footB.set(-0.38, 0.05, 0);
  J.hipF.copy(J.hip).x += 0.09; J.hipB.copy(J.hip).x -= 0.09;
  J.bend.set(0.12, 0, 1).normalize();
  knee(J.hipF, J.footF, 0.47, J.bend, J.kneeF); J.bend.x = -0.12; knee(J.hipB, J.footB, 0.47, J.bend, J.kneeB);
  place(r.thighF, J.hipF, J.kneeF); place(r.shinF, J.kneeF, J.footF); place(r.thighB, J.hipB, J.kneeB); place(r.shinB, J.kneeB, J.footB);
  J.dir.set(0, Math.cos(tb), Math.sin(tb));
  _q.setFromUnitVectors(_Y, J.dir); _q2.setFromAxisAngle(_Y, 0.5); _q.multiply(_q2);
  r.torso.position.copy(J.hip); r.torso.quaternion.copy(_q);
  r.shorts.position.copy(J.hip); r.shorts.quaternion.copy(_q);
  J.chest.copy(J.hip).addScaledVector(J.dir, 0.56);
  r.head.position.copy(J.chest).addScaledVector(J.dir, 0.06);
  _q2.setFromAxisAngle(_Y, pose.mode === 'wipe' ? Math.sin(t * 9) : 0.75); r.head.quaternion.copy(_q).multiply(_q2);
  J.shF.copy(J.chest).x += 0.2; J.shB.copy(J.chest).x -= 0.2;
  const a = pose.arm, m = pose.mode;
  if (m === 'grab') {
    J.hF.set(0.2, 0.08, 0.27); J.hB.set(-0.75, J.chest.y + 0.35, 0.1);
  } else if (m === 'tuck') {
    J.hF.set(0.25, J.chest.y - 0.35, 0.32); J.hB.set(-0.2, J.chest.y - 0.4, 0.32);   // hugging the knees through a flip
  } else if (m === 'wipe') {
    J.hF.set(0.5, J.chest.y + 0.5 + Math.sin(t * 13) * 0.3, 0.2); J.hB.set(-0.5, J.chest.y + 0.5 + Math.cos(t * 11) * 0.3, -0.2);
  } else {
    J.hF.set(0.72 + a * 0.1, J.chest.y - 0.18 + Math.sin(t * 2.2) * 0.04 + a * 0.25, 0.32);
    J.hB.set(-0.62, J.chest.y - 0.3 - a * 0.1, 0.12 + a * 0.2);
  }
  J.bend.set(0, -0.6, 0.8).normalize();
  knee(J.shF, J.hF, 0.33, J.bend, J.elF); knee(J.shB, J.hB, 0.33, J.bend, J.elB);
  place(r.upF, J.shF, J.elF); place(r.loF, J.elF, J.hF); place(r.upB, J.shB, J.elB); place(r.loB, J.elB, J.hB);
}

// ---------- shared models ----------
export function createSurf(host) {
  // ---------- materials the themes recolour ----------
  const waterMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x6a8a99, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 3 });
  const sandMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const swashMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const waveMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 55, specular: 0x6a8a99, side: THREE.DoubleSide });
  // light shines through a wave's face, so part of its colour glows even with the sun behind it
  const glowFace = { value: 0.42 };
  waveMat.onBeforeCompile = sh => {
    sh.uniforms.glowFace = glowFace;
    sh.fragmentShader = 'uniform float glowFace;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * glowFace;');
  };
  const trunkMat = lam(0x8a6a45), leafMat = lam(0x3fa34d), nutMat = lam(0x5a3a1e), rockMat = lam(0x3b342f), barnMat = lam(0x5d5146);
  const sharkMat = lam(0x55657a), sharkBelly = lam(0xd9dde2), whaleMat = lam(0x2f3d55), whaleBelly = lam(0xc9d2dc);
  const jellyMat = new THREE.MeshLambertMaterial({ color: 0xff8ad0, emissive: 0x7a2a6a, transparent: true, opacity: 0.78 });
  const jellyCore = new THREE.MeshBasicMaterial({ color: 0xffd0f0 });
  const shellMat = lam(0x5a7a3a), turtleSkin = lam(0x8fbf6a), buoyRed = lam(0xff4b3e);
  let C = {}, T = THEMES[0];
  const tmpA = [0, 0, 0], tmpB = [0, 0, 0], tmpW = [0, 0, 0];
  let E;   // the engine, once it's built

  // ---------- the ground: sand on the left, water across the lane and out to sea on the right ----------
  const DZ = 2, NR = 160;
  const SAND = [0, 0.7, 2, 4, 7, 11, 17, 26, 40, 56, 75, 100];
  const OCEAN = [1.5, 4, 8, 14, 22, 34, 52, 80, 120, 180, 260, 380];
  const NW = 26, WC = NW + OCEAN.length;
  const water = new THREE.Mesh(grid(NR, WC), waterMat), sand = new THREE.Mesh(grid(NR, SAND.length), sandMat), swash = new THREE.Mesh(grid(NR, 6), swashMat);
  for (const m of [water, sand, swash]) m.frustumCulled = false;
  // the colour of the open water at a spot: pale green-blue in the shallows, deep blue out to sea, swells rolling through
  function waterCol(u, z, t, hw, out) {
    mix(out, 0, C.shallow, C.water, smooth(-hw + 0.5, -hw + 9, u));
    mix(out, 0, out, C.deep, smooth(hw - 3, hw + 60, u));
    const sw = 0.5 + 0.5 * Math.sin((z - t * WV) * 0.3 + u * 0.04);
    mix(out, 0, out, C.face, sw * 0.18 * (1 - smooth(hw, hw + 80, u)));
    return out;
  }
  function updateGround(zc, t) {
    const z0 = Math.ceil((zc + 30) / DZ) * DZ;
    const WP = water.geometry.attributes.position.array, WCo = water.geometry.attributes.color.array, WN = water.geometry.attributes.normal.array;
    const SP = sand.geometry.attributes.position.array, SC = sand.geometry.attributes.color.array, SN = SAND.length;
    const FP = swash.geometry.attributes.position.array, FC = swash.geometry.attributes.color.array;
    for (let i = 0; i < NR; i++) {
      const z = z0 - i * DZ, hw = laneHW(z), cx = laneX(z), b = base(z), row = Math.round(z / DZ);
      // water: flat, with small ripples in the normals so the sun glints off it
      for (let j = 0; j < WC; j++) {
        const k = (i * WC + WC - 1 - j) * 3;   // stored right to left, so the triangles face up
        const u = j < NW ? -hw - 1.5 + (2 * hw + 1.5) * j / (NW - 1) : hw + OCEAN[j - NW], x = cx + u;
        WP[k] = x; WP[k + 1] = b; WP[k + 2] = z;
        const a = 0.9 * x + 0.7 * z - 1.7 * t, c = -0.6 * x + 1.3 * z - 2.3 * t, f = 2.2 / (1 + Math.max(0, u - hw) / 15);
        const hx = (0.036 * Math.cos(a) - 0.018 * Math.cos(c)) * f, hz = (0.028 * Math.cos(a) + 0.039 * Math.cos(c)) * f;
        const nx = -hx, ny = 1, nz = -(SLOPE + hz), nl = Math.hypot(nx, ny, nz);
        WN[k] = nx / nl; WN[k + 1] = ny / nl; WN[k + 2] = nz / nl;
        waterCol(u, z, t, hw, tmpA); put3(WCo, k, tmpA, 0.97 + 0.05 * hash(row * 31 + j));
      }
      // sand: wet at the waterline, dry dunes, then the jungle behind the beach
      for (let j = 0, k = i * SN * 3; j < SN; j++, k += 3) {
        const o = SAND[j], hs = hash(row * 17 + j);
        SP[k] = cx - hw - o; SP[k + 1] = b + sandH(o, z); SP[k + 2] = z;
        mix(tmpA, 0, C.wet, C.sand, smooth(0.5, 3.5, o)); mix(tmpA, 0, tmpA, C.green, smooth(45, 70, o));
        put3(SC, k, tmpA, 0.93 + 0.1 * hs);
      }
      // the swash: each wave runs up the sand and slides back, leaving a lacy line of foam
      const reach = 0.6 + 2.4 * (0.5 + 0.5 * Math.sin(t * 0.85 + z * 0.045)) * (0.6 + 0.4 * Math.sin(z * 0.13 + 1.7));
      const cols = [-hw + 3, -hw + 1, -hw - reach + 0.9, -hw - reach + 0.35, -hw - reach, -hw - reach - 0.6];
      for (let j = 0, k = i * 6 * 3; j < 6; j++, k += 3) {
        const u = cols[j], o = Math.max(0, -u - hw), lace = 0.55 + 0.45 * hash(row * 7 + j);
        FP[k] = cx + u; FP[k + 1] = b + (u > -hw ? 0 : sandH(o, z)) + 0.035; FP[k + 2] = z;
        waterCol(u, z, t, hw, tmpW);
        if (j === 0) put3(FC, k, tmpW);
        else if (j === 1) { mix(tmpA, 0, tmpW, C.foam, 0.25 * lace); put3(FC, k, tmpA); }
        else if (j === 2) { mix(tmpA, 0, C.shallow, C.foam, 0.55 * lace); put3(FC, k, tmpA); }
        else if (j === 3) { mix(tmpA, 0, C.wet, C.foam, 0.9 * lace); put3(FC, k, tmpA); }
        else if (j === 4) { mix(tmpA, 0, C.wet, C.foam, 0.35); put3(FC, k, tmpA); }
        else put3(FC, k, C.wet, 0.97);
      }
    }
    water.geometry.attributes.position.needsUpdate = true; water.geometry.attributes.color.needsUpdate = true; water.geometry.attributes.normal.needsUpdate = true;
    sand.geometry.attributes.position.needsUpdate = true; sand.geometry.attributes.color.needsUpdate = true; sand.geometry.computeVertexNormals();
    swash.geometry.attributes.position.needsUpdate = true; swash.geometry.attributes.color.needsUpdate = true; swash.geometry.computeVertexNormals();
  }

  // ---------- waves: each its own smooth mesh, so the crest stays sharp as it moves ----------
  const FACE = [1, 0.82, 0.66, 0.52, 0.4, 0.3, 0.21, 0.14, 0.085, 0.045, 0.018, 0], BACK = [0.05, 0.12, 0.21, 0.32, 0.45, 0.6, 0.78, 1];
  const WROWS = FACE.length + BACK.length, WCOLS = 42, WMAX = 10;
  const meshPool = [];
  const waveF = (r, dz) => dz >= 0 ? (dz < r.LF ? Math.pow(1 - dz / r.LF, r.p) : 0) : (dz > -r.LB ? 0.5 + 0.5 * Math.cos(Math.PI * dz / r.LB) : 0);
  const us = new Float32Array(WCOLS);
  function drawWave(r, t) {
    const m = r.mesh; if (!m) return;
    const Pa = m.geometry.attributes.position.array, Ca = m.geometry.attributes.color.array, amp = E.rampAmp(r);
    for (let i = 0; i < WROWS; i++) {
      const face = i < FACE.length, dz = face ? FACE[i] * r.LF : -BACK[i - FACE.length] * r.LB;
      const z = r.z + dz, hw = laneHW(z), cx = laneX(z), b = base(z), f = waveF(r, dz);
      // columns: dense across the lane, then spreading out over the open sea
      const u0 = Math.max(-hw - 1.5, r.ua - 3), u1 = Math.min(hw + 50, r.ub + 3);
      if (u1 > hw + 2) { for (let j = 0; j < 32; j++) us[j] = lerp(u0, hw, j / 31); for (let j = 32; j < WCOLS; j++) us[j] = lerp(hw, u1, Math.pow((j - 31) / (WCOLS - 32), 1.4)); }
      else for (let j = 0; j < WCOLS; j++) us[j] = lerp(u0, u1, j / (WCOLS - 1));
      for (let j = 0, k = i * WCOLS * 3; j < WCOLS; j++, k += 3) {
        const u = us[j], e = E.rampE(r, u, hw), h = amp * e;
        // the lip pitches forward over the face near the top: that's the curl
        const lip = face ? smooth(0.62, 1, f) * smooth(0.25, 0.8, e) * Math.min(1, amp / 3) : 0;
        Pa[k] = cx + u; Pa[k + 1] = b + h * f + 0.04 + lip * 0.12; Pa[k + 2] = z + lip * 1.15;
        // deep at the foot, see-through turquoise up the face, foam spilling over the lip and trailing behind
        const n = 0.5 + 0.5 * Math.sin(u * 1.9 + r.seed + t * 1.3) * Math.sin(u * 0.63 - t * 0.7 + r.seed * 2);
        const shore = smooth(-hw + 6, -hw + 0.5, u);   // where it breaks onto the sand it's all whitewater
        if (face) {
          mix(tmpA, 0, C.trough, C.face, smooth(0.03, 0.42, f));
          mix(tmpB, 0, tmpA, C.glow, smooth(0.4, 0.9, f) * C.glowK * (1 - shore));
          mix(tmpA, 0, tmpB, C.foam, Math.max(smooth(0.86, 0.99, f) * (0.55 + 0.45 * n), shore * smooth(0.15, 0.6, f) * (0.6 + 0.4 * n)));
        } else {
          mix(tmpB, 0, C.trough, C.face, f * 0.7);
          const soup = smooth(-r.LB * 0.8, -0.3, dz);
          mix(tmpA, 0, tmpB, C.foam, Math.max(soup * (0.25 + 0.6 * n), shore * 0.7) * 0.9);
        }
        // blend into the water around it where the wave dies away
        waterCol(u, z, t, hw, tmpW);
        mix(tmpB, 0, tmpW, tmpA, smooth(0, 0.3, e * smooth(0, 0.6, amp)));
        put3(Ca, k, tmpB);
      }
    }
    m.geometry.attributes.position.needsUpdate = true; m.geometry.attributes.color.needsUpdate = true;
    m.geometry.computeVertexNormals();
  }

  // ---------- the whale: rises in the lane and you can ride up its back ----------
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
  const whales = [makeWhale(), makeWhale()];   // one for the lane, one breaching out at sea
  function placeLaneWhale(r) {
    const g = r.whale, amp = E.rampAmp(r), mid = r.z + (r.LF - r.LB) / 2, len = (r.LF + r.LB) / 2;
    const u = (r.ua + r.ub) / 2, b = base(mid), x = laneX(mid) + u;
    g.position.set(x, b - 0.35, mid);
    g.userData.body.scale.set(3, amp + 0.35, len * 0.95);
    g.rotation.set(-Math.atan(SLOPE), 0, 0);
    g.userData.tail.position.set(0, 0, -len * 0.9);
    g.userData.tail.rotation.x = Math.sin(E.S.t * 1.6) * 0.25;
    if (Math.random() < 0.012) E.burst(x, b + amp + 0.4, mid + len * 0.45, 30, 0.6, 9, 0.18, 1.2, C.sprayHex, 9);   // blowing
  }
  const breach = { on: false, t: 0, next: 18 };
  function updateBreach(dt, zc) {
    const g = whales[1];
    if (!breach.on) {
      breach.next -= dt;
      if (breach.next <= 0 && E.S.state !== 'results') {
        breach.on = true; breach.t = 0; breach.z = zc - rand(110, 160); breach.u = laneHW(breach.z) + rand(30, 70); breach.dir = Math.random() < 0.5 ? 1 : -1;
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
    rock: { make: o => makeRock(o.r), w: o => o.r + 0.3, clear: 1.7, hit: 'wipe', why: ['Hit a rock', 'Steer round the rocks, or launch over them off a wave'],
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
  const PROPS = () => [[makePalm, 0.44], [makeUmbrella, 0.28], [makeHut, 0.1], [makeTower, 0.07], [makeStuckBoard, 0.11]];
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
  // far out on the right: sailboats and little islands drifting past on the horizon
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
        p.g.rotation.y = p.palm ? rand(-0.5, 0.5) : rand(-0.6, 0.6);
      }
      const hw = laneHW(p.z);
      p.g.position.set(laneX(p.z) - hw - p.off, base(p.z) + sandH(p.off, p.z) - 0.05, p.z);
    });
    for (const g of farOut) {
      const u = g.userData; u.u += u.sp * dt * 0.3;
      const z = zc - u.dz; g.position.set(laneX(z) + laneHW(z) + u.u, base(z) - 0.2, z);
      g.rotation.y = 0.6;
      u.dz -= dt * 2.5;   // drifting slowly closer, then round again
      if (u.dz < 140) u.dz += 520;
    }
  }

  // ---------- the whirlpool: ride into it and it pulls you under, out into the lagoon (double points) ----------
  // It's drawn over the water (a funnel can't cut a hole in it), so the rider, coins and things are drawn after it.
  const swirlTex = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#5fe6ec'); gr.addColorStop(0.35, '#127f9e'); gr.addColorStop(0.75, '#063a5c'); gr.addColorStop(1, '#021626');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {   // foam streaks spiralling down
      const x = i * 512 / 9;
      for (let k = 0; k < 3; k++) {
        g.strokeStyle = `rgba(255,255,255,${0.75 - k * 0.22})`; g.lineWidth = 10 - k * 3;
        g.beginPath(); g.moveTo(x - 512 + k * 6, 0); g.quadraticCurveTo(x - 300, 120, x - 190 + k * 4, 256); g.stroke();
        g.beginPath(); g.moveTo(x + k * 6, 0); g.quadraticCurveTo(x + 212, 120, x + 322 + k * 4, 256); g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.x = 2;
    return t;
  })();
  const whirlG = new THREE.Group();
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 0.25, 2.6, 40, 6, true).translate(0, -1.3, 0),
    new THREE.MeshBasicMaterial({ map: swirlTex, side: THREE.DoubleSide, depthFunc: THREE.AlwaysDepth }));
  funnel.renderOrder = 1; whirlG.add(funnel);
  const rimFoam = new THREE.Mesh(new THREE.TorusGeometry(4.25, 0.22, 6, 40).rotateX(Math.PI / 2), white); rimFoam.position.y = 0.03; whirlG.add(rimFoam);
  whirlG.visible = false;
  let whirl = null, nextWhirlD = 0;
  function placeWhirl(z, u) {
    whirl = { z, u, warned: false };
    whirlG.visible = false;
    // a line of coins curving in, and the waves kept away from it
    for (let i = 0; i < 8; i++) E.coins.push({ z: z + 30 - i * 3.4, u: u * (i / 7) + Math.sin(i * 0.8) * 0.6, lift: 0.8 });
  }
  function updateWhirl(dt) {
    swirlTex.offset.x -= dt * 0.45;
    if (!whirl) { whirlG.visible = false; return; }
    const P = E.P, cz = E.camera.position.z;
    if (whirl.z > cz + 8) { whirl = null; whirlG.visible = false; return; }
    const ahead = P.z - whirl.z;
    whirlG.visible = ahead < 95;
    whirlG.position.set(laneX(whirl.z) + whirl.u, base(whirl.z), whirl.z);
    whirlG.rotation.set(-Math.atan(SLOPE), whirlG.rotation.y - dt * 2.2, 0);
    rimFoam.scale.setScalar(1 + 0.04 * Math.sin(E.S.t * 5));
    if (Math.random() < dt * 30) {   // foam racing round the rim
      const a = Math.random() * TAU, r = 4.1;
      E.emit(whirlG.position.x + Math.cos(a) * r, whirlG.position.y + 0.15, whirl.z + Math.sin(a) * r, -Math.sin(a) * 4, rand(0.5, 1.5), Math.cos(a) * 4, rand(0.08, 0.14), 0.5, C.sprayHex, 4);
    }
    if (E.S.state !== 'ride') return;
    if (!whirl.warned && ahead < 75) { whirl.warned = true; E.banner('Whirlpool', 'Ride in for double points'); E.Sfx.tone(196, 0.8, 'sine', 0.1, 392); }
    // it drags you in when you get close, and swallows you at the middle
    const du = whirl.u - P.u, dz = whirl.z - P.z;
    if (!P.air && Math.abs(dz) < 10 && Math.abs(du) < 8) P.u += clamp(du, -1, 1) * dt * 6 * (1 - Math.abs(dz) / 10);
    if (!P.air && Math.hypot(du, dz) < 2.8) { E.suckIn(whirl.u, whirl.z); whirl = null; }
  }

  // ---------- what turns up ahead ----------
  let nextWave = 0, nextWhaleD = 0;
  function addWave(zm, d, intro) {
    const hw = laneHW(zm), r = Math.random();
    let ua = -99, ub = 99, h = rand(3.1, 3.7), big = false;
    if (!intro && d > 400 && r < 0.14) { h = rand(4.6, 5.2); big = true; }
    else if (!intro && d > 150 && r < 0.4) {   // only part of the way across: ride into it or go round
      if (Math.random() < 0.5) { ua = -hw; ub = rand(-1, 2); } else { ua = rand(-2, 1); ub = 99; }
      h = rand(3.5, 4.1);
    }
    return E.addRamp(zm, { kind: 'wave', wv: WV, LF: 7, LB: 10, p: 1.6, h, ua, ub, big, seed: rand(0, 50), warn: big ? ['Big set', 'Room for a double'] : null });
  }
  function addWhale(zm) {
    const hw = laneHW(zm), u = rand(-0.45, 0.45) * hw;
    E.coinLine(zm + 16, u, 0, 4);
    return E.addRamp(zm, { kind: 'whale', wv: 2.5, LF: 6, LB: 9, round: true, h: 2.6, ua: u - 1.6, ub: u + 1.6, fade: 2.2, grow: 2.5, coins: false,
      bonus: ['Whale Ride', 800], warn: ['Whale!', 'Ride up its back'] });
  }
  function spawn(z, d, intro) {
    const hw = laneHW(z);
    if (z <= nextWave) {
      let gap;
      if (!intro && d > nextWhaleD) { nextWhaleD = d + rand(650, 950); gap = addWhale(z); }
      else gap = addWave(z, d, intro);
      nextWave = z - gap - rand(Math.max(6, 20 - d * 0.005), Math.max(14, 40 - d * 0.009));
      return gap;
    }
    if (intro || d < 60) { E.coinLine(z, rand(-0.4, 0.4) * hw, 1.5, 5); return 18; }
    // a whirlpool, where no wave will roll across it while you can see it
    if (!E.S.bonus && !whirl && d > nextWhirlD && !E.ramps.some(r => r.zm > z - 8 && r.zm < z + 70)) {
      placeWhirl(z, rand(-0.4, 0.4) * hw);
      nextWhirlD = d + rand(1000, 1400); nextWave = Math.min(nextWave, z - 18);
      return 30;
    }
    if (E.S.bonus && Math.random() < 0.55) {   // the lagoon: coins everywhere, fewer things in the way
      E.coinLine(z, rand(-0.6, 0.6) * hw, rand(1, 3), 9);
      return rand(16, 22);
    }
    const busy = clamp(0.5 + d / 2500, 0.5, 0.88);
    if (Math.random() > busy) {   // a breather with coins
      E.coinLine(z, rand(-0.6, 0.6) * hw, rand(0.5, 2.5));
      return rand(18, 26);
    }
    const k = Math.random();
    if (k < 0.24) {   // rocks, with a way through
      const lanes = [-0.66, -0.22, 0.22, 0.66], free = (Math.random() * lanes.length) | 0;
      lanes.filter((_, i) => i !== free).sort(() => Math.random() - 0.5).slice(0, d > 700 ? 3 : 2).forEach(f => E.addThing('rock', z - rand(-2, 2), f * hw + rand(-0.5, 0.5), { r: rand(0.7, 1.1) }));
      E.coinLine(z - 6, lanes[free] * hw, 0.2, 4);
    } else if (k < 0.42 && d > 120) {   // sharks cruising across
      for (let i = 0, n = d > 900 ? 2 : 1; i < n; i++) E.addThing('shark', z - i * 14, rand(-0.6, 0.6) * hw, { vu: (Math.random() < 0.5 ? -1 : 1) * rand(2.5, 4), vz: rand(1.5, 3) });
    } else if (k < 0.58) {   // a bloom of jellyfish
      for (let i = 0, n = 3 + (Math.random() * 3 | 0); i < n; i++) E.addThing('jelly', z - i * rand(3, 6), rand(-0.8, 0.8) * hw, { vu: rand(-0.8, 0.8), vz: rand(0, 0.6) });
    } else if (k < 0.7) {   // a row of buoys with gaps
      const u0 = rand(-0.7, -0.2) * hw;
      for (let i = 0, n = d > 500 ? 4 : 3; i < n; i++) E.addThing('buoy', z, u0 + i * rand(3.8, 5));
    } else if (k < 0.86) {
      const u = rand(-0.6, 0.6) * hw; E.addThing('kook', z, u);
      E.coinLine(z - 4, u > 0 ? u - 4 : u + 4, 0.2, 4);
    } else {
      const u = rand(-0.6, 0.6) * hw; E.addThing('turtle', z, u, { vu: rand(-1.5, 1.5), vz: rand(0.5, 1.2) });
      E.coins.push({ z, u, lift: 1.5 });
    }
    return rand(22, 32) * (1 - Math.min(0.3, d / 6000));
  }

  const kit = {
    id: 'surf', saveKey: 'surf', yawUnit: Math.PI, grab: 'Indy', under: true, sink: 0.3,
    tune: { SLOPE },
    laneX, laneHW, themes: THEMES, KIND,
    pickTheme: () => (Math.random() * 3) | 0,
    bonus: { name: 'Whirlpool', theme: 3, len: 650, fade: '#0b5f7a', back: 'Back on the beach' },
    ambience: { type: 'lowpass', freq: [350, 1150], level: [0.07, 0.19] },
    copy: {
      drop: ['Drop in', 'Ride into the waves to launch'],
      hintsTouch: [[0.6, 'Drag your left thumb to steer. Stay off the sand'], [3.5, 'Ride into a wave to launch. Swipe up on the right to backflip, down to frontflip'], [10, 'In the air, drag your left thumb to spin. Land straight'], [17, 'Tap the right side to jump. Keep your thumb down in the air to grab']],
      hintsKeys: [[0.6, '<kbd>←</kbd> <kbd>→</kbd> to steer. Stay off the sand'], [3.5, 'Ride into a wave to launch. In the air, <kbd>↑</kbd> backflips and <kbd>↓</kbd> frontflips'], [10, 'In the air, <kbd>←</kbd> <kbd>→</kbd> spins. Land straight'], [17, '<kbd>Space</kbd> jumps sharks and buoys. Hold it in the air to grab']],
    },
    baseH(u, z) { const hw = laneHW(z); return u < -hw ? base(z) + sandH(-u - hw, z) : base(z); },
    rampE(r, u, hw) {
      const side = smooth(r.ua - r.fade, r.ua, u) * (1 - smooth(r.ub, r.ub + r.fade, u));
      if (r.kind !== 'wave') return side * smooth(0, 1, hw - Math.abs(u) + 1);
      // a wave breaks onto the sand on the left and fades into open swell on the right
      return side * smooth(-hw - 0.5, -hw + 3, u) * (1 - 0.8 * smooth(hw, hw + 45, u));
    },
    edge(u, z, hw) {
      if (u < -hw + 0.3) return SAND_EDGE;
      if (u > hw + 1) return DEEP_EDGE;
      return null;
    },
    uLimit: hw => [-hw - 2.2, hw + 5],
    makeRider, pose: poseRider,
    sfxLaunch: Sfx => Sfx.noise(0.35, 0.3, 1400, 'highpass'),
    build(e) {
      E = e;
      e.scene.add(water, sand, swash);
      for (let i = 0; i < WMAX; i++) { const m = new THREE.Mesh(grid(WROWS, WCOLS), waveMat); m.frustumCulled = false; m.visible = false; e.scene.add(m); meshPool.push(m); }
      for (const w of whales) { w.visible = false; e.scene.add(w); }
      for (const g of farOut) e.scene.add(g);
      e.scene.add(whirlG);
      e.placeWhirl = placeWhirl;
    },
    applyTheme(th) {
      T = th;
      C = { shallow: rgb(th.shallow), water: rgb(th.water), deep: rgb(th.deep), trough: rgb(th.deep).map(v => v * 0.6), face: rgb(th.face), glow: rgb(th.glow), foam: rgb(th.foam),
        sand: rgb(th.sand), wet: rgb(th.wet), green: rgb(th.green), sprayHex: rgb(th.spray), glowK: th.night ? 0.75 : 0.55 };
      SAND_EDGE.trail = C.sand;
      waterMat.specular.setHex(th.spec); waveMat.specular.setHex(th.spec);
      waterMat.emissive.setHex(th.emissive ?? 0); waveMat.emissive.setHex(th.emissive ?? 0);
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
      nextWave = P.z - (fresh ? 75 : 50); whirl = null; whirlG.visible = false;
      if (fresh) { nextWhaleD = rand(300, 450); nextWhirlD = rand(450, 650); breach.next = rand(10, 18); }
      breach.on = false; whales[1].visible = false;
    },
    spawn,
    rampOn(r) {
      if (r.kind === 'whale') { r.whale = whales[0]; r.whale.visible = true; return; }
      r.mesh = meshPool.pop() || null; if (r.mesh) r.mesh.visible = true;
    },
    rampOff(r) {
      if (r.whale) { r.whale.visible = false; r.whale = null; }
      if (r.mesh) { r.mesh.visible = false; meshPool.push(r.mesh); r.mesh = null; }
    },
    drawRamp(r, t) { if (r.whale) placeLaneWhale(r); else drawWave(r, t); },
    updateGround: (zc, t) => updateGround(zc, t),
    updateScenery: (zc, reset, dt) => updateScenery(zc, reset, dt),
    update(dt, focus) {
      // spray blowing back off the crests
      for (const r of E.ramps) if (r.kind === 'wave' && E.rampAmp(r) > 1 && Math.abs(r.z - focus) < 90 && Math.random() < dt * 22) {
        const hw = laneHW(r.z), u = rand(Math.max(-hw + 2, r.ua), Math.min(hw + 8, r.ub)), A = E.rampAmp(r) * E.rampE(r, u, hw);
        if (A > 1) E.emit(laneX(r.z) + u, base(r.z) + A + 0.15, r.z + 0.6, rand(-0.4, 0.4), rand(1.5, 3.5), rand(-4, -1.5), rand(0.06, 0.13), 0.9, C.sprayHex, 7);
      }
      updateBreach(dt, focus);
      updateWhirl(dt);
    },
  };
  const SAND_EDGE = { slow: 0.55, msg: 'On the sand!', trail: null }, DEEP_EDGE = { slow: 0.4, msg: 'Too far out!' };
  return createRideMode(host, kit);
}
