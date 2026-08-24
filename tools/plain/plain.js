// PLAIN — dynamic low-poly 3D plane graphics. A subdivided plane mesh is
// displaced by multi-octave simplex (fbm) noise and rendered as flat-shaded
// facets (per-face normals + lighting) with height-based palette coloring,
// tilt + auto-rotation, and wireframe options. p5 WebGL; proves the 3D path.
import { createTool } from '../../js/etch/shell.js';
import { attachPresets } from '../../js/etch/presets.js';
import { attachExport } from '../../js/etch/export.js';
import { noise3D } from '../../js/etch/noise.js';
import { interpolateHex } from '../../js/etch/palette.js';

const DEG = Math.PI / 180;

const params = {
  cols: 48, rows: 48, planeSize: 560, heightAmp: 150,
  noiseScale: 0.0022, octaves: 4,
  animate: true, speed: 0.4, tiltX: 62, autoRotate: true, rotateSpeed: 0.25,
  wireframe: 'both', lightIntensity: 0.85, lightAngle: 60,
  paletteCount: 3, c0: '#0a3d62', c1: '#3c6382', c2: '#82ccdd',
  background: '#06070d',
};

function colorsArr() { return [params.c0, params.c1, params.c2].slice(0, Math.max(2, params.paletteCount)); }
function gradient(cs, t) {
  t = Math.max(0, Math.min(1, t));
  const pos = t * (cs.length - 1), k = Math.min(Math.floor(pos), cs.length - 2);
  return interpolateHex(cs[k], cs[Math.min(k + 1, cs.length - 1)], pos - k);
}
function fbm(x, y, t, oct) {
  let v = 0, amp = 0.5, fr = 1;
  for (let i = 0; i < oct; i++) { v += amp * noise3D(x * fr, y * fr, t); amp *= 0.5; fr *= 2; }
  return v;
}

const tool = createTool({ name: 'PLAIN', version: '0.1' });
let t = 0, spin = 0;

function drawMesh(p) {
  const cols = params.cols, rows = params.rows, S = params.planeSize, A = params.heightAmp;
  const cs = colorsArr();
  // Vertex grid
  const V = [];
  for (let i = 0; i <= cols; i++) {
    V[i] = [];
    for (let j = 0; j <= rows; j++) {
      const x = (i / cols - 0.5) * S, y = (j / rows - 0.5) * S;
      const z = fbm(x * params.noiseScale, y * params.noiseScale, t, params.octaves) * A;
      V[i][j] = { x, y, z };
    }
  }
  const fill = params.wireframe !== 'lines';
  const stroke = params.wireframe !== 'fill';
  if (stroke) { p.stroke(0, 0, 0, params.wireframe === 'both' ? 60 : 200); p.strokeWeight(1); }
  else p.noStroke();
  if (!fill) { p.noFill(); if (params.wireframe === 'lines') p.stroke(gradient(cs, 0.7)); }

  const emit = (a, b, c) => {
    if (fill) {
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
      const ht = ((a.z + b.z + c.z) / 3) / A * 0.5 + 0.5;
      p.fill(gradient(cs, ht));
      p.normal(nx, ny, nz);
    }
    p.vertex(a.x, a.y, a.z); p.vertex(b.x, b.y, b.z); p.vertex(c.x, c.y, c.z);
  };

  p.beginShape(p.TRIANGLES);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = V[i][j], b = V[i + 1][j], c = V[i + 1][j + 1], d = V[i][j + 1];
      emit(a, b, c); emit(a, c, d);
    }
  }
  p.endShape();
}

tool.startSketch((p) => {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    p.setAttributes('preserveDrawingBuffer', true);
    p.pixelDensity(1);
  };
  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);
  p.draw = () => {
    const dt = Math.min(p.deltaTime / 1000, 0.1);
    if (params.animate) t += dt * params.speed;
    if (params.autoRotate) spin += dt * params.rotateSpeed;
    p.background(params.background);
    p.ambientLight(60);
    const la = params.lightAngle * DEG, I = Math.round(params.lightIntensity * 255);
    p.directionalLight(I, I, I, Math.cos(la), 0.55, Math.sin(la));
    p.push();
    p.rotateX(params.tiltX * DEG);
    p.rotateZ(spin);
    drawMesh(p);
    p.pop();
  };
});

// ---- UI ----
const main = tool.pages.main;
const fMesh = main.addFolder({ title: 'Mesh' });
fMesh.addBinding(params, 'cols', { min: 4, max: 80, step: 1 });
fMesh.addBinding(params, 'rows', { min: 4, max: 80, step: 1 });
fMesh.addBinding(params, 'planeSize', { label: 'size', min: 200, max: 900, step: 10 });
fMesh.addBinding(params, 'heightAmp', { label: 'height', min: 0, max: 400, step: 5 });
fMesh.addBinding(params, 'noiseScale', { label: 'noise scl', min: 0.0005, max: 0.008, step: 0.0001 });
fMesh.addBinding(params, 'octaves', { min: 1, max: 6, step: 1 });

const fView = main.addFolder({ title: 'View' });
fView.addBinding(params, 'tiltX', { label: 'tilt', min: 0, max: 90, step: 1 });
fView.addBinding(params, 'autoRotate', { label: 'auto rotate' });
fView.addBinding(params, 'rotateSpeed', { label: 'rotate spd', min: 0, max: 2, step: 0.05 });
fView.addBinding(params, 'wireframe', { options: { Fill: 'fill', Lines: 'lines', Both: 'both' } });
fView.addBinding(params, 'lightIntensity', { label: 'light', min: 0, max: 1, step: 0.05 });
fView.addBinding(params, 'lightAngle', { label: 'light ang', min: 0, max: 360, step: 5 });

const fColor = main.addFolder({ title: 'Color' });
fColor.addBinding(params, 'paletteCount', { label: 'colors', min: 2, max: 3, step: 1 });
fColor.addBinding(params, 'c0', { label: 'low', view: 'color' });
fColor.addBinding(params, 'c1', { label: 'mid', view: 'color' });
fColor.addBinding(params, 'c2', { label: 'high', view: 'color' });
fColor.addBinding(params, 'background', { view: 'color' });

const fMotion = main.addFolder({ title: 'Motion' });
fMotion.addBinding(params, 'animate');
fMotion.addBinding(params, 'speed', { min: 0, max: 2, step: 0.05 });

attachExport(tool.pages.export, { getCanvas: tool.getCanvas, name: 'plain' });

const presets = {
  Ocean: { heightAmp: 150, noiseScale: 0.0022, octaves: 4, wireframe: 'both', c0: '#0a3d62', c1: '#3c6382', c2: '#82ccdd', background: '#06070d' },
  Dunes: { heightAmp: 110, noiseScale: 0.0016, octaves: 3, wireframe: 'fill', tiltX: 68, c0: '#5d3a1a', c1: '#b86b2e', c2: '#f6d186', background: '#0c0703' },
  Wire: { heightAmp: 200, noiseScale: 0.003, octaves: 5, wireframe: 'lines', cols: 60, rows: 60, c0: '#1b1b3a', c1: '#6c5ce7', c2: '#a29bfe', background: '#04040a' },
  Glacier: { heightAmp: 120, noiseScale: 0.0018, octaves: 3, wireframe: 'both', tiltX: 60, c0: '#0b3866', c1: '#2e86ab', c2: '#cae9ff', background: '#040a12' },
  Magma: { heightAmp: 220, noiseScale: 0.003, octaves: 5, wireframe: 'fill', tiltX: 64, lightAngle: 120, c0: '#3a0603', c1: '#e63946', c2: '#ffba08', background: '#0a0302' },
  'Grid Wire': { heightAmp: 160, noiseScale: 0.0025, octaves: 4, wireframe: 'lines', cols: 70, rows: 70, c0: '#10122b', c1: '#6c5ce7', c2: '#a29bfe', background: '#04040a' },
  'Soft Hills': { heightAmp: 90, noiseScale: 0.0014, octaves: 3, wireframe: 'both', tiltX: 70, c0: '#1b3a2b', c1: '#52946b', c2: '#cde8d5', background: '#06120c' },
  Crystal: { heightAmp: 280, noiseScale: 0.004, octaves: 6, wireframe: 'lines', cols: 64, rows: 64, rotateSpeed: 0.5, speed: 0.6, c0: '#241654', c1: '#7b2cbf', c2: '#e0aaff', background: '#05030c' },
  Sand: { heightAmp: 110, noiseScale: 0.0016, octaves: 3, wireframe: 'fill', tiltX: 68, lightAngle: 40, c0: '#5d3a1a', c1: '#c98a45', c2: '#f6e0b5', background: '#0c0703' },
};
function randomize(p) {
  p.heightAmp = 60 + Math.random() * 280;
  p.noiseScale = 0.001 + Math.random() * 0.005;
  p.octaves = 2 + (Math.random() * 4 | 0);
  p.tiltX = 40 + Math.random() * 45;
  p.wireframe = ['fill', 'lines', 'both'][(Math.random() * 3) | 0];
  p.lightAngle = Math.random() * 360 | 0;
  const h = Math.random() * 360;
  p.c0 = `#${hsl(h, 60, 25)}`; p.c1 = `#${hsl((h + 30) % 360, 60, 50)}`; p.c2 = `#${hsl((h + 60) % 360, 70, 75)}`;
}
function hsl(h, s, l) {
  s /= 100; l /= 100; const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
  return `${f(0)}${f(8)}${f(4)}`;
}
attachPresets(tool.pages.options, { pane: tool.pane, params, presets, randomize });
