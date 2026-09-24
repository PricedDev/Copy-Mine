// Headless-Prüfung: Start, Selbsttest, Konsolenfehler, Screenshots aus mehreren Blickwinkeln.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.NC_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.NC_OUT || 'tests/shots';
const GL = process.env.NC_GL || 'gpu';
mkdirSync(OUT, { recursive: true });

const args = ['--no-sandbox', '--window-size=1600,900', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'];
if (GL === 'swiftshader') args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
else args.push('--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan');

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args, defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 } });
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__NC && (window.__NC.ready || window.__NC.error), { timeout: 180000 });
const status = await page.evaluate(() => ({ ready: window.__NC.ready, error: window.__NC.error || null }));
console.log('Start:', status, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (!status.ready) { console.log(logs.join('\n')); await browser.close(); process.exit(1); }
const gl = await page.evaluate(() => {
  const c = document.querySelector('#stage canvas');
  const ctx = c.getContext('webgl2');
  const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
  return dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER);
});
console.log('GPU:', gl);
// Hilfe beim ersten Besuch schließen
await page.keyboard.press('Escape');
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(4000);
const report = await page.evaluate(() => window.__NC.selfTest());
console.log('Selbsttest:', JSON.stringify(report, null, 1));
const fps = await page.evaluate(() => window.__NC.app.core.fps);
console.log('FPS (headless):', fps.toFixed(1));

const shots = (process.env.NC_SHOTS || 'overview,hub,ai,island,plaza,claude,scan,outage').split(',');
for (const s of shots) {
  await page.evaluate(name => {
    const app = window.__NC.app;
    if (app.outage) app.restore(true);
    if (app.scanner.on) app.scanner.toggle(false);
    app.select(null);
    const T = app.core.controls.target.constructor;
    if (name === 'overview') app.resetView();
    if (name === 'hub') app.select({ kind: 'structure', id: 'g301' }, { fly: true });
    if (name === 'ai') app.select({ kind: 'structure', id: 'pve-ai' }, { fly: true });
    if (name === 'island') app.select({ kind: 'district', id: 'd-out' }, { fly: true });
    if (name === 'plaza') app.select({ kind: 'structure', id: 'cluster' }, { fly: true });
    if (name === 'claude') app.select({ kind: 'npc', id: 'claude' });
    if (name === 'scan') { app.resetView(); app.scanner.toggle(true); }
    if (name === 'outage') app.simulate(['pve-node1'], 'Node „Proxmox"');
    void T;
  }, s);
  await wait(s === 'outage' ? 9000 : 4500);
  await page.screenshot({ path: `${OUT}/${s}.png` });
  console.log('Bild:', `${OUT}/${s}.png`);
}
const errs = logs.filter(l => /error|warn/i.test(l));
console.log(`Konsole: ${logs.length} Meldungen, davon ${errs.length} Warnungen/Fehler`);
errs.slice(0, 40).forEach(l => console.log('  ' + l));
await browser.close();
