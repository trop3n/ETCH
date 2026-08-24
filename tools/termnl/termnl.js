// TERMNL — a text-native generative instrument. Everything is a character cell:
// twelve engines write luminance into a cols x rows grid (three of them 3D, sampled
// through a z-buffer), a character ramp resolves each cell to a glyph, and a CRT
// colour scheme tints it. Four modes drive the grid — GENERATIVE runs an engine,
// IMAGE samples a dropped photo, WORDS stencils large letterforms and fills them
// with a chosen style, TEXT lays a typed string out one character per cell.
//
// Unlike the ASCII paths in DITHR and FIELD (which rasterise glyphs through a
// shader atlas), the grid here IS the artwork: it exports as real text — copy,
// .txt, .ans with 24-bit ANSI colour, or a fenced markdown block.
//
// No libraries: plain Canvas2D on a bare mounted canvas, plus the shared noise
// module. The 3D engines use standard parametric surfaces; ASCII torus rendering
// in the donut engine follows the approach popularised by Andy Sloane (a1k0n).
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachPresets } from '../../js/etch/presets.js';
import { attachExport } from '../../js/etch/export.js';
import { alea, seedNoise, noise3D } from '../../js/etch/noise.js';

/////////////////////////////////////////////////////////////////////////////
// Taxonomy
/////////////////////////////////////////////////////////////////////////////
const ENGINES = ['donut', 'cube', 'sphere', 'knot', 'pyramid', 'matrix', 'plasma', 'life', 'fire', 'flow', 'stars', 'tunnel'];
const MODES = { Generative: 'generative', Image: 'image', Words: 'words', Text: 'text' };
const FILLS = { Solid: 'solid', '3D': '3d', Matrix: 'matrix', Plasma: 'plasma', Donut: 'donut' };
const PALETTES = { Mono: 'mono', RYB: 'ryb', Rainbow: 'rainbow', Neon: 'neon' };

// Ramps run dark -> light; index 0 is the "empty" cell.
const CHARSETS = {
  Standard: ' .:-=+*#%@',
  Blocks: ' ░▒▓█',
  Dots: ' .·∶∷∸',
  Binary: ' 01',
  Donut: '.,-~:;=!*#$@',
  Photo: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  Bars: ' ▁▂▃▄▅▆▇█',
  Shade: ' ░▒▓',
  Braille: '⠀⠁⠃⠇⠏⠟⠿⡿⣿',
  Stars: ' .*+✦✧★',
  Circles: ' ·∘○◍●',
};

// Each scheme is a background plus a dark->light ink ramp.
const SCHEMES = {
  Phosphor: { bg: '#03120a', ramp: ['#0a3a1c', '#1f8a3c', '#4fd964', '#c8ffd0'] },
  Amber: { bg: '#120a02', ramp: ['#3d2205', '#9c5c08', '#e8a021', '#ffe3a8'] },
  Paper: { bg: '#f2efe6', ramp: ['#c9c4b4', '#8a8474', '#4a453a', '#12100c'] },
  Spectrum: { bg: '#06060a', ramp: ['#2a1a6a', '#0f7fb8', '#37c96a', '#f6f0a8'] },
  Fire: { bg: '#0a0402', ramp: ['#4a0f04', '#b83a06', '#f08a14', '#ffe9b0'] },
  Ice: { bg: '#02070f', ramp: ['#0d2c52', '#1f6ea8', '#54b8d8', '#e2f6ff'] },
  Neon: { bg: '#07030d', ramp: ['#3a0a52', '#a2149c', '#e83fb0', '#8ff6ff'] },
};

/////////////////////////////////////////////////////////////////////////////
// State
/////////////////////////////////////////////////////////////////////////////
const params = {
  mode: 'generative', engine: 0, fill: 'solid',
  charset: 'Standard', scheme: 'Phosphor', palette: 'mono',
  cell: 12, speed: 100, contrast: 100, invert: false, play: true,
  bold: false, seed: 7,
  phrase: 'TERMNL', textBody: 'everything is characters',
  imgFit: true, imgInvert: false,
};
const DEFAULTS = structuredClone(params);

let cols = 0, rows = 0, cw = 0, ch = 0;
let val = new Float32Array(0);        // 0..1 luminance per cell
let hue = new Float32Array(0);        // optional per-cell hue offset
let chars = [];                       // resolved glyph per cell (for text export)
let colorsOut = [];                   // resolved css colour per cell (for .ans)
let t = 0, frames = 0;
let srcImg = null, imgCanvas = null;
let rng = alea(params.seed);

// engine scratch
let lifeGrid = null, lifeNext = null, fireBuf = null;
let matrixHeads = null, matrixSpeed = null, stars = null;

const tool = createTool({ name: 'TERMNL', version: '0.1' });

/////////////////////////////////////////////////////////////////////////////
// Grid sizing
/////////////////////////////////////////////////////////////////////////////
const cnv = tool.mountCanvas();
const ctx = cnv.getContext('2d');

function resize() {
  const w = tool.canvasHost.clientWidth || window.innerWidth;
  const h = tool.canvasHost.clientHeight || window.innerHeight;
  cnv.width = w;
  cnv.height = h;
  // Monospace cells are taller than wide; 0.6 is the usual advance ratio.
  cw = Math.max(3, params.cell * 0.6);
  ch = Math.max(4, params.cell);
  cols = Math.max(4, Math.floor(w / cw));
  rows = Math.max(4, Math.floor(h / ch));
  if (val.length !== cols * rows) {
    val = new Float32Array(cols * rows);
    hue = new Float32Array(cols * rows);
  }
  resetEngine();
}
window.addEventListener('resize', resize);

function resetEngine() {
  rng = alea(params.seed);
  seedNoise(params.seed);
  lifeGrid = new Uint8Array(cols * rows);
  lifeNext = new Uint8Array(cols * rows);
  for (let i = 0; i < lifeGrid.length; i++) lifeGrid[i] = rng() < 0.28 ? 1 : 0;
  fireBuf = new Float32Array(cols * rows);
  matrixHeads = new Float32Array(cols);
  matrixSpeed = new Float32Array(cols);
  for (let x = 0; x < cols; x++) {
    matrixHeads[x] = rng() * rows;
    matrixSpeed[x] = 0.25 + rng() * 0.9;
  }
  stars = [];
  for (let i = 0; i < 260; i++) stars.push({ x: rng() * 2 - 1, y: rng() * 2 - 1, z: rng() * 3 + 0.15 });
}

/////////////////////////////////////////////////////////////////////////////
// 3D helpers — parametric surfaces sampled through a z-buffer
/////////////////////////////////////////////////////////////////////////////
const ASPECT = 2.0;   // cell height / width, so spheres read round

function surface3D(sample, count, zoom) {
  const zbuf = new Float32Array(cols * rows);
  const a = t * 0.9, b = t * 0.62;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const lx = 0, ly = 0.7071, lz = -0.7071;
  const scale = zoom * Math.min(cols / ASPECT, rows) * 0.5;
  for (let i = 0; i < count; i++) {
    const s = sample(i, count);
    if (!s) continue;
    let [px, py, pz, nx, ny, nz] = s;
    // rotate about X then Z
    let y1 = py * ca - pz * sa, z1 = py * sa + pz * ca;
    let x2 = px * cb - y1 * sb, y2 = px * sb + y1 * cb;
    let ny1 = ny * ca - nz * sa, nz1 = ny * sa + nz * ca;
    let nx2 = nx * cb - ny1 * sb, ny2 = nx * sb + ny1 * cb;
    const zz = z1 + 4.2;
    if (zz <= 0.05) continue;
    const ooz = 1 / zz;
    const sx = Math.round(cols / 2 + scale * x2 * ooz * ASPECT);
    const sy = Math.round(rows / 2 - scale * y2 * ooz);
    if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) continue;
    const k = sy * cols + sx;
    if (ooz <= zbuf[k]) continue;
    zbuf[k] = ooz;
    const lum = nx2 * lx + ny2 * ly + nz1 * lz;
    val[k] = Math.max(0.06, Math.min(1, (lum + 0.55) * 0.78));
  }
}

const TAU = Math.PI * 2;

function engDonut() {
  const R = 1.0, r = 0.42, nU = 200, nV = 70;
  surface3D((i) => {
    const u = (i % nU) / nU * TAU, v = Math.floor(i / nU) / nV * TAU;
    const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
    return [(R + r * cv) * cu, (R + r * cv) * su, r * sv, cv * cu, cv * su, sv];
  }, nU * nV, 1.25);
}

function engSphere() {
  const nU = 150, nV = 80;
  surface3D((i) => {
    const u = (i % nU) / nU * TAU, v = Math.floor(i / nU) / nV * Math.PI;
    const sv = Math.sin(v), x = sv * Math.cos(u), y = Math.cos(v), z = sv * Math.sin(u);
    return [x * 1.15, y * 1.15, z * 1.15, x, y, z];
  }, nU * nV, 1.3);
}

function engCube() {
  const n = 34, per = n * n;
  const F = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  surface3D((i) => {
    const f = Math.floor(i / per), k = i % per;
    if (f > 5) return null;
    const a = (k % n) / (n - 1) * 2 - 1, b = Math.floor(k / n) / (n - 1) * 2 - 1;
    const nrm = F[f];
    let p;
    if (f < 2) p = [a, b, nrm[2]];
    else if (f < 4) p = [nrm[0], a, b];
    else p = [a, nrm[1], b];
    return [p[0] * 0.95, p[1] * 0.95, p[2] * 0.95, nrm[0], nrm[1], nrm[2]];
  }, per * 6, 1.15);
}

function engPyramid() {
  const n = 42;
  const apex = [0, 1.15, 0];
  const base = [[-1, -0.6, -1], [1, -0.6, -1], [1, -0.6, 1], [-1, -0.6, 1]];
  const total = n * n * 5;
  surface3D((i) => {
    const face = Math.floor(i / (n * n));
    const k = i % (n * n);
    let u = (k % n) / (n - 1), v = Math.floor(k / n) / (n - 1);
    if (face < 4) {
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const A = base[face], B = base[(face + 1) % 4];
      const p = [
        apex[0] + (A[0] - apex[0]) * u + (B[0] - apex[0]) * v,
        apex[1] + (A[1] - apex[1]) * u + (B[1] - apex[1]) * v,
        apex[2] + (A[2] - apex[2]) * u + (B[2] - apex[2]) * v,
      ];
      const e1 = [A[0] - apex[0], A[1] - apex[1], A[2] - apex[2]];
      const e2 = [B[0] - apex[0], B[1] - apex[1], B[2] - apex[2]];
      let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const m = Math.hypot(nx, ny, nz) || 1;
      return [p[0] * 0.85, p[1] * 0.85, p[2] * 0.85, nx / m, ny / m, nz / m];
    }
    return [(u * 2 - 1) * 0.85, -0.6 * 0.85, (v * 2 - 1) * 0.85, 0, -1, 0];
  }, total, 1.2);
}

function engKnot() {
  const nT = 320, nR = 22;
  surface3D((i) => {
    const s = (i % nT) / nT * TAU, w = Math.floor(i / nT) / nR * TAU;
    // trefoil
    const cx = Math.sin(s) + 2 * Math.sin(2 * s);
    const cy = Math.cos(s) - 2 * Math.cos(2 * s);
    const cz = -Math.sin(3 * s);
    const dx = Math.cos(s) + 4 * Math.cos(2 * s);
    const dy = -Math.sin(s) + 4 * Math.sin(2 * s);
    const dz = -3 * Math.cos(3 * s);
    const dm = Math.hypot(dx, dy, dz) || 1;
    const tx = dx / dm, ty = dy / dm, tz = dz / dm;
    // an arbitrary perpendicular frame
    let ax = -ty, ay = tx, az = 0;
    const am = Math.hypot(ax, ay, az) || 1;
    ax /= am; ay /= am; az /= am;
    const bx = ty * az - tz * ay, by = tz * ax - tx * az, bz = tx * ay - ty * ax;
    const cwv = Math.cos(w), swv = Math.sin(w), rr = 0.34;
    const nx = ax * cwv + bx * swv, ny = ay * cwv + by * swv, nz = az * cwv + bz * swv;
    const k = 0.34;
    return [(cx + nx * rr) * k, (cy + ny * rr) * k, (cz + nz * rr) * k, nx, ny, nz];
  }, nT * nR, 1.05);
}

/////////////////////////////////////////////////////////////////////////////
// 2D engines
/////////////////////////////////////////////////////////////////////////////
function engMatrix() {
  for (let i = 0; i < val.length; i++) val[i] *= 0.82;
  for (let x = 0; x < cols; x++) {
    matrixHeads[x] += matrixSpeed[x];
    if (matrixHeads[x] > rows + 12) { matrixHeads[x] = -rng() * 20; matrixSpeed[x] = 0.25 + rng() * 0.9; }
    const head = Math.floor(matrixHeads[x]);
    for (let d = 0; d < 14; d++) {
      const y = head - d;
      if (y < 0 || y >= rows) continue;
      const k = y * cols + x;
      const v = d === 0 ? 1 : Math.max(0, 1 - d / 14) * 0.8;
      if (v > val[k]) val[k] = v;
      hue[k] = (x * 0.013 + y * 0.004) % 1;
    }
  }
}

function engPlasma() {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const u = x / cols * 6, v = y / rows * 6;
      const d = Math.hypot(u - 3, v - 3);
      let s = Math.sin(u * 1.7 + t * 1.1) + Math.sin(v * 1.3 - t * 0.9)
        + Math.sin((u + v) * 0.9 + t * 0.7) + Math.sin(d * 2.2 - t * 1.4);
      const k = y * cols + x;
      val[k] = (s + 4) / 8;
      hue[k] = ((s + 4) / 8 + t * 0.03) % 1;
    }
  }
}

function engLife() {
  if (frames % 4 === 0) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          n += lifeGrid[((y + dy + rows) % rows) * cols + ((x + dx + cols) % cols)];
        }
        const a = lifeGrid[y * cols + x];
        lifeNext[y * cols + x] = (a && (n === 2 || n === 3)) || (!a && n === 3) ? 1 : 0;
      }
    }
    lifeGrid.set(lifeNext);
  }
  for (let i = 0; i < val.length; i++) val[i] = lifeGrid[i] ? 1 : val[i] * 0.72;
}

function engFire() {
  for (let x = 0; x < cols; x++) fireBuf[(rows - 1) * cols + x] = rng() < 0.82 ? 0.85 + rng() * 0.15 : 0.1;
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols; x++) {
      const b = (y + 1) * cols;
      const s = (fireBuf[b + ((x - 1 + cols) % cols)] + fireBuf[b + x] * 2 + fireBuf[b + ((x + 1) % cols)]) / 4;
      fireBuf[y * cols + x] = Math.max(0, s - 0.035 - rng() * 0.02);
    }
  }
  val.set(fireBuf);
}

function engFlow() {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const n = noise3D(x * 0.055, y * 0.09, t * 0.22);
      const m = noise3D(x * 0.021 + 4.7, y * 0.035 - 2.1, t * 0.11);
      const k = y * cols + x;
      val[k] = Math.min(1, Math.max(0, (n * 0.65 + m * 0.5) + 0.5));
      hue[k] = (m + 0.5) % 1;
    }
  }
}

function engStars() {
  val.fill(0);
  for (const s of stars) {
    s.z -= 0.02 * 1.2;
    if (s.z <= 0.12) { s.x = rng() * 2 - 1; s.y = rng() * 2 - 1; s.z = 3.2; }
    const ooz = 1 / s.z;
    const sx = Math.round(cols / 2 + s.x * ooz * cols * 0.34);
    const sy = Math.round(rows / 2 + s.y * ooz * rows * 0.34);
    if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) continue;
    const k = sy * cols + sx;
    const v = Math.min(1, ooz * 0.42);
    if (v > val[k]) { val[k] = v; hue[k] = (s.z * 0.3) % 1; }
  }
}

function engTunnel() {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dx = (x - cols / 2) / (cols / 2) * ASPECT, dy = (y - rows / 2) / (rows / 2);
      const r = Math.max(Math.hypot(dx, dy), 0.02);
      const a = Math.atan2(dy, dx);
      const u = 0.6 / r + t * 0.9;
      const v = a / TAU * 8;
      const g = (Math.sin(u * TAU) * 0.5 + 0.5) * (Math.sin(v * TAU) * 0.25 + 0.75);
      const k = y * cols + x;
      val[k] = Math.min(1, g * Math.min(1, r * 2.4));
      hue[k] = (u * 0.12) % 1;
    }
  }
}

const ENGINE_FN = {
  donut: engDonut, cube: engCube, sphere: engSphere, knot: engKnot, pyramid: engPyramid,
  matrix: engMatrix, plasma: engPlasma, life: engLife, fire: engFire, flow: engFlow,
  stars: engStars, tunnel: engTunnel,
};
// Engines that accumulate into val across frames must not have it cleared first.
const PERSISTENT = new Set(['matrix', 'life', 'fire']);

/////////////////////////////////////////////////////////////////////////////
// Modes
/////////////////////////////////////////////////////////////////////////////
function runEngine(name) {
  if (!PERSISTENT.has(name)) val.fill(0);
  ENGINE_FN[name]();
}

function modeImage() {
  val.fill(0);
  if (!srcImg) return;
  if (!imgCanvas) imgCanvas = document.createElement('canvas');
  if (imgCanvas.width !== cols || imgCanvas.height !== rows) { imgCanvas.width = cols; imgCanvas.height = rows; }
  const c = imgCanvas.getContext('2d', { willReadFrequently: true });
  c.clearRect(0, 0, cols, rows);
  const ia = srcImg.width / srcImg.height, ga = (cols * cw) / (rows * ch);
  let dw = cols, dh = rows, dx = 0, dy = 0;
  if (params.imgFit) {                       // contain
    if (ia > ga) { dh = Math.round(cols * (ga / ia)); dy = Math.round((rows - dh) / 2); }
    else { dw = Math.round(rows * (ia / ga)); dx = Math.round((cols - dw) / 2); }
  } else {                                   // cover
    if (ia > ga) { dw = Math.round(rows * (ia / ga)); dx = Math.round((cols - dw) / 2); }
    else { dh = Math.round(cols * (ga / ia)); dy = Math.round((rows - dh) / 2); }
  }
  c.drawImage(srcImg, dx, dy, dw, dh);
  const d = c.getImageData(0, 0, cols, rows).data;
  for (let i = 0; i < cols * rows; i++) {
    const o = i * 4;
    let lum = (d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114) / 255 * (d[o + 3] / 255);
    if (params.imgInvert) lum = 1 - lum;
    val[i] = lum;
    hue[i] = (d[o] / 255 * 0.33 + d[o + 2] / 255 * 0.66) % 1;
  }
}

// WORDS: stencil big letterforms, then fill the covered cells from a style source.
let maskBuf = null, maskCanvas = null;
function buildPhraseMask() {
  if (!maskCanvas) maskCanvas = document.createElement('canvas');
  if (maskCanvas.width !== cols || maskCanvas.height !== rows) { maskCanvas.width = cols; maskCanvas.height = rows; }
  const c = maskCanvas.getContext('2d', { willReadFrequently: true });
  c.clearRect(0, 0, cols, rows);
  const txt = (params.phrase || '').trim() || 'TERMNL';
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  // grow the size until it fills ~86% of the width
  let size = rows;
  c.font = `700 ${size}px 'IBM Plex Sans', sans-serif`;
  const target = cols * 0.86;
  const w0 = c.measureText(txt).width || 1;
  size = Math.max(4, Math.min(rows * 0.95, size * (target / w0)));
  c.font = `700 ${size}px 'IBM Plex Sans', sans-serif`;
  c.save();
  c.scale(1, 1);
  c.fillText(txt, cols / 2, rows / 2);
  c.restore();
  const d = c.getImageData(0, 0, cols, rows).data;
  if (!maskBuf || maskBuf.length !== cols * rows) maskBuf = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) maskBuf[i] = d[i * 4 + 3] / 255;
}

function modeWords() {
  buildPhraseMask();
  const style = params.fill;
  if (style === 'matrix' || style === 'plasma' || style === 'donut') {
    runEngine(style === 'donut' ? 'donut' : style);
  } else if (style === '3d') {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      val[y * cols + x] = 0.25 + 0.75 * (1 - y / rows) * (0.5 + 0.5 * (x / cols));
    }
  } else {
    val.fill(1);
  }
  for (let i = 0; i < val.length; i++) val[i] *= maskBuf[i] > 0.35 ? 1 : 0;
}

// TEXT: the literal string, one character per cell, wrapped to the grid.
let textCells = null;
function modeText() {
  val.fill(0);
  if (!textCells || textCells.length !== cols * rows) textCells = new Array(cols * rows).fill('');
  textCells.fill('');
  const words = (params.textBody || '').split(/\s+/).filter(Boolean);
  let x = 0, y = Math.max(0, Math.floor(rows / 2) - 1);
  for (const w of words) {
    if (x + w.length > cols) { x = 0; y++; }
    if (y >= rows) break;
    for (let i = 0; i < w.length; i++) {
      const k = y * cols + x + i;
      if (x + i >= cols) break;
      textCells[k] = w[i];
      val[k] = 0.55 + 0.45 * Math.sin((x + i) * 0.4 + y * 0.7 + t * 1.5) * 0.5 + 0.22;
      hue[k] = ((x + i) / cols) % 1;
    }
    x += w.length + 1;
  }
}

/////////////////////////////////////////////////////////////////////////////
// Colour
/////////////////////////////////////////////////////////////////////////////
function hexRGB(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function rampAt(ramp, v) {
  const n = ramp.length - 1;
  const s = Math.max(0, Math.min(1, v)) * n;
  const i = Math.min(n - 1, Math.floor(s)), f = s - i;
  const A = hexRGB(ramp[i]), B = hexRGB(ramp[i + 1]);
  return [Math.round(A[0] + (B[0] - A[0]) * f), Math.round(A[1] + (B[1] - A[1]) * f), Math.round(A[2] + (B[2] - A[2]) * f)];
}
function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  const seg = ((Math.floor(h * 6) % 6) + 6) % 6;
  const r = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
  return [Math.round((r[0] + m) * 255), Math.round((r[1] + m) * 255), Math.round((r[2] + m) * 255)];
}
// Palette modulates the scheme: mono keeps the ramp, the others cycle hue.
function cellColor(v, h) {
  const sc = SCHEMES[params.scheme];
  if (params.palette === 'mono') return rampAt(sc.ramp, v);
  if (params.palette === 'rainbow') return hsl(h, 0.82, 0.28 + v * 0.48);
  if (params.palette === 'neon') return hsl(0.72 + h * 0.35, 1, 0.34 + v * 0.42);
  return hsl((h * 0.18 + v * 0.1) % 1, 0.95, 0.3 + v * 0.45);   // ryb: warm sweep
}

/////////////////////////////////////////////////////////////////////////////
// Render
/////////////////////////////////////////////////////////////////////////////
function render() {
  const set = CHARSETS[params.charset];
  const sc = SCHEMES[params.scheme];
  const k = params.contrast / 100;
  ctx.fillStyle = sc.bg;
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  ctx.font = `${params.bold ? 700 : 400} ${params.cell}px 'IBM Plex Mono', ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  chars = new Array(cols * rows);
  colorsOut = new Array(cols * rows);
  const isText = params.mode === 'text';

  for (let y = 0; y < rows; y++) {
    let run = '', runColor = null, runX = 0;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      let v = val[i] * k;
      if (params.invert) v = 1 - v;
      v = Math.max(0, Math.min(1, v));
      let glyph;
      if (isText) glyph = textCells[i] || ' ';
      else glyph = set[Math.min(set.length - 1, Math.max(0, Math.round(v * (set.length - 1))))];
      const rgb = cellColor(v, hue[i]);
      const css = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      chars[i] = glyph;
      colorsOut[i] = rgb;
      if (css !== runColor) {
        if (run) { ctx.fillStyle = runColor; ctx.fillText(run, runX * cw, y * ch); }
        run = ''; runColor = css; runX = x;
      }
      run += glyph;
    }
    if (run) { ctx.fillStyle = runColor; ctx.fillText(run, runX * cw, y * ch); }
  }
}

function step(dt) {
  if (params.play) { t += dt * (params.speed / 100); frames++; }
  if (params.mode === 'generative') runEngine(ENGINES[params.engine]);
  else if (params.mode === 'image') modeImage();
  else if (params.mode === 'words') modeWords();
  else modeText();
  render();
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  requestAnimationFrame(loop);
}
resize();
requestAnimationFrame(loop);

/////////////////////////////////////////////////////////////////////////////
// Text export
/////////////////////////////////////////////////////////////////////////////
function asText() {
  const out = [];
  for (let y = 0; y < rows; y++) out.push(chars.slice(y * cols, y * cols + cols).join('').replace(/\s+$/, ''));
  return out.join('\n');
}
function asANSI() {
  const out = [];
  for (let y = 0; y < rows; y++) {
    let line = '', lastC = null;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, c = colorsOut[i];
      const key = c.join(',');
      if (key !== lastC) { line += `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`; lastC = key; }
      line += chars[i];
    }
    out.push(line + '\x1b[0m');
  }
  return out.join('\n');
}
function download(text, name, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/////////////////////////////////////////////////////////////////////////////
// UI
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;
const reset = () => resetEngine();

const fMode = main.addFolder({ title: 'MODE' });
fMode.addBinding(params, 'mode', { label: 'Mode', options: MODES });
fMode.addBinding(params, 'engine', { label: 'Engine', options: Object.fromEntries(ENGINES.map((e, i) => [e.toUpperCase(), i])) }).on('change', reset);
fMode.addBinding(params, 'fill', { label: 'Fill Style', options: FILLS });
fMode.addBinding(params, 'phrase', { label: 'Words' });
fMode.addBinding(params, 'textBody', { label: 'Text' });

const fChar = main.addFolder({ title: 'CHARACTERS' });
fChar.addBinding(params, 'charset', { label: 'Charset', options: Object.fromEntries(Object.keys(CHARSETS).map((k) => [k, k])) });
fChar.addBinding(params, 'cell', { label: 'Cell Size', min: 5, max: 40, step: 1 }).on('change', resize);
fChar.addBinding(params, 'bold', { label: 'Bold' });
fChar.addBinding(params, 'invert', { label: 'Invert' });

const fCol = main.addFolder({ title: 'COLOUR' });
fCol.addBinding(params, 'scheme', { label: 'Scheme', options: Object.fromEntries(Object.keys(SCHEMES).map((k) => [k, k])) });
fCol.addBinding(params, 'palette', { label: 'Palette', options: PALETTES });
fCol.addBinding(params, 'contrast', { label: 'Contrast', min: 10, max: 300, step: 1 });

const fMot = main.addFolder({ title: 'MOTION' });
fMot.addBinding(params, 'speed', { label: 'Speed', min: 0, max: 400, step: 1 });
fMot.addBinding(params, 'play', { label: 'Play' });
fMot.addBinding(params, 'seed', { label: 'Seed', min: 0, max: 9999, step: 1 }).on('change', reset);
fMot.addButton({ title: 'Reseed' }).on('click', () => { params.seed = Math.floor(Math.random() * 9999); resetEngine(); tool.pane.refresh(); });

const fImg = main.addFolder({ title: 'IMAGE', expanded: false });
fImg.addButton({ title: 'Load Image…' }).on('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
  inp.addEventListener('change', () => {
    const f = inp.files && inp.files[0];
    if (f) {
      const url = URL.createObjectURL(f);
      const im = new Image();
      im.onload = () => { srcImg = im; params.mode = 'image'; tool.pane.refresh(); URL.revokeObjectURL(url); };
      im.src = url;
    }
    inp.remove();
  });
  document.body.appendChild(inp);
  inp.click();
});
fImg.addButton({ title: 'Remove Image' }).on('click', () => { srcImg = null; });
fImg.addBinding(params, 'imgFit', { label: 'Fit' });
fImg.addBinding(params, 'imgInvert', { label: 'Invert Image' });

const fTxt = main.addFolder({ title: 'TEXT OUTPUT' });
const st = { s: 'ready' };
const status = fTxt.addBinding(st, 's', { label: 'status', readonly: true });
const say = (m) => { st.s = m; status.refresh(); };
fTxt.addButton({ title: 'Copy as Text' }).on('click', async () => {
  try { await navigator.clipboard.writeText(asText()); say('copied'); }
  catch { say('clipboard blocked'); }
});
fTxt.addButton({ title: 'Save .txt' }).on('click', () => { download(asText(), 'termnl.txt', 'text/plain'); say('saved .txt'); });
fTxt.addButton({ title: 'Save .ans' }).on('click', () => { download(asANSI(), 'termnl.ans', 'text/plain'); say('saved .ans'); });
fTxt.addButton({ title: 'Save README.md' }).on('click', () => {
  download('```\n' + asText() + '\n```\n', 'termnl-readme.md', 'text/markdown');
  say('saved readme');
});

/////////////////////////////////////////////////////////////////////////////
// Presets + export
/////////////////////////////////////////////////////////////////////////////
const presets = {
  'Green Room': { mode: 'generative', engine: 0, charset: 'Donut', scheme: 'Phosphor', palette: 'mono', cell: 12, speed: 100 },
  'Cold Storage': { mode: 'generative', engine: 11, charset: 'Blocks', scheme: 'Ice', palette: 'mono', cell: 10, speed: 130 },
  'Paper Cell': { mode: 'generative', engine: 7, charset: 'Standard', scheme: 'Paper', palette: 'mono', cell: 11, contrast: 140 },
  'Furnace': { mode: 'generative', engine: 8, charset: 'Bars', scheme: 'Fire', palette: 'mono', cell: 9, speed: 160 },
  'Downpour': { mode: 'generative', engine: 5, charset: 'Binary', scheme: 'Phosphor', palette: 'mono', cell: 12 },
  'Wire Signal': { mode: 'generative', engine: 3, charset: 'Dots', scheme: 'Neon', palette: 'neon', cell: 10 },
  'Deep Field': { mode: 'generative', engine: 10, charset: 'Stars', scheme: 'Spectrum', palette: 'rainbow', cell: 13 },
  'Wordmark': { mode: 'words', fill: 'plasma', charset: 'Shade', scheme: 'Amber', palette: 'mono', cell: 12 },
};
function applyPreset(name) {
  const pr = typeof name === 'string' ? presets[name] : name;
  if (!pr) return;
  Object.assign(params, structuredClone(DEFAULTS), pr);
  resize();
  tool.pane.refresh();
}
function randomize() {
  params.engine = Math.floor(Math.random() * ENGINES.length);
  params.charset = Object.keys(CHARSETS)[Math.floor(Math.random() * Object.keys(CHARSETS).length)];
  params.scheme = Object.keys(SCHEMES)[Math.floor(Math.random() * Object.keys(SCHEMES).length)];
  params.palette = Object.values(PALETTES)[Math.floor(Math.random() * 4)];
  params.cell = 8 + Math.floor(Math.random() * 12);
  params.seed = Math.floor(Math.random() * 9999);
  resetEngine();
}

attachExport(tool.pages.export, { getCanvas: () => cnv, name: 'termnl' });
attachPresets(tool.pages.options, { pane: tool.pane, params, presets, randomize, onApply: applyPreset });

exposeDebug('termnl', {
  params, applyPreset, randomize, ENGINES, CHARSETS, SCHEMES,
  asText, asANSI, grid: () => ({ cols, rows }), step, resize,
});
