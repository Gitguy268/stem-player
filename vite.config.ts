import { defineConfig } from 'vite';

const isolate = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1500, target: 'es2022' },
  server: { headers: isolate },
  preview: { headers: isolate },
  test: { include: ['tests/**/*.test.ts'] },
} as never);
