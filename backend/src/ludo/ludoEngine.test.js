'use strict';
// Run: node src/ludo/ludoEngine.test.js
const assert = require('assert');
const E = require('./ludoEngine');

let n = 0;
const test = (name, fn) => { fn(); n += 1; console.log('ok -', name); };
const fixed = (...vals) => { let i = 0; return () => vals[i++]; };
const mk = (cap = 2, crowns = 4) =>
  E.createGame({ players: Array.from({ length: cap }, (_, i) => ({ userId: i + 1 })), capacity: cap, crowns }, 0);

test('2-player uses opposite seats, 4 tokens each', () => {
  const s = mk(2);
  assert.deepStrictEqual(s.seats, [0, 2]);
  assert.strictEqual(s.tokens[0].length, 4);
  assert.strictEqual(s.tokens[1], null);
});
test('yard token only leaves on a 6', () => {
  const s = mk(2);
  E.roll(s, 0, 0, { rng: fixed(3) });
  assert.strictEqual(s.legal.length, 0);
  const s2 = mk(2);
  E.roll(s2, 0, 0, { rng: fixed(6) });
  assert.strictEqual(s2.legal.length, 4);
});
test('no legal move: short pause then turn passes, no penalty', () => {
  const s = mk(2);
  E.roll(s, 0, 0, { rng: fixed(2) });
  assert.strictEqual(s.deadline, E.PASS_MS);
  E.handleTimeout(s, E.PASS_MS);
  assert.strictEqual(s.turn, 2);
  assert.strictEqual(s.players[0].missed, 0);
});
test('six gives an extra turn', () => {
  const s = mk(2);
  E.roll(s, 0, 0, { rng: fixed(6) });
  E.applyMove(s, 0, 0, 0);
  assert.strictEqual(s.turn, 0);
  assert.strictEqual(s.phase, 'ROLL');
});
test('capture on a normal square sends token to yard and grants extra turn', () => {
  const s = mk(2);
  s.tokens[0][0] = 10;            // abs 10 (not safe)
  s.tokens[2][0] = 50;            // seat 2 start 26 -> abs (26+50)%52 = 24
  s.tokens[2][0] = 36;            // abs (26+36)%52 = 10
  E.roll(s, 0, 0, { rng: fixed(5) }); // 10 -> 15 : abs 15 no. use a closer setup
  s.phase = 'ROLL'; s.legal = []; s.dice = null;
  s.tokens[0][0] = 5;
  E.roll(s, 0, 0, { rng: fixed(5) }); // 5 -> 10 abs 10
  const ev = E.applyMove(s, 0, 0, 0);
  assert.strictEqual(ev[0].captured.length, 1);
  assert.strictEqual(s.tokens[2][0], -1);
  assert.strictEqual(s.turn, 0);
});
test('no capture on a safe (star) square', () => {
  const s = mk(2);
  s.tokens[0][0] = 3;                 // 3 + 5 = 8 = star
  s.tokens[2][0] = (8 - 26 + 52) % 52; // abs 8 for seat 2
  E.roll(s, 0, 0, { rng: fixed(5) });
  const ev = E.applyMove(s, 0, 0, 0);
  assert.strictEqual(ev[0].captured.length, 0);
  assert.notStrictEqual(s.tokens[2][0], -1);
});
test('exact roll needed to finish', () => {
  const s = mk(2);
  s.tokens[0] = [54, -1, -1, -1];
  E.roll(s, 0, 0, { rng: fixed(4) });
  assert.strictEqual(s.legal.length, 0);
  const s2 = mk(2); s2.tokens[0] = [54, -1, -1, -1];
  E.roll(s2, 0, 0, { rng: fixed(2) });
  assert.strictEqual(s2.legal[0].to, 56);
});
test('win with all four tokens (and with 1 crown)', () => {
  const s = mk(2, 4);
  s.tokens[0] = [56, 56, 56, 55];
  E.roll(s, 0, 0, { rng: fixed(1) });
  E.applyMove(s, 0, 3, 0);
  assert.strictEqual(s.winnerSeat, 0); assert.strictEqual(s.phase, 'DONE');
  const s1 = mk(2, 1); s1.tokens[0] = [55, -1, -1, -1];
  E.roll(s1, 0, 0, { rng: fixed(1) }); E.applyMove(s1, 0, 0, 0);
  assert.strictEqual(s1.winnerSeat, 0);
});
test('roll timeout: first miss auto-rolls, second consecutive miss removes player (2p -> opponent wins)', () => {
  const s = mk(2);
  let ev = E.handleTimeout(s, E.ROLL_MS, { rng: fixed(2) });
  assert.strictEqual(ev[0].auto, true); assert.strictEqual(s.players[0].missed, 1);
  E.handleTimeout(s, E.ROLL_MS + E.PASS_MS); // no legal -> pass to seat 2
  E.roll(s, 2, 0, { rng: fixed(2) });         // seat 2 plays manually
  s.deadline = 0; E.handleTimeout(s, 1);       // pass
  assert.strictEqual(s.turn, 0);
  ev = E.handleTimeout(s, s.deadline + 1);
  assert.ok(ev.find((e) => e.type === 'removed'));
  assert.strictEqual(s.winnerSeat, 2);
});
test('manual roll between misses resets the counter', () => {
  const s = mk(2);
  E.handleTimeout(s, E.ROLL_MS, { rng: fixed(2) });
  assert.strictEqual(s.players[0].missed, 1);
  s.phase = 'ROLL'; s.turn = 0; s.dice = null; s.legal = [];
  E.roll(s, 0, 0, { rng: fixed(2) });
  assert.strictEqual(s.players[0].missed, 0);
});
test('15s move timeout auto-moves and does NOT count as a missed roll', () => {
  const s = mk(2);
  E.roll(s, 0, 0, { rng: fixed(6) });
  const t = s.deadline;
  const ev = E.handleTimeout(s, t);
  assert.strictEqual(ev[0].type, 'moved'); assert.strictEqual(ev[0].auto, true);
  assert.strictEqual(s.players[0].missed, 0);
});
test('4-player: removed player is skipped, game goes on; last one standing wins', () => {
  const s = mk(4);
  s.players[0].missed = 1;
  E.handleTimeout(s, E.ROLL_MS);           // seat 0 removed
  assert.strictEqual(s.players[0].removed, true);
  assert.strictEqual(s.turn, 1); assert.strictEqual(s.winnerSeat, null);
  E.removePlayer(s, 1, 0); E.removePlayer(s, 2, 0);
  assert.strictEqual(s.winnerSeat, 3);
});
test('timeout does nothing before the deadline (exactly-once per deadline)', () => {
  const s = mk(2);
  assert.strictEqual(E.handleTimeout(s, E.ROLL_MS - 1), null);
});
test('auto-move prefers finish > capture > leave yard > furthest', () => {
  const s = mk(2);
  s.tokens[0] = [-1, 20, 54, -1];
  E.roll(s, 0, 0, { rng: fixed(2) });
  assert.strictEqual(E.chooseAutoMove(s), 2);
});
test('six guarantee at game start: 3rd roll is a 6 when nothing is out', () => {
  const s = mk(2);
  const rolls = [];
  for (let i = 0; i < 3; i += 1) {
    s.phase = 'ROLL'; s.turn = 0; s.tokens[0] = [E.YARD, E.YARD, E.YARD, E.YARD];
    E.roll(s, 0, 0, { rng: () => 1 });
    rolls.push(s.dice);
  }
  assert.deepStrictEqual(rolls, [1, 1, 6]);
});
test('six guarantee after a capture: forced 6 only on the 7th roll', () => {
  const s = mk(2);
  s.players[0].everOut = true; // had a token out before, now captured
  const rolls = [];
  for (let i = 0; i < 7; i += 1) {
    s.phase = 'ROLL'; s.turn = 0; s.tokens[0] = [E.YARD, E.YARD, E.YARD, E.YARD];
    E.roll(s, 0, 0, { rng: () => 2 });
    rolls.push(s.dice);
  }
  assert.deepStrictEqual(rolls, [2, 2, 2, 2, 2, 2, 6]);
});
test('six guarantee does not touch a player who has a token on the board', () => {
  const s = mk(2);
  for (let i = 0; i < 5; i += 1) {
    s.phase = 'ROLL'; s.turn = 0; s.tokens[0] = [10, E.YARD, E.YARD, E.YARD];
    E.roll(s, 0, 0, { rng: () => 3 });
    assert.strictEqual(s.dice, 3);
  }
});
test('a natural 6 resets the no-six counter', () => {
  const s = mk(2);
  s.phase = 'ROLL'; s.turn = 0; E.roll(s, 0, 0, { rng: () => 1 });
  s.phase = 'ROLL'; s.turn = 0; E.roll(s, 0, 0, { rng: () => 6 });
  assert.strictEqual(s.players[0].noSix, 0);
});

console.log(`\n${n} engine tests passed`);
