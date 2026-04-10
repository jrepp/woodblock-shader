import { PbpEngine } from "./woodblock/pbp/engine.js";
import { PBP_TOOL_DEFAULTS } from "./woodblock/pbp/types.js";
import { DEFAULT_PIGMENT_SET, normalizePigmentSet, PBP_STEP_DEFAULTS } from "./woodblock/pbp/settings.js";

const logEl = document.getElementById("log");
const summaryEl = document.getElementById("summary");
const canvas = document.getElementById("gpu");
const diffView = document.getElementById("diffView");
const computeToggle = document.getElementById("computeToggle");
const ambientInput = document.getElementById("ambientInput");
const stepDelayInput = document.getElementById("stepDelayInput");
const sizeInput = document.getElementById("sizeInput");
const stepsInput = document.getElementById("stepsInput");
const pigmentSetInputs = [
  document.getElementById("pigmentSet0"),
  document.getElementById("pigmentSet1"),
  document.getElementById("pigmentSet2"),
  document.getElementById("pigmentSet3"),
];
const channelSelect = null;
const fixtureSelect = null;
const treeEl = document.getElementById("fixtureTree");
const previewGrid = document.getElementById("previewGrid");
const runBtn = document.getElementById("runBtn");
const runAllBtn = document.getElementById("runAllBtn");
const stepBtn = document.getElementById("stepBtn");
const runCurrentBtn = document.getElementById("runCurrentBtn");
const runTopBtn = document.getElementById("runTopBtn");
const clearCacheBtn = document.getElementById("clearCacheBtn");
const fixtureFilterInput = document.getElementById("fixtureFilterInput");
const statusEl = document.getElementById("status");
const cacheStatusEl = document.getElementById("cacheStatus");

let lastRun = null;
let stepState = { key: "", index: 0, results: [] };
const fixtureErrors = [];
const treeResults = new Map();
let currentScenarioSelection = null;
let currentViewChannel = "coverage";
let currentFixture = "basic";
let activeRun = null;
const FIXTURE_LABELS = {
  basic: "Basic (smooth)",
  carved: "Carved Ridge",
  checker: "Checker Relief",
  wood: "Wood Texture",
  woodCarved: "Wood + Carved",
};

const PIGMENT_PALETTE = [
  [230, 57, 70],   // red
  [255, 140, 0],   // orange
  [255, 215, 0],   // yellow
  [50, 205, 50],   // green
  [0, 128, 255],   // blue
  [75, 0, 130],    // indigo
  [148, 0, 211],   // violet
  [255, 0, 255],   // magenta
  [0, 206, 209],   // cyan
  [139, 69, 19],   // brown
  [210, 180, 140], // tan
  [128, 128, 128], // gray
  [255, 255, 255], // white
  [0, 0, 0],       // black
  [0, 255, 127],   // spring green
  [255, 105, 180], // hot pink
];
let currentPigmentSet = [...DEFAULT_PIGMENT_SET];

function log(line) {
  const msg = String(line);
  logEl.textContent += `${msg}\n`;
  console.log(msg);
}

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
console.error = (...args) => {
  logError(`[console:error] ${args.map((arg) => String(arg)).join(" ")}`);
  originalConsoleError(...args);
};
console.warn = (...args) => {
  logError(`[console:warn] ${args.map((arg) => String(arg)).join(" ")}`);
  originalConsoleWarn(...args);
};

function logError(line) {
  const msg = String(line);
  fixtureErrors.push(msg);
  logEl.textContent += `${msg}\n`;
}

function flushErrorsToLog() {
  if (!fixtureErrors.length) return;
  log("--- Captured errors ---");
  for (const entry of fixtureErrors) {
    log(entry);
  }
  fixtureErrors.length = 0;
}

window.addEventListener("error", (event) => {
  const msg = event?.message ?? "Unknown error";
  const source = event?.filename ? ` @ ${event.filename}:${event.lineno ?? "?"}` : "";
  logError(`[window:error] ${msg}${source}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason;
  const detail =
    reason instanceof Error
      ? `${reason.message}\n${reason.stack ?? ""}`
      : JSON.stringify(reason);
  logError(`[window:unhandled] ${detail}`);
});

function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
}

function setCacheStatus(text) {
  if (!cacheStatusEl) return;
  cacheStatusEl.textContent = text;
}

function getStepDelayMs() {
  const seconds = Number(stepDelayInput?.value ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(5000, Math.max(0, Math.round(seconds * 1000)));
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setSummary(text) {
  if (!summaryEl) return;
  summaryEl.textContent = text ?? "";
}

function setRunControlsRunning(running) {
  if (runTopBtn) {
    runTopBtn.textContent = running ? "Cancel" : "Run";
    runTopBtn.dataset.running = running ? "1" : "0";
  }
}

function beginRun() {
  if (activeRun && !activeRun.abort) {
    return null;
  }
  const controller = { abort: false };
  activeRun = controller;
  setRunControlsRunning(true);
  return controller;
}

function endRun(controller) {
  if (activeRun === controller) {
    activeRun = null;
    setRunControlsRunning(false);
  }
}

function getPigmentSet() {
  const values = pigmentSetInputs.map((input, idx) =>
    Number(input?.value ?? currentPigmentSet[idx] ?? 0)
  );
  currentPigmentSet = normalizePigmentSet(values);
  pigmentSetInputs.forEach((input, idx) => {
    if (input) input.value = String(currentPigmentSet[idx]);
  });
  return currentPigmentSet;
}

function setPigmentSetInputs(values) {
  currentPigmentSet = normalizePigmentSet(values);
  pigmentSetInputs.forEach((input, idx) => {
    if (input) input.value = String(currentPigmentSet[idx]);
  });
}

const PREVIEW_VIEWS = [
  "height",
  "edge",
  "grain",
  "coverage",
  "water",
  "mass",
  "edgePool",
  "stain",
  "pigmentId",
  "pigmentColor",
  "mix0",
  "mix1",
  "mix2",
  "mix3",
  "mixSum",
  "finalOutput",
];

function getPreviewCanvas(view) {
  if (!previewGrid) return null;
  return previewGrid.querySelector(`canvas[data-view="${view}"]`);
}

async function loadImageData(url, size) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (err) {
      // Fallback to <img> decode for formats not supported by createImageBitmap.
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      await img.decode();
      bitmap = img;
    }
    const canvasEl = document.createElement("canvas");
    canvasEl.width = size;
    canvasEl.height = size;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    return data;
  } catch (err) {
    console.warn("Failed to load image", url, err);
    return null;
  }
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function makeFixtureTextures(size, type = "basic") {
  const height = new Uint8Array(size * size);
  const edge = new Uint8Array(size * size);
  const grain = new Uint8Array(size * size);
  let woodData = null;
  if (type === "wood" || type === "woodCarved") {
    woodData = await loadImageData("/assets/pearwood-texture.png", size);
    if (!woodData) woodData = await loadImageData("/fixtures/wood.png", size);
    if (!woodData) woodData = await loadImageData("/fixtures/wood.jpg", size);
  }
  const woodLuma = woodData
    ? new Uint8Array(size * size)
    : null;
  if (woodData && woodLuma) {
    for (let i = 0; i < size * size; i += 1) {
      const base = i * 4;
      woodLuma[i] = Math.round(luminance(woodData[base], woodData[base + 1], woodData[base + 2]));
    }
  }
  if (type === "carved") {
    const cx = size * 0.5;
    const cy = size * 0.5;
    const ridgeWidth = size * 0.08;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = y * size + x;
        const dx = Math.abs(x - cx);
        const dy = Math.abs(y - cy);
        const ridge = Math.exp(-(dx * dx) / (2 * ridgeWidth * ridgeWidth));
        const valley = Math.exp(-(dy * dy) / (2 * (ridgeWidth * 1.2) * (ridgeWidth * 1.2)));
        const h = 0.35 + 0.5 * ridge - 0.2 * valley;
        height[i] = Math.max(0, Math.min(255, Math.round(h * 255)));
        grain[i] = Math.round(255 * (0.45 + 0.55 * Math.sin((x + y) * 0.15)));
      }
    }
  } else if (type === "checker") {
    const cell = Math.max(4, Math.floor(size / 8));
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = y * size + x;
        const checker = ((Math.floor(x / cell) + Math.floor(y / cell)) % 2) === 0;
        const h = checker ? 0.75 : 0.25;
        height[i] = Math.round(h * 255);
        grain[i] = Math.round(255 * (0.4 + 0.6 * Math.sin((x * 0.1) + (y * 0.2))));
      }
    }
  } else {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const u = x / (size - 1);
      const v = y / (size - 1);
      height[i] = Math.round(255 * (0.3 + 0.7 * (u * v)));
      grain[i] = Math.round(255 * (0.4 + 0.6 * Math.sin((u + v) * Math.PI * 4)));
    }
  }
  }
  if (woodLuma) {
    for (let i = 0; i < size * size; i += 1) {
      const wood = woodLuma[i] / 255;
      grain[i] = Math.round(255 * (0.35 + wood * 0.65));
      if (type === "wood") {
        height[i] = Math.round(255 * (0.25 + wood * 0.5));
      } else if (type === "woodCarved") {
        const h = height[i] / 255;
        height[i] = Math.round(255 * Math.min(1, h * 0.7 + wood * 0.3));
      }
    }
  }
  // derive edge from height if not filled
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const i = y * size + x;
      const hL = height[i - 1];
      const hR = height[i + 1];
      const hU = height[i + size];
      const hD = height[i - size];
      const gx = hR - hL;
      const gy = hU - hD;
      const g = Math.min(255, Math.round(Math.sqrt(gx * gx + gy * gy)));
      edge[i] = g;
    }
  }
  return { height, edge, grain };
}

function compareBuffers(name, a, b, tolerance = 0) {
  if (!a || !b) {
    log(`[${name}] missing buffer(s)`);
    return false;
  }
  if (a.length !== b.length) {
    log(`[${name}] length mismatch ${a.length} vs ${b.length}`);
    return false;
  }
  let maxDiff = 0;
  let bad = 0;
  let maxIndex = -1;
  let maxA = 0;
  let maxB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = Math.abs(a[i] - b[i]);
    if (diff > tolerance) bad += 1;
    if (diff > maxDiff) {
      maxDiff = diff;
      maxIndex = i;
      maxA = a[i];
      maxB = b[i];
    }
  }
  const ok = bad === 0;
  log(`[${name}] ${ok ? "OK" : "FAIL"} maxDiff=${maxDiff} bad=${bad}`);
  return { ok, maxDiff, bad, maxIndex, maxA, maxB };
}

function compareImageBuffers(name, a, b, tolerance = 0) {
  if (!a || !b) {
    log(`[${name}] missing buffer(s)`);
    return false;
  }
  if (a.length !== b.length) {
    log(`[${name}] length mismatch ${a.length} vs ${b.length}`);
    return false;
  }
  let maxDiff = 0;
  let bad = 0;
  let maxIndex = -1;
  let maxA = 0;
  let maxB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = Math.abs(a[i] - b[i]);
    if (diff > tolerance) bad += 1;
    if (diff > maxDiff) {
      maxDiff = diff;
      maxIndex = i;
      maxA = a[i];
      maxB = b[i];
    }
  }
  const ok = bad === 0;
  log(`[${name}] ${ok ? "OK" : "FAIL"} maxDiff=${maxDiff} bad=${bad}`);
  return { ok, maxDiff, bad, maxIndex, maxA, maxB };
}

function checkImageNonEmpty(name, data) {
  if (!data) {
    log(`[${name}] missing buffer(s)`);
    return { ok: false, count: 0 };
  }
  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) {
      count += 1;
      if (count > 0) break;
    }
  }
  const ok = count > 0;
  log(`[${name}] ${ok ? "OK" : "FAIL"} nonEmpty=${ok}`);
  return { ok, count };
}

function bufferStats(label, buf) {
  if (!buf) {
    log(`[${label}] missing buffer`);
    return { max: 0, nonZero: 0 };
  }
  let max = 0;
  let nonZero = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = buf[i] ?? 0;
    if (v > 0) nonZero += 1;
    if (v > max) max = v;
  }
  log(`[${label}] max=${max} nonZero=${nonZero}`);
  return { max, nonZero };
}

function maxBufferValue(buf) {
  if (!buf) return 0;
  let max = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = buf[i] ?? 0;
    if (v > max) max = v;
  }
  return max;
}

function logImageDiffDetail(label, info, size) {
  if (!info || info.ok || info.maxIndex < 0) return;
  const pixelIndex = Math.floor(info.maxIndex / 4);
  const channel = info.maxIndex % 4;
  const x = pixelIndex % size;
  const y = Math.floor(pixelIndex / size);
  log(`[${label}] max@(${x},${y}) ch=${channel} cpu=${info.maxA} gpu=${info.maxB}`);
}

function logDiffDetail(label, info, size) {
  if (!info || info.ok || info.maxIndex < 0) return;
  const x = info.maxIndex % size;
  const y = Math.floor(info.maxIndex / size);
  log(`[${label}] max@(${x},${y}) cpu=${info.maxA} gpu=${info.maxB}`);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function quantizeToU8(v) {
  return Math.max(0, Math.min(255, Math.floor(clamp01(v) * 255)));
}

function computeStepOutputs({
  w,
  m,
  mN,
  mS,
  mW,
  mE,
  grain,
  gN,
  gS,
  gW,
  gE,
  edge,
  edgePool,
  stain,
  absorbency,
  capillary,
  poolingBias,
  stainRate,
  dryingRate,
  massRetention,
  grainInfluence,
}) {
  const spread = w * absorbency * capillary * (0.85 + grain * grainInfluence);
  let wN = 1;
  let wS = 1;
  let wW = 1;
  let wE = 1;
  if (grainInfluence > 0) {
    const bias = grainInfluence;
    wN = Math.max(0.2, Math.min(1.8, 1 + (gN - grain) * bias));
    wS = Math.max(0.2, Math.min(1.8, 1 + (gS - grain) * bias));
    wW = Math.max(0.2, Math.min(1.8, 1 + (gW - grain) * bias));
    wE = Math.max(0.2, Math.min(1.8, 1 + (gE - grain) * bias));
  }
  const wSum = wN + wS + wW + wE;
  const norm = wSum > 0 ? 1 / wSum : 0.25;
  let total = m;
  total += mN * spread * wN * norm;
  total += mS * spread * wS * norm;
  total += mW * spread * wW * norm;
  total += mE * spread * wE * norm;
  const pooled = edge * m;
  const nextEdge = quantizeToU8(edgePool + pooled * poolingBias);
  const stainAdd = m * absorbency * stainRate;
  const nextStain = quantizeToU8(stain + stainAdd);
  const nextMass = quantizeToU8(total * massRetention);
  const nextWater = quantizeToU8(w - dryingRate);
  return { nextWater, nextMass, nextEdge, nextStain };
}

function logStepInputs({
  label,
  size,
  index,
  cpuPre,
  gpuPre,
  cpuPost,
  gpuPost,
  height,
  edge,
  grain,
  stepOverrides,
}) {
  const x = index % size;
  const y = Math.floor(index / size);
  const idx = y * size + x;
  if (x <= 0 || y <= 0 || x >= size - 1 || y >= size - 1) {
    log(`[step-debug] ${label} index (${x},${y}) is boundary, skipping.`);
    return;
  }
  const defaults = {
    absorbency: PBP_STEP_DEFAULTS.absorbency,
    capillary: PBP_STEP_DEFAULTS.capillary,
    poolingBias: PBP_STEP_DEFAULTS.poolingBias,
    stainRate: PBP_STEP_DEFAULTS.stainRate,
    dryingRate: PBP_STEP_DEFAULTS.dryingRate,
    massRetention: PBP_STEP_DEFAULTS.massRetention,
    grainInfluence: PBP_STEP_DEFAULTS.grainInfluence,
  };
  const params = { ...defaults, ...(stepOverrides ?? {}) };
  const offsets = [
    { dx: 0, dy: -1, label: "N" },
    { dx: 0, dy: 1, label: "S" },
    { dx: -1, dy: 0, label: "W" },
    { dx: 1, dy: 0, label: "E" },
  ];
  const read = (buffers, ox, oy) => {
    const i = (y + oy) * size + (x + ox);
    return {
      water: buffers.water[i] / 255,
      mass: buffers.mass[i] / 255,
      edgePool: buffers.edgePool[i] / 255,
      stain: buffers.stain[i] / 255,
      pigmentId: buffers.pigmentId[i],
    };
  };
  const inCpu = read(cpuPre, 0, 0);
  const inGpu = read(gpuPre, 0, 0);
  const gHere = grain[idx] / 255;
  const eHere = edge[idx] / 255;
  const hHere = height[idx] / 255;
  const getGrain = (ox, oy) => grain[(y + oy) * size + (x + ox)] / 255;
  const gN = getGrain(0, -1);
  const gS = getGrain(0, 1);
  const gW = getGrain(-1, 0);
  const gE = getGrain(1, 0);
  const cpuOut = computeStepOutputs({
    w: inCpu.water,
    m: inCpu.mass,
    mN: read(cpuPre, 0, -1).mass,
    mS: read(cpuPre, 0, 1).mass,
    mW: read(cpuPre, -1, 0).mass,
    mE: read(cpuPre, 1, 0).mass,
    grain: gHere,
    gN,
    gS,
    gW,
    gE,
    edge: eHere,
    edgePool: inCpu.edgePool,
    stain: inCpu.stain,
    ...params,
  });
  const gpuOut = computeStepOutputs({
    w: inGpu.water,
    m: inGpu.mass,
    mN: read(gpuPre, 0, -1).mass,
    mS: read(gpuPre, 0, 1).mass,
    mW: read(gpuPre, -1, 0).mass,
    mE: read(gpuPre, 1, 0).mass,
    grain: gHere,
    gN,
    gS,
    gW,
    gE,
    edge: eHere,
    edgePool: inGpu.edgePool,
    stain: inGpu.stain,
    ...params,
  });
  log(`[step-debug] ${label} @(${x},${y}) h=${hHere.toFixed(3)} g=${gHere.toFixed(3)} e=${eHere.toFixed(3)}`);
  log(`[step-debug] cpu in w=${(inCpu.water * 255).toFixed(1)} m=${(inCpu.mass * 255).toFixed(1)} ep=${(inCpu.edgePool * 255).toFixed(1)} st=${(inCpu.stain * 255).toFixed(1)} pid=${inCpu.pigmentId}`);
  log(`[step-debug] gpu in w=${(inGpu.water * 255).toFixed(1)} m=${(inGpu.mass * 255).toFixed(1)} ep=${(inGpu.edgePool * 255).toFixed(1)} st=${(inGpu.stain * 255).toFixed(1)} pid=${inGpu.pigmentId}`);
  log(`[step-debug] cpu out m=${cpuOut.nextMass} ep=${cpuOut.nextEdge} st=${cpuOut.nextStain} w=${cpuOut.nextWater}`);
  log(`[step-debug] gpu out m=${gpuOut.nextMass} ep=${gpuOut.nextEdge} st=${gpuOut.nextStain} w=${gpuOut.nextWater}`);
  if (cpuPost && gpuPost) {
    log(`[step-debug] cpu post m=${cpuPost.mass[idx]} ep=${cpuPost.edgePool[idx]} st=${cpuPost.stain[idx]} w=${cpuPost.water[idx]} pid=${cpuPost.pigmentId[idx]}`);
    log(`[step-debug] gpu post m=${gpuPost.mass[idx]} ep=${gpuPost.edgePool[idx]} st=${gpuPost.stain[idx]} w=${gpuPost.water[idx]} pid=${gpuPost.pigmentId[idx]}`);
  }
  for (const o of offsets) {
    const c = read(cpuPre, o.dx, o.dy);
    const g = read(gpuPre, o.dx, o.dy);
    log(`[step-debug] ${o.label} cpu m=${(c.mass * 255).toFixed(1)} gpu m=${(g.mass * 255).toFixed(1)} g=${getGrain(o.dx, o.dy).toFixed(3)}`);
  }
}

function logStampMismatch({ label, size, index, stamps }) {
  const x = index % size;
  const y = Math.floor(index / size);
  log(`[stamp-debug] ${label} mismatch @(${x},${y})`);
  for (const stamp of stamps) {
    if (!stamp) continue;
    const tool = PBP_TOOL_DEFAULTS[stamp.brushType ?? "Daubing"] ?? PBP_TOOL_DEFAULTS.Daubing;
    const centerX = Math.floor((stamp.uv?.x ?? 0.5) * size);
    const centerY = Math.floor((1 - (stamp.uv?.y ?? 0.5)) * size);
    const radius = Math.max(1, Math.floor((tool.radius ?? 0.06) * size));
    const dx = x - centerX;
    const dy = y - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const inside = dist <= radius;
    log(
      `[stamp-debug] ${stamp.brushType ?? "Daubing"} center=(${centerX},${centerY}) radius=${radius} dist=${dist.toFixed(2)} inside=${inside}`
    );
  }
}

async function runCpuReference({ size, steps }) {
  const engine = new PbpEngine({ width: size, height: size });
  const { height, edge, grain } = makeFixtureTextures(size);
  engine.setPigmentId(1);
  engine.stamp({
    uv: { x: 0.5, y: 0.5 },
    brushType: "Daubing",
    pressure: 0.8,
    heightU8: height,
    edgeTex: edge,
    grainTex: grain,
    grainSize: size,
  });
  for (let i = 0; i < steps; i += 1) {
    engine.step({
      edgeTex: edge,
      grainTex: grain,
      grainSize: size,
    });
  }
  return {
    pigmentId: engine.buffers.pigmentId,
    coverage: engine.buffers.coverage,
    water: engine.buffers.water,
    mass: engine.buffers.mass,
    edgePool: engine.buffers.edgePool,
    stain: engine.buffers.stain,
  };
}

async function tryRunGpu({
  size,
  steps,
  computeEnabled,
  stampOverrides,
  fixture,
  stepOverrides,
  floodFill,
  pigmentSet,
  debugPreStep = false,
}) {
  let gpuModule = null;
  try {
    gpuModule = await import("./woodblock/pbp/gpu.js");
  } catch (err) {
    log("GPU module not found: ./woodblock/pbp/gpu.js");
    return null;
  }

  const PbpGpuSystem = gpuModule?.PbpGpuSystem;
  if (!PbpGpuSystem) {
    log("GPU module loaded, but PbpGpuSystem export is missing.");
    return null;
  }

  const gpu = new PbpGpuSystem({
    canvas,
    width: size,
    height: size,
    useCpuReference: !computeEnabled,
    computeEnabled,
    onError: (msg) => logError(`[gpu] ${msg}`),
  });
  canvas.width = size;
  canvas.height = size;

  if (typeof gpu.init !== "function") {
    log("PbpGpuSystem.init missing.");
    return null;
  }

  const ready = await gpu.init();
  if (!ready) {
    log("PbpGpuSystem.init returned false (GPU path not ready).");
    return null;
  }

  if (typeof gpu.clear === "function") {
    await gpu.clear();
  }

  if (typeof gpu.stamp !== "function" || typeof gpu.step !== "function") {
    log("PbpGpuSystem missing stamp/step methods.");
    return null;
  }

  const { height, edge, grain } = await makeFixtureTextures(size, fixture);
  if (Array.isArray(pigmentSet) && pigmentSet.length === 4 && gpu?.cpu?.setPigmentSet) {
    gpu.cpu.setPigmentSet(pigmentSet);
  }
  const defaultStamp = { uv: { x: 0.5, y: 0.5 }, pressure: 0.8, brushType: "Daubing", pigmentId: 1 };
  const stamps = Array.isArray(stampOverrides)
    ? stampOverrides
    : [stampOverrides ?? defaultStamp];
  if (floodFill) {
    await gpu.floodFillSeed({
      heightU8: height,
      edgeU8: edge,
      grainU8: grain,
      grainSize: size,
      lowMin: floodFill.lowMin ?? 0.55,
      lowMax: floodFill.lowMax ?? 0.8,
      pigmentId: floodFill.pigmentId ?? 1,
    });
  } else {
    for (const stamp of stamps) {
      if (!stamp) continue;
      if (stamp.resetLoad && gpu?.cpu?.resetLoad) {
        gpu.cpu.resetLoad();
      }
      if (stamp.pigmentId != null && gpu?.cpu?.setPigmentId) {
        gpu.cpu.setPigmentId(stamp.pigmentId);
      }
      await gpu.stamp({
        uv: stamp.uv ?? { x: 0.5, y: 0.5 },
        brushType: stamp.brushType ?? "Daubing",
        pressure: stamp.pressure ?? 0.8,
        pigmentId: stamp.pigmentId ?? 1,
        heightU8: height,
        edgeU8: edge,
        grainU8: grain,
        grainSize: size,
        stepParams: stepOverrides,
      });
    }
  }
  let preBuffers = null;
  if (debugPreStep && steps > 0) {
    preBuffers = await gpu.readback();
  }
  await gpu.step({
    count: steps,
    heightU8: height,
    edgeU8: edge,
    grainU8: grain,
    grainSize: size,
    stepParams: stepOverrides,
  });

  if (typeof gpu.readback !== "function") {
    log("PbpGpuSystem.readback missing.");
    return null;
  }

  const buffers = await gpu.readback();
  return {
    buffers,
    preBuffers,
    computeEnabled: !!gpu.computeEnabled,
  };
}

async function main({
  computeEnabled,
  steps,
  size,
  viewChannel,
  stampOverrides,
  fixture,
  stepOverrides,
  floodFill,
  pigmentSet,
  debugSingleStep = false,
  debugLabel = "",
  debugStamp = false,
  allowEmptyPigmentColor = false,
  validationOverrides = null,
  runController = null,
}) {
  const results = {
    size,
    steps,
    cpuOnly: false,
    gpuAvailable: false,
    gpuComputeEnabled: false,
    comparisons: {},
  };
  if (runController?.abort) {
    results.cancelled = true;
    log("Cancelled.");
    window.__pbpTestResults = results;
    return results;
  }
  log(`CPU reference (${size}x${size}, steps=${steps})...`);
  const cpuEngine = new PbpEngine({ width: size, height: size });
  if (Array.isArray(pigmentSet) && pigmentSet.length === 4) {
    cpuEngine.setPigmentSet(pigmentSet);
  }
  const { height, edge, grain } = await makeFixtureTextures(size, fixture);
  const defaultStamp = { uv: { x: 0.5, y: 0.5 }, pressure: 0.8, brushType: "Daubing", pigmentId: 1 };
  const stamps = Array.isArray(stampOverrides)
    ? stampOverrides
    : [stampOverrides ?? defaultStamp];
  if (floodFill) {
    cpuEngine.setPigmentId(floodFill.pigmentId ?? 1);
    cpuEngine.autoFillSeed({
      heightU8: height,
      edgeU8: edge,
      grainU8: grain,
      grainSize: size,
      lowMin: floodFill.lowMin ?? 0.55,
      lowMax: floodFill.lowMax ?? 0.8,
    });
  } else {
    for (const stamp of stamps) {
      if (runController?.abort) {
        results.cancelled = true;
        log("Cancelled.");
        window.__pbpTestResults = results;
        return results;
      }
      if (!stamp) continue;
      if (stamp.resetLoad && typeof cpuEngine.resetLoad === "function") {
        cpuEngine.resetLoad();
      }
      cpuEngine.setPigmentId(stamp.pigmentId ?? 1);
      cpuEngine.stamp({
        uv: stamp.uv ?? { x: 0.5, y: 0.5 },
        brushType: stamp.brushType ?? "Daubing",
        pressure: stamp.pressure ?? 0.8,
        heightU8: height,
        edgeTex: edge,
        grainTex: grain,
        grainSize: size,
      });
    }
  }
  const cpuPre =
    debugSingleStep && steps > 0
      ? {
          pigmentId: cpuEngine.buffers.pigmentId.slice(),
          coverage: cpuEngine.buffers.coverage.slice(),
          water: cpuEngine.buffers.water.slice(),
          mass: cpuEngine.buffers.mass.slice(),
          edgePool: cpuEngine.buffers.edgePool.slice(),
          stain: cpuEngine.buffers.stain.slice(),
        }
      : null;
  for (let i = 0; i < steps; i += 1) {
    if (runController?.abort) {
      results.cancelled = true;
      log("Cancelled.");
      window.__pbpTestResults = results;
      return results;
    }
    cpuEngine.step({
      heightU8: height,
      edgeTex: edge,
      grainTex: grain,
      grainSize: size,
      ...(stepOverrides ?? {}),
    });
    if (i % 4 === 0) {
      await sleep(0);
    }
  }
  const cpu = {
    pigmentId: cpuEngine.buffers.pigmentId,
    pigmentMix: cpuEngine.buffers.pigmentMix,
    coverage: cpuEngine.buffers.coverage,
    water: cpuEngine.buffers.water,
    mass: cpuEngine.buffers.mass,
    edgePool: cpuEngine.buffers.edgePool,
    stain: cpuEngine.buffers.stain,
  };
  bufferStats("cpu coverage", cpu.coverage);
  bufferStats("cpu mass", cpu.mass);
  bufferStats("cpu stain", cpu.stain);

  if (!navigator.gpu) {
    log("WebGPU not available in this browser.");
    results.cpuOnly = true;
    window.__pbpTestResults = results;
    return;
  }

  log("GPU run...");
  if (runController?.abort) {
    results.cancelled = true;
    log("Cancelled.");
    window.__pbpTestResults = results;
    return results;
  }
  const gpuRun = await tryRunGpu({
    size,
    steps,
    computeEnabled,
    stampOverrides,
    fixture,
    stepOverrides,
    floodFill,
    pigmentSet,
    debugPreStep: debugSingleStep,
  });
  if (!gpuRun || !gpuRun.buffers) {
    log("GPU path unavailable; CPU reference complete.");
    results.cpuOnly = true;
    window.__pbpTestResults = results;
    return;
  }
  if (runController?.abort) {
    results.cancelled = true;
    log("Cancelled.");
    window.__pbpTestResults = results;
    return results;
  }
  results.gpuAvailable = true;
  results.gpuComputeEnabled = !!gpuRun.computeEnabled;

  log("Comparing buffers...");
  const gpu = gpuRun.buffers;
  if (!gpu.pigmentMix) {
    gpu.pigmentMix = null;
  }
  results.comparisons.pigmentId = compareBuffers("pigmentId", cpu.pigmentId, gpu.pigmentId, 0);
  results.comparisons.coverage = compareBuffers("coverage", cpu.coverage, gpu.coverage, 1);
  results.comparisons.water = compareBuffers("water", cpu.water, gpu.water, 1);
  results.comparisons.mass = compareBuffers("mass", cpu.mass, gpu.mass, 1);
  const edgePoolTolerance = validationOverrides?.edgePoolTolerance ?? 1;
  const pigmentMixTolerance = validationOverrides?.pigmentMixTolerance ?? 2;
  results.comparisons.edgePool = compareBuffers("edgePool", cpu.edgePool, gpu.edgePool, edgePoolTolerance);
  results.comparisons.stain = compareBuffers("stain", cpu.stain, gpu.stain, 1);
  bufferStats("gpu coverage", gpu.coverage);
  bufferStats("gpu mass", gpu.mass);
  bufferStats("gpu stain", gpu.stain);
  bufferStats("gpu edgePool", gpu.edgePool);
  if (cpu.pigmentMix && gpu.pigmentMix) {
    results.comparisons.pigmentMix = compareBuffers(
      "pigmentMix",
      cpu.pigmentMix,
      gpu.pigmentMix,
      pigmentMixTolerance
    );
  }
  const cpuFinal = computeFinalOutputData({
    mix: cpu.pigmentMix,
    pigmentId: cpu.pigmentId,
    mass: cpu.mass,
    stain: cpu.stain,
    coverage: cpu.coverage,
    water: cpu.water,
    edgePool: cpu.edgePool,
    grain,
    size,
  });
  const gpuFinal = computeFinalOutputData({
    mix: gpu.pigmentMix,
    pigmentId: gpu.pigmentId,
    mass: gpu.mass,
    stain: gpu.stain,
    coverage: gpu.coverage,
    water: gpu.water,
    edgePool: gpu.edgePool,
    grain,
    size,
  });
  if (cpuFinal && gpuFinal) {
    results.comparisons.finalOutput = compareImageBuffers("finalOutput", cpuFinal, gpuFinal, 2);
  }
  if (gpuFinal) {
    results.comparisons.finalOutputNonEmpty = checkImageNonEmpty("finalOutput", gpuFinal);
  }
  const cpuPigmentColor = computePigmentColorData({
    mix: cpu.pigmentMix,
    pigmentId: cpu.pigmentId,
    size,
  });
  const gpuPigmentColor = computePigmentColorData({
    mix: gpu.pigmentMix,
    pigmentId: gpu.pigmentId,
    size,
  });
  const hasPigmentSignal = (() => {
    if (!gpu.pigmentId && !gpu.pigmentMix) return false;
    if (gpu.pigmentMix) {
      for (let i = 0; i < gpu.pigmentMix.length; i += 4) {
        if ((gpu.pigmentMix[i] ?? 0) > 0 || (gpu.pigmentMix[i + 1] ?? 0) > 0 || (gpu.pigmentMix[i + 2] ?? 0) > 0 || (gpu.pigmentMix[i + 3] ?? 0) > 0) {
          return true;
        }
      }
    }
    if (gpu.pigmentId) {
      for (let i = 0; i < gpu.pigmentId.length; i += 1) {
        if ((gpu.pigmentId[i] ?? 0) > 0) return true;
      }
    }
    return false;
  })();
  if (!allowEmptyPigmentColor && hasPigmentSignal) {
    results.comparisons.pigmentColor = checkImageNonEmpty("pigmentColor", gpuPigmentColor);
  } else {
    const reason = allowEmptyPigmentColor
      ? "allowed empty for scenario"
      : "no pigment signal detected";
    log(`[pigmentColor] SKIP ${reason}`);
    results.comparisons.pigmentColor = { ok: true, count: 0, skipped: true, reason };
  }
  if (cpuPigmentColor && gpuPigmentColor) {
    results.comparisons.pigmentColorMatch = compareImageBuffers(
      "pigmentColorMatch",
      cpuPigmentColor,
      gpuPigmentColor,
      10
    );
  }
  if (debugStamp && results.comparisons.pigmentId?.maxIndex >= 0) {
    logDiffDetail("pigmentId", results.comparisons.pigmentId, size);
    logStampMismatch({
      label: "pigmentId",
      size,
      index: results.comparisons.pigmentId.maxIndex,
      stamps,
    });
  }
  if (debugSingleStep) {
    const suffix = debugLabel ? ` ${debugLabel}` : "";
    log(`--- Single-step diff${suffix} ---`);
    logDiffDetail("mass", results.comparisons.mass, size);
    logDiffDetail("edgePool", results.comparisons.edgePool, size);
    logDiffDetail("stain", results.comparisons.stain, size);
    logDiffDetail("pigmentId", results.comparisons.pigmentId, size);
    logDiffDetail("coverage", results.comparisons.coverage, size);
    logImageDiffDetail("finalOutput", results.comparisons.finalOutput, size);
    logImageDiffDetail("pigmentColor", results.comparisons.pigmentColorMatch, size);
    if (debugStamp && results.comparisons.pigmentId?.maxIndex >= 0) {
      logStampMismatch({
        label: `pigmentId${suffix}`,
        size,
        index: results.comparisons.pigmentId.maxIndex,
        stamps,
      });
    }
    const gpuPre = gpuRun.preBuffers;
    if (cpuPre && gpuPre && results.comparisons.mass?.maxIndex >= 0) {
      logStepInputs({
        label: `mass${suffix}`,
        size,
        index: results.comparisons.mass.maxIndex,
        cpuPre,
        gpuPre,
        cpuPost: cpu,
        gpuPost: gpu,
        height,
        edge,
        grain,
        stepOverrides,
      });
    }
    if (cpuPre && gpuPre && results.comparisons.edgePool?.maxIndex >= 0) {
      logStepInputs({
        label: `edgePool${suffix}`,
        size,
        index: results.comparisons.edgePool.maxIndex,
        cpuPre,
        gpuPre,
        cpuPost: cpu,
        gpuPost: gpu,
        height,
        edge,
        grain,
        stepOverrides,
      });
    }
  }
  results.pass = Object.values(results.comparisons).every((entry) => entry.ok);
  window.__pbpTestResults = results;
  renderPreviewGrid({ cpu, gpu, inputs: { height, edge, grain }, size });
  drawDiffForView(viewChannel, { cpu, gpu, inputs: { height, edge, grain }, size });
  lastRun = {
    cpu,
    gpu,
    inputs: { height, edge, grain },
    size,
    viewChannel,
    results,
  };
  setCacheStatus("cache: ready");
  return results;
}

function syncControlsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const computeEnabled = params.get("compute") === "1";
  const steps = Number(params.get("steps") ?? 10);
  const size = Number(params.get("size") ?? 64);
  const ambientMoisture = Number(params.get("ambient") ?? 0);
  const view = params.get("view") ?? "coverage";
  const fixture = params.get("fixture") ?? "basic";
  const stepDelay = Number(params.get("delay") ?? 0);
  const pigmentParam = params.get("pigments") ?? params.get("pigmentSet");
  if (computeToggle) computeToggle.checked = computeEnabled;
  if (stepsInput) stepsInput.value = String(steps);
  if (sizeInput) sizeInput.value = String(size);
  if (ambientInput) ambientInput.value = String(ambientMoisture);
  if (stepDelayInput) stepDelayInput.value = String(stepDelay);
  currentViewChannel = view;
  currentFixture = fixture;
  if (pigmentParam) {
    const values = pigmentParam
      .split(/[,\s]+/g)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (values.length === 2) {
      setPigmentSetInputs([values[0], values[1], 0, 0]);
    } else if (values.length >= 4) {
      setPigmentSetInputs(values.slice(0, 4));
    }
  }
  const pigmentSet = getPigmentSet();
  return { computeEnabled, steps, size, viewChannel: view, fixture, ambientMoisture, pigmentSet };
}

function writeUrlParams({ computeEnabled, steps, size, viewChannel, fixture, ambientMoisture }) {
  const params = new URLSearchParams(window.location.search);
  if (computeEnabled) params.set("compute", "1");
  else params.delete("compute");
  params.set("steps", String(steps));
  params.set("size", String(size));
  if (ambientMoisture != null) {
    params.set("ambient", String(ambientMoisture));
  }
  if (stepDelayInput) {
    const delaySeconds = Number(stepDelayInput.value ?? 0);
    if (Number.isFinite(delaySeconds)) {
      params.set("delay", String(delaySeconds));
    }
  }
  if (viewChannel !== undefined) {
    if (viewChannel && viewChannel !== "none") params.set("view", viewChannel);
    else params.delete("view");
    currentViewChannel = viewChannel || "coverage";
  }
  if (fixture) params.set("fixture", fixture);
  const pigmentSet = getPigmentSet();
  if (Array.isArray(pigmentSet)) {
    const compact = pigmentSet.filter((value) => value > 0);
    if (compact.length === 2) {
      params.set("pigments", compact.join(","));
    } else {
      params.delete("pigments");
    }
  }
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  window.history.replaceState({}, "", next);
}

async function runFromUI() {
  if (activeRun && !activeRun.abort) {
    log("Run already in progress.");
    return;
  }
  const controller = beginRun();
  logEl.textContent = "";
  setSummary("");
  fixtureErrors.length = 0;
  const computeEnabled = !!computeToggle?.checked;
  const steps = Number(stepsInput?.value ?? 10);
  const size = Number(sizeInput?.value ?? 64);
  const ambientMoisture = Number(ambientInput?.value ?? 0);
  const viewChannel = currentViewChannel ?? "coverage";
  const fixture = currentFixture ?? "basic";
  const pigmentSet = getPigmentSet();
  writeUrlParams({ computeEnabled, steps, size, viewChannel, fixture, ambientMoisture });
  setStatus("running");
  const results = await main({
    computeEnabled,
    steps,
    size,
    viewChannel,
    fixture,
    pigmentSet,
    stepOverrides: { ambientMoisture },
    runController: controller,
  });
  if (results?.cancelled) {
    setStatus("cancelled");
  } else {
    setStatus(results?.pass ? "pass" : "fail");
  }
  flushErrorsToLog();
  endRun(controller);
}

function redrawFromLast(viewChannel) {
  if (!lastRun) return false;
  renderPreviewGrid(lastRun);
  drawDiffForView(viewChannel ?? currentViewChannel, lastRun);
  return true;
}

function formatSummary(resultsList) {
  const lines = [];
  for (const entry of resultsList) {
    const label = `${entry.label}`;
    const status = entry.results?.pass ? "PASS" : "FAIL";
    lines.push(`${label}: ${status}`);
  }
  return lines.join("\n");
}

function makeRng(seed = 1337) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStroke({
  start,
  end,
  count,
  pressureRange = [0.4, 1.0],
  pigmentId = 1,
  brushType = "Daubing",
  jitter = 0.02,
  rng = Math.random,
}) {
  const stamps = [];
  for (let i = 0; i < count; i += 1) {
    const t = count > 1 ? i / (count - 1) : 0;
    const u = start.x + (end.x - start.x) * t + (rng() * 2 - 1) * jitter;
    const v = start.y + (end.y - start.y) * t + (rng() * 2 - 1) * jitter;
    const p = pressureRange[0] + (pressureRange[1] - pressureRange[0]) * t;
    stamps.push({
      uv: { x: Math.min(0.98, Math.max(0.02, u)), y: Math.min(0.98, Math.max(0.02, v)) },
      pressure: p,
      brushType,
      pigmentId,
    });
  }
  return stamps;
}

function buildScenarios() {
  return [
    {
      label: "Stamp only (center)",
      steps: 0,
      stamp: [
        { uv: { x: 0.5, y: 0.5 }, pressure: 1.0, brushType: "Daubing" },
        { uv: { x: 0.47, y: 0.5 }, pressure: 0.9, brushType: "Daubing" },
        { uv: { x: 0.53, y: 0.5 }, pressure: 0.9, brushType: "Daubing" },
        { uv: { x: 0.5, y: 0.47 }, pressure: 0.9, brushType: "Daubing" },
        { uv: { x: 0.5, y: 0.53 }, pressure: 0.9, brushType: "Daubing" },
        { uv: { x: 0.47, y: 0.47 }, pressure: 0.85, brushType: "Daubing" },
        { uv: { x: 0.53, y: 0.47 }, pressure: 0.85, brushType: "Daubing" },
        { uv: { x: 0.47, y: 0.53 }, pressure: 0.85, brushType: "Daubing" },
        { uv: { x: 0.53, y: 0.53 }, pressure: 0.85, brushType: "Daubing" },
      ],
      validation: { pigmentMixTolerance: 4 },
      debugStamp: true,
    },
    { label: "10 steps (center)", steps: 10, stamp: { uv: { x: 0.5, y: 0.5 }, pressure: 0.8, brushType: "Daubing" } },
    { label: "Edge stamp (left)", steps: 5, stamp: { uv: { x: 0.1, y: 0.5 }, pressure: 0.8, brushType: "Daubing" }, debugStamp: true },
    { label: "High pressure", steps: 5, stamp: { uv: { x: 0.6, y: 0.4 }, pressure: 1.0, brushType: "Rough" } },
    { label: "Low pressure", steps: 5, stamp: { uv: { x: 0.4, y: 0.6 }, pressure: 0.4, brushType: "Daubing" }, debugStamp: true },
    {
      label: "Smudge pass",
      steps: 3,
      stamp: { uv: { x: 0.5, y: 0.5 }, pressure: 0.8, brushType: "Smudge" },
      allowEmptyPigmentColor: true,
    },
    {
      label: "Bleed: single source",
      steps: 18,
      stamp: { uv: { x: 0.5, y: 0.5 }, pressure: 0.8, brushType: "Daubing", pigmentId: 1 },
      stepOverrides: { absorbency: 0.65, capillary: 1.6, poolingBias: 0.05, grainInfluence: 0.0, dryingRate: 0.005 },
      debugSingleStep: true,
    },
    {
      label: "Bleed: opposing sources",
      steps: 22,
      stamp: [
        { uv: { x: 0.35, y: 0.5 }, pressure: 0.8, brushType: "Daubing", pigmentId: 1 },
        { uv: { x: 0.65, y: 0.5 }, pressure: 0.8, brushType: "Daubing", pigmentId: 2 },
      ],
      pigmentSet: [1, 2, 3, 4],
      stepOverrides: { absorbency: 0.6, capillary: 1.5, poolingBias: 0.05, grainInfluence: 0.0, dryingRate: 0.006 },
      debugSingleStep: true,
    },
    {
      label: "Water ring (evap)",
      steps: 26,
      stamp: { uv: { x: 0.5, y: 0.5 }, pressure: 1.0, brushType: "Rough", pigmentId: 3 },
      stepOverrides: { absorbency: 0.7, capillary: 1.4, poolingBias: 0.1, grainInfluence: 0.0, dryingRate: 0.02, massRetention: 0.9 },
      debugSingleStep: true,
    },
    {
      label: "Slow bleed (wet)",
      steps: 60,
      fixture: "carved",
      pigmentSet: [1, 2, 0, 0],
      stamp: (rng) =>
        [
          ...makeStroke({
            start: { x: 0.38, y: 0.5 },
            end: { x: 0.62, y: 0.5 },
            count: 14,
            pigmentId: 1,
            brushType: "Daubing",
            pressureRange: [0.9, 1.0],
            jitter: 0.005,
            rng,
          }),
          ...makeStroke({
            start: { x: 0.5, y: 0.38 },
            end: { x: 0.5, y: 0.62 },
            count: 14,
            pigmentId: 2,
            brushType: "Daubing",
            pressureRange: [0.9, 1.0],
            jitter: 0.005,
            rng,
          }),
        ].map((stamp) => ({ ...stamp, resetLoad: true })),
      stepOverrides: {
        absorbency: 1.45,
        capillary: 3.6,
        poolingBias: 0.55,
        grainInfluence: 0.55,
        dryingRate: 0.00005,
        massRetention: 0.995,
        ambientMoisture: 0.5,
        heightInfluence: 1.4,
        edgeBarrier: 1.25,
        valleyBias: 0.9,
      },
      validation: { edgePoolTolerance: 3, pigmentMixTolerance: 4 },
      debugSingleStep: true,
    },
    {
      label: "Carved ridge capillary",
      steps: 24,
      fixture: "carved",
      pigmentSet: [1, 2, 0, 0],
      stamp: (rng) =>
        [
          ...makeStroke({
            start: { x: 0.42, y: 0.44 },
            end: { x: 0.58, y: 0.56 },
            count: 12,
            pigmentId: 1,
            brushType: "Daubing",
            pressureRange: [0.85, 0.98],
            jitter: 0.006,
            rng,
          }),
          ...makeStroke({
            start: { x: 0.58, y: 0.44 },
            end: { x: 0.42, y: 0.56 },
            count: 12,
            pigmentId: 2,
            brushType: "Daubing",
            pressureRange: [0.85, 0.98],
            jitter: 0.006,
            rng,
          }),
        ].map((stamp) => ({ ...stamp, resetLoad: true })),
      stepOverrides: {
        absorbency: 0.9,
        capillary: 2.1,
        poolingBias: 0.45,
        grainInfluence: 0.35,
        heightInfluence: 1.2,
        edgeBarrier: 1.1,
        valleyBias: 0.65,
      },
      validation: { pigmentMixTolerance: 4 },
      debugStamp: true,
    },
    {
      label: "Height ridge vs valley",
      steps: 22,
      fixture: "carved",
      pigmentSet: [1, 2, 0, 0],
      stamp: (rng) =>
        [
          ...makeStroke({
            start: { x: 0.36, y: 0.42 },
            end: { x: 0.64, y: 0.42 },
            count: 10,
            pigmentId: 1,
            brushType: "Daubing",
            pressureRange: [0.8, 0.95],
            jitter: 0.004,
            rng,
          }),
          ...makeStroke({
            start: { x: 0.36, y: 0.58 },
            end: { x: 0.64, y: 0.58 },
            count: 10,
            pigmentId: 2,
            brushType: "Daubing",
            pressureRange: [0.8, 0.95],
            jitter: 0.004,
            rng,
          }),
        ].map((stamp) => ({ ...stamp, resetLoad: true })),
      stepOverrides: {
        absorbency: 0.7,
        capillary: 1.9,
        poolingBias: 0.3,
        grainInfluence: 0.2,
        heightInfluence: 1.25,
        valleyBias: 0.7,
      },
      validation: { pigmentMixTolerance: 4 },
      debugStamp: true,
      debugSingleStep: true,
    },
    {
      label: "Relief threshold stamp",
      steps: 8,
      fixture: "carved",
      stamp: { uv: { x: 0.52, y: 0.5 }, pressure: 0.7, brushType: "Daubing", pigmentId: 3 },
      stepOverrides: { absorbency: 0.35, capillary: 1.0, poolingBias: 0.15, grainInfluence: 0.2 },
      debugSingleStep: true,
    },
    {
      label: "Ridge water pooling",
      steps: 24,
      fixture: "carved",
      pigmentSet: [1, 2, 0, 0],
      stamp: (rng) =>
        [
          ...makeStroke({
            start: { x: 0.42, y: 0.48 },
            end: { x: 0.58, y: 0.52 },
            count: 10,
            pigmentId: 1,
            brushType: "Daubing",
            pressureRange: [0.88, 1.0],
            jitter: 0.004,
            rng,
          }),
          ...makeStroke({
            start: { x: 0.58, y: 0.48 },
            end: { x: 0.42, y: 0.52 },
            count: 10,
            pigmentId: 2,
            brushType: "Daubing",
            pressureRange: [0.88, 1.0],
            jitter: 0.004,
            rng,
          }),
        ].map((stamp) => ({ ...stamp, resetLoad: true })),
      stepOverrides: {
        absorbency: 0.85,
        capillary: 2.35,
        poolingBias: 1.1,
        grainInfluence: 0.25,
        heightInfluence: 1.25,
        edgeBarrier: 1.2,
        dryingRate: 0.008,
        massRetention: 0.99,
        ambientMoisture: 0.28,
        valleyBias: 0.95,
      },
      validation: { edgePoolTolerance: 3, pigmentMixTolerance: 4 },
      debugSingleStep: true,
    },
    {
      label: "Parallel diagonal edge cross",
      steps: 28,
      fixture: "carved",
      pigmentSet: [1, 2, 0, 0],
      seed: 4242,
      stamp: (rng) => {
        const lineA = makeStroke({
          start: { x: 0.08, y: 0.22 },
          end: { x: 0.92, y: 0.78 },
          count: 18,
          pigmentId: 1,
          brushType: "Daubing",
          pressureRange: [0.7, 0.95],
          jitter: 0.008,
          rng,
        }).map((stamp) => ({ ...stamp, resetLoad: true }));
        const lineB = makeStroke({
          start: { x: 0.14, y: 0.17 },
          end: { x: 0.98, y: 0.73 },
          count: 18,
          pigmentId: 2,
          brushType: "Daubing",
          pressureRange: [0.7, 0.95],
          jitter: 0.008,
          rng,
        }).map((stamp) => ({ ...stamp, resetLoad: true }));
        const interleaved = [];
        const n = Math.max(lineA.length, lineB.length);
        for (let i = 0; i < n; i += 1) {
          if (lineA[i]) interleaved.push(lineA[i]);
          if (lineB[i]) interleaved.push(lineB[i]);
        }
        return interleaved;
      },
      stepOverrides: {
        absorbency: 0.5,
        capillary: 1.4,
        poolingBias: 0.35,
        grainInfluence: 0.35,
        heightInfluence: 1.1,
        edgeBarrier: 1.0,
        ambientMoisture: 0.15,
        dryingRate: 0.02,
        massRetention: 0.95,
      },
      debugSingleStep: true,
    },
    {
      label: "4 pigments (quad)",
      steps: 12,
      debugStamp: true,
      stamp: [
        { uv: { x: 0.3, y: 0.3 }, pressure: 0.8, brushType: "Daubing", pigmentId: 1 },
        { uv: { x: 0.7, y: 0.3 }, pressure: 0.8, brushType: "Daubing", pigmentId: 2 },
        { uv: { x: 0.3, y: 0.7 }, pressure: 0.8, brushType: "Daubing", pigmentId: 3 },
        { uv: { x: 0.7, y: 0.7 }, pressure: 0.8, brushType: "Daubing", pigmentId: 4 },
      ],
      pigmentSet: [1, 2, 3, 4],
    },
    {
      label: "Mix overlap (2 pigments)",
      steps: 18,
      fixture: "wood",
      pigmentSet: [1, 2, 0, 0],
      stamp: [
        { uv: { x: 0.5, y: 0.5 }, pressure: 0.9, brushType: "Daubing", pigmentId: 1 },
        { uv: { x: 0.52, y: 0.5 }, pressure: 0.9, brushType: "Daubing", pigmentId: 2 },
      ],
      stepOverrides: {
        absorbency: 0.5,
        capillary: 1.35,
        poolingBias: 0.2,
        grainInfluence: 0.6,
        heightInfluence: 0.8,
      },
      debugSingleStep: true,
    },
    {
      label: "Mix crossfade (4 pigments)",
      steps: 16,
      fixture: "woodCarved",
      pigmentSet: [1, 2, 3, 4],
      stamp: (rng) => [
        ...makeStroke({
          start: { x: 0.2, y: 0.35 },
          end: { x: 0.8, y: 0.35 },
          count: 10,
          pigmentId: 1,
          brushType: "Daubing",
          pressureRange: [0.6, 0.9],
          jitter: 0.01,
          rng,
        }),
        ...makeStroke({
          start: { x: 0.2, y: 0.45 },
          end: { x: 0.8, y: 0.45 },
          count: 10,
          pigmentId: 2,
          brushType: "Daubing",
          pressureRange: [0.6, 0.9],
          jitter: 0.01,
          rng,
        }),
        ...makeStroke({
          start: { x: 0.2, y: 0.55 },
          end: { x: 0.8, y: 0.55 },
          count: 10,
          pigmentId: 3,
          brushType: "Daubing",
          pressureRange: [0.6, 0.9],
          jitter: 0.01,
          rng,
        }),
        ...makeStroke({
          start: { x: 0.2, y: 0.65 },
          end: { x: 0.8, y: 0.65 },
          count: 10,
          pigmentId: 4,
          brushType: "Daubing",
          pressureRange: [0.6, 0.9],
          jitter: 0.01,
          rng,
        }),
      ],
      stepOverrides: { absorbency: 0.5, capillary: 1.2, poolingBias: 0.2, grainInfluence: 0.55 },
      debugSingleStep: true,
    },
    {
      label: "Capillary stress (wood carved)",
      steps: 25,
      stamp: { uv: { x: 0.5, y: 0.5 }, pressure: 0.9, brushType: "Daubing" },
      fixture: "woodCarved",
      stepOverrides: { absorbency: 0.6, capillary: 1.3, poolingBias: 0.2, grainInfluence: 0.5 },
      debugSingleStep: true,
    },
    {
      label: "Wood grain capillary drift",
      steps: 20,
      fixture: "wood",
      stamp: { uv: { x: 0.5, y: 0.5 }, pressure: 0.8, brushType: "Daubing", pigmentId: 2 },
      stepOverrides: { absorbency: 0.55, capillary: 1.25, poolingBias: 0.15, grainInfluence: 0.65 },
      debugSingleStep: true,
    },
    {
      label: "Carved + wood relief flow",
      steps: 22,
      fixture: "woodCarved",
      stamp: [
        { uv: { x: 0.35, y: 0.5 }, pressure: 0.8, brushType: "Daubing", pigmentId: 1 },
        { uv: { x: 0.65, y: 0.5 }, pressure: 0.8, brushType: "Daubing", pigmentId: 3 },
      ],
      stepOverrides: { absorbency: 0.6, capillary: 1.35, poolingBias: 0.25, grainInfluence: 0.6 },
      debugSingleStep: true,
    },
    {
      label: "Flood fill seed (carved)",
      steps: 0,
      fixture: "carved",
      floodFill: { lowMin: 0.5, lowMax: 0.8, pigmentId: 2 },
    },
    {
      label: "Flood fill capillary",
      steps: 20,
      fixture: "woodCarved",
      floodFill: { lowMin: 0.5, lowMax: 0.75, pigmentId: 3 },
      stepOverrides: { absorbency: 0.55, capillary: 1.25, poolingBias: 0.2, grainInfluence: 0.6 },
      debugSingleStep: true,
    },
    {
      label: "Palette capillary (wood)",
      steps: 22,
      fixture: "wood",
      floodFill: { lowMin: 0.4, lowMax: 0.78, pigmentId: 4 },
      stepOverrides: { absorbency: 0.5, capillary: 1.2, poolingBias: 0.18, grainInfluence: 0.6 },
      debugSingleStep: true,
    },
    {
      label: "Heavy realistic pigment",
      steps: 35,
      fixture: "woodCarved",
      size: 128,
      seed: 1337,
      stamp: (rng) => [
        ...makeStroke({
          start: { x: 0.15, y: 0.2 },
          end: { x: 0.85, y: 0.25 },
          count: 18,
          pigmentId: 1,
          brushType: "Rough",
          pressureRange: [0.55, 0.95],
          jitter: 0.015,
          rng,
        }),
        ...makeStroke({
          start: { x: 0.2, y: 0.45 },
          end: { x: 0.8, y: 0.5 },
          count: 14,
          pigmentId: 2,
          brushType: "Daubing",
          pressureRange: [0.45, 0.85],
          jitter: 0.02,
          rng,
        }),
        ...makeStroke({
          start: { x: 0.25, y: 0.7 },
          end: { x: 0.75, y: 0.75 },
          count: 16,
          pigmentId: 3,
          brushType: "Daubing",
          pressureRange: [0.5, 0.9],
          jitter: 0.02,
          rng,
        }),
        ...makeStroke({
          start: { x: 0.35, y: 0.35 },
          end: { x: 0.65, y: 0.65 },
          count: 12,
          pigmentId: 4,
          brushType: "Smudge",
          pressureRange: [0.6, 0.6],
          jitter: 0.01,
          rng,
        }),
      ],
      stepOverrides: {
        absorbency: 0.5,
        capillary: 1.35,
        poolingBias: 0.18,
        grainInfluence: 0.55,
        dryingRate: 0.015,
      },
      debugStamp: true,
      debugSingleStep: true,
    },
  ];
}

function filterScenariosForFixture(fixture) {
  const scenarios = buildScenarios();
  return scenarios.filter((scenario) => (scenario.fixture ?? fixture) === fixture);
}

function clearTreeResults() {
  treeResults.clear();
  if (!treeEl) return;
  for (const node of treeEl.querySelectorAll("button[data-label]")) {
    node.classList.remove("pass", "fail");
  }
}

function updateTreeResult(fixtureKey, label, pass) {
  if (!treeEl) return;
  const key = `${fixtureKey}::${label}`;
  treeResults.set(key, pass);
  const node = treeEl.querySelector(
    `button[data-fixture="${fixtureKey}"][data-label="${label}"]`
  );
  if (!node) return;
  node.classList.remove("pass", "fail");
  node.classList.add(pass ? "pass" : "fail");
}

function updateTreeSelection(fixtureKey, label) {
  if (!treeEl) return;
  for (const node of treeEl.querySelectorAll("button[data-label]")) {
    node.classList.toggle(
      "active",
      node.dataset.fixture === fixtureKey && node.dataset.label === label
    );
  }
  for (const fixture of treeEl.querySelectorAll(".fixture[data-fixture]")) {
    const isOpen = fixture.dataset.fixture === fixtureKey;
    fixture.classList.toggle("open", isOpen);
    const titleBtn = fixture.querySelector(".fixture-title");
    if (titleBtn) {
      titleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }
  }
}

function applyTreeFilter(queryRaw) {
  if (!treeEl) return;
  const query = String(queryRaw || "").trim().toLowerCase();
  for (const fixture of treeEl.querySelectorAll(".fixture[data-fixture]")) {
    const title = fixture.querySelector(".fixture-title")?.textContent?.toLowerCase() ?? "";
    const testButtons = Array.from(fixture.querySelectorAll("button[data-label]"));
    let matchCount = 0;
    for (const btn of testButtons) {
      const label = btn.dataset.label?.toLowerCase() ?? "";
      const match = !query || title.includes(query) || label.includes(query);
      btn.style.display = match ? "" : "none";
      if (match) matchCount += 1;
    }
    const fixtureMatch = !query || title.includes(query) || matchCount > 0;
    fixture.style.display = fixtureMatch ? "" : "none";
    if (query && matchCount > 0) {
      fixture.classList.add("open");
    } else if (query) {
      fixture.classList.remove("open");
    }
  }
}

function buildFixtureTree() {
  if (!treeEl) return;
  const controls = treeEl.querySelector("#fixtureControls");
  treeEl.textContent = "";
  if (controls) treeEl.appendChild(controls);
  const fixtureKeys = Object.keys(FIXTURE_LABELS);
  for (const fixtureKey of fixtureKeys) {
    const wrapper = document.createElement("div");
    wrapper.className = "fixture";
    wrapper.dataset.fixture = fixtureKey;
    wrapper.classList.toggle("open", currentFixture === fixtureKey);
    const header = document.createElement("div");
    header.className = "fixture-header";
    const title = document.createElement("button");
    title.type = "button";
    title.className = "fixture-title";
    title.textContent = FIXTURE_LABELS[fixtureKey] ?? fixtureKey;
    title.setAttribute("aria-expanded", currentFixture === fixtureKey ? "true" : "false");
    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "fixture-run";
    runBtn.textContent = "Run";
    runBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runFixtureTests(fixtureKey).catch((err) => {
        console.error(err);
        logError(`Error: ${err?.message || err}`);
        setStatus("error");
      });
    });
    title.addEventListener("click", () => {
      const nextOpen = !wrapper.classList.contains("open");
      for (const node of treeEl.querySelectorAll(".fixture[data-fixture]")) {
        node.classList.remove("open");
        const nodeTitle = node.querySelector(".fixture-title");
        if (nodeTitle) nodeTitle.setAttribute("aria-expanded", "false");
      }
      wrapper.classList.toggle("open", nextOpen);
      title.setAttribute("aria-expanded", nextOpen ? "true" : "false");
      currentFixture = fixtureKey;
      updateTreeSelection(fixtureKey, "");
      writeUrlParams({
        computeEnabled: !!computeToggle?.checked,
        steps: Number(stepsInput?.value ?? 10),
        size: Number(sizeInput?.value ?? 64),
        viewChannel: currentViewChannel ?? "coverage",
        fixture: fixtureKey,
      });
    });
    header.appendChild(title);
    header.appendChild(runBtn);
    wrapper.appendChild(header);
    const list = document.createElement("div");
    list.className = "fixture-list";
    const vertLabel = document.createElement("div");
    vertLabel.className = "fixture-vert-label";
    vertLabel.textContent = FIXTURE_LABELS[fixtureKey] ?? fixtureKey;
    list.appendChild(vertLabel);
    const scenarios = filterScenariosForFixture(fixtureKey);
    for (const scenario of scenarios) {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = scenario.label;
      item.dataset.fixture = fixtureKey;
      item.dataset.label = scenario.label;
      item.addEventListener("click", () => {
        currentScenarioSelection = { fixtureKey, scenario };
        runScenarioFromTree(fixtureKey, scenario).catch((err) => {
          console.error(err);
          logError(`Error: ${err?.message || err}`);
          setStatus("error");
        });
      });
      list.appendChild(item);
    }
    wrapper.appendChild(list);
    treeEl.appendChild(wrapper);
  }
  if (fixtureFilterInput?.value) {
    applyTreeFilter(fixtureFilterInput.value);
  }
}

async function runScenario({
  scenario,
  computeEnabled,
  size,
  viewChannel,
  fixture,
  stepsOverride = null,
  pigmentSet = null,
  stepOverrides = null,
  runController = null,
}) {
  const steps = Number.isFinite(stepsOverride) ? stepsOverride : scenario.steps;
  if (Array.isArray(pigmentSet) && pigmentSet.length === 4) {
    setPigmentSetInputs(pigmentSet);
  }
  log(`--- ${scenario.label} ---`);
  const stampOverrides = (() => {
    if (typeof scenario.stamp === "function") {
      const rng = makeRng(scenario.seed ?? 1337);
      return scenario.stamp(rng);
    }
    return scenario.stamp;
  })();
  const results = await main({
    computeEnabled,
    steps,
    size: scenario.size ?? size,
    viewChannel,
    stampOverrides,
    fixture: scenario.fixture ?? fixture,
    stepOverrides: { ...(scenario.stepOverrides ?? {}), ...(stepOverrides ?? {}) },
    floodFill: scenario.floodFill,
    pigmentSet: scenario.pigmentSet,
    debugStamp: scenario.debugStamp,
    allowEmptyPigmentColor: scenario.allowEmptyPigmentColor,
    validationOverrides: scenario.validation,
    runController,
  });
  if (scenario.debugSingleStep) {
    await main({
      computeEnabled,
      steps: 1,
      size: scenario.size ?? size,
      viewChannel: "none",
      stampOverrides,
      fixture: scenario.fixture ?? fixture,
      stepOverrides: { ...(scenario.stepOverrides ?? {}), ...(stepOverrides ?? {}) },
      floodFill: scenario.floodFill,
      pigmentSet: scenario.pigmentSet,
      validationOverrides: scenario.validation,
      debugSingleStep: true,
      debugLabel: `(${scenario.label})`,
      debugStamp: scenario.debugStamp,
      allowEmptyPigmentColor: scenario.allowEmptyPigmentColor,
      runController,
    });
  }
  return results;
}

async function runScenarioFromTree(fixtureKey, scenario) {
  if (activeRun && !activeRun.abort) {
    log("Run already in progress.");
    return null;
  }
  const controller = beginRun();
  currentFixture = fixtureKey;
  currentScenarioSelection = { fixtureKey, scenario };
  stepState = { key: "", index: 0, results: [] };
  logEl.textContent = "";
  setSummary("");
  fixtureErrors.length = 0;
  const computeEnabled = !!computeToggle?.checked;
  const size = Number(sizeInput?.value ?? 64);
  const stepsOverride = Number(stepsInput?.value ?? 0);
  const ambientMoisture = Number(ambientInput?.value ?? 0);
  const viewChannel = currentViewChannel ?? "coverage";
  const pigmentSet = getPigmentSet();
  writeUrlParams({
    computeEnabled,
    steps: Number.isFinite(stepsOverride) ? stepsOverride : (scenario.steps ?? 0),
    size,
    viewChannel,
    fixture: fixtureKey,
    ambientMoisture,
  });
  setStatus("running");
  updateTreeSelection(fixtureKey, scenario.label);
  const results = await runScenario({
    scenario,
    computeEnabled,
    size,
    viewChannel,
    fixture: fixtureKey,
    stepsOverride,
    pigmentSet: scenario.pigmentSet ?? pigmentSet,
    stepOverrides: { ambientMoisture },
    runController: controller,
  });
  setSummary(formatSummary([{ label: scenario.label, results }]));
  const pass = !!results?.pass;
  updateTreeResult(fixtureKey, scenario.label, pass);
  if (results?.cancelled) {
    setStatus("cancelled");
  } else {
    setStatus(pass ? "pass" : "fail");
  }
  flushErrorsToLog();
  endRun(controller);
  return results;
}

async function runFixtureTests(fixtureKey) {
  if (activeRun && !activeRun.abort) {
    log("Run already in progress.");
    return;
  }
  const controller = beginRun();
  currentFixture = fixtureKey;
  logEl.textContent = "";
  setSummary("");
  fixtureErrors.length = 0;
  clearTreeResults();
  updateTreeSelection(fixtureKey, "");
  setStatus("running");
  const computeEnabled = !!computeToggle?.checked;
  const size = Number(sizeInput?.value ?? 64);
  const stepsOverride = Number(stepsInput?.value ?? 0);
  const ambientMoisture = Number(ambientInput?.value ?? 0);
  const viewChannel = currentViewChannel ?? "coverage";
  const pigmentSet = getPigmentSet();
  const scenarios = filterScenariosForFixture(fixtureKey);
  const resultsList = [];
  for (const scenario of scenarios) {
    const results = await runScenario({
      scenario,
      computeEnabled,
      size,
      viewChannel,
      fixture: fixtureKey,
      stepsOverride,
      pigmentSet: scenario.pigmentSet ?? pigmentSet,
      stepOverrides: { ambientMoisture },
      runController: controller,
    });
    resultsList.push({ label: scenario.label, results });
    updateTreeResult(fixtureKey, scenario.label, !!results?.pass);
    await sleep(getStepDelayMs());
    if (controller.abort) break;
  }
  setSummary(formatSummary(resultsList));
  const allPass = resultsList.every((item) => item.results?.pass);
  if (controller.abort) {
    setStatus("cancelled");
  } else {
    setStatus(allPass ? "pass" : "fail");
  }
  flushErrorsToLog();
  endRun(controller);
}

async function runAll() {
  if (activeRun && !activeRun.abort) {
    log("Run already in progress.");
    return;
  }
  const controller = beginRun();
  logEl.textContent = "";
  setSummary("");
  fixtureErrors.length = 0;
  clearTreeResults();
  setStatus("running");
  const computeEnabled = !!computeToggle?.checked;
  const size = Number(sizeInput?.value ?? 64);
  const stepsOverride = Number(stepsInput?.value ?? 0);
  const ambientMoisture = Number(ambientInput?.value ?? 0);
  const viewChannel = currentViewChannel ?? "coverage";
  const pigmentSet = getPigmentSet();
  const fixture = currentFixture ?? "basic";
  const scenarios = buildScenarios();
  const resultsList = [];
  for (const scenario of scenarios) {
    const results = await runScenario({
      scenario,
      computeEnabled,
      size,
      viewChannel,
      fixture,
      stepsOverride,
      pigmentSet: scenario.pigmentSet ?? pigmentSet,
      stepOverrides: { ambientMoisture },
      runController: controller,
    });
    resultsList.push({ label: scenario.label, results });
    const fixtureKey = scenario.fixture ?? fixture;
    updateTreeResult(fixtureKey, scenario.label, !!results?.pass);
    await sleep(getStepDelayMs());
    if (controller.abort) break;
  }
  setSummary(formatSummary(resultsList));
  const allPass = resultsList.every((item) => item.results?.pass);
  if (controller.abort) {
    setStatus("cancelled");
  } else {
    setStatus(allPass ? "pass" : "fail");
  }
  flushErrorsToLog();
  endRun(controller);
}

const initial = syncControlsFromUrl();
buildFixtureTree();
updateTreeSelection(initial.fixture, "");
currentFixture = initial.fixture ?? currentFixture;
setStatus("running");
setCacheStatus("cache: empty");
main(initial)
  .then((results) => {
    setStatus(results?.pass ? "pass" : "fail");
  })
  .catch((err) => {
    console.error(err);
    logError(`Error: ${err?.message || err}`);
    setStatus("error");
  });

if (runBtn) {
  runBtn.addEventListener("click", () => {
    runFromUI().catch((err) => {
      console.error(err);
      logError(`Error: ${err?.message || err}`);
      setStatus("error");
    });
  });
}

if (runTopBtn) {
  runTopBtn.addEventListener("click", () => {
    if (activeRun && !activeRun.abort) {
      activeRun.abort = true;
      setStatus("cancelling");
      return;
    }
    const selection = currentScenarioSelection;
    if (selection?.fixtureKey && selection.scenario) {
      runScenarioFromTree(selection.fixtureKey, selection.scenario).catch((err) => {
        console.error(err);
        logError(`Error: ${err?.message || err}`);
        setStatus("error");
      });
      return;
    }
    runFromUI().catch((err) => {
      console.error(err);
      logError(`Error: ${err?.message || err}`);
      setStatus("error");
    });
  });
}

if (runAllBtn) {
  runAllBtn.addEventListener("click", () => {
    runAll().catch((err) => {
      console.error(err);
      logError(`Error: ${err?.message || err}`);
      setStatus("error");
    });
  });
}

if (stepBtn) {
  stepBtn.addEventListener("click", async () => {
    if (activeRun && !activeRun.abort) {
      log("Run already in progress.");
      return;
    }
    const controller = beginRun();
    const computeEnabled = !!computeToggle?.checked;
    const size = Number(sizeInput?.value ?? 64);
    const stepsOverride = Number(stepsInput?.value ?? 0);
    const ambientMoisture = Number(ambientInput?.value ?? 0);
    const viewChannel = currentViewChannel ?? "coverage";
    const fixture = currentFixture ?? "basic";
    const pigmentSet = getPigmentSet();
    const key = `${fixture}|${size}|${computeEnabled ? "gpu" : "cpu"}`;
    const scenarios = filterScenariosForFixture(fixture);
    if (key !== stepState.key || stepState.index >= scenarios.length) {
      stepState = { key, index: 0, results: [] };
      logEl.textContent = "";
      setSummary("");
      fixtureErrors.length = 0;
      clearTreeResults();
    }
    if (!scenarios.length) {
      log(`No scenarios available for fixture "${fixture}".`);
      setStatus("idle");
      return;
    }
    const scenario = scenarios[stepState.index];
    currentScenarioSelection = { fixtureKey: fixture, scenario };
    await sleep(getStepDelayMs());
    setStatus("running");
    runScenario({
      scenario,
      computeEnabled,
      size,
      viewChannel,
      fixture,
      stepsOverride,
      pigmentSet: scenario.pigmentSet ?? pigmentSet,
      stepOverrides: { ambientMoisture },
      runController: controller,
    })
      .then((results) => {
        stepState.results.push({ label: scenario.label, results });
        setSummary(formatSummary(stepState.results));
        const stepPassed = !!results?.pass;
        updateTreeResult(fixture, scenario.label, stepPassed);
        updateTreeSelection(fixture, scenario.label);
        flushErrorsToLog();
        if (stepPassed) {
          stepState.index += 1;
        }
        const allPass = stepState.results.every((item) => item.results?.pass);
        if (results?.cancelled) {
          setStatus("cancelled");
          endRun(controller);
          return;
        }
        if (!stepPassed) {
          setStatus("fail");
          endRun(controller);
          return;
        }
        if (stepState.index >= scenarios.length) {
          setStatus(allPass ? "pass" : "fail");
          endRun(controller);
        } else {
          setStatus("running");
          endRun(controller);
        }
      })
      .catch((err) => {
        console.error(err);
        logError(`Error: ${err?.message || err}`);
        setStatus("error");
        endRun(controller);
      });
  });
}

if (clearCacheBtn) {
  clearCacheBtn.addEventListener("click", () => {
    lastRun = null;
    setCacheStatus("cache: empty");
  });
}

if (fixtureFilterInput) {
  fixtureFilterInput.addEventListener("input", (event) => {
    applyTreeFilter(event.target.value);
  });
}

if (runCurrentBtn) {
  runCurrentBtn.addEventListener("click", () => {
    const selection = currentScenarioSelection;
    if (selection?.fixtureKey && selection.scenario) {
      runScenarioFromTree(selection.fixtureKey, selection.scenario).catch((err) => {
        console.error(err);
        logError(`Error: ${err?.message || err}`);
        setStatus("error");
      });
      return;
    }
    const fixture = currentFixture ?? "basic";
    const scenarios = filterScenariosForFixture(fixture);
    const scenario = scenarios[0];
    if (!scenario) {
      log(`No scenarios available for fixture "${fixture}".`);
      setStatus("idle");
      return;
    }
    currentScenarioSelection = { fixtureKey: fixture, scenario };
    runScenarioFromTree(fixture, scenario).catch((err) => {
      console.error(err);
      logError(`Error: ${err?.message || err}`);
      setStatus("error");
    });
  });
}

function renderPreviewGrid(run) {
  if (!run) return;
  const { cpu, gpu, inputs, size } = run;
  for (const view of PREVIEW_VIEWS) {
    const canvasEl = getPreviewCanvas(view);
    if (!canvasEl) continue;
    let channel = null;
    if (view === "height") {
      channel = inputs.height;
    } else if (view === "edge") {
      channel = inputs.edge;
    } else if (view === "grain") {
      channel = inputs.grain;
    } else if (view === "pigmentColor") {
      channel = gpu.pigmentMix ?? gpu.pigmentId;
    } else if (view === "mix0") {
      channel = gpu.pigmentMix;
    } else if (view === "mix1") {
      channel = gpu.pigmentMix;
    } else if (view === "mix2") {
      channel = gpu.pigmentMix;
    } else if (view === "mix3") {
      channel = gpu.pigmentMix;
    } else if (view === "mixSum") {
      channel = gpu.pigmentMix;
    } else if (view === "finalOutput") {
      channel = gpu.pigmentMix;
    } else {
      channel = gpu[view];
    }
    if (view === "pigmentColor") {
      if (gpu.pigmentMix) {
        drawMixPalette(canvasEl, channel, size);
      } else {
        drawPalette(canvasEl, channel, size);
      }
    } else if (view === "mix0") {
      drawMixChannel(canvasEl, channel, size, 0);
    } else if (view === "mix1") {
      drawMixChannel(canvasEl, channel, size, 1);
    } else if (view === "mix2") {
      drawMixChannel(canvasEl, channel, size, 2);
    } else if (view === "mix3") {
      drawMixChannel(canvasEl, channel, size, 3);
    } else if (view === "mixSum") {
      drawMixSum(canvasEl, channel, size);
    } else if (view === "finalOutput") {
      const gpuWet = Math.max(
        maxBufferValue(gpu.coverage),
        maxBufferValue(gpu.mass),
        maxBufferValue(gpu.stain)
      );
      const source = gpuWet > 0 ? gpu : cpu;
      if (gpuWet === 0 && source === cpu) {
        log("[finalOutput] GPU wet signal empty; previewing CPU output.");
      }
      drawFinalOutput(canvasEl, {
        mix: source.pigmentMix,
        pigmentId: source.pigmentId,
        mass: source.mass,
        stain: source.stain,
        coverage: source.coverage,
        water: source.water,
        edgePool: source.edgePool,
        grain: inputs.grain,
        size,
      });
    } else {
      if (view === "edgePool" || view === "water") {
        drawChannelNormalized(canvasEl, channel, size);
      } else {
        drawChannel(canvasEl, channel, size);
      }
    }
  }
}

function drawDiffForView(viewChannel, run) {
  if (!run || !diffView) return;
  if (!viewChannel || viewChannel === "none") return;
  const { cpu, gpu, inputs, size } = run;
  let cpuChan = null;
  let gpuChan = null;
  if (viewChannel === "height") {
    cpuChan = inputs.height;
    gpuChan = inputs.height;
  } else if (viewChannel === "edge") {
    cpuChan = inputs.edge;
    gpuChan = inputs.edge;
  } else if (viewChannel === "grain") {
    cpuChan = inputs.grain;
    gpuChan = inputs.grain;
  } else if (viewChannel === "pigmentColor") {
    cpuChan = cpu.pigmentId;
    gpuChan = gpu.pigmentId;
  } else {
    cpuChan = cpu[viewChannel];
    gpuChan = gpu[viewChannel];
  }
  drawDiff(diffView, cpuChan, gpuChan, size);
}

function drawChannel(canvasEl, channel, size) {
  if (!canvasEl || !channel) return;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  canvasEl.width = size;
  canvasEl.height = size;
  const imageData = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const v = channel[i] ?? 0;
    const base = i * 4;
    imageData.data[base] = v;
    imageData.data[base + 1] = v;
    imageData.data[base + 2] = v;
    imageData.data[base + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawChannelNormalized(canvasEl, channel, size) {
  if (!canvasEl || !channel) return;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  canvasEl.width = size;
  canvasEl.height = size;
  let max = 0;
  for (let i = 0; i < channel.length; i += 1) {
    const v = channel[i] ?? 0;
    if (v > max) max = v;
  }
  const scale = max > 0 ? 255 / max : 1;
  const imageData = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const v = Math.min(255, Math.round((channel[i] ?? 0) * scale));
    const base = i * 4;
    imageData.data[base] = v;
    imageData.data[base + 1] = v;
    imageData.data[base + 2] = v;
    imageData.data[base + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawPalette(canvasEl, channel, size) {
  if (!canvasEl || !channel) return;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  canvasEl.width = size;
  canvasEl.height = size;
  const imageData = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const id = channel[i] ?? 0;
    const color = PIGMENT_PALETTE[id % PIGMENT_PALETTE.length] ?? [0, 0, 0];
    const base = i * 4;
    imageData.data[base] = color[0];
    imageData.data[base + 1] = color[1];
    imageData.data[base + 2] = color[2];
    imageData.data[base + 3] = id === 0 ? 0 : 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawMixPalette(canvasEl, mix, size) {
  if (!canvasEl || !mix) return;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  canvasEl.width = size;
  canvasEl.height = size;
  const imageData = ctx.createImageData(size, size);
  const ids = currentPigmentSet?.length === 4 ? currentPigmentSet : DEFAULT_PIGMENT_SET;
  const c0 = ids[0] > 0 ? PIGMENT_PALETTE[ids[0] % PIGMENT_PALETTE.length] : null;
  const c1 = ids[1] > 0 ? PIGMENT_PALETTE[ids[1] % PIGMENT_PALETTE.length] : null;
  const c2 = ids[2] > 0 ? PIGMENT_PALETTE[ids[2] % PIGMENT_PALETTE.length] : null;
  const c3 = ids[3] > 0 ? PIGMENT_PALETTE[ids[3] % PIGMENT_PALETTE.length] : null;
  for (let i = 0; i < size * size; i += 1) {
    const base = i * 4;
    const mixBase = i * 4;
    const w0 = c0 ? mix[mixBase] : 0;
    const w1 = c1 ? mix[mixBase + 1] : 0;
    const w2 = c2 ? mix[mixBase + 2] : 0;
    const w3 = c3 ? mix[mixBase + 3] : 0;
    const sum = w0 + w1 + w2 + w3;
    if (sum <= 0) {
      imageData.data[base + 3] = 0;
      continue;
    }
    const r =
      ((c0?.[0] ?? 0) * w0 +
        (c1?.[0] ?? 0) * w1 +
        (c2?.[0] ?? 0) * w2 +
        (c3?.[0] ?? 0) * w3) /
      sum;
    const g =
      ((c0?.[1] ?? 0) * w0 +
        (c1?.[1] ?? 0) * w1 +
        (c2?.[1] ?? 0) * w2 +
        (c3?.[1] ?? 0) * w3) /
      sum;
    const b =
      ((c0?.[2] ?? 0) * w0 +
        (c1?.[2] ?? 0) * w1 +
        (c2?.[2] ?? 0) * w2 +
        (c3?.[2] ?? 0) * w3) /
      sum;
    imageData.data[base] = Math.round(r);
    imageData.data[base + 1] = Math.round(g);
    imageData.data[base + 2] = Math.round(b);
    imageData.data[base + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawMixChannel(canvasEl, mix, size, channelIdx) {
  if (!canvasEl || !mix) return;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  canvasEl.width = size;
  canvasEl.height = size;
  const imageData = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const base = i * 4;
    const v = mix[base + channelIdx] ?? 0;
    imageData.data[base] = v;
    imageData.data[base + 1] = v;
    imageData.data[base + 2] = v;
    imageData.data[base + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawMixSum(canvasEl, mix, size) {
  if (!canvasEl || !mix) return;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  canvasEl.width = size;
  canvasEl.height = size;
  const imageData = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const base = i * 4;
    const sum =
      (mix[base] ?? 0) +
      (mix[base + 1] ?? 0) +
      (mix[base + 2] ?? 0) +
      (mix[base + 3] ?? 0);
    const v = Math.min(255, Math.round(sum));
    imageData.data[base] = v;
    imageData.data[base + 1] = v;
    imageData.data[base + 2] = v;
    imageData.data[base + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function computeFinalOutputData({
  mix,
  pigmentId,
  mass,
  stain,
  coverage,
  water,
  edgePool,
  grain,
  size,
}) {
  if (!mass || !stain || !coverage) return null;
  const data = new Uint8ClampedArray(size * size * 4);
  const ids = currentPigmentSet?.length === 4 ? currentPigmentSet : DEFAULT_PIGMENT_SET;
  const c0 = ids[0] > 0 ? PIGMENT_PALETTE[ids[0] % PIGMENT_PALETTE.length] : null;
  const c1 = ids[1] > 0 ? PIGMENT_PALETTE[ids[1] % PIGMENT_PALETTE.length] : null;
  const c2 = ids[2] > 0 ? PIGMENT_PALETTE[ids[2] % PIGMENT_PALETTE.length] : null;
  const c3 = ids[3] > 0 ? PIGMENT_PALETTE[ids[3] % PIGMENT_PALETTE.length] : null;
  const wood = [140, 120, 100];
  for (let i = 0; i < size * size; i += 1) {
    const base = i * 4;
    let r = 0;
    let g = 0;
    let b = 0;
    let sum = 0;
    let mixSum = 0;
    if (mix) {
      const w0 = c0 ? mix[base] ?? 0 : 0;
      const w1 = c1 ? mix[base + 1] ?? 0 : 0;
      const w2 = c2 ? mix[base + 2] ?? 0 : 0;
      const w3 = c3 ? mix[base + 3] ?? 0 : 0;
      sum = w0 + w1 + w2 + w3;
      mixSum = sum / 255;
      if (sum > 0) {
        r =
          ((c0?.[0] ?? 0) * w0 +
            (c1?.[0] ?? 0) * w1 +
            (c2?.[0] ?? 0) * w2 +
            (c3?.[0] ?? 0) * w3) /
          sum;
        g =
          ((c0?.[1] ?? 0) * w0 +
            (c1?.[1] ?? 0) * w1 +
            (c2?.[1] ?? 0) * w2 +
            (c3?.[1] ?? 0) * w3) /
          sum;
        b =
          ((c0?.[2] ?? 0) * w0 +
            (c1?.[2] ?? 0) * w1 +
            (c2?.[2] ?? 0) * w2 +
            (c3?.[2] ?? 0) * w3) /
          sum;
      }
    }
    if (sum <= 0 && pigmentId) {
      const id = pigmentId[i] ?? 0;
      if (id > 0) {
        const color = PIGMENT_PALETTE[id % PIGMENT_PALETTE.length] ?? [0, 0, 0];
        r = color[0];
        g = color[1];
        b = color[2];
        sum = 1;
      }
    }
    const cov = coverage[i] / 255;
    const m = mass[i] / 255;
    const s = stain[i] / 255;
    const w = water ? (water[i] ?? 0) / 255 : 0;
    const ep = edgePool ? (edgePool[i] ?? 0) / 255 : 0;
    const wet = Math.max(cov, m, s, w, ep);
    const baseIntensity = Math.min(
      1,
      cov * 0.8 + m * 0.8 + s * 0.7 + w * 0.9 + ep * 0.9 + mixSum * 0.8
    );
    const intensity = wet > 0 ? Math.min(1, Math.max(0.8, baseIntensity + 0.3)) : 0;
    if (sum <= 0) {
      r = wood[0];
      g = wood[1];
      b = wood[2];
    }
    const grainVal = grain ? (grain[i] ?? 0) / 255 : 0.5;
    const woodMod = 0.75 + grainVal * 0.4;
    const woodR = Math.min(255, wood[0] * woodMod);
    const woodG = Math.min(255, wood[1] * woodMod);
    const woodB = Math.min(255, wood[2] * woodMod);
    const mixAmt = wet > 0 ? Math.min(1, wet * 2.8 + ep * 0.6 + w * 0.8) : 0;
    const mixBoost = Math.min(1, mixSum * 1.4);
    const finalMixAmt = Math.max(mixAmt, mixBoost);
    data[base] = Math.round(woodR * (1 - finalMixAmt) + r * finalMixAmt * intensity);
    data[base + 1] = Math.round(woodG * (1 - finalMixAmt) + g * finalMixAmt * intensity);
    data[base + 2] = Math.round(woodB * (1 - finalMixAmt) + b * finalMixAmt * intensity);
    data[base + 3] = 255;
  }
  return data;
}

function computePigmentColorData({ mix, pigmentId, size }) {
  const data = new Uint8ClampedArray(size * size * 4);
  if (mix) {
    const ids = currentPigmentSet?.length === 4 ? currentPigmentSet : DEFAULT_PIGMENT_SET;
    const c0 = PIGMENT_PALETTE[ids[0] % PIGMENT_PALETTE.length] ?? [0, 0, 0];
    const c1 = PIGMENT_PALETTE[ids[1] % PIGMENT_PALETTE.length] ?? [0, 0, 0];
    const c2 = PIGMENT_PALETTE[ids[2] % PIGMENT_PALETTE.length] ?? [0, 0, 0];
    const c3 = PIGMENT_PALETTE[ids[3] % PIGMENT_PALETTE.length] ?? [0, 0, 0];
    for (let i = 0; i < size * size; i += 1) {
      const base = i * 4;
      const w0 = mix[base] ?? 0;
      const w1 = mix[base + 1] ?? 0;
      const w2 = mix[base + 2] ?? 0;
      const w3 = mix[base + 3] ?? 0;
      const sum = w0 + w1 + w2 + w3;
      if (sum <= 0) continue;
      data[base] = Math.round((c0[0] * w0 + c1[0] * w1 + c2[0] * w2 + c3[0] * w3) / sum);
      data[base + 1] = Math.round((c0[1] * w0 + c1[1] * w1 + c2[1] * w2 + c3[1] * w3) / sum);
      data[base + 2] = Math.round((c0[2] * w0 + c1[2] * w1 + c2[2] * w2 + c3[2] * w3) / sum);
      data[base + 3] = 255;
    }
    return data;
  }
  if (pigmentId) {
    for (let i = 0; i < size * size; i += 1) {
      const base = i * 4;
      const id = pigmentId[i] ?? 0;
      if (id === 0) continue;
      const color = PIGMENT_PALETTE[id % PIGMENT_PALETTE.length] ?? [0, 0, 0];
      data[base] = color[0];
      data[base + 1] = color[1];
      data[base + 2] = color[2];
      data[base + 3] = 255;
    }
    return data;
  }
  return data;
}

function drawFinalOutput(canvasEl, {
  mix,
  pigmentId,
  mass,
  stain,
  coverage,
  water,
  edgePool,
  grain,
  size,
}) {
  if (!canvasEl || !mass || !stain || !coverage) return;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  canvasEl.width = size;
  canvasEl.height = size;
  const data = computeFinalOutputData({
    mix,
    pigmentId,
    mass,
    stain,
    coverage,
    water,
    edgePool,
    grain,
    size,
  });
  if (!data) return;
  const imageData = new ImageData(data, size, size);
  ctx.putImageData(imageData, 0, 0);
}

function drawDiff(canvasEl, cpuChan, gpuChan, size) {
  if (!canvasEl || !cpuChan || !gpuChan) return;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  canvasEl.width = size;
  canvasEl.height = size;
  const imageData = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const diff = Math.abs((cpuChan[i] ?? 0) - (gpuChan[i] ?? 0));
    const v = Math.min(255, diff * 8);
    const base = i * 4;
    imageData.data[base] = v;
    imageData.data[base + 1] = 0;
    imageData.data[base + 2] = 0;
    imageData.data[base + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function getCanvasStats(canvasEl) {
  if (!canvasEl) return null;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return null;
  const { width, height } = canvasEl;
  const data = ctx.getImageData(0, 0, width, height).data;
  let max = 0;
  let nonZero = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i];
    if (v > 0) nonZero += 1;
    if (v > max) max = v;
  }
  return { max, nonZero, width, height };
}

window.__pbpVisual = {
  getDiffStats() {
    return getCanvasStats(diffView);
  },
};
