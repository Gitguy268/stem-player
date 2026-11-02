import { beforeEach, describe, expect, it } from 'vitest';
import { V2Controller } from '../src/controllers/v2';
import type { Command } from '../src/spec/common';

let log: Command[];
let c: V2Controller;
let now: number;
const of = (t: Command['t']) => log.filter((x) => x.t === t) as any[];
const adv = (ms: number) => {
  for (let e = now + ms; now < e; now += 16) c.tick(now);
  c.tick(now);
};
const tap = (id: string) => {
  c.down(id, now);
  adv(50);
  c.up(id, now);
};
const hold = (id: string, ms: number) => {
  c.down(id, now);
  adv(ms);
};

beforeEach(() => {
  log = [];
  now = 1000;
  c = new V2Controller((x) => log.push(x));
  tap('power');
});

describe('main', () => {
  it('centre plays and pauses', () => {
    tap('centre');
    expect(of('play')).toHaveLength(1);
    tap('centre');
    expect(of('pause')).toHaveLength(1);
  });
  it('tap swaps a stem in from the mix partner, tap again reverts it', () => {
    tap('top');
    expect(of('stemSource').at(-1)).toEqual({ t: 'stemSource', stem: 'vocals', swapped: true });
    expect(c.lights(now).leds[1]).toEqual(expect.anything());
    tap('top');
    expect(of('stemSource').at(-1).swapped).toBe(false);
  });
  it('holding stems isolates them, several together', () => {
    c.down('top', now);
    c.down('bottom', now);
    adv(400);
    expect(of('stemGains').at(-1).gains).toEqual({ vocals: 1, drums: 1, other: 0, bass: 0 });
    c.up('top', now);
    c.up('bottom', now);
    expect(of('stemGains').at(-1).gains.other).toBe(1);
    expect(of('stemSource')).toHaveLength(0);
  });
  it('holding a stem and skipping changes the mix partner, without skipping', () => {
    hold('top', 100);
    tap('next');
    c.up('top', now);
    expect(of('mixPartner')).toEqual([{ t: 'mixPartner', dir: 1 }]);
    expect(of('track')).toHaveLength(0);
    expect(of('stemSource')).toHaveLength(0);
  });
  it('with mute on click set, a double tap mutes and a single tap still swaps', () => {
    c.muteOnClick = true;
    tap('top');
    adv(20);
    tap('top');
    expect(of('stemGains').at(-1).gains.vocals).toBe(0);
    adv(300);
    expect(of('stemSource')).toHaveLength(0);
    tap('right');
    adv(300);
    expect(of('stemSource')).toHaveLength(1);
  });
  it('holding the centre toggles minimal mode, leaving only the centre lit', () => {
    hold('centre', 1100);
    c.up('centre', now);
    expect(c.minimal).toBe(true);
    expect(of('play')).toHaveLength(0);
    const l = c.lights(now).leds;
    expect(l[0][0] + l[0][1]).toBeGreaterThan(0);
    expect(l.slice(1).every((x) => x[0] + x[1] + x[2] === 0)).toBe(true);
    hold('centre', 1100);
    c.up('centre', now);
    expect(c.minimal).toBe(false);
  });
});

describe('edge buttons', () => {
  it('volume, tracks and seeking', () => {
    tap('plus');
    tap('minus');
    tap('next');
    tap('prev');
    expect(of('volume').length).toBe(2);
    expect(of('track').map((x) => x.dir)).toEqual([1, -1]);
    hold('next', 800);
    c.up('next', now);
    expect(of('seek').length).toBeGreaterThan(0);
    expect(of('track').length).toBe(2);
  });
  it('bluetooth tap toggles, hold pairs; FM splits', () => {
    tap('bt');
    expect(of('link').at(-1).on).toBe(true);
    hold('bt', 1100);
    c.up('bt', now);
    expect(of('pair')).toHaveLength(1);
    tap('fm');
    expect(of('split')).toHaveLength(1);
  });
  it('holding plus and FM for 10 s factory resets', () => {
    c.down('plus', now);
    c.down('fm', now);
    adv(9000);
    expect(of('factoryReset')).toHaveLength(0);
    adv(1100);
    expect(of('factoryReset')).toHaveLength(1);
  });
  it('plus and power enter storage mode with the pink indicator, power leaves it', () => {
    c.down('plus', now);
    c.down('power', now);
    adv(1600);
    c.up('plus', now);
    c.up('power', now);
    expect(of('manage')).toHaveLength(1);
    expect(c.lights(now).indicator).toBeDefined();
    tap('power');
    expect(c.storage).toBe(false);
    expect(c.menu).toBe('main');
  });
  it('holding power turns off', () => {
    hold('power', 2100);
    expect(c.powered).toBe(false);
    c.up('power', now);
    expect(c.powered).toBe(false);
    tap('power');
    expect(c.powered).toBe(true);
  });
});

describe('loop menu', () => {
  beforeEach(() => tap('power'));
  it('tap locks a standard loop of the right length, tap again unlocks', () => {
    for (const [id, beats] of [
      ['left', 2],
      ['bottom', 1],
      ['right', 0.5],
      ['top', 0.25],
    ] as const) {
      tap(id);
      expect(of('loop').at(-1).beats).toBe(beats);
    }
    tap('top');
    expect(of('loop').at(-1).beats).toBe(null);
  });
  it('touch and hold slips, and release returns to where the song would be', () => {
    hold('left', 400);
    expect(of('slipLoop').at(-1).beats).toBe(2);
    c.up('left', now);
    expect(of('slipLoop').at(-1).beats).toBe(null);
    expect(of('loop')).toHaveLength(0);
  });
  it('power moves on to the speed menu', () => {
    tap('power');
    expect(c.menu).toBe('speed');
    tap('power');
    expect(c.menu).toBe('main');
  });
  it('swapping stems during a loop completes as a transition on leaving', () => {
    c.swapped.top = true;
    tap('centre');
    expect(c.menu).toBe('main');
    expect(of('track').at(-1)).toMatchObject({ dir: 1, transition: true });
  });
});

describe('speed menu', () => {
  beforeEach(() => {
    tap('power');
    tap('power');
  });
  it('right and left step speed, top and bottom step pitch, centre resets', () => {
    tap('right');
    expect(of('speed').at(-1).rate).toBe(1.05);
    tap('top');
    expect(of('pitch').at(-1).semitones).toBe(1);
    tap('bottom');
    tap('bottom');
    expect(of('pitch').at(-1).semitones).toBe(-1);
    tap('centre');
    expect(of('speed').at(-1).rate).toBe(1);
    expect(of('pitch').at(-1).semitones).toBe(0);
    expect(of('clearEffects').length).toBe(1);
  });
  it('pushing the right point scratches', () => {
    hold('right', 400);
    expect(of('scratch')).toHaveLength(1);
    c.up('right', now);
    expect(of('speed')).toHaveLength(0);
  });
});

describe('record and warnings', () => {
  it('two hands on the side points records, with the red indicator', () => {
    c.down('left', now);
    c.down('right', now);
    adv(1600);
    c.up('left', now);
    c.up('right', now);
    expect(of('record').at(-1).on).toBe(true);
    expect(c.lights(now).indicator?.[0]).toBeGreaterThan(0.9);
  });
  it('flashes red on a low battery', () => {
    c.battery = 0.02;
    const a = c.lights(500).leds[0];
    const b = c.lights(1000).leds[0];
    expect(a[0]).not.toBe(b[0]);
    expect(a[1]).toBeLessThan(a[0]);
  });
});
