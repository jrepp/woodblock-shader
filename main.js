import * as THREE from "three";
import { OrbitControls } from "./vendor/three/examples/jsm/controls/OrbitControls.js";
import { clamp01, linearToSrgb } from "./js/math.js";
import {
  urlToImage,
  fileToImage,
  imageToCanvas,
  imageToGrayTexture,
  imageToBleachedTexture,
  makeDataTextureR,
  makeDataTextureRGBA,
  makeRepeatDataTextureR,
  buildWoodGrainTex,
  buildWoodGrainTexRGBA,
  buildPigmentNoiseTex,
  buildPaperFiberTex,
  buildHeightFromLineArt,
  buildNormalFromHeight,
} from "./js/textures.js";
import {
  DEFAULT_PALETTE_LINEAR,
  renderPaletteSwatches,
  extractPaletteKMeans,
  extractPaletteMedianCut,
  extractPaletteHistogram,
  extractPaletteHueBins,
  clampPalette,
  pigmentMaskFromHeight,
} from "./js/palette.js";
import { createMaterial } from "./js/shader.js";

// --- Three.js ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0.0, 0.22, 1.65);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.0, 0);

const MAP_SIZE = 1024;

let grainTex = makeRepeatDataTextureR(512, 512, buildWoodGrainTex(512));
let woodColorTex = new THREE.DataTexture(buildWoodGrainTexRGBA(512), 512, 512, THREE.RGBAFormat);
woodColorTex.wrapS = woodColorTex.wrapT = THREE.RepeatWrapping;
woodColorTex.magFilter = THREE.LinearFilter;
woodColorTex.minFilter = THREE.LinearMipmapLinearFilter;
woodColorTex.generateMipmaps = true;
woodColorTex.needsUpdate = true;
const pigmentNoiseTex = makeRepeatDataTextureR(512, 512, buildPigmentNoiseTex(512));
const paperTex = makeRepeatDataTextureR(512, 512, buildPaperFiberTex(512));

const emptyH = new Uint8Array(MAP_SIZE * MAP_SIZE);
const emptyN = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
for (let i=0;i<emptyN.length;i+=4) { emptyN[i+0]=128; emptyN[i+1]=128; emptyN[i+2]=255; emptyN[i+3]=255; }
let heightTex = makeDataTextureR(MAP_SIZE, MAP_SIZE, emptyH);
let normalTex = makeDataTextureRGBA(MAP_SIZE, MAP_SIZE, emptyN);
let pigmentMaskTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
pigmentMaskTex.needsUpdate = true;

// Default palette
let paletteLinear = DEFAULT_PALETTE_LINEAR.map((c) => c.slice());
renderPaletteSwatches("Default palette", paletteLinear);

const material = createMaterial({
  heightTex,
  normalTex,
  grainTex,
  pigmentNoiseTex,
  pigmentMaskTex,
  woodColorTex,
  paperTex,
  paletteLinear,
});

const BASE_PLANE = 1.0;
const FRAME_PAD = 0.04;

const geo = new THREE.PlaneGeometry(BASE_PLANE, BASE_PLANE, 1, 1);
const mesh = new THREE.Mesh(geo, material);
scene.add(mesh);

const frame = new THREE.Mesh(
  new THREE.PlaneGeometry(BASE_PLANE + FRAME_PAD, BASE_PLANE + FRAME_PAD, 1, 1),
  new THREE.MeshBasicMaterial({ color: 0x1a1a1a })
);
frame.position.z = -0.001;
scene.add(frame);

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  material.uniforms.uTime.value = clock.getElapsedTime();
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const lineInput = document.getElementById("lineInput");
const colorInput = document.getElementById("colorInput");
const rebuildBtn = document.getElementById("rebuild");
const debugSelect = document.getElementById("debugSelect");
const hudToggle = document.getElementById("hudToggle");
const lineFileEl = document.getElementById("lineFile");
const colorFileEl = document.getElementById("colorFile");
const inkAlpha = document.getElementById("inkAlpha");
const inkEdge = document.getElementById("inkEdge");
const pigmentAlpha = document.getElementById("pigmentAlpha");
const grainScale = document.getElementById("grainScale");
const grainNormal = document.getElementById("grainNormal");
const pigmentNoiseScale = document.getElementById("pigmentNoiseScale");
const registration = document.getElementById("registration");
const heightThreshold = document.getElementById("heightThreshold");
const heightBlur = document.getElementById("heightBlur");
const heightProfile = document.getElementById("heightProfile");
const fillLowMin = document.getElementById("fillLowMin");
const fillLowMax = document.getElementById("fillLowMax");
const fillEdgeScale = document.getElementById("fillEdgeScale");
const vignette = document.getElementById("vignette");
const specular = document.getElementById("specular");

const inkAlphaVal = document.getElementById("inkAlphaVal");
const inkEdgeVal = document.getElementById("inkEdgeVal");
const pigmentAlphaVal = document.getElementById("pigmentAlphaVal");
const grainScaleVal = document.getElementById("grainScaleVal");
const grainNormalVal = document.getElementById("grainNormalVal");
const pigmentNoiseScaleVal = document.getElementById("pigmentNoiseScaleVal");
const registrationVal = document.getElementById("registrationVal");
const heightThresholdVal = document.getElementById("heightThresholdVal");
const heightBlurVal = document.getElementById("heightBlurVal");
const heightProfileVal = document.getElementById("heightProfileVal");
const fillLowMinVal = document.getElementById("fillLowMinVal");
const fillLowMaxVal = document.getElementById("fillLowMaxVal");
const fillEdgeScaleVal = document.getElementById("fillEdgeScaleVal");
const vignetteVal = document.getElementById("vignetteVal");
const specularVal = document.getElementById("specularVal");
const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
const tabPanels = Array.from(document.querySelectorAll(".tab"));

const DEFAULT_LINE_URL = "./assets/line-art.png";
const DEFAULT_COLOR_URL = "./assets/color-ref.png";
const DEFAULT_GRAIN_URL = "./assets/pearwood-texture.png";

let defaultLineImg = null;
let defaultColorImg = null;
let lineImg = null;
let colorImg = null;
let grainImg = null;
let lastLineCanvas = null;
let lastPaletteRaw = null;
let lastHeightU8 = null;

function updateAspect(img) {
  if (!img) return;
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const aspect = w / h;
  let sx = 1, sy = 1;
  if (aspect >= 1) {
    sx = aspect;
    sy = 1;
  } else {
    sx = 1;
    sy = 1 / aspect;
  }
  mesh.scale.set(sx, sy, 1);
  frame.scale.set(sx, sy, 1);
}

function updateFileLabels() {
  const lineName = lineImg ? lineImg._labelName : (defaultLineImg ? DEFAULT_LINE_URL : "none");
  const colorName = colorImg ? colorImg._labelName : (defaultColorImg ? DEFAULT_COLOR_URL : "none");
  lineFileEl.textContent = `Using: ${lineName}`;
  colorFileEl.textContent = `Using: ${colorName}`;
}

async function rebuildMaps() {
  const activeLine = lineImg || defaultLineImg;
  const activeColor = colorImg || defaultColorImg;

  updateFileLabels();

  if (activeLine) {
    updateAspect(activeLine);
    const { canvas: c, uvScale, uvOffset } = imageToCanvas(activeLine, MAP_SIZE);
    lastLineCanvas = c;
    material.uniforms.uUVScale.value.copy(uvScale);
    material.uniforms.uUVOffset.value.copy(uvOffset);
    const heightU8 = buildHeightFromLineArt(
      c,
      Number(heightThreshold.value),
      Number(heightBlur.value),
      Number(heightProfile.value)
    );
    lastHeightU8 = heightU8;
    const normalU8 = buildNormalFromHeight(heightU8, MAP_SIZE, MAP_SIZE, 10.0);

    material.uniforms.uHeight.value.dispose();
    material.uniforms.uNormal.value.dispose();

    material.uniforms.uHeight.value = makeDataTextureR(MAP_SIZE, MAP_SIZE, heightU8);
    material.uniforms.uNormal.value = makeDataTextureRGBA(MAP_SIZE, MAP_SIZE, normalU8);

    if (lastPaletteRaw) {
      const mask = pigmentMaskFromHeight(lastHeightU8, MAP_SIZE, MAP_SIZE, lastPaletteRaw, {
        lowMin: Number(fillLowMin.value),
        lowMax: Number(fillLowMax.value),
        edgeScale: Number(fillEdgeScale.value),
      });
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
    }
  }

  if (activeColor) {
    const { canvas: c } = imageToCanvas(activeColor, MAP_SIZE);

    const palettesEl = document.getElementById("palettes");
    palettesEl.innerHTML = "";

    const palK = extractPaletteKMeans(c, 8, 60, 12);
    const palM = extractPaletteMedianCut(c, 8, 60);
    const palH = extractPaletteHistogram(c, 8, 80);
    const palU = extractPaletteHueBins(c, 8, 70, 12);

    const palKc = palK ? clampPalette(palK) : null;
    const palMc = palM ? clampPalette(palM) : null;
    const palHc = palH ? clampPalette(palH) : null;
    const palUc = palU ? clampPalette(palU) : null;

    if (palK) renderPaletteSwatches("K-means (raw)", palK);
    if (palKc) renderPaletteSwatches("K-means (clamped)", palKc);
    if (palM) renderPaletteSwatches("Median cut (raw)", palM);
    if (palMc) renderPaletteSwatches("Median cut (clamped)", palMc);
    if (palH) renderPaletteSwatches("Histogram (raw)", palH);
    if (palHc) renderPaletteSwatches("Histogram (clamped)", palHc);
    if (palU) renderPaletteSwatches("Hue bins (raw)", palU);
    if (palUc) renderPaletteSwatches("Hue bins (clamped)", palUc);

    if (palK) {
      lastPaletteRaw = palK;
      if (lastHeightU8) {
        const mask = pigmentMaskFromHeight(lastHeightU8, MAP_SIZE, MAP_SIZE, palK, {
          lowMin: Number(fillLowMin.value),
          lowMax: Number(fillLowMax.value),
          edgeScale: Number(fillEdgeScale.value),
        });
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
      }
      paletteLinear = palKc || palK;
      const u = material.uniforms;

      u.uPal0.value.set(...paletteLinear[0]);
      u.uPal1.value.set(...paletteLinear[1]);
      u.uPal2.value.set(...paletteLinear[2]);
      u.uPal3.value.set(...paletteLinear[3]);
      u.uPal4.value.set(...paletteLinear[4]);
      u.uPal5.value.set(...paletteLinear[5]);
      u.uPal6.value.set(...paletteLinear[6]);
      u.uPal7.value.set(...paletteLinear[7]);

      // paper tone from lightest centroid (last)
      const paperLin = paletteLinear[7];
      const pr = clamp01(linearToSrgb(paperLin[0]));
      const pg = clamp01(linearToSrgb(paperLin[1]));
      const pb = clamp01(linearToSrgb(paperLin[2]));
      u.uPaper.value.set(pr, pg, pb);
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
}

lineInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  lineImg = await fileToImage(f);
  lineImg._labelName = f.name;
  await rebuildMaps();
});

colorInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  colorImg = await fileToImage(f);
  colorImg._labelName = f.name;
  await rebuildMaps();
});

rebuildBtn.addEventListener("click", async () => { await rebuildMaps(); });
debugSelect.addEventListener("change", (e) => {
  const v = Number(e.target.value || 0);
  material.uniforms.uDebugMode.value = v;
});
function bindRange(input, output, onChange, format = (v) => Number(v).toFixed(2)) {
  const update = () => {
    const v = Number(input.value);
    output.textContent = format(v);
    onChange(v);
  };
  input.addEventListener("input", update);
  update();
}

bindRange(inkAlpha, inkAlphaVal, (v) => { material.uniforms.uInkAlpha.value = v; }, (v) => v.toFixed(2));
bindRange(inkEdge, inkEdgeVal, (v) => { material.uniforms.uInkEdge.value = v; }, (v) => v.toFixed(2));
bindRange(pigmentAlpha, pigmentAlphaVal, (v) => { material.uniforms.uPigmentAlpha.value = v; }, (v) => v.toFixed(2));
bindRange(grainScale, grainScaleVal, (v) => { material.uniforms.uGrainScale.value.set(v, v); }, (v) => v.toFixed(2));
bindRange(grainNormal, grainNormalVal, (v) => { material.uniforms.uGrainNormalStrength.value = v; }, (v) => v.toFixed(2));
bindRange(pigmentNoiseScale, pigmentNoiseScaleVal, (v) => { material.uniforms.uPigmentNoiseScale.value.set(v, v); }, (v) => v.toFixed(2));
bindRange(registration, registrationVal, (v) => { material.uniforms.uRegistration.value.set(v, -v * 0.66); }, (v) => v.toFixed(4));
bindRange(heightThreshold, heightThresholdVal, () => { rebuildMaps(); }, (v) => v.toFixed(2));
bindRange(heightBlur, heightBlurVal, () => { rebuildMaps(); }, (v) => v.toFixed(0));
bindRange(heightProfile, heightProfileVal, () => { rebuildMaps(); }, (v) => v.toFixed(2));
bindRange(fillLowMin, fillLowMinVal, () => { rebuildMaps(); }, (v) => v.toFixed(2));
bindRange(fillLowMax, fillLowMaxVal, () => { rebuildMaps(); }, (v) => v.toFixed(2));
bindRange(fillEdgeScale, fillEdgeScaleVal, () => { rebuildMaps(); }, (v) => v.toFixed(1));
bindRange(vignette, vignetteVal, (v) => { material.uniforms.uVignetteStrength.value = v; }, (v) => v.toFixed(2));
bindRange(specular, specularVal, (v) => { material.uniforms.uSpecularStrength.value = v; }, (v) => v.toFixed(2));

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.getAttribute("data-tab");
    tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
    tabPanels.forEach((p) => p.classList.toggle("active", p.id === target));
  });
});

hudToggle.addEventListener("click", () => {
  const minimized = document.body.classList.toggle("minimized");
  hudToggle.textContent = minimized ? "Show UI" : "Hide UI";
});

// Auto-load defaults if present
async function tryAutoLoadDefaults() {
  try {
    defaultLineImg = await urlToImage(DEFAULT_LINE_URL);
    defaultLineImg._labelName = DEFAULT_LINE_URL;
  } catch {}
  try {
    defaultColorImg = await urlToImage(DEFAULT_COLOR_URL);
    defaultColorImg._labelName = DEFAULT_COLOR_URL;
  } catch {}
  try {
    grainImg = await urlToImage(DEFAULT_GRAIN_URL);
    grainImg._labelName = DEFAULT_GRAIN_URL;
  } catch {}
  if (defaultLineImg || defaultColorImg || grainImg) await rebuildMaps();
}
tryAutoLoadDefaults();
