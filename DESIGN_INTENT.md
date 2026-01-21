# Design Intent Prompt: Woodblock / Illuminated Print Shader (WebGL/WebGPU)

You are implementing a real-time rendering pipeline that converts black-and-white line drawings into a stylized, historically grounded **late-medieval / Renaissance woodblock print** look, with **raised carved relief** and **hand-applied limited pigments** (“illumination”) rendered in **Three.js/WebGL** now, and compatible with **WebGPU** later.

## Primary goal
Render line art as if it were carved into a wood block and printed onto paper:
- **Raised inked ridges** (or carved relief) derived from linework
- **Visible wood grain interaction** with carving and pigment
- **Limited, muted pigment palette** applied unevenly like hand-coloring
- **Period-correct artifacts**: slight registration drift, imperfect coverage, edge pooling, paper fiber

## Non-goals
- Modern comic/cel shading
- Smooth digital gradients, bright saturated colors, glossy specular
- Heavy runtime mesh generation from vectorization (unless optional/hero mode)

## Core aesthetic requirements
1. **Relief first**: the linework must read as physically raised/relief-carved ridges under raking light.
2. **Ink dominance**: black line ink prints on top of pigment; pigment never fully obscures linework.
3. **Limited palette**: 3–8 pigments, earth-toned and desaturated; avoid neon/primary saturation.
4. **Hand-applied pigment behavior**:
   - Semi-transparent stain on paper
   - Coverage varies with grain/noise (uneven application)
   - Slight edge pooling near relief boundaries
   - Minor misregistration between pigment and linework
5. **Paper presence**: paper is warm off-white, with fiber variation and mild absorb/bleed cues.
6. **Wood presence**: directional grain subtly modulates albedo/normal and interrupts perfect edges.

## Performance and platform constraints
- Must run smoothly in browsers using **Three.js + WebGL2** (fallback to WebGL1 acceptable if feasible).
- Prefer a **slab/plane mesh** with texture-driven relief (height/normal/parallax) rather than true stroke-to-mesh extrusion.
- Shader should be built so that Blender-prepared assets can replace runtime-generated maps later.

## Pipeline structure

### Input
- Primary: B/W line art (ideally high contrast)
- Optional: color reference image (for palette extraction and/or pigment placement guide)
- Optional: authored pigment masks/ID map from Blender

### Offline “compiler” (Blender) responsibility (preferred for production)
Produce runtime textures:
- `height` (R16 or encoded RG): relief height derived from line SDF/profile
- `normal` (RGB): tangent-space normal from height
- `ao/cavity` (R8): valley darkening / print settle
- `pigment_id` (R8 index) or `pigment_masks` (RGBA packed)
- `grain` (tile) and optionally `paper` (tile)
- Small JSON metadata: palette colors + per-pigment params

### Runtime responsibility (Three.js/WebGL)
- Load slab mesh (plane) + textures
- Shade with:
  - Relief lighting from normal/height (+ optional parallax)
  - Ink overprint derived from line relief (or line mask)
  - Pigment layers from `pigment_id/masks` using limited palette
  - Grain + pigment noise modulation
  - Registration drift per pigment layer

## Shading model requirements

### Relief / carving
- Height profile should have a **flat-ish ridge top** with **rounded bevel** (not spiky).
- Normals derived from height; lighting is **raking and soft**, not glossy.

### Ink (linework)
- Ink mask is driven by height (ridge threshold) or dedicated line mask/SDF.
- Ink is slightly warm-black; coverage can vary subtly with grain but remains strong.

### Pigments
- Pigments are applied as translucent stains over paper:
  - Use multiply/overlay-like behavior, not opaque paint.
- Coverage model:
  - `coverage = base * (1 + grainInfluence + noiseInfluence) * (1 - inkSuppression)`
- Registration:
  - Each pigment layer samples masks with a tiny UV offset (≈ 0.5–1.5 px at target res).
- Edge pooling:
  - Darken or increase coverage slightly near relief boundaries.

### Paper
- Warm base tone; subtle fiber/noise.
- Mild vignette/aging is optional but should be subtle and disableable.

### Color management
- Palette in linear space; avoid bright saturation.
- Provide a hard clamp/guardrail to prevent modern-looking colors.

## Developer ergonomics
- Expose a small set of tunables:
  - `heightScale`, `bevelWidth/profile` (or equivalent)
  - `inkAlpha`, `inkThreshold`
  - `pigmentAlpha` (global and/or per pigment)
  - `grainScale`, `grainInfluence`
  - `pigmentNoiseScale`, `pigmentNoiseInfluence`
  - `registrationAmount`
  - `cavityStrength`
- Keep shader modular (functions for ink, pigment, lighting, paper).

## Deliverables expected from the implementation
1. A Three.js demo scene:
   - Loads default assets (line art + reference) automatically
   - Allows user uploads to swap inputs
   - Renders the woodblock slab with the above aesthetic
2. A documented asset contract for Blender output:
   - Expected texture formats and channel packing
   - Coordinate assumptions (UVs, scale)
3. A clear upgrade path to WebGPU (WGSL) without changing the conceptual pipeline.

## Acceptance criteria (visual)
- At first glance, it reads as **Renaissance woodcut + hand illumination**:
  - Relief visible under directional light
  - Ink lines remain crisp and dominant
  - Pigments look uneven, slightly misregistered, and paper-bound
  - Grain subtly influences both relief and pigment
- No plastic highlights, no digital gradients, no modern saturation.
