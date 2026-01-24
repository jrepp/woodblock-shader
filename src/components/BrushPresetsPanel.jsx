import ToolIcon from "./ToolIcon.jsx";

export default function BrushPresetsPanel({ sections }) {
  return (
    <div className="ui-block preset-panel">
      {sections.map((section) => (
        <div key={section.id} className="preset-section">
          <div className="section-title">{section.title}</div>
          <div className="preset-row">
            <select
              className="preset-select"
              value={section.selectedId}
              onChange={(event) => section.onSelect(event.target.value)}
            >
              <option value="">Current</option>
              {section.options.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
          <div className="preset-actions">
            <button
              className="preset-icon-btn has-tip"
              type="button"
              onClick={section.onSave}
              data-tooltip={`Save ${section.title.toLowerCase()} preset`}
              aria-label={`Save ${section.title} preset`}
            >
              <ToolIcon name="save" />
              <span className="visually-hidden">Save</span>
            </button>
            <button
              className="preset-icon-btn has-tip"
              type="button"
              onClick={section.onShare}
              data-tooltip={`Share ${section.title.toLowerCase()} preset`}
              aria-label={`Share ${section.title} preset`}
            >
              <ToolIcon name="share" />
              <span className="visually-hidden">Share</span>
            </button>
            <button
              className="preset-icon-btn has-tip"
              type="button"
              onClick={section.onPaste}
              data-tooltip={`Paste ${section.title.toLowerCase()} preset`}
              aria-label={`Paste ${section.title} preset`}
            >
              <ToolIcon name="paste" />
              <span className="visually-hidden">Paste</span>
            </button>
            <button
              className="preset-icon-btn has-tip"
              type="button"
              onClick={section.onRandomize}
              data-tooltip={`Randomize ${section.title.toLowerCase()} preset`}
              aria-label={`Randomize ${section.title} preset`}
            >
              <ToolIcon name="randomize" />
              <span className="visually-hidden">Randomize</span>
            </button>
            <button
              className="preset-icon-btn has-tip"
              type="button"
              onClick={section.onDelete}
              disabled={!section.canDelete}
              data-tooltip={`Delete ${section.title.toLowerCase()} preset`}
              aria-label={`Delete ${section.title} preset`}
            >
              <ToolIcon name="delete" />
              <span className="visually-hidden">Delete</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
