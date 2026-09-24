import * as THREE from 'three';
import { model } from '../data/model';
import { plan } from '../layout/plan';
import { $ } from './dom';
import type { App } from '../app';

/*
 * Kinomodus (automatischer Rundflug mit Untertiteln), Fotomodus und Scanner.
 */

interface Shot {
  title: string;
  sub: string;
  dur: number;
  target?: THREE.Vector3;
  runner?: string;
  dist: number;
  polar: number;
  az?: number;
  drift: number;
}

export class Cinema {
  on = false;
  private shots: Shot[] = [];
  private idx = -1;
  private left = 0;
  private cap = $('#caption');
  private capT = $('#cap-t');
  private capS = $('#cap-s');
  private letter = 0;

  constructor(private app: App) {
    app.core.onUpdate((dt, t) => this.update(dt, t));
  }

  private build(): Shot[] {
    const a = this.app;
    const st = (id: string) => a.city.structures.get(id);
    const ctr = (id: string, y = 0) => { const s = st(id); return s ? new THREE.Vector3(s.center.x, y, s.center.z) : new THREE.Vector3(); };
    const guests = model.nodes.filter(n => n.t === 'vm' || n.t === 'ct');
    const running = guests.filter(n => n.st !== 'stopped' && n.vmid !== 9000).length;
    const pves = model.nodes.filter(n => n.t === 'pve');
    const votes = pves.reduce((s, p) => s + model.votes(p.id), 0);
    const aiL = model.nodeLive('pve-ai');
    const px = model.nodeLive('pve-node1');
    const allocPx = model.alloc('pve-node1');
    const c = plan.center;
    const shots: Shot[] = [
      { title: 'NIGHT CITY // HOMELAB', sub: `${pves.length} Nodes · ${guests.filter(n => n.vmid !== 9000).length} Gäste (${running} laufen) · ${model.edges.length} Verbindungen`, dur: 11, target: new THREE.Vector3(c.x, 0, (plan.bounds.z0 + plan.islandBounds.z1) / 2), dist: 700, polar: 0.95, az: 0, drift: 0.02 },
      { title: 'ROUTER / FIREWALL', sub: 'Das einzige Tor nach draußen – hier laufen alle Portfreigaben zusammen', dur: 9, target: ctr('speedport', 6).add(new THREE.Vector3(12, 0, 8)), dist: 90, polar: 1.12, az: 0.5, drift: 0.05 },
      { title: 'PROXMOX · DOWNTOWN', sub: `${model.get('pve-node1').kids.filter(k => ['vm', 'ct'].includes(model.get(k).t)).length} Gäste · RAM zugesagt ${allocPx ? Math.round(allocPx.pct) : '–'} %${px ? ` · ${px.thr} Threads` : ''}`, dur: 10, target: ctr('pve-node1', 40), dist: 230, polar: 1.05, az: -0.6, drift: 0.05 },
      { title: 'AUTOMATISIERUNGS-HUB', sub: 'Persönlicher Assistent, Wissensbasis und Automatisierung in einer VM', dur: 9, target: ctr('g301', 20), dist: 80, polar: 1.02, az: 0.3, drift: 0.06 },
      { title: 'ADMIN', sub: 'kommt über das VPN und wartet die Nodes per SSH', dur: 11, runner: 'admin', dist: 70, polar: 1.0, drift: 0.04 },
      { title: 'AI · NEURAL HEIGHTS', sub: `Node für GPU/CPU-Inferenz${aiL ? ` · ${aiL.thr} Threads, ${aiL.memMax.toLocaleString('de-DE')} GB RAM` : ''}`, dur: 10, target: ctr('pve-ai', 45), dist: 250, polar: 1.1, az: 0.7, drift: 0.05 },
      { title: 'MAINCLUSTER-PLAZA', sub: `${votes} Stimmen · Quorum ${Math.floor(votes / 2) + 1} · kein QDevice aktiv`, dur: 10, target: ctr('cluster', 25), dist: 150, polar: 1.0, az: 0.2, drift: 0.06 },
      { title: 'BESUCHER', sub: 'Domain → Reverse Proxy → App-Backend → Datenbank', dur: 12, runner: 'visitor#1', dist: 55, polar: 1.05, drift: 0.03 },
      { title: 'HEIMNETZ', sub: '192.168.2.0/24 · flach, kein VLAN – Server, TVs und Handys in einem Netz', dur: 9, target: a.city.districtCenter('d-lan') || new THREE.Vector3(), dist: 190, polar: 1.0, az: -0.5, drift: 0.05 },
      { title: 'AUSSENWELT', sub: 'Cloud-Dienste und Tailnet-Terminal – verbunden nur über Brücke und Hochbahn', dur: 10, target: new THREE.Vector3((plan.islandBounds.x0 + plan.islandBounds.x1) / 2, 5, (plan.islandBounds.z0 + plan.islandBounds.z1) / 2), dist: 260, polar: 1.05, az: Math.PI * 0.85, drift: 0.04 },
      { title: 'CHECKMK-STREIFE', sub: 'Monitoring – prüft laufend alle Nodes und wichtigen VMs', dur: 10, runner: 'patrol', dist: 60, polar: 1.0, drift: 0.04 }
    ];
    return shots;
  }

  toggle() {
    if (this.on) this.stop(); else this.start();
  }

  start() {
    if (this.on) return;
    this.on = true;
    this.shots = this.build();
    this.idx = -1;
    this.left = 0;
    document.body.classList.add('cinema');
    this.app.menus.close();
    this.app.menus.setPressed('cinema', true);
    this.app.select(null);
    this.cap.hidden = false;
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    document.body.classList.remove('cinema');
    this.cap.hidden = true;
    this.app.menus.setPressed('cinema', false);
    this.app.core.cancelFlight();
  }

  private next() {
    this.idx = (this.idx + 1) % this.shots.length;
    const s = this.shots[this.idx];
    this.left = s.dur;
    this.capT.textContent = s.title;
    this.capS.textContent = s.sub;
    this.cap.classList.remove('in');
    void this.cap.offsetWidth;
    this.cap.classList.add('in');
    const target = s.runner ? this.app.director.byKey.get(s.runner)?.pos.clone() : s.target;
    if (target) this.app.core.flyTo(target, { dist: s.dist, polar: s.polar, azimuth: s.az ?? this.app.core.view().a, duration: 2.6 });
  }

  private update(dt: number, _t: number) {
    const g = this.app.core.grade.uniforms.uLetterbox;
    this.letter += ((this.on ? 0.085 : 0) - this.letter) * Math.min(1, dt * 3);
    g.value = this.letter < 0.001 ? 0 : this.letter;
    if (!this.on) return;
    this.left -= dt;
    if (this.left <= 0) this.next();
    const s = this.shots[this.idx];
    if (!s || this.app.core.flying) return;
    const core = this.app.core;
    if (s.runner) {
      const r = this.app.director.byKey.get(s.runner);
      if (r) {
        const t = core.controls.target;
        const want = r.pos.clone();
        want.y = Math.max(0, want.y - 2);
        const delta = want.sub(t).multiplyScalar(Math.min(1, dt * 2.5));
        t.add(delta);
        core.camera.position.add(delta);
      }
    }
    core.orbit(s.drift * dt);
  }
}

interface DownloadsApi { save(r: { filename: string; data: Blob }): Promise<{ status: string }>; }
interface ClaudeViewer { use(name: string): Promise<unknown>; }

export class Photo {
  on = false;
  private bar = $('#photo-bar');
  private shotBox = $('#shot');
  private img = $('#shot-img') as HTMLImageElement;
  private dl = $('#shot-dl') as HTMLAnchorElement;
  private saveBtn = $('#shot-save') as HTMLButtonElement;
  private hint = $('#shot-hint');
  private downloads: DownloadsApi | null = null;
  private lastUrl = '';
  private lastName = '';

  constructor(private app: App) {
    // Im Artifact-Viewer gibt es window.claude vor dem ersten Skript: dort kann ein
    // normaler Download-Link nichts, gespeichert wird über die downloads-Fähigkeit.
    const viewer = (window as unknown as { claude?: ClaudeViewer }).claude;
    if (viewer && typeof viewer.use === 'function') {
      this.dl.hidden = true;
      viewer.use('downloads').then(d => { this.downloads = (d as DownloadsApi | null) || null; this.saveBtn.hidden = !this.downloads; }).catch(() => { this.downloads = null; });
      this.saveBtn.addEventListener('click', () => void this.save());
    } else {
      this.saveBtn.remove();
    }
    $('#photo-exit').addEventListener('click', () => this.exit());
    $('#photo-shot').addEventListener('click', () => this.shoot());
    $('#photo-labels').addEventListener('click', () => {
      const on = document.body.classList.toggle('photo-labels');
      $('#photo-labels').setAttribute('aria-pressed', String(on));
    });
    $('#shot-close').addEventListener('click', () => { this.shotBox.hidden = true; });
    this.shotBox.addEventListener('pointerdown', e => { if (e.target === this.shotBox) this.shotBox.hidden = true; });
  }

  enter() {
    this.on = true;
    this.app.cinema.stop();
    this.app.select(null);
    document.body.classList.add('photo');
    this.bar.hidden = false;
  }

  exit() {
    this.on = false;
    document.body.classList.remove('photo', 'photo-labels');
    this.bar.hidden = true;
    this.shotBox.hidden = true;
  }

  shoot() {
    const core = this.app.core;
    core.renderOnce();
    let url = '';
    try { url = core.renderer.domElement.toDataURL('image/png'); } catch { url = ''; }
    if (!url) return;
    this.img.src = url;
    this.dl.href = url;
    const d = new Date();
    this.lastName = `night-city-homelab-${d.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    this.lastUrl = url;
    this.dl.download = this.lastName;
    this.hint.textContent = 'oder Rechtsklick → Bild speichern';
    this.shotBox.hidden = false;
  }

  private async save() {
    if (!this.downloads || !this.lastUrl) return;
    const b64 = this.lastUrl.split(',')[1] || '';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    try {
      const r = await this.downloads.save({ filename: this.lastName, data: new Blob([bytes], { type: 'image/png' }) });
      this.hint.textContent = r.status === 'saved' ? 'gespeichert' : 'übergeben';
    } catch (e) {
      const code = (e as { code?: string }).code;
      this.hint.textContent = code === 'declined' ? 'Speichern abgelehnt' : code === 'rate_limited' ? 'Ein Speicherdialog ist schon offen' : 'Speichern hier nicht möglich – Rechtsklick → Bild speichern';
    }
  }
}

export class Scanner {
  on = false;
  private frame = $('#scanframe');
  private level = 0;
  private prevMon = false;

  constructor(private app: App) {
    app.core.onUpdate((dt, t) => {
      const target = this.on ? 1 : 0;
      this.level += (target - this.level) * Math.min(1, dt * 5);
      const u = app.core.grade.uniforms;
      u.uScan.value = this.level < 0.002 ? 0 : this.level;
      u.uScanPhase.value = (t * 0.28) % 1.2 - 0.1;
    });
  }

  toggle(force?: boolean) {
    this.on = force ?? !this.on;
    document.body.classList.toggle('scan', this.on);
    this.frame.hidden = !this.on;
    this.app.overlayState.scan = this.on;
    // Im Scanner sieht man auch die Überwachung (CheckMK-Kanten)
    if (this.on) { this.prevMon = this.app.flows.layers.mon; this.app.flows.setLayer('mon', true); }
    else this.app.flows.setLayer('mon', this.prevMon);
    this.app.audio.blip(this.on ? 880 : 440);
  }
}
