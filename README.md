# woodblock-shader

## Running
- `pnpm dev` — starts the development server
- `pnpm build` — builds for production
- `pnpm preview` — previews the production build

## GPU parity tests (PBP)
- `pnpm test:pbp-gpu` — CPU reference vs GPU buffers (compute disabled)
- `pnpm test:pbp-gpu:compute` — GPU compute vs CPU reference
- `pnpm test:pbp-gpu:all` — runs both

Notes:
- First-time setup: `pnpm install` and `npx playwright install`
- The GPU test page lives at `pbp-gpu-test.html`
