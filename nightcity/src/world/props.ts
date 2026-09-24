import * as THREE from 'three';
import { plan, P, HALF, ROAD_HALF, type Lot, type Side } from '../layout/plan';
import { model } from '../data/model';
import { Bag, rng, seedOf } from './geo';
import { MAT } from './materials';
import { U } from './core';
import { boardSign, roundRect } from './textures';
import { STATUS_COLOR } from '../theme';
import type { BuildEnv } from './buildctx';
import type { Lamp } from './streets';

/*
 * Straßenleben auf den Gehwegen: Poller, Mülltonnen, Bänke, Hydranten,
 * Pflanzkübel, Getränkeautomaten, Info-Säulen mit echten Zahlen aus dem
 * Datenstand, Ampeln an den Kreuzungen, Strommasten mit Kabelsalat und
 * Lichterketten, Gullydeckel. Alles Kulisse: keine Datenwege, Eingänge,
 * Laternen und Kreuzungen bleiben frei.
 */

const SW = HALF - ROAD_HALF; // Gehwegbreite
const CABLE_DISTRICTS = new Set(['d-lan', 'd-thin', 'd-plaza', 'd-pve-print']);

interface Spot { x: number; z: number; rot: number; }

/** Getränkeautomat: Leuchtfront mit Dosenreihen */
function vendingTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0d15';
  g.fillRect(0, 0, 128, 256);
  const grd = g.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#b8c4d8');
  g.fillStyle = grd;
  g.fillRect(6, 6, 116, 34);
  g.fillStyle = '#0a0d15';
  g.font = '700 22px Rajdhani, sans-serif';
  g.textAlign = 'center';
  g.fillText('24/7', 64, 31);
  g.fillStyle = '#1b2233';
  g.fillRect(8, 48, 112, 150);
  const cans = ['#ff3b5c', '#ffd23f', '#3bd6ff', '#7dff6a', '#ff8a2a', '#c77dff', '#ffffff'];
  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 14 + col * 26, y = 54 + row * 29;
      g.fillStyle = cans[(k++ * 5 + row) % cans.length];
      roundRect(g, x, y, 20, 24, 5);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.fillRect(x + 3, y + 3, 4, 17);
    }
  }
  g.fillStyle = '#6fffe0';
  g.fillRect(16, 208, 58, 18);
  g.fillStyle = '#0a0d15';
  g.fillRect(88, 206, 26, 34);
  g.fillStyle = '#3a4560';
  g.fillRect(20, 234, 50, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildProps(env: BuildEnv, lamps: Lamp[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Straßenleben';
  const dark = new Bag(), metal = new Bag(), conc = new Bag(), col = new Bag(true), vend = new Bag(true), lens = new Bag();
  const neonBags = new Map<string, Bag>();
  const neon = (c: string) => { let b = neonBags.get(c); if (!b) { b = new Bag(); neonBags.set(c, b); } return b; };

  /* ---------- Belegung: Laternen, Kreuzungen und Eingänge bleiben frei ---------- */
  const taken: Array<{ x: number; z: number; r: number }> = lamps.map(l => ({ x: l.p.x, z: l.p.z, r: 1.3 }));
  const free = (s: { x: number; z: number }, r: number) => taken.every(o => Math.hypot(o.x - s.x, o.z - s.z) > o.r + r);
  const take = (s: { x: number; z: number }, r: number) => taken.push({ x: s.x, z: s.z, r });

  // lokale Koordinaten (+z = zur Straße) → Welt
  const W = (s: Spot, lx: number, lz: number) => ({ x: s.x + Math.cos(s.rot) * lx + Math.sin(s.rot) * lz, z: s.z - Math.sin(s.rot) * lx + Math.cos(s.rot) * lz });
  const box = (bag: Bag, s: Spot, w: number, h: number, d: number, lx: number, y: number, lz: number, color?: THREE.ColorRepresentation) => {
    const p = W(s, lx, lz);
    bag.box(w, h, d, p.x, y, p.z, s.rot, color);
  };
  const cyl = (bag: Bag, s: Spot, rt: number, rb: number, h: number, lx: number, y: number, lz: number, seg = 10, color?: THREE.ColorRepresentation) => {
    const p = W(s, lx, lz);
    bag.cyl(rt, rb, h, p.x, y, p.z, seg, color);
  };

  const Y0 = 0.16; // Oberkante Gehweg
  const accentOf = (d: string) => ({ 'd-pve-node1': '#ff9f1c', 'd-pve-ai': '#00e5ff', 'd-pve-print': '#fcee0a', 'd-thin': '#2effc8', 'd-lan': '#ffb000', 'd-plaza': '#00f5d4', 'd-out': '#b46bff' } as Record<string, string>)[d] || '#ffb000';

  /* ---------- Einzelteile ---------- */
  const bollard = (s: Spot, c: string) => {
    cyl(dark, s, 0.1, 0.12, 0.85, 0, Y0, 0, 8);
    cyl(neon(c), s, 0.105, 0.105, 0.05, 0, Y0 + 0.72, 0, 8);
  };
  const bin = (s: Spot, r: () => number) => {
    const c = r() > 0.5 ? '#26382f' : '#3b2b30';
    box(col, s, 0.55, 0.82, 0.5, 0, Y0, 0, c);
    box(dark, s, 0.6, 0.07, 0.55, 0, Y0 + 0.82, 0);
    box(col, s, 0.2, 0.05, 0.02, 0, Y0 + 0.55, 0.26, '#d6e0ea');
  };
  const bench = (s: Spot) => {
    box(dark, s, 1.8, 0.07, 0.5, 0, Y0 + 0.45, 0.02);
    box(dark, s, 1.8, 0.42, 0.06, 0, Y0 + 0.55, -0.22);
    for (const lx of [-0.78, 0.78]) box(dark, s, 0.07, 0.45, 0.46, lx, Y0, 0);
  };
  const hydrant = (s: Spot) => {
    cyl(col, s, 0.13, 0.15, 0.62, 0, Y0, 0, 10, '#a3202b');
    const p = W(s, 0, 0);
    col.sphere(0.14, p.x, Y0 + 0.66, p.z, 10, '#c4303a');
    box(col, s, 0.38, 0.09, 0.09, 0, Y0 + 0.4, 0, '#8e1b25');
  };
  const planter = (s: Spot, c: string) => {
    box(conc, s, 0.95, 0.45, 0.95, 0, Y0, 0);
    const p = W(s, 0, 0);
    env.trees.add(new THREE.Vector3(p.x, Y0 + 0.45, p.z), 0.33, c, p.x * 0.37);
  };
  const vendTint = ['#ff5a7a', '#5fd8ff', '#ffe066', '#7dff9a', '#ff9a4a'];
  const vending = (s: Spot, r: () => number) => {
    const tint = vendTint[Math.floor(r() * vendTint.length)];
    box(col, s, 0.95, 1.9, 0.75, 0, Y0, 0, '#171c28');
    const p = W(s, 0, 0.378);
    vend.add(new THREE.PlaneGeometry(0.8, 1.6), { x: p.x, y: Y0 + 1.05, z: p.z }, { y: s.rot }, undefined, tint);
    box(neon(tint), s, 0.96, 0.05, 0.05, 0, Y0 + 1.92, 0.36);
  };
  // Info-Säulen zeigen echte Zahlen aus dem Datenstand
  const guests = model.nodes.filter(n => n.t === 'vm' || n.t === 'ct').length;
  const pves = model.nodes.filter(n => n.t === 'pve').length;
  const svcs = model.nodes.filter(n => n.t === 'svc').length;
  const crit = model.findings.filter(f => f.sev === 'crit').length;
  const infoRects = [
    boardSign(env.atlas, 'STADTINFO', `${pves} Nodes · ${guests} Gäste`, '#2ec5ff', { w: 420, h: 150 }),
    boardSign(env.atlas, 'LAGE', `${model.findings.length} Befunde · ${crit} kritisch`, STATUS_COLOR.warn, { w: 420, h: 150 }),
    boardSign(env.atlas, 'DIENSTE', `${svcs} Programme laufen`, '#7dff9a', { w: 420, h: 150 }),
    boardSign(env.atlas, 'DATENSTAND', model.live?.at ? String(model.live.at) : 'Snapshot', '#fcee0a', { w: 420, h: 150 })
  ];
  let infoN = 0;
  const infoColumn = (s: Spot) => {
    cyl(dark, s, 0.32, 0.36, 2.5, 0, Y0, 0, 14);
    cyl(neon('#2ec5ff'), s, 0.33, 0.33, 0.05, 0, Y0 + 2.5, 0, 14);
    const p = W(s, 0, 0.37);
    env.signs.quad(infoRects[infoN++ % infoRects.length], 1.0, 0.36, new THREE.Vector3(p.x, Y0 + 1.7, p.z), s.rot, { intensity: 1.6, seed: p.x * 0.13 });
  };

  /* ---------- Gehwege je Grundstück ---------- */
  plan.lots.forEach((l: Lot) => {
    const r = rng(seedOf(l.id + ':props'));
    const acc = accentOf(l.district);
    const sides: Side[] = ['s', 'n', 'e', 'w'];
    sides.forEach(side => {
      const horiz = side === 's' || side === 'n';
      const out = side === 's' || side === 'e' ? 1 : -1;
      const a0 = horiz ? l.x0 : l.z0, a1 = horiz ? l.x1 : l.z1;
      const edge = side === 's' ? l.z1 : side === 'n' ? l.z0 : side === 'e' ? l.x1 : l.x0;
      const rot = side === 's' ? 0 : side === 'n' ? Math.PI : side === 'e' ? Math.PI / 2 : -Math.PI / 2;
      const mid = (a0 + a1) / 2;
      const spot = (along: number, off: number): Spot => {
        const c = edge + out * off;
        return horiz ? { x: along, z: c, rot } : { x: c, z: along, rot };
      };
      const isDoor = l.door.side === side;
      // Poller an den Ecken, zur Bordsteinkante hin
      for (const [end, dir] of [[a0 + 0.6, 1], [a1 - 0.6, -1]] as Array<[number, number]>) {
        for (let k = 0; k < 2; k++) {
          const s = spot(end + dir * k * 1.15, SW - 0.28);
          if (free(s, 0.25)) { bollard(s, acc); take(s, 0.3); }
        }
      }
      // Automaten links und rechts vom Eingang
      if (isDoor && l.kind !== 'decor' && l.kind !== 'plaza') {
        for (const dx of [-3.4, 3.4]) {
          const s = spot(mid + dx, 0.5);
          if (r() > 0.35 && free(s, 0.8)) { vending(s, r); take(s, 0.9); }
        }
      }
      // Möblierung entlang der Seite
      let pos = a0 + 3.4 + r() * 2;
      while (pos < a1 - 3.4) {
        const stepLen = 2.4 + r() * 3.6;
        if (isDoor && Math.abs(pos - mid) < 4.8) { pos += stepLen; continue; }
        const s = spot(pos, 0.55);
        const pick = r();
        if (pick < 0.15 && free(s, 0.5)) { bin(s, r); take(s, 0.5); }
        else if (pick < 0.25 && free(s, 1.1)) { bench(s); take(s, 1.1); }
        else if (pick < 0.31 && free(s, 0.4)) { hydrant(s); take(s, 0.4); }
        else if (pick < 0.39 && free(s, 0.7)) { planter(s, acc); take(s, 0.7); }
        else if (pick < 0.43 && free(s, 0.6)) { infoColumn(s); take(s, 0.6); }
        pos += stepLen;
      }
    });
  });

  /* ---------- Ampeln an Kreuzungen ---------- */
  plan.nodes.forEach(n => {
    const roads = n.adj.filter(e => e.bridge !== 'rail');
    if (roads.length < 3) return;
    const ph = seedOf(n.key);
    // zwei Masten an gegenüberliegenden Ecken
    for (const [sx, sz] of [[1, 1], [-1, -1]] as Array<[number, number]>) {
      const px = n.x + sx * (HALF - 0.35), pz = n.z + sz * (HALF - 0.35);
      if (!plan.cells.has(`${Math.floor(px / P)}|${Math.floor(pz / P)}`)) continue;
      if (!free({ x: px, z: pz }, 0.4)) continue;
      take({ x: px, z: pz }, 0.5);
      dark.cyl(0.08, 0.1, 4.4, px, 0, pz, 8);
      // je ein Signalkopf für beide Straßenrichtungen
      for (const axis of [0, 1]) {
        const rot = axis === 0 ? (sz > 0 ? 0 : Math.PI) : (sx > 0 ? Math.PI / 2 : -Math.PI / 2);
        const s: Spot = { x: px, z: pz, rot };
        box(dark, s, 0.32, 0.98, 0.26, 0, 3.05, 0.2);
        for (let k = 0; k < 3; k++) {
          const g = new THREE.CylinderGeometry(0.085, 0.085, 0.05, 12);
          g.rotateX(Math.PI / 2);
          const uv = new Float32Array(g.attributes.position.count * 2);
          for (let i = 0; i < uv.length; i += 2) { uv[i] = k; uv[i + 1] = ph + axis * 0.5; }
          g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
          const p = W(s, 0, 0.35);
          lens.add(g, { x: p.x, y: 3.84 - k * 0.3, z: p.z }, { y: rot });
        }
      }
    }
  });

  /* ---------- Strommasten, Kabelsalat, Lichterketten ---------- */
  const bulbCols = ['#ffcf7a', '#ff7ab8', '#7ae8ff', '#fff2c4'];
  const hangTexts = ['OFFEN', 'RAMEN', '24/7', 'LAN-PARTY', 'NUDELN', 'REPARATUR', 'KAFFEE', 'KARAOKE'];
  const hangRects = new Map<string, ReturnType<typeof boardSign>>();
  let edgeN = 0;
  plan.edges.forEach(e => {
    if (e.bridge) return;
    const horiz = Math.abs(e.b.x - e.a.x) > Math.abs(e.b.z - e.a.z);
    const i0 = Math.min(e.a.i, e.b.i), j0 = Math.min(e.a.j, e.b.j);
    const cellsNear = horiz ? [`${i0}|${j0 - 1}`, `${i0}|${j0}`] : [`${i0 - 1}|${j0}`, `${i0}|${j0}`];
    const lotsNear = cellsNear.map(k => plan.cells.get(k)).filter((x): x is Lot => !!x);
    if (lotsNear.length < 2 || !lotsNear.some(l => CABLE_DISTRICTS.has(l.district))) return;
    const r = rng(seedOf(e.a.key + e.b.key + ':cable'));
    if (r() < 0.35) return;
    const t = 0.6 + r() * 0.12;
    const cx = e.a.x + (e.b.x - e.a.x) * t, cz = e.a.z + (e.b.z - e.a.z) * t;
    const off = HALF - 0.45;
    const A = horiz ? new THREE.Vector3(cx, 0, cz - off) : new THREE.Vector3(cx - off, 0, cz);
    const B = horiz ? new THREE.Vector3(cx, 0, cz + off) : new THREE.Vector3(cx + off, 0, cz);
    if (!free(A, 0.5) || !free(B, 0.5)) return;
    take(A, 0.6); take(B, 0.6);
    const H = 9 + r() * 1.5;
    for (const p of [A, B]) {
      dark.cyl(0.11, 0.15, H, p.x, 0, p.z, 8);
      if (horiz) dark.box(1.8, 0.1, 0.1, p.x, H - 0.9, p.z); else dark.box(0.1, 0.1, 1.8, p.x, H - 0.9, p.z);
      for (const d of [-0.7, 0.7]) {
        const ix = horiz ? p.x + d : p.x, iz = horiz ? p.z : p.z + d;
        conc.cyl(0.05, 0.05, 0.14, ix, H - 0.8, iz, 6);
      }
    }
    // durchhängende Kabel quer über die Straße
    const cables = 2 + Math.floor(r() * 3);
    for (let c = 0; c < cables; c++) {
      const d = (c - (cables - 1) / 2) * 0.55;
      const a = horiz ? new THREE.Vector3(A.x + d, H - 0.7, A.z) : new THREE.Vector3(A.x, H - 0.7, A.z + d);
      const b = horiz ? new THREE.Vector3(B.x + d, H - 0.7, B.z) : new THREE.Vector3(B.x, H - 0.7, B.z + d);
      const sag = 0.5 + r() * 1.1;
      const seg = 10;
      let prev = a.clone();
      const lights = c === 0 && r() > 0.3;
      for (let k = 1; k <= seg; k++) {
        const tt = k / seg;
        const p = a.clone().lerp(b, tt);
        p.y -= sag * 4 * tt * (1 - tt);
        dark.beam(prev, p, 0.035);
        prev = p;
      }
      if (lights) {
        const n = 11;
        for (let k = 1; k < n; k++) {
          const tt = k / n;
          const p = a.clone().lerp(b, tt);
          p.y -= sag * 4 * tt * (1 - tt) + 0.08;
          neon(bulbCols[(k + edgeN) % bulbCols.length]).sphere(0.07, p.x, p.y, p.z, 6);
        }
      }
    }
    // manchmal ein Schild am Kabel
    if (r() > 0.55) {
      const txt = hangTexts[edgeN % hangTexts.length];
      let rect = hangRects.get(txt);
      if (!rect) { rect = boardSign(env.atlas, txt, '', bulbCols[edgeN % bulbCols.length], { w: 300, h: 110 }); hangRects.set(txt, rect); }
      const m = A.clone().lerp(B, 0.5);
      m.y = H - 0.7 - 1.1 - 0.6;
      env.signs.quad(rect, 1.6, 0.6, m, horiz ? Math.PI / 2 : 0, { intensity: 1.5, fx: r() > 0.7 ? 1 : 0, seed: r() });
    }
    edgeN++;
  });

  /* ---------- Gullydeckel (dort, wo es dampft) ---------- */
  let k = 0;
  plan.nodes.forEach(n => {
    if (k > 9 || (n.i * 7 + n.j * 13) % 11 !== 0) return;
    if (n.z > plan.bounds.z1) return;
    dark.cyl(0.5, 0.5, 0.04, n.x + 1.8, 0.0, n.z + 1.8, 18);
    metal.torus(0.5, 0.03, n.x + 1.8, 0.05, n.z + 1.8, { x: Math.PI / 2 }, undefined, 24);
    k++;
  });

  /* ---------- Meshes ---------- */
  const add = (bag: Bag, mat: THREE.Material, cast = true, name?: string) => {
    const m = bag.mesh(mat, { cast, receive: true, name });
    if (m) group.add(m);
    return m;
  };
  add(dark, MAT.darkMetal, true, 'Straßenmöbel');
  add(metal, MAT.metal, false);
  add(conc, MAT.concrete, true);
  add(col, MAT.vertex, true);
  add(vend, new THREE.MeshBasicMaterial({ map: vendingTexture(), vertexColors: true, color: new THREE.Color(1.6, 1.6, 1.6) }), false, 'Automaten');
  neonBags.forEach((b, c) => add(b, new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.6) }), false));
  const lensMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity },
    vertexShader: /* glsl */`
      varying vec2 vS; varying float vFog;
      void main() {
        vS = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFog = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uFogDensity;
      uniform vec3 uFogColor;
      varying vec2 vS; varying float vFog;
      void main() {
        // Ampelphase: grün 0–0,44 · gelb 0,44–0,5 · rot 0,5–1 (Querrichtung um 0,5 versetzt)
        float cyc = fract(uTime / 16.0 + vS.y);
        float on;
        vec3 c;
        if (vS.x < 0.5) { c = vec3(1.0, 0.07, 0.05); on = step(0.5, cyc); }
        else if (vS.x < 1.5) { c = vec3(1.0, 0.55, 0.02); on = step(0.44, cyc) * step(cyc, 0.5); }
        else { c = vec3(0.1, 1.0, 0.45); on = step(cyc, 0.44); }
        vec3 col = c * mix(0.05, 3.4, on);
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vFog * vFog);
        gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
        #include <colorspace_fragment>
      }`
  });
  add(lens, lensMat, false, 'Ampellichter');
  return group;
}
