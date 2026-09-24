import * as THREE from 'three';
import { routes, type Route } from '../layout/routes';
import { model, type CEdge } from '../data/model';
import { RAIL_Y, type V2 } from '../layout/plan';
import type { EdgeKind } from '../data/types';
import { KIND_COLOR } from '../theme';
import { Poly, offsetPath } from './poly';
import type { Structure } from './buildctx';
import { U, type Core } from './core';

/*
 * Datenströme: jede Kante als Lichtspur auf ihrem echten Weg, mit eigener
 * Spur je Kantenart (rechts in Flussrichtung), Pakete in Richtung s → t und
 * schwächere Antworten zurück. Unterbrochene Kanten verpuffen rot am Ziel,
 * unbestätigte laufen gestrichelt.
 */

export const LANE: Record<EdgeKind, number> = {
  lan: 0.3, ingress: 0.62, proxy: 0.94, flow: 1.26, storage: 1.58, alert: 1.9, mon: 2.22, ssh: 2.54, vpn: 0.72, cluster: 0
};

const SPEED: Record<EdgeKind, number> = {
  lan: 9, ingress: 15, proxy: 15, flow: 13, storage: 11, alert: 26, mon: 10, ssh: 12, vpn: 14, cluster: 9
};

export const DEFAULT_LAYERS: Record<EdgeKind, boolean> = {
  flow: true, ingress: true, proxy: true, alert: true, storage: true, vpn: true, cluster: true, lan: true, mon: false, ssh: false
};

export interface FlowPath {
  edge: CEdge;
  route: Route;
  poly: Poly;       // Spur s → t
  back: Poly;      // Rückspur t → s
  mid: THREE.Vector3;
}

interface Packet { e: number; dir: 1 | -1; ph: number; size: number; }

const Y = 0.24;

function v3(p: V2, y = Y) { return new THREE.Vector3(p.x, y, p.z); }

export class Flows {
  readonly paths: FlowPath[] = [];
  readonly byEdge = new Map<string, FlowPath>();
  readonly layers: Record<EdgeKind, boolean> = { ...DEFAULT_LAYERS };
  private lines!: THREE.Mesh;
  private packets!: THREE.InstancedMesh;
  private pk: Packet[] = [];
  private state: Float32Array;
  private stateTex: THREE.DataTexture;
  private hi = new Set<string>();
  private down = new Set<string>();
  private degraded = new Set<string>();
  private selectionActive = false;
  private tmpP = new THREE.Vector3();
  private tmpT = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();
  private fwd = new THREE.Vector3(0, 0, 1);
  private colors: THREE.Color[] = [];
  private red = new THREE.Color('#ff2a3a').multiplyScalar(4);
  visible = true;
  packetsOn = true;

  constructor(private core: Core, private structures: Map<string, Structure>) {
    const n = model.edges.length;
    this.state = new Float32Array(n * 4);
    this.stateTex = new THREE.DataTexture(this.state, n, 1, THREE.RGBAFormat, THREE.FloatType);
    this.stateTex.minFilter = THREE.NearestFilter;
    this.stateTex.magFilter = THREE.NearestFilter;
    this.stateTex.needsUpdate = true;
    routes.forEach(r => {
      const pts = this.buildPoints(r, LANE[r.edge.k]);
      const backPts = this.buildPoints(r, -LANE[r.edge.k]).reverse();
      const poly = new Poly(pts);
      const back = new Poly(backPts);
      const mid = poly.at(poly.length / 2, new THREE.Vector3());
      const fp: FlowPath = { edge: r.edge, route: r, poly, back, mid };
      this.paths.push(fp);
      this.byEdge.set(r.edge.id, fp);
    });
    this.buildLines();
    this.buildPackets();
    this.refresh();
    core.onUpdate((dt, t) => this.update(dt, t));
  }

  /* ---------------- Geometrie der Wege ---------------- */

  private slotOf(id: string) {
    const sid = model.structureOf(id);
    const s = sid ? this.structures.get(sid) : undefined;
    return { s, slot: s?.svc.get(id) };
  }

  private buildPoints(r: Route, lane: number): THREE.Vector3[] {
    const e = r.edge;
    const A = this.slotOf(e.s), B = this.slotOf(e.t);
    const out: THREE.Vector3[] = [];
    const pushSlot = (slot: { pos: THREE.Vector3; normal: THREE.Vector3; foot: THREE.Vector3 } | undefined, atStart: boolean) => {
      if (!slot) return [];
      const o = slot.normal.clone().multiplyScalar(0.35 + Math.abs(lane) * 0.08);
      const hi = slot.pos.clone().add(o);
      const lo = slot.foot.clone().add(o);
      lo.y = Y;
      return atStart ? [hi, lo] : [lo, hi];
    };
    if (r.medium === 'internal') {
      const a = A.slot?.pos ?? A.s!.labelAt;
      const b = B.slot?.pos ?? B.s!.labelAt;
      const na = A.slot?.normal ?? new THREE.Vector3(0, 0, 1);
      const nb = B.slot?.normal ?? new THREE.Vector3(0, 0, 1);
      const pa = a.clone().addScaledVector(na, 0.45 + lane * 0.1);
      const pb = b.clone().addScaledVector(nb, 0.45 + lane * 0.1);
      const mid = pa.clone().lerp(pb, 0.5).addScaledVector(na.clone().add(nb).normalize(), 1.2);
      return [pa, mid, pb];
    }
    if (r.medium === 'air') {
      const sa = A.s!, sb = B.s!;
      const a = new THREE.Vector3(sa.center.x, Math.min(sa.top, 95) - 2, sa.center.z);
      const b = new THREE.Vector3(sb.center.x, 36, sb.center.z);
      const ctrl = a.clone().lerp(b, 0.5);
      ctrl.y = Math.max(a.y, b.y) + a.distanceTo(b) * 0.28 + 10;
      const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b);
      return curve.getPoints(32);
    }
    out.push(...pushSlot(A.slot, true));
    if (r.medium === 'road') {
      const flat = offsetPath(dedupe2([...r.parts.a, ...r.parts.street, ...r.parts.b]), lane);
      flat.forEach(p => out.push(v3(p)));
    } else {
      // Hochbahn: am Boden zur Station, senkrecht hinauf, oben auf der Spur, wieder hinunter
      r.parts.a.forEach(p => out.push(v3(p)));
      const st = r.parts.street;
      if (st.length) {
        out.push(v3(st[0]));
        const top = offsetPath(st, lane).map(p => v3(p, RAIL_Y + 0.9));
        out.push(...top);
        out.push(v3(st[st.length - 1]));
      }
      r.parts.b.forEach(p => out.push(v3(p)));
    }
    out.push(...pushSlot(B.slot, false));
    return out;
  }

  /* ---------------- Lichtspuren ---------------- */

  private buildLines() {
    const pos: number[] = [], oth: number[] = [], side: number[] = [], uu: number[] = [], un: number[] = [], edge: number[] = [], dir: number[] = [], col: number[] = [];
    const idx: number[] = [];
    let v = 0;
    this.paths.forEach(fp => {
      const p = fp.poly;
      const c = new THREE.Color(KIND_COLOR[fp.edge.k]);
      for (let i = 0; i < p.pts.length - 1; i++) {
        const a = p.pts[i], b = p.pts[i + 1];
        const ua = p.cum[i], ub = p.cum[i + 1];
        const quad: Array<[THREE.Vector3, THREE.Vector3, number, number, number]> = [
          [a, b, -1, ua, 1], [a, b, 1, ua, 1], [b, a, -1, ub, -1], [b, a, 1, ub, -1]
        ];
        quad.forEach(([pp, oo, s, u, d]) => {
          pos.push(pp.x, pp.y, pp.z);
          oth.push(oo.x, oo.y, oo.z);
          side.push(s);
          uu.push(u);
          un.push(u / Math.max(1e-3, p.length));
          edge.push(fp.edge.idx);
          dir.push(d);
          col.push(c.r, c.g, c.b);
        });
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
        v += 4;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aOther', new THREE.Float32BufferAttribute(oth, 3));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(uu, 1));
    g.setAttribute('aUn', new THREE.Float32BufferAttribute(un, 1));
    g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: U.uTime,
        uState: { value: this.stateTex },
        uStateW: { value: model.edges.length },
        uWidth: { value: 0.2 },
        uRes: { value: new THREE.Vector2(1, 1) }
      },
      vertexShader: /* glsl */`
        attribute vec3 aOther; attribute float aSide, aU, aUn, aEdge, aDir; attribute vec3 aColor;
        uniform sampler2D uState; uniform float uStateW, uWidth; uniform vec2 uRes;
        varying float vU; varying float vUn; varying vec3 vColor; varying vec4 vState;
        void main() {
          vec4 st = texture2D(uState, vec2((aEdge + 0.5) / uStateW, 0.5));
          vState = st; vU = aU; vUn = aUn; vColor = aColor;
          vec4 a = projectionMatrix * viewMatrix * vec4(position, 1.0);
          vec4 b = projectionMatrix * viewMatrix * vec4(aOther, 1.0);
          vec2 sa = a.xy / a.w, sb = b.xy / b.w;
          vec2 d = (sb - sa) * aDir;
          d.x *= uRes.x / uRes.y;
          float dl = length(d);
          d = dl > 1e-6 ? d / dl : vec2(1.0, 0.0);
          vec2 n = vec2(-d.y, d.x);
          n.x *= uRes.y / uRes.x;
          float w = uWidth * mix(1.0, 2.6, st.g);
          float half_ = max(0.5 * w * projectionMatrix[1][1] / a.w, 1.1 / uRes.y);
          a.xy += n * aSide * half_ * a.w;
          if (st.r < 0.5) a = vec4(0.0, 0.0, -2.0, 1.0);
          gl_Position = a;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        varying float vU; varying float vUn; varying vec3 vColor; varying vec4 vState;
        void main() {
          float hi = vState.g, dim = vState.b, flags = vState.a;
          float broken = mod(flags, 2.0);
          float unconf = step(1.5, mod(flags, 4.0));
          float degraded = step(3.5, flags);
          float ph = fract((vU - uTime * 13.0) / 10.0);
          // harte Kanten: ein Impuls, kein verwischter Schweif
          float dash = smoothstep(0.0, 0.025, ph) * (1.0 - smoothstep(0.25, 0.29, ph));
          float a = 0.2 + dash * 1.25;
          if (unconf > 0.5) a *= 0.25 + 0.75 * step(0.5, fract(vU / 1.6));
          vec3 c = vColor * a;
          if (broken > 0.5) {
            float r = smoothstep(0.55, 1.0, vUn);
            c = mix(c, vec3(1.0, 0.08, 0.14) * (0.5 + dash), r * (0.55 + 0.45 * step(0.5, fract(uTime * 1.7))));
          }
          if (degraded > 0.5) c = mix(c, vec3(1.0, 0.45, 0.05) * a, 0.6) * (0.5 + 0.5 * step(0.3, fract(uTime * 3.1 + vU * 0.05)));
          c *= mix(1.0, 3.2, hi);
          c *= mix(1.0, 0.1, dim);
          gl_FragColor = vec4(c, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    this.lines = new THREE.Mesh(g, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    this.lines.name = 'Datenströme';
    this.core.scene.add(this.lines);
    const res = mat.uniforms.uRes.value as THREE.Vector2;
    const upd = () => res.set(this.core.width, this.core.height);
    upd();
    window.addEventListener('resize', upd);
  }

  /* ---------------- Pakete ---------------- */

  private buildPackets() {
    this.paths.forEach((fp, i) => {
      const L = fp.poly.length;
      if (fp.route.medium === 'internal') {
        this.pk.push({ e: i, dir: 1, ph: 0, size: 0.8 }, { e: i, dir: -1, ph: 0.5, size: 0.55 });
        return;
      }
      const n = THREE.MathUtils.clamp(Math.round(L / 38), 1, 9);
      for (let k = 0; k < n; k++) {
        this.pk.push({ e: i, dir: 1, ph: (k + Math.random() * 0.4) / n, size: fp.edge.h ? 1.15 : 0.95 });
        if (!fp.edge.b) this.pk.push({ e: i, dir: -1, ph: (k + 0.5 + Math.random() * 0.3) / n, size: 0.6 });
      }
    });
    // kurze, scharfe Kapseln; die Größe folgt dem Kameraabstand (siehe update)
    const geo = new THREE.CapsuleGeometry(0.22, 0.75, 4, 10);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: true });
    this.packets = new THREE.InstancedMesh(geo, mat, this.pk.length);
    this.packets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pk.forEach((p, i) => {
      const c = new THREE.Color(KIND_COLOR[this.paths[p.e].edge.k]).multiplyScalar(p.dir > 0 ? 2.6 : 1.3);
      this.colors.push(c);
      this.packets.setColorAt(i, c);
    });
    this.packets.frustumCulled = false;
    this.packets.name = 'Datenpakete';
    this.core.scene.add(this.packets);
  }

  /* ---------------- Zustand ---------------- */

  /** sichtbar: Ebene an und keine Ausfall-Unterdrückung */
  isVisible(fp: FlowPath): boolean {
    return this.visible && this.layers[fp.edge.k] && !this.down.has(fp.edge.id);
  }

  refresh() {
    const pulse = new Map<string, number>();
    this.pulses.forEach(p => pulse.set(p.edge, Math.max(pulse.get(p.edge) || 0, p.value)));
    this.paths.forEach(fp => {
      const i = fp.edge.idx * 4;
      const vis = this.isVisible(fp);
      this.state[i] = vis ? 1 : 0;
      this.state[i + 1] = this.hi.has(fp.edge.id) ? 1 : (pulse.get(fp.edge.id) || 0);
      this.state[i + 2] = this.selectionActive && !this.hi.has(fp.edge.id) ? 1 : 0;
      this.state[i + 3] = (fp.edge.b ? 1 : 0) + (fp.edge.u ? 2 : 0) + (this.degraded.has(fp.edge.id) ? 4 : 0);
    });
    this.stateTex.needsUpdate = true;
  }

  private pulses = new Map<string, { edge: string; value: number; until: number }>();

  /** Kante kurz aufleuchten lassen (z. B. solange ein Agent darauf unterwegs ist) */
  setPulse(edgeId: string | null, owner: string, value = 0.5, duration = 0) {
    if (!edgeId) this.pulses.delete(owner);
    else this.pulses.set(owner, { edge: edgeId, value, until: duration ? performance.now() / 1000 + duration : Infinity });
    this.refresh();
  }

  setLayer(k: EdgeKind, on: boolean) {
    this.layers[k] = on;
    this.refresh();
  }

  /** Hervorhebung: Kanten-IDs; leere Menge = keine Auswahl */
  highlight(ids: Iterable<string> | null) {
    this.hi = new Set(ids || []);
    this.selectionActive = this.hi.size > 0;
    this.refresh();
  }

  get highlighted(): Set<string> {
    return this.hi;
  }

  /** Ausfall: Kanten ausgefallener Knoten verschwinden, eingeschränkte flackern */
  setOutage(downEdges: Set<string>, degradedEdges: Set<string>) {
    this.down = downEdges;
    this.degraded = degradedEdges;
    this.refresh();
  }

  /** Grenzen einer Kante für Kameraflüge */
  bounds(id: string): THREE.Box3 | null {
    const fp = this.byEdge.get(id);
    if (!fp) return null;
    return new THREE.Box3().setFromPoints(fp.poly.pts);
  }

  private pulseCheck = 0;

  private update(dt: number, t: number) {
    this.pulseCheck += dt;
    if (this.pulseCheck > 0.5) {
      this.pulseCheck = 0;
      const now = performance.now() / 1000;
      let changed = false;
      this.pulses.forEach((p, k) => { if (p.until < now) { this.pulses.delete(k); changed = true; } });
      if (changed) this.refresh();
    }
    const showPk = this.packetsOn && this.visible;
    this.packets.visible = showPk;
    if (!showPk) return;
    let colorDirty = false;
    // aus der Nähe klein und scharf, aus der Ferne groß genug zum Erkennen
    const camD = this.core.camera.position.distanceTo(this.core.controls.target);
    const kd = THREE.MathUtils.clamp(camD / 240, 0.7, 1.75);
    for (let i = 0; i < this.pk.length; i++) {
      const p = this.pk[i];
      const fp = this.paths[p.e];
      const poly = p.dir > 0 ? fp.poly : fp.back;
      const L = poly.length;
      const vis = this.state[fp.edge.idx * 4] > 0.5;
      if (!vis || L <= 0) {
        this.tmpM.makeScale(0, 0, 0);
        this.packets.setMatrixAt(i, this.tmpM);
        continue;
      }
      const sp = SPEED[fp.edge.k] * (p.dir > 0 ? 1 : 1.15);
      const cycle = fp.route.medium === 'internal' ? Math.max(L, 3) : L;
      let s = ((p.ph * cycle + t * sp) % cycle + cycle) % cycle;
      if (fp.route.medium === 'internal') s = Math.min(s, L);
      poly.at(s, this.tmpP, this.tmpT);
      const k = s / L;
      let scale = p.size * kd;
      const hiOn = this.state[fp.edge.idx * 4 + 1] > 0.5;
      const dim = this.state[fp.edge.idx * 4 + 2] > 0.5;
      if (hiOn) scale *= 1.55;
      if (dim) scale *= 0.55;
      // unterbrochen: kurz vor dem Ziel verpuffen
      if (fp.edge.b && p.dir > 0) {
        const fade = 1 - THREE.MathUtils.smoothstep(k, 0.78, 0.98);
        scale *= Math.max(0.05, fade);
        const want = k > 0.7 ? this.red : this.colors[i];
        this.packets.setColorAt(i, want);
        colorDirty = true;
      } else if (dim) {
        this.packets.setColorAt(i, this.tmpColor.copy(this.colors[i]).multiplyScalar(0.25));
        colorDirty = true;
      } else if (this.lastDim.has(i)) {
        this.packets.setColorAt(i, this.colors[i]);
        colorDirty = true;
      }
      if (dim) this.lastDim.add(i); else this.lastDim.delete(i);
      this.tmpQ.setFromUnitVectors(this.fwd, this.tmpT.lengthSq() > 0 ? this.tmpT.normalize() : this.fwd);
      this.tmpS.setScalar(scale);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      this.packets.setMatrixAt(i, this.tmpM);
    }
    this.packets.instanceMatrix.needsUpdate = true;
    if (colorDirty && this.packets.instanceColor) this.packets.instanceColor.needsUpdate = true;
  }

  private tmpColor = new THREE.Color();
  private lastDim = new Set<number>();

  setVisible(on: boolean) {
    this.visible = on;
    this.lines.visible = on;
    this.refresh();
  }
}

function dedupe2(pts: V2[]): V2[] {
  const out: V2[] = [];
  pts.forEach(p => { const l = out[out.length - 1]; if (!l || Math.hypot(l.x - p.x, l.z - p.z) > 0.01) out.push({ x: p.x, z: p.z }); });
  return out;
}
