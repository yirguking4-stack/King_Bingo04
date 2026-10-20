'use strict';
// Pure money rules for King Dama (whole ETB integers, never floats).
const COMMISSION_PERCENT = 10;

/** pot = 2 x stake, commission = floor(10% of the pot), winner prize = pot - commission */
function payoutFor(bet) {
  if (!Number.isInteger(bet) || bet <= 0) throw new Error('Invalid stake');
  const pot = bet * 2;
  const commission = Math.floor((pot * COMMISSION_PERCENT) / 100);
  return { pot, commission, prize: pot - commission };
}

module.exports = { COMMISSION_PERCENT, payoutFor };
