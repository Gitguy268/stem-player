import { beforeEach, describe, expect, it } from 'vitest';
import { V1Controller } from '../src/controllers/v1';
import type { Command } from '../src/spec/common';

let log: Command[];
let c: V1Controller;
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
  c = new V1Controller((x) => log.push(x));
  tap('power');
});

describe('main menu', () => {
  it('powers on and centre tap plays and pauses', () => {
    expect(c.powered).toBe(true);
    tap('centre');
    expect(c.playing).toBe(true);
    expect(of('play')).toHaveLength(1);
    tap('centre');
    expect(of('pause')).toHaveLength(1);
  });
  it('centre tap clears speed, loop and effects before pausing', () => {
    tap('centre');
    tap('power');
    c.slide('right', 1, 0.99, now);
    c.slideEnd('right', 1);
    expect(c.speed).toBe(1.25);
    tap('centre');
    expect(c.speed).toBe(1);
    expect(c.playing).toBe(true);
  });
  it('sliding sets a stem volume, outward louder', () => {
    c.slide('top', 1, 0.3, now);
    expect(c.levels.top).toBe(2);
    expect(of('stemGains').at(-1).gains.vocals).toBe(0.5);
    c.slide('top', 1, 0, now);
    expect(of('stemGains').at(-1).gains.vocals).toBe(0);
  });
  it('holding the outer end isolates, with several fingers together', () => {
    c.slide('top', 1, 0.97, now);
    c.slide('bottom', 2, 0.97, now);
    adv(300);
    const g = of('stemGains').at(-1).gains;
    expect(g).toEqual({ vocals: 1, drums: 1, other: 0, bass: 0 });
    c.slideEnd('top', 1);
    c.slideEnd('bottom', 2);
    expect(of('stemGains').at(-1).gains.bass).toBe(1);
  });
  it('holding centre while playing loops until released, which clears speed and effects', () => {
    tap('centre');
    hold('centre', 400);
    expect(c.instant).toBe(true);
    expect(of('loop').at(-1).beats).toBe(4);
    c.up('centre', now);
    expect(c.instant).toBe(false);
    expect(of('loop').at(-1).beats).toBe(null);
    expect(of('clearEffects').length).toBeGreaterThan(0);
    expect(c.playing).toBe(true);
  });
  it('power during an instant loop locks it and opens the loop menu', () => {
    tap('centre');
    hold('centre', 400);
    tap('power');
    expect(c.menu).toBe('loop');
    expect(c.loopPos).toBe(2);
    c.up('centre', now);
    expect(c.playing).toBe(true);
    expect(of('loop').at(-1).beats).toBe(4);
  });
  it('power then held centre locks the sliders, lights off, power unlocks', () => {
    hold('power', 100);
    hold('centre', 600);
    expect(c.locked).toBe(true);
    c.up('centre', now);
    c.up('power', now);
    expect(c.menu).toBe('main');
    c.slide('top', 1, 0.1, now);
    expect(c.levels.top).toBe(4);
    expect(c.lights(now).leds.every((l) => l[0] + l[1] + l[2] === 0)).toBe(true);
    tap('power');
    expect(c.locked).toBe(false);
  });
  it('holding power turns off', () => {
    hold('power', 2100);
    expect(c.powered).toBe(false);
    c.up('power', now);
    expect(c.powered).toBe(false);
    tap('power');
    expect(c.powered).toBe(true);
  });
  it('power on while holding centre opens disk mode', () => {
    hold('power', 2100);
    c.up('power', now);
    hold('centre', 100);
    tap('power');
    expect(of('manage')).toHaveLength(1);
    expect(c.powered).toBe(true);
  });
});

describe('track, volume and record buttons', () => {
  it('prev and next tap change track and clear speed and effects', () => {
    tap('next');
    expect(of('track').at(-1).dir).toBe(1);
    tap('prev');
    expect(of('track').at(-1).dir).toBe(-1);
    expect(of('clearEffects').length).toBe(2);
  });
  it('holding next while playing jumps by a second, repeatedly', () => {
    tap('centre');
    hold('next', 2500);
    c.up('next', now);
    expect(of('seek').length).toBeGreaterThanOrEqual(2);
    expect(of('seek')[0].seconds).toBe(1);
    expect(of('track')).toHaveLength(0);
  });
  it('holding next while paused plays at 1.25 until released', () => {
    hold('next', 400);
    expect(of('speed').at(-1).rate).toBe(1.25);
    expect(c.playing).toBe(true);
    c.up('next', now);
    expect(c.playing).toBe(false);
    expect(of('speed').at(-1).rate).toBe(1);
  });
  it('holding prev and next cycles the album', () => {
    c.down('prev', now);
    c.down('next', now);
    adv(800);
    c.up('prev', now);
    c.up('next', now);
    expect(of('album')).toHaveLength(1);
    expect(of('track')).toHaveLength(0);
  });
  it('plus and minus change the volume', () => {
    tap('plus');
    tap('minus');
    expect(of('volume').map((v) => Math.sign(v.delta))).toEqual([1, -1]);
  });
  it('holding plus starts and stops a recording, which also stops itself at 60 s', () => {
    hold('plus', 1100);
    c.up('plus', now);
    expect(of('record').at(-1).on).toBe(true);
    expect(c.lights(now).leds[4][0]).toBe(1);
    expect(of('volume')).toHaveLength(0);
    adv(61000);
    expect(c.recording).toBe(false);
  });
  it('holding plus and minus pairs, with blue lights', () => {
    c.down('plus', now);
    c.down('minus', now);
    adv(1100);
    c.up('plus', now);
    c.up('minus', now);
    expect(of('pair')).toHaveLength(1);
    expect(of('record')).toHaveLength(0);
    expect(of('volume')).toHaveLength(0);
    const blue = c.lights(now).leds;
    expect(blue.every((l) => l[2] >= l[0])).toBe(true);
  });
  it('tapping plus and minus together toggles the link', () => {
    c.down('plus', now);
    c.down('minus', now);
    adv(100);
    c.up('plus', now);
    c.up('minus', now);
    expect(of('link').at(-1).on).toBe(true);
    expect(of('volume')).toHaveLength(0);
  });
});

describe('loop and speed menu', () => {
  beforeEach(() => tap('power'));
  it('right is forward and left is reverse, inner to outer 50, 100, 115, 125', () => {
    const rates = [0.05, 0.3, 0.6, 0.9].map((p) => {
      c.slide('right', 1, p, now);
      return c.speed;
    });
    expect(rates).toEqual([0.5, 1, 1.15, 1.25]);
    c.slideEnd('right', 1);
    c.slide('left', 1, 0.9, now);
    expect(c.speed).toBe(-1.25);
  });
  it('vertical runs 0.25 to 16 bars bottom to top, and all 8 lit is no loop', () => {
    const bars = [
      ['bottom', 0.9],
      ['bottom', 0.6],
      ['bottom', 0.3],
      ['bottom', 0.1],
      ['top', 0.1],
      ['top', 0.3],
      ['top', 0.6],
    ].map(([a, p]) => {
      c.slide(a as 'top', 1, p as number, now);
      return of('loop').at(-1).beats / 4;
    });
    expect(bars).toEqual([0.25, 0.5, 1, 2, 4, 8, 16]);
    c.slide('top', 1, 0.9, now);
    expect(of('loop').at(-1).beats).toBe(null);
    const lit = c.lights(now).leds.filter((_, i) => i < 4 || (i >= 8 && i < 12));
    expect(lit.every((l) => l[0] + l[1] + l[2] > 0)).toBe(true);
  });
  it('prev and next nudge the loop', () => {
    tap('next');
    expect(of('nudgeLoop').at(-1).dir).toBe(1);
    expect(of('track')).toHaveLength(0);
  });
  it('centre clears, then returns to main', () => {
    c.slide('right', 1, 0.9, now);
    c.slideEnd('right', 1);
    tap('centre');
    expect(c.speed).toBe(1);
    expect(c.menu).toBe('loop');
    tap('centre');
    expect(c.menu).toBe('main');
  });
  it('plus or minus opens effects, and so does holding centre then plus', () => {
    tap('plus');
    expect(c.menu).toBe('effects');
    tap('power');
    tap('power');
    expect(c.menu).toBe('main');
    tap('power');
    hold('centre', 100);
    tap('plus');
    c.up('centre', now);
    expect(c.menu).toBe('effects');
  });
});

describe('effects menu', () => {
  beforeEach(() => {
    tap('power');
    tap('plus');
  });
  it('vertical picks one of 8, horizontal sets intensity, opposite end removes', () => {
    c.slide('top', 1, 0.9, now);
    c.slideEnd('top', 1);
    expect(c.effectIndex).toBe(7);
    c.slide('right', 1, 0.9, now);
    expect(of('effect').at(-1)).toMatchObject({ index: 7, amount: 1 });
    c.slideEnd('right', 1);
    c.slide('left', 1, 0.9, now);
    expect(of('effect').at(-1)).toMatchObject({ index: 7, amount: 0 });
  });
  it('power steps back: twice reaches main', () => {
    tap('power');
    expect(c.menu).toBe('loop');
    tap('power');
    expect(c.menu).toBe('main');
  });
});
