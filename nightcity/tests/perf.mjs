// Leistungsmessung je Qualitätsstufe: Gesamtansicht und Nahansicht, je 8 s Mittelwert.
import puppeteer from 'puppeteer-core';
const URL = process.env.NC_URL || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--hide-scrollbars', '--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync'], defaultViewport: { width: 1920, height: 1080 } });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__NC && window.__NC.ready, { timeout: 180000 });
await page.keyboard.press('Escape');
const wait = ms => new Promise(r => setTimeout(r, ms));
await page.evaluate(() => {
  window.__frames = [];
  const tick = t => { window.__frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const measure = async ms => {
  await page.evaluate(() => { window.__frames = []; });
  await wait(ms);
  return page.evaluate(() => {
    const f = window.__frames;
    if (f.length < 2) return { fps: 0, p95: 0 };
    const d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
    d.sort((a, b) => a - b);
    return { fps: 1000 / (d.reduce((a, b) => a + b, 0) / d.length), p95: d[Math.floor(d.length * 0.95)] };
  });
};
for (const q of (process.env.ORDER || 'ultra,hoch,mittel,niedrig').split(',')) {
  for (const view of ['gesamt', 'nah']) {
    await page.evaluate((q, view) => {
      const a = window.__NC.app;
      a.setQuality(q);
      a.select(null);
      if (view === 'gesamt') a.resetView(); else a.select({ kind: 'structure', id: 'g301' }, { fly: true });
    }, q, view);
    await wait(3500);
    const m = await measure(8000);
    const info = await page.evaluate(() => { const r = window.__NC.app.core.renderer; return { calls: r.info.render.calls, tris: r.info.render.triangles }; });
    console.log(`${q.padEnd(8)} ${view.padEnd(7)} ${m.fps.toFixed(1).padStart(5)} FPS · p95 ${m.p95.toFixed(1)} ms`);
    void info;
  }
}
await browser.close();
