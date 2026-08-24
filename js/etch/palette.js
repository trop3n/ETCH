// Color + palette system shared by Etch tools: hex interpolation, solid/
// sequence/transition picking, a curated palette library with random/shuffle,
// seed-shuffled transition layers, and a Tweakpane (v4) swatch + random UI.
// Dependency-free: callers pass their own RNG (e.g. alea(seed)) for determinism.

export function interpolateHex(a, b, t) {
  const r1 = parseInt(a.slice(1, 3), 16), g1 = parseInt(a.slice(3, 5), 16), b1 = parseInt(a.slice(5, 7), 16);
  const r2 = parseInt(b.slice(1, 3), 16), g2 = parseInt(b.slice(3, 5), 16), b2 = parseInt(b.slice(5, 7), 16);
  const h = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(r1 + (r2 - r1) * t)}${h(g1 + (g2 - g1) * t)}${h(b1 + (b2 - b1) * t)}`;
}

export function pickColor(colors, mode, i, n) {
  if (!colors.length) return '#ffffff';
  if (mode === 'solid' || colors.length === 1) return colors[0];
  const t = n > 1 ? i / (n - 1) : 0;
  if (mode === 'sequence') return colors[Math.min(Math.floor(t * colors.length), colors.length - 1)];
  const tt = t * (colors.length - 1);
  const k = Math.min(Math.floor(tt), colors.length - 2);
  return interpolateHex(colors[k], colors[Math.min(k + 1, colors.length - 1)], tt - k);
}

// Curated palettes. Light→dark / by hue;
// randomPalette() may reverse them.
export const PALETTES = [
  ['#0a2a6b', '#2f6fed', '#43d9ff', '#bff3ff', '#ffffff'],
  ['#0b1d2a', '#15616d', '#78c6a3', '#dceb9b', '#fff3b0'],
  ['#1a0b2e', '#7b2cbf', '#c77dff', '#ffd6ff', '#ffffff'],
  ['#2b0a0a', '#c0341d', '#ff7a18', '#ffd166', '#fff3d6'],
  ['#04110f', '#0f7a5a', '#3fe0a6', '#bff7e3', '#ffffff'],
  ['#000000', '#3a3a3a', '#808080', '#c8c8c8', '#ffffff'],
  ['#1d1a2f', '#3d3a6b', '#6f6bb5', '#b6b4e6', '#f0eff9'],
  ['#2a1a0f', '#7a4a2a', '#c98a5a', '#e8c39e', '#fff0dc'],
  ['#0c1b1e', '#1f4e5f', '#2e8b9e', '#7fd1d9', '#e8fbff'],
  ['#1a1a1a', '#d62828', '#f77f00', '#fcbf49', '#eae2b7'],
  ['#10002b', '#3c096c', '#9d4edd', '#e0aaff', '#ffffff'],
  ['#0d1b0d', '#2d6a2d', '#73c073', '#bff0b0', '#fbffe8'],
  ['#1b1b2f', '#162447', '#1f4068', '#e43f5a', '#f5f5f5'],
  ['#22223b', '#4a4e69', '#9a8c98', '#c9ada7', '#f2e9e4'],
  ['#03071e', '#9d0208', '#dc2f02', '#f48c06', '#ffba08'],
  ['#001219', '#005f73', '#0a9396', '#94d2bd', '#e9d8a6'],
  ['#0b132b', '#1c2541', '#3a506b', '#5bc0be', '#ffffff'],
  ['#2d00f7', '#6a00f4', '#b100e8', '#e500a4', '#ff8500'],
  ['#f8f9fa', '#adb5bd', '#6c757d', '#343a40', '#212529'],
  ['#012a4a', '#2a6f97', '#61a5c2', '#a9d6e5', '#ffffff'],
  ['#241623', '#3b1f2b', '#9e4770', '#d295bf', '#f2cee6'],
  ['#fffcf2', '#ccc5b9', '#8a817c', '#463f3a', '#252422'],
  ['#073b4c', '#118ab2', '#06d6a0', '#ffd166', '#ef476f'],
  ['#0d0221', '#190b46', '#3b0f70', '#f7008e', '#00e5ff'],
];

export function randomPalette(rng = Math.random) {
  const p = PALETTES[Math.floor(rng() * PALETTES.length)];
  return rng() < 0.5 ? [...p] : [...p].reverse();
}

function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

// Cycle `colors` to `layers` entries, then shuffle with the given RNG.
export function buildLayers(colors, layers, rng = Math.random) {
  const active = colors.length ? colors : ['#000000'];
  const out = [];
  for (let i = 0; i < layers; i++) out.push(active[i % active.length]);
  return shuffleInPlace(out, rng);
}

// Evenly-spaced transition stops: [[hex, 0..1], ...].
export function toTransitionStops(colors) {
  const n = colors.length;
  return colors.map((c, i) => [c, n > 1 ? i / (n - 1) : 0]);
}

// Sample an ascending [[hex, pos], ...] gradient at t.
export function paletteLerp(stops, t) {
  if (!stops.length) return '#000000';
  if (stops.length === 1) return stops[0][0];
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  for (let i = 0; i < stops.length - 1; i++) {
    const [c0, s0] = stops[i], [c1, s1] = stops[i + 1];
    if (t >= s0 && t <= s1) return interpolateHex(c0, c1, (t - s0) / Math.max(1e-6, s1 - s0));
  }
  return stops[stops.length - 1][0];
}

// Tweakpane (v4) palette UI: a color input per slot + Random Palette / Shuffle.
// `palette` is { array: hex[] }; the array length is preserved so bindings stay
// valid (random fills are cycled to fit). Calls onChange() after any edit.
export function attachPaletteControls(folder, { palette, pane, onChange }) {
  const fire = () => onChange && onChange();
  palette.array.forEach((_, i) => {
    folder.addBinding(palette.array, i, { label: i === 0 ? 'palette' : '', view: 'color' }).on('change', fire);
  });
  folder.addButton({ title: 'Random Palette' }).on('click', () => {
    const np = randomPalette();
    for (let i = 0; i < palette.array.length; i++) palette.array[i] = np[i % np.length];
    pane && pane.refresh(); fire();
  });
  folder.addButton({ title: 'Shuffle Colors' }).on('click', () => {
    shuffleInPlace(palette.array);
    pane && pane.refresh(); fire();
  });
}
