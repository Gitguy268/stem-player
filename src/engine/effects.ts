/** One wet/dry link per effect, in series, so any can be mixed in by 0..1. */
export interface Effect {
  input: GainNode;
  output: GainNode;
  set(amount: number): void;
}

function impulse(ctx: BaseAudioContext, seconds: number) {
  const n = Math.round(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  let seed = 22222;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = rnd() * Math.pow(1 - i / n, 3);
  }
  return buf;
}

function crushCurve(bits: number) {
  const n = 4096;
  const curve = new Float32Array(n);
  const q = Math.pow(2, bits - 1);
  for (let i = 0; i < n; i++) curve[i] = Math.round(((i / (n - 1)) * 2 - 1) * q) / q;
  return curve;
}

function shell(
  ctx: BaseAudioContext,
  build: (input: AudioNode, wet: AudioNode) => void,
  map: (a: number) => void = () => {},
): Effect {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 0;
  input.connect(dry).connect(output);
  wet.connect(output);
  build(input, wet);
  return {
    input,
    output,
    set(a) {
      const t = ctx.currentTime;
      // Equal power mix, with removal being fully silent on the wet side.
      dry.gain.setTargetAtTime(Math.cos((a * Math.PI) / 4), t, 0.02);
      wet.gain.setTargetAtTime(Math.sin((a * Math.PI) / 2), t, 0.02);
      map(a);
    },
  };
}

function lfo(ctx: BaseAudioContext, hz: number, depth: number, target: AudioParam) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = hz;
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start();
  return g;
}

/** Order matches `V1.effects`. */
export function buildEffects(ctx: BaseAudioContext): Effect[] {
  const reverb = shell(ctx, (i, w) => {
    const c = ctx.createConvolver();
    c.buffer = impulse(ctx, 2.4);
    i.connect(c).connect(w);
  });
  let echoFb: GainNode;
  const echo = shell(
    ctx,
    (i, w) => {
      const d = ctx.createDelay(1);
      d.delayTime.value = 0.34;
      echoFb = ctx.createGain();
      i.connect(d).connect(w);
      d.connect(echoFb).connect(d);
    },
    (a) => echoFb.gain.setTargetAtTime(a * 0.65, ctx.currentTime, 0.02),
  );
  let lp: BiquadFilterNode;
  const lowpass = shell(
    ctx,
    (i, w) => {
      lp = ctx.createBiquadFilter();
      lp.Q.value = 1.2;
      i.connect(lp).connect(w);
    },
    (a) => lp.frequency.setTargetAtTime(12000 * Math.pow(0.02, a), ctx.currentTime, 0.02),
  );
  let hp: BiquadFilterNode;
  const highpass = shell(
    ctx,
    (i, w) => {
      hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.Q.value = 1.2;
      i.connect(hp).connect(w);
    },
    (a) => hp.frequency.setTargetAtTime(60 * Math.pow(70, a), ctx.currentTime, 0.02),
  );
  const flanger = shell(ctx, (i, w) => {
    const d = ctx.createDelay(0.02);
    d.delayTime.value = 0.005;
    const fb = ctx.createGain();
    fb.gain.value = 0.55;
    lfo(ctx, 0.25, 0.004, d.delayTime);
    i.connect(d).connect(w);
    d.connect(fb).connect(d);
  });
  const tremolo = shell(ctx, (i, w) => {
    const g = ctx.createGain();
    g.gain.value = 0.5;
    lfo(ctx, 6, 0.5, g.gain);
    i.connect(g).connect(w);
  });
  const crush = shell(ctx, (i, w) => {
    const s = ctx.createWaveShaper();
    s.curve = crushCurve(4);
    i.connect(s).connect(w);
  });
  const phaser = shell(ctx, (i, w) => {
    let last: AudioNode = i;
    for (const f of [400, 900, 1800, 3200]) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = f;
      ap.Q.value = 0.7;
      lfo(ctx, 0.4, f * 0.6, ap.frequency);
      last.connect(ap);
      last = ap;
    }
    last.connect(w);
  });
  const all = [reverb, echo, lowpass, highpass, flanger, tremolo, crush, phaser];
  for (let n = 1; n < all.length; n++) all[n - 1].output.connect(all[n].input);
  return all;
}
