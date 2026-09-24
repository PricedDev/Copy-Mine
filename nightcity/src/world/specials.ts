import * as THREE from 'three';
import { model, type CNode } from '../data/model';
import { plan } from '../layout/plan';
import type { BuildCtx } from './buildctx';
import { boardSign, neonWord, FONT_TALL, FONT_UI, FONT_MONO, mixHex } from './textures';
import { holoMaterial } from './materials';
import { seedOf, rng } from './geo';
import { STATUS_COLOR } from '../theme';

/*
 * Sonderbauten und Details: jedes Bauwerk erzählt, was es ist.
 * Werte (Modellnamen, Vektoranzahl, Ports, Ablaufdaten …) kommen aus data.js.
 */

type Res = { top: number; w: number; d: number; labelY?: number } | null;
type Special = (ctx: BuildCtx, n: CNode, res: Res) => Res | void;

/* ------------------------------------------------------------------ */
/* Helfer                                                              */
/* ------------------------------------------------------------------ */

function holoMesh(ctx: BuildCtx, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, x: number, y: number, z: number, opts: { opacity?: number; density?: number } = {}) {
  const m = holoMaterial(color, opts);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  ctx.add(mesh, m);
  return mesh;
}

/** freistehende Leuchtschrift (eigene Textur, drehbar) */
function textPlane(ctx: BuildCtx, text: string, color: string, height: number, x: number, y: number, z: number, opts: { font?: string; weight?: number; rotY?: number; intensity?: number } = {}) {
  const font = opts.font ?? FONT_TALL;
  const weight = opts.weight ?? 600;
  const c = document.createElement('canvas');
  const px = 160;
  const probe = c.getContext('2d')!;
  probe.font = `${weight} ${px}px ${font}`;
  const tw = Math.ceil(probe.measureText(text).width + px * 0.8);
  c.width = Math.min(2048, tw);
  c.height = Math.ceil(px * 1.4);
  const g = c.getContext('2d')!;
  g.font = `${weight} ${px}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = px * 0.3;
  g.fillStyle = color;
  g.fillText(text, c.width / 2, c.height / 2);
  g.shadowBlur = px * 0.08;
  g.fillStyle = mixHex(color, '#ffffff', 0.7);
  g.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, color: new THREE.Color(1, 1, 1).multiplyScalar(opts.intensity ?? 2.2) });
  mat.userData.base = mat.color.clone();
  const w = height * (c.width / c.height);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, height), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = opts.rotY ?? 0;
  mesh.renderOrder = 7;
  ctx.add(mesh, mat);
  return mesh;
}

/** animierter Bildschirm mit eigener Canvas-Textur */
function screen(ctx: BuildCtx, w: number, h: number, x: number, y: number, z: number, rotY: number, fps: number, draw: (g: CanvasRenderingContext2D, W: number, H: number, t: number) => void, px = 256) {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round(px * h / w);
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.7, 1.7, 1.7) });
  mat.userData.base = mat.color.clone();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  ctx.add(mesh, mat);
  let acc = 1e9;
  const step = 1 / fps;
  ctx.anim((dt, t) => {
    acc += dt;
    if (acc < step) return;
    acc = 0;
    draw(g, c.width, c.height, t);
    tex.needsUpdate = true;
  });
  draw(g, c.width, c.height, 0);
  tex.needsUpdate = true;
  return mesh;
}

/** Welt → lokale Koordinaten des Bauwerks */
function L(ctx: BuildCtx, wx: number, wz: number) {
  const inv = ctx.m.clone().invert();
  const v = new THREE.Vector3(wx, 0, wz).applyMatrix4(inv);
  return { x: v.x, z: v.z };
}

function smallBoard(ctx: BuildCtx, title: string, sub: string, color: string, w: number, x: number, y: number, z: number, rotY = 0, fx: 0 | 1 | 2 | 3 = 0, status = false) {
  const rect = boardSign(ctx.env.atlas, title, sub, color, { w: 512, h: 128 });
  return ctx.sign(rect, w, w * 0.25, x, y, z, rotY, { intensity: 1.8, fx, seed: seedOf(title + x) }, status);
}

function pulseRings(ctx: BuildCtx, color: string, x: number, y: number, z: number, maxR: number, count = 3, speed = 0.5, vertical = false) {
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const m = holoMaterial(color, { opacity: 0.9, density: 0.01 });
    const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 48), m);
    if (!vertical) r.rotation.x = Math.PI / 2;
    r.position.set(x, y, z);
    ctx.add(r, m);
    rings.push(r);
  }
  ctx.anim((_dt, t) => {
    rings.forEach((r, i) => {
      const k = (t * speed + i / count) % 1;
      const s = 0.5 + k * maxR;
      r.scale.set(s, s, s * (vertical ? 1 : 1));
      (r.material as THREE.ShaderMaterial).uniforms.uOpacity.value = (1 - k) * 0.9;
    });
  });
}

/* ------------------------------------------------------------------ */
/* Proxmox-Viertel                                                     */
/* ------------------------------------------------------------------ */

const hub: Special = (ctx, _n, res) => {
  if (!res) return;
  const top = res.top;
  // Holo-Kern (Wissensbasis) auf dem Dach
  const core = holoMesh(ctx, new THREE.IcosahedronGeometry(2.4, 2), '#ff5ea8', 0, top + 7.5, -0.5, { opacity: 0.5, density: 3 });
  const shellG = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(4.2, 1));
  const lm = new THREE.LineBasicMaterial({ color: new THREE.Color('#2ec5ff').multiplyScalar(2.6), transparent: true, opacity: 0.85 });
  lm.userData.base = lm.color.clone();
  const shell = new THREE.LineSegments(shellG, lm);
  shell.position.set(0, top + 7.5, -0.5);
  ctx.add(shell, lm);
  ctx.metal.cyl(1.4, 2.0, 2.2, 0, top, -0.5, 12);
  ctx.neon('#2ec5ff', 3).torus(1.6, 0.1, 0, top + 2.3, -0.5);
  ctx.anim((_dt, t) => {
    shell.rotation.y = t * 0.35; shell.rotation.x = Math.sin(t * 0.3) * 0.2;
    core.rotation.y = -t * 0.5;
    const s = 1 + Math.sin(t * 2.2) * 0.06;
    core.scale.set(s, s, s);
  });
  // Funkmast hinten rechts
  const mx = res.w / 2 - 2.2, mz = -res.d / 2 + 2.2;
  for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) ctx.dark.box(0.12, 14, 0.12, mx + dx * (1 - 0), top, mz + dz);
  for (let k = 1; k < 7; k++) ctx.dark.box(1.3, 0.08, 1.3, mx, top + k * 2, mz);
  ctx.beacon(mx, top + 14.5, mz, '#ff2a6d', 1.2, 0.3, 0.4);
  pulseRings(ctx, '#ff2a6d', mx, top + 14.5, mz, 9, 3, 0.45, true);
  smallBoard(ctx, 'STATUS-BOT', 'Chat & Status', '#ff2a6d', 4, mx, top + 3.6, mz + 0.8, 0);
};

const checkmk: Special = (ctx, _n, res) => {
  if (!res) return;
  const top = res.top;
  // Lichtbalken rot/blau
  ctx.dark.box(4.4, 0.5, 1.1, 0, top, res.d / 2 - 1.6);
  ctx.beacon(-1.3, top + 0.8, res.d / 2 - 1.6, '#ff1e3c', 3.2, 0.45, 0.55);
  const b2 = ctx.env.beacons.add(ctx.w(1.3, top + 0.8, res.d / 2 - 1.6), '#1e6bff', 3.2, 0.45, 0.55, 0.5);
  ctx.s.beacons.push(b2);
  // Suchscheinwerfer
  const cone = new THREE.ConeGeometry(4, 26, 24, 1, true);
  cone.translate(0, -13, 0);
  cone.rotateX(-Math.PI / 2.6);
  const beam = holoMesh(ctx, cone, '#bfe6ff', 2.5, top + 2.4, -1.5, { opacity: 0.14, density: 0.01 });
  ctx.metal.cyl(0.6, 0.8, 1.6, 2.5, top, -1.5, 10);
  ctx.anim((_dt, t) => { beam.rotation.y = t * 0.7; });
  // Drohnen-Landeplatz
  ctx.neon('#7dff5a', 2.2).torus(2.2, 0.08, -2.4, top + 0.12, -1.6);
  smallBoard(ctx, 'MONITORING-REVIER', '31 Hosts · Site „monitoring"', '#7dff5a', 7.5, 0, 2.2, res.d / 2 + 2.9, 0);
};

const truenas: Special = (ctx, _n, res) => {
  if (!res) return;
  for (let i = 0; i < 3; i++) {
    const x = -res.w / 2 - 0.2 + i * 3.4, z = -res.d / 2 - 2.6;
    ctx.metal.cyl(1.4, 1.4, 7, x, 0, z, 16);
    ctx.neon('#ffb000', 2.4).torus(1.42, 0.07, x, 5.4, z);
    ctx.metal.cone(1.45, 1, x, 7, z, 16);
  }
  smallBoard(ctx, 'KEIN BACKUP', 'ZFS ist kein Backup', STATUS_COLOR.warn, 5.4, 0, res.top - 3.5, res.d / 2 + 0.2, 0, 2, true);
};

const mailprojekt: Special = (ctx, _n, res) => {
  if (!res) return;
  const z = res.d / 2 + 2.2;
  // Einlass-Bogen: einziger öffentlicher Eingang
  ctx.dark.box(0.6, 6, 0.6, -3.4, 0, z);
  ctx.dark.box(0.6, 6, 0.6, 3.4, 0, z);
  ctx.dark.box(7.6, 0.8, 0.8, 0, 6, z);
  ctx.neon('#ff8a2a', 3).box(7.2, 0.14, 0.14, 0, 6.85, z + 0.35);
  smallBoard(ctx, 'ÖFFENTLICHER EINGANG', 'Portfreigabe 80/443', '#ff8a2a', 6.8, 0, 8.3, z, 0);
  smallBoard(ctx, 'GESTOPPT', 'wird durch externen Hoster ersetzt', STATUS_COLOR.crit, 4.8, -res.w / 2 - 0.2, 6, 0, -Math.PI / 2, 1, true);
};

const grafana: Special = (ctx, _n, res) => {
  if (!res) return;
  const top = res.top;
  const dome = new THREE.SphereGeometry(3.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  ctx.glass.add(dome, { x: 0, y: top, z: -0.6 });
  ctx.neon('#ff9f1c', 2.4).torus(3.22, 0.08, 0, top + 0.1, -0.6);
  // zwei Monitore mit Kurven (Prometheus scrapt nur Node Proxmox)
  const series = (seed: number) => {
    const r = rng(seed);
    return Array.from({ length: 48 }, () => r());
  };
  const a = series(1), b = series(2);
  const draw = (g: CanvasRenderingContext2D, W: number, H: number, t: number, s: number[], col: string, title: string) => {
    g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(80,100,130,0.35)'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, H * i / 4); g.lineTo(W, H * i / 4); g.stroke(); }
    const off = Math.floor(t * 3);
    g.strokeStyle = col; g.lineWidth = 3; g.shadowColor = col; g.shadowBlur = 8;
    g.beginPath();
    for (let i = 0; i < 40; i++) {
      const v = s[(i + off) % s.length];
      const y = H * 0.85 - v * H * 0.6;
      if (i) g.lineTo(i / 39 * W, y); else g.moveTo(0, y);
    }
    g.stroke(); g.shadowBlur = 0;
    g.fillStyle = col; g.font = `600 ${H * 0.16}px ${FONT_MONO}`; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(title, 8, 6);
  };
  screen(ctx, 4.2, 2.4, -2.4, top - 4.5, res.d / 2 + 0.16, 0, 3, (g, W, H, t) => draw(g, W, H, t, a, '#ff9f1c', 'pve · node1'));
  screen(ctx, 4.2, 2.4, 2.4, top - 4.5, res.d / 2 + 0.16, 0, 3, (g, W, H, t) => draw(g, W, H, t, b, '#2ec5ff', 'node_exporter'));
};

const teamspeak: Special = (ctx, _n, res) => {
  if (!res) return;
  const top = res.top;
  ctx.metal.cyl(0.12, 0.3, 12, 1.5, top, -1.5, 8);
  ctx.beacon(1.5, top + 12.3, -1.5, '#ff2a3a', 0.9, 0.2, 0.3);
  pulseRings(ctx, '#2ec5ff', 1.5, top + 9, -1.5, 7, 4, 0.65);
  const dish = new THREE.SphereGeometry(1.8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3);
  ctx.metal.add(dish, { x: -2, y: top + 1.6, z: 1.5 }, { x: -1.0, y: 0.4 });
};

const satisfactory: Special = (ctx, _n, res) => {
  if (!res) return;
  // Förderband quer vor dem Gebäude mit wandernden Kisten
  const z = res.d / 2 + 2.6;
  ctx.dark.box(res.w + 2, 0.6, 1.4, 0, 1.2, z);
  for (const x of [-res.w / 2, 0, res.w / 2]) ctx.dark.box(0.3, 1.2, 0.3, x, 0, z);
  ctx.neon('#ff8a2a', 2.6).box(res.w + 2, 0.08, 0.08, 0, 1.85, z + 0.72);
  const crateMat = new THREE.MeshStandardMaterial({ color: '#b86a1c', roughness: 0.6, metalness: 0.2, emissive: '#3a1a00', emissiveIntensity: 0.6 });
  const crates: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), crateMat);
    c.position.set(0, 2.15, z);
    ctx.add(c);
    crates.push(c);
  }
  const span = res.w + 1.6;
  ctx.anim((_dt, t) => crates.forEach((c, i) => { c.position.x = ((t * 1.4 + i * span / 5) % span) - span / 2; }));
  smallBoard(ctx, 'SATISFACTORY', '7777 TCP/UDP · 8888', '#ff8a2a', 5, 0, res.top - 2.4, res.d / 2 + 0.25, 0);
};

/* ------------------------------------------------------------------ */
/* Insel: Internet & Cloud                                             */
/* ------------------------------------------------------------------ */

interface CloudSpec { shape: 'tower' | 'hall' | 'mast' | 'tunnel' | 'bank' | 'slim'; h: number; color: string; icon: string; }

const CLOUD: Record<string, CloudSpec> = {
  claude: { shape: 'slim', h: 34, color: '#ffb36b', icon: '✦' },
  discord: { shape: 'mast', h: 30, color: '#7a8cff', icon: '◉' },
  resend: { shape: 'tower', h: 20, color: '#2ec5ff', icon: '✉' },
  strato: { shape: 'hall', h: 10, color: '#ff9f1c', icon: '✉' },
  google: { shape: 'tower', h: 26, color: '#fcee0a', icon: '⚿' },
  paypal: { shape: 'bank', h: 14, color: '#2ec5ff', icon: '$' },
  webpush: { shape: 'mast', h: 18, color: '#b46bff', icon: '◈' },
  le: { shape: 'hall', h: 11, color: '#2effc8', icon: '🔒' },
  ddns: { shape: 'slim', h: 16, color: '#d05bff', icon: '?' },
  ngrok: { shape: 'tunnel', h: 6, color: '#ff5ea8', icon: '⇄' }
};

const cloudPlatform: Special = (ctx, n) => {
  const spec = CLOUD[n.id] || { shape: 'tower', h: 18, color: '#b46bff', icon: '◆' };
  const seed = seedOf(n.id);
  const lit = n.st === 'stopped' ? 0 : 0.5;
  ctx.useFacade({ color: '#2b2840', seed: seed * 100, lit, warm: 0.2, tint: spec.color, height: spec.h, win: [1.4, 2.4], band: spec.shape === 'slim' ? 4 : 0, metalness: 0.55, roughness: 0.4 });
  ctx.concrete.box(20, 0.8, 20, 0, 0, 0);
  ctx.neon(spec.color, 2.4).box(20.1, 0.1, 0.1, 0, 0.75, 10.02);
  const base = new THREE.Color('#2b2840');
  let top = spec.h;
  let w = 12, d = 12;
  if (spec.shape === 'tower') {
    ctx.facade.box(12, spec.h, 12, 0, 0.8, 0, 0, base);
    ctx.facade.box(8, 5, 8, 0, spec.h + 0.8, 0, 0, base.clone().multiplyScalar(1.2));
    top = spec.h + 5.8;
  } else if (spec.shape === 'slim') {
    ctx.facade.oct(8, spec.h, 8, 0, 0.8, 0, base);
    ctx.metal.cone(3.6, 6, 0, spec.h + 0.8, 0, 8);
    top = spec.h + 6.8; w = 8; d = 8;
  } else if (spec.shape === 'hall') {
    ctx.facade.box(16, spec.h, 12, 0, 0.8, 0, 0, base);
    ctx.roofBag.box(16.4, 0.5, 12.4, 0, spec.h + 0.8, 0);
    top = spec.h + 1.3; w = 16;
  } else if (spec.shape === 'bank') {
    ctx.facade.box(15, spec.h, 11, 0, 0.8, -1, 0, base);
    for (let i = 0; i < 5; i++) ctx.concrete.cyl(0.45, 0.45, spec.h - 2, -6 + i * 3, 0.8, 5.2, 12);
    ctx.concrete.box(16, 1.4, 12.5, 0, spec.h + 0.8, -0.5);
    top = spec.h + 2.2; w = 16;
  } else if (spec.shape === 'mast') {
    ctx.facade.box(9, 8, 9, 0, 0.8, 0, 0, base);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.dark.box(0.2, spec.h, 0.2, dx * 1.2, 8.8, dz * 1.2);
    for (let k = 1; k < spec.h / 3; k++) ctx.dark.box(2.6, 0.12, 2.6, 0, 8.8 + k * 3, 0);
    top = spec.h + 8.8; w = 9; d = 9;
    ctx.beacon(0, top + 0.4, 0, '#ff2a3a', 0.8, 0.2, 0.4);
    pulseRings(ctx, spec.color, 0, top - 2, 0, 10, 3, 0.4, true);
  } else if (spec.shape === 'tunnel') {
    const arch = new THREE.CylinderGeometry(5, 5, 12, 24, 1, true, -Math.PI / 2, Math.PI);
    arch.rotateZ(Math.PI / 2);
    arch.rotateY(Math.PI / 2);
    ctx.concrete.add(arch, { x: 0, y: 0.8, z: 0 });
    ctx.neon(spec.color, 1.6).torus(5, 0.12, 0, 0.8, 6, { x: 0 });
    top = 6; w = 10; d = 12;
  }
  // Holo-Symbol und Name
  const icon = neonWord(ctx.env.atlas, spec.icon, spec.color, { h: 180, font: FONT_UI, weight: 700, pad: 0.4 });
  const iconMesh = ctx.sign(icon, 3.4, 3.4 * icon.h / icon.w, 0, top + 3, 0, 0, { additive: true, intensity: 2.2, fx: 2, seed });
  void iconMesh;
  const name = n.label.toUpperCase();
  const rect = boardSign(ctx.env.atlas, name, n.sub, n.st === 'warn' ? STATUS_COLOR.warn : n.st === 'unknown' ? STATUS_COLOR.unknown : spec.color, { w: 640, h: 150 });
  const sw = 11;
  ctx.sign(rect, sw, sw * 150 / 640, 0, 3.4, Math.max(d, 12) / 2 + 1.2, 0, { intensity: 1.9 });
  if (n.id === 'paypal') smallBoard(ctx, 'SANDBOX', 'noch nicht live', STATUS_COLOR.warn, 4, 0, top + 6, 0, 0, 2, true);
  if (n.id === 'claude') {
    // Landeplatz für das Claude-AV
    ctx.neon('#ffb36b', 2.4).torus(2.6, 0.1, 0, top - 5.9, 0);
    ctx.s.group.userData.pad = ctx.w(0, top - 5.8, 0);
  }
  return { top, w, d, labelY: top + 5 };
};

const bridgehead: Special = (ctx, n) => {
  // Uplink-Terminal: das Tor ins Internet
  ctx.concrete.box(49, 0.8, 19, 0, 0, 0);
  ctx.useFacade({ color: '#2b2840', seed: 11, lit: 0.55, warm: 0.3, tint: '#b46bff', height: 30, win: [1.6, 2.6], band: 5, metalness: 0.5, roughness: 0.4 });
  for (const x of [-9, 9]) ctx.facade.oct(6, 30, 6, x, 0.8, -4, new THREE.Color('#2b2840'));
  ctx.dark.box(24, 2.4, 4, 0, 28, -4);
  const ringM = ctx.neon('#b46bff', 3.2);
  ringM.torus(7.5, 0.3, 0, 17, -4, { x: 0 });
  const gate = holoMesh(ctx, new THREE.CircleGeometry(7.2, 48), '#6f7dff', 0, 17, -4, { opacity: 0.35, density: 1.5 });
  ctx.anim((_dt, t) => { gate.rotation.z = t * 0.2; });
  textPlane(ctx, 'THE NET', '#b46bff', 3.4, 0, 31.8, -1.8, { font: FONT_TALL });
  const live = n.sub;
  smallBoard(ctx, 'INTERNET · UPLINK', live, '#b46bff', 8, 0, 3.4, 5.6, 0);
  ctx.beacon(-9, 31, -4, '#ff2a3a', 0.6, 0.2, 0.45);
  ctx.beacon(9, 31, -4, '#ff2a3a', 0.6, 0.2, 0.45);
  // Ankunftshalle
  ctx.glass.box(18, 0.3, 7, -14, 4.2, 4.5);
  for (const x of [-22, -6]) for (const z of [1.5, 7.5]) ctx.dark.box(0.3, 4.2, 0.3, x, 0.8, z);
  return { top: 32, w: 49, d: 19, labelY: 36 };
};

const domain: Special = (ctx, n) => {
  // Wegweiser-Pylon an der Brückenauffahrt
  const col = n.st === 'crit' ? STATUS_COLOR.crit : '#ff8a2a';
  ctx.metal.cyl(0.3, 0.45, 10, 0, 0.8, 0, 8);
  const rect = boardSign(ctx.env.atlas, n.label, n.sub, col, { w: 720, h: 160 });
  ctx.sign(rect, 9, 2, 0, 11.2, 0.3, 0, { intensity: 2, fx: n.st === 'crit' ? 1 : 0, seed: seedOf(n.id) });
  ctx.dark.box(9.4, 2.4, 0.3, 0, 10, 0);
  return { top: 12.6, w: 9, d: 2, labelY: 14 };
};

/* ------------------------------------------------------------------ */
/* Speedport-Tor                                                       */
/* ------------------------------------------------------------------ */

const speedport: Special = (ctx, n) => {
  ctx.useFacade({ color: '#2a2f3d', seed: 3, lit: 0.62, warm: 0.3, tint: '#ff8a2a', height: 14, win: [1.6, 2.5], band: 4.6, metalness: 0.5, roughness: 0.45 });
  const tone = new THREE.Color('#2a2f3d');
  ctx.facade.box(17, 14, 15, 0, 0, -1, 0, tone);
  ctx.facade.box(12, 4, 10, 0, 14, -2, 0, tone.clone().multiplyScalar(1.15));
  ctx.roofBag.box(12.4, 0.4, 10.4, 0, 18, -2);
  // WLAN-Antennen
  for (let i = 0; i < 4; i++) {
    const x = -4.5 + i * 3;
    ctx.metal.cyl(0.12, 0.18, 4.5, x, 18.4, -5, 6);
    ctx.beacon(x, 23.1, -5, '#2ec5ff', 1.5 + i * 0.2, 0.3, 0.22);
  }
  ctx.neon('#ff8a2a', 3.2).box(17.2, 0.2, 0.2, 0, 13.9, 6.52);
  // Kontrollpunkt-Bogen über der Torstraße
  const a = L(ctx, plan.roadBridge.i * 30, (plan.roadBridge.j0 - 0.5) * 30);
  const span = 13.5; // Torstraße verläuft lokal entlang x, der Bogen spannt entlang z
  for (const s of [-1, 1]) ctx.dark.box(2.2, 13, 2.2, a.x, 0, a.z + s * span / 2);
  ctx.dark.box(3.2, 2.6, span + 2.2, a.x, 13, a.z);
  const arcN = ctx.neon('#ff8a2a', 3.4);
  arcN.box(0.2, 0.2, span + 2.2, a.x + 1.65, 13.1, a.z);
  arcN.box(0.2, 0.2, span + 2.2, a.x - 1.65, 15.5, a.z);
  // Schriftzug über der Straße, von der Brücke (Süden) aus lesbar
  const word = neonWord(ctx.env.atlas, 'SPEEDPORT', '#ff8a2a', { h: 200, font: FONT_TALL, weight: 600, pad: 0.4 });
  const wh = 2.2, ww = wh * word.w / word.h;
  // Süden = lokal −x (Rotation π/2): Blickrichtung Brücke
  ctx.sign(word, ww, wh, a.x - 1.72, 14.3, a.z, -Math.PI / 2, { intensity: 2.6 });
  ctx.sign(word, ww, wh, a.x + 1.72, 14.3, a.z, Math.PI / 2, { intensity: 2.6 });
  // Laserschranke
  const laser = holoMesh(ctx, new THREE.PlaneGeometry(span - 1, 11), '#ff2a3a', a.x, 6.8, a.z, { opacity: 0.12, density: 1.2 });
  laser.rotation.y = Math.PI / 2;
  ctx.beacon(a.x, 12.2, a.z - span / 2 + 1.2, '#ff8a2a', 1.4, 0.4, 0.4);
  ctx.beacon(a.x, 12.2, a.z + span / 2 - 1.2, '#ff8a2a', 1.4, 0.4, 0.4);
  // Portfreigaben als Tafeln am Router-Gebäude
  const fwd: Array<[string, string]> = [['80/443 → .179', 'Mail-Projekt · nginx'], ['7777 + 8888 → .223', 'Satisfactory'], ['9987/udp → .220', 'TeamSpeak · laut Vault']];
  fwd.forEach(([t, s], i) => smallBoard(ctx, t, s, '#ff8a2a', 4.6, -5 + i * 5, 2.2, 6.62, 0));
  smallBoard(ctx, 'GATEWAY · DNS · DHCP', n.sub, '#ff8a2a', 8, 0, 11.4, 6.62, 0);
  return { top: 23, w: 17, d: 15, labelY: 26 };
};

/* ------------------------------------------------------------------ */
/* MainCluster-Plaza                                                   */
/* ------------------------------------------------------------------ */

const council: Special = (ctx, n) => {
  const pads = ctx.concrete;
  pads.box(49, 0.3, 49, 0, 0, 0);
  const grid = ctx.neon('#00f5d4', 1.6);
  grid.torus(20, 0.08, 0, 0.36, 0, { x: Math.PI / 2 }, undefined, 96);
  grid.torus(12, 0.06, 0, 0.36, 0, { x: Math.PI / 2 }, undefined, 72);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    grid.box(0.08, 0.04, 8, Math.sin(a) * 16, 0.34, Math.cos(a) * 16, a);
  }
  // Ratsturm
  ctx.useFacade({ color: '#1d2a30', seed: 5, lit: 0.6, warm: 0.2, tint: '#00f5d4', height: 30, win: [1.4, 2.6], band: 5.2, metalness: 0.6, roughness: 0.35 });
  ctx.facade.oct(9, 26, 9, 0, 0.3, 0, new THREE.Color('#1d2a30'));
  ctx.facade.oct(6, 6, 6, 0, 26.3, 0, new THREE.Color('#25363d'));
  ctx.metal.cone(3, 5, 0, 32.3, 0, 8);
  ctx.beacon(0, 37.6, 0, '#ff2a3a', 0.6, 0.2, 0.5);
  // Stimmen: eine Säule je Node + Sockel für das QDevice
  const pves = model.nodes.filter(x => x.t === 'pve');
  const total = pves.reduce((s, p) => s + model.votes(p.id), 0);
  const expected = total; // pvecm: Expected votes = Summe der Stimmen
  const quorum = Math.floor(expected / 2) + 1;
  const ring = [...pves.map(p => ({ id: p.id, label: p.label, votes: model.votes(p.id), q: false })), { id: 'q102', label: 'QDevice', votes: 0, q: true }];
  ring.forEach((p, i) => {
    const a = (i / ring.length) * Math.PI * 2 + Math.PI / ring.length;
    const x = Math.sin(a) * 16, z = Math.cos(a) * 16;
    ctx.metal.cyl(0.7, 0.9, 5.5, x, 0.3, z, 12);
    const col = p.votes > 0 ? '#00f5d4' : p.q ? '#5a1f2a' : '#3a4450';
    ctx.beacon(x, 6.6, z, col, 0, 1, 1.05);
    const rect = boardSign(ctx.env.atlas, p.label.toUpperCase(), p.q ? 'nicht aktiv' : `${p.votes} Stimme${p.votes === 1 ? '' : 'n'}`, p.votes > 0 ? '#00f5d4' : p.q ? '#ff5a6a' : '#6b7684', { w: 400, h: 120 });
    const rot = Math.atan2(x, z);
    ctx.sign(rect, 3.8, 1.14, x + Math.sin(rot) * 1.05, 4.2, z + Math.cos(rot) * 1.05, rot, { intensity: p.votes > 0 ? 1.9 : 0.9 });
  });
  // Quorum-Hologramm über dem Turm
  const q1 = textPlane(ctx, `${total} STIMMEN · QUORUM ${quorum}`, '#00f5d4', 2.4, 0, 42, 0, { font: FONT_TALL });
  const q2 = q1.clone();
  q2.rotation.y = Math.PI;
  ctx.add(q2);
  const ringH = holoMesh(ctx, new THREE.TorusGeometry(6, 0.1, 6, 64), '#00f5d4', 0, 40, 0);
  ringH.rotation.x = Math.PI / 2;
  ctx.anim((_dt, t) => { q1.rotation.y = t * 0.3; q2.rotation.y = t * 0.3 + Math.PI; ringH.scale.setScalar(1 + Math.sin(t * 1.5) * 0.05); });
  smallBoard(ctx, 'MAINCLUSTER', `${pves.length} Nodes · ${total} Stimmen · Quorum ${quorum}`, '#00f5d4', 8, 0, 1.8, 5.3, 0);
  // Bäume und Bänke
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    ctx.tree(Math.sin(a) * 22, Math.cos(a) * 22, 1.1, i % 2 ? '#1b8f7a' : '#6a3cff', 0.3);
  }
  void n;
  return { top: 44, w: 49, d: 49, labelY: 46 };
};

/* ------------------------------------------------------------------ */

const SPECIALS: Record<string, Special> = {
  g301: hub, g106: checkmk, 'vm-nas': truenas, g104: mailprojekt, 'vm-dash': grafana, 'vm-voice': teamspeak, 'vm-game': satisfactory,
  inet: bridgehead, speedport, cluster: council
};

const TYPE_SPECIALS: Partial<Record<string, Special>> = {
  cloud: cloudPlatform,
  domain
};

/** Sonderbauten, die das Grundgebäude ganz ersetzen */
export const REPLACES = new Set<string>([]);

export function applySpecial(ctx: BuildCtx, n: CNode, res: Res): Res {
  const fn = SPECIALS[n.id] || TYPE_SPECIALS[n.t];
  if (!fn) return res;
  const out = fn(ctx, n, res);
  return out === undefined ? res : out;
}

