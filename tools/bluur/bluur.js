// BLUUR — a shuffled grid of forms (rounded rects or dropped SVG shapes), each
// stamped into an offscreen buffer with its own seeded gaussian blur, blend mode
// and procedural colour, then post-processed with a full-screen blur, brightness/
// contrast and film grain. The whole pipeline runs on 2D canvas — per-shape
// `ctx.filter` blur into a `gForm` buffer, then native blur/brightness/contrast
// filters plus a procedural grain overlay for the post pass. Procedural colour
// is the public-domain Inigo Quilez cosine-palette formula.
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachExport } from '../../js/etch/export.js';
import { seedNoise, noise2D, noise3D, alea } from '../../js/etch/noise.js';
import { interpolateHex, attachPaletteControls } from '../../js/etch/palette.js';

/////////////////////////////////////////////////////////////////////////////
// Math helpers (angles in degrees where the form transforms use them).
/////////////////////////////////////////////////////////////////////////////
const { sin, cos, floor, ceil, abs, max, min, sqrt, pow, PI } = Math;
const TWO_PI = PI * 2;
const HALF_PI = PI / 2;
const DEG = PI / 180;
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const constrain = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round = (v, d = 0) => { const p = 10 ** d; return Math.round(v * p) / p; };

// Eased remap (port of the reference's map2 / sighack easing) — only the curves
// the engine actually uses: Linear / Quadratic / Cubic / Sqrt / Quintic /
// Sinusoidal / Circular, with IN(0)/OUT(1)/BOTH(2).
function map2(value, s1, e1, s2, e2, type, when) {
  const b = s2, c = e2 - s2, d = e1 - s1, p = 0.5;
  let t = value - s1;
  switch (type) {
    case 'Linear': return (c * t) / d + b;
    case 'Sqrt':
      if (when === 0) { t /= d; return c * pow(t, p) + b; }
      if (when === 1) { t /= d; return c * (1 - pow(1 - t, p)) + b; }
      t /= d / 2; return t < 1 ? (c / 2) * pow(t, p) + b : (c / 2) * (2 - pow(2 - t, p)) + b;
    case 'Quadratic':
      if (when === 0) { t /= d; return c * t * t + b; }
      if (when === 1) { t /= d; return -c * t * (t - 2) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * t * t + b; t--; return (-c / 2) * (t * (t - 2) - 1) + b;
    case 'Cubic':
      if (when === 0) { t /= d; return c * t * t * t + b; }
      if (when === 1) { t /= d; t--; return c * (t * t * t + 1) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * t * t * t + b; t -= 2; return (c / 2) * (t * t * t + 2) + b;
    case 'Quintic':
      if (when === 0) { t /= d; return c * t * t * t * t * t + b; }
      if (when === 1) { t /= d; t--; return c * (t * t * t * t * t + 1) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * t ** 5 + b; t -= 2; return (c / 2) * (t ** 5 + 2) + b;
    case 'Sinusoidal':
      if (when === 0) return -c * cos((t / d) * HALF_PI) + c + b;
      if (when === 1) return c * sin((t / d) * HALF_PI) + b;
      return (-c / 2) * (cos((PI * t) / d) - 1) + b;
    case 'Circular':
      if (when === 0) { t /= d; return -c * (sqrt(1 - t * t) - 1) + b; }
      if (when === 1) { t /= d; t--; return c * sqrt(1 - t * t) + b; }
      t /= d / 2; if (t < 1) return (-c / 2) * (sqrt(1 - t * t) - 1) + b; t -= 2; return (c / 2) * (sqrt(1 - t * t) + 1) + b;
  }
  return 0;
}

/////////////////////////////////////////////////////////////////////////////
// Option maps
/////////////////////////////////////////////////////////////////////////////
const RATIOS = {
  '2:1': [480, 240], '16:9': [640, 360], '3:2': [480, 320], '4:3': [480, 360],
  '5:4': [600, 480], '1:1': [480, 480], '4:5': [480, 600], '3:4': [360, 480],
  '2:3': [320, 480], '9:16': [360, 640], '1:2': [240, 480],
};
const RATIO_OPTS = Object.fromEntries(Object.keys(RATIOS).map((k) => [k, k]));
// p5 blend names → 2D-canvas globalCompositeOperation
const BLEND_OPS = {
  BLEND: 'source-over', ADD: 'lighter', SCREEN: 'screen', OVERLAY: 'overlay',
  MULTIPLY: 'multiply', LIGHTEST: 'lighten', DARKEST: 'darken',
  HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light', EXCLUSION: 'exclusion',
  DIFFERENCE: 'difference', XOR: 'xor',
};
const BLEND_OPTS = {
  Standard: 'BLEND', Add: 'ADD', Screen: 'SCREEN', Overlay: 'OVERLAY', Multiply: 'MULTIPLY',
  Lightest: 'LIGHTEST', Darkest: 'DARKEST', 'Hard Light': 'HARD_LIGHT', 'Soft Light': 'SOFT_LIGHT',
  Exclusion: 'EXCLUSION', Difference: 'DIFFERENCE', Xor: 'XOR',
};
const SHAPE_OPTS = { 'Default (Rounded Rect)': 'form', 'Custom (SVG)': 'custom' };
const SORT_OPTS = { Ascending: 'asc', Descending: 'desc', Random: 'random' };
const SIZE_OPTS = { 'Canvas / Forms': 'canvas', 'Canvas / 2': 'default', 'Uniform (Canvas / 2)': 'uniform' };
const SIZE_RAND_OPTS = { 'Independent X/Y': 'independent', Uniform: 'uniform' };
const CORNER_OPTS = { Random: 'random', Uniform: 'uniform' };
const ANGLE_OPTS = { 'Right Angles': 'right', 'Random Rotation': 'random' };
const PALETTE_OPTS = { Procedural: 'generative', Custom: 'custom' };
const BG_OPTS = { 'From Palette': 'random', Custom: 'custom' };

/////////////////////////////////////////////////////////////////////////////
// State — shaped like the reference (cnv / form / post / palette / rec / svg) so
// reference-style preset objects deep-merge directly. Faithful numeric defaults.
/////////////////////////////////////////////////////////////////////////////
const cnv = {
  ratio: '1:1', blend: 'SOFT_LIGHT', animation: true, frame: 0,
  scale: { x: 0, y: 0 }, seed: { base: (Math.random() * 10000) | 0, max: 10000 },
};
const form = {
  type: 'form',
  count: { max: 10, x: 6, y: 6 },
  corners: { type: 'uniform', seed: 100, level: 0 },
  size: { type: 'canvas', seed: 1, uni: 1, x: 0, y: 0, min: 5, random: { mode: 'uniform', x: 0, y: 0 } },
  angle: { mode: 'random', seed: 200, random: 0, range: 0 },
  offset: { seed: 10, random: 0, x: -0.25, y: -0.25 },
  blur: { seed: 5, freq: 0, range: { min: 0, max: 0 }, max: 150 },
  blend: { seed: 25, freq: 0, range: { min: 0, max: 0.4 } },
};
const post = {
  blur: { radius: 0 },
  color: { brightness: 0, contrast: 1 },
  grain: { scale: 0.8, opacity: 0.2, freq: 0.1, contrast: 0.2, brightness: 0.5 },
};
const palette = {
  type: 'generative',
  custom: { array: ['#3c2706', '#7a5649', '#cc3904', '#e5cf0a', '#faf5c6'] },
  bg: { seed: 50, color: '#ffffff', type: 'random' },
  offset: { x: 0.5, y: 0.5, z: 0.5 },
  amp: { x: 0.5, y: 0.5, z: 0.5 },
  freq: { x: 1, y: 1, z: 1 },
  phase: { x: 0, y: 0.33, z: 0.67 },
  max: 3.14,
};
const svg = { seed: 500, sort: 'random', shape: [] };
const rec = { frameRate: 60, length: { value: 10 } };

// Clean-slate snapshot so every preset applies onto defaults (deep-merge).
const DEFAULTS = structuredClone({ cnv, form, post, palette, svg, rec });

/////////////////////////////////////////////////////////////////////////////
// Colour
/////////////////////////////////////////////////////////////////////////////
// Inigo Quilez cosine palette: a + b·cos(2π(c·t + d)) → [r,g,b] 0..255.
function generatePalette(t, a, b, c, d) {
  const ch = (ai, bi, ci, di) => constrain(255 * (ai + bi * cos(TWO_PI * (ci * t + di))), 0, 255);
  return [ch(a.x, b.x, c.x, d.x), ch(a.y, b.y, c.y, d.y), ch(a.z, b.z, c.z, d.z)];
}
const rgbCss = (rgb) => `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
function rgbToHex(rgb) {
  const h = (v) => constrain(v | 0, 0, 255).toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}
// sRGB <-> CIE Lab (D65) for perceptual custom-palette transitions.
function hexToLab(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, bl = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (cc) => (cc > 0.04045 ? ((cc + 0.055) / 1.055) ** 2.4 : cc / 12.92);
  r = lin(r); g = lin(g); bl = lin(bl);
  let x = (r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047;
  let y = r * 0.2126 + g * 0.7152 + bl * 0.0722;
  let z = (r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (tt) => (tt > 0.008856 ? Math.cbrt(tt) : 7.787 * tt + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function labToHex(L, a, bb) {
  let y = (L + 16) / 116, x = a / 500 + y, z = y - bb / 200;
  const fi = (tt) => (tt ** 3 > 0.008856 ? tt ** 3 : (tt - 16 / 116) / 7.787);
  x = 0.95047 * fi(x); y = fi(y); z = 1.08883 * fi(z);
  let r = x * 3.2406 - y * 1.5372 - z * 0.4986;
  let g = -x * 0.9689 + y * 1.8758 + z * 0.0415;
  let bl = x * 0.0557 - y * 0.204 + z * 1.057;
  const gam = (cc) => (cc > 0.0031308 ? 1.055 * cc ** (1 / 2.4) - 0.055 : 12.92 * cc);
  const h = (cc) => constrain(Math.round(gam(cc) * 255), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(bl)}`;
}
// Interpolate a 0..1 index across the palette array in Lab space.
function getInterpolatedColor(t, arr) {
  if (arr.length === 1) return arr[0];
  const scaled = constrain(t, 0, 1) * (arr.length - 1);
  const lo = floor(scaled), hi = (lo + 1) % arr.length, f = scaled - lo;
  const A = hexToLab(arr[lo]), B = hexToLab(arr[hi]);
  return labToHex(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f);
}
// Background derived from the palette (pale tint), or a custom colour.
function updateColorBG() {
  if (palette.bg.type === 'custom') return;
  let base;
  if (palette.type === 'generative') {
    const idx = map(noise2D(-7158.2, -8391.2), -1, 1, 0, TWO_PI);
    base = rgbToHex(generatePalette(idx, palette.offset, palette.amp, palette.freq, palette.phase));
  } else {
    const arr = palette.custom.array;
    const i = floor(map(noise2D(-12452.6, -2814.8), -1, 1, 0, arr.length));
    base = arr[constrain(i, 0, arr.length - 1)];
  }
  const amt = map(noise2D(-23054.1, 9081.4), -1, 1, 0.78, 0.92); // heavy lighten → pale ground
  palette.bg.color = interpolateHex(base, '#ffffff', amt);
}

/////////////////////////////////////////////////////////////////////////////
// Form field
/////////////////////////////////////////////////////////////////////////////
let GW = 480, GH = 480;            // gForm (render) size, set responsively
let forms = [];

function seededShuffle(arr, seed) {
  const rng = alea(seed + 0.5);
  for (let i = arr.length - 1; i > 0; i--) { const j = floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
}

function makeForm(ix, iy, index) {
  const f = { index: { number: index, x: ix, y: iy } };
  f.corners = { level: 0, random: noise2D(form.corners.seed + index * 1.5, -72341.8) };
  const canvasType = form.size.type === 'canvas';
  f.scale = {
    x: canvasType ? GW / form.count.x : min(GW, GH) / 2,
    y: canvasType ? GH / form.count.y : min(GW, GH) / 2,
    random: {
      x: map(noise2D(form.size.seed + index, -3197.1), -1, 1, 0.5, -1.5),
      y: map(noise2D(form.size.seed + index, 218910.7), -1, 1, 0.5, -1.5),
    },
  };
  if (form.size.random.mode === 'uniform') f.scale.random.y = f.scale.random.x;
  f.sizeRandom = {
    x: form.size.random.x,
    y: form.size.random.mode === 'independent' ? form.size.random.y : form.size.random.x,
  };
  // custom SVG selection
  f.svgIndex = 0;
  if (svg.shape.length > 1) {
    if (svg.sort === 'random') {
      const n = map(noise2D(svg.seed + index * 19.4, -5548.2 + index * 7.17), -1, 1, 0, 1);
      f.svgIndex = floor(n * svg.shape.length);
    } else if (svg.sort === 'asc') f.svgIndex = index % svg.shape.length;
    else f.svgIndex = abs(svg.shape.length - 1 - (index % svg.shape.length));
  }
  const sh = svg.shape[f.svgIndex];
  f.shape = sh
    ? { path: new Path2D(sh.path), x: f.scale.x / max(sh.width, sh.height), y: f.scale.y / max(sh.width, sh.height), width: sh.width / 2, height: sh.height / 2 }
    : { path: null, x: 0, y: 0, width: 0, height: 0 };
  // angle
  f.angleRandom = map(noise2D(form.angle.seed + index, 54216.1), -1, 1, -form.angle.random * 180, form.angle.random * 180);
  if (form.angle.mode === 'right') f.angleRandom = floor(map(noise2D(form.angle.seed + index, 15951.4), -1, 1, 0, 4)) * 90;
  // offset randoms
  f.offset = {
    xrand: noise2D(form.offset.seed + index, 81943.4),
    yrand: noise2D(form.offset.seed * 7.1 + index, 5092.5),
    x: 0, y: 0,
  };
  // per-form blur randoms
  f.blur = {
    freq: map(noise2D(form.blur.seed - 2081.7 + index * 2.8, 7212.3), -1, 1, 0.001, 0.01),
    noise: map(noise2D(form.blur.seed + 627.8 + index * 11.4, -11501.2), -1, 1, -1000, 1000),
    start: map(noise2D(form.blur.seed + 1793.5 + index * 3.1, 39702.7), -1, 1, 0, form.blur.range.min),
    range: map(noise2D(form.blur.seed - 8521.2 + index * 6.3, 1532.7), -1, 1, form.blur.range.min, form.blur.range.max),
  };
  f.coords = { x: 0, y: 0 };
  f.size = { x: 0, y: 0 };
  f.rotate = 0;
  return f;
}

function createForms() {
  seedNoise(cnv.seed.base);
  updateColorBG();
  forms = [];
  let index = 0;
  for (let row = 0; row < form.count.y; row++)
    for (let col = 0; col < form.count.x; col++) forms.push(makeForm(col, row, index++));
  seededShuffle(forms, cnv.seed.base);
}

function formCoords(f) {
  const posX = (GW / form.count.x) * 0.5;
  const posY = (GH / form.count.y) * 0.5;
  const px = map(f.index.x, 0, form.count.x, -GW * 0.5, GW * 0.5) + posX;
  const py = map(f.index.y, 0, form.count.y, -GH * 0.5, GH * 0.5) + posY;
  const ox = (px <= GW * 0.5 ? px : -px) * form.offset.x;
  const oy = (py <= GH * 0.5 ? py : -py) * form.offset.y;
  f.offset.x = ox + GW * 0.25 * f.offset.xrand * form.offset.random;
  f.offset.y = oy + GH * 0.25 * f.offset.yrand * form.offset.random;
  f.coords.x = px + f.offset.x;
  f.coords.y = py + f.offset.y;
}

function formSize(f, sx, sy) {
  if (form.type === 'custom' && svg.shape.length) {
    f.size.x = max(form.size.min / 100, sx + f.scale.random.x * f.sizeRandom.x);
    f.size.y = max(form.size.min / 100, sy + f.scale.random.y * f.sizeRandom.y);
    return;
  }
  const xs = f.scale.x * (sx + f.scale.random.x * f.sizeRandom.x);
  const ys = f.scale.y * (sy + f.scale.random.y * f.sizeRandom.y);
  f.size.x = max(form.size.min, xs);
  f.size.y = max(form.size.min, ys);
  const maxCorner = max(f.size.x, f.size.y);
  let corners = map(form.corners.level, 0, 100, 0, maxCorner);
  if (form.corners.type === 'random') corners = map2(f.corners.random, -0.95, 0.95, -5, maxCorner, 'Cubic', 0);
  f.corners.level = constrain(corners, 0, maxCorner);
}

function formBlur(f, frame) {
  if (form.blur.range.max === 0) return 0;
  const blurFreq = rec.length.value * rec.frameRate * f.blur.freq * form.blur.freq;
  const nb = noise3D(f.blur.noise, blurFreq * cos(TWO_PI * frame), blurFreq * sin(TWO_PI * frame));
  return map2(f.blur.start + map(nb, -1, 1, 0, f.blur.range), 0, form.blur.max, 0, form.blur.max, 'Sinusoidal', 2);
}

function formColor(f, frame, usePalette) {
  if (usePalette) {
    const blendFreq = map(form.blend.freq, 0, 1, 0, 0.0012);
    const colorFreq = rec.length.value * rec.frameRate * blendFreq;
    const nc = noise3D(form.blend.seed + f.index.number * 21.7, colorFreq * cos(TWO_PI * frame), colorFreq * sin(TWO_PI * frame));
    return getInterpolatedColor(map(nc, -1, 1, form.blend.range.min, form.blend.range.max), usePalette);
  }
  const colorRange = form.blend.range.max - form.blend.range.min;
  const freqMin = map(colorRange, 0, 1, 0.0008, 0.0002);
  const freqMax = map(colorRange, 0, 1, 0.008, 0.002);
  const i = f.index.number;
  const colorRandomRange = map(noise2D(form.blend.seed + i * 0.1, -61712.7), -1, 1, 0, colorRange);
  const colorStart = map(noise2D(form.blend.seed + i * 8.2, 2612.7), -1, 1, form.blend.range.min * PI, form.blend.range.max * PI);
  const noiseStart = map(noise2D(form.blend.seed + i * 1.0, 19511.2), -1, 1, 0, TWO_PI);
  const noiseFreq = map(noise2D(form.blend.seed + i * 10.1, -13542.5), -1, 1, freqMin * form.blend.freq, freqMax * form.blend.freq);
  const cnf = rec.length.value * rec.frameRate * noiseFreq;
  const sc = noise3D(noiseStart, cnf * cos(TWO_PI * frame), cnf * sin(TWO_PI * frame));
  return rgbCss(generatePalette(colorStart + sc * colorRandomRange, palette.offset, palette.amp, palette.freq, palette.phase));
}

// Draw the whole form field into the 2D gForm buffer.
function drawForms(g, frame) {
  const ctx = g.drawingContext;
  g.clear();
  ctx.save();
  ctx.filter = 'none';
  ctx.globalCompositeOperation = BLEND_OPS[cnv.blend] || 'source-over';
  ctx.translate(GW * 0.5, GH * 0.5);
  ctx.scale(1 + cnv.scale.x, 1 + cnv.scale.y);

  const usePalette = palette.type === 'custom' ? palette.custom.array : null;
  const sizeX = form.size.type === 'uniform' ? form.size.uni : form.size.x;
  const sizeY = form.size.type === 'uniform' ? form.size.uni : form.size.y;

  for (const f of forms) {
    formCoords(f);
    f.rotate = form.angle.range + f.angleRandom;
    formSize(f, sizeX, sizeY);
    const blur = formBlur(f, frame);
    const fill = formColor(f, frame, usePalette);

    ctx.save();
    if (form.blur.range.max !== 0) ctx.filter = `blur(${blur}px)`;
    ctx.fillStyle = fill;
    ctx.translate(f.coords.x, f.coords.y);
    ctx.rotate(f.rotate * DEG);
    if (form.type === 'custom' && f.shape.path) {
      ctx.scale(f.size.x, f.size.y);
      ctx.scale(f.shape.x, f.shape.y);
      ctx.translate(-f.shape.width, -f.shape.height);
      ctx.fill(f.shape.path, 'evenodd');
    } else {
      roundRect(ctx, -f.size.x / 2, -f.size.y / 2, f.size.x, f.size.y, f.corners.level);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  r = min(r, w / 2, h / 2);
  ctx.beginPath();
  if (r <= 0.5) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/////////////////////////////////////////////////////////////////////////////
// Post-processing — film grain (procedural noise overlay). Full-screen blur +
// brightness/contrast are applied as a native canvas filter when compositing.
/////////////////////////////////////////////////////////////////////////////
let grainCanvas = null, grainCtx = null, grainW = 0, grainH = 0, grainTick = 0;
function ensureGrain() {
  const w = max(2, floor(GW / post.grain.scale));
  const h = max(2, floor(GH / post.grain.scale));
  if (!grainCanvas) { grainCanvas = document.createElement('canvas'); grainCtx = grainCanvas.getContext('2d'); }
  if (w !== grainW || h !== grainH) { grainW = w; grainH = h; grainCanvas.width = w; grainCanvas.height = h; }
}
function renderGrain(frame) {
  ensureGrain();
  const iBright = map(post.grain.brightness, 0.1, 1, 1, 0.1);
  const iContrast = map2(post.grain.contrast, 0.1, 1, 0.5, 10, 'Cubic', 0);
  const seedBase = ceil(map(round(post.grain.freq, 3), 0, 1, 0, rec.length.value)) * frame * 9301 + 1;
  const img = grainCtx.createImageData(grainW, grainH);
  const d = img.data;
  let s = (seedBase * 2654435761) >>> 0;
  const rnd = () => { s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0; return s / 4294967296; };
  for (let i = 0; i < d.length; i += 4) {
    const v = constrain((rnd() - iBright) * iContrast, 0, 1) * 255;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  grainCtx.putImageData(img, 0, 0);
}

/////////////////////////////////////////////////////////////////////////////
// p5 sketch — responsive ratio-locked canvas; gForm holds the form field, which
// is composited (with the post blur/brightness/contrast filter) over the
// palette background, then the grain overlay is mixed in at its opacity.
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'BLUUR', version: '0.2' });
let P = null, gForm = null, displayCanvas = null, isReady = false, pendingPreset = null;

function computeSize() {
  const margin = 0.92;
  const [rw, rh] = RATIOS[cnv.ratio];
  const ar = rw / rh;
  const availW = window.innerWidth * margin, availH = window.innerHeight * margin;
  let w = availW, h = availW / ar;
  if (h > availH) { h = availH; w = availH * ar; }
  return [max(64, floor(w)), max(64, floor(h))];
}
function updateCanvas() {
  [GW, GH] = computeSize();
  if (gForm) gForm.remove();
  gForm = P.createGraphics(GW, GH);
  gForm.pixelDensity(1);
  P.resizeCanvas(GW, GH);
  grainW = grainH = 0; // force grain buffer rebuild at new size
  if (isReady) createForms();
}

function postFilter() {
  const r = post.blur.radius;
  // map the reference's radius (downscaled-buffer gaussian) to an equivalent
  // CSS blur in render-space px; contrast maps 1:1, brightness ~additively.
  const blurPx = r <= 0 ? 0 : (r + r * r * 0.18) * (GW / 480) * 2;
  const parts = [];
  if (blurPx > 0) parts.push(`blur(${blurPx}px)`);
  if (post.color.contrast !== 1) parts.push(`contrast(${post.color.contrast})`);
  if (post.color.brightness !== 0) parts.push(`brightness(${1 + post.color.brightness})`);
  return parts.length ? parts.join(' ') : 'none';
}

tool.startSketch((p) => {
  p.setup = () => {
    P = p;
    tool.canvasHost.style.display = 'flex';
    tool.canvasHost.style.alignItems = 'center';
    tool.canvasHost.style.justifyContent = 'center';
    [GW, GH] = computeSize();
    displayCanvas = p.createCanvas(GW, GH);
    displayCanvas.elt.style.display = 'block';
    p.pixelDensity(1);
    p.frameRate(rec.frameRate);
    gForm = p.createGraphics(GW, GH);
    gForm.pixelDensity(1);
    createForms();
    isReady = true;
  };

  p.draw = () => {
    if (pendingPreset) { const n = pendingPreset; pendingPreset = null; applyPreset(n); }
    const frame = cnv.frame / (rec.length.value * rec.frameRate);
    drawForms(gForm, frame);
    renderGrain(frame);

    const ctx = displayCanvas.elt.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = palette.bg.color;
    ctx.fillRect(0, 0, GW, GH);
    ctx.filter = postFilter();
    ctx.drawImage(gForm.elt, 0, 0, GW, GH);
    ctx.filter = 'none';
    if (post.grain.opacity > 0) {
      ctx.globalAlpha = post.grain.opacity;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(grainCanvas, 0, 0, GW, GH);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (cnv.animation) cnv.frame = frame >= 1 ? 0 : cnv.frame + 1;
  };

  p.windowResized = () => { if (isReady) updateCanvas(); };
});

/////////////////////////////////////////////////////////////////////////////
// Custom SVG drop (Paper normalises dropped path(s) into shape entries).
/////////////////////////////////////////////////////////////////////////////
let paperReady = false;
function importCustomSVG(svgText) {
  const paper = window.paper;
  if (!paper) { console.warn('Paper.js not loaded — custom SVG import unavailable'); return; }
  try {
    if (!paperReady) { paper.setup(document.createElement('canvas')); paperReady = true; }
    const item = paper.project.importSVG(svgText, { insert: false, expandShapes: true });
    const cp = new paper.CompoundPath();
    (function walk(it) {
      if ((it instanceof paper.Path || it instanceof paper.CompoundPath) && it.pathData) cp.addChild(it.clone());
      else if (it.children) it.children.forEach(walk);
    })(item);
    const b = cp.bounds;
    cp.translate(new paper.Point(-b.x, -b.y));
    svg.shape.push({ path: cp.pathData, width: b.width, height: b.height });
    cp.remove(); paper.project.clear();
    form.type = 'custom';
    formUI();
    if (isReady) createForms();
    tool.pane.refresh();
  } catch (err) { console.error('SVG import failed', err); }
}
tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])].filter((f) => /svg/i.test(f.type) || /\.svg$/i.test(f.name));
  if (!files.length) return;
  svg.shape = [];
  files.forEach((file) => { const r = new FileReader(); r.onload = () => importCustomSVG(r.result); r.readAsText(file); });
});

/////////////////////////////////////////////////////////////////////////////
// UI — mirrors the reference folder structure (CANVAS / FORM + a form-property
// tab NUM/SIZE/OFF/ANG/BLUR/COL + PALETTE + POST).
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;

const fCanvas = main.addFolder({ title: 'CANVAS', expanded: false });
fCanvas.addBinding(cnv, 'ratio', { label: 'Canvas Ratio', options: RATIO_OPTS }).on('change', () => { if (P) updateCanvas(); });
fCanvas.addBinding(cnv, 'scale', { label: 'Content Scale', x: { min: -0.5, max: 0.5, step: 0.01 }, y: { min: -0.5, max: 0.5, step: 0.01 } });
fCanvas.addBinding(cnv, 'blend', { label: 'Blend Mode', options: BLEND_OPTS });
const bgType = fCanvas.addBinding(palette.bg, 'type', { label: 'Background', options: BG_OPTS }).on('change', () => { backUI(); if (isReady) updateColorBG(); });
const bgColor = fCanvas.addBinding(palette.bg, 'color', { label: 'Back Color', view: 'color' });

const fForm = main.addFolder({ title: 'FORM' });
fForm.addBinding(form, 'type', { label: 'Shape Type', options: SHAPE_OPTS }).on('change', () => { formUI(); if (isReady) createForms(); });
const sortCtl = fForm.addBinding(svg, 'sort', { label: 'Sort Order', options: SORT_OPTS }).on('change', () => { if (isReady) createForms(); });
const svgSeed = fForm.addBinding(svg, 'seed', { label: 'Shape Seed', min: 0, max: cnv.seed.max, step: 1 }).on('change', () => { if (isReady) createForms(); });
fForm.addButton({ title: 'Clear Custom Shapes' }).on('click', () => { svg.shape = []; form.type = 'form'; formUI(); if (isReady) createForms(); tool.pane.refresh(); });
fForm.addBinding(cnv.seed, 'base', { label: 'Noise Seed', min: 0, max: cnv.seed.max, step: 1 }).on('change', () => { if (isReady) createForms(); });

const ftab = main.addTab({ pages: [{ title: 'NUM' }, { title: 'SIZE' }, { title: 'OFF' }, { title: 'ANG' }, { title: 'BLUR' }, { title: 'COL' }] });

// NUM
ftab.pages[0].addBinding(form.count, 'x', { label: 'Count X', min: 1, max: form.count.max, step: 1 }).on('change', () => { if (isReady) createForms(); });
ftab.pages[0].addBinding(form.count, 'y', { label: 'Count Y', min: 1, max: form.count.max, step: 1 }).on('change', () => { if (isReady) createForms(); });
const cornerType = ftab.pages[0].addBinding(form.corners, 'type', { label: 'Corners', options: CORNER_OPTS }).on('change', () => { cornersUI(); if (isReady) createForms(); });
const cornerLevel = ftab.pages[0].addBinding(form.corners, 'level', { label: 'Round Corners', min: 0, max: 100, step: 1 });
const cornerSeed = ftab.pages[0].addBinding(form.corners, 'seed', { label: 'Corner Seed', min: 0, max: cnv.seed.max, step: 1 }).on('change', () => { if (isReady) createForms(); });

// SIZE
ftab.pages[1].addBinding(form.size, 'type', { label: 'Size Type', options: SIZE_OPTS }).on('change', () => { sizeUI(); if (isReady) createForms(); });
const sizeMul = ftab.pages[1].addBinding(form.size, 'x', { label: 'Size Mult X', min: 0, max: 2, step: 0.01 });
const sizeMulY = ftab.pages[1].addBinding(form.size, 'y', { label: 'Size Mult Y', min: 0, max: 2, step: 0.01 });
const sizeUni = ftab.pages[1].addBinding(form.size, 'uni', { label: 'Size Mult', min: 0, max: 2, step: 0.01 });
ftab.pages[1].addBinding(form.size.random, 'mode', { label: 'Random Mode', options: SIZE_RAND_OPTS }).on('change', () => { sizeUI(); if (isReady) createForms(); });
const sizeRandX = ftab.pages[1].addBinding(form.size.random, 'x', { label: 'Random X', min: 0, max: 1, step: 0.01 }).on('change', () => { if (isReady) createForms(); });
const sizeRandY = ftab.pages[1].addBinding(form.size.random, 'y', { label: 'Random Y', min: 0, max: 1, step: 0.01 }).on('change', () => { if (isReady) createForms(); });
ftab.pages[1].addBinding(form.size, 'seed', { label: 'Size Seed', min: 0, max: cnv.seed.max, step: 1 }).on('change', () => { if (isReady) createForms(); });

// OFF
ftab.pages[2].addBinding(form.offset, 'x', { label: 'Offset X', min: -1, max: 1, step: 0.01 });
ftab.pages[2].addBinding(form.offset, 'y', { label: 'Offset Y', min: -1, max: 1, step: 0.01 });
ftab.pages[2].addBinding(form.offset, 'random', { label: 'Random Level', min: 0, max: 1, step: 0.01 });
ftab.pages[2].addBinding(form.offset, 'seed', { label: 'Offset Seed', min: 0, max: cnv.seed.max, step: 1 }).on('change', () => { if (isReady) createForms(); });

// ANG
ftab.pages[3].addBinding(form.angle, 'range', { label: 'Base Angle', min: -180, max: 180, step: 1 });
ftab.pages[3].addBinding(form.angle, 'mode', { label: 'Random Mode', options: ANGLE_OPTS }).on('change', () => { angleUI(); if (isReady) createForms(); });
const angleRand = ftab.pages[3].addBinding(form.angle, 'random', { label: 'Random Level', min: 0, max: 1, step: 0.01 }).on('change', () => { if (isReady) createForms(); });
ftab.pages[3].addBinding(form.angle, 'seed', { label: 'Angle Seed', min: 0, max: cnv.seed.max, step: 1 }).on('change', () => { if (isReady) createForms(); });

// BLUR
ftab.pages[4].addBinding(form.blur.range, 'min', { label: 'Blur Min', min: 0, max: form.blur.max, step: 1 }).on('change', () => { if (isReady) createForms(); });
ftab.pages[4].addBinding(form.blur.range, 'max', { label: 'Blur Max', min: 0, max: form.blur.max, step: 1 }).on('change', () => { if (isReady) createForms(); });
ftab.pages[4].addBinding(form.blur, 'freq', { label: 'Frequency', min: 0, max: 1, step: 0.01 });
ftab.pages[4].addBinding(form.blur, 'seed', { label: 'Blur Seed', min: 0, max: cnv.seed.max, step: 1 }).on('change', () => { if (isReady) createForms(); });

// COL (blend = colour spread)
ftab.pages[5].addBinding(form.blend.range, 'min', { label: 'Colour Min', min: 0, max: 1, step: 0.01 });
ftab.pages[5].addBinding(form.blend.range, 'max', { label: 'Colour Max', min: 0, max: 1, step: 0.01 });
ftab.pages[5].addBinding(form.blend, 'freq', { label: 'Frequency', min: 0, max: 1, step: 0.01 });
ftab.pages[5].addBinding(form.blend, 'seed', { label: 'Colour Seed', min: 0, max: cnv.seed.max, step: 1 }).on('change', () => { if (isReady) createForms(); });

// PALETTE
const fPal = main.addFolder({ title: 'PALETTE', expanded: false });
fPal.addBinding(palette, 'type', { label: 'Palette Type', options: PALETTE_OPTS }).on('change', () => { paletteUI(); if (isReady) { updateColorBG(); } });
const genFolder = fPal.addFolder({ title: 'Procedural (cosine)', expanded: false });
const axMin = -palette.max, axMax = palette.max;
genFolder.addBinding(palette, 'offset', { label: 'Offset', x: { min: axMin, max: axMax, step: 0.01 }, y: { min: axMin, max: axMax, step: 0.01 }, z: { min: axMin, max: axMax, step: 0.01 } }).on('change', () => { if (isReady) updateColorBG(); });
genFolder.addBinding(palette, 'amp', { label: 'Amplify', x: { min: axMin, max: axMax, step: 0.01 }, y: { min: axMin, max: axMax, step: 0.01 }, z: { min: axMin, max: axMax, step: 0.01 } }).on('change', () => { if (isReady) updateColorBG(); });
genFolder.addBinding(palette, 'freq', { label: 'Freq', x: { min: axMin, max: axMax, step: 0.01 }, y: { min: axMin, max: axMax, step: 0.01 }, z: { min: axMin, max: axMax, step: 0.01 } }).on('change', () => { if (isReady) updateColorBG(); });
genFolder.addBinding(palette, 'phase', { label: 'Phase', x: { min: -1, max: 1, step: 0.01 }, y: { min: -1, max: 1, step: 0.01 }, z: { min: -1, max: 1, step: 0.01 } }).on('change', () => { if (isReady) updateColorBG(); });
genFolder.addButton({ title: 'Random Procedural' }).on('click', () => { randomColors(); tool.pane.refresh(); if (isReady) updateColorBG(); });
const customFolder = fPal.addFolder({ title: 'Custom Colours', expanded: false });
attachPaletteControls(customFolder, { palette: palette.custom, pane: tool.pane, onChange: () => { if (isReady) updateColorBG(); } });

// POST
const fPost = main.addFolder({ title: 'POST', expanded: false });
fPost.addBinding(post.blur, 'radius', { label: 'Fullscreen Blur', min: 0, max: 10, step: 0.1 });
fPost.addBinding(post.color, 'brightness', { label: 'Brightness', min: -0.5, max: 0.5, step: 0.01 });
fPost.addBinding(post.color, 'contrast', { label: 'Contrast', min: 0, max: 3, step: 0.01 });
fPost.addBinding(post.grain, 'scale', { label: 'Grain Scale', min: 0.5, max: 2, step: 0.01 }).on('change', () => { grainW = grainH = 0; });
fPost.addBinding(post.grain, 'opacity', { label: 'Grain Opacity', min: 0, max: 1, step: 0.01 });
fPost.addBinding(post.grain, 'brightness', { label: 'Grain Bright', min: 0.1, max: 1, step: 0.01 });
fPost.addBinding(post.grain, 'contrast', { label: 'Grain Contrast', min: 0.1, max: 1, step: 0.01 });
fPost.addBinding(post.grain, 'freq', { label: 'Grain Freq', min: 0, max: 1, step: 0.01 });

// ---- conditional-visibility helpers ----
function backUI() { bgColor.hidden = palette.bg.type !== 'custom'; }
function paletteUI() { genFolder.hidden = palette.type !== 'generative'; customFolder.hidden = palette.type !== 'custom'; }
function formUI() { sortCtl.hidden = svgSeed.hidden = !(form.type === 'custom' && svg.shape.length > 1); cornersUI(); }
function cornersUI() {
  const isForm = form.type === 'form';
  cornerType.hidden = !isForm;
  cornerLevel.hidden = !(isForm && form.corners.type === 'uniform');
  cornerSeed.hidden = !(isForm && form.corners.type === 'random');
}
function sizeUI() {
  const uni = form.size.type === 'uniform';
  sizeUni.hidden = !uni; sizeMul.hidden = uni; sizeMulY.hidden = uni;
  sizeRandY.hidden = form.size.random.mode !== 'independent';
}
function angleUI() { angleRand.hidden = form.angle.mode !== 'random'; }

/////////////////////////////////////////////////////////////////////////////
// Randomizers (port of random.js, eased the same way)
/////////////////////////////////////////////////////////////////////////////
const rmax = cnv.seed.max;
const R = Math.random;
function randomCount() {
  form.corners.seed = (R() * rmax) | 0; svg.seed = (R() * rmax) | 0;
  form.corners.type = R() < 0.5 ? 'random' : 'uniform';
  form.corners.level = R() <= 0.5 ? 0 : 100;
  if (R() > 0.5) form.corners.level = map2(R(), 0, 1, 0, 100, 'Quadratic', 0);
  form.count.x = floor(map2(R(), 0, 1, 1, form.count.max, 'Sqrt', 2));
  form.count.y = R() < 0.5 ? form.count.x : floor(map2(R(), 0, 1, 1, form.count.max, 'Sqrt', 2));
}
function randomSize() {
  form.size.type = R() < 0.5 ? 'uniform' : R() < 0.5 ? 'canvas' : 'default';
  form.size.seed = (R() * rmax) | 0;
  form.size.random.mode = R() < 0.5 ? 'independent' : 'uniform';
  form.size.random.x = R() < 0.25 ? 0 : map2(R(), 0, 1, 0, 1, 'Quadratic', 1);
  form.size.random.y = R() < 0.25 ? 0 : map2(R(), 0, 1, 0, 1, 'Quadratic', 1);
  form.size.uni = R() < 0.2 ? 1 : R() * 2; form.size.x = R() < 0.2 ? 1 : R() * 2; form.size.y = R() < 0.2 ? 1 : R() * 2;
}
function randomAngle() {
  form.angle.mode = R() < 0.3 ? 'right' : 'random'; form.angle.seed = (R() * rmax) | 0;
  form.angle.range = R() < 0.5 ? 0 : R() * 360 - 180; form.angle.random = R() < 0.5 ? 0 : R();
}
function randomOffset() {
  form.offset.seed = (R() * rmax) | 0;
  form.offset.random = R() < 0.25 ? 0 : map2(R(), 0, 1, 0, 1, 'Sqrt', 2);
  form.offset.x = R() < 0.1 ? 0 : map2(R(), 0, 1, 0, -1, 'Circular', 0);
  form.offset.y = R() < 0.1 ? 0 : map2(R(), 0, 1, 0, -1, 'Circular', 0);
}
function randomBlur() {
  form.blur.seed = (R() * rmax) | 0;
  form.blur.range.max = map2(R(), 0, 1, 2, form.blur.max - 30, 'Sqrt', 2);
  form.blur.range.min = form.blur.range.max === 0 ? 0 : map2(R(), 0, 1, 0, form.blur.range.max, 'Quintic', 0);
  form.blur.freq = form.blur.range.max === 0 ? 0 : R() < 0.1 ? 0 : R();
}
function randomBlend() {
  form.blend.seed = (R() * rmax) | 0;
  form.blend.range.max = map2(R(), 0, 1, 0, 1, 'Sqrt', 2);
  form.blend.range.min = R() < 0.2 ? 0 : map2(R(), 0, 1, 0, form.blend.range.max, 'Quintic', 0);
  form.blend.freq = form.blend.range.max === 0 ? 0 : R() < 0.2 ? 0 : R();
}
function randomColors() {
  const r4 = () => (R() < 0.4 ? 0.1 + R() * 0.8 : 0.5);
  palette.offset.x = r4(); palette.offset.y = r4(); palette.offset.z = r4();
  palette.amp.x = r4(); palette.amp.y = r4(); palette.amp.z = r4();
  palette.freq.x = R() * map2(R(), 0, 1, 0, HALF_PI, 'Sqrt', 0);
  palette.freq.y = R() * map2(R(), 0, 1, 0, HALF_PI, 'Sqrt', 0);
  palette.freq.z = R() * map2(R(), 0, 1, 0, HALF_PI, 'Sqrt', 0);
  palette.phase.x = R() * 2 - 1; palette.phase.y = R() * 2 - 1; palette.phase.z = R() * 2 - 1;
}
function randomParams() {
  cnv.seed.base = (R() * rmax) | 0;
  cnv.ratio = R() < 0.5 ? '1:1' : Object.keys(RATIOS)[(R() * 11) | 0];
  const bl = Object.keys(BLEND_OPS);
  cnv.blend = R() < 0.5 ? (R() < 0.5 ? 'BLEND' : 'SOFT_LIGHT') : bl[(R() * bl.length) | 0];
  randomCount(); randomSize(); randomOffset(); randomAngle(); randomBlur(); randomBlend(); randomColors();
}

/////////////////////////////////////////////////////////////////////////////
// Presets (original names + palettes; numeric configs in the reference's taxonomy)
/////////////////////////////////////////////////////////////////////////////
const presets = {
  'Prism Stacks': {
    cnv: { ratio: '3:4', blend: 'EXCLUSION', scale: { x: 0, y: 0 }, seed: { base: 5818 } },
    form: {
      type: 'form', count: { x: 1, y: 6 }, corners: { type: 'uniform', seed: 3023, level: 100 },
      size: { type: 'default', seed: 4112, random: { mode: 'independent', x: 1, y: 1 }, uni: 1, x: 2, y: 2 },
      angle: { mode: 'random', seed: 200, random: 0, range: 90 },
      offset: { seed: 1561, random: 0, x: 0, y: -0.2 },
      blur: { seed: 5668, freq: 0.12, range: { min: 26, max: 100 } },
      blend: { seed: 6080, freq: 0.35, range: { min: 0, max: 1 } },
    },
    post: { blur: { radius: 0 }, color: { brightness: 0, contrast: 1 }, grain: { scale: 0.6, opacity: 0.2, brightness: 0.75, contrast: 0.4, freq: 0.1 } },
    palette: { type: 'generative', offset: { x: 0.8, y: 0.7, z: 0.6 }, amp: { x: 0.6, y: 0.8, z: 0.6 }, freq: { x: 0.43, y: 0.31, z: 1.5 }, phase: { x: -0.4, y: 0.08, z: -0.38 } },
  },
  'Soft Meridian': {
    cnv: { ratio: '1:1', blend: 'SOFT_LIGHT', seed: { base: 2381 } },
    form: {
      type: 'form', count: { x: 4, y: 4 }, corners: { type: 'random', seed: 812, level: 0 },
      size: { type: 'canvas', seed: 41, random: { mode: 'uniform', x: 0.35, y: 0 }, uni: 1.2, x: 1.2, y: 1.2 },
      angle: { mode: 'random', seed: 530, random: 0.3, range: 0 },
      offset: { seed: 77, random: 0.4, x: -0.3, y: -0.3 },
      blur: { seed: 312, freq: 0.2, range: { min: 10, max: 90 } },
      blend: { seed: 25, freq: 0.25, range: { min: 0, max: 0.7 } },
    },
    post: { blur: { radius: 1.2 }, color: { brightness: 0.04, contrast: 1.05 }, grain: { scale: 0.7, opacity: 0.18, brightness: 0.6, contrast: 0.3, freq: 0.1 } },
    palette: { type: 'generative', offset: { x: 0.5, y: 0.5, z: 0.5 }, amp: { x: 0.5, y: 0.5, z: 0.5 }, freq: { x: 1, y: 1, z: 1 }, phase: { x: 0, y: 0.1, z: 0.2 } },
  },
  'Citrus Haze': {
    cnv: { ratio: '5:4', blend: 'MULTIPLY', seed: { base: 7714 } },
    form: {
      type: 'form', count: { x: 5, y: 5 }, corners: { type: 'uniform', seed: 100, level: 100 },
      size: { type: 'uniform', seed: 9, random: { mode: 'uniform', x: 0.2, y: 0 }, uni: 1, x: 1, y: 1 },
      angle: { mode: 'random', seed: 200, random: 0, range: 0 },
      offset: { seed: 10, random: 0, x: -0.2, y: -0.2 },
      blur: { seed: 88, freq: 0.1, range: { min: 0, max: 60 } },
      blend: { seed: 25, freq: 0.18, range: { min: 0, max: 0.55 } },
    },
    post: { blur: { radius: 0 }, color: { brightness: 0, contrast: 1.1 }, grain: { scale: 0.8, opacity: 0.22, brightness: 0.5, contrast: 0.35, freq: 0.12 } },
    palette: { type: 'custom', custom: { array: ['#3c2706', '#cc3904', '#e5cf0a', '#f3a712', '#faf5c6'] } },
  },
  'Indigo Drift': {
    cnv: { ratio: '4:5', blend: 'SCREEN', seed: { base: 1290 } },
    form: {
      type: 'form', count: { x: 3, y: 7 }, corners: { type: 'random', seed: 444, level: 0 },
      size: { type: 'default', seed: 61, random: { mode: 'independent', x: 0.6, y: 0.2 }, uni: 1, x: 1.4, y: 1.4 },
      angle: { mode: 'random', seed: 71, random: 0.15, range: 0 },
      offset: { seed: 23, random: 0.5, x: -0.4, y: -0.4 },
      blur: { seed: 19, freq: 0.3, range: { min: 20, max: 110 } },
      blend: { seed: 9, freq: 0.4, range: { min: 0, max: 0.9 } },
    },
    post: { blur: { radius: 0.6 }, color: { brightness: 0, contrast: 1 }, grain: { scale: 0.9, opacity: 0.2, brightness: 0.55, contrast: 0.4, freq: 0.08 } },
    palette: { type: 'custom', custom: { array: ['#0b132b', '#1c2541', '#3a506b', '#5bc0be', '#e8fbff'] } },
  },
  'Solar Tiles': {
    cnv: { ratio: '1:1', blend: 'BLEND', seed: { base: 333 } },
    form: {
      type: 'form', count: { x: 8, y: 8 }, corners: { type: 'uniform', seed: 100, level: 22 },
      size: { type: 'canvas', seed: 12, random: { mode: 'independent', x: 0.3, y: 0.3 }, uni: 1, x: 1, y: 1 },
      angle: { mode: 'right', seed: 200, random: 0, range: 0 },
      offset: { seed: 10, random: 0, x: 0, y: 0 },
      blur: { seed: 5, freq: 0.05, range: { min: 0, max: 30 } },
      blend: { seed: 25, freq: 0.1, range: { min: 0, max: 0.5 } },
    },
    post: { blur: { radius: 0 }, color: { brightness: 0.05, contrast: 1.15 }, grain: { scale: 0.65, opacity: 0.16, brightness: 0.65, contrast: 0.5, freq: 0.1 } },
    palette: { type: 'generative', offset: { x: 0.5, y: 0.4, z: 0.3 }, amp: { x: 0.5, y: 0.5, z: 0.5 }, freq: { x: 1, y: 1.2, z: 0.8 }, phase: { x: 0, y: 0.15, z: 0.3 } },
  },
  'Velvet Bloom': {
    cnv: { ratio: '1:1', blend: 'SOFT_LIGHT', seed: { base: 6042 } },
    form: {
      type: 'form', count: { x: 2, y: 2 }, corners: { type: 'random', seed: 901, level: 0 },
      size: { type: 'default', seed: 5, random: { mode: 'uniform', x: 0.5, y: 0 }, uni: 1.6, x: 1.6, y: 1.6 },
      angle: { mode: 'random', seed: 211, random: 0.5, range: 0 },
      offset: { seed: 31, random: 0.6, x: -0.5, y: -0.5 },
      blur: { seed: 50, freq: 0.4, range: { min: 30, max: 130 } },
      blend: { seed: 25, freq: 0.5, range: { min: 0, max: 1 } },
    },
    post: { blur: { radius: 2 }, color: { brightness: 0, contrast: 1 }, grain: { scale: 0.75, opacity: 0.2, brightness: 0.5, contrast: 0.3, freq: 0.06 } },
    palette: { type: 'custom', custom: { array: ['#1a0b2e', '#7b2cbf', '#c77dff', '#ff7675', '#ffd6ff'] } },
  },
};

function deepMerge(dst, src) {
  for (const k of Object.keys(src)) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) { dst[k] = dst[k] || {}; deepMerge(dst[k], src[k]); }
    else dst[k] = src[k];
  }
}
function resetToDefaults() {
  deepMerge(cnv, structuredClone(DEFAULTS.cnv));
  deepMerge(form, structuredClone(DEFAULTS.form));
  deepMerge(post, structuredClone(DEFAULTS.post));
  deepMerge(palette, structuredClone(DEFAULTS.palette));
  svg.shape = [];
}
// Accepts a preset name, or any config object of the same shape.
function applyPreset(name) {
  const pr = typeof name === 'string' ? presets[name] : name;
  if (!pr) return;
  resetToDefaults();
  if (pr.cnv) deepMerge(cnv, pr.cnv);
  if (pr.form) deepMerge(form, pr.form);
  if (pr.post) deepMerge(post, pr.post);
  if (pr.svg) { if (pr.svg.seed != null) svg.seed = pr.svg.seed; if (pr.svg.sort) svg.sort = pr.svg.sort; if (Array.isArray(pr.svg.shape)) svg.shape = pr.svg.shape.map((s) => ({ ...s, path: Array.isArray(s.path) ? s.path.join(' ') : s.path })); }
  if (pr.palette) {
    if (pr.palette.type) palette.type = pr.palette.type;
    if (pr.palette.custom?.array) pr.palette.custom.array.forEach((c, i) => { palette.custom.array[i] = c; });
    ['offset', 'amp', 'freq', 'phase'].forEach((k) => { if (pr.palette[k]) deepMerge(palette[k], pr.palette[k]); });
    if (pr.palette.bg) deepMerge(palette.bg, pr.palette.bg);
  }
  cnv.frame = pr.cnv?.frame ?? 0;
  if (P) updateCanvas();
  backUI(); paletteUI(); formUI(); cornersUI(); sizeUI(); angleUI();
  tool.pane.refresh();
}

/////////////////////////////////////////////////////////////////////////////
// Export + OPTIONS (presets / animate / randomize / fullscreen)
/////////////////////////////////////////////////////////////////////////////
attachExport(tool.pages.export, { getCanvas: tool.getCanvas, name: 'bluur' });

const presetState = { name: 'Prism Stacks' };
const opts = tool.pages.options;
opts.addBinding(presetState, 'name', { label: 'Preset', options: Object.fromEntries(Object.keys(presets).map((k) => [k, k])) }).on('change', (ev) => applyPreset(ev.value));
opts.addButton({ title: 'Apply / Restart Preset' }).on('click', () => applyPreset(presetState.name));
opts.addButton({ title: 'Randomize All' }).on('click', () => { randomParams(); if (isReady) createForms(); backUI(); paletteUI(); formUI(); cornersUI(); sizeUI(); angleUI(); tool.pane.refresh(); });
opts.addBinding(cnv, 'animation', { label: 'Animate' }).on('change', () => { cnv.frame = 0; });
opts.addButton({ title: 'Fullscreen (f)' }).on('click', () => tool.toggleFullscreen());

window.addEventListener('resize', () => { if (isReady) updateCanvas(); });
// Dev hook — drive presets / inspect state / feed in external preset objects.
exposeDebug('bluur', { applyPreset, createForms, randomParams, cnv, form, post, palette, svg, presets, setFrame: (f) => { cnv.frame = f; } });

// Bootstrap the opening preset on the first draw tick (p5 setup may run sync or
// async on the shell; defer so P/forms are initialised first — see BOIDS note).
backUI(); paletteUI(); formUI(); cornersUI(); sizeUI(); angleUI();
pendingPreset = 'Prism Stacks';
