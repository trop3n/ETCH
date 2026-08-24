// Export controls for Etch tools, shared across every tool via attachExport:
//  - PNG still (with integer upscale)
//  - SVG (vector tools, when getSVG is provided)
//  - Video recording (MediaRecorder) with fps, bitrate, and fixed-duration
//    auto-stop. WebM, or real MP4: native MP4 where the browser records it,
//    otherwise the recorded WebM is transcoded to MP4 in-browser via a vendored,
//    same-origin ffmpeg.wasm (single-threaded core — no COOP/COEP needed).
//  - PNG/WebP frame sequence zipped.
export function attachExport(page, { getCanvas, getSVG, name = 'export' }) {
  const opts = { scale: 1 };
  page.addBinding(opts, 'scale', { label: 'Resolution ×', min: 1, max: 4, step: 1 });

  page.addButton({ title: 'Save PNG' }).on('click', () => {
    const canvas = getCanvas();
    if (!canvas) return;
    const out = opts.scale === 1 ? canvas : upscale(canvas, opts.scale);
    out.toBlob((blob) => { if (blob) download(blob, `${name}.png`); }, 'image/png');
  });

  if (getSVG) {
    page.addButton({ title: 'Save SVG' }).on('click', () => {
      const svg = getSVG();
      if (svg) download(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
    });
  }

  page.addBlade({ view: 'separator' });

  // ---- Video recording ----
  const vid = { format: 'webm', fps: 30, bitrate: 12, duration: 0, status: 'idle' };
  page.addBinding(vid, 'format', { options: { WebM: 'webm', MP4: 'mp4' } });
  page.addBinding(vid, 'fps', { min: 12, max: 60, step: 1 });
  page.addBinding(vid, 'bitrate', { label: 'bitrate Mbps', min: 1, max: 40, step: 1 });
  page.addBinding(vid, 'duration', { label: 'auto-stop s', min: 0, max: 60, step: 1 });
  const recBtn = page.addButton({ title: 'Record Video' });
  const vidStatus = page.addBinding(vid, 'status', { readonly: true, label: 'video' });
  let rec = null, chunks = null, recMime = '', autoStop = null, countdown = null;
  const setStatus = (s) => { vid.status = s; vidStatus.refresh(); };
  const clearTimers = () => { if (autoStop) { clearTimeout(autoStop); autoStop = null; } if (countdown) { clearInterval(countdown); countdown = null; } };

  recBtn.on('click', () => {
    if (rec) { rec.stop(); return; }
    const canvas = getCanvas();
    const wantMp4 = vid.format === 'mp4';
    const mime = pickVideoMime(wantMp4);
    if (!canvas || typeof canvas.captureStream !== 'function' || !mime) { setStatus('unsupported'); return; }
    try {
      const stream = canvas.captureStream(vid.fps);
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: vid.bitrate * 1_000_000 });
    } catch (e) { console.error('record init failed', e); setStatus('error'); rec = null; return; }
    recMime = mime; chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      clearTimers();
      recBtn.title = 'Record Video';
      const recordedExt = recMime.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: recMime });
      rec = null;
      if (wantMp4 && recordedExt !== 'mp4') {
        try {
          const mp4 = await transcodeToMp4(blob, setStatus);
          download(mp4, `${name}.mp4`); setStatus('idle');
        } catch (e) {
          console.error('mp4 transcode failed', e);
          download(blob, `${name}.webm`); setStatus('mp4 failed → webm');
        }
      } else {
        download(blob, `${name}.${recordedExt}`); setStatus('idle');
      }
    };
    rec.start();
    recBtn.title = '■ Stop';
    if (vid.duration > 0) {
      let left = vid.duration;
      setStatus(`recording… ${left}s`);
      countdown = setInterval(() => { left -= 1; if (left > 0) setStatus(`recording… ${left}s`); }, 1000);
      autoStop = setTimeout(() => { if (rec) rec.stop(); }, vid.duration * 1000);
    } else setStatus('recording…');
  });

  // ---- Frame sequence (PNG/WebP zip) ----
  const fr = { frames: 60, format: 'png', status: 'idle' };
  page.addBinding(fr, 'frames', { min: 6, max: 600, step: 6 });
  page.addBinding(fr, 'format', { options: { PNG: 'png', WebP: 'webp' } });
  const frBtn = page.addButton({ title: 'Export Frames (zip)' });
  const frStatus = page.addBinding(fr, 'status', { readonly: true, label: 'frames' });
  let exporting = false, cancel = false;
  frBtn.on('click', async () => {
    if (exporting) { cancel = true; return; } // re-click cancels an in-progress export
    const canvas = getCanvas();
    if (!canvas) return;
    exporting = true; cancel = false; fr.status = 'loading zip…'; frStatus.refresh();
    frBtn.title = 'Cancel Export';
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      const type = fr.format === 'webp' ? 'image/webp' : 'image/png';
      for (let i = 0; i < fr.frames; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        if (cancel) break;
        const blob = await new Promise((res) => canvas.toBlob(res, type));
        if (blob) zip.file(`${name}_${String(i).padStart(4, '0')}.${fr.format}`, blob);
        fr.status = `${i + 1}/${fr.frames}`; frStatus.refresh();
      }
      if (cancel) {
        fr.status = 'cancelled'; frStatus.refresh();
      } else {
        download(await zip.generateAsync({ type: 'blob' }), `${name}_frames.zip`);
        fr.status = 'done'; frStatus.refresh();
      }
    } catch (e) {
      console.error('frame export failed', e); fr.status = 'error'; frStatus.refresh();
    }
    exporting = false; cancel = false; frBtn.title = 'Export Frames (zip)';
  });
}

function pickVideoMime(preferMp4) {
  if (typeof MediaRecorder === 'undefined') return null;
  const webm = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mp4 = ['video/mp4;codecs=avc1', 'video/mp4'];
  const order = preferMp4 ? [...mp4, ...webm] : [...webm, ...mp4];
  for (const m of order) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* ignore */ } }
  return null;
}

// Vendored JSZip (UMD build) — lazy-loaded via a dynamic same-origin <script> so
// it's only fetched on first frame-sequence export. Attaches to window.JSZip.
let _jszipPromise = null;
function loadJSZip() {
  if (_jszipPromise) return _jszipPromise;
  if (window.JSZip) return Promise.resolve(window.JSZip);
  _jszipPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/jszip/jszip.min.js', import.meta.url).href;
    s.onload = () => (window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip did not initialize')));
    s.onerror = () => { _jszipPromise = null; reject(new Error('JSZip load failed')); };
    document.head.appendChild(s);
  });
  return _jszipPromise;
}

// ---- Vendored ffmpeg.wasm (same-origin → module worker + ESM core load with no
//      cross-origin / COOP-COEP issues). Single-threaded core (no SharedArrayBuffer). ----
let _ffmpeg = null, _ffmpegLoad = null;
function loadFFmpeg(onState) {
  if (_ffmpeg) return Promise.resolve(_ffmpeg);
  if (_ffmpegLoad) return _ffmpegLoad;
  _ffmpegLoad = (async () => {
    onState && onState('loading ffmpeg…');
    const { FFmpeg } = await import('../vendor/ffmpeg/pkg/index.js');
    const ff = new FFmpeg();
    await ff.load({
      coreURL: new URL('../vendor/ffmpeg/core/ffmpeg-core.js', import.meta.url).href,
      wasmURL: new URL('../vendor/ffmpeg/core/ffmpeg-core.wasm', import.meta.url).href,
    });
    _ffmpeg = ff;
    return ff;
  })();
  return _ffmpegLoad;
}

async function transcodeToMp4(webmBlob, onState) {
  const ff = await loadFFmpeg(onState);
  onState && onState('transcoding mp4…');
  await ff.writeFile('in.webm', new Uint8Array(await webmBlob.arrayBuffer()));
  // ff['exec'] runs ffmpeg INSIDE the wasm sandbox with a fixed argument array —
  // no shell, no child_process, no interpolated input (not Node's exec).
  const runFFmpeg = ff['exec'].bind(ff);
  // scale to even dimensions — H.264 / yuv420p requires width & height divisible by 2
  await runFFmpeg(['-i', 'in.webm', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-movflags', '+faststart', 'out.mp4']);
  const data = await ff.readFile('out.mp4');
  return new Blob([data.buffer], { type: 'video/mp4' });
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.download = filename;
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // defer — click() navigation isn't guaranteed synchronous
}

function upscale(src, scale) {
  const c = document.createElement('canvas');
  c.width = src.width * scale;
  c.height = src.height * scale;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
