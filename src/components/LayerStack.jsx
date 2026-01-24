import { useControls } from "../state/useControls.js";
import { CONTROL_KEYS } from "../state/controls.js";

export default function LayerStack({ onSelectDebugLayer }) {
  const { controls, setControl } = useControls();
  const debugMode = controls.debugMode;
  const debugLayers = [
    "Height",
    "Normal",
    "Pigment mask",
    "Wood grain",
    "Pigment noise",
    "Pigment fill",
    "Pigment low",
    "Pigment edge",
    "PBP coverage",
    "PBP water",
    "PBP mass",
    "PBP edge pool",
    "PBP stain",
    "PBP pigment id",
    "Cavity",
    "Pooling",
    "Flow",
  ];
  return (
    <div className="layer-stack">
      <div className="section-title">Layers</div>
      <button
        className={`layer-btn has-tip ${controls.layerCarve ? "active" : ""}`}
        type="button"
        onClick={() => setControl(CONTROL_KEYS.layerCarve, !controls.layerCarve)}
        data-tooltip="Toggle carved relief shading. (L)"
      >
        Carve
      </button>
      <button
        className={`layer-btn has-tip ${controls.layerPigment ? "active" : ""}`}
        type="button"
        onClick={() => setControl(CONTROL_KEYS.layerPigment, !controls.layerPigment)}
        data-tooltip="Toggle pigment simulation. (G)"
      >
        Pigment
      </button>
      <button
        className={`layer-btn has-tip ${controls.layerPaint ? "active" : ""}`}
        type="button"
        onClick={() => setControl(CONTROL_KEYS.layerPaint, !controls.layerPaint)}
        data-tooltip="Toggle the paint mask layer. (M)"
      >
        Paint mask
      </button>
      <button
        className={`layer-btn has-tip ${controls.layerGrain ? "active" : ""}`}
        type="button"
        onClick={() => setControl(CONTROL_KEYS.layerGrain, !controls.layerGrain)}
        data-tooltip="Toggle wood grain influence. (W)"
      >
        Grain
      </button>
      <button
        className={`layer-btn has-tip ${controls.layerDebugOverlay ? "active" : ""}`}
        type="button"
        onClick={() =>
          setControl(CONTROL_KEYS.layerDebugOverlay, !controls.layerDebugOverlay)
        }
        data-tooltip="Toggle debug overlay helpers. (O)"
      >
        Debug overlay
      </button>
      <div className="section-title">Compute layers</div>
      {debugLayers.map((label) => (
        <button
          key={label}
          className={`layer-btn has-tip ${debugMode === label ? "active" : ""}`}
          type="button"
          onClick={() => onSelectDebugLayer(label)}
          data-tooltip={`Preview ${label.toLowerCase()} output.`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
