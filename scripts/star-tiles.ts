/**
 * Star tiles for the deep-space backdrop (app/globals.css, .backdrop).
 *   npx tsx scripts/star-tiles.ts
 * Prints the --stars-* custom properties: SVG data URIs, one path per class of
 * star, each star a near-zero-length subpath with round caps. Seeded, so a
 * re-run reproduces the CSS byte for byte; change a seed or a count to reshape
 * a layer, then paste the output over the old lines.
 */

type Tint = readonly [color: string, share: number];
type Size = readonly [readonly [diameter: number, opacity: number], share: number];

interface TileSpec {
  w: number;
  h: number;
  count: number;
  seed: number;
  /** Minimum distance between two stars, in px. */
  minGap: number;
  sizes: readonly Size[];
  /** A faint wide stroke under every star, read as a glow. */
  halo?: { w: number; o: number };
}

// Mostly white, some blue-white, a few warm and the odd red giant.
const TINTS: readonly Tint[] = [
  ['#fff', 0.62],
  ['#d6e2ff', 0.2],
  ['#ffe9d2', 0.13],
  ['#ffc2c2', 0.05],
];

// mulberry32: a small seeded generator, so the tiles are stable between runs.
function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(list: readonly (readonly [T, number])[], r: () => number): T {
  let x = r();
  for (const [v, p] of list) if ((x -= p) <= 0) return v;
  return list[0][0];
}

function tile(spec: TileSpec): { uri: string; stars: number } {
  const r = rng(spec.seed);
  const stars: { x: number; y: number; d: number; o: number; c: string }[] = [];
  for (let guard = 0; stars.length < spec.count && guard < spec.count * 200; guard++) {
    const [d, o] = pick(spec.sizes, r);
    // Keep every star (and its halo) inside the tile, so none is cut at a seam.
    const m = Math.ceil(d / 2 + (spec.halo ? spec.halo.w / 2 : 0) + 1);
    const x = Math.round(m + r() * (spec.w - 2 * m));
    const y = Math.round(m + r() * (spec.h - 2 * m));
    if (stars.some((s) => Math.hypot(s.x - x, s.y - y) < spec.minGap)) continue;
    stars.push({ x, y, d, o, c: pick(TINTS, r) });
  }
  const dot = (s: { x: number; y: number }) => `M${s.x} ${s.y}h.01`;
  const groups = new Map<string, string[]>();
  for (const s of stars) {
    const key = `${s.d}|${s.o}|${s.c}`;
    groups.set(key, [...(groups.get(key) ?? []), dot(s)]);
  }
  let body = spec.halo ? `<path stroke='%23fff' stroke-opacity='${spec.halo.o}' stroke-width='${spec.halo.w}' d='${stars.map(dot).join('')}'/>` : '';
  for (const [key, d] of groups) {
    const [dia, op, c] = key.split('|');
    body += `<path stroke='${c.replace('#', '%23')}' stroke-opacity='${op}' stroke-width='${dia}' d='${d.join('')}'/>`;
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${spec.w}' height='${spec.h}' fill='none' stroke-linecap='round'>${body}</svg>`;
  return { uri: `url("data:image/svg+xml,${svg.replace(/</g, '%3C').replace(/>/g, '%3E')}")`, stars: stars.length };
}

// Every layer drifts: the CSS moves each one by a whole number of tiles per
// loop, so tile widths divide the layer's travel (960px far, 360px band,
// 640px mid, 960px near).
const LAYERS: Record<string, TileSpec> = {
  // Dust: two tiles of different heights, so their sum never shows a vertical lattice.
  'far-a': { w: 480, h: 600, count: 120, seed: 11, minGap: 8, sizes: [[[1, 0.42], 0.5], [[1.2, 0.58], 0.32], [[1.4, 0.75], 0.18]] },
  'far-b': { w: 320, h: 440, count: 38, seed: 23, minGap: 8, sizes: [[[1, 0.38], 0.55], [[1.2, 0.52], 0.3], [[1.5, 0.7], 0.15]] },
  // Dense dust for the galactic band (shown through a diagonal strip).
  band: { w: 360, h: 360, count: 160, seed: 71, minGap: 5, sizes: [[[0.9, 0.4], 0.55], [[1.1, 0.55], 0.33], [[1.3, 0.7], 0.12]] },
  mid: { w: 640, h: 960, count: 52, seed: 37, minGap: 22, sizes: [[[1.4, 0.6], 0.45], [[1.7, 0.75], 0.35], [[2, 0.9], 0.2]] },
  near: { w: 960, h: 1080, count: 22, seed: 53, minGap: 60, halo: { w: 7, o: 0.07 }, sizes: [[[2, 0.8], 0.5], [[2.4, 0.9], 0.32], [[2.9, 1], 0.18]] },
};

for (const [name, spec] of Object.entries(LAYERS)) {
  console.log(`  --stars-${name}: ${tile(spec).uri};`);
}
