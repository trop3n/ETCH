// DRIFT — drag fragments of an image and let them drift. You sample a
// rectangular/elliptical window of a source image and spawn a "Form"; each form
// captures that fragment and animates it through eight channels — move (x/y),
// offset (x/y), rotate, scale, opacity, tint — each driven by none/const/sin/
// cos/noise with its own level, rate and trend. Forms composite onto a
// persistent buffer, so motion leaves drifting trails over the base image.
// Sample with the mouse (drag to set, release to spawn; wheel resizes the
// window), or spawn random ones. p5 2D; drop an image to load your own.
//
// The default image is generated procedurally, so the tool ships with no
// bundled photo.
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachExport } from '../../js/etch/export.js';
import { createNoise2D } from '../../js/vendor/simplex/simplex-noise.js';
import { alea } from '../../js/etch/noise.js';

const { sin, cos, abs, min, max, round, floor, PI } = Math;
const TWO_PI = PI * 2;
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const radians = (deg) => (deg * PI) / 180;
const newNoise = () => createNoise2D(alea((Math.random() * 1e9) | 0));

/////////////////////////////////////////////////////////////////////////////
// State — one nested object tree, so preset objects deep-merge cleanly.
/////////////////////////////////////////////////////////////////////////////
const cnv = {
  show: true,
  bg: { mode: 'custom', custom: '#000000' },
  image: { size: 1280, x: 0, y: 0, preview: false },
  settings: { sens: 1.75 },
};
const form = {
  type: 'rect',
  rendering: 'canvas',
  content: 'preview',
  run: true,
  array: [],
  startup: 10,
  amount: { num: 18, min: 1, max: 100 },
  size: { x: 120, y: 120, min: 12, max: { width: 1280, height: 1280 } },
  frame: { value: 'off', width: 2, color: '#FFFFFF88' },
  mouse: { x: 0, y: 0 },
  coords: { x: 0, y: 0 },
};
const ui = {
  trend: { types: ['pos', 'neg', 'random', 'toggle'], toggle: ['pos', 'neg'] },
  move: { types: ['none', 'const', 'sin', 'cos', 'noise'], level: { min: 1, max: 200, step: 1 }, rate: { min: 1, max: 10, step: 0.1 } },
  offset: { types: ['none', 'sin', 'cos', 'noise'], level: { min: 1, max: 25, step: 0.5 }, rate: { min: 1, max: 10, step: 0.1 } },
  rotate: { types: ['none', 'const', 'sin', 'cos', 'noise'], level: { min: 5, max: 180, step: 5 }, rate: { min: 1, max: 10, step: 0.1 } },
  scale: { types: ['none', 'sin', 'cos', 'noise'], level: { min: 1.1, max: 2, step: 0.01 }, rate: { min: 1, max: 10, step: 0.1 } },
  opacity: { types: ['none', 'const', 'sin', 'cos', 'noise'], level: { min: 10, max: 100, step: 1 }, rate: { min: 1, max: 10, step: 0.1 } },
  tint: { types: ['none', 'const', 'sin', 'cos', 'noise'], level: { min: 1, max: 100, step: 1 }, rate: { min: 1, max: 10, step: 0.1 } },
};
const anim = {
  move: {
    x: { type: 'sin', level: 100, rate: 2, trend: { type: 'random', toggle: 'pos' } },
    y: { type: 'noise', level: 100, rate: 2.5, trend: { type: 'random', toggle: 'pos' } },
  },
  offset: {
    x: { type: 'noise', level: 5, rate: 1.5, trend: { type: 'random', toggle: 'pos' } },
    y: { type: 'noise', level: 5, rate: 2, trend: { type: 'random', toggle: 'pos' } },
  },
  rotate: { type: 'none', level: 45, rate: 2, trend: { type: 'random', toggle: 'pos' } },
  scale: { type: 'sin', level: 1.2, rate: 1.5, trend: { type: 'random', toggle: 'pos' } },
  opacity: { type: 'none', level: 75, rate: 3 },
  tint: { type: 'none', level: 25, color: '#FFFFFF', rate: 4 },
};
// Re-map tables: map UI ranges → engine magnitudes.
const mapping = {
  move: { level: { min: 0.01, max: 1 }, rate: { const: { min: 0.4, max: 12 }, noise: { min: 0.01, max: 0.25 }, geom: { min: 1, max: 10 } } },
  offset: { level: { min: 0.01, max: 0.25 }, rate: { noise: { min: 0.01, max: 0.15 }, geom: { min: 1, max: 10 } } },
  rotate: { rate: { noise: { min: 0.01, max: 0.5 }, geom: { min: 0.25, max: 5 } } },
  scale: { level: { min: 0.1, max: 1 }, rate: { noise: { min: 0.002, max: 0.05 }, geom: { min: 0.005, max: 0.05 } } },
  opacity: { level: { min: 25, max: 255 }, rate: { noise: { min: 0.001, max: 0.01 }, geom: { min: 0.002, max: 0.02 } } },
  tint: { level: { min: 5, max: 255 }, rate: { noise: { min: 0.001, max: 0.01 }, geom: { min: 0.002, max: 0.02 } } },
};
const rec = { frameRate: 60, length: { value: 5, min: 1, max: 60 } };
const DEFAULTS = structuredClone({ cnv, form, anim });

const TYPE_OPTS = { Rectangle: 'rect', Ellipse: 'ellipse' };
const CONTENT_OPTS = { Static: 'preview', Live: 'live' };
const RENDER_OPTS = { Canvas: 'canvas', Layer: 'layer' };
const FRAME_OPTS = { Off: 'off', On: 'on' };
const BG_OPTS = { Custom: 'custom', Transparent: 'transparent' };
const moveTypeOpts = Object.fromEntries(ui.move.types.map((t) => [t[0].toUpperCase() + t.slice(1), t]));
const offsetTypeOpts = Object.fromEntries(ui.offset.types.map((t) => [t[0].toUpperCase() + t.slice(1), t]));
const trendOpts = { Positive: 'pos', Negative: 'neg', Random: 'random', Toggle: 'toggle' };

/////////////////////////////////////////////////////////////////////////////
// Runtime
/////////////////////////////////////////////////////////////////////////////
let P = null, displayCanvas = null, pendingPreset = null;
let img = null, gForm = null, alphaImg = null;
let GW = 1280, GH = 960;
let mx = 0, my = 0, overCanvas = false, pressed = false;

function hexToRgb(h) { return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) }; }
function rgbaToHex({ r, g, b, a = 1 }) {
  const c = (v) => max(0, min(255, round(v))).toString(16).padStart(2, '0');
  const al = round(a * 255);
  return `#${c(r)}${c(g)}${c(b)}${al < 255 ? c(al) : ''}`;
}

/////////////////////////////////////////////////////////////////////////////
// Trend helper
/////////////////////////////////////////////////////////////////////////////
function getTrend(ch) {
  const t = ch.trend ? ch.trend.type : 'random';
  if (t === 'pos') return 1;
  if (t === 'neg') return -1;
  if (t === 'random') return Math.random() < 0.5 ? -1 : 1;
  // toggle: alternate each time a form is built
  const toggle = ch.trend.toggle || 'pos';
  if (toggle === ui.trend.toggle[0]) { ch.trend.toggle = ui.trend.toggle[1]; return -1; }
  ch.trend.toggle = ui.trend.toggle[0]; return 1;
}

/////////////////////////////////////////////////////////////////////////////
// Form — one drifting image fragment
/////////////////////////////////////////////////////////////////////////////
class Form {
  constructor(isRandom) {
    let xTrans = round(form.mouse.x), yTrans = round(form.mouse.y);
    const xSize = form.size.x, ySize = form.size.y;

    if (isRandom) {
      xTrans = round(P.random(xSize / 3, img.width - xSize / 3));
      yTrans = round(P.random(ySize / 3, img.height - ySize / 3));
    }

    this.graphics = P.createGraphics(img.width, img.height);
    this.graphics.pixelDensity(1); this.graphics.imageMode(P.CENTER); this.graphics.rectMode(P.CENTER); this.graphics.noStroke();
    this.updBuffer = P.createGraphics(xSize, ySize);
    this.updBuffer.pixelDensity(1); this.updBuffer.ellipseMode(P.CORNER); this.updBuffer.noStroke();
    this.buffer = P.createGraphics(xSize, ySize);
    this.buffer.pixelDensity(1); this.buffer.ellipseMode(P.CORNER); this.buffer.noStroke();

    this.mask = form.type;
    this.content = form.content;
    this.translate = { x: xTrans, y: yTrans };
    this.coords = isRandom
      ? { x: round(xTrans - xSize / 2), y: round(yTrans - ySize / 2) }
      : { x: this.content === 'preview' ? round(cnv.image.x) : form.coords.x, y: this.content === 'preview' ? round(cnv.image.y) : form.coords.y };
    this.size = { x: xSize, y: ySize };
    this.frame = { value: form.frame.value, color: form.frame.color };
    this.factor = { width: img.width / 2500, height: img.height / 2500 };

    const M = mapping;
    const mk = (a, axis, dim) => ({
      type: a.type, simplex: newNoise(), frame: 0,
      const: { rate: map(a.rate, ui.move.rate.min, ui.move.rate.max, M.move.rate.const.min, M.move.rate.const.max) * this.factor[dim] },
      noise: {
        level: map(a.level, ui.move.level.min, ui.move.level.max, img[axis] * M.move.level.min, img[axis] * M.move.level.max),
        rate: map(a.rate, ui.move.rate.min, ui.move.rate.max, M.move.rate.noise.min, M.move.rate.noise.max),
        factor: a.level,
      },
      geom: {
        level: a.level * (img[axis] / 100) * 0.5,
        rate: map(a.level, ui.move.level.min, ui.move.level.max, a.rate * 0.08, a.rate * 0.9),
        trend: getTrend(a),
      },
    });
    this.move = { x: mk(anim.move.x, 'width', 'width'), y: mk(anim.move.y, 'height', 'height') };

    const mkOff = (a, axis) => ({
      type: a.type, simplex: newNoise(), frame: 0,
      noise: {
        level: map(a.level, ui.offset.level.min, ui.offset.level.max, img[axis] * M.offset.level.min, img[axis] * M.offset.level.max),
        rate: map(a.rate, ui.offset.rate.min, ui.offset.rate.max, M.offset.rate.noise.min, M.offset.rate.noise.max),
        factor: a.level,
      },
      geom: {
        level: a.level * (img[axis] / 100) * 0.5,
        rate: map(a.level, ui.move.level.min, ui.move.level.max, a.rate * 0.08, a.rate * 0.9),
        trend: getTrend(a),
      },
    });
    this.offset = { x: mkOff(anim.offset.x, 'width'), y: mkOff(anim.offset.y, 'height') };

    this.rotate = {
      type: anim.rotate.type, simplex: newNoise(), frame: 0,
      noise: { level: anim.rotate.level, rate: map(anim.rotate.rate, ui.rotate.rate.min, ui.rotate.rate.max, M.rotate.rate.noise.min, M.rotate.rate.noise.max) },
      geom: { level: anim.rotate.level, rate: map(anim.rotate.rate, ui.rotate.rate.min, ui.rotate.rate.max, M.rotate.rate.geom.min, M.rotate.rate.geom.max), trend: getTrend(anim.rotate) },
    };
    this.scale = {
      type: anim.scale.type, simplex: newNoise(), frame: 0,
      noise: { level: anim.scale.level - 1, rate: map(anim.scale.rate, ui.scale.rate.min, ui.scale.rate.max, M.scale.rate.noise.min, M.scale.rate.noise.max), factor: map(anim.scale.level - 1, M.scale.level.min, M.scale.level.max, 1, 10) },
      geom: { level: anim.scale.level - 1, rate: map(anim.scale.rate, ui.scale.rate.min, ui.scale.rate.max, M.scale.rate.geom.min, M.scale.rate.geom.max), trend: getTrend(anim.scale) },
    };
    this.opacity = {
      type: anim.opacity.type, simplex: newNoise(), frame: 0,
      level: map(anim.opacity.level, ui.opacity.level.min, ui.opacity.level.max, M.opacity.level.min, M.opacity.level.max),
      noise: { rate: map(anim.opacity.rate, ui.opacity.rate.min, ui.opacity.rate.max, M.opacity.rate.noise.min, M.opacity.rate.noise.max) },
      geom: { rate: map(anim.opacity.rate, ui.opacity.rate.min, ui.opacity.rate.max, M.opacity.rate.geom.min, M.opacity.rate.geom.max) },
    };
    this.tint = {
      type: anim.tint.type, simplex: newNoise(), frame: 0, color: P.color(anim.tint.color),
      level: map(anim.tint.level, ui.tint.level.min, ui.tint.level.max, M.tint.level.min, M.tint.level.max),
      noise: { rate: map(anim.tint.rate, ui.tint.rate.min, ui.tint.rate.max, M.tint.rate.noise.min, M.tint.rate.noise.max) },
      geom: { rate: map(anim.tint.rate, ui.tint.rate.min, ui.tint.rate.max, M.tint.rate.geom.min, M.tint.rate.geom.max) },
    };
  }

  dispose() { this.graphics.remove(); this.updBuffer.remove(); this.buffer.remove(); }

  run() {
    if (form.rendering === 'canvas') this.graphics.clear();
    let _moveX, _moveY, _rotate, _scale, _offsetX, _offsetY, _opacity, _tint;

    // move x
    const mx_ = this.move.x;
    switch (mx_.type) {
      case 'none': _moveX = 0; break;
      case 'const': _moveX = mx_.frame * mx_.geom.trend; mx_.frame += mx_.const.rate; break;
      case 'noise': { const nv = mx_.noise.rate / mx_.noise.factor; _moveX = mx_.simplex(mx_.frame * nv, 0) * mx_.noise.level; mx_.frame++; break; }
      case 'sin': { const sv = max(1, round(mx_.geom.level / (mx_.geom.rate * this.factor.width))); const sf = mx_.frame / sv; _moveX = map(sin(TWO_PI * sf), 1, -1, mx_.geom.level, -mx_.geom.level) * mx_.geom.trend; sf === 1 ? (mx_.frame = 1) : mx_.frame++; break; }
      case 'cos': { const cv = max(1, round(mx_.geom.level / (mx_.geom.rate * this.factor.width))); const cf = mx_.frame / cv; _moveX = map(1 - cos(TWO_PI * cf), 1, -1, mx_.geom.level, -mx_.geom.level) * mx_.geom.trend; cf === 1 ? (mx_.frame = 1) : mx_.frame++; break; }
    }
    // move y
    const my_ = this.move.y;
    switch (my_.type) {
      case 'none': _moveY = 0; break;
      case 'const': _moveY = my_.frame * my_.geom.trend; my_.frame += my_.const.rate; break;
      case 'noise': { const nv = my_.noise.rate / my_.noise.factor; _moveY = my_.simplex(my_.frame * nv, 0) * my_.noise.level; my_.frame++; break; }
      case 'sin': { const sv = max(1, round(my_.geom.level / (my_.geom.rate * this.factor.height))); const sf = my_.frame / sv; _moveY = map(sin(TWO_PI * sf), 1, -1, my_.geom.level, -my_.geom.level) * my_.geom.trend; sf === 1 ? (my_.frame = 1) : my_.frame++; break; }
      case 'cos': { const cv = max(1, round(my_.geom.level / (my_.geom.rate * this.factor.height))); const cf = my_.frame / cv; _moveY = map(1 - cos(TWO_PI * cf), 1, -1, my_.geom.level, -my_.geom.level) * my_.geom.trend; cf === 1 ? (my_.frame = 1) : my_.frame++; break; }
    }
    // offset x
    const ox = this.offset.x;
    switch (ox.type) {
      case 'none': _offsetX = 0; break;
      case 'noise': { const nv = ox.noise.rate / ox.noise.factor; _offsetX = ox.simplex(ox.frame * nv, 0) * ox.noise.level; ox.frame++; break; }
      case 'sin': { const sv = max(1, round(ox.geom.level / (ox.geom.rate * this.factor.width))); const sf = ox.frame / sv; _offsetX = map(sin(TWO_PI * sf), 1, -1, ox.geom.level, -ox.geom.level) * ox.geom.trend; sf === 1 ? (ox.frame = 0) : ox.frame++; break; }
      case 'cos': { const cv = max(1, round(ox.geom.level / (ox.geom.rate * this.factor.width))); const cf = ox.frame / cv; _offsetX = map(1 - cos(TWO_PI * cf), 1, -1, ox.geom.level, -ox.geom.level) * ox.geom.trend; cf === 1 ? (ox.frame = 0) : ox.frame++; break; }
    }
    // offset y
    const oy = this.offset.y;
    switch (oy.type) {
      case 'none': _offsetY = 0; break;
      case 'noise': { const nv = oy.noise.rate / oy.noise.factor; _offsetY = oy.simplex(oy.frame * nv, 0) * oy.noise.level; oy.frame++; break; }
      case 'sin': { const sv = max(1, round(oy.geom.level / (oy.geom.rate * this.factor.height))); const sf = oy.frame / sv; _offsetY = map(sin(TWO_PI * sf), 1, -1, oy.geom.level, -oy.geom.level) * oy.geom.trend; sf === 1 ? (oy.frame = 0) : oy.frame++; break; }
      case 'cos': { const cv = max(1, round(oy.geom.level / (oy.geom.rate * this.factor.height))); const cf = oy.frame / cv; _offsetY = map(1 - cos(TWO_PI * cf), 1, -1, oy.geom.level, -oy.geom.level) * oy.geom.trend; cf === 1 ? (oy.frame = 0) : oy.frame++; break; }
    }
    // rotate
    const r = this.rotate;
    switch (r.type) {
      case 'none': _rotate = 0; break;
      case 'const': _rotate = r.frame * r.geom.trend; r.frame += r.geom.rate; break;
      case 'noise': { const nv = r.noise.rate / r.noise.level; _rotate = r.simplex(r.frame * nv, 0) * r.noise.level; r.frame++; break; }
      case 'sin': { const sv = r.geom.rate / r.geom.level; _rotate = sin(r.frame * sv) * r.geom.level * r.geom.trend; r.frame++; break; }
      case 'cos': { const cv = r.geom.rate / r.geom.level; _rotate = (1 - cos(r.frame * cv)) * r.geom.level * r.geom.trend; r.frame++; break; }
    }
    // scale
    const sc = this.scale;
    switch (sc.type) {
      case 'none': _scale = 1; break;
      case 'noise': { const nv = sc.noise.rate / sc.noise.factor; _scale = 1 + sc.simplex(sc.frame * nv, 0) * sc.noise.level; sc.frame++; break; }
      case 'sin': _scale = 1 + sin(sc.frame * sc.geom.rate) * sc.geom.level * sc.geom.trend; sc.frame++; break;
      case 'cos': { let v = (1 - cos(sc.frame * sc.geom.rate)) * sc.geom.level * sc.geom.trend; _scale = 1 + v - v / 2; sc.frame++; break; }
    }
    // opacity
    const op = this.opacity;
    switch (op.type) {
      case 'none': _opacity = 255; break;
      case 'const': _opacity = 255 - op.level; break;
      case 'noise': _opacity = 255 - abs(op.simplex(op.frame * op.noise.rate, 0)) * op.level; op.frame++; break;
      case 'sin': _opacity = 255 - abs(sin(op.frame * op.geom.rate)) * op.level; op.frame++; break;
      case 'cos': _opacity = 255 - abs(cos(op.frame * op.geom.rate)) * op.level; op.frame++; break;
    }
    // tint
    const tn = this.tint;
    switch (tn.type) {
      case 'none': _tint = 0; break;
      case 'const': _tint = tn.level; break;
      case 'noise': _tint = abs(tn.simplex(tn.frame * tn.noise.rate, 0)) * tn.level; tn.frame++; break;
      case 'sin': _tint = abs(cos(tn.frame * tn.geom.rate)) * tn.level; tn.frame++; break;
      case 'cos': _tint = abs(sin(tn.frame * tn.geom.rate)) * tn.level; tn.frame++; break;
    }

    let bufferX, bufferY;
    if (this.content === 'live') {
      const mbx = ((this.translate.x + _moveX) % (img.width + this.size.x / 2)) - this.size.x / 2;
      const mby = ((this.translate.y + _moveY) % (img.height + this.size.y / 2)) - this.size.y / 2;
      bufferX = mbx - _offsetX; bufferY = mby - _offsetY;
    } else {
      bufferX = this.coords.x - _offsetX; bufferY = this.coords.y - _offsetY;
    }

    this.edges(this.size.x * _scale, this.size.y * _scale, _moveX, _moveY, _rotate);
    this.buffer.image(img, 0, 0, this.size.x, this.size.y, bufferX, bufferY, this.size.x, this.size.y);

    this.updBuffer.push();
    this.updBuffer.image(this.buffer, 0, 0, this.size.x, this.size.y);
    this.tint.color.setAlpha(_tint);
    this.updBuffer.fill(this.tint.color);
    this.updBuffer.rect(0, 0, this.size.x, this.size.y);
    if (this.mask === 'ellipse') {
      this.updBuffer.drawingContext.globalCompositeOperation = 'destination-in';
      this.updBuffer.fill(0);
      this.updBuffer.ellipse(0, 0, this.size.x, this.size.y);
    }
    this.updBuffer.pop();

    this.graphics.push();
    this.graphics.translate(this.translate.x, this.translate.y);
    this.graphics.translate(_moveX, _moveY);
    this.graphics.rotate(radians(_rotate));
    this.graphics.tint(255, _opacity);
    this.graphics.image(this.updBuffer, 0, 0, this.size.x * _scale, this.size.y * _scale);
    if (this.frame.value === 'on') {
      this.graphics.noFill();
      this.graphics.stroke(form.frame.color);
      this.graphics.strokeWeight(form.frame.width);
      this.mask === 'rect'
        ? this.graphics.rect(0, 0, this.size.x * _scale, this.size.y * _scale)
        : this.graphics.ellipse(0, 0, this.size.x * _scale, this.size.y * _scale);
    }
    this.graphics.pop();
  }

  edges(xSize, ySize, x, y, theta) {
    const cx = this.translate.x + x, cy = this.translate.y + y;
    const pts = [];
    const pt = (px, py) => ({ x: cx + px * cos(radians(theta)) - py * sin(radians(theta)), y: cy + px * sin(radians(theta)) + py * cos(radians(theta)) });
    if (this.mask === 'ellipse') {
      for (let i = 0; i < 360; i += 15) pts.push(pt(cos(radians(i)) * (xSize / 2), sin(radians(i)) * (ySize / 2)));
    } else {
      pts.push(pt(-xSize / 2, ySize / 2)); pts.push(pt(xSize / 2, ySize / 2)); pts.push(pt(-xSize / 2, -ySize / 2)); pts.push(pt(xSize / 2, -ySize / 2));
    }
    let xmin = 0, xmax = 0, ymin = 0, ymax = 0, xLen = 0, yLen = 0;
    for (const p of pts) { if (p.x < 0) xmin++; if (p.x > img.width) xmax++; if (p.y < 0) ymin++; if (p.y > img.height) ymax++; }
    if (xmin === pts.length || xmax === pts.length) for (const p of pts) { const n = abs(cx - p.x); if (xLen < n) xLen = n; }
    if (ymin === pts.length || ymax === pts.length) for (const p of pts) { const n = abs(cy - p.y); if (yLen < n) yLen = n; }
    if (xmin === pts.length) this.translate.x += img.width + xLen * 2;
    else if (xmax === pts.length) this.translate.x -= img.width + xLen * 2;
    if (ymin === pts.length) this.translate.y += img.height + yLen * 2;
    else if (ymax === pts.length) this.translate.y -= img.height + yLen * 2;
  }
}

/////////////////////////////////////////////////////////////////////////////
// Form lifecycle
/////////////////////////////////////////////////////////////////////////////
function spawnForm(isRandom) {
  if (form.array.length > form.amount.num - 1) { form.array[0].dispose(); form.array.splice(0, 1); }
  form.array.push(new Form(isRandom));
}
function clearAllForms() { for (const f of form.array) f.dispose(); form.array = []; if (gForm) gForm.clear(); }
function removeLastForm() { const f = form.array.pop(); if (f) f.dispose(); }
function shuffleAllForms() { if (P) P.shuffle(form.array, true); }
function addRandomFormsOnStartup() { for (let i = 0; i < form.startup; i++) spawnForm(true); }
function checkFormsAmount() { while (form.array.length > form.amount.num) { form.array[form.array.length - 1].dispose(); form.array.pop(); } }

/////////////////////////////////////////////////////////////////////////////
// Default image — generated procedurally, so nothing is bundled
/////////////////////////////////////////////////////////////////////////////
function makeDefaultImage() {
  const w = 1280, h = 960;
  const g = P.createGraphics(w, h); g.pixelDensity(1); g.noStroke();
  const n = createNoise2D(alea(1337));
  // warm→cool diagonal wash
  for (let y = 0; y < h; y++) {
    const t = y / h;
    g.fill(map(t, 0, 1, 240, 30), map(t, 0, 1, 90, 60), map(t, 0, 1, 40, 150));
    g.rect(0, y, w, 1);
  }
  // organic colour blobs from noise
  for (let i = 0; i < 90; i++) {
    const x = P.random(w), y = P.random(h);
    const hue = (n(x * 0.002, y * 0.002) * 0.5 + 0.5) * 360;
    const r = P.random(40, 200);
    g.push(); g.colorMode(P.HSB, 360, 100, 100, 1);
    g.fill(hue, P.random(45, 90), P.random(55, 100), 0.5);
    g.ellipse(x, y, r, r * P.random(0.5, 1.5)); g.pop();
  }
  // bright accent stripes
  g.push(); g.colorMode(P.HSB, 360, 100, 100, 1);
  for (let i = 0; i < 24; i++) { g.fill((i * 37) % 360, 80, 95, 0.18); const x = P.random(w); g.rect(x, 0, P.random(6, 40), h); }
  g.pop();
  const im = g.get(); g.remove();
  return im;
}

function adjustImageSize(image, maxSize) {
  if (image.width > maxSize || image.height > maxSize) {
    const s = maxSize / max(image.width, image.height);
    const nw = round(image.width * s), nh = round(image.height * s);
    const ri = P.createImage(nw, nh);
    ri.copy(image, 0, 0, image.width, image.height, 0, 0, nw, nh);
    return ri;
  }
  return image;
}

function setImage(image) {
  img = adjustImageSize(image, cnv.image.size);
  GW = img.width; GH = img.height;
  form.size.max.width = img.width; form.size.max.height = img.height;
  form.size.x = min(form.size.x, img.width); form.size.y = min(form.size.y, img.height);
  P.resizeCanvas(GW, GH); P.pixelDensity(1);
  if (gForm) gForm.remove();
  gForm = P.createGraphics(GW, GH); gForm.pixelDensity(1); gForm.noStroke();
  alphaImg = makeAlphaImage(GW, GH);
  clearAllForms();
  fitCanvas();
}

function makeAlphaImage(w, h) {
  const g = P.createGraphics(w, h); g.pixelDensity(1); g.noStroke();
  const size = (w + h) / 100;
  let yb = true;
  for (let y = 0; y < h; y += size) {
    yb = !yb; let xb = yb;
    for (let x = 0; x < w; x += size) { xb = !xb; g.fill(xb ? 235 : 205); g.rect(x, y, size, size); }
  }
  const im = g.get(); g.remove(); return im;
}

/////////////////////////////////////////////////////////////////////////////
// Sketch
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'DRIFT', version: '0.2' });

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
    p.pixelDensity(1); p.rectMode(p.CENTER); p.imageMode(p.CORNER); p.noStroke();
    displayCanvas.elt.style.display = 'block';
    setImage(makeDefaultImage());
    wirePointer();
    fitCanvas();
  };
  p.draw = () => {
    if (pendingPreset !== null) { const n = pendingPreset; pendingPreset = null; applyPreset(n); return; }
    if (!img || !gForm) return;
    p.drawingContext.clearRect(0, 0, p.width, p.height);

    if (cnv.bg.mode === 'transparent') { p.image(alphaImg, 0, 0, p.width, p.height); }
    else { p.push(); p.noStroke(); p.fill(cnv.bg.custom); p.rect(p.width / 2, p.height / 2, p.width, p.height); p.pop(); }

    if (cnv.show) p.image(img, 0, 0, p.width, p.height);

    if (form.run) for (const f of form.array) { f.run(); gForm.image(f.graphics, 0, 0); }
    p.image(gForm, 0, 0, p.width, p.height);

    if (overCanvas) drawPreview();
  };
  p.windowResized = () => fitCanvas();
});

/////////////////////////////////////////////////////////////////////////////
// Mouse sampling — pointer mapped to image space via the canvas bounding rect
/////////////////////////////////////////////////////////////////////////////
function pointerToImage(e) {
  const r = displayCanvas.elt.getBoundingClientRect();
  mx = (e.clientX - r.left) / r.width * GW;
  my = (e.clientY - r.top) / r.height * GH;
  form.mouse.x = mx; form.mouse.y = my;
  form.coords.x = mx - form.size.x / 2; form.coords.y = my - form.size.y / 2;
}
function wirePointer() {
  const el = displayCanvas.elt;
  el.addEventListener('pointerenter', () => { overCanvas = true; });
  el.addEventListener('pointerleave', () => { overCanvas = false; cnv.image.preview = false; });
  el.addEventListener('pointermove', (e) => { pointerToImage(e); });
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pressed = true; pointerToImage(e);
    cnv.image.preview = true; cnv.image.x = form.coords.x; cnv.image.y = form.coords.y;
  });
  el.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !pressed) return;
    pressed = false; pointerToImage(e);
    if (cnv.image.preview) { cnv.image.preview = false; spawnForm(false); }
  });
  el.addEventListener('wheel', (e) => {
    if (!overCanvas) return;
    e.preventDefault();
    const dx = floor((e.deltaX || e.deltaY) * cnv.settings.sens);
    const dy = floor(e.deltaY * cnv.settings.sens);
    if (e.shiftKey) { const s = min(form.size.x, form.size.y); const m = max(dx, dy); form.size.x = s + m; form.size.y = s + m; }
    else { form.size.x += dx; form.size.y += dy; }
    form.size.x = round(min(max(form.size.x, form.size.min), form.size.max.width));
    form.size.y = round(min(max(form.size.y, form.size.min), form.size.max.height));
    tool.pane.refresh();
  }, { passive: false });
}

function drawPreview() {
  const xs = form.size.x, ys = form.size.y;
  P.push();
  P.translate(mx, my);
  P.noFill(); P.stroke('#000000aa'); P.strokeWeight(map(GW / (displayCanvas.elt.clientWidth || GW), 0, 4, 0.4, 4));
  P.fill('#ffffff22');
  if (form.type === 'rect') P.rect(0, 0, xs, ys); else P.ellipse(0, 0, xs, ys);
  P.pop();
}

/////////////////////////////////////////////////////////////////////////////
// UI
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;

main.addButton({ title: 'Apply / Respawn Preset' }).on('click', () => applyPreset(presetState.name));

const fCanvas = main.addFolder({ title: 'CANVAS', expanded: false });
fCanvas.addBinding(cnv.bg, 'mode', { label: 'Background', options: BG_OPTS });
fCanvas.addBinding(cnv.bg, 'custom', { label: 'Back Color', view: 'color' });
fCanvas.addBinding(cnv, 'show', { label: 'Show Image' });

const fForm = main.addFolder({ title: 'FORM' });
fForm.addBinding(form, 'type', { label: 'Shape', options: TYPE_OPTS });
fForm.addBinding(form, 'content', { label: 'Content', options: CONTENT_OPTS });
fForm.addBinding(form, 'rendering', { label: 'Rendering', options: RENDER_OPTS });
fForm.addBinding(form.amount, 'num', { label: 'Max Forms', min: form.amount.min, max: form.amount.max, step: 1 }).on('change', () => { checkFormsAmount(); });
fForm.addBinding(form.size, 'x', { label: 'Sample W', min: form.size.min, max: form.size.max.width, step: 1 }).on('change', (e) => { form.size.x = round(e.value); });
fForm.addBinding(form.size, 'y', { label: 'Sample H', min: form.size.min, max: form.size.max.height, step: 1 }).on('change', (e) => { form.size.y = round(e.value); });
const fFrameVal = fForm.addBinding(form.frame, 'value', { label: 'Frame', options: FRAME_OPTS }).on('change', frameUI);
const fFrameW = fForm.addBinding(form.frame, 'width', { label: 'Frame Width', min: 1, max: 20, step: 1 });
const fFrameC = fForm.addBinding(form.frame, 'color', { label: 'Frame Color', view: 'color' });

// Animation channel folders
function addMoveAxis(folder, a, axisLabel) {
  const t = folder.addBinding(a, 'type', { label: `${axisLabel} Type`, options: moveTypeOpts }).on('change', refreshAnimUI);
  const lv = folder.addBinding(a, 'level', { label: `${axisLabel} Level`, min: ui.move.level.min, max: ui.move.level.max, step: ui.move.level.step });
  const rt = folder.addBinding(a, 'rate', { label: `${axisLabel} Rate`, min: ui.move.rate.min, max: ui.move.rate.max, step: ui.move.rate.step });
  const tr = folder.addBinding(a.trend, 'type', { label: `${axisLabel} Trend`, options: trendOpts });
  return { t, lv, rt, tr };
}
function addOffsetAxis(folder, a, axisLabel) {
  const t = folder.addBinding(a, 'type', { label: `${axisLabel} Type`, options: offsetTypeOpts }).on('change', refreshAnimUI);
  const lv = folder.addBinding(a, 'level', { label: `${axisLabel} Level`, min: ui.offset.level.min, max: ui.offset.level.max, step: ui.offset.level.step });
  const rt = folder.addBinding(a, 'rate', { label: `${axisLabel} Rate`, min: ui.offset.rate.min, max: ui.offset.rate.max, step: ui.offset.rate.step });
  const tr = folder.addBinding(a.trend, 'type', { label: `${axisLabel} Trend`, options: trendOpts });
  return { t, lv, rt, tr };
}

const fMove = main.addFolder({ title: 'MOVE', expanded: false });
const cMoveX = addMoveAxis(fMove, anim.move.x, 'X');
const cMoveY = addMoveAxis(fMove, anim.move.y, 'Y');

const fOffset = main.addFolder({ title: 'OFFSET', expanded: false });
const cOffX = addOffsetAxis(fOffset, anim.offset.x, 'X');
const cOffY = addOffsetAxis(fOffset, anim.offset.y, 'Y');

const fRotate = main.addFolder({ title: 'ROTATE', expanded: false });
const cRotT = fRotate.addBinding(anim.rotate, 'type', { label: 'Type', options: moveTypeOpts }).on('change', refreshAnimUI);
const cRotL = fRotate.addBinding(anim.rotate, 'level', { label: 'Level', min: ui.rotate.level.min, max: ui.rotate.level.max, step: ui.rotate.level.step });
const cRotR = fRotate.addBinding(anim.rotate, 'rate', { label: 'Rate', min: ui.rotate.rate.min, max: ui.rotate.rate.max, step: ui.rotate.rate.step });
const cRotTr = fRotate.addBinding(anim.rotate.trend, 'type', { label: 'Trend', options: trendOpts });

const fScale = main.addFolder({ title: 'SCALE', expanded: false });
const cScaT = fScale.addBinding(anim.scale, 'type', { label: 'Type', options: offsetTypeOpts }).on('change', refreshAnimUI);
const cScaL = fScale.addBinding(anim.scale, 'level', { label: 'Level', min: ui.scale.level.min, max: ui.scale.level.max, step: ui.scale.level.step });
const cScaR = fScale.addBinding(anim.scale, 'rate', { label: 'Rate', min: ui.scale.rate.min, max: ui.scale.rate.max, step: ui.scale.rate.step });
const cScaTr = fScale.addBinding(anim.scale.trend, 'type', { label: 'Trend', options: trendOpts });

const fOpacity = main.addFolder({ title: 'OPACITY', expanded: false });
const cOpaT = fOpacity.addBinding(anim.opacity, 'type', { label: 'Type', options: moveTypeOpts }).on('change', refreshAnimUI);
const cOpaL = fOpacity.addBinding(anim.opacity, 'level', { label: 'Level', min: ui.opacity.level.min, max: ui.opacity.level.max, step: ui.opacity.level.step });
const cOpaR = fOpacity.addBinding(anim.opacity, 'rate', { label: 'Rate', min: ui.opacity.rate.min, max: ui.opacity.rate.max, step: ui.opacity.rate.step });

const fTint = main.addFolder({ title: 'TINT', expanded: false });
const cTinT = fTint.addBinding(anim.tint, 'type', { label: 'Type', options: moveTypeOpts }).on('change', refreshAnimUI);
const cTinC = fTint.addBinding(anim.tint, 'color', { label: 'Color', view: 'color' });
const cTinL = fTint.addBinding(anim.tint, 'level', { label: 'Level', min: ui.tint.level.min, max: ui.tint.level.max, step: ui.tint.level.step });
const cTinR = fTint.addBinding(anim.tint, 'rate', { label: 'Rate', min: ui.tint.rate.min, max: ui.tint.rate.max, step: ui.tint.rate.step });

function frameUI() { const on = form.frame.value === 'on'; fFrameW.disabled = !on; fFrameC.disabled = !on; }
function refreshAnimUI() {
  const dis = (ctl, off) => { if (ctl) ctl.disabled = off; };
  // move x/y: trend off for none/noise; level off for none/const; rate off for none
  dis(cMoveX.tr, anim.move.x.type === 'none' || anim.move.x.type === 'noise'); dis(cMoveX.lv, anim.move.x.type === 'none' || anim.move.x.type === 'const'); dis(cMoveX.rt, anim.move.x.type === 'none');
  dis(cMoveY.tr, anim.move.y.type === 'none' || anim.move.y.type === 'noise'); dis(cMoveY.lv, anim.move.y.type === 'none' || anim.move.y.type === 'const'); dis(cMoveY.rt, anim.move.y.type === 'none');
  dis(cOffX.tr, anim.offset.x.type === 'none' || anim.offset.x.type === 'noise'); dis(cOffX.lv, anim.offset.x.type === 'none'); dis(cOffX.rt, anim.offset.x.type === 'none');
  dis(cOffY.tr, anim.offset.y.type === 'none' || anim.offset.y.type === 'noise'); dis(cOffY.lv, anim.offset.y.type === 'none'); dis(cOffY.rt, anim.offset.y.type === 'none');
  dis(cRotTr, anim.rotate.type === 'none' || anim.rotate.type === 'noise'); dis(cRotL, anim.rotate.type === 'none' || anim.rotate.type === 'const'); dis(cRotR, anim.rotate.type === 'none');
  dis(cScaTr, anim.scale.type === 'none' || anim.scale.type === 'noise'); dis(cScaL, anim.scale.type === 'none'); dis(cScaR, anim.scale.type === 'none');
  dis(cOpaL, anim.opacity.type === 'none'); dis(cOpaR, anim.opacity.type === 'none' || anim.opacity.type === 'const');
  dis(cTinC, anim.tint.type === 'none'); dis(cTinL, anim.tint.type === 'none'); dis(cTinR, anim.tint.type === 'none' || anim.tint.type === 'const');
}

/////////////////////////////////////////////////////////////////////////////
// Presets (original names; numeric configs studied from the source)
/////////////////////////////////////////////////////////////////////////////
const presets = {
  'Drift Field': {
    cnv: { bg: { mode: 'custom', custom: '#0c0c12' } },
    form: { amount: { num: 18 }, type: 'rect', rendering: 'canvas', content: 'preview', frame: { value: 'off' }, size: { x: 14, y: 10, uniform: false } },
    anim: { move: { x: { type: 'sin', level: 90, rate: 2 }, y: { type: 'noise', level: 110, rate: 2.5 } }, offset: { x: { type: 'noise', level: 4, rate: 1.5 }, y: { type: 'noise', level: 3, rate: 2 } }, rotate: { type: 'none' }, scale: { type: 'noise', level: 1.3, rate: 1 }, opacity: { type: 'none', level: 60 }, tint: { type: 'none' } },
  },
  'Square Snapper': {
    cnv: { bg: { mode: 'custom', custom: '#ffffff' } },
    form: { amount: { num: 20 }, type: 'rect', rendering: 'layer', content: 'preview', frame: { value: 'on', width: 2, color: '#ffffff7f' }, size: { x: 8, y: 8, uniform: true } },
    anim: { move: { x: { type: 'noise', level: 100, rate: 1.5 }, y: { type: 'sin', level: 50, rate: 1 } }, offset: { x: { type: 'noise', level: 6, rate: 2 }, y: { type: 'noise', level: 10, rate: 2 } }, rotate: { type: 'noise', level: 15, rate: 3 }, scale: { type: 'noise', level: 1.43, rate: 1.5 }, opacity: { type: 'none', level: 75 }, tint: { type: 'none' } },
  },
  'Soaring Blobs': {
    cnv: { bg: { mode: 'custom', custom: '#ffffff' } },
    form: { amount: { num: 20 }, type: 'ellipse', rendering: 'canvas', content: 'preview', frame: { value: 'off' }, size: { x: 10, y: 10, uniform: true } },
    anim: { move: { x: { type: 'const', level: 200, rate: 1.2, trend: { type: 'toggle' } }, y: { type: 'noise', level: 150, rate: 2.5 } }, offset: { x: { type: 'sin', level: 5, rate: 3 }, y: { type: 'noise', level: 3, rate: 2 } }, rotate: { type: 'sin', level: 20, rate: 1 }, scale: { type: 'sin', level: 1.8, rate: 3, trend: { type: 'toggle' } }, opacity: { type: 'noise', level: 100, rate: 2 }, tint: { type: 'cos', level: 10, color: '#000000', rate: 3 } },
  },
  'Clockwork Fans': {
    cnv: { bg: { mode: 'custom', custom: '#ffffff' } },
    form: { amount: { num: 20 }, type: 'rect', rendering: 'layer', content: 'preview', frame: { value: 'on', width: 2, color: '#ffffffff' }, size: { x: 35, y: 1, uniform: false } },
    anim: { move: { x: { type: 'none' }, y: { type: 'none' } }, offset: { x: { type: 'none' }, y: { type: 'noise', level: 10, rate: 1.5 } }, rotate: { type: 'sin', level: 180, rate: 9.9, trend: { type: 'toggle' } }, scale: { type: 'none', level: 1.2 }, opacity: { type: 'none', level: 75 }, tint: { type: 'none' } },
  },
  'Continuous Scan': {
    cnv: { bg: { mode: 'custom', custom: '#ffffff' } },
    form: { amount: { num: 20 }, type: 'rect', rendering: 'canvas', content: 'live', frame: { value: 'off' }, size: { x: 25, y: 10, uniform: false } },
    anim: { move: { x: { type: 'none' }, y: { type: 'const', level: 100, rate: 1.8, trend: { type: 'pos' } } }, offset: { x: { type: 'noise', level: 8, rate: 3 }, y: { type: 'noise', level: 6, rate: 2.5 } }, rotate: { type: 'none' }, scale: { type: 'none', level: 1.2 }, opacity: { type: 'noise', level: 50, rate: 10 }, tint: { type: 'none' } },
  },
  'Red Loops': {
    cnv: { bg: { mode: 'custom', custom: '#ffffff' } },
    form: { amount: { num: 20 }, type: 'ellipse', rendering: 'layer', content: 'preview', frame: { value: 'on', width: 10, color: '#ff00001a' }, size: { x: 11, y: 11, uniform: true } },
    anim: { move: { x: { type: 'noise', level: 157, rate: 3, trend: { type: 'toggle' } }, y: { type: 'noise', level: 200, rate: 1.2 } }, offset: { x: { type: 'noise', level: 15, rate: 2.6 }, y: { type: 'none', level: 4, rate: 1.9 } }, rotate: { type: 'none', level: 15 }, scale: { type: 'cos', level: 1.5, rate: 7.6, trend: { type: 'neg' } }, opacity: { type: 'noise', level: 75, rate: 6.3 }, tint: { type: 'none', level: 50 } },
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
  deepMerge(anim, structuredClone(DEFAULTS.anim));
}
function applyPreset(name) {
  const pr = typeof name === 'string' ? presets[name] : name;
  if (!pr) return;
  resetToDefaults();
  if (pr.cnv) deepMerge(cnv, pr.cnv);
  if (pr.anim) deepMerge(anim, pr.anim);
  if (pr.form) {
    const fSize = pr.form.size; const fcopy = { ...pr.form }; delete fcopy.size;
    deepMerge(form, fcopy);
    if (fSize) {
      // preset sizes are on a 1..100 scale relative to the image
      if (fSize.x !== undefined) form.size.x = round(map(fSize.x, 1, 100, form.size.min, form.size.max.width));
      if (fSize.y !== undefined) form.size.y = round(map(fSize.y, 1, 100, form.size.min, form.size.max.height));
      if (fSize.uniform) { const s = min(form.size.x, form.size.y); form.size.x = s; form.size.y = s; }
    }
  }
  // tint/frame colours may arrive as {r,g,b}
  if (pr.anim && pr.anim.tint && typeof pr.anim.tint.color === 'object') anim.tint.color = rgbaToHex(pr.anim.tint.color);
  if (pr.form && pr.form.frame && typeof pr.form.frame.color === 'object') form.frame.color = rgbaToHex(pr.form.frame.color);
  clearAllForms();
  addRandomFormsOnStartup();
  frameUI(); refreshAnimUI(); tool.pane.refresh();
}

/////////////////////////////////////////////////////////////////////////////
// Randomizer
/////////////////////////////////////////////////////////////////////////////
function randomize() {
  const R = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  anim.move.x.type = pick(ui.move.types); anim.move.y.type = pick(ui.move.types);
  anim.move.x.level = round(R(1) < 0.5 ? R(ui.move.level.max / 10, ui.move.level.max) : R(ui.move.level.min, ui.move.level.max));
  anim.move.y.level = round(R(1) < 0.5 ? R(ui.move.level.max / 10, ui.move.level.max) : R(ui.move.level.min, ui.move.level.max));
  anim.move.x.rate = round(R(ui.move.rate.min, ui.move.rate.max) * 10) / 10; anim.move.y.rate = round(R(ui.move.rate.min, ui.move.rate.max) * 10) / 10;
  anim.offset.x.type = pick(ui.offset.types); anim.offset.y.type = pick(ui.offset.types);
  anim.offset.x.level = round(R(ui.offset.level.min, ui.offset.level.max) * 2) / 2; anim.offset.y.level = round(R(ui.offset.level.min, ui.offset.level.max) * 2) / 2;
  anim.offset.x.rate = round(R(ui.offset.rate.min, ui.offset.rate.max) * 10) / 10; anim.offset.y.rate = round(R(ui.offset.rate.min, ui.offset.rate.max) * 10) / 10;
  anim.rotate.type = pick(ui.rotate.types); anim.rotate.level = round(R(ui.rotate.level.min, ui.rotate.level.max)); anim.rotate.rate = round(R(ui.rotate.rate.min, ui.rotate.rate.max) * 10) / 10;
  anim.scale.type = pick(ui.scale.types); anim.scale.level = round(R(ui.scale.level.min, ui.scale.level.max) * 100) / 100; anim.scale.rate = round(R(ui.scale.rate.min, ui.scale.rate.max) * 10) / 10;
  anim.opacity.type = R(1) < 0.5 ? 'none' : pick(ui.opacity.types); anim.opacity.level = round(R(ui.opacity.level.min, ui.opacity.level.max)); anim.opacity.rate = round(R(ui.opacity.rate.min, ui.opacity.rate.max) * 10) / 10;
  anim.tint.type = R(1) < 0.6 ? 'none' : pick(ui.tint.types); anim.tint.level = round(R(ui.tint.level.min, ui.tint.level.max)); anim.tint.rate = round(R(ui.tint.rate.min, ui.tint.rate.max) * 10) / 10;
  for (const ch of [anim.move.x, anim.move.y, anim.offset.x, anim.offset.y, anim.rotate, anim.scale]) ch.trend.type = pick(ui.trend.types);
  anim.tint.color = rgbaToHex({ r: R(255), g: R(255), b: R(255) });
  clearAllForms(); addRandomFormsOnStartup();
  refreshAnimUI(); tool.pane.refresh();
}

/////////////////////////////////////////////////////////////////////////////
// Drag-drop — an image becomes the source
/////////////////////////////////////////////////////////////////////////////
tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file || !/^image\//i.test(file.type) || file.type === 'image/svg+xml') return;
  const url = URL.createObjectURL(file);
  P.loadImage(url, (im) => { setImage(im); addRandomFormsOnStartup(); URL.revokeObjectURL(url); }, () => URL.revokeObjectURL(url));
});

/////////////////////////////////////////////////////////////////////////////
// Export + OPTIONS + dev hook
/////////////////////////////////////////////////////////////////////////////
attachExport(tool.pages.export, { getCanvas: tool.getCanvas, name: 'drift' });

const presetState = { name: 'Drift Field' };
const opts = tool.pages.options;
opts.addBinding(presetState, 'name', { label: 'Preset', options: Object.fromEntries(Object.keys(presets).map((k) => [k, k])) }).on('change', (ev) => applyPreset(ev.value));
opts.addButton({ title: 'Apply / Respawn Preset' }).on('click', () => applyPreset(presetState.name));
opts.addButton({ title: 'Add Random Form (=)' }).on('click', () => spawnForm(true));
opts.addButton({ title: 'Remove Last (−)' }).on('click', removeLastForm);
opts.addButton({ title: 'Clear All (C)' }).on('click', clearAllForms);
opts.addButton({ title: 'Shuffle Order' }).on('click', shuffleAllForms);
opts.addButton({ title: 'Randomize Params (A)' }).on('click', randomize);
opts.addButton({ title: 'Pause / Resume (P)' }).on('click', () => { form.run = !form.run; });
opts.addButton({ title: 'New Default Image' }).on('click', () => { setImage(makeDefaultImage()); addRandomFormsOnStartup(); });
opts.addButton({ title: 'Fullscreen (f)' }).on('click', () => tool.toggleFullscreen());

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  switch (e.code) {
    case 'Equal': spawnForm(true); break;
    case 'Minus': removeLastForm(); break;
    case 'KeyC': clearAllForms(); break;
    case 'KeyP': form.run = !form.run; break;
    case 'KeyA': randomize(); break;
    case 'KeyI': cnv.show = !cnv.show; tool.pane.refresh(); break;
    case 'KeyM': form.type = form.type === 'rect' ? 'ellipse' : 'rect'; tool.pane.refresh(); break;
  }
});

window.addEventListener('resize', fitCanvas);
exposeDebug('drift', {
  applyPreset, randomize, spawnForm, clearAllForms, cnv, form, anim, presets,
  get formCount() { return form.array.length; }, get img() { return img; },
});

frameUI(); refreshAnimUI();
pendingPreset = 'Drift Field';
