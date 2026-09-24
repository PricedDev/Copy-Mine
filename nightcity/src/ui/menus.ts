import { model, LAYERS, SEV, SCENARIOS, TYPES } from '../data/model';
import { KIND_COLOR, SEV_COLOR, STATUS_COLOR } from '../theme';
import type { EdgeKind } from '../data/types';
import { QUALITY, type Quality } from '../world/core';
import { WEATHER_LABEL, type Weather } from '../world/environment';
import { nodeLabel } from '../sim/director';
import { plan } from '../layout/plan';
import { $, esc } from './dom';
import type { App } from '../app';

/*
 * Werkzeugleiste mit Aufklappmenüs, Suche und Hilfe.
 */

type MenuId = 'layers' | 'agents' | 'findings' | 'outage' | 'weather' | 'view';

const BUTTONS: Array<{ id: MenuId | 'sound' | 'help' | 'cinema'; label: string; key?: string; title: string }> = [
  { id: 'layers', label: 'Ebenen', title: 'Datenströme nach Art ein- und ausblenden' },
  { id: 'agents', label: 'Agents', title: 'Alle Agents und Workflows – anklicken zum Folgen' },
  { id: 'findings', label: 'Befunde', title: 'Die Befunde der Topologie-Erhebung' },
  { id: 'outage', label: 'Ausfall', title: 'Ausfall simulieren: was fällt mit?' },
  { id: 'weather', label: 'Wetter', title: 'Regen, Gewitter, Nebel, klare Nacht' },
  { id: 'view', label: 'Ansicht', title: 'Qualität, Modi, Kamera' },
  { id: 'cinema', label: 'Kino', key: 'K', title: 'Kinomodus: automatischer Rundflug (K)' },
  { id: 'sound', label: 'Ton', key: 'T', title: 'Stadtklang an/aus (T)' },
  { id: 'help', label: '?', key: 'H', title: 'Hilfe und Legende (H)' }
];

export class Menus {
  private bar = $('#toolbar');
  private open: { id: MenuId; el: HTMLElement } | null = null;

  constructor(private app: App) {
    BUTTONS.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.type = 'button';
      btn.id = 'tb-' + b.id;
      btn.title = b.title;
      btn.innerHTML = esc(b.label) + (b.key ? ` <span class="k">${b.key}</span>` : '');
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        if (b.id === 'sound') app.toggleSound();
        else if (b.id === 'help') app.help.toggle();
        else if (b.id === 'cinema') app.cinema.toggle();
        else this.toggle(b.id, btn);
      });
      this.bar.appendChild(btn);
    });
    document.addEventListener('pointerdown', ev => {
      if (this.open && !this.open.el.contains(ev.target as Node) && !(ev.target as HTMLElement).closest('#toolbar')) this.close();
    });
  }

  setPressed(id: string, on: boolean) {
    const b = document.getElementById('tb-' + id);
    if (b) b.setAttribute('aria-pressed', String(on));
  }

  close() {
    if (!this.open) return;
    this.open.el.remove();
    document.getElementById('tb-' + this.open.id)?.setAttribute('aria-expanded', 'false');
    this.open = null;
  }

  get isOpen() {
    return !!this.open;
  }

  toggle(id: MenuId, btn?: HTMLElement) {
    if (this.open?.id === id) { this.close(); return; }
    this.close();
    const el = document.createElement('div');
    el.className = 'menu chip-panel';
    el.setAttribute('role', 'dialog');
    this.fill(id, el);
    document.getElementById('app')!.appendChild(el);
    const b = btn || document.getElementById('tb-' + id)!;
    const r = b.getBoundingClientRect();
    const w = Math.min(420, window.innerWidth - 32);
    const left = Math.max(16, Math.min(window.innerWidth - w - 16, r.left));
    el.style.left = left + 'px';
    el.style.top = r.bottom + 8 + 'px';
    b.setAttribute('aria-expanded', 'true');
    this.open = { id, el };
  }

  refresh() {
    if (this.open) this.fill(this.open.id, this.open.el);
  }

  private fill(id: MenuId, el: HTMLElement) {
    const a = this.app;
    switch (id) {
      case 'layers': {
        const counts = new Map<EdgeKind, number>();
        model.edges.forEach(e => counts.set(e.k, (counts.get(e.k) || 0) + 1));
        const kinds = Object.keys(LAYERS) as EdgeKind[];
        el.innerHTML = `<h3>Ebenen</h3><p class="hint">Jede Linie ist eine echte Kante aus dem Netzatlas, auf ihrem Weg durch die Stadt. Pakete fließen in Pfeilrichtung, Antworten zurück.</p>
          <div class="list">${kinds.map(k => `<label class="tog"><input type="checkbox" data-k="${k}" ${a.flows.layers[k] ? 'checked' : ''}><span class="sw" style="color:${KIND_COLOR[k]}"></span>${esc(LAYERS[k].name)} <span class="hint">· ${counts.get(k) || 0}</span></label>`).join('')}</div>
          <div class="row"><button class="btn" type="button" data-all="1">Alle an</button><button class="btn" type="button" data-all="0">Alle aus</button></div>
          <h3 style="margin-top:6px">Stadt</h3>
          <label class="tog"><input type="checkbox" data-t="packets" ${a.flows.packetsOn ? 'checked' : ''}>Datenpakete</label>
          <label class="tog"><input type="checkbox" data-t="npcs" ${a.npcsVisible ? 'checked' : ''}>Agents (NPCs)</label>
          <label class="tog"><input type="checkbox" data-t="markers" ${a.fx.markersVisible ? 'checked' : ''}>Befund-Hologramme</label>
          <label class="tog"><input type="checkbox" data-t="labels" ${a.overlayState.labels ? 'checked' : ''}>Beschriftungen</label>`;
        el.querySelectorAll<HTMLInputElement>('input[data-k]').forEach(i => i.addEventListener('change', () => a.flows.setLayer(i.dataset.k as EdgeKind, i.checked)));
        el.querySelectorAll<HTMLButtonElement>('[data-all]').forEach(b => b.addEventListener('click', () => {
          kinds.forEach(k => a.flows.setLayer(k, b.dataset.all === '1'));
          this.fill(id, el);
        }));
        el.querySelectorAll<HTMLInputElement>('input[data-t]').forEach(i => i.addEventListener('change', () => a.setToggle(i.dataset.t!, i.checked)));
        break;
      }
      case 'agents': {
        const rs = a.director.runners;
        el.innerHTML = `<h3>Agents & Workflows</h3><p class="hint">${rs.length} NPCs auf ${new Set(rs.map(r => r.def.id)).size} Routen. Anklicken: Kamera folgt, Dossier zeigt die ganze Runde.</p>
          <div class="list">${rs.map(r => {
            const st = r.currentStep;
            const s = r.phase === 'move' && st ? `→ ${nodeLabel(st.to)}` : r.phase === 'work' ? `bei ${nodeLabel(r.node)}` : r.phase === 'blocked' ? 'blockiert' : 'wartet';
            return `<button class="item" type="button" data-r="${esc(r.key)}" style="color:${r.def.color}"><span class="dot"></span><span><span class="t" style="color:var(--ink)">${esc(r.label)}</span><span class="s">${esc(r.def.role)}</span></span><span class="r">${esc(s)}</span></button>`;
          }).join('')}</div>`;
        el.querySelectorAll<HTMLButtonElement>('[data-r]').forEach(b => b.addEventListener('click', () => { a.select({ kind: 'npc', id: b.dataset.r! }, { fly: true }); a.follow(b.dataset.r!); this.close(); }));
        break;
      }
      case 'findings': {
        const rank = { crit: 0, warn: 1, info: 2, good: 3 } as const;
        const list = model.findings.map((f, i) => ({ f, i })).sort((x, y) => rank[x.f.sev] - rank[y.f.sev]);
        el.innerHTML = `<h3>Befunde</h3><p class="hint">${list.length} Befunde aus der Topologie-Erhebung (${esc(model.live.at)}). Die Hologramme über den Gebäuden zeigen, wo sie sitzen.</p>
          <div class="list">${list.map(({ f, i }) => `<button class="item" type="button" data-f="${i}" style="color:${SEV_COLOR[f.sev]}"><span class="dot"></span><span><span class="t" style="color:var(--ink)">${esc(f.t)}</span><span class="s">${esc(SEV[f.sev])} · ${f.n.length} Stellen</span></span><span class="r"></span></button>`).join('')}</div>`;
        el.querySelectorAll<HTMLButtonElement>('[data-f]').forEach(b => b.addEventListener('click', () => { a.select({ kind: 'finding', id: b.dataset.f! }, { fly: true }); this.close(); }));
        break;
      }
      case 'outage': {
        el.innerHTML = `<h3>Ausfall-Simulation</h3><p class="hint">Knipst den Strom aus und zeigt Welle für Welle, was mitfällt – harte Abhängigkeiten reißen mit, weiche machen nur schwach. Im echten Homelab passiert dabei nichts.</p>
          <div class="list">${SCENARIOS.map(([t, ids], i) => `<button class="item" type="button" data-s="${i}" style="color:var(--crit)"><span class="dot"></span><span><span class="t" style="color:var(--ink)">${esc(t)}</span><span class="s">${ids.map(x => esc(model.find(x)?.label || x)).join(', ')}</span></span><span class="r"></span></button>`).join('')}</div>
          <div class="row">${a.outage ? '<button class="btn" type="button" data-restore="1">Strom wieder an</button>' : ''}<button class="btn" type="button" data-alarm="1">Test-Alarm zeigen <span class="k">X</span></button></div>
          <p class="hint">Einzelne Gebäude: im Dossier „Ausfall simulieren".</p>`;
        el.querySelectorAll<HTMLButtonElement>('[data-s]').forEach(b => b.addEventListener('click', () => {
          const [t, ids] = SCENARIOS[Number(b.dataset.s)];
          a.simulate(ids, t);
          this.close();
        }));
        el.querySelector('[data-restore]')?.addEventListener('click', () => { a.restore(); this.close(); });
        el.querySelector('[data-alarm]')?.addEventListener('click', () => { a.director.testAlarm(); this.close(); });
        break;
      }
      case 'weather': {
        const ws = Object.keys(WEATHER_LABEL) as Weather[];
        el.innerHTML = `<h3>Wetter</h3><div class="row">${ws.map(w => `<button class="btn ${a.env.weather === w ? 'on' : ''}" type="button" data-w="${w}">${esc(WEATHER_LABEL[w])}</button>`).join('')}</div>
          <div class="row"><button class="btn" type="button" data-bolt="1">Blitz <span class="k">B</span></button></div>`;
        el.querySelectorAll<HTMLButtonElement>('[data-w]').forEach(b => b.addEventListener('click', () => { a.setWeather(b.dataset.w as Weather); this.fill(id, el); }));
        el.querySelector('[data-bolt]')?.addEventListener('click', () => a.env.bolt());
        break;
      }
      case 'view': {
        const qs = Object.keys(QUALITY) as Quality[];
        el.innerHTML = `<h3>Ansicht</h3>
          <span class="eyebrow">Grafikqualität</span><div class="row">${qs.map(q => `<button class="btn ${a.core.quality === q ? 'on' : ''}" type="button" data-q="${q}">${esc(QUALITY[q].label)}</button>`).join('')}</div>
          <span class="eyebrow">Tempo der Agents</span><div class="row">${[0, 1, 2, 4].map(s => `<button class="btn ${(s === 0 ? a.director.paused : !a.director.paused && a.director.speedFactor === s) ? 'on' : ''}" type="button" data-s="${s}">${s === 0 ? 'Pause' : s + '×'}</button>`).join('')}</div>
          <span class="eyebrow">Modi</span>
          <div class="row"><button class="btn" type="button" data-m="cinema">Kinomodus <span class="k">K</span></button><button class="btn" type="button" data-m="photo">Fotomodus <span class="k">P</span></button><button class="btn ${a.scanner.on ? 'on' : ''}" type="button" data-m="scan">Scanner <span class="k">Tab</span></button></div>
          <div class="row"><button class="btn" type="button" data-m="log">Protokoll <span class="k">L</span></button><button class="btn" type="button" data-m="map">Minimap <span class="k">M</span></button><button class="btn" type="button" data-m="full">Vollbild <span class="k">F11</span></button></div>
          <span class="eyebrow">Kamera</span>
          <div class="row"><button class="btn" type="button" data-m="reset">Gesamtansicht <span class="k">R</span></button><button class="btn" type="button" data-m="ql">⟲ drehen <span class="k">Q</span></button><button class="btn" type="button" data-m="qr">⟳ drehen <span class="k">E</span></button></div>
          <p class="hint">FPS: <span class="mono" id="fps">–</span></p>`;
        el.querySelectorAll<HTMLButtonElement>('[data-q]').forEach(b => b.addEventListener('click', () => { a.setQuality(b.dataset.q as Quality); this.fill(id, el); }));
        el.querySelectorAll<HTMLButtonElement>('[data-s]').forEach(b => b.addEventListener('click', () => { a.setTempo(Number(b.dataset.s)); this.fill(id, el); }));
        el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach(b => b.addEventListener('click', () => {
          const m = b.dataset.m;
          if (m === 'cinema') { this.close(); a.cinema.toggle(); }
          else if (m === 'photo') { this.close(); a.photo.enter(); }
          else if (m === 'scan') { a.scanner.toggle(); this.fill(id, el); }
          else if (m === 'log') a.log.toggle();
          else if (m === 'map') a.minimap.toggle();
          else if (m === 'full') a.fullscreen();
          else if (m === 'reset') a.resetView();
          else if (m === 'ql') a.core.rotateBy(Math.PI / 4);
          else if (m === 'qr') a.core.rotateBy(-Math.PI / 4);
        }));
        const fps = el.querySelector('#fps');
        const upd = () => { if (!el.isConnected) return; if (fps) fps.textContent = a.core.fps.toFixed(0); setTimeout(upd, 500); };
        upd();
        break;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Suche                                                               */
/* ------------------------------------------------------------------ */

interface Hit { kind: 'structure' | 'svc' | 'npc' | 'finding' | 'district'; id: string; title: string; sub: string; right: string; hay: string; }

export class Search {
  private root = $('#search');
  private input = $('#search-input') as HTMLInputElement;
  private res = $('#search-res');
  private items: Hit[] = [];
  private hits: Hit[] = [];
  private active = 0;

  constructor(private app: App) {
    model.nodes.forEach(n => {
      if (n.t === 'group') return;
      const kind = n.t === 'svc' ? 'svc' : 'structure';
      if (kind === 'structure' && !app.city.structures.has(n.id)) return;
      const parent = n.parent ? model.find(n.parent) : undefined;
      const right = n.ip ? n.ip : n.vmid != null ? String(n.vmid) : TYPES[n.t];
      this.items.push({ kind, id: n.id, title: n.label, sub: `${TYPES[n.t]}${n.vmid != null ? ' ' + n.vmid : ''} · ${n.sub}${parent && n.t === 'svc' ? ' · in ' + parent.label : ''}`, right, hay: [n.label, n.sub, n.ip, n.mac, n.vmid, n.tags, n.res, (n.facts || []).join(' '), parent?.label].join(' ').toLowerCase() });
    });
    app.director.runners.forEach(r => this.items.push({ kind: 'npc', id: r.key, title: r.label, sub: 'Agent · ' + r.def.role, right: r.def.model, hay: [r.label, r.def.role, r.def.facts.join(' '), r.def.steps.map(s => s.say).join(' ')].join(' ').toLowerCase() }));
    model.findings.forEach((f, i) => this.items.push({ kind: 'finding', id: String(i), title: f.t, sub: 'Befund · ' + SEV[f.sev], right: SEV[f.sev], hay: (f.t + ' ' + f.p).toLowerCase() }));
    plan.districts.forEach(d => this.items.push({ kind: 'district', id: d.id, title: d.name, sub: 'Viertel · ' + d.sub, right: 'Viertel', hay: (d.name + ' ' + d.sub).toLowerCase() }));
    this.input.addEventListener('input', () => this.run());
    this.input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { this.active = Math.min(this.hits.length - 1, this.active + 1); this.paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this.active = Math.max(0, this.active - 1); this.paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { const h = this.hits[this.active]; if (h) this.pick(h); }
      else if (e.key === 'Escape') { this.close(); e.stopPropagation(); }
    });
    this.root.addEventListener('pointerdown', e => { if (e.target === this.root) this.close(); });
    this.res.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button[data-i]') as HTMLButtonElement | null;
      if (b) this.pick(this.hits[Number(b.dataset.i)]);
    });
    $('#search-open').addEventListener('click', () => this.open());
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open() {
    this.root.hidden = false;
    this.input.value = '';
    this.run();
    setTimeout(() => this.input.focus(), 10);
  }

  close() {
    this.root.hidden = true;
    this.input.blur();
  }

  private run() {
    const q = this.input.value.trim().toLowerCase();
    if (!q) {
      this.hits = this.items.filter(i => i.kind === 'structure' && ['pve'].includes(model.get(i.id).t)).concat(this.items.filter(i => i.kind === 'npc').slice(0, 6));
    } else {
      const words = q.split(/\s+/);
      this.hits = this.items
        .map(i => {
          const t = i.title.toLowerCase();
          if (!words.every(w => i.hay.includes(w) || t.includes(w))) return null;
          const score = (t === q ? 100 : 0) + (t.startsWith(q) ? 50 : 0) + (t.includes(q) ? 20 : 0) + (i.kind === 'structure' ? 5 : 0);
          return { i, score };
        })
        .filter((x): x is { i: Hit; score: number } => !!x)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40)
        .map(x => x.i);
    }
    this.active = 0;
    this.paint();
  }

  private paint() {
    this.res.innerHTML = this.hits.length ? this.hits.map((h, i) => {
      const col = h.kind === 'structure' || h.kind === 'svc' ? STATUS_COLOR[model.get(h.id).st] : h.kind === 'finding' ? SEV_COLOR[model.findings[Number(h.id)].sev] : h.kind === 'npc' ? this.app.director.byKey.get(h.id)!.def.color : 'var(--yellow)';
      return `<button type="button" data-i="${i}" class="${i === this.active ? 'act' : ''}"><span><b style="border-left:3px solid ${col};padding-left:7px">${esc(h.title)}</b><span class="s">${esc(h.sub)}</span></span><span class="r">${esc(h.right)}</span></button>`;
    }).join('') : '<p class="eyebrow" style="padding:8px">Nichts gefunden – versuch einen Namen, eine IP (.202) oder VMID (301).</p>';
    this.res.querySelector('.act')?.scrollIntoView({ block: 'nearest' });
  }

  private pick(h: Hit) {
    this.close();
    this.app.select({ kind: h.kind, id: h.id }, { fly: true });
    if (h.kind === 'npc') this.app.follow(h.id);
  }
}

/* ------------------------------------------------------------------ */
/* Hilfe                                                               */
/* ------------------------------------------------------------------ */

export class Help {
  private root = $('#help');
  constructor() {
    const kinds = Object.keys(LAYERS) as EdgeKind[];
    $('#help-box').innerHTML = `
      <h2>So liest du die Stadt</h2>
      <div><h4>Die Übersetzung</h4><dl>
        <dt>Corp-Türme</dt><dd>Proxmox-Nodes – Höhe nach RAM, jedes Viertel ein Node</dd>
        <dt>Hochhäuser</dt><dd>VMs – Höhe ∝ RAM, Breite ∝ vCPU</dd>
        <dt>Modul-Stapel</dt><dd>LXC-Container</dd>
        <dt>Leuchtschilder</dt><dd>Software/Dienste am Gebäude</dd>
        <dt>Fensterlicht</dt><dd>Auslastung laut Live-Werten</dd>
        <dt>Straßen</dt><dd>LAN – jede Kante fährt ihren echten Weg</dd>
        <dt>Hochbahn</dt><dd>Tailnet (Overlay über der Stadt)</dd>
        <dt>Lichtbögen</dt><dd>Corosync-Stimmen zur Plaza</dd>
        <dt>Tor + Brücke</dt><dd>Speedport und WAN-Uplink</dd>
        <dt>Insel</dt><dd>Internet & Cloud-Dienste</dd>
        <dt>NPCs</dt><dd>Agents & Workflows – jeder Schritt eine echte Kante</dd>
      </dl></div>
      <div><h4>Datenströme</h4><dl>${kinds.map(k => `<dt style="color:${KIND_COLOR[k]}">━━</dt><dd>${esc(LAYERS[k].name)} – ${esc(LAYERS[k].long)}</dd>`).join('')}
        <dt>rot am Ende</dt><dd>unterbrochen: Ziel gestoppt/defekt</dd><dt>gestrichelt</dt><dd>unbestätigt</dd></dl></div>
      <div><h4>Steuerung</h4><dl>
        <dt>Linke Maus</dt><dd>verschieben · Klick wählt aus</dd><dt>Rechte Maus</dt><dd>drehen / neigen</dd><dt>Mausrad</dt><dd>zoomen</dd>
        <dt>Doppelklick</dt><dd>hinfliegen</dd><dt>W A S D · Pfeile</dt><dd>schwenken</dd><dt>Q / E</dt><dd>um 45° drehen</dd>
        <dt>1 – 7</dt><dd>Viertel anspringen</dd><dt>R</dt><dd>Gesamtansicht</dd><dt>/ · Strg+K</dt><dd>Suche</dd>
        <dt>K</dt><dd>Kinomodus</dd><dt>P</dt><dd>Fotomodus</dd><dt>Tab</dt><dd>Scanner</dd><dt>L · M</dt><dd>Protokoll · Minimap</dd>
        <dt>T</dt><dd>Ton</dd><dt>B · X</dt><dd>Blitz · Test-Alarm</dd><dt>Esc</dt><dd>schließen / zurück</dd>
      </dl></div>
      <div class="foot"><p>Datenstand ${esc(model.live.at)} · dieselbe data.js wie der Netzatlas · ${model.nodes.length} Knoten, ${model.edges.length} Kanten, ${model.findings.length} Befunde. Pakete und Takt der Agents sind in der Stadt verdichtet; Wege, Richtungen und Texte sind echt.</p>
      <div class="row" style="display:flex;gap:8px"><a class="btn" href="http://192.168.2.175/topologie/" target="_blank" rel="noopener">Netzatlas öffnen</a><button class="btn on" type="button" id="help-close">Los geht's</button></div></div>`;
    this.root.addEventListener('pointerdown', e => { if (e.target === this.root) this.toggle(false); });
    $('#help-close').addEventListener('click', () => this.toggle(false));
  }
  get isOpen() { return !this.root.hidden; }
  toggle(show?: boolean) { this.root.hidden = show == null ? !this.root.hidden : !show; }
}
