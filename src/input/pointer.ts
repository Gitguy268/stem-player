import type { Arm, Controller } from '../spec/common';
import type { Hit } from '../scene/shape';
import type { Stage } from '../scene/stage';

type Touch = { kind: 'arm'; arm: Arm } | { kind: 'button'; id: string } | { kind: 'orbit'; x: number; y: number };

/** Every finger on its own: controls get pressed, anything else turns the device. */
export class PointerInput {
  private touches = new Map<number, Touch>();
  private latched = new Set<string>();
  onLatch: ((held: string[]) => void) | null = null;
  onTouch: (() => void) | null = null;
  onPort: ((id: 'aux' | 'usb') => void) | null = null;

  constructor(
    private el: HTMLElement,
    private stage: Stage,
    private controller: () => Controller,
  ) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private ndc(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1] as const;
  }

  private pick(e: PointerEvent): { hit: Hit; point?: { x: number; y: number; z: number } } {
    const [x, y] = this.ndc(e);
    const p = this.stage.pick(x, y);
    return p ? { hit: p.hit, point: p.point } : { hit: null };
  }

  private down(e: PointerEvent) {
    this.onTouch?.();
    this.el.setPointerCapture(e.pointerId);
    const { hit, point } = this.pick(e);
    const now = performance.now();
    const c = this.controller();
    if (hit?.kind === 'button' && (hit.id === 'aux' || hit.id === 'usb')) {
      this.onPort?.(hit.id);
      return;
    }
    if (hit?.kind === 'button') {
      // Right click or ctrl click latches a control, so chords work with one mouse.
      if (e.button === 2 || e.ctrlKey) {
        if (this.latched.delete(hit.id)) c.up(hit.id, now);
        else {
          this.latched.add(hit.id);
          c.down(hit.id, now);
        }
        this.onLatch?.([...this.latched]);
        return;
      }
      if (this.latched.has(hit.id)) {
        this.latched.delete(hit.id);
        c.up(hit.id, now);
        this.onLatch?.([...this.latched]);
        return;
      }
      this.touches.set(e.pointerId, { kind: 'button', id: hit.id });
      c.down(hit.id, now);
    } else if (hit?.kind === 'arm' && c.slide) {
      this.touches.set(e.pointerId, { kind: 'arm', arm: hit.arm });
      c.slide(hit.arm, e.pointerId, hit.pos, now);
    } else {
      this.touches.set(e.pointerId, { kind: 'orbit', x: e.clientX, y: e.clientY });
      this.el.style.cursor = 'grabbing';
      return;
    }
    if (point) this.stage.device.press(e.pointerId, point.x, point.y, point.z);
    navigator.vibrate?.(8);
  }

  private move(e: PointerEvent) {
    const t = this.touches.get(e.pointerId);
    if (!t) {
      if (e.pointerType === 'mouse') {
        const { hit, point } = this.pick(e);
        this.el.style.cursor = hit ? 'pointer' : point ? 'grab' : 'default';
      }
      return;
    }
    if (t.kind === 'orbit') {
      this.stage.rotate(e.clientX - t.x, e.clientY - t.y);
      t.x = e.clientX;
      t.y = e.clientY;
    } else if (t.kind === 'arm') {
      const { hit, point } = this.pick(e);
      if (hit?.kind === 'arm' && hit.arm === t.arm) {
        this.controller().slide?.(t.arm, e.pointerId, hit.pos, performance.now());
        if (point) this.stage.device.press(e.pointerId, point.x, point.y, point.z);
      }
    }
  }

  private up(e: PointerEvent) {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    this.stage.device.release(e.pointerId);
    this.el.style.cursor = '';
    if (!t) return;
    const c = this.controller();
    const now = performance.now();
    if (t.kind === 'button') c.up(t.id, now);
    else if (t.kind === 'arm') c.slideEnd?.(t.arm, e.pointerId, now);
  }

  /** Releases everything when switching device. */
  reset() {
    const now = performance.now();
    const c = this.controller();
    for (const id of this.latched) c.up(id, now);
    this.latched.clear();
    this.onLatch?.([]);
    this.touches.clear();
  }
}
