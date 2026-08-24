// STIIL — abstract graphics from imported images via stacked artistic effects:
// adjustments, posterize, duotone, mosaic, mirror, grain and scanlines. Rebuilt
// on change (stills). p5 2D. Drop an image to load your own. Part of the image-
// manipulation family.
import { createTool } from '../../js/etch/shell.js';
import { attachPresets } from '../../js/etch/presets.js';
import { attachExport } from '../../js/etch/export.js';

const params = {
  brightness: 0, contrast: 20, saturation: 60, invert: false,
  posterize: 0, duotone: false, shadow: '#1b1b3a', highlight: '#fdcb6e',
  mosaic: 1, mirror: 'none',
  grain: 0, scanlines: 0,
};

const tool = createTool({ name: 'STIIL', version: '0.1' });
let pb = null, srcImg = null, dirty = true, pInst = null;
const tmp = document.createElement('canvas');
const tctx = tmp.getContext('2d');
function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

function makeDefault(p) {
  const g = p.createGraphics(900, 600); g.pixelDensity(1);
  const ctx = g.drawingContext;
  const grad = ctx.createLinearGradient(0, 0, 900, 600);
  grad.addColorStop(0, '#e94560'); grad.addColorStop(0.4, '#533483'); grad.addColorStop(0.7, '#0f3460'); grad.addColorStop(1, '#16213e');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 900, 600);
  for (let i = 0; i < 12; i++) { ctx.fillStyle = `hsla(${Math.random() * 360},70%,62%,0.7)`; ctx.beginPath(); ctx.arc(Math.random() * 900, Math.random() * 600, 40 + Math.random() * 110, 0, Math.PI * 2); ctx.fill(); }
  g.fill('#fff'); g.textSize(150); g.textAlign(p.CENTER, p.CENTER); g.textStyle(p.BOLD); g.text('STIIL', 450, 300);
  return g;
}

function makeBuffer() {
  const cap = 1000, mx = Math.max(srcImg.width, srcImg.height);
  const k = Math.min(cap / mx, 1.5);
  const pw = Math.max(2, Math.round(srcImg.width * k)), ph = Math.max(2, Math.round(srcImg.height * k));
  pb = pInst.createGraphics(pw, ph); pb.pixelDensity(1);
}

function build() {
  if (!pb || !srcImg) return;
  const W = pb.width, H = pb.height, ctx = pb.drawingContext;
  ctx.globalCompositeOperation = 'source-over'; ctx.imageSmoothingEnabled = true;
  pb.clear(); pb.image(srcImg, 0, 0, W, H);

  if (params.mirror === 'horizontal' || params.mirror === 'quad') {
    ctx.save(); ctx.scale(-1, 1); ctx.drawImage(pb.canvas, 0, 0, W / 2, H, -W, 0, W / 2, H); ctx.restore();
  }
  if (params.mirror === 'vertical' || params.mirror === 'quad') {
    ctx.save(); ctx.scale(1, -1); ctx.drawImage(pb.canvas, 0, 0, W, H / 2, 0, -H, W, H / 2); ctx.restore();
  }
  if (params.mosaic > 1) {
    const tw = Math.max(1, Math.floor(W / params.mosaic)), th = Math.max(1, Math.floor(H / params.mosaic));
    tmp.width = tw; tmp.height = th; tctx.imageSmoothingEnabled = true; tctx.clearRect(0, 0, tw, th);
    tctx.drawImage(pb.canvas, 0, 0, W, H, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, W, H); ctx.drawImage(tmp, 0, 0, tw, th, 0, 0, W, H); ctx.imageSmoothingEnabled = true;
  }

  pb.loadPixels();
  const px = pb.pixels;
  const C = params.contrast * 2.55, cf = (259 * (C + 255)) / (255 * (259 - C));
  const sat = (params.saturation + 100) / 100, bri = params.brightness * 2.55;
  const levels = params.posterize, qf = levels > 1 ? levels - 1 : 1;
  const [sr, sg, sb] = hexRgb(params.shadow), [hr, hg, hb] = hexRgb(params.highlight);
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i], g = px[i + 1], b = px[i + 2];
    r += bri; g += bri; b += bri;
    r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    r = lum + (r - lum) * sat; g = lum + (g - lum) * sat; b = lum + (b - lum) * sat;
    if (params.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
    if (levels > 1) { r = Math.round(r / 255 * qf) / qf * 255; g = Math.round(g / 255 * qf) / qf * 255; b = Math.round(b / 255 * qf) / qf * 255; }
    if (params.duotone) { const t = Math.max(0, Math.min(1, (0.299 * r + 0.587 * g + 0.114 * b) / 255)); r = sr + (hr - sr) * t; g = sg + (hg - sg) * t; b = sb + (hb - sb) * t; }
    if (params.grain > 0) { const n = (Math.random() * 2 - 1) * params.grain * 2.55; r += n; g += n; b += n; }
    if (params.scanlines > 0 && ((i / 4 / W) | 0) % 2 === 0) { const m = 1 - params.scanlines / 100; r *= m; g *= m; b *= m; }
    px[i] = r < 0 ? 0 : r > 255 ? 255 : r; px[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g; px[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  pb.updatePixels();
}

pInst = tool.startSketch((p) => {
  p.setup = () => { p.createCanvas(p.windowWidth, p.windowHeight); p.pixelDensity(1); srcImg = makeDefault(p); makeBuffer(); dirty = true; };
  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);
  p.draw = () => {
    if (dirty) { build(); dirty = false; }
    p.background(8, 8, 12);
    if (pb) { const s = Math.min(p.width / pb.width, p.height / pb.height); p.image(pb, (p.width - pb.width * s) / 2, (p.height - pb.height * s) / 2, pb.width * s, pb.height * s); }
  };
});

tool.pane.on('change', () => { dirty = true; });

const host = tool.canvasHost;
host.addEventListener('dragover', (e) => e.preventDefault());
host.addEventListener('drop', (e) => {
  e.preventDefault(); const file = e.dataTransfer?.files?.[0];
  if (!file || !/^image\//i.test(file.type)) return;
  const url = URL.createObjectURL(file);
  pInst.loadImage(url, (img) => { srcImg = img; makeBuffer(); dirty = true; URL.revokeObjectURL(url); }, () => URL.revokeObjectURL(url));
});

// ---- UI ----
const main = tool.pages.main;
const fAdj = main.addFolder({ title: 'Adjust' });
fAdj.addBinding(params, 'brightness', { min: -100, max: 100, step: 1 });
fAdj.addBinding(params, 'contrast', { min: -100, max: 100, step: 1 });
fAdj.addBinding(params, 'saturation', { min: -100, max: 100, step: 1 });
fAdj.addBinding(params, 'invert');

const fStyle = main.addFolder({ title: 'Stylize' });
fStyle.addBinding(params, 'posterize', { label: 'posterize', min: 0, max: 12, step: 1 });
fStyle.addBinding(params, 'duotone');
fStyle.addBinding(params, 'shadow', { view: 'color' });
fStyle.addBinding(params, 'highlight', { view: 'color' });

const fStruct = main.addFolder({ title: 'Structure' });
fStruct.addBinding(params, 'mosaic', { min: 1, max: 60, step: 1 });
fStruct.addBinding(params, 'mirror', { options: { None: 'none', Horizontal: 'horizontal', Vertical: 'vertical', Quad: 'quad' } });

const fGrain = main.addFolder({ title: 'Texture' });
fGrain.addBinding(params, 'grain', { min: 0, max: 100, step: 1 });
fGrain.addBinding(params, 'scanlines', { min: 0, max: 80, step: 1 });

attachExport(tool.pages.export, { getCanvas: tool.getCanvas, name: 'stiil' });

const presets = {
  Duotone: { contrast: 30, saturation: 0, posterize: 0, duotone: true, shadow: '#10092e', highlight: '#f6d186', mosaic: 1, mirror: 'none', grain: 8 },
  Poster: { contrast: 45, saturation: 40, posterize: 5, duotone: false, mosaic: 1, mirror: 'none', scanlines: 0 },
  Kaleido: { contrast: 25, saturation: 70, mosaic: 4, mirror: 'quad', posterize: 6, grain: 6 },
  CRT: { contrast: 30, saturation: 50, mosaic: 3, scanlines: 40, grain: 14, mirror: 'none' },
  Risograph: { contrast: 35, saturation: -20, posterize: 0, duotone: true, shadow: '#1b2a4a', highlight: '#f4a259', mosaic: 1, mirror: 'none', grain: 18 },
  Mosaic: { contrast: 20, saturation: 50, mosaic: 16, posterize: 0, duotone: false, mirror: 'none', grain: 0, scanlines: 0 },
  'Pop Art': { contrast: 40, saturation: 80, posterize: 4, duotone: false, mosaic: 2, mirror: 'quad', grain: 4 },
  Noir: { brightness: -10, contrast: 50, saturation: -100, posterize: 6, duotone: false, mosaic: 1, mirror: 'none', grain: 12, scanlines: 0 },
  VHS: { contrast: 25, saturation: 40, posterize: 0, duotone: false, mosaic: 2, scanlines: 55, grain: 20, mirror: 'none' },
  'Kaleido Mosaic': { contrast: 25, saturation: 40, mosaic: 6, mirror: 'quad', duotone: true, shadow: '#06121f', highlight: '#7ad7f0', grain: 6 },
};
attachPresets(tool.pages.options, { pane: tool.pane, params, presets, onApply: () => { dirty = true; } });
