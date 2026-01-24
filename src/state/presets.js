import { proxy } from "valtio";

export const presetStore = proxy({
  savedBrushPresets: [],
  savedPigmentPresets: [],
  savedMediumPresets: [],
});

export const PRESET_STORAGE_KEYS = Object.freeze({
  brush: "woodblock-brush-presets-v2",
  pigment: "woodblock-pigment-presets-v1",
  medium: "woodblock-medium-presets-v1",
});

export function loadPresetsFromStorage() {
  if (typeof window === "undefined") return;
  const load = (key) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  presetStore.savedBrushPresets = load(PRESET_STORAGE_KEYS.brush);
  presetStore.savedPigmentPresets = load(PRESET_STORAGE_KEYS.pigment);
  presetStore.savedMediumPresets = load(PRESET_STORAGE_KEYS.medium);
}

export function savePresetsToStorage(type, list) {
  if (typeof window === "undefined") return;
  const key = PRESET_STORAGE_KEYS[type];
  if (!key) return;
  window.localStorage.setItem(key, JSON.stringify(list));
}
