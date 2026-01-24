# Skill: ui-layout

## Purpose
Maintain docked UI consistency and responsive layout changes with Playwright validation.

## Steps
1. Modify UI structure in `src/App.jsx` and styles in `src/index.css`.
2. Run Playwright to capture desktop + tablet screenshots.
3. Fix overlaps/truncation; ensure docked panels align to grid.
4. Update any hotkeys/tooltips impacted by layout changes.

## Validation
- Capture a full-page screenshot in both Artist + Developer modes.
- Ensure top dock, left sidebar, and right debug dock do not overlap.
