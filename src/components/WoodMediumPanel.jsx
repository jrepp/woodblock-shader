import { useState } from "react";
import { CONTROL_KEYS } from "../state/controls.js";
import { useControls } from "../state/useControls.js";

export default function WoodMediumPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const { controls, setControl } = useControls();
  return (
    <div className={`ui-block wood-medium ${collapsed ? "collapsed" : ""}`}>
      <button
        className="collapsible-toggle"
        type="button"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span>Wood medium</span>
        <span className="collapse-icon">{collapsed ? "Show" : "Hide"}</span>
      </button>
      {!collapsed && (
        <div className="collapsible-body">
          <div className="physics-grid">
            <label className="physics-row has-tip" data-tooltip="How much the wood absorbs wet pigment.">
              <span>Absorbency</span>
              <input
                type="range"
                min={0.6}
                max={1.6}
                step={0.05}
                value={controls.woodAbsorbency}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.woodAbsorbency, Number(event.target.value))
                }
              />
              <span>{controls.woodAbsorbency.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Fiber texture influence on pigment breakup.">
              <span>Fiber</span>
              <input
                type="range"
                min={0.2}
                max={1.2}
                step={0.05}
                value={controls.woodFiberStrength}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.woodFiberStrength, Number(event.target.value))
                }
              />
              <span>{controls.woodFiberStrength.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Scale of the wood grain texture.">
              <span>Grain scale</span>
              <input
                type="range"
                min={0.6}
                max={2.2}
                step={0.05}
                value={controls.grainScale}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.grainScale, Number(event.target.value))
                }
              />
              <span>{controls.grainScale.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Normal strength from wood grain.">
              <span>Grain normal</span>
              <input
                type="range"
                min={0.0}
                max={0.25}
                step={0.01}
                value={controls.grainNormal}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.grainNormal, Number(event.target.value))
                }
              />
              <span>{controls.grainNormal.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Capillary spread along the grain.">
              <span>Capillary</span>
              <input
                type="range"
                min={0.2}
                max={1.6}
                step={0.05}
                value={controls.woodCapillary}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.woodCapillary, Number(event.target.value))
                }
              />
              <span>{controls.woodCapillary.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Extra pooling at ridges and cavities.">
              <span>Pooling bias</span>
              <input
                type="range"
                min={0.0}
                max={0.3}
                step={0.01}
                value={controls.woodPoolingBias}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.woodPoolingBias, Number(event.target.value))
                }
              />
              <span>{controls.woodPoolingBias.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Rate pigment stains the wood.">
              <span>Stain rate</span>
              <input
                type="range"
                min={0.0}
                max={0.08}
                step={0.005}
                value={controls.woodStainRate}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.woodStainRate, Number(event.target.value))
                }
              />
              <span>{controls.woodStainRate.toFixed(3)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="How quickly wet pigment dries.">
              <span>Drying rate</span>
              <input
                type="range"
                min={0.0}
                max={0.08}
                step={0.005}
                value={controls.woodDryingRate}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.woodDryingRate, Number(event.target.value))
                }
              />
              <span>{controls.woodDryingRate.toFixed(3)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="How much pigment mass remains after flow.">
              <span>Mass retain</span>
              <input
                type="range"
                min={0.6}
                max={0.98}
                step={0.01}
                value={controls.woodMassRetention}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.woodMassRetention, Number(event.target.value))
                }
              />
              <span>{controls.woodMassRetention.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Grain influence on capillary spread.">
              <span>Grain influence</span>
              <input
                type="range"
                min={0.0}
                max={0.6}
                step={0.02}
                value={controls.woodGrainInfluence}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.woodGrainInfluence, Number(event.target.value))
                }
              />
              <span>{controls.woodGrainInfluence.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Bias pigment to low relief areas.">
              <span>Relief bias</span>
              <input
                type="range"
                min={0.2}
                max={2.0}
                step={0.05}
                value={controls.woodReliefBias}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.woodReliefBias, Number(event.target.value))
                }
              />
              <span>{controls.woodReliefBias.toFixed(2)}</span>
            </label>
            <label className="physics-row has-tip" data-tooltip="Overall relief shading contrast.">
              <span>Carve contrast</span>
              <input
                type="range"
                min={0.6}
                max={2.2}
                step={0.05}
                value={controls.carveContrast}
                onChange={(event) =>
                  setControl(CONTROL_KEYS.carveContrast, Number(event.target.value))
                }
              />
              <span>{controls.carveContrast.toFixed(2)}</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
