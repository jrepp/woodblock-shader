# PBP Engine (Draft)

This folder scaffolds a minimal CPU PBP simulation. It is **not wired** into rendering yet.

## Buffers
- `pbpPigmentId` (R8) – pigment index (dominant)
- `pbpPigmentMix` (RGBA8) – 4‑pigment weight mix (active set)
- `pbpCoverage` (R8)
- `pbpWater` (R8)
- `pbpMass` (R8)
- `pbpEdgePool` (R8)
- `pbpStain` (R8)

## Flow
1. `stamp()` writes to buffers based on brush type.
2. `step()` advances diffusion, pooling, and staining.

This draft matches the PBP buffer layout in `PIGMENT.md` and now includes `pbpPigmentMix`.
