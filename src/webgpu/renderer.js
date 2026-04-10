import { mat4LookAt, mat4Multiply, mat4Perspective, mat4Invert, transformPoint } from "./matrix.js";

const DEFAULT_MAP_SIZE = 1024;
const GRID_RES = 256;

const VERT_SRC = /* wgsl */`
struct Params {
  viewProj : mat4x4<f32>,
  uvScale : vec2<f32>,
  uvOffset : vec2<f32>,
  brushPos : vec2<f32>,
  brushSize : f32,
  brushOpacity : f32,
  debugMode : f32,
  time : f32,
  pigmentSet : vec4<f32>,
  dirtyRect : vec4<f32>,
  heightParams : vec4<f32>,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(7) var texHeight : texture_2d<f32>;

struct VSIn {
  @location(0) pos : vec3<f32>,
  @location(1) uv : vec2<f32>,
};

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vsMain(input : VSIn) -> VSOut {
  var out : VSOut;
  let uv = input.uv * params.uvScale + params.uvOffset;
  let height = textureSampleLevel(texHeight, samp, uv, 0.0).r;
  let disp = (height - 0.5) * params.heightParams.x;
  let pos = vec3<f32>(input.pos.xy, input.pos.z + disp);
  out.pos = params.viewProj * vec4<f32>(pos, 1.0);
  out.uv = input.uv;
  return out;
}
`;

const FRAG_SRC = /* wgsl */`
struct Params {
  viewProj : mat4x4<f32>,
  uvScale : vec2<f32>,
  uvOffset : vec2<f32>,
  brushPos : vec2<f32>,
  brushSize : f32,
  brushOpacity : f32,
  debugMode : f32,
  time : f32,
  pigmentSet : vec4<f32>,
  dirtyRect : vec4<f32>,
  heightParams : vec4<f32>,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var texColor : texture_2d<f32>;
@group(0) @binding(3) var texGrain : texture_2d<f32>;
@group(0) @binding(4) var texPbpA : texture_2d<f32>;
@group(0) @binding(5) var texPbpB : texture_2d<f32>;
@group(0) @binding(6) var texPbpC : texture_2d<f32>;
@group(0) @binding(7) var texHeight : texture_2d<f32>;
@group(0) @binding(8) var texNormal : texture_2d<f32>;
@group(0) @binding(9) var texCavity : texture_2d<f32>;
@group(0) @binding(10) var texPooling : texture_2d<f32>;
@group(0) @binding(11) var texFlow : texture_2d<f32>;
@group(0) @binding(12) var texEdge : texture_2d<f32>;
@group(0) @binding(13) var texPigmentMask : texture_2d<f32>;
@group(0) @binding(14) var<storage, read> palette : array<vec4<f32>>;

fn paletteColor(idx : i32) -> vec3<f32> {
  switch idx {
    case 0: { return palette[0].xyz; }
    case 1: { return palette[1].xyz; }
    case 2: { return palette[2].xyz; }
    case 3: { return palette[3].xyz; }
    case 4: { return palette[4].xyz; }
    case 5: { return palette[5].xyz; }
    case 6: { return palette[6].xyz; }
    default: { return palette[7].xyz; }
  }
}

@fragment
fn fsMain(@location(0) uvIn : vec2<f32>) -> @location(0) vec4<f32> {
  let uv = uvIn * params.uvScale + params.uvOffset;
  let wood = textureSample(texColor, samp, uv).rgb;
  let grain = textureSample(texGrain, samp, uv).r;
  let pbpA = textureSample(texPbpA, samp, uv);
  let pbpB = textureSample(texPbpB, samp, uv);
  let pbpC = textureSample(texPbpC, samp, uv);
  let height = textureSample(texHeight, samp, uv).r;
  let normal = textureSample(texNormal, samp, uv).rgb;
  let cavity = textureSample(texCavity, samp, uv).r;
  let pooling = textureSample(texPooling, samp, uv).r;
  let flow = textureSample(texFlow, samp, uv).rg;
  let edge = textureSample(texEdge, samp, uv).r;
  let pigmentMask = textureSample(texPigmentMask, samp, uv).rgb;
  let coverage = pbpA.r;
  let stain = pbpB.r;
  let pid = clamp(i32(round(pbpB.g * 255.0)), 0, 7);
  let mixSum = pbpC.x + pbpC.y + pbpC.z + pbpC.w;
  let mixNorm = max(0.001, mixSum);
  let mixW = pbpC / mixNorm;
  let mixPigment =
    paletteColor(i32(round(params.pigmentSet.x))) * mixW.x +
    paletteColor(i32(round(params.pigmentSet.y))) * mixW.y +
    paletteColor(i32(round(params.pigmentSet.z))) * mixW.z +
    paletteColor(i32(round(params.pigmentSet.w))) * mixW.w;
  let pigment = select(paletteColor(pid), mixPigment, mixSum > 0.01);
  let mixAmt = clamp(coverage * 0.9 + stain * 0.2, 0.0, 1.0);
  var col = mix(wood, pigment, mixAmt);
  col = col * (0.85 + grain * 0.15);

  let mode = i32(round(params.debugMode));
  if (mode > 0) {
    if (mode == 1) { col = vec3<f32>(height); }
    else if (mode == 2) { col = normal; }
    else if (mode == 3) { col = pigmentMask; }
    else if (mode == 4) { col = vec3<f32>(grain); }
    else if (mode == 5) { col = vec3<f32>(0.0); }
    else if (mode == 6) { col = pigmentMask; }
    else if (mode == 7) { col = vec3<f32>(1.0 - height); }
    else if (mode == 8) { col = vec3<f32>(edge); }
    else if (mode == 9) { col = vec3<f32>(coverage); }
    else if (mode == 10) { col = vec3<f32>(pbpA.g); }
    else if (mode == 11) { col = vec3<f32>(pbpA.b); }
    else if (mode == 12) { col = vec3<f32>(pbpA.a); }
    else if (mode == 13) { col = vec3<f32>(stain); }
    else if (mode == 14) { col = paletteColor(pid); }
    else if (mode == 15) { col = vec3<f32>(pbpC.x); }
    else if (mode == 16) { col = vec3<f32>(pbpC.y); }
    else if (mode == 17) { col = vec3<f32>(pbpC.z); }
    else if (mode == 18) { col = vec3<f32>(pbpC.w); }
    else if (mode == 19) { col = mixPigment; }
    else if (mode == 20) { col = vec3<f32>(cavity); }
    else if (mode == 21) { col = vec3<f32>(pooling); }
    else if (mode == 22) { col = vec3<f32>(flow, 0.0); }
  }

  if (params.brushPos.x >= 0.0) {
    let d = distance(uv, params.brushPos);
    let ring = smoothstep(params.brushSize * 0.52, params.brushSize * 0.50, abs(d - params.brushSize * 0.5));
    col = mix(col, vec3<f32>(1.0, 0.0, 1.0), ring);
  }

  if (params.dirtyRect.x >= 0.0) {
    let inRect = uv.x >= params.dirtyRect.x && uv.x <= params.dirtyRect.z && uv.y >= params.dirtyRect.y && uv.y <= params.dirtyRect.w;
    if (inRect) {
      let edgeX = min(abs(uv.x - params.dirtyRect.x), abs(uv.x - params.dirtyRect.z));
      let edgeY = min(abs(uv.y - params.dirtyRect.y), abs(uv.y - params.dirtyRect.w));
      let edge = min(edgeX, edgeY);
      let thickness = max(0.0005, params.heightParams.y);
      let line = smoothstep(thickness, 0.0, edge);
      col = mix(col, vec3<f32>(1.0, 0.55, 0.15), line);
    }
  }

  return vec4<f32>(col, 1.0);
}
`;

export class WebGPURenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.context = null;
    this.format = "bgra8unorm";
    this.pipeline = null;
    this.bindGroup = null;
    this.uniformBuffer = null;
    this.paletteBuffer = null;
    this.vertexBuffer = null;
    this.indexBuffer = null;
    this.indexCount = 0;
    this.sampler = null;
    this.textures = {};
    this.pigmentSet = [1, 2, 3, 4];
    this.viewProj = new Float32Array(16);
    this.invViewProj = new Float32Array(16);
    this.camera = { yaw: 0, pitch: 0.2, distance: 1.65 };
    this.brushPos = [-1, -1];
    this.uvScale = [1, 1];
    this.uvOffset = [0, 0];
    this.palette = new Array(8).fill(0).map(() => [1, 1, 1]);
    this.dirtyRect = [-1, -1, -1, -1];
    this.mapSize = DEFAULT_MAP_SIZE;
  }

  async init() {
    if (!navigator.gpu) throw new Error("WebGPU not supported.");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("WebGPU adapter not available.");
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext("webgpu");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
    this.sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this._createPipeline();
    this._createGeometry();
    this.resize();
  }

  _createPipeline() {
    const device = this.device;
    const moduleVert = device.createShaderModule({ code: VERT_SRC });
    const moduleFrag = device.createShaderModule({ code: FRAG_SRC });
    const uniformBufferSize = 160;
    this.uniformBuffer = device.createBuffer({
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.paletteBuffer = device.createBuffer({
      size: 8 * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 7, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 10, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 11, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 12, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 13, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 14, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    this.pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: moduleVert,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: 20,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x2" },
            ],
          },
        ],
      },
      fragment: {
        module: moduleFrag,
        entryPoint: "fsMain",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: undefined,
    });
    this.bindGroupLayout = bindGroupLayout;
  }

  _createGeometry() {
    const device = this.device;
    const vertCount = (GRID_RES + 1) * (GRID_RES + 1);
    const verts = new Float32Array(vertCount * 5);
    let v = 0;
    for (let y = 0; y <= GRID_RES; y += 1) {
      const fy = y / GRID_RES;
      const py = fy - 0.5;
      const uvY = 1 - fy;
      for (let x = 0; x <= GRID_RES; x += 1) {
        const fx = x / GRID_RES;
        const px = fx - 0.5;
        verts[v++] = px;
        verts[v++] = py;
        verts[v++] = 0;
        verts[v++] = fx;
        verts[v++] = uvY;
      }
    }
    const indexCount = GRID_RES * GRID_RES * 6;
    const indices = new Uint32Array(indexCount);
    let i = 0;
    for (let y = 0; y < GRID_RES; y += 1) {
      for (let x = 0; x < GRID_RES; x += 1) {
        const row = GRID_RES + 1;
        const v0 = y * row + x;
        const v1 = v0 + 1;
        const v2 = v0 + row;
        const v3 = v2 + 1;
        indices[i++] = v0;
        indices[i++] = v2;
        indices[i++] = v1;
        indices[i++] = v1;
        indices[i++] = v2;
        indices[i++] = v3;
      }
    }
    this.vertexBuffer = device.createBuffer({
      size: verts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.vertexBuffer.getMappedRange()).set(verts);
    this.vertexBuffer.unmap();
    this.indexBuffer = device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this.indexBuffer.getMappedRange()).set(indices);
    this.indexBuffer.unmap();
    this.indexCount = indices.length;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  _ensureTexture(key, width, height) {
    if (this.textures[key]) return this.textures[key];
    const tex = this.device.createTexture({
      size: { width, height },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.textures[key] = tex;
    return tex;
  }

  ensureSolidTexture(key, rgba = [0, 0, 0, 255]) {
    const tex = this._ensureTexture(key, 1, 1);
    const data = new Uint8Array(rgba);
    this._writeTexture(tex, 1, 1, data);
  }

  _writeTexture(tex, width, height, dataU8) {
    const bytesPerRow = width * 4;
    const align = 256;
    const paddedBytesPerRow = Math.ceil(bytesPerRow / align) * align;
    if (paddedBytesPerRow === bytesPerRow) {
      this.device.queue.writeTexture(
        { texture: tex },
        dataU8,
        { bytesPerRow, rowsPerImage: height },
        { width, height }
      );
      return;
    }
    const padded = new Uint8Array(paddedBytesPerRow * height);
    for (let y = 0; y < height; y += 1) {
      const row = dataU8.subarray(y * bytesPerRow, (y + 1) * bytesPerRow);
      padded.set(row, y * paddedBytesPerRow);
    }
    this.device.queue.writeTexture(
      { texture: tex },
      padded,
      { bytesPerRow: paddedBytesPerRow, rowsPerImage: height },
      { width, height }
    );
  }

  uploadDataTexture(key, width, height, dataU8) {
    if (!dataU8) return;
    const tex = this._ensureTexture(key, width, height);
    this._writeTexture(tex, width, height, dataU8);
  }

  uploadGrayTexture(key, width, height, dataU8) {
    if (!dataU8) return;
    const out = new Uint8Array(width * height * 4);
    for (let i = 0; i < dataU8.length; i += 1) {
      const v = dataU8[i];
      const o = i * 4;
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    }
    this.uploadDataTexture(key, width, height, out);
  }

  uploadImageTexture(key, source) {
    if (!source) return;
    const width = source.width || source.naturalWidth || 0;
    const height = source.height || source.naturalHeight || 0;
    if (!width || !height) return;
    const tex = this.device.createTexture({
      size: { width, height },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture: tex },
      { width, height }
    );
    this.textures[key] = tex;
  }

  uploadPbpTextures(pbpA, pbpB, pbpC, width = this.mapSize, height = this.mapSize) {
    const texA = this._ensureTexture("pbpA", width, height);
    const texB = this._ensureTexture("pbpB", width, height);
    const texC = this._ensureTexture("pbpC", width, height);
    this.device.queue.writeTexture(
      { texture: texA },
      pbpA,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { width, height }
    );
    this.device.queue.writeTexture(
      { texture: texB },
      pbpB,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { width, height }
    );
    if (pbpC) {
      this.device.queue.writeTexture(
        { texture: texC },
        pbpC,
        { bytesPerRow: width * 4, rowsPerImage: height },
        { width, height }
      );
    } else {
      const zero = new Uint8Array(width * height * 4);
      this.device.queue.writeTexture(
        { texture: texC },
        zero,
        { bytesPerRow: width * 4, rowsPerImage: height },
        { width, height }
      );
    }
  }

  setPalette(paletteLinear) {
    for (let i = 0; i < 8; i++) {
      const c = paletteLinear?.[i] || [1, 1, 1];
      this.palette[i] = c;
    }
  }

  setUvTransform(uvScale, uvOffset) {
    this.uvScale = uvScale;
    this.uvOffset = uvOffset;
  }

  setBrushPos(uv) {
    if (!uv) {
      this.brushPos = [-1, -1];
      return;
    }
    this.brushPos = [uv.x, uv.y];
  }

  updateUniforms(controls, timeSec) {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const eye = [
      Math.sin(this.camera.yaw) * Math.cos(this.camera.pitch) * this.camera.distance,
      Math.sin(this.camera.pitch) * this.camera.distance,
      Math.cos(this.camera.yaw) * Math.cos(this.camera.pitch) * this.camera.distance,
    ];
    const view = mat4LookAt(eye, [0, 0, 0], [0, 1, 0]);
    const proj = mat4Perspective((45 * Math.PI) / 180, aspect, 0.01, 50);
    mat4Multiply(proj, view, this.viewProj);
    const inv = mat4Invert(this.viewProj, this.invViewProj);
    if (!inv) return;

    const data = new Float32Array(40);
    let o = 0;
    data.set(this.viewProj, o); o += 16;
    data[o++] = this.uvScale[0];
    data[o++] = this.uvScale[1];
    data[o++] = this.uvOffset[0];
    data[o++] = this.uvOffset[1];
    data[o++] = this.brushPos[0];
    data[o++] = this.brushPos[1];
    data[o++] = (controls.brushSize || 24) / this.mapSize;
    data[o++] = controls.brushOpacity ?? 0.8;
    data[o++] = controls.debugMode ?? 0;
    data[o++] = timeSec;
    const pigmentSet = controls.pbpPigmentSet ?? this.pigmentSet ?? [1, 2, 3, 4];
    data[o++] = pigmentSet[0] ?? 1;
    data[o++] = pigmentSet[1] ?? 2;
    data[o++] = pigmentSet[2] ?? 3;
    data[o++] = pigmentSet[3] ?? 4;
    data[o++] = this.dirtyRect[0];
    data[o++] = this.dirtyRect[1];
    data[o++] = this.dirtyRect[2];
    data[o++] = this.dirtyRect[3];
    const heightScale = (controls.heightDisplacement ?? controls.heightProfile ?? 1) * 0.06;
    data[o++] = heightScale;
    data[o++] = 2 / this.mapSize;
    data[o++] = 0;
    data[o++] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data.buffer, data.byteOffset, data.byteLength);
    const pal = new Float32Array(8 * 4);
    for (let i = 0; i < 8; i++) {
      const c = this.palette[i];
      const o = i * 4;
      pal[o] = c[0];
      pal[o + 1] = c[1];
      pal[o + 2] = c[2];
      pal[o + 3] = 1;
    }
    this.device.queue.writeBuffer(this.paletteBuffer, 0, pal.buffer, pal.byteOffset, pal.byteLength);
  }

  buildBindGroup() {
    const device = this.device;
    const colorTex = this.textures.color;
    const grainTex = this.textures.grain;
    const pbpA = this.textures.pbpA;
    const pbpB = this.textures.pbpB;
    const pbpC = this.textures.pbpC;
    const heightTex = this.textures.height;
    const normalTex = this.textures.normal;
    const cavityTex = this.textures.cavity;
    const poolingTex = this.textures.pooling;
    const flowTex = this.textures.flow;
    const edgeTex = this.textures.edge;
    const pigmentMaskTex = this.textures.pigmentMask;
    if (!colorTex || !grainTex || !pbpA || !pbpB || !pbpC || !heightTex || !normalTex || !cavityTex || !poolingTex || !flowTex || !edgeTex || !pigmentMaskTex) {
      return;
    }
    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: colorTex.createView() },
        { binding: 3, resource: grainTex.createView() },
        { binding: 4, resource: pbpA.createView() },
        { binding: 5, resource: pbpB.createView() },
        { binding: 6, resource: pbpC.createView() },
        { binding: 7, resource: heightTex.createView() },
        { binding: 8, resource: normalTex.createView() },
        { binding: 9, resource: cavityTex.createView() },
        { binding: 10, resource: poolingTex.createView() },
        { binding: 11, resource: flowTex.createView() },
        { binding: 12, resource: edgeTex.createView() },
        { binding: 13, resource: pigmentMaskTex.createView() },
        { binding: 14, resource: { buffer: this.paletteBuffer } },
      ],
    });
  }

  render(controls, timeSec) {
    if (!this.pipeline || !this.bindGroup) return;
    this.resize();
    this.updateUniforms(controls, timeSec);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.04, g: 0.03, b: 0.02, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, "uint32");
    pass.drawIndexed(this.indexCount, 1, 0, 0, 0);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  setDirtyRect(rect, size) {
    const targetSize = size ?? this.mapSize;
    if (!rect || targetSize <= 0) {
      this.dirtyRect = [-1, -1, -1, -1];
      return;
    }
    const inv = 1 / targetSize;
    this.dirtyRect = [
      rect.x0 * inv,
      rect.y0 * inv,
      (rect.x1 + 1) * inv,
      (rect.y1 + 1) * inv,
    ];
  }

  setMapSize(size) {
    if (!Number.isFinite(size) || size <= 0) return;
    this.mapSize = size;
  }

  orbit(deltaX, deltaY) {
    this.camera.yaw += deltaX * 0.005;
    this.camera.pitch = Math.max(-1.2, Math.min(1.2, this.camera.pitch + deltaY * 0.005));
  }

  zoom(delta) {
    this.camera.distance = Math.max(0.6, Math.min(4.0, this.camera.distance + delta * 0.002));
  }

  raycastToPlane(ndcX, ndcY) {
    const inv = this.invViewProj;
    if (!inv) return null;
    const near = transformPoint(inv, [ndcX, ndcY, 0, 1]);
    const far = transformPoint(inv, [ndcX, ndcY, 1, 1]);
    if (!near || !far) return null;
    const nW = 1 / near[3];
    const fW = 1 / far[3];
    const nx = near[0] * nW;
    const ny = near[1] * nW;
    const nz = near[2] * nW;
    const fx = far[0] * fW;
    const fy = far[1] * fW;
    const fz = far[2] * fW;
    const dx = fx - nx;
    const dy = fy - ny;
    const dz = fz - nz;
    if (Math.abs(dz) < 1e-5) return null;
    const t = -nz / dz;
    if (t < 0) return null;
    const hitX = nx + dx * t;
    const hitY = ny + dy * t;
    const u = hitX + 0.5;
    const v = 0.5 - hitY;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return { x: u, y: v };
  }
}
