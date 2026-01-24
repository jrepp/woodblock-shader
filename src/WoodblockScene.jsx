import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  imageToCanvas,
  imageToGrayTexture,
  imageToBleachedTexture,
  makeDataTextureR,
  makeDataTextureRGBA,
  makeRepeatDataTextureR,
  buildWoodGrainTex,
  buildWoodGrainTexRGBA,
  buildPigmentNoiseTex,
  buildWoodFiberTex,
  buildHeightFromLineArt,
  buildNormalFromHeight,
  buildEdgeFromHeight,
  buildCavityFromHeight,
  buildFlowFromHeight,
  buildPoolingFromHeight,
} from "./woodblock/js/textures.js";
import {
  DEFAULT_PALETTE_LINEAR,
  DEFAULT_PIGMENT_PROPS,
  extractPaletteKMeans,
  extractPaletteMedianCut,
  extractPaletteHistogram,
  extractPaletteHueBins,
  clampPalette,
  pigmentMaskFromHeight,
} from "./woodblock/js/palette.js";
import { clamp01, linearToSrgb } from "./woodblock/js/math.js";
import { hash2 } from "./woodblock/js/noise.js";
import { createMaterial } from "./woodblock/js/shader.js";
import {
  computePigmentMaskWebGPU,
  computeReliefMapsWebGPU,
} from "./woodblock/js/webgpu.js";
import { PbpEngine } from "./woodblock/pbp/engine.js";
import { BRUSH_MODES, BRUSH_TYPES } from "./state/constants.js";

const MAP_SIZE = 1024;

function SceneContent({
  lineImg,
  colorImg,
  grainImg,
  controls,
  pigmentProfiles,
  onPaletteSets,
  brushCursorRef,
  onPbpDebugReady,
}) {
  const { gl } = useThree();
  const meshRef = useRef(null);
  const frameRef = useRef(null);
  const brushIndicatorRef = useRef(null);
  const gridRef = useRef(null);
  const pointerNdcRef = useRef(new THREE.Vector2(0, 0));
  const raycasterRef = useRef(new THREE.Raycaster());
  const lastHitRef = useRef(null);
  const lastClientRef = useRef({ x: 0, y: 0 });
  const materialRef = useRef(null);
  const paintRef = useRef({ isPainting: false, lastUv: null });
  const lastHeightRef = useRef(null);
  const lastEdgeRef = useRef(null);
  const lastPaletteRef = useRef(DEFAULT_PALETTE_LINEAR.map((c) => c.slice()));
  const rebuildJobRef = useRef(0);
  const maskJobRef = useRef(0);
  const autoFillJobRef = useRef(0);

  const grainData = useMemo(() => buildWoodGrainTex(512), []);
  const grainTex = useMemo(() => makeRepeatDataTextureR(512, 512, grainData), [grainData]);
  const woodColorTex = useMemo(() => {
    const tex = new THREE.DataTexture(buildWoodGrainTexRGBA(512), 512, 512, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }, []);
  const pigmentNoiseTex = useMemo(
    () => makeRepeatDataTextureR(512, 512, buildPigmentNoiseTex(512)),
    []
  );
  const woodFiberTex = useMemo(() => makeRepeatDataTextureR(512, 512, buildWoodFiberTex(512)), []);

  const { heightTex, normalTex } = useMemo(() => {
    const emptyH = new Uint8Array(MAP_SIZE * MAP_SIZE);
    const emptyN = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
    for (let i = 0; i < emptyN.length; i += 4) {
      emptyN[i + 0] = 128;
      emptyN[i + 1] = 128;
      emptyN[i + 2] = 255;
      emptyN[i + 3] = 255;
    }
    return {
      heightTex: makeDataTextureR(MAP_SIZE, MAP_SIZE, emptyH),
      normalTex: makeDataTextureRGBA(MAP_SIZE, MAP_SIZE, emptyN),
    };
  }, []);

  const { edgeTex, cavityTex, poolingTex, flowTex } = useMemo(() => {
    const emptyR = new Uint8Array(MAP_SIZE * MAP_SIZE);
    const emptyRG = new Uint8Array(MAP_SIZE * MAP_SIZE * 2);
    return {
      edgeTex: makeDataTextureR(MAP_SIZE, MAP_SIZE, emptyR),
      cavityTex: makeDataTextureR(MAP_SIZE, MAP_SIZE, emptyR),
      poolingTex: makeDataTextureR(MAP_SIZE, MAP_SIZE, emptyR),
      flowTex: new THREE.DataTexture(emptyRG, MAP_SIZE, MAP_SIZE, THREE.RGFormat),
    };
  }, []);

  const pigmentMaskTex = useMemo(() => {
    const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }, []);

  const { paintCanvas, paintTex } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = MAP_SIZE;
    canvas.height = MAP_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.flipY = false;
    tex.needsUpdate = true;
    return { paintCanvas: canvas, paintTex: tex };
  }, []);

  const pbpCoverageTex = useMemo(() => new THREE.CanvasTexture(document.createElement("canvas")), []);
  const pbpWaterTex = useMemo(() => new THREE.CanvasTexture(document.createElement("canvas")), []);
  const pbpMassTex = useMemo(() => new THREE.CanvasTexture(document.createElement("canvas")), []);
  const pbpEdgePoolTex = useMemo(() => new THREE.CanvasTexture(document.createElement("canvas")), []);
  const pbpStainTex = useMemo(() => new THREE.CanvasTexture(document.createElement("canvas")), []);
  const pbpPigmentIdTex = useMemo(() => new THREE.CanvasTexture(document.createElement("canvas")), []);

  useEffect(() => {
    const init = (tex) => {
      const c = tex.image;
      c.width = MAP_SIZE;
      c.height = MAP_SIZE;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.flipY = false;
      tex.needsUpdate = true;
    };
    [pbpCoverageTex, pbpWaterTex, pbpMassTex, pbpEdgePoolTex, pbpStainTex, pbpPigmentIdTex].forEach(init);
  }, [pbpCoverageTex, pbpWaterTex, pbpMassTex, pbpEdgePoolTex, pbpStainTex, pbpPigmentIdTex]);

  const pbpEngine = useMemo(() => new PbpEngine({ width: MAP_SIZE, height: MAP_SIZE }), []);
  const pbpImageDataRef = useRef(null);
  const pbpWaterDataRef = useRef(null);
  const pbpMassDataRef = useRef(null);
  const pbpEdgePoolDataRef = useRef(null);
  const pbpStainDataRef = useRef(null);
  const pbpPigmentIdDataRef = useRef(null);
  const pbpDirtyRef = useRef(false);
  const pbpLastStepRef = useRef(0);

  const material = useMemo(
    () =>
      createMaterial({
        heightTex,
        normalTex,
        edgeTex,
        cavityTex,
        poolingTex,
        flowTex,
        grainTex,
        pigmentNoiseTex,
        pigmentMaskTex,
        paintMaskTex: paintTex,
        pbpCoverageTex,
        pbpWaterTex,
        pbpMassTex,
        pbpEdgePoolTex,
        pbpStainTex,
        pbpPigmentIdTex,
        woodColorTex,
        woodFiberTex,
        paletteLinear: DEFAULT_PALETTE_LINEAR,
        pigmentProfiles: pigmentProfiles || DEFAULT_PIGMENT_PROPS,
      }),
    [
      cavityTex,
      edgeTex,
      flowTex,
      grainTex,
      heightTex,
      normalTex,
      paintTex,
      pigmentMaskTex,
      pigmentNoiseTex,
      poolingTex,
      pbpCoverageTex,
      pbpWaterTex,
      pbpMassTex,
      pbpEdgePoolTex,
      pbpStainTex,
      pbpPigmentIdTex,
      woodFiberTex,
      woodColorTex,
    ]
  );

  useEffect(() => {
    materialRef.current = material;
  }, [material]);

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  const updateAspect = useCallback((img) => {
    if (!img || !meshRef.current || !frameRef.current) return;
    const w = img.naturalWidth || img.width || 1;
    const h = img.naturalHeight || img.height || 1;
    const aspect = w / h;
    const sx = aspect >= 1 ? aspect : 1;
    const sy = aspect >= 1 ? 1 : 1 / aspect;
    meshRef.current.scale.set(sx, sy, 1);
    frameRef.current.scale.set(sx, sy, 1);
  }, []);

  const applyPalette = useCallback(
    (paletteLinear) => {
      const u = material.uniforms;
      u.uPal0.value.set(...paletteLinear[0]);
      u.uPal1.value.set(...paletteLinear[1]);
      u.uPal2.value.set(...paletteLinear[2]);
      u.uPal3.value.set(...paletteLinear[3]);
      u.uPal4.value.set(...paletteLinear[4]);
      u.uPal5.value.set(...paletteLinear[5]);
      u.uPal6.value.set(...paletteLinear[6]);
      u.uPal7.value.set(...paletteLinear[7]);

      const woodLin = paletteLinear[7];
      const pr = clamp01(linearToSrgb(woodLin[0]));
      const pg = clamp01(linearToSrgb(woodLin[1]));
      const pb = clamp01(linearToSrgb(woodLin[2]));
      u.uWoodTint.value.set(pr, pg, pb);
    },
    [material]
  );

  const shouldUseWebGPU = false;

  const updatePigmentMask = useCallback(
    async (paletteLinear) => {
      if (!materialRef.current || !lastHeightRef.current || !paletteLinear) return;
      const job = ++maskJobRef.current;
      const heightU8 = lastHeightRef.current;
      const fillRate = 0.22 + 0.08 * hash2(MAP_SIZE, MAP_SIZE);

      if (shouldUseWebGPU) {
        try {
          const maskRGBA = await computePigmentMaskWebGPU(heightU8, MAP_SIZE, MAP_SIZE, paletteLinear, {
            lowMin: Number(controls.fillLowMin),
            lowMax: Number(controls.fillLowMax),
            edgeScale: Number(controls.fillEdgeScale),
            fillRate,
          });
          if (!maskRGBA) throw new Error("WebGPU unavailable");
          if (job !== maskJobRef.current) return;
          const tex = makeDataTextureRGBA(MAP_SIZE, MAP_SIZE, maskRGBA);
          const old = material.uniforms.uPigmentMask.value;
          if (old && old.isTexture) old.dispose();
          material.uniforms.uPigmentMask.value = tex;
          return;
        } catch (err) {
          console.warn("WebGPU pigment mask failed, falling back to CPU.", err);
        }
      }

      const mask = pigmentMaskFromHeight(heightU8, MAP_SIZE, MAP_SIZE, paletteLinear, {
        lowMin: Number(controls.fillLowMin),
        lowMax: Number(controls.fillLowMax),
        edgeScale: Number(controls.fillEdgeScale),
      });
      if (job !== maskJobRef.current) return;
      const tex = new THREE.CanvasTexture(mask);
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.flipY = false;
      tex.needsUpdate = true;
      const old = material.uniforms.uPigmentMask.value;
      if (old && old.isTexture) old.dispose();
      material.uniforms.uPigmentMask.value = tex;
    },
    [
      controls.fillEdgeScale,
      controls.fillLowMax,
      controls.fillLowMin,
      material,
      shouldUseWebGPU,
    ]
  );

  const applyAutoFill = useCallback(async () => {
    if (!lastHeightRef.current || !lastPaletteRef.current) return;
    const job = ++autoFillJobRef.current;
    const heightU8 = lastHeightRef.current;
    pbpEngine.setPigmentId(controls.selectedPigmentIndex ?? 1);
    pbpEngine.autoFillSeed({
      heightU8,
      edgeU8: lastEdgeRef.current,
      grainU8: grainData,
      grainSize: 512,
      lowMin: Number(controls.fillLowMin),
      lowMax: Number(controls.fillLowMax),
    });
    if (job !== autoFillJobRef.current) return;
    pbpDirtyRef.current = true;
  }, [
    controls.fillEdgeScale,
    controls.fillLowMax,
    controls.fillLowMin,
    controls.selectedPigmentIndex,
    grainData,
    paintCanvas,
    paintTex,
    pbpEngine,
    shouldUseWebGPU,
  ]);

  const rebuildMaps = useCallback(async () => {
    if (!materialRef.current) return;
    const job = ++rebuildJobRef.current;
    if (lineImg) {
      updateAspect(lineImg);
      const { canvas, uvScale, uvOffset } = imageToCanvas(lineImg, MAP_SIZE);
      material.uniforms.uUVScale.value.copy(uvScale);
      material.uniforms.uUVOffset.value.copy(uvOffset);

      const heightU8 = buildHeightFromLineArt(
        canvas,
        Number(controls.heightThreshold),
        Number(controls.heightBlur),
        Number(controls.heightProfile)
      );
      lastHeightRef.current = heightU8;
      const normalU8 = buildNormalFromHeight(heightU8, MAP_SIZE, MAP_SIZE, 10.0);
      let edgeU8 = null;
      let cavityU8 = null;
      let poolingU8 = null;
      let flowU8 = null;

      if (shouldUseWebGPU) {
        try {
          const maps = await computeReliefMapsWebGPU(heightU8, MAP_SIZE, MAP_SIZE, {
            edgeScale: 6.0,
            cavityLow: 0.25,
            cavityHigh: 0.75,
            edgeWeight: 0.6,
            cavityWeight: 0.4,
            flowScale: 1.0,
          });
          if (job !== rebuildJobRef.current) return;
          if (maps) {
            edgeU8 = maps.edge;
            cavityU8 = maps.cavity;
            poolingU8 = maps.pooling;
            flowU8 = maps.flow;
          }
        } catch (err) {
          console.warn("WebGPU relief maps failed, falling back to CPU.", err);
        }
      }

      if (!edgeU8 || !cavityU8 || !poolingU8 || !flowU8) {
        edgeU8 = buildEdgeFromHeight(heightU8, MAP_SIZE, MAP_SIZE, 6.0);
        cavityU8 = buildCavityFromHeight(heightU8, MAP_SIZE, MAP_SIZE, 0.25, 0.75);
        poolingU8 = buildPoolingFromHeight(heightU8, edgeU8, cavityU8, MAP_SIZE, MAP_SIZE, 0.6, 0.4);
        flowU8 = buildFlowFromHeight(heightU8, MAP_SIZE, MAP_SIZE, 1.0);
      }
      lastEdgeRef.current = edgeU8;

      material.uniforms.uHeight.value.dispose();
      material.uniforms.uNormal.value.dispose();
      material.uniforms.uEdge.value.dispose();
      material.uniforms.uCavity.value.dispose();
      material.uniforms.uPooling.value.dispose();
      material.uniforms.uFlow.value.dispose();

      material.uniforms.uHeight.value = makeDataTextureR(MAP_SIZE, MAP_SIZE, heightU8);
      material.uniforms.uNormal.value = makeDataTextureRGBA(MAP_SIZE, MAP_SIZE, normalU8);
      material.uniforms.uEdge.value = makeDataTextureR(MAP_SIZE, MAP_SIZE, edgeU8);
      material.uniforms.uCavity.value = makeDataTextureR(MAP_SIZE, MAP_SIZE, cavityU8);
      material.uniforms.uPooling.value = makeDataTextureR(MAP_SIZE, MAP_SIZE, poolingU8);
      const flowTexNext = new THREE.DataTexture(flowU8, MAP_SIZE, MAP_SIZE, THREE.RGFormat);
      flowTexNext.wrapS = flowTexNext.wrapT = THREE.ClampToEdgeWrapping;
      flowTexNext.magFilter = THREE.LinearFilter;
      flowTexNext.minFilter = THREE.LinearFilter;
      flowTexNext.needsUpdate = true;
      material.uniforms.uFlow.value = flowTexNext;

      if (lastPaletteRef.current) {
        await updatePigmentMask(lastPaletteRef.current);
      }
    }

    if (colorImg) {
      const { canvas } = imageToCanvas(colorImg, MAP_SIZE);

      const palK = extractPaletteKMeans(canvas, 8, 60, 12);
      const palM = extractPaletteMedianCut(canvas, 8, 60);
      const palH = extractPaletteHistogram(canvas, 8, 80);
      const palU = extractPaletteHueBins(canvas, 8, 70, 12);

      const palKc = palK ? clampPalette(palK) : null;
      const palMc = palM ? clampPalette(palM) : null;
      const palHc = palH ? clampPalette(palH) : null;
      const palUc = palU ? clampPalette(palU) : null;

      const paletteSets = [];
      if (palK) paletteSets.push({ label: "K-means (raw)", colors: palK });
      if (palKc) paletteSets.push({ label: "K-means (clamped)", colors: palKc });
      if (palM) paletteSets.push({ label: "Median cut (raw)", colors: palM });
      if (palMc) paletteSets.push({ label: "Median cut (clamped)", colors: palMc });
      if (palH) paletteSets.push({ label: "Histogram (raw)", colors: palH });
      if (palHc) paletteSets.push({ label: "Histogram (clamped)", colors: palHc });
      if (palU) paletteSets.push({ label: "Hue bins (raw)", colors: palU });
      if (palUc) paletteSets.push({ label: "Hue bins (clamped)", colors: palUc });

      onPaletteSets?.(paletteSets);

      if (palK) {
        const paletteLinear = controls.selectedPalette || palKc || palK;
        lastPaletteRef.current = paletteLinear;
        if (lastHeightRef.current) {
          await updatePigmentMask(paletteLinear);
        }
        applyPalette(paletteLinear);
      }
    }

    if (grainImg) {
      const next = imageToGrayTexture(grainImg, 512);
      const old = material.uniforms.uGrain.value;
      if (old && old.isTexture) old.dispose();
      material.uniforms.uGrain.value = next;

      const colorNext = imageToBleachedTexture(grainImg, 512, 0.75, 0.4);
      const oldColor = material.uniforms.uWoodColor.value;
      if (oldColor && oldColor.isTexture) oldColor.dispose();
      material.uniforms.uWoodColor.value = colorNext;
    }
  }, [
    applyPalette,
    colorImg,
    controls.fillEdgeScale,
    controls.fillLowMax,
    controls.fillLowMin,
    controls.heightBlur,
    controls.heightProfile,
    controls.heightThreshold,
    controls.selectedPalette,
    grainImg,
    lineImg,
    material,
    onPaletteSets,
    updateAspect,
    updatePigmentMask,
    shouldUseWebGPU,
  ]);

  useEffect(() => {
    void rebuildMaps();
  }, [rebuildMaps]);

  useEffect(() => {
    const u = material.uniforms;
    u.uInkAlpha.value = controls.layerCarve ? controls.inkAlpha : 0.0;
    u.uInkEdge.value = controls.inkEdge;
    u.uInkWarmth.value = controls.inkWarmth;
    u.uPigmentAlpha.value = controls.layerPigment ? controls.pigmentAlpha : 0.0;
    u.uPigmentChromaLimit.value = controls.pigmentChromaLimit;
    u.uPigmentNoiseStrength.value = controls.pigmentNoiseStrength;
    u.uPigmentGranularity.value = controls.pigmentGranularity;
    u.uPigmentValueBias.value = controls.pigmentValueBias;
    u.uPigmentEdgePooling.value = controls.pigmentEdgePooling;
    u.uPigmentFlowStrength.value = controls.pigmentFlowStrength;
    u.uGrainScale.value.set(controls.grainScale, controls.grainScale);
    u.uGrainNormalStrength.value = controls.layerGrain ? controls.grainNormal : 0.0;
    u.uPigmentNoiseScale.value.set(controls.pigmentNoiseScale, controls.pigmentNoiseScale);
    u.uRegistration.value.set(controls.registration, -controls.registration * 0.66);
    u.uVignetteStrength.value = controls.layerDebugOverlay ? 0.15 : controls.vignette;
    u.uSpecularStrength.value = controls.specular;
    u.uDebugMode.value = controls.debugMode;
    u.uHeightContrast.value = controls.carveContrast;
    u.uPaintMix.value = controls.layerPaint && controls.paintEnabled ? controls.paintInfluence : 0.0;
    u.uWoodAbsorbency.value = controls.woodAbsorbency;
    u.uWoodFiberStrength.value = controls.woodFiberStrength;
  }, [
    controls.carveContrast,
    controls.debugMode,
    controls.grainNormal,
    controls.grainScale,
    controls.inkAlpha,
    controls.inkEdge,
    controls.inkWarmth,
    controls.pigmentAlpha,
    controls.pigmentChromaLimit,
    controls.pigmentNoiseStrength,
    controls.pigmentGranularity,
    controls.pigmentValueBias,
    controls.pigmentEdgePooling,
    controls.pigmentFlowStrength,
    controls.pigmentNoiseScale,
    controls.registration,
    controls.specular,
    controls.vignette,
    controls.woodAbsorbency,
    controls.woodFiberStrength,
    controls.paintEnabled,
    controls.paintInfluence,
    controls.layerCarve,
    controls.layerGrain,
    controls.layerPaint,
    controls.layerPigment,
    controls.layerDebugOverlay,
    material,
  ]);

  useEffect(() => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;
    if (!u?.uPigmentOpacity || !u?.uPigmentChroma || !u?.uPigmentValueBiasProfile) return;
    const nextOpacity = new Float32Array(8);
    const nextChroma = new Float32Array(8);
    const nextBias = new Float32Array(8);
    for (let i = 0; i < 8; i++) {
      const profile = pigmentProfiles?.[i] || {};
      nextOpacity[i] = typeof profile.opacity === "number" ? profile.opacity : 1.0;
      nextChroma[i] = typeof profile.chroma === "number" ? profile.chroma : 1.0;
      nextBias[i] = typeof profile.valueBias === "number" ? profile.valueBias : 0.0;
    }
    u.uPigmentOpacity.value = nextOpacity;
    u.uPigmentChroma.value = nextChroma;
    u.uPigmentValueBiasProfile.value = nextBias;
  }, [pigmentProfiles]);

  useEffect(() => {
    if (!controls.selectedPalette) return;
    lastPaletteRef.current = controls.selectedPalette;
    applyPalette(controls.selectedPalette);
    if (lastHeightRef.current) {
      void updatePigmentMask(controls.selectedPalette);
    }
  }, [applyPalette, controls.selectedPalette, updatePigmentMask]);

  useEffect(() => {
    if (controls.autoFillNonce < 1) return;
    void applyAutoFill();
  }, [applyAutoFill, controls.autoFillNonce]);

  useEffect(() => {
    if (!gl?.domElement) return;
    gl.domElement.style.cursor = controls.paintEnabled ? "none" : "grab";
    if (!controls.paintEnabled && brushCursorRef?.current) {
      brushCursorRef.current.style.opacity = "0";
    }
  }, [brushCursorRef, controls.paintEnabled, gl]);

  useEffect(() => {
    if (!controls.clearPaint) return;
    const ctx = paintCanvas.getContext("2d");
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
    paintTex.needsUpdate = true;
  }, [controls.clearPaint, paintCanvas, paintTex]);

  const paintAt = useCallback(
    (uv, lastUv = null) => {
      if (!uv) return;
      const direction = lastUv
        ? { x: uv.x - lastUv.x, y: uv.y - lastUv.y }
        : { x: 1, y: 0 };
      pbpEngine.setPigmentId(controls.selectedPigmentIndex ?? 1);
      pbpEngine.stamp({
        uv,
        brushType: controls.brushType,
        pressure: controls.brushOpacity,
        heightU8: lastHeightRef.current,
        lowMin: Number(controls.fillLowMin),
        lowMax: Number(controls.fillLowMax),
        reliefBias: Number(controls.woodReliefBias),
        edgeTex: lastEdgeRef.current,
        grainTex: grainData,
        grainSize: 512,
        direction,
      });
      pbpDirtyRef.current = true;
      const ctx = paintCanvas.getContext("2d");
      const size = Math.max(1, controls.brushSize);
      const x = uv.x * paintCanvas.width;
      const y = (1 - uv.y) * paintCanvas.height;
      const color = controls.brushMode === BRUSH_MODES.ERASE ? "black" : "white";
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = controls.brushOpacity;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      let strokeAlpha = controls.brushOpacity;
      if (controls.brushType === BRUSH_TYPES[2]) {
        strokeAlpha = controls.brushOpacity * 0.35;
        ctx.shadowBlur = size * 0.65;
        ctx.shadowColor = color;
        ctx.filter = `blur(${Math.max(0.5, size * 0.12)}px)`;
      } else {
        ctx.shadowBlur = controls.brushType === BRUSH_TYPES[1] ? size * 0.15 : 0;
        ctx.shadowColor = color;
        ctx.filter = "none";
      }
      ctx.globalAlpha = strokeAlpha;

      if (lastUv && controls.brushType !== BRUSH_TYPES[0]) {
        const lx = lastUv.x * paintCanvas.width;
        const ly = (1 - lastUv.y) * paintCanvas.height;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      if (controls.brushType === BRUSH_TYPES[0]) {
        const stampCount = 2;
        for (let i = 0; i < stampCount; i += 1) {
          const jitter = size * 0.2;
          const jitterX = (Math.random() - 0.5) * jitter;
          const jitterY = (Math.random() - 0.5) * jitter;
          ctx.beginPath();
          ctx.ellipse(
            x + jitterX,
            y + jitterY,
            size * 0.55,
            size * 0.48,
            0,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      } else if (controls.brushType === BRUSH_TYPES[1]) {
        ctx.beginPath();
        ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 3; i += 1) {
          const jitter = size * 0.25;
          const jitterX = (Math.random() - 0.5) * jitter;
          const jitterY = (Math.random() - 0.5) * jitter;
          ctx.globalAlpha = strokeAlpha * 0.6;
          ctx.beginPath();
          ctx.arc(x + jitterX, y + jitterY, size * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 0.5);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, "transparent");
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.fillStyle = color;
      }
      paintTex.needsUpdate = true;
    },
    [
      controls.selectedPigmentIndex,
      controls.brushMode,
      controls.brushOpacity,
      controls.brushSize,
      controls.brushType,
      paintCanvas,
      paintTex,
      pbpEngine,
    ]
  );

  const handlePointerDown = useCallback(
    (event) => {
      if (!controls.paintEnabled) return;
      event.stopPropagation();
      if (brushCursorRef?.current) {
        brushCursorRef.current.style.opacity = "1";
      }
      paintRef.current.isPainting = true;
      const uv = event.uv?.clone();
      paintRef.current.lastUv = uv;
      paintAt(uv);
    },
    [brushCursorRef, controls.paintEnabled, paintAt]
  );

  const handlePointerUp = useCallback(() => {
    paintRef.current.isPainting = false;
    paintRef.current.lastUv = null;
    if (brushCursorRef?.current && controls.paintEnabled) {
      brushCursorRef.current.style.opacity = "1";
    }
  }, [brushCursorRef, controls.paintEnabled]);

  const handlePointerMove = useCallback(
    (event) => {
      if (!controls.paintEnabled || !paintRef.current.isPainting) return;
      event.stopPropagation();
      const uv = event.uv?.clone();
      paintAt(uv, paintRef.current.lastUv);
      paintRef.current.lastUv = uv;
    },
    [controls.paintEnabled, paintAt]
  );

  const updateBrushIndicator = useCallback(
    (event) => {
      if (!controls.paintEnabled) return;
      if (event.point) {
        pointerNdcRef.current.set(
          (event.clientX / gl.domElement.clientWidth) * 2 - 1,
          -(event.clientY / gl.domElement.clientHeight) * 2 + 1
        );
        lastClientRef.current = { x: event.clientX, y: event.clientY };
      }
      if (brushIndicatorRef.current) {
        const base = Math.max(1, controls.brushSize) / MAP_SIZE;
        const sx = meshRef.current?.scale.x ?? 1;
        const sy = meshRef.current?.scale.y ?? 1;
        const radius = base * Math.min(sx, sy);
        brushIndicatorRef.current.scale.set(radius, radius, 1);
      }
      if (!brushCursorRef?.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      const size = Math.max(4, controls.brushSize);
      brushCursorRef.current.style.width = `${size}px`;
      brushCursorRef.current.style.height = `${size}px`;
      brushCursorRef.current.style.opacity = "1";
      brushCursorRef.current.style.transform = `translate(${event.clientX - rect.left - size / 2}px, ${event.clientY - rect.top - size / 2}px)`;
    },
    [brushCursorRef, controls.brushSize, controls.paintEnabled, gl]
  );

  const handlePointerEnter = useCallback(
    (event) => {
      if (!controls.paintEnabled) return;
      updateBrushIndicator(event);
    },
    [controls.paintEnabled, updateBrushIndicator]
  );

  const handlePointerLeave = useCallback(() => {
    if (!brushCursorRef?.current) return;
    brushCursorRef.current.style.opacity = "0";
  }, [brushCursorRef]);

  const handlePointerHover = useCallback(
    (event) => {
      if (!controls.paintEnabled) return;
      updateBrushIndicator(event);
    },
    [controls.paintEnabled, updateBrushIndicator]
  );

  useFrame(({ camera }) => {
    if (!controls.paintEnabled || !brushIndicatorRef.current || !meshRef.current) return;
    const raycaster = raycasterRef.current;
    raycaster.setFromCamera(pointerNdcRef.current, camera);
    const hits = raycaster.intersectObject(meshRef.current, false);
    if (hits.length) {
      const hit = hits[0];
      const normal = hit.face?.normal?.clone()?.applyQuaternion(meshRef.current.quaternion);
      if (!normal) return;
      lastHitRef.current = { point: hit.point.clone(), normal: normal.clone() };
      brushIndicatorRef.current.position.copy(hit.point);
      brushIndicatorRef.current.position.addScaledVector(normal, 0.02);
      brushIndicatorRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    }
  });

  useFrame(({ clock }) => {
    const now = clock.getElapsedTime();
    if (now - pbpLastStepRef.current < 1 / 30) return;
    pbpLastStepRef.current = now;
    const dirty = pbpEngine.step({
      absorbency: controls.woodAbsorbency,
      capillary: controls.woodCapillary,
      poolingBias: controls.woodPoolingBias,
      stainRate: controls.woodStainRate,
      dryingRate: controls.woodDryingRate,
      massRetention: controls.woodMassRetention,
      grainInfluence: controls.woodGrainInfluence,
      edgeTex: lastEdgeRef.current,
      grainTex: grainData,
      grainSize: 512,
    });
    pbpDirtyRef.current = true;
    if (!pbpDirtyRef.current) return;
    const ctx = paintCanvas.getContext("2d");
    if (!pbpImageDataRef.current) {
      pbpImageDataRef.current = ctx.createImageData(MAP_SIZE, MAP_SIZE);
      pbpWaterDataRef.current = ctx.createImageData(MAP_SIZE, MAP_SIZE);
      pbpMassDataRef.current = ctx.createImageData(MAP_SIZE, MAP_SIZE);
      pbpEdgePoolDataRef.current = ctx.createImageData(MAP_SIZE, MAP_SIZE);
      pbpStainDataRef.current = ctx.createImageData(MAP_SIZE, MAP_SIZE);
      pbpPigmentIdDataRef.current = ctx.createImageData(MAP_SIZE, MAP_SIZE);
    }
    const data = pbpImageDataRef.current.data;
    const waterData = pbpWaterDataRef.current.data;
    const massData = pbpMassDataRef.current.data;
    const edgePoolData = pbpEdgePoolDataRef.current.data;
    const stainData = pbpStainDataRef.current.data;
    const pigmentIdData = pbpPigmentIdDataRef.current.data;
    const { coverage, water, mass, edgePool, stain, pigmentId } = pbpEngine.buffers;
    const region = dirty || { x0: 0, y0: 0, x1: MAP_SIZE - 1, y1: MAP_SIZE - 1 };
    for (let y = region.y0; y <= region.y1; y += 1) {
      for (let x = region.x0; x <= region.x1; x += 1) {
        const i = y * MAP_SIZE + x;
        const v = coverage[i];
        const w = water[i];
        const m = mass[i];
        const e = edgePool[i];
        const s = stain[i];
        const p = pigmentId[i];
        const o = i * 4;
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
        data[o + 3] = 255;
        waterData[o] = w;
        waterData[o + 1] = w;
        waterData[o + 2] = w;
        waterData[o + 3] = 255;
        massData[o] = m;
        massData[o + 1] = m;
        massData[o + 2] = m;
        massData[o + 3] = 255;
        edgePoolData[o] = e;
        edgePoolData[o + 1] = e;
        edgePoolData[o + 2] = e;
        edgePoolData[o + 3] = 255;
        stainData[o] = s;
        stainData[o + 1] = s;
        stainData[o + 2] = s;
        stainData[o + 3] = 255;
        pigmentIdData[o] = p;
        pigmentIdData[o + 1] = p;
        pigmentIdData[o + 2] = p;
        pigmentIdData[o + 3] = 255;
      }
    }
    const uploadStart = typeof performance !== "undefined" ? performance.now() : 0;
    const updateTex = (tex, img) => {
      const texCtx = tex.image.getContext("2d");
      texCtx.putImageData(
        img,
        0,
        0,
        region.x0,
        region.y0,
        region.x1 - region.x0 + 1,
        region.y1 - region.y0 + 1
      );
      tex.needsUpdate = true;
    };
    updateTex(paintTex, pbpImageDataRef.current);
    updateTex(pbpCoverageTex, pbpImageDataRef.current);
    updateTex(pbpWaterTex, pbpWaterDataRef.current);
    updateTex(pbpMassTex, pbpMassDataRef.current);
    updateTex(pbpEdgePoolTex, pbpEdgePoolDataRef.current);
    updateTex(pbpStainTex, pbpStainDataRef.current);
    updateTex(pbpPigmentIdTex, pbpPigmentIdDataRef.current);
    if (uploadStart) {
      const dt = performance.now() - uploadStart;
      pbpEngine.stats.uploadMs = pbpEngine.stats.uploadMs
        ? pbpEngine.stats.uploadMs * 0.9 + dt * 0.1
        : dt;
    }
    pbpDirtyRef.current = false;
  });

  useEffect(() => {
    if (!onPbpDebugReady) return;
    const api = {
      getBufferSummary() {
        const { coverage, water, mass, edgePool, stain, pigmentId } = pbpEngine.buffers;
        const summarize = (buf) => {
          let min = 255;
          let max = 0;
          let sum = 0;
          for (let i = 0; i < buf.length; i += 1) {
            const v = buf[i];
            min = Math.min(min, v);
            max = Math.max(max, v);
            sum += v;
          }
          return { min, max, avg: sum / buf.length };
        };
        return {
          pigmentId: summarize(pigmentId),
          coverage: summarize(coverage),
          water: summarize(water),
          mass: summarize(mass),
          edgePool: summarize(edgePool),
          stain: summarize(stain),
        };
      },
      getBuffers() {
        const { coverage, water, mass, edgePool, stain, pigmentId } = pbpEngine.buffers;
        return {
          pigmentId: new Uint8Array(pigmentId),
          coverage: new Uint8Array(coverage),
          water: new Uint8Array(water),
          mass: new Uint8Array(mass),
          edgePool: new Uint8Array(edgePool),
          stain: new Uint8Array(stain),
        };
      },
      stamp({ uv, brushType, pressure }) {
        pbpEngine.stamp({
          uv,
          brushType,
          pressure,
          heightU8: lastHeightRef.current,
          lowMin: Number(controls.fillLowMin),
          lowMax: Number(controls.fillLowMax),
          reliefBias: Number(controls.woodReliefBias),
          edgeTex: lastEdgeRef.current,
          grainTex: grainData,
          grainSize: 512,
        });
        pbpDirtyRef.current = true;
      },
      step(count = 1) {
        for (let i = 0; i < count; i += 1) {
          pbpEngine.step({
            absorbency: controls.woodAbsorbency,
            capillary: controls.woodCapillary,
            poolingBias: controls.woodPoolingBias,
            stainRate: controls.woodStainRate,
            dryingRate: controls.woodDryingRate,
            massRetention: controls.woodMassRetention,
            grainInfluence: controls.woodGrainInfluence,
          });
        }
        pbpDirtyRef.current = true;
      },
      setPigmentId(id) {
        pbpEngine.setPigmentId(id);
      },
      resetLoad() {
        pbpEngine.resetLoad();
      },
      getStats() {
        return { ...pbpEngine.stats };
      },
    };
    onPbpDebugReady(api);
  }, [onPbpDebugReady, pbpEngine]);

  useEffect(() => {
    if (!controls.paintEnabled) return;
    if (brushIndicatorRef.current && lastHitRef.current && meshRef.current) {
      const base = Math.max(1, controls.brushSize) / MAP_SIZE;
      const sx = meshRef.current.scale.x;
      const sy = meshRef.current.scale.y;
      const radius = base * Math.min(sx, sy);
      brushIndicatorRef.current.scale.set(radius, radius, 1);
    }
    if (brushCursorRef?.current) {
      const rect = gl.domElement.getBoundingClientRect();
      const size = Math.max(4, controls.brushSize);
      const { x, y } = lastClientRef.current;
      brushCursorRef.current.style.width = `${size}px`;
      brushCursorRef.current.style.height = `${size}px`;
      brushCursorRef.current.style.transform = `translate(${x - rect.left - size / 2}px, ${y - rect.top - size / 2}px)`;
    }
  }, [brushCursorRef, controls.brushSize, controls.paintEnabled, gl]);

  useFrame(() => {
    if (!gridRef.current || !meshRef.current) return;
    gridRef.current.position.copy(meshRef.current.position);
    gridRef.current.quaternion.copy(meshRef.current.quaternion);
    gridRef.current.scale.set(meshRef.current.scale.x, meshRef.current.scale.y, 1);
  });

  return (
    <group>
      <mesh
        ref={meshRef}
        name="woodblock-plane"
        userData={{ layerId: "woodblock-plane" }}
        material={material}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerMove={(event) => {
          handlePointerHover(event);
          handlePointerMove(event);
        }}
      >
        <planeGeometry args={[1, 1, 1, 1]} />
      </mesh>
      <mesh ref={frameRef} position={[0, 0, -0.001]}>
        <planeGeometry args={[1.04, 1.04, 1, 1]} />
        <meshBasicMaterial color="#1a1a1a" />
      </mesh>
      <group ref={gridRef} visible={controls.layerDebugOverlay}>
        <gridHelper
          args={[1, 20, "#7b6a4f", "#3a3026"]}
          rotation={[Math.PI / 2, 0, 0]}
        />
      </group>
      <group ref={brushIndicatorRef} visible={controls.paintEnabled}>
        <mesh position={[0, 0, 0.001]}>
          <ringGeometry args={[0.48, 0.52, 64]} />
          <meshBasicMaterial
            color="rgb(255, 0, 255)"
            transparent
            opacity={0.9}
            depthTest={false}
          />
        </mesh>
      </group>
    </group>
  );
}

export default function WoodblockScene({
  lineImg,
  colorImg,
  grainImg,
  controls,
  pigmentProfiles,
  onPaletteSets,
  brushCursorRef,
  onPbpDebugReady,
}) {
  return (
    <Canvas
      camera={{ fov: 45, position: [0, 0.22, 1.65], near: 0.01, far: 50 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#0b0a08"]} />
      <SceneContent
        lineImg={lineImg}
        colorImg={colorImg}
        grainImg={grainImg}
        controls={controls}
        pigmentProfiles={pigmentProfiles}
        onPaletteSets={onPaletteSets}
        brushCursorRef={brushCursorRef}
        onPbpDebugReady={onPbpDebugReady}
      />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        enabled={!controls.paintEnabled}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}
