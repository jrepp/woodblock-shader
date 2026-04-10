export const BRUSH_INPUT_DEFAULTS = Object.freeze({
  pressureCurve: 1.3,
  spacingRatio: 0.35,
  maxSpacingRatio: 0.6,
});

export function applyPressureCurve(pressure, curve = BRUSH_INPUT_DEFAULTS.pressureCurve) {
  const p = Math.max(0, Math.min(1, Number(pressure) || 0));
  return Math.pow(p, curve);
}

export function computeSpacingPx(radiusPx, spacingRatio = BRUSH_INPUT_DEFAULTS.spacingRatio, maxSpacingRatio = BRUSH_INPUT_DEFAULTS.maxSpacingRatio) {
  const spacing = Math.max(1, Math.floor(radiusPx * spacingRatio));
  const maxSpacing = Math.max(1, Math.floor(radiusPx * maxSpacingRatio));
  return Math.min(spacing, maxSpacing);
}
