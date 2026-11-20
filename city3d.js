/* Medieval Nuremberg 1561 3D architecture, multi-biome PBR valley terrain,
 * fortified Stadtmauer, Pegnitz bridges, Kaiserburg, and Gothic cathedrals.
 * Targets Three.js r160 global (`window.THREE`) without bundler.
 */
(() => {
  'use strict';

  function createFallbackRandom(seedStart = 1561) {
    let s = seedStart;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function ensureMirroredWrapping(T, tex) {
    if (!tex || !T) return;
    tex.wrapS = T.MirroredRepeatWrapping;
    tex.wrapT = T.MirroredRepeatWrapping;
    tex.needsUpdate = true;
  }

  function paintProceduralValley(ctx, w, h, rand) {
    // 1. Base Franconian meadow wash + soft organic pasture variation (wrapped to avoid mirror seams)
    const baseGrad = ctx.createLinearGradient(0, 0, w, h);
    baseGrad.addColorStop(0, '#4f5a39');
    baseGrad.addColorStop(0.5, '#59633e');
    baseGrad.addColorStop(1, '#4a5535');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, w, h);

    const meadowTones = [
      'rgba(78, 92, 52, 0.36)',
      'rgba(62, 74, 42, 0.34)',
      'rgba(102, 108, 66, 0.30)',
      'rgba(52, 63, 38, 0.32)'
    ];
    for (let i = 0; i < 42; i++) {
      const cx = rand() * w;
      const cy = rand() * h;
      const r = 70 + rand() * 140;
      const tone = meadowTones[i % meadowTones.length];
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          const px = cx + ox, py = cy + oy;
          if (px + r < 0 || px - r > w || py + r < 0 || py - r > h) continue;
          const g = ctx.createRadialGradient(px, py, r * 0.1, px, py, r);
          g.addColorStop(0, tone);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px - r, py - r, r * 2, r * 2);
        }
      }
    }

    // 2. Rotated agricultural parcels: ocher wheat, brown fallow soil, and green pastures
    const cropStyles = [
      { base: '#ad904f', furrow: 'rgba(68, 52, 24, 0.34)', ridge: 'rgba(218, 194, 126, 0.24)', step: 5 },
      { base: '#5f4b35', furrow: 'rgba(28, 20, 14, 0.44)', ridge: 'rgba(130, 102, 74, 0.22)', step: 6 },
      { base: '#4d6537', furrow: 'rgba(32, 46, 22, 0.28)', ridge: 'rgba(118, 142, 78, 0.22)', step: 7 },
      { base: '#967b42', furrow: 'rgba(56, 44, 22, 0.35)', ridge: 'rgba(198, 174, 112, 0.20)', step: 5 },
      { base: '#6e583e', furrow: 'rgba(34, 24, 16, 0.38)', ridge: 'rgba(148, 122, 88, 0.20)', step: 6 }
    ];
    for (let i = 0; i < 38; i++) {
      const cx = 75 + rand() * (w - 150);
      const cy = 75 + rand() * (h - 150);
      const pw = 48 + rand() * 88;
      const ph = 34 + rand() * 68;
      const angle = (rand() - 0.5) * 1.45;
      const crop = cropStyles[i % cropStyles.length];

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.fillStyle = crop.base;
      ctx.fillRect(-pw / 2, -ph / 2, pw, ph);

      // Plowed furrows & crop rows for PBR normal/roughness relief
      ctx.lineWidth = 1.6;
      for (let y = -ph / 2 + 3; y < ph / 2 - 2; y += crop.step) {
        ctx.strokeStyle = crop.furrow;
        ctx.beginPath();
        ctx.moveTo(-pw / 2 + 2, y);
        ctx.lineTo(pw / 2 - 2, y);
        ctx.stroke();

        ctx.strokeStyle = crop.ridge;
        ctx.beginPath();
        ctx.moveTo(-pw / 2 + 2, y + 1.8);
        ctx.lineTo(pw / 2 - 2, y + 1.8);
        ctx.stroke();
      }

      // Hedgerow & dry-stone field boundary
      ctx.strokeStyle = 'rgba(34, 42, 22, 0.62)';
      ctx.lineWidth = 3;
      ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
      ctx.restore();
    }

    // 3. Dark Franconian woodlands (pine & oak canopy clusters)
    for (let c = 0; c < 14; c++) {
      const fx = 60 + rand() * (w - 120);
      const fy = 60 + rand() * (h - 120);
      const trees = 14 + Math.floor(rand() * 18);
      for (let t = 0; t < trees; t++) {
        const tx = fx + (rand() - 0.5) * 110;
        const ty = fy + (rand() - 0.5) * 95;
        const tr = 8 + rand() * 16;
        // Shadow under-canopy
        ctx.fillStyle = 'rgba(14, 20, 11, 0.55)';
        ctx.beginPath();
        ctx.arc(tx + 3, ty + 3, tr * 1.08, 0, Math.PI * 2);
        ctx.fill();
        // Dark foliage body
        const shade = Math.floor(rand() * 16);
        ctx.fillStyle = `rgb(${26 + shade}, ${38 + shade}, ${20 + Math.floor(shade * 0.6)})`;
        ctx.beginPath();
        ctx.arc(tx, ty, tr, 0, Math.PI * 2);
        ctx.fill();
        // Sun-kissed crown highlight
        ctx.fillStyle = 'rgba(92, 110, 60, 0.34)';
        ctx.beginPath();
        ctx.arc(tx - tr * 0.24, ty - tr * 0.24, tr * 0.52, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4. Wet riverbank mud & damp alluvial sandbars
    for (let r = 0; r < 5; r++) {
      const x0 = rand() * w * 0.35;
      const y0 = rand() * h;
      const x1 = w - rand() * w * 0.35;
      const y1 = rand() * h;
      const cx1 = w * (0.25 + rand() * 0.5);
      const cy1 = rand() * h;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(60, 50, 38, 0.52)';
      ctx.lineWidth = 26 + rand() * 14;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx1, cy1, x1, y1);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(134, 120, 94, 0.45)';
      ctx.lineWidth = 12 + rand() * 8;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx1, cy1, x1, y1);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Winding rural dirt country roads with verge & cart wheel ruts
    for (let r = 0; r < 4; r++) {
      const vertical = r % 2 === 0;
      const start = vertical ? [rand() * w, 0] : [0, rand() * h];
      const end = vertical ? [rand() * w, h] : [w, rand() * h];
      const cp1 = [w * (0.2 + rand() * 0.6), h * (0.2 + rand() * 0.6)];
      const cp2 = [w * (0.2 + rand() * 0.6), h * (0.2 + rand() * 0.6)];

      const strokeRoad = (width, color, offsetX = 0, offsetY = 0) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(start[0] + offsetX, start[1] + offsetY);
        ctx.bezierCurveTo(
          cp1[0] + offsetX, cp1[1] + offsetY,
          cp2[0] + offsetX, cp2[1] + offsetY,
          end[0] + offsetX, end[1] + offsetY
        );
        ctx.stroke();
      };

      ctx.save();
      ctx.lineCap = 'round';
      strokeRoad(15, 'rgba(66, 54, 38, 0.48)');
      strokeRoad(9, '#8b7757');
      strokeRoad(1.8, 'rgba(56, 43, 28, 0.48)', -2.2, -2.2);
      strokeRoad(1.8, 'rgba(56, 43, 28, 0.48)', 2.2, 2.2);
      ctx.restore();
    }

    // 6. Warm medieval cobblestone patches (city squares, courtyards, approach lanes)
    for (let p = 0; p < 7; p++) {
      const px = 140 + rand() * (w - 280);
      const py = 140 + rand() * (h - 280);
      const pw = 95 + rand() * 110;
      const ph = 75 + rand() * 90;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate((rand() - 0.5) * 0.5);
      ctx.fillStyle = '#53493d';
      ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      for (let sy = -ph / 2 + 2; sy < ph / 2 - 4; sy += 6) {
        const stagger = (Math.round(sy / 6) % 2) * 4;
        for (let sx = -pw / 2 + 2 + stagger; sx < pw / 2 - 6; sx += 8) {
          const v = rand();
          ctx.fillStyle = `rgb(${112 + Math.floor(v * 34)}, ${99 + Math.floor(v * 28)}, ${82 + Math.floor(v * 22)})`;
          ctx.fillRect(sx, sy, 6.2, 4.4);
        }
      }
      ctx.restore();
    }

    // 7. Scorched impact craters with soot halos, raised blast rims & ember ash
    for (let c = 0; c < 6; c++) {
      const cx = 110 + rand() * (w - 220);
      const cy = 110 + rand() * (h - 220);
      const cr = 18 + rand() * 26;

      // Wide blast soot halo
      const soot = ctx.createRadialGradient(cx, cy, cr * 0.2, cx, cy, cr * 2.1);
      soot.addColorStop(0, 'rgba(14, 11, 10, 0.86)');
      soot.addColorStop(0.42, 'rgba(26, 20, 16, 0.62)');
      soot.addColorStop(0.75, 'rgba(42, 34, 26, 0.25)');
      soot.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = soot;
      ctx.beginPath();
      ctx.arc(cx, cy, cr * 2.1, 0, Math.PI * 2);
      ctx.fill();

      // Radial blast ejecta rays
      ctx.save();
      ctx.strokeStyle = 'rgba(20, 15, 12, 0.42)';
      for (let ray = 0; ray < 10; ray++) {
        const a = (ray / 10) * Math.PI * 2 + rand() * 0.4;
        const len = cr * (1.2 + rand() * 1.1);
        ctx.lineWidth = 1.5 + rand() * 2.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * cr * 0.4, cy + Math.sin(a) * cr * 0.4);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
      }
      ctx.restore();

      // Highlighted crater lip for PBR Sobel slope & dark pit center
      ctx.strokeStyle = 'rgba(116, 98, 76, 0.42)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(cx, cy, cr * 0.72, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(18, 13, 11, 0.82)';
      ctx.beginPath();
      ctx.arc(cx, cy, cr * 0.56, 0, Math.PI * 2);
      ctx.fill();

      // Subtle glowing ash flecks inside the scorched core
      for (let e = 0; e < 8; e++) {
        const ea = rand() * Math.PI * 2;
        const er = rand() * cr * 0.4;
        ctx.fillStyle = 'rgba(164, 68, 24, 0.34)';
        ctx.fillRect(cx + Math.cos(ea) * er, cy + Math.sin(ea) * er, 2, 2);
      }
    }

    // 8. Fine tactile soil/pebble micro-grain for crisp close-range normal maps
    for (let i = 0; i < 20000; i++) {
      ctx.fillStyle = rand() > 0.5 ? 'rgba(20, 24, 14, 0.16)' : 'rgba(202, 188, 140, 0.12)';
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 4, 1 + rand() * 3);
    }
  }

  function applyValleyPBR(T, groundMat, soilCanvas, applyPBRToMaterial) {
    if (typeof applyPBRToMaterial !== 'function' || !groundMat || !soilCanvas) return null;
    const maps = applyPBRToMaterial(groundMat, soilCanvas, {
      strength: 2.2,
      baseRough: 0.9,
      roughSpread: 0.18,
      repeatX: 16,
      repeatY: 16,
      normalScale: 0.95
    });
    if (maps) {
      ensureMirroredWrapping(T, maps.normalMap);
      ensureMirroredWrapping(T, maps.roughnessMap);
    }
    ensureMirroredWrapping(T, groundMat.normalMap);
    ensureMirroredWrapping(T, groundMat.roughnessMap);
    groundMat.needsUpdate = true;
    return maps;
  }

  /** Paints the countryside. Houses, courtyards and streets are built in world space. */
  function enhanceValleyTerrain(T, sx, soilCanvas, soilMap, groundMat, applyPBRToMaterial, random) {
    if (!soilCanvas) return;
    const ctx = sx || (typeof soilCanvas.getContext === 'function' ? soilCanvas.getContext('2d') : null);
    if (!ctx) return;

    const rand = typeof random === 'function' ? random : createFallbackRandom(1561);
    const w = soilCanvas.width || 1024;
    const h = soilCanvas.height || 1024;

    paintProceduralValley(ctx, w, h, rand);
    ensureMirroredWrapping(T, soilMap);
    applyValleyPBR(T, groundMat, soilCanvas, applyPBRToMaterial);
  }

  /**
   * Merges an array of { geo, matrix } entries into one non-indexed BufferGeometry
   * preserving position, normal, and uv attributes.
   */
  function mergePartGeometries(T, parts) {
    const posChunks = [];
    const normChunks = [];
    const uvChunks = [];
    let totalVerts = 0;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const work = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
      if (part.matrix) work.applyMatrix4(part.matrix);
      if (!work.attributes.normal) work.computeVertexNormals();

      const pos = work.attributes.position;
      const norm = work.attributes.normal;
      const uv = work.attributes.uv;
      const count = pos.count;
      totalVerts += count;

      posChunks.push(pos.array.slice(0, count * 3));
      normChunks.push(norm.array.slice(0, count * 3));
      if (uv) {
        uvChunks.push(uv.array.slice(0, count * 2));
      } else {
        uvChunks.push(new Float32Array(count * 2));
      }
      work.dispose?.();
    }

    const posOut = new Float32Array(totalVerts * 3);
    const normOut = new Float32Array(totalVerts * 3);
    const uvOut = new Float32Array(totalVerts * 2);

    let pOff = 0, uOff = 0;
    for (let i = 0; i < posChunks.length; i++) {
      posOut.set(posChunks[i], pOff);
      normOut.set(normChunks[i], pOff);
      uvOut.set(uvChunks[i], uOff);
      pOff += posChunks[i].length;
      uOff += uvChunks[i].length;
    }

    const merged = new T.BufferGeometry();
    merged.setAttribute('position', new T.BufferAttribute(posOut, 3));
    merged.setAttribute('normal', new T.BufferAttribute(normOut, 3));
    merged.setAttribute('uv', new T.BufferAttribute(uvOut, 2));
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }

  function makeBoxPart(T, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    const geo = new T.BoxGeometry(w, h, d);
    const obj = new T.Object3D();
    obj.position.set(x, y, z);
    obj.rotation.set(rx, ry, rz);
    obj.updateMatrix();
    return { geo, matrix: obj.matrix.clone() };
  }

  function ensureRoofGeo(T, roofGeo) {
    if (roofGeo) return roofGeo;
    const profile = new T.Shape();
    profile.moveTo(-0.5, 0);
    profile.lineTo(0.5, 0);
    profile.lineTo(0, 1);
    profile.closePath();
    const g = new T.ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    return g;
  }

  function bakeGroupMeshesByMaterial(T, grp) {
    const invParent = new T.Matrix4().copy(grp.matrixWorld).invert();
    const buckets = new Map();
    const toRemove = [];

    grp.traverse(child => {
      if (!child.isMesh || child.isInstancedMesh) return;
      toRemove.push(child);
      const matId = (child.material && child.material.uuid) ? child.material.uuid : 'default';
      const key = `${matId}|${child.castShadow ? 1 : 0}|${child.receiveShadow ? 1 : 0}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          mat: child.material,
          cast: child.castShadow,
          receive: child.receiveShadow,
          parts: []
        };
        buckets.set(key, bucket);
      }
      const localMat = new T.Matrix4();
      if (child === grp) {
        localMat.identity();
      } else {
        localMat.multiplyMatrices(invParent, child.matrixWorld);
      }
      bucket.parts.push({ geo: child.geometry, matrix: localMat });
    });

    for (const child of toRemove) {
      if (child.parent) child.parent.remove(child);
    }

    for (const bucket of buckets.values()) {
      const mergedGeo = mergePartGeometries(T, bucket.parts);
      const mesh = new T.Mesh(mergedGeo, bucket.mat);
      mesh.castShadow = bucket.cast;
      mesh.receiveShadow = bucket.receive;
      grp.add(mesh);
    }
  }

  function createLandmarkHelper(T, parent) {
    const addMesh = (geo, mat, x, y, z, opts = {}) => {
      const mesh = new T.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      if (opts.rx || opts.ry || opts.rz) mesh.rotation.set(opts.rx || 0, opts.ry || 0, opts.rz || 0);
      if (opts.sx || opts.sy || opts.sz) mesh.scale.set(opts.sx || 1, opts.sy || 1, opts.sz || 1);
      mesh.castShadow = opts.cast !== false;
      mesh.receiveShadow = opts.receive !== false;
      parent.add(mesh);
      return mesh;
    };
    const addBox = (w, h, d, mat, x, y, z, opts = {}) =>
      addMesh(new T.BoxGeometry(w, h, d), mat, x, y + h * 0.5, z, opts);
    return { addMesh, addBox };
  }

  function buildGothicCathedral(T, parent, mats, roofGeo, cfg) {
    const { cx, cz, naveH, spireH, widthScale } = cfg;
    const grp = new T.Group();
    grp.name = cfg.name;
    parent.add(grp);
    const { addMesh, addBox } = createLandmarkHelper(T, grp);

    const wNave = 24 * widthScale;
    const dNave = 96;
    const aisleW = 12 * widthScale;
    const aisleH = 21;

    // Stepped plinth base
    addBox(56 * widthScale, 2.5, 124, mats.stoneMat, cx, -1, cz + 6);

    // High central nave + steep gable roof
    addBox(wNave, naveH, dNave, mats.stoneMat, cx, 0, cz + 4);
    addMesh(roofGeo, mats.roofMat, cx, naveH, cz + 4, {
      sx: wNave + 2.2, sy: 18, sz: dNave + 2
    });

    // Lower side aisles + lean-to sloped roofs
    const aisleX = wNave * 0.5 + aisleW * 0.5;
    for (const side of [-1, 1]) {
      addBox(aisleW, aisleH, 86, mats.stoneMat, cx + side * aisleX, 0, cz + 4);
      addMesh(new T.BoxGeometry(aisleW + 2.2, 1.8, 86), mats.capMat, cx + side * (aisleX + 0.5), aisleH + 1.8, cz + 4, {
        rz: -side * 0.42
      });
    }

    // Exterior buttresses, pinnacles, clerestory windows & inclined flying buttresses
    const bayZ = [-26, -10, 6, 22, 38];
    const pierGeo = new T.BoxGeometry(3.4, 27, 4.4);
    const pinGeo = new T.ConeGeometry(2.2, 8.5, 4);
    const flyerGeo = new T.BoxGeometry(13.5 * widthScale, 2.1, 2.0);
    const lancetGeo = new T.BoxGeometry(0.6, 8.5, 2.8);

    for (const side of [-1, 1]) {
      const pierX = cx + side * (wNave * 0.5 + aisleW + 1.6);
      const flyerX = cx + side * (wNave * 0.5 + aisleW * 0.52);
      const clereX = cx + side * (wNave * 0.5 + 0.15);

      for (let i = 0; i < bayZ.length; i++) {
        const bz = cz + bayZ[i];
        // Outer buttress pier + stone pinnacle
        addMesh(pierGeo, mats.stoneMat, pierX, 13.5, bz);
        addMesh(pinGeo, mats.stoneMat, pierX, 31.2, bz, { ry: Math.PI * 0.25 });

        // Double tier inclined flying buttress (arbotante)
        addMesh(flyerGeo, mats.stoneMat, flyerX, 24.5, bz, { rz: side * 0.44 });
        addMesh(flyerGeo, mats.stoneMat, flyerX, 29.8, bz, { rz: side * 0.44 });

        // Warm candlelit clerestory lancet window
        addMesh(lancetGeo, mats.stainedGlassMat, clereX, naveH - 6.5, bz, { cast: false, receive: false });
      }
    }

    // Transverse transept (crucero) + cross gable roof + central crossing flèche
    const transeptW = 64 * widthScale;
    const transeptH = naveH - 2;
    const transeptZ = cz + 22;
    addBox(transeptW, transeptH, 22, mats.stoneMat, cx, 0, transeptZ);
    addMesh(roofGeo, mats.roofMat, cx, transeptH, transeptZ, {
      ry: Math.PI * 0.5,
      sx: 23.5,
      sy: 17,
      sz: transeptW + 2
    });
    // Crossing lantern flèche
    addMesh(new T.CylinderGeometry(3.2, 3.6, 12, 8), mats.stoneMat, cx, transeptH + 17, transeptZ);
    addMesh(new T.ConeGeometry(3.8, 22, 8), mats.copperSpireMat, cx, transeptH + 34, transeptZ);

    // Transept end stained-glass lancets
    for (const side of [-1, 1]) {
      addMesh(new T.BoxGeometry(0.6, 14, 7), mats.stainedGlassMat, cx + side * (transeptW * 0.5 + 0.15), transeptH * 0.56, transeptZ, {
        cast: false, receive: false
      });
    }

    // Polygonal choir & apse (7/8-sided polygonal drum + conical roof + ambulatory)
    const apseZ = cz + 56;
    const choirR = 13.5 * widthScale;
    addMesh(new T.CylinderGeometry(choirR, choirR * 1.03, transeptH, 8), mats.stoneMat, cx, transeptH * 0.5, apseZ, {
      ry: Math.PI / 8
    });
    addMesh(new T.ConeGeometry(choirR + 1.2, 18, 8), mats.capMat, cx, transeptH + 9, apseZ, {
      ry: Math.PI / 8
    });
    // Lower radiating apse ambulatory
    addMesh(new T.CylinderGeometry(choirR + 5.2, choirR + 5.8, 19, 8), mats.stoneMat, cx, 9.5, apseZ + 2, {
      ry: Math.PI / 8
    });
    addMesh(new T.ConeGeometry(choirR + 6.4, 7.5, 8), mats.capMat, cx, 22.5, apseZ + 2, {
      ry: Math.PI / 8
    });
    // Choir tall stained-glass apse windows
    for (let a = -2; a <= 2; a++) {
      const ang = a * 0.42;
      addMesh(new T.BoxGeometry(2.6, 15, 0.7), mats.stainedGlassMat,
        cx + Math.sin(ang) * (choirR + 0.1), transeptH * 0.55, apseZ + Math.cos(ang) * (choirR + 0.1), {
          ry: ang, cast: false, receive: false
        });
    }

    // Stepped West Facade (facing -Z toward approaching aircraft)
    const westZ = cz - 44;
    addBox(22 * widthScale, naveH + 6, 7, mats.stoneMat, cx, 0, westZ - 2);
    // Stepped gable tiers over West portal
    for (let step = 0; step < 4; step++) {
      const sw = (19 - step * 4.2) * widthScale;
      addBox(sw, 3.6, 5.5, mats.stoneMat, cx, naveH + 6 + step * 3.6, westZ - 2);
    }
    // Deep recessed Gothic West Portal
    addBox(12, 14, 3.2, mats.stoneMat, cx, 0, westZ - 6.2);
    addBox(8.5, 11, 2.2, mats.darkWoodMat, cx, 0, westZ - 6.8);
    addMesh(roofGeo, mats.stoneMat, cx, 14, westZ - 6.2, { sx: 13, sy: 6.5, sz: 3.4 });

    // Relief Gothic Rose Window with radial stone tracery & warm candlelit stained glass
    const roseY = 29;
    const roseZ = westZ - 6.0;
    addMesh(new T.TorusGeometry(6.2, 0.9, 10, 24), mats.stoneMat, cx, roseY, roseZ);
    addMesh(new T.TorusGeometry(3.0, 0.48, 8, 18), mats.stoneMat, cx, roseY, roseZ - 0.15);
    addMesh(new T.CylinderGeometry(5.8, 5.8, 0.5, 24), mats.stainedGlassMat, cx, roseY, roseZ + 0.25, {
      rx: Math.PI * 0.5, cast: false, receive: false
    });
    const spokeGeo = new T.BoxGeometry(0.58, 12.0, 0.85);
    for (let s = 0; s < 4; s++) {
      addMesh(spokeGeo, mats.stoneMat, cx, roseY, roseZ - 0.18, { rz: (s * Math.PI) / 4 });
    }

    // Twin West Gothic Towers with string-course cornices, belfries, octagonal copper spires & 4 corner pinnacles
    const towerOffsetX = (wNave * 0.5 + 5.5) * widthScale;
    const towerH = 68;
    for (const side of [-1, 1]) {
      const tx = cx + side * towerOffsetX;
      const tz = cz - 44;

      // Main square stone shaft
      addBox(15.5, 50, 15.5, mats.stoneMat, tx, 0, tz);
      // Corner buttress pilasters
      for (const bx of [-7.3, 7.3]) {
        for (const bz of [-7.3, 7.3]) {
          addBox(2.8, 49, 2.8, mats.stoneMat, tx + bx, 0, tz + bz);
        }
      }
      // Projecting molded stone cornices
      for (const cy of [20, 35, 50, towerH]) {
        addBox(17.4, 1.8, 17.4, mats.stoneMat, tx, cy - 0.9, tz);
      }

      // Upper belfry level with dark recessed louvers + subtle warm interior lantern slit
      addBox(14.2, 18, 14.2, mats.stoneMat, tx, 50, tz);
      for (const face of [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5]) {
        const fx = tx + Math.sin(face) * 7.15;
        const fz = tz + Math.cos(face) * 7.15;
        addMesh(new T.BoxGeometry(5.2, 10.5, 0.7), mats.belfryDarkMat, fx, 59, fz, { ry: face, cast: false });
        addMesh(new T.BoxGeometry(1.4, 6.2, 0.85), mats.stainedGlassMat, fx, 58.5, fz, { ry: face, cast: false, receive: false });
      }

      // Octagonal belfry drum above cornice
      addMesh(new T.CylinderGeometry(5.5, 6.2, 10, 8), mats.stoneMat, tx, towerH + 5, tz, { ry: Math.PI / 8 });

      // Tall octagonal patinated dark-green copper spire + finial cross
      addMesh(new T.ConeGeometry(6.2, spireH, 8), mats.copperSpireMat, tx, towerH + 10 + spireH * 0.5, tz, {
        ry: Math.PI / 8
      });
      addBox(0.7, 7.5, 0.7, mats.ironMat, tx, towerH + 10 + spireH, tz);
      addBox(3.4, 0.6, 0.6, mats.ironMat, tx, towerH + 14.5 + spireH, tz);

      // 4 corner pinnacles surrounding the base of each copper spire
      for (const px of [-5.8, 5.8]) {
        for (const pz of [-5.8, 5.8]) {
          addBox(2.2, 10, 2.2, mats.stoneMat, tx + px, towerH, tz + pz);
          addMesh(new T.ConeGeometry(1.7, 9.5, 4), mats.copperSpireMat, tx + px, towerH + 14.5, tz + pz, {
            ry: Math.PI * 0.25
          });
        }
      }
    }
  }

  function buildKaiserburg(T, parent, mats, roofGeo) {
    const grp = new T.Group();
    grp.name = 'Kaiserburg';
    parent.add(grp);
    const { addMesh, addBox } = createLandmarkHelper(T, grp);

    // Centered in [-750..-600, 2800..2960]
    const kx = -685;
    const kz = 2875;
    const plateauY = 24;

    // 1. Sandstone rocky promontory / crag rising above the city
    addMesh(new T.CylinderGeometry(142, 174, plateauY + 2, 12), mats.sandstoneMat, kx, (plateauY - 2) * 0.5, kz, {
      sx: 1.12, sy: 1, sz: 1.06
    });
    const cragOffsets = [
      [-125, -90, 44, 21, 0.3], [122, -85, 42, 20, -0.4], [-135, 85, 48, 22, 0.6], [128, 90, 40, 19, -0.2],
      [0, -135, 52, 18, 0.1], [0, 136, 56, 20, 0.5], [-150, 0, 45, 22, 0.8], [140, 5, 38, 18, -0.6]
    ];
    for (const [ox, oz, rad, ch, rot] of cragOffsets) {
      addMesh(new T.CylinderGeometry(rad * 0.58, rad * 1.1, ch, 7), mats.sandstoneMat, kx + ox, ch * 0.5 - 2, kz + oz, {
        ry: rot
      });
    }
    // Sloped masonry approach ramp rising from the city side (-Z) up to the castle terrace (+Z)
    addMesh(new T.BoxGeometry(28, 12, 74), mats.stoneMat, kx + 90, 9, kz - 135, { rx: -0.32, ry: -0.25 });

    // Courtyard cobblestone terrace top
    addMesh(new T.CylinderGeometry(132, 134, 1.4, 12), mats.cobbleMat, kx, plateauY, kz, {
      sx: 1.1, sy: 1, sz: 1.04
    });

    // 2. Sinwellturm (iconic circular keep with cantilevered Fachwerk upper body & stepped conical roof + spire)
    const sx = -630, sz = 2810;
    addMesh(new T.CylinderGeometry(15.5, 17.5, 46, 20), mats.stoneMat, sx, plateauY + 23, sz);
    addMesh(new T.CylinderGeometry(16.8, 16.8, 2.2, 20), mats.stoneMat, sx, plateauY + 46.5, sz);
    // Corbel timber brackets supporting overhanging upper gallery
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      addMesh(new T.BoxGeometry(2.2, 4.5, 4.0), mats.darkWoodMat, sx + Math.sin(a) * 16.2, plateauY + 45.5, sz + Math.cos(a) * 16.2, {
        ry: a
      });
    }
    // Cantilevered Fachwerk watch-gallery
    addMesh(new T.CylinderGeometry(19.2, 18.2, 11, 16), mats.timberMat, sx, plateauY + 53, sz);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      addMesh(new T.BoxGeometry(2.2, 3.6, 0.7), mats.stainedGlassMat, sx + Math.sin(a) * 19.0, plateauY + 53.5, sz + Math.cos(a) * 19.0, {
        ry: a, cast: false, receive: false
      });
    }
    // Stepped conical roof with upper lantern & copper needle spire
    addMesh(new T.ConeGeometry(21.5, 12, 16), mats.capMat, sx, plateauY + 64.5, sz);
    addMesh(new T.CylinderGeometry(8.5, 9.2, 7.5, 12), mats.timberMat, sx, plateauY + 71.5, sz);
    addMesh(new T.ConeGeometry(10.5, 18, 12), mats.capMat, sx, plateauY + 84, sz);
    addMesh(new T.ConeGeometry(2.1, 15, 8), mats.copperSpireMat, sx, plateauY + 99.5, sz);

    // 3. Heidenturm (tall square stone tower with pyramidal roof)
    const hx = -755, hz = 2850;
    addBox(26, 66, 26, mats.stoneMat, hx, plateauY, hz);
    addBox(28.5, 2.2, 28.5, mats.stoneMat, hx, plateauY + 46, hz);
    addBox(28.2, 6.5, 28.2, mats.stoneMat, hx, plateauY + 60, hz);
    // Warm chapel windows
    for (const face of [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5]) {
      addMesh(new T.BoxGeometry(4.2, 8.2, 0.8), mats.stainedGlassMat,
        hx + Math.sin(face) * 13.2, plateauY + 34, hz + Math.cos(face) * 13.2, {
          ry: face, cast: false, receive: false
        });
    }
    addMesh(new T.ConeGeometry(21, 26, 4), mats.capMat, hx, plateauY + 79, hz, { ry: Math.PI * 0.25 });
    addBox(0.7, 6.5, 0.7, mats.ironMat, hx, plateauY + 92, hz);

    // 4. Imperial Palas (grand residential hall with red-tiled gable roof & dormers)
    const px = -710, pz = 2945;
    addBox(132, 16, 46, mats.stoneMat, px, plateauY, pz);
    addBox(135, 13, 49, mats.wallMat, px, plateauY + 16, pz);
    addMesh(roofGeo, mats.roofMat, px, plateauY + 29, pz, {
      ry: Math.PI * 0.5,
      sx: 51,
      sy: 20,
      sz: 138
    });
    // Row of pitched dormers (buhardillas) on both front and back roof slopes + warm imperial hall windows
    for (let i = -2; i <= 2; i++) {
      const dx = px + i * 24;
      for (const side of [-1, 1]) {
        addBox(7.2, 6.2, 7.5, mats.wallMat, dx, plateauY + 32, pz + side * 14);
        addMesh(roofGeo, mats.roofMat, dx, plateauY + 38.2, pz + side * 14, { sx: 8.2, sy: 4.5, sz: 8.6 });
        addMesh(new T.BoxGeometry(4.6, 5.8, 0.7), mats.stainedGlassMat, dx, plateauY + 22.5, pz + side * 24.7, {
          cast: false, receive: false
        });
      }
    }
    // Tall stone chimneys on the Palas ridge
    for (const cxOff of [-42, 0, 42]) {
      addBox(4.2, 14, 4.2, mats.stoneMat, px + cxOff, plateauY + 42, pz);
    }

    // 5. Inner courtyard defensive wall, gatehouse & 4 corbelled bartizans (garitas)
    const cw = [
      [kx, kz - 116, 224, 13, 6],
      [kx - 114, kz, 6, 13, 232],
      [kx + 114, kz, 6, 13, 232],
      [kx, kz + 116, 224, 13, 6]
    ];
    for (const [wx, wz, bw, bh, bd] of cw) {
      addBox(bw, bh, bd, mats.stoneMat, wx, plateauY, wz);
      addMesh(roofGeo, mats.capMat, wx, plateauY + bh, wz, {
        ry: bw < bd ? 0 : Math.PI * 0.5,
        sx: (bw < bd ? bw : bd) + 2,
        sy: 3.6,
        sz: (bw < bd ? bd : bw) + 2
      });
    }
    // Castle gatehouse (Burgtor)
    addBox(24, 22, 16, mats.stoneMat, kx + 45, plateauY, kz - 116);
    addMesh(roofGeo, mats.roofMat, kx + 45, plateauY + 22, kz - 116, { ry: Math.PI * 0.5, sx: 18, sy: 9, sz: 26 });

    // Projecting corner watch-turrets (garitas)
    for (const gx of [-114, 114]) {
      for (const gz of [-116, 116]) {
        const tx = kx + gx, tz = kz + gz;
        addMesh(new T.ConeGeometry(4.5, 6, 8), mats.stoneMat, tx, plateauY + 8, tz, { rx: Math.PI });
        addMesh(new T.CylinderGeometry(4.5, 4.5, 9.5, 8), mats.timberMat, tx, plateauY + 15.5, tz);
        addMesh(new T.ConeGeometry(5.5, 9, 8), mats.capMat, tx, plateauY + 24.5, tz);
      }
    }
  }

  function createArchSpandrelGeo(T, spanW, spanH, depth, archR) {
    const sh = new T.Shape();
    sh.moveTo(-spanW * 0.5, 0);
    sh.lineTo(-archR, 0);
    sh.absarc(0, 0, archR, Math.PI, 0, true);
    sh.lineTo(spanW * 0.5, 0);
    sh.lineTo(spanW * 0.5, spanH);
    sh.lineTo(-spanW * 0.5, spanH);
    sh.closePath();
    const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 14 });
    g.translate(0, 0, -depth * 0.5);
    return g;
  }

  function createArchRingGeo(T, innerR, outerR, depth) {
    const sh = new T.Shape();
    sh.absarc(0, 0, outerR, Math.PI, 0, true);
    sh.lineTo(innerR, 0);
    sh.absarc(0, 0, innerR, 0, Math.PI, false);
    sh.closePath();
    const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 14 });
    g.translate(0, 0, -depth * 0.5);
    return g;
  }

  function buildPegnitzBridges(T, parent, mats) {
    const grp = new T.Group();
    grp.name = 'PegnitzBridges';
    parent.add(grp);

    const bridgeZs = [350, 1200, 2150, 3000];
    const spanW = 29;
    const archR = 11.2;
    const spandrelH = 13.0;
    const archBaseY = -3.6;
    const spandrelGeo = createArchSpandrelGeo(T, spanW, spandrelH, 19.4, archR);
    const ringGeo = createArchRingGeo(T, archR - 0.15, archR + 1.5, 20.4);
    const pierCoreGeo = new T.BoxGeometry(7.2, 11.8, 20.5);
    const cutwaterGeo = new T.CylinderGeometry(4.2, 4.6, 9.8, 3);
    const cutwaterCapGeo = new T.ConeGeometry(4.5, 3.2, 3);
    const deckGeo = new T.BoxGeometry(180, 1.8, 21.2);
    const cobbleStripGeo = new T.BoxGeometry(178, 0.8, 17.6);
    const parapetBaseGeo = new T.BoxGeometry(180, 1.5, 1.5);
    const merlonGeo = new T.BoxGeometry(4.2, 1.35, 1.7);
    const pierPilasterGeo = new T.BoxGeometry(4.6, 3.2, 2.2);
    const lanternPostGeo = new T.BoxGeometry(0.9, 4.2, 0.9);
    const lanternHeadGeo = new T.BoxGeometry(1.6, 1.8, 1.6);

    const spanCenters = [-72.5, -43.5, -14.5, 14.5, 43.5, 72.5];
    const riverPiers = [-58, -29, 0, 29, 58];

    for (const bz of bridgeZs) {
      const bx = 170 * Math.sin(bz * 0.0018);
      const slope = 170 * 0.0018 * Math.cos(bz * 0.0018);
      const yaw = -Math.atan(slope);

      const bridgeGrp = new T.Group();
      bridgeGrp.position.set(bx, 0, bz);
      bridgeGrp.rotation.y = yaw;
      grp.add(bridgeGrp);
      const { addMesh } = createLandmarkHelper(T, bridgeGrp);

      // 6 visible arched masonry vaults + protruding voussoir arch rings
      for (const sx of spanCenters) {
        addMesh(spandrelGeo, mats.stoneMat, sx, archBaseY, 0);
        addMesh(ringGeo, mats.stoneMat, sx, archBaseY, 0);
      }

      // 5 river piers with upstream & downstream triangular cutwaters (tajamares) + 2 bank abutments
      for (const px of riverPiers) {
        addMesh(pierCoreGeo, mats.stoneMat, px, 2.9, 0);
        for (const dir of [-1, 1]) {
          const czOff = dir * 10.2;
          const ry = dir > 0 ? 0 : Math.PI;
          addMesh(cutwaterGeo, mats.stoneMat, px, 2.1, czOff, { ry });
          addMesh(cutwaterCapGeo, mats.stoneMat, px, 8.6, czOff, { ry });
        }
      }
      for (const ax of [-87, 87]) {
        addMesh(new T.BoxGeometry(11, 12.2, 22.5), mats.stoneMat, ax, 3.1, 0);
      }

      // Cobblestone road deck & molded cornice overhang
      addMesh(deckGeo, mats.stoneMat, 0, 9.4, 0);
      addMesh(cobbleStripGeo, mats.cobbleMat, 0, 10.4, 0);

      // Molded & crenellated parapets along both edges + pier pilasters + bridge lanterns
      for (const edge of [-1, 1]) {
        const pz = edge * 9.8;
        addMesh(parapetBaseGeo, mats.stoneMat, 0, 11.0, pz);
        for (let mx = -82; mx <= 82; mx += 11) {
          addMesh(merlonGeo, mats.stoneMat, mx, 12.35, pz);
        }
        for (const px of [-87, -58, -29, 0, 29, 58, 87]) {
          addMesh(pierPilasterGeo, mats.stoneMat, px, 11.7, edge * 10.2);
        }
        for (const lx of [-78, 78]) {
          addMesh(lanternPostGeo, mats.ironMat, lx, 13.8, pz);
          addMesh(lanternHeadGeo, mats.stainedGlassMat, lx, 16.3, pz, { cast: false, receive: false });
        }
      }
    }
  }

  function buildFortifiedGate(T, parent, mats, roofGeo, x, z, outwardDir, name) {
    const grp = new T.Group();
    grp.name = name;
    grp.position.set(x, 0, z);
    parent.add(grp);
    const { addMesh, addBox } = createLandmarkHelper(T, grp);

    // Arched central gatehouse passage (ExtrudeGeometry arch opening through Z)
    const archGeo = createArchSpandrelGeo(T, 34, 24, 22, 9.5);
    addMesh(archGeo, mats.stoneMat, 0, 0, 0);
    addMesh(createArchRingGeo(T, 9.3, 11.2, 23.2), mats.stoneMat, 0, 0, 0);

    // Iron-studded raised portcullis grille inside gate arch
    for (let gx = -6; gx <= 6; gx += 3) {
      addBox(0.7, 5.5, 0.7, mats.ironMat, gx, 5.5, 0);
    }
    for (let gy = 6.0; gy <= 9.0; gy += 1.5) {
      addBox(14, 0.65, 0.7, mats.ironMat, 0, gy, 0);
    }

    // Upper gatehouse timber watch-chamber & steep red-tile roof
    addBox(36, 9, 25, mats.timberMat, 0, 24, 0);
    addMesh(roofGeo, mats.roofMat, 0, 33, 0, { ry: Math.PI * 0.5, sx: 27, sy: 13, sz: 38 });
    // Warm amber gatehouse watch windows
    for (const faceZ of [-12.7, 12.7]) {
      for (const wx of [-9, 0, 9]) {
        addMesh(new T.BoxGeometry(2.6, 3.8, 0.6), mats.stainedGlassMat, wx, 28.5, faceZ, {
          cast: false, receive: false
        });
      }
    }

    // Iconic Nuremberg fat cylindrical gate keep (Dicker Turm) + twin flanking square bastions
    addMesh(new T.CylinderGeometry(16, 17.5, 52, 18), mats.stoneMat, -28, 26, 0);
    addMesh(new T.CylinderGeometry(19.2, 17.8, 10, 16), mats.timberMat, -28, 56, 0);
    addMesh(new T.ConeGeometry(21, 22, 16), mats.capMat, -28, 72, 0);
    addMesh(new T.ConeGeometry(2.6, 11, 8), mats.copperSpireMat, -28, 86, 0);

    addBox(22, 42, 22, mats.stoneMat, 28, 0, 0);
    addBox(24.5, 8.5, 24.5, mats.timberMat, 28, 42, 0);
    addMesh(new T.ConeGeometry(18.5, 20, 4), mats.capMat, 28, 60.5, 0, { ry: Math.PI * 0.25 });

    // Projecting semicircular Barbican outwork (Barbacana / Zwinger)
    const barbR = 38;
    const barbH = 14;
    const segs = 10;
    const stepAngle = Math.PI / segs;
    for (let i = 0; i < segs; i++) {
      // Leave central outer gateway arch open
      if (i === 4 || i === 5) continue;
      const a = (i + 0.5) * stepAngle - Math.PI * 0.5;
      const bx = Math.sin(a) * barbR;
      const bz = outwardDir * (14 + Math.cos(a) * barbR);
      const tangentYaw = a * outwardDir;
      addBox(14.5, barbH, 5.5, mats.stoneMat, bx, 0, bz, { ry: tangentYaw });
      addMesh(roofGeo, mats.capMat, bx, barbH, bz, {
        ry: tangentYaw + Math.PI * 0.5,
        sx: 7,
        sy: 3.4,
        sz: 15
      });
    }
    // Outer barbican gateway arch & twin flanker turrets
    const outerZ = outwardDir * (14 + barbR);
    addMesh(createArchSpandrelGeo(T, 22, 18, 12, 7), mats.stoneMat, 0, 0, outerZ);
    addMesh(roofGeo, mats.roofMat, 0, 18, outerZ, { ry: Math.PI * 0.5, sx: 14, sy: 8, sz: 24 });
    for (const sx of [-13, 13]) {
      addMesh(new T.CylinderGeometry(5.2, 5.8, 25, 12), mats.stoneMat, sx, 12.5, outerZ);
      addMesh(new T.ConeGeometry(6.5, 11, 12), mats.capMat, sx, 30.5, outerZ);
    }
  }

  function buildStadtmauerAndGates(T, parent, mats, roofGeo) {
    const grp = new T.Group();
    grp.name = 'Stadtmauer';
    parent.add(grp);

    // Collect instanced wall bays & alternating circular/square watchtowers for low draw calls
    const wallBays = [];
    const roundTowers = [];
    const squareTowers = [];

    const frauentorX = -230;
    const frauentorZ = 3600;
    const spittlertorX = 195;
    const spittlertorZ = -300;

    // North wall (z = 3600, covering x = -1680..1680, including -1600..1300)
    const riverAt3600 = 170 * Math.sin(3600 * 0.0018);
    for (let x = -1600; x <= 1600; x += 200) {
      // Leave clear passage for Frauentor & the Pegnitz river water-arch
      if (Math.abs(x - frauentorX) < 110) continue;
      if (Math.abs(x - riverAt3600) < 95) continue;
      wallBays.push({ x, z: 3600, len: 205, rotY: 0 });
      if (Math.abs(x) < 1550) {
        if (Math.round((x + 1600) / 200) % 2 === 0) roundTowers.push({ x, z: 3600 });
        else squareTowers.push({ x, z: 3600 });
      }
    }
    // Seamless curtain connectors flanking Frauentor & river watergate
    wallBays.push({ x: -286, z: 3600, len: 34, rotY: 0 });
    wallBays.push({ x: -118, z: 3600, len: 152, rotY: 0 });

    // The curtain follows an irregular perimeter between the bastions and river.
    const curtains = [
      [[-173, -300], [-455, -355], [-840, -402], [-1300, -365], [-1545, -245], [-1640, -40],
        [-1650, 375], [-1525, 770], [-1585, 1210], [-1700, 1580], [-1700, 2010], [-1610, 2450],
        [-1660, 2910], [-1750, 3280], [-1680, 3600]],
      [[238, -300], [465, -325], [750, -387], [1120, -400], [1510, -272], [1665, -89],
        [1735, 340], [1605, 770], [1610, 1190], [1690, 1596], [1660, 1960], [1540, 2350],
        [1575, 2866], [1695, 3234], [1680, 3600]],
      [[-25, -300], [88, -315], [154, -300]]
    ];
    for (const points of curtains) {
      for (let i = 0; i < points.length - 1; i++) {
        const [ax, az] = points[i], [bx, bz] = points[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const rotY = Math.atan2(az - bz, bx - ax);
        const count = Math.ceil(len / 160);
        for (let bay = 0; bay < count; bay++) {
          const t = (bay + 0.5) / count;
          wallBays.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, len: len / count + 3, rotY });
        }
        const towers = i % 2 ? squareTowers : roundTowers;
        towers.push({ x: bx, z: bz });
      }
    }

    // Instanced wall bays: Stone curtain + Timber Wehrgang overhang + Tile Gallery Roof
    const bayCount = wallBays.length;
    const stoneWallMesh = new T.InstancedMesh(new T.BoxGeometry(1, 16, 10), mats.stoneMat, bayCount);
    const plinthMesh = new T.InstancedMesh(new T.BoxGeometry(1, 4, 13), mats.stoneMat, bayCount);
    const galleryMesh = new T.InstancedMesh(new T.BoxGeometry(1, 5.5, 12.2), mats.timberMat, bayCount);
    const galleryRoofMesh = new T.InstancedMesh(roofGeo, mats.roofMat, bayCount);

    const dummy = new T.Object3D();
    for (let i = 0; i < bayCount; i++) {
      const b = wallBays[i];
      dummy.rotation.set(0, b.rotY, 0);

      dummy.position.set(b.x, 8, b.z);
      dummy.scale.set(b.len, 1, 1);
      dummy.updateMatrix();
      stoneWallMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(b.x, 2, b.z);
      dummy.scale.set(b.len, 1, 1);
      dummy.updateMatrix();
      plinthMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(b.x, 18.2, b.z);
      dummy.scale.set(b.len, 1, 1);
      dummy.updateMatrix();
      galleryMesh.setMatrixAt(i, dummy.matrix);

      dummy.rotation.set(0, b.rotY + Math.PI * 0.5, 0);
      dummy.position.set(b.x, 20.9, b.z);
      dummy.scale.set(14.2, 4.4, b.len);
      dummy.updateMatrix();
      galleryRoofMesh.setMatrixAt(i, dummy.matrix);
    }
    for (const m of [stoneWallMesh, plinthMesh, galleryMesh, galleryRoofMesh]) {
      m.castShadow = m.receiveShadow = true;
      m.instanceMatrix.needsUpdate = true;
      grp.add(m);
    }

    // Instanced alternating Round Towers
    if (roundTowers.length) {
      const rc = roundTowers.length;
      const rBody = new T.InstancedMesh(new T.CylinderGeometry(10.5, 11.5, 29, 16), mats.stoneMat, rc);
      const rTop = new T.InstancedMesh(new T.CylinderGeometry(12.6, 11.4, 7.5, 16), mats.timberMat, rc);
      const rSpire = new T.InstancedMesh(new T.ConeGeometry(13.8, 16, 16), mats.capMat, rc);
      const rTip = new T.InstancedMesh(new T.ConeGeometry(1.8, 6, 8), mats.copperSpireMat, rc);

      for (let i = 0; i < rc; i++) {
        const t = roundTowers[i];
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);

        dummy.position.set(t.x, 14.5, t.z);
        dummy.updateMatrix();
        rBody.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, 32.5, t.z);
        dummy.updateMatrix();
        rTop.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, 44.0, t.z);
        dummy.updateMatrix();
        rSpire.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, 54.5, t.z);
        dummy.updateMatrix();
        rTip.setMatrixAt(i, dummy.matrix);
      }
      for (const m of [rBody, rTop, rSpire, rTip]) {
        m.castShadow = m.receiveShadow = true;
        m.instanceMatrix.needsUpdate = true;
        grp.add(m);
      }
    }

    // Instanced alternating Square Towers
    if (squareTowers.length) {
      const sc = squareTowers.length;
      const sBody = new T.InstancedMesh(new T.BoxGeometry(19, 31, 19), mats.stoneMat, sc);
      const sTop = new T.InstancedMesh(new T.BoxGeometry(21.8, 7.5, 21.8), mats.timberMat, sc);
      const sSpire = new T.InstancedMesh(new T.ConeGeometry(16.5, 17, 4), mats.capMat, sc);
      const sTip = new T.InstancedMesh(new T.ConeGeometry(1.6, 6, 4), mats.copperSpireMat, sc);

      for (let i = 0; i < sc; i++) {
        const t = squareTowers[i];
        dummy.scale.set(1, 1, 1);

        dummy.rotation.set(0, 0, 0);
        dummy.position.set(t.x, 15.5, t.z);
        dummy.updateMatrix();
        sBody.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, 34.5, t.z);
        dummy.updateMatrix();
        sTop.setMatrixAt(i, dummy.matrix);

        dummy.rotation.set(0, Math.PI * 0.25, 0);
        dummy.position.set(t.x, 46.5, t.z);
        dummy.updateMatrix();
        sSpire.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, 57.5, t.z);
        dummy.updateMatrix();
        sTip.setMatrixAt(i, dummy.matrix);
      }
      for (const m of [sBody, sTop, sSpire, sTip]) {
        m.castShadow = m.receiveShadow = true;
        m.instanceMatrix.needsUpdate = true;
        grp.add(m);
      }
    }

    // Fortified Pegnitz Watergate Bridge-Arch (Schwibbogen) where the north wall crosses the river
    const watergateGrp = new T.Group();
    watergateGrp.name = 'Schwibbogen';
    grp.add(watergateGrp);
    const { addMesh, addBox } = createLandmarkHelper(T, watergateGrp);
    for (const side of [-1, 1]) {
      addMesh(new T.CylinderGeometry(9.5, 10.5, 24, 12), mats.stoneMat, riverAt3600 + side * 68, 12, 3600);
      addMesh(new T.ConeGeometry(11.5, 12, 12), mats.capMat, riverAt3600 + side * 68, 30, 3600);
    }
    const wgSpandrel = createArchSpandrelGeo(T, 45, 18.0, 10, 15.5);
    const wgRing = createArchRingGeo(T, 15.3, 17.0, 11);
    for (const spanOff of [-45, 0, 45]) {
      addMesh(wgSpandrel, mats.stoneMat, riverAt3600 + spanOff, -1.5, 3600);
      addMesh(wgRing, mats.stoneMat, riverAt3600 + spanOff, -1.5, 3600);
    }
    for (const pierOff of [-22.5, 22.5]) {
      addBox(8.5, 18, 12, mats.stoneMat, riverAt3600 + pierOff, -1.5, 3600);
    }
    addBox(144, 5.5, 12.2, mats.timberMat, riverAt3600, 15.5, 3600);
    addMesh(roofGeo, mats.roofMat, riverAt3600, 21.0, 3600, { ry: Math.PI * 0.5, sx: 14.2, sy: 4.5, sz: 146 });

    // Two Major Fortified Gates with Barbicans along the main flight axis
    buildFortifiedGate(T, grp, mats, roofGeo, frauentorX, frauentorZ, 1, 'Frauentor');
    buildFortifiedGate(T, grp, mats, roofGeo, spittlertorX, spittlertorZ, -1, 'Spittlertor');
  }

  /**
   * Builds St. Lorenz & St. Sebaldus cathedrals, the Imperial Castle (Kaiserburg),
   * fortified Stadtmauer walls & gates, and 4 Pegnitz stone bridges.
   */
  function buildMedievalLandmarks(T, scene, mats, roofGeo) {
    if (!T || !scene) return null;
    const baseMats = mats || {};
    // The large tower walls and bridge piers need unbroken courses of stone.
    // House elevations would repeat tiny windows across piers and buttresses.
    const stoneMat = new T.MeshStandardMaterial({ color: 0xc0afa1, roughness: 0.93 });
    if (typeof document !== 'undefined' && typeof Image !== 'undefined' && window.CityAtlas) {
      const atlas = new Image();
      atlas.onload = () => {
        const crop = document.createElement('canvas');
        crop.width = 512; crop.height = 256;
        const ctx = crop.getContext('2d');
        ctx.drawImage(atlas, 0, 0, atlas.width, atlas.height * 0.49, 0, 0, crop.width, crop.height);
        const stone = new T.CanvasTexture(crop);
        stone.colorSpace = T.SRGBColorSpace;
        stone.wrapS = stone.wrapT = T.RepeatWrapping;
        stone.repeat.set(2, 2);
        stone.anisotropy = 8;
        for (const mat of [stoneMat, landmarkMats.sandstoneMat]) {
          mat.map = mat.bumpMap = stone;
          mat.bumpScale = 0.09;
          mat.needsUpdate = true;
        }
      };
      atlas.src = window.CityAtlas;
    }
    const roofMat = baseMats.roofMat || baseMats.cap || new T.MeshStandardMaterial({ color: 0x7b4534, roughness: 0.82 });
    const timberMat = baseMats.timberMat || baseMats.wallMat || stoneMat;
    const wallMat = baseMats.wallMat || stoneMat;
    const capMat = baseMats.cap || roofMat;

    const landmarkMats = {
      stoneMat,
      roofMat,
      timberMat,
      wallMat,
      capMat,
      copperSpireMat: new T.MeshStandardMaterial({
        color: 0x2b4940,
        metalness: 0.52,
        roughness: 0.46
      }),
      stainedGlassMat: new T.MeshStandardMaterial({
        color: 0x595e5a,
        emissive: 0x483425,
        emissiveIntensity: 0.12,
        roughness: 0.37,
        metalness: 0.15
      }),
      sandstoneMat: new T.MeshStandardMaterial({
        color: 0x6c604f,
        map: stoneMat.map || null,
        normalMap: stoneMat.normalMap || null,
        normalScale: stoneMat.normalScale ? stoneMat.normalScale.clone() : undefined,
        roughnessMap: stoneMat.roughnessMap || null,
        roughness: 0.94,
        metalness: 0.04
      }),
      cobbleMat: new T.MeshStandardMaterial({
        color: 0x6f675a,
        map: stoneMat.map || null,
        normalMap: stoneMat.normalMap || null,
        normalScale: stoneMat.normalScale ? stoneMat.normalScale.clone() : undefined,
        roughnessMap: stoneMat.roughnessMap || null,
        roughness: 0.92
      }),
      darkWoodMat: new T.MeshStandardMaterial({ color: 0x3b2c1e, roughness: 0.9 }),
      ironMat: new T.MeshStandardMaterial({ color: 0x25282e, metalness: 0.84, roughness: 0.42 }),
      belfryDarkMat: new T.MeshStandardMaterial({ color: 0x1b1a18, roughness: 0.95 })
    };

    const resolvedRoofGeo = ensureRoofGeo(T, roofGeo);
    const root = new T.Group();
    root.name = 'NurembergLandmarks';

    buildGothicCathedral(T, root, landmarkMats, resolvedRoofGeo, {
      name: 'StLorenz',
      cx: -460,
      cz: 1300,
      naveH: 38,
      spireH: 46,
      widthScale: 1.0
    });
    buildGothicCathedral(T, root, landmarkMats, resolvedRoofGeo, {
      name: 'StSebaldus',
      cx: 650,
      cz: 2400,
      naveH: 36,
      spireH: 41,
      widthScale: 1.06
    });
    buildKaiserburg(T, root, landmarkMats, resolvedRoofGeo);
    buildPegnitzBridges(T, root, landmarkMats);
    buildStadtmauerAndGates(T, root, landmarkMats, resolvedRoofGeo);

    // Batch static landmark meshes per material & group to keep WebGL draw calls low
    root.updateMatrixWorld(true);
    for (const grpName of ['StLorenz', 'StSebaldus', 'Kaiserburg']) {
      const grp = root.getObjectByName(grpName);
      if (grp) bakeGroupMeshesByMaterial(T, grp);
    }
    const bridgesGrp = root.getObjectByName('PegnitzBridges');
    if (bridgesGrp) {
      for (let i = 0; i < bridgesGrp.children.length; i++) {
        bakeGroupMeshesByMaterial(T, bridgesGrp.children[i]);
      }
    }
    const stadtGrp = root.getObjectByName('Stadtmauer');
    if (stadtGrp) {
      for (const gateName of ['Frauentor', 'Spittlertor', 'Schwibbogen']) {
        const gateGrp = stadtGrp.getObjectByName(gateName);
        if (gateGrp) bakeGroupMeshesByMaterial(T, gateGrp);
      }
    }

    scene.add(root);
    return root;
  }

  const streetHeight = -1.44;
  const bridgeRows = [350, 1200, 2150, 3000];
  const riverX = z => 170 * Math.sin(z * 0.0018);
  const landmarkClearings = [
    [-460, 1300, 115, 145], [650, 2400, 115, 150], [-685, 2875, 230, 225],
    [195, -300, 86, 75], [-230, 3600, 90, 75]
  ];

  function nearLandmark(x, z, margin) {
    return landmarkClearings.some(([lx, lz, rx, rz]) =>
      ((x - lx) / (rx + margin)) ** 2 + ((z - lz) / (rz + margin)) ** 2 < 1
    );
  }

  function planTown(rand) {
    const rows = [-285, -90, 100, 350, 520, 755, 973, 1200, 1410, 1625, 1820,
      1975, 2150, 2330, 2545, 2760, 3000, 3205, 3380, 3572];
    const roads = [], plots = [], squares = [], blocks = [];

    for (const bank of [-1, 1]) {
      const divisions = bank < 0 ? [0, 0.15, 0.33, 0.49, 0.67, 0.83, 1] : [0, 0.11, 0.28, 0.44, 0.62, 0.80, 1];
      const nodes = rows.map((baseZ, row) => divisions.map((fraction, column) => {
        const phase = row * 0.74 + column * 1.18 + bank * 0.82;
        const sweep = Math.sin(row * Math.PI / (rows.length - 1)) * Math.sin(fraction * Math.PI)
          * (110 * Math.sin(baseZ * 0.0019 + bank * 0.85) + 46 * Math.sin(baseZ * 0.0049));
        const z = baseZ + sweep + fraction * (39 * Math.sin(phase) + 47 * Math.sin(column * 0.57 + bank))
          + ((row === 0 || row === rows.length - 1) ? 0 : (rand() - 0.5) * 52 * fraction);
        const quay = riverX(z) + bank * (105 + 13 * Math.sin(z * 0.014));
        const cityEdge = bank * (1465 + 102 * Math.sin(z * 0.0026 + bank));
        const x = quay + (cityEdge - quay) * fraction + Math.sin(phase) * (32 * Math.sin(fraction * Math.PI));
        return { x, z, y: streetHeight };
      }));

      for (let row = 0; row < nodes.length; row++) {
        const main = bridgeRows.includes(rows[row]);
        for (let column = 0; column < divisions.length; column++) {
          const a = nodes[row][column];
          const next = nodes[row + 1]?.[column];
          if (next) {
            const major = column === 0 || column === 2 + (bank > 0 ? 1 : 0);
            if (!nearLandmark((a.x + next.x) * 0.5, (a.z + next.z) * 0.5, -20)) {
              roads.push({ a, b: next, width: major ? 19 : 10 + rand() * 4, curve: (rand() - 0.5) * 16 });
            }
          }

          if (column === 0 && main) {
            const bz = rows[row];
            const slope = Math.atan(0.306 * Math.cos(bz * 0.0018));
            const end = { x: riverX(bz) + bank * 88 * Math.cos(slope), z: bz + bank * 88 * Math.sin(slope), y: 10.4 };
            const approach = { x: a.x + bank * 55, z: a.z + bank * 22 * Math.sin(slope), y: streetHeight };
            roads.push({ a: end, b: approach, width: 17.5, curve: 0 });
          }

          const b = nodes[row][column + 1];
          if (!b) continue;
          if (!nearLandmark((a.x + b.x) * 0.5, (a.z + b.z) * 0.5, -20)) {
            roads.push({ a, b, width: main ? 22 : 11 + rand() * 5, curve: (rand() - 0.5) * 16 });
          }
          if (!next) continue;

          const corners = [a, b, nodes[row + 1][column + 1], next];
          const x = corners.reduce((sum, point) => sum + point.x, 0) / 4;
          const z = corners.reduce((sum, point) => sum + point.z, 0) / 4;
          const outer = column > 3 || row < 2 || row > nodes.length - 4;
          const market = (!nearLandmark(x, z, -35) && nearLandmark(x, z, 43)) || (!outer && rand() < 0.075);
          const open = !market && rand() < (outer ? 0.30 : 0.045);
          const density = outer ? 0.54 + rand() * 0.23 : 0.78 + rand() * 0.18;
          const style = rand() < (column < 2 ? 0.67 : 0.31) ? 'merchant' : 'residential';
          blocks.push({ corners, x, z, open, market, outer });
          if (market) {
            squares.push({ x, z, width: 38 + rand() * 23, depth: 29 + rand() * 22 });
            const entrance = { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5, y: streetHeight + 0.025 };
            roads.push({ a: entrance, b: { x, z, y: streetHeight + 0.025 }, width: 15, curve: 4 });
          }
          if (open) continue;

          for (let edge = 0; edge < 4; edge++) {
            let start = corners[edge], end = corners[(edge + 1) % 4];
            const length = Math.hypot(end.x - start.x, end.z - start.z);
            let dx = (end.x - start.x) / length, dz = (end.z - start.z) / length;
            if ((x - start.x) * -dz + (z - start.z) * dx < 0) {
              [start, end] = [end, start];
              dx *= -1;
              dz *= -1;
            }
            const yaw = Math.atan2(-dz, dx);
            const cornerClearance = 32 + rand() * 8;
            let at = cornerClearance;
            while (at + 20 < length - cornerClearance) {
              const parcel = 19 + rand() * 16;
              const t = at + parcel * 0.5;
              at += parcel;
              if (at > length - cornerClearance || rand() > density) continue;
              const width = parcel - 1.8 - rand() * (outer ? 5 : 2.7);
              const depth = 22 + rand() * 15;
              const setback = depth * 0.5 + 15 + rand() * 5;
              const px = start.x + dx * t - dz * setback;
              const pz = start.z + dz * t + dx * setback;
              if (Math.abs(px - riverX(pz)) < 86 || nearLandmark(px, pz, 18)) continue;
              if (market && (Math.hypot(px - x, pz - z) < 63 || (edge === 0 && Math.abs(t - length * 0.5) < 18))) continue;
              plots.push({ x: px, z: pz, width, depth, yaw, style: market ? 'merchant' : style, outer });
            }
          }
        }
      }
    }
    return { roads, plots, squares, blocks };
  }

  function streetTexture(T, rand) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#a7a096';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = -6; y < 256;) {
      const h = 7 + rand() * 5;
      for (let x = -24 + rand() * 15; x < 256;) {
        const w = 9 + rand() * 10;
        const light = Math.round(170 + rand() * 28);
        ctx.fillStyle = `rgb(${light}, ${light - 4}, ${light - 9})`;
        ctx.beginPath();
        ctx.moveTo(x + 1.8, y + 1); ctx.lineTo(x + w - 2, y + 0.5);
        ctx.lineTo(x + w - 0.3, y + 2); ctx.lineTo(x + w - 1.1, y + h - 1.6);
        ctx.lineTo(x + 2.6, y + h - 0.3); ctx.lineTo(x + 0.7, y + h - 1.9);
        ctx.closePath(); ctx.fill();
        x += w;
      }
      y += h;
    }
    const texture = new T.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = T.MirroredRepeatWrapping;
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  function courtyardTexture(T) {
    // Neutral dry soil and grass clumps, colored per plot by the district mesh.
    const rand = createFallbackRandom(11345);
    const size = 256, pixels = new Uint8Array(size * size * 4);
    const layers = [[4,0.13], [12,0.12], [32,0.09], [128,0.08]].map(([cells, weight]) =>
      ({ cells, weight, values: Float32Array.from({ length: cells * cells }, rand) }));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let value = 0.68;
      for (const { cells, weight, values } of layers) {
        const px = x * cells / size, py = y * cells / size, ix = Math.floor(px), iy = Math.floor(py);
        const nx = (ix + 1) % cells, ny = (iy + 1) % cells;
        const tx = px - ix, ty = py - iy;
        const north = values[iy * cells + ix] * (1 - tx) + values[iy * cells + nx] * tx;
        const south = values[ny * cells + ix] * (1 - tx) + values[ny * cells + nx] * tx;
        value += (north * (1 - ty) + south * ty) * weight;
      }
      const i = (y * size + x) * 4;
      const grain = (rand() - 0.5) * 13;
      pixels.fill(Math.min(255, value * 255 + grain), i, i + 3);
      pixels[i + 3] = 255;
    }
    const texture = new T.DataTexture(pixels, size, size);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.magFilter = T.LinearFilter;
    texture.generateMipmaps = true;
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }

  function buildStreets(T, root, roads, squares, blocks, rand) {
    const positions = [], colors = [], uvs = [];
    const edge = new T.Color('#555140');
    const pavers = new T.Color('#9c8c77');
    const dirt = new T.Color('#897359');

    function vertex(x, y, z, color) {
      positions.push(x, y, z);
      colors.push(color.r, color.g, color.b);
      uvs.push(x / 40, z / 40);
    }

    // A yard is worn earth near its entrances, with grass or kitchen gardens in
    // the sheltered interior. Keep the neighboring street on the crown above it.
    const yardEdge = new T.Color(), yardCenter = new T.Color();
    const beds = [0x656c43, 0x898357, 0x716140, 0x7f7254].map(color => new T.Color(color));
    for (const { corners, x, z, open, market, outer } of blocks) {
      yardEdge.set(outer ? 0x85785f : 0x9e8b70).multiplyScalar(0.89 + rand() * 0.18);
      yardCenter.set(market ? 0xad9b82 : open ? 0x7a8051 : outer ? 0x737752 : 0x8b785e);
      const y = streetHeight - 0.21;
      for (let i = 0; i < 4; i++) {
        let a = corners[i], b = corners[(i + 1) % 4];
        if ((a.x - x) * (b.z - z) - (a.z - z) * (b.x - x) > 0) [a, b] = [b, a];
        vertex(x, y, z, yardCenter);
        vertex(a.x, y, a.z, yardEdge);
        vertex(b.x, y, b.z, yardEdge);
      }
      if (market || nearLandmark(x, z, 40) || (!open && rand() > 0.67)) continue;
      const angle = Math.atan2(corners[1].z - corners[0].z, corners[1].x - corners[0].x);
      const length = Math.min(open ? 54 : 33, Math.hypot(corners[1].x - corners[0].x, corners[1].z - corners[0].z) * 0.20);
      const count = open ? 8 : 4;
      function bedVertex(along, across, tone) {
        vertex(x + Math.cos(angle) * along - Math.sin(angle) * across, y + 0.08,
          z + Math.sin(angle) * along + Math.cos(angle) * across, tone);
      }
      for (let row = 0; row < count; row++) {
        const start = (row - count * 0.5) * 4.8;
        const end = start + 3.8;
        const tone = beds[Math.floor(rand() * beds.length)];
        const tip = length * (0.72 + rand() * 0.28);
        bedVertex(-length, start, tone); bedVertex(-length, end, tone); bedVertex(tip, end, tone);
        bedVertex(-length, start, tone); bedVertex(tip, end, tone); bedVertex(tip, start, tone);
      }
    }
    const yardCount = positions.length / 3;

    for (const { a, b, width, curve } of roads) {
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
      const segmentCount = Math.max(1, Math.ceil(length / 36));
      const middle = (width >= 17 ? pavers : dirt).clone().multiplyScalar(0.84 + rand() * 0.28);
      const sides = [-1, -0.70, 0.70, 1];
      const tints = [edge, middle, middle, edge];
      function roadVertex(t, side) {
        const variation = 1 + Math.sin(t * 8 + a.x * 0.015) * 0.09;
        const offset = Math.sin(t * Math.PI) * curve + sides[side] * width * 0.55 * variation;
        const eased = t * t * (3 - 2 * t);
        vertex(a.x + (b.x - a.x) * t + nx * offset, a.y + (b.y - a.y) * eased,
          a.z + (b.z - a.z) * t + nz * offset, tints[side]);
      }

      for (let i = 0; i < segmentCount; i++) {
        const t = i / segmentCount, next = (i + 1) / segmentCount;
        for (let side = 0; side < 3; side++) {
          roadVertex(t, side);
          roadVertex(t, side + 1);
          roadVertex(next, side + 1);
          roadVertex(t, side);
          roadVertex(next, side + 1);
          roadVertex(next, side);
        }
      }
    }

    for (const { x, z, width, depth } of squares) {
      for (let side = 0; side < 8; side++) {
        const a = side * Math.PI / 4, b = (side + 1) * Math.PI / 4;
        vertex(x, streetHeight - 0.03, z, pavers);
        vertex(x + Math.cos(b) * width, streetHeight - 0.03, z + Math.sin(b) * depth, edge);
        vertex(x + Math.cos(a) * width, streetHeight - 0.03, z + Math.sin(a) * depth, edge);
      }
    }

    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.addGroup(0, yardCount, 0);
    geometry.addGroup(yardCount, positions.length / 3 - yardCount, 1);
    geometry.computeVertexNormals();
    const map = streetTexture(T, rand);
    const yard = new T.MeshStandardMaterial({ map: courtyardTexture(T), vertexColors: true, roughness: 1 });
    const roadway = new T.MeshStandardMaterial({
      vertexColors: true, roughness: 0.94, map, bumpMap: map, bumpScale: 0.16,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    const street = new T.Mesh(geometry, [yard, roadway]);
    street.name = 'Lanes and market squares';
    street.receiveShadow = true;
    root.add(street);
  }

  function planCourtyardTrees(blocks) {
    const rand = createFallbackRandom(40926);
    const trees = [];
    for (const { x, z, open, market, outer } of blocks) {
      if (market || nearLandmark(x, z, 60) || (!open && rand() < 0.35)) continue;
      const count = open ? 4 + Math.floor(rand() * 5) : 1 + Math.floor(rand() * 3);
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2, r = 11 + rand() * (open ? 48 : 17);
        const px = x + r * Math.cos(a), pz = z + r * Math.sin(a);
        if (nearLandmark(px, pz, 28)) continue;
        const orchard = open || outer;
        const height = orchard ? 7.5 + rand() * 5.5 : 12 + rand() * 10;
        trees.push({ x: px, z: pz, height, species: Math.floor(rand() * 3) });
      }
    }
    return trees;
  }

  function elevationMaterial(T, fallback) {
    const mat = new T.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.96, map: fallback?.map || null
    });
    if (typeof Image !== 'undefined' && window.FranconianFronts) {
      new T.TextureLoader().load(window.FranconianFronts, texture => {
        texture.colorSpace = T.SRGBColorSpace;
        texture.anisotropy = 8;
        mat.map = texture;
        mat.needsUpdate = true;
      });
    }
    return mat;
  }

  function elevationGeometry(T, family, gable = false) {
    const positions = [], colors = [], uvs = [], indices = [];
    function point(x, y, z, u, v, tile, shade) {
      positions.push(x, y, z);
      colors.push(shade, shade, shade);
      // Keep every mip sample away from the neighboring elevation.
      uvs.push((tile % 2 + 0.012 + u * 0.976) * 0.5,
        ((tile < 2 ? 1 : 0) + 0.012 + v * 0.976) * 0.5);
    }
    if (gable) {
      for (const side of [-1, 1]) {
        const start = positions.length / 3;
        point(-0.5 * side, 0, side * 0.5, 0.12, 0.52, family, 0.82);
        point(0, 1, side * 0.5, 0.50, 0.99, family, 0.79);
        point(0.5 * side, 0, side * 0.5, 0.88, 0.52, family, 0.82);
        indices.push(start, start + 2, start + 1);
      }
    } else {
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const jettied = family === 0 || family === 3;
      const tiers = jettied ? [
        [-0.50, 0.49, 0, 0.58], [-0.02, 0.49, 0.49, 0.90], [0, 0.515, 0.50, 0.55],
        [0.035, 0.515, 0.535, 0.94], [0.43, 0.515, 0.94, 1], [0.50, 0.515, 1, 0.70]
      ] : [
        [-0.50, 0.49, 0, 0.56], [-0.40, 0.49, 0.10, 0.89],
        [0.43, 0.49, 0.94, 1], [0.50, 0.49, 1, 0.70]
      ];
      for (let side = 0; side < 4; side++) {
        const a = corners[side], b = corners[(side + 1) % 4];
        const bays = side % 2 ? 2 : 1;
        for (let bay = 0; bay < bays; bay++) {
          const tile = side === 0 ? family : side === 2 ? (family + 2) % 4 : (family + bay + 1) % 4;
          const start = positions.length / 3;
          for (const [y, radius, v, shade] of tiers) {
            for (let k = 0; k < 2; k++) {
              const t = (bay + k) / bays;
              point((a[0] + (b[0] - a[0]) * t) * radius, y, (a[1] + (b[1] - a[1]) * t) * radius,
                bay % 2 ? 1 - k : k, v, tile, shade);
            }
          }
          for (let tier = 0; tier < tiers.length - 1; tier++) {
            const i = start + tier * 2;
            indices.push(i, i + 2, i + 3, i, i + 3, i + 1);
          }
        }
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function createHippedRoof(T, lowerGableHeight) {
    const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 0, 0.5], d = [-0.5, 0, 0.5];
    const ridgeEnd = lowerGableHeight === 1 ? 0.5 : 0.27;
    const ridgeA = [0, 1, -ridgeEnd], ridgeB = [0, 1, ridgeEnd];
    const positions = [], uvs = [];
    function face(points, gable = false) {
      for (let i = 1; i < points.length - 1; i++) {
        for (const point of [points[0], points[i], points[i + 1]]) {
          positions.push(...point);
          uvs.push(((gable ? point[0] : point[2]) + 0.5) * 2, point[1] * 2.5);
        }
      }
    }
    if (lowerGableHeight === 1) {
      face([b, ridgeA, ridgeB, c]);
      face([d, ridgeB, ridgeA, a]);
    } else if (lowerGableHeight > 0) {
      const halfWidth = (1 - lowerGableHeight) * 0.5;
      const leftA = [-halfWidth, lowerGableHeight, -0.5], rightA = [halfWidth, lowerGableHeight, -0.5];
      const leftB = [-halfWidth, lowerGableHeight, 0.5], rightB = [halfWidth, lowerGableHeight, 0.5];
      face([b, rightA, ridgeA, ridgeB, rightB, c]);
      face([d, leftB, ridgeB, ridgeA, leftA, a]);
      face([leftA, ridgeA, rightA], true);
      face([rightB, ridgeB, leftB], true);
      face([a, leftA, rightA, b], true);
      face([c, rightB, leftB, d], true);
    } else {
      face([b, ridgeA, ridgeB, c]);
      face([d, ridgeB, ridgeA, a]);
      face([a, ridgeA, b], true);
      face([c, ridgeB, d], true);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }

  function buildWharvesAndMarkets(T, root, plots, squares, rand) {
    const stone = new T.MeshStandardMaterial({ color: 0x897d6b, roughness: 0.94 });
    const timber = new T.MeshStandardMaterial({ color: 0x584332, roughness: 0.95 });
    const wetWood = new T.MeshStandardMaterial({ color: 0x38352a, roughness: 0.76 });
    const linen = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, side: T.DoubleSide });
    const materials = new Map();
    const box = new T.BoxGeometry(1, 1, 1);
    const transform = new T.Object3D();
    function part(geo, mat, x, y, z, yaw, sx, sy, sz, rx = 0, rz = 0) {
      transform.position.set(x, y, z);
      transform.rotation.set(rx, yaw, rz, 'YXZ');
      transform.scale.set(sx, sy, sz);
      transform.updateMatrix();
      if (!materials.has(mat)) materials.set(mat, []);
      materials.get(mat).push({ geo, matrix: transform.matrix.clone() });
    }
    // Along each bend the upper quay course aligns with the loading walk;
    // recessed timber landings descend to the water away from the bridge piers.
    for (const bank of [-1, 1]) {
      for (let z = -272; z < 3540; z += 36) {
        const start = riverX(z), end = riverX(z + 36);
        const x = (start + end) * 0.5 + bank * 61.5;
        const yaw = Math.atan2(end - start, 36);
        const length = Math.hypot(end - start, 36) + 0.45;
        const landing = Math.sin(z * 0.005 + bank * 2.4) > 0.65 && !bridgeRows.some(bz => Math.abs(bz - z) < 80);
        const height = landing ? 2.8 : 5.8;
        part(box, stone, x, -2.6 + height * 0.5, z + 18, yaw, 5.6, height, length);
        part(box, stone, x + bank * 2.1, -2.4 + height, z + 18, yaw, 9.8, 0.65, length);
        if (!landing) continue;
        part(box, timber, x - bank * 6, 1.30, z + 18, yaw, 8.5, 0.88, length * 0.95);
        for (const offset of [-13, 0, 13]) {
          part(box, wetWood, x - bank * 9.6 + Math.sin(yaw) * offset, 0.85, z + 18 + offset,
            yaw, 0.95, 5.8, 0.95);
        }
      }
    }
    const wheel = new T.TorusGeometry(7.5, 0.54, 4, 24);
    wheel.rotateY(Math.PI / 2);
    const oak = new T.CylinderGeometry(0.78, 0.82, 1, 7);
    oak.rotateZ(Math.PI / 2);
    for (const [bank, z, mill] of [[-1, 185, true], [1, 568, false], [-1, 865, false], [1, 1010, true],
      [-1, 1530, false], [1, 1705, false], [-1, 1925, true], [1, 2460, false], [-1, 2700, false], [1, 3350, true]]) {
      const slope = 0.306 * Math.cos(z * 0.0018);
      const yaw = Math.atan(slope);
      const width = mill ? 23 : 28, depth = mill ? 45 : 56;
      const x = riverX(z) + bank * (64 + width * 0.5);
      plots.push({ x, z, width, depth, yaw, style: 'merchant', outer: false, wharf: true });
      if (!mill) continue;
      const centerX = riverX(z) + bank * 57;
      const centerY = 6.4;
      const centerZ = z + 2;
      part(oak, wetWood, centerX + bank * 3.4, centerY, centerZ, yaw, 15.0, 1, 1);
      for (const shift of [-2.1, 2.1]) {
        part(wheel, timber, centerX + Math.cos(yaw) * shift, centerY, centerZ - Math.sin(yaw) * shift,
          yaw, 1, 1, 1);
      }
      for (let blade = 0; blade < 16; blade++) {
        const a = (blade + 0.5) * Math.PI / 8;
        const dz = Math.sin(a) * 7.15, dy = Math.cos(a) * 7.15;
        part(box, wetWood, centerX + Math.sin(yaw) * dz, centerY + dy, centerZ + Math.cos(yaw) * dz,
          yaw, 4.8, 0.74, 2.5, -a);
        if (blade < 4) part(box, timber, centerX, centerY, centerZ, yaw, 1.0, 14.8, 0.62, blade * Math.PI / 4);
      }
    }

    // A moored, flat-bottomed barge reads as a hollow hull from above.
    // Sections taper into the bow and stern; the gunwale casts a shadow inside.
    const hullPositions = [], hullIndices = [];
    for (const [z, radius] of [[-11, 0.45], [-8, 2.1], [-4, 2.55], [5, 2.55], [9, 1.9], [11, 0.48]]) {
      hullPositions.push(-radius, 1.45, z, -radius * 0.68, 0.05, z, radius * 0.68, 0.05, z, radius, 1.45, z);
    }
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      const i = r * 4 + c;
      hullIndices.push(i, i + 4, i + 5, i, i + 5, i + 1);
    }
    const hullGeo = new T.BufferGeometry();
    hullGeo.setAttribute('position', new T.Float32BufferAttribute(hullPositions, 3));
    hullGeo.setIndex(hullIndices);
    hullGeo.computeVertexNormals();
    const boatMat = new T.MeshStandardMaterial({ color: 0x624b33, side: T.DoubleSide, roughness: 0.89 });
    for (const bank of [-1, 1]) {
      for (let z = -80 + rand() * 95; z < 3470; z += 97 + rand() * 230) {
        if (bridgeRows.some(bz => Math.abs(bz - z) < 35)) continue;
        const yaw = Math.atan(0.306 * Math.cos(z * 0.0018)) + (rand() - 0.5) * 0.14;
        const x = riverX(z) + bank * (44 + rand() * 5);
        const size = 0.75 + rand() * 0.5;
        part(hullGeo, boatMat, x, -0.55, z, yaw, size, size, size);
        for (const cross of [-5.8, 0, 5.8]) {
          part(box, timber, x + Math.sin(yaw) * cross * size, 0.65 * size, z + Math.cos(yaw) * cross * size,
            yaw, 3.9 * size, 0.33, 0.86);
        }
      }
    }
    for (const [mat, parts] of materials) {
      const mesh = new T.Mesh(mergePartGeometries(T, parts), mat);
      mesh.name = 'Pegnitz waterfront';
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    }
    box.dispose(); oak.dispose(); wheel.dispose(); hullGeo.dispose();

    // Pitched and sagging canvas on detached market stalls gives the plazas
    // human-scale silhouettes and patches of muted dyed cloth.
    const xyz = [], colors = [];
    const shades = [0xb3a384, 0x978666, 0x935a43, 0x68715f, 0x827461];
    const stands = [], stallBox = new T.BoxGeometry(1, 1, 1);
    for (const square of squares) {
      for (let stall = 0; stall < 8; stall++) {
        const angle = stall * Math.PI / 4 + rand() * 0.23;
        const yaw = -angle + Math.PI / 2;
        const x = square.x + Math.cos(angle) * square.width * 0.57;
        const z = square.z + Math.sin(angle) * square.depth * 0.53;
        const y = streetHeight, width = 6.0 + rand() * 4.0;
        const shade = new T.Color(shades[Math.floor(rand() * shades.length)]);
        const local = (u, v) => [x + Math.cos(yaw) * u + Math.sin(yaw) * v, z - Math.sin(yaw) * u + Math.cos(yaw) * v];
        for (let i = 0; i < 4; i++) {
          const b = -width / 2 + width * i / 4;
          const e = b + width / 4;
          const tone = shade.clone().multiplyScalar(i % 2 ? 0.87 : 1);
          for (const [u, v] of [[b,-2.3],[b,2.3],[e,2.3],[b,-2.3],[e,2.3],[e,-2.3]]) {
            const [wx, wz] = local(u, v);
            xyz.push(wx, y + 4.6 - (v + 2.3) * 0.19 - 0.22 * Math.cos(u / width * Math.PI), wz);
            colors.push(tone.r, tone.g, tone.b);
          }
        }
        const counter = new T.Matrix4().compose(new T.Vector3(x, y + 1.40, z),
          new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw), new T.Vector3(width * 0.92, 2.45, 3.4));
        stands.push({ geo: stallBox, matrix: counter });
        for (const u of [-width * 0.46, width * 0.46]) for (const v of [-2.0, 2.0]) {
          const [wx, wz] = local(u, v);
          stands.push({ geo: stallBox, matrix: new T.Matrix4().makeScale(0.21, 4.2, 0.21).setPosition(wx, y + 2.1, wz) });
        }
      }
    }
    if (xyz.length) {
      const cloth = new T.BufferGeometry();
      cloth.setAttribute('position', new T.Float32BufferAttribute(xyz, 3));
      cloth.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      cloth.computeVertexNormals();
      const stalls = new T.Mesh(cloth, linen);
      stalls.name = 'Linen market awnings';
      stalls.castShadow = stalls.receiveShadow = true;
      root.add(stalls, new T.Mesh(mergePartGeometries(T, stands), timber));
    }
    stallBox.dispose();
  }

  function createUrbanDistricts(T, scene, mats, roofGeo) {
    const root = new T.Group();
    root.name = 'Pegnitz districts';
    const rand = createFallbackRandom(156102);
    const { roads, plots, squares, blocks } = planTown(rand);
    buildStreets(T, root, roads, squares, blocks, rand);
    const courtyardTrees = planCourtyardTrees(blocks);

    const houseGeometries = [0, 1, 2, 3].map(k => elevationGeometry(T, k));
    const frontMat = elevationMaterial(T, mats.wallMat);
    const roofs = [createHippedRoof(T, 1), createHippedRoof(T, 0), createHippedRoof(T, 0.56)];
    buildWharvesAndMarkets(T, root, plots, squares, rand);
    const stackGeometry = new T.BoxGeometry(1, 1, 1);

    const stepParts = [
      makeBoxPart(T, 1.04, 0.32, 0.065, 0, 0.10, -0.516),
      makeBoxPart(T, 0.79, 0.28, 0.065, 0, 0.40, -0.516),
      makeBoxPart(T, 0.53, 0.28, 0.065, 0, 0.68, -0.516),
      makeBoxPart(T, 0.27, 0.30, 0.065, 0, 0.97, -0.516)
    ];
    const stepGeometry = mergePartGeometries(T, stepParts);
    for (const part of stepParts) part.geo.dispose();
    const palette = [0xf5e8d3, 0xdccebd, 0xcebb9f, 0xffe1c5, 0xd5ccbf];
    const tilePalette = [0xffd8bb, 0xdfb19c, 0xfbccaf, 0xc8bdb5, 0xf9e8d1];
    const sectors = new Map();
    const houses = [];
    for (const plot of plots) {
      const merchant = plot.style === 'merchant';
      const h = plot.wharf ? 18 + rand() * 9 : merchant ? 16 + rand() * 11 : 9 + rand() * (plot.outer ? 8 : 11);
      const rh = plot.width * (merchant ? 0.50 + rand() * 0.27 : 0.32 + rand() * 0.23);
      const facadeType = plot.wharf ? 3 : merchant ? (rand() < 0.42 ? 1 : rand() < 0.54 ? 3 : 0)
        : (rand() < 0.48 ? 2 : rand() < 0.65 ? 0 : 3);
      const roofType = plot.wharf ? 0 : rand() < (merchant ? 0.72 : 0.40) ? 0 : (rand() < 0.52 ? 1 : 2);
      const house = {
        ...plot, h, rh, facadeType, roofType, details: [],
        facadeColor: new T.Color(palette[Math.floor(rand() * palette.length)]).multiplyScalar(0.83 + rand() * 0.17),
        roofColor: new T.Color(tilePalette[Math.floor(rand() * tilePalette.length)]).multiplyScalar(0.81 + rand() * 0.19),
        hasSteppedGable: facadeType === 1 && roofType === 0 && merchant && rand() < 0.45,
        hasChimney: rand() < 0.82,
        hasDormer: roofType === 0 && merchant && rand() < 0.28
      };
      const key = `${plot.x < 0 ? 0 : 1}:${Math.floor((plot.z + 300) / 1050)}`;
      if (!sectors.has(key)) sectors.set(key, []);
      sectors.get(key).push(house);
      houses.push(house);
    }

    const transform = new T.Object3D();
    const rubble = new T.Color(0x32241c);
    const touched = new Set(), collapsed = new Set();
    const trimMaterial = new T.MeshStandardMaterial({ color: 0x8c7a6d, roughness: 0.91 });

    function layer(name, geo, mat, members, place, shadow = true) {
      if (!members.length) return;
      const mesh = new T.InstancedMesh(geo, mat, members.length);
      mesh.name = name;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      for (let index = 0; index < members.length; index++) {
        const house = members[index];
        place(house, { mesh, index });
      }
      mesh.instanceMatrix.needsUpdate = true;
      root.add(mesh);
    }

    function write(slot, x, y, z, yaw, sx, sy, sz, color, pitch = 0, roll = 0) {
      transform.position.set(x, y, z);
      transform.rotation.set(pitch, yaw, roll);
      transform.scale.set(sx, sy, sz);
      transform.updateMatrix();
      slot.mesh.setMatrixAt(slot.index, transform.matrix);
      if (color) slot.mesh.setColorAt(slot.index, color);
      touched.add(slot.mesh);
    }

    for (const members of sectors.values()) {
      for (let kind = 0; kind < houseGeometries.length; kind++) {
        layer('House fronts', houseGeometries[kind], frontMat, members.filter(house => house.facadeType === kind), (house, slot) => {
          house.body = slot;
          write(slot, house.x, house.h * 0.5 + streetHeight, house.z, house.yaw,
            house.width, house.h, house.depth, house.facadeColor);
        });
      }
      for (let kind = 0; kind < roofs.length; kind++) {
        layer('Tile roofs', roofs[kind], mats.roofMat, members.filter(house => house.roofType === kind), (house, slot) => {
          house.roof = slot;
          write(slot, house.x, house.h + streetHeight, house.z, house.yaw,
            house.width + 1.2, house.rh, house.depth + 1.4, house.roofColor);
        });
      }
      layer('Stepped gables', stepGeometry, mats.stoneMat, members.filter(house => house.hasSteppedGable), (house, slot) => {
        house.details.push(slot);
        write(slot, house.x, house.h + streetHeight, house.z, house.yaw,
          house.width + 0.5, house.rh, house.depth + 1.8, house.facadeColor);
      });
      layer('Masonry chimneys', stackGeometry, trimMaterial, members.filter(house => house.hasChimney), (house, slot) => {
        house.details.push(slot);
        const offset = (rand() - 0.5) * house.depth * 0.50;
        write(slot, house.x + Math.sin(house.yaw) * offset, house.h + house.rh * 0.90 + streetHeight,
          house.z + Math.cos(house.yaw) * offset, house.yaw, 2.35, 5 + rand() * 3, 2.2, null);
      });
      layer('Roof dormers', roofs[0], mats.cap || mats.roofMat, members.filter(house => house.hasDormer), (house, slot) => {
        house.details.push(slot);
        const side = rand() < 0.5 ? -1 : 1;
        const offset = side * house.width * 0.31;
        write(slot, house.x + Math.cos(house.yaw) * offset, house.h + house.rh * 0.31 + streetHeight,
          house.z - Math.sin(house.yaw) * offset, house.yaw + side * Math.PI * 0.5, 4.2, 3.1, 5.8, house.roofColor);
      }, false);
    }

    for (let kind = 0; kind < houseGeometries.length; kind++) {
      layer('Gable ends', elevationGeometry(T, kind, true), frontMat,
        houses.filter(house => house.roofType === 0 && house.facadeType === kind), (house, slot) => {
          house.details.push(slot);
          write(slot, house.x, house.h + streetHeight, house.z, house.yaw,
            house.width + 1.17, house.rh, house.depth + 0.44, house.facadeColor);
        });
    }

    function refreshMeshes() {
      for (const mesh of touched) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      touched.clear();
    }

    function collapseBuildings(x, z, radius) {
      let count = 0;
      for (const house of houses) {
        if (collapsed.has(house) || Math.hypot(house.x - x, house.z - z) > radius) continue;
        const ruinHeight = house.h * 0.34;
        house.saved = [house.body, house.roof, ...house.details].map(slot => {
          const matrix = new T.Matrix4(), color = slot.mesh.instanceColor ? new T.Color() : null;
          slot.mesh.getMatrixAt(slot.index, matrix);
          if (color) slot.mesh.getColorAt(slot.index, color);
          return { slot, matrix, color };
        });
        write(house.body, house.x, ruinHeight * 0.5 + streetHeight, house.z, house.yaw,
          house.width, ruinHeight, house.depth, rubble, 0.12, -0.08);
        write(house.roof, house.x, ruinHeight * 0.72 + streetHeight, house.z, house.yaw + 0.20,
          house.width * 0.9, house.rh * 0.24, house.depth * 0.9, rubble, -0.15, 0.15);
        for (const detail of house.details) write(detail, house.x, streetHeight, house.z, 0, 0.002, 0.002, 0.002, null);
        collapsed.add(house);
        count++;
      }
      refreshMeshes();
      return count;
    }

    function reset() {
      for (const house of collapsed) {
        for (const { slot, matrix, color } of house.saved) {
          slot.mesh.setMatrixAt(slot.index, matrix);
          if (color) slot.mesh.setColorAt(slot.index, color);
          touched.add(slot.mesh);
        }
        house.saved = null;
      }
      collapsed.clear();
      refreshMeshes();
    }

    refreshMeshes();
    scene.add(root);
    return { collapseBuildings, reset, courtyardTrees };
  }

  (typeof window === 'undefined' ? globalThis : window).City3D = {
    enhanceValleyTerrain,
    buildMedievalLandmarks,
    createUrbanDistricts
  };
})();
