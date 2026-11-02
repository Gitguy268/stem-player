// Shared by the browser checks: a real-GPU Chromium, plus the local server.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export const PORT = Number(process.env.PORT ?? 8793);
export const BASE = `http://localhost:${PORT}/`;

export async function launch(extra = []) {
  return chromium.launch({
    headless: true,
    args: [
      '--use-angle=metal',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,WebGPU',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-audio-output',
      ...extra,
    ],
  });
}

export async function serve() {
  const p = spawn('node', [resolve(import.meta.dirname, 'serve.mjs')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe',
  });
  await new Promise((r, j) => {
    p.stdout.once('data', r);
    p.once('exit', () => j(new Error('server exited')));
  });
  return p;
}

export async function openApp(browser, query = 'debug', viewport = { width: 1200, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  await page.goto(`${BASE}?${query}`);
  await page.waitForFunction(() => window.__sp?.player?.track, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  return { page, ctx, problems };
}
