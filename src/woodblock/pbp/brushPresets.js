import { BRUSH_TYPES } from "../../state/constants.js";
import { BRUSH_INPUT_DEFAULTS } from "./brushConfig.js";

const PRESETS = {
  [BRUSH_TYPES[0]]: {
    label: "Daubing",
    input: {
      ...BRUSH_INPUT_DEFAULTS,
    },
  },
  [BRUSH_TYPES[1]]: {
    label: "Rough",
    input: {
      ...BRUSH_INPUT_DEFAULTS,
      spacingRatio: 0.3,
    },
  },
  [BRUSH_TYPES[2]]: {
    label: "Smudge",
    input: {
      ...BRUSH_INPUT_DEFAULTS,
      spacingRatio: 0.4,
    },
  },
};

export function getBrushPreset(brushType) {
  return PRESETS[brushType] || PRESETS[BRUSH_TYPES[0]];
}

export function updateBrushPreset(brushType, patch) {
  const preset = PRESETS[brushType];
  if (!preset || !patch) return preset;
  const next = {
    ...preset,
    input: {
      ...preset.input,
      ...patch,
    },
  };
  PRESETS[brushType] = next;
  return next;
}

export function listBrushPresets() {
  return { ...PRESETS };
}
