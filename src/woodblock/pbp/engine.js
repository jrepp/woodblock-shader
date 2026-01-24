import { PBP_BUFFER_LAYOUT, PBP_TOOL_DEFAULTS } from "./types.js";

export class PbpBuffers {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pigmentId = new Uint8Array(width * height);
    this.coverage = new Uint8Array(width * height);
    this.water = new Uint8Array(width * height);
    this.mass = new Uint8Array(width * height);
    this.edgePool = new Uint8Array(width * height);
    this.stain = new Uint8Array(width * height);
  }
}

export class PbpEngine {
  constructor({ width, height }) {
    this.width = width;
    this.height = height;
    this.buffers = new PbpBuffers(width, height);
    this.dirty = { x0: 0, y0: 0, x1: width - 1, y1: height - 1, valid: false };
    this.toolState = {
      load: 1,
      pigmentId: 1,
    };
    this._nextWater = new Uint8Array(width * height);
    this._nextMass = new Uint8Array(width * height);
    this.stats = { stampMs: 0, stepMs: 0, uploadMs: 0 };
  }

  static layout() {
    return PBP_BUFFER_LAYOUT;
  }

  setPigmentId(id) {
    this.toolState.pigmentId = id;
  }

  resetLoad() {
    this.toolState.load = 1;
  }

  markDirty(x0, y0, x1, y1) {
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const x0c = clamp(x0, 0, this.width - 1);
    const y0c = clamp(y0, 0, this.height - 1);
    const x1c = clamp(x1, 0, this.width - 1);
    const y1c = clamp(y1, 0, this.height - 1);
    const d = this.dirty;
    if (!d.valid) {
      d.x0 = x0c;
      d.y0 = y0c;
      d.x1 = x1c;
      d.y1 = y1c;
      d.valid = true;
      return;
    }
    d.x0 = Math.min(d.x0, x0c);
    d.y0 = Math.min(d.y0, y0c);
    d.x1 = Math.max(d.x1, x1c);
    d.y1 = Math.max(d.y1, y1c);
  }

  consumeDirty(padding = 1) {
    if (!this.dirty.valid) return null;
    const { width, height } = this;
    const d = { ...this.dirty };
    this.dirty.valid = false;
    return {
      x0: Math.max(0, d.x0 - padding),
      y0: Math.max(0, d.y0 - padding),
      x1: Math.min(width - 1, d.x1 + padding),
      y1: Math.min(height - 1, d.y1 + padding),
    };
  }

  stamp({
    uv,
    brushType,
    pressure = 1,
    inkMask = null,
    heightU8 = null,
    lowMin = 0.55,
    lowMax = 0.8,
    reliefBias = 1.0,
    edgeTex = null,
    grainTex = null,
    grainSize = 512,
    direction = { x: 1, y: 0 },
  }) {
    const start = typeof performance !== "undefined" ? performance.now() : 0;
    const tool = PBP_TOOL_DEFAULTS[brushType] ?? PBP_TOOL_DEFAULTS.Daubing;
    const cx = Math.floor(uv.x * this.width);
    const cy = Math.floor((1 - uv.y) * this.height);
    const radiusPx = Math.max(1, Math.floor(tool.radius * Math.min(this.width, this.height)));
    const { pigmentId, coverage, water, mass, edgePool } = this.buffers;
    const base = tool.baseDeposit ?? 0.4;
    const load = this.toolState.load;

    if (brushType === "Smudge") {
      const smear = tool.smearStrength ?? 0.6;
      const lift = tool.liftStrength ?? 0.2;
      const dirX = Math.sign(direction.x) || 1;
      const dirY = Math.sign(direction.y) || 0;
      for (let y = -radiusPx; y <= radiusPx; y += 1) {
        for (let x = -radiusPx; x <= radiusPx; x += 1) {
          const px = cx + x;
          const py = cy + y;
          if (px < 1 || py < 1 || px >= this.width - 1 || py >= this.height - 1) continue;
          const dist = Math.sqrt(x * x + y * y) / radiusPx;
          if (dist > 1) continue;
          const falloff = Math.pow(1 - dist, tool.edgeSoftness ?? 0.85);
          const idx = py * this.width + px;
          const target = idx + dirX + dirY * this.width;
          const blendedMass = mass[idx] * (1 - smear) + mass[target] * smear;
          const blendedCoverage = coverage[idx] * (1 - smear) + coverage[target] * smear;
          mass[idx] = Math.max(0, blendedMass - lift * 10 * falloff);
          coverage[idx] = Math.max(0, blendedCoverage - lift * 8 * falloff);
          pigmentId[idx] = pigmentId[idx] || this.toolState.pigmentId;
        }
      }
      this.markDirty(cx - radiusPx, cy - radiusPx, cx + radiusPx, cy + radiusPx);
      return;
    }

    for (let y = -radiusPx; y <= radiusPx; y += 1) {
      for (let x = -radiusPx; x <= radiusPx; x += 1) {
        const px = cx + x;
        const py = cy + y;
        if (px < 0 || py < 0 || px >= this.width || py >= this.height) continue;
        const dist = Math.sqrt(x * x + y * y) / radiusPx;
        if (dist > 1) continue;
        const falloff = Math.pow(1 - dist, tool.edgeSoftness ?? 0.75);
        const idx = py * this.width + px;
        const ink = inkMask ? inkMask[idx] / 255 : 0;
        const h = heightU8 ? heightU8[idx] / 255 : 0.5;
        const inv = 1 / Math.max(0.001, lowMax - lowMin);
        const relief = heightU8 ? Math.max(0, Math.min(1, (lowMax - h) * inv)) : 1.0;
        const grain = grainTex
          ? grainTex[(py % grainSize) * grainSize + (px % grainSize)] / 255
          : 0.5;
        const suppress = 1 - (tool.inkSuppression ?? 0.8) * ink;
        const ridge = edgeTex ? edgeTex[idx] / 255 : 0;
        const topo = Math.max(
          0.1,
          Math.min(1.4, 0.35 + relief * 0.9 * reliefBias - ridge * 0.4)
        );
        const deposit =
          base * falloff * pressure * load * suppress * topo * (0.85 + grain * 0.3);
        const next = Math.min(255, coverage[idx] + deposit * 255);
        coverage[idx] = next;
        mass[idx] = Math.min(255, mass[idx] + deposit * 200);
        water[idx] = Math.min(255, water[idx] + deposit * 120);
        if (edgeTex) {
          const edge = edgeTex[idx] / 255;
          edgePool[idx] = Math.min(255, edgePool[idx] + edge * 30 * deposit);
        }
        pigmentId[idx] = this.toolState.pigmentId;
      }
    }

    this.toolState.load = Math.max(0, load - (tool.loadDecay ?? 0.08));
    this.markDirty(cx - radiusPx, cy - radiusPx, cx + radiusPx, cy + radiusPx);
    if (start) {
      const dt = performance.now() - start;
      this.stats.stampMs = this.stats.stampMs ? this.stats.stampMs * 0.9 + dt * 0.1 : dt;
    }
  }

  autoFillSeed({ heightU8, edgeU8, grainU8, grainSize = 512, lowMin = 0.55, lowMax = 0.8 }) {
    const { width, height } = this;
    const { pigmentId, coverage, water, mass, edgePool, stain } = this.buffers;
    for (let i = 0; i < coverage.length; i += 1) {
      coverage[i] = 0;
      water[i] = 0;
      mass[i] = 0;
      edgePool[i] = 0;
      stain[i] = 0;
      pigmentId[i] = 0;
    }
    const inv = 1 / Math.max(0.001, lowMax - lowMin);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const h = heightU8[i] / 255;
        if (h > lowMax) continue;
        const t = Math.max(0, Math.min(1, (lowMax - h) * inv));
        const grain = grainU8
          ? grainU8[(y % grainSize) * grainSize + (x % grainSize)] / 255
          : 0.5;
        const edge = edgeU8 ? edgeU8[i] / 255 : 0;
        const cov = Math.min(1, t * (0.6 + grain * 0.2));
        coverage[i] = Math.round(cov * 255);
        mass[i] = Math.round(cov * 220);
        water[i] = Math.round(cov * 160);
        edgePool[i] = Math.round(edge * 60);
        pigmentId[i] = this.toolState.pigmentId || 1;
      }
    }
    this.markDirty(0, 0, width - 1, height - 1);
  }

  step({
    absorbency = 0.35,
    capillary = 1.0,
    poolingBias = 0.1,
    stainRate = 0.02,
    dryingRate = 0.02,
    massRetention = 0.85,
    grainInfluence = 0.3,
    edgeTex = null,
    grainTex = null,
    grainSize = 512,
  }) {
    const start = typeof performance !== "undefined" ? performance.now() : 0;
    const { width, height } = this;
    const { water, mass, edgePool, stain } = this.buffers;
    const nextWater = this._nextWater;
    const nextMass = this._nextMass;
    const dirty = this.consumeDirty(1) || { x0: 1, y0: 1, x1: width - 2, y1: height - 2 };

    for (let y = Math.max(1, dirty.y0); y <= Math.min(height - 2, dirty.y1); y += 1) {
      for (let x = Math.max(1, dirty.x0); x <= Math.min(width - 2, dirty.x1); x += 1) {
        const i = y * width + x;
        const w = water[i] / 255;
        const m = mass[i] / 255;
        const grain = grainTex
          ? grainTex[(y % grainSize) * grainSize + (x % grainSize)] / 255
          : 0.5;
        const spread = w * absorbency * capillary * (0.85 + grain * grainInfluence);
        const kernel = [
          (y - 1) * width + x,
          (y + 1) * width + x,
          y * width + (x - 1),
          y * width + (x + 1),
        ];
        let total = m;
        for (const k of kernel) {
          total += (mass[k] / 255) * spread * 0.25;
        }
        const pooled = edgeTex ? (edgeTex[i] / 255) * m : 0;
        edgePool[i] = Math.min(255, edgePool[i] + pooled * 255 * poolingBias);
        const stainAdd = m * absorbency * stainRate;
        stain[i] = Math.min(255, stain[i] + stainAdd * 255);
        nextMass[i] = Math.min(255, total * 255 * massRetention);
        nextWater[i] = Math.max(0, (w - dryingRate) * 255);
      }
    }

    for (let y = Math.max(1, dirty.y0); y <= Math.min(height - 2, dirty.y1); y += 1) {
      const row = y * width;
      for (let x = Math.max(1, dirty.x0); x <= Math.min(width - 2, dirty.x1); x += 1) {
        const i = row + x;
        mass[i] = nextMass[i];
        water[i] = nextWater[i];
      }
    }
    this.markDirty(dirty.x0, dirty.y0, dirty.x1, dirty.y1);
    if (start) {
      const dt = performance.now() - start;
      this.stats.stepMs = this.stats.stepMs ? this.stats.stepMs * 0.9 + dt * 0.1 : dt;
    }
    return dirty;
  }
}
