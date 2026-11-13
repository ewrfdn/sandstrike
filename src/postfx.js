import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp, damp } from './utils.js';

/**
 * Per-tier post-processing budget. `samples` is the MSAA sample count of the
 * HDR target, `bloom` the UnrealBloom strength (0 = no bloom pass at all) and
 * `grain` the film-grain amount.
 */
const QUALITY_PRESETS = {
  lowest: { samples: 0, bloom: 0, grain: 0.02 },
  low: { samples: 2, bloom: 0.18, grain: 0.024 },
  medium: { samples: 2, bloom: 0.28, grain: 0.028 },
  high: { samples: 4, bloom: 0.4, grain: 0.035 },
  ultra: { samples: 4, bloom: 0.5, grain: 0.035 },
};
const normalizeQuality = (value) => (QUALITY_PRESETS[value] ? value : 'high');

/**
 * Cinematic post stack: HDR MSAA render -> bloom -> filmic grade/lens -> output.
 * The grade pass runs in linear HDR space (before OutputPass tone maps + encodes).
 */
const SandGradeShader = {
  name: 'SandGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uDamage: { value: 0 },
    uLowHealth: { value: 0 },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.85 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.04 },
    uExposureHint: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uDamage;
    uniform float uLowHealth;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uSaturation;
    uniform float uContrast;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec3 sampleRGB(vec2 uv, float amount) {
      // radial chromatic aberration, strongest toward the edge
      vec2 dir = uv - 0.5;
      float r = length(dir);
      float ab = amount * (0.00055 + r * 0.0012);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ab).b;
      return col;
    }

    void main() {
      vec2 uv = vUv;
      vec2 centered = uv - 0.5;
      float radial = length(centered);

      // barely-there barrel warp keeps edges cinematic without distorting gameplay
      vec2 warped = uv + centered * dot(centered, centered) * 0.012;
      vec3 color = sampleRGB(warped, uAberration);

      // Safety net: one NaN/Inf texel anywhere upstream would be smeared by the
      // bloom mip chain into a large black band. Kill it here so a single bad
      // fragment can never take out a region of the screen.
      if (any(notEqual(color, color))) color = vec3(0.0);
      color = clamp(color, 0.0, 64.0);

      // filmic grade in linear space: teal-lifted shadows, warm highlights
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.88, 0.98, 1.06);
      vec3 highTint = vec3(1.06, 1.01, 0.93);
      float highMask = smoothstep(0.10, 1.4, luma);
      color *= mix(shadowTint, highTint, highMask);
      color = mix(vec3(luma), color, uSaturation);
      color = (color - 0.18 * uContrast) * uContrast + 0.18 * uContrast;
      color = max(color, vec3(0.0));

      // gentle highlight shoulder in linear space (ACES will finish the job)
      color = color / (1.0 + max(vec3(0.0), color - 1.6) * 0.12);
      color += vec3(0.0018, 0.0016, 0.0021);

      // organic lens contamination (procedural, no texture)
      vec2 q = uv * vec2(1.0, 0.7);
      float lensDirt = smoothstep(0.55, 1.0, hash12(floor(q * 420.0))) * 0.04;
      float smudge = smoothstep(0.25, 0.0, length(uv - vec2(0.72, 0.28))) * 0.025;
      lensDirt += smudge * luma;
      color += color * lensDirt * smoothstep(0.0, 0.5, luma);

      // vignette
      float vig = smoothstep(0.92, 0.22, radial * (0.95 + 0.12 * uLowHealth));
      color *= mix(1.0, vig, 0.55 * uVignette);

      // scanline / display texture, extremely subtle
      float scan = sin(uv.y * uResolution.y * 1.15) * 0.0035;
      color += scan;

      // film grain, several hashes for a softer grain structure
      float grain = hash12(uv * uResolution * 0.7 + fract(uTime) * 931.0) - 0.5;
      grain += hash12(uv * uResolution * 1.7 - fract(uTime) * 537.0) - 0.5;
      color += grain * uGrain * (0.25 + 0.75 * (1.0 - luma * 0.6));

      // damage feedback: warm desaturated edges + red bloom bleed
      float edge = smoothstep(0.18, 0.72, radial);
      color = mix(color, vec3(luma * 1.08, luma * 0.44, luma * 0.36), edge * uDamage * 0.72);
      color += vec3(0.12, 0.010, 0.004) * uDamage * edge;
      // low-health: crush saturation at edges, pulse
      float pulse = 0.55 + 0.45 * sin(uTime * 5.2);
      color = mix(color, vec3(luma * 1.05, luma * 0.38, luma * 0.32), edge * uLowHealth * (0.25 + 0.25 * pulse));

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, { quality = 'high' } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = normalizeQuality(quality);
    this.damage = 0;
    this.lowHealth = 0;
    this._damageTarget = 0;
    this._time = 0;
    this._build();
  }

  _build() {
    if (this.composer) {
      this.composer.passes.forEach((pass) => pass.dispose?.());
      this.composer.dispose();
      this.composer = null;
    }
    const size = this.renderer.getSize(new THREE.Vector2());
    const pixelRatio = this.renderer.getPixelRatio();
    const preset = QUALITY_PRESETS[this.quality] || QUALITY_PRESETS.high;
    const samples = preset.samples;
    const target = new THREE.WebGLRenderTarget(
      Math.max(2, Math.floor(size.x)),
      Math.max(2, Math.floor(size.y)),
      { type: THREE.HalfFloatType, samples, depthBuffer: true, stencilBuffer: false }
    );
    target.texture.name = 'Sandstrike.HDR.main';

    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(Math.max(2, size.x), Math.max(2, size.y));

    const renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(renderPass);

    if (preset.bloom > 0) {
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        preset.bloom,
        0.58,
        0.95
      );
      composer.addPass(this.bloom);
    } else {
      // LOWEST: skip the bloom mip chain entirely (largest single post-FX cost).
      this.bloom = null;
    }

    this.grade = new ShaderPass(SandGradeShader);
    this.grade.uniforms.uResolution.value.set(
      Math.floor(size.x * pixelRatio),
      Math.floor(size.y * pixelRatio)
    );
    composer.addPass(this.grade);

    composer.addPass(new OutputPass());

    this.composer = composer;
    this.renderPass = renderPass;
    this._size = size;
    this._pixelRatio = pixelRatio;
  }

  setQuality(quality) {
    const next = normalizeQuality(quality);
    if (next === this.quality) return;
    this.quality = next;
    // Viewport size / pixel ratio is owned by main.js; rebuilding the composer
    // picks up the current renderer size and the new per-tier budget.
    this._build();
  }

  setSize(width, height) {
    if (!this.composer) return;
    const pixelRatio = this.renderer.getPixelRatio();
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.grade.uniforms.uResolution.value.set(
      Math.max(1, Math.floor(width * pixelRatio)),
      Math.max(1, Math.floor(height * pixelRatio))
    );
    this._size?.set(width, height);
    this._pixelRatio = pixelRatio;
  }

  /** strength 0..1 (screen flash, red bleed) */
  setDamage(strength) {
    this.damage = Math.max(this.damage, clamp(strength, 0, 1));
    this._damageTarget = Math.max(this._damageTarget, clamp(strength * 0.7, 0, 0.85));
  }

  setLowHealth(value) {
    this.lowHealth = clamp(value, 0, 1);
  }

  update(dt) {
    this._time += dt;
    this.damage = damp(this.damage, this._damageTarget, 5.5, dt);
    this._damageTarget = damp(this._damageTarget, 0, 1.9, dt);
    if (this.grade) {
      const u = this.grade.uniforms;
      u.uTime.value = this._time;
      u.uDamage.value = this.damage;
      u.uLowHealth.value = this.lowHealth;
      u.uVignette.value = 1.0;
      u.uGrain.value = (QUALITY_PRESETS[this.quality] || QUALITY_PRESETS.high).grain;
    }
  }

  render(dt) {
    this.update(dt);
    if (this.composer) this.composer.render(dt);
  }

  dispose() {
    this.composer?.passes.forEach((pass) => pass.dispose?.());
    this.composer?.dispose();
  }
}
