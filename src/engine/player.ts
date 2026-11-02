import { STEMS, type Stem } from '../spec/common';
import { buildEffects, type Effect } from './effects';
import { PITCH_WORKLET } from './pitch-worklet';

export type StemBuffers = Record<Stem, AudioBuffer>;
export interface LoadedTrack {
  id: string;
  bpm: number;
  stems: StemBuffers;
}

const reversed = new WeakMap<AudioBuffer, AudioBuffer>();
function reverseOf(ctx: BaseAudioContext, b: AudioBuffer) {
  let r = reversed.get(b);
  if (!r) {
    r = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
    for (let c = 0; c < b.numberOfChannels; c++) r.copyToChannel(b.getChannelData(c).slice().reverse(), c);
    reversed.set(b, r);
  }
  return r;
}

/** Keeps a position in [0, length) from a linear time, honouring a loop. Exported for tests. */
export function wrapPosition(pos: number, duration: number, loop: { start: number; end: number } | null) {
  if (loop && pos >= loop.end) {
    const len = loop.end - loop.start;
    return loop.start + ((pos - loop.start) % len);
  }
  if (loop && pos < loop.start) {
    const len = loop.end - loop.start;
    return loop.end - ((loop.start - pos) % len);
  }
  return Math.max(0, Math.min(duration, pos));
}

interface Deck {
  track: LoadedTrack | null;
  sources: Partial<Record<Stem, AudioBufferSourceNode>>;
  /** Selects deck A or B per stem. */
  gate: Record<Stem, GainNode>;
}

/**
 * Two decks of four stems behind one clock. Deck A is the current track; deck B
 * is the mix partner that stems can be swapped from and that transitions move to.
 */
export class Player {
  readonly master: GainNode;
  readonly analysers: Record<Stem, AnalyserNode>;
  readonly tap: GainNode;
  private a: Deck;
  private b: Deck;
  private channel: Record<Stem, GainNode>;
  private effects: Effect[];
  private pitchNode: AudioWorkletNode | null = null;
  private bus: GainNode;
  private fxOut: GainNode;
  private buffers = new Float32Array(1024);

  playing = false;
  rate = 1;
  private anchorPos = 0;
  private anchorTime = 0;
  private loopRange: { start: number; end: number } | null = null;
  private slip: { pos: number; time: number } | null = null;
  private swapped: Record<Stem, boolean> = { vocals: false, other: false, drums: false, bass: false };
  onEnded: (() => void) | null = null;
  private endTimer = 0;

  constructor(
    readonly ctx: BaseAudioContext,
    destination: AudioNode = ctx.destination,
  ) {
    this.bus = ctx.createGain();
    this.fxOut = ctx.createGain();
    this.master = ctx.createGain();
    this.tap = ctx.createGain();
    this.master.gain.value = 0.75;
    this.effects = buildEffects(ctx);
    this.bus.connect(this.effects[0].input);
    this.effects[this.effects.length - 1].output.connect(this.fxOut);
    this.fxOut.connect(this.master);
    this.master.connect(this.tap);
    this.master.connect(destination);
    const mk = <T>(f: (s: Stem) => T) => Object.fromEntries(STEMS.map((s) => [s, f(s)])) as Record<Stem, T>;
    this.analysers = mk(() => {
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      return an;
    });
    this.channel = mk((s) => {
      const g = ctx.createGain();
      g.connect(this.bus);
      g.connect(this.analysers[s]);
      return g;
    });
    const deck = (open: number): Deck => ({
      track: null,
      sources: {},
      gate: mk((s) => {
        const g = ctx.createGain();
        g.gain.value = open;
        g.connect(this.channel[s]);
        return g;
      }),
    });
    this.a = deck(1);
    this.b = deck(0);
  }

  /** Loads the pitch worklet. Skipped quietly where worklets cannot load: pitch then stays at 0. */
  async init() {
    const c = this.ctx as AudioContext;
    if (!c.audioWorklet || typeof AudioWorkletNode === 'undefined') return;
    const url = URL.createObjectURL(new Blob([PITCH_WORKLET], { type: 'text/javascript' }));
    try {
      await c.audioWorklet.addModule(url);
      this.pitchNode = new AudioWorkletNode(c, 'pitch-shift', { outputChannelCount: [2] });
      this.fxOut.disconnect();
      this.fxOut.connect(this.pitchNode).connect(this.master);
    } catch (e) {
      console.warn('Pitch shifter unavailable', e);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  get track() {
    return this.a.track;
  }
  get partner() {
    return this.b.track;
  }
  get duration() {
    return this.a.track?.stems.vocals.duration ?? 0;
  }
  get beatSeconds() {
    return 60 / (this.a.track?.bpm ?? 120);
  }

  /** Current position in seconds, forward time, whichever way it is playing. */
  get position() {
    let p = this.anchorPos;
    if (this.playing) p += (this.ctx.currentTime - this.anchorTime) * this.rate;
    return wrapPosition(p, this.duration, this.loopRange);
  }

  get loop() {
    return this.loopRange;
  }

  private reanchor() {
    this.anchorPos = this.position;
    this.anchorTime = this.ctx.currentTime;
  }

  private stopDeck(d: Deck) {
    for (const s of STEMS) {
      const n = d.sources[s];
      if (n) {
        n.onended = null;
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
        n.disconnect();
      }
      d.sources[s] = undefined;
    }
  }

  private startDeck(d: Deck, when: number, pos: number, partnerRate = 1) {
    if (!d.track) return;
    const rate = this.rate * partnerRate;
    const backward = rate < 0;
    for (const s of STEMS) {
      const fwd = d.track.stems[s];
      const buf = backward ? reverseOf(this.ctx, fwd) : fwd;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = Math.abs(rate);
      const dur = fwd.duration;
      if (this.loopRange && d === this.a) {
        src.loop = true;
        src.loopStart = backward ? dur - this.loopRange.end : this.loopRange.start;
        src.loopEnd = backward ? dur - this.loopRange.start : this.loopRange.end;
      }
      const p = ((pos % dur) + dur) % dur;
      src.connect(d.gate[s]);
      src.start(when, backward ? dur - p : p);
      d.sources[s] = src;
    }
  }

  /** Stem B runs at A's musical position, tempo matched by resampling. */
  private partnerRate() {
    if (!this.a.track || !this.b.track) return 1;
    const r = this.a.track.bpm / this.b.track.bpm;
    return Math.max(0.75, Math.min(1.33, r));
  }

  private restart() {
    this.stopDeck(this.a);
    this.stopDeck(this.b);
    window.clearTimeout(this.endTimer);
    if (!this.playing || !this.a.track) return;
    const when = this.ctx.currentTime + 0.02;
    this.anchorTime = when;
    this.startDeck(this.a, when, this.anchorPos);
    if (this.b.track)
      this.startDeck(this.b, when, this.anchorPos * (this.a.track.bpm / this.b.track.bpm), this.partnerRate());
    this.scheduleEnd();
  }

  private scheduleEnd() {
    window.clearTimeout(this.endTimer);
    if (!this.playing || this.loopRange || this.rate === 0) return;
    const left = this.rate > 0 ? this.duration - this.anchorPos : this.anchorPos;
    this.endTimer = window.setTimeout(() => this.onEnded?.(), (left / Math.abs(this.rate)) * 1000 + 60);
  }

  load(track: LoadedTrack, position = 0) {
    this.a.track = track;
    this.anchorPos = position;
    this.loopRange = null;
    this.slip = null;
    this.restart();
  }

  loadPartner(track: LoadedTrack | null) {
    this.stopDeck(this.b);
    this.b.track = track;
    if (this.playing && track) {
      this.reanchor();
      const when = this.ctx.currentTime + 0.02;
      this.startDeck(this.b, when, this.anchorPos * (this.a.track!.bpm / track.bpm), this.partnerRate());
      // Keep A's anchor valid across the 20 ms start offset of B.
    }
  }

  play() {
    if (this.playing || !this.a.track) return;
    this.playing = true;
    this.restart();
  }

  pause() {
    if (!this.playing) return;
    this.reanchor();
    this.playing = false;
    this.restart();
  }

  seek(seconds: number) {
    this.reanchor();
    this.anchorPos = Math.max(0, Math.min(this.duration - 0.01, this.anchorPos + seconds));
    this.restart();
  }

  setRate(rate: number) {
    const crossing = Math.sign(rate) !== Math.sign(this.rate);
    this.reanchor();
    this.rate = rate;
    if (crossing) {
      this.restart();
      return;
    }
    const pr = this.partnerRate();
    for (const s of STEMS) {
      this.a.sources[s]?.playbackRate.setValueAtTime(Math.abs(rate), this.ctx.currentTime);
      this.b.sources[s]?.playbackRate.setValueAtTime(Math.abs(rate * pr), this.ctx.currentTime);
    }
    this.scheduleEnd();
  }

  setPitch(semitones: number) {
    this.pitchNode?.parameters.get('ratio')?.setValueAtTime(Math.pow(2, semitones / 12), this.ctx.currentTime);
  }

  /** A quick brake and pull back, like a hand on a record. */
  scratch() {
    const t = this.ctx.currentTime;
    const base = Math.abs(this.rate);
    for (const s of STEMS) {
      const p = this.a.sources[s]?.playbackRate;
      if (!p) continue;
      p.cancelScheduledValues(t);
      p.setValueAtTime(base, t);
      p.linearRampToValueAtTime(0.15, t + 0.12);
      p.linearRampToValueAtTime(base * 1.8, t + 0.24);
      p.linearRampToValueAtTime(base, t + 0.36);
    }
  }

  /** `beats` from the current position, snapped to the beat grid of the track. */
  setLoop(beats: number | null) {
    this.reanchor();
    if (beats === null) {
      this.loopRange = null;
    } else {
      const len = beats * this.beatSeconds;
      const beat = this.beatSeconds;
      const start = Math.floor(this.anchorPos / beat) * beat;
      const end = Math.min(this.duration, start + len);
      this.loopRange = { start, end };
      if (this.anchorPos >= end) this.anchorPos = start;
    }
    this.restart();
  }

  /** A loop while the song keeps counting underneath. Null returns to where it would have been. */
  setSlip(beats: number | null) {
    if (beats !== null) {
      this.reanchor();
      this.slip = { pos: this.anchorPos, time: this.ctx.currentTime };
      this.setLoop(beats);
    } else if (this.slip) {
      const target = this.slip.pos + (this.ctx.currentTime - this.slip.time) * this.rate;
      this.slip = null;
      this.loopRange = null;
      this.anchorPos = Math.min(this.duration - 0.01, target);
      this.anchorTime = this.ctx.currentTime;
      this.restart();
    }
  }

  nudgeLoop(dir: -1 | 1) {
    if (!this.loopRange) return;
    this.reanchor();
    const d = this.beatSeconds * dir;
    this.loopRange = {
      start: Math.max(0, this.loopRange.start + d),
      end: Math.min(this.duration, this.loopRange.end + d),
    };
    this.anchorPos = wrapPosition(this.anchorPos, this.duration, this.loopRange);
    this.restart();
  }

  /** Isolation ramps over the device's 50 ms; a gain of zero is true silence. */
  setStemGains(gains: Record<Stem, number>, rampMs = 50) {
    const t = this.ctx.currentTime;
    for (const s of STEMS) {
      const g = this.channel[s].gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(gains[s], t + rampMs / 1000);
    }
  }

  setVolume(v: number) {
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.01);
  }
  get volume() {
    return this.master.gain.value;
  }

  setEffect(index: number, amount: number) {
    this.effects[index]?.set(amount);
  }
  clearEffects() {
    this.effects.forEach((e) => e.set(0));
  }

  swapStem(stem: Stem, swapped: boolean, seconds = 0.05) {
    this.swapped[stem] = swapped;
    const t = this.ctx.currentTime;
    const [on, off] = swapped ? [this.b, this.a] : [this.a, this.b];
    on.gate[stem].gain.setTargetAtTime(1, t, seconds / 3);
    off.gate[stem].gain.setTargetAtTime(0, t, seconds / 3);
  }

  resetSwaps() {
    for (const s of STEMS) this.swapStem(s, false);
  }

  /**
   * Staged move onto deck B: drums first, then vocals and melody, then bass, as
   * in the how-to's transition captions. Deck B becomes deck A at the end.
   */
  async transition(barSeconds: number, onDone: () => void) {
    if (!this.b.track) return onDone();
    const steps: Stem[][] = [['drums'], ['vocals', 'other'], ['bass']];
    for (const group of steps) {
      for (const s of group) this.swapStem(s, true, barSeconds);
      await new Promise((r) => setTimeout(r, barSeconds * 1000));
    }
    onDone();
  }

  /** Makes B the current track at its own position, with no audible jump. */
  promotePartner() {
    if (!this.b.track || !this.a.track) return;
    const pos = this.position * (this.a.track.bpm / this.b.track.bpm);
    const next = this.b.track;
    this.stopDeck(this.a);
    this.stopDeck(this.b);
    this.a.track = next;
    this.b.track = null;
    this.anchorPos = pos;
    this.loopRange = null;
    for (const s of STEMS) {
      this.a.gate[s].gain.value = 1;
      this.b.gate[s].gain.value = 0;
      this.swapped[s] = false;
    }
    this.restart();
  }

  /** Per-stem level 0..1 for the LEDs. */
  levels(): Record<Stem, number> {
    const out = {} as Record<Stem, number>;
    for (const s of STEMS) {
      const an = this.analysers[s];
      if (this.buffers.length !== an.fftSize) this.buffers = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(this.buffers);
      let sum = 0;
      for (let i = 0; i < this.buffers.length; i++) sum += this.buffers[i] * this.buffers[i];
      out[s] = Math.sqrt(sum / this.buffers.length);
    }
    return out;
  }

  dispose() {
    this.stopDeck(this.a);
    this.stopDeck(this.b);
    window.clearTimeout(this.endTimer);
  }
}
