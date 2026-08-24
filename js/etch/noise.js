// Seedable simplex noise (2D/3D/4D) shared across Etch tools. Wraps the
// vendored simplex-noise lib, seeded via alea so a given seed reproduces a
// pattern exactly. 4D is used by tools
// that loop motion through two extra noise dimensions (e.g. FLAKE). Same API as
// before — seedNoise/noise2D/noise3D — plus noise4D and the alea PRNG.
import { createNoise2D, createNoise3D, createNoise4D } from '../vendor/simplex/simplex-noise.js';

// Alea PRNG (Baagøe): alea(seed) → deterministic () => [0,1).
export function alea(seed) {
  let s0 = 0, s1 = 0, s2 = 0, c = 1;
  const mash = (() => {
    let n = 0xefc8249d;
    return (data) => {
      data = String(data);
      for (let i = 0; i < data.length; i++) {
        n += data.charCodeAt(i);
        let h = 0.02519603282416938 * n;
        n = h >>> 0; h -= n; h *= n; n = h >>> 0; h -= n; n += h * 0x100000000;
      }
      return (n >>> 0) * 2.3283064365386963e-10;
    };
  })();
  s0 = mash(' '); s1 = mash(' '); s2 = mash(' ');
  s0 -= mash(seed); if (s0 < 0) s0 += 1;
  s1 -= mash(seed); if (s1 < 0) s1 += 1;
  s2 -= mash(seed); if (s2 < 0) s2 += 1;
  return () => { const t = 2091639 * s0 + c * 2.3283064365386963e-10; s0 = s1; s1 = s2; return (s2 = t - (c = t | 0)); };
}

let _n2, _n3, _n4;

export function seedNoise(seed = 0) {
  const rng = alea(seed);
  _n2 = createNoise2D(rng);
  _n3 = createNoise3D(rng);
  _n4 = createNoise4D(rng);
}
seedNoise((Math.random() * 65536) | 0);

export function noise2D(x, y) { return _n2(x, y); }
export function noise3D(x, y, z) { return _n3(x, y, z); }
export function noise4D(x, y, z, w) { return _n4(x, y, z, w); }
