import type { CSSProperties } from 'react';

/**
 * Site-wide background, fixed behind every page: deep space in pure CSS (the
 * styles are in app/globals.css). Still nebulae under a sky that drifts as
 * one: dust, a galactic band and two star layers at different speeds, with
 * twinkling stars riding on the nearest layer and a rare meteor. There is no
 * script: it renders on the server and every animation is a transform or an
 * opacity, which the browser runs off the main thread. Reduced motion gets
 * the still sky.
 */

// The near layer drifts one period to the left per loop; its twinkling stars
// repeat every period so the loop is seamless, with enough copies to cover a
// screen 3840px wide.
const PERIOD = 960;
const COPIES = 5;

// Twinkling stars within one period: x in px, y in % of the viewport, half a
// twinkle (dim to bright) in seconds and its phase. Both are whole tenths of
// a second, so every twinkle steps on the sky's 30-a-second clock.
const GLINTS = [
  { x: 40, y: 16, d: 6.4, delay: -1.2, spikes: true },
  { x: 170, y: 63, d: 5.1, delay: -3.4 },
  { x: 300, y: 34, d: 7.6, delay: -0.6 },
  { x: 430, y: 84, d: 4.7, delay: -2.1 },
  { x: 560, y: 9, d: 5.8, delay: -4.3 },
  { x: 700, y: 48, d: 7.1, delay: -2.8, spikes: true },
  { x: 830, y: 74, d: 6.2, delay: -5.0 },
];

function glintStyle(g: (typeof GLINTS)[number], copy: number): CSSProperties {
  return {
    left: g.x + copy * PERIOD,
    top: `${g.y}%`,
    // The keyframes hold ten twinkles, twenty half-twinkles of g.d seconds each.
    animationDuration: `${(g.d * 20).toFixed(1)}s`,
    animationTimingFunction: `steps(${Math.round(g.d * 30)})`,
    // Each copy twinkles on its own phase, so the repeats never pulse together.
    animationDelay: `${(g.delay - copy * 1.7).toFixed(1)}s`,
  };
}

export function Backdrop() {
  return (
    <div aria-hidden className="backdrop">
      <div className="backdrop-stars backdrop-stars-far" />
      <div className="backdrop-band">
        <div className="backdrop-stars backdrop-stars-band" />
      </div>
      <div className="backdrop-drift">
        <div className="backdrop-stars backdrop-stars-mid" />
        <div className="backdrop-stars backdrop-stars-near">
          {Array.from({ length: COPIES }, (_, copy) =>
            GLINTS.map((g, i) => (
              <span
                key={`${copy}-${i}`}
                className={g.spikes ? 'backdrop-glint backdrop-glint-spikes' : 'backdrop-glint'}
                style={glintStyle(g, copy)}
              />
            )),
          )}
        </div>
      </div>
      <span className="backdrop-meteor backdrop-meteor-a" />
      <span className="backdrop-meteor backdrop-meteor-b" />
    </div>
  );
}
