// BIOM — organic generative blooms. A seeded set of "forms" each trace a
// Lissajous orbit (sin+cos of the form's random phase offsets, animated over a
// looped frame); every form is then stamped once per gradient LAYER, the layers
// fanning outward by a spacing multiplier and lerping in size from start→end, so
// each form becomes a nested concentric trail. Layer colour comes from an
// Inigo-Quilez-style sinusoidal palette (a base colour + per-channel phase
// offsets + a light point), optionally animated; a polar clip mask
// (ellipse/rect/triangle) bounds the field. p5 2D, looped animation.
//
// The graphics field is rendered on its own — no poster layout or type
// furniture around it.
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachExport } from '../../js/etch/export.js';

const { sin, cos, round, min, max, abs, PI, sign } = Math;
const TWO_PI = PI * 2;
const HALF_PI = PI / 2;
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const radians = (deg) => (deg * PI) / 180;

/////////////////////////////////////////////////////////////////////////////
// State — shaped like the reference so preset objects deep-merge cleanly.
// Colours are { r, g, b } (0..255), matching the engine maths + Tweakpane's
// auto-detected RGB color input.
/////////////////////////////////////////////////////////////////////////////
const cnv = { animation: true, frame: 0 };
const form = {
  seed: 720,
  type: 'ellipse',
  rotation: 0,
  amount: { live: 25, max: 200 },
  size: { level: 40, random: 0, start: 1, end: 0 },
  bg: { type: 'form-static', r: 255, g: 255, b: 255 },
};
const palette = {
  animation: 2,
  phase: 0,
  layers: { total: 16, max: 25, mult: 7 },
  lightness: 0,
  gradient: 10,
  color: { r: 255, g: 0, b: 0 },
  offset: { bg: 0, x: 0, y: 0, z: 0 },
};
const area = {
  speed: 2, phase: 0, radius: 50, constraint: 0, rotation: 0,
  space: { x: 0, y: 0 },
};
const clipping = { type: 'none', rotation: 0, width: 1, height: 1 };
const rec = { frameRate: 60, length: { value: 10, min: 1, max: 60 } };
const DEFAULTS = structuredClone({ cnv, form, palette, area, clipping });

const TYPE_OPTS = { Ellipse: 'ellipse', Rectangle: 'rectangle', Triangle: 'triangle' };
const CLIP_OPTS = { None: 'none', Ellipse: 'ellipse', Rectangle: 'rectangle', Triangle: 'triangle' };
const BG_OPTS = { 'Custom Color': 'custom', 'Form-Based Static': 'form-static', 'Form-Based Animated': 'form-animated' };

/////////////////////////////////////////////////////////////////////////////
// Runtime
/////////////////////////////////////////////////////////////////////////////
let P = null, displayCanvas = null, pendingPreset = null;
const GW = 760, GH = 760;
const forms = [];
let frame = 0;
const fd = {};

function makeForm() {
  // call order matches the reference Form() so a given seed reproduces it
  return {
    xoff: { x: P.random(-PI, PI), y: P.random(-PI, PI) },
    yoff: { x: P.random(-PI, PI), y: P.random(-PI, PI) },
    rotation: P.random(-HALF_PI, HALF_PI),
    size: P.random(0.1, 2),
    px: 0, py: 0,
  };
}
function createForms() {
  if (!P) return;
  P.randomSeed(form.seed);
  forms.length = 0;
  for (let i = 0; i < form.amount.live; i++) forms.push(makeForm());
}

/////////////////////////////////////////////////////////////////////////////
// Per-frame derived values (port of drawGraphics) + form orbit (port of coords)
/////////////////////////////////////////////////////////////////////////////
function computeFrameData() {
  frame = cnv.frame / (rec.length.value * rec.frameRate);

  const areaSpeed = area.speed === 0 ? 0 : min(area.speed, rec.length.value);
  const colorSpeed = palette.animation === 0 ? 0 : min(abs(palette.animation), rec.length.value);
  const speedSign = sign(palette.animation) < 0 ? -1 : 1;

  fd.areaSpeed = round(areaSpeed);
  fd.colorSpeed = round(colorSpeed) * speedSign;
  fd.areaPhase = map(area.phase, 0, 1, 0, TWO_PI);
  fd.colorPhase = map(palette.phase, 0, 1, 0, TWO_PI);
  fd.radius = map(area.radius, 0, 100, 0, max(GW, GH) * 0.33);
  fd.constraint = map(area.constraint, 0, 1, 1, 0);
  fd.xSpace = area.space.x <= 0 ? map(area.space.x, 0, -1, 1, 0) : map(area.space.x, 0, 1, 1, 4);
  fd.ySpace = area.space.y <= 0 ? map(area.space.y, 0, -1, 1, 0) : map(area.space.y, 0, 1, 1, 4);

  const pTotal = palette.layers.total;
  fd.layers = pTotal <= 14 ? pTotal * 3 : pTotal * palette.layers.mult;
  fd.gradMult = min(palette.gradient, fd.layers);
  fd.formSize = map(form.size.level, 0, 100, 0, min(GW, GH));
}

function orbit(f) {
  const t = TWO_PI * frame * fd.areaSpeed + fd.areaPhase;
  const xpos = sin(t + f.xoff.x) + cos(t + f.xoff.y);
  const ypos = sin(t + f.yoff.y) + cos(t + f.yoff.x);
  f.px = xpos * fd.radius * fd.constraint;
  f.py = ypos * fd.radius;
}

/////////////////////////////////////////////////////////////////////////////
// Render (port of drawForms)
/////////////////////////////////////////////////////////////////////////////
function drawStamp(f, size, posx, posy) {
  P.push();
  P.translate(f.px * posx, f.py * posy);
  const mult = map(form.size.random, 0, 1, 1, f.size);
  if (form.type === 'ellipse') {
    P.ellipse(0, 0, size * mult, size * mult);
  } else if (form.type === 'rectangle') {
    P.rotate(f.rotation * form.rotation);
    P.rect(0, 0, size * mult, size * mult);
  } else {
    P.rotate(f.rotation * form.rotation);
    P.triangle(0, (-size / 2) * mult, (size / 2) * mult, (size / 2) * mult, (-size / 2) * mult, (size / 2) * mult);
  }
  P.pop();
}

function drawForms() {
  P.push();
  P.translate(GW / 2, GH / 2);

  if (clipping.type !== 'none') {
    P.fill(0, 1);
    P.rect(0, 0, GW, GH);
    P.beginClip();
    P.push();
    P.rotate(radians(clipping.rotation));
    P.scale(clipping.width, clipping.height);
    if (clipping.type === 'ellipse') P.ellipse(0, 0, GW, GH);
    else if (clipping.type === 'rectangle') P.rect(0, 0, GW, GH);
    else P.triangle(0, -GH / 2, GW / 2, GH / 2, -GW / 2, GH / 2);
    P.pop();
    P.endClip();
  }

  P.rotate(radians(area.rotation));
  for (const f of forms) orbit(f);

  // Background
  if (form.bg.type === 'custom') {
    P.background(form.bg.r, form.bg.g, form.bg.b);
  } else {
    const frameColor = form.bg.type === 'form-static' ? 0 : frame;
    const bgOffset = palette.offset.bg * TWO_PI;
    const fs = TWO_PI * frameColor * fd.colorSpeed;
    const r = sin(bgOffset + palette.offset.x * TWO_PI + fs);
    const g = sin(bgOffset + palette.offset.y * TWO_PI + fs);
    const b = sin(bgOffset + palette.offset.z * TWO_PI + fs);
    P.background(
      map(r, -1, 1, palette.lightness * 255, palette.color.r),
      map(g, -1, 1, palette.lightness * 255, palette.color.g),
      map(b, -1, 1, palette.lightness * 255, palette.color.b)
    );
  }

  const startSize = map(form.size.start, 0, 1, 0, fd.formSize);
  const endSize = map(form.size.end, 0, 1, 0, fd.formSize);
  const L = fd.layers;

  for (let i = 0; i < L; i++) {
    const size = map(i, 0, L, startSize, endSize);
    const gradCount = i / (L - 1);
    const posx = map(i, 0, L, 1, fd.xSpace);
    const posy = map(i, 0, L, 1, fd.ySpace);

    const gradient = gradCount * fd.gradMult;
    const fs = TWO_PI * frame * fd.colorSpeed + fd.colorPhase;
    const r = map(sin(gradient + palette.offset.x * TWO_PI + fs), -1, 1, palette.lightness * 255, palette.color.r);
    const g = map(sin(gradient + palette.offset.y * TWO_PI + fs), -1, 1, palette.lightness * 255, palette.color.g);
    const b = map(sin(gradient + palette.offset.z * TWO_PI + fs), -1, 1, palette.lightness * 255, palette.color.b);
    P.fill(r, g, b);

    for (const f of forms) drawStamp(f, size, posx, posy);
  }
  P.pop();
}

/////////////////////////////////////////////////////////////////////////////
// Sketch
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'BIOM', version: '0.2' });

function fitCanvas() {
  if (!displayCanvas) return;
  const pad = 40;
  const k = min((window.innerWidth - pad * 2) / GW, (window.innerHeight - pad * 2) / GH);
  displayCanvas.elt.style.width = `${GW * k}px`;
  displayCanvas.elt.style.height = `${GH * k}px`;
}

tool.startSketch((p) => {
  p.setup = () => {
    P = p;
    tool.canvasHost.style.display = 'flex';
    tool.canvasHost.style.alignItems = 'center';
    tool.canvasHost.style.justifyContent = 'center';
    displayCanvas = p.createCanvas(GW, GH);
    p.pixelDensity(2);
    displayCanvas.elt.style.display = 'block';
    p.rectMode(p.CENTER);
    p.noStroke();
    p.imageMode(p.CENTER);
    fitCanvas();
    createForms();
  };
  p.draw = () => {
    if (pendingPreset !== null) { const n = pendingPreset; pendingPreset = null; applyPreset(n); return; }
    if (!P) return;
    p.clear();
    computeFrameData();
    drawForms();
    if (cnv.animation) frame >= 1 ? (cnv.frame = 0) : cnv.frame++;
  };
  p.windowResized = () => fitCanvas();
});

/////////////////////////////////////////////////////////////////////////////
// UI
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;
const onForms = () => { if (P) createForms(); };

main.addButton({ title: 'Restart Preset' }).on('click', () => applyPreset(presetState.name));

const fForm = main.addFolder({ title: 'FORMS' });
fForm.addBinding(form, 'type', { label: 'Shape', options: TYPE_OPTS }).on('change', formUI);
fForm.addBinding(form.amount, 'live', { label: 'Amount', min: 1, max: form.amount.max, step: 1 }).on('change', onForms);
const fRot = fForm.addBinding(form, 'rotation', { label: 'Random Angle', min: 0, max: 1, step: 0.01 });
fForm.addBinding(form.size, 'level', { label: 'Form Size', min: 1, max: 100, step: 1 });
fForm.addBinding(form.size, 'random', { label: 'Random Size', min: 0, max: 1, step: 0.01 });
fForm.addBinding(form.size, 'start', { label: 'Start Size', min: 0.01, max: 1, step: 0.01 });
fForm.addBinding(form.size, 'end', { label: 'End Size', min: 0.01, max: 1, step: 0.01 });

const fArea = main.addFolder({ title: 'AREA' });
const aRadius = fArea.addBinding(area, 'radius', { label: 'Radius', min: 0, max: 100, step: 1 }).on('change', areaUI);
fArea.addBinding(area, 'rotation', { label: 'Rotation', min: 0, max: 360, step: 5 });
const aSpeed = fArea.addBinding(area, 'speed', { label: 'Motion Period', min: 0, max: 25, step: 1 }).on('change', () => { cnv.frame = 0; areaPhaseUI(); });
const aPhase = fArea.addBinding(area, 'phase', { label: 'Start Phase', min: 0, max: 1, step: 0.01 });
const aConstr = fArea.addBinding(area, 'constraint', { label: 'Constraint', min: 0, max: 1, step: 0.01 });
const aSpaceX = fArea.addBinding(area.space, 'x', { label: 'Spacing X', min: -1, max: 1, step: 0.01 });
const aSpaceY = fArea.addBinding(area.space, 'y', { label: 'Spacing Y', min: -1, max: 1, step: 0.01 });

const fColor = main.addFolder({ title: 'COLORS' });
const cAnim = fColor.addBinding(palette, 'animation', { label: 'Animation Period', min: -25, max: 25, step: 1 }).on('change', () => { cnv.frame = 0; palettePhaseUI(); });
const cPhase = fColor.addBinding(palette, 'phase', { label: 'Start Phase', min: 0, max: 1, step: 0.01 });
fColor.addBinding(palette.layers, 'total', { label: 'Gradient Layers', min: 1, max: palette.layers.max, step: 1 });
fColor.addBinding(palette, 'gradient', { label: 'Gradient Mult', min: 1, max: 100, step: 0.1 });
fColor.addBinding(palette, 'lightness', { label: 'Light Point', min: 0, max: 1, step: 0.01 });
fColor.addBinding(palette, 'color', { label: 'Base Color' });
fColor.addBinding(palette.offset, 'x', { label: 'Offset R', min: 0, max: 1, step: 0.01 });
fColor.addBinding(palette.offset, 'y', { label: 'Offset G', min: 0, max: 1, step: 0.01 });
fColor.addBinding(palette.offset, 'z', { label: 'Offset B', min: 0, max: 1, step: 0.01 });
fColor.addBinding(form.bg, 'type', { label: 'Background', options: BG_OPTS }).on('change', bgUI);
const cBgOff = fColor.addBinding(palette.offset, 'bg', { label: 'Phase Offset', min: 0, max: 1, step: 0.01 });
const cBgCol = fColor.addBinding(form, 'bg', { label: 'Back Color' });

const fClip = main.addFolder({ title: 'CLIPPING', expanded: false });
fClip.addBinding(clipping, 'type', { label: 'Clip Shape', options: CLIP_OPTS }).on('change', clipUI);
const clipW = fClip.addBinding(clipping, 'width', { label: 'Clip Width', min: 0.25, max: 1, step: 0.01 });
const clipH = fClip.addBinding(clipping, 'height', { label: 'Clip Height', min: 0.25, max: 1, step: 0.01 });
const clipR = fClip.addBinding(clipping, 'rotation', { label: 'Clip Rotation', min: 0, max: 360, step: 5 });

const fSeed = main.addFolder({ title: 'SEED', expanded: false });
fSeed.addBinding(form, 'seed', { label: 'Seed', min: 1, max: 10000, step: 1 }).on('change', onForms);
fSeed.addButton({ title: 'New Seed' }).on('click', () => { form.seed = Math.floor(Math.random() * 10000); createForms(); tool.pane.refresh(); });

// Note: form.bg holds { type, r, g, b }; Tweakpane binds the whole object, so the
// 'Back Color' picker shows alongside 'type' but only the r/g/b are read for the
// custom background. This mirrors the reference's single bg object.
function formUI() { fRot.disabled = form.type === 'ellipse'; }
function bgUI() {
  const custom = form.bg.type === 'custom';
  cBgCol.disabled = !custom;
  cBgOff.disabled = custom;
}
function areaUI() {
  const off = area.radius === 0;
  aSpeed.disabled = off; aConstr.disabled = off; aSpaceX.disabled = off; aSpaceY.disabled = off;
  areaPhaseUI();
}
function areaPhaseUI() { aPhase.disabled = !(area.radius !== 0 && area.speed === 0); }
function palettePhaseUI() { cPhase.disabled = palette.animation !== 0; }
function clipUI() {
  const none = clipping.type === 'none';
  clipW.disabled = none; clipH.disabled = none; clipR.disabled = none;
}

/////////////////////////////////////////////////////////////////////////////
// Presets (original names + palettes; numeric configs studied from the source)
/////////////////////////////////////////////////////////////////////////////
const presets = {
  'Crimson Cell': {
    form: { seed: 720, type: 'ellipse', rotation: 0, amount: { live: 25 }, size: { level: 25, random: 0, start: 1, end: 0.01 }, bg: { type: 'form-static', r: 255, g: 255, b: 255 } },
    palette: { animation: 5, phase: 0, layers: { total: 16 }, lightness: 0, gradient: 10, color: { r: 255, g: 0, b: 0 }, offset: { bg: 0.25, x: 0, y: 0, z: 0 } },
    area: { speed: 1, phase: 0, radius: 50, constraint: 0, rotation: 0, space: { x: 0, y: 0 } },
    clipping: { type: 'ellipse', rotation: 0, width: 1, height: 1 },
  },
  'Magenta Bloom': {
    form: { seed: 3790, type: 'rectangle', rotation: 0, amount: { live: 18 }, size: { level: 26, random: 0.34, start: 1, end: 0 }, bg: { type: 'form-static', r: 255, g: 161, b: 255 } },
    palette: { animation: -5, phase: 0, layers: { total: 17 }, lightness: 1, gradient: 100, color: { r: 166, g: 72, b: 0 }, offset: { bg: 0.1, x: 0.47, y: 0.16, z: 0.09 } },
    area: { speed: 1, phase: 0, radius: 37, constraint: 0.55, rotation: 0, space: { x: 0, y: 0 } },
    clipping: { type: 'ellipse', rotation: 90, width: 1, height: 0.75 },
  },
  'Cobalt Swarm': {
    form: { seed: 8497, type: 'ellipse', rotation: 0.6, amount: { live: 75 }, size: { level: 25, random: 0, start: 1, end: 0.01 }, bg: { type: 'form-static', r: 0, g: 0, b: 0 } },
    palette: { animation: -20, phase: 0.26, layers: { total: 14 }, lightness: 0, gradient: 24, color: { r: 0, g: 11, b: 255 }, offset: { bg: 0.25, x: 0, y: 0, z: 0.5 } },
    area: { speed: 3, phase: 0, radius: 40, constraint: 0, rotation: 0, space: { x: -1, y: -1 } },
    clipping: { type: 'ellipse', rotation: 0, width: 1, height: 1 },
  },
  'Rose Vortex': {
    form: { seed: 2569, type: 'ellipse', rotation: 0, amount: { live: 32 }, size: { level: 26, random: 0, start: 1, end: 0.01 }, bg: { type: 'form-static', r: 255, g: 255, b: 255 } },
    palette: { animation: -25, phase: 0, layers: { total: 15 }, lightness: 0.23, gradient: 79, color: { r: 207, g: 0, b: 80 }, offset: { bg: 0.55, x: 0.72, y: 0.28, z: 0 } },
    area: { speed: 1, phase: 0, radius: 65, constraint: 0, rotation: 145, space: { x: 0, y: 0 } },
    clipping: { type: 'none', rotation: 90, width: 0.96, height: 1 },
  },
  'Solar Eye': {
    form: { seed: 2751, type: 'ellipse', rotation: 0, amount: { live: 1 }, size: { level: 100, random: 0, start: 1, end: 0.01 }, bg: { type: 'form-animated', r: 210, g: 210, b: 210 } },
    palette: { animation: 3, phase: 0, layers: { total: 4 }, lightness: 0.4, gradient: 4, color: { r: 185, g: 22, b: 22 }, offset: { bg: 0.95, x: 0, y: 0.37, z: 0 } },
    area: { speed: 3, phase: 0, radius: 26, constraint: 0.22, rotation: 0, space: { x: 0, y: -0.55 } },
    clipping: { type: 'ellipse', rotation: 0, width: 1, height: 1 },
  },
  'Static Drift': {
    form: { seed: 754, type: 'rectangle', rotation: 0, amount: { live: 24 }, size: { level: 25, random: 1, start: 1, end: 0 }, bg: { type: 'form-animated', r: 255, g: 255, b: 255 } },
    palette: { animation: 2, phase: 0, layers: { total: 23 }, lightness: 0.27, gradient: 3, color: { r: 242, g: 128, b: 219 }, offset: { bg: 0.12, x: 0, y: 0.92, z: 0.73 } },
    area: { speed: 1, phase: 0, radius: 36, constraint: 0, rotation: 0, space: { x: 0, y: 1 } },
    clipping: { type: 'rectangle', rotation: 0, width: 0.96, height: 1 },
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
  deepMerge(palette, structuredClone(DEFAULTS.palette));
  deepMerge(area, structuredClone(DEFAULTS.area));
  deepMerge(clipping, structuredClone(DEFAULTS.clipping));
}
function applyPreset(name) {
  const pr = typeof name === 'string' ? presets[name] : name;
  if (!pr) return;
  resetToDefaults();
  for (const key of ['cnv', 'form', 'palette', 'area', 'clipping']) if (pr[key]) deepMerge({ cnv, form, palette, area, clipping }[key], pr[key]);
  cnv.frame = 0;
  createForms();
  formUI(); bgUI(); areaUI(); palettePhaseUI(); clipUI();
  tool.pane.refresh();
}

/////////////////////////////////////////////////////////////////////////////
// Export + OPTIONS + dev hook
/////////////////////////////////////////////////////////////////////////////
attachExport(tool.pages.export, { getCanvas: tool.getCanvas, name: 'biom' });

const presetState = { name: 'Crimson Cell' };
const opts = tool.pages.options;
opts.addBinding(presetState, 'name', { label: 'Preset', options: Object.fromEntries(Object.keys(presets).map((k) => [k, k])) }).on('change', (ev) => applyPreset(ev.value));
opts.addButton({ title: 'Apply / Restart Preset' }).on('click', () => applyPreset(presetState.name));
opts.addButton({ title: 'Randomize' }).on('click', randomize);
opts.addBinding(cnv, 'animation', { label: 'Animate' }).on('change', () => { cnv.frame = 0; });
opts.addBinding(rec.length, 'value', { label: 'Loop Length', min: rec.length.min, max: rec.length.max, step: 1 });
opts.addButton({ title: 'Fullscreen (f)' }).on('click', () => tool.toggleFullscreen());

/////////////////////////////////////////////////////////////////////////////
// Randomizer (port of randomParams; poster/branding fields omitted)
/////////////////////////////////////////////////////////////////////////////
function randomize() {
  const R = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  form.seed = Math.floor(Math.random() * 10000);
  form.type = R(1) <= 0.5 ? (R(1) <= 0.5 ? 'ellipse' : 'rectangle') : pick(['ellipse', 'rectangle', 'triangle']);
  form.rotation = R(1) <= 0.75 ? 0 : R(1);
  form.amount.live = round(R(1) <= 0.75 ? R(2, form.amount.max / 2) : R(form.amount.max));
  form.size.level = round(R(1) <= 0.75 ? R(10, 75) : R(5, 100));
  form.size.random = R(1) <= 0.5 ? 0 : R(1);
  form.size.start = R(1) <= 0.5 ? 1 : R(0.2, 1);
  form.size.end = R(1) <= 0.75 ? 0 : R(1) <= 0.75 ? R(form.size.start) : R(1);
  form.bg.type = pick(['custom', 'form-static', 'form-animated']);
  if (form.bg.type === 'custom') {
    form.bg.r = R(1) <= 0.5 ? (R(1) <= 0.5 ? 255 : 0) : R(255);
    form.bg.g = R(1) <= 0.5 ? (R(1) <= 0.5 ? 255 : 0) : R(255);
    form.bg.b = R(1) <= 0.5 ? (R(1) <= 0.5 ? 255 : 0) : R(255);
    palette.offset.bg = 0;
  } else {
    palette.offset.bg = R(1) <= 0.5 ? 0 : R(1);
  }
  palette.animation = round(R(1) <= 0.66 ? R(-3, 3) : R(-25, 25));
  palette.layers.total = round(R(1) <= 0.75 ? R(palette.layers.max * 0.25, palette.layers.max * 0.8) : R(palette.layers.max));
  palette.lightness = R(1) <= 0.5 ? (R(1) <= 0.5 ? 0 : 1) : R(1);
  palette.gradient = R(100);
  palette.color.r = R(255); palette.color.g = R(255); palette.color.b = R(255);
  palette.offset.x = R(1) <= 0.5 ? 0 : R(1);
  palette.offset.y = R(1) <= 0.5 ? 0 : R(1);
  palette.offset.z = R(1) <= 0.5 ? 0 : R(1);
  area.speed = round(R(25));
  area.radius = round(R(1) <= 0.5 ? R(50, 100) : R(100));
  area.constraint = R(1) <= 0.66 ? 0 : R(1);
  area.space.x = R(1) <= 0.5 ? 0 : R(1) <= 0.5 ? (R(1) <= 0.5 ? -1 : 1) : R(-1, 1);
  area.space.y = R(1) <= 0.5 ? 0 : R(1) <= 0.5 ? (R(1) <= 0.5 ? -1 : 1) : R(-1, 1);
  clipping.type = R(1) <= 0.75 ? 'none' : pick(['none', 'ellipse', 'rectangle', 'triangle']);
  if (clipping.type !== 'none') {
    clipping.rotation = R(1) <= 0.75 ? 0 : R(360);
    clipping.width = clipping.height = R(1) <= 0.75 ? 1 : R(0.5, 1);
  }
  cnv.frame = 0;
  createForms();
  formUI(); bgUI(); areaUI(); palettePhaseUI(); clipUI();
  tool.pane.refresh();
}

window.addEventListener('resize', fitCanvas);
exposeDebug('biom', { applyPreset, randomize, cnv, form, palette, area, clipping, rec, presets, setFrame: (f) => { cnv.frame = f; } });

formUI(); bgUI(); areaUI(); palettePhaseUI(); clipUI();
pendingPreset = 'Crimson Cell';
