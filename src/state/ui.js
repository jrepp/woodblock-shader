import { proxy } from "valtio";

export const uiStore = proxy({
  selectedBrushPresetId: "",
  selectedPigmentPresetId: "",
  selectedMediumPresetId: "",
  presetName: "",
  presetSaveType: "brush",
  showPresetModal: false,
  webgpuSupported: false,
  tooltip: { visible: false, text: "", x: 0, y: 0 },
  pbpSummary: null,
  pbpStats: null,
  confirmModal: {
    open: false,
    title: "",
    message: "",
    type: "",
    targetId: "",
    payload: null,
    confirmLabel: "",
    confirmTone: "",
  },
});
