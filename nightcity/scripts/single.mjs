// Einzeldatei-Build: JS und CSS aus dist/ in eine HTML-Datei ziehen.
//  - dist-single/index.html   eigenständige Seite (LAN, CT 201 /stadt/)
//  - dist-single/artifact.html  ohne html/head/body-Hülle (Artifact-Skelett liefert sie)
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const html = readFileSync('dist/index.html', 'utf8');
const assets = readdirSync('dist/assets');
const js = assets.find(f => f.endsWith('.js'));
const css = assets.find(f => f.endsWith('.css'));
if (!js || !css) throw new Error('Build unvollständig: ' + assets.join(', '));
let code = readFileSync('dist/assets/' + js, 'utf8');
const style = readFileSync('dist/assets/' + css, 'utf8');
const hits = (code.match(/<\/script/gi) || []).length;
if (hits) code = code.replace(/<\/script/gi, '<\\/script');
let out = html
  .replace(/<script type="module" crossorigin src="[^"]+"><\/script>\s*/, '')
  .replace(/<link rel="stylesheet" crossorigin href="[^"]+">/, () => `<style>\n${style}\n</style>`)
  .replace('</body>', () => `<script type="module">\n${code}\n</script>\n</body>`);
if (out.includes('/assets/')) throw new Error('Asset-Verweis übrig');
mkdirSync('dist-single', { recursive: true });
writeFileSync('dist-single/index.html', out);
// Artifact: Titel, Stil und Inhalt ohne Hülle; Charset/Viewport liefert das Skelett
const title = out.match(/<title>[\s\S]*?<\/title>/)[0];
const desc = out.match(/<meta name="description"[^>]*>/)?.[0] || '';
const fonts = (out.match(/<link rel="(?:preconnect|stylesheet)"[^>]*>/g) || []).filter(l => /fonts\.(googleapis|gstatic)\.com/.test(l)).join('\n');
const styleTag = out.match(/<style>[\s\S]*?<\/style>/)[0];
const body = out.match(/<body>([\s\S]*)<\/body>/)[1];
const art = [title, desc, fonts, styleTag, body.trim()].join('\n');
writeFileSync('dist-single/artifact.html', art);
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
console.log(`index.html ${(out.length / 1024).toFixed(0)} KB · sha256 ${sha(out)} · </script im Code ersetzt: ${hits}`);
console.log(`artifact.html ${(art.length / 1024).toFixed(0)} KB · sha256 ${sha(art)}`);
