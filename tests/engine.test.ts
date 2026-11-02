import { describe, expect, it } from 'vitest';
import { estimateBpm } from '../src/engine/bpm';
import { wrapPosition } from '../src/engine/player';
import { DEMOS, renderDemo } from '../src/library/demo';

const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe('wrapPosition', () => {
  it('clamps with no loop and wraps inside one, either direction', () => {
    expect(wrapPosition(12, 10, null)).toBe(10);
    expect(wrapPosition(-1, 10, null)).toBe(0);
    expect(wrapPosition(5.5, 10, { start: 2, end: 4 })).toBeCloseTo(3.5);
    expect(wrapPosition(1.5, 10, { start: 2, end: 4 })).toBeCloseTo(3.5);
  });
});

describe('demo tracks', () => {
  it('render the expected length, with four distinct audible stems and no clipping', () => {
    const spec = { ...DEMOS[2], bars: 4 };
    const stems = renderDemo(spec, 22050);
    const secs = (4 * 4 * 60) / spec.bpm;
    for (const s of Object.values(stems)) {
      expect(s.length).toBe(Math.round(secs * 22050));
      expect(rms(s)).toBeGreaterThan(0.005);
      expect(Math.max(...s.subarray(0, 40000))).toBeLessThan(1.5);
    }
    expect(stems.vocals[8000]).not.toBe(stems.other[8000]);
  });
  it('render the same every time', () => {
    const spec = { ...DEMOS[0], bars: 2 };
    expect(renderDemo(spec, 22050).drums.slice(0, 5000)).toEqual(renderDemo(spec, 22050).drums.slice(0, 5000));
  });
});

describe('estimateBpm', () => {
  it.each(DEMOS)('finds the tempo of $title', (spec) => {
    const short = { ...spec, bars: 12 };
    const bpm = estimateBpm(renderDemo(short, 22050).drums, 22050);
    expect(Math.abs(bpm - spec.bpm)).toBeLessThan(spec.bpm * 0.03);
  });
});
