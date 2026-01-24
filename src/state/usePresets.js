import { useSnapshot } from "valtio";
import { presetStore } from "./presets.js";

export function usePresets() {
  const presets = useSnapshot(presetStore);
  return { presets, presetStore };
}
