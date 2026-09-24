# Homelab-Visualisierung: Netzatlas + Night City

Zwei Wege, dieselbe Homelab-Topologie zu sehen:

- **[Netzatlas](netzatlas/)** – eine schnelle, flache 2D-Übersicht: Schaltplan, Gesamt-Graph, Befunde,
  IP-Plan, Ausfall-Simulation. Eine einzelne HTML-Datei, kein Build nötig.
- **[Night City](nightcity/)** – dieselben Daten als begehbare 2.5D-Cyberpunk-Stadt (three.js): Proxmox-Nodes
  als Corp-Türme, VMs als Hochhäuser, deine Agents/Workflows als NPCs, die auf echten Wegen unterwegs sind.

Beide lesen **dieselbe** `netzatlas/data.js` – ein Inventar deiner Infrastruktur in einem einfachen, gut
dokumentierten Format. Aktualisierst du die Daten einmal, siehst du die Änderung in beiden Ansichten.

Dies ist echter, produktiv gelaufener Code – kein Tutorial-Gerüst. Er wurde für dieses Repo von persönlichen
Daten befreit (echte IPs, Domains, Zugangsdaten, Gerätenamen) und läuft hier stattdessen gegen einen frei
erfundenen Beispiel-Datensatz. Damit kannst du beide Projekte sofort öffnen/bauen und ausprobieren, bevor du
sie mit deinem eigenen Inventar befüllst.

## Schnellstart

```bash
# Netzatlas: einfach öffnen, kein Build
open netzatlas/index.html          # oder: npx serve netzatlas

# Night City: three.js-Projekt mit Vite
cd nightcity
npm install
npm run dev
```

## Wie es zusammenhängt

```
netzatlas/data.js  ←── einzige Datenquelle für beide Projekte
       │
       ├── netzatlas/index.html   (liest data.js per <script>-Tag)
       └── nightcity/             (liest dieselbe data.js per Vite-Plugin, siehe vite.config.ts)
```

- Schema und Beispiele: [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)
- Deployment-Hinweise: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- Für dein Claude, das dies für deine eigene Infrastruktur umbauen soll: [`CLAUDE.md`](CLAUDE.md)

## Mit eigenen Daten befüllen

1. Deine Infrastruktur als `NODES`/`EDGES`/… nach dem Schema in `docs/DATA_MODEL.md` eintragen (Vorlage:
   `netzatlas/data.example.js`) und in `netzatlas/data.js` speichern.
2. Netzatlas neu laden – fertig, es liest die Datei direkt.
3. Night City neu bauen (`npm run build` in `nightcity/`) und ein paar Stellen im Code an deine eigenen
   Proxmox-Node-IDs anpassen (siehe `nightcity/README.md`, Abschnitt „Was du zwingend anpassen musst“) – das
   ist eine überschaubare, mechanische Aufgabe für dein Claude, kein Rewrite.

## Lizenz / Nutzung

Kein bestimmtes Lizenzmodell vorgegeben – nimm den Code, bau ihn für dein eigenes Homelab um, und mach daraus,
was für dich nützlich ist.
