import { clamp01, linearToSrgb } from "../woodblock/js/math.js";

export default function PaletteSwatches({ entries }) {
  if (!entries.length) return null;
  return (
    <div className="palette-list">
      {entries.map((entry) => (
        <div key={entry.label} className="palette-row">
          <div className="palette-title">{entry.label}</div>
          <div className="palette-swatches">
            {entry.colors.map((c, index) => {
              const r = clamp01(linearToSrgb(c[0]));
              const g = clamp01(linearToSrgb(c[1]));
              const b = clamp01(linearToSrgb(c[2]));
              return (
                <span
                  key={`${entry.label}-${index}`}
                  className="palette-swatch"
                  style={{ background: `rgb(${(r * 255) | 0}, ${(g * 255) | 0}, ${(b * 255) | 0})` }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
