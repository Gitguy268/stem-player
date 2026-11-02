import { App } from './app';

if (location.protocol !== 'file:') {
  App.start().catch((e) => {
    console.error(e);
    const t = document.getElementById('title');
    if (t)
      t.textContent =
        e instanceof Error && /WebGL/i.test(e.message)
          ? 'This needs WebGL, which this browser has off'
          : 'Could not start';
  });
}
