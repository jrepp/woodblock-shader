# Skill: pbp-iteration

## Purpose
Standard workflow for iterating on PBP buffers, CPU kernels, and debug views.

## Steps
1. Check `PIGMENT.md` for buffer layout and simulation intent.
2. Update `src/woodblock/pbp/engine.js` (CPU kernel) and `types.js` if needed.
3. Wire debug views in `src/WoodblockScene.jsx` or UI layer toggles.
4. Validate with Playwright bridge (`window.__pbpDebug`).
5. Update `PLAN.md` with progress and any perf notes.

## Validation
- Run a sample stamp and read `getBufferSummary()`.
- Ensure coverage/mass values change and remain stable after steps.
