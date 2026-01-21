import * as THREE from "three";
import { clamp01, srgbToLinear } from "./math.js";
import { fbmNoise, fbmNoisePeriodic } from "./noise.js";

export async function urlToImage(url) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return img;
}

export async function fileToImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  return img;
}

export function imageToCanvas(img, size) {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0,0,size,size);

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
    uvScale: new THREE.Vector2(dw / size, dh / size),
    uvOffset: new THREE.Vector2(dx / size, dy / size),
  };
}

export function imageToGrayTexture(img, size = 512) {
  const { canvas } = imageToCanvas(img, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, size, size);
  const out = new Uint8Array(size * size);
  for (let i = 0, p = 0; p < out.length; p++, i += 4) {
    const r = data[i] / 255, g = data[i+1] / 255, b = data[i+2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    out[p] = Math.round(l * 255);
  }
  return makeRepeatDataTextureR(size, size, out);
}

export function imageToBleachedTexture(img, size = 512, desat = 0.75, bleach = 0.4) {
  const { canvas } = imageToCanvas(img, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = r + (l - r) * desat;
    g = g + (l - g) * desat;
    b = b + (l - b) * desat;
    r = r + (1.0 - r) * bleach;
    g = g + (1.0 - g) * bleach;
    b = b + (1.0 - b) * bleach;
    data[i] = Math.round(clamp01(r) * 255);
    data[i + 1] = Math.round(clamp01(g) * 255);
    data[i + 2] = Math.round(clamp01(b) * 255);
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

let singleChannelFormat = THREE.RedFormat;

export function setSingleChannelFormat(format) {
  singleChannelFormat = format;
}

export function makeDataTextureR(w, h, dataU8) {
  const tex = new THREE.DataTexture(dataU8, w, h, singleChannelFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export function makeDataTextureRGBA(w, h, dataU8) {
  const tex = new THREE.DataTexture(dataU8, w, h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export function makeDataTextureRGB(w, h, dataU8) {
  const tex = new THREE.DataTexture(dataU8, w, h, THREE.RGBFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export function makeRepeatDataTextureR(w, h, dataU8) {
  const tex = makeDataTextureR(w, h, dataU8);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function makeRepeatDataTextureRGB(w, h, dataU8) {
  const tex = makeDataTextureRGB(w, h, dataU8);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function boxBlurGray(src, w, h, radius) {
  if (radius <= 0) return src;
  const tmp = new Uint8Array(w * h);
  const dst = new Uint8Array(w * h);
  const r = radius;

  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) {
      const ix = Math.max(0, Math.min(w - 1, x));
      acc += src[y * w + ix];
    }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = Math.round(acc / (2 * r + 1));
      const xOut = x - r;
      const xIn = x + r + 1;
      const outIx = Math.max(0, Math.min(w - 1, xOut));
      const inIx  = Math.max(0, Math.min(w - 1, xIn));
      acc += src[y * w + inIx] - src[y * w + outIx];
    }
  }

  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) {
      const iy = Math.max(0, Math.min(h - 1, y));
      acc += tmp[iy * w + x];
    }
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = Math.round(acc / (2 * r + 1));
      const yOut = y - r;
      const yIn = y + r + 1;
      const outIy = Math.max(0, Math.min(h - 1, yOut));
      const inIy  = Math.max(0, Math.min(h - 1, yIn));
      acc += tmp[inIy * w + x] - tmp[outIy * w + x];
    }
  }
  return dst;
}

export function buildHeightFromLineArt(canvas, threshold = 0.55, blurRadius = 2, profile = 1.35) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h).data;

  const ink = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < w*h; p++, i += 4) {
    const r = img[i] / 255, g = img[i+1]/255, b = img[i+2]/255;
    const l = 0.2126*r + 0.7152*g + 0.0722*b;
    ink[p] = (l < threshold) ? 0 : 255;
  }

  const soft = boxBlurGray(ink, w, h, blurRadius);

  const height = new Uint8Array(w * h);
  for (let p = 0; p < w*h; p++) {
    const s = soft[p] / 255;
    const hgt = 1.0 - Math.pow(s, profile);
    const n = ((p * 1103515245 + 12345) >>> 0) / 4294967295;
    const chatter = (n - 0.5) * 0.06;
    const val = clamp01(hgt + chatter * hgt);
    height[p] = Math.round(val * 255);
  }
  return height;
}

export function buildNormalFromHeight(heightU8, w, h, strength = 10.0) {
  const out = new Uint8Array(w * h * 4);
  const getH = (x, y) => {
    x = Math.max(0, Math.min(w - 1, x));
    y = Math.max(0, Math.min(h - 1, y));
    return heightU8[y*w + x] / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hL = getH(x - 1, y);
      const hR = getH(x + 1, y);
      const hD = getH(x, y - 1);
      const hU = getH(x, y + 1);
      const dx = (hR - hL) * strength;
      const dy = (hU - hD) * strength;

      let nx = -dx, ny = -dy, nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1.0;
      nx /= len; ny /= len; nz /= len;

      const i = (y*w + x) * 4;
      out[i+0] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i+1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i+2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[i+3] = 255;
    }
  }
  return out;
}

export function buildWoodGrainTex(size = 512) {
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const warp = (fbmNoise(u * 2.0, v * 2.0) - 0.5) * 0.18;
      const bands = Math.sin((u * 28.0 + warp + v * 2.0) * Math.PI);
      const pores = fbmNoise(u * 10.0, v * 10.0);
      const g = 0.55 + 0.28 * bands + 0.17 * (pores - 0.5);
      data[y * size + x] = Math.round(clamp01(g) * 255);
    }
  }
  return data;
}

export function buildWoodGrainTexRGB(size = 512) {
  const gray = buildWoodGrainTex(size);
  const data = new Uint8Array(size * size * 3);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    const o = i * 3;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
  }
  return data;
}

export function buildPigmentNoiseTex(size = 512) {
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const blotch = fbmNoisePeriodic(u, v, 6.0);
      const speck  = fbmNoisePeriodic(u, v, 24.0);
      const n = 0.70 * blotch + 0.30 * speck;
      data[y * size + x] = Math.round(clamp01(n) * 255);
    }
  }
  return data;
}

export function buildPaperFiberTex(size = 512) {
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const base = fbmNoisePeriodic(u, v, 10.0);
      const fibers = Math.sin((u * 34.0 + fbmNoisePeriodic(u, v, 6.0) * 2.0) * Math.PI);
      const clumps = fbmNoisePeriodic(u, v, 3.0);
      const n = 0.55 * base + 0.25 * (fibers * 0.5 + 0.5) + 0.20 * clumps;
      data[y * size + x] = Math.round(clamp01(n) * 255);
    }
  }
  return data;
}
