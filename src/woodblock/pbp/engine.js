import { PBP_BUFFER_LAYOUT, PBP_TOOL_DEFAULTS } from "./types.js";
import { DEFAULT_PIGMENT_SET, normalizePigmentSet, getBrushPreset, PBP_STEP_DEFAULTS } from "./settings.js";
import { applyPressureCurve, computeSpacingPx } from "./brushConfig.js";

export class PbpBuffers {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pigmentId = new Uint8Array(width * height);
    this.pigmentMix = new Uint8Array(width * height * 4);
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
      pigmentSet: [...DEFAULT_PIGMENT_SET],
    };
    this._nextWater = new Uint8Array(width * height);
    this._nextMass = new Uint8Array(width * height);
    this._nextMix = new Uint8Array(width * height * 4);
    this.stats = { stampMs: 0, stepMs: 0, uploadMs: 0 };
    this._stroke = null;
  }

  static layout() {
    return PBP_BUFFER_LAYOUT;
  }

  setPigmentId(id) {
    this.toolState.pigmentId = id;
  }

  setPigmentSet(ids) {
    this.toolState.pigmentSet = normalizePigmentSet(ids);
  }

  resetLoad() {
    this.toolState.load = 1;
  }

  beginStroke({ uv, pressure = 1, brushType, ...rest }) {
    this.resetLoad();
    this._stroke = { uv: { ...uv }, pressure: pressure ?? 1, brushType: brushType ?? "Daubing" };
    this._applyStrokeStamp({ uv, pressure, brushType, ...rest });
  }

  continueStroke({ uv, pressure = 1, brushType, ...rest }) {
    if (!this._stroke) {
      this.beginStroke({ uv, pressure, brushType, ...rest });
      return;
    }
    const last = this._stroke;
    const preset = getBrushPreset(brushType ?? last.brushType);
    const radiusPx = this._brushRadiusPx(brushType ?? last.brushType);
    const spacing = computeSpacingPx(radiusPx, preset.input.spacingRatio, preset.input.maxSpacingRatio);
    const dx = (uv.x - last.uv.x) * this.width;
    const dy = (uv.y - last.uv.y) * this.height;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = spacing > 0 ? Math.floor(dist / spacing) : 0;
    for (let i = 1; i <= steps; i += 1) {
      const t = steps === 0 ? 1 : i / steps;
      const lerpUv = {
        x: last.uv.x + (uv.x - last.uv.x) * t,
        y: last.uv.y + (uv.y - last.uv.y) * t,
      };
      const lerpPressure = last.pressure + (pressure - last.pressure) * t;
      this._applyStrokeStamp({ uv: lerpUv, pressure: lerpPressure, brushType: brushType ?? last.brushType, ...rest });
    }
    this._stroke = { uv: { ...uv }, pressure: pressure ?? 1, brushType: brushType ?? last.brushType };
  }

  endStroke() {
    this._stroke = null;
  }

  _brushRadiusPx(brushType) {
    const tool = PBP_TOOL_DEFAULTS[brushType] ?? PBP_TOOL_DEFAULTS.Daubing;
    return Math.max(1, Math.floor(tool.radius * Math.min(this.width, this.height)));
  }

  _applyStrokeStamp({ uv, pressure = 1, brushType, ...rest }) {
    const preset = getBrushPreset(brushType);
    const curved = applyPressureCurve(pressure, preset.input.pressureCurve);
    this.stamp({ uv, pressure: curved, brushType, ...rest });
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
    const { pigmentId, pigmentMix, coverage, water, mass, edgePool, stain } = this.buffers;
    const base = tool.baseDeposit ?? 0.4;
    const load = this.toolState.load;
    const stainSeed = PBP_STEP_DEFAULTS.stainSeed ?? 0;

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
          const mixBase = idx * 4;
          const mixTarget = target * 4;
          for (let c = 0; c < 4; c += 1) {
            const blended = pigmentMix[mixBase + c] * (1 - smear) + pigmentMix[mixTarget + c] * smear;
            pigmentMix[mixBase + c] = Math.max(0, Math.min(255, blended - lift * 6 * falloff));
          }
          pigmentId[idx] = pigmentId[idx] || this.toolState.pigmentId;
        }
      }
      this.markDirty(cx - radiusPx, cy - radiusPx, cx + radiusPx, cy + radiusPx);
      return;
    }

    const pigmentSet = this.toolState.pigmentSet ?? DEFAULT_PIGMENT_SET;
    let pigmentSlot = pigmentSet.indexOf(this.toolState.pigmentId);
    if (pigmentSlot < 0) {
      pigmentSet[0] = this.toolState.pigmentId;
      pigmentSlot = 0;
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
        if (stainSeed > 0) {
          stain[idx] = Math.min(255, stain[idx] + deposit * 255 * stainSeed);
        }
        if (edgeTex) {
          const edge = edgeTex[idx] / 255;
          edgePool[idx] = Math.min(255, edgePool[idx] + edge * 30 * deposit);
        }
        const mixBase = idx * 4;
        const add = deposit * 255;
        pigmentMix[mixBase + pigmentSlot] = Math.min(255, pigmentMix[mixBase + pigmentSlot] + add);
        const sum =
          pigmentMix[mixBase] +
          pigmentMix[mixBase + 1] +
          pigmentMix[mixBase + 2] +
          pigmentMix[mixBase + 3];
        if (sum > 255) {
          const scale = 255 / sum;
          pigmentMix[mixBase] = Math.round(pigmentMix[mixBase] * scale);
          pigmentMix[mixBase + 1] = Math.round(pigmentMix[mixBase + 1] * scale);
          pigmentMix[mixBase + 2] = Math.round(pigmentMix[mixBase + 2] * scale);
          pigmentMix[mixBase + 3] = Math.round(pigmentMix[mixBase + 3] * scale);
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
    const { pigmentId, pigmentMix, coverage, water, mass, edgePool, stain } = this.buffers;
    for (let i = 0; i < coverage.length; i += 1) {
      coverage[i] = 0;
      water[i] = 0;
      mass[i] = 0;
      edgePool[i] = 0;
      stain[i] = 0;
      pigmentId[i] = 0;
    }
    pigmentMix.fill(0);
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
        const mixBase = i * 4;
        const pigmentSet = this.toolState.pigmentSet ?? DEFAULT_PIGMENT_SET;
        let slot = pigmentSet.indexOf(this.toolState.pigmentId);
        if (slot < 0) slot = 0;
        pigmentMix[mixBase] = 0;
        pigmentMix[mixBase + 1] = 0;
        pigmentMix[mixBase + 2] = 0;
        pigmentMix[mixBase + 3] = 0;
        pigmentMix[mixBase + slot] = 255;
      }
    }
    this.markDirty(0, 0, width - 1, height - 1);
  }

  step({
    absorbency = PBP_STEP_DEFAULTS.absorbency,
    capillary = PBP_STEP_DEFAULTS.capillary,
    poolingBias = PBP_STEP_DEFAULTS.poolingBias,
    stainRate = PBP_STEP_DEFAULTS.stainRate,
    dryingRate = PBP_STEP_DEFAULTS.dryingRate,
    massRetention = PBP_STEP_DEFAULTS.massRetention,
    grainInfluence = PBP_STEP_DEFAULTS.grainInfluence,
    ambientMoisture = PBP_STEP_DEFAULTS.ambientMoisture,
    heightInfluence = PBP_STEP_DEFAULTS.heightInfluence,
    edgeBarrier = PBP_STEP_DEFAULTS.edgeBarrier,
    valleyBias = PBP_STEP_DEFAULTS.valleyBias,
    edgeTex = null,
    grainTex = null,
    heightU8 = null,
    grainSize = 512,
  }) {
    const start = typeof performance !== "undefined" ? performance.now() : 0;
    const { width, height } = this;
    const { water, mass, edgePool, stain, pigmentMix, pigmentId } = this.buffers;
    const nextWater = this._nextWater;
    const nextMass = this._nextMass;
    const nextMix = this._nextMix;
    const dirty = this.consumeDirty(1) || { x0: 1, y0: 1, x1: width - 2, y1: height - 2 };
    const pigmentSet = this.toolState.pigmentSet ?? DEFAULT_PIGMENT_SET;

    for (let y = Math.max(1, dirty.y0); y <= Math.min(height - 2, dirty.y1); y += 1) {
      for (let x = Math.max(1, dirty.x0); x <= Math.min(width - 2, dirty.x1); x += 1) {
        const i = y * width + x;
        const w = water[i] / 255;
        const m = mass[i] / 255;
        const grain = grainTex
          ? grainTex[(y % grainSize) * grainSize + (x % grainSize)] / 255
          : 0.5;
        let spread = w * absorbency * capillary * (0.85 + grain * grainInfluence);
        const edge = edgeTex ? edgeTex[i] / 255 : 0;
        const h = heightU8 ? heightU8[i] / 255 : 0.5;
        const relief = heightU8 ? 1 - h : 0;
        if (edgeBarrier > 0) {
          spread *= 1 + edge * edgeBarrier;
        }
        if (heightU8 && heightInfluence > 0) {
          spread *= 0.6 + relief * heightInfluence;
        }
        const idxN = (y - 1) * width + x;
        const idxS = (y + 1) * width + x;
        const idxW = y * width + (x - 1);
        const idxE = y * width + (x + 1);
        let wN = 1;
        let wS = 1;
        let wW = 1;
        let wE = 1;
        if (grainTex && grainInfluence > 0) {
          const gN = grainTex[((y - 1) % grainSize) * grainSize + (x % grainSize)] / 255;
          const gS = grainTex[((y + 1) % grainSize) * grainSize + (x % grainSize)] / 255;
          const gW = grainTex[(y % grainSize) * grainSize + ((x - 1) % grainSize)] / 255;
          const gE = grainTex[(y % grainSize) * grainSize + ((x + 1) % grainSize)] / 255;
          const bias = grainInfluence;
          wN = Math.max(0.2, Math.min(1.8, 1 + (gN - grain) * bias));
          wS = Math.max(0.2, Math.min(1.8, 1 + (gS - grain) * bias));
          wW = Math.max(0.2, Math.min(1.8, 1 + (gW - grain) * bias));
          wE = Math.max(0.2, Math.min(1.8, 1 + (gE - grain) * bias));
        }
        if (heightU8 && heightInfluence > 0) {
          const hC = h;
          const hN = heightU8[idxN] / 255;
          const hS = heightU8[idxS] / 255;
          const hW = heightU8[idxW] / 255;
          const hE = heightU8[idxE] / 255;
          const slopeScale = heightInfluence * 1.5;
          const sN = Math.max(-0.7, Math.min(0.7, (hC - hN) * slopeScale));
          const sS = Math.max(-0.7, Math.min(0.7, (hC - hS) * slopeScale));
          const sW = Math.max(-0.7, Math.min(0.7, (hC - hW) * slopeScale));
          const sE = Math.max(-0.7, Math.min(0.7, (hC - hE) * slopeScale));
          wN = Math.max(0.1, Math.min(2.2, wN * (1 + sN)));
          wS = Math.max(0.1, Math.min(2.2, wS * (1 + sS)));
          wW = Math.max(0.1, Math.min(2.2, wW * (1 + sW)));
          wE = Math.max(0.1, Math.min(2.2, wE * (1 + sE)));
        }
        const wSum = wN + wS + wW + wE;
        const norm = wSum > 0 ? 1 / wSum : 0.25;
        let total = m;
        const mN = (mass[idxN] / 255) * spread * wN * norm;
        const mS = (mass[idxS] / 255) * spread * wS * norm;
        const mW = (mass[idxW] / 255) * spread * wW * norm;
        const mE = (mass[idxE] / 255) * spread * wE * norm;
        total += mN + mS + mW + mE;
        const pooled = edgeTex ? edge * m : 0;
        const pooledEdgeMass = pooled * poolingBias;
        const pooledValleyMass = relief * m * valleyBias;
        const pooledMass = pooledEdgeMass + pooledValleyMass;
        edgePool[i] = Math.min(255, edgePool[i] + pooledEdgeMass * 255);
        const stainAdd = m * absorbency * stainRate;
        stain[i] = Math.min(255, stain[i] + stainAdd * 255);
        nextMass[i] = Math.min(255, (total + pooledMass) * 255 * massRetention);
        const nextW = Math.max(ambientMoisture, w - dryingRate);
        nextWater[i] = Math.max(0, nextW * 255);

        const base = i * 4;
        const baseN = idxN * 4;
        const baseS = idxS * 4;
        const baseW = idxW * 4;
        const baseE = idxE * 4;
        const mixLocal = [
          pigmentMix[base] / 255,
          pigmentMix[base + 1] / 255,
          pigmentMix[base + 2] / 255,
          pigmentMix[base + 3] / 255,
        ];
        const mixN = [
          pigmentMix[baseN] / 255,
          pigmentMix[baseN + 1] / 255,
          pigmentMix[baseN + 2] / 255,
          pigmentMix[baseN + 3] / 255,
        ];
        const mixS = [
          pigmentMix[baseS] / 255,
          pigmentMix[baseS + 1] / 255,
          pigmentMix[baseS + 2] / 255,
          pigmentMix[baseS + 3] / 255,
        ];
        const mixW = [
          pigmentMix[baseW] / 255,
          pigmentMix[baseW + 1] / 255,
          pigmentMix[baseW + 2] / 255,
          pigmentMix[baseW + 3] / 255,
        ];
        const mixE = [
          pigmentMix[baseE] / 255,
          pigmentMix[baseE + 1] / 255,
          pigmentMix[baseE + 2] / 255,
          pigmentMix[baseE + 3] / 255,
        ];
        const totals = [0, 0, 0, 0];
        for (let c = 0; c < 4; c += 1) {
          const local = m * mixLocal[c];
          const n = mN * mixN[c];
          const s = mS * mixS[c];
          const wMass = mW * mixW[c];
          const e = mE * mixE[c];
          totals[c] = local + n + s + wMass + e;
        }
        if (total > 0) {
          nextMix[base] = Math.round((totals[0] / total) * 255);
          nextMix[base + 1] = Math.round((totals[1] / total) * 255);
          nextMix[base + 2] = Math.round((totals[2] / total) * 255);
          nextMix[base + 3] = Math.round((totals[3] / total) * 255);
        } else {
          nextMix[base] = 0;
          nextMix[base + 1] = 0;
          nextMix[base + 2] = 0;
          nextMix[base + 3] = 0;
        }
      }
    }

    for (let y = Math.max(1, dirty.y0); y <= Math.min(height - 2, dirty.y1); y += 1) {
      const row = y * width;
      for (let x = Math.max(1, dirty.x0); x <= Math.min(width - 2, dirty.x1); x += 1) {
        const i = row + x;
        mass[i] = nextMass[i];
        water[i] = nextWater[i];
        const base = i * 4;
        pigmentMix[base] = nextMix[base];
        pigmentMix[base + 1] = nextMix[base + 1];
        pigmentMix[base + 2] = nextMix[base + 2];
        pigmentMix[base + 3] = nextMix[base + 3];
        let maxIdx = -1;
        let maxVal = 0;
        for (let c = 0; c < 4; c += 1) {
          const v = pigmentMix[base + c];
          if (v > maxVal) {
            maxVal = v;
            maxIdx = c;
          }
        }
        pigmentId[i] = maxIdx >= 0 && maxVal > 0 ? pigmentSet[maxIdx] : 0;
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
