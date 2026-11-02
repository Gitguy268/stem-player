// node scripts/shot.mjs out.png "debug&look=tan" [front|flat|back|buttons|ports] [js to run]
import { launch, openApp, serve } from './lib.mjs';
const [out, query = 'debug', view = 'front', js] = process.argv.slice(2);
const s = await serve();
const b = await launch();
const { page, problems } = await openApp(b, query);
await page.evaluate(
  ({ view, js }) => {
    const a = window.__sp;
    const v2 = a.kind === 'v2';
    const v = { buttons: v2 ? 135 : 50, ports: v2 ? 225 : 228 }[view] ?? view;
    a.stage.view(v, true);
    if (js) eval(js);
  },
  { view, js },
);
await page.waitForTimeout(500);
await page.screenshot({ path: out });
console.log(problems.join('\n') || 'no page errors');
await b.close();
s.kill();
