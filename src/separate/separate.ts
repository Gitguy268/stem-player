import type { Stem } from '../spec/common';
import type { FromWorker } from './demucs.worker';

export const MODEL_MB = 172;
const SR = 44100;

export interface SplitProgress {
  stage: 'download' | 'prepare' | 'split';
  value: number;
  provider?: string;
}

/** Resamples any decodable audio to the 44.1 kHz stereo that the model wants. */
export async function decodeForModel(file: Blob): Promise<{ left: Float32Array; right: Float32Array }> {
  const probe = new OfflineAudioContext(2, 1, SR);
  const decoded = await probe.decodeAudioData(await file.arrayBuffer());
  const off = new OfflineAudioContext(2, Math.ceil(decoded.duration * SR), SR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const r = await off.startRendering();
  return { left: r.getChannelData(0).slice(), right: r.getChannelData(1).slice() };
}

export class Split {
  private worker: Worker | null = null;
  private rejecter: ((e: Error) => void) | null = null;

  /** Runs one separation. `cancel()` abandons it, and the partial work with it. */
  run(input: { left: Float32Array; right: Float32Array }, onProgress: (p: SplitProgress) => void) {
    return new Promise<{ stems: Record<Stem, Float32Array[]>; sampleRate: number; provider: string }>(
      (resolve, reject) => {
        this.rejecter = reject;
        const w = new Worker(new URL('./demucs.worker.ts', import.meta.url), { type: 'module' });
        this.worker = w;
        let provider = 'wasm';
        w.onmessage = (e: MessageEvent<FromWorker>) => {
          const m = e.data;
          if (m.t === 'provider') provider = m.name;
          else if (m.t === 'download')
            onProgress({ stage: 'download', value: m.total ? m.loaded / m.total : 0, provider });
          else if (m.t === 'prepare') onProgress({ stage: 'prepare', value: 0, provider });
          else if (m.t === 'ready') onProgress({ stage: 'split', value: 0, provider });
          else if (m.t === 'progress') onProgress({ stage: 'split', value: m.value, provider });
          else if (m.t === 'error') {
            w.terminate();
            reject(new Error(m.message));
          } else if (m.t === 'done') {
            w.terminate();
            const pair = (k: string) => [m.result[k].left, m.result[k].right];
            resolve({
              stems: { vocals: pair('vocals'), other: pair('other'), drums: pair('drums'), bass: pair('bass') },
              sampleRate: SR,
              provider,
            });
          }
        };
        w.onerror = (e) => {
          w.terminate();
          reject(new Error(e.message));
        };
        w.postMessage(input, [input.left.buffer, input.right.buffer]);
      },
    );
  }

  cancel() {
    this.worker?.terminate();
    this.rejecter?.(new Error('Cancelled'));
  }
}
