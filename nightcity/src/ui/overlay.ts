import * as THREE from 'three';
import { model, TYPES } from '../data/model';
import { plan, P } from '../layout/plan';
import type { Core } from '../world/core';
import type { City } from '../world/city';
import type { Director } from '../sim/director';
import type { Flows } from '../world/flows';
import { esc } from './dom';
import { STATUS_COLOR } from '../theme';

/*
 * Beschriftungen über der 3D-Szene: Viertel, Gebäude (Name + IP/VMID),
 * Namensschilder der Agents, ihre Sprechblasen (Schreibmaschinen-Effekt)
 * und Kantenbeschreibungen der hervorgehobenen Verbindungen.
 */

export interface OverlayState {
  selected: string | null;
  runner: string | null;
  hovered: string | null;
  scan: boolean;
  labels: boolean;
  edgeLabels: string[];
}

interface Anchor { el: HTMLElement; pos: THREE.Vector3; kind: 'district' | 'building' | 'npc' | 'bubble' | 'edge'; id: string; }

const v = new THREE.Vector3();

export class Overlay {
  private root: HTMLElement;
  private districts: Anchor[] = [];
  private buildings: Anchor[] = [];
  private npcTags = new Map<string, Anchor>();
  private bubbles = new Map<string, Anchor & { text: string; shown: number }>();
  private edgePool: Anchor[] = [];

  constructor(private core: Core, private city: City, private director: Director, private flows: Flows, readonly state: OverlayState) {
    this.root = document.getElementById('overlay')!;
    plan.districts.forEach(d => {
      const e = document.createElement('div');
      e.className = 'lbl district';
      e.innerHTML = `${esc(d.name)}<small>${esc(d.sub)}</small>`;
      this.root.appendChild(e);
      const cx = (d.c0 + d.cols / 2) * P, cz = (d.r0 + d.rows) * P;
      this.districts.push({ el: e, pos: new THREE.Vector3(cx, 2, d.island ? cz + 10 : cz - 4), kind: 'district', id: d.id });
    });
    city.structures.forEach((s, id) => {
      const n = model.get(id);
      const e = document.createElement('div');
      e.className = 'lbl';
      const meta = [n.ip ? n.ip.replace('192.168.2.', '.') : '', n.vmid != null ? (n.t === 'ct' ? 'CT ' : n.t === 'vm' ? 'VM ' : '') + n.vmid : ''].filter(Boolean).join(' · ') || TYPES[n.t];
      e.innerHTML = `${esc(n.label)}<small>${esc(meta)}</small>`;
      e.style.borderBottom = `2px solid ${STATUS_COLOR[n.st]}`;
      this.root.appendChild(e);
      this.buildings.push({ el: e, pos: s.labelAt.clone(), kind: 'building', id });
    });
    director.runners.forEach(r => {
      const e = document.createElement('div');
      e.className = 'lbl npc';
      e.textContent = r.label;
      e.style.color = r.def.color;
      this.root.appendChild(e);
      this.npcTags.set(r.key, { el: e, pos: new THREE.Vector3(), kind: 'npc', id: r.key });
      const b = document.createElement('div');
      b.className = 'bubble';
      b.style.setProperty('--bc', r.def.color);
      this.root.appendChild(b);
      this.bubbles.set(r.key, { el: b, pos: new THREE.Vector3(), kind: 'bubble', id: r.key, text: '', shown: 0 });
    });
    core.onUpdate(dt => this.update(dt));
  }

  private project(p: THREE.Vector3): { x: number; y: number; ok: boolean; z: number } {
    v.copy(p).project(this.core.camera);
    const x = (v.x + 1) / 2 * this.core.width;
    const y = (1 - v.y) / 2 * this.core.height;
    const ok = v.z < 1 && v.z > -1 && x > -60 && x < this.core.width + 60 && y > -40 && y < this.core.height + 40;
    return { x, y, ok, z: v.z };
  }

  private place(a: Anchor, show: boolean) {
    if (!show) { if (a.el.style.display !== 'none') a.el.style.display = 'none'; return; }
    const p = this.project(a.pos);
    if (!p.ok) { if (a.el.style.display !== 'none') a.el.style.display = 'none'; return; }
    if (a.el.style.display === 'none') a.el.style.display = '';
    a.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }

  private update(dt: number) {
    const cam = this.core.camera.position;
    const st = this.state;
    const dist = cam.distanceTo(this.core.controls.target);
    const labelsOn = st.labels;
    // Im Kinomodus nur Viertel und wenige Sprechblasen – das Bild soll atmen
    const cinema = document.body.classList.contains('cinema');
    // Viertel: nur aus mittlerer/großer Höhe
    this.districts.forEach(a => this.place(a, labelsOn && !cinema && (dist > 230 || st.scan)));
    // Gebäude: nah genug, ausgewählt, überfahren oder Scanner
    this.buildings.forEach(a => {
      const d = cam.distanceTo(a.pos);
      const sel = st.selected === a.id;
      const hov = st.hovered === a.id;
      const show = labelsOn && !cinema && (sel || hov || (st.scan && d < 620) || d < 240);
      a.el.classList.toggle('sel', sel);
      a.el.classList.toggle('far', d > 330 && !sel && !hov);
      this.place(a, show);
      if (show) a.el.style.opacity = sel || hov || st.scan ? '1' : String(Math.min(1, (240 - d) / 60));
    });
    // Agents
    let bubblesShown = 0;
    const byDist = [...this.director.runners].sort((a, b) => cam.distanceToSquared(a.pos) - cam.distanceToSquared(b.pos));
    byDist.forEach(r => {
      const tag = this.npcTags.get(r.key)!;
      const d = cam.distanceTo(r.pos);
      const sel = st.runner === r.key;
      tag.pos.copy(r.pos);
      tag.pos.y += r.npc.height + (r.npc.flying ? 1.4 : 0.9);
      this.place(tag, labelsOn && !cinema && r.npc.group.visible && (sel || d < 150 || (st.scan && d < 400)));
      const b = this.bubbles.get(r.key)!;
      const want = r.bubble ? r.bubble.text : '';
      if (want !== b.text) {
        b.text = want;
        b.shown = 0;
        b.el.className = 'bubble' + (r.bubble ? ' ' + r.bubble.tone : '');
      }
      const showB = labelsOn && !!r.bubble && r.npc.group.visible && (sel || (d < 230 && bubblesShown < (cinema ? 3 : 7)));
      if (showB) {
        bubblesShown++;
        if (b.shown < b.text.length) {
          b.shown = Math.min(b.text.length, b.shown + Math.max(1, Math.round(dt * 70)));
          b.el.innerHTML = `<span class="who">${esc(r.label)}</span>${esc(b.text.slice(0, b.shown))}`;
        }
        b.pos.copy(tag.pos);
        b.pos.y += 2.2;
      }
      this.place(b, showB);
    });
    // Kantenbeschreibungen
    const ids = st.edgeLabels;
    while (this.edgePool.length < ids.length) {
      const e = document.createElement('div');
      e.className = 'lbl edge';
      this.root.appendChild(e);
      this.edgePool.push({ el: e, pos: new THREE.Vector3(), kind: 'edge', id: '' });
    }
    this.edgePool.forEach((a, i) => {
      const id = ids[i];
      if (!id) { this.place(a, false); return; }
      const fp = this.flows.byEdge.get(id);
      if (!fp) { this.place(a, false); return; }
      if (a.id !== id) {
        a.id = id;
        a.el.textContent = fp.edge.d;
        a.pos.copy(fp.mid);
        a.pos.y += 3;
      }
      this.place(a, labelsOn);
    });
    void this.city;
  }
}
