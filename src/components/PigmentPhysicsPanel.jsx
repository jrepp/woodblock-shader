import { useState } from "react";
import { CONTROL_KEYS } from "../state/controls.js";
import { useControls } from "../state/useControls.js";

export default function PigmentPhysicsPanel({
  pigmentProfiles = [],
  onPigmentProfileChange,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { controls, setControl } = useControls();
  const selectedPigmentIndex = controls.selectedPigmentIndex ?? 0;
  const activeProfile = pigmentProfiles[selectedPigmentIndex] || {};
  const profileOpacity = typeof activeProfile.opacity === "number" ? activeProfile.opacity : 1.0;
  const profileChroma = typeof activeProfile.chroma === "number" ? activeProfile.chroma : 1.0;
  const profileValueBias = typeof activeProfile.valueBias === "number" ? activeProfile.valueBias : 0.0;
  return (
    <div className={`ui-block pigment-physics ${collapsed ? "collapsed" : ""}`}>
      <button
        className="collapsible-toggle"
        type="button"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span>Pigment physics</span>
        <span className="collapse-icon">{collapsed ? "Show" : "Hide"}</span>
      </button>
      {!collapsed && (
        <div className="collapsible-body">
          <div className="physics-grid">
            <label className="physics-row has-tip" data-tooltip="Overall pigment strength per stroke.">
              <span>Alpha</span>
              <input
                type="range"
                min={0.2}
                max={0.8}
                step={0.01}
                value={controls.pigmentAlpha}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.pigmentAlpha, Number(event.target.value))
                }
              />
              <span>{controls.pigmentAlpha.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Limits saturation to keep pigments earthy.">
              <span>Chroma limit</span>
              <input
                type="range"
                min={0.2}
                max={0.9}
                step={0.02}
                value={controls.pigmentChromaLimit}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.pigmentChromaLimit, Number(event.target.value))
                }
              />
              <span>{controls.pigmentChromaLimit.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Speckle amount from pigment granules.">
              <span>Granularity</span>
              <input
                type="range"
                min={0.0}
                max={0.5}
                step={0.02}
                value={controls.pigmentGranularity}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.pigmentGranularity, Number(event.target.value))
                }
              />
              <span>{controls.pigmentGranularity.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Darkens pigments to feel more natural.">
              <span>Value bias</span>
              <input
                type="range"
                min={0.0}
                max={0.35}
                step={0.01}
                value={controls.pigmentValueBias}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.pigmentValueBias, Number(event.target.value))
                }
              />
              <span>{controls.pigmentValueBias.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Pigment gathering near carved edges.">
              <span>Edge pooling</span>
              <input
                type="range"
                min={0.0}
                max={0.4}
                step={0.02}
                value={controls.pigmentEdgePooling}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.pigmentEdgePooling, Number(event.target.value))
                }
              />
              <span>{controls.pigmentEdgePooling.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="How much pigment follows carved flow.">
              <span>Flow strength</span>
              <input
                type="range"
                min={0.0}
                max={1.5}
                step={0.05}
                value={controls.pigmentFlowStrength}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.pigmentFlowStrength, Number(event.target.value))
                }
              />
              <span>{controls.pigmentFlowStrength.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Adds organic noise to pigment coverage.">
              <span>Noise strength</span>
              <input
                type="range"
                min={0.0}
                max={0.35}
                step={0.01}
                value={controls.pigmentNoiseStrength}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.pigmentNoiseStrength, Number(event.target.value))
                }
              />
              <span>{controls.pigmentNoiseStrength.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Scale of pigment noise pattern.">
              <span>Noise scale</span>
              <input
                type="range"
                min={0.6}
                max={3.0}
                step={0.05}
                value={controls.pigmentNoiseScale}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.pigmentNoiseScale, Number(event.target.value))
                }
              />
              <span>{controls.pigmentNoiseScale.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Registration drift between ink and pigment.">
              <span>Registration</span>
              <input
                type="range"
                min={0.0}
                max={0.004}
                step={0.0002}
                value={controls.registration}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.registration, Number(event.target.value))
                }
              />
              <span>{controls.registration.toFixed(4)}</span>
            </label>
          </div>
          <div className="physics-section">
            <div className="section-title">Per-pigment PBP</div>
            <div className="physics-subtitle">Pigment #{selectedPigmentIndex + 1}</div>
            <label className="physics-row has-tip" data-tooltip="Per-pigment opacity multiplier.">
              <span>Opacity</span>
              <input
                type="range"
                min={0.2}
                max={1.2}
                step={0.02}
                value={profileOpacity}
                onChange={(event) =>
                  onPigmentProfileChange?.(selectedPigmentIndex, "opacity", Number(event.target.value))
                }
              />
              <span>{profileOpacity.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Per-pigment saturation multiplier.">
              <span>Chroma</span>
              <input
                type="range"
                min={0.2}
                max={1.2}
                step={0.02}
                value={profileChroma}
                onChange={(event) =>
                  onPigmentProfileChange?.(selectedPigmentIndex, "chroma", Number(event.target.value))
                }
              />
              <span>{profileChroma.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Per-pigment darkening bias.">
              <span>Value bias</span>
              <input
                type="range"
                min={0.0}
                max={0.3}
                step={0.01}
                value={profileValueBias}
                onChange={(event) =>
                  onPigmentProfileChange?.(selectedPigmentIndex, "valueBias", Number(event.target.value))
                }
              />
              <span>{profileValueBias.toFixed(2)}</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
