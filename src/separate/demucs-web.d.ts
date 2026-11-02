declare module 'demucs-web' {
  export const CONSTANTS: { SAMPLE_RATE: number; DEFAULT_MODEL_URL: string };
  export class DemucsProcessor {
    constructor(options: {
      ort: unknown;
      sessionOptions?: Record<string, unknown>;
      onProgress?: (p: { progress: number } | number) => void;
    });
    loadModel(source: ArrayBuffer | string): Promise<unknown>;
    separate(
      left: Float32Array,
      right: Float32Array,
    ): Promise<Record<string, { left: Float32Array; right: Float32Array }>>;
  }
}
