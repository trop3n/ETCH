# AGENTS.md

Static HTML/JS/CSS project — **no build, no bundler, no tests, no package.json**. Serve with any static HTTP server (ES modules + the vendored ffmpeg need same-origin):

```
python3 -m http.server 8000
```

Read `CLAUDE.md` for the full architecture before making changes.

## Two tool families

- **Etch stack** (current work) — `tools/<name>/` built on **p5.js + Tweakpane + Paper.js + opentype.js** via the shared shell in `js/etch/`. Libraries load per page (Tweakpane through an import map; p5/paper/opentype as global `<script>`s; JSZip via dynamic import; **ffmpeg.wasm vendored** in `js/vendor/ffmpeg/`). Entry: root `index.html`.
- **Legacy raster** — original vanilla Canvas/WebGL tools importing `js/media-source.js`, sidebar+canvas layout. Untouched, preserved. Listed in the Classic Tools section of the root `index.html`.

## Key constraints

- **No build steps, ever.** No bundlers/transpilers/npm. Libs come from CDN + import maps; ffmpeg is vendored for offline-safe, same-origin MP4.
- **No tool-specific CSS files** — everything uses `css/style.css`.
- **Comment-light code.** The one exception: each `js/etch/` shared module carries a short header comment documenting its role/API.
- **No tests** — verify by opening the tool in a browser and checking the console + canvas.
- **Dev cache:** `python -m http.server` sends no cache headers; hard-refresh after editing a shared module or the browser serves a stale copy.

## Adding a tool

Follow the `CLAUDE.md` checklist. The fast path: copy the closest existing tool of the same type and adapt.
- Etch-stack types: raster → `tools/ritm`, vector → `tools/splitx`, shader → `tools/refract`, 3D → `tools/plain`, typography → `tools/textr`, image-manip → `tools/skaaan`.
- Legacy: copy any `tools/<name>/` and reuse `js/media-source.js` + `css/style.css` classes.

## Shared code

- `js/etch/` — `shell.js` (createTool), `presets.js` (attachPresets), `export.js` (attachExport: PNG/SVG/video/frames), `noise.js`, `typography.js`, `shapes.js`, `palette.js`, `previews.js` (landing thumbnails).
- `js/media-source.js`, `js/color.js`, `js/previews.js` — legacy shared modules.
- `js/vendor/ffmpeg/` — vendored ffmpeg.wasm (`pkg/` ESM + `core/` single-threaded core; `ffmpeg-core.wasm` ~32 MB, committed).
