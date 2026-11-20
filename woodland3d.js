/* Canopy views are baked from the same branched crowns at four elevations. */
(() => {
  'use strict';

  function buildWoodland(T, scene, groundY, riverX, courtyardTrees = []) {
    let seed = 15291;
    function random() {
      seed = seed * 16807 % 2147483647;
      return seed / 2147483647;
    }

    // Blend neighbouring elevations so a stand has a crown from above and
    // visible stems from the valley. Each tree still costs two triangles.
    function crownShader(shader) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 crown;
          varying vec3 vCrown;`)
        .replace('#include <project_vertex>', `
          vec4 center = modelViewMatrix * instanceMatrix[3];
          vec3 eye = isPerspectiveMatrix(projectionMatrix) ? -center.xyz : vec3(0., 0., 1.);
          vec3 facing = normalize(eye * mat3(modelViewMatrix));
          vec3 right = normalize(vec3(facing.z + 0.00001, 0., -facing.x));
          vec3 up = cross(facing, right);
          float size = instanceMatrix[1][1];
          vCrown = vec3(asin(clamp(facing.y, 0., 1.)) * 1.9098593, crown);
          vec4 mvPosition = center + modelViewMatrix * vec4(size * (right * position.x + up * position.y), 0.);
          gl_Position = projectionMatrix * mvPosition;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCrown;')
        .replace('#include <map_fragment>', `
          float frame = floor(vCrown.x);
          vec2 cell = vec2(mix(vMapUv.x, 1.0-vMapUv.x, vCrown.z), vMapUv.y);
          vec2 uv = (vec2(frame, 3.-vCrown.y) + cell) * .25;
          vec4 a = texture2D(map, uv);
          vec4 b = texture2D(map, uv + vec2(frame < 3. ? .25 : 0., 0.));
          diffuseColor *= mix(a, b, fract(vCrown.x));`);
    }

    const cells = new Map();
    function plant(x, z, height, species) {
      if (Math.abs(x - riverX(z)) < 73) return;
      const key = Math.floor(x / 2400) + ',' + Math.floor(z / 2400);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push({ x, z, height, species });
    }

    for (let grove = 0; grove < 145; grove++) {
      const cx = (grove % 2 ? 1 : -1) * (1940 + random() ** 1.45 * 9600);
      const cz = random() * 17300 - 6100;
      const angle = random() * Math.PI;
      const major = 125 + random() * 360, minor = major * (0.22 + random() * 0.55);
      const common = Math.floor(random() * 3);
      const height = 12 + random() * 13;
      const count = Math.ceil(major * minor / 160);
      for (let j = 0; j < count; j++) {
        const a = random() * Math.PI * 2, r = Math.sqrt(random());
        const edge = 0.95 + 0.21 * Math.sin(3 * a + grove) + 0.12 * Math.sin(5 * a);
        const dx = r * edge * Math.cos(a) * major, dz = r * Math.sin(a) * minor;
        const x = cx + dx * Math.cos(angle) - dz * Math.sin(angle);
        const z = cz + dx * Math.sin(angle) + dz * Math.cos(angle);
        if (Math.abs(x) < 1770 && z > -550 && z < 3950) continue;
        plant(x, z, height * (0.65 + random() * 0.7), random() < 0.82 ? common : Math.floor(random() * 4));
      }
    }
    // Narrow, broken belts of alder and willow follow the banks outside town.
    for (let z = -8400; z < 9600; z += 7 + random() * 16) {
      if (z > -570 && z < 4020 || Math.sin(z * 0.0062) + Math.cos(z * 0.0021) < -0.54) continue;
      for (const bank of [-1, 1]) {
        plant(riverX(z) + bank * (78 + random() * 55), z, 9 + random() * 12, 3);
      }
    }

    for (const { x, z, height, species } of courtyardTrees) plant(x, z, height, species);

    new T.TextureLoader().load(window.WoodlandCrowns, atlas => {
      atlas.colorSpace = T.SRGBColorSpace;
      const material = new T.MeshBasicMaterial({ map: atlas, alphaTest: 0.30, side: T.DoubleSide });
      const depth = new T.MeshDepthMaterial({ map: atlas, depthPacking: T.RGBADepthPacking, alphaTest: 0.30, side: T.DoubleSide });
      material.onBeforeCompile = depth.onBeforeCompile = crownShader;
      const matrix = new T.Matrix4(), color = new T.Color();
      for (const plants of cells.values()) {
        const geometry = new T.PlaneGeometry(1, 1);
        const variants = new Float32Array(plants.length * 2);
        geometry.setAttribute('crown', new T.InstancedBufferAttribute(variants, 2));
        const stand = new T.InstancedMesh(geometry, material, plants.length);
        stand.name = 'Franconian woodland';
        let near = false;
        plants.forEach(({ x, z, height, species }, i) => {
          const span = height * 1.23;
          matrix.makeScale(span, span, span).setPosition(x, groundY(x, z) + height * 0.5, z);
          stand.setMatrixAt(i, matrix);
          const tint = 0.70 + random() * 0.36;
          stand.setColorAt(i, color.setRGB(tint, tint, tint * (0.91 + random() * 0.12)));
          variants[2*i] = species;
          variants[2*i+1] = random() < 0.5 ? 0 : 1;
          if (Math.abs(x) < 3600 && Math.abs(z-1600) < 4400) near = true;
        });
        stand.customDepthMaterial = depth;
        stand.castShadow = near;
        scene.add(stand);
      }
    });
  }

  window.Woodland3D = { buildWoodland };
})();
