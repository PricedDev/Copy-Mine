import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { plan } from '../layout/plan';
import { U, noReflect, type Core, type QualitySpec } from './core';
import { facadeMaterial } from './materials';
import { rng } from './geo';
import type { BeaconSet } from './instanced';

/*
 * Atmosphäre: Nachthimmel mit Wolken, Mond und Stadtglühen, ferne Skyline,
 * spiegelndes Hafenwasser, Mondlicht mit Schatten, Regen mit Spritzern,
 * Suchscheinwerfer und Flugverkehr am Horizont. Wetter ist umschaltbar.
 */

export type Weather = 'regen' | 'sturm' | 'nebel' | 'klar';

export const WEATHER_LABEL: Record<Weather, string> = {
  regen: 'Regen', sturm: 'Gewitter', nebel: 'Nebel', klar: 'Klar'
};

const WEATHER: Record<Weather, { rain: number; fog: number; clouds: number; wind: number; storm: number }> = {
  regen: { rain: 1, fog: 1, clouds: 0.75, wind: 0.18, storm: 0 },
  sturm: { rain: 1.9, fog: 1.25, clouds: 1, wind: 0.45, storm: 1 },
  nebel: { rain: 0.15, fog: 2.6, clouds: 0.9, wind: 0.05, storm: 0 },
  klar: { rain: 0, fog: 0.55, clouds: 0.25, wind: 0.05, storm: 0 }
};

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;

const SKY_FRAG = /* glsl */`
  uniform float uTime, uClouds, uFlash;
  uniform vec3 uMoonDir;
  varying vec3 vDir;
  float h21(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n2(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    vec3 d = normalize(vDir);
    float y = max(d.y, 0.0);
    vec3 zen = vec3(0.006, 0.008, 0.022);
    vec3 hor = vec3(0.09, 0.03, 0.12);
    vec3 col = mix(hor, zen, pow(y, 0.45));
    // Stadtglühen am Horizont
    float glow = exp(-y * 9.0);
    col += vec3(0.32, 0.08, 0.18) * glow * 0.9 + vec3(0.2, 0.09, 0.02) * exp(-y * 22.0) * 0.8;
    // Sterne
    vec2 sp = d.xz / max(d.y, 0.08) * 90.0;
    float st = step(0.9965, h21(floor(sp))) * smoothstep(0.08, 0.4, y);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h21(floor(sp) + 3.1) * 40.0);
    col += vec3(0.8, 0.85, 1.0) * st * tw * 0.9 * (1.0 - uClouds * 0.8);
    // Mond
    float md = dot(d, normalize(uMoonDir));
    col += vec3(0.75, 0.82, 1.0) * smoothstep(0.9993, 0.99965, md) * 2.4;
    col += vec3(0.25, 0.3, 0.55) * pow(max(md, 0.0), 180.0) * 0.8;
    // Wolken, von unten durch die Stadt angestrahlt
    vec2 cp = d.xz / max(d.y + 0.12, 0.05) * 1.6 + vec2(uTime * 0.008, uTime * 0.003);
    float c = fbm(cp);
    float cov = smoothstep(0.62 - uClouds * 0.32, 0.95, c) * smoothstep(0.0, 0.25, y);
    vec3 cloudCol = mix(vec3(0.05, 0.03, 0.08), vec3(0.34, 0.1, 0.24), exp(-y * 3.0)) + vec3(0.25, 0.3, 0.45) * uFlash;
    col = mix(col, cloudCol, cov * 0.85);
    col += vec3(0.5, 0.55, 0.8) * uFlash * 0.6 * (0.4 + cov);
    gl_FragColor = vec4(col, 1.0);
  }`;

const WATER = {
  name: 'NachtWasser',
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0.001 },
    uRain: { value: 1 }
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vW;
    varying float vDepth;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      vec4 mv = viewMatrix * w;
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uTime, uFogDensity, uRain;
    uniform vec3 uFogColor;
    varying vec4 vUv;
    varying vec3 vW;
    varying float vDepth;
    float h21(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
    float n2(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      vec2 p = vW.xz * 0.08;
      float a = n2(p + vec2(uTime * 0.12, uTime * 0.05));
      float b = n2(p * 2.3 - vec2(uTime * 0.07, uTime * 0.16));
      float c = n2(p * 6.0 + vec2(uTime * 0.4, -uTime * 0.2));
      vec2 dist = (vec2(a, b) - 0.5) * 0.028 + (c - 0.5) * 0.008 * (0.5 + uRain);
      vec4 uv = vUv;
      uv.xy += dist * uv.w;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;
      vec3 deep = vec3(0.004, 0.009, 0.02);
      vec3 col = deep + refl * 0.78 * color;
      // Regenringe
      vec2 g = floor(vW.xz * 0.5);
      float ph = fract(uTime * 0.7 + h21(g) * 7.0);
      float r = length(fract(vW.xz * 0.5) - 0.5);
      col += vec3(0.06, 0.08, 0.1) * smoothstep(0.03, 0.0, abs(r - ph * 0.45)) * (1.0 - ph) * uRain * step(0.6, h21(g + 1.3));
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
      col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`
};

export class Environment {
  weather: Weather = 'regen';
  private target = { ...WEATHER.regen };
  private cur = { ...WEATHER.regen };
  readonly sky: THREE.Mesh;
  readonly moon: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private reflector: Reflector | null = null;
  private fallbackWater: THREE.Mesh;
  private rain: THREE.Mesh;
  private splash: THREE.Mesh;
  private rainU: Record<string, THREE.IUniform>;
  private splashU: Record<string, THREE.IUniform>;
  private flash = 0;
  private nextBolt = 6;
  private baseFog = 0.00085;
  private searchlights: THREE.Mesh[] = [];

  constructor(private core: Core, beacons: BeaconSet) {
    const scene = core.scene;
    const c = plan.center;
    /* Himmel */
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uClouds: { value: 0.75 }, uFlash: { value: 0 }, uMoonDir: { value: new THREE.Vector3(-0.5, 0.42, -0.75).normalize() } },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 24), skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.sky.name = 'Himmel';
    scene.add(this.sky);

    /* Licht */
    this.hemi = new THREE.HemisphereLight('#4f58a8', '#2a1224', 0.62);
    scene.add(this.hemi);
    scene.add(new THREE.AmbientLight('#1b1430', 0.35));
    this.moon = new THREE.DirectionalLight('#a9bcff', 1.35);
    this.moon.position.set(c.x - 320, 460, c.z + 240);
    this.moon.target.position.set(c.x, 0, c.z + 40);
    scene.add(this.moon, this.moon.target);
    const sc = this.moon.shadow.camera;
    sc.left = -330; sc.right = 330; sc.top = 330; sc.bottom = -330; sc.near = 50; sc.far = 1400;
    this.moon.shadow.mapSize.set(4096, 4096);
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.6;
    this.moon.shadow.radius = 2;

    /* Umgebungskarte für Spiegelungen (Neonstadt als Lichtkulisse) */
    const pm = new THREE.PMREMGenerator(core.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uClouds: { value: 0.6 }, uFlash: { value: 0 }, uMoonDir: { value: new THREE.Vector3(-0.5, 0.42, -0.75) } }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide })));
    const r = rng(9);
    const cols = ['#ff2a6d', '#00e5ff', '#fcee0a', '#b46bff', '#ff8a2a', '#2effc8'];
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(2 + r() * 5, 1 + r() * 9, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i % cols.length]).multiplyScalar(2 + r() * 3) }));
      box.position.set(Math.cos(a) * 38, -6 + r() * 20, Math.sin(a) * 38);
      box.lookAt(0, box.position.y, 0);
      envScene.add(box);
    }
    const envTex = pm.fromScene(envScene, 0.02).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.62;
    pm.dispose();

    /* Wasser */
    const wgeo = new THREE.PlaneGeometry(9000, 9000);
    this.fallbackWater = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({ color: '#03060d', roughness: 0.08, metalness: 0.9, envMapIntensity: 1.2 }));
    this.fallbackWater.rotation.x = -Math.PI / 2;
    this.fallbackWater.position.set(c.x, -1.6, c.z);
    this.fallbackWater.name = 'Wasser';
    scene.add(this.fallbackWater);

    /* ferne Skyline */
    this.buildSkyline(scene, beacons);
    /* Suchscheinwerfer */
    this.buildSearchlights(scene);
    /* Regen + Spritzer */
    const rr = this.buildRain(scene);
    this.rain = rr.rain; this.rainU = rr.u;
    const ss = this.buildSplash(scene);
    this.splash = ss.mesh; this.splashU = ss.u;
    /* Flugverkehr am Horizont */
    this.buildTraffic(scene);

    core.onQuality(q => this.applyQuality(q));
    core.onUpdate((dt, t) => this.update(dt, t));
  }

  private applyQuality(q: QualitySpec) {
    // shadowMap bleibt an – nur das Mondlicht wirft Schatten oder nicht (Shader passen sich an)
    this.moon.castShadow = q.shadows;
    const pr = this.core.pixelRatioFor(q);
    const w = Math.round(window.innerWidth * q.reflectScale * pr);
    const h = Math.round(window.innerHeight * q.reflectScale * pr);
    if (q.reflections && this.reflector) this.reflector.getRenderTarget().setSize(w, h);
    if (q.reflections && !this.reflector) {
      this.reflector = new Reflector(new THREE.PlaneGeometry(9000, 9000), { textureWidth: w, textureHeight: h, color: 0x8a96b8, shader: WATER, multisample: 0, clipBias: 0.002 });
      this.reflector.rotation.x = -Math.PI / 2;
      const c = plan.center;
      this.reflector.position.set(c.x, -1.55, c.z);
      this.reflector.name = 'Wasser (Spiegelung)';
      this.core.scene.add(this.reflector);
      // die Spiegelkamera sieht nur die Grundebene – Regen, Partikel, NPCs bleiben draußen
      this.reflector.getReflectionCamera(this.core.camera).layers.set(0);
    }
    if (this.reflector) this.reflector.visible = q.reflections;
    this.fallbackWater.visible = !q.reflections;
    const rain = this.rain.geometry as THREE.InstancedBufferGeometry;
    rain.instanceCount = q.rain;
    (this.splash.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.round(q.rain / 6);
  }

  setWeather(w: Weather) {
    this.weather = w;
    this.target = { ...WEATHER[w] };
  }

  private buildSkyline(scene: THREE.Scene, beacons: BeaconSet) {
    const c = plan.center;
    const r = rng(1234);
    const items: Array<{ x: number; z: number; w: number; d: number; h: number }> = [];
    for (let ring = 0; ring < 3; ring++) {
      const rad = 820 + ring * 260;
      const n = 70 + ring * 30;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r() * 0.03;
        // Richtung Kamera (Süden) lichter lassen: dort liegt das offene Meer
        const south = Math.cos(a - Math.PI / 2);
        if (south > 0.55 && r() > 0.25) continue;
        const h = 40 + Math.pow(r(), 1.6) * (220 + ring * 140);
        items.push({ x: c.x + Math.cos(a) * (rad + r() * 120), z: c.z + Math.sin(a) * (rad + r() * 120), w: 18 + r() * 40, d: 18 + r() * 40, h });
      }
    }
    const mat = facadeMaterial({ color: '#0d0f18', seed: 77, lit: 0.22, warm: 0.6, tint: '#ff2a6d', height: 1000, win: [3.2, 5.0], metalness: 0.3, roughness: 0.7 });
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(g, mat, items.length);
    const m = new THREE.Matrix4();
    items.forEach((it, i) => {
      m.makeScale(it.w, it.h, it.d).setPosition(it.x, -2, it.z);
      mesh.setMatrixAt(i, m);
      if (it.h > 180 && r() > 0.3) beacons.add(new THREE.Vector3(it.x, it.h + 1, it.z), '#ff2a3a', 0.45 + r() * 0.3, 0.18, 2.2);
    });
    mesh.name = 'Ferne Skyline';
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  private buildSearchlights(scene: THREE.Scene) {
    const spots: Array<[string, number]> = [['pve-node1', 0], ['pve-ai', 1.7], ['pve-print', 3.1]];
    spots.forEach(([id, ph]) => {
      const p = plan.place(id);
      if (!p) return;
      const g = new THREE.CylinderGeometry(9, 0.6, 520, 24, 1, true);
      g.translate(0, 260, 0);
      const m = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(id === 'pve-ai' ? '#6fd6ff' : id === 'pve-print' ? '#fff3a0' : '#ffb0a0') } },
        vertexShader: /* glsl */`varying float vY; varying vec3 vN; varying vec3 vV;
          void main() { vY = position.y / 520.0; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */`uniform vec3 uColor; varying float vY; varying vec3 vN; varying vec3 vV;
          void main() { float e = pow(abs(dot(normalize(vN), normalize(-vV))), 1.5); gl_FragColor = vec4(uColor * (1.0 - vY) * 0.06 * e, 1.0); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      });
      const beam = new THREE.Mesh(g, m);
      beam.position.set(p.x, 60, p.z);
      beam.userData.phase = ph;
      beam.frustumCulled = false;
      beam.name = 'Suchscheinwerfer';
      scene.add(beam);
      this.searchlights.push(beam);
    });
  }

  private buildRain(scene: THREE.Scene) {
    const max = 16000;
    const base = new THREE.PlaneGeometry(0.045, 1.5);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    const off = new Float32Array(max * 4);
    const r = rng(55);
    for (let i = 0; i < max; i++) { off[i * 4] = r(); off[i * 4 + 1] = r(); off[i * 4 + 2] = r(); off[i * 4 + 3] = 0.7 + r() * 0.6; }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = max;
    const u = { uTime: U.uTime, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(300, 170, 300) }, uWind: { value: 0.18 }, uAmount: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */`
        attribute vec4 aOff;
        uniform float uTime, uWind, uAmount;
        uniform vec3 uCenter, uBox;
        varying float vA; varying vec2 vUv;
        void main() {
          vUv = uv;
          float sp = 95.0 * aOff.w;
          float tt = mod(uTime, 600.0);
          vec3 p = aOff.xyz * uBox;
          p.y -= tt * sp;
          p.x += tt * sp * uWind;
          p = mod(p, uBox) - uBox * 0.5;
          p += uCenter;
          p.y += uBox.y * 0.5 - 2.0;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 wp = p + right * position.x + vec3(uWind * position.y * 0.9, position.y, 0.0) * aOff.w;
          vec4 mvp = viewMatrix * vec4(wp, 1.0);
          vA = uAmount * step(0.02, p.y) * smoothstep(8.0, 40.0, -mvp.z);
          gl_Position = projectionMatrix * mvp;
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying vec2 vUv;
        void main() {
          // MSAA interpoliert Varyings an Randpixeln auch außerhalb des Dreiecks – begrenzen,
          // sonst entsteht negatives Licht (schwarze Punkte)
          vec2 uv = clamp(vUv, 0.0, 1.0);
          float a = vA * (0.2 + 0.8 * uv.y) * max(0.0, 1.0 - abs(uv.x - 0.5) * 2.0);
          gl_FragColor = vec4(vec3(0.55, 0.65, 0.85) * a * 0.55, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    mesh.name = 'Regen';
    noReflect(mesh);
    scene.add(mesh);
    return { rain: mesh, u: u as unknown as Record<string, THREE.IUniform> };
  }

  private buildSplash(scene: THREE.Scene) {
    const max = 3000;
    const base = new THREE.RingGeometry(0.8, 1.0, 16);
    base.rotateX(-Math.PI / 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    const seed = new Float32Array(max);
    for (let i = 0; i < max; i++) seed[i] = i * 0.61803 % 1;
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.instanceCount = max;
    const u = { uTime: U.uTime, uCenter: { value: new THREE.Vector3() }, uAmount: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */`
        attribute float aSeed;
        uniform float uTime, uAmount;
        uniform vec3 uCenter;
        varying float vA;
        float h(float x) { return fract(sin(x * 91.345) * 47453.5453); }
        void main() {
          float per = 0.55 + h(aSeed) * 0.5;
          float t = uTime / per + aSeed * 13.0;
          float cyc = floor(t);
          float k = fract(t);
          vec3 p = uCenter + vec3((h(aSeed + cyc) - 0.5) * 220.0, 0.24, (h(aSeed * 3.1 + cyc) - 0.5) * 220.0);
          float s = 0.1 + k * 0.45;
          vA = (1.0 - k) * uAmount;
          gl_Position = projectionMatrix * viewMatrix * vec4(p + position * s, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() { gl_FragColor = vec4(vec3(0.5, 0.6, 0.75) * vA * 0.35, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.name = 'Regenspritzer';
    noReflect(mesh);
    scene.add(mesh);
    return { mesh, u: u as unknown as Record<string, THREE.IUniform> };
  }

  private traffic: { mesh: THREE.InstancedMesh; paths: Array<{ r: number; y: number; sp: number; ph: number; col: THREE.Color }> } | null = null;

  private buildTraffic(scene: THREE.Scene) {
    const c = plan.center;
    const r = rng(31);
    const paths = Array.from({ length: 70 }, (_, i) => ({ r: 520 + r() * 420, y: 70 + r() * 110, sp: (0.012 + r() * 0.02) * (i % 2 ? 1 : -1), ph: r() * Math.PI * 2, col: new THREE.Color(i % 3 ? '#fff1d0' : '#ff3048').multiplyScalar(5) }));
    const g = new THREE.SphereGeometry(0.9, 6, 4);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: '#ffffff' }), paths.length);
    paths.forEach((p, i) => mesh.setColorAt(i, p.col));
    mesh.frustumCulled = false;
    mesh.name = 'Flugverkehr (Kulisse)';
    mesh.position.set(c.x, 0, c.z);
    scene.add(mesh);
    this.traffic = { mesh, paths };
  }

  /** Blitz auslösen (auch als Gimmick per Taste) */
  bolt() {
    this.flash = 1;
  }

  private update(dt: number, t: number) {
    const k = 1 - Math.exp(-dt * 0.8);
    (Object.keys(this.cur) as Array<keyof typeof this.cur>).forEach(key => {
      this.cur[key] += (this.target[key] - this.cur[key]) * k;
    });
    const cam = this.core.camera;
    const tgt = this.core.controls.target;
    const dist = cam.position.distanceTo(tgt);
    // Nebel mitzoomen, damit die Stadt aus jeder Höhe gleich dunstig wirkt
    const dens = this.baseFog * this.cur.fog * THREE.MathUtils.clamp(600 / Math.max(dist, 120), 0.4, 1.9);
    U.uFogDensity.value = dens;
    const fog = this.core.scene.fog as THREE.FogExp2;
    fog.density = dens;
    fog.color.copy(U.uFogColor.value);
    U.uRain.value = this.cur.rain;
    // Bloom mitzoomen: aus der Nähe summieren sich viele Leuchtschilder zu Schleier
    const near = THREE.MathUtils.clamp((dist - 60) / 420, 0, 1);
    // enger Radius: Licht glüht, ohne das Bild weichzuzeichnen
    this.core.bloom.strength = THREE.MathUtils.lerp(0.3, 0.54, near);
    this.core.bloom.radius = THREE.MathUtils.lerp(0.18, 0.36, near);
    // Regen folgt der Kamera
    const center = new THREE.Vector3().lerpVectors(tgt, cam.position, 0.35);
    center.y = 0;
    (this.rainU.uCenter.value as THREE.Vector3).copy(center);
    this.rainU.uWind.value = this.cur.wind;
    this.rainU.uAmount.value = Math.min(1, this.cur.rain);
    (this.splashU.uCenter.value as THREE.Vector3).set(tgt.x, 0, tgt.z);
    this.splashU.uAmount.value = Math.min(1, this.cur.rain);
    this.rain.visible = this.cur.rain > 0.02;
    this.splash.visible = this.cur.rain > 0.02;
    const rainGeo = this.rain.geometry as THREE.InstancedBufferGeometry;
    rainGeo.instanceCount = Math.round(this.core.spec.rain * Math.min(1.6, this.cur.rain));
    const sky = this.sky.material as THREE.ShaderMaterial;
    sky.uniforms.uClouds.value = this.cur.clouds;
    this.sky.position.copy(cam.position);
    // Gewitter
    if (this.cur.storm > 0.5) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = 4 + Math.random() * 9; }
    }
    if (this.flash > 0) {
      const f = this.flash * (0.6 + 0.4 * Math.sin(t * 60));
      sky.uniforms.uFlash.value = f;
      this.core.grade.uniforms.uFlash.value = f * 0.8;
      this.hemi.intensity = 0.62 + f * 2.2;
      this.flash = Math.max(0, this.flash - dt * 2.6);
    } else {
      sky.uniforms.uFlash.value = 0;
      this.core.grade.uniforms.uFlash.value = 0;
      this.hemi.intensity = 0.62;
    }
    if (this.reflector) {
      const wm = this.reflector.material as THREE.ShaderMaterial;
      wm.uniforms.uTime.value = t;
      wm.uniforms.uFogDensity.value = dens;
      wm.uniforms.uFogColor.value.copy(U.uFogColor.value);
      wm.uniforms.uRain.value = this.cur.rain;
    }
    this.searchlights.forEach(s => {
      const ph = s.userData.phase as number;
      s.rotation.z = Math.sin(t * 0.13 + ph) * 0.38;
      s.rotation.x = Math.cos(t * 0.11 + ph * 1.7) * 0.3;
    });
    if (this.traffic) {
      const m = new THREE.Matrix4();
      this.traffic.paths.forEach((p, i) => {
        const a = p.ph + t * p.sp;
        m.makeTranslation(Math.cos(a) * p.r, p.y + Math.sin(t * 0.3 + i) * 3, Math.sin(a) * p.r);
        this.traffic!.mesh.setMatrixAt(i, m);
      });
      this.traffic.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
