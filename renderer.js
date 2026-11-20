/* Perspective canvas renderer for Nuremberg 1561. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => (n < a ? a : n > b ? b : n);
  const lerp = (a, b, t) => a + (b - a) * t;

  let texInitialized = false;
  let seamlessDawnSource = null;
  let seamlessDawnCanvas = null;

  function seamlessDawn(img) {
    if (!isDrawable(img) || typeof document === 'undefined') return null;
    if (seamlessDawnSource === img) return seamlessDawnCanvas;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const overlap = Math.floor(iw * 0.12);
    if (!overlap || !ih) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = iw - overlap; canvas.height = ih;
      const c = canvas.getContext('2d');
      c.drawImage(img, overlap, 0, iw - overlap, ih, 0, 0, canvas.width, ih);
      const blend = document.createElement('canvas');
      blend.width = overlap; blend.height = ih;
      const b = blend.getContext('2d');
      b.drawImage(img, 0, 0, overlap, ih, 0, 0, overlap, ih);
      b.globalCompositeOperation = 'destination-in';
      const mask = b.createLinearGradient(0, 0, overlap, 0);
      mask.addColorStop(0, 'rgba(0,0,0,0)');
      mask.addColorStop(1, 'rgba(0,0,0,1)');
      b.fillStyle = mask; b.fillRect(0, 0, overlap, ih);
      c.drawImage(blend, canvas.width - overlap, 0);
      seamlessDawnSource = img; seamlessDawnCanvas = canvas;
      return canvas;
    } catch (_) {
      return null;
    }
  }

  function getTextures() {
    const tex = (typeof window !== 'undefined' && window.GameTextures) ||
      (typeof globalThis !== 'undefined' && globalThis.GameTextures) || null;
    if (tex && !texInitialized && typeof tex.init === 'function') {
      texInitialized = true;
      try {
        tex.init();
      } catch (_) {}
    }
    return tex;
  }

  function isDrawable(src) {
    if (!src) return false;
    if (typeof src.complete === 'boolean') {
      const iw = src.naturalWidth || src.width || 0;
      const ih = src.naturalHeight || src.height || 0;
      return src.complete && iw > 0 && ih > 0;
    }
    return (src.width || 0) > 0 && (src.height || 0) > 0;
  }

  function safeCanvas(tex, method, arg) {
    if (!tex || typeof tex[method] !== 'function') return null;
    try {
      const c = tex[method](arg);
      return isDrawable(c) ? c : null;
    } catch (_) {
      return null;
    }
  }

  function fallbackProject(x, y, z, player, w, h, focal) {
    const dx = x - player.x, dy = y - player.y, dz = z - player.z;
    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
    const px = dx * cy - dz * sy;
    const forward = dx * sy + dz * cy;
    const py = dy * cp - forward * sp;
    const depth = forward * cp + dy * sp;
    if (depth < 20) return null;
    return {
      x: w / 2 + px * focal / depth,
      y: h / 2 - py * focal / depth,
      z: depth,
      s: focal / depth
    };
  }

  function toRolledScreen(p, w, h, roll, sx, sy) {
    if (!p) return null;
    const dx = p.x - w / 2;
    const dy = p.y - h / 2;
    const cr = Math.cos(-roll), sr = Math.sin(-roll);
    return {
      x: w / 2 + sx + dx * cr - dy * sr,
      y: h / 2 + sy + dx * sr + dy * cr,
      z: p.z,
      s: p.s
    };
  }

  function hasGpuVfx(state) {
    return Boolean(state.gpuWorld && typeof window !== 'undefined' && window.World3D && window.World3D.rendersVFX);
  }

  function hasGpuCockpit(state) {
    return Boolean(state.gpuWorld && typeof window !== 'undefined' && window.World3D && window.World3D.rendersCockpit);
  }

  function poly(ctx, points, fill, stroke, lineWidth) {
    for (let i = 0; i < points.length; i++) {
      if (!points[i]) return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      if (lineWidth) ctx.lineWidth = lineWidth;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, Math.abs(width) * 0.5, Math.abs(height) * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawSkyAndTerrain(ctx, state, tex, horizon, project) {
    const { w, h, focal, time, player } = state;
    const pad = Math.max(w, h) * 0.65;

    // 1. Rayleigh/Mie atmospheric sky dome gradient.
    const sky = ctx.createLinearGradient(0, -pad, 0, h + pad);
    sky.addColorStop(0, '#07111a');
    sky.addColorStop(0.18, '#132738');
    sky.addColorStop(0.35, '#2b4555');
    sky.addColorStop(0.49, '#6c7c86');
    sky.addColorStop(0.57, '#d89b6a');
    sky.addColorStop(0.64, '#8b8a77');
    sky.addColorStop(0.82, '#324438');
    sky.addColorStop(1, '#15231d');
    ctx.fillStyle = sky;
    ctx.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);

    // 2. Seamless panoramic dawn sky & horizon backdrop (assets/nuremberg-dawn.png).
    const dawnSource = tex && tex.images ? tex.images.dawn : null;
    const blendedDawn = seamlessDawn(dawnSource);
    const dawnImg = blendedDawn || dawnSource;
    const dawnReady = isDrawable(dawnImg);
    const sunFracX = blendedDawn ? (0.143 - 0.12) / 0.88 : 0.143;
    const sunFracY = 0.568;
    const panW = Math.max(w * 2.5, h * 3.5);
    const dawnAspect = dawnReady ? (dawnImg.naturalHeight || dawnImg.height) / (dawnImg.naturalWidth || dawnImg.width) : 0.5625;
    const panH = panW * dawnAspect;
    const topY = horizon - panH * 0.59;
    const initialShift = sunFracX * panW - w * 0.72;
    const panShift = ((((player.yaw / TAU) * panW + initialShift) % panW) + panW) % panW;

    if (dawnReady) {
      ctx.save();
      ctx.globalAlpha = 0.78;
      for (let x = -panShift - panW; x < w + pad; x += panW) {
        ctx.drawImage(dawnImg, x, topY, panW, panH);
      }
      ctx.restore();

      // Smooth Rayleigh zenith fade above the painted panorama.
      const fadeH = Math.max(10, topY + panH * 0.28 + pad);
      const topFade = ctx.createLinearGradient(0, topY - 40, 0, topY + panH * 0.28);
      topFade.addColorStop(0, '#0d1b26');
      topFade.addColorStop(0.5, 'rgba(19,39,56,0.55)');
      topFade.addColorStop(1, 'rgba(19,39,56,0)');
      ctx.fillStyle = topFade;
      ctx.fillRect(-pad, -pad, w + pad * 2, fadeH);
    }

    // Compute exact screen-space sun position locked to the painted sunrise.
    let sx = w * 0.72;
    let bestSunDist = Infinity;
    for (let x = -panShift - panW; x < w + panW * 2; x += panW) {
      const candidateX = x + sunFracX * panW;
      const d = Math.abs(candidateX - w * 0.5);
      if (d < bestSunDist) {
        bestSunDist = d;
        sx = candidateX;
      }
    }
    const sy = topY + panH * sunFracY;

    // 3. Mie forward-scattering atmospheric haze & high-altitude dawn veil around the sun.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const mieWash = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.88);
    mieWash.addColorStop(0, 'rgba(255,244,214,0.42)');
    mieWash.addColorStop(0.14, 'rgba(255,198,132,0.22)');
    mieWash.addColorStop(0.42, 'rgba(225,134,88,0.08)');
    mieWash.addColorStop(1, 'rgba(140,105,120,0)');
    ctx.fillStyle = mieWash;
    ctx.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);

    // Solar disc & intense HDR corona.
    const sunCore = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(8, h * 0.46));
    sunCore.addColorStop(0, 'rgba(255,254,244,0.98)');
    sunCore.addColorStop(0.028, 'rgba(255,232,182,0.88)');
    sunCore.addColorStop(0.11, 'rgba(250,176,108,0.38)');
    sunCore.addColorStop(0.36, 'rgba(225,126,86,0.1)');
    sunCore.addColorStop(1, 'rgba(225,126,86,0)');
    ctx.fillStyle = sunCore;
    ctx.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);

    // Volumetric crepuscular God Rays fanning through Franconian valley mist.
    for (let i = 0; i < 9; i++) {
      const rayAng = 0.16 + i * 0.24 + Math.sin(time * 0.21 + i * 1.1) * 0.035;
      const len = Math.max(w, h) * 0.96;
      const spread = 0.038 + (i % 3) * 0.018;
      const ex = sx + Math.cos(rayAng) * len;
      const ey = sy + Math.sin(rayAng) * len;
      const rayGrad = ctx.createLinearGradient(sx, sy, ex, ey);
      rayGrad.addColorStop(0, 'rgba(255,222,168,0.095)');
      rayGrad.addColorStop(0.45, 'rgba(244,184,126,0.032)');
      rayGrad.addColorStop(1, 'rgba(244,184,126,0)');
      ctx.fillStyle = rayGrad;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(rayAng - spread) * len, sy + Math.sin(rayAng - spread) * len);
      ctx.lineTo(sx + Math.cos(rayAng + spread) * len, sy + Math.sin(rayAng + spread) * len);
      ctx.closePath();
      ctx.fill();
    }

    // Horizontal Hollywood anamorphic sun flare & optical ghosting along lens axis.
    const flareHalfW = Math.max(w * 0.62, 420);
    const streak = ctx.createLinearGradient(sx - flareHalfW, sy, sx + flareHalfW, sy);
    streak.addColorStop(0, 'rgba(130,205,255,0)');
    streak.addColorStop(0.24, 'rgba(145,212,255,0.14)');
    streak.addColorStop(0.43, 'rgba(255,220,165,0.26)');
    streak.addColorStop(0.5, 'rgba(255,250,234,0.68)');
    streak.addColorStop(0.57, 'rgba(255,215,155,0.26)');
    streak.addColorStop(0.76, 'rgba(135,205,255,0.13)');
    streak.addColorStop(1, 'rgba(135,205,255,0)');
    ctx.fillStyle = streak;
    ctx.fillRect(sx - flareHalfW, sy - 3, flareHalfW * 2, 6);

    const softStreak = ctx.createLinearGradient(sx - flareHalfW * 0.85, sy, sx + flareHalfW * 0.85, sy);
    softStreak.addColorStop(0, 'rgba(120,195,255,0)');
    softStreak.addColorStop(0.35, 'rgba(165,215,255,0.07)');
    softStreak.addColorStop(0.5, 'rgba(255,232,190,0.22)');
    softStreak.addColorStop(0.65, 'rgba(165,215,255,0.07)');
    softStreak.addColorStop(1, 'rgba(120,195,255,0)');
    ctx.fillStyle = softStreak;
    ctx.fillRect(sx - flareHalfW * 0.85, sy - 14, flareHalfW * 1.7, 28);

    // Subtle secondary optical lens ghosts opposite the sun.
    const sunOnScreen = clamp(1 - Math.hypot(sx - w * 0.5, sy - h * 0.5) / (w * 0.95), 0, 1);
    if (sunOnScreen > 0.08) {
      const vx = w * 0.5 - sx, vy = h * 0.5 - sy;
      for (let g = 0; g < 3; g++) {
        const tGhost = 0.55 + g * 0.52;
        const gx = w * 0.5 + vx * tGhost;
        const gy = h * 0.5 + vy * tGhost;
        const gr = Math.max(8, (18 + g * 14) * (h / 720));
        const ghostGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        const col = g === 1 ? '145,215,255' : '255,196,136';
        ghostGrad.addColorStop(0, `rgba(${col},${0.06 * sunOnScreen})`);
        ghostGrad.addColorStop(0.75, `rgba(${col},${0.085 * sunOnScreen})`);
        ghostGrad.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = ghostGrad;
        ctx.beginPath();
        ctx.arc(gx, gy, gr, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();

    // 4. Distant Franconian ridgelines with dawn aerial perspective.
    const ridgeColors = ['rgba(84,96,100,0.86)', 'rgba(66,81,79,0.92)', 'rgba(46,62,53,0.96)'];
    for (let layer = 0; layer < 3; layer++) {
      const y = horizon + 2 + layer * 10;
      ctx.beginPath();
      ctx.moveTo(-pad, h + pad);
      ctx.lineTo(-pad, y);
      for (let x = -pad; x <= w + pad; x += 36) {
        const wave = Math.sin(x * 0.0038 + player.yaw * (1.3 + layer * 0.85)) * 14 +
          Math.sin(x * 0.0115 + layer * 2.7) * 6;
        ctx.lineTo(x, y + wave);
      }
      ctx.lineTo(w + pad, h + pad);
      ctx.closePath();
      ctx.fillStyle = ridgeColors[layer];
      ctx.fill();
    }

    // 5. Ground valley plane + perspective-mapped Nuremberg terrain texture.
    const ground = ctx.createLinearGradient(0, horizon + 18, 0, h + pad);
    ground.addColorStop(0, '#6e7b66');
    ground.addColorStop(0.26, '#485d4c');
    ground.addColorStop(0.65, '#2b3e32');
    ground.addColorStop(1, '#172620');
    ctx.fillStyle = ground;
    ctx.fillRect(-pad, horizon + 18, w + pad * 2, h + pad - horizon);

    const terrainImg = tex && tex.images ? tex.images.terrain : null;
    if (isDrawable(terrainImg)) {
      const iw = terrainImg.naturalWidth || terrainImg.width;
      const ih = terrainImg.naturalHeight || terrainImg.height;
      // Project a fixed world-space mesh. Unlike screen-space strips, the
      // river, streets and fields stay anchored during turns and forward flight.
      const worldW = 3600, worldD = 4200, columns = 24, rows = 32;
      const originX = Math.round(player.x / worldW) * worldW;
      const originZ = Math.floor(player.z / worldD) * worldD;
      const cells = [];
      for (let tz = -1; tz <= 1; tz++) {
        for (let tx = -1; tx <= 1; tx++) {
          const left = originX + tx * worldW - worldW / 2;
          const near = originZ + tz * worldD + 450;
          for (let iz = 0; iz < rows; iz++) {
            const z0 = near + iz * worldD / rows, z1 = near + (iz + 1) * worldD / rows;
            for (let ix = 0; ix < columns; ix++) {
              const x0 = left + ix * worldW / columns, x1 = left + (ix + 1) * worldW / columns;
              const p0 = project(x0, 0, z0), p1 = project(x1, 0, z0);
              const p2 = project(x1, 0, z1), p3 = project(x0, 0, z1);
              if (!p0 || !p1 || !p2 || !p3) continue;
              const margin = Math.max(w, h) * 0.18;
              if (Math.max(p0.x, p1.x, p2.x, p3.x) < -margin || Math.min(p0.x, p1.x, p2.x, p3.x) > w + margin ||
                  Math.max(p0.y, p1.y, p2.y, p3.y) < -margin || Math.min(p0.y, p1.y, p2.y, p3.y) > h + margin) continue;
              cells.push({ p0, p1, p2, p3, ix, iz, depth: (p0.z + p1.z + p2.z + p3.z) / 4 });
            }
          }
        }
      }
      cells.sort((a, b) => b.depth - a.depth);
      for (const cell of cells) {
        const { p0, p1, p2, p3, ix, iz } = cell;
        // Two affine triangles preserve all four corners of each projected cell.
        const drawTriangle = (a, b, c, uv) => {
          ctx.save(); ctx.beginPath(); ctx.moveTo(a.x,a.y);
          ctx.lineTo(b.x,b.y); ctx.lineTo(c.x,c.y); ctx.closePath(); ctx.clip();
          const [u0,v0,u1,v1,u2,v2] = uv;
          const det=(u1-u0)*(v2-v0)-(u2-u0)*(v1-v0);
          const A=((b.x-a.x)*(v2-v0)-(c.x-a.x)*(v1-v0))/det;
          const B=((b.y-a.y)*(v2-v0)-(c.y-a.y)*(v1-v0))/det;
          const C=((c.x-a.x)*(u1-u0)-(b.x-a.x)*(u2-u0))/det;
          const D=((c.y-a.y)*(u1-u0)-(b.y-a.y)*(u2-u0))/det;
          ctx.transform(A,B,C,D,a.x-A*u0-C*v0,a.y-B*u0-D*v0);
          ctx.drawImage(terrainImg,0,0); ctx.restore();
        };
        const u=ix*iw/columns,v=iz*ih/rows,du=iw/columns,dv=ih/rows;
        drawTriangle(p0,p1,p2,[u,v,u+du,v,u+du,v+dv]);
        drawTriangle(p0,p2,p3,[u,v,u+du,v+dv,u,v+dv]);
      }
    }

    // Warm golden valley dawn mist rising off the Franconian plain.
    const fog = ctx.createLinearGradient(0, horizon - 16, 0, horizon + h * 0.25);
    fog.addColorStop(0, 'rgba(236,196,154,0.38)');
    fog.addColorStop(0.45, 'rgba(210,186,164,0.14)');
    fog.addColorStop(1, 'rgba(210,186,164,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(-pad, horizon - 16, w + pad * 2, h * 0.25 + 16);

    // Fallback river and roads only when the aerial terrain is unavailable.
    if (!isDrawable(terrainImg)) {
    // 6. Pegnitz river winding through the valley with specular dawn reflections.
    const baseZ = Math.floor(player.z / 400) * 400;
    const riverPts = [];
    for (let rz = baseZ - 400; rz <= baseZ + 4800; rz += 220) {
      const rx = Math.sin(rz * 0.00085) * 620 + Math.cos(rz * 0.0003) * 240;
      const rp = project(rx, 2, rz);
      if (rp) riverPts.push({ x: rp.x, y: rp.y, s: rp.s, rz });
    }
    if (riverPts.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(riverPts[0].x, riverPts[0].y);
      for (let i = 1; i < riverPts.length; i++) ctx.lineTo(riverPts[i].x, riverPts[i].y);

      ctx.lineWidth = 14;
      ctx.strokeStyle = 'rgba(54,78,76,0.38)';
      ctx.stroke();

      ctx.lineWidth = 6.5;
      ctx.strokeStyle = 'rgba(130,162,154,0.34)';
      ctx.stroke();

      // Dynamic sun-glint specular water highlights along the Pegnitz.
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < riverPts.length - 1; i++) {
        const a = riverPts[i], b = riverPts[i + 1];
        const shimmer = 0.5 + 0.5 * Math.sin(time * 3.4 + a.rz * 0.015);
        const sunAlign = clamp(1 - Math.abs(a.x - sx) / (w * 0.55), 0.15, 1);
        ctx.strokeStyle = `rgba(255,212,150,${0.18 + shimmer * 0.24 * sunAlign})`;
        ctx.lineWidth = clamp(a.s * 12, 1.5, 4.5);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Subtle medieval road & field division grid lines.
    const baseX = Math.floor(player.x / 400) * 400;
    ctx.save();
    ctx.strokeStyle = 'rgba(22,38,31,0.22)';
    ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i++) {
      const a = project(baseX + i * 400, 0, baseZ - 400);
      const b = project(baseX + i * 400, 0, baseZ + 4500);
      if (a && b) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    for (let j = 1; j < 11; j++) {
      const a = project(baseX - 3200, 0, baseZ + j * 400);
      const b = project(baseX + 3200, 0, baseZ + j * 400);
      if (a && b) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();
    }

    return { sx, sy };
  }

  // Stable, world-space variation keeps material details attached to a building as
  // the camera moves.  The details are deliberately omitted at small sizes.
  function cityNoise(n) {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  function cityLine(ctx, project, p1, p2, color, width) {
    const a = project(...p1), b = project(...p2);
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function drawWallDetails(ctx, project, x, z, length, height, alongX, seed, tower, detail) {
    const point = (u, y) => alongX ? [x + u, y, z] : [x, y, z + u];
    // Irregular courses and darker stone joints break up the large flat faces.
    if (detail > 1) {
      for (let y = 2; y < height - 1; y += 2.5) {
        cityLine(ctx, project, point(0, y), point(length, y), 'rgba(42,40,35,0.13)', 0.65);
      }
      for (let y = 1; y < height - 1; y += 5) {
        for (let u = 2 + cityNoise(seed + y) * 2; u < length; u += 4 + cityNoise(seed + u) * 2) {
          cityLine(ctx, project, point(u, y), point(u, Math.min(y + 2.5, height)), 'rgba(50,46,39,0.10)', 0.6);
        }
      }
    }

    // Dark recessed glazing, stone lintels and sills, spaced by floor rather
    // than fixed to the image plane. A few warm interiors remain understated.
    const floors = Math.max(1, Math.floor((height - 2) / 7));
    const bays = Math.max(1, Math.floor(length / 7));
    for (let row = 0; row < floors; row++) {
      for (let col = 0; col < bays; col++) {
        const u = length * (col + 0.5) / bays;
        const half = Math.min(1, length / bays * 0.2);
        const y = 2 + row * 7;
        if (y + 3.5 > height - 0.5) continue;
        const windowPoints = [point(u - half, y), point(u + half, y), point(u + half, y + 3.5), point(u - half, y + 3.5)].map(p => project(...p));
        const lit = cityNoise(seed + row * 17 + col * 39) > 0.89;
        poly(ctx, windowPoints, lit ? '#8c7659' : '#28302d');
        if (detail > 1) {
          cityLine(ctx, project, point(u - half - 0.3, y - 0.2), point(u + half + 0.3, y - 0.2), 'rgba(214,199,170,0.56)', 0.8);
          cityLine(ctx, project, point(u, y), point(u, y + 3.5), 'rgba(170,163,145,0.35)', 0.6);
          cityLine(ctx, project, point(u - half, y + 1.7), point(u + half, y + 1.7), 'rgba(170,163,145,0.35)', 0.6);
        }
      }
    }
    if (!tower && detail > 1) {
      // Structural timber is weathered and restrained, not a cartoon outline.
      for (let y = 7; y < height - 2; y += 7) {
        cityLine(ctx, project, point(0, y), point(length, y), 'rgba(60,46,37,0.34)', 1.3);
      }
    }
  }

  function drawRoofDetails(ctx, project, x, z, width, depth, height, roof, seed, detail, visibleSide) {
    // World-space tile rows follow each slope, with staggered joints at close range.
    for (let side = 0; side < 2; side++) {
      if (side !== visibleSide) continue;
      const edgeX = side ? x + width : x;
      const ridgeX = x + width * 0.5;
      const at = (t, zz) => [lerp(edgeX, ridgeX, t), height + roof * t + 0.3, zz];
      const count = detail > 1 ? 9 : 5;
      for (let row = 1; row < count; row++) {
        const t = row / count;
        cityLine(ctx, project, at(t, z), at(t, z + depth), 'rgba(44,28,23,0.22)', 0.7);
        if (detail > 1) {
          const offset = (row % 2) * 1.5 + cityNoise(seed + row);
          for (let zz = z + offset + 1.5; zz < z + depth; zz += 3) {
            cityLine(ctx, project, at(t, zz), at(Math.min(1, t + 1 / count), zz), 'rgba(43,29,25,0.16)', 0.6);
          }
        }
      }
    }
  }

  // Subdivide the surface before mapping an image to approximate perspective
  // on Canvas 2D. Clipping keeps each strip inside the projected face.
  function drawCityMaterial(ctx, img, project, corners, top, bottom) {
    if (!isDrawable(img)) return;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const interpolate = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
    const strips = 4;
    for (let i = 0; i < strips; i++) {
      const t0 = i / strips, t1 = (i + 1) / strips;
      const p0 = project(...interpolate(corners[0], corners[3], t0));
      const p1 = project(...interpolate(corners[1], corners[2], t0));
      const p2 = project(...interpolate(corners[1], corners[2], t1));
      const p3 = project(...interpolate(corners[0], corners[3], t1));
      if (!p0 || !p1 || !p2 || !p3) continue;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
      ctx.closePath(); ctx.clip();
      ctx.transform(p1.x - p0.x, p1.y - p0.y, p3.x - p0.x, p3.y - p0.y, p0.x, p0.y);
      ctx.drawImage(img, 0, ih * (top + (bottom - top) * t0), iw, ih * (bottom - top) / strips, 0, 0, 1, 1);
      ctx.restore();
    }
  }

  function drawCityscape(ctx, state, tex, project) {
    const { w, time, player, buildings } = state;
    if (!buildings.length) return;

    const tileX = Math.round(player.x / 3600) * 3600;
    const tileZ = Math.floor(player.z / 4200) * 4200;
    const sorted = [];

    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        for (let i = 0; i < buildings.length; i++) {
          const b = buildings[i];
          const x = b.x + tileX + ox * 3600;
          const z = b.z + tileZ + oz * 4200;
          const dx = x - player.x, dz = z - player.z;
          if (Math.abs(dz) < 4200 && Math.abs(dx) < 2800) {
            sorted.push({ b, x, z, distSq: dx * dx + dz * dz });
          }
        }
      }
    }
    sorted.sort((a, b) => b.distSq - a.distSq);

    // Sun shadow cast direction opposite to sunrise (front-right -> shadow falls back-left).
    const shX = -0.45, shZ = -0.38;

    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      const { w: ww, d, h: hh, roof, tower, church, smoke } = item.b;
      const x = item.x, z = item.z;

      const a = project(x, 0, z);
      const b1 = project(x + ww, 0, z);
      const c = project(x + ww, hh, z);
      const d1 = project(x, hh, z);
      const e = project(x, hh, z + d);
      const f = project(x + ww, hh, z + d);
      const g = project(x + ww, 0, z + d);
      const ridge1 = project(x + ww * 0.5, hh + roof, z);
      const ridge2 = project(x + ww * 0.5, hh + roof, z + d);

      if (!a || !b1 || !c || !d1 || !e || !f || !g || !ridge1 || !ridge2) continue;
      // The aerial plate already contains the distant town; reserve separate
      // geometry for the foreground where its volume is most useful.
      if (tex && tex.images && isDrawable(tex.images.terrain) && a.z > 2600) continue;
      if ((a.x < -300 && b1.x < -300) || (a.x > w + 300 && b1.x > w + 300)) continue;

      const atm = clamp(1 - a.z / 7400, 0.24, 1);
      ctx.save();
      ctx.globalAlpha = atm;

      // Ground shadow footprint on close/mid buildings.
      if (a.z < 2600) {
        const sLen = (hh + roof * 0.6) * 0.65;
        const sa = project(x + shX * sLen, 1, z + shZ * sLen);
        const sb = project(x + ww + shX * sLen, 1, z + shZ * sLen);
        if (sa && sb) {
          poly(ctx, [a, b1, sb, sa], 'rgba(14,22,19,0.28)');
        }
      }

      const variation = cityNoise(item.b.x * 0.13 + item.b.z * 0.21);
      const wallColors = ['#aa9a80', '#b8a68a', '#a69b8a', '#b7a990', '#998d79'];
      const roofColors = ['#8a5545', '#965c49', '#805144', '#a2644d', '#70504a'];
      const baseWall = tower ? '#958d7b' : wallColors[Math.floor(variation * wallColors.length)];
      const baseRoof = church ? '#625953' : roofColors[Math.floor(cityNoise(variation * 31) * roofColors.length)];
      const frontZ = player.z < z + d * 0.5 ? z : z + d;
      const sideX = player.x < x + ww * 0.5 ? x : x + ww;
      const front = [project(x, 0, frontZ), project(x + ww, 0, frontZ), project(x + ww, hh, frontZ), project(x, hh, frontZ)];
      const side = [project(sideX, 0, z), project(sideX, 0, z + d), project(sideX, hh, z + d), project(sideX, hh, z)];
      const widthPx = Math.max(Math.hypot(b1.x - a.x, b1.y - a.y), Math.hypot(g.x - b1.x, g.y - b1.y));
      const detail = widthPx > 28 ? 2 : widthPx > 9 ? 1 : 0;
      const material = tex && tex.images ? tex.images.cityMaterials : null;

      poly(ctx, front, baseWall);
      poly(ctx, side, baseWall);
      if (detail && isDrawable(material)) {
        ctx.save(); ctx.globalAlpha *= 0.68;
        drawCityMaterial(ctx, material, project, [[x,hh,frontZ],[x+ww,hh,frontZ],[x+ww,0,frontZ],[x,0,frontZ]], 0.02, 0.48);
        drawCityMaterial(ctx, material, project, [[sideX,hh,z],[sideX,hh,z+d],[sideX,0,z+d],[sideX,0,z]], 0.02, 0.48);
        ctx.restore();
      }
      // Side wall receives less light; the warm haze further unifies the city.
      poly(ctx, side, 'rgba(35,42,37,0.19)');
      if (detail) {
        drawWallDetails(ctx, project, x, frontZ, ww, hh, true, variation * 100, tower, detail);
        drawWallDetails(ctx, project, sideX, z, d, hh, false, variation * 100 + 7, tower, detail);
      }

      const frontRidge = project(x + ww * 0.5, hh + roof, frontZ);
      poly(ctx, [front[3], front[2], frontRidge], baseWall);
      const leftRoof = [d1, e, ridge2, ridge1];
      const rightRoof = [c, f, ridge2, ridge1];
      const nearRoof = sideX === x ? leftRoof : rightRoof;
      const farRoof = sideX === x ? rightRoof : leftRoof;
      poly(ctx, farRoof, baseRoof);
      poly(ctx, nearRoof, baseRoof);
      if (detail && isDrawable(material)) {
        ctx.save(); ctx.globalAlpha *= 0.8;
        drawCityMaterial(ctx, material, project, [[sideX,hh,z],[sideX,hh,z+d],[x+ww*0.5,hh+roof,z+d],[x+ww*0.5,hh+roof,z]], 0.52, 0.98);
        ctx.restore();
      }
      if (sideX === x) poly(ctx, nearRoof, 'rgba(27,32,29,0.15)');
      if (detail) drawRoofDetails(ctx, project, x, z, ww, d, hh, roof, variation * 100, detail, sideX === x ? 0 : 1);

      // Roof ridge sunlit highlight line.
      ctx.strokeStyle = 'rgba(235,195,148,0.34)';
      ctx.lineWidth = Math.max(0.6, a.s * 1.4);
      ctx.beginPath();
      ctx.moveTo(ridge1.x, ridge1.y);
      ctx.lineTo(ridge2.x, ridge2.y);
      ctx.stroke();

      // Gothic church twin spires & fortified towers.
      if (tower) {
        const spireH = church ? 22 : 15;
        const q = project(x + ww * 0.5, hh + roof + spireH, z + d * 0.5);
        if (q) {
          poly(ctx, [ridge1, ridge2, q], '#4c5953');
          poly(ctx, [c, ridge1, q], '#394541');
        }
        if (church && q) {
          const q2 = project(x + ww * 0.3, hh + roof + spireH * 0.88, z + d * 0.25);
          if (q2) poly(ctx, [d1, ridge1, q2], '#3f4b46');
        }
      }

      // Rising Nuremberg hearth chimney smoke plumes.
      if (smoke && a.z < 2400 && ridge1) {
        const drift = Math.sin(time * 0.9 + x * 0.02) * 9;
        for (let s = 1; s <= 4; s++) {
          const sr = clamp((3 + s * 2.4) * a.s * 6, 1.5, 11);
          ctx.fillStyle = `rgba(195,196,192,${0.18 - s * 0.032})`;
          ctx.beginPath();
          ctx.arc(ridge1.x + drift * s * 0.55, ridge1.y - s * 10 * clamp(a.s * 3, 0.3, 1.4), sr, 0, TAU);
          ctx.fill();
        }
      }

      ctx.restore();
    }
  }

  function drawClouds(ctx, state, tex, sunPos, project) {
    const { w, h, player, clouds } = state;
    if (!clouds.length) return { cloudMist: 0 };

    const tileZ = 7000;
    const baseZ = Math.floor(player.z / tileZ) * tileZ;
    const visible = [];
    let cloudMist = 0;

    for (let oz = 0; oz <= 1; oz++) {
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        const cz = c.z + baseZ + oz * tileZ;
        const cx = c.x + player.x * 0.25;
        const dist = cz - player.z;

        // Check proximity for cockpit canopy condensation mist when flying through clouds.
        const dist3D = Math.hypot(cx - player.x, (c.y - player.y) * 1.8, cz - player.z);
        if (dist3D < 520) {
          cloudMist = Math.max(cloudMist, clamp(1 - dist3D / 520, 0, 1));
        }

        if (dist < -400 || dist > 6800) continue;
        const p = project(cx, c.y, cz);
        if (!p || p.x < -500 || p.x > w + 500 || p.y < -340 || p.y > h + 340) continue;
        visible.push({ c, cx, cz, p, idx: i });
      }
    }

    visible.sort((a, b) => b.p.z - a.p.z);

    for (let i = 0; i < visible.length; i++) {
      const item = visible[i];
      const fadeNear = clamp((item.p.z - 110) / 380, 0, 1);
      const fadeFar = clamp(1 - item.p.z / 6800, 0.14, 1);
      const alpha = fadeNear * fadeFar * 0.68;
      if (alpha <= 0.02) continue;

      const sunProximity = sunPos
        ? clamp(1 - Math.hypot(item.p.x - sunPos.sx, item.p.y - sunPos.sy) / (w * 0.65), 0, 1)
        : 0;

      ctx.save();
      for (let k = 0; k < item.c.puffs.length; k++) {
        const puff = item.c.puffs[k];
        const pp = project(item.cx + puff.ox, item.c.y + puff.oy, item.cz + puff.oz);
        if (!pp) continue;
        const rx = clamp(puff.rx * pp.s, 16, 420);
        const ry = clamp(puff.ry * pp.s, 8, 170);
        const cloudCanvas = safeCanvas(tex, 'getCloudCanvas', (item.idx + k) % 3);

        ctx.globalAlpha = alpha;
        if (cloudCanvas) {
          ctx.drawImage(cloudCanvas, pp.x - rx * 1.15, pp.y - ry * 1.25, rx * 2.3, ry * 2.5);
        } else {
          const cg = ctx.createRadialGradient(pp.x, pp.y - ry * 0.28, 0, pp.x, pp.y, rx);
          cg.addColorStop(0, 'rgba(248,220,188,0.68)');
          cg.addColorStop(0.5, 'rgba(138,150,156,0.42)');
          cg.addColorStop(1, 'rgba(54,70,78,0)');
          ctx.fillStyle = cg;
          ctx.beginPath();
          ctx.ellipse(pp.x, pp.y, rx, ry, 0, 0, TAU);
          ctx.fill();
        }

        // Subtle Mie forward-scattering golden silver-lining when backlit by the sunrise.
        if (sunProximity > 0.15) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = alpha * sunProximity * 0.28;
          const rim = ctx.createRadialGradient(pp.x, pp.y - ry * 0.2, rx * 0.2, pp.x, pp.y, rx * 1.05);
          rim.addColorStop(0, 'rgba(255,232,190,0.4)');
          rim.addColorStop(0.7, 'rgba(255,190,125,0.22)');
          rim.addColorStop(1, 'rgba(255,190,125,0)');
          ctx.fillStyle = rim;
          ctx.beginPath();
          ctx.ellipse(pp.x, pp.y, rx * 1.05, ry * 1.05, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    return { cloudMist };
  }

  function drawWingman(ctx, state, project) {
    const { time, player, wingmanTrail } = state;
    const gpuVfx = hasGpuVfx(state);

    if (!gpuVfx && wingmanTrail && wingmanTrail.length > 2) {
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < wingmanTrail.length; i++) {
        const a = project(wingmanTrail[i - 1].x, wingmanTrail[i - 1].y, wingmanTrail[i - 1].z);
        const b = project(wingmanTrail[i].x, wingmanTrail[i].y, wingmanTrail[i].z);
        if (!a || !b) continue;
        const frac = i / wingmanTrail.length;
        ctx.strokeStyle = `rgba(232,240,238,${frac * 0.34})`;
        ctx.lineWidth = Math.max(0.8, frac * 2.2);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    const sweep = Math.sin(time * 0.34) * 0.24;
    const ang = player.yaw + 0.46 + sweep;
    const dist = 1280 + Math.cos(time * 0.42) * 180;
    const wp = {
      x: player.x + Math.sin(ang) * dist,
      y: player.y - 95 + Math.sin(time * 0.65) * 45,
      z: player.z + Math.cos(ang) * dist,
      bank: -0.14 + Math.cos(time * 0.34) * 0.22
    };

    const p = project(wp.x, wp.y, wp.z);
    if (!p) return;
    const s = clamp(p.s * 54, 9, 46);
    const gpuEntities = Boolean(
      state.gpuWorld && typeof window !== 'undefined' && window.World3D && window.World3D.rendersEntities
    );

    if (!gpuEntities) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(wp.bank);

      // Afterburner plume & Mach shock diamonds.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const flameLen = s * (1.05 + Math.sin(time * 42) * 0.18);
      const flame = ctx.createRadialGradient(0, s * 1.15, 0, 0, s * 1.15 + flameLen * 0.45, Math.max(1, flameLen));
      flame.addColorStop(0, 'rgba(255,250,228,0.95)');
      flame.addColorStop(0.28, 'rgba(255,158,72,0.75)');
      flame.addColorStop(0.68, 'rgba(95,165,255,0.32)');
      flame.addColorStop(1, 'rgba(95,165,255,0)');
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.ellipse(0, s * 1.32, Math.max(1, s * 0.16), Math.max(1, flameLen * 0.68), 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      const jet = ctx.createLinearGradient(-s, 0, s, 0);
      jet.addColorStop(0, '#1e2a2d');
      jet.addColorStop(0.45, '#73807b');
      jet.addColorStop(0.6, '#3b4d4b');
      jet.addColorStop(1, '#162426');
      ctx.fillStyle = jet;
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.72);
      ctx.lineTo(s * 0.25, -s * 0.25);
      ctx.lineTo(s * 1.24, s * 0.62);
      ctx.lineTo(s * 1.06, s * 0.88);
      ctx.lineTo(s * 0.22, s * 0.5);
      ctx.lineTo(s * 0.34, s * 1.22);
      ctx.lineTo(0, s);
      ctx.lineTo(-s * 0.34, s * 1.22);
      ctx.lineTo(-s * 0.22, s * 0.5);
      ctx.lineTo(-s * 1.06, s * 0.88);
      ctx.lineTo(-s * 1.24, s * 0.62);
      ctx.lineTo(-s * 0.25, -s * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(215,228,215,0.48)';
      ctx.lineWidth = Math.max(0.6, s * 0.035);
      ctx.stroke();

      // Gold-tinted stealth canopy + Argentine Air Force fin flash.
      ctx.fillStyle = '#36443e';
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.65, Math.max(0.5, s * 0.12), Math.max(1, s * 0.37), 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#8bc7d3'; ctx.fillRect(-s * 0.12, s * 0.68, s * 0.24, s * 0.08);
      ctx.fillStyle = '#f5f5df'; ctx.fillRect(-s * 0.12, s * 0.76, s * 0.24, s * 0.07);
      ctx.fillStyle = '#8bc7d3'; ctx.fillRect(-s * 0.12, s * 0.83, s * 0.24, s * 0.08);
      ctx.restore();
    }

    ctx.save();
    const nearRight = p.x > (state.w || 1280) * 0.66;
    ctx.strokeStyle = 'rgba(138,224,196,0.75)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 8);
    ctx.lineTo(p.x + 8, p.y);
    ctx.lineTo(p.x, p.y + 8);
    ctx.lineTo(p.x - 8, p.y);
    ctx.closePath();
    ctx.stroke();
    ctx.font = '600 9.5px Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(182,238,214,0.88)';
    ctx.textAlign = nearRight ? 'right' : 'left';
    ctx.fillText('ARG-062', nearRight ? p.x - 13 : p.x + 13, p.y - 6);
    ctx.restore();
  }

  function drawElectricArc(ctx, x1, y1, x2, y2, seed, color) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    const steps = 4;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const jitter = Math.sin(seed * 13.7 + i * 7.3) * 0.32;
      const nx = lerp(x1, x2, t) + -(y2 - y1) * jitter;
      const ny = lerp(y1, y2, t) + (x2 - x1) * jitter;
      ctx.lineTo(nx, ny);
    }
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function drawEnemies(ctx, state, tex, sunPos, project) {
    const { w, h, time, state: gameState, player, enemies, lockedTarget } = state;
    if (!enemies.length) return;

    const sorted = enemies
      .slice()
      .sort((a, b) => Math.hypot(b.x - player.x, b.z - player.z) - Math.hypot(a.x - player.x, a.z - player.z));

    const anomalyImg = tex && tex.images ? tex.images.anomaly : null;
    const anomalyReady = isDrawable(anomalyImg);
    const gpuVfx = hasGpuVfx(state);
    const gpuEntities = Boolean(state.gpuWorld && typeof window !== 'undefined' && window.World3D?.rendersEntities);

    for (let idx = 0; idx < sorted.length; idx++) {
      const e = sorted[idx];
      const p = project(e.x, e.y, e.z);
      if (!p || p.x < -180 || p.x > w + 180 || p.y < -180 || p.y > h + 180) continue;

      const r = clamp((e.size || 72) * p.s, 2, 180);
      const atmFade = clamp(1 - p.z / 7600, 0.42, 1);
      const variant = (e.variant !== undefined ? e.variant : Math.abs(Math.round((e.phase || 0) * 10))) % 3;
      const sunAngle = sunPos ? Math.atan2(sunPos.sy - p.y, sunPos.sx - p.x) : -0.7;

      // Damaged smoke trail behind wounded anomalies (handled in 3D when VFX3D is active).
      if (!gpuVfx && e.hp < e.maxHp) {
        const smokeTex = safeCanvas(tex, 'getSmokeCanvas', variant);
        const evx = e.vx || 0, evy = e.vy || 0, evz = e.vz || 0;
        const velLen = Math.hypot(evx, evy, evz) || 1;
        const backX = e.x - (evx / velLen) * 85;
        const backY = e.y - (evy / velLen) * 85 + 14;
        const backZ = e.z - (evz / velLen) * 85;
        const sp = project(backX, backY, backZ);
        if (sp) {
          ctx.save();
          ctx.globalAlpha = atmFade * 0.45;
          const sr = clamp(r * 1.15, 6, 54);
          if (smokeTex) {
            ctx.drawImage(smokeTex, sp.x - sr, sp.y - sr, sr * 2, sr * 2);
          } else {
            const sg = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sr);
            sg.addColorStop(0, 'rgba(34,34,36,0.65)');
            sg.addColorStop(1, 'rgba(34,34,36,0)');
            ctx.fillStyle = sg;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, sr, 0, TAU);
            ctx.fill();
          }
          ctx.restore();
        }
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = atmFade;

      // 1. Heat-distortion refractive halo rings around active celestial objects.
      if (!gpuEntities && r > 7) {
        const shimmer = 1 + Math.sin(time * 8.5 + (e.phase || 0)) * 0.06;
        const heatR = r * (1.26 + (e.charge || 0) * 0.45) * shimmer;
        ctx.save();
        ctx.strokeStyle = e.charge > 0.1
          ? `rgba(255,188,112,${0.2 + e.charge * 0.35})`
          : 'rgba(218,228,232,0.12)';
        ctx.lineWidth = Math.max(0.8, r * 0.04);
        ctx.beginPath();
        ctx.arc(0, 0, heatR, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }

      // 2. Plasma charge flares & impact flash corona.
      if ((e.charge || 0) > 0.04 || (e.hitTimer || 0) > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const charge = e.charge || 0;
        const glowR = Math.max(2, r * (gpuEntities ? 0.85 + charge * 0.48 : 2.3 + charge * 1.8));
        const aura = ctx.createRadialGradient(0, 0, Math.max(0.5, r * 0.15), 0, 0, glowR);
        if ((e.hitTimer || 0) > 0) {
          aura.addColorStop(0, 'rgba(255,248,218,0.9)');
          aura.addColorStop(0.38, 'rgba(115,222,255,0.48)');
          aura.addColorStop(1, 'rgba(115,222,255,0)');
        } else {
          aura.addColorStop(0, `rgba(255,226,158,${0.65 * charge})`);
          aura.addColorStop(0.42, `rgba(255,112,48,${0.32 * charge})`);
          aura.addColorStop(1, 'rgba(255,90,32,0)');
        }
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(0, 0, glowR, 0, TAU);
        ctx.fill();

        // Cross-flare spike when weapon charge peaks.
        if (charge > 0.45 && !gpuEntities) {
          const spikeW = r * (2.6 + charge * 2.2);
          const spikeG = ctx.createLinearGradient(-spikeW, 0, spikeW, 0);
          spikeG.addColorStop(0, 'rgba(255,140,60,0)');
          spikeG.addColorStop(0.5, `rgba(255,242,205,${charge * 0.72})`);
          spikeG.addColorStop(1, 'rgba(255,140,60,0)');
          ctx.fillStyle = spikeG;
          ctx.fillRect(-spikeW, -Math.max(1, r * 0.08), spikeW * 2, Math.max(2, r * 0.16));
        }
        ctx.restore();
      }

      // 3. Textured PBR Celestial Object & Enemy Fighter Geometry (skipped when 3D WebGL meshes are active).
      if (!gpuEntities && e.type === 'sphere') {
        const tilt = -0.3 + Math.sin(e.ringPhase || 0) * 0.18;
        const sphereTex = safeCanvas(tex, 'getSphereCanvas', variant);

        // Back arc of gyroscopic equatorial ring behind sphere.
        ctx.strokeStyle = 'rgba(224,212,182,0.4)';
        ctx.lineWidth = Math.max(0.8, r * 0.042);
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(1, r * 1.24), Math.max(0.5, r * 0.28), tilt, Math.PI, TAU);
        ctx.stroke();

        if (sphereTex) {
          ctx.drawImage(sphereTex, -r, -r, r * 2, r * 2);
        } else {
          const g = ctx.createRadialGradient(-r * 0.36, -r * 0.4, Math.max(0.2, r * 0.04), 0, 0, r);
          g.addColorStop(0, '#efe1c8');
          g.addColorStop(0.16, '#9fa9a2');
          g.addColorStop(0.4, '#4c5957');
          g.addColorStop(0.76, '#1f2b2e');
          g.addColorStop(1, '#091115');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, TAU);
          ctx.fill();
        }

        // Blend photorealistic anomaly render detail if loaded.
        if (anomalyReady && r > 9) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.96, 0, TAU);
          ctx.clip();
          ctx.globalAlpha = atmFade * 0.32;
          ctx.drawImage(anomalyImg, -r, -r, r * 2, r * 2);
          ctx.restore();
        }

        // Front arc of equatorial ring + subtle meridian ring.
        ctx.strokeStyle = 'rgba(242,224,186,0.68)';
        ctx.lineWidth = Math.max(0.9, r * 0.045);
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(1, r * 1.24), Math.max(0.5, r * 0.28), tilt, 0, Math.PI);
        ctx.stroke();

        if (r > 6) {
          ctx.strokeStyle = 'rgba(135,215,225,0.34)';
          ctx.beginPath();
          ctx.ellipse(0, 0, Math.max(0.5, r * 0.54), Math.max(1, r * 1.06), tilt + Math.cos((e.ringPhase || 0) * 0.7) * 0.3, 0, TAU);
          ctx.stroke();
        }

        // Pulsing furnace-orange core eye.
        const pulse = 0.75 + 0.25 * Math.sin(time * 5 + (e.phase || 0));
        ctx.fillStyle = `rgba(255,168,94,${pulse})`;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(1.4, r * 0.14), 0, TAU);
        ctx.fill();
      } else if (!gpuEntities && e.type === 'fighter') {
        const fighterAngle = (e.bank || 0) * 0.78 + Math.sin((e.phase || 0) * 0.8) * 0.08;
        ctx.save();
        ctx.rotate(fighterAngle);
        const fighterTex = safeCanvas(tex, 'getFighterCanvas', variant);
        const fw = r * 2.5, fh = r * 2.5;
        if (fighterTex) {
          ctx.drawImage(fighterTex, -fw * 0.5, -fh * 0.5, fw, fh);
        } else {
          // Procedural stealth X-delta enemy interceptor jet + twin afterburners.
          const jg = ctx.createLinearGradient(-r, 0, r, 0);
          jg.addColorStop(0, '#141a1e');
          jg.addColorStop(0.5, '#46525a');
          jg.addColorStop(1, '#141a1e');
          ctx.fillStyle = jg;
          ctx.beginPath();
          ctx.moveTo(0, -r * 1.25);
          ctx.lineTo(r * 0.24, -r * 0.35);
          ctx.lineTo(r * 1.18, r * 0.32);
          ctx.lineTo(r * 0.96, r * 0.58);
          ctx.lineTo(r * 0.28, r * 0.38);
          ctx.lineTo(r * 0.36, r * 0.96);
          ctx.lineTo(0, r * 0.78);
          ctx.lineTo(-r * 0.36, r * 0.96);
          ctx.lineTo(-r * 0.28, r * 0.38);
          ctx.lineTo(-r * 0.96, r * 0.58);
          ctx.lineTo(-r * 1.18, r * 0.32);
          ctx.lineTo(-r * 0.24, -r * 0.35);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,165,92,0.55)';
          ctx.lineWidth = Math.max(0.7, r * 0.04);
          ctx.stroke();

          ctx.fillStyle = 'rgba(255,176,92,0.92)';
          ctx.beginPath();
          ctx.arc(-r * 0.18, r * 0.88, Math.max(1.4, r * 0.15), 0, TAU);
          ctx.arc(r * 0.18, r * 0.88, Math.max(1.4, r * 0.15), 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      } else if (!gpuEntities && e.type === 'cylinder') {
        const cylAngle = (e.bank || 0) * 0.35 - 0.16 + Math.sin((e.phase || 0) * 0.5) * 0.06;
        ctx.save();
        ctx.rotate(cylAngle);
        const cylTex = safeCanvas(tex, 'getCylinderCanvas');
        const cw = r * 3.5, ch = r * 1.46;

        if (cylTex) {
          ctx.drawImage(cylTex, -cw * 0.5, -ch * 0.5, cw, ch);
        } else {
          const g = ctx.createLinearGradient(0, -r, 0, r);
          g.addColorStop(0, '#e3d6be');
          g.addColorStop(0.24, '#88948c');
          g.addColorStop(0.58, '#3f4f4d');
          g.addColorStop(1, '#101c1f');
          ctx.fillStyle = g;
          roundRectPath(ctx, -r * 1.65, -r * 0.52, r * 3.3, r * 1.04, r * 0.48);
          ctx.fill();
          ctx.strokeStyle = 'rgba(224,212,182,0.62)';
          ctx.lineWidth = Math.max(0.7, r * 0.035);
          ctx.stroke();

          ctx.fillStyle = '#f2a46b';
          ctx.fillRect(-r * 0.5, -r * 0.05, r, Math.max(1.5, r * 0.09));
        }

        if (anomalyReady && r > 10) {
          ctx.save();
          roundRectPath(ctx, -r * 1.55, -r * 0.48, r * 3.1, r * 0.96, r * 0.42);
          ctx.clip();
          ctx.globalAlpha = atmFade * 0.24;
          ctx.drawImage(anomalyImg, -r * 1.6, -r * 0.8, r * 3.2, r * 1.6);
          ctx.restore();
        }
        // Dynamic sun-angle specular rim along cylindrical hull edge.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255,222,172,${0.42 * atmFade})`;
        ctx.lineWidth = Math.max(1, r * 0.065);
        ctx.beginPath();
        ctx.moveTo(-r * 1.15, -r * 0.5);
        ctx.lineTo(r * 1.15, -r * 0.5);
        ctx.stroke();
        ctx.restore();
        ctx.restore();
      } else if (!gpuEntities) {
        const crossAngle = (e.ringPhase || 0) * 0.35 + (e.bank || 0) * 0.25;
        ctx.save();
        ctx.rotate(crossAngle);
        const crossTex = safeCanvas(tex, 'getCrossCanvas');
        const cr = r * 1.48;

        if (crossTex) {
          ctx.drawImage(crossTex, -cr, -cr, cr * 2, cr * 2);
        } else {
          ctx.strokeStyle = '#334140';
          ctx.lineWidth = Math.max(1.5, r * 0.16);
          ctx.beginPath();
          ctx.moveTo(-r * 1.15, 0); ctx.lineTo(r * 1.15, 0);
          ctx.moveTo(0, -r * 1.15); ctx.lineTo(0, r * 1.15);
          ctx.stroke();
          const nodes = [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1], [0, 0]];
          for (let n = 0; n < nodes.length; n++) {
            const ox = nodes[n][0], oy = nodes[n][1];
            const subR = ox === 0 && oy === 0 ? r * 0.42 : r * 0.32;
            const sg = ctx.createRadialGradient(ox * r - subR * 0.3, oy * r - subR * 0.3, 0, ox * r, oy * r, Math.max(0.5, subR));
            sg.addColorStop(0, '#ffe8be');
            sg.addColorStop(0.35, '#9ca49a');
            sg.addColorStop(1, '#1a282b');
            ctx.fillStyle = sg;
            ctx.beginPath();
            ctx.arc(ox * r, oy * r, subR, 0, TAU);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // 4. Dynamic sun-angle rim lighting arc facing the dawn sunrise.
      if (!gpuEntities && e.type !== 'cylinder' && e.type !== 'fighter') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255,222,172,${(e.type === 'cross' ? 0.34 : 0.48) * atmFade})`;
        ctx.lineWidth = Math.max(1, r * 0.08);
        ctx.beginPath();
        const rimR = e.type === 'cross' ? r * 1.16 : r * 0.96;
        ctx.arc(0, 0, Math.max(1, rimR), sunAngle - 0.95, sunAngle + 0.95);
        ctx.stroke();
        ctx.restore();
      }

      // 5. Crackling damaged electric arcs when hull integrity < 100%.
      if (!gpuVfx && e.hp < e.maxHp && r > 6) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = Math.max(0.9, r * 0.055);
        const arcTick = Math.floor(time * 22);
        const dmgRatio = 1 - e.hp / Math.max(1, e.maxHp);
        const arcCount = dmgRatio > 0.5 ? 3 : 2;
        for (let a = 0; a < arcCount; a++) {
          const ang1 = arcTick * 2.1 + a * 2.09 + idx;
          const ang2 = ang1 + 1.45;
          drawElectricArc(
            ctx,
            Math.cos(ang1) * r * 0.75, Math.sin(ang1) * r * 0.75,
            Math.cos(ang2) * r * 0.95, Math.sin(ang2) * r * 0.95,
            arcTick + a * 17,
            a === 0 ? 'rgba(145,235,255,0.85)' : 'rgba(255,196,120,0.75)'
          );
        }
        ctx.restore();
      }

      ctx.restore();

      // 6. Tactical F-35A Helmet Target Designator Brackets & Telemetry.
      if (gameState === 'playing' && p.z < 6400) {
        const isLocked = lockedTarget === e;
        const boxS = Math.max(9, r + 5);
        if (!isLocked && !(e.charge > 0.3) && e.hp === e.maxHp) {
          // Passive contacts carry a small bearing tick. Detailed telemetry
          // belongs to the selected or active contact so hulls stay visible.
          ctx.save();
          ctx.strokeStyle = 'rgba(190,238,202,0.68)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x - 3, p.y + boxS + 3);
          ctx.lineTo(p.x, p.y + boxS);
          ctx.lineTo(p.x + 3, p.y + boxS + 3);
          ctx.stroke();
          ctx.restore();
          continue;
        }
        const color = isLocked ? 'rgba(255,198,118,0.96)' : e.charge > 0.3 ? 'rgba(255,118,86,0.86)' : 'rgba(176,242,202,0.58)';
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = isLocked ? 1.65 : 1;
        const corner = Math.max(5, boxS * 0.36);

        ctx.beginPath();
        ctx.moveTo(p.x - boxS, p.y - boxS + corner); ctx.lineTo(p.x - boxS, p.y - boxS); ctx.lineTo(p.x - boxS + corner, p.y - boxS);
        ctx.moveTo(p.x + boxS - corner, p.y - boxS); ctx.lineTo(p.x + boxS, p.y - boxS); ctx.lineTo(p.x + boxS, p.y - boxS + corner);
        ctx.moveTo(p.x + boxS, p.y + boxS - corner); ctx.lineTo(p.x + boxS, p.y + boxS); ctx.lineTo(p.x + boxS - corner, p.y + boxS);
        ctx.moveTo(p.x - boxS + corner, p.y + boxS); ctx.lineTo(p.x - boxS, p.y + boxS); ctx.lineTo(p.x - boxS, p.y + boxS - corner);
        ctx.stroke();

        if (isLocked) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - boxS - 5);
          ctx.lineTo(p.x + 5, p.y - boxS);
          ctx.lineTo(p.x, p.y - boxS + 5);
          ctx.lineTo(p.x - 5, p.y - boxS);
          ctx.closePath();
          ctx.stroke();
        }

        if (e.hp < e.maxHp) {
          const bw = boxS * 1.6;
          ctx.fillStyle = 'rgba(176,242,202,0.22)';
          ctx.fillRect(p.x - bw * 0.5, p.y + boxS + 6, bw, 1);
          ctx.fillStyle = isLocked ? '#ffbc75' : '#9eeac0';
          ctx.fillRect(p.x - bw * 0.5, p.y + boxS + 5, bw * clamp(e.hp / Math.max(1, e.maxHp), 0, 1), 2);
        }

        ctx.font = isLocked ? 'bold 10px Inter, Arial, sans-serif' : '600 10px Inter, Arial, sans-serif';
        ctx.fillStyle = isLocked ? '#ffe0ae' : '#d2eadb';
        const label = e.type === 'fighter' ? 'CAZA' : e.type === 'cylinder' ? 'NODRIZA' : e.type === 'cross' ? 'CRUZ' : 'ESFERA';
        const distText = (p.z / 1000).toFixed(1) + ' KM';
        ctx.fillText((isLocked ? '◈ FIJADO · ' : '') + label + ' ' + distText, p.x - boxS, p.y - boxS - 8);
        ctx.restore();
      }
    }
  }

  function drawWrecks(ctx, state, tex, project) {
    const { w, h, time, wrecks } = state;
    if (!wrecks || !wrecks.length) return;
    const gpuEntities = Boolean(
      state.gpuWorld && typeof window !== 'undefined' && window.World3D && window.World3D.rendersEntities
    );
    const gpuVfx = hasGpuVfx(state);

    for (let i = 0; i < wrecks.length; i++) {
      const wr = wrecks[i];
      const p = project(wr.x, wr.y, wr.z);
      if (!p || p.x < -200 || p.x > w + 200 || p.y < -200 || p.y > h + 200) continue;
      const r = clamp((wr.size || 72) * p.s * 0.9, 4, 150);

      ctx.save();
      ctx.translate(p.x, p.y);

      if (!gpuVfx) {
        // Blazing fireball sheath around the falling wreck
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const glowR = r * (1.85 + 0.25 * Math.sin(time * 24 + i));
        const fg = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, glowR);
        fg.addColorStop(0, 'rgba(255,248,210,0.92)');
        fg.addColorStop(0.38, 'rgba(255,124,38,0.68)');
        fg.addColorStop(0.75, 'rgba(210,38,12,0.28)');
        fg.addColorStop(1, 'rgba(180,20,0,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(0, 0, glowR, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      if (!gpuEntities) {
        ctx.save();
        ctx.rotate(wr.spin || 0);
        ctx.fillStyle = '#1d1918';
        ctx.strokeStyle = '#ff8533';
        ctx.lineWidth = Math.max(1, r * 0.08);
        ctx.beginPath();
        if (wr.type === 'fighter') {
          ctx.moveTo(0, -r * 1.15);
          ctx.lineTo(r * 1.05, r * 0.4);
          ctx.lineTo(-r * 1.05, r * 0.4);
          ctx.closePath();
        } else {
          ctx.arc(0, 0, r * 0.85, 0, TAU);
        }
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Tactical HMD descent indicator
      if (p.z < 5800) {
        ctx.font = '600 9px Inter, Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,168,108,0.88)';
        ctx.fillText('▼ NAVE CAYENDO · ' + Math.max(0, Math.round(wr.y)) + ' M', r + 8, 4);
      }
      ctx.restore();
    }
  }

  function drawExplosions(ctx, state, tex, project) {
    const { w, h, explosions } = state;
    if (!explosions.length) return;
    const gpuVfx = hasGpuVfx(state);

    for (let idx = 0; idx < explosions.length; idx++) {
      const ex = explosions[idx];
      const p = project(ex.x, ex.y, ex.z);
      if (!p || p.x < -420 || p.x > w + 420 || p.y < -420 || p.y > h + 420) continue;

      const t = clamp(ex.age / Math.max(0.01, ex.maxAge), 0, 1);
      const scale = clamp(ex.radius * p.s, 18, 310);

      ctx.save();
      ctx.translate(p.x, p.y);

      if (gpuVfx) {
        // 3D volumetric fireball, smoke and shockwaves render with depth occlusion in VFX3D;
        // retain only a subtle camera-plane anamorphic optical streak on close detonations.
        if (t < 0.35 && scale > 36) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const flareAlpha = (1 - t / 0.35) * 0.42;
          const flareW = clamp(scale * 4.4, 80, w * 0.62);
          const flareH = Math.max(3, scale * 0.14);
          ctx.rotate((ex.flareTilt || 0) * 0.35);
          const fg = ctx.createLinearGradient(-flareW, 0, flareW, 0);
          fg.addColorStop(0, 'rgba(110,205,255,0)');
          fg.addColorStop(0.32, `rgba(160,224,255,${flareAlpha * 0.32})`);
          fg.addColorStop(0.5, `rgba(255,250,230,${flareAlpha})`);
          fg.addColorStop(0.68, `rgba(255,195,120,${flareAlpha * 0.36})`);
          fg.addColorStop(1, 'rgba(255,195,120,0)');
          ctx.fillStyle = fg;
          ctx.fillRect(-flareW, -flareH * 0.5, flareW * 2, flareH);
          ctx.restore();
        }
        ctx.restore();
        continue;
      }

      // 1. Dark billowing smoke lobes (with internal fireball underglow early on).
      const lobes = ex.lobes || [];
      for (let i = 0; i < lobes.length; i++) {
        const lobe = lobes[i];
        const lt = clamp((t - lobe.delay) / Math.max(0.05, 1 - lobe.delay), 0, 1);
        if (lt <= 0.04) continue;
        const spread = scale * (0.28 + lt * lobe.dist);
        const lx = Math.cos(lobe.ang) * spread;
        const ly = Math.sin(lobe.ang) * spread - lt * scale * 0.36;
        const lr = Math.max(2, scale * lobe.size * (0.36 + lt * 0.96));

        const smokeTex = safeCanvas(tex, 'getSmokeCanvas', i % 3);
        const fireTex = safeCanvas(tex, 'getFireballCanvas', i % 3);

        if (lt < 0.52) {
          const heat = 1 - lt / 0.52;
          if (smokeTex) {
            ctx.save();
            ctx.globalAlpha = clamp((1 - lt * 0.5) * 0.72, 0, 0.72);
            ctx.translate(lx, ly);
            ctx.rotate(lobe.ang + lt * 0.8);
            ctx.drawImage(smokeTex, -lr, -lr, lr * 2, lr * 2);
            ctx.restore();
          }
          if (fireTex) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = heat * 0.62;
            ctx.translate(lx, ly);
            ctx.rotate(-lobe.ang);
            ctx.drawImage(fireTex, -lr * 0.88, -lr * 0.88, lr * 1.76, lr * 1.76);
            ctx.restore();
          } else if (!smokeTex) {
            const sg = ctx.createRadialGradient(lx, ly + lr * 0.2, lr * 0.05, lx, ly, lr);
            sg.addColorStop(0, `rgba(255,${Math.round(160 * heat + 55)},40,${0.72 * (1 - lt * 0.6)})`);
            sg.addColorStop(0.55, `rgba(95,38,24,${0.62 * (1 - lt * 0.4)})`);
            sg.addColorStop(1, 'rgba(20,18,18,0)');
            ctx.fillStyle = sg;
            ctx.beginPath();
            ctx.arc(lx, ly, lr, 0, TAU);
            ctx.fill();
          }
        } else {
          const smokeAlpha = clamp((1 - lt) * 1.45, 0, 0.72);
          if (smokeTex) {
            ctx.save();
            ctx.globalAlpha = smokeAlpha;
            ctx.translate(lx, ly);
            ctx.rotate(lobe.ang + lt * 1.1);
            ctx.drawImage(smokeTex, -lr, -lr, lr * 2, lr * 2);
            ctx.restore();
          } else {
            const sg = ctx.createRadialGradient(lx, ly + lr * 0.2, lr * 0.05, lx, ly, lr);
            sg.addColorStop(0, `rgba(26,25,26,${smokeAlpha})`);
            sg.addColorStop(0.65, `rgba(48,44,42,${smokeAlpha * 0.65})`);
            sg.addColorStop(1, 'rgba(35,34,34,0)');
            ctx.fillStyle = sg;
            ctx.beginPath();
            ctx.arc(lx, ly, lr, 0, TAU);
            ctx.fill();
          }
        }
      }

      // 2. Additive Hollywood Fireball, Refractive Shockwaves & Anamorphic Streaks.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // Refractive dual sonic shockwave rings.
      if (t < 0.86) {
        const waveT = t / 0.86;
        const waveR = Math.max(4, scale * (0.55 + Math.pow(waveT, 0.7) * 4.1));
        const innerWaveR = Math.max(3, scale * (0.35 + Math.pow(waveT, 0.85) * 2.65));

        const shockGrad = ctx.createRadialGradient(0, 0, waveR * 0.76, 0, 0, waveR * 1.06);
        shockGrad.addColorStop(0, 'rgba(145,215,255,0)');
        shockGrad.addColorStop(0.7, `rgba(180,228,255,${(1 - waveT) * 0.16})`);
        shockGrad.addColorStop(0.9, `rgba(255,244,218,${(1 - waveT) * 0.42})`);
        shockGrad.addColorStop(1, 'rgba(255,220,170,0)');
        ctx.fillStyle = shockGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, waveR * 1.06, Math.max(2, waveR * 0.78), ex.flareTilt || 0, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = `rgba(255,236,205,${(1 - waveT) * 0.68})`;
        ctx.lineWidth = Math.max(1.2, (1 - waveT) * 5.8);
        ctx.beginPath();
        ctx.ellipse(0, 0, waveR, Math.max(2, waveR * 0.74), ex.flareTilt || 0, 0, TAU);
        ctx.stroke();

        ctx.strokeStyle = `rgba(255,138,58,${(1 - waveT) * 0.56})`;
        ctx.lineWidth = Math.max(1, (1 - waveT) * 3.8);
        ctx.beginPath();
        ctx.ellipse(0, 0, innerWaveR, Math.max(2, innerWaveR * 0.82), -(ex.flareTilt || 0), 0, TAU);
        ctx.stroke();
      }

      // Main volumetric fireball core.
      const coreAlpha = clamp(1 - t * 1.5, 0, 1);
      if (coreAlpha > 0) {
        const coreR = Math.max(3, scale * (0.72 + t * 1.4));
        const mainFire = safeCanvas(tex, 'getFireballCanvas', idx % 3);
        if (mainFire) {
          ctx.save();
          ctx.globalAlpha = coreAlpha;
          ctx.rotate((ex.flareTilt || 0) + t * 0.5);
          ctx.drawImage(mainFire, -coreR, -coreR, coreR * 2, coreR * 2);
          ctx.restore();
        }
        const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
        core.addColorStop(0, `rgba(255,255,246,${coreAlpha})`);
        core.addColorStop(0.2, `rgba(255,222,138,${coreAlpha * 0.88})`);
        core.addColorStop(0.5, `rgba(255,118,32,${coreAlpha * 0.52})`);
        core.addColorStop(1, 'rgba(185,38,14,0)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(0, 0, coreR, 0, TAU);
        ctx.fill();

        // Horizontal anamorphic lens flare streak across detonation.
        if (t < 0.4) {
          const flareAlpha = (1 - t / 0.4) * 0.9;
          const flareW = clamp(scale * 5.6, 100, w * 0.78);
          const flareH = Math.max(4, scale * 0.24);
          ctx.save();
          ctx.rotate((ex.flareTilt || 0) * 0.35);
          const fg = ctx.createLinearGradient(-flareW, 0, flareW, 0);
          fg.addColorStop(0, 'rgba(110,205,255,0)');
          fg.addColorStop(0.28, `rgba(160,224,255,${flareAlpha * 0.38})`);
          fg.addColorStop(0.5, `rgba(255,250,230,${flareAlpha})`);
          fg.addColorStop(0.72, `rgba(255,195,120,${flareAlpha * 0.44})`);
          fg.addColorStop(1, 'rgba(255,195,120,0)');
          ctx.fillStyle = fg;
          ctx.fillRect(-flareW, -flareH * 0.5, flareW * 2, flareH);
          ctx.restore();
        }
      }

      // Secondary chain-reaction detonations.
      const secondaries = ex.secondaries || [];
      for (let i = 0; i < secondaries.length; i++) {
        const sec = secondaries[i];
        const st = (ex.age - sec.delay) / 0.75;
        if (st > 0 && st < 1) {
          const sa = Math.sin(st * Math.PI);
          const sr = Math.max(2, scale * sec.size * (0.42 + st * 1.12));
          const sx = sec.ox * scale, sy = sec.oy * scale;
          const secFire = safeCanvas(tex, 'getFireballCanvas', (idx + i + 1) % 3);
          if (secFire) {
            ctx.save();
            ctx.globalAlpha = sa * 0.85;
            ctx.drawImage(secFire, sx - sr, sy - sr, sr * 2, sr * 2);
            ctx.restore();
          } else {
            const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
            sg.addColorStop(0, `rgba(255,250,220,${sa})`);
            sg.addColorStop(0.35, `rgba(255,148,52,${sa * 0.78})`);
            sg.addColorStop(1, 'rgba(255,90,20,0)');
            ctx.fillStyle = sg;
            ctx.beginPath();
            ctx.arc(sx, sy, sr, 0, TAU);
            ctx.fill();
          }
        }
      }

      ctx.restore();
      ctx.restore();
    }
  }

  function drawParticles(ctx, state, tex, project) {
    const { time, particles } = state;
    if (!particles.length || hasGpuVfx(state)) return;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const v = project(p.x, p.y, p.z);
      if (!v) continue;
      const lifeRatio = clamp(p.life / Math.max(0.01, p.max || 1), 0, 1);

      if (p.kind === 'spark') {
        const prev = project(p.px !== undefined ? p.px : p.x, p.py !== undefined ? p.py : p.y, p.pz !== undefined ? p.pz : p.z);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = lifeRatio;
        ctx.lineCap = 'round';
        ctx.strokeStyle = p.color || '#ffe4a6';
        ctx.lineWidth = clamp(p.size * v.s * 0.48, 1.2, 4.4);
        ctx.beginPath();
        if (prev) {
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(v.x, v.y);
        } else {
          ctx.moveTo(v.x, v.y);
          ctx.lineTo(v.x + 2, v.y + 2);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,255,244,0.85)';
        ctx.lineWidth = clamp(p.size * v.s * 0.2, 0.7, 2);
        ctx.stroke();
        ctx.restore();
      } else if (p.kind === 'debris') {
        ctx.save();
        ctx.translate(v.x, v.y);
        ctx.rotate((p.spin || 0) + time * (p.spinSpeed || 0));
        ctx.globalAlpha = clamp(lifeRatio * 1.3, 0, 1);
        const ds = clamp((p.size || 8) * v.s, 2, 12);
        ctx.fillStyle = '#282726';
        ctx.fillRect(-ds, -ds * 0.45, ds * 2, ds * 0.9);
        ctx.fillStyle = `rgba(255,148,58,${lifeRatio})`;
        ctx.fillRect(-ds * 0.5, -ds * 0.2, ds, ds * 0.4);
        ctx.restore();
      } else {
        const r = Math.max(1.5, clamp((p.size || 24) * v.s * (p.grow ? (1.8 - lifeRatio * 0.9) : 1), 1.5, 68));
        ctx.save();
        if (p.additive) ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = lifeRatio * (p.alpha || 0.82);
        const sprite = p.kind === 'fire'
          ? safeCanvas(tex, 'getFireballCanvas', i % 3)
          : safeCanvas(tex, 'getSmokeCanvas', i % 3);
        if (sprite) {
          ctx.drawImage(sprite, v.x - r, v.y - r, r * 2, r * 2);
        } else {
          const pg = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, r);
          pg.addColorStop(0, p.color || '#333333');
          pg.addColorStop(1, 'rgba(20,20,20,0)');
          ctx.fillStyle = pg;
          ctx.beginPath();
          ctx.arc(v.x, v.y, r, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  function drawShots(ctx, state, project) {
    const { shots, playerShots } = state;
    if ((!shots.length && !playerShots.length) || hasGpuVfx(state)) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < playerShots.length; i++) {
      const s = playerShots[i];
      const head = project(s.x, s.y, s.z);
      const tail = project(s.x - s.vx * 0.009, s.y - s.vy * 0.009, s.z - s.vz * 0.009);
      if (!head || !tail) continue;
      ctx.strokeStyle = 'rgba(255,218,132,0.92)';
      ctx.lineWidth = clamp(1.8 * head.s, 0.45, 1.5);
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(head.x, head.y, clamp(1.2 * head.s, 0.35, 1.1), 0, TAU);
      ctx.fill();
    }

    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const p = project(s.x, s.y, s.z);
      const tail = project(s.x - s.vx * 0.07, s.y - s.vy * 0.07, s.z - s.vz * 0.07);
      if (!p) continue;
      const r = Math.max(1.5, clamp(12 * p.s, 2.5, 16));
      if (tail) {
        ctx.strokeStyle = 'rgba(255,140,70,0.72)';
        ctx.lineWidth = Math.max(1.5, r * 0.55);
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      const sg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.1);
      sg.addColorStop(0, '#ffffff');
      sg.addColorStop(0.28, '#ffcf86');
      sg.addColorStop(0.65, 'rgba(255,95,40,0.45)');
      sg.addColorStop(1, 'rgba(255,95,40,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.1, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCockpitAndHUD(ctx, state, tex, cloudMist, shakeX, shakeY, project) {
    const {
      w, h, focal, time, state: gameState, player, enemies,
      playerShots, lockedTarget, boost, muzzleFlash, screenFlash
    } = state;

    const aoa = Number(player.aoa) || 0;
    const gForce = player.gForce !== undefined ? Number(player.gForce) : 1;
    const slip = Number(player.slip) || 0;
    const recoil = Number(player.recoil) || 0;
    const roll = Number(player.roll) || 0;
    const gpuCockpit = hasGpuCockpit(state);

    // 1. Canopy cloud condensation mist when flying through clouds.
    if (cloudMist > 0.02) {
      ctx.save();
      const mistAlpha = clamp(cloudMist * 0.28, 0, 0.34);
      ctx.fillStyle = `rgba(222,226,228,${mistAlpha})`;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = `rgba(240,245,248,${cloudMist * 0.24})`;
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * TAU + 0.2;
        const r1 = Math.min(w, h) * (0.24 + ((time * 3.1 + i * 0.29) % 1) * 0.32);
        const r2 = r1 + 65 + cloudMist * 90;
        ctx.beginPath();
        ctx.moveTo(w * 0.5 + Math.cos(ang) * r1, h * 0.5 + Math.sin(ang) * r1);
        ctx.lineTo(w * 0.5 + Math.cos(ang) * r2, h * 0.5 + Math.sin(ang) * r2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2. High-speed afterburner peripheral air-rush streaks.
    if (boost > 0.95) {
      ctx.save();
      ctx.strokeStyle = `rgba(220,244,238,${boost * 0.035})`;
      ctx.lineWidth = 1.25;
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * TAU + Math.sin(time * 3 + i) * 0.08;
        const r1 = Math.min(w, h) * (0.35 + ((time * 2.5 + i * 0.37) % 1) * 0.26);
        const r2 = r1 + 48 + boost * 64;
        ctx.beginPath();
        ctx.moveTo(w * 0.5 + Math.cos(ang) * r1, h * 0.5 + Math.sin(ang) * r1);
        ctx.lineTo(w * 0.5 + Math.cos(ang) * r2, h * 0.5 + Math.sin(ang) * r2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. GAU-22/A cannon muzzle flashes & twin tracer origin streaks.
    if (muzzleFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(muzzleFlash, 0, 1);
      const flash = ctx.createRadialGradient(w * 0.5, h * 0.89, 0, w * 0.5, h * 0.89, Math.max(10, h * 0.13));
      flash.addColorStop(0, 'rgba(255,246,210,0.24)');
      flash.addColorStop(0.25, 'rgba(255,178,94,0.3)');
      flash.addColorStop(1, 'rgba(255,150,70,0)');
      ctx.fillStyle = flash;
      ctx.fillRect(0, h * 0.4, w, h * 0.6);

      ctx.restore();
    }

    // 4. F-35A Helmet-Mounted Display (HMD) Symbology while playing.
    if (gameState === 'playing') {
      // 4a. Stabilized artificial horizon & pitch ladder.
      ctx.save();
      ctx.translate(w * 0.5 + shakeX, h * 0.5 + shakeY);
      ctx.rotate(-roll);

      ctx.strokeStyle = 'rgba(176,242,202,0.34)';
      ctx.fillStyle = 'rgba(176,242,202,0.52)';
      ctx.font = '600 9px Inter, Arial, sans-serif';
      ctx.lineWidth = 1.1;

      const pitchRad = Number(player.pitch) || 0;
      for (let deg = -30; deg <= 30; deg += 10) {
        const diff = pitchRad - deg * (Math.PI / 180);
        if (Math.abs(diff) > 0.65) continue;
        const py = Math.tan(diff) * focal;
        if (Math.abs(py) > h * 0.36) continue;
        const innerGap = deg === 0 ? 52 : 34;
        const outerSpan = deg === 0 ? 128 : 74;
        const tickDir = deg >= 0 ? 7 : -7;

        ctx.save();
        if (deg < 0) ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(-outerSpan, py);
        ctx.lineTo(-innerGap, py);
        if (deg !== 0) {
          ctx.moveTo(-outerSpan, py);
          ctx.lineTo(-outerSpan, py + tickDir);
        }
        ctx.moveTo(innerGap, py);
        ctx.lineTo(outerSpan, py);
        if (deg !== 0) {
          ctx.moveTo(outerSpan, py);
          ctx.lineTo(outerSpan, py + tickDir);
        }
        ctx.stroke();
        ctx.restore();

        if (deg !== 0) {
          ctx.textAlign = 'right';
          ctx.fillText(String(deg), -outerSpan - 5, py + 3);
          ctx.textAlign = 'left';
          ctx.fillText(String(deg), outerSpan + 5, py + 3);
        }
      }
      ctx.restore();

      // 4b. Flight Path Marker (velocity vector) projected into cockpit screen space.
      const spd = Math.max(60, Number(player.speed) || 195);
      const vx = player.vx !== undefined ? player.vx : Math.sin(player.yaw) * Math.cos(player.pitch) * spd;
      const vy = player.vy !== undefined ? player.vy : Math.sin(player.pitch) * spd;
      const vz = player.vz !== undefined ? player.vz : Math.cos(player.yaw) * Math.cos(player.pitch) * spd;
      const fpmRaw = project(player.x + vx * 8, player.y + vy * 8, player.z + vz * 8);
      const fpm = toRolledScreen(fpmRaw, w, h, roll, shakeX, shakeY);
      if (fpm) {
        const fx = clamp(fpm.x, w * 0.15, w * 0.85);
        const fy = clamp(fpm.y, h * 0.16, h * 0.84);
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(-roll);
        ctx.strokeStyle = 'rgba(182,248,208,0.82)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, TAU);
        ctx.moveTo(-16, 0); ctx.lineTo(-7, 0);
        ctx.moveTo(7, 0); ctx.lineTo(16, 0);
        ctx.moveTo(0, -13); ctx.lineTo(0, -7);
        ctx.stroke();
        ctx.restore();
      }

      // 4c. Lead-Computing Optical Sight (LCOS pipper) & AIM-9X IR seeker diamond on lockedTarget.
      if (lockedTarget) {
        const tRaw = project(lockedTarget.x, lockedTarget.y, lockedTarget.z);
        const tScr = toRolledScreen(tRaw, w, h, roll, shakeX, shakeY);
        const rvx = (Number(lockedTarget.vx) || 0) - (Number(player.vx) || 0);
        const rvy = (Number(lockedTarget.vy) || 0) - (Number(player.vy) || 0);
        const rvz = (Number(lockedTarget.vz) || 0) - (Number(player.vz) || 0);
        const muzzleSpeed = 1050;

        const dist = Math.hypot(lockedTarget.x - player.x, lockedTarget.y - player.y, lockedTarget.z - player.z);
        let tof = dist / muzzleSpeed;
        for (let it = 0; it < 3; it++) {
          const lx = lockedTarget.x + rvx * tof - player.x;
          const ly = lockedTarget.y + rvy * tof + 0.5 * 9.81 * tof * tof - player.y;
          const lz = lockedTarget.z + rvz * tof - player.z;
          tof = Math.hypot(lx, ly, lz) / muzzleSpeed;
        }
        const leadX = lockedTarget.x + rvx * tof;
        const leadY = lockedTarget.y + rvy * tof + 0.5 * 9.81 * tof * tof;
        const leadZ = lockedTarget.z + rvz * tof;
        const lRaw = project(leadX, leadY, leadZ);
        const lScr = toRolledScreen(lRaw, w, h, roll, shakeX, shakeY);

        // AIM-9X progressive IR seeker lock diamond on target.
        const lockP = clamp(Number(state.lockProgress) || 0, 0, 1);
        const lockReady = Boolean(state.lockReady);
        if (tScr && lockP > 0.04) {
          ctx.save();
          ctx.translate(tScr.x, tScr.y);
          const dia = lerp(42, 20, lockP);
          ctx.rotate(lockReady ? 0 : (1 - lockP) * 1.4);
          ctx.strokeStyle = lockReady ? 'rgba(255,176,78,0.98)' : 'rgba(182,245,204,0.82)';
          ctx.lineWidth = lockReady ? 1.8 : 1.25;
          ctx.beginPath();
          ctx.moveTo(0, -dia);
          ctx.lineTo(dia, 0);
          ctx.lineTo(0, dia);
          ctx.lineTo(-dia, 0);
          ctx.closePath();
          ctx.stroke();
          if (lockReady) {
            const inner = 13 + Math.sin(time * 22) * 1.5;
            ctx.beginPath();
            ctx.moveTo(0, -inner);
            ctx.lineTo(inner, 0);
            ctx.lineTo(0, inner);
            ctx.lineTo(-inner, 0);
            ctx.closePath();
            ctx.stroke();
          }
          ctx.rotate(lockReady ? 0 : -(1 - lockP) * 1.4);
          ctx.font = '700 9.5px Inter, Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = lockReady ? '#ffd182' : '#b2f0ca';
          ctx.fillText(lockReady ? 'AIM-9X LOCK · SHOOT' : 'IR SEEK ' + Math.round(lockP * 100) + '%', 0, -dia - 7);
          ctx.restore();
        }

        if (lScr) {
          ctx.save();
          if (tScr) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(255,212,138,0.45)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(tScr.x, tScr.y);
            ctx.lineTo(lScr.x, lScr.y);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          const onBoresight = Math.hypot(lScr.x - w * 0.5, lScr.y - h * 0.5) < 28;
          ctx.strokeStyle = onBoresight ? 'rgba(255,232,148,0.98)' : 'rgba(178,248,208,0.9)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(lScr.x, lScr.y, 13, 0, TAU);
          ctx.stroke();

          // Range closure arc around LCOS pipper.
          const rngFrac = clamp(1 - dist / 6000, 0.15, 1);
          ctx.strokeStyle = 'rgba(255,196,112,0.95)';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(lScr.x, lScr.y, 17, -Math.PI * 0.5, -Math.PI * 0.5 + rngFrac * TAU);
          ctx.stroke();

          ctx.fillStyle = '#fff3cf';
          ctx.beginPath();
          ctx.arc(lScr.x, lScr.y, 2.2, 0, TAU);
          ctx.fill();

          ctx.font = '600 9px Inter, Arial, sans-serif';
          ctx.fillStyle = '#ffe0a8';
          ctx.fillText('LCOS ' + tof.toFixed(2) + 'S', lScr.x + 19, lScr.y + 3);
          ctx.restore();
        }
      }

      // 4d. Compass heading tape & AoA / G-Load tactical readouts.
      const deg = (((player.yaw * 180 / Math.PI) % 360) + 360) % 360;
      ctx.save();
      ctx.fillStyle = 'rgba(182,245,204,0.82)';
      ctx.strokeStyle = 'rgba(182,245,204,0.48)';
      ctx.font = '600 10px Inter, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('HDG ' + String(Math.round(deg)).padStart(3, '0') + '°', w * 0.5, h * 0.13);
      ctx.beginPath();
      ctx.moveTo(w * 0.5 - 84, h * 0.145);
      ctx.lineTo(w * 0.5 + 84, h * 0.145);
      ctx.moveTo(w * 0.5, h * 0.145);
      ctx.lineTo(w * 0.5, h * 0.153);
      const startDeg = Math.floor((deg - 30) / 10) * 10;
      for (let d = startDeg; d <= deg + 30; d += 10) {
        const tx = w * 0.5 + (d - deg) * 2.5;
        if (tx >= w * 0.5 - 82 && tx <= w * 0.5 + 82) {
          ctx.moveTo(tx, h * 0.141);
          ctx.lineTo(tx, h * 0.145);
        }
      }
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(176,240,202,0.72)';
      ctx.fillText('G ' + gForce.toFixed(1) + '  ·  α ' + (aoa * 57.3).toFixed(1) + '°', w * 0.5 - 126, h * 0.62);
      if (boost > 0.25) {
        ctx.fillStyle = 'rgba(145,220,255,0.88)';
        ctx.fillText('POSTCOMB', w * 0.5 - 126, h * 0.642);
      }
      ctx.restore();

      // 4e. Off-screen threat chevrons around central radar ring.
      const ringR = Math.min(w, h) * 0.34;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        const dx = e.x - player.x, dy = e.y - player.y, dz = e.z - player.z;
        const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
        const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
        const px = dx * cy - dz * sy;
        const forward = dx * sy + dz * cy;
        const py = dy * cp - forward * sp;
        const depth = forward * cp + dy * sp;
        const angScreen = Math.atan2(-py, px) - roll;
        const onScreen = depth > 20 && Math.abs(px * focal / depth) < w * 0.44 && Math.abs(py * focal / depth) < h * 0.42;
        if (!onScreen) {
          const ix = w * 0.5 + Math.cos(angScreen) * ringR;
          const iy = h * 0.5 + Math.sin(angScreen) * ringR;
          ctx.save();
          ctx.translate(ix, iy);
          ctx.rotate(angScreen);
          ctx.fillStyle = (e.charge || 0) > 0.35 ? 'rgba(255,108,76,0.92)'
            : lockedTarget === e ? 'rgba(255,216,128,0.9)'
            : 'rgba(242,182,118,0.78)';
          ctx.beginPath();
          ctx.moveTo(10, 0);
          ctx.lineTo(-4, -5.5);
          ctx.lineTo(-2, 0);
          ctx.lineTo(-4, 5.5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // 5. Cockpit Canopy Glass (GameTextures.getCanopyGlassCanvas) & G-Force/AoA inertia sway.
    const gExcess = clamp(gForce - 1, -2, 6);
    const buffet = (boost > 0.3 || Math.abs(gExcess) > 1.8)
      ? Math.sin(time * 47) * (boost * 0.85 + Math.abs(gExcess) * 0.4)
      : 0;
    const swayX = -roll * 20 - slip * 26 + buffet * 0.6;
    const swayY = recoil * 7 + Math.abs(roll) * 6 + gExcess * 3.6 + aoa * 16 + buffet;

    ctx.save();
    ctx.translate(swayX, swayY);

    if (!gpuCockpit) {
      const canopyGlass = safeCanvas(tex, 'getCanopyGlassCanvas');
      if (canopyGlass) {
        ctx.save();
        ctx.globalAlpha = 0.28 + cloudMist * 0.22;
        ctx.drawImage(canopyGlass, -30, -30, w + 60, h + 60);
        ctx.restore();
      } else {
        const glass = ctx.createLinearGradient(0, 0, w, h);
        glass.addColorStop(0, 'rgba(202,234,228,0.09)');
        glass.addColorStop(0.28, 'rgba(180,215,210,0)');
        glass.addColorStop(0.72, 'rgba(180,215,210,0)');
        glass.addColorStop(1, 'rgba(218,236,216,0.06)');
        ctx.fillStyle = glass;
        ctx.fillRect(-30, -30, w + 60, h + 60);
      }

      // F-35A instrument coaming & matte carbon-composite glare shield (CPU fallback).
      ctx.fillStyle = '#111b1a';
      ctx.beginPath();
      ctx.moveTo(-40, h * 0.91);
      ctx.lineTo(w * 0.19, h * 0.875);
      ctx.lineTo(w * 0.3, h * 0.91);
      ctx.lineTo(w * 0.38, h * 0.945);
      ctx.lineTo(w * 0.62, h * 0.945);
      ctx.lineTo(w * 0.7, h * 0.91);
      ctx.lineTo(w * 0.81, h * 0.875);
      ctx.lineTo(w + 40, h * 0.91);
      ctx.lineTo(w + 40, h + 40);
      ctx.lineTo(-40, h + 40);
      ctx.closePath();
      ctx.fill();

      const panel = ctx.createLinearGradient(0, h * 0.9, 0, h);
      panel.addColorStop(0, '#323f3a');
      panel.addColorStop(0.12, '#172523');
      panel.addColorStop(1, '#081011');
      ctx.fillStyle = panel;
      ctx.beginPath();
      ctx.moveTo(-40, h * 0.93);
      ctx.lineTo(w * 0.2, h * 0.9);
      ctx.lineTo(w * 0.31, h * 0.94);
      ctx.lineTo(w * 0.69, h * 0.94);
      ctx.lineTo(w * 0.8, h * 0.9);
      ctx.lineTo(w + 40, h * 0.93);
      ctx.lineTo(w + 40, h + 40);
      ctx.lineTo(-40, h + 40);
      ctx.closePath();
      ctx.fill();

      // Brushed metallic glare-shield bevel catching sunrise light.
      ctx.strokeStyle = '#657a6b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-40, h * 0.91);
      ctx.lineTo(w * 0.19, h * 0.875);
      ctx.lineTo(w * 0.3, h * 0.91);
      ctx.lineTo(w * 0.38, h * 0.945);
      ctx.lineTo(w * 0.62, h * 0.945);
      ctx.lineTo(w * 0.7, h * 0.91);
      ctx.lineTo(w * 0.81, h * 0.875);
      ctx.lineTo(w + 40, h * 0.91);
      ctx.stroke();

      // Canopy side struts.
      poly(ctx, [{ x: -30, y: -30 }, { x: w * 0.02, y: -30 }, { x: w * 0.082, y: h * 0.88 }, { x: -30, y: h * 0.91 }], 'rgba(11,20,22,0.78)');
      poly(ctx, [{ x: w + 30, y: -30 }, { x: w * 0.98, y: -30 }, { x: w * 0.918, y: h * 0.88 }, { x: w + 30, y: h * 0.91 }], 'rgba(11,20,22,0.78)');
      ctx.strokeStyle = 'rgba(176,228,196,0.22)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.53, Math.max(10, Math.min(w, h) * 0.36), 3.5, 5.92);
      ctx.stroke();

      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 3 === 0 ? '#79a88b'
          : i === 7 && player.health < 40 ? '#e06b50'
          : i === 1 && boost > 0.35 ? '#80d4ff'
          : '#425e4e';
        ctx.fillRect(w * (0.08 + i * 0.018), h * 0.957, Math.max(2, w * 0.0045), 2.5);
        ctx.fillRect(w * (0.79 + i * 0.018), h * 0.957, Math.max(2, w * 0.0045), 2.5);
      }
    }
    ctx.restore();

    if (!gpuCockpit) {
      ctx.save();
      const panelY=h*.835,panelH=h*.145;
      const metal=ctx.createLinearGradient(0,panelY,0,h);metal.addColorStop(0,'#303637');metal.addColorStop(.12,'#0b1012');metal.addColorStop(1,'#171c1e');
      poly(ctx,[{x:w*.19,y:h},{x:w*.26,y:panelY},{x:w*.74,y:panelY},{x:w*.81,y:h}],metal,'#535a59',2);
      ctx.fillStyle='#030a0c';ctx.fillRect(w*.29,panelY+12,w*.42,panelH*.73);
      ctx.strokeStyle='#53756e';ctx.lineWidth=1;ctx.strokeRect(w*.29,panelY+12,w*.42,panelH*.73);
      ctx.font=Math.max(9,w*.006)+'px monospace';ctx.fillStyle='#93bdb0';
      ctx.fillText('FLIGHT    NAV    ENG    FUEL',w*.305,panelY+27);
      ctx.fillText('ALT '+Math.round(player.y)+' M',w*.31,panelY+49);
      ctx.fillText('SPD '+Math.round(player.speed*1.944)+' KT',w*.31,panelY+66);
      ctx.fillText('F-35A  /  SYS NORMAL',w*.52,panelY+49);
      for(let k=0;k<5;k++){ctx.fillStyle='#28483f';ctx.fillRect(w*(.52+k*.033),panelY+61,w*.022,5);}
      ctx.strokeStyle='#697273';ctx.lineWidth=3;
      for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(w*.5+side*w*.49,h);ctx.bezierCurveTo(w*.5+side*w*.45,h*.75,w*.5+side*w*.48,h*.3,w*.5+side*w*.47,0);ctx.stroke();}
      ctx.restore();
    }

    // 6. Explosion screen flash wash.
    if (screenFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,215,155,${clamp(screenFlash * 0.38, 0, 0.45)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  function render(ctx, rawState) {
    if (!ctx || !rawState || !rawState.player) return;

    const tex = getTextures();
    const w = Math.max(1, Number(rawState.w) || 1280);
    const h = Math.max(1, Number(rawState.h) || 720);
    const focal = Number(rawState.focal) || Math.min(w, h) * 0.86;
    const time = Number(rawState.time) || 0;
    const player = rawState.player;

    const state = {
      w,
      h,
      dpr: Number(rawState.dpr) || 1,
      focal,
      time,
      state: rawState.state || 'intro',
      player,
      enemies: Array.isArray(rawState.enemies) ? rawState.enemies : [],
      buildings: Array.isArray(rawState.buildings) ? rawState.buildings : [],
      clouds: Array.isArray(rawState.clouds) ? rawState.clouds : [],
      explosions: Array.isArray(rawState.explosions) ? rawState.explosions : [],
      particles: Array.isArray(rawState.particles) ? rawState.particles : [],
      shots: Array.isArray(rawState.shots) ? rawState.shots : [],
      playerShots: Array.isArray(rawState.playerShots) ? rawState.playerShots : [],
      missiles: Array.isArray(rawState.missiles) ? rawState.missiles : [],
      flares: Array.isArray(rawState.flares) ? rawState.flares : [],
      wrecks: Array.isArray(rawState.wrecks) ? rawState.wrecks : [],
      wingman: rawState.wingman || null,
      wingmanTrail: Array.isArray(rawState.wingmanTrail) ? rawState.wingmanTrail : [],
      lockedTarget: rawState.lockedTarget || null,
      lockProgress: Number(rawState.lockProgress) || 0,
      lockReady: Boolean(rawState.lockReady),
      boost: Number(rawState.boost) || 0,
      muzzleFlash: Number(rawState.muzzleFlash) || 0,
      hitFlash: Number(rawState.hitFlash) || 0,
      damageFlash: Number(rawState.damageFlash) || 0,
      screenFlash: Number(rawState.screenFlash) || 0,
      shake: Number(rawState.shake) || 0
    };

    const project = typeof rawState.project === 'function'
      ? rawState.project
      : (x, y, z) => fallbackProject(x, y, z, player, w, h, focal);

    const pitch = clamp(Number(player.pitch) || 0, -0.82, 0.88);
    const horizon = clamp(h * 0.5 + Math.tan(pitch) * focal, -h * 0.2, h * 1.2);
    const sx = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 18 : 0;
    const sy = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 14 : 0;
    const roll = Number(player.roll) || 0;

    const gpuWorld = Boolean(typeof window !== 'undefined' && window.World3D && window.World3D.render(state));
    state.gpuWorld = gpuWorld;
    if (gpuWorld) ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w * 0.5 + sx, h * 0.5 + sy);
    ctx.rotate(-roll);
    ctx.translate(-w * 0.5, -h * 0.5);

    const sunPos = gpuWorld ? null : drawSkyAndTerrain(ctx, state, tex, horizon, project);
    if (!gpuWorld) drawCityscape(ctx, state, tex, project);
    const cloudMist = gpuWorld
      ? (typeof window !== 'undefined' && window.World3D && typeof window.World3D.getCloudMist === 'function'
        ? Number(window.World3D.getCloudMist(state)) || 0
        : 0)
      : drawClouds(ctx, state, tex, sunPos, project).cloudMist;
    drawWingman(ctx, state, project);
    drawEnemies(ctx, state, tex, sunPos, project);
    drawWrecks(ctx, state, tex, project);
    drawExplosions(ctx, state, tex, project);
    drawParticles(ctx, state, tex, project);
    drawShots(ctx, state, project);

    ctx.restore();

    drawCockpitAndHUD(ctx, state, tex, cloudMist, sx, sy, project);
  }

  const api = { render };
  if (typeof window !== 'undefined') window.GameRenderer = api;
  if (typeof globalThis !== 'undefined') globalThis.GameRenderer = api;
})();
