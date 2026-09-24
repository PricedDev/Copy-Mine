/*
 * BEISPIEL-DATENSATZ – ein frei erfundenes, kleines Homelab.
 *
 * Das ist die EINZIGE Datei, die du normalerweise ersetzt. index.html lädt
 * sie als eigenständiges Skript vor app.js (siehe <script src="data.js">) –
 * Netzatlas bringt sonst keine eigenen Daten mit. Schema: docs/DATA_MODEL.md.
 *
 * WICHTIG: Ein paar IDs sind vom Seitencode (in der IIFE weiter unten in
 * index.html) fest erwartet, weil der Schaltplan sie direkt anspricht:
 *   inet, g-cloud, speedport, cluster, g-lan, g-remote,
 *   pve-node1, pve-ai, pve-print, pve-thin1..pve-thin4
 * Wenn du eigene Daten baust, behalte diese IDs bei (oder passe die
 * entsprechenden Stellen in index.html an – Suche nach den Strings oben).
 * Alle anderen IDs (Gäste, Software, Clients, Cloud-Dienste, IPs, MACs,
 * Namen, Befunde) sind frei erfunden und darfst du beliebig ersetzen.
 */

const NODES = [
  // -- Internet & Cloud ----------------------------------------------------
  { id: 'inet', t: 'cloud', parent: null, label: 'Internet', sub: 'Öffentliches Internet', st: 'ok' },
  { id: 'g-cloud', t: 'group', parent: null, label: 'Internet & Cloud-Dienste', sub: 'außerhalb des Hauses', st: 'ok' },
  { id: 'cloud-backup', t: 'cloud', parent: 'g-cloud', label: 'Cloud-Backup', sub: 'Off-Site-Sicherungsziel (S3-kompatibel)', st: 'ok' },
  { id: 'cloud-ddns', t: 'cloud', parent: 'g-cloud', label: 'Dynamic-DNS-Anbieter', sub: 'Hält den Hostnamen aktuell', st: 'ok' },
  { id: 'dom-app', t: 'domain', parent: 'g-cloud', label: 'app.example.com', sub: 'Öffentlicher Endpunkt der Web-App', st: 'ok' },

  // -- Perimeter -------------------------------------------------------------
  { id: 'speedport', t: 'router', parent: null, label: 'Router / Firewall', sub: 'Internetanschluss, Portfreigaben', st: 'ok', mac: 'aa:bb:cc:00:00:01' },

  // -- Rechenzentrum / Proxmox-Cluster ----------------------------------------
  { id: 'cluster', t: 'virtual', parent: null, label: 'MainCluster', sub: 'Proxmox-Cluster', st: 'ok' },

  { id: 'pve-node1', t: 'pve', parent: null, label: 'Proxmox „core"', sub: 'Hauptknoten', st: 'ok', ip: '192.168.2.11', mac: 'aa:bb:cc:00:01:11', res: '8 Kerne, 32 GB' },
  { id: 'vm-web', t: 'vm', parent: 'pve-node1', label: 'Webserver-VM', sub: 'Reverse Proxy + App', st: 'ok', ip: '192.168.2.21', mac: 'aa:bb:cc:00:02:21', vmid: 101, res: '2 vCPU, 4 GB' },
  { id: 'svc-nginx', t: 'svc', parent: 'vm-web', label: 'nginx', sub: 'Reverse Proxy', st: 'ok' },
  { id: 'svc-app', t: 'svc', parent: 'vm-web', label: 'App-Backend', sub: 'Node.js-Anwendung', st: 'ok' },
  { id: 'vm-db', t: 'vm', parent: 'pve-node1', label: 'Datenbank-VM', sub: 'PostgreSQL', st: 'ok', ip: '192.168.2.22', mac: 'aa:bb:cc:00:02:22', vmid: 102, res: '2 vCPU, 8 GB' },
  { id: 'svc-postgres', t: 'svc', parent: 'vm-db', label: 'PostgreSQL', sub: 'Primäre Datenbank', st: 'ok' },
  { id: 'g301', t: 'vm', parent: 'pve-node1', label: 'Automatisierungs-Hub', sub: 'Persönlicher Assistent / Wissensbasis', st: 'ok', ip: '192.168.2.31', mac: 'aa:bb:cc:00:02:31', vmid: 301, res: '2 vCPU, 4 GB',
    facts: ['Docker-Compose-Stack mit mehreren Diensten', 'Hat SSH-Zugriff auf alle anderen Gäste'] },
  { id: 'g106', t: 'ct', parent: 'pve-node1', label: 'Monitoring-Container', sub: 'CheckMK-Site', st: 'ok', ip: '192.168.2.32', mac: 'aa:bb:cc:00:02:32', vmid: 106, res: '2 vCPU, 4 GB' },
  { id: 'svc-checkmk', t: 'svc', parent: 'g106', label: 'CheckMK', sub: 'Monitoring & Alarmierung', st: 'ok' },

  { id: 'pve-ai', t: 'pve', parent: null, label: 'Proxmox „ai"', sub: 'GPU/CPU-Inferenz', st: 'ok', ip: '192.168.2.12', mac: 'aa:bb:cc:00:01:12', res: '16 Kerne, 64 GB' },
  { id: 'vm-ollama', t: 'vm', parent: 'pve-ai', label: 'LLM-Inferenz-VM', sub: 'Lokale Sprachmodelle', st: 'ok', ip: '192.168.2.41', mac: 'aa:bb:cc:00:02:41', vmid: 201, res: '8 vCPU, 32 GB' },
  { id: 'svc-ollama', t: 'svc', parent: 'vm-ollama', label: 'Ollama', sub: 'LLM-Serving', st: 'ok' },
  { id: 'vm-dash', t: 'vm', parent: 'pve-ai', label: 'Dashboard-VM', sub: 'Metriken & Grafiken', st: 'ok', ip: '192.168.2.42', mac: 'aa:bb:cc:00:02:42', vmid: 202, res: '2 vCPU, 4 GB' },
  { id: 'svc-grafana', t: 'svc', parent: 'vm-dash', label: 'Grafana', sub: 'Dashboards', st: 'ok' },

  { id: 'pve-print', t: 'pve', parent: null, label: 'Proxmox „print"', sub: 'Werkstatt / Nebendienste', st: 'ok', ip: '192.168.2.13', mac: 'aa:bb:cc:00:01:13', res: '4 Kerne, 16 GB' },
  { id: 'ct-dns', t: 'ct', parent: 'pve-print', label: 'DNS-Container', sub: 'Pi-hole', st: 'ok', ip: '192.168.2.51', mac: 'aa:bb:cc:00:02:51', vmid: 401, res: '1 vCPU, 1 GB' },
  { id: 'svc-pihole', t: 'svc', parent: 'ct-dns', label: 'Pi-hole', sub: 'DNS-Filter fürs LAN', st: 'ok' },
  { id: 'vm-nas', t: 'vm', parent: 'pve-print', label: 'Backup/NAS-VM', sub: 'Zentrales Datengrab', st: 'ok', ip: '192.168.2.52', mac: 'aa:bb:cc:00:02:52', vmid: 402, res: '2 vCPU, 8 GB, 4000 GB' },
  { id: 'svc-truenas', t: 'svc', parent: 'vm-nas', label: 'TrueNAS', sub: 'Speicherverwaltung', st: 'ok' },
  { id: 'g104', t: 'vm', parent: 'pve-print', label: 'Mail-VM', sub: 'Mailserver', st: 'stopped', ip: '192.168.2.53', mac: 'aa:bb:cc:00:02:53', vmid: 104, res: '1 vCPU, 2 GB',
    facts: ['Bewusst gestoppt seit dem letzten Anbieterwechsel', 'Soll durch einen externen Mailhoster ersetzt werden'] },
  { id: 'svc-mail', t: 'svc', parent: 'g104', label: 'Postfix', sub: 'Mailserver', st: 'stopped' },
  { id: 'vm-voice', t: 'vm', parent: 'pve-print', label: 'Voice-VM', sub: 'Sprachchat für Freunde', st: 'ok', ip: '192.168.2.54', mac: 'aa:bb:cc:00:02:54', vmid: 403, res: '2 vCPU, 2 GB' },
  { id: 'svc-voice', t: 'svc', parent: 'vm-voice', label: 'TeamSpeak', sub: 'Sprachserver', st: 'ok' },
  { id: 'vm-game', t: 'vm', parent: 'pve-print', label: 'Spiele-VM', sub: 'Dedizierter Spieleserver', st: 'ok', ip: '192.168.2.55', mac: 'aa:bb:cc:00:02:55', vmid: 404, res: '4 vCPU, 8 GB' },
  { id: 'svc-game', t: 'svc', parent: 'vm-game', label: 'Dedicated-Server', sub: 'Koop-Aufbauspiel', st: 'ok' },

  // Thin-Client-Außenposten (vom Seitencode als eigene Spalte erwartet)
  { id: 'pve-thin1', t: 'pve', parent: null, label: 'Thin-Client 1', sub: 'Dell Wyse 5070', st: 'ok', ip: '192.168.2.61', mac: 'aa:bb:cc:00:01:61', res: '4 Kerne, 8 GB' },
  { id: 'pve-thin2', t: 'pve', parent: null, label: 'Thin-Client 2', sub: 'Dell Wyse 5070', st: 'ok', ip: '192.168.2.62', mac: 'aa:bb:cc:00:01:62', res: '4 Kerne, 8 GB' },
  { id: 'pve-thin3', t: 'pve', parent: null, label: 'Thin-Client 3', sub: 'Dell Wyse 5070', st: 'ok', ip: '192.168.2.63', mac: 'aa:bb:cc:00:01:63', res: '4 Kerne, 4 GB' },
  { id: 'pve-thin4', t: 'pve', parent: null, label: 'Thin-Client 4', sub: 'Dell Wyse 5070', st: 'ok', ip: '192.168.2.64', mac: 'aa:bb:cc:00:01:64', res: '4 Kerne, 4 GB' },

  // -- Heimnetz / Tailnet -----------------------------------------------------
  { id: 'g-lan', t: 'group', parent: null, label: 'Heimnetz-Geräte', sub: 'physische Geräte im Wohnbereich', st: 'ok' },
  { id: 'client-laptop', t: 'client', parent: 'g-lan', label: 'Admin-Laptop', sub: 'Arbeitsgerät', st: 'ok', ip: '192.168.2.101', mac: 'aa:bb:cc:00:0a:01' },
  { id: 'client-nas', t: 'client', parent: 'g-lan', label: 'NAS (physisch)', sub: 'Zweitgerät im Wohnzimmer', st: 'warn', ip: '192.168.2.102', mac: 'aa:bb:cc:00:0a:02',
    facts: ['S.M.A.R.T.-Warnung auf einer Festplatte seit letzter Woche'] },

  { id: 'g-remote', t: 'group', parent: null, label: 'Tailnet & unterwegs', sub: 'VPN-Zugriff von außerhalb', st: 'ok' },
  { id: 'remote-admin', t: 'remote', parent: 'g-remote', label: 'Admin-Zugang', sub: 'Zugriff von unterwegs über Tailscale/WireGuard', st: 'ok' }
];

const EDGES = [
  { s: 'speedport', t: 'inet', k: 'lan', d: 'WAN-Uplink über den Internetanbieter', h: 1 },
  { s: 'dom-app', t: 'speedport', k: 'ingress', d: 'DNS zeigt auf die öffentliche IP, Portweiterleitung 443 → nginx', h: 1 },
  { s: 'dom-app', t: 'svc-nginx', k: 'ingress', d: 'Öffentlicher Zugriff erreicht zuerst den Reverse Proxy', h: 1 },
  { s: 'svc-nginx', t: 'svc-app', k: 'proxy', d: 'Leitet Anfragen an das App-Backend weiter', h: 1 },
  { s: 'svc-app', t: 'svc-postgres', k: 'flow', d: 'Anwendungsdaten, SQL-Zugriffe', h: 1 },
  { s: 'svc-app', t: 'svc-ollama', k: 'flow', d: 'Fragt bei Bedarf das lokale Sprachmodell', h: 0 },
  { s: 'g301', t: 'svc-ollama', k: 'flow', d: 'Nutzt lokale Modelle für Zusammenfassungen', h: 0 },
  { s: 'g301', t: 'vm-nas', k: 'storage', d: 'Sichert Wissensdaten auf dem NAS', h: 0 },
  { s: 'vm-db', t: 'vm-nas', k: 'storage', d: 'Nächtliches Datenbank-Backup', h: 0 },
  { s: 'vm-nas', t: 'cloud-backup', k: 'storage', d: 'Off-Site-Sicherung', h: 0 },
  { s: 'pve-node1', t: 'svc-checkmk', k: 'mon', d: 'Wird von CheckMK überwacht', h: 0 },
  { s: 'pve-ai', t: 'svc-checkmk', k: 'mon', d: 'Wird von CheckMK überwacht', h: 0 },
  { s: 'pve-print', t: 'svc-checkmk', k: 'mon', d: 'Wird von CheckMK überwacht', h: 0 },
  { s: 'vm-web', t: 'svc-checkmk', k: 'mon', d: 'Wird von CheckMK überwacht', h: 0 },
  { s: 'g104', t: 'svc-checkmk', k: 'mon', d: 'Wird von CheckMK überwacht (aktuell gestoppt)', h: 0 },
  { s: 'svc-checkmk', t: 'g301', k: 'alert', d: 'Sendet Alarme an den Automatisierungs-Hub', h: 0 },
  { s: 'g301', t: 'cloud-ddns', k: 'flow', d: 'Aktualisiert den DynDNS-Eintrag bei IP-Wechsel', h: 0 },
  { s: 'speedport', t: 'cloud-ddns', k: 'flow', d: 'Meldet die aktuelle WAN-IP', h: 0, u: 1 },
  { s: 'client-laptop', t: 'remote-admin', k: 'vpn', d: 'Admin-Zugriff über VPN von unterwegs', h: 0 },
  { s: 'remote-admin', t: 'pve-node1', k: 'ssh', d: 'Administrativer SSH-Zugriff', h: 0 },
  { s: 'remote-admin', t: 'pve-ai', k: 'ssh', d: 'Administrativer SSH-Zugriff', h: 0 },
  { s: 'remote-admin', t: 'pve-print', k: 'ssh', d: 'Administrativer SSH-Zugriff', h: 0 },
  { s: 'client-laptop', t: 'g106', k: 'mon', d: 'Ruft das CheckMK-Dashboard im Browser auf', h: 0 },
  { s: 'client-nas', t: 'vm-nas', k: 'storage', d: 'Sicherung von Client-Daten auf die zentrale NAS-VM', h: 0 },
  { s: 'pve-node1', t: 'cluster', k: 'cluster', d: '1 Stimme im Quorum', h: 0 },
  { s: 'pve-ai', t: 'cluster', k: 'cluster', d: '1 Stimme im Quorum', h: 0 },
  { s: 'pve-print', t: 'cluster', k: 'cluster', d: '1 Stimme im Quorum', h: 0 },
  { s: 'pve-thin1', t: 'cluster', k: 'cluster', d: '1 Stimme im Quorum', h: 0 },
  { s: 'pve-thin2', t: 'cluster', k: 'cluster', d: '0 Stimmen (Ausfallsicherung)', h: 0 },
  { s: 'pve-thin3', t: 'cluster', k: 'cluster', d: '0 Stimmen (Ausfallsicherung)', h: 0 },
  { s: 'pve-thin4', t: 'cluster', k: 'cluster', d: '0 Stimmen (Ausfallsicherung)', h: 0 },
  { s: 'vm-voice', t: 'speedport', k: 'ingress', d: 'Eigene Portfreigabe für Sprachchat-Clients', h: 1 },
  { s: 'vm-game', t: 'speedport', k: 'ingress', d: 'Eigene Portfreigabe für Spiele-Clients', h: 1 },
  { s: 'pve-node1', t: 'svc-pihole', k: 'lan', d: 'DNS-Auflösung fürs LAN', h: 0 },
  { s: 'pve-ai', t: 'svc-pihole', k: 'lan', d: 'DNS-Auflösung fürs LAN', h: 0 },
  { s: 'client-laptop', t: 'svc-pihole', k: 'lan', d: 'DNS-Auflösung fürs LAN', h: 0 }
];

const FINDINGS = [
  { sev: 'crit', t: 'Mail-VM ist gestoppt – kein eigener Mailversand mehr', n: ['g104', 'svc-mail'], p: '2026-01-05', fx: 'VM wieder starten oder bewusst durch einen externen Mailhoster ersetzen und den Knoten hier als „ersetzt" markieren.' },
  { sev: 'warn', t: 'NAS (physisch) meldet eine S.M.A.R.T.-Warnung', n: ['client-nas'], p: '2026-01-03', fx: 'Festplatte prüfen/tauschen, bevor die Backup-Kette betroffen ist.' },
  { sev: 'info', t: 'Unklar, ob der DynDNS-Eintrag zuverlässig automatisch aktualisiert wird', n: ['speedport', 'cloud-ddns'], p: '2026-01-02', fx: 'Update-Log des Routers/Skripts prüfen, Kante danach bestätigen (u:0 setzen).' },
  { sev: 'good', t: 'Backup-Kette VM → NAS → Cloud läuft durchgängig und ist getestet', n: ['vm-db', 'vm-nas', 'cloud-backup'], p: '2025-12-20' }
];

/** [Oktett (letzte Zahl, ohne Punkt), Name, Art, Ort/Node, MAC, Status, Hinweis, Knoten-ID, Konflikt?] */
const IPS = [
  ['11', 'pve-node1', 'Proxmox-Node', 'core', 'aa:bb:cc:00:01:11', 'ok', '', 'pve-node1'],
  ['12', 'pve-ai', 'Proxmox-Node', 'ai', 'aa:bb:cc:00:01:12', 'ok', '', 'pve-ai'],
  ['13', 'pve-print', 'Proxmox-Node', 'print', 'aa:bb:cc:00:01:13', 'ok', '', 'pve-print'],
  ['21', 'vm-web', 'VM', 'core', 'aa:bb:cc:00:02:21', 'ok', '', 'vm-web'],
  ['22', 'vm-db', 'VM', 'core', 'aa:bb:cc:00:02:22', 'ok', '', 'vm-db'],
  ['31', 'Automatisierungs-Hub', 'VM', 'core', 'aa:bb:cc:00:02:31', 'ok', '', 'g301'],
  ['32', 'Monitoring-Container', 'LXC', 'core', 'aa:bb:cc:00:02:32', 'ok', '', 'g106'],
  ['41', 'vm-ollama', 'VM', 'ai', 'aa:bb:cc:00:02:41', 'ok', '', 'vm-ollama'],
  ['42', 'vm-dash', 'VM', 'ai', 'aa:bb:cc:00:02:42', 'ok', '', 'vm-dash'],
  ['51', 'ct-dns', 'LXC', 'print', 'aa:bb:cc:00:02:51', 'ok', '', 'ct-dns'],
  ['52', 'vm-nas', 'VM', 'print', 'aa:bb:cc:00:02:52', 'ok', '', 'vm-nas'],
  ['53', 'Mail-VM', 'VM', 'print', 'aa:bb:cc:00:02:53', 'gestoppt', 'bewusst gestoppt', 'g104'],
  ['54', 'vm-voice', 'VM', 'print', 'aa:bb:cc:00:02:54', 'ok', '', 'vm-voice'],
  ['55', 'vm-game', 'VM', 'print', 'aa:bb:cc:00:02:55', 'ok', '', 'vm-game'],
  ['101', 'client-laptop', 'Client', '–', 'aa:bb:cc:00:0a:01', 'ok', '', 'client-laptop'],
  ['102', 'client-nas', 'Client', '–', 'aa:bb:cc:00:0a:02', 'warn', 'S.M.A.R.T.-Warnung', 'client-nas']
];

/** [Name, Tailnet-IP, Status, Knoten-ID] */
const TSNET = [
  ['Admin-Laptop', '100.64.0.5', 'ok', 'client-laptop'],
  ['Handy (unterwegs)', '100.64.0.6', 'ok', 'remote-admin'],
  ['pve-node1', '100.64.0.11', 'ok', 'pve-node1']
];

const LIVE = {
  at: 'Beispieldaten',
  node: {
    'pve-node1': { cpu: 0.18, thr: 8, mem: 14, memMax: 32, up: 42, pool: [180, 512], root: [22, 96] },
    'pve-ai': { cpu: 0.61, thr: 16, mem: 41, memMax: 64, up: 12, pool: [420, 900], root: [30, 96] },
    'pve-print': { cpu: 0.09, thr: 4, mem: 6, memMax: 16, up: 55, pool: [90, 200], root: [10, 64] }
  },
  guest: {
    101: [12, 1.8, 4, 42],
    102: [8, 3.1, 8, 42],
    301: [4, 1.2, 4, 42],
    106: [15, 2.4, 4, 42],
    201: [72, 24, 32, 12],
    202: [5, 1.1, 4, 12],
    401: [2, 0.3, 1, 55],
    402: [10, 5.4, 8, 55],
    104: [0, 0, 2, 0],
    403: [3, 0.6, 2, 55],
    404: [22, 4.8, 8, 55]
  }
};
