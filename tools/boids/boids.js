// BOIDS — a Reynolds flocking simulation: alignment / cohesion / separation
// (weighted by an alignment bias) over a spatial-hash grid, with edge wrap or
// repel, mouse attract/repel, per-boid noise wander, and shapes (ellipse / rect
// / triangle / mixed) rendered as vector fills+strokes or windows into a dropped
// image — colored & skewed by speed or heading. The simulation runs in a fixed
// render-space (the ratio resolution) so scale/vision magnitudes stay stable
// across canvas sizes. No texture ships with the tool — drop your own image for
// the texture modes.
//
// The V2D vector class and the core flocking math are adapted from Daniel
// Huang's MIT-licensed boids (https://github.com/cubeDhuang/boids).
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachExport } from '../../js/etch/export.js';

/////////////////////////////////////////////////////////////////////////////
// Math helpers
/////////////////////////////////////////////////////////////////////////////
const { min, max, floor, ceil, abs, cos, sin, sqrt } = Math;
const PI = Math.PI, TAU = Math.PI * 2;
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
const constrain = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function lerpAngle(a, b, t) {
  const delta = ((((b - a) % TAU) + TAU + PI) % TAU) - PI;
  return a + delta * t;
}

/////////////////////////////////////////////////////////////////////////////
// 2D vector (adapted from Daniel Huang's MIT-licensed V2D)
/////////////////////////////////////////////////////////////////////////////
class V2D {
  static random(scale = 1) { const r = P.random(TAU); return new V2D(cos(r) * scale, sin(r) * scale); }
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  zero() { this.x = 0; this.y = 0; return this; }
  angle() { return Math.atan2(this.y, this.x); }
  sqrMag() { return this.x * this.x + this.y * this.y; }
  mag() { return Math.hypot(this.x, this.y); }
  sqrDist(v) { const x = this.x - v.x, y = this.y - v.y; return x * x + y * y; }
  dot(v) { return v.x * this.x + v.y * this.y; }
  rotate(a) { const c = cos(a), s = sin(a), rx = this.x * c - this.y * s; this.y = this.x * s + this.y * c; this.x = rx; return this; }
  mult(s) { this.x *= s; this.y *= s; return this; }
  div(s) { this.x /= s; this.y /= s; return this; }
  setMag(s) { let l = this.sqrMag(); if (l > 0) l = s / sqrt(l); this.x *= l; this.y *= l; return this; }
  max(s) { if (this.sqrMag() <= s * s) return this; return this.setMag(s); }
  min(s) { if (this.sqrMag() >= s * s) return this; return this.setMag(s); }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  sclAdd(v, s) { this.x += v.x * s; this.y += v.y * s; return this; }
}

/////////////////////////////////////////////////////////////////////////////
// Option maps
/////////////////////////////////////////////////////////////////////////////
const RATIOS = {
  '2:1': [640, 320], '16:9': [640, 360], '3:2': [600, 400], '4:3': [512, 384],
  '5:4': [600, 480], '1:1': [480, 480], '4:5': [480, 600], '3:4': [384, 512],
  '2:3': [400, 600], '9:16': [360, 640], '1:2': [320, 640],
};
const RATIO_OPTS = Object.fromEntries(Object.keys(RATIOS).map((k) => [k, k]));
const BG_OPTS = { 'Custom Color': 'color', 'Texture Image': 'image', Transparent: 'alpha' };
const EDGE_OPTS = { 'Wrap around': 'wrap', 'Repel from edges': 'repel' };
const RENDER_OPTS = { 'Vector Graphics': 'vector', 'Textures From Image': 'image' };
const SKEW_OPTS = { None: 'none', 'Based on Speed': 'speed', 'Based on Angle': 'angle' };
const COLOR_OPTS = { None: 'none', 'Single Color': 'single', 'Interpolation (Random)': 'random', 'Interpolation (Speed)': 'speed', 'Interpolation (Angle)': 'angle' };
const SHAPE_OPTS = { Mixed: 'mixed', Ellipse: 'ellipse', Rectangle: 'rect', Triangle: 'triangle' };
const SHAPE_KEYS = ['ellipse', 'rect', 'triangle'];

/////////////////////////////////////////////////////////////////////////////
// State — the default parameter tree
/////////////////////////////////////////////////////////////////////////////
const cnv = {
  ratio: '1:1', animation: true,
  mouseForce: { value: 66, min: 1, max: 100, step: 1 },
  bg: { mode: 'color', color: '#222222ff' },
};
const seed = { value: floor(Math.random() * 10000), max: 10000 };
const params = {
  render: 'vector', shape: 'mixed',
  edge: { mode: 'wrap', offset: { value: 0.1, min: 0, max: 0.5, step: 0.01 }, ease: { value: 0.5, min: 0, max: 1, step: 0.01 } },
  fill: { style: 'single', reaction: 0.1, 0: '#ff4703aa', 1: '#7400ffff' },
  stroke: { style: 'single', width: { value: 0.75, min: 0.25, max: 2, step: 0.05 }, reaction: 0.1, 0: '#ff0000ff', 1: '#7400ffff' },
  boids: { value: 750, min: 50, max: 3000, step: 50 },
  scale: { value: 2.2, random: { value: 0, min: 0, max: 1, step: 0.1 }, min: 0.4, max: 10, step: 0.05 },
  skew: { mode: 'none', value: 0.6, reaction: 0.25, min: 0, max: 0.9, step: 0.05 },
  accuracy: { value: 5, min: 0, max: 10, step: 0.2 },
  vision: { value: 4.5, min: 0, max: 25, step: 0.5 },
  alignment: { value: 1, min: 0, max: 4, step: 0.05 },
  bias: { value: 2, min: 0.1, max: 4, step: 0.05 },
  cohesion: { value: 0.9, min: 0, max: 4, step: 0.05 },
  separation: { value: 1.25, min: 0, max: 4, step: 0.05 },
  steering: { value: 0.15, reaction: 0.2, min: 0, max: 0.5, step: 0.01 },
  speed: { value: { min: 0.1, max: 2 }, min: 0, max: 5, step: 0.05 },
  drag: { value: 0.02, min: 0, max: 0.1, step: 0.005 },
  angle: { value: 2.5, min: 0, max: 10, step: 0.5 },
  reaction: { min: 0, max: 0.5, step: 0.01 },
};
const DEFAULTS = structuredClone({ cnv, params });

// Runtime globals — derived in syncGlobals().
const g = {
  frame: 0, defaultSize: 10, gridFactor: 500,
  shapeTypes: [], shapePos: [], shapeVelocity: [], shapeScale: [], shapeColor: [],
  ctx: null, texture: null, width: 480, height: 480,
  mouse: { x: 0, y: 0, force: 0, down: false, over: false, button: 0 },
};

/////////////////////////////////////////////////////////////////////////////
// Boid (adapted from Daniel Huang's MIT-licensed boids)
/////////////////////////////////////////////////////////////////////////////
class Boid extends V2D {
  constructor(index) {
    super(g.shapePos[index].x, g.shapePos[index].y);
    this.vel = new V2D();
    this.acc = new V2D();
    this.shapeType = g.shapeTypes[index];
    this.index = index;
    this.noiseIndex = index * 0.01;
    this.angle = 0; this.skew = 1;
    this.colorSpeed = 0; this.colorAngle = 0; this.colorRandom = 0; this.frameNoise = 0;
    this.scale = 1;
    this.shapeScale = g.shapeScale[index];
    this.shapeColor = g.shapeColor[index];
    this.startX = floor(this.x); this.startY = floor(this.y);
  }

  neighbors(flock) {
    const cands = flock.candidates(this);
    const ns = [], ds = [];
    const count = cands.flat().length;
    const step = g.accuracy === 0 ? 1 : ceil(count / g.accuracy);
    let i = floor(P.random(step));
    for (const c of cands) {
      for (; i < c.length; i += step) {
        if (this === c[i]) continue;
        const d = this.sqrDist(c[i]);
        if (d < g.sqVision) { ns.push(c[i]); ds.push(d); }
      }
      i -= c.length;
    }
    return [ns, ds];
  }

  flock(flock) {
    this.acc.zero();
    const aln = new V2D(), csn = new V2D(), sep = new V2D();
    const [ns, ds] = this.neighbors(flock);
    let i = 0;
    for (const other of ns) {
      const b = g.aligmentBias ** other.vel.dot(this.vel);
      aln.sclAdd(other.vel, b);
      csn.add(other);
      const d = 1 / (ds[i] || 0.00001);
      sep.x += (this.x - other.x) * d;
      sep.y += (this.y - other.y) * d;
      i++;
    }
    if (ns.length > 0) {
      aln.setMag(g.speedMax).sub(this.vel).max(g.steering);
      csn.div(ns.length).sub(this).setMag(g.speedMax).sub(this.vel).max(g.steering);
      sep.setMag(g.speedMax).sub(this.vel).max(g.steering);
    }
    this.acc.sclAdd(aln, g.alignment);
    this.acc.sclAdd(csn, g.cohesion);
    this.acc.sclAdd(sep, g.separation);
  }

  update() {
    this.vel.sclAdd(this.acc, g.delta);
    if (g.drag) this.vel.mult(1 - g.drag);
    if (g.noiseAngle) {
      const n = P.noise(this.noiseIndex, g.frame * 0.05);
      this.vel.rotate((n - 0.5) * g.noiseAngleRange);
    }
    this.vel.min(g.speedMin);
    this.vel.max(g.speedMax);
    this.sclAdd(this.vel, g.delta);

    if (g.bounce) {
      const edge = g.minCanvasSide * g.bounceOffset;
      const k = g.bounceEase;
      if (this.x < edge) this.vel.x += k * (1 - this.x / edge);
      else if (this.x > g.width - edge) this.vel.x -= k * (1 - (g.width - this.x) / edge);
      if (this.y < edge) this.vel.y += k * (1 - this.y / edge);
      else if (this.y > g.height - edge) this.vel.y -= k * (1 - (g.height - this.y) / edge);
    } else {
      const pad = g.gridPadding + g.scale;
      if (this.x < -pad) this.x = g.width + pad;
      if (this.x > g.width + pad) this.x = -pad;
      if (this.y < -pad) this.y = g.height + pad;
      if (this.y > g.height + pad) this.y = -pad;
    }
    this.angle = lerpAngle(this.angle, this.vel.angle(), g.steerReaction);
  }

  interact() {
    if (g.vision === 0) this.acc.zero();
    if (g.mouse.down && g.mouse.over) {
      const mv = new V2D(g.mouse.x, g.mouse.y);
      const d = mv.sqrDist(this);
      mv.sub(this).setMag(10000 / (d || 1)).max(g.mouse.force);
      if (g.mouse.button === 0) this.acc.add(mv);
      else if (g.mouse.button === 2) this.acc.sub(mv);
    }
  }

  // Rendering
  render() {
    this.scale = 1 - this.shapeScale * g.scaleRandom;
    const ctx = g.ctx;
    ctx.push();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    this[g.skewMode]();
    ctx.scale(this.scale);
    this[g.renderMode]();
    ctx.pop();
  }
  vectorRender() {
    const ctx = g.ctx;
    const fillColor = this[g.fillStyle](g.fillColors, g.fillReaction);
    if (fillColor) ctx.fill(fillColor); else ctx.noFill();
    const strokeColor = this[g.strokeStyle](g.strokeColors, g.strokeReaction);
    if (strokeColor) { ctx.strokeWeight(g.strokeWeight / this.scale); ctx.stroke(strokeColor); } else ctx.noStroke();
    this[this.shapeType]();
  }
  imageRender() {
    if (!g.texture) { g.ctx.fill(180); g.ctx.noStroke(); this[this.shapeType](); return; }
    const ctx = g.ctx;
    const size = g.scale, half = size / 2;
    const sx = this.startX - half, sy = this.startY - half;
    ctx.fill(255); ctx.noStroke();
    ctx.beginClip();
    this[this.shapeType]();
    ctx.endClip();
    ctx.copy(g.texture, floor(sx), floor(sy), ceil(size), ceil(size), -half, -half, size, size);
  }

  // Shapes (named to match shapeType: ellipseShape / rectShape / triangleShape)
  ellipseShape() { g.ctx.ellipse(0, 0, g.scale, g.scale * this.skew); }
  rectShape() { g.ctx.rect(0, 0, g.scale, g.scale * this.skew); }
  triangleShape() { const sx = g.scale * 0.5, sy = g.scale * this.skew * 0.5; g.ctx.triangle(sx, 0, -sx, -sy, -sx, sy); }

  // Coloring
  noneColor() { return false; }
  singleColor(colors) { return colors[0]; }
  randomColor(colors, reaction) {
    this.frameNoise += map(reaction, 0, 0.5, 0, 0.01);
    const n = P.noise(this.noiseIndex, this.frameNoise);
    this.colorRandom = lerp(0.5, n, 3);
    return P.lerpColor(colors[0], colors[1], this.colorRandom);
  }
  speedColor(colors, reaction) {
    const speedNorm = map(this.vel.mag(), g.speedMin, g.speedMax, 0, 1);
    this.colorSpeed = constrain(lerp(this.colorSpeed, speedNorm, reaction), 0, 1);
    return P.lerpColor(colors[0], colors[1], this.colorSpeed);
  }
  angleColor(colors, reaction) {
    const a = abs(this.angle / TAU);
    this.colorAngle = lerp(this.colorAngle, a, reaction);
    const total = colors.length;
    const range = this.colorAngle * total;
    const index = floor(range);
    return P.lerpColor(colors[index % total], colors[(index + 1) % total], range - index);
  }

  // Skewing
  noneSkew() { this.skew = 1; }
  speedSkew() {
    const skewPower = 1 - g.skewValue;
    const speedNorm = constrain(this.vel.mag() / (g.speedMax - g.speedMin), 0, 1);
    this.skew = lerp(this.skew, lerp(1, skewPower, speedNorm), g.skewReaction);
  }
  angleSkew() {
    const skewPower = 1 - g.skewValue;
    const perspective = abs(cos(this.vel.angle()));
    this.skew = lerp(this.skew, lerp(skewPower, 1, perspective), g.skewReaction);
  }
}

/////////////////////////////////////////////////////////////////////////////
// Flock (spatial-hash grid; adapted from Daniel Huang's MIT-licensed boids)
/////////////////////////////////////////////////////////////////////////////
class Flock {
  constructor(boids) {
    this.length = boids; this.shape = params.shape; this.boids = []; this.buckets = [];
    this.space = { scale: null, gwidth: null, gheight: null, width: null, height: null };
    this.organize(); this.reset();
  }
  update() {
    if (this.length !== g.boidsCount) this.resize(g.boidsCount);
    if (this.shape !== params.shape) {
      let i = 0; for (const b of this.boids) b.shapeType = g.shapeTypes[i++];
      this.shape = params.shape;
    }
    for (const b of this.boids) b.update();
    this.organize();
    for (const b of this.boids) { b.flock(this); b.interact(); }
  }
  draw() { for (const b of this.boids) b.render(); }
  resize(num) {
    this.length = num;
    if (this.boids.length > num) { while (this.boids.length > num) this.boids.pop(); }
    else for (let i = this.boids.length; i < num; i++) { this.boids.push(new Boid(i)); this.boids[i].vel = g.shapeVelocity[i]; }
  }
  reset() { this.resize(0); this.resize(this.length); }
  organize() {
    const s = g.vision || 1, pad = g.gridPadding;
    if (this.space.scale !== s || this.space.gwidth !== g.width || this.space.gheight !== g.height) {
      this.space.scale = s; this.space.gwidth = g.width; this.space.gheight = g.height;
      this.space.width = ceil((g.width + pad * 2) / s) * s;
      this.space.height = ceil((g.height + pad * 2) / s) * s;
    }
    const cols = ceil(this.space.width / s), rows = ceil(this.space.height / s);
    this.buckets = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));
    for (const b of this.boids) {
      const row = floor((b.y + pad) / s), col = floor((b.x + pad) / s);
      if (this.buckets[row]?.[col]) this.buckets[row][col].push(b);
    }
  }
  _b(r, c, a) { if (this.buckets[r]?.[c]) a.push(this.buckets[r][c]); }
  candidates(boid) {
    const cand = [], pad = g.gridPadding, s = this.space.scale;
    const row = floor((boid.y + pad) / s), col = floor((boid.x + pad) / s);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) this._b(row + dr, col + dc, cand);
    return cand;
  }
}

/////////////////////////////////////////////////////////////////////////////
// Derived globals + seeded random arrays
/////////////////////////////////////////////////////////////////////////////
function syncGlobals() {
  g.delta = 1;
  g.minCanvasSide = min(g.width, g.height);
  g.boidsCount = params.boids.value;
  g.alignment = params.alignment.value;
  g.aligmentBias = params.bias.value;
  g.cohesion = params.cohesion.value;
  g.separation = params.separation.value;
  g.accuracy = params.accuracy.value >= 10 ? 0 : 2 ** params.accuracy.value;
  g.steering = params.steering.value;
  g.steerReaction = params.steering.reaction;
  g.gridPadding = 0;
  const flockVision = max(params.vision.value * (min(g.width, g.height) / 100), 4);
  g.vision = params.vision.value === 0 ? 0 : flockVision;
  g.sqVision = g.vision * g.vision;
  const baseScale = g.defaultSize * ((g.width + g.height) / 1280);
  g.scale = baseScale * params.scale.value;
  g.maxScale = g.scale * 0.5;
  g.speedMin = params.speed.value.min;
  g.speedMax = params.speed.value.max + 0.01;
  g.drag = params.drag.value;
  g.noiseAngle = params.angle.value !== 0;
  g.noiseAngleRange = (PI / 80) * params.angle.value;
  g.scaleRandom = params.scale.random.value;
  g.bounce = params.edge.mode !== 'wrap';
  g.bounceOffset = map(params.edge.offset.value, params.edge.offset.min, params.edge.offset.max, 0.01, 0.45);
  g.bounceEase = map(params.edge.ease.value, params.edge.ease.min, params.edge.ease.max, 5, 0.05);
  g.skewMode = `${params.skew.mode}Skew`;
  g.skewValue = params.skew.value;
  g.skewReaction = params.skew.reaction;
  g.renderMode = `${params.render}Render`;
  g.fillStyle = `${params.fill.style}Color`;
  if (g._fillKey !== params.fill[0] + '|' + params.fill[1]) { g._fillKey = params.fill[0] + '|' + params.fill[1]; g.fillColors = [P.color(params.fill[0]), P.color(params.fill[1])]; }
  g.fillReaction = params.fill.reaction;
  g.strokeStyle = `${params.stroke.style}Color`;
  if (g._strokeKey !== params.stroke[0] + '|' + params.stroke[1]) { g._strokeKey = params.stroke[0] + '|' + params.stroke[1]; g.strokeColors = [P.color(params.stroke[0]), P.color(params.stroke[1])]; }
  g.strokeReaction = params.stroke.reaction;
  g.strokeWeight = params.stroke.width.value;

  const mouseForce = 1 + g.speedMax * (g.alignment + g.cohesion + g.separation + 1);
  const forceLevel = map(cnv.mouseForce.value, cnv.mouseForce.min, cnv.mouseForce.max, 200, 5);
  g.mouse.force = max(mouseForce / forceLevel, 0);
  g.mouse.x = P.mouseX; g.mouse.y = P.mouseY;
  g.mouse.over = P.mouseX >= 0 && P.mouseX <= g.width && P.mouseY >= 0 && P.mouseY <= g.height;
  g.mouse.down = P.mouseIsPressed;
  g.mouse.button = P.mouseButton === P.RIGHT ? 2 : P.mouseButton === P.CENTER ? 1 : 0;

  if (cnv.animation) g.frame++;
}

function snapGrid(value, axis, minA, maxA) {
  const a = axis / g.gridFactor;
  const v = min(Math.round(value / a) * a, maxA);
  return v < minA ? minA : v;
}
function randomShape() {
  if (params.shape !== 'mixed') return params.shape;
  return SHAPE_KEYS[floor(P.random(SHAPE_KEYS.length))];
}
function updateRandomArrays() {
  g.shapeVelocity = []; g.shapeTypes = []; g.shapeScale = []; g.shapePos = []; g.shapeColor = [];
  const lo = g.maxScale, hiW = g.width - g.maxScale, hiH = g.height - g.maxScale;
  for (let i = 0; i < params.boids.max; i++) {
    g.shapeVelocity.push(V2D.random(P.random(g.speedMin, g.speedMax)));
    g.shapeTypes.push(`${randomShape()}Shape`);
    g.shapeScale.push(P.random(-0.2, 0.9));
    const x = snapGrid(P.random(lo, hiW), g.width, lo, hiW);
    const y = snapGrid(P.random(lo, hiH), g.height, lo, hiH);
    g.shapePos.push({ x, y });
    g.shapeColor.push(P.random());
  }
}

/////////////////////////////////////////////////////////////////////////////
// p5 sketch (simulation render-space canvas, CSS-fit to the viewport)
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'BOIDS', version: '0.2' });
let P = null, flock = null, displayCanvas = null;
let GW = 480, GH = 480;
let pendingPreset = 'Murmuration'; // applied on the first draw (after full module init)

const CHECKER = 'repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 24px 24px';

function applyRatio(p) {
  [GW, GH] = RATIOS[cnv.ratio];
  g.width = GW; g.height = GH;
  p.resizeCanvas(GW, GH);
  fitCanvas();
}
function fitCanvas() {
  if (!displayCanvas) return;
  const pad = 40;
  const k = min((window.innerWidth - pad * 2) / GW, (window.innerHeight - pad * 2) / GH);
  displayCanvas.elt.style.width = `${GW * k}px`;
  displayCanvas.elt.style.height = `${GH * k}px`;
}
function restartSimulation() {
  g.frame = 0;
  P.randomSeed(seed.value); P.noiseSeed(seed.value);
  syncGlobals();
  updateRandomArrays();
  if (flock) flock.reset(); else flock = new Flock(params.boids.value);
}

tool.startSketch((p) => {
  p.setup = () => {
    P = p;
    g.ctx = p;
    tool.canvasHost.style.display = 'flex';
    tool.canvasHost.style.alignItems = 'center';
    tool.canvasHost.style.justifyContent = 'center';
    displayCanvas = p.createCanvas(GW, GH);
    displayCanvas.elt.style.display = 'block';
    displayCanvas.elt.addEventListener('contextmenu', (e) => e.preventDefault());
    p.pixelDensity(2);
    p.frameRate(60);
    p.rectMode(p.CENTER); p.ellipseMode(p.CENTER); p.imageMode(p.CENTER);
    g.width = GW; g.height = GH;
    applyRatio(p);
  };

  p.draw = () => {
    if (pendingPreset) { const n = pendingPreset; pendingPreset = null; applyPreset(n); }
    if (!flock) return;
    drawBackground(p);
    syncGlobals();
    if (cnv.animation) flock.update();
    flock.draw();
  };

  p.windowResized = () => fitCanvas();
});

function drawBackground(p) {
  if (cnv.bg.mode === 'alpha') {
    p.clear();
    displayCanvas.elt.style.background = CHECKER;
    return;
  }
  displayCanvas.elt.style.background = 'none';
  if (cnv.bg.mode === 'image' && g.texture) {
    p.background(cnv.bg.color);
    p.push(); p.imageMode(p.CORNER); p.image(g.texture, 0, 0, GW, GH); p.pop();
  } else {
    p.background(cnv.bg.color);
  }
}

/////////////////////////////////////////////////////////////////////////////
// Texture image drag-drop (for the texture render/background modes)
/////////////////////////////////////////////////////////////////////////////
function setTexture(img) {
  const tex = P.createGraphics(GW, GH);
  const k = max(GW / img.width, GH / img.height);
  const w = img.width * k, h = img.height * k;
  tex.imageMode(P.CORNER);
  tex.image(img, (GW - w) / 2, (GH - h) / 2, w, h);
  g.texture = tex;
}
const imageInput = document.createElement('input');
imageInput.type = 'file'; imageInput.accept = 'image/*'; imageInput.style.display = 'none';
document.body.appendChild(imageInput);
imageInput.addEventListener('change', () => { const f = imageInput.files?.[0]; if (f) loadDroppedImage(f); });
function loadDroppedImage(file) {
  const reader = new FileReader();
  reader.onload = () => { P.loadImage(reader.result, (img) => { setTexture(img); if (params.render !== 'image' && cnv.bg.mode !== 'image') cnv.bg.mode = 'image'; canvasUI(); tool.pane.refresh(); }); };
  reader.readAsDataURL(file);
}
tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file && /^image\//i.test(file.type)) loadDroppedImage(file);
});

/////////////////////////////////////////////////////////////////////////////
// UI folders: CANVAS / SHAPE / COLOR / FLOCKING / SIMULATION.
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;

const fCanvas = main.addFolder({ title: 'CANVAS', expanded: false });
fCanvas.addBinding(cnv, 'ratio', { label: 'Canvas Ratio', options: RATIO_OPTS }).on('change', () => { applyRatio(P); restartSimulation(); });
fCanvas.addBinding(params.edge, 'mode', { label: 'Edge Behavior', options: EDGE_OPTS }).on('change', edgeUI);
const edgeOffset = fCanvas.addBinding(params.edge.offset, 'value', { label: 'Edge Offset', min: params.edge.offset.min, max: params.edge.offset.max, step: params.edge.offset.step });
const edgeEase = fCanvas.addBinding(params.edge.ease, 'value', { label: 'Repel Easing', min: params.edge.ease.min, max: params.edge.ease.max, step: params.edge.ease.step });
fCanvas.addBinding(cnv.bg, 'mode', { label: 'Background', options: BG_OPTS }).on('change', canvasUI);
const bgColor = fCanvas.addBinding(cnv.bg, 'color', { label: 'Canvas Color' });
const bgTexBtn = fCanvas.addButton({ title: 'Load Texture Image…' }).on('click', () => imageInput.click());

const fShape = main.addFolder({ title: 'SHAPE' });
fShape.addBinding(params, 'shape', { label: 'Shape Type', options: SHAPE_OPTS }).on('change', () => { const b = flock?.boids || []; for (let i = 0; i < b.length; i++) b[i].shapeType = g.shapeTypes[i]; });
fShape.addBinding(params.boids, 'value', { label: 'Boids Count', min: params.boids.min, max: params.boids.max, step: params.boids.step }).on('change', (ev) => flock?.resize(ev.value));
fShape.addBinding(params.scale, 'value', { label: 'Shape Scale', min: params.scale.min, max: params.scale.max, step: params.scale.step });
fShape.addBinding(params.scale.random, 'value', { label: 'Scale Random', min: params.scale.random.min, max: params.scale.random.max, step: params.scale.random.step });
fShape.addBinding(params.skew, 'mode', { label: 'Skew Mode', options: SKEW_OPTS }).on('change', skewUI);
const skewLevel = fShape.addBinding(params.skew, 'value', { label: 'Skew Level', min: params.skew.min, max: params.skew.max, step: params.skew.step });
const skewReaction = fShape.addBinding(params.skew, 'reaction', { label: 'Skew Reaction', min: params.reaction.min, max: params.reaction.max, step: params.reaction.step });

const fColor = main.addFolder({ title: 'COLOR', expanded: false });
fColor.addBinding(params, 'render', { label: 'Render Mode', options: RENDER_OPTS }).on('change', colorUI);
const renderTexBtn = fColor.addButton({ title: 'Load Texture Image…' }).on('click', () => imageInput.click());
const fillStyle = fColor.addBinding(params.fill, 'style', { label: 'Fill Style', options: COLOR_OPTS }).on('change', colorUI);
const fillReaction = fColor.addBinding(params.fill, 'reaction', { label: 'Fill Reaction', min: params.reaction.min, max: params.reaction.max, step: params.reaction.step });
const fillC0 = fColor.addBinding(params.fill, '0', { label: 'Fill Start' });
const fillC1 = fColor.addBinding(params.fill, '1', { label: 'Fill End' });
const strokeStyle = fColor.addBinding(params.stroke, 'style', { label: 'Stroke Style', options: COLOR_OPTS }).on('change', colorUI);
const strokeWidth = fColor.addBinding(params.stroke.width, 'value', { label: 'Stroke Width', min: params.stroke.width.min, max: params.stroke.width.max, step: params.stroke.width.step });
const strokeReaction = fColor.addBinding(params.stroke, 'reaction', { label: 'Stroke Reaction', min: params.reaction.min, max: params.reaction.max, step: params.reaction.step });
const strokeC0 = fColor.addBinding(params.stroke, '0', { label: 'Stroke Start' });
const strokeC1 = fColor.addBinding(params.stroke, '1', { label: 'Stroke End' });

const fFlock = main.addFolder({ title: 'FLOCKING', expanded: false });
fFlock.addBinding(params.accuracy, 'value', { label: 'Move Accuracy', min: params.accuracy.min, max: params.accuracy.max, step: params.accuracy.step });
fFlock.addBinding(params.vision, 'value', { label: 'Boid Vision', min: params.vision.min, max: params.vision.max, step: params.vision.step }).on('change', () => { syncGlobals(); flock?.organize(); });
fFlock.addBinding(params.alignment, 'value', { label: 'Alignment', min: params.alignment.min, max: params.alignment.max, step: params.alignment.step });
fFlock.addBinding(params.bias, 'value', { label: 'Alignment Bias', min: params.bias.min, max: params.bias.max, step: params.bias.step });
fFlock.addBinding(params.cohesion, 'value', { label: 'Cohesion', min: params.cohesion.min, max: params.cohesion.max, step: params.cohesion.step });
fFlock.addBinding(params.separation, 'value', { label: 'Separation', min: params.separation.min, max: params.separation.max, step: params.separation.step });
fFlock.addBinding(params.steering, 'value', { label: 'Steering Force', min: params.steering.min, max: params.steering.max, step: params.steering.step });
fFlock.addBinding(params.steering, 'reaction', { label: 'Turning Reaction', min: params.reaction.min, max: params.reaction.max, step: params.reaction.step });
fFlock.addBinding(params.speed.value, 'min', { label: 'Speed Min', min: params.speed.min, max: params.speed.max, step: params.speed.step });
fFlock.addBinding(params.speed.value, 'max', { label: 'Speed Max', min: params.speed.min, max: params.speed.max, step: params.speed.step });
fFlock.addBinding(params.drag, 'value', { label: 'Velocity Drag', min: params.drag.min, max: params.drag.max, step: params.drag.step });
fFlock.addBinding(params.angle, 'value', { label: 'Noise Angle', min: params.angle.min, max: params.angle.max, step: params.angle.step });

const fSim = main.addFolder({ title: 'SIMULATION' });
fSim.addButton({ title: 'Restart Simulation' }).on('click', () => restartSimulation());
fSim.addBinding(cnv, 'animation', { label: 'Animate' });
fSim.addBinding(seed, 'value', { label: 'Random Seed', min: 0, max: seed.max, step: 1 }).on('change', (ev) => { if (!ev.last) restartSimulation(); });
fSim.addButton({ title: 'Random Seed' }).on('click', () => { seed.value = floor(Math.random() * seed.max); tool.pane.refresh(); restartSimulation(); });

function canvasUI() {
  bgColor.hidden = cnv.bg.mode !== 'color';
  bgTexBtn.hidden = cnv.bg.mode === 'color';
}
function edgeUI() { edgeOffset.hidden = edgeEase.hidden = params.edge.mode !== 'repel'; }
function skewUI() { skewLevel.hidden = skewReaction.hidden = params.skew.mode === 'none'; }
function colorUI() {
  const image = params.render === 'image';
  renderTexBtn.hidden = !image;
  for (const c of [fillStyle, fillReaction, fillC0, fillC1, strokeStyle, strokeWidth, strokeReaction, strokeC0, strokeC1]) c.hidden = image;
  if (image) return;
  const fs = params.fill.style;
  fillC0.hidden = fs === 'none';
  fillC1.hidden = !(fs === 'random' || fs === 'speed' || fs === 'angle');
  fillReaction.hidden = !(fs === 'random' || fs === 'speed' || fs === 'angle');
  const ss = params.stroke.style;
  strokeC0.hidden = ss === 'none';
  strokeWidth.hidden = ss === 'none';
  strokeC1.hidden = !(ss === 'random' || ss === 'speed' || ss === 'angle');
  strokeReaction.hidden = !(ss === 'random' || ss === 'speed' || ss === 'angle');
}

/////////////////////////////////////////////////////////////////////////////
// Export + Presets
/////////////////////////////////////////////////////////////////////////////
attachExport(tool.pages.export, { getCanvas: tool.getCanvas, name: 'boids' });

const presets = {
  Murmuration: { seed: 6169, cnv: { ratio: '4:3', bg: { mode: 'color', color: '#0b0d12ff' } }, params: { render: 'vector', shape: 'triangle', edge: { mode: 'repel', offset: { value: 0.1 }, ease: { value: 0.5 } }, fill: { style: 'single', reaction: 0.5, 0: '#ff5a1eff', 1: '#ff6565ff' }, stroke: { style: 'none', width: { value: 0.75 }, reaction: 0.1, 0: '#ffffffff', 1: '#7400ffff' }, boids: { value: 2500 }, scale: { value: 0.55, random: { value: 0 } }, skew: { mode: 'none', value: 0.5, reaction: 0.11 }, accuracy: { value: 6 }, vision: { value: 2.5 }, alignment: { value: 0.6 }, bias: { value: 1.35 }, cohesion: { value: 0.3 }, separation: { value: 0.6 }, steering: { value: 0.09, reaction: 0.4 }, speed: { value: { min: 0.8, max: 1.4 } }, drag: { value: 0.01 }, angle: { value: 1 } } },
  'Coral Current': { seed: 6340, cnv: { ratio: '3:2', bg: { mode: 'color', color: '#0f0655ff' } }, params: { render: 'vector', shape: 'rect', edge: { mode: 'wrap', offset: { value: 0.07 }, ease: { value: 1 } }, fill: { style: 'speed', reaction: 0.5, 0: '#9100ffff', 1: '#ff6565ff' }, stroke: { style: 'none', width: { value: 0.75 }, reaction: 0.1, 0: '#000000ff', 1: '#7400ffff' }, boids: { value: 2200 }, scale: { value: 1.65, random: { value: 0 } }, skew: { mode: 'speed', value: 0.85, reaction: 0.25 }, accuracy: { value: 4.8 }, vision: { value: 2 }, alignment: { value: 1.25 }, bias: { value: 0.55 }, cohesion: { value: 0.15 }, separation: { value: 0.5 }, steering: { value: 0.23, reaction: 0.17 }, speed: { value: { min: 0.65, max: 2.3 } }, drag: { value: 0.02 }, angle: { value: 0.5 } } },
  'Jelly Bloom': { seed: 4281, cnv: { ratio: '1:1', bg: { mode: 'color', color: '#160c2eff' } }, params: { render: 'vector', shape: 'ellipse', edge: { mode: 'wrap', offset: { value: 0.1 }, ease: { value: 0.5 } }, fill: { style: 'angle', reaction: 0.06, 0: '#faff6dff', 1: '#9339ffff' }, stroke: { style: 'none', width: { value: 1 }, reaction: 0.1, 0: '#ffffffff', 1: '#000000ff' }, boids: { value: 1500 }, scale: { value: 2.2, random: { value: 0.6 } }, skew: { mode: 'angle', value: 0.5, reaction: 0.1 }, accuracy: { value: 7 }, vision: { value: 7 }, alignment: { value: 1 }, bias: { value: 1 }, cohesion: { value: 0.5 }, separation: { value: 0.9 }, steering: { value: 0.12, reaction: 0.12 }, speed: { value: { min: 0.3, max: 1.2 } }, drag: { value: 0.03 }, angle: { value: 1.5 } } },
  Severance: { seed: 4538, cnv: { ratio: '1:1', bg: { mode: 'color', color: '#f2f2efff' } }, params: { render: 'vector', shape: 'rect', edge: { mode: 'repel', offset: { value: 0.03 }, ease: { value: 0 } }, fill: { style: 'speed', reaction: 0.09, 0: '#3a3f43ff', 1: '#249c00ff' }, stroke: { style: 'single', width: { value: 1 }, reaction: 0.1, 0: '#0b0b0bff', 1: '#249c00ff' }, boids: { value: 220 }, scale: { value: 9, random: { value: 0.5 } }, skew: { mode: 'none', value: 0.6, reaction: 0.05 }, accuracy: { value: 8 }, vision: { value: 10 }, alignment: { value: 0.35 }, bias: { value: 1.6 }, cohesion: { value: 0.4 }, separation: { value: 0.65 }, steering: { value: 0.05, reaction: 0 }, speed: { value: { min: 0, max: 0.18 } }, drag: { value: 0.01 }, angle: { value: 0 } } },
  Bubblestream: { seed: 7027, cnv: { ratio: '1:1', bg: { mode: 'color', color: '#ff2600ff' } }, params: { render: 'vector', shape: 'ellipse', edge: { mode: 'wrap', offset: { value: 0.1 }, ease: { value: 0.5 } }, fill: { style: 'single', reaction: 0.1, 0: '#ffffffd8', 1: '#000000ff' }, stroke: { style: 'single', width: { value: 0.75 }, reaction: 0.1, 0: '#ff2600ff', 1: '#7400ffff' }, boids: { value: 1000 }, scale: { value: 2, random: { value: 1 } }, skew: { mode: 'none', value: 0.6, reaction: 0.25 }, accuracy: { value: 5 }, vision: { value: 4.5 }, alignment: { value: 1 }, bias: { value: 2 }, cohesion: { value: 0.9 }, separation: { value: 1.5 }, steering: { value: 0.15, reaction: 0.2 }, speed: { value: { min: 0.1, max: 2 } }, drag: { value: 0.02 }, angle: { value: 2.5 } } },
  Nightshoal: { seed: 1717, cnv: { ratio: '16:9', bg: { mode: 'color', color: '#05080fff' } }, params: { render: 'vector', shape: 'triangle', edge: { mode: 'wrap', offset: { value: 0.1 }, ease: { value: 0.5 } }, fill: { style: 'speed', reaction: 0.2, 0: '#1b4a8aff', 1: '#7fe7ffff' }, stroke: { style: 'none', width: { value: 0.5 }, reaction: 0.1, 0: '#000000ff', 1: '#7400ffff' }, boids: { value: 2000 }, scale: { value: 0.9, random: { value: 0.3 } }, skew: { mode: 'speed', value: 0.7, reaction: 0.2 }, accuracy: { value: 6 }, vision: { value: 3 }, alignment: { value: 1.4 }, bias: { value: 1.2 }, cohesion: { value: 0.5 }, separation: { value: 0.8 }, steering: { value: 0.12, reaction: 0.25 }, speed: { value: { min: 0.6, max: 2 } }, drag: { value: 0.02 }, angle: { value: 1.5 } } },
  'Ember Drift': { seed: 909, cnv: { ratio: '1:1', bg: { mode: 'color', color: '#140702ff' } }, params: { render: 'vector', shape: 'ellipse', edge: { mode: 'wrap', offset: { value: 0.1 }, ease: { value: 0.5 } }, fill: { style: 'random', reaction: 0.08, 0: '#ff8a00cc', 1: '#ff1e00cc' }, stroke: { style: 'none', width: { value: 0.5 }, reaction: 0.1, 0: '#000000ff', 1: '#7400ffff' }, boids: { value: 1400 }, scale: { value: 1.8, random: { value: 0.6 } }, skew: { mode: 'none', value: 0.6, reaction: 0.2 }, accuracy: { value: 5 }, vision: { value: 5 }, alignment: { value: 0.8 }, bias: { value: 1.6 }, cohesion: { value: 0.7 }, separation: { value: 1 }, steering: { value: 0.1, reaction: 0.18 }, speed: { value: { min: 0.2, max: 1.1 } }, drag: { value: 0.03 }, angle: { value: 3 } } },
};

function deepMerge(dst, src) {
  for (const k of Object.keys(src)) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) { dst[k] = dst[k] || {}; deepMerge(dst[k], src[k]); }
    else dst[k] = src[k];
  }
}
function resetToDefaults() {
  deepMerge(cnv, structuredClone(DEFAULTS.cnv));
  deepMerge(params, structuredClone(DEFAULTS.params));
}
function applyPreset(name) {
  const pr = presets[name]; if (!pr) return;
  resetToDefaults();
  if (pr.cnv) deepMerge(cnv, pr.cnv);
  if (pr.params) deepMerge(params, pr.params);
  if (pr.seed != null) seed.value = pr.seed;
  if (P) applyRatio(P);
  restartSimulation();
  canvasUI(); colorUI(); skewUI(); edgeUI();
  tool.pane.refresh();
}

const presetState = { name: 'Murmuration' };
const opts = tool.pages.options;
opts.addBinding(presetState, 'name', { label: 'Preset', options: Object.fromEntries(Object.keys(presets).map((k) => [k, k])) }).on('change', (ev) => applyPreset(ev.value));
opts.addButton({ title: 'Apply Preset' }).on('click', () => applyPreset(presetState.name));
opts.addButton({ title: 'Fullscreen (f)' }).on('click', () => tool.toggleFullscreen());

window.addEventListener('resize', fitCanvas);
// Dev hook: drive presets / inspect state from the console while tuning fidelity.
exposeDebug('boids', { applyPreset, restartSimulation, params, cnv, seed, g, get flock() { return flock; }, presets });
// Initial preset is applied on the first draw tick (see p.draw) so the whole
// module — presets, UI, helpers — is initialized and the p5 instance is ready.
