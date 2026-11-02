import {
  ARMS,
  BLACK,
  STEM_AT,
  mix,
  scale,
  type Arm,
  type Command,
  type Controller,
  type Lights,
  type Rgb,
  type Stem,
} from '../spec/common';
import { V1, armIndex, axisPosition } from '../spec/v1';

export type V1Menu = 'main' | 'loop' | 'effects';
type Finger = { arm: Arm; pos: number; since: number; outer: boolean };

const T = V1.timing;

/** Every row of the v1 control table in docs/PARITY.md, with no audio or graphics in it. */
export class V1Controller implements Controller {
  powered = false;
  playing = false;
  menu: V1Menu = 'main';
  locked = false;
  linked = false;
  recording = false;
  instant = false;
  /** Level 0 to 4 per arm. */
  levels: Record<Arm, number> = { top: 4, right: 4, bottom: 4, left: 4 };
  /** 0 to 3 along `V1.speedSteps`; `reverse` picks the arm. */
  speedIndex = 1;
  reverse = false;
  loopPos = 7;
  effectIndex = 0;
  effects = new Array<number>(8).fill(0);
  colours: [Rgb, Rgb] = [
    [0.27, 0.2, 1],
    [1, 0.1, 0.12],
  ];

  private held = new Map<string, number>();
  private consumed = new Set<string>();
  private fingers = new Map<number, Finger>();
  private isolating = new Set<Arm>();
  private lastSeek = 0;
  private fastHold: 'prev' | 'next' | null = null;
  private flash: { until: number; kind: 'pair' | 'record' | 'volume' | 'album' | 'link' } | null = null;
  private recordStart = 0;
  private volume = 0.75;

  constructor(private emit: (c: Command) => void) {}

  get speed() {
    const r = V1.speedSteps[this.speedIndex];
    return this.reverse ? -r : r;
  }

  private anyAltered() {
    return this.speedIndex !== 1 || this.reverse || this.loopPos !== 7 || this.effects.some((a) => a > 0);
  }

  private clearAltered() {
    this.speedIndex = 1;
    this.reverse = false;
    this.loopPos = 7;
    this.effects.fill(0);
    this.emit({ t: 'speed', rate: 1 });
    this.emit({ t: 'loop', beats: null });
    this.emit({ t: 'clearEffects' });
  }

  private clearSpeedEffects() {
    this.speedIndex = 1;
    this.reverse = false;
    this.effects.fill(0);
    this.emit({ t: 'speed', rate: 1 });
    this.emit({ t: 'clearEffects' });
  }

  private sendGains() {
    const min = 0;
    const gains = {} as Record<Stem, number>;
    for (const a of ARMS) {
      const on = this.isolating.size === 0 || this.isolating.has(a);
      gains[STEM_AT[a]] = on ? this.levels[a] / 4 : min;
    }
    this.emit({ t: 'stemGains', gains });
  }

  private setPower(on: boolean, now: number) {
    this.powered = on;
    this.emit({ t: 'power', on });
    if (!on) {
      if (this.recording) this.toggleRecord(now);
      this.playing = false;
      this.menu = 'main';
      this.instant = false;
      this.emit({ t: 'pause' });
    }
  }

  private toggleRecord(now: number) {
    this.recording = !this.recording;
    this.recordStart = now;
    this.emit({ t: 'record', on: this.recording });
    this.flash = { until: now + 1200, kind: 'record' };
  }

  down(id: string, now: number) {
    if (this.held.has(id)) return;
    this.held.set(id, now);
    this.consumed.delete(id);
    if (!this.powered) return;
    if (id === 'power' && this.instant) {
      // Instant loop held, then power: lock it and go to the loop menu.
      this.instant = false;
      this.loopPos = 2;
      this.menu = 'loop';
      this.consumed.add('power').add('centre');
      this.emit({ t: 'loop', beats: V1.loopBars[2]! * 4 });
    }
  }

  up(id: string, now: number) {
    const since = this.held.get(id);
    if (since === undefined) return;
    this.held.delete(id);
    const consumed = this.consumed.has(id);
    const dur = now - since;

    if (!this.powered) {
      if (id === 'power' && !consumed) {
        // Power on while holding centre opens the storage (disk) mode.
        if (this.held.has('centre')) {
          this.consumed.add('centre');
          this.emit({ t: 'manage' });
        }
        this.setPower(true, now);
      }
      return;
    }

    if (id === 'centre' && this.instant) {
      this.instant = false;
      this.emit({ t: 'loop', beats: null });
      this.clearSpeedEffects();
      return;
    }
    if (consumed) return;

    switch (id) {
      case 'centre':
        if (this.locked) return;
        if (this.anyAltered()) this.clearAltered();
        else if (this.menu !== 'main') this.menu = 'main';
        else {
          this.playing = !this.playing;
          this.emit({ t: this.playing ? 'play' : 'pause' });
        }
        break;
      case 'power':
        if (this.locked) {
          this.locked = false;
          return;
        }
        this.menu = this.menu === 'main' ? 'loop' : this.menu === 'effects' ? 'loop' : 'main';
        break;
      case 'next':
      case 'prev':
        if (this.fastHold) {
          this.fastHold = null;
          this.playing = false;
          this.emit({ t: 'pause' });
          this.emit({ t: 'speed', rate: this.speed });
          return;
        }
        if (dur >= T.hold) return;
        if (this.menu === 'loop') {
          this.emit({ t: 'nudgeLoop', dir: id === 'next' ? 1 : -1 });
        } else {
          this.clearSpeedEffects();
          this.emit({ t: 'track', dir: id === 'next' ? 1 : -1 });
        }
        break;
      case 'plus':
      case 'minus': {
        const other = id === 'plus' ? 'minus' : 'plus';
        if (this.held.has(other)) {
          // Both tapped together: toggle the link. The partner's release is swallowed.
          this.consumed.add(other);
          this.linked = !this.linked;
          this.emit({ t: 'link', on: this.linked });
          this.flash = { until: now + 800, kind: 'link' };
          return;
        }
        if (this.menu === 'loop') {
          this.menu = 'effects';
          return;
        }
        this.volume = Math.min(1, Math.max(0, this.volume + (id === 'plus' ? 1 : -1) / 16));
        this.emit({ t: 'volume', delta: id === 'plus' ? 1 / 16 : -1 / 16 });
        this.flash = { until: now + 900, kind: 'volume' };
        break;
      }
    }
  }

  slide(arm: Arm, pointer: number, pos: number, now: number) {
    if (!this.powered || this.locked) return;
    const outer = pos >= 1 - V1.config.isolationHitBoxPct / 40;
    const f = this.fingers.get(pointer);
    const cur = f?.arm === arm ? f : { arm, pos, since: now, outer };
    if (cur.outer !== outer) cur.since = now;
    cur.pos = pos;
    cur.outer = outer;
    this.fingers.set(pointer, cur);
    const horizontal = arm === 'left' || arm === 'right';
    if (this.menu === 'main') {
      if (this.isolating.has(arm)) return;
      this.levels[arm] = Math.max(0, Math.min(4, Math.ceil(pos * 4)));
      this.sendGains();
    } else if (this.menu === 'loop') {
      if (horizontal) {
        this.reverse = arm === 'left';
        this.speedIndex = Math.min(3, Math.floor(pos * 4));
        this.emit({ t: 'speed', rate: this.speed });
      } else {
        this.setLoopPos(axisPosition(arm === 'top', pos));
      }
    } else if (horizontal) {
      this.setEffect(axisPosition(arm === 'right', pos) / 7);
    } else {
      this.effectIndex = axisPosition(arm === 'top', pos);
    }
  }

  private setLoopPos(p: number) {
    if (p === this.loopPos) return;
    this.loopPos = p;
    const bars = V1.loopBars[p];
    this.emit({ t: 'loop', beats: bars === null ? null : bars * 4 });
  }

  private setEffect(amount: number) {
    this.effects[this.effectIndex] = amount;
    this.emit({ t: 'effect', index: this.effectIndex, amount });
  }

  slideEnd(arm: Arm, pointer: number) {
    this.fingers.delete(pointer);
    if (this.isolating.delete(arm)) this.sendGains();
  }

  tick(now: number) {
    const at = (id: string) => this.held.get(id);
    const dur = (id: string) => now - (at(id) ?? now);

    if (!this.powered) return;

    // Lock: power first, then a held centre. With a loop-capable state, centre first means instant loop.
    if (at('power') !== undefined && at('centre') !== undefined && !this.consumed.has('centre')) {
      const powerFirst = at('power')! <= at('centre')!;
      if ((powerFirst || !this.playing) && dur('centre') >= T.chordHold / 2) {
        this.locked = true;
        this.consumed.add('power').add('centre');
      }
    }
    if (dur('power') >= T.powerOff && at('centre') === undefined && !this.consumed.has('power')) {
      this.consumed.add('power');
      this.setPower(false, now);
      return;
    }

    if (at('centre') !== undefined && !this.consumed.has('centre') && !this.instant) {
      if (
        this.playing &&
        !this.locked &&
        at('power') === undefined &&
        this.menu === 'main' &&
        dur('centre') >= T.hold
      ) {
        this.instant = true;
        this.emit({ t: 'loop', beats: 4 });
      }
    }

    // Alternate route from the community guide: hold centre, tap plus.
    if (
      at('centre') !== undefined &&
      at('plus') !== undefined &&
      this.menu !== 'effects' &&
      !this.consumed.has('plus')
    ) {
      if (this.instant) {
        this.instant = false;
        this.emit({ t: 'loop', beats: null });
      }
      this.menu = 'effects';
      this.consumed.add('plus').add('centre');
    }

    if (at('prev') !== undefined && at('next') !== undefined) {
      if (Math.min(dur('prev'), dur('next')) >= T.hold * 2 && !this.consumed.has('prev')) {
        this.consumed.add('prev').add('next');
        this.emit({ t: 'album' });
        this.flash = { until: now + 800, kind: 'album' };
      }
    } else {
      for (const id of ['prev', 'next'] as const) {
        if (at(id) === undefined || this.consumed.has(id) || dur(id) < T.hold || this.menu === 'loop') continue;
        if (this.playing && !this.fastHold) {
          if (now - this.lastSeek >= T.seekRepeat) {
            this.lastSeek = now;
            this.emit({ t: 'seek', seconds: (id === 'next' ? 1 : -1) * (V1.config.seekJumpMs / 1000) });
          }
        } else if (!this.playing) {
          this.fastHold = id;
          this.playing = true;
          this.emit({ t: 'speed', rate: id === 'next' ? V1.config.fast2 : -V1.config.fast2 });
          this.emit({ t: 'play' });
        }
      }
    }

    if (at('plus') !== undefined && at('minus') !== undefined) {
      if (Math.min(dur('plus'), dur('minus')) >= T.chordHold && !this.consumed.has('plus')) {
        this.consumed.add('plus').add('minus');
        this.linked = true;
        this.emit({ t: 'pair' });
        this.flash = { until: now + T.pairing, kind: 'pair' };
      }
    } else if (at('plus') !== undefined && dur('plus') >= T.chordHold && !this.consumed.has('plus')) {
      this.consumed.add('plus');
      this.toggleRecord(now);
    }

    if (this.recording && now - this.recordStart >= V1.config.recordPeriodS * 1000) this.toggleRecord(now);

    let changed = false;
    for (const f of this.fingers.values()) {
      if (this.menu === 'main' && f.outer && now - f.since >= T.isolate && !this.isolating.has(f.arm)) {
        this.isolating.add(f.arm);
        changed = true;
      }
    }
    if (changed) this.sendGains();
    if (this.flash && now > this.flash.until) this.flash = null;
  }

  lights(now: number, levels?: Record<Stem, number>): Lights {
    const leds: Rgb[] = new Array(16).fill(BLACK);
    if (!this.powered) return { leds };
    const set = (arm: Arm, i: number, c: Rgb) => (leds[armIndex[arm] * 4 + i] = c);
    const [inner, outer] = this.colours;
    const grad = (i: number) => mix(inner, outer, i / 3);
    const f = this.flash;

    if (f?.kind === 'pair') {
      // Blue, with light flowing outward from the centre.
      const step = Math.floor((now - (f.until - T.pairing)) / 180) % 5;
      for (const a of ARMS) for (let i = 0; i < 4; i++) set(a, i, scale(V1.colours.pair, i === step ? 1 : 0.2));
      return { leds };
    }
    if (f?.kind === 'album' || f?.kind === 'link') {
      const c = f.kind === 'link' ? V1.colours.pair : V1.colours.white;
      for (const a of ARMS) set(a, 0, c);
      return { leds };
    }
    if (f?.kind === 'volume') {
      const lit = Math.round(this.volume * 16);
      for (let n = 0; n < 16; n++) leds[n] = n < lit ? scale(V1.colours.white, 0.8) : BLACK;
      return { leds };
    }
    if (f?.kind === 'record') {
      // The red line.
      for (const a of ['left', 'right'] as const) for (let i = 0; i < 4; i++) set(a, i, V1.colours.record);
      return { leds };
    }
    if (this.locked) return { leds };

    if (this.menu === 'main') {
      for (const a of ARMS) {
        const on = this.isolating.size === 0 || this.isolating.has(a);
        const meter = levels ? 0.75 + 0.25 * Math.min(1, levels[STEM_AT[a]] * 3) : 1;
        for (let i = 0; i < 4; i++) set(a, i, on && i < this.levels[a] ? scale(grad(i), meter) : BLACK);
      }
      // Only the instant loop shows through, as a slow breath.
      if (this.instant) for (const a of ARMS) set(a, 0, V1.colours.white);
    } else if (this.menu === 'loop') {
      const axis = this.reverse ? 'left' : 'right';
      for (let i = 0; i <= this.speedIndex; i++) set(axis, i, outer);
      for (let p = 0; p <= this.loopPos; p++) {
        if (p < 4) set('bottom', 3 - p, outer);
        else set('top', p - 4, outer);
      }
    } else {
      const p = this.effectIndex;
      if (p < 4) set('bottom', 3 - p, inner);
      else set('top', p - 4, inner);
      const lit = Math.round(this.effects[p] * 7);
      for (let n = 0; n <= lit; n++) {
        if (n < 4) set('left', 3 - n, inner);
        else set('right', n - 4, inner);
      }
    }
    if (this.recording && Math.floor(now / 500) % 2 === 0) set('right', 3, V1.colours.record);
    return { leds };
  }
}
