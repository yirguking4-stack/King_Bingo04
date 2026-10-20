/**
 * Hides half of a username for other players' safety: "yirga07" -> "yir****".
 * The full name never leaves the server in chat or the appointment box.
 */
function maskName(name) {
  const chars = [...String(name || 'player')];
  if (chars.length <= 1) return `${chars[0] || 'p'}*`;
  const visible = Math.max(1, Math.floor(chars.length / 2));
  return chars.slice(0, visible).join('') + '*'.repeat(chars.length - visible);
}

module.exports = { maskName };
