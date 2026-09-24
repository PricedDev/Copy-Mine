import './ui/styles.css';
import { Core } from './world/core';
import { loadFonts } from './world/textures';
import { App } from './app';

/*
 * Night City Homelab – Einstieg: Schriften laden, Stadt bauen, Shader
 * vorkompilieren, dann den Vorhang öffnen.
 */

declare global {
  interface Window {
    __NC?: { ready: boolean; app?: App; error?: string; selfTest?: () => ReturnType<App['selfTest']> };
  }
}

const bar = document.getElementById('boot-bar')!;
const label = document.getElementById('boot-step')!;
const frame = () => new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0)));

async function step(text: string, pct: number) {
  label.textContent = text + ' …';
  bar.style.width = pct + '%';
  await frame();
}

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot() {
  window.__NC = { ready: false };
  if (!webglOk()) throw new Error('Dieser Browser stellt kein WebGL 2 bereit – die Stadt braucht eine Grafikkarte mit WebGL-2-Unterstützung (aktueller Chrome, Firefox oder Edge).');
  await step('Schriften laden', 8);
  await loadFonts();
  await step('Stadtplan berechnen', 18);
  const core = new Core(document.getElementById('stage')!);
  const app = new App(core);
  await app.build(step);
  await step('Shader vorbereiten', 94);
  core.renderer.compile(core.scene, core.camera);
  core.start();
  await step('Bereit', 100);
  window.__NC = { ready: true, app, selfTest: () => app.selfTest() };
  const boot = document.getElementById('boot')!;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 1200);
}

boot().catch(err => {
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  window.__NC = { ready: false, error: msg };
  label.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'err';
  p.textContent = 'Die Stadt konnte nicht starten: ' + msg;
  label.appendChild(p);
});
