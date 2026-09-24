import * as THREE from 'three';
import { U } from './core';
import type { Atlas } from './textures';

/*
 * Materialbibliothek. Fassaden bekommen ihre Fenster im Shader (Weltposition +
 * Flächennormale → Fensterraster); jedes Gebäude hat eigene Uniforms für
 * Belegung, Strom (Blackout) und Akzentfarbe, teilt aber ein Shaderprogramm.
 */

export interface FacadeParams {
  color: THREE.ColorRepresentation;
  seed: number;
  lit: number;          // Anteil beleuchteter Fenster 0..1
  warm?: number;        // Anteil warmer Fenster
  tint?: THREE.ColorRepresentation;
  win?: [number, number];
  band?: number;        // Abstand horizontaler Lichtbänder (0 = keine)
  base?: number;
  height: number;
  roughness?: number;
  metalness?: number;
  vertexColors?: boolean;
  /** Fensterstil: 0 Büro/Glas, 1 Wohnung, 2 Halle, 3 Container */
  style?: number;
}

export interface FacadeUniforms {
  uSeed: { value: number };
  uLit: { value: number };
  uPower: { value: number };
  uWarm: { value: number };
  uBase: { value: number };
  uHeight: { value: number };
  uBand: { value: number };
  uWin: { value: THREE.Vector2 };
  uTint: { value: THREE.Color };
  uStyle: { value: number };
}

const FACADE_VERT_PARS = /* glsl */`
varying vec3 vCityPos;
varying vec3 vCityNrm;
`;
const FACADE_VERT = /* glsl */`
{
  vec4 cwp = vec4(transformed, 1.0);
  vec3 cn = objectNormal;
  #ifdef USE_INSTANCING
    cwp = instanceMatrix * cwp;
    cn = mat3(instanceMatrix) * cn;
  #endif
  cwp = modelMatrix * cwp;
  vCityPos = cwp.xyz;
  vCityNrm = normalize(mat3(modelMatrix) * cn);
}
`;
const FACADE_FRAG_PARS = /* glsl */`
uniform float uTime, uDetail, uRain;
uniform float uSeed, uLit, uPower, uWarm, uBase, uHeight, uBand, uStyle;
uniform vec2 uWin;
uniform vec3 uTint;
varying vec3 vCityPos;
varying vec3 vCityNrm;
float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float cNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), f.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// weiche Masken mit Kantenbreite w (≈ 1 Pixel) gegen Flimmern
float cBand(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
float cBox(vec2 p, vec2 a, vec2 b, vec2 w) { return cBand(p.x, a.x, b.x, w.x) * cBand(p.y, a.y, b.y, w.y); }
float cDisc(vec2 p, vec2 c, float r, float w) { return 1.0 - smoothstep(r - w, r + w, length(p - c)); }
`;
/*
 * Fenster: aus der Ferne flache Leuchtrechtecke (wie bisher, gleiche mittlere
 * Helligkeit). Aus der Nähe (Detailstufe, ab ~10 px je Fensterzelle) echte
 * Fenster: Rahmen und Sprossen, dahinter ein Raum per Interior Mapping – Rück-
 * und Seitenwände, Boden, Decke mit Lampe, Möbel-Silhouetten, leuchtende
 * Monitore, Serverschränke mit blinkenden LEDs, Jalousien und Vorhänge. Die
 * Wand bekommt Geschossdecken, Fensterbänke, Schmutzfahnen und Nässe.
 */
const FACADE_FRAG = /* glsl */`
{
  vec3 N = normalize(vCityNrm);
  float wall = 1.0 - smoothstep(0.3, 0.5, abs(N.y));
  vec2 T = vec2(-N.z, N.x);
  float tl = length(T);
  T = tl > 1e-4 ? T / tl : vec2(1.0, 0.0);
  float u = dot(vCityPos.xz, T);
  float h = vCityPos.y - uBase;
  vec2 cell = vec2(u / uWin.x, h / uWin.y);
  vec2 id = floor(cell);
  vec2 f = fract(cell);
  vec2 fw = max(fwidth(cell), vec2(1e-5));
  float cellPx = 1.0 / max(fw.x, fw.y);
  float det = uDetail * wall * smoothstep(9.0, 22.0, cellPx);
  float face = floor(N.x * 2.0 + 0.5) * 3.0 + floor(N.z * 2.0 + 0.5) * 7.0;
  // Fensteröffnung je Stil als Zellanteile (x0, y0, x1, y1)
  vec4 rc = uStyle < 0.5 ? vec4(0.07, 0.17, 0.93, 0.9)
          : uStyle < 1.5 ? vec4(0.2, 0.26, 0.8, 0.82)
          : uStyle < 2.5 ? vec4(0.12, 0.46, 0.88, 0.9)
          : vec4(0.22, 0.3, 0.78, 0.78);
  float inside = step(0.5, id.y) * step(h, uHeight - uWin.y * 0.55);
  float win = cBox(f, rc.xy, rc.zw, fw) * wall * inside;
  float r = cHash(id + vec2(uSeed * 13.1, face));
  float r2 = cHash(id.yx + vec2(face, uSeed * 7.7));
  float r3 = cHash(id * 1.37 + vec2(uSeed * 3.3, face * 1.9));
  float r4 = cHash(id * 2.11 + vec2(face * 0.7, uSeed * 5.1));
  float on = step(r, uLit);
  float epoch = floor(uTime / 23.0 + r2 * 20.0);
  float toggle = step(0.975, cHash(id + vec2(epoch, face + uSeed)));
  on = abs(on - toggle * step(0.02, uLit));
  float tvRoom = step(0.988, r2) * step(0.02, uLit);
  float tv = tvRoom * (0.55 + 0.45 * sin(uTime * 9.0 + r * 40.0) * sin(uTime * 3.3 + r2 * 20.0));
  vec3 warmC = vec3(1.0, 0.66, 0.36);
  vec3 coolC = vec3(0.5, 0.76, 1.0);
  vec3 wc = mix(coolC, warmC, step(r2, uWarm));
  wc = mix(wc, uTint, step(0.88, r) * step(r, uLit + 0.04));
  float lum = (0.5 + 0.9 * cHash(id * 0.37 + uSeed)) * max(on, tv);
  float area = (rc.z - rc.x) * (rc.w - rc.y);
  vec3 E = win * wc * lum * 1.05 * clamp(0.4 / area, 0.55, 1.2);
  vec3 wallCol = diffuseColor.rgb;
  float glassAmt = win;
  float frameAmt = 0.0;
  if (det > 0.002) {
    vec2 wsz = (rc.zw - rc.xy) * uWin;   // Fenstergröße in m
    vec2 pm = (f - rc.xy) * uWin;         // Position im Fenster in m
    vec2 px = fw * uWin;                  // Meter je Pixel
    float fr = 0.07;
    if (win > 0.001) {
    // Rahmen + Sprossen
    float frame = 1.0 - cBox(pm, vec2(fr), wsz - vec2(fr), px);
    float mw = 0.045;
    float mull = 0.0;
    if (uStyle < 0.5) {
      for (int k = 1; k <= 2; k++) mull = max(mull, 1.0 - smoothstep(mw - px.x, mw + px.x, abs(pm.x - wsz.x * float(k) / 3.0)));
    } else if (uStyle < 1.5) {
      mull = max(1.0 - smoothstep(mw - px.x, mw + px.x, abs(pm.x - wsz.x * 0.5)), 1.0 - smoothstep(mw - px.y, mw + px.y, abs(pm.y - wsz.y * 0.72)));
    } else if (uStyle < 2.5) {
      for (int k = 1; k <= 3; k++) mull = max(mull, 1.0 - smoothstep(mw - px.x, mw + px.x, abs(pm.x - wsz.x * float(k) / 4.0)));
      mull = max(mull, 1.0 - smoothstep(mw - px.y, mw + px.y, abs(pm.y - wsz.y * 0.5)));
    }
    float fm = max(frame, mull) * win;
    // Raum hinter der Zelle: Strahl vom Glas in einen Quader (Interior Mapping)
    vec3 T3 = vec3(T.x, 0.0, T.y);
    vec3 V = normalize(cameraPosition - vCityPos);
    vec3 dir = vec3(-dot(V, T3), -V.y, max(dot(V, N), 0.06));
    vec3 room = vec3(uWin.x, uWin.y, uWin.x * (1.2 + r3 * 0.9));
    vec3 o = vec3(f.x * uWin.x, f.y * uWin.y, 0.0);
    float tx = dir.x > 1e-4 ? (room.x - o.x) / dir.x : (dir.x < -1e-4 ? -o.x / dir.x : 1e4);
    float ty = dir.y > 1e-4 ? (room.y - o.y) / dir.y : (dir.y < -1e-4 ? -o.y / dir.y : 1e4);
    float tz = room.z / dir.z;
    float t = min(min(tx, ty), tz);
    vec3 q = (o + dir * t) / room;
    vec3 tone = mix(vec3(0.62, 0.56, 0.5), vec3(0.42, 0.48, 0.58), r4);
    vec3 col;
    bool isBack = t == tz;
    bool isCeil = t == ty && dir.y > 0.0;
    if (isBack) {
      col = tone * (0.8 + 0.2 * q.y);
      float pic = cBox(q.xy, vec2(0.34 + r3 * 0.1, 0.5), vec2(0.62 + r3 * 0.1, 0.74), max(fwidth(q.xy), vec2(1e-4)));
      col = mix(col, mix(vec3(0.15, 0.2, 0.3), vec3(0.55, 0.25, 0.2), r2), pic * step(0.45, r4));
    } else if (t == ty) {
      col = isCeil ? tone * 1.15 : tone * vec3(0.45, 0.4, 0.38);
    } else {
      col = tone * 0.78;
    }
    float depthK = 1.0 - 0.55 * clamp(q.z, 0.0, 1.0);
    vec2 lq = q.xz - vec2(0.5, 0.45);
    float lamp = isCeil ? exp(-dot(lq, lq) * 30.0) * 2.2 : 0.0;
    vec3 L = wc * lum;
    vec3 tvC = vec3(0.35, 0.55, 1.0) * tv * (1.0 - on);
    vec3 roomE = col * (L * (depthK + lamp) + tvC * depthK * 1.4) + col * vec3(0.012, 0.014, 0.022);
    // Möbel auf einer Ebene mitten im Raum
    float zp = room.z * (0.42 + r4 * 0.3);
    float tp = zp / dir.z;
    if (tp < t) {
      vec2 pp = (o.xy + dir.xy * tp) / room.xy;
      vec2 pw = max(fwidth(pp), vec2(1e-4));
      float ax = room.x / room.y;
      vec2 pa = pp * vec2(ax, 1.0);
      float kind = floor(r3 * 8.0);
      float sil = 0.0;
      vec3 glow = vec3(0.0);
      float lit = step(0.5, max(on, tvRoom));
      if (uStyle < 0.5 || uStyle > 2.5) {
        if (kind < 3.0) {
          // Schreibtisch mit Monitor
          sil = max(cBox(pp, vec2(0.14, 0.26), vec2(0.86, 0.3), pw), max(cBox(pp, vec2(0.17, 0.0), vec2(0.2, 0.26), pw), cBox(pp, vec2(0.8, 0.0), vec2(0.83, 0.26), pw)));
          sil = max(sil, cBox(pp, vec2(0.485, 0.3), vec2(0.515, 0.34), pw));
          float scr = cBox(pp, vec2(0.37, 0.34), vec2(0.63, 0.52), pw);
          glow += mix(vec3(0.4, 0.9, 1.0), vec3(0.55, 1.0, 0.65), step(0.5, r2)) * scr * (0.85 + 0.15 * sin(uTime * 2.0 + r * 30.0)) * lit * 1.3;
          sil = max(sil, scr);
        } else if (kind < 4.0) {
          // Person
          float cx = 0.35 + r2 * 0.3;
          sil = max(cDisc(pa, vec2(cx * ax, 0.66), 0.065, pw.y), cBox(pp, vec2(cx - 0.1, 0.18), vec2(cx + 0.1, 0.6), pw));
        } else if (kind < 5.0) {
          // Serverschrank mit LEDs
          sil = cBox(pp, vec2(0.3, 0.0), vec2(0.7, 0.9), pw);
          vec2 lc = pp * vec2(10.0, 24.0);
          vec2 lf = fract(lc);
          float ledOn = step(0.55, cHash(floor(lc) + floor(uTime * (1.2 + r * 3.0))));
          float led = step(0.35, lf.x) * step(lf.x, 0.65) * step(0.4, lf.y) * step(lf.y, 0.6) * step(0.33, pp.x) * step(pp.x, 0.67) * step(pp.y, 0.86);
          glow += mix(vec3(0.2, 1.0, 0.45), vec3(1.0, 0.6, 0.1), step(0.85, cHash(floor(lc) + 3.0))) * led * ledOn * 1.8 * lit * smoothstep(0.08, 0.03, pw.x);
        } else if (kind < 6.0) {
          // Pflanze
          sil = max(cBox(pp, vec2(0.72, 0.0), vec2(0.84, 0.12), pw), cDisc(pa, vec2(0.78 * ax, 0.28), 0.12, pw.y));
        }
      } else if (uStyle < 1.5) {
        if (kind < 2.0) {
          // Sofa
          sil = max(cBox(pp, vec2(0.08, 0.0), vec2(0.92, 0.2), pw), cBox(pp, vec2(0.08, 0.2), vec2(0.92, 0.33), pw) * 0.9);
        } else if (kind < 3.0) {
          float cx = 0.35 + r2 * 0.3;
          sil = max(cDisc(pa, vec2(cx * ax, 0.66), 0.065, pw.y), cBox(pp, vec2(cx - 0.1, 0.18), vec2(cx + 0.1, 0.6), pw));
        } else if (kind < 4.0) {
          sil = max(cBox(pp, vec2(0.14, 0.0), vec2(0.26, 0.12), pw), cDisc(pa, vec2(0.2 * ax, 0.3), 0.14, pw.y));
        } else if (kind < 5.0) {
          // Regal
          sil = cBox(pp, vec2(0.6, 0.0), vec2(0.9, 0.72), pw) * (0.75 + 0.25 * step(0.5, fract(pp.y * 8.0)));
        }
      } else {
        // Halle: Regale mit Kisten
        if (kind < 4.0) sil = cBox(pp, vec2(0.05, 0.0), vec2(0.95, 0.55), pw) * (0.7 + 0.3 * step(0.5, fract(pp.x * 6.0)));
      }
      vec3 silC = col * 0.12 * (L + tvC) + vec3(0.004, 0.005, 0.008);
      roomE = mix(roomE, silC, clamp(sil, 0.0, 1.0)) + glow;
    }
    // Neonrahmen an der Rückwand mancher Räume
    if (isBack && r4 > 0.93 && on > 0.5) {
      vec2 qw = max(fwidth(q.xy), vec2(1e-4));
      float ring = cBox(q.xy, vec2(0.28, 0.52), vec2(0.72, 0.78), qw) - cBox(q.xy, vec2(0.3, 0.545), vec2(0.7, 0.755), qw);
      roomE += uTint * max(ring, 0.0) * 2.5;
    }
    // Jalousien oder Vorhänge direkt hinter dem Glas
    vec2 wf = pm / wsz;
    float blindP = uStyle < 0.5 ? 0.42 : uStyle < 1.5 ? 0.22 : uStyle < 2.5 ? 0.0 : 0.3;
    float curtP = uStyle < 0.5 ? 0.05 : uStyle < 1.5 ? 0.55 : uStyle < 2.5 ? 0.0 : 0.3;
    float rb = cHash(id * 3.7 + vec2(uSeed, face));
    vec3 Lb = L + tvC;
    if (rb < blindP) {
      float cover = 0.2 + cHash(id * 5.3 + face) * 0.8;
      float bm = smoothstep(1.0 - cover - px.y / wsz.y, 1.0 - cover + px.y / wsz.y, wf.y);
      float slat = 0.5 + 0.5 * sin(pm.y * 69.8);
      slat = mix(0.5, slat, smoothstep(0.05, 0.02, px.y));
      roomE = mix(roomE, Lb * (0.32 + 0.3 * slat) + vec3(0.01, 0.012, 0.018) * slat, bm);
    } else if (rb < blindP + curtP) {
      float cw = 0.14 + cHash(id * 7.1 + face) * 0.28;
      float cm = 1.0 - cBand(wf.x, cw, 1.0 - cw, px.x / wsz.x);
      vec3 cc = mix(vec3(0.9, 0.35, 0.3), vec3(0.35, 0.5, 0.9), cHash(id * 9.7 + uSeed));
      float fold = mix(0.8, 0.65 + 0.35 * sin(pm.x * 26.0), smoothstep(0.08, 0.03, px.x));
      roomE = mix(roomE, cc * Lb * 0.55 * fold + cc * 0.004, cm);
    }
    // Laibung: am Rahmen fällt weniger Licht ins Glas (Tiefe)
    float edgeD = min(min(pm.x, wsz.x - pm.x), min(pm.y, wsz.y - pm.y));
    roomE *= mix(0.55, 1.0, smoothstep(fr, fr + 0.22, edgeD));
    vec3 detE = roomE * win * (1.0 - fm) * 1.6;
    E = mix(E, detE, det);
    frameAmt = fm * det;
    glassAmt = win * (1.0 - fm * det);
    }
    // Wand: Geschossdecke, Fensterbank, Schmutzfahnen unter den Fenstern, Paneele
    float slab = 1.0 - smoothstep(0.075 - fw.y, 0.075 + fw.y, f.y);
    float sill = cBox(f, vec2(rc.x - 0.02, rc.y - 0.035), vec2(rc.z + 0.02, rc.y), fw) * inside;
    float under = cBand(f.x, rc.x, rc.z, fw.x) * (1.0 - smoothstep(0.0, rc.y, f.y));
    float streak = under * smoothstep(0.35, 0.9, cNoise(vec2(pm.x * 7.0 + id.x * 13.0, id.y))) * 0.35;
    float panel = 0.9 + 0.2 * cHash(id + vec2(0.5, uSeed));
    wallCol = mix(wallCol, wallCol * panel * (1.0 + slab * 0.3 + sill * 0.45) * (1.0 - streak), det);
  }
  // nasse Wand bei Regen, dunklerer Sockel am Boden
  float wetK = min(uRain, 1.0) * 0.5 * wall;
  wallCol *= mix(1.0, 0.82, wetK) * mix(0.62, 1.0, smoothstep(0.0, 2.6, vCityPos.y));
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.6, wetK);
  diffuseColor.rgb = wallCol;
  totalEmissiveRadiance += E * uPower;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.010, 0.013, 0.024), glassAmt * 0.9);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.05, 0.06), frameAmt);
  roughnessFactor = mix(roughnessFactor, 0.1, glassAmt);
  roughnessFactor = mix(roughnessFactor, 0.38, frameAmt);
  metalnessFactor = mix(metalnessFactor, 0.75, glassAmt);
  metalnessFactor = mix(metalnessFactor, 0.85, frameAmt);
  if (uBand > 0.0) {
    float bh = fract(h / uBand);
    float bandL = (1.0 - smoothstep(0.0, 0.03, abs(bh - 0.5))) * wall * step(3.0, h) * step(h, uHeight - 1.5);
    totalEmissiveRadiance += bandL * uTint * 1.8 * uPower;
  }
}
`;

function injectFacade(shader: THREE.WebGLProgramParametersWithUniforms, u: FacadeUniforms) {
  Object.assign(shader.uniforms, u, { uTime: U.uTime, uDetail: U.uDetail, uRain: U.uRain });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + FACADE_VERT_PARS)
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + FACADE_VERT);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FACADE_FRAG_PARS)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FACADE_FRAG);
}

export function facadeMaterial(p: FacadeParams): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: p.color,
    roughness: p.roughness ?? 0.58,
    metalness: p.metalness ?? 0.35,
    vertexColors: !!p.vertexColors,
    envMapIntensity: 1.0
  });
  const u: FacadeUniforms = {
    uSeed: { value: p.seed },
    uLit: { value: p.lit },
    uPower: { value: 1 },
    uWarm: { value: p.warm ?? 0.55 },
    uBase: { value: p.base ?? 0 },
    uHeight: { value: p.height },
    uBand: { value: p.band ?? 0 },
    uWin: { value: new THREE.Vector2(...(p.win ?? [1.7, 2.6])) },
    uTint: { value: new THREE.Color(p.tint ?? '#ff3fa4') },
    uStyle: { value: p.style ?? 0 }
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (shader) => injectFacade(shader, u);
  mat.customProgramCacheKey = () => 'nc-facade-3';
  return mat;
}

/* ------------------------------------------------------------------ */

/** Leuchtfarbe (Neonröhren, Streifen, Lampen) – mit Helligkeit > 1 für Bloom */
export function neon(color: THREE.ColorRepresentation, intensity = 3, opts: { fog?: boolean; transparent?: boolean; opacity?: number } = {}): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const m = new THREE.MeshBasicMaterial({ color: c, fog: opts.fog ?? true, transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1 });
  m.userData.base = c.clone();
  return m;
}

export function setPower(m: THREE.Material | THREE.Material[], power: number) {
  const list = Array.isArray(m) ? m : [m];
  list.forEach(mat => {
    const u = mat.userData.u as FacadeUniforms | undefined;
    if (u) u.uPower.value = power;
    const base = mat.userData.base as THREE.Color | undefined;
    if (base && (mat as THREE.MeshBasicMaterial).color) (mat as THREE.MeshBasicMaterial).color.copy(base).multiplyScalar(power);
    const hu = (mat as THREE.ShaderMaterial).uniforms?.uPower;
    if (hu) hu.value = power;
  });
}

/* ------------------------------------------------------------------ */
/* Hologramm                                                            */
/* ------------------------------------------------------------------ */

export function holoMaterial(color: THREE.ColorRepresentation, opts: { opacity?: number; density?: number; speed?: number } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.uTime,
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opts.opacity ?? 0.9 },
      uDensity: { value: opts.density ?? 2.2 },
      uSpeed: { value: opts.speed ?? 1.2 },
      uPower: { value: 1 }
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        #ifdef USE_INSTANCING
          wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #endif
        vW = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vV = mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uOpacity, uDensity, uSpeed, uPower;
      uniform vec3 uColor;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(-vV))), 2.2);
        float scan = 0.55 + 0.45 * step(0.45, fract(vW.y * uDensity - uTime * uSpeed));
        float flick = 0.86 + 0.14 * sin(uTime * 31.0 + vW.y * 3.0) * sin(uTime * 7.0);
        float glitch = step(0.985, fract(sin(floor(uTime * 12.0) * 91.7) * 437.5)) * 0.6;
        vec3 c = uColor * (0.35 + fres * 1.6) * scan * (flick + glitch) * 1.6 * uPower;
        gl_FragColor = vec4(c * uOpacity, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
}

/* ------------------------------------------------------------------ */
/* Schilder aus dem Atlas                                              */
/* ------------------------------------------------------------------ */

const SIGN_VERT = /* glsl */`
  attribute vec3 aCol;
  attribute vec2 aFx;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vFog;
  void main() {
    vUv = uv;
    float f = 1.0;
    if (aFx.x > 0.5 && aFx.x < 1.5) {
      float t = uTime * 7.0 + aFx.y * 13.0;
      float n = fract(sin(floor(t) * 12.9898 + aFx.y * 78.233) * 43758.5453);
      f = n > 0.78 ? 0.08 : (n > 0.7 ? 0.5 : 1.0);
    } else if (aFx.x > 1.5 && aFx.x < 2.5) {
      f = 0.72 + 0.28 * sin(uTime * 2.2 + aFx.y * 6.2831);
    } else if (aFx.x > 2.5) {
      f = step(0.5, fract(uTime * 1.1 + aFx.y));
    }
    vCol = aCol * f;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFog = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const SIGN_FRAG = /* glsl */`
  uniform sampler2D map;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vFog;
  void main() {
    vec4 t = texture2D(map, vUv);
    if (t.a < 0.02) discard;
    vec3 c = t.rgb * vCol;
    // Rückseite: dunkles Blech statt Spiegelschrift
    if (!gl_FrontFacing) c = vec3(0.018, 0.02, 0.028) * t.a;
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * vFog * vFog * 0.55);
    c = mix(c, uFogColor * 0.6, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(c, t.a);
    #include <colorspace_fragment>
  }`;

/** Material je Atlasseite; additive Variante für freie Leuchtschrift */
export class SignMaterials {
  private cache = new Map<string, THREE.ShaderMaterial>();
  constructor(private atlas: Atlas) {}
  get(page: number, additive: boolean): THREE.ShaderMaterial {
    const k = page + (additive ? 'a' : 'n');
    let m = this.cache.get(k);
    if (!m) {
      m = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: this.atlas.pages[page].tex },
          uTime: U.uTime,
          uFogColor: U.uFogColor,
          uFogDensity: U.uFogDensity
        },
        vertexShader: SIGN_VERT,
        fragmentShader: SIGN_FRAG,
        transparent: true,
        depthWrite: !additive,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
      });
      this.cache.set(k, m);
    }
    return m;
  }
}

/* ------------------------------------------------------------------ */
/* Oberflächendetail (Weltraum-Rauschen, Bahnen, Pfützen, Regenringe)  */
/* ------------------------------------------------------------------ */

/** 1 Schmutz/Patina · 2 Dach · 3 Asphalt · 4 Gehwegplatten */
export type SurfaceMode = 1 | 2 | 3 | 4;

const SURF_VERT_PARS = /* glsl */`
varying vec3 vSurfPos;
varying vec3 vSurfNrm;
`;
const SURF_VERT = /* glsl */`
{
  vec4 swp = vec4(transformed, 1.0);
  vec3 sn = objectNormal;
  #ifdef USE_INSTANCING
    swp = instanceMatrix * swp;
    sn = mat3(instanceMatrix) * sn;
  #endif
  swp = modelMatrix * swp;
  vSurfPos = swp.xyz;
  vSurfNrm = normalize(mat3(modelMatrix) * sn);
}
`;
const SURF_FRAG_PARS = /* glsl */`
uniform float uTime, uDetail, uRain;
varying vec3 vSurfPos;
varying vec3 vSurfNrm;
float sHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float sNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), f.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float sFbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * sNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
// Regenringe: xy = Richtung (für die Normale), z = Stärke
vec3 sRipple(vec2 p, float t) {
  vec2 g = floor(p * 1.3);
  vec2 f = fract(p * 1.3) - 0.5;
  float h = sHash(g);
  float ph = fract(t * 0.85 + h * 7.0);
  float r = length(f);
  float ring = smoothstep(0.06, 0.0, abs(r - ph * 0.46)) * (1.0 - ph) * step(0.3, sHash(g + 2.1));
  vec2 d = r > 1e-3 ? f / r : vec2(0.0);
  return vec3(d * ring, ring);
}
`;
const SURF_FRAG = /* glsl */`
{
  vec3 Nw = normalize(vSurfNrm);
  vec3 P = vSurfPos;
  float up = smoothstep(0.6, 0.9, Nw.y);
  vec2 sp = up > 0.5 ? P.xz : (abs(Nw.x) > abs(Nw.z) ? P.zy : P.xy);
  float n1 = sFbm(sp * 0.9);
  float n2 = sNoise(sp * 7.3);
  float wet = min(uRain, 1.0) * uDetail;
  float puddle = 0.0;
  vec3 dcol = diffuseColor.rgb;
  float rough = roughnessFactor;
  #if SURF_MODE == 1
    // Patina, Schlieren an senkrechten Flächen
    float grime = mix(0.78, 1.12, n1) * mix(0.93, 1.05, n2);
    float runs = (1.0 - up) * smoothstep(0.55, 0.95, sNoise(vec2(sp.x * 3.1, sp.y * 0.25))) * 0.22;
    dcol *= grime * (1.0 - runs);
    rough *= 0.8 + 0.4 * n1;
    rough = mix(rough, rough * 0.65, wet * 0.6);
  #elif SURF_MODE == 2
    // Dachbahnen mit Nähten, Kies-/Teerflecken, Pfützen
    float fx = fwidth(P.x) + 1e-4;
    float sx = abs(fract(P.x / 1.6 + 0.5) - 0.5) * 1.6;
    float seam = (1.0 - smoothstep(0.02 - fx, 0.02 + fx, sx)) * up;
    float tar = smoothstep(0.55, 0.75, sFbm(P.xz * 0.45 + 9.0)) * up;
    dcol *= mix(0.8, 1.15, n1) * mix(0.9, 1.06, n2) * (1.0 - seam * 0.3) * (1.0 - tar * 0.35);
    rough = mix(rough, 0.55, seam);
    puddle = smoothstep(0.6, 0.67, sFbm(P.xz * 0.32 + 3.7)) * up;
  #elif SURF_MODE == 3
    // Asphalt: Risse, Flickstellen, Ölflecken, große Pfützen
    float crack = (1.0 - smoothstep(0.0, 0.035, abs(sNoise(P.xz * 0.9) - 0.5))) * smoothstep(0.45, 0.6, sNoise(P.xz * 0.21 + 5.0));
    float patchK = step(0.72, sNoise(floor(P.xz / 3.2) * 1.7 + 2.0)) * 0.12;
    float oil = smoothstep(0.62, 0.8, sFbm(P.xz * 0.6 + 1.3)) * 0.35;
    dcol *= mix(0.86, 1.1, n1) * (1.0 - crack * 0.55) * (1.0 - patchK) * (1.0 - oil);
    rough = mix(rough, rough * 0.55, wet * 0.75);
    puddle = smoothstep(0.58, 0.64, sFbm(P.xz * 0.11 + 3.7)) * up;
  #elif SURF_MODE == 4
    // Gehwegplatten mit Fugen
    vec2 tq = P.xz / 0.75;
    vec2 tf = abs(fract(tq) - 0.5);
    vec2 tw = fwidth(tq) + 1e-4;
    float joint = (1.0 - smoothstep(0.03 - tw.x, 0.03 + tw.x, 0.5 - tf.x)) + (1.0 - smoothstep(0.03 - tw.y, 0.03 + tw.y, 0.5 - tf.y));
    float tile = 0.9 + 0.2 * sHash(floor(tq));
    dcol *= tile * mix(0.9, 1.05, n1) * (1.0 - clamp(joint, 0.0, 1.0) * 0.45 * up);
    rough = mix(rough, rough * 0.6, wet * 0.7);
    puddle = smoothstep(0.64, 0.7, sFbm(P.xz * 0.28 + 7.7)) * up;
  #endif
  puddle *= wet;
  dcol = mix(dcol, dcol * 0.38, puddle);
  rough = mix(rough, 0.04, puddle);
  metalnessFactor = mix(metalnessFactor, 0.0, puddle);
  diffuseColor.rgb = mix(diffuseColor.rgb, dcol, uDetail);
  roughnessFactor = clamp(mix(roughnessFactor, rough, uDetail), 0.03, 1.0);
  // Regenringe kräuseln die Pfützen (Normale im Blickraum)
  if (puddle > 0.01) {
    vec3 rp = sRipple(P.xz, uTime);
    normal = normalize(normal + (viewMatrix * vec4(rp.x, 0.0, rp.y, 0.0)).xyz * 0.9 * puddle);
    roughnessFactor = mix(roughnessFactor, 0.22, rp.z * puddle);
  }
}
`;

/** Weltraum-Details in ein Standardmaterial einsetzen (bleibt nach clone() per applySurface erhalten) */
export function applySurface<T extends THREE.MeshStandardMaterial>(mat: T, mode: SurfaceMode): T {
  mat.userData.surfMode = mode;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime: U.uTime, uDetail: U.uDetail, uRain: U.uRain });
    shader.defines = { ...(shader.defines || {}), SURF_MODE: mode };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + SURF_VERT_PARS)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + SURF_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SURF_FRAG_PARS)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + SURF_FRAG);
  };
  mat.customProgramCacheKey = () => 'nc-surf-' + mode;
  return mat;
}

/** Kopie mit Detailshader (clone() übernimmt onBeforeCompile nicht) */
export function cloneSurface<T extends THREE.Material>(mat: T): T {
  const own = mat.clone();
  const mode = mat.userData.surfMode as SurfaceMode | undefined;
  if (mode && own instanceof THREE.MeshStandardMaterial) applySurface(own, mode);
  return own;
}

/* ------------------------------------------------------------------ */
/* Gemeinsame Grundmaterialien                                        */
/* ------------------------------------------------------------------ */

export const MAT = {
  metal: applySurface(new THREE.MeshStandardMaterial({ color: '#2a3140', roughness: 0.45, metalness: 0.8 }), 1),
  darkMetal: applySurface(new THREE.MeshStandardMaterial({ color: '#12161f', roughness: 0.5, metalness: 0.75 }), 1),
  concrete: applySurface(new THREE.MeshStandardMaterial({ color: '#3a3f4a', roughness: 0.85, metalness: 0.05 }), 1),
  roof: applySurface(new THREE.MeshStandardMaterial({ color: '#171b24', roughness: 0.8, metalness: 0.2 }), 2),
  glass: new THREE.MeshStandardMaterial({ color: '#0b1220', roughness: 0.08, metalness: 0.9, envMapIntensity: 1.6 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#0c0d10', roughness: 0.9, metalness: 0.0 }),
  plant: new THREE.MeshStandardMaterial({ color: '#0f2a22', roughness: 0.9, metalness: 0.0, emissive: '#0a3b2c', emissiveIntensity: 0.6 }),
  vertex: applySurface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }), 1)
};
