// Vector shape factory for Etch tools. Returns a Paper.js Item centered at the
// origin at the given size (Paper constructors auto-insert into the active layer).
export const SHAPE_OPTIONS = { Circle: 'circle', Square: 'square', Triangle: 'triangle', Diamond: 'diamond', Star: 'star', Cross: 'cross', Ring: 'ring', Hexagon: 'hexagon' };

export function makeShape(type, size) {
  const P = window.paper, r = size / 2;
  switch (type) {
    case 'square': return new P.Path.Rectangle({ point: [-r, -r], size: [size, size] });
    case 'triangle': { const p = new P.Path([[0, -r], [-r * 0.866, r * 0.5], [r * 0.866, r * 0.5]]); p.closed = true; return p; }
    case 'diamond': { const p = new P.Path([[0, -r], [r, 0], [0, r], [-r, 0]]); p.closed = true; return p; }
    case 'star': return new P.Path.Star({ center: [0, 0], points: 5, radius1: r, radius2: r * 0.5 });
    case 'cross': { const t = size * 0.32; return new P.Group([new P.Path.Rectangle({ point: [-t / 2, -r], size: [t, size] }), new P.Path.Rectangle({ point: [-r, -t / 2], size: [size, t] })]); }
    case 'ring': return new P.CompoundPath({ children: [new P.Path.Circle([0, 0], r), new P.Path.Circle([0, 0], r * 0.55)] });
    case 'hexagon': return new P.Path.RegularPolygon({ center: [0, 0], sides: 6, radius: r });
    default: return new P.Path.Circle([0, 0], r);
  }
}
