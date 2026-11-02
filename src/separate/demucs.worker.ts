import * as ort from 'onnxruntime-web';
import { DemucsProcessor, CONSTANTS } from 'demucs-web';
import wasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import mjsUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url';

export type ToWorker = { left: Float32Array; right: Float32Array };
export type FromWorker =
  | { t: 'download'; loaded: number; total: number }
  | { t: 'cached' }
  | { t: 'prepare' }
  | { t: 'ready' }
  | { t: 'provider'; name: string }
  | { t: 'progress'; value: number }
  | { t: 'done'; result: Record<string, { left: Float32Array; right: Float32Array }> }
  | { t: 'error'; message: string };

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

const MODEL_NAME = 'htdemucs_embedded.onnx';

/** The model is saved once in private browser storage. */
async function modelBuffer(): Promise<ArrayBuffer> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('models', { create: true });
  try {
    const f = await (await dir.getFileHandle(MODEL_NAME)).getFile();
    if (f.size > 100e6) {
      post({ t: 'cached' });
      return await f.arrayBuffer();
    }
  } catch {
    /* not there yet */
  }
  const res = await fetch(CONSTANTS.DEFAULT_MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`Model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    post({ t: 'download', loaded, total });
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  try {
    const h = await dir.getFileHandle(MODEL_NAME, { create: true });
    const w = await h.createWritable();
    await w.write(out);
    await w.close();
  } catch (e) {
    console.warn('Model could not be cached', e);
  }
  return out.buffer;
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  try {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
    // Threads need cross-origin isolation. WebGPU does not, so this only slows the fallback.
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
    const hasGpu =
      !!(navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu &&
      !!(await (navigator as never as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter());
    const provider = hasGpu ? 'webgpu' : 'wasm';
    post({ t: 'provider', name: provider });
    const proc = new DemucsProcessor({
      ort,
      sessionOptions: { executionProviders: hasGpu ? ['webgpu', 'wasm'] : ['wasm'] },
      onProgress: (p: { progress: number } | number) =>
        post({ t: 'progress', value: typeof p === 'number' ? p : p.progress }),
    });
    const buffer = await modelBuffer();
    post({ t: 'prepare' });
    await proc.loadModel(buffer);
    post({ t: 'ready' });
    const result = await proc.separate(e.data.left, e.data.right);
    const transfer: Transferable[] = [];
    for (const k of Object.keys(result)) transfer.push(result[k].left.buffer, result[k].right.buffer);
    post({ t: 'done', result }, transfer);
  } catch (err) {
    post({ t: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
