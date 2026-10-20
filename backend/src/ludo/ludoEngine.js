'use strict';
/**
 * KING LUDO — pure rules engine (no DB, no sockets, no timers).
 * The server is the only place dice are rolled and moves are applied.
 *
 * RULESET (documented, identical for 2 and 4 players)
 *  - Each player has 4 tokens. 52-square shared track; token positions are RELATIVE to the owner's start:
 *      -1        = in the yard (home base)
 *      0..50     = on the track (absolute square = (SEAT_START[seat] + pos) % 52)
 *      51..55    = private finishing lane
 *      56        = finished (centre)
 *  - A token leaves the yard only on a 6 (it lands on pos 0, the player's start square).
 *  - Finishing needs the EXACT number (pos + dice must be <= 56).
 *  - Safe squares: the four start squares and the four star squares. No capture happens there.
 *  - Landing on a non-safe track square holding opponent token(s) sends them back to the yard.
 *  - Extra turn after: rolling a 6, capturing, or bringing a token to the centre.
 *  - No legal move -> turn passes (no penalty).
 *  - Win: `crowns` tokens (1, 2 or 4, chosen when the room is created) reach the centre,
 *    or every other player has been removed.
 *  - Timers: 20 s to roll, 15 s to move. Missing the roll => server rolls automatically
 *    (counts as 1 missed roll). 2 CONSECUTIVE missed rolls => the player is removed.
 *    A manual roll resets the counter. The 15 s move timeout does NOT count as a missed roll.
 *  - Auto-move policy when the 15 s move timer expires (deterministic):
 *      1) a move that reaches the centre  2) a capture  3) leaving the yard
 *      4) the token furthest along  (ties -> lowest token index)
 */
const crypto = require('crypto');

const TRACK_LEN = 52;
const LANE_START = 51;
const FINISH = 56;
const YARD = -1;
const SEAT_START = [0, 13, 26, 39]; // seats clockwise: 0 green, 1 red, 2 blue, 3 yellow
const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const COLORS = ['green', 'red', 'blue', 'yellow'];

const ROLL_MS = 20000;
const MOVE_MS = 15000;
const PASS_MS = 1500; // short pause so everyone can see a dice with no legal move
const MAX_MISSED_ROLLS = 2;

// "Six guarantee" (owner rule). It only applies while a player has NO token out of the yard.
//  - at the start of the game: after 2 rolls without a 6, the 3rd roll is a 6
//  - after one of his tokens was captured (all back in the yard): after 6 rolls without a 6, the 7th roll is a 6
const SIX_GUARANTEE_FIRST = 2; // non-6 rolls allowed before the forced 6 at the start of the game
const SIX_GUARANTEE_LATER = 6; // non-6 rolls allowed before the forced 6 after a capture

const secureDie = () => crypto.randomInt(1, 7);

function seatsFor(capacity) {
  return capacity === 2 ? [0, 2] : [0, 1, 2, 3];
}

function absSquare(seat, pos) {
  return pos >= 0 && pos <= 50 ? (SEAT_START[seat] + pos) % TRACK_LEN : null;
}

/** players: array of { userId } in join order. */
function createGame({ players, capacity, crowns }, now) {
  const seats = seatsFor(capacity);
  if (players.length !== capacity) throw new Error('Player count does not match capacity');
  const state = {
    capacity,
    crowns,
    seats,
    order: [...seats],
    players: [null, null, null, null],
    tokens: [null, null, null, null],
    turn: seats[0],
    phase: 'ROLL', // ROLL | MOVE | DONE
    dice: null,
    legal: [],
    deadline: now + ROLL_MS,
    turnNo: 1,
    winnerSeat: null,
    endReason: null,
  };
  seats.forEach((seat, i) => {
    state.players[seat] = { userId: players[i].userId, missed: 0, removed: false, noSix: 0, everOut: false };
    state.tokens[seat] = [YARD, YARD, YARD, YARD];
  });
  return state;
}

function legalMoves(state, seat, dice) {
  const moves = [];
  state.tokens[seat].forEach((pos, token) => {
    if (pos === YARD) {
      if (dice === 6) moves.push({ token, from: YARD, to: 0 });
    } else if (pos >= 0 && pos < FINISH && pos + dice <= FINISH) {
      moves.push({ token, from: pos, to: pos + dice });
    }
  });
  return moves;
}

function activeSeats(state) {
  return state.order.filter((s) => !state.players[s].removed);
}

function nextSeatAfter(state, seat) {
  const idx = state.order.indexOf(seat);
  for (let i = 1; i <= state.order.length; i += 1) {
    const s = state.order[(idx + i) % state.order.length];
    if (!state.players[s].removed) return s;
  }
  return seat;
}

function startTurn(state, seat, now) {
  state.turn = seat;
  state.phase = 'ROLL';
  state.dice = null;
  state.legal = [];
  state.deadline = now + ROLL_MS;
  state.turnNo += 1;
}

function finishedCount(state, seat) {
  return state.tokens[seat].filter((p) => p === FINISH).length;
}

function endGame(state, seat, reason) {
  state.phase = 'DONE';
  state.winnerSeat = seat;
  state.endReason = reason;
  state.dice = null;
  state.legal = [];
  state.deadline = null;
}

/** True while the player has tokens waiting in the yard and none on the board. */
function noTokenOut(state, seat) {
  const t = state.tokens[seat];
  return t.some((p) => p === YARD) && t.every((p) => p === YARD || p === FINISH);
}

function applySixGuarantee(state, seat, dice) {
  const pl = state.players[seat];
  if (!noTokenOut(state, seat)) {
    pl.noSix = 0;
    return dice;
  }
  const limit = pl.everOut ? SIX_GUARANTEE_LATER : SIX_GUARANTEE_FIRST;
  if (dice !== 6 && (pl.noSix || 0) >= limit) dice = 6;
  pl.noSix = dice === 6 ? 0 : (pl.noSix || 0) + 1;
  return dice;
}

/** Manual (auto=false) or automatic (auto=true) dice roll. */
function roll(state, seat, now, { auto = false, rng = secureDie } = {}) {
  if (state.phase !== 'ROLL') throw new Error('Not in roll phase');
  if (state.turn !== seat) throw new Error('Not your turn');
  let dice = rng();
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw new Error('Bad dice');
  dice = applySixGuarantee(state, seat, dice);
  if (!auto) state.players[seat].missed = 0; // a successful manual roll resets the counter
  state.dice = dice;
  state.legal = legalMoves(state, seat, dice);
  state.phase = 'MOVE';
  state.deadline = now + (state.legal.length ? MOVE_MS : PASS_MS);
  return [{ type: 'rolled', seat, dice, auto, noMoves: state.legal.length === 0 }];
}

function applyMove(state, seat, token, now, { auto = false } = {}) {
  if (state.phase !== 'MOVE') throw new Error('Not in move phase');
  if (state.turn !== seat) throw new Error('Not your turn');
  const mv = state.legal.find((m) => m.token === token);
  if (!mv) throw new Error('Illegal move');

  const dice = state.dice;
  state.tokens[seat][token] = mv.to;
  if (mv.from === YARD) state.players[seat].everOut = true;
  const captured = [];
  const abs = absSquare(seat, mv.to);
  if (abs !== null && !SAFE_SQUARES.has(abs)) {
    for (const s2 of activeSeats(state)) {
      if (s2 === seat) continue;
      state.tokens[s2].forEach((p, t2) => {
        if (p >= 0 && p <= 50 && absSquare(s2, p) === abs) {
          state.tokens[s2][t2] = YARD;
          captured.push({ seat: s2, token: t2 });
        }
      });
    }
  }
  const reachedCentre = mv.to === FINISH;
  const events = [{ type: 'moved', seat, token, from: mv.from, to: mv.to, dice, auto, captured, reachedCentre }];

  if (reachedCentre && finishedCount(state, seat) >= state.crowns) {
    endGame(state, seat, 'FINISHED');
    events.push({ type: 'game_over', seat, reason: 'FINISHED' });
    return events;
  }
  if (dice === 6 || captured.length > 0 || reachedCentre) {
    startTurn(state, seat, now); // extra turn
    events.push({ type: 'extra_turn', seat });
  } else {
    startTurn(state, nextSeatAfter(state, seat), now);
  }
  return events;
}

function passTurn(state, now) {
  const seat = state.turn;
  startTurn(state, nextSeatAfter(state, seat), now);
  return [{ type: 'passed', seat }];
}

function removePlayer(state, seat, now, reason = 'MISSED_ROLLS') {
  const nextSeat = nextSeatAfter(state, seat);
  state.players[seat].removed = true;
  state.tokens[seat] = [YARD, YARD, YARD, YARD];
  const events = [{ type: 'removed', seat, reason }];
  const left = activeSeats(state);
  if (left.length === 1) {
    endGame(state, left[0], 'FORFEIT');
    events.push({ type: 'game_over', seat: left[0], reason: 'FORFEIT' });
  } else if (state.turn === seat) {
    startTurn(state, nextSeat, now);
  }
  return events;
}

function chooseAutoMove(state) {
  const seat = state.turn;
  let best = null;
  for (const m of state.legal) {
    let score = 0;
    if (m.to === FINISH) score = 4000;
    else {
      const abs = absSquare(seat, m.to);
      let captures = false;
      if (abs !== null && !SAFE_SQUARES.has(abs)) {
        captures = activeSeats(state).some(
          (s2) => s2 !== seat && state.tokens[s2].some((p) => p >= 0 && p <= 50 && absSquare(s2, p) === abs)
        );
      }
      if (captures) score = 3000;
      else if (m.from === YARD) score = 2000;
      else score = 1000 + m.from;
    }
    if (!best || score > best.score || (score === best.score && m.token < best.m.token)) best = { m, score };
  }
  return best ? best.m.token : null;
}

/**
 * Called when a deadline may have passed. Returns null if nothing is due,
 * otherwise the list of events produced. Safe to call repeatedly: it acts at most once per deadline.
 */
function handleTimeout(state, now, opts = {}) {
  if (state.phase === 'DONE' || state.deadline === null || now < state.deadline) return null;
  const seat = state.turn;
  if (state.phase === 'ROLL') {
    const p = state.players[seat];
    p.missed += 1;
    if (p.missed >= MAX_MISSED_ROLLS) return removePlayer(state, seat, now);
    return roll(state, seat, now, { auto: true, rng: opts.rng || secureDie });
  }
  // MOVE phase
  if (state.legal.length === 0) return passTurn(state, now);
  return applyMove(state, seat, chooseAutoMove(state), now, { auto: true });
}

module.exports = {
  TRACK_LEN, LANE_START, FINISH, YARD, SEAT_START, SAFE_SQUARES, COLORS,
  ROLL_MS, MOVE_MS, PASS_MS, MAX_MISSED_ROLLS,
  seatsFor, absSquare, createGame, legalMoves, activeSeats, roll, applyMove, passTurn,
  removePlayer, handleTimeout, chooseAutoMove, secureDie,
};
