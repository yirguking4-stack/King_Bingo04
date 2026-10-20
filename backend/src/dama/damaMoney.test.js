'use strict';
// Run: node src/dama/damaMoney.test.js
const assert = require('assert');
const { payoutFor } = require('./damaMoney');

// stake -> [pot, commission, winner]  (the payout table of the specification)
const TABLE = { 50: [100, 10, 90], 70: [140, 14, 126], 100: [200, 20, 180], 200: [400, 40, 360], 500: [1000, 100, 900], 1000: [2000, 200, 1800], 5000: [10000, 1000, 9000] };
for (const [stake, [pot, commission, prize]] of Object.entries(TABLE)) {
  const r = payoutFor(Number(stake));
  assert.deepStrictEqual([r.pot, r.commission, r.prize], [pot, commission, prize], `stake ${stake}`);
  assert.strictEqual(r.commission + r.prize, r.pot); // every birr is accounted for
  assert.ok(Number.isInteger(r.commission) && Number.isInteger(r.prize));
  console.log('ok - payout', stake, '->', r.prize);
}
assert.throws(() => payoutFor(0));
assert.throws(() => payoutFor(-5));
assert.throws(() => payoutFor(12.5));
console.log('ok - invalid stakes rejected');
