import * as THREE from 'three';
import { model, LAYERS, type ImpactResult } from './data/model';
import { plan } from './layout/plan';
import { routes } from './layout/routes';
import { KIND_COLOR, STATUS_COLOR } from './theme';
import type { EdgeKind } from './data/types';
import { Core, type Quality } from './world/core';
import { City } from './world/city';
import { Environment, type Weather } from './world/environment';
import { Flows } from './world/flows';
import { Fx } from './world/fx';
import { Director, nodeLabel } from './sim/director';
import { Overlay, type OverlayState } from './ui/overlay';
import { Dossier, type Ctl, type Sel } from './ui/dossier';
import { LogPanel, Ticker, Minimap } from './ui/panels';
import { Menus, Search, Help } from './ui/menus';
import { Cinema, Photo, Scanner } from './ui/modes';
import { Ambient } from './audio/ambient';
import { $, esc, store } from './ui/dom';

/*
 * Der Regisseur der Oberfläche: Auswahl, Picking, Tastatur, Kamera-Folgen,
 * Ausfall-Simulation und Einstellungen – alles, was Welt und HUD verbindet.
 */

type Step = (label: string, pct: number) => Promise<void>;

const DISTRICT_KEYS: Array<[string, string]> = [
  ['1', 'd-pve-node1'], ['2', 'd-pve-ai'], ['3', 'd-pve-print'], ['4', 'd-thin'], ['5', 'd-lan'], ['6', 'd-plaza'], ['7', 'd-out']
];

export class App implements Ctl {
  city!: City;
  env!: Environment;
  flows!: Flows;
  fx!: Fx;
  director!: Director;
  overlay!: Overlay;
  dossier!: Dossier;
  log!: LogPanel;
  minimap!: Minimap;
  menus!: Menus;
  search!: Search;
  help!: Help;
  cinema!: Cinema;
  photo!: Photo;
  scanner!: Scanner;
  audio = new Ambient();
  sel: Sel | null = null;
  following: string | null = null;
  outage: { title: string; result: ImpactResult } | null = null;
  npcsVisible = true;
  readonly overlayState: OverlayState = { selected: null, runner: null, hovered: null, scan: false, labels: true, edgeLabels: [] };
  private outageTimers: number[] = [];
  private powered = new Map<string, number>();
  private svcOff: string[] = [];
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDirty = false;
  private pointerIn = false;
  private downAt: { x: number; y: number; t: number; button: number } | null = null;
  private keys = new Set<string>();
  private tip = $('#tip');
  private hoverHit: { kind: string; id: string } | null = null;
  private npcPicks: THREE.Object3D[] = [];
  private markerPicks: THREE.Object3D[] = [];

  constructor(readonly core: Core) {}

  async build(step: Step) {
    const core = this.core;
    await step('Bauwerke errichten', 30);
    this.city = new City(core);
    await step('Himmel, Wasser und Regen', 50);
    this.env = new Environment(core, this.city.env.beacons);
    await step('Datenströme verlegen', 62);
    this.flows = new Flows(core, this.city.structures);
    this.fx = new Fx(core, this.city.structures);
    this.city.registerEmitters(this.fx);
    await step('Agents aufwecken', 74);
    this.director = new Director(core, this.flows);
    this.director.onArrive((r, node) => this.onAgentArrive(r.def.color, node));
    this.npcPicks = this.director.runners.flatMap(r => r.npc.pick);
    this.markerPicks = this.fx.markers.map(m => m.sprite);
    await step('Oberfläche', 84);
    this.overlay = new Overlay(core, this.city, this.director, this.flows, this.overlayState);
    this.dossier = new Dossier(this, this.director);
    this.log = new LogPanel(this.director, this, () => this.sel);
    new Ticker(this);
    this.minimap = new Minimap(core, this.director, () => this.selectedStructure());
    this.menus = new Menus(this);
    this.search = new Search(this);
    this.help = new Help();
    this.cinema = new Cinema(this);
    this.photo = new Photo(this);
    this.scanner = new Scanner(this);
    this.buildLegend();
    this.header();
    this.bindInput();
    this.restoreSettings();
    core.onUpdate((dt, t) => this.update(dt, t));
    core.onUserMove(() => { if (this.cinema.on) this.cinema.stop(); });
  }

  /* ---------------- Einstellungen ---------------- */

  private restoreSettings() {
    const q = store.get<Quality>('quality', 'ultra');
    this.core.setQuality(['ultra', 'hoch', 'mittel', 'niedrig'].includes(q) ? q : 'ultra');
    const w = store.get<Weather>('weather', 'regen');
    this.setWeather(['regen', 'sturm', 'nebel', 'klar'].includes(w) ? w : 'regen');
    if (store.get('log', window.innerWidth > 1100)) this.log.toggle(true);
    if (!store.get('minimap', true)) this.minimap.toggle(false);
    if (store.get('firstVisit', true)) { this.help.toggle(true); store.set('firstVisit', false); }
  }

  setQuality(q: Quality) {
    this.core.setQuality(q);
    store.set('quality', q);
  }

  setWeather(w: Weather) {
    this.env.setWeather(w);
    store.set('weather', w);
  }

  setTempo(s: number) {
    if (s === 0) { this.director.paused = true; return; }
    this.director.paused = false;
    this.director.speedFactor = s;
  }

  setToggle(what: string, on: boolean) {
    if (what === 'packets') this.flows.packetsOn = on;
    else if (what === 'npcs') { this.npcsVisible = on; this.director.runners.forEach(r => { r.npc.group.visible = on; }); }
    else if (what === 'markers') this.fx.setMarkersVisible(on);
    else if (what === 'labels') this.overlayState.labels = on;
  }

  toggleSound() {
    const on = this.audio.toggle();
    this.menus.setPressed('sound', on);
    store.set('sound', on);
  }

  fullscreen() {
    const d = document as Document & { webkitFullscreenElement?: Element };
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) void document.exitFullscreen?.();
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
    } catch { /* optional */ }
  }

  resetView() {
    const c = plan.center;
    this.follow(null);
    // ganze Komposition: Stadt, Brücke und Insel
    this.core.flyTo(new THREE.Vector3(c.x, 0, (plan.bounds.z0 + plan.islandBounds.z1) / 2), { dist: 700, polar: 0.95, azimuth: 0 });
  }

  /* ---------------- Kopf, Legende ---------------- */

  private header() {
    $('#stamp').textContent = model.live.at;
    $('#counts').textContent = `${this.city.structures.size} Bauwerke · ${model.edges.length} Ströme · ${this.director.runners.length} Agents`;
    const clock = $('#clock');
    const tick = () => {
      const d = new Date();
      clock.innerHTML = `${d.toLocaleTimeString('de-DE')}<small>ORTSZEIT</small>`;
    };
    tick();
    setInterval(tick, 1000);
  }

  private buildLegend() {
    const kinds: EdgeKind[] = ['flow', 'ingress', 'proxy', 'alert', 'storage', 'vpn', 'cluster', 'lan'];
    $('#legend').innerHTML = kinds.map(k => `<span class="i"><span class="sw" style="color:${KIND_COLOR[k]}"></span>${esc(LAYERS[k].name)}</span>`).join('')
      + `<span class="i"><span class="sw" style="color:${STATUS_COLOR.crit}"></span>unterbrochen</span>`
      + `<span class="i" style="color:var(--ink-faint)">Klick = Dossier · H = Hilfe</span>`;
  }

  /* ---------------- Auswahl ---------------- */

  private selectedStructure(): string | null {
    if (!this.sel) return null;
    if (this.sel.kind === 'structure') return this.sel.id;
    if (this.sel.kind === 'svc') return model.structureOf(this.sel.id);
    return null;
  }

  select(sel: Sel | null, opts: { fly?: boolean } = {}) {
    this.sel = sel;
    const st = this.overlayState;
    st.selected = null;
    st.runner = null;
    st.edgeLabels = [];
    this.fx.focusFinding(null);
    if (!sel) {
      this.city.select(null);
      this.flows.highlight(null);
      this.dossier.hide();
      this.follow(null);
      return;
    }
    if (sel.kind !== 'npc' && this.following) this.follow(null);
    this.audio.blip(740);
    switch (sel.kind) {
      case 'structure':
      case 'svc': {
        const sid = model.structureOf(sel.id);
        if (!sid) return;
        const ids = sel.kind === 'svc' ? new Set([sel.id]) : new Set([sel.id, ...model.descendants(sel.id)]);
        const edges = model.edges.filter(e => ids.has(e.s) || ids.has(e.t)).map(e => e.id);
        this.city.select(sid);
        this.flows.highlight(edges);
        st.selected = sid;
        st.edgeLabels = edges.filter(id => this.flows.isVisible(this.flows.byEdge.get(id)!)).slice(0, 14);
        if (opts.fly) this.flyTo(sel.id);
        break;
      }
      case 'npc': {
        const r = this.director.byKey.get(sel.id);
        if (!r) return;
        const edges = r.def.steps.map((s, i) => {
          const prev = i === 0 ? r.def.home : r.def.steps[i - 1].to;
          const e = s.via ? model.edges.find(x => x.s === s.via![0] && x.t === s.via![1]) : model.edges.find(x => (x.s === prev && x.t === s.to) || (x.s === s.to && x.t === prev));
          return e?.id;
        }).filter((x): x is string => !!x);
        this.city.select(null);
        this.flows.highlight(edges);
        st.runner = sel.id;
        if (opts.fly !== false) this.follow(sel.id);
        break;
      }
      case 'edge': {
        const e = model.edges.find(x => x.id === sel.id);
        if (!e) return;
        this.city.select(model.structureOf(e.s));
        this.flows.highlight([e.id]);
        st.edgeLabels = [e.id];
        st.selected = model.structureOf(e.s);
        if (opts.fly) { const b = this.flows.bounds(e.id); if (b) this.frameBox(b); }
        break;
      }
      case 'finding': {
        const i = Number(sel.id);
        const f = model.findings[i];
        if (!f) return;
        const ids = new Set(f.n);
        const inner = model.edges.filter(e => ids.has(e.s) && ids.has(e.t)).map(e => e.id);
        this.flows.highlight(inner.length ? inner : model.edges.filter(e => ids.has(e.s) || ids.has(e.t)).map(e => e.id));
        this.fx.focusFinding(i);
        const first = f.n.map(x => model.structureOf(x)).find(x => x && this.city.structures.has(x)) || null;
        this.city.select(first);
        st.selected = first;
        if (opts.fly) {
          const box = new THREE.Box3();
          f.n.forEach(x => { const b = this.city.boundsOf(x); if (b) box.union(b); });
          if (!box.isEmpty()) this.frameBox(box);
        }
        break;
      }
      case 'district': {
        this.city.select(null);
        this.flows.highlight(null);
        const c = this.city.districtCenter(sel.id);
        const d = plan.districts.find(x => x.id === sel.id);
        if (c && d && opts.fly !== false) this.core.flyTo(c, { dist: Math.max(160, Math.max(d.cols, d.rows) * 30 * 2.4) });
        break;
      }
      case 'outage':
        break;
    }
    this.dossier.show(sel);
    if (this.log.filter === 'sel') this.log.rebuild();
  }

  flyTo(id: string) {
    const n = model.find(id);
    if (!n) return;
    const b = this.city.boundsOf(id);
    if (!b) return;
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z, size.y * 0.8);
    const target = new THREE.Vector3(c.x, Math.min(c.y, size.y * 0.35), c.z);
    this.core.flyTo(target, { dist: THREE.MathUtils.clamp(r * 3.2, 60, 700), polar: THREE.MathUtils.clamp(this.core.view().p, 0.85, 1.12) });
  }

  private frameBox(b: THREE.Box3) {
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z, 20);
    this.core.flyTo(new THREE.Vector3(c.x, 0, c.z), { dist: THREE.MathUtils.clamp(r * 2.0, 80, 900), polar: THREE.MathUtils.clamp(this.core.view().p, 0.8, 1.1) });
  }

  follow(key: string | null) {
    this.following = key;
    this.director.runners.forEach(r => { r.npc.selected = r.key === key || r.key === this.overlayState.runner; });
    if (key) {
      const r = this.director.byKey.get(key);
      if (r) this.core.flyTo(r.pos.clone(), { dist: THREE.MathUtils.clamp(this.core.view().d, 75, 130), duration: 1.2 });
      if (this.sel?.kind !== 'npc' || this.sel.id !== key) this.select({ kind: 'npc', id: key }, { fly: false });
    }
    if (this.dossier.current?.kind === 'npc') this.dossier.show(this.dossier.current);
  }

  previewEdges(ids: string[] | null) {
    if (!ids) {
      // zurück zur Hervorhebung der Auswahl
      this.select(this.sel, { fly: false });
      return;
    }
    this.flows.highlight(ids);
    this.overlayState.edgeLabels = ids.slice(0, 6);
  }

  private onAgentArrive(color: string, node: string) {
    // Modellkerne auf ai-models glühen kurz auf, wenn jemand Ollama anfragt
    if (node === 'ollama') {
      const s = this.city.structures.get('g401');
      const cores = s?.group.userData.cores as THREE.Mesh[] | undefined;
      cores?.forEach(c => { const m = c.material as THREE.ShaderMaterial; m.uniforms.uPower.value = 2.4; setTimeout(() => { m.uniforms.uPower.value = 1; }, 1600); });
    }
    void color;
  }

  /* ---------------- Ausfall ---------------- */

  simulate(fails: string[], title: string) {
    if (this.outage) this.restore(true);
    const res = model.impact(fails);
    this.outage = { title, result: res };
    this.director.emit({ runner: null, who: 'AUSFALL', color: '#ff2a3a', text: `Simulation: ${title}`, detail: `${res.down.size} Knoten fallen aus, ${res.deg.size} arbeiten eingeschränkt – nur Darstellung`, tone: 'crit' });
    const downSoFar = new Set<string>();
    const stepsByWave = new Map<number, typeof res.steps>();
    res.steps.forEach(s => {
      const w = Math.round(s.wave * 4) / 4;
      (stepsByWave.get(w) || stepsByWave.set(w, []).get(w)!).push(s);
    });
    const waves = [...stepsByWave.keys()].sort((a, b) => a - b);
    let firstFocus = true;
    waves.forEach(w => {
      const id = window.setTimeout(() => {
        const list = stepsByWave.get(w)!;
        list.forEach(s => {
          downSoFar.add(s.id);
          const n = model.find(s.id);
          if (!n) return;
          if (this.city.structures.has(s.id)) {
            this.powered.set(s.id, 0);
            this.city.setStructurePower(s.id, 0);
            const st = this.city.structures.get(s.id)!;
            this.fx.burst(new THREE.Vector3(st.center.x, Math.min(st.top, 40) * 0.7, st.center.z), '#ffb46b', 50, Math.min(12, st.radius));
          } else if (n.t === 'svc') {
            const slot = this.city.structureOf(s.id)?.svc.get(s.id);
            if (slot?.sign) { this.city.env.signs.setPower(slot.sign, 0); this.svcOff.push(s.id); }
          }
          if (n.t !== 'svc' || s.why !== 'parent') {
            const why = s.why === 'fail' ? 'Szenario' : s.why === 'parent' ? `läuft in ${nodeLabel(s.by!)}` : s.why === 'edge' ? `hängt hart an ${nodeLabel(s.by!)}` : `braucht ${nodeLabel(s.by!)}`;
            this.director.emit({ runner: null, who: 'AUSFALL', color: '#ff2a3a', text: `⚡ ${n.label} fällt aus`, detail: why, tone: 'crit', node: s.id });
          }
        });
        const downEdges = new Set(model.edges.filter(e => downSoFar.has(e.s) || downSoFar.has(e.t)).map(e => e.id));
        this.flows.setOutage(downEdges, new Set());
        this.director.setDown(new Set(downSoFar));
        this.audio.powerDown();
        if (firstFocus) {
          firstFocus = false;
          const sid = model.structureOf(fails[0]);
          if (sid) this.flyTo(sid);
        }
      }, 400 + w * 900);
      this.outageTimers.push(id);
    });
    const last = waves.length ? waves[waves.length - 1] : 0;
    this.outageTimers.push(window.setTimeout(() => {
      const downEdges = new Set(model.edges.filter(e => res.down.has(e.s) || res.down.has(e.t)).map(e => e.id));
      this.flows.setOutage(downEdges, new Set(res.degEdges.map(e => e.id)));
      res.deg.forEach(id => {
        if (this.city.structures.has(id) && !res.down.has(id)) { this.powered.set(id, 0.45); this.city.setStructurePower(id, 0.45); }
      });
      if (res.deg.size) this.director.emit({ runner: null, who: 'AUSFALL', color: '#ffb000', text: `${res.deg.size} Knoten arbeiten eingeschränkt weiter`, detail: [...res.deg].slice(0, 6).map(nodeLabel).join(', ') + (res.deg.size > 6 ? ' …' : ''), tone: 'warn' });
    }, 600 + last * 900 + 400));
    this.select({ kind: 'outage', id: 'outage' });
    this.menus.refresh();
  }

  restore(silent = false) {
    this.outageTimers.forEach(t => clearTimeout(t));
    this.outageTimers = [];
    this.powered.forEach((_p, id) => this.city.setStructurePower(id, 1));
    this.powered.clear();
    this.svcOff.forEach(id => {
      const slot = this.city.structureOf(id)?.svc.get(id);
      if (slot?.sign) this.city.env.signs.setPower(slot.sign, 1);
    });
    this.svcOff = [];
    this.flows.setOutage(new Set(), new Set());
    this.director.setDown(new Set());
    const had = this.outage;
    this.outage = null;
    if (!silent && had) this.director.emit({ runner: null, who: 'AUSFALL', color: '#2effc8', text: 'Strom wieder da – Simulation beendet', tone: 'ok' });
    if (this.sel?.kind === 'outage') this.select(null);
    this.menus?.refresh();
  }

  /* ---------------- Eingabe ---------------- */

  private bindInput() {
    const canvas = this.core.renderer.domElement;
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.pointerDirty = true;
      this.pointerIn = true;
      this.tip.style.left = Math.min(window.innerWidth - 330, e.clientX + 16) + 'px';
      this.tip.style.top = Math.min(window.innerHeight - 90, e.clientY + 18) + 'px';
    });
    canvas.addEventListener('pointerleave', () => { this.pointerIn = false; this.setHover(null); });
    canvas.addEventListener('pointerdown', e => {
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
      if (e.button === 0 && this.following) this.follow(null);
      this.menus.close();
    });
    canvas.addEventListener('pointerup', e => {
      const d = this.downAt;
      this.downAt = null;
      if (!d || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 450) return;
      const hit = this.pick();
      this.clickHit(hit, false);
    });
    canvas.addEventListener('dblclick', () => {
      const hit = this.pick();
      this.clickHit(hit, true);
    });
    window.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private pick(): { kind: string; id: string } | null {
    this.ray.setFromCamera(this.pointer, this.core.camera);
    this.ray.layers.enableAll();
    const targets: THREE.Object3D[] = [...this.city.pickables];
    if (this.npcsVisible) targets.push(...this.npcPicks);
    if (this.fx.markersVisible) targets.push(...this.markerPicks.filter(m => m.visible));
    const hits = this.ray.intersectObjects(targets, false);
    // kleine Dinge (Agents, Befund-Marker) gewinnen, wenn sie etwa gleich weit weg sind
    let best: { kind: string; id: string } | null = null;
    let bestScore = Infinity;
    for (const h of hits) {
      const p = h.object.userData.pick as { kind: string; id: string } | undefined;
      if (!p) continue;
      const score = h.distance - (p.kind === 'npc' ? 14 : p.kind === 'finding-marker' ? 8 : 0);
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  private clickHit(hit: { kind: string; id: string } | null, dbl: boolean) {
    if (!hit) { if (!dbl) this.select(null); return; }
    if (hit.kind === 'npc') { this.select({ kind: 'npc', id: hit.id }); return; }
    if (hit.kind === 'finding-marker') {
      const m = this.fx.markers.find(x => x.structure === hit.id);
      if (m) this.select({ kind: 'finding', id: String(m.findings[0]) }, { fly: dbl });
      return;
    }
    this.select({ kind: 'structure', id: hit.id }, { fly: dbl });
  }

  private setHover(hit: { kind: string; id: string } | null) {
    const same = hit && this.hoverHit && hit.kind === this.hoverHit.kind && hit.id === this.hoverHit.id;
    if (same || (!hit && !this.hoverHit)) return;
    this.hoverHit = hit;
    this.overlayState.hovered = hit && hit.kind === 'structure' ? hit.id : null;
    this.city.hover(hit && hit.kind === 'structure' ? hit.id : null);
    this.core.renderer.domElement.style.cursor = hit ? 'pointer' : '';
    if (!hit) { this.tip.hidden = true; return; }
    let html = '';
    if (hit.kind === 'structure') {
      const n = model.get(hit.id);
      const meta = [n.ip, n.vmid != null ? (n.t === 'ct' ? 'CT ' : 'VM ') + n.vmid : '', n.sub].filter(Boolean).join(' · ');
      html = `<b>${esc(n.label)}</b><span class="m">${esc(meta)}</span><br><span class="pill st-${n.st}">${esc(n.st === 'ok' ? 'läuft' : n.st === 'warn' ? 'auffällig' : n.st === 'crit' ? 'defekt' : n.st === 'stopped' ? 'gestoppt' : 'unklar')}</span>`;
    } else if (hit.kind === 'npc') {
      const r = this.director.byKey.get(hit.id)!;
      html = `<b style="color:${r.def.color}">${esc(r.label)}</b><span class="m">${esc(r.def.role)}</span>${r.bubble ? `<br>„${esc(r.bubble.text)}"` : ''}`;
    } else if (hit.kind === 'finding-marker') {
      const m = this.fx.markers.find(x => x.structure === hit.id);
      html = m ? `<b>${m.findings.length} Befund${m.findings.length > 1 ? 'e' : ''}</b>${m.findings.map(i => `<span class="m">· ${esc(model.findings[i].t)}</span>`).join('<br>')}` : '';
    }
    this.tip.innerHTML = html;
    this.tip.hidden = !html;
  }

  private onKey(e: KeyboardEvent) {
    const tgt = e.target as HTMLElement;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); this.search.open(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'escape') {
      if (this.search.isOpen) this.search.close();
      else if (this.help.isOpen) this.help.toggle(false);
      else if (this.photo.on) this.photo.exit();
      else if (this.cinema.on) this.cinema.stop();
      else if (this.menus.isOpen) this.menus.close();
      else if (this.following) this.follow(null);
      else this.select(null);
      return;
    }
    if (this.search.isOpen || this.help.isOpen) return;
    if (this.cinema.on && k !== 'k') this.cinema.stop();
    if (k === 'tab') { e.preventDefault(); this.scanner.toggle(); return; }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '+', '-', '='].includes(k)) {
      this.keys.add(k);
      if (k.startsWith('arrow')) e.preventDefault();
      if (this.following) this.follow(null);
      return;
    }
    switch (k) {
      case '/': e.preventDefault(); this.search.open(); break;
      case 'k': this.cinema.toggle(); break;
      case 'p': this.photo.on ? this.photo.exit() : this.photo.enter(); break;
      case 'l': this.log.toggle(); store.set('log', !this.log.root.hidden); break;
      case 'm': this.minimap.toggle(); store.set('minimap', !this.minimap.root.hidden); break;
      case 'h': case '?': this.help.toggle(); break;
      case 't': this.toggleSound(); break;
      case 'b': this.env.bolt(); this.audio.thunder(); break;
      case 'x': this.director.testAlarm(); break;
      case 'r': this.resetView(); break;
      case 'q': this.core.rotateBy(Math.PI / 4); break;
      case 'e': this.core.rotateBy(-Math.PI / 4); break;
      case 'f': {
        const s = this.selectedStructure();
        if (s) this.flyTo(s);
        else if (this.sel?.kind === 'npc') this.follow(this.sel.id);
        break;
      }
      default: {
        const d = DISTRICT_KEYS.find(([key]) => key === k);
        if (d) this.select({ kind: 'district', id: d[1] }, { fly: true });
      }
    }
  }

  /* ---------------- Bildschleife ---------------- */

  private lastWeather = '';

  private update(dt: number, _t: number) {
    // Hover-Picking höchstens einmal pro Bild
    if (this.pointerDirty && this.pointerIn && !this.core.flying) {
      this.pointerDirty = false;
      this.setHover(this.pick());
    }
    // Kamera folgt einem Agent
    if (this.following) {
      const r = this.director.byKey.get(this.following);
      if (r && !this.core.flying) {
        const t = this.core.controls.target;
        const want = r.pos.clone();
        want.y = Math.max(0, want.y - 3);
        const delta = want.sub(t).multiplyScalar(Math.min(1, dt * 3));
        t.add(delta);
        this.core.camera.position.add(delta);
      }
    }
    // Tastatur-Schwenk
    if (this.keys.size) {
      const v = this.core.view();
      const speed = v.d * 0.9 * dt;
      const fwd = new THREE.Vector3(-Math.sin(v.a), 0, -Math.cos(v.a));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const mv = new THREE.Vector3();
      if (this.keys.has('w') || this.keys.has('arrowup')) mv.add(fwd);
      if (this.keys.has('s') || this.keys.has('arrowdown')) mv.sub(fwd);
      if (this.keys.has('d') || this.keys.has('arrowright')) mv.add(right);
      if (this.keys.has('a') || this.keys.has('arrowleft')) mv.sub(right);
      if (mv.lengthSq() > 0) {
        mv.normalize().multiplyScalar(speed);
        this.core.controls.target.add(mv);
        this.core.camera.position.add(mv);
      }
      if (this.keys.has('+') || this.keys.has('=') || this.keys.has('-')) {
        const f = this.keys.has('-') ? 1 + dt * 1.2 : 1 - dt * 1.2;
        const off = this.core.camera.position.clone().sub(this.core.controls.target).multiplyScalar(f);
        const len = THREE.MathUtils.clamp(off.length(), this.core.controls.minDistance, this.core.controls.maxDistance);
        this.core.camera.position.copy(this.core.controls.target).add(off.setLength(len));
      }
    }
    // Röntgenblick: was zwischen Kamera und Blickziel steht, wird durchsichtig
    {
      let focus: THREE.Vector3;
      let focusId: string | null = null;
      const fr = this.following ? this.director.byKey.get(this.following) : undefined;
      const sid = this.selectedStructure();
      if (fr) focus = fr.pos.clone().setY(fr.pos.y + 1.5);
      else if (sid && this.city.boundsOf(sid)) { focusId = sid; focus = this.city.boundsOf(sid)!.getCenter(new THREE.Vector3()); }
      else focus = this.core.controls.target.clone();
      this.city.updateGhosts(this.core.camera.position, focus, focusId, dt);
    }
    this.dossier.refresh(dt);
    this.audio.rainLevel = this.env.weather === 'klar' ? 0 : this.env.weather === 'sturm' ? 1.6 : this.env.weather === 'nebel' ? 0.2 : 1;
    this.audio.update(dt);
    if (this.lastWeather !== this.env.weather) { this.lastWeather = this.env.weather; this.menus?.setPressed('weather', this.env.weather !== 'regen'); }
  }

  /* ---------------- Selbsttest (für automatisierte Prüfung) ---------------- */

  selfTest() {
    const problems: string[] = [];
    model.nodes.forEach(n => {
      if (n.t === 'group' || n.t === 'svc') return;
      if (!plan.places.has(n.id)) problems.push('kein Platz: ' + n.id);
      if (!this.city.structures.has(n.id)) problems.push('kein Bauwerk: ' + n.id);
    });
    model.nodes.filter(n => n.t === 'svc').forEach(n => {
      const s = this.city.structureOf(n.id);
      if (!s) problems.push('Dienst ohne Gebäude: ' + n.id);
      else if (!s.svc.has(n.id)) problems.push('Dienst ohne Schild: ' + n.id);
    });
    routes.forEach(r => { if (r.path.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) problems.push('Weg mit NaN: ' + r.edge.id); });
    this.flows.paths.forEach(fp => {
      if (fp.poly.pts.some(p => !Number.isFinite(p.x + p.y + p.z))) problems.push('Spur mit NaN: ' + fp.edge.id);
      if (fp.route.medium !== 'internal' && fp.poly.length < 1) problems.push('Spur zu kurz: ' + fp.edge.id);
    });
    this.director.check.problems.forEach(p => problems.push('Agent: ' + p));
    this.director.runners.forEach(r => { if (!Number.isFinite(r.pos.x + r.pos.y + r.pos.z)) problems.push('NPC-Position NaN: ' + r.key); });
    model.findings.forEach((f, i) => f.n.forEach(id => { if (!model.has(id)) problems.push(`Befund ${i}: Knoten ${id} fehlt`); }));
    return {
      ok: problems.length === 0,
      problems,
      stats: {
        nodes: model.nodes.length, edges: model.edges.length, findings: model.findings.length,
        structures: this.city.structures.size, flows: this.flows.paths.length, runners: this.director.runners.length,
        lots: plan.lots.length, districts: plan.districts.length,
        drawCalls: this.core.renderer.info.render.calls, triangles: this.core.renderer.info.render.triangles,
        textures: this.core.renderer.info.memory.textures, geometries: this.core.renderer.info.memory.geometries
      }
    };
  }
}
