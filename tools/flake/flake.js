// FLAKE — generative symmetrical patterns from a dense point field: thousands of
// shape stamps over a shuffled grid, where a single 4D-simplex sample per point
// drives BOTH the stamp's size (a triangle wave within each palette band →
// concentric rings) AND its color, with radial branch symmetry, swirl, a
// parametric polar mask, and looped motion. Shapes blend on a transparent
// buffer, then composite over the bg. Math runs in a fixed render-space (the
// ratio resolution) so parameter magnitudes stay stable across canvas sizes.
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachExport } from '../../js/etch/export.js';
import { seedNoise, noise4D, alea } from '../../js/etch/noise.js';
import { buildLayers, toTransitionStops, paletteLerp, attachPaletteControls } from '../../js/etch/palette.js';

/////////////////////////////////////////////////////////////////////////////
// Small math helpers
/////////////////////////////////////////////////////////////////////////////
const PI = Math.PI, TWO_PI = Math.PI * 2, HALF_PI = Math.PI / 2;
const { sin, cos, atan2, sqrt, pow, log, abs, floor, ceil } = Math;
const min = Math.min, max = Math.max;
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
const constrain = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (x0, y0, x1, y1) => Math.hypot(x1 - x0, y1 - y0);
const round2 = (v, n = 0) => { const f = 10 ** n; return Math.round(v * f) / f; };

/////////////////////////////////////////////////////////////////////////////
// Easing (standard Penner set, keyed by label like the reference)
/////////////////////////////////////////////////////////////////////////////
const EASE = {
  none: (t) => t, Linear: (t) => t,
  'Sine In': (t) => 1 - cos((t * PI) / 2),
  'Sine Out': (t) => sin((t * PI) / 2),
  'Sine In Out': (t) => -(cos(PI * t) - 1) / 2,
  'Quad In': (t) => t * t,
  'Quad Out': (t) => 1 - (1 - t) * (1 - t),
  'Quad In Out': (t) => (t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2),
  'Cubic In': (t) => t * t * t,
  'Cubic Out': (t) => 1 - pow(1 - t, 3),
  'Cubic In Out': (t) => (t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2),
  'Expo In': (t) => (t === 0 ? 0 : pow(2, 10 * t - 10)),
  'Expo Out': (t) => (t === 1 ? 1 : 1 - pow(2, -10 * t)),
  'Expo In Out': (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? pow(2, 20 * t - 10) / 2 : (2 - pow(2, -20 * t + 10)) / 2),
  'Circ In': (t) => 1 - sqrt(1 - t * t),
  'Circ Out': (t) => sqrt(1 - pow(t - 1, 2)),
  'Circ In Out': (t) => (t < 0.5 ? (1 - sqrt(1 - pow(2 * t, 2))) / 2 : (sqrt(1 - pow(-2 * t + 2, 2)) + 1) / 2),
};
const EASE_OPTS = Object.fromEntries(['none', 'Linear', 'Sine In', 'Sine Out', 'Sine In Out', 'Quad In', 'Quad Out', 'Quad In Out', 'Cubic In', 'Cubic Out', 'Cubic In Out', 'Expo In', 'Expo Out', 'Expo In Out', 'Circ In', 'Circ Out', 'Circ In Out'].map((k) => [k === 'none' ? 'None' : k, k]));

/////////////////////////////////////////////////////////////////////////////
// Option maps
/////////////////////////////////////////////////////////////////////////////
const RATIOS = {
  '2:1': [480, 240], '16:9': [640, 360], '3:2': [480, 320], '4:3': [480, 360],
  '5:4': [600, 480], '1:1': [480, 480], '4:5': [480, 600], '3:4': [360, 480],
  '2:3': [320, 480], '9:16': [360, 640], '1:2': [240, 480],
};
const RATIO_OPTS = Object.fromEntries(Object.keys(RATIOS).map((k) => [k, k]));
const BLENDS = {
  Normal: 'source-over', XOR: 'xor', Lighter: 'lighter', Multiply: 'multiply',
  Screen: 'screen', Overlay: 'overlay', Darken: 'darken', Lighten: 'lighten',
  'Color Dodge': 'color-dodge', 'Color Burn': 'color-burn', 'Hard Light': 'hard-light',
  'Soft Light': 'soft-light', Exclusion: 'exclusion', Difference: 'difference',
};
const STYLE_OPTS = { Fill: 'fill', Stroke: 'stroke', Mixed: 'mixed' };
const COLOR_OPTS = { 'Solid Color': 'color', 'Palette Sequence': 'sequence', 'Palette Transition': 'transition' };
const FREQ_OPTS = { Sin: 'sin', Cos: 'cos' };
const SWIRL_OPTS = { None: 'none', 'Wave Effect': 'wave', 'Rotary Effect': 'rotary' };
const SYMMETRY_OPTS = { Standard: 'standard', Mirrored: 'mirror' };
const MOTION_OPTS = { 'Scaling (One Way)': 'oneway', 'Scaling (Loop)': 'loop', 'Noise (Loop)': 'noise' };
const MASK_OPTS = { None: 'none', Parametric: 'parametric', 'Raster Image': 'image' };
const MASK_BRANCH_OPTS = { 'Ignore Noise Branch Angle': 'ignore', 'Apply Noise Branch Angle': 'apply' };
const BG_OPTS = { Custom: 'custom', Transparent: 'transparent' };

/////////////////////////////////////////////////////////////////////////////
// Shape library — built as Path2D in a 0..10 box (centre offset = 5,5), so a
// `scale` of N draws a stamp ~10·N px. All shapes authored here (no copied art).
/////////////////////////////////////////////////////////////////////////////
const SHAPE_OPTS = {
  Square: 'square', Circle: 'circle', Oval: 'oval', Triangle: 'triangle',
  Diamond: 'diamond', Hexagon: 'hexagon', Star: 'star', Spark: 'spark',
  Cross: 'cross', Plus: 'plus', Ring: 'ring', Heart: 'heart', Flower: 'flower',
  Flake: 'flake', 'Quad Dots': 'quad', 'Three Dots': 'threedots', 'Custom (SVG)': 'custom',
};
const SHAPE_W = 5, SHAPE_H = 5; // half-extents of the 0..10 box

// Each shape is one or more closed polylines (point arrays) in a 0..10 box, so
// the SAME geometry yields a Path2D (canvas) and an SVG `d` string (export).
const arcPts = (cx, cy, rx, ry, n = 48, rot = 0) => Array.from({ length: n }, (_, i) => {
  const a = rot + (i / n) * TWO_PI; return [cx + cos(a) * rx, cy + sin(a) * ry];
});
const ngonPts = (cx, cy, r, n, rot = -HALF_PI) => Array.from({ length: n }, (_, i) => {
  const a = rot + (i / n) * TWO_PI; return [cx + cos(a) * r, cy + sin(a) * r];
});
const starPts = (cx, cy, ro, ri, points, rot = -HALF_PI) => Array.from({ length: points * 2 }, (_, i) => {
  const a = rot + (i / (points * 2)) * TWO_PI; const r = i % 2 ? ri : ro; return [cx + cos(a) * r, cy + sin(a) * r];
});
function shapeSubpaths(type) {
  switch (type) {
    case 'square': return [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    case 'circle': return [arcPts(5, 5, 5, 5)];
    case 'oval': return [arcPts(5, 5, 5, 2.9)];
    case 'triangle': return [ngonPts(5, 5.2, 5, 3)];
    case 'diamond': return [ngonPts(5, 5, 5, 4, 0)];
    case 'hexagon': return [ngonPts(5, 5, 5, 6)];
    case 'star': return [starPts(5, 5, 5, 2.1, 5)];
    case 'spark': return [starPts(5, 5, 5, 1.2, 4)];
    case 'flake': return [starPts(5, 5, 5, 1.7, 6)];
    case 'cross': return [starPts(5, 5, 5, 1.6, 4, -HALF_PI + PI / 4)];
    case 'plus': { const t = 3, a = 5 - t / 2, b = 5 + t / 2; return [[[a, 0], [b, 0], [b, a], [10, a], [10, b], [b, b], [b, 10], [a, 10], [a, b], [0, b], [0, a], [a, a]]]; }
    case 'ring': return [arcPts(5, 5, 5, 5), arcPts(5, 5, 2.6, 2.6)];
    case 'heart': return [Array.from({ length: 49 }, (_, i) => { const t = (i / 48) * TWO_PI; return [5 + 0.31 * (16 * sin(t) ** 3), 5 - 0.31 * (13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t)) - 0.4]; })];
    case 'flower': { const s = []; for (let i = 0; i < 6; i++) { const a = (i / 6) * TWO_PI; s.push(arcPts(5 + cos(a) * 3, 5 + sin(a) * 3, 2.1, 2.1, 24)); } s.push(arcPts(5, 5, 2.3, 2.3, 24)); return s; }
    case 'quad': return [[2.5, 2.5], [7.5, 2.5], [2.5, 7.5], [7.5, 7.5]].map(([x, y]) => arcPts(x, y, 2.5, 2.5, 24));
    case 'threedots': return [[5, 2.4], [2.4, 7.2], [7.6, 7.2]].map(([x, y]) => arcPts(x, y, 2.2, 2.2, 24));
    default: return [arcPts(5, 5, 5, 5)];
  }
}
function subpathsToD(subs) {
  return subs.map((pts) => 'M' + pts.map(([x, y], i) => `${i ? 'L' : ''}${round2(x, 3)},${round2(y, 3)}`).join(' ') + 'Z').join(' ');
}
// Set both representations from the active shape (custom = a dropped SVG path).
function refreshShape() {
  shape.d = shape.type === 'custom' && shape.customD ? shape.customD : subpathsToD(shapeSubpaths(shape.type));
  shape.path = new Path2D(shape.d);
}

/////////////////////////////////////////////////////////////////////////////
// State (faithful defaults; preset NAMES & palettes are original)
/////////////////////////////////////////////////////////////////////////////
const seed = { value: 0, max: 100000 };
const cnv = { scale: 0.9, ratio: '1:1', animation: false, frame: 0, bg: { mode: 'custom', custom: '#FFFFFF' } };

const params = {
  count: { value: 5000, min: 500, max: 16000, step: 25 },
  grid: { x: 2, y: 2 },
  scale: { value: 2.5, power: 1.4, easeType: 'none', easeOffset: 0.5 },
  stroke: { width: 1, scale: false, minWidth: 0.25, maxWidth: 3 },
  color: { mixed: 0.5, style: 'fill', blend: 'source-over', type: 'transition', base: '#0055ff' },
  branch: { amount: 4, amountMax: 10, angle: 1, symmetry: 'standard' },
  freq: { mode: 'sin', easeType: 'none', easeOffset: 0, layers: 12, minLayers: 2, maxLayers: 16, base: 0.55, amp: 0.3 },
  swirl: { mode: 'none', base: 0, amp: 0.25, freq: 0.25 },
  rotate: { mult: -0.17, shape: 0.17 },
  motion: { mode: 'noise', amp: 20 },
};
const pattern = { seed: { value: 0, random: 0 }, cells: { x: 1, y: 1 }, offset: { x: 0, y: 0 }, rotate: 0 };
const mask = {
  mode: 'none', branchMode: 'ignore', branch: 0, maxBranch: 12, branchRound: false,
  margin: { min: 0.25, max: 0.9 },
  image: { src: null, lum: null, scale: 1, brightness: 0, contrast: 1, invertLight: false },
};
const shape = { type: 'flake', width: SHAPE_W, height: SHAPE_H, path: null, d: null, customD: null };
const palette = {
  array: ['#FFFFFF', '#D1D1D1', '#808080', '#585858', '#000000'],
  use: [true, true, true, true, true],
  temp: [],
};
const rec = { frameRate: 30, length: { value: 10, min: 1, max: 60 } };

// Snapshot of defaults so each preset applies onto a clean slate (no carry-over
// of params a preset doesn't mention). Captured before the buffer/shape exist.
const DEFAULTS = structuredClone({ params, pattern, mask, cnv, palette, shape });

/////////////////////////////////////////////////////////////////////////////
// Palette (shared module): cycle active colors to freq.layers, seed-shuffle,
// and build gradient stops for transition mode.
/////////////////////////////////////////////////////////////////////////////
function rebuildPalette() {
  const active = palette.array.filter((_, i) => palette.use[i]);
  const temp = buildLayers(active, params.freq.layers, alea(seed.value));
  palette.temp = params.color.type === 'transition' ? toTransitionStops(temp) : temp;
}

/////////////////////////////////////////////////////////////////////////////
// Noise (shared alea-seeded simplex; sampled in 4D so two dims animate the loop)
/////////////////////////////////////////////////////////////////////////////
function reseedNoise() { seedNoise(seed.value); }

/////////////////////////////////////////////////////////////////////////////
// Per-point precompute (port of generateFrameData): everything that doesn't
// change across animation frames. `frame` then only advances the noise sample.
/////////////////////////////////////////////////////////////////////////////
let frameData = {};
let GW = 480, GH = 480; // render-space dimensions (the ratio resolution)

function maxTileDistance(col, row, xSize, ySize, xc, yc) {
  const x0 = col * xSize, x1 = (col + 1) * xSize, y0 = row * ySize, y1 = (row + 1) * ySize;
  return max(dist(xc, yc, x0, y0), dist(xc, yc, x1, y0), dist(xc, yc, x1, y1), dist(xc, yc, x0, y1));
}
function generatePoints(p, width, height) {
  p.randomSeed(seed.value);
  const gx = params.grid.x, gy = params.grid.y;
  const cols = floor(width / gx), rows = floor(height / gy);
  const pts = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) pts.push([i * gx, j * gy]);
  for (let i = pts.length - 1; i > 0; i--) { const j = floor(p.random(i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  return pts.slice(0, params.count.value);
}
function canvasOffset(points, width, height) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { x: width / 2 - (minX + maxX) / 2, y: height / 2 - (minY + maxY) / 2 };
}
function seedGrid(p, cols, rows, randomAmount = 0, maxValue = 5) {
  const grid = [];
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const maxDist = max(sqrt(cx * cx + cy * cy), 0.0001);
  for (let i = 0; i < cols; i++) { grid[i] = []; for (let j = 0; j < rows; j++) {
    const dx = i - cx, dy = j - cy; const norm = sqrt(dx * dx + dy * dy) / maxDist;
    grid[i][j] = norm * maxValue + p.random(-randomAmount, randomAmount);
  } }
  const ci = floor(cols / 2), cj = floor(rows / 2);
  if (cols >= 2 && rows >= 2 && cols % 2 === 0 && rows % 2 === 0) {
    grid[ci][cj] = 0; grid[ci - 1][cj] = 0; grid[ci][cj - 1] = 0; grid[ci - 1][cj - 1] = 0;
  } else grid[ci][cj] = 0;
  return grid;
}

function generateFrameData(p) {
  const fd = {};
  fd.translate = { x: GW * (1 - cnv.scale) * 0.5, y: GH * (1 - cnv.scale) * 0.5 };
  fd.colorRatio = params.color.mixed;
  fd.colorBlend = params.color.blend;
  fd.canvasScale = cnv.scale;
  fd.sizeScale = params.scale.value;
  fd.sizePower = params.scale.power;
  fd.strokeWidth = params.stroke.width;
  fd.strokeScale = params.stroke.scale ? 1 : 0;
  fd.strokeControl = params.stroke.scale ? 0 : 1;
  fd.motionMode = params.motion.mode;
  const motionMax = params.freq.base * 0.2 + 0.01;
  fd.motionAmp = map(params.motion.amp, -100, 100, -motionMax, motionMax) * rec.length.value;

  const data = generatePoints(p, GW, GH);
  const gridSeed = seedGrid(p, pattern.cells.x, pattern.cells.y, pattern.seed.random);
  fd.offset = canvasOffset(data, GW, GH);
  fd.count = data.length;
  fd.x = []; fd.y = []; fd.seed = []; fd.noise = []; fd.freq = []; fd.scaleEase = []; fd.rotate = []; fd.randomColor = [];
  fd.color = []; fd.scale = []; fd.strokeSize = [];

  p.randomSeed(seed.value);

  for (let i = 0; i < fd.count; i++) {
    const x = data[i][0], y = data[i][1];
    const xOffset = fd.offset.x / pattern.cells.x, yOffset = fd.offset.y / pattern.cells.y;
    const xSize = GW / pattern.cells.x, ySize = GH / pattern.cells.y;
    const col = floor(x / xSize), row = floor(y / ySize);
    const xShift = (col + 0.5) * xSize - GW / 2, yShift = (row + 0.5) * ySize - GH / 2;
    const xCenter = ((col * 2 + 1) * xSize) / 2 - xOffset, yCenter = ((row * 2 + 1) * ySize) / 2 - yOffset;

    const xCenterShift = xCenter - xShift * pattern.offset.x, yCenterShift = yCenter - yShift * pattern.offset.y;
    const vxShift = x - xCenterShift, vyShift = y - yCenterShift;
    const tileCenterShift = maxTileDistance(col, row, xSize, ySize, xCenterShift, yCenterShift);
    let centerDistance = sqrt(vxShift * vxShift + vyShift * vyShift);
    const scaleDistance = centerDistance / tileCenterShift;
    const freqDistance = centerDistance / tileCenterShift;
    const centerDirection = atan2(vxShift, vyShift);
    const centerAngle = atan2(xCenterShift - x, yCenterShift - y);

    const maskDistance = centerDistance;
    const maskMax = tileCenterShift * max(0.05, mask.margin.max);
    const maskMin = tileCenterShift * min(0.95, mask.margin.min);

    const shapeRotate = map(params.rotate.shape, -1, 1, -PI, PI);
    const shapeRotateDirection = centerAngle * map(params.rotate.mult, -1, 1, -TWO_PI, TWO_PI);
    const patternRotate = map(pattern.rotate, -1, 1, -PI, PI);

    let scaleValue = 1, freqEase = 1;
    fd.seed.push(pattern.seed.value * (gridSeed[col]?.[row] ?? 0));

    // random color selector (per point)
    let randomColor = p.random();
    if (params.color.style === 'fill') randomColor = 2;
    else if (params.color.style === 'stroke') randomColor = -1;

    // swirl
    let swirlValue = 0;
    const swirlCenter = tileCenterShift / 2;
    const baseSwirl = map(params.swirl.base, 0, 1, 0, 0.05);
    const swirlFreq = map(EASE['Expo Out'](params.swirl.freq), 0, 1, swirlCenter, 1);
    const swirlAmp = params.swirl.amp * HALF_PI;
    if (params.swirl.mode === 'rotary') {
      swirlValue = Math.round(sin(HALF_PI + centerDistance / swirlFreq) * cos(centerDistance / swirlFreq)) * swirlAmp;
    } else if (params.swirl.mode === 'wave') {
      swirlValue = sin(cos(centerDistance / swirlFreq)) * swirlAmp;
    }
    swirlValue += centerDistance * baseSwirl;

    // branch (radial symmetry)
    const branchAmount = max(0.01, params.branch.amount);
    const branchAngle = params.branch.angle;
    const centerDirectionAngled = centerDirection + swirlValue + patternRotate;
    const nearestBranch = (Math.round((centerDirectionAngled * branchAmount) / TWO_PI) * TWO_PI) / branchAmount;
    centerDistance *= cos((centerDirectionAngled - nearestBranch) * branchAngle);

    // mask
    if (mask.mode === 'parametric') {
      const maskBranch = mask.branch / 2;
      const distValue = (mask.branchMode === 'apply' ? centerDistance : maskDistance) * abs(cos(maskBranch * centerDirectionAngled));
      if (distValue < maskMin || distValue > maskMax) scaleValue = 0;
      if (mask.branchRound && (maskDistance < maskMin || maskDistance > maskMax)) scaleValue = 0;
    } else if (mask.mode === 'image' && mask.image.lum) {
      const px = constrain(floor(x), 0, GW - 1), py = constrain(floor(y), 0, GH - 1);
      scaleValue *= mask.image.lum[py * GW + px];
      if (scaleValue < 0.05) scaleValue = 0;
    }

    // scale easing by radius
    if (params.scale.easeType !== 'none') {
      let lo = 0, hi = 0; const off = round2(params.scale.easeOffset, 2);
      if (off < 0) { lo = 1; hi = 1 - abs(params.scale.easeOffset); } else if (off > 0) { lo = 0; hi = params.scale.easeOffset; }
      let n = (scaleDistance - lo) / (hi - lo); n = n < 0 ? 0 : n > 1 ? 1 : n;
      scaleValue *= EASE[params.scale.easeType](n);
    }
    // freq easing by radius
    if (params.freq.easeType !== 'none') {
      let lo = 0, hi = 0; const off = round2(params.freq.easeOffset, 2);
      if (off < 0) { lo = 1; hi = 1 - abs(params.freq.easeOffset); } else if (off > 0) { lo = 0; hi = params.freq.easeOffset; }
      let n = (freqDistance - lo) / (hi - lo); n = n < 0 ? 0 : n > 1 ? 1 : n;
      freqEase = EASE[params.freq.easeType](n);
    }

    const freqMode = params.freq.mode === 'cos';
    const freqAmount = params.branch.amountMax - params.branch.amount * 0.5;
    const freqBase = EASE['Sine In'](params.freq.base);
    const freqAmp = EASE['Sine In'](params.freq.amp);
    const branchMirror = params.branch.symmetry !== 'standard';
    let branchFreq = cos(branchAmount * centerDirectionAngled);
    branchFreq = branchMirror ? abs(branchFreq) * freqAmp : branchFreq * freqAmp;
    const freqValue = freqMode ? Math.round(branchFreq * freqAmount) / freqAmount : branchFreq;
    const noiseData = log(max(0.001, centerDistance / freqEase) / TWO_PI) * (freqBase * freqEase);

    fd.x.push(x); fd.y.push(y);
    fd.noise.push(noiseData); fd.freq.push(freqValue);
    fd.randomColor.push(randomColor); fd.scaleEase.push(scaleValue);
    fd.rotate.push(shapeRotate + shapeRotateDirection);
  }
  frameData = fd;
}

/////////////////////////////////////////////////////////////////////////////
// Render (port of drawForms): stamp every point onto the transparent buffer.
/////////////////////////////////////////////////////////////////////////////
function drawForms(p, g) {
  const fd = frameData; if (!fd.count) return;
  const ctx = g.drawingContext;
  ctx.globalCompositeOperation = fd.colorBlend;
  g.push();
  g.translate(fd.offset.x, fd.offset.y);
  g.translate(fd.translate.x, fd.translate.y);
  g.scale(fd.canvasScale);

  const frame = cnv.frame / (rec.length.value * rec.frameRate);
  let noiseFrame = 0, sinFrame = 0, cosFrame = 0;
  if (fd.motionMode === 'oneway') noiseFrame = TWO_PI * frame * fd.motionAmp;
  else if (fd.motionMode === 'loop') noiseFrame = sin(TWO_PI * frame) * fd.motionAmp;
  else if (fd.motionMode === 'noise') { sinFrame = sin(TWO_PI * frame) * fd.motionAmp; cosFrame = cos(TWO_PI * frame) * fd.motionAmp; }

  const nLayers = palette.temp.length || 1;
  const sp = shape.path;
  for (let i = 0; i < fd.count; i++) {
    let s = noise4D(fd.seed[i] + fd.noise[i] - noiseFrame, fd.freq[i], sinFrame, cosFrame);
    s = (1 + s) * 0.5;
    const colorIndex = abs(~~(s * nLayers));
    const fract = 1 / nLayers;
    const valueInRange = (s - colorIndex * fract) / fract;
    const scaledValue = 2 * (0.5 - abs(valueInRange - 0.5));
    let size = pow(scaledValue, fd.sizePower) * fd.sizeScale * fd.scaleEase[i];
    if (Number.isNaN(size) || size < 0.05) continue;
    fd.scale[i] = size;

    let color;
    if (params.color.type === 'color') color = params.color.base;
    else if (params.color.type === 'sequence') color = palette.temp[min(colorIndex, nLayers - 1)];
    else color = paletteLerp(palette.temp, s);
    fd.color[i] = color;

    g.push();
    g.translate(fd.x[i], fd.y[i]);
    g.scale(size);
    g.rotate(fd.rotate[i]);
    g.translate(-shape.width, -shape.height);
    if (fd.randomColor[i] > fd.colorRatio) {
      ctx.fillStyle = color;
      ctx.fill(sp, 'evenodd');
    } else {
      const sw = fd.strokeWidth / (size * fd.strokeControl + fd.strokeScale);
      fd.strokeSize[i] = sw;
      ctx.lineWidth = sw; ctx.strokeStyle = color;
      ctx.stroke(sp);
    }
    g.pop();
  }
  g.pop();
  ctx.globalCompositeOperation = 'source-over';
}

/////////////////////////////////////////////////////////////////////////////
// SVG export — re-derive each stamp's transform from frameData and emit a
// <path>. (Per-shape canvas blend modes like xor/lighter have no exact SVG
// equivalent, so a group-level mix-blend-mode is used as an approximation.)
/////////////////////////////////////////////////////////////////////////////
const CSS_BLEND = { 'source-over': 'normal', 'xor': 'normal', 'lighter': 'plus-lighter', 'multiply': 'multiply', 'screen': 'screen', 'overlay': 'overlay', 'darken': 'darken', 'lighten': 'lighten', 'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light', 'exclusion': 'exclusion', 'difference': 'difference' };

function renderSVG() {
  const fd = frameData; if (!fd.count) return '';
  const nLayers = palette.temp.length || 1;
  const frame = cnv.frame / (rec.length.value * rec.frameRate);
  let noiseFrame = 0, sinFrame = 0, cosFrame = 0;
  if (fd.motionMode === 'oneway') noiseFrame = TWO_PI * frame * fd.motionAmp;
  else if (fd.motionMode === 'loop') noiseFrame = sin(TWO_PI * frame) * fd.motionAmp;
  else if (fd.motionMode === 'noise') { sinFrame = sin(TWO_PI * frame) * fd.motionAmp; cosFrame = cos(TWO_PI * frame) * fd.motionAmp; }

  const parts = [];
  for (let i = 0; i < fd.count; i++) {
    let s = noise4D(fd.seed[i] + fd.noise[i] - noiseFrame, fd.freq[i], sinFrame, cosFrame);
    s = (1 + s) * 0.5;
    const colorIndex = abs(~~(s * nLayers));
    const fract = 1 / nLayers;
    const valueInRange = (s - colorIndex * fract) / fract;
    const scaledValue = 2 * (0.5 - abs(valueInRange - 0.5));
    const size = pow(scaledValue, fd.sizePower) * fd.sizeScale * fd.scaleEase[i];
    if (Number.isNaN(size) || size < 0.05) continue;
    let color;
    if (params.color.type === 'color') color = params.color.base;
    else if (params.color.type === 'sequence') color = palette.temp[min(colorIndex, nLayers - 1)];
    else color = paletteLerp(palette.temp, s);
    const tf = `translate(${round2(fd.x[i], 2)} ${round2(fd.y[i], 2)}) scale(${round2(size, 4)}) rotate(${round2(fd.rotate[i] * 180 / PI, 2)}) translate(${-shape.width} ${-shape.height})`;
    if (fd.randomColor[i] > fd.colorRatio) {
      parts.push(`<path d="${shape.d}" transform="${tf}" fill="${color}" fill-rule="evenodd"/>`);
    } else {
      const sw = fd.strokeWidth / (size * fd.strokeControl + fd.strokeScale);
      parts.push(`<path d="${shape.d}" transform="${tf}" fill="none" stroke="${color}" stroke-width="${round2(sw, 4)}"/>`);
    }
  }
  const gx = fd.offset.x + fd.translate.x, gy = fd.offset.y + fd.translate.y;
  const bg = cnv.bg.mode === 'custom' ? `<rect width="${GW}" height="${GH}" fill="${cnv.bg.custom}"/>` : '';
  const blendCss = CSS_BLEND[fd.colorBlend] || 'normal';
  const blend = blendCss !== 'normal' ? ` style="mix-blend-mode:${blendCss}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GW}" height="${GH}" viewBox="0 0 ${GW} ${GH}">${bg}<g transform="translate(${round2(gx, 2)} ${round2(gy, 2)}) scale(${round2(fd.canvasScale, 4)})"${blend}>${parts.join('')}</g></svg>`;
}

/////////////////////////////////////////////////////////////////////////////
// p5 sketch (render-space buffer composited onto a fit-to-viewport canvas)
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'FLAKE', version: '0.2' });
let P = null, gForm = null, displayCanvas = null;
let needsData = true, dirty = true;

function applyRatio(p) {
  [GW, GH] = RATIOS[cnv.ratio];
  if (gForm) gForm.remove();
  gForm = p.createGraphics(GW, GH);
  gForm.pixelDensity(2);
  gForm.noStroke();
  p.resizeCanvas(GW, GH);
  fitCanvas();
  refreshShape();
  if (mask.image.src) rasterizeMask();
}
function fitCanvas() {
  if (!displayCanvas) return;
  const pad = 48;
  const availW = window.innerWidth - pad * 2, availH = window.innerHeight - pad * 2;
  const k = min(availW / GW, availH / GH);
  displayCanvas.elt.style.width = `${GW * k}px`;
  displayCanvas.elt.style.height = `${GH * k}px`;
}

tool.startSketch((p) => {
  p.setup = () => {
    P = p;
    tool.canvasHost.style.display = 'flex';
    tool.canvasHost.style.alignItems = 'center';
    tool.canvasHost.style.justifyContent = 'center';
    const c = p.createCanvas(GW, GH);
    displayCanvas = c;
    c.elt.style.display = 'block';
    p.pixelDensity(2);
    p.frameRate(rec.frameRate);
    refreshShape();
    rebuildPalette();
    applyRatio(p);
  };

  p.draw = () => {
    const animating = cnv.animation && params.motion.amp !== 0;
    if (!animating && !dirty && !needsData) return;
    if (needsData) { rebuildPalette(); generateFrameData(p); needsData = false; }

    p.clear();
    if (cnv.bg.mode === 'custom') p.background(cnv.bg.custom);
    gForm.clear();
    drawForms(p, gForm);
    p.image(gForm, 0, 0, GW, GH);
    dirty = false;

    if (animating) cnv.frame = cnv.frame >= rec.length.value * rec.frameRate ? 0 : cnv.frame + 1;
  };

  p.windowResized = () => fitCanvas();
});

const markData = () => { needsData = true; dirty = true; };
const markDirty = () => { dirty = true; };

/////////////////////////////////////////////////////////////////////////////
// Raster image mask + custom-SVG shape (drag a file onto the canvas)
/////////////////////////////////////////////////////////////////////////////
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
const imageInput = document.createElement('input');
imageInput.type = 'file'; imageInput.accept = 'image/*'; imageInput.style.display = 'none';
document.body.appendChild(imageInput);
imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { const img = new Image(); img.onload = () => { mask.image.src = img; mask.mode = 'image'; rasterizeMask(); tool.pane.refresh(); markData(); }; img.src = reader.result; };
  reader.readAsDataURL(file);
});
function rasterizeMask() {
  const img = mask.image.src;
  if (!img) { mask.image.lum = null; return; }
  maskCanvas.width = GW; maskCanvas.height = GH;
  maskCtx.fillStyle = '#000'; maskCtx.fillRect(0, 0, GW, GH);
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = max(GW / iw, GH / ih) * mask.image.scale;
  const w = iw * k, h = ih * k;
  maskCtx.drawImage(img, (GW - w) / 2, (GH - h) / 2, w, h);
  const data = maskCtx.getImageData(0, 0, GW, GH).data;
  const lum = new Float32Array(GW * GH);
  const c = mask.image.contrast, b = mask.image.brightness;
  for (let i = 0; i < GW * GH; i++) {
    let l = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
    l = (l - 0.5) * c + 0.5 + b;
    if (mask.image.invertLight) l = 1 - l;
    lum[i] = l < 0 ? 0 : l > 1 ? 1 : l;
  }
  mask.image.lum = lum;
}

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
    const bnds = cp.bounds;
    const mult = min(10 / bnds.width, 10 / bnds.height);
    cp.translate(new paper.Point(-bnds.x, -bnds.y));
    cp.scale(mult, new paper.Point(0, 0));
    shape.customD = cp.pathData;
    shape.width = (bnds.width * mult) / 2;
    shape.height = (bnds.height * mult) / 2;
    shape.type = 'custom';
    cp.remove(); paper.project.clear();
    refreshShape(); tool.pane.refresh(); markDirty();
  } catch (err) { console.error('SVG import failed', err); }
}

tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0]; if (!file) return;
  const reader = new FileReader();
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) {
    reader.onload = () => importCustomSVG(reader.result);
    reader.readAsText(file);
  } else if (/^image\//i.test(file.type)) {
    reader.onload = () => {
      const img = new Image();
      img.onload = () => { mask.image.src = img; mask.mode = 'image'; rasterizeMask(); tool.pane.refresh(); markData(); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
});

/////////////////////////////////////////////////////////////////////////////
// UI
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;

const fCanvas = main.addFolder({ title: 'CANVAS' });
fCanvas.addBinding(cnv, 'ratio', { label: 'Canvas Ratio', options: RATIO_OPTS }).on('change', () => { if (P) applyRatio(P); markData(); });
fCanvas.addBinding(cnv, 'scale', { label: 'Canvas Scale', min: 0.5, max: 2, step: 0.01 }).on('change', markDirty);
fCanvas.addBinding(cnv.bg, 'mode', { label: 'Background', options: BG_OPTS }).on('change', markDirty);
fCanvas.addBinding(cnv.bg, 'custom', { label: 'Canvas Color', view: 'color' }).on('change', markDirty);

const fStyle = main.addFolder({ title: 'STYLE', expanded: false });
fStyle.addBinding(params.color, 'style', { label: 'Render Style', options: STYLE_OPTS }).on('change', markData);
fStyle.addBinding(params.color, 'mixed', { label: 'Fill/Stroke Ratio', min: 0, max: 1, step: 0.01 }).on('change', markData);
fStyle.addBinding(params.stroke, 'width', { label: 'Stroke Width', min: params.stroke.minWidth, max: params.stroke.maxWidth, step: 0.05 }).on('change', markDirty);
fStyle.addBinding(params.stroke, 'scale', { label: 'Stroke Scale' }).on('change', markDirty);
fStyle.addBinding(params.color, 'blend', { label: 'Blend Type', options: BLENDS }).on('change', markData);
fStyle.addBinding(params.color, 'type', { label: 'Color Type', options: COLOR_OPTS }).on('change', markData);
fStyle.addBinding(params.color, 'base', { label: 'Shape Color', view: 'color' }).on('change', markDirty);
attachPaletteControls(fStyle, { palette, pane: tool.pane, onChange: markData });

const fPattern = main.addFolder({ title: 'PATTERN', expanded: false });
fPattern.addBinding(pattern.cells, 'x', { label: 'Cells X', min: 1, max: 16, step: 1 }).on('change', markData);
fPattern.addBinding(pattern.cells, 'y', { label: 'Cells Y', min: 1, max: 16, step: 1 }).on('change', markData);
fPattern.addBinding(pattern.offset, 'x', { label: 'Offset X', min: -1, max: 1, step: 0.01 }).on('change', markData);
fPattern.addBinding(pattern.offset, 'y', { label: 'Offset Y', min: -1, max: 1, step: 0.01 }).on('change', markData);
fPattern.addBinding(pattern.seed, 'value', { label: 'Pattern Seed', min: -1, max: 1, step: 0.01 }).on('change', markData);
fPattern.addBinding(pattern.seed, 'random', { label: 'Seed Random', min: 0, max: 5, step: 0.01 }).on('change', markData);
fPattern.addBinding(pattern, 'rotate', { label: 'Cell Rotation', min: -1, max: 1, step: 0.01 }).on('change', markData);

const fShape = main.addFolder({ title: 'SHAPE' });
fShape.addBinding(shape, 'type', { label: 'Shape Type', options: SHAPE_OPTS }).on('change', () => { refreshShape(); markDirty(); });
fShape.addBinding(params.grid, 'x', { label: 'Grid X', min: 1, max: 16, step: 1 }).on('change', markData);
fShape.addBinding(params.grid, 'y', { label: 'Grid Y', min: 1, max: 16, step: 1 }).on('change', markData);
fShape.addBinding(params.count, 'value', { label: 'Shape Count', min: params.count.min, max: params.count.max, step: params.count.step }).on('change', markData);
fShape.addBinding(params.scale, 'value', { label: 'Shape Scale', min: 0.5, max: 10, step: 0.05 }).on('change', markDirty);
fShape.addBinding(params.scale, 'power', { label: 'Scale Power', min: 0, max: 5, step: 0.05 }).on('change', markDirty);
fShape.addBinding(params.scale, 'easeType', { label: 'Scaling Ease', options: EASE_OPTS }).on('change', markData);
fShape.addBinding(params.scale, 'easeOffset', { label: 'Easing Offset', min: -1, max: 1, step: 0.01 }).on('change', markData);
fShape.addBinding(params.rotate, 'shape', { label: 'Base Rotation', min: -1, max: 1, step: 0.01 }).on('change', markData);
fShape.addBinding(params.rotate, 'mult', { label: 'Angle Multiplier', min: -3, max: 3, step: 0.01 }).on('change', markData);

const fNoise = main.addFolder({ title: 'NOISE' });
fNoise.addBinding(params.branch, 'symmetry', { label: 'Symmetry', options: SYMMETRY_OPTS }).on('change', markData);
fNoise.addBinding(params.branch, 'amount', { label: 'Branch Amount', min: 0, max: params.branch.amountMax, step: 0.1 }).on('change', markData);
fNoise.addBinding(params.branch, 'angle', { label: 'Branch Angle', min: 0, max: 2, step: 0.01 }).on('change', markData);
fNoise.addBinding(params.freq, 'easeType', { label: 'Freq Easing', options: EASE_OPTS }).on('change', markData);
fNoise.addBinding(params.freq, 'easeOffset', { label: 'Easing Offset', min: -1, max: 1, step: 0.01 }).on('change', markData);
fNoise.addBinding(params.freq, 'mode', { label: 'Freq Mode', options: FREQ_OPTS }).on('change', markData);
fNoise.addBinding(params.freq, 'layers', { label: 'Freq Layers', min: params.freq.minLayers, max: params.freq.maxLayers, step: 1 }).on('change', markData);
fNoise.addBinding(params.freq, 'base', { label: 'Freq Base', min: 0.01, max: 1, step: 0.01 }).on('change', markData);
fNoise.addBinding(params.freq, 'amp', { label: 'Freq Amplify', min: 0.01, max: 1, step: 0.01 }).on('change', markData);

const fSwirl = main.addFolder({ title: 'SWIRL', expanded: false });
fSwirl.addBinding(params.swirl, 'mode', { label: 'Swirl Mode', options: SWIRL_OPTS }).on('change', markData);
fSwirl.addBinding(params.swirl, 'base', { label: 'Base Swirl', min: -1, max: 1, step: 0.01 }).on('change', markData);
fSwirl.addBinding(params.swirl, 'amp', { label: 'Amplify Effect', min: -1, max: 1, step: 0.01 }).on('change', markData);
fSwirl.addBinding(params.swirl, 'freq', { label: 'Frequency', min: 0.05, max: 1, step: 0.01 }).on('change', markData);

const fMask = main.addFolder({ title: 'MASK', expanded: false });
fMask.addBinding(mask, 'mode', { label: 'Mask Type', options: MASK_OPTS }).on('change', markData);
fMask.addBinding(mask, 'branchMode', { label: 'Branch Mode', options: MASK_BRANCH_OPTS }).on('change', markData);
fMask.addBinding(mask, 'branch', { label: 'Add Branches', min: 0, max: mask.maxBranch, step: 1 }).on('change', markData);
fMask.addBinding(mask, 'branchRound', { label: 'Round Branches' }).on('change', markData);
fMask.addBinding(mask.margin, 'min', { label: 'Mask Min', min: 0, max: 1, step: 0.01 }).on('change', markData);
fMask.addBinding(mask.margin, 'max', { label: 'Mask Max', min: 0, max: 1, step: 0.01 }).on('change', markData);
fMask.addButton({ title: 'Load Mask Image…' }).on('click', () => imageInput.click());
fMask.addBinding(mask.image, 'scale', { label: 'Image Scale', min: 0.5, max: 2, step: 0.01 }).on('change', () => { rasterizeMask(); markData(); });
fMask.addBinding(mask.image, 'brightness', { label: 'Brightness', min: -0.5, max: 0.5, step: 0.01 }).on('change', () => { rasterizeMask(); markData(); });
fMask.addBinding(mask.image, 'contrast', { label: 'Contrast', min: 0.5, max: 5, step: 0.01 }).on('change', () => { rasterizeMask(); markData(); });
fMask.addBinding(mask.image, 'invertLight', { label: 'Invert Lights' }).on('change', () => { rasterizeMask(); markData(); });

const fMotion = main.addFolder({ title: 'MOTION', expanded: false });
fMotion.addBinding(cnv, 'animation', { label: 'Animate' }).on('change', () => { cnv.frame = 0; dirty = true; });
fMotion.addBinding(params.motion, 'mode', { label: 'Motion Type', options: MOTION_OPTS }).on('change', () => { cnv.frame = 0; markData(); });
fMotion.addBinding(params.motion, 'amp', { label: 'Amplify Level', min: -100, max: 100, step: 1 }).on('change', () => { cnv.frame = 0; markData(); });

const fSeed = main.addFolder({ title: 'SEED' });
fSeed.addBinding(seed, 'value', { label: 'Noise Seed', min: 0, max: seed.max, step: 1 }).on('change', () => { reseedNoise(); markData(); });
fSeed.addButton({ title: 'Random Seed' }).on('click', () => { seed.value = floor(Math.random() * seed.max); reseedNoise(); tool.pane.refresh(); markData(); });

/////////////////////////////////////////////////////////////////////////////
// Export + Presets
/////////////////////////////////////////////////////////////////////////////
attachExport(tool.pages.export, { getCanvas: tool.getCanvas, getSVG: renderSVG, name: 'flake' });

const presets = {
  'Cobalt Bloom': { seed: 7, cnv: { ratio: '1:1', scale: 0.92, bg: '#070b14' }, params: { count: { value: 8000 }, grid: { x: 2, y: 2 }, scale: { value: 2.8, power: 1.3, easeType: 'none', easeOffset: 0.5 }, color: { mixed: 0.5, style: 'fill', blend: 'screen', type: 'transition', base: '#0055ff' }, branch: { amount: 6, angle: 1, symmetry: 'standard' }, freq: { mode: 'sin', layers: 10, base: 0.55, amp: 0.3, easeType: 'none', easeOffset: 0 }, swirl: { mode: 'none', base: 0, amp: 0.25, freq: 0.25 }, rotate: { mult: -0.17, shape: 0.17 }, motion: { mode: 'noise', amp: 20 } }, pattern: { cells: { x: 1, y: 1 }, offset: { x: 0, y: 0 }, seed: { value: 0, random: 0 }, rotate: 0 }, mask: { mode: 'none' }, shape: 'flake', palette: ['#0a2a6b', '#2f6fed', '#43d9ff', '#bff3ff', '#ffffff'] },
  'Cobalt Vortex': { seed: 90210, cnv: { ratio: '1:1', scale: 0.95, bg: '#05070f' }, params: { count: { value: 9000 }, grid: { x: 2, y: 2 }, scale: { value: 3, power: 1.2, easeType: 'Cubic Out', easeOffset: 0.6 }, color: { mixed: 0.5, style: 'fill', blend: 'screen', type: 'transition', base: '#0055ff' }, branch: { amount: 5, angle: 1, symmetry: 'standard' }, freq: { mode: 'sin', layers: 10, base: 0.5, amp: 0.35, easeType: 'none', easeOffset: 0 }, swirl: { mode: 'rotary', base: 0.1, amp: 0.5, freq: 0.3 }, rotate: { mult: -0.3, shape: 0.1 }, motion: { mode: 'noise', amp: 30 } }, pattern: { cells: { x: 1, y: 1 }, offset: { x: 0, y: 0 }, seed: { value: 0, random: 0 }, rotate: 0 }, mask: { mode: 'none' }, shape: 'spark', palette: ['#6c5ce7', '#00cec9', '#a29bfe', '#05070f'] },
  'Quartz Mosaic': { seed: 86776, cnv: { ratio: '1:1', scale: 0.9, bg: '#deedf8' }, params: { count: { value: 8000 }, grid: { x: 5, y: 5 }, scale: { value: 1, power: 1.5, easeType: 'Cubic Out', easeOffset: 0.5 }, stroke: { width: 0.6, scale: true }, color: { mixed: 0.5, style: 'fill', blend: 'xor', type: 'color', base: '#000000' }, branch: { amount: 4, angle: 1, symmetry: 'standard' }, freq: { mode: 'cos', layers: 6, base: 0.5, amp: 0.04, easeType: 'none', easeOffset: -0.27 }, swirl: { mode: 'none', base: 0, amp: -0.5, freq: 0.5 }, rotate: { mult: 0, shape: 0 }, motion: { mode: 'noise', amp: 6 } }, pattern: { cells: { x: 3, y: 3 }, offset: { x: 0.75, y: 0.75 }, seed: { value: -0.83, random: 0 }, rotate: 0 }, mask: { mode: 'none' }, shape: 'quad', palette: ['#292522', '#4d6160', '#a39081', '#d6a692', '#efd9b4'] },
  'Petal Mask': { seed: 4242, cnv: { ratio: '1:1', scale: 0.9, bg: '#fff7fa' }, params: { count: { value: 7000 }, grid: { x: 2, y: 2 }, scale: { value: 2.4, power: 1.3, easeType: 'Sine Out', easeOffset: 0.4 }, color: { mixed: 0.5, style: 'fill', blend: 'multiply', type: 'transition', base: '#0055ff' }, branch: { amount: 6, angle: 1, symmetry: 'mirror' }, freq: { mode: 'sin', layers: 8, base: 0.5, amp: 0.3, easeType: 'none', easeOffset: 0 }, swirl: { mode: 'wave', base: 0, amp: 0.3, freq: 0.4 }, rotate: { mult: -0.17, shape: 0.17 }, motion: { mode: 'noise', amp: 20 } }, pattern: { cells: { x: 1, y: 1 }, offset: { x: 0, y: 0 }, seed: { value: 0, random: 0 }, rotate: 0 }, mask: { mode: 'parametric', branch: 6, margin: { min: 0.1, max: 0.85 }, branchMode: 'ignore', branchRound: false }, shape: 'flower', palette: ['#ff7675', '#fd79a8', '#fdcb6e', '#ffffff'] },
  'Vermillion Vortex': { seed: 555, cnv: { ratio: '1:1', scale: 0.95, bg: '#120604' }, params: { count: { value: 9000 }, grid: { x: 2, y: 2 }, scale: { value: 3, power: 1.2, easeType: 'Cubic Out', easeOffset: 0.6 }, color: { mixed: 0.5, style: 'fill', blend: 'screen', type: 'transition', base: '#ff7a18' }, branch: { amount: 5, angle: 1, symmetry: 'standard' }, freq: { mode: 'sin', layers: 10, base: 0.5, amp: 0.35, easeType: 'none', easeOffset: 0 }, swirl: { mode: 'rotary', base: 0.1, amp: 0.5, freq: 0.3 }, rotate: { mult: -0.3, shape: 0.1 }, motion: { mode: 'noise', amp: 30 } }, pattern: { cells: { x: 1, y: 1 }, offset: { x: 0, y: 0 }, seed: { value: 0, random: 0 }, rotate: 0 }, mask: { mode: 'none' }, shape: 'spark', palette: ['#3a0a02', '#c0341d', '#ff7a18', '#ffd166', '#fff3d6'] },
  'Monochrome Grid': { seed: 13, cnv: { ratio: '1:1', scale: 0.9, bg: '#ffffff' }, params: { count: { value: 9000 }, grid: { x: 4, y: 4 }, scale: { value: 1.2, power: 1.3, easeType: 'none', easeOffset: 0.5 }, color: { mixed: 0.5, style: 'fill', blend: 'xor', type: 'color', base: '#101010' }, branch: { amount: 4, angle: 1, symmetry: 'standard' }, freq: { mode: 'cos', layers: 6, base: 0.5, amp: 0.06, easeType: 'none', easeOffset: 0 }, swirl: { mode: 'none', base: 0, amp: 0.25, freq: 0.25 }, rotate: { mult: 0, shape: 0 }, motion: { mode: 'noise', amp: 8 } }, pattern: { cells: { x: 2, y: 2 }, offset: { x: 0.5, y: 0.5 }, seed: { value: 0.3, random: 0 }, rotate: 0 }, mask: { mode: 'none' }, shape: 'square', palette: ['#000000', '#ffffff'] },
  'Aurora Drift': { seed: 808, cnv: { ratio: '1:1', scale: 0.95, bg: '#04110f' }, params: { count: { value: 9000 }, grid: { x: 2, y: 2 }, scale: { value: 2.8, power: 1.2, easeType: 'Sine Out', easeOffset: 0.5 }, color: { mixed: 0.5, style: 'fill', blend: 'screen', type: 'transition', base: '#3fe0a6' }, branch: { amount: 3, angle: 1, symmetry: 'standard' }, freq: { mode: 'sin', layers: 9, base: 0.5, amp: 0.3, easeType: 'none', easeOffset: 0 }, swirl: { mode: 'wave', base: 0, amp: 0.3, freq: 0.4 }, rotate: { mult: -0.2, shape: 0.12 }, motion: { mode: 'noise', amp: 25 } }, pattern: { cells: { x: 1, y: 1 }, offset: { x: 0, y: 0 }, seed: { value: 0, random: 0 }, rotate: 0 }, mask: { mode: 'none' }, shape: 'circle', palette: ['#02231d', '#0f7a5a', '#3fe0a6', '#bff7e3', '#ffffff'] },
  'Halftone Rings': { seed: 21, cnv: { ratio: '1:1', scale: 0.9, bg: '#f4f1ea' }, params: { count: { value: 12000 }, grid: { x: 3, y: 3 }, scale: { value: 1.6, power: 1.4, easeType: 'none', easeOffset: 0.5 }, color: { mixed: 0.5, style: 'fill', blend: 'source-over', type: 'sequence', base: '#101010' }, branch: { amount: 0.01, angle: 1, symmetry: 'standard' }, freq: { mode: 'cos', layers: 5, base: 0.6, amp: 0.05, easeType: 'none', easeOffset: 0 }, swirl: { mode: 'none', base: 0, amp: 0.25, freq: 0.25 }, rotate: { mult: 0, shape: 0 }, motion: { mode: 'noise', amp: 0 } }, pattern: { cells: { x: 1, y: 1 }, offset: { x: 0, y: 0 }, seed: { value: 0, random: 0 }, rotate: 0 }, mask: { mode: 'none' }, shape: 'circle', palette: ['#101010', '#5b5b5b', '#a8a8a8', '#f4f1ea'] },
};

// Restore the live state to defaults in place (preserving object identities the
// Tweakpane bindings hold), keeping any dropped mask image.
function resetToDefaults() {
  deepMerge(params, structuredClone(DEFAULTS.params));
  deepMerge(pattern, structuredClone(DEFAULTS.pattern));
  deepMerge(cnv, structuredClone(DEFAULTS.cnv));
  const img = { src: mask.image.src, lum: mask.image.lum };
  deepMerge(mask, structuredClone(DEFAULTS.mask));
  mask.image.src = img.src; mask.image.lum = img.lum;
  DEFAULTS.palette.array.forEach((c, i) => { palette.array[i] = c; });
  DEFAULTS.palette.use.forEach((u, i) => { palette.use[i] = u; });
  shape.type = DEFAULTS.shape.type;
  shape.customD = DEFAULTS.shape.customD;
}

// Flatten/expand presets onto a clean default slate, then refresh.
function applyPreset(name) {
  const pr = presets[name]; if (!pr) return;
  resetToDefaults();
  if (pr.seed != null) seed.value = pr.seed;
  if (pr.cnv) { if (pr.cnv.ratio) cnv.ratio = pr.cnv.ratio; if (pr.cnv.scale != null) cnv.scale = pr.cnv.scale; if (pr.cnv.bg) cnv.bg.custom = pr.cnv.bg; }
  if (pr.params) deepMerge(params, pr.params);
  if (pr.pattern) deepMerge(pattern, pr.pattern);
  if (pr.mask) deepMerge(mask, pr.mask);
  if (pr.shape) shape.type = pr.shape;
  if (pr.palette) { for (let i = 0; i < palette.array.length; i++) { palette.array[i] = pr.palette[i % pr.palette.length]; palette.use[i] = true; } }
  refreshShape();
  reseedNoise();
  if (P) applyRatio(P);
  tool.pane.refresh();
  markData();
}
function deepMerge(dst, src) {
  for (const k of Object.keys(src)) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) { dst[k] = dst[k] || {}; deepMerge(dst[k], src[k]); }
    else dst[k] = src[k];
  }
}

// Minimal preset dropdown on OPTIONS (a faithful, original-named starter set).
const presetState = { name: 'Cobalt Bloom' };
const opts = tool.pages.options;
opts.addBinding(presetState, 'name', { label: 'Preset', options: Object.fromEntries(Object.keys(presets).map((k) => [k, k])) }).on('change', (ev) => applyPreset(ev.value));
opts.addButton({ title: 'Apply Preset' }).on('click', () => applyPreset(presetState.name));
opts.addButton({ title: 'Fullscreen (f)' }).on('click', () => tool.toggleFullscreen());

window.addEventListener('resize', fitCanvas);
// Dev hook: drive presets / inspect state from the console while tuning fidelity.
exposeDebug('flake', { applyPreset, renderSVG, rasterizeMask, markData, importCustomSVG, params, cnv, pattern, mask, shape, palette, seed, presets });
applyPreset('Cobalt Bloom');
