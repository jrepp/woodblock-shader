import ToolIcon from "./ToolIcon.jsx";
import { BRUSH_MODES, BRUSH_TYPES } from "../state/constants.js";
import { CONTROL_KEYS } from "../state/controls.js";
import { useControls } from "../state/useControls.js";

export default function BottomStrip({ onClearPaint }) {
  const { controls, setControl } = useControls();
  return (
    <div className="bottom-strip">
      <button
        type="button"
        className={`strip-btn has-tip ${!controls.paintEnabled ? "active" : ""}`}
        onClick={() => setControl(CONTROL_KEYS.paintEnabled, false)}
        data-tooltip="Hand mode: orbit and pan. (H)"
      >
        Hand
      </button>
      <button
        type="button"
        className={`strip-btn has-tip ${controls.paintEnabled ? "active" : ""}`}
        onClick={() => setControl(CONTROL_KEYS.paintEnabled, true)}
        data-tooltip="Paint mode: raycast pigment. (P)"
      >
        Paint
      </button>
      <div className="strip-group">
        <button
          type="button"
          className={`strip-icon-btn has-tip ${controls.brushMode === BRUSH_MODES.ADD ? "active" : ""}`}
          onClick={() => setControl(CONTROL_KEYS.brushMode, BRUSH_MODES.ADD)}
          data-tooltip="Add pigment. (A)"
          aria-label="Add pigment"
        >
          <ToolIcon name="add" />
          <span className="visually-hidden">Add</span>
        </button>
        <button
          type="button"
          className={`strip-icon-btn has-tip ${controls.brushMode === BRUSH_MODES.ERASE ? "active" : ""}`}
          onClick={() => setControl(CONTROL_KEYS.brushMode, BRUSH_MODES.ERASE)}
          data-tooltip="Erase pigment. (E)"
          aria-label="Erase pigment"
        >
          <ToolIcon name="erase" />
          <span className="visually-hidden">Erase</span>
        </button>
      </div>
      <div className="strip-group">
        <button
          type="button"
          className={`strip-chip has-tip ${controls.brushType === BRUSH_TYPES[0] ? "active" : ""}`}
          onClick={() => setControl(CONTROL_KEYS.brushType, BRUSH_TYPES[0])}
          data-tooltip="Daubing pad. (D)"
        >
          Daub
        </button>
        <button
          type="button"
          className={`strip-chip has-tip ${controls.brushType === BRUSH_TYPES[1] ? "active" : ""}`}
          onClick={() => setControl(CONTROL_KEYS.brushType, BRUSH_TYPES[1])}
          data-tooltip="Rough brush. (R)"
        >
          Rough
        </button>
        <button
          type="button"
          className={`strip-chip has-tip ${controls.brushType === BRUSH_TYPES[2] ? "active" : ""}`}
          onClick={() => setControl(CONTROL_KEYS.brushType, BRUSH_TYPES[2])}
          data-tooltip="Finger smudge. (S)"
        >
          Smudge
        </button>
      </div>
      <label className="strip-slider has-tip" data-tooltip="Brush size. ([ / ])">
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
      <label className="strip-slider has-tip" data-tooltip="Opacity per stroke.">
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
      <button
        type="button"
        className="strip-btn has-tip"
        onClick={onClearPaint}
        data-tooltip="Clear paint mask. (C)"
      >
        Clear
      </button>
    </div>
  );
}
