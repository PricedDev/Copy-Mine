import * as THREE from 'three';
import { model } from '../data/model';
import { SEV_COLOR } from '../theme';
import type { Severity } from '../data/types';
import { U, noReflect, type Core } from './core';
import type { Structure } from './buildctx';
import { FONT_UI } from './textures';

/*
 * Effekte: Rauch, Dampf und Hitze (Partikel), Befund-Hologramme über den
 * betroffenen Gebäuden und Funkenregen beim simulierten Ausfall.
 */

export type EmitterType = 'smoke' | 'steam' | 'heat';

const SEV_RANK: Record<Severity, number> = { crit: 3, warn: 2, info: 1, good: 0 };
const SEV_ICON: Record<Severity, string> = { crit: '!', warn: '!', info: 'i', good: '✓' };

function markerTexture(sev: Severity, count: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const col = SEV_COLOR[sev];
  g.translate(64, 64);
  g.shadowColor = col;
  g.shadowBlur = 18;
  g.strokeStyle = col;
  g.lineWidth = 7;
  g.fillStyle = 'rgba(8,6,14,0.75)';
  g.beginPath();
  if (sev === 'crit' || sev === 'warn') {
    g.moveTo(0, -46); g.lineTo(48, 38); g.lineTo(-48, 38); g.closePath();
  } else {
    g.arc(0, 0, 42, 0, Math.PI * 2);
  }
  g.fill();
  g.stroke();
  g.shadowBlur = 10;
  g.fillStyle = col;
  g.font = `700 54px ${FONT_UI}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(SEV_ICON[sev], 0, sev === 'crit' || sev === 'warn' ? 12 : 3);
  if (count > 1) {
    g.shadowBlur = 0;
    g.fillStyle = col;
    g.beginPath(); g.arc(40, -40, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#05060d';
    g.font = `700 26px ${FONT_UI}`;
    g.fillText(String(count), 40, -39);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface FindingMarker { sprite: THREE.Sprite; sev: Severity; structure: string; findings: number[]; baseY: number; }

export class Fx {
  readonly markers: FindingMarker[] = [];
  private particles: THREE.Points | null = null;
  private emitters: Array<{ p: THREE.Vector3; type: EmitterType }> = [];
  private sparks: THREE.Points;
  private sparkPos: Float32Array;
  private sparkVel: Float32Array;
  private sparkLife: Float32Array;
  private sparkCol: Float32Array;
  private sparkNext = 0;
  markersVisible = true;

  constructor(private core: Core, private structures: Map<string, Structure>) {
    const N = 600;
    this.sparkPos = new Float32Array(N * 3);
    this.sparkVel = new Float32Array(N * 3);
    this.sparkLife = new Float32Array(N);
    this.sparkCol = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false;
    this.sparks.name = 'Funken';
    noReflect(this.sparks);
    core.scene.add(this.sparks);
    this.buildMarkers();
    core.onUpdate((dt, t) => this.update(dt, t));
  }

  addEmitter(p: THREE.Vector3, type: EmitterType) {
    this.emitters.push({ p: p.clone(), type });
  }

  /** alle Emitter gesammelt → ein Partikelsystem */
  buildParticles() {
    const per: Record<EmitterType, number> = { smoke: 48, steam: 26, heat: 40 };
    let n = 0;
    this.emitters.forEach(e => { n += per[e.type]; });
    const em = new Float32Array(n * 3), seed = new Float32Array(n * 4);
    let k = 0;
    this.emitters.forEach(e => {
      for (let i = 0; i < per[e.type]; i++) {
        em[k * 3] = e.p.x; em[k * 3 + 1] = e.p.y; em[k * 3 + 2] = e.p.z;
        seed[k * 4] = Math.random(); seed[k * 4 + 1] = Math.random(); seed[k * 4 + 2] = 0.6 + Math.random() * 1.6;
        seed[k * 4 + 3] = e.type === 'smoke' ? 0 : e.type === 'steam' ? 1 : 2;
        k++;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(em, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uPixel: { value: 600 } },
      vertexShader: /* glsl */`
        attribute vec4 aSeed;
        uniform float uTime, uPixel;
        varying float vA; varying vec3 vC;
        void main() {
          float type = aSeed.w;
          float life = type > 1.5 ? 2.2 + aSeed.y : (type > 0.5 ? 2.6 + aSeed.y * 1.5 : 5.0 + aSeed.y * 3.0);
          float age = fract(uTime / life + aSeed.x);
          vec3 p = position;
          float rise = type > 1.5 ? 9.0 : (type > 0.5 ? 3.5 : 7.0);
          p.y += age * rise * (0.7 + aSeed.y * 0.6);
          p.x += sin(aSeed.x * 40.0 + uTime * 0.6) * age * aSeed.z + age * age * (type > 0.5 ? 0.8 : 4.0);
          p.z += cos(aSeed.x * 31.0 + uTime * 0.5) * age * aSeed.z;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = type > 1.5 ? (0.8 + age * 2.5) : (type > 0.5 ? (0.8 + age * 3.5) : (1.5 + age * 7.0));
          gl_PointSize = size * uPixel / max(1.0, -mv.z);
          vA = (1.0 - age) * smoothstep(0.0, 0.12, age);
          vC = type > 1.5 ? vec3(1.0, 0.42, 0.12) : (type > 0.5 ? vec3(0.62, 0.66, 0.78) : vec3(0.32, 0.26, 0.4));
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying vec3 vC;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d) * vA;
          gl_FragColor = vec4(vC * a * 0.32, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.particles = new THREE.Points(g, mat);
    this.particles.frustumCulled = false;
    this.particles.name = 'Rauch & Dampf';
    noReflect(this.particles);
    this.core.scene.add(this.particles);
    const upd = () => {
      const h = this.core.renderer.domElement.height;
      mat.uniforms.uPixel.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.core.camera.fov / 2)));
    };
    upd();
    window.addEventListener('resize', upd);
  }

  /* ---------------- Befund-Hologramme ---------------- */

  private buildMarkers() {
    const per = new Map<string, number[]>();
    model.findings.forEach((f, i) => {
      const seen = new Set<string>();
      f.n.forEach(id => {
        const sid = model.structureOf(id) || (id === 'cluster' ? 'cluster' : null);
        if (!sid || !this.structures.has(sid) || seen.has(sid)) return;
        seen.add(sid);
        (per.get(sid) || per.set(sid, []).get(sid)!).push(i);
      });
    });
    per.forEach((list, sid) => {
      const s = this.structures.get(sid)!;
      const sev = list.map(i => model.findings[i].sev).sort((a, b) => SEV_RANK[b] - SEV_RANK[a])[0];
      const mat = new THREE.SpriteMaterial({ map: markerTexture(sev, list.length), color: new THREE.Color(1.6, 1.6, 1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const sp = new THREE.Sprite(mat);
      const size = s.kind === 'pve' ? 9 : 5.2;
      sp.scale.set(size, size, 1);
      const baseY = s.labelAt.y + (s.kind === 'pve' ? 10 : 6.5);
      sp.position.set(s.labelAt.x, baseY, s.labelAt.z);
      sp.renderOrder = 9;
      sp.userData.pick = { kind: 'finding-marker', id: sid };
      sp.name = 'Befund ' + sid;
      noReflect(sp);
      this.core.scene.add(sp);
      this.markers.push({ sprite: sp, sev, structure: sid, findings: list, baseY });
    });
  }

  setMarkersVisible(on: boolean) {
    this.markersVisible = on;
    this.markers.forEach(m => { m.sprite.visible = on; });
  }

  /** nur Marker bestimmter Befunde zeigen (z. B. beim Anklicken eines Befunds) */
  focusFinding(index: number | null) {
    this.markers.forEach(m => {
      const on = index == null ? this.markersVisible : m.findings.includes(index);
      m.sprite.visible = on;
      (m.sprite.material as THREE.SpriteMaterial).color.setScalar(index != null && on ? 2.6 : 1.6);
    });
  }

  /* ---------------- Funken ---------------- */

  burst(p: THREE.Vector3, color: THREE.ColorRepresentation, count = 60, spread = 6) {
    const c = new THREE.Color(color);
    const N = this.sparkLife.length;
    for (let i = 0; i < count; i++) {
      const k = this.sparkNext = (this.sparkNext + 1) % N;
      this.sparkPos[k * 3] = p.x + (Math.random() - 0.5) * spread;
      this.sparkPos[k * 3 + 1] = p.y + Math.random() * spread * 0.5;
      this.sparkPos[k * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      this.sparkVel[k * 3] = (Math.random() - 0.5) * 14;
      this.sparkVel[k * 3 + 1] = 4 + Math.random() * 12;
      this.sparkVel[k * 3 + 2] = (Math.random() - 0.5) * 14;
      this.sparkLife[k] = 0.8 + Math.random() * 1.2;
      this.sparkCol[k * 3] = c.r * 4; this.sparkCol[k * 3 + 1] = c.g * 4; this.sparkCol[k * 3 + 2] = c.b * 4;
    }
  }

  private update(dt: number, t: number) {
    const N = this.sparkLife.length;
    let any = false;
    for (let k = 0; k < N; k++) {
      if (this.sparkLife[k] <= 0) continue;
      any = true;
      this.sparkLife[k] -= dt;
      this.sparkVel[k * 3 + 1] -= 22 * dt;
      this.sparkPos[k * 3] += this.sparkVel[k * 3] * dt;
      this.sparkPos[k * 3 + 1] = Math.max(0.1, this.sparkPos[k * 3 + 1] + this.sparkVel[k * 3 + 1] * dt);
      this.sparkPos[k * 3 + 2] += this.sparkVel[k * 3 + 2] * dt;
      const f = Math.max(0, this.sparkLife[k]);
      this.sparkCol[k * 3] *= 0.97 + f * 0.01; this.sparkCol[k * 3 + 1] *= 0.95; this.sparkCol[k * 3 + 2] *= 0.95;
      if (this.sparkLife[k] <= 0) { this.sparkCol[k * 3] = this.sparkCol[k * 3 + 1] = this.sparkCol[k * 3 + 2] = 0; }
    }
    if (any) {
      (this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.sparks.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
    this.markers.forEach((m, i) => {
      m.sprite.position.y = m.baseY + Math.sin(t * 1.6 + i) * 0.6;
      const mat = m.sprite.material as THREE.SpriteMaterial;
      if (m.sev === 'crit') mat.opacity = 0.75 + 0.25 * Math.sin(t * 5 + i);
    });
  }
}

