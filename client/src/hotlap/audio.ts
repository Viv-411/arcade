/**
 * Synthesised sound for Hotlap (Web Audio — no audio files, works offline):
 * engine with virtual gear changes, tyre squeal, wind, and UI cues.
 */
const GEARS = [0, 16, 31, 46, 60, 75]; // m/s where each gear starts
const RPM_IDLE = 0.18;

export class HotlapAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engGain!: GainNode;
  private engOsc1!: OscillatorNode;
  private engOsc2!: OscillatorNode;
  private engFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private boostGain!: GainNode;
  private volume = 0.7;
  private muted = false;

  /** Must be called from a user gesture (browser autoplay policy). */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // Engine: two detuned oscillators through a waveshaper and a lowpass.
    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = "sawtooth";
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = "square";
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = "lowpass";
    this.engFilter.Q.value = 3;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    const g2 = ctx.createGain();
    g2.gain.value = 0.45;
    this.engOsc1.connect(shaper);
    this.engOsc2.connect(g2).connect(shaper);
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.master);
    this.engOsc1.start();
    this.engOsc2.start();

    const noise = this.noiseBuffer();
    // Tyre squeal: band-passed noise.
    const skidSrc = ctx.createBufferSource();
    skidSrc.buffer = noise;
    skidSrc.loop = true;
    const skidBp = ctx.createBiquadFilter();
    skidBp.type = "bandpass";
    skidBp.frequency.value = 1500;
    skidBp.Q.value = 2.5;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    skidSrc.connect(skidBp).connect(this.skidGain).connect(this.master);
    skidSrc.start();
    // Wind: low-passed noise rising with speed.
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noise;
    windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);
    windSrc.start();
    // Boost hiss.
    const boostSrc = ctx.createBufferSource();
    boostSrc.buffer = noise;
    boostSrc.loop = true;
    const boostHp = ctx.createBiquadFilter();
    boostHp.type = "highpass";
    boostHp.frequency.value = 2500;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    boostSrc.connect(boostHp).connect(this.boostGain).connect(this.master);
    boostSrc.start();
  }

  private noiseBuffer() {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Per-frame update from the car state. */
  update(speed: number, throttle: boolean, slip: number, grounded: boolean, boosting: boolean, active: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const v = Math.abs(speed);
    let gear = 0;
    while (gear + 1 < GEARS.length && v >= GEARS[gear + 1]) gear++;
    const lo = GEARS[gear];
    const hi = GEARS[gear + 1] ?? 95;
    const within = Math.min(1, (v - lo) / (hi - lo));
    const rpm = active ? RPM_IDLE + (0.35 + 0.6 * within) * (gear === 0 ? within + 0.2 : 1) * (1 - RPM_IDLE) : RPM_IDLE;
    const freq = 42 + rpm * 190;
    this.engOsc1.frequency.setTargetAtTime(freq, t, 0.03);
    this.engOsc2.frequency.setTargetAtTime(freq * 0.5 * 1.01, t, 0.03);
    this.engFilter.frequency.setTargetAtTime(380 + (throttle ? 2600 : 900) * rpm, t, 0.05);
    this.engGain.gain.setTargetAtTime(active ? (throttle ? 0.2 : 0.12) : 0.07, t, 0.06);
    const sq = grounded ? Math.max(0, Math.min(1, (slip - 2.2) / 6)) : 0;
    this.skidGain.gain.setTargetAtTime(sq * 0.22, t, 0.04);
    this.windFilter.frequency.setTargetAtTime(200 + v * 30, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.min(0.2, v / 400), t, 0.1);
    this.boostGain.gain.setTargetAtTime(boosting ? 0.12 : 0, t, 0.05);
  }

  /** Silence the continuous layers (pause / finish). */
  idle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(0.0, t, 0.15);
    this.skidGain.gain.setTargetAtTime(0, t, 0.05);
    this.windGain.gain.setTargetAtTime(0, t, 0.2);
    this.boostGain.gain.setTargetAtTime(0, t, 0.05);
  }

  private blip(freq: number, at: number, dur: number, type: OscillatorType = "sine", vol = 0.25) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t0 = ctx.currentTime + at;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  checkpoint(faster: boolean | null) {
    this.blip(faster === false ? 660 : 880, 0, 0.18);
    this.blip(faster === false ? 520 : 1320, 0.07, 0.25);
  }
  finish(pb: boolean) {
    const notes = pb ? [523, 659, 784, 1047] : [523, 659, 784];
    notes.forEach((f, i) => this.blip(f, i * 0.09, 0.4, "triangle", 0.22));
  }
  respawn() {
    this.blip(330, 0, 0.12, "square", 0.08);
    this.blip(440, 0.06, 0.12, "square", 0.08);
  }
  go() {
    this.blip(988, 0, 0.25, "square", 0.1);
  }
  impact(strength: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 300 + strength * 900;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(0.5, 0.1 + strength * 0.35), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.3);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
