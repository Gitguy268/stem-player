import type { Rgb, Stem } from '../spec/common';

export interface DemoSpec {
  id: string;
  title: string;
  bpm: number;
  bars: number;
  root: number;
  /** Semitone offsets of the four chords. */
  chords: number[][];
  colours: [Rgb, Rgb];
  swing: number;
  seed: number;
}

/** All original and synthesised at run time, so no audio ships with the project. */
export const DEMOS: DemoSpec[] = [
  {
    id: 'demo-1',
    title: 'Low Tide',
    bpm: 96,
    bars: 24,
    root: 45,
    chords: [
      [0, 3, 7, 10],
      [-4, 0, 3, 7],
      [-7, -3, 0, 5],
      [-2, 2, 5, 9],
    ],
    colours: [
      [0.27, 0.2, 1],
      [1, 0.1, 0.12],
    ],
    swing: 0.08,
    seed: 11,
  },
  {
    id: 'demo-2',
    title: 'Glass Stairs',
    bpm: 122,
    bars: 32,
    root: 48,
    chords: [
      [0, 4, 7, 11],
      [-3, 0, 4, 7],
      [5, 9, 12, 16],
      [7, 11, 14, 17],
    ],
    colours: [
      [0.1, 0.85, 0.75],
      [1, 0.75, 0.15],
    ],
    swing: 0,
    seed: 23,
  },
  {
    id: 'demo-3',
    title: 'Slow Orbit',
    bpm: 78,
    bars: 16,
    root: 41,
    chords: [
      [0, 3, 7, 12],
      [3, 7, 10, 14],
      [-2, 2, 5, 10],
      [-5, -2, 2, 7],
    ],
    colours: [
      [1, 0.25, 0.65],
      [0.35, 0.85, 1],
    ],
    swing: 0.14,
    seed: 37,
  },
];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Plain maths, so it runs anywhere and renders the same every time. */
export function renderDemo(spec: DemoSpec, sr: number): Record<Stem, Float32Array> {
  const beat = 60 / spec.bpm;
  const dur = spec.bars * 4 * beat;
  const n = Math.round(dur * sr);
  const out: Record<Stem, Float32Array> = {
    vocals: new Float32Array(n),
    other: new Float32Array(n),
    drums: new Float32Array(n),
    bass: new Float32Array(n),
  };
  let seed = spec.seed * 7919;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stepTime = (bar: number, b: number) => (bar * 4 + b + (b % 1 === 0.5 ? spec.swing : 0)) * beat;

  const add = (dst: Float32Array, start: number, len: number, f: (t: number, i: number) => number) => {
    const s = Math.round(start * sr);
    const e = Math.min(n, s + Math.round(len * sr));
    for (let i = s; i < e; i++) dst[i] += f((i - s) / sr, i - s);
  };

  for (let bar = 0; bar < spec.bars; bar++) {
    const chord = spec.chords[bar % spec.chords.length];
    const section = Math.floor(bar / 8) % 2;

    // Drums.
    for (let b = 0; b < 4; b += 0.5) {
      const t0 = stepTime(bar, b);
      if (b % 2 === 0 || (section && b === 2.5)) {
        add(
          out.drums,
          t0,
          0.35,
          (t) => 0.9 * Math.sin(2 * Math.PI * (48 * t + 3.2 * (1 - Math.exp(-t * 40)))) * Math.exp(-t * 9),
        );
      }
      if (b % 2 === 1) {
        add(out.drums, t0, 0.22, (t) => {
          const noise = rnd() * 2 - 1;
          return (0.5 * noise + 0.3 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 18);
        });
      }
      let prev = 0;
      add(out.drums, t0, 0.06, (t) => {
        const w = rnd() * 2 - 1;
        const hp = w - prev;
        prev = w;
        return 0.18 * hp * Math.exp(-t * 80) * (b % 1 === 0 ? 1 : 0.6);
      });
    }

    // Bass.
    for (const [b, len, note] of [
      [0, 1.4, 0],
      [1.5, 0.4, 0],
      [2, 1.2, chord[0] === 0 ? 7 : 0],
      [3.5, 0.45, 12],
    ] as const) {
      const f = midi(spec.root - 12 + chord[0] + note);
      add(out.bass, stepTime(bar, b), len * beat, (t) => {
        const env = Math.min(1, t * 200) * Math.exp(-t * 1.6) * Math.min(1, (len * beat - t) * 60);
        const p = 2 * Math.PI * f * t;
        return 0.55 * env * (Math.sin(p) + 0.32 * Math.sin(2 * p + 0.5) + 0.12 * Math.sin(3 * p));
      });
    }

    // Other: a soft pad and an arpeggio.
    add(out.other, stepTime(bar, 0), 4 * beat, (t) => {
      const env = Math.min(1, t * 6) * Math.min(1, (4 * beat - t) * 6);
      let v = 0;
      for (const c of chord) {
        const f = midi(spec.root + 12 + c);
        v +=
          Math.sin(2 * Math.PI * f * t + Math.sin(2 * Math.PI * 0.3 * t)) + 0.3 * Math.sin(2 * Math.PI * 2.003 * f * t);
      }
      return 0.05 * env * v;
    });
    for (let s = 0; s < 8; s++) {
      if (!section && s % 2) continue;
      const c = chord[(s * 3) % chord.length];
      const f = midi(spec.root + 24 + c);
      add(out.other, stepTime(bar, s / 2), 0.5, (t) => {
        const p = 2 * Math.PI * f * t;
        return 0.14 * Math.exp(-t * 7) * Math.min(1, t * 400) * Math.sin(p + 2.4 * Math.exp(-t * 12) * Math.sin(2 * p));
      });
    }

    // Vocals: formant-shaped lead with vibrato, only in part of each phrase.
    if (bar % 4 < 3) {
      const phrase = [0, 2, 3, 2, 1, 3];
      for (let i = 0; i < phrase.length; i++) {
        const note = spec.root + 24 + chord[phrase[(i + bar) % phrase.length] % chord.length];
        const f = midi(note);
        const len = (i % 3 === 2 ? 1 : 0.5) * beat;
        const start = stepTime(bar, (i * 2) / 3);
        const vowel = i % 2 ? [730, 1090] : [390, 2300];
        add(out.vocals, start, len * 1.2, (t) => {
          const env = Math.min(1, t * 22) * Math.min(1, (len * 1.2 - t) * 18);
          const vib = 1 + 0.008 * Math.sin(2 * Math.PI * 5.4 * t) * Math.min(1, t * 3);
          let v = 0;
          for (let h = 1; h < 14; h++) {
            const fh = f * h;
            const form =
              Math.exp(-Math.pow((fh - vowel[0]) / 130, 2)) + 0.7 * Math.exp(-Math.pow((fh - vowel[1]) / 190, 2));
            v += (form + 0.04 / h) * Math.sin(2 * Math.PI * fh * vib * t);
          }
          return 0.28 * env * v;
        });
      }
    }
  }
  return out;
}
