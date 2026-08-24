# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Etch is a collection of browser-based visual/creative tools. There is **no build system, bundler, or transpiler** — files are served as-is. Two families of tools live side by side:

1. **Etch-stack tools** (the current focus) — a recreation/homage of the antlii.work generative toolset (artist Anatolii Babii), built on **p5.js + Tweakpane + Paper.js + opentype.js**, with a shared shell in `js/etch/`. 18 tools.
2. **Legacy raster tools** — the original vanilla-Canvas/WebGL tools, untouched. 12 tools (the four superseded by Etch-stack recreations — flake, refract, boids, rhythm — were deleted). Intentionally preserved.

The root `index.html` is the single landing page: the Etch grid plus a Classic Tools section listing the legacy tools.

> Background: `antlii-spec.md`, `antlii-tool-specs.md`, and `antlii-recreation-plan.md` document the audit of the live antlii.work site and the recreation plan. The recreation goal is functional homage — original code/presets/copy, not asset/branding copies.
>
> **`Handoff.md` is the active working doc** for the faithful-recreation effort (one tool per session): it holds the IP posture, the "read antlii's real open source at `antlii.github.io/<slug>/`" method, a shared-module API table, and a per-tool progress tracker + session log — update it when you finish a tool. `AGENTS.md` is a condensed pointer to this file for other agents.

## Development

Serve the project root with any static HTTP server (ES modules + the vendored ffmpeg require same-origin):

```
python3 -m http.server 8000
```

Open `index.html`, or navigate directly to `tools/<name>/`.

There are no tests, linters, or build steps — **verify changes by opening the tool in a browser** (watch the console; screenshot the canvas).

**Dev gotcha:** `python -m http.server` sends no cache headers, so after editing a shared module (e.g. `js/etch/export.js`) the browser may serve the cached old copy. Hard-refresh (Ctrl/Cmd+Shift+R) or use a fresh tab to pick up shared-module edits.

---

## Architecture A — Etch-stack tools (current)

### Layout
Each tool is `tools/<name>/index.html` + `tools/<name>/<name>.js`. The HTML loads the libraries the tool needs and the module; the module builds the tool on the shared shell.

### Libraries (loaded per page; no bundler)
- **Tweakpane** (control panel) — ESM via import map: `<script type="importmap">{ "imports": { "tweakpane": "https://esm.sh/tweakpane@4.0.5" } }</script>`, then `import { Pane } from 'tweakpane'`.
- **p5.js** — global script `cdn.jsdelivr.net/npm/p5@1.9.4` → `window.p5` (raster / shader / 3D / image tools).
- **Paper.js** — global `paper-full@0.12.18` → `window.paper` (vector + type tools; `-full` build has SVG import/export).
- **opentype.js** — global `opentype.js@1.3.4` → `window.opentype` (type tools, via `typography.js`).
- **JSZip** — dynamic `import('https://esm.sh/jszip@3.10.1')` inside `export.js` (frame-sequence zip; only fetched on use).
- **ffmpeg.wasm** — **vendored** in `js/vendor/ffmpeg/` (same-origin so the module Worker + ESM core load without COOP/COEP). Single-threaded core; `ffmpeg-core.wasm` is ~32 MB and is committed (not gitignored). Only loaded on first MP4 export.

### Shared modules — `js/etch/`
- **`shell.js`** — `createTool({ name, version, backHref })` → `{ root, pane, pages: {main, export, options}, canvasHost, startSketch(factory), mountCanvas(), getCanvas(), toggleFullscreen() }`. Builds a floating Tweakpane panel (tabs `MAIN / EXPORT / OPTIONS`) over a full-bleed canvas. `startSketch(fn)` runs a p5 instance-mode sketch in `canvasHost`; `mountCanvas()` returns a bare `<canvas>` for Paper.js tools. Fullscreen on the `f` key.
- **`presets.js`** — `attachPresets(page, { pane, params, presets, randomize?, onApply? })`. Named-preset dropdown + Restart + Randomize + JSON import/export. Presets and files operate on the plain `params` object; call `pane.refresh()` after mutating it (handled internally).
- **`export.js`** — `attachExport(page, { getCanvas, getSVG?, name })`. PNG (multi-res), SVG (if `getSVG`), **video** (MediaRecorder WebM / native MP4 / vendored-ffmpeg WebM→MP4 transcode; fps + bitrate + auto-stop), and **PNG/WebP frame-sequence zip**. Every tool gets all of it for free.
- **`noise.js`** — `alea(seed)`→seeded RNG, `seedNoise(seed)`, `noise2D(x,y)`, `noise3D(x,y,z)`, `noise4D(x,y,z,w)` (4D = looped motion: animate 2 dims). Wraps vendored `js/vendor/simplex/simplex-noise.js`.
- **`typography.js`** — `FONT_OPTIONS`, `loadFont(name)`→Promise (built-in Google TTFs via CDN), `parseFont(arrayBuffer)` (dropped fonts), `textUnits(font, text, fontSize, mode)`→array of SVG path-data strings (`mode`: letters/words/block).
- **`shapes.js`** — `SHAPE_OPTIONS`, `makeShape(type, size)` → a Paper.js item centered at origin.
- **`palette.js`** — color modes (solid/sequence/transition) + curated palettes + a swatch/Random/Shuffle UI. `interpolateHex(a,b,t)`, `pickColor(colors,mode,i,n)`, `PALETTES`, `randomPalette(rng?)`, `buildLayers(colors,layers,rng?)`, `toTransitionStops(colors)`, `paletteLerp(stops,t)`, `attachPaletteControls(folder, { palette, pane, onChange })`.
- **`previews.js`** — `initPreviews()` drives the landing-page `canvas[data-preview]` thumbnails (separate from the legacy `js/previews.js`).

### Per-type tool pattern
- **Raster** (RITM): `startSketch` 2D; draw each frame from `params`.
- **Vector** (SPLITX, FLAKE): `const canvas = mountCanvas(); paper.setup(canvas); paper.view.onFrame = ...`; SVG export via `() => paper.project.exportSVG({ asString: true })`.
- **Shader** (REFRACT, BLUUR, FIELD): `startSketch` with `createCanvas(w,h,p.WEBGL)` + `setAttributes('preserveDrawingBuffer', true)` + `createShader(VERT, FRAG)` + fullscreen `rect`.
- **3D** (PLAIN): p5 WEBGL custom mesh with per-face normals + lighting.
- **Typography** (TEXTR, SAMPL, RASTR): `typography.js` → glyph path data → Paper `importSVG` / sampling.
- **Image-manip** (SKAAAN, DRIFT, KLON, STIIL): p5 2D + pointer listeners on `tool.canvasHost` (the floating pane sits above it, so it never triggers canvas interactions) + image drag-drop.
- **Render cadence:** animated tools rebuild every frame; static/on-change tools use a `dirty` flag set via `tool.pane.on('change', () => dirty = true)`.

### Landing
`index.html` — Etch grid + Classic Tools grid (`tool-card` + `canvas[data-preview]`). Driven by `js/index-previews.js`, which runs both preview modules (`js/etch/previews.js` + legacy `js/previews.js`; their key sets are disjoint).

---

## Architecture B — legacy raster tools

Original two-file pattern: `tools/<name>/index.html` (sidebar controls + canvas, loads JS as `type="module"`) + `tools/<name>/<name>.js`. Most import `MediaSource` from `js/media-source.js`:

- `MediaSource` — `.drawable`, `.ready`, `.width`, `.height`, `.type` (`camera|screen|video|image`); async `useCamera()/useScreen()/useVideo(file)/useImage(file)/stop()`.
- `createSourceSelector(container, { transition })` → `{ mediaSource, onChange(cb) }` — builds source UI + default gradient sample; `transition` fades a DOM element on source change.
- `js/color.js` — `parseColor(value)`, a CSS-color parser that reuses one 1×1 canvas + caches the last input (zero-allocation for high-frequency range-input renders).

Conventions: sidebar (`.tool-sidebar`, 280px) on the left, canvas fills the rest; fullscreen via `.tool-layout.fullscreen`; Save PNG via `canvas.toBlob`; `← Tools` back link. Standalone (no media source): cellular-automata, srt2video. (`js/previews.js` supplies the legacy thumbnails on the main page via `js/index-previews.js`.)

---

## Shared styles — `css/style.css`

Single stylesheet for everything. CSS variables (`:root`): `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-dim`, `--accent`, `--mono` (IBM Plex Mono), `--sans` (IBM Plex Sans).
- Legacy layout: `.tool-layout`, `.tool-sidebar`, `.tool-canvas-area`, control components (`.control-group`, `.range-row`, `.radio-row`, `.color-swatch-row`, `.btn`, `.separator`).
- Etch layout: `.etch-tool` / `.etch-canvas` / `.etch-pane` / `.etch-back`; landing extras `.index-nav` / `.index-about` (the index grid reuses `.index-page` / `.tools-grid` / `.tool-card`). Tweakpane injects its own CSS at runtime.

## Tools

**Etch stack (18):** FLAKE `flake`, SPLITX `splitx`, BLUUR `bluur`, TEXTR `textr`, SAMPL `sampl`, RASTR `rastr`, RITM `ritm`, REFRACT `refract`, DITHR `dithr`, PLAIN `plain`, BIOM `biom`, DRIFT `drift`, KLON `klon`, SKAAAN `skaaan`, STIIL `stiil`, BOIDS `boids`, FIELD `field`, TERMNL `termnl`.

**Legacy (12):** blob-tracker, cellular-automata, dithering, flipdigits, gradient-map, mesher, pixel-flow, pixelator, shapes, srt2video, text, video2midi.

## Adding an Etch-stack tool

1. Copy the closest existing tool of the same type (raster → `ritm`, vector → `splitx`, shader → `refract`, type → `textr`, image-manip → `skaaan`).
2. `tools/<name>/index.html`: the Tweakpane import map + the global `<script>`s the tool needs (p5 and/or paper-full and/or opentype.js), then `<script type="module" src="<name>.js">`.
3. `tools/<name>/<name>.js`: `createTool(...)`, build folders/bindings on `tool.pages.main`, `attachExport` + `attachPresets`, render via `startSketch`/`mountCanvas`. Reuse `noise`/`shapes`/`palette`/`typography` as needed.
4. Add a card to `index.html` and a preview effect to `js/etch/previews.js`.

## Conventions

- **No bundler/build, ever** — CDN + import maps for libs, vendored ffmpeg for offline-safe MP4.
- **One shared stylesheet** (`css/style.css`); no tool-specific CSS files.
- **Comment-light code.** Exception: each `js/etch/` shared module has a short header comment documenting its role/API.
- **No tests** — verify in a browser.
