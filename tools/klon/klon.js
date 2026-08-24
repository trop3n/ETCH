// KLON — a grid-snapped clone-stamp + collage tool. Drag on the canvas to draw
// a rectangle, ellipse or triangle (with 90° rotation); on press the area under
// the shape is sampled into a buffer; while held, the cursor "brushes" that
// fragment as rect/ellipse/triangle stamps onto the result, optionally snapped
// to a power-of-two grid. Three select modes — `free` (each press grabs a new
// area), `buffer` (first press captures, subsequent strokes paste the same
// fragment) and `erase` (cuts the shape from the result) — plus a `draw`
// switch that samples either the source image or the accumulating result.
// Source defaults to a procedurally-generated image; drop one to load your own.
//
// Shape masks include triangles by 90° orientation; grid snap uses cells of
// 2^n derived from the image size.
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachExport } from '../../js/etch/export.js';
import { createNoise2D } from '../../js/vendor/simplex/simplex-noise.js';
import { alea } from '../../js/etch/noise.js';

const { sin, cos, round, floor, min, max, pow, abs, PI } = Math;
const HALF_PI = PI / 2;
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const radians = (deg) => (deg * PI) / 180;

/////////////////////////////////////////////////////////////////////////////
// State — shaped like the reference. Coords live in image space.
/////////////////////////////////////////////////////////////////////////////
const cnv = {
  source: true, result: true, cursor: true,
  bg: { mode: 'custom', custom: '#FFFFFF' },
  image: { size: '', max: 2560 },
  mouse: { x: 0, y: 0, px: 0, py: 0 },
  size: { x: 256, y: 256, min: 5, width: 400, height: 400 },
  settings: { sens: 1.25 },
};
const preview = {
  ready: true, select: false,
  size: { x: 0, y: 0 },
  buffer: { x: 0, y: 0 },
  mod: { x: 0, y: 0 },
  coords: { x1: 0, y1: 0, x2: 0, y2: 0 },
  stroke: '#000000', fill: '#FFFFFF2A',
};
const form = { coords: { x1: 0, y1: 0, x2: 0, y2: 0 }, size: { x: 0, y: 0 } };
const area = {
  coords: { x1: 0, y1: 0, x2: 0, y2: 0 },
  size: { x: 256, y: 256 },
  rotation: { amount: 0, add: 90 },
};
const mode = {
  draw: 'source', select: 'free', last: 'free',
  shape: 'rect', shapeType: ['rect', 'ellipse', 'triangle'], shapeAngle: 0,
};
const grid = {
  update: true, snap: true, show: true,
  color: 'black', opacity: 0.5, width: 1.5,
  mult: 1, sync: true,
  x: 20, y: 20,
  ui: { x: 3, y: 3, min: 2, max: 8 },
  mod: { x: 0, y: 0 },
};

const SHAPE_OPTS = { Rectangle: 'rect', Ellipse: 'ellipse', Triangle: 'triangle' };
const SELECT_OPTS = { 'Free Clone (S)': 'free', 'Buffer Clone (S)': 'buffer', 'Erase (E)': 'erase' };
const DRAW_OPTS = { 'Sample Source': 'source', 'Sample Result': 'result' };
const BG_OPTS = { Custom: 'custom', Transparent: 'transparent' };
const GRID_COLOR_OPTS = { Black: 'black', White: 'white', Red: 'red', Blue: 'blue' };
const ANGLE_OPTS = { '0°': 0, '90°': 90, '180°': 180, '270°': 270 };

/////////////////////////////////////////////////////////////////////////////
// Runtime
/////////////////////////////////////////////////////////////////////////////
let P = null, displayCanvas = null;
let img = null, gResult = null, gPreview = null, gBuffer = null, gArea = null, gGrid = null, gBackup = null;
let alphaImg = null;
let GW = 1280, GH = 960;
let mx = 0, my = 0, overCanvas = false, leftDown = false, shiftDown = false;
let mxLocked = false, myLocked = false, lockX = 0, lockY = 0;

/////////////////////////////////////////////////////////////////////////////
// Default procedural image (generated, so the tool ships with no bundled photo)
/////////////////////////////////////////////////////////////////////////////
function makeDefaultImage() {
  const w = 1280, h = 960;
  const g = P.createGraphics(w, h); g.pixelDensity(1); g.noStroke();
  const n = createNoise2D(alea(424242));
  for (let y = 0; y < h; y++) {
    const t = y / h;
    g.fill(map(t, 0, 1, 30, 240), map(t, 0, 1, 100, 80), map(t, 0, 1, 150, 50));
    g.rect(0, y, w, 1);
  }
  g.push(); g.colorMode(P.HSB, 360, 100, 100, 1);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const hue = (n(x * 0.002, y * 0.002) * 0.5 + 0.5) * 360;
    g.fill(hue, 70 + Math.random() * 25, 70 + Math.random() * 25, 0.45);
    const r = 60 + Math.random() * 220;
    g.ellipse(x, y, r, r * (0.5 + Math.random()));
  }
  for (let i = 0; i < 14; i++) { g.fill((i * 47) % 360, 75, 95, 0.16); g.rect(Math.random() * w, 0, 8 + Math.random() * 60, h); }
  for (let i = 0; i < 8; i++) { g.fill((180 + i * 23) % 360, 60, 100, 0.12); const y = Math.random() * h; g.rect(0, y, w, 4 + Math.random() * 24); }
  g.pop();
  const out = g.get(); g.remove();
  return out;
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

function getMult(side) {
  let i, m = 0, size = 0;
  do { i = pow(2, 3 + m); size = side / i; m++; } while (size >= 4);
  return m;
}

function makeAlphaImage(w, h) {
  const g = P.createGraphics(w, h); g.pixelDensity(1); g.noStroke();
  const sz = (w + h) / 100;
  for (let y = 0, yi = 0; y < h; y += sz, yi++) for (let x = 0, xi = 0; x < w; x += sz, xi++) {
    g.fill((xi + yi) % 2 ? 235 : 205); g.rect(x, y, sz, sz);
  }
  const im = g.get(); g.remove(); return im;
}

function loadImageAsSource(image) {
  img = adjustImageSize(image, cnv.image.max).get();
  GW = img.width; GH = img.height;
  cnv.image.size = `${img.width} × ${img.height} px`;
  P.resizeCanvas(GW, GH); P.pixelDensity(1);
  P.rectMode(P.CORNERS); P.ellipseMode(P.CORNERS); P.noFill(); P.noStroke();

  for (const b of [gResult, gPreview, gBackup, gGrid]) if (b) b.remove();
  gResult = P.createGraphics(img.width, img.height); gResult.pixelDensity(1); gResult.rectMode(P.CORNERS); gResult.ellipseMode(P.CORNERS); gResult.noStroke();
  gBackup = P.createGraphics(img.width, img.height); gBackup.pixelDensity(1); gBackup.noStroke();
  gPreview = P.createGraphics(img.width, img.height); gPreview.pixelDensity(1); gPreview.imageMode(P.CORNERS); gPreview.ellipseMode(P.CORNERS); gPreview.noStroke();
  gGrid = P.createGraphics(img.width, img.height); gGrid.pixelDensity(1);
  if (gArea) { gArea.remove(); gArea = null; }
  if (gBuffer) { gBuffer.remove(); gBuffer = null; }
  alphaImg = makeAlphaImage(img.width, img.height);

  // grid cell mult scales with image size so cells stay sane across resolutions
  grid.mult = 2;
  const xm = getMult(img.width), ym = getMult(img.height), m = min(xm, ym);
  let mod = 0;
  if (m < 8) { mod = 8 - (m % 8); grid.mult = grid.mult - mod; }
  grid.ui.max = m + mod;
  grid.update = true;

  cnv.size.width = img.width; cnv.size.height = img.height;
  cnv.size.x = min(max(cnv.size.x, cnv.size.min), cnv.size.width);
  cnv.size.y = min(max(cnv.size.y, cnv.size.min), cnv.size.height);
  if (mode.select === 'erase') mode.select = 'free';
  fitCanvas();
}

/////////////////////////////////////////////////////////////////////////////
// Grid (cell sizes are powers of two; mod centres the grid on the image)
/////////////////////////////////////////////////////////////////////////////
function gridX(v) { return grid.snap ? round(v / grid.x) * grid.x : round(v); }
function gridY(v) { return grid.snap ? round(v / grid.y) * grid.y : round(v); }

function gridData() {
  cnv.size.x = min(max(cnv.size.x, cnv.size.min), cnv.size.width);
  cnv.size.y = min(max(cnv.size.y, cnv.size.min), cnv.size.height);

  const cellX = pow(2, grid.ui.x + grid.mult);
  const cellY = pow(2, grid.ui.y + grid.mult);
  const sizeX = grid.snap ? max(cellX, cnv.size.x - cellX / 2) : cnv.size.x;
  const sizeY = grid.snap ? max(cellY, cnv.size.y - cellY / 2) : cnv.size.y;

  // shift-lock one axis once the user actually starts moving along it
  if (leftDown && shiftDown) {
    if (!mxLocked && !myLocked) {
      const dx = abs(mx - cnv.mouse.px), dy = abs(my - cnv.mouse.py);
      if (dy > dx && dy > 1) { mxLocked = true; lockX = mx; }
      else if (dx > 1) { myLocked = true; lockY = my; }
    }
  } else { cnv.mouse.px = mx; cnv.mouse.py = my; mxLocked = false; myLocked = false; }
  const lmx = mxLocked ? lockX : mx;
  const lmy = myLocked ? lockY : my;

  grid.x = cellX; grid.y = cellY;
  grid.mod.x = (img.width % (cellX * 2)) / 2;
  grid.mod.y = (img.height % (cellY * 2)) / 2;
  preview.mod.x = grid.snap ? grid.mod.x : 0;
  preview.mod.y = grid.snap ? grid.mod.y : 0;
  preview.size.x = gridX(sizeX);
  preview.size.y = gridY(sizeY);
  preview.coords.x1 = gridX(lmx - preview.size.x / 2 - preview.mod.x) + preview.mod.x;
  preview.coords.y1 = gridY(lmy - preview.size.y / 2 - preview.mod.y) + preview.mod.y;
  preview.coords.x2 = gridX(lmx + preview.size.x / 2 - preview.mod.x) + preview.mod.x;
  preview.coords.y2 = gridY(lmy + preview.size.y / 2 - preview.mod.y) + preview.mod.y;

  form.coords.x1 = preview.coords.x1; form.coords.y1 = preview.coords.y1;
  form.coords.x2 = preview.coords.x2; form.coords.y2 = preview.coords.y2;
  form.size.x = form.coords.x2 - form.coords.x1;
  form.size.y = form.coords.y2 - form.coords.y1;

  if (grid.update) { makeGrid(); grid.update = false; }
}

function makeGrid() {
  const colors = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], blue: [0, 150, 255] };
  const [r, g, b] = colors[grid.color] || colors.black;
  const c = P.color(r, g, b, grid.opacity * 255);
  gGrid.clear();
  gGrid.push();
  gGrid.strokeWeight(grid.width);
  gGrid.stroke(c);
  const dx = grid.x, dy = grid.y;
  let mxg = (img.width / 2) % dx, myg = (img.height / 2) % dy;
  if (floor(mxg) === floor(dx)) mxg = -dx;
  if (floor(myg) === floor(dy)) myg = -dy;
  gGrid.translate(grid.width / 2, grid.width / 2);
  for (let x = mxg; x < img.width + dx; x += dx)
    for (let y = myg; y < img.height + dy; y += dy)
      gGrid.point(x - grid.width / 2, y - grid.width / 2);
  gGrid.pop();
}

/////////////////////////////////////////////////////////////////////////////
// Shape helpers
/////////////////////////////////////////////////////////////////////////////
function drawTriCorners(g, x1, y1, x2, y2, angle) {
  switch (angle) {
    case 0:   g.triangle(x1, y2, x1, y1, x2, y1); break;
    case 90:  g.triangle(x1, y1, x2, y1, x2, y2); break;
    case 180: g.triangle(x2, y1, x2, y2, x1, y2); break;
    case 270: g.triangle(x2, y2, x1, y2, x1, y1); break;
  }
}
function drawTriCenter(g, w, h, angle) {
  switch (angle) {
    case 0:   g.triangle(-w / 2,  h / 2, -w / 2, -h / 2,  w / 2, -h / 2); break;
    case 90:  g.triangle(-w / 2, -h / 2,  w / 2, -h / 2,  w / 2,  h / 2); break;
    case 180: g.triangle( w / 2, -h / 2,  w / 2,  h / 2, -w / 2,  h / 2); break;
    case 270: g.triangle( w / 2,  h / 2, -w / 2,  h / 2, -w / 2, -h / 2); break;
  }
}
function drawShapeOn(g, x1, y1, x2, y2, shape, angle) {
  switch (shape) {
    case 'rect': g.rect(x1, y1, x2, y2); break;
    case 'ellipse': g.ellipse(x1, y1, x2, y2); break;
    case 'triangle': drawTriCorners(g, x1, y1, x2, y2, angle); break;
  }
}

/////////////////////////////////////////////////////////////////////////////
// Sample area → buffer (rotated + clip-masked)
/////////////////////////////////////////////////////////////////////////////
function makeGraphicsArea() {
  if (gArea) gArea.remove();
  gArea = P.createGraphics(area.size.x, area.size.y); gArea.pixelDensity(1); gArea.noStroke();
  gArea.image(img, 0, 0, area.size.x, area.size.y, area.coords.x1, area.coords.y1, area.size.x, area.size.y);
  if (mode.draw === 'result')
    gArea.image(gResult, 0, 0, area.size.x, area.size.y, area.coords.x1, area.coords.y1, area.size.x, area.size.y);
  clipAreaBuffer();
}

function clipAreaBuffer() {
  let sx, sy;
  if (area.rotation.amount % 180 === 0) { sx = area.size.x; sy = area.size.y; }
  else { sx = area.size.y; sy = area.size.x; }
  preview.buffer.x = sx; preview.buffer.y = sy;

  if (gBuffer) gBuffer.remove();
  gBuffer = P.createGraphics(sx, sy); gBuffer.pixelDensity(1); gBuffer.imageMode(P.CENTER); gBuffer.noStroke();
  gBuffer.translate(sx / 2, sy / 2);
  gBuffer.push();
  gBuffer.rotate(radians(area.rotation.amount));
  gBuffer.image(gArea, 0, 0, area.size.x, area.size.y, 0, 0, area.size.x, area.size.y);
  gBuffer.pop();

  if (mode.shape !== 'rect') {
    gBuffer.drawingContext.globalCompositeOperation = 'destination-in';
    gBuffer.fill(0);
    if (mode.shape === 'ellipse') { gBuffer.ellipseMode(P.CENTER); gBuffer.ellipse(0, 0, sx, sy); gBuffer.ellipseMode(P.CORNERS); }
    else if (mode.shape === 'triangle') drawTriCenter(gBuffer, sx, sy, mode.shapeAngle);
  }
}

/////////////////////////////////////////////////////////////////////////////
// Live preview rendering (port of drawPreview / drawPreviewGraphics)
/////////////////////////////////////////////////////////////////////////////
function drawPreviewBuf() {
  if (!gPreview) return;
  gPreview.clear();
  gPreview.push();

  const dragging = leftDown && gArea && mode.select !== 'erase';
  if (dragging || (preview.select && mode.select !== 'erase')) {
    if (gBuffer) gPreview.image(gBuffer,
      preview.coords.x1, preview.coords.y1, preview.coords.x2, preview.coords.y2,
      0, 0, preview.buffer.x, preview.buffer.y);
  } else {
    if (mode.shape !== 'rect') {
      drawShapeOn(gPreview, preview.coords.x1, preview.coords.y1, preview.coords.x2, preview.coords.y2, mode.shape, mode.shapeAngle);
      gPreview.drawingContext.clip();
    }
    gPreview.image(img,
      preview.coords.x1, preview.coords.y1, preview.coords.x2, preview.coords.y2,
      preview.coords.x1, preview.coords.y1, preview.size.x, preview.size.y);
    if (mode.draw === 'result' && mode.select !== 'erase')
      gPreview.image(gResult,
        preview.coords.x1, preview.coords.y1, preview.coords.x2, preview.coords.y2,
        preview.coords.x1, preview.coords.y1, preview.size.x, preview.size.y);
  }
  gPreview.pop();
}

function drawPreviewOutline() {
  P.push();
  preview.stroke = (mode.select === 'erase' || (mode.select === 'buffer' && !preview.select)) ? '#FF0000' : '#000000';
  if (!(mode.select === 'buffer' && !preview.select)) P.fill(preview.fill);
  else P.noFill();
  P.stroke(preview.stroke);
  P.strokeWeight(max(1, GW / 800));
  drawShapeOn(P, form.coords.x1, form.coords.y1, form.coords.x2, form.coords.y2, mode.shape, mode.shapeAngle);
  P.pop();
}

/////////////////////////////////////////////////////////////////////////////
// Sketch
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'KLON', version: '0.2' });

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
    p.pixelDensity(1); p.rectMode(p.CORNERS); p.ellipseMode(p.CORNERS); p.noFill(); p.noStroke();
    displayCanvas.elt.style.display = 'block';
    displayCanvas.elt.style.cursor = 'crosshair';
    loadImageAsSource(makeDefaultImage());
    wirePointer();
    fitCanvas();
  };
  p.draw = () => {
    if (!img || !gResult) return;
    p.clear();
    if (cnv.bg.mode === 'custom') { p.push(); p.fill(cnv.bg.custom); p.rect(0, 0, p.width, p.height); p.pop(); }
    else { p.image(alphaImg, 0, 0, p.width, p.height); }

    gridData();

    if (cnv.source) p.image(img, 0, 0, p.width, p.height);
    if (cnv.result) p.image(gResult, 0, 0, p.width, p.height);

    if (leftDown && gArea && preview.coords.x2 > 0 && preview.coords.y2 > 0) {
      if (mode.select === 'erase') {
        gResult.push();
        gResult.drawingContext.globalCompositeOperation = 'destination-out';
        drawShapeOn(gResult, preview.coords.x1, preview.coords.y1, preview.coords.x2, preview.coords.y2, mode.shape, mode.shapeAngle);
        gResult.pop();
      } else if (preview.ready && gBuffer) {
        gResult.drawingContext.globalCompositeOperation = 'source-over';
        gResult.image(gBuffer, preview.coords.x1, preview.coords.y1, preview.size.x, preview.size.y, 0, 0, preview.buffer.x, preview.buffer.y);
      }
    }

    if (grid.show && !(leftDown && overCanvas)) p.image(gGrid, 0, 0, p.width, p.height);

    if (preview.coords.x2 > 0 && preview.coords.y2 > 0) {
      drawPreviewBuf();
      if (!(mode.select === 'erase' && !cnv.source)) p.image(gPreview, 0, 0, p.width, p.height);
      drawPreviewOutline();
    }
  };
  p.windowResized = () => fitCanvas();
});

/////////////////////////////////////////////////////////////////////////////
// Pointer + keys
/////////////////////////////////////////////////////////////////////////////
function pointerToImage(e) {
  const r = displayCanvas.elt.getBoundingClientRect();
  mx = (e.clientX - r.left) / r.width * GW;
  my = (e.clientY - r.top) / r.height * GH;
}

function onMouseDown() {
  if (!preview.select) area.rotation.amount = 0;
  gBackup.clear();
  gBackup.image(gResult, 0, 0, img.width, img.height);
  if (!preview.select) {
    if (mode.select === 'buffer') { preview.select = true; preview.ready = false; }
    area.coords.x1 = preview.coords.x1; area.coords.y1 = preview.coords.y1;
    area.coords.x2 = preview.coords.x2; area.coords.y2 = preview.coords.y2;
    area.size.x = preview.size.x; area.size.y = preview.size.y;
    makeGraphicsArea();
  }
  preview.ready = true;
}
function onMouseUp() {
  preview.ready = true;
  if (!preview.select) area.rotation.amount = 0;
}

function wirePointer() {
  const el = displayCanvas.elt;
  el.addEventListener('pointerenter', () => { overCanvas = true; });
  el.addEventListener('pointerleave', () => { overCanvas = false; });
  el.addEventListener('pointermove', (e) => { pointerToImage(e); });
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    leftDown = true; pointerToImage(e); onMouseDown();
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    if (leftDown) { leftDown = false; onMouseUp(); }
  });
  el.addEventListener('wheel', (e) => {
    if (!overCanvas) return;
    e.preventDefault();
    const dx = floor(e.deltaX * cnv.settings.sens);
    const dy = floor(e.deltaY * cnv.settings.sens);
    if (shiftDown) { const s = min(cnv.size.x, cnv.size.y); const m = max(dx, dy); cnv.size.x = s + m; cnv.size.y = s + m; }
    else { cnv.size.x += dx; cnv.size.y += dy; }
    cnv.size.x = round(min(max(cnv.size.x, cnv.size.min), cnv.size.width));
    cnv.size.y = round(min(max(cnv.size.y, cnv.size.min), cnv.size.height));
    tool.pane.refresh();
  }, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function clearCanvas() { if (gResult) gResult.clear(); }
function undoCanvas() {
  if (!gResult || !gBackup) return;
  gResult.clear();
  gResult.drawingContext.globalCompositeOperation = 'source-over';
  gResult.image(gBackup, 0, 0, img.width, img.height);
}
function cycleShape() {
  const i = mode.shapeType.indexOf(mode.shape);
  mode.shape = mode.shapeType[(i + 1) % mode.shapeType.length];
  if (gArea) clipAreaBuffer();
}
function cycleSelectMode() {
  if (mode.select === 'erase') mode.select = mode.last;
  else if (mode.select === 'buffer') mode.select = 'free';
  else mode.select = 'buffer';
  if (mode.select !== 'erase') mode.last = mode.select;
  if (mode.select === 'free') preview.select = false;
  area.rotation.amount = 0;
}
function toggleErase() {
  mode.select = mode.select === 'erase' ? mode.last : 'erase';
  if (mode.select !== 'erase') mode.last = mode.select;
}
function rotateShape() {
  area.rotation.amount = (area.rotation.amount + area.rotation.add) % 360;
  mode.shapeAngle = (mode.shapeAngle + 90) % 360;
  if (gArea) clipAreaBuffer();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') shiftDown = true;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.ctrlKey || e.metaKey) {
    if (e.code === 'KeyZ') { undoCanvas(); e.preventDefault(); }
    return;
  }
  if (e.altKey) return;
  switch (e.code) {
    case 'KeyR': rotateShape(); tool.pane.refresh(); e.preventDefault(); break;
    case 'KeyM': mode.draw = mode.draw === 'source' ? 'result' : 'source'; tool.pane.refresh(); e.preventDefault(); break;
    case 'KeyA': preview.select = false; area.rotation.amount = 0; e.preventDefault(); break;
    case 'KeyS': cycleSelectMode(); tool.pane.refresh(); e.preventDefault(); break;
    case 'KeyE': toggleErase(); tool.pane.refresh(); e.preventDefault(); break;
    case 'KeyG': grid.snap = !grid.snap; grid.show = grid.snap; grid.update = true; tool.pane.refresh(); e.preventDefault(); break;
    case 'KeyH': if (grid.snap) { grid.show = !grid.show; tool.pane.refresh(); } e.preventDefault(); break;
    case 'KeyI': cnv.source = !cnv.source; tool.pane.refresh(); e.preventDefault(); break;
    case 'KeyC': clearCanvas(); e.preventDefault(); break;
    case 'KeyT': cycleShape(); tool.pane.refresh(); e.preventDefault(); break;
    case 'ArrowUp':    if (grid.snap) { grid.ui.y = min(max(grid.ui.y - 1, grid.ui.min), grid.ui.max); if (grid.sync) grid.ui.x = grid.ui.y; grid.update = true; tool.pane.refresh(); } e.preventDefault(); break;
    case 'ArrowDown':  if (grid.snap) { grid.ui.y = min(max(grid.ui.y + 1, grid.ui.min), grid.ui.max); if (grid.sync) grid.ui.x = grid.ui.y; grid.update = true; tool.pane.refresh(); } e.preventDefault(); break;
    case 'ArrowLeft':  if (grid.snap) { grid.ui.x = min(max(grid.ui.x - 1, grid.ui.min), grid.ui.max); if (grid.sync) grid.ui.y = grid.ui.x; grid.update = true; tool.pane.refresh(); } e.preventDefault(); break;
    case 'ArrowRight': if (grid.snap) { grid.ui.x = min(max(grid.ui.x + 1, grid.ui.min), grid.ui.max); if (grid.sync) grid.ui.y = grid.ui.x; grid.update = true; tool.pane.refresh(); } e.preventDefault(); break;
  }
});
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftDown = false; });

/////////////////////////////////////////////////////////////////////////////
// Drag-drop — image becomes the source
/////////////////////////////////////////////////////////////////////////////
tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file || !/^image\//i.test(file.type) || file.type === 'image/svg+xml') return;
  const url = URL.createObjectURL(file);
  P.loadImage(url, (im) => { loadImageAsSource(im); URL.revokeObjectURL(url); }, () => URL.revokeObjectURL(url));
});

/////////////////////////////////////////////////////////////////////////////
// UI
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;

main.addButton({ title: 'Undo (Ctrl/Cmd + Z)' }).on('click', undoCanvas);
main.addButton({ title: 'Clear Result (C)' }).on('click', clearCanvas);
main.addButton({ title: 'New Default Image' }).on('click', () => loadImageAsSource(makeDefaultImage()));

const fMode = main.addFolder({ title: 'MODE' });
fMode.addBinding(mode, 'select', { label: 'Select (S/E)', options: SELECT_OPTS }).on('change', (ev) => {
  area.rotation.amount = 0;
  if (ev.value === 'free') preview.select = false;
  if (ev.value !== 'erase') mode.last = ev.value;
});
fMode.addBinding(mode, 'draw', { label: 'Draw (M)', options: DRAW_OPTS });
fMode.addBinding(mode, 'shape', { label: 'Shape (T)', options: SHAPE_OPTS }).on('change', () => { if (gArea) clipAreaBuffer(); });
fMode.addBinding(mode, 'shapeAngle', { label: 'Rotation (R)', options: ANGLE_OPTS }).on('change', () => { if (gArea) clipAreaBuffer(); });

const fCanvas = main.addFolder({ title: 'CANVAS', expanded: false });
fCanvas.addBinding(cnv, 'source', { label: 'Show Source (I)' });
fCanvas.addBinding(cnv, 'result', { label: 'Show Result' });
fCanvas.addBinding(cnv.bg, 'mode', { label: 'Background', options: BG_OPTS });
fCanvas.addBinding(cnv.bg, 'custom', { label: 'Canvas Color', view: 'color' });

const fSize = main.addFolder({ title: 'SIZE', expanded: false });
fSize.addBinding(cnv.size, 'x', { label: 'Width', min: cnv.size.min, max: 2000, step: 1 }).on('change', (e) => { cnv.size.x = round(e.value); });
fSize.addBinding(cnv.size, 'y', { label: 'Height', min: cnv.size.min, max: 2000, step: 1 }).on('change', (e) => { cnv.size.y = round(e.value); });
fSize.addBinding(cnv.settings, 'sens', { label: 'Wheel Sens', min: 0.05, max: 2, step: 0.05 });

const fGrid = main.addFolder({ title: 'GRID' });
fGrid.addBinding(grid, 'snap', { label: 'Snap (G)' }).on('change', () => { grid.show = grid.snap; grid.update = true; });
fGrid.addBinding(grid, 'show', { label: 'Show (H)' }).on('change', () => { grid.update = true; });
fGrid.addBinding(grid, 'sync', { label: 'Sync X/Y' }).on('change', () => { if (grid.sync) grid.ui.y = grid.ui.x; grid.update = true; tool.pane.refresh(); });
fGrid.addBinding(grid.ui, 'x', { label: 'Cells X (←→)', min: grid.ui.min, max: 8, step: 1 }).on('change', () => { if (grid.sync) grid.ui.y = grid.ui.x; if (!grid.snap) grid.snap = true; grid.update = true; tool.pane.refresh(); });
fGrid.addBinding(grid.ui, 'y', { label: 'Cells Y (↑↓)', min: grid.ui.min, max: 8, step: 1 }).on('change', () => { if (grid.sync) grid.ui.x = grid.ui.y; if (!grid.snap) grid.snap = true; grid.update = true; tool.pane.refresh(); });
const fGridAppear = fGrid.addFolder({ title: 'Appearance', expanded: false });
fGridAppear.addBinding(grid, 'opacity', { label: 'Opacity', min: 0.1, max: 1, step: 0.05 }).on('change', () => { grid.update = true; });
fGridAppear.addBinding(grid, 'width', { label: 'Width', min: 1, max: 4, step: 0.1 }).on('change', () => { grid.update = true; });
fGridAppear.addBinding(grid, 'color', { label: 'Color', options: GRID_COLOR_OPTS }).on('change', () => { grid.update = true; });

/////////////////////////////////////////////////////////////////////////////
// Export + OPTIONS + dev hook
/////////////////////////////////////////////////////////////////////////////
attachExport(tool.pages.export, { getCanvas: tool.getCanvas, name: 'klon' });

const opts = tool.pages.options;
opts.addBinding(cnv.image, 'size', { label: 'Image Size', readonly: true });
opts.addButton({ title: 'Rotate Shape (R)' }).on('click', () => { rotateShape(); tool.pane.refresh(); });
opts.addButton({ title: 'Reset Buffer (A)' }).on('click', () => { preview.select = false; area.rotation.amount = 0; });
opts.addButton({ title: 'Fullscreen (f)' }).on('click', () => tool.toggleFullscreen());

window.addEventListener('resize', fitCanvas);
exposeDebug('klon', {
  cnv, mode, grid, area, preview, form,
  loadImageAsSource, clearCanvas, undoCanvas, makeDefaultImage,
  get img() { return img; }, get hasArea() { return !!gArea; },
});
