// Interaktionstest: echte Maus- und Tastatureingaben gegen die laufende Seite.
import puppeteer from 'puppeteer-core';
const URL = process.env.NC_URL || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
const wait = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' – ' + extra : ''}`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__NC && (window.__NC.ready || window.__NC.error), { timeout: 180000 });
await wait(1500);
ok('Hilfe beim ersten Besuch offen', await page.$eval('#help', e => !e.hidden));
await page.keyboard.press('Escape');
ok('Esc schließt Hilfe', await page.$eval('#help', e => e.hidden));
// Klick auf ein Gebäude: Bildschirmposition von hub berechnen
const pt = await page.evaluate(() => {
  const app = window.__NC.app;
  const s = app.city.structures.get('g301');
  const v = s.center.clone(); v.y = Math.min(s.top * 0.5, 12);
  app.core.camera.updateMatrixWorld();
  v.project(app.core.camera);
  return { x: (v.x + 1) / 2 * app.core.width, y: (1 - v.y) / 2 * app.core.height };
});
await page.mouse.move(pt.x, pt.y);
await wait(400);
await page.mouse.click(pt.x, pt.y);
await wait(800);
const sel = await page.evaluate(() => window.__NC.app.sel);
ok('Klick wählt ein Gebäude', !!sel && (sel.kind === 'structure'), JSON.stringify(sel));
ok('Dossier offen', await page.$eval('#dossier', e => !e.hidden), await page.$eval('#d-title', e => e.textContent));
// Verbindung im Dossier anklicken
const clickedEdge = await page.evaluate(() => { const b = document.querySelector('#d-body [data-sel^="edge:"]'); if (!b) return null; b.click(); return b.dataset.sel; });
await wait(600);
ok('Verbindung aus Dossier wählbar', !!clickedEdge && (await page.evaluate(() => window.__NC.app.sel?.kind)) === 'edge', clickedEdge || '');
// Suche
await page.keyboard.press('/');
await wait(300);
ok('Suche öffnet mit /', await page.$eval('#search', e => !e.hidden));
await page.keyboard.type('.216');
await wait(300);
const first = await page.$eval('#search-res button', b => b.textContent);
ok('Suche findet IP .216', /vaultwarden/i.test(first), first.trim().slice(0, 60));
await page.keyboard.press('Enter');
await wait(900);
ok('Enter wählt Treffer', (await page.evaluate(() => window.__NC.app.sel?.id)) === 'g407');
// Menüs
for (const id of ['layers', 'agents', 'findings', 'outage', 'weather', 'view']) {
  await page.click('#tb-' + id);
  await wait(250);
  const n = await page.$$eval('.menu', m => m.length);
  ok(`Menü ${id} öffnet`, n === 1);
  await page.keyboard.press('Escape');
  await wait(150);
}
// Agent folgen über Menü
await page.click('#tb-agents');
await wait(250);
await page.evaluate(() => document.querySelector('.menu [data-r="statusbot"]').click());
await wait(1500);
ok('Agent folgen', (await page.evaluate(() => window.__NC.app.following)) === 'statusbot');
// Ebene umschalten
await page.click('#tb-layers');
await wait(250);
await page.evaluate(() => { const i = document.querySelector('.menu input[data-k="flow"]'); i.click(); });
ok('Ebene Daten & API aus', (await page.evaluate(() => window.__NC.app.flows.layers.flow)) === false);
await page.evaluate(() => { const i = document.querySelector('.menu input[data-k="flow"]'); i.click(); });
ok('Ebene Daten & API wieder an', (await page.evaluate(() => window.__NC.app.flows.layers.flow)) === true);
await page.keyboard.press('Escape');
// Ausfall über Menü
await page.click('#tb-outage');
await wait(250);
await page.evaluate(() => document.querySelector('.menu [data-s="1"]').click());
await wait(5000);
const out = await page.evaluate(() => ({ t: window.__NC.app.outage?.title, down: window.__NC.app.outage?.result.down.size }));
ok('Ausfall AI-Node simuliert', !!out.t, JSON.stringify(out));
const vw = await page.evaluate(() => window.__NC.app.city.structures.get('g407').power);
ok('Vaultwarden dunkel', vw === 0, 'power=' + vw);
await page.evaluate(() => window.__NC.app.restore());
await wait(500);
ok('Strom wieder an', (await page.evaluate(() => window.__NC.app.city.structures.get('g407').power)) === 1);
// Tastatur
await page.keyboard.press('Tab'); await wait(600);
ok('Scanner an (Tab)', await page.evaluate(() => window.__NC.app.scanner.on));
await page.keyboard.press('Tab'); await wait(300);
await page.keyboard.press('k'); await wait(3000);
ok('Kinomodus (K)', await page.evaluate(() => window.__NC.app.cinema.on), await page.$eval('#cap-t', e => e.textContent));
await page.screenshot({ path: 'tests/shots/i-cinema.png' });
await page.keyboard.press('Escape'); await wait(400);
ok('Kinomodus beendet (Esc)', !(await page.evaluate(() => window.__NC.app.cinema.on)));
await page.keyboard.press('p'); await wait(500);
ok('Fotomodus (P)', await page.evaluate(() => document.body.classList.contains('photo')));
await page.click('#photo-shot'); await wait(800);
ok('Aufnahme erzeugt', await page.$eval('#shot-img', i => i.src.startsWith('data:image/png') && i.src.length > 50000));
await page.click('#shot-close'); await page.keyboard.press('Escape'); await wait(300);
await page.keyboard.press('t'); await wait(300);
ok('Ton an (T)', await page.evaluate(() => window.__NC.app.audio.on));
await page.keyboard.press('t');
await page.keyboard.press('x'); await wait(300);
ok('Test-Alarm protokolliert', await page.evaluate(() => window.__NC.app.director.log.some(e => /Test-Alarm/.test(e.text))));
for (const q of ['hoch', 'mittel', 'niedrig', 'ultra']) {
  await page.evaluate(q => window.__NC.app.setQuality(q), q); await wait(700);
}
ok('Qualitätswechsel ohne Fehler', !logs.some(l => /error/i.test(l)));
await page.evaluate(() => window.__NC.app.setWeather('sturm')); await wait(1500);
await page.keyboard.press('b'); await wait(400);
await page.evaluate(() => window.__NC.app.setWeather('regen'));
// Minimap-Klick
const mm = await page.$eval('#minimap-canvas', c => { const r = c.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.8 }; });
const before = await page.evaluate(() => window.__NC.app.core.controls.target.z);
await page.mouse.click(mm.x, mm.y); await wait(1200);
const after = await page.evaluate(() => window.__NC.app.core.controls.target.z);
ok('Minimap-Klick bewegt Kamera', Math.abs(after - before) > 5, `${before.toFixed(0)} → ${after.toFixed(0)}`);
const report = await page.evaluate(() => window.__NC.selfTest());
ok('Selbsttest', report.ok, report.problems.join('; '));
const errs = logs.filter(l => /error|warn/i.test(l));
console.log(`Konsole: ${logs.length} Meldungen, ${errs.length} Warnungen/Fehler`);
errs.slice(0, 60).forEach(l => console.log('  ' + l.slice(0, 300)));
await browser.close();
