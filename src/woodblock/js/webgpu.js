const state = {
  devicePromise: null,
  device: null,
  reliefPipeline: null,
  maskPipeline: null,
};

export function isWebGPUSupported() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

async function initDevice() {
  if (!isWebGPUSupported()) return null;
  if (!state.devicePromise) {
    state.devicePromise = (async () => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      state.device = device;
      return device;
    })();
  }
  return state.devicePromise;
}

function getReliefPipeline(device) {
  if (state.reliefPipeline) return state.reliefPipeline;
  const code = `
struct Params {
  dims: vec4<f32>;
  weights: vec4<f32>;
};

@group(0) @binding(0) var heightTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> edgeOut: array<u32>;
@group(0) @binding(2) var<storage, read_write> cavityOut: array<u32>;
@group(0) @binding(3) var<storage, read_write> poolingOut: array<u32>;
@group(0) @binding(4) var<storage, read_write> flowOut: array<u32>;
@group(0) @binding(5) var<uniform> params: Params;

fn clamp01(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width = i32(params.dims.x + 0.5);
  let height = i32(params.dims.y + 0.5);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width || y >= height) {
    return;
  }

  let edgeScale = params.dims.z;
  let cavityLow = params.dims.w;
  let cavityHigh = params.weights.x;
  let edgeWeight = params.weights.y;
  let cavityWeight = params.weights.z;
  let flowScale = params.weights.w;

  let x0 = max(0, x - 1);
  let x1 = min(width - 1, x + 1);
  let y0 = max(0, y - 1);
  let y1 = min(height - 1, y + 1);

  let hgt = textureLoad(heightTex, vec2<i32>(x, y), 0).r;
  let hL = textureLoad(heightTex, vec2<i32>(x0, y), 0).r;
  let hR = textureLoad(heightTex, vec2<i32>(x1, y), 0).r;
  let hD = textureLoad(heightTex, vec2<i32>(x, y0), 0).r;
  let hU = textureLoad(heightTex, vec2<i32>(x, y1), 0).r;

  let edge = min(1.0, sqrt((hR - hL) * (hR - hL) + (hU - hD) * (hU - hD)) * edgeScale);
  let t = clamp01((cavityHigh - hgt) / max(0.0001, (cavityHigh - cavityLow)));
  let cav = t * t;
  let pool = clamp01(edge * edgeWeight + cav * cavityWeight);

  var dx = (hR - hL) * flowScale;
  var dy = (hU - hD) * flowScale;
  let len = max(0.0001, sqrt(dx * dx + dy * dy));
  dx /= len;
  dy /= len;

  let idx = y * width + x;
  edgeOut[idx] = u32(clamp01(edge) * 255.0 + 0.5);
  cavityOut[idx] = u32(clamp01(cav) * 255.0 + 0.5);
  poolingOut[idx] = u32(clamp01(pool) * 255.0 + 0.5);

  let flowIdx = idx * 2;
  flowOut[flowIdx] = u32(clamp01(dx * 0.5 + 0.5) * 255.0 + 0.5);
  flowOut[flowIdx + 1] = u32(clamp01(dy * 0.5 + 0.5) * 255.0 + 0.5);
}
`;

  const module = device.createShaderModule({ code });
  state.reliefPipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module,
      entryPoint: "main",
    },
  });
  return state.reliefPipeline;
}

function getMaskPipeline(device) {
  if (state.maskPipeline) return state.maskPipeline;
  const code = `
struct Params {
  a: vec4<f32>;
  b: vec4<f32>;
  c: vec4<f32>;
};

@group(0) @binding(0) var heightTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> palette: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> outMask: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

fn clamp01(v: f32) -> f32 { return clamp(v, 0.0, 1.0); }

fn hash2(x: i32, y: i32) -> f32 {
  var n = u32(x) * 374761393u + u32(y) * 668265263u;
  n = (n ^ (n >> 13u)) * 1274126177u;
  n = n ^ (n >> 16u);
  return f32(n) / 4294967295.0;
}

fn hash2Periodic(x: i32, y: i32, period: i32) -> f32 {
  let px = ((x % period) + period) % period;
  let py = ((y % period) + period) % period;
  return hash2(px, py);
}

fn valueNoisePeriodic(x: f32, y: f32, period: i32) -> f32 {
  let xi = i32(floor(x));
  let yi = i32(floor(y));
  let xf = x - f32(xi);
  let yf = y - f32(yi);
  let v00 = hash2Periodic(xi, yi, period);
  let v10 = hash2Periodic(xi + 1, yi, period);
  let v01 = hash2Periodic(xi, yi + 1, period);
  let v11 = hash2Periodic(xi + 1, yi + 1, period);
  let u = xf * xf * (3.0 - 2.0 * xf);
  let v = yf * yf * (3.0 - 2.0 * yf);
  let a0 = mix(v00, v10, u);
  let a1 = mix(v01, v11, u);
  return mix(a0, a1, v);
}

fn fbmNoisePeriodic(u: f32, v: f32, basePeriod: f32) -> f32 {
  var amp = 0.5;
  var freq = 1.0;
  var sum = 0.0;
  for (var i = 0; i < 4; i = i + 1) {
    let period = max(1, i32(floor(basePeriod * freq + 0.5)));
    sum = sum + valueNoisePeriodic(u * f32(period), v * f32(period), period) * amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  return sum;
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
  let t = clamp01((x - a) / (b - a));
  return t * t * (3.0 - 2.0 * t);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let width = i32(params.a.x + 0.5);
  let height = i32(params.a.y + 0.5);
  let paletteCount = max(1, i32(params.a.z + 0.5));
  let edgeScale = params.a.w;
  let lowMin = params.b.x;
  let lowMax = params.b.y;
  let fillRate = params.b.z;
  let fillMix = params.b.w;
  let basePeriod = params.c.x;

  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= width || y >= height) { return; }

  let x0 = max(0, x - 1);
  let x1 = min(width - 1, x + 1);
  let y0 = max(0, y - 1);
  let y1 = min(height - 1, y + 1);

  let hgt = textureLoad(heightTex, vec2<i32>(x, y), 0).r;
  let hL = textureLoad(heightTex, vec2<i32>(x0, y), 0).r;
  let hR = textureLoad(heightTex, vec2<i32>(x1, y), 0).r;
  let hD = textureLoad(heightTex, vec2<i32>(x, y0), 0).r;
  let hU = textureLoad(heightTex, vec2<i32>(x, y1), 0).r;

  let edge = min(1.0, sqrt((hR - hL) * (hR - hL) + (hU - hD) * (hU - hD)) * edgeScale);
  let low = 1.0 - smoothstep(lowMin, lowMax, hgt);
  let lowInterior = low * (1.0 - edge);

  let u = f32(x) / f32(width);
  let v = f32(y) / f32(height);
  let noise = fbmNoisePeriodic(u, v, basePeriod);
  let allow = select(0.0, 1.0, noise < fillRate);

  let white = vec3<f32>(0.97, 0.97, 0.95);
  var color = white;

  if (lowInterior * allow > 0.5) {
    let pickNoise = fbmNoisePeriodic(u + 11.3, v + 4.7, 5.0);
    let pick = i32(floor(pickNoise * f32(paletteCount)));
    let idx = (pick % paletteCount + paletteCount) % paletteCount;
    let pal = palette[idx].xyz;
    color = mix(white, pal, fillMix);
  }

  let outIdx = (y * width + x) * 4;
  outMask[outIdx] = u32(clamp01(color.r) * 255.0 + 0.5);
  outMask[outIdx + 1] = u32(clamp01(color.g) * 255.0 + 0.5);
  outMask[outIdx + 2] = u32(clamp01(color.b) * 255.0 + 0.5);
  outMask[outIdx + 3] = 255u;
}
`;

  const module = device.createShaderModule({ code });
  state.maskPipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module,
      entryPoint: "main",
    },
  });
  return state.maskPipeline;
}

function createHeightTexture(device, heightU8, width, height) {
  const texture = device.createTexture({
    size: [width, height],
    format: "r8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  const bytesPerPixel = 1;
  const bytesPerRowUnpadded = width * bytesPerPixel;
  const align = 256;
  const bytesPerRow = Math.ceil(bytesPerRowUnpadded / align) * align;

  if (bytesPerRow === bytesPerRowUnpadded) {
    device.queue.writeTexture(
      { texture },
      heightU8,
      { bytesPerRow, rowsPerImage: height },
      { width, height }
    );
    return texture;
  }

  const padded = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    padded.set(heightU8.subarray(y * width, (y + 1) * width), y * bytesPerRow);
  }
  device.queue.writeTexture(
    { texture },
    padded,
    { bytesPerRow, rowsPerImage: height },
    { width, height }
  );
  return texture;
}

async function readBackU32(device, buffer, size) {
  const readBuffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, readBuffer, 0, size);
  device.queue.submit([encoder.finish()]);
  await readBuffer.mapAsync(GPUMapMode.READ);
  const copy = readBuffer.getMappedRange();
  const outU32 = new Uint32Array(copy.slice(0));
  readBuffer.unmap();
  readBuffer.destroy();
  return outU32;
}

export async function computeReliefMapsWebGPU(heightU8, width, height, opts = {}) {
  const device = await initDevice();
  if (!device) return null;

  const edgeScale = opts.edgeScale ?? 6.0;
  const cavityLow = opts.cavityLow ?? 0.25;
  const cavityHigh = opts.cavityHigh ?? 0.75;
  const edgeWeight = opts.edgeWeight ?? 0.6;
  const cavityWeight = opts.cavityWeight ?? 0.4;
  const flowScale = opts.flowScale ?? 1.0;

  const heightTex = createHeightTexture(device, heightU8, width, height);
  const pipeline = getReliefPipeline(device);

  const edgeBuffer = device.createBuffer({
    size: width * height * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const cavityBuffer = device.createBuffer({
    size: width * height * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const poolingBuffer = device.createBuffer({
    size: width * height * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const flowBuffer = device.createBuffer({
    size: width * height * 2 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const params = new Float32Array(8);
  params[0] = width;
  params[1] = height;
  params[2] = edgeScale;
  params[3] = cavityLow;
  params[4] = cavityHigh;
  params[5] = edgeWeight;
  params[6] = cavityWeight;
  params[7] = flowScale;

  const paramBuffer = device.createBuffer({
    size: params.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramBuffer, 0, params);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: heightTex.createView() },
      { binding: 1, resource: { buffer: edgeBuffer } },
      { binding: 2, resource: { buffer: cavityBuffer } },
      { binding: 3, resource: { buffer: poolingBuffer } },
      { binding: 4, resource: { buffer: flowBuffer } },
      { binding: 5, resource: { buffer: paramBuffer } },
    ],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();

  const edgeU32 = await readBackU32(device, edgeBuffer, width * height * 4);
  const cavityU32 = await readBackU32(device, cavityBuffer, width * height * 4);
  const poolingU32 = await readBackU32(device, poolingBuffer, width * height * 4);
  const flowU32 = await readBackU32(device, flowBuffer, width * height * 2 * 4);

  const edge = new Uint8Array(edgeU32.length);
  const cavity = new Uint8Array(cavityU32.length);
  const pooling = new Uint8Array(poolingU32.length);
  for (let i = 0; i < edge.length; i++) edge[i] = edgeU32[i] & 0xff;
  for (let i = 0; i < cavity.length; i++) cavity[i] = cavityU32[i] & 0xff;
  for (let i = 0; i < pooling.length; i++) pooling[i] = poolingU32[i] & 0xff;

  const flow = new Uint8Array(flowU32.length);
  for (let i = 0; i < flow.length; i++) flow[i] = flowU32[i] & 0xff;

  heightTex.destroy();
  edgeBuffer.destroy();
  cavityBuffer.destroy();
  poolingBuffer.destroy();
  flowBuffer.destroy();
  paramBuffer.destroy();

  return { edge, cavity, pooling, flow };
}

export async function computePigmentMaskWebGPU(heightU8, width, height, paletteLinear, opts = {}) {
  const device = await initDevice();
  if (!device) return null;

  const lowMin = opts.lowMin ?? 0.55;
  const lowMax = opts.lowMax ?? 0.8;
  const edgeScale = opts.edgeScale ?? 6.0;
  const fillRate = opts.fillRate ?? 0.25;
  const fillMix = opts.fillMix ?? 0.7;
  const basePeriod = opts.basePeriod ?? 6.0;

  const heightTex = createHeightTexture(device, heightU8, width, height);
  const pipeline = getMaskPipeline(device);

  const paletteCount = Math.max(1, paletteLinear.length);
  const paletteData = new Float32Array(paletteCount * 4);
  for (let i = 0; i < paletteCount; i++) {
    const offset = i * 4;
    paletteData[offset] = paletteLinear[i][0];
    paletteData[offset + 1] = paletteLinear[i][1];
    paletteData[offset + 2] = paletteLinear[i][2];
    paletteData[offset + 3] = 1.0;
  }
  const paletteBuffer = device.createBuffer({
    size: paletteData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paletteBuffer, 0, paletteData);

  const outBuffer = device.createBuffer({
    size: width * height * 4 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const params = new Float32Array(12);
  params[0] = width;
  params[1] = height;
  params[2] = paletteCount;
  params[3] = edgeScale;
  params[4] = lowMin;
  params[5] = lowMax;
  params[6] = fillRate;
  params[7] = fillMix;
  params[8] = basePeriod;

  const paramBuffer = device.createBuffer({
    size: params.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramBuffer, 0, params);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: heightTex.createView() },
      { binding: 1, resource: { buffer: paletteBuffer } },
      { binding: 2, resource: { buffer: outBuffer } },
      { binding: 3, resource: { buffer: paramBuffer } },
    ],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();

  const outU32 = await readBackU32(device, outBuffer, width * height * 4 * 4);
  const out = new Uint8Array(outU32.length);
  for (let i = 0; i < out.length; i++) out[i] = outU32[i] & 0xff;

  heightTex.destroy();
  paletteBuffer.destroy();
  outBuffer.destroy();
  paramBuffer.destroy();

  return out;
}
