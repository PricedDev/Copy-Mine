/*
 * Stadtklang, komplett synthetisiert (keine Audiodateien): Regen, ein
 * langsamer Synth-Teppich in Moll, tiefes Stadtbrummen, Donner beim Blitz
 * und leise Quittungstöne für Klicks. Startet nur auf Nutzerklick.
 */

export class Ambient {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private padBus: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private chordTimer = 0;
  private chordIdx = 0;
  private voices: Array<{ osc: OscillatorNode[]; gain: GainNode }> = [];
  on = false;
  rainLevel = 1;

  private static CHORDS: number[][] = [
    [45, 52, 55, 59, 60],  // Am(add9)
    [41, 48, 52, 55, 57],  // Fmaj7
    [48, 52, 55, 59, 62],  // Cmaj9
    [43, 50, 55, 59, 64]   // G6
  ];

  private init() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // Hall
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 3.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);
    // Regen: rosa-ähnliches Rauschen, bandbegrenzt
    const noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < nd.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0527;
      nd[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0.22;
    src.connect(hp).connect(lp).connect(this.rainGain).connect(this.master);
    src.start();
    // Stadtbrummen
    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 50;
    const humG = ctx.createGain();
    humG.gain.value = 0.035;
    hum.connect(humG).connect(this.master);
    hum.start();
    // Synth-Teppich
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.16;
    const padLp = ctx.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 900;
    padLp.Q.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 420;
    lfo.connect(lfoG).connect(padLp.frequency);
    lfo.start();
    this.padBus.connect(padLp);
    padLp.connect(this.master);
    padLp.connect(this.reverb);
  }

  private midi(n: number) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  private playChord() {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    // alte Stimmen ausblenden
    this.voices.forEach(v => {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + 5);
      v.osc.forEach(o => o.stop(now + 5.2));
    });
    this.voices = [];
    const chord = Ambient.CHORDS[this.chordIdx++ % Ambient.CHORDS.length];
    chord.forEach(n => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.09, now + 4);
      const oscs: OscillatorNode[] = [];
      [-7, 7].forEach(det => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = this.midi(n);
        o.detune.value = det;
        o.connect(g);
        o.start(now);
        oscs.push(o);
      });
      g.connect(this.padBus!);
      this.voices.push({ osc: oscs, gain: g });
    });
  }

  toggle(): boolean {
    if (!this.ctx) this.init();
    const ctx = this.ctx!;
    this.on = !this.on;
    if (this.on) {
      void ctx.resume();
      this.master!.gain.cancelScheduledValues(ctx.currentTime);
      this.master!.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 1.5);
      if (!this.voices.length) { this.playChord(); this.chordTimer = 0; }
    } else {
      this.master!.gain.cancelScheduledValues(ctx.currentTime);
      this.master!.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    }
    return this.on;
  }

  update(dt: number) {
    if (!this.on || !this.ctx) return;
    this.chordTimer += dt;
    if (this.chordTimer > 9) { this.chordTimer = 0; this.playChord(); }
    if (this.rainGain) this.rainGain.gain.value = 0.02 + 0.22 * Math.min(1.6, this.rainLevel);
  }

  /** kurzer Quittungston */
  blip(freq = 660) {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    o.connect(g).connect(this.master!);
    o.start();
    o.stop(ctx.currentTime + 0.2);
  }

  thunder() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.8);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(lp).connect(g).connect(this.master!);
    g.connect(this.reverb!);
    src.start(ctx.currentTime + 0.4 + Math.random() * 0.8);
  }

  /** tiefes Absacken beim simulierten Stromausfall */
  powerDown() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(28, ctx.currentTime + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.7);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    o.connect(lp).connect(g).connect(this.master!);
    o.start();
    o.stop(ctx.currentTime + 1.8);
  }
}
