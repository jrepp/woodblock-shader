import { useId } from "react";

export default function FilePicker({ label, accept, onPick, valueLabel }) {
  const inputId = useId();
  return (
    <div className="file-picker">
      <div className="file-label">{label}</div>
      <label
        className="file-button has-tip"
        data-tooltip={`Select a ${label.toLowerCase()} image.`}
        htmlFor={inputId}
      >
        Choose file
      </label>
      <input
        id={inputId}
        className="file-input"
        type="file"
        accept={accept}
        onChange={(event) => onPick(event.target.files?.[0] ?? null)}
      />
      <span className="file-meta">{valueLabel}</span>
    </div>
  );
}
