// Measures the rendered face against the real product posters: silhouette and LED positions.
// Posters live in the gitignored docs/reference/img. Run after `npm run build`.
import { existsSync, readFileSync } from 'node:fs';
import { launch, openApp, serve } from './lib.mjs';

const REF = new URL('../docs/reference/', import.meta.url).pathname;
const CASES = [
  { look: 'tan', poster: 'img/tan_poster.webp', arms: 4 },
  { look: 'clear', poster: 'img/clear_poster.webp', arms: 4 },
  { look: 'bao', poster: 'img/bao_poster.webp', arms: 4 },
  { look: 'v2', poster: 'frames/v2-front.png', arms: 1 },
];
const TOLERANCE = 0.02;

/** Runs in the page: outline, and LED blobs as the brightest spots along each axis. */
const measure = async ({ url }) => {
  let w, h, data;
  if (url) {
    const img = new Image();
    img.src = url;
    await img.decode();
    w = img.naturalWidth;
    h = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    data = x.getImageData(0, 0, w, h).data;
  } else {
    const src = document.getElementById('stage');
    window.__sp.stage.render(0);
    w = src.width;
    h = src.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    data = x.getImageData(0, 0, w, h).data;
  }
  const px = (X, Y) => {
    const i = (Math.round(Y) * w + Math.round(X)) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  const bg = px(4, 4);
  const far = (X, Y) => {
    const p = px(X, Y);
    return Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 24;
  };
  // Outline from the middle rows and columns. Controls near the screen edge are skipped.
  const span = (fixed, len, horizontal) => {
    let a = -1,
      b = -1;
    for (let i = 0; i < len; i++) {
      if (horizontal ? far(i, fixed) : far(fixed, i)) {
        if (a < 0) a = i;
        b = i;
      }
    }
    return [a, b];
  };
  const [l, r] = span(h >> 1, w, true);
  const [t, b] = span(w >> 1, h, false);
  const cx = (l + r) / 2,
    cy = (t + b) / 2,
    R = Math.max(r - l, b - t) / 2;
  const leds = [];
  const sample = (fx, fy) => {
    // Brightness along a ray out from the centre. Local peaks are LEDs.
    const line = [];
    for (let i = 0; i <= 200; i++) {
      const q = i / 200;
      let sum = 0;
      for (let o = -1; o <= 1; o++) sum += lum(px(cx + fx * q * R + fy * o * 2, cy - fy * q * R + fx * o * 2));
      line.push(sum / 3);
    }
    const mean = line.reduce((s, v) => s + v, 0) / line.length;
    const peaks = [];
    for (let i = 20; i < 195; i++) {
      if (line[i] > mean * 1.05 && line[i] >= Math.max(...line.slice(i - 8, i + 9))) {
        peaks.push(i / 200);
        i += 8;
      }
    }
    return peaks;
  };
  for (const [fx, fy] of [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ])
    leds.push(sample(fx, fy));
  const patch = px(cx + R * 0.45, cy + R * 0.45);
  return { cx: cx / w, cy: cy / h, aspect: (r - l) / (b - t), R: R / Math.min(w, h), leds, patch };
};

const s = await serve();
const b = await launch();
let failed = 0;
for (const c of CASES) {
  const path = REF + c.poster;
  if (!existsSync(path)) {
    console.log(`skip ${c.look}: no ${c.poster}`);
    continue;
  }
  const { page, ctx } = await openApp(b, `debug&look=${c.look}&view=flat`, { width: 900, height: 900 });
  await page.evaluate(() => {
    const a = window.__sp;
    a.stage.view('flat', true);
    a.stage.shadow.visible = false;
    // The posters are shot with a very long lens.
    a.stage.camera.fov = 2.5;
    a.stage.camera.far = 200;
    a.stage.resize();
    // A plain lit face to compare with the poster's.
    const leds = a.controller.lights(0).leds.map(() => [1, 0.9, 0.75]);
    a.controller.lights = () => ({ leds });
  });
  await page.waitForTimeout(400);
  const mime = c.poster.endsWith('png') ? 'image/png' : 'image/webp';
  const url = `data:${mime};base64,${readFileSync(path).toString('base64')}`;
  const real = await page.evaluate(measure, { url });
  const mine = await page.evaluate(measure, {});
  const leds = real.leds.flatMap((peaks, i) =>
    peaks.filter((p) => p < 0.85).map((p) => Math.min(...mine.leds[i].map((q) => Math.abs(p - q)), 9)),
  );
  const worst = leds.length ? Math.max(...leds) : NaN;
  const aspect = Math.abs(real.aspect - mine.aspect);
  const ok = worst <= TOLERANCE * 2 && aspect <= 0.04;
  if (!ok) failed++;
  // Positions are compared over the radius: 2 % of the diameter is 4 % of it.
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${c.look}: ${leds.length} poster LEDs, worst ${(worst * 50).toFixed(1)} % of diameter; aspect ${real.aspect.toFixed(3)} vs ${mine.aspect.toFixed(3)}; face rgb ${real.patch} vs ${mine.patch}`,
  );
  if (process.env.VERBOSE) console.log(JSON.stringify({ real: real.leds, mine: mine.leds }));
  await ctx.close();
}
await b.close();
s.kill();
process.exit(failed ? 1 : 0);
