/**
 * Site-wide background, fixed behind every page: deep space in pure CSS (the
 * styles are in app/globals.css). A still sky of nebulae and faint stars, two
 * star layers drifting at different speeds for depth, a few twinkling stars
 * and a rare meteor. There is no script: it renders on the server and every
 * animation is a transform or an opacity, which the browser runs off the main
 * thread. Reduced motion gets the still sky.
 */

// Twinkling stars: where they sit in the viewport, how long one twinkle takes, and its phase.
const GLINTS = [
  { x: '7%', y: '18%', d: '6.4s', delay: '-1.2s', spikes: true },
  { x: '21%', y: '38%', d: '5.1s', delay: '-3.4s' },
  { x: '33%', y: '11%', d: '7.6s', delay: '-0.6s' },
  { x: '58%', y: '9%', d: '4.7s', delay: '-2.1s' },
  { x: '79%', y: '14%', d: '5.8s', delay: '-4.3s' },
  { x: '93%', y: '27%', d: '7.1s', delay: '-2.8s', spikes: true },
  { x: '67%', y: '46%', d: '6.2s', delay: '-5.0s' },
  { x: '12%', y: '67%', d: '5.5s', delay: '-1.7s' },
  { x: '87%', y: '63%', d: '6.8s', delay: '-3.9s', spikes: true },
  { x: '41%', y: '83%', d: '4.9s', delay: '-0.9s' },
  { x: '72%', y: '89%', d: '7.3s', delay: '-4.8s' },
  { x: '3%', y: '91%', d: '5.9s', delay: '-2.5s' },
];

export function Backdrop() {
  return (
    <div aria-hidden className="backdrop">
      <div className="backdrop-drift">
        <div className="backdrop-stars backdrop-stars-mid" />
        <div className="backdrop-stars backdrop-stars-near" />
      </div>
      {GLINTS.map((g) => (
        <span
          key={`${g.x} ${g.y}`}
          className={g.spikes ? 'backdrop-glint backdrop-glint-spikes' : 'backdrop-glint'}
          style={{ left: g.x, top: g.y, animationDuration: g.d, animationDelay: g.delay }}
        />
      ))}
      <span className="backdrop-meteor backdrop-meteor-a" />
      <span className="backdrop-meteor backdrop-meteor-b" />
    </div>
  );
}
