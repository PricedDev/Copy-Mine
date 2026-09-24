import { model } from '../data/model';

/*
 * Die Agents und Workflows des Homelabs als NPCs. Jeder Schritt geht über eine
 * echte Kante aus data.js (in Pfeilrichtung = Anfrage, dagegen = Antwort) –
 * das prüft validateAgents() beim Start. Dies ist ein kleines Beispiel-Roster
 * passend zu den Beispieldaten in ../../netzatlas/data.js – ersetze es durch
 * deine eigenen Agents/Workflows, sobald du deine eigene data.js hast (siehe
 * README, Abschnitt "Einen Agent ergänzen").
 */

export type NpcModel = 'bot' | 'drone' | 'av' | 'courier' | 'spider' | 'human' | 'pod';

export interface Step {
  /** Zielknoten (Dienst oder Bauwerk); der Weg ist die Kante zum aktuellen Knoten */
  to: string;
  /** Sprechblase + Protokollzeile beim Losgehen */
  say: string;
  /** Zeile bei Ankunft (optional) */
  done?: string;
  /** Arbeitszeit am Ziel in Sekunden */
  work?: number;
  /** genaue Kante [s, t], falls zwischen beiden Knoten mehrere Kanten bestehen */
  via?: [string, string];
}

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  model: NpcModel;
  color: string;
  home: string;
  schedule: string;
  pause: [number, number];
  facts: string[];
  steps: Step[];
  count?: number;
}

export const AGENTS: AgentDef[] = [
  {
    id: 'automation', name: 'Automatisierungs-Hub', role: 'Persönlicher Assistent / Wissensbasis (VM)',
    model: 'bot', color: '#ffb36b', home: 'g301', schedule: 'auf Zuruf und stündlich', pause: [8, 16],
    facts: ['Docker-Compose-Stack mit mehreren Diensten', 'Sichert seine Daten regelmäßig auf die NAS-VM'],
    steps: [
      { to: 'svc-ollama', say: 'Fragt das lokale Sprachmodell', done: 'Antwort erhalten', work: 2 },
      { to: 'g301', say: 'Antwort verarbeitet' },
      { to: 'vm-nas', say: 'Sichert Wissensdaten', done: 'Backup abgelegt', work: 1.5 },
      { to: 'g301', say: 'zurück' },
      { to: 'cloud-ddns', say: 'Aktualisiert den DynDNS-Eintrag', work: 1 },
      { to: 'g301', say: 'zurück auf Empfang' }
    ]
  },
  {
    id: 'patrol', name: 'CheckMK-Streife', role: 'Monitoring · prüft alle Nodes und wichtigen VMs',
    model: 'drone', color: '#7dff5a', home: 'svc-checkmk', schedule: 'fortlaufend (Check-Intervalle)', pause: [2, 5],
    facts: ['Prüft per Agent oder Ping', 'Mail-VM bleibt bewusst als DOWN gemeldet'],
    steps: [
      { to: 'pve-node1', say: 'Agent-Check „core"', done: 'OK', work: 0.8 },
      { to: 'svc-checkmk', say: 'Ergebnis gespeichert' },
      { to: 'pve-ai', say: 'Agent-Check „ai"', done: 'OK', work: 0.8 },
      { to: 'svc-checkmk', say: 'Ergebnis gespeichert' },
      { to: 'pve-print', say: 'Agent-Check „print"', done: 'OK', work: 0.8 },
      { to: 'svc-checkmk', say: 'Ergebnis gespeichert' },
      { to: 'vm-web', say: 'Agent-Check Webserver-VM', done: 'OK', work: 0.8 },
      { to: 'svc-checkmk', say: 'Ergebnis gespeichert' },
      { to: 'g104', say: 'Ping Mail-VM', done: 'keine Antwort – DOWN (bewusst gestoppt)', work: 1 },
      { to: 'svc-checkmk', say: 'Runde beendet' }
    ]
  },
  {
    id: 'alert', name: 'Alarm-Kette', role: 'Sendet Alarme vom Monitoring an den Automatisierungs-Hub',
    model: 'courier', color: '#ff2a6d', home: 'svc-checkmk', schedule: 'bei echten Alarmen', pause: [20, 40],
    facts: ['Nur Darstellung – im Beispiel ohne echte Alarmquelle'],
    steps: [
      { to: 'g301', say: 'Alarm gemeldet', done: 'Automatisierungs-Hub benachrichtigt', work: 1 },
      { to: 'svc-checkmk', say: 'zurück auf Empfang' }
    ]
  },
  {
    id: 'admin', name: 'Admin (SSH)', role: 'Administrativer Fernzugriff über das VPN',
    model: 'pod', color: '#6f7dff', home: 'remote-admin', schedule: 'gelegentlich', pause: [16, 30],
    facts: ['Erreicht die Proxmox-Nodes über den VPN-Zugang'],
    steps: [
      { to: 'pve-node1', say: 'SSH-Zugriff', done: 'Wartung erledigt', work: 2 },
      { to: 'remote-admin', say: 'zurück' },
      { to: 'pve-ai', say: 'SSH-Zugriff', done: 'Wartung erledigt', work: 2 },
      { to: 'remote-admin', say: 'zurück' },
      { to: 'pve-print', say: 'SSH-Zugriff', done: 'Wartung erledigt', work: 2 },
      { to: 'remote-admin', say: 'zurück' }
    ]
  },
  {
    id: 'backup', name: 'Datenbank-Backup', role: 'Nächtliches Backup der Datenbank-VM',
    model: 'courier', color: '#2ec5ff', home: 'vm-db', schedule: 'nachts', pause: [30, 60],
    facts: ['Backup landet zuerst auf der zentralen NAS-VM'],
    steps: [
      { to: 'vm-nas', say: 'Backup läuft', done: 'auf der NAS abgelegt', work: 3 },
      { to: 'vm-db', say: 'fertig' }
    ]
  },
  {
    id: 'offsite', name: 'Off-Site-Sicherung', role: 'NAS-VM sichert regelmäßig in die Cloud',
    model: 'courier', color: '#2effc8', home: 'vm-nas', schedule: 'täglich', pause: [40, 70],
    facts: ['Ziel ist ein S3-kompatibler Cloud-Speicher'],
    steps: [
      { to: 'cloud-backup', say: 'Lädt das aktuelle Backup hoch', done: 'übertragen', work: 3 },
      { to: 'vm-nas', say: 'fertig' }
    ]
  },
  {
    id: 'visitor', name: 'Besucher', role: 'Besucher der Web-App (app.example.com)',
    model: 'human', color: '#ff8a2a', home: 'dom-app', schedule: 'laufend', pause: [4, 14], count: 3,
    facts: ['Weg: Domain → Reverse Proxy → App-Backend → Datenbank'],
    steps: [
      { to: 'svc-nginx', say: 'https://app.example.com', work: 0.5 },
      { to: 'svc-app', say: 'Anfrage an das Backend', work: 0.6 },
      { to: 'svc-postgres', say: 'Daten laden', done: 'Seite gerendert', work: 1 },
      { to: 'svc-app', say: 'stöbert …', work: 2 },
      { to: 'svc-nginx', say: 'Antwort' },
      { to: 'dom-app', say: 'Tab zu' }
    ]
  }
];

export interface AgentCheck { ok: boolean; problems: string[]; }

/** jeder Schritt muss eine echte Kante sein; die Runde soll zu Hause enden */
export function validateAgents(edgeBetween: (a: string, b: string) => unknown): AgentCheck {
  const problems: string[] = [];
  AGENTS.forEach(a => {
    if (!model.has(a.home)) problems.push(`${a.name}: Heimatknoten ${a.home} fehlt`);
    let cur = a.home;
    a.steps.forEach((s, i) => {
      if (!model.has(s.to)) problems.push(`${a.name} Schritt ${i + 1}: Knoten ${s.to} fehlt`);
      else if (s.via) {
        const [vs, vt] = s.via;
        const ok = model.edges.some(e => e.s === vs && e.t === vt) && ((vs === cur && vt === s.to) || (vs === s.to && vt === cur));
        if (!ok) problems.push(`${a.name} Schritt ${i + 1}: Kante ${vs} → ${vt} passt nicht zu ${cur} ↔ ${s.to}`);
      } else if (!edgeBetween(cur, s.to)) problems.push(`${a.name} Schritt ${i + 1}: keine Kante ${cur} ↔ ${s.to}`);
      cur = s.to;
    });
    if (cur !== a.home) problems.push(`${a.name}: Runde endet bei ${cur}, nicht zu Hause (${a.home})`);
  });
  return { ok: problems.length === 0, problems };
}
