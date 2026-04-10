export function normalizeRegion(region, width, height) {
  if (!region) return { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
  return {
    x0: Math.max(0, Math.min(width - 1, region.x0)),
    y0: Math.max(0, Math.min(height - 1, region.y0)),
    x1: Math.max(0, Math.min(width - 1, region.x1)),
    y1: Math.max(0, Math.min(height - 1, region.y1)),
  };
}

export function writePbpTexA(buffers, out, width, height, region) {
  const { coverage, water, mass, edgePool } = buffers;
  const r = normalizeRegion(region, width, height);
  for (let y = r.y0; y <= r.y1; y += 1) {
    const row = y * width;
    for (let x = r.x0; x <= r.x1; x += 1) {
      const i = row + x;
      const o = i * 4;
      out[o] = coverage[i];
      out[o + 1] = water[i];
      out[o + 2] = mass[i];
      out[o + 3] = edgePool[i];
    }
  }
}

export function writePbpTexB(buffers, out, width, height, region) {
  const { stain, pigmentId } = buffers;
  const r = normalizeRegion(region, width, height);
  for (let y = r.y0; y <= r.y1; y += 1) {
    const row = y * width;
    for (let x = r.x0; x <= r.x1; x += 1) {
      const i = row + x;
      const o = i * 4;
      out[o] = stain[i];
      out[o + 1] = pigmentId[i];
      out[o + 2] = 0;
      out[o + 3] = 255;
    }
  }
}

export function writePbpTexC(buffers, out, width, height, region) {
  const { pigmentMix } = buffers;
  if (!pigmentMix) return;
  const r = normalizeRegion(region, width, height);
  for (let y = r.y0; y <= r.y1; y += 1) {
    const row = y * width;
    for (let x = r.x0; x <= r.x1; x += 1) {
      const i = row + x;
      const o = i * 4;
      const mixBase = i * 4;
      out[o] = pigmentMix[mixBase];
      out[o + 1] = pigmentMix[mixBase + 1];
      out[o + 2] = pigmentMix[mixBase + 2];
      out[o + 3] = pigmentMix[mixBase + 3];
    }
  }
}

export function writePbpTextures(buffers, outA, outB, outC, width, height, region) {
  writePbpTexA(buffers, outA, width, height, region);
  writePbpTexB(buffers, outB, width, height, region);
  if (outC) writePbpTexC(buffers, outC, width, height, region);
}
