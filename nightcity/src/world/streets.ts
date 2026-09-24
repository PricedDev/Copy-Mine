import * as THREE from 'three';
import { plan, P, HALF, RAIL_Y, type GEdge } from '../layout/plan';
import { railSegments } from '../layout/routes';
import { Bag } from './geo';
import { asphaltTextures, concreteTexture, glowTexture, boardSign, type Atlas } from './textures';
import { MAT, applySurface } from './materials';
import { U, noReflect } from './core';
import type { SignLayer } from './signs';
import type { BeaconSet } from './instanced';
import { KIND_COLOR } from '../theme';

/*
 * Boden, Straßen, Gehwege, Laternen, Brücken und die Tailnet-Hochbahn.
 * Die Fahrbahn ist die Landfläche selbst (Asphalt); Grundstücke liegen als
 * erhöhte Gehweg-Platten darauf – die Lücken dazwischen sind die Straßen.
 */

const LAND_MARGIN = 6;

/** Materialien mit Weltkoordinaten als UV (Texturen laufen über alle Flächen durch) */
function worldUV(g: THREE.BufferGeometry, scale: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / scale;
    uv[i * 2 + 1] = pos.getZ(i) / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export interface Lamp { p: THREE.Vector3; color: THREE.Color; ang: number; }

export interface StreetsResult {
  group: THREE.Group;
  lamps: Lamp[];
  stations: Map<string, THREE.Vector3>;
}

export function buildStreets(atlas: Atlas, signs: SignLayer, beacons: BeaconSet): StreetsResult {
  const group = new THREE.Group();
  group.name = 'Straßen';
  const asphalt = asphaltTextures();
  const asphaltMat = applySurface(new THREE.MeshStandardMaterial({
    map: asphalt.map, roughnessMap: asphalt.rough, roughness: 1, metalness: 0.15, envMapIntensity: 1.5, color: '#9aa3b8'
  }), 3);
  const concrete = concreteTexture();
  const padMat = applySurface(new THREE.MeshStandardMaterial({ map: concrete, vertexColors: true, roughness: 0.78, metalness: 0.08, envMapIntensity: 1.1 }), 4);
  const wallMat = applySurface(new THREE.MeshStandardMaterial({ color: '#1a1d24', roughness: 0.9, metalness: 0.1 }), 1);

  /* ---------- Landmasse (Fahrbahnen) ---------- */
  const tops: THREE.BufferGeometry[] = [];
  const walls = new Bag();
  const coast = new Bag();
  const has = (c: number, r: number) => plan.cells.has(`${c}|${r}`);
  plan.cells.forEach((_lot, key) => {
    const [c, r] = key.split('|').map(Number);
    const x0 = c * P - (has(c - 1, r) ? 0 : LAND_MARGIN), x1 = (c + 1) * P + (has(c + 1, r) ? 0 : LAND_MARGIN);
    const z0 = r * P - (has(c, r - 1) ? 0 : LAND_MARGIN), z1 = (r + 1) * P + (has(c, r + 1) ? 0 : LAND_MARGIN);
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    tops.push(g);
    // Kaimauern nur zum Wasser
    const wallH = 4;
    if (!has(c - 1, r)) walls.box(0.6, wallH, z1 - z0, x0 + 0.3, -wallH, (z0 + z1) / 2);
    if (!has(c + 1, r)) walls.box(0.6, wallH, z1 - z0, x1 - 0.3, -wallH, (z0 + z1) / 2);
    if (!has(c, r - 1)) walls.box(x1 - x0, wallH, 0.6, (x0 + x1) / 2, -wallH, z0 + 0.3);
    if (!has(c, r + 1)) walls.box(x1 - x0, wallH, 0.6, (x0 + x1) / 2, -wallH, z1 - 0.3);
    // Kaikante mit Lichtband + Poller
    if (!has(c - 1, r)) coast.box(0.12, 0.12, z1 - z0, x0 + 0.02, -0.5, (z0 + z1) / 2);
    if (!has(c + 1, r)) coast.box(0.12, 0.12, z1 - z0, x1 - 0.02, -0.5, (z0 + z1) / 2);
    if (!has(c, r - 1)) coast.box(x1 - x0, 0.12, 0.12, (x0 + x1) / 2, -0.5, z0 + 0.02);
    if (!has(c, r + 1)) coast.box(x1 - x0, 0.12, 0.12, (x0 + x1) / 2, -0.5, z1 - 0.02);
  });
  // Brückendecks (Straße) gehören zur Fahrbahn
  const rb = plan.roadBridge;
  const bx = rb.i * P, bz0 = rb.j0 * P + LAND_MARGIN - 3, bz1 = rb.j1 * P - LAND_MARGIN + 3;
  {
    const g = new THREE.PlaneGeometry(12, bz1 - bz0);
    g.rotateX(-Math.PI / 2);
    g.translate(bx, 0, (bz0 + bz1) / 2);
    tops.push(g);
  }
  tops.forEach(g => worldUV(g, 22));
  const landGeo = mergeSimple(tops);
  const land = new THREE.Mesh(landGeo, asphaltMat);
  land.receiveShadow = true;
  land.name = 'Fahrbahnen';
  group.add(land);
  const wm = walls.mesh(wallMat, { cast: false });
  if (wm) group.add(wm);
  const cm = coast.mesh(new THREE.MeshBasicMaterial({ color: new THREE.Color('#2ec5ff').multiplyScalar(2.2) }), { cast: false, receive: false });
  if (cm) group.add(cm);

  /* ---------- Grundstücksplatten (Gehwege) ---------- */
  const pads: THREE.BufferGeometry[] = [];
  const tint: Record<string, string> = {
    'd-pve-node1': '#b9a9a8', 'd-pve-ai': '#a3b5c2', 'd-pve-print': '#b8b09a', 'd-thin': '#a4bbb4',
    'd-lan': '#b8a898', 'd-plaza': '#a8b8b6', 'd-out': '#aea6c4'
  };
  plan.lots.forEach(l => {
    const m = 1.5;
    const w = l.x1 - l.x0 + m * 2, d = l.z1 - l.z0 + m * 2;
    const g = new THREE.BoxGeometry(w, 0.16, d);
    g.translate((l.x0 + l.x1) / 2, 0.08, (l.z0 + l.z1) / 2);
    const ng = g.toNonIndexed();
    worldUV(ng, 8);
    const col = new THREE.Color(tint[l.district] || '#aaaaaa');
    const n = ng.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    pads.push(ng);
  });
  const padMesh = new THREE.Mesh(mergeSimple(pads), padMat);
  padMesh.receiveShadow = true;
  padMesh.name = 'Gehwege';
  group.add(padMesh);

  /* ---------- Markierungen ---------- */
  const marks = new Bag();
  const zebra = new Bag();
  plan.edges.forEach(e => {
    if (e.bridge === 'rail') return;
    const ax = e.a.x, az = e.a.z, bx2 = e.b.x, bz2 = e.b.z;
    const horiz = Math.abs(bx2 - ax) > Math.abs(bz2 - az);
    const len = Math.hypot(bx2 - ax, bz2 - az);
    const inset = HALF + 2.5;
    const usable = len - inset * 2;
    if (usable <= 2) return;
    const n = Math.floor(usable / 4.2);
    for (let i = 0; i < n; i++) {
      const t = (inset + 1 + i * 4.2) / len;
      const x = ax + (bx2 - ax) * t, z = az + (bz2 - az) * t;
      if (horiz) marks.box(2.2, 0.02, 0.14, x + 1.1, 0.012, z); else marks.box(0.14, 0.02, 2.2, x, 0.012, z + 1.1);
    }
    if (e.bridge) return;
    // Zebrastreifen an beiden Enden
    for (const end of [0, 1]) {
      const px = end ? bx2 : ax, pz = end ? bz2 : az;
      const dir = end ? -1 : 1;
      for (let k = -2; k <= 2; k++) {
        if (horiz) zebra.box(1.6, 0.02, 0.55, px + dir * (HALF + 1.2), 0.013, pz + k * 1.15);
        else zebra.box(0.55, 0.02, 1.6, px + k * 1.15, 0.013, pz + dir * (HALF + 1.2));
      }
    }
  });
  const mm = marks.mesh(new THREE.MeshBasicMaterial({ color: new THREE.Color('#d8c27a').multiplyScalar(0.55) }), { cast: false, receive: false });
  if (mm) group.add(mm);
  const zm = zebra.mesh(new THREE.MeshBasicMaterial({ color: new THREE.Color('#c9d2dc').multiplyScalar(0.42) }), { cast: false, receive: false });
  if (zm) group.add(zm);

  /* ---------- Laternen ---------- */
  const lamps: Lamp[] = [];
  let k = 0;
  plan.edges.forEach(e => {
    if (e.bridge === 'rail') return;
    const count = e.bridge ? 4 : 1;
    for (let i = 0; i < count; i++) {
      // nicht auf Segmentmitte: dort liegen die Eingänge der Grundstücke
      const t = count === 1 ? 0.3 : (i + 0.5) / count;
      const x = e.a.x + (e.b.x - e.a.x) * t, z = e.a.z + (e.b.z - e.a.z) * t;
      const horiz = Math.abs(e.b.x - e.a.x) > Math.abs(e.b.z - e.a.z);
      const side = (k++ % 2) ? 1 : -1;
      const off = e.bridge ? 5.2 : HALF - 0.6;
      const px = horiz ? x : x + side * off;
      const pz = horiz ? z + side * off : z;
      // Ausleger zeigt zur Straßenmitte (lokale +x-Achse nach Drehung)
      const ang = horiz ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? Math.PI : 0);
      const hue = k % 9 === 0 ? '#ff5ea8' : k % 7 === 0 ? '#5fe1ff' : '#ffb46b';
      lamps.push({ p: new THREE.Vector3(px, 0, pz), color: new THREE.Color(hue), ang });
    }
  });
  buildLamps(group, lamps);

  /* ---------- Straßenbrücke ---------- */
  const bridge = new Bag();
  const deckZ0 = rb.j0 * P + 2, deckZ1 = rb.j1 * P - 2;
  bridge.box(13, 1.35, deckZ1 - deckZ0, bx, -1.4, (deckZ0 + deckZ1) / 2);
  for (let z = deckZ0 + 12; z < deckZ1 - 6; z += 16) bridge.box(3, 8, 3, bx, -9, z);
  const towerZ = [(deckZ0 * 2 + deckZ1) / 3, (deckZ0 + deckZ1 * 2) / 3];
  const cables = new Bag();
  towerZ.forEach(tz => {
    for (const s of [-1, 1]) bridge.box(1.4, 22, 1.4, bx + s * 7.2, -1, tz);
    bridge.box(16, 1.4, 1.4, bx, 19, tz);
    for (const s of [-1, 1]) {
      for (const dz of [-24, -12, 12, 24]) {
        cables.beam(new THREE.Vector3(bx + s * 7.2, 20.2, tz), new THREE.Vector3(bx + s * 6.3, 0.4, tz + dz), 0.12);
      }
      beacons.add(new THREE.Vector3(bx + s * 7.2, 21.6, tz), '#ff2a3a', 0.55, 0.2, 0.45);
    }
  });
  const bm = bridge.mesh(MAT.darkMetal);
  if (bm) group.add(bm);
  const cbm = cables.mesh(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8a2a').multiplyScalar(1.8) }), { cast: false, receive: false });
  if (cbm) group.add(cbm);
  const rails = new Bag();
  for (const s of [-1, 1]) {
    rails.box(0.14, 0.14, deckZ1 - deckZ0, bx + s * 6.3, 1.0, (deckZ0 + deckZ1) / 2);
    rails.box(0.14, 0.14, deckZ1 - deckZ0, bx + s * 6.3, 0.2, (deckZ0 + deckZ1) / 2);
  }
  const rm = rails.mesh(new THREE.MeshBasicMaterial({ color: new THREE.Color(KIND_COLOR.ingress).multiplyScalar(2.4) }), { cast: false, receive: false });
  if (rm) group.add(rm);
  const bsign = boardSign(atlas, 'WAN-UPLINK', 'DSL · Speedport ⇄ Internet', KIND_COLOR.ingress, { w: 560, h: 140 });
  signs.quad(bsign, 8, 2, new THREE.Vector3(bx, 20.6, towerZ[1] + 0.8), 0, { intensity: 1.9 });
  signs.quad(bsign, 8, 2, new THREE.Vector3(bx, 20.6, towerZ[0] - 0.8), Math.PI, { intensity: 1.9 });

  /* ---------- Hochbahn (Tailnet) ---------- */
  const stations = buildRail(group, railSegments, beacons);

  return { group, lamps, stations };
}

function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = list.map(g => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) ng.deleteAttribute(name);
    return ng;
  });
  const hasColor = norm.some(g => g.attributes.color);
  let count = 0;
  norm.forEach(g => { count += g.attributes.position.count; });
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const col = hasColor ? new Float32Array(count * 3) : null;
  let o = 0;
  norm.forEach(g => {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    if (col) {
      if (g.attributes.color) col.set(g.attributes.color.array as Float32Array, o * 3);
      else col.fill(1, o * 3, (o + n) * 3);
    }
    o += n;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/* ------------------------------------------------------------------ */

function buildLamps(group: THREE.Group, lamps: Lamp[]) {
  const n = lamps.length;
  const poleG = new THREE.CylinderGeometry(0.09, 0.14, 7, 6);
  poleG.translate(0, 3.5, 0);
  const armG = new THREE.BoxGeometry(1.6, 0.12, 0.12);
  armG.translate(0.8, 7, 0);
  const headG = new THREE.BoxGeometry(0.9, 0.18, 0.42);
  headG.translate(1.4, 6.9, 0);
  const poles = new THREE.InstancedMesh(mergeSimple([poleG, armG]), MAT.darkMetal, n);
  const headMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const heads = new THREE.InstancedMesh(headG, headMat, n);
  // Lichtkegel (additiv, weich)
  const coneG = new THREE.ConeGeometry(2.9, 6.8, 20, 1, true);
  coneG.translate(1.4, 3.45, 0);
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime },
    vertexShader: /* glsl */`
      varying float vY; varying vec3 vC; varying vec3 vN; varying vec3 vV;
      void main() {
        vY = position.y / 6.9;
        vC = instanceColor;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vV = mv.xyz;
        vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vY; varying vec3 vC; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(-vV))), 1.4);
        float a = smoothstep(1.0, 0.25, vY) * 0.05 * edge;
        gl_FragColor = vec4(vC * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
  const cones = new THREE.InstancedMesh(coneG, coneMat, n);
  // Lichtpfütze am Boden
  const poolG = new THREE.PlaneGeometry(9, 9);
  poolG.rotateX(-Math.PI / 2);
  poolG.translate(1.4, 0.2, 0);
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.4 });
  const pools = new THREE.InstancedMesh(poolG, poolMat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  lamps.forEach((l, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.ang);
    m.compose(l.p, q, one);
    poles.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    cones.setMatrixAt(i, m);
    pools.setMatrixAt(i, m);
    heads.setColorAt(i, l.color.clone().multiplyScalar(4));
    cones.setColorAt(i, l.color);
    pools.setColorAt(i, l.color.clone().multiplyScalar(0.9));
  });
  poles.castShadow = true;
  [poles, heads, cones, pools].forEach(o => { o.frustumCulled = false; group.add(o); });
  cones.renderOrder = 4;
  pools.renderOrder = 3;
  noReflect(cones);
  noReflect(pools);
}

/* ------------------------------------------------------------------ */

function buildRail(group: THREE.Group, segs: GEdge[], beacons: BeaconSet): Map<string, THREE.Vector3> {
  const track = new Bag();
  const pillars = new Bag();
  const glow = new Bag();
  const nodes = new Set<string>();
  segs.forEach(e => {
    const a = new THREE.Vector3(e.a.x, RAIL_Y, e.a.z), b = new THREE.Vector3(e.b.x, RAIL_Y, e.b.z);
    const len = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const horiz = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
    const ext = len + 2.4;
    if (horiz) {
      track.box(ext, 0.9, 2.6, mid.x, RAIL_Y - 0.9, mid.z);
      for (const s of [-0.7, 0.7]) track.box(ext, 0.16, 0.16, mid.x, RAIL_Y, mid.z + s);
      for (const s of [-1.36, 1.36]) glow.box(ext, 0.12, 0.08, mid.x, RAIL_Y - 0.5, mid.z + s);
    } else {
      track.box(2.6, 0.9, ext, mid.x, RAIL_Y - 0.9, mid.z);
      for (const s of [-0.7, 0.7]) track.box(0.16, 0.16, ext, mid.x + s, RAIL_Y, mid.z);
      for (const s of [-1.36, 1.36]) glow.box(0.08, 0.12, ext, mid.x + s, RAIL_Y - 0.5, mid.z);
    }
    nodes.add(e.a.key);
    nodes.add(e.b.key);
    // Stützen: über Wasser tiefer
    const n = Math.max(1, Math.round(len / 15));
    for (let i = 1; i < n; i++) {
      const p = a.clone().lerp(b, i / n);
      const water = e.bridge === 'rail';
      pillars.cyl(0.5, 0.7, RAIL_Y - 0.9 + (water ? 6 : 0), p.x, water ? -6 : 0, p.z, 10);
    }
  });
  nodes.forEach(k => {
    const [i, j] = k.split(',').map(Number);
    const x = i * P, z = j * P;
    pillars.cyl(0.6, 0.8, RAIL_Y - 0.9, x, 0, z, 10);
    track.box(3.2, 1.2, 3.2, x, RAIL_Y - 1.2, z);
    beacons.add(new THREE.Vector3(x, RAIL_Y + 0.3, z), KIND_COLOR.vpn, 0.4, 0.5, 0.22);
  });
  const tm = track.mesh(MAT.darkMetal);
  if (tm) { tm.name = 'Hochbahn'; group.add(tm); }
  const pm = pillars.mesh(MAT.concrete);
  if (pm) group.add(pm);
  const gm = glow.mesh(new THREE.MeshBasicMaterial({ color: new THREE.Color(KIND_COLOR.vpn).multiplyScalar(2.6) }), { cast: false, receive: false });
  if (gm) group.add(gm);

  // Stationen an den Tailnet-Knoten
  const stations = new Map<string, THREE.Vector3>();
  const stationFor: Array<[string, string]> = [['b-ts', 'g301'], ['sat-ts', 'vm-game'], ['t100-ts', 'g100'], ['ts-cloud', 'ts-cloud']];
  const plat = new Bag();
  const canopy = new Bag();
  stationFor.forEach(([svc, sid]) => {
    const pl = plan.place(sid);
    if (!pl) return;
    const d = pl.door;
    const horizStreet = d.side === 's' || d.side === 'n';
    // Bahnsteig zur Gebäudeseite hin versetzt
    const off = d.side === 's' ? -2.4 : d.side === 'n' ? 2.4 : d.side === 'e' ? -2.4 : 2.4;
    const px = horizStreet ? d.x : d.x + off;
    const pz = horizStreet ? d.z + off : d.z;
    if (horizStreet) plat.box(10, 0.5, 2.2, px, RAIL_Y - 0.4, pz); else plat.box(2.2, 0.5, 10, px, RAIL_Y - 0.4, pz);
    if (horizStreet) canopy.box(10.4, 0.2, 2.8, px, RAIL_Y + 3.2, pz); else canopy.box(2.8, 0.2, 10.4, px, RAIL_Y + 3.2, pz);
    // Aufzug zum Boden
    const ex = horizStreet ? d.x + 3.6 : pl.entrance.x, ez = horizStreet ? pl.entrance.z : d.z + 3.6;
    plat.box(1.6, RAIL_Y, 1.6, ex, 0, ez);
    stations.set(svc, new THREE.Vector3(px, RAIL_Y, pz));
  });
  const pm2 = plat.mesh(MAT.metal);
  if (pm2) group.add(pm2);
  const cm2 = canopy.mesh(MAT.glass);
  if (cm2) group.add(cm2);
  return stations;
}

