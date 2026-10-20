// One "hop" of a token on its way to a new position.
// Positions: -1 = yard, 0..50 shared track (0 = the seat's start square), 51..55 private lane, 56 = centre.
// A token moves one square at a time, so a roll of 3 shows 3 hops and never skips a square.
export const MAX_WALK = 6; // a normal roll never moves more than 6 squares

/** Returns { next, kind } where kind is 'step' | 'exit' | 'capture' | 'jump'. */
export function nextHop(cur, target) {
  if (cur === target) return { next: cur, kind: 'none' };
  if (cur === -1) return { next: target, kind: 'exit' }; // leaving the yard is a single hop onto the start square
  if (target === -1) return { next: -1, kind: 'capture' }; // captured: back to the yard
  if (target < cur || target - cur > MAX_WALK) return { next: target, kind: 'jump' }; // state catch-up after a reconnect
  return { next: cur + 1, kind: 'step' };
}
