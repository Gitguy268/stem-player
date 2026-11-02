import { renderDemo, type DemoSpec } from './demo';

self.onmessage = (e: MessageEvent<{ spec: DemoSpec; sr: number }>) => {
  const out = renderDemo(e.data.spec, e.data.sr);
  (self as unknown as Worker).postMessage(
    out,
    Object.values(out).map((a) => a.buffer),
  );
};
