# AGENT INSTRUCTIONS (Project Core)

## Subway Map (Docs + Modules)

### Core docs
- `README.md` – high-level project context
- `PIGMENT.md` – pigment/medium model, PBP buffers, time-step spec
- `BRUSHES.md` – tool behaviors + substrate mappings
- `PLAN.md` – implementation roadmap and optimization steps
- `DESIGN_INTENT.md` – visual / UX intent

### Runtime modules
- `src/App.jsx` – UX + state + debug bridge
- `src/WoodblockScene.jsx` – rendering, painting, PBP integration point
- `src/woodblock/pbp/engine.js` – CPU PBP core (draft)
- `src/woodblock/pbp/types.js` – buffer layout + tool defaults
- `src/woodblock/pbp/README.md` – PBP module overview

### Shader + texture pipeline
- `src/woodblock/js/shader.js`
- `src/woodblock/js/textures.js`
- `src/woodblock/js/palette.js`
- `src/woodblock/js/webgpu.js`

## Playwright Debugging Tools

### Bridge
In dev builds, an in-app bridge is exposed on the window:

```
window.__pbpDebug = {
  getBufferSummary(),
  getBuffers(),
  stamp({uv, brushType, pressure}),
  step(count),
  setPigmentId(id),
  resetLoad()
}
```

Use Playwright to call these for agent testing and buffer inspection.

### Typical Playwright snippets
- Inspect summary:
```
await page.evaluate(() => window.__pbpDebug.getBufferSummary())
```
- Apply a stamp:
```
await page.evaluate(() => window.__pbpDebug.stamp({ uv: { x: 0.5, y: 0.5 }, brushType: 'Daubing', pressure: 0.8 }))
```

## Core workflows (skills, proposed)

> These are local skill specs to standardize common workflows.

- `skills/pbp-iteration/SKILL.md`
  - 목적: PBP buffers, kernels, and debug views iteration.
- `skills/ui-layout/SKILL.md`
  - 목적: Docked UI layout changes with Playwright validation.
- `skills/debug-bridge/SKILL.md`
  - 목적: Playwright bridge usage + buffer interrogation.

