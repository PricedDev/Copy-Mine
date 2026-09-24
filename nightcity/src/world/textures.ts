import * as THREE from 'three';

/*
 * Prozedurale Texturen: alles wird zur Laufzeit gezeichnet – keine Bilddateien,
 * damit die Seite als eine einzige Datei funktioniert (LAN und Artifact).
 */

export const FONT_UI = '"Rajdhani", "Segoe UI", system-ui, sans-serif';
export const FONT_TALL = '"Teko", "Rajdhani", "Arial Narrow", sans-serif';
export const FONT_MONO = '"Share Tech Mono", ui-monospace, "Cascadia Mono", monospace';

export async function loadFonts(): Promise<void> {
  const want = [
    `700 64px ${FONT_UI}`, `600 64px ${FONT_UI}`, `500 64px ${FONT_TALL}`, `600 64px ${FONT_TALL}`, `400 64px ${FONT_MONO}`
  ];
  try {
    await Promise.race([
      Promise.all(want.map(f => document.fonts.load(f, 'AÄÖÜßaz09·→'))),
      new Promise(r => setTimeout(r, 3500))
    ]);
  } catch {
    /* Schriften sind Kosmetik – ohne sie geht es mit Systemschriften weiter */
  }
}

/* ------------------------------------------------------------------ */
/* Atlas für Schilder und Leuchtschriften                              */
/* ------------------------------------------------------------------ */

export interface AtlasRect {
  page: number;
  u0: number; v0: number; u1: number; v1: number;
  w: number; h: number;
}

interface Page {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  x: number;
  y: number;
  rowH: number;
}

export class Atlas {
  readonly pages: Page[] = [];
  constructor(readonly size = 2048) {}

  private newPage(): Page {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = this.size;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const p: Page = { canvas, ctx, tex, x: 0, y: 0, rowH: 0 };
    this.pages.push(p);
    return p;
  }

  /** Rechteck reservieren und mit der Zeichenfunktion füllen */
  draw(w: number, h: number, fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): AtlasRect {
    w = Math.ceil(w); h = Math.ceil(h);
    const pad = 4;
    let p = this.pages[this.pages.length - 1] || this.newPage();
    if (p.x + w + pad > this.size) { p.x = 0; p.y += p.rowH + pad; p.rowH = 0; }
    if (p.y + h + pad > this.size) { p = this.newPage(); }
    const x = p.x, y = p.y;
    p.x += w + pad;
    p.rowH = Math.max(p.rowH, h);
    p.ctx.save();
    p.ctx.translate(x, y);
    p.ctx.beginPath();
    p.ctx.rect(0, 0, w, h);
    p.ctx.clip();
    fn(p.ctx, w, h);
    p.ctx.restore();
    p.tex.needsUpdate = true;
    const s = this.size;
    return { page: this.pages.indexOf(p), u0: x / s, v0: 1 - (y + h) / s, u1: (x + w) / s, v1: 1 - y / s, w, h };
  }
}

/* ------------------------------------------------------------------ */
/* Zeichenhelfer                                                       */
/* ------------------------------------------------------------------ */

export function hexA(hex: string, a: number): string {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

export function mixHex(a: string, b: string, t: number): string {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

/** Neonschrift: farbiger Schein + heller Kern */
export function neonText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, font = FONT_UI, weight = 700, align: CanvasTextAlign = 'center') {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.fillStyle = color;
  ctx.shadowBlur = size * 0.35;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = size * 0.18;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = size * 0.06;
  ctx.fillStyle = mixHex(color, '#ffffff', 0.72);
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

/** passt die Schriftgröße an die Breite an */
export function fitSize(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, font = FONT_UI, weight = 700): number {
  ctx.font = `${weight} ${size}px ${font}`;
  const w = ctx.measureText(text).width;
  return w > maxW ? Math.floor(size * maxW / w) : size;
}

/** Schild: dunkle Tafel mit Neonrahmen, Titel und Unterzeile */
export function boardSign(atlas: Atlas, title: string, sub: string, color: string, opts: { w?: number; h?: number; dim?: boolean; icon?: string } = {}): AtlasRect {
  const W = opts.w ?? 512, H = opts.h ?? 128;
  return atlas.draw(W, H, (ctx, w, h) => {
    const r = 10;
    ctx.fillStyle = 'rgba(6,8,14,0.96)';
    roundRect(ctx, 3, 3, w - 6, h - 6, r);
    ctx.fill();
    // Schrägschnitt in der Ecke (Cyberpunk-UI)
    ctx.fillStyle = hexA(color, 0.9);
    ctx.beginPath();
    ctx.moveTo(w - 36, h - 3); ctx.lineTo(w - 3, h - 36); ctx.lineTo(w - 3, h - 3); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    roundRect(ctx, 5, 5, w - 10, h - 10, r);
    ctx.stroke();
    ctx.shadowBlur = 0;
    const left = opts.icon ? 96 : 28;
    if (opts.icon) {
      ctx.font = `700 ${h * 0.5}px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.fillText(opts.icon, 54, h / 2 + 2);
      ctx.shadowBlur = 0;
    }
    const ts = fitSize(ctx, title, w - left - 30, sub ? h * 0.44 : h * 0.6);
    neonText(ctx, title, left, sub ? h * 0.36 : h * 0.52, ts, opts.dim ? mixHex(color, '#333a44', 0.6) : color, FONT_UI, 700, 'left');
    if (sub) {
      const ss = fitSize(ctx, sub, w - left - 40, h * 0.26, FONT_MONO, 400);
      ctx.font = `400 ${ss}px ${FONT_MONO}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = opts.dim ? '#5d6674' : '#b9c7d6';
      ctx.fillText(sub, left + 2, h * 0.74);
    }
  });
}

/** Leuchtbuchstaben ohne Tafel (für additive Darstellung) */
export function neonWord(atlas: Atlas, text: string, color: string, opts: { h?: number; font?: string; weight?: number; vertical?: boolean; pad?: number } = {}): AtlasRect {
  const font = opts.font ?? FONT_TALL;
  const weight = opts.weight ?? 600;
  const H = opts.h ?? 160;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `${weight} ${H}px ${font}`;
  if (opts.vertical) {
    const chars = Array.from(text);
    const cw = Math.max(...chars.map(ch => probe.measureText(ch).width)) + H * 0.5;
    const ch = H * 0.9;
    return atlas.draw(cw, ch * chars.length + H * 0.4, (ctx, w) => {
      chars.forEach((c, i) => neonText(ctx, c, w / 2, H * 0.2 + ch * (i + 0.5), H, color, font, weight));
    });
  }
  const w = probe.measureText(text).width + H * (opts.pad ?? 0.8);
  return atlas.draw(Math.min(w, 2000), H * 1.35, (ctx, cw, ch) => {
    const s = fitSize(ctx, text, cw - H * 0.5, H, font, weight);
    neonText(ctx, text, cw / 2, ch / 2 + H * 0.05, s, color, font, weight);
  });
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* Rauschen & Materialtexturen                                         */
/* ------------------------------------------------------------------ */

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = mulberry;

/** kachelbares Wertrauschen, mehrere Oktaven */
export function tileNoise(size: number, seed: number, octaves = 5): Float32Array {
  const out = new Float32Array(size * size);
  const rnd = mulberry(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = 4 << o;
    const grid = new Float32Array(cells * cells).map(() => rnd());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells, gy = (y / size) * cells;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = gx - x0, fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const i = (a: number, b: number) => grid[((b + cells) % cells) * cells + ((a + cells) % cells)];
        const v = (i(x0, y0) * (1 - sx) + i(x0 + 1, y0) * sx) * (1 - sy) + (i(x0, y0 + 1) * (1 - sx) + i(x0 + 1, y0 + 1) * sx) * sy;
        out[y * size + x] += v * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function dataTex(size: number, fill: (i: number, x: number, y: number) => [number, number, number, number], srgb = false): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const [r, g, b, a] = fill(i, x, y);
      data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Asphalt: Farbe + Rauheit mit Pfützen (Pfütze = glatt, dunkel) */
export function asphaltTextures(): { map: THREE.DataTexture; rough: THREE.DataTexture } {
  const S = 256;
  const n = tileNoise(S, 11, 6);
  const puddle = tileNoise(S, 97, 4);
  const grit = mulberry(5);
  const map = dataTex(S, (i) => {
    const g = 18 + n[i] * 22 + grit() * 10;
    const p = puddle[i] > 0.58 ? 0.55 : 1;
    return [g * p, g * p * 1.02, g * p * 1.12, 255];
  }, true);
  const rough = dataTex(S, (i) => {
    const wet = THREE.MathUtils.smoothstep(puddle[i], 0.5, 0.62);
    const r = 150 + n[i] * 90 - wet * 200;
    const v = Math.max(18, Math.min(255, r));
    return [v, v, v, 255];
  });
  return { map, rough };
}

/** Beton/Gehweg */
export function concreteTexture(): THREE.DataTexture {
  const S = 128;
  const n = tileNoise(S, 23, 5);
  return dataTex(S, (i, x, y) => {
    const tile = (x % 32 === 0 || y % 32 === 0) ? 0.6 : 1;
    const g = (46 + n[i] * 30) * tile;
    return [g, g * 1.01, g * 1.06, 255];
  }, true);
}

/** Runder Lichtschein (für Lichtkegel am Boden, Halos) */
export function glowTexture(inner = 0.0, soft = 1.0): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, inner * 64, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25 * soft, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Senkrechter Lichtstreifen (Spiegelung von Neon im nassen Asphalt) */
export function streakTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  const img = ctx.getImageData(0, 0, 64, 256);
  const rnd = mulberry(3);
  for (let y = 0; y < 256; y++) {
    const wob = 0.65 + rnd() * 0.35;
    for (let x = 0; x < 64; x++) {
      const k = (y * 64 + x) * 4 + 3;
      const edge = 1 - Math.abs(x - 32) / 32;
      img.data[k] = img.data[k] * Math.pow(edge, 1.6) * wob;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Wappen der Corp-Türme (geometrisch, eigene Entwürfe) */
export function emblem(atlas: Atlas, kind: string, color: string, color2: string): AtlasRect {
  return atlas.draw(256, 256, (ctx) => {
    ctx.translate(128, 128);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 10;
    ctx.lineJoin = 'miter';
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    const poly = (pts: number[][], fill = false) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      if (fill) ctx.fill(); else ctx.stroke();
    };
    if (kind === 'spire') {
      // zwei verschränkte Winkel (Proxmox-„X") im Kreis
      ctx.beginPath(); ctx.arc(0, 0, 104, 0, Math.PI * 2); ctx.stroke();
      poly([[-62, -70], [-8, 0], [-62, 70], [-38, 70], [14, 0], [-38, -70]], true);
      ctx.fillStyle = color2; ctx.shadowColor = color2;
      poly([[62, -70], [8, 0], [62, 70], [38, 70], [-14, 0], [38, -70]], true);
    } else if (kind === 'fortress') {
      // Sechseck mit Leiterbahnen
      const hex = Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3 + Math.PI / 6) * 100, Math.sin(i * Math.PI / 3 + Math.PI / 6) * 100]);
      poly(hex);
      ctx.lineWidth = 7;
      [[-50, -30, 0, -30, 20, -60], [-50, 20, 30, 20, 50, 50], [-20, 60, -20, 0, 40, -20]].forEach(l => {
        ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.lineTo(l[4], l[5]); ctx.stroke();
        ctx.beginPath(); ctx.arc(l[4], l[5], 9, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = color2; ctx.shadowColor = color2;
      ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'foundry') {
      // gedruckte Schichten: gestapeltes Dreieck
      for (let i = 0; i < 6; i++) {
        const y = 70 - i * 26, half = 96 - i * 16;
        ctx.fillStyle = i % 2 ? color2 : color;
        ctx.shadowColor = ctx.fillStyle as string;
        ctx.fillRect(-half, y - 9, half * 2, 16);
      }
      ctx.strokeStyle = color;
      poly([[0, -100], [110, 90], [-110, 90]]);
    } else {
      // Außenposten: Raute mit Punkt
      poly([[0, -100], [80, 0], [0, 100], [-80, 0]]);
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
    }
  });
}
