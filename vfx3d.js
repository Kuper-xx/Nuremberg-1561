/* Depth-tested atmosphere, fire, and debris for the WebGL renderer. */
(() => {
  'use strict';

  const clamp = (n, a, b) => (n < a ? a : n > b ? b : n);
  const turbulenceMaps = new WeakMap();

  const fract = n => n - Math.floor(n);
  const smooth = n => n * n * (3 - 2 * n);

  function hash(x, y, salt) {
    const n = Math.imul(x + salt * 7, 1597334677) ^ Math.imul(y - salt * 13, 3812015801);
    return (Math.imul(n ^ (n >>> 16), 2246822519) >>> 0) / 4294967296;
  }

  // The repeating LUT packs three scales of turbulence into one RGBA sample.
  function buildTurbulence(T) {
    const cached = turbulenceMaps.get(T);
    if (cached) return cached;
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    const periods = [5, 11, 27];
    for (let channel = 0; channel < periods.length; channel++) {
      const period = periods[channel];
      const cells = new Float32Array(period * period);
      for (let y = 0; y < period; y++) {
        for (let x = 0; x < period; x++) cells[y * period + x] = hash(x, y, channel + 6);
      }
      for (let y = 0; y < size; y++) {
        const sy = y * period / size;
        const row = Math.floor(sy) * period;
        const nextRow = (Math.floor(sy + 1) % period) * period;
        const fy = smooth(fract(sy));
        for (let x = 0; x < size; x++) {
          const sx = x * period / size;
          const col = Math.floor(sx);
          const nextCol = (col + 1) % period;
          const fx = smooth(fract(sx));
          const a = cells[row + col] * (1 - fx) + cells[row + nextCol] * fx;
          const b = cells[nextRow + col] * (1 - fx) + cells[nextRow + nextCol] * fx;
          const pixel = (y * size + x) * 4;
          data[pixel + channel] = Math.round(255 * (a * (1 - fy) + b * fy));
          data[pixel + 3] = 255;
        }
      }
    }
    const map = new T.DataTexture(data, size, size);
    map.wrapS = map.wrapT = T.RepeatWrapping;
    map.generateMipmaps = true;
    map.minFilter = T.LinearMipmapLinearFilter;
    map.magFilter = T.LinearFilter;
    map.needsUpdate = true;
    turbulenceMaps.set(T, map);
    return map;
  }

  function createPlumeMaterial(T, lightDirection, sceneDepth) {
    const worldLight = lightDirection || new T.Vector3(-0.49, 0.30, 0.82);
    return new T.ShaderMaterial({
      uniforms: {
        ...T.UniformsUtils.clone(T.UniformsLib.fog),
        turbulence: { value: buildTurbulence(T) },
        sceneDepth: { value: sceneDepth },
        // The world root reflects the game X axis before Three's view transform.
        sunDirection: { value: new T.Vector3(-worldLight.x, worldLight.y, worldLight.z).normalize() }
      },
      fog: !sceneDepth,
      transparent: true,
      depthTest: !sceneDepth,
      depthWrite: false,
      side: T.DoubleSide,
      forceSinglePass: true,
      vertexShader: `
        #include <fog_pars_vertex>
        uniform vec3 sunDirection;
        attribute vec4 particleDetail;
        varying vec4 vDetail;
        varying vec2 vUv;
        varying vec3 vLight;
        varying vec3 vWorld;
        void main() {
          mat4 instanceWorld = modelMatrix * instanceMatrix;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vUv = uv;
          vWorld = (instanceWorld * vec4(position, 1.0)).xyz;
          vDetail = particleDetail;
          vLight = vec3(dot(sunDirection, normalize(instanceWorld[0].xyz)),
                        dot(sunDirection, normalize(instanceWorld[1].xyz)),
                        dot(sunDirection, normalize(instanceWorld[2].xyz)));
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <fog_pars_fragment>
        uniform sampler2D turbulence;
        uniform vec3 sunDirection;
        varying vec4 vDetail;
        varying vec2 vUv;
        varying vec3 vLight;
        varying vec3 vWorld;
        ${sceneDepth ? 'uniform sampler2D sceneDepth;' : ''}
        void main() {
          ${sceneDepth ? `
            vec2 screenUv = gl_FragCoord.xy / vec2(textureSize(sceneDepth, 0));
            float solidDepth = texture2D(sceneDepth, screenUv).x;
            if (gl_FragCoord.z > solidDepth + 0.00000015) discard;
          ` : ''}
          vec2 uv = vUv * 2.0 - 1.0;
          if (dot(uv, uv) > 0.985) discard;
          float phase = vDetail.y;
          float heat = max(0.0, vDetail.w);
          vec2 seed = vec2(vDetail.x, fract(vDetail.x * 13.83));
          vec2 sampleUv = uv * 0.33 + seed - vec2(0.043, 0.145) * phase;
          vec3 flow = texture2D(turbulence, sampleUv).rgb;
          vec2 p = uv + (flow.rg - 0.5) * 0.38;
          vec3 folds = texture2D(turbulence, sampleUv + (flow.gb - 0.5) * 0.09).rgb;
          float envelope = 1.0 - length(p);
          float density = envelope + dot(folds - 0.54, vec3(0.64, 0.31, 0.18));
          float feather = smoothstep(0.0, 0.29, 1.0 - length(uv));
          float alpha = smoothstep(0.02, 0.59, density) * feather * vDetail.z;
          if (alpha < 0.006) discard;

          vec3 bulbNormal = normalize(vec3(p, sqrt(max(0.038, 1.0 - dot(p, p)))));
          float sideLight = dot(bulbNormal, vLight) + (folds.r - 0.5) * 0.78;
          float light = smoothstep(-0.62, 1.02, sideLight);
          vec3 color = mix(vec3(0.009, 0.011, 0.014), vec3(0.090, 0.078, 0.064), light);
          if (vDetail.w < 0.0) {
            color = mix(vec3(0.24, 0.28, 0.32), vec3(0.68, 0.73, 0.75), light);
          } else if (heat > 0.0) {
            float fuel = density + (folds.g - 0.56) * 0.74 - max(0.0, uv.y) * 0.19;
            float embers = smoothstep(0.14, 0.73, fuel) * min(1.0, heat);
            float whiteHeat = smoothstep(0.66, 1.35, fuel * heat);
            vec3 flame = mix(vec3(1.32, 0.165, 0.022), vec3(4.2, 2.37, 0.78), whiteHeat);
            color = mix(color * vec3(1.5, 0.78, 0.64), flame, embers);
          }
          ${sceneDepth ? `
            vec3 toward = vWorld - cameraPosition;
            float distance = length(toward);
            float elevation = max(0.0, (vWorld.y + cameraPosition.y) * 0.5);
            float air = exp(-max(0.0, distance - 25.0) * (0.000016 + 0.000205 * exp(-elevation / 310.0)));
            float sun = pow(max(0.0, dot(toward / max(1.0, distance), sunDirection)), 6.0);
            color = mix(mix(vec3(0.22, 0.28, 0.34), vec3(0.38, 0.31, 0.30), sun), color, air);
          ` : ''}
          gl_FragColor = vec4(color, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `
    });
  }


  function enhanceRiverWater(T, riverGeo, riverMat) {
    if (!T || !riverGeo || !riverMat) return { update() {} };

    const time = { value: 0 };
    const turbulence = buildTurbulence(T);
    riverMat.color.setHex(0x1b2c31);
    riverMat.metalness = 0.22;
    riverMat.roughness = 0.22;
    riverMat.envMapIntensity = 1.38;
    riverMat.bumpMap = null;
    riverMat.normalMap = null;
    riverMat.roughnessMap = null;

    riverMat.onBeforeCompile = shader => {
      shader.uniforms.riverTime = time;
      shader.uniforms.riverTurbulence = { value: turbulence };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vStreamPosition;')
        .replace('#include <worldpos_vertex>', `
          #include <worldpos_vertex>
          vStreamPosition = (modelMatrix * vec4(transformed, 1.0)).xz;
        `);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `
          #include <common>
          uniform float riverTime;
          uniform sampler2D riverTurbulence;
          varying vec2 vStreamPosition;
        `)
        .replace('#include <roughnessmap_fragment>', `
          #include <roughnessmap_fragment>
          vec2 stream = vStreamPosition * vec2(0.016, 0.018);
          vec2 current = vec2(-0.022, 0.044) * riverTime;
          vec3 flow = texture2D(riverTurbulence, stream * 0.31 - current * 0.34).rgb;
          vec2 warp = (flow.rg - 0.5) * 0.24;
          vec3 ripple = texture2D(riverTurbulence, stream + warp - current).rgb;
          vec3 micro = texture2D(riverTurbulence, stream * 2.3 - warp + current * 1.4).rgb;
          diffuseColor.rgb *= 0.68 + 0.52 * flow.r + 0.16 * (ripple.r - 0.5);
          // Subtle warm fire-glint on water ripples inside Nuremberg city stretch.
          float cityBand = smoothstep(500.0, 1200.0, vStreamPosition.y) * (1.0 - smoothstep(2800.0, 3600.0, vStreamPosition.y));
          diffuseColor.rgb += vec3(0.24, 0.09, 0.025) * cityBand * pow(max(0.0, micro.r), 3.0) * 0.65;
          roughnessFactor = mix(0.11, 0.30, flow.g * 0.7 + micro.g * 0.3);
        `)
        .replace('#include <normal_fragment_maps>', `
          #include <normal_fragment_maps>
          vec2 slope = (ripple.rg - 0.5) * vec2(0.24, 0.34) + (micro.rg - 0.5) * 0.14;
          normal = normalize(normal + mat3(viewMatrix) * vec3(slope.x, 0.0, slope.y));
        `);
    };
    riverMat.needsUpdate = true;

    return {
      update(t) {
        time.value = t;
      }
    };
  }

  function initInstancedMesh(T, scene, geo, mat, capacity, opts = {}) {
    const mesh = new T.InstancedMesh(geo, mat, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    if (opts.renderOrder !== undefined) mesh.renderOrder = opts.renderOrder;
    if (opts.colored) {
      mesh.setColorAt(0, new T.Color(1, 1, 1));
      mesh.instanceColor.setUsage(T.DynamicDrawUsage);
    }
    scene.add(mesh);
    return mesh;
  }

  function updateAttribute(attribute, length) {
    if (!attribute || length === 0) return;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, length);
    attribute.needsUpdate = true;
  }

  function flushInstanced(mesh, count, colored) {
    mesh.count = count;
    updateAttribute(mesh.instanceMatrix, count * 16);
    if (colored) updateAttribute(mesh.instanceColor, count * 3);
  }

  function createVFXSystem(T, scene, opts = {}) {
    if (!T || !scene) {
      return {
        update() {},
        getCloudMist() { return 0; },
        addGroundFire() {},
        resetGroundFires() {}
      };
    }

    const playerShotMat = new T.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9,
      depthWrite: false, blending: T.AdditiveBlending
    });
    const playerShotsMesh = initInstancedMesh(
      T, scene, new T.BoxGeometry(0.45, 0.45, 1), playerShotMat, 128, { colored: true, renderOrder: 6 }
    );

    const enemyShotGeo = new T.SphereGeometry(1.7, 8, 6);
    enemyShotGeo.scale(1, 1, 2.4);
    const enemyShotsMesh = initInstancedMesh(
      T, scene, enemyShotGeo, playerShotMat, 128, { colored: true, renderOrder: 6 }
    );
    const sparksMesh = initInstancedMesh(
      T, scene, new T.BoxGeometry(0.45, 0.45, 1), playerShotMat, 256, { colored: true, renderOrder: 7 }
    );

    const debrisMat = new T.MeshStandardMaterial({
      color: 0xffffff, metalness: 0.47, roughness: 0.62
    });
    const debrisMesh = initInstancedMesh(
      T, scene, new T.DodecahedronGeometry(1, 0), debrisMat, 96, { colored: true }
    );

    const trailMat = new T.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.27, depthWrite: false
    });
    const wingmanTrailMesh = initInstancedMesh(
      T, scene, new T.BoxGeometry(1.0, 0.36, 1), trailMat, 32, { colored: true, renderOrder: 4 }
    );

    // Guided AIM-9X missiles (bright rocket plume + body), countermeasure flares,
    // 3D shockwave compression rings and drifting burning embers over Nuremberg.
    const missileGeo = new T.CylinderGeometry(0.55, 0.95, 16, 8);
    missileGeo.rotateX(Math.PI * 0.5);
    const missilesMesh = initInstancedMesh(
      T, scene, missileGeo, playerShotMat, 24, { colored: true, renderOrder: 7 }
    );
    const flareGeo = new T.SphereGeometry(2.1, 8, 6);
    const flaresMesh = initInstancedMesh(
      T, scene, flareGeo, playerShotMat, 64, { colored: true, renderOrder: 7 }
    );
    const shockRingGeo = new T.RingGeometry(0.94, 1.0, 48);
    const shockRingMat = new T.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.20,
      side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending
    });
    const shockRingMesh = initInstancedMesh(
      T, scene, shockRingGeo, shockRingMat, 16, { colored: true, renderOrder: 7 }
    );
    const embersMesh = initInstancedMesh(
      T, scene, new T.BoxGeometry(0.65, 0.28, 0.65), playerShotMat, 96, { colored: true, renderOrder: 6 }
    );
    const emberSeeds = Array.from({ length: 96 }, (_, i) => ({
      rx: hash(i, 1, 91) - 0.5,
      ry: hash(i, 2, 91) - 0.5,
      rz: hash(i, 3, 91) - 0.5,
      spd: 0.4 + hash(i, 4, 91) * 1.1,
      ph: hash(i, 5, 91) * Math.PI * 2,
      sz: 0.55 + hash(i, 6, 91) * 1.3
    }));

    const maxPlumes = 320;
    const quadGeo = new T.PlaneGeometry(1, 1);
    const particleDetail = new T.InstancedBufferAttribute(new Float32Array(maxPlumes * 4), 4);
    particleDetail.setUsage(T.DynamicDrawUsage);
    quadGeo.setAttribute('particleDetail', particleDetail);
    const plumeMesh = initInstancedMesh(
      T, scene, quadGeo, createPlumeMaterial(T, opts.lightDirection, opts.sceneDepth), maxPlumes, { renderOrder: 5 }
    );
    if (opts.sceneDepth) plumeMesh.layers.set(opts.plumeLayer);
    const plumePool = Array.from({ length: maxPlumes }, () => ({}));
    const sortedPlumes = [];
    const groundFires = [];
    const dummy = new T.Object3D();
    const scratchColor = new T.Color();
    const view = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, span: 1 };

    function setView(s, p) {
      view.x = p.x;
      view.y = p.y;
      view.z = p.z;
      const pitch = Number(p.pitch) || 0;
      const yaw = Number(p.yaw) || 0;
      view.fx = Math.cos(pitch) * Math.sin(yaw);
      view.fy = Math.sin(pitch);
      view.fz = Math.cos(pitch) * Math.cos(yaw);
      view.span = Math.hypot(s.w || 1280, s.h || 720) / (2 * (s.focal || 620));
    }

    function putPlume(x, y, z, w, h, opacity, heat, seed, phase, roll) {
      const count = sortedPlumes.length;
      if (count === maxPlumes || opacity < 0.017) return;
      const dx = x - view.x;
      const dy = y - view.y;
      const dz = z - view.z;
      const depth = dx * view.fx + dy * view.fy + dz * view.fz;
      const edge = Math.max(w, h) * 0.72;
      if (depth + edge < 8 || depth - edge > 8000) return;
      const dist2 = dx * dx + dy * dy + dz * dz;
      const side = Math.max(0, depth) * view.span + edge * (1 + view.span);
      if (dist2 - depth * depth > side * side) return;
      const nearFade = clamp((Math.sqrt(dist2) - edge * 0.33) / (edge * 0.8 + 14), 0, 1);
      if (nearFade < 0.025) return;

      const plume = plumePool[count];
      plume.x = x;
      plume.y = y;
      plume.z = z;
      plume.w = w;
      plume.h = h;
      plume.opacity = opacity * nearFade;
      plume.heat = heat;
      plume.seed = seed;
      plume.phase = phase;
      plume.roll = roll;
      plume.depth = depth;
      sortedPlumes.push(plume);
    }

    function flushPlumes() {
      sortedPlumes.sort((a, b) => b.depth - a.depth);
      for (let i = 0; i < sortedPlumes.length; i++) {
        const puff = sortedPlumes[i];
        dummy.position.set(puff.x, puff.y, puff.z);
        dummy.lookAt(view.x, view.y, view.z);
        dummy.rotateZ(puff.roll);
        dummy.scale.set(puff.w, puff.h, 1);
        dummy.updateMatrix();
        plumeMesh.setMatrixAt(i, dummy.matrix);
        particleDetail.setXYZW(i, puff.seed, puff.phase, puff.opacity, puff.heat);
      }
      const count = sortedPlumes.length;
      updateAttribute(particleDetail, count * 4);
      flushInstanced(plumeMesh, count);
      sortedPlumes.length = 0;
    }

    function updateExplosionLight(explosions, p) {
      const light = opts.explosionLight;
      if (!light) return;
      let brightest = null;
      let strength = 0;
      let score = 0;
      for (const ex of explosions) {
        const pulse = Math.max(0, 1 - (ex.age || 0) / 0.5);
        const intensity = (ex.radius || 100) ** 2 * pulse * pulse * 0.33;
        const dist = Math.hypot(ex.x - p.x, ex.y - p.y, ex.z - p.z);
        const visibleIntensity = intensity / (300 + dist);
        if (visibleIntensity > score) {
          score = visibleIntensity;
          brightest = ex;
          strength = intensity;
        }
      }
      light.intensity = strength;
      if (brightest) light.position.set(brightest.x, brightest.y, brightest.z);
    }

    function updateCapitalThrusters(t) {
      const m = opts.enemyMats;
      if (!m) return;
      const supply = 0.985 + 0.025 * Math.sin(t * 5.2);
      for (const material of [m.engineGlow, m.plasmaCore, m.afterburner, m.allyBurner]) {
        const rest = material?.userData.restRadiance;
        if (rest) material.color.copy(rest).multiplyScalar(supply);
      }
    }

    function updateShots(s, p, t) {
      const pShots = Array.isArray(s.playerShots) ? s.playerShots : [];
      let pCount = 0;
      for (let i = 0; i < pShots.length && pCount < 128; i++) {
        const sh = pShots[i];
        const vx = sh.vx || 0, vy = sh.vy || 0, vz = sh.vz || 1;
        const speed = Math.hypot(vx, vy, vz) || 1;
        const dist = Math.hypot(sh.x - p.x, sh.y - p.y, sh.z - p.z);
        const streakLen = clamp(speed * 0.014, 12, 45);
        const thickness = clamp(dist * 0.0016, 0.64, 2.65);

        dummy.position.set(sh.x, sh.y, sh.z);
        dummy.lookAt(sh.x + vx, sh.y + vy, sh.z + vz);
        dummy.scale.set(thickness, thickness, streakLen);
        dummy.updateMatrix();
        playerShotsMesh.setMatrixAt(pCount, dummy.matrix);
        scratchColor.setRGB(3.5, 2.53, 1.26);
        playerShotsMesh.setColorAt(pCount, scratchColor);
        pCount++;
      }
      flushInstanced(playerShotsMesh, pCount, true);

      const eShots = Array.isArray(s.shots) ? s.shots : [];
      let eCount = 0;
      for (let i = 0; i < eShots.length && eCount < 128; i++) {
        const sh = eShots[i];
        const vx = sh.vx || 0, vy = sh.vy || 0, vz = sh.vz || 1;
        const dist = Math.hypot(sh.x - p.x, sh.y - p.y, sh.z - p.z);
        const radius = clamp(1.05 + dist * 0.00055, 1.0, 2.6) * (0.94 + 0.1 * Math.sin(t * 28 + i));

        dummy.position.set(sh.x, sh.y, sh.z);
        dummy.lookAt(sh.x + vx, sh.y + vy, sh.z + vz);
        dummy.scale.set(radius, radius, radius * 1.45);
        dummy.updateMatrix();
        enemyShotsMesh.setMatrixAt(eCount, dummy.matrix);
        scratchColor.setRGB(3.2, 1.16, 0.30);
        enemyShotsMesh.setColorAt(eCount, scratchColor);
        eCount++;
      }
      flushInstanced(enemyShotsMesh, eCount, true);
    }

    function updateWingmanTrail(s) {
      const trail = Array.isArray(s.wingmanTrail) ? s.wingmanTrail : [];
      let count = 0;
      for (let i = 1; i < trail.length && count < 32; i++) {
        const a = trail[i - 1], b = trail[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        if (len < 0.5) continue;
        const frac = i / trail.length;
        dummy.position.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
        dummy.lookAt(b.x, b.y, b.z);
        dummy.scale.set(1.4 + (1 - frac) * 2.2, 1.0, len * 1.05);
        dummy.updateMatrix();
        wingmanTrailMesh.setMatrixAt(count, dummy.matrix);
        const glow = 0.35 + frac * 0.85;
        scratchColor.setRGB(glow * 0.88, glow * 0.94, glow);
        wingmanTrailMesh.setColorAt(count, scratchColor);
        count++;
      }
      flushInstanced(wingmanTrailMesh, count, true);
    }


    function updateExplosions(explosions) {
      for (const ex of explosions) {
        const age = ex.age || 0;
        const progress = clamp(age / Math.max(0.1, ex.maxAge || 3), 0, 1);
        const radius = Math.max(25, ex.radius || 120);
        const seed = hash(Math.floor(ex.x), Math.floor(ex.z), 37);

        // Short flash through the fuel, then separate hot rolls inside the expanding soot.
        const flash = clamp(1 - age / 0.38, 0, 1);
        const flashSize = radius * (0.67 + Math.min(0.4, age) * 1.4);
        putPlume(ex.x, ex.y + flashSize * 0.13, ex.z, flashSize, flashSize,
          flash * 0.97, 0.8 + flash * 2.2, seed, age * 4, ex.flareTilt || 0);

        const lobes = Array.isArray(ex.lobes) ? ex.lobes : [];
        for (let i = 0; i < lobes.length; i++) {
          const lobe = lobes[i];
          const local = (progress - (lobe.delay || 0) * 0.43) / (1 - (lobe.delay || 0) * 0.43);
          if (local < 0 || local >= 1) continue;

          const spread = radius * (0.10 + Math.pow(local, 0.69) * (lobe.dist || 1) * 0.69);
          const angle = (lobe.ang || 0) + seed * Math.PI * 2;
          const puffSeed = hash(i, Math.floor(seed * 128), 41);
          const directionY = (puffSeed - 0.32) * 0.75;
          const size = radius * (lobe.size || 0.7) * (0.71 + Math.sqrt(local) * 1.48);
          const x = ex.x + Math.cos(angle) * spread + radius * local * 0.36;
          const y = Math.max(7, ex.y + directionY * spread + radius * local * 0.94);
          const z = ex.z + Math.sin(angle) * spread + radius * local * 0.20;
          const fuel = Math.max(0, 1 - local * 4.8);
          const density = Math.min(1, 0.42 + local * 7) * (1 - smooth(local));
          putPlume(x, y, z, size * 1.07, size * 1.19, density * 0.86,
            fuel * (0.95 + puffSeed * 0.84), puffSeed, local * 2.8, (puffSeed - 0.5) * 1.2 + local * 0.72);
        }

        const secondaries = Array.isArray(ex.secondaries) ? ex.secondaries : [];
        for (let i = 0; i < secondaries.length; i++) {
          const sec = secondaries[i];
          const phase = (age - (sec.delay || 0)) / 0.72;
          if (phase <= 0 || phase >= 1) continue;
          const sx = (sec.ox || 0) * radius * 0.56;
          const sy = (sec.oy || 0) * radius * 0.56;
          const size = radius * (sec.size || 0.6) * (0.64 + phase * 1.24);
          putPlume(ex.x + sx, Math.max(6, ex.y + sy + phase * size * 0.33), ex.z + sx * (seed - 0.5),
            size, size * 1.13, 0.86 * Math.sin(Math.PI * phase), (1 - phase) * 2.2,
            hash(i, Math.floor(seed * 128), 7), phase * 2, seed - 0.5);
        }
      }
    }

    function updateParticles(s, t) {
      const particles = Array.isArray(s.particles) ? s.particles : [];
      let sparkCount = 0;
      let debrisCount = 0;

      for (const pt of particles) {
        const lifeRatio = clamp((pt.life || 0) / Math.max(0.01, pt.max || 1), 0, 1);
        if (lifeRatio <= 0) continue;

        if (pt.kind === 'spark') {
          if (sparkCount >= 256) continue;
          const px = pt.px ?? pt.x;
          const py = pt.py ?? pt.y;
          const pz = pt.pz ?? pt.z;
          const segLen = Math.max(2.1, Math.hypot(pt.x - px, pt.y - py, pt.z - pz));
          const w = clamp((pt.size || 6) * 0.14, 0.42, 1.95);
          dummy.position.set((pt.x + px) * 0.5, (pt.y + py) * 0.5, (pt.z + pz) * 0.5);
          dummy.lookAt(pt.x + (pt.vx || 0.01), pt.y + (pt.vy || 0), pt.z + (pt.vz || 0));
          dummy.scale.set(w, w, segLen);
          dummy.updateMatrix();
          sparksMesh.setMatrixAt(sparkCount, dummy.matrix);
          scratchColor.setRGB(2.7 * lifeRatio, 1.34 * lifeRatio, 0.38 * lifeRatio * lifeRatio);
          sparksMesh.setColorAt(sparkCount++, scratchColor);
        } else if (pt.kind === 'debris') {
          if (debrisCount >= 96) continue;
          const size = clamp((pt.size || 10) * 0.48, 2.2, 11);
          dummy.position.set(pt.x, pt.y, pt.z);
          dummy.rotation.set((pt.spin || 0) + t * (pt.spinSpeed || 0), (pt.spin || 0) * 0.6, t * 2.1);
          dummy.scale.set(size * 1.25, size * 0.42, size * 0.85);
          dummy.updateMatrix();
          debrisMesh.setMatrixAt(debrisCount, dummy.matrix);
          const heat = lifeRatio * lifeRatio;
          scratchColor.setRGB(0.17 + heat * 1.35, 0.14 + heat * 0.51, 0.13 + heat * 0.13);
          debrisMesh.setColorAt(debrisCount++, scratchColor);
        } else if (sortedPlumes.length < 160) {
          const fire = pt.kind === 'fire';
          const age = 1 - lifeRatio;
          const size = (pt.size || 30) * (pt.grow ? 0.75 + age * 1.18 : 1.14);
          const seed = fract((pt.size || 30) * 0.61803399);
          const opacity = (pt.alpha || 0.62) * smooth(lifeRatio) * (fire ? 0.9 : 0.73);
          putPlume(pt.x, pt.y, pt.z, size, size * 1.22, opacity, fire ? 1.36 * lifeRatio : 0,
            seed, age * 2.4, seed - 0.5 + age * 0.7);
        }
      }

      flushInstanced(sparksMesh, sparkCount, true);
      flushInstanced(debrisMesh, debrisCount, true);
    }

    function updateWreckFires(wrecks, t) {
      for (const wr of wrecks) {
        const radius = wr.size || 72;
        const seed = fract(radius * 0.61803399);
        const flicker = Math.sin(t * 17 + seed * 38) * Math.sin(t * 7.5 + seed * 34);
        const scale = radius * (1.25 + flicker * 0.26);
        putPlume(wr.x, wr.y + radius * 0.07, wr.z, scale, scale * 1.11,
          0.78, 1.48 + flicker * 0.44, seed, t * 2, wr.bank || 0);
      }
    }

    function addGroundFire(x, y, z, size = 65, persistent = false) {
      if (groundFires.length >= 28) {
        const oldestImpact = groundFires.findIndex(fire => !fire.persistent);
        if (oldestImpact < 0) return;
        groundFires.splice(oldestImpact, 1);
      }
      const seed = hash(Math.floor(x), Math.floor(z), 23);
      groundFires.push({ x, y, z, size, seed, persistent });
    }

    function resetGroundFires() {
      for (let i = groundFires.length - 1; i >= 0; i--) {
        if (!groundFires[i].persistent) groundFires.splice(i, 1);
      }
    }

    function updateGroundFires(t) {
      for (const fire of groundFires) {
        const dist = Math.hypot(fire.x - view.x, fire.y - view.y, fire.z - view.z);
        if (dist > 7400) continue;
        const size = fire.size;
        const curl = fire.seed * Math.PI * 2;
        const puffCount = 11;
        const midFade = smooth(clamp((5350 - dist) / 1700, 0, 1));
        const nearFade = smooth(clamp((2750 - dist) / 1150, 0, 1));
        for (let i = 0; i < puffCount; i++) {
          const detail = i < 5 ? 1 : i < 8 ? midFade : nearFade;
          if (detail < 0.03) continue;
          const seed = hash(i, Math.floor(fire.seed * 1024), 81);
          const age = fract(((i * 5) % puffCount) / puffCount + t * 0.14 + fire.seed);
          const growth = Math.pow(age, 1.35);
          const sway = Math.sin(curl + age * 7.3 + t * 0.79);
          const lift = age * (148 + size * 3.4);
          const width = size * (0.82 + growth * (2.7 + seed * 1.14));
          const opacity = smooth(clamp(age * 16, 0, 1)) * (1 - smooth(age * 0.95)) * 0.96 * detail;
          putPlume(
            fire.x + lift * 0.54 * age + sway * size * age * 0.46,
            fire.y + size * 0.28 + lift, fire.z + lift * 0.32 * age + Math.cos(curl + age * 8.3) * size * age * 0.4,
            width, width * (1.42 + seed * 0.25), opacity, 0, seed, age * 3.8, sway * age * 0.68
          );
        }

        for (const side of [-1, 1]) {
          const flicker = Math.sin(t * 11 + curl * side) * Math.sin(t * 5.3 + curl);
          putPlume(fire.x + side * size * 0.16, fire.y + size * (0.24 + flicker * 0.066), fire.z,
            size * 0.70, size * (1 + flicker * 0.23), 0.93, 1.52 + flicker * 0.49,
            fract(fire.seed + side * 0.36), t * 2.4, side * 0.22);
        }
      }
    }

    function updateMissilesAndFlares(s, p, t) {
      const missiles = Array.isArray(s.missiles) ? s.missiles : [];
      let mCount = 0;
      for (let i = 0; i < missiles.length && mCount < 24; i++) {
        const ms = missiles[i];
        const vx = ms.vx || 0, vy = ms.vy || 0, vz = ms.vz || 1;
        const dist = Math.hypot(ms.x - p.x, ms.y - p.y, ms.z - p.z);
        const scale = clamp(1.0 + dist * 0.00055, 1.0, 2.8);
        dummy.position.set(ms.x, ms.y, ms.z);
        dummy.lookAt(ms.x + vx, ms.y + vy, ms.z + vz);
        dummy.scale.set(scale, scale, scale * 1.4);
        dummy.updateMatrix();
        missilesMesh.setMatrixAt(mCount, dummy.matrix);
        scratchColor.setRGB(5.2, 3.1, 1.35);
        missilesMesh.setColorAt(mCount++, scratchColor);

        // Dense white rocket smoke trail behind active AIM-9X.
        const trail = Array.isArray(ms.trail) ? ms.trail : [];
        for (let k = 0; k < trail.length; k++) {
          const tp = trail[k];
          const frac = (k + 1) / Math.max(1, trail.length);
          const age = 1 - frac;
          const sz = 14 + age * 36;
          putPlume(tp.x, tp.y, tp.z, sz, sz, (0.22 + frac * 0.42), frac > 0.86 ? 1.8 : -1,
            hash(i, k, 53), age * 2.2, (k * 0.7) % 6.28);
        }
      }
      flushInstanced(missilesMesh, mCount, true);

      const flares = Array.isArray(s.flares) ? s.flares : [];
      let fCount = 0;
      for (let i = 0; i < flares.length && fCount < 64; i++) {
        const fl = flares[i];
        const life = clamp((fl.life || 0) / Math.max(0.1, fl.max || 2.2), 0, 1);
        const pulse = 0.85 + 0.3 * Math.sin(t * 36 + i * 2.1);
        const r = (1.1 + life * 1.4) * pulse;
        dummy.position.set(fl.x, fl.y, fl.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(r, r, r);
        dummy.updateMatrix();
        flaresMesh.setMatrixAt(fCount, dummy.matrix);
        scratchColor.setRGB(6.2 * life, 4.3 * life, 1.9 * life);
        flaresMesh.setColorAt(fCount++, scratchColor);

        // White countermeasure smoke puff.
        if (life > 0.08) {
          putPlume(fl.x, fl.y, fl.z, 18 + (1 - life) * 28, 18 + (1 - life) * 28,
            life * 0.52, -1, hash(i, 7, 67), (1 - life) * 2.4, i * 0.5);
        }
      }
      flushInstanced(flaresMesh, fCount, true);
    }

    function updateShockRings(explosions) {
      let count = 0;
      for (let i = 0; i < explosions.length && count < 16; i++) {
        const ex = explosions[i];
        const age = Number(ex.age) || 0;
        if (age <= 0 || age > 0.52) continue;
        const frac = age / 0.52;
        const rad = (ex.radius || 120) * (0.42 + Math.pow(frac, 0.65) * 2.5);
        const fade = Math.pow(1 - frac, 2.0);
        dummy.position.set(ex.x, ex.y, ex.z);
        dummy.lookAt(view.x, view.y, view.z);
        dummy.scale.set(rad, rad, 1);
        dummy.updateMatrix();
        shockRingMesh.setMatrixAt(count, dummy.matrix);
        scratchColor.setRGB(1.55 * fade, 1.08 * fade, 0.65 * fade);
        shockRingMesh.setColorAt(count++, scratchColor);
      }
      flushInstanced(shockRingMesh, count, true);
    }

    function updateEmbers(p, t) {
      // Drifting hot embers & ash particles in the air when flying over burning Nuremberg.
      const altFade = clamp((580 - (p.y || 200)) / 380, 0, 1);
      if (altFade <= 0.02) {
        flushInstanced(embersMesh, 0, true);
        return;
      }
      const span = 520;
      let count = 0;
      for (let i = 0; i < emberSeeds.length; i++) {
        const e = emberSeeds[i];
        const wx = ((p.x + e.rx * span + t * 24 * e.spd) % span + span) % span - span * 0.5 + p.x;
        const wz = ((p.z + e.rz * span + t * 14 * e.spd) % span + span) % span - span * 0.5 + p.z;
        const wy = Math.max(12, p.y + e.ry * 220 + Math.sin(t * 1.4 * e.spd + e.ph) * 28);
        const flicker = 0.55 + 0.45 * Math.sin(t * 9.5 + e.ph * 3.1);
        dummy.position.set(wx, wy, wz);
        dummy.rotation.set(t * 2.1 + e.ph, t * 1.6, e.ph);
        dummy.scale.setScalar(e.sz);
        dummy.updateMatrix();
        embersMesh.setMatrixAt(count, dummy.matrix);
        scratchColor.setRGB(3.6 * altFade * flicker, 1.25 * altFade * flicker, 0.25 * altFade * flicker);
        embersMesh.setColorAt(count++, scratchColor);
      }
      flushInstanced(embersMesh, count, true);
    }

    function updateValleyMist(t) {
      const startZ = Math.floor((view.z - 1200) / 570) * 570;
      for (let i = 0; i < 16; i++) {
        const z = startZ + i * 570;
        const seed = hash(11, Math.round(z), 78);
        const x = 170 * Math.sin(z * 0.0018) + Math.sin(t * 0.09 + seed * 24) * 45;
        putPlume(x, 17 + seed * 17, z, 380 + seed * 390, 58 + seed * 46,
          0.095 + seed * 0.055, -1, seed, t * 0.08, 0);
      }
    }

    return {
      update(s, timeSec) {
        if (!s || !s.player) return;
        const p = s.player;
        const t = Number(timeSec) || 0;
        const explosions = Array.isArray(s.explosions) ? s.explosions : [];
        const wrecks = Array.isArray(s.wrecks) ? s.wrecks : [];
        setView(s, p);
        updateExplosionLight(explosions, p);
        updateCapitalThrusters(t);
        updateShots(s, p, t);
        updateMissilesAndFlares(s, p, t);
        updateShockRings(explosions);
        updateEmbers(p, t);
        updateWingmanTrail(s);
        updateExplosions(explosions);
        updateWreckFires(wrecks, t);
        updateParticles(s, t);
        updateGroundFires(t);
        updateValleyMist(t);
        flushPlumes();
      },
      getCloudMist() { return 0; },
      addGroundFire,
      resetGroundFires
    };
  }

  const api = {
    enhanceRiverWater,
    createVFXSystem
  };
  if (typeof window !== 'undefined') window.VFX3D = api;
  if (typeof globalThis !== 'undefined') globalThis.VFX3D = api;
})();
