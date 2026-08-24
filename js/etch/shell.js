// Shared shell for Etch tools: a floating Tweakpane control panel
// (MAIN / EXPORT / OPTIONS tabs) over a full-bleed p5 canvas. Reused by every
// tool built on the new stack. p5 is loaded as a global (window.p5) by the
// host page; Tweakpane is imported as an ES module.
import { Pane } from '../vendor/tweakpane/tweakpane.min.js';

export function createTool({ name, version = '0.1', backHref = '../../' }) {
  const root = document.createElement('div');
  root.className = 'etch-tool';

  const canvasHost = document.createElement('div');
  canvasHost.className = 'etch-canvas';
  root.appendChild(canvasHost);

  const paneHost = document.createElement('div');
  paneHost.className = 'etch-pane';
  root.appendChild(paneHost);

  const back = document.createElement('a');
  back.className = 'etch-back';
  back.href = backHref;
  back.textContent = '← Tools';
  root.appendChild(back);

  document.body.appendChild(root);

  const pane = new Pane({ container: paneHost, title: `${name} · v${version}` });
  const tab = pane.addTab({
    pages: [{ title: 'MAIN' }, { title: 'EXPORT' }, { title: 'OPTIONS' }],
  });
  const pages = { main: tab.pages[0], export: tab.pages[1], options: tab.pages[2] };

  function startSketch(factory) {
    const P5 = window.p5;
    if (!P5) throw new Error('p5 not loaded (expected window.p5)');
    return new P5(factory, canvasHost);
  }

  function getCanvas() {
    return canvasHost.querySelector('canvas');
  }

  // For non-p5 tools (e.g. Paper.js): create a full-bleed <canvas> in the host.
  // The tool wires its own renderer (e.g. paper.setup) and resize handling.
  function mountCanvas() {
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvasHost.appendChild(canvas);
    return canvas;
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) root.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t && t.isContentEditable);
    if (e.key === 'f' && !typing) toggleFullscreen();
  });

  return { root, pane, pages, canvasHost, startSketch, mountCanvas, getCanvas, toggleFullscreen };
}

// Dev hooks (window.__<name>) are useful for driving a tool from the console
// during development, but pollute the global namespace in production.
// `exposeDebug(name, obj)` attaches `window.__<name>` only when the URL has
// `?debug` AND the page is served from a local dev origin (localhost / 127.0.0.1
// / *.local) — so the hook stays available during development but is inert on a
// public deployment (e.g. Vercel). Power users can still reach it on localhost.
const isDevOrigin = () => {
  try {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local');
  } catch { return false; }
};
export const isDebug = () => {
  try { return isDevOrigin() && new URLSearchParams(location.search).has('debug'); }
  catch { return false; }
};
export function exposeDebug(name, obj) {
  if (isDebug()) window['__' + name] = obj;
}
