export type Stem = 'vocals' | 'other' | 'drums' | 'bass';
export type Arm = 'top' | 'right' | 'bottom' | 'left';
export type Rgb = readonly [number, number, number];

export const ARMS: readonly Arm[] = ['top', 'right', 'bottom', 'left'];

/** Both devices lay the stems out the same way. "Other" is the "melody" of the Stem2 captions. */
export const STEM_AT: Record<Arm, Stem> = {
  top: 'vocals',
  right: 'other',
  bottom: 'drums',
  left: 'bass',
};
export const STEMS: readonly Stem[] = ARMS.map((a) => STEM_AT[a]);

export const hex = (h: string): Rgb => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];
export const BLACK: Rgb = [0, 0, 0];

/** Whatever a controller asks of the audio engine and the app around it. */
export type Command =
  | { t: 'play' }
  | { t: 'pause' }
  | { t: 'stemGains'; gains: Record<Stem, number> }
  | { t: 'speed'; rate: number }
  | { t: 'pitch'; semitones: number }
  | { t: 'scratch' }
  | { t: 'loop'; beats: number | null }
  | { t: 'slipLoop'; beats: number | null }
  | { t: 'nudgeLoop'; dir: -1 | 1 }
  | { t: 'effect'; index: number; amount: number }
  | { t: 'clearEffects' }
  | { t: 'track'; dir: -1 | 1; transition?: boolean }
  | { t: 'seek'; seconds: number }
  | { t: 'volume'; delta: number }
  | { t: 'album' }
  | { t: 'record'; on: boolean }
  | { t: 'pair' }
  | { t: 'link'; on: boolean }
  | { t: 'manage' }
  | { t: 'power'; on: boolean }
  | { t: 'stemSource'; stem: Stem; swapped: boolean }
  | { t: 'mixPartner'; dir: -1 | 1 }
  | { t: 'split' }
  | { t: 'factoryReset' };

export interface Lights {
  /** v1: 16 values, four per arm inner to outer, in ARMS order. v2: centre, then ARMS order. */
  leds: Rgb[];
  /** Small status LED on the v2 port panel. */
  indicator?: Rgb;
}

export interface Controller {
  readonly powered: boolean;
  /** Press or release of a named control, from pointer or keyboard. */
  down(id: string, now: number): void;
  up(id: string, now: number): void;
  /** Move along a v1 groove. `pointer` tells simultaneous fingers apart. */
  slide?(arm: Arm, pointer: number, pos: number, now: number): void;
  slideEnd?(arm: Arm, pointer: number, now: number): void;
  tick(now: number): void;
  lights(now: number, levels?: Record<Stem, number>): Lights;
}
