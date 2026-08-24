// FIELD — procedural field engines seen through conformal lenses. A domain is
// built from a chosen field engine (24 of them: noise, flow, cellular, gyroid,
// truchet, chladni, cassini, von-Karman eddy...), optionally folded into mirrored
// wedges, then mapped through a named transform of the complex plane (z^2, 1/z,
// Mobius, Droste, Julia, Joukowski, Newton, the modular group, or a ground-plane
// camera). Up to three engines composite with blend modes, the result is coloured
// through a 4-stop palette, re-lit as glass/metal/sand/liquid/molten, and finally
// resolved through a screen geometry (square, hex, ASCII, ordered dither, glitch).
// A dropped image can be liquified by the field and blended into it.
//
// The fragment shader is ported from the MIT-licensed fluid-core by KrackedDevs
// (https://github.com/enonforetsam/fluid) and kept verbatim; palettes, presets and
// the control surface are original.
import { createTool, exposeDebug } from '../../js/etch/shell.js';
import { attachPresets } from '../../js/etch/presets.js';
import { attachExport } from '../../js/etch/export.js';

/////////////////////////////////////////////////////////////////////////////
// Taxonomy
/////////////////////////////////////////////////////////////////////////////
const FIELDS = ['noise','flow','cellular','gyroid','truchet','interfere','kaleido','lines','grid','golden','smoke','crystal','honeycomb','bloom','sweep','marble','plaid','curtain','stitch','pursuit','chladni','cassini','topo','eddy'];
const LENSES = ['none','square','invert','mobius','droste','hyperbolic','julia','cube','exp','sine','joukowski','newton','modular','ground'];
const SCREENS = ['square','hex','ascii','dither','glitch'];
const MATERIALS = ['none','glass','metal','sand','liquid','molten'];
const BLENDS = ['normal','multiply','screen','add','difference','overlay'];
const CURSORS = ['off','ripple','lens','vortex','push'];

const opts = (arr) => Object.fromEntries(arr.map((s, i) => [s.toUpperCase(), i]));

// Palettes — original 4-stop selections, dark -> light.
const PALETTES = {
  'Deep Water':  ['#04101f', '#0b4a6e', '#2fa3b8', '#d6f2ea'],
  'Rust Bloom':  ['#140704', '#5e1f10', '#c9622a', '#f6dcb0'],
  'Violet Hour': ['#0a0714', '#33215c', '#7d5bb0', '#e9dcf5'],
  'Moss Light':  ['#050f0a', '#14432c', '#4d9b62', '#e2f2d4'],
  'Ash Rose':    ['#0d090b', '#3d222e', '#a8607a', '#f2d9e0'],
  'Cold Signal': ['#02060c', '#123a5e', '#3f8fc4', '#dfeef8'],
  'Ember Dust':  ['#0f0603', '#4a1c08', '#b8641c', '#fbe3bc'],
  'Chrome':      null,   // procedural in-shader (u_pal 7)
};
const PAL_NAMES = Object.keys(PALETTES);

/////////////////////////////////////////////////////////////////////////////
// State
/////////////////////////////////////////////////////////////////////////////
const params = {
  field: 0, field2: 0, blend: 0, layerMix: 0, field3: 0, blend2: 0, layerMix2: 0,
  speed: 0.45, zoom: 1.8, warp: 4, sym: 0, seed: 30, grain: 0.03,
  lens: 0, lensAmt: 1,
  palette: 'Deep Water', c0: '#04101f', c1: '#0b4a6e', c2: '#2fa3b8', c3: '#d6f2ea',
  pixel: 1, dots: false, dot: 10, dither: 0.5,
  screen: 0, material: 0,
  liq: 0.8, mix: 0.85, split: 0, panX: 0, panY: 0,
  cursor: 0, cursorAmt: 1,
  animate: true,
};
const DEFAULTS = structuredClone(params);

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

const FRAG = `#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#define ETCH_DERIV 1
#endif
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform float u_seed;
uniform float u_scale;
uniform float u_warp;
uniform int u_lens;
uniform float u_lensAmt;
uniform float u_sym;
uniform float u_pixel;
uniform float u_dots;
uniform float u_dot;
uniform float u_dither;
uniform float u_grain;
uniform int   u_pal;
uniform vec3  u_c0;
uniform vec3  u_c1;
uniform vec3  u_c2;
uniform vec3  u_c3;
uniform sampler2D u_tex;
uniform float u_hasTex;
uniform float u_texAspect;
uniform float u_liq;
uniform float u_mix;
uniform float u_split;
uniform int   u_field;
uniform int   u_field2;
uniform int   u_blend;
uniform float u_layerMix;
uniform int   u_field3;
uniform int   u_blend2;
uniform float u_layerMix2;
uniform int   u_screen;
uniform int   u_material;
uniform sampler2D u_glyph;
uniform sampler2D u_mask;
uniform float u_hasMask;
uniform vec3  u_maskBg;
uniform vec3  u_maskBg2;
uniform float u_maskGrad;
uniform vec2  u_pan;
uniform vec2  u_mouse;
uniform float u_mouseAmt;
uniform int   u_mouseMode;
uniform float u_rec;

float hash(vec2 p){
  /* precision-safe: no huge sin args, stable on mobile GPUs + long sessions */
  p = fract(p * 0.3183099 + fract(u_seed * 0.1031) + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * (p.x + p.y));
}
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for(int i = 0; i < 5; i++){
    v += a * vnoise(p);
    p = p * 2.03 + vec2(11.7, 5.9);
    a *= 0.5;
  }
  return v;
}


vec2 hash22(vec2 p){
  return vec2(hash(p), hash(p + vec2(37.2, 17.3)));
}

/* hex cell center for the point p (in cell units) */
vec2 hexCenter(vec2 p){
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return p - gv;
}

/* field B: curl of a noise potential -> divergence-free flow (fluid swirl).
   drift is the same bounded (d1,d2) the noise field uses, applied to the
   potential domain so the swirl morphs at the same visible rate. */
vec2 fgrad(vec2 p, vec2 off){
  float e = 0.06;
  float gx = fbm(p + vec2(e, 0.0) + off) - fbm(p - vec2(e, 0.0) + off);
  float gy = fbm(p + vec2(0.0, e) + off) - fbm(p - vec2(0.0, e) + off);
  return vec2(gx, gy) / (2.0 * e);
}
/* spread: push a mid-clustered field value out toward 0 and 1 around its midpoint, so a
   custom palette uses its FULL range. fbm/sum fields pile up near 0.5 and otherwise hide
   the end stops; geometric fields already span the range and are left alone. */
float spreadF(float v, float g){ return clamp((v - 0.5) * g + 0.5, 0.0, 1.0); }
/* complex arithmetic on vec2 (x + iy) — the math-lens layer works on the complex plane */
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b){ float d = dot(b, b) + 1e-6; return vec2(dot(a, b), a.y * b.x - a.x * b.y) / d; }
float fieldFlow(vec2 p, float t){
  /* curl-noise flow that reorganizes in place. Two spatially-varying warps,
     modulated by different time frequencies, reshape the flow potential locally
     (never a uniform translation), and there is no global drift on the output —
     so the streams keep reforming instead of the whole field panning. */
  float amt = 0.6 + u_warp * 0.25;
  vec2 wa = vec2(fbm(p * 0.6 + 11.0), fbm(p * 0.6 + 27.0)) - 0.5;
  vec2 wb = vec2(fbm(p * 0.9 + 41.0), fbm(p * 0.9 + 63.0)) - 0.5;
  vec2 sp = p + wa * (1.1 * sin(t * 0.13)) + wb * (1.0 * cos(t * 0.091));
  vec2 g = fgrad(sp, vec2(0.0));
  vec2 curl = vec2(g.y, -g.x);
  return spreadF(fbm(p + curl * amt), 2.0);
}

/* field C: Worley/Voronoi cellular noise (warp blends cells <-> edges) */
float fieldCellular(vec2 p, float t){
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float f1 = 9.0; float f2 = 9.0;
  for (int j = -1; j <= 1; j++){
    for (int i = -1; i <= 1; i++){
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(ip + g);
      o = 0.5 + 0.5 * sin(t * 0.5 + 6.2831 * o);
      vec2 d = g + o - fp;
      float dd = dot(d, d);
      if (dd < f1){ f2 = f1; f1 = dd; }
      else if (dd < f2){ f2 = dd; }
    }
  }
  f1 = sqrt(f1); f2 = sqrt(f2);
  float cells = 1.0 - f1;
  float edges = f2 - f1;
  return mix(cells, edges, clamp(u_warp / 9.0, 0.0, 1.0));
}
/* field D: gyroid — a 3D gyroid sliced through time; interwoven organic bands.
   warp adds a self-fold so the weave thickens/curls. */
float fieldGyroid(vec2 p, float t){
  vec3 q = vec3(p * 1.4, t * 0.3);
  float g = sin(q.x) * cos(q.y) + sin(q.y) * cos(q.z) + sin(q.z) * cos(q.x);
  g += (0.15 + u_warp * 0.12) * sin(2.0 * g + length(p));
  return 0.5 + 0.5 * sin(g * 1.6);
}

/* field E: truchet — random corner arcs per cell -> woven maze / circuit lines.
   bands follow the 0.5-radius arcs; warp packs them tighter. */
float truchetCell(vec2 p, float h){
  vec2 fp = fract(p);
  if (h < 0.5){ fp.x = 1.0 - fp.x; }
  float d = min(length(fp), length(fp - 1.0));
  d = abs(d - 0.5);
  float bands = 4.0 + u_warp * 2.5;
  return 0.5 + 0.5 * cos(d * bands * 6.2831853 - u_time * 1.5);
}
float fieldTruchet(vec2 p, float t){ return truchetCell(p, hash(floor(p))); }

/* field F: interference — overlapping ripple sources -> moire rings.
   warp raises the ripple frequency (denser moire). */
float fieldInterf(vec2 p, float t){
  float v = 0.0;
  for (int i = 0; i < 4; i++){
    float fi = float(i);
    vec2 c = 1.2 * vec2(sin(t * 0.2 + fi * 1.7), cos(t * 0.17 + fi * 2.3));
    float freq = 5.0 + u_warp * 2.0 + fi * 1.6;
    v += sin(length(p - c) * freq - t * 1.2 + fi);
  }
  return 0.5 + 0.5 * (v / 4.0);
}

/* field G: kaleidoscope — fold the angle into mirrored sectors over fbm.
   warp adds sectors (3 -> ~9) for a denser mandala. */
float fieldKaleido(vec2 p, float t){
  float ang = atan(p.y, p.x);
  float rad = length(p);
  float sectors = 3.0 + floor(u_warp * 0.7);
  float seg = 6.2831853 / sectors;
  ang = mod(ang, seg);
  ang = abs(ang - 0.5 * seg);
  vec2 q = vec2(cos(ang), sin(ang)) * rad;
  return spreadF(fbm(q * 1.6 + vec2(t * 0.35, t * 0.12)), 1.6);
}

/* field H: lines — rotated parallel bands; warp rotates + tightens them, a gentle
   wave keeps them from being dead-straight */
float fieldLines(vec2 p, float t){
  float ang = u_warp * 0.35;
  float c = cos(ang), s = sin(ang);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float freq = 5.0 + u_warp * 1.4;
  return 0.5 + 0.5 * sin(q.x * freq + t * 0.6 + 0.6 * sin(q.y * 0.7 + t * 0.5));
}

/* field I: grid — two crossed sine rulings -> a clean lattice; warp sets density */
float fieldGrid(vec2 p, float t){
  float freq = 4.0 + u_warp * 1.4;
  float gx = sin(p.x * freq + t * 0.5);
  float gy = sin(p.y * freq - t * 0.5);
  float lines = max(gx, gy);            /* bright where either ruling peaks */
  float nodes = gx * gy;                /* brightest at the crossings */
  return spreadF(0.5 + 0.5 * mix(lines, nodes, 0.35), 1.5);
}

/* field J: golden — phyllotaxis / sunflower via the Vogel model (golden angle).
   seed index ~ r^2; the golden angle 2.39996 rad spaces the spiral arms. */
float fieldGolden(vec2 p, float t){
  float r = length(p) * (1.3 + u_warp * 0.18);
  float a = atan(p.y, p.x);
  float n = r * r;
  float spiral = cos(a - n * 2.39996323 + t * 0.55);
  float rings = cos(n * 3.14159265 - t * 0.28);
  return 0.5 + 0.5 * spiral * rings;
}
float fieldSmoke(vec2 p, float t){
  /* volumetric smoke: two-step domain-warped fbm for billowing bodies + finer
     wisps, dark-biased so the bulk falls into shadow. The warp layers are driven
     by small bounded multi-phase sways at different rates, so the body churns in
     place instead of sliding as a sheet; precision-safe. */
  float w = max(u_warp, 1.0);
  vec2 a1 = vec2(sin(t * 0.2), cos(t * 0.17)) * 0.8;
  vec2 a2 = vec2(cos(t * 0.15), sin(t * 0.24)) * 0.8;
  vec2 q = vec2(fbm(p + a1), fbm(p + vec2(5.2, 1.3) - a2));
  vec2 r = vec2(fbm(p + w * 0.42 * q + vec2(1.7, 9.2) + a2),
               fbm(p + w * 0.42 * q + vec2(8.3, 2.8) - a1));
  float body = fbm(p + w * 0.5 * r);
  float fine = fbm(p * 2.4 + r * 1.6 + a1 * 0.4);
  float d = body * 0.72 + fine * 0.28;
  return pow(clamp((d - 0.15) * 1.65, 0.0, 1.0), 1.6);
}

/* field L: quasicrystal — sum of plane-wave gratings at evenly spaced angles gives crisp
   N-fold rotational symmetry (the classic 5-fold quasicrystal). warp picks the order. */
float fieldQuasi(vec2 p, float t){
  float n = 5.0 + floor(u_warp * 0.6);
  float v = 0.0;
  for (int i = 0; i < 12; i++){
    float on = step(float(i), n - 0.5);
    float a = 3.14159265 * float(i) / max(n, 1.0);
    v += on * cos((p.x * cos(a) + p.y * sin(a)) * 8.0 + t * 0.65);
  }
  return spreadF(0.5 + 0.5 * (v / n), 1.5);
}

/* field M: honeycomb — a true hexagonal lattice (reuses hexCenter from the hex screen).
   each cell pulses from its own hash, with crisp hexagonal walls between cells. warp = density. */
float fieldHoneycomb(vec2 p, float t){
  vec2 hp = p * (1.3 + u_warp * 0.35);
  vec2 c = hexCenter(hp);
  vec2 gv = hp - c;
  float hd = max(abs(gv.x), max(abs(0.5 * gv.x + 0.8660254 * gv.y), abs(-0.5 * gv.x + 0.8660254 * gv.y)));
  float cell = 0.5 + 0.5 * sin(hash(c) * 6.2831853 + t * 0.7);
  float wall = smoothstep(0.40, 0.48, hd);
  return mix(cell, 0.04, wall);
}

/* smooth 4-stop designer gradient (dark -> light) */
vec3 ramp4(float t, vec3 a, vec3 b, vec3 c, vec3 d){
  t = clamp(t, 0.0, 1.0);
  vec3 col = mix(a, b, smoothstep(0.0, 0.34, t));
  col = mix(col, c, smoothstep(0.33, 0.67, t));
  col = mix(col, d, smoothstep(0.66, 1.0, t));
  return col;
}
vec3 palChrome(float f){
  float band = sin(f * 22.0);
  vec3 c = vec3(0.10 + 0.82 * f) * (0.78 + 0.22 * band);
  float edge = pow(1.0 - abs(band), 4.0);
  vec3 sheen = 0.5 + 0.5 * cos(6.28318 * (f * 3.0 + vec3(0.0, 0.33, 0.67)));
  return c + sheen * edge * 0.22;
}

/* bloom engine (13): a true mesh gradient — the 4 palette stops live at drifting 2D
   anchor points and blend by distance, instead of riding the 1D ramp. bloomW returns
   the 4 normalized blob weights; the scalar field (for dither/material/mask edges) is
   the weighted ramp position, the colour stage blends the stop colours directly. */
vec2 bloomAnchor(int i, float t){
  float fi = float(i);
  float aa = u_seed * 0.61803 + fi * 2.399963;              /* golden-angle ring: guaranteed spread */
  float rr = 1.05 + 0.35 * sin(u_seed * 1.3 + fi * 2.1);
  vec2 base = vec2(cos(aa), sin(aa)) * rr;
  float w1 = 0.05 + 0.023 * fi;                             /* non-commensurate drift rates */
  float w2 = 0.041 + 0.017 * fi;
  return base + vec2(sin(t * w1 + aa * 3.0), cos(t * w2 + aa * 1.7)) * 0.45;
}
vec4 bloomW(vec2 p, float t){
  /* wobble the domain so blob edges go organic instead of perfectly radial */
  vec2 q = p + (vec2(fbm(p * 0.7 + t * 0.04), fbm(p * 0.7 + vec2(4.1, 7.7) - t * 0.03)) - 0.5) * u_warp * 0.35;
  vec4 w;
  w.x = exp(-dot(q - bloomAnchor(0, t), q - bloomAnchor(0, t)) * 1.4);
  w.y = exp(-dot(q - bloomAnchor(1, t), q - bloomAnchor(1, t)) * 1.4);
  w.z = exp(-dot(q - bloomAnchor(2, t), q - bloomAnchor(2, t)) * 1.4);
  w.w = exp(-dot(q - bloomAnchor(3, t), q - bloomAnchor(3, t)) * 1.4);
  return w / max(w.x + w.y + w.z + w.w, 0.0008);
}
float fieldBloom(vec2 p, float t){
  vec4 w = bloomW(p, t);
  return dot(w, vec4(0.02, 0.35, 0.68, 0.98));
}
/* sweep engine (14): the colour ramp laid CORNER-TO-CORNER across the frame -
   dark stop top-left, light stop bottom-right - with the boundary wobbled by
   drifting noise so it stays alive. Warp = wobble depth, Zoom = wobble size. */
float fieldSweep(vec2 p, float t){
  vec2 uv = p / (u_scale * 3.0);            /* undo the domain scale: frame coords */
  float tt = dot(uv, vec2(0.7071, -0.7071)) / 1.4142 + 0.5;
  float wob = (fbm(p * 0.9 + vec2(t * 0.05, 3.7 - t * 0.04)) - 0.5) * u_warp * 0.12;
  return clamp(tt + wob, 0.0, 1.0);
}
/* marble engine (15): paper marbling — horizontal ink bands dragged through two
   passes of combed fbm swirls (suminagashi). Warp = drag depth; the bands stay
   readable as stripes while the swirls churn them. */
float fieldMarble(vec2 p, float t){
  vec2 a = vec2(sin(t * 0.11), cos(t * 0.09)) * 0.6;
  vec2 q = vec2(fbm(p * 0.9 + a), fbm(p * 0.9 + vec2(3.1, 7.3) - a));
  vec2 r = vec2(fbm(p * 1.3 + 2.2 * q + vec2(6.4, 1.9)),
               fbm(p * 1.3 + 2.2 * q + vec2(0.7, 8.8)));
  float band = sin((p.y + (r.x - 0.5) * u_warp * 1.6) * 5.0 + r.y * 4.0 + t * 0.15);
  return 0.5 + 0.5 * band;
}
/* plaid engine (16): woven tartan — a three-frequency stripe sett per axis, crossed
   like grid but richer, with an over/under weave shimmer at the thread crossings.
   Warp = thread density. */
float plaidSett(float x, float t){
  float s = 0.45 * sin(x + t) + 0.35 * sin(x * 3.0 - t * 0.7) + 0.20 * sin(x * 7.0 + t * 0.4);
  return 0.5 + 0.5 * s;
}
float fieldPlaid(vec2 p, float t){
  vec2 q = p * (1.4 + u_warp * 0.35);
  float sx = plaidSett(q.x, t * 0.25);
  float sy = plaidSett(q.y, t * 0.20);
  float over = 0.5 + 0.5 * sin(q.x * 6.0) * sin(q.y * 6.0);   /* weave: which thread is on top */
  float v = mix(max(sx, sy), sx * sy, 0.4) * (0.82 + 0.18 * over);
  return spreadF(clamp(v, 0.0, 1.0), 1.3);
}
/* curtain engine (17): aurora curtains — thin luminous verticals from ridged folds,
   ruffled sideways by fbm and swaying, over a soft backglow. Warp = ruffle depth. */
float fieldCurtain(vec2 p, float t){
  vec2 q = vec2(p.x * 1.6, p.y * 0.35);              /* stretch: verticals dominate */
  float ruff = fbm(vec2(q.x * 1.8 + t * 0.10, q.y + t * 0.05)) - 0.5;
  float x = q.x + ruff * u_warp * 0.5 + sin(q.y * 1.3 + t * 0.22) * 0.35;
  float ridge = pow(1.0 - abs(sin(x * 2.2 + t * 0.10)), 2.2);
  float glow = fbm(vec2(x * 0.7, q.y * 0.8 - t * 0.07));
  return clamp(ridge * 0.85 + glow * 0.35, 0.0, 1.0);
}
/* stitch engine (18): curve stitching — the Boole / Cremona times-table. 64 pegs on a
   ring of radius 1.1; the peg at angle a is threaded to angle k*a. The chord family
   envelope is the epicycloid with k-1 cusps (k=2 cardioid, k=3 nephroid). Threads =
   min distance to any chord; the caustic glow is the chord-density sum, brightest
   where chords crowd — so the cusped envelope emerges exactly like physical string
   art. The exterior is circle-inverted through the peg ring, so the web reflects
   into a full-frame halo of circular arcs — a rose window. Warp = k (2 -> 8: the
   species changes entirely); k also drifts with t so the figure morphs live while
   the ring slowly turns. */
float stitchSegD(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a; vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h);
}
float fieldStitch(vec2 p, float t){
  float rot = t * 0.05 + u_seed * 0.13;
  float k = 0.85 + u_warp * 0.9 + fract(u_seed * 0.377) * 0.7 + 0.6 * sin(t * 0.07);
  float lenO = length(p);
  if (lenO > 1.1){ p *= 1.21 / dot(p, p); }          /* circle-invert the exterior: the web reflects into a halo */
  float minD = 9.0; float glow = 0.0;
  for (int i = 0; i < 64; i++){
    float a = float(i) * 0.09817477;         /* 2*pi/64 */
    vec2 A = 1.1 * vec2(cos(a + rot), sin(a + rot));
    vec2 B = 1.1 * vec2(cos(k * a + rot), sin(k * a + rot));
    float d = stitchSegD(p, A, B);
    minD = min(minD, d);
    glow += exp(-d * 22.0);
  }
  float thread = 1.0 - smoothstep(0.0, 0.045, minD); /* the strings themselves */
  float caust = 1.0 - exp(-glow * 0.3);              /* density caustic: the envelope */
  float v = 0.12 + 0.62 * caust + 0.34 * thread;     /* lit floor + caustic + strings */
  float rim = exp(-abs(lenO - 1.1) * 24.0);          /* the peg ring */
  v = max(v, rim * 0.9);
  return clamp(v, 0.0, 1.0);
}
/* pursuit engine (19): whirling polygons - Lucas mice. Ring j+1 joins the points a
   fraction f along ring j edges: one step = rotate phi + shrink s about the centroid,
   a discrete similarity whose orbit closure is a logarithmic spiral. Warp = f (chase
   fraction); seed picks n in {3..6} + orientation; deep rings spin faster (inward whirl). */
float fieldPursuit(vec2 p, float t){
  float nf = 3.0 + mod(floor(u_seed + 0.5), 4.0);              /* polygon order n */
  float an = 3.14159265 / nf;                                   /* half face-sector angle */
  float c = cos(2.0 * an), sn = sin(2.0 * an);
  float fr = 0.03 + u_warp * 0.04;                              /* pursuit fraction from Warp */
  float fmax = 0.5 - sqrt(max(0.25 - 0.1638 / (1.0 - c), 0.0)); /* keep shrink s >= 0.82 */
  float f = min(fr, fmax);
  float phi = atan(f * sn / (1.0 - f + f * c));                 /* per-ring whirl angle */
  float s = sqrt(1.0 - 2.0 * f * (1.0 - f) * (1.0 - c));        /* per-ring shrink */
  float r = length(p), a0 = atan(p.y, p.x);
  float th = u_seed * 0.7853 + t * 0.12;                        /* whole-nest precession */
  float dth = phi + (fr - f) * 1.2 + t * 0.0072;                /* deep rings spin faster */
  float A = 2.3 * cos(an);                                      /* outer apothem: equal circumradius */
  float minD = 1000.0, depth = 0.0;
  for (int j = 0; j < 22; j++){
    float b = mod(a0 - th + an, 2.0 * an) - an;                 /* fold angle into one face sector */
    float sd = r * cos(b) - A;                                  /* regular n-gon outline SDF */
    minD = min(minD, abs(sd));
    depth += step(sd, 0.0);                                     /* rings containing p -> terraced ground */
    th += dth; A *= s;
  }
  float v = 0.05 + 0.028 * depth + 0.20 * exp(-minD * 6.0) + 0.22 * exp(-r * r * 1.5);
  return clamp(mix(v, 1.0, smoothstep(0.05, 0.012, minD) * 0.95), 0.0, 1.0);
}
/* chladni engine (20): square-plate eigenmodes — the sand figures of a vibrating
   plate. u_mn(x,y) = cos(m pi x)cos(n pi y) - cos(n pi x)cos(m pi y); sand collects
   on the nodal set u = 0, drawn as thin bright lines. A resonance sweep crossfades
   two adjacent mode pairs so the nodal web migrates and reconnects through avoided
   crossings, like sand sliding between resonances.
   Warp = eigenmode order: line count and topology change, not just density. */
float chlPlate(vec2 q, float m, float n, float s){
  float a = cos(m * 3.14159265 * q.x) * cos(n * 3.14159265 * q.y);
  float b = cos(n * 3.14159265 * q.x) * cos(m * 3.14159265 * q.y);
  return (a - b) + s * (a + b);   /* classic "-" family + a seed pinch of "+" */
}
float fieldChladni(vec2 p, float t){
  vec2 q = p * 0.5 + vec2(fract(u_seed * 0.127), fract(u_seed * 0.211)); /* plate coords; seed shifts origin */
  float m = 1.0 + floor(u_warp * 0.6);       /* warp = mode order (m <= 6, n <= 9: precision-safe) */
  float n = m + 2.0;                         /* n != m or the "-" family vanishes identically */
  float s = 0.35 * fract(u_seed * 0.61);     /* per-seed mix of the symmetric family */
  float a = t * 0.13 + u_seed * 0.9;         /* resonance sweep phase */
  float u = cos(a) * chlPlate(q, m, n, s) + sin(a) * chlPlate(q, m + 1.0, n + 1.0, s);
  float L = 1.0 - smoothstep(0.0, 0.07 + 0.05 * m, abs(u)); /* sand: bright where u ~ 0; width tracks |grad| ~ pi m */
  return clamp(L * 0.80 + 0.40 * (0.5 + 0.45 * u), 0.0, 1.0);
}
/* cassini engine (21): polynomial lemniscates — the level sets of the 2D log-
   potential Phi(p) = (1/4) sum log|p - c_k| of four drifting foci (|P(z)| = c for
   P(z) = prod(z - z_k): Cassini ovals, pinching through Bernoulli figure-eights at
   the saddles as levels cross the zeros of P prime). Foci orbit on non-commensurate
   ellipses so ovals merge and split; Warp = contour density + constellation spread. */
vec2 casFocus(int i, float t){
  float fi = float(i);
  float aa = u_seed * 0.7853 + fi * 2.399963;               /* golden-angle ring: never collinear */
  float rr = (0.5 + 0.3 * sin(u_seed * 1.7 + fi * 2.6)) * (0.8 + u_warp * 0.06);
  float w1 = 0.083 + 0.034 * fi;                            /* non-commensurate orbit rates */
  float w2 = 0.107 + 0.027 * fi;
  return vec2(cos(aa), sin(aa)) * rr + vec2(sin(t * w1 + aa * 2.1), cos(t * w2 + aa * 1.3)) * 0.4;
}
float fieldCassini(vec2 p, float t){
  /* harmonic away from the foci; the 0.05 epsilon caps the log singularity */
  float phi = log(length(p - casFocus(0, t)) + 0.05)
            + log(length(p - casFocus(1, t)) + 0.05)
            + log(length(p - casFocus(2, t)) + 0.05)
            + log(length(p - casFocus(3, t)) + 0.05);
  phi *= 0.25;
  float v = 0.5 + 0.5 * cos(phi * (0.6 + u_warp * 1.8) - t * 0.55);   /* shells radiate steadily outward */
  return spreadF(v, 1.4);
}
/* topo engine (22): topographic contour map — an fbm heightfield sliced into N
   elevation isolines, per-pixel (fract of the level index, fwidth-antialiased) so
   no marching squares is needed. Every 5th line is a major contour: thicker and
   brighter, like a survey map. Line brightness rides the elevation, so the palette
   light stops crown the peaks while the basin floor stays at stop 0. Warp = terrain
   ruggedness (domain warp); the landmass drifts slowly under the frame. */
float fieldTopo(vec2 p, float t){
  vec2 drift = vec2(t * 0.035, -t * 0.022);
  vec2 q = vec2(fbm(p * 0.8 + drift), fbm(p * 0.8 + vec2(4.7, 2.3) - drift));
  float h = fbm(p * 0.85 + (q - 0.5) * (u_warp * 0.55) + drift * 0.6);
  /* stretch fbm mid-pile into a full elevation range. NOT clamped: a clamp flattens the
     extremes onto exactly one level, and a plateau sitting on a contour fills solid. */
  float e = (h - 0.18) * 1.55;
  float lv = e * 14.0;
  float fr = fract(lv);
  float dist = min(fr, 1.0 - fr);                /* distance to the nearest contour, in level units */
#ifdef ETCH_DERIV
  float w = max(fwidth(lv), 0.0008);
#else
  float w = max(55.0 * u_scale / max(sqrt(u_res.x * u_res.y), 1.0), 0.0008);
#endif
  float line = 1.0 - smoothstep(0.0, w * 1.4, dist);
  float major = step(mod(floor(lv + 0.5), 5.0), 0.5);   /* every 5th level: survey-map accent */
  line = max(line, (1.0 - smoothstep(0.0, w * 2.6, dist)) * (0.75 * major));
  /* cliffs pack more contours than a pixel can resolve — fade them out instead of
     letting the lines merge into a solid blob (a survey map thins out on scarps) */
  line *= 1.0 - smoothstep(0.22, 0.5, w);
  return clamp(line * (0.30 + 0.70 * clamp(e, 0.0, 1.0)), 0.0, 1.0);
}
/* velocity induced by one infinite row of vortices, exact. The complex potential of a row
   is w(z) = (G / 2pi i) ln sin(pi (z - z0) / a), so the velocity is its derivative,
     u - iv = (G / 2ia) cot(pi (z - z0) / a),
   and splitting cot(xi + i eta) into real and imaginary parts gives the pair below over a
   shared denominator cosh(2 eta) - cos(2 xi). ES 1.00 has no hyperbolics, so they are built
   from one exp. eta is clamped because cosh runs out of float range around 88 and zoom gets
   there; past the clamp a row reads as uniform shear anyway, which is exactly what the
   ratio tends to. The denominator is floored: it vanishes at a core, where the induced
   velocity is genuinely infinite. */
vec2 eddyRowVel(vec2 p, vec2 c, float a, float g){
  float k = 3.14159265 / a;
  float xi = (p.x - c.x) * k;
  float eta = clamp((p.y - c.y) * k, -8.0, 8.0);
  float e = exp(2.0 * eta), ei = 1.0 / e;
  float sh = 0.5 * (e - ei), ch = 0.5 * (e + ei);
  float d = max(ch - cos(2.0 * xi), 1e-4);
  float s = g / (2.0 * a);
  return vec2(-s * sh / d, s * sin(2.0 * xi) / d);
}
/* eddy engine (23): a von Karman vortex street — the staggered double row of counter-
   rotating vortices that sheds behind a cylinder between Reynolds ~40 and ~1000, which is
   the pattern in every photograph of flow past a bluff body.
   The rows are the real thing: separation held at h/a = 0.281, the von Karman stability
   ratio, and the lower row placed HALF A WAVELENGTH downstream with opposite circulation.
   That offset is the whole street — in phase the rows pair up and the wake stops staggering.
   What is drawn is not the stream function but DYE. Painting psi directly gave a rigid
   pattern sliding sideways: correct, and dead, because a steady field translating is a
   scrolling wallpaper. A wake looks alive because fluid is carried THROUGH the vortices,
   stretching and folding as it goes. So each pixel is traced BACKWARDS along the velocity
   field, stepping back in time as it goes, and the dye it started as is sampled at the far
   end. That is a streakline, and it is what the dye in the photograph actually is. Two dye
   streams either side of the wake get wound into the cores, thin into filaments, and spiral
   — motion that comes out of the integration rather than being animated on top.
   Warp = circulation: eddies roll tighter and entrain harder while the spacing stays put.
   Spacing in a real wake is set by the body and the flow speed, so letting warp stretch it
   would only be a second zoom. */
float fieldEddy(vec2 p, float t){
  float a = 1.15;                                  /* wavelength: gap between same-row cores */
  float h = 0.281 * a;                             /* von Karman stability ratio */
  float g = 0.22 + u_warp * 0.10;                  /* circulation */
  float U = 0.55;                                  /* free stream: the wake convects downstream */
  vec2 q = p;
  float tau = t;
  float dt = 0.20;
  /* backward integration. Eight steps is where the filaments stop visibly gaining length
     for the cost; the loop bound is constant because ES 1.00 requires it. */
  for (int i = 0; i < 8; i++){
    float xs = tau * U;                            /* how far the street has convected by tau */
    /* Without these two the wake is still a rigid scroll, however intricate it looks: the
       induced field depends only on (x - U tau) and the dye only on y, so advancing t by dt
       and x by U dt reproduces the frame exactly. Both are real wake behaviour rather than
       animation sprinkled on top — shedding strength pulses at the Strouhal rhythm, and a
       street meanders as it travels (vortex wander). They are applied quasi-steadily: the
       rows are exact vortex rows at each instant, slowly changing strength and position. */
    float breathe = 1.0 + 0.22 * sin(tau * 0.85);  /* shedding pulse */
    float yc = 0.13 * a * sin(tau * 0.55 + q.x * 0.6);   /* the street wanders */
    float gt = g * breathe;
    vec2 v = vec2(U, 0.0);
    v += eddyRowVel(q, vec2(xs, yc + h), a, gt);
    v += eddyRowVel(q, vec2(xs + a * 0.5, yc - h), a, -gt);
    q -= v * dt;
    tau -= dt;
  }
  /* what the fluid was before the wake got hold of it: two dye streams meeting at the
     centreline, with fine striations so stretching is visible as the filaments thin */
  float streams = 0.5 + 0.5 * (q.y * 2.2 / (1.0 + abs(q.y * 2.2)));
  float striae = 0.5 + 0.5 * cos(q.y * 9.0);
  return clamp(mix(streams, striae, 0.30), 0.0, 1.0);
}

/* ordered (Bayer) dither thresholds, recursive 2x2 -> 4x4 -> 8x8, WebGL1-safe */
float bayer2(vec2 a){ a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(0.5 * a) * 0.25 + bayer2(a); }
/* evaluate any engine by index — lets the base + a second Layer share the field switch.
   out disp = noise-domain displacement (only the noise engine fills it; used by the photo melt). */
float fieldOf(int eng, vec2 p, float t, out vec2 disp){
  float d1 = 1.8 * sin(t * 0.12) + 1.2 * cos(t * 0.067);
  float d2 = 1.8 * cos(t * 0.10) + 1.2 * sin(t * 0.084);
  disp = vec2(0.5);
  if (eng == 1){ return fieldFlow(p, t); }
  else if (eng == 2){ return fieldCellular(p, t); }
  else if (eng == 3){ return fieldGyroid(p, t); }
  else if (eng == 4){ return fieldTruchet(p, t); }
  else if (eng == 5){ return fieldInterf(p, t); }
  else if (eng == 6){ return fieldKaleido(p, t); }
  else if (eng == 7){ return fieldLines(p, t); }
  else if (eng == 8){ return fieldGrid(p, t); }
  else if (eng == 9){ return fieldGolden(p, t); }
  else if (eng == 10){ return fieldSmoke(p, t); }
  else if (eng == 11){ return fieldQuasi(p, t); }
  else if (eng == 12){ return fieldHoneycomb(p, t); }
  else if (eng == 13){ return fieldBloom(p, t); }
  else if (eng == 14){ return fieldSweep(p, t); }
  else if (eng == 15){ return fieldMarble(p, t); }
  else if (eng == 16){ return fieldPlaid(p, t); }
  else if (eng == 17){ return fieldCurtain(p, t); }
  else if (eng == 18){ return fieldStitch(p, t); }
  else if (eng == 19){ return fieldPursuit(p, t); }
  else if (eng == 20){ return fieldChladni(p, t); }
  else if (eng == 21){ return fieldCassini(p, t); }
  else if (eng == 22){ return fieldTopo(p, t); }
  else if (eng == 23){ return fieldEddy(p, t); }
  vec2 m1 = vec2(d1, d2);
  vec2 m2 = vec2(d2, -d1);
  vec2 q = vec2(fbm(p + m1 * 0.5), fbm(p + vec2(5.2, 1.3) + m2 * 0.5));
  disp = vec2(
    fbm(p + u_warp * q + vec2(1.7, 9.2) + m1),
    fbm(p + u_warp * q + vec2(8.3, 2.8) + m2)
  );
  return spreadF(fbm(p + u_warp * disp), 1.5);
}
/* field-level layer blend: composite engine b over engine a. amt = layer strength. */
float blendField(float a, float b, int mode, float amt){
  float r;
  if (mode == 1){ r = a * b; }                                            /* multiply */
  else if (mode == 2){ r = 1.0 - (1.0 - a) * (1.0 - b); }                 /* screen */
  else if (mode == 3){ r = min(a + b, 1.0); }                            /* add */
  else if (mode == 4){ r = abs(a - b); }                                 /* difference */
  else if (mode == 5){ r = a < 0.5 ? 2.0 * a * b : 1.0 - 2.0 * (1.0 - a) * (1.0 - b); } /* overlay */
  else { r = b; }                                                        /* 0 = normal */
  return mix(a, r, amt);
}
/* material finish: treat the field as a height map (screen-space gradient -> normal) and
   re-light the palette colour as glass / metal / sand / liquid / molten. mat 0 = off.
   fv = the raw field value — molten draws its ribbons on its level sets. */
vec3 shadeMaterial(int mat, vec3 base, vec3 N, float fv){
  vec3 L = normalize(vec3(0.4, 0.7, 0.6));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float ndl = max(dot(N, L), 0.0);
  float ndh = max(dot(N, H), 0.0);
  float fres = pow(1.0 - max(N.z, 0.0), 2.5);
  vec3 col = base;
  if (mat == 1){          /* glass — dark refractive body, bright fresnel rim + sharp spec */
    col = base * (0.35 + 0.25 * ndl) + fres * (base + 0.7) + pow(ndh, 80.0) * 1.5;
  } else if (mat == 2){   /* metal — chrome: env reflection (sky/ground by N.y) + hot spec */
    vec3 env = mix(base * 0.15 + 0.02, base * 0.7 + 0.55, smoothstep(-0.6, 0.6, N.y));
    col = env + pow(ndh, 40.0) * 2.0 + fres * 0.5;
  } else if (mat == 3){   /* sand — matte grain + soft ambient occlusion, no spec */
    float ao = clamp(0.5 + 0.5 * N.z, 0.0, 1.0);
    col = base * (0.4 + 0.6 * ndl) * ao + (hash(gl_FragCoord.xy * 1.91) - 0.5) * 0.18;
  } else if (mat == 4){   /* liquid — wet sheen: glossy spec + fresnel highlights */
    col = base * (0.5 + 0.4 * ndl) + pow(ndh, 28.0) * 1.3 + fres * 0.4 * (base + 0.3);
  } else if (mat == 5){   /* molten — liquid metal: near-black body, luminous ribbons riding
                             the fold CONTOURS (level sets of the field — smooth curves even
                             where the per-pixel normals are noisy), hot specular core */
    float ph = fv * 12.56637;                               /* ~2 ribbons per field octave */
    float s1 = 0.5 + 0.5 * sin(ph);
    float s2 = 0.5 + 0.5 * sin(ph * 2.618 + 1.7);
    float bands = pow(s1, 12.0) * 1.35 + pow(s2, 34.0) * 0.85;
    float sheen = pow(s1, 3.0) * 0.20;                      /* wide under-glow so the body reads as metal */
    vec3 tint = base / max(max(base.r, max(base.g, base.b)), 0.12);  /* palette hue at full brightness */
    col = base * 0.12 + 0.012
        + tint * (bands + sheen) * (0.75 + 0.25 * ndl)
        + tint * pow(ndh, 60.0) * 1.6
        + fres * tint * 0.15;
  }
  return col;
}
void main(){
  /* 0 - before/after: left of the split shows the untouched source */
  if (u_hasTex > 0.5 && u_split > 0.001 && gl_FragCoord.x < u_res.x * u_split){
    vec2 st0 = gl_FragCoord.xy / u_res;
    float ca0 = u_res.x / u_res.y;
    vec2 t0 = st0 - 0.5;
    if (ca0 > u_texAspect){ t0.y *= u_texAspect / ca0; }
    else { t0.x *= ca0 / u_texAspect; }
    t0 += 0.5 + u_pan;
    gl_FragColor = vec4(texture2D(u_tex, clamp(t0, 0.0, 1.0)).rgb, 1.0);
    return;
  }

  /* 1 - screen geometry: square (default) / hex / ascii — quantize coords */
  float csA = max(u_pixel, 8.0);
  vec2 fc = gl_FragCoord.xy;
  if (u_screen == 1){
    float cs = max(u_pixel, 3.0);
    fc = hexCenter(fc / cs) * cs;
  } else if (u_screen == 2){
    fc = (floor(fc / csA) + 0.5) * csA;
  } else if (u_screen == 3){
    float cd = max(u_pixel, 3.0);
    fc = (floor(fc / cd) + 0.5) * cd;
  } else if (u_screen == 4){
    float cg = max(u_pixel, 4.0);
    fc = (floor(fc / cg) + 0.5) * cg;
  } else if (u_pixel > 1.5){
    fc = (floor(fc / u_pixel) + 0.5) * u_pixel;
  }

  /* 2 - field: centered uv normalized by the geometric mean of w,h so forms stay
     isotropic (square stays square) AND the SAME amount of field shows at every
     aspect ratio — a portrait reveals more vertically instead of zooming in.
     (1:1 is unchanged: sqrt(s*s) == s) */
  float mn = sqrt(u_res.x * u_res.y);
  vec2 uv = (fc - 0.5 * u_res) / mn;
  vec2 p = uv * u_scale * 3.0;
  /* cursor effect: mode 1=ripple 2=lens 3=vortex 4=push */
  if (u_mouseAmt > 0.001 && u_mouseMode > 0){
    vec2 mUv = (u_mouse * u_res - 0.5 * u_res) / mn;
    vec2 dv = uv - mUv;
    float md = length(dv);
    if (u_mouseMode == 1){
      vec2 nz = vec2(fbm(dv * 6.0 + u_time * 0.3), fbm(dv * 6.0 + vec2(7.3, 2.1) - u_time * 0.25)) - 0.5;
      float env = exp(-md * 9.0);
      float wave = cos((md + nz.x * 0.12) * 30.0 - u_time * 2.0);
      vec2 dir = normalize(dv / max(md, 0.0008) + nz * 0.9);
      p += dir * wave * env * u_mouseAmt * 0.08;
    } else if (u_mouseMode == 2){
      float env = exp(-md * 5.0);
      p -= dv * env * u_mouseAmt * 0.5;
    } else if (u_mouseMode == 3){
      float angle = u_mouseAmt * 3.0 * exp(-md * 4.0);
      float ca = cos(angle), sa = sin(angle);
      p += vec2(dv.x * ca - dv.y * sa, dv.x * sa + dv.y * ca) - dv;
    } else if (u_mouseMode == 4){
      float env = exp(-md * 5.0);
      p += normalize(dv / max(md, 0.0008)) * env * u_mouseAmt * 0.28;
    }
  }
  /* time evolution: small, bounded, multi-frequency sway. The old large single-
     frequency offset translated the whole field like a rigid sheet; mixing low
     amplitudes at non-commensurate rates makes the field churn in place instead,
     and staying sin-bounded keeps it precision-safe over long sessions. */
  vec2 disp = vec2(0.5);
  float f;
  /* symmetry modifier: fold the field coordinate into N mirrored wedges -> instant mandala
     of whatever engine is selected. u_sym < 2 leaves it untouched. */
  if (u_sym >= 1.5){
    float ka = atan(p.y, p.x);
    float kr = length(p);
    float kseg = 6.2831853 / u_sym;
    ka = mod(ka, kseg);
    ka = abs(ka - 0.5 * kseg);
    p = vec2(cos(ka), sin(ka)) * kr;
  }
  /* math lens: named transforms of the complex plane, applied to the domain BOTH
     engine layers sample — any engine seen through curved space. Normalized to the
     zoom (w ~ unit disk) so a lens reads the same at every scale; u_lensAmt blends
     identity -> transformed coords. All outputs are magnitude-bounded so precision
     survives long sessions. */
  if (u_lens > 0 && u_lensAmt > 0.001){
    float lsc = u_scale * 1.5;
    vec2 w = p / lsc;
    vec2 lw = w;
    if (u_lens == 1){
      /* square: conformal power map z^2 renormalized to |z| — angles double, the
         plane wraps twice around the origin, radii keep their scale */
      lw = cmul(w, w) / max(length(w), 0.001);
    } else if (u_lens == 2){
      /* invert: circle inversion z -> R^2 z / |z|^2 — inside and outside of the
         R-ring trade places (an anticonformal involution) */
      lw = w * (0.30 / max(dot(w, w), 0.004));
    } else if (u_lens == 3){
      /* mobius: disk automorphism z -> (z - a)/(1 - conj(a) z); the pole a orbits
         slowly, so the whole space breathes hyperbolically around it */
      vec2 a = vec2(cos(u_time * 0.07), sin(u_time * 0.09)) * 0.45;
      lw = cdiv(w - a, vec2(1.0, 0.0) - cmul(vec2(a.x, -a.y), w));
      lw = clamp(lw, -8.0, 8.0);   /* the pole at 1/conj(a) is reachable with cursor warps */
    } else if (u_lens == 4){
      /* droste: log-polar spiral self-similarity (Escher). exp(rot(log z)) with a
         22.5-degree twist couples radius to angle; a slow post-rotation animates
         the spiral without unbounded zoom (log-radius stays in a fixed band) */
      vec2 lg = vec2(log(max(length(w), 0.003)), atan(w.y, w.x));
      lg = cmul(lg, vec2(0.92388, 0.38268));
      float dr = lg.y + u_time * 0.04;
      lw = exp(lg.x) * vec2(cos(dr), sin(dr));
    } else if (u_lens == 5){
      /* hyperbolic: radial blow-up of the Poincare-disk metric factor 1/(1 - |z|^2)
         — the pattern compresses without limit toward a circular horizon */
      lw = w / (1.06 - min(dot(w, w), 1.0));
    } else if (u_lens == 6){
      /* julia: iterate z -> z^2 + c and sample the engine at the folded orbit; c
         rides the |c| = 0.7885 circle (seed picks the spot, drifting through the
         Mandelbrot boundary) so the folding is always near-chaotic */
      float cp = u_seed * 2.4 + u_time * 0.02;
      vec2 c = vec2(cos(cp), sin(cp)) * 0.7885;
      vec2 z = w * 0.8;
      for (int k = 0; k < 7; k++){
        if (dot(z, z) > 4.0){ break; }
        z = cmul(z, z) + c;
      }
      lw = clamp(z, -2.0, 2.0);
    } else if (u_lens == 7){
      /* cube: conformal power map z^3 renormalized to |z| — angles triple, the
         plane wraps three times around the origin */
      lw = cmul(cmul(w, w), w) / max(dot(w, w), 0.001);
    } else if (u_lens == 8){
      /* exp: the exponential map — vertical lines become circles, horizontal
         strips unroll into radial fans; a slow x-drift breathes the radius */
      float ex = exp((w.x + 0.15 * sin(u_time * 0.09)) * 1.1) * 0.5;
      float ey = w.y * 2.0 + u_time * 0.03;
      lw = ex * vec2(cos(ey), sin(ey));
    } else if (u_lens == 9){
      /* sine: sin(z) = sin x cosh y + i cos x sinh y — a doubly-folded conformal
         lattice; every engine gains mirror periodicity (no cosh/sinh in ES 1.00)  */
      vec2 q = vec2(w.x * 2.5, w.y * 1.6);
      float chy = (exp(q.y) + exp(-q.y)) * 0.5;
      float shy = (exp(q.y) - exp(-q.y)) * 0.5;
      lw = vec2(sin(q.x) * chy, cos(q.x) * shy) * 0.55;
    } else if (u_lens == 10){
      /* joukowski: z + c^2/z — the airfoil transform of aerodynamics; circles
         near the pole become wing profiles, far field stays put */
      lw = w + 0.30 * w / max(dot(w, w), 0.02);
    } else if (u_lens == 11){
      /* newton: basins of the Newton iteration for z^3 = r — the fractal shores where
         three attractors meet; the target root-circle slowly rotates */
      float nph = u_seed * 1.3 + u_time * 0.05;
      vec2 nr = vec2(cos(nph), sin(nph));
      vec2 z = w * 1.4;
      for (int k = 0; k < 5; k++){
        vec2 z2 = cmul(z, z);
        z = z - cdiv(cmul(z, z2) - nr, 3.0 * z2);
        z = clamp(z, -3.0, 3.0);
      }
      lw = z;
    } else if (u_lens == 12){
      /* modular: fold into the SL(2,Z) fundamental domain (|Re z| < 1/2, |z| > 1
         via T: z->z+1 and S: z->-1/z) — the hyperbolic tessellation of number theory */
      vec2 z = vec2(w.x * 1.4 + u_time * 0.02, abs(w.y * 1.4) + 0.08);
      for (int k = 0; k < 6; k++){
        z.x = z.x - floor(z.x + 0.5);
        float zz = dot(z, z);
        if (zz < 1.0){ z = vec2(-z.x, z.y) / max(zz, 0.01); }
      }
      lw = clamp(z, -4.0, 4.0);
    } else {
      /* ground: the only lens that is not a map of the plane onto itself but a CAMERA.
         Every other lens here bends a flat piece; this one tips it away from you. The
         screen row is read as a ray angle and intersected with a horizontal plane, so
         depth goes as 1/(horizon - y): equal steps up the frame become ever larger steps
         into the distance, texture compresses toward the horizon, and any of the engines
         becomes a floor stretching to it.
         Above the horizon a ray never meets the plane at all, and a lens has to return
         SOMETHING — so the far side is mirrored, giving a sky that reflects the floor
         rather than a dead half-frame. abs() is what does it, and it also keeps the
         divide off zero at the horizon line itself.
         Bounded like the others: the divide is floored, which caps depth at ~27 and
         limits how finely the field is sampled at the vanishing line. It still aliases
         there, as any perspective plane does without mip-mapping, and the horizon is the
         one place a moire is honest.
         Which way the plane lies matters, and not for symmetric engines: depth is the
         engine X here, not its Y. Both are ground planes — they differ by a 90 degree turn —
         but an engine with a grain reads completely differently through them. Eddy runs its
         dye along Y, so with depth on Y its whole structure collapses into horizontal bands;
         turned this way the street recedes along its own length instead. Grid renders
         identically either way, being symmetric, so nothing is given up for it. */
      float hz = 0.34;                                  /* horizon height, normalized */
      float depth = 0.55 / max(abs(hz - w.y), 0.02);
      lw = clamp(vec2(depth, w.x * depth), -60.0, 60.0);
    }
    p = mix(p, lw * lsc, u_lensAmt);
  }
  /* base layer, then optionally composite a 2nd and 3rd engine on the same domain
     (Layers). Each blends onto the accumulated result, not onto the base, so the stack
     reads top-down exactly as the tray draws it. */
  f = fieldOf(u_field, p, u_time, disp);
  float fBase = f;
  if (u_layerMix > 0.001){
    vec2 disp2;
    f = blendField(f, fieldOf(u_field2, p, u_time, disp2), u_blend, u_layerMix);
  }
  if (u_layerMix2 > 0.001){
    vec2 disp3;
    f = blendField(f, fieldOf(u_field3, p, u_time, disp3), u_blend2, u_layerMix2);
  }
  if (u_hasTex > 0.5 && u_field != 0){
    float d1 = 1.8 * sin(u_time * 0.12) + 1.2 * cos(u_time * 0.067);
    float d2 = 1.8 * cos(u_time * 0.10) + 1.2 * sin(u_time * 0.084);
    disp = vec2(fbm(p + vec2(1.7, 9.2) + d1), fbm(p + vec2(8.3, 2.8) + d2));
  }
  f = smoothstep(0.08, 0.92, f); /* gentle spread — keep gradients smooth */

  /* 3 - photo blend: cover-fit, liquified by disp, luminance into f */
  if (u_hasTex > 0.5){
    vec2 st = fc / u_res;
    float ca = u_res.x / u_res.y;
    vec2 tuv = st - 0.5;
    if (ca > u_texAspect){ tuv.y *= u_texAspect / ca; }
    else { tuv.x *= ca / u_texAspect; }
    tuv += 0.5 + u_pan;
    tuv += (disp - 0.5) * u_liq * 0.25;
    vec3 ts = texture2D(u_tex, clamp(tuv, 0.0, 1.0)).rgb;
    float lum = dot(ts, vec3(0.299, 0.587, 0.114));
    f = mix(f, lum, u_mix);
  }

  /* 4 - palette: Chrome is procedural; every other palette (presets + custom)
       is a 4-stop ramp fed by colour uniforms set on the JS side.
       Bloom (13) blends the stop COLOURS by blob weight — orange meets blue
       directly instead of detouring through the middle of the ramp. */
  vec3 col;
  if (u_field == 13 && u_hasTex < 0.5 && u_pal != 7){
    vec4 bw = bloomW(p, u_time);
    col = bw.x * u_c0 + bw.y * u_c1 + bw.z * u_c2 + bw.w * u_c3;
  }
  else if (u_pal == 7){ col = palChrome(f); }
  else           { col = ramp4(f, u_c0, u_c1, u_c2, u_c3); }
  /* soft highlight bloom for a premium glow */
  col += smoothstep(0.72, 1.0, f) * 0.12;
  /* 4b - material finish: field gradient -> normal, re-light as glass/metal/sand/liquid */
  if (u_material > 0){
#ifdef ETCH_DERIV
    vec2 grd = vec2(dFdx(f), dFdy(f)) * u_res.y * 0.06;
#else
    float mEe = (u_scale * 3.0 / max(mn, 1.0)) * 2.0;
    vec2 mTmp;
    float mFx = fieldOf(u_field, p + vec2(mEe, 0.0), u_time, mTmp);
    float mFy = fieldOf(u_field, p + vec2(0.0, mEe), u_time, mTmp);
    vec2 grd = vec2(mFx - fBase, mFy - fBase) * 0.5 * u_res.y * 0.06;
#endif
    col = shadeMaterial(u_material, col, normalize(vec3(-grd, 1.0)), f);
  }

  /* 5 - halftone in real (un-pixelated) coords (square screen only) */
  if (u_dots > 0.5 && u_screen == 0){
    vec2 g = mod(gl_FragCoord.xy, u_dot) - 0.5 * u_dot;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float radius = 0.5 * u_dot * sqrt(clamp(lum, 0.0, 1.0)) * 0.92;
    float dm = 1.0 - smoothstep(radius - 0.8, radius + 0.8, length(g));
    col = mix(col * 0.12, col * 1.12, dm);
  }

  /* 5b - ascii: cell brightness picks a glyph from the atlas */
  if (u_screen == 2){
    float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    float gi = floor(lum * 9.999);
    vec2 cl = fract(gl_FragCoord.xy / csA);
    vec2 guv = vec2((gi + cl.x) / 10.0, 1.0 - cl.y);
    col *= texture2D(u_glyph, guv).r;
  }

  /* 5c - ordered dither: quantize the field to a 2-tone palette (c1 -> c3).
     Threshold biases the field so the bright dots grow denser or sparser. */
  if (u_screen == 3){
    float cd = max(u_pixel, 3.0);
    float bit = step(bayer8(gl_FragCoord.xy / cd), clamp(f + (u_dither - 0.5), 0.0, 1.0));
    col = mix(u_c1, u_c3, bit);
  }

  /* 5d - glitch: chromatic-aberration on the field contours, black elsewhere (RGB channel split) */
  if (u_screen == 4){
    float lev = clamp(0.5 + (u_dither - 0.5) * 0.6, 0.18, 0.82);  /* Threshold shifts which contour shows */
    float bw = 0.018;                                            /* narrow band -> thin sparse contours on black */
    col = vec3(
      1.0 - smoothstep(bw, bw * 2.6, abs(f - (lev - 0.05))),
      1.0 - smoothstep(bw, bw * 2.6, abs(f - lev)),
      1.0 - smoothstep(bw, bw * 2.6, abs(f - (lev + 0.05)))
    );
  }

  /* 6 - grain + vignette */
  float grPhase = mix(mod(floor(u_time * 10.0), 61.0) * 1.7, 23.0, u_rec);
  float gr = hash(gl_FragCoord.xy * 0.731 + grPhase) - 0.5;
  col += gr * u_grain * mix(1.0, 0.28, u_rec);
  col *= 1.0 - 0.22 * dot(uv, uv);

  /* 7 - text/logo mask: the living field fills the letters, clean bg outside.
       The background is solid u_maskBg, or a vertical A->B gradient when u_maskGrad. */
  if (u_hasMask > 0.5){
    float mk = texture2D(u_mask, vec2(gl_FragCoord.x / u_res.x, 1.0 - gl_FragCoord.y / u_res.y)).r;
    vec3 mbg = mix(u_maskBg, u_maskBg2, u_maskGrad * (1.0 - gl_FragCoord.y / u_res.y));
    col = mix(mbg, col, smoothstep(0.42, 0.58, mk));
  }

  gl_FragColor = vec4(col, 1.0);
}`;

/////////////////////////////////////////////////////////////////////////////
// Sketch
/////////////////////////////////////////////////////////////////////////////
const tool = createTool({ name: 'FIELD', version: '0.1' });
let P = null, prog = null, t = 0;
let glyphTex = null, blankTex = null, srcImg = null, hasTex = 0, texAspect = 1;
const mouse = { x: 0.5, y: 0.5 };

// ASCII atlas: 10 cells of increasing ink, white on black, sampled by .r
function buildGlyphAtlas(p) {
  const cell = 64, n = 10;
  const g = p.createGraphics(cell * n, cell);
  g.pixelDensity(1);
  g.background(0);
  g.fill(255); g.noStroke();
  g.textAlign(p.CENTER, p.CENTER);
  g.textFont('monospace');
  g.textSize(cell * 0.82);
  const ramp = ' .:-=+*#%@';
  for (let i = 0; i < n; i++) g.text(ramp[i], cell * (i + 0.5), cell * 0.52);
  return g;
}

function hexToRGB(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255];
}

function setUniforms() {
  const s = prog;
  s.setUniform('u_res', [P.width, P.height]);
  s.setUniform('u_time', t);
  s.setUniform('u_seed', params.seed);
  s.setUniform('u_scale', params.zoom);
  s.setUniform('u_warp', params.warp);
  s.setUniform('u_sym', params.sym);
  s.setUniform('u_grain', params.grain);
  s.setUniform('u_lens', params.lens);
  s.setUniform('u_lensAmt', params.lensAmt);
  s.setUniform('u_field', params.field);
  s.setUniform('u_field2', params.field2);
  s.setUniform('u_blend', params.blend);
  s.setUniform('u_layerMix', params.layerMix);
  s.setUniform('u_field3', params.field3);
  s.setUniform('u_blend2', params.blend2);
  s.setUniform('u_layerMix2', params.layerMix2);
  s.setUniform('u_pal', params.palette === 'Chrome' ? 7 : 8);
  s.setUniform('u_c0', hexToRGB(params.c0));
  s.setUniform('u_c1', hexToRGB(params.c1));
  s.setUniform('u_c2', hexToRGB(params.c2));
  s.setUniform('u_c3', hexToRGB(params.c3));
  s.setUniform('u_pixel', params.pixel);
  s.setUniform('u_dots', params.dots ? 1 : 0);
  s.setUniform('u_dot', params.dot);
  s.setUniform('u_dither', params.dither);
  s.setUniform('u_screen', params.screen);
  s.setUniform('u_material', params.material);
  s.setUniform('u_glyph', glyphTex);
  s.setUniform('u_tex', hasTex ? srcImg : blankTex);
  s.setUniform('u_hasTex', hasTex);
  s.setUniform('u_texAspect', texAspect);
  s.setUniform('u_liq', params.liq);
  s.setUniform('u_mix', params.mix);
  s.setUniform('u_split', params.split);
  s.setUniform('u_pan', [params.panX, params.panY]);
  s.setUniform('u_mask', blankTex);
  s.setUniform('u_hasMask', 0);
  s.setUniform('u_maskBg', [0, 0, 0]);
  s.setUniform('u_maskBg2', [0, 0, 0]);
  s.setUniform('u_maskGrad', 0);
  s.setUniform('u_mouse', [mouse.x, mouse.y]);
  s.setUniform('u_mouseAmt', params.cursor > 0 ? params.cursorAmt : 0);
  s.setUniform('u_mouseMode', params.cursor);
  s.setUniform('u_rec', 0);
}

tool.startSketch((p) => {
  P = p;
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    p.setAttributes('preserveDrawingBuffer', true);
    p.pixelDensity(1);
    p.noStroke();
    prog = p.createShader(VERT, FRAG);
    glyphTex = buildGlyphAtlas(p);
    blankTex = p.createGraphics(1, 1);
    blankTex.pixelDensity(1);
    blankTex.background(0);
  };
  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);
  p.draw = () => {
    if (!prog) return;
    if (params.animate) t += (p.deltaTime / 1000) * params.speed;
    p.shader(prog);
    setUniforms();
    p.rect(0, 0, p.width, p.height);
  };
});

// pointer -> u_mouse (normalized), on the canvas host so the pane never triggers it
tool.canvasHost.addEventListener('pointermove', (e) => {
  const r = tool.canvasHost.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) / r.width;
  mouse.y = 1 - (e.clientY - r.top) / r.height;
});

// image drop
tool.canvasHost.addEventListener('dragover', (e) => e.preventDefault());
tool.canvasHost.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  P.loadImage(url, (img) => {
    srcImg = img; hasTex = 1; texAspect = img.width / img.height;
    URL.revokeObjectURL(url);
  });
});

/////////////////////////////////////////////////////////////////////////////
// UI
/////////////////////////////////////////////////////////////////////////////
const main = tool.pages.main;

const fStack = main.addFolder({ title: 'STACK' });
fStack.addBinding(params, 'field', { label: 'Engine', options: opts(FIELDS) });
fStack.addBinding(params, 'field2', { label: 'Layer 2', options: opts(FIELDS) });
fStack.addBinding(params, 'blend', { label: 'Blend 2', options: opts(BLENDS) });
fStack.addBinding(params, 'layerMix', { label: 'Mix 2', min: 0, max: 1, step: 0.01 });
fStack.addBinding(params, 'field3', { label: 'Layer 3', options: opts(FIELDS) });
fStack.addBinding(params, 'blend2', { label: 'Blend 3', options: opts(BLENDS) });
fStack.addBinding(params, 'layerMix2', { label: 'Mix 3', min: 0, max: 1, step: 0.01 });

const fSpace = main.addFolder({ title: 'MOTION & SPACE' });
fSpace.addBinding(params, 'speed', { label: 'Speed', min: 0, max: 2, step: 0.01 });
fSpace.addBinding(params, 'zoom', { label: 'Zoom', min: 0.3, max: 4, step: 0.01 });
fSpace.addBinding(params, 'warp', { label: 'Warp', min: 0, max: 10, step: 0.05 });
fSpace.addBinding(params, 'sym', { label: 'Symmetry', min: 0, max: 16, step: 1 });
fSpace.addBinding(params, 'grain', { label: 'Grain', min: 0, max: 0.3, step: 0.005 });
fSpace.addBinding(params, 'seed', { label: 'Seed', min: 0, max: 100, step: 1 });
fSpace.addBinding(params, 'animate', { label: 'Animate' });

const fLens = main.addFolder({ title: 'LENS' });
fLens.addBinding(params, 'lens', { label: 'Transform', options: opts(LENSES) });
fLens.addBinding(params, 'lensAmt', { label: 'Amount', min: 0, max: 1, step: 0.01 });

const fCol = main.addFolder({ title: 'COLOR' });
fCol.addBinding(params, 'palette', { label: 'Palette', options: Object.fromEntries(PAL_NAMES.map((n) => [n, n])) })
  .on('change', (e) => {
    const stops = PALETTES[e.value];
    if (!stops) return;
    [params.c0, params.c1, params.c2, params.c3] = stops;
    tool.pane.refresh();
  });
fCol.addBinding(params, 'c0', { label: 'Stop 1', view: 'color' });
fCol.addBinding(params, 'c1', { label: 'Stop 2', view: 'color' });
fCol.addBinding(params, 'c2', { label: 'Stop 3', view: 'color' });
fCol.addBinding(params, 'c3', { label: 'Stop 4', view: 'color' });

const fSurf = main.addFolder({ title: 'SURFACE', expanded: false });
fSurf.addBinding(params, 'pixel', { label: 'Pixelate', min: 1, max: 40, step: 1 });
fSurf.addBinding(params, 'dots', { label: 'Halftone' });
fSurf.addBinding(params, 'dot', { label: 'Dot Size', min: 3, max: 40, step: 1 });
fSurf.addBinding(params, 'dither', { label: 'Threshold', min: 0, max: 1, step: 0.01 });

const fFin = main.addFolder({ title: 'SCREEN & FINISH', expanded: false });
fFin.addBinding(params, 'screen', { label: 'Screen', options: opts(SCREENS) });
fFin.addBinding(params, 'material', { label: 'Finish', options: opts(MATERIALS) });

const fSrc = main.addFolder({ title: 'SOURCE IMAGE', expanded: false });
fSrc.addBinding(params, 'liq', { label: 'Liquify', min: 0, max: 2, step: 0.01 });
fSrc.addBinding(params, 'mix', { label: 'Photo Blend', min: 0, max: 1, step: 0.01 });
fSrc.addBinding(params, 'split', { label: 'Before/After', min: 0, max: 1, step: 0.01 });
fSrc.addBinding(params, 'panX', { label: 'Pan X', min: -0.5, max: 0.5, step: 0.01 });
fSrc.addBinding(params, 'panY', { label: 'Pan Y', min: -0.5, max: 0.5, step: 0.01 });
fSrc.addButton({ title: 'Clear Image' }).on('click', () => { hasTex = 0; srcImg = null; });

const fCur = main.addFolder({ title: 'CURSOR', expanded: false });
fCur.addBinding(params, 'cursor', { label: 'Type', options: opts(CURSORS) });
fCur.addBinding(params, 'cursorAmt', { label: 'Impact', min: 0, max: 3, step: 0.01 });

/////////////////////////////////////////////////////////////////////////////
// Presets + export
/////////////////////////////////////////////////////////////////////////////
const presets = {
  'Deep Current': { field: 1, zoom: 1.5, warp: 5, palette: 'Deep Water', c0: '#04101f', c1: '#0b4a6e', c2: '#2fa3b8', c3: '#d6f2ea', speed: 0.4 },
  'Kiln Glass':   { field: 3, zoom: 1.6, warp: 5, material: 1, palette: 'Ember Dust', c0: '#0f0603', c1: '#4a1c08', c2: '#b8641c', c3: '#fbe3bc' },
  'Cold Lattice': { field: 11, lens: 12, lensAmt: 1, zoom: 0.9, warp: 4, palette: 'Cold Signal', c0: '#02060c', c1: '#123a5e', c2: '#3f8fc4', c3: '#dfeef8' },
  'Nodal Plate':  { field: 20, zoom: 1.3, warp: 4.2, speed: 0.85, palette: 'Ash Rose', c0: '#0d090b', c1: '#3d222e', c2: '#a8607a', c3: '#f2d9e0' },
  'Wake Street':  { field: 23, zoom: 1.2, warp: 6, palette: 'Moss Light', c0: '#050f0a', c1: '#14432c', c2: '#4d9b62', c3: '#e2f2d4' },
  'Spiral Well':  { field: 4, lens: 4, lensAmt: 1, zoom: 1.4, warp: 3, palette: 'Violet Hour', c0: '#0a0714', c1: '#33215c', c2: '#7d5bb0', c3: '#e9dcf5' },
  'Terminal':     { field: 8, screen: 2, pixel: 12, zoom: 1.6, palette: 'Moss Light', c0: '#050f0a', c1: '#14432c', c2: '#4d9b62', c3: '#e2f2d4' },
};

function applyPreset(name) {
  const pr = typeof name === 'string' ? presets[name] : name;
  if (!pr) return;
  Object.assign(params, structuredClone(DEFAULTS), pr);
  tool.pane.refresh();
}

function randomize() {
  params.field = Math.floor(Math.random() * FIELDS.length);
  params.lens = Math.floor(Math.random() * LENSES.length);
  params.zoom = 0.7 + Math.random() * 2;
  params.warp = Math.random() * 9;
  params.sym = Math.random() < 0.6 ? 0 : Math.floor(Math.random() * 12);
  params.seed = Math.floor(Math.random() * 100);
  const pn = PAL_NAMES[Math.floor(Math.random() * (PAL_NAMES.length - 1))];
  params.palette = pn;
  [params.c0, params.c1, params.c2, params.c3] = PALETTES[pn];
}

attachExport(tool.pages.export, { getCanvas: () => tool.getCanvas(), name: 'field' });
attachPresets(tool.pages.options, { pane: tool.pane, params, presets, randomize, onApply: applyPreset });

exposeDebug('field', { params, applyPreset, randomize, FIELDS, LENSES, setUniforms });
