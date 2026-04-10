import ModalShell from "./ModalShell.jsx";

export default function ConfirmModal({
  title,
  message,
  confirmLabel = "Delete",
  confirmTone = "danger",
  onConfirm,
  onCancel,
}) {
  return (
    <ModalShell
      onConfirm={onConfirm}
      onCancel={onCancel}
      className="confirm-card"
      ariaLabelledBy="confirm-modal-title"
      ariaDescribedBy="confirm-modal-desc"
      autoFocusPrimary
    >
      <div id="confirm-modal-title" className="preset-card-title">
        {title}
      </div>
      <div id="confirm-modal-desc" className="confirm-message">
        {message}
      </div>
      <div className="preset-card-actions">
        <button type="button" className="preset-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={`preset-btn ${confirmTone}`}
          onClick={onConfirm}
          data-primary="true"
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
