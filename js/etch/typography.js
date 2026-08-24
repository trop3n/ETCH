// Typography pipeline for Etch tools (SAMPL, TEXTR, RASTR).
// Loads fonts — built-in open-source Google TTFs via CDN, or a dropped TTF/OTF —
// using opentype.js (window.opentype, loaded by the host page), and converts text
// into SVG path-data strings that Paper.js can import as vector outlines.

// Pinned to a google/fonts commit so a compromised/hijacked `main` can't swap the
// bytes parsed by opentype.js. Bump deliberately and re-pin.
const GH = 'https://cdn.jsdelivr.net/gh/google/fonts@ec0464b978de222073645d6d3366f3fdf03376d8/ofl';
const FONTS = {
  'Space Mono': `${GH}/spacemono/SpaceMono-Regular.ttf`,
  'Anton': `${GH}/anton/Anton-Regular.ttf`,
  'Archivo Black': `${GH}/archivoblack/ArchivoBlack-Regular.ttf`,
  'Bungee': `${GH}/bungee/Bungee-Regular.ttf`,
  'Major Mono': `${GH}/majormonodisplay/MajorMonoDisplay-Regular.ttf`,
};
export const FONT_OPTIONS = Object.fromEntries(Object.keys(FONTS).map((k) => [k, k]));

const cache = new Map();

export function loadFont(name) {
  if (cache.has(name)) return cache.get(name);
  const p = (async () => {
    const url = FONTS[name];
    if (!url) throw new Error('Unknown font: ' + name);
    const res = await fetch(url);
    if (!res.ok) throw new Error('font fetch failed: ' + res.status);
    return window.opentype.parse(await res.arrayBuffer());
  })();
  cache.set(name, p);
  p.catch(() => cache.delete(name)); // drop the in-flight cache so a later call can retry
  return p;
}

export function parseFont(arrayBuffer) {
  return window.opentype.parse(arrayBuffer);
}

// Returns an array of SVG path-data strings — one per "unit" (letter / word /
// whole block), each generated at the given font size with baseline at y=0.
export function textUnits(font, text, fontSize, mode) {
  const t = (text && text.trim()) ? text : 'TYPE';
  let parts;
  if (mode === 'letters') parts = [...t].filter((c) => c.trim());
  else if (mode === 'words') parts = t.split(/\s+/).filter(Boolean);
  else parts = [t];
  return parts
    .map((p) => font.getPath(p, 0, 0, fontSize).toPathData(2))
    .filter((d) => d && d.length > 2);
}
