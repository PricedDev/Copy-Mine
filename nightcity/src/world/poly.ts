import * as THREE from 'three';
import type { V2 } from '../layout/plan';

/** Polylinie mit Bogenlänge – für Datenpakete, NPCs und Kameraflüge */
export class Poly {
  readonly pts: THREE.Vector3[];
  readonly cum: number[];
  readonly length: number;

  constructor(pts: THREE.Vector3[]) {
    const clean: THREE.Vector3[] = [];
    pts.forEach(p => { const l = clean[clean.length - 1]; if (!l || l.distanceToSquared(p) > 1e-6) clean.push(p.clone()); });
    if (clean.length === 1) clean.push(clean[0].clone().add(new THREE.Vector3(0, 0.01, 0)));
    this.pts = clean;
    this.cum = [0];
    for (let i = 1; i < clean.length; i++) this.cum.push(this.cum[i - 1] + clean[i].distanceTo(clean[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }

  at(s: number, pos: THREE.Vector3, tan?: THREE.Vector3): THREE.Vector3 {
    const L = this.length;
    if (L <= 0) { pos.copy(this.pts[0]); if (tan) tan.set(1, 0, 0); return pos; }
    s = Math.max(0, Math.min(L, s));
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const a = this.pts[lo], b = this.pts[hi];
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const k = (s - this.cum[lo]) / seg;
    pos.lerpVectors(a, b, k);
    if (tan) tan.subVectors(b, a).normalize();
    return pos;
  }

  reversed(): Poly {
    return new Poly([...this.pts].reverse());
  }
}

/** 2D-Polylinie seitlich versetzen (rechts der Laufrichtung), Gehrung an Ecken */
export function offsetPath(pts: V2[], off: number): V2[] {
  if (pts.length < 2 || off === 0) return pts.map(p => ({ ...p }));
  const out: V2[] = [];
  const right = (a: V2, b: V2) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: -dz / l, z: dx / l };
  };
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) { const r = right(pts[0], pts[1]); out.push({ x: pts[0].x + r.x * off, z: pts[0].z + r.z * off }); continue; }
    if (i === pts.length - 1) { const r = right(pts[i - 1], pts[i]); out.push({ x: pts[i].x + r.x * off, z: pts[i].z + r.z * off }); continue; }
    const r0 = right(pts[i - 1], pts[i]), r1 = right(pts[i], pts[i + 1]);
    const mx = r0.x + r1.x, mz = r0.z + r1.z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-3) {
      // Kehrtwende: zwei Punkte
      out.push({ x: pts[i].x + r0.x * off, z: pts[i].z + r0.z * off });
      out.push({ x: pts[i].x + r1.x * off, z: pts[i].z + r1.z * off });
      continue;
    }
    const nx = mx / ml, nz = mz / ml;
    const cos = nx * r0.x + nz * r0.z;
    const len = off / Math.max(0.35, cos);
    out.push({ x: pts[i].x + nx * len, z: pts[i].z + nz * len });
  }
  return out;
}
