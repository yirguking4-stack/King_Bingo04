import { useEffect, useRef } from 'react';

const COLORS = ['#ffd23f', '#ee4266', '#3bceac', '#0ead69', '#4cc9f0', '#f72585', '#ffffff', '#ff9f1c'];

/** `getOrigin` (returns {x, y} in screen pixels) = a round burst from that point, e.g. the middle of the board.
 *  Without it: party-popper confetti: two bursts shot from the bottom corners, then paper keeps falling for a few seconds. */
export default function Confetti({ seconds = 6, getOrigin = null }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    const W = () => canvas.width;
    const H = () => canvas.height;
    const parts = [];
    const burst = (x, dir, n) => {
      for (let i = 0; i < n; i += 1) {
        const a = (-Math.PI / 2) + dir * (0.15 + Math.random() * 0.55);
        const v = (9 + Math.random() * 10) * dpr;
        parts.push({ x, y: H(), vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: (6 + Math.random() * 6) * dpr, h: (10 + Math.random() * 8) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: COLORS[(Math.random() * COLORS.length) | 0], life: 0 });
      }
    };
    const rain = (n) => {
      for (let i = 0; i < n; i += 1) {
        parts.push({ x: Math.random() * W(), y: -20 * dpr, vx: (Math.random() - 0.5) * 2 * dpr, vy: (2 + Math.random() * 3) * dpr, w: (6 + Math.random() * 5) * dpr, h: (9 + Math.random() * 7) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: COLORS[(Math.random() * COLORS.length) | 0], life: 0 });
      }
    };
    const centreBurst = (n) => {
      const o = getOrigin();
      for (let i = 0; i < n; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const v = (4 + Math.random() * 11) * dpr;
        parts.push({ x: o.x * dpr, y: o.y * dpr, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3 * dpr, w: (6 + Math.random() * 6) * dpr, h: (10 + Math.random() * 8) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: COLORS[(Math.random() * COLORS.length) | 0], life: 0 });
      }
    };
    if (getOrigin) centreBurst(150);
    else {
      burst(0, 1, 90);
      burst(W(), -1, 90);
    }
    const start = performance.now();
    let last = 0;
    let raf;
    const frame = (now) => {
      const t = (now - start) / 1000;
      if (!getOrigin && t < seconds - 2 && now - last > 130) { rain(6); last = now; }
      if (!getOrigin && t > 0.45 && t < 0.5) { burst(0, 1, 40); burst(W(), -1, 40); }
      if (getOrigin && t > 0.35 && t < 0.4 && !parts.second) { parts.second = true; centreBurst(70); }
      g.clearRect(0, 0, W(), H());
      for (const p of parts) {
        p.vy += 0.32 * dpr; // gravity
        p.vx *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.r);
        g.scale(1, Math.cos(p.r * 1.7)); // paper flipping
        g.fillStyle = p.c;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
      }
      for (let i = parts.length - 1; i >= 0; i -= 1) if (parts[i].y > H() + 40 * dpr) parts.splice(i, 1);
      if (t < seconds || parts.length) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [seconds]);
  return <canvas ref={ref} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 40 }} />;
}
