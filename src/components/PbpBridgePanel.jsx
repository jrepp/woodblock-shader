import { useControls } from "../state/useControls.js";

export default function PbpBridgePanel({
  pbpDebugRef,
  pbpSummary,
  setPbpSummary,
  pbpStats,
  setPbpStats,
}) {
  const { controls } = useControls();
  return (
    <>
      <div className="section-title">PBP bridge</div>
      <div className="compute-row">
        <button
          className="tool-btn has-tip"
          type="button"
          onClick={() => pbpDebugRef.current?.step?.(5)}
          data-tooltip="Advance PBP simulation by 5 steps."
        >
          Step x5
        </button>
        <button
          className="tool-btn has-tip"
          type="button"
          onClick={() =>
            pbpDebugRef.current?.stamp?.({
              uv: { x: 0.5, y: 0.5 },
              brushType: controls.brushType,
              pressure: controls.brushOpacity,
            })
          }
          data-tooltip="Stamp at center using current brush."
        >
          Stamp center
        </button>
      </div>
      <div className="compute-row">
        <button
          className="tool-btn has-tip"
          type="button"
          onClick={() => {
            const summary = pbpDebugRef.current?.getBufferSummary?.();
            if (summary) console.table(summary);
            setPbpSummary(summary || null);
          }}
          data-tooltip="Log buffer summary to console."
        >
          Log buffers
        </button>
        <button
          className="tool-btn has-tip"
          type="button"
          onClick={() => {
            const stats = pbpDebugRef.current?.getStats?.();
            setPbpStats(stats || null);
          }}
          data-tooltip="Refresh PBP timing stats."
        >
          Stats
        </button>
        <button
          className="tool-btn has-tip"
          type="button"
          onClick={() => pbpDebugRef.current?.resetLoad?.()}
          data-tooltip="Reset tool load."
        >
          Reset load
        </button>
      </div>
      {pbpStats && (
        <div className="pbp-summary">
          <div className="pbp-row">
            <span>stamp ms</span>
            <span>{pbpStats.stampMs?.toFixed(2)}</span>
          </div>
          <div className="pbp-row">
            <span>step ms</span>
            <span>{pbpStats.stepMs?.toFixed(2)}</span>
          </div>
          <div className="pbp-row">
            <span>upload ms</span>
            <span>{pbpStats.uploadMs?.toFixed(2)}</span>
          </div>
        </div>
      )}
      {pbpSummary && (
        <div className="pbp-summary">
          {Object.entries(pbpSummary).map(([key, stats]) => (
            <div key={key} className="pbp-row">
              <span>{key}</span>
              <span>
                {stats.min} / {stats.max} / {stats.avg.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
