# Woodblock Shader Plan

## Design intent (condensed)
- Render B/W line art as carved, raised relief on paper.
- Keep ink dominant and crisp; pigments are muted, limited, hand-applied stains.
- Emphasize wood grain, paper fiber, and mild print artifacts (registration drift, edge pooling).
- Avoid modern gloss, heavy gradients, or saturated digital color.
- Keep pipeline compatible with future Blender-authored assets and WebGPU.

## Current status
- Runtime height/normal generation from line art; palette extraction from color guide.
- Grain + pigment noise modulation; registration drift; edge pooling; vignette.
- Multiple palette extraction methods for comparison.
- Debug map preview selector for height/normal/guide/grain/noise.

## Near-term roadmap (runtime)
1. **PBP buffers (CPU)**
   - Allocate `pbpPigmentId`, `pbpCoverage`, `pbpWater`, `pbpMass`, `pbpEdgePool`, `pbpStain`.
   - Add debug views to visualize each field.
   - Add profiling counters for stamp/diffuse/upload/total time.
   - **Progress:** buffers allocated + hooked into shader debug views, coverage used in shading; added cavity/pooling/flow debug modes.
2. **Brush kernels**
   - Implement Daubing/Rough/Smudge CPU stamp kernels.
   - Add load/depletion and pressure response.
   - Cache per‑brush kernels and update only dirty regions.
   - **Progress:** stamp kernels live, smudge redistributes, dirty region updates in PBP engine.
3. **Wood‑specific substrate**
   - Rename paper controls to wood‑pore/wood‑fiber semantics in UI + shader.
   - Retune spread/pooling for wood.
   - **Progress:** UI + shader renamed to wood absorbency/fiber; retune pending.
4. **Auto‑fill → PBP**
   - Seed pigment fields from relief + palette, then time‑step with grain/flow guidance.
   - Run multi‑rate simulation (20–30 Hz) while rendering at 60 Hz.
   - **Progress:** auto‑fill seeds PBP buffers + time‑stepped diffusion at 30 Hz.
5. **Color guardrails**
   - Clamp chroma and constrain opacity per pigment.
   - **Progress:** per‑pigment opacity/chroma/value bias profiles added to shader; defaults wired.

6. **WebGPU PBP migration (GPU core)**
   - Define canonical PBP storage strategy:
     - **Primary path**: 2x `rgba8unorm` storage textures (ping‑pong) for PBP fields.
       - `pbpTexA = coverage, water, mass, edgePool`
       - `pbpTexB = stain, pigmentId, spare0, spare1`
     - **Fallback path**: storage buffers with u8 packing + compute blit into RGBA8 for debug/visualization.
   - Add explicit format + feature gating (see **WebGPU requirements** below):
     - Canvas storage requires `bgra8unorm-storage` when the preferred format is BGRA.
     - Storage textures require explicit format in WGSL and bind group layouts.
   - Add compute pipeline stages:
     - **Stamp pass** (deposit): tool params + height/edge/grain textures → write PBP fields.
     - **Step pass** (diffuse/pool/stain/dry): read ping, write pong.
     - **Debug pass** (optional): visualize any channel (grayscale or false color).
   - Add GPU→CPU debug readback:
     - Staging buffers (`MAP_READ`) + `copyTextureToBuffer` for inspection and parity tests.
   - Add device limits query + dispatch sizing guardrails:
     - Clamp workgroup sizes and dispatch dims by `device.limits`.
   - Define buffer packing and alignment rules for any storage-buffer path:
     - Keep struct alignment compatible with WGSL rules (no implicit vec3 padding surprises).
     - Document byte layout and u8 packing for CPU/GPU parity.

## Production roadmap (Blender/asset pipeline)
1. **Asset contract**
   - Document expected texture formats, channel packing, color space, and UV assumptions.
   - Define metadata JSON for palette + per-pigment params + color space tags.
2. **Authored maps**
   - `height` + `normal` from line SDF/profile.
   - `ao/cavity` for print settle and ink pooling guidance.
   - `pigment_id` or packed pigment masks for stable, intentional coloring.
   - Tileable `grain` + `paper` textures.
3. **Shader integration**
   - Switch to authored maps when present; runtime generation as fallback.
   - Keep WGSL parity for WebGPU migration.

## Open questions / assumptions
### Best-path decisions (deep dive)
1. **Pigment masks source**
   - **Primary**: authored `pigment_id` (R8) or packed mask atlas from Blender for stable color decisions.
   - **Fallback**: runtime auto-fill from palette + relief (current path).
   - **Rationale**: authored masks avoid palette drift and are deterministic across GPU/CPU; runtime remains exploratory.
2. **Registration drift**
   - Apply drift to **pigment mask sampling only**, not palette selection.
   - Keep drift stable per pigment layer (not animated).
   - **Rationale**: drift should look like mis‑registration of application, not hue instability.
3. **Paper/wood texture source**
   - **Primary**: authored tileable wood/paper textures for production; retain procedural as fallback.
   - **Rationale**: authored tiles provide art direction control; procedural stays for iteration.
4. **Gloss/specular**
   - Keep **extremely soft, paper‑like sheen** only; avoid sharp specular entirely.
   - **Rationale**: woodblock prints are matte; any spec should be broad and subtle.
5. **Palette control**
   - Use a **fixed historical palette** as a baseline with optional “derive from reference” override.
   - **Rationale**: fixed palette enforces style consistency; reference‑derived palette is for experimentation.

### WebGPU requirements (from webgpufundamentals + gpuweb spec)
- **Storage textures**
  - Must use a valid storage format; `rgba8unorm` is the safest baseline.
  - Canvas storage requires `bgra8unorm-storage` if preferred format is BGRA.
- **Bind group layouts**
  - Storage textures require explicit `format` and `access` in `GPUStorageTextureBindingLayout`.
  - Use ping‑pong textures to avoid read/write hazards during diffusion.
- **Limits**
  - Query `device.limits` and clamp:
    - workgroup sizes (`maxComputeWorkgroupSizeX/Y/Z`)
    - invocations per workgroup (`maxComputeInvocationsPerWorkgroup`)
    - storage buffer size (`maxStorageBufferBindingSize`)
- **Memory layout**
  - Explicitly define WGSL struct alignment/padding and byte offsets.
  - Keep storage buffer sizes aligned to 4 bytes.
- **Debug**
  - Use `device.addEventListener('uncapturederror', ...)` and error scopes in dev.
  - For readback, copy into `MAP_READ` staging buffers and compare against CPU for parity tests.

### GPU parity test plan (CPU ↔ GPU)
1. **Scope**
   - Test on small tiles (e.g., 64x64, 128x128) to keep readbacks cheap.
   - Cover both **Stamp** and **Step** passes with fixed seeds and inputs.
2. **Inputs**
   - Deterministic brush parameters + pressure + UV.
   - Fixed height/edge/grain textures (known, precomputed fixtures).
   - Fixed tool state (load, pigmentId).
3. **Validation**
   - Compare per‑channel U8 buffers (`coverage`, `water`, `mass`, `edgePool`, `stain`, `pigmentId`).
   - Accept tiny deltas only where floating‑point rounding is expected:
     - Target: exact match for U8 paths; tolerance ≤ 1 for float‑derived packing.
4. **Regression policy**
   - Block GPU default switch until parity passes for:
     - single stamp
     - 10‑step diffusion
     - auto‑fill seed + 5 steps

## Assumptions
- Runtime will remain the authoring playground; Blender assets will be the long-term, production pipeline.
- The slab mesh remains a plane with texture-driven relief (no vector-to-mesh extrusion by default).
- WebGPU migration should not change the conceptual shading model.
- PBP GPU path maintains CPU parity on small tiles (unit tests) before becoming default.
