// Real separation through the page: downloads the model on the first run (about 180 MB),
// then repeats with Hugging Face blocked to prove the cached copy is used.
// The browser profile lives in PROFILE (a temp folder by default) and is deleted afterwards.
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE, serve } from './lib.mjs';

const profile = mkdtempSync(join(process.env.PROFILE ?? tmpdir(), 'stem-demucs-'));
const server = await serve();
const ctx = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: { width: 1000, height: 800 },
  // NO_GPU=1 tests the processor fallback instead.
  args: process.env.NO_GPU
    ? ['--disable-gpu', '--disable-audio-output', '--disk-cache-size=1']
    : [
        '--use-angle=metal',
        '--enable-gpu',
        '--ignore-gpu-blocklist',
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,WebGPU',
        '--disable-audio-output',
        '--disk-cache-size=1',
      ],
});
let failed = false;
try {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}?debug&look=tan`);
  await page.waitForFunction(() => window.__sp?.player?.track, null, { timeout: 60000 });
  const watch = setInterval(async () => {
    const t = await page.textContent('#split-text').catch(() => '');
    console.log(`  [${new Date().toISOString().slice(11, 19)}] ${t}`);
  }, 30000);
  page.once('close', () => clearInterval(watch));

  // A 12 s mix of the demo's known stems, as an ordinary single file.
  const wavB64 = await page.evaluate(async () => {
    const a = window.__sp;
    const t = a.player.track;
    const sr = a.ctx.sampleRate;
    const n = 12 * sr;
    const mixed = new Float32Array(n);
    window.__truth = {};
    for (const s of ['vocals', 'other', 'drums', 'bass']) {
      const d = t.stems[s].getChannelData(0).subarray(0, n);
      window.__truth[s] = d.slice();
      for (let i = 0; i < n; i++) mixed[i] += d[i] * 0.6;
    }
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    w(8, 'WAVEfmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, mixed[i])) * 32767, true);
    let bin = '';
    const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode(...u.subarray(i, i + 32768));
    return btoa(bin);
  });
  const file = { name: 'Mix Test.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavB64, 'base64') };

  const score = () =>
    page.evaluate(async () => {
      const a = window.__sp;
      const m = a.lib.custom.at(-1);
      const t = await a.lib.load(m);
      const names = ['vocals', 'other', 'drums', 'bass'];
      const corr = (x, y) => {
        const n = Math.min(x.length, y.length);
        let xy = 0,
          xx = 0,
          yy = 0;
        for (let i = 0; i < n; i++) {
          xy += x[i] * y[i];
          xx += x[i] * x[i];
          yy += y[i] * y[i];
        }
        return xy / Math.sqrt(xx * yy || 1);
      };
      const out = {};
      for (const s of names) {
        const d = t.stems[s].getChannelData(0);
        out[s] = Object.fromEntries(names.map((k) => [k, +corr(d, window.__truth[k]).toFixed(2)]));
      }
      return { title: m.title, bpm: m.bpm, secs: t.stems.vocals.duration, table: out };
    });

  await page.click('#open-manage');
  await page.setInputFiles('#file-input', [file]);
  await page.waitForSelector('#split-go:not([hidden])', { timeout: 15000 });
  console.log('asks first:', (await page.textContent('#split-text')).slice(0, 80));
  let start = Date.now();
  await page.click('#split-go');
  await page.waitForFunction(
    () => /Splitting|Could not/.test(document.getElementById('split-text').textContent),
    null,
    {
      timeout: 1500000,
    },
  );
  console.log(`download and load: ${((Date.now() - start) / 1000).toFixed(0)} s`);
  console.log('status:', await page.textContent('#split-text'));
  if (process.env.NO_GPU && !/processor/.test(await page.textContent('#split-text'))) {
    throw new Error('NO_GPU run still used the graphics card, so it tested nothing');
  }
  start = Date.now();
  await page.waitForFunction(() => window.__sp.lib.custom.some((m) => m.title === 'Mix Test'), null, {
    timeout: 1500000,
  });
  console.log(`split 12 s of audio: ${((Date.now() - start) / 1000).toFixed(0)} s`);
  const first = await score();
  console.log(JSON.stringify(first));
  for (const s of Object.keys(first.table)) {
    const own = first.table[s][s];
    const others = Object.entries(first.table[s])
      .filter(([k]) => k !== s)
      .map(([, v]) => Math.abs(v));
    if (own < 0.5 || own <= Math.max(...others)) {
      failed = true;
      console.log(`FAIL ${s}: ${own} against own stem`);
    } else console.log(`ok   ${s} output matches its true stem (${own})`);
  }

  if (!process.env.NO_GPU) {
    // Again, offline for the model.
    await ctx.route('**/huggingface.co/**', (r) => r.abort());
    await ctx.route('**/*.hf.co/**', (r) => r.abort());
    await page.evaluate(() => document.getElementById('split').setAttribute('hidden', ''));
    await page.setInputFiles('#file-input', [{ ...file, name: 'Second Run.wav' }]);
    start = Date.now();
    await page.waitForFunction(() => window.__sp.lib.custom.some((m) => m.title === 'Second Run'), null, {
      timeout: 1500000,
    });
    console.log(
      `ok   second split with Hugging Face blocked: ${((Date.now() - start) / 1000).toFixed(0)} s, no prompt`,
    );
  }
  if (errs.length) {
    failed = true;
    console.log('page errors:', errs.join(' | '));
  }
} catch (e) {
  failed = true;
  console.log('FAIL', e.message.split('\n')[0]);
} finally {
  await ctx.close();
  server.kill();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
