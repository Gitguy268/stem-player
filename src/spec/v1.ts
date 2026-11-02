import { hex, type Arm, type Rgb } from './common';

/** Sources: docs/PARITY.md. Lengths are in units of the device radius unless noted. */
export const V1 = {
  name: 'Handheld (v1)',
  diameterCm: 7,
  /** Thickness over diameter, measured on the rotation video edge view. */
  thicknessRatio: 0.52,
  skins: {
    tan: { label: 'Tan', color: hex('#A98D80') },
    bao: { label: 'Bao', color: hex('#EDEDEC') },
    clear: { label: 'Clear', color: hex('#E2E2DE') },
  } as Record<string, { label: string; color: Rgb }>,
  /** Community manual config.txt */
  config: {
    seekJumpMs: 1000,
    isolationRampMs: 50,
    isolationHitBoxPct: 10,
    minVolumeDb: -30,
    fast2: 1.25,
    fast1: 1.15,
    slow1: 0.5,
    recordPeriodS: 60,
    recordSlots: 4,
  },
  /** Radial position of the four LEDs in each arm, over the device radius. Measured on the posters. */
  ledRadii: [0.33, 0.46, 0.59, 0.715],
  centreRadius: 0.13,
  /** Edge control angles, clockwise from the top seen from the front, rotation video. */
  edge: {
    power: { angle: 0, span: 11 },
    plus: { angle: 22, span: 12 },
    minus: { angle: 41, span: 12 },
    next: { angle: 66, span: 10 },
    prev: { angle: 94, span: 10 },
    grilleAngle: 315,
    portAngle: 228,
  },
  speedSteps: [0.5, 1, 1.15, 1.25],
  /** Bars at each vertical position, bottom outer to top outer. `null` is "no loop", all 8 lit. */
  loopBars: [0.25, 0.5, 1, 2, 4, 8, 16, null] as (number | null)[],
  /** The manual never names them, so these are reconstructed. See docs/PARITY.md. */
  effects: ['Reverb', 'Echo', 'Low-pass', 'High-pass', 'Flanger', 'Tremolo', 'Crush', 'Phaser'],
  timing: { hold: 350, isolate: 250, chordHold: 1000, seekRepeat: 1000, powerOff: 2000, pairing: 5000 },
  colours: { record: hex('#ff1a10'), pair: hex('#2a50ff'), white: hex('#ffffff') },
} as const;

export const armIndex: Record<Arm, number> = { top: 0, right: 1, bottom: 2, left: 3 };

/** 8 positions along an axis, 0 at the far end of the negative arm, 7 at the far end of the positive. */
export const axisPosition = (positiveArm: boolean, pos: number) => {
  const i = Math.min(3, Math.floor(pos * 4));
  return positiveArm ? 4 + i : 3 - i;
};
