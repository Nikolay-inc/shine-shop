// ASMR audio with WebAudio only (no files): filtered-noise scrubbing, finish chime, coin blips,
// quiet workshop ambience (brown noise + slow clock ticks).

interface ToolVoice {
  freq: number;
  range: number;
  q: number;
  gain: number;
  type: BiquadFilterType;
  hum?: number;
}

const VOICES: Record<string, ToolVoice> = {
  sponge: { freq: 650, range: 700, q: 0.9, gain: 0.5, type: 'bandpass' },
  brush: { freq: 2600, range: 2200, q: 1.4, gain: 0.42, type: 'bandpass' },
  washer: { freq: 1200, range: 900, q: 0.45, gain: 0.5, type: 'bandpass' },
  laser: { freq: 5200, range: 2400, q: 4, gain: 0.16, type: 'bandpass', hum: 120 },
};

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private scrubGain!: GainNode;
  private scrubFilter!: BiquadFilterNode;
  private humOsc!: OscillatorNode;
  private humGain!: GainNode;
  private ambGain!: GainNode;
  private tickTimer = 0;
  private voice: ToolVoice = VOICES.sponge;
  muted = false;

  /** Must be called from a user gesture (autoplay policy). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // scrub chain: noise → filter → gain
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.scrubFilter = ctx.createBiquadFilter();
    this.scrubFilter.type = 'bandpass';
    this.scrubGain = ctx.createGain();
    this.scrubGain.gain.value = 0;
    src.connect(this.scrubFilter).connect(this.scrubGain).connect(this.master);
    src.start();

    // laser hum
    this.humOsc = ctx.createOscillator();
    this.humOsc.type = 'sawtooth';
    this.humOsc.frequency.value = 120;
    const humLp = ctx.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.value = 600;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humOsc.connect(humLp).connect(this.humGain).connect(this.master);
    this.humOsc.start();

    // ambience: brown noise, low-passed, very quiet
    const brown = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.2;
    }
    const amb = ctx.createBufferSource();
    amb.buffer = brown;
    amb.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0.05;
    amb.connect(lp).connect(this.ambGain).connect(this.master);
    amb.start();
    this.tickTimer = window.setInterval(() => this.tick(), 1000);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  setTool(id: string) {
    this.voice = VOICES[id] ?? VOICES.sponge;
    if (this.ctx) {
      this.scrubFilter.type = this.voice.type;
      this.scrubFilter.Q.value = this.voice.q;
      if (this.voice.hum) this.humOsc.frequency.value = this.voice.hum;
    }
  }

  /** intensity 0..1 from finger speed; 0 = silence. */
  scrub(intensity: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = this.voice;
    const k = Math.min(1, Math.max(0, intensity));
    // slight random wobble keeps the texture organic
    const wobble = 1 + (Math.random() - 0.5) * 0.15;
    this.scrubGain.gain.setTargetAtTime(k * v.gain * wobble, t, k > 0 ? 0.03 : 0.08);
    this.scrubFilter.frequency.setTargetAtTime(v.freq + v.range * k * wobble, t, 0.05);
    this.humGain.gain.setTargetAtTime(v.hum ? (k > 0 ? 0.05 + k * 0.05 : 0) : 0, t, 0.05);
  }

  /** Bright bell chord for a finished item. Golden = longer and higher. */
  chime(golden = false) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const base = golden ? 1046.5 : 784;
    const notes = [1, 1.25, 1.5, 2, golden ? 2.5 : 3];
    notes.forEach((m, i) => {
      const t = ctx.currentTime + i * 0.07;
      for (const [mul, amp] of [[1, 0.16], [2.76, 0.05], [5.4, 0.02]] as const) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = base * m * mul;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (golden ? 2.6 : 1.8));
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 2.8);
      }
    });
  }

  /** Short metallic blip; pitch rises with `n` for coin streams. */
  coin(n = 0, volume = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1800 + (n % 6) * 140, t);
    o.frequency.exponentialRampToValueAtTime(2600 + (n % 6) * 140, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08 * volume, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** Soft UI click. */
  click() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + 0.05);
  }

  /** Workshop wall clock: very quiet tick-tock. */
  private tick() {
    if (!this.ctx || this.ctx.state !== 'running' || document.hidden) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = (Math.floor(t) % 2 ? 3200 : 2700) + Math.random() * 100;
    f.Q.value = 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + 0.04);
  }

  dispose() {
    clearInterval(this.tickTimer);
    void this.ctx?.close();
  }
}
