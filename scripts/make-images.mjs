// Regenerates docs/images from the real app. Needs a build, and ffmpeg with libwebp.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, openApp, serve } from './lib.mjs';

const OUT = resolve(import.meta.dirname, '../docs/images');
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
const server = await serve();
const browser = await launch();
const work = mkdtempSync(join(process.env.PROFILE ?? tmpdir(), 'stem-images-'));

async function still(look, view, name, setup = '') {
  const { page, ctx } = await openApp(browser, `debug&look=${look}`, { width: 1200, height: 900 });
  await page.evaluate(
    ({ view, setup }) => {
      const a = window.__sp;
      const v2 = a.kind === 'v2';
      a.stage.view({ buttons: v2 ? 135 : 50, ports: v2 ? 225 : 228 }[view] ?? view, true);
      a.player.setVolume(0);
      eval(setup);
    },
    { view, setup },
  );
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: '.top, .bottom, #caption { display: none !important; }' });
  const png = join(work, `${name}.png`);
  await page.screenshot({ path: png });
  await ctx.close();
  return png;
}

const warm =
  'const leds = a.controller.lights(0).leds.map(() => [1, 0.9, 0.75]); a.controller.lights = () => ({ leds });';
const shots = [
  await still('tan', 'front', 'tan'),
  await still('bao', 'front', 'bao', warm),
  await still('clear', 'front', 'clear', warm),
  await still('v2', 'front', 'speaker'),
];
const crop = 'crop=900:820:150:40,scale=600:-1';
ff(
  ...shots.flatMap((s) => ['-i', s]),
  '-filter_complex',
  `[0]${crop}[a];[1]${crop}[b];[2]${crop}[c];[3]${crop}[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0`,
  '-c:v',
  'libwebp',
  '-quality',
  '82',
  join(OUT, 'devices.webp'),
);
const edges = [
  await still('tan', 'buttons', 'tan-edge'),
  await still('tan', 'ports', 'tan-ports'),
  await still('v2', 'ports', 'speaker-ports'),
];
ff(
  ...edges.flatMap((s) => ['-i', s]),
  '-filter_complex',
  `[0]${crop}[a];[1]${crop}[b];[2]${crop}[c];[a][b][c]hstack=3`,
  '-c:v',
  'libwebp',
  '-quality',
  '82',
  join(OUT, 'edges.webp'),
);

/** Steps are [seconds, caption-free action]; frames are captured between them. */
async function demo(look, name, steps, seconds) {
  const { page, ctx } = await openApp(browser, `debug&look=${look}`, { width: 720, height: 600 });
  await page.evaluate(() => {
    window.__sp.player.setVolume(0);
    window.__sp.volume = 0;
  });
  if (look === 'v2') await page.waitForFunction(() => window.__sp.player.partner, null, { timeout: 60000 });
  const start = Date.now();
  let i = 0;
  let frame = 0;
  const dir = mkdtempSync(join(work, name));
  const queue = [...steps];
  while ((Date.now() - start) / 1000 < seconds) {
    while (queue.length && queue[0][0] <= (Date.now() - start) / 1000) await page.evaluate(queue.shift()[1]);
    await page.screenshot({ path: join(dir, `${String(frame++).padStart(4, '0')}.png`) });
    i++;
  }
  const fps = (i / seconds).toFixed(2);
  ff(
    '-framerate',
    fps,
    '-i',
    join(dir, '%04d.png'),
    '-vf',
    'scale=480:-1',
    '-c:v',
    'libwebp_anim',
    '-quality',
    '62',
    '-loop',
    '0',
    join(OUT, `${name}.webp`),
  );
  console.log(`${name}: ${i} frames at ${fps} fps`);
  await ctx.close();
}

const tap = (id) =>
  `(() => { const a = window.__sp, t = performance.now(); a.controller.down('${id}', t); a.controller.up('${id}', t + 40); })()`;
const slide = (arm, pos) => `(() => { const a = window.__sp; a.v1.slide('${arm}', 7, ${pos}, performance.now()); })()`;
const end = (arm) => `window.__sp.v1.slideEnd('${arm}', 7)`;
await demo(
  'tan',
  'handheld',
  [
    [0.2, tap('centre')],
    [1.8, slide('top', 0.2)],
    [2.1, end('top')],
    [2.6, slide('top', 0.99)],
    [3.5, end('top')],
    [4.0, slide('bottom', 0.99)],
    [5.0, end('bottom')],
    [5.4, tap('power')],
    [6.0, slide('right', 0.9)],
    [6.3, end('right')],
    [6.8, slide('top', 0.3)],
    [7.1, end('top')],
    [8.2, tap('centre')],
    [8.8, tap('centre')],
    [9.3, 'window.__sp.stage.view(50)'],
    [10.8, 'window.__sp.stage.view("front")'],
  ],
  12,
);
await demo(
  'v2',
  'speaker',
  [
    [0.2, tap('centre')],
    [1.5, tap('top')],
    [2.5, tap('bottom')],
    [3.5, tap('top')],
    [4.2, tap('bottom')],
    [5.0, tap('power')],
    [5.8, tap('left')],
    [7.0, tap('left')],
    [7.5, tap('power')],
    [8.3, tap('power')],
    [8.9, 'window.__sp.stage.view(225)'],
    [10.5, 'window.__sp.stage.view("front")'],
  ],
  12,
);

await browser.close();
server.kill();
rmSync(work, { recursive: true, force: true });
