import { clamp01, linearToSrgb, srgbToLinear } from "./math.js";
import { hash2, fbmNoisePeriodic } from "./noise.js";

export const DEFAULT_PALETTE_LINEAR = [
  [srgbToLinear(0.12), srgbToLinear(0.10), srgbToLinear(0.09)],
  [srgbToLinear(0.62), srgbToLinear(0.32), srgbToLinear(0.28)],
  [srgbToLinear(0.78), srgbToLinear(0.67), srgbToLinear(0.32)],
  [srgbToLinear(0.42), srgbToLinear(0.55), srgbToLinear(0.48)],
  [srgbToLinear(0.55), srgbToLinear(0.60), srgbToLinear(0.62)],
  [srgbToLinear(0.55), srgbToLinear(0.47), srgbToLinear(0.38)],
  [srgbToLinear(0.40), srgbToLinear(0.36), srgbToLinear(0.32)],
  [srgbToLinear(0.93), srgbToLinear(0.91), srgbToLinear(0.86)]
];

export function sampleGrid(canvas, gridSize = 60) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h).data;

  const pts = [];
  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const x = Math.min(w - 1, Math.floor((gx + 0.5) * w / gridSize));
      const y = Math.min(h - 1, Math.floor((gy + 0.5) * h / gridSize));
      const p = (y*w + x) * 4;
      const r = img[p] / 255, g = img[p+1]/255, b = img[p+2]/255;
      const maxc = Math.max(r,g,b);
      const minc = Math.min(r,g,b);
      const chroma = maxc - minc;
      if (maxc > 0.93 && chroma < 0.08) continue;
      if (maxc < 0.07 && chroma < 0.05) continue;
      pts.push({
        srgb: [r, g, b],
        lin: [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
      });
    }
  }
  return pts;
}

export function extractPaletteKMeans(canvas, k = 8, gridSize = 60, iters = 12) {
  const pts = sampleGrid(canvas, gridSize);
  if (pts.length < k) return null;

  const cent = [];
  const stride = Math.max(1, Math.floor(pts.length / k));
  for (let i = 0; i < k; i++) cent.push(pts[Math.min(i * stride, pts.length - 1)].lin.slice());
  const assign = new Uint16Array(pts.length);

  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bestD = Infinity;
      const [pr, pg, pb] = pts[i].lin;
      for (let c = 0; c < k; c++) {
        const dr = pr - cent[c][0], dg = pg - cent[c][1], db = pb - cent[c][2];
        const d = dr*dr + dg*dg + db*db;
        if (d < bestD) { bestD = d; best = c; }
      }
      assign[i] = best;
    }
    const sum = Array.from({length:k}, () => [0,0,0,0]);
    for (let i = 0; i < pts.length; i++) {
      const c = assign[i];
      sum[c][0] += pts[i].lin[0];
      sum[c][1] += pts[i].lin[1];
      sum[c][2] += pts[i].lin[2];
      sum[c][3] += 1;
    }
    for (let c = 0; c < k; c++) {
      if (sum[c][3] > 0) {
        cent[c][0] = sum[c][0] / sum[c][3];
        cent[c][1] = sum[c][1] / sum[c][3];
        cent[c][2] = sum[c][2] / sum[c][3];
      }
    }
  }
  cent.sort((a,b) => (0.2126*a[0]+0.7152*a[1]+0.0722*a[2]) - (0.2126*b[0]+0.7152*b[1]+0.0722*b[2]));
  return cent;
}

export function extractPaletteMedianCut(canvas, k = 8, gridSize = 60) {
  const pts = sampleGrid(canvas, gridSize);
  if (pts.length < k) return null;

  const boxes = [{ pts }];
  while (boxes.length < k) {
    boxes.sort((a, b) => {
      const ra = rangeOf(a.pts), rb = rangeOf(b.pts);
      return Math.max(rb.r, rb.g, rb.b) - Math.max(ra.r, ra.g, ra.b);
    });
    const box = boxes.shift();
    if (!box || box.pts.length <= 1) break;
    const r = rangeOf(box.pts);
    const channel = (r.r >= r.g && r.r >= r.b) ? 0 : (r.g >= r.b ? 1 : 2);
    box.pts.sort((p, q) => p.lin[channel] - q.lin[channel]);
    const mid = Math.floor(box.pts.length / 2);
    boxes.push({ pts: box.pts.slice(0, mid) });
    boxes.push({ pts: box.pts.slice(mid) });
  }
  const out = boxes.map((b) => averageLin(b.pts)).filter(Boolean);
  out.sort((a,b) => (0.2126*a[0]+0.7152*a[1]+0.0722*a[2]) - (0.2126*b[0]+0.7152*b[1]+0.0722*b[2]));
  return out.slice(0, k);
}

export function extractPaletteHistogram(canvas, k = 8, gridSize = 80) {
  const pts = sampleGrid(canvas, gridSize);
  if (pts.length < k) return null;
  const bins = new Map();
  const bin = (v) => Math.max(0, Math.min(31, (v * 31 + 0.5) | 0));
  for (const p of pts) {
    const r = bin(p.srgb[0]);
    const g = bin(p.srgb[1]);
    const b = bin(p.srgb[2]);
    const key = (r << 10) | (g << 5) | b;
    const entry = bins.get(key) || { count: 0, sum: [0, 0, 0] };
    entry.count += 1;
    entry.sum[0] += p.lin[0];
    entry.sum[1] += p.lin[1];
    entry.sum[2] += p.lin[2];
    bins.set(key, entry);
  }
  const top = Array.from(bins.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, k);
  const out = top.map((e) => [e.sum[0]/e.count, e.sum[1]/e.count, e.sum[2]/e.count]);
  out.sort((a,b) => (0.2126*a[0]+0.7152*a[1]+0.0722*a[2]) - (0.2126*b[0]+0.7152*b[1]+0.0722*b[2]));
  return out;
}

export function extractPaletteHueBins(canvas, k = 8, gridSize = 70, hueBins = 12) {
  const pts = sampleGrid(canvas, gridSize);
  if (pts.length < k) return null;
  const bins = Array.from({ length: hueBins }, () => ({ w: 0, sum: [0,0,0] }));
  for (const p of pts) {
    const [h, s, v] = rgbToHsv(p.srgb[0], p.srgb[1], p.srgb[2]);
    if (s < 0.15 || v < 0.1) continue;
    const idx = Math.min(hueBins - 1, Math.floor(h * hueBins));
    const w = s * v;
    bins[idx].w += w;
    bins[idx].sum[0] += p.lin[0] * w;
    bins[idx].sum[1] += p.lin[1] * w;
    bins[idx].sum[2] += p.lin[2] * w;
  }
  const top = bins
    .map((b) => b.w > 0 ? [b.sum[0]/b.w, b.sum[1]/b.w, b.sum[2]/b.w] : null)
    .filter(Boolean)
    .slice(0, k);
  if (top.length < k) {
    const fallback = extractPaletteHistogram(canvas, k, gridSize);
    return fallback;
  }
  top.sort((a,b) => (0.2126*a[0]+0.7152*a[1]+0.0722*a[2]) - (0.2126*b[0]+0.7152*b[1]+0.0722*b[2]));
  return top.slice(0, k);
}

export function clampPalette(palette, satMax = 0.5, desat = 0.1) {
  return palette.map((c) => {
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    let r = c[0], g = c[1], b = c[2];
    const maxc = Math.max(r, g, b);
    const minc = Math.min(r, g, b);
    const chroma = maxc - minc;
    const sat = maxc > 0 ? chroma / maxc : 0;
    const satScale = sat > satMax ? satMax / sat : 1.0;
    r = l + (r - l) * satScale;
    g = l + (g - l) * satScale;
    b = l + (b - l) * satScale;
    r = l + (r - l) * (1.0 - desat);
    g = l + (g - l) * (1.0 - desat);
    b = l + (b - l) * (1.0 - desat);
    return [r, g, b];
  });
}

export function paletteTextureFromLinear(paletteLinear) {
  const w = paletteLinear.length;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = 1;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, 1);
  for (let i = 0; i < w; i++) {
    const r = clamp01(linearToSrgb(paletteLinear[i][0]));
    const g = clamp01(linearToSrgb(paletteLinear[i][1]));
    const b = clamp01(linearToSrgb(paletteLinear[i][2]));
    const o = i * 4;
    img.data[o + 0] = Math.round(r * 255);
    img.data[o + 1] = Math.round(g * 255);
    img.data[o + 2] = Math.round(b * 255);
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function floodFillWhiteWithPalette(canvas, paletteLinear, tileSize = 24) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  const fillRate = 0.22 + 0.08 * hash2(w, h);
  const cols = Math.ceil(w / tileSize);
  const rows = Math.ceil(h / tileSize);

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = tx * tileSize;
      const y0 = ty * tileSize;
      const x1 = Math.min(w, x0 + tileSize);
      const y1 = Math.min(h, y0 + tileSize);

      let whiteCount = 0;
      let total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * w + x) * 4;
          const r = data[p] / 255, g = data[p + 1] / 255, b = data[p + 2] / 255;
          const maxc = Math.max(r, g, b);
          const minc = Math.min(r, g, b);
          const chroma = maxc - minc;
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (l > 0.88 && chroma < 0.08) whiteCount++;
          total++;
        }
      }
      if (whiteCount / Math.max(1, total) < 0.9) continue;
      if (hash2(tx, ty) >= fillRate) continue;

      const pick = Math.floor(hash2(tx + 13, ty + 7) * paletteLinear.length);
      const lin = paletteLinear[pick % paletteLinear.length];
      const rFill = clamp01(linearToSrgb(lin[0]));
      const gFill = clamp01(linearToSrgb(lin[1]));
      const bFill = clamp01(linearToSrgb(lin[2]));
      const alpha = 0.35;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * w + x) * 4;
          data[p + 0] = Math.round(data[p + 0] * (1 - alpha) + rFill * 255 * alpha);
          data[p + 1] = Math.round(data[p + 1] * (1 - alpha) + gFill * 255 * alpha);
          data[p + 2] = Math.round(data[p + 2] * (1 - alpha) + bFill * 255 * alpha);
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0);
}

export function pigmentMaskFromHeight(heightU8, w, h, paletteLinear) {
  const mask = document.createElement("canvas");
  mask.width = w;
  mask.height = h;
  const ctx = mask.getContext("2d", { willReadFrequently: true });
  const img = ctx.createImageData(w, h);
  const data = img.data;

  const fillRate = 0.22 + 0.08 * hash2(w, h);
  const white = [0.97, 0.97, 0.95];
  const fillMix = 0.7;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const hgt = heightU8[p] / 255;
      const hL = heightU8[y * w + Math.max(0, x - 1)] / 255;
      const hR = heightU8[y * w + Math.min(w - 1, x + 1)] / 255;
      const hD = heightU8[Math.max(0, y - 1) * w + x] / 255;
      const hU = heightU8[Math.min(h - 1, y + 1) * w + x] / 255;
      const edge = Math.min(1.0, Math.hypot(hR - hL, hU - hD) * 6.0);
      const low = 1.0 - smoothstep(0.45, 0.7, hgt);
      const lowInterior = low * (1.0 - edge);
      const u = x / w;
      const v = y / h;
      const noise = fbmNoisePeriodic(u, v, 6.0);
      const allow = (noise < fillRate) ? 1.0 : 0.0;

      let r = white[0], g = white[1], b = white[2];
      if (lowInterior * allow > 0.5) {
        const pick = Math.floor(fbmNoisePeriodic(u + 11.3, v + 4.7, 5.0) * paletteLinear.length);
        const lin = paletteLinear[pick % paletteLinear.length];
        const sr = lin[0], sg = lin[1], sb = lin[2];
        r = white[0] * (1 - fillMix) + sr * fillMix;
        g = white[1] * (1 - fillMix) + sg * fillMix;
        b = white[2] * (1 - fillMix) + sb * fillMix;
      }

      const o = p * 4;
      data[o + 0] = Math.round(clamp01(r) * 255);
      data[o + 1] = Math.round(clamp01(g) * 255);
      data[o + 2] = Math.round(clamp01(b) * 255);
      data[o + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return mask;
}

export function renderPaletteSwatches(labelText, paletteLinear) {
  const el = document.getElementById("palettes");
  const row = document.createElement("div");
  row.className = "palette-block";
  const label = document.createElement("div");
  label.className = "palette-label";
  label.textContent = labelText;
  row.appendChild(label);

  for (const cLin of paletteLinear) {
    const r = clamp01(linearToSrgb(cLin[0]));
    const g = clamp01(linearToSrgb(cLin[1]));
    const b = clamp01(linearToSrgb(cLin[2]));
    const sw = document.createElement("div");
    sw.className = "swatch";
    sw.style.background = `rgb(${(r*255)|0}, ${(g*255)|0}, ${(b*255)|0})`;
    row.appendChild(sw);
  }
  el.appendChild(row);
}

function rangeOf(pts) {
  let rMin = 1, rMax = 0, gMin = 1, gMax = 0, bMin = 1, bMax = 0;
  for (const p of pts) {
    const [r,g,b] = p.lin;
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  return { r: rMax - rMin, g: gMax - gMin, b: bMax - bMin };
}

function averageLin(pts) {
  if (!pts.length) return null;
  let r = 0, g = 0, b = 0;
  for (const p of pts) { r += p.lin[0]; g += p.lin[1]; b += p.lin[2]; }
  const inv = 1 / pts.length;
  return [r*inv, g*inv, b*inv];
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}
