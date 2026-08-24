// Lightweight animated Canvas2D previews for the Etch-stack landing cards.
// Each effect is an evocative approximation of the tool (not the real engine),
// kept cheap so 8 can animate together. Drives canvas[data-preview="<name>"].

const W = 180, H = 120;

const effects = {
  // FIELD: a procedural field sampled through a log-polar (droste) lens — the
  // real pipeline in miniature, rendered into a small ImageData and scaled up.
  // TERMNL: a miniature character grid — a rotating torus resolved to glyphs,
  // the tool's own pipeline at preview scale.
  termnl: {
    init() { return { f: 0 }; },
    draw(ctx, f) {
      const cell = 6, cw = cell * 0.6;
      const cols = Math.floor(W / cw), rows = Math.floor(H / cell);
      const ramp = ' .:-=+*#%@';
      ctx.fillStyle = '#03120a'; ctx.fillRect(0, 0, W, H);
      ctx.font = `${cell}px 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'top';
      const t = f * 0.03;
      const ca = Math.cos(t * 0.9), sa = Math.sin(t * 0.9);
      const cb = Math.cos(t * 0.62), sb = Math.sin(t * 0.62);
      const z = new Float32Array(cols * rows), v = new Float32Array(cols * rows);
      const R = 1, r = 0.42, scale = Math.min(cols / 2, rows) * 1.32;
      for (let i = 0; i < 6000; i++) {
        const u = (i % 120) / 120 * Math.PI * 2, w = Math.floor(i / 120) / 50 * Math.PI * 2;
        const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(w), sv = Math.sin(w);
        const px = (R + r * cv) * cu, py = (R + r * cv) * su, pz = r * sv;
        const y1 = py * ca - pz * sa, z1 = py * sa + pz * ca;
        const x2 = px * cb - y1 * sb, y2 = px * sb + y1 * cb;
        const ny1 = (cv * su) * ca - sv * sa, nz1 = (cv * su) * sa + sv * ca;
        const nx2 = (cv * cu) * cb - ny1 * sb, ny2 = (cv * cu) * sb + ny1 * cb;
        const zz = z1 + 4.2; if (zz <= 0.05) continue;
        const ooz = 1 / zz;
        const sx = Math.round(cols / 2 + scale * x2 * ooz * 2);
        const sy = Math.round(rows / 2 - scale * y2 * ooz);
        if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) continue;
        const k = sy * cols + sx;
        if (ooz <= z[k]) continue;
        z[k] = ooz;
        v[k] = Math.max(0.06, Math.min(1, (ny2 * 0.7071 - nz1 * 0.7071 + 0.55) * 0.78));
      }
      for (let y = 0; y < rows; y++) {
        let run = '';
        for (let x = 0; x < cols; x++) run += ramp[Math.round(v[y * cols + x] * 9)];
        const g = 90 + Math.round(120 * (1 - y / rows));
        ctx.fillStyle = `rgb(60,${g + 60},90)`;
        ctx.fillText(run, 0, y * cell);
      }
    },
  },
  field: {
    init() { return { buf: null }; },
    draw(ctx, f, st) {
      const bw = 90, bh = 60;
      if (!st.buf) st.buf = ctx.createImageData(bw, bh);
      const d = st.buf.data;
      const stops = [[15, 6, 3], [74, 28, 8], [184, 100, 28], [251, 227, 188]];
      const t = f * 0.02;
      const cx = bw / 2, cy = bh / 2;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const dx = (x - cx) / bh, dy = (y - cy) / bh;
          const r = Math.max(Math.hypot(dx, dy), 1e-3);
          const a = Math.atan2(dy, dx);
          const lr = Math.log(r);
          const u = lr * 2.4 + a * 0.8 + t;
          const v = a * 3.0 + lr * 0.7 - t * 0.7;
          let g = (Math.sin(u * 2.0) * 0.5 + 0.5) * 0.6 + (Math.sin(v * 2.0) * 0.5 + 0.5) * 0.4;
          g = g * g * (3 - 2 * g);
          const s = g * 3, i0 = Math.min(2, s | 0), ft = s - i0;
          const A = stops[i0], B = stops[i0 + 1];
          const o = (y * bw + x) * 4;
          d[o] = A[0] + (B[0] - A[0]) * ft;
          d[o + 1] = A[1] + (B[1] - A[1]) * ft;
          d[o + 2] = A[2] + (B[2] - A[2]) * ft;
          d[o + 3] = 255;
        }
      }
      ctx.putImageData(st.buf, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(ctx.canvas, 0, 0, bw, bh, 0, 0, W, H);
    },
  },
  ritm: {
    draw(ctx, f) {
      ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H);
      const lines = 14;
      for (let i = 0; i < lines; i++) {
        const y = H * (i + 1) / (lines + 1);
        ctx.strokeStyle = `hsl(${(200 + i / lines * 90) % 360},75%,62%)`;
        ctx.lineWidth = 1.5; ctx.beginPath();
        for (let x = 0; x <= W; x += 3) {
          const v = Math.sin(x * 0.05 + f * 0.04 + i * 0.3) * 8 + Math.sin(x * 0.13 + f * 0.03) * 5;
          ctx.lineTo(x, y + v);
        }
        ctx.stroke();
      }
    },
  },
  splitx: {
    // A stamped shape repeated along a diagonal, quad-mirrored into an X of
    // nested contours with a transition ramp — the SPLITX signature.
    draw(ctx, f) {
      ctx.fillStyle = '#0a0a14'; ctx.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, n = 13;
      ctx.lineWidth = 1.1;
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        ctx.save(); ctx.translate(cx, cy); ctx.scale(sx, sy);
        for (let i = 0; i < n; i++) {
          const wob = Math.sin(f * 0.03 + i * 0.45), r = 6 + i * 6.2;
          ctx.strokeStyle = `hsl(${(212 + i * 12 + f * 0.4) % 360},72%,${58 + wob * 6}%)`;
          ctx.beginPath();
          ctx.moveTo(r * 1.5, r * 0.15);
          ctx.lineTo(r * 0.45 + wob * 2, r * 0.45 + wob * 2);
          ctx.lineTo(r * 0.15, r * 1.5);
          ctx.stroke();
        }
        ctx.restore();
      }
    },
  },
  flake: {
    draw(ctx, f) {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
      const gx = 6, gy = 4, cw = W / gx, ch = H / gy;
      for (let r = 0; r < gy; r++) for (let c = 0; c < gx; c++) {
        const x = c * cw + cw / 2, y = r * ch + ch / 2;
        const dist = Math.hypot(c - gx / 2 + 0.5, r - gy / 2 + 0.5) / 3;
        ctx.save(); ctx.translate(x, y); ctx.rotate(f * 0.03 + dist * 3);
        ctx.strokeStyle = `hsl(${((260 - dist * 120) % 360 + 360) % 360},55%,55%)`; ctx.lineWidth = 1;
        const s = cw * 0.32 * (1 - dist * 0.4);
        for (let k = 0; k < 6; k++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -s); ctx.stroke(); }
        ctx.restore();
      }
    },
  },
  textr: {
    // Stacked rows of a repeated letter (TEXTR's kinetic engine): each row's
    // count forms a back-and-forth diamond, with a per-row sine wave displacing
    // copies horizontally — the new TEXTR signature.
    draw(ctx, f) {
      ctx.fillStyle = '#101010'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#f5f5f5';
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const letters = 'TEXTR', rows = 11, rh = H / (rows + 1);
      for (let r = 0; r < rows; r++) {
        const ch = letters[r % letters.length];
        const count = 3 + Math.round(Math.abs(Math.sin(r / rows * Math.PI)) * 6); // diamond
        const y = rh * (r + 1);
        const phase = (r / rows) * Math.PI * 2;
        for (let i = 0; i < count; i++) {
          const t = count > 1 ? i / (count - 1) - 0.5 : 0;
          const wave = Math.sin(t * Math.PI * 2 + f * 0.04 + phase) * 14;
          ctx.fillText(ch, W / 2 + t * W * 0.62 + wave, y);
        }
      }
    },
  },
  sampl: {
    draw(ctx, f) {
      ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, W, H);
      // glyph outline traced by a travelling field of coloured dots
      ctx.save();
      ctx.font = `900 ${Math.round(H * 0.7)}px Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5 + (1 + Math.sin(f * 0.06)) * 1.5;
      ctx.lineCap = 'round';
      ctx.setLineDash([0.1, 8]);
      ctx.lineDashOffset = -f * 0.7;
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, '#ff4d6d'); grad.addColorStop(0.5, '#ffb703'); grad.addColorStop(1, '#3a86ff');
      ctx.strokeStyle = grad;
      ctx.strokeText('Sa', W / 2, H / 2 + 2);
      ctx.restore();
    },
  },
  rastr: {
    // A glyph rasterized into a grid of shapes — one stamp per covered cell,
    // gradient-coloured across the width and rippled by a sine wave (RASTR).
    init() {
      const g = document.createElement('canvas'); g.width = W; g.height = H;
      const c = g.getContext('2d');
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 92px "Arial Black", Arial, sans-serif';
      c.fillText('R', W / 2, H / 2 + 4);
      return { data: c.getImageData(0, 0, W, H).data };
    },
    draw(ctx, f, s) {
      ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, W, H);
      const gx = 34, gy = 24, cw = W / gx, ch = H / gy;
      for (let r = 0; r < gy; r++) for (let c = 0; c < gx; c++) {
        const px = Math.min(W - 1, (c * cw + cw / 2) | 0), py = Math.min(H - 1, (r * ch + ch / 2) | 0);
        if (s.data[(py * W + px) * 4 + 3] < 128) continue;
        const wave = Math.sin(c * 0.45 - f * 0.05) * 2.6;
        const t = c / gx;
        ctx.fillStyle = `hsl(${(332 - t * 150 + f * 0.3) % 360},82%,62%)`;
        ctx.beginPath(); ctx.arc(c * cw + cw / 2, r * ch + ch / 2 + wave, cw * 0.46, 0, Math.PI * 2); ctx.fill();
      }
    },
  },
  refract: {
    init() {
      const g = document.createElement('canvas'); g.width = W; g.height = H;
      const c = g.getContext('2d');
      const grad = c.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, '#16213e'); grad.addColorStop(0.5, '#0f3460'); grad.addColorStop(0.8, '#533483'); grad.addColorStop(1, '#e94560');
      c.fillStyle = grad; c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(255,255,255,0.18)';
      for (let x = 0; x <= W; x += 14) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
      for (let y = 0; y <= H; y += 14) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      return { img: g };
    },
    draw(ctx, f, s) {
      const fx = 8, fy = 6, cw = W / fx, ch = H / fy;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      for (let r = 0; r < fy; r++) for (let c = 0; c < fx; c++) {
        const ox = Math.sin(c * 1.7 + r * 0.9 + f * 0.03) * 6, oy = Math.cos(c * 1.1 + r * 1.3 + f * 0.025) * 6;
        ctx.drawImage(s.img, c * cw, r * ch, cw, ch, c * cw + ox, r * ch + oy, cw, ch);
      }
    },
  },
  bluur: {
    // A small grid of soft, per-shape-blurred forms fused through MULTIPLY over a
    // pale palette-derived ground — the new BLUUR engine's signature look.
    draw(ctx, f) {
      ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#f3e9d6'; ctx.fillRect(0, 0, W, H);
      const cols = 3, rows = 3, cw = W / cols, ch = H / rows;
      const cols5 = ['#3c2706', '#cc3904', '#e5cf0a', '#f3a712', '#7a5649'];
      ctx.globalCompositeOperation = 'multiply';
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const ox = Math.sin(f * 0.012 + i * 1.3) * 10, oy = Math.cos(f * 0.01 + i * 0.7) * 10;
        const x = c * cw + cw / 2 + ox, y = r * ch + ch / 2 + oy;
        const rad = cw * (0.62 + Math.sin(f * 0.015 + i) * 0.16);
        ctx.filter = `blur(${6 + Math.sin(f * 0.02 + i) * 3}px)`;
        ctx.fillStyle = cols5[i % cols5.length];
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      }
      ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
    },
  },
  plain: {
    draw(ctx, f) {
      ctx.fillStyle = '#06070d'; ctx.fillRect(0, 0, W, H);
      const cols = 10, rows = 7, cw = W / cols, ch = H / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const h = Math.sin(c * 0.6 + r * 0.5 + f * 0.04) * 0.5 + 0.5;
        ctx.fillStyle = `hsl(200,45%,${18 + h * 55}%)`;
        const x = c * cw, y = r * ch;
        ctx.beginPath(); ctx.moveTo(x, y + ch); ctx.lineTo(x + cw / 2, y + ch - h * ch * 0.85); ctx.lineTo(x + cw, y + ch); ctx.closePath(); ctx.fill();
      }
    },
  },
  skaaan: {
    // A horizontal scan-line sweeping across a colourful source, each column
    // sampled from a vertically-noise-shifted copy → vertical streak displacement.
    // SKAAAN's signature scan-line glitch.
    init() {
      const g = document.createElement('canvas'); g.width = W; g.height = H;
      const c = g.getContext('2d');
      const gr = c.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, '#ff5a3c'); gr.addColorStop(0.5, '#b13ad9'); gr.addColorStop(1, '#2b6bff');
      c.fillStyle = gr; c.fillRect(0, 0, W, H);
      // a few warm/cool blobs so streaks have variation
      for (let i = 0; i < 8; i++) {
        c.fillStyle = `hsla(${(i * 47) % 360},80%,60%,0.5)`;
        c.beginPath(); c.arc((i * 31 + 11) % W, (i * 17 + 5) % H, 14 + (i * 7) % 22, 0, 7); c.fill();
      }
      return { src: g, scanX: 0 };
    },
    draw(ctx, f, s) {
      // sweep a horizontal scan across, each column = a vertically-displaced
      // slice of the source. After a full sweep, restart.
      s.scanX = (s.scanX + 1) % (W + 1);
      // every frame, advance and paint a noise-shifted slice
      for (let i = 0; i < 2; i++) {
        const x = (s.scanX + i) % W;
        const dy = Math.sin(x * 0.08 + f * 0.05) * 18 + Math.sin(x * 0.21 - f * 0.03) * 10;
        ctx.drawImage(s.src, x, 0, 1, H, x, dy, 1, H);
      }
      // show a faint scan-line indicator
      ctx.fillStyle = 'rgba(255,30,30,0.4)'; ctx.fillRect(s.scanX, 0, 2, H);
    },
  },
  drift: {
    // Thin image-fragment slivers rotating in "layer" mode accumulate into a
    // spinning fan — DRIFT's signature (sample a piece, let it drift & spin,
    // trails build up).
    draw(ctx, f) {
      ctx.fillStyle = 'rgba(8,9,15,0.06)'; ctx.fillRect(0, 0, W, H); // slow trail fade
      const cx = W / 2, cy = H / 2;
      for (let i = 0; i < 3; i++) {
        const a = f * 0.04 * (1 + i * 0.2) + i * 2.1;
        const hue = (a * 30 + i * 80) % 360;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
        ctx.fillStyle = `hsla(${hue},75%,60%,0.55)`;
        ctx.fillRect(0, -2.5, 52, 5); // a sampled sliver swung from the centre
        ctx.restore();
      }
    },
  },
  klon: {
    // A grid-snapped clone-stamp drag: dotted grid background + a trail of
    // ellipse/triangle/rect image-fragment stamps sweeping across, KLON's
    // signature collage gesture.
    draw(ctx, f) {
      ctx.fillStyle = '#f1eee5'; ctx.fillRect(0, 0, W, H);
      // grid dots
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 4; y < H; y += 10) for (let x = 4; x < W; x += 10) ctx.fillRect(x, y, 1.2, 1.2);
      // a sweeping trail — alternating shape masks coloured from a gradient
      const cx = 20, cy = H / 2;
      for (let i = 0; i < 14; i++) {
        const t = (i + (f * 0.04) % 1) / 14;
        const x = cx + t * (W - 40);
        const y = cy + Math.sin(t * 7 + f * 0.04) * 18;
        const hue = 200 + t * 160;
        ctx.fillStyle = `hsla(${hue % 360},75%,55%,0.7)`;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (i % 3 === 0) {
          ctx.rect(x - 9, y - 9, 18, 18);
        } else if (i % 3 === 1) {
          ctx.moveTo(x - 9, y + 9); ctx.lineTo(x - 9, y - 9); ctx.lineTo(x + 9, y - 9); ctx.closePath();
        } else {
          ctx.ellipse(x, y, 9, 9, 0, 0, 7);
        }
        ctx.fill(); ctx.stroke();
      }
    },
  },
  stiil: {
    draw(ctx, f) {
      for (let y = 0; y < H; y++) {
        const t = Math.floor((y / H + Math.sin(f * 0.02) * 0.12) * 5) / 5;
        ctx.fillStyle = `rgb(${Math.round(16 + t * 230)},${Math.round(9 + t * 200)},${Math.round(46 + t * 100)})`;
        ctx.fillRect(0, y, W, 1);
      }
    },
  },
  biom: {
    // A few orbiting forms, each stamped as concentric gradient rings (large→small
    // filled circles alternating colour) inside an ellipse clip — BIOM's signature
    // organic-cell bloom.
    draw(ctx, f) {
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, t = f * 0.012;
      ctx.save();
      ctx.beginPath(); ctx.ellipse(cx, cy, W * 0.46, H * 0.46, 0, 0, 7); ctx.clip();
      const layers = 13, rad = Math.min(W, H) * 0.2;
      for (let i = 0; i < 6; i++) {
        const px = cx + (Math.sin(t + i * 1.7) + Math.cos(t * 1.3 + i)) * rad;
        const py = cy + (Math.sin(t * 0.9 + i * 2.1) + Math.cos(t + i * 0.6)) * rad;
        for (let L = 0; L < layers; L++) {
          const size = (1 - L / layers) * Math.min(W, H) * 0.26;
          const v = Math.sin((L / (layers - 1)) * 6 + i * 0.5 - f * 0.04);
          const c = Math.round((v * 0.5 + 0.5) * 255);
          ctx.fillStyle = `rgb(${c},${Math.round(c * 0.15)},${Math.round(c * 0.1)})`;
          ctx.beginPath(); ctx.arc(px, py, size / 2, 0, 7); ctx.fill();
        }
      }
      ctx.restore();
    },
  },
  dithr: {
    // A lit sphere ordered-dithered and remapped through a blue→white palette —
    // DITHR's signature (a 3D form dithered + palette-mapped).
    draw(ctx, f) {
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], cell = 4;
      const pal = ['#11173a', '#2f6fed', '#43d9ff', '#eaf6ff'];
      const cx = W / 2, cy = H / 2, R = 42;
      const lx = Math.cos(f * 0.03), ly = Math.sin(f * 0.03 * 0.7);
      for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) {
        const dx = (x - cx) / R, dy = (y - cy) / R, d2 = dx * dx + dy * dy;
        const lum = d2 <= 1 ? Math.max(0.06, dx * lx * 0.55 + dy * ly * 0.55 + Math.sqrt(1 - d2) * 0.7) : 0.1;
        const bi = (((y / cell) | 0) & 3) * 4 + (((x / cell) | 0) & 3);
        const v = Math.min(0.999, Math.max(0, lum)) * (pal.length - 1);
        const idx = Math.min(pal.length - 1, Math.floor(v) + (((v % 1) * 16 > bayer[bi]) ? 1 : 0));
        ctx.fillStyle = pal[idx]; ctx.fillRect(x, y, cell - 1, cell - 1);
      }
    },
  },
  boids: {
    init() { const b = []; for (let i = 0; i < 22; i++) b.push({ x: Math.random() * W, y: Math.random() * H, a: Math.random() * 7 }); return { b }; },
    draw(ctx, f, s) {
      ctx.fillStyle = 'rgba(5,6,13,0.28)'; ctx.fillRect(0, 0, W, H);
      for (const o of s.b) {
        o.a += Math.sin(f * 0.02 + o.x * 0.05) * 0.1; o.x += Math.cos(o.a) * 1.2; o.y += Math.sin(o.a) * 1.2;
        if (o.x < 0) o.x += W; if (o.x > W) o.x -= W; if (o.y < 0) o.y += H; if (o.y > H) o.y -= H;
        ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.a); ctx.fillStyle = '#9ad0ff';
        ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3, 2.5); ctx.lineTo(-3, -2.5); ctx.closePath(); ctx.fill(); ctx.restore();
      }
    },
  },
};

let _init = false;
export function initPreviews() {
  if (_init) return; // idempotent — a soft reload won't double up the loops
  _init = true;
  const steps = [];
  document.querySelectorAll('canvas[data-preview]').forEach((canvas) => {
    const fx = effects[canvas.dataset.preview];
    if (!fx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const state = fx.init ? fx.init() : null;
    let f = 0;
    steps.push(() => { fx.draw(ctx, f, state); f++; });
  });
  let running = !document.hidden; // pause when the tab is backgrounded
  const tick = () => { if (running) for (const s of steps) s(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  document.addEventListener('visibilitychange', () => { running = !document.hidden; });
}
