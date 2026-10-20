'use strict';
/**
 * KING DAMA — pure Russian Checkers (Shashki) rules engine. No DB, no sockets, no timers.
 *
 * Board: 8x8, index = row*8 + col, row 0 = top. Playable squares are dark: (row+col) is odd.
 * Sides: 0 = white ('w'/'W') starts at the bottom (rows 5-7) and moves UP (row-1).
 *        1 = black ('b'/'B') starts at the top (rows 0-2) and moves DOWN (row+1). White moves first.
 * Lower-case = man, upper-case = king.
 *
 * RULESET (documented)
 *  - Men move 1 square diagonally forward. Men capture forward AND backward.
 *  - Kings are "flying": move any distance on a diagonal; capture an enemy piece anywhere on the
 *    diagonal (only empty squares between) and land on ANY empty square beyond it.
 *  - Capture is MANDATORY (any piece, men and kings). The player may choose ANY capture sequence
 *    (no "majority" rule) unless `opts.majority` is set (admin variant, off by default).
 *  - A capture sequence must be continued with the SAME piece until no further capture exists.
 *  - Captured pieces stay on the board until the whole sequence ends ("Turkish strike") and cannot
 *    be jumped twice; they block the path.
 *  - A man that reaches the far row DURING a capture becomes a king immediately and continues
 *    capturing as a king in the same turn. A man promoted by a plain move ends the turn.
 *  - Game ends: opponent has no pieces / no legal move (loss), timeout, resignation, or a draw.
 *  - Draws implemented: (a) threefold repetition of the same position with the same side to move;
 *    (b) 15 moves by each side with only kings moving and no capture (30 plies).
 *    NOT implemented: the "3 kings vs 1 king on the main diagonal" 15-move rule.
 */

const TURN_MS = 45000;
const KING_ONLY_DRAW_PLIES = 30;
const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

const sq = (r, c) => r * 8 + c;
const rc = (i) => [Math.floor(i / 8), i % 8];
const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const isDark = (r, c) => (r + c) % 2 === 1;
const sideOf = (p) => (p === 'w' || p === 'W' ? 0 : p === 'b' || p === 'B' ? 1 : null);
const isKing = (p) => p === 'W' || p === 'B';

function initialBoard() {
  const b = Array(64).fill(null);
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      if (!isDark(r, c)) continue;
      if (r < 3) b[sq(r, c)] = 'b';
      else if (r > 4) b[sq(r, c)] = 'w';
    }
  }
  return b;
}

function createGame(now, opts = {}) {
  const turnMs = opts.turnMs || TURN_MS;
  const state = {
    board: initialBoard(),
    turn: 0,
    chain: null, // square index of the piece that must keep capturing
    pending: [], // squares captured during the running sequence (removed at the end of the turn)
    turnMs,
    majority: !!opts.majority,
    deadline: now + turnMs,
    moveNo: 0,
    plyNoProgress: 0, // plies since last capture / man move
    history: {}, // position key -> count
    phase: 'PLAY', // PLAY | DONE
    winnerSide: null,
    endReason: null, // NO_PIECES | NO_MOVES | TIMEOUT | RESIGN | DRAW_REPEAT | DRAW_KINGS
    draw: false,
  };
  state.history[posKey(state)] = 1;
  return state;
}

function posKey(s) {
  return `${s.turn}|${s.board.map((p) => p || '.').join('')}`;
}

/** captures for the piece on `from`. `blocked` = squares already captured in this sequence. */
function capturesFrom(board, from, pending) {
  const piece = board[from];
  const side = sideOf(piece);
  const [r0, c0] = rc(from);
  const out = [];
  const dead = new Set(pending);
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr;
    let c = c0 + dc;
    if (isKing(piece)) {
      while (inB(r, c) && board[sq(r, c)] === null) { r += dr; c += dc; } // flying king slides over empty squares
      if (!inB(r, c)) continue;
    }
    if (!inB(r, c)) continue;
    const mid = sq(r, c);
    const mp = board[mid];
    if (mp === null || sideOf(mp) === side || dead.has(mid)) continue;
    let lr = r + dr;
    let lc = c + dc;
    while (inB(lr, lc) && board[sq(lr, lc)] === null) {
      out.push({ from, to: sq(lr, lc), captured: mid });
      if (!isKing(piece)) break; // a man lands directly behind the victim
      lr += dr;
      lc += dc;
    }
  }
  return out;
}

function simpleMovesFrom(board, from) {
  const piece = board[from];
  const side = sideOf(piece);
  const [r0, c0] = rc(from);
  const out = [];
  for (const [dr, dc] of DIRS) {
    if (!isKing(piece) && dr !== (side === 0 ? -1 : 1)) continue;
    let r = r0 + dr;
    let c = c0 + dc;
    while (inB(r, c) && board[sq(r, c)] === null) {
      out.push({ from, to: sq(r, c), captured: null });
      if (!isKing(piece)) break;
      r += dr;
      c += dc;
    }
  }
  return out;
}

function legalMoves(state) {
  if (state.phase !== 'PLAY') return [];
  const { board, turn } = state;
  if (state.chain !== null) {
    return capturesFrom(board, state.chain, state.pending);
  }
  let caps = [];
  for (let i = 0; i < 64; i += 1) {
    if (sideOf(board[i]) !== turn) continue;
    caps = caps.concat(capturesFrom(board, i, state.pending));
  }
  if (caps.length) {
    if (state.majority) return onlyMajority(state, caps);
    return caps;
  }
  let moves = [];
  for (let i = 0; i < 64; i += 1) if (sideOf(board[i]) === turn) moves = moves.concat(simpleMovesFrom(board, i));
  return moves;
}

/** longest sequence length per first step (only used when the admin enables the majority variant) */
function onlyMajority(state, caps) {
  const lenOf = (cap) => {
    const sim = JSON.parse(JSON.stringify({ board: state.board, pending: state.pending }));
    return 1 + best(sim.board, cap, sim.pending);
  };
  function best(board, step, pending) {
    const b = board.slice();
    const piece = b[step.from];
    b[step.from] = null;
    const [tr] = rc(step.to);
    const promo = (piece === 'w' && tr === 0) || (piece === 'b' && tr === 7) ? piece.toUpperCase() : piece;
    b[step.to] = promo;
    const p2 = pending.concat(step.captured);
    const next = capturesFrom(b, step.to, p2);
    if (!next.length) return 0;
    return Math.max(...next.map((n) => 1 + best(b, n, p2)));
  }
  const scored = caps.map((c) => [c, lenOf(c)]);
  const max = Math.max(...scored.map((s) => s[1]));
  return scored.filter((s) => s[1] === max).map((s) => s[0]);
}

const hasPieces = (board, side) => board.some((p) => sideOf(p) === side);

/**
 * Apply one step (from -> to) for `side`. Returns an event describing the step.
 * Throws Error('Illegal move') for anything not in legalMoves().
 */
function applyMove(state, side, from, to, now) {
  if (state.phase !== 'PLAY') throw new Error('Game is over');
  if (state.turn !== side) throw new Error('Not your turn');
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error('Illegal move');
  const move = legalMoves(state).find((m) => m.from === from && m.to === to);
  if (!move) throw new Error('Illegal move');

  const piece = state.board[from];
  const wasKing = isKing(piece);
  state.board[from] = null;
  const [tr] = rc(to);
  const reachesEnd = (piece === 'w' && tr === 0) || (piece === 'b' && tr === 7);
  const newPiece = reachesEnd ? piece.toUpperCase() : piece;
  state.board[to] = newPiece;
  const promoted = reachesEnd && !wasKing;
  const ev = { type: 'moved', side, from, to, captured: move.captured, promoted, continues: false, auto: false };

  if (move.captured !== null) {
    state.pending.push(move.captured);
    const more = capturesFrom(state.board, to, state.pending);
    if (more.length) {
      state.chain = to;
      ev.continues = true;
      state.moveNo += 1;
      return ev; // same player, same deadline
    }
    // sequence finished: remove all captured pieces now
    for (const q of state.pending) state.board[q] = null;
    state.pending = [];
    state.chain = null;
    state.plyNoProgress = 0;
  } else {
    state.plyNoProgress = wasKing ? state.plyNoProgress + 1 : 0;
  }
  state.moveNo += 1;
  endTurn(state, side, now);
  ev.gameOver = state.phase === 'DONE';
  return ev;
}

function endTurn(state, side, now) {
  const opp = 1 - side;
  state.turn = opp;
  state.chain = null;
  state.deadline = now + state.turnMs;
  const key = posKey(state);
  state.history[key] = (state.history[key] || 0) + 1;

  if (!hasPieces(state.board, opp)) return finish(state, side, 'NO_PIECES');
  if (legalMoves(state).length === 0) return finish(state, side, 'NO_MOVES');
  if (state.history[key] >= 3) return finishDraw(state, 'DRAW_REPEAT');
  if (state.plyNoProgress >= KING_ONLY_DRAW_PLIES) return finishDraw(state, 'DRAW_KINGS');
  return null;
}

function finish(state, winnerSide, reason) {
  state.phase = 'DONE';
  state.winnerSide = winnerSide;
  state.endReason = reason;
  state.draw = false;
  state.deadline = null;
}
function finishDraw(state, reason) {
  state.phase = 'DONE';
  state.winnerSide = null;
  state.endReason = reason;
  state.draw = true;
  state.deadline = null;
}

function resign(state, side) {
  if (state.phase !== 'PLAY') return null;
  finish(state, 1 - side, 'RESIGN');
  return { type: 'resigned', side };
}

/** Called when the persisted deadline passed. Returns null when it is too early (timer fired early). */
function handleTimeout(state, now) {
  if (state.phase !== 'PLAY' || !state.deadline || now < state.deadline) return null;
  const loser = state.turn;
  finish(state, 1 - loser, 'TIMEOUT');
  return { type: 'timeout', side: loser };
}

/** Client view helper: legal moves grouped by origin square. */
function legalByFrom(state) {
  const map = {};
  for (const m of legalMoves(state)) (map[m.from] = map[m.from] || []).push({ to: m.to, captured: m.captured });
  return map;
}

function counts(board) {
  const c = { w: 0, b: 0 };
  for (const p of board) if (p) c[sideOf(p) === 0 ? 'w' : 'b'] += 1;
  return c;
}

module.exports = {
  TURN_MS, sq, rc, isDark, sideOf, isKing, initialBoard, createGame, legalMoves, legalByFrom,
  applyMove, resign, handleTimeout, counts, capturesFrom,
};
