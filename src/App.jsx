import { useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import WebGPUView from "./WebGPUView.jsx";
import { fileToImage, urlToImage } from "./woodblock/js/textures.js";
import { DEFAULT_PALETTE_LINEAR, DEFAULT_PIGMENT_PROPS } from "./woodblock/js/palette.js";
import PbpBridgePanel from "./components/PbpBridgePanel.jsx";
import PigmentPhysicsPanel from "./components/PigmentPhysicsPanel.jsx";
import WoodMediumPanel from "./components/WoodMediumPanel.jsx";
import LayerStack from "./components/LayerStack.jsx";
import TopToolDock from "./components/TopToolDock.jsx";
import FilePicker from "./components/FilePicker.jsx";
import CollapsibleSection from "./components/CollapsibleSection.jsx";
import BrushPresetsPanel from "./components/BrushPresetsPanel.jsx";
import PaletteExtractionPanel from "./components/PaletteExtractionPanel.jsx";
import BottomStrip from "./components/BottomStrip.jsx";
import PresetModal from "./components/PresetModal.jsx";
import ConfirmModal from "./components/ConfirmModal.jsx";
import usePbpDebugBridge from "./hooks/usePbpDebugBridge.js";
import { BRUSH_MODES, BRUSH_TYPES, COMPUTE_BACKENDS, DEBUG_LABELS } from "./state/constants.js";
import { DEBUG_MODES } from "./state/debugModes.js";
import { CONTROL_KEYS, controlsStore, setControl, setControls } from "./state/controls.js";
import { loadPresetsFromStorage, savePresetsToStorage } from "./state/presets.js";
import { usePresets } from "./state/usePresets.js";
import { useUi } from "./state/useUi.js";

const DEFAULT_LINE_URL = "/assets/line-art.png";
const DEFAULT_COLOR_URL = "/assets/color-ref.png";
const DEFAULT_GRAIN_URL = "/assets/pearwood-texture.png";
const BRUSH_PRESETS = [
  {
    id: "studio-default",
    label: "Studio Default",
    data: {
      brushCurrent: {
        brushSize: 28,
        brushOpacity: 0.85,
        brushMode: BRUSH_MODES.ADD,
        brushType: BRUSH_TYPES[0],
        paintInfluence: 1.0,
      },
    },
  },
  {
    id: "wash-soft",
    label: "Soft Wash",
    data: {
      brushCurrent: {
        brushSize: 48,
        brushOpacity: 0.6,
        brushMode: BRUSH_MODES.ADD,
        brushType: BRUSH_TYPES[2],
        paintInfluence: 0.8,
      },
    },
  },
  {
    id: "inked-edge",
    label: "Ink Edge",
    data: {
      brushCurrent: {
        brushSize: 20,
        brushOpacity: 0.95,
        brushMode: BRUSH_MODES.ADD,
        brushType: BRUSH_TYPES[1],
        paintInfluence: 1.0,
      },
    },
  },
];

const PIGMENT_PRESETS = [
  {
    id: "pigment-classic",
    label: "Classic Pigment",
    data: {
      brushPhysics: {
        pigmentAlpha: 0.55,
        pigmentChromaLimit: 0.62,
        pigmentNoiseStrength: 0.18,
        pigmentGranularity: 0.22,
        pigmentValueBias: 0.12,
        pigmentEdgePooling: 0.12,
        pigmentFlowStrength: 0.6,
        pigmentNoiseScale: 1.6,
        registration: 0.0012,
      },
      pigmentProfiles: DEFAULT_PIGMENT_PROPS.map((profile) => ({ ...profile })),
    },
  },
  {
    id: "pigment-soft",
    label: "Soft Wash",
    data: {
      brushPhysics: {
        pigmentAlpha: 0.5,
        pigmentChromaLimit: 0.58,
        pigmentNoiseStrength: 0.12,
        pigmentGranularity: 0.3,
        pigmentValueBias: 0.18,
        pigmentEdgePooling: 0.08,
        pigmentFlowStrength: 0.85,
        pigmentNoiseScale: 2.2,
        registration: 0.001,
      },
      pigmentProfiles: DEFAULT_PIGMENT_PROPS.map((profile) => ({
        ...profile,
        opacity: Math.min(1, profile.opacity + 0.05),
      })),
    },
  },
];

const MEDIUM_PRESETS = [
  {
    id: "medium-pearwood",
    label: "Pearwood",
    data: {
      wood: {
        woodAbsorbency: 1.05,
        woodFiberStrength: 0.65,
        woodCapillary: 1.0,
        woodPoolingBias: 0.1,
        woodStainRate: 0.02,
        woodDryingRate: 0.02,
        woodMassRetention: 0.85,
        woodGrainInfluence: 0.3,
        grainScale: 1.4,
        grainNormal: 0.08,
        carveContrast: 1.15,
      },
    },
  },
  {
    id: "medium-dense",
    label: "Dense Grain",
    data: {
      wood: {
        woodAbsorbency: 0.9,
        woodFiberStrength: 0.5,
        woodCapillary: 0.75,
        woodPoolingBias: 0.14,
        woodStainRate: 0.015,
        woodDryingRate: 0.025,
        woodMassRetention: 0.9,
        woodGrainInfluence: 0.2,
        grainScale: 1.8,
        grainNormal: 0.1,
        carveContrast: 1.2,
      },
    },
  },
];

export default function App() {
  const controls = useSnapshot(controlsStore);
  const { presets, presetStore } = usePresets();
  const { ui, uiStore } = useUi();
  const [lineFile, setLineFile] = useState(null);
  const [colorFile, setColorFile] = useState(null);
  const [grainFile, setGrainFile] = useState(null);

  const [defaultLineImg, setDefaultLineImg] = useState(null);
  const [defaultColorImg, setDefaultColorImg] = useState(null);
  const [defaultGrainImg, setDefaultGrainImg] = useState(null);

  const [lineImg, setLineImg] = useState(null);
  const [colorImg, setColorImg] = useState(null);
  const [grainImg, setGrainImg] = useState(null);
  const pendingTextureSizeRef = useRef(null);

  const [paletteSets, setPaletteSets] = useState([]);
  const [clearPaintNonce, setClearPaintNonce] = useState(0);
  const [autoFillNonce, setAutoFillNonce] = useState(0);
  
  const brushCursorRef = useRef(null);
  const [pigmentProfiles, setPigmentProfiles] = useState(() =>
    DEFAULT_PIGMENT_PROPS.map((profile) => ({ ...profile }))
  );
  const pbpDebugRef = useRef(null);
  const tooltipTargetRef = useRef(null);

  useEffect(() => {
    const showTooltip = (target, x, y) => {
      const text = target?.getAttribute?.("data-tooltip");
      if (!text) return;
      uiStore.tooltip = { visible: true, text, x, y };
    };
    const hideTooltip = () => {
      uiStore.tooltip = uiStore.tooltip.visible
        ? { ...uiStore.tooltip, visible: false }
        : uiStore.tooltip;
    };
    const updatePosition = (x, y) => {
      uiStore.tooltip = uiStore.tooltip.visible
        ? { ...uiStore.tooltip, x, y }
        : uiStore.tooltip;
    };

    const onMouseOver = (event) => {
      const target = event.target.closest("[data-tooltip]");
      if (!target) return;
      tooltipTargetRef.current = target;
      showTooltip(target, event.clientX + 12, event.clientY + 16);
    };
    const onMouseMove = (event) => {
      if (!tooltipTargetRef.current) return;
      updatePosition(event.clientX + 12, event.clientY + 16);
    };
    const onMouseOut = (event) => {
      if (!tooltipTargetRef.current) return;
      const related = event.relatedTarget;
      if (related && related.closest && related.closest("[data-tooltip]") === tooltipTargetRef.current) return;
      tooltipTargetRef.current = null;
      hideTooltip();
    };
    const onFocusIn = (event) => {
      const target = event.target.closest("[data-tooltip]");
      if (!target) return;
      tooltipTargetRef.current = target;
      const rect = target.getBoundingClientRect();
      showTooltip(target, rect.left, rect.bottom + 12);
    };
    const onFocusOut = () => {
      tooltipTargetRef.current = null;
      hideTooltip();
    };

    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseout", onMouseOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseout", onMouseOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    uiStore.webgpuSupported = Boolean(navigator.gpu);
  }, []);

  usePbpDebugBridge(pbpDebugRef);

  useEffect(() => {
    const loadDefault = async (url, setter) => {
      try {
        const img = await urlToImage(url);
        img._labelName = url;
        setter(img);
        return;
      } catch {}
      const fallback = new Image();
      fallback.onload = () => {
        fallback._labelName = url;
        setter(fallback);
      };
      fallback.src = url;
    };
    loadDefault(DEFAULT_LINE_URL, setDefaultLineImg);
    loadDefault(DEFAULT_COLOR_URL, setDefaultColorImg);
    loadDefault(DEFAULT_GRAIN_URL, setDefaultGrainImg);
  }, []);

  useEffect(() => {
    loadPresetsFromStorage();
  }, []);

  useEffect(() => {
    if (!lineFile) return;
    fileToImage(lineFile).then((img) => {
      img._labelName = lineFile.name;
      setLineImg(img);
    });
  }, [lineFile]);

  useEffect(() => {
    if (!colorFile) return;
    fileToImage(colorFile).then((img) => {
      img._labelName = colorFile.name;
      setColorImg(img);
    });
  }, [colorFile]);

  useEffect(() => {
    if (!grainFile) return;
    fileToImage(grainFile).then((img) => {
      img._labelName = grainFile.name;
      setGrainImg(img);
    });
  }, [grainFile]);


  const buildBrushPresetPayload = () => ({
    brushCurrent: {
      brushSize: controls.brushSize,
      brushOpacity: controls.brushOpacity,
      brushMode: controls.brushMode,
      brushType: controls.brushType,
      paintInfluence: controls.paintInfluence,
    },
  });

  const buildPigmentPresetPayload = () => ({
    brushPhysics: {
      pigmentAlpha: controls.pigmentAlpha,
      pigmentChromaLimit: controls.pigmentChromaLimit,
      pigmentNoiseStrength: controls.pigmentNoiseStrength,
      pigmentGranularity: controls.pigmentGranularity,
      pigmentValueBias: controls.pigmentValueBias,
      pigmentEdgePooling: controls.pigmentEdgePooling,
      pigmentFlowStrength: controls.pigmentFlowStrength,
      pigmentNoiseScale: controls.pigmentNoiseScale,
      registration: controls.registration,
    },
    pigmentProfiles: pigmentProfiles.map((profile) => ({ ...profile })),
  });

  const buildMediumPresetPayload = () => ({
    wood: {
      woodAbsorbency: controls.woodAbsorbency,
      woodFiberStrength: controls.woodFiberStrength,
      woodCapillary: controls.woodCapillary,
      woodPoolingBias: controls.woodPoolingBias,
      woodStainRate: controls.woodStainRate,
      woodDryingRate: controls.woodDryingRate,
      woodMassRetention: controls.woodMassRetention,
      woodGrainInfluence: controls.woodGrainInfluence,
      grainScale: controls.grainScale,
      grainNormal: controls.grainNormal,
      carveContrast: controls.carveContrast,
    },
  });

  const applyBrushPreset = (preset) => {
    if (!preset?.data?.brushCurrent) return;
    const brushCurrent = preset.data.brushCurrent;
    setControls({
      [CONTROL_KEYS.brushSize]: brushCurrent.brushSize,
      [CONTROL_KEYS.brushOpacity]: brushCurrent.brushOpacity,
      [CONTROL_KEYS.brushMode]: brushCurrent.brushMode,
      [CONTROL_KEYS.brushType]: brushCurrent.brushType,
      [CONTROL_KEYS.paintInfluence]: brushCurrent.paintInfluence,
    });
  };

  const applyPigmentPreset = (preset) => {
    if (!preset?.data) return;
    const brushPhysics = preset.data.brushPhysics;
    if (brushPhysics) {
      setControls({
        [CONTROL_KEYS.pigmentAlpha]: brushPhysics.pigmentAlpha,
        [CONTROL_KEYS.pigmentChromaLimit]: brushPhysics.pigmentChromaLimit,
        [CONTROL_KEYS.pigmentNoiseStrength]: brushPhysics.pigmentNoiseStrength,
        [CONTROL_KEYS.pigmentGranularity]: brushPhysics.pigmentGranularity,
        [CONTROL_KEYS.pigmentValueBias]: brushPhysics.pigmentValueBias,
        [CONTROL_KEYS.pigmentEdgePooling]: brushPhysics.pigmentEdgePooling,
        [CONTROL_KEYS.pigmentFlowStrength]: brushPhysics.pigmentFlowStrength,
        [CONTROL_KEYS.pigmentNoiseScale]: brushPhysics.pigmentNoiseScale,
        [CONTROL_KEYS.registration]: brushPhysics.registration,
      });
    }
    if (Array.isArray(preset.data.pigmentProfiles)) {
      setPigmentProfiles(preset.data.pigmentProfiles.map((profile) => ({ ...profile })));
    }
  };

  const applyMediumPreset = (preset) => {
    const wood = preset?.data?.wood;
    if (!wood) return;
    setControls({
      [CONTROL_KEYS.woodAbsorbency]: wood.woodAbsorbency,
      [CONTROL_KEYS.woodFiberStrength]: wood.woodFiberStrength,
      [CONTROL_KEYS.woodCapillary]: wood.woodCapillary,
      [CONTROL_KEYS.woodPoolingBias]: wood.woodPoolingBias,
      [CONTROL_KEYS.woodStainRate]: wood.woodStainRate,
      [CONTROL_KEYS.woodDryingRate]: wood.woodDryingRate,
      [CONTROL_KEYS.woodMassRetention]: wood.woodMassRetention,
      [CONTROL_KEYS.woodGrainInfluence]: wood.woodGrainInfluence,
      [CONTROL_KEYS.grainScale]: wood.grainScale,
      [CONTROL_KEYS.grainNormal]: wood.grainNormal,
      [CONTROL_KEYS.carveContrast]: wood.carveContrast,
    });
  };

  const brushPresetOptions = useMemo(
    () => [...BRUSH_PRESETS, ...presets.savedBrushPresets],
    [presets.savedBrushPresets]
  );
  const pigmentPresetOptions = useMemo(
    () => [...PIGMENT_PRESETS, ...presets.savedPigmentPresets],
    [presets.savedPigmentPresets]
  );
  const mediumPresetOptions = useMemo(
    () => [...MEDIUM_PRESETS, ...presets.savedMediumPresets],
    [presets.savedMediumPresets]
  );

  const handleBrushPresetSelect = (presetId) => {
    uiStore.selectedBrushPresetId = presetId;
    if (!presetId) return;
    const preset = brushPresetOptions.find((p) => p.id === presetId);
    if (preset) {
      applyBrushPreset(preset);
      uiStore.presetName = preset.label;
    }
  };

  const handlePigmentPresetSelect = (presetId) => {
    uiStore.selectedPigmentPresetId = presetId;
    if (!presetId) return;
    const preset = pigmentPresetOptions.find((p) => p.id === presetId);
    if (preset) {
      applyPigmentPreset(preset);
      uiStore.presetName = preset.label;
    }
  };

  const handleMediumPresetSelect = (presetId) => {
    uiStore.selectedMediumPresetId = presetId;
    if (!presetId) return;
    const preset = mediumPresetOptions.find((p) => p.id === presetId);
    if (preset) {
      applyMediumPreset(preset);
      uiStore.presetName = preset.label;
    }
  };

  const handlePresetSave = (type) => {
    const name = ui.presetName.trim();
    if (!name) return;
    const id = `user-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    if (type === "brush") {
      const entry = { id, label: name, data: buildBrushPresetPayload() };
      const next = [...presetStore.savedBrushPresets, entry];
      presetStore.savedBrushPresets = next;
      uiStore.selectedBrushPresetId = id;
      savePresetsToStorage("brush", next);
      return;
    }
    if (type === "pigment") {
      const entry = { id, label: name, data: buildPigmentPresetPayload() };
      const next = [...presetStore.savedPigmentPresets, entry];
      presetStore.savedPigmentPresets = next;
      uiStore.selectedPigmentPresetId = id;
      savePresetsToStorage("pigment", next);
      return;
    }
    if (type === "medium") {
      const entry = { id, label: name, data: buildMediumPresetPayload() };
      const next = [...presetStore.savedMediumPresets, entry];
      presetStore.savedMediumPresets = next;
      uiStore.selectedMediumPresetId = id;
      savePresetsToStorage("medium", next);
    }
  };

  const handlePigmentProfileChange = (index, key, value) => {
    setPigmentProfiles((prev) =>
      prev.map((profile, i) => (i === index ? { ...profile, [key]: value } : profile))
    );
  };

  const handlePresetCopy = async (type) => {
    let payload = null;
    let label = "";
    if (type === "brush") {
      payload = buildBrushPresetPayload();
      label = ui.presetName || "Brush preset";
    }
    if (type === "pigment") {
      payload = buildPigmentPresetPayload();
      label = ui.presetName || "Pigment preset";
    }
    if (type === "medium") {
      payload = buildMediumPresetPayload();
      label = ui.presetName || "Medium preset";
    }
    if (!payload) return;
    const preset = { type, label, data: payload };
    try {
      await navigator.clipboard.writeText(JSON.stringify(preset));
    } catch {}
  };

  const handlePresetPaste = async (type) => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const parsed = JSON.parse(text);
      if (!parsed?.data) return;
      if (parsed.type && parsed.type !== type) return;
      const label = parsed.label || "Imported preset";
      const id = `import-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
      const entry = { id, label, data: parsed.data };
      if (type === "brush") {
        const next = [...presetStore.savedBrushPresets, entry];
        presetStore.savedBrushPresets = next;
        uiStore.selectedBrushPresetId = id;
        applyBrushPreset(entry);
        savePresetsToStorage("brush", next);
        return;
      }
      if (type === "pigment") {
        const next = [...presetStore.savedPigmentPresets, entry];
        presetStore.savedPigmentPresets = next;
        uiStore.selectedPigmentPresetId = id;
        applyPigmentPreset(entry);
        savePresetsToStorage("pigment", next);
        return;
      }
      if (type === "medium") {
        const next = [...presetStore.savedMediumPresets, entry];
        presetStore.savedMediumPresets = next;
        uiStore.selectedMediumPresetId = id;
        applyMediumPreset(entry);
        savePresetsToStorage("medium", next);
      }
    } catch {}
  };

  const openPresetDeleteConfirm = (type, targetId, label) => {
    uiStore.confirmModal = {
      open: true,
      title: "Delete preset",
      message: `Delete ${type} preset "${label}"? This cannot be undone.`,
      type,
      targetId,
      payload: null,
      confirmLabel: "Delete",
      confirmTone: "danger",
    };
  };

  const closeConfirmModal = () => {
    uiStore.confirmModal = {
      open: false,
      title: "",
      message: "",
      type: "",
      targetId: "",
      payload: null,
      confirmLabel: "",
      confirmTone: "",
    };
  };

  const openTextureSizeConfirm = (size) => {
    pendingTextureSizeRef.current = size;
    uiStore.confirmModal = {
      open: true,
      title: "Resize PBP buffers",
      message: "Changing the texture size will clear the current paint state and rebuild the simulation buffers. Continue?",
      type: "texture-size",
      targetId: "",
      payload: { size },
      confirmLabel: "Resize",
      confirmTone: "danger",
    };
  };

  const executePresetDelete = (type, targetId) => {
    if (!type || !targetId) return;
    if (type === "brush") {
      const next = presetStore.savedBrushPresets.filter((preset) => preset.id !== targetId);
      if (next.length === presetStore.savedBrushPresets.length) return;
      presetStore.savedBrushPresets = next;
      if (ui.selectedBrushPresetId === targetId) {
        uiStore.selectedBrushPresetId = "";
      }
      savePresetsToStorage("brush", next);
      return;
    }
    if (type === "pigment") {
      const next = presetStore.savedPigmentPresets.filter((preset) => preset.id !== targetId);
      if (next.length === presetStore.savedPigmentPresets.length) return;
      presetStore.savedPigmentPresets = next;
      if (ui.selectedPigmentPresetId === targetId) {
        uiStore.selectedPigmentPresetId = "";
      }
      savePresetsToStorage("pigment", next);
      return;
    }
    if (type === "medium") {
      const next = presetStore.savedMediumPresets.filter((preset) => preset.id !== targetId);
      if (next.length === presetStore.savedMediumPresets.length) return;
      presetStore.savedMediumPresets = next;
      if (ui.selectedMediumPresetId === targetId) {
        uiStore.selectedMediumPresetId = "";
      }
      savePresetsToStorage("medium", next);
    }
  };

  const handleBrushPresetRandomize = () => {
    const rand = (min, max) => Math.random() * (max - min) + min;
    setControls({
      [CONTROL_KEYS.brushSize]: Math.round(rand(8, 64)),
      [CONTROL_KEYS.brushOpacity]: Number(rand(0.4, 1).toFixed(2)),
      [CONTROL_KEYS.brushMode]: Math.random() > 0.2 ? BRUSH_MODES.ADD : BRUSH_MODES.ERASE,
      [CONTROL_KEYS.brushType]: BRUSH_TYPES[Math.floor(rand(0, BRUSH_TYPES.length))],
    });
  };

  const handlePigmentPresetRandomize = () => {
    const rand = (min, max) => Math.random() * (max - min) + min;
    setControls({
      [CONTROL_KEYS.pigmentAlpha]: Number(rand(0.4, 0.75).toFixed(2)),
      [CONTROL_KEYS.pigmentChromaLimit]: Number(rand(0.4, 0.8).toFixed(2)),
      [CONTROL_KEYS.pigmentNoiseStrength]: Number(rand(0.05, 0.3).toFixed(2)),
      [CONTROL_KEYS.pigmentGranularity]: Number(rand(0.05, 0.4).toFixed(2)),
      [CONTROL_KEYS.pigmentValueBias]: Number(rand(0.02, 0.25).toFixed(2)),
      [CONTROL_KEYS.pigmentEdgePooling]: Number(rand(0.05, 0.3).toFixed(2)),
      [CONTROL_KEYS.pigmentFlowStrength]: Number(rand(0.2, 1.2).toFixed(2)),
      [CONTROL_KEYS.pigmentNoiseScale]: Number(rand(0.8, 2.6).toFixed(2)),
      [CONTROL_KEYS.registration]: Number(rand(0, 0.003).toFixed(4)),
    });
    setPigmentProfiles((prev) =>
      prev.map((profile, index) =>
        index === controls.selectedPigmentIndex
          ? {
              ...profile,
              opacity: Number(rand(0.5, 1.1).toFixed(2)),
              chroma: Number(rand(0.5, 1.1).toFixed(2)),
              valueBias: Number(rand(0.0, 0.2).toFixed(2)),
            }
          : profile
      )
    );
  };

  const handleMediumPresetRandomize = () => {
    const rand = (min, max) => Math.random() * (max - min) + min;
    setControls({
      [CONTROL_KEYS.woodAbsorbency]: Number(rand(0.7, 1.4).toFixed(2)),
      [CONTROL_KEYS.woodFiberStrength]: Number(rand(0.3, 1.0).toFixed(2)),
      [CONTROL_KEYS.woodCapillary]: Number(rand(0.6, 1.4).toFixed(2)),
      [CONTROL_KEYS.woodPoolingBias]: Number(rand(0.05, 0.2).toFixed(2)),
      [CONTROL_KEYS.woodStainRate]: Number(rand(0.01, 0.05).toFixed(3)),
      [CONTROL_KEYS.woodDryingRate]: Number(rand(0.01, 0.05).toFixed(3)),
      [CONTROL_KEYS.woodMassRetention]: Number(rand(0.75, 0.95).toFixed(2)),
      [CONTROL_KEYS.woodGrainInfluence]: Number(rand(0.1, 0.5).toFixed(2)),
      [CONTROL_KEYS.grainScale]: Number(rand(0.8, 2.0).toFixed(2)),
      [CONTROL_KEYS.grainNormal]: Number(rand(0.02, 0.14).toFixed(2)),
      [CONTROL_KEYS.carveContrast]: Number(rand(0.9, 1.4).toFixed(2)),
    });
  };

  const presetSections = useMemo(
    () => [
      {
        id: "brush",
        title: "Brush presets",
        options: brushPresetOptions,
        selectedId: ui.selectedBrushPresetId,
        onSelect: handleBrushPresetSelect,
        onSave: () => {
          uiStore.presetSaveType = "brush";
          uiStore.presetName = "";
          uiStore.showPresetModal = true;
        },
        onShare: () => handlePresetCopy("brush"),
        onPaste: () => handlePresetPaste("brush"),
        onRandomize: handleBrushPresetRandomize,
        onDelete: () => {
          const target = presetStore.savedBrushPresets.find(
            (preset) => preset.id === ui.selectedBrushPresetId
          );
          if (target) openPresetDeleteConfirm("brush", target.id, target.label);
        },
        canDelete: presetStore.savedBrushPresets.some(
          (preset) => preset.id === ui.selectedBrushPresetId
        ),
      },
      {
        id: "pigment",
        title: "Pigment presets",
        options: pigmentPresetOptions,
        selectedId: ui.selectedPigmentPresetId,
        onSelect: handlePigmentPresetSelect,
        onSave: () => {
          uiStore.presetSaveType = "pigment";
          uiStore.presetName = "";
          uiStore.showPresetModal = true;
        },
        onShare: () => handlePresetCopy("pigment"),
        onPaste: () => handlePresetPaste("pigment"),
        onRandomize: handlePigmentPresetRandomize,
        onDelete: () => {
          const target = presetStore.savedPigmentPresets.find(
            (preset) => preset.id === ui.selectedPigmentPresetId
          );
          if (target) openPresetDeleteConfirm("pigment", target.id, target.label);
        },
        canDelete: presetStore.savedPigmentPresets.some(
          (preset) => preset.id === ui.selectedPigmentPresetId
        ),
      },
      {
        id: "medium",
        title: "Medium presets",
        options: mediumPresetOptions,
        selectedId: ui.selectedMediumPresetId,
        onSelect: handleMediumPresetSelect,
        onSave: () => {
          uiStore.presetSaveType = "medium";
          uiStore.presetName = "";
          uiStore.showPresetModal = true;
        },
        onShare: () => handlePresetCopy("medium"),
        onPaste: () => handlePresetPaste("medium"),
        onRandomize: handleMediumPresetRandomize,
        onDelete: () => {
          const target = presetStore.savedMediumPresets.find(
            (preset) => preset.id === ui.selectedMediumPresetId
          );
          if (target) openPresetDeleteConfirm("medium", target.id, target.label);
        },
        canDelete: presetStore.savedMediumPresets.some(
          (preset) => preset.id === ui.selectedMediumPresetId
        ),
      },
    ],
    [
      brushPresetOptions,
      handleBrushPresetSelect,
      handleBrushPresetRandomize,
      handlePigmentPresetRandomize,
      handleMediumPresetRandomize,
      handlePigmentPresetSelect,
      handleMediumPresetSelect,
      pigmentPresetOptions,
      ui.selectedBrushPresetId,
      ui.selectedPigmentPresetId,
      ui.selectedMediumPresetId,
      mediumPresetOptions,
    ]
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.target && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        setControl(CONTROL_KEYS.paintEnabled, !controls.paintEnabled);
      }
      if (event.key.toLowerCase() === "i" || event.key.toLowerCase() === "h") {
        event.preventDefault();
        setControl(CONTROL_KEYS.paintEnabled, false);
      }
      if (event.key.toLowerCase() === "b" || event.key.toLowerCase() === "p") {
        event.preventDefault();
        setControl(CONTROL_KEYS.paintEnabled, true);
      }
      if (event.key === "[" || event.key === "-") {
        event.preventDefault();
        const next = Math.max(4, Math.round(controls.brushSize - 4));
        setControl(CONTROL_KEYS.brushSize, next);
      }
      if (event.key === "]" || event.key === "=") {
        event.preventDefault();
        const next = Math.min(160, Math.round(controls.brushSize + 4));
        setControl(CONTROL_KEYS.brushSize, next);
      }
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        setControl(CONTROL_KEYS.brushMode, BRUSH_MODES.ADD);
      }
      if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        setControl(CONTROL_KEYS.brushMode, BRUSH_MODES.ERASE);
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setAutoFillNonce((n) => n + 1);
      }
      if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        setControl(CONTROL_KEYS.brushType, BRUSH_TYPES[0]);
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        setControl(CONTROL_KEYS.brushType, BRUSH_TYPES[1]);
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        setControl(CONTROL_KEYS.brushType, BRUSH_TYPES[2]);
      }
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        setClearPaintNonce((n) => n + 1);
      }
      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        setControl(CONTROL_KEYS.layerCarve, !controls.layerCarve);
      }
      if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        setControl(CONTROL_KEYS.layerPigment, !controls.layerPigment);
      }
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setControl(CONTROL_KEYS.layerPaint, !controls.layerPaint);
      }
      if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        setControl(CONTROL_KEYS.layerGrain, !controls.layerGrain);
      }
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        setControl(CONTROL_KEYS.layerDebugOverlay, !controls.layerDebugOverlay);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    controls.brushSize,
    controls.paintEnabled,
    controls.layerCarve,
    controls.layerPigment,
    controls.layerPaint,
    controls.layerGrain,
    controls.layerDebugOverlay,
  ]);


  useEffect(() => {
    if (!paletteSets.length) return;
    const labels = new Set(["Default palette", ...paletteSets.map((p) => p.label)]);
    if (!labels.has(controls.selectedPaletteLabel)) {
      const fallback = paletteSets.find((p) => p.label.includes("K-means (clamped)"))?.label || paletteSets[0].label;
      setControl(CONTROL_KEYS.selectedPaletteLabel, fallback);
    }
  }, [controls.selectedPaletteLabel, paletteSets]);

  const paletteOptions = useMemo(
    () => ["Default palette", ...paletteSets.map((p) => p.label)],
    [paletteSets]
  );

  const selectedPalette = useMemo(() => {
    if (controls.selectedPaletteLabel === "Default palette") return DEFAULT_PALETTE_LINEAR;
    return paletteSets.find((p) => p.label === controls.selectedPaletteLabel)?.colors || DEFAULT_PALETTE_LINEAR;
  }, [controls.selectedPaletteLabel, paletteSets]);

  const debugMap = useMemo(() => DEBUG_MODES, []);
  const debugOptions = DEBUG_LABELS;

  const activeLine = lineImg ?? defaultLineImg;
  const activeColor = colorImg ?? defaultColorImg;
  const activeGrain = grainImg ?? defaultGrainImg;

  const handleDebugLayerSelect = (label) => {
    if (controls.debugMode === label) {
      setControl(CONTROL_KEYS.debugMode, DEBUG_LABELS[0]);
      setControl(CONTROL_KEYS.layerDebugOverlay, false);
      return;
    }
    setControl(CONTROL_KEYS.debugMode, label);
    setControl(CONTROL_KEYS.layerDebugOverlay, true);
  };

  return (
    <div className="app">
      <div className="window-shell">
        <div className="global-top">
          <div className="global-title">
            <div className="title">Woodblock Shader Studio</div>
            <div className="subtitle">Carving definition + pigment fill MVP</div>
          </div>
          <div className="top-nav">
            <button type="button" className="nav-btn" disabled>
              Import
            </button>
            <button type="button" className="nav-btn" disabled>
              Export
            </button>
            <button type="button" className="nav-btn" disabled>
              Assets
            </button>
            <a className="nav-btn" href="/pbp-gpu-test.html">
              PBP GPU Test
            </a>
          </div>
        </div>
        <div className="top-tool-bar">
          <div className="workflow-dock">
            <div className="section-title">Workflow</div>
            <div className="workflow-row">
              <button
                type="button"
                className={`workflow-btn ${controls.workflowMode === "Artist" ? "active" : ""}`}
                onClick={() => setControl(CONTROL_KEYS.workflowMode, "Artist")}
              >
                Artist
              </button>
              <button
                type="button"
                className={`workflow-btn ${controls.workflowMode === "Developer" ? "active" : ""}`}
                onClick={() => setControl(CONTROL_KEYS.workflowMode, "Developer")}
              >
                Developer
              </button>
            </div>
          </div>
          <TopToolDock
            selectedPalette={selectedPalette}
            onClearPaint={() => setClearPaintNonce((n) => n + 1)}
            onAutoFill={() => setAutoFillNonce((n) => n + 1)}
          />
        </div>
        <div className="sidebar">
          <PigmentPhysicsPanel
            pigmentProfiles={pigmentProfiles}
            onPigmentProfileChange={handlePigmentProfileChange}
          />
          <WoodMediumPanel />
          <BrushPresetsPanel
            sections={presetSections}
          />
          <LayerStack onSelectDebugLayer={handleDebugLayerSelect} />
          <PaletteExtractionPanel
            paletteOptions={paletteOptions}
            paletteSets={paletteSets}
          />
          <CollapsibleSection
            title="Source plates"
            collapsed={controls.auxCollapsed}
            onToggle={() => setControl(CONTROL_KEYS.auxCollapsed, !controls.auxCollapsed)}
            tooltip="Show or hide source plate inputs."
          >
            <FilePicker
              label="Line art"
              accept="image/*"
              onPick={setLineFile}
              valueLabel={lineImg?._labelName || (defaultLineImg ? DEFAULT_LINE_URL : "none")}
            />
            <FilePicker
              label="Color reference"
              accept="image/*"
              onPick={setColorFile}
              valueLabel={colorImg?._labelName || (defaultColorImg ? DEFAULT_COLOR_URL : "none")}
            />
            <FilePicker
              label="Wood grain"
              accept="image/*"
              onPick={setGrainFile}
              valueLabel={grainImg?._labelName || (defaultGrainImg ? DEFAULT_GRAIN_URL : "none")}
            />
          </CollapsibleSection>
        </div>
        {controls.workflowMode === "Developer" && (
          <div className="debug-dock">
            <CollapsibleSection
              title="Debug + compute"
              collapsed={controls.debugCollapsed}
              onToggle={() => setControl(CONTROL_KEYS.debugCollapsed, !controls.debugCollapsed)}
              tooltip="Show debug views and compute details."
            >
              <div className="debug-panel">
                <div className="section-title">Shader debug</div>
                <div className="debug-grid">
                  {debugOptions.map((label) => (
                    <button
                      key={label}
                      type="button"
                      className={`debug-chip has-tip ${controls.debugMode === label ? "active" : ""}`}
                      onClick={() => setControl(CONTROL_KEYS.debugMode, label)}
                      data-tooltip={`View ${label.toLowerCase()} output.`}
                    >
                      {label}
                    </button>
                ))}
              </div>
            </div>
            <PbpBridgePanel
              pbpDebugRef={pbpDebugRef}
              pbpSummary={ui.pbpSummary}
              setPbpSummary={(summary) => {
                uiStore.pbpSummary = summary;
              }}
              pbpStats={ui.pbpStats}
              setPbpStats={(stats) => {
                uiStore.pbpStats = stats;
              }}
            />
            <div className="section-title">Compute</div>
            <div className="compute-row">
              <label htmlFor="computeSelect">Backend</label>
              <select
                id="computeSelect"
                value={controls.computeBackend}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.computeBackend, event.target.value)
                }
                className="has-tip"
                data-tooltip="CPU mode for stable, predictable results."
              >
                <option value={COMPUTE_BACKENDS.CPU}>CPU</option>
              </select>
            </div>
            <div className="compute-row">
              <label htmlFor="textureSizeSelect">Texture size</label>
              <select
                id="textureSizeSelect"
                value={controls.pbpTextureSize}
                onChange={(event) =>
                  openTextureSizeConfirm(Number(event.target.value))
                }
                className="has-tip"
                data-tooltip="PBP buffer resolution (256–4096)."
              >
                <option value={256}>256</option>
                <option value={512}>512</option>
                <option value={1024}>1024</option>
                <option value={2048}>2048</option>
                <option value={4096}>4096</option>
              </select>
            </div>
            <div className="compute-note">
              WebGPU: {ui.webgpuSupported ? "supported" : "not available"}
            </div>
          </CollapsibleSection>
        </div>
      )}
      <WebGPUView
        lineImg={activeLine}
        colorImg={activeColor}
        grainImg={activeGrain}
        brushCursorRef={brushCursorRef}
        onPbpDebugReady={(api) => {
          pbpDebugRef.current = api;
        }}
        pigmentProfiles={pigmentProfiles}
        controls={{
          ...controls,
          debugMode: debugMap[controls.debugMode] ?? 0,
          clearPaint: clearPaintNonce,
          autoFillNonce,
          layerCarve: controls.layerCarve,
          layerPigment: controls.layerPigment,
          layerPaint: controls.layerPaint,
          layerGrain: controls.layerGrain,
          layerDebugOverlay: controls.layerDebugOverlay,
          selectedPalette,
          selectedPigmentIndex: controls.selectedPigmentIndex,
        }}
        onPaletteSets={setPaletteSets}
      />
        <BottomStrip
          onClearPaint={() => setClearPaintNonce((n) => n + 1)}
        />
      </div>
      {ui.showPresetModal && (
        <PresetModal
          presetName={ui.presetName}
          onChangeName={(name) => {
            uiStore.presetName = name;
          }}
          onSave={() => {
            handlePresetSave(ui.presetSaveType);
            uiStore.showPresetModal = false;
          }}
          onCancel={() => {
            uiStore.showPresetModal = false;
          }}
        />
      )}
      {ui.confirmModal.open && (
        <ConfirmModal
          title={ui.confirmModal.title}
          message={ui.confirmModal.message}
          confirmLabel={ui.confirmModal.confirmLabel || "Confirm"}
          confirmTone={ui.confirmModal.confirmTone || "danger"}
          onCancel={closeConfirmModal}
          onConfirm={() => {
            if (ui.confirmModal.type === "texture-size") {
              const nextSize = ui.confirmModal.payload?.size ?? pendingTextureSizeRef.current;
              if (nextSize) {
                setControl(CONTROL_KEYS.pbpTextureSize, nextSize);
              }
              closeConfirmModal();
              return;
            }
            executePresetDelete(ui.confirmModal.type, ui.confirmModal.targetId);
            closeConfirmModal();
          }}
        />
      )}
      <div
        className={`tooltip-layer ${ui.tooltip.visible ? "active" : ""}`}
        style={{ left: ui.tooltip.x, top: ui.tooltip.y }}
        aria-hidden="true"
      >
        {ui.tooltip.text}
      </div>
    </div>
  );
}
