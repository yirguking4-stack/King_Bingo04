/**
 * Only the first half of a username is shown, the rest is masked:
 * "Yirgalem" -> "Yirg****", "abc" -> "a**", "ab" -> "a*".
 * Same rule as the backend, so masking twice gives the same result.
 */
export function maskUsername(name) {
  const chars = [...String(name || '').replace(/^@/, '')];
  if (chars.length === 0) return '***';
  const visible = Math.floor(chars.length / 2);
  return chars.slice(0, visible).join('') + '*'.repeat(chars.length - visible);
}
