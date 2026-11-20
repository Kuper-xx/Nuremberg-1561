/* Procedural High-Geometry 3D Models & PBR Material Cache for Nuremberg 1561.
 * Exposes `window.Models3D` for Three.js r160 global (`window.THREE`) without a bundler.
 * All models respect `scene.scale.x = -1` in world3d.js (symmetric in X, valid outward normals)
 * and batch static sub-meshes by material and shadow flags.
 */
(() => {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;

  let cachedT = null;
  let cachedMap = null;
  let cachedPBR = null;
  let cachedMats = null;
  const geomCaches = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function makeFallbackRandom(initialSeed = 1561) {
    let seed = initialSeed;
    return () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
  }

  function getCache(T) {
    if (!geomCaches || (typeof T !== 'object' && typeof T !== 'function') || T === null) return null;
    let c = geomCaches.get(T);
    if (!c) {
      c = {};
      geomCaches.set(T, c);
    }
    return c;
  }

  function cachedGeo(T, key, factory) {
    const cache = getCache(T);
    if (cache && cache[key]) return cache[key];
    const geo = factory();
    if (cache) cache[key] = geo;
    return geo;
  }

  function vec2(T, x, y) {
    return T.Vector2 ? new T.Vector2(x, y) : { x, y };
  }

  function hdrColor(T, r, g, b) {
    return new T.Color(r, g, b);
  }

  // Neutral paint, tiny panel joints, accumulated dirt beside joints and hairline
  // abrasion. Albedo and roughness vary independently of the panel relief.
  function buildHullFinish(T) {
    return cachedGeo(T, 'hullFinish', () => {
      const size = 512;
      const color = new Uint8Array(size * size * 4);
      const normal = new Uint8Array(color.length);
      const rough = new Uint8Array(color.length);
      const relief = new Float32Array(size * size);
      const random = makeFallbackRandom(723051);
      const rowBreaks = [0, 77, 140, 232, 310, 398, 458, size];
      const widths = [126, 174, 107, 105];
      const stain = new Float32Array(32 * 32);
      for (let i = 0; i < stain.length; i++) stain[i] = random();
      function patch(x, y) {
        const ix = Math.floor(x), iy = Math.floor(y);
        const fx = x - ix, fy = y - iy;
        const at = (a,b) => stain[(b & 31) * 32 + (a & 31)];
        return (at(ix,iy) * (1-fx) + at(ix+1,iy) * fx) * (1-fy) +
          (at(ix,iy+1) * (1-fx) + at(ix+1,iy+1) * fx) * fy;
      }
      for (let row = 0; row < rowBreaks.length - 1; row++) {
        let start = 0;
        for (let column = 0; column < widths.length; column++) {
          const width = widths[(column + row) % widths.length];
          const paint = random() * 13;
          for (let y = rowBreaks[row]; y < rowBreaks[row + 1]; y++) {
            for (let dx = 0; dx < width; dx++) {
              const x = (start + dx + row * 83) & 511;
              const idx = y * size + x, k = idx * 4;
              const dy = y - rowBreaks[row];
              const edge = Math.min(dx, width - dx - 1, dy, rowBreaks[row+1] - y - 1);
              const mottle = patch(x/16, y/16);
              const runoff = Math.max(0, patch(x/4,y/64) - 0.55) *
                Math.exp(-dy / 31) * 58;
              const scratch = random() > 0.998 ? 13 : 0;
              const albedo = 186 + paint + 11 * mottle + 3 * random() - runoff -
                (edge === 0 ? 24 : 0) + scratch;
              color[k] = albedo;
              color[k+1] = albedo * 0.995;
              color[k+2] = albedo * 0.976;
              color[k+3] = 255;
              const finish = 169 + paint * 1.4 + 27 * mottle + runoff * 0.7 - scratch;
              rough[k] = rough[k+1] = rough[k+2] = finish;
              rough[k+3] = 255;
              relief[idx] = (edge === 0 ? -0.40 : edge === 1 ? 0.09 : 0.0) + mottle * 0.045;
            }
          }
          start += width;
        }
      }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const k = (y * size + x) * 4;
          const nx = relief[y*size+((x-1)&511)] - relief[y*size+((x+1)&511)];
          const ny = relief[((y-1)&511)*size+x] - relief[((y+1)&511)*size+x];
          const inv = 1 / Math.hypot(nx, ny, 1);
          normal[k] = 128 + 127 * nx * inv;
          normal[k+1] = 128 + 127 * ny * inv;
          normal[k+2] = 128 + 127 * inv;
          normal[k+3] = 255;
        }
      }
      const texture = data => {
        const map = new T.DataTexture(data, size, size, T.RGBAFormat);
        map.wrapS = map.wrapT = T.RepeatWrapping;
        map.generateMipmaps = true;
        map.minFilter = T.LinearMipmapLinearFilter;
        map.magFilter = T.LinearFilter;
        map.anisotropy = 4;
        map.needsUpdate = true;
        return map;
      };
      const colorMap = texture(color);
      colorMap.colorSpace = T.SRGBColorSpace;
      return { colorMap, normalMap: texture(normal), roughnessMap: texture(rough) };
    });
  }

  function makePBRMaterial(T, armorMap, armorPBR, opts) {
    const nMap = armorPBR && armorPBR.normalMap ? armorPBR.normalMap : null;
    const rMap = armorPBR && armorPBR.roughnessMap ? armorPBR.roughnessMap : null;
    const useColorMap = opts.useMap !== false && armorMap ? armorMap : null;
    const ns = opts.normalScale || 1.0;

    const params = {
      color: opts.color,
      metalness: opts.metalness,
      roughness: rMap && opts.useRoughness !== false ? (opts.mapRoughness ?? 0.92) : opts.roughness,
      envMapIntensity: opts.envMapIntensity !== undefined ? opts.envMapIntensity : 1.5
    };
    if (useColorMap) params.map = useColorMap;
    if (nMap && opts.useNormal !== false) {
      params.normalMap = nMap;
      params.normalScale = vec2(T, ns, ns);
    } else if (useColorMap && opts.bumpScale) {
      params.bumpMap = useColorMap;
      params.bumpScale = opts.bumpScale;
    }
    if (rMap && opts.useRoughness !== false) {
      params.roughnessMap = rMap;
    }
    return new T.MeshStandardMaterial(params);
  }

  function getSharedMaterials(T, armorMap = null, armorPBR = null) {
    const normMap = armorMap || null;
    const normPBR = armorPBR || null;
    if (cachedMats && cachedT === T && cachedMap === normMap && cachedPBR === normPBR) {
      return cachedMats;
    }

    const mats = {
      hullMat: makePBRMaterial(T, normMap, normPBR, {
        color: 0x555955, metalness: 0.40, roughness: 0.52, mapRoughness: 0.77,
        normalScale: 0.47, bumpScale: 0.15, envMapIntensity: 1.13
      }),
      plateMat: makePBRMaterial(T, normMap, normPBR, {
        color: 0x6b6c62, metalness: 0.45, roughness: 0.50, mapRoughness: 0.74,
        normalScale: 0.43, bumpScale: 0.14, envMapIntensity: 1.18
      }),
      darkMetal: makePBRMaterial(T, normMap, normPBR, {
        color: 0x474c4b, metalness: 0.62, roughness: 0.45, mapRoughness: 0.65,
        normalScale: 0.53, bumpScale: 0.13, envMapIntensity: 1.17
      }),
      collarMat: makePBRMaterial(T, normMap, normPBR, {
        color: 0x52534d, metalness: 0.66, roughness: 0.46, mapRoughness: 0.68,
        normalScale: 0.4, bumpScale: 0.11, envMapIntensity: 1.21
      }),
      gunmetal: makePBRMaterial(T, normMap, normPBR, {
        color: 0x262a29, metalness: 0.34, roughness: 0.64, mapRoughness: 0.88,
        normalScale: 0.40, bumpScale: 0.12, envMapIntensity: 1.06
      }),
      sphereChrome: makePBRMaterial(T, normMap, normPBR, {
        color: 0x9c9c8e, metalness: 0.77, roughness: 0.37, mapRoughness: 0.48,
        normalScale: 0.39, bumpScale: 0.12, envMapIntensity: 1.15
      }),
      sphereObsidian: makePBRMaterial(T, normMap, normPBR, {
        color: 0x656b66, metalness: 0.64, roughness: 0.44, mapRoughness: 0.57,
        normalScale: 0.5, bumpScale: 0.13, envMapIntensity: 1.2
      }),
      ringGold: makePBRMaterial(T, normMap, normPBR, {
        color: 0x746d5d, metalness: 0.68, roughness: 0.41, mapRoughness: 0.63,
        normalScale: 0.36, envMapIntensity: 1.12
      }),
      fighterHull: makePBRMaterial(T, normMap, normPBR, {
        color: 0x505552, metalness: 0.43, roughness: 0.49, mapRoughness: 0.7,
        normalScale: 0.85, bumpScale: 0.35, envMapIntensity: 1.7
      }),
      fighterWing: makePBRMaterial(T, normMap, normPBR, {
        color: 0x626660, metalness: 0.48, roughness: 0.51, mapRoughness: 0.74,
        normalScale: 0.75, envMapIntensity: 1.55
      }),
      canopyGold: makePBRMaterial(T, normMap, normPBR, {
        color: 0x554d3d, useMap: false, useNormal: false, useRoughness: false,
        metalness: 0.64, roughness: 0.17, envMapIntensity: 1.07
      }),
      allyHull: makePBRMaterial(T, normMap, normPBR, {
        color: 0x5c6a72, metalness: 0.70, roughness: 0.35, mapRoughness: 0.94,
        normalScale: 0.75, bumpScale: 0.25, envMapIntensity: 1.65
      }),

      // HDR emissive materials (> 1.0 triggers postfx.js Bloom pass)
      plasmaCore: new T.MeshBasicMaterial({ color: hdrColor(T, 1.46, 0.53, 0.15) }),
      afterburner: new T.MeshBasicMaterial({ color: hdrColor(T, 2.16, 0.79, 0.28) }),
      allyBurner: new T.MeshBasicMaterial({ color: hdrColor(T, 1.52, 1.26, 1.11) }),
      beaconGlow: new T.MeshBasicMaterial({ color: hdrColor(T, 1.62, 0.42, 0.12) }),
      bridgeLights: new T.MeshBasicMaterial({ color: hdrColor(T, 0.83, 0.68, 0.44) }),
      engineGlow: new T.MeshBasicMaterial({ color: hdrColor(T, 1.9, 0.78, 0.29) }),
      carrierServiceLight: new T.MeshBasicMaterial({ color: hdrColor(T, 1.12, 0.55, 0.24) }),
      carrierEngineLight: new T.MeshBasicMaterial({ color: hdrColor(T, 2.65, 1.05, 0.31) })
    };
    for (const mat of [mats.engineGlow, mats.plasmaCore, mats.afterburner, mats.allyBurner]) {
      mat.userData.restRadiance = mat.color.clone();
    }

    cachedT = T;
    cachedMap = normMap;
    cachedPBR = normPBR;
    cachedMats = mats;
    return mats;
  }

  function ensureMats(T, mats) {
    return mats || getSharedMaterials(T, null, null);
  }

  function scaleUVs(geo, su, sv) {
    const uv = geo.attributes && geo.attributes.uv;
    if (!uv) return geo;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
    uv.needsUpdate = true;
    return geo;
  }

  function canMerge(T) {
    return !!(
      T &&
      T.Matrix4 && T.Matrix4.prototype && typeof T.Matrix4.prototype.compose === 'function' &&
      T.Matrix3 && T.Matrix3.prototype && typeof T.Matrix3.prototype.getNormalMatrix === 'function' &&
      T.Quaternion && T.Quaternion.prototype && typeof T.Quaternion.prototype.setFromEuler === 'function' &&
      T.Vector3 && T.Vector3.prototype && typeof T.Vector3.prototype.applyMatrix4 === 'function' &&
      T.Euler && T.BufferGeometry && T.Float32BufferAttribute
    );
  }

  function makeMatrix(T, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const euler = new T.Euler(rx, ry, rz, 'XYZ');
    const quat = new T.Quaternion().setFromEuler(euler);
    return new T.Matrix4().compose(new T.Vector3(px, py, pz), quat, new T.Vector3(sx, sy, sz));
  }

  function mergeEntries(T, entries) {
    if (!canMerge(T) || !entries.length) return null;
    let totalVerts = 0;
    let totalIndices = 0;
    for (let i = 0; i < entries.length; i++) {
      const pos = entries[i].geo && entries[i].geo.attributes && entries[i].geo.attributes.position;
      if (!pos || !pos.count) return null;
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
    let vOffset = 0;
    let iOffset = 0;

    for (let e = 0; e < entries.length; e++) {
      const { geo, matrix } = entries[e];
      const pos = geo.attributes.position;
      const norm = geo.attributes.normal;
      const uv = geo.attributes.uv;
      const idx = geo.index;

      normMat.getNormalMatrix(matrix);

      for (let i = 0; i < pos.count; i++) {
        vPos.fromBufferAttribute(pos, i).applyMatrix4(matrix);
        const o3 = (vOffset + i) * 3;
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
          normals[o3 + 1] = 1;
        }

        const o2 = (vOffset + i) * 2;
        if (uv) {
          uvs[o2] = uv.getX(i);
          uvs[o2 + 1] = uv.getY(i);
        }
      }

      if (idx) {
        for (let k = 0; k < idx.count; k++) {
          indices[iOffset + k] = idx.getX(k) + vOffset;
        }
        iOffset += idx.count;
      } else {
        for (let k = 0; k < pos.count; k++) {
          indices[iOffset + k] = vOffset + k;
        }
        iOffset += pos.count;
      }
      vOffset += pos.count;
    }

    const merged = new T.BufferGeometry();
    merged.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    merged.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    merged.setIndex(T.BufferAttribute ? new T.BufferAttribute(indices, 1) : Array.from(indices));
    return merged;
  }

  /**
   * Collects sub-parts by (bucketKey, material, cast, receive) and builds merged meshes.
   * Falls back to individual meshes if running under a minimal mock THREE.
   */
  function createBatcher(T) {
    const mergeEnabled = canMerge(T);
    const buckets = new Map();
    const fallbackItems = [];

    return {
      add(bucketKey, geo, mat, matrix, cast = false, receive = false) {
        if (!mergeEnabled) {
          fallbackItems.push({ geo, mat, matrix, cast, receive });
          return;
        }
        const key = `${bucketKey}|${cast ? 1 : 0}|${receive ? 1 : 0}`;
        let b = buckets.get(key);
        if (!b) {
          b = { mat, cast, receive, entries: [] };
          buckets.set(key, b);
        }
        b.entries.push({ geo, matrix });
      },
      buildMergedGeometries() {
        const out = [];
        for (const [key, b] of buckets.entries()) {
          const geo = mergeEntries(T, b.entries);
          out.push({ key, geo: geo || b.entries[0].geo, mat: b.mat, cast: b.cast, receive: b.receive });
        }
        return out;
      },
      flushInto(targetGroup) {
        if (!mergeEnabled) {
          for (let i = 0; i < fallbackItems.length; i++) {
            const it = fallbackItems[i];
            const mesh = new T.Mesh(it.geo, it.mat);
            mesh.position.set(it.matrix.px, it.matrix.py, it.matrix.pz);
            mesh.rotation.set(it.matrix.rx, it.matrix.ry, it.matrix.rz);
            if (it.matrix.sx !== 1 || it.matrix.sy !== 1 || it.matrix.sz !== 1) {
              mesh.scale.set(it.matrix.sx, it.matrix.sy, it.matrix.sz);
            }
            mesh.castShadow = it.cast;
            mesh.receiveShadow = it.receive;
            targetGroup.add(mesh);
          }
          return targetGroup;
        }
        for (const b of buckets.values()) {
          const geo = mergeEntries(T, b.entries);
          if (!geo) continue;
          const mesh = new T.Mesh(geo, b.mat);
          mesh.castShadow = b.cast;
          mesh.receiveShadow = b.receive;
          targetGroup.add(mesh);
        }
        return targetGroup;
      },
      transform(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
        return mergeEnabled
          ? makeMatrix(T, px, py, pz, rx, ry, rz, sx, sy, sz)
          : { px, py, pz, rx, ry, rz, sx, sy, sz };
      }
    };
  }

  /**
   * Builds a sculpted, faceted stealth fuselage along Z (bow at +Z, stern at -Z).
   * Each station has 8 clockwise points viewed from +Z; longitudinal facet strips
   * keep crisp chine edges while curving smoothly along Z.
   */
  function buildLoftedStealthBody(T, stations) {
    const numSegs = 8;
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let k = 0; k < numSegs; k++) {
      const kNext = (k + 1) % numSegs;
      const baseIndex = positions.length / 3;
      const u0 = k / numSegs;
      const u1 = (k + 1) / numSegs;

      for (let s = 0; s < stations.length; s++) {
        const st = stations[s];
        const v = s / (stations.length - 1);
        const p0 = st.pts[k];
        const p1 = st.pts[kNext];
        positions.push(p0[0], p0[1], st.z, p1[0], p1[1], st.z);
        uvs.push(u0, v, u1, v);
      }

      for (let s = 0; s < stations.length - 1; s++) {
        const a = baseIndex + s * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
    }

    // Rear bulkhead cap at last station (outward normal -Z)
    const last = stations[stations.length - 1];
    let cy = 0;
    for (let k = 0; k < numSegs; k++) cy += last.pts[k][1];
    cy /= numSegs;

    const capCenterIdx = positions.length / 3;
    positions.push(0, cy, last.z);
    uvs.push(0.5, 0.5);

    const capRingStart = positions.length / 3;
    for (let k = 0; k < numSegs; k++) {
      const p = last.pts[k];
      positions.push(p[0], p[1], last.z);
      uvs.push(0.5 + p[0], 0.5 + p[1]);
    }
    for (let k = 0; k < numSegs; k++) {
      const kNext = (k + 1) % numSegs;
      indices.push(capCenterIdx, capRingStart + k, capRingStart + kNext);
    }

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  // ---------------------------------------------------------------------------
  // 2. Black Stealth Delta Cruiser (`carrier`)
  // ---------------------------------------------------------------------------
  // Z, beam, crown, chine, lowest belly and inner hangar ceiling.
  const carrierStations = [
    [1006, 4, -32, -39, -46, -45],
    [968, 31, -23, -34, -56, -54],
    [808, 76, -15, -34, -71, -65],
    [458, 174, 0, -35, -99, -75],
    [215, 256, 13, -37, -121, -75],
    [-78, 354, 20, -39, -133, -77],
    [-333, 439, 19, -38, -132, -78],
    [-548, 511, 13, -35, -121, -76],
    [-585, 496, 5, -37, -106, -72]
  ];

  function carrierBellyProfile(chine, belly, trench) {
    return [
      [0.986, chine - 14], [0.90, chine - 19], [0.72, chine - 43],
      [0.52, belly + 17], [0.26, belly], [0.147, belly + 4],
      [0.106, trench], [0, trench]
    ];
  }

  function makeCarrierHull(T) {
    const sections = carrierStations.map(([z, beam, crown, chine, belly, trench], index) => {
      const starboard = [
        [0, crown], [0.44, crown - 7], [0.73, chine + 22], [0.91, chine + 13], [1, chine],
        ...carrierBellyProfile(chine, belly, trench)
      ];
      const port = starboard.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
      return [...starboard, ...port].map(([x, y]) => {
        // The wing shoulders extend past the engine bay's recessed rear bulkhead.
        const notch = index === carrierStations.length - 1
          ? Math.min(1, Math.max(0, (Math.abs(x) - 0.52) / 0.12))
          : 0;
        return [x * (beam - notch * 18), y, z - notch * 107];
      });
    });
    const perimeter = sections[0].length;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let edge = 0; edge < perimeter; edge++) {
      const start = positions.length / 3;
      const next = (edge + 1) % perimeter;
      for (let station = 0; station < sections.length; station++) {
        const left = sections[station][edge];
        const right = sections[station][next];
        const length = (1006 - carrierStations[station][0]) / 960;
        positions.push(...left, ...right);
        uvs.push(edge / perimeter, length, (edge + 1) / perimeter, length);
        if (station > 0) {
          const a = start + 2 * (station - 1);
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    for (const station of [0, sections.length - 1]) {
      const section = sections[station];
      const center = positions.length / 3;
      const midpoint = (carrierStations[station][2] + carrierStations[station][5]) / 2;
      positions.push(0, midpoint, carrierStations[station][0]);
      uvs.push(0.5, 0.5);
      for (const vertex of section) {
        positions.push(...vertex);
        uvs.push(0.5 + vertex[0] / 1120, vertex[1] / 230 + 0.5);
      }
      for (let i = 0; i < perimeter; i++) {
        const left = center + 1 + i;
        const right = center + 1 + (i + 1) % perimeter;
        if (station === 0) indices.push(center, right, left);
        else indices.push(center, left, right);
      }
    }
    const hull = new T.BufferGeometry();
    hull.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    hull.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    hull.setIndex(indices);
    hull.computeVertexNormals();
    return hull;
  }

  function carrierSection(z) {
    const next = carrierStations.findIndex(row => row[0] <= z);
    if (next === 0) return carrierStations[0];
    if (next === -1) return carrierStations[carrierStations.length - 1];
    const before = carrierStations[next - 1];
    const after = carrierStations[next];
    const t = (z - before[0]) / (after[0] - before[0]);
    return before.map((value, index) => value + (after[index] - value) * t);
  }

  function carrierBellyHeight(x, z) {
    const [, beam, , chine, belly, trench] = carrierSection(z);
    const profile = carrierBellyProfile(chine, belly, trench);
    const ratio = Math.min(profile[0][0], Math.abs(x) / beam);
    for (let i = 1; i < profile.length; i++) {
      const [innerX, innerY] = profile[i];
      if (ratio < innerX) continue;
      const [outerX, outerY] = profile[i - 1];
      const t = (ratio - innerX) / (outerX - innerX);
      return innerY + (outerY - innerY) * t;
    }
    return trench;
  }

  function makeCarrierPlate(T, flank, profile, thickness, relief) {
    const shape = new T.Shape();
    for (const [index, [z, widthFraction]] of profile.entries()) {
      const x = flank * carrierSection(z)[1] * widthFraction;
      if (index === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    }
    shape.closePath();
    const geometry = new T.ExtrudeGeometry(shape, {
      depth: thickness, bevelEnabled: true, bevelSize: 2.4, bevelThickness: 2.2, bevelSegments: 1
    });
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const contact = carrierBellyHeight(pos.getX(i), pos.getZ(i));
      pos.setY(i, pos.getY(i) + contact - thickness - relief);
    }
    geometry.computeVertexNormals();
    scaleUVs(geometry, 0.003, 0.003);
    return geometry;
  }

  function addCarrierTurret(batcher, T, mats, px, py, pz, yaw) {
    const barbetteGeo = cachedGeo(T, 'carrier_barbette', () => new T.CylinderGeometry(16, 19, 10, 12));
    const cupolaGeo = cachedGeo(T, 'carrier_cupola', () => new T.CylinderGeometry(10, 14, 9, 8));
    const barrelGeo = cachedGeo(T, 'carrier_barrel', () => {
      const g = new T.CylinderGeometry(1.5, 2.0, 26, 8);
      g.rotateX(Math.PI / 2 - 0.12);
      g.translate(0, 13 * Math.sin(0.12), 13 * Math.cos(0.12));
      return g;
    });

    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const tx = (lx, lz) => px + lx * cosY + lz * sinY;
    const tz = (lx, lz) => pz - lx * sinY + lz * cosY;

    batcher.add('collar', barbetteGeo, mats.collarMat, batcher.transform(px, py + 5, pz, 0, yaw, 0), true, false);
    batcher.add('gunmetal', cupolaGeo, mats.gunmetal, batcher.transform(px, py + 13, pz, 0, yaw, 0), false, false);
    for (const bx of [-4.2, 4.2]) {
      batcher.add(
        'gunmetal', barrelGeo, mats.gunmetal,
        batcher.transform(tx(bx, 7), py + 14, tz(bx, 7), 0, yaw, 0),
        false, false
      );
    }
  }

  function addCarrierEngineBank(batcher, T, mats, px, py, pz, radius) {
    const cowl = cachedGeo(T, `carrier_cowl_${radius}`, () => {
      const points = [[0.71, -38], [0.93, -38], [1.07, -26], [1.12, 1], [1.06, 25],
        [0.58, 25], [0.57, 5], [0.65, -19], [0.71, -38]];
      const geometry = new T.LatheGeometry(points.map(([r, z]) => new T.Vector2(r * radius, z)), 16);
      geometry.rotateX(Math.PI / 2);
      return geometry;
    });
    batcher.add('collar', cowl, mats.collarMat, batcher.transform(px, py, pz), true, false);
    const ring = cachedGeo(T, `carrier_core_${radius}`, () =>
      new T.TorusGeometry(radius * 0.55, radius * 0.032, 5, 16));
    batcher.add('carrierEngine', ring, mats.carrierEngineLight || mats.engineGlow,
      batcher.transform(px, py, pz - 13), false, false);
    const baffle = cachedGeo(T, `carrier_baffle_${radius}`, () =>
      new T.BoxGeometry(radius * 1.35, radius * 0.078, 12));
    for (const angle of [0, Math.PI / 3, 2 * Math.PI / 3]) {
      batcher.add('gunmetal', baffle, mats.gunmetal, batcher.transform(px, py, pz - 24, 0, 0, angle), false, false);
    }
  }

  function buildCarrier(T, matsArg, randomArg) {
    const mats = ensureMats(T, matsArg);
    const random = typeof randomArg === 'function' ? randomArg : makeFallbackRandom(1561);
    const carrier = new T.Group();
    const batcher = createBatcher(T);
    const unitBox = cachedGeo(T, 'unit_box', () => new T.BoxGeometry(1, 1, 1));

    const addBox = (bucket, x, y, z, w, h, d, mat, cast = false, receive = false, ry = 0) => {
      batcher.add(bucket, unitBox, mat, batcher.transform(x, y, z, 0, ry, 0, w, h, d), cast, receive);
    };

    const hullGeo = cachedGeo(T, 'carrier_loft', () => makeCarrierHull(T));
    batcher.add('hull', hullGeo, mats.hullMat, batcher.transform(), true, true);

    // Stepped dorsal inner delta superstructure deck
    const deckShape = new T.Shape();
    deckShape.moveTo(0, -780);
    deckShape.lineTo(95, -390);
    deckShape.lineTo(315, 490);
    deckShape.lineTo(210, 560);
    deckShape.lineTo(-210, 560);
    deckShape.lineTo(-315, 490);
    deckShape.lineTo(-95, -390);
    deckShape.closePath();

    const deckGeo = new T.ExtrudeGeometry(deckShape, {
      depth: 22, bevelEnabled: true, bevelSize: 14, bevelThickness: 10, bevelSegments: 2, steps: 1
    });
    deckGeo.rotateX(-Math.PI / 2);
    deckGeo.translate(0, 12, 0);
    scaleUVs(deckGeo, 0.01, 0.01);
    batcher.add('plate', deckGeo, mats.plateMat, batcher.transform(), true, true);

    // Stepped dorsal armor plates & axial spine ridge
    for (let i = 0; i < 20; i++) {
      const z = -500 + i * 62;
      const t = (z + 520) / 1320;
      const wPlate = Math.max(48, 340 * (1 - t * 0.78));
      const isHull = i % 3 === 0;
      addBox(isHull ? 'hull' : 'plate', 0, 46, z, wPlate, 10, 44, isHull ? mats.hullMat : mats.plateMat, true, true);
    }
    addBox('collar', 0, 54, 120, 34, 14, 1020, mats.collarMat, true, true);

    // Symmetric lateral wing-deck reinforcements & armor buttresses
    for (let i = 0; i < 9; i++) {
      const ribThick = 22 + Math.floor(random() * 14);
      const z = -150 - i * 48;
      const xOff = 112 + i * 24;
      for (const side of [-1, 1]) {
        addBox('plate', side * xOff, 26, z, 38, ribThick, 88, mats.plateMat, true, true, side * 0.24);
        addBox('collar', side * (xOff + 22), 10, z - 12, 18, 12, 68, mats.collarMat, false, true);
      }
    }

    // Stepped Command Bridge Superstructure (aft dorsal citadel)
    addBox('plate', 0, 68, -280, 196, 48, 340, mats.plateMat, true, true);
    addBox('hull', 0, 106, -315, 134, 38, 210, mats.hullMat, true, true);
    addBox('collar', 0, 140, -335, 110, 32, 114, mats.collarMat, true, true);
    addBox('plate', 0, 160, -335, 124, 10, 126, mats.plateMat, true, false);
    for (const side of [-1, 1]) {
      addBox('collar', side * 88, 72, -310, 26, 36, 175, mats.collarMat, true, false);
      addBox('gunmetal', side * 66, 106, -320, 18, 24, 120, mats.gunmetal, false, false);
    }

    // Bridge HDR emissive viewport windows (forward, aft & lateral galleries)
    for (let i = 0; i < 11; i++) {
      const bx = -45 + i * 9;
      addBox('bridge', bx, 142, -393, 5, 5.5, 4, mats.bridgeLights);
      addBox('bridge', bx, 142, -277, 5, 5.5, 4, mats.bridgeLights);
    }
    for (let i = 0; i < 5; i++) {
      const bz = -365 + i * 15;
      for (const side of [-1, 1]) {
        addBox('bridge', side * 56, 142, bz, 4, 5, 7, mats.bridgeLights);
      }
    }
    for (let i = 0; i < 8; i++) {
      addBox('bridge', -38.5 + i * 11, 108, -422, 6, 4, 3, mats.bridgeLights);
    }

    // Communications masts, phased-array radar & sensor spires
    const mastGeo = new T.CylinderGeometry(3.2, 6.5, 84, 8);
    const radarDishGeo = new T.CylinderGeometry(16, 12, 6, 10);
    radarDishGeo.rotateX(Math.PI * 0.42);
    const beaconTipGeo = new T.SphereGeometry(3.5, 10, 8);
    for (const side of [-1, 1]) {
      batcher.add('gunmetal', mastGeo, mats.gunmetal, batcher.transform(side * 28, 198, -330), true, false);
      addBox('gunmetal', side * 28, 220, -330, 32, 4, 6, mats.gunmetal);
      batcher.add('beacon', beaconTipGeo, mats.beaconGlow, batcher.transform(side * 28, 242, -330), false, false);
    }
    batcher.add('plate', radarDishGeo, mats.plateMat, batcher.transform(0, 178, -295), false, false);
    addBox('gunmetal', 0, 174, -365, 22, 18, 10, mats.gunmetal);

    // Stepped armor follows the chine, leaving visible expansion joints and a recessed central bay.
    const bayLight = mats.carrierServiceLight || mats.bridgeLights;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const front = 668 - i * 165;
        const back = front - 144;
        const plating = [[front, 0.29], [front - 25, 0.54], [back + 44, 0.69], [back, 0.57], [back + 18, 0.33]];
        const chine = [[front - 19, 0.71], [front - 40, 0.85], [back + 26, 0.92], [back + 7, 0.81]];
        batcher.add('plate', makeCarrierPlate(T, side, plating, i % 2 ? 9 : 13, 1), mats.plateMat,
          batcher.transform(), false, true);
        batcher.add('collar', makeCarrierPlate(T, side, chine, 7, 1), mats.collarMat,
          batcher.transform(), false, true);
      }

      // Banked cooling vents beneath the reactor decks with structural ribs bridging each opening.
      for (const z of [-405, -250, -93]) {
        const beam = carrierSection(z)[1];
        const x = side * beam * 0.44;
        const y = carrierBellyHeight(x, z) - 17;
        addBox('gunmetal', x, y + 4, z, 48, 9, 97, mats.gunmetal, false, true, -side * 0.20);
        for (let vane = -2; vane <= 2; vane++) {
          addBox('collar', x - side * vane * 3, y - 2, z + vane * 15, 44, 7, 5, mats.collarMat, false, true, -side * 0.20);
        }
        addBox('service', x - side * 15, y - 2, z - 41, 6, 3, 4, bayLight);
      }
    }
    for (let i = 0; i < 9; i++) {
      const z = -510 + 107 * i;
      const [, beam, , , belly, trench] = carrierSection(z);
      const aperture = beam * 0.105;
      const height = (trench - belly) * 0.29;
      addBox('gunmetal', 0, trench - height * 0.44, z, aperture * 2, height, 25, mats.gunmetal, false, true);
      for (const side of [-1, 1]) {
        addBox('service', side * aperture * 0.79, trench - height - 0.5, z, 3.8, 2.4, 8, bayLight);
      }
    }

    // Twin sensor housings step outward from the blunt nose into its chine.
    for (const side of [-1, 1]) {
      const fairing = [[937, 0.22], [858, 0.49], [750, 0.27], [827, 0.12]];
      batcher.add('collar', makeCarrierPlate(T, side, fairing, 13, 2), mats.collarMat,
        batcher.transform(), false, true);
      addBox('gunmetal', side * 12, -65, 871, 13, 9, 43, mats.gunmetal, false, true, side * 0.16);
      addBox('service', side * 12, -70, 871, 4, 3, 8, bayLight);
    }

    // Lateral defensive barbettes / dual-barrel turrets (symmetric port & starboard)
    for (const [tx, tz] of [[200, 210], [280, -55], [355, -320]]) {
      for (const side of [-1, 1]) {
        addCarrierTurret(batcher, T, mats, side * tx, 8, tz, side * 0.48);
      }
    }

    // 5 rear ionic thruster banks + 2 outboard wing-root verniers
    for (const [ex, r] of [[-205, 38], [-102, 42], [0, 46], [102, 42], [205, 38]]) {
      addCarrierEngineBank(batcher, T, mats, ex, -42, -595, r);
    }
    for (const side of [-1, 1]) {
      addCarrierEngineBank(batcher, T, mats, side * 365, -44, -650, 24);
    }

    return batcher.flushInto(carrier);
  }

  // ---------------------------------------------------------------------------
  // 3. Colossal Cylindrical Mothership (`dreadnought1` / `dreadnought2`)
  // ---------------------------------------------------------------------------
  function axialShell(T, stations, segments = 40, start = 0, span = Math.PI * 2) {
    const profile = stations.map(([x, r]) => new T.Vector2(r, x));
    const geo = new T.LatheGeometry(profile, segments, start, span);
    geo.rotateZ(-Math.PI * 0.5);
    return geo;
  }

  function buildDreadnought(T, matsArg) {
    const mats = ensureMats(T, matsArg);
    const group = new T.Group();
    const batcher = createBatcher(T);
    const unitBox = cachedGeo(T, 'unit_box', () => new T.BoxGeometry(1, 1, 1));

    const addBox = (bucket, x, y, z, w, h, d, mat, cast = false, receive = false, rx = 0, rz = 0) => {
      batcher.add(bucket, unitBox, mat, batcher.transform(x, y, z, rx, 0, rz, w, h, d), cast, receive);
    };

    // A continuous inner pressure hull is visible through breaks between armor
    // sectors. The mixed beam lengths leave a long open machinery bay aft.
    const core = axialShell(T, [[-529,97],[-485,131],[-300,130],[-220,115],
      [156,115],[252,124],[370,110],[480,120],[529,100]]);
    batcher.add('dark', core, mats.darkMetal, batcher.transform(), true, true);
    const bays = [[-518,-338,144],[-331,-210,153],[-190,40,146],
      [49,234,139],[253,337,137],[425,525,138]];
    for (let i = 0; i < bays.length; i++) {
      const [x0,x1,r] = bays[i];
      const rows = [[x0,r-11],[x0+5,r-4],[x0+13,r],[x1-11,r+1],[x1-3,r-3],[x1,r-12]];
      for (let j = 0; j < 8; j++) {
        const angularStep = Math.PI / 4;
        const offset = j * angularStep + (i % 2 ? 0.09 : 0);
        const width = angularStep - ((j === 2 || j === 6) ? 0.10 : 0.025);
        const shell = axialShell(T, rows, 6, offset, width);
        const key = (i + j * 3) % 5 === 0 ? 'dark' : 'plate';
        batcher.add(key, shell, key === 'dark' ? mats.darkMetal : mats.plateMat,
          batcher.transform(), true, true);
      }
    }
    for (const x of [-337,-207,42,243,342,418]) {
      const r = x > 300 ? 126 : 146;
      const frame = axialShell(T, [[-6,r-12],[-4,r+2],[0,r+5],[5,r+2],[7,r-12]]);
      batcher.add('collar', frame, mats.collarMat, batcher.transform(x,0,0), true, true);
    }
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      const y = Math.cos(a), z = Math.sin(a);
      addBox('gunmetal', 380,y*119,z*119,90,15,8,mats.gunmetal,false,false,a,-0.08);
      addBox('collar', 368,y*124,z*124,56,8,13,mats.collarMat,false,true,a,0.12);
    }

    // Recessed service galleries between the armor collars.
    for (const ang of [-Math.PI * 0.5, Math.PI * 0.5, -Math.PI * 0.22, Math.PI * 0.22]) {
      const radialY = Math.cos(ang);
      const radialZ = Math.sin(ang);
      for (const x of [-375, -225, -75, 75, 225, 375]) {
        addBox('gunmetal', x, radialY * 140, radialZ * 140, 82, 6, 13, mats.gunmetal, false, false, ang);
        for (const dx of [-29, -12, 5, 26]) {
          addBox('bridge', x + dx, radialY * 143, radialZ * 143, 7, 1.5, 3, mats.bridgeLights, false, false, ang);
        }
      }
    }

    // Beveled conical bow (-X) and stern (+X) with reaction collectors & luminous core
    const shroudGeo = axialShell(T, [[-16,64],[-8,68],[8,66],[10,60],[-12,41]]);
    const intake = axialShell(T, [[-8,36],[-8,4],[-6,0]]);

    for (const side of [-1, 1]) {
      const cap1Geo = new T.CylinderGeometry(102, 138, 78, 32);
      cap1Geo.rotateZ(-side * Math.PI / 2);
      batcher.add('collar', cap1Geo, mats.collarMat, batcher.transform(side * 559, 0, 0), true, false);

      const cap2Geo = new T.CylinderGeometry(58, 102, 58, 24);
      cap2Geo.rotateZ(-side * Math.PI / 2);
      batcher.add('hull', cap2Geo, mats.hullMat, batcher.transform(side * 627, 0, 0), true, false);

      for (let v = 0; v < 8; v++) {
        const theta = (v * Math.PI) / 4;
        addBox('gunmetal', side * 590, Math.cos(theta) * 102, Math.sin(theta) * 102, 105, 14, 10, mats.gunmetal, false, false, theta, -side * 0.50);
      }

      const turn = side > 0 ? 0 : Math.PI;
      batcher.add('collar', shroudGeo, mats.collarMat, batcher.transform(side * 664, 0, 0, 0, turn), false, true);
      batcher.add('gunmetal', intake, mats.gunmetal, batcher.transform(side * 665, 0, 0, 0, turn));
      for (let i = 0; i < 10; i++) {
        const a = i * Math.PI * 0.2, y = Math.cos(a), z = Math.sin(a);
        addBox('gunmetal', side * 664, y*33, z*33, 7, 26, 3, mats.gunmetal, false, false, a);
        if (side > 0) addBox('engine', 658, y*40,z*40,3,4,13,mats.engineGlow,false,false,a);
      }
    }

    // Multi-level ventral hangar keel with illuminated bays
    addBox('plate', 0, -124, 0, 860, 56, 158, mats.plateMat, true, true);
    for (const side of [-1, 1]) {
      addBox('hull', 0, -160, side * 56, 780, 42, 42, mats.hullMat, true, false);
      addBox('collar', 0, -176, side * 56, 680, 12, 26, mats.collarMat, false, false);
    }
    addBox('gunmetal', 0, -148, 0, 760, 14, 80, mats.gunmetal);
    for (let i = -3; i <= 3; i++) {
      const bx = i * 105;
      addBox('collar', bx + 52, -164, 0, 12, 28, 92, mats.collarMat);
      for (const side of [-1, 1]) {
        addBox('bridge', bx, -157, side * 31, 9, 3, 5, mats.bridgeLights);
      }
    }

    // Dorsal command tower & sensor masts
    addBox('hull', -110, 152, 0, 290, 48, 104, mats.hullMat, true, true);
    addBox('plate', -125, 192, 0, 185, 38, 74, mats.plateMat, true, true);
    addBox('collar', -135, 224, 0, 110, 28, 56, mats.collarMat, true, false);
    for (let i = 0; i < 6; i++) {
      const bz = -20 + i * 8;
      addBox('bridge', -192, 225, bz, 4, 5, 5, mats.bridgeLights);
      addBox('bridge', -78, 225, bz, 4, 5, 5, mats.bridgeLights);
    }
    const mastGeo = new T.CylinderGeometry(2.5, 5.5, 68, 8);
    const beaconGeo = new T.SphereGeometry(3.2, 8, 8);
    for (const mx of [-155, -105]) {
      batcher.add('gunmetal', mastGeo, mats.gunmetal, batcher.transform(mx, 268, 0), false, false);
      addBox('gunmetal', mx, 282, 0, 6, 4, 32, mats.gunmetal);
      batcher.add('beacon', beaconGeo, mats.beaconGlow, batcher.transform(mx, 304, 0), false, false);
    }

    return batcher.flushInto(group);
  }

  // ---------------------------------------------------------------------------
  // 4. High-Detail Stealth Fighter (`fighter` & Allied Wingman F-35A)
  // ---------------------------------------------------------------------------
  function buildFighterBatches(T, isAlly) {
    const cacheKey = isAlly ? 'fighter_batches_ally_v1' : 'fighter_batches_enemy_v1';
    return cachedGeo(T, cacheKey, () => {
      const stations = [
        { z: 1.44, pts: [[0, 0.008], [0.012, 0.004], [0.016, -0.006], [0.01, -0.012], [0, -0.015], [-0.01, -0.012], [-0.016, -0.006], [-0.012, 0.004]] },
        { z: 1.15, pts: [[0, 0.055], [0.055, 0.032], [0.095, -0.01], [0.06, -0.05], [0, -0.065], [-0.06, -0.05], [-0.095, -0.01], [-0.055, 0.032]] },
        { z: 0.72, pts: [[0, 0.125], [0.105, 0.085], [0.205, 0.005], [0.125, -0.08], [0, -0.105], [-0.125, -0.08], [-0.205, 0.005], [-0.105, 0.085]] },
        { z: 0.30, pts: [[0, 0.17], [0.14, 0.115], [0.30, 0.015], [0.185, -0.10], [0, -0.13], [-0.185, -0.10], [-0.30, 0.015], [-0.14, 0.115]] },
        { z: -0.18, pts: [[0, 0.195], [0.185, 0.135], [0.36, 0.02], [0.225, -0.11], [0, -0.14], [-0.225, -0.11], [-0.36, 0.02], [-0.185, 0.135]] },
        { z: -0.68, pts: [[0, 0.155], [0.195, 0.115], [0.32, 0.01], [0.21, -0.10], [0, -0.125], [-0.21, -0.10], [-0.32, 0.01], [-0.195, 0.115]] },
        { z: -1.06, pts: [[0, 0.105], [0.185, 0.085], [0.265, 0.0], [0.19, -0.085], [0, -0.10], [-0.19, -0.085], [-0.265, 0.0], [-0.185, 0.085]] }
      ];
      const fuselageGeo = buildLoftedStealthBody(T, stations);

      const spineStations = [
        { z: 0.08, pts: [[0, 0.19], [0.06, 0.17], [0.09, 0.13], [0.06, 0.11], [0, 0.10], [-0.06, 0.11], [-0.09, 0.13], [-0.06, 0.17]] },
        { z: -0.35, pts: [[0, 0.24], [0.08, 0.21], [0.12, 0.14], [0.08, 0.11], [0, 0.10], [-0.08, 0.11], [-0.12, 0.14], [-0.08, 0.21]] },
        { z: -0.96, pts: [[0, 0.15], [0.05, 0.13], [0.08, 0.09], [0.05, 0.07], [0, 0.06], [-0.05, 0.07], [-0.08, 0.09], [-0.05, 0.13]] }
      ];
      const spineGeo = buildLoftedStealthBody(T, spineStations);

      const wingShape = new T.Shape();
      wingShape.moveTo(0.22, -0.46);
      wingShape.lineTo(1.40, 0.14);
      wingShape.lineTo(1.36, 0.44);
      wingShape.lineTo(0.84, 0.48);
      wingShape.lineTo(0.76, 0.40);
      wingShape.lineTo(0.24, 0.44);
      wingShape.lineTo(-0.24, 0.44);
      wingShape.lineTo(-0.76, 0.40);
      wingShape.lineTo(-0.84, 0.48);
      wingShape.lineTo(-1.36, 0.44);
      wingShape.lineTo(-1.40, 0.14);
      wingShape.lineTo(-0.22, -0.46);
      wingShape.closePath();
      const wingGeo = new T.ExtrudeGeometry(wingShape, {
        depth: 0.032, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.014, bevelSegments: 2, steps: 1
      });
      wingGeo.rotateX(-Math.PI / 2);
      wingGeo.translate(0, -0.01, -0.10);
      scaleUVs(wingGeo, 0.55, 0.55);

      const makeSideCanard = (sign) => {
        const s = new T.Shape();
        s.moveTo(sign * 0.18, -0.14);
        s.lineTo(sign * 0.54, 0.04);
        s.lineTo(sign * 0.50, 0.15);
        s.lineTo(sign * 0.16, 0.10);
        s.closePath();
        const g = new T.ExtrudeGeometry(s, {
          depth: 0.018, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1, steps: 1
        });
        g.rotateX(-Math.PI / 2);
        scaleUVs(g, 1.2, 1.2);
        return g;
      };
      const canardRGeo = makeSideCanard(1);
      const canardLGeo = makeSideCanard(-1);

      const tailShape = new T.Shape();
      tailShape.moveTo(0, 0);
      tailShape.lineTo(0.44, 0);
      tailShape.lineTo(0.56, 0.52);
      tailShape.lineTo(0.30, 0.52);
      tailShape.closePath();
      const tailGeo = new T.ExtrudeGeometry(tailShape, {
        depth: 0.022, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1, steps: 1
      });
      tailGeo.translate(-0.22, 0, -0.011);
      tailGeo.rotateY(Math.PI / 2);
      scaleUVs(tailGeo, 1.4, 1.4);

      const rudderGeo = new T.BoxGeometry(0.026, 0.40, 0.09);
      rudderGeo.rotateX(-0.227);
      const intakeCowlGeo = new T.BoxGeometry(0.16, 0.16, 0.62);
      const intakeDuctGeo = new T.BoxGeometry(0.11, 0.11, 0.06);
      const intakeLipGeo = new T.BoxGeometry(0.17, 0.03, 0.18);
      const pylonGeo = new T.BoxGeometry(0.028, 0.08, 0.34);

      const missileBodyGeo = new T.CylinderGeometry(0.022, 0.022, 0.56, 8);
      missileBodyGeo.rotateX(Math.PI / 2);
      const missileNoseGeo = new T.ConeGeometry(0.022, 0.09, 8);
      missileNoseGeo.rotateX(Math.PI / 2);
      const missileFinGeo = new T.BoxGeometry(0.085, 0.008, 0.07);

      const canopyGeo = new T.SphereGeometry(0.155, 20, 14);
      const canopyArcGeo = new T.TorusGeometry(0.132, 0.016, 8, 18, Math.PI);
      const canopyRailGeo = new T.BoxGeometry(0.024, 0.022, 0.68);

      const nozzleOuterGeo = new T.CylinderGeometry(0.115, 0.092, 0.24, 12);
      nozzleOuterGeo.rotateX(Math.PI / 2);
      const nozzleCollarGeo = new T.TorusGeometry(0.098, 0.016, 8, 14);
      const nozzleInnerGeo = new T.CylinderGeometry(0.082, 0.082, 0.05, 12);
      nozzleInnerGeo.rotateX(Math.PI / 2);
      const burnerOuterGeo = new T.ConeGeometry(0.088, 0.66, 12);
      burnerOuterGeo.rotateX(-Math.PI / 2);
      const burnerInnerGeo = new T.ConeGeometry(0.05, 0.44, 10);
      burnerInnerGeo.rotateX(-Math.PI / 2);

      const batcher = createBatcher(T);
      const hullSlot = 'hull';
      const wingSlot = isAlly ? 'hull' : 'wing';

      batcher.add(hullSlot, fuselageGeo, hullSlot, batcher.transform());
      batcher.add(hullSlot, spineGeo, hullSlot, batcher.transform());
      batcher.add(wingSlot, wingGeo, wingSlot, batcher.transform(0, 0.015, 0));
      batcher.add(wingSlot, canardRGeo, wingSlot, batcher.transform(0, 0.025, 0.56));
      batcher.add(wingSlot, canardLGeo, wingSlot, batcher.transform(0, 0.025, 0.56));

      batcher.add('canopy', canopyGeo, 'canopy', batcher.transform(0, 0.145, 0.34, 0, 0, 0, 0.84, 0.68, 2.35));
      batcher.add('gunmetal', canopyArcGeo, 'gunmetal', batcher.transform(0, 0.125, 0.25));

      for (const side of [-1, 1]) {
        batcher.add('gunmetal', canopyRailGeo, 'gunmetal', batcher.transform(side * 0.118, 0.118, 0.34));

        // Lateral DSI intake + lip + dark internal duct aligned with intake yaw
        const iy = side * 0.06;
        const sinI = Math.sin(iy), cosI = Math.cos(iy);
        const ix = side * 0.22, iz = 0.04;
        batcher.add(hullSlot, intakeCowlGeo, hullSlot, batcher.transform(ix, -0.02, iz, 0, iy, 0));
        batcher.add('plate', intakeLipGeo, 'plate', batcher.transform(ix + sinI * 0.24, 0.055, iz + cosI * 0.24, 0.22, iy, 0));
        batcher.add('gunmetal', intakeDuctGeo, 'gunmetal', batcher.transform(ix + sinI * 0.295, -0.02, iz + cosI * 0.295, 0, iy, 0));

        // Wingtip missile
        batcher.add('plate', missileBodyGeo, 'plate', batcher.transform(side * 1.40, 0.015, -0.35));
        batcher.add('gunmetal', missileNoseGeo, 'gunmetal', batcher.transform(side * 1.40, 0.015, -0.025));
        batcher.add('gunmetal', missileFinGeo, 'gunmetal', batcher.transform(side * 1.40, 0.015, -0.57));

        // Underwing pylon & tactical missile
        batcher.add('gunmetal', pylonGeo, 'gunmetal', batcher.transform(side * 0.68, -0.04, -0.28));
        batcher.add('plate', missileBodyGeo, 'plate', batcher.transform(side * 0.68, -0.095, -0.24));
        batcher.add('gunmetal', missileNoseGeo, 'gunmetal', batcher.transform(side * 0.68, -0.095, 0.085));
        batcher.add('gunmetal', missileFinGeo, 'gunmetal', batcher.transform(side * 0.68, -0.095, -0.46));

        // Canted V-tail fin & aligned rudder
        const fz = -side * 0.48;
        batcher.add(hullSlot, tailGeo, hullSlot, batcher.transform(side * 0.24, 0.065, -0.78, 0, 0, fz));
        const rLocalY = 0.26;
        const rWorldX = side * 0.24 - rLocalY * Math.sin(fz);
        const rWorldY = 0.065 + rLocalY * Math.cos(fz);
        batcher.add('gunmetal', rudderGeo, 'gunmetal', batcher.transform(rWorldX, rWorldY, -0.78 - 0.28, 0, 0, fz));

        // Twin segmented afterburner nozzle + HDR plasma plume
        const nx = side * 0.125;
        batcher.add('gunmetal', nozzleOuterGeo, 'gunmetal', batcher.transform(nx, -0.01, -1.12));
        batcher.add('collar', nozzleCollarGeo, 'collar', batcher.transform(nx, -0.01, -1.23));
        batcher.add('burner', nozzleInnerGeo, 'burner', batcher.transform(nx, -0.01, -1.22));
        batcher.add('burner', burnerOuterGeo, 'burner', batcher.transform(nx, -0.01, -1.53));
        batcher.add('plasma', burnerInnerGeo, 'plasma', batcher.transform(nx, -0.01, -1.42));
      }

      if (!canMerge(T)) return { unmerged: batcher };
      return { merged: batcher.buildMergedGeometries() };
    });
  }

  function createFighterMesh(T, matsArg, isAlly = false) {
    const mats = ensureMats(T, matsArg);
    const matMap = {
      hull: isAlly ? mats.allyHull : mats.fighterHull,
      wing: isAlly ? mats.allyHull : mats.fighterWing,
      canopy: mats.canopyGold,
      gunmetal: mats.gunmetal,
      plate: mats.plateMat,
      collar: mats.collarMat,
      burner: isAlly ? mats.allyBurner : mats.afterburner,
      plasma: mats.plasmaCore
    };

    const g = new T.Group();
    g.rotation.order = 'YXZ';

    const built = buildFighterBatches(T, isAlly);
    if (built.merged) {
      for (let i = 0; i < built.merged.length; i++) {
        const b = built.merged[i];
        g.add(new T.Mesh(b.geo, matMap[b.mat]));
      }
      return g;
    }

    // Minimal mock fallback
    const fallbackGroup = built.unmerged.flushInto(g);
    for (let i = 0; i < fallbackGroup.children.length; i++) {
      const m = fallbackGroup.children[i];
      if (typeof m.material === 'string') m.material = matMap[m.material] || matMap.hull;
    }
    return fallbackGroup;
  }

  // ---------------------------------------------------------------------------
  // 5. High-Geometry Celestial Sphere (`sphere`)
  // ---------------------------------------------------------------------------
  function getSphereGeometries(T) {
    return cachedGeo(T, 'sphere_geos', () => {
      const shell = [];
      const seams = [];
      const fittings = [];
      const lamps = [];
      const identity = makeMatrix(T);
      const tau = Math.PI * 2;

      // Curved hull gores sit on a recessed pressure vessel. Open panel gaps
      // catch the sky on their edges while the backing remains in shadow.
      for (let row = 0; row < 4; row++) {
        const theta = Math.PI * row / 4;
        const columns = row === 0 || row === 3 ? 4 : 7;
        for (let c = 0; c < columns; c++) {
          const a = (c + (row % 2 ? 0.36 : 0)) * tau / columns;
          const geo = new T.SphereGeometry(1 + 0.008 * ((row + c) % 3),
            Math.ceil(40 / columns), 7, a + 0.016, tau / columns - 0.032,
            theta + 0.016, Math.PI / 4 - 0.032);
          shell.push({ geo, matrix: identity });
        }
      }
      seams.push({geo:new T.SphereGeometry(0.965,32,20), matrix:identity});
      const socket = new T.CylinderGeometry(0.205,0.269,0.096,22);
      seams.push({geo:socket,matrix:makeMatrix(T,0,-0.08,-0.982,Math.PI*0.5)});
      const rim = new T.TorusGeometry(0.191,0.021,6,30);
      fittings.push({geo:rim,matrix:makeMatrix(T,0,-0.08,-1.034)});
      const box = cachedGeo(T,'unit_box',()=>new T.BoxGeometry(1,1,1));
      for (let i=0; i<11; i++) {
        const a = tau * i / 11;
        const x = Math.sin(a), z = Math.cos(a);
        fittings.push({geo:box,matrix:makeMatrix(T,x*1.008,0,z*1.008,0,a,0,0.070,0.104,0.035)});
        if (i%3===0) lamps.push({geo:box,matrix:makeMatrix(T,x*1.031,0,z*1.031,0,a,0,0.038,0.016,0.007)});
      }
      const lens = new T.SphereGeometry(0.126,18,10);
      lamps.push({geo:lens,matrix:makeMatrix(T,0,-0.08,-1.031,0,0,0,1,1,0.21)});

      // Independently rotating yokes are rectangular machined sections with
      // interrupted races and broad bearing blocks, all within the hull envelope.
      function race(radius, width, depth, start, span) {
        const profile = [[radius-depth,-width],[radius,-width],[radius+0.012,-width+0.008],
          [radius+0.012,width-0.008],[radius,width],[radius-depth,width],[radius-depth,-width]];
        const raceGeo = new T.LatheGeometry(profile.map(([r,h])=>new T.Vector2(r,h)),36,start,span);
        raceGeo.rotateX(Math.PI*0.5);
        return raceGeo;
      }
      const mainRace = [
        {geo:race(1.097,0.039,0.045,0,tau*0.70),matrix:identity},
        {geo:race(1.097,0.065,0.053,tau*0.75,tau*0.19),matrix:identity}
      ];
      const secondRace = [
        {geo:race(1.055,0.030,0.030,0.45,tau*0.52),matrix:identity},
        {geo:race(1.055,0.038,0.042,4.05,tau*0.26),matrix:identity}
      ];
      return {
        coreGeo:mergeEntries(T,shell), backing:mergeEntries(T,seams),
        fittings:mergeEntries(T,fittings), lamps:mergeEntries(T,lamps),
        ring1:mergeEntries(T,mainRace), ring2:mergeEntries(T,secondRace)
      };
    });
  }

  function createSphereMesh(T,matsArg) {
    const mats = ensureMats(T,matsArg);
    const g = new T.Group();
    if (!canMerge(T)) {
      const coreSphere = new T.Mesh(new T.SphereGeometry(1,20,14),mats.sphereObsidian);
      const ring1 = new T.Mesh(new T.TorusGeometry(1.095,0.034,6,28),mats.ringGold);
      const ring2 = new T.Mesh(new T.TorusGeometry(1.055,0.026,6,28),mats.collarMat);
      ring1.rotation.x=Math.PI*0.42; ring2.rotation.y=Math.PI*0.35;
      g.add(coreSphere,ring1,ring2);
      g.userData={coreSphere,ring1,ring2,mats};
      return g;
    }
    const geo = getSphereGeometries(T);
    const coreSphere = new T.Mesh(geo.coreGeo,mats.sphereObsidian);
    const ring1 = new T.Mesh(geo.ring1,mats.ringGold);
    const ring2 = new T.Mesh(geo.ring2,mats.collarMat);
    ring1.rotation.x = Math.PI * 0.42;
    ring2.rotation.y = Math.PI * 0.35;
    g.add(coreSphere,ring1,ring2,new T.Mesh(geo.backing,mats.gunmetal),
      new T.Mesh(geo.fittings,mats.plateMat),new T.Mesh(geo.lamps,mats.plasmaCore));
    g.userData = {coreSphere,ring1,ring2,mats};
    return g;
  }

  // ---------------------------------------------------------------------------
  // 6. Armored Solar Cylinder (`cylinder`, aligned along X, ~3.2 long, ~0.52 radius)
  // ---------------------------------------------------------------------------
  function getCylinderBatches(T) {
    return cachedGeo(T, 'cylinder_batches', () => {
      const batcher = createBatcher(T);
      const box = cachedGeo(T,'unit_box',()=>new T.BoxGeometry(1,1,1));
      const id = batcher.transform();
      const hull = axialShell(T,[[-1.68,0.02],[-1.62,0.24],[-1.41,0.43],[-1.10,0.47],
        [0.32,0.485],[0.67,0.42],[0.89,0.34],[1.49,0.41],[1.57,0.28],[1.57,0.01]],32);
      batcher.add('hull',hull,'hull',id);
      // Unequal warm and cool alloy shell segments separated by exposed
      // cylindrical machinery. The stern is an open annulus with a deep hub.
      for (const [lo,hi,r] of [[-1.42,-0.86,0.51],[-0.82,-0.34,0.54],[-0.30,0.57,0.555],[1.04,1.42,0.465]]) {
        for (let j=0; j<5; j++) {
          const tile=axialShell(T,[[lo,r-0.065],[lo+0.045,r],[hi-0.055,r+0.01],[hi,r-0.055]],
            7,j*Math.PI*0.4+0.03,Math.PI*0.4-0.06);
          const mat=j===3?'collar':'plate';
          batcher.add(mat,tile,mat,id);
        }
      }
      const rim=axialShell(T,[[1.32,0.44],[1.46,0.46],[1.65,0.39],[1.66,0.34],[1.48,0.27]],28);
      batcher.add('gold',rim,'gold',id);
      const pin = new T.CylinderGeometry(0.025,0.025,0.51,7);
      pin.rotateZ(Math.PI*0.5);
      for(let i=0;i<12;i++) {
        const a=i*Math.PI/6, y=Math.cos(a), z=Math.sin(a);
        batcher.add('gunmetal',pin,'gunmetal',batcher.transform(0.811,y*0.423,z*0.423));
        if(i%2===0) {
          batcher.add('plasma',box,'plasma',batcher.transform(1.58,y*0.31,z*0.31,a,0,0,0.02,0.035,0.10));
          batcher.add('plasma',box,'plasma',batcher.transform(-0.13,y*0.561,z*0.561,a,0,0,0.095,0.015,0.026));
        }
      }
      batcher.add('gunmetal',box,'gunmetal',batcher.transform(-0.12,-0.49,0,0,0,0,1.43,0.16,0.30));
      batcher.add('plate',box,'plate',batcher.transform(-0.24,-0.59,0,0,0,0,0.55,0.12,0.24));
      if (!canMerge(T)) return { unmerged: batcher };
      return { merged: batcher.buildMergedGeometries() };
    });
  }

  function createCylinderMesh(T, matsArg) {
    const mats = ensureMats(T, matsArg);
    const matMap = {
      hull: mats.fighterHull,
      plate: mats.plateMat,
      gold: mats.ringGold,
      collar: mats.collarMat,
      gunmetal: mats.gunmetal,
      plasma: mats.plasmaCore
    };
    const g = new T.Group();
    const built = getCylinderBatches(T);
    if (built.merged) {
      for (let i = 0; i < built.merged.length; i++) {
        const b = built.merged[i];
        g.add(new T.Mesh(b.geo, matMap[b.mat]));
      }
      return g;
    }
    const fallbackGroup = built.unmerged.flushInto(g);
    for (let i = 0; i < fallbackGroup.children.length; i++) {
      const m = fallbackGroup.children[i];
      if (typeof m.material === 'string') m.material = matMap[m.material] || mats.fighterHull;
    }
    return fallbackGroup;
  }

  // ---------------------------------------------------------------------------
  // 7. Celestial Cross (`cross`)
  // ---------------------------------------------------------------------------
  function getCrossBatches(T) {
    return cachedGeo(T, 'cross_batches', () => {
      const batcher = createBatcher(T);
      const box = cachedGeo(T,'unit_box',()=>new T.BoxGeometry(1,1,1));
      const shape = new T.Shape();
      shape.moveTo(0.17,-0.16); shape.lineTo(0.65,-0.11); shape.lineTo(1.19,-0.17);
      shape.lineTo(1.32,-0.09); shape.lineTo(1.32,0.075); shape.lineTo(0.76,0.10);
      shape.lineTo(0.25,0.21); shape.closePath();
      const spar = new T.ExtrudeGeometry(shape,{depth:0.09,bevelEnabled:true,bevelSegments:1,
        bevelSize:0.022,bevelThickness:0.026,steps:1});
      spar.translate(0,0,-0.045);
      const bearing = new T.CylinderGeometry(0.25,0.28,0.21,20);
      bearing.rotateX(Math.PI*0.5);
      const face = new T.CylinderGeometry(0.20,0.22,0.045,16);
      face.rotateX(Math.PI*0.5);
      const center = new T.CylinderGeometry(0.39,0.36,0.40,12);
      center.rotateX(Math.PI*0.5);
      batcher.add('hull',center,'hull',batcher.transform());
      batcher.add('collar',new T.TorusGeometry(0.29,0.026,6,24),'collar',batcher.transform(0,0,-0.20));
      const recess = new T.CylinderGeometry(0.23,0.23,0.028,16);
      recess.rotateX(Math.PI*0.5);
      batcher.add('chrome',recess,'chrome',batcher.transform(0,0,-0.205));
      for(let i=0;i<4;i++) {
        const a=i*Math.PI*0.5;
        const x=Math.cos(a),y=Math.sin(a);
        batcher.add('hull',spar,'hull',batcher.transform(0,0,0,0,0,a));
        batcher.add('collar',bearing,'collar',batcher.transform(x*1.10,y*1.10,0.062));
        batcher.add('chrome',face,'chrome',batcher.transform(x*1.10,y*1.10,0.184));
        // Paired longitudinal braces leave a slit of daylight between blades.
        batcher.add('gold',box,'gold',batcher.transform(x*0.72-y*0.19,y*0.72+x*0.19,-0.043,0,0,a-0.16,0.78,0.045,0.055));
        batcher.add('collar',box,'collar',batcher.transform(x*0.53,y*0.53,-0.084,0,0,a,0.18,0.37,0.050));
        batcher.add('plasma',box,'plasma',batcher.transform(x*1.12,y*1.12,-0.075,0,0,a,0.14,0.032,0.016));
        batcher.add('plasma',box,'plasma',batcher.transform(x*0.15,y*0.15,-0.227,0,0,a,0.052,0.023,0.010));
      }
      if (!canMerge(T)) return { unmerged: batcher };
      return { merged: batcher.buildMergedGeometries() };
    });
  }

  function createCrossMesh(T, matsArg) {
    const mats = ensureMats(T, matsArg);
    const matMap = {
      hull: mats.fighterHull,
      collar: mats.collarMat,
      gold: mats.ringGold,
      chrome: mats.sphereChrome,
      plasma: mats.plasmaCore
    };
    const g = new T.Group();
    const built = getCrossBatches(T);
    if (built.merged) {
      for (let i = 0; i < built.merged.length; i++) {
        const b = built.merged[i];
        g.add(new T.Mesh(b.geo, matMap[b.mat]));
      }
      return g;
    }
    const fallbackGroup = built.unmerged.flushInto(g);
    for (let i = 0; i < fallbackGroup.children.length; i++) {
      const m = fallbackGroup.children[i];
      if (typeof m.material === 'string') m.material = matMap[m.material] || mats.fighterHull;
    }
    return fallbackGroup;
  }

  root.Models3D = {
    buildHullFinish,
    getSharedMaterials,
    buildCarrier,
    buildDreadnought,
    createFighterMesh,
    createSphereMesh,
    createCylinderMesh,
    createCrossMesh
  };
})();
