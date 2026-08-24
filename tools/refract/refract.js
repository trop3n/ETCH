// REFRACT — image displacement + grid refraction via a GLSL fragment shader.
// Box (cell hash), Flow (FBM simplex), and Sine displacement modes, plus an
// optional grid lens, mirror-wrapped at the edges. Runs on p5.js WebGL; the
// shader logic is adapted from the repo's raw-WebGL refract tool into a single
// combined pass. First shader tool on the Etch stack (unlocks BLUUR, DITHR).
import { createTool } from '../../js/etch/shell.js';
import { attachPresets } from '../../js/etch/presets.js';
import { attachExport } from '../../js/etch/export.js';

const params = {
  displaceMode: 'box', seed: 601, contentScaleX: 1, contentScaleY: 1, animate: false,
  boxAmpX: 3, boxAmpY: 3, boxFreqX: 8, boxFreqY: 8, boxSpeedX: 0, boxSpeedY: 0,
  flowComplexity: 3, flowFreq: 3, flowAmpX: 5, flowAmpY: 5, flowSpeedX: 0, flowSpeedY: 0,
  sineAmpX: 3, sineAmpY: 3, sineFreqX: 8, sineFreqY: 8, sineSpeedX: 0, sineSpeedY: 0,
  refractMode: 'off', gridAmtX: 20, gridAmtY: 20, skewX: 1.25, skewY: 1.25,
};

const VERT = `
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  vec4 pos = vec4(aPosition, 1.0);
  pos.xy = pos.xy * 2.0 - 1.0;
  gl_Position = pos;
}`;

const FRAG = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D uTex;
uniform float uTime, uSeed, uCSX, uCSY;
uniform int uMode, uGrid, uFlowComplexity;
uniform float uBoxAmpX, uBoxAmpY, uBoxFreqX, uBoxFreqY, uBoxSpeedX, uBoxSpeedY;
uniform float uFlowFreq, uFlowAmpX, uFlowAmpY, uFlowSpeedX, uFlowSpeedY;
uniform float uSineAmpX, uSineAmpY, uSineFreqX, uSineFreqY, uSineSpeedX, uSineSpeedY;
uniform float uGridX, uGridY, uSkewX, uSkewY;

vec2 mirrorWrap(vec2 uv) { return abs(mod(uv - 1.0, 2.0) - 1.0); }
vec3 _p(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = _p(_p(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p, int oct) {
  float val = 0.0, amp = 0.5, frq = 1.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; val += amp * snoise(p * frq); amp *= 0.5; frq *= 2.0; }
  return val;
}
float cellHash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = vTexCoord;
  if (uGrid == 1) {
    vec2 cs = vec2(1.0 / uGridX, 1.0 / uGridY);
    vec2 ci = floor(uv / cs);
    vec2 cu = fract(uv / cs);
    vec2 fc = cu - 0.5;
    vec2 lens = fc * length(fc) * vec2(uSkewX, uSkewY);
    uv = (ci + cu + lens) * cs;
  }
  vec2 base = vec2(uv.x, 1.0 - uv.y);
  vec2 scaled = (base - 0.5) / vec2(uCSX, uCSY) + 0.5;
  vec2 disp = vec2(0.0);
  if (uMode == 0) {
    vec2 sh = base + vec2(uTime * uBoxSpeedX * 0.002, uTime * uBoxSpeedY * 0.002);
    vec2 cell = floor(sh * vec2(uBoxFreqX, uBoxFreqY));
    float hx = cellHash(cell + uSeed) * 2.0 - 1.0;
    float hy = cellHash(cell + uSeed + 31.41) * 2.0 - 1.0;
    disp = vec2(hx * uBoxAmpX, hy * uBoxAmpY);
  } else if (uMode == 1) {
    vec2 p = base * uFlowFreq + vec2(uTime * uFlowSpeedX * 0.002, uTime * uFlowSpeedY * 0.002) + uSeed * 0.01;
    disp = vec2(fbm(p, uFlowComplexity) * uFlowAmpX, fbm(p + vec2(31.41, 17.32), uFlowComplexity) * uFlowAmpY);
  } else {
    disp = vec2(sin(base.x * uSineFreqX + uTime * uSineSpeedX * 0.05) * uSineAmpX,
                sin(base.y * uSineFreqY + uTime * uSineSpeedY * 0.05) * uSineAmpY);
  }
  gl_FragColor = texture2D(uTex, mirrorWrap(scaled + disp));
}`;

const tool = createTool({ name: 'REFRACT', version: '0.1' });
let prog = null, srcImg = null, t = 0;

function makeDefault(p) {
  const g = p.createGraphics(800, 600);
  const ctx = g.drawingContext;
  const grad = ctx.createLinearGradient(0, 0, 800, 600);
  grad.addColorStop(0, '#1a1a2e'); grad.addColorStop(0.3, '#16213e'); grad.addColorStop(0.5, '#0f3460'); grad.addColorStop(0.7, '#533483'); grad.addColorStop(1, '#e94560');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 800, 600);
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * 800, y = Math.random() * 600, r = 30 + Math.random() * 90;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `hsla(${Math.random() * 360},70%,60%,0.7)`); rg.addColorStop(1, 'transparent');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
  for (let x = 0; x <= 800; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 600); ctx.stroke(); }
  for (let y = 0; y <= 600; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(800, y); ctx.stroke(); }
  return g;
}

function setUniforms(p) {
  const s = prog;
  s.setUniform('uTex', srcImg);
  s.setUniform('uTime', t);
  s.setUniform('uSeed', params.seed);
  s.setUniform('uCSX', params.contentScaleX);
  s.setUniform('uCSY', params.contentScaleY);
  s.setUniform('uMode', params.displaceMode === 'box' ? 0 : params.displaceMode === 'flow' ? 1 : 2);
  s.setUniform('uGrid', params.refractMode === 'grid' ? 1 : 0);
  s.setUniform('uBoxAmpX', params.boxAmpX); s.setUniform('uBoxAmpY', params.boxAmpY);
  s.setUniform('uBoxFreqX', params.boxFreqX); s.setUniform('uBoxFreqY', params.boxFreqY);
  s.setUniform('uBoxSpeedX', params.boxSpeedX); s.setUniform('uBoxSpeedY', params.boxSpeedY);
  s.setUniform('uFlowComplexity', params.flowComplexity); s.setUniform('uFlowFreq', params.flowFreq);
  s.setUniform('uFlowAmpX', params.flowAmpX); s.setUniform('uFlowAmpY', params.flowAmpY);
  s.setUniform('uFlowSpeedX', params.flowSpeedX); s.setUniform('uFlowSpeedY', params.flowSpeedY);
  s.setUniform('uSineAmpX', params.sineAmpX); s.setUniform('uSineAmpY', params.sineAmpY);
  s.setUniform('uSineFreqX', params.sineFreqX); s.setUniform('uSineFreqY', params.sineFreqY);
  s.setUniform('uSineSpeedX', params.sineSpeedX); s.setUniform('uSineSpeedY', params.sineSpeedY);
  s.setUniform('uGridX', params.gridAmtX); s.setUniform('uGridY', params.gridAmtY);
  s.setUniform('uSkewX', params.skewX); s.setUniform('uSkewY', params.skewY);
}

const p5i = tool.startSketch((p) => {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    p.setAttributes('preserveDrawingBuffer', true);
    p.noStroke();
    p.pixelDensity(1);
    prog = p.createShader(VERT, FRAG);
    srcImg = makeDefault(p);
  };
  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);
  p.draw = () => {
    if (!prog || !srcImg) return;
    if (params.animate) t += p.deltaTime;
    p.shader(prog);
    setUniforms(p);
    p.rect(0, 0, p.width, p.height);
  };
});

// ---- UI ----
const main = tool.pages.main;
const fD = main.addFolder({ title: 'Displace' });
fD.addBinding(params, 'displaceMode', { label: 'mode', options: { Box: 'box', Flow: 'flow', Sine: 'sine' } });
fD.addBinding(params, 'seed', { min: 0, max: 1000, step: 1 });
fD.addBinding(params, 'contentScaleX', { label: 'scale X', min: 0.1, max: 3, step: 0.05 });
fD.addBinding(params, 'contentScaleY', { label: 'scale Y', min: 0.1, max: 3, step: 0.05 });
fD.addBinding(params, 'animate');

const fBox = main.addFolder({ title: 'Box' });
fBox.addBinding(params, 'boxAmpX', { label: 'amp X', min: 0, max: 20, step: 0.1 });
fBox.addBinding(params, 'boxAmpY', { label: 'amp Y', min: 0, max: 20, step: 0.1 });
fBox.addBinding(params, 'boxFreqX', { label: 'freq X', min: 1, max: 40, step: 1 });
fBox.addBinding(params, 'boxFreqY', { label: 'freq Y', min: 1, max: 40, step: 1 });
fBox.addBinding(params, 'boxSpeedX', { label: 'speed X', min: 0, max: 100, step: 1 });
fBox.addBinding(params, 'boxSpeedY', { label: 'speed Y', min: 0, max: 100, step: 1 });

const fFlow = main.addFolder({ title: 'Flow', expanded: false });
fFlow.addBinding(params, 'flowComplexity', { label: 'complexity', min: 1, max: 8, step: 1 });
fFlow.addBinding(params, 'flowFreq', { label: 'freq', min: 0.5, max: 20, step: 0.5 });
fFlow.addBinding(params, 'flowAmpX', { label: 'amp X', min: 0, max: 20, step: 0.1 });
fFlow.addBinding(params, 'flowAmpY', { label: 'amp Y', min: 0, max: 20, step: 0.1 });
fFlow.addBinding(params, 'flowSpeedX', { label: 'speed X', min: 0, max: 100, step: 1 });
fFlow.addBinding(params, 'flowSpeedY', { label: 'speed Y', min: 0, max: 100, step: 1 });

const fSine = main.addFolder({ title: 'Sine', expanded: false });
fSine.addBinding(params, 'sineAmpX', { label: 'amp X', min: 0, max: 20, step: 0.1 });
fSine.addBinding(params, 'sineAmpY', { label: 'amp Y', min: 0, max: 20, step: 0.1 });
fSine.addBinding(params, 'sineFreqX', { label: 'freq X', min: 1, max: 40, step: 1 });
fSine.addBinding(params, 'sineFreqY', { label: 'freq Y', min: 1, max: 40, step: 1 });
fSine.addBinding(params, 'sineSpeedX', { label: 'speed X', min: 0, max: 100, step: 1 });
fSine.addBinding(params, 'sineSpeedY', { label: 'speed Y', min: 0, max: 100, step: 1 });

const fR = main.addFolder({ title: 'Refraction' });
fR.addBinding(params, 'refractMode', { label: 'mode', options: { Off: 'off', Grid: 'grid' } });
fR.addBinding(params, 'gridAmtX', { label: 'grid X', min: 2, max: 60, step: 1 });
fR.addBinding(params, 'gridAmtY', { label: 'grid Y', min: 2, max: 60, step: 1 });
fR.addBinding(params, 'skewX', { label: 'skew X', min: 0, max: 5, step: 0.05 });
fR.addBinding(params, 'skewY', { label: 'skew Y', min: 0, max: 5, step: 0.05 });

attachExport(tool.pages.export, { getCanvas: tool.getCanvas, name: 'refract' });

const presets = {
  'Box Glitch': { displaceMode: 'box', boxAmpX: 2.2, boxAmpY: 2.2, boxFreqX: 10, boxFreqY: 8, refractMode: 'off', seed: 601 },
  'Liquid Flow': { displaceMode: 'flow', flowComplexity: 5, flowFreq: 4, flowAmpX: 6, flowAmpY: 6, flowSpeedX: 10, flowSpeedY: 6, animate: true, refractMode: 'off' },
  'Glass Grid': { displaceMode: 'sine', sineAmpX: 1.5, sineAmpY: 1.5, sineFreqX: 12, sineFreqY: 12, refractMode: 'grid', gridAmtX: 24, gridAmtY: 24, skewX: 1.6, skewY: 1.6 },
  Ripple: { displaceMode: 'sine', sineAmpX: 1.0, sineAmpY: 1.0, sineFreqX: 6, sineFreqY: 6, sineSpeedX: 8, sineSpeedY: 8, animate: true, refractMode: 'off', seed: 200 },
  Shatter: { displaceMode: 'box', boxAmpX: 5, boxAmpY: 5, boxFreqX: 16, boxFreqY: 12, refractMode: 'off', seed: 777 },
  'Lens Grid': { displaceMode: 'sine', sineAmpX: 0.6, sineAmpY: 0.6, sineFreqX: 10, sineFreqY: 10, refractMode: 'grid', gridAmtX: 16, gridAmtY: 16, skewX: 2.2, skewY: 2.2, seed: 42 },
  Smoke: { displaceMode: 'flow', flowComplexity: 6, flowFreq: 2, flowAmpX: 8, flowAmpY: 8, flowSpeedX: 4, flowSpeedY: 3, animate: true, refractMode: 'off' },
  Tiles: { displaceMode: 'box', boxAmpX: 1.2, boxAmpY: 1.2, boxFreqX: 6, boxFreqY: 6, refractMode: 'grid', gridAmtX: 30, gridAmtY: 30, skewX: 1.0, skewY: 1.0, seed: 123 },
  Current: { displaceMode: 'flow', flowComplexity: 4, flowFreq: 5, flowAmpX: 5, flowAmpY: 5, flowSpeedX: 12, flowSpeedY: 8, animate: true, refractMode: 'grid', gridAmtX: 12, gridAmtY: 12, skewX: 1.5, skewY: 1.5 },
};
function randomize(p) {
  p.displaceMode = ['box', 'flow', 'sine'][(Math.random() * 3) | 0];
  p.seed = (Math.random() * 1000) | 0;
  p.boxAmpX = Math.random() * 5; p.boxAmpY = Math.random() * 5; p.boxFreqX = 2 + (Math.random() * 24 | 0); p.boxFreqY = 2 + (Math.random() * 24 | 0);
  p.flowComplexity = 1 + (Math.random() * 7 | 0); p.flowFreq = 1 + Math.random() * 8; p.flowAmpX = Math.random() * 8; p.flowAmpY = Math.random() * 8;
  p.sineAmpX = Math.random() * 4; p.sineAmpY = Math.random() * 4; p.sineFreqX = 2 + (Math.random() * 24 | 0); p.sineFreqY = 2 + (Math.random() * 24 | 0);
  p.refractMode = Math.random() < 0.5 ? 'off' : 'grid'; p.skewX = Math.random() * 3; p.skewY = Math.random() * 3;
}
attachPresets(tool.pages.options, { pane: tool.pane, params, presets, randomize });

// ---- Drag-drop image ----
tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file || !/^image\//i.test(file.type)) return;
  const url = URL.createObjectURL(file);
  p5i.loadImage(url, (img) => { srcImg = img; URL.revokeObjectURL(url); }, () => URL.revokeObjectURL(url));
});
