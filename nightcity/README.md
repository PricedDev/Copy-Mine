# Night City Homelab

Dein Homelab als begehbare 2.5D-Cyberpunk-Stadt: Proxmox-Nodes werden zu Corp-Türmen, VMs zu Hochhäusern,
Container zu Modul-Stapeln. Jede Kante aus deiner Topologie ist ein Datenstrom auf ihrem echten Weg durch die
Stadt, und deine Agents/Workflows laufen als NPCs ihre Runden – jeder Schritt über eine echte Kante, jeder
Schritt im Protokoll nachvollziehbar.

Dies ist der (von persönlichen Daten befreite) Quellcode einer echten, laufenden Umsetzung – mit einem frei
erfundenen Beispiel-Datensatz statt echter Infrastruktur. Er baut und läuft direkt gegen die Beispieldaten;
für dein eigenes Homelab ersetzt du danach nur die Datenquelle (siehe unten) und passt ein paar
Stellen an dein Inventar an.

**Schwesterprojekt:** [Netzatlas](../netzatlas) – eine flache 2D-Übersicht (Schaltplan, Graph, Befunde,
IP-Plan, Ausfall-Simulation) über dieselben Daten. Night City liest **dieselbe** `data.js`.

## Datenquelle

Die Stadt hat **keine eigenen Daten**. `vite.config.ts` lädt standardmäßig `../netzatlas/data.js` über ein
kleines Vite-Plugin und hängt nur die Exporte an (kein Kopieren, kein `eval`). Eigener Pfad: Umgebungsvariable
`NC_DATA_PATH` setzen. Wer die Topologie in `netzatlas/data.js` aktualisiert, baut die Stadt einfach neu – neue
VMs/CTs bekommen automatisch ein Grundstück in ihrem Viertel, neue Cloud-Dienste eine Inselzelle, neue
Heimnetz-Geräte ein Haus. Das Datenschema ist in [`../docs/DATA_MODEL.md`](../docs/DATA_MODEL.md) beschrieben.

### Was du zwingend anpassen musst

Ein paar Stellen im Code sind **nicht** allein datengetrieben, sondern kennen bestimmte Knoten-IDs oder
Anzahlen fest (weil die Stadt für eine feste, von Hand gestaltete Skyline gebaut ist statt für ein beliebig
generiertes Layout):

- **`src/theme.ts`** (`CORP`) – Aussehen/Name/Viertel je Proxmox-Node. Trage hier deine eigenen `pve`-Node-IDs ein.
- **`src/world/specials.ts`** (`SPECIALS`, `TYPE_SPECIALS`) – besondere 3D-Bauwerke für bestimmte Dienste
  (z. B. Monitoring, NAS, Mailserver). Ordne hier deine eigenen Knoten-IDs den passenden (oder neuen) Funktionen zu.
- **`src/layout/plan.ts`** – Rasterlayout, Viertel-Bänder, welche Gruppen-IDs als „Cloud“/„Heimnetz“/„Tailnet“
  gelten (`g-cloud`, `g-lan`, `g-remote` in den Beispieldaten).
- **`src/sim/agents.ts`** – das NPC-Roster (siehe „Einen Agent ergänzen“ unten).
- **`src/ui/modes.ts`** (`shots`) – die Kamerafahrten des Kinomodus.

Das ist bewusst so gebaut (ein festes Raster statt eines automatischen Force-Layouts) – die Stadt sieht
dadurch geordnet und wiedererkennbar aus, statt wie ein zufälliger Graph. Der Preis: dein Claude muss diese
Stellen einmal an dein eigenes Inventar anpassen. Das ist eine überschaubare, mechanische Aufgabe (siehe unten),
kein Rewrite.

## Aufbau

| Ordner | Inhalt |
|--------|--------|
| `src/data/` | Modell (Knoten, Kanten, Befunde, Live-Werte, Ausfall-Analyse – dieselbe Logik wie im Netzatlas) |
| `src/layout/plan.ts` | Stadtplan: festes Raster, Viertel je Node, Grundstücke, Straßennetz, Brücke, Insel |
| `src/layout/routes.ts` | Weg jeder Kante: Straße (LAN), Hochbahn (Tailnet), Lichtbogen (Cluster-Quorum), intern |
| `src/world/` | Grafik: Kern (Kamera, Bloom, Grading), Gebäude, Sonderbauten, Straßen, Umwelt, Datenströme, NPCs, Effekte |
| `src/world/materials.ts` | Fassaden-Shader (Fenster mit Rahmen, Innenräume per Interior Mapping, Jalousien, Vorhänge) und Oberflächendetails |
| `src/world/props.ts` | Straßenleben: Poller, Tonnen, Bänke, Hydranten, Automaten, Info-Säulen, Ampeln, Strommasten |
| `src/sim/agents.ts` | **Das NPC-Roster** – hier kommen neue Agents/Workflows dazu |
| `src/sim/director.ts` | Regie: Schritte, Wege, Protokoll, Reaktion auf Ausfälle |
| `src/ui/` | HUD: Dossier, NETWATCH-Protokoll, Lagefunk, Minimap, Menüs, Suche, Kino/Foto/Scanner |
| `src/app.ts` | Verbindet alles: Auswahl, Picking, Tastatur, Ausfall-Kaskade |
| `scripts/single.mjs` | Einzeldatei-Build (`dist-single/index.html`) |
| `tests/` | Headless-Prüfungen mit lokalem Chrome. **Hinweis:** Diese Skripte wurden gegen die ursprüngliche, sehr viel größere reale Topologie geschrieben und referenzieren teils Knoten-IDs, die es in den mitgelieferten Beispieldaten nicht gibt. Nimm sie als Vorlage/Inspiration für eigene Tests, nicht als sofort lauffähige Suite gegen die Beispieldaten. |

## Befehle

```bash
npm install
npm run dev          # Entwicklungsserver
npm run build        # Typprüfung + Build + Einzeldatei nach dist-single/
npm run preview      # dist/ auf http://127.0.0.1:4173
npm run test:e2e     # Interaktionsprüfungen (siehe Hinweis oben zu tests/)
npm run test:render  # Screenshots aus mehreren Blickwinkeln nach tests/shots/
npm run test:perf    # FPS je Qualitätsstufe
```

## Qualitätsstufen

| Stufe | Auflösung | Detailstufe | Spiegelung/Schatten |
|-------|-----------|-------------|---------------------|
| Ultra (Standard) | mind. 1,5× (Supersampling), max. 2× | Innenräume, Rahmen, Pfützen, Regenringe | ja |
| Hoch | Bildschirm-DPR (max. 2×) | ja | ja |
| Mittel | 1× | flache Fenster | nein |
| Niedrig | 0,75× | flache Fenster | nein |

Die Detailstufe blendet mit dem Abstand über: aus der Ferne sehen Fassaden aus wie vorher (flache Fenster,
gleiche Helligkeit), ab etwa 10 Pixeln je Fensterzelle erscheinen Rahmen und Räume.

## Einen Agent ergänzen

In `src/sim/agents.ts` einen Eintrag im `AGENTS`-Array anlegen: `home` ist der Startknoten, jeder Schritt nennt
nur das Ziel. Der Weg ist die Kante zwischen aktuellem Knoten und Ziel – in Pfeilrichtung eine Anfrage, dagegen
die Antwort. Gibt es zwischen zwei Knoten mehrere Kanten, legt `via: [s, t]` die richtige fest. `validateAgents()`
prüft beim Start, dass jeder Schritt eine echte Kante in deiner `data.js` ist und die Runde zu Hause endet –
Fehler stehen im Protokoll und in der Konsole. Das mitgelieferte Beispiel-Roster (Automatisierungs-Hub,
CheckMK-Streife, Admin per SSH, Backups, Website-Besucher) zeigt das Muster anhand der Beispieldaten.

## Ein Sonderbauwerk ergänzen

In `src/world/specials.ts` eine Funktion schreiben und in `SPECIALS` unter der Knoten-ID eintragen (oder in
`TYPE_SPECIALS` unter dem Knotentyp, für alle Knoten dieses Typs). Sie bekommt den Baukontext (lokale
Koordinaten, Front = +z) und die Maße des Grundgebäudes. Werte nach Möglichkeit aus dem Modell lesen statt hart
einzutragen.

## Ausliefern

`npm run build` erzeugt `dist-single/index.html` – eine einzelne, eigenständige HTML-Datei ohne weitere
Abhängigkeiten. Die kannst du auf jedem Webserver (nginx, Caddy, `npx serve`, ein simpler S3-Bucket, …) hosten,
in ein bestehendes Dashboard einbetten oder als Artifact/Vorschau teilen.

## Später (Ideen für dein Claude)

- Live-Daten statt Snapshot: `src/data/model.ts` liest heute nur `LIVE` aus `data.js`. Eine echte Live-Quelle
  (Proxmox-API, Monitoring-Webhook, …) bräuchte nur diese eine Stelle.
- Tageszeit, weitere Sonderbauten, Sound-Szenen je Viertel.
