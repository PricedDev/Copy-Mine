import * as THREE from 'three';
import { plan } from '../layout/plan';
import { Bag, rng, seedOf } from './geo';
import { MAT } from './materials';
import { boardSign, neonWord, FONT_UI } from './textures';
import type { BuildEnv } from './buildctx';

/*
 * Freie Grundstücke: keine Fantasie-Infrastruktur, sondern Stadtleben –
 * Nachtmarkt, Neon-Garten mit Koiteich, Parks, Baugrund (Platz für neue
 * Gäste), Zollhof am Tor und Docks auf der Insel.
 */

interface DecorOut { group: THREE.Group; steam: THREE.Vector3[]; }

export function buildDecor(env: BuildEnv): DecorOut {
  const group = new THREE.Group();
  group.name = 'Stadtleben';
  const steam: THREE.Vector3[] = [];
  const metal = new Bag(), dark = new Bag(), concrete = new Bag(), grass = new Bag(), water = new Bag();
  const neonBags = new Map<string, Bag>();
  const neon = (c: string) => { let b = neonBags.get(c); if (!b) { b = new Bag(); neonBags.set(c, b); } return b; };
  const vc = new Bag(true);
  const fish: Array<{ mesh: THREE.Mesh; cx: number; cz: number; r: number; sp: number; ph: number }> = [];
  const boats: THREE.Object3D[] = [];
  const cranes: THREE.Object3D[] = [];

  plan.lots.filter(l => l.kind === 'decor').forEach(l => {
    const r = rng(seedOf(l.id));
    const cx = l.cx, cz = l.cz, W = l.x1 - l.x0, D = l.z1 - l.z0;
    switch (l.decor) {
      case 'park': {
        grass.plane(W - 2, D - 2, cx, 0.19, cz);
        concrete.box(W - 2, 0.04, 1.6, cx, 0.17, cz);
        concrete.box(1.6, 0.04, D - 2, cx, 0.17, cz);
        for (let i = 0; i < 6; i++) {
          const x = cx + (r() - 0.5) * (W - 5), z = cz + (r() - 0.5) * (D - 5);
          if (Math.abs(x - cx) < 1.6 || Math.abs(z - cz) < 1.6) continue;
          env.trees.add(new THREE.Vector3(x, 0.18, z), 0.9 + r() * 0.6, ['#1b8f7a', '#6a3cff', '#ff2a6d', '#2ec5ff'][Math.floor(r() * 4)], r() * 6);
        }
        bench(dark, cx + 3, cz + 1.4, 0);
        bench(dark, cx - 3, cz - 1.4, Math.PI);
        break;
      }
      case 'plaza': {
        concrete.box(W - 1, 0.05, D - 1, cx, 0.16, cz);
        const hm = new THREE.Mesh(new THREE.OctahedronGeometry(1.6, 0), holo(env, l.district === 'd-pve-ai' ? '#00e5ff' : l.district === 'd-pve-print' ? '#fcee0a' : '#ff3b30'));
        hm.position.set(cx, 5, cz);
        group.add(hm);
        env.anims.push((_dt, t) => { hm.rotation.y = t * 0.8; hm.position.y = 5 + Math.sin(t * 1.3 + cx) * 0.4; });
        metal.cyl(1.4, 1.8, 2.2, cx, 0.2, cz, 16);
        neon('#2ec5ff').torus(1.42, 0.06, cx, 2.3, cz);
        for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) env.trees.add(new THREE.Vector3(cx + dx, 0.2, cz + dz), 1.0, '#1b8f7a', r() * 6);
        bench(dark, cx, cz + 5, 0);
        bench(dark, cx, cz - 5, Math.PI);
        break;
      }
      case 'market': {
        const foods = ['RAMEN', 'BAO', 'DÖNER', 'NUDELN', 'TACOS', 'SUSHI', 'KAFFEE', 'CURRY'];
        const cols = ['#ff2a6d', '#fcee0a', '#2ec5ff', '#ff8a2a', '#7dff5a', '#b46bff'];
        for (let i = 0; i < 4; i++) {
          const sx = cx + (i % 2 ? 4.8 : -4.8), sz = cz + (i < 2 ? -4.5 : 4.5);
          const col = cols[Math.floor(r() * cols.length)];
          vc.box(4.2, 2.4, 2.6, sx, 0.2, sz, 0, '#3a2f2a');
          vc.box(4.8, 0.2, 3.4, sx, 2.9, sz + 0.3, 0, col);
          neon(col).box(4.8, 0.08, 0.08, sx, 2.85, sz + 2.0);
          dark.box(0.1, 2.9, 0.1, sx - 2.3, 0.2, sz + 1.9);
          dark.box(0.1, 2.9, 0.1, sx + 2.3, 0.2, sz + 1.9);
          const food = foods[Math.floor(r() * foods.length)];
          const rect = neonWord(env.atlas, food, col, { h: 90, font: FONT_UI, weight: 700, pad: 0.4 });
          env.signs.quad(rect, 2.6, 2.6 * rect.h / rect.w, new THREE.Vector3(sx, 3.45, sz + 2.02), 0, { additive: true, intensity: 1.8, fx: r() > 0.8 ? 1 : 0, seed: r() });
          for (let k = 0; k < 3; k++) env.beacons.add(new THREE.Vector3(sx - 1.6 + k * 1.6, 2.75, sz + 1.95), k % 2 ? '#ff5a3a' : '#ffb46b', 0, 1, 0.22);
          steam.push(new THREE.Vector3(sx, 2.8, sz));
          // Tisch + Hocker
          metal.cyl(0.6, 0.6, 0.08, sx, 1.0, sz + 3.6, 12);
          dark.cyl(0.08, 0.08, 1.0, sx, 0.2, sz + 3.6, 6);
          for (const d of [-1, 1]) dark.cyl(0.25, 0.25, 0.6, sx + d * 1.1, 0.2, sz + 3.6, 8);
        }
        break;
      }
      case 'garden': {
        grass.plane(W - 2, D - 2, cx, 0.19, cz);
        water.cyl(4.6, 4.6, 0.1, cx, 0.12, cz, 36);
        neon('#00f5d4').torus(4.65, 0.08, cx, 0.3, cz);
        for (let i = 0; i < 5; i++) {
          const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 4, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(i % 2 ? '#ff8a2a' : '#ffffff').multiplyScalar(2.2) }));
          m.rotation.x = Math.PI / 2;
          group.add(m);
          fish.push({ mesh: m, cx, cz, r: 1.2 + r() * 2.8, sp: (0.25 + r() * 0.4) * (i % 2 ? 1 : -1), ph: r() * 6 });
        }
        for (const [dx, dz] of [[-7, -7], [7, -7], [-7, 7], [7, 7], [0, -8.2]]) env.trees.add(new THREE.Vector3(cx + dx, 0.2, cz + dz), 0.8, dx > 0 ? '#ff5ea8' : '#00f5d4', r() * 6);
        for (const [dx, dz] of [[-5.6, 0], [5.6, 0]]) {
          concrete.box(0.8, 1.2, 0.8, cx + dx, 0.2, cz + dz);
          env.beacons.add(new THREE.Vector3(cx + dx, 1.6, cz + dz), '#ffb46b', 0, 1, 0.3);
        }
        break;
      }
      case 'baugrund': {
        concrete.box(W - 1, 0.05, D - 1, cx, 0.16, cz);
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2;
          const len = i % 2 ? D - 2 : W - 2;
          dark.box(i % 2 ? 0.1 : len, 1.6, i % 2 ? len : 0.1, cx + Math.sin(a) * (W / 2 - 1), 0.2, cz + Math.cos(a) * (D / 2 - 1));
        }
        const crane = new THREE.Group();
        const lattice = new Bag();
        for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) lattice.box(0.12, 24, 0.12, dx, 0, dz);
        for (let k = 1; k < 12; k++) lattice.box(1.3, 0.1, 1.3, 0, k * 2, 0);
        const lm = lattice.mesh(new THREE.MeshStandardMaterial({ color: '#c8a21c', metalness: 0.5, roughness: 0.5 }));
        if (lm) crane.add(lm);
        const boom = new THREE.Group();
        const boomBag = new Bag();
        boomBag.box(16, 0.6, 0.8, 5, 0, 0);
        boomBag.box(4, 0.6, 0.8, -3, 0, 0);
        boomBag.box(2, 1.6, 1.6, -4, -1.6, 0);
        const bm = boomBag.mesh(new THREE.MeshStandardMaterial({ color: '#c8a21c', metalness: 0.5, roughness: 0.5 }));
        if (bm) boom.add(bm);
        const cable = new THREE.Mesh(new THREE.BoxGeometry(0.05, 10, 0.05), MAT.darkMetal);
        cable.position.set(10, -5, 0);
        boom.add(cable);
        boom.position.y = 24;
        crane.add(boom);
        crane.position.set(cx + 4, 0.2, cz - 4);
        group.add(crane);
        cranes.push(boom);
        env.beacons.add(new THREE.Vector3(cx + 4, 25.2, cz - 4), '#ff2a3a', 0.8, 0.2, 0.35);
        const rect = boardSign(env.atlas, 'BAUGRUND', 'frei für neue Gäste', '#fcee0a', { w: 480, h: 120 });
        env.signs.quad(rect, 5.4, 1.35, new THREE.Vector3(cx - 3, 2.3, l.z1 - 0.9), 0, { intensity: 1.7 });
        break;
      }
      case 'zoll': {
        concrete.box(W - 1, 0.05, D - 1, cx, 0.16, cz);
        const cont = ['#5a2a24', '#1f4a4a', '#6b5a1c', '#2b3a5a'];
        for (let i = 0; i < 5; i++) vc.box(6, 2.6, 2.5, cx - 3 + (i % 2) * 1.2, 0.2 + Math.floor(i / 2) * 2.6, cz - 5 + (i % 2) * 2.8, 0, cont[i % 4]);
        vc.box(3, 3, 3, cx + 5, 0.2, cz + 5, 0, '#2a2f3d');
        neon('#ff8a2a').box(3.1, 0.1, 0.1, cx + 5, 3.1, cz + 6.55);
        const rect = boardSign(env.atlas, 'ZOLLHOF', 'Speedport · Kontrollpunkt', '#ff8a2a', { w: 480, h: 120 });
        env.signs.quad(rect, 4.8, 1.2, new THREE.Vector3(cx + 5, 3.8, cz + 6.6), 0, { intensity: 1.7 });
        break;
      }
      case 'dock': {
        dark.box(W - 4, 0.3, 3, cx, 0.1, cz + D / 2 - 2);
        for (let k = 0; k < 3; k++) dark.box(1.2, 0.3, 10, cx - 6 + k * 6, -0.2, cz + D / 2 + 4);
        for (let k = 0; k < 2; k++) {
          const b = new THREE.Group();
          const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 6), new THREE.MeshStandardMaterial({ color: '#1d2433', metalness: 0.4, roughness: 0.5 }));
          hull.position.y = 0.3;
          b.add(hull);
          const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 2), MAT.glass);
          cab.position.set(0, 1.4, -0.6);
          b.add(cab);
          const light = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(k ? '#2ec5ff' : '#ff5ea8').multiplyScalar(4) }));
          light.position.set(0, 2.2, -0.6);
          b.add(light);
          b.position.set(cx - 3 + k * 6, -1.4, cz + D / 2 + 7);
          group.add(b);
          boats.push(b);
        }
        break;
      }
    }
  });

  const add = (bag: Bag, mat: THREE.Material, cast = true) => { const m = bag.mesh(mat, { cast }); if (m) group.add(m); };
  add(metal, MAT.metal);
  add(dark, MAT.darkMetal);
  add(concrete, MAT.concrete, false);
  add(grass, new THREE.MeshStandardMaterial({ color: '#0d1f1a', roughness: 0.95, metalness: 0, emissive: '#06140f', emissiveIntensity: 0.8 }), false);
  add(water, new THREE.MeshStandardMaterial({ color: '#02060c', roughness: 0.05, metalness: 0.9, envMapIntensity: 1.8 }), false);
  add(vc, MAT.vertex);
  neonBags.forEach((b, c) => add(b, new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.6) }), false));

  env.anims.push((_dt, t) => {
    fish.forEach(f => {
      const a = f.ph + t * f.sp;
      f.mesh.position.set(f.cx + Math.cos(a) * f.r, 0.22, f.cz + Math.sin(a) * f.r);
      f.mesh.rotation.z = -a + (f.sp > 0 ? 0 : Math.PI);
    });
    boats.forEach((b, i) => { b.position.y = -1.4 + Math.sin(t * 0.9 + i) * 0.18; b.rotation.z = Math.sin(t * 0.7 + i * 2) * 0.04; });
    cranes.forEach((c, i) => { c.rotation.y = Math.sin(t * 0.08 + i) * 1.2; });
  });

  return { group, steam };
}

function bench(bag: Bag, x: number, z: number, rot: number) {
  bag.box(2.4, 0.12, 0.7, x, 0.62, z, rot);
  bag.box(2.4, 0.6, 0.1, x - Math.sin(rot) * 0.32, 0.68, z - Math.cos(rot) * 0.32, rot);
  bag.box(0.1, 0.5, 0.6, x + Math.cos(rot) * 1.1, 0.2, z - Math.sin(rot) * 1.1, rot);
  bag.box(0.1, 0.5, 0.6, x - Math.cos(rot) * 1.1, 0.2, z + Math.sin(rot) * 1.1, rot);
}

function holo(_env: BuildEnv, color: string): THREE.Material {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), wireframe: true, transparent: true, opacity: 0.8 });
}

