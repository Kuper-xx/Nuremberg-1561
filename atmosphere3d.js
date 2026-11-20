/* World-space cloud density sampled in a small HDR buffer. Shared ray functions
 * let the full-resolution composite keep cloud and haze behind the cockpit. */
(() => {
  'use strict';

  const rayFunctions = `
    uniform mat4 uInverseProjection, uViewToWorld;
    uniform vec3 uEye, uSunDirection;
    uniform vec2 uCloudHeights;
    uniform sampler2D uSkyPhoto;
    uniform float uSkyReady;

    vec3 worldRay(vec2 uv) {
      vec4 view = uInverseProjection * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
      return normalize(mat3(uViewToWorld) * view.xyz);
    }
    vec2 cloudRange(vec3 ray) {
      float dy = abs(ray.y) > 0.0001 ? ray.y : (ray.y < 0.0 ? -0.0001 : 0.0001);
      vec2 crossings = (uCloudHeights - uEye.y) / dy;
      return vec2(max(0.0, min(crossings.x, crossings.y)), min(19500.0, max(crossings.x, crossings.y)));
    }
    vec3 horizonLight(vec3 ray) {
      float forward = max(dot(ray, uSunDirection), 0.0);
      return mix(vec3(0.20, 0.27, 0.35), vec3(0.62, 0.40, 0.252), pow(forward, 6.0));
    }
    vec3 daylight(vec3 ray) {
      float elevation = clamp(ray.y, 0.0, 1.0);
      if (uSkyReady > 0.5) {
        vec2 uv = vec2(atan(ray.z, ray.x) * 0.159154943 + 0.5,
                       asin(elevation) * 0.636619772);
        vec3 encoded = texture2D(uSkyPhoto, uv).rgb;
        return (exp2(encoded * 6.0) - 1.0) * 0.125;
      }
      float sun = max(dot(ray, uSunDirection), 0.0);
      vec3 sky = mix(horizonLight(ray), vec3(0.096, 0.185, 0.32), 1.0 - exp(-elevation * 3.3));
      sky += vec3(0.65, 0.39, 0.19) * pow(sun, 32.0) * 0.62;
      sky += vec3(1.0, 0.83, 0.60) * 4.8 * smoothstep(0.99976, 0.99991, sun);
      return sky;
    }
    vec3 horizonAir(vec3 ray) {
      if (uSkyReady < 0.5) return horizonLight(ray);
      float bearing = atan(ray.z, ray.x) * 0.159154943 + 0.5;
      vec3 sky = texture2DLodEXT(uSkyPhoto, vec2(bearing, 0.002), 3.0).rgb;
      return (exp2(sky * 6.0) - 1.0) * 0.125;
    }
    vec3 scatterAir(vec3 surface, vec3 ray, float distance, vec3 horizon) {
      float range = max(0.0, distance - 25.0);
      // Integrate an exponential boundary layer along the view ray.
      float startHeight = max(0.0, uEye.y);
      float endHeight = max(0.0, uEye.y + ray.y * range);
      float delta = (endHeight - startHeight) / 285.0;
      float meanDensity = abs(delta) < 0.02
        ? exp(-startHeight / 285.0)
        : (exp(-startHeight / 285.0) - exp(-endHeight / 285.0)) / delta;
      float distantAir = max(0.0, range - 3100.0) * 0.000084;
      float extinction = range * (0.000018 + 0.000245 * meanDensity) + distantAir;
      float transmission = exp(-extinction);
      float sunAlign = max(dot(ray, uSunDirection), 0.0);
      float mieGlow = pow(sunAlign, 4.5) * 0.72 + pow(sunAlign, 18.0) * 0.58;
      vec3 coolMist = mix(horizon, vec3(0.11, 0.17, 0.23), 0.34);
      vec3 goldenMist = coolMist + vec3(0.76, 0.42, 0.18) * mieGlow * (0.45 + 0.55 * meanDensity);
      vec3 scatter = mix(goldenMist, horizon + vec3(0.55, 0.31, 0.14) * mieGlow * 0.65, smoothstep(4200.0, 13800.0, range));
      return mix(scatter, surface, transmission);
    }
    vec3 aerialPerspective(vec3 surface, vec3 ray, float distance) {
      return scatterAir(surface, ray, distance, horizonAir(ray));
    }
  `;

  const noiseFunction = `
    uniform sampler2D uNoise;
    uniform float uTime;

    float weatherNoise(vec3 p) {
      vec3 cell = floor(p);
      vec3 blend = fract(p);
      blend = blend * blend * (3.0 - 2.0 * blend);
      vec2 tile = cell.xz + vec2(17.0, 37.0) * cell.y + blend.xz;
      vec2 slices = texture2DLodEXT(uNoise, (tile + 0.5) / 256.0, 0.0).rg;
      return mix(slices.r, slices.g, blend.y);
    }
    vec3 movingWeather(vec3 p) {
      return p - vec3(uTime * 8.3, 0.0, -uTime * 3.8);
    }
  `;

  function createNoise(T) {
    // Pack adjacent Z slices into R/G so a trilinear value-noise fetch uses
    // one bilinear texture read and the interpolation between two channels.
    const size = 256;
    const source = new Uint8Array(size * size);
    let seed = 1561;
    for (let i = 0; i < source.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      source[i] = seed >>> 24;
    }
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        pixels[i] = source[y * size + x];
        pixels[i + 1] = source[((y + 37) & 255) * size + ((x + 17) & 255)];
        pixels[i + 3] = 255;
      }
    }
    const texture = new T.DataTexture(pixels, size, size, T.RGBAFormat);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.minFilter = texture.magFilter = T.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  function create(T, gpu, sunDirection) {
    const uniforms = {
      uInverseProjection: { value: new T.Matrix4() },
      uViewToWorld: { value: new T.Matrix4() },
      uEye: { value: new T.Vector3() },
      uSunDirection: { value: sunDirection },
      uCloudHeights: { value: new T.Vector2(670, 1750) },
      uSkyReady: { value: 0 },
      uSkyPhoto: { value: null },
      uNoise: { value: createNoise(T) },
      uTime: { value: 0 }
    };
    if (window.FranconiaSky?.image) {
      const sky = new T.TextureLoader().load(window.FranconiaSky.image, () => {
        uniforms.uSkyReady.value = 1;
      });
      sky.wrapS = T.RepeatWrapping;
      sky.colorSpace = T.NoColorSpace;
      sky.anisotropy = Math.min(4, gpu.capabilities.getMaxAnisotropy());
      uniforms.uSkyPhoto.value = sky;
    }
    const target = new T.WebGLRenderTarget(1, 1, {
      type: T.HalfFloatType,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      depthBuffer: false
    });
    const material = new T.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uSteps: { value: 24 }
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform int uSteps;
        ${rayFunctions}
        ${noiseFunction}
        float cloudDensity(vec3 p) {
          float h = (p.y - uCloudHeights.x) / (uCloudHeights.y - uCloudHeights.x);
          float vertical = smoothstep(0.0, 0.23, h) * (1.0 - smoothstep(0.55, 1.0, h));
          vec3 q = movingWeather(p);
          float front = weatherNoise(vec3(q.xz * 0.00027, 9.5).xzy);
          float shape = weatherNoise(q * vec3(0.00072, 0.00143, 0.00072) + vec3(4.0, 9.0, 3.0));
          float billows = weatherNoise(q * 0.0026 + 26.0);
          float detail = weatherNoise(q * 0.0068 - 12.0);
          float humidity = mix(0.74, 0.52, smoothstep(0.24, 0.75, front));
          return max(0.0, (shape * 0.65 + billows * 0.26 + detail * 0.09) * (0.43 + vertical * 0.73) - humidity);
        }
        void main() {
          vec3 ray = worldRay(vUv);
          vec2 interval = cloudRange(ray);
          interval.y = min(interval.y, 6800.0);
          gl_FragColor = vec4(0.0);
          if (interval.x >= interval.y) return;

          float span = interval.y - interval.x;
          float invSteps = 1.0 / float(uSteps);
          float transmission = 1.0;
          vec3 lighting = vec3(0.0);
          float cosTheta = max(0.0, dot(ray, uSunDirection));
          float silver = pow(cosTheta, 9.0) * 1.15 + pow(cosTheta, 36.0) * 1.45;
          float broadScatter = pow(cosTheta, 2.2) * 0.35;
          vec3 horizon = horizonAir(ray);
          // Concentrate samples near the viewer when the flight path grazes the bank.
          for (int i = 0; i < 28; i++) {
            if (i >= uSteps || transmission < 0.013) break;
            float k = float(i) * invSteps;
            float nextK = k + invSteps;
            float delta = span * (nextK * (0.53 + 0.47 * nextK) - k * (0.53 + 0.47 * k));
            float distance = interval.x + span * k * (0.53 + 0.47 * k) + delta * 0.53;
            vec3 samplePosition = uEye + ray * distance;
            float density = cloudDensity(samplePosition);
            if (density < 0.002) continue;
            float shadowDensity = cloudDensity(samplePosition + uSunDirection * 410.0)
              + cloudDensity(samplePosition + uSunDirection * 990.0) * 0.58;
            float lit = exp(-shadowDensity * 10.5 - density * 2.2);
            float powder = 1.0 - exp(-density * 7.5);
            float cloudTop = smoothstep(uCloudHeights.x, uCloudHeights.y, samplePosition.y);
            // Deep storm-blue underbellies vs warm copper/amber dawn rims + subtle city fire bounce below
            vec3 stormBelly = vec3(0.048, 0.075, 0.118) + vec3(0.055, 0.022, 0.008) * (1.0 - cloudTop);
            vec3 ash = mix(stormBelly, vec3(0.24, 0.31, 0.40), cloudTop);
            vec3 sunTint = mix(vec3(1.12, 0.66, 0.32), vec3(1.38, 0.96, 0.62), cloudTop);
            vec3 sunlit = ash + sunTint * (lit * (0.58 + silver * 1.05 + broadScatter) * (0.55 + 0.45 * powder));
            vec3 light = scatterAir(sunlit, ray, distance * 0.62, horizon);
            float absorption = 1.0 - exp(-density * delta * 0.0086 * (1.0 - smoothstep(4300.0, 6800.0, distance)));
            lighting += light * (transmission * absorption);
            transmission *= 1.0 - absorption;
          }
          gl_FragColor = vec4(lighting, 1.0 - transmission);
        }
      `
    });
    const scene = new T.Scene();
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    scene.add(quad);
    const quadCamera = new T.Camera();

    function render(camera, w, h, quality, time) {
      const ratio = quality === 'high' ? 0.34 : quality === 'low' ? 0.15 : quality === 'medium' ? 0.23 : 0.27;
      const bufferWidth = Math.max(16, Math.min(640, Math.round(w * ratio)));
      const bufferHeight = Math.max(16, Math.round(bufferWidth * h / w));
      if (target.width !== bufferWidth || target.height !== bufferHeight) {
        target.setSize(bufferWidth, bufferHeight);
      }
      uniforms.uEye.value.copy(camera.position);
      uniforms.uViewToWorld.value.copy(camera.matrixWorld);
      uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
      uniforms.uTime.value = time;
      material.uniforms.uSteps.value = quality === 'high' ? 28 : quality === 'low' ? 12 : 23;
      gpu.setRenderTarget(target);
      gpu.render(scene, quadCamera);
    }

    return { render, rayFunctions, noiseFunction, uniforms, texture: target.texture };
  }

  window.Atmosphere3D = { create };
})();
