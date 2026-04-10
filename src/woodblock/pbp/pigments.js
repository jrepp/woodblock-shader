export const DEFAULT_PIGMENT_SET = Object.freeze([1, 2, 3, 4]);

export function clampPigmentId(id, max = 7) {
  const n = Number(id);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

export function normalizePigmentSet(values) {
  if (!Array.isArray(values) || values.length !== 4) return [...DEFAULT_PIGMENT_SET];
  return values.map((v) => clampPigmentId(v));
}
