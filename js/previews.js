// Animated canvas previews for the tools index page

const W = 180, H = 120;

function hexRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const effects = {

  dithering: {
    draw(ctx, f) {
      const bayer = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
      const s = f * 0.4;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 3) {
        for (let x = 0; x < W; x += 3) {
          const v = ((x + s) % (W * 2)) / (W * 2) + Math.sin(y / H * Math.PI * 1.5) * 0.25;
          const lum = Math.max(0, Math.min(1, v)) * 15;
          const bi = ((y / 3 | 0) & 3) * 4 + ((x / 3 | 0) & 3);
          if (lum > bayer[bi]) {
            ctx.fillStyle = '#d0d0d0';
            ctx.fillRect(x, y, 3, 3);
          }
        }
      }
    }
  },

  'cellular-automata': {
    init() {
      const cols = 45, rows = 30;
      const grid = new Uint8Array(cols * rows);
      for (let i = 0; i < grid.length; i++) grid[i] = Math.random() > 0.62 ? 1 : 0;
      return { grid, cols, rows };
    },
    draw(ctx, f, s) {
      const { cols, rows } = s;
      if (f % 4 === 0) {
        const g = s.grid, next = new Uint8Array(cols * rows);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            let n = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                n += g[((y + dy + rows) % rows) * cols + (x + dx + cols) % cols];
              }
            const i = y * cols + x;
            next[i] = g[i] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
          }
        }
        s.grid = next;
        // Re-seed if population dies out
        let alive = 0;
        for (let i = 0; i < next.length; i++) alive += next[i];
        if (alive < 20) for (let i = 0; i < next.length; i++) next[i] = Math.random() > 0.62 ? 1 : 0;
      }
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#44aa99';
      const cw = W / cols, ch = H / rows;
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++)
          if (s.grid[y * cols + x]) ctx.fillRect(x * cw, y * ch, cw - 1, ch - 1);
    }
  },

  'gradient-map': {
    draw(ctx, f) {
      const palettes = [
        ['#1a0533','#6b1d7a','#d94f30','#f2b630','#fffbe6'],
        ['#0d1b2a','#1b3a5c','#3d8b8f','#a3d9a5','#f0f4c3'],
        ['#2d0a1e','#8c1c5a','#d44d5c','#f4a259','#f6e8b1'],
      ];
      const pi = (f / 240 | 0) % palettes.length;
      const pal = palettes[pi].map(hexRgb);
      const s = 4, t = f * 0.02;
      for (let y = 0; y < H; y += s) {
        for (let x = 0; x < W; x += s) {
          const lum = (Math.sin(x * 0.04 + t) * Math.cos(y * 0.05 - t * 0.7) + 1) / 2;
          const pos = lum * (pal.length - 1);
          const i = Math.min(pos | 0, pal.length - 2);
          const frac = pos - i;
          const c1 = pal[i], c2 = pal[i + 1];
          ctx.fillStyle = `rgb(${c1[0] + (c2[0] - c1[0]) * frac | 0},${c1[1] + (c2[1] - c1[1]) * frac | 0},${c1[2] + (c2[2] - c1[2]) * frac | 0})`;
          ctx.fillRect(x, y, s, s);
        }
      }
    }
  },


  text: {
    init() {
      const cols = 22, rows = 10;
      const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*';
      const chars = Array.from({ length: cols * rows }, () => ({
        c: charset[Math.random() * charset.length | 0],
        age: Math.random() * 80 | 0
      }));
      return { chars, cols, rows, charset };
    },
    draw(ctx, f, s) {
      ctx.fillStyle = 'rgba(10, 10, 10, 0.3)';
      ctx.fillRect(0, 0, W, H);
      const { chars, cols, rows, charset } = s;
      const cw = W / cols, ch = H / rows;
      ctx.font = `${ch * 0.85 | 0}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const c = chars[i];
          c.age++;
          if (c.age > 40 + Math.random() * 80) {
            c.c = charset[Math.random() * charset.length | 0];
            c.age = 0;
          }
          const a = Math.max(0.08, 1 - c.age / 70);
          ctx.fillStyle = `rgba(160, 200, 120, ${a})`;
          ctx.fillText(c.c, x * cw + cw / 2, y * ch + ch / 2);
        }
      }
    }
  },

  'pixel-flow': {
    init() {
      const particles = Array.from({ length: 350 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: 0, vy: 0, life: Math.random() * 100
      }));
      return { particles };
    },
    draw(ctx, f, s) {
      ctx.fillStyle = 'rgba(10, 10, 10, 0.12)';
      ctx.fillRect(0, 0, W, H);
      const t = f * 0.008;
      for (const p of s.particles) {
        const angle = Math.sin(p.x * 0.025 + t) * Math.cos(p.y * 0.025 + t * 0.6) * Math.PI * 2;
        p.vx = p.vx * 0.92 + Math.cos(angle) * 0.4;
        p.vy = p.vy * 0.92 + Math.sin(angle) * 0.4;
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        if (p.x < 0) p.x += W; if (p.x >= W) p.x -= W;
        if (p.y < 0) p.y += H; if (p.y >= H) p.y -= H;
        const g = 120 + Math.sin(p.life * 0.04) * 60 | 0;
        ctx.fillStyle = `rgb(230,${g},70)`;
        ctx.fillRect(p.x | 0, p.y | 0, 2, 2);
      }
    }
  },

  pixelator: {
    draw(ctx, f) {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, W, H);
      const s = 12, t = f * 0.015;
      for (let y = 0; y < H; y += s) {
        for (let x = 0; x < W; x += s) {
          const r = (Math.sin(x * 0.03 + t * 1.1) + 1) / 2 * 180 + 40 | 0;
          const g = (Math.sin(y * 0.04 + t * 1.4) + 1) / 2 * 180 + 40 | 0;
          const b = (Math.sin((x + y) * 0.02 + t * 0.8) + 1) / 2 * 180 + 40 | 0;
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.beginPath();
          ctx.arc(x + s / 2, y + s / 2, s / 2 - 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  },

  srt2video: {
    init() {
      return {
        phrases: ['once upon a time', 'in a browser window', 'pixels came alive', 'frame by frame', 'the story unfolds'],
        current: 0, timer: 0
      };
    },
    draw(ctx, f, s) {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, W, H);
      s.timer++;
      if (s.timer > 100) { s.timer = 0; s.current = (s.current + 1) % s.phrases.length; }
      const a = s.timer < 15 ? s.timer / 15 : s.timer > 80 ? (100 - s.timer) / 20 : 1;
      ctx.fillStyle = `rgba(224, 224, 224, ${a})`;
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.phrases[s.current], W / 2, H / 2);
      // Timecode
      ctx.fillStyle = `rgba(136, 136, 136, ${a * 0.6})`;
      ctx.font = '9px monospace';
      const sec = (s.current * 4 + s.timer / 25) | 0;
      ctx.fillText(`00:00:${String(sec).padStart(2, '0')},000`, W / 2, H / 2 + 20);
    }
  },

  video2midi: {
    draw(ctx, f) {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, W, H);
      const bars = 16, bw = W / bars, t = f * 0.04;
      for (let i = 0; i < bars; i++) {
        const h = (Math.sin(i * 0.7 + t) * Math.cos(i * 0.3 - t * 0.5) + 1) / 2 * H * 0.75 + H * 0.05;
        const b = 70 + (Math.sin(i * 0.4 + t * 1.1) + 1) / 2 * 150 | 0;
        ctx.fillStyle = `rgb(${b * 0.25 | 0},${b * 0.6 | 0},${b})`;
        ctx.fillRect(i * bw + 1, H - h, bw - 2, h);
      }
    }
  },

  flipdigits: {
    init() {
      const cols = 30, rows = 20, len = cols * rows;
      const current = new Float32Array(len);
      const target = new Uint8Array(len);
      for (let i = 0; i < len; i++) target[i] = Math.random() > 0.55 ? 1 : 0;
      return { current, target, cols, rows, timer: 0 };
    },
    draw(ctx, f, s) {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, W, H);
      s.timer++;
      if (s.timer > 70) {
        s.timer = 0;
        for (let i = 0; i < s.target.length; i++) s.target[i] = Math.random() > 0.5 ? 1 : 0;
      }
      const { current, target, cols, rows } = s;
      const dw = W / cols, dh = H / rows;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          current[i] += (target[i] - current[i]) * 0.08;
          const v = current[i];
          const b = 30 + v * 190 | 0;
          ctx.fillStyle = `rgb(${b},${b * 0.65 | 0},${b * 0.12 | 0})`;
          ctx.beginPath();
          ctx.arc(x * dw + dw / 2, y * dh + dh / 2, dw * 0.33, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  },

  'blob-tracker': {
    init() {
      const blobs = Array.from({ length: 5 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5,
        r: 8 + Math.random() * 12, id: (Math.random() * 9 | 0) + 1
      }));
      return { blobs };
    },
    draw(ctx, f, s) {
      ctx.fillStyle = 'rgba(10, 10, 10, 0.35)';
      ctx.fillRect(0, 0, W, H);
      const colors = ['#ff6b6b','#51cf66','#339af0','#fcc419','#cc5de8','#20c997','#ff922b','#a9e34b','#748ffc','#f06595'];
      for (const b of s.blobs) {
        b.x += b.vx; b.y += b.vy;
        if (b.x < b.r || b.x > W - b.r) b.vx *= -1;
        if (b.y < b.r || b.y > H - b.r) b.vy *= -1;
        const c = colors[(b.id - 1) % colors.length];
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = c + '44';
        ctx.fill();
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
        ctx.fillStyle = c;
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(b.id, b.x, b.y - b.r - 3);
      }
    }
  },




  mesher: {
    init() {
      // 4 corner points for a warped quad
      return {
        corners: [
          { x: 20, y: 15, bx: 0.3, by: 0.2 },
          { x: W - 20, y: 20, bx: -0.2, by: 0.3 },
          { x: W - 25, y: H - 15, bx: -0.3, by: -0.2 },
          { x: 25, y: H - 20, bx: 0.2, by: -0.3 },
        ],
      };
    },
    draw(ctx, f, s) {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, W, H);
      const t = f * 0.02;
      const c = s.corners;
      // Animate corners gently
      const pts = c.map((p, i) => ({
        x: p.x + Math.sin(t + i * 1.5) * 8,
        y: p.y + Math.cos(t * 0.8 + i * 2) * 6,
      }));
      // Draw gradient-filled warped grid
      const gridN = 8;
      for (let gy = 0; gy < gridN; gy++) {
        for (let gx = 0; gx < gridN; gx++) {
          const u0 = gx / gridN, u1 = (gx + 1) / gridN;
          const v0 = gy / gridN, v1 = (gy + 1) / gridN;
          const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
          const bilerp = (u, v) => {
            const top = lerp(pts[0], pts[1], u);
            const bot = lerp(pts[3], pts[2], u);
            return lerp(top, bot, v);
          };
          const p00 = bilerp(u0, v0), p10 = bilerp(u1, v0);
          const p01 = bilerp(u0, v1), p11 = bilerp(u1, v1);
          const lum = (u0 + v0) / 2;
          const r = 60 + lum * 140 | 0, g = 100 + lum * 80 | 0, b = 180 - lum * 80 | 0;
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.beginPath();
          ctx.moveTo(p00.x, p00.y);
          ctx.lineTo(p10.x, p10.y);
          ctx.lineTo(p11.x, p11.y);
          ctx.lineTo(p01.x, p01.y);
          ctx.closePath();
          ctx.fill();
        }
      }
      // Draw grid lines
      ctx.strokeStyle = 'rgba(0,255,150,0.35)';
      ctx.lineWidth = 0.5;
      const lerp2 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const bilerp2 = (u, v) => lerp2(lerp2(pts[0], pts[1], u), lerp2(pts[3], pts[2], u), v);
      for (let i = 0; i <= gridN; i++) {
        ctx.beginPath();
        for (let j = 0; j <= gridN; j++) { const p = bilerp2(j / gridN, i / gridN); j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
        ctx.stroke();
        ctx.beginPath();
        for (let j = 0; j <= gridN; j++) { const p = bilerp2(i / gridN, j / gridN); j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
        ctx.stroke();
      }
      // Corner dots
      ctx.fillStyle = '#00ff96';
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
    }
  },


};

export function initPreviews() {
  const cards = [];
  document.querySelectorAll('canvas[data-preview]').forEach(canvas => {
    const key = canvas.dataset.preview;
    const effect = effects[key];
    if (!effect) return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const state = effect.init ? effect.init() : {};
    cards.push({ ctx, effect, state });
  });

  let frame = 0;
  function loop() {
    if (document.visibilityState !== 'hidden') {
      frame++;
      if (frame % 2 === 0) {
        const f = frame / 2;
        for (const c of cards) c.effect.draw(c.ctx, f, c.state);
      }
    }
    requestAnimationFrame(loop);
  }
  loop();
}
