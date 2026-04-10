export const DEBUG_MODES = Object.freeze({
  Final: 0,
  Height: 1,
  Normal: 2,
  "Pigment mask": 3,
  "Wood grain": 4,
  "Pigment noise": 5,
  "Pigment fill": 6,
  "Pigment low": 7,
  "Pigment edge": 8,
  "PBP coverage": 9,
  "PBP water": 10,
  "PBP mass": 11,
  "PBP edge pool": 12,
  "PBP stain": 13,
  "PBP pigment id": 14,
  "PBP mix w0": 15,
  "PBP mix w1": 16,
  "PBP mix w2": 17,
  "PBP mix w3": 18,
  "PBP mix color": 19,
  Cavity: 20,
  Pooling: 21,
  Flow: 22,
});

export const DEBUG_LABELS = Object.freeze(
  Object.keys(DEBUG_MODES).sort((a, b) => DEBUG_MODES[a] - DEBUG_MODES[b])
);
