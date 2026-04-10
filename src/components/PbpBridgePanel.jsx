import { useEffect, useMemo, useState } from "react";
import { useControls } from "../state/useControls.js";
import { getBrushPreset, updateBrushPreset } from "../woodblock/pbp/settings.js";
import { CONTROL_KEYS, setControl } from "../state/controls.js";
import { createBuffersView } from "../woodblock/pbp/buffersView.js";

export default function PbpBridgePanel({
  pbpDebugRef,
  pbpSummary,
  setPbpSummary,
  pbpStats,
  setPbpStats,
}) {
  const { controls } = useControls();
  const [metrics, setMetrics] = useState(null);
  const preset = useMemo(
    () => getBrushPreset(controls.brushType),
    [controls.brushType]
  );
  const [spacingRatio, setSpacingRatio] = useState(preset.input.spacingRatio);
  const [maxSpacingRatio, setMaxSpacingRatio] = useState(preset.input.maxSpacingRatio);
  const [pressureCurve, setPressureCurve] = useState(preset.input.pressureCurve);

  useEffect(() => {
    setSpacingRatio(preset.input.spacingRatio);
    setMaxSpacingRatio(preset.input.maxSpacingRatio);
    setPressureCurve(preset.input.pressureCurve);
  }, [preset]);

  const syncPreset = () => {
    const next = updateBrushPreset(controls.brushType, {
      spacingRatio: Number(spacingRatio),
      maxSpacingRatio: Number(maxSpacingRatio),
      pressureCurve: Number(pressureCurve),
    });
    if (next) {
      setSpacingRatio(next.input.spacingRatio);
      setMaxSpacingRatio(next.input.maxSpacingRatio);
      setPressureCurve(next.input.pressureCurve);
    }
  };
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
        <button
          className="tool-btn has-tip"
          type="button"
          onClick={() => pbpDebugRef.current?.setPigmentSet?.([1, 2, 3, 4])}
          data-tooltip="Set active pigment set to 1,2,3,4."
        >
          Pigment set 1-4
        </button>
        <button
          className="tool-btn has-tip"
          type="button"
          onClick={() => setControl(CONTROL_KEYS.pbpPigmentSet, [1, 2, 3, 4])}
          data-tooltip="Sync renderer pigment set to 1,2,3,4."
        >
          Sync renderer set
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
            const buffers = pbpDebugRef.current?.getBuffers?.();
            if (!buffers) return;
            const view = createBuffersView(buffers);
            setMetrics(view.metrics);
          }}
          data-tooltip="Compute buffer coverage metrics."
        >
          Metrics
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
      <div className="compute-row">
        <div className="section-title" style={{ margin: 0 }}>Stroke preset</div>
      </div>
      <div className="compute-row">
        <label className="tool-label">
          Spacing
          <input
            className="tool-input"
            type="number"
            step="0.05"
            min="0.1"
            max="1.0"
            value={spacingRatio}
            onChange={(event) => setSpacingRatio(event.target.value)}
          />
        </label>
        <label className="tool-label">
          Max spacing
          <input
            className="tool-input"
            type="number"
            step="0.05"
            min="0.1"
            max="1.2"
            value={maxSpacingRatio}
            onChange={(event) => setMaxSpacingRatio(event.target.value)}
          />
        </label>
        <label className="tool-label">
          Pressure curve
          <input
            className="tool-input"
            type="number"
            step="0.05"
            min="0.5"
            max="2.5"
            value={pressureCurve}
            onChange={(event) => setPressureCurve(event.target.value)}
          />
        </label>
        <button className="tool-btn" type="button" onClick={syncPreset}>
          Apply
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
      {metrics && (
        <div className="pbp-summary">
          {Object.entries(metrics).map(([key, value]) => (
            <div key={key} className="pbp-row">
              <span>{key}</span>
              <span>{value.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
