import * as THREE from 'three';
import type { Place } from '../layout/plan';
import type { Status } from '../data/types';
import { Bag } from './geo';
import { facadeMaterial, neon, MAT, cloneSurface, type FacadeParams } from './materials';
import type { Atlas, AtlasRect } from './textures';
import type { SignLayer, SignHandle, QuadOpts } from './signs';
import type { BeaconSet, BeaconRef, TreeSet } from './instanced';

/*
 * Baukontext eines einzelnen Bauwerks: sammelt Geometrie je Material in
 * lokalen Koordinaten (Front = +z), rechnet Schilder und Lichter in
 * Weltkoordinaten um und liefert am Ende die fertige Struktur.
 */

export type AnimFn = (dt: number, t: number) => void;

export interface BuildEnv {
  atlas: Atlas;
  signs: SignLayer;
  beacons: BeaconSet;
  trees: TreeSet;
  anims: AnimFn[];
}

export interface SvcSlot {
  pos: THREE.Vector3;      // Weltposition des Schilds
  normal: THREE.Vector3;   // Blickrichtung des Schilds
  foot: THREE.Vector3;     // Fußpunkt an der Fassade (Boden)
  sign?: SignHandle;
}

export interface Structure {
  id: string;
  kind: string;
  group: THREE.Group;
  pick: THREE.Object3D[];
  facades: THREE.MeshStandardMaterial[];
  glows: THREE.Material[];
  signs: SignHandle[];
  beacons: BeaconRef[];
  top: number;
  center: THREE.Vector3;
  labelAt: THREE.Vector3;
  radius: number;
  svc: Map<string, SvcSlot>;
  status: Status;
  power: number;
  /** vom Blackout unabhängige Statusanzeigen (Warnlicht, OFFLINE …) */
  statusSigns: SignHandle[];
  rotY: number;
  /** alle Materialien des Bauwerks (für das Ausblenden verdeckender Gebäude) */
  mats: THREE.Material[];
  ghost: number;
}

export class BuildCtx {
  readonly group = new THREE.Group();
  readonly facade = new Bag(true);
  readonly metal = new Bag();
  readonly dark = new Bag();
  readonly concrete = new Bag();
  readonly glass = new Bag();
  readonly roofBag = new Bag();
  private neons = new Map<string, { bag: Bag; intensity: number }>();
  private objs: THREE.Object3D[] = [];
  readonly s: Structure;
  readonly m: THREE.Matrix4;
  facadeMat: THREE.MeshStandardMaterial | null = null;

  constructor(readonly id: string, readonly place: Place, readonly env: BuildEnv, readonly rotY: number, kind: string, status: Status) {
    this.m = new THREE.Matrix4().compose(
      new THREE.Vector3(place.x, 0, place.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(1, 1, 1)
    );
    this.group.position.set(place.x, 0, place.z);
    this.group.rotation.y = rotY;
    this.group.name = 'Bauwerk ' + id;
    this.s = {
      id, kind, group: this.group, pick: [], facades: [], glows: [], signs: [], beacons: [],
      top: 0, center: new THREE.Vector3(place.x, 0, place.z), labelAt: new THREE.Vector3(place.x, 10, place.z),
      radius: 10, svc: new Map(), status, power: 1, statusSigns: [], rotY, mats: [], ghost: 1
    };
  }

  /** lokale → Weltkoordinaten */
  w(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.m);
  }

  useFacade(p: FacadeParams) {
    this.facadeMat = facadeMaterial({ ...p, vertexColors: true, color: '#ffffff' });
    this.s.facades.push(this.facadeMat);
  }

  neon(color: THREE.ColorRepresentation, intensity = 3.2): Bag {
    const key = new THREE.Color(color).getHexString() + '|' + intensity;
    let n = this.neons.get(key);
    if (!n) {
      n = { bag: new Bag(), intensity };
      this.neons.set(key, n);
    }
    return n.bag;
  }

  add(o: THREE.Object3D, glow?: THREE.Material | THREE.Material[]) {
    this.group.add(o);
    this.objs.push(o);
    if (glow) (Array.isArray(glow) ? glow : [glow]).forEach(g => this.s.glows.push(g));
    return o;
  }

  sign(rect: AtlasRect, w: number, h: number, x: number, y: number, z: number, rotY: number, o: QuadOpts = {}, status = false): SignHandle {
    const hnd = this.env.signs.quad(rect, w, h, this.w(x, y, z), rotY + this.rotY, o);
    if (status) this.s.statusSigns.push(hnd); else this.s.signs.push(hnd);
    return hnd;
  }

  beacon(x: number, y: number, z: number, color: THREE.ColorRepresentation, rate = 0.8, duty = 0.18, size = 0.35) {
    const b = this.env.beacons.add(this.w(x, y, z), color, rate, duty, size);
    this.s.beacons.push(b);
    return b;
  }

  tree(x: number, z: number, scale: number, color: THREE.ColorRepresentation, y = 0) {
    this.env.trees.add(this.w(x, y, z), scale, color, Math.random() * Math.PI);
  }

  anim(fn: AnimFn) {
    this.env.anims.push(fn);
  }

  slot(svcId: string, x: number, y: number, z: number, faceRot: number, sign?: SignHandle) {
    const pos = this.w(x, y, z);
    const normal = new THREE.Vector3(Math.sin(faceRot + this.rotY), 0, Math.cos(faceRot + this.rotY));
    const foot = pos.clone();
    foot.y = 0.2;
    this.s.svc.set(svcId, { pos, normal, foot, sign });
  }

  finish(top: number, radius: number, labelY?: number): Structure {
    const s = this.s;
    s.top = top;
    s.radius = radius;
    s.labelAt = new THREE.Vector3(this.place.x, (labelY ?? top) + 4, this.place.z);
    if (this.facadeMat) {
      const fm = this.facade.mesh(this.facadeMat, { name: 'Fassade ' + this.id });
      if (fm) { this.add(fm); s.pick.push(fm); }
    }
    const statics: Array<[Bag, THREE.Material, boolean]> = [
      [this.metal, MAT.metal, true], [this.dark, MAT.darkMetal, true], [this.concrete, MAT.concrete, true],
      [this.glass, MAT.glass, true], [this.roofBag, MAT.roof, true]
    ];
    statics.forEach(([bag, mat, pick]) => {
      if (bag.empty) return;
      // eigene Kopie je Bauwerk, damit es einzeln ausgeblendet werden kann
      const own = cloneSurface(mat);
      const mm = bag.mesh(own);
      if (mm) { this.add(mm); if (pick) s.pick.push(mm); }
    });
    this.neons.forEach((n, key) => {
      const mat = neon('#' + key.split('|')[0], n.intensity);
      const mm = n.bag.mesh(mat, { cast: false, receive: false });
      if (mm) { this.add(mm, mat); }
    });
    s.pick.forEach(p => { p.userData.pick = { kind: 'structure', id: this.id }; });
    // Materialliste für das Röntgen-Ausblenden
    const seen = new Set<THREE.Material>();
    this.group.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach(mat => {
        if (seen.has(mat)) return;
        seen.add(mat);
        mat.userData.baseOpacity = mat.opacity;
        mat.userData.baseTransparent = mat.transparent;
        mat.userData.baseDepthWrite = mat.depthWrite;
        s.mats.push(mat);
      });
    });
    return s;
  }
}
