import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { plan } from '../layout/plan';

/*
 * Grafikkern: Renderer, 2.5D-Kamera (flache Telebrennweite, begrenzter
 * Neigungswinkel), Kartensteuerung, Nachbearbeitung (Bloom, Grading,
 * Scanner) und die Bildschleife, in die sich alle Module einhängen.
 */

export type Quality = 'ultra' | 'hoch' | 'mittel' | 'niedrig';

export interface QualitySpec {
  label: string;
  /** Obergrenze der Renderauflösung (× CSS-Pixel) */
  pixelRatio: number;
  /** Untergrenze: > Bildschirm-DPR heißt Supersampling */
  minRatio: number;
  shadows: boolean;
  reflections: boolean;
  reflectScale: number;
  bloom: boolean;
  rain: number;
  msaa: number;
  /** Detailstufe der Fassaden/Oberflächen (Innenräume, Rahmen, Pfützen …) */
  detail: boolean;
}

export const QUALITY: Record<Quality, QualitySpec> = {
  ultra: { label: 'Ultra', pixelRatio: 2, minRatio: 1.5, shadows: true, reflections: true, reflectScale: 0.7, bloom: true, rain: 14000, msaa: 4, detail: true },
  hoch: { label: 'Hoch', pixelRatio: 2, minRatio: 0, shadows: true, reflections: true, reflectScale: 0.6, bloom: true, rain: 12000, msaa: 4, detail: true },
  mittel: { label: 'Mittel', pixelRatio: 1, minRatio: 0, shadows: false, reflections: false, reflectScale: 0.35, bloom: true, rain: 5000, msaa: 0, detail: false },
  niedrig: { label: 'Niedrig', pixelRatio: 0.75, minRatio: 0, shadows: false, reflections: false, reflectScale: 0.25, bloom: false, rain: 2000, msaa: 0, detail: false }
};

export type UpdateFn = (dt: number, t: number) => void;

/** Ebene für Dinge, die das Hafenwasser nicht spiegeln muss (Regen, Partikel, NPCs …) */
export const NO_REFLECT = 1;

export function noReflect(o: THREE.Object3D) {
  o.traverse(x => x.layers.set(NO_REFLECT));
}

/** Globale Shader-Uniforms (von allen Materialien geteilt) */
export const U = {
  uTime: { value: 0 },
  uRain: { value: 1 },
  uWet: { value: 1 },
  uFogColor: { value: new THREE.Color('#0b0818') },
  uFogDensity: { value: 0.0016 },
  uScan: { value: 0 },
  /** 1 = Detailstufe an (Innenräume, Rahmen, Pfützen …), gesetzt je Qualitätsstufe */
  uDetail: { value: 1 }
};

const GradeShader = {
  name: 'NightCityGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.04 },
    uCA: { value: 0.0012 },
    uScan: { value: 0 },
    uScanPhase: { value: 0 },
    uFlash: { value: 0 },
    uFade: { value: 0 },
    uLetterbox: { value: 0 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uCA, uScan, uScanPhase, uFlash, uFade, uLetterbox;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uCA * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      if (uScan > 0.001) {
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        vec3 sc = vec3(1.0, 0.36, 0.12) * pow(l, 0.8) * 1.6 + vec3(0.03, 0.005, 0.0);
        float grid = step(0.985, fract(uv.y * uRes.y / 3.0)) * 0.08;
        float sweep = exp(-abs(uv.y - uScanPhase) * 60.0) * 0.9;
        sc += vec3(1.0, 0.45, 0.12) * (grid + sweep * 0.35);
        col = mix(col, sc, uScan * 0.82);
      }
      col += uFlash * vec3(0.55, 0.65, 1.0) * 0.35;
      col *= 1.0 - uVignette * smoothstep(0.08, 0.55, r2 * 1.6);
      col *= 1.0 + (hash(uv * uRes + fract(uTime) * 91.7) - 0.5) * uGrain;
      col *= 1.0 - uFade;
      float lb = step(uv.y, uLetterbox) + step(1.0 - uLetterbox, uv.y);
      col = mix(col, vec3(0.0), lb);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`
};

interface Flight {
  from: { t: THREE.Vector3; d: number; p: number; a: number };
  to: { t: THREE.Vector3; d: number; p: number; a: number };
  start: number;
  dur: number;
  done?: () => void;
}

export class Core {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly grade: ShaderPass;
  readonly timer = new THREE.Timer();
  quality: Quality = 'ultra';
  spec: QualitySpec = QUALITY.ultra;
  private updates: UpdateFn[] = [];
  private qualityHooks: Array<(q: QualitySpec) => void> = [];
  private flight: Flight | null = null;
  private userMoved: Array<() => void> = [];
  width = 1;
  height = 1;
  frame = 0;
  paused = false;
  fps = 60;
  private fpsAcc = 0;
  private fpsN = 0;
  private shadowAcc = 0;

  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false, stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // die Stadt steht still – Schatten reichen zweimal pro Sekunde
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setClearColor(0x05060d, 1);
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', 'Night City Homelab – 2.5D-Stadtansicht der Homelab-Topologie');

    this.scene.fog = new THREE.FogExp2(U.uFogColor.value, U.uFogDensity.value);

    this.camera = new THREE.PerspectiveCamera(26, 1, 2, 9000);
    this.camera.layers.enable(NO_REFLECT);
    const c = plan.center;
    const t0 = new THREE.Vector3(c.x, 0, (plan.bounds.z0 + plan.islandBounds.z1) / 2);
    this.camera.position.copy(t0).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(700, 0.95, 0)));

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(t0);
    this.controls.enableDamping = true;
    // knapper Nachlauf: die Kamera gleitet nicht verschmiert weiter
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 35;
    this.controls.maxDistance = 1250;
    this.controls.minPolarAngle = 0.3;
    this.controls.maxPolarAngle = 1.22;
    this.controls.zoomSpeed = 1.1;
    this.controls.rotateSpeed = 0.55;
    this.controls.panSpeed = 1.0;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('start', () => {
      if (this.flight) this.flight = null;
      this.userMoved.forEach(f => f());
    });

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.62, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.timer.connect(document);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  onUpdate(fn: UpdateFn) {
    this.updates.push(fn);
  }

  onQuality(fn: (q: QualitySpec) => void) {
    this.qualityHooks.push(fn);
    fn(this.spec);
  }

  onUserMove(fn: () => void) {
    this.userMoved.push(fn);
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.spec = QUALITY[q];
    const pr = this.pixelRatioFor(this.spec);
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    U.uDetail.value = this.spec.detail ? 1 : 0;
    this.bloom.enabled = this.spec.bloom;
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2] as THREE.WebGLRenderTarget[]) {
      if (target.samples !== this.spec.msaa) {
        target.samples = this.spec.msaa;
        target.dispose();
      }
    }
    this.resize();
    this.qualityHooks.forEach(f => f(this.spec));
  }

  /** Renderauflösung: Bildschirm-DPR, auf Ultra mindestens 1,5 (Supersampling), höchstens pixelRatio */
  pixelRatioFor(spec: QualitySpec): number {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(Math.max(dpr, spec.minRatio), spec.pixelRatio);
  }

  resize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    (this.grade.uniforms.uRes.value as THREE.Vector2).set(w * pr, h * pr);
  }

  /* ---------------- Kamera ---------------- */
  view() {
    return {
      t: this.controls.target.clone(),
      d: this.controls.getDistance(),
      p: this.controls.getPolarAngle(),
      a: this.controls.getAzimuthalAngle()
    };
  }

  private applyView(t: THREE.Vector3, d: number, p: number, a: number) {
    this.controls.target.copy(t);
    const s = new THREE.Spherical(d, p, a);
    const off = new THREE.Vector3().setFromSpherical(s);
    this.camera.position.copy(t).add(off);
    this.camera.lookAt(t);
  }

  flyTo(target: THREE.Vector3, opts: { dist?: number; polar?: number; azimuth?: number; duration?: number; done?: () => void } = {}) {
    const from = this.view();
    const to = {
      t: target.clone(),
      d: THREE.MathUtils.clamp(opts.dist ?? from.d, this.controls.minDistance, this.controls.maxDistance),
      p: THREE.MathUtils.clamp(opts.polar ?? from.p, this.controls.minPolarAngle, this.controls.maxPolarAngle),
      a: opts.azimuth ?? from.a
    };
    // kürzester Drehweg
    let da = to.a - from.a;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    to.a = from.a + da;
    const move = from.t.distanceTo(to.t) + Math.abs(to.d - from.d) * 0.6 + Math.abs(da) * 120;
    const dur = opts.duration ?? THREE.MathUtils.clamp(0.6 + move / 420, 0.7, 2.4);
    this.flight = { from, to, start: this.timer.getElapsed(), dur, done: opts.done };
  }

  get flying() {
    return !!this.flight;
  }

  cancelFlight() {
    this.flight = null;
  }

  /** Kamera ohne Animation um das Ziel drehen (Kinomodus) */
  orbit(dAzimuth: number, dPolar = 0) {
    const v = this.view();
    this.applyView(v.t, v.d, THREE.MathUtils.clamp(v.p + dPolar, this.controls.minPolarAngle, this.controls.maxPolarAngle), v.a + dAzimuth);
  }

  rotateBy(rad: number) {
    const v = this.view();
    this.flyTo(v.t, { azimuth: v.a + rad, duration: 0.6 });
  }

  private stepFlight(t: number) {
    const f = this.flight;
    if (!f) return;
    const k = Math.min(1, (t - f.start) / f.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const tt = f.from.t.clone().lerp(f.to.t, e);
    // leichter Bogen: beim Flug über weite Strecken kurz herauszoomen
    const span = f.from.t.distanceTo(f.to.t);
    const lift = Math.sin(Math.PI * e) * Math.min(260, span * 0.35);
    const d = THREE.MathUtils.lerp(f.from.d, f.to.d, e) + lift;
    const p = THREE.MathUtils.lerp(f.from.p, f.to.p, e);
    const a = THREE.MathUtils.lerp(f.from.a, f.to.a, e);
    this.applyView(tt, d, p, a);
    if (k >= 1) {
      this.flight = null;
      f.done?.();
    }
  }

  private clampTarget() {
    const b = plan.bounds, ib = plan.islandBounds;
    const t = this.controls.target;
    const x0 = Math.min(b.x0, ib.x0) - 120, x1 = Math.max(b.x1, ib.x1) + 120;
    const z0 = b.z0 - 120, z1 = ib.z1 + 120;
    const cx = THREE.MathUtils.clamp(t.x, x0, x1);
    const cz = THREE.MathUtils.clamp(t.z, z0, z1);
    const dx = cx - t.x, dz = cz - t.z;
    if (dx || dz || t.y !== 0) {
      const dy = -t.y;
      t.set(cx, 0, cz);
      this.camera.position.x += dx;
      this.camera.position.y += dy;
      this.camera.position.z += dz;
    }
  }

  /* ---------------- Schleife ---------------- */
  start() {
    const loop = (ts: number) => {
      requestAnimationFrame(loop);
      this.timer.update(ts);
      const dt = Math.min(this.timer.getDelta(), 0.1);
      const t = this.timer.getElapsed();
      this.fpsAcc += dt;
      this.fpsN++;
      if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
      if (this.paused) return;
      U.uTime.value = t;
      this.grade.uniforms.uTime.value = t;
      if (this.flight) this.stepFlight(t);
      else this.controls.update(dt);
      this.shadowAcc += dt;
      if (this.shadowAcc > 0.5) { this.shadowAcc = 0; this.renderer.shadowMap.needsUpdate = true; }
      this.clampTarget();
      for (const fn of this.updates) fn(dt, t);
      this.composer.render(dt);
      this.frame++;
    };
    requestAnimationFrame(loop);
  }

  /** Einzelbild rendern (für Screenshots im Fotomodus) */
  renderOnce() {
    this.composer.render(0);
  }
}
