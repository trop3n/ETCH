// SHAPES — media resolved into a grid of shapes by luminance. Each cell samples the
// source, buckets its brightness into one of seven TONE SLOTS, and stamps that
// slot's shape in that slot's colour — so shadows and highlights can be different
// forms, not just different sizes of the same one. Slots take an uploaded SVG or
// one of eight built-ins; per-cell size interpolates with brightness, and rotation
// can be a global 90° snap or randomised per cell.
//
// This is the Etch-stack port of the original raster `shapes` tool: its grid,
// brightness/contrast, diversity (luminance-driven rotation), simplification
// (quantised size steps) and all eight built-in shapes are carried over. The
// seven-slot tone ramp, per-slot SVG upload, scale range and 90° rotation follow
// the MIT-licensed svg-dither-filter by MG Productions
// (https://github.com/mgmaik/svg-dither-filter) — original idea antoncreations.
//
// No libraries: plain Canvas2D on a bare mounted canvas.
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachPresets } from '../../js/etch/presets.js';
import { attachExport } from '../../js/etch/export.js';

/////////////////////////////////////////////////////////////////////////////
// Taxonomy
/////////////////////////////////////////////////////////////////////////////
const SHAPE_OPTS = {
  Circle: 'circle', Square: 'square', Triangle: 'triangle', Diamond: 'diamond',
  Line: 'line', Cross: 'cross', Ring: 'ring', Hexagon: 'hexagon',
};
const ASPECTS = { Original: 'orig', '1:1': 'square' };
const MODES = { 'Per-tone (7)': 'tone', 'Single shape': 'single' };
const ROTS = { '0°': 0, '90°': 90, '180°': 180, '270°': 270 };
const SLOTS = 7;

// Slot 1 = shadow, slot 7 = highlight. Defaults walk shape AND value together so
// the seven-slot idea is visible the moment the tool opens.
const DEFAULT_SLOTS = [
  { shape: 'circle', color: '#12131a' },
  { shape: 'diamond', color: '#33374d' },
  { shape: 'square', color: '#5a5f7d' },
  { shape: 'hexagon', color: '#8388a6' },
  { shape: 'triangle', color: '#adb2c9' },
  { shape: 'ring', color: '#d2d6e6' },
  { shape: 'cross', color: '#f2f4fb' },
];

/////////////////////////////////////////////////////////////////////////////
// State
/////////////////////////////////////////////////////////////////////////////
const params = {
  aspect: 'orig', grid: 64, bg: '#0b0b0f',
  invert: false, mode: 'tone', single: 0,
  sMin: 25, sMax: 100,
  rot: 0, rndRot: false,
  brightness: 0, contrast: 0, diversity: 0, simplify: 0,
  slots: structuredClone(DEFAULT_SLOTS),
};
const DEFAULTS = structuredClone(params);

const tool = createTool({ name: 'SHAPES', version: '0.2' });
const cnv = tool.mountCanvas();
const ctx = cnv.getContext('2d');

tool.canvasHost.style.display = 'flex';
tool.canvasHost.style.alignItems = 'center';
tool.canvasHost.style.justifyContent = 'center';
cnv.style.width = 'auto';
cnv.style.height = 'auto';
cnv.style.maxWidth = '100%';
cnv.style.maxHeight = '100%';

const sample = document.createElement('canvas');
const sctx = sample.getContext('2d', { willReadFrequently: true });

let media = null, isVideo = false, camStream = null;
const slotSVG = new Array(SLOTS).fill(null);   // raw SVG text per slot, or null
const cache = new Array(SLOTS).fill(null);     // pre-rasterised, pre-coloured canvas
let cacheDirty = true;

/////////////////////////////////////////////////////////////////////////////
// Built-in shapes — carried over from the original raster tool
/////////////////////////////////////////////////////////////////////////////
function pathShape(c, shape, r) {
  c.beginPath();
  switch (shape) {
    case 'circle': c.arc(0, 0, r, 0, Math.PI * 2); break;
    case 'square': c.rect(-r, -r, r * 2, r * 2); break;
    case 'triangle':
      c.moveTo(0, -r); c.lineTo(r * 0.866, r * 0.5); c.lineTo(-r * 0.866, r * 0.5); c.closePath(); break;
    case 'diamond':
      c.moveTo(0, -r); c.lineTo(r, 0); c.lineTo(0, r); c.lineTo(-r, 0); c.closePath(); break;
    case 'line': c.moveTo(-r, 0); c.lineTo(r, 0); break;
    case 'cross': {
      const w = r * 0.3;
      c.moveTo(-w, -r); c.lineTo(w, -r); c.lineTo(w, -w); c.lineTo(r, -w);
      c.lineTo(r, w); c.lineTo(w, w); c.lineTo(w, r); c.lineTo(-w, r);
      c.lineTo(-w, w); c.lineTo(-r, w); c.lineTo(-r, -w); c.lineTo(-w, -w);
      c.closePath(); break;
    }
    case 'ring':
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.moveTo(r * 0.5, 0);
      c.arc(0, 0, r * 0.5, 0, Math.PI * 2, true);
      break;
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        c[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath(); break;
  }
}

/////////////////////////////////////////////////////////////////////////////
// Slot rasterisation — each slot becomes one pre-coloured canvas that the render
// loop blits per cell. Far cheaper than re-filling a path thousands of times.
/////////////////////////////////////////////////////////////////////////////
const RASTER = 96;

function rasterBuiltin(shape, color) {
  const c = document.createElement('canvas');
  c.width = c.height = RASTER;
  const g = c.getContext('2d');
  g.translate(RASTER / 2, RASTER / 2);
  const r = RASTER * 0.46;
  if (shape === 'line') {
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, r * 0.3);
    pathShape(g, shape, r);
    g.stroke();
  } else {
    g.fillStyle = color;
    pathShape(g, shape, r);
    g.fill();
  }
  return c;
}

// Colour is applied by overriding fill, so an SVG defined purely by stroke will
// not pick up the slot colour — same limitation the reference documents.
function recolorSVG(src, color) {
  let s = src.replace(/fill\s*=\s*"(?!none)[^"]*"/gi, `fill="${color}"`);
  s = s.replace(/fill\s*:\s*(?!none)[^;"']+/gi, `fill:${color}`);
  if (!/fill\s*=/.test(s)) s = s.replace(/<svg/i, `<svg fill="${color}"`);
  return s;
}

function rasterSVG(src, color) {
  return new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = c.height = RASTER;
    const g = c.getContext('2d');
    const blob = new Blob([recolorSVG(src, color)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(RASTER / img.width, RASTER / img.height) * 0.92;
      const w = img.width * s, h = img.height * s;
      g.drawImage(img, (RASTER - w) / 2, (RASTER - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function rebuildSlot(i) {
  const sl = params.slots[i];
  if (slotSVG[i]) {
    const c = await rasterSVG(slotSVG[i], sl.color);
    cache[i] = c || rasterBuiltin('circle', sl.color);
  } else {
    cache[i] = rasterBuiltin(sl.shape, sl.color);
  }
}

async function rebuildAll() {
  for (let i = 0; i < SLOTS; i++) await rebuildSlot(i);
  cacheDirty = false;
}

/////////////////////////////////////////////////////////////////////////////
// Source
/////////////////////////////////////////////////////////////////////////////
function mediaSize() {
  if (!media) return [0, 0];
  return isVideo ? [media.videoWidth, media.videoHeight] : [media.naturalWidth || media.width, media.naturalHeight || media.height];
}

// Procedural default so the tool shows something before anything is loaded.
function makeDefault() {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 600;
  const g = c.getContext('2d');
  const lin = g.createLinearGradient(0, 0, 900, 600);
  lin.addColorStop(0, '#07131f'); lin.addColorStop(0.5, '#2a4d6e'); lin.addColorStop(1, '#e8dcc0');
  g.fillStyle = lin; g.fillRect(0, 0, 900, 600);
  for (let i = 0; i < 16; i++) {
    const x = Math.random() * 900, y = Math.random() * 600, r = 50 + Math.random() * 160;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `hsla(${Math.random() * 60 + 180},70%,70%,0.5)`);
    rg.addColorStop(1, 'transparent');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return c;
}

function stopCamera() {
  if (camStream) camStream.getTracks().forEach((t) => t.stop());
  camStream = null;
}

function loadFile(file) {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('video')) {
    const v = document.createElement('video');
    v.src = url; v.loop = true; v.muted = true; v.playsInline = true;
    v.onloadeddata = () => { stopCamera(); media = v; isVideo = true; v.play().catch(() => {}); };
  } else {
    const img = new Image();
    img.onload = () => { stopCamera(); media = img; isVideo = false; URL.revokeObjectURL(url); };
    img.src = url;
  }
}

function pickFile(accept, cb) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
  inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; if (f) cb(f); inp.remove(); });
  document.body.appendChild(inp);
  inp.click();
}

tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && (f.type.startsWith('image/') || f.type.startsWith('video/'))) loadFile(f);
});

/////////////////////////////////////////////////////////////////////////////
// Render
/////////////////////////////////////////////////////////////////////////////
function render() {
  if (!media || cacheDirty) return;
  const [mw, mh] = mediaSize();
  if (!mw || !mh) return;

  // aspect crop
  let cx = 0, cy = 0, cw = mw, chh = mh;
  if (params.aspect === 'square') {
    const s = Math.min(mw, mh);
    cx = (mw - s) / 2; cy = (mh - s) / 2; cw = s; chh = s;
  }
  const ar = cw / chh;
  const cols = Math.max(4, Math.min(160, Math.round(params.grid)));
  const rows = Math.max(1, Math.round(cols / ar));

  const maxDim = 1100;
  const cell = Math.max(2, Math.floor((ar >= 1 ? maxDim : maxDim * ar) / cols));
  const outW = cols * cell, outH = rows * cell;
  if (cnv.width !== outW || cnv.height !== outH) { cnv.width = outW; cnv.height = outH; }

  if (sample.width !== cols || sample.height !== rows) { sample.width = cols; sample.height = rows; }
  sctx.clearRect(0, 0, cols, rows);
  sctx.drawImage(media, cx, cy, cw, chh, 0, 0, cols, rows);
  const data = sctx.getImageData(0, 0, cols, rows).data;

  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, outW, outH);

  const bAdd = params.brightness * 2.55;
  const cVal = params.contrast;
  const cf = (259 * (cVal + 255)) / (255 * (259 - cVal));
  const minS = params.sMin / 100, maxS = params.sMax / 100;
  const div = params.diversity / 100;
  const simp = params.simplify / 100;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p = (y * cols + x) * 4;
      const a = data[p + 3] / 255;
      let r = data[p] + bAdd, g = data[p + 1] + bAdd, b = data[p + 2] + bAdd;
      r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128;
      r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
      let t = (0.299 * r + 0.587 * g + 0.114 * b) / 255 * a;   // transparent reads as shadow
      if (params.invert) t = 1 - t;

      const bucket = Math.min(SLOTS - 1, Math.max(0, Math.floor(t * SLOTS)));
      const idx = params.mode === 'single' ? params.single : bucket;
      const shp = cache[idx];
      if (!shp) continue;

      // simplification quantises the size ramp into visible steps
      const st = simp > 0 ? Math.round(t * (1 / simp)) * simp : t;
      const scale = (minS + (maxS - minS) * st) * cell;
      if (scale <= 0.4) continue;

      let ang = params.rot;
      if (params.rndRot) ang = ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 4) * 90;
      // diversity adds the original tool's continuous luminance-driven twist
      const rad = ang * Math.PI / 180 + div * (t - 0.5) * Math.PI;

      ctx.save();
      ctx.translate(x * cell + cell / 2, y * cell + cell / 2);
      if (rad) ctx.rotate(rad);
      ctx.drawImage(shp, -scale / 2, -scale / 2, scale, scale);
      ctx.restore();
    }
  }
}

function loop() {
  render();
  requestAnimationFrame(loop);
}

media = makeDefault();
isVideo = false;
rebuildAll().then(() => requestAnimationFrame(loop));

/////////////////////////////////////////////////////////////////////////////
// UI
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;

const fSrc = main.addFolder({ title: 'SOURCE' });
fSrc.addButton({ title: 'Load Image / Video…' }).on('click', () => pickFile('image/*,video/*', loadFile));
const camBtn = fSrc.addButton({ title: 'Start Camera' });
camBtn.on('click', async () => {
  if (camStream) { stopCamera(); media = makeDefault(); isVideo = false; camBtn.title = 'Start Camera'; return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camBtn.title = 'No Camera'; return; }
  camBtn.title = 'Starting…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
    camStream = stream;
    const v = document.createElement('video');
    v.srcObject = stream; v.muted = true; v.playsInline = true; v.autoplay = true;
    v.onloadeddata = () => { media = v; isVideo = true; };
    v.play().catch(() => {});
    camBtn.title = 'Stop Camera';
  } catch (err) {
    console.warn('SHAPES: camera unavailable —', err && err.message);
    camBtn.title = 'Camera Denied';
  }
});
fSrc.addButton({ title: 'Reset Source' }).on('click', () => { stopCamera(); media = makeDefault(); isVideo = false; camBtn.title = 'Start Camera'; });
fSrc.addBinding(params, 'aspect', { label: 'Aspect', options: ASPECTS });

const fGrid = main.addFolder({ title: 'GRID' });
fGrid.addBinding(params, 'grid', { label: 'Resolution', min: 4, max: 160, step: 1 });
fGrid.addBinding(params, 'bg', { label: 'Background' });

const fTone = main.addFolder({ title: 'TONE MAPPING' });
fTone.addBinding(params, 'mode', { label: 'Shape Mode', options: MODES });
fTone.addBinding(params, 'single', { label: 'Single Slot', min: 0, max: 6, step: 1 });
fTone.addBinding(params, 'invert', { label: 'Invert' });
fTone.addBinding(params, 'sMin', { label: 'Scale Min %', min: 0, max: 200, step: 1 });
fTone.addBinding(params, 'sMax', { label: 'Scale Max %', min: 0, max: 200, step: 1 });

const fRot = main.addFolder({ title: 'ROTATION' });
fRot.addBinding(params, 'rot', { label: 'Angle', options: ROTS });
fRot.addBinding(params, 'rndRot', { label: 'Random 90° / cell' });
fRot.addBinding(params, 'diversity', { label: 'Diversity', min: 0, max: 100, step: 1 });

const fImg = main.addFolder({ title: 'IMAGE ADJUST', expanded: false });
fImg.addBinding(params, 'brightness', { label: 'Brightness', min: -100, max: 100, step: 1 });
fImg.addBinding(params, 'contrast', { label: 'Contrast', min: -100, max: 100, step: 1 });
fImg.addBinding(params, 'simplify', { label: 'Simplification', min: 0, max: 100, step: 1 });

// One folder per tone slot: shadow (1) -> highlight (7).
const fSlots = main.addFolder({ title: 'TONE SLOTS' });
for (let i = 0; i < SLOTS; i++) {
  const f = fSlots.addFolder({ title: `${i + 1}${i === 0 ? ' · shadow' : i === SLOTS - 1 ? ' · highlight' : ''}`, expanded: i < 2 });
  f.addBinding(params.slots[i], 'shape', { label: 'Shape', options: SHAPE_OPTS })
    .on('change', () => { slotSVG[i] = null; rebuildSlot(i); });
  f.addBinding(params.slots[i], 'color', { label: 'Colour' }).on('change', () => rebuildSlot(i));
  f.addButton({ title: 'Upload SVG…' }).on('click', () => {
    pickFile('image/svg+xml,.svg', async (file) => { slotSVG[i] = await file.text(); await rebuildSlot(i); });
  });
  f.addButton({ title: 'Clear SVG' }).on('click', () => { slotSVG[i] = null; rebuildSlot(i); });
}
fSlots.addButton({ title: 'Grey Ramp' }).on('click', async () => {
  for (let i = 0; i < SLOTS; i++) {
    const v = Math.round(20 + (235 * i) / (SLOTS - 1));
    params.slots[i].color = '#' + v.toString(16).padStart(2, '0').repeat(3);
  }
  await rebuildAll();
  tool.pane.refresh();
});
fSlots.addButton({ title: 'All Circles' }).on('click', async () => {
  for (let i = 0; i < SLOTS; i++) { params.slots[i].shape = 'circle'; slotSVG[i] = null; }
  await rebuildAll();
  tool.pane.refresh();
});

/////////////////////////////////////////////////////////////////////////////
// Presets + export
/////////////////////////////////////////////////////////////////////////////
const ramp = (cols) => cols.map((c, i) => ({ shape: DEFAULT_SLOTS[i].shape, color: c }));

const presets = {
  'Ink Grade': {
    grid: 72, bg: '#f4f1e8', sMin: 15, sMax: 105, mode: 'tone', invert: true,
    slots: ramp(['#0a0a0a', '#242424', '#3d3d3d', '#585858', '#787878', '#a0a0a0', '#c8c8c8']),
  },
  'Cyan Plate': {
    grid: 96, bg: '#02121a', sMin: 30, sMax: 120, rndRot: true,
    slots: ramp(['#04222e', '#0a4256', '#0f6b85', '#1a9bb0', '#3fc7d4', '#8ee6ec', '#e2fbfd']),
  },
  'Halftone Dots': {
    grid: 120, bg: '#ffffff', sMin: 0, sMax: 130, mode: 'single', single: 0,
    slots: ramp(['#101010', '#101010', '#101010', '#101010', '#101010', '#101010', '#101010']),
  },
  'Ember Grid': {
    grid: 56, bg: '#0d0503', sMin: 35, sMax: 110, rot: 90,
    slots: ramp(['#2a0d04', '#571a06', '#8c3208', '#c05a10', '#e08a1e', '#f2b755', '#ffe6b8']),
  },
  'Coarse Blocks': {
    grid: 28, bg: '#101216', sMin: 55, sMax: 100, rndRot: true, simplify: 25,
    slots: ramp(['#1b1e26', '#2f3442', '#4a5164', '#6b7389', '#9199ad', '#bcc2d2', '#eef1f8']),
  },
  'Contour Rings': {
    grid: 84, bg: '#07080c', sMin: 20, sMax: 140, mode: 'single', single: 5, diversity: 40,
    slots: ramp(['#12131a', '#33374d', '#5a5f7d', '#8388a6', '#adb2c9', '#d2d6e6', '#f2f4fb']),
  },
};

function applyPreset(name) {
  const pr = typeof name === 'string' ? presets[name] : name;
  if (!pr) return;
  Object.assign(params, structuredClone(DEFAULTS), structuredClone(pr));
  for (let i = 0; i < SLOTS; i++) slotSVG[i] = null;
  rebuildAll().then(() => tool.pane.refresh());
}

function randomize() {
  params.grid = 16 + Math.floor(Math.random() * 120);
  params.sMin = Math.floor(Math.random() * 60);
  params.sMax = 80 + Math.floor(Math.random() * 80);
  params.rndRot = Math.random() < 0.5;
  params.rot = [0, 90, 180, 270][Math.floor(Math.random() * 4)];
  params.invert = Math.random() < 0.3;
  const names = Object.values(SHAPE_OPTS);
  const h = Math.random();
  for (let i = 0; i < SLOTS; i++) {
    params.slots[i].shape = names[Math.floor(Math.random() * names.length)];
    const l = 8 + (i / (SLOTS - 1)) * 84;
    params.slots[i].color = `hsl(${Math.round((h + i * 0.02) * 360)},${40 + Math.random() * 40}%,${l}%)`;
    slotSVG[i] = null;
  }
  rebuildAll();
}

attachExport(tool.pages.export, { getCanvas: () => cnv, name: 'shapes' });
attachPresets(tool.pages.options, { pane: tool.pane, params, presets, randomize, onApply: applyPreset });

exposeDebug('shapes', {
  params, applyPreset, randomize, render, rebuildAll,
  grid: () => ({ w: cnv.width, h: cnv.height }),
  setSlotSVG: (i, src) => { slotSVG[i] = src; return rebuildSlot(i); },
  loadFile,
});
