import * as THREE from 'three';
import type { NpcModel } from '../sim/agents';
import { glowTexture } from './textures';

/*
 * NPC-Modelle: prozedurale Roboter, Drohnen, Claudes AV, Kurier- und
 * Spinnenbots, Passanten mit Leuchtschirm und Tailnet-Kapseln – jeweils mit
 * Lauf-/Flug-Animation und einem Leuchtring am Boden (auch aus der Ferne
 * gut zu erkennen).
 */

const glowTex = glowTexture();

export class NpcVisual {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly pick: THREE.Object3D[] = [];
  readonly ring: THREE.Mesh;
  height = 2.6;
  flying = false;
  private parts: Record<string, THREE.Object3D> = {};
  private lists: Record<string, THREE.Object3D[]> = {};
  private phase = Math.random() * 10;
  private accentMats: THREE.MeshBasicMaterial[] = [];
  private accentBase: THREE.Color[] = [];
  private shell: THREE.MeshStandardMaterial;
  selected = false;
  glowBoost = 0;

  constructor(readonly kind: NpcModel, readonly color: string, readonly id: string) {
    this.group.name = 'NPC ' + id;
    this.group.add(this.body);
    this.shell = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#1a1f2b'), 0.72), metalness: 0.75, roughness: 0.32, envMapIntensity: 1.4 });
    const ringMat = new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(color).multiplyScalar(1.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 3;
    this.group.add(this.ring);
    switch (kind) {
      case 'bot': this.buildBot(); break;
      case 'drone': this.buildDrone(); break;
      case 'av': this.buildAv(); break;
      case 'courier': this.buildCourier(); break;
      case 'spider': this.buildSpider(); break;
      case 'human': this.buildHuman(); break;
      case 'pod': this.buildPod(); break;
    }
    this.body.traverse(o => {
      if ((o as THREE.Mesh).isMesh && !o.userData.noPick) {
        o.userData.pick = { kind: 'npc', id };
        this.pick.push(o);
      }
    });
  }

  private accent(intensity = 3.5, color = this.color): THREE.MeshBasicMaterial {
    const c = new THREE.Color(color).multiplyScalar(intensity);
    const m = new THREE.MeshBasicMaterial({ color: c });
    this.accentMats.push(m);
    this.accentBase.push(c.clone());
    return m;
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.body) {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  }

  private limb(len: number, r: number, x: number, y: number, parent: THREE.Object3D, m: THREE.Material) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const g = new THREE.CapsuleGeometry(r, len, 4, 8);
    g.translate(0, -len / 2 - r, 0);
    pivot.add(new THREE.Mesh(g, m));
    parent.add(pivot);
    return pivot;
  }

  /* ---------------- Modelle ---------------- */

  private buildBot() {
    const dark = new THREE.MeshStandardMaterial({ color: '#141821', metalness: 0.6, roughness: 0.5 });
    this.mesh(new THREE.CapsuleGeometry(0.55, 0.7, 6, 14), this.shell, 0, 1.62);
    const head = this.mesh(new THREE.SphereGeometry(0.42, 18, 12), this.shell, 0, 2.52);
    this.mesh(new THREE.BoxGeometry(0.62, 0.15, 0.2), this.accent(4), 0, 2.55, 0.34);
    this.mesh(new THREE.BoxGeometry(0.34, 0.2, 0.1), this.accent(2.6), 0, 1.72, 0.56);
    this.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), dark, 0.18, 3.05);
    this.mesh(new THREE.SphereGeometry(0.08, 8, 6), this.accent(5), 0.18, 3.32);
    this.parts.head = head;
    // Ohrscheiben, Brustpaneel, Schulterpolster, Rückenmodul mit Status-LED
    for (const sx of [-1, 1]) {
      const ear = this.mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.09, 12), dark, sx * 0.42, 2.52, 0);
      ear.rotation.z = Math.PI / 2;
      this.mesh(new THREE.SphereGeometry(0.2, 12, 8), dark, sx * 0.62, 2.14, 0);
    }
    this.mesh(new THREE.BoxGeometry(0.5, 0.04, 0.05), dark, 0, 1.95, 0.55);
    this.mesh(new THREE.BoxGeometry(0.5, 0.04, 0.05), dark, 0, 1.5, 0.55);
    this.mesh(new THREE.BoxGeometry(0.72, 0.8, 0.34), this.shell, 0, 1.78, -0.56);
    this.mesh(new THREE.BoxGeometry(0.5, 0.06, 0.05), this.accent(2.2), 0, 2.02, -0.74);
    this.parts.led = this.mesh(new THREE.SphereGeometry(0.06, 8, 6), this.accent(5, '#7dff9a'), 0.22, 1.62, -0.74);
    this.parts.legL = this.limb(0.55, 0.14, -0.24, 1.12, this.body, dark);
    this.parts.legR = this.limb(0.55, 0.14, 0.24, 1.12, this.body, dark);
    this.parts.armL = this.limb(0.5, 0.11, -0.7, 2.02, this.body, this.shell);
    this.parts.armR = this.limb(0.5, 0.11, 0.7, 2.02, this.body, this.shell);
    for (const leg of [this.parts.legL, this.parts.legR]) this.mesh(new THREE.BoxGeometry(0.28, 0.12, 0.44), dark, 0, -0.86, 0.07, leg);
    for (const arm of [this.parts.armL, this.parts.armR]) this.mesh(new THREE.SphereGeometry(0.13, 10, 8), dark, 0, -0.74, 0, arm);
    // Datenwürfel: der Agent trägt seine Anfrage
    const cube = new THREE.Group();
    cube.position.set(0, 1.55, 0.85);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.34, 0.34, 0.34)), new THREE.LineBasicMaterial({ color: new THREE.Color(this.color).multiplyScalar(3.5) }));
    edges.userData.noPick = true;
    cube.add(edges);
    this.mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), this.accent(3), 0, 0, 0, cube).userData.noPick = true;
    this.body.add(cube);
    this.parts.cube = cube;
    this.height = 3.5;
  }

  private buildDrone() {
    const dark = new THREE.MeshStandardMaterial({ color: '#141821', metalness: 0.7, roughness: 0.4 });
    this.mesh(new THREE.CylinderGeometry(0.72, 0.85, 0.34, 18), this.shell, 0, 0);
    this.mesh(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.shell, 0, 0.17);
    this.mesh(new THREE.TorusGeometry(0.86, 0.05, 6, 32), this.accent(4), 0, 0.02).rotation.x = Math.PI / 2;
    const rotors: THREE.Object3D[] = [];
    // Positionslichter: rot links, grün rechts
    const nav: THREE.Object3D[] = [];
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      nav.push(this.mesh(new THREE.SphereGeometry(0.07, 8, 6), this.accent(5, dx > 0 ? '#3dff7a' : '#ff2a3a'), dx * 1.08, 0.02, dz * 1.08));
    }
    this.lists.nav = nav;
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const arm = this.mesh(new THREE.BoxGeometry(0.12, 0.08, 1.5), dark, dx * 0.55, 0.05, dz * 0.55);
      arm.rotation.y = Math.atan2(dx, dz);
      this.mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8), dark, dx * 1.08, 0.12, dz * 1.08);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.02, 0.12), new THREE.MeshStandardMaterial({ color: '#2a3140', metalness: 0.5, roughness: 0.4, transparent: true, opacity: 0.7 }));
      blade.position.set(dx * 1.08, 0.24, dz * 1.08);
      this.body.add(blade);
      rotors.push(blade);
    }
    this.lists.rotors = rotors;
    // Suchlicht nach unten
    const cone = new THREE.ConeGeometry(1.8, 5, 20, 1, true);
    cone.translate(0, -2.6, 0);
    const cm = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.color).multiplyScalar(0.4), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(cone, cm);
    beam.userData.noPick = true;
    this.body.add(beam);
    this.parts.beam = beam;
    this.flying = true;
    this.height = 1.4;
  }

  private buildAv() {
    const dark = new THREE.MeshStandardMaterial({ color: '#10131a', metalness: 0.8, roughness: 0.3 });
    const hull = new THREE.MeshStandardMaterial({ color: '#d9cbb8', metalness: 0.85, roughness: 0.25, envMapIntensity: 1.6 });
    this.mesh(new THREE.BoxGeometry(2.1, 0.8, 3.8), hull, 0, 0, -0.2);
    const nose = new THREE.ConeGeometry(1.05, 1.6, 4, 1);
    nose.rotateX(Math.PI / 2);
    nose.rotateZ(Math.PI / 4);
    nose.scale(1, 0.55, 1);
    this.mesh(nose, hull, 0, -0.05, 2.45);
    const glass = new THREE.MeshStandardMaterial({ color: '#0c1a2a', metalness: 0.95, roughness: 0.05, envMapIntensity: 2 });
    this.mesh(new THREE.BoxGeometry(1.5, 0.55, 1.9), glass, 0, 0.62, 0.3);
    for (const [dx, dz] of [[1, 1.2], [-1, 1.2], [1, -1.6], [-1, -1.6]]) {
      this.mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.5, 14), dark, dx * 1.25, -0.2, dz);
      this.mesh(new THREE.TorusGeometry(0.33, 0.06, 6, 20), this.accent(4.5), dx * 1.25, -0.48, dz).rotation.x = Math.PI / 2;
    }
    this.mesh(new THREE.BoxGeometry(1.7, 0.1, 0.08), this.accent(5, '#fff4e0'), 0, 0.05, 3.05);
    this.mesh(new THREE.BoxGeometry(2.0, 0.12, 0.08), this.accent(4, '#ff3048'), 0, 0.1, -2.12);
    this.mesh(new THREE.BoxGeometry(0.08, 0.08, 3.6), this.accent(3), 1.07, 0.1, -0.2);
    this.mesh(new THREE.BoxGeometry(0.08, 0.08, 3.6), this.accent(3), -1.07, 0.1, -0.2);
    this.flying = true;
    this.height = 1.6;
  }

  private buildCourier() {
    const dark = new THREE.MeshStandardMaterial({ color: '#12151c', metalness: 0.5, roughness: 0.6 });
    this.mesh(new THREE.BoxGeometry(1.3, 0.95, 1.8), this.shell, 0, 0.95);
    this.mesh(new THREE.BoxGeometry(1.34, 0.12, 1.84), this.accent(3.2), 0, 1.18);
    this.mesh(new THREE.BoxGeometry(0.9, 0.3, 0.1), this.accent(4, '#fff4e0'), 0, 0.95, 0.92);
    const wheels: THREE.Object3D[] = [];
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 14), dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(dx * 0.66, 0.3, dz * 0.6);
      this.body.add(w);
      wheels.push(w);
    }
    this.lists.wheels = wheels;
    this.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), dark, -0.45, 1.85, -0.6);
    this.mesh(new THREE.SphereGeometry(0.11, 8, 6), this.accent(5), -0.45, 2.32, -0.6);
    this.height = 2.4;
  }

  private buildSpider() {
    const dark = new THREE.MeshStandardMaterial({ color: '#12151c', metalness: 0.6, roughness: 0.45 });
    const b = this.mesh(new THREE.SphereGeometry(0.62, 16, 10), this.shell, 0, 1.0);
    b.scale.set(1, 0.6, 1.25);
    this.mesh(new THREE.SphereGeometry(0.2, 10, 8), this.accent(5), 0, 1.08, 0.72);
    const legs: THREE.Object3D[] = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const k = i % 3;
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.45, 1.0, (k - 1) * 0.45);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.08), dark);
      leg.position.x = side * 0.5;
      leg.rotation.z = side * -0.55;
      pivot.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), dark);
      foot.position.set(side * 1.0, -0.55, 0);
      pivot.add(foot);
      this.body.add(pivot);
      legs.push(pivot);
    }
    this.lists.legs = legs;
    this.height = 2;
  }

  private buildHuman() {
    const skin = new THREE.MeshStandardMaterial({ color: '#b98a6a', roughness: 0.7 });
    const jacket = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.color).multiplyScalar(0.35), roughness: 0.55, metalness: 0.2 });
    const pants = new THREE.MeshStandardMaterial({ color: '#15181f', roughness: 0.8 });
    this.mesh(new THREE.CapsuleGeometry(0.3, 0.55, 4, 10), jacket, 0, 1.42);
    this.mesh(new THREE.SphereGeometry(0.22, 12, 10), skin, 0, 2.1);
    const hair = new THREE.MeshStandardMaterial({ color: '#16110f', roughness: 0.8 });
    this.mesh(new THREE.SphereGeometry(0.235, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 2.12, -0.02);
    this.parts.legL = this.limb(0.5, 0.11, -0.14, 1.02, this.body, pants);
    this.parts.legR = this.limb(0.5, 0.11, 0.14, 1.02, this.body, pants);
    this.parts.armL = this.limb(0.42, 0.085, -0.36, 1.78, this.body, jacket);
    this.parts.armR = this.limb(0.42, 0.085, 0.36, 1.78, this.body, jacket);
    // leuchtendes Handy: der Shop-Kunde stöbert
    this.mesh(new THREE.BoxGeometry(0.11, 0.2, 0.025), this.accent(3.2, '#a8ecff'), 0, -0.62, 0.1, this.parts.armL).userData.noPick = true;
    // Leuchtschirm
    this.mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 5), pants, 0.28, 2.2);
    const umb = new THREE.ConeGeometry(0.95, 0.38, 18, 1, true);
    this.mesh(umb, new THREE.MeshStandardMaterial({ color: '#0d1018', roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), 0.28, 2.82);
    this.mesh(new THREE.TorusGeometry(0.95, 0.03, 6, 28), this.accent(4), 0.28, 2.63).rotation.x = Math.PI / 2;
    this.height = 3.1;
  }

  private buildPod() {
    const g = new THREE.CapsuleGeometry(0.9, 2.8, 6, 16);
    g.rotateX(Math.PI / 2);
    this.mesh(g, this.shell, 0, 1.0);
    this.mesh(new THREE.BoxGeometry(1.84, 0.28, 2.6), this.accent(3.6), 0, 1.25);
    this.mesh(new THREE.BoxGeometry(1.2, 0.08, 3.4), this.accent(2.4), 0, 0.12);
    this.height = 2.2;
  }

  /* ---------------- Animation ---------------- */

  update(dt: number, t: number, moving: boolean, speed: number, working: boolean) {
    const s = moving ? speed : 0;
    this.phase += dt * (moving ? 2.2 + s * 0.35 : 0);
    const p = this.phase;
    const swing = moving ? Math.sin(p * 2) : 0;
    switch (this.kind) {
      case 'bot':
      case 'human': {
        const amp = this.kind === 'bot' ? 0.55 : 0.6;
        (this.parts.legL as THREE.Object3D).rotation.x = swing * amp;
        (this.parts.legR as THREE.Object3D).rotation.x = -swing * amp;
        if (this.parts.armL) {
          (this.parts.armL as THREE.Object3D).rotation.x = -swing * 0.5 + (working ? Math.sin(t * 9) * 0.6 - 0.8 : 0);
          (this.parts.armR as THREE.Object3D).rotation.x = swing * 0.5 + (working ? Math.sin(t * 9 + 1.3) * 0.6 - 0.8 : 0);
        }
        this.body.position.y = moving ? Math.abs(Math.sin(p * 2)) * 0.12 : Math.sin(t * 1.6) * 0.03;
        if (this.parts.head) (this.parts.head as THREE.Object3D).rotation.y = working ? Math.sin(t * 2.4) * 0.5 : 0;
        if (this.parts.cube) {
          const c = this.parts.cube;
          c.rotation.set(t * 1.3, t * 1.9, 0);
          c.position.y = 1.55 + Math.sin(t * 3 + p) * 0.06 + (working ? 0.45 : 0);
          c.visible = moving || working;
        }
        if (this.parts.led) this.parts.led.visible = Math.sin(t * 5 + this.phase) > -0.3;
        break;
      }
      case 'drone': {
        this.lists.rotors.forEach((r, i) => { r.rotation.y = t * 38 + i; });
        const blink = Math.sin(t * 6) > 0.6;
        this.lists.nav.forEach(n => { n.visible = blink; });
        this.body.position.y = Math.sin(t * 2.1 + p) * 0.25;
        this.body.rotation.x = moving ? 0.18 : 0;
        const beam = this.parts.beam as THREE.Mesh;
        beam.visible = working || this.selected;
        break;
      }
      case 'av': {
        this.body.position.y = Math.sin(t * 1.3) * 0.25;
        this.body.rotation.z = moving ? Math.sin(t * 0.7) * 0.06 : 0;
        this.body.rotation.x = moving ? 0.05 : 0;
        break;
      }
      case 'courier': {
        this.lists.wheels.forEach(w => { w.rotation.x += dt * s * 3; });
        this.body.position.y = moving ? Math.sin(p * 6) * 0.03 : 0;
        break;
      }
      case 'spider': {
        this.lists.legs.forEach((l, i) => { l.rotation.y = moving ? Math.sin(p * 3 + i * 1.7) * 0.35 : Math.sin(t + i) * 0.05; });
        this.body.position.y = moving ? Math.abs(Math.sin(p * 3)) * 0.08 : 0;
        break;
      }
      case 'pod': {
        this.body.position.y = Math.sin(t * 2 + p) * 0.05;
        break;
      }
    }
    // Leuchtring folgt am Boden, pulsiert bei Arbeit/Auswahl
    const ringMat = this.ring.material as THREE.MeshBasicMaterial;
    const pulse = this.selected ? 1.4 + Math.sin(t * 6) * 0.4 : working ? 1.0 + Math.sin(t * 8) * 0.3 : 0.75;
    ringMat.opacity = Math.min(1, pulse);
    const sc = this.selected ? 1.5 : 1;
    this.ring.scale.set(sc, sc, sc);
    this.ring.position.y = (this.flying ? -this.group.position.y : 0) + 0.3;
    // Akzente: bei Auswahl heller
    const boost = 1 + this.glowBoost + (this.selected ? 0.5 : 0);
    this.accentMats.forEach((m, i) => m.color.copy(this.accentBase[i]).multiplyScalar(boost));
  }
}
