// SKAAAN — a scan-line image displacement / glitch tool. The source image is
// transformed by a stack of channels — mouse-drag pan (maap), shift x/y, scale,
// rotation — each channel `none | linear | periodic | noise`-typed and animated
// over a configurable area window. Pressing "Start Scan" sweeps a thin slice
// horizontally or vertically across the result buffer: each frame samples the
// current transformed source slice and pastes it into the result at the
// scan-line, so the channels animate as the scan progresses and the result
// accumulates a displacement-art frame. Optional grain overlay perturbs each
// slice. Drop an image to load your own; default is procedurally generated.
//
// The map2 easings (Linear / Quadratic / Cubic / Quartic / Quintic / Sinusoidal
// / Exponential / Circular / Sqrt × IN / OUT / BOTH) are ported as-is — these
// are standard easing curves (Penner / sighack), kept with attribution.
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachExport } from '../../js/etch/export.js';
import { createNoise2D } from '../../js/vendor/simplex/simplex-noise.js';
import { alea } from '../../js/etch/noise.js';

const { sin, cos, sqrt, pow, abs, min, max, round, floor, ceil, PI } = Math;
const HALF_PI = PI / 2;
const TWO_PI = PI * 2;
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const radians = (deg) => (deg * PI) / 180;
const constrain = (v, lo, hi) => max(lo, min(hi, v));

/////////////////////////////////////////////////////////////////////////////
// map2 — easing-aware map (Manohar Vanga / Jeff Thompson, MIT;
// https://sighack.com/post/easing-functions-in-processing). Kept as-is.
/////////////////////////////////////////////////////////////////////////////
const EASE_IN = 0, EASE_OUT = 1, EASE_BOTH = 2;
function map2(value, s1, e1, s2, e2, type, when) {
  const b = s2, c = e2 - s2;
  let t = value - s1; const d = e1 - s1; const p = 0.5;
  switch (type) {
    case 'Linear': return (c * t) / d + b;
    case 'Sqrt':
      if (when === EASE_IN)  { t /= d; return c * pow(t, p) + b; }
      if (when === EASE_OUT) { t /= d; return c * (1 - pow(1 - t, p)) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * pow(t, p) + b; return (c / 2) * (2 - pow(2 - t, p)) + b;
    case 'Quadratic':
      if (when === EASE_IN)  { t /= d; return c * t * t + b; }
      if (when === EASE_OUT) { t /= d; return -c * t * (t - 2) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * t * t + b; t--; return (-c / 2) * (t * (t - 2) - 1) + b;
    case 'Cubic':
      if (when === EASE_IN)  { t /= d; return c * t * t * t + b; }
      if (when === EASE_OUT) { t /= d; t--; return c * (t * t * t + 1) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * t * t * t + b; t -= 2; return (c / 2) * (t * t * t + 2) + b;
    case 'Quartic':
      if (when === EASE_IN)  { t /= d; return c * t * t * t * t + b; }
      if (when === EASE_OUT) { t /= d; t--; return -c * (t * t * t * t - 1) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * t * t * t * t + b; t -= 2; return (-c / 2) * (t * t * t * t - 2) + b;
    case 'Quintic':
      if (when === EASE_IN)  { t /= d; return c * t * t * t * t * t + b; }
      if (when === EASE_OUT) { t /= d; t--; return c * (t * t * t * t * t + 1) + b; }
      t /= d / 2; if (t < 1) return (c / 2) * t * t * t * t * t + b; t -= 2; return (c / 2) * (t * t * t * t * t + 2) + b;
    case 'Sinusoidal':
      if (when === EASE_IN)  return -c * cos((t / d) * (PI / 2)) + c + b;
      if (when === EASE_OUT) return  c * sin((t / d) * (PI / 2)) + b;
      return (-c / 2) * (cos((PI * t) / d) - 1) + b;
    case 'Exponential':
      if (when === EASE_IN)  return c * pow(2, 10 * (t / d - 1)) + b;
      if (when === EASE_OUT) return c * (-pow(2, (-10 * t) / d) + 1) + b;
      t /= d / 2; if (t < 1) return (c / 2) * pow(2, 10 * (t - 1)) + b; t--; return (c / 2) * (-pow(2, -10 * t) + 2) + b;
    case 'Circular':
      if (when === EASE_IN)  { t /= d; return -c * (sqrt(1 - t * t) - 1) + b; }
      if (when === EASE_OUT) { t /= d; t--; return c * sqrt(1 - t * t) + b; }
      t /= d / 2; if (t < 1) return (-c / 2) * (sqrt(1 - t * t) - 1) + b; t -= 2; return (c / 2) * (sqrt(1 - t * t) + 1) + b;
  }
  return 0;
}

/////////////////////////////////////////////////////////////////////////////
// State — the default parameter tree
/////////////////////////////////////////////////////////////////////////////
const params = { easing: 0.06, frame: 0, mouseDown: false, bg: '#1a1a1f' };
const cnv = { width: 0, height: 0, density: 1, showSource: true, showResult: true };
const layout = { mode: 'layer' };

const scaling = {
  type: 'none', area: { min: 0, max: 100 }, frame: 0,
  base: 100, start: 100, value: 0,
  linear: 85, period: 85, cycle: 5,
  transition: 'Sinusoidal', phase: 0, ease: EASE_BOTH,
  noise: 12, freq: 0.1, seed: rseed(),
};
const rotation = {
  type: 'none', area: { min: 0, max: 100 }, frame: 0,
  base: 0, start: 0, value: 0,
  linear: 90, period: 8, cycle: 4,
  transition: 'Sinusoidal', phase: 0.5, ease: EASE_BOTH,
  noise: 6, freq: 0.1, seed: rseed(),
};
const shift = {
  type: { x: 'none', y: 'none' },
  xArea: { min: 0, max: 100 }, yArea: { min: 0, max: 100 },
  frame: { x: 0, y: 0 }, base: { x: 0, y: 0 }, start: { x: 0, y: 0 },
  value: { x: 0, y: 0 }, size: { x: 0, y: 0 },
  linear: { x: 60, y: 60 }, period: { x: 6, y: 6 }, cycle: { x: 5, y: 5 },
  transition: { x: 'Sinusoidal', y: 'Sinusoidal' }, phase: { x: 0, y: 0 },
  ease: { x: EASE_BOTH, y: EASE_BOTH },
  noise: { x: 6, y: 6 }, freq: { x: 0.12, y: 0.12 },
  seed: { x: rseed(), y: rseed() },
};
const scan = {
  type: 'horizontal', action: false, position: 0, ratio: 1, speed: 2,
  area: { x1: 0, y1: 0, x2: 0, y2: 0 },
  lineColor: '#ff0000d9',
};
const maap = {
  bool: true, raw: { x: 0, y: 0 }, mouse: { x: 0, y: 0 }, delta: { x: 0, y: 0 },
  on: { x: 0, y: 0 }, off: { x: 0, y: 0 }, translate: { x: 0, y: 0 },
  pos: { x: 0, y: 0 }, shade: { x: 0, y: 0 }, remaind: { x: 0, y: 0 },
};
const grain = { type: 'none', opacity: 0.25, coarse: 0.2, frame: 0 };

function rseed() { return floor(Math.random() * 1000); }

const TRANSITIONS = ['Linear', 'Quadratic', 'Cubic', 'Quartic', 'Quintic', 'Sinusoidal', 'Exponential', 'Circular', 'Sqrt'];
const TRANSITION_OPTS = Object.fromEntries(TRANSITIONS.map((t) => [t, t]));
const EASE_OPTS = { 'In': EASE_IN, 'Out': EASE_OUT, 'In & Out': EASE_BOTH };
const SHIFT_TYPES = { None: 'none', Linear: 'linear', Periodic: 'periodic', Noise: 'noise' };
const SCAN_TYPES = { Horizontal: 'horizontal', Vertical: 'vertical' };
const GRAIN_TYPES = { None: 'none', Soft: 'soft', Sharp: 'sharp' };

/////////////////////////////////////////////////////////////////////////////
// Runtime
/////////////////////////////////////////////////////////////////////////////
let P = null, displayCanvas = null;
let imgSource = null, gSource = null, gResult = null;
let GW = 1280, GH = 960;
let mx = 0, my = 0, overCanvas = false, leftDown = false;
let simShiftX, simShiftY, simScale, simRotation, simGrain;

simShiftX = createNoise2D(alea(shift.seed.x));
simShiftY = createNoise2D(alea(shift.seed.y));
simScale = createNoise2D(alea(scaling.seed));
simRotation = createNoise2D(alea(rotation.seed));
simGrain = createNoise2D(alea(rseed()));

/////////////////////////////////////////////////////////////////////////////
// Default procedural image — graphic bands so displacement is visible
/////////////////////////////////////////////////////////////////////////////
function makeDefaultImage() {
  const w = 1280, h = 960;
  const g = P.createGraphics(w, h); g.pixelDensity(1); g.noStroke();
  const n = createNoise2D(alea(909090));
  // base wash
  for (let y = 0; y < h; y++) {
    const t = y / h;
    g.fill(map(t, 0, 1, 245, 8), map(t, 0, 1, 100, 60), map(t, 0, 1, 30, 140));
    g.rect(0, y, w, 1);
  }
  g.push(); g.colorMode(P.HSB, 360, 100, 100, 1);
  // diagonal banner stripes so a shift/displacement is visually obvious
  for (let i = 0; i < 22; i++) {
    g.fill((i * 31) % 360, 90, 95, 0.5);
    g.push(); g.translate(w / 2, h / 2); g.rotate(-0.3); g.rect(-w + i * (w / 11), -h * 1.5, 32, h * 3); g.pop();
  }
  // colour blobs
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const hue = (n(x * 0.002, y * 0.002) * 0.5 + 0.5) * 360;
    g.fill(hue, 70 + Math.random() * 25, 75 + Math.random() * 20, 0.45);
    g.ellipse(x, y, 80 + Math.random() * 220, 80 + Math.random() * 220);
  }
  g.pop();
  const out = g.get(); g.remove();
  return out;
}

function adjustImageSize(image, maxSize = 1600) {
  if (image.width > maxSize || image.height > maxSize) {
    const s = maxSize / max(image.width, image.height);
    const nw = round(image.width * s), nh = round(image.height * s);
    const ri = P.createImage(nw, nh);
    ri.copy(image, 0, 0, image.width, image.height, 0, 0, nw, nh);
    return ri;
  }
  return image;
}

function loadImageAsSource(image) {
  imgSource = adjustImageSize(image).get();
  GW = imgSource.width; GH = imgSource.height;
  if (gSource) gSource.remove();
  if (gResult) gResult.remove();
  gSource = P.createGraphics(imgSource.width, imgSource.height);
  gSource.pixelDensity(1); gSource.imageMode(P.CENTER); gSource.noStroke();
  gResult = P.createGraphics(imgSource.width, imgSource.height);
  gResult.pixelDensity(1); gResult.noStroke();
  P.resizeCanvas(GW, GH); P.pixelDensity(1);
  cnv.width = imgSource.width; cnv.height = imgSource.height;
  resetScan();
  fitCanvas();
}

/////////////////////////////////////////////////////////////////////////////
// Transform channels (ports of shift / scale / rotation Mode functions)
/////////////////////////////////////////////////////////////////////////////
function activeWindow(areaMin, areaMax) {
  const duration = (scan.type === 'horizontal') ? (scan.area.x2 - scan.area.x1) : (scan.area.y2 - scan.area.y1);
  let start = round(duration * (areaMin / 100));
  let end = round(duration * (areaMax / 100));
  start -= start % scan.speed;
  end -= end % scan.speed;
  return { start, end, length: abs(end - start), duration };
}

function shiftAxis(ax, a, sim) {
  // a in {x, y}. Returns nothing — writes to shift.value[a] and shift.frame[a].
  if (shift.type[a] === 'none') { shift.frame[a] = 0; shift.value[a] = 0; shift.size[a] = 0; return; }
  const scanSize = (scan.type === 'horizontal' ? scan.area.x2 - scan.area.x1 : scan.area.y2 - scan.area.y1);
  const w = activeWindow(shift[ax + 'Area'].min, shift[ax + 'Area'].max);
  shift.size[a] = w.length;
  let value, frame, freq;
  switch (shift.type[a]) {
    case 'linear':
      value = map(shift.linear[a], -200, 200, -shift.size[a] * 2, shift.size[a] * 2) + 0.0001;
      frame = value / (shift.size[a] / scan.speed || 1);
      shift.value[a] = map2(shift.frame[a], 0, value, 0, value, shift.transition[a], shift.ease[a]);
      if (scan.action && params.frame >= w.start && params.frame < w.end) shift.frame[a] += frame;
      break;
    case 'periodic':
      value = map(shift.period[a], -50, 50, scanSize / 2, -scanSize / 2);
      frame = shift.cycle[a] / (shift.size[a] / scan.speed || 1);
      shift.value[a] = abs(((2 * shift.frame[a] + shift.phase[a]) % 2) - 1);
      shift.value[a] = map2(shift.value[a], 0, 1, 0, 1, shift.transition[a], shift.ease[a]) * value - value;
      if (scan.action && params.frame >= w.start && params.frame < w.end) shift.frame[a] += frame;
      shift.value[a] += value * shift.phase[a];
      break;
    case 'noise': {
      const noiseValue = radians(map(shift.noise[a], 0, 100, 0, scanSize / 2));
      freq = map2(shift.freq[a], 0.01, 1, 0.002, 0.5, 'Quadratic', EASE_IN);
      const fr = map(sim(shift.frame[a] * freq, 1), -1, 1, -noiseValue, noiseValue) * scan.speed;
      if (scan.action && params.frame >= w.start && params.frame < w.end) { shift.frame[a] += scan.speed; shift.value[a] += fr; }
      break;
    }
  }
}

function shiftMode() {
  shiftAxis('x', 'x', simShiftX);
  if (shift.type.x !== 'none') gSource.translate(shift.value.x, 0);
  shiftAxis('y', 'y', simShiftY);
  if (shift.type.y !== 'none') gSource.translate(0, shift.value.y);
  // base shift (eased)
  const targetX = map(shift.base.x, -100, 100, -gSource.width, gSource.width);
  const targetY = map(shift.base.y, -100, 100, -gSource.height, gSource.height);
  shift.start.x += (targetX - shift.start.x) * params.easing;
  shift.start.y += (targetY - shift.start.y) * params.easing;
  if (abs(shift.base.x - shift.start.x) < 0.001) shift.start.x = shift.base.x;
  if (abs(shift.base.y - shift.start.y) < 0.001) shift.start.y = shift.base.y;
  gSource.translate(shift.start.x, shift.start.y);
}

function scaleMode() {
  if (scaling.type === 'none') { scaling.frame = 0; scaling.value = 0; }
  else {
    const w = activeWindow(scaling.area.min, scaling.area.max);
    let value, frame, freq;
    switch (scaling.type) {
      case 'linear':
        value = scaling.linear <= 100 ? map(scaling.linear, 50, 100, -0.5, 0) : map(scaling.linear, 100, 200, 0, 1);
        frame = value / (w.length / scan.speed || 1);
        scaling.value = map2(scaling.frame, 0, value, 0, value, scaling.transition, scaling.ease);
        if (scan.action && params.frame >= w.start && params.frame < w.end) scaling.frame += frame;
        break;
      case 'periodic':
        value = scaling.period <= 100 ? map(scaling.period, 50, 100, 0.5, 0) : map(scaling.period, 100, 200, 0, -1);
        frame = scaling.cycle / (w.length / scan.speed || 1);
        scaling.value = abs(((2 * scaling.frame + scaling.phase) % 2) - 1);
        scaling.value = map2(scaling.value, 0, 1, 0, 1, scaling.transition, scaling.ease) * value - value;
        if (scan.action && params.frame >= w.start && params.frame < w.end) scaling.frame += frame;
        scaling.value += value * scaling.phase;
        break;
      case 'noise': {
        const v = radians(map2(scaling.noise, 0, 100, 0, 0.5, 'Linear', EASE_IN));
        freq = map2(scaling.freq, 0.01, 1, 0.002, 0.5, 'Quadratic', EASE_IN);
        const fr = map(simScale(scaling.frame * freq, 1), -1, 1, -v, v) * scan.speed;
        if (scan.action && params.frame >= w.start && params.frame < w.end) { scaling.frame += scan.speed; scaling.value += fr; }
        break;
      }
    }
    gSource.scale(1 + scaling.value);
  }
  scaling.start += (scaling.base - scaling.start) * params.easing;
  if (abs(scaling.base - scaling.start) < 0.001) scaling.start = scaling.base;
  const s = scaling.start <= 100 ? map(scaling.start, 50, 100, 0.5, 1) : map(scaling.start, 100, 200, 1, 2);
  gSource.scale(s);
}

function rotationMode() {
  if (rotation.type === 'none') { rotation.frame = 0; rotation.value = 0; }
  else {
    const w = activeWindow(rotation.area.min, rotation.area.max);
    let value, frame, freq;
    switch (rotation.type) {
      case 'linear':
        value = map(rotation.linear, -180, 180, -PI, PI);
        frame = value / (w.length / scan.speed || 1);
        rotation.value = map2(rotation.frame, 0, value, 0, value, rotation.transition, rotation.ease);
        if (scan.action && params.frame >= w.start && params.frame < w.end) rotation.frame += frame;
        break;
      case 'periodic':
        value = map(rotation.period, -90, 90, HALF_PI, -HALF_PI);
        frame = rotation.cycle / (w.length / scan.speed || 1);
        rotation.value = abs(((2 * rotation.frame + rotation.phase) % 2) - 1);
        rotation.value = map2(rotation.value, 0, 1, 0, 1, rotation.transition, rotation.ease) * value - value;
        if (scan.action && params.frame >= w.start && params.frame < w.end) rotation.frame += frame;
        rotation.value += value * rotation.phase;
        break;
      case 'noise': {
        const v = radians(map2(rotation.noise, 0, 100, 0, HALF_PI, 'Linear', EASE_IN));
        freq = map2(rotation.freq, 0.01, 1, 0.002, 0.5, 'Quadratic', EASE_IN);
        const fr = map(simRotation(rotation.frame * freq, 1), -1, 1, -v, v) * scan.speed;
        if (scan.action && params.frame >= w.start && params.frame < w.end) { rotation.frame += scan.speed; rotation.value += fr; }
        break;
      }
    }
    gSource.rotate(rotation.value);
  }
  rotation.start += (rotation.base - rotation.start) * params.easing;
  if (abs(rotation.base - rotation.start) < 0.001) rotation.start = rotation.base;
  gSource.rotate(radians(rotation.start));
}

/////////////////////////////////////////////////////////////////////////////
// maap — mouse-drag pan. Operates in image-space coords.
/////////////////////////////////////////////////////////////////////////////
function maapUse() {
  if (leftDown && overCanvas) {
    maap.raw.x = mx; maap.raw.y = my;
    maap.mouse.x += (maap.raw.x - maap.mouse.x) * params.easing;
    maap.mouse.y += (maap.raw.y - maap.mouse.y) * params.easing;
    if (maap.bool) {
      maap.bool = false;
      maap.delta.x = -maap.raw.x; maap.delta.y = -maap.raw.y;
      maap.mouse.x = maap.raw.x; maap.mouse.y = maap.raw.y;
      if (scan.action) { maap.pos.x = maap.translate.x + maap.remaind.x; maap.pos.y = maap.translate.y + maap.remaind.y; }
    } else if (!scan.action) {
      maap.pos.x = maap.translate.x + maap.remaind.x; maap.pos.y = maap.translate.y + maap.remaind.y;
    } else {
      maap.shade.x = maap.pos.x - maap.translate.x; maap.shade.y = maap.pos.y - maap.translate.y;
    }
    maap.translate.x = maap.mouse.x + maap.delta.x + maap.on.x;
    maap.translate.y = maap.mouse.y + maap.delta.y + maap.on.y;
  } else {
    if (!maap.bool) { maap.off.x = maap.on.x; maap.off.y = maap.on.y; maap.remaind.x = maap.shade.x; maap.remaind.y = maap.shade.y; }
    maap.bool = true;
    maap.on.x = maap.mouse.x + maap.delta.x + maap.off.x; maap.on.y = maap.mouse.y + maap.delta.y + maap.off.y;
    maap.translate.x = maap.mouse.x + maap.delta.x + maap.off.x; maap.translate.y = maap.mouse.y + maap.delta.y + maap.off.y;
  }
  // shade-fade during scan keeps things stable
  const fade = 1 - scan.speed * 0.008;
  if (scan.action) {
    if (scan.type === 'horizontal') { maap.shade.x *= fade; maap.remaind.x *= fade; }
    else { maap.shade.y *= fade; maap.remaind.y *= fade; }
  }
}

function maapClear() {
  maap.bool = true;
  for (const k of ['raw', 'mouse', 'delta', 'on', 'off', 'pos', 'shade', 'remaind', 'translate']) { maap[k].x = 0; maap[k].y = 0; }
}

/////////////////////////////////////////////////////////////////////////////
// Scan — paste a slice from gSource into gResult each frame; advance position
/////////////////////////////////////////////////////////////////////////////
function scanArea() {
  scan.ratio = 1;
  scan.area.x1 = 0; scan.area.y1 = 0;
  scan.area.x2 = imgSource ? imgSource.width : 0;
  scan.area.y2 = imgSource ? imgSource.height : 0;
  scanType();
}
function scanType() {
  scan.position = scan.type === 'horizontal' ? scan.area.x1 : scan.area.y1;
}
function startScanning() {
  let size, mod;
  if (scan.type === 'horizontal') {
    size = scan.area.x2 - scan.area.x1; mod = size % scan.speed;
    if (scan.position <= scan.area.x2 - mod) {
      const c = gSource.get(scan.position, scan.area.y1, scan.speed, scan.area.y2 - scan.area.y1);
      if (grain.type !== 'none') modifySlice(c);
      gResult.image(c, scan.position, scan.area.y1);
      scan.position += scan.speed;
    } else { scanComplete(); }
  } else {
    size = scan.area.y2 - scan.area.y1; mod = size % scan.speed;
    if (scan.position <= scan.area.y2 - mod) {
      const c = gSource.get(scan.area.x1, scan.position, scan.area.x2 - scan.area.x1, scan.speed);
      if (grain.type !== 'none') modifySlice(c);
      gResult.image(c, scan.area.x1, scan.position);
      scan.position += scan.speed;
    } else { scanComplete(); }
  }
}
function scanComplete() {
  scan.action = false; params.frame = 0;
  restartAllChannels();
  scanType();
}
function resetScan() {
  scan.action = false; params.frame = 0;
  if (gResult) gResult.clear();
  maapClear();
  scanArea();
  restartAllChannels();
}
function restartAllChannels() {
  shift.frame.x = 0; shift.frame.y = 0; shift.value.x = 0; shift.value.y = 0;
  scaling.frame = 0; scaling.value = 0;
  rotation.frame = 0; rotation.value = 0;
  grain.frame = 0;
}
function modifySlice(slice) {
  slice.loadPixels();
  const d = slice.pixels;
  const opacity = grain.opacity;
  const coarse = grain.type === 'sharp' ? 0.3 : 0.08;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % slice.width, py = floor((i / 4) / slice.width);
    const n = simGrain(px * coarse + grain.frame * 0.05, py * coarse) * 255 * opacity;
    d[i]     = constrain(d[i] + n, 0, 255);
    d[i + 1] = constrain(d[i + 1] + n, 0, 255);
    d[i + 2] = constrain(d[i + 2] + n, 0, 255);
  }
  grain.frame++;
  slice.updatePixels();
}

/////////////////////////////////////////////////////////////////////////////
// Sketch
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'SKAAAN', version: '0.2' });

function fitCanvas() {
  if (!displayCanvas) return;
  const pad = 24;
  const k = min((window.innerWidth - pad * 2) / GW, (window.innerHeight - pad * 2) / GH, 1);
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
    p.pixelDensity(1); p.noStroke();
    displayCanvas.elt.style.display = 'block';
    displayCanvas.elt.style.cursor = 'grab';
    loadImageAsSource(makeDefaultImage());
    wirePointer();
    fitCanvas();
  };
  p.draw = () => {
    if (!imgSource || !gSource || !gResult) return;
    p.clear();
    p.background(params.bg);

    // Build transformed gSource
    gSource.clear();
    gSource.push();
    gSource.translate(gSource.width / 2, gSource.height / 2);
    maapUse();
    gSource.translate(maap.translate.x, maap.translate.y);
    shiftMode();
    scaleMode();
    rotationMode();
    gSource.image(imgSource, 0, 0, imgSource.width, imgSource.height);
    gSource.pop();

    if (scan.action) { params.frame += scan.speed; startScanning(); }

    if (cnv.showSource) p.image(gSource, 0, 0, p.width, p.height);
    if (scan.action) drawScanFill(p);
    if (cnv.showResult) p.image(gResult, 0, 0, p.width, p.height);
  };
  p.windowResized = () => fitCanvas();
});

function drawScanFill(p) {
  p.push(); p.noStroke(); p.fill(scan.lineColor);
  if (scan.type === 'horizontal') {
    p.rect(scan.area.x1, scan.area.y1, scan.position - scan.area.x1, scan.area.y2 - scan.area.y1);
  } else {
    p.rect(scan.area.x1, scan.area.y1, scan.area.x2 - scan.area.x1, scan.position - scan.area.y1);
  }
  p.pop();
}

/////////////////////////////////////////////////////////////////////////////
// Pointer + drop
/////////////////////////////////////////////////////////////////////////////
function pointerToImage(e) {
  const r = displayCanvas.elt.getBoundingClientRect();
  mx = (e.clientX - r.left) / r.width * GW;
  my = (e.clientY - r.top) / r.height * GH;
}
function wirePointer() {
  const el = displayCanvas.elt;
  el.addEventListener('pointerenter', () => { overCanvas = true; });
  el.addEventListener('pointerleave', () => { overCanvas = false; });
  el.addEventListener('pointermove', (e) => pointerToImage(e));
  el.addEventListener('pointerdown', (e) => { if (e.button === 0) { leftDown = true; pointerToImage(e); el.style.cursor = 'grabbing'; } });
  window.addEventListener('pointerup', (e) => { if (e.button === 0 && leftDown) { leftDown = false; el.style.cursor = 'grab'; } });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file || !/^image\//i.test(file.type) || file.type === 'image/svg+xml') return;
  const url = URL.createObjectURL(file);
  P.loadImage(url, (im) => { loadImageAsSource(im); URL.revokeObjectURL(url); }, () => URL.revokeObjectURL(url));
});

/////////////////////////////////////////////////////////////////////////////
// UI
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;

main.addButton({ title: 'Start / Stop Scan (Space)' }).on('click', toggleScan);
main.addButton({ title: 'Reset Scan' }).on('click', () => { resetScan(); });
main.addButton({ title: 'Copy Result → Source' }).on('click', () => { if (gResult) { imgSource = gResult.get(); resetScan(); } });
main.addButton({ title: 'Clear Result' }).on('click', () => { if (gResult) gResult.clear(); });
main.addButton({ title: 'New Default Image' }).on('click', () => loadImageAsSource(makeDefaultImage()));

const fCanvas = main.addFolder({ title: 'CANVAS', expanded: false });
fCanvas.addBinding(params, 'bg', { label: 'Back Color', view: 'color' });
fCanvas.addBinding(cnv, 'showSource', { label: 'Show Source' });
fCanvas.addBinding(cnv, 'showResult', { label: 'Show Result' });
fCanvas.addBinding(params, 'easing', { label: 'Easing', min: 0.01, max: 0.4, step: 0.01 });

const fScan = main.addFolder({ title: 'SCAN' });
fScan.addBinding(scan, 'type', { label: 'Direction', options: SCAN_TYPES }).on('change', () => { resetScan(); });
fScan.addBinding(scan, 'speed', { label: 'Speed', min: 1, max: 16, step: 1 });
fScan.addBinding(scan, 'lineColor', { label: 'Scan Color', view: 'color' });

const fShift = main.addFolder({ title: 'SHIFT', expanded: false });
// X axis
const sxType = fShift.addBinding(shift.type, 'x', { label: 'X Type', options: SHIFT_TYPES }).on('change', () => { restartAllChannels(); refreshAnimUI(); });
const sxArea = fShift.addBinding(shift.xArea, 'min', { label: 'X Area Min %', min: 0, max: 100, step: 1 });
const sxArea2 = fShift.addBinding(shift.xArea, 'max', { label: 'X Area Max %', min: 0, max: 100, step: 1 });
const sxLin = fShift.addBinding(shift.linear, 'x', { label: 'X Linear', min: -200, max: 200, step: 1 });
const sxPer = fShift.addBinding(shift.period, 'x', { label: 'X Period', min: -50, max: 50, step: 1 });
const sxCyc = fShift.addBinding(shift.cycle, 'x', { label: 'X Cycles', min: 0.5, max: 20, step: 0.5 });
const sxPha = fShift.addBinding(shift.phase, 'x', { label: 'X Phase', min: 0, max: 1, step: 0.01 });
const sxNoi = fShift.addBinding(shift.noise, 'x', { label: 'X Noise %', min: 0, max: 100, step: 1 });
const sxFrq = fShift.addBinding(shift.freq, 'x', { label: 'X Noise Freq', min: 0.01, max: 1, step: 0.01 });
const sxTr  = fShift.addBinding(shift.transition, 'x', { label: 'X Easing', options: TRANSITION_OPTS });
const sxEa  = fShift.addBinding(shift.ease, 'x', { label: 'X Ease', options: EASE_OPTS });
fShift.addBinding(shift.base, 'x', { label: 'X Base %', min: -100, max: 100, step: 1 });
fShift.addBlade?.({ view: 'separator' });
// Y axis
const syType = fShift.addBinding(shift.type, 'y', { label: 'Y Type', options: SHIFT_TYPES }).on('change', () => { restartAllChannels(); refreshAnimUI(); });
const syArea = fShift.addBinding(shift.yArea, 'min', { label: 'Y Area Min %', min: 0, max: 100, step: 1 });
const syArea2 = fShift.addBinding(shift.yArea, 'max', { label: 'Y Area Max %', min: 0, max: 100, step: 1 });
const syLin = fShift.addBinding(shift.linear, 'y', { label: 'Y Linear', min: -200, max: 200, step: 1 });
const syPer = fShift.addBinding(shift.period, 'y', { label: 'Y Period', min: -50, max: 50, step: 1 });
const syCyc = fShift.addBinding(shift.cycle, 'y', { label: 'Y Cycles', min: 0.5, max: 20, step: 0.5 });
const syPha = fShift.addBinding(shift.phase, 'y', { label: 'Y Phase', min: 0, max: 1, step: 0.01 });
const syNoi = fShift.addBinding(shift.noise, 'y', { label: 'Y Noise %', min: 0, max: 100, step: 1 });
const syFrq = fShift.addBinding(shift.freq, 'y', { label: 'Y Noise Freq', min: 0.01, max: 1, step: 0.01 });
const syTr  = fShift.addBinding(shift.transition, 'y', { label: 'Y Easing', options: TRANSITION_OPTS });
const syEa  = fShift.addBinding(shift.ease, 'y', { label: 'Y Ease', options: EASE_OPTS });
fShift.addBinding(shift.base, 'y', { label: 'Y Base %', min: -100, max: 100, step: 1 });

const fScale = main.addFolder({ title: 'SCALE', expanded: false });
const scTy = fScale.addBinding(scaling, 'type', { label: 'Type', options: SHIFT_TYPES }).on('change', () => { restartAllChannels(); refreshAnimUI(); });
const scAr1 = fScale.addBinding(scaling.area, 'min', { label: 'Area Min %', min: 0, max: 100, step: 1 });
const scAr2 = fScale.addBinding(scaling.area, 'max', { label: 'Area Max %', min: 0, max: 100, step: 1 });
const scLin = fScale.addBinding(scaling, 'linear', { label: 'Linear', min: 50, max: 200, step: 1 });
const scPer = fScale.addBinding(scaling, 'period', { label: 'Period', min: 50, max: 200, step: 1 });
const scCyc = fScale.addBinding(scaling, 'cycle', { label: 'Cycles', min: 0.5, max: 20, step: 0.5 });
const scPha = fScale.addBinding(scaling, 'phase', { label: 'Phase', min: 0, max: 1, step: 0.01 });
const scNoi = fScale.addBinding(scaling, 'noise', { label: 'Noise %', min: 0, max: 100, step: 1 });
const scFrq = fScale.addBinding(scaling, 'freq', { label: 'Noise Freq', min: 0.01, max: 1, step: 0.01 });
const scTr  = fScale.addBinding(scaling, 'transition', { label: 'Easing', options: TRANSITION_OPTS });
const scEa  = fScale.addBinding(scaling, 'ease', { label: 'Ease', options: EASE_OPTS });
fScale.addBinding(scaling, 'base', { label: 'Base %', min: 50, max: 200, step: 1 });

const fRot = main.addFolder({ title: 'ROTATION', expanded: false });
const rTy = fRot.addBinding(rotation, 'type', { label: 'Type', options: SHIFT_TYPES }).on('change', () => { restartAllChannels(); refreshAnimUI(); });
const rAr1 = fRot.addBinding(rotation.area, 'min', { label: 'Area Min %', min: 0, max: 100, step: 1 });
const rAr2 = fRot.addBinding(rotation.area, 'max', { label: 'Area Max %', min: 0, max: 100, step: 1 });
const rLin = fRot.addBinding(rotation, 'linear', { label: 'Linear °', min: -180, max: 180, step: 1 });
const rPer = fRot.addBinding(rotation, 'period', { label: 'Period °', min: -90, max: 90, step: 1 });
const rCyc = fRot.addBinding(rotation, 'cycle', { label: 'Cycles', min: 0.5, max: 20, step: 0.5 });
const rPha = fRot.addBinding(rotation, 'phase', { label: 'Phase', min: 0, max: 1, step: 0.01 });
const rNoi = fRot.addBinding(rotation, 'noise', { label: 'Noise %', min: 0, max: 100, step: 1 });
const rFrq = fRot.addBinding(rotation, 'freq', { label: 'Noise Freq', min: 0.01, max: 1, step: 0.01 });
const rTr  = fRot.addBinding(rotation, 'transition', { label: 'Easing', options: TRANSITION_OPTS });
const rEa  = fRot.addBinding(rotation, 'ease', { label: 'Ease', options: EASE_OPTS });
fRot.addBinding(rotation, 'base', { label: 'Base °', min: -180, max: 180, step: 1 });

const fGrain = main.addFolder({ title: 'GRAIN', expanded: false });
fGrain.addBinding(grain, 'type', { label: 'Grain', options: GRAIN_TYPES });
fGrain.addBinding(grain, 'opacity', { label: 'Opacity', min: 0, max: 1, step: 0.01 });
fGrain.addBinding(grain, 'coarse', { label: 'Coarse', min: 0.05, max: 1, step: 0.01 });

function refreshAnimUI() {
  const show = (ctl, on) => { if (ctl) ctl.hidden = !on; };
  const isLin = (t) => t === 'linear';
  const isPer = (t) => t === 'periodic';
  const isNoi = (t) => t === 'noise';
  const isAnim = (t) => t !== 'none';
  // Shift X
  show(sxArea, isAnim(shift.type.x)); show(sxArea2, isAnim(shift.type.x));
  show(sxLin, isLin(shift.type.x));
  show(sxPer, isPer(shift.type.x)); show(sxCyc, isPer(shift.type.x)); show(sxPha, isPer(shift.type.x));
  show(sxNoi, isNoi(shift.type.x)); show(sxFrq, isNoi(shift.type.x));
  show(sxTr, isLin(shift.type.x) || isPer(shift.type.x));
  show(sxEa, isLin(shift.type.x) || isPer(shift.type.x));
  // Shift Y
  show(syArea, isAnim(shift.type.y)); show(syArea2, isAnim(shift.type.y));
  show(syLin, isLin(shift.type.y));
  show(syPer, isPer(shift.type.y)); show(syCyc, isPer(shift.type.y)); show(syPha, isPer(shift.type.y));
  show(syNoi, isNoi(shift.type.y)); show(syFrq, isNoi(shift.type.y));
  show(syTr, isLin(shift.type.y) || isPer(shift.type.y));
  show(syEa, isLin(shift.type.y) || isPer(shift.type.y));
  // Scale
  show(scAr1, isAnim(scaling.type)); show(scAr2, isAnim(scaling.type));
  show(scLin, isLin(scaling.type));
  show(scPer, isPer(scaling.type)); show(scCyc, isPer(scaling.type)); show(scPha, isPer(scaling.type));
  show(scNoi, isNoi(scaling.type)); show(scFrq, isNoi(scaling.type));
  show(scTr, isLin(scaling.type) || isPer(scaling.type));
  show(scEa, isLin(scaling.type) || isPer(scaling.type));
  // Rotation
  show(rAr1, isAnim(rotation.type)); show(rAr2, isAnim(rotation.type));
  show(rLin, isLin(rotation.type));
  show(rPer, isPer(rotation.type)); show(rCyc, isPer(rotation.type)); show(rPha, isPer(rotation.type));
  show(rNoi, isNoi(rotation.type)); show(rFrq, isNoi(rotation.type));
  show(rTr, isLin(rotation.type) || isPer(rotation.type));
  show(rEa, isLin(rotation.type) || isPer(rotation.type));
}

/////////////////////////////////////////////////////////////////////////////
// Presets — quick configs for the channel stack (original named)
/////////////////////////////////////////////////////////////////////////////
const presets = {
  'Liquid Slip': { shift: { type: { x: 'noise', y: 'noise' }, noise: { x: 35, y: 18 }, freq: { x: 0.18, y: 0.22 } }, scaling: { type: 'none' }, rotation: { type: 'none' }, scan: { type: 'horizontal', speed: 2 }, grain: { type: 'none' } },
  'Vertical Bleed': { shift: { type: { x: 'none', y: 'linear' }, linear: { x: 60, y: 180 } }, scaling: { type: 'none' }, rotation: { type: 'none' }, scan: { type: 'vertical', speed: 2 }, grain: { type: 'none' } },
  'Periodic Drift': { shift: { type: { x: 'periodic', y: 'none' }, period: { x: 28, y: 6 }, cycle: { x: 4, y: 5 }, phase: { x: 0.2, y: 0 }, transition: { x: 'Sinusoidal', y: 'Sinusoidal' }, ease: { x: EASE_BOTH, y: EASE_BOTH } }, scaling: { type: 'none' }, rotation: { type: 'none' }, scan: { type: 'horizontal', speed: 2 }, grain: { type: 'none' } },
  'Whirl Compress': { shift: { type: { x: 'none', y: 'none' } }, scaling: { type: 'periodic', period: 145, cycle: 6, phase: 0.3, transition: 'Sinusoidal', ease: EASE_BOTH }, rotation: { type: 'noise', noise: 22, freq: 0.2 }, scan: { type: 'horizontal', speed: 2 }, grain: { type: 'none' } },
  'Scan Static': { shift: { type: { x: 'noise', y: 'none' }, noise: { x: 22, y: 6 }, freq: { x: 0.4, y: 0.12 } }, scaling: { type: 'none' }, rotation: { type: 'none' }, scan: { type: 'horizontal', speed: 1 }, grain: { type: 'sharp', opacity: 0.5, coarse: 0.5 } },
};

function deepMerge(dst, src) {
  for (const k of Object.keys(src)) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) { dst[k] = dst[k] || {}; deepMerge(dst[k], src[k]); }
    else dst[k] = src[k];
  }
}
function applyPreset(name) {
  const pr = typeof name === 'string' ? presets[name] : name;
  if (!pr) return;
  if (pr.shift)    deepMerge(shift, pr.shift);
  if (pr.scaling)  deepMerge(scaling, pr.scaling);
  if (pr.rotation) deepMerge(rotation, pr.rotation);
  if (pr.scan)     deepMerge(scan, pr.scan);
  if (pr.grain)    deepMerge(grain, pr.grain);
  resetScan();
  refreshAnimUI();
  tool.pane.refresh();
}

/////////////////////////////////////////////////////////////////////////////
// Scan controls
/////////////////////////////////////////////////////////////////////////////
function toggleScan() {
  if (!scan.action) {
    // start fresh from the area's start edge
    if (scan.type === 'horizontal' && scan.position >= scan.area.x2) scan.position = scan.area.x1;
    if (scan.type === 'vertical' && scan.position >= scan.area.y2) scan.position = scan.area.y1;
    restartAllChannels();
    scan.action = true;
  } else {
    scan.action = false;
  }
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'Space') { toggleScan(); e.preventDefault(); }
  else if (e.code === 'KeyR') { resetScan(); e.preventDefault(); }
  else if (e.code === 'KeyC') { if (gResult) gResult.clear(); e.preventDefault(); }
  else if (e.code === 'KeyI') { cnv.showSource = !cnv.showSource; tool.pane.refresh(); e.preventDefault(); }
});

/////////////////////////////////////////////////////////////////////////////
// Export + OPTIONS + dev hook
/////////////////////////////////////////////////////////////////////////////
attachExport(tool.pages.export, { getCanvas: tool.getCanvas, name: 'skaaan' });

const presetState = { name: 'Liquid Slip' };
const opts = tool.pages.options;
opts.addBinding(presetState, 'name', { label: 'Preset', options: Object.fromEntries(Object.keys(presets).map((k) => [k, k])) }).on('change', (ev) => applyPreset(ev.value));
opts.addButton({ title: 'Apply Preset' }).on('click', () => applyPreset(presetState.name));
opts.addButton({ title: 'Start / Stop Scan (Space)' }).on('click', toggleScan);
opts.addButton({ title: 'Reset Scan (R)' }).on('click', resetScan);
opts.addButton({ title: 'Clear Result (C)' }).on('click', () => { if (gResult) gResult.clear(); });
opts.addButton({ title: 'Fullscreen (f)' }).on('click', () => tool.toggleFullscreen());

window.addEventListener('resize', fitCanvas);
exposeDebug('skaaan', {
  params, shift, scaling, rotation, scan, maap, grain, presets,
  toggleScan, resetScan, applyPreset, loadImageAsSource, makeDefaultImage,
  get img() { return imgSource; }, get scanning() { return scan.action; },
});

refreshAnimUI();
// Auto-apply a starter preset once the engine is ready
setTimeout(() => applyPreset('Liquid Slip'), 0);
