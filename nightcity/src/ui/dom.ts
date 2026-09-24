/* Kleine DOM-Helfer */

export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('Element fehlt: ' + sel);
  return el as T;
};

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function fmt(v: number, d = 1): string {
  return Number(v).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

export function el(tag: string, cls?: string, html?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

/** Einstellungen im Browser merken – darf still scheitern (privates Fenster, Artifact-Vorschau) */
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem('nc-homelab:' + key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem('nc-homelab:' + key, JSON.stringify(value)); } catch { /* egal */ }
  }
};
