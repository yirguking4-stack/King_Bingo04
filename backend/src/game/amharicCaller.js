// ============================================================================
// Amharic number caller for KING BINGO
// Letters (B, I, N, G, O) stay in English; numbers are spoken in Amharic.
// ============================================================================

const UNITS = ['', 'አንድ', 'ሁለት', 'ሦስት', 'አራት', 'አምስት', 'ስድስት', 'ሰባት', 'ስምንት', 'ዘጠኝ'];
const TEEN_PREFIX = 'አስራ'; // "ten-and-"
const TENS = {
  10: 'አስር',
  20: 'ሃያ',
  30: 'ሠላሳ',
  40: 'አርባ',
  50: 'ሃምሳ',
  60: 'ስድሳ',
  70: 'ሰባ',
};

function amharicNumberWord(n) {
  if (n < 1 || n > 75) throw new Error(`Number ${n} out of Bingo range (1-75)`);
  if (n <= 9) return UNITS[n];
  if (n === 10) return TENS[10];
  if (n > 10 && n < 20) return `${TEEN_PREFIX} ${UNITS[n - 10]}`;

  const tensPlace = Math.floor(n / 10) * 10;
  const unitsPlace = n % 10;
  if (unitsPlace === 0) return TENS[tensPlace];
  return `${TENS[tensPlace]} ${UNITS[unitsPlace]}`;
}

// BINGO letter ranges (standard 75-ball bingo)
function letterForNumber(n) {
  if (n >= 1 && n <= 15) return 'B';
  if (n >= 16 && n <= 30) return 'I';
  if (n >= 31 && n <= 45) return 'N';
  if (n >= 46 && n <= 60) return 'G';
  if (n >= 61 && n <= 75) return 'O';
  throw new Error(`Number ${n} out of range`);
}

/**
 * Builds the full call payload for a drawn number: the English letter,
 * the Amharic spoken number, and a combined display/speech string.
 */
function buildCall(number) {
  const letter = letterForNumber(number);
  const spokenNumber = amharicNumberWord(number);
  return {
    number,
    letter,
    spokenNumber,
    displayText: `${letter}-${number}`,
    speechText: `${letter}: ${spokenNumber}`,
  };
}

module.exports = { amharicNumberWord, letterForNumber, buildCall };
