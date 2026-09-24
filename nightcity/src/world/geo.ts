import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Geometrie-Sammler: viele einfache Körper je Material zu einem Mesh
 * zusammenfassen (wenige Draw-Calls, trotzdem viel Detail).
 */

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

function normalize(g: THREE.BufferGeometry, color?: THREE.Color): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  // nur Position/Normale/UV behalten, damit alles zusammenpasst
  for (const name of Object.keys(ng.attributes)) {
    if (!['position', 'normal', 'uv', 'color'].includes(name)) ng.deleteAttribute(name);
  }
  if (!ng.attributes.uv) {
    ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((ng.attributes.position.count) * 2), 2));
  }
  if (color) {
    const n = ng.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
    ng.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  } else if (ng.attributes.color) {
    ng.deleteAttribute('color');
  }
  return ng;
}

export class Bag {
  private parts: THREE.BufferGeometry[] = [];
  constructor(readonly withColor = false) {}

  get empty() {
    return this.parts.length === 0;
  }

  add(g: THREE.BufferGeometry, pos: THREE.Vector3Like = { x: 0, y: 0, z: 0 }, rot: { x?: number; y?: number; z?: number } = {}, scale: THREE.Vector3Like = { x: 1, y: 1, z: 1 }, color?: THREE.ColorRepresentation) {
    tmpE.set(rot.x || 0, rot.y || 0, rot.z || 0);
    tmpQ.setFromEuler(tmpE);
    tmpP.set(pos.x, pos.y, pos.z);
    tmpS.set(scale.x, scale.y, scale.z);
    tmpM.compose(tmpP, tmpQ, tmpS);
    g.applyMatrix4(tmpM);
    this.parts.push(normalize(g, this.withColor ? new THREE.Color(color ?? '#ffffff') : undefined));
    return this;
  }

  /** Quader: Mittelpunkt x/z, Unterkante y */
  box(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0, color?: THREE.ColorRepresentation) {
    return this.add(new THREE.BoxGeometry(w, h, d), { x, y: y + h / 2, z }, { y: rotY }, undefined, color);
  }

  /** Zylinder: Unterkante y */
  cyl(rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 16, color?: THREE.ColorRepresentation, rotY = 0) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), { x, y: y + h / 2, z }, { y: rotY }, undefined, color);
  }

  /** achteckiges Prisma (abgeschrägte Ecken) */
  oct(w: number, h: number, d: number, x: number, y: number, z: number, color?: THREE.ColorRepresentation) {
    const R = 0.5 / Math.cos(Math.PI / 8); // Schlüsselweite = 1
    const g = new THREE.CylinderGeometry(R, R, 1, 8);
    g.rotateY(Math.PI / 8);
    return this.add(g, { x, y: y + h / 2, z }, {}, { x: w, y: h, z: d }, color);
  }

  sphere(r: number, x: number, y: number, z: number, seg = 12, color?: THREE.ColorRepresentation) {
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)), { x, y, z }, {}, undefined, color);
  }

  torus(r: number, tube: number, x: number, y: number, z: number, rot: { x?: number; y?: number; z?: number } = { x: Math.PI / 2 }, color?: THREE.ColorRepresentation, seg = 40) {
    return this.add(new THREE.TorusGeometry(r, tube, 6, seg), { x, y, z }, rot, undefined, color);
  }

  cone(r: number, h: number, x: number, y: number, z: number, seg = 12, color?: THREE.ColorRepresentation) {
    return this.add(new THREE.ConeGeometry(r, h, seg), { x, y: y + h / 2, z }, {}, undefined, color);
  }

  /** dünner Balken zwischen zwei Punkten */
  beam(a: THREE.Vector3, b: THREE.Vector3, thick: number, color?: THREE.ColorRepresentation) {
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(thick, thick, len);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    return this.add(g, mid, { x: e.x, y: e.y, z: e.z }, undefined, color);
  }

  plane(w: number, d: number, x: number, y: number, z: number, color?: THREE.ColorRepresentation, rotY = 0) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    return this.add(g, { x, y, z }, { y: rotY }, undefined, color);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach(p => p.dispose());
    this.parts = [];
    if (!g) return null;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  mesh(mat: THREE.Material, opts: { cast?: boolean; receive?: boolean; name?: string } = {}): THREE.Mesh | null {
    const g = this.build();
    if (!g) return null;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = opts.cast ?? true;
    m.receiveShadow = opts.receive ?? true;
    if (opts.name) m.name = opts.name;
    return m;
  }
}

/** deterministische Zufallszahl aus einer Zeichenkette */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

export function rng(seed: number) {
  let a = Math.floor(seed * 4294967296) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
