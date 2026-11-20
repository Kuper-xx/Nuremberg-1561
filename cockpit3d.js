/* Camera-local cockpit mesh, panoramic flight display and canopy glazing.
 * The cockpit transform compensates for the mirrored world coordinates.
 */
(() => {
  'use strict';

  const clamp = (n, a, b) => (n < a ? a : n > b ? b : n);

  function makePart(geo, matKey, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return { geo, matKey, px, py, pz, rx, ry, rz, sx, sy, sz };
  }

  function mergePartsForBucket(T, entries) {
    let totalVerts = 0;
    let totalIndices = 0;
    for (let i = 0; i < entries.length; i++) {
      const pos = entries[i].geo.attributes.position;
      totalVerts += pos.count;
      totalIndices += entries[i].geo.index ? entries[i].geo.index.count : pos.count;
    }

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const indices = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

    const vPos = new T.Vector3();
    const vNorm = new T.Vector3();
    const normMat = new T.Matrix3();
    const m = new T.Matrix4();
    const q = new T.Quaternion();
    const euler = new T.Euler();
    const pVec = new T.Vector3();
    const sVec = new T.Vector3();

    let vOff = 0;
    let iOff = 0;
    for (let e = 0; e < entries.length; e++) {
      const it = entries[e];
      euler.set(it.rx, it.ry, it.rz, 'XYZ');
      q.setFromEuler(euler);
      pVec.set(it.px, it.py, it.pz);
      sVec.set(it.sx, it.sy, it.sz);
      m.compose(pVec, q, sVec);
      normMat.getNormalMatrix(m);

      const pos = it.geo.attributes.position;
      const norm = it.geo.attributes.normal;
      const uv = it.geo.attributes.uv;
      const idx = it.geo.index;

      for (let i = 0; i < pos.count; i++) {
        vPos.fromBufferAttribute(pos, i).applyMatrix4(m);
        const o3 = (vOff + i) * 3;
        positions[o3] = vPos.x;
        positions[o3 + 1] = vPos.y;
        positions[o3 + 2] = vPos.z;

        if (norm) {
          vNorm.fromBufferAttribute(norm, i).applyMatrix3(normMat);
          if (vNorm.lengthSq() > 1e-12) vNorm.normalize();
          else vNorm.set(0, 1, 0);
          normals[o3] = vNorm.x;
          normals[o3 + 1] = vNorm.y;
          normals[o3 + 2] = vNorm.z;
        } else {
          normals[o3 + 2] = 1;
        }

        const o2 = (vOff + i) * 2;
        if (uv) {
          uvs[o2] = uv.getX(i);
          uvs[o2 + 1] = uv.getY(i);
        }
      }

      if (idx) {
        for (let k = 0; k < idx.count; k++) indices[iOff + k] = idx.getX(k) + vOff;
        iOff += idx.count;
      } else {
        for (let k = 0; k < pos.count; k++) indices[iOff + k] = vOff + k;
        iOff += pos.count;
      }
      vOff += pos.count;
    }

    const merged = new T.BufferGeometry();
    merged.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    merged.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    merged.setIndex(new T.BufferAttribute(indices, 1));
    return merged;
  }

  function makeSurface(T, rows) {
    const columns = rows[0].length;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let row = 0; row < rows.length; row++) {
      for (let column = 0; column < columns; column++) {
        positions.push(...rows[row][column]);
        uvs.push(column / (columns - 1), row / (rows.length - 1));
        if (row === 0 || column === 0) continue;
        const right = row * columns + column;
        const left = right - 1;
        indices.push(left, right, right - columns, left, right - columns, left - columns);
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function makeRail(T, points, radius, steps, tipScale = 1) {
    const curve = new T.CatmullRomCurve3(points.map(point => new T.Vector3(...point)));
    const sides = 7;
    const geo = new T.TubeGeometry(curve, steps, radius, sides, false);
    if (tipScale === 1) return geo;
    const pos = geo.attributes.position;
    const center = new T.Vector3();
    const vertex = new T.Vector3();
    for (let step = 0; step <= steps; step++) {
      const progress = step / steps;
      const bend = Math.min(1, progress * 4);
      const width = tipScale + (1 - tipScale) * bend * (2 - bend);
      curve.getPointAt(progress, center);
      for (let side = 0; side <= sides; side++) {
        const index = step * (sides + 1) + side;
        vertex.fromBufferAttribute(pos, index).sub(center).multiplyScalar(width).add(center);
        pos.setXYZ(index, vertex.x, vertex.y, vertex.z);
      }
    }
    return geo;
  }

  // The bow is a pressed channel and a separate rubber seal. Its flat land
  // carries the fasteners; the narrow return faces catch the outside light.
  function bowChannel(T, curve, section) {
    const rows = [];
    for (let i = 0; i <= 72; i++) {
      const center = curve.getPointAt(i / 72);
      const tangent = curve.getTangentAt(i / 72);
      const length = Math.hypot(tangent.x, tangent.y);
      const dx = -tangent.y / length, dy = tangent.x / length;
      rows.push(section.map(([r, z]) => [center.x + dx * r, center.y + dy * r, center.z + z]));
    }
    return makeSurface(T, rows);
  }

  function panelPlate(T, width, height, thickness, corner) {
    const x = width / 2, y = height / 2;
    const outline = new T.Shape();
    outline.moveTo(-x + corner, -y);
    for (const [a, b] of [
      [x - corner, -y], [x, -y + corner], [x, y - corner], [x - corner, y],
      [-x + corner, y], [-x, y - corner], [-x, -y + corner]
    ]) outline.lineTo(a, b);
    outline.closePath();
    return new T.ExtrudeGeometry(outline, {
      depth: thickness, bevelEnabled: true, bevelSegments: 1, steps: 1,
      bevelSize: Math.min(corner * 0.18, 0.005), bevelThickness: 0.004
    });
  }

  function makeFinishMap(T) {
    const size = 256;
    const pixels = new Uint8Array(size * size * 4);
    let seed = 1561;
    const random = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 58 + 154 * random();
      pixels[i + 1] = 114 + 104 * random();
      pixels[i + 3] = 255;
    }
    for (let j = 0; j < 100; j++) {
      const x = random() * size, y = random() * size;
      const length = 2 + Math.floor(13 * random());
      const dx = random() - 0.5, dy = random() - 0.5;
      for (let k = 0; k < length; k++) {
        const i = 4 * (((Math.floor(y + dy * k) + size) % size) * size + (Math.floor(x + dx * k) + size) % size);
        pixels[i + 2] = 52 + 144 * Math.sin(Math.PI * k / length);
      }
    }
    const tex = new T.DataTexture(pixels, size, size, T.RGBAFormat);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = T.LinearMipmapLinearFilter;
    tex.magFilter = T.LinearFilter;
    tex.anisotropy = 2;
    tex.needsUpdate = true;
    return tex;
  }

  function applyCabinFinish(material, map, wear) {
    material.onBeforeCompile = shader => {
      shader.uniforms.cabinFinish = { value: map };
      shader.uniforms.cabinWear = { value: wear };
      shader.vertexShader = 'varying vec3 vCabinPos;\nvarying vec3 vCabinNormal;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vCabinPos = position;
        vCabinNormal = normal;
      `);
      shader.fragmentShader = `
        uniform sampler2D cabinFinish;
        uniform float cabinWear;
        varying vec3 vCabinPos, vCabinNormal;
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        vec3 weight = pow(abs(normalize(vCabinNormal)), vec3(4.0));
        weight /= max(weight.x + weight.y + weight.z, 0.0001);
        vec3 p = vCabinPos * vec3(2.8, 1.6, 0.85);
        vec3 finish = texture2D(cabinFinish, p.yz).rgb * weight.x
                    + texture2D(cabinFinish, p.xz).rgb * weight.y
                    + texture2D(cabinFinish, p.xy).rgb * weight.z;
        diffuseColor.rgb *= 0.63 + finish.r * 0.73;
        diffuseColor.rgb += vec3(0.075, 0.070, 0.062) * finish.b * cabinWear;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + 0.35 * (finish.g - 0.65)
                                - 0.23 * cabinWear * finish.b, 0.18, 1.0);
      `);
    };
  }

  function makePanelPrint(T) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.font = 'bold 21px monospace';
    ctx.fillStyle = '#c4c2ad';
    ctx.fillText('CABIN AIR', 10, 29);
    ctx.fillText('PANEL LT', 270, 29);
    ctx.fillStyle = '#a5a593';
    ctx.font = '16px monospace';
    ctx.fillText('FLOW', 10, 53);
    ctx.fillText('DIM', 270, 53);
    ctx.fillText('VENT', 154, 53);
    ctx.fillText('BRIGHT', 427, 53);
    ctx.strokeStyle = '#9e9d8e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const x of [10, 270]) {
      ctx.moveTo(x, 66); ctx.lineTo(x + 61, 66); ctx.lineTo(x + 67, 73);
      ctx.moveTo(x + 140, 66); ctx.lineTo(x + 225, 66);
    }
    ctx.stroke();
    ctx.fillStyle = '#ad9445';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('CANOPY   LATCH', 10, 110);
    const map = new T.CanvasTexture(canvas);
    map.colorSpace = T.SRGBColorSpace;
    map.anisotropy = 4;
    return new T.MeshStandardMaterial({
      map, transparent: false, alphaTest: 0.30, roughness: 0.85, metalness: 0.03, fog: false
    });
  }

  function makeDisplay(T) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 840;
    canvas.height = 144;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const map = new T.CanvasTexture(canvas);
    map.colorSpace = T.SRGBColorSpace;
    map.anisotropy = 2;
    map.generateMipmaps = false;
    map.minFilter = T.LinearFilter;
    const background = ctx.createLinearGradient(0, 0, 0, canvas.height);
    background.addColorStop(0, '#101e20');
    background.addColorStop(0.34, '#081315');
    background.addColorStop(1, '#030b0d');
    let lastUpdate = -Infinity;

    function readout(label, value, x, y) {
      ctx.fillStyle = '#92aba5';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(label, x, y);
      ctx.fillStyle = '#cae2d9';
      ctx.font = 'bold 23px monospace';
      ctx.fillText(value, x, y + 24);
    }

    function update(s) {
      const t = Number(s.time) || 0;
      if (t >= lastUpdate && t < lastUpdate + 0.10) return;
      lastUpdate = t;

      const p = s.player;
      const heading = (Math.round((Number(p.yaw) || 0) * 180 / Math.PI) % 360 + 360) % 360;
      const roll = Number(p.roll) || 0;
      const pitchY = clamp((Number(p.pitch) || 0) * 98, -54, 54);
      const integrity = clamp(Number(p.health ?? 100), 0, 100);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#415957';
      ctx.lineWidth = 1;
      ctx.strokeRect(5.5, 4.5, 829, 134);
      for (const x of [134, 372, 597]) {
        ctx.beginPath(); ctx.moveTo(x, 5); ctx.lineTo(x, 138); ctx.stroke();
      }
      readout('ALT   M', String(Math.round(Number(p.y) || 0)), 18, 26);
      readout('VEL  KT', String(Math.round((Number(p.speed) || 0) * 1.944)), 18, 95);
      readout('RUMBO', String(heading).padStart(3, '0') + '°', 387, 26);
      readout('CARGA  G', Number(p.gForce ?? 1).toFixed(1), 387, 95);

      ctx.save();
      ctx.beginPath();
      ctx.rect(138, 9, 230, 125);
      ctx.clip();
      ctx.translate(252, 71);
      ctx.rotate(-roll);
      ctx.fillStyle = '#25485b';
      ctx.fillRect(-480, -480, 960, 480 + pitchY);
      ctx.fillStyle = '#48392e';
      ctx.fillRect(-480, pitchY, 960, 480);
      ctx.strokeStyle = '#a2b4ad';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-480, pitchY);
      ctx.lineTo(480, pitchY);
      for (let tick = -2; tick <= 2; tick++) {
        if (tick === 0) continue;
        const span = tick % 2 === 0 ? 47 : 25;
        ctx.moveTo(-span, pitchY + tick * 20);
        ctx.lineTo(span, pitchY + tick * 20);
      }
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = '#d9c291';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(210, 71); ctx.lineTo(244, 71); ctx.lineTo(244, 76);
      ctx.moveTo(294, 71); ctx.lineTo(260, 71); ctx.lineTo(260, 76);
      ctx.stroke();
      ctx.fillStyle = '#d9c291';
      ctx.fillRect(250, 70, 4, 3);
      // Power indication and airframe condition are driven by flight state.
      const power = clamp(Number(p.throttle) || 0, 0, 1);
      const cx = 529, cy = 80, rad = 44;
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#2c4542';
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0.73 * Math.PI, 2.27 * Math.PI); ctx.stroke();
      ctx.strokeStyle = power > 0.9 ? '#d7ac6d' : '#8ab49a';
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0.73 * Math.PI, (0.73 + power * 1.54) * Math.PI); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = '12px monospace'; ctx.fillStyle = '#a8b7aa'; ctx.fillText('POT  %', cx, cy - 4);
      ctx.font = 'bold 22px monospace'; ctx.fillStyle = '#c2d8c7'; ctx.fillText(String(Math.round(power * 100)), cx, cy + 22);
      ctx.textAlign = 'left';
      ctx.fillStyle = integrity < 40 ? '#efae77' : '#8daaa4';
      ctx.font = 'bold 12px monospace'; ctx.fillText('SISTEMA  ' + Math.round(integrity) + '%', 613, 26);
      ctx.fillRect(614, 33, 201 * integrity / 100, 2);
      // AIM-9X & countermeasure flare readouts on the panoramic MFD.
      const misCount = p.missiles ?? 6;
      const flrCount = p.flares ?? 12;
      const locked = Boolean(s.lockReady);
      ctx.fillStyle = locked ? '#ffcf76' : '#84aca2';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('AIM-9X ' + misCount + '  FLR ' + flrCount, 613, 52);
      if (locked) {
        ctx.fillStyle = '#ffae52';
        ctx.fillText('IR LOCK', 762, 52);
      }
      // Moving compass rose and formation positions, both in aircraft coordinates.
      const cos = Math.cos(p.yaw || 0), sin = Math.sin(p.yaw || 0);
      const nx = 713, ny = 119;
      ctx.strokeStyle = '#547374';
      ctx.lineWidth = 1;
      for (const r of [43, 75]) {
        ctx.beginPath(); ctx.arc(nx, ny, r, -0.94 * Math.PI, -0.06 * Math.PI); ctx.stroke();
      }
      for (let i = -3; i <= 3; i++) {
        const theta = Math.PI * i / 8;
        ctx.beginPath();
        ctx.moveTo(nx + Math.sin(theta) * 73, ny - Math.cos(theta) * 73);
        ctx.lineTo(nx + Math.sin(theta) * 78, ny - Math.cos(theta) * 78); ctx.stroke();
      }
      const contacts = s.enemies || [];
      for (const e of contacts) {
        const dx = e.x - p.x, dz = e.z - p.z;
        const x = (dx * cos - dz * sin) / 66, y = (dx * sin + dz * cos) / 66;
        if (y < 0 || x * x + y * y > 5400) continue;
        ctx.fillStyle = '#c99a67'; ctx.fillRect(nx + x - 1, ny - y - 1, 3, 3);
      }
      ctx.fillStyle = '#a4c2b6';
      ctx.beginPath(); ctx.moveTo(nx, ny - 6); ctx.lineTo(nx - 4, ny + 3); ctx.lineTo(nx + 4, ny + 3); ctx.fill();
      map.needsUpdate = true;
    }

    return { map, update };
  }

  function makeCanopy(T) {
    const rows = [];
    for (let j = 0; j <= 14; j++) {
      const v = j / 14;
      const row = [];
      for (let i = 0; i <= 30; i++) {
        const a = (i / 30 - 0.5) * Math.PI;
        row.push([
          Math.sin(a) * 1.20,
          -0.83 + v * 2.12 - 0.13 * Math.sin(a) ** 2,
          -4.42 - 1.56 * Math.cos(a) - 0.20 * Math.sin(v * Math.PI)
        ]);
      }
      rows.push(row);
    }
    const glassMaterial = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      forceSinglePass: true,
      uniforms: {
        cabinSunView: { value: new T.Vector3(0.49, 0.30, 0.82).normalize() },
        cabinBlast: { value: 0 },
        cabinBoost: { value: 0 },
        cabinTime: { value: 0 }
      },
      vertexShader: `
        varying vec3 vDirection;
        varying vec3 vNormal;
        varying vec2 vGlassUv;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vDirection = -viewPosition.xyz;
          vNormal = normalMatrix * normal;
          vGlassUv = uv;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 cabinSunView;
        uniform float cabinBlast, cabinBoost, cabinTime;
        varying vec3 vDirection;
        varying vec3 vNormal;
        varying vec2 vGlassUv;
        float glassNoise(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        void main() {
          vec3 eye = normalize(vDirection);
          vec3 n = normalize(vNormal);
          float facing = clamp(abs(dot(n, eye)), 0.0, 1.0);
          vec3 reflected = reflect(-eye, n);
          float sky = smoothstep(-0.12, 0.6, dot(reflected, viewMatrix[1].xyz));
          float fresnel = pow(1.0 - facing, 2.9);
          vec2 edge = min(vGlassUv, 1.0 - vGlassUv);
          float feather = smoothstep(0.0, 0.12, edge.x) * smoothstep(0.0, 0.12, edge.y);
          float sunlight = pow(max(0.0, dot(-eye, cabinSunView)), 18.0);
          float sunWide = pow(max(0.0, dot(-eye, cabinSunView)), 4.5);

          // Clean curved canopy glazing: smooth edge vignette wear + F-35A gold ITO stealth sheen.
          float edgeWear = smoothstep(0.14, 0.0, min(edge.x, edge.y));
          float microSpec = edgeWear * 0.028 * (sunWide * 0.45 + cabinBlast * 0.65);

          float opacity = (0.048 * fresnel * mix(0.50, 1.0, sky) + 0.028 * sunlight + microSpec + cabinBlast * 0.028 * fresnel) * feather;
          vec3 goldCoating = vec3(0.42, 0.31, 0.13) * fresnel * 0.42;
          vec3 tint = mix(vec3(0.08, 0.13, 0.15), vec3(0.40, 0.50, 0.55), sky) + goldCoating;
          tint += vec3(0.55, 0.32, 0.12) * (sunlight + microSpec * 3.0);
          tint += vec3(0.92, 0.50, 0.18) * cabinBlast * (0.22 + fresnel * 0.65);
          gl_FragColor = vec4(tint, clamp(opacity, 0.0, 0.24));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });
    const mesh = new T.Mesh(makeSurface(T, rows), glassMaterial);
    mesh.frustumCulled = false;
    return { mesh, material: glassMaterial };
  }

  function createCockpit(T, scene) {
    if (!T || !scene) return { update() {} };

    const matte = (color, metalness, roughness) => new T.MeshStandardMaterial({
      color, metalness, roughness, fog: false
    });
    const display = makeDisplay(T);
    const finish = makeFinishMap(T);
    const mats = {
      shell: matte(0x4c5459, 0.20, 0.66),
      liner: matte(0x282d2f, 0.04, 0.83),
      hardware: matte(0x8c9290, 0.62, 0.42),
      bezel: matte(0x3a4448, 0.26, 0.53),
      latch: matte(0x9d8044, 0.34, 0.60),
      print: makePanelPrint(T),
      display: new T.MeshBasicMaterial({ color: display ? 0xcccccc : 0x0b1518, map: display?.map ?? null, fog: false })
    };
    mats.shell.side = T.DoubleSide;
    mats.liner.side = T.DoubleSide;
    applyCabinFinish(mats.shell, finish, 0.70);
    applyCabinFinish(mats.liner, finish, 0.15);
    applyCabinFinish(mats.hardware, finish, 1.1);
    applyCabinFinish(mats.bezel, finish, 0.65);
    mats.bezel.emissive.setRGB(0.005, 0.007, 0.009);

    const parts = [];
    const add = (geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) =>
      parts.push(makePart(geo, mat, x, y, z, rx, ry, rz, sx, sy, sz));
    const box = (mat, width, height, depth, x, y, z, rx, ry, rz) =>
      add(new T.BoxGeometry(width, height, depth), mat, x, y, z, rx, ry, rz);
    function bolt(x, y, z, size, rx = 0, ry = 0) {
      add(new T.CylinderGeometry(size * 1.45, size * 1.45, 0.007, 10),
        'liner', x, y, z, Math.PI / 2 + rx, ry);
      add(new T.CylinderGeometry(size, size * 1.12, 0.012, 6),
        'hardware', x, y, z + 0.005, Math.PI / 2 + rx, ry);
      box('liner', size * 1.05, size * 0.20, 0.002, x, y, z + 0.012, rx, ry, 0.61);
    }

    function stencil(width, height, x, y, z, region, ry = 0) {
      if (!mats.print) return;
      const geo = new T.PlaneGeometry(width, height);
      const uv = geo.attributes.uv;
      const [u0, v0, u1, v1] = region;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      }
      add(geo, 'print', x, y, z, 0, ry);
    }

    // The molded glare shield spans the two sill assemblies and rolls into the instrument stack.
    const xStations = [-1.55, -1.18, -0.97, -0.79, -0.65, -0.53, -0.31, 0, 0.31, 0.53, 0.65, 0.79, 0.97, 1.18, 1.55];
    const deck = [[], [], [], [], []];
    for (const x of xStations) {
      const wing = Math.abs(x);
      const shoulder = Math.max(0, wing - 0.57);
      const hood = Math.exp(-11.0 * wing ** 4);
      deck[0].push([x * 0.94, -0.89 + hood * 0.105 + shoulder * 0.19, -5.73 + shoulder * 0.28]);
      deck[1].push([x, -0.82 + hood * 0.165 + shoulder * 0.13, -4.94 + shoulder * 0.21]);
      deck[2].push([x * 1.02, -0.846 + hood * 0.153 + shoulder * 0.13, -4.77 + shoulder * 0.28]);
      deck[3].push([x * 1.04, -1.02 + shoulder * 0.11, -4.63 + shoulder * 0.30]);
      deck[4].push([x * 1.08, -1.37, -4.37 + shoulder * 0.33]);
    }
    add(makeSurface(T, deck), 'shell');
    add(makeRail(T, deck[2], 0.017, 40), 'liner');
    // Defroster outlet: blades sit inside a black duct set into the top of the coaming.
    box('liner', 0.905, 0.011, 0.13, 0, -0.693, -5.14, -0.105);
    for (let i = -11; i <= 11; i++) {
      box('bezel', 0.007, 0.015, 0.115, i * 0.039, -0.688, -5.14, -0.095, i * 0.012);
    }

    // Nearly frameless forward field of view with the canopy bow kept at the periphery.
    const bow = [
      [-1.18, -0.71, -4.72], [-1.08, -0.12, -4.70], [-0.99, 0.53, -4.68],
      [-0.88, 0.88, -4.76], [-0.61, 1.09, -4.88], [-0.28, 1.18, -4.97],
      [0, 1.20, -5.00],
      [0.28, 1.18, -4.97], [0.61, 1.09, -4.88], [0.88, 0.88, -4.76],
      [0.99, 0.53, -4.68], [1.08, -0.12, -4.70], [1.18, -0.71, -4.72]
    ];
    const bowCurve = new T.CatmullRomCurve3(bow.map(p => new T.Vector3(...p)));
    add(bowChannel(T, bowCurve, [
      [-0.053, -0.14], [-0.067, -0.055], [-0.060, 0.022], [-0.052, 0.043],
      [-0.032, 0.047], [-0.022, 0.026], [0.030, 0.026], [0.039, 0.016], [0.044, -0.10]
    ]), 'shell');
    add(bowChannel(T, bowCurve, [[-0.066, -0.070], [-0.084, -0.058], [-0.087, -0.018], [-0.08, 0.015], [-0.066, 0.021]]), 'liner');
    for (const u of [0.035, 0.107, 0.178, 0.259, 0.34, 0.416, 0.50, 0.584, 0.66, 0.741, 0.822, 0.893, 0.965]) {
      const center = bowCurve.getPointAt(u);
      const tangent = bowCurve.getTangentAt(u);
      const theta = Math.atan2(tangent.y, tangent.x);
      add(panelPlate(T, 0.065, 0.066, 0.010, 0.011), 'bezel',
        center.x, center.y, center.z + 0.035, 0, 0, theta);
      bolt(center.x, center.y, center.z + 0.051, 0.0075);
    }

    for (const side of [-1, 1]) {
      const sill = [
        [side * 0.98, -0.675, -5.39],
        [side * 1.16, -0.627, -4.70],
        [side * 1.32, -0.68, -3.91],
        [side * 1.44, -0.82, -3.18]
      ];
      add(makeRail(T, sill, 0.109, 18, 0.2), 'shell');
      add(makeRail(T, sill.map(([x, y, z], index) => [x * 0.984, y + (index === 0 ? 0.009 : 0.079), z]),
        0.027, 18, 0.15), 'hardware');

      // A side console, a bank of recessed vents and low-profile hardware.
      for (let slot = 0; slot < 8; slot++) {
        box('liner', 0.025, 0.007, 0.21, side * (0.46 + slot * 0.037), -0.751 + slot * 0.002, -5.02,
          -0.095, side * 0.22);
      }
      box('bezel', 0.31, 0.24, 0.24, side * 0.73, -0.93, -4.58, -0.31, side * 0.15, -side * 0.14);
      for (let vent = 0; vent < 6; vent++) {
        box('liner', 0.021, 0.088, 0.018, side * (0.635 + vent * 0.034), -0.874, -4.442,
          -0.31, side * 0.15, -side * 0.14);
      }
      for (let key = 0; key < 3; key++) {
        box('hardware', 0.041, 0.033, 0.018, side * (0.65 + key * 0.066), -0.99, -4.43, -0.26);
      }
      box('shell', 0.13, 0.17, 0.13, side * 1.02, -0.67, -4.31, 0.18, side * 0.42);
      box('hardware', 0.090, 0.028, 0.124, side * 0.99, -0.595, -4.27, 0.18, side * 0.42);
    }

    // The panoramic glass sits inside a chamfered frame; emissive telemetry shares its projection.
    const screenAngle = -0.22;
    const panelY = -0.803;
    const panelZ = -4.463;
    const bezelShape = new T.Shape();
    for (const [index, point] of [
      [-0.575, -0.132], [-0.575, 0.113], [-0.542, 0.148], [0.542, 0.148],
      [0.575, 0.113], [0.575, -0.132], [0.546, -0.154], [-0.546, -0.154]
    ].entries()) {
      if (index === 0) bezelShape.moveTo(...point);
      else bezelShape.lineTo(...point);
    }
    bezelShape.closePath();
    add(new T.ExtrudeGeometry(bezelShape, {
      depth: 0.039, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.014, bevelThickness: 0.014
    }), 'bezel', 0, panelY, panelZ - 0.047, screenAngle);
    const inPanel = (geo, mat, x, y, z, extraTilt = 0) => {
      const c = Math.cos(screenAngle);
      const s = Math.sin(screenAngle);
      add(geo, mat, x, panelY + y * c - z * s, panelZ + y * s + z * c, screenAngle + extraTilt);
    };
    inPanel(new T.BoxGeometry(1.087, 0.245, 0.019), 'liner', 0, 0, 0.009);
    inPanel(new T.PlaneGeometry(1.045, 0.224), 'display', 0, 0, 0.020);
    for (const x of [-0.551, 0.551]) {
      for (const y of [-0.113, 0.112]) {
        inPanel(new T.CylinderGeometry(0.0105, 0.0115, 0.012, 8), 'hardware', x, y, 0.005, Math.PI / 2);
        inPanel(new T.BoxGeometry(0.009, 0.002, 0.002), 'liner', x, y, 0.013);
      }
    }

    const root = new T.Group();
    root.name = 'CockpitRoot';
    root.matrixAutoUpdate = false;
    const frame = new T.Group();
    const aspectRig = new T.Group();
    root.add(frame);
    frame.add(aspectRig);
    scene.add(root);

    const buckets = {};
    for (const part of parts) (buckets[part.matKey] ||= []).push(part);
    for (const [mat, list] of Object.entries(buckets)) {
      const merged = mergePartsForBucket(T, list);
      const mesh = new T.Mesh(merged, mats[mat]);
      mesh.frustumCulled = false;
      aspectRig.add(mesh);
      for (const part of list) part.geo.dispose();
    }
    const canopy = makeCanopy(T);
    aspectRig.add(canopy.mesh);

    const flipX = new T.Matrix4().makeScale(-1, 1, 1);
    const referenceDepth = 4.60;
    const sunWorld = new T.Vector3(0.49, 0.30, 0.82).normalize();
    const sunView = new T.Vector3();
    const invViewRot = new T.Matrix3();

    function update(s, camera, renderSunDir) {
      if (!s || !s.player || !camera) return;
      root.visible = s.state !== 'end';
      if (!root.visible) return;

      const p = s.player;
      const t = Number(s.time) || 0;
      const boost = Number(s.boost) || 0;
      const muzzle = clamp(Number(s.muzzleFlash) || 0, 0, 1);
      const damage = clamp(Number(s.damageFlash) || 0, 0, 1);
      const blast = clamp(Number(s.screenFlash) || 0, 0, 1);
      const shake = clamp(Number(s.shake) || 0, 0, 1.5);
      const load = clamp(Number(p.gForce ?? 1) - 1, -2, 6);
      const aoa = Number(p.aoa) || 0;
      const slip = Number(p.slip) || 0;
      const roll = Number(p.roll) || 0;
      const recoil = Number(p.recoil) || 0;

      camera.updateMatrixWorld(true);
      root.matrix.multiplyMatrices(flipX, camera.matrixWorld);
      root.matrixWorldNeedsUpdate = true;

      // Rotate sun direction into camera view space so canopy reflections track maneuvers.
      if (renderSunDir) sunWorld.copy(renderSunDir).normalize();
      invViewRot.setFromMatrix4(camera.matrixWorldInverse);
      sunView.copy(sunWorld).applyMatrix3(invViewRot).normalize();
      canopy.material.uniforms.cabinSunView.value.copy(sunView);
      canopy.material.uniforms.cabinBlast.value = blast + muzzle * 0.35;
      canopy.material.uniforms.cabinBoost.value = boost;
      canopy.material.uniforms.cabinTime.value = t;

      // Keep the canopy above the camera near plane and clear of the helmet sight across FOV changes.
      const halfH = referenceDepth * Math.tan(camera.fov * Math.PI / 360);
      const halfW = halfH * camera.aspect;
      aspectRig.scale.set(halfW, halfH, 1);
      const roughAir = Math.sin(t * 44) * (boost * 0.0028 + Math.max(0, load - 1.5) * 0.0008 + shake * 0.0035);
      const roughY = Math.cos(t * 51) * (boost * 0.0018 + shake * 0.0032);
      const shiftX = clamp(-roll * 0.015 - slip * 0.018 + roughAir, -0.048, 0.048);
      const shiftY = clamp(-recoil * 0.010 - load * 0.0055 - aoa * 0.013 + roughY, -0.042, 0.042);
      frame.position.set(halfW * shiftX, halfH * shiftY, recoil * 0.048 + boost * 0.032);

      // Dynamic bounce light from cannon muzzle flash, explosions & damage warning inside the cockpit.
      mats.shell.emissive.setRGB(
        0.006 + muzzle * 0.095 + blast * 0.085 + damage * 0.038,
        0.008 + muzzle * 0.048 + blast * 0.042 + damage * 0.006,
        0.011 + muzzle * 0.014 + blast * 0.015 + damage * 0.002
      );
      mats.hardware.emissive.copy(mats.shell.emissive);
      mats.hardware.emissiveIntensity = 1.75;
      mats.bezel.emissive.setRGB(
        0.005 + muzzle * 0.045 + blast * 0.040,
        0.008 + muzzle * 0.022 + blast * 0.020,
        0.011 + muzzle * 0.008 + blast * 0.008
      );
      display?.update(s);
    }

    return { update, root };
  }

  const api = { createCockpit };
  if (typeof window !== 'undefined') window.Cockpit3D = api;
  if (typeof globalThis !== 'undefined') globalThis.Cockpit3D = api;
})();
