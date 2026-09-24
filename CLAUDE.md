# Für Claude: dieses Repo auf Marcels eigene Infrastruktur ummünzen

Dieses Repo enthält zwei fertige, produktiv gelaufene Visualisierungen für ein Homelab: **Netzatlas** (flache
2D-Übersicht) und **Night City** (dieselben Daten als 2.5D-Stadt, three.js). Beide sind vollständiger,
funktionierender Code – kein Gerüst. Sie laufen gerade gegen einen frei erfundenen Beispiel-Datensatz. Deine
Aufgabe: sie für die Infrastruktur des Nutzers/der Nutzerin umbauen, mit dem sie diese Session gerade führst.

Lies zuerst [`README.md`](README.md) und [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) – dort steht das Schema und
wie die beiden Projekte zusammenhängen. Dieses Dokument hier beschreibt den Ablauf.

## Schritt 1 – Inventar aufnehmen

Frag nach (oder finde heraus, falls du direkten Zugriff auf die Infrastruktur hast, z. B. per SSH/API):

- Hypervisor-Nodes (Proxmox o. ä.): Namen, IPs, grobe Ressourcen.
- VMs/Container je Node: Name, Zweck, IP, ungefähre Ressourcen, Status (läuft/gestoppt).
- Wichtige Software/Dienste je VM/Container (Reverse Proxy, Datenbank, Monitoring, NAS-Software, …).
- Netzwerk: Router/Firewall, LAN-Adressbereich, öffentliche Domains/Endpunkte, VPN/Tailnet-Zugänge.
- Cloud-Dienste, die dazugehören (Backup-Ziel, DynDNS, …).
- Bekannte Probleme/Befunde, die als „Findings“ interessant wären.
- Automatisierungen/Bots/Workflows, die zwischen den Diensten unterwegs sind (für die Night-City-NPCs) –
  optional, kann auch später ergänzt werden.

Du musst nicht alles auf einmal bekommen – ein kleiner, unvollständiger erster Datensatz, der läuft, ist besser
als zu lange auf vollständige Daten zu warten. Erweitern ist jederzeit möglich.

## Schritt 2 – `netzatlas/data.js` schreiben

Format und Feldbedeutung: [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md). Nimm `netzatlas/data.example.js` als
Vorlage (gleiches Schema, ausführlich kommentiert). Ersetze den Inhalt von `netzatlas/data.js` durch das echte
Inventar. Halte dabei diese IDs bei (der mitgelieferte Seitencode/Nightcity-Code erwartet sie – siehe
Kommentar am Kopf von `data.example.js`), es sei denn du passt auch den jeweiligen Code mit an:

`inet`, `g-cloud`, `speedport`, `cluster`, `g-lan`, `g-remote`, sowie mindestens einen Proxmox-Node mit der ID
`pve-node1` (weitere Proxmox-Nodes sind in `nightcity/src/theme.ts` frei benennbar, siehe Schritt 3).

Prüf-Checkliste, bevor du weitermachst:
- Jede in `EDGES` referenzierte Knoten-ID existiert auch in `NODES`.
- Keine echten Zugangsdaten/Tokens/Passwörter in `facts`, `sub` oder anderen Freitextfeldern.
- `LIVE.guest`-Schlüssel entsprechen den `vmid`-Werten in `NODES`.

## Schritt 3 – Netzatlas testen

`netzatlas/index.html` einfach im Browser öffnen (oder `npx serve netzatlas`). Alle sechs Ansichten
durchklicken (Schaltplan, Gesamt-Topologie, Befunde, Abhängigkeiten, IP-Plan, Ausfall-Simulation prüfen). Das
ist der schnellste Weg zu sehen, ob die Daten stimmig sind, bevor du dich an Night City machst.

## Schritt 4 – Night City anpassen

Night City braucht etwas mehr Handarbeit, weil seine Skyline von Hand gestaltet ist statt automatisch generiert
(bewusste Design-Entscheidung des Originals: eine feste, wiedererkennbare Stadt statt eines zufälligen
Graph-Layouts). Die genaue Liste der anzupassenden Stellen steht in
[`nightcity/README.md`](nightcity/README.md) unter „Was du zwingend anpassen musst“ – kurz zusammengefasst:

1. `nightcity/src/theme.ts` (`CORP`): einen Eintrag pro echtem Proxmox-Node (Name, Farben, Viertel).
2. `nightcity/src/world/specials.ts` (`SPECIALS`): optional – auffällige Bauwerke für bestimmte Dienste
   (z. B. dein Monitoring, deine NAS). Ohne Eintrag bekommt ein Knoten einfach die generische Standardoptik.
3. `nightcity/src/layout/plan.ts`: falls du andere Gruppen-IDs als `g-cloud`/`g-lan`/`g-remote` verwendet hast.
4. `nightcity/src/sim/agents.ts`: eigenes NPC-Roster – das mitgelieferte Beispiel-Roster zeigt das Muster.
5. `nightcity/src/ui/modes.ts` (`shots`): die Kamerafahrten des Kinomodus (rein kosmetisch, kann auch später
   passieren oder sogar auf einen minimalen Stand reduziert werden).

Das ist mechanische Anpassungsarbeit anhand der echten Daten aus Schritt 2, kein Rewrite der 3D-Engine.

```bash
cd nightcity
npm install
npm run build && npm run preview   # http://127.0.0.1:4173
```

## Schritt 5 – Ausliefern

Siehe [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) für Hosting-Optionen und einen optionalen Passwortschutz, falls
die Seiten öffentlich (nicht nur im eigenen LAN/VPN) erreichbar sein sollen.

## Nicht vergessen

- Keine echten Zugangsdaten, API-Tokens oder Passwörter in `data.js` oder sonst irgendwo im Repo – dafür gibt
  es Secret-Stores/Umgebungsvariablen, nicht Klartext im Code.
- Wenn dieses Repo (oder ein Fork davon) selbst öffentlich bleiben soll: `data.js` enthält dann das komplette
  Lagebild der echten Infrastruktur (IPs, Zustände, Befunde) – entweder das Repo privat halten, oder `data.js`
  vor dem Veröffentlichen wieder durch Beispieldaten ersetzen.
