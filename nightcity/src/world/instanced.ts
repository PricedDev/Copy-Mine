import * as THREE from 'three';
import { U } from './core';

/*
 * Instanzierte Kleinteile, die überall in der Stadt vorkommen:
 * Blinklichter (Flugwarnlichter, Statuslampen) und leuchtende Bäume.
 */

export interface BeaconRef { index: number; }

export class BeaconSet {
  private pos: THREE.Vector3[] = [];
  private col: THREE.Color[] = [];
  private blink: Array<[number, number, number]> = [];
  private size: number[] = [];
  private power: number[] = [];
  mesh: THREE.InstancedMesh | null = null;
  private colAttr: THREE.InstancedBufferAttribute | null = null;

  /** rate = Blinkfrequenz (Hz, 0 = Dauerlicht), duty = Einschaltanteil */
  add(p: THREE.Vector3, color: THREE.ColorRepresentation, rate = 0.8, duty = 0.18, size = 0.35, phase = Math.random()): BeaconRef {
    this.pos.push(p.clone());
    this.col.push(new THREE.Color(color));
    this.blink.push([rate, phase, duty]);
    this.size.push(size);
    this.power.push(1);
    return { index: this.pos.length - 1 };
  }

  build(parent: THREE.Object3D) {
    const n = this.pos.length;
    if (!n) return;
    const g = new THREE.IcosahedronGeometry(1, 1);
    const col = new Float32Array(n * 3);
    const bl = new Float32Array(n * 3);
    this.col.forEach((c, i) => { col[i * 3] = c.r * 6; col[i * 3 + 1] = c.g * 6; col[i * 3 + 2] = c.b * 6; });
    this.blink.forEach((b, i) => { bl[i * 3] = b[0]; bl[i * 3 + 1] = b[1]; bl[i * 3 + 2] = b[2]; });
    this.colAttr = new THREE.InstancedBufferAttribute(col, 3);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aColor', this.colAttr);
    g.setAttribute('aBlink', new THREE.InstancedBufferAttribute(bl, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity },
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute vec3 aBlink;
        uniform float uTime;
        varying vec3 vC; varying float vFog;
        void main() {
          float on = 1.0;
          if (aBlink.x > 0.0) {
            float ph = fract(uTime * aBlink.x + aBlink.y);
            on = smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(aBlink.z, aBlink.z + 0.05, ph));
            on = 0.06 + on;
          }
          vC = aColor * on;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vFog = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uFogColor; uniform float uFogDensity;
        varying vec3 vC; varying float vFog;
        void main() {
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vFog * vFog * 0.4);
          gl_FragColor = vec4(mix(vC, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
        }`
    });
    const m = new THREE.InstancedMesh(g, mat, n);
    const mm = new THREE.Matrix4();
    this.pos.forEach((p, i) => {
      const s = this.size[i];
      mm.makeScale(s, s, s).setPosition(p);
      m.setMatrixAt(i, mm);
    });
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    m.name = 'Blinklichter';
    this.mesh = m;
    parent.add(m);
  }

  setPower(ref: BeaconRef, p: number) {
    if (!this.colAttr) return;
    const c = this.col[ref.index];
    this.power[ref.index] = p;
    this.colAttr.setXYZ(ref.index, c.r * 6 * p, c.g * 6 * p, c.b * 6 * p);
    this.colAttr.needsUpdate = true;
  }

  setColor(ref: BeaconRef, color: THREE.ColorRepresentation) {
    this.col[ref.index].set(color);
    this.setPower(ref, this.power[ref.index]);
  }
}

export class TreeSet {
  private items: Array<{ p: THREE.Vector3; s: number; c: THREE.Color; r: number }> = [];

  add(p: THREE.Vector3, scale: number, color: THREE.ColorRepresentation, rot = 0) {
    this.items.push({ p: p.clone(), s: scale, c: new THREE.Color(color), r: rot });
  }

  build(parent: THREE.Object3D) {
    const n = this.items.length;
    if (!n) return;
    const trunkG = new THREE.CylinderGeometry(0.12, 0.2, 2.2, 6);
    trunkG.translate(0, 1.1, 0);
    const crownG = new THREE.IcosahedronGeometry(1.2, 2);
    crownG.scale(1, 1.25, 1);
    crownG.translate(0, 3.0, 0);
    const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: '#1a1512', roughness: 0.9 }), n);
    // biolumineszente Krone: dunkler Kern, leuchtender Rand (Fresnel), Spitze heller
    const crownMat = new THREE.ShaderMaterial({
      uniforms: { uFogColor: U.uFogColor, uFogDensity: U.uFogDensity },
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vV; varying vec3 vC; varying float vY;
        void main() {
          vC = vec3(1.0);
          #ifdef USE_INSTANCING_COLOR
            vC = instanceColor;
          #endif
          vY = position.y;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vV = mv.xyz;
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uFogColor; uniform float uFogDensity;
        varying vec3 vN; varying vec3 vV; varying vec3 vC; varying float vY;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(-vV))), 2.2);
          vec3 c = vC * (0.12 + f * 1.25) + vC * 0.22 * smoothstep(2.4, 4.3, vY);
          float d = length(vV);
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
          gl_FragColor = vec4(mix(c, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
        }`
    });
    const crown = new THREE.InstancedMesh(crownG, crownMat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    this.items.forEach((it, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.r);
      m.compose(it.p, q, new THREE.Vector3(it.s, it.s, it.s));
      trunk.setMatrixAt(i, m);
      crown.setMatrixAt(i, m);
      crown.setColorAt(i, it.c);
    });
    trunk.castShadow = true;
    crown.castShadow = true;
    trunk.name = 'Baumstämme';
    crown.name = 'Baumkronen';
    parent.add(trunk, crown);
  }
}
