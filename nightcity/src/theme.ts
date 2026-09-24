import type { EdgeKind, Status, Severity } from './data/types';

/*
 * Farbwelt: Night-City-Neon. Die Kantenfarben behalten die Farbtöne des
 * Netzatlas (gleiche Legende in beiden Ansichten), nur gesättigter.
 */

export const KIND_COLOR: Record<EdgeKind, string> = {
  flow: '#2ec5ff',
  ingress: '#ff8a2a',
  proxy: '#b46bff',
  alert: '#ff2a6d',
  storage: '#ffc83d',
  vpn: '#6f7dff',
  cluster: '#00f5d4',
  mon: '#7dff5a',
  ssh: '#c3ccd6',
  lan: '#8fd8ff'
};

/** Reihenfolge der Datenspuren von der Straßenmitte nach außen */
export const LANE_ORDER: EdgeKind[] = ['lan', 'ingress', 'proxy', 'flow', 'storage', 'alert', 'mon', 'ssh', 'vpn', 'cluster'];

export const STATUS_COLOR: Record<Status, string> = {
  ok: '#2effc8',
  warn: '#ffb000',
  crit: '#ff2a3a',
  stopped: '#5b6674',
  unknown: '#d05bff'
};

export const SEV_COLOR: Record<Severity, string> = {
  crit: '#ff2a3a',
  warn: '#ffb000',
  info: '#2ec5ff',
  good: '#2effc8'
};

export const UI = {
  yellow: '#fcee0a',
  red: '#ff003c',
  cyan: '#00f0ff',
  magenta: '#ff2a6d',
  bg: '#05060d'
};

/** Stilwelt je Proxmox-Node (Corpo-Anleihen, eigene Namen) */
export interface CorpStyle {
  name: string;        // große Leuchtschrift am Turm
  motto: string;       // Unterzeile
  district: string;    // Viertelname
  primary: string;     // Hauptneon
  secondary: string;   // Zweitneon
  facade: string;      // Fassadengrundton
  archetype: 'spire' | 'fortress' | 'foundry' | 'outpost';
}

export const CORP: Record<string, CorpStyle> = {
  'pve-node1': { name: 'PROXMOX', motto: 'Hauptknoten', district: 'Downtown', primary: '#ff3b30', secondary: '#ff9f1c', facade: '#161a24', archetype: 'spire' },
  'pve-ai': { name: 'AI', motto: 'Neural Heights · CPU-Inferenz', district: 'Neural Heights', primary: '#00e5ff', secondary: '#7a5cff', facade: '#121a22', archetype: 'fortress' },
  'pve-print': { name: 'PRINT', motto: 'PrintWorks · Foundry', district: 'Foundry', primary: '#fcee0a', secondary: '#ff2a6d', facade: '#1b1a1f', archetype: 'foundry' },
  'pve-thin1': { name: 'THIN1', motto: 'Wyse-Außenposten', district: 'Wyse-Kolonie', primary: '#2effc8', secondary: '#6f7dff', facade: '#141b1f', archetype: 'outpost' },
  'pve-thin2': { name: 'THIN2', motto: 'Wyse-Außenposten', district: 'Wyse-Kolonie', primary: '#2effc8', secondary: '#6f7dff', facade: '#141b1f', archetype: 'outpost' },
  'pve-thin3': { name: 'THIN3', motto: 'Wyse-Außenposten', district: 'Wyse-Kolonie', primary: '#2effc8', secondary: '#6f7dff', facade: '#141b1f', archetype: 'outpost' },
  'pve-thin4': { name: 'THIN4', motto: 'Wyse-Außenposten', district: 'Wyse-Kolonie', primary: '#2effc8', secondary: '#6f7dff', facade: '#141b1f', archetype: 'outpost' }
};
