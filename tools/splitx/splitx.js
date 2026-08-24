// SPLITX — a single base shape stamped N times into an offscreen buffer, each
// stamp transformed by sequenced scale + noise/sin move/rotate, then the buffer
// is kaleidoscopically split-mirrored (none / horizontal / vertical / quad) into
// the final frame. Math runs in a fixed render-space (the ratio resolution) so
// parameter magnitudes stay stable across canvas sizes. Live render is p5 +
// Path2D buffers; SVG export reconstructs the same formData with Paper.js (the
// only reliable way to bake per-stamp transforms + XOR compound paths).
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachExport } from '../../js/etch/export.js';
import { alea } from '../../js/etch/noise.js';
import { createNoise3D } from '../../js/vendor/simplex/simplex-noise.js';
import { interpolateHex, attachPaletteControls } from '../../js/etch/palette.js';

/////////////////////////////////////////////////////////////////////////////
// Math helpers (angles in degrees, matching the form buffer's angle mode)
/////////////////////////////////////////////////////////////////////////////
const { sin, cos, floor, abs } = Math;
const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const constrain = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// frame-driven oscillators use radians; convert where p5 graphics use degrees.

/////////////////////////////////////////////////////////////////////////////
// Option maps
/////////////////////////////////////////////////////////////////////////////
const RATIOS = {
  '2:1': [480, 240], '16:9': [640, 360], '3:2': [480, 320], '4:3': [480, 360],
  '5:4': [600, 480], '1:1': [480, 480], '4:5': [480, 600], '3:4': [360, 480],
  '2:3': [320, 480], '9:16': [360, 640], '1:2': [240, 480],
};
const RATIO_OPTS = Object.fromEntries(Object.keys(RATIOS).map((k) => [k, k]));
const SHAPE_OPTS = {
  Rectangle: 'rect', Circle: 'circle', Ring: 'ring', Oval: 'oval', Triangle: 'triangle',
  Rhombus: 'rhombus', Cross: 'cross', Star: 'star', Hexagon: 'hexagon', Petals: 'petals',
  Checker: 'checker', Blob: 'blob', 'Custom (SVG)': 'custom',
};
const BG_OPTS = { Custom: 'custom', 'Use Palette Color': 'palette', Transparent: 'transparent' };
const SLOT_OPTS = { 'Color 1': 0, 'Color 2': 1, 'Color 3': 2, 'Color 4': 3, 'Color 5': 4 };
const SPLIT_OPTS = { None: 'none', Horizontal: 'horizontal', Vertical: 'vertical', Quad: 'quad' };
const STYLE_OPTS = { Fill: 'fill', Stroke: 'stroke' };
const FILL_OPTS = { 'Cutout (XOR)': 'xor', Sequence: 'sequence', 'Transition (RGB)': 'transitionRGB', 'Transition (LAB)': 'transitionLAB' };
const MOTION_OPTS = { Off: 'off', Noise: 'noise', Sinusoidal: 'sin' };
const ORDER_OPTS = { Forward: 'forward', Backward: 'backward', Equal: 'equal' };

/////////////////////////////////////////////////////////////////////////////
// Shape library — authored here (original art), each as one or more closed
// polylines in a 0..360 box centred on (180,180); the same geometry yields a
// Path2D (canvas) and an SVG `d` string (Paper export). A stamp is centred by
// translating (-180,-180), matching the reference's shape origin.
/////////////////////////////////////////////////////////////////////////////
const SHAPE_HALF = 180;
const C = 180, R = 180;
const arc = (cx, cy, rx, ry, n = 64, rot = 0) => Array.from({ length: n }, (_, i) => {
  const a = rot + (i / n) * TWO_PI; return [cx + cos(a) * rx, cy + sin(a) * ry];
});
const ngon = (cx, cy, r, n, rot = -Math.PI / 2) => Array.from({ length: n }, (_, i) => {
  const a = rot + (i / n) * TWO_PI; return [cx + cos(a) * r, cy + sin(a) * r];
});
const starPts = (cx, cy, ro, ri, points, rot = -Math.PI / 2) => Array.from({ length: points * 2 }, (_, i) => {
  const a = rot + (i / (points * 2)) * TWO_PI; const r = i % 2 ? ri : ro; return [cx + cos(a) * r, cy + sin(a) * r];
});
function shapeSubpaths(type) {
  switch (type) {
    case 'rect': return [[[0, 0], [360, 0], [360, 360], [0, 360]]];
    case 'circle': return [arc(C, C, R, R)];
    case 'ring': return [arc(C, C, R, R), arc(C, C, R * 0.52, R * 0.52)];
    case 'oval': return [arc(C, C, R, R * 0.5, 64, Math.PI / 4)];
    case 'triangle': return [ngon(C, C + 14, R, 3)];
    case 'rhombus': return [ngon(C, C, R, 4, 0)];
    case 'hexagon': return [ngon(C, C, R, 6, 0)];
    case 'star': return [starPts(C, C, R, R * 0.42, 5)];
    case 'cross': { const t = 56, a = C - t, b = C + t; return [[[a, 0], [b, 0], [b, a], [360, a], [360, b], [b, b], [b, 360], [a, 360], [a, b], [0, b], [0, a], [a, a]]]; }
    case 'petals': { const s = []; for (let i = 0; i < 8; i++) { const ang = (i / 8) * TWO_PI; s.push(arc(C + cos(ang) * 96, C + sin(ang) * 96, 70, 70, 32)); } s.push(arc(C, C, 72, 72, 40)); return s; }
    case 'checker': { const s = []; const n = 6, sz = 360 / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 2 === 0) { const x = i * sz, y = j * sz; s.push([[x, y], [x + sz, y], [x + sz, y + sz], [x, y + sz]]); } return s; }
    case 'blob': return [Array.from({ length: 96 }, (_, i) => { const a = (i / 96) * TWO_PI; const r = R * (0.78 + 0.12 * sin(3 * a + 0.6) + 0.06 * sin(5 * a - 1.1) + 0.04 * sin(7 * a)); return [C + cos(a) * r, C + sin(a) * r]; })];
    default: return [arc(C, C, R, R)];
  }
}
const round3 = (v) => Math.round(v * 1000) / 1000;
function subpathsToD(subs) {
  return subs.map((pts) => 'M' + pts.map(([x, y], i) => `${i ? 'L' : ''}${round3(x)},${round3(y)}`).join(' ') + 'Z').join(' ');
}
const shape = { type: 'triangle', d: null, path: null, customD: null };
function refreshShape() {
  shape.d = shape.type === 'custom' && shape.customD ? shape.customD : subpathsToD(shapeSubpaths(shape.type));
  shape.path = new Path2D(shape.d);
}

/////////////////////////////////////////////////////////////////////////////
// State (faithful defaults; preset names & palettes are original)
/////////////////////////////////////////////////////////////////////////////
const cnv = {
  ratio: '1:1', animation: true, frame: 0,
  color: { mode: 'custom', custom: '#D9D9D9', slot: 1 },
  rotation: 0, scale: 1, position: { x: 0, y: 0 },
};
const palette = {
  index: 0,
  array: ['#FFFFFF', '#D1D1D1', '#808080', '#585858', '#000000'],
  use: [true, true, true, true, true],
  temp: [],
};
const form = {
  type: 'circle',
  color: { type: 'fill', mode: 'sequence' },
  stroke: { width: 2 },
  count: { base: 15 },
  sequence: 0.75,
  transition: { x: 0, y: 0 },
  scale: { type: 'noise', order: 'equal', seed: 333, amp: 0.25, freq: 0.1, cycle: 1, phase: 0, speed: 0.25 },
  xmove: { type: 'noise', order: 'equal', seed: 220, amp: 0.25, freq: 0.2, cycle: 1, phase: 0, speed: 0.25 },
  ymove: { type: 'noise', order: 'equal', seed: 740, amp: 0.25, freq: 0.2, cycle: 1, phase: 0, speed: 0.25 },
  rotate: { type: 'sin', order: 'equal', seed: 555, amp: 0.25, freq: 0.2, cycle: 1, phase: 0, speed: 0.25 },
};
const split = { type: 'none', x: 1, y: 1, mask: { x: 0, y: 0 } };
const rec = { frameRate: 60, length: { value: 10 } };

// Snapshot of defaults so each preset applies onto a clean slate.
const DEFAULTS = structuredClone({ cnv, palette, form, split });

/////////////////////////////////////////////////////////////////////////////
// Seedable simplex — one generator per channel, alea-seeded exactly like the
// reference (the seed offsets both the generator and the sample coordinate).
/////////////////////////////////////////////////////////////////////////////
let nScale, nXmove, nYmove, nRotate;
function seedEvent() {
  nScale = createNoise3D(alea(5241 + form.scale.seed));
  nXmove = createNoise3D(alea(835 + form.xmove.seed));
  nYmove = createNoise3D(alea(form.ymove.seed));
  nRotate = createNoise3D(alea(3946 + form.rotate.seed));
}
seedEvent();

/////////////////////////////////////////////////////////////////////////////
// Color
/////////////////////////////////////////////////////////////////////////////
function populatePaletteColors() {
  palette.temp = [];
  for (let i = 0; i < palette.array.length; i++) {
    if (palette.use[i] || form.color.mode === 'xor') palette.temp.push(palette.array[i]);
  }
  if (!palette.temp.length) palette.temp.push(palette.array[0]);
}
// sRGB <-> CIE Lab (D65) for perceptual LAB transitions
function hexToLab(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
  r = lin(r); g = lin(g); b = lin(b);
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = (r * 0.2126 + g * 0.7152 + b * 0.0722);
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function labToHex(L, a, bb) {
  let y = (L + 16) / 116, x = a / 500 + y, z = y - bb / 200;
  const fi = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  x = 0.95047 * fi(x); y = fi(y); z = 1.08883 * fi(z);
  let r = x * 3.2406 - y * 1.5372 - z * 0.4986;
  let g = -x * 0.9689 + y * 1.8758 + z * 0.0415;
  let b = x * 0.0557 - y * 0.2040 + z * 1.0570;
  const gam = (c) => (c > 0.0031308 ? 1.055 * c ** (1 / 2.4) - 0.055 : 12.92 * c);
  const h = (c) => Math.round(constrain(gam(c), 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
function transitionColor(colors, t, lab) {
  if (colors.length === 1) return colors[0];
  const tt = constrain(t, 0, 1) * (colors.length - 1);
  const k = Math.min(floor(tt), colors.length - 2);
  const f = tt - k;
  if (!lab) return interpolateHex(colors[k], colors[k + 1], f);
  const A = hexToLab(colors[k]), B = hexToLab(colors[k + 1]);
  return labToHex(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f);
}
function getColorValue(i) {
  const n = form.count.base;
  switch (form.color.mode) {
    case 'xor': return palette.array[palette.index];
    case 'sequence': return palette.temp[i % palette.temp.length];
    case 'transitionRGB': return transitionColor(palette.temp, map(i, 0, n - 1, 0, 1), false);
    case 'transitionLAB': return transitionColor(palette.temp, map(i, 0, n - 1, 0, 1), true);
  }
}

/////////////////////////////////////////////////////////////////////////////
// Per-stamp parameter generation (port of generateParameters / get*Value).
// frame is normalised [0,1) across the loop period (length·frameRate).
/////////////////////////////////////////////////////////////////////////////
let GW = 480, GH = 480;
let formData = {};

function getMoveValue(i, noiseFn, type, freq, cycle, phase, speed, coordSeed, frame) {
  const n = form.count.base;
  switch (type) {
    case 'off': return 0;
    case 'noise': {
      const noiseFreq = map(i, 0, n - 1, 0, 1) * freq;
      const noiseSpeed = rec.length.value * rec.frameRate * map(speed, 0, 1, 0, 0.005);
      return noiseFn(coordSeed + noiseFreq, noiseSpeed * sin(TWO_PI * frame), noiseSpeed * cos(TWO_PI * frame));
    }
    case 'sin': {
      const sinFreq = map(i, 0, n - 1, 0, TWO_PI) * freq;
      return sin(TWO_PI * frame * cycle + sinFreq + TWO_PI * phase);
    }
  }
}
function getScaleValue(i, frame) {
  const n = form.count.base;
  switch (form.scale.type) {
    case 'off': return 0;
    case 'noise': {
      const noiseFreq = map(i, 0, n - 1, 0, 1) * form.scale.freq;
      const noiseSpeed = rec.length.value * rec.frameRate * map(form.scale.speed, 0, 1, 0, 0.005);
      const v = nScale(-19.8 * form.scale.seed + noiseFreq, noiseSpeed * sin(TWO_PI * frame), noiseSpeed * cos(TWO_PI * frame));
      return (v + 1) / 2;
    }
    case 'sin': {
      const sinFreq = map(i, 0, n - 1, 0, TWO_PI) * form.scale.freq;
      return (sin(TWO_PI * frame * form.scale.cycle + sinFreq + TWO_PI * form.scale.phase) + 1) / 4;
    }
  }
}
function getRotateValue(i, frame) {
  const n = form.count.base;
  switch (form.rotate.type) {
    case 'off': return 0;
    case 'noise': {
      const noiseFreq = map(i, 0, n - 1, 0, 1) * form.rotate.freq;
      const noiseSpeed = rec.length.value * rec.frameRate * map(form.rotate.speed, 0, 1, 0, 0.005);
      return nRotate(-19.8 * form.rotate.seed + noiseFreq, noiseSpeed * sin(TWO_PI * frame), noiseSpeed * cos(TWO_PI * frame));
    }
    case 'sin': {
      const sinFreq = map(i, 0, n - 1, 0, TWO_PI) * form.rotate.freq;
      return sin(TWO_PI * frame * form.rotate.cycle + sinFreq + TWO_PI * form.rotate.phase);
    }
  }
}
function moveOrder(i, order, value) {
  const n = form.count.base;
  if (order === 'forward') return map(i, 0, n - 1, 0, value);
  if (order === 'backward') return map(i, 0, n - 1, value, 0);
  return map(i, 0, n - 1, -value, value);
}
function scaleOrder(i, value) {
  const n = form.count.base, v = value * form.scale.amp;
  if (form.scale.order === 'forward') return map(i, 0, n - 1, 0, v);
  if (form.scale.order === 'backward') return map(i, 0, n - 1, v, 0);
  return map(i, 0, n - 1, v, v);
}
function rotateOrder(i, value) {
  const n = form.count.base, v = 90 * value * form.rotate.amp;
  if (form.rotate.order === 'forward') return map(i, 0, n - 1, 0, v);
  if (form.rotate.order === 'backward') return map(i, 0, n - 1, -v, 0);
  return map(i, 0, n - 1, -v, v);
}

function generateParameters() {
  const fd = {};
  fd.frame = cnv.frame / (rec.length.value * rec.frameRate);
  fd.width = GW * 0.5;
  fd.height = GH * 0.5;
  fd.scale = cnv.scale;
  fd.rotation = cnv.rotation;
  fd.position = { x: fd.width * cnv.position.x, y: fd.height * cnv.position.y };
  fd.color = []; fd.transition = { x: [], y: [] }; fd.move = { x: [], y: [] }; fd.scaleT = []; fd.rotate = []; fd.clip = [];

  const seqCount = form.sequence >= 0 ? [1, 1 - form.sequence] : [form.sequence + 1, 1];
  const n = form.count.base;

  for (let i = 0; i < n; i++) {
    fd.color.push(getColorValue(i));
    fd.transition.x.push(map(i, 0, n - 1, -fd.width * form.transition.x, fd.width * form.transition.x));
    fd.transition.y.push(map(i, 0, n - 1, -fd.height * form.transition.y, fd.height * form.transition.y));

    const xMove = getMoveValue(i, nXmove, form.xmove.type, form.xmove.freq, form.xmove.cycle, form.xmove.phase, form.xmove.speed, 29.7 * form.xmove.seed, fd.frame);
    const yMove = getMoveValue(i, nYmove, form.ymove.type, form.ymove.freq, form.ymove.cycle, form.ymove.phase, form.ymove.speed, 47.3 * form.ymove.seed, fd.frame);
    fd.move.x.push(moveOrder(i, form.xmove.order, xMove * fd.width * form.xmove.amp));
    fd.move.y.push(moveOrder(i, form.ymove.order, yMove * fd.width * form.ymove.amp));

    const sequence = map(i, 0, n - 1, seqCount[0], seqCount[1]);
    fd.scaleT.push(constrain(sequence + scaleOrder(i, getScaleValue(i, fd.frame)), 0, 2));
    fd.rotate.push(rotateOrder(i, getRotateValue(i, fd.frame)));
  }
  formData = fd;
}

/////////////////////////////////////////////////////////////////////////////
// Render: stamp the form into gForm, then split-mirror it into gDraw.
/////////////////////////////////////////////////////////////////////////////
function drawForms(p, gForm) {
  gForm.clear();
  gForm.push();
  const ctx = gForm.drawingContext;
  gForm.translate(formData.width, formData.height);
  gForm.translate(formData.position.x, formData.position.y);
  gForm.scale(formData.scale);
  gForm.rotate(formData.rotation);
  if (form.color.mode === 'xor' && form.color.type === 'fill') ctx.globalCompositeOperation = 'xor';

  for (let i = 0; i < form.count.base; i++) {
    gForm.push();
    gForm.translate(formData.transition.x[i], formData.transition.y[i]);
    gForm.translate(formData.move.x[i], formData.move.y[i]);
    gForm.scale(formData.scaleT[i]);
    gForm.rotate(formData.rotate[i]);
    gForm.translate(-SHAPE_HALF, -SHAPE_HALF);
    if (form.color.type === 'fill') {
      ctx.fillStyle = formData.color[i];
      ctx.fill(shape.path, 'evenodd');
    } else {
      ctx.lineWidth = form.stroke.width;
      ctx.strokeStyle = formData.color[i];
      ctx.stroke(shape.path);
    }
    gForm.pop();
  }
  gForm.pop();
  ctx.globalCompositeOperation = 'source-over';
}

function splitFormation(count, x, y) {
  const data = { x: 0, y: 0, width: GW, height: GH, scale: { x: 1, y: 1 } };
  const mx = floor(GW * 0.5 * (1 + split.mask.x));
  const my = floor(GH * 0.5 * (1 + split.mask.y));
  switch (split.type) {
    case 'none': break;
    case 'vertical':
      if (y === 0) { data.y = 0; data.height = my; data.scale.y = 1; }
      else { data.y = my; data.height = GH; data.scale.y = -1; }
      break;
    case 'horizontal':
      if (x === 0) { data.x = 0; data.width = mx; data.scale.x = 1; }
      else { data.x = mx; data.width = GW; data.scale.x = -1; }
      break;
    case 'quad':
      if (x === 0) { data.x = 0; data.width = mx; } else { data.x = mx; data.width = GW; }
      if (y === 0) { data.y = 0; data.height = my; } else { data.y = my; data.height = GH; }
      data.scale.x = count === 2 || count === 3 ? -1 : 1;
      data.scale.y = count === 1 || count === 3 ? -1 : 1;
      break;
  }
  return data;
}

function drawSplitImages(p, gForm, gDraw) {
  gDraw.clear();
  let count = 0;
  for (let x = 0; x < split.x; x++) {
    for (let y = 0; y < split.y; y++) {
      gDraw.push();
      const clip = splitFormation(count, x, y);
      const ctx = gDraw.drawingContext;
      ctx.save();
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.width - clip.x, clip.height - clip.y);
      ctx.clip();
      gDraw.translate(GW * 0.5, GH * 0.5);
      gDraw.scale(clip.scale.x, clip.scale.y);
      gDraw.imageMode(p.CENTER);
      gDraw.image(gForm, 0, 0, GW, GH, 0, 0, gForm.width, gForm.height);
      ctx.restore();
      gDraw.pop();
      count++;
    }
  }
}

/////////////////////////////////////////////////////////////////////////////
// SVG export — reconstruct the same formData with Paper.js (faithful XOR
// compound paths + split clip layers), exactly as the reference svg.js does.
/////////////////////////////////////////////////////////////////////////////
let paperReady = false;
function renderSVG() {
  const paper = window.paper;
  if (!paper) { console.warn('Paper.js not loaded — SVG export unavailable'); return ''; }
  generateParameters();
  const c = document.createElement('canvas');
  c.width = GW; c.height = GH;
  paper.setup(c);
  paper.pixelRatio = 1;
  paper.view.translate(GW / 2, GH / 2);

  if (cnv.color.mode !== 'transparent') {
    const bg = new paper.Shape.Rectangle(new paper.Rectangle(-GW / 2, -GH / 2, GW, GH));
    bg.fillColor = cnv.color.mode === 'custom' ? cnv.color.custom : palette.array[cnv.color.slot];
    new paper.Layer({ position: paper.view.center, children: [bg] });
  }

  // clip rects per split cell
  let count = 0;
  const clips = [];
  for (let x = 0; x < split.x; x++) for (let y = 0; y < split.y; y++) { clips.push(splitFormation(count, x, y)); count++; }

  for (let ci = 0; ci < clips.length; ci++) {
    const group = new paper.Group({
      position: new paper.Point(formData.position.x, formData.position.y),
      scaling: formData.scale, rotation: formData.rotation, applyMatrix: false,
    });
    const shapeArray = [];
    for (let i = 0; i < form.count.base; i++) {
      const it = new paper.CompoundPath(shape.d);
      it.translate(new paper.Point(formData.transition.x[i], formData.transition.y[i]));
      it.translate(new paper.Point(formData.move.x[i], formData.move.y[i]));
      it.scale(formData.scaleT[i]);
      it.rotate(formData.rotate[i]);
      it.translate(new paper.Point(-SHAPE_HALF, -SHAPE_HALF));
      if (form.color.type === 'fill') it.fillColor = formData.color[i];
      else { it.strokeWidth = form.stroke.width * formData.scaleT[i]; it.strokeColor = formData.color[i]; }
      shapeArray[i] = it;
    }
    if (form.color.mode === 'xor' && form.color.type === 'fill') {
      group.addChild(new paper.CompoundPath({ children: shapeArray, fillColor: palette.array[palette.index], fillRule: 'evenodd' }));
    } else {
      group.addChildren(shapeArray);
    }
    const layerGroup = new paper.Layer({ position: paper.view.center, children: [group] });
    layerGroup.scale(clips[ci].scale.x, clips[ci].scale.y, paper.view.center);
    const maskRect = new paper.Path.Rectangle({
      from: new paper.Point(clips[ci].x - GW / 2, clips[ci].y - GH / 2),
      to: new paper.Point(clips[ci].width - GW / 2, clips[ci].height - GH / 2),
    });
    const layer = new paper.Layer({ position: paper.view.center, children: [maskRect, layerGroup] });
    layer.clipped = true;
  }
  paper.view.draw();
  const svg = paper.project.exportSVG({ asString: true });
  paper.project.clear();
  paper.view.remove();
  return svg;
}

/////////////////////////////////////////////////////////////////////////////
// p5 sketch (render-space buffers composited onto a fit-to-viewport canvas)
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'SPLITX', version: '0.2' });
let P = null, gForm = null, gDraw = null, displayCanvas = null;

function applyRatio(p) {
  [GW, GH] = RATIOS[cnv.ratio];
  if (gForm) gForm.remove();
  if (gDraw) gDraw.remove();
  gForm = p.createGraphics(GW, GH);
  gForm.pixelDensity(2); gForm.angleMode(p.DEGREES); gForm.noStroke();
  gDraw = p.createGraphics(GW, GH);
  gDraw.pixelDensity(2);
  p.resizeCanvas(GW, GH);
  fitCanvas();
}
function fitCanvas() {
  if (!displayCanvas) return;
  const pad = 48;
  const k = Math.min((window.innerWidth - pad * 2) / GW, (window.innerHeight - pad * 2) / GH);
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
    displayCanvas.elt.style.display = 'block';
    p.pixelDensity(2);
    p.angleMode(p.DEGREES);
    p.rectMode(p.CENTER);
    p.imageMode(p.CENTER);
    p.frameRate(rec.frameRate);
    refreshShape();
    populatePaletteColors();
    applyRatio(p);
  };

  p.draw = () => {
    generateParameters();
    drawForms(p, gForm);
    drawSplitImages(p, gForm, gDraw);

    p.clear();
    p.push();
    p.translate(GW / 2, GH / 2);
    if (cnv.color.mode === 'transparent') {
      drawChecker(p);
    } else {
      p.noStroke();
      p.fill(cnv.color.mode === 'custom' ? cnv.color.custom : palette.array[cnv.color.slot]);
      p.rect(0, 0, GW, GH);
    }
    p.image(gDraw, 0, 0, GW, GH, 0, 0, gDraw.width, gDraw.height);
    p.pop();

    if (cnv.animation) cnv.frame = formData.frame >= 1 ? 0 : cnv.frame + 1;
  };

  p.windowResized = () => fitCanvas();
});

function drawChecker(p) {
  const s = (GW + GH) / 60;
  p.noStroke();
  p.rectMode(p.CORNER);
  for (let y = -GH / 2, j = 0; y < GH / 2; y += s, j++) {
    for (let x = -GW / 2, i = 0; x < GW / 2; x += s, i++) {
      p.fill((i + j) % 2 ? 255 : 220);
      p.rect(x, y, s, s);
    }
  }
  p.rectMode(p.CENTER);
}

/////////////////////////////////////////////////////////////////////////////
// Custom SVG drag-drop (Paper normalises a dropped path to the 360 box)
/////////////////////////////////////////////////////////////////////////////
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
    const mult = Math.min(360 / b.width, 360 / b.height);
    cp.translate(new paper.Point(-b.x, -b.y));
    cp.scale(mult, new paper.Point(0, 0));
    // centre within the 360 box
    cp.translate(new paper.Point((360 - b.width * mult) / 2, (360 - b.height * mult) / 2));
    shape.customD = cp.pathData;
    shape.type = 'custom';
    cp.remove(); paper.project.clear();
    refreshShape();
    tool.pane.refresh();
  } catch (err) { console.error('SVG import failed', err); }
}
tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file || (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name))) return;
  const reader = new FileReader();
  reader.onload = () => importCustomSVG(reader.result);
  reader.readAsText(file);
});

/////////////////////////////////////////////////////////////////////////////
// UI — mirrors the reference folder structure (CANVAS / SHAPE / COLOR /
// TRANSFORM + a SCALE / X MOVE / Y MOVE / ROTATE motion tab).
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;

const fCanvas = main.addFolder({ title: 'CANVAS', expanded: false });
fCanvas.addBinding(cnv, 'ratio', { label: 'Canvas Ratio', options: RATIO_OPTS }).on('change', () => { if (P) applyRatio(P); });
const bgMode = fCanvas.addBinding(cnv.color, 'mode', { label: 'Background', options: BG_OPTS }).on('change', () => colorUI());
const bgCustom = fCanvas.addBinding(cnv.color, 'custom', { label: 'Canvas Color', view: 'color' });
const bgSlot = fCanvas.addBinding(cnv.color, 'slot', { label: 'Palette Color', options: SLOT_OPTS });

const fShape = main.addFolder({ title: 'SHAPE' });
fShape.addBinding(shape, 'type', { label: 'Choose Type', options: SHAPE_OPTS }).on('change', () => { refreshShape(); });
fShape.addBinding(form.count, 'base', { label: 'Shape Count', min: 2, max: 200, step: 1 });
fShape.addBinding(form, 'sequence', { label: 'Scale Sequence', min: -1, max: 1, step: 0.01 });

const fColor = main.addFolder({ title: 'COLOR' });
fColor.addBinding(form.color, 'type', { label: 'Styling Type', options: STYLE_OPTS }).on('change', () => colorUI());
const strokeW = fColor.addBinding(form.stroke, 'width', { label: 'Stroke Width', min: 0.5, max: 10, step: 0.1 });
fColor.addBinding(form.color, 'mode', { label: 'Drawing Mode', options: FILL_OPTS }).on('change', () => { populatePaletteColors(); colorUI(); });
const xorIndex = fColor.addBinding(palette, 'index', { label: 'Cutout Color', options: SLOT_OPTS });
attachPaletteControls(fColor, { palette, pane: tool.pane, onChange: populatePaletteColors });

const fXform = main.addFolder({ title: 'TRANSFORM', expanded: false });
fXform.addBinding(split, 'type', { label: 'Split Mask', options: SPLIT_OPTS }).on('change', () => splitUI());
fXform.addBinding(cnv, 'scale', { label: 'Scale', min: 0.25, max: 5, step: 0.01 });
fXform.addBinding(cnv, 'rotation', { label: 'Rotation', min: -180, max: 180, step: 1 });
fXform.addBinding(cnv, 'position', { label: 'Position', x: { min: -1, max: 1, step: 0.01 }, y: { min: -1, max: 1, step: 0.01 } });
fXform.addBinding(form, 'transition', { label: 'Transition', x: { min: -1, max: 1, step: 0.01 }, y: { min: -1, max: 1, step: 0.01 } });

const mtab = main.addTab({ pages: [{ title: 'SCALE' }, { title: 'X MOVE' }, { title: 'Y MOVE' }, { title: 'ROTATE' }] });
function buildMotionPage(page, key, ampMin) {
  const ch = form[key];
  page.addBinding(ch, 'type', { label: 'Motion Type', options: MOTION_OPTS });
  page.addBinding(ch, 'order', { label: 'Effect Order', options: ORDER_OPTS });
  page.addBinding(ch, 'amp', { label: 'Amplitude', min: ampMin, max: 1, step: 0.01 });
  page.addBinding(ch, 'freq', { label: 'Frequency', min: 0, max: 1, step: 0.01 });
  page.addBinding(ch, 'cycle', { label: 'Cycles', min: 0, max: 20, step: 1 });
  page.addBinding(ch, 'speed', { label: 'Speed', min: 0, max: 1, step: 0.01 });
  page.addBinding(ch, 'phase', { label: 'Phase', min: -0.5, max: 0.5, step: 0.01 });
  page.addBinding(ch, 'seed', { label: 'Noise Seed', min: 0, max: 1000, step: 1 }).on('change', () => seedEvent());
}
buildMotionPage(mtab.pages[0], 'scale', -1);
buildMotionPage(mtab.pages[1], 'xmove', 0.01);
buildMotionPage(mtab.pages[2], 'ymove', 0.01);
buildMotionPage(mtab.pages[3], 'rotate', 0.01);

function splitUI() {
  if (split.type === 'none') { split.x = 1; split.y = 1; }
  else if (split.type === 'vertical') { split.x = 1; split.y = 2; }
  else if (split.type === 'horizontal') { split.x = 2; split.y = 1; }
  else { split.x = 2; split.y = 2; }
}
function colorUI() {
  bgCustom.hidden = cnv.color.mode !== 'custom';
  bgSlot.hidden = cnv.color.mode !== 'palette';
  strokeW.hidden = form.color.type !== 'stroke';
  xorIndex.hidden = !(form.color.mode === 'xor' && form.color.type === 'fill');
}

/////////////////////////////////////////////////////////////////////////////
// Export + Presets
/////////////////////////////////////////////////////////////////////////////
attachExport(tool.pages.export, { getCanvas: tool.getCanvas, getSVG: renderSVG, name: 'splitx' });

const presets = {
  Tremor: {
    cnv: { ratio: '1:1', scale: 0.48, rotation: 84, position: { x: -0.06, y: -0.24 }, color: { mode: 'palette', slot: 0 }, frame: 117 },
    palette: { index: 2, array: ['#f6a21f', '#e23b2e', '#241a1b', '#ebc83a', '#73b295'], use: [false, true, true, false, false] },
    form: { type: 'triangle', color: { type: 'fill', mode: 'xor' }, stroke: { width: 5 }, count: { base: 40 }, sequence: -0.09, transition: { x: 0.84, y: -1 },
      scale: { type: 'noise', order: 'equal', seed: 679, amp: -0.32, freq: 0.38, cycle: 2, phase: 0.5, speed: 0.28 },
      xmove: { type: 'sin', order: 'forward', seed: 266, amp: 0.15, freq: 0.25, cycle: 2, phase: 0.06, speed: 0.27 },
      ymove: { type: 'sin', order: 'backward', seed: 602, amp: 0.19, freq: 0.36, cycle: 3, phase: 0, speed: 0.23 },
      rotate: { type: 'sin', order: 'forward', seed: 665, amp: 0.1, freq: 0.75, cycle: 4, phase: 0.43, speed: 0.17 } },
    split: { type: 'quad' },
  },
  'Lotus Bloom': {
    cnv: { ratio: '1:1', scale: 1.4, rotation: 0, position: { x: 0, y: 0 }, color: { mode: 'palette', slot: 0 }, frame: 73 },
    palette: { index: 1, array: ['#fdf6c0', '#b6d79f', '#f5a82a', '#cf2620', '#5a120e'], use: [true, true, true, true, true] },
    form: { type: 'blob', color: { type: 'stroke', mode: 'transitionLAB' }, stroke: { width: 3 }, count: { base: 100 }, sequence: 0.76, transition: { x: 0, y: 0 },
      scale: { type: 'off', order: 'forward', seed: 729, amp: 0.29, freq: 0, cycle: 9, phase: 0.13, speed: 0.63 },
      xmove: { type: 'noise', order: 'equal', seed: 101, amp: 0.44, freq: 0.86, cycle: 7, phase: 0.5, speed: 0.27 },
      ymove: { type: 'noise', order: 'equal', seed: 551, amp: 0.29, freq: 0.99, cycle: 2, phase: 0.32, speed: 0.2 },
      rotate: { type: 'noise', order: 'equal', seed: 471, amp: 0.41, freq: 0.54, cycle: 9, phase: 0.4, speed: 0.49 } },
    split: { type: 'quad' },
  },
  Prism: {
    cnv: { ratio: '1:1', scale: 0.9, rotation: 0, position: { x: 0, y: 0 }, color: { mode: 'custom', custom: '#0c0f1a' }, frame: 40 },
    palette: { index: 0, array: ['#2d00f7', '#6a00f4', '#b100e8', '#e500a4', '#ff8500'], use: [true, true, true, true, true] },
    form: { type: 'hexagon', color: { type: 'stroke', mode: 'transitionRGB' }, stroke: { width: 2 }, count: { base: 60 }, sequence: 0.85, transition: { x: 0, y: 0 },
      scale: { type: 'sin', order: 'equal', seed: 333, amp: 0.4, freq: 0.5, cycle: 3, phase: 0, speed: 0.25 },
      xmove: { type: 'off', order: 'equal', seed: 220, amp: 0.25, freq: 0.2, cycle: 1, phase: 0, speed: 0.25 },
      ymove: { type: 'off', order: 'equal', seed: 740, amp: 0.25, freq: 0.2, cycle: 1, phase: 0, speed: 0.25 },
      rotate: { type: 'sin', order: 'forward', seed: 555, amp: 0.6, freq: 0.3, cycle: 2, phase: 0, speed: 0.2 } },
    split: { type: 'quad' },
  },
  Crosscut: {
    cnv: { ratio: '1:1', scale: 1, rotation: 45, position: { x: 0, y: 0 }, color: { mode: 'custom', custom: '#f4f1ea' }, frame: 0 },
    palette: { index: 0, array: ['#101010', '#101010', '#101010', '#101010', '#101010'], use: [true, true, true, true, true] },
    form: { type: 'cross', color: { type: 'fill', mode: 'xor' }, stroke: { width: 2 }, count: { base: 24 }, sequence: 0.6, transition: { x: 0.5, y: 0.5 },
      scale: { type: 'noise', order: 'forward', seed: 12, amp: 0.3, freq: 0.4, cycle: 1, phase: 0, speed: 0.2 },
      xmove: { type: 'noise', order: 'equal', seed: 88, amp: 0.2, freq: 0.3, cycle: 1, phase: 0, speed: 0.25 },
      ymove: { type: 'noise', order: 'equal', seed: 41, amp: 0.2, freq: 0.3, cycle: 1, phase: 0, speed: 0.25 },
      rotate: { type: 'off', order: 'equal', seed: 555, amp: 0.25, freq: 0.2, cycle: 1, phase: 0, speed: 0.25 } },
    split: { type: 'horizontal' },
  },
  Pulse: {
    cnv: { ratio: '1:1', scale: 0.8, rotation: 0, position: { x: 0, y: 0 }, color: { mode: 'custom', custom: '#04110f' }, frame: 30 },
    palette: { index: 0, array: ['#02231d', '#0f7a5a', '#3fe0a6', '#bff7e3', '#ffffff'], use: [true, true, true, true, true] },
    form: { type: 'ring', color: { type: 'fill', mode: 'transitionRGB' }, stroke: { width: 2 }, count: { base: 50 }, sequence: 0.9, transition: { x: 0, y: 0 },
      scale: { type: 'sin', order: 'forward', seed: 333, amp: 0.5, freq: 0.6, cycle: 4, phase: 0, speed: 0.3 },
      xmove: { type: 'off', order: 'equal', seed: 220, amp: 0.25, freq: 0.2, cycle: 1, phase: 0, speed: 0.25 },
      ymove: { type: 'off', order: 'equal', seed: 740, amp: 0.25, freq: 0.2, cycle: 1, phase: 0, speed: 0.25 },
      rotate: { type: 'off', order: 'equal', seed: 555, amp: 0.25, freq: 0.2, cycle: 1, phase: 0, speed: 0.25 } },
    split: { type: 'none' },
  },
  Petalwork: {
    cnv: { ratio: '1:1', scale: 0.7, rotation: 0, position: { x: 0, y: 0 }, color: { mode: 'custom', custom: '#1a0b2e' }, frame: 55 },
    palette: { index: 0, array: ['#ff7675', '#fd79a8', '#fdcb6e', '#ffeaa7', '#ffffff'], use: [true, true, true, true, true] },
    form: { type: 'petals', color: { type: 'fill', mode: 'sequence' }, stroke: { width: 2 }, count: { base: 36 }, sequence: 0.82, transition: { x: 0, y: 0 },
      scale: { type: 'noise', order: 'equal', seed: 200, amp: 0.3, freq: 0.5, cycle: 1, phase: 0, speed: 0.25 },
      xmove: { type: 'noise', order: 'equal', seed: 99, amp: 0.3, freq: 0.6, cycle: 1, phase: 0, speed: 0.3 },
      ymove: { type: 'noise', order: 'equal', seed: 333, amp: 0.3, freq: 0.6, cycle: 1, phase: 0, speed: 0.3 },
      rotate: { type: 'sin', order: 'forward', seed: 555, amp: 0.4, freq: 0.4, cycle: 3, phase: 0, speed: 0.25 } },
    split: { type: 'quad' },
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
  deepMerge(split, structuredClone(DEFAULTS.split));
  DEFAULTS.palette.array.forEach((c, i) => { palette.array[i] = c; });
  DEFAULTS.palette.use.forEach((u, i) => { palette.use[i] = u; });
  palette.index = DEFAULTS.palette.index;
}
function applyPreset(name) {
  const pr = presets[name]; if (!pr) return;
  resetToDefaults();
  if (pr.cnv) deepMerge(cnv, pr.cnv);
  if (pr.form) { if (pr.form.type) shape.type = pr.form.type; deepMerge(form, pr.form); }
  if (pr.split) deepMerge(split, pr.split);
  if (pr.palette) {
    if (pr.palette.array) pr.palette.array.forEach((c, i) => { palette.array[i] = c; });
    if (pr.palette.use) pr.palette.use.forEach((u, i) => { palette.use[i] = u; });
    if (pr.palette.index != null) palette.index = pr.palette.index;
  }
  cnv.frame = pr.cnv?.frame ?? 0;
  refreshShape();
  populatePaletteColors();
  seedEvent();
  splitUI();
  colorUI();
  if (P) applyRatio(P);
  tool.pane.refresh();
}

const presetState = { name: 'Tremor' };
const opts = tool.pages.options;
opts.addBinding(presetState, 'name', { label: 'Preset', options: Object.fromEntries(Object.keys(presets).map((k) => [k, k])) }).on('change', (ev) => applyPreset(ev.value));
opts.addButton({ title: 'Apply Preset' }).on('click', () => applyPreset(presetState.name));
opts.addBinding(cnv, 'animation', { label: 'Animate' }).on('change', () => { cnv.frame = 0; });
opts.addButton({ title: 'Fullscreen (f)' }).on('click', () => tool.toggleFullscreen());

window.addEventListener('resize', fitCanvas);
// Dev hook: drive presets / inspect state from the console while tuning fidelity.
exposeDebug('splitx', { applyPreset, renderSVG, importCustomSVG, cnv, form, split, palette, shape, presets, setFrame: (f) => { cnv.frame = f; } });

colorUI();
splitUI();
applyPreset('Tremor');
