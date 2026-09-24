import * as THREE from 'three';
import { model } from '../data/model';
import { plan, P } from '../layout/plan';
import { Atlas } from './textures';
import { SignLayer } from './signs';
import { BeaconSet, TreeSet } from './instanced';
import type { BuildEnv, Structure } from './buildctx';
import { buildStructure } from './buildings';
import { buildStreets, type StreetsResult } from './streets';
import { buildDecor } from './decor';
import { buildProps } from './props';
import { setPower, holoMaterial } from './materials';
import type { Core } from './core';
import type { Fx } from './fx';

/*
 * Baut die ganze Stadt aus Plan + Daten zusammen und verwaltet Zustände
 * pro Bauwerk: Strom (Ausfall-Simulation), Auswahl und Hover-Rahmen.
 */

export class City {
  readonly env: BuildEnv;
  readonly structures = new Map<string, Structure>();
  readonly root = new THREE.Group();
  readonly streets: StreetsResult;
  readonly pickables: THREE.Object3D[] = [];
  private selBox: THREE.LineSegments;
  private hovBox: THREE.LineSegments;
  private selBeam: THREE.Mesh;
  private selectedId: string | null = null;
  private bounds = new Map<string, THREE.Box3>();
  steam: THREE.Vector3[] = [];

  constructor(core: Core) {
    this.root.name = 'Stadt';
    const atlas = new Atlas(2048);
    const signs = new SignLayer(atlas);
    const beacons = new BeaconSet();
    const trees = new TreeSet();
    this.env = { atlas, signs, beacons, trees, anims: [] };

    // Bauwerke: jeder Knoten mit einem Platz (keine Gruppen, keine Dienste)
    plan.places.forEach((place, id) => {
      const n = model.find(id);
      if (!n || n.t === 'group' || n.t === 'svc') return;
      const s = buildStructure(id, place, this.env);
      this.structures.set(id, s);
      this.root.add(s.group);
    });

    this.streets = buildStreets(atlas, signs, beacons);
    this.root.add(this.streets.group);
    const decor = buildDecor(this.env);
    this.root.add(decor.group);
    this.steam = decor.steam;
    this.root.add(buildProps(this.env, this.streets.lamps));

    signs.build();
    this.root.add(signs.group);
    beacons.build(this.root);
    trees.build(this.root);
    core.scene.add(this.root);
    this.root.updateMatrixWorld(true);

    // Unsichtbare Klick-Körper: das ganze Volumen des Bauwerks ist anklickbar
    // (auch Lücken zwischen Zwillingstürmen), und der Raycast bleibt billig.
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    this.structures.forEach((s, id) => {
      const b = new THREE.Box3().setFromObject(s.group);
      if (b.isEmpty()) b.setFromCenterAndSize(s.center.clone().setY(5), new THREE.Vector3(8, 10, 8));
      this.bounds.set(id, b);
      // echte Meshes bleiben anklickbar; dazu ein Kasten um die Fassade (Hauptmasse),
      // damit auch Lücken (Zwillingstürme) treffen, ohne Nachbarn zu verdecken
      s.pick.forEach(m => this.pickables.push(m));
      s.pick.filter(m => m.name.startsWith('Fassade')).forEach(m => {
        const pb = new THREE.Box3().setFromObject(m);
        if (pb.isEmpty()) return;
        const size = pb.getSize(new THREE.Vector3()).max(new THREE.Vector3(1.5, 0.4, 1.5));
        const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), proxyMat);
        proxy.position.copy(pb.getCenter(new THREE.Vector3()));
        proxy.visible = false;
        proxy.userData.pick = { kind: 'structure', id };
        proxy.name = 'Klickkörper ' + id;
        this.root.add(proxy);
        proxy.updateMatrixWorld(true);
        this.pickables.push(proxy);
      });
    });

    // Auswahlrahmen (Scanner-Stil) und Hover-Rahmen
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const selMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#fcee0a').multiplyScalar(3), transparent: true, opacity: 0.95, depthTest: false });
    this.selBox = new THREE.LineSegments(edges, selMat);
    this.selBox.visible = false;
    this.selBox.renderOrder = 20;
    const hovMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#00f0ff').multiplyScalar(2), transparent: true, opacity: 0.6, depthTest: false });
    this.hovBox = new THREE.LineSegments(edges, hovMat);
    this.hovBox.visible = false;
    this.hovBox.renderOrder = 19;
    const beamG = new THREE.CylinderGeometry(0.4, 0.4, 1, 12, 1, true);
    beamG.translate(0, 0.5, 0);
    this.selBeam = new THREE.Mesh(beamG, holoMaterial('#fcee0a', { opacity: 0.6, density: 0.6, speed: 3 }));
    this.selBeam.visible = false;
    core.scene.add(this.selBox, this.hovBox, this.selBeam);

    core.onUpdate((dt, t) => {
      this.env.anims.forEach(f => f(dt, t));
      if (this.selBox.visible) {
        const m = this.selBox.material as THREE.LineBasicMaterial;
        m.opacity = 0.7 + Math.sin(t * 4) * 0.25;
      }
    });
  }

  /** Emitter (Rauch/Dampf/Hitze) für die Effekte eintragen */
  registerEmitters(fx: Fx) {
    this.structures.forEach(s => {
      const smoke = s.group.userData.smoke as THREE.Vector3[] | undefined;
      smoke?.forEach(p => fx.addEmitter(p, 'smoke'));
    });
    this.steam.forEach(p => fx.addEmitter(p, 'steam'));
    // Hitze über dem AI-Node (87 °C am 23.09.)
    const ai = this.structures.get('pve-ai');
    if (ai) {
      const top = ai.top - 9;
      for (const [dx, dz] of [[-5.5, -5.5], [5.5, -5.5], [-5.5, 5.5], [5.5, 5.5]]) fx.addEmitter(new THREE.Vector3(ai.center.x + dx, top + 4.5, ai.center.z + dz), 'heat');
    }
    // defekter Dienst (Webmail 502) qualmt auf der Mail-VM
    model.nodes.filter(n => n.t === 'svc' && n.st === 'crit').forEach(n => {
      const s = n.parent ? this.structures.get(n.parent) : undefined;
      if (s) fx.addEmitter(new THREE.Vector3(s.center.x - 2, s.top + 0.5, s.center.z - 2), 'smoke');
    });
    // Gullydampf an einigen Kreuzungen
    let k = 0;
    plan.nodes.forEach(n => {
      if (k > 9 || (n.i * 7 + n.j * 13) % 11 !== 0) return;
      if (n.z > plan.bounds.z1) return;
      fx.addEmitter(new THREE.Vector3(n.x + 1.8, 0.3, n.z + 1.8), 'steam');
      k++;
    });
    fx.buildParticles();
  }

  structureOf(id: string): Structure | undefined {
    const sid = model.structureOf(id);
    return sid ? this.structures.get(sid) : undefined;
  }

  boundsOf(id: string): THREE.Box3 | null {
    const sid = model.structureOf(id);
    return sid ? this.bounds.get(sid) || null : null;
  }

  /** Strom eines Bauwerks (0 = Blackout, 1 = normal, dazwischen = flackernd/gedimmt) */
  setStructurePower(id: string, power: number) {
    const s = this.structures.get(id);
    if (!s) return;
    s.power = power;
    s.facades.forEach(m => setPower(m, power));
    s.glows.forEach(m => setPower(m, power));
    s.signs.forEach(h => this.env.signs.setPower(h, power * (s.ghost < 0.995 ? s.ghost * 0.5 : 1)));
    s.beacons.forEach(b => this.env.beacons.setPower(b, power));
  }

  select(id: string | null) {
    this.selectedId = id;
    const b = id ? this.boundsOf(id) : null;
    if (!b) {
      this.selBox.visible = false;
      this.selBeam.visible = false;
      return;
    }
    this.frameBox(this.selBox, b, 1.8);
    const c = b.getCenter(new THREE.Vector3());
    this.selBeam.position.set(c.x, b.max.y + 1, c.z);
    this.selBeam.scale.set(1, 60, 1);
    this.selBeam.visible = true;
  }

  hover(id: string | null) {
    const b = id && id !== this.selectedId ? this.boundsOf(id) : null;
    if (!b) { this.hovBox.visible = false; return; }
    this.frameBox(this.hovBox, b, 1.2);
  }

  private frameBox(box: THREE.LineSegments, b: THREE.Box3, pad: number) {
    const size = b.getSize(new THREE.Vector3()).addScalar(pad);
    const c = b.getCenter(new THREE.Vector3());
    box.position.copy(c);
    box.scale.copy(size);
    box.visible = true;
  }

  /** Bauwerke, die zwischen Kamera und Blickziel stehen, weich ausblenden */
  updateGhosts(camera: THREE.Vector3, focus: THREE.Vector3, focusId: string | null, dt: number) {
    this.ghostAcc += dt;
    if (this.ghostAcc > 0.1) {
      this.ghostAcc = 0;
      this.ghostWant.clear();
      const dir = focus.clone().sub(camera);
      const len = dir.length();
      if (len > 1) {
        const ray = new THREE.Ray(camera.clone(), dir.normalize());
        const hit = new THREE.Vector3();
        this.bounds.forEach((b, id) => {
          if (id === focusId) return;
          if (b.containsPoint(focus)) return;
          if (!ray.intersectBox(b, hit)) return;
          if (hit.distanceTo(camera) < len - 6) this.ghostWant.add(id);
        });
      }
    }
    this.structures.forEach((s, id) => {
      const want = this.ghostWant.has(id) ? 0.12 : 1;
      if (Math.abs(s.ghost - want) < 0.001) return;
      s.ghost += (want - s.ghost) * Math.min(1, dt * 7);
      if (Math.abs(s.ghost - want) < 0.01) s.ghost = want;
      this.applyGhost(s);
    });
  }

  private ghostWant = new Set<string>();
  private ghostAcc = 1;

  private applyGhost(s: Structure) {
    const o = s.ghost;
    const faded = o < 0.995;
    s.mats.forEach(m => {
      const baseO = (m.userData.baseOpacity as number) ?? 1;
      const baseT = !!m.userData.baseTransparent;
      const baseD = m.userData.baseDepthWrite !== false;
      const wasT = m.transparent;
      m.transparent = faded || baseT;
      m.opacity = baseO * o;
      m.depthWrite = faded ? false : baseD;
      const sh = m as THREE.ShaderMaterial;
      if (sh.uniforms?.uOpacity && sh.userData.baseUOpacity == null) sh.userData.baseUOpacity = sh.uniforms.uOpacity.value;
      if (sh.uniforms?.uOpacity) sh.uniforms.uOpacity.value = (sh.userData.baseUOpacity as number) * o;
      if (wasT !== m.transparent) m.needsUpdate = true;
    });
    s.signs.forEach(h => this.env.signs.setPower(h, s.power * (faded ? o * 0.5 : 1)));
    s.statusSigns.forEach(h => this.env.signs.setPower(h, faded ? o * 0.5 : 1));
  }

  /** Mittelpunkt eines Viertels (für Schnellsprünge) */
  districtCenter(id: string): THREE.Vector3 | null {
    const d = plan.districts.find(x => x.id === id);
    if (!d) return null;
    return new THREE.Vector3((d.c0 + d.cols / 2) * P, 0, (d.r0 + d.rows / 2) * P);
  }
}
