export default function CollapsibleSection({ title, collapsed, onToggle, children, tooltip }) {
  return (
    <div className={`ui-block collapsible ${collapsed ? "collapsed" : ""}`}>
      <button
        className="collapsible-toggle has-tip"
        type="button"
        onClick={onToggle}
        data-tooltip={tooltip || `Toggle ${title.toLowerCase()}.`}
      >
        <span>{title}</span>
        <span className="collapse-icon">{collapsed ? "Show" : "Hide"}</span>
      </button>
      {!collapsed && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
