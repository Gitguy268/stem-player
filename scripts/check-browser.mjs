// End to end in real browsers: canvas pointer and touch input, measured audio, library, launch.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { firefox, webkit } from 'playwright';
import { BASE, launch, openApp, serve } from './lib.mjs';

let pass = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else failures.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
};

/** Offline render through the real engine, returning measurements. */
const audioSuite = async () => {
  const Player = window.__sp.player.constructor;
  const SR = 44100;
  const STEMS = ['vocals', 'other', 'drums', 'bass'];
  const tone = (ctx, f, secs, amp = 0.5) => {
    const b = ctx.createBuffer(1, secs * SR, SR);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin((2 * Math.PI * f * i) / SR);
    return b;
  };
  const power = (d, f, from = 0, to = d.length) => {
    let re = 0,
      im = 0;
    for (let i = from; i < to; i++) {
      re += d[i] * Math.cos((2 * Math.PI * f * i) / SR);
      im += d[i] * Math.sin((2 * Math.PI * f * i) / SR);
    }
    return (2 * Math.hypot(re, im)) / (to - from);
  };
  const rms = (d, from = 0, to = d.length) => {
    let s = 0;
    for (let i = from; i < to; i++) s += d[i] * d[i];
    return Math.sqrt(s / (to - from));
  };
  const make = (secs, build) => {
    const ctx = new OfflineAudioContext(2, secs * SR, SR);
    const p = new Player(ctx);
    p.setVolume(1);
    p.master.gain.value = 1;
    build(ctx, p);
    return ctx.startRendering().then((r) => ({ L: r.getChannelData(0), R: r.getChannelData(1), p }));
  };
  const out = {};
  const freqs = { vocals: 440, other: 660, drums: 990, bass: 1320 };

  // Isolation really silences the others, with the ramp finished.
  {
    const r = await make(1, (ctx, p) => {
      const stems = Object.fromEntries(STEMS.map((s) => [s, tone(ctx, freqs[s], 2)]));
      p.load({ id: 'a', bpm: 120, stems });
      p.setStemGains({ vocals: 0, other: 0, drums: 1, bass: 0 }, 50);
      p.play();
    });
    const from = 0.2 * SR;
    out.isolate = Object.fromEntries(STEMS.map((s) => [s, power(r.L, freqs[s], from, SR)]));
  }

  // Stems stay sample-locked across loop wraps: opposite phases cancel to nothing.
  {
    const mk = (ctx, sign) => {
      const b = ctx.createBuffer(1, 4 * SR, SR);
      const d = b.getChannelData(0);
      let seed = 7;
      for (let i = 0; i < d.length; i++) {
        seed = (seed * 16807) % 2147483647;
        d[i] = sign * (seed / 2147483647 - 0.5);
      }
      return b;
    };
    const r = await make(3, (ctx, p) => {
      const stems = { vocals: mk(ctx, 1), other: mk(ctx, -1), drums: mk(ctx, 1), bass: mk(ctx, -1) };
      p.load({ id: 'a', bpm: 120, stems });
      p.play();
      p.setLoop(1);
    });
    out.syncResidual = rms(r.L, 0.1 * SR, 3 * SR);
  }

  // Loop length: a click at the start of the bar comes back on time.
  {
    const r = await make(3, (ctx, p) => {
      const mkb = (click) => {
        const b = ctx.createBuffer(1, 4 * SR, SR);
        if (click) b.getChannelData(0)[100] = 1;
        return b;
      };
      p.load({
        id: 'a',
        bpm: 120,
        stems: { vocals: mkb(true), other: mkb(false), drums: mkb(false), bass: mkb(false) },
      });
      p.play();
      p.setLoop(2);
    });
    const hits = [];
    for (let i = 0; i < r.L.length; i++) if (Math.abs(r.L[i]) > 0.5) hits.push(i);
    out.loopGaps = hits.slice(1).map((h, i) => (h - hits[i]) / SR);
  }

  // 125 %: a click at 2.0 s of track time arrives at 1.6 s, plus the start offset.
  {
    const r = await make(3, (ctx, p) => {
      const mkb = (click) => {
        const b = ctx.createBuffer(1, 4 * SR, SR);
        if (click) b.getChannelData(0)[2 * SR] = 1;
        return b;
      };
      p.load({
        id: 'a',
        bpm: 120,
        stems: { vocals: mkb(true), other: mkb(false), drums: mkb(false), bass: mkb(false) },
      });
      p.setRate(1.25);
      p.play();
    });
    let at = -1,
      peak = 0;
    for (let i = 0; i < r.L.length; i++)
      if (Math.abs(r.L[i]) > peak) {
        peak = Math.abs(r.L[i]);
        at = i;
      }
    out.fastClick = at / SR;
  }

  // Reverse: a rising ramp plays back falling, from the current position.
  {
    const r = await make(1, (ctx, p) => {
      const b = ctx.createBuffer(1, 4 * SR, SR);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = i / d.length;
      const zero = ctx.createBuffer(1, 4 * SR, SR);
      p.load({ id: 'a', bpm: 120, stems: { vocals: b, other: zero, drums: zero, bass: zero } }, 2);
      p.setRate(-1);
      p.play();
    });
    out.reverse = [r.L[0.1 * SR], r.L[0.5 * SR], r.L[0.9 * SR]];
  }

  // Pitch: one octave up moves a 440 tone to 880 with no change of length.
  {
    const ctx = new OfflineAudioContext(2, 2 * SR, SR);
    const p = new Player(ctx);
    await p.init();
    p.master.gain.value = 1;
    const zero = ctx.createBuffer(1, 4 * SR, SR);
    p.load({ id: 'a', bpm: 120, stems: { vocals: tone(ctx, 440, 4), other: zero, drums: zero, bass: zero } });
    p.setPitch(12);
    p.play();
    const r = await ctx.startRendering();
    const d = r.getChannelData(0);
    // Short windows, because grains are not phase-coherent with each other.
    let at440 = 0,
      at880 = 0,
      n = 0;
    for (let f = 0.5 * SR; f + 1024 < 2 * SR; f += 1024) {
      at440 += power(d, 440, f, f + 1024);
      at880 += power(d, 880, f, f + 1024);
      n++;
    }
    out.pitch = { at440: at440 / n, at880: at880 / n, rms: rms(d, 0.5 * SR, 2 * SR) };
  }

  // Each effect changes the signal at full, and is gone at zero.
  {
    const noise = (ctx) => {
      const b = ctx.createBuffer(1, 3 * SR, SR);
      const d = b.getChannelData(0);
      let seed = 3;
      for (let i = 0; i < d.length; i++) {
        seed = (seed * 16807) % 2147483647;
        d[i] = (seed / 2147483647 - 0.5) * 0.6;
      }
      return b;
    };
    const dry = await make(1, (ctx, p) => {
      const n = noise(ctx);
      const z = ctx.createBuffer(1, 3 * SR, SR);
      p.load({ id: 'a', bpm: 120, stems: { vocals: n, other: z, drums: z, bass: z } });
      p.play();
    });
    out.effects = [];
    for (let e = 0; e < 8; e++) {
      const wet = await make(1, (ctx, p) => {
        const n = noise(ctx);
        const z = ctx.createBuffer(1, 3 * SR, SR);
        p.load({ id: 'a', bpm: 120, stems: { vocals: n, other: z, drums: z, bass: z } });
        p.setEffect(e, 1);
        p.play();
      });
      let diff = 0;
      for (let i = 0.4 * SR; i < SR; i++) diff += Math.abs(wet.L[i] - dry.L[i]);
      out.effects.push(diff / (0.6 * SR));
    }
  }

  return out;
};

const server = await serve();
const browser = await launch();
const { page, ctx, problems } = await openApp(browser, 'debug&look=tan&view=flat');

// Audio.
const A = await page.evaluate(audioSuite);
check(
  'isolation leaves only the chosen stem',
  A.isolate.drums > 0.4 && A.isolate.vocals < 1e-3 && A.isolate.bass < 1e-3 && A.isolate.other < 1e-3,
  JSON.stringify(A.isolate),
);
check(
  'four stems stay sample-locked through loop wraps',
  A.syncResidual < 1e-5,
  `residual ${A.syncResidual.toExponential(1)}`,
);
check(
  'a 2 beat loop repeats every 1 s at 120 BPM',
  A.loopGaps.length >= 2 && A.loopGaps.every((g) => Math.abs(g - 1) < 1e-3),
  A.loopGaps.join(', '),
);
check('125 % speed brings a 2 s click at 1.6 s', Math.abs(A.fastClick - 1.62) < 0.003, `${A.fastClick.toFixed(4)} s`);
check(
  'reverse plays a rising ramp falling',
  A.reverse[0] > A.reverse[1] && A.reverse[1] > A.reverse[2] && A.reverse[0] < 0.5,
  A.reverse.map((v) => v.toFixed(3)).join(' > '),
);
check(
  'pitch +12 moves the tone an octave, at about the same level',
  A.pitch.at880 > A.pitch.at440 * 3 && A.pitch.rms > 0.2,
  JSON.stringify(A.pitch),
);
check(
  'all 8 effects audibly change the signal',
  A.effects.every((d) => d > 0.005),
  A.effects.map((d) => d.toFixed(3)).join(' '),
);

// Pointer helpers on the canvas.
const surface = (x, y) =>
  page.evaluate(
    ([x, y]) => {
      const s = window.__sp.stage.shape;
      return window.__sp.stage.project(x, y, s.zOf(Math.hypot(x, y), true));
    },
    [x, y],
  );
const state = (f) => page.evaluate(f);
const flat = () =>
  page.evaluate(() => {
    window.__sp.stage.view('flat', true);
    window.__sp.stage.render(0);
  });
const wait = (ms) => page.waitForTimeout(ms);
async function press(p, ms = 40) {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await wait(ms);
  await page.mouse.up();
  await wait(40);
}
async function edge(id) {
  return page.evaluate((id) => {
    const a = window.__sp;
    const c = a.stage.shape.controls.find((x) => x.id === id);
    a.stage.view(c.angle, true);
    a.stage.render(0);
    const rad = (c.angle * Math.PI) / 180;
    return a.stage.project(Math.sin(rad) * 0.985, Math.cos(rad) * 0.985, 0);
  }, id);
}
async function tapEdge(id, ms = 40) {
  const p = await edge(id);
  await press(p, ms);
  await flat();
}
/** Holds a control with the right mouse button latch, for two-button moves with one mouse. */
async function latch(id) {
  const p = await edge(id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await flat();
}
const centre = () => surface(0, 0);
const LED = (arm, r) => surface(...{ top: [0, r], right: [r, 0], bottom: [0, -r], left: [-r, 0] }[arm]);

await flat();
const c1 = await centre();
// Handheld.
await press(c1);
check('v1: centre tap plays', await state(() => window.__sp.player.playing));
const t0 = await state(() => window.__sp.player.position);
await wait(500);
const t1 = await state(() => window.__sp.player.position);
check('v1: the clock moves when playing', t1 - t0 > 0.3, `${(t1 - t0).toFixed(2)} s in 0.5 s`);
const lit = await page.evaluate(
  () => window.__sp.v1.lights(performance.now()).leds.filter((l) => l[0] + l[1] + l[2] > 0).length,
);
check('v1: all 16 lights lit at full level', lit === 16, `${lit}`);

const inner = await LED('top', 0.33);
await page.mouse.move(inner.x, inner.y);
await page.mouse.down();
await wait(30);
await page.mouse.up();
check(
  'v1: dragging a groove sets the level',
  (await state(() => window.__sp.v1.levels.top)) === 1,
  `level ${await state(() => window.__sp.v1.levels.top)}`,
);
const outerTop = await LED('top', 0.74);
await press(outerTop, 40);
check('v1: tapping the groove end restores full level', (await state(() => window.__sp.v1.levels.top)) === 4);

// Two real touch points, isolating two stems together.
{
  const cdp = await ctx.newCDPSession(page);
  const a = await LED('top', 0.74);
  const b = await LED('bottom', 0.74);
  const pts = [
    { x: a.x, y: a.y, id: 1 },
    { x: b.x, y: b.y, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
  await wait(450);
  const iso = await state(() => [...window.__sp.v1.isolating]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(60);
  check(
    'v1: two fingers isolate two stems',
    iso.length === 2 && iso.includes('top') && iso.includes('bottom'),
    iso.join('+'),
  );
  check('v1: letting go ends isolation', (await state(() => window.__sp.v1.isolating.size)) === 0);
}

// Instant loop, locked by the power button.
await page.mouse.move(c1.x, c1.y);
await page.mouse.down();
await wait(420);
check(
  'v1: holding centre starts an instant loop',
  await state(() => window.__sp.v1.instant && !!window.__sp.player.loop),
);
await page.keyboard.down('p');
await page.keyboard.up('p');
await page.mouse.up();
await wait(50);
check(
  'v1: power while holding locks it into the loop menu',
  await state(() => window.__sp.v1.menu === 'loop' && !!window.__sp.player.loop),
);

// Loop menu by pointer: speed and bars.
await press(await LED('right', 0.72));
check('v1: outer right is 125 %', (await state(() => window.__sp.player.rate)) === 1.25);
await press(await LED('left', 0.72));
check('v1: left arm plays reverse', (await state(() => window.__sp.player.rate)) === -1.25);
await press(await centre());
check(
  'v1: centre clears speed and loop',
  await state(() => window.__sp.player.rate === 1 && window.__sp.player.loop === null && window.__sp.v1.playing),
);
await tapEdge('power');
check('v1: power tap leaves the loop menu', (await state(() => window.__sp.v1.menu)) === 'main');

await tapEdge('power');
await tapEdge('plus');
check('v1: + in the loop menu opens effects', (await state(() => window.__sp.v1.menu)) === 'effects');
await press(await LED('top', 0.33));
await press(await LED('right', 0.72));
const fx = await state(() => [window.__sp.v1.effectIndex, window.__sp.v1.effects[window.__sp.v1.effectIndex]]);
check('v1: effects pick and amount', fx[0] === 4 && fx[1] === 1, fx.join(','));
await press(await centre());
await page.evaluate(() => (window.__sp.v1.menu = 'main'));

for (const [id, what] of [
  ['plus', 'volume'],
  ['minus', 'volume'],
]) {
  const before = await state(() => window.__sp.volume);
  await tapEdge(id);
  const after = await state(() => window.__sp.volume);
  check(
    `v1: ${id} button changes the ${what}`,
    id === 'plus' ? after > before : after < before,
    `${before} to ${after}`,
  );
}
const tBefore = await state(() => window.__sp.index);
await tapEdge('next');
await wait(50);
check('v1: next changes track', (await state(() => window.__sp.index)) === (tBefore + 1) % 3);
await page.waitForFunction(() => window.__sp.player.track?.id === window.__sp.lib.demo[window.__sp.index].id, null, {
  timeout: 60000,
});
await tapEdge('prev');
await page.waitForFunction(
  (i) => window.__sp.index === i && window.__sp.player.track?.id === window.__sp.lib.demo[i].id,
  tBefore,
  { timeout: 60000 },
);
check('v1: prev returns, still playing', await state(() => window.__sp.player.playing));

// Lock.
await page.keyboard.down('p');
await page.keyboard.down(' ');
await wait(600);
await page.keyboard.up(' ');
await page.keyboard.up('p');
check(
  'v1: power + held centre locks with lights off',
  await state(() => window.__sp.v1.locked && window.__sp.v1.lights(0).leds.every((l) => l[0] + l[1] + l[2] === 0)),
);
await tapEdge('power');
check('v1: power unlocks', !(await state(() => window.__sp.v1.locked)));
if ((await state(() => window.__sp.v1.menu)) !== 'main') await page.evaluate(() => (window.__sp.v1.menu = 'main'));

// Right-click latch: pair with one mouse.
await latch('plus');
await latch('minus');
await wait(1150);
check(
  'v1: + and − held pair, with blue lights',
  await state(() => {
    const l = window.__sp.v1.lights(performance.now()).leds;
    return window.__sp.v1.linked && l.every((x) => x[2] >= x[0]);
  }),
);
await latch('plus');
await latch('minus');
await page.evaluate(() => {
  // Finish the pairing animation so what follows starts clean.
  window.__sp.v1.flash = null;
});

// Record through the real recorder and read it back.
await page.keyboard.down('=');
await wait(1100);
await page.keyboard.up('=');
check(
  'v1: holding + starts a recording, red line',
  await state(
    () =>
      window.__sp.v1.recording &&
      window.__sp.recorder.active &&
      window.__sp.v1.lights(performance.now()).leds[4][0] > 0.9,
  ),
);
await wait(1200);
await page.keyboard.down('=');
await wait(1100);
await page.keyboard.up('=');
await page.waitForFunction(() => window.__sp.lib.recordings.length > 0, null, { timeout: 5000 });
const rec = await page.evaluate(async () => {
  const a = window.__sp;
  const m = a.lib.recordings.at(-1);
  const b = await a.lib.recordingBlob(m);
  const dec = await a.ctx.decodeAudioData(await b.arrayBuffer());
  const d = dec.getChannelData(0);
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  return { size: b.size, secs: dec.duration, rms: Math.sqrt(s / d.length), meta: m.seconds };
});
check('v1: the recording holds real audio', rec.secs > 1 && rec.rms > 0.005, JSON.stringify(rec));

// Album cycle.
await page.keyboard.down('[');
await page.keyboard.down(']');
await wait(800);
await page.keyboard.up('[');
await page.keyboard.up(']');
check('v1: prev + next cycles the album', (await state(() => window.__sp.album)) === 'custom');
await page.keyboard.down('[');
await page.keyboard.down(']');
await wait(800);
await page.keyboard.up('[');
await page.keyboard.up(']');
check('v1: on to Recordings', (await state(() => window.__sp.album)) === 'recordings');
await page.waitForFunction(() => window.__sp.player.track?.id !== undefined, null, { timeout: 30000 });
await page.keyboard.down('[');
await page.keyboard.down(']');
await wait(800);
await page.keyboard.up('[');
await page.keyboard.up(']');
await page.waitForFunction(
  () => window.__sp.album === 'demo' && window.__sp.player.track?.id?.startsWith('demo'),
  null,
  { timeout: 60000 },
);
check('v1: and back to Demo', true);

// Every skin renders from the picker. Then the speaker.
for (const l of ['bao', 'clear', 'v2']) {
  await page.click(`[data-look=${l}]`);
  await wait(200);
  check(`picker switches to ${l}`, (await state(() => window.__sp.stage.look)) === l);
}
await page.waitForFunction(() => window.__sp.player.partner, null, { timeout: 60000 });
check('v2: mix song is loaded', true);
await flat();
await press(await centre());
check('v2: centre plays', await state(() => window.__sp.player.playing));

await press(await LED('top', 0.79));
check('v2: tap swaps a stem', await state(() => window.__sp.v2.swapped.top && window.__sp.player.swapped.vocals));
const c = await page.evaluate(() => {
  const a = window.__sp;
  const l = a.v2.lights(performance.now(), { vocals: 1, other: 1, drums: 1, bass: 1 }).leds;
  return { top: l[1], right: l[2] };
});
check("v2: its light takes the other song's colour", c.top.join() !== c.right.join());
await press(await LED('top', 0.79));
check('v2: tap reverts', await state(() => !window.__sp.v2.swapped.top));

// Isolation with real touches.
{
  const cdp = await ctx.newCDPSession(page);
  const a = await LED('top', 0.79);
  const b = await LED('bottom', 0.79);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: a.x, y: a.y, id: 1 },
      { x: b.x, y: b.y, id: 2 },
    ],
  });
  await wait(450);
  const iso = await state(() => [...window.__sp.v2.isolating]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(60);
  check('v2: holding two points isolates vocals + drums', iso.length === 2, iso.join('+'));
}

// Loop menu.
await tapEdge('power');
check('v2: power opens the loop menu', (await state(() => window.__sp.v2.menu)) === 'loop');
await press(await LED('left', 0.79));
const beat = await state(() => window.__sp.player.beatSeconds);
const lp = await state(() => window.__sp.player.loop);
check('v2: left is a 2 beat loop', lp && Math.abs(lp.end - lp.start - 2 * beat) < 1e-6);
await press(await LED('left', 0.79));
check('v2: tapping again unlocks', (await state(() => window.__sp.player.loop)) === null);

const before = await state(() => window.__sp.player.position);
const bl = await LED('bottom', 0.79);
await page.mouse.move(bl.x, bl.y);
await page.mouse.down();
await wait(1400);
check(
  'v2: holding is a slip loop',
  await state(() => window.__sp.v2.slipPoint === 'bottom' && !!window.__sp.player.loop),
);
await page.mouse.up();
await wait(60);
const after = await state(() => window.__sp.player.position);
check(
  'v2: release lands where the song would have been',
  after - before > 1.3 && after - before < 1.8,
  `moved ${(after - before).toFixed(2)} s over 1.46 s`,
);

// Speed menu.
await tapEdge('power');
check('v2: power opens speed and pitch', (await state(() => window.__sp.v2.menu)) === 'speed');
await press(await LED('right', 0.79));
check('v2: right speeds up', (await state(() => window.__sp.player.rate)) === 1.05);
await press(await LED('top', 0.79));
check('v2: top pitches up', (await state(() => window.__sp.v2.pitch)) === 1);
await press(await centre());
check('v2: centre resets', await state(() => window.__sp.player.rate === 1 && window.__sp.v2.pitch === 0));
await tapEdge('power');
check('v2: power returns to main', (await state(() => window.__sp.v2.menu)) === 'main');

// Each edge button and port hits its own zone.
for (const id of ['plus', 'minus']) {
  const b4 = await state(() => window.__sp.volume);
  await tapEdge(id);
  check(`v2: ${id}`, (await state(() => window.__sp.volume)) !== b4);
}
await tapEdge('bt');
check('v2: Bluetooth tap toggles the link', await state(() => window.__sp.v2.linked));
await tapEdge('fm');
check('v2: FM opens the library', await state(() => document.getElementById('manage').open));
await page.click('#manage .close');
await tapEdge('usb');
check('v2: USB-C starts charging', await state(() => window.__sp.v2.charging));
await tapEdge('usb');
await tapEdge('usb');
{
  const v = await state(() => window.__sp.v2.lights(performance.now()).indicator);
  check('v2: nothing on the indicator when idle', v === undefined);
}

// Minimal mode.
await page.keyboard.down(' ');
await wait(1100);
await page.keyboard.up(' ');
check(
  'v2: holding centre is minimal mode',
  await state(() => {
    const l = window.__sp.v2.lights(performance.now()).leds;
    return window.__sp.v2.minimal && l.slice(1).every((x) => x[0] + x[1] + x[2] === 0);
  }),
);
await page.keyboard.down(' ');
await wait(1100);
await page.keyboard.up(' ');

// Skip transition: moves stems over, then the partner becomes the track.
const idx0 = await state(() => window.__sp.index);
await page.evaluate(() => window.__sp.run({ t: 'track', dir: 1, transition: true }));
await page.waitForFunction((i) => window.__sp.index !== i && !window.__sp.v2.transitioning, idx0, { timeout: 30000 });
check(
  'v2: transition completes onto the next song, still playing',
  await state(() => window.__sp.player.playing && !!window.__sp.player.track),
);
await page.waitForFunction(() => window.__sp.player.partner, null, { timeout: 60000 });
check('v2: and a new mix song is lined up', true);

// Low battery.
await page.evaluate(() => (window.__sp.v2.battery = 0.02));
const b1 = await state(() => window.__sp.v2.lights(250).leds[0]);
check('v2: flashes red on a low battery', b1[0] > b1[1] * 2);
await page.evaluate(() => (window.__sp.v2.battery = 0.8));

// Library: four stem files plus TRACK.txt, kept across a reload.
const wav = (f) => {
  const sr = 44100,
    n = sr * 4;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * f * i) / sr)), 44 + i * 2);
  return b;
};
await page.click('#open-manage');
await page.setInputFiles('#file-input', [
  { name: '1.wav', mimeType: 'audio/wav', buffer: wav(220) },
  { name: '2.wav', mimeType: 'audio/wav', buffer: wav(330) },
  { name: '3.wav', mimeType: 'audio/wav', buffer: wav(55) },
  { name: '4.wav', mimeType: 'audio/wav', buffer: wav(110) },
  {
    name: 'TRACK.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('title: Test Pack\ntempo_bpm: 111\nTrackColour: [[10,20,30],[200,100,50]]\nTrackGain_dB: -3\n'),
  },
]);
await page.waitForFunction(() => window.__sp.lib.custom.some((m) => m.title === 'Test Pack'), null, { timeout: 15000 });
const pack = await state(() => window.__sp.lib.custom.find((m) => m.title === 'Test Pack'));
check(
  'library: numbered stems and TRACK.txt become a track',
  pack.bpm === 111 && pack.gainDb === -3 && Math.abs(pack.colours[1][0] - 200 / 255) < 1e-6,
);
check('library: it is listed', (await page.textContent('#songs')).includes('Test Pack'));
await page.waitForFunction(() => window.__sp.player.track?.id?.startsWith('t'), null, { timeout: 15000 });
check('library: and it plays straight away', await state(() => window.__sp.album === 'custom'));
await page.dblclick('#secret');
check('library: double click in the corner shows the debug menu', await page.isVisible('#debug-menu'));
await page.click('#manage .close');
await page.reload();
await page.waitForFunction(() => window.__sp?.lib, null, { timeout: 30000 });
await page.waitForFunction(() => window.__sp.lib.custom.length > 0 && window.__sp.lib.recordings.length > 0, null, {
  timeout: 15000,
});
check('library: songs and recordings survive a reload', true);
// The final track of the Recordings album gives each recording its own slider, newest loudest.
await page.evaluate(async () => {
  const a = window.__sp;
  const b = await a.lib.recordingBlob(a.lib.recordings[0]);
  await a.lib.addRecording(b, 1, 4);
  a.album = 'recordings';
  a.index = a.lib.recordings.length;
  await a.loadCurrent(false);
});
{
  const all = await state(() => {
    const a = window.__sp;
    const t = a.player.track;
    const peak = (s) => t.stems[s].getChannelData(0).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    return {
      id: t.id,
      first: peak('vocals'),
      second: peak('other'),
      third: peak('drums'),
      title: document.getElementById('title').textContent,
      levels: a.v1.levels,
    };
  });
  check(
    'recordings: the last track holds each recording on its own stem, newest at full',
    all.id === 'all-recordings' &&
      all.first > 0 &&
      all.second > 0 &&
      all.third === 0 &&
      all.levels.top === 4 &&
      all.levels.right === 1,
    JSON.stringify(all),
  );
}

// Keep-the-newest rule, with the oldest going first.
{
  const r = await page.evaluate(async () => {
    const a = window.__sp;
    const b = await a.lib.recordingBlob(a.lib.recordings[0]);
    const oldest = a.lib.recordings[0].id;
    for (let i = 0; i < 3; i++) await a.lib.addRecording(b, 1, 4);
    return { n: a.lib.recordings.length, oldestGone: !a.lib.recordings.some((m) => m.id === oldest) };
  });
  check('recordings: a fifth overwrites the oldest of 4 slots', r.n === 4 && r.oldestGone, JSON.stringify(r));
}
await page.evaluate(async () => {
  const a = window.__sp;
  for (const m of a.lib.recordings.slice(1)) await a.lib.remove(m);
  a.album = 'demo';
  a.index = 0;
  await a.loadCurrent(false);
});

// config.txt from the panel changes how the device behaves.
await page.click('#open-manage');
await page.click('#manage summary');
await page.fill('#config', 'Fast2play=1.5\nSeekJumpPeriod=500\nMinVolumeLevel=-40');
await page.click('#config-save');
{
  const cfg = await state(() => ({
    step: window.__sp.v1.constructor && 0,
    ...JSON.parse(localStorage.getItem('stem.config') ? '{"saved":true}' : '{}'),
  }));
  check('config.txt: saved', cfg.saved === true);
}
await page.click('#manage .close');
await page.evaluate(() => {
  window.__sp.setLook('tan');
  window.__sp.v1.menu = 'loop';
  window.__sp.v1.slide('right', 99, 0.95, performance.now());
  window.__sp.v1.slideEnd('right', 99);
});
check('config.txt: Fast2play sets the top speed', (await state(() => window.__sp.player.rate)) === 1.5);
await page.evaluate(() => {
  const a = window.__sp;
  a.v1.speedIndex = 1;
  a.v1.reverse = false;
  a.v1.menu = 'main';
  a.player.setRate(1);
  localStorage.removeItem('stem.config');
});
await page.click('#open-manage');
await page.fill('#config', 'Fast2play=1.25\nSeekJumpPeriod=1000\nMinVolumeLevel=-30');
await page.click('#config-save');
await page.evaluate(() => localStorage.removeItem('stem.config'));
await page.click('#manage .close');

await page.click('#open-manage');
await page.click('#songs li button:has-text("Delete")');
await page.waitForFunction(() => window.__sp.lib.custom.length === 0, null, { timeout: 5000 });
await page.click('#recs li button:has-text("Delete")');
await page.waitForFunction(() => window.__sp.lib.recordings.length === 0, null, { timeout: 5000 });
check('library: songs and recordings delete', true);
await page.click('#manage .close');

// Factory reset from the hidden menu clears songs and recordings, and leaves the demo playable.
await page.evaluate(async () => {
  const a = window.__sp;
  const z = new Float32Array(44100);
  await a.lib.addFromChannels('Reset Me', { vocals: [z], other: [z], drums: [z], bass: [z] }, 44100, { bpm: 100 });
});
await page.click('#open-manage');
await page.dblclick('#secret');
await page.click('#factory');
await page.waitForFunction(() => window.__sp.lib.custom.length === 0 && window.__sp.album === 'demo', null, {
  timeout: 5000,
});
await page.waitForFunction(() => window.__sp.player.track?.id?.startsWith('demo'), null, { timeout: 60000 });
check('factory reset clears the library and returns to the demo', true);

check('no console or page errors in that whole run', problems.length === 0, problems.slice(0, 4).join(' | '));
await ctx.close();

// Phone width.
{
  const { page: p, ctx: c2 } = await openApp(browser, 'debug&look=tan', { width: 360, height: 700 });
  const m = await p.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: innerWidth,
    bottom: document.querySelector('.bottom').getBoundingClientRect().bottom,
    h: innerHeight,
  }));
  check('phone: no sideways scroll, nothing off screen', m.sw <= m.iw && m.bottom <= m.h, JSON.stringify(m));
  const box = await p.evaluate(() => {
    const a = window.__sp;
    a.stage.view('flat', true);
    a.stage.render(0);
    return [a.stage.project(-1, 0, 0).x, a.stage.project(1, 0, 0).x];
  });
  check('phone: the whole device fits', box[0] >= 0 && box[1] <= 360, box.map((v) => v.toFixed(0)).join(' to '));
  await p.keyboard.press('Tab');
  await c2.close();
}

// file://
{
  const c3 = await browser.newContext();
  const p = await c3.newPage();
  await p.goto(pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href);
  await p.waitForTimeout(300);
  check('double-clicked file: explains how to start it', await p.isVisible('#file-note'));
  await c3.close();
}

// Headers for threads.
{
  const res = await fetch(BASE);
  check(
    'server sends the isolation headers',
    res.headers.get('cross-origin-embedder-policy') === 'require-corp' &&
      res.headers.get('cross-origin-opener-policy') === 'same-origin',
  );
}
await browser.close();

// The other engines: does it start, render and play?
for (const [name, type] of [
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  try {
    const b2 = await type.launch();
    const c4 = await b2.newContext({ viewport: { width: 900, height: 700 } });
    const p = await c4.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}?debug&look=tan`);
    await p.waitForFunction(() => window.__sp?.player?.track, null, { timeout: 90000 });
    const facts = await p.evaluate(async () => ({
      gl: !!document.getElementById('stage').getContext('webgl2'),
      gpu: !!navigator.gpu,
      opfs: await window.__sp.lib.persistent(),
    }));
    check(`${name}: starts with no page errors`, errs.length === 0, `${JSON.stringify(facts)} ${errs[0] ?? ''}`);
    await b2.close();
  } catch (e) {
    check(`${name}: starts`, false, e.message.split('\n')[0]);
  }
}
server.kill();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) console.log(failures.map((f) => ` - ${f}`).join('\n'));
process.exit(failures.length ? 1 : 0);
