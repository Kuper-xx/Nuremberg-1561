/* HDR scene composite, reflection environment and tangent-space material maps. */
(() => {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(v, b)); }

  function buildEquirectangularHDRI(T, pmrem) {
    const source = window.FranconiaSky;
    if (!source?.probe || !T.DataUtils?.toHalfFloat) return null;
    const packed = atob(source.probe);
    const width = 256, height = 128;
    if (packed.length !== width * height * 3) return null;
    const data = new Uint16Array(width * height * 4);
    const lut = Uint16Array.from({ length: 256 }, (_, level) =>
      T.DataUtils.toHalfFloat((2 ** (level * 6 / 255) - 1) / 8));
    for (let pixel = 0; pixel < width * height; pixel++) {
      for (let channel = 0; channel < 3; channel++) {
        data[pixel * 4 + channel] = lut[packed.charCodeAt(pixel * 3 + channel)];
      }
      data[pixel * 4 + 3] = 0x3c00;
    }
    const texture = new T.DataTexture(data, width, height, T.RGBAFormat, T.HalfFloatType);
    texture.mapping = T.EquirectangularReflectionMapping;
    texture.colorSpace = T.LinearSRGBColorSpace;
    texture.minFilter = texture.magFilter = T.LinearFilter;
    texture.needsUpdate = true;
    const result = pmrem.fromEquirectangular(texture);
    texture.dispose();
    return result.texture;
  }

  /**
   * Generates tangent-space NormalMap and physically contrasted RoughnessMap
   * from an existing procedural/photographic CanvasTexture image.
   * Uses max 512x512 sampling to avoid startup stalls on high-res textures.
   */
  function buildPBRMaps(T, sourceCanvas, opts = {}) {
    if (!T || !T.CanvasTexture || !sourceCanvas || typeof document === 'undefined') return null;

    const size = clamp(Number(opts.size) || 512, 128, 512);
    const strength = Number(opts.strength) || 2.2;
    const baseRough = clamp(opts.baseRough !== undefined ? opts.baseRough : 0.72, 0.05, 0.98);
    const roughSpread = clamp(opts.roughSpread !== undefined ? opts.roughSpread : 0.35, 0.05, 0.6);
    const repeatX = Number(opts.repeatX) || 1;
    const repeatY = Number(opts.repeatY) || 1;

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = sampleCanvas.height = size;
    const sCtx = sampleCanvas.getContext('2d');
    sCtx.drawImage(sourceCanvas, 0, 0, size, size);
    const srcPixels = sCtx.getImageData(0, 0, size, size).data;

    const heightMap = new Float32Array(size * size);
    for (let i = 0, p = 0; i < heightMap.length; i++, p += 4) {
      heightMap[i] = (0.299 * srcPixels[p] + 0.587 * srcPixels[p + 1] + 0.114 * srcPixels[p + 2]) / 255;
    }

    const normCanvas = document.createElement('canvas');
    normCanvas.width = normCanvas.height = size;
    const nCtx = normCanvas.getContext('2d');
    const normImg = nCtx.createImageData(size, size);
    const nData = normImg.data;

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = roughCanvas.height = size;
    const rCtx = roughCanvas.getContext('2d');
    const roughImg = rCtx.createImageData(size, size);
    const rData = roughImg.data;

    const wrap = (v) => ((v % size) + size) % size;

    for (let y = 0; y < size; y++) {
      const ym1 = wrap(y - 1) * size;
      const y0 = y * size;
      const yp1 = wrap(y + 1) * size;

      for (let x = 0; x < size; x++) {
        const xm1 = wrap(x - 1);
        const xp1 = wrap(x + 1);

        // 3x3 Sobel gradients for crisp tangent-space normals
        const tl = heightMap[ym1 + xm1], t = heightMap[ym1 + x], tr = heightMap[ym1 + xp1];
        const l  = heightMap[y0  + xm1], c = heightMap[y0  + x], r  = heightMap[y0  + xp1];
        const bl = heightMap[yp1 + xm1], b = heightMap[yp1 + x], br = heightMap[yp1 + xp1];

        const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
        const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);

        let nx = -gx * strength;
        let ny = -gy * strength;
        let nz = 1.0;
        const invLen = 1 / Math.hypot(nx, ny, nz);
        nx *= invLen; ny *= invLen; nz *= invLen;

        const outIdx = (y0 + x) * 4;
        nData[outIdx]     = Math.round((nx * 0.5 + 0.5) * 255);
        nData[outIdx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        nData[outIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        nData[outIdx + 3] = 255;

        // Cavity roughness: mortar seams & dark crevices are very matte; raised tiles/metal polish reflect cleanly
        const avg = (tl + t + tr + l + r + bl + b + br) * 0.125;
        const cavity = clamp((avg - c) * 2.4 + (0.5 - c) * 0.55, -0.5, 0.8);
        const roughVal = Math.round(clamp(baseRough + cavity * roughSpread, 0.08, 0.98) * 255);
        rData[outIdx] = rData[outIdx + 1] = rData[outIdx + 2] = roughVal;
        rData[outIdx + 3] = 255;
      }
    }

    nCtx.putImageData(normImg, 0, 0);
    rCtx.putImageData(roughImg, 0, 0);

    const normalMap = new T.CanvasTexture(normCanvas);
    const roughnessMap = new T.CanvasTexture(roughCanvas);
    for (const tex of [normalMap, roughnessMap]) {
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.anisotropy = 8;
      if (T.NoColorSpace !== undefined) tex.colorSpace = T.NoColorSpace;
      tex.needsUpdate = true;
    }

    return { normalMap, roughnessMap };
  }

  function createPostPipeline(T, gpu, sunDirection) {
    if (!gpu.capabilities.isWebGL2 || !gpu.extensions.has('EXT_color_buffer_float') ||
        !window.Atmosphere3D) return null;

    const atmosphere = window.Atmosphere3D.create(T, gpu, sunDirection);
    const quadCam = new T.Camera();
    const quadScene = new T.Scene();
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    quadScene.add(quad);

    const targetOptions = {
      type: T.HalfFloatType,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter
    };
    const world = new T.WebGLRenderTarget(1, 1, targetOptions);
    world.depthTexture = new T.DepthTexture(1, 1, T.UnsignedIntType);
    world.samples = Math.min(2, gpu.capabilities.maxSamples);
    const plumes = new T.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
    const plumeLayer = 1;
    const glowA = new T.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
    const glowB = new T.WebGLRenderTarget(1, 1, { ...targetOptions, depthBuffer: false });
    const clearColor = new T.Color();

    function pass(uniforms, code) {
      return new T.ShaderMaterial({
        uniforms,
        depthTest: false,
        depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'varying vec2 vUv;\n' + code
      });
    }

    const background = pass({
      ...atmosphere.uniforms,
      uCloud: { value: atmosphere.texture }
    }, `
      uniform sampler2D uCloud;
      ${atmosphere.rayFunctions}
      void main() {
        vec4 cloud = texture2D(uCloud, vUv);
        gl_FragColor = vec4(cloud.rgb + daylight(worldRay(vUv)) * (1.0 - cloud.a), 1.0);
      }
    `);
    const extract = pass({
      uWorld: { value: world.texture },
      uPlumes: { value: plumes.texture },
      uPixel: { value: new T.Vector2() }
    }, `
      uniform sampler2D uWorld, uPlumes;
      uniform vec2 uPixel;
      void main() {
        vec3 color = (
          texture2D(uWorld, vUv + uPixel * vec2( 1.0,  1.0)).rgb +
          texture2D(uWorld, vUv + uPixel * vec2(-1.0,  1.0)).rgb +
          texture2D(uWorld, vUv + uPixel * vec2( 1.0, -1.0)).rgb +
          texture2D(uWorld, vUv + uPixel * vec2(-1.0, -1.0)).rgb
        ) * 0.25;
        vec4 smoke = texture2D(uPlumes, vUv);
        color = color * (1.0 - smoke.a) + smoke.rgb;
        float peak = max(max(color.r, color.g), color.b);
        float highlight = smoothstep(0.92, 1.95, peak) * max(0.0, peak - 0.85);
        gl_FragColor = vec4(color * (min(highlight, 8.5) / max(peak, 0.01)), 1.0);
      }
    `);
    const blur = pass({
      uSource: { value: glowA.texture },
      uDirection: { value: new T.Vector2() },
      uAnamorphic: { value: 0 }
    }, `
      uniform sampler2D uSource;
      uniform vec2 uDirection;
      uniform float uAnamorphic;
      void main() {
        vec3 radiance = texture2D(uSource, vUv).rgb * 0.227027;
        radiance += (texture2D(uSource, vUv + uDirection * 1.3846).rgb +
                     texture2D(uSource, vUv - uDirection * 1.3846).rgb) * 0.316216;
        radiance += (texture2D(uSource, vUv + uDirection * 3.2307).rgb +
                     texture2D(uSource, vUv - uDirection * 3.2307).rgb) * 0.070270;
        if (uAnamorphic > 0.5) {
          // Subtle Panavision horizontal flare wings on HDR peaks (sun, engines, blasts).
          vec3 streak = (
            texture2D(uSource, vUv + uDirection * 7.5).rgb +
            texture2D(uSource, vUv - uDirection * 7.5).rgb +
            texture2D(uSource, vUv + uDirection * 14.0).rgb * 0.55 +
            texture2D(uSource, vUv - uDirection * 14.0).rgb * 0.55
          ) * 0.075;
          radiance += streak * vec3(0.86, 0.94, 1.18);
        }
        gl_FragColor = vec4(radiance, 1.0);
      }
    `);
    const composite = pass({
      ...atmosphere.uniforms,
      uWorld: { value: world.texture },
      uDepth: { value: world.depthTexture },
      uCloud: { value: atmosphere.texture },
      uPlumes: { value: plumes.texture },
      uGlow: { value: glowA.texture },
      uPixel: { value: new T.Vector2() },
      uClip: { value: new T.Vector2() },
      uQuality: { value: 1 },
      uDamage: { value: 0 },
      uGForce: { value: 1 },
      uBoost: { value: 0 },
      uBlast: { value: 0 },
      uSunScreen: { value: new T.Vector3(0.5, 0.5, 0) },
      uShockwave: { value: new T.Vector4(0.5, 0.5, 0, 0) },
      uAspect: { value: 1.777 }
    }, `
      uniform sampler2D uWorld, uDepth, uCloud, uPlumes, uGlow;
      uniform vec2 uPixel, uClip;
      uniform int uQuality;
      uniform float uDamage, uGForce, uBoost, uBlast, uAspect;
      uniform vec3 uSunScreen;
      uniform vec4 uShockwave;
      ${atmosphere.rayFunctions}
      ${atmosphere.noiseFunction}

      float viewDepth(float rawDepth) {
        return uClip.x * uClip.y / (uClip.y - rawDepth * (uClip.y - uClip.x));
      }
      bool validRadiance(vec3 color) {
        return !any(isnan(color)) && !any(isinf(color));
      }
      float occlusion(vec2 offset, float depth, float maxDelta) {
        float neighbor = viewDepth(texture2D(uDepth, vUv + offset).x);
        float diff = depth - neighbor;
        return smoothstep(0.35, 2.5, diff) * (1.0 - smoothstep(maxDelta * 0.35, maxDelta, diff));
      }
      float filmHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      vec3 filmic(vec3 color) {
        color = clamp(color, vec3(0.0), vec3(64.0));
        // Subtle cinema S-curve color grading: cool steel shadows, warm amber dawn highlights.
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        vec3 shadowTint = vec3(0.93, 0.98, 1.06);
        vec3 highTint = vec3(1.06, 0.99, 0.91);
        color *= mix(shadowTint, highTint, smoothstep(0.08, 1.15, luma));
        color = mix(vec3(luma), color, 1.11);
        float energy = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(color, vec3(energy), smoothstep(0.95, 5.5, energy) * 0.42);
        vec3 mapped = clamp(color * (2.51 * color + 0.03) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
        // Deep cinematic black-point rolloff without crushing detail.
        return pow(mapped, vec3(1.035));
      }
      void main() {
        float rawDepthCenter = texture2D(uDepth, vUv).x;
        float depthCenter = viewDepth(rawDepthCenter);
        bool isCockpit = rawDepthCenter < 0.9999998 && depthCenter < 12.0;

        vec2 sampleUv = vUv;
        float shockRing = 0.0;
        if (!isCockpit && uShockwave.w > 0.001) {
          vec2 toShock = vUv - uShockwave.xy;
          toShock.x *= uAspect;
          float dShock = length(toShock);
          float band = exp(-pow((dShock - uShockwave.z) / 0.038, 2.0));
          shockRing = band * uShockwave.w;
          if (dShock > 0.001) {
            vec2 push = (toShock / dShock);
            push.x /= uAspect;
            sampleUv -= push * shockRing * 0.024;
          }
        }
        sampleUv = clamp(sampleUv, vec2(0.001), vec2(0.999));

        vec3 ray = worldRay(sampleUv);
        float rawDepth = texture2D(uDepth, sampleUv).x;
        float depth = viewDepth(rawDepth);
        vec3 base = texture2D(uWorld, sampleUv).rgb;

        // Dynamic optical chromatic aberration & radial boost velocity blur on exterior view.
        if (!isCockpit && uQuality > 0) {
          vec2 fromCenter = sampleUv - 0.5;
          float edgeR = length(fromCenter);
          float caAmount = (0.0007 + uBoost * 0.0036 + uBlast * 0.0028 + uDamage * 0.0045 + shockRing * 0.0065) * smoothstep(0.14, 0.72, edgeR);
          if (caAmount > 0.0005) {
            vec2 dir = fromCenter * caAmount;
            vec3 rSample = texture2D(uWorld, clamp(sampleUv + dir, vec2(0.001), vec2(0.999))).rgb;
            vec3 bSample = texture2D(uWorld, clamp(sampleUv - dir, vec2(0.001), vec2(0.999))).rgb;
            if (validRadiance(rSample) && validRadiance(bSample)) {
              base.r = mix(base.r, rSample.r, 0.78);
              base.b = mix(base.b, bSample.b, 0.78);
            }
          }
          if (uBoost > 0.12 && edgeR > 0.18) {
            float blurStr = uBoost * smoothstep(0.18, 0.75, edgeR) * 0.011;
            vec3 m1 = texture2D(uWorld, clamp(sampleUv - fromCenter * blurStr, vec2(0.001), vec2(0.999))).rgb;
            vec3 m2 = texture2D(uWorld, clamp(sampleUv - fromCenter * blurStr * 2.0, vec2(0.001), vec2(0.999))).rgb;
            if (validRadiance(m1) && validRadiance(m2)) {
              base = base * 0.58 + m1 * 0.27 + m2 * 0.15;
            }
          }
        }

        vec3 color = validRadiance(base) ? base : daylight(ray);
        if (rawDepth < 0.9999998) {
          float distance = depth / max(0.1, dot(ray, -uViewToWorld[2].xyz));
          vec3 surface = uEye + ray * distance;
          if (uQuality > 0 && depth > 25.0 && surface.y < 430.0) {
            vec3 atCloud = surface + uSunDirection * ((1220.0 - surface.y) / uSunDirection.y);
            vec3 drift = movingWeather(atCloud);
            float front = weatherNoise(vec3(drift.xz * 0.00027, 9.5).xzy);
            float shape = weatherNoise(drift * vec3(0.00072, 0.00143, 0.00072) + vec3(4.0, 9.0, 3.0));
            float sunlight = 1.0 - smoothstep(0.45, 0.72, front * 0.6 + shape * 0.4);
            color *= mix(vec3(0.64, 0.75, 0.88), vec3(1.10, 1.02, 0.93), sunlight);
          }

          // Contact shadows from neighboring depth silhouettes.
          if (uQuality > 0 && depth > 25.0 && depth < 2400.0) {
            float maxDelta = clamp(depth * 0.042, 5.0, 32.0);
            vec2 offset = uPixel * clamp(3000.0 / depth, 2.5, 11.0);
            float ao = occlusion(vec2(offset.x, 0.0), depth, maxDelta)
                     + occlusion(vec2(-offset.x, 0.0), depth, maxDelta)
                     + occlusion(vec2(0.0, offset.y), depth, maxDelta)
                     + occlusion(vec2(0.0, -offset.y), depth, maxDelta);
            color *= 1.0 - min(0.35, ao * 0.095) * (1.0 - smoothstep(1400.0, 2400.0, depth));
          }
          color = aerialPerspective(color, ray, distance);
          vec2 interval = cloudRange(ray);
          if (interval.y > interval.x && distance > interval.x) {
            vec4 cloud = texture2D(uCloud, sampleUv);
            float inside = min(1700.0, (interval.y - interval.x) * 0.36);
            float visible = smoothstep(interval.x + 45.0, interval.x + max(100.0, inside), distance);
            color = mix(color, cloud.rgb + color * (1.0 - cloud.a), visible);
          }
        }
        vec4 plume = texture2D(uPlumes, sampleUv);
        if (validRadiance(plume.rgb) && plume.a >= 0.0 && plume.a <= 1.0) {
          color = plume.rgb + color * (1.0 - plume.a);
        }

        // Volumetric crepuscular sun shafts (god-rays) piercing clouds & silhouettes.
        if (uQuality > 0 && !isCockpit && uSunScreen.z > 0.01) {
          vec2 rayDelta = (uSunScreen.xy - sampleUv) * 0.115;
          vec2 marchUv = sampleUv;
          float shaft = 0.0;
          float weight = 0.24;
          for (int s = 0; s < 8; s++) {
            marchUv += rayDelta;
            if (marchUv.x < 0.0 || marchUv.x > 1.0 || marchUv.y < 0.0 || marchUv.y > 1.0) break;
            float dTap = texture2D(uDepth, marchUv).x;
            float skyOpen = step(0.999995, dTap);
            float cloudGap = 1.0 - texture2D(uCloud, marchUv).a * 0.78;
            shaft += skyOpen * cloudGap * weight;
            weight *= 0.84;
          }
          float sunDot = max(0.0, dot(ray, uSunDirection));
          float rayFade = (0.28 + 0.72 * pow(sunDot, 3.0)) * uSunScreen.z;
          color += vec3(1.18, 0.72, 0.34) * shaft * rayFade * 0.42;

          // Subtle Panavision anamorphic sun flare line.
          vec2 toSun = sampleUv - uSunScreen.xy;
          float streakY = exp(-abs(toSun.y) * 58.0);
          float streakX = exp(-abs(toSun.x) * 2.1);
          float sunCloudOcc = 1.0 - texture2D(uCloud, clamp(uSunScreen.xy, vec2(0.01), vec2(0.99))).a * 0.72;
          float sunDepthOcc = step(0.99999, texture2D(uDepth, clamp(uSunScreen.xy, vec2(0.01), vec2(0.99))).x);
          float flareAmt = streakY * streakX * uSunScreen.z * sunCloudOcc * sunDepthOcc;
          color += mix(vec3(0.55, 0.82, 1.25), vec3(1.35, 0.92, 0.52), exp(-abs(toSun.x) * 9.0)) * flareAmt * 0.36;
        }

        if (uQuality > 0) {
          vec3 glow = texture2D(uGlow, sampleUv).rgb;
          if (validRadiance(glow)) {
            color += glow * (0.24 + uBlast * 0.14);
            // Warm film halation around intense fire & explosions.
            color.r += max(0.0, glow.r - glow.b * 0.8) * 0.09;
          }
        }

        // Shockwave bright compression rim.
        if (shockRing > 0.01) {
          color += vec3(1.25, 0.92, 0.62) * shockRing * 0.28;
        }

        vec2 frame = (vUv - 0.5) * vec2(1.08, 0.94);
        float edge = smoothstep(0.24, 0.74, length(frame));
        float boostVig = uBoost * 0.12;
        color *= 1.0 - edge * (0.16 + boostVig + clamp((uGForce - 3.4) * 0.105, 0.0, 0.54));
        color += vec3(0.86, 0.055, 0.022) * (uDamage * edge * 0.44);
        color += vec3(1.0, 0.68, 0.35) * (uBlast * (1.0 - edge * 0.4) * 0.16);

        vec3 graded = filmic(color * 0.91);
        if (!validRadiance(graded) || (depth > 200.0 && dot(graded, graded) < 0.00001)) {
          vec3 fallback = validRadiance(base) && dot(base, base) > 0.00001 ? base : daylight(ray);
          if (rawDepth < 0.9999998 && depth > 200.0) {
            fallback = aerialPerspective(fallback, ray, depth);
          }
          graded = filmic(fallback * 0.91);
        }

        // Fine 35mm cinema film grain (delicate on exterior, nearly invisible on dark cockpit surfaces).
        if (uQuality > 0) {
          float g = filmHash(gl_FragCoord.xy + fract(uTime * 17.37) * 512.0) - 0.5;
          float lumaG = dot(graded, vec3(0.3, 0.59, 0.11));
          float grainMask = smoothstep(0.03, 0.22, lumaG) * (1.0 - smoothstep(0.60, 0.96, lumaG));
          float grainAmp = isCockpit ? 0.0025 : 0.0085;
          graded = clamp(graded + g * grainAmp * grainMask, 0.0, 1.0);
        }

        gl_FragColor = vec4(graded, 1.0);
        #include <colorspace_fragment>
      }
    `);

    function draw(material, target) {
      quad.material = material;
      gpu.setRenderTarget(target);
      gpu.render(quadScene, quadCam);
    }

    const sunClip = new T.Vector3();
    const camForward = new T.Vector3();
    const blastClip = new T.Vector3();

    function render(scene, camera, quality, w, h, state) {
      const pr = gpu.getPixelRatio();
      const width = Math.max(16, Math.round(w * pr));
      const height = Math.max(16, Math.round(h * pr));
      const samples = quality === 'low' || quality === 'medium' ? 0 : Math.min(2, gpu.capabilities.maxSamples);
      if (world.samples !== samples) {
        world.dispose();
        world.samples = samples;
      }
      if (world.width !== width || world.height !== height) {
        world.setSize(width, height);
        plumes.setSize(width, height);
        const glowWidth = Math.max(8, Math.round(width / 4));
        const glowHeight = Math.max(8, Math.round(height / 4));
        glowA.setSize(glowWidth, glowHeight);
        glowB.setSize(glowWidth, glowHeight);
        extract.uniforms.uPixel.value.set(1 / width, 1 / height);
        composite.uniforms.uPixel.value.copy(extract.uniforms.uPixel.value);
      }

      camera.updateMatrixWorld();
      atmosphere.render(camera, width, height, quality, state.time);
      draw(background, world);
      const autoClear = gpu.autoClear;
      const sceneBackground = scene.background;
      gpu.autoClear = false;
      scene.background = null;
      gpu.render(scene, camera);
      const { calls, triangles } = gpu.info.render;

      // Smoke gets its own premultiplied layer so the haze of a distant
      // mountainside cannot bleach a nearer plume along the skyline.
      gpu.setRenderTarget(plumes);
      gpu.getClearColor(clearColor);
      const clearAlpha = gpu.getClearAlpha();
      gpu.setClearColor(0, 0);
      gpu.clear(true, false, false);
      const layers = camera.layers.mask;
      camera.layers.set(plumeLayer);
      gpu.render(scene, camera);
      camera.layers.mask = layers;
      gpu.setClearColor(clearColor, clearAlpha);
      gpu.autoClear = autoClear;
      scene.background = sceneBackground;

      if (quality !== 'low') {
        draw(extract, glowA);
        blur.uniforms.uSource.value = glowA.texture;
        blur.uniforms.uDirection.value.set(1 / glowA.width, 0);
        blur.uniforms.uAnamorphic.value = 1;
        draw(blur, glowB);
        blur.uniforms.uSource.value = glowB.texture;
        blur.uniforms.uDirection.value.set(0, 1 / glowB.height);
        blur.uniforms.uAnamorphic.value = 0;
        draw(blur, glowA);
      }

      // Project sun into screen UV for volumetric crepuscular shafts & anamorphic lens flare.
      camera.getWorldDirection(camForward);
      const sunFacing = camForward.dot(sunDirection);
      if (sunFacing > 0.08) {
        sunClip.copy(camera.position).addScaledVector(sunDirection, 10000).project(camera);
        composite.uniforms.uSunScreen.value.set(
          sunClip.x * 0.5 + 0.5,
          sunClip.y * 0.5 + 0.5,
          clamp((sunFacing - 0.08) * 1.45, 0, 1)
        );
      } else {
        composite.uniforms.uSunScreen.value.set(0.5, 0.5, 0);
      }

      // Project most dramatic recent explosion for optical shockwave refraction ring.
      let shockX = 0.5, shockY = 0.5, shockRad = 0, shockStr = 0;
      const exList = Array.isArray(state.explosions) ? state.explosions : [];
      for (let i = 0; i < exList.length; i++) {
        const ex = exList[i];
        const age = Number(ex.age) || 0;
        if (age <= 0 || age > 0.65) continue;
        blastClip.set(-ex.x, ex.y, ex.z).project(camera);
        if (blastClip.z < 1 && Math.abs(blastClip.x) < 1.35 && Math.abs(blastClip.y) < 1.35) {
          const dist = Math.hypot(ex.x - state.player.x, ex.y - state.player.y, ex.z - state.player.z);
          const prox = clamp(2400 / Math.max(400, dist), 0.2, 1.25);
          const strength = Math.pow(1 - age / 0.65, 1.5) * prox;
          if (strength > shockStr) {
            shockStr = strength;
            shockX = blastClip.x * 0.5 + 0.5;
            shockY = blastClip.y * 0.5 + 0.5;
            shockRad = 0.02 + Math.pow(age / 0.65, 0.72) * (0.28 + prox * 0.18);
          }
        }
      }
      composite.uniforms.uShockwave.value.set(shockX, shockY, shockRad, clamp(shockStr, 0, 1));
      composite.uniforms.uAspect.value = width / Math.max(1, height);
      composite.uniforms.uClip.value.set(camera.near, camera.far);
      composite.uniforms.uQuality.value = quality === 'low' ? 0 : 1;
      composite.uniforms.uDamage.value = clamp(state.damageFlash || 0, 0, 1);
      composite.uniforms.uGForce.value = state.player.gForce ?? 1;
      composite.uniforms.uBoost.value = clamp(state.boost || 0, 0, 1);
      composite.uniforms.uBlast.value = clamp(state.screenFlash || 0, 0, 1);
      draw(composite, null);
      return { calls, triangles };
    }

    return { render, plumeLayer, depthTexture: world.depthTexture };
  }


  window.WorldPostFX = {
    buildEquirectangularHDRI,
    buildPBRMaps,
    createPostPipeline
  };
})();
