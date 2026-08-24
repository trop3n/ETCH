# Etch

A suite of browser-based generative/visual tools — vector, type, shader, 3D, and
image-manipulation instruments that run entirely client-side. No build step, no
backend, no account: serve the folder and open it.

## Run

Any static HTTP server works (ES modules + the vendored libs need same-origin):

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/` — the **Etch stack** (the current
focus, 18 tools) plus the **Classic** raster tools (12 earlier experiments), all
on one page. Or navigate directly to `tools/<name>/`.

> After editing a shared module under `js/etch/`, hard-refresh (Ctrl/Cmd+Shift+R)
> or use a fresh tab — `http.server` sends no cache headers, so browsers may serve
> a stale copy of the shared JS.

## The tools

### Etch stack (18)

| Tool | What it does |
|---|---|
| **FLAKE** | Generative symmetrical vector tile patterns with noise, swirl & masks |
| **SPLITX** | Vector shapes mirrored across a split canvas into kaleidoscopes |
| **BLUUR** | A blurred grid of soft forms fused through blend modes & procedural palettes |
| **TEXTR** | Kinetic typography — repeated text in count-diamonds with sine & noise waves |
| **SAMPL** | Geometric shapes sampled along glyph outlines |
| **RASTR** | Text rasterized into a kinetic geometric shape grid |
| **RITM** | Abstract waveform graphics from simplex noise & generative palettes |
| **REFRACT** | Image displacement & grid refraction via GLSL shaders |
| **DITHR** | Dithering — lit 3D forms & media through ordered / halftone / CMYK / ASCII shaders, palette-mapped |
| **PLAIN** | Dynamic low-poly 3D plane meshes from simplex noise |
| **BIOM** | Organic blooms — orbiting forms stamped into concentric gradient rings |
| **DRIFT** | Sample fragments of an image and let them drift, smear & spin |
| **KLON** | Grid-snapped clone stamp — collage image fragments by rect / ellipse / triangle |
| **SKAAAN** | Scan-line displacement glitch — shift / scale / rotate / noise an image as a line sweeps it |
| **STIIL** | Abstract graphics from images via stacked artistic effects |
| **BOIDS** | Flocking simulation with shape, skew & velocity color |
| **TERMNL** | Text-native generative terminal — 12 character engines, 4 modes, .txt/.ans export |
| **FIELD** | 24 procedural field engines mapped through conformal lenses, layered, re-lit & screened |

### Classic (12)
The original vanilla-Canvas/WebGL experiments, in the Classic Tools section of
the main page: dithering, cellular-automata, gradient-map, shapes, text,
pixel-flow, pixelator, srt2video, video2midi, flipdigits, blob-tracker, mesher.
Preserved as-is.

## Tech & architecture

- **No build system** — files are served as-is. Libraries load per-page via global
  `<script>` tags or ES-module imports.
- **Stack:** [p5.js](https://p5js.org) · [Paper.js](http://paperjs.org) ·
  [opentype.js](https://opentype.js.org) · [Tweakpane](https://cocopon.github.io/tweakpane/).
- **Vendored (same-origin, under `js/vendor/`):** Paper.js (patched for CSP — see
  below), Tweakpane, JSZip, simplex-noise, and ffmpeg.wasm (single-threaded core,
  for WebM→MP4 transcode). The only remaining CDN dependencies are **p5.js** and
  **opentype.js** (jsdelivr), both SRI-pinned.
- **Shared shell** (`js/etch/`): `shell.js` (`createTool` — floating Tweakpane
  panel over a full-bleed canvas), `export.js` (PNG/SVG/video/frame-zip),
  `presets.js`, `palette.js`, `noise.js` (seedable 2D/3D/4D simplex), `typography.js`,
  `shapes.js`, `previews.js`. Each tool is a thin `tools/<name>/<name>.js` on top.
- **Legacy tools** reuse `js/media-source.js` (camera/screen/video/image input) and
  `css/style.css`.

## Browser support

- A modern Chromium/Firefox/Safari. **REFRACT, PLAIN, and DITHR need WebGL** (a
  real GPU, not all headless setups).
- Every page ships a strict **Content-Security-Policy** and **Subresource
  Integrity** on the CDN scripts. Because Paper.js's PaperScript compiler calls
  `new Function` at load, the vendored copy is patched to degrade gracefully under
  the no-`unsafe-eval` CSP (PaperScript compilation is disabled; all tools use the
  Paper object API, so nothing is lost).
- Export: PNG (multi-res), SVG (vector tools), video (MediaRecorder WebM / native
  MP4 / in-browser ffmpeg.wasm transcode), and PNG/WebP frame-sequence zip.

## Third-party software

All under MIT or similarly permissive licenses. Paper.js, Tweakpane, JSZip,
simplex-noise (Jonas Wagner) and ffmpeg.wasm are vendored under `js/vendor/`, so
their license notices ship with this repo; p5.js and opentype.js load from a CDN.

Some tools incorporate third-party routines, each attributed inline in its source:

- **BOIDS** — vector class and flocking math adapted from Daniel Huang's
  [boids](https://github.com/cubeDhuang/boids) (MIT).
- **DITHR** — ordered-dither by Sean S. LeBlanc (MIT), CMYK rosette halftone by
  Stefan Gustavson adapted by Matt DesLauriers (MIT), and an ASCII shader by
  humanbydefinition; ported verbatim.
- **SKAAAN** — easing curves (Penner) via Manohar Vanga / Jeff Thompson's
  [sighack](https://sighack.com/post/easing-functions-in-processing) (MIT).
- **FIELD** — the fragment shader is ported from `fluid-core` by KrackedDevs
  ([enonforetsam/fluid](https://github.com/enonforetsam/fluid), MIT) and kept
  verbatim; palettes, presets and the control surface are original.
