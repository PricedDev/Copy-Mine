declare module 'virtual:homelab-data' {
  import type { RawNode, RawEdge, RawFinding, RawLive, IpRow, TsRow } from './types';
  export const NODES: RawNode[];
  export const EDGES: RawEdge[];
  export const FINDINGS: RawFinding[];
  export const IPS: IpRow[];
  export const TSNET: TsRow[];
  export const LIVE: RawLive;
}
