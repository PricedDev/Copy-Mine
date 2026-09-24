# Deployment

Beide Projekte sind am Ende statische Dateien – jeder Webserver reicht.

## Netzatlas

`netzatlas/index.html` (+ `data.js` daneben) sind alles, was du brauchst. Optionen:

- Direkt per `file://` öffnen (funktioniert, nur ohne Internetzugang fehlt die Graph-Ansicht, siehe unten).
- Ein beliebiger Webserver: nginx, Caddy, `npx serve netzatlas`, ein S3-Bucket mit statischem Hosting,
  GitHub Pages, …
- Die Graph-Ansicht lädt Cytoscape.js von `cdnjs.cloudflare.com`. Für einen komplett offline nutzbaren Build
  die Datei stattdessen herunterladen und den `<script src="https://cdnjs...">`-Tag in `index.html` auf einen
  lokalen Pfad ändern.

## Night City

```bash
cd nightcity
npm install
npm run build        # → dist-single/index.html (eine einzelne Datei)
```

`dist-single/index.html` genauso hosten wie oben bei Netzatlas beschrieben.

## Beide zusammen

Ein einfaches Muster: ein Webserver, zwei Pfade, z. B. `/topologie/` → Netzatlas, `/stadt/` → Night City
(`dist-single/index.html`). Beispiel-Serverblock (nginx):

```nginx
server {
    listen 80;
    server_name homelab.example.com;

    location /topologie/ {
        alias /var/www/netzatlas/;
        try_files $uri $uri/ /topologie/index.html;
    }

    location /stadt/ {
        alias /var/www/night-city/;
        try_files $uri $uri/ /stadt/index.html;
    }
}
```

## Optional: Zugriffsschutz

Beide Seiten zeigen ein vollständiges Lagebild deiner Infrastruktur (IPs, Zustände, Befunde). Wenn du sie
öffentlich erreichbar machst (statt nur im eigenen LAN/VPN), lohnt sich mindestens ein einfacher Passwortschutz,
z. B. HTTP Basic Auth auf dem Webserver:

```nginx
location /topologie/ {
    auth_basic "Homelab";
    auth_basic_user_file /etc/nginx/.htpasswd;
    # ...
}
```

Das ist keine starke Absicherung (kein Rate-Limiting, kein SSO) – reicht aber, um zu verhindern, dass jeder mit
der URL alles sieht. Für mehr Schutz: nur im VPN/Tailnet erreichbar machen, oder einen Identity-Provider davor
schalten (z. B. Cloudflare Access, Authelia, oauth2-proxy).
