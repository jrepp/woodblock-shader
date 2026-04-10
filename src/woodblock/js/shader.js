import * as THREE from "three";
import { DEFAULT_PIGMENT_SET } from "../pbp/settings.js";

export function createMaterial({
  heightTex,
  normalTex,
  edgeTex,
  cavityTex,
  poolingTex,
  flowTex,
  grainTex,
  pigmentNoiseTex,
  pigmentMaskTex,
  paintMaskTex,
  pbpATex,
  pbpBTex,
  pbpCTex = pbpBTex,
  woodColorTex,
  woodFiberTex,
  paletteLinear,
  pigmentProfiles = [],
  pbpPigmentSet = DEFAULT_PIGMENT_SET,
}) {
  const pigmentOpacity = new Float32Array(8);
  const pigmentChroma = new Float32Array(8);
  const pigmentValueBias = new Float32Array(8);
  for (let i = 0; i < 8; i++) {
    const profile = pigmentProfiles[i] || {};
    pigmentOpacity[i] = typeof profile.opacity === "number" ? profile.opacity : 1.0;
    pigmentChroma[i] = typeof profile.chroma === "number" ? profile.chroma : 1.0;
    pigmentValueBias[i] = typeof profile.valueBias === "number" ? profile.valueBias : 0.0;
  }
  return new THREE.ShaderMaterial({
    extensions: {
      derivatives: true,
    },
    uniforms: {
      uHeight: { value: heightTex },
      uNormal: { value: normalTex },
      uEdge: { value: edgeTex },
      uCavity: { value: cavityTex },
      uPooling: { value: poolingTex },
      uFlow: { value: flowTex },
      uGrain: { value: grainTex },
      uPigmentNoise: { value: pigmentNoiseTex },
      uPigmentMask: { value: pigmentMaskTex },
      uPbpA: { value: pbpATex },
      uPbpB: { value: pbpBTex },
      uPbpC: { value: pbpCTex },
      uWoodColor: { value: woodColorTex },
      uWoodFiberTex: { value: woodFiberTex },
      uPaintMask: { value: paintMaskTex },

      uUVScale: { value: new THREE.Vector2(1.0, 1.0) },
      uUVOffset: { value: new THREE.Vector2(0.0, 0.0) },
      uGrainScale: { value: new THREE.Vector2(1.4, 1.4) },
      uPigmentNoiseScale: { value: new THREE.Vector2(1.6, 1.6) },
      uWoodFiberScale: { value: new THREE.Vector2(2.2, 2.2) },

      uWoodTint:  { value: new THREE.Color(0.93, 0.91, 0.86) },
      uInk:    { value: new THREE.Color(0.06, 0.05, 0.04) },

      uPal0: { value: new THREE.Vector3(...paletteLinear[0]) },
      uPal1: { value: new THREE.Vector3(...paletteLinear[1]) },
      uPal2: { value: new THREE.Vector3(...paletteLinear[2]) },
      uPal3: { value: new THREE.Vector3(...paletteLinear[3]) },
      uPal4: { value: new THREE.Vector3(...paletteLinear[4]) },
      uPal5: { value: new THREE.Vector3(...paletteLinear[5]) },
      uPal6: { value: new THREE.Vector3(...paletteLinear[6]) },
      uPal7: { value: new THREE.Vector3(...paletteLinear[7]) },

      uInkAlpha: { value: 0.95 },
      uInkEdge: { value: 0.60 },
      uPigmentAlpha: { value: 0.55 },
      uPigmentEdgePooling: { value: 0.12 },
      uPigmentNoiseStrength: { value: 0.18 },
      uPigmentChromaLimit: { value: 0.62 },
      uPigmentGranularity: { value: 0.22 },
      uPigmentValueBias: { value: 0.12 },
      uPigmentFlowStrength: { value: 0.6 },
      uRegistration: { value: new THREE.Vector2(0.0012, -0.0008) },
      uVignetteStrength: { value: 0.35 },
      uSpecularStrength: { value: 0.0 },
      uGrainNormalStrength: { value: 0.08 },
      uHeightContrast: { value: 1.15 },
      uPaintMix: { value: 0.0 },
      uWoodAbsorbency: { value: 1.05 },
      uWoodFiberStrength: { value: 0.65 },
      uInkWarmth: { value: 0.25 },
      uPigmentOpacity: { value: pigmentOpacity },
      uPigmentChroma: { value: pigmentChroma },
      uPigmentValueBiasProfile: { value: pigmentValueBias },
      uPbpPigmentSet: { value: new THREE.Vector4(...pbpPigmentSet) },

      uTime: { value: 0.0 },
      uDebugMode: { value: 0.0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPos = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;

      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vN;

      uniform sampler2D uHeight;
      uniform sampler2D uNormal;
      uniform sampler2D uEdge;
      uniform sampler2D uCavity;
      uniform sampler2D uPooling;
      uniform sampler2D uFlow;
      uniform sampler2D uGrain;
      uniform sampler2D uPigmentNoise;
      uniform sampler2D uPigmentMask;
      uniform sampler2D uPbpA;
      uniform sampler2D uPbpB;
      uniform sampler2D uPbpC;
      uniform sampler2D uWoodColor;
      uniform sampler2D uWoodFiberTex;
      uniform sampler2D uPaintMask;

      uniform vec2 uUVScale;
      uniform vec2 uUVOffset;
      uniform vec2 uGrainScale;
      uniform vec2 uPigmentNoiseScale;
      uniform vec2 uWoodFiberScale;

      uniform vec3 uWoodTint;
      uniform vec3 uInk;

      uniform vec3 uPal0; uniform vec3 uPal1; uniform vec3 uPal2; uniform vec3 uPal3;
      uniform vec3 uPal4; uniform vec3 uPal5; uniform vec3 uPal6; uniform vec3 uPal7;

      uniform float uInkAlpha;
      uniform float uInkEdge;
      uniform float uPigmentAlpha;
      uniform float uPigmentEdgePooling;
      uniform float uPigmentNoiseStrength;
      uniform float uPigmentChromaLimit;
      uniform float uPigmentGranularity;
      uniform float uPigmentValueBias;
      uniform float uPigmentFlowStrength;
      uniform vec2  uRegistration;

      uniform float uTime;
      uniform float uDebugMode;
      uniform float uVignetteStrength;
      uniform float uSpecularStrength;
      uniform float uGrainNormalStrength;
      uniform float uHeightContrast;
      uniform float uPaintMix;
      uniform float uWoodAbsorbency;
      uniform float uWoodFiberStrength;
      uniform float uPigmentOpacity[8];
      uniform float uPigmentChroma[8];
      uniform float uPigmentValueBiasProfile[8];
      uniform vec4 uPbpPigmentSet;
      uniform float uInkWarmth;

      vec3 srgbToLin(vec3 c) {
        return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c));
      }

      float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

      vec3 paletteColor(int idx) {
        if (idx==0) return uPal0;
        if (idx==1) return uPal1;
        if (idx==2) return uPal2;
        if (idx==3) return uPal3;
        if (idx==4) return uPal4;
        if (idx==5) return uPal5;
        if (idx==6) return uPal6;
        return uPal7;
      }

      int nearestPalette(vec3 cLin) {
        float bestD = 1e9;
        int bestI = 0;
        for (int i=0;i<8;i++) {
          vec3 p = paletteColor(i);
          vec3 d = cLin - p;
          float dd = dot(d,d);
          if (dd < bestD) { bestD = dd; bestI = i; }
        }
        return bestI;
      }

      vec3 pigmentBlend(vec3 base, vec3 pigment, float a) {
        vec3 mult = base * pigment;
        return mix(base, mult, a);
      }

      float pigmentOpacityFor(int idx) {
        float v = uPigmentOpacity[0];
        if (idx == 1) v = uPigmentOpacity[1];
        if (idx == 2) v = uPigmentOpacity[2];
        if (idx == 3) v = uPigmentOpacity[3];
        if (idx == 4) v = uPigmentOpacity[4];
        if (idx == 5) v = uPigmentOpacity[5];
        if (idx == 6) v = uPigmentOpacity[6];
        if (idx == 7) v = uPigmentOpacity[7];
        return v;
      }

      float pigmentChromaFor(int idx) {
        float v = uPigmentChroma[0];
        if (idx == 1) v = uPigmentChroma[1];
        if (idx == 2) v = uPigmentChroma[2];
        if (idx == 3) v = uPigmentChroma[3];
        if (idx == 4) v = uPigmentChroma[4];
        if (idx == 5) v = uPigmentChroma[5];
        if (idx == 6) v = uPigmentChroma[6];
        if (idx == 7) v = uPigmentChroma[7];
        return v;
      }

      float pigmentValueBiasFor(int idx) {
        float v = uPigmentValueBiasProfile[0];
        if (idx == 1) v = uPigmentValueBiasProfile[1];
        if (idx == 2) v = uPigmentValueBiasProfile[2];
        if (idx == 3) v = uPigmentValueBiasProfile[3];
        if (idx == 4) v = uPigmentValueBiasProfile[4];
        if (idx == 5) v = uPigmentValueBiasProfile[5];
        if (idx == 6) v = uPigmentValueBiasProfile[6];
        if (idx == 7) v = uPigmentValueBiasProfile[7];
        return v;
      }

      void main() {
        vec2 uv = vUv * uUVScale + uUVOffset;
        vec2 uvFlip = vec2(uv.x, 1.0 - uv.y);
        vec2 uvClamped = clamp(uvFlip, 0.001, 0.999);

        float grain = texture2D(uGrain, uvFlip * uGrainScale).r;
        vec3 woodTint = texture2D(uWoodColor, uvFlip * uGrainScale).rgb;
        vec2 flow = texture2D(uFlow, uvClamped).rg * 2.0 - 1.0;
        vec2 flowUV = uvFlip + flow * uPigmentFlowStrength * 0.002;
        float pigmentNoise = texture2D(uPigmentNoise, flowUV * uPigmentNoiseScale).r;
        float woodFiber = texture2D(uWoodFiberTex, uvFlip * uWoodFiberScale).r;

        float h = 1.0 - texture2D(uHeight, uvClamped).r;
        h = clamp(0.5 + (h - 0.5) * uHeightContrast, 0.0, 1.0);
        float edgeTex = texture2D(uEdge, uvClamped).r;
        float cavityTex = texture2D(uCavity, uvClamped).r;
        float poolingTex = texture2D(uPooling, uvClamped).r;
        vec3 nTex = texture2D(uNormal, uvClamped).xyz * 2.0 - 1.0;
        nTex.xy *= -1.0;
        vec3 guideSrgb = texture2D(uPigmentMask, uvClamped).rgb;
        vec2 uvDrift = clamp(uvFlip + uRegistration, 0.001, 0.999);
        vec3 guideDriftSrgb = texture2D(uPigmentMask, uvDrift).rgb;
        float paintMask = texture2D(uPaintMask, uvClamped).r;
        vec4 pbpA = texture2D(uPbpA, uvClamped);
        vec4 pbpB = texture2D(uPbpB, uvClamped);
        vec4 pbpC = texture2D(uPbpC, uvClamped);
        float pbpCoverage = pbpA.r;
        float pbpMass = pbpA.b;
        float pbpStain = pbpB.r;
        float pbpEdgePool = pbpA.a;
        float mixSum = pbpC.x + pbpC.y + pbpC.z + pbpC.w;
        float mixNorm = max(0.001, mixSum);
        vec4 mixW = pbpC / mixNorm;
        int mixId0 = int(clamp(uPbpPigmentSet.x, 0.0, 7.0));
        int mixId1 = int(clamp(uPbpPigmentSet.y, 0.0, 7.0));
        int mixId2 = int(clamp(uPbpPigmentSet.z, 0.0, 7.0));
        int mixId3 = int(clamp(uPbpPigmentSet.w, 0.0, 7.0));
        vec3 mixPigment =
          paletteColor(mixId0) * mixW.x +
          paletteColor(mixId1) * mixW.y +
          paletteColor(mixId2) * mixW.z +
          paletteColor(mixId3) * mixW.w;
        float mixOpacity =
          pigmentOpacityFor(mixId0) * mixW.x +
          pigmentOpacityFor(mixId1) * mixW.y +
          pigmentOpacityFor(mixId2) * mixW.z +
          pigmentOpacityFor(mixId3) * mixW.w;
        float mixChromaLimit =
          pigmentChromaFor(mixId0) * mixW.x +
          pigmentChromaFor(mixId1) * mixW.y +
          pigmentChromaFor(mixId2) * mixW.z +
          pigmentChromaFor(mixId3) * mixW.w;
        float mixValueBias =
          pigmentValueBiasFor(mixId0) * mixW.x +
          pigmentValueBiasFor(mixId1) * mixW.y +
          pigmentValueBiasFor(mixId2) * mixW.z +
          pigmentValueBiasFor(mixId3) * mixW.w;
        vec3 mixPigmentAdj = mix(vec3(luma(mixPigment)), mixPigment, uPigmentChromaLimit * mixChromaLimit);
        mixPigmentAdj = mixPigmentAdj * (1.0 - (uPigmentValueBias + mixValueBias));

        if (uDebugMode > 0.5 && uDebugMode < 1.5) { gl_FragColor = vec4(vec3(h), 1.0); return; }
        if (uDebugMode > 1.5 && uDebugMode < 2.5) { gl_FragColor = vec4(nTex * 0.5 + 0.5, 1.0); return; }
        if (uDebugMode > 2.5 && uDebugMode < 3.5) { gl_FragColor = vec4(guideSrgb, 1.0); return; }
        if (uDebugMode > 3.5 && uDebugMode < 4.5) { gl_FragColor = vec4(vec3(grain), 1.0); return; }
        if (uDebugMode > 4.5 && uDebugMode < 5.5) { gl_FragColor = vec4(vec3(pigmentNoise), 1.0); return; }
        vec3 n = normalize(mix(normalize(vN), nTex, 0.95));
        n = normalize(n + vec3((grain - 0.5) * uGrainNormalStrength, (woodFiber - 0.5) * uGrainNormalStrength, 0.0));

        float inkMin = uInkEdge;
        float inkMax = clamp(uInkEdge + 0.34, 0.6, 0.98);
        float ridge = smoothstep(inkMin, inkMax, h);
        float edge = max(edgeTex, length(vec2(dFdx(h), dFdy(h))));
        float edgeMask = smoothstep(0.015, 0.05, edge);
        float inkMask = ridge * edgeMask;
        inkMask *= (0.92 + (grain - 0.5) * 0.10);

        float cavity = max(cavityTex, 1.0 - smoothstep(0.18, 0.78, h));
        float ridgeWide  = smoothstep(0.22, 0.95, h);

        float low = 1.0 - smoothstep(0.45, 0.7, h);
        float lowInterior = low * (1.0 - edgeMask);
        if (uDebugMode > 6.5 && uDebugMode < 7.5) { gl_FragColor = vec4(vec3(lowInterior), 1.0); return; }
        if (uDebugMode > 7.5 && uDebugMode < 8.5) { gl_FragColor = vec4(vec3(edgeMask), 1.0); return; }
        float pbpWater = pbpA.g;
        float pbpPigmentId = pbpB.g;
        if (uDebugMode > 8.5 && uDebugMode < 9.5) { gl_FragColor = vec4(vec3(pbpCoverage), 1.0); return; }
        if (uDebugMode > 9.5 && uDebugMode < 10.5) { gl_FragColor = vec4(vec3(pbpWater), 1.0); return; }
        if (uDebugMode > 10.5 && uDebugMode < 11.5) { gl_FragColor = vec4(vec3(pbpMass), 1.0); return; }
        if (uDebugMode > 11.5 && uDebugMode < 12.5) { gl_FragColor = vec4(vec3(pbpEdgePool), 1.0); return; }
        if (uDebugMode > 12.5 && uDebugMode < 13.5) { gl_FragColor = vec4(vec3(pbpStain), 1.0); return; }
        if (uDebugMode > 13.5 && uDebugMode < 14.5) { gl_FragColor = vec4(vec3(pbpPigmentId), 1.0); return; }
        if (uDebugMode > 14.5 && uDebugMode < 15.5) { gl_FragColor = vec4(vec3(pbpC.x), 1.0); return; }
        if (uDebugMode > 15.5 && uDebugMode < 16.5) { gl_FragColor = vec4(vec3(pbpC.y), 1.0); return; }
        if (uDebugMode > 16.5 && uDebugMode < 17.5) { gl_FragColor = vec4(vec3(pbpC.z), 1.0); return; }
        if (uDebugMode > 17.5 && uDebugMode < 18.5) { gl_FragColor = vec4(vec3(pbpC.w), 1.0); return; }
        if (uDebugMode > 18.5 && uDebugMode < 19.5) { gl_FragColor = vec4(vec3(mixPigmentAdj), 1.0); return; }
        if (uDebugMode > 19.5 && uDebugMode < 20.5) { gl_FragColor = vec4(vec3(cavityTex), 1.0); return; }
        if (uDebugMode > 20.5 && uDebugMode < 21.5) { gl_FragColor = vec4(vec3(poolingTex), 1.0); return; }
        if (uDebugMode > 21.5 && uDebugMode < 22.5) { gl_FragColor = vec4(vec3(flow * 0.5 + 0.5, 0.5), 1.0); return; }

        float grainAmt = mix(0.07, 0.16, 1.0 - inkMask);
        vec3 col = uWoodTint + (grain - 0.5) * grainAmt;
        col = mix(col, woodTint, 0.22);
        col += (woodFiber - 0.5) * mix(0.05, 0.12, 1.0 - inkMask);

        vec3 guideLin = srgbToLin(guideDriftSrgb);
        float maxc = max(guideDriftSrgb.r, max(guideDriftSrgb.g, guideDriftSrgb.b));
        float minc = min(guideDriftSrgb.r, min(guideDriftSrgb.g, guideDriftSrgb.b));
        float chroma = maxc - minc;
        float guideActive = smoothstep(0.04, 0.14, chroma) * (1.0 - smoothstep(0.75, 0.95, luma(guideDriftSrgb)));

        int pi = nearestPalette(guideLin);
        vec3 guidePigment = paletteColor(pi);
        float guideChromaLimit = uPigmentChromaLimit * pigmentChromaFor(pi);
        float guideValueBias = uPigmentValueBias + pigmentValueBiasFor(pi);
        float pigL = luma(guidePigment);
        guidePigment = mix(vec3(pigL), guidePigment, guideChromaLimit);
        guidePigment = guidePigment * (1.0 - guideValueBias);

        float cov = guideActive;
        float pbpCov = pbpCoverage;
        float pbpMix = smoothstep(0.02, 0.12, pbpCov);
        cov = mix(cov, pbpCov, pbpMix);
        cov *= (0.70 + grain * 0.20 + (pigmentNoise - 0.5) * uPigmentNoiseStrength);
        cov *= (1.0 - inkMask * 0.90);

        float poolEdge = exp(-abs(h - 0.55) * 18.0);
        float pool = max(poolingTex, poolEdge) * uPigmentEdgePooling;
        pool = max(pool, pbpEdgePool * 0.6);

        float pbpIdFloat = pbpPigmentId * 255.0;
        int pbpId = int(floor(pbpIdFloat + 0.5));
        pbpId = clamp(pbpId, 0, 7);
        float pbpHasId = step(0.5, pbpIdFloat);
        float pbpHasMix = step(0.01, mixSum);

        float gran = mix(1.0 - uPigmentGranularity, 1.0 + uPigmentGranularity, pigmentNoise);
        float guideAlpha = uPigmentAlpha * pigmentOpacityFor(pi);
        float pbpAlpha = uPigmentAlpha * mix(mixOpacity, pigmentOpacityFor(pbpId), 1.0 - pbpHasMix);
        float pigmentAlpha = mix(guideAlpha, pbpAlpha, pbpMix * max(pbpHasId, pbpHasMix));
        cov = clamp(cov * gran * pigmentAlpha, 0.0, 1.0);
        cov = mix(cov, cov * paintMask, uPaintMix);
        if (uDebugMode > 5.5 && uDebugMode < 6.5) { gl_FragColor = vec4(vec3(cov), 1.0); return; }

        float absorption = exp(-cov * uWoodAbsorbency);
        float stainBoost = mix(1.0, 1.2, pbpStain);
        vec3 pbpPigment = mix(mixPigmentAdj, paletteColor(pbpId), 1.0 - pbpHasMix);
        vec3 pigment = mix(guidePigment, pbpPigment, pbpMix * max(pbpHasId, pbpHasMix));
        col = mix(pigmentBlend(col, pigment * stainBoost, 1.0 - absorption), col, 0.08);
        col *= (1.0 - pool * 0.08);
        col *= (1.0 - cavity * 0.06);

        vec3 inkColor = mix(uInk, vec3(0.11, 0.07, 0.04), uInkWarmth);
        col = mix(col, inkColor, inkMask * uInkAlpha);

        vec3 L = normalize(vec3(0.4, 0.7, 0.5));
        vec3 V = normalize(cameraPosition - vPos);
        float ndl = max(dot(n, L), 0.0);

        float ambient = 0.56;
        float diffuse = ndl * 0.62;

        vec3 H = normalize(L + V);
        float spec = pow(max(dot(n, H), 0.0), 14.0) * 0.06 * uSpecularStrength;

        col *= (ambient + diffuse);
        col *= (1.0 - cavity * 0.08);
        col *= (1.0 + ridgeWide  * 0.06);
        col += spec;

        vec2 p = vUv - 0.5;
        float vig = 1.0 - dot(p, p) * 0.6 * uVignetteStrength;
        col *= vig;

        col += (woodFiber - 0.5) * 0.08 * uWoodFiberStrength;
        col = clamp(col, 0.0, 1.0);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
