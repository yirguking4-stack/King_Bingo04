'use strict';
// Run: node src/dama/damaEngine.test.js
const assert = require('assert');
const E = require('./damaEngine');

let n = 0;
const test = (name, fn) => { fn(); n += 1; console.log('ok -', name); };
const S = (name) => E.sq(8 - Number(name[1]), name.charCodeAt(0) - 97); // 'c3' -> index
const N = (i) => `${String.fromCharCode(97 + (i % 8))}${8 - Math.floor(i / 8)}`;
/** custom position: put({ c3: 'w', d4: 'b' }, turn) */
function put(map, turn = 0, now = 0) {
  const s = E.createGame(now);
  s.board = Array(64).fill(null);
  for (const [k, v] of Object.entries(map)) s.board[S(k)] = v;
  s.turn = turn;
  s.history = {};
  return s;
}
const mv = (s, a, b, now = 1000) => E.applyMove(s, s.turn, S(a), S(b), now);
const rejects = (fn) => assert.throws(fn, /Illegal move|Not your turn|Game is over/);

test('initial board: 8x8, 12 pieces each, only dark squares, white at the bottom', () => {
  const s = E.createGame(0);
  assert.strictEqual(s.board.length, 64);
  const c = E.counts(s.board);
  assert.deepStrictEqual(c, { w: 12, b: 12 });
  s.board.forEach((p, i) => {
    if (p) { const [r, col] = E.rc(i); assert.ok(E.isDark(r, col)); assert.strictEqual(p === 'w', r > 4); }
  });
  assert.strictEqual(s.board[S('a1')], 'w');
  assert.strictEqual(s.turn, 0);
  assert.strictEqual(s.deadline, 45000);
});

test('opening: white has exactly 7 simple moves', () => {
  assert.strictEqual(E.legalMoves(E.createGame(0)).length, 7);
});

test('man moves one square diagonally forward only', () => {
  const s = put({ c3: 'w', h8: 'b' });
  const to = E.legalMoves(s).map((m) => N(m.to)).sort();
  assert.deepStrictEqual(to, ['b4', 'd4']);
  rejects(() => mv(s, 'c3', 'b2')); // backwards
  rejects(() => mv(s, 'c3', 'c4')); // not diagonal
});

test('man captures backward and forward', () => {
  const s = put({ d4: 'w', c3: 'b', h8: 'b' });
  const caps = E.legalMoves(s);
  assert.deepStrictEqual(caps.map((m) => `${N(m.from)}${N(m.to)}`), ['d4b2']); // backward capture
  const s2 = put({ d4: 'w', e5: 'b', h8: 'b' });
  assert.deepStrictEqual(E.legalMoves(s2).map((m) => N(m.to)), ['f6']);
});

test('MANDATORY CAPTURE: simple move is rejected when a capture exists', () => {
  const s = put({ d4: 'w', e5: 'b', a1: 'w', h8: 'b' });
  rejects(() => mv(s, 'd4', 'c5'));
});

test('MANDATORY CAPTURE: moving another piece is rejected while any piece can capture', () => {
  const s = put({ d4: 'w', e5: 'b', a1: 'w', h8: 'b' });
  rejects(() => mv(s, 'a1', 'b2'));
  const ev = mv(s, 'd4', 'f6');
  assert.strictEqual(ev.captured, S('e5'));
});

test('MANDATORY CAPTURE applies to kings too', () => {
  const s = put({ a1: 'W', d4: 'b', h2: 'w', h8: 'b' });
  rejects(() => mv(s, 'h2', 'g3'));
  rejects(() => mv(s, 'a1', 'b2')); // king must capture, not slide
  assert.ok(E.legalMoves(s).every((m) => m.captured !== null));
});

test('free choice: no majority rule by default', () => {
  // white d4 can take e5 (1 piece) or c5->... ; both single and double options are legal
  const s = put({ d4: 'w', e5: 'b', c5: 'b', b6: 'b', h8: 'b' });
  const firsts = E.legalMoves(s).map((m) => N(m.to)).sort();
  assert.deepStrictEqual(firsts, ['f6']); // c5 blocked by b6 behind it; only e5 capture
  const s2 = put({ d4: 'w', e5: 'b', c5: 'b', h8: 'b', f6: null });
  assert.deepStrictEqual(E.legalMoves(s2).map((m) => N(m.to)).sort(), ['b6', 'f6']);
});

test('multi-capture: must continue with the same piece; turn and deadline unchanged mid-chain', () => {
  const s = put({ b2: 'w', c3: 'b', e5: 'b', a1: 'w', h8: 'b' }, 0, 0);
  s.deadline = 5000;
  const ev = mv(s, 'b2', 'd4'); // captures c3, must continue over e5
  assert.ok(ev.continues);
  assert.strictEqual(s.turn, 0);
  assert.strictEqual(s.deadline, 5000);
  assert.strictEqual(s.chain, S('d4'));
  rejects(() => mv(s, 'a1', 'b2')); // cannot switch piece
  assert.deepStrictEqual(E.legalMoves(s).map((m) => N(m.to)), ['f6']);
  const ev2 = E.applyMove(s, 0, S('d4'), S('f6'), 9000);
  assert.ok(!ev2.continues);
  assert.strictEqual(s.turn, 1);
  assert.strictEqual(s.deadline, 9000 + 45000); // reset only when the turn really changes
  assert.strictEqual(s.board[S('c3')], null); // removed at the end
  assert.strictEqual(s.board[S('e5')], null);
});

test('captured pieces stay until the sequence ends and cannot be jumped twice', () => {
  // classic square: white man must not jump the same black man again
  const s = put({ a1: 'w', b2: 'b', d2: 'b', d4: 'b', b4: 'b', h8: 'b' }, 0);
  const ev = mv(s, 'a1', 'c3');
  assert.ok(ev.continues);
  assert.ok(s.pending.includes(S('b2')));
  const next = E.legalMoves(s).map((m) => N(m.captured));
  assert.ok(!next.includes('b2'));
});

test('flying king: slides over empty squares', () => {
  const s = put({ a1: 'W', h8: 'b' }, 0);
  const to = E.legalMoves(s).map((m) => N(m.to));
  assert.ok(to.includes('g7') && to.includes('b2') && to.length === 6);
});

test('flying king capture: lands on ANY empty square beyond, not past a blocker', () => {
  const s = put({ a1: 'W', c3: 'b', g7: 'b', h8: 'w' }, 0);
  const lands = E.legalMoves(s).filter((m) => m.captured === S('c3')).map((m) => N(m.to)).sort();
  assert.deepStrictEqual(lands, ['d4', 'e5', 'f6']); // g7 is occupied -> stop
});

test('flying king cannot jump two adjacent pieces or its own piece', () => {
  const s = put({ a1: 'W', c3: 'b', d4: 'b', h8: 'b' }, 0);
  assert.strictEqual(E.legalMoves(s).filter((m) => m.from === S('a1') && m.captured !== null).length, 0);
  const s2 = put({ a1: 'W', c3: 'w', d4: 'b', h8: 'b' }, 0);
  assert.strictEqual(E.legalMoves(s2).filter((m) => m.from === S('a1')).length, 0 + 0);
});

test('flying king multi-capture chooses landing that allows continuation', () => {
  const s = put({ a1: 'W', c3: 'b', e7: 'b', h8: 'b' }, 0);
  // capture c3 landing on e5 or f6 / d4: from d4..f6 the king can turn; e7 is reachable from f6 (g8?) -> check chain exists for some landing
  const first = E.legalMoves(s).filter((m) => m.captured === S('c3'));
  const withMore = first.filter((m) => {
    const copy = JSON.parse(JSON.stringify(s));
    E.applyMove(copy, 0, m.from, m.to, 0);
    return copy.chain !== null;
  });
  assert.ok(withMore.length >= 1);
  assert.ok(first.length > withMore.length || first.length === withMore.length);
});

test('promotion by plain move ends the turn', () => {
  const s = put({ b7: 'w', h2: 'b' }, 0);
  const ev = mv(s, 'b7', 'a8');
  assert.ok(ev.promoted);
  assert.strictEqual(s.board[S('a8')], 'W');
  assert.strictEqual(s.turn, 1);
});

test('promotion DURING a capture: the new king keeps capturing as a king in the same turn', () => {
  // white man on b6 takes c7 -> d8 (promotes) then, as a king, takes g5? line d8-e7-f6-g5-h4
  const s = put({ b6: 'w', c7: 'b', f6: 'b', h2: 'b', a1: 'w' }, 0);
  const ev = mv(s, 'b6', 'd8');
  assert.ok(ev.promoted && ev.continues);
  assert.strictEqual(s.board[S('d8')], 'W');
  const next = E.legalMoves(s);
  assert.ok(next.length > 0 && next.every((m) => m.from === S('d8') && m.captured === S('f6')));
});

test('man that reaches the last row mid-capture but cannot continue ends the turn as a king', () => {
  const s = put({ b6: 'w', c7: 'b', h2: 'b' }, 0);
  const ev = mv(s, 'b6', 'd8');
  assert.ok(ev.promoted && !ev.continues);
  assert.strictEqual(s.turn, 1);
});

test('win by capturing all pieces', () => {
  const s = put({ d4: 'w', e5: 'b' }, 0);
  mv(s, 'd4', 'f6');
  assert.strictEqual(s.phase, 'DONE');
  assert.strictEqual(s.winnerSide, 0);
  assert.strictEqual(s.endReason, 'NO_PIECES');
});

test('win when the opponent has no legal move', () => {
  const s = put({ h2: 'b', g1: 'w', c3: 'w' }, 0);
  mv(s, 'c3', 'd4', 10);
  assert.strictEqual(s.phase, 'DONE');
  assert.strictEqual(s.winnerSide, 0);
  assert.strictEqual(s.endReason, 'NO_MOVES');
});

test('timeout: too early returns null, expired gives the opponent the win exactly once', () => {
  const s = E.createGame(0);
  assert.strictEqual(E.handleTimeout(s, 44999), null);
  const ev = E.handleTimeout(s, 45000);
  assert.strictEqual(ev.type, 'timeout');
  assert.strictEqual(s.winnerSide, 1);
  assert.strictEqual(s.endReason, 'TIMEOUT');
  assert.strictEqual(E.handleTimeout(s, 99999), null); // duplicate event: no second outcome
});

test('resignation and no moves after the game is over', () => {
  const s = E.createGame(0);
  E.resign(s, 0);
  assert.strictEqual(s.winnerSide, 1);
  assert.strictEqual(s.endReason, 'RESIGN');
  assert.strictEqual(E.resign(s, 1), null);
  rejects(() => E.applyMove(s, 1, S('a3'), S('b4'), 5));
});

test('not your turn / forged squares are rejected', () => {
  const s = E.createGame(0);
  rejects(() => E.applyMove(s, 1, S('b6'), S('a5'), 1));
  rejects(() => E.applyMove(s, 0, 999, 3, 1));
  rejects(() => E.applyMove(s, 0, 'x', 'y', 1));
  rejects(() => E.applyMove(s, 0, S('a1'), S('a2'), 1));
});

test('draw: king-only moves for 15 moves each without capture', () => {
  const s = put({ a1: 'W', h4: 'B' }, 0);
  s.plyNoProgress = 28;
  mv(s, 'a1', 'b2');
  assert.strictEqual(s.phase, 'PLAY');
  mv(s, 'h4', 'g3');
  assert.strictEqual(s.phase, 'DONE');
  assert.ok(s.draw && s.endReason === 'DRAW_KINGS' && s.winnerSide === null);
});

test('draw: threefold repetition', () => {
  const s = put({ a1: 'W', h4: 'B' }, 0);
  s.history[`${s.turn}|${s.board.map((p) => p || '.').join('')}`] = 1;
  const seq = [['a1', 'b2'], ['h4', 'g3'], ['b2', 'a1'], ['g3', 'h4']];
  for (let round = 0; round < 2; round += 1) for (const [a, b] of seq) if (s.phase === 'PLAY') mv(s, a, b);
  assert.strictEqual(s.phase, 'DONE');
  assert.strictEqual(s.endReason, 'DRAW_REPEAT');
});

test('majority variant (admin option) forces the longest sequence; default allows free choice', () => {
  const pos = { b2: 'w', c3: 'b', e5: 'b', f2: 'w', g3: 'b', h8: 'b' };
  const free = put(pos, 0);
  assert.ok(E.legalMoves(free).some((m) => m.from === S('f2')));
  const maj = put(pos, 0);
  maj.majority = true;
  assert.ok(E.legalMoves(maj).every((m) => m.from === S('b2')));
});

console.log(`\n${n} dama engine tests passed`);
