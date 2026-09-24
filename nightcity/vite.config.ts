import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Eine Quelle, zwei Darstellungen: Die Stadt liest dieselbe data.js wie der
 * Netzatlas (Standard: ../netzatlas/data.js, siehe README). Die Datei ist ein
 * klassisches Skript (top-level const) – das Plugin hängt nur die Exporte an,
 * statt sie zu kopieren oder per eval zu laden. Eigener Pfad: Umgebungsvariable
 * NC_DATA_PATH setzen (absolut oder relativ zum Projektordner).
 */
const DATA_PATH = process.env.NC_DATA_PATH
  ? resolve(process.cwd(), process.env.NC_DATA_PATH)
  : resolve(import.meta.dirname, '../netzatlas/data.js');
const VIRTUAL_ID = 'virtual:homelab-data';

function homelabData(): Plugin {
  return {
    name: 'homelab-data',
    resolveId(id) {
      return id === VIRTUAL_ID ? '\0' + VIRTUAL_ID : null;
    },
    load(id) {
      if (id !== '\0' + VIRTUAL_ID) return null;
      this.addWatchFile(DATA_PATH);
      const src = readFileSync(DATA_PATH, 'utf8');
      return `${src}\nexport { NODES, EDGES, FINDINGS, IPS, TSNET, LIVE };\n`;
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [homelabData()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 100000000
  },
  server: { host: true }
});
