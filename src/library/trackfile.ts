import type { Rgb, Stem } from '../spec/common';

export interface TrackInfo {
  title?: string;
  bpm?: number;
  colours?: [Rgb, Rgb];
  gainDb?: number;
}

/** Stem file numbering on the handheld: 1 other, 2 vocals, 3 bass, 4 drums. */
const NUMBERED: Record<string, Stem> = { '1': 'other', '2': 'vocals', '3': 'bass', '4': 'drums' };

export function stemFromFilename(name: string): Stem | null {
  const base = name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  if (NUMBERED[base]) return NUMBERED[base];
  if (/vocal|voice|acapella/.test(base)) return 'vocals';
  if (/drum|percussion/.test(base)) return 'drums';
  if (/bass/.test(base)) return 'bass';
  if (/other|melody|music|instrument/.test(base)) return 'other';
  return null;
}

const colour = (s: string): Rgb | null => {
  const n = s.split(/[\s,]+/).map(Number);
  if (n.length < 3 || n.slice(0, 3).some((v) => !Number.isFinite(v))) return null;
  return [n[0] / 255, n[1] / 255, n[2] / 255];
};

/**
 * TRACK.txt holds one `key: value` or `key=value` per line. Colours are
 * `inner r,g,b outer r,g,b` as six numbers, or a `[[r,g,b],[r,g,b]]` list.
 */
export function parseTrackTxt(text: string): TrackInfo {
  const out: TrackInfo = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_]+)\s*[:=]\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2];
    if (key === 'title' || key === 'name') out.title = val.replace(/^"|"$/g, '');
    else if (key === 'tempo_bpm' || key === 'bpm') {
      const b = parseFloat(val);
      if (b >= 30 && b <= 300) out.bpm = b;
    } else if (key === 'trackgain_db') {
      const g = parseFloat(val);
      if (Number.isFinite(g)) out.gainDb = g;
    } else if (key === 'trackcolour' || key === 'trackcolor') {
      const nums = val.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      if (nums.length >= 6) {
        const a = colour(nums.slice(0, 3).join(','));
        const b = colour(nums.slice(3, 6).join(','));
        if (a && b) out.colours = [a, b];
      }
    }
  }
  return out;
}

export function formatTrackTxt(i: TrackInfo): string {
  const c = (v: Rgb) => v.map((x) => Math.round(x * 255)).join(',');
  const lines = [];
  if (i.title) lines.push(`title: ${i.title}`);
  if (i.bpm) lines.push(`tempo_bpm: ${i.bpm}`);
  if (i.colours) lines.push(`TrackColour: [[${c(i.colours[0])}],[${c(i.colours[1])}]]`);
  lines.push(`TrackGain_dB: ${i.gainDb ?? 0}`);
  return lines.join('\n');
}

/** Community manual field names, mapped on to the live device settings. */
export const CONFIG_KEYS: Record<
  string,
  | 'seekJumpMs'
  | 'isolationRampMs'
  | 'isolationHitBoxPct'
  | 'minVolumeDb'
  | 'fast2'
  | 'fast1'
  | 'slow1'
  | 'recordPeriodS'
> = {
  SeekJumpPeriod: 'seekJumpMs',
  IsolationRampPeriod: 'isolationRampMs',
  IsolationHitBoxSize: 'isolationHitBoxPct',
  MinVolumeLevel: 'minVolumeDb',
  Fast2play: 'fast2',
  Fast1play: 'fast1',
  Slow1play: 'slow1',
  RecordPeriod: 'recordPeriodS',
};

export function parseConfigTxt(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*[:=]\s*(-?\d+(\.\d+)?)/);
    if (m && CONFIG_KEYS[m[1]]) out[CONFIG_KEYS[m[1]]] = parseFloat(m[2]);
  }
  return out;
}

export function formatConfigTxt(config: Record<string, number>): string {
  return Object.entries(CONFIG_KEYS)
    .map(([k, v]) => `${k}=${config[v]}`)
    .join('\n');
}
