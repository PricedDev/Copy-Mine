// Gezielte Einzelprüfungen: führt JS-Schritte im Browser aus und macht nach jedem ein Bild.
import puppeteer from 'puppeteer-core';
const URL = process.env.NC_URL || 'http://127.0.0.1:4173/';
const steps = JSON.parse(process.argv[2] || '[]'); // [{name, js, wait}]
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--hide-scrollbars', '--mute-audio'], defaultViewport: { width: +(process.env.W || 1600), height: +(process.env.H || 900), deviceScaleFactor: 1 } });
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__NC && (window.__NC.ready || window.__NC.error), { timeout: 180000 });
await page.keyboard.press('Escape');
const wait = ms => new Promise(r => setTimeout(r, ms));
for (const s of steps) {
  const out = await page.evaluate(new Function('return (async () => {' + s.js + '})()'));
  if (out !== undefined) console.log(s.name, '→', typeof out === 'string' ? out : JSON.stringify(out));
  await wait(s.wait ?? 3000);
  if (s.shot !== false) { await page.screenshot({ path: `tests/shots/${s.name}.png` }); console.log('Bild:', s.name); }
}
const errs = logs.filter(l => /error|warn/i.test(l));
console.log(`Konsole: ${logs.length} Meldungen, ${errs.length} Warnungen/Fehler`);
errs.slice(0, 30).forEach(l => console.log('  ' + l));
await browser.close();
