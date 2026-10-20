/**
 * Hides half of a username for safety: "yirga07" -> "yir****".
 * Safe to call on names that are already masked (they are returned unchanged).
 */
export function maskName(name) {
  const raw = String(name || 'player');
  if (raw.includes('*')) return raw;
  const chars = [...raw];
  if (chars.length <= 1) return `${chars[0] || 'p'}*`;
  const visible = Math.max(1, Math.floor(chars.length / 2));
  return chars.slice(0, visible).join('') + '*'.repeat(chars.length - visible);
}
