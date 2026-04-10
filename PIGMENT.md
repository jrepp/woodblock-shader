# Pigment & Media Interaction Model  
### Woodblock / Hand-Illuminated Print Rendering

This document defines the **design and material intent** for modeling pigment behavior and its interaction with ink, paper, and carved relief in the *woodblock shader* pipeline.  
It is intended as a **reference contract** for shader authors, Blender asset preparation, and future WebGPU implementations.

The goal is **believability**, not photorealism: the output should read as a *printed physical artifact*, not a modern digital illustration.

---

## 1. Conceptual framing

**Pigment is not “color.”**  
Pigment is particulate matter suspended in a binder, applied by hand onto paper that has already received ink from a carved woodblock.

Key implication:

> Every pigment decision must reinforce *imperfection, limitation, and physical interaction*.

---

## 2. Core material layers (stack order)

The visual stack **must** follow this order:

1. **Paper substrate**
2. **Pigment stains**
3. **Ink overprint (linework)**
4. **Lighting & relief response**
5. **Optional aging / vignette**

Violating this order will immediately break authenticity.

---

## 2.1 Runtime texture/field inventory (current pipeline)

| ID | Texture / Field | Type | Produced by | Stores | Used by |
|---|---|---|---|---|---|
| T01 | `heightTex` | R8 DataTexture | Line art → height build | Relief height map (0..1) | Relief shading, edge/cavity/flow builds |
| T02 | `normalTex` | RGBA8 DataTexture | Height → normal build | Surface normals | Lighting, specular, relief response |
| T03 | `edgeTex` | R8 DataTexture | Height → edge build | Height gradient / ridge edges | Pigment edge pooling, ink emphasis |
| T04 | `cavityTex` | R8 DataTexture | Height → cavity build | Concavity / valleys | Tonal depth + pigment darkening |
| T05 | `poolingTex` | R8 DataTexture | Height → pooling build | Pooling propensity | Pigment pooling modulation |
| T06 | `flowTex` | RG8 DataTexture | Height → flow build | Flow direction (xy) | Directional spread / pooling |
| T07 | `pigmentMaskTex` | RGBA8 DataTexture | Palette + height (auto-fill) | Per‑pigment placement mask | Pigment blending / placement |
| T08 | `paintTex` | CanvasTexture | Brush strokes | User paint mask (0..1) | Pigment influence / override |
| T09 | `grainTex` | R8 DataTexture | Procedural grain | Grain intensity | Edge breakup, pigment modulation |
| T10 | `woodColorTex` | RGBA8 DataTexture | Grain from source | Wood tint + variation | Base substrate tint |
| T11 | `paperTex` | R8 DataTexture | Procedural fiber | Fiber noise | Absorbency variation (legacy “paper”) |
| T12 | `pigmentNoiseTex` | R8 DataTexture | Procedural noise | Speckle/mottle | Pigment granularity |

Notes:
- We do **not** yet have explicit PBP fields for water/pigment_mass/edge_pool/paper_stain. Those are approximated via shader math using T01–T12 + scalar controls.

---

## 2.2 PBP simulation overview (target)

**Physically Based Painting (PBP)** models pigment as material that *moves, deposits, and binds* based on tool + substrate.  
The minimal runtime fields we should simulate (or approximate) per stroke are:

- `coverage` (thickness proxy)
- `water` (wetness field)
- `pigment_mass` (particulate density)
- `edge_pool` (local accumulation)
- `stain` (absorbed vs surface pigment)

**Inter‑dependencies**
- `relief_height` → drives pooling, suppression near ink ridges.
- `relief_gradient`/`edgeTex` → boosts `edge_pool`.
- `grainTex`/`paperTex` → modulate coverage and stain.
- `paintTex` → authoring mask; combines with `pigmentMaskTex`.
- `pigmentNoiseTex` → introduces granularity tied to `granularity` control.

**Computational approach**
- CPU path: update a small set of R8/RG8 buffers per stroke (or per dab) and bake to textures.
- GPU path (future): compute shaders for `coverage/water/edge_pool` with stamp kernels and relief-aware diffusion.
- Shader uses these fields to blend pigment with wood + ink in a constrained, non‑opaque way.

---

## 2.2.1 PBP buffer layout (single-index pigments)

Target minimal buffer pack (CPU first, GPU later). All textures are **wood‑space** (UV of the woodblock plane).

| Buffer | Format | Channels | Meaning |
|---|---|---|---|
| `pbpPigmentId` | R8 | `id` | Selected pigment index (0..255), 0 = none |
| `pbpCoverage` | R8 | `coverage` | Pigment thickness proxy (0..1) |
| `pbpWater` | R8 | `water` | Wetness field (0..1) |
| `pbpMass` | R8 | `mass` | Particulate density (0..1) |
| `pbpEdgePool` | R8 | `pool` | Edge accumulation (0..1) |
| `pbpStain` | R8 | `stain` | Absorbed fraction (0..1) |

---

## 2.2.1a PBP buffer layout (4‑pigment weighted mix) — **in progress**

We are moving to a **weighted mix model** so a single cell can contain multiple pigments.
This preserves palette identity while enabling real mixing and layered strokes.

**Core changes**
- Replace single `pbpPigmentId` with **RGBA weights** (4 pigments per cell).
- Keep a small **active pigment set** (4 entries) that map weights → palette IDs.
- `mass/coverage/stain/edge_pool/water` remain unchanged.

**Buffers**

| Buffer | Format | Channels | Meaning |
|---|---|---|---|
| `pbpPigmentMix` | RGBA8 | `w0,w1,w2,w3` | Per‑cell weights for 4 active pigments (0..255) |
| `pbpPigmentSet` | Uniform | `id0,id1,id2,id3` | Active pigment IDs (palette indices) |
| `pbpCoverage` | R8 | `coverage` | Pigment thickness proxy (0..1) |
| `pbpWater` | R8 | `water` | Wetness field (0..1) |
| `pbpMass` | R8 | `mass` | Particulate density (0..1) |
| `pbpEdgePool` | R8 | `pool` | Edge accumulation (0..1) |
| `pbpStain` | R8 | `stain` | Absorbed fraction (0..1) |

**Mixing rules (draft)**
- Stamp deposits **weighted color** into `pbpPigmentMix` in proportion to brush load and pigment concentration.
- When multiple pigments overlap, weights **accumulate and renormalize** to preserve total mass/coverage.
- `pbpMass` is the scalar magnitude; `pbpPigmentMix` is the distribution.
- `pbpStain` stores absorbed mass; **stain inherits mix weights** (same ratio as surface).

**Shader read**
- Convert active pigment IDs → palette colors.
- Blend colors by normalized weights, then modulate by `coverage`/`mass`.
- Edge pooling uses `edge_pool` to darken and bias toward heavier pigments.

**Progress note**
- Docs updated to weighted mix spec.
- Next step is to add `pbpPigmentMix` to CPU/GPU buffers and update stamp/step kernels.

**Optional pack (later)**  
`pbpFlow` (RG8) stores flow direction or smear vector; `pbpVelocity` (RG8) for brush‑driven redistribution.

**Shader usage (draft)**
- Final pigment alpha = `coverage * pigmentAlpha * (1 - inkMask)`.
- Pigment chroma clamp uses `mass` and `stain` to darken pooled areas.
- Edge pooling boosts darkening near relief edges: `pool * edgeTex`.
- Wood grain modulates coverage and pool.

---

## 2.2.2 Time‑stepped update (CPU)

Each frame (or stroke step) advances PBP fields:

1. **Deposition**: stamp kernel adds pigment id + coverage + mass + water.
2. **Diffusion** (wood capillary): spread `water` + `mass` along grain + relief flow.
3. **Pooling**: edgeTex/flowTex increases `edgePool` where gradients are steep.
4. **Staining**: a fraction of `mass` becomes `stain` based on wood absorbency.
5. **Drying**: `water` decays; once dry, `stain` locks, surface `coverage` reduces.

Auto‑fill can seed `pbpCoverage/pbpMass/pbpPigmentId` using the height‑derived mask, then allow diffusion/pooling to stabilize over several ticks.

---

## 2.2.3 Performance & profiling (PBP)

**Optimization checklist**
- Update only brush AABB (+ margin).
- Precompute kernel weights per brush size/type.
- Keep buffers in `Uint8Array` and reuse.
- Separate simulation tick from render tick (20–30 Hz vs 60 Hz).
- Batch texture uploads (sub‑image updates).

**Profiling counters**
- `stamp_ms`, `diffuse_ms`, `upload_ms`, `total_ms`
- Track average + peak per minute for regression detection.

## 2.3 Wood substrate considerations (vs paper)
## 2.3 Wood substrate considerations (vs paper)

We currently refer to “paper” properties, but the **substrate is wood**.  
We should model wood‑specific fields and map them to existing controls:

| Wood property | Suggested mapping |
|---|---|
| `wood_pore_absorbency` | replace `paper_absorbency` |
| `wood_fiber_scale` | replace `paper_fiber_scale` |
| `wood_roughness` | replace `paper_roughness` |
| `grain_direction` | already represented via `grainTex` / `woodColorTex` |

Wood is less capillary than paper; **spread should be lower** and **pooling more localized**.

---

## 2.4 Auto‑fill + capillary guidance (wood)

Auto‑fill should not be a static mask. It should:
1. Seed `pbpPigmentId` + `pbpCoverage` in low‑relief areas (`heightTex`).
2. Seed `pbpWater` and `pbpMass` at low intensity.
3. Run time‑steps that flow **along grain/flowTex**, not isotropic.
4. Increase `pbpEdgePool` where `edgeTex` is high.

This produces believable boundary pooling and subtle coverage bleed along the grain.

## 3. Pigment material properties

Pigments are modeled as **translucent stains**, not opaque paint.

### Required pigment attributes

| Property | Description | Visual consequence |
|--------|-------------|--------------------|
| Hue | Pigment identity | Earthy, mineral tones |
| Value bias | Intrinsic darkness | Reds darker than yellows |
| Chroma ceiling | Saturation limit | Prevents modern vibrancy |
| Opacity | Pigment density | Never fully opaque |
| Granularity | Particle size | Speckle / mottling |
| Transparency curve | Thickness response | Darker where pooled |

**Rules**
- Pigment must never completely obscure ink.
- Pigment must never appear as flat RGBA fills.
- Saturation must be constrained globally.

---

## 4. Pigment application behavior (human-driven)

Pigment is applied **by hand**, introducing irregularity.

### Coverage variation
- Uneven pressure
- Missed fibers
- Overlaps and thin regions

**Model as**
- Low-frequency blotch noise
- Medium-frequency pigment noise
- Subtle directional bias (optional)

### Registration error (critical cue)

Pigment does **not** align perfectly with ink.

| Parameter | Typical scale |
|---------|---------------|
| UV offset | 0.25–1.5 px |
| Direction | Per pigment layer |
| Stability | Constant (non-animated) |

This is one of the **strongest authenticity signals**.

---

## 5. Pigment ↔ ink interaction

Ink prints first and is dominant.

### Ink dominance rules
- Ink always visually overrides pigment
- Pigment is suppressed near ink ridges
- Pigment may accumulate *around* ink edges

### Edge pooling (capillary action)
Pigment collects near relief boundaries.

**Model as**
- Increased pigment density near height gradients
- Slight darkening at ridge edges

---

## 6. Pigment ↔ paper interaction

Paper is an active participant.

### Paper properties

| Property | Visual effect |
|--------|---------------|
| Base tone | Warm off-white |
| Fiber texture | Micro variation |
| Absorbency | Soft pigment fade |
| Directionality | Subtle anisotropy |
| Aging | Slight darkening |

### Absorption behavior
- Pigment lightens as it spreads
- Darkens where fibers compress
- Softens edges subtly (not watercolor bloom)

---

## 7. Pigment ↔ wood grain influence

Although pigment sits on paper, the carved block affects texture.

### Grain transfer cues
- Slight waviness in pigment edges
- Broken straight lines
- Directional interruption

**Model as**
- Grain modulating pigment coverage
- Grain slightly modulating ink density
- Grain subtly affecting normals

---

## 8. Optical response

This is **print realism**, not PBR realism.

### Lighting characteristics
- Soft, diffuse response
- Broad, weak specular only on ink ridges
- Valleys slightly darker (cavity effect)

### Pigment light behavior
- Darker in valleys
- Lighter on raised areas
- No metallic or glossy highlights

---

## 9. Temporal stability rules

Imperfections are **baked into the artifact**.

| Property | Animated |
|--------|----------|
| Grain | ❌ |
| Pigment noise | ❌ |
| Registration | ❌ |
| Lighting | ✅ |
| Camera | ✅ |

Any animated noise will break the illusion.

---

## 10. Recommended shader parameters

### Pigment
- `pigmentAlpha`
- `pigmentChromaLimit`
- `pigmentNoiseScale`
- `pigmentNoiseStrength`
- `pigmentEdgePooling`
- `pigmentRegistrationOffset`

### Paper
- `paperTone`
- `paperFiberStrength`
- `paperAbsorbency`
- `paperVariationScale`

### Ink
- `inkAlpha`
- `inkWarmth`
- `inkGrainInfluence`
- `inkHeightThreshold`

### Relief
- `heightScale`
- `bevelProfile`
- `cavityStrength`
- `ridgeHighlightStrength`

---

## 11. Failure modes to guard against

If any of the following appear, the implementation is incorrect:

- Fully opaque color fills
- Bright saturated primaries
- Perfect pigment-ink alignment
- Uniform flat color regions
- Sharp glossy highlights
- Animated grain or pigment noise

---

## 12. Guiding principle

> **Render a printed object, not an illustration.**

Pigment is:
- Secondary to ink
- Uneven
- Physical
- Limited
- Subordinate to relief and paper

If every decision reinforces that truth, the result will read as a believable historical artifact—even with simplified approximations.

---
