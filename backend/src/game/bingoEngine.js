// ============================================================================
// KING BINGO — core game engine
// Standard 75-ball, 5x5 card, free center space.
// B: 1-15  I: 16-30  N: 31-45  G: 46-60  O: 61-75
// ============================================================================

const COLUMN_RANGES = {
  B: [1, 15],
  I: [16, 30],
  N: [31, 45],
  G: [46, 60],
  O: [61, 75],
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generates a random 5x5 bingo card: columns B/I/N/G/O each get 5 unique
 * numbers from their range, center cell is a free space (represented as 0).
 * Returned as a column-major array of arrays: [ [B...], [I...], [N...], [G...], [O...] ]
 */
function generateCard() {
  const card = {};
  for (const [letter, [min, max]] of Object.entries(COLUMN_RANGES)) {
    const pool = [];
    for (let n = min; n <= max; n++) pool.push(n);
    card[letter] = shuffle(pool).slice(0, 5);
  }
  card.N[2] = 0; // free space in the middle of the N column
  return card;
}

// ---------------------------------------------------------------------------
// FIXED CARD POOL: 150 numbered cards (1-150). Card #N is always the same, so
// a player can preview it, and two players can never hold the same number.
// ---------------------------------------------------------------------------
const CARD_COUNT = 150;

// small deterministic PRNG (mulberry32) so card #N is reproducible
function seededRandom(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildSeededCard(seed) {
  const rand = seededRandom(seed);
  const card = {};
  for (const [letter, [min, max]] of Object.entries(COLUMN_RANGES)) {
    const pool = [];
    for (let n = min; n <= max; n++) pool.push(n);
    card[letter] = seededShuffle(pool, rand).slice(0, 5);
  }
  card.N[2] = 0; // free space
  return card;
}

const cardKey = (card) => JSON.stringify(card);

// Build the 150 cards once; if two seeds ever produced an identical layout,
// move on to the next seed so every card in the pool is unique.
const CARD_POOL = (() => {
  const pool = [];
  const seen = new Set();
  let seed = 1;
  for (let id = 1; id <= CARD_COUNT; id++) {
    let card = buildSeededCard(seed * 7919);
    while (seen.has(cardKey(card))) {
      seed += 1;
      card = buildSeededCard(seed * 7919);
    }
    seen.add(cardKey(card));
    pool.push({ id, card });
    seed += 1;
  }
  return pool;
})();

function getCardById(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1 || n > CARD_COUNT) return null;
  return CARD_POOL[n - 1].card;
}

/**
 * Flattens the card into row-major 5x5 grid for rendering / pattern checks.
 */
function toGrid(card) {
  const cols = ['B', 'I', 'N', 'G', 'O'];
  const grid = [];
  for (let row = 0; row < 5; row++) {
    grid.push(cols.map((c) => card[c][row]));
  }
  return grid;
}

/**
 * Checks whether the given set of marked numbers (plus the always-marked
 * free space) completes a standard win pattern on this card: any full row,
 * column, or either diagonal.
 */
function checkWin(card, markedNumbers) {
  const grid = toGrid(card);
  const marked = new Set(markedNumbers);
  marked.add(0); // free space always counts as marked

  const isMarked = (val) => marked.has(val);

  // rows
  for (let r = 0; r < 5; r++) {
    if (grid[r].every(isMarked)) return { won: true, pattern: `ROW_${r + 1}` };
  }
  // columns
  for (let c = 0; c < 5; c++) {
    if (grid.every((row) => isMarked(row[c]))) return { won: true, pattern: `COLUMN_${c + 1}` };
  }
  // diagonals
  if ([0, 1, 2, 3, 4].every((i) => isMarked(grid[i][i]))) return { won: true, pattern: 'DIAGONAL_TL_BR' };
  if ([0, 1, 2, 3, 4].every((i) => isMarked(grid[i][4 - i]))) return { won: true, pattern: 'DIAGONAL_TR_BL' };
  // four corners
  if ([grid[0][0], grid[0][4], grid[4][0], grid[4][4]].every(isMarked)) return { won: true, pattern: 'FOUR_CORNERS' };

  return { won: false, pattern: null };
}

/**
 * Draws the next number not yet called for a room.
 */
function drawNextNumber(alreadyCalled) {
  const called = new Set(alreadyCalled);
  const remaining = [];
  for (let n = 1; n <= 75; n++) {
    if (!called.has(n)) remaining.push(n);
  }
  if (remaining.length === 0) return null;
  return remaining[Math.floor(Math.random() * remaining.length)];
}

/**
 * Computes the virtual-credit pot for a room given entry fee, player count,
 * and the stake tier's commission percentage (PART 4 of the spec).
 */
function computePot(entryCredits, playerCount, commissionPercent) {
  const gross = entryCredits * playerCount;
  const commission = gross * (commissionPercent / 100);
  const netPot = gross - commission;
  return { gross, commission, netPot };
}

module.exports = { CARD_COUNT, CARD_POOL, getCardById, generateCard, toGrid, checkWin, drawNextNumber, computePot, COLUMN_RANGES };
