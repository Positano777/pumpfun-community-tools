'use client';

import { useEffect, useRef } from 'react';

/**
 * Site-wide background scene, fixed behind every page:
 *  - deep vignette and three slow crimson aurora fields (CSS transforms only),
 *  - a perspective floor grid running toward the horizon,
 *  - a forensic node network on canvas: wallets as nodes, funding links as
 *    lines, with trace pulses travelling along links the way the engine walks
 *    a funding chain; the field drifts a little with the pointer,
 *  - a scanner sweep every sixteen seconds and a film-grain layer.
 * Reduced motion gets a still composition; hidden tabs stop the loop.
 */

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  phase: number;
}

interface Trace {
  a: number;
  b: number;
  t: number;
  speed: number;
}

const LINK = 150;

export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = performance.now();
    let nodes: Node[] = [];
    let traces: Trace[] = [];
    let targetX = 0;
    let targetY = 0;
    let driftX = 0;
    let driftY = 0;

    const seed = () => {
      const count = Math.max(28, Math.min(84, Math.round((w * h) / 24_000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 0.5) * 14,
        r: 0.8 + Math.random() * 1.3,
        phase: Math.random() * Math.PI * 2,
      }));
      traces = [];
    };

    const resize = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const nw = window.innerWidth;
      const nh = window.innerHeight;
      const reseed = nodes.length === 0 || Math.abs(nw - w) > 120;
      w = nw;
      h = nh;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reseed) seed();
      else for (const n of nodes) {
        n.x = Math.min(n.x, w);
        n.y = Math.min(n.y, h);
      }
      if (reduced) draw();
    };

    const step = (dt: number) => {
      for (const n of nodes) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        n.phase += dt;
        if (n.x < -20) n.x = w + 20;
        else if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20;
        else if (n.y > h + 20) n.y = -20;
      }
      const ease = Math.min(1, dt * 2);
      driftX += (targetX - driftX) * ease;
      driftY += (targetY - driftY) * ease;
      traces = traces.filter((t) => (t.t += dt * t.speed) < 1);
      if (traces.length < 3 && Math.random() < dt * 0.8) {
        const a = Math.floor(Math.random() * nodes.length);
        let best = -1;
        let bestD = LINK;
        for (let j = 0; j < nodes.length; j++) {
          if (j === a) continue;
          const d = Math.hypot(nodes[a].x - nodes[j].x, nodes[a].y - nodes[j].y);
          if (d < bestD && Math.random() < 0.6) {
            bestD = d;
            best = j;
          }
        }
        if (best >= 0) traces.push({ a, b: best, t: 0, speed: 0.55 + Math.random() * 0.5 });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(driftX, driftY);
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > LINK * LINK) continue;
          const alpha = (1 - Math.sqrt(d2) / LINK) * 0.2;
          ctx.strokeStyle = `rgba(196,43,43,${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      for (const n of nodes) {
        const glow = 0.35 + 0.25 * Math.sin(n.phase * 1.3);
        ctx.fillStyle = `rgba(196,43,43,${(glow * 0.16).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(162,15,16,${(0.35 + glow * 0.3).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const tr of traces) {
        const a = nodes[tr.a];
        const b = nodes[tr.b];
        const x = a.x + (b.x - a.x) * tr.t;
        const y = a.y + (b.y - a.y) * tr.t;
        const fade = Math.sin(tr.t * Math.PI);
        ctx.strokeStyle = `rgba(196,43,43,${(0.45 * fade).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = `rgba(196,43,43,${(0.16 * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(162,15,16,${(0.8 * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      step(dt);
      draw();
      raf = requestAnimationFrame(frame);
    };
    const onMove = (e: MouseEvent) => {
      targetX = (e.clientX / w - 0.5) * 18;
      targetY = (e.clientY / h - 0.5) * 12;
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    resize();
    window.addEventListener('resize', resize);
    if (!reduced) {
      window.addEventListener('mousemove', onMove, { passive: true });
      document.addEventListener('visibilitychange', onVisibility);
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div aria-hidden className="backdrop">
      <div className="backdrop-aurora backdrop-aurora-a" />
      <div className="backdrop-aurora backdrop-aurora-b" />
      <div className="backdrop-aurora backdrop-aurora-c" />
      <div className="backdrop-floor" />
      <canvas ref={ref} className="backdrop-net" />
      <div className="backdrop-sweep" />
      <div className="backdrop-grain" />
      <div className="backdrop-vignette" />
    </div>
  );
}
