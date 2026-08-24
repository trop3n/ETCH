// DITHR — real-time dithering of a source through a GPU shader pipeline. A source
// (a lit 3D primitive, or a dropped image/video) is rendered into a WEBGL buffer,
// then dithered by one of five fragment shaders — ASCII (a glyph atlas indexed by
// luminance), basic halftone (SDF dots per RGB channel), CMYK rosette halftone,
// ordered Bayer/pattern matrix, or noise-texture threshold — and finally
// colour-remapped through a 1-D palette gradient. Brightness / contrast /
// saturation / posterization sit between the source and the dither.
//
// The five fragment shaders are third-party open source, kept with attribution
// (Sean LeBlanc ordered-dither, Stefan Gustavson CMYK halftone, humanbydefinition
// ASCII — all MIT / public domain). Source geometry is a set of lit 3D
// primitives; the noise threshold texture is generated procedurally.
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachExport } from '../../js/etch/export.js';
import { alea } from '../../js/etch/noise.js';

const { sin, cos, floor, ceil, round, sqrt, min, max, abs, PI } = Math;
const TWO_PI = PI * 2;
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const radians = (d) => (d * PI) / 180;
const degrees = (r) => (r * 180) / PI;

/////////////////////////////////////////////////////////////////////////////
// map2 — easing-aware map (subset used by the halftone CMYK scale)
/////////////////////////////////////////////////////////////////////////////
function map2(value, s1, e1, s2, e2, type, when) {
  const b = s2, c = e2 - s2, d = e1 - s1; let t = value - s1;
  if (type === 'Exponential') {
    if (when === 0) return c * Math.pow(2, 10 * (t / d - 1)) + b;
    if (when === 1) return c * (-Math.pow(2, (-10 * t) / d) + 1) + b;
    t /= d / 2; if (t < 1) return (c / 2) * Math.pow(2, 10 * (t - 1)) + b; t--; return (c / 2) * (-Math.pow(2, -10 * t) + 2) + b;
  }
  return (c * t) / d + b;
}

/////////////////////////////////////////////////////////////////////////////
// Shaders — one full-screen vertex (p5 1.9.x convention: aPosition is already
// clip-space; pass aTexCoord through), five third-party fragments kept verbatim.
/////////////////////////////////////////////////////////////////////////////
// Full-screen quad: derive clip-space position from aTexCoord (reliably 0..1 over
// a p5 rect, on the main canvas AND graphics buffers), so the pass always fills.
const VERT = `
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main(){ vTexCoord = aTexCoord; gl_Position = vec4(aTexCoord * 2.0 - 1.0, 0.0, 1.0); }`;

// Ordered dither — Sean S. LeBlanc (MIT) https://github.com/seleb/ordered-dither-maker
const DITH_FRAG = `
precision highp float;
uniform sampler2D u_texture;
uniform sampler2D u_dither_tex;
uniform vec2 u_resolution;
uniform vec2 u_dither_size;
uniform int u_density;
uniform float u_scale;
uniform float u_steps;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_brightness;
void main(){
  vec2 coord = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  coord -= mod(coord, u_scale);
  if (u_density > 1) coord += u_scale * 0.5;
  vec2 uv_dither = fract((coord + vec2(0.5)) / u_dither_size.xy);
  vec2 uv_texture = coord.xy / u_resolution;
  float alpha = texture2D(u_texture, uv_texture).a;
  vec4 img = (texture2D(u_texture, uv_texture).rgba - 0.5 + (u_brightness - 1.0)) * u_contrast + 0.5;
  vec3 limit = texture2D(u_dither_tex, uv_dither).rgb;
  float grayscale = dot(img.rgb, vec3(0.299, 0.587, 0.114)) * img.a;
  vec3 mixed = mix(img.rgb, vec3(grayscale), u_saturation);
  vec3 processed = mixed - mod(mixed, 1.0/u_steps);
  vec3 dither = step(limit, (mixed - processed) * u_steps) / u_steps;
  gl_FragColor = vec4(processed + dither, alpha);
}`;

const HALF_FRAG = `
precision highp float;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_size;
uniform float u_smooth;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_density;
uniform vec3 u_halfscale;
float sdCircle(vec2 p, vec2 c, float r){ return length(p - c) - r; }
void main(){
  vec2 coord = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  vec2 uv_texture = coord.xy / u_resolution;
  float alpha = texture2D(u_texture, uv_texture).a;
  vec2 pattern = (floor(coord / u_size) + 0.5) * vec2(u_size);
  vec4 img = (texture2D(u_texture, pattern / u_resolution).rgba - 0.5 + (u_brightness - 1.0)) * u_contrast + 0.5;
  float r = img.r * u_size * u_halfscale.r;
  float g = img.g * u_size * u_halfscale.g;
  float b = img.b * u_size * u_halfscale.b;
  vec3 dots = vec3(sdCircle(coord, pattern, r), sdCircle(coord, pattern, g), sdCircle(coord, pattern, b));
  vec3 col = smoothstep(0.0, -u_smooth * u_density, dots);
  float grayscale = dot(col, vec3(0.299, 0.587, 0.114)) * img.a;
  vec3 color = mix(col, vec3(grayscale), u_saturation);
  gl_FragColor = vec4(color, alpha);
}`;

const GRAD_FRAG = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D u_texture;
uniform sampler2D u_gradient;
void main(){
  vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
  float grayscale = texture2D(u_texture, uv).r;
  float alpha = texture2D(u_texture, uv).a;
  vec4 color = texture2D(u_gradient, vec2(grayscale, 0.5));
  gl_FragColor = vec4(color.rgb, alpha);
}`;

// Plain copy (WEBGL→WEBGL image() is unreliable across p5 buffers; a shader pass is not)
const PASS_FRAG = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D u_texture;
void main(){ gl_FragColor = texture2D(u_texture, vec2(vTexCoord.x, 1.0 - vTexCoord.y)); }`;

// CMYK rosette halftone — Stefan Gustavson, adapted Matt DesLauriers (MIT)
const CMYK_FRAG = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_size;
vec2 mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float aastep(float threshold, float value){ return step(threshold, value); }
vec3 halftone(vec3 texcolor, vec2 st, float frequency){
  float n = 0.1*snoise(st*600.0); n += 0.05*snoise(st*1200.0); n += 0.025*snoise(st*2400.0);
  vec3 black = vec3(n + 0.1);
  vec4 cmyk;
  cmyk.xyz = 1.0 - texcolor;
  cmyk.w = min(cmyk.x, min(cmyk.y, cmyk.z));
  cmyk.xyz -= cmyk.w;
  vec2 Kst = frequency*mat2(0.707, -0.707, 0.707, 0.707)*st;
  vec2 Kuv = 2.0*fract(Kst)-1.0;
  float k = aastep(0.0, sqrt(cmyk.w)-length(Kuv)+n);
  vec2 Cst = frequency*mat2(0.966, -0.259, 0.259, 0.966)*st;
  vec2 Cuv = 2.0*fract(Cst)-1.0;
  float c = aastep(0.0, sqrt(cmyk.x)-length(Cuv)+n);
  vec2 Mst = frequency*mat2(0.966, 0.259, -0.259, 0.966)*st;
  vec2 Muv = 2.0*fract(Mst)-1.0;
  float m = aastep(0.0, sqrt(cmyk.y)-length(Muv)+n);
  vec2 Yst = frequency*st;
  vec2 Yuv = 2.0*fract(Yst)-1.0;
  float y = aastep(0.0, sqrt(cmyk.z)-length(Yuv)+n);
  vec3 rgbscreen = 1.0 - 0.9*vec3(c,m,y) + n;
  return mix(rgbscreen, black, 0.85*k + 0.3*n);
}
void main(){
  vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
  float alpha = texture2D(u_texture, uv).a;
  vec4 img = (texture2D(u_texture, uv).rgba - 0.5 + (u_brightness - 1.0)) * u_contrast + 0.5;
  vec2 st = uv; st.x *= u_resolution.x / u_resolution.y;
  vec3 color = halftone(img.rgb, st, u_size);
  float grayscale = dot(color, vec3(0.299, 0.587, 0.114)) * img.a;
  vec3 finalColor = mix(color, vec3(grayscale), u_saturation);
  gl_FragColor = vec4(finalColor, alpha);
}`;

// ASCII — humanbydefinition (MIT) https://github.com/humanbydefinition/p5js-ascii-renderer
const ASCII_FRAG = `
precision highp float;
uniform sampler2D u_asciiTexture;
uniform sampler2D u_imageTexture;
uniform float u_asciiCols;
uniform float u_asciiRows;
uniform int u_totalChars;
uniform vec2 u_gridCells;
uniform vec2 u_gridOffset;
uniform vec2 u_gridSize;
uniform vec3 u_charColor;
uniform vec3 u_bgColor;
uniform int u_charColorMode;
uniform int u_bgColorMode;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_steps;
void main(){
  vec2 coord = (gl_FragCoord.xy - u_gridOffset * 0.5) / u_gridCells;
  coord.y = 1.0 - coord.y;
  vec2 gridCoord = coord * u_gridSize;
  vec2 cellCoord = floor(gridCoord);
  vec2 centerCoord = cellCoord + vec2(0.5);
  vec2 baseCoord = centerCoord / u_gridSize;
  float alpha = texture2D(u_imageTexture, baseCoord).a;
  vec3 imageColor = (texture2D(u_imageTexture, baseCoord).rgb - 0.5 + (u_brightness - 1.0)) * u_contrast + 0.5;
  float grayscale = dot(imageColor.rgb, vec3(0.299, 0.587, 0.114)) * alpha;
  vec3 imageMixed = mix(imageColor.rgb, vec3(grayscale), u_saturation);
  vec3 processed = imageMixed - mod(imageMixed, 1.0 / u_steps);
  float index = clamp(grayscale * float(u_totalChars), 0.0, float(u_totalChars - 1));
  int charIndex = int(index - mod(index, 1.0 / u_steps));
  int charCol = charIndex - int(u_asciiCols) * (charIndex / int(u_asciiCols));
  int charRow = charIndex / int(u_asciiCols);
  vec2 charCoord = vec2(float(charCol) / u_asciiCols, float(charRow) / u_asciiRows);
  vec2 fractCoord = fract(gridCoord) * vec2(1.0 / u_asciiCols, 1.0 / u_asciiRows);
  vec2 texCoord = charCoord + fractCoord;
  vec4 charColor = texture2D(u_asciiTexture, texCoord);
  vec4 finalColor = u_charColorMode == 0 ? vec4(processed.rgb * charColor.rgb, charColor.a) : vec4(u_charColor * charColor.rgb, charColor.a);
  vec4 finalMixed = u_bgColorMode == 0 ? mix(vec4(processed.rgb, 1.0), finalColor, charColor.a) : mix(vec4(u_bgColor, 1.0), finalColor, charColor.a);
  gl_FragColor = vec4(finalMixed.rgb, alpha);
}`;

/////////////////////////////////////////////////////////////////////////////
// Option maps + render-space ratios
/////////////////////////////////////////////////////////////////////////////
const RATIOS = {
  '2:1': [768, 384], '16:9': [768, 432], '3:2': [720, 480], '4:3': [720, 540],
  '5:4': [640, 512], '1:1': [640, 640], '4:5': [512, 640], '3:4': [540, 720],
  '2:3': [480, 720], '9:16': [432, 768], '1:2': [384, 768],
};
const RATIO_OPTS = Object.fromEntries(Object.keys(RATIOS).map((k) => [k, k]));
const SOURCE_OPTS = { '3D Object': 'object', Image: 'image' };
const SHAPE_OPTS = { Torus: 'torus', Sphere: 'sphere', Box: 'box', Cone: 'cone', Cylinder: 'cylinder' };
const DITHER_OPTS = { 'ASCII Characters': 'ascii', 'Halftone Basic': 'halftone', 'Halftone CMYK': 'halftoneCMYK', 'Bayer Matrix': 'matrix', 'Noise Textures': 'noise', None: 'none' };
const MATRIX_OPTS = { Pixel: 'pixel', Diagonal: 'diagonal', Checker: 'checker', Grid: 'grid', '2×2 Bayer': 'bayer2', '4×4 Bayer': 'bayer4', '8×8 Bayer': 'bayer8', '16×16 Bayer': 'bayer16' };
const NOISE_OPTS = { '16×16': 'noise16', '32×32': 'noise32', '64×64': 'noise64', '128×128': 'noise128' };
const ASCII_COLOR_OPTS = { 'Color Characters': 'chars', 'Color Background': 'background', 'Duotone': 'duotone' };
const COLOR_TYPE_OPTS = { 'Original Colors': 'original', 'Gradient Map': 'gradient' };
const ROTATE_OPTS = { Constant: 'constant', Oscillate: 'oscillate' };

/////////////////////////////////////////////////////////////////////////////
// Dither matrices (Bayer computed; small pattern maps are our own)
/////////////////////////////////////////////////////////////////////////////
function bayer(n) {
  if (n === 1) return [[0]];
  const h = bayer(n / 2), s = h.length, m = [];
  for (let y = 0; y < n; y++) { m[y] = []; for (let x = 0; x < n; x++) {
    const q = (y < s ? 0 : 2) + (x < s ? 0 : 1); // quadrant order 0,2 / 3,1
    const base = q === 0 ? 0 : q === 1 ? 2 : q === 2 ? 3 : 1;
    m[y][x] = 4 * h[y % s][x % s] + base;
  } }
  return m;
}
function bayerNorm(n) { const m = bayer(n), d = n * n; return m.map((r) => r.map((v) => (v + 0.5) / d)); }
const MATRICES = {
  pixel: [[0.48, 0.49], [0.5, 0.51]],
  diagonal: [[0.2, 0.5, 0.8, 0.5], [0.5, 0.2, 0.5, 0.8], [0.8, 0.5, 0.2, 0.5], [0.5, 0.8, 0.5, 0.2]],
  checker: [[0.85, 0.85, 0.15, 0.15], [0.85, 0.85, 0.15, 0.15], [0.15, 0.15, 0.85, 0.85], [0.15, 0.15, 0.85, 0.85]],
  grid: [[0.22, 0.85, 0.16], [0.8, 0.6, 0.88], [0.12, 0.82, 0.2]],
  bayer2: bayerNorm(2), bayer4: bayerNorm(4), bayer8: bayerNorm(8), bayer16: bayerNorm(16),
};

/////////////////////////////////////////////////////////////////////////////
// Palettes — original 5-colour sets (use flags allow duotone / 3-tone)
/////////////////////////////////////////////////////////////////////////////
const PALETTES = [
  { color: ['#2e3336', '#358e7e', '#e57e3a', '#f883d6', '#cad2d6'], use: [true, true, true, true, true] },
  { color: ['#0b0f1a', '#243b6b', '#3a86ff', '#8fd3ff', '#eaf6ff'], use: [true, true, true, true, true] },
  { color: ['#1a0d10', '#7a1f3d', '#d6376b', '#ffa1c2', '#ffe6ee'], use: [true, true, true, true, true] },
  { color: ['#0c1410', '#1f6f54', '#3fd99a', '#bdf5dc', '#ffffff'], use: [true, true, true, true, true] },
  { color: ['#120c1f', '#5a2ea6', '#a06bff', '#e0c3ff', '#ffffff'], use: [true, true, true, true, false] },
  { color: ['#1a1206', '#a85a12', '#f0a830', '#ffe08a', '#fff7e0'], use: [true, true, true, true, true] },
  { color: ['#0a0a0a', '#3a3a3a', '#8a8a8a', '#cccccc', '#ffffff'], use: [true, true, true, true, true] },
  { color: ['#06121a', '#0b6e8f', '#13c4d6', '#9bf0e8', '#f0ffff'], use: [true, true, true, false, false] },
  { color: ['#1b0a00', '#d63a1f', '#ff7b29', '#ffd25e', '#fff3c4'], use: [true, true, true, true, false] },
  { color: ['#101018', '#e63946', '#f1faee', '#a8dadc', '#457b9d'], use: [true, true, true, true, true] },
  { color: ['#0d0221', '#c2185b', '#ff5722', '#ffc107', '#fff8e1'], use: [false, true, true, true, false] },
  { color: ['#16161a', '#4b3f72', '#7d8cc4', '#b8c0e0', '#eef0f6'], use: [true, true, true, true, true] },
  { color: ['#011627', '#2ec4b6', '#e71d36', '#ff9f1c', '#fdfffc'], use: [true, true, true, true, true] },
  { color: ['#1d1a05', '#5c8001', '#bfd200', '#e9f5b0', '#ffffff'], use: [true, true, true, false, true] },
];

/////////////////////////////////////////////////////////////////////////////
// State
/////////////////////////////////////////////////////////////////////////////
const cnv = { ratio: '1:1', source: 'object', bg: '#0e0f17', transparent: false, animate: true, frame: 0 };
const obj = {
  shape: 'torus',
  rotation: { x: 0.5, y: 0.2 },
  scale: 1,
  light: {
    ambient: 45, specular: 200, shininess: 12,
    one: { color: '#ff0033', x: 0, y: 1, z: -1 },
    two: { color: '#00ff66', x: -0.1, y: 0, z: -0.1 },
    three: { color: '#1133ff', x: 0.5, y: 0, z: -0.5 },
  },
};
const motion = {
  rotate: { type: 'constant', angle: { x: 30, y: 45, z: 20 }, speed: { x: 0, y: 0.12, z: 0 } },
};
const ascii = { fontname: 'Silkscreen', text: '@%#*+=-:. ', scale: 10, cols: 1, rows: 1, ratio: 1, box: [1, 1], color: { limit: 6, mode: 'chars', char: '#e8ffe0', bg: '#06120a' } };
const dither = { type: 'matrix', matrix: 'bayer8', noise: 'noise64', texture: 1, scale: 2, step: 4, contrast: 1.15, brightness: 1, halftone: { scale: 6, scaleMin: 3, scaleMax: 24, smooth: 2, x: 1, y: 1, z: 1 } };
const gradient = { type: 'gradient', saturation: 1, palette: 1, reverse: false, color: { 0: '#2e3336', 1: '#358e7e', 2: '#e57e3a', 3: '#f883d6', 4: '#cad2d6' }, use: { 0: true, 1: true, 2: true, 3: true, 4: true } };
const rec = { frameRate: 60, length: { value: 6, min: 1, max: 60 } };
const DEFAULTS = structuredClone({ cnv, obj, motion, ascii, dither, gradient });

/////////////////////////////////////////////////////////////////////////////
// Runtime
/////////////////////////////////////////////////////////////////////////////
let P = null, displayCanvas = null, GW = 640, GH = 640, pendingPreset = null;
let gImg = null, dithBuffer = null, gradBuffer = null;
let dTexture = null, gTexture = null, asciiTexture = null;
let ditherShader = null, halftoneShader = null, cmykShader = null, gradientShader = null, asciiShader = null, dithPassShader = null, gradPassShader = null;
let asciiFont = null, userImage = null;
const ASCII_FONT_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@ec0464b978de222073645d6d3366f3fdf03376d8/ofl/silkscreen/Silkscreen-Regular.ttf';

const hexToShader = (hex) => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

/////////////////////////////////////////////////////////////////////////////
// Texture builders
/////////////////////////////////////////////////////////////////////////////
const curPD = () => (dithBuffer ? dithBuffer.pixelDensity() : 1);
function makeMatrixTexture() {
  const m = MATRICES[dither.matrix] || MATRICES.bayer8;
  const grid = m.length;
  const size = max(1, round(dither.scale * curPD()));
  const g = P.createGraphics(grid * size, grid * size);
  g.pixelDensity(1); g.noSmooth(); g.noStroke();
  for (let r = 0; r < grid; r++) for (let c = 0; c < grid; c++) { g.fill(m[r][c] * 255); g.rect(c * size, r * size, size, size); }
  return g;
}
function makeNoiseTexture() {
  const sizes = { noise16: 16, noise32: 32, noise64: 64, noise128: 128 };
  const n = sizes[dither.noise] || 64;
  const rng = alea(`${dither.noise}-${dither.texture}`);
  const size = max(1, round(dither.scale * curPD()));
  const g = P.createGraphics(n * size, n * size);
  g.pixelDensity(1); g.noSmooth(); g.noStroke();
  // value-noise-ish: average a few seeded white-noise samples for softer grain
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = rng();
    if (dither.texture % 2 === 0) v = (v + rng()) * 0.5; // smoother variants
    g.fill(v * 255); g.rect(x * size, y * size, size, size);
  }
  return g;
}
function createDitherTexture() {
  if (dTexture) dTexture.remove();
  dTexture = dither.type === 'noise' ? makeNoiseTexture() : dither.type === 'matrix' ? makeMatrixTexture() : null;
}

function createGradientTexture() {
  if (gTexture) gTexture.remove();
  const cols = [], used = [];
  for (let i = 0; i < 5; i++) { cols.push(gradient.color[i]); used.push(gradient.use[i]); }
  const amount = used.filter(Boolean).length || 1;
  gTexture = P.createGraphics(amount * 16, 1);
  gTexture.pixelDensity(1); gTexture.noStroke(); gTexture.rectMode(P.CENTER);
  gTexture.translate(gTexture.width * 0.5, gTexture.height * 0.5);
  if (gradient.reverse) gTexture.rotate(PI);
  const grad = gTexture.drawingContext.createLinearGradient(-gTexture.width / 2, 0, gTexture.width / 2, 0);
  let idx = 0;
  for (let i = 0; i < 5; i++) if (used[i]) { grad.addColorStop(amount === 1 ? 0 : idx / (amount - 1), cols[i]); idx++; }
  gTexture.drawingContext.fillStyle = grad;
  gTexture.rect(0, 0, gTexture.width, gTexture.height);
}

function glyphBox() {
  if (!asciiFont) { ascii.box = [1, 1]; ascii.ratio = 1; return; }
  let mw = 0, mh = 0;
  for (const ch of ascii.text) {
    const b = asciiFont.textBounds(ch === ' ' ? '.' : ch, 0, 0, 256);
    if (b.w > mw) mw = b.w; if (b.h > mh) mh = b.h;
  }
  ascii.box = [max(1, ceil(mw)), max(1, ceil(mh))];
  ascii.ratio = ascii.box[0] / ascii.box[1];
}
function createAsciiTexture() {
  if (asciiTexture) asciiTexture.remove();
  const text = ascii.text.length ? ascii.text : ' ';
  ascii.cols = max(1, ceil(sqrt(text.length)));
  ascii.rows = max(1, ceil(text.length / ascii.cols));
  asciiTexture = P.createGraphics(max(1, ascii.box[0] * ascii.cols), max(1, ascii.box[1] * ascii.rows));
  asciiTexture.pixelDensity(1); asciiTexture.noSmooth(); asciiTexture.noStroke(); asciiTexture.fill(255);
  if (asciiFont) asciiTexture.textFont(asciiFont);
  asciiTexture.textSize(256); asciiTexture.textAlign(P.LEFT, P.TOP);
  for (let i = 0; i < text.length; i++) {
    const col = i % ascii.cols, row = floor(i / ascii.cols);
    asciiTexture.text(text[i], ascii.box[0] * col, ascii.box[1] * row);
  }
}
function rebuildAscii() { glyphBox(); createAsciiTexture(); }

/////////////////////////////////////////////////////////////////////////////
// Source render — lit 3D primitive (or a dropped image)
/////////////////////////////////////////////////////////////////////////////
function renderSource() {
  gImg.reset(); gImg.clear();
  if (!cnv.transparent) gImg.background(cnv.bg);
  if (cnv.source === 'image' && userImage) {
    const s = min(gImg.width / userImage.width, gImg.height / userImage.height);
    gImg.push(); gImg.noLights(); gImg.texture(userImage); gImg.noStroke();
    gImg.plane(userImage.width * s, userImage.height * s); gImg.pop();
    return;
  }
  // 3D object
  const f = cnv.frame;
  gImg.push();
  gImg.ambientLight(obj.light.ambient);
  gImg.directionalLight(P.color(obj.light.one.color), obj.light.one.x, obj.light.one.y, obj.light.one.z);
  gImg.directionalLight(P.color(obj.light.two.color), obj.light.two.x, obj.light.two.y, obj.light.two.z);
  gImg.directionalLight(P.color(obj.light.three.color), obj.light.three.x, obj.light.three.y, obj.light.three.z);
  gImg.noStroke();
  gImg.fill(235);                          // light diffuse surface → colored lights tint it
  gImg.ambientMaterial(255);
  gImg.specularMaterial(obj.light.specular);
  gImg.shininess(obj.light.shininess);
  const base = min(gImg.width, gImg.height) * 0.28 * obj.scale;
  gImg.rotateX(obj.rotation.x); gImg.rotateY(obj.rotation.y);
  if (motion.rotate.type === 'constant') {
    gImg.rotateX(TWO_PI * f * map(motion.rotate.speed.x, -1, 1, -0.01, 0.01));
    gImg.rotateY(TWO_PI * f * map(motion.rotate.speed.y, -1, 1, -0.01, 0.01));
    gImg.rotateZ(TWO_PI * f * map(motion.rotate.speed.z, -1, 1, -0.01, 0.01));
  } else {
    gImg.rotateX(sin(TWO_PI * f * motion.rotate.speed.x * 0.01) * radians(motion.rotate.angle.x));
    gImg.rotateY(sin(TWO_PI * f * motion.rotate.speed.y * 0.01) * radians(motion.rotate.angle.y));
    gImg.rotateZ(sin(TWO_PI * f * motion.rotate.speed.z * 0.01) * radians(motion.rotate.angle.z));
  }
  if (obj.shape === 'torus') gImg.torus(base, base * 0.42, 48, 24);
  else if (obj.shape === 'sphere') gImg.sphere(base, 48, 32);
  else if (obj.shape === 'box') gImg.box(base * 1.4);
  else if (obj.shape === 'cone') gImg.cone(base, base * 1.8, 32);
  else gImg.cylinder(base * 0.9, base * 1.6, 32);
  gImg.pop();
}

/////////////////////////////////////////////////////////////////////////////
// Pipeline
/////////////////////////////////////////////////////////////////////////////
function fullRect(buf) { buf.push(); buf.noStroke(); buf.rect(0, 0, buf.width, buf.height); buf.pop(); }

function runDither() {
  const contrast = dither.contrast <= 1 ? map(dither.contrast, 0.5, 1, 0.25, 1) : map(dither.contrast, 1, 4, 1, 12);
  const saturation = gradient.type !== 'original' ? 1 : map(gradient.saturation, 0, 1, 1, 0);
  const step = 0.2 + dither.step * 0.1;
  const pd = dithBuffer.pixelDensity();
  const res = [dithBuffer.width * pd, dithBuffer.height * pd];
  dithBuffer.clear();

  if (dither.type === 'none') { dithBuffer.shader(dithPassShader); dithPassShader.setUniform('u_texture', gImg); fullRect(dithBuffer); return; }

  if (dither.type === 'ascii') {
    const charMode = ascii.color.mode !== 'background';
    const bgMode = ascii.color.mode !== 'chars';
    let sx = ascii.scale, sy = ascii.scale;
    if (ascii.box[0] !== ascii.box[1]) sx = floor(ascii.scale * ascii.ratio);
    const modX = gImg.width % sx, modY = gImg.height % sy;
    const gridSize = [(gImg.width - modX) / sx, (gImg.height - modY) / sy];
    const s = asciiShader;
    dithBuffer.shader(s);
    s.setUniform('u_asciiTexture', asciiTexture);
    s.setUniform('u_imageTexture', gImg);
    s.setUniform('u_asciiCols', ascii.cols);
    s.setUniform('u_asciiRows', ascii.rows);
    s.setUniform('u_totalChars', max(1, (ascii.text.length || 1)));
    s.setUniform('u_gridOffset', [modX * pd, modY * pd]);
    s.setUniform('u_gridCells', [sx * gridSize[0] * pd, sy * gridSize[1] * pd]);
    s.setUniform('u_gridSize', gridSize);
    s.setUniform('u_charColor', hexToShader(ascii.color.char));
    s.setUniform('u_bgColor', hexToShader(ascii.color.bg));
    s.setUniform('u_charColorMode', charMode ? 1 : 0);
    s.setUniform('u_bgColorMode', bgMode ? 1 : 0);
    s.setUniform('u_contrast', contrast); s.setUniform('u_brightness', dither.brightness); s.setUniform('u_saturation', saturation);
    s.setUniform('u_steps', max(1, ascii.color.limit - 1));
    fullRect(dithBuffer); return;
  }

  if (dither.type === 'halftoneCMYK') {
    const sz = map2(dither.halftone.scale, dither.halftone.scaleMin, dither.halftone.scaleMax, 500, 5, 'Exponential', 1);
    const s = cmykShader;
    dithBuffer.shader(s);
    s.setUniform('u_texture', gImg); s.setUniform('u_resolution', res); s.setUniform('u_size', sz);
    s.setUniform('u_brightness', dither.brightness); s.setUniform('u_contrast', contrast); s.setUniform('u_saturation', saturation);
    fullRect(dithBuffer); return;
  }

  if (dither.type === 'halftone') {
    const s = halftoneShader;
    dithBuffer.shader(s);
    s.setUniform('u_texture', gImg); s.setUniform('u_resolution', res); s.setUniform('u_density', pd);
    s.setUniform('u_size', dither.halftone.scale * pd);
    s.setUniform('u_halfscale', [dither.halftone.x, dither.halftone.y, dither.halftone.z]);
    s.setUniform('u_smooth', dither.halftone.smooth);
    s.setUniform('u_brightness', dither.brightness); s.setUniform('u_contrast', contrast); s.setUniform('u_saturation', saturation);
    fullRect(dithBuffer); return;
  }

  // matrix / noise → ordered dither texture
  if (!dTexture) createDitherTexture();
  const s = ditherShader;
  dithBuffer.shader(s);
  s.setUniform('u_texture', gImg); s.setUniform('u_resolution', res);
  s.setUniform('u_dither_tex', dTexture); s.setUniform('u_dither_size', [dTexture.width, dTexture.height]);
  s.setUniform('u_density', pd); s.setUniform('u_scale', dither.scale * pd); s.setUniform('u_steps', step);
  s.setUniform('u_contrast', contrast); s.setUniform('u_brightness', dither.brightness); s.setUniform('u_saturation', saturation);
  fullRect(dithBuffer);
}

function runGradient() {
  gradBuffer.clear();
  if (gradient.type === 'gradient') {
    const s = gradientShader;
    gradBuffer.shader(s);
    s.setUniform('u_texture', dithBuffer); s.setUniform('u_gradient', gTexture);
    fullRect(gradBuffer);
  } else {
    gradBuffer.shader(gradPassShader); gradPassShader.setUniform('u_texture', dithBuffer); fullRect(gradBuffer);
  }
}

/////////////////////////////////////////////////////////////////////////////
// Sketch
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'DITHR', version: '0.2' });

function fitCanvas() {
  if (!displayCanvas) return;
  const pad = 40;
  const k = min((window.innerWidth - pad * 2) / GW, (window.innerHeight - pad * 2) / GH);
  displayCanvas.elt.style.width = `${GW * k}px`;
  displayCanvas.elt.style.height = `${GH * k}px`;
}
function releaseGraphics(g) {
  if (!g) return;
  try { const gl = g._renderer && (g._renderer.GL || g._renderer.drawingContext); if (gl && gl.getExtension) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } } catch (e) { /* best effort */ }
  if (g.remove) g.remove();
}
function makeBuffers() {
  for (const b of [gImg, dithBuffer, gradBuffer]) releaseGraphics(b);
  gImg = P.createGraphics(GW, GH, P.WEBGL); gImg.pixelDensity(1); gImg.noStroke();
  dithBuffer = P.createGraphics(GW, GH, P.WEBGL); dithBuffer.pixelDensity(1); dithBuffer.noStroke(); dithBuffer.textureWrap(P.REPEAT);
  gradBuffer = P.createGraphics(GW, GH, P.WEBGL); gradBuffer.pixelDensity(1); gradBuffer.noStroke();
  asciiShader = dithBuffer.createShader(VERT, ASCII_FRAG);
  halftoneShader = dithBuffer.createShader(VERT, HALF_FRAG);
  cmykShader = dithBuffer.createShader(VERT, CMYK_FRAG);
  ditherShader = dithBuffer.createShader(VERT, DITH_FRAG);
  dithPassShader = dithBuffer.createShader(VERT, PASS_FRAG);
  gradientShader = gradBuffer.createShader(VERT, GRAD_FRAG);
  gradPassShader = gradBuffer.createShader(VERT, PASS_FRAG);
  createDitherTexture(); createGradientTexture();
}
function applyRatio() {
  const [w, h] = RATIOS[cnv.ratio];
  const changed = w !== GW || h !== GH || !gImg;
  GW = w; GH = h;
  if (P && changed) { P.resizeCanvas(GW, GH); makeBuffers(); }
  fitCanvas();
}

tool.startSketch((p) => {
  p.setup = () => {
    P = p;
    tool.canvasHost.style.display = 'flex';
    tool.canvasHost.style.alignItems = 'center';
    tool.canvasHost.style.justifyContent = 'center';
    [GW, GH] = RATIOS[cnv.ratio];
    displayCanvas = p.createCanvas(GW, GH, p.WEBGL);
    p.setAttributes('preserveDrawingBuffer', true);
    p.pixelDensity(1);
    displayCanvas.elt.style.display = 'block';
    p.noStroke(); p.imageMode(p.CORNER);
    cnv.source = 'object';
    makeBuffers();
    fitCanvas();
    p.loadFont(ASCII_FONT_URL, (f) => { asciiFont = f; rebuildAscii(); }, () => { rebuildAscii(); });
    rebuildAscii();
  };
  p.draw = () => {
    if (pendingPreset && asciiFont !== undefined) { const n = pendingPreset; pendingPreset = null; applyPreset(n); return; }
    if (!gImg) return;
    renderSource();
    runDither();
    runGradient();
    p.clear();
    p.push(); p.translate(-p.width / 2, -p.height / 2); p.image(gradBuffer, 0, 0, p.width, p.height); p.pop();
    if (cnv.animate) cnv.frame++;
  };
  p.windowResized = () => fitCanvas();
});

/////////////////////////////////////////////////////////////////////////////
// Drag-drop — an image becomes the source
/////////////////////////////////////////////////////////////////////////////
tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file || !/^image\//i.test(file.type)) return;
  const url = URL.createObjectURL(file);
  P.loadImage(url, (im) => { userImage = im; cnv.source = 'image'; sourceUI(); tool.pane.refresh(); URL.revokeObjectURL(url); }, () => URL.revokeObjectURL(url));
});

/////////////////////////////////////////////////////////////////////////////
// UI
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;
const onDitherTex = () => { if (P) createDitherTexture(); };
const onPalette = () => { if (P) createGradientTexture(); };
const onAscii = () => { if (P) rebuildAscii(); };

main.addButton({ title: 'Restart Preset' }).on('click', () => applyPreset(presetState.name));

const fCanvas = main.addFolder({ title: 'CANVAS', expanded: false });
fCanvas.addBinding(cnv, 'ratio', { label: 'Ratio', options: RATIO_OPTS }).on('change', applyRatio);
fCanvas.addBinding(cnv, 'bg', { label: 'Back Color', view: 'color' });
fCanvas.addBinding(cnv, 'transparent', { label: 'Transparency' });

const fSource = main.addFolder({ title: 'SOURCE' });
fSource.addBinding(cnv, 'source', { label: 'Source', options: SOURCE_OPTS }).on('change', sourceUI);
const sShape = fSource.addBinding(obj, 'shape', { label: 'Shape', options: SHAPE_OPTS });
const sScale = fSource.addBinding(obj, 'scale', { label: 'Scale', min: 0.4, max: 2, step: 0.01 });
const sSpec = fSource.addBinding(obj.light, 'specular', { label: 'Specular', min: 0, max: 255, step: 1 });
const sAmb = fSource.addBinding(obj.light, 'ambient', { label: 'Ambient', min: 0, max: 100, step: 1 });
const sL1 = fSource.addBinding(obj.light.one, 'color', { label: 'Light 1', view: 'color' });
const sL2 = fSource.addBinding(obj.light.two, 'color', { label: 'Light 2', view: 'color' });
const sL3 = fSource.addBinding(obj.light.three, 'color', { label: 'Light 3', view: 'color' });
const sRotType = fSource.addBinding(motion.rotate, 'type', { label: 'Spin Type', options: ROTATE_OPTS });
const sSpin = fSource.addBinding(motion.rotate.speed, 'y', { label: 'Spin Speed', min: -1, max: 1, step: 0.01 });

const fDither = main.addFolder({ title: 'DITHER' });
fDither.addBinding(dither, 'type', { label: 'Dither Type', options: DITHER_OPTS }).on('change', () => { onDitherTex(); ditherUI(); });
const dMatrix = fDither.addBinding(dither, 'matrix', { label: 'Matrix', options: MATRIX_OPTS }).on('change', onDitherTex);
const dNoise = fDither.addBinding(dither, 'noise', { label: 'Noise Size', options: NOISE_OPTS }).on('change', onDitherTex);
const dTex = fDither.addBinding(dither, 'texture', { label: 'Variant', min: 1, max: 4, step: 1 }).on('change', onDitherTex);
const dScale = fDither.addBinding(dither, 'scale', { label: 'Dither Scale', min: 1, max: 24, step: 1 }).on('change', onDitherTex);
const aText = fDither.addBinding(ascii, 'text', { label: 'ASCII Chars' }).on('change', onAscii);
const aScale = fDither.addBinding(ascii, 'scale', { label: 'ASCII Scale', min: 4, max: 64, step: 2 });
const aMode = fDither.addBinding(ascii.color, 'mode', { label: 'Base Colors', options: ASCII_COLOR_OPTS }).on('change', ditherUI);
const aChar = fDither.addBinding(ascii.color, 'char', { label: 'Characters', view: 'color' });
const aBg = fDither.addBinding(ascii.color, 'bg', { label: 'Background', view: 'color' });
const hScale = fDither.addBinding(dither.halftone, 'scale', { label: 'Dot Scale', min: dither.halftone.scaleMin, max: dither.halftone.scaleMax, step: 0.1 });
const hSmooth = fDither.addBinding(dither.halftone, 'smooth', { label: 'Dot Smooth', min: 0.5, max: 5, step: 0.1 });

const fLevels = main.addFolder({ title: 'LEVELS', expanded: false });
const lStep = fLevels.addBinding(dither, 'step', { label: 'Posterize', min: 1, max: 64, step: 1 });
const lLimit = fLevels.addBinding(ascii.color, 'limit', { label: 'ASCII Limit', min: 2, max: 16, step: 1 });
fLevels.addBinding(dither, 'brightness', { label: 'Brightness', min: 0.5, max: 1.5, step: 0.01 });
fLevels.addBinding(dither, 'contrast', { label: 'Contrast', min: 0.5, max: 4, step: 0.01 });

const fColor = main.addFolder({ title: 'COLOR' });
fColor.addBinding(gradient, 'type', { label: 'Color Type', options: COLOR_TYPE_OPTS }).on('change', () => { colorUI(); });
const cSat = fColor.addBinding(gradient, 'saturation', { label: 'Saturation', min: 0, max: 1, step: 0.01 });
const cPal = fColor.addBinding(gradient, 'palette', { label: 'Palette', min: 1, max: PALETTES.length, step: 1 }).on('change', () => { applyPalette(); });
const cRev = fColor.addBinding(gradient, 'reverse', { label: 'Reverse' }).on('change', onPalette);
const cColors = [];
for (let i = 0; i < 5; i++) {
  cColors.push(fColor.addBinding(gradient.use, String(i), { label: `Use ${i + 1}` }).on('change', onPalette));
  cColors.push(fColor.addBinding(gradient.color, String(i), { label: `Color ${i + 1}`, view: 'color' }).on('change', onPalette));
}

function sourceUI() {
  const obj3d = cnv.source === 'object';
  for (const b of [sShape, sScale, sSpec, sAmb, sL1, sL2, sL3, sRotType, sSpin]) b.hidden = !obj3d;
}
function ditherUI() {
  const t = dither.type;
  dMatrix.hidden = t !== 'matrix';
  dNoise.hidden = t !== 'noise'; dTex.hidden = t !== 'noise';
  dScale.hidden = !(t === 'matrix' || t === 'noise');
  const isAscii = t === 'ascii';
  aText.hidden = !isAscii; aScale.hidden = !isAscii; aMode.hidden = !isAscii;
  aChar.hidden = !(isAscii && ascii.color.mode !== 'background');
  aBg.hidden = !(isAscii && ascii.color.mode !== 'chars');
  const isHalf = t === 'halftone' || t === 'halftoneCMYK';
  hScale.hidden = !isHalf; hSmooth.hidden = t !== 'halftone';
  lStep.hidden = isAscii; lLimit.hidden = !isAscii;
}
function colorUI() {
  const grad = gradient.type === 'gradient';
  cSat.hidden = grad; cPal.hidden = !grad; cRev.hidden = !grad;
  for (const b of cColors) b.hidden = !grad;
}

/////////////////////////////////////////////////////////////////////////////
// Palette + presets
/////////////////////////////////////////////////////////////////////////////
function applyPalette() {
  const p = PALETTES[(gradient.palette - 1 + PALETTES.length) % PALETTES.length];
  for (let i = 0; i < 5; i++) { gradient.color[i] = p.color[i]; gradient.use[i] = p.use[i]; }
  createGradientTexture();
  tool.pane.refresh();
}

const presets = {
  'Spectral Torus': {
    cnv: { ratio: '1:1', bg: '#0b0c14', source: 'object' },
    obj: { shape: 'torus', scale: 1.1, light: { ambient: 40, specular: 220, one: { color: '#ff0033' }, two: { color: '#00ff7b' }, three: { color: '#2a5bff' } } },
    motion: { rotate: { type: 'constant', speed: { x: 0, y: 0.12, z: 0 } } },
    dither: { type: 'matrix', matrix: 'bayer8', scale: 2, step: 4, contrast: 1.2, brightness: 1 },
    gradient: { type: 'gradient', palette: 2, reverse: false },
  },
  'Coarse Halftone': {
    cnv: { ratio: '1:1', bg: '#e8e4d8', source: 'object' },
    obj: { shape: 'sphere', scale: 1.2, light: { ambient: 26, specular: 200, one: { color: '#ff5a3c' }, two: { color: '#3a6bff' }, three: { color: '#10131c' } } },
    motion: { rotate: { type: 'constant', speed: { x: 0.05, y: 0.1, z: 0 } } },
    dither: { type: 'halftone', scale: 1, step: 4, contrast: 1.5, brightness: 0.95, halftone: { scale: 7, smooth: 2, x: 1, y: 1, z: 1 } },
    gradient: { type: 'original', saturation: 0.25 },
  },
  'CMYK Press': {
    cnv: { ratio: '1:1', bg: '#ffffff', source: 'object' },
    obj: { shape: 'torus', scale: 1, light: { ambient: 55, specular: 180, one: { color: '#ff2244' }, two: { color: '#22dd66' }, three: { color: '#3355ff' } } },
    motion: { rotate: { type: 'constant', speed: { x: 0, y: 0.08, z: 0.03 } } },
    dither: { type: 'halftoneCMYK', contrast: 1.2, brightness: 1.05, halftone: { scale: 10 } },
    gradient: { type: 'original', saturation: 1 },
  },
  'Terminal Glyphs': {
    cnv: { ratio: '16:9', bg: '#04100a', source: 'object' },
    obj: { shape: 'box', scale: 1, light: { ambient: 50, specular: 200, one: { color: '#7CFC98' }, two: { color: '#0aff8a' }, three: { color: '#1133ff' } } },
    motion: { rotate: { type: 'constant', speed: { x: 0.04, y: 0.09, z: 0 } } },
    dither: { type: 'ascii', contrast: 1.3, brightness: 1 },
    ascii: { text: '@#W*+=-:. ', scale: 12, color: { limit: 8, mode: 'chars', char: '#7CFC98', bg: '#04100a' } },
    gradient: { type: 'original', saturation: 1 },
  },
  'Blue Noise Grain': {
    cnv: { ratio: '1:1', bg: '#0a0a12', source: 'object' },
    obj: { shape: 'sphere', scale: 1.1, light: { ambient: 35, specular: 230, one: { color: '#ff7b00' }, two: { color: '#ff00aa' }, three: { color: '#2a5bff' } } },
    motion: { rotate: { type: 'constant', speed: { x: 0, y: 0.1, z: 0 } } },
    dither: { type: 'noise', noise: 'noise64', texture: 1, scale: 2, step: 3, contrast: 1.25, brightness: 1 },
    gradient: { type: 'gradient', palette: 9, reverse: false },
  },
  'Diagonal Duotone': {
    cnv: { ratio: '4:5', bg: '#101018', source: 'object' },
    obj: { shape: 'cone', scale: 1.05, light: { ambient: 45, specular: 200, one: { color: '#ff0055' }, two: { color: '#00e1ff' }, three: { color: '#ffffff' } } },
    motion: { rotate: { type: 'oscillate', angle: { x: 20, y: 40, z: 10 }, speed: { x: 0.2, y: 0.3, z: 0 } } },
    dither: { type: 'matrix', matrix: 'diagonal', scale: 3, step: 2, contrast: 1.4, brightness: 1.05 },
    gradient: { type: 'gradient', palette: 8, reverse: false },
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
  deepMerge(obj, structuredClone(DEFAULTS.obj));
  deepMerge(motion, structuredClone(DEFAULTS.motion));
  deepMerge(ascii, structuredClone(DEFAULTS.ascii));
  deepMerge(dither, structuredClone(DEFAULTS.dither));
  deepMerge(gradient, structuredClone(DEFAULTS.gradient));
}
function applyPreset(name) {
  const pr = typeof name === 'string' ? presets[name] : name;
  if (!pr) return;
  resetToDefaults();
  for (const key of ['cnv', 'obj', 'motion', 'ascii', 'dither', 'gradient']) if (pr[key]) deepMerge({ cnv, obj, motion, ascii, dither, gradient }[key], pr[key]);
  cnv.frame = 0;
  if (P && (RATIOS[cnv.ratio][0] !== GW || RATIOS[cnv.ratio][1] !== GH)) applyRatio();
  if (gradient.type === 'gradient' && pr.gradient && pr.gradient.palette) applyPalette();
  else createGradientTexture();
  if (P) { createDitherTexture(); rebuildAscii(); }
  sourceUI(); ditherUI(); colorUI(); tool.pane.refresh();
}

/////////////////////////////////////////////////////////////////////////////
// Export + OPTIONS + dev hook
/////////////////////////////////////////////////////////////////////////////
attachExport(tool.pages.export, { getCanvas: tool.getCanvas, name: 'dithr' });

const presetState = { name: 'Spectral Torus' };
const opts = tool.pages.options;
opts.addBinding(presetState, 'name', { label: 'Preset', options: Object.fromEntries(Object.keys(presets).map((k) => [k, k])) }).on('change', (ev) => applyPreset(ev.value));
opts.addButton({ title: 'Apply / Restart Preset' }).on('click', () => applyPreset(presetState.name));
opts.addBinding(cnv, 'animate', { label: 'Animate' }).on('change', () => { cnv.frame = 0; });
opts.addBinding(rec.length, 'value', { label: 'Loop Length', min: rec.length.min, max: rec.length.max, step: 1 });
opts.addButton({ title: 'Fullscreen (f)' }).on('click', () => tool.toggleFullscreen());

window.addEventListener('resize', fitCanvas);
exposeDebug('dithr', {
  applyPreset, applyPalette, cnv, obj, motion, ascii, dither, gradient, rec, presets,
  setFrame: (f) => { cnv.frame = f; }, get userImage() { return userImage; },
});

cnv.source = 'object';
sourceUI(); ditherUI(); colorUI();
pendingPreset = 'Spectral Torus';
