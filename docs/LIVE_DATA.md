# Live-Daten: vom Snapshot zum Live-Dashboard

`data.js` ist standardmäßig ein **statischer Snapshot** – gut zum Starten, aber irgendwann willst du echte,
sich aktualisierende Werte sehen (CPU/RAM, ob eine VM wirklich läuft, echte Alarme), ohne `data.js` von Hand zu
pflegen. Dieses Dokument ist der vollständige Bauplan dafür – Architektur, ein Collector-Grundgerüst und eine
Checkliste, an der du (bzw. dein Claude) prüfen kann, ob das Ergebnis wirklich fertig ist.

**Wichtig:** Struktur (`NODES`/`EDGES`) bleibt statisch – die ändert sich nur, wenn du wirklich Server umbaust.
Live wird nur, **was sich laufend ändert**: Auslastung, Status (läuft/gestoppt/defekt), Alarme.

## Architektur

```
                 ┌──────────────────────────┐
  Hypervisor-API │                          │
  (Proxmox, ESXi,│                          │
   …) ───────────┤                          │        GET /live.json
                 │   Collector (ein         │◄───────────────────────  Netzatlas (Browser)
  Monitoring-API │   kleiner, immer         │
  (CheckMK,      │   laufender Dienst,      │        GET /live.json
   Zabbix,       ├───┤   read-only)         │◄───────────────────────  Night City (Browser)
   Prometheus,   │                          │
   …) ───────────┤                          │
                 └──────────────────────────┘
```

- **Ein Collector, eine Quelle.** Ein kleiner, dauerhaft laufender Dienst fragt deine Hypervisor- und
  Monitoring-APIs ab und hält daraus **ein** aktuelles JSON im Speicher (`LIVE`-Objekt, exakt das Format aus
  `docs/DATA_MODEL.md`). Beide Frontends fragen denselben Collector ab – nie direkt die Hypervisor-/Monitoring-
  API, und nie zwei verschiedene Quellen für dieselbe Zahl (sonst zeigen Netzatlas und Night City
  unterschiedliche Werte).
- **Nur lesen.** Der Collector braucht ausschließlich Lese-Rechte (z. B. bei Proxmox die Rolle `PVEAuditor`,
  bei CheckMK einen reinen Lese-Automatisierungsbenutzer). Er darf nichts steuern/starten/stoppen – die
  Dashboards sind Anzeige, keine Fernsteuerung.
- **Ein Endpunkt, ein Format.** Der Collector liefert unter einer URL (z. B. `/live.json` oder
  `/api/live`) genau das `LIVE`-Format:
  ```json
  { "at": "2026-01-06T12:00:00Z", "node": { "<pve-id>": {...} }, "guest": { "<vmid>": [cpu, ramGB, ramMaxGB, uptimeTage] } }
  ```
- **Poll oder Push, beides passt.** Am einfachsten: der Collector schreibt das JSON alle paar Sekunden in eine
  Datei/einen HTTP-Endpunkt, die Frontends pollen (siehe unten, schon eingebaut). Wer mag, kann später auf
  Server-Sent Events umstellen – das Frontend-Format ändert sich dadurch nicht.

## Frontend: schon vorbereitet

**Netzatlas** kann das bereits – ohne dass du am Seitencode etwas ändern musst. Vor dem `<script src="data.js">`
noch ein `<script>` einfügen, das die Live-URL setzt:

```html
<script>window.NETZATLAS_LIVE_URL = '/live.json';</script>
<script src="data.js"></script>
<script src="app-inline">...</script>
```

Danach pollt die Seite alle 10 Sekunden (einstellbar über `window.NETZATLAS_LIVE_POLL_MS`), merged die Antwort
in `LIVE` und rendert Schaltplan + Graph neu. Bricht die Verbindung ab, bleibt der letzte bekannte Stand stehen
und der Titel zeigt „Live-Verbindung unterbrochen" statt abzustürzen oder alles auf 0 zu setzen. Ohne gesetzte
`NETZATLAS_LIVE_URL` verhält sich die Seite exakt wie vorher (Snapshot aus `data.js`, kein Netzwerk-Zugriff).

**Night City** liest `LIVE` über dieselben Model-Funktionen (`model.nodeLive()`, `model.guestLive()`,
`model.alloc()`), die schon beim Rendern jeder Karte/jedes Gebäudes aufgerufen werden – ein Live-Update braucht
dort also (a) denselben Poll wie oben, der `LIVE` aktualisiert, und (b) einen Re-Render-Trigger. Das three.js-
Rendering ist teurer als Netzatlas' HTML-Rebuild, deshalb hier gezielter vorgehen statt alles neu zu bauen:
Fenstermaterialien/Meter-Anzeigen gezielt aktualisieren, statt die ganze Stadt neu aufzubauen. Das ist der
Teil, der noch echte Entwicklungsarbeit ist – kein Kopieren einer Vorlage.

## Collector: eigenes Grundgerüst bauen

Es gibt bewusst **keine fertige Collector-Implementierung** in diesem Repo – der richtige Weg hängt an deiner
konkreten Infrastruktur (welcher Hypervisor, welches Monitoring, wie erreichbar). Bauplan, sprachunabhängig:

1. **Config**: Zugangsdaten/Endpunkte NIE im Code – Umgebungsvariablen oder eine lokale, nicht eingecheckte
   Config-Datei (`.env`, in `.gitignore`).
2. **Poll-Loop**: alle 5–15 Sekunden die Hypervisor-API abfragen (CPU/RAM/Uptime je Node und Gast), alle
   10–30 Sekunden die Monitoring-API (Status, offene Probleme).
3. **Mapping**: deine Proxmox-VMID/Node-Namen auf die `id`/`vmid`-Werte aus deiner `data.js` abbilden (eine
   kleine, feste Zuordnungstabelle reicht – das ändert sich nur, wenn du Server umbaust).
4. **Zusammenbauen**: ein `LIVE`-Objekt im Speicher halten, bei jedem Poll aktualisieren, `at` auf den
   aktuellen Zeitstempel setzen.
5. **Ausliefern**: ein einzelner HTTP-Endpunkt (`GET /live.json`), der das aktuelle `LIVE`-Objekt als JSON
   zurückgibt. Kein Zustand pro Request nötig – einfach das zuletzt gepollte Objekt zurückgeben.
6. **Betrieb**: als systemd-Service/Docker-Container dauerhaft laufen lassen, mit eigenem, möglichst
   unprivilegiertem Systembenutzer.

Ein minimales Python-Beispiel (Struktur, kein fertiges Produkt – Fehlerbehandlung/Auth ergänzen):

```python
import time, json, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

live = {"at": None, "node": {}, "guest": {}}
lock = threading.Lock()

def poll():
    while True:
        # TODO: echte Hypervisor-/Monitoring-Abfragen hier, z. B. per requests.get(...)
        with lock:
            live["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            # live["node"]["pve-node1"] = {...}
            # live["guest"]["101"] = [cpu, ramUsed, ramMax, uptimeTage]
        time.sleep(10)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/live.json":
            self.send_response(404); self.end_headers(); return
        with lock:
            body = json.dumps(live).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")  # nur falls Frontend auf anderer Origin läuft
        self.end_headers()
        self.wfile.write(body)

threading.Thread(target=poll, daemon=True).start()
HTTPServer(("127.0.0.1", 8787), Handler).serve_forever()
```

Hinter einen Reverse Proxy stellen (nginx/Apache/Caddy), nicht direkt exponieren – siehe
[`DEPLOYMENT.md`](DEPLOYMENT.md).

## Sicherheit

- **Nur lesende Zugangsdaten** für Hypervisor und Monitoring, nichts, was starten/stoppen/löschen kann.
- **Keine Zugangsdaten im Frontend.** `/live.json` liefert nur die schon aufbereiteten Zahlen, nie Tokens,
  Passwörter oder rohe API-Antworten.
- **Der Collector-Endpunkt ist Teil des Lagebilds** – dieselbe Zugriffsbeschränkung wie für Netzatlas/Night
  City selbst (LAN/VPN-only oder Passwortschutz, siehe `DEPLOYMENT.md`). Ein öffentlich erreichbares
  `/live.json` ohne Schutz verrät genauso viel wie die Dashboards selbst.
- **Rate-Limits/Timeouts** gegen die Hypervisor-/Monitoring-API einhalten, damit der Collector sie nicht
  überlastet – ein Poll alle paar Sekunden reicht für ein Dashboard, das für Menschen gedacht ist.
- **Fail closed, nicht falsch.** Ist die Quelle nicht erreichbar, lieber den letzten bekannten Stand mit
  Hinweis „veraltet" zeigen (so ist es in Netzatlas schon eingebaut) als falsche Nullen oder einen Absturz.

## Definition of Done – Checkliste

Bevor das als „live" gilt, alle Punkte durchgehen:

- [ ] Ändert sich die CPU/RAM-Anzeige eines echten Gastes im Dashboard, wenn sich die echte Auslastung ändert
      (ohne `data.js` von Hand zu bearbeiten)?
- [ ] Wird eine gestoppte VM im Dashboard als gestoppt angezeigt, sobald sie wirklich gestoppt wird – und wieder
      als laufend, sobald sie wieder läuft?
- [ ] Läuft der Collector dauerhaft (systemd/Docker), übersteht er einen Neustart des Hosts automatisch?
- [ ] Bricht die Verbindung zum Collector ab (Dienst neu gestartet, Netzwerkproblem): zeigt das Dashboard einen
      klaren Hinweis statt falscher Werte oder eines Fehlers in der Konsole?
- [ ] Zeigen Netzatlas und Night City für denselben Knoten **dieselben** Live-Werte (eine Quelle, kein
      Auseinanderlaufen)?
- [ ] Hat der Collector wirklich nur Lese-Rechte auf Hypervisor/Monitoring – geprüft, nicht nur angenommen?
- [ ] Liegen irgendwo Zugangsdaten/Tokens im Klartext im Code oder im ausgelieferten Frontend (Browser-
      DevTools → Netzwerk-Tab prüfen)? Sollte „nein" sein.
- [ ] Ist `/live.json` (bzw. der gewählte Endpunkt) genauso zugriffsbeschränkt wie die Dashboards selbst?
- [ ] Poll-Intervall angemessen gewählt (nicht so aggressiv, dass es die Hypervisor-/Monitoring-API spürbar
      belastet)?
- [ ] Wurde das über mehrere Stunden/über Nacht laufen gelassen, ohne dass der Collector hängen bleibt oder
      Speicher/Handles leakt?

Erst wenn alle Punkte mit „ja" beantwortet sind, ist es ein fertiges Live-Dashboard und nicht nur ein Demo, das
beim ersten echten Ausfall falsche Werte zeigt.
