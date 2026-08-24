// TEXTR — kinetic typography. A phrase is laid out as a stack of rows (vertical)
// or a row of columns (horizontal) of repeated words/letters; each row's COUNT of
// copies follows an order pattern (forward / backward / back-and-forth / random)
// so the text mass forms shapes (diamonds, waves), and every copy is displaced
// perpendicular to the layout axis by a sine / double-sine / 4D-noise wave whose
// phase is driven by the copy index AND the row's position (a travelling wave),
// with optional scale modulation, collision spacing and infinite scroll. Glyph
// layout runs on opentype.js. Live render = p5 2D + `ctx.fill(Path2D)`; SVG
// export = Paper.js reconstruction of the same arrangement.
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachExport } from '../../js/etch/export.js';
import { alea } from '../../js/etch/noise.js';
import { createNoise2D, createNoise4D } from '../../js/vendor/simplex/simplex-noise.js';
import { loadFont, parseFont, FONT_OPTIONS } from '../../js/etch/typography.js';

/////////////////////////////////////////////////////////////////////////////
// Math + easing — curves referenced by name from params
/////////////////////////////////////////////////////////////////////////////
const { sin, cos, abs, floor, ceil, min, max, sqrt, pow, PI } = Math;
const TWO_PI = PI * 2, HALF_PI = PI / 2;
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const constrain = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fract = (v) => v - floor(v);

const EASE = {
  linear: (t) => t,
  easeInSine: (t) => -cos(t * HALF_PI) + 1,
  easeOutSine: (t) => sin(t * HALF_PI),
  easeInOutSine: (t) => -0.5 * (cos(PI * t) - 1),
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => { const u = t - 1; return u * u * u + 1; },
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeInExpo: (t) => (t === 0 ? 0 : pow(2, 10 * (t - 1))),
  easeOutExpo: (t) => (t === 1 ? 1 : -pow(2, -10 * t) + 1),
  easeInOutExpo: (t) => { if (t === 0 || t === 1) return t; const s = t * 2, s1 = s - 1; return s < 1 ? 0.5 * pow(2, 10 * s1) : 0.5 * (-pow(2, -10 * s1) + 2); },
  easeInCirc: (t) => -1 * (sqrt(1 - t * t) - 1),
  easeOutCirc: (t) => { const u = t - 1; return sqrt(1 - u * u); },
  easeInOutCirc: (t) => { const s = t * 2, s2 = s - 2; return s < 1 ? -0.5 * (sqrt(1 - s * s) - 1) : 0.5 * (sqrt(1 - s2 * s2) + 1); },
  easeInBack: (t, m = 1.70158) => t * t * ((m + 1) * t - m),
  easeOutBack: (t, m = 1.70158) => { const s = t - 1; return s * s * ((m + 1) * s + m) + 1; },
  easeInOutBack: (t, m = 1.70158) => { const s = t * 2, s2 = s - 2, k = m * 1.525; return s < 1 ? 0.5 * s * s * ((k + 1) * s - k) : 0.5 * (s2 * s2 * ((k + 1) * s2 + k) + 2); },
  easeInElastic: (t, m = 0.7) => { if (t === 0 || t === 1) return t; const s1 = t - 1, p = 1 - m, s = (p / TWO_PI) * Math.asin(1); return -(pow(2, 10 * s1) * sin(((s1 - s) * TWO_PI) / p)); },
  easeOutElastic: (t, m = 0.7) => { if (t === 0 || t === 1) return t; const p = 1 - m, st = t * 2, s = (p / TWO_PI) * Math.asin(1); return pow(2, -10 * st) * sin(((st - s) * TWO_PI) / p) + 1; },
  easeInOutElastic: (t, m = 0.65) => { if (t === 0 || t === 1) return t; const p = 1 - m, st = t * 2, s1 = st - 1, s = (p / TWO_PI) * Math.asin(1); return st < 1 ? -0.5 * (pow(2, 10 * s1) * sin(((s1 - s) * TWO_PI) / p)) : pow(2, -10 * s1) * sin(((s1 - s) * TWO_PI) / p) * 0.5 + 1; },
  easeOutBounce: (t) => { if (t < 1 / 2.75) return 7.5625 * t * t; if (t < 2 / 2.75) { const u = t - 1.5 / 2.75; return 7.5625 * u * u + 0.75; } if (t < 2.5 / 2.75) { const u = t - 2.25 / 2.75; return 7.5625 * u * u + 0.9375; } const u = t - 2.625 / 2.75; return 7.5625 * u * u + 0.984375; },
  easeInBounce: (t) => 1 - EASE.easeOutBounce(1 - t),
  easeInOutBounce: (t) => (t < 0.5 ? EASE.easeInBounce(t * 2) * 0.5 : EASE.easeOutBounce(t * 2 - 1) * 0.5 + 0.5),
};
const ez = (name, t) => (EASE[name] || EASE.linear)(t);

/////////////////////////////////////////////////////////////////////////////
// Option maps
/////////////////////////////////////////////////////////////////////////////
const RATIOS = {
  '2:1': [480, 240], '16:9': [640, 360], '3:2': [480, 320], '4:3': [480, 360],
  '5:4': [600, 480], '1:1': [480, 480], '4:5': [480, 600], '3:4': [360, 480],
  '2:3': [320, 480], '9:16': [360, 640], '1:2': [240, 480],
};
const RATIO_OPTS = Object.fromEntries(Object.keys(RATIOS).map((k) => [k, k]));
const BG_OPTS = { 'Color Fill': 'fill', Transparent: 'transparent' };
const LAYOUT_OPTS = { Vertical: 'vertical', Horizontal: 'horizontal' };
const TEXT_OPTS = { 'Repeat by Word': 'repeatWord', 'Repeat by Letter': 'repeatLetter', 'Split by Word': 'splitWord', 'Split by Letter': 'splitLetter' };
const ORDER_OPTS = { None: 'none', Forward: 'forward', Backward: 'backward', 'Back & Forth': 'backforth', Random: 'random' };
const MOTION_OPTS = { None: 'none', Sinusoid: 'sin', 'Double Sinusoid': 'doublesin', Noise: 'noise' };
const SCALE_OPTS = { None: 'none', 'Use Position Data': 'pos', Sinusoid: 'sin', 'Double Sinusoid': 'doublesin', Noise: 'noise' };
const AMP_OPTS = { 'Easing Off': 'uniform', 'From Center': 'center', 'From Edges': 'edge', 'To Side (0→1)': 'side0', 'To Side (1→0)': 'side1' };
const EASE_OPTS = { Linear: 'linear', 'Sine In': 'easeInSine', 'Sine Out': 'easeOutSine', 'Sine In/Out': 'easeInOutSine', 'Quad In': 'easeInQuad', 'Quad Out': 'easeOutQuad', 'Quad In/Out': 'easeInOutQuad', 'Cubic In': 'easeInCubic', 'Cubic Out': 'easeOutCubic', 'Cubic In/Out': 'easeInOutCubic', 'Expo In': 'easeInExpo', 'Expo Out': 'easeOutExpo', 'Circ In': 'easeInCirc', 'Circ Out': 'easeOutCirc', 'Back In': 'easeInBack', 'Back Out': 'easeOutBack', 'Elastic In': 'easeInElastic', 'Elastic Out': 'easeOutElastic', 'Bounce In': 'easeInBounce', 'Bounce Out': 'easeOutBounce' };

/////////////////////////////////////////////////////////////////////////////
// State — the default parameter tree
/////////////////////////////////////////////////////////////////////////////
const cnv = { ratio: '1:1', scale: 1, frame: 0, maxFrames: 900, animation: true, seed: (Math.random() * 1000) | 0, bg: { mode: 'fill', fill: '#000000' } };
const params = {
  font: 'Space Mono',
  phrase: 'ONE',
  layout: 'vertical',
  type: 'repeatWord',
  color: '#FFFFFF',
  scroll: 0,
  interval: 4,
  collision: { use: true, offset: 3 },
  size: { font: 8, min: 4, max: 72 },
  margins: { value: 0.9 },
  items: { value: 20 },
  count: { order: 'backforth', index: 0, value: 25, scope: { min: 4, max: 16 } },
  pos: {
    mode: 'sin', ease: 'linear', seed: (Math.random() * 1000) | 0,
    amp: { mode: 'uniform', ease: 'linear', value: 50 },
    phase: { mirror: false, offset: 0 },
    sin: { x: 1, y: 1.5, cycle: 2 },
    add: { ease: 'linear', x: 0.5, y: 0.5, cycle: 0 },
    noise: { x: 0.2, y: 0.5, speed: 0.5 },
  },
  scale: {
    mode: 'noise', ease: 'linear', seed: (Math.random() * 1000) | 0, start: 1, end: 1,
    phase: { mirror: false, offset: 0 },
    sin: { x: 1, y: 1.5, cycle: 2 },
    add: { ease: 'linear', x: 0.5, y: 0.5, cycle: 0 },
    noise: { x: 0.2, y: 0.5, speed: 0.5 },
  },
};
const rec = { frameRate: 60, length: { value: 2 } };
const DEFAULTS = structuredClone({ cnv, params });

/////////////////////////////////////////////////////////////////////////////
// Seeded simplex (base = order-random, pos / scale = motion)
/////////////////////////////////////////////////////////////////////////////
let nBase, nPos, nScale;
function seedEvent() {
  nBase = createNoise2D(alea(cnv.seed));
  nPos = createNoise4D(alea(params.pos.seed));
  nScale = createNoise4D(alea(params.scale.seed));
}
seedEvent();

/////////////////////////////////////////////////////////////////////////////
// Glyph layout (opentype.js) → textr.words[] of { word:Path2D, svg, pos, size }
/////////////////////////////////////////////////////////////////////////////
const textr = { words: [], width: 0, height: 0, interval: 0 };
let FONT = null;

function unitMetrics(str) {
  // path with baseline at y=0, left at x=0 (glyph extends upward = negative y)
  const otPath = FONT.getPath(str, 0, 0, params.size.font);
  const svg = otPath.toPathData(3);
  const bb = otPath.getBoundingBox(); // {x1,y1,x2,y2}; empty → all 0
  const advance = FONT.getAdvanceWidth(str, params.size.font);
  const cx = (bb.x1 + bb.x2) / 2;
  const cy = (bb.y1 + bb.y2) / 2;
  return { svg, path: new Path2D(svg), advance, bb, cx, cy, height: bb.y2 - bb.y1 };
}

function getTextBounds() {
  textr.words = []; textr.width = 0; textr.height = 0;
  const wSpace = params.layout === 'vertical' ? params.collision.offset : 0;
  const hSpace = params.layout === 'horizontal' ? params.collision.offset : 0;
  // font letter-spacing → row/copy interval (px)
  textr.interval = params.size.font * (params.interval * 10) / 1000;

  let units;
  if (params.type === 'repeatLetter' || params.type === 'splitLetter') {
    units = [...((params.phrase.trim() ? params.phrase : 'EMPTY').replace(/\s+/g, ''))];
  } else {
    const raw = (params.phrase.replace(/\s+$/, '').trim() ? params.phrase.replace(/\s+$/, '') : 'EMPTY');
    units = raw.split(/\s+/).filter(Boolean);
  }

  for (const u of units) {
    if (!u) continue;
    const m = unitMetrics(u);
    const wordObject = {
      word: m.path, svg: m.svg,
      pos: { width: m.advance + wSpace, height: m.height + hSpace },
      size: { width: m.cx, height: m.cy },
    };
    textr.width = max(textr.width, wordObject.pos.width, 1);
    textr.height = max(textr.height, m.height + hSpace, 1);
    textr.words.push(wordObject);
  }
  if (!textr.words.length) textr.words.push({ word: new Path2D(), svg: '', pos: { width: 1, height: 1 }, size: { width: 0, height: 0 } });
}

/////////////////////////////////////////////////////////////////////////////
// Form arrangement
/////////////////////////////////////////////////////////////////////////////
let GW = 480, GH = 480;
let formData = {};

function generateForms() {
  if (!FONT) return;
  getTextBounds();
  formData = { translate: {}, array: [], margins: params.margins.value, interval: textr.interval };
  let textrSize = 0, index = 0;
  formData.cnvsize = params.layout === 'vertical' ? GW : GH;

  while (index < params.items.value) {
    formData.array.push(new Form(index, textrSize));
    let size;
    if (params.layout === 'vertical') size = textr.height;
    else if (params.type === 'repeatWord' || params.type === 'repeatLetter') size = textr.words[index % textr.words.length].pos.width;
    else size = textr.width;
    textrSize += size + formData.interval;
    index++;
  }
  formData.size = textrSize;

  switch (params.count.order) {
    case 'backforth': formData.countIndex = floor(formData.array.length / 2); break;
    case 'forward': formData.countIndex = -params.count.scope.max + params.count.scope.min - 1; break;
    default: formData.countIndex = 0;
  }

  if (params.layout === 'vertical') {
    formData.translate.x = GW / 2 + params.collision.offset / 2;
    formData.translate.y = (GH - formData.size + formData.interval) / 2 + textr.height;
  } else {
    formData.translate.x = (GW - formData.size + formData.interval) / 2;
    formData.translate.y = GH / 2 + textr.height - params.collision.offset / 2;
  }
}

class Form {
  constructor(index, size) {
    this.index = index;
    this.text = []; this.svg = [];
    this.x = params.layout === 'horizontal' ? size : 0;
    this.y = params.layout === 'vertical' ? size : 0;
    this.count = 0; this.mincount = 1;
    this.scale = []; this.pos = [];
    this.size = { width: [], height: [] };
    this.translate = { x: 0, y: 0 };
  }

  updateIndex(index) {
    const n = textr.words.length;
    return (index >= 0 ? index : n + (index % n)) % n;
  }

  scroll(index, data) {
    if (params.layout === 'vertical') {
      this.y += data.scroll;
      if (data.scroll > 0 && this.y > formData.size) { this.index -= formData.array.length; this.y = this.y % formData.size; }
      if (data.scroll < 0 && this.y < 0) { this.index += formData.array.length; this.y = formData.size + (this.y % formData.size); }
      return;
    }
    this.x += data.scroll;
    if (params.type === 'repeatWord' || params.type === 'repeatLetter') {
      if (data.scroll > 0 && this.x > formData.size) {
        const space = (formData.array.length - this.index) % formData.array.length === 1 ? 0 : data.scroll;
        this.index -= formData.array.length;
        const obj = formData.array.reduce((m, it) => (it.x < m.x ? it : m), formData.array[0]);
        const objectsize = textr.words[this.updateIndex(this.index)].pos.width + formData.interval;
        this.x = obj.x - objectsize + space;
      }
      if (data.scroll < 0 && this.x < 0) {
        const space = this.index % formData.array.length === 0 ? data.scroll : 0;
        this.index += formData.array.length;
        const obj = formData.array.reduce((m, it) => (it.x > m.x ? it : m), formData.array[0]);
        const objectsize = textr.words[this.updateIndex(obj.index)].pos.width + formData.interval;
        this.x = obj.x + objectsize + space;
      }
    } else {
      if (data.scroll > 0 && this.x > formData.size) { this.index -= formData.array.length; this.x = this.x % formData.size; }
      if (data.scroll < 0 && this.x < 0) { this.index += formData.array.length; this.x = formData.size + (this.x % formData.size); }
    }
  }

  update(index, data) {
    let allSize = 0, maxSize = 0, offset = 0;
    this.text = []; this.svg = []; this.pos = []; this.size.width = []; this.size.height = []; this.scale = [];
    this.count = this.setCount();
    this.mincount = this.count === 1 ? 0 : 1;
    const maxpos = formData.cnvsize * formData.margins;
    const name = params.layout === 'vertical' ? 'x' : 'y';
    this[name] = [];

    for (let i = 0; i < this.count; i++) {
      const n = this.setIndex(i, index);
      const content = textr.words[n % textr.words.length];
      const w = params.layout === 'vertical' ? content.pos.width : textr.height;
      this.text.push(content.word); this.svg.push(content.svg);
      this.size.width.push(content.size.width); this.size.height.push(content.size.height);
      this.pos.push(w);
      allSize += w; maxSize = max(maxSize, w);
      let pos = map(i, 0, this.count - this.mincount, -maxpos / 2, maxpos / 2);
      pos -= w / 2;
      this[name].push(pos);
    }
    const size = allSize - maxSize;
    if (size > maxpos) offset = size - maxpos;
    offset = this.count % 2 === 0 ? offset / 2 : offset;
    this.translate[name] = params.collision.use ? offset / (this.count - this.mincount) : 0;
    this.translate[name] = this.count === 1 ? maxpos / 2 : this.translate[name];
  }

  setCount() {
    if (params.type === 'splitWord' || params.type === 'splitLetter') return textr.words.length;
    return this.getOrderRange(params.count.order, params.count.scope.min, params.count.scope.max, this.index);
  }
  setIndex(i, index) {
    if (params.type === 'splitWord' || params.type === 'splitLetter') return i;
    return this.updateIndex(this.index);
  }

  motion(index, data) {
    const nameval = params.layout === 'vertical' ? 'y' : 'x';
    const namearr = params.layout === 'vertical' ? 'x' : 'y';
    const cnvsize = params.layout === 'vertical' ? GH : GW;
    const centerIndex = Math.round(this.count - this.mincount) / 2;
    data.pos.yFreq = map(this[nameval], 0, cnvsize, -PI, PI) * data.pos.freq.y;
    data.pos.yFreqAdd = map(this[nameval], 0, cnvsize, -PI, PI) * data.pos.add.y;
    data.scale.yFreq = map(this[nameval], 0, cnvsize, -PI, PI) * data.scale.freq.y;
    data.scale.yFreqAdd = map(this[nameval], 0, cnvsize, -PI, PI) * data.scale.add.y;

    for (let i = 0; i < this.count; i++) {
      const posAmp = this.ampEase(i, centerIndex, params.pos.amp.mode, params.pos.amp.ease);
      const posFreq = this.freqFunction(i, centerIndex, data, data.pos);
      const scaleFreq = this.freqFunction(i, centerIndex, data, data.scale);
      this.scale[i] = params.scale.mode === 'none' ? 1 : map(scaleFreq + 0.5, 0, 1, data.scale.start, data.scale.end);
      this[namearr][i] += posFreq * posAmp * data.pos.amp;
    }
  }

  freqFunction(i, centerIndex, data, type) {
    let freq;
    const xFreq = map(i, 0, this.count - this.mincount, -PI, PI) * type.freq.x;
    const sinPhase = type.mirror ? (i < centerIndex ? xFreq : -xFreq) : xFreq;
    const centerOffset = i < centerIndex ? -PI * type.offset : PI * type.offset;
    const sinMirror = type.mirror ? (i < centerIndex ? 0 : PI * type.addedMirror) : 0;
    const addedOffset = TWO_PI * type.addedOffset;
    switch (type.mode) {
      case 'none': return 0;
      case 'sin':
        freq = sin(TWO_PI * data.frame * type.cycle + sinPhase + centerOffset + addedOffset + type.yFreq + sinMirror);
        break;
      case 'doublesin': {
        const phaseAdd = map(i, 0, this.count - this.mincount, -PI, PI) * type.add.x;
        let freqAdd = sin(TWO_PI * data.frame * type.add.cycle + phaseAdd + type.yFreqAdd);
        freqAdd = ez(type.add.ease, (freqAdd + 1) / 2) * 2 - 1;
        freq = sin(TWO_PI * data.frame * type.cycle + sinPhase + centerOffset + addedOffset + type.yFreq + centerOffset + freqAdd + sinMirror);
        break;
      }
      case 'noise':
        freq = type.simplex(
          type.speed * sin(TWO_PI * data.frame + PI) + xFreq,
          type.speed * cos(TWO_PI * data.frame) + xFreq,
          type.speed * sin(TWO_PI * data.frame - PI) + type.yFreq,
          type.speed * cos(TWO_PI * data.frame - HALF_PI) + type.yFreq,
        );
        break;
    }
    return ez(type.ease, (freq + 1) / 2) - 0.5;
  }

  ampEase(i, centerIndex, mode, ease) {
    switch (mode) {
      case 'uniform': return 1;
      case 'center': return ez(ease, i < centerIndex ? map(i, 0, centerIndex, 1, 0) : map(i, centerIndex, this.count - this.mincount, 0, 1));
      case 'edge': return ez(ease, i < centerIndex ? map(i, 0, centerIndex, 0, 1) : map(i, centerIndex, this.count - this.mincount, 1, 0));
      case 'side0': return ez(ease, map(i, 0, this.count - this.mincount, 0, 1));
      case 'side1': return ez(ease, map(i, 0, this.count - this.mincount, 1, 0));
    }
    return 1;
  }

  collision(index) {
    if (!params.collision.use) return;
    const name = params.layout === 'vertical' ? 'x' : 'y';
    const arr = this[name];
    const centerIndex = Math.round(arr.length / 2);
    for (let i = centerIndex - 1; i >= 0; i--) if (arr[i] > arr[i + 1] - this.pos[i]) arr[i] = arr[i + 1] - this.pos[i];
    for (let i = centerIndex + 1; i <= arr.length; i++) if (arr[i] < arr[i - 1] + this.pos[i - 1]) arr[i] = arr[i - 1] + this.pos[i - 1];
  }

  display(ctx) {
    ctx.save();
    ctx.translate(this.translate.x, this.translate.y);
    if (params.layout === 'vertical') {
      for (let i = 0; i < this.x.length; i++) this.stamp(ctx, this.x[i], this.y, i);
    } else {
      for (let i = 0; i < this.y.length; i++) this.stamp(ctx, this.x, this.y[i], i);
    }
    ctx.restore();
  }
  stamp(ctx, px, py, i) {
    ctx.save();
    ctx.translate(px, py);
    ctx.translate(this.size.width[i], this.size.height[i]);
    ctx.scale(this.scale[i], this.scale[i]);
    ctx.translate(-this.size.width[i], -this.size.height[i]);
    ctx.fillStyle = params.color;
    ctx.fill(this.text[i]);
    ctx.restore();
  }

  getOrderRange(order, lo, hi, index) {
    const seq = [];
    index += params.count.index - formData.countIndex;
    switch (order) {
      case 'none': return params.count.value;
      case 'random': {
        const n = nBase(0, index * 0.2);
        let num = map(n, -1, 1, lo, hi);
        return fract(num) < 0.5 ? floor(num) : ceil(num);
      }
      case 'forward':
        if (index < 0) for (let i = hi; i >= lo; i--) seq.push(i); else for (let i = lo; i <= hi; i++) seq.push(i);
        break;
      case 'backward':
        if (index < 0) for (let i = lo; i <= hi; i++) seq.push(i); else for (let i = hi; i >= lo; i--) seq.push(i);
        break;
      case 'backforth':
        for (let i = lo; i <= hi; i++) seq.push(i);
        for (let i = hi - 1; i > lo; i--) seq.push(i);
        break;
    }
    return seq[abs(index) % seq.length];
  }
}

/////////////////////////////////////////////////////////////////////////////
// Per-frame data + draw
/////////////////////////////////////////////////////////////////////////////
function buildFrameData() {
  const d = { frame: cnv.frame / cnv.maxFrames };
  d.scroll = cnv.animation ? map(params.size.font, params.size.min, params.size.max, params.scroll, params.scroll * 5) : 0;
  const p = params.pos, s = params.scale;
  d.pos = {
    mode: p.mode, ease: p.ease,
    amp: map(p.amp.value, 0, 100, 0, formData.cnvsize),
    speed: map(p.noise.speed, 0, 1, 0, 2),
    cycle: p.sin.cycle, simplex: nPos, mirror: p.phase.mirror, offset: p.phase.offset,
    addedOffset: 0, addedMirror: 1,
    freq: { x: p.mode === 'noise' ? p.noise.x : p.sin.x, y: p.mode === 'noise' ? p.noise.y : p.sin.y },
    add: { x: p.add.x, y: p.add.y, ease: p.add.ease, cycle: p.add.cycle },
  };
  const sm = s.mode === 'pos' ? d.pos.mode : s.mode;
  d.scale = {
    mode: sm, ease: s.mode === 'pos' ? d.pos.ease : s.ease,
    start: s.start, end: s.end,
    speed: s.mode === 'pos' ? d.pos.speed : map(s.noise.speed, 0, 1, 0, 2),
    cycle: s.mode === 'pos' ? d.pos.cycle : s.sin.cycle,
    simplex: nScale,
    mirror: s.mode === 'pos' ? d.pos.mirror : s.phase.mirror,
    offset: s.mode === 'pos' ? d.pos.offset : 0,
    addedOffset: s.phase.offset, addedMirror: s.phase.mirror ? 0 : 1,
    freq: {
      x: s.mode === 'pos' ? d.pos.freq.x : (s.mode === 'noise' ? s.noise.x : s.sin.x),
      y: s.mode === 'pos' ? d.pos.freq.y : (s.mode === 'noise' ? s.noise.y : s.sin.y),
    },
    add: {
      x: s.mode === 'pos' ? d.pos.add.x : s.add.x,
      y: s.mode === 'pos' ? d.pos.add.y : s.add.y,
      ease: s.mode === 'pos' ? d.pos.add.ease : s.add.ease,
      cycle: s.mode === 'pos' ? d.pos.add.cycle : s.add.cycle,
    },
  };
  return d;
}

function drawForms(ctx) {
  const d = buildFrameData();
  ctx.save();
  ctx.translate(formData.translate.x, formData.translate.y);
  for (let i = 0; i < formData.array.length; i++) {
    const f = formData.array[i];
    f.scroll(i, d);
    f.update(i, d);
    f.motion(i, d);
    f.collision(i);
    f.display(ctx);
  }
  ctx.restore();
  if (cnv.animation) cnv.frame = d.frame >= 1 ? 0 : cnv.frame + 1;
}

/////////////////////////////////////////////////////////////////////////////
// p5 sketch (fixed render-space canvas, CSS-fit to viewport — like the
// reference's fixed gForm scaled to the display).
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'TEXTR', version: '0.2' });
let P = null, displayCanvas = null, isReady = false, pendingPreset = null;

function applyRatio(p) {
  [GW, GH] = RATIOS[cnv.ratio];
  p.resizeCanvas(GW, GH);
  p.pixelDensity(2);
  fitCanvas();
  generateForms();
}
function fitCanvas() {
  if (!displayCanvas) return;
  const pad = 48;
  const k = min((window.innerWidth - pad * 2) / GW, (window.innerHeight - pad * 2) / GH);
  displayCanvas.elt.style.width = `${GW * k}px`;
  displayCanvas.elt.style.height = `${GH * k}px`;
}
function drawChecker(ctx) {
  const s = (GW + GH) / 100;
  for (let y = 0, j = 0; y < GH; y += s, j++) for (let x = 0, i = 0; x < GW; x += s, i++) { ctx.fillStyle = (i + j) % 2 ? '#ffffff' : '#dcdcdc'; ctx.fillRect(x, y, s + 1, s + 1); }
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
    p.frameRate(rec.frameRate);
    fitCanvas();
    loadFont(params.font).then((f) => { FONT = f; generateForms(); isReady = true; });
  };
  p.draw = () => {
    if (pendingPreset && FONT) { const n = pendingPreset; pendingPreset = null; applyPreset(n); }
    const ctx = displayCanvas.elt.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, displayCanvas.elt.width, displayCanvas.elt.height);
    ctx.restore();
    ctx.save();
    // p5 1.9.4 leaves a pixelDensity-scale transform on the 2D context between
    // frames — set the transform absolutely instead of compounding (which would
    // give us pd^2 and shove content off the bottom-right). Cf. SAMPL gotcha.
    const pd = p.pixelDensity();
    ctx.setTransform(pd, 0, 0, pd, 0, 0);
    if (cnv.bg.mode === 'fill') { ctx.fillStyle = cnv.bg.fill; ctx.fillRect(0, 0, GW, GH); }
    else drawChecker(ctx);
    if (FONT && formData.array) drawForms(ctx);
    ctx.restore();
  };
  p.windowResized = () => fitCanvas();
});

/////////////////////////////////////////////////////////////////////////////
// SVG export — reconstruct the current arrangement with Paper.js.
/////////////////////////////////////////////////////////////////////////////
function renderSVG() {
  const paper = window.paper;
  if (!paper || !FONT) { console.warn('Paper.js / font not ready — SVG export unavailable'); return ''; }
  const d = buildFrameData();
  const c = document.createElement('canvas'); c.width = GW; c.height = GH;
  paper.setup(c); paper.pixelRatio = 1;

  if (cnv.bg.mode === 'fill') {
    const bg = new paper.Shape.Rectangle(new paper.Rectangle(0, 0, GW, GH));
    bg.fillColor = cnv.bg.fill;
    new paper.Layer({ position: paper.view.center, children: [bg] });
  }
  const mask = new paper.Shape.Rectangle(new paper.Rectangle(0, 0, GW, GH));
  mask.translate(-formData.translate.x, -formData.translate.y);
  const layer = new paper.Layer({ position: new paper.Point(0, 0), applyMatrix: false });
  layer.translate(formData.translate.x, formData.translate.y);
  layer.addChildren([mask]);

  for (let x = 0; x < formData.array.length; x++) {
    const f = formData.array[x];
    f.scroll(x, d); f.update(x, d); f.motion(x, d); f.collision(x);
    const shapes = [];
    const place = (px, py, i) => {
      if (!f.svg[i]) return;
      const it = new paper.CompoundPath(f.svg[i]);
      it.translate(new paper.Point(f.translate.x, f.translate.y));
      it.translate(new paper.Point(px, py));
      it.translate(new paper.Point(f.size.width[i], f.size.height[i]));
      it.scale(f.scale[i]);
      it.translate(new paper.Point(-f.size.width[i], -f.size.height[i]));
      it.fillColor = params.color;
      shapes.push(it);
    };
    if (params.layout === 'vertical') for (let i = 0; i < f.x.length; i++) place(f.x[i], f.y, i);
    else for (let i = 0; i < f.y.length; i++) place(f.x, f.y[i], i);
    layer.addChildren(shapes);
  }
  layer.clipped = true;
  paper.view.draw();
  const svg = paper.project.exportSVG({ asString: true });
  paper.project.clear(); paper.view.remove();
  return svg;
}

/////////////////////////////////////////////////////////////////////////////
// Custom font drag-drop
/////////////////////////////////////////////////////////////////////////////
tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file || !/\.(ttf|otf|woff)$/i.test(file.name)) return;
  const reader = new FileReader();
  reader.onload = () => { try { FONT = parseFont(reader.result); generateForms(); } catch (err) { console.error('font parse failed', err); } };
  reader.readAsArrayBuffer(file);
});

/////////////////////////////////////////////////////////////////////////////
// UI — CANVAS / TEXT / COUNT / COLLISION folders + POSITION & SCALE motion tabs
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;

const fCanvas = main.addFolder({ title: 'CANVAS', expanded: false });
fCanvas.addBinding(cnv, 'ratio', { label: 'Canvas Ratio', options: RATIO_OPTS }).on('change', () => { if (P) applyRatio(P); });
const bgMode = fCanvas.addBinding(cnv.bg, 'mode', { label: 'Background', options: BG_OPTS }).on('change', () => bgUI());
const bgFill = fCanvas.addBinding(cnv.bg, 'fill', { label: 'BG Color', view: 'color' });
fCanvas.addBinding(params, 'color', { label: 'Text Color', view: 'color' });
fCanvas.addBinding(cnv, 'seed', { label: 'Noise Seed', min: 0, max: 1000, step: 1 }).on('change', () => { seedEvent(); });

const fText = main.addFolder({ title: 'TEXT' });
fText.addBinding(params, 'font', { label: 'Font', options: FONT_OPTIONS }).on('change', (ev) => { loadFont(ev.value).then((f) => { FONT = f; generateForms(); }); });
fText.addBinding(params, 'phrase', { label: 'Phrase' }).on('change', () => generateForms());
fText.addBinding(params, 'type', { label: 'Text Mode', options: TEXT_OPTS }).on('change', () => generateForms());
fText.addBinding(params, 'layout', { label: 'Direction', options: LAYOUT_OPTS }).on('change', () => generateForms());
fText.addBinding(params.size, 'font', { label: 'Font Size', min: params.size.min, max: params.size.max, step: 0.1 }).on('change', () => generateForms());
fText.addBinding(params, 'interval', { label: 'Letter Spacing', min: -20, max: 20, step: 0.1 }).on('change', () => generateForms());
fText.addBinding(params.items, 'value', { label: 'Rows', min: 1, max: 150, step: 1 }).on('change', () => generateForms());
fText.addBinding(params.margins, 'value', { label: 'Margins', min: 0, max: 1.25, step: 0.01 });
fText.addBinding(params, 'scroll', { label: 'Scroll', min: -5, max: 5, step: 0.1 });

const fCount = main.addFolder({ title: 'COUNT', expanded: false });
fCount.addBinding(params.count, 'order', { label: 'Order', options: ORDER_OPTS }).on('change', () => { countUI(); generateForms(); });
const countVal = fCount.addBinding(params.count, 'value', { label: 'Count', min: 1, max: 150, step: 1 });
const countMin = fCount.addBinding(params.count.scope, 'min', { label: 'Scope Min', min: 1, max: 60, step: 1 }).on('change', () => generateForms());
const countMax = fCount.addBinding(params.count.scope, 'max', { label: 'Scope Max', min: 1, max: 60, step: 1 }).on('change', () => generateForms());
fCount.addBinding(params.count, 'index', { label: 'Index Shift', min: -50, max: 50, step: 1 }).on('change', () => generateForms());

const fColl = main.addFolder({ title: 'COLLISION', expanded: false });
fColl.addBinding(params.collision, 'use', { label: 'Use Collision' });
fColl.addBinding(params.collision, 'offset', { label: 'Spacing', min: -10, max: 20, step: 0.1 }).on('change', () => generateForms());

const mtab = main.addTab({ pages: [{ title: 'POSITION' }, { title: 'SCALE' }] });
function buildMotionPage(page, key, isScale) {
  const ch = params[key];
  page.addBinding(ch, 'mode', { label: 'Motion', options: isScale ? SCALE_OPTS : MOTION_OPTS });
  page.addBinding(ch, 'ease', { label: 'Easing', options: EASE_OPTS });
  if (isScale) { page.addBinding(ch, 'start', { label: 'Scale Start', min: 0, max: 2, step: 0.01 }); page.addBinding(ch, 'end', { label: 'Scale End', min: 0, max: 2, step: 0.01 }); }
  else { page.addBinding(ch.amp, 'value', { label: 'Amplitude', min: 0, max: 100, step: 1 }); page.addBinding(ch.amp, 'mode', { label: 'Amp Easing', options: AMP_OPTS }); page.addBinding(ch.amp, 'ease', { label: 'Amp Ease', options: EASE_OPTS }); }
  page.addBinding(ch.sin, 'x', { label: 'Freq X', min: -10, max: 10, step: 0.01 });
  page.addBinding(ch.sin, 'y', { label: 'Freq Y', min: -10, max: 10, step: 0.01 });
  page.addBinding(ch.sin, 'cycle', { label: 'Cycles', min: -10, max: 10, step: 1 });
  page.addBinding(ch.noise, 'x', { label: 'Noise X', min: 0, max: 1, step: 0.01 });
  page.addBinding(ch.noise, 'y', { label: 'Noise Y', min: 0, max: 1, step: 0.01 });
  page.addBinding(ch.noise, 'speed', { label: 'Noise Speed', min: 0, max: 1, step: 0.01 });
  page.addBinding(ch.phase, 'mirror', { label: 'Mirror Phase' });
  page.addBinding(ch.phase, 'offset', { label: 'Phase Offset', min: -1, max: 1, step: 0.01 });
  page.addBinding(ch, 'seed', { label: 'Noise Seed', min: 0, max: 1000, step: 1 }).on('change', () => seedEvent());
}
buildMotionPage(mtab.pages[0], 'pos', false);
buildMotionPage(mtab.pages[1], 'scale', true);

function bgUI() { bgFill.hidden = cnv.bg.mode !== 'fill'; }
function countUI() { const none = params.count.order === 'none'; countVal.hidden = !none; countMin.hidden = none; countMax.hidden = none; }

/////////////////////////////////////////////////////////////////////////////
// Presets (original names; reference parameter taxonomy)
/////////////////////////////////////////////////////////////////////////////
const presets = {
  'Vertical Pulse': {
    cnv: { ratio: '1:1', bg: { mode: 'fill', fill: '#101010' }, seed: 471, frame: 0 },
    params: { font: 'Anton', phrase: 'PULSE', layout: 'vertical', type: 'repeatLetter', color: '#f5f5f5', scroll: 0, interval: 2, collision: { use: true, offset: 3 }, size: { font: 16 }, margins: { value: 0.9 }, items: { value: 28 }, count: { order: 'backforth', index: 0, value: 25, scope: { min: 3, max: 18 } }, pos: { mode: 'sin', ease: 'easeInOutSine', seed: 481, amp: { mode: 'uniform', ease: 'linear', value: 40 }, phase: { mirror: true, offset: 0 }, sin: { x: 2, y: 1.5, cycle: 2 }, add: { ease: 'linear', x: 0.5, y: 0.5, cycle: 0 }, noise: { x: 0.2, y: 0.5, speed: 0.5 } }, scale: { mode: 'none', ease: 'linear', seed: 629, start: 1, end: 1, phase: { mirror: false, offset: 0 }, sin: { x: 1, y: 1.5, cycle: 2 }, add: { ease: 'linear', x: 0.5, y: 0.5, cycle: 0 }, noise: { x: 0.2, y: 0.5, speed: 0.5 } } },
  },
  'Lateral Drift': {
    cnv: { ratio: '16:9', bg: { mode: 'fill', fill: '#ffffff' }, seed: 200, frame: 0 },
    params: { font: 'Space Mono', phrase: 'DRIFTING SIDEWAYS', layout: 'horizontal', type: 'repeatLetter', color: '#1a1a1a', scroll: 0.4, interval: 6, collision: { use: false, offset: 2 }, size: { font: 12 }, margins: { value: 0.6 }, items: { value: 36 }, count: { order: 'none', index: 0, value: 7, scope: { min: 2, max: 16 } }, pos: { mode: 'sin', ease: 'easeInOutCubic', seed: 100, amp: { mode: 'center', ease: 'easeOutSine', value: 30 }, phase: { mirror: true, offset: 0 }, sin: { x: 4, y: 1.2, cycle: 3 }, add: { ease: 'linear', x: 0.5, y: 0.5, cycle: 0 }, noise: { x: 0.2, y: 0.5, speed: 0.5 } }, scale: { mode: 'none', ease: 'linear', seed: 7, start: 0.6, end: 1, phase: { mirror: false, offset: 0 }, sin: { x: 1, y: 1, cycle: 2 }, add: { ease: 'linear', x: 0.5, y: 0.5, cycle: 0 }, noise: { x: 0.2, y: 0.5, speed: 0.5 } } },
  },
  'Noise Bloom': {
    cnv: { ratio: '1:1', bg: { mode: 'fill', fill: '#8624f5' }, seed: 386, frame: 0 },
    params: { font: 'Archivo Black', phrase: 'NOISE', layout: 'horizontal', type: 'repeatLetter', color: '#ff8200', scroll: 0, interval: -8, collision: { use: true, offset: 0 }, size: { font: 26 }, margins: { value: 0.2 }, items: { value: 26 }, count: { order: 'none', index: -10, value: 20, scope: { min: 2, max: 40 } }, pos: { mode: 'none', ease: 'easeInOutCubic', seed: 248, amp: { mode: 'edge', ease: 'linear', value: 30 }, phase: { mirror: true, offset: 0 }, sin: { x: -1.5, y: 1.6, cycle: 3 }, add: { ease: 'easeInExpo', x: -0.3, y: 0.3, cycle: -3 }, noise: { x: 0.2, y: 0.5, speed: 0.5 } }, scale: { mode: 'noise', ease: 'easeInOutQuad', seed: 184, start: 0.85, end: 0.2, phase: { mirror: false, offset: 0 }, sin: { x: 0.46, y: 1.54, cycle: -5 }, add: { ease: 'easeInCubic', x: 1, y: 0.5, cycle: 7 }, noise: { x: 0.2, y: 0.2, speed: 1 } } },
  },
  'Diamond Wave': {
    cnv: { ratio: '4:5', bg: { mode: 'fill', fill: '#04130f' }, seed: 88, frame: 0 },
    params: { font: 'Space Mono', phrase: 'FLOW STATE', layout: 'vertical', type: 'repeatWord', color: '#3fe0a6', scroll: 0, interval: 5, collision: { use: true, offset: 4 }, size: { font: 9 }, margins: { value: 0.95 }, items: { value: 34 }, count: { order: 'backforth', index: 0, value: 25, scope: { min: 2, max: 20 } }, pos: { mode: 'doublesin', ease: 'easeInOutSine', seed: 12, amp: { mode: 'uniform', ease: 'linear', value: 35 }, phase: { mirror: false, offset: 0.2 }, sin: { x: 3, y: 1.4, cycle: 2 }, add: { ease: 'easeInOutQuad', x: 0.4, y: 0.5, cycle: 3 }, noise: { x: 0.2, y: 0.5, speed: 0.5 } }, scale: { mode: 'sin', ease: 'linear', seed: 7, start: 0.5, end: 1.2, phase: { mirror: false, offset: 0 }, sin: { x: 2, y: 1, cycle: 2 }, add: { ease: 'linear', x: 0.5, y: 0.5, cycle: 0 }, noise: { x: 0.2, y: 0.5, speed: 0.5 } } },
  },
  'Ticker Tape': {
    cnv: { ratio: '2:1', bg: { mode: 'fill', fill: '#111111' }, seed: 5, frame: 0 },
    params: { font: 'Major Mono', phrase: 'transmission', layout: 'horizontal', type: 'splitLetter', color: '#ffba08', scroll: 0.6, interval: 4, collision: { use: false, offset: 2 }, size: { font: 22 }, margins: { value: 0.5 }, items: { value: 8 }, count: { order: 'none', index: 0, value: 1, scope: { min: 2, max: 16 } }, pos: { mode: 'sin', ease: 'linear', seed: 3, amp: { mode: 'side0', ease: 'easeInOutCubic', value: 18 }, phase: { mirror: false, offset: 0 }, sin: { x: 1.5, y: 1, cycle: 2 }, add: { ease: 'linear', x: 0.5, y: 0.5, cycle: 0 }, noise: { x: 0.2, y: 0.5, speed: 0.5 } }, scale: { mode: 'none', ease: 'linear', seed: 7, start: 1, end: 1, phase: { mirror: false, offset: 0 }, sin: { x: 1, y: 1, cycle: 2 }, add: { ease: 'linear', x: 0.5, y: 0.5, cycle: 0 }, noise: { x: 0.2, y: 0.5, speed: 0.5 } } },
  },
  'Mirror Column': {
    cnv: { ratio: '9:16', bg: { mode: 'fill', fill: '#1a0b2e' }, seed: 333, frame: 0 },
    params: { font: 'Bungee', phrase: 'ECHO', layout: 'vertical', type: 'repeatLetter', color: '#e0aaff', scroll: 0, interval: 0, collision: { use: true, offset: 2 }, size: { font: 14 }, margins: { value: 0.85 }, items: { value: 40 }, count: { order: 'forward', index: 0, value: 25, scope: { min: 1, max: 14 } }, pos: { mode: 'sin', ease: 'easeInOutQuad', seed: 21, amp: { mode: 'uniform', ease: 'linear', value: 45 }, phase: { mirror: true, offset: 0 }, sin: { x: 2.5, y: 2, cycle: 2 }, add: { ease: 'linear', x: 0.5, y: 0.5, cycle: 0 }, noise: { x: 0.2, y: 0.5, speed: 0.5 } }, scale: { mode: 'none', ease: 'linear', seed: 7, start: 1, end: 1, phase: { mirror: false, offset: 0 }, sin: { x: 1, y: 1, cycle: 2 }, add: { ease: 'linear', x: 0.5, y: 0.5, cycle: 0 }, noise: { x: 0.2, y: 0.5, speed: 0.5 } } },
  },
};

function deepMerge(dst, src) {
  for (const k of Object.keys(src)) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) { dst[k] = dst[k] || {}; deepMerge(dst[k], src[k]); }
    else dst[k] = src[k];
  }
}
function resetToDefaults() { deepMerge(cnv, structuredClone(DEFAULTS.cnv)); deepMerge(params, structuredClone(DEFAULTS.params)); }
function applyPreset(name) {
  const pr = typeof name === 'string' ? presets[name] : name;
  if (!pr) return;
  resetToDefaults();
  if (pr.cnv) deepMerge(cnv, pr.cnv);
  if (pr.params) deepMerge(params, pr.params);
  cnv.frame = pr.cnv?.frame ?? 0;
  const finish = () => { if (P) applyRatio(P); else generateForms(); seedEvent(); bgUI(); countUI(); tool.pane.refresh(); };
  loadFont(params.font).then((f) => { FONT = f; finish(); }).catch(() => finish());
}

/////////////////////////////////////////////////////////////////////////////
// Export + OPTIONS
/////////////////////////////////////////////////////////////////////////////
attachExport(tool.pages.export, { getCanvas: tool.getCanvas, getSVG: renderSVG, name: 'textr' });

const presetState = { name: 'Vertical Pulse' };
const opts = tool.pages.options;
opts.addBinding(presetState, 'name', { label: 'Preset', options: Object.fromEntries(Object.keys(presets).map((k) => [k, k])) }).on('change', (ev) => applyPreset(ev.value));
opts.addButton({ title: 'Apply / Restart Preset' }).on('click', () => applyPreset(presetState.name));
opts.addBinding(cnv, 'animation', { label: 'Animate' }).on('change', () => { cnv.frame = 0; });
opts.addButton({ title: 'Fullscreen (f)' }).on('click', () => tool.toggleFullscreen());

window.addEventListener('resize', fitCanvas);
// Dev hook — drive presets / inspect state / feed in external preset objects.
exposeDebug('textr', { applyPreset, generateForms, renderSVG, cnv, params, textr, presets, setFrame: (f) => { cnv.frame = f; } });

bgUI(); countUI();
pendingPreset = 'Vertical Pulse';
