/* Typen des Netzatlas-Datenmodells (data.js) – unverändert übernommen. */

export type NodeType =
  | 'group' | 'cloud' | 'domain' | 'router' | 'virtual' | 'client' | 'remote'
  | 'pve' | 'svc' | 'vm' | 'ct';

export type Status = 'ok' | 'warn' | 'crit' | 'stopped' | 'unknown';

export type EdgeKind =
  | 'lan' | 'ingress' | 'vpn' | 'proxy' | 'flow' | 'storage' | 'alert' | 'cluster' | 'mon' | 'ssh';

export type Severity = 'crit' | 'warn' | 'info' | 'good';

export interface RawNode {
  id: string;
  t: NodeType;
  parent: string | null;
  label: string;
  sub: string;
  st: Status;
  ip?: string;
  mac?: string;
  res?: string;
  tags?: string;
  seen?: string;
  facts?: string[];
  need?: string[];
  vmid?: number;
  ports?: string;
  wrap?: number;
}

export interface RawEdge {
  s: string;
  t: string;
  k: EdgeKind;
  d: string;
  h: number;
  u?: number;
  b?: number;
}

export interface RawFinding {
  sev: Severity;
  t: string;
  n: string[];
  p: string;
  fx?: string;
}

export interface LiveNode {
  cpu: number;
  thr: number;
  mem: number;
  memMax: number;
  up: number;
  pool: [number, number] | null;
  root: [number, number];
}

/** vmid → [CPU %, RAM genutzt GB, RAM max GB, Uptime Tage] */
export type LiveGuest = [number, number, number, number];

export interface RawLive {
  at: string;
  node: Record<string, LiveNode>;
  guest: Record<string, LiveGuest>;
}

/** [Oktett, Name, Art, Node, MAC, Status, Hinweis, Knoten-ID, Konflikt?] */
export type IpRow = [string, string, string, string, string, string, string, string, number?];
/** [Name, Tailnet-IP, Status, Knoten-ID] */
export type TsRow = [string, string, string, string];
