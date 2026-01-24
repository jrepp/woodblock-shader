import PaletteSwatches from "./PaletteSwatches.jsx";
import { CONTROL_KEYS } from "../state/controls.js";
import { useControls } from "../state/useControls.js";

export default function PaletteExtractionPanel({ paletteOptions, paletteSets }) {
  const { controls, setControl } = useControls();
  return (
    <div className="ui-block">
      <div className="section-title">Palette extraction</div>
      <div className="palette-select">
        <label htmlFor="paletteSelect">Active palette</label>
        <select
          id="paletteSelect"
          value={controls.selectedPaletteLabel}
          onChange={(event) => setControl(CONTROL_KEYS.selectedPaletteLabel, event.target.value)}
          className="has-tip"
          data-tooltip="Choose which extracted palette drives pigments."
        >
          {paletteOptions.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {paletteSets.length ? (
        <PaletteSwatches entries={paletteSets} />
      ) : (
        <div className="empty-state">Upload a color reference to extract pigments.</div>
      )}
    </div>
  );
}
