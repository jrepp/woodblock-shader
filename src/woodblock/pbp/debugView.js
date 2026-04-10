export function summarizeBuffer(buf) {
  let min = 255;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = buf[i];
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
  }
  return { min, max, avg: sum / buf.length };
}

export function summarizeBuffers(buffers) {
  return Object.fromEntries(
    Object.entries(buffers).map(([key, buf]) => [key, summarizeBuffer(buf)])
  );
}
