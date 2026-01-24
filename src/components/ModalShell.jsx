import { useEffect, useRef } from "react";

export default function ModalShell({
  children,
  onConfirm,
  onCancel,
  className = "",
  ariaLabelledBy,
  ariaDescribedBy,
  autoFocusPrimary = false,
}) {
  const rootRef = useRef(null);
  const cardRef = useRef(null);
  const lastActiveRef = useRef(null);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onConfirm?.();
      return;
    }
    if (event.key !== "Tab") return;
    const root = cardRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first || document.activeElement === root) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropClick = (event) => {
    if (cardRef.current && !cardRef.current.contains(event.target)) {
      onCancel?.();
    }
  };

  useEffect(() => {
    lastActiveRef.current = document.activeElement;
    const focusRoot = cardRef.current;
    const focusTarget = autoFocusPrimary
      ? focusRoot?.querySelector('[data-primary="true"]')
      : focusRoot?.querySelector("input");
    const fallback =
      focusTarget ||
      focusRoot?.querySelector(
        'button, [href], select, textarea, [tabindex]:not([tabindex=\"-1\"])'
      ) ||
      focusRoot;
    fallback?.focus?.();
    return () => {
      lastActiveRef.current?.focus?.();
    };
  }, [autoFocusPrimary]);

  return (
    <div
      className="preset-modal"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onMouseDown={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
    >
      <div className={`preset-card ${className}`.trim()} ref={cardRef}>
        {children}
      </div>
    </div>
  );
}
