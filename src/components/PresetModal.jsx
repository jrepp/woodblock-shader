import ModalShell from "./ModalShell.jsx";

export default function PresetModal({
  presetName,
  onChangeName,
  onSave,
  onCancel,
}) {
  return (
    <ModalShell
      onConfirm={onSave}
      onCancel={onCancel}
      ariaLabelledBy="preset-modal-title"
      autoFocusPrimary
    >
      <div id="preset-modal-title" className="preset-card-title">
        Save preset
      </div>
      <input
        className="preset-input"
        type="text"
        value={presetName}
        placeholder="Preset name"
        onChange={(event) => onChangeName(event.target.value)}
      />
      <div className="preset-card-actions">
        <button className="preset-btn" type="button" onClick={onSave} data-primary="true">
          Save
        </button>
        <button className="preset-btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}
