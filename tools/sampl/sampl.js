// SAMPL — glyph-outline sampling. A phrase is laid out with opentype.js, then
// each glyph's vector outline is walked by Paper.js and re-sampled into an evenly
// spaced point field (density = sample factor). At every sampled point a small
// shape (ellipse / rect / triangle / polygon, with an optional concentric hole)
// is stamped, its SIZE / ROTATION / POSITION each modulated by a sin or 4D-style
// noise wave (phase driven by the point's index along the path AND the glyph's
// index), shrunk toward the path ends, and filled by one of several colour modes
// (single / palette sequence / palette transition / linear & radial gradient /
// dropped-image texture). The glyph outline itself can be drawn under the field.
// Sampling runs synchronously on the shared Paper.js scope. Live render = 2D
// canvas `ctx.fill(Path2D)`; SVG export = Paper.js reconstruction of the same
// field.
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachExport } from '../../js/etch/export.js';
import { alea } from '../../js/etch/noise.js';
import { createNoise3D } from '../../js/vendor/simplex/simplex-noise.js';
import { loadFont, parseFont, FONT_OPTIONS } from '../../js/etch/typography.js';
import { paletteLerp, attachPaletteControls } from '../../js/etch/palette.js';

/////////////////////////////////////////////////////////////////////////////
// Math + easing (subset of ease.js, referenced by the engine)
/////////////////////////////////////////////////////////////////////////////
const { sin, cos, round, floor, ceil, min, max, pow, abs, PI } = Math;
const TWO_PI = PI * 2;
const map = (v, a, b, c, d) => c + (d - c) * ((v - a) / (b - a));
const constrain = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const easeInQuad = (t) => t * t;
const easeOutExpo = (t) => (t === 1 ? 1 : -pow(2, -10 * t) + 1);
const easeInExpo = (t) => (t === 0 ? 0 : pow(2, 10 * (t - 1)));
const degrees = (r) => (r * 180) / PI;

/////////////////////////////////////////////////////////////////////////////
// Option maps
/////////////////////////////////////////////////////////////////////////////
const RATIOS = {
  '2:1': [480, 240], '16:9': [640, 360], '3:2': [480, 320], '4:3': [480, 360],
  '5:4': [600, 480], '1:1': [480, 480], '4:5': [480, 600], '3:4': [360, 480],
  '2:3': [320, 480], '9:16': [360, 640], '1:2': [240, 480],
};
const RATIO_OPTS = Object.fromEntries(Object.keys(RATIOS).map((k) => [k, k]));
const BG_OPTS = { Custom: 'custom', Transparent: 'transparent' };
const GLYPH_STYLE_OPTS = { None: 'none', Color: 'color' };
const FILL_OPTS = { None: 'none', 'Single Color': 'color', 'Palette Sequence': 'sequence', 'Palette Transition': 'transition', 'Linear Gradient': 'lgradient', 'Radial Gradient': 'rgradient', 'Image Texture': 'image' };
const MODE_OPTS = { None: 'none', Sinusoidal: 'sin', Noise: 'noise' };
const SHAPE_OPTS = { None: 'none', Ellipse: 'ellipse', Rect: 'rect', Triangle: 'triangle', Polygon: 'polygon' };
const EDGE_OPTS = { None: 'none', 'Shrink On Path End': 'end', 'Shrink Both Edges': 'both' };
const FREQ_MODE_OPTS = { None: 'none', 'From Position': 'pos', 'From Size': 'size', 'From Rotation': 'rotate' };
const ALIGN_X_OPTS = { Left: 'left', Center: 'center', Right: 'right' };
const ALIGN_Y_OPTS = { Top: 'top', Center: 'center', Bottom: 'bottom' };
const CASE_OPTS = { Uppercase: 'uppercase', Lowercase: 'lowercase' };
const IMG_ARRANGE_OPTS = { 'Sample Sequence': 'sample', 'Glyph Sequence': 'glyph' };

/////////////////////////////////////////////////////////////////////////////
// State — the default parameter tree
/////////////////////////////////////////////////////////////////////////////
const cnv = { ratio: '4:3', seed: 0, frame: 0, animation: true, color: { mode: 'custom', custom: '#0d0d0d' } };
const params = {
  text: 'SAM\nPLE',
  font: 'Anton',
  fill: { type: 'none', color: '#FFFFFF' },
  stroke: { type: 'none', color: '#000000', strokeJoin: 'round', width: 1, min: 0.5, max: 10 },
  size: { font: 140, min: 16, max: 720 },
  letterspace: { value: 100, min: 0, max: 200 },
  wordspace: { value: 100, min: 0, max: 200 },
  leading: { value: 80, min: 0, max: 200 },
  features: { kerning: true, ligatures: true },
  align: { x: 'center', y: 'center', baseCase: 'uppercase' },
  margin: { x: 0.95, y: 0.1, min: 0.1, max: 1 },
  offset: { x: 0, y: 0 },
  layout: { auto: true },
};
const sample = {
  shape: { type: 'ellipse', contour: 0, polypoints: 5, polypointsMax: 16, mod: 0, modMax: 0.85 },
  edge: 'both',
  factor: 0.3,
  image: { arrange: 'sample', mode: 'size', sequence: 0, level: 1, offset: { x: 0.5, y: 0.5 } },
  fill: { type: 'sequence', color: '#FFFFFF' },
  stroke: { type: 'none', color: '#000000', scale: false, width: 1, widthMax: 4 },
  size: { mode: 'sin', value: 35, offset: 1, limiter: { min: 0, max: 1 }, freq: { seed: 7727, value: 0.25, shift: 0.2, speed: 0.1 } },
  rotate: { mode: 'none', base: 0, value: 0.3, freq: { seed: 3873, value: 0.15, shift: 0.2, speed: 0.2 } },
  pos: { mode: 'none', value: 10, offset: 0, freq: { seed: 7798, value: 0.15, shift: 0.2, speed: 0.2 } },
};
const palette = {
  mode: 'size', mult: 0, index: 0,
  gradient: { level: 1, scale: 0.5, rotate: 0, offset: 0 },
  array: ['#ff4d6d', '#ffb703', '#8ecae6', '#3a86ff', '#06d6a0'],
};
const rec = { frameRate: 60, length: { value: 10, min: 1, max: 60 } };
const DEFAULTS = structuredClone({ cnv, params, sample, palette });

/////////////////////////////////////////////////////////////////////////////
// Seeded simplex — ONE shared noise field, with the per-channel seeds folded
// into the sample coordinate.
/////////////////////////////////////////////////////////////////////////////
let noise3D;
function seedEvent() { noise3D = createNoise3D(alea(cnv.seed)); }
seedEvent();

/////////////////////////////////////////////////////////////////////////////
// Glyph layout (opentype.js) → textObject { layout, glyph[], word[] }
/////////////////////////////////////////////////////////////////////////////
let GW = 480, GH = 360;
let FONT = null;
let textObject = { layout: { x: 0, y: 0, offset: { x: 0, y: 0 } }, glyph: [], word: [], totalGlyphs: 0 };

function validateNumber(v) { return Number.isFinite(v) ? v : 0; }

function findWidestGlyph(text) {
  let m = 0;
  for (const ch of text) { const w = FONT.charToGlyph(ch).advanceWidth; if (w > m) m = w; }
  return m;
}

function generateFontData() {
  const f = {};
  f.text = params.text;
  const maxGlyphWidth = findWidestGlyph(f.text);
  const letterspace = map(params.letterspace.value, params.letterspace.min, params.letterspace.max, -maxGlyphWidth, maxGlyphWidth);
  const wordspace = map(params.wordspace.value, params.wordspace.min, params.wordspace.max, params.wordspace.min / 100, params.wordspace.max / 100);
  const leadingF = map(params.leading.value, params.leading.min, params.leading.max, params.leading.min / 100, params.leading.max / 100);

  f.font = FONT;
  f.size = params.size.font;
  f.fontunit = params.size.font / FONT.unitsPerEm;
  f.tracking = params.size.font * (letterspace / FONT.unitsPerEm);
  f.ascender = (FONT.ascender / FONT.unitsPerEm) * params.size.font;
  f.descender = (FONT.descender / FONT.unitsPerEm) * params.size.font;
  f.leading = (f.ascender - f.descender) * leadingF;
  f.spaceWidth = FONT.charToGlyph(' ').advanceWidth * f.fontunit * wordspace + f.tracking;

  const ref = params.align.baseCase === 'uppercase' ? 'O' : 'o';
  const bbox = FONT.charToGlyph(ref).getBoundingBox();
  f.baseHeight = (bbox.y2 / FONT.unitsPerEm) * params.size.font;
  f.useKerning = params.features.kerning;
  f.useLigatures = params.features.ligatures;
  return f;
}

function generateGlyphs(fd, word) {
  const glyphs = fd.font.stringToGlyphs(word, { kerning: fd.useKerning, features: { liga: fd.useLigatures } });
  const isSpace = /^\s+$/.test(word);
  const data = { glyph: { char: [], path: [], svg: [], area: { xmin: [], xmax: [], ymin: [], ymax: [] }, pos: { x: [], y: [] }, center: { x: [], y: [] }, xAdvance: [] }, area: {} };
  let x = 0;
  const y = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i];
    const glyphPath = glyph.getPath(0, 0, fd.size);
    const svgString = glyphPath.toPathData(2) || ' ';

    let kern = i < glyphs.length - 1 ? fd.font.getKerningValue(glyphs[i], glyphs[i + 1]) : 0;
    kern = fd.useKerning ? validateNumber(kern * fd.fontunit) : 0;
    let gw = validateNumber(glyph.advanceWidth * fd.fontunit) + fd.tracking + kern;
    if (gw < 0) gw = 0;

    data.glyph.char.push(glyph.name);
    data.glyph.path.push(new Path2D(svgString));
    data.glyph.svg.push(svgString);

    const bb = glyph.getBoundingBox();
    const minX = validateNumber(bb.x1 * fd.fontunit), minY = validateNumber(bb.y1 * fd.fontunit);
    const maxX = validateNumber(bb.x2 * fd.fontunit), maxY = validateNumber(bb.y2 * fd.fontunit);
    data.glyph.pos.x.push(x); data.glyph.pos.y.push(y);
    data.glyph.area.xmin.push(minX); data.glyph.area.xmax.push(maxX);
    data.glyph.area.ymin.push(-minY); data.glyph.area.ymax.push(-maxY);
    data.glyph.center.x.push(minX + (maxX - minX) / 2);
    data.glyph.center.y.push(-(minY + (maxY - minY) / 2));
    data.glyph.xAdvance.push(gw);
    x += gw;
  }
  const last = data.glyph.char.length - 1;
  data.area.xmin = data.glyph.area.xmin[0];
  data.area.xmax = x - data.glyph.xAdvance[last] + data.glyph.area.xmax[last];
  data.area.ymin = max(...data.glyph.area.ymin);
  data.area.ymax = min(...data.glyph.area.ymax);
  data.advanceWidth = isSpace ? max(0, fd.spaceWidth) : max(0, x);
  return data;
}

function wrapText() {
  const fd = generateFontData();
  let words = fd.text.split(/(\n+|[^\S\r\n])/).filter(Boolean).flatMap((it) => (it.includes('\n') ? it.split('') : it));
  words = words.filter((it, idx, arr) => !(it.trim() === '' && arr[idx + 1] === '\n') || it === '\n');

  let x = 0, y = 0;
  const glyphArray = [], wordArray = [], lines = [];
  let currentLine = { words: [], width: 0 };

  const layout = {};
  layout.auto = params.layout.auto;
  layout.x = map(1 - params.margin.x, 0, 1, 0, GW) * 0.5;
  layout.xmax = GW - map(1 - params.margin.x, 0, 1, 0, GW) * 0.5;
  layout.width = GW * params.margin.x;
  layout.xline = GW * 0.5;
  layout.y = 0;
  layout.yline = map(params.margin.y, 0, 1, 0, GH);
  layout.ybase = fd.baseHeight + map(params.margin.y, 0, 1, 0, GH);
  layout.offset = { x: GW * params.offset.x, y: GH * params.offset.y };

  for (const word of words) {
    if (/^\n+$/.test(word)) { lines.push(currentLine); currentLine = { words: [], width: 0 }; x = 0; y += fd.leading * word.length; continue; }
    const wordData = generateGlyphs(fd, word);
    const wordWidth = wordData.advanceWidth;
    if (layout.auto && x + wordWidth > layout.width && currentLine.words.length > 0) { lines.push(currentLine); currentLine = { words: [], width: 0 }; x = 0; y += fd.leading; }
    if (!(layout.auto && currentLine.words.length === 0 && /^\s+$/.test(word))) {
      currentLine.words.push({ word, wordData, x, y });
      currentLine.width += wordWidth; x += wordWidth;
    }
  }
  if (currentLine.words.length > 0) lines.push(currentLine);

  for (const line of lines) {
    if (layout.auto) while (line.words.length > 0 && /^\s+$/.test(line.words[line.words.length - 1].word)) { const r = line.words.pop(); line.width -= r.wordData.advanceWidth; }
    let offsetX = 0;
    if (params.align.x === 'center') offsetX = (layout.width - line.width + fd.tracking) / 2;
    else if (params.align.x === 'right') offsetX = layout.width - line.width;

    for (const wdo of line.words) {
      const wd = wdo.wordData;
      let wordX = wdo.x + offsetX;
      for (let i = 0; i < wd.glyph.char.length; i++) {
        if (wd.glyph.char[i] === 'space') { wordX += wd.glyph.xAdvance[i]; continue; }
        glyphArray.push({
          char: wd.glyph.char[i], svg: wd.glyph.svg[i], path: wd.glyph.path[i],
          sample: [], sampleAll: [], posx: [], posy: [], rotate: [], scale: [], color: [],
          xAdvance: wd.glyph.xAdvance[i], x: wordX, y: wdo.y,
          bbox: { xmin: wd.glyph.area.xmin[i], xmax: wd.glyph.area.xmax[i], ymin: wd.glyph.area.ymin[i], ymax: wd.glyph.area.ymax[i] },
          center: { x: wd.glyph.center.x[i], y: wd.glyph.center.y[i] },
        });
        wordX += wd.glyph.xAdvance[i];
      }
      wordArray.push({ space: wd.glyph.char.join('').match('space') ? true : false, advanceWidth: wd.advanceWidth, x: wdo.x + offsetX, y: wdo.y, bbox: { xmin: wd.area.xmin, xmax: wd.area.xmax, ymin: wd.area.ymin, ymax: wd.area.ymax } });
    }
  }

  switch (params.align.y) {
    case 'top': layout.y = layout.ybase; break;
    case 'center': layout.y = (GH + fd.baseHeight - fd.leading * (lines.length - 1)) / 2; layout.yline = GH / 2; break;
    case 'bottom': layout.y = GH - map(params.margin.y, 0, 1, 0, GH) - fd.leading * (lines.length - 1); break;
  }

  return { layout, glyph: glyphArray, word: wordArray, totalGlyphs: glyphArray.length, totalPaths: 0, longestPoints: 0, shortestPoints: 0, maxGlyphPoints: 0, minGlyphPoints: 0 };
}

/////////////////////////////////////////////////////////////////////////////
// Sampling — walk each glyph outline with Paper.js and distribute points by
// arc length. Runs synchronously on the shared Paper.js scope.
/////////////////////////////////////////////////////////////////////////////
function distributePointsOnPath(path, numPoints) {
  const pts = [];
  const interval = path.length / numPoints;
  for (let i = 0; i < numPoints; i++) { const p = path.getPointAt(i * interval); if (p) pts.push({ x: p.x, y: p.y }); }
  return pts;
}
function distributePoints(shape, factor) {
  const total = shape.length;
  const numPoints = max(round(total * factor), 2);
  if (shape.children && shape.children.length) {
    const out = [];
    for (const child of shape.children) out.push(distributePointsOnPath(child, max(round((child.length / total) * numPoints), 2)));
    return out;
  }
  return [distributePointsOnPath(shape, numPoints)];
}

function sampleGlyphs() {
  if (!FONT || !window.paper) return;
  const paper = window.paper;
  const scratch = document.createElement('canvas'); scratch.width = GW; scratch.height = GH;
  paper.setup(scratch); paper.pixelRatio = 1;
  const factor = easeInQuad(sample.factor) * 2;
  let longest = 0, shortest = 1e9, maxGlyph = 0, minGlyph = 1e9, totalPaths = 0;
  for (const glyph of textObject.glyph) {
    let groups;
    try { groups = distributePoints(new paper.CompoundPath(glyph.svg), factor); }
    catch { groups = [[]]; }
    glyph.sample = groups;
    glyph.sampleAll = groups.flat();
    glyph.posx = []; glyph.posy = []; glyph.rotate = []; glyph.scale = []; glyph.color = [];
    for (const g of groups) {
      glyph.posx.push(new Array(g.length).fill(0));
      glyph.posy.push(new Array(g.length).fill(0));
      glyph.rotate.push(new Array(g.length).fill(0));
      glyph.scale.push(new Array(g.length).fill(0));
      glyph.color.push(new Array(g.length).fill(0));
      if (g.length > longest) longest = g.length;
      if (g.length < shortest) shortest = g.length;
    }
    totalPaths += groups.length;
    if (glyph.sampleAll.length > maxGlyph) maxGlyph = glyph.sampleAll.length;
    if (glyph.sampleAll.length < minGlyph) minGlyph = glyph.sampleAll.length;
  }
  textObject.totalPaths = totalPaths;
  textObject.longestPoints = longest;
  textObject.shortestPoints = shortest === 1e9 ? 0 : shortest;
  textObject.maxGlyphPoints = maxGlyph;
  textObject.minGlyphPoints = minGlyph === 1e9 ? 0 : minGlyph;
  paper.project.clear(); paper.view.remove();
}

/////////////////////////////////////////////////////////////////////////////
// Frame object — derive per-render numbers from params/sample/palette.
// Rebuilt on any control change.
/////////////////////////////////////////////////////////////////////////////
let F = null;

function buildPaletteArray() {
  const arr = palette.array.slice();
  const out = { array: [], mult: 1 };
  if (sample.fill.type === 'sequence') {
    out.mult = 1 + easeInExpo(1 - palette.mult) * 49;
    const len = round(arr.length * (1 + 49 * palette.mult));
    for (let i = 0; i < len; i++) out.array.push(arr[i % arr.length]);
  } else if (sample.fill.type === 'transition') {
    const len = round(arr.length * (1 + 24 * palette.mult));
    const denom = Math.max(1, len - 1);
    for (let i = 0; i < len; i++) out.array.push([arr[i % arr.length], i / denom]);
  }
  return out;
}

function updateFrameObjectData() {
  const totalFrames = rec.length.value * rec.frameRate;
  F = {};
  F.bg = { mode: cnv.color.mode, color: cnv.color.custom };

  F.shape = { mod: { x: 1 + sample.shape.mod, y: 1 - sample.shape.mod }, modWidth: 1 + sample.shape.mod, modHeight: 1 - sample.shape.mod };
  F.shape.size = map(sample.size.value, 0, 100, 0, params.size.font * 0.5);
  if (sample.shape.type === 'polygon') { F.shape.modWidth = max(1 + sample.shape.mod, 1 - sample.shape.mod); F.shape.modHeight = F.shape.modWidth; }
  F.shape.width = F.shape.size * F.shape.modWidth;
  F.shape.height = F.shape.size * F.shape.modHeight;
  F.shape.path = generatePath2DShape(sample.shape.type, F.shape.size, F.shape.mod, sample.shape.polypoints, sample.shape.contour);

  F.edge = sample.edge;
  F.glyphStrokeWidth = map(params.stroke.width, params.stroke.min, params.stroke.max, params.stroke.min, params.size.font * 0.1);
  F.totalGlyphs = textObject.totalGlyphs;
  F.longestPath = textObject.longestPoints;
  F.averageGlyphPoints = (textObject.minGlyphPoints + textObject.maxGlyphPoints) / 2;

  const pal = buildPaletteArray();
  F.palette = { array: pal.array, mode: palette.mode, mult: pal.mult };

  F.gradient = {};
  F.gradient.array = palette.array.slice();
  F.gradient.level = palette.gradient.level;
  F.gradient.width = F.shape.width * map(palette.gradient.scale, 0, 2, 0.01, 2);
  F.gradient.height = F.shape.height * map(palette.gradient.scale, 0, 2, 0.01, 2);
  F.gradient.sin = sin(palette.gradient.rotate * PI);
  F.gradient.cos = cos(palette.gradient.rotate * PI);
  if (palette.mode === 'none') F.gradient.level = 0;
  else {
    if (palette.mode === 'size' && sample.size.mode === 'none') F.gradient.level = 0;
    if (palette.mode === 'rotate' && sample.rotate.mode === 'none') F.gradient.level = 0;
    if (palette.mode === 'pos' && sample.pos.mode === 'none') F.gradient.level = 0;
  }
  F.gradient.xoff = 0; F.gradient.yoff = 0;
  if (sample.fill.type === 'lgradient') { F.gradient.xoff = F.shape.width * palette.gradient.offset * F.gradient.sin; F.gradient.yoff = F.shape.height * palette.gradient.offset * F.gradient.cos; }
  if (sample.fill.type === 'rgradient') { F.gradient.xoff = F.gradient.width * palette.gradient.offset * F.gradient.sin; F.gradient.yoff = F.gradient.height * palette.gradient.offset * F.gradient.cos; }

  F.image = { mode: sample.image.mode, arrange: sample.image.arrange, sequence: sample.image.sequence, level: sample.image.mode === 'none' ? 1 : 1.001 - sample.image.level, offset: { x: sample.image.offset.x, y: sample.image.offset.y } };

  F.fill = { type: sample.fill.type, color: sample.fill.color };
  F.stroke = { type: sample.stroke.type, scale: sample.stroke.scale, color: sample.stroke.color, width: sample.stroke.width };

  F.pos = { mode: sample.pos.mode, seed: sample.pos.freq.seed };
  F.pos.value = sample.pos.mode === 'none' ? 0 : (sample.pos.value / 100) * params.size.font * 0.66;
  F.pos.offset = { x: sample.pos.offset <= 0 ? 1 : 1 - sample.pos.offset, y: sample.pos.offset >= 0 ? 1 : sample.pos.offset + 1 };
  F.pos.index = sample.pos.offset <= 0 ? 0 : 1;
  F.pos.freq = { value: sample.pos.freq.value * 100, speed: totalFrames * map(sample.pos.freq.speed, 0, 1, 0, 0.005), shift: easeInQuad(sample.pos.freq.shift) * F.totalGlyphs };
  if (sample.pos.mode === 'sin') F.pos.freq.speed = round(F.pos.freq.speed * 3);
  if (sample.pos.mode === 'noise') F.pos.freq.value *= 0.25;

  F.size = { mode: sample.size.mode, seed: sample.size.freq.seed };
  F.size.offset = { min: sample.size.offset - 1, max: sample.size.offset };
  F.size.limit = {
    min: max(sample.size.limiter.min + F.size.offset.min, sample.size.limiter.min * F.size.offset.max),
    max: max(sample.size.limiter.max + F.size.offset.min, sample.size.limiter.max * F.size.offset.max),
  };
  F.size.freq = { value: sample.size.freq.value * 100, speed: totalFrames * map(sample.size.freq.speed, 0, 1, 0, 0.005), shift: sample.size.freq.shift * F.totalGlyphs };
  if (sample.size.mode === 'sin') F.size.freq.speed = ceil(F.size.freq.speed * 3 - 0.001);
  if (sample.size.mode === 'noise') F.size.freq.value *= 0.25;

  F.rotate = { mode: sample.rotate.mode, seed: sample.rotate.freq.seed, base: sample.rotate.base * TWO_PI, value: sample.rotate.mode === 'none' ? 0 : sample.rotate.value * PI };
  F.rotate.freq = { value: sample.rotate.freq.value * 100, speed: totalFrames * map(sample.rotate.freq.speed, 0, 1, 0, 0.005), shift: sample.rotate.freq.shift * F.totalGlyphs };
  if (sample.rotate.mode === 'sin') F.rotate.freq.speed = round(F.rotate.freq.speed * 3);
  if (sample.rotate.mode === 'noise') F.rotate.freq.value *= 0.25;
}

function generatePath2DShape(shape, shapeSize, mod, polypoints, contour) {
  const p = new Path2D();
  const w = (shapeSize / 2) * mod.x, h = (shapeSize / 2) * mod.y;
  const iw = w * contour, ih = h * contour;
  switch (shape) {
    case 'ellipse':
      p.ellipse(0, 0, abs(w), abs(h), 0, 0, TWO_PI);
      if (contour > 0.01) p.ellipse(0, 0, abs(iw), abs(ih), 0, TWO_PI, 0, true);
      break;
    case 'rect':
      p.moveTo(-w, -h); p.lineTo(w, -h); p.lineTo(w, h); p.lineTo(-w, h); p.closePath();
      if (contour > 0.01) { p.moveTo(-iw, -ih); p.lineTo(-iw, ih); p.lineTo(iw, ih); p.lineTo(iw, -ih); p.closePath(); }
      break;
    case 'triangle':
      p.moveTo(0, -h); p.lineTo(-w, h); p.lineTo(w, h); p.closePath();
      if (contour > 0.01) { p.moveTo(0, -ih); p.lineTo(-iw, ih); p.lineTo(iw, ih); p.closePath(); }
      break;
    case 'polygon':
      for (let i = 0; i < polypoints * 2; i++) { const a = (PI / polypoints) * i, r = i % 2 === 0 ? w : h; i === 0 ? p.moveTo(cos(a) * r, sin(a) * r) : p.lineTo(cos(a) * r, sin(a) * r); }
      p.closePath();
      if (contour > 0.01) { for (let i = 0; i < polypoints * 2; i++) { const a = (PI / polypoints) * i, r = i % 2 === 0 ? iw : ih; i === 0 ? p.moveTo(cos(a) * r, sin(a) * r) : p.lineTo(cos(a) * r, sin(a) * r); } p.closePath(); }
      break;
  }
  return p;
}

/////////////////////////////////////////////////////////////////////////////
// Per-point modulation (sin / noise) — phase from the point index along the
// path (freqIndex) and the glyph index. `frame` is the normalized loop time.
/////////////////////////////////////////////////////////////////////////////
let frame = 0;

function sizeRaw(freqIndex, glyphIndex) {
  if (F.size.mode === 'sin') return (1 + sin(TWO_PI * frame * F.size.freq.speed - freqIndex * F.size.freq.value - glyphIndex * F.size.freq.shift)) / 2;
  if (F.size.mode === 'noise') return (1 + noise3D(F.size.seed + freqIndex * F.size.freq.value - glyphIndex * F.size.freq.shift, F.size.freq.speed * sin(TWO_PI * frame), F.size.freq.speed * cos(TWO_PI * frame))) / 2;
  return 1;
}
function rotateRaw(freqIndex, glyphIndex) {
  if (F.rotate.mode === 'sin') return (1 + sin(TWO_PI * frame * F.rotate.freq.speed - freqIndex * F.rotate.freq.value - glyphIndex * F.rotate.freq.shift)) / 2;
  if (F.rotate.mode === 'noise') return (1 + noise3D(F.rotate.seed + freqIndex * F.rotate.freq.value - glyphIndex * F.rotate.freq.shift, F.rotate.freq.speed * sin(TWO_PI * frame), F.rotate.freq.speed * cos(TWO_PI * frame))) / 2;
  return 1;
}
function posRaw(freqIndex, glyphIndex) {
  if (F.pos.mode === 'sin') {
    const s = sin(TWO_PI * frame * F.pos.freq.speed - freqIndex * F.pos.freq.value - glyphIndex * F.pos.freq.shift) * F.pos.offset.x;
    const c = cos(TWO_PI * frame * F.pos.freq.speed - freqIndex * F.pos.freq.value - glyphIndex * F.pos.freq.shift) * F.pos.offset.y;
    return [(1 + s) / 2, (1 + c) / 2];
  }
  if (F.pos.mode === 'noise') {
    const s = noise3D(F.pos.seed + freqIndex * F.pos.freq.value - glyphIndex * F.pos.freq.shift, F.pos.freq.speed * sin(TWO_PI * frame), F.pos.freq.speed * cos(TWO_PI * frame)) * F.pos.offset.x;
    const c = noise3D(12302 + F.pos.seed + freqIndex * F.pos.freq.value - glyphIndex * F.pos.freq.shift, F.pos.freq.speed * sin(TWO_PI * frame), F.pos.freq.speed * cos(TWO_PI * frame)) * F.pos.offset.y;
    return [(1 + s) / 2, (1 + c) / 2];
  }
  return [1, 1];
}
function normalizeSize(rawSize) {
  const o = map(rawSize, 0, 1, F.size.offset.min, F.size.offset.max);
  return constrain(o + 0.01, F.size.limit.min, F.size.limit.max);
}
function edgeSizeFn(i, n, lo, hi) {
  if (F.edge === 'none') return 1;
  if (F.edge === 'end') return i > hi ? easeOutExpo(map(i, hi, n, 1, 0)) : 1;
  if (i < lo) return easeOutExpo(map(i, 0, lo, 0, 1));
  if (i > hi) return easeOutExpo(map(i, hi, n, 1, 0));
  return 1;
}
function paletteValue(rawSize, rawPos, rawRot) {
  if (palette.mode === 'size') return rawSize;
  if (palette.mode === 'pos') return rawPos;
  if (palette.mode === 'rotate') return rawRot;
  return 1;
}

/////////////////////////////////////////////////////////////////////////////
// Fill functions — write into the colorGroup (used by SVG export) + paint ctx.
/////////////////////////////////////////////////////////////////////////////
let userImage = null;

function applyFill(ctx, i, g, groupLen, rawSize, rawPos, rawRot, colorGroup) {
  const path = F.shape.path;
  switch (F.fill.type) {
    case 'none': return;
    case 'color': ctx.fillStyle = F.fill.color; ctx.fill(path, 'evenodd'); return;
    case 'sequence': {
      if (!F.palette.array.length) return;
      const v = paletteValue(rawSize, rawPos, rawRot);
      let idx = round((i / F.palette.mult) * v) % F.palette.array.length;
      idx = (idx + F.palette.array.length) % F.palette.array.length;
      colorGroup[i] = F.palette.array[idx];
      ctx.fillStyle = colorGroup[i]; ctx.fill(path, 'evenodd'); return;
    }
    case 'transition': {
      if (!F.palette.array.length) return;
      const v = paletteValue(rawSize, rawPos, rawRot);
      const noiseV = map(i, 0, groupLen, 0, v);
      const lenV = map(i, 0, groupLen, 0, 1);
      colorGroup[i] = paletteLerp(F.palette.array, (lenV + noiseV) / 2);
      ctx.fillStyle = colorGroup[i]; ctx.fill(path, 'evenodd'); return;
    }
    case 'lgradient': {
      const v = paletteValue(rawSize, rawPos, rawRot);
      const xM = map(v, 0, 1, -F.shape.width, F.shape.width) * F.gradient.level;
      const yM = map(v, 0, 1, -F.shape.height, F.shape.height) * F.gradient.level;
      const c = [(-F.gradient.width + xM) * F.gradient.sin + F.gradient.xoff, (-F.gradient.height + yM) * F.gradient.cos + F.gradient.yoff, (F.gradient.width + xM) * F.gradient.sin + F.gradient.xoff, (F.gradient.height + yM) * F.gradient.cos + F.gradient.yoff];
      colorGroup[i] = c;
      const grad = ctx.createLinearGradient(c[0], c[1], c[2], c[3]);
      for (let k = 0; k < F.gradient.array.length; k++) grad.addColorStop(k / max(1, F.gradient.array.length - 1), F.gradient.array[k]);
      ctx.fillStyle = grad; ctx.fill(path, 'evenodd'); return;
    }
    case 'rgradient': {
      const v = paletteValue(rawSize, rawPos, rawRot);
      const xM = map(v, 0, 1, -F.shape.width, F.shape.width) * F.gradient.level;
      const yM = map(v, 0, 1, -F.shape.height, F.shape.height) * F.gradient.level;
      const rad = max(F.gradient.width, F.gradient.height);
      const c = [F.gradient.xoff + xM * F.gradient.sin, F.gradient.yoff + yM * F.gradient.cos, F.gradient.xoff + xM * F.gradient.sin, F.gradient.yoff + yM * F.gradient.cos];
      colorGroup[i] = c;
      const grad = ctx.createRadialGradient(c[0], c[1], 0, c[2], c[3], max(abs(rad), 0.01));
      for (let k = 0; k < F.gradient.array.length; k++) grad.addColorStop(k / max(1, F.gradient.array.length - 1), F.gradient.array[k]);
      ctx.fillStyle = grad; ctx.fill(path, 'evenodd'); return;
    }
    case 'image': {
      if (!userImage) return;
      const base = F.image.mode === 'size' ? rawSize : F.image.mode === 'pos' ? rawPos : F.image.mode === 'rotate' ? rawRot : 1;
      const effect = map(base, 0, 1, F.image.level, 1);
      const w = F.shape.width, h = F.shape.height;
      const iw = userImage.width, ih = userImage.height;
      const sw = iw * effect, sh = ih * effect;
      const sx = (iw - sw) * F.image.offset.x, sy = (ih - sh) * F.image.offset.y;
      ctx.save(); ctx.clip(path, 'evenodd');
      ctx.drawImage(userImage, sx, sy, sw, sh, -w, -h, w * 2, h * 2);
      ctx.restore(); return;
    }
  }
}

/////////////////////////////////////////////////////////////////////////////
// Draw
/////////////////////////////////////////////////////////////////////////////
function drawGlyphs(ctx) {
  if (params.fill.type === 'none' && params.stroke.type === 'none') return;
  for (const glyph of textObject.glyph) {
    ctx.save();
    ctx.translate(glyph.x, glyph.y);
    if (params.fill.type !== 'none') { ctx.fillStyle = params.fill.color; ctx.fill(glyph.path); }
    if (params.stroke.type !== 'none') { ctx.lineWidth = F.glyphStrokeWidth; ctx.strokeStyle = params.stroke.color; ctx.lineJoin = params.stroke.strokeJoin; ctx.stroke(glyph.path); }
    ctx.restore();
  }
}

function drawSamplingPoints(ctx) {
  for (let gi = 0; gi < textObject.glyph.length; gi++) {
    const glyph = textObject.glyph[gi];
    let glyphFrame = 0;
    const glyphIndex = map(gi, 0, F.totalGlyphs, 0, TWO_PI);
    const sampleLengthFactor = map(glyph.sampleAll.length, 0, F.averageGlyphPoints, 0, 1);
    ctx.save();
    ctx.translate(glyph.x, glyph.y);
    for (let s = 0; s < glyph.sample.length; s++) {
      const grp = glyph.sample[s];
      const posx = glyph.posx[s], posy = glyph.posy[s], rotg = glyph.rotate[s], scaleg = glyph.scale[s], colorg = glyph.color[s];
      const lo = grp.length * map(grp.length, 0, F.longestPath, 0.5, 0.1);
      const hi = grp.length * map(grp.length, 0, F.longestPath, 0.5, 0.9);
      for (let i = 0; i < grp.length; i++) {
        ctx.save();
        const freqIndex = map(glyphFrame, 0, glyph.sampleAll.length, 0, PI) * sampleLengthFactor;
        const rawPos = posRaw(freqIndex, glyphIndex);
        posx[i] = grp[i].x + (rawPos[0] * 2 - 1) * F.pos.value;
        posy[i] = grp[i].y + (rawPos[1] * 2 - 1) * F.pos.value;
        const rawRot = rotateRaw(freqIndex, glyphIndex);
        rotg[i] = F.rotate.base + (rawRot * 2 - 1) * F.rotate.value;
        const edge = edgeSizeFn(i, grp.length, lo, hi);
        const rawSize = sizeRaw(freqIndex, glyphIndex);
        scaleg[i] = normalizeSize(rawSize) * edge;

        ctx.translate(posx[i], posy[i]);
        ctx.rotate(rotg[i]);
        ctx.scale(scaleg[i], scaleg[i]);

        if (F.stroke.type === 'color') { ctx.strokeStyle = F.stroke.color; ctx.lineWidth = F.stroke.width / (F.stroke.scale ? 1 : (scaleg[i] || 1)); ctx.lineJoin = params.stroke.strokeJoin; ctx.stroke(F.shape.path); }
        applyFill(ctx, i, gi, grp.length - 1, rawSize, rawPos[F.pos.index], rawRot, colorg);

        ctx.restore();
        glyphFrame++;
      }
    }
    ctx.restore();
  }
}

/////////////////////////////////////////////////////////////////////////////
// Rebuild pipeline
/////////////////////////////////////////////////////////////////////////////
function regenerate() {
  if (!FONT) return;
  textObject = wrapText();
  sampleGlyphs();
  updateFrameObjectData();
}

/////////////////////////////////////////////////////////////////////////////
// p5 sketch (fixed render-space canvas, CSS-fit to viewport)
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'SAMPL', version: '0.2' });
let P = null, displayCanvas = null, pendingPreset = null;

function fitCanvas() {
  if (!displayCanvas) return;
  const pad = 48;
  const k = min((window.innerWidth - pad * 2) / GW, (window.innerHeight - pad * 2) / GH);
  displayCanvas.elt.style.width = `${GW * k}px`;
  displayCanvas.elt.style.height = `${GH * k}px`;
}
function applyRatio() {
  [GW, GH] = RATIOS[cnv.ratio];
  if (P) { P.resizeCanvas(GW, GH); P.pixelDensity(2); }
  fitCanvas();
  regenerate();
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
    loadFont(params.font).then((f) => { FONT = f; regenerate(); });
  };
  p.draw = () => {
    if (pendingPreset && FONT) { const n = pendingPreset; pendingPreset = null; applyPreset(n); }
    const ctx = displayCanvas.elt.getContext('2d');
    const pd = p.pixelDensity();
    const totalFrames = rec.length.value * rec.frameRate;
    frame = cnv.frame / totalFrames;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, displayCanvas.elt.width, displayCanvas.elt.height);
    ctx.setTransform(pd, 0, 0, pd, 0, 0); // logical (GW×GH) → device pixels
    if (F && F.bg.mode === 'custom') { ctx.fillStyle = F.bg.color; ctx.fillRect(0, 0, GW, GH); }
    else drawChecker(ctx);
    if (FONT && F) {
      ctx.save();
      ctx.translate(textObject.layout.offset.x, textObject.layout.offset.y);
      ctx.translate(textObject.layout.x, textObject.layout.y);
      drawGlyphs(ctx);
      if (sample.shape.type !== 'none') drawSamplingPoints(ctx);
      ctx.restore();
    }
    if (cnv.animation) cnv.frame = frame >= 1 ? 0 : cnv.frame + 1;
  };
  p.windowResized = () => fitCanvas();
});

/////////////////////////////////////////////////////////////////////////////
// SVG export — reconstruct the field with Paper.js.
/////////////////////////////////////////////////////////////////////////////
function renderSVG() {
  const paper = window.paper;
  if (!paper || !FONT || !F) { console.warn('Paper.js / font not ready — SVG export unavailable'); return ''; }
  const c = document.createElement('canvas'); c.width = GW; c.height = GH;
  paper.setup(c); paper.pixelRatio = 1;

  const bg = new paper.Shape.Rectangle(new paper.Rectangle(0, 0, GW, GH));
  bg.fillColor = F.bg.mode === 'custom' ? F.bg.color : '#FFFFFF00';
  new paper.Layer({ position: paper.view.center, children: [bg] });

  const lx = textObject.layout.x + textObject.layout.offset.x;
  const ly = textObject.layout.y + textObject.layout.offset.y;

  if (params.fill.type !== 'none' || params.stroke.type !== 'none') {
    const mask = new paper.Shape.Rectangle(new paper.Rectangle(0, 0, GW, GH));
    mask.translate(-lx, -ly);
    const layer = new paper.Layer({ position: new paper.Point(0, 0), applyMatrix: false });
    layer.translate(lx, ly); layer.addChildren([mask]);
    const arr = [];
    for (let i = 0; i < textObject.glyph.length; i++) {
      const glyph = textObject.glyph[i];
      const cp = new paper.CompoundPath(glyph.svg);
      cp.translate(new paper.Point(glyph.x, glyph.y));
      if (params.fill.type !== 'none') cp.fillColor = params.fill.color;
      if (params.stroke.type !== 'none') { cp.strokeColor = params.stroke.color; cp.strokeJoin = params.stroke.strokeJoin; cp.strokeWidth = F.glyphStrokeWidth; }
      arr.push(cp);
    }
    layer.addChildren(arr); layer.clipped = true;
  }

  if (sample.shape.type !== 'none') {
    const mask = new paper.Shape.Rectangle(new paper.Rectangle(0, 0, GW, GH));
    mask.translate(-lx, -ly);
    const layer = new paper.Layer({ position: new paper.Point(0, 0), applyMatrix: false });
    layer.translate(lx, ly); layer.addChildren([mask]);
    const mainShape = createCompoundShape(sample.shape.type, F.shape.size, F.shape.mod, sample.shape.polypoints, sample.shape.contour);

    for (let gi = 0; gi < textObject.glyph.length; gi++) {
      const glyph = textObject.glyph[gi];
      for (let s = 0; s < glyph.sample.length; s++) {
        const grp = glyph.sample[s], posx = glyph.posx[s], posy = glyph.posy[s], rotg = glyph.rotate[s], scaleg = glyph.scale[s], colorg = glyph.color[s];
        const shapes = [];
        for (let i = 0; i < grp.length; i++) {
          if (scaleg[i] <= 0) continue;
          const it = mainShape.clone();
          const center = it.bounds.center;
          paintSVGShape(paper, it, colorg, i, center);
          it.scale(scaleg[i], scaleg[i], new paper.Point(-center.x * scaleg[i], -center.y * scaleg[i]));
          const sc = it.bounds.center;
          it.rotate(degrees(rotg[i]), new paper.Point(-sc.x * (1 - scaleg[i]), -sc.y * (1 - scaleg[i])));
          it.translate(new paper.Point(glyph.x, glyph.y));
          it.translate(new paper.Point(posx[i], posy[i]));
          if (sample.stroke.type !== 'none') { it.strokeColor = F.stroke.color; it.strokeJoin = params.stroke.strokeJoin; it.strokeWidth = F.stroke.width * 0.5 * (sample.stroke.scale ? scaleg[i] : 1); }
          shapes.push(it);
        }
        layer.addChildren(shapes);
      }
    }
    mainShape.remove(); layer.clipped = true;
  }

  paper.view.draw();
  const svg = paper.project.exportSVG({ asString: true });
  paper.project.clear(); paper.view.remove();
  return svg;
}

function paintSVGShape(paper, it, colorg, i, center) {
  switch (F.fill.type) {
    case 'image': case 'color': it.fillColor = F.fill.color; break;
    case 'sequence': case 'transition': it.fillColor = colorg[i] || F.fill.color; break;
    case 'lgradient': case 'rgradient': {
      const stops = [];
      for (let k = 0; k < F.gradient.array.length; k++) stops.push([F.gradient.array[k], k / max(1, F.gradient.array.length - 1)]);
      const cc = colorg[i] || [0, 0, 0, 0];
      if (F.fill.type === 'lgradient') {
        it.fillColor = { gradient: { stops }, origin: new paper.Point(center.x + cc[0], center.y + cc[1]), destination: new paper.Point(center.x + cc[2], center.y + cc[3]) };
      } else {
        const rSize = max(F.gradient.width, F.gradient.height) * 0.707;
        it.fillColor = { gradient: { stops, radial: true }, origin: new paper.Point(center.x + cc[0], center.y + cc[1]), destination: new paper.Point(center.x + cc[0] + rSize, center.y + cc[1] + rSize) };
      }
      break;
    }
    default: it.fillColor = F.fill.color;
  }
}

function createCompoundShape(type, shapeSize, mod, polypoints, contour) {
  const paper = window.paper;
  const w = (shapeSize / 2) * mod.x, h = (shapeSize / 2) * mod.y;
  const iw = w * contour, ih = h * contour;
  let outer, inner;
  switch (type) {
    case 'rect': outer = new paper.Path.Rectangle({ point: [-w, -h], size: [w * 2, h * 2] }); inner = new paper.Path.Rectangle({ point: [-iw, -ih], size: [iw * 2, ih * 2] }); break;
    case 'ellipse': outer = new paper.Path.Ellipse({ center: [0, 0], radius: [w, h] }); inner = new paper.Path.Ellipse({ center: [0, 0], radius: [iw, ih] }); break;
    case 'triangle':
      outer = new paper.Path(); outer.add(new paper.Point(0, -h)); outer.add(new paper.Point(-w, h)); outer.add(new paper.Point(w, h)); outer.closePath();
      inner = new paper.Path(); inner.add(new paper.Point(0, -ih)); inner.add(new paper.Point(-iw, ih)); inner.add(new paper.Point(iw, ih)); inner.closePath();
      break;
    case 'polygon':
      outer = new paper.Path();
      for (let i = 0; i < polypoints * 2; i++) { const a = (TWO_PI / (polypoints * 2)) * i, r = i % 2 === 0 ? w : h; i === 0 ? outer.moveTo(new paper.Point(cos(a) * r, sin(a) * r)) : outer.lineTo(new paper.Point(cos(a) * r, sin(a) * r)); }
      outer.closePath();
      inner = new paper.Path();
      for (let i = 0; i < polypoints * 2; i++) { const a = (TWO_PI / (polypoints * 2)) * i, r = i % 2 === 0 ? iw : ih; i === 0 ? inner.moveTo(new paper.Point(cos(a) * r, sin(a) * r)) : inner.lineTo(new paper.Point(cos(a) * r, sin(a) * r)); }
      inner.closePath();
      break;
  }
  if (contour > 0.01) { inner.clockwise = false; return new paper.CompoundPath({ children: [outer, inner], fillRule: 'evenodd' }); }
  inner.remove();
  return outer;
}

/////////////////////////////////////////////////////////////////////////////
// Drag-drop: font (.ttf/.otf/.woff) or image (texture fill)
/////////////////////////////////////////////////////////////////////////////
tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (/\.(ttf|otf|woff)$/i.test(file.name)) {
    const r = new FileReader();
    r.onload = () => { try { FONT = parseFont(r.result); regenerate(); } catch (err) { console.error('font parse failed', err); } };
    r.readAsArrayBuffer(file);
  } else if (/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { userImage = img; sample.fill.type = 'image'; tool.pane.refresh(); fillUI(); updateFrameObjectData(); URL.revokeObjectURL(url); };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }
});

/////////////////////////////////////////////////////////////////////////////
// UI
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;
const refresh = () => { if (F) updateFrameObjectData(); };

const fCanvas = main.addFolder({ title: 'CANVAS', expanded: false });
fCanvas.addBinding(cnv, 'ratio', { label: 'Canvas Ratio', options: RATIO_OPTS }).on('change', applyRatio);
fCanvas.addBinding(cnv.color, 'mode', { label: 'Background', options: BG_OPTS }).on('change', () => { bgUI(); refresh(); });
const bgColor = fCanvas.addBinding(cnv.color, 'custom', { label: 'BG Color', view: 'color' }).on('change', refresh);
fCanvas.addBinding(cnv, 'seed', { label: 'Noise Seed', min: 0, max: 10000, step: 1 }).on('change', () => { seedEvent(); });

const fText = main.addFolder({ title: 'TEXT' });
fText.addBinding(params, 'font', { label: 'Font', options: FONT_OPTIONS }).on('change', (ev) => { loadFont(ev.value).then((f) => { FONT = f; regenerate(); }); });
fText.addBinding(params, 'text', { label: 'Text', multiline: true, rows: 2 }).on('change', regenerate);
fText.addBinding(params.size, 'font', { label: 'Font Size', min: params.size.min, max: params.size.max, step: 0.1 }).on('change', regenerate);
fText.addBinding(params.letterspace, 'value', { label: 'Letter Space', min: params.letterspace.min, max: params.letterspace.max, step: 1 }).on('change', regenerate);
fText.addBinding(params.wordspace, 'value', { label: 'Word Space', min: params.wordspace.min, max: params.wordspace.max, step: 1 }).on('change', regenerate);
fText.addBinding(params.leading, 'value', { label: 'Leading', min: params.leading.min, max: params.leading.max, step: 1 }).on('change', regenerate);
fText.addBinding(params.align, 'x', { label: 'Align X', options: ALIGN_X_OPTS }).on('change', regenerate);
fText.addBinding(params.align, 'y', { label: 'Align Y', options: ALIGN_Y_OPTS }).on('change', regenerate);
fText.addBinding(params.align, 'baseCase', { label: 'Height Base', options: CASE_OPTS }).on('change', regenerate);
fText.addBinding(params.margin, 'x', { label: 'Width Margin', min: params.margin.min, max: params.margin.max, step: 0.01 }).on('change', regenerate);
fText.addBinding(params.margin, 'y', { label: 'Top Margin', min: 0, max: 0.5, step: 0.01 }).on('change', regenerate);
fText.addBinding(params.offset, 'x', { label: 'Offset X', min: -0.5, max: 0.5, step: 0.01 }).on('change', regenerate);
fText.addBinding(params.offset, 'y', { label: 'Offset Y', min: -0.5, max: 0.5, step: 0.01 }).on('change', regenerate);
fText.addBinding(params.layout, 'auto', { label: 'Auto-Layout' }).on('change', regenerate);
fText.addBinding(params.features, 'kerning', { label: 'Kerning' }).on('change', regenerate);
fText.addBinding(params.features, 'ligatures', { label: 'Ligatures' }).on('change', regenerate);

const fGlyph = main.addFolder({ title: 'GLYPH STYLE', expanded: false });
fGlyph.addBinding(params.fill, 'type', { label: 'Fill', options: GLYPH_STYLE_OPTS });
fGlyph.addBinding(params.fill, 'color', { label: 'Fill Color', view: 'color' });
fGlyph.addBinding(params.stroke, 'type', { label: 'Stroke', options: GLYPH_STYLE_OPTS });
fGlyph.addBinding(params.stroke, 'color', { label: 'Stroke Color', view: 'color' });
fGlyph.addBinding(params.stroke, 'width', { label: 'Stroke Width', min: params.stroke.min, max: params.stroke.max, step: 0.1 }).on('change', refresh);

const fShape = main.addFolder({ title: 'SHAPE RENDER' });
fShape.addBinding(sample, 'factor', { label: 'Sample Density', min: 0.05, max: 1, step: 0.01 }).on('change', () => { sampleGlyphs(); refresh(); });
fShape.addBinding(sample.shape, 'type', { label: 'Shape', options: SHAPE_OPTS }).on('change', refresh);
fShape.addBinding(sample, 'edge', { label: 'Endpoints', options: EDGE_OPTS }).on('change', refresh);
fShape.addBinding(sample.shape, 'contour', { label: 'Contour (hole)', min: 0, max: 0.9, step: 0.01 }).on('change', refresh);
fShape.addBinding(sample.shape, 'mod', { label: 'Aspect Mod', min: -sample.shape.modMax, max: sample.shape.modMax, step: 0.01 }).on('change', refresh);
fShape.addBinding(sample.shape, 'polypoints', { label: 'Polygon Points', min: 2, max: sample.shape.polypointsMax, step: 1 }).on('change', refresh);

const fFill = main.addFolder({ title: 'SHAPE FILL' });
fFill.addBinding(sample.fill, 'type', { label: 'Fill Type', options: FILL_OPTS }).on('change', () => { fillUI(); refresh(); });
const fillColor = fFill.addBinding(sample.fill, 'color', { label: 'Color', view: 'color' }).on('change', refresh);
const palMode = fFill.addBinding(palette, 'mode', { label: 'Palette Drive', options: FREQ_MODE_OPTS }).on('change', refresh);
const palMult = fFill.addBinding(palette, 'mult', { label: 'Palette Mult', min: 0, max: 1, step: 0.01 }).on('change', refresh);
const gradLevel = fFill.addBinding(palette.gradient, 'level', { label: 'Gradient Level', min: 0, max: 1, step: 0.01 }).on('change', refresh);
const gradScale = fFill.addBinding(palette.gradient, 'scale', { label: 'Gradient Scale', min: 0, max: 2, step: 0.01 }).on('change', refresh);
const gradRotate = fFill.addBinding(palette.gradient, 'rotate', { label: 'Gradient Rotate', min: -1, max: 1, step: 0.01 }).on('change', refresh);
const gradOffset = fFill.addBinding(palette.gradient, 'offset', { label: 'Gradient Offset', min: -1, max: 1, step: 0.01 }).on('change', refresh);
const imgArrange = fFill.addBinding(sample.image, 'arrange', { label: 'Image Arrange', options: IMG_ARRANGE_OPTS }).on('change', refresh);
const imgMode = fFill.addBinding(sample.image, 'mode', { label: 'Image Scale Fx', options: FREQ_MODE_OPTS }).on('change', refresh);
const imgLevel = fFill.addBinding(sample.image, 'level', { label: 'Image Fx Level', min: 0, max: 1, step: 0.01 }).on('change', refresh);
const imgOffX = fFill.addBinding(sample.image.offset, 'x', { label: 'Image Off X', min: 0, max: 1, step: 0.01 }).on('change', refresh);
const imgOffY = fFill.addBinding(sample.image.offset, 'y', { label: 'Image Off Y', min: 0, max: 1, step: 0.01 }).on('change', refresh);
// palette swatches + Random/Shuffle live at the bottom of the fill folder
attachPaletteControls(fFill, { palette, pane: tool.pane, onChange: refresh });

const fStroke = main.addFolder({ title: 'SHAPE STROKE', expanded: false });
fStroke.addBinding(sample.stroke, 'type', { label: 'Stroke', options: GLYPH_STYLE_OPTS }).on('change', refresh);
fStroke.addBinding(sample.stroke, 'color', { label: 'Color', view: 'color' }).on('change', refresh);
fStroke.addBinding(sample.stroke, 'width', { label: 'Width', min: 0.5, max: sample.stroke.widthMax, step: 0.1 }).on('change', refresh);
fStroke.addBinding(sample.stroke, 'scale', { label: 'Scaling Impact' }).on('change', refresh);

function buildModeFolder(title, ch, isRotate) {
  const f = main.addFolder({ title, expanded: false });
  const isSize = title.includes('SIZE'), isPos = title.includes('POSITION');
  if (isRotate) f.addBinding(ch, 'base', { label: 'Base Angle', min: -0.5, max: 0.5, step: 0.01 }).on('change', refresh);
  f.addBinding(ch, 'mode', { label: 'Mode', options: MODE_OPTS }).on('change', refresh);
  f.addBinding(ch, 'value', { label: isSize ? 'Size Level' : isRotate ? 'Rotation Level' : 'Base Level', min: isSize ? 1 : 0, max: isPos || isSize ? 100 : 1, step: isPos || isSize ? 0.1 : 0.01 }).on('change', refresh);
  if (isPos) f.addBinding(ch, 'offset', { label: 'Direction', min: -1, max: 1, step: 0.01 }).on('change', refresh);
  if (isSize) {
    f.addBinding(ch, 'offset', { label: 'Size Offset', min: 0, max: 2, step: 0.01 }).on('change', refresh);
    f.addBinding(ch.limiter, 'min', { label: 'Limit Min', min: 0, max: 1, step: 0.01 }).on('change', refresh);
    f.addBinding(ch.limiter, 'max', { label: 'Limit Max', min: 0, max: 1, step: 0.01 }).on('change', refresh);
  }
  f.addBinding(ch.freq, 'value', { label: 'Frequency', min: 0, max: 1, step: 0.001 }).on('change', refresh);
  f.addBinding(ch.freq, 'shift', { label: 'Glyph Shift', min: 0, max: 1, step: 0.001 }).on('change', refresh);
  f.addBinding(ch.freq, 'speed', { label: 'Speed', min: 0, max: 1, step: 0.01 }).on('change', refresh);
  f.addBinding(ch.freq, 'seed', { label: 'Noise Seed', min: 0, max: 10000, step: 1 }).on('change', refresh);
}
buildModeFolder('MODE: POSITION', sample.pos, false);
buildModeFolder('MODE: SIZE', sample.size, false);
buildModeFolder('MODE: ROTATE', sample.rotate, true);

function bgUI() { bgColor.hidden = cnv.color.mode !== 'custom'; }
function fillUI() {
  const t = sample.fill.type;
  fillColor.hidden = t !== 'color';
  const pal = t === 'sequence' || t === 'transition';
  const grad = t === 'lgradient' || t === 'rgradient';
  palMode.hidden = !(pal || grad);
  palMult.hidden = !pal;
  gradLevel.hidden = !grad; gradScale.hidden = !grad; gradRotate.hidden = !grad; gradOffset.hidden = !grad;
  const img = t === 'image';
  imgArrange.hidden = !img; imgMode.hidden = !img; imgLevel.hidden = !img; imgOffX.hidden = !img; imgOffY.hidden = !img;
}

/////////////////////////////////////////////////////////////////////////////
// Presets (original names; reference parameter taxonomy)
/////////////////////////////////////////////////////////////////////////////
const presets = {
  'Sequence Bloom': {
    cnv: { ratio: '4:3', color: { mode: 'custom', custom: '#0d0d0d' }, seed: 0, frame: 0 },
    params: { text: 'SAM\nPLE', font: 'Anton', fill: { type: 'none' }, size: { font: 100 }, letterspace: { value: 100 }, leading: { value: 70 }, align: { x: 'center', y: 'center' } },
    sample: { shape: { type: 'ellipse', contour: 0, mod: 0 }, edge: 'both', factor: 0.58, fill: { type: 'sequence' }, stroke: { type: 'none' }, size: { mode: 'noise', value: 22, offset: 1.1, limiter: { min: 0.2, max: 1 }, freq: { seed: 7727, value: 0.08, shift: 0.1, speed: 0.2 } }, rotate: { mode: 'none', base: 0, value: 0 }, pos: { mode: 'none', value: 10, offset: -1 } },
    palette: { mode: 'size', mult: 0.2, array: ['#ff4d6d', '#ffb703', '#8ecae6', '#3a86ff', '#06d6a0'] },
  },
  'Transition Vision': {
    cnv: { ratio: '1:1', color: { mode: 'custom', custom: '#06070f' }, seed: 42, frame: 0 },
    params: { text: 'FLOW', font: 'Archivo Black', fill: { type: 'none' }, size: { font: 150 }, letterspace: { value: 100 }, align: { x: 'center', y: 'center' } },
    sample: { shape: { type: 'ellipse', contour: 0, mod: 0 }, edge: 'both', factor: 0.6, fill: { type: 'transition' }, stroke: { type: 'none' }, size: { mode: 'sin', value: 30, offset: 1, limiter: { min: 0, max: 1 }, freq: { seed: 7727, value: 0.2, shift: 0.18, speed: 0.25 } }, rotate: { mode: 'none', base: 0, value: 0 }, pos: { mode: 'none', value: 10, offset: 0 } },
    palette: { mode: 'size', mult: 0.4, array: ['#3a0ca3', '#7209b7', '#f72585', '#4cc9f0', '#4361ee'] },
  },
  'Wire Glyph': {
    cnv: { ratio: '16:9', color: { mode: 'custom', custom: '#101418' }, seed: 7, frame: 0 },
    params: { text: 'WIRE', font: 'Anton', fill: { type: 'none' }, size: { font: 150 }, letterspace: { value: 105 }, align: { x: 'center', y: 'center' } },
    sample: { shape: { type: 'rect', contour: 0, mod: 0 }, edge: 'none', factor: 0.5, fill: { type: 'none' }, stroke: { type: 'color', color: '#7bf1a8', scale: false, width: 1.2 }, size: { mode: 'sin', value: 24, offset: 1, limiter: { min: 0, max: 1 }, freq: { seed: 7727, value: 0.15, shift: 0.12, speed: 0.3 } }, rotate: { mode: 'sin', base: 0, value: 0.5, freq: { seed: 3873, value: 0.1, shift: 0.2, speed: 0.4 } }, pos: { mode: 'none', value: 10, offset: 0 } },
    palette: { mode: 'size', mult: 0 },
  },
  'Radial Pop': {
    cnv: { ratio: '4:5', color: { mode: 'custom', custom: '#fff3d6' }, seed: 333, frame: 0 },
    params: { text: 'POP', font: 'Archivo Black', fill: { type: 'none' }, size: { font: 168 }, letterspace: { value: 95 }, align: { x: 'center', y: 'center' } },
    sample: { shape: { type: 'ellipse', contour: 0, mod: 0 }, edge: 'both', factor: 0.5, fill: { type: 'rgradient' }, stroke: { type: 'color', color: '#1a1a1a', scale: false, width: 0.8 }, size: { mode: 'noise', value: 64, offset: 1.15, limiter: { min: 0.2, max: 1 }, freq: { seed: 7727, value: 0.05, shift: 0.06, speed: 0.2 } }, rotate: { mode: 'none', base: 0, value: 0 }, pos: { mode: 'none', value: 10, offset: 0 } },
    palette: { mode: 'size', mult: 0, gradient: { level: 1, scale: 1, rotate: 0, offset: 0.3 }, array: ['#d90057', '#ff7a18', '#ffd166', '#ffe8a3', '#fff3d6'] },
  },
  'Starfield Type': {
    cnv: { ratio: '2:1', color: { mode: 'custom', custom: '#03040a' }, seed: 88, frame: 0 },
    params: { text: 'NIGHT', font: 'Anton', fill: { type: 'none' }, size: { font: 110 }, letterspace: { value: 115 }, align: { x: 'center', y: 'center' } },
    sample: { shape: { type: 'polygon', contour: 0.4, mod: 0, polypoints: 5 }, edge: 'none', factor: 0.45, fill: { type: 'sequence' }, stroke: { type: 'none' }, size: { mode: 'noise', value: 26, offset: 1.2, limiter: { min: 0, max: 1 }, freq: { seed: 7727, value: 0.08, shift: 0.1, speed: 0.15 } }, rotate: { mode: 'noise', base: 0, value: 0.5, freq: { seed: 3873, value: 0.1, shift: 0.2, speed: 0.2 } }, pos: { mode: 'noise', value: 9, offset: 0, freq: { seed: 7798, value: 0.2, shift: 0.2, speed: 0.3 } } },
    palette: { mode: 'size', mult: 0.2, array: ['#ffffff', '#a9d6e5', '#5bc0be', '#ffd166', '#ef476f'] },
  },
  'Drift Lines': {
    cnv: { ratio: '9:16', color: { mode: 'custom', custom: '#13111c' }, seed: 200, frame: 0 },
    params: { text: 'DR\nIFT', font: 'Archivo Black', fill: { type: 'none' }, size: { font: 150 }, letterspace: { value: 100 }, leading: { value: 70 }, align: { x: 'center', y: 'center' } },
    sample: { shape: { type: 'triangle', contour: 0, mod: 0.6 }, edge: 'both', factor: 0.55, fill: { type: 'transition' }, stroke: { type: 'none' }, size: { mode: 'sin', value: 38, offset: 1, limiter: { min: 0, max: 1 }, freq: { seed: 7727, value: 0.25, shift: 0.2, speed: 0.2 } }, rotate: { mode: 'sin', base: 0, value: 1, freq: { seed: 3873, value: 0.15, shift: 0.2, speed: 0.3 } }, pos: { mode: 'sin', value: 14, offset: 0.5, freq: { seed: 7798, value: 0.15, shift: 0.2, speed: 0.4 } } },
    palette: { mode: 'rotate', mult: 0.3, array: ['#e0aaff', '#c77dff', '#9d4edd', '#7b2cbf', '#5a189a'] },
  },
};

function deepMerge(dst, src) {
  for (const k of Object.keys(src)) {
    if (Array.isArray(src[k])) {
      // mutate arrays in place so Tweakpane swatch bindings stay attached
      if (Array.isArray(dst[k])) { dst[k].length = 0; dst[k].push(...src[k]); }
      else dst[k] = src[k].slice();
    } else if (src[k] && typeof src[k] === 'object') { dst[k] = dst[k] || {}; deepMerge(dst[k], src[k]); }
    else dst[k] = src[k];
  }
}
function resetToDefaults() {
  deepMerge(cnv, structuredClone(DEFAULTS.cnv));
  deepMerge(params, structuredClone(DEFAULTS.params));
  deepMerge(sample, structuredClone(DEFAULTS.sample));
  deepMerge(palette, structuredClone(DEFAULTS.palette));
}
function applyPreset(name) {
  const pr = typeof name === 'string' ? presets[name] : name;
  if (!pr) return;
  resetToDefaults();
  if (pr.cnv) deepMerge(cnv, pr.cnv);
  if (pr.params) deepMerge(params, pr.params);
  if (pr.sample) deepMerge(sample, pr.sample);
  if (pr.palette) deepMerge(palette, pr.palette);
  cnv.frame = pr.cnv?.frame ?? 0;
  const finish = () => { if (P) applyRatio(); else regenerate(); seedEvent(); bgUI(); fillUI(); tool.pane.refresh(); };
  loadFont(params.font).then((f) => { FONT = f; finish(); }).catch(finish);
}

/////////////////////////////////////////////////////////////////////////////
// Export + OPTIONS
/////////////////////////////////////////////////////////////////////////////
attachExport(tool.pages.export, { getCanvas: tool.getCanvas, getSVG: renderSVG, name: 'sampl' });

const presetState = { name: 'Sequence Bloom' };
const opts = tool.pages.options;
opts.addBinding(presetState, 'name', { label: 'Preset', options: Object.fromEntries(Object.keys(presets).map((k) => [k, k])) }).on('change', (ev) => applyPreset(ev.value));
opts.addButton({ title: 'Apply / Restart Preset' }).on('click', () => applyPreset(presetState.name));
opts.addBinding(cnv, 'animation', { label: 'Animate' }).on('change', () => { cnv.frame = 0; });
opts.addButton({ title: 'Fullscreen (f)' }).on('click', () => tool.toggleFullscreen());

window.addEventListener('resize', fitCanvas);
// Dev hook — drive presets / inspect state / feed in external preset objects.
exposeDebug('sampl', { applyPreset, regenerate, renderSVG, updateFrameObjectData, cnv, params, sample, palette, get textObject() { return textObject; }, get F() { return F; }, presets, setFrame: (f) => { cnv.frame = f; } });

bgUI(); fillUI();
pendingPreset = 'Sequence Bloom';
