export function percentNonZero(buf) {
  if (!buf || !buf.length) return 0;
  let count = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] > 0) count += 1;
  }
  return (count / buf.length) * 100;
}

export function createBuffersView(buffers) {
  const metrics = {
    coveragePct: percentNonZero(buffers.coverage),
    waterPct: percentNonZero(buffers.water),
    massPct: percentNonZero(buffers.mass),
    stainPct: percentNonZero(buffers.stain),
    edgePoolPct: percentNonZero(buffers.edgePool),
  };
  if (buffers.pigmentMix) {
    metrics.mixPct = percentNonZero(buffers.pigmentMix);
  }
  return { metrics };
}
