import { V1 } from '../spec/v1';
import { V2 } from '../spec/v2';

export type DeviceKind = 'v1' | 'v2';
export interface Control {
  id: string;
  label: string;
  /** Clockwise from the top seen from the front, degrees. */
  angle: number;
  span: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Signed distance to a capsule of half-length `l` along s and radius `w`. */
const capsule = (s: number, h: number, l: number, w: number) => Math.hypot(Math.max(Math.abs(s) - l, 0), h) - w;
const wrapDeg = (d: number) => ((d + 540) % 360) - 180;

export interface Shape {
  kind: DeviceKind;
  halfThickness: number;
  zOf(r: number, front: boolean): number;
  /** Outward displacement and an ambient occlusion factor at a surface point. */
  detail(x: number, y: number, z: number, out: { d: number; ao: number }): void;
  ledPositions(): [number, number, number][];
  indicator?: [number, number, number];
  controls: Control[];
}

const V1H = V1.thicknessRatio;
const V2H = V2.thicknessRatio;

/** Pill-shaped holes in a honeycomb. */
function grille(
  s: number,
  h: number,
  l: number,
  w: number,
  pitch: number,
  hole: number,
  out: { d: number; ao: number },
) {
  const sd = capsule(s, h, l, w);
  if (sd > 0.03) return;
  out.d -= 0.012 * (1 - smooth(-0.015, 0.02, sd));
  if (sd > -pitch * 0.45) return;
  const rowH = pitch * 0.866;
  const row = Math.round(h / rowH);
  const off = row % 2 ? pitch / 2 : 0;
  const col = Math.round((s - off) / pitch);
  const dist = Math.hypot(s - (col * pitch + off), h - row * rowH);
  const k = 1 - smooth(hole * 0.55, hole * 1.15, dist);
  out.d -= 0.05 * k;
  out.ao *= 1 - 0.85 * k;
}

/** A soft raised pill with a seam round it. */
function pill(s: number, h: number, l: number, w: number, out: { d: number; ao: number }) {
  const sd = capsule(s, h, l, w);
  if (sd > 0.04) return;
  const seam = 1 - smooth(0, 0.018, Math.abs(sd));
  out.d += 0.012 * (1 - smooth(-0.03, 0.005, sd)) - 0.009 * seam;
  out.ao *= 1 - 0.3 * seam;
}

const dimple = (s: number, h: number, r: number, depth: number, out: { d: number; ao: number }) => {
  const k = 1 - smooth(r * 0.5, r, Math.hypot(s, h));
  out.d -= depth * k;
  out.ao *= 1 - 0.4 * k;
};

const rimCoords = (x: number, y: number, a: number) => {
  const ang = (Math.atan2(x, y) * 180) / Math.PI;
  return (wrapDeg(ang - a) * Math.PI) / 180;
};

export function makeV1Shape(opts: { deepGrooves: boolean }): Shape {
  const zOf = (r: number) => V1H * Math.pow(Math.max(0, 1 - Math.pow(r, 2.15)), 0.5);
  const deep = opts.deepGrooves;
  const grooveDepth = deep ? 0.035 : 0.02;
  const grooveW = deep ? 0.34 : 0.11;
  const inner = deep ? 0.34 : V1.ledRadii[0] - 0.08;
  const outer = deep ? 0.72 : V1.ledRadii[3] + 0.04;
  const E = V1.edge;
  const ledAt = (x: number, y: number): [number, number, number] => {
    const r = Math.hypot(x, y);
    return [x, y, zOf(r) - grooveDepth * 0.7];
  };
  return {
    kind: 'v1',
    halfThickness: V1H,
    zOf,
    controls: [
      { id: 'power', label: 'Power', angle: E.power.angle, span: E.power.span },
      { id: 'plus', label: 'Volume up', angle: E.plus.angle, span: E.plus.span },
      { id: 'minus', label: 'Volume down', angle: E.minus.angle, span: E.minus.span },
      { id: 'next', label: 'Next', angle: E.next.angle, span: E.next.span },
      { id: 'prev', label: 'Previous', angle: E.prev.angle, span: E.prev.span },
    ],
    ledPositions() {
      const p: [number, number, number][] = [];
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
      ]) {
        for (const r of V1.ledRadii) p.push(ledAt(dx * r, dy * r));
      }
      return p;
    },
    detail(x, y, z, out) {
      const r = Math.hypot(x, y);
      if (z > 0 && r < 0.92) {
        // Grooves, a shallow channel with faded ends.
        const along = Math.abs(x) > Math.abs(y) ? Math.abs(x) : Math.abs(y);
        const across = Math.abs(x) > Math.abs(y) ? y : x;
        const mid = (inner + outer) / 2;
        const sd = capsule(along - mid, across, (outer - inner) / 2, grooveW * 0.45);
        const k = deep
          ? 1 - smooth(-0.022, 0.012, sd)
          : (1 - smooth(-grooveW * 0.45, grooveW * 0.55, sd)) * (1 - smooth(0.84, 0.91, r));
        if (k > 0) {
          out.d -= grooveDepth * k;
          out.ao *= 1 - (deep ? 0.04 : 0.07) * k;
        }
        // Centre button: a circular seam and a low dome.
        const c = deep ? 0.075 : V1.centreRadius;
        if (deep) dimple(x, y, 0.035, 0.012, out);
        const seam = 1 - smooth(0, 0.016, Math.abs(r - c));
        out.d += -0.006 * seam + 0.004 * (1 - smooth(0, c, r));
        out.ao *= 1 - 0.12 * seam;
      }
      if (deep) {
        // The dark board seen through clear silicone, lighter in the channels and fading at the rim.
        const along = Math.abs(x) > Math.abs(y) ? Math.abs(x) : Math.abs(y);
        const across = Math.abs(x) > Math.abs(y) ? y : x;
        const open =
          z > 0
            ? 1 - smooth(-0.03, 0.02, capsule(along - (inner + outer) / 2, across, (outer - inner) / 2, grooveW * 0.42))
            : 0;
        const body = (1 - smooth(0.62, 0.95, r)) * (1 - 0.32 * open);
        out.ao *= 1 - 0.55 * body;
      }
      // Rim controls and ports. Pills sit a little towards the back of the rim edge view.
      if (r < 0.55) return;
      const s = rimCoords(x, y, (E.plus.angle + E.minus.angle) / 2);
      if (Math.abs(s) < 0.5 && Math.abs(z) < 0.35) {
        pill(s, z, 0.2, 0.085, out);
        // The two marks of the volume pill.
        const a = capsule(s + 0.17, z, 0.0, 0.02);
        const b = capsule(s - 0.17, z, 0.028, 0.008);
        if (a < 0.015) out.d -= 0.006;
        if (b < 0.008) out.d -= 0.006;
      }
      const t = rimCoords(x, y, (E.next.angle + E.prev.angle) / 2);
      if (Math.abs(t) < 0.5 && Math.abs(z) < 0.35) {
        pill(t, z, 0.18, 0.08, out);
        dimple(t + 0.18, z, 0.05, 0.012, out);
        dimple(t - 0.18, z, 0.05, 0.012, out);
      }
      const u = rimCoords(x, y, E.power.angle);
      if (Math.abs(u) < 0.25 && Math.abs(z) < 0.28) pill(u, z, 0.08, 0.05, out);
      const g = rimCoords(x, y, E.grilleAngle);
      if (Math.abs(g) < 0.45 && z > -0.1) grille(g, z - 0.1, 0.17, 0.08, 0.05, 0.018, out);
      const p = rimCoords(x, y, E.portAngle);
      if (Math.abs(p) < 0.45 && Math.abs(z) < 0.3) {
        const sd = capsule(p, z, 0.14, 0.06);
        const k = 1 - smooth(-0.012, 0.012, sd);
        out.d -= 0.012 * k;
        const jack = 1 - smooth(0.025, 0.045, Math.hypot(p + 0.13, z));
        out.d -= 0.06 * jack;
        out.ao *= 1 - 0.9 * jack;
        const usb = 1 - smooth(-0.006, 0.01, capsule(p - 0.08, z, 0.045, 0.02));
        out.d -= 0.05 * usb;
        out.ao *= 1 - 0.85 * usb;
      }
    },
  };
}

export function makeV2Shape(): Shape {
  const zOf = (r: number, front: boolean) => {
    const base = V2H * Math.pow(Math.max(0, 1 - Math.pow(r, 2.6)), 0.5);
    // The dish fades out before the rim, so front and back meet exactly.
    return base - (front ? 0.14 : 0.11) * Math.exp(-Math.pow(r / 0.56, 2)) * (1 - Math.pow(r, 8));
  };
  const E = V2.edge;
  const R = V2.pointRadius;
  const led = (x: number, y: number): [number, number, number] => [x, y, zOf(Math.hypot(x, y), true) - 0.005];
  const portPos = (): [number, number, number] => {
    const a = (E.ports * Math.PI) / 180;
    return [Math.sin(a - 0.18) * 0.99, Math.cos(a - 0.18) * 0.99, 0];
  };
  return {
    kind: 'v2',
    halfThickness: V2H,
    zOf,
    indicator: portPos(),
    controls: [
      { id: 'power', label: 'Power', angle: E.power, span: 13 },
      { id: 'minus', label: 'Volume down', angle: E.volume.minus, span: 6 },
      { id: 'bt', label: 'Bluetooth', angle: E.volume.bt, span: 6 },
      { id: 'plus', label: 'Volume up', angle: E.volume.plus, span: 6 },
      { id: 'prev', label: 'Previous', angle: E.transport.prev, span: 6 },
      { id: 'fm', label: 'Split a song', angle: E.transport.fm, span: 6 },
      { id: 'next', label: 'Next', angle: E.transport.next, span: 6 },
      { id: 'aux', label: 'Aux input', angle: E.ports + 4, span: 5 },
      { id: 'usb', label: 'USB-C power', angle: E.ports - 4, span: 5 },
    ],
    ledPositions: () => [led(0, 0), led(0, R), led(R, 0), led(0, -R), led(-R, 0)],
    detail(x, y, z, out) {
      const r = Math.hypot(x, y);
      if (r < 0.6) return;
      for (const a of E.grilles) {
        const g = rimCoords(x, y, a);
        if (Math.abs(g) < 0.55) grille(g, z, 0.26, 0.14, 0.05, 0.016, out);
      }
      const pw = rimCoords(x, y, E.power);
      if (Math.abs(pw) < 0.3 && Math.abs(z) < 0.2) pill(pw, z, 0.13, 0.05, out);
      const vol = rimCoords(x, y, E.volume.bt);
      if (Math.abs(vol) < 0.5 && Math.abs(z) < 0.2) {
        pill(vol, z, 0.26, 0.055, out);
        const gap = (E.volume.plus - E.volume.bt) * (Math.PI / 180);
        dimple(vol, z, 0.022, 0.008, out);
        dimple(vol - gap, z, 0.022, 0.008, out);
        dimple(vol + gap, z, 0.022, 0.008, out);
      }
      const tr = rimCoords(x, y, E.transport.fm);
      if (Math.abs(tr) < 0.5 && Math.abs(z) < 0.2) {
        pill(tr, z, 0.26, 0.055, out);
        const gap = (E.transport.next - E.transport.fm) * (Math.PI / 180);
        dimple(tr, z, 0.028, 0.01, out);
        dimple(tr - gap, z, 0.018, 0.007, out);
        dimple(tr + gap, z, 0.018, 0.007, out);
      }
      const p = rimCoords(x, y, E.ports);
      if (Math.abs(p) < 0.4 && Math.abs(z) < 0.2) {
        const sd = capsule(p, z, 0.17, 0.065);
        const seam = 1 - smooth(0, 0.012, Math.abs(sd));
        out.d -= 0.006 * seam + 0.004 * (1 - smooth(-0.012, 0.012, sd));
        out.ao *= 1 - 0.3 * seam;
        const jack = 1 - smooth(0.022, 0.04, Math.hypot(p + 0.07, z));
        out.d -= 0.06 * jack;
        out.ao *= 1 - 0.9 * jack;
        const usb = 1 - smooth(-0.005, 0.009, capsule(p - 0.08, z, 0.03, 0.016));
        out.d -= 0.05 * usb;
        out.ao *= 1 - 0.85 * usb;
      }
    },
  };
}

export type Hit =
  { kind: 'arm'; arm: 'top' | 'right' | 'bottom' | 'left'; pos: number } | { kind: 'button'; id: string } | null;

const PT = V2.pointRadius;

/** Maps a point on the device, in its own coordinates, to the control there. */
export function hitControl(shape: Shape, x: number, y: number, z: number): Hit {
  const r = Math.hypot(x, y);
  if (shape.kind === 'v1') {
    if (z > 0 && r < V1.centreRadius + 0.03) return { kind: 'button', id: 'centre' };
    if (z > 0 && r < 0.92) {
      const horiz = Math.abs(x) > Math.abs(y);
      const along = horiz ? Math.abs(x) : Math.abs(y);
      const across = horiz ? Math.abs(y) : Math.abs(x);
      if (across < 0.15 && along > 0.2) {
        const arm = horiz ? (x > 0 ? 'right' : 'left') : y > 0 ? 'top' : 'bottom';
        const lo = V1.ledRadii[0] - 0.07;
        const hi = V1.ledRadii[3] + 0.07;
        return { kind: 'arm', arm, pos: Math.max(0, Math.min(1, (along - lo) / (hi - lo))) };
      }
    }
  } else if (z > 0) {
    const pts = [
      ['centre', 0, 0],
      ['top', 0, PT],
      ['right', PT, 0],
      ['bottom', 0, -PT],
      ['left', -PT, 0],
    ] as const;
    for (const [id, px, py] of pts) {
      if (Math.hypot(x - px, y - py) < 0.2) return { kind: 'button', id };
    }
  }
  if (r < 0.62 || Math.abs(z) > 0.34) return null;
  const ang = (Math.atan2(x, y) * 180) / Math.PI;
  let best: Control | null = null;
  let bestD = Infinity;
  for (const c of shape.controls) {
    const d = Math.abs(wrapDeg(ang - c.angle));
    if (d <= c.span && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best ? { kind: 'button', id: best.id } : null;
}
