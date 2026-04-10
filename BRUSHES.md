# Brush Description Artifact: Hand-Illumination Tools for Woodblock Prints  
### Physically Based Painting (PBP) Simulation Specification

This artifact defines a **set of historically plausible pigment-application tools** (brushes/daubers/sponges/fingers) and their **physical parameters** for use in a physically based painting (PBP) system. It is designed to support both:
- interactive painting tools (authoring pigment masks / coverage maps), and
- procedural simulation (generating believable pigment coverage and artifacts).

The focus is **late-medieval to early Renaissance hand-coloring** over printed woodcut linework.

---

## 1. Shared material model (applies to all tools)

### 1.1 Pigment mixture state variables
These are properties of the pigment+medium on the tool at the moment of contact.

- `load` (0..1): how much mixture is available on the tool
- `pigment_concentration` (0..1): pigment density vs binder/water
- `viscosity` (0..1): resistance to flow; higher = thicker, less spread
- `wetness` (0..1): volatile solvent content; drives capillary spread and edge softening
- `granularity` (0..1): effective particle size; higher = speckle/mottling
- `stain_strength` (0..1): how readily pigment binds to fibers (vs sits on top)
- `liftability` (0..1): how readily pigment can be reactivated and moved

### 1.2 Substrate interaction fields (provided by scene/shader)
- `paper_absorbency` (0..1): capillary uptake; drives spread + soft edges
- `paper_fiber_scale` (px or mm): characteristic fiber/noise scale
- `paper_roughness` (0..1): micro-relief influence on deposition
- `relief_height` (0..1): raised ink/block relief map (from line art)
- `relief_gradient` (0..1): slope magnitude (for pooling and edge accumulation)
- `grain_direction` (unit vec2): wood/paper anisotropy direction (optional)
- `ink_mask` (0..1): printed linework dominance; pigment suppression near ink

**Wood substrate (this project)**  
We are working on **wood**, not paper. Use these mappings:
- `wood_pore_absorbency` replaces `paper_absorbency`
- `wood_fiber_scale` replaces `paper_fiber_scale`
- `wood_roughness` replaces `paper_roughness`
- `grain_direction` remains (wood anisotropy)

### 1.3 Universal deposition outputs (paint engine outputs)
Each stroke step produces (or updates):
- `coverage` (0..1): pigment coverage / thickness proxy
- `color` (linear RGB or indexed palette id)
- `water` (0..1): wetness field on paper
- `pigment_mass` (0..1): particulate deposit field
- `edge_pool` (0..1): local accumulation near boundaries
- `paper_stain` (0..1): absorbed/stained component vs surface component

---

## 1.4 Brush input pipeline (interactive authoring) — **in progress**

We are standardizing **brush input handling** so GPU/CPU parity stays stable and stroke feel is consistent.

**Input capture**
- Pointer stream yields `(x, y, t, pressure)` samples.
- Normalize pressure to `[0..1]` and apply a curve (e.g., `p = p^1.3`) for better control.

**Stroke sampling**
- Convert input to stamps with a **distance-based spacing**:
  - `spacing = radius * 0.35` (default).
  - Clamp to avoid gaps at high speed (max spacing = `radius * 0.6`).
- Interpolate position/pressure between samples to generate evenly spaced stamps.

**Dynamic parameters per stamp**
- `pressure` → scales `base_deposit` and `radius`.
- `direction` → derived from velocity; required for smudge and streak bias.
- `load` → decays over stroke distance; reset on new stroke.

**Determinism**
- Each stroke gets a seed for jitter; the seed is stable for replay/testing.

**Output target (weighted mix)**
- Stamps deposit into `pbpPigmentMix` weights + `mass`/`coverage`.
- Multi‑pigment brushes distribute weight across active pigments.

---

## 2. Tool set overview

This set models the most common hand-coloring implements and their signatures.

| Tool | Use | Signature |
|------|-----|-----------|
| `BRUSH_ROUND_WORN` | general fills, details | uneven, feathered, slight streaking |
| `BRUSH_FLAT_SHORT` | bands, trims, broad strokes | directional streaking, hard-ish edge on one side |
| `DAUBER_PAD_CLOTH` | large areas, quick tinting | blotchy, mottled, rounded edge |
| `SPONGE_NATURAL` | background washes, skies | patchy/cellular texture, non-directional |
| `FINGER_BLEND` | softening edges, smudge | very soft edges, localized blur/smear |
| `QUILL_DOT` | accents, stipple | sparse dots, occasional hard deposits |

---

## 3. Brush/Tool definitions (parameter schemas)

Each tool definition is expressed as a parameter block you can map to:
- a procedural stamp kernel,
- a bristle/particle simulation, or
- a hybrid raster fluid model.

### 3.1 `BRUSH_ROUND_WORN`

**Historical analog:** small animal-hair brush with worn tip.  
**Primary use:** robe fills, small areas, edge tinting.

#### Geometry / contact
- `radius_mm`: 1.5–4.0
- `shape`: circular
- `edge_softness`: 0.55–0.80
- `contact_jitter`: 0.10–0.25 (micro wobble)
- `tip_wear`: 0.35–0.65 (increases speckle + uneven edge)

#### Deposition dynamics
- `base_deposit`: 0.40–0.70
- `deposit_variance`: 0.15–0.30
- `directional_streak`: 0.10–0.25 (weak)
- `reload_rate`: 0.15–0.35 (how quickly load decays per distance)
- `pressure_to_deposit`: 0.5–0.9 (nonlinear)

#### Substrate coupling
- `ink_suppression`: 0.65–0.90
- `relief_edge_pooling`: 0.15–0.35
- `grain_influence`: 0.10–0.25
- `capillary_spread`: 0.20–0.45

#### Output signature
- non-uniform fill
- slightly feathered edges
- visible streaking only at low load/high pressure

---

### 3.2 `BRUSH_FLAT_SHORT`

**Historical analog:** short flat brush or bundled fiber edge.  
**Primary use:** trims, bands, architectural planes.

#### Geometry / contact
- `width_mm`: 3.0–10.0
- `height_mm`: 1.5–4.0
- `shape`: rounded-rect
- `edge_softness`: 0.35–0.65
- `angle_deg`: 0–180 (tool orientation)

#### Deposition dynamics
- `base_deposit`: 0.45–0.75
- `deposit_variance`: 0.12–0.25
- `directional_streak`: 0.25–0.55 (moderate)
- `pressure_to_deposit`: 0.6–0.95

#### Substrate coupling
- `ink_suppression`: 0.60–0.85
- `relief_edge_pooling`: 0.15–0.40
- `grain_influence`: 0.15–0.35

#### Output signature
- directional streaking
- slightly harder edge in orientation direction
- uneven coverage at stroke ends (lift-off)

---

### 3.3 `DAUBER_PAD_CLOTH`

**Historical analog:** cloth/felt/leather pad, pressed and dabbed.  
**Primary use:** fast tinting of large areas, skies/grounds.

#### Geometry / contact
- `radius_mm`: 6.0–18.0
- `shape`: circular / irregular
- `edge_softness`: 0.70–0.95
- `stamp_irregularity`: 0.25–0.55

#### Deposition dynamics
- `base_deposit`: 0.25–0.55
- `deposit_variance`: 0.25–0.55 (high blotch)
- `directional_streak`: 0.00–0.10 (none)
- `dab_frequency`: 1–6 stamps per second (authoring context)
- `load_decay_per_dab`: 0.05–0.15

#### Substrate coupling
- `ink_suppression`: 0.70–0.95 (daubers avoid ink ridges strongly)
- `relief_edge_pooling`: 0.20–0.50
- `grain_influence`: 0.20–0.45
- `capillary_spread`: 0.25–0.55

#### Output signature
- mottled, blotchy fields
- rounded coverage boundaries
- visible “stamp” unevenness at edges

---

### 3.4 `SPONGE_NATURAL`

**Historical analog:** natural sponge / porous cloth.  
**Primary use:** background wash, soft texture.

#### Geometry / contact
- `radius_mm`: 8.0–25.0
- `shape`: cellular / porous kernel
- `edge_softness`: 0.75–0.98
- `porosity`: 0.55–0.85

#### Deposition dynamics
- `base_deposit`: 0.15–0.45
- `deposit_variance`: 0.20–0.50
- `cellular_texture_strength`: 0.35–0.70
- `directional_streak`: 0.00–0.10

#### Substrate coupling
- `ink_suppression`: 0.75–0.95
- `relief_edge_pooling`: 0.10–0.30
- `grain_influence`: 0.15–0.40
- `capillary_spread`: 0.35–0.70

#### Output signature
- patchy/cellular coverage
- soft edges
- subtle paper showing through

---

### 3.5 `FINGER_BLEND`

**Historical analog:** fingertip blending/smudging.  
**Primary use:** soften edges, reduce hard boundaries, move wet pigment.

#### Geometry / contact
- `radius_mm`: 7.0–14.0
- `shape`: oval
- `edge_softness`: 0.85–0.99

#### Dynamics (redistribution vs deposition)
- `adds_pigment`: usually false (or minimal)
- `smear_strength`: 0.35–0.80
- `lift_strength`: 0.10–0.35
- `blur_strength`: 0.25–0.60
- `directional_bias`: 0.10–0.35

#### Substrate coupling
- `ink_suppression`: 0.80–0.98
- `relief_interaction`: 0.10–0.25 (finger respects ridges)
- `capillary_spread`: 0.10–0.30

#### Output signature
- softened edges
- localized blur/smear
- reduced speckle (particle redistribution)

---

### 3.6 `QUILL_DOT`

**Historical analog:** quill tip / stick point.  
**Primary use:** dots, small accents, stipple highlights.

#### Geometry / contact
- `radius_mm`: 0.2–0.8
- `shape`: circular
- `edge_softness`: 0.15–0.40

#### Deposition dynamics
- `base_deposit`: 0.55–0.95
- `deposit_variance`: 0.10–0.25
- `dot_rate`: 2–10 dots per second
- `load_decay_per_dot`: 0.01–0.05

#### Substrate coupling
- `ink_suppression`: 0.40–0.70 (dots may cross ink occasionally)
- `relief_edge_pooling`: 0.05–0.20
- `grain_influence`: 0.05–0.20

#### Output signature
- crisp dots
- occasional harder deposits
- sparse and intentional

---

## 4. Simulation behaviors (engine-agnostic)

These behaviors should be supported (even approximately) for believable results.

### 4.1 Load and depletion
- Tool `load` decreases with stroke length (brush) or number of stamps (dauber).
- As `load` decreases:
  - coverage becomes thinner and more broken
  - streaking increases (brushes)
  - blotchiness increases (pads/sponges)

### 4.2 Pressure response
- Increased pressure increases:
  - deposit amount
  - edge pooling near relief gradients
  - chance of crossing ink suppression threshold (minor “mistakes”)

### 4.3 Capillary spread and absorption
- Pigment spreads proportionally to:
  - `wetness * wood_pore_absorbency`
- Spread reduces value slightly (thinner layer) but softens edges.
- Avoid exaggerated watercolor blooms unless explicitly desired.

### 4.4 Relief-aware deposition
- Pigment should be suppressed near `ink_mask` / high `relief_height` ridges.
- Pigment should pool near `relief_gradient` boundaries (edge pooling).

### 4.5 Grain modulation
- Grain modulates:
  - coverage (interrupts uniformity)
  - micro-edges (breaks straight boundaries)
- Grain should be static and non-animated.

---

## 5. Suggested defaults (good starting presets)

These are pragmatic defaults that read as historical quickly.

- `wood_pore_absorbency`: 0.35
- `pigment_concentration`: 0.60
- `wetness`: 0.45
- `viscosity`: 0.35
- `granularity`: 0.40
- `stain_strength`: 0.55
- `ink_suppression`: 0.80 (most tools)
- `relief_edge_pooling`: 0.25
- `registration_offset_px`: 0.75 (per pigment layer)

---

## 6. Mapping to shader inputs (runtime)

If the painting simulation is used to generate textures, the shader should consume:

- `pigment_id` (R8) or `pigment_masks` (RGBA)
- `coverage` (R8) and optional `water` (R8)
- `edge_pool` (R8) optional
- `grain` (tile R8)
- `paper_fiber` (tile R8 or RGB)

In purely procedural shading, approximate tool signatures with:
- multiple noise bands (blotch + speckle)
- relief gradient proximity (pooling)
- grain modulation
- per-pigment registration offsets

---

## 7. Notes for exploration (what to test)

To validate tool believability, run these tests:

1. **Large area fill** with `DAUBER_PAD_CLOTH`: should be blotchy and imperfect.
2. **Trim bands** with `BRUSH_FLAT_SHORT`: should show directional streaking and lift-off thinning.
3. **Edge tinting** near linework with `BRUSH_ROUND_WORN`: should respect ink ridges and feather lightly.
4. **Soft edge blend** with `FINGER_BLEND`: should redistribute without adding much pigment.
5. **Accent stipple** with `QUILL_DOT`: should create intentional dots that occasionally vary in size.

---

## 8. Design guardrails

- Do not allow fully opaque pigment fills by default.
- Clamp chroma to avoid modern saturation.
- Never animate grain/noise/registration.
- Keep edge pooling subtle (a cue, not an effect).

---

## 10. Performance & optimization notes (PBP CPU/GPU)

**Primary goal:** keep interactive strokes under budget without sacrificing stability.

### Core practices
- **Typed arrays only**: preallocate `Uint8Array` buffers for all PBP fields.
- **Dirty‑region updates**: only process the brush AABB + a small margin.
- **Multi‑rate stepping**: simulate at 20–30 Hz, render at display rate.
- **Kernel cache**: precompute stamp kernels per brush size/type.
- **Avoid per‑frame allocations**: reuse temporary arrays and buffers.
- **Batch uploads**: update WebGL textures in place; avoid re‑creation.

### Profiling hooks
- Track ms spent in **stamp**, **diffusion**, **upload**.
- Log average/peak per frame for stroke-heavy sessions.

### Migration path
- **CPU first**, then WebGPU compute.
- Consider WASM only after JS baseline is profiled and saturated.

## 9. Implementation-ready JSON schema (optional)

Use this as a baseline serialization format for tool presets:

```json
{
  "id": "DAUBER_PAD_CLOTH",
  "contact": {
    "shape": "irregular_circle",
    "radius_mm": 12.0,
    "edge_softness": 0.9,
    "stamp_irregularity": 0.4,
    "contact_jitter": 0.2
  },
  "mixture": {
    "pigment_concentration": 0.6,
    "wetness": 0.45,
    "viscosity": 0.35,
    "granularity": 0.5,
    "stain_strength": 0.55
  },
  "deposition": {
    "base_deposit": 0.4,
    "deposit_variance": 0.45,
    "directional_streak": 0.05,
    "load_decay_per_step": 0.1,
    "pressure_to_deposit": 0.8
  },
  "coupling": {
    "ink_suppression": 0.9,
    "relief_edge_pooling": 0.35,
    "grain_influence": 0.35,
    "capillary_spread": 0.45
  }
}
