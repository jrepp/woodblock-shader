export const PBP_DEFAULTS = {
  pigmentId: 0,
  pigmentMix: 0,
  coverage: 0,
  water: 0,
  mass: 0,
  edgePool: 0,
  stain: 0,
};

export const PBP_BUFFER_LAYOUT = {
  pigmentId: { format: "R8", channels: ["id"], range: [0, 255] },
  pigmentMix: { format: "RGBA8", channels: ["w0", "w1", "w2", "w3"], range: [0, 255] },
  coverage: { format: "R8", channels: ["coverage"], range: [0, 1] },
  water: { format: "R8", channels: ["water"], range: [0, 1] },
  mass: { format: "R8", channels: ["mass"], range: [0, 1] },
  edgePool: { format: "R8", channels: ["pool"], range: [0, 1] },
  stain: { format: "R8", channels: ["stain"], range: [0, 1] },
};

export const BRUSH_TYPES = ["Daubing", "Rough", "Smudge"];

export const PBP_TOOL_DEFAULTS = {
  Daubing: {
    radius: 0.06,
    edgeSoftness: 0.9,
    stampIrregularity: 0.4,
    baseDeposit: 0.4,
    depositVariance: 0.45,
    loadDecay: 0.08,
    inkSuppression: 0.9,
    edgePooling: 0.35,
    grainInfluence: 0.35,
    capillarySpread: 0.35,
  },
  Rough: {
    radius: 0.03,
    edgeSoftness: 0.55,
    contactJitter: 0.18,
    baseDeposit: 0.55,
    depositVariance: 0.25,
    loadDecay: 0.12,
    inkSuppression: 0.75,
    edgePooling: 0.25,
    grainInfluence: 0.2,
    capillarySpread: 0.2,
  },
  Smudge: {
    radius: 0.05,
    edgeSoftness: 0.95,
    smearStrength: 0.6,
    liftStrength: 0.2,
    blurStrength: 0.5,
    directionalBias: 0.2,
  },
};
