import { model, type CEdge } from '../data/model';
import { plan, type Door, type EdgeMode, type GEdge, type GNode, type Place, type V2 } from './plan';

/*
 * Jede Kante der Topologie bekommt ihren echten Weg durch die Stadt:
 *  - road:     über das Straßennetz (LAN), nach draußen über Tor und Brücke
 *  - rail:     Tailnet – über die Hochbahn (Overlay-Netz liegt über der Stadt)
 *  - air:      Corosync-Stimmen – Lichtbogen vom Turm zur Plaza
 *  - internal: beide Enden im selben Gebäude (z. B. localhost:5432)
 * Kürzeste Wege mit Abbiegestrafe, damit Ströme gerade Straßen bevorzugen.
 */

export type Medium = 'road' | 'rail' | 'air' | 'internal';

export interface RouteParts {
  /** Anker/Eingang am Start (vor der Tür) */
  a: V2[];
  /** Straßenteil von Tür zu Tür */
  street: V2[];
  /** Eingang/Anker am Ziel (nach der Tür) */
  b: V2[];
}

export interface Route {
  edge: CEdge;
  medium: Medium;
  /** Mittellinie am Boden: Anker → Eingang → Tür → … → Tür → Eingang → Anker */
  path: V2[];
  parts: RouteParts;
  /** benutzte Straßensegmente */
  segs: GEdge[];
  length: number;
}

/** Knoten, die direkt am Tailnet hängen (Stationen der Hochbahn) */
export const RAIL_NODES = new Set(['b-ts', 'sat-ts', 't100-ts', 'ts-cloud', 'ts-funnel', 'laptop', 'honor', 'desk-ts', 'ts-off']);

const TURN = 12;
const UTURN = 400;

function dirOf(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  if (Math.abs(dx) >= Math.abs(dz)) return dx > 0 ? 1 : 3;
  return dz > 0 ? 2 : 0;
}

const dist = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z);

class Heap<T> {
  private items: Array<{ p: number; v: T; seq: number }> = [];
  private seq = 0;
  get size() { return this.items.length; }
  push(p: number, v: T) {
    const it = { p, v, seq: this.seq++ };
    const a = this.items;
    a.push(it);
    let i = a.length - 1;
    while (i > 0) {
      const pi = (i - 1) >> 1;
      if (this.less(a[i], a[pi])) { [a[i], a[pi]] = [a[pi], a[i]]; i = pi; } else break;
    }
  }
  pop(): { p: number; v: T } | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  private less(x: { p: number; seq: number }, y: { p: number; seq: number }) {
    return x.p < y.p || (x.p === y.p && x.seq < y.seq);
  }
}

interface State { node: GNode; dir: number; }

/** Kürzester Weg zwischen zwei Türen im gewählten Netz. */
export function streetPath(from: Door, to: Door, mode: EdgeMode): { pts: V2[]; segs: GEdge[] } {
  const sameSeg = (from.a === to.a && from.b === to.b) || (from.a === to.b && from.b === to.a);
  if (from.a === from.b && to.a === to.b && from.a === to.a) {
    return { pts: [{ x: from.x, z: from.z }, { x: to.x, z: to.z }], segs: [] };
  }
  const best = new Map<string, number>();
  const prev = new Map<string, { k: string; st: State; e: GEdge } | null>();
  const skey = (s: State) => `${s.node.key}#${s.dir}`;
  const heap = new Heap<State>();
  const starts: Array<[GNode, number]> = from.a === from.b ? [[from.a, 0]] : [[from.a, dist(from, from.a)], [from.b, dist(from, from.b)]];
  starts.forEach(([n, c]) => {
    const st: State = { node: n, dir: from.a === from.b ? 4 : dirOf(from.x, from.z, n.x, n.z) };
    const k = skey(st);
    if (c < (best.get(k) ?? Infinity)) { best.set(k, c); prev.set(k, null); heap.push(c, st); }
  });
  const states = new Map<string, State>();
  while (heap.size) {
    const top = heap.pop()!;
    const st = top.v;
    const k = skey(st);
    if (top.p > (best.get(k) ?? Infinity)) continue;
    states.set(k, st);
    for (const e of st.node.adj) {
      if (!e.modes.includes(mode)) continue;
      const other = e.a === st.node ? e.b : e.a;
      const nd = dirOf(st.node.x, st.node.z, other.x, other.z);
      let c = top.p + e.len * e.weight;
      if (st.dir !== 4 && nd !== st.dir) c += (nd + 2) % 4 === st.dir ? UTURN : TURN;
      const ns: State = { node: other, dir: nd };
      const nk = skey(ns);
      if (c < (best.get(nk) ?? Infinity)) {
        best.set(nk, c);
        prev.set(nk, { k, st, e });
        heap.push(c, ns);
      }
    }
  }
  // Zielanflug
  let bestK = '';
  let bestC = Infinity;
  const goals: GNode[] = to.a === to.b ? [to.a] : [to.a, to.b];
  best.forEach((c, k) => {
    const st = states.get(k);
    if (!st || !goals.includes(st.node)) return;
    let fc = c + dist(st.node, to);
    if (to.a !== to.b) {
      const fd = dirOf(st.node.x, st.node.z, to.x, to.z);
      if (st.dir !== 4 && fd !== st.dir) fc += (fd + 2) % 4 === st.dir ? UTURN : TURN;
    }
    if (fc < bestC - 1e-9) { bestC = fc; bestK = k; }
  });
  if (sameSeg && from.a !== from.b) {
    const direct = dist(from, to);
    if (direct <= bestC) return { pts: [{ x: from.x, z: from.z }, { x: to.x, z: to.z }], segs: [] };
  }
  if (!bestK) throw new Error(`Kein Weg (${mode}) zwischen ${from.x},${from.z} und ${to.x},${to.z}`);
  const nodes: GNode[] = [];
  const segs: GEdge[] = [];
  let cur: string | null = bestK;
  while (cur) {
    const st = states.get(cur)!;
    nodes.push(st.node);
    const p = prev.get(cur);
    if (p) { segs.push(p.e); cur = p.k; } else cur = null;
  }
  nodes.reverse();
  segs.reverse();
  const pts: V2[] = [{ x: from.x, z: from.z }];
  nodes.forEach(n => pts.push({ x: n.x, z: n.z }));
  pts.push({ x: to.x, z: to.z });
  return { pts: dedupe(pts), segs };
}

export function dedupe(pts: V2[]): V2[] {
  const out: V2[] = [];
  pts.forEach(p => {
    const l = out[out.length - 1];
    if (!l || Math.hypot(l.x - p.x, l.z - p.z) > 0.01) out.push({ x: p.x, z: p.z });
  });
  // kollineare Zwischenpunkte entfernen
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z);
    if (Math.abs(cross) < 1e-6 && dot > 0) out.splice(i, 1);
  }
  return out;
}

export function polyLength(pts: V2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

export function placeOf(id: string): Place {
  const sid = model.structureOf(id);
  const p = sid ? plan.place(sid) : undefined;
  if (!p) throw new Error('Kein Platz für ' + id);
  return p;
}

export function mediumOf(e: CEdge): Medium {
  if (e.k === 'cluster') return 'air';
  const sa = model.structureOf(e.s), sb = model.structureOf(e.t);
  if (sa && sa === sb) return 'internal';
  if (e.k === 'vpn' || (RAIL_NODES.has(e.s) && RAIL_NODES.has(e.t))) return 'rail';
  return 'road';
}

/** Weg zwischen zwei Plätzen: Anker → Eingang → Straßen → Eingang → Anker */
export function pathBetween(a: Place, b: Place, mode: EdgeMode): { pts: V2[]; segs: GEdge[]; parts: RouteParts } {
  if (a.lot === b.lot) {
    // gleiches Grundstück (z. B. Wegweiser und Ankunftspunkte auf dem Brückenkopf)
    const pa = { x: a.x, z: a.z }, pb = { x: b.x, z: b.z };
    return { pts: dedupe([pa, pb]), segs: [], parts: { a: [pa], street: [], b: [pb] } };
  }
  const sp = streetPath(a.door, b.door, mode);
  const pa: V2[] = [];
  if (a.anchored) pa.push({ x: a.x, z: a.z });
  pa.push({ ...a.entrance });
  const pb: V2[] = [{ ...b.entrance }];
  if (b.anchored) pb.push({ x: b.x, z: b.z });
  return { pts: dedupe([...pa, ...sp.pts, ...pb]), segs: sp.segs, parts: { a: pa, street: sp.pts, b: pb } };
}

function buildRoute(e: CEdge): Route {
  const medium = mediumOf(e);
  const a = placeOf(e.s), b = placeOf(e.t);
  if (medium === 'internal' || medium === 'air') {
    const pts = medium === 'internal' ? [{ x: a.x, z: a.z }] : [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
    return { edge: e, medium, path: pts, parts: { a: [pts[0]], street: [], b: [pts[pts.length - 1]] }, segs: [], length: medium === 'air' ? dist(a, b) : 0 };
  }
  const { pts, segs, parts } = pathBetween(a, b, medium === 'rail' ? 'rail' : 'road');
  return { edge: e, medium, path: pts, parts, segs, length: polyLength(pts) };
}

export const routes: Route[] = model.edges.map(buildRoute);
export const routeById = new Map(routes.map(r => [r.edge.id, r]));

/** Straßensegmente, über die die Hochbahn fährt */
export const railSegments: GEdge[] = (() => {
  const set = new Map<string, GEdge>();
  routes.forEach(r => { if (r.medium === 'rail') r.segs.forEach(s => set.set(s.key, s)); });
  return Array.from(set.values());
})();

/** Nutzung je Straßensegment (für „belebte" Straßen) */
export const segmentLoad: Map<string, number> = (() => {
  const m = new Map<string, number>();
  routes.forEach(r => { if (r.medium === 'road') r.segs.forEach(s => m.set(s.key, (m.get(s.key) || 0) + 1)); });
  return m;
})();

/** Kante zwischen zwei Knoten in beliebiger Richtung (für die Agents) */
export function edgeBetween(a: string, b: string, kind?: string): { edge: CEdge; forward: boolean } | null {
  const f = model.edges.find(e => e.s === a && e.t === b && (!kind || e.k === kind));
  if (f) return { edge: f, forward: true };
  const r = model.edges.find(e => e.s === b && e.t === a && (!kind || e.k === kind));
  if (r) return { edge: r, forward: false };
  return null;
}
