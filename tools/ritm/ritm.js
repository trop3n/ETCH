// RITM — abstract waveform graphics from Simplex noise + a generative color
// palette, on the shared p5 + Tweakpane shell. The Etch counterpart of the
// repo's raster `Rhythm` tool; the noise/waveform math is adapted from it.
import { createTool } from '../../js/etch/shell.js';
import { attachPresets } from '../../js/etch/presets.js';
import { attachExport } from '../../js/etch/export.js';

const params = {
  waveform: 'noise',
  amplitude: 90,
  frequency: 0.01,
  speed: 1,
  phaseOffset: 0.12,
  lineCount: 28,
  spacing: 14,
  strokeWeight: 2,
  strokeOpacity: 100,
  cap: 'round',
  gradient: 'linear',
  hueStart: 200,
  hueRange: 90,
  saturation: 80,
  lightness: 62,
  cycleColors: false,
  cycleSpeed: 0.5,
  background: '#050505',
};

// ---- Simplex noise (3D), adapted from tools/rhythm ----
const PERM = new Uint8Array(512);
const GRAD3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
(function seedNoise() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();
function dot3(g, x, y, z) { return g[0] * x + g[1] * y + g[2] * z; }
function noise3D(xin, yin, zin) {
  const F3 = 1 / 3, G3 = 1 / 6;
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
  const t = (i + j + k) * G3;
  const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=1;k2=0; }
    else if (x0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=0;k2=1; }
    else { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1; }
  } else {
    if (y0 < z0) { i1=0;j1=0;k1=1;i2=0;j2=1;k2=1; }
    else if (x0 < z0) { i1=0;j1=1;k1=0;i2=0;j2=1;k2=1; }
    else { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0; }
  }
  const x1=x0-i1+G3,y1=y0-j1+G3,z1=z0-k1+G3;
  const x2=x0-i2+2*G3,y2=y0-j2+2*G3,z2=z0-k2+2*G3;
  const x3=x0-1+3*G3,y3=y0-1+3*G3,z3=z0-1+3*G3;
  const ii=i&255,jj=j&255,kk=k&255;
  let n0=0,n1=0,n2=0,n3=0;
  let t0=0.6-x0*x0-y0*y0-z0*z0;
  if(t0>0){t0*=t0;n0=t0*t0*dot3(GRAD3[PERM[ii+PERM[jj+PERM[kk]]]%12],x0,y0,z0);}
  let t1=0.6-x1*x1-y1*y1-z1*z1;
  if(t1>0){t1*=t1;n1=t1*t1*dot3(GRAD3[PERM[ii+i1+PERM[jj+j1+PERM[kk+k1]]]%12],x1,y1,z1);}
  let t2=0.6-x2*x2-y2*y2-z2*z2;
  if(t2>0){t2*=t2;n2=t2*t2*dot3(GRAD3[PERM[ii+i2+PERM[jj+j2+PERM[kk+k2]]]%12],x2,y2,z2);}
  let t3=0.6-x3*x3-y3*y3-z3*z3;
  if(t3>0){t3*=t3;n3=t3*t3*dot3(GRAD3[PERM[ii+1+PERM[jj+1+PERM[kk+1]]]%12],x3,y3,z3);}
  return 32*(n0+n1+n2+n3);
}

// ---- Waveforms ----
function noiseWave(x, phase, time, amp) {
  let value = 0, a = 1, freq = 0.005, total = 0;
  for (let i = 0; i < 3; i++) { value += noise3D(x * freq, phase, time) * a; total += a; a *= 0.5; freq *= 2; }
  return (value / total) * amp;
}
function waveValue(x, phase, tScaled) {
  const amp = params.amplitude, freq = params.frequency;
  switch (params.waveform) {
    case 'sine': return Math.sin(x * freq + phase) * amp;
    case 'square': return (Math.sin(x * freq + phase) >= 0 ? 1 : -1) * amp;
    case 'sawtooth': {
      const period = 2 * Math.PI / freq;
      const pos = ((x + phase / freq) % period + period) % period;
      return ((pos / period) * 2 - 1) * amp;
    }
    case 'triangle': {
      const period = 2 * Math.PI / freq;
      const pos = ((x + phase / freq) % period + period) % period;
      return (Math.abs((pos / period) * 2 - 1) * 2 - 1) * amp;
    }
    default: return noiseWave(x, phase, tScaled, amp);
  }
}

function lineColor(i, n, time) {
  let t;
  if (params.gradient === 'linear') t = n > 1 ? i / (n - 1) : 0;
  else if (params.gradient === 'radial') t = Math.abs(i - n / 2) / (n / 2);
  else t = Math.sin(i * 0.5 + time * params.cycleSpeed) * 0.5 + 0.5;
  let hue = (params.hueStart + t * params.hueRange) % 360;
  if (params.cycleColors) hue = (hue + time * params.cycleSpeed * 60) % 360;
  return { h: (hue + 360) % 360, s: params.saturation, l: params.lightness };
}

// ---- Presets (original content) ----
const presets = {
  Aurora: { waveform: 'noise', lineCount: 44, spacing: 9, amplitude: 120, speed: 0.6, phaseOffset: 0.08, gradient: 'linear', hueStart: 150, hueRange: 130, saturation: 78, lightness: 60, background: '#04060a' },
  Sonar: { waveform: 'sine', lineCount: 18, spacing: 20, amplitude: 80, frequency: 0.02, speed: 1.2, phaseOffset: 0.2, gradient: 'radial', hueStart: 190, hueRange: 40, saturation: 85, lightness: 60, background: '#02040a' },
  Ribbon: { waveform: 'triangle', lineCount: 30, spacing: 12, amplitude: 150, frequency: 0.012, speed: 0.8, phaseOffset: 0.15, gradient: 'wave', cycleColors: true, hueStart: 300, hueRange: 90, saturation: 80, lightness: 64, background: '#0a0410' },
  Tide: { waveform: 'noise', lineCount: 60, spacing: 7, amplitude: 70, speed: 0.4, phaseOffset: 0.06, gradient: 'linear', hueStart: 190, hueRange: 50, saturation: 70, lightness: 58, background: '#020308' },
  Static: { waveform: 'square', lineCount: 40, spacing: 9, amplitude: 60, frequency: 0.03, speed: 2.2, phaseOffset: 0.1, gradient: 'linear', hueStart: 0, hueRange: 0, saturation: 0, lightness: 80, strokeWeight: 1.5, background: '#0a0a0a' },
  Seismograph: { waveform: 'sawtooth', lineCount: 24, spacing: 16, amplitude: 110, frequency: 0.015, speed: 1.5, gradient: 'radial', hueStart: 10, hueRange: 40, saturation: 80, lightness: 60, background: '#08040a' },
  Contour: { waveform: 'noise', lineCount: 80, spacing: 5, amplitude: 90, speed: 0.3, phaseOffset: 0.05, strokeWeight: 1, strokeOpacity: 70, gradient: 'linear', hueStart: 120, hueRange: 100, saturation: 60, lightness: 62, background: '#03060a' },
  'Neon Pulse': { waveform: 'sine', lineCount: 28, spacing: 14, amplitude: 100, frequency: 0.018, speed: 1.0, cycleColors: true, cycleSpeed: 1.2, hueStart: 280, hueRange: 120, saturation: 90, lightness: 65, strokeWeight: 2.5, gradient: 'linear', background: '#050010' },
  Heatmap: { waveform: 'triangle', lineCount: 36, spacing: 11, amplitude: 130, frequency: 0.01, speed: 0.7, gradient: 'wave', hueStart: 20, hueRange: 60, saturation: 90, lightness: 60, background: '#0a0402' },
};

function randomize(p) {
  const waves = ['noise', 'sine', 'square', 'sawtooth', 'triangle'];
  p.waveform = waves[(Math.random() * waves.length) | 0];
  p.lineCount = 8 + (Math.random() * 80 | 0);
  p.spacing = 4 + (Math.random() * 28 | 0);
  p.amplitude = 40 + Math.random() * 220;
  p.frequency = 0.003 + Math.random() * 0.05;
  p.speed = Math.random() * 3;
  p.phaseOffset = Math.random() * 0.4;
  p.hueStart = Math.random() * 360 | 0;
  p.hueRange = 20 + (Math.random() * 200 | 0);
  p.saturation = 55 + (Math.random() * 45 | 0);
  p.lightness = 48 + (Math.random() * 28 | 0);
}

// ---- Build UI ----
const tool = createTool({ name: 'RITM', version: '0.1' });
const main = tool.pages.main;

const fWave = main.addFolder({ title: 'Waveform' });
fWave.addBinding(params, 'waveform', { options: { Noise: 'noise', Sine: 'sine', Square: 'square', Saw: 'sawtooth', Triangle: 'triangle' } });
fWave.addBinding(params, 'amplitude', { min: 0, max: 300, step: 1 });
fWave.addBinding(params, 'frequency', { min: 0.001, max: 0.1, step: 0.001 });
fWave.addBinding(params, 'speed', { min: 0, max: 5, step: 0.1 });
fWave.addBinding(params, 'phaseOffset', { label: 'phase', min: 0, max: 1, step: 0.01 });

const fLines = main.addFolder({ title: 'Lines' });
fLines.addBinding(params, 'lineCount', { label: 'count', min: 1, max: 120, step: 1 });
fLines.addBinding(params, 'spacing', { min: 1, max: 50, step: 1 });
fLines.addBinding(params, 'strokeWeight', { label: 'weight', min: 0.5, max: 10, step: 0.5 });
fLines.addBinding(params, 'strokeOpacity', { label: 'opacity', min: 10, max: 100, step: 5 });
fLines.addBinding(params, 'cap', { options: { Round: 'round', Square: 'square' } });

const fColor = main.addFolder({ title: 'Color' });
fColor.addBinding(params, 'gradient', { options: { Linear: 'linear', Radial: 'radial', Wave: 'wave' } });
fColor.addBinding(params, 'hueStart', { min: 0, max: 360, step: 5 });
fColor.addBinding(params, 'hueRange', { min: 0, max: 360, step: 5 });
fColor.addBinding(params, 'saturation', { min: 0, max: 100, step: 5 });
fColor.addBinding(params, 'lightness', { min: 0, max: 100, step: 5 });
fColor.addBinding(params, 'cycleColors', { label: 'cycle' });
fColor.addBinding(params, 'cycleSpeed', { label: 'cycle spd', min: 0.1, max: 5, step: 0.1 });
fColor.addBinding(params, 'background', { view: 'color' });

attachExport(tool.pages.export, { getCanvas: tool.getCanvas, name: 'ritm' });
attachPresets(tool.pages.options, { pane: tool.pane, params, presets, randomize });

// ---- Render ----
let currentTime = 0;
tool.startSketch((p) => {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.HSL, 360, 100, 100, 1);
    p.pixelDensity(1);
  };
  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);
  p.draw = () => {
    currentTime += Math.min(p.deltaTime / 1000, 0.1);
    const tScaled = currentTime * params.speed;
    p.background(params.background);
    const W = p.width, H = p.height, n = params.lineCount, sp = params.spacing;
    const startY = (H - (n - 1) * sp) / 2;
    p.strokeCap(params.cap === 'round' ? p.ROUND : p.PROJECT);
    p.noFill();
    for (let i = 0; i < n; i++) {
      const baseY = startY + i * sp;
      const phase = i * params.phaseOffset + tScaled;
      const c = lineColor(i, n, currentTime);
      p.stroke(c.h, c.s, c.l, params.strokeOpacity / 100);
      p.strokeWeight(params.strokeWeight);
      p.beginShape();
      for (let x = 0; x <= W; x += 2) p.vertex(x, baseY + waveValue(x, phase, tScaled));
      p.endShape();
    }
  };
});
