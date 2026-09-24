import { model, type CNode } from '../data/model';
import { CORP } from '../theme';

/*
 * Der Stadtplan: ein festes Raster (bewusst, statt Force-Layout).
 * Jede Zelle ist ein Grundstück, jede Rasterlinie eine Straße. Viertel
 * werden aus den Daten bemessen – kommen Gäste dazu, wächst das Viertel.
 *
 *   Band A:  [AI]  [PROXMOX]  [x3d / Wyse-Kolonie]
 *   Band B:  [Heimnetz]  [Plaza]  (Bucht)
 *            [Heimnetz]  [Speedport-Tor]
 *   Brücke über die Bucht → Insel „Außenwelt" (Internet & Cloud)
 */

export const P = 30;              // Rasterabstand Straßenmitte ↔ Straßenmitte
export const HALF = 4.5;          // halbe Straßenbreite (inkl. Gehweg)
export const ROAD_HALF = 3;       // halbe Fahrbahn
export const WALK = 3.75;         // Gehweg-Mitte ab Straßenmitte
export const RAIL_Y = 15;         // Höhe der Tailnet-Hochbahn

export type Side = 'n' | 's' | 'e' | 'w';
export type LotKind =
  | 'tower' | 'guest' | 'outpost' | 'client' | 'plaza' | 'gate' | 'cloud' | 'bridgehead' | 'terminal' | 'decor';

export interface V2 { x: number; z: number; }

export interface GNode {
  key: string;
  i: number;
  j: number;
  x: number;
  z: number;
  adj: GEdge[];
}

export type EdgeMode = 'road' | 'rail';

export interface GEdge {
  key: string;
  a: GNode;
  b: GNode;
  len: number;
  weight: number;
  bridge: '' | 'road' | 'rail';
  modes: EdgeMode[];
}

export interface Door {
  x: number;
  z: number;
  side: Side;
  a: GNode;
  b: GNode;
}

export interface Lot {
  id: string;
  node: string | null;
  district: string;
  kind: LotKind;
  c: number;
  r: number;
  w: number;
  h: number;
  /** Grundstücksrechteck (ohne Straße) */
  x0: number; z0: number; x1: number; z1: number;
  cx: number; cz: number;
  door: Door;
  decor?: string;
}

export interface District {
  id: string;
  name: string;
  sub: string;
  node: string | null;
  color: string;
  c0: number; r0: number; cols: number; rows: number;
  island?: boolean;
}

/** Wo ein Knoten in der Welt steht */
export interface Place {
  node: string;
  lot: Lot;
  /** Standpunkt des Bauwerks (Mitte oder Ankerpunkt auf dem Grundstück) */
  x: number;
  z: number;
  door: Door;
  /** Eingang am Grundstücksrand – hier beginnen/enden Wege */
  entrance: V2;
  /** Anker ohne eigenes Grundstück (Wegweiser, Kapseln, Ankunftspunkte) */
  anchored: boolean;
}

const key = (i: number, j: number) => `${i},${j}`;
const cellKey = (c: number, r: number) => `${c}|${r}`;

function guestScore(n: CNode): number {
  const running = n.st !== 'stopped' ? 100 : 0;
  const prio = /prio/i.test(n.tags || '') ? 20 : 0;
  const ram = model.resources(n.id).ram;
  return running + prio + ram;
}

function sortGuests(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const na = model.get(a), nb = model.get(b);
    const d = guestScore(nb) - guestScore(na);
    if (Math.abs(d) > 1e-6) return d;
    return (na.vmid || 0) - (nb.vmid || 0);
  });
}

export class CityPlan {
  readonly lots: Lot[] = [];
  readonly districts: District[] = [];
  readonly cells = new Map<string, Lot>();
  readonly nodes = new Map<string, GNode>();
  readonly edges = new Map<string, GEdge>();
  readonly places = new Map<string, Place>();
  readonly avenueX = new Set<number>();
  readonly avenueZ = new Set<number>();
  roadBridge!: { i: number; j0: number; j1: number };
  railBridge!: { i: number; j0: number; j1: number };
  bounds = { x0: 0, z0: 0, x1: 0, z1: 0 };
  islandBounds = { x0: 0, z0: 0, x1: 0, z1: 0 };
  cityCols = 0;
  cityRows = 0;

  constructor() {
    this.build();
  }

  /* ------------------------------------------------------------------ */
  private addLot(l: Omit<Lot, 'x0' | 'z0' | 'x1' | 'z1' | 'cx' | 'cz' | 'door'> & { door?: Side }): Lot {
    const x0 = l.c * P + HALF, z0 = l.r * P + HALF;
    const x1 = (l.c + l.w) * P - HALF, z1 = (l.r + l.h) * P - HALF;
    const lot: Lot = {
      ...l,
      x0, z0, x1, z1,
      cx: (x0 + x1) / 2,
      cz: (z0 + z1) / 2,
      door: { x: 0, z: 0, side: l.door || 's', a: null as unknown as GNode, b: null as unknown as GNode }
    };
    for (let dc = 0; dc < l.w; dc++) {
      for (let dr = 0; dr < l.h; dr++) {
        const k = cellKey(l.c + dc, l.r + dr);
        if (this.cells.has(k)) throw new Error(`Zelle doppelt belegt: ${k} (${this.cells.get(k)!.id} / ${l.id})`);
        this.cells.set(k, lot);
      }
    }
    this.lots.push(lot);
    return lot;
  }

  private build() {
    const pve = model.nodes.filter(n => n.t === 'pve');
    const corpIds = ['pve-ai', 'pve-node1', 'pve-print'].filter(id => model.has(id));
    const thinIds = pve.filter(n => !corpIds.includes(n.id)).map(n => n.id);
    // weitere, künftig hinzukommende große Nodes landen bei den Corps
    pve.forEach(n => {
      if (!corpIds.includes(n.id) && !thinIds.includes(n.id)) corpIds.push(n.id);
    });

    /* ---------- Band A: Corp-Viertel ---------- */
    let c = 0;
    const bandRows: number[] = [];
    const corpDistrict = (id: string, c0: number, r0: number): { cols: number; rows: number } => {
      const guests = sortGuests(model.get(id).kids.filter(k => ['vm', 'ct'].includes(model.get(k).t)));
      const n = guests.length;
      const cols = n > 20 ? 8 : n > 12 ? 6 : 4;
      const rows = Math.max(2, Math.ceil((n + 4) / cols));
      const tc = c0 + Math.floor((cols - 2) / 2);
      const tr = r0 + Math.floor((rows - 2) / 2);
      const style = CORP[id];
      this.districts.push({
        id: 'd-' + id, name: style ? style.district : model.get(id).label, sub: `Node ${model.get(id).label}`,
        node: id, color: style ? style.primary : '#2ec5ff', c0, r0, cols, rows
      });
      this.addLot({ id: 'lot:' + id, node: id, district: 'd-' + id, kind: 'tower', c: tc, r: tr, w: 2, h: 2 });
      // Ringplätze: vorne (Süden) → Seiten von vorn nach hinten → hinten
      const ring: Array<[number, number]> = [];
      for (let r = r0 + rows - 1; r > tr + 1; r--) for (let cc = c0; cc < c0 + cols; cc++) ring.push([cc, r]);
      for (let r = tr + 1; r >= tr; r--) for (let cc = c0; cc < c0 + cols; cc++) if (cc < tc || cc > tc + 1) ring.push([cc, r]);
      for (let r = tr - 1; r >= r0; r--) for (let cc = c0; cc < c0 + cols; cc++) ring.push([cc, r]);
      ring.forEach(([cc, rr], i) => {
        const g = guests[i];
        if (g) this.addLot({ id: 'lot:' + g, node: g, district: 'd-' + id, kind: 'guest', c: cc, r: rr, w: 1, h: 1 });
        else this.addLot({ id: `lot:decor:${cc}:${rr}`, node: null, district: 'd-' + id, kind: 'decor', c: cc, r: rr, w: 1, h: 1, decor: 'plaza' });
      });
      return { cols, rows };
    };

    const corpSizes: Record<string, { c0: number; cols: number; rows: number }> = {};
    const lastCorp = corpIds[corpIds.length - 1];
    corpIds.forEach(id => {
      const sz = corpDistrict(id, c, 0);
      corpSizes[id] = { c0: c, cols: sz.cols, rows: sz.rows };
      bandRows.push(sz.rows);
      c += sz.cols;
    });
    const cityCols = c;

    /* ---------- Wyse-Kolonie unter dem letzten Corp-Viertel ---------- */
    const colony = corpSizes[lastCorp];
    const thinItems: string[] = [];
    thinIds.forEach(t => {
      thinItems.push(t);
      sortGuests(model.get(t).kids.filter(k => ['vm', 'ct'].includes(model.get(k).t))).forEach(g => thinItems.push(g));
    });
    const colCols = colony.cols;
    const colRows = Math.max(1, Math.ceil(thinItems.length / colCols));
    const colR0 = colony.rows;
    this.districts.push({ id: 'd-thin', name: 'Wyse-Kolonie', sub: 'Thin-Client-Cluster · 4× Dell Wyse 5070', node: null, color: '#2effc8', c0: colony.c0, r0: colR0, cols: colCols, rows: colRows });
    for (let i = 0; i < colCols * colRows; i++) {
      const cc = colony.c0 + (i % colCols), rr = colR0 + Math.floor(i / colCols);
      const id = thinItems[i];
      if (id) {
        const n = model.get(id);
        this.addLot({ id: 'lot:' + id, node: id, district: 'd-thin', kind: n.t === 'pve' ? 'outpost' : 'guest', c: cc, r: rr, w: 1, h: 1 });
      } else {
        this.addLot({ id: `lot:decor:${cc}:${rr}`, node: null, district: 'd-thin', kind: 'decor', c: cc, r: rr, w: 1, h: 1, decor: 'baugrund' });
      }
    }
    bandRows[bandRows.length - 1] += colRows;
    const bandA = Math.max(...bandRows);
    // Corp-Viertel, die kürzer als das Band sind, bekommen hinten einen Park
    corpIds.forEach(id => {
      const s = corpSizes[id];
      const used = id === lastCorp ? s.rows + colRows : s.rows;
      for (let r = used; r < bandA; r++) {
        for (let cc = s.c0; cc < s.c0 + s.cols; cc++) {
          this.addLot({ id: `lot:decor:${cc}:${r}`, node: null, district: 'd-' + id, kind: 'decor', c: cc, r, w: 1, h: 1, decor: 'park' });
        }
      }
    });

    /* ---------- Band B: Heimnetz · Plaza · Tor ---------- */
    const clients = model.nodes.filter(n => n.t === 'client');
    const importance = ['c206', 'c218', 'c204', 'c222', 'c119', 'c152', 'c229', 'c171', 'c217', 'c208', 'c225', 'c-misc'];
    clients.sort((a, b) => {
      const ia = importance.indexOf(a.id), ib = importance.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const firstCorp = corpSizes[corpIds[0]];
    const hCols = firstCorp.cols;
    const hRows = Math.max(1, Math.ceil(clients.length / hCols));
    const r0B = bandA;
    this.districts.push({ id: 'd-lan', name: 'Heimnetz', sub: '192.168.2.0/24 · flach, kein VLAN', node: 'g-lan', color: '#ffb000', c0: firstCorp.c0, r0: r0B, cols: hCols, rows: hRows });
    // vorne (Süden, zur Kamera) die wichtigsten Geräte
    let k = 0;
    for (let rr = r0B + hRows - 1; rr >= r0B; rr--) {
      for (let cc = firstCorp.c0; cc < firstCorp.c0 + hCols; cc++) {
        const n = clients[k++];
        if (n) this.addLot({ id: 'lot:' + n.id, node: n.id, district: 'd-lan', kind: 'client', c: cc, r: rr, w: 1, h: 1 });
        else this.addLot({ id: `lot:decor:${cc}:${rr}`, node: null, district: 'd-lan', kind: 'decor', c: cc, r: rr, w: 1, h: 1, decor: 'park' });
      }
    }

    // Plaza (MainCluster) mittig unter dem Hauptviertel (Proxmox)
    const main = corpSizes['pve-node1'] || corpSizes[corpIds[Math.floor(corpIds.length / 2)]];
    const plazaC = main.c0 + Math.floor((main.cols - 2) / 2);
    this.districts.push({ id: 'd-plaza', name: 'MainCluster-Plaza', sub: 'Corosync · Quorum', node: 'cluster', color: '#00f5d4', c0: main.c0, r0: r0B, cols: main.cols, rows: 2 });
    this.addLot({ id: 'lot:cluster', node: 'cluster', district: 'd-plaza', kind: 'plaza', c: plazaC, r: r0B, w: 2, h: 2 });
    for (let cc = main.c0; cc < main.c0 + main.cols; cc++) {
      if (cc >= plazaC && cc <= plazaC + 1) continue;
      for (let rr = r0B; rr < r0B + 2; rr++) {
        // links der Plaza ein Nachtmarkt, rechts ein Neon-Garten
        this.addLot({ id: `lot:decor:${cc}:${rr}`, node: null, district: 'd-plaza', kind: 'decor', c: cc, r: rr, w: 1, h: 1, decor: cc < plazaC ? 'market' : 'garden' });
      }
    }
    // Speedport-Tor direkt unter der Plaza: links das Router-Gebäude, rechts der
    // Zollhof; die Torstraße dazwischen ist die einzige Verbindung zur Brücke.
    const gateR = r0B + 2;
    this.addLot({ id: 'lot:speedport', node: 'speedport', district: 'd-plaza', kind: 'gate', c: plazaC, r: gateR, w: 1, h: 1, door: 'e' });
    this.addLot({ id: `lot:decor:${plazaC + 1}:${gateR}`, node: null, district: 'd-plaza', kind: 'decor', c: plazaC + 1, r: gateR, w: 1, h: 1, decor: 'zoll' });
    const cityRows = Math.max(r0B + hRows, gateR + 1);
    this.cityCols = cityCols;
    this.cityRows = cityRows;

    /* ---------- Insel „Außenwelt" ---------- */
    const bridgeI = plazaC + 1;                 // Straßenlinie unter der Tormitte
    const islandR = cityRows + 3;               // drei Reihen Wasser
    const ic0 = bridgeI - 4;                    // Inselraster: 8 Spalten
    this.roadBridge = { i: bridgeI, j0: cityRows, j1: islandR };
    this.railBridge = { i: bridgeI + 1, j0: cityRows, j1: islandR };
    this.districts.push({ id: 'd-out', name: 'Außenwelt', sub: 'Internet & Cloud-Dienste', node: 'g-cloud', color: '#b46bff', c0: ic0, r0: islandR, cols: 8, rows: 2, island: true });
    const cloudCells: Array<[string, number, number]> = [
      ['resend', 0, 0], ['strato', 1, 0], ['google', 2, 0],
      ['paypal', 0, 1], ['webpush', 1, 1], ['ddns', 2, 1],
      ['le', 3, 1], ['ngrok', 4, 1],
      ['claude', 5, 0], ['discord', 6, 0]
    ];
    const placedCloud = new Set<string>();
    cloudCells.forEach(([id, dc, dr]) => {
      if (!model.has(id)) return;
      placedCloud.add(id);
      this.addLot({ id: 'lot:' + id, node: id, district: 'd-out', kind: 'cloud', c: ic0 + dc, r: islandR + dr, w: 1, h: 1 });
    });
    this.addLot({ id: 'lot:inet', node: 'inet', district: 'd-out', kind: 'bridgehead', c: ic0 + 3, r: islandR, w: 2, h: 1, door: 'n' });
    this.addLot({ id: 'lot:ts-cloud', node: 'ts-cloud', district: 'd-out', kind: 'terminal', c: ic0 + 5, r: islandR + 1, w: 2, h: 1, door: 'n' });
    // weitere Cloud-Dienste (künftig) bekommen freie Inselzellen, sonst Deko
    const extraCloud = model.nodes.filter(n => n.t === 'cloud' && !placedCloud.has(n.id) && !['inet', 'ts-cloud'].includes(n.id));
    const freeIsland: Array<[number, number]> = [[7, 0], [7, 1]];
    for (let extra = 0; extra < extraCloud.length; extra++) freeIsland.push([8 + Math.floor(extra / 2), extra % 2]);
    freeIsland.forEach(([dc, dr], i) => {
      const n = extraCloud[i];
      if (n) this.addLot({ id: 'lot:' + n.id, node: n.id, district: 'd-out', kind: 'cloud', c: ic0 + dc, r: islandR + dr, w: 1, h: 1 });
      else if (dc === 7) this.addLot({ id: `lot:decor:${ic0 + dc}:${islandR + dr}`, node: null, district: 'd-out', kind: 'decor', c: ic0 + dc, r: islandR + dr, w: 1, h: 1, decor: 'dock' });
    });

    /* ---------- Straßennetz ---------- */
    this.buildGraph();

    /* ---------- Plätze der Knoten ---------- */
    this.lots.forEach(l => {
      if (!l.node) return;
      this.places.set(l.node, {
        node: l.node, lot: l, x: l.cx, z: l.cz, door: l.door, entrance: this.entranceOf(l, l.door.x), anchored: false
      });
    });
    // Anker ohne eigenes Grundstück
    const head = this.lots.find(l => l.node === 'inet')!;
    const term = this.lots.find(l => l.node === 'ts-cloud')!;
    const anchorAt = (id: string, lot: Lot, fx: number, fz: number) => {
      if (!model.has(id)) return;
      const x = lot.x0 + (lot.x1 - lot.x0) * fx;
      const z = lot.z0 + (lot.z1 - lot.z0) * fz;
      this.places.set(id, { node: id, lot, x, z, door: lot.door, entrance: this.entranceOf(lot, x), anchored: true });
    };
    // Wegweiser der Domains an der Brückenauffahrt, Ankunftspunkte auf dem Brückenkopf
    anchorAt('dom-x3d', head, 0.08, 0.2);
    anchorAt('dom-pve', head, 0.92, 0.2);
    anchorAt('dom-mail', head, 0.92, 0.72);
    anchorAt('customers', head, 0.2, 0.62);
    anchorAt('players', head, 0.36, 0.84);
    anchorAt('fogapp', head, 0.64, 0.84);
    // Kapseln der Tailnet-Geräte im Terminal
    anchorAt('laptop', term, 0.18, 0.62);
    anchorAt('honor', term, 0.38, 0.62);
    anchorAt('desk-ts', term, 0.58, 0.62);
    anchorAt('ts-off', term, 0.82, 0.62);
    // Funnel: Portal über der Hochbahn am Inselende der Bahnbrücke
    if (model.has('ts-funnel')) {
      const n = this.nodes.get(key(this.railBridge.i, this.railBridge.j1))!;
      const lot = this.lots.find(l => l.node === 'claude') || term;
      const door: Door = { x: n.x, z: n.z, side: 'n', a: n, b: n };
      this.places.set('ts-funnel', { node: 'ts-funnel', lot, x: n.x, z: n.z, door, entrance: { x: n.x, z: n.z }, anchored: true });
    }
    // Knoten ohne Platz (neu in den Daten) → wenigstens melden
    model.nodes.forEach(n => {
      if (n.t === 'group' || n.t === 'svc') return;
      if (!this.places.has(n.id)) console.warn('[Stadtplan] Kein Platz für', n.id, n.t);
    });

    // Grenzen
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    let ix0 = Infinity, iz0 = Infinity, ix1 = -Infinity, iz1 = -Infinity;
    this.cells.forEach((lot, ck) => {
      const [cc, rr] = ck.split('|').map(Number);
      const island = this.districts.find(d => d.id === lot.district)?.island;
      if (island) {
        ix0 = Math.min(ix0, cc * P); iz0 = Math.min(iz0, rr * P); ix1 = Math.max(ix1, (cc + 1) * P); iz1 = Math.max(iz1, (rr + 1) * P);
      } else {
        x0 = Math.min(x0, cc * P); z0 = Math.min(z0, rr * P); x1 = Math.max(x1, (cc + 1) * P); z1 = Math.max(z1, (rr + 1) * P);
      }
    });
    this.bounds = { x0, z0, x1, z1 };
    this.islandBounds = { x0: ix0, z0: iz0, x1: ix1, z1: iz1 };
  }

  private entranceOf(l: Lot, x: number): V2 {
    const d = l.door;
    switch (d.side) {
      case 's': return { x, z: l.z1 };
      case 'n': return { x, z: l.z0 };
      case 'e': return { x: l.x1, z: d.z };
      default: return { x: l.x0, z: d.z };
    }
  }

  /* ------------------------------------------------------------------ */
  private buildGraph() {
    const lotAt = (c: number, r: number) => this.cells.get(cellKey(c, r));
    const node = (i: number, j: number): GNode => {
      const k = key(i, j);
      let n = this.nodes.get(k);
      if (!n) {
        n = { key: k, i, j, x: i * P, z: j * P, adj: [] };
        this.nodes.set(k, n);
      }
      return n;
    };
    const link = (a: GNode, b: GNode, bridge: GEdge['bridge'] = '') => {
      const k = a.key < b.key ? `${a.key}~${b.key}` : `${b.key}~${a.key}`;
      if (this.edges.has(k)) return;
      const len = Math.hypot(a.x - b.x, a.z - b.z);
      const onAvenue = (a.i === b.i && this.avenueX.has(a.i)) || (a.j === b.j && this.avenueZ.has(a.j));
      const e: GEdge = {
        key: k, a, b, len,
        weight: bridge ? 1 : onAvenue ? 0.8 : 1,
        bridge,
        modes: bridge === 'road' ? ['road'] : bridge === 'rail' ? ['rail'] : ['road', 'rail']
      };
      this.edges.set(k, e);
      a.adj.push(e);
      b.adj.push(e);
    };
    // Hauptachsen: Nord-Süd links und rechts der Plaza, Ost-West zwischen den Bändern
    this.avenueX.add(this.roadBridge.i - 1);
    this.avenueX.add(this.roadBridge.i + 1);
    this.avenueZ.add(this.districts.find(d => d.id === 'd-lan')!.r0);

    let maxC = 0, maxR = 0;
    this.cells.forEach((_l, ck) => {
      const [cc, rr] = ck.split('|').map(Number);
      maxC = Math.max(maxC, cc + 1);
      maxR = Math.max(maxR, rr + 1);
    });
    // horizontale Segmente (i,j)-(i+1,j): Zelle darüber (i, j-1) oder darunter (i, j)
    for (let j = 0; j <= maxR; j++) {
      for (let i = 0; i < maxC; i++) {
        const up = lotAt(i, j - 1), dn = lotAt(i, j);
        if (!up && !dn) continue;
        if (up && dn && up === dn) continue; // innen in einem zusammengelegten Grundstück
        link(node(i, j), node(i + 1, j));
      }
    }
    // vertikale Segmente (i,j)-(i,j+1): Zelle links (i-1, j) oder rechts (i, j)
    for (let i = 0; i <= maxC; i++) {
      for (let j = 0; j < maxR; j++) {
        const lf = lotAt(i - 1, j), rt = lotAt(i, j);
        if (!lf && !rt) continue;
        if (lf && rt && lf === rt) continue;
        link(node(i, j), node(i, j + 1));
      }
    }
    // Brücken
    const rb = this.roadBridge, tb = this.railBridge;
    link(node(rb.i, rb.j0), node(rb.i, rb.j1), 'road');
    link(node(tb.i, tb.j0), node(tb.i, tb.j1), 'rail');
    // isolierte Knoten entfernen
    this.nodes.forEach((n, k) => { if (!n.adj.length) this.nodes.delete(k); });

    // Türen an die Straßen hängen
    this.lots.forEach(l => {
      const d = l.door;
      let x: number, z: number, a: GNode | undefined, b: GNode | undefined;
      const midI = l.c + l.w / 2, midJ = l.r + l.h / 2;
      if (d.side === 's' || d.side === 'n') {
        const j = d.side === 's' ? l.r + l.h : l.r;
        x = midI * P; z = j * P;
        if (Number.isInteger(midI)) { a = b = this.nodes.get(key(midI, j)); }
        else { a = this.nodes.get(key(Math.floor(midI), j)); b = this.nodes.get(key(Math.ceil(midI), j)); }
      } else {
        const i = d.side === 'e' ? l.c + l.w : l.c;
        x = i * P; z = midJ * P;
        if (Number.isInteger(midJ)) { a = b = this.nodes.get(key(i, midJ)); }
        else { a = this.nodes.get(key(i, Math.floor(midJ))); b = this.nodes.get(key(i, Math.ceil(midJ))); }
      }
      if (!a || !b) throw new Error('Tür ohne Straße: ' + l.id);
      d.x = x; d.z = z; d.a = a; d.b = b;
    });
  }

  /* ------------------------------------------------------------------ */
  place(id: string): Place | undefined {
    return this.places.get(id);
  }

  districtOf(lot: Lot): District | undefined {
    return this.districts.find(d => d.id === lot.district);
  }

  nodeAt(i: number, j: number): GNode | undefined {
    return this.nodes.get(key(i, j));
  }

  /** Welt-Mittelpunkt der Stadt (ohne Insel) */
  get center(): V2 {
    return { x: (this.bounds.x0 + this.bounds.x1) / 2, z: (this.bounds.z0 + this.bounds.z1) / 2 };
  }
}

export const plan = new CityPlan();
