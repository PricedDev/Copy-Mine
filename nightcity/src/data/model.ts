import { NODES, EDGES, FINDINGS, IPS, TSNET, LIVE } from 'virtual:homelab-data';
import type {
  RawNode, RawFinding, EdgeKind, NodeType, Status, LiveGuest, LiveNode, IpRow, TsRow, RawLive
} from './types';

/*
 * Das Stadt-Modell: dieselben Knoten, Kanten und Befunde wie im Netzatlas,
 * plus die dort in app.js hergeleiteten Regeln (Kanten „unterbrochen", need-
 * Ketten, Ausfall-Analyse). Die importierten Arrays werden nicht verändert.
 */

export interface CNode extends RawNode {
  kids: string[];
}

export interface CEdge {
  id: string;
  idx: number;
  s: string;
  t: string;
  k: EdgeKind;
  d: string;
  /** harte Abhängigkeit: fällt t aus, fällt s mit */
  h: boolean;
  /** unbestätigt */
  u: boolean;
  /** unterbrochen: Ziel gestoppt/defekt oder ausdrücklich markiert */
  b: boolean;
}

export interface Resources {
  cpu: number;      // vCPU / Kerne / Threads
  ram: number;      // GB (zugesagt bzw. verbaut)
  disk: number;     // GB (0 = unbekannt)
  known: boolean;   // stammt aus den Daten (nicht geschätzt)
}

export type ImpactWhy = 'fail' | 'parent' | 'edge' | 'need';

export interface ImpactStep {
  id: string;
  wave: number;
  why: ImpactWhy;
  /** Auslöser: Elternknoten, Kantenziel oder need-Ziel */
  by: string | null;
  edge: CEdge | null;
}

export interface ImpactResult {
  down: Set<string>;
  deg: Set<string>;
  steps: ImpactStep[];
  /** Kanten, über die ein nicht ausgefallener Knoten nur noch eingeschränkt arbeitet */
  degEdges: CEdge[];
}

export const LAYERS: Record<EdgeKind, { name: string; long: string }> = {
  flow: { name: 'Daten & API', long: 'Anwendungsdaten und API-Aufrufe' },
  ingress: { name: 'Öffentlich', long: 'Zugriffe aus dem Internet' },
  proxy: { name: 'Proxy', long: 'Reverse-Proxys und Weiterleitungen' },
  alert: { name: 'Alarm', long: 'Alarmierung' },
  storage: { name: 'Speicher', long: 'Datenablage und Sicherungen' },
  vpn: { name: 'Tailscale', long: 'Tailnet – Overlay-Netz' },
  cluster: { name: 'Quorum', long: 'Corosync-Stimmen im MainCluster' },
  mon: { name: 'Monitoring', long: 'CheckMK-Überwachung' },
  ssh: { name: 'Admin/SSH', long: 'Administrativer Zugriff' },
  lan: { name: 'LAN', long: 'Physische Verkabelung / WLAN' }
};

export const TYPES: Record<NodeType, string> = {
  pve: 'Proxmox-Node', vm: 'VM', ct: 'LXC-Container', svc: 'Software / Dienst', cloud: 'Cloud-Dienst',
  domain: 'Domain / Endpunkt', router: 'Router', virtual: 'Cluster', client: 'Heimnetz-Gerät',
  remote: 'Tailnet / extern', group: 'Bereich'
};

export const STATUS: Record<Status, string> = {
  ok: 'läuft', warn: 'auffällig', crit: 'defekt', stopped: 'gestoppt / offline', unknown: 'unklar'
};

export const SEV = { crit: 'Kritisch', warn: 'Warnung', info: 'Hinweis', good: 'Verbessert' } as const;

/** Ausfall-Szenarien wie im Netzatlas */
export const SCENARIOS: Array<[string, string[]]> = [
  ['Node „Proxmox" (inkl. Disk-Ausfall im Pool)', ['pve-node1']],
  ['AI-Node', ['pve-ai']],
  ['Print-Node', ['pve-print']],
  ['Mail-VM', ['g104']],
  ['Automatisierungs-Hub (VM)', ['g301']],
  ['CheckMK', ['g106']],
  ['Speedport', ['speedport']],
  ['Internet', ['inet']]
];

function parseNum(s: string): number {
  return Number(s.replace(',', '.'));
}

export function parseRes(n: RawNode): Resources {
  const res = n.res || '';
  const cpuM = res.match(/(\d+)\s*(?:vCPU|Kerne?|Threads)/);
  const memM = res.match(/(\d+(?:,\d+)?)\s*(GB|MB)/);
  const all = Array.from(res.matchAll(/(\d+(?:,\d+)?)\s*GB/g));
  const ram = memM ? parseNum(memM[1]) / (memM[2] === 'MB' ? 1024 : 1) : 0;
  const disk = all.length > 1 ? parseNum(all[1][1]) : 0;
  return {
    cpu: cpuM ? Number(cpuM[1]) : 0,
    ram,
    disk,
    known: !!(cpuM || memM)
  };
}

export class Model {
  readonly nodes: CNode[];
  readonly edges: CEdge[];
  readonly findings: RawFinding[];
  readonly ips: IpRow[];
  readonly tsnet: TsRow[];
  readonly live: RawLive;
  private readonly map = new Map<string, CNode>();
  private readonly out = new Map<string, CEdge[]>();
  private readonly inc = new Map<string, CEdge[]>();

  constructor() {
    this.nodes = NODES.map(n => ({ ...n, facts: n.facts ? [...n.facts] : undefined, need: n.need ? [...n.need] : undefined, kids: [] }));
    this.nodes.forEach(n => this.map.set(n.id, n));
    this.nodes.forEach(n => {
      if (n.parent) {
        const p = this.map.get(n.parent);
        if (p) p.kids.push(n.id);
        else console.warn('[Modell] Elternknoten fehlt', n.id, n.parent);
      }
    });
    // Regel aus app.js: Cloud-Dienste und Domains brauchen das Internet
    this.nodes.forEach(n => {
      if ((n.t === 'cloud' || n.t === 'domain') && n.id !== 'inet') {
        n.need = Array.from(new Set(['inet'].concat(n.need || [])));
      }
    });
    this.edges = EDGES.map((e, i) => {
      const tn = this.map.get(e.t);
      const broken = !!e.b || !!(tn && (tn.st === 'stopped' || tn.st === 'crit'));
      if (!this.map.has(e.s) || !this.map.has(e.t)) console.warn('[Modell] Kante ohne Knoten', e);
      return { id: 'e' + i, idx: i, s: e.s, t: e.t, k: e.k, d: e.d, h: !!e.h, u: !!e.u, b: broken };
    });
    this.edges.forEach(e => {
      (this.out.get(e.s) || this.out.set(e.s, []).get(e.s)!).push(e);
      (this.inc.get(e.t) || this.inc.set(e.t, []).get(e.t)!).push(e);
    });
    this.findings = FINDINGS.map(f => ({ ...f, n: [...f.n] }));
    this.ips = IPS.map(r => [...r] as IpRow);
    this.tsnet = TSNET.map(r => [...r] as TsRow);
    this.live = LIVE;
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  get(id: string): CNode {
    const n = this.map.get(id);
    if (!n) throw new Error('Unbekannter Knoten: ' + id);
    return n;
  }

  find(id: string): CNode | undefined {
    return this.map.get(id);
  }

  ancestors(id: string): string[] {
    const a: string[] = [];
    let p = this.map.get(id)?.parent ?? null;
    while (p) {
      a.push(p);
      p = this.map.get(p)?.parent ?? null;
    }
    return a;
  }

  descendants(id: string): string[] {
    const out: string[] = [];
    const walk = (x: string) => this.get(x).kids.forEach(k => { out.push(k); walk(k); });
    walk(id);
    return out;
  }

  /** Das Bauwerk, in dem ein Knoten sichtbar wird (Dienst → sein Gast/Node). */
  structureOf(id: string): string | null {
    const n = this.map.get(id);
    if (!n || n.t === 'group') return null;
    if (n.t === 'svc') return n.parent;
    return n.id;
  }

  outEdges(id: string): CEdge[] {
    return this.out.get(id) || [];
  }

  inEdges(id: string): CEdge[] {
    return this.inc.get(id) || [];
  }

  /** Alle Kanten eines Bauwerks inkl. seiner Dienste. */
  edgesOfStructure(id: string): CEdge[] {
    const ids = new Set([id, ...this.descendants(id)]);
    return this.edges.filter(e => ids.has(e.s) || ids.has(e.t));
  }

  findingsOf(id: string): RawFinding[] {
    const ids = new Set([id, ...this.descendants(id)]);
    return this.findings.filter(f => f.n.some(x => ids.has(x)));
  }

  /** Corosync-Stimmen je Node – aus der Kantenbeschreibung, damit es nur eine Quelle gibt. */
  votes(pveId: string): number {
    const e = this.outEdges(pveId).find(x => x.k === 'cluster' && x.t === 'cluster');
    const m = e?.d.match(/(\d+)\s*Stimme/);
    return m ? Number(m[1]) : 0;
  }

  guestLive(id: string): LiveGuest | null {
    const n = this.map.get(id);
    if (!n || n.vmid == null) return null;
    return this.live.guest[String(n.vmid)] || null;
  }

  nodeLive(id: string): LiveNode | null {
    return this.live.node[id] || null;
  }

  /** RAM, den laufende Gäste eines Nodes zusammen zugesagt haben (wie im Netzatlas). */
  alloc(nodeId: string): { sum: number; pct: number } | null {
    const L = this.nodeLive(nodeId);
    if (!L) return null;
    let sum = 0;
    this.get(nodeId).kids.forEach(k => {
      const g = this.guestLive(k);
      if (g && this.get(k).st !== 'stopped') sum += g[2];
    });
    return { sum, pct: (sum / L.memMax) * 100 };
  }

  /** Ressourcen eines Gastes: Live-RAM-Grenze schlägt den Text. */
  resources(id: string): Resources {
    const n = this.get(id);
    const r = parseRes(n);
    const g = this.guestLive(id);
    if (g && g[2] > 0) r.ram = g[2];
    const L = this.nodeLive(id);
    if (L) {
      r.cpu = L.thr;
      r.ram = L.memMax;
      r.known = true;
    }
    return r;
  }

  /**
   * Ausfall-Analyse – derselbe Algorithmus wie im Netzatlas, zusätzlich mit
   * Begründung und Welle je Knoten, damit die Kaskade Schritt für Schritt
   * nachvollziehbar abgespielt werden kann.
   */
  impact(fails: string[]): ImpactResult {
    const down = new Set<string>();
    const steps: ImpactStep[] = [];
    const add = (id: string, wave: number, why: ImpactWhy, by: string | null, edge: CEdge | null): boolean => {
      if (down.has(id)) return false;
      down.add(id);
      steps.push({ id, wave, why, by, edge });
      const walk = (x: string, depth: number) => {
        this.get(x).kids.forEach(k => {
          if (!down.has(k)) {
            down.add(k);
            steps.push({ id: k, wave: wave + depth * 0.35, why: 'parent', by: x, edge: null });
          }
          walk(k, depth + 1);
        });
      };
      walk(id, 1);
      return true;
    };
    fails.forEach(f => add(f, 0, 'fail', null, null));
    let changed = true;
    let wave = 0;
    while (changed) {
      changed = false;
      wave += 1;
      const snapshot = new Set(down);
      for (const e of this.edges) {
        if (e.h && snapshot.has(e.t) && !down.has(e.s)) {
          changed = add(e.s, wave, 'edge', e.t, e) || changed;
        }
      }
      for (const n of this.nodes) {
        if (n.need && !down.has(n.id)) {
          const hit = n.need.find(x => snapshot.has(x));
          if (hit) changed = add(n.id, wave, 'need', hit, null) || changed;
        }
      }
    }
    const deg = new Set<string>();
    const degEdges: CEdge[] = [];
    for (const e of this.edges) {
      if (!e.h && down.has(e.t) && !down.has(e.s)) {
        deg.add(e.s);
        degEdges.push(e);
      }
    }
    steps.sort((a, b) => a.wave - b.wave);
    return { down, deg, steps, degEdges };
  }
}

export const model = new Model();
