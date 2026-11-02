import { hex } from './common';

export const V2 = {
  name: 'Speaker (v2)',
  /** Not published. Estimated against hands in the how-to video. */
  diameterCm: 22,
  thicknessRatio: 0.42,
  color: hex('#D5D4BE'),
  /** Touch point radius over the device radius, measured on the rotation video. */
  pointRadius: 0.79,
  /** Edge groups, clockwise from the top seen from the front. */
  edge: {
    grilles: [0, 90, 180, 270],
    power: 45,
    volume: { minus: 123, bt: 135, plus: 147 },
    transport: { prev: 303, fm: 315, next: 327 },
    ports: 225,
  },
  /** How-to captions: left 2, bottom 1, right 1/2, top 1/4. */
  loopBeats: { left: 2, bottom: 1, right: 0.5, top: 0.25 },
  speedStep: 0.05,
  speedRange: [0.5, 1.5],
  pitchRange: [-12, 12],
  timing: {
    tap: 180,
    doubleTap: 240,
    hold: 350,
    minimalHold: 1000,
    seekRepeat: 250,
    powerOff: 2000,
    recordHold: 1500,
    factoryReset: 10000,
    storageHold: 1500,
    pairHold: 1000,
  },
  colours: {
    idle: hex('#ffffff'),
    session: hex('#4fe8f0'),
    mix: hex('#ff5fd0'),
    loop: hex('#6df08c'),
    speed: hex('#4fe8f0'),
    speedAccent: hex('#ff7a55'),
    record: hex('#ff2a18'),
    storage: hex('#ff4fb0'),
    bluetooth: hex('#3a6bff'),
    warn: hex('#ff3a30'),
  },
} as const;
