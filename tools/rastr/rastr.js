// RASTR — text rasterized into graphics & motion. A phrase is drawn onto an
// offscreen p5 buffer (gText), then a grid of `quantity.x × quantity.y` cells is
// laid over it; wherever the text covers a cell (alpha ≠ 0) a particle is born.
// Each particle stamps one shape (rect / triangle / ellipse / text-string) sized
// from the canvas/grid ratio, coloured by one of four modes (none / single /
// shuffle / gradient) and displaced by three composable motion systems —
// RANDOM (per-particle seeded simplex flow with an easing envelope), NOISE (a
// looped 4D-simplex field), and SINE (sin/cos/wobble periodic waves) — plus a
// `dimension` spread that pushes particles out from centre. Live render is a 2D
// p5 canvas; SVG export reconstructs the same field as <rect>/<ellipse>/<polygon>
// /<path> elements with per-shape linear gradients.
//
// Native text is rendered through a FontFace; opentype.js supplies the glyph
// outline for SVG export.
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachExport } from '../../js/etch/export.js';
import { seedNoise, noise3D, noise4D } from '../../js/etch/noise.js';

/////////////////////////////////////////////////////////////////////////////
// Math + easing — an easing-aware map()
/////////////////////////////////////////////////////////////////////////////
const { sin, cos, atan2, sqrt, abs, round, floor, min, max, pow, PI } = Math;
const TWO_PI = PI * 2;
const radians = (d) => (d * PI) / 180;
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const constrain = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

function map2(value, start1, stop1, start2, stop2, type, when) {
  const b = start2, c = stop2 - start2, d = stop1 - start1, p = 0.5;
  let t = value - start1;
  switch (type) {
    case 'Linear': return (c * t) / d + b;
    case 'Sqrt':
      if (when === 0) { t /= d; return c * pow(t, p) + b; }
      if (when === 1) { t /= d; return c * (1 - pow(1 - t, p)) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * pow(t, p) + b; return (c / 2) * (2 - pow(2 - t, p)) + b;
    case 'Quadratic':
      if (when === 0) { t /= d; return c * t * t + b; }
      if (when === 1) { t /= d; return -c * t * (t - 2) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * t * t + b; t--; return (-c / 2) * (t * (t - 2) - 1) + b;
    case 'Cubic':
      if (when === 0) { t /= d; return c * t * t * t + b; }
      if (when === 1) { t /= d; t--; return c * (t * t * t + 1) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * t * t * t + b; t -= 2; return (c / 2) * (t * t * t + 2) + b;
    case 'Quartic':
      if (when === 0) { t /= d; return c * t * t * t * t + b; }
      if (when === 1) { t /= d; t--; return -c * (t * t * t * t - 1) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * t * t * t * t + b; t -= 2; return (-c / 2) * (t * t * t * t - 2) + b;
    case 'Quintic':
      if (when === 0) { t /= d; return c * t * t * t * t * t + b; }
      if (when === 1) { t /= d; t--; return c * (t * t * t * t * t + 1) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * t * t * t * t * t + b; t -= 2; return (c / 2) * (t * t * t * t * t + 2) + b;
    case 'Sinusoidal':
      if (when === 0) return -c * cos((t / d) * (PI / 2)) + c + b;
      if (when === 1) return c * sin((t / d) * (PI / 2)) + b;
      return (-c / 2) * (cos((PI * t) / d) - 1) + b;
    case 'Exponential':
      if (when === 0) return c * pow(2, 10 * (t / d - 1)) + b;
      if (when === 1) return c * (-pow(2, (-10 * t) / d) + 1) + b;
      t /= d / 2; if (t < 1) return (c / 2) * pow(2, 10 * (t - 1)) + b; t--; return (c / 2) * (-pow(2, -10 * t) + 2) + b;
    case 'Circular':
      if (when === 0) { t /= d; return -c * (sqrt(1 - t * t) - 1) + b; }
      if (when === 1) { t /= d; t--; return c * sqrt(1 - t * t) + b; }
      t /= d / 2; if (t < 1) return (-c / 2) * (sqrt(1 - t * t) - 1) + b; t -= 2; return (c / 2) * (sqrt(1 - t * t) + 1) + b;
  }
  return 0;
}

/////////////////////////////////////////////////////////////////////////////
// Colour helpers
/////////////////////////////////////////////////////////////////////////////
function hexToRgba(hex) {
  let h = String(hex).replace(/^#/, '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('') + 'ff';
  else if (h.length === 4) h = [...h].map((c) => c + c).join('');
  else if (h.length === 6) h += 'ff';
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255 };
}
const cssRgba = (hex) => { const c = hexToRgba(hex); return `rgba(${c.r},${c.g},${c.b},${c.a})`; };
// For SVG: split into { hex:#RRGGBB, alpha:0..1 }
function parseHexWithAlpha(hex) { const c = hexToRgba(hex); const h = (v) => v.toString(16).padStart(2, '0'); return { hex: `#${h(c.r)}${h(c.g)}${h(c.b)}`, alpha: c.a }; }
function mixHexA(a, bx, t) {
  const c1 = hexToRgba(a), c2 = hexToRgba(bx); const h = (v) => round(v).toString(16).padStart(2, '0').slice(0, 2);
  return `#${h(c1.r + (c2.r - c1.r) * t)}${h(c1.g + (c2.g - c1.g) * t)}${h(c1.b + (c2.b - c1.b) * t)}${h((c1.a + (c2.a - c1.a) * t) * 255)}`;
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
const SHAPE_OPTS = { Rectangle: 'rect', Triangle: 'triangle', Ellipse: 'ellipse', 'Text String': 'text' };
const ARRANGE_OPTS = { 'Standard Order': 'forward', 'Backward Order': 'backward', 'Random Order': 'random' };
const COLOR_OPTS = { 'No Color': 'none', 'Single Color': 'single', Gradient: 'gradient', Shuffle: 'shuffle' };
const PERIODIC_OPTS = { Sinusoidal: 'sinPeriodic', Cosinusoidal: 'cosPeriodic', Wobble: 'wobblePeriodic' };
const FLOW_OPTS = { Uniform: 'uniformFlow', Easing: 'easingFlow' };
const ALIGN_OPTS = { Center: 'CENTER', Left: 'LEFT', Right: 'RIGHT' };
const FLOW_LEVELS = ['Linear', 'Quadratic', 'Cubic', 'Quartic', 'Quintic', 'Exponential'];

// Our own open-source font set (FontFace + opentype). Heavy/geometric faces give
// the densest raster coverage. Loaded from the Google Fonts mirror (CORS-open).
const GF = 'https://cdn.jsdelivr.net/gh/google/fonts@ec0464b978de222073645d6d3366f3fdf03376d8/ofl';
const FONTS = {
  Anton: `${GF}/anton/Anton-Regular.ttf`,
  'Archivo Black': `${GF}/archivoblack/ArchivoBlack-Regular.ttf`,
  Aldrich: `${GF}/aldrich/Aldrich-Regular.ttf`,
  'Space Mono': `${GF}/spacemono/SpaceMono-Regular.ttf`,
  Bungee: `${GF}/bungee/Bungee-Regular.ttf`,
  'Major Mono': `${GF}/majormonodisplay/MajorMonoDisplay-Regular.ttf`,
};
const FONT_OPTS = Object.fromEntries(Object.keys(FONTS).map((k) => [k, k]));
const CHAR_FONT_OPTS = { ...FONT_OPTS, 'Use Prompt Font': 'inherit' };

/////////////////////////////////////////////////////////////////////////////
// State — the default parameter tree
/////////////////////////////////////////////////////////////////////////////
const cnv = { offset: 2048, frame: 0, ratio: '1:1', scale: 1, rotate: 0, bg: '#0e0f17ff', animation: false };
const prompt = { font: 'Anton', text: 'RAS\nTR', align: 'CENTER', size: 46, leading: 1, spacing: 0, offset: { x: 0, y: 0 } };
const form = {
  ratio: { width: 1, height: 1 },
  quantity: { sync: true, x: 130, y: 130 },
  rotate: 0,
  type: 'ellipse',
  arrange: 'forward',
  text: 'R',
  char: { use: 'inherit', font: 'inherit', size: [0, 0], bbox: { x: 0, y: 0, w: 0, h: 0 }, area: { x: 0, y: 0 } },
  size: { base: 1, x: 1.1, y: 1.1, text: 1 },
  dimension: { x: 0, y: 0 },
  fill: { type: 'gradient', angle: 200, soft: 0.5, offset: 0, one: '#ff5d73ff', two: '#3a86ffff' },
  stroke: { type: 'none', angle: 0, soft: 0.4, offset: 0, width: 1, one: '#000000ff', two: '#ffffffff' },
  xsize: null, ysize: null, charsize: null,
};
const motion = {
  seed: 3746,
  flow: { type: 'uniformFlow', speed: 0, amp: 0, pos: 0, ease: 1 },
  noise: { speed: 0, x: { amp: 0, xfreq: 30, yfreq: 30 }, y: { amp: 0, xfreq: 30, yfreq: 30 } },
  periodic: { x: { type: 'sinPeriodic', cycle: 1, amp: 0, freq: 1 }, y: { type: 'cosPeriodic', cycle: 1, amp: 0, freq: 1 } },
};
const rec = { frameRate: 60, length: { value: 5, min: 1, max: 60 } };
const DEFAULTS = structuredClone({ cnv, prompt, form, motion });

/////////////////////////////////////////////////////////////////////////////
// Runtime
/////////////////////////////////////////////////////////////////////////////
let P = null, displayCanvas = null, gText = null, GW = 480, GH = 480, pendingPreset = null;
let particles = [], fillArray = [], strokeArray = [];
let FONT = null;            // opentype font of the current prompt face (SVG + bounds)
let promptFamily = 'Anton'; // FontFace family registered for native text
let charFamily = 'Anton';   // FontFace family used for the text-string shape
const fontCache = new Map();

/////////////////////////////////////////////////////////////////////////////
// Fonts — fetch once, register a FontFace (native render) + opentype (vectors)
/////////////////////////////////////////////////////////////////////////////
async function ensureFont(name) {
  if (fontCache.has(name)) return fontCache.get(name);
  const url = FONTS[name];
  if (!url) throw new Error('Unknown font: ' + name);
  const buf = await (await fetch(url)).arrayBuffer();
  const family = `rastr-${name.replace(/\s+/g, '-')}`;
  const face = new FontFace(family, buf.slice(0));
  document.fonts.add(face);
  await face.load();
  const entry = { family, ot: window.opentype.parse(buf) };
  fontCache.set(name, entry);
  return entry;
}
function loadPromptFont() {
  return ensureFont(prompt.font).then((r) => {
    FONT = r.ot; promptFamily = r.family;
    if (form.char.use === 'inherit') charFamily = r.family;
    return r;
  });
}
function loadCharFont() {
  if (form.char.use === 'inherit') { charFamily = promptFamily; return Promise.resolve(); }
  return ensureFont(form.char.use).then((r) => { charFamily = r.family; });
}

/////////////////////////////////////////////////////////////////////////////
// Seed — simplex field + per-particle flow phase + shuffled colour arrays
/////////////////////////////////////////////////////////////////////////////
function seedEvent() {
  seedNoise(motion.seed);
  if (P) P.randomSeed(motion.seed);
  updateRandomArray();
  updateColorArray(fillArray, form.fill.one, form.fill.two);
  updateColorArray(strokeArray, form.stroke.one, form.stroke.two);
}
function updateRandomArray() {
  for (let i = 0; i < particles.length; i++) particles[i].flow.pi = P ? P.random(-PI, PI) : 0;
}
function updateColorArray(target, hexOne, hexTwo) {
  if (P) P.randomSeed(motion.seed);
  target.length = 0;
  const n = particles.length;
  if (n === 0) return;
  for (let i = 0; i < n; i++) target.push(mixHexA(hexOne, hexTwo, n === 1 ? 0 : i / (n - 1)));
  if (P) P.shuffle(target, true);
}

/////////////////////////////////////////////////////////////////////////////
// Text rasterization — draw the phrase onto gText, then sample the grid
/////////////////////////////////////////////////////////////////////////////
function checkTextReplace(s) {
  if (s.includes('/n')) s = s.replaceAll('/n', '\n');
  return s === '' ? 'empty' : s;
}
function promptFunction() {
  if (!gText || !FONT) return;
  const text = checkTextReplace(prompt.text);
  const formSize = GW + GH;
  const fontSize = map2(prompt.size, 1, 100, formSize * 0.03, formSize, 'Cubic', 0);

  gText.clear();
  gText.push();
  gText.translate(prompt.offset.x * fontSize, prompt.offset.y * fontSize);
  gText.textAlign(P[prompt.align], P.CENTER);
  gText.textSize(fontSize);
  gText.textLeading(fontSize * prompt.leading);
  gText.drawingContext.letterSpacing = `${prompt.spacing}px`;
  gText.textFont(promptFamily);
  gText.fill(0);
  gText.text(text, 0, -fontSize / 2, gText.width + prompt.spacing / 2, gText.height + fontSize);
  gText.drawingContext.letterSpacing = '0px';
  gText.pop();

  updateParticles();
}

function updateParticlesSize() {
  form.size.base = ((GW + GH) / 2) / ((form.quantity.x * form.ratio.width + form.quantity.y * form.ratio.height) / 2);
}

function updateParticles() {
  if (!P || !gText) return;
  P.randomSeed(motion.seed);
  updateParticlesSize();
  gText.loadPixels();
  const px = gText.pixels, pw = gText.width, ph = gText.height; // pixelDensity(1) ⇒ logical == device
  particles = [];
  let id = 0;
  const xform = form.quantity.x * form.ratio.width;
  const yform = form.quantity.y * form.ratio.height;
  const xformRound = round(xform), yformRound = round(yform);
  const base = form.size.base;

  for (let i = 0; i < yformRound; i++) {
    for (let j = 0; j < xformRound; j++) {
      const x = map(j, 0, xform, -gText.width / 2 + base / 2, gText.width / 2 + base / 2);
      const y = map(i, 0, yform, -gText.height / 2 + base / 2, gText.height / 2 + base / 2);
      const sx = round(map(j, 0, xform, base / 2, gText.width + base / 2));
      const sy = round(map(i, 0, yform, base / 2, gText.height + base / 2));
      if (sx < 0 || sy < 0 || sx >= pw || sy >= ph) continue;
      if (px[(sy * pw + sx) * 4 + 3] !== 0) { particles.push(new Particle(id, x, y)); id++; }
    }
  }
  formsArrange();
  updateRandomArray();
  computeCharBounds();
  updateColorArray(fillArray, form.fill.one, form.fill.two);
  updateColorArray(strokeArray, form.stroke.one, form.stroke.two);
}

function formsArrange() {
  if (form.arrange === 'random') P.shuffle(particles, true);
  else particles.sort((a, b) => a.id - b.id);
}

/////////////////////////////////////////////////////////////////////////////
// Particle — one stamp; carries motion offsets + per-shape gradient endpoints
/////////////////////////////////////////////////////////////////////////////
class Particle {
  constructor(id, x, y) {
    this.id = id;
    this.x = x + cnv.offset;
    this.y = y + cnv.offset;
    this.simplex = { x: 0, y: 0 };
    this.flow = { x: 0, y: 0, pi: 0 };
    this.move = { x: 0, y: 0 };
    this.grad = { fill: [0, 0, 0, 0], stroke: [0, 0, 0, 0] };
  }

  gradientAdd(type, size, squaresize, offset, gradSoft, gradOffset, angle) {
    const cx = size[0] * (gradOffset[0] * cos(angle)) - offset[0];
    const cy = size[1] * (gradOffset[1] * sin(angle)) - offset[1];
    const ox = cos(angle) * squaresize * gradSoft;
    const oy = sin(angle) * squaresize * gradSoft;
    this.grad[type] = [cx - ox, cy - oy, cx + ox, cy + oy];
  }
  gradientSkip(type) { this.grad[type] = [0, 0, 0, 0]; }

  periodAdd(i, frame, length) {
    const xfreq = map(i + particles.length / 2, 0, particles.length, 0, motion.periodic.x.freq) / length;
    const yfreq = map(i + particles.length / 2, 0, particles.length, 0, motion.periodic.y.freq) / length;
    this.move.x = this[motion.periodic.x.type](xfreq, length, frame, motion.periodic.x.amp / 2, motion.periodic.x.cycle);
    this.move.y = this[motion.periodic.y.type](yfreq, length, frame, motion.periodic.y.amp / 2, motion.periodic.y.cycle);
  }
  periodSkip() { this.move.x = 0; this.move.y = 0; }

  noiseAdd(i, frame, speed, ampX, ampY, xfreqX, xfreqY, yfreqX, yfreqY) {
    this.simplex.x = noise4D(this.x * xfreqX, -1231.2 - this.y * xfreqY, speed * sin(TWO_PI * frame), speed * cos(TWO_PI * frame)) * ampX;
    this.simplex.y = noise4D(11221.4 + this.x * yfreqX, 7922.1 + this.y * yfreqY, speed * sin(TWO_PI * frame), speed * cos(TWO_PI * frame)) * ampY;
  }
  noiseSkip() { this.simplex.x = 0; this.simplex.y = 0; }

  randomAdd(i, frame, speed, amp, start) {
    const amplify = this[motion.flow.type](i, start, amp);
    this.flow.x = noise3D(i + this.flow.pi * 998.2, speed * sin(TWO_PI * frame), speed * cos(TWO_PI * frame)) * amplify;
    this.flow.y = noise3D(i + this.flow.pi * -1123.3, speed * cos(TWO_PI * frame), speed * sin(TWO_PI * frame)) * amplify;
  }
  randomSkip() { this.flow.x = 0; this.flow.y = 0; }

  shape(i, xsize, ysize, rotation, localTrans) {
    P.push();
    P.translate(
      (this.x - cnv.offset) * form.dimension.x + this.x + this.simplex.x + this.flow.x + this.move.x,
      (this.y - cnv.offset) * form.dimension.y + this.y + this.simplex.y + this.flow.y + this.move.y
    );
    P.rotate(rotation);
    P.translate(localTrans[0], localTrans[1]);
    this[`${form.stroke.type}Stroke`](i);
    this[`${form.fill.type}Fill`](i);
    this[`${form.type}Shape`](xsize, ysize);
    P.pop();
  }

  ellipseShape(xsize, ysize) { P.ellipse(0, 0, xsize, ysize); }
  rectShape(xsize, ysize) { P.rect(0, 0, xsize, ysize); }
  triangleShape(xsize, ysize) { P.triangle(-xsize / 2, -ysize / 2, xsize / 2, -ysize / 2, xsize / 2, ysize / 2); }
  textShape() { P.text(form.text, 0, 0); }

  noneStroke() {}
  singleStroke() { P.stroke(form.stroke.one); }
  shuffleStroke(i) { if (strokeArray[i]) P.stroke(strokeArray[i]); }
  gradientStroke() {
    const g = P.drawingContext.createLinearGradient(this.grad.stroke[0], this.grad.stroke[1], this.grad.stroke[2], this.grad.stroke[3]);
    g.addColorStop(0, cssRgba(form.stroke.one)); g.addColorStop(1, cssRgba(form.stroke.two));
    P.drawingContext.strokeStyle = g;
  }

  noneFill() {}
  singleFill() { P.fill(form.fill.one); }
  shuffleFill(i) { if (fillArray[i]) P.fill(fillArray[i]); }
  gradientFill() {
    const g = P.drawingContext.createLinearGradient(this.grad.fill[0], this.grad.fill[1], this.grad.fill[2], this.grad.fill[3]);
    g.addColorStop(0, cssRgba(form.fill.one)); g.addColorStop(1, cssRgba(form.fill.two));
    P.drawingContext.fillStyle = g;
  }

  uniformFlow(i, start, amp) { return amp; }
  easingFlow(i, start, amp) {
    return map2(abs(start - i) % particles.length, 0, particles.length, 0, amp, FLOW_LEVELS[motion.flow.ease - 1], 2);
  }
  cosPeriodic(freq, length, frame, amp, speed) { return cos(TWO_PI * freq * length + TWO_PI * frame * speed) * amp; }
  sinPeriodic(freq, length, frame, amp, speed) { return sin(TWO_PI * freq * length + TWO_PI * frame * speed) * amp; }
  wobblePeriodic(freq, length, frame, amp, speed) { return sin(TWO_PI * freq * length) * cos(TWO_PI * frame * speed) * amp; }
}

/////////////////////////////////////////////////////////////////////////////
// Derived sizes — recomputed each frame, before anything is drawn
/////////////////////////////////////////////////////////////////////////////
function computeCharBounds() {
  if (form.type !== 'text' || !FONT) return;
  const charsize = form.size.base * form.size.text;
  const bb = FONT.getPath(form.text || ' ', 0, 0, charsize).getBoundingBox();
  const w = isFinite(bb.x2 - bb.x1) ? bb.x2 - bb.x1 : 0;
  const h = isFinite(bb.y2 - bb.y1) ? bb.y2 - bb.y1 : 0;
  form.char.size = [w, h];
  form.char.bbox = { x: bb.x1, y: bb.y1, w, h };
  form.char.area = { x: -(bb.x1 + bb.x2) / 2, y: -(bb.y1 + bb.y2) / 2 };
}
function computeFormSizes() {
  const fq = (form.quantity.x * form.ratio.width + form.quantity.y * form.ratio.height) / 2;
  form.xsize = form.size.x < 1 ? form.size.base * form.size.x
    : map(form.size.x, 1, 3, form.size.base * form.size.x, (form.size.base * form.size.x * fq) / 20);
  form.ysize = form.size.y < 1 ? form.size.base * form.size.y
    : map(form.size.y, 1, 3, form.size.base * form.size.y, (form.size.base * form.size.y * fq) / 20);
  form.charsize = form.size.base * form.size.text;
}

/////////////////////////////////////////////////////////////////////////////
// Render
/////////////////////////////////////////////////////////////////////////////
function drawGraphics() {
  P.clear();
  P.background(cnv.bg);
  P.push();
  P.noFill(); P.noStroke();
  P.translate(GW / 2, GH / 2);
  P.scale(cnv.scale);
  P.translate(-cnv.offset, -cnv.offset);

  const gradFill = form.fill.type === 'gradient' ? 'gradientAdd' : 'gradientSkip';
  const gradStroke = form.stroke.type === 'gradient' ? 'gradientAdd' : 'gradientSkip';
  const periodType = motion.periodic.x.amp !== 0 || motion.periodic.y.amp !== 0 ? 'periodAdd' : 'periodSkip';
  const noiseType = motion.noise.x.amp !== 0 || motion.noise.y.amp !== 0 ? 'noiseAdd' : 'noiseSkip';
  const randomType = motion.flow.amp !== 0 ? 'randomAdd' : 'randomSkip';

  const frame = rec.length.value === 0 ? 1 : cnv.frame / (rec.length.value * rec.frameRate);
  const periodLength = rec.length.value === 0 ? 1 : rec.length.value;
  const noiseSpeed = rec.length.value * rec.frameRate * map(motion.noise.speed, 0, 100, 0, 0.01);
  const randomSpeed = rec.length.value * rec.frameRate * map(motion.flow.speed, 0, 100, 0, 0.01);
  const rotation = map(form.rotate, 0, 360, 0, TWO_PI);
  const flowStart = map(motion.flow.pos, 0, 100, 0, particles.length);
  const flowAmp = map2(motion.flow.amp, 0, 100, 0, 100, 'Quadratic', 0);
  const ampX = map2(motion.noise.x.amp, 0, 100, 0, GW / 4, 'Quadratic', 0);
  const ampY = map2(motion.noise.y.amp, 0, 100, 0, GH / 4, 'Quadratic', 0);
  const xfreqX = map2(motion.noise.x.xfreq, 0, 100, 0, 0.05, 'Quadratic', 0);
  const xfreqY = map2(motion.noise.x.yfreq, 0, 100, 0, 0.05, 'Quadratic', 0);
  const yfreqX = map2(motion.noise.y.xfreq, 0, 100, 0, 0.05, 'Quadratic', 0);
  const yfreqY = map2(motion.noise.y.yfreq, 0, 100, 0, 0.05, 'Quadratic', 0);

  computeFormSizes();

  let localTrans = [0, 0];
  const fillAngle = radians(form.fill.angle);
  const strokeAngle = radians(form.stroke.angle);
  let gradSize = [form.xsize, form.ysize];
  let gradSquare = sqrt(gradSize[0] * gradSize[0] + gradSize[1] * gradSize[1]);
  const fillOffset = [form.fill.offset, form.fill.offset];
  const strokeOffset = [form.stroke.offset, form.stroke.offset];

  if (form.type === 'text') {
    P.textFont(charFamily); P.textSize(form.charsize); P.textAlign(P.LEFT, P.BASELINE);
    localTrans = [form.char.area.x, form.char.area.y];
    gradSize = [form.char.size[0], form.char.size[1]];
    gradSquare = sqrt(gradSize[0] * gradSize[0] + gradSize[1] * gradSize[1]);
  }

  if (form.fill.type !== 'none') P.fill(0);
  if (form.stroke.type !== 'none') {
    P.stroke(0);
    P.drawingContext.lineJoin = 'miter';
    P.drawingContext.miterLimit = 2;
    P.strokeWeight(form.stroke.width);
  } else { P.noStroke(); }

  const count = form.arrange === 'backward' ? particles.length - 1 : 0;
  for (let i = 0; i < particles.length; i++) {
    const j = abs(count - i);
    const p = particles[j];
    p[gradFill]('fill', gradSize, gradSquare, localTrans, form.fill.soft, fillOffset, fillAngle);
    p[gradStroke]('stroke', gradSize, gradSquare, localTrans, form.stroke.soft, strokeOffset, strokeAngle);
    p[periodType](p.id, frame, periodLength);
    p[noiseType](j, frame, noiseSpeed, ampX, ampY, xfreqX, xfreqY, yfreqX, yfreqY);
    p[randomType](p.id, frame, randomSpeed, flowAmp, flowStart);
    p.shape(j, form.xsize, form.ysize, rotation, localTrans);
  }

  P.pop();
  if (cnv.animation) cnv.frame = frame >= 1 ? 0 : cnv.frame + 1;
}

/////////////////////////////////////////////////////////////////////////////
// SVG export — manual element string building
/////////////////////////////////////////////////////////////////////////////
function renderSVG() {
  if (!particles.length) return '';
  computeFormSizes();
  const r4 = (v) => round(v * 1e4) / 1e4;
  const xsize = r4(form.xsize), ysize = r4(form.ysize), charsize = r4(form.charsize);
  const shapeRotate = form.rotate === 0 ? '' : ` rotate(${form.rotate})`;
  const canvasBG = parseHexWithAlpha(cnv.bg);
  const fillOne = parseHexWithAlpha(form.fill.one), fillTwo = parseHexWithAlpha(form.fill.two);
  const strokeOne = parseHexWithAlpha(form.stroke.one), strokeTwo = parseHexWithAlpha(form.stroke.two);

  let x, y, SVGpath;
  if (form.type === 'text') {
    SVGpath = FONT.getPath(form.text || ' ', 0, 0, charsize).toPathData(4);
    x = form.char.area.x; y = form.char.area.y;
  } else { x = xsize / 2; y = ysize / 2; }

  let defs = '', body = '';
  const lin = (id, pos, one, two) => { defs += `<linearGradient id="${id}" x1="${pos[0]}" y1="${pos[1]}" x2="${pos[2]}" y2="${pos[3]}" gradientUnits="userSpaceOnUse"><stop offset="0%" style="stop-color:${one.hex};stop-opacity:${one.alpha}"/><stop offset="100%" style="stop-color:${two.hex};stop-opacity:${two.alpha}"/></linearGradient>\n`; };
  const fillStyle = (i, id) => {
    switch (form.fill.type) {
      case 'none': return 'fill="none"';
      case 'single': return `fill="${fillOne.hex}" fill-opacity="${fillOne.alpha}"`;
      case 'shuffle': { const c = parseHexWithAlpha(fillArray[i] || '#00000000'); return `fill="${c.hex}" fill-opacity="${c.alpha}"`; }
      case 'gradient': { const gid = `f_${id}`; lin(gid, particles[i].grad.fill, fillOne, fillTwo); return `fill="url(#${gid})"`; }
    }
  };
  const strokeStyle = (i, id) => {
    switch (form.stroke.type) {
      case 'none': return 'stroke="none"';
      case 'single': return `stroke="${strokeOne.hex}" stroke-width="${form.stroke.width}" stroke-opacity="${strokeOne.alpha}"`;
      case 'shuffle': { const c = parseHexWithAlpha(strokeArray[i] || '#00000000'); return `stroke="${c.hex}" stroke-width="${form.stroke.width}" stroke-opacity="${c.alpha}"`; }
      case 'gradient': { const gid = `s_${id}`; lin(gid, particles[i].grad.stroke, strokeOne, strokeTwo); return `stroke="url(#${gid})" stroke-width="${form.stroke.width}"`; }
    }
  };

  const count = form.arrange === 'backward' ? particles.length - 1 : 0;
  for (let k = 0; k < particles.length; k++) {
    const j = abs(count - k);
    const p = particles[j];
    const xT = r4((p.x - cnv.offset) * form.dimension.x + p.x + p.simplex.x + p.flow.x + p.move.x);
    const yT = r4((p.y - cnv.offset) * form.dimension.y + p.y + p.simplex.y + p.flow.y + p.move.y);
    const fs = fillStyle(j, p.id), ss = strokeStyle(j, p.id);
    if (form.type === 'rect') body += `<rect x="${-x}" y="${-y}" transform="translate(${xT} ${yT})${shapeRotate}" width="${xsize}" height="${ysize}" ${ss} ${fs} />\n`;
    else if (form.type === 'ellipse') body += `<ellipse cx="0" cy="0" transform="translate(${xT} ${yT})${shapeRotate}" rx="${xsize / 2}" ry="${ysize / 2}" ${ss} ${fs} />\n`;
    else if (form.type === 'triangle') body += `<polygon points="${-xsize / 2},${-ysize / 2} ${xsize / 2},${-ysize / 2} ${xsize / 2},${ysize / 2}" transform="translate(${xT} ${yT})${shapeRotate}" ${ss} ${fs} />\n`;
    else if (form.type === 'text') {
      if (form.stroke.type !== 'none') body += `<g transform="translate(${xT} ${yT})${shapeRotate}" fill="none" ${ss}><g transform="translate(${x} ${y})"><path d="${SVGpath}" /></g></g>\n`;
      body += `<g transform="translate(${xT} ${yT})${shapeRotate}" ${fs}><g transform="translate(${x} ${y})"><path d="${SVGpath}" /></g></g>\n`;
    }
  }

  return `<svg version="1.1" id="MadeInRASTR" xmlns="http://www.w3.org/2000/svg" width="${GW * 1.5}" height="${GH * 1.5}" viewBox="0 0 ${GW} ${GH}">
<rect width="${GW}" height="${GH}" fill="${canvasBG.hex}" fill-opacity="${canvasBG.alpha}" />
<defs>${defs}</defs>
<g transform="translate(${GW / 2}, ${GH / 2}) scale(${cnv.scale}) rotate(${cnv.rotate})">
<g transform="translate(${-cnv.offset}, ${-cnv.offset})">
${body}</g></g></svg>`;
}

/////////////////////////////////////////////////////////////////////////////
// Sketch — fixed render-space canvas, CSS-fit to viewport
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'RASTR', version: '0.2' });

function fitCanvas() {
  if (!displayCanvas) return;
  const pad = 48;
  const k = min((window.innerWidth - pad * 2) / GW, (window.innerHeight - pad * 2) / GH);
  displayCanvas.elt.style.width = `${GW * k}px`;
  displayCanvas.elt.style.height = `${GH * k}px`;
}
function applyRatio() {
  [GW, GH] = RATIOS[cnv.ratio];
  if (GW === GH) { form.ratio.width = 1; form.ratio.height = 1; }
  else if (GW > GH) { form.ratio.width = 1; form.ratio.height = GH / GW; }
  else { form.ratio.width = GW / GH; form.ratio.height = 1; }
  if (P) {
    P.resizeCanvas(GW, GH); P.pixelDensity(2); P.rectMode(P.CENTER); P.imageMode(P.CENTER);
    if (gText) gText.remove();
    gText = P.createGraphics(GW, GH); gText.pixelDensity(1); gText.noStroke();
  }
  fitCanvas();
  promptFunction();
}

tool.startSketch((p) => {
  p.setup = () => {
    P = p;
    tool.canvasHost.style.display = 'flex';
    tool.canvasHost.style.alignItems = 'center';
    tool.canvasHost.style.justifyContent = 'center';
    [GW, GH] = RATIOS[cnv.ratio];
    displayCanvas = p.createCanvas(GW, GH);
    displayCanvas.elt.style.display = 'block';
    p.pixelDensity(2);
    p.rectMode(p.CENTER);
    p.imageMode(p.CENTER);
    p.frameRate(rec.frameRate);
    gText = p.createGraphics(GW, GH); gText.pixelDensity(1); gText.noStroke();
    fitCanvas();
    loadPromptFont().then(() => { seedNoise(motion.seed); p.randomSeed(motion.seed); promptFunction(); });
  };
  p.draw = () => {
    if (pendingPreset && FONT) { const n = pendingPreset; pendingPreset = null; applyPreset(n); return; }
    if (!FONT) { p.clear(); return; }
    drawGraphics();
  };
  p.windowResized = () => fitCanvas();
});

/////////////////////////////////////////////////////////////////////////////
// Drag-drop — a font (.ttf/.otf/.woff) registers + becomes the prompt face
/////////////////////////////////////////////////////////////////////////////
let droppedFace = null;
tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file || !/\.(ttf|otf|woff)$/i.test(file.name)) return;
  const r = new FileReader();
  r.onload = () => {
    const buf = r.result;
    const family = `rastr-drop-${Date.now()}`;
    const face = new FontFace(family, buf.slice(0));
    face.load().then(() => {
      if (droppedFace) document.fonts.delete(droppedFace);
      document.fonts.add(face);
      droppedFace = face;
      FONT = window.opentype.parse(buf);
      promptFamily = family; if (form.char.use === 'inherit') charFamily = family;
      promptFunction();
    }).catch((err) => { console.error('dropped font load failed', err); });
  };
  r.readAsArrayBuffer(file);
});

/////////////////////////////////////////////////////////////////////////////
// UI
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;
const regen = () => { if (FONT) promptFunction(); };
const recolor = () => { updateColorArray(fillArray, form.fill.one, form.fill.two); updateColorArray(strokeArray, form.stroke.one, form.stroke.two); };

main.addButton({ title: 'Restart Preset' }).on('click', () => applyPreset(presetState.name));

const fCanvas = main.addFolder({ title: 'CANVAS', expanded: false });
fCanvas.addBinding(cnv, 'ratio', { label: 'Canvas Ratio', options: RATIO_OPTS }).on('change', applyRatio);
fCanvas.addBinding(cnv, 'scale', { label: 'Content Scale', min: 0.25, max: 1.5, step: 0.01 });
fCanvas.addBinding(cnv, 'bg', { label: 'Canvas Color', view: 'color', alpha: true });

const fText = main.addFolder({ title: 'TEXT' });
fText.addBinding(prompt, 'font', { label: 'Font', options: FONT_OPTS }).on('change', () => { loadPromptFont().then(regen); });
fText.addBinding(prompt, 'text', { label: 'Prompt Text', multiline: true, rows: 2 }).on('change', regen);
fText.addBinding(prompt, 'size', { label: 'Text Size', min: 1, max: 100, step: 0.1 }).on('change', regen);
fText.addBinding(form.quantity, 'sync', { label: 'Sync Values' }).on('change', (ev) => { if (ev.value) { form.quantity.y = form.quantity.x; tool.pane.refresh(); regen(); } });
fText.addBinding(form.quantity, 'x', { label: 'Horizontal', min: 10, max: 200, step: 1 }).on('change', (ev) => { if (form.quantity.sync) { form.quantity.y = ev.value; tool.pane.refresh(); } regen(); });
fText.addBinding(form.quantity, 'y', { label: 'Vertical', min: 10, max: 200, step: 1 }).on('change', (ev) => { if (form.quantity.sync) { form.quantity.x = ev.value; tool.pane.refresh(); } regen(); });
fText.addBinding(prompt, 'align', { label: 'Text Align', options: ALIGN_OPTS }).on('change', regen);
fText.addBinding(prompt, 'leading', { label: 'Text Leading', min: 0, max: 2, step: 0.01 }).on('change', regen);
fText.addBinding(prompt, 'spacing', { label: 'Letter Spacing', min: -50, max: 50, step: 0.1 }).on('change', regen);
fText.addBinding(prompt.offset, 'x', { label: 'Offset X', min: -1, max: 1, step: 0.01 }).on('change', regen);
fText.addBinding(prompt.offset, 'y', { label: 'Offset Y', min: -1, max: 1, step: 0.01 }).on('change', regen);

const fShape = main.addFolder({ title: 'SHAPE', expanded: false });
fShape.addBinding(form, 'type', { label: 'Shape Type', options: SHAPE_OPTS }).on('change', () => { shapeUI(); computeCharBounds(); });
fShape.addBinding(form, 'arrange', { label: 'Arrange', options: ARRANGE_OPTS }).on('change', () => { if (P) { formsArrange(); recolor(); } });
const sUse = fShape.addBinding(form.char, 'use', { label: 'Char Font', options: CHAR_FONT_OPTS }).on('change', () => { loadCharFont(); });
const sChars = fShape.addBinding(form, 'text', { label: 'Chars String' }).on('change', () => computeCharBounds());
const sSizeX = fShape.addBinding(form.size, 'x', { label: 'Shape Size X', min: 0.1, max: 3, step: 0.01 });
const sSizeY = fShape.addBinding(form.size, 'y', { label: 'Shape Size Y', min: 0.1, max: 3, step: 0.01 });
const sSizeT = fShape.addBinding(form.size, 'text', { label: 'Text Size', min: 0.25, max: 5, step: 0.01 }).on('change', () => computeCharBounds());
fShape.addBinding(form, 'rotate', { label: 'Rotation', min: 0, max: 360, step: 5 });
fShape.addBinding(form.dimension, 'x', { label: 'Spread X', min: -0.25, max: 1, step: 0.01 });
fShape.addBinding(form.dimension, 'y', { label: 'Spread Y', min: -0.25, max: 1, step: 0.01 });

const fFill = main.addFolder({ title: 'FILL', expanded: false });
fFill.addBinding(form.fill, 'type', { label: 'Fill Type', options: COLOR_OPTS }).on('change', () => { fillUI(); recolor(); });
const fillOne = fFill.addBinding(form.fill, 'one', { label: 'First Color', view: 'color', alpha: true }).on('change', recolor);
const fillTwo = fFill.addBinding(form.fill, 'two', { label: 'Second Color', view: 'color', alpha: true }).on('change', recolor);
const fillAngle = fFill.addBinding(form.fill, 'angle', { label: 'Angle', min: 0, max: 360, step: 1 });
const fillSoft = fFill.addBinding(form.fill, 'soft', { label: 'Softness', min: 0.01, max: 1, step: 0.01 });
const fillOff = fFill.addBinding(form.fill, 'offset', { label: 'Offset', min: -0.5, max: 0.5, step: 0.01 });

const fStroke = main.addFolder({ title: 'STROKE', expanded: false });
fStroke.addBinding(form.stroke, 'type', { label: 'Stroke Type', options: COLOR_OPTS }).on('change', () => { strokeUI(); recolor(); });
const strokeOne = fStroke.addBinding(form.stroke, 'one', { label: 'First Color', view: 'color', alpha: true }).on('change', recolor);
const strokeTwo = fStroke.addBinding(form.stroke, 'two', { label: 'Second Color', view: 'color', alpha: true }).on('change', recolor);
const strokeW = fStroke.addBinding(form.stroke, 'width', { label: 'Width', min: 0.1, max: 5, step: 0.1 });
const strokeAngle = fStroke.addBinding(form.stroke, 'angle', { label: 'Angle', min: 0, max: 360, step: 1 });
const strokeSoft = fStroke.addBinding(form.stroke, 'soft', { label: 'Softness', min: 0.01, max: 1, step: 0.01 });
const strokeOff = fStroke.addBinding(form.stroke, 'offset', { label: 'Offset', min: -0.5, max: 0.5, step: 0.01 });

const fMotion = main.addFolder({ title: 'MOTION', expanded: false });
fMotion.addBinding(motion, 'seed', { label: 'Noise Seed', min: 0, max: 10000, step: 1 }).on('change', () => seedEvent());
fMotion.addBinding(motion.flow, 'type', { label: 'Flow Dist', options: FLOW_OPTS }).on('change', flowUI);
fMotion.addBinding(motion.flow, 'amp', { label: 'Flow Amp', min: 0, max: 100, step: 1 });
fMotion.addBinding(motion.flow, 'speed', { label: 'Flow Speed', min: 0, max: 100, step: 0.1 });
const flowPos = fMotion.addBinding(motion.flow, 'pos', { label: 'Flow Position', min: 0, max: 100, step: 1 });
const flowEase = fMotion.addBinding(motion.flow, 'ease', { label: 'Flow Ease', min: 1, max: 6, step: 1 });
fMotion.addBinding(motion.noise, 'speed', { label: 'Noise Speed', min: 0, max: 100, step: 0.1 });
fMotion.addBinding(motion.noise.x, 'amp', { label: 'Noise X Amp', min: 0, max: 100, step: 1 });
fMotion.addBinding(motion.noise.x, 'xfreq', { label: 'Noise X·Xf', min: 0, max: 100, step: 0.1 });
fMotion.addBinding(motion.noise.x, 'yfreq', { label: 'Noise X·Yf', min: 0, max: 100, step: 0.1 });
fMotion.addBinding(motion.noise.y, 'amp', { label: 'Noise Y Amp', min: 0, max: 100, step: 1 });
fMotion.addBinding(motion.noise.y, 'xfreq', { label: 'Noise Y·Xf', min: 0, max: 100, step: 0.1 });
fMotion.addBinding(motion.noise.y, 'yfreq', { label: 'Noise Y·Yf', min: 0, max: 100, step: 0.1 });
fMotion.addBinding(motion.periodic.x, 'type', { label: 'Sine X Type', options: PERIODIC_OPTS });
fMotion.addBinding(motion.periodic.x, 'amp', { label: 'Sine X Amp', min: 0, max: 100, step: 1 });
fMotion.addBinding(motion.periodic.x, 'freq', { label: 'Sine X Freq', min: -5, max: 5, step: 0.1 });
fMotion.addBinding(motion.periodic.x, 'cycle', { label: 'Sine X Cycles', min: 1, max: 10, step: 1 });
fMotion.addBinding(motion.periodic.y, 'type', { label: 'Sine Y Type', options: PERIODIC_OPTS });
fMotion.addBinding(motion.periodic.y, 'amp', { label: 'Sine Y Amp', min: 0, max: 100, step: 1 });
fMotion.addBinding(motion.periodic.y, 'freq', { label: 'Sine Y Freq', min: -5, max: 5, step: 0.1 });
fMotion.addBinding(motion.periodic.y, 'cycle', { label: 'Sine Y Cycles', min: 1, max: 10, step: 1 });

function shapeUI() {
  const isText = form.type === 'text';
  sUse.hidden = !isText; sChars.hidden = !isText; sSizeT.hidden = !isText;
  sSizeX.hidden = isText; sSizeY.hidden = isText;
}
function fillUI() {
  const t = form.fill.type;
  fillOne.disabled = t === 'none';
  fillTwo.disabled = !(t === 'gradient' || t === 'shuffle');
  const g = t === 'gradient';
  fillAngle.disabled = !g; fillSoft.disabled = !g; fillOff.disabled = !g;
}
function strokeUI() {
  const t = form.stroke.type;
  strokeOne.disabled = t === 'none'; strokeW.disabled = t === 'none';
  strokeTwo.disabled = !(t === 'gradient' || t === 'shuffle');
  const g = t === 'gradient';
  strokeAngle.disabled = !g; strokeSoft.disabled = !g; strokeOff.disabled = !g;
}
function flowUI() { const e = motion.flow.type !== 'easingFlow'; flowPos.disabled = e; flowEase.disabled = e; }

/////////////////////////////////////////////////////////////////////////////
// Presets (original names; reference parameter taxonomy)
/////////////////////////////////////////////////////////////////////////////
const presets = {
  'Isometric Drift': {
    cnv: { ratio: '1:1', scale: 1, bg: '#ffaa00ff' },
    prompt: { font: 'Aldrich', text: 'ISO\nMET\nRIC', align: 'CENTER', size: 50, leading: 0.9, spacing: 3.5, offset: { x: 0, y: 0.09 } },
    form: { quantity: { sync: false, x: 120, y: 44 }, rotate: 35, type: 'rect', arrange: 'backward', size: { x: 2.25, y: 1.5 }, dimension: { x: 0, y: 0 }, fill: { type: 'gradient', angle: 180, soft: 0.01, offset: -0.19, one: '#ffffffff', two: '#ffaa00ff' }, stroke: { type: 'single', angle: 45, soft: 0.23, offset: -0.4, width: 1.2, one: '#000000ff', two: '#ffffffff' } },
    motion: { seed: 3746, noise: { speed: 15 } },
  },
  'Vector Lullaby': {
    cnv: { ratio: '1:1', scale: 1, bg: '#000000ff' },
    prompt: { font: 'Space Mono', text: 'one rastr\na day keeps\nthe vector\naway', align: 'CENTER', size: 28, leading: 1, spacing: 0.2, offset: { x: 0, y: 0 } },
    form: { quantity: { sync: true, x: 120, y: 120 }, rotate: 0, type: 'ellipse', arrange: 'random', size: { x: 1.5, y: 1.5 }, fill: { type: 'single', one: '#000000ff' }, stroke: { type: 'gradient', angle: 45, soft: 0.23, offset: -0.4, width: 1.2, one: '#00c1ffff', two: '#e400ffff' } },
    motion: { seed: 3746, noise: { speed: 15 } },
  },
  'Heat Signature': {
    cnv: { ratio: '16:9', scale: 1, bg: '#120000ff' },
    prompt: { font: 'Anton', text: 'BURN', align: 'CENTER', size: 60, leading: 1, spacing: 1, offset: { x: 0, y: 0 } },
    form: { quantity: { sync: true, x: 150, y: 150 }, rotate: 0, type: 'ellipse', arrange: 'forward', size: { x: 1.2, y: 1.2 }, fill: { type: 'shuffle', one: '#ffd000ff', two: '#ff0040ff' }, stroke: { type: 'none' } },
    motion: { seed: 904, flow: { type: 'easingFlow', amp: 28, speed: 22, pos: 50, ease: 3 }, noise: { speed: 20, x: { amp: 6, xfreq: 22, yfreq: 22 }, y: { amp: 6, xfreq: 22, yfreq: 22 } } },
  },
  'Static Bloom': {
    cnv: { ratio: '1:1', scale: 1, bg: '#06121aff' },
    prompt: { font: 'Archivo Black', text: 'GLOW', align: 'CENTER', size: 52, leading: 1, spacing: 0, offset: { x: 0, y: 0 } },
    form: { quantity: { sync: true, x: 120, y: 120 }, rotate: 45, type: 'rect', arrange: 'forward', size: { x: 1.4, y: 1.4 }, dimension: { x: 0.06, y: 0.06 }, fill: { type: 'gradient', angle: 90, soft: 0.6, offset: 0, one: '#43e8d8ff', two: '#1b3a8bff' }, stroke: { type: 'none' } },
    motion: { seed: 211, noise: { speed: 16, x: { amp: 10, xfreq: 18, yfreq: 18 }, y: { amp: 10, xfreq: 18, yfreq: 18 } } },
  },
  'Glitch Banner': {
    cnv: { ratio: '2:1', scale: 1, bg: '#0c0c0cff' },
    prompt: { font: 'Bungee', text: 'SIGNAL', align: 'CENTER', size: 44, leading: 1, spacing: 0, offset: { x: 0, y: 0 } },
    form: { quantity: { sync: false, x: 140, y: 70 }, rotate: 0, type: 'ellipse', arrange: 'forward', size: { x: 1, y: 1 }, fill: { type: 'gradient', angle: 0, soft: 0.3, offset: 0, one: '#ff2e63ff', two: '#08d9d6ff' }, stroke: { type: 'none' } },
    motion: { seed: 77, periodic: { x: { type: 'sinPeriodic', amp: 14, freq: 2.5, cycle: 1 }, y: { type: 'cosPeriodic', amp: 0, freq: 1, cycle: 1 } } },
  },
  'Tide Lines': {
    cnv: { ratio: '4:5', scale: 1, bg: '#f3ecdcff' },
    prompt: { font: 'Aldrich', text: 'EBB\nFLOW', align: 'CENTER', size: 56, leading: 0.95, spacing: 2, offset: { x: 0, y: 0 } },
    form: { quantity: { sync: true, x: 140, y: 140 }, rotate: 0, type: 'triangle', arrange: 'forward', size: { x: 1, y: 1.6 }, fill: { type: 'shuffle', one: '#1d3557ff', two: '#e63946ff' }, stroke: { type: 'none' } },
    motion: { seed: 512, periodic: { y: { type: 'sinPeriodic', amp: 26, freq: 4, cycle: 1 }, x: { type: 'sinPeriodic', amp: 0, freq: 1, cycle: 1 } } },
  },
};

function deepMerge(dst, src) {
  for (const k of Object.keys(src)) {
    if (Array.isArray(src[k])) { if (Array.isArray(dst[k])) { dst[k].length = 0; dst[k].push(...src[k]); } else dst[k] = src[k].slice(); }
    else if (src[k] && typeof src[k] === 'object') { dst[k] = dst[k] || {}; deepMerge(dst[k], src[k]); }
    else dst[k] = src[k];
  }
}
function resetToDefaults() {
  deepMerge(cnv, structuredClone(DEFAULTS.cnv));
  deepMerge(prompt, structuredClone(DEFAULTS.prompt));
  deepMerge(form, structuredClone(DEFAULTS.form));
  deepMerge(motion, structuredClone(DEFAULTS.motion));
}
function applyPreset(name) {
  const pr = typeof name === 'string' ? presets[name] : name;
  if (!pr) return;
  resetToDefaults();
  if (pr.cnv) deepMerge(cnv, pr.cnv);
  if (pr.prompt) deepMerge(prompt, pr.prompt);
  if (pr.form) deepMerge(form, pr.form);
  if (pr.motion) deepMerge(motion, pr.motion);
  if (pr.rec) deepMerge(rec, pr.rec);
  // External presets may carry prompt.family + a 'transition' colour mode — bridge them.
  if (pr.prompt && pr.prompt.family) prompt.font = FONTS[pr.prompt.family] ? pr.prompt.family : 'Anton';
  if (form.fill.type === 'transition') form.fill.type = 'shuffle';
  if (form.stroke.type === 'transition') form.stroke.type = 'shuffle';
  cnv.frame = pr.cnv?.frame ?? 0;
  const finish = () => {
    applyRatio();
    seedNoise(motion.seed); if (P) P.randomSeed(motion.seed);
    shapeUI(); fillUI(); strokeUI(); flowUI(); tool.pane.refresh();
  };
  Promise.all([loadPromptFont(), loadCharFont()]).then(finish).catch(finish);
}

/////////////////////////////////////////////////////////////////////////////
// Export + OPTIONS + dev hook
/////////////////////////////////////////////////////////////////////////////
attachExport(tool.pages.export, { getCanvas: tool.getCanvas, getSVG: renderSVG, name: 'rastr' });

const presetState = { name: 'Isometric Drift' };
const opts = tool.pages.options;
opts.addBinding(presetState, 'name', { label: 'Preset', options: Object.fromEntries(Object.keys(presets).map((k) => [k, k])) }).on('change', (ev) => applyPreset(ev.value));
opts.addButton({ title: 'Apply / Restart Preset' }).on('click', () => applyPreset(presetState.name));
opts.addButton({ title: 'Randomize Seed' }).on('click', () => { motion.seed = (Math.random() * 10000) | 0; tool.pane.refresh(); seedEvent(); });
opts.addBinding(cnv, 'animation', { label: 'Animate' }).on('change', () => { cnv.frame = 0; });
opts.addBinding(rec.length, 'value', { label: 'Loop Length', min: rec.length.min, max: rec.length.max, step: 1 }).on('change', () => { cnv.frame = 0; });
opts.addButton({ title: 'Fullscreen (f)' }).on('click', () => tool.toggleFullscreen());

window.addEventListener('resize', fitCanvas);
exposeDebug('rastr', {
  applyPreset, regenerate: promptFunction, renderSVG, seedEvent, cnv, prompt, form, motion, rec, presets,
  get particles() { return particles; }, setFrame: (f) => { cnv.frame = f; },
});

shapeUI(); fillUI(); strokeUI(); flowUI();
pendingPreset = 'Isometric Drift';
