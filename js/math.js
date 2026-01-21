export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const lerp = (a, b, t) => a + (b - a) * t;

export function srgbToLinear(c) {
  return (c <= 0.04045) ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c) {
  return (c <= 0.0031308) ? c * 12.92 : 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
}
