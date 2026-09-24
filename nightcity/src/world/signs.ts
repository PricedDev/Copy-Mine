import * as THREE from 'three';
import type { Atlas, AtlasRect } from './textures';
import { SignMaterials } from './materials';

/*
 * Alle Schilder der Stadt landen in wenigen großen Meshes (eins je Atlasseite
 * und Mischmodus). Jedes Schild behält einen Griff, über den Strom (Blackout)
 * und Flackern einzeln geschaltet werden.
 */

export type SignFx = 0 | 1 | 2 | 3; // 0 ruhig · 1 kaputt flackernd · 2 pulsierend · 3 blinkend

export interface SignHandle {
  key: string;
  vtx: number;      // erster Vertex im Layer
  base: THREE.Color;
  fx: SignFx;
  seed: number;
}

interface Buf {
  page: number;
  additive: boolean;
  pos: number[];
  uv: number[];
  col: number[];
  fx: number[];
  idx: number[];
  mesh?: THREE.Mesh;
}

export interface QuadOpts {
  additive?: boolean;
  color?: THREE.ColorRepresentation;
  intensity?: number;
  fx?: SignFx;
  seed?: number;
  /** Neigung nach hinten (Dachschilder) */
  tilt?: number;
  /** flach auf den Boden legen */
  ground?: boolean;
}

export class SignLayer {
  private bufs = new Map<string, Buf>();
  private mats: SignMaterials;
  readonly group = new THREE.Group();

  constructor(readonly atlas: Atlas) {
    this.mats = new SignMaterials(atlas);
    this.group.name = 'Schilder';
  }

  quad(rect: AtlasRect, w: number, h: number, pos: THREE.Vector3, rotY: number, o: QuadOpts = {}): SignHandle {
    const additive = !!o.additive;
    const key = rect.page + (additive ? 'a' : 'n');
    let b = this.bufs.get(key);
    if (!b) {
      b = { page: rect.page, additive, pos: [], uv: [], col: [], fx: [], idx: [] };
      this.bufs.set(key, b);
    }
    const right = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
    let up = new THREE.Vector3(0, 1, 0);
    if (o.ground) {
      up = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY)).negate();
    } else if (o.tilt) {
      up.applyAxisAngle(right, -o.tilt);
    }
    const hw = w / 2, hh = h / 2;
    const corners = [
      pos.clone().addScaledVector(right, -hw).addScaledVector(up, -hh),
      pos.clone().addScaledVector(right, hw).addScaledVector(up, -hh),
      pos.clone().addScaledVector(right, hw).addScaledVector(up, hh),
      pos.clone().addScaledVector(right, -hw).addScaledVector(up, hh)
    ];
    const uvs = [[rect.u0, rect.v0], [rect.u1, rect.v0], [rect.u1, rect.v1], [rect.u0, rect.v1]];
    const base = new THREE.Color(o.color ?? '#ffffff').multiplyScalar((o.intensity ?? 1.8) * 0.8);
    const fx = o.fx ?? 0;
    const seed = o.seed ?? Math.random();
    const vtx = b.pos.length / 3;
    corners.forEach((c, i) => {
      b!.pos.push(c.x, c.y, c.z);
      b!.uv.push(uvs[i][0], uvs[i][1]);
      b!.col.push(base.r, base.g, base.b);
      b!.fx.push(fx, seed);
    });
    b.idx.push(vtx, vtx + 1, vtx + 2, vtx, vtx + 2, vtx + 3);
    return { key, vtx, base, fx, seed };
  }

  build() {
    this.bufs.forEach(b => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      const col = new THREE.Float32BufferAttribute(b.col, 3);
      col.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aCol', col);
      const fx = new THREE.Float32BufferAttribute(b.fx, 2);
      fx.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aFx', fx);
      g.setIndex(b.idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.mats.get(b.page, b.additive));
      m.renderOrder = b.additive ? 6 : 2;
      m.frustumCulled = false;
      b.mesh = m;
      this.group.add(m);
    });
  }

  setPower(h: SignHandle, power: number) {
    const b = this.bufs.get(h.key);
    if (!b?.mesh) return;
    const a = b.mesh.geometry.getAttribute('aCol') as THREE.BufferAttribute;
    for (let i = 0; i < 4; i++) a.setXYZ(h.vtx + i, h.base.r * power, h.base.g * power, h.base.b * power);
    a.needsUpdate = true;
  }

  setFx(h: SignHandle, fx: SignFx) {
    const b = this.bufs.get(h.key);
    if (!b?.mesh) return;
    const a = b.mesh.geometry.getAttribute('aFx') as THREE.BufferAttribute;
    for (let i = 0; i < 4; i++) a.setXY(h.vtx + i, fx, h.seed);
    a.needsUpdate = true;
  }
}
