import { useCallback, useEffect, useRef, useState } from 'react';
import { TRACK, LANES, SAFE, SEAT_START, COLORS, COLOR_HEX, COLOR_DARK, tokenXY, walkStep } from './geometry';

const YARDS = [[0, 0], [0, 9], [9, 9], [9, 0]]; // [row, col]
const STACK = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];

function Star({ x, y, fill }) {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 0.31 : 0.13;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(x + r * Math.cos(a)).toFixed(3)},${(y + r * Math.sin(a)).toFixed(3)}`);
  }
  return <polygon points={pts.join(' ')} fill={fill} />;
}

// pawn drawn around (0,0); `s` scales it
function Pawn({ color, s = 1, glow }) {
  return (
    <g transform={`scale(${s})`}>
      {glow && <ellipse cx="0" cy="0.3" rx="0.42" ry="0.2" fill="#fff" opacity="0.45" />}
      <ellipse cx="0" cy="0.34" rx="0.31" ry="0.12" fill="rgba(0,0,0,.35)" />
      <path d="M-0.3 0.32 C-0.28 0.12 -0.12 0.02 -0.1 -0.1 L0.1 -0.1 C0.12 0.02 0.28 0.12 0.3 0.32 Z" fill={color} stroke="rgba(0,0,0,.35)" strokeWidth="0.03" />
      <circle cx="0" cy="-0.2" r="0.17" fill={color} stroke="rgba(0,0,0,.35)" strokeWidth="0.03" />
      <path d="M-0.18 0.26 C-0.17 0.12 -0.08 0.06 -0.06 -0.02" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.06" fill="none" strokeLinecap="round" />
      <circle cx="-0.06" cy="-0.26" r="0.05" fill="#fff" opacity="0.7" />
    </g>
  );
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Shows tokens walking one square at a time towards the positions the server sent
 * (a 3 walks 3 squares, it never jumps). A captured token returns to its yard only after the
 * capturing token has landed.
 */
function useWalkingTokens(tokens, onStep, onCapture) {
  const [shown, setShown] = useState(tokens);
  const cur = useRef(tokens);
  const target = useRef(tokens);
  const timer = useRef(null);
  const cb = useRef({ onStep, onCapture });
  cb.current = { onStep, onCapture };

  const tick = useCallback(() => {
    timer.current = null;
    const { next, kind, remain } = walkStep(cur.current, target.current);
    if (!kind || same(next, cur.current)) return;
    cur.current = next;
    setShown(next);
    if (kind === 'forward') cb.current.onStep?.();
    else cb.current.onCapture?.();
    if (!same(next, target.current)) timer.current = setTimeout(tick, kind === 'forward' ? (remain > 10 ? 45 : 200) : 250);
  }, []);

  useEffect(() => {
    target.current = tokens;
    if (!timer.current && !same(cur.current, tokens)) tick();
    return undefined;
  }, [tokens, tick]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [shown, same(shown, tokens)];
}

/**
 * props: seats (active seat numbers), tokens (per seat [4 positions] | null), legal (token indexes I may move),
 *        turnSeat, mySeat, onToken(tokenIdx)
 */
export default function LudoBoard({ seats, tokens: targetTokens, legal = [], turnSeat, mySeat, onToken, onStep, onCapture }) {
  const [tokens, settled] = useWalkingTokens(targetTokens, onStep, onCapture);
  // group tokens that share a square so they are drawn side by side
  const groups = {};
  const placed = [];
  seats.forEach((seat) => {
    (tokens[seat] || []).forEach((pos, idx) => {
      const [x, y] = tokenXY(seat, pos, idx);
      const key = pos === -1 ? `y${seat}${idx}` : `${x.toFixed(2)}:${y.toFixed(2)}`;
      (groups[key] = groups[key] || []).push(placed.length);
      placed.push({ seat, idx, pos, x, y, key });
    });
  });
  placed.forEach((t, i) => {
    const g = groups[t.key];
    t.n = g.length;
    t.k = g.indexOf(i);
  });

  return (
    <svg viewBox="0 0 15 15" className="lu-board" role="img" aria-label="Ludo board">
      <rect x="0" y="0" width="15" height="15" rx="0.4" fill="#01374c" />
      {YARDS.map(([r, c], seat) => {
        const on = seats.includes(seat);
        const col = COLORS[seat];
        return (
          <g key={seat} opacity={on ? 1 : 0.4}>
            <rect x={c + 0.05} y={r + 0.05} width="5.9" height="5.9" rx="0.55" fill={COLOR_HEX[col]} />
            <rect x={c + 0.95} y={r + 0.95} width="4.1" height="4.1" rx="0.5" fill={COLOR_DARK[col]} />
          </g>
        );
      })}

      {/* track squares (white; start squares take the seat colour; stars on safe squares) */}
      {TRACK.map(([r, c], i) => {
        const startSeat = SEAT_START.indexOf(i);
        const ownerSeat = SAFE.has(i) && startSeat < 0 ? SEAT_START.indexOf((i - 8 + 52) % 52) : -1;
        return (
          <g key={`t${i}`}>
            <rect x={c + 0.04} y={r + 0.04} width="0.92" height="0.92" rx="0.1" fill={startSeat >= 0 ? COLOR_HEX[COLORS[startSeat]] : '#f5f4f3'} stroke="rgba(0,0,0,.18)" strokeWidth="0.03" />
            {startSeat >= 0 && <Star x={c + 0.5} y={r + 0.5} fill="#fff" />}
            {ownerSeat >= 0 && <Star x={c + 0.5} y={r + 0.5} fill={COLOR_HEX[COLORS[ownerSeat]]} />}
          </g>
        );
      })}
      {/* finishing lanes */}
      {LANES.map((lane, seat) =>
        lane.map(([r, c], i) => <rect key={`l${seat}${i}`} x={c + 0.04} y={r + 0.04} width="0.92" height="0.92" rx="0.1" fill={COLOR_HEX[COLORS[seat]]} stroke="rgba(0,0,0,.18)" strokeWidth="0.03" opacity={seats.includes(seat) ? 1 : 0.4} />)
      )}
      {/* centre */}
      <polygon points="6,6 9,6 7.5,7.5" fill={COLOR_HEX.red} />
      <polygon points="9,6 9,9 7.5,7.5" fill={COLOR_HEX.blue} />
      <polygon points="6,9 9,9 7.5,7.5" fill={COLOR_HEX.yellow} />
      <polygon points="6,6 6,9 7.5,7.5" fill={COLOR_HEX.green} />

      {/* pawns */}
      {placed.map((t) => {
        const col = COLOR_HEX[COLORS[t.seat]];
        const [ox, oy] = t.n > 1 ? STACK[t.k % 4] : [0, 0];
        const s = t.n > 1 ? 0.78 : t.pos === -1 ? 1.25 : 1.05;
        const movable = settled && t.seat === mySeat && turnSeat === mySeat && legal.includes(t.idx);
        return (
          <g
            key={`${t.seat}-${t.idx}`}
            className="lu-token"
            style={{ transform: `translate(${t.x + ox}px, ${t.y + oy}px)`, cursor: movable ? 'pointer' : 'default' }}
            onClick={movable ? () => onToken(t.idx) : undefined}
          >
            {movable && <circle r="0.62" className="lu-pulse" fill="none" stroke="#fff" strokeWidth="0.08" />}
            <Pawn color={col} s={s} glow={movable} />
            {movable && <circle r="0.7" fill="transparent" />}
          </g>
        );
      })}
    </svg>
  );
}
