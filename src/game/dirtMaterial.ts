// Material patch: blends the clean material with procedural dust and rust using the cleaning mask.
// Mask (canvas texture): R = dust removed, G = rust removed. Dirt map (data texture): R = dust, G = rust.
import * as THREE from 'three';

export interface DirtUniforms {
  uMask: { value: THREE.Texture | null };
  uDirt: { value: THREE.Texture | null };
  uGold: { value: number };
  uShine: { value: number };
  uSeed: { value: number };
}

export function createDirtUniforms(): DirtUniforms {
  return { uMask: { value: null }, uDirt: { value: null }, uGold: { value: 0 }, uShine: { value: 0 }, uSeed: { value: 0 } };
}

const NOISE = /* glsl */ `
uniform sampler2D uMask;
uniform sampler2D uDirt;
uniform float uGold;
uniform float uShine;
uniform float uSeed;
varying vec2 vMaskUv;
varying vec3 vItemPos;
float ssH13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float ssNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ssH13(i), ssH13(i + vec3(1,0,0)), f.x), mix(ssH13(i + vec3(0,1,0)), ssH13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ssH13(i + vec3(0,0,1)), ssH13(i + vec3(1,0,1)), f.x), mix(ssH13(i + vec3(0,1,1)), ssH13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float ssFbm(vec3 p) { return ssNoise(p) * 0.5 + ssNoise(p * 2.03) * 0.3 + ssNoise(p * 4.11) * 0.2; }
`;

const DIRT = /* glsl */ `
vec4 ssDirt = texture2D(uDirt, vMaskUv);
vec4 ssMask = texture2D(uMask, vMaskUv);
float ssA = ssFbm(vItemPos * 6.0 + uSeed);
float ssB = ssFbm(vItemPos * 21.0 + uSeed * 1.7);
float ssLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.76, 0.28) * (0.55 + ssLum * 0.8), uGold * 0.75);
float ssRust = clamp(ssDirt.g * (1.0 - smoothstep(0.0, 0.8, ssMask.g)) * (0.75 + 0.7 * ssB), 0.0, 1.0);
float ssDust = clamp(ssDirt.r * (1.0 - smoothstep(0.0, 0.8, ssMask.r)) * (0.5 + 0.75 * ssA), 0.0, 1.0);
vec3 ssRustCol = mix(vec3(0.22, 0.09, 0.03), vec3(0.55, 0.26, 0.08), ssB);
vec3 ssDustCol = mix(vec3(0.07, 0.055, 0.04), vec3(0.30, 0.25, 0.19), smoothstep(0.3, 0.85, ssB * 0.5 + ssA * 0.7));
diffuseColor.rgb = mix(diffuseColor.rgb, ssRustCol, ssRust);
diffuseColor.rgb = mix(diffuseColor.rgb, ssDustCol, ssDust * 0.96);
diffuseColor.a = mix(diffuseColor.a, 1.0, ssDust * 0.8);
float ssDirty = max(ssRust, ssDust);
`;

/** Converts any glTF/three material into a patched MeshStandardMaterial sharing `u`. */
export function patchMaterial(src: THREE.Material, u: DirtUniforms): THREE.MeshStandardMaterial {
  const s = src as THREE.MeshPhysicalMaterial;
  const isGlass = (s.transmission ?? 0) > 0 || (s.transparent && s.opacity < 0.95) || /glass/i.test(src.name);
  const m = new THREE.MeshStandardMaterial({
    name: src.name,
    color: s.color?.clone() ?? new THREE.Color(0xffffff),
    map: s.map ?? null,
    normalMap: s.normalMap ?? null,
    roughness: s.roughness ?? 0.5,
    roughnessMap: s.roughnessMap ?? null,
    metalness: s.metalness ?? 0,
    metalnessMap: s.metalnessMap ?? null,
    aoMap: s.aoMap ?? null,
    emissive: s.emissive?.clone() ?? new THREE.Color(0),
    emissiveMap: s.emissiveMap ?? null,
    side: src.side,
    transparent: isGlass,
    opacity: isGlass ? 0.35 : 1,
    depthWrite: !isGlass,
  });
  if (s.normalScale) m.normalScale.copy(s.normalScale);
  if (isGlass) {
    m.color.set(0xfff4e0);
    m.roughness = 0.05;
    m.metalness = 0;
  }
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 maskUv;\nvarying vec2 vMaskUv;\nvarying vec3 vItemPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMaskUv = maskUv;\nvItemPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + DIRT)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.93, ssDirty);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, ssDirty * 0.9);\nmetalnessFactor = mix(metalnessFactor, 1.0, uGold * 0.6);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.86, 0.6) * uShine * (1.0 - ssDirty) * 0.5;');
  };
  m.customProgramCacheKey = () => 'shine-dirt-v1';
  return m;
}
