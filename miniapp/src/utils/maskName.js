/**
 * Hides half of a username for safety: "yirga07" -> "yir****".
 * Safe to call on names that are already masked (they are returned unchanged).
 */
export function maskName(name) {
  const raw = String(name || 'player').replace(/^@/, '');
  if (raw.includes('*')) return raw;
  const chars = [...raw];
  const visible = chars.length >= 4 ? 3 : chars.length >= 2 ? 1 : 0;
  return chars.slice(0, visible).join('') + '*'.repeat(chars.length - visible);
}
