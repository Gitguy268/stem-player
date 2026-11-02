import { STEMS, type Rgb, type Stem } from '../spec/common';
import { estimateBpm } from '../engine/bpm';
import type { LoadedTrack, StemBuffers } from '../engine/player';
import { DEMOS, type DemoSpec } from './demo';
import { encodeWav } from './wav';

export type Album = 'demo' | 'custom' | 'recordings';
export interface TrackMeta {
  id: string;
  album: Album;
  title: string;
  bpm: number;
  colours: [Rgb, Rgb];
  gainDb?: number;
  /** Seconds, for recordings. */
  seconds?: number;
  created?: number;
  mime?: string;
}

const PALETTES: [Rgb, Rgb][] = [
  [
    [0.27, 0.2, 1],
    [1, 0.1, 0.12],
  ],
  [
    [0.1, 0.85, 0.75],
    [1, 0.75, 0.15],
  ],
  [
    [1, 0.25, 0.65],
    [0.35, 0.85, 1],
  ],
  [
    [0.5, 1, 0.3],
    [0.2, 0.3, 1],
  ],
  [
    [1, 0.5, 0.1],
    [0.8, 0.15, 0.9],
  ],
];

/** A small file store: the Origin Private File System, or memory where it is missing. */
class Disk {
  private root: Promise<FileSystemDirectoryHandle | null>;
  private mem = new Map<string, Blob>();
  constructor() {
    this.root = (async () => {
      try {
        const r = await navigator.storage.getDirectory();
        return await r.getDirectoryHandle('library', { create: true });
      } catch {
        return null;
      }
    })();
  }
  get persistent() {
    return this.root.then((r) => !!r);
  }
  private async dir(path: string[], create: boolean) {
    let d = await this.root;
    if (!d) return null;
    for (const p of path) d = await d.getDirectoryHandle(p, { create });
    return d;
  }
  async write(path: string, blob: Blob) {
    const parts = path.split('/');
    const name = parts.pop()!;
    const d = await this.dir(parts, true);
    if (!d) {
      this.mem.set(path, blob);
      return;
    }
    const f = await d.getFileHandle(name, { create: true });
    const w = await f.createWritable();
    await w.write(blob);
    await w.close();
  }
  async read(path: string): Promise<Blob | null> {
    try {
      const parts = path.split('/');
      const name = parts.pop()!;
      const d = await this.dir(parts, false);
      if (!d) return this.mem.get(path) ?? null;
      return await (await d.getFileHandle(name)).getFile();
    } catch {
      return null;
    }
  }
  async remove(path: string) {
    for (const k of this.mem.keys()) if (k === path || k.startsWith(path + '/')) this.mem.delete(k);
    try {
      const parts = path.split('/');
      const name = parts.pop()!;
      const d = await this.dir(parts, false);
      await d?.removeEntry(name, { recursive: true });
    } catch {
      /* already gone */
    }
  }
  async list(path: string): Promise<string[]> {
    try {
      const d = await this.dir(path.split('/'), false);
      if (!d) {
        const out = new Set<string>();
        for (const k of this.mem.keys()) if (k.startsWith(path + '/')) out.add(k.slice(path.length + 1).split('/')[0]);
        return [...out];
      }
      const out: string[] = [];
      for await (const k of (d as unknown as { keys(): AsyncIterable<string> }).keys()) out.push(k);
      return out;
    } catch {
      return [];
    }
  }
}

export class Library {
  private disk = new Disk();
  custom: TrackMeta[] = [];
  recordings: TrackMeta[] = [];
  readonly demo: TrackMeta[] = DEMOS.map((d) => ({
    id: d.id,
    album: 'demo',
    title: d.title,
    bpm: d.bpm,
    colours: d.colours,
  }));
  private demoBuffers = new Map<string, Promise<Record<Stem, Float32Array>>>();

  constructor(private ctx: BaseAudioContext) {}

  async init() {
    this.custom = await this.loadMetas('custom');
    this.recordings = await this.loadMetas('recordings');
    this.recordings.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
  }

  persistent() {
    return this.disk.persistent;
  }

  private async loadMetas(album: Album): Promise<TrackMeta[]> {
    const ids = await this.disk.list(album);
    const out: TrackMeta[] = [];
    for (const id of ids) {
      const b = await this.disk.read(`${album}/${id}/meta.json`);
      if (b) out.push(JSON.parse(await b.text()));
    }
    return out;
  }

  tracks(album: Album): TrackMeta[] {
    return this[album];
  }

  private newId() {
    return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  async saveMeta(m: TrackMeta) {
    await this.disk.write(`${m.album}/${m.id}/meta.json`, new Blob([JSON.stringify(m)], { type: 'application/json' }));
  }

  /** Adds a track from stem buffers: from a separation, or from decoded stem files. */
  async addFromChannels(title: string, stems: Record<Stem, Float32Array[]>, sr: number, info: Partial<TrackMeta> = {}) {
    const id = this.newId();
    for (const s of STEMS) await this.disk.write(`custom/${id}/${s}.wav`, encodeWav(stems[s], sr));
    const bpm = info.bpm ?? estimateBpm(stems.drums[0], sr);
    const m: TrackMeta = {
      id,
      album: 'custom',
      title,
      colours: info.colours ?? PALETTES[this.custom.length % PALETTES.length],
      gainDb: info.gainDb,
      bpm,
    };
    await this.saveMeta(m);
    this.custom.push(m);
    return m;
  }

  /** Stored as the files arrive, so the originals keep their exact bytes. */
  async addFromFiles(title: string, files: Record<Stem, File>, info: Partial<TrackMeta> = {}) {
    const id = this.newId();
    const decoded = await this.ctx.decodeAudioData(await files.drums.arrayBuffer());
    for (const s of STEMS) await this.disk.write(`custom/${id}/${s}.bin`, files[s]);
    const m: TrackMeta = {
      id,
      album: 'custom',
      title,
      colours: info.colours ?? PALETTES[this.custom.length % PALETTES.length],
      gainDb: info.gainDb,
      bpm: info.bpm ?? estimateBpm(decoded.getChannelData(0), decoded.sampleRate),
    };
    await this.saveMeta(m);
    this.custom.push(m);
    return m;
  }

  async remove(m: TrackMeta) {
    await this.disk.remove(`${m.album}/${m.id}`);
    const list = this[m.album];
    const i = list.findIndex((x) => x.id === m.id);
    if (i >= 0) list.splice(i, 1);
  }

  /** Keeps the newest slots, as the device does. */
  async addRecording(blob: Blob, seconds: number, slots: number) {
    const id = this.newId();
    const n = this.recordings.length + 1;
    const m: TrackMeta = {
      id,
      album: 'recordings',
      title: `Recording ${n}`,
      bpm: 120,
      colours: [
        [1, 0.12, 0.08],
        [1, 0.45, 0.2],
      ],
      seconds,
      created: Date.now(),
      mime: blob.type,
    };
    await this.disk.write(`recordings/${id}/audio.bin`, blob);
    await this.saveMeta(m);
    this.recordings.push(m);
    while (this.recordings.length > slots) await this.remove(this.recordings[0]);
    return m;
  }

  recordingBlob(m: TrackMeta) {
    return this.disk.read(`recordings/${m.id}/audio.bin`);
  }

  private demoStems(spec: DemoSpec) {
    let p = this.demoBuffers.get(spec.id);
    if (!p) {
      p = new Promise((resolve, reject) => {
        const w = new Worker(new URL('./demo.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e) => {
          resolve(e.data);
          w.terminate();
        };
        w.onerror = (e) => reject(new Error(e.message));
        w.postMessage({ spec, sr: this.ctx.sampleRate });
      });
      this.demoBuffers.set(spec.id, p);
    }
    return p;
  }

  private silence(len: number) {
    return this.ctx.createBuffer(1, Math.max(1, len), this.ctx.sampleRate);
  }

  /** Decodes a track's stems, ready for the engine. */
  async load(m: TrackMeta): Promise<LoadedTrack> {
    const stems = {} as StemBuffers;
    if (m.album === 'demo') {
      const spec = DEMOS.find((d) => d.id === m.id)!;
      const data = await this.demoStems(spec);
      for (const s of STEMS) {
        const b = this.ctx.createBuffer(1, data[s].length, this.ctx.sampleRate);
        b.copyToChannel(data[s] as Float32Array<ArrayBuffer>, 0);
        stems[s] = b;
      }
    } else if (m.album === 'recordings') {
      const blob = await this.recordingBlob(m);
      if (!blob) throw new Error('Recording is missing');
      const b = await this.ctx.decodeAudioData(await blob.arrayBuffer());
      const empty = this.silence(b.length);
      stems.other = b;
      stems.vocals = stems.drums = stems.bass = empty;
    } else {
      await Promise.all(
        STEMS.map(async (s) => {
          const blob =
            (await this.disk.read(`custom/${m.id}/${s}.wav`)) ?? (await this.disk.read(`custom/${m.id}/${s}.bin`));
          if (!blob) throw new Error(`Missing ${s} for ${m.title}`);
          stems[s] = await this.ctx.decodeAudioData(await blob.arrayBuffer());
        }),
      );
      // Stems of unequal length still have to start and end together.
      const len = Math.max(...STEMS.map((s) => stems[s].length));
      for (const s of STEMS) {
        if (stems[s].length < len) {
          const pad = this.ctx.createBuffer(stems[s].numberOfChannels, len, stems[s].sampleRate);
          for (let c = 0; c < pad.numberOfChannels; c++) pad.copyToChannel(stems[s].getChannelData(c), c);
          stems[s] = pad;
        }
      }
    }
    return { id: m.id, bpm: m.bpm, stems };
  }

  /** The final track of the Recordings album: up to four recordings, one per slider. */
  async loadAllRecordings(): Promise<LoadedTrack | null> {
    if (!this.recordings.length) return null;
    const newest = [...this.recordings].reverse();
    const buffers = await Promise.all(
      newest.map(async (m) => {
        const blob = await this.recordingBlob(m);
        return blob ? this.ctx.decodeAudioData(await blob.arrayBuffer()) : null;
      }),
    );
    const len = Math.max(...buffers.map((b) => b?.length ?? 0));
    const fit = (b: AudioBuffer | null | undefined) => {
      const pad = this.ctx.createBuffer(b?.numberOfChannels ?? 1, len, this.ctx.sampleRate);
      if (b) for (let c = 0; c < b.numberOfChannels; c++) pad.copyToChannel(b.getChannelData(c), c);
      return pad;
    };
    const stems = {} as StemBuffers;
    STEMS.forEach((s, i) => (stems[s] = fit(buffers[i])));
    return { id: 'all-recordings', bpm: 120, stems };
  }
}
