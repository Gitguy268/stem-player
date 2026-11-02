import {
  ARMS,
  BLACK,
  STEM_AT,
  scale,
  type Arm,
  type Command,
  type Controller,
  type Lights,
  type Rgb,
  type Stem,
} from '../spec/common';
import { V2 } from '../spec/v2';

export type V2Menu = 'main' | 'loop' | 'speed';
const T = V2.timing;
const isArm = (id: string): id is Arm => (ARMS as readonly string[]).includes(id);

/** Stem2 behaviour from its how-to captions. See docs/PARITY.md for what is reconstructed. */
export class V2Controller implements Controller {
  powered = false;
  playing = false;
  menu: V2Menu = 'main';
  minimal = false;
  /** App setting "mute on button click". Off by default on the real device. */
  muteOnClick = false;
  recording = false;
  storage = false;
  linked = false;
  battery = 1;
  charging = false;
  swapped: Record<Arm, boolean> = { top: false, right: false, bottom: false, left: false };
  muted: Record<Arm, boolean> = { top: false, right: false, bottom: false, left: false };
  speed = 1;
  pitch = 0;
  loopPoint: Arm | null = null;
  slipPoint: Arm | null = null;
  trackColour: Rgb = V2.colours.session;
  partnerColour: Rgb = V2.colours.mix;
  transitioning = false;

  private held = new Map<string, number>();
  private consumed = new Set<string>();
  private isolating = new Set<Arm>();
  private pendingTap: { arm: Arm; at: number } | null = null;
  private lastSeek = 0;

  constructor(private emit: (c: Command) => void) {}

  private sendGains() {
    const gains = {} as Record<Stem, number>;
    for (const a of ARMS) {
      const audible = this.isolating.size ? this.isolating.has(a) : !this.muted[a];
      gains[STEM_AT[a]] = audible ? 1 : 0;
    }
    this.emit({ t: 'stemGains', gains });
  }

  private toggleSwap(a: Arm) {
    this.swapped[a] = !this.swapped[a];
    this.emit({ t: 'stemSource', stem: STEM_AT[a], swapped: this.swapped[a] });
  }

  private resetSwaps() {
    for (const a of ARMS) this.swapped[a] = false;
  }

  private exitLoopMenu() {
    if (this.loopPoint) {
      this.loopPoint = null;
      this.emit({ t: 'loop', beats: null });
    }
    // Stems swapped while looping complete into the next track on leaving the menu.
    if (ARMS.some((a) => this.swapped[a])) {
      this.resetSwaps();
      this.emit({ t: 'track', dir: 1, transition: true });
    }
  }

  private press(id: string, now: number) {
    if (id === 'centre') {
      if (this.menu === 'speed') {
        this.speed = 1;
        this.pitch = 0;
        this.emit({ t: 'speed', rate: 1 });
        this.emit({ t: 'pitch', semitones: 0 });
        this.emit({ t: 'clearEffects' });
      } else if (this.menu === 'loop') {
        this.exitLoopMenu();
        this.menu = 'main';
      } else {
        this.playing = !this.playing;
        this.emit({ t: this.playing ? 'play' : 'pause' });
      }
      return;
    }
    if (!isArm(id)) return;
    if (this.menu === 'loop') {
      if (this.loopPoint === id) {
        this.loopPoint = null;
        this.emit({ t: 'loop', beats: null });
      } else {
        this.loopPoint = id;
        this.emit({ t: 'loop', beats: V2.loopBeats[id] });
      }
    } else if (this.menu === 'speed') {
      if (id === 'right' || id === 'left') {
        const [lo, hi] = V2.speedRange;
        const d = id === 'right' ? V2.speedStep : -V2.speedStep;
        this.speed = Math.max(lo, Math.min(hi, Math.round((this.speed + d) * 100) / 100));
        this.emit({ t: 'speed', rate: this.speed });
      } else {
        const [lo, hi] = V2.pitchRange;
        this.pitch = Math.max(lo, Math.min(hi, this.pitch + (id === 'top' ? 1 : -1)));
        this.emit({ t: 'pitch', semitones: this.pitch });
      }
    } else if (this.muteOnClick) {
      if (this.pendingTap?.arm === id && now - this.pendingTap.at < T.doubleTap) {
        this.pendingTap = null;
        this.muted[id] = !this.muted[id];
        this.sendGains();
      } else {
        this.pendingTap = { arm: id, at: now };
      }
    } else {
      this.toggleSwap(id);
    }
  }

  down(id: string, now: number) {
    if (this.held.has(id)) return;
    this.held.set(id, now);
    this.consumed.delete(id);
    if (!this.powered) return;
    if ((id === 'next' || id === 'prev') && this.menu === 'main') {
      // A held stem plus skip changes which song that stem comes from.
      const a = ARMS.find((x) => this.held.has(x));
      if (a) {
        for (const x of ARMS) this.consumed.add(x);
        this.consumed.add(id);
        this.isolating.clear();
        this.sendGains();
        this.emit({ t: 'mixPartner', dir: id === 'next' ? 1 : -1 });
      }
    }
  }

  up(id: string, now: number) {
    const since = this.held.get(id);
    if (since === undefined) return;
    this.held.delete(id);
    const dur = now - since;
    if (!this.powered) {
      if (id === 'power' && !this.consumed.has('power')) {
        this.powered = true;
        this.emit({ t: 'power', on: true });
      }
      return;
    }

    if (isArm(id) && this.isolating.delete(id)) {
      this.sendGains();
      return;
    }
    if (isArm(id) && this.slipPoint === id) {
      this.slipPoint = null;
      this.emit({ t: 'slipLoop', beats: null });
      return;
    }
    if (this.consumed.has(id)) return;

    switch (id) {
      case 'centre':
      case 'top':
      case 'right':
      case 'bottom':
      case 'left':
        if (dur < T.hold) this.press(id, now);
        break;
      case 'power':
        if (this.storage) {
          this.storage = false;
          return;
        }
        if (this.menu === 'main') this.menu = 'loop';
        else if (this.menu === 'loop') {
          this.exitLoopMenu();
          this.menu = 'speed';
        } else this.menu = 'main';
        break;
      case 'plus':
      case 'minus':
        this.emit({ t: 'volume', delta: id === 'plus' ? 1 / 16 : -1 / 16 });
        break;
      case 'prev':
      case 'next':
        if (dur < T.hold) {
          this.resetSwaps();
          this.emit({ t: 'track', dir: id === 'next' ? 1 : -1, transition: this.playing && id === 'next' });
        }
        break;
      case 'bt':
        this.linked = !this.linked;
        this.emit({ t: 'link', on: this.linked });
        break;
      case 'fm':
        this.emit({ t: 'split' });
        break;
    }
  }

  tick(now: number) {
    const at = (id: string) => this.held.get(id);
    const dur = (id: string) => now - (at(id) ?? now);
    if (!this.powered) return;

    if (this.pendingTap && now - this.pendingTap.at >= T.doubleTap) {
      const a = this.pendingTap.arm;
      this.pendingTap = null;
      this.toggleSwap(a);
    }

    // Two hands on the side points starts and stops a recording.
    if (at('left') !== undefined && at('right') !== undefined) {
      if (Math.min(dur('left'), dur('right')) >= T.recordHold && !this.consumed.has('left')) {
        this.consumed.add('left').add('right');
        this.isolating.clear();
        this.sendGains();
        this.recording = !this.recording;
        this.emit({ t: 'record', on: this.recording });
      }
    }

    for (const a of ARMS) {
      if (at(a) === undefined || this.consumed.has(a) || dur(a) < T.hold) continue;
      if (at(a === 'left' ? 'right' : 'left') !== undefined && (a === 'left' || a === 'right')) continue;
      if (this.menu === 'main' && !this.isolating.has(a)) {
        this.isolating.add(a);
        this.sendGains();
      } else if (this.menu === 'loop' && this.slipPoint !== a) {
        this.slipPoint = a;
        this.emit({ t: 'slipLoop', beats: V2.loopBeats[a] });
      } else if (this.menu === 'speed' && a === 'right') {
        this.consumed.add(a);
        this.emit({ t: 'scratch' });
      }
    }

    if (
      at('centre') !== undefined &&
      !this.consumed.has('centre') &&
      this.menu === 'main' &&
      dur('centre') >= T.minimalHold
    ) {
      this.consumed.add('centre');
      this.minimal = !this.minimal;
    }

    for (const id of ['prev', 'next'] as const) {
      if (at(id) !== undefined && !this.consumed.has(id) && dur(id) >= T.hold && now - this.lastSeek >= T.seekRepeat) {
        this.lastSeek = now;
        this.emit({ t: 'seek', seconds: id === 'next' ? 2 : -2 });
      }
    }

    if (at('plus') !== undefined && at('power') !== undefined && !this.consumed.has('power')) {
      if (Math.min(dur('plus'), dur('power')) >= T.storageHold) {
        this.consumed.add('power').add('plus');
        this.storage = true;
        this.emit({ t: 'manage' });
      }
    } else if (at('power') !== undefined && dur('power') >= T.powerOff && !this.consumed.has('power')) {
      this.consumed.add('power');
      this.powered = false;
      this.playing = false;
      this.menu = 'main';
      this.emit({ t: 'pause' });
      this.emit({ t: 'power', on: false });
      return;
    }

    if (at('bt') !== undefined && dur('bt') >= T.pairHold && !this.consumed.has('bt')) {
      this.consumed.add('bt');
      this.linked = true;
      this.emit({ t: 'pair' });
    }

    if (at('plus') !== undefined && at('fm') !== undefined && Math.min(dur('plus'), dur('fm')) >= T.factoryReset) {
      if (!this.consumed.has('fm')) {
        this.consumed.add('fm').add('plus');
        this.emit({ t: 'factoryReset' });
      }
    }
  }

  lights(now: number, levels?: Record<Stem, number>): Lights {
    const off: Rgb[] = [BLACK, BLACK, BLACK, BLACK, BLACK];
    if (!this.powered) return { leds: off };
    const C = V2.colours;
    const indicator: Rgb | undefined = this.recording
      ? C.record
      : this.storage
        ? C.storage
        : this.charging
          ? C.idle
          : undefined;

    if (this.battery < 0.05 && !this.charging) {
      const c = Math.floor(now / 500) % 2 ? C.warn : scale(C.warn, 0.15);
      return { leds: [c, c, c, c, c], indicator };
    }
    if (this.minimal) return { leds: [scale(this.trackColour, 0.8), BLACK, BLACK, BLACK, BLACK], indicator };

    const dim = this.playing ? 1 : 0.55;
    if (this.menu === 'loop') {
      const lit = (a: Arm) => {
        if (this.slipPoint === a || this.loopPoint === a) return C.idle;
        return this.swapped[a] ? this.partnerColour : C.loop;
      };
      return { leds: [C.loop, ...ARMS.map(lit)], indicator };
    }
    if (this.menu === 'speed') {
      return { leds: [C.speed, scale(C.speed, 0.5), C.speed, scale(C.speedAccent, 0.8), C.speed], indicator };
    }
    const pointColour = (a: Arm) => {
      if (this.isolating.size && !this.isolating.has(a)) return BLACK;
      if (this.muted[a]) return BLACK;
      const base = this.swapped[a] ? this.partnerColour : this.trackColour;
      const meter = levels ? 0.7 + 0.3 * Math.min(1, levels[STEM_AT[a]] * 3) : 1;
      return scale(base, meter * dim);
    };
    return { leds: [scale(this.trackColour, dim), ...ARMS.map(pointColour)], indicator };
  }
}
