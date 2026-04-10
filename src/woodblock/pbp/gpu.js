import { PbpEngine } from "./engine.js";
import { PBP_TOOL_DEFAULTS } from "./types.js";
import { PBP_STEP_DEFAULTS, normalizePigmentSet } from "./settings.js";

const PBP_FIELDS = ["pigmentId", "coverage", "water", "mass", "edgePool", "stain"];
const TEX_A_CHANNELS = ["coverage", "water", "mass", "edgePool"];
const TEX_B_CHANNELS = ["stain", "pigmentId"];

function align4(value) {
  return (value + 3) & ~3;
}

function align256(value) {
  return (value + 255) & ~255;
}

export class PbpGpuSystem {
  constructor({
    canvas,
    width,
    height,
    useCpuReference = true,
    computeEnabled = false,
    onError = null,
  }) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.device = null;
    this.queue = null;
    this._onError = typeof onError === "function" ? onError : null;
    this.cpu = new PbpEngine({ width, height });
    this.buffers = {};
    this.textures = null;
    this._uploadStaging = {};
    this._byteSize = align4(width * height);
    this._pixelCount = width * height;
    this._useCpuReference = useCpuReference;
    this._computeEnabled = computeEnabled;
    this.computeEnabled = computeEnabled;
    this._bytesPerRow = align256(width * 4);
    this._paddedSize = this._bytesPerRow * height;
    this._packedA = new Uint8Array(this._pixelCount * 4);
    this._packedB = new Uint8Array(this._pixelCount * 4);
    this._packedC = new Uint8Array(this._pixelCount * 4);
    this._uploadA = new Uint8Array(this._paddedSize);
    this._uploadB = new Uint8Array(this._paddedSize);
    this._uploadC = new Uint8Array(this._paddedSize);
    this._zeroA = new Uint8Array(this._paddedSize);
    this._zeroB = new Uint8Array(this._paddedSize);
    this._zeroC = new Uint8Array(this._paddedSize);
    this._grayPacked = new Uint8Array(this._pixelCount * 4);
    this._grayUpload = new Uint8Array(this._paddedSize);
    this._pipelines = null;
    this._paramsBuffer = null;
    this._pingIsA = true;
    this.inputs = null;
  }

  async init() {
    if (!navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;
    const device = await adapter.requestDevice();
    this.device = device;
    this.queue = device.queue;
    this.device.addEventListener("uncapturederror", (event) => {
      const msg = event?.error?.message || event?.error || "Unknown WebGPU error";
      if (this._onError) {
        this._onError(`WebGPU error: ${msg}`);
      } else {
        console.error("WebGPU error:", msg);
      }
    });

    for (const name of PBP_FIELDS) {
      const gpu = device.createBuffer({
        label: `pbp-${name}`,
        size: this._byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      this.buffers[name] = { gpu };
      this._uploadStaging[name] = new Uint8Array(this._byteSize);
    }

    this.textures = this._createPbpTextures();
    this._createPipelines();
    await this._uploadAll();
    return true;
  }

  async stamp({
    uv,
    brushType,
    pressure,
    pigmentId,
    edgeSoftness,
    heightU8,
    edgeU8,
    grainU8,
    grainSize,
    stepParams,
  }) {
    const tool = PBP_TOOL_DEFAULTS[brushType] ?? PBP_TOOL_DEFAULTS.Daubing;
    if (!this._computeEnabled || this._useCpuReference) {
      this.cpu.stamp({
        uv,
        brushType,
        pressure,
        pigmentId,
        heightU8,
        edgeTex: edgeU8,
        grainTex: grainU8,
        grainSize,
      });
      await this._uploadAll();
      return;
    }
    if (brushType === "Smudge") {
      const readback = await this.readback();
      if (readback) {
        for (const name of PBP_FIELDS) {
          const src = readback[name];
          if (src && this.cpu.buffers[name]) {
            this.cpu.buffers[name].set(src);
          }
        }
        if (readback.pigmentMix && this.cpu.buffers.pigmentMix) {
          this.cpu.buffers.pigmentMix.set(readback.pigmentMix);
        }
      }
      this.cpu.stamp({
        uv,
        brushType,
        pressure,
        pigmentId,
        heightU8,
        edgeTex: edgeU8,
        grainTex: grainU8,
        grainSize,
      });
      await this._uploadAll();
      return;
    }
    if (!this._pipelines) return;
    this._ensureInputTextures({ heightU8, edgeU8, grainU8 });
    const load = Math.max(0, Math.min(1, this.cpu.toolState?.load ?? 1));
    this._writeParams({
      centerX: Math.floor(uv.x * this.width),
      centerY: Math.floor((1 - uv.y) * this.height),
      radius: Math.max(1, Math.floor((tool.radius ?? 0.06) * Math.min(this.width, this.height))),
      pressure: pressure ?? 1,
      pigmentId: pigmentId ?? this.cpu.toolState?.pigmentId ?? 1,
      edgeSoftness: edgeSoftness ?? tool.edgeSoftness,
      baseDeposit: tool.baseDeposit ?? 0.4,
      load,
      stepParams,
    });
    await this._runCompute(this._pipelines.stamp);
    this._swap();
    if (tool.loadDecay != null) {
      this.cpu.toolState.load = Math.max(0, load - tool.loadDecay);
    }
  }

  async step({ count = 1, heightU8, edgeU8, grainU8, grainSize, stepParams }) {
    if (!this._computeEnabled || this._useCpuReference) {
      for (let i = 0; i < count; i += 1) {
        this.cpu.step({
          heightU8,
          edgeTex: edgeU8,
          grainTex: grainU8,
          grainSize,
          ...(stepParams ?? {}),
        });
      }
      await this._uploadAll();
      return;
    }
    if (!this._pipelines) return;
    this._ensureInputTextures({ heightU8, edgeU8, grainU8 });
    for (let i = 0; i < count; i += 1) {
      this._writeParams({
        centerX: 0,
        centerY: 0,
        radius: 0,
        pressure: 0,
        pigmentId: 0,
        stepParams,
      });
      await this._runCompute(this._pipelines.step);
      this._swap();
    }
  }

  async clear() {
    this.cpu = new PbpEngine({ width: this.width, height: this.height });
    if (!this._computeEnabled || this._useCpuReference) {
      await this._uploadAll();
      return;
    }
    if (!this.textures) return;
    const layout = { bytesPerRow: this._bytesPerRow, rowsPerImage: this.height };
    const size = { width: this.width, height: this.height, depthOrArrayLayers: 1 };
    this.queue.writeTexture({ texture: this.textures.pingA }, this._zeroA, layout, size);
    this.queue.writeTexture({ texture: this.textures.pingB }, this._zeroB, layout, size);
    this.queue.writeTexture({ texture: this.textures.pingC }, this._zeroC, layout, size);
    this.queue.writeTexture({ texture: this.textures.pongA }, this._zeroA, layout, size);
    this.queue.writeTexture({ texture: this.textures.pongB }, this._zeroB, layout, size);
    this.queue.writeTexture({ texture: this.textures.pongC }, this._zeroC, layout, size);
  }

  async floodFillSeed({ heightU8, edgeU8, grainU8, grainSize, lowMin, lowMax, pigmentId }) {
    if (!this._computeEnabled || this._useCpuReference) {
      if (pigmentId != null) this.cpu.setPigmentId(pigmentId);
      this.cpu.autoFillSeed({
        heightU8,
        edgeU8,
        grainU8,
        grainSize,
        lowMin,
        lowMax,
      });
      await this._uploadAll();
      return;
    }
    if (!this._pipelines) return;
    this._ensureInputTextures({ heightU8, edgeU8, grainU8 });
    this._writeParams({
      centerX: 0,
      centerY: 0,
      radius: 0,
      pressure: 0,
      pigmentId: pigmentId ?? 1,
      lowMin,
      lowMax,
    });
    await this._runCompute(this._pipelines.seed);
    this._swap();
  }

  async readback() {
    if (!this.device) return null;
    if (!this.textures) return null;

    const encoder = this.device.createCommandEncoder({ label: "pbp-readback" });
    const ping = this._currentPing();
    encoder.copyTextureToBuffer(
      { texture: ping.a },
      { buffer: this.textures.readA, bytesPerRow: this._bytesPerRow, rowsPerImage: this.height },
      { width: this.width, height: this.height, depthOrArrayLayers: 1 }
    );
    encoder.copyTextureToBuffer(
      { texture: ping.b },
      { buffer: this.textures.readB, bytesPerRow: this._bytesPerRow, rowsPerImage: this.height },
      { width: this.width, height: this.height, depthOrArrayLayers: 1 }
    );
    encoder.copyTextureToBuffer(
      { texture: ping.c },
      { buffer: this.textures.readC, bytesPerRow: this._bytesPerRow, rowsPerImage: this.height },
      { width: this.width, height: this.height, depthOrArrayLayers: 1 }
    );
    this.queue.submit([encoder.finish()]);

    await this.textures.readA.mapAsync(GPUMapMode.READ);
    await this.textures.readB.mapAsync(GPUMapMode.READ);
    await this.textures.readC.mapAsync(GPUMapMode.READ);

    const mappedA = new Uint8Array(this.textures.readA.getMappedRange());
    const mappedB = new Uint8Array(this.textures.readB.getMappedRange());
    const mappedC = new Uint8Array(this.textures.readC.getMappedRange());
    const results = this._unpackTextures(mappedA, mappedB, mappedC);

    this.textures.readA.unmap();
    this.textures.readB.unmap();
    this.textures.readC.unmap();
    return results;
  }

  async _uploadAll() {
    if (!this.device) return;
    for (const name of PBP_FIELDS) {
      const src = this.cpu.buffers[name];
      const staging = this._uploadStaging[name];
      staging.fill(0);
      staging.set(src);
      this.queue.writeBuffer(this.buffers[name].gpu, 0, staging, 0, staging.byteLength);
    }
    this._packFromCpu();
    this._writeTextures();
  }

  _createPipelines() {
    const code = `
struct Params {
  dims: vec4<f32>,
  center: vec4<f32>,
  stamp: vec4<f32>,
  relief: vec4<f32>,
  stepA: vec4<f32>,
  stepB: vec4<f32>,
  pigmentSet: vec4<f32>,
  stepC: vec4<f32>,
  stepD: vec4<f32>,
};

@group(0) @binding(0) var pingA: texture_2d<f32>;
@group(0) @binding(1) var pingB: texture_2d<f32>;
@group(0) @binding(2) var pingC: texture_2d<f32>;
@group(0) @binding(3) var pongA: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var pongB: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(5) var pongC: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(6) var heightTex: texture_2d<f32>;
@group(0) @binding(7) var edgeTex: texture_2d<f32>;
@group(0) @binding(8) var grainTex: texture_2d<f32>;
@group(0) @binding(9) var<uniform> params: Params;

fn clamp01(v: f32) -> f32 { return clamp(v, 0.0, 1.0); }
fn clamp01v(v: vec4<f32>) -> vec4<f32> { return clamp(v, vec4f(0.0), vec4f(1.0)); }
fn quantize(v: f32) -> f32 { return floor(clamp01(v) * 255.0) / 255.0; }
fn quantizeRound(v: f32) -> f32 { return floor(clamp01(v) * 255.0 + 0.5) / 255.0; }
fn quantizev(v: vec4<f32>) -> vec4<f32> {
  return vec4f(quantize(v.x), quantize(v.y), quantize(v.z), quantize(v.w));
}

fn quantizevRound(v: vec4<f32>) -> vec4<f32> {
  return vec4f(quantizeRound(v.x), quantizeRound(v.y), quantizeRound(v.z), quantizeRound(v.w));
}

@compute @workgroup_size(8, 8, 1)
fn stamp(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  let width = i32(params.dims.x);
  let height = i32(params.dims.y);
  if (x >= width || y >= height) { return; }

  let pos = vec2<i32>(x, y);
  let currA = textureLoad(pingA, pos, 0);
  let currB = textureLoad(pingB, pos, 0);
  let currC = textureLoad(pingC, pos, 0);
  // Keep binding layout stable across pipelines.
  _ = textureLoad(heightTex, pos, 0);

  let dx = f32(x) - params.center.x;
  let dy = f32(y) - params.center.y;
  let distSq = dx * dx + dy * dy;
  let radius = params.stamp.x;
  let pressure = params.stamp.y;
  let pigmentId = params.stamp.z;
  let load = params.stamp.w;
  let edgeSoft = params.stepB.w;
  if (distSq > radius * radius) {
    textureStore(pongA, pos, currA);
    textureStore(pongB, pos, currB);
    textureStore(pongC, pos, currC);
    return;
  }
  let dist = sqrt(distSq);
  let t = clamp01(1.0 - dist / max(1.0, radius));
  let falloff = pow(t, edgeSoft);

  let h = textureLoad(heightTex, pos, 0).r;
  let lowMin = params.relief.x;
  let lowMax = params.relief.y;
  let reliefBias = params.relief.z;
  let baseDeposit = params.relief.w;
  let inv = 1.0 / max(0.001, lowMax - lowMin);
  let relief = clamp01((lowMax - h) * inv);
  let ridge = textureLoad(edgeTex, pos, 0).r;
  let grain = textureLoad(grainTex, pos, 0).r;

  let topo = clamp(0.35 + relief * 0.9 * reliefBias - ridge * 0.4, 0.1, 1.4);
  let deposit = baseDeposit * falloff * pressure * load * topo * (0.85 + grain * 0.3);

  let addCoverage = deposit;
  let addMass = deposit * (200.0 / 255.0);
  let addWater = deposit * (120.0 / 255.0);
  let addEdge = ridge * 30.0 * deposit / 255.0;
  let addA = vec4<f32>(addCoverage, addWater, addMass, addEdge);
  let stainSeed = params.stepC.y;
  let addB = vec4<f32>(deposit * stainSeed, 0.0, 0.0, 0.0);
  let nextA = quantizev(currA + addA);
  let pid = clamp01(pigmentId / 255.0);
  var slot = 0u;
  if (abs(params.pigmentSet.y - pigmentId) < 0.5) { slot = 1u; }
  if (abs(params.pigmentSet.z - pigmentId) < 0.5) { slot = 2u; }
  if (abs(params.pigmentSet.w - pigmentId) < 0.5) { slot = 3u; }
  var addMix = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  let addWeight = max(0.0, deposit);
  if (slot == 0u) { addMix.x = addWeight; }
  if (slot == 1u) { addMix.y = addWeight; }
  if (slot == 2u) { addMix.z = addWeight; }
  if (slot == 3u) { addMix.w = addWeight; }
  var nextMix = min(currC + addMix, vec4<f32>(1.0));
  let sumMix = nextMix.x + nextMix.y + nextMix.z + nextMix.w;
  if (sumMix > 1.0) {
    nextMix = nextMix / sumMix;
  }
  let nextC = quantizevRound(nextMix);
  let nextB = vec4<f32>(
    quantize(currB.x + addB.x),
    quantizeRound(pid),
    0.0,
    1.0
  );

  textureStore(pongA, pos, nextA);
  textureStore(pongB, pos, nextB);
  textureStore(pongC, pos, nextC);
}

@compute @workgroup_size(8, 8, 1)
fn step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  let width = i32(params.dims.x);
  let height = i32(params.dims.y);
  if (x >= width || y >= height) { return; }
  if (x == 0 || y == 0 || x == width - 1 || y == height - 1) {
    let posEdge = vec2<i32>(x, y);
    textureStore(pongA, posEdge, textureLoad(pingA, posEdge, 0));
    textureStore(pongB, posEdge, textureLoad(pingB, posEdge, 0));
    textureStore(pongC, posEdge, textureLoad(pingC, posEdge, 0));
    return;
  }
  let pos = vec2<i32>(x, y);
  let currA = textureLoad(pingA, pos, 0);
  let currB = textureLoad(pingB, pos, 0);
  let currC = textureLoad(pingC, pos, 0);

  let absorbency = params.stepA.x;
  let capillary = params.stepA.y;
  let poolingBias = params.stepA.z;
  let stainRate = params.stepA.w;
  let dryingRate = params.stepB.x;
  let massRetention = params.stepB.y;
  let grainInfluence = params.stepB.z;
  let ambientMoisture = params.stepC.x;
  let heightInfluence = params.stepC.z;
  let edgeBarrier = params.stepC.w;
  let valleyBias = params.stepD.x;

  let w = currA.y;
  let m = currA.z;
  let grain = textureLoad(grainTex, pos, 0).r;
  let h = textureLoad(heightTex, pos, 0).r;
  let relief = 1.0 - h;
  var spread = w * absorbency * capillary * (0.85 + grain * grainInfluence);
  let ridge = textureLoad(edgeTex, pos, 0).r;
  if (edgeBarrier > 0.0) {
    spread = spread * (1.0 + ridge * edgeBarrier);
  }
  if (heightInfluence > 0.0) {
    spread = spread * (0.6 + relief * heightInfluence);
  }

  let posN = vec2<i32>(x, y - 1);
  let posS = vec2<i32>(x, y + 1);
  let posW = vec2<i32>(x - 1, y);
  let posE = vec2<i32>(x + 1, y);
  let mN = textureLoad(pingA, posN, 0).z;
  let mS = textureLoad(pingA, posS, 0).z;
  let mW = textureLoad(pingA, posW, 0).z;
  let mE = textureLoad(pingA, posE, 0).z;

  var wN = 1.0;
  var wS = 1.0;
  var wW = 1.0;
  var wE = 1.0;
  if (grainInfluence > 0.0) {
    let gN = textureLoad(grainTex, posN, 0).r;
    let gS = textureLoad(grainTex, posS, 0).r;
    let gW = textureLoad(grainTex, posW, 0).r;
    let gE = textureLoad(grainTex, posE, 0).r;
    let bias = grainInfluence;
    wN = clamp(1.0 + (gN - grain) * bias, 0.2, 1.8);
    wS = clamp(1.0 + (gS - grain) * bias, 0.2, 1.8);
    wW = clamp(1.0 + (gW - grain) * bias, 0.2, 1.8);
    wE = clamp(1.0 + (gE - grain) * bias, 0.2, 1.8);
  }
  if (heightInfluence > 0.0) {
    let hC = textureLoad(heightTex, pos, 0).r;
    let hN = textureLoad(heightTex, posN, 0).r;
    let hS = textureLoad(heightTex, posS, 0).r;
    let hW = textureLoad(heightTex, posW, 0).r;
    let hE = textureLoad(heightTex, posE, 0).r;
    let slopeScale = heightInfluence * 1.5;
    let sN = clamp((hC - hN) * slopeScale, -0.7, 0.7);
    let sS = clamp((hC - hS) * slopeScale, -0.7, 0.7);
    let sW = clamp((hC - hW) * slopeScale, -0.7, 0.7);
    let sE = clamp((hC - hE) * slopeScale, -0.7, 0.7);
    wN = clamp(wN * (1.0 + sN), 0.1, 2.2);
    wS = clamp(wS * (1.0 + sS), 0.1, 2.2);
    wW = clamp(wW * (1.0 + sW), 0.1, 2.2);
    wE = clamp(wE * (1.0 + sE), 0.1, 2.2);
  }
  let wSum = wN + wS + wW + wE;
  let norm = select(0.25, 1.0 / wSum, wSum > 0.0);
  var total = m;
  let dmN = mN * spread * wN * norm;
  let dmS = mS * spread * wS * norm;
  let dmW = mW * spread * wW * norm;
  let dmE = mE * spread * wE * norm;
  total += dmN + dmS + dmW + dmE;

  let pooled = ridge * m;
  let pooledMass = pooled * poolingBias + relief * m * valleyBias;
  let nextEdge = quantize(currA.w + pooled * poolingBias);

  let stainAdd = m * absorbency * stainRate;
  let nextStain = quantize(currB.x + stainAdd);
  let nextMass = quantize((total + pooledMass) * massRetention);
  let nextWater = quantize(max(ambientMoisture, w - dryingRate));

  let nextA = vec4<f32>(quantize(currA.x), nextWater, nextMass, nextEdge);
  let mixN = textureLoad(pingC, posN, 0);
  let mixS = textureLoad(pingC, posS, 0);
  let mixW = textureLoad(pingC, posW, 0);
  let mixE = textureLoad(pingC, posE, 0);
  var mixTotal = vec4<f32>(0.0);
  mixTotal += currC * m;
  mixTotal += mixN * dmN;
  mixTotal += mixS * dmS;
  mixTotal += mixW * dmW;
  mixTotal += mixE * dmE;
  var nextMix = vec4<f32>(0.0);
  if (total > 0.0) {
    nextMix = mixTotal / total;
  }
  let nextC = quantizevRound(nextMix);
  var maxIdx = 0u;
  var maxVal = nextC.x;
  if (nextC.y > maxVal) { maxVal = nextC.y; maxIdx = 1u; }
  if (nextC.z > maxVal) { maxVal = nextC.z; maxIdx = 2u; }
  if (nextC.w > maxVal) { maxVal = nextC.w; maxIdx = 3u; }
  var pid = select(0.0, params.pigmentSet.x, maxIdx == 0u);
  pid = select(pid, params.pigmentSet.y, maxIdx == 1u);
  pid = select(pid, params.pigmentSet.z, maxIdx == 2u);
  pid = select(pid, params.pigmentSet.w, maxIdx == 3u);
  if (maxVal <= 0.0) {
    pid = 0.0;
  }
  let nextB = vec4<f32>(nextStain, quantizeRound(clamp01(pid / 255.0)), currB.z, 1.0);
  textureStore(pongA, pos, nextA);
  textureStore(pongB, pos, nextB);
  textureStore(pongC, pos, nextC);
}

@compute @workgroup_size(8, 8, 1)
fn seed(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  let width = i32(params.dims.x);
  let height = i32(params.dims.y);
  if (x >= width || y >= height) { return; }
  let pos = vec2<i32>(x, y);
  // Keep ping bindings alive so layout is consistent.
  _ = textureLoad(pingA, pos, 0);
  _ = textureLoad(pingB, pos, 0);
  _ = textureLoad(pingC, pos, 0);

  let h = textureLoad(heightTex, pos, 0).r;
  let lowMin = params.relief.x;
  let lowMax = params.relief.y;
  let inv = 1.0 / max(0.001, lowMax - lowMin);
  let t = clamp01((lowMax - h) * inv);
  let mask = select(0.0, 1.0, h <= lowMax);
  let grain = textureLoad(grainTex, pos, 0).r;
  let edge = textureLoad(edgeTex, pos, 0).r;

  let cov = clamp01(t * (0.6 + grain * 0.2));
  let mass = cov * (220.0 / 255.0);
  let water = cov * (160.0 / 255.0);
  let pool = edge * (60.0 / 255.0) * mask;

  let pid = clamp01(params.stamp.z / 255.0);
  let outA = vec4<f32>(quantizeRound(cov), quantizeRound(water), quantizeRound(mass), quantizeRound(pool));
  let outB = vec4<f32>(0.0, quantizeRound(pid * mask), 0.0, 1.0);
  var seedMix = vec4<f32>(0.0);
  var slot = 0u;
  if (abs(params.pigmentSet.y - params.stamp.z) < 0.5) { slot = 1u; }
  if (abs(params.pigmentSet.z - params.stamp.z) < 0.5) { slot = 2u; }
  if (abs(params.pigmentSet.w - params.stamp.z) < 0.5) { slot = 3u; }
  if (slot == 0u) { seedMix.x = 1.0; }
  if (slot == 1u) { seedMix.y = 1.0; }
  if (slot == 2u) { seedMix.z = 1.0; }
  if (slot == 3u) { seedMix.w = 1.0; }
  let outC = quantizevRound(seedMix * mask);
  textureStore(pongA, pos, outA);
  textureStore(pongB, pos, outB);
  textureStore(pongC, pos, outC);
}
`;
    const module = this.device.createShaderModule({ label: "pbp-gpu", code });
    const stamp = this.device.createComputePipeline({
      label: "pbp-stamp",
      layout: "auto",
      compute: { module, entryPoint: "stamp" },
    });
    const step = this.device.createComputePipeline({
      label: "pbp-step",
      layout: "auto",
      compute: { module, entryPoint: "step" },
    });
    const seed = this.device.createComputePipeline({
      label: "pbp-seed",
      layout: "auto",
      compute: { module, entryPoint: "seed" },
    });
    this._paramsBuffer = this.device.createBuffer({
      label: "pbp-params",
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._pipelines = {
      stamp: { pipeline: stamp, usesHeight: true },
      step: { pipeline: step, usesHeight: false },
      seed: { pipeline: seed, usesHeight: true },
    };
  }

  _writeParams({
    centerX,
    centerY,
    radius,
    pressure,
    pigmentId,
    edgeSoftness,
    baseDeposit,
    load,
    stepParams,
    lowMin,
    lowMax,
  }) {
    const params = { ...PBP_STEP_DEFAULTS, ...(stepParams ?? {}) };
    const edgeSoft = edgeSoftness ?? params.edgeSoftness;
    const pigmentSet = normalizePigmentSet(this.cpu.toolState?.pigmentSet);
    const data = new Float32Array([
      this.width,
      this.height,
      1 / this.width,
      1 / this.height,
      centerX,
      centerY,
      0,
      0,
      radius,
      pressure,
      pigmentId,
      load ?? 1.0,
      lowMin ?? 0.55,
      lowMax ?? 0.8,
      1.0,
      baseDeposit ?? 0.4,
      params.absorbency,
      params.capillary,
      params.poolingBias,
      params.stainRate,
      params.dryingRate,
      params.massRetention,
      params.grainInfluence,
      edgeSoft,
      pigmentSet[0] ?? 1,
      pigmentSet[1] ?? 2,
      pigmentSet[2] ?? 3,
      pigmentSet[3] ?? 4,
      params.ambientMoisture ?? 0,
      params.stainSeed ?? 0.0,
      params.heightInfluence ?? 0.5,
      params.edgeBarrier ?? 0.35,
      params.valleyBias ?? 0.35,
      0,
      0,
      0,
    ]);
    this.queue.writeBuffer(this._paramsBuffer, 0, data.buffer, 0, data.byteLength);
  }

  _currentPing() {
    return this._pingIsA
      ? { a: this.textures.pingA, b: this.textures.pingB, c: this.textures.pingC }
      : { a: this.textures.pongA, b: this.textures.pongB, c: this.textures.pongC };
  }

  _currentPong() {
    return this._pingIsA
      ? { a: this.textures.pongA, b: this.textures.pongB, c: this.textures.pongC }
      : { a: this.textures.pingA, b: this.textures.pingB, c: this.textures.pingC };
  }

  _swap() {
    this._pingIsA = !this._pingIsA;
  }

  async _runCompute(pipelineInfo) {
    const ping = this._currentPing();
    const pong = this._currentPong();
    const inputs = this.inputs;
    if (!inputs) return;
    const pipeline = pipelineInfo.pipeline;
    const bindEntries = [
      { binding: 0, resource: ping.a.createView() },
      { binding: 1, resource: ping.b.createView() },
      { binding: 2, resource: ping.c.createView() },
      { binding: 3, resource: pong.a.createView() },
      { binding: 4, resource: pong.b.createView() },
      { binding: 5, resource: pong.c.createView() },
      { binding: 6, resource: inputs.height.createView() },
      { binding: 7, resource: inputs.edge.createView() },
      { binding: 8, resource: inputs.grain.createView() },
      { binding: 9, resource: { buffer: this._paramsBuffer } },
    ];
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: bindEntries,
    });
    const encoder = this.device.createCommandEncoder({ label: "pbp-compute" });
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
    pass.end();
    this.queue.submit([encoder.finish()]);
  }

  _createPbpTextures() {
    const usage =
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST;
    const size = { width: this.width, height: this.height, depthOrArrayLayers: 1 };
    const pingA = this.device.createTexture({
      label: "pbp-tex-a",
      size,
      format: "rgba8unorm",
      usage,
    });
    const pingB = this.device.createTexture({
      label: "pbp-tex-b",
      size,
      format: "rgba8unorm",
      usage,
    });
    const pingC = this.device.createTexture({
      label: "pbp-tex-c",
      size,
      format: "rgba8unorm",
      usage,
    });
    const pongA = this.device.createTexture({
      label: "pbp-tex-a-pong",
      size,
      format: "rgba8unorm",
      usage,
    });
    const pongB = this.device.createTexture({
      label: "pbp-tex-b-pong",
      size,
      format: "rgba8unorm",
      usage,
    });
    const pongC = this.device.createTexture({
      label: "pbp-tex-c-pong",
      size,
      format: "rgba8unorm",
      usage,
    });
    const readA = this.device.createBuffer({
      label: "pbp-tex-a-readback",
      size: this._paddedSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const readB = this.device.createBuffer({
      label: "pbp-tex-b-readback",
      size: this._paddedSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const readC = this.device.createBuffer({
      label: "pbp-tex-c-readback",
      size: this._paddedSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    return {
      pingA,
      pingB,
      pingC,
      pongA,
      pongB,
      pongC,
      readA,
      readB,
      readC,
    };
  }

  _packFromCpu() {
    const { coverage, water, mass, edgePool, stain, pigmentId, pigmentMix } = this.cpu.buffers;
    const a = this._packedA;
    const b = this._packedB;
    const c = this._packedC;
    for (let i = 0; i < this._pixelCount; i += 1) {
      const base = i * 4;
      a[base] = coverage[i];
      a[base + 1] = water[i];
      a[base + 2] = mass[i];
      a[base + 3] = edgePool[i];
      b[base] = stain[i];
      b[base + 1] = pigmentId[i];
      b[base + 2] = 0;
      b[base + 3] = 255;
      const mixBase = i * 4;
      c[base] = pigmentMix[mixBase];
      c[base + 1] = pigmentMix[mixBase + 1];
      c[base + 2] = pigmentMix[mixBase + 2];
      c[base + 3] = pigmentMix[mixBase + 3];
    }
  }

  _writeTextures() {
    this._padRows(this._packedA, this._uploadA);
    this._padRows(this._packedB, this._uploadB);
    this._padRows(this._packedC, this._uploadC);
    const layout = { bytesPerRow: this._bytesPerRow, rowsPerImage: this.height };
    const size = { width: this.width, height: this.height, depthOrArrayLayers: 1 };
    this.queue.writeTexture({ texture: this.textures.pingA }, this._uploadA, layout, size);
    this.queue.writeTexture({ texture: this.textures.pingB }, this._uploadB, layout, size);
    this.queue.writeTexture({ texture: this.textures.pingC }, this._uploadC, layout, size);
    this.queue.writeTexture({ texture: this.textures.pongA }, this._uploadA, layout, size);
    this.queue.writeTexture({ texture: this.textures.pongB }, this._uploadB, layout, size);
    this.queue.writeTexture({ texture: this.textures.pongC }, this._uploadC, layout, size);
    this._pingIsA = true;
  }

  _ensureInputTextures({ heightU8, edgeU8, grainU8 }) {
    if (!this.inputs) {
      const usage =
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
      const size = { width: this.width, height: this.height, depthOrArrayLayers: 1 };
      this.inputs = {
        height: this.device.createTexture({ label: "pbp-height", size, format: "rgba8unorm", usage }),
        edge: this.device.createTexture({ label: "pbp-edge", size, format: "rgba8unorm", usage }),
        grain: this.device.createTexture({ label: "pbp-grain", size, format: "rgba8unorm", usage }),
      };
    }
    if (heightU8) {
      this._writeGrayTexture(this.inputs.height, heightU8);
    }
    if (edgeU8) {
      this._writeGrayTexture(this.inputs.edge, edgeU8);
    }
    if (grainU8) {
      this._writeGrayTexture(this.inputs.grain, grainU8);
    }
  }

  _writeGrayTexture(texture, src) {
    const packed = this._grayPacked;
    for (let i = 0; i < this._pixelCount; i += 1) {
      const v = src[i] ?? 0;
      const base = i * 4;
      packed[base] = v;
      packed[base + 1] = v;
      packed[base + 2] = v;
      packed[base + 3] = 255;
    }
    this._padRows(packed, this._grayUpload);
    const layout = { bytesPerRow: this._bytesPerRow, rowsPerImage: this.height };
    const size = { width: this.width, height: this.height, depthOrArrayLayers: 1 };
    this.queue.writeTexture({ texture }, this._grayUpload, layout, size);
  }

  _padRows(src, dst) {
    const rowBytes = this.width * 4;
    for (let y = 0; y < this.height; y += 1) {
      const srcOffset = y * rowBytes;
      const dstOffset = y * this._bytesPerRow;
      dst.set(src.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
    }
  }

  _unpackTextures(mappedA, mappedB, mappedC) {
    const results = {};
    for (const name of PBP_FIELDS) {
      results[name] = new Uint8Array(this._pixelCount);
    }
    results.pigmentMix = new Uint8Array(this._pixelCount * 4);
    for (let y = 0; y < this.height; y += 1) {
      const aRow = y * this._bytesPerRow;
      const bRow = y * this._bytesPerRow;
      const cRow = y * this._bytesPerRow;
      const outRow = y * this.width;
      for (let x = 0; x < this.width; x += 1) {
        const i = outRow + x;
        const aIdx = aRow + x * 4;
        const bIdx = bRow + x * 4;
        const cIdx = cRow + x * 4;
        results.coverage[i] = mappedA[aIdx];
        results.water[i] = mappedA[aIdx + 1];
        results.mass[i] = mappedA[aIdx + 2];
        results.edgePool[i] = mappedA[aIdx + 3];
        results.stain[i] = mappedB[bIdx];
        results.pigmentId[i] = mappedB[bIdx + 1];
        const mixBase = i * 4;
        results.pigmentMix[mixBase] = mappedC[cIdx];
        results.pigmentMix[mixBase + 1] = mappedC[cIdx + 1];
        results.pigmentMix[mixBase + 2] = mappedC[cIdx + 2];
        results.pigmentMix[mixBase + 3] = mappedC[cIdx + 3];
      }
    }
    return results;
  }
}
