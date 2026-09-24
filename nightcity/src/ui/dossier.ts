import { model, LAYERS, TYPES, STATUS, SEV, type CEdge, type ImpactResult } from '../data/model';
import { KIND_COLOR, SEV_COLOR, STATUS_COLOR, CORP } from '../theme';
import type { EdgeKind } from '../data/types';
import { plan } from '../layout/plan';
import { routeById } from '../layout/routes';
import type { Director, Runner } from '../sim/director';
import { nodeLabel } from '../sim/director';
import { $, esc, fmt } from './dom';

/*
 * Das Dossier rechts: alles, was man über die Auswahl wissen kann –
 * Steckbrief, Live-Werte, Software, jede Verbindung (mit Richtung, Art,
 * hart/weich), Befunde, vorbeikommende Agents und bei Agents die ganze
 * Runde mit dem aktuellen Schritt.
 */

export type SelKind = 'structure' | 'svc' | 'npc' | 'edge' | 'finding' | 'district' | 'outage';
export interface Sel { kind: SelKind; id: string; }

export interface Ctl {
  select(sel: Sel | null, opts?: { fly?: boolean }): void;
  flyTo(id: string): void;
  follow(key: string | null): void;
  simulate(fails: string[], title: string): void;
  restore(): void;
  previewEdges(ids: string[] | null): void;
  readonly following: string | null;
  readonly outage: { title: string; result: ImpactResult } | null;
}

const MEDIUM: Record<string, string> = { road: 'über die Straßen (LAN)', rail: 'über die Tailnet-Hochbahn', air: 'als Lichtbogen zur Plaza', internal: 'innerhalb des Gebäudes' };

function meter(label: string, used: number, max: number, unit: string, pct?: number): string {
  const p = pct != null ? pct : (max ? used / max * 100 : 0);
  const cls = p >= 90 ? 'c' : p >= 80 ? 'w' : '';
  const val = pct != null ? `${fmt(p)} %` : `${fmt(used)} / ${fmt(max)} ${unit}`;
  return `<div class="meter"><span>${esc(label)}</span><span class="bar"><i class="${cls}" style="width:${Math.min(100, p).toFixed(1)}%"></i></span><span class="v">${val}</span></div>`;
}

function pill(st: string, text?: string) {
  return `<span class="pill st-${st}">${esc(text ?? STATUS[st as keyof typeof STATUS] ?? st)}</span>`;
}

function edgeFlags(e: CEdge): string {
  const f: string[] = [e.h ? 'hart' : 'weich'];
  if (e.b) f.push('<span class="st-crit">unterbrochen</span>');
  if (e.u) f.push('<span class="st-unknown">unbestätigt</span>');
  return f.join(' · ');
}

export class Dossier {
  private root = $('#dossier');
  private eyebrow = $('#d-eyebrow');
  private title = $('#d-title');
  private meta = $('#d-meta');
  private body = $('#d-body');
  current: Sel | null = null;
  private tick = 0;

  constructor(private ctl: Ctl, private director: Director) {
    $('#d-close').addEventListener('click', () => ctl.select(null));
    this.body.addEventListener('click', e => this.onClick(e));
    this.body.addEventListener('mouseover', e => {
      const t = (e.target as HTMLElement).closest('[data-edges]') as HTMLElement | null;
      if (t) ctl.previewEdges(t.dataset.edges!.split(','));
    });
    this.body.addEventListener('mouseout', e => {
      const t = (e.target as HTMLElement).closest('[data-edges]');
      if (t && !(e.relatedTarget as HTMLElement | null)?.closest?.('[data-edges]')) ctl.previewEdges(null);
    });
  }

  private onClick(e: Event) {
    const t = (e.target as HTMLElement).closest('[data-sel],[data-fly],[data-follow],[data-sim],[data-restore],[data-unfollow]') as HTMLElement | null;
    if (!t) return;
    if (t.dataset.sel) {
      const [kind, ...rest] = t.dataset.sel.split(':');
      this.ctl.select({ kind: kind as SelKind, id: rest.join(':') }, { fly: true });
    } else if (t.dataset.fly) this.ctl.flyTo(t.dataset.fly);
    else if (t.dataset.follow) this.ctl.follow(t.dataset.follow);
    else if (t.dataset.unfollow != null) this.ctl.follow(null);
    else if (t.dataset.sim) this.ctl.simulate([t.dataset.sim], nodeLabel(t.dataset.sim));
    else if (t.dataset.restore != null) this.ctl.restore();
  }

  hide() {
    this.current = null;
    this.root.hidden = true;
    document.body.classList.remove('dossier-open');
  }

  show(sel: Sel) {
    const prev = this.current;
    const same = !!prev && prev.kind === sel.kind && prev.id === sel.id && !this.root.hidden;
    const keep = same ? this.body.scrollTop : 0;
    this.current = sel;
    let ok = false;
    switch (sel.kind) {
      case 'structure': ok = this.structure(sel.id); break;
      case 'svc': ok = this.svc(sel.id); break;
      case 'npc': ok = this.npc(sel.id); break;
      case 'edge': ok = this.edge(sel.id); break;
      case 'finding': ok = this.finding(Number(sel.id)); break;
      case 'district': ok = this.district(sel.id); break;
      case 'outage': ok = this.outage(); break;
    }
    if (!ok) { this.hide(); return; }
    this.root.hidden = false;
    document.body.classList.add('dossier-open');
    this.body.scrollTop = keep;
  }

  /** Live-Teile (Agent-Schritt) regelmäßig neu zeichnen */
  refresh(dt: number) {
    this.tick += dt;
    if (this.tick < 0.6 || !this.current) return;
    this.tick = 0;
    if (this.current.kind === 'npc') {
      const keep = this.body.scrollTop;
      this.npc(this.current.id);
      this.body.scrollTop = keep;
    }
  }

  private head(eyebrow: string, title: string, meta: string) {
    this.eyebrow.textContent = eyebrow;
    this.title.textContent = title;
    this.meta.innerHTML = meta;
  }

  /* ---------------- Bausteine ---------------- */

  private linksOf(ids: Set<string>): string {
    const edges = model.edges.filter(e => ids.has(e.s) || ids.has(e.t));
    if (!edges.length) return '<p class="eyebrow">keine Verbindungen</p>';
    const byKind = new Map<EdgeKind, CEdge[]>();
    edges.forEach(e => (byKind.get(e.k) || byKind.set(e.k, []).get(e.k)!).push(e));
    const order: EdgeKind[] = ['ingress', 'proxy', 'flow', 'storage', 'alert', 'vpn', 'cluster', 'mon', 'ssh', 'lan'];
    return order.filter(k => byKind.has(k)).map(k => {
      const list = byKind.get(k)!;
      const items = list.map(e => {
        const out = ids.has(e.s);
        const other = out ? e.t : e.s;
        const arrow = out ? '→' : '←';
        return `<button class="link" type="button" data-sel="edge:${e.id}" data-edges="${e.id}" style="color:${KIND_COLOR[e.k]}">
          <span class="sw"></span>
          <span><span class="n" style="color:var(--ink)">${arrow} ${esc(nodeLabel(other))}</span><span class="fl" style="color:var(--ink-faint)">${edgeFlags(e)}</span>
          <span class="d">${esc(e.d)}</span></span></button>`;
      }).join('');
      return `<div class="sec"><div class="eyebrow" style="color:${KIND_COLOR[k]}"><span>${esc(LAYERS[k].name)}</span><span>${list.length}</span></div><div class="links">${items}</div></div>`;
    }).join('');
  }

  private findingsOf(ids: Set<string>): string {
    const list = model.findings.map((f, i) => ({ f, i })).filter(({ f }) => f.n.some(x => ids.has(x)));
    if (!list.length) return '';
    return `<div class="sec"><div class="eyebrow"><span>Befunde</span><span>${list.length}</span></div>${list.map(({ f, i }) => `
      <button class="finding" type="button" data-sel="finding:${i}" style="color:${SEV_COLOR[f.sev]}">
        <b>${esc(SEV[f.sev])} · ${esc(f.t)}</b>
        <p>${f.p}</p></button>`).join('')}</div>`;
  }

  private agentsOf(ids: Set<string>): string {
    const rs = this.director.runners.filter(r => ids.has(r.def.home) || r.def.steps.some(s => ids.has(s.to)));
    if (!rs.length) return '';
    const seen = new Set<string>();
    const items = rs.filter(r => { if (seen.has(r.def.id)) return false; seen.add(r.def.id); return true; }).map(r => `
      <button class="link" type="button" data-follow="${esc(r.key)}" style="color:${r.def.color}">
        <span class="sw"></span><span><span class="n" style="color:var(--ink)">${esc(r.def.name)}</span><span class="d">${esc(r.def.role)}</span></span></button>`).join('');
    return `<div class="sec"><div class="eyebrow"><span>Agents, die hier arbeiten</span><span>${seen.size}</span></div><div class="links">${items}</div></div>`;
  }

  private factsList(facts?: string[]): string {
    if (!facts?.length) return '';
    return `<div class="sec"><div class="eyebrow"><span>Fakten</span><span>${facts.length}</span></div><ul class="facts">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>`;
  }

  /* ---------------- Ansichten ---------------- */

  private structure(id: string): boolean {
    const n = model.find(id);
    if (!n) return false;
    const vm = n.vmid != null ? (n.t === 'ct' ? `CT ${n.vmid}` : n.t === 'vm' ? `VM ${n.vmid}` : '') : '';
    this.head(`${TYPES[n.t]}${vm ? ' · ' + vm : ''}`, n.label, `${pill(n.st)} ${esc(n.sub)}${n.ip ? ' · <span class="mono">' + esc(n.ip) + '</span>' : ''}`);
    const parts: string[] = [];
    // Live
    const g = model.guestLive(id);
    const L = model.nodeLive(id);
    if (L) {
      const a = model.alloc(id);
      parts.push(`<div class="sec"><div class="eyebrow"><span>Live · ${esc(model.live.at)}</span><span>${L.thr} Threads</span></div>
        ${meter('CPU', 0, 0, '', L.cpu)}${meter('RAM', L.mem, L.memMax, 'GB')}${L.pool ? meter('VM-Pool', L.pool[0], L.pool[1], 'GB') : meter('Root', L.root[0], L.root[1], 'GB')}
        <div class="eyebrow" style="text-transform:none;letter-spacing:0.02em">${a && a.sum ? `RAM zugesagt <b class="${a.pct > 100 ? 'st-crit' : a.pct > 85 ? 'st-warn' : ''}">${fmt(a.sum)} GB = ${fmt(a.pct, 0)} %</b> · ` : ''}läuft seit ${fmt(L.up)} Tagen · ${model.votes(id)} Corosync-Stimme${model.votes(id) === 1 ? '' : 'n'}</div></div>`);
    } else if (g) {
      parts.push(`<div class="sec"><div class="eyebrow"><span>Live · ${esc(model.live.at)}</span><span>läuft seit ${fmt(g[3])} d</span></div>
        ${meter('CPU', 0, 0, '', g[0])}${meter('RAM', g[1], g[2], 'GB')}</div>`);
    }
    // Steckbrief
    const kv: string[] = [];
    if (n.ip) kv.push(`<dt>IP</dt><dd>${esc(n.ip)}</dd>`);
    if (n.mac) kv.push(`<dt>MAC</dt><dd>${esc(n.mac)}</dd>`);
    if (n.res) kv.push(`<dt>Ressourcen</dt><dd>${esc(n.res)}</dd>`);
    if (n.ports) kv.push(`<dt>Ports</dt><dd>${esc(n.ports)}</dd>`);
    if (n.tags) kv.push(`<dt>Tags</dt><dd>${esc(n.tags)}</dd>`);
    if (n.parent && model.get(n.parent).t === 'pve') kv.push(`<dt>Node</dt><dd><button class="btn" type="button" data-sel="structure:${n.parent}">${esc(model.get(n.parent).label)}</button></dd>`);
    if (n.seen) kv.push(`<dt>Quelle</dt><dd>${esc(n.seen)}</dd>`);
    if (kv.length) parts.push(`<div class="sec"><div class="eyebrow"><span>Steckbrief</span></div><dl class="kv">${kv.join('')}</dl></div>`);
    parts.push(this.factsList(n.facts));
    // Software / Gäste
    const svc = n.kids.filter(k => model.get(k).t === 'svc');
    if (svc.length) {
      parts.push(`<div class="sec"><div class="eyebrow"><span>Software</span><span>${svc.length}</span></div><div class="links">${svc.map(k => {
        const s = model.get(k);
        return `<button class="link" type="button" data-sel="svc:${k}" style="color:${STATUS_COLOR[s.st]}"><span class="sw"></span><span><span class="n" style="color:var(--ink)">${esc(s.label)}</span><span class="d">${esc(s.sub)}</span></span></button>`;
      }).join('')}</div></div>`);
    }
    const guests = n.kids.filter(k => ['vm', 'ct'].includes(model.get(k).t));
    if (guests.length) {
      const sorted = [...guests].sort((a, b) => (model.get(a).st === 'stopped' ? 1 : 0) - (model.get(b).st === 'stopped' ? 1 : 0));
      parts.push(`<div class="sec"><div class="eyebrow"><span>Gäste</span><span>${guests.filter(k => model.get(k).st !== 'stopped').length} laufen · ${guests.length} gesamt</span></div><div class="links">${sorted.map(k => {
        const s = model.get(k);
        return `<button class="link" type="button" data-sel="structure:${k}" style="color:${STATUS_COLOR[s.st]}"><span class="sw"></span><span><span class="n" style="color:var(--ink)">${esc(s.label)}</span><span class="d">${esc(s.sub)}${s.res ? ' · ' + esc(s.res) : ''}</span></span></button>`;
      }).join('')}</div></div>`);
    }
    const ids = new Set([id, ...model.descendants(id)]);
    parts.push(this.findingsOf(ids));
    parts.push(`<div class="sec"><div class="eyebrow"><span>Verbindungen</span><span>${model.edges.filter(e => ids.has(e.s) || ids.has(e.t)).length}</span></div></div>`);
    parts.push(this.linksOf(ids));
    parts.push(this.agentsOf(ids));
    parts.push(`<div class="actions"><button class="btn" type="button" data-fly="${id}">Kamera hin</button>${n.t !== 'group' ? `<button class="btn danger" type="button" data-sim="${id}">Ausfall simulieren</button>` : ''}</div>`);
    this.body.innerHTML = parts.join('');
    return true;
  }

  private svc(id: string): boolean {
    const n = model.find(id);
    if (!n || !n.parent) return false;
    const p = model.get(n.parent);
    this.head(`Dienst · in ${p.label}`, n.label, `${pill(n.st)} <span class="mono">${esc(n.sub)}</span>`);
    const parts: string[] = [];
    parts.push(`<div class="sec"><div class="eyebrow"><span>Läuft in</span></div><div class="links"><button class="link" type="button" data-sel="structure:${p.id}" style="color:${STATUS_COLOR[p.st]}"><span class="sw"></span><span><span class="n" style="color:var(--ink)">${esc(p.label)}</span><span class="d">${esc(TYPES[p.t])} · ${esc(p.sub)}</span></span></button></div></div>`);
    if (n.seen) parts.push(`<dl class="kv"><dt>Quelle</dt><dd>${esc(n.seen)}</dd></dl>`);
    parts.push(this.factsList(n.facts));
    const ids = new Set([id]);
    parts.push(this.findingsOf(ids));
    parts.push(this.linksOf(ids));
    parts.push(this.agentsOf(ids));
    parts.push(`<div class="actions"><button class="btn" type="button" data-fly="${id}">Kamera hin</button><button class="btn danger" type="button" data-sim="${id}">Ausfall simulieren</button></div>`);
    this.body.innerHTML = parts.join('');
    return true;
  }

  private npc(key: string): boolean {
    const r = this.director.byKey.get(key);
    if (!r) return false;
    const d = r.def;
    const st = r.currentStep;
    const state = r.phase === 'move' && st ? `unterwegs zu ${nodeLabel(st.to)}` : r.phase === 'work' ? `arbeitet bei ${nodeLabel(r.node)}` : r.phase === 'blocked' ? `blockiert (${nodeLabel(r.blockedBy || r.node)})` : `wartet bei ${nodeLabel(r.node)}`;
    this.head(`Agent · ${d.model === 'av' ? 'AV' : d.model === 'drone' ? 'Drohne' : d.model === 'human' ? 'Mensch' : d.model === 'pod' ? 'Tailnet-Kapsel' : 'Roboter'}`, r.label, `<span class="pill" style="color:${d.color}">${esc(state)}</span> ${esc(d.role)}`);
    const following = this.ctl.following === key;
    const edgesOfRound = d.steps.map((s, i) => {
      const prev = i === 0 ? d.home : d.steps[i - 1].to;
      const e = s.via ? model.edges.find(x => x.s === s.via![0] && x.t === s.via![1]) : model.edges.find(x => (x.s === prev && x.t === s.to) || (x.s === s.to && x.t === prev));
      return e?.id || '';
    });
    const parts: string[] = [];
    parts.push(`<div class="actions">${following ? '<button class="btn on" type="button" data-unfollow>Kamera folgt · beenden</button>' : `<button class="btn" type="button" data-follow="${esc(key)}">Kamera folgen</button>`}<button class="btn" type="button" data-sel="structure:${model.structureOf(d.home)}">Zuhause: ${esc(nodeLabel(d.home))}</button></div>`);
    parts.push(`<dl class="kv"><dt>Takt</dt><dd>${esc(d.schedule)}</dd><dt>Runden</dt><dd>${r.rounds} seit dem Laden</dd></dl>`);
    parts.push(this.factsList(d.facts));
    parts.push(`<div class="sec"><div class="eyebrow"><span>Runde · jeder Schritt eine echte Kante</span><span data-edges="${edgesOfRound.filter(Boolean).join(',')}" style="cursor:help">alle zeigen</span></div><div class="steps">${d.steps.map((s, i) => {
      const prev = i === 0 ? d.home : d.steps[i - 1].to;
      const eid = edgesOfRound[i];
      const e = eid ? model.edges.find(x => x.id === eid) : undefined;
      const now = r.step === i;
      return `<div class="st${now ? ' now' : ''}" data-sel="${e ? 'edge:' + e.id : 'svc:' + s.to}" ${e ? `data-edges="${e.id}"` : ''}><span>${esc(s.say)}${now && r.phase === 'move' ? ' <span class="st-warn">◀ jetzt</span>' : now ? ' <span class="st-ok">◀ hier</span>' : ''}<span class="d">${esc(nodeLabel(prev))} ${e && e.s === prev ? '→' : '←'} ${esc(nodeLabel(s.to))}${e ? ' · ' + esc(e.d) : ''}</span></span></div>`;
    }).join('')}</div></div>`);
    const hist = r.history.slice(-10).reverse();
    if (hist.length) parts.push(`<div class="sec"><div class="eyebrow"><span>Zuletzt</span><span>${hist.length}</span></div><div class="links">${hist.map(h => `<div class="le ${h.tone}" style="cursor:default"><span class="tm">${esc(h.time)}</span><span><span class="tx">${esc(h.text)}</span>${h.detail ? `<span class="dt">${esc(h.detail)}</span>` : ''}</span></div>`).join('')}</div></div>`);
    this.body.innerHTML = parts.join('');
    return true;
  }

  private edge(id: string): boolean {
    const e = model.edges.find(x => x.id === id);
    if (!e) return false;
    const r = routeById.get(id);
    this.head(`Verbindung · ${LAYERS[e.k].name}`, `${nodeLabel(e.s)} → ${nodeLabel(e.t)}`, `<span class="mono">${esc(e.d)}</span>`);
    const users = this.director.runners.filter((x: Runner) => x.def.steps.some((s, i) => {
      const prev = i === 0 ? x.def.home : x.def.steps[i - 1].to;
      return (prev === e.s && s.to === e.t) || (prev === e.t && s.to === e.s);
    }));
    const seen = new Set<string>();
    const parts: string[] = [];
    parts.push(`<dl class="kv"><dt>Art</dt><dd style="color:${KIND_COLOR[e.k]}">${esc(LAYERS[e.k].long)}</dd>
      <dt>Abhängigkeit</dt><dd>${e.h ? 'hart – fällt das Ziel aus, fällt die Quelle mit' : 'weich – die Quelle arbeitet eingeschränkt weiter'}</dd>
      ${e.b ? '<dt>Zustand</dt><dd class="st-crit">unterbrochen – das Ziel ist gestoppt oder defekt</dd>' : ''}
      ${e.u ? '<dt>Sicherheit</dt><dd class="st-unknown">unbestätigt (angenommen)</dd>' : ''}
      ${r ? `<dt>Weg</dt><dd>${esc(MEDIUM[r.medium])}${r.medium === 'road' || r.medium === 'rail' ? ` · ${fmt(r.length, 0)} m` : ''}</dd>` : ''}</dl>`);
    parts.push(`<div class="actions"><button class="btn" type="button" data-sel="${model.get(e.s).t === 'svc' ? 'svc' : 'structure'}:${e.s}">Quelle: ${esc(nodeLabel(e.s))}</button><button class="btn" type="button" data-sel="${model.get(e.t).t === 'svc' ? 'svc' : 'structure'}:${e.t}">Ziel: ${esc(nodeLabel(e.t))}</button></div>`);
    const us = users.filter(x => { if (seen.has(x.def.id)) return false; seen.add(x.def.id); return true; });
    if (us.length) parts.push(`<div class="sec"><div class="eyebrow"><span>Agents auf dieser Kante</span><span>${us.length}</span></div><div class="links">${us.map(x => `<button class="link" type="button" data-follow="${esc(x.key)}" style="color:${x.def.color}"><span class="sw"></span><span><span class="n" style="color:var(--ink)">${esc(x.def.name)}</span><span class="d">${esc(x.def.role)}</span></span></button>`).join('')}</div></div>`);
    this.body.innerHTML = parts.join('');
    return true;
  }

  private finding(i: number): boolean {
    const f = model.findings[i];
    if (!f) return false;
    this.head(`Befund · ${SEV[f.sev]}`, f.t, `<span class="pill st-${f.sev}">${esc(SEV[f.sev])}</span> ${f.n.length} betroffene Stellen`);
    const parts: string[] = [];
    parts.push(`<div class="finding" style="color:${SEV_COLOR[f.sev]};cursor:default"><p>${f.p}</p>${f.fx ? `<span class="fx">${f.fx}</span>` : ''}</div>`);
    parts.push(`<div class="sec"><div class="eyebrow"><span>Betroffen</span><span>${f.n.length}</span></div><div class="links">${f.n.map(id => {
      const n = model.find(id);
      if (!n) return '';
      const kind = n.t === 'svc' ? 'svc' : n.t === 'virtual' ? 'structure' : 'structure';
      return `<button class="link" type="button" data-sel="${kind}:${id}" style="color:${STATUS_COLOR[n.st]}"><span class="sw"></span><span><span class="n" style="color:var(--ink)">${esc(n.label)}</span><span class="d">${esc(TYPES[n.t])} · ${esc(n.sub)}</span></span></button>`;
    }).join('')}</div></div>`);
    this.body.innerHTML = parts.join('');
    return true;
  }

  private district(id: string): boolean {
    const d = plan.districts.find(x => x.id === id);
    if (!d) return false;
    this.head('Viertel', d.name, esc(d.sub));
    const members = plan.lots.filter(l => l.district === id && l.node).map(l => l.node!);
    const parts: string[] = [];
    if (d.node && CORP[d.node]) {
      parts.push(`<div class="actions"><button class="btn" type="button" data-sel="structure:${d.node}">Turm ${esc(model.get(d.node).label)} öffnen</button></div>`);
    }
    parts.push(`<div class="sec"><div class="eyebrow"><span>Bauwerke</span><span>${members.length}</span></div><div class="links">${members.map(m => {
      const n = model.get(m);
      return `<button class="link" type="button" data-sel="structure:${m}" style="color:${STATUS_COLOR[n.st]}"><span class="sw"></span><span><span class="n" style="color:var(--ink)">${esc(n.label)}</span><span class="d">${esc(TYPES[n.t])} · ${esc(n.sub)}</span></span></button>`;
    }).join('')}</div></div>`);
    this.body.innerHTML = parts.join('');
    return true;
  }

  private outage(): boolean {
    const o = this.ctl.outage;
    if (!o) return false;
    const res = o.result;
    const down = res.steps.filter(s => model.find(s.id) && model.get(s.id).t !== 'group');
    this.head('Ausfall-Simulation', o.title, `<span class="pill st-crit">${res.down.size} aus</span> <span class="pill st-warn">${res.deg.size} eingeschränkt</span>`);
    const why = (s: typeof down[number]) => {
      if (s.why === 'fail') return 'fällt aus (Szenario)';
      if (s.why === 'parent') return `läuft in ${nodeLabel(s.by!)}`;
      if (s.why === 'edge') return `hängt hart an ${nodeLabel(s.by!)}${s.edge ? ' – ' + s.edge.d : ''}`;
      return `braucht ${nodeLabel(s.by!)}`;
    };
    const parts: string[] = [];
    parts.push(`<div class="actions"><button class="btn" type="button" data-restore>Strom wieder an</button></div>`);
    parts.push(`<p class="eyebrow" style="text-transform:none;letter-spacing:0.02em">Gleicher Algorithmus wie die Ausfall-Simulation im Netzatlas: Kinder fallen mit ihrem Host, harte Kanten und „need"-Ketten reißen weitere Knoten mit, weiche Kanten machen die Quelle nur eingeschränkt.</p>`);
    parts.push(`<div class="sec"><div class="eyebrow"><span>Kaskade · Schritt für Schritt</span><span>${down.length}</span></div><div class="cascade">${down.map(s => {
      const n = model.get(s.id);
      const kind = n.t === 'svc' ? 'svc' : 'structure';
      return `<button class="c" type="button" data-sel="${kind}:${s.id}"><span class="w">W${Math.floor(s.wave)}</span><span><b>${esc(n.label)}</b> <span style="color:var(--ink-dim)">${esc(why(s))}</span></span></button>`;
    }).join('')}</div></div>`);
    if (res.degEdges.length) {
      parts.push(`<div class="sec"><div class="eyebrow"><span>Eingeschränkt (weiche Abhängigkeit)</span><span>${res.degEdges.length}</span></div><div class="cascade">${res.degEdges.map(e => `<button class="c" type="button" data-sel="edge:${e.id}" data-edges="${e.id}"><span class="w" style="color:${KIND_COLOR[e.k]}">●</span><span><b>${esc(nodeLabel(e.s))}</b> <span style="color:var(--ink-dim)">verliert ${esc(nodeLabel(e.t))} – ${esc(e.d)}</span></span></button>`).join('')}</div></div>`);
    }
    this.body.innerHTML = parts.join('');
    return true;
  }
}
