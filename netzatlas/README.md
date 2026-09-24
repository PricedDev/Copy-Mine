# Netzatlas

Eine einzelne, selbst gehostete Webseite, die dein Homelab so zeigt, wie es physisch und logisch aufgebaut ist:
jede Node, jede VM/jeder Container, jede Software, jede Abhängigkeit – mit Befunden, IP-Plan und einer
Ausfall-Simulation.

Das ist der echte, produktiv laufende Seitencode (HTML/CSS/JS in einer Datei, kein Build-Schritt nötig) – von
persönlichen Daten befreit und mit einem frei erfundenen Beispiel-Datensatz statt echter Infrastruktur.

## Ansichten

1. **Schaltplan** – fester Aufbau: Internet & Cloud → Router → Rechenzentrum/Proxmox-Cluster (Nodes als
   Spalten) → VM/CT-Karten → Software-Zeilen, dazu Heimnetz-Geräte und Tailnet/VPN-Zugänge. Klick auf ein
   Element zeigt Details und seine Abhängigkeiten als Linien.
2. **Gesamt-Topologie** – derselbe Datensatz als frei zoombarer Graph (Cytoscape.js).
3. **Befunde** – alle Einträge aus `FINDINGS`, filterbar nach Schweregrad.
4. **Abhängigkeiten** – Tabelle aller Kanten, filter- und durchsuchbar.
5. **IP-Plan** – IP- und Tailnet/VPN-Tabellen.
6. Ausfall-Simulation: ein oder mehrere Knoten „ausfallen lassen“ und die Kaskade (harte Abhängigkeiten +
   `need` + Eltern/Kind) live sehen.

## Benutzen

Einfach `index.html` öffnen oder auf einem beliebigen Webserver hosten (nginx, Caddy, `npx serve`, GitHub
Pages, …) – keine Build-Pipeline nötig. Cytoscape.js für die Graph-Ansicht wird von einem CDN geladen
(`cdnjs.cloudflare.com`); ohne Internetzugang im Browser funktionieren die anderen Ansichten trotzdem.

## Eigene Daten eintragen

`data.js` ist die **einzige** Datei mit echten Daten. Schema: [`../docs/DATA_MODEL.md`](../docs/DATA_MODEL.md).
`data.example.js` ist dieselbe Datei mit ausführlichen Kommentaren als Referenz/Vorlage – wird von der Seite
selbst nicht geladen.

**Wichtig**: Ein paar IDs erwartet der Seitencode fest, weil der Schaltplan sie direkt anspricht (Router,
Proxmox-Cluster, die Proxmox-Nodes selbst, die Gruppen für Cloud/Heimnetz/Tailnet). Die genaue Liste und wie du
sie anpasst steht als Kommentar am Kopf von `data.example.js`. Alles andere (Gäste, Software, Clients,
Cloud-Dienste, IPs, Befunde) ist frei.

[Night City](../nightcity) liest dieselbe `data.js` – aktualisierst du hier, baust du dort einfach neu.
