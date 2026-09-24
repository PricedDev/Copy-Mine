// Galerie: feste Kameraansichten im Fotomodus (ohne HUD) für Vorher/Nachher-Vergleiche der Grafik.
// NC_OUT=tests/gallery/vorher node tests/gallery.mjs   ·   NC_VIEWS=street,tower node tests/gallery.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.NC_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.NC_OUT || 'tests/gallery';
const W = +(process.env.W || 1920), H = +(process.env.H || 1080);
const WEATHER = process.env.NC_WEATHER || 'regen';
const QUALITY = process.env.NC_Q || 'ultra';
mkdirSync(OUT, { recursive: true });

// Name, Ziel (Bauwerk-ID, „d:"-Viertel oder null = Stadtmitte), Abstand, Neigung, Drehung
const VIEWS = [
  ['overview', null, 700, 0.95, 0],
  ['downtown', 'pve-node1', 280, 1.0, 0.6],
  ['tower', 'pve-node1', 110, 1.17, 0.35],
  ['street', 'g301', 55, 1.2, -0.7],
  ['plaza', 'cluster', 180, 1.05, 0.9],
  ['foundry', 'pve-print', 150, 1.1, -0.5],
  ['heimnetz', 'd:d-lan', 170, 1.08, 0.4],
  ['island', 'd:d-out', 260, 1.02, 0],
  ['neural', 'pve-ai', 150, 1.1, 2.2],
  ['house', 'd:d-lan', 75, 1.16, 0.9],
  ['vmside', 'g106', 72, 1.12, 1.5]
];
const pick = (process.env.NC_VIEWS || '').split(',').filter(Boolean);
const views = pick.length ? VIEWS.filter(v => pick.includes(v[0])) : VIEWS;

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome-stable', headless: 'new',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__NC && (window.__NC.ready || window.__NC.error), { timeout: 180000 });
await page.keyboard.press('Escape');
const wait = ms => new Promise(r => setTimeout(r, ms));
await page.evaluate((q, w) => {
  const app = window.__NC.app;
  app.core.setQuality(q);
  app.env.setWeather(w);
  app.photo.enter();
}, QUALITY, WEATHER);
await wait(3000);

for (const [name, target, dist, polar, azimuth] of views) {
  await page.evaluate((target, dist, polar, azimuth) => {
    const app = window.__NC.app;
    const core = app.core;
    const T = core.controls.target.constructor;
    // ohne Ziel: Gesamtansicht wie „R"
    if (!target) { app.resetView(); return; }
    const c = target.startsWith('d:') ? app.city.districtCenter(target.slice(2)) : app.city.structures.get(target)?.center;
    if (!c) throw new Error('Ziel fehlt: ' + target);
    core.flyTo(new T(c.x, 0, c.z), { dist, polar, azimuth, duration: 0.05 });
  }, target, dist, polar, azimuth);
  await wait(target ? 3500 : 5000);
  const fps = await page.evaluate(() => window.__NC.app.core.fps);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${name}: ${fps.toFixed(1)} FPS`);
}
const errs = logs.filter(l => /error|warn/i.test(l));
console.log(`Konsole: ${logs.length} Meldungen, ${errs.length} Warnungen/Fehler`);
errs.slice(0, 20).forEach(l => console.log('  ' + l));
await browser.close();
