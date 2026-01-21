import * as THREE from "three";

export function createMaterial({ heightTex, normalTex, grainTex, pigmentNoiseTex, pigmentMaskTex, woodColorTex, paperTex, paletteLinear }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHeight: { value: heightTex },
      uNormal: { value: normalTex },
      uGrain: { value: grainTex },
      uPigmentNoise: { value: pigmentNoiseTex },
      uPigmentMask: { value: pigmentMaskTex },
      uWoodColor: { value: woodColorTex },
      uPaperTex: { value: paperTex },

      uUVScale: { value: new THREE.Vector2(1.0, 1.0) },
      uUVOffset: { value: new THREE.Vector2(0.0, 0.0) },
      uGrainScale: { value: new THREE.Vector2(1.4, 1.4) },
      uPigmentNoiseScale: { value: new THREE.Vector2(1.6, 1.6) },
      uPaperScale: { value: new THREE.Vector2(2.2, 2.2) },

      uPaper:  { value: new THREE.Color(0.93, 0.91, 0.86) },
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
      uPigmentEdgePool: { value: 0.10 },
      uRegistration: { value: new THREE.Vector2(0.0012, -0.0008) },
      uVignetteStrength: { value: 0.35 },
      uSpecularStrength: { value: 0.0 },
      uGrainNormalStrength: { value: 0.08 },

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
      uniform sampler2D uGrain;
      uniform sampler2D uPigmentNoise;
      uniform sampler2D uPigmentMask;
      uniform sampler2D uWoodColor;
      uniform sampler2D uPaperTex;

      uniform vec2 uUVScale;
      uniform vec2 uUVOffset;
      uniform vec2 uGrainScale;
      uniform vec2 uPigmentNoiseScale;
      uniform vec2 uPaperScale;

      uniform vec3 uPaper;
      uniform vec3 uInk;

      uniform vec3 uPal0; uniform vec3 uPal1; uniform vec3 uPal2; uniform vec3 uPal3;
      uniform vec3 uPal4; uniform vec3 uPal5; uniform vec3 uPal6; uniform vec3 uPal7;

      uniform float uInkAlpha;
      uniform float uInkEdge;
      uniform float uPigmentAlpha;
      uniform float uPigmentEdgePool;
      uniform vec2  uRegistration;

      uniform float uTime;
      uniform float uDebugMode;
      uniform float uVignetteStrength;
      uniform float uSpecularStrength;
      uniform float uGrainNormalStrength;

      float saturate(float x) { return clamp(x, 0.0, 1.0); }

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

      void main() {
        vec2 uv = vUv * uUVScale + uUVOffset;
        vec2 uvFlip = vec2(uv.x, 1.0 - uv.y);
        vec2 uvClamped = clamp(uvFlip, 0.001, 0.999);

        float grain = texture2D(uGrain, uvFlip * uGrainScale).r;
        vec3 woodTint = texture2D(uWoodColor, uvFlip * uGrainScale).rgb;
        float pigmentNoise = texture2D(uPigmentNoise, uvFlip * uPigmentNoiseScale).r;
        float paperFiber = texture2D(uPaperTex, uvFlip * uPaperScale).r;

        float h = 1.0 - texture2D(uHeight, uvClamped).r;
        vec3 nTex = texture2D(uNormal, uvClamped).xyz * 2.0 - 1.0;
        nTex.xy *= -1.0;
        vec3 guideSrgb = texture2D(uPigmentMask, uvClamped).rgb;
        vec2 uvDrift = clamp(uvFlip + uRegistration, 0.001, 0.999);
        vec3 guideDriftSrgb = texture2D(uPigmentMask, uvDrift).rgb;

        if (uDebugMode > 0.5 && uDebugMode < 1.5) { gl_FragColor = vec4(vec3(h), 1.0); return; }
        if (uDebugMode > 1.5 && uDebugMode < 2.5) { gl_FragColor = vec4(nTex * 0.5 + 0.5, 1.0); return; }
        if (uDebugMode > 2.5 && uDebugMode < 3.5) { gl_FragColor = vec4(guideSrgb, 1.0); return; }
        if (uDebugMode > 3.5 && uDebugMode < 4.5) { gl_FragColor = vec4(vec3(grain), 1.0); return; }
        if (uDebugMode > 4.5 && uDebugMode < 5.5) { gl_FragColor = vec4(vec3(pigmentNoise), 1.0); return; }
        vec3 n = normalize(mix(normalize(vN), nTex, 0.95));
        n = normalize(n + vec3((grain - 0.5) * uGrainNormalStrength, (paperFiber - 0.5) * uGrainNormalStrength, 0.0));

        float inkMin = uInkEdge;
        float inkMax = clamp(uInkEdge + 0.34, 0.6, 0.98);
        float ridge = smoothstep(inkMin, inkMax, h);
        float edge = length(vec2(dFdx(h), dFdy(h)));
        float edgeMask = smoothstep(0.015, 0.05, edge);
        float inkMask = ridge * edgeMask;
        inkMask *= (0.92 + (grain - 0.5) * 0.10);

        float cavity = 1.0 - smoothstep(0.18, 0.78, h);
        float ridgeWide  = smoothstep(0.22, 0.95, h);

        float grainAmt = mix(0.07, 0.16, 1.0 - inkMask);
        vec3 col = uPaper + (grain - 0.5) * grainAmt;
        col = mix(col, woodTint, 0.22);
        col += (paperFiber - 0.5) * mix(0.05, 0.12, 1.0 - inkMask);

        vec3 guideLin = srgbToLin(guideDriftSrgb);
        float maxc = max(guideDriftSrgb.r, max(guideDriftSrgb.g, guideDriftSrgb.b));
        float minc = min(guideDriftSrgb.r, min(guideDriftSrgb.g, guideDriftSrgb.b));
        float chroma = maxc - minc;
        float guideActive = smoothstep(0.04, 0.14, chroma) * (1.0 - smoothstep(0.75, 0.95, luma(guideDriftSrgb)));

        int pi = nearestPalette(guideLin);
        vec3 pigment = paletteColor(pi);

        float cov = guideActive;
        cov *= (0.70 + grain * 0.20 + (pigmentNoise - 0.5) * 0.15);
        cov *= (1.0 - inkMask * 0.90);

        float poolEdge = exp(-abs(h - 0.55) * 18.0);
        float pool = poolEdge * uPigmentEdgePool;

        cov = saturate(cov * uPigmentAlpha);
        if (uDebugMode > 5.5 && uDebugMode < 6.5) { gl_FragColor = vec4(vec3(cov), 1.0); return; }

        col = pigmentBlend(col, pigment, cov);
        col *= (1.0 - pool * 0.08);
        col *= (1.0 - cavity * 0.06);

        col = mix(col, uInk, inkMask * uInkAlpha);

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

        col = clamp(col, 0.0, 1.0);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
