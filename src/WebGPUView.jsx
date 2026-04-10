import { useCallback, useEffect, useMemo, useRef } from "react";
import { DEFAULT_PALETTE_LINEAR } from "./woodblock/js/palette.js";
import {
  extractPaletteKMeans,
  extractPaletteMedianCut,
  extractPaletteHistogram,
  extractPaletteHueBins,
  clampPalette,
} from "./woodblock/js/palette.js";
import {
  buildHeightFromLineArt,
  buildNormalFromHeight,
  buildEdgeFromHeight,
  buildCavityFromHeight,
  buildPoolingFromHeight,
  buildFlowFromHeight,
} from "./woodblock/js/textures.js";
import { pigmentMaskFromHeight } from "./woodblock/js/palette.js";
import { PbpEngine } from "./woodblock/pbp/engine.js";
import { writePbpTextures } from "./woodblock/pbp/pack.js";
import { DEFAULT_PIGMENT_SET } from "./woodblock/pbp/settings.js";
import { summarizeBuffers } from "./woodblock/pbp/debugView.js";
import { WebGPURenderer } from "./webgpu/renderer.js";

const DEFAULT_MAP_SIZE = 1024;
const MIN_MAP_SIZE = 256;
const MAX_MAP_SIZE = 4096;

function imageToCanvas(img, size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, size, size);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.min(size / iw, size / ih);
  const dw = Math.floor(iw * s);
  const dh = Math.floor(ih * s);
  const dx = Math.floor((size - dw) / 2);
  const dy = Math.floor((size - dh) / 2);
  ctx.drawImage(img, dx, dy, dw, dh);
  return {
    canvas: c,
    uvScale: [dw / size, dh / size],
    uvOffset: [dx / size, dy / size],
  };
}

export default function WebGPUView({
  lineImg,
  colorImg,
  grainImg,
  controls,
  pigmentProfiles,
  onPaletteSets,
  brushCursorRef,
  onPbpDebugReady,
}) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const readyRef = useRef(false);
  const mapSize = useMemo(() => {
    const size = Number(controls.pbpTextureSize) || DEFAULT_MAP_SIZE;
    return Math.min(MAX_MAP_SIZE, Math.max(MIN_MAP_SIZE, size));
  }, [controls.pbpTextureSize]);
  const pbpEngine = useMemo(() => new PbpEngine({ width: mapSize, height: mapSize }), [mapSize]);
  const pbpA = useMemo(() => new Uint8Array(mapSize * mapSize * 4), [mapSize]);
  const pbpB = useMemo(() => new Uint8Array(mapSize * mapSize * 4), [mapSize]);
  const pbpC = useMemo(() => new Uint8Array(mapSize * mapSize * 4), [mapSize]);
  const lastHeightRef = useRef(null);
  const lastEdgeRef = useRef(null);
  const grainDataRef = useRef(null);
  const lastPaletteRef = useRef(DEFAULT_PALETTE_LINEAR.map((c) => c.slice()));
  const paintRef = useRef({ isPainting: false, lastUv: null });
  const orbitRef = useRef({ isDown: false, lastX: 0, lastY: 0 });
  const needBindRef = useRef(false);

  const updatePbpTextures = useCallback(() => {
    writePbpTextures(pbpEngine.buffers, pbpA, pbpB, pbpC, mapSize, mapSize);
    rendererRef.current?.uploadPbpTextures(pbpA, pbpB, pbpC, mapSize, mapSize);
  }, [mapSize, pbpA, pbpB, pbpC, pbpEngine]);

  useEffect(() => {
    pbpEngine.setPigmentSet(DEFAULT_PIGMENT_SET);
  }, [pbpEngine]);

  const applyPalette = useCallback(
    (paletteLinear) => {
      lastPaletteRef.current = paletteLinear;
      rendererRef.current?.setPalette(paletteLinear);
      if (lastHeightRef.current && rendererRef.current?.device) {
        const maskCanvas = pigmentMaskFromHeight(
          lastHeightRef.current,
          mapSize,
          mapSize,
          paletteLinear,
          {
            lowMin: Number(controls.fillLowMin),
            lowMax: Number(controls.fillLowMax),
            edgeScale: Number(controls.fillEdgeScale),
          }
        );
        rendererRef.current.uploadImageTexture("pigmentMask", maskCanvas);
        needBindRef.current = true;
      }
    },
    [controls.fillEdgeScale, controls.fillLowMax, controls.fillLowMin, mapSize]
  );

  const rebuildMaps = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || !renderer.device || !readyRef.current) return;
    if (lineImg) {
      const { canvas, uvScale, uvOffset } = imageToCanvas(lineImg, mapSize);
      renderer.setUvTransform(uvScale, uvOffset);
      const heightU8 = buildHeightFromLineArt(
        canvas,
        Number(controls.heightThreshold),
        Number(controls.heightBlur),
        Number(controls.heightProfile)
      );
      lastHeightRef.current = heightU8;
      let edgeU8 = null;
      let cavityU8 = null;
      let poolingU8 = null;
      let flowU8 = null;
      if (!edgeU8 || !cavityU8 || !poolingU8 || !flowU8) {
        edgeU8 = buildEdgeFromHeight(heightU8, mapSize, mapSize, 6.0);
        cavityU8 = buildCavityFromHeight(heightU8, mapSize, mapSize, 0.25, 0.75);
        poolingU8 = buildPoolingFromHeight(heightU8, edgeU8, cavityU8, mapSize, mapSize, 0.6, 0.4);
        flowU8 = buildFlowFromHeight(heightU8, mapSize, mapSize, 1.0);
      }
      lastEdgeRef.current = edgeU8;
      const normalU8 = buildNormalFromHeight(heightU8, mapSize, mapSize, 10.0);
      renderer.uploadGrayTexture("height", mapSize, mapSize, heightU8);
      renderer.uploadDataTexture("normal", mapSize, mapSize, normalU8);
      renderer.uploadGrayTexture("edge", mapSize, mapSize, edgeU8);
      renderer.uploadGrayTexture("cavity", mapSize, mapSize, cavityU8);
      renderer.uploadGrayTexture("pooling", mapSize, mapSize, poolingU8);
      if (flowU8) {
        const flowRGBA = new Uint8Array(mapSize * mapSize * 4);
        for (let i = 0; i < mapSize * mapSize; i += 1) {
          const o = i * 4;
          const f = i * 2;
          flowRGBA[o] = flowU8[f];
          flowRGBA[o + 1] = flowU8[f + 1];
          flowRGBA[o + 2] = 0;
          flowRGBA[o + 3] = 255;
        }
        renderer.uploadDataTexture("flow", mapSize, mapSize, flowRGBA);
      }
      if (lastPaletteRef.current) {
        const maskCanvas = pigmentMaskFromHeight(
          heightU8,
          mapSize,
          mapSize,
          lastPaletteRef.current,
          {
            lowMin: Number(controls.fillLowMin),
            lowMax: Number(controls.fillLowMax),
            edgeScale: Number(controls.fillEdgeScale),
          }
        );
        renderer.uploadImageTexture("pigmentMask", maskCanvas);
      }
      needBindRef.current = true;
      updatePbpTextures();
    }

    if (colorImg) {
      const { canvas } = imageToCanvas(colorImg, mapSize);
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
        applyPalette(paletteLinear);
      }
    }

    if (grainImg) {
      const { canvas } = imageToCanvas(grainImg, 512);
      renderer.uploadImageTexture("grain", canvas);
    }

    if (colorImg) {
      const { canvas } = imageToCanvas(colorImg, 512);
      renderer.uploadImageTexture("color", canvas);
    }
    needBindRef.current = true;
  }, [
    applyPalette,
    colorImg,
    controls.heightBlur,
    controls.heightProfile,
    controls.heightThreshold,
    controls.selectedPalette,
    grainImg,
    lineImg,
    mapSize,
    onPaletteSets,
    pbpEngine,
    updatePbpTextures,
  ]);

  const paintAt = useCallback(
    (uv, lastUv = null) => {
      if (!uv) return;
      pbpEngine.setPigmentId(controls.selectedPigmentIndex ?? 1);
      if (!lastUv) {
        pbpEngine.beginStroke({
          uv,
          brushType: controls.brushType,
          pressure: controls.brushOpacity,
          heightU8: lastHeightRef.current,
          lowMin: Number(controls.fillLowMin),
          lowMax: Number(controls.fillLowMax),
          reliefBias: Number(controls.woodReliefBias),
          edgeTex: lastEdgeRef.current,
          grainTex: grainDataRef.current,
          grainSize: 512,
        });
      } else {
        pbpEngine.continueStroke({
          uv,
          brushType: controls.brushType,
          pressure: controls.brushOpacity,
          heightU8: lastHeightRef.current,
          lowMin: Number(controls.fillLowMin),
          lowMax: Number(controls.fillLowMax),
          reliefBias: Number(controls.woodReliefBias),
          edgeTex: lastEdgeRef.current,
          grainTex: grainDataRef.current,
          grainSize: 512,
        });
      }
      updatePbpTextures();
    },
    [
      controls.brushOpacity,
      controls.brushType,
      controls.fillLowMax,
      controls.fillLowMin,
      controls.selectedPigmentIndex,
      controls.woodReliefBias,
      pbpEngine,
      updatePbpTextures,
    ]
  );

  useEffect(() => {
    let raf = 0;
    let stopped = false;
    const init = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const renderer = new WebGPURenderer(canvas);
      rendererRef.current = renderer;
      await renderer.init();
      renderer.setMapSize(mapSize);
      readyRef.current = true;
      renderer.ensureSolidTexture("color", [120, 110, 95, 255]);
      renderer.ensureSolidTexture("grain", [128, 128, 128, 255]);
      renderer.ensureSolidTexture("pbpA", [0, 0, 0, 255]);
      renderer.ensureSolidTexture("pbpB", [0, 0, 0, 255]);
      renderer.ensureSolidTexture("pbpC", [0, 0, 0, 255]);
      renderer.ensureSolidTexture("height", [128, 128, 128, 255]);
      renderer.ensureSolidTexture("normal", [128, 128, 255, 255]);
      renderer.ensureSolidTexture("cavity", [0, 0, 0, 255]);
      renderer.ensureSolidTexture("pooling", [0, 0, 0, 255]);
      renderer.ensureSolidTexture("flow", [128, 128, 0, 255]);
      renderer.ensureSolidTexture("edge", [0, 0, 0, 255]);
      renderer.ensureSolidTexture("pigmentMask", [245, 240, 230, 255]);
      renderer.setPalette(DEFAULT_PALETTE_LINEAR);
      renderer.uploadPbpTextures(pbpA, pbpB, pbpC, mapSize, mapSize);
      await rebuildMaps();
      renderer.buildBindGroup();
      const loop = (t) => {
        if (stopped) return;
        const timeSec = t * 0.001;
        const dirty = pbpEngine.step({
          absorbency: controls.woodAbsorbency,
          capillary: controls.woodCapillary,
          poolingBias: controls.woodPoolingBias,
          stainRate: controls.woodStainRate,
          dryingRate: controls.woodDryingRate,
          massRetention: controls.woodMassRetention,
          grainInfluence: controls.woodGrainInfluence,
          heightU8: lastHeightRef.current,
          edgeTex: lastEdgeRef.current,
          grainTex: grainDataRef.current,
          grainSize: 512,
        });
        renderer.setDirtyRect(dirty, mapSize);
        if (dirty) updatePbpTextures();
        if (needBindRef.current) {
          renderer.buildBindGroup();
          needBindRef.current = false;
        }
        renderer.render(controls, timeSec);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };
    init();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [
    controls,
    mapSize,
    pbpA,
    pbpB,
    pbpC,
    pbpEngine,
    rebuildMaps,
    updatePbpTextures,
  ]);

  useEffect(() => {
    rebuildMaps();
  }, [rebuildMaps]);

  useEffect(() => {
    if (grainImg) {
      const { canvas } = imageToCanvas(grainImg, 512);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const img = ctx.getImageData(0, 0, 512, 512).data;
      const out = new Uint8Array(512 * 512);
      for (let i = 0, p = 0; p < out.length; p++, i += 4) {
        out[p] = Math.round((img[i] * 0.2126 + img[i + 1] * 0.7152 + img[i + 2] * 0.0722));
      }
      grainDataRef.current = out;
    }
  }, [grainImg]);

  useEffect(() => {
    if (!controls.selectedPalette) return;
    applyPalette(controls.selectedPalette);
  }, [applyPalette, controls.selectedPalette]);

  useEffect(() => {
    if (controls.autoFillNonce < 1) return;
    if (!lastHeightRef.current) return;
    pbpEngine.setPigmentId(controls.selectedPigmentIndex ?? 1);
    pbpEngine.autoFillSeed({
      heightU8: lastHeightRef.current,
      edgeU8: lastEdgeRef.current,
      grainU8: grainDataRef.current,
      grainSize: 512,
      lowMin: Number(controls.fillLowMin),
      lowMax: Number(controls.fillLowMax),
    });
    updatePbpTextures();
  }, [
    controls.autoFillNonce,
    controls.fillLowMax,
    controls.fillLowMin,
    controls.selectedPigmentIndex,
    pbpEngine,
    updatePbpTextures,
  ]);

  useEffect(() => {
    if (!onPbpDebugReady) return;
    const api = {
      getBufferSummary() {
        const { coverage, water, mass, edgePool, stain, pigmentId, pigmentMix } = pbpEngine.buffers;
        return summarizeBuffers({
          pigmentId,
          pigmentMix,
          coverage,
          water,
          mass,
          edgePool,
          stain,
        });
      },
      getBuffers() {
        const { coverage, water, mass, edgePool, stain, pigmentId, pigmentMix } = pbpEngine.buffers;
        return {
          pigmentId: new Uint8Array(pigmentId),
          pigmentMix: new Uint8Array(pigmentMix),
          coverage: new Uint8Array(coverage),
          water: new Uint8Array(water),
          mass: new Uint8Array(mass),
          edgePool: new Uint8Array(edgePool),
          stain: new Uint8Array(stain),
        };
      },
      setPigmentId(id) {
        pbpEngine.setPigmentId(id);
      },
      setPigmentSet(ids) {
        pbpEngine.setPigmentSet(ids);
      },
      resetLoad() {
        pbpEngine.resetLoad();
      },
    };
    onPbpDebugReady(api);
  }, [onPbpDebugReady, pbpEngine]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.pigmentSet = controls.pbpPigmentSet ?? DEFAULT_PIGMENT_SET;
    }
  }, [controls.pbpPigmentSet]);

  useEffect(() => {
    pbpEngine.setPigmentSet(controls.pbpPigmentSet ?? DEFAULT_PIGMENT_SET);
  }, [controls.pbpPigmentSet, pbpEngine]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!renderer) return;

    const toNdc = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      return { x, y };
    };

    const isOverCanvas = (event) =>
      event.target === canvas || (event.target && canvas.contains(event.target));

    const onDown = (event) => {
      if (!isOverCanvas(event)) return;
      if (controls.paintEnabled) {
        paintRef.current.isPainting = true;
        const ndc = toNdc(event);
        const uv = renderer.raycastToPlane(ndc.x, ndc.y);
        paintRef.current.lastUv = uv;
        renderer.setBrushPos(uv);
        paintAt(uv);
      } else {
        orbitRef.current.isDown = true;
        orbitRef.current.lastX = event.clientX;
        orbitRef.current.lastY = event.clientY;
      }
    };
    const onUp = () => {
      paintRef.current.isPainting = false;
      paintRef.current.lastUv = null;
      if (controls.paintEnabled) {
        pbpEngine.endStroke();
      }
      orbitRef.current.isDown = false;
    };
    const onMove = (event) => {
      if (!isOverCanvas(event) && !paintRef.current.isPainting && !orbitRef.current.isDown) {
        return;
      }
      const ndc = toNdc(event);
      const uv = renderer.raycastToPlane(ndc.x, ndc.y);
      renderer.setBrushPos(controls.paintEnabled ? uv : null);
      if (controls.paintEnabled && paintRef.current.isPainting) {
        paintAt(uv, paintRef.current.lastUv);
        paintRef.current.lastUv = uv;
      } else if (orbitRef.current.isDown) {
        const dx = event.clientX - orbitRef.current.lastX;
        const dy = event.clientY - orbitRef.current.lastY;
        orbitRef.current.lastX = event.clientX;
        orbitRef.current.lastY = event.clientY;
        renderer.orbit(dx, dy);
      }
    };
    const onWheel = (event) => {
      if (!isOverCanvas(event)) return;
      if (controls.paintEnabled) return;
      renderer.zoom(event.deltaY);
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMove);
    canvas.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [controls.paintEnabled, paintAt, pbpEngine]);

  return (
    <div className="webgpu-canvas">
      <canvas ref={canvasRef} />
      <div ref={brushCursorRef} className="brush-cursor" />
    </div>
  );
}
