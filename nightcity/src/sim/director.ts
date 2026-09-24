import * as THREE from 'three';
import { AGENTS, validateAgents, type AgentDef, type NpcModel, type Step } from './agents';
import { model, type CEdge } from '../data/model';
import { routeById, edgeBetween, dedupe, placeOf, type Route } from '../layout/routes';
import { RAIL_Y, WALK, type V2 } from '../layout/plan';
import { NpcVisual } from '../world/npcs';
import { Poly, offsetPath } from '../world/poly';
import { noReflect, type Core } from '../world/core';
import type { Flows } from '../world/flows';
import type { EdgeKind } from '../data/types';

/*
 * Regie der Agents: jeder NPC läuft seine Runde Schritt für Schritt über die
 * echten Wege der Stadt. Jeder Schritt landet mit Uhrzeit, Kante und Text im
 * Protokoll – nachvollziehbar, wer wann was wohin schickt.
 */

export type Tone = 'info' | 'ok' | 'warn' | 'crit' | 'sys';

export interface LogEntry {
  id: number;
  time: string;
  runner: string | null;
  who: string;
  color: string;
  text: string;
  detail?: string;
  kind?: EdgeKind;
  tone: Tone;
  edge?: string;
  node?: string;
}

type Phase = 'idle' | 'move' | 'work' | 'blocked';

const SPEED: Record<NpcModel, number> = { bot: 7.5, human: 5.4, courier: 9, spider: 8, drone: 17, av: 24, pod: 20 };

export class Runner {
  node: string;
  step = -1;
  phase: Phase = 'idle';
  path: Poly | null = null;
  s = 0;
  timer: number;
  bubble: { text: string; until: number; tone: Tone } | null = null;
  edge: CEdge | null = null;
  forward = true;
  history: LogEntry[] = [];
  readonly pos = new THREE.Vector3();
  heading = 0;
  blockedBy: string | null = null;
  rounds = 0;

  constructor(readonly key: string, readonly def: AgentDef, readonly npc: NpcVisual, readonly lateral: number, start: number) {
    this.node = def.home;
    this.timer = start;
  }

  get speed() {
    return SPEED[this.def.model];
  }

  get currentStep(): Step | null {
    return this.step >= 0 ? this.def.steps[this.step] : null;
  }

  get label() {
    return this.def.count && this.def.count > 1 ? `${this.def.name} ${this.key.split('#')[1]}` : this.def.name;
  }
}

function clock(): string {
  const d = new Date();
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function nodeLabel(id: string): string {
  const n = model.find(id);
  if (!n) return id;
  if (n.t === 'svc' && n.parent) return `${n.label} (${model.get(n.parent).label})`;
  return n.label;
}

export class Director {
  readonly runners: Runner[] = [];
  readonly byKey = new Map<string, Runner>();
  readonly log: LogEntry[] = [];
  private listeners: Array<(e: LogEntry) => void> = [];
  private arriveHooks: Array<(r: Runner, node: string) => void> = [];
  private seq = 0;
  private down = new Set<string>();
  paused = false;
  speedFactor = 1;
  readonly check: { ok: boolean; problems: string[] };

  constructor(private core: Core, private flows: Flows) {
    this.check = validateAgents((a, b) => edgeBetween(a, b));
    if (!this.check.ok) console.warn('[Agents] Prüfung:', this.check.problems);
    let slot = 0;
    AGENTS.forEach(def => {
      const n = def.count ?? 1;
      for (let i = 0; i < n; i++) {
        const key = n > 1 ? `${def.id}#${i + 1}` : def.id;
        const npc = new NpcVisual(def.model, def.color, key);
        const lateral = ((slot++ % 5) - 2) * 0.55;
        const r = new Runner(key, def, npc, lateral, 1.5 + Math.random() * 6 + i * 7);
        this.placeAtRest(r);
        npc.group.traverse(o => { o.castShadow = false; });
        noReflect(npc.group);
        core.scene.add(npc.group);
        this.runners.push(r);
        this.byKey.set(key, r);
      }
    });
    this.emit({ runner: null, who: 'SYSTEM', color: '#fcee0a', text: `${this.runners.length} Agents auf ${AGENTS.length} Routen gestartet`, tone: 'sys', detail: this.check.ok ? 'alle Schritte über echte Kanten geprüft ✓' : `${this.check.problems.length} Prüfprobleme – siehe Konsole` });
    core.onUpdate((dt, t) => this.update(dt, t));
  }

  onLog(fn: (e: LogEntry) => void) {
    this.listeners.push(fn);
  }

  onArrive(fn: (r: Runner, node: string) => void) {
    this.arriveHooks.push(fn);
  }

  emit(e: Omit<LogEntry, 'id' | 'time'>) {
    const entry: LogEntry = { ...e, id: ++this.seq, time: clock() };
    this.log.push(entry);
    if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
    if (e.runner) {
      const r = this.byKey.get(e.runner);
      if (r) { r.history.push(entry); if (r.history.length > 40) r.history.shift(); }
    }
    this.listeners.forEach(f => f(entry));
  }

  /* ---------------- Wege ---------------- */

  private restPoint(node: string, lateral: number): { p: THREE.Vector3; heading: number } {
    const pl = placeOf(node);
    const base = pl.anchored ? { x: pl.x, z: pl.z } : pl.entrance;
    const side = pl.door.side;
    const out = side === 's' ? { x: 0, z: 1 } : side === 'n' ? { x: 0, z: -1 } : side === 'e' ? { x: 1, z: 0 } : { x: -1, z: 0 };
    const perp = { x: -out.z, z: out.x };
    const k = pl.anchored ? 0 : 1.4;
    const p = new THREE.Vector3(base.x + out.x * k + perp.x * lateral * 2.2, 0.2, base.z + out.z * k + perp.z * lateral * 2.2);
    return { p, heading: Math.atan2(out.x, out.z) };
  }

  private placeAtRest(r: Runner) {
    const { p, heading } = this.restPoint(r.node, r.lateral);
    const fly = r.npc.flying;
    r.pos.copy(p);
    if (fly) r.pos.y = r.def.model === 'av' ? 3.2 : 2.6;
    r.heading = heading;
    r.npc.group.position.copy(r.pos);
    r.npc.group.rotation.y = r.heading;
  }

  private buildPath(r: Runner, route: Route, forward: boolean): Poly {
    const kind = r.def.model;
    const fly = kind === 'drone' || kind === 'av';
    const a = forward ? route.parts.a : [...route.parts.b].reverse();
    const b = forward ? route.parts.b : [...route.parts.a].reverse();
    const st = forward ? route.parts.street : [...route.parts.street].reverse();
    const start = r.pos.clone();
    const endRest = this.restPoint(forward ? route.edge.t : route.edge.s, r.lateral).p;
    const pts: THREE.Vector3[] = [start];
    if (route.medium === 'internal') {
      pts.push(start.clone().add(new THREE.Vector3(0, 0, 0.01)));
      return new Poly(pts);
    }
    if (route.medium === 'rail') {
      const lane = 0.72 + r.lateral * 0.1;
      const ride = kind === 'av' ? RAIL_Y + 5 : RAIL_Y + 1.1;
      a.forEach(p => pts.push(new THREE.Vector3(p.x, fly ? 3 : 0.2, p.z)));
      if (st.length) {
        pts.push(new THREE.Vector3(st[0].x, fly ? 3 : 0.2, st[0].z));
        offsetPath(st, lane).forEach(p => pts.push(new THREE.Vector3(p.x, ride, p.z)));
        const last = st[st.length - 1];
        pts.push(new THREE.Vector3(last.x, fly ? 3 : 0.2, last.z));
      }
      b.forEach(p => pts.push(new THREE.Vector3(p.x, fly ? 3 : 0.2, p.z)));
    } else {
      const flat = dedupe([...a, ...st, ...b]);
      if (fly) {
        const alt = kind === 'av' ? 22 + r.lateral * 2 : 15 + r.lateral * 2;
        const f0 = flat[0], f1 = flat[flat.length - 1];
        pts.push(new THREE.Vector3(f0.x, alt, f0.z));
        flat.forEach(p => pts.push(new THREE.Vector3(p.x, alt, p.z)));
        pts.push(new THREE.Vector3(f1.x, alt, f1.z));
      } else {
        offsetPath(flat, WALK + r.lateral * 0.3).forEach((p: V2) => pts.push(new THREE.Vector3(p.x, 0.2, p.z)));
      }
    }
    const end = endRest.clone();
    if (fly) end.y = kind === 'av' ? 3.2 : 2.6;
    pts.push(end);
    return new Poly(pts);
  }

  /* ---------------- Ablauf ---------------- */

  private say(r: Runner, text: string, tone: Tone = 'info', t = this.core.timer.getElapsed()) {
    r.bubble = { text, until: t + 4.2, tone };
  }

  private isDown(id: string): boolean {
    const s = model.structureOf(id);
    return this.down.has(id) || (!!s && this.down.has(s));
  }

  private startStep(r: Runner, t: number) {
    const def = r.def;
    const next = r.step + 1;
    if (next >= def.steps.length) {
      r.step = -1;
      r.phase = 'idle';
      r.rounds++;
      r.timer = (def.pause[0] + Math.random() * (def.pause[1] - def.pause[0])) / this.speedFactor;
      r.edge = null;
      this.flows.setPulse(null, r.key);
      return;
    }
    const st = def.steps[next];
    if (this.isDown(st.to) || this.isDown(r.node)) {
      const who = this.isDown(r.node) ? r.node : st.to;
      if (r.blockedBy !== who) {
        const msg = `⚠ ${nodeLabel(who)} ist ausgefallen – warte`;
        this.say(r, msg, 'crit', t);
        this.emit({ runner: r.key, who: r.label, color: def.color, text: msg, tone: 'crit', node: who });
      }
      r.blockedBy = who;
      r.phase = 'blocked';
      r.timer = 3;
      return;
    }
    if (r.blockedBy) {
      this.emit({ runner: r.key, who: r.label, color: def.color, text: `Verbindung wieder da – weiter`, tone: 'ok' });
      r.blockedBy = null;
    }
    let edge: CEdge | undefined;
    let forward = true;
    if (st.via) {
      edge = model.edges.find(e => e.s === st.via![0] && e.t === st.via![1]);
      forward = !!edge && edge.s === r.node;
    } else if (r.edge && ((r.edge.s === r.node && r.edge.t === st.to) || (r.edge.t === r.node && r.edge.s === st.to))) {
      edge = r.edge;
      forward = edge.s === r.node;
    } else {
      const eb = edgeBetween(r.node, st.to);
      if (eb) { edge = eb.edge; forward = eb.forward; }
    }
    if (!edge) {
      // sollte durch die Prüfung ausgeschlossen sein – überspringen statt hängen
      r.step = next;
      r.node = st.to;
      this.placeAtRest(r);
      return;
    }
    const route = routeById.get(edge.id)!;
    r.step = next;
    r.edge = edge;
    r.forward = forward;
    r.path = this.buildPath(r, route, forward);
    r.s = 0;
    r.phase = 'move';
    const from = nodeLabel(r.node), to = nodeLabel(st.to);
    const detail = `${forward ? '→' : '←'} ${from} → ${to} · ${edge.d}`;
    this.say(r, st.say, 'info', t);
    this.emit({ runner: r.key, who: r.label, color: def.color, text: st.say, detail, kind: edge.k, tone: edge.b && forward ? 'warn' : 'info', edge: edge.id, node: st.to });
    this.flows.setPulse(edge.id, r.key);
  }

  private arrive(r: Runner, t: number) {
    const st = r.currentStep!;
    r.node = st.to;
    r.phase = 'work';
    r.timer = (st.work ?? 0.5) / Math.sqrt(this.speedFactor);
    this.arriveHooks.forEach(f => f(r, st.to));
    if (this.isDown(st.to)) {
      const msg = `✖ keine Antwort – ${nodeLabel(st.to)} ist aus`;
      this.say(r, msg, 'crit', t);
      this.emit({ runner: r.key, who: r.label, color: r.def.color, text: msg, tone: 'crit', node: st.to });
      return;
    }
    if (st.done) {
      const bad = /keine Antwort|DOWN|falsch|abläuft|läuft am|nicht mehr|0 Geräte|kein externes|ausgeloggt|einzige|nur hier|niemand/i.test(st.done);
      const tone: Tone = bad ? (/keine Antwort|DOWN/.test(st.done) ? 'crit' : 'warn') : 'ok';
      this.say(r, st.done, tone, t);
      this.emit({ runner: r.key, who: r.label, color: r.def.color, text: st.done, tone, node: st.to });
    }
  }

  /** Ausfall-Simulation: betroffene Knoten */
  setDown(down: Set<string>) {
    this.down = down;
  }

  private update(dt: number, t: number) {
    if (this.paused) {
      this.runners.forEach(r => r.npc.update(dt, t, false, 0, false));
      return;
    }
    const f = this.speedFactor;
    const tmpT = new THREE.Vector3();
    for (const r of this.runners) {
      switch (r.phase) {
        case 'idle':
        case 'work':
        case 'blocked':
          r.timer -= dt;
          if (r.timer <= 0) this.startStep(r, t);
          break;
        case 'move': {
          const p = r.path!;
          r.s += dt * r.speed * f;
          if (r.s >= p.length) {
            p.at(p.length, r.pos);
            this.arrive(r, t);
          } else {
            p.at(r.s, r.pos, tmpT);
            if (Math.abs(tmpT.x) + Math.abs(tmpT.z) > 0.05) {
              const want = Math.atan2(tmpT.x, tmpT.z);
              let d = want - r.heading;
              while (d > Math.PI) d -= Math.PI * 2;
              while (d < -Math.PI) d += Math.PI * 2;
              r.heading += d * Math.min(1, dt * 8);
            }
          }
          break;
        }
      }
      const g = r.npc.group;
      g.position.copy(r.pos);
      g.rotation.y = r.heading;
      r.npc.glowBoost = r.phase === 'blocked' ? -0.75 : 0;
      r.npc.update(dt, t, r.phase === 'move', r.speed * f, r.phase === 'work');
      if (r.bubble && t > r.bubble.until) r.bubble = null;
    }
  }

  /** Test-Alarm (Gimmick): zeigt die Alarmkette Monitoring → Automatisierungs-Hub */
  testAlarm() {
    const chain = model.edges.filter(x => x.k === 'alert');
    chain.forEach((e, i) => setTimeout(() => this.flows.setPulse(e.id, 'alarm' + i, 1, 5), i * 900));
    this.emit({ runner: null, who: 'SIMULATION', color: '#ff2a6d', text: 'Test-Alarm: Monitoring → Automatisierungs-Hub → Benachrichtigung', tone: 'warn', detail: 'nur Darstellung – im echten Homelab wird nichts ausgelöst' });
  }
}
