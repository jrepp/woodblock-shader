import { lerp } from "./math.js";

export function hash2(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return (n >>> 0) / 4294967295;
}

export function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function fbmNoise(x, y) {
  let amp = 0.5, freq = 1.0, sum = 0.0;
  for (let i = 0; i < 4; i++) {
    const xi = Math.floor(x * freq), yi = Math.floor(y * freq);
    const xf = x * freq - xi, yf = y * freq - yi;
    const v00 = hash2(xi, yi);
    const v10 = hash2(xi + 1, yi);
    const v01 = hash2(xi, yi + 1);
    const v11 = hash2(xi + 1, yi + 1);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a0 = lerp(v00, v10, u);
    const a1 = lerp(v01, v11, u);
    sum += lerp(a0, a1, v) * amp;
    amp *= 0.5; freq *= 2.0;
  }
  return sum;
}

export function hash2Periodic(x, y, period) {
  const px = ((x % period) + period) % period;
  const py = ((y % period) + period) % period;
  let n = px * 374761393 + py * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return (n >>> 0) / 4294967295;
}

export function valueNoisePeriodic(x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const v00 = hash2Periodic(xi, yi, period);
  const v10 = hash2Periodic(xi + 1, yi, period);
  const v01 = hash2Periodic(xi, yi + 1, period);
  const v11 = hash2Periodic(xi + 1, yi + 1, period);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a0 = lerp(v00, v10, u);
  const a1 = lerp(v01, v11, u);
  return lerp(a0, a1, v);
}

export function fbmNoisePeriodic(u, v, basePeriod) {
  let amp = 0.5, freq = 1.0, sum = 0.0;
  for (let i = 0; i < 4; i++) {
    const period = Math.max(1, Math.round(basePeriod * freq));
    sum += valueNoisePeriodic(u * period, v * period, period) * amp;
    amp *= 0.5; freq *= 2.0;
  }
  return sum;
}
