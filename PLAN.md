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
1. **Paper presence**
   - Procedural paper fiber texture (runtime) and controls for intensity/scale.
   - Optional toggle for vignette/aging.
2. **Pigment behavior**
   - Masking to keep pigments off blank paper (improve guide-based coverage logic).
   - Registration drift applied consistently in the same UV space as linework.
   - Add pigment-specific parameters (alpha/edge pooling).
3. **Relief clarity**
   - Confirm height profile (flat ridge top, rounded bevel) and normal strength.
   - Option to blend grain into normal/height for stronger wood interaction.
4. **Color guardrails**
   - Saturation clamp or desaturation pass to keep pigments period-correct.
   - Palette selection UI to pick the preferred extraction method.

## Production roadmap (Blender/asset pipeline)
1. **Asset contract**
   - Document expected texture formats, channel packing, and UV assumptions.
   - Define metadata JSON for palette + per-pigment params.
2. **Authored maps**
   - `height` + `normal` from line SDF/profile.
   - `ao/cavity` for print settle and ink pooling guidance.
   - `pigment_id` or packed pigment masks for stable, intentional coloring.
   - Tileable `grain` + `paper` textures.
3. **Shader integration**
   - Switch to authored maps when present; runtime generation as fallback.
   - Keep WGSL parity for WebGPU migration.

## Open questions / assumptions
- **Pigment masks**: Will Blender outputs include explicit pigment ID/mask textures, or should the runtime continue to derive coverage solely from the color reference image?
- **Registration drift**: Should drift only affect pigment mask sampling, or also the pigment color selection itself?
- **Paper texture source**: Should paper fiber be purely procedural at runtime, or replaced by authored tiles once available?
- **Gloss/specular**: Should specular highlights be removed entirely or reduced to an extremely soft, paper-like sheen?
- **Palette control**: Do we want a fixed historical palette as a baseline, or always derive from the reference image?

## Assumptions
- Runtime will remain the authoring playground; Blender assets will be the long-term, production pipeline.
- The slab mesh remains a plane with texture-driven relief (no vector-to-mesh extrusion by default).
- WebGPU migration should not change the conceptual shading model.
