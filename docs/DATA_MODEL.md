# Datenmodell

Beide Projekte – [Netzatlas](../netzatlas) und [Night City](../nightcity) – lesen dieselbe `data.js`
(`netzatlas/data.js`). Es ist ein klassisches Skript, kein JSON und kein ESM-Modul: eine Handvoll globaler
`const`-Deklarationen. Beide Apps laden sie als eigenständige `<script>`-Datei bzw. über ein kleines
Vite-Plugin, das die Exporte anhängt.

```js
const NODES = [ /* RawNode[] */ ];
const EDGES = [ /* RawEdge[] */ ];
const FINDINGS = [ /* RawFinding[] */ ];
const IPS = [ /* IpRow[] */ ];
const TSNET = [ /* TsRow[] */ ];
const LIVE = { at, node: {...}, guest: {...} };
```

## NODES

Jeder Knoten ist ein Objekt:

| Feld | Typ | Bedeutung |
|------|-----|-----------|
| `id` | string | eindeutige ID, wird von Kanten/Befunden referenziert |
| `t` | Typ | siehe unten |
| `parent` | string \| null | ID des übergeordneten Knotens (Hierarchie: Node → VM/CT → Dienst) |
| `label` | string | Anzeigename |
| `sub` | string | Unterzeile/Beschreibung |
| `st` | Status | `ok` \| `warn` \| `crit` \| `stopped` \| `unknown` |
| `ip` | string? | IP-Adresse |
| `mac` | string? | MAC-Adresse |
| `res` | string? | Ressourcen als Freitext, z. B. `"2 vCPU, 4 GB"` |
| `vmid` | number? | Proxmox-VMID – falls gesetzt, verknüpft mit `LIVE.guest[vmid]` |
| `tags` | string? | Freitext |
| `seen` | string? | Quelle/Zeitpunkt der Erhebung |
| `facts` | string[]? | zusätzliche Notizen, erscheinen im Detail-Panel |
| `need` | string[]? | versteckte harte Abhängigkeiten für die Ausfall-Analyse (z. B. „Domain braucht die Portweiterleitung“), zusätzlich zu den normalen Kanten |
| `ports` | string? | Freitext |

**Typen (`t`)**: `group` (reiner Container/Bereich) · `cloud` · `domain` · `router` · `virtual` (z. B. ein
Cluster) · `client` (physisches Heimnetzgerät) · `remote` (VPN/Tailnet-Zugang) · `pve` (Hypervisor-Node) ·
`svc` (Software/Dienst) · `vm` · `ct` (Container).

Cloud- und Domain-Knoten erhalten automatisch eine `need`-Abhängigkeit auf einen Knoten mit der ID `inet`
(falls vorhanden) – „ohne Internet kein Cloud-Dienst“, ohne dass du das für jeden einzeln eintragen musst.

## EDGES

```js
{ s: 'quelle', t: 'ziel', k: 'flow', d: 'Beschreibung', h: 1, u: 0, b: 0 }
```

Lies eine Kante als **„s nutzt/braucht t“**. Felder:

- `k` (Ebene): `lan` · `ingress` (öffentlicher Zugriff) · `vpn` · `proxy` · `flow` (Daten/API) · `storage` ·
  `alert` · `cluster` (Quorum) · `mon` (Monitoring) · `ssh`.
- `h`: `1` = harte Abhängigkeit (fällt `t` aus, fällt `s` mit aus) · `0` = weiche Abhängigkeit (`s` läuft nur
  eingeschränkt weiter).
- `u`: `1` = unbestätigt (z. B. noch nicht verifiziert, dass die Kante wirklich so funktioniert).
- `b`: `1` = aktuell unterbrochen. Wird von den Apps zusätzlich automatisch gesetzt, wenn `t` den Status
  `stopped` oder `crit` hat.

## FINDINGS

```js
{ sev: 'crit', t: 'Titel', n: ['knoten-id', ...], p: '2026-01-05', fx: 'Vorschlag zur Behebung' }
```

`sev`: `crit` · `warn` · `info` · `good`. `n` verweist auf die betroffenen Knoten-IDs. `p` ist ein Freitext-Datum
oder Zeitpunkt. `fx` ist optional ein Verbesserungsvorschlag.

## IPS

Eine Tabellenzeile pro IP, als Array statt Objekt (kompakter für viele Einträge):

```js
['<letztes Oktett oder Suffix>', 'Name', 'Art', 'Ort/Node', 'MAC', 'Status', 'Hinweis', 'Knoten-ID', /* Konflikt? */]
```

**Achtung**: Der mitgelieferte, echte Netzatlas-Seitencode setzt bei der Anzeige den Präfix `192.168.2.` fest
vor `r[0]` (siehe `renderIP()` im `<script>`-Block von `netzatlas/index.html`). Wenn dein LAN einen anderen
Adressbereich hat, entweder `r[0]` als volle IP eintragen und diese eine Zeile im Seitencode anpassen, oder bei
`192.168.x.x` bleiben.

## TSNET

```js
['Gerätename', 'Tailnet-/VPN-IP', 'Status', 'Knoten-ID']
```

## LIVE

Optional – wenn leer/fehlend, blenden beide Apps die Live-Werte einfach aus.

```js
const LIVE = {
  at: 'Zeitstempel oder Beschriftung',
  node: {
    '<pve-node-id>': { cpu, thr, mem, memMax, up, pool: [used, max] | null, root: [used, max] }
  },
  guest: {
    '<vmid>': [cpuPercent, ramUsedGB, ramMaxGB, uptimeTage]
  }
};
```

## Ausfall-Simulation (Algorithmus)

Beide Apps implementieren denselben, einfachen Algorithmus (Netzatlas in seinem `<script>`-Block, Night City in
`nightcity/src/data/model.ts`):

1. Die ausgewählten Knoten (und alle ihre Kind-Knoten über `parent`) gelten als „ausgefallen“.
2. Iterativ: jede harte Kante (`h: 1`), deren Ziel ausgefallen ist, lässt auch die Quelle ausfallen. Jeder
   Knoten mit einem `need`-Eintrag auf einen ausgefallenen Knoten fällt ebenfalls aus.
3. Das wiederholt sich, bis sich nichts mehr ändert (Fixpunkt).
4. Alles, was nicht ausgefallen ist, aber eine weiche Kante (`h: 0`) zu einem ausgefallenen Ziel hat, gilt als
   „eingeschränkt“.

## Eigene Daten schreiben

Am einfachsten: `netzatlas/data.example.js` als Vorlage nehmen (dort steht dasselbe Schema mit Kommentaren) und
`netzatlas/data.js` durch dein eigenes Inventar ersetzen. Ein paar IDs erwartet der mitgelieferte Netzatlas- und
Night-City-Seitencode fest (siehe Kommentar am Kopf von `netzatlas/data.example.js` und den Abschnitt „Was du
zwingend anpassen musst“ in `nightcity/README.md`) – behalte sie bei, oder passe die entsprechenden Code-Stellen
mit an.
