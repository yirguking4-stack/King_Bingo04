// Board geometry. MUST match backend/src/ludo/ludoEngine.js:
//   52 shared track squares, seat start squares [0,13,26,39], token pos -1 = yard, 0..50 track,
//   51..55 private lane, 56 = centre. Seats clockwise: 0 green (top-left), 1 red (top-right),
//   2 blue (bottom-right), 3 yellow (bottom-left).
export const SEAT_START = [0, 13, 26, 39];
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const COLORS = ['green', 'red', 'blue', 'yellow'];
export const COLOR_HEX = { green: '#14c943', red: '#f01c1f', blue: '#1488f6', yellow: '#fcd20f' };
export const COLOR_DARK = { green: '#0b8a22', red: '#b80d10', blue: '#0a56c4', yellow: '#c99f07' };
export const COLOR_PILL = { green: '#04420a', red: '#5c0606', blue: '#052a66', yellow: '#5a4506' };
export const COLOR_NAME_AM = { green: 'አረንጓዴ', red: 'ቀይ', blue: 'ሰማያዊ', yellow: 'ቢጫ' };

// [row, col] of the 52 track squares, clockwise, starting at green's start square.
function buildTrack() {
  const t = [];
  const add = (r, c) => t.push([r, c]);
  for (let c = 1; c <= 5; c += 1) add(6, c); // 0-4
  for (let r = 5; r >= 0; r -= 1) add(r, 6); // 5-10
  add(0, 7); add(0, 8); // 11-12
  for (let r = 1; r <= 5; r += 1) add(r, 8); // 13-17  (red start = 13)
  for (let c = 9; c <= 14; c += 1) add(6, c); // 18-23
  add(7, 14); add(8, 14); // 24-25
  for (let c = 13; c >= 9; c -= 1) add(8, c); // 26-30 (blue start = 26)
  for (let r = 9; r <= 14; r += 1) add(r, 8); // 31-36
  add(14, 7); add(14, 6); // 37-38
  for (let r = 13; r >= 9; r -= 1) add(r, 6); // 39-43 (yellow start = 39)
  for (let c = 5; c >= 0; c -= 1) add(8, c); // 44-49
  add(7, 0); add(6, 0); // 50-51
  return t;
}
export const TRACK = buildTrack();

export const LANES = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
];

const YARD_BASE = [[0, 0], [0, 9], [9, 9], [9, 0]]; // [row, col] of each 6x6 yard
const YARD_SLOTS = [[1.5, 1.5], [1.5, 4.5], [4.5, 1.5], [4.5, 4.5]]; // [dy, dx] inside the yard
const CENTRE_OFFSET = [[-0.85, 0], [0, -0.85], [0.85, 0], [0, 0.85]]; // [dx, dy] per seat

/** Centre point (in 15x15 board units) of a token. */
export function tokenXY(seat, pos, tokenIdx) {
  if (pos === -1) {
    const [br, bc] = YARD_BASE[seat];
    const [dy, dx] = YARD_SLOTS[tokenIdx];
    return [bc + dx, br + dy];
  }
  if (pos <= 50) {
    const [r, c] = TRACK[(SEAT_START[seat] + pos) % 52];
    return [c + 0.5, r + 0.5];
  }
  if (pos <= 55) {
    const [r, c] = LANES[seat][pos - 51];
    return [c + 0.5, r + 0.5];
  }
  const [ox, oy] = CENTRE_OFFSET[seat];
  const spread = (tokenIdx - 1.5) * 0.18;
  return [7.5 + ox + (ox === 0 ? spread : 0), 7.5 + oy + (oy === 0 ? spread : 0)];
}

/**
 * One animation step of the walking tokens. `cur` = what is drawn now, `target` = what the server says.
 * Forward movers advance exactly one square per step (never jump); captured tokens go back to the
 * yard only after every forward mover has landed.
 * returns { next, kind: 'forward' | 'capture' | null, remain }
 */
export function walkStep(cur, target) {
  let forward = false;
  let remain = 0;
  const fwd = target.map((tArr, s) => {
    if (!tArr || !cur[s]) return tArr;
    return cur[s].map((p, i) => {
      if (p < tArr[i]) { forward = true; remain = Math.max(remain, tArr[i] - p); return p + 1; }
      return p;
    });
  });
  if (forward) return { next: fwd, kind: 'forward', remain };
  let captured = false;
  const back = target.map((tArr, s) => {
    if (!tArr || !cur[s]) return tArr;
    return cur[s].map((p, i) => { if (p > tArr[i]) { captured = true; return tArr[i]; } return p; });
  });
  return { next: back, kind: captured ? 'capture' : null, remain: 0 };
}
