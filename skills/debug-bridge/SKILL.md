# Skill: debug-bridge

## Purpose
Use the Playwright bridge to interrogate PBP buffers and drive tests.

## Steps
1. Ensure the dev server is running.
2. Use Playwright to call `window.__pbpDebug` methods.
3. Log buffer summaries and verify expected changes.
4. Use `stamp` and `step` to reproduce issues.

## Validation
- `getBufferSummary()` returns non-zero coverage after a stamp.
- `step(5)` reduces water and increases stain.
