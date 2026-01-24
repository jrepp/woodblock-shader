import ToolIcon from "./ToolIcon.jsx";
import { clamp01, linearToSrgb } from "../woodblock/js/math.js";
import { BRUSH_MODES, BRUSH_TYPES } from "../state/constants.js";
import { CONTROL_KEYS } from "../state/controls.js";
import { useControls } from "../state/useControls.js";

export default function TopToolDock({
  selectedPalette,
  onAutoFill,
  onClearPaint,
}) {
  const { controls, setControl } = useControls();
  return (
    <div className="top-dock">
      <div className="top-dock-bar">
        <div className="top-dock-group">
          <button
            className={`tool-btn has-tip ${!controls.paintEnabled ? "active" : ""}`}
            type="button"
            onClick={() => setControl(CONTROL_KEYS.paintEnabled, false)}
            data-tooltip="Hand mode: orbit and pan the carving. (H)"
          >
            Hand
          </button>
          <button
            className={`tool-btn has-tip ${controls.paintEnabled ? "active" : ""}`}
            type="button"
            onClick={() => setControl(CONTROL_KEYS.paintEnabled, true)}
            data-tooltip="Paint mode: raycast into the scene to apply pigment. (P)"
          >
            Paint
          </button>
        </div>
        <div className="palette-primary compact">
          <div className="palette-name">{controls.selectedPaletteLabel}</div>
          <div className="palette-swatches primary">
            {selectedPalette.map((c, index) => {
              const r = clamp01(linearToSrgb(c[0]));
              const g = clamp01(linearToSrgb(c[1]));
              const b = clamp01(linearToSrgb(c[2]));
              return (
                <span
                  key={`active-${index}`}
                  className={`palette-swatch ${controls.selectedPigmentIndex === index ? "active" : ""}`}
                  style={{ background: `rgb(${(r * 255) | 0}, ${(g * 255) | 0}, ${(b * 255) | 0})` }}
                  onClick={() => setControl(CONTROL_KEYS.selectedPigmentIndex, index)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      setControl(CONTROL_KEYS.selectedPigmentIndex, index);
                    }
                  }}
                />
              );
            })}
          </div>
        </div>
        <div className="top-dock-group brush-grid">
          <div className="brush-row">
            <button
              className={`tool-chip has-tip ${controls.brushType === BRUSH_TYPES[0] ? "active" : ""}`}
              type="button"
              onClick={() => setControl(CONTROL_KEYS.brushType, BRUSH_TYPES[0])}
              data-tooltip="Daubing pad: blotchy stamping for broad fills. (D)"
            >
              Daubing
            </button>
            <button
              className={`tool-chip has-tip ${controls.brushType === BRUSH_TYPES[1] ? "active" : ""}`}
              type="button"
              onClick={() => setControl(CONTROL_KEYS.brushType, BRUSH_TYPES[1])}
              data-tooltip="Rough brush: worn, uneven edge strokes. (R)"
            >
              Rough
            </button>
            <button
              className={`tool-chip has-tip ${controls.brushType === BRUSH_TYPES[2] ? "active" : ""}`}
              type="button"
              onClick={() => setControl(CONTROL_KEYS.brushType, BRUSH_TYPES[2])}
              data-tooltip="Finger smudge: soft blend and lift. (S)"
            >
              Smudge
            </button>
          </div>
          <div className="brush-row">
            <button
              className={`tool-icon-btn has-tip ${controls.brushMode === BRUSH_MODES.ADD ? "active" : ""}`}
              type="button"
              onClick={() => setControl(CONTROL_KEYS.brushMode, BRUSH_MODES.ADD)}
              data-tooltip="Add pigment to the mask. (A)"
              aria-label="Add pigment"
            >
              <ToolIcon name="add" />
              <span className="visually-hidden">Add</span>
            </button>
            <button
              className={`tool-icon-btn has-tip ${controls.brushMode === BRUSH_MODES.ERASE ? "active" : ""}`}
              type="button"
              onClick={() => setControl(CONTROL_KEYS.brushMode, BRUSH_MODES.ERASE)}
              data-tooltip="Erase pigment from the mask. (E)"
              aria-label="Erase pigment"
            >
              <ToolIcon name="erase" />
              <span className="visually-hidden">Erase</span>
            </button>
            <button
              className="tool-icon-btn has-tip"
              type="button"
              onClick={onAutoFill}
              data-tooltip="Auto-fill low carving areas now. (F)"
              aria-label="Auto fill"
            >
              <ToolIcon name="fill" />
              <span className="visually-hidden">Fill</span>
            </button>
            <button
              className="tool-icon-btn ghost has-tip"
              type="button"
              onClick={onClearPaint}
              data-tooltip="Clear the paint mask. (C)"
              aria-label="Clear paint"
            >
              <ToolIcon name="clear" />
              <span className="visually-hidden">Clear</span>
            </button>
          </div>
        </div>
        <div className="top-dock-group">
          <label className="tool-slider has-tip" data-tooltip="Adjust brush diameter. ([ / ])">
            <span>Size</span>
            <input
              type="range"
              min={4}
              max={160}
              step={1}
              value={controls.brushSize}
              onChange={(event) => setControl(CONTROL_KEYS.brushSize, Number(event.target.value))}
            />
          </label>
          <label className="tool-slider has-tip" data-tooltip="Brush opacity per stroke.">
            <span>Opacity</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={controls.brushOpacity}
              onChange={(event) => setControl(CONTROL_KEYS.brushOpacity, Number(event.target.value))}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
