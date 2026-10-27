/**
 * Shows only the first 3 letters of a username: "yirga07" -> "yir****".
 * Names shorter than 4 letters show 1 letter ("abc" -> "a**").
 */
function maskName(name) {
  const chars = [...String(name || 'player').replace(/^@/, '')];
  const visible = chars.length >= 4 ? 3 : chars.length >= 2 ? 1 : 0;
  return chars.slice(0, visible).join('') + '*'.repeat(chars.length - visible);
}

module.exports = { maskName };
