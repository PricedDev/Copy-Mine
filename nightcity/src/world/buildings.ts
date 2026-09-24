import * as THREE from 'three';
import { model, type CNode } from '../data/model';
import type { Place, Side } from '../layout/plan';
import { CORP, STATUS_COLOR, type CorpStyle } from '../theme';
import { BuildCtx, type BuildEnv, type Structure } from './buildctx';
import { seedOf, rng } from './geo';
import { boardSign, neonWord, emblem, FONT_TALL, FONT_UI } from './textures';
import { holoMaterial } from './materials';
import { applySpecial, REPLACES } from './specials';

/*
 * Die Bauwerke der Stadt. Proxmox-Nodes sind Corp-Türme (eigene Architektur
 * je Node), VMs Hochhäuser (Höhe ∝ RAM, Breite ∝ vCPU), Container Stapel aus
 * Modulen, Heimnetz-Geräte kleine Wohn- und Ladenhäuser, Cloud-Dienste
 * Plattformen auf der Insel. Jeder Dienst hängt als Leuchtschild an der
 * Fassade seines Gastes – dort beginnen und enden seine Datenströme.
 */

const ROT: Record<Side, number> = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };
const clamp = THREE.MathUtils.clamp;

export const DISTRICT_TONE: Record<string, string> = {
  'd-pve-node1': '#2a2f3d',
  'd-pve-ai': '#223040',
  'd-pve-print': '#2f2b31',
  'd-thin': '#243033',
  'd-lan': '#35302d',
  'd-plaza': '#2a2f3d',
  'd-out': '#2b2840'
};

export const DISTRICT_ACCENT: Record<string, [string, string]> = {
  'd-pve-node1': ['#ff3b30', '#ff9f1c'],
  'd-pve-ai': ['#00e5ff', '#7a5cff'],
  'd-pve-print': ['#fcee0a', '#ff2a6d'],
  'd-thin': ['#2effc8', '#6f7dff'],
  'd-lan': ['#ffb000', '#ff5ea8'],
  'd-plaza': ['#00f5d4', '#fcee0a'],
  'd-out': ['#b46bff', '#2ec5ff']
};

export function litFor(n: CNode): number {
  if (n.st === 'stopped') return 0;
  const g = model.guestLive(n.id);
  if (g) {
    const ram = g[2] ? Math.min(1, g[1] / g[2]) : 0.3;
    return clamp(0.2 + ram * 0.55 + Math.min(g[0], 60) / 100 * 0.6, 0.14, 0.93);
  }
  const L = model.nodeLive(n.id);
  if (L) return clamp(0.16 + (L.mem / L.memMax) * 0.42 + (L.cpu / 100) * 0.35, 0.16, 0.8);
  return n.st === 'unknown' ? 0.22 : 0.42;
}

function statusSignColor(st: string, fallback: string) {
  if (st === 'crit') return STATUS_COLOR.crit;
  if (st === 'warn') return STATUS_COLOR.warn;
  if (st === 'unknown') return STATUS_COLOR.unknown;
  if (st === 'stopped') return '#56606d';
  return fallback;
}

/* ------------------------------------------------------------------ */
/* Schilder für die Dienste eines Gebäudes                            */
/* ------------------------------------------------------------------ */

export function placeServiceSigns(ctx: BuildCtx, svcIds: string[], w: number, d: number, h: number, y0: number, accent: string, parentStopped: boolean, faces: number[] = [0, Math.PI / 2, -Math.PI / 2, Math.PI]): Set<number> {
  let k = 0;
  const used = new Set<number>();
  for (const face of faces) {
    if (k >= svcIds.length) break;
    const fw = Math.abs(Math.sin(face)) > 0.5 ? d : w;
    const sw = clamp(fw - 2.2, 3.4, 6.6);
    const sh = sw * 0.25;
    for (let y = y0; y + sh <= h - 1.4 && k < svcIds.length; y += sh + 1.0) {
      const id = svcIds[k++];
      const n = model.get(id);
      const col = statusSignColor(parentStopped ? 'stopped' : n.st, accent);
      const rect = boardSign(ctx.env.atlas, n.label, n.sub, col, { dim: parentStopped || n.st === 'stopped' });
      const off = 0.14;
      let x = 0, z = 0;
      if (face === 0) z = d / 2 + off;
      else if (face === Math.PI) z = -d / 2 - off;
      else if (face > 0) x = w / 2 + off;
      else x = -w / 2 - off;
      const fx = n.st === 'crit' ? 1 : n.st === 'warn' ? 2 : n.st === 'unknown' ? 1 : 0;
      const hnd = ctx.sign(rect, sw, sh, x, y + sh / 2, z, face, { intensity: parentStopped ? 0.5 : 1.7, fx: parentStopped ? 0 : fx, seed: seedOf(id) });
      ctx.slot(id, x, y + sh / 2, z, face, hnd);
      used.add(face);
    }
  }
  // Rest (sollte nicht vorkommen): an die Dachkante
  while (k < svcIds.length) {
    const id = svcIds[k++];
    ctx.slot(id, 0, h + 1, d / 2, 0);
  }
  return used;
}

/* ------------------------------------------------------------------ */
/* Anbauten an Fassaden                                                */
/* ------------------------------------------------------------------ */

/** Punkt vor einer Fassadenseite: along = entlang der Wand, out = Abstand vor der Wand */
function onFace(face: number, w: number, d: number, along: number, out: number): [number, number] {
  if (face === 0) return [along, d / 2 + out];
  if (face === Math.PI) return [-along, -d / 2 - out];
  if (face > 0) return [w / 2 + out, -along];
  return [-w / 2 - out, along];
}
const faceWidth = (face: number, w: number, d: number) => Math.abs(Math.sin(face)) > 0.5 ? d : w;

/** Klimageräte auf Deckenhöhe, Fallrohre an den Kanten, Kabelstränge vom Dach */
function facadeGreebles(ctx: BuildCtx, w: number, d: number, h: number, y0: number, floorH: number, faces: number[], seed: number, opts: { ac?: number; pipes?: boolean; cables?: boolean } = {}) {
  const r = rng(seed + 0.61);
  faces.forEach(face => {
    const fw = faceWidth(face, w, d);
    // am Fensterraster des Shaders ausrichten (Geschosse ab y = 0)
    const base = Math.ceil(y0 / floorH) * floorH;
    const floors = Math.floor((h - base) / floorH);
    const n = Math.round((opts.ac ?? 0.12) * floors * (fw / 4));
    for (let i = 0; i < n; i++) {
      const fl = Math.floor(r() * Math.max(1, floors - 1));
      const y = base + fl * floorH + 0.12;
      if (y > h - 1.5) continue;
      const along = (r() - 0.5) * (fw - 1.6);
      const [x, z] = onFace(face, w, d, along, 0.22);
      ctx.metal.box(0.78, 0.48, 0.42, x, y, z, face);
      const fan = new THREE.CylinderGeometry(0.16, 0.16, 0.03, 12);
      fan.rotateX(Math.PI / 2);
      fan.rotateY(face);
      const [gx, gz] = onFace(face, w, d, along + 0.12, 0.44);
      ctx.dark.add(fan, { x: gx, y: y + 0.24, z: gz });
      if (r() > 0.6) {
        const [px2, pz2] = onFace(face, w, d, along - 0.3, 0.1);
        ctx.dark.box(0.04, 1.2, 0.04, px2, y - 1.2, pz2, face);
      }
    }
    if (opts.pipes !== false && r() > 0.3) {
      const along = (r() > 0.5 ? 1 : -1) * (fw / 2 - 0.35);
      const [x, z] = onFace(face, w, d, along, 0.12);
      ctx.dark.cyl(0.07, 0.07, h - 0.3, x, 0.15, z, 8);
      for (let y = 2.5; y < h - 1; y += 3) ctx.dark.box(0.22, 0.06, 0.14, x, y, z, face);
    }
    if (opts.cables !== false && r() > 0.45) {
      const k = 1 + Math.floor(r() * 3);
      for (let i = 0; i < k; i++) {
        const along = (r() - 0.5) * (fw - 2);
        const len = 3 + r() * 7;
        const [x, z] = onFace(face, w, d, along, 0.06 + i * 0.05);
        ctx.dark.box(0.035, len, 0.035, x, h - len, z, face);
      }
    }
  });
}

/** Feuertreppe: Podeste je Geschoss mit Geländer, dazwischen Treppenläufe */
function fireEscape(ctx: BuildCtx, w: number, d: number, face: number, y0: number, floorH: number, floors: number, seed: number) {
  const r = rng(seed + 0.83);
  const fw = faceWidth(face, w, d);
  const width = Math.min(3.2, fw - 1.5);
  const along0 = (r() - 0.5) * Math.max(0, fw - width - 1);
  const base = Math.ceil(y0 / floorH) * floorH;
  for (let f = 1; f < floors; f++) {
    const y = base + (f - 1) * floorH;
    const [x, z] = onFace(face, w, d, along0, 0.6);
    ctx.dark.box(width, 0.07, 1.1, x, y, z, face);
    const [rx, rz] = onFace(face, w, d, along0, 1.13);
    ctx.dark.box(width, 0.05, 0.04, rx, y + 0.95, rz, face);
    for (let k = -1; k <= 1; k++) {
      const [px, pz] = onFace(face, w, d, along0 + k * width * 0.48, 1.13);
      ctx.dark.box(0.04, 0.95, 0.04, px, y, pz, face);
    }
    if (f < floors - 1) {
      const dir = f % 2 ? 1 : -1;
      const [ax, az] = onFace(face, w, d, along0 - dir * width * 0.35, 0.6);
      const [bx, bz] = onFace(face, w, d, along0 + dir * width * 0.35, 0.6);
      ctx.dark.beam(new THREE.Vector3(ax, y + 0.05, az), new THREE.Vector3(bx, y + floorH, bz), 0.12);
    }
  }
}

/** senkrechte Neon-Reklame (Stadtleben, keine Infrastruktur) */
const ADS: Array<[string, string]> = [
  ['BACKUP?', '#ff2a6d'], ['MEHR RAM', '#00e5ff'], ['UPTIME', '#7dff9a'], ['NO CLOUD', '#b46bff'],
  ['RAMEN', '#ff8a2a'], ['KAFFEE', '#ffd23f'], ['SUDO', '#ff5ea8'], ['PING', '#2ec5ff'], ['HOMELAB', '#fcee0a'], ['ROOT', '#ff3b30']
];
function verticalAd(ctx: BuildCtx, w: number, d: number, h: number, face: number, seed: number) {
  const r = rng(seed + 0.29);
  const [text, color] = ADS[Math.floor(r() * ADS.length)];
  const word = neonWord(ctx.env.atlas, text, color, { h: 150, vertical: true, font: FONT_TALL, weight: 600 });
  const vh = Math.min(h * 0.55, text.length * 2.1);
  const vw = vh * (word.w / word.h);
  const fw = faceWidth(face, w, d);
  const along = (r() > 0.5 ? 1 : -1) * (fw / 2 - vw / 2 - 0.7);
  const yc = h - vh / 2 - 2.2;
  const [bx, bz] = onFace(face, w, d, along, 0.3);
  ctx.dark.box(vw + 0.5, vh + 0.6, 0.12, bx, yc - vh / 2 - 0.3, bz, face);
  const [x, z] = onFace(face, w, d, along, 0.55);
  ctx.sign(word, vw, vh, x, yc, z, face, { additive: true, intensity: 2.4, fx: r() > 0.6 ? 1 : 2, seed: r() });
}

function nameSign(ctx: BuildCtx, n: CNode, w: number, d: number, top: number, accent: string, opts: { onRoof?: boolean; y?: number; z?: number } = {}) {
  const sub = [n.ip ? n.ip.replace('192.168.2.', '.') : '', n.vmid != null ? (n.t === 'ct' ? 'CT ' : n.t === 'vm' ? 'VM ' : '') + n.vmid : ''].filter(Boolean).join(' · ') || n.sub;
  const col = statusSignColor(n.st, accent);
  const rect = boardSign(ctx.env.atlas, n.label.toUpperCase(), sub, col, { w: 640, h: 150, dim: n.st === 'stopped' });
  const sw = clamp(w * 0.95, 7, 14);
  const sh = sw * (150 / 640);
  if (opts.onRoof !== false) {
    const y = top + 0.9 + sh / 2;
    const z = opts.z ?? d / 2 - 1.2;
    ctx.dark.box(0.25, sh + 0.9, 0.25, -sw * 0.38, top, z - 0.1);
    ctx.dark.box(0.25, sh + 0.9, 0.25, sw * 0.38, top, z - 0.1);
    ctx.sign(rect, sw, sh, 0, y, z, 0, { intensity: n.st === 'stopped' ? 0.45 : 1.9, seed: seedOf(n.id + 'n') });
  } else {
    ctx.sign(rect, sw, sh, 0, opts.y ?? top - sh, d / 2 + 0.16, 0, { intensity: n.st === 'stopped' ? 0.45 : 1.9, seed: seedOf(n.id + 'n') });
  }
}

/** Statusanzeigen, die nicht von der Datenlage „Strom" abhängen */
function statusMarkers(ctx: BuildCtx, n: CNode, w: number, d: number, top: number) {
  const atlas = ctx.env.atlas;
  if (n.st === 'stopped') {
    const r = boardSign(atlas, 'OFFLINE', 'gestoppt', STATUS_COLOR.crit, { w: 320, h: 110 });
    ctx.sign(r, 4.2, 1.45, 0, 3.4, d / 2 + 0.2, 0, { intensity: 1.6, fx: 1, seed: seedOf(n.id + 'off') }, true);
    // Bretter vor dem Eingang
    ctx.dark.box(3.4, 0.3, 0.12, 0, 0.9, d / 2 + 0.7, 0.25);
    ctx.dark.box(3.4, 0.3, 0.12, 0, 1.6, d / 2 + 0.7, -0.2);
  } else if (n.st === 'warn') {
    ctx.metal.cyl(0.35, 0.45, 0.6, w / 2 - 1.2, top, d / 2 - 1.2);
    ctx.beacon(w / 2 - 1.2, top + 0.95, d / 2 - 1.2, STATUS_COLOR.warn, 1.3, 0.45, 0.5);
  } else if (n.st === 'crit') {
    ctx.beacon(w / 2 - 1.2, top + 0.9, d / 2 - 1.2, STATUS_COLOR.crit, 2.6, 0.5, 0.55);
  } else if (n.st === 'unknown') {
    const r = neonWord(atlas, '?', STATUS_COLOR.unknown, { h: 180, font: FONT_UI, weight: 700 });
    ctx.sign(r, 3.2, 3.2 * (r.h / r.w), 0, top + 3.6, 0, 0, { additive: true, intensity: 2.2, fx: 1, seed: seedOf(n.id + 'q') }, true);
  }
}

function roofClutter(ctx: BuildCtx, w: number, d: number, top: number, seed: number, accent: string) {
  const r = rng(seed + 0.37);
  const r2 = rng(seed + 0.71);
  // Brüstung rundum
  const ph = 0.5;
  ctx.concrete.box(w, ph, 0.2, 0, top, d / 2 - 0.1);
  ctx.concrete.box(w, ph, 0.2, 0, top, -d / 2 + 0.1);
  ctx.concrete.box(0.2, ph, d - 0.4, w / 2 - 0.1, top, 0);
  ctx.concrete.box(0.2, ph, d - 0.4, -w / 2 + 0.1, top, 0);
  // Lüfterpilze
  const vents = 2 + Math.floor(r2() * 4);
  for (let i = 0; i < vents; i++) {
    const x = (r2() - 0.5) * (w - 2), z = -d / 2 + 1 + r2() * Math.max(0.5, d - 4.5);
    ctx.metal.cyl(0.16, 0.16, 0.5, x, top, z, 8);
    ctx.metal.cone(0.3, 0.2, x, top + 0.5, z, 8);
  }
  // Rohrleitung quer übers Dach
  if (r2() > 0.4 && w > 5) {
    const z = -d / 2 + 1.2 + r2() * 1.5;
    ctx.dark.beam(new THREE.Vector3(-w / 2 + 0.8, top + 0.35, z), new THREE.Vector3(w / 2 - 0.8, top + 0.35, z), 0.16);
    for (let x = -w / 2 + 1.5; x < w / 2 - 1; x += 2.2) ctx.dark.box(0.08, 0.3, 0.3, x, top, z);
  }
  // Dachausstieg mit Tür und Licht
  if (w > 7 && d > 7 && r2() > 0.35) {
    const x = (r2() > 0.5 ? 1 : -1) * (w / 2 - 1.8), z = -d / 2 + 1.7;
    ctx.concrete.box(2.2, 2.3, 2.0, x, top, z);
    ctx.roofBag.box(2.5, 0.15, 2.3, x, top + 2.3, z);
    ctx.neon('#ffd9a0', 1.1).box(0.8, 1.7, 0.04, x, top + 0.05, z + 1.02);
    ctx.beacon(x, top + 2.05, z + 1.12, '#ffcf8a', 0, 1, 0.1);
  }
  // Satellitenschüssel
  if (r2() > 0.5) {
    const x = (r2() - 0.5) * (w - 3), z = -d / 2 + 1.5 + r2() * 2;
    const dish = new THREE.SphereGeometry(0.75, 14, 6, 0, Math.PI * 2, 0, Math.PI / 3.2);
    dish.rotateX(-0.95);
    dish.rotateY(r2() * Math.PI * 2);
    ctx.dark.cyl(0.05, 0.07, 0.9, x, top, z, 6);
    ctx.metal.add(dish, { x, y: top + 1.05, z });
  }
  // Solarmodule
  if (w > 9 && d > 9 && r2() > 0.55) {
    const rows = 2 + Math.floor(r2() * 2);
    for (let i = 0; i < rows; i++) {
      const g = new THREE.BoxGeometry(Math.min(4.6, w - 4.5), 0.06, 1.05);
      g.rotateX(-0.42);
      ctx.glass.add(g, { x: -0.6, y: top + 0.55, z: -d / 2 + 2.2 + i * 1.5 });
      ctx.dark.box(0.08, 0.5, 0.08, -0.6, top, -d / 2 + 2.2 + i * 1.5 + 0.3);
    }
  }
  const units = 1 + Math.floor(r() * 3);
  for (let i = 0; i < units; i++) {
    const uw = 1.4 + r() * 1.6, ud = 1.2 + r() * 1.4;
    const x = (r() - 0.5) * (w - uw - 1.5), z = (r() - 0.5) * (d - ud - 2.5) - 0.6;
    ctx.metal.box(uw, 0.9 + r() * 0.6, ud, x, top, z);
    ctx.dark.cyl(0.45, 0.45, 0.12, x, top + 1.5, z, 10);
  }
  if (r() > 0.45) {
    const x = (r() - 0.5) * (w - 3), z = -d / 2 + 2;
    ctx.metal.cyl(1.1, 1.1, 1.8, x, top + 1.2, z, 12);
    for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) ctx.dark.box(0.15, 1.2, 0.15, x + dx, top, z + dz);
  }
  if (r() > 0.3) {
    const x = -w / 2 + 1.2 + r() * 1.5, z = -d / 2 + 1.2;
    const ah = 3 + r() * 5;
    ctx.metal.cyl(0.07, 0.12, ah, x, top, z, 6);
    ctx.beacon(x, top + ah + 0.2, z, '#ff2a3a', 0.6 + r() * 0.5, 0.18, 0.28);
  }
  // Dachkante leuchtet
  if (r() > 0.35) {
    const nb = ctx.neon(accent, 2.4);
    nb.box(w + 0.1, 0.1, 0.1, 0, top - 0.25, d / 2 + 0.02);
  }
}

/* ------------------------------------------------------------------ */
/* Gäste                                                               */
/* ------------------------------------------------------------------ */

export function guestDims(n: CNode): { w: number; d: number; h: number } {
  const r = model.resources(n.id);
  const ram = r.ram || (n.t === 'vm' ? 4 : 1);
  const cpu = r.cpu || 2;
  if (n.t === 'vm') {
    const w = clamp(10.5 + cpu * 0.85, 11, 17.5);
    return { w, d: w * 0.86, h: 10 + Math.sqrt(ram) * 5.2 };
  }
  const w = clamp(8.2 + cpu * 0.8, 8.6, 13.5);
  return { w, d: w * 0.82, h: 6 + Math.sqrt(ram) * 3.4 };
}

function buildHighrise(ctx: BuildCtx, n: CNode, accent: string, accent2: string, tone: string) {
  const { w, d, h } = guestDims(n);
  const seed = seedOf(n.id);
  const r = rng(seed);
  const stopped = n.st === 'stopped';
  ctx.useFacade({ color: tone, seed: seed * 100, lit: litFor(n), warm: 0.35 + r() * 0.5, tint: accent, height: h, win: [1.6 + r() * 0.3, 2.5], metalness: 0.4, roughness: 0.55 });
  const toneC = new THREE.Color(tone);
  const dark = toneC.clone().multiplyScalar(0.62);
  const light = toneC.clone().lerp(new THREE.Color('#5a6b86'), 0.18);
  const podium = 3.4;
  ctx.facade.box(w + 1.4, podium, d + 1.4, 0, 0, 0, 0, dark);
  let topW = w, topD = d;
  const variant = Math.floor(r() * 3);
  let gH = h, gD = d;
  if (variant === 0 || h < 18) {
    ctx.facade.box(w, h - podium, d, 0, podium, 0, 0, toneC);
  } else if (variant === 1) {
    const h1 = (h - podium) * (0.58 + r() * 0.12);
    gH = podium + h1;
    ctx.facade.box(w, h1, d, 0, podium, 0, 0, toneC);
    topW = w * 0.74; topD = d * 0.74;
    ctx.facade.box(topW, h - podium - h1, topD, 0, podium + h1, -d * 0.08, 0, light);
    if (!stopped) ctx.neon(accent, 2.6).box(w + 0.05, 0.14, d + 0.05, 0, podium + h1 - 0.07, 0);
  } else {
    const hw = w * 0.47;
    ctx.facade.box(hw, h - podium, d, -w * 0.265, podium, 0, 0, toneC);
    ctx.facade.box(hw, (h - podium) * 0.84, d * 0.92, w * 0.265, podium, 0, 0, light);
    gH = podium + (h - podium) * 0.84;
    gD = d * 0.92;
    ctx.facade.box(w * 0.2, 3, d * 0.5, 0, podium + (h - podium) * 0.55, 0, 0, dark);
  }
  ctx.roofBag.box(topW + 0.5, 0.45, topD + 0.5, 0, h, variant === 1 && h >= 18 ? -d * 0.08 : 0);
  // Leuchtkanten vorn
  if (!stopped) {
    const nb = ctx.neon(accent, 3.2);
    nb.box(0.2, h - podium - 1, 0.2, w / 2 + 0.06, podium + 0.5, d / 2 + 0.06);
    nb.box(0.2, h - podium - 1, 0.2, -w / 2 - 0.06, podium + 0.5, d / 2 + 0.06);
    if (r() > 0.5) ctx.neon(accent2, 2.8).box(w + 1.5, 0.16, 0.16, 0, podium - 0.1, d / 2 + 0.72);
  }
  // Eingang
  ctx.dark.box(4.2, 0.25, 2.2, 0, 2.9, d / 2 + 1.6);
  ctx.neon(stopped ? '#222831' : '#ffd9a0', stopped ? 0.4 : 2.2).box(2.6, 2.5, 0.08, 0, 0.1, d / 2 + 0.72);
  roofClutter(ctx, topW, topD, h + 0.45, seed, accent);
  const svcIds = n.kids.filter(k => model.get(k).t === 'svc');
  const used = placeServiceSigns(ctx, svcIds, w, d, h, 4.3, accent, stopped);
  const freeFaces = [Math.PI / 2, -Math.PI / 2, Math.PI].filter(f => !used.has(f));
  facadeGreebles(ctx, w, gD, gH, podium, 2.5, freeFaces, seed, { ac: 0.16 });
  const adFace = freeFaces.find(f => Math.abs(f) === Math.PI / 2);
  if (!stopped && adFace !== undefined && gH > 26 && r() > 0.4) verticalAd(ctx, w, gD, gH, adFace, seed);
  nameSign(ctx, n, topW, topD, h + 0.45, accent);
  statusMarkers(ctx, n, w, d, h + 0.45);
  return { top: h + 0.45, w, d };
}

const CONTAINER_TONES = ['#5a2a24', '#1f4a4a', '#6b5a1c', '#3b3f4a', '#2b3a5a', '#4a2448', '#23402c'];

function buildContainers(ctx: BuildCtx, n: CNode, accent: string, _accent2: string, tone: string) {
  const { w, d, h } = guestDims(n);
  const seed = seedOf(n.id);
  const r = rng(seed);
  const stopped = n.st === 'stopped';
  const modH = 2.8;
  const mods = Math.max(2, Math.round(h / modH));
  const top = mods * modH;
  ctx.useFacade({ color: tone, seed: seed * 100, lit: litFor(n), warm: 0.5, tint: accent, height: top, win: [1.25, modH], metalness: 0.5, roughness: 0.5, style: 3 });
  ctx.concrete.box(w + 1.6, 0.4, d + 1.6, 0, 0, 0);
  for (let i = 0; i < mods; i++) {
    const mw = w * (0.78 + r() * 0.26);
    const md = d * (0.78 + r() * 0.26);
    const ox = (r() - 0.5) * Math.max(0, w - mw) * 0.9;
    const oz = (r() - 0.5) * Math.max(0, d - md) * 0.9;
    const c = new THREE.Color(CONTAINER_TONES[Math.floor(r() * CONTAINER_TONES.length)]).lerp(new THREE.Color(tone), 0.35);
    ctx.facade.box(mw, modH - 0.22, md, ox, 0.4 + i * modH, oz, 0, c);
    // Rippen
    for (let k = -1; k <= 1; k += 2) ctx.dark.box(0.14, modH - 0.3, 0.14, ox + k * mw / 2, 0.45 + i * modH, oz + md / 2 + 0.04);
    if (!stopped && r() > 0.55) ctx.neon(r() > 0.5 ? accent : '#ff5ea8', 2.4).box(mw * 0.9, 0.08, 0.08, ox, 0.4 + i * modH + 0.05, oz + md / 2 + 0.08);
  }
  // Außentreppe
  for (let i = 0; i < mods; i++) ctx.dark.box(1.2, 0.12, 2.2, w / 2 + 0.9, 0.4 + i * modH + 1.3, 0);
  ctx.dark.box(0.12, top, 0.12, w / 2 + 1.5, 0.4, 1.0);
  ctx.dark.box(0.12, top, 0.12, w / 2 + 1.5, 0.4, -1.0);
  ctx.roofBag.box(w * 0.8, 0.3, d * 0.8, 0, top + 0.4, 0);
  roofClutter(ctx, w * 0.8, d * 0.8, top + 0.7, seed, accent);
  const svcIds = n.kids.filter(k => model.get(k).t === 'svc');
  placeServiceSigns(ctx, svcIds, w * 0.8, d * 0.8, top + 0.4, 2.2, accent, stopped);
  nameSign(ctx, n, w * 0.8, d * 0.8, top + 0.7, accent);
  statusMarkers(ctx, n, w * 0.8, d * 0.8, top + 0.7);
  return { top: top + 0.7, w, d };
}

/** Vorlage (Template 9000): Blaupausen-Hologramm statt Gebäude */
function buildBlueprint(ctx: BuildCtx, n: CNode) {
  const { w, d, h } = guestDims(n);
  const geo = new THREE.BoxGeometry(w, h, d);
  const edges = new THREE.EdgesGeometry(geo);
  const lm = new THREE.LineBasicMaterial({ color: new THREE.Color('#3aa0ff').multiplyScalar(1.6), transparent: true, opacity: 0.8 });
  const lines = new THREE.LineSegments(edges, lm);
  lines.position.y = h / 2 + 0.2;
  ctx.add(lines, lm);
  const hm = holoMaterial('#1f6fff', { opacity: 0.18, density: 1.4 });
  const vol = new THREE.Mesh(geo, hm);
  vol.position.y = h / 2 + 0.2;
  ctx.add(vol, hm);
  vol.userData.pick = { kind: 'structure', id: n.id };
  ctx.s.pick.push(vol);
  ctx.concrete.box(w + 2, 0.3, d + 2, 0, 0, 0);
  const rect = boardSign(ctx.env.atlas, 'TEMPLATE 9000', 'debian12 · Blaupause', '#3aa0ff', { w: 560, h: 140 });
  ctx.sign(rect, 8, 2, 0, 1.6, d / 2 + 1.3, 0, { intensity: 1.6 });
  ctx.anim((_dt, t) => { lines.rotation.y = Math.sin(t * 0.3) * 0.02; });
  return { top: h + 0.2, w, d };
}

/* ------------------------------------------------------------------ */
/* Corp-Türme                                                          */
/* ------------------------------------------------------------------ */

function towerCommon(ctx: BuildCtx, n: CNode, style: CorpStyle, podiumW: number, podiumH: number) {
  // Host-Dienste an der Sockelfront
  const svcIds = n.kids.filter(k => model.get(k).t === 'svc');
  const atlas = ctx.env.atlas;
  let x = -podiumW / 2 + 5;
  svcIds.forEach(id => {
    const s = model.get(id);
    const rect = boardSign(atlas, s.label, s.sub, statusSignColor(s.st, style.secondary));
    const hnd = ctx.sign(rect, 7.2, 1.8, x, podiumH * 0.55, podiumW / 2 + 0.16, 0, { intensity: 1.8, seed: seedOf(id) });
    ctx.slot(id, x, podiumH * 0.55, podiumW / 2 + 0.16, 0, hnd);
    x += 8.2;
  });
  // Viertel-Tafel am Sockel
  const guests = n.kids.filter(k => ['vm', 'ct'].includes(model.get(k).t)).length;
  const live = model.nodeLive(n.id);
  const sub = `${style.motto} · ${guests} Gäste` + (live ? ` · ${live.thr} Threads · ${live.memMax.toLocaleString('de-DE')} GB` : '');
  const rect = boardSign(atlas, style.district.toUpperCase(), sub, style.primary, { w: 900, h: 140 });
  ctx.sign(rect, 15, 2.35, podiumW / 2 - 9, podiumH + 1.6, podiumW / 2 - 0.5, 0, { intensity: 1.9, tilt: 0.1 });
}

function buildSpire(ctx: BuildCtx, n: CNode, style: CorpStyle, H: number) {
  const seed = seedOf(n.id);
  ctx.useFacade({ color: style.facade, seed: seed * 100, lit: litFor(n), warm: 0.3, tint: style.primary, height: H, win: [2.1, 3.1], band: 12.4, metalness: 0.55, roughness: 0.42 });
  const tone = new THREE.Color('#2a2f3e');
  const pod = 10, W = 26;
  const h1 = H * 0.56, h2 = H * 0.24, h3 = H * 0.12;
  ctx.facade.box(42, pod, 42, 0, 0, 0, 0, tone.clone().multiplyScalar(0.7));
  ctx.glass.box(30, 5, 0.4, 0, 0.3, 21.1);
  ctx.facade.box(W, h1, W, 0, pod, 0, 0, tone);
  ctx.facade.box(W - 5, h2, W - 5, 0, pod + h1, 0, 0, tone.clone().lerp(new THREE.Color('#40485c'), 0.3));
  ctx.facade.box(W - 10, h3, W - 10, 0, pod + h1 + h2, 0, 0, tone);
  const top = pod + h1 + h2 + h3;
  ctx.roofBag.box(W - 9.4, 0.6, W - 9.4, 0, top, 0);
  // Krone: vier Finnen
  const fin = ctx.neon(style.secondary, 3.4);
  for (const [dx, dz, ry] of [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0]] as const) {
    ctx.dark.box(0.8, 16, 4, dx * (W - 10) / 2, top - 8, dz * (W - 10) / 2, ry + Math.PI / 4 * (dx * dz));
    fin.box(0.2, 16, 0.2, dx * ((W - 10) / 2 + 1.3), top - 8, dz * ((W - 10) / 2 + 1.3));
  }
  // Spitze
  ctx.metal.cyl(0.25, 0.8, 22, 0, top, 0, 8);
  ctx.beacon(0, top + 22.4, 0, '#ff2a3a', 0.5, 0.2, 0.7);
  ctx.beacon(0, top + 12, 0, '#ff2a3a', 0.5, 0.2, 0.45);
  // Eckstreifen
  const nb = ctx.neon(style.primary, 3.6);
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    nb.box(0.3, h1 - 2, 0.3, dx * (W / 2 + 0.1), pod + 1, dz * (W / 2 + 0.1));
    nb.box(0.25, h2 - 1, 0.25, dx * ((W - 5) / 2 + 0.1), pod + h1 + 0.5, dz * ((W - 5) / 2 + 0.1));
  }
  nb.box(42.2, 0.3, 0.3, 0, pod - 0.15, 21.1);
  // senkrechte Leuchtschrift
  const word = neonWord(ctx.env.atlas, style.name, style.primary, { h: 200, vertical: true, font: FONT_TALL, weight: 600 });
  const vh = Math.min(h1 * 0.86, style.name.length * 5.6);
  const vw = vh * (word.w / word.h);
  ctx.sign(word, vw, vh, -W / 2 + vw / 2 + 1.2, pod + h1 - vh / 2 - 3, W / 2 + 0.25, 0, { additive: true, intensity: 2.6, fx: 2, seed: seed });
  // Wappen
  const em = emblem(ctx.env.atlas, 'spire', style.primary, style.secondary);
  ctx.sign(em, 11, 11, 0, pod + h1 + h2 * 0.5, (W - 5) / 2 + 0.25, 0, { additive: true, intensity: 2.2 });
  ctx.sign(em, 11, 11, 0, pod + h1 + h2 * 0.5, -(W - 5) / 2 - 0.25, Math.PI, { additive: true, intensity: 2.2 });
  // Holo-Ring um die Krone
  const hm = holoMaterial(style.primary, { opacity: 0.55, density: 3 });
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 2.2, 48, 1, true), hm);
  ring.position.y = top + 3;
  ctx.add(ring, hm);
  ctx.anim((_dt, t) => { ring.rotation.y = t * 0.25; ring.position.y = top + 3 + Math.sin(t * 0.8) * 0.6; });
  towerCommon(ctx, n, style, 42, pod);
  return { top: top + 22, w: 42, d: 42, labelY: top + 26 };
}

function buildFortress(ctx: BuildCtx, n: CNode, style: CorpStyle, H: number) {
  const seed = seedOf(n.id);
  ctx.useFacade({ color: style.facade, seed: seed * 100, lit: litFor(n), warm: 0.2, tint: style.primary, height: H, win: [2.3, 3.2], band: 9.6, metalness: 0.5, roughness: 0.46 });
  const tone = new THREE.Color('#263444');
  const base = 14, W = 34;
  const hMain = H * 0.62, hUp = H * 0.26;
  ctx.facade.oct(46, base, 46, 0, 0, 0, tone.clone().multiplyScalar(0.72));
  ctx.facade.oct(W, hMain, W, 0, base, 0, tone);
  ctx.facade.oct(W - 10, hUp, W - 10, 0, base + hMain, 0, tone.clone().lerp(new THREE.Color('#3a5068'), 0.3));
  const top = base + hMain + hUp;
  ctx.roofBag.oct(W - 9, 0.7, W - 9, 0, top, 0);
  // Kühlrippen an allen vier Seiten
  const fin = ctx.neon(style.primary, 3.0);
  for (let s = 0; s < 4; s++) {
    const a = s * Math.PI / 2;
    for (let k = -2; k <= 2; k++) {
      const off = k * 4.2;
      const px = Math.sin(a) * (W / 2 + 0.9) + Math.cos(a) * off;
      const pz = Math.cos(a) * (W / 2 + 0.9) - Math.sin(a) * off;
      ctx.dark.box(0.5, hMain * 0.78, 2.4, px, base + 3, pz, a + Math.PI / 2);
      fin.box(0.12, hMain * 0.78, 0.12, Math.sin(a) * (W / 2 + 2.15) + Math.cos(a) * off, base + 3, Math.cos(a) * (W / 2 + 2.15) - Math.sin(a) * off);
    }
  }
  // Turbinen auf dem Dach
  const ringN = ctx.neon(style.primary, 3.4);
  for (const [dx, dz] of [[-5.5, -5.5], [5.5, -5.5], [-5.5, 5.5], [5.5, 5.5]]) {
    ctx.metal.cyl(3, 3.2, 4, dx, top + 0.7, dz, 20);
    ringN.torus(3.05, 0.14, dx, top + 4.3, dz, { x: Math.PI / 2 }, undefined, 32);
  }
  ctx.beacon(0, top + 9, 0, '#ff2a3a', 0.55, 0.2, 0.6);
  ctx.metal.cyl(0.2, 0.5, 8, 0, top + 0.7, 0, 8);
  // große Buchstaben
  const word = neonWord(ctx.env.atlas, style.name, style.primary, { h: 220, font: FONT_TALL, weight: 600, pad: 0.5 });
  const wh = 13, ww = wh * (word.w / word.h);
  const inset = (W - 10) / 2 + 0.3;
  [[0, inset, 0], [Math.PI, -inset, 0], [Math.PI / 2, 0, inset], [-Math.PI / 2, 0, -inset]].forEach(([ry, z, x]) => {
    ctx.sign(word, ww, wh, x, base + hMain + hUp * 0.55, z, ry, { additive: true, intensity: 2.8, fx: 2, seed });
  });
  const em = emblem(ctx.env.atlas, 'fortress', style.primary, style.secondary);
  ctx.sign(em, 12, 12, 0, base + hMain * 0.72, W / 2 + 0.3, 0, { additive: true, intensity: 2.2 });
  towerCommon(ctx, n, style, 46, base);
  return { top: top + 9, w: 46, d: 46, labelY: top + 12 };
}

function buildFoundry(ctx: BuildCtx, n: CNode, style: CorpStyle, H: number) {
  const seed = seedOf(n.id);
  ctx.useFacade({ color: style.facade, seed: seed * 100, lit: litFor(n), warm: 0.7, tint: style.primary, height: H, win: [2.0, 3.0], band: 0, metalness: 0.45, roughness: 0.5, style: 2 });
  const tone = new THREE.Color('#2f2c33');
  // Halle mit Oberlichtern
  ctx.facade.box(42, 16, 30, 0, 0, 5, 0, tone.clone().multiplyScalar(0.8));
  ctx.roofBag.box(42.4, 0.5, 30.4, 0, 16, 5);
  for (let i = 0; i < 4; i++) ctx.glass.box(5, 1.2, 22, -13.5 + i * 9, 16.5, 5);
  // Turm hinten links
  ctx.facade.box(20, H, 20, -9, 0, -12, 0, tone);
  ctx.roofBag.box(20.4, 0.6, 20.4, -9, H, -12);
  // Silo vorn rechts
  ctx.facade.cyl(6, 6, H * 0.72, 13, 0, -10, 20, tone.clone().lerp(new THREE.Color('#4a3f2a'), 0.35));
  ctx.metal.cone(6.2, 3, 13, H * 0.72, -10, 20);
  // Schornsteine
  ctx.metal.cyl(1.1, 1.4, 16, -2, 16, 12, 12);
  ctx.metal.cyl(1.1, 1.4, 20, 6, 16, 12, 12);
  ctx.beacon(-2, 32.3, 12, '#ff2a3a', 0.7, 0.2, 0.35);
  ctx.beacon(6, 36.3, 12, '#ff2a3a', 0.7, 0.2, 0.35);
  // Warnstreifen
  const y1 = ctx.neon(style.primary, 3.2), m1 = ctx.neon(style.secondary, 3.0);
  y1.box(42.2, 0.3, 0.3, 0, 15.8, 20.15);
  m1.box(42.2, 0.3, 0.3, 0, 0.6, 20.15);
  for (let i = 0; i < 4; i++) y1.box(0.3, H - 2, 0.3, -9 + (i < 2 ? -10.1 : 10.1), 1, -12 + (i % 2 ? -10.1 : 10.1));
  m1.torus(6.05, 0.16, 13, H * 0.72 - 0.4, -10, { x: Math.PI / 2 }, undefined, 40);
  m1.torus(6.05, 0.16, 13, H * 0.36, -10, { x: Math.PI / 2 }, undefined, 40);
  // Förderband Silo → Halle
  ctx.dark.beam(new THREE.Vector3(8, H * 0.6, -6), new THREE.Vector3(2, 16.5, 2), 1.2);
  // Name
  const word = neonWord(ctx.env.atlas, style.name, style.primary, { h: 220, font: FONT_TALL, weight: 600, pad: 0.5 });
  const wh = 10, ww = wh * (word.w / word.h);
  ctx.sign(word, ww, wh, -9, H - 7, -1.7, 0, { additive: true, intensity: 2.8, fx: 2, seed });
  const em = emblem(ctx.env.atlas, 'foundry', style.primary, style.secondary);
  ctx.sign(em, 9, 9, -9, H - 17.5, -1.7, 0, { additive: true, intensity: 2.3 });
  // Rauch wird in fx.ts an diese Punkte gehängt
  ctx.s.group.userData.smoke = [ctx.w(-2, 32.5, 12), ctx.w(6, 36.5, 12)];
  towerCommon(ctx, n, style, 42, 16);
  return { top: H, w: 42, d: 42, labelY: H + 4 };
}

function buildOutpost(ctx: BuildCtx, n: CNode, style: CorpStyle, H: number) {
  const seed = seedOf(n.id);
  ctx.useFacade({ color: style.facade, seed: seed * 100, lit: litFor(n), warm: 0.25, tint: style.primary, height: H, win: [1.5, 2.4], band: 6, metalness: 0.45, roughness: 0.5 });
  const tone = new THREE.Color('#243033');
  ctx.facade.box(14, 3.2, 14, 0, 0, 0, 0, tone.clone().multiplyScalar(0.7));
  ctx.facade.box(9, H - 3.2, 9, 0, 3.2, 0, 0, tone);
  ctx.roofBag.box(9.4, 0.5, 9.4, 0, H, 0);
  const nb = ctx.neon(style.primary, 3.2);
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) nb.box(0.18, H - 4, 0.18, dx * 4.56, 3.7, dz * 4.56);
  // Antenne + Schüssel
  ctx.metal.cyl(0.08, 0.16, 7, 2.6, H + 0.5, -2.6, 6);
  ctx.beacon(2.6, H + 7.7, -2.6, '#ff2a3a', 0.65, 0.2, 0.3);
  const dish = new THREE.SphereGeometry(1.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3.2);
  ctx.metal.add(dish, { x: -2.4, y: H + 1.6, z: 2.4 }, { x: -0.9, y: 0.6 });
  // Stimme im Cluster: großes Licht auf dem Dach
  const votes = model.votes(n.id);
  ctx.metal.cyl(0.6, 0.8, 1.2, 0, H + 0.5, 0, 12);
  ctx.beacon(0, H + 2.4, 0, votes > 0 ? '#00f5d4' : '#5a1f2a', 0, 1, 0.8);
  // Name senkrecht
  const word = neonWord(ctx.env.atlas, style.name, style.primary, { h: 180, vertical: true, font: FONT_TALL, weight: 600 });
  const vh = Math.min(H - 6, style.name.length * 2.6), vw = vh * (word.w / word.h);
  ctx.sign(word, vw, vh, -4.5 + vw / 2 + 0.4, 4 + vh / 2, 4.75, 0, { additive: true, intensity: 2.5, fx: 2, seed });
  // Host-Dienste (Wyse haben keine eigenen) – Tafel mit Stimme
  const rect = boardSign(ctx.env.atlas, `${votes} STIMME${votes === 1 ? '' : 'N'}`, 'Corosync', votes > 0 ? '#00f5d4' : '#ff5a6a', { w: 420, h: 120 });
  ctx.sign(rect, 5.6, 1.6, 0, 1.7, 7.15, 0, { intensity: 1.8 });
  const svcIds = n.kids.filter(k => model.get(k).t === 'svc');
  placeServiceSigns(ctx, svcIds, 9, 9, H, 5, style.primary, false, [Math.PI / 2, -Math.PI / 2]);
  return { top: H + 7, w: 14, d: 14, labelY: H + 3 };
}

/* ------------------------------------------------------------------ */
/* Heimnetz                                                            */
/* ------------------------------------------------------------------ */

function buildHouse(ctx: BuildCtx, n: CNode, accent: string, accent2: string, tone: string) {
  const seed = seedOf(n.id);
  const r = rng(seed);
  const w = 11 + r() * 3, d = 9 + r() * 3;
  const floors = 2 + Math.floor(r() * 3);
  const h = 3.4 + floors * 2.6;
  ctx.useFacade({ color: tone, seed: seed * 100, lit: n.st === 'stopped' ? 0 : 0.55 + r() * 0.3, warm: 0.8, tint: accent2, height: h, win: [1.5, 2.6], metalness: 0.2, roughness: 0.75, style: 1 });
  const toneC = new THREE.Color(tone);
  ctx.facade.box(w, 3.4, d, 0, 0, 0, 0, toneC.clone().multiplyScalar(0.7));
  ctx.facade.box(w - 0.6, h - 3.4, d - 0.6, 0, 3.4, 0, 0, toneC);
  ctx.roofBag.box(w - 0.2, 0.4, d - 0.2, 0, h, 0);
  // Ladenfront
  ctx.neon(accent, 2.2).box(w * 0.7, 2.2, 0.08, 0, 0.4, d / 2 + 0.05);
  ctx.dark.box(w * 0.86, 0.2, 1.8, 0, 3.0, d / 2 + 0.85, 0);
  ctx.neon(accent2, 2.8).box(w * 0.86, 0.12, 0.12, 0, 3.0, d / 2 + 1.72);
  // Balkone
  for (let f = 0; f < floors; f++) {
    if (r() > 0.5) {
      const bx = (r() - 0.5) * (w - 4), by = 3.4 + f * 2.6 + 0.2;
      ctx.dark.box(3, 0.15, 1.2, bx, by, d / 2 + 0.3);
      ctx.dark.box(3, 0.05, 0.05, bx, by + 0.95, d / 2 + 0.88);
      for (const k of [-1.45, 0, 1.45]) ctx.dark.box(0.04, 0.95, 0.04, bx + k, by + 0.15, d / 2 + 0.88);
    }
  }
  const escFace = r() > 0.5 ? Math.PI / 2 : -Math.PI / 2;
  fireEscape(ctx, w - 0.6, d - 0.6, escFace, 3.4, 2.6, floors + 1, seed);
  facadeGreebles(ctx, w - 0.6, d - 0.6, h, 3.4, 2.6, [-escFace, Math.PI], seed, { ac: 0.4 });
  roofClutter(ctx, w - 0.6, d - 0.6, h + 0.4, seed, accent);
  nameSign(ctx, n, w, d, h + 0.4, accent);
  statusMarkers(ctx, n, w, d, h + 0.4);
  return { top: h + 0.4, w, d };
}

/* ------------------------------------------------------------------ */
/* Einstieg                                                            */
/* ------------------------------------------------------------------ */

export function buildStructure(id: string, place: Place, env: BuildEnv): Structure {
  const n = model.get(id);
  const lot = place.lot;
  const rot = place.anchored ? 0 : ROT[lot.door.side];
  const ctx = new BuildCtx(id, place, env, rot, n.t, n.st);
  const [accent, accent2] = DISTRICT_ACCENT[lot.district] || ['#2ec5ff', '#ff2a6d'];
  const tone = DISTRICT_TONE[lot.district] || '#2a2f3d';
  let res: { top: number; w: number; d: number; labelY?: number } | null = null;

  if (n.t === 'pve') {
    const style = CORP[n.id] || { name: n.label.toUpperCase(), motto: 'Proxmox-Node', district: n.label, primary: accent, secondary: accent2, facade: tone, archetype: 'outpost' as const };
    const L = model.nodeLive(n.id);
    const mem = L ? L.memMax : 16;
    if (style.archetype === 'outpost') res = buildOutpost(ctx, n, style, 12 + mem * 0.6);
    else if (style.archetype === 'fortress') res = buildFortress(ctx, n, style, 30 + mem * 1.2);
    else if (style.archetype === 'foundry') res = buildFoundry(ctx, n, style, 30 + mem * 1.2);
    else res = buildSpire(ctx, n, style, 30 + mem * 1.2);
  } else if (n.t === 'vm') {
    res = n.vmid === 9000 ? buildBlueprint(ctx, n) : buildHighrise(ctx, n, accent, accent2, tone);
  } else if (n.t === 'ct') {
    res = buildContainers(ctx, n, accent, accent2, tone);
  } else if (n.t === 'client' && !REPLACES.has(n.id)) {
    res = buildHouse(ctx, n, accent, accent2, tone);
  }
  // Sonderbauten und Details je Knoten
  const special = applySpecial(ctx, n, res);
  if (special) res = special;
  if (!res) res = { top: 6, w: 10, d: 10 };
  const radius = Math.max(res.w, res.d) * 0.75 + 2;
  const s = ctx.finish(res.top, radius, res.labelY);
  return s;
}

