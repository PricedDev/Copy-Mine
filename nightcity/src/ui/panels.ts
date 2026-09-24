import * as THREE from 'three';
import { model, SEV } from '../data/model';
import { plan, P } from '../layout/plan';
import { railSegments } from '../layout/routes';
import { SEV_COLOR, KIND_COLOR, STATUS_COLOR } from '../theme';
import type { Director, LogEntry } from '../sim/director';
import type { Core } from '../world/core';
import type { Ctl, Sel } from './dossier';
import { $, esc } from './dom';
import { DISTRICT_ACCENT } from '../world/buildings';

/* ------------------------------------------------------------------ */
/* NETWATCH – Protokoll aller Agent-Schritte                           */
/* ------------------------------------------------------------------ */

export class LogPanel {
  readonly root = $('#log');
  private list = $('#log-entries');
  filter: 'all' | 'sel' | 'warn' = 'all';
  private stick = true;

  constructor(private director: Director, private ctl: Ctl, private currentSel: () => Sel | null) {
    director.onLog(e => this.add(e, true));
    director.log.forEach(e => this.add(e, false));
    this.root.querySelectorAll<HTMLButtonElement>('[data-f]').forEach(b => b.addEventListener('click', () => {
      this.filter = b.dataset.f as 'all' | 'sel' | 'warn';
      this.root.querySelectorAll<HTMLButtonElement>('[data-f]').forEach(x => x.classList.toggle('on', x === b));
      this.rebuild();
    }));
    this.list.addEventListener('scroll', () => {
      this.stick = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 30;
    });
    this.list.addEventListener('click', ev => {
      const t = (ev.target as HTMLElement).closest('.le') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.runner) this.ctl.select({ kind: 'npc', id: t.dataset.runner }, { fly: true });
      else if (t.dataset.edge) this.ctl.select({ kind: 'edge', id: t.dataset.edge }, { fly: true });
      else if (t.dataset.node) {
        const n = model.find(t.dataset.node);
        if (n) this.ctl.select({ kind: n.t === 'svc' ? 'svc' : 'structure', id: n.id }, { fly: true });
      }
    });
  }

  private matches(e: LogEntry): boolean {
    if (this.filter === 'warn') return e.tone === 'warn' || e.tone === 'crit';
    if (this.filter === 'sel') {
      const s = this.currentSel();
      if (!s) return true;
      if (s.kind === 'npc') return e.runner === s.id;
      if (s.kind === 'edge') return e.edge === s.id;
      if (s.kind === 'structure' || s.kind === 'svc') {
        const ids = new Set([s.id, ...model.descendants(s.id)]);
        const edge = e.edge ? model.edges.find(x => x.id === e.edge) : undefined;
        return (!!e.node && ids.has(e.node)) || (!!edge && (ids.has(edge.s) || ids.has(edge.t)));
      }
    }
    return true;
  }

  private row(e: LogEntry, fresh: boolean): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `le ${e.tone}${fresh ? ' fresh' : ''}`;
    if (e.runner) b.dataset.runner = e.runner;
    if (e.edge) b.dataset.edge = e.edge;
    if (e.node) b.dataset.node = e.node;
    const kind = e.kind ? `<span style="color:${KIND_COLOR[e.kind]}">■</span> ` : '';
    b.innerHTML = `<span class="tm">${esc(e.time)}</span><span><span class="who" style="color:${e.color}">${esc(e.who)}</span> ${kind}<span class="tx">${esc(e.text)}</span>${e.detail ? `<span class="dt">${esc(e.detail)}</span>` : ''}</span>`;
    return b;
  }

  add(e: LogEntry, fresh: boolean) {
    if (!this.matches(e)) return;
    this.list.appendChild(this.row(e, fresh && !this.root.hidden));
    while (this.list.childElementCount > 220) this.list.firstElementChild!.remove();
    if (this.stick) this.list.scrollTop = this.list.scrollHeight;
  }

  rebuild() {
    this.list.innerHTML = '';
    this.director.log.slice(-220).forEach(e => { if (this.matches(e)) this.list.appendChild(this.row(e, false)); });
    this.list.scrollTop = this.list.scrollHeight;
    this.stick = true;
  }

  toggle(show?: boolean) {
    this.root.hidden = show == null ? !this.root.hidden : !show;
    document.body.classList.toggle('log-open', !this.root.hidden);
    if (!this.root.hidden) { this.list.scrollTop = this.list.scrollHeight; this.stick = true; }
  }
}

/* ------------------------------------------------------------------ */
/* LAGEFUNK – Laufband mit den Befunden                                */
/* ------------------------------------------------------------------ */

export class Ticker {
  constructor(ctl: Ctl) {
    const run = $('#ticker-run');
    const rank = { crit: 0, warn: 1, info: 2, good: 3 } as const;
    const items = model.findings.map((f, i) => ({ f, i })).sort((a, b) => rank[a.f.sev] - rank[b.f.sev]);
    run.innerHTML = items.map(({ f, i }) => `<span data-i="${i}"><b style="color:${SEV_COLOR[f.sev]}">+++ ${esc(SEV[f.sev].toUpperCase())}</b>${esc(f.t)}</span>`).join('')
      + `<span><b style="color:var(--cyan)">+++ DATENSTAND</b>${esc(model.live.at)} · Quelle: Netzatlas data.js</span>`;
    const chars = run.textContent?.length || 1000;
    run.style.animationDuration = `${Math.max(60, chars * 0.16)}s`;
    run.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null;
      if (t) ctl.select({ kind: 'finding', id: t.dataset.i! }, { fly: true });
    });
  }
}

/* ------------------------------------------------------------------ */
/* Minimap                                                             */
/* ------------------------------------------------------------------ */

export class Minimap {
  readonly root = $('#minimap');
  private canvas = $('#minimap-canvas') as HTMLCanvasElement;
  private ctx = this.canvas.getContext('2d')!;
  private base: HTMLCanvasElement;
  private x0: number; private z0: number; private s: number;
  private acc = 1;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private dragging = false;

  constructor(private core: Core, private director: Director, private selected: () => string | null) {
    const b = plan.bounds, ib = plan.islandBounds;
    const x0 = Math.min(b.x0, ib.x0) - 24, x1 = Math.max(b.x1, ib.x1) + 24;
    const z0 = b.z0 - 24, z1 = ib.z1 + 24;
    const W = this.canvas.width, H = this.canvas.height;
    this.s = Math.min(W / (x1 - x0), H / (z1 - z0));
    this.x0 = x0 - (W / this.s - (x1 - x0)) / 2;
    this.z0 = z0 - (H / this.s - (z1 - z0)) / 2;
    this.base = document.createElement('canvas');
    this.base.width = W; this.base.height = H;
    this.drawBase();
    core.onUpdate(dt => { this.acc += dt; if (this.acc > 0.1 && !this.root.hidden) { this.acc = 0; this.draw(); } });
    const move = (ev: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const mx = (ev.clientX - r.left) / r.width * W, mz = (ev.clientY - r.top) / r.height * H;
      const wx = mx / this.s + this.x0, wz = mz / this.s + this.z0;
      const v = core.view();
      core.flyTo(new THREE.Vector3(wx, 0, wz), { dist: v.d, duration: this.dragging ? 0.15 : 0.7 });
    };
    this.canvas.addEventListener('pointerdown', ev => { this.dragging = false; this.canvas.setPointerCapture(ev.pointerId); move(ev); });
    this.canvas.addEventListener('pointermove', ev => { if (ev.buttons) { this.dragging = true; move(ev); } });
  }

  private mx(x: number) { return (x - this.x0) * this.s; }
  private mz(z: number) { return (z - this.z0) * this.s; }

  private drawBase() {
    const g = this.base.getContext('2d')!;
    const W = this.base.width, H = this.base.height;
    g.fillStyle = '#03060d';
    g.fillRect(0, 0, W, H);
    // Wasserlinien
    g.strokeStyle = 'rgba(46,197,255,0.05)';
    for (let y = 0; y < H; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    // Land
    plan.cells.forEach((_l, k) => {
      const [c, r] = k.split('|').map(Number);
      g.fillStyle = '#141824';
      g.fillRect(this.mx(c * P - 6), this.mz(r * P - 6), (P + 12) * this.s, (P + 12) * this.s);
    });
    // Brücken
    const rb = plan.roadBridge;
    g.fillStyle = '#2a2f3d';
    g.fillRect(this.mx(rb.i * P - 6), this.mz(rb.j0 * P), 12 * this.s, (rb.j1 - rb.j0) * P * this.s);
    // Grundstücke
    plan.lots.forEach(l => {
      const acc = DISTRICT_ACCENT[l.district]?.[0] || '#888';
      const n = l.node ? model.find(l.node) : undefined;
      g.fillStyle = l.node ? (n && n.st === 'stopped' ? '#262b36' : acc) : '#1c2230';
      g.globalAlpha = l.node ? (l.kind === 'tower' ? 0.95 : 0.55) : 0.8;
      g.fillRect(this.mx(l.x0), this.mz(l.z0), (l.x1 - l.x0) * this.s, (l.z1 - l.z0) * this.s);
      g.globalAlpha = 1;
      if (n && n.st !== 'ok' && n.st !== 'stopped') {
        g.strokeStyle = STATUS_COLOR[n.st];
        g.lineWidth = 2;
        g.strokeRect(this.mx(l.x0) + 1, this.mz(l.z0) + 1, (l.x1 - l.x0) * this.s - 2, (l.z1 - l.z0) * this.s - 2);
      }
    });
    // Hochbahn
    g.strokeStyle = KIND_COLOR.vpn;
    g.lineWidth = 2;
    railSegments.forEach(e => { g.beginPath(); g.moveTo(this.mx(e.a.x), this.mz(e.a.z)); g.lineTo(this.mx(e.b.x), this.mz(e.b.z)); g.stroke(); });
  }

  private groundAt(nx: number, ny: number): THREE.Vector3 | null {
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.core.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, p) ? p : null;
  }

  private draw() {
    const g = this.ctx;
    g.drawImage(this.base, 0, 0);
    // Agents
    this.director.runners.forEach(r => {
      g.fillStyle = r.def.color;
      g.beginPath();
      g.arc(this.mx(r.pos.x), this.mz(r.pos.z), r.phase === 'move' ? 3.2 : 2.2, 0, Math.PI * 2);
      g.fill();
    });
    // Blickfeld
    const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) => this.groundAt(x, y) || this.groundAt(x, Math.min(y, 0.2)));
    if (corners.every(Boolean)) {
      g.strokeStyle = '#fcee0a';
      g.lineWidth = 1.5;
      g.beginPath();
      corners.forEach((p, i) => { const x = this.mx(p!.x), z = this.mz(p!.z); if (i) g.lineTo(x, z); else g.moveTo(x, z); });
      g.closePath();
      g.stroke();
    }
    const sel = this.selected();
    if (sel) {
      const pl = plan.place(sel);
      if (pl) {
        g.strokeStyle = '#fcee0a';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(this.mx(pl.x), this.mz(pl.z), 7 + Math.sin(performance.now() / 200) * 1.5, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  toggle(show?: boolean) {
    this.root.hidden = show == null ? !this.root.hidden : !show;
  }
}
