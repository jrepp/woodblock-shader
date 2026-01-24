import { isWebGPUSupported } from "../js/webgpu.js";

export function isPbpWebGPUAvailable() {
  return isWebGPUSupported();
}

export async function createPbpWebGPUDevice() {
  if (!isWebGPUSupported()) return null;
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  return adapter.requestDevice();
}

export function buildPbpWebGPUResources(device, width, height) {
  if (!device) return null;
  return {
    device,
    width,
    height,
    pipelines: {},
    buffers: {},
    bindGroups: {},
  };
}

export async function stepPbpWebGPU() {
  // Placeholder for future WGSL compute implementation.
  return null;
}
