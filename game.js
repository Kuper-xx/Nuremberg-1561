(() => {
  'use strict';
  const canvas = document.querySelector('#view');
  const ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  const ui = {
    intro: $('intro'), hud: $('hud'), end: $('end'),
    health: $('health'), healthbar: $('healthbar'),
    ammo: $('ammo'), ammobar: $('ammobar'),
    kills: $('kills'), speed: $('speed'),
    message: $('message'), weapon: $('weapon-status'),
    clock: $('clock'), hit: $('hitmarker'),
    damage: $('damage'), pause: $('pause-hint'),
    radar: $('radar-status'),
    missiles: $('missiles'), flares: $('flares'),
    missileChip: $('missile-chip'), flareChip: $('flare-chip'),
    crosshair: $('crosshair'),
    radioFeed: $('radio-feed'), radioCallsign: $('radio-callsign'), radioText: $('radio-text'),
    cinemaFade: $('cinema-fade')
  };

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;

  let bgImage = null, bgReady = false;
  if (typeof Image !== 'undefined') {
    bgImage = new Image();
    bgImage.onload = () => { bgReady = true; };
    bgImage.src = 'assets/nuremberg-dawn.png';
  }

  let w = 0, h = 0, focal = 0, baseFocal = 0, dpr = 1;
  let state = 'intro', last = 0, time = 0;
  let needsRedraw = true;
  let player, enemies = [], wrecks = [], buildings = [], clouds = [], particles = [], explosions = [], shots = [], playerShots = [], missiles = [], flares = [], wingmanTrail = [];
  let keys = {}, firing = false, hitFlash = 0, damageFlash = 0, muzzleFlash = 0, screenFlash = 0, shake = 0;
  let nextShot = 0, reload = 0, kills = 0, spawnTimer = 0, msgTimer = 0, audioTimer = 0, screamTimer = 1.8, muted = false;
  let lockedTarget = null, lockProgress = 0, lockReady = false, prevLockTarget = null;
  let missileCooldown = 0, missileRegen = 0, flareCooldown = 0, missileSide = 1;
  let slowMoTimer = 0, radioTimer = 0, warningTimer = 0, gStrainTimer = 0, flybyTimer = 0, lowAltTimer = 0;
  let pointerLockFallback = false, lastMouseX = null, lastMouseY = null;
  let yawInput = 0, yawMomentum = 0, pitchMomentum = 0, boost = 0;

  function resize() {
    needsRedraw = true;
    dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2, Math.sqrt(3840 * 2160 / (innerWidth * innerHeight)));
    w = innerWidth;
    h = innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseFocal = Math.min(w, h) * 0.86;
    focal = baseFocal;
  }
  addEventListener('resize', resize);
  resize();

  // Buildings are sized in the same world units as the aircraft's altitude.
  // Most houses are a few storeys high; steeples are occasional landmarks.
  let seed = 1561;
  function seeded() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  for (let z = 450; z < 4800; z += 120) {
    for (let x = -1800; x < 1800; x += 115) {
      if (seeded() < 0.32) continue;
      const tower = seeded() > 0.99;
      const church = !tower && seeded() > 0.993;
      buildings.push({
        x: x + seeded() * 95,
        z: z + seeded() * 100,
        w: church ? 38 + seeded() * 12 : 22 + seeded() * 18,
        d: church ? 55 + seeded() * 16 : 24 + seeded() * 20,
        h: church ? 24 + seeded() * 10 : tower ? 30 + seeded() * 15 : 10 + seeded() * 12,
        roof: church ? 12 + seeded() * 5 : 6 + seeded() * 6,
        tower: tower || church,
        church,
        smoke: seeded() > 0.84
      });
    }
  }

  // 3D volumetric cloud clusters floating above the valley.
  function initClouds() {
    clouds = [];
    for (let i = 0; i < 34; i++) {
      const puffs = [];
      const count = 4 + Math.floor(seeded() * 4);
      for (let k = 0; k < count; k++) {
        puffs.push({
          ox: (seeded() - 0.5) * 420,
          oy: (seeded() - 0.5) * 90,
          oz: (seeded() - 0.5) * 280,
          rx: 140 + seeded() * 170,
          ry: 45 + seeded() * 55,
          variant: (i + k) % 3
        });
      }
      clouds.push({
        x: (seeded() - 0.5) * 7600,
        y: 420 + seeded() * 980,
        z: 500 + seeded() * 6800,
        variant: i % 3,
        puffs
      });
    }
  }
  initClouds();

  function reset() {
    window.World3D?.reset?.();
    const initPitch = -0.015;
    const initSpeed = 195;
    player = {
      x: 0, y: 185, z: 0,
      vx: 0,
      vy: Math.sin(initPitch) * initSpeed,
      vz: Math.cos(initPitch) * initSpeed,
      yaw: 0, pitch: initPitch, roll: 0, targetRoll: 0,
      yawRate: 0, pitchRate: 0, rollRate: 0,
      speed: initSpeed, health: 100, ammo: 40,
      missiles: 6, flares: 12,
      recoil: 0,
      aoa: 0.025,
      slip: 0,
      gForce: 1.0,
      throttle: 0.58,
      buffet: 0
    };
    enemies = [];
    wrecks = [];
    particles = [];
    explosions = [];
    shots = [];
    playerShots = [];
    missiles = [];
    flares = [];
    wingmanTrail = [];
    keys = {};
    firing = false;
    kills = 0;
    reload = 0;
    nextShot = 0;
    missileCooldown = 0;
    missileRegen = 0;
    flareCooldown = 0;
    spawnTimer = 0;
    screamTimer = 1.8;
    time = 0;
    yawInput = 0;
    yawMomentum = 0;
    pitchMomentum = 0;
    boost = 0;
    lockedTarget = null;
    prevLockTarget = null;
    lockProgress = 0;
    lockReady = false;
    slowMoTimer = 0;
    radioTimer = 0;
    warningTimer = 0;
    gStrainTimer = 0;
    flybyTimer = 0;
    lowAltTimer = 0;
    lastMouseX = lastMouseY = null;
    if (ui.radioFeed) ui.radioFeed.hidden = true;
    hitFlash = damageFlash = muzzleFlash = screenFlash = shake = 0;
    for (let i = 0; i < 7; i++) spawn(i);
    updateUI();
  }

  function initEnemyOrbitalVelocity(e) {
    const dx = player.x - e.x;
    const dz = player.z - e.z;
    const hDist = Math.hypot(dx, dz) || 1;
    const nx = dx / hDist;
    const nz = dz / hDist;
    const tx = -nz * e.orbitDir;
    const tz = nx * e.orbitDir;
    const tangSpeed = e.orbitTanSpeed || 145;
    e.vx = tx * tangSpeed;
    e.vy = Math.cos(e.phase * 1.35) * (e.verticalAmp || 28);
    e.vz = tz * tangSpeed;
  }

  function spawn(i = 0) {
    const ang = player.yaw + rand(-0.62, 0.62);
    // Keep spheres, enemy fighters, and celestial anomalies at dramatic long aerial combat distances (2200 m - 5600 m).
    const dist = clamp(rand(2200, 4100) + i * 220, 2200, 5500);
    const rollType = Math.random();
    const idx = enemies.length;
    const type = idx === 0
      ? 'sphere'
      : idx === 1 || idx === 4
        ? 'fighter'
        : idx === 2
          ? 'cylinder'
          : idx === 5
            ? 'cross'
            : rollType < 0.36
              ? 'sphere'
              : rollType < 0.68
                ? 'fighter'
                : rollType < 0.85
                  ? 'cylinder'
                  : 'cross';
    const maxHp = type === 'cylinder' ? 4 : type === 'cross' ? 4 : 3;
    const e = {
      x: player.x + Math.sin(ang) * dist,
      y: clamp(player.y + rand(-60, 440), 250, 1450),
      z: player.z + Math.cos(ang) * dist,
      vx: 0,
      vy: 0,
      vz: 0,
      type,
      variant: Math.floor(Math.random() * 3),
      hp: maxHp,
      maxHp,
      phase: rand(0, TAU),
      ringPhase: rand(0, TAU),
      orbitDir: Math.random() < 0.5 ? -1 : 1,
      orbitSpeed: type === 'fighter' ? rand(0.42, 0.72) : rand(0.28, 0.55),
      orbitTanSpeed: type === 'fighter'
        ? rand(185, 245)
        : type === 'cylinder'
          ? rand(95, 132)
          : type === 'cross'
            ? rand(125, 168)
            : rand(148, 205),
      verticalAmp: type === 'fighter' ? rand(38, 72) : type === 'cylinder' ? rand(16, 28) : rand(24, 48),
      preferredDist: rand(2050, 4200),
      attack: rand(3.5, 7.5),
      cityAttack: rand(2.6, 6.2),
      charge: 0,
      hitTimer: 0,
      smokeTimer: 0,
      bank: 0,
      size: type === 'cylinder'
        ? rand(86, 114)
        : type === 'cross'
          ? rand(72, 96)
          : type === 'fighter'
            ? rand(66, 86)
            : rand(64, 90)
    };
    e.routeX=e.x; e.routeZ=e.z; e.routeY=e.y;
    e.routeHeading=rand(0,TAU);e.routeRadius=rand(350,1000);
    initEnemyOrbitalVelocity(e);
    enemies.push(e);
  }

  function computeBallisticAimPoint(target, ox, oy, oz, muzzleSpeed = 1050) {
    const rdx = target.x - ox;
    const rdy = target.y - oy;
    const rdz = target.z - oz;
    const rvx = (target.vx || 0) - (player.vx || 0);
    const rvy = (target.vy || 0) - (player.vy || 0);
    const rvz = (target.vz || 0) - (player.vz || 0);
    let tof = Math.hypot(rdx, rdy, rdz) / muzzleSpeed;
    for (let i = 0; i < 3; i++) {
      const px = target.x + rvx * tof;
      const py = target.y + rvy * tof + 0.5 * 9.81 * tof * tof;
      const pz = target.z + rvz * tof;
      tof = Math.hypot(px - ox, py - oy, pz - oz) / muzzleSpeed;
    }
    return {
      x: target.x + rvx * tof,
      y: target.y + rvy * tof + 0.5 * 9.81 * tof * tof,
      z: target.z + rvz * tof,
      leadX: target.x + (target.vx || 0) * tof,
      leadY: target.y + (target.vy || 0) * tof + 0.5 * 9.81 * tof * tof,
      leadZ: target.z + (target.vz || 0) * tof,
      tof
    };
  }

  function project(x, y, z) {
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

  function poly(points, fill, stroke) {
    if (points.some(p => !p)) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function drawSky(horizon) {
    // Base atmospheric dawn sky covering full viewport (safe under camera roll & shake).
    const pad = Math.max(w, h) * 0.45;
    const sky = ctx.createLinearGradient(0, -pad, 0, h + pad);
    sky.addColorStop(0, '#0f1c26');
    sky.addColorStop(0.26, '#2e4552');
    sky.addColorStop(0.47, '#7d7f81');
    sky.addColorStop(0.58, '#d49d72');
    sky.addColorStop(0.66, '#7b8473');
    sky.addColorStop(1, '#20312a');
    ctx.fillStyle = sky;
    ctx.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);

    // Panoramic dawn painting projected seamlessly with camera yaw & pitch.
    const sunFracX = 0.143;
    const sunFracY = 0.568;
    const panW = Math.max(w * 2.4, h * 3.4);
    const panH = bgReady && bgImage && bgImage.width ? panW * (bgImage.height / bgImage.width) : panW * 0.5625;
    const topY = horizon - panH * 0.59;
    const initialShift = sunFracX * panW - w * 0.72;
    const panShift = ((((player.yaw / TAU) * panW + initialShift) % panW) + panW) % panW;

    if (bgReady && bgImage && bgImage.width) {
      ctx.save();
      ctx.globalAlpha = 0.74;
      for (let x = -panShift - panW; x < w + pad; x += panW) {
        ctx.drawImage(bgImage, x, topY, panW, panH);
      }
      ctx.restore();

      // Smooth vertical sky fade over the top edge of the panorama so pitching up/down is seamless.
      const topFade = ctx.createLinearGradient(0, topY - 40, 0, topY + panH * 0.25);
      topFade.addColorStop(0, '#12212b');
      topFade.addColorStop(1, 'rgba(18,33,43,0)');
      ctx.fillStyle = topFade;
      ctx.fillRect(-pad, -pad, w + pad * 2, topY + panH * 0.25 + pad);
    }

    // Lock the volumetric sun, god rays, and anamorphic streak onto the painted sunrise.
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

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sunHalo = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.52);
    sunHalo.addColorStop(0, 'rgba(255,248,224,.95)');
    sunHalo.addColorStop(0.035, 'rgba(255,220,165,.78)');
    sunHalo.addColorStop(0.16, 'rgba(246,168,104,.28)');
    sunHalo.addColorStop(0.45, 'rgba(215,120,85,.08)');
    sunHalo.addColorStop(1, 'rgba(215,120,85,0)');
    ctx.fillStyle = sunHalo;
    ctx.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);

    // Subtle Hollywood horizontal anamorphic sun streak.
    const streak = ctx.createLinearGradient(sx - w * 0.55, sy, sx + w * 0.55, sy);
    streak.addColorStop(0, 'rgba(255,190,120,0)');
    streak.addColorStop(0.35, 'rgba(255,212,158,.12)');
    streak.addColorStop(0.5, 'rgba(255,246,225,.35)');
    streak.addColorStop(0.65, 'rgba(175,220,255,.11)');
    streak.addColorStop(1, 'rgba(175,220,255,0)');
    ctx.fillStyle = streak;
    ctx.fillRect(sx - w * 0.55, sy - 4, w * 1.1, 8);

    // Crepuscular God Rays fanning across the dawn haze.
    for (let i = 0; i < 7; i++) {
      const rayAng = 0.25 + i * 0.28 + Math.sin(time * 0.22 + i) * 0.04;
      const len = h * 0.95;
      const spread = 0.05 + (i % 2) * 0.025;
      const rayGrad = ctx.createLinearGradient(sx, sy, sx + Math.cos(rayAng) * len, sy + Math.sin(rayAng) * len);
      rayGrad.addColorStop(0, 'rgba(255,216,158,.085)');
      rayGrad.addColorStop(0.6, 'rgba(240,180,125,.025)');
      rayGrad.addColorStop(1, 'rgba(240,180,125,0)');
      ctx.fillStyle = rayGrad;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(rayAng - spread) * len, sy + Math.sin(rayAng - spread) * len);
      ctx.lineTo(sx + Math.cos(rayAng + spread) * len, sy + Math.sin(rayAng + spread) * len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Distant Franconian ridgelines.
    for (let layer = 0; layer < 3; layer++) {
      const y = horizon + 3 + layer * 10;
      ctx.beginPath();
      ctx.moveTo(-pad, h + pad);
      ctx.lineTo(-pad, y);
      for (let x = -pad; x <= w + pad; x += 36) {
        ctx.lineTo(x, y + Math.sin(x * 0.0038 + player.yaw * (1.2 + layer * 0.9)) * 14 + Math.sin(x * 0.012 + layer * 2.7) * 6);
      }
      ctx.lineTo(w + pad, h + pad);
      ctx.closePath();
      ctx.fillStyle = ['rgba(86,96,95,.85)', 'rgba(72,84,78,.9)', 'rgba(54,69,59,.95)'][layer];
      ctx.fill();
    }

    // Ground valley plane + warm sunrise ground mist.
    const ground = ctx.createLinearGradient(0, horizon + 20, 0, h + pad);
    ground.addColorStop(0, '#737f6b');
    ground.addColorStop(0.24, '#506452');
    ground.addColorStop(1, '#1d2f27');
    ctx.fillStyle = ground;
    ctx.fillRect(-pad, horizon + 22, w + pad * 2, h + pad - horizon);

    const fog = ctx.createLinearGradient(0, horizon - 18, 0, horizon + h * 0.22);
    fog.addColorStop(0, 'rgba(232,196,158,.32)');
    fog.addColorStop(0.45, 'rgba(210,186,165,.12)');
    fog.addColorStop(1, 'rgba(210,186,165,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(-pad, horizon - 18, w + pad * 2, h * 0.22 + 18);

    // Pegnitz river winding through the valley catching dawn reflections.
    ctx.save();
    ctx.strokeStyle = 'rgba(222,175,126,.34)';
    ctx.lineWidth = 3;
    const baseZ = Math.floor(player.z / 400) * 400;
    ctx.beginPath();
    let startedRiver = false;
    for (let rz = baseZ - 400; rz <= baseZ + 4800; rz += 260) {
      const rx = Math.sin(rz * 0.00085) * 620 + Math.cos(rz * 0.0003) * 240;
      const rp = project(rx, 2, rz);
      if (rp) {
        if (!startedRiver) { ctx.moveTo(rp.x, rp.y); startedRiver = true; }
        else ctx.lineTo(rp.x, rp.y);
      }
    }
    if (startedRiver) {
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(132,158,148,.22)';
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(238,188,136,.32)';
      ctx.stroke();
    }
    ctx.restore();

    // Medieval road & field grid lines in world space.
    const baseX = Math.floor(player.x / 400) * 400;
    ctx.strokeStyle = 'rgba(24,44,35,.25)';
    ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i++) {
      const a = project(baseX + i * 400, 0, baseZ - 400);
      const b = project(baseX + i * 400, 0, baseZ + 4500);
      if (a && b) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    for (let j = 1; j < 11; j++) {
      const a = project(baseX - 3200, 0, baseZ + j * 400);
      const b = project(baseX + 3200, 0, baseZ + j * 400);
      if (a && b) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
  }

  function drawClouds() {
    const tileZ = 7000;
    const baseZ = Math.floor(player.z / tileZ) * tileZ;
    const visible = [];
    for (let oz = 0; oz <= 1; oz++) {
      for (const c of clouds) {
        const cz = c.z + baseZ + oz * tileZ;
        const dist = cz - player.z;
        if (dist < -400 || dist > 6800) continue;
        const p = project(c.x + player.x * 0.25, c.y, cz);
        if (!p || p.x < -450 || p.x > w + 450 || p.y < -300 || p.y > h + 300) continue;
        visible.push({ c, cz, p });
      }
    }
    visible.sort((a, b) => b.p.z - a.p.z);
    for (const item of visible) {
      const fadeNear = clamp((item.p.z - 120) / 380, 0, 1);
      const fadeFar = clamp(1 - item.p.z / 6800, 0.12, 1);
      const alpha = fadeNear * fadeFar * 0.56;
      if (alpha <= 0.02) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      for (const puff of item.c.puffs) {
        const pp = project(item.c.x + player.x * 0.25 + puff.ox, item.c.y + puff.oy, item.cz + puff.oz);
        if (!pp) continue;
        const rx = clamp(puff.rx * pp.s, 14, 380);
        const ry = clamp(puff.ry * pp.s, 6, 140);
        const cg = ctx.createRadialGradient(pp.x, pp.y - ry * 0.3, 0, pp.x, pp.y, rx);
        cg.addColorStop(0, 'rgba(246,214,180,.62)');
        cg.addColorStop(0.48, 'rgba(135,148,154,.38)');
        cg.addColorStop(1, 'rgba(58,76,84,0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.ellipse(pp.x, pp.y, rx, ry, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawBuilding(b) {
    const { x, z, w: ww, d, h: hh, roof, tower, church, smoke } = b;
    const p = (xx, yy, zz) => project(xx, yy, zz);
    const a = p(x, 0, z), b1 = p(x + ww, 0, z), c = p(x + ww, hh, z), d1 = p(x, hh, z);
    const e = p(x, hh, z + d), f = p(x + ww, hh, z + d), g = p(x + ww, 0, z + d);
    const ridge1 = p(x + ww / 2, hh + roof, z), ridge2 = p(x + ww / 2, hh + roof, z + d);
    if (!a || !b1 || !c || !d1 || !e || !f || !g || !ridge1 || !ridge2) return;
    if ((a.x < -300 && b1.x < -300) || (a.x > w + 300 && b1.x > w + 300)) return;

    ctx.save();
    ctx.globalAlpha = clamp(1 - a.z / 7400, 0.25, 1);
    poly([a, b1, c, d1], tower ? '#888578' : '#a79b83');
    poly([b1, g, f, c], '#65695c');
    poly([d1, c, ridge1], tower ? '#888578' : '#a2947a');
    poly([c, f, ridge2, ridge1], church ? '#5c4e48' : '#784e3f');
    poly([d1, e, ridge2, ridge1], church ? '#7c6558' : '#9c634d');

    if (tower) {
      const spireH = church ? 92 : 62;
      const q = p(x + ww / 2, hh + roof + spireH, z + d / 2);
      poly([ridge1, ridge2, q], '#46524d');
      if (church && q) {
        const q2 = p(x + ww * 0.32, hh + roof + spireH * 0.85, z + d * 0.25);
        poly([d1, ridge1, q2], '#3f4a46');
      }
    }

    if (a.z < 1900 && Math.abs(b1.x - a.x) > 11) {
      const rows = Math.max(1, Math.floor(hh / 45));
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < 2; col++) {
          const wx = x + ww * (0.23 + col * 0.43), wy = 15 + row * 38, wwin = ww * 0.11;
          // Warm hearth candlelight glowing faintly in early dawn windows.
          const lit = ((row + col) % 3 === 0) ? 'rgba(218,158,92,.45)' : 'rgba(34,42,38,.82)';
          poly([p(wx, wy, z - 1), p(wx + wwin, wy, z - 1), p(wx + wwin, wy + 17, z - 1), p(wx, wy + 17, z - 1)], lit);
        }
      }
    }

    // Subtle rising chimney smoke plume.
    if (smoke && a.z < 2400 && ridge1) {
      const drift = Math.sin(time * 0.9 + x * 0.02) * 8;
      ctx.fillStyle = 'rgba(185,188,184,.18)';
      for (let s = 1; s <= 3; s++) {
        ctx.beginPath();
        ctx.arc(ridge1.x + drift * s * 0.6, ridge1.y - s * 10 * clamp(a.s * 3, 0.3, 1.4), clamp((3 + s * 2.5) * a.s * 6, 1.5, 9), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawEnemy(e) {
    const p = project(e.x, e.y, e.z);
    if (!p || p.x < -160 || p.x > w + 160 || p.y < -160 || p.y > h + 160) return;

    // Clamped screen radius keeps distant spheres visibly distant and cinematic, never bloated.
    const r = clamp(e.size * p.s, 4.5, 42);
    const atmFade = clamp(1 - p.z / 7600, 0.42, 1);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalAlpha = atmFade;

    // Atmospheric glow / charging aura when preparing a plasma shot.
    if (e.charge > 0.05 || e.hitTimer > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glowR = r * (2.2 + e.charge * 1.4);
      const aura = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, glowR);
      if (e.hitTimer > 0) {
        aura.addColorStop(0, 'rgba(255,245,210,.85)');
        aura.addColorStop(0.4, 'rgba(120,220,255,.4)');
        aura.addColorStop(1, 'rgba(120,220,255,0)');
      } else {
        aura.addColorStop(0, `rgba(255,190,115,${0.55 * e.charge})`);
        aura.addColorStop(0.5, `rgba(255,95,45,${0.25 * e.charge})`);
        aura.addColorStop(1, 'rgba(255,95,45,0)');
      }
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, 0, glowR, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    if (e.type === 'sphere') {
      // Metallic dark-bronze/gunmetal celestial sphere with sunrise specular highlight.
      ctx.rotate((e.bank || 0) * 0.25);
      const g = ctx.createRadialGradient(-r * 0.36, -r * 0.4, r * 0.04, 0, 0, r);
      g.addColorStop(0, '#efe1c8');
      g.addColorStop(0.14, e.variant === 1 ? '#8fa8a8' : e.variant === 2 ? '#b09a88' : '#9fa9a2');
      g.addColorStop(0.36, '#52605d');
      g.addColorStop(0.75, '#223033');
      g.addColorStop(1, '#0b1418');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();

      // Rotating gyroscopic equatorial and meridian rings.
      const tilt = -0.3 + Math.sin(e.ringPhase) * 0.18 + (e.bank || 0) * 0.35;
      ctx.strokeStyle = 'rgba(224,212,182,.52)';
      ctx.lineWidth = Math.max(0.8, r * 0.04);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.18, r * 0.26, tilt, 0, TAU);
      ctx.stroke();

      if (r > 6) {
        ctx.strokeStyle = e.variant === 2 ? 'rgba(240,175,115,.32)' : 'rgba(145,215,220,.28)';
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.52, r * 1.04, tilt + Math.cos(e.ringPhase * 0.7) * 0.3, 0, TAU);
        ctx.stroke();
      }

      // Pulsing furnace-orange core eye.
      const pulse = 0.75 + 0.25 * Math.sin(time * 5 + e.phase);
      ctx.fillStyle = `rgba(255,165,92,${pulse})`;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1.5, r * 0.16), 0, TAU);
      ctx.fill();
    } else if (e.type === 'cylinder') {
      ctx.rotate(-0.18 + (e.bank || 0) * 0.45 + Math.sin(e.phase * 0.5) * 0.05);
      const g = ctx.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, '#e3d6be');
      g.addColorStop(0.22, '#8b968e');
      g.addColorStop(0.55, '#41514f');
      g.addColorStop(1, '#111e21');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(-r * 1.65, -r * 0.52, r * 3.3, r * 1.04, r * 0.48);
      ctx.fill();
      ctx.strokeStyle = 'rgba(224,212,182,.62)';
      ctx.lineWidth = Math.max(0.7, r * 0.035);
      ctx.stroke();

      if (r > 5) {
        ctx.strokeStyle = 'rgba(20,34,34,.75)';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * r * 0.72, -r * 0.48);
          ctx.lineTo(i * r * 0.72, r * 0.48);
          ctx.stroke();
        }
      }
      // Illuminated porthole slit.
      ctx.fillStyle = '#f2a46b';
      ctx.fillRect(-r * 0.5, -r * 0.05, r, Math.max(1.5, r * 0.09));
    } else if (e.type === 'fighter') {
      // Swept-wing stealth enemy interceptor jet with twin plasma afterburners.
      ctx.rotate((e.bank || 0) * 0.75);
      ctx.fillStyle = '#242b30';
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.15);
      ctx.lineTo(r * 1.12, r * 0.35);
      ctx.lineTo(r * 0.28, r * 0.85);
      ctx.lineTo(-r * 0.28, r * 0.85);
      ctx.lineTo(-r * 1.12, r * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff9642';
      ctx.beginPath();
      ctx.arc(-r * 0.2, r * 0.85, Math.max(1.5, r * 0.16), 0, TAU);
      ctx.arc(r * 0.2, r * 0.85, Math.max(1.5, r * 0.16), 0, TAU);
      ctx.fill();
    } else {
      // 1561 Glaser celestial cross with 4 spheres orbiting a blazing central hub.
      ctx.rotate(e.ringPhase * 0.35);
      ctx.strokeStyle = '#334140';
      ctx.lineWidth = Math.max(1.5, r * 0.16);
      ctx.beginPath();
      ctx.moveTo(-r * 1.15, 0); ctx.lineTo(r * 1.15, 0);
      ctx.moveTo(0, -r * 1.15); ctx.lineTo(0, r * 1.15);
      ctx.stroke();
      for (const [ox, oy] of [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1], [0, 0]]) {
        const subR = ox === 0 && oy === 0 ? r * 0.42 : r * 0.32;
        const sg = ctx.createRadialGradient(ox * r - subR * 0.3, oy * r - subR * 0.3, 0, ox * r, oy * r, subR);
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

    // Long-range F-35A Helmet Target Designator Box.
    if (state === 'playing' && p.z < 6400) {
      const isLocked = lockedTarget === e;
      const boxS = Math.max(14, r + 11);
      const color = isLocked ? 'rgba(255,198,118,.95)' : e.charge > 0.3 ? 'rgba(255,120,90,.82)' : 'rgba(176,242,202,.56)';
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = isLocked ? 1.6 : 1;
      const corner = Math.max(5, boxS * 0.38);
      // Sleek tactical corner brackets instead of clunky full rectangles.
      ctx.beginPath();
      // Top-left
      ctx.moveTo(p.x - boxS, p.y - boxS + corner); ctx.lineTo(p.x - boxS, p.y - boxS); ctx.lineTo(p.x - boxS + corner, p.y - boxS);
      // Top-right
      ctx.moveTo(p.x + boxS - corner, p.y - boxS); ctx.lineTo(p.x + boxS, p.y - boxS); ctx.lineTo(p.x + boxS, p.y - boxS + corner);
      // Bottom-right
      ctx.moveTo(p.x + boxS, p.y + boxS - corner); ctx.lineTo(p.x + boxS, p.y + boxS); ctx.lineTo(p.x + boxS - corner, p.y + boxS);
      // Bottom-left
      ctx.moveTo(p.x - boxS + corner, p.y + boxS); ctx.lineTo(p.x - boxS, p.y + boxS); ctx.lineTo(p.x - boxS, p.y + boxS - corner);
      ctx.stroke();

      // Integrity bar for damaged/locked targets.
      if (e.hp < e.maxHp || isLocked) {
        const bw = boxS * 1.6;
        ctx.fillStyle = 'rgba(10,20,18,.65)';
        ctx.fillRect(p.x - bw / 2, p.y + boxS + 5, bw, 3);
        ctx.fillStyle = isLocked ? '#ffbc75' : '#9eeac0';
        ctx.fillRect(p.x - bw / 2, p.y + boxS + 5, bw * clamp(e.hp / e.maxHp, 0, 1), 3);
      }

      ctx.font = isLocked ? 'bold 10px Arial' : '10px Arial';
      ctx.fillStyle = isLocked ? '#ffe0ae' : '#d2eadb';
      const label = e.type === 'fighter' ? 'CAZA' : e.type === 'cylinder' ? 'NODRIZA' : e.type === 'cross' ? 'CRUZ' : 'ESFERA';
      const distText = (p.z / 1000).toFixed(1) + ' KM';
      ctx.fillText((isLocked ? '◈ FIJADO · ' : '') + label + ' ' + distText, p.x - boxS, p.y - boxS - 6);
      ctx.restore();
    }
  }

  function getWingmanPos(tOffset = 0) {
    const t = time - tOffset;
    const sweep = Math.sin(t * 0.34) * 0.24;
    const ang = player.yaw + 0.46 + sweep;
    const dist = 1280 + Math.cos(t * 0.42) * 180;
    return {
      x: player.x + Math.sin(ang) * dist,
      y: player.y - 95 + Math.sin(t * 0.65) * 45,
      z: player.z + Math.cos(ang) * dist,
      bank: -0.14 + Math.cos(t * 0.34) * 0.22
    };
  }

  function drawJet() {
    // Draw wingtip contrails behind allied F-35A ARG-062.
    if (wingmanTrail.length > 2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(232,240,238,.28)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let moved = false;
      for (let i = 0; i < wingmanTrail.length; i++) {
        const pt = project(wingmanTrail[i].x, wingmanTrail[i].y, wingmanTrail[i].z);
        if (!pt) continue;
        if (!moved) { ctx.moveTo(pt.x, pt.y); moved = true; }
        else ctx.lineTo(pt.x, pt.y);
      }
      if (moved) ctx.stroke();
      ctx.restore();
    }

    const wp = getWingmanPos(0);
    const p = project(wp.x, wp.y, wp.z);
    if (!p) return;
    const s = clamp(p.s * 54, 9, 44);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(wp.bank);

    // Afterburner plume & Mach shock diamond.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const flameLen = s * (0.95 + Math.sin(time * 42) * 0.18);
    const flame = ctx.createRadialGradient(0, s * 1.15, 0, 0, s * 1.15 + flameLen * 0.45, flameLen);
    flame.addColorStop(0, 'rgba(255,250,225,.95)');
    flame.addColorStop(0.3, 'rgba(255,155,70,.72)');
    flame.addColorStop(0.7, 'rgba(95,165,255,.28)');
    flame.addColorStop(1, 'rgba(95,165,255,0)');
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.ellipse(0, s * 1.32, s * 0.16, flameLen * 0.65, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    const jet = ctx.createLinearGradient(-s, 0, s, 0);
    jet.addColorStop(0, '#222f32');
    jet.addColorStop(0.45, '#6b7772');
    jet.addColorStop(0.6, '#3c4d4b');
    jet.addColorStop(1, '#1a292a');
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
    ctx.strokeStyle = 'rgba(205,220,205,.45)';
    ctx.lineWidth = Math.max(0.6, s * 0.035);
    ctx.stroke();

    ctx.fillStyle = '#1a2d31';
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.65, s * 0.12, s * 0.37, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#aeb3a4'; ctx.fillRect(-s * 0.14, s * 0.58, s * 0.28, s * 0.08);
    ctx.fillStyle = '#8bc7d3'; ctx.fillRect(-s * 0.12, s * 0.68, s * 0.24, s * 0.08);
    ctx.fillStyle = '#f5f5df'; ctx.fillRect(-s * 0.12, s * 0.76, s * 0.24, s * 0.07);
    ctx.fillStyle = '#8bc7d3'; ctx.fillRect(-s * 0.12, s * 0.83, s * 0.24, s * 0.08);
    ctx.restore();

    ctx.font = '10px Arial';
    ctx.fillStyle = '#c5e5d1';
    ctx.fillText('ALIADO · ARG-062', p.x + 16, p.y - 12);
  }

  function drawExplosion(ex) {
    const p = project(ex.x, ex.y, ex.z);
    if (!p || p.x < -380 || p.x > w + 380 || p.y < -380 || p.y > h + 380) return;
    const t = clamp(ex.age / ex.maxAge, 0, 1);
    const scale = clamp(ex.radius * p.s, 18, 280);

    ctx.save();
    ctx.translate(p.x, p.y);

    // 1. Dark billowing smoke lobes (drawn first behind bright core).
    for (const lobe of ex.lobes) {
      const lt = clamp((t - lobe.delay) / (1 - lobe.delay), 0, 1);
      if (lt <= 0.05) continue;
      const spread = scale * (0.28 + lt * lobe.dist);
      const lx = Math.cos(lobe.ang) * spread;
      const ly = Math.sin(lobe.ang) * spread - lt * scale * 0.35;
      const lr = scale * lobe.size * (0.35 + lt * 0.95);
      const sg = ctx.createRadialGradient(lx, ly + lr * 0.2, lr * 0.05, lx, ly, lr);
      if (lt < 0.48) {
        const heat = 1 - lt / 0.48;
        sg.addColorStop(0, `rgba(255,${Math.round(160 * heat + 55)},40,${0.72 * (1 - lt * 0.6)})`);
        sg.addColorStop(0.55, `rgba(95,38,24,${0.62 * (1 - lt * 0.4)})`);
        sg.addColorStop(1, 'rgba(20,18,18,0)');
      } else {
        const smokeAlpha = clamp((1 - lt) * 1.45, 0, 0.72);
        sg.addColorStop(0, `rgba(26,25,26,${smokeAlpha})`);
        sg.addColorStop(0.65, `rgba(48,44,42,${smokeAlpha * 0.65})`);
        sg.addColorStop(1, 'rgba(35,34,34,0)');
      }
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, TAU);
      ctx.fill();
    }

    // 2. Additive Hollywood Fireball, Dual Sonic Shockwaves & Anamorphic Lens Flare.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Dual expanding sonic shockwave rings.
    if (t < 0.85) {
      const waveT = t / 0.85;
      const waveR = scale * (0.55 + Math.pow(waveT, 0.72) * 3.8);
      ctx.strokeStyle = `rgba(255,236,205,${(1 - waveT) * 0.68})`;
      ctx.lineWidth = Math.max(1.2, (1 - waveT) * 6);
      ctx.beginPath();
      ctx.ellipse(0, 0, waveR, waveR * 0.74, ex.flareTilt, 0, TAU);
      ctx.stroke();

      const innerWaveR = scale * (0.35 + Math.pow(waveT, 0.85) * 2.5);
      ctx.strokeStyle = `rgba(255,135,55,${(1 - waveT) * 0.55})`;
      ctx.lineWidth = Math.max(1, (1 - waveT) * 4);
      ctx.beginPath();
      ctx.ellipse(0, 0, innerWaveR, innerWaveR * 0.82, -ex.flareTilt, 0, TAU);
      ctx.stroke();
    }

    // Blazing core & chain reaction flashes.
    const coreAlpha = clamp(1 - t * 1.55, 0, 1);
    if (coreAlpha > 0) {
      const coreR = scale * (0.7 + t * 1.35);
      const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
      core.addColorStop(0, `rgba(255,255,245,${coreAlpha})`);
      core.addColorStop(0.18, `rgba(255,222,138,${coreAlpha * 0.92})`);
      core.addColorStop(0.45, `rgba(255,118,32,${coreAlpha * 0.68})`);
      core.addColorStop(0.75, `rgba(185,38,14,${coreAlpha * 0.25})`);
      core.addColorStop(1, 'rgba(185,38,14,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(0, 0, coreR, 0, TAU);
      ctx.fill();

      // Anamorphic Hollywood lens flare bar across the detonation.
      if (t < 0.36) {
        const flareAlpha = (1 - t / 0.36) * 0.88;
        const flareW = clamp(scale * 5.2, 90, w * 0.72);
        const flareH = Math.max(4, scale * 0.22);
        ctx.save();
        ctx.rotate(ex.flareTilt * 0.35);
        const fg = ctx.createLinearGradient(-flareW, 0, flareW, 0);
        fg.addColorStop(0, 'rgba(120,210,255,0)');
        fg.addColorStop(0.32, `rgba(170,225,255,${flareAlpha * 0.35})`);
        fg.addColorStop(0.5, `rgba(255,248,225,${flareAlpha})`);
        fg.addColorStop(0.68, `rgba(255,195,120,${flareAlpha * 0.42})`);
        fg.addColorStop(1, 'rgba(255,195,120,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(-flareW, -flareH * 0.5, flareW * 2, flareH);
        ctx.restore();
      }
    }

    // Secondary chain detonations.
    for (const sec of ex.secondaries) {
      const st = (ex.age - sec.delay) / 0.75;
      if (st > 0 && st < 1) {
        const sa = Math.sin(st * Math.PI);
        const sr = scale * sec.size * (0.4 + st * 1.1);
        const sx = sec.ox * scale, sy = sec.oy * scale;
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

    ctx.restore();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      const v = project(p.x, p.y, p.z);
      if (!v) continue;
      const lifeRatio = clamp(p.life / p.max, 0, 1);

      if (p.kind === 'spark') {
        const prev = project(p.px, p.py, p.pz);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = lifeRatio;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = clamp(p.size * v.s * 0.45, 1.2, 4.2);
        ctx.beginPath();
        if (prev) {
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(v.x, v.y);
        } else {
          ctx.moveTo(v.x, v.y);
          ctx.lineTo(v.x + 2, v.y + 2);
        }
        ctx.stroke();
        ctx.restore();
      } else if (p.kind === 'debris') {
        ctx.save();
        ctx.translate(v.x, v.y);
        ctx.rotate(p.spin + time * p.spinSpeed);
        ctx.globalAlpha = clamp(lifeRatio * 1.3, 0, 1);
        const ds = clamp(p.size * v.s, 2, 11);
        ctx.fillStyle = '#2d2c2b';
        ctx.fillRect(-ds, -ds * 0.45, ds * 2, ds * 0.9);
        ctx.fillStyle = `rgba(255,145,55,${lifeRatio})`;
        ctx.fillRect(-ds * 0.5, -ds * 0.2, ds, ds * 0.4);
        ctx.restore();
      } else {
        // Volumetric smoke or fire puff.
        const r = clamp(p.size * v.s * (p.grow ? (1.8 - lifeRatio * 0.9) : 1), 1.5, 58);
        ctx.save();
        if (p.additive) ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = lifeRatio * (p.alpha || 0.85);
        const pg = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, r);
        pg.addColorStop(0, p.color);
        pg.addColorStop(1, 'rgba(20,20,20,0)');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(v.x, v.y, r, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawShots() {
    // Player GAU-22/A high-velocity tracer rounds streaking into the distance.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of playerShots) {
      const head = project(s.x, s.y, s.z);
      const tail = project(s.x - s.vx * 0.028, s.y - s.vy * 0.028, s.z - s.vz * 0.028);
      if (!head || !tail) continue;
      ctx.strokeStyle = 'rgba(255,218,132,.92)';
      ctx.lineWidth = clamp(6.5 * head.s, 1.5, 4.5);
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(head.x, head.y, clamp(3.5 * head.s, 1, 3.2), 0, TAU);
      ctx.fill();
    }

    // Incoming enemy plasma bolts with glowing halo and trail.
    for (const s of shots) {
      const p = project(s.x, s.y, s.z);
      const tail = project(s.x - s.vx * 0.07, s.y - s.vy * 0.07, s.z - s.vz * 0.07);
      if (!p) continue;
      const r = clamp(12 * p.s, 2.5, 16);
      if (tail) {
        ctx.strokeStyle = 'rgba(255,140,70,.68)';
        ctx.lineWidth = Math.max(1.5, r * 0.55);
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      const sg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.1);
      sg.addColorStop(0, '#ffffff');
      sg.addColorStop(0.28, '#ffcf86');
      sg.addColorStop(0.65, 'rgba(255,95,40,.45)');
      sg.addColorStop(1, 'rgba(255,95,40,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.1, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCockpit() {
    // High-speed peripheral air rush streaks when in afterburner.
    if (boost > 0.15) {
      ctx.save();
      ctx.strokeStyle = `rgba(220,242,235,${boost * 0.16})`;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * TAU + Math.sin(time * 3 + i) * 0.1;
        const r1 = Math.min(w, h) * (0.36 + ((time * 2.4 + i * 0.37) % 1) * 0.25);
        const r2 = r1 + 45 + boost * 60;
        ctx.beginPath();
        ctx.moveTo(w / 2 + Math.cos(ang) * r1, h / 2 + Math.sin(ang) * r1);
        ctx.lineTo(w / 2 + Math.cos(ang) * r2, h / 2 + Math.sin(ang) * r2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Gun muzzle flashes & twin tracer origin flares.
    if (muzzleFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(muzzleFlash, 0, 1);
      const flash = ctx.createRadialGradient(w * 0.5, h * 0.89, 0, w * 0.5, h * 0.89, h * 0.42);
      flash.addColorStop(0, 'rgba(255,244,205,.72)');
      flash.addColorStop(0.25, 'rgba(255,176,92,.28)');
      flash.addColorStop(1, 'rgba(255,150,70,0)');
      ctx.fillStyle = flash;
      ctx.fillRect(0, h * 0.4, w, h * 0.6);

      ctx.strokeStyle = 'rgba(255,230,170,.95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(w * 0.46, h * 0.89); ctx.lineTo(w * 0.496, h * 0.52);
      ctx.moveTo(w * 0.54, h * 0.89); ctx.lineTo(w * 0.504, h * 0.52);
      ctx.stroke();
      ctx.restore();
    }

    // Dynamic helmet HUD pitch ladder & off-screen threat indicators while playing.
    if (state === 'playing') {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-player.roll);

      // Stabilized horizon & pitch ticks.
      ctx.strokeStyle = 'rgba(176,242,202,.28)';
      ctx.lineWidth = 1;
      const pitchOff = clamp(player.pitch * focal * 0.25, -120, 120);
      ctx.beginPath();
      ctx.moveTo(-110, pitchOff); ctx.lineTo(-44, pitchOff);
      ctx.moveTo(44, pitchOff); ctx.lineTo(110, pitchOff);
      ctx.stroke();
      ctx.restore();

      // Compass heading bar at upper center.
      const deg = (((player.yaw * 180 / Math.PI) % 360) + 360) % 360;
      ctx.save();
      ctx.fillStyle = 'rgba(182,245,204,.65)';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('HDG ' + String(Math.round(deg)).padStart(3, '0') + '°', w / 2, h * 0.145);
      ctx.restore();

      // Off-screen threat chevrons around center radar ring.
      const ringR = Math.min(w, h) * 0.33;
      for (const e of enemies) {
        const dx = e.x - player.x, dy = e.y - player.y, dz = e.z - player.z;
        const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
        const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
        const px = dx * cy - dz * sy;
        const forward = dx * sy + dz * cy;
        const py = dy * cp - forward * sp;
        const depth = forward * cp + dy * sp;
        const angScreen = Math.atan2(-py, px) - player.roll;
        const onScreen = depth > 20 && Math.abs(px * focal / depth) < w * 0.44 && Math.abs(py * focal / depth) < h * 0.42;
        if (!onScreen) {
          const ix = w / 2 + Math.cos(angScreen) * ringR;
          const iy = h / 2 + Math.sin(angScreen) * ringR;
          ctx.save();
          ctx.translate(ix, iy);
          ctx.rotate(angScreen);
          ctx.fillStyle = e.charge > 0.35 ? 'rgba(255,115,80,.88)' : 'rgba(242,182,118,.78)';
          ctx.beginPath();
          ctx.moveTo(9, 0);
          ctx.lineTo(-4, -5);
          ctx.lineTo(-2, 0);
          ctx.lineTo(-4, 5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // Flight Path Marker (velocity vector) & LCOS ballistic lead pipper in fallback HUD.
    if (state === 'playing') {
      const vMag = Math.hypot(player.vx || 0, player.vy || 0, player.vz || 0);
      if (vMag > 10) {
        const fpm = project(player.x + player.vx * 12, player.y + player.vy * 12, player.z + player.vz * 12);
        if (fpm) {
          ctx.save();
          ctx.translate(w / 2, h / 2);
          ctx.rotate(-player.roll);
          const fxScreen = fpm.x - w / 2, fyScreen = fpm.y - h / 2;
          ctx.strokeStyle = 'rgba(176,242,202,.72)';
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.arc(fxScreen, fyScreen, 7, 0, TAU);
          ctx.moveTo(fxScreen - 15, fyScreen); ctx.lineTo(fxScreen - 7, fyScreen);
          ctx.moveTo(fxScreen + 7, fyScreen); ctx.lineTo(fxScreen + 15, fyScreen);
          ctx.moveTo(fxScreen, fyScreen - 7); ctx.lineTo(fxScreen, fyScreen - 14);
          ctx.stroke();
          ctx.restore();
        }
      }
      if (lockedTarget) {
        const lead = computeBallisticAimPoint(lockedTarget, player.x, player.y, player.z, 1050);
        const lp = project(lead.x, lead.y, lead.z);
        if (lp) {
          ctx.save();
          ctx.translate(w / 2, h / 2);
          ctx.rotate(-player.roll);
          const lx = lp.x - w / 2, ly = lp.y - h / 2;
          ctx.strokeStyle = 'rgba(255,212,135,.88)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(lx, ly, 9, 0, TAU);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // Subtle cockpit recoil, G-load/AoA inertia, roll sway & pilot breathing sway on canopy coaming.
    const breatheY = Math.sin(time * 1.45) * 1.5;
    const breatheX = Math.cos(time * 0.72) * 0.8;
    const gSwayY = clamp(((player.gForce || 1) - 1) * 3.0 + (player.aoa || 0) * 16, -12, 20);
    const swayX = -player.roll * 18 - (player.slip || 0) * 20 + breatheX;
    const swayY = player.recoil * 6 + Math.abs(player.roll) * 6 + gSwayY + breatheY;
    ctx.save();
    ctx.translate(swayX, swayY);

    // Canopy glass reflections.
    const glass = ctx.createLinearGradient(0, 0, w, h);
    glass.addColorStop(0, 'rgba(202,234,228,.08)');
    glass.addColorStop(0.28, 'rgba(180,215,210,0)');
    glass.addColorStop(0.72, 'rgba(180,215,210,0)');
    glass.addColorStop(1, 'rgba(218,236,216,.05)');
    ctx.fillStyle = glass;
    ctx.fillRect(-30, -30, w + 60, h + 60);

    // Instrument coaming & matte F-35 glare shield.
    ctx.fillStyle = '#131d1c';
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
    ctx.fill();

    ctx.strokeStyle = '#5e7264';
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

    // Canopy side struts & HUD glass arc.
    poly([{ x: -30, y: -30 }, { x: w * 0.02, y: -30 }, { x: w * 0.082, y: h * 0.88 }, { x: -30, y: h * 0.91 }], 'rgba(12,22,24,.72)');
    poly([{ x: w + 30, y: -30 }, { x: w * 0.98, y: -30 }, { x: w * 0.918, y: h * 0.88 }, { x: w + 30, y: h * 0.91 }], 'rgba(12,22,24,.72)');

    ctx.strokeStyle = 'rgba(176,228,196,.2)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.53, Math.min(w, h) * 0.36, 3.5, 5.92);
    ctx.stroke();

    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 3 === 0 ? '#79a88b' : i === 7 && player.health < 40 ? '#e06b50' : '#425e4e';
      ctx.fillRect(w * (0.08 + i * 0.018), h * 0.957, Math.max(2, w * 0.0045), 2.5);
      ctx.fillRect(w * (0.79 + i * 0.018), h * 0.957, Math.max(2, w * 0.0045), 2.5);
    }
    ctx.restore();

    // Explosion screen flash wash.
    if (screenFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,215,155,${clamp(screenFlash * 0.38, 0, 0.45)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  function draw() {
    if (typeof window !== 'undefined' && window.GameRenderer && window.GameRenderer.render) {
      window.GameRenderer.render(ctx, {
        w, h, dpr, focal, time, state, player, enemies, wrecks, buildings, clouds,
        explosions, particles, shots, playerShots, missiles, flares, wingman: getWingmanPos(0), wingmanTrail,
        lockedTarget, lockProgress, lockReady,
        boost, muzzleFlash, hitFlash, damageFlash, screenFlash, shake, project
      });
      return;
    }

    const horizon = clamp(h / 2 + player.pitch * focal, h * 0.1, h * 0.9);
    const sx = shake > 0 ? (Math.random() - 0.5) * shake * 18 : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * shake * 14 : 0;

    ctx.save();
    ctx.translate(w / 2 + sx, h / 2 + sy);
    ctx.rotate(-player.roll);
    ctx.translate(-w / 2, -h / 2);

    drawSky(horizon);

    const tileX = Math.round(player.x / 3600) * 3600;
    const tileZ = Math.floor(player.z / 4200) * 4200;
    const sorted = [];
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        for (const b of buildings) {
          const x = b.x + tileX + ox * 3600;
          const z = b.z + tileZ + oz * 4200;
          if (Math.abs(z - player.z) < 4200 && Math.abs(x - player.x) < 2800) {
            sorted.push({ ...b, x, z });
          }
        }
      }
    }
    sorted.sort((a, b) => Math.hypot(b.x - player.x, b.z - player.z) - Math.hypot(a.x - player.x, a.z - player.z));
    for (const b of sorted) drawBuilding(b);

    drawClouds();
    drawJet();

    enemies
      .slice()
      .sort((a, b) => Math.hypot(b.x - player.x, b.z - player.z) - Math.hypot(a.x - player.x, a.z - player.z))
      .forEach(drawEnemy);

    for (const ex of explosions) drawExplosion(ex);
    drawParticles();
    drawShots();

    ctx.restore();
    drawCockpit();
  }

  function burst(e) {
    const dist = Math.hypot(e.x - player.x, e.y - player.y, e.z - player.z);
    shake = Math.max(shake, clamp(2600 / Math.max(600, dist), 0.35, 1.15));
    screenFlash = Math.max(screenFlash, clamp(1600 / Math.max(850, dist), 0.24, 0.72));

    const lobes = [];
    for (let i = 0; i < 10; i++) {
      lobes.push({
        ang: (i / 10) * TAU + rand(-0.25, 0.25),
        dist: rand(0.45, 1.65),
        size: rand(0.45, 1.05),
        delay: rand(0, 0.14)
      });
    }
    const secondaries = [
      { delay: 0.13, ox: rand(-0.9, 0.9), oy: rand(-0.6, 0.6), size: rand(0.55, 0.85) },
      { delay: 0.28, ox: rand(-1.2, 1.2), oy: rand(-0.7, 0.7), size: rand(0.45, 0.75) }
    ];

    explosions.push({
      x: e.x, y: e.y, z: e.z,
      age: 0, maxAge: 3.1,
      radius: Math.max(125, e.size * 2.55),
      flareTilt: rand(-0.18, 0.18),
      lobes,
      secondaries
    });

    // High-velocity glowing sparks with motion-blur trails.
    for (let i = 0; i < 42; i++) {
      const theta = rand(0, TAU), phi = rand(-Math.PI / 2, Math.PI / 2), spd = rand(180, 520);
      const vx = Math.cos(theta) * Math.cos(phi) * spd;
      const vy = Math.sin(phi) * spd + 40;
      const vz = Math.sin(theta) * Math.cos(phi) * spd;
      particles.push({
        kind: 'spark',
        x: e.x, y: e.y, z: e.z,
        px: e.x, py: e.y, pz: e.z,
        vx, vy, vz,
        gravity: 165,
        life: rand(0.45, 1.35), max: 1.35,
        size: rand(4, 11),
        color: Math.random() < 0.5 ? '#ffe7a3' : '#ff9944'
      });
    }

    // Tumbling flaming metal debris trailing smoke.
    for (let i = 0; i < 14; i++) {
      const ang = rand(0, TAU), spd = rand(90, 260);
      particles.push({
        kind: 'debris',
        x: e.x, y: e.y, z: e.z,
        vx: Math.cos(ang) * spd,
        vy: rand(40, 210),
        vz: Math.sin(ang) * spd,
        gravity: 210,
        spin: rand(0, TAU),
        spinSpeed: rand(-8, 8),
        life: rand(1.1, 2.2), max: 2.2,
        size: rand(8, 18)
      });
    }

    // Billowing fire & smoke clouds.
    for (let i = 0; i < 22; i++) {
      const isFire = i < 10;
      particles.push({
        kind: isFire ? 'fire' : 'smoke',
        x: e.x + rand(-35, 35), y: e.y + rand(-35, 35), z: e.z + rand(-35, 35),
        vx: rand(-65, 65), vy: rand(isFire ? -20 : 15, isFire ? 90 : 120), vz: rand(-65, 65),
        gravity: isFire ? -15 : -24,
        life: rand(0.8, 2.5), max: 2.5,
        size: rand(28, 74),
        grow: true,
        additive: isFire,
        alpha: isFire ? 0.9 : 0.65,
        color: isFire ? (Math.random() < 0.5 ? '#ffad4d' : '#ff5e24') : '#292929'
      });
    }

    window.GameAudio?.explosion(dist);
  }

  function impactCity(x, z, radius = 68, isCrash = false) {
    const groundY = 14;
    const dist = Math.hypot(x - player.x, groundY - player.y, z - player.z);
    if (dist < 3200) {
      shake = Math.max(shake, clamp((isCrash ? 2200 : 1200) / Math.max(420, dist), 0.18, isCrash ? 1.05 : 0.62));
      if (isCrash) {
        screenFlash = Math.max(screenFlash, clamp(1400 / Math.max(600, dist), 0.18, 0.58));
      }
    }

    // 1. Collapse 3D WebGL instanced buildings & spawn persistent 3D fire/smoke column
    if (typeof window !== 'undefined' && window.World3D && typeof window.World3D.collapseBuildings === 'function') {
      window.World3D.collapseBuildings(x, z, radius * 1.45);
    }

    // 2. Collapse 2D city buildings near the impact point
    const tileX = Math.round(x / 3600) * 3600;
    const tileZ = Math.floor(z / 4200) * 4200;
    const localX = x - tileX;
    const localZ = z - tileZ;
    let collapsedAny = false;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (Math.hypot(b.x - localX, b.z - localZ) <= radius * 1.35) {
        b.h = Math.max(3.5, b.h * 0.36);
        b.roof = Math.max(1.2, b.roof * 0.25);
        b.smoke = true;
        b.destroyed = true;
        collapsedAny = true;
      }
    }

    // 3. Ground fireball & shockwave explosion
    const lobes = [];
    const lobeCount = isCrash ? 10 : 6;
    for (let i = 0; i < lobeCount; i++) {
      lobes.push({
        ang: (i / lobeCount) * TAU + rand(-0.25, 0.25),
        dist: rand(0.4, 1.5),
        size: rand(0.5, 1.05),
        delay: rand(0, 0.12)
      });
    }
    explosions.push({
      x, y: groundY + 8, z,
      age: 0,
      maxAge: isCrash ? 3.4 : 2.1,
      radius: isCrash ? Math.max(145, radius * 2.2) : Math.max(68, radius * 1.35),
      flareTilt: rand(-0.12, 0.12),
      lobes,
      secondaries: isCrash
        ? [
            { delay: 0.14, ox: rand(-0.8, 0.8), oy: rand(-0.4, 0.5), size: rand(0.6, 0.9) },
            { delay: 0.32, ox: rand(-1.1, 1.1), oy: rand(-0.4, 0.6), size: rand(0.5, 0.8) }
          ]
        : [{ delay: 0.15, ox: rand(-0.6, 0.6), oy: rand(-0.3, 0.4), size: rand(0.45, 0.75) }]
    });

    // 4. Flying masonry, roof tiles, sparks & billowing city smoke
    const debrisCount = isCrash ? 16 : 7;
    for (let i = 0; i < debrisCount; i++) {
      const ang = rand(0, TAU), spd = rand(55, isCrash ? 220 : 135);
      particles.push({
        kind: 'debris',
        x: x + rand(-18, 18), y: groundY + 6, z: z + rand(-18, 18),
        vx: Math.cos(ang) * spd,
        vy: rand(65, isCrash ? 230 : 145),
        vz: Math.sin(ang) * spd,
        gravity: 210,
        spin: rand(0, TAU),
        spinSpeed: rand(-9, 9),
        life: rand(1.0, 2.1), max: 2.1,
        size: rand(7, isCrash ? 18 : 13)
      });
    }

    const smokeCount = isCrash ? 20 : 9;
    for (let i = 0; i < smokeCount; i++) {
      const isFire = i < (isCrash ? 9 : 4);
      particles.push({
        kind: isFire ? 'fire' : 'smoke',
        x: x + rand(-28, 28), y: groundY + rand(4, 24), z: z + rand(-28, 28),
        vx: rand(-45, 45), vy: rand(isFire ? 18 : 28, isFire ? 95 : 135), vz: rand(-45, 45),
        gravity: isFire ? -12 : -26,
        life: rand(1.1, isCrash ? 3.0 : 2.1), max: isCrash ? 3.0 : 2.1,
        size: rand(26, isCrash ? 82 : 54),
        grow: true,
        additive: isFire,
        alpha: isFire ? 0.92 : 0.68,
        color: isFire ? (Math.random() < 0.5 ? '#ffaa44' : '#ff521b') : '#232120'
      });
    }

    // 5. Sound: ground/building destruction + panic screams if nearby
    if (isCrash) {
      if (window.GameAudio?.crashImpact) window.GameAudio.crashImpact(dist);
      else window.GameAudio?.explosion?.(dist);
      if (collapsedAny || dist < 3400) {
        showMessage('NAVE ESTRELLADA · DESTRUCCIÓN EN LA CIUDAD', 1.8);
      }
      if (dist < 2200 && player.y < 460) {
        window.GameAudio?.crowdScream?.(player.y);
      }
    } else if (dist < 3800) {
      if (window.GameAudio?.cityImpact) window.GameAudio.cityImpact(dist);
      else window.GameAudio?.explosion?.(dist);
    }
  }

  function fire() {
    if (player.ammo <= 0 || reload > 0) return;
    player.ammo--;
    nextShot = 0.095;
    muzzleFlash = 1;
    player.recoil = 1;
    window.GameAudio?.shoot();

    // Single aircraft-local cannon origin; keep the current gameplay ballistics.
    const muzzleSpeed = 1050;
    const sx = Math.cos(player.yaw), sz = -Math.sin(player.yaw);
    const side = -1.3;
    const ox = player.x + sx * side, oy = player.y - 0.8, oz = player.z + sz * side;
    const aimPoint = {
      x: player.x + Math.sin(player.yaw)*Math.cos(player.pitch)*3200,
      y: player.y + Math.sin(player.pitch)*3200,
      z: player.z + Math.cos(player.yaw)*Math.cos(player.pitch)*3200
    };
    const adx = aimPoint.x - ox, ady = aimPoint.y - oy, adz = aimPoint.z - oz;
    const alen = Math.hypot(adx, ady, adz) || 1;
    const inheritScale = 1;
    playerShots.push({
      x: ox, y: oy, z: oz,
      px: ox, py: oy, pz: oz,
      vx: (adx / alen) * muzzleSpeed + (player.vx || 0) * inheritScale,
      vy: (ady / alen) * muzzleSpeed + (player.vy || 0) * inheritScale,
      vz: (adz / alen) * muzzleSpeed + (player.vz || 0) * inheritScale,
      life: 6
    });

    if (player.ammo === 0) showMessage('MUNICIÓN AGOTADA · PRESIONÁ R', 2);
  }

  function radioSpeak(callsign, text, duration = 4.2) {
    if (!ui.radioFeed) return;
    if (ui.radioCallsign) ui.radioCallsign.textContent = callsign + ' // VHF';
    if (ui.radioText) ui.radioText.textContent = text;
    ui.radioFeed.hidden = false;
    radioTimer = duration;
    window.GameAudio?.radioClick?.(false);
  }

  function fireMissile() {
    if (state !== 'playing' || !player || player.missiles <= 0 || missileCooldown > 0) return;
    player.missiles--;
    missileCooldown = 0.75;
    missileSide = -missileSide;
    muzzleFlash = Math.max(muzzleFlash, 0.85);
    player.recoil = Math.max(player.recoil, 0.75);
    shake = Math.max(shake, 0.24);
    window.GameAudio?.missileLaunch?.();

    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
    const fx = sy * cp, fy = sp, fz = cy * cp;
    const rx = cy, rz = -sy;
    const ox = player.x + rx * missileSide * 3.8 + fx * 6;
    const oy = player.y - 1.9 + fy * 6;
    const oz = player.z + rz * missileSide * 3.8 + fz * 6;
    const initSpeed = (player.speed || 195) + 210;
    const target = lockedTarget || null;
    missiles.push({
      x: ox, y: oy, z: oz,
      px: ox, py: oy, pz: oz,
      vx: fx * initSpeed, vy: fy * initSpeed - 8, vz: fz * initSpeed,
      speed: initSpeed,
      target: (lockReady || (target && lockProgress > 0.35)) ? target : null,
      life: 7.5,
      age: 0,
      trail: [{ x: ox, y: oy, z: oz }]
    });
    showMessage(target ? 'FOX TWO · AIM-9X EN CAMINO' : 'AIM-9X LANZADO EN BORESIGHT', 1.5);
  }

  function deployFlares() {
    if (state !== 'playing' || !player || player.flares <= 0 || flareCooldown > 0) return;
    player.flares--;
    flareCooldown = 0.9;
    shake = Math.max(shake, 0.16);
    window.GameAudio?.flare?.();

    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
    const fx = sy * cp, fy = sp, fz = cy * cp;
    const rx = cy, rz = -sy;
    for (let i = 0; i < 6; i++) {
      const side = (i % 2 === 0 ? -1 : 1) * rand(18, 52);
      const back = -rand(30, 85);
      flares.push({
        x: player.x - fx * 8 + rx * side * 0.08,
        y: player.y - 2.4,
        z: player.z - fz * 8 + rz * side * 0.08,
        vx: (player.vx || 0) * 0.55 + fx * back + rx * side,
        vy: (player.vy || 0) * 0.45 - rand(22, 58),
        vz: (player.vz || 0) * 0.55 + fz * back + rz * side,
        life: rand(1.9, 2.7),
        max: 2.7
      });
    }
    // Confuse & deflect nearby incoming hostile fire toward the hot flare cloud.
    let deflected = 0;
    for (const s of shots) {
      if (s.groundTarget) continue;
      const d = Math.hypot(s.x - player.x, s.y - player.y, s.z - player.z);
      if (d < 920) {
        s.vx += rand(-260, 260);
        s.vy -= rand(120, 240);
        s.vz += rand(-260, 260);
        s.groundTarget = true;
        deflected++;
      }
    }
    showMessage(deflected ? 'BENGALAS · AMENAZA DESVIADA' : 'BENGALAS DESPLEGADAS', 1.3);
  }

  function hitEnemy(e, heavy = false) {
      e.hp -= heavy ? e.hp : 1;
      e.hitTimer = 0.28;
      hitFlash = heavy ? 0.36 : 0.22;
      window.GameAudio?.hit();
      for (let i = 0; i < (heavy ? 18 : 10); i++) {
        particles.push({
          kind: 'spark',
          x: e.x, y: e.y, z: e.z,
          px: e.x, py: e.y, pz: e.z,
          vx: rand(-180, 180), vy: rand(-140, 180), vz: rand(-180, 180),
          gravity: 90,
          life: 0.4, max: 0.4,
          size: heavy ? 9 : 7,
          color: '#ffe4a6'
        });
      }
      if (e.hp <= 0) {
        burst(e);
        // Brief dramatic kill slow-motion for Hollywood impact feel.
        slowMoTimer = 0.24;
        // Spawn a flaming, spinning ship wreck that plummets under gravity and crashes into the city below.
        wrecks.push({
          x: e.x, y: e.y, z: e.z,
          vx: (e.vx || 0) * 0.58 + rand(-38, 38),
          vy: Math.min(-48, (e.vy || 0) - rand(55, 95)),
          vz: (e.vz || 0) * 0.58 + rand(-38, 38),
          type: e.type,
          variant: e.variant,
          size: e.size || 74,
          yaw: Math.atan2(e.vx || 0, e.vz || 1),
          bank: e.bank || 0,
          spin: 0,
          spinSpeed: rand(2.8, 5.4) * (Math.random() < 0.5 ? -1 : 1),
          trailTimer: 0
        });
        enemies.splice(enemies.indexOf(e), 1);
        if (lockedTarget === e) {
          lockedTarget = null;
          lockProgress = 0;
          lockReady = false;
        }
        kills++;
        showMessage('OBJETO ABATIDO · CAYENDO SOBRE LA CIUDAD', 1.7);
        const callouts = {
          1: '«¡Splash uno! ¡Está cayendo en llamas sobre Núremberg!»',
          3: '«Esas naves nodriza bloquean el cielo... ¡seguí presionando, te cubro las seis!»',
          6: '«¡Mitad de la formación derribada! ¡Mantené la energía alta!»',
          9: '«¡Quedan tres anomalías! Usá los AIM-9X para cerrarlas.»',
          11: '«¡Último contacto en pantalla! ¡Despejemos este cielo!»'
        };
        if (callouts[kills]) radioSpeak('ARG-062', callouts[kills], 4.2);
        if (kills >= 12) finish(true);
      }
  }

  function showMessage(s, t) {
    ui.message.textContent = s;
    msgTimer = t;
  }

  function updateUI() {
    ui.health.innerHTML = Math.max(0, Math.ceil(player.health)) + '<span>%</span>';
    ui.healthbar.style.width = Math.max(0, player.health) + '%';
    ui.ammo.innerHTML = player.ammo + '<span> / 40</span>';
    ui.ammobar.style.width = (player.ammo / 40 * 100) + '%';
    ui.weapon.textContent = reload > 0 ? 'RECARGANDO...' : player.ammo ? (lockReady ? 'AIM-9X LOCK' : lockedTarget ? 'BLANCO FIJADO' : 'SISTEMA LISTO') : 'RECARGA NECESARIA';
    ui.kills.innerHTML = String(kills).padStart(2, '0') + ' <span>/ 12</span>';
    ui.speed.innerHTML = Math.round(player.speed * 1.94384) + ' <span>KT</span>';
    if (ui.missiles) ui.missiles.textContent = String(player.missiles ?? 0);
    if (ui.flares) ui.flares.textContent = String(player.flares ?? 0);
    if (ui.missileChip?.classList) {
      ui.missileChip.classList.toggle('ready', Boolean(lockReady && player.missiles > 0));
      ui.missileChip.classList.toggle('empty', (player.missiles ?? 0) <= 0);
    }
    if (ui.flareChip?.classList) {
      ui.flareChip.classList.toggle('empty', (player.flares ?? 0) <= 0);
    }
    if (ui.crosshair?.classList) {
      ui.crosshair.classList.toggle('locked', Boolean(lockReady));
    }
    if (ui.radar) {
      ui.radar.textContent = boost > 0.35 ? 'POSTCOMBUSTIÓN ACTIVA' : lockReady ? 'BLOQUEO IR ACTIVO' : lockedTarget ? 'SEGUIMIENTO ACTIVO' : 'RADAR LARGO ALCANCE';
    }
    const sec = Math.floor(time);
    ui.clock.textContent = '06:' + String(12 + Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    ui.hit.style.opacity = hitFlash > 0 ? '1' : '0';
    ui.damage.style.opacity = String(damageFlash);
  }

  function finish(win) {
    state = 'end';
    ui.intro.hidden = true;
    firing = false;
    keys = {};
    ui.pause.hidden = true;
    if (ui.radioFeed) ui.radioFeed.hidden = true;
    hitFlash = damageFlash = muzzleFlash = screenFlash = shake = 0;
    slowMoTimer = 0;
    ui.hit.style.opacity = '0';
    ui.damage.style.opacity = '0';
    canvas.hidden = true;
    const worldCanvas = $('world3d');
    if (worldCanvas) worldCanvas.hidden = true;
    if (document.pointerLockElement) document.exitPointerLock();
    window.GameAudio?.stop();
    if (win) window.GameAudio?.victory();
    else window.GameAudio?.defeat();
    ui.hud.hidden = true;
    ui.end.hidden = false;
    $('end-title').textContent = win ? 'CIELO DESPEJADO' : 'AERONAVE PERDIDA';
    $('end-text').textContent = win
      ? 'Las anomalías colapsan en fuego sobre el amanecer. Núremberg sigue en pie; el origen del portal permanece sin respuesta.'
      : 'Tu aeronave no resistió el fuego celeste. La anomalía sigue abierta sobre Núremberg.';
    $('end-score').textContent = String(kills).padStart(2, '0') + ' / 12';
  }

  function isControlActive() {
    return document.pointerLockElement === canvas || pointerLockFallback;
  }

  function update(rawDt) {
    if (state !== 'playing' || !isControlActive() || rawDt <= 0) return;
    if (slowMoTimer > 0) slowMoTimer = Math.max(0, slowMoTimer - rawDt);
    const dt = slowMoTimer > 0 ? rawDt * 0.44 : rawDt;
    time += dt;
    nextShot -= dt;
    missileCooldown = Math.max(0, missileCooldown - dt);
    flareCooldown = Math.max(0, flareCooldown - dt);
    warningTimer = Math.max(0, warningTimer - rawDt);
    gStrainTimer = Math.max(0, gStrainTimer - rawDt);
    flybyTimer = Math.max(0, flybyTimer - rawDt);
    lowAltTimer = Math.max(0, lowAltTimer - rawDt);
    if (radioTimer > 0 && (radioTimer -= rawDt) <= 0) {
      if (ui.radioFeed) ui.radioFeed.hidden = true;
      window.GameAudio?.radioClick?.(true);
    }
    if (player.missiles < 6) {
      missileRegen += dt;
      if (missileRegen >= 16) {
        missileRegen = 0;
        player.missiles++;
        showMessage('AIM-9X REABASTECIDO', 1.2);
      }
    } else {
      missileRegen = 0;
    }
    hitFlash = Math.max(0, hitFlash - dt);
    muzzleFlash = Math.max(0, muzzleFlash - dt * 9);
    damageFlash = Math.max(0, damageFlash - dt * 0.9);
    screenFlash = Math.max(0, screenFlash - dt * 1.9);
    shake = Math.max(0, shake - dt * 1.45);
    player.recoil = Math.max(0, player.recoil - dt * 6);

    if (msgTimer > 0 && (msgTimer -= dt) <= 0) {
      ui.message.textContent = 'IDENTIFICÁ Y DESTRUÍ LOS OBJETOS EN EL HORIZONTE';
    }
    if (reload > 0 && (reload -= dt) <= 0) player.ammo = 40;
    if (firing && nextShot <= 0) fire();
    if (state !== 'playing') return;

    const afterburner = Boolean(keys.ShiftLeft || keys.ShiftRight);
    const targetThrottle = afterburner ? 1.0 : keys.KeyW ? 0.84 : keys.KeyS ? 0.22 : 0.58;
    player.throttle += (targetThrottle - player.throttle) * Math.min(1, dt * 4.2);
    boost += ((afterburner ? 1 : 0) - boost) * Math.min(1, dt * 3.5);

    // Fly-by-wire angular rates, inertia, and roll-induced yaw turn coordination.
    const strafeInput = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    player.targetRoll = clamp(yawInput * 0.62 + strafeInput * 0.62, -0.82, 0.82);
    const rollAccel = (player.targetRoll - player.roll) * 28 - player.rollRate * 9.2;
    player.rollRate += rollAccel * dt;
    player.roll = clamp(player.roll + player.rollRate * dt, -0.95, 0.95);

    const speedFactor = clamp(player.speed / 195, 0.55, 1.45);
    const coordTurnRate = Math.sin(player.roll) * 0.46 * speedFactor + strafeInput * 0.14;
    const targetYawRate = yawMomentum + coordTurnRate;
    const targetPitchRate = pitchMomentum - (1 - Math.cos(player.roll)) * 0.06;

    const rateBlend = Math.min(1, dt * 16);
    player.yawRate += (targetYawRate - player.yawRate) * rateBlend;
    player.pitchRate += (targetPitchRate - player.pitchRate) * rateBlend;

    player.yaw += player.yawRate * dt;
    player.pitch = clamp(player.pitch + player.pitchRate * dt, -0.82, 0.92);

    const fbDecay = Math.exp(-14 * dt);
    yawMomentum *= fbDecay;
    pitchMomentum *= fbDecay;
    yawInput *= Math.exp(-9.5 * dt);

    // 6-DOF airspeed, gravity pitch coupling, G-induced drag & 3D velocity vector.
    const prevVx = player.vx, prevVy = player.vy, prevVz = player.vz;
    const gDrag = Math.max(0, player.gForce - 1.4) * 3.2;
    const baseTargetSpeed = afterburner ? 320 : keys.KeyW ? 250 : keys.KeyS ? 130 : 195;
    const targetSpeed = clamp(baseTargetSpeed - Math.sin(player.pitch) * 26 - gDrag, 110, 355);
    player.speed += (targetSpeed - player.speed) * Math.min(1, dt * 1.45);
    focal = lerp(baseFocal, baseFocal * 0.89, boost);

    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
    const fx = sy * cp, fy = sp, fz = cy * cp;
    const rx = cy, ry = 0, rz = -sy;
    const ux = -sy * sp, uy = cp, uz = -cy * sp;

    const slipVel = strafeInput * 42;
    const tvx = fx * player.speed + rx * slipVel;
    const tvy = fy * player.speed;
    const tvz = fz * player.speed + rz * slipVel;

    const aeroLag = Math.min(1, dt * (5.2 + speedFactor * 1.6));
    player.vx += (tvx - player.vx) * aeroLag;
    player.vy += (tvy - player.vy) * aeroLag;
    player.vz += (tvz - player.vz) * aeroLag;

    player.x += player.vx * dt;
    player.z += player.vz * dt;
    const nextY = player.y + player.vy * dt;
    if (nextY <= 85) {
      player.y = 85;
      if (player.vy < 0) player.vy *= 0.25;
    } else if (nextY >= 1800) {
      player.y = 1800;
      if (player.vy > 0) player.vy *= 0.25;
    } else {
      player.y = nextY;
    }

    // Angle of attack (AoA), sideslip, G-force & subtle high-G aerodynamic buffet.
    const vf = player.vx * fx + player.vy * fy + player.vz * fz;
    const vr = player.vx * rx + player.vy * ry + player.vz * rz;
    const vu = player.vx * ux + player.vy * uy + player.vz * uz;

    const targetAoa = clamp(Math.atan2(-vu, Math.max(20, vf)) + 0.025, -0.38, 0.52);
    const targetSlip = clamp(Math.atan2(vr, Math.max(20, Math.hypot(vf, vu))), -0.35, 0.35);
    player.aoa += (targetAoa - player.aoa) * Math.min(1, dt * 10);
    player.slip += (targetSlip - player.slip) * Math.min(1, dt * 10);

    const ax = (player.vx - prevVx) / dt;
    const ay = (player.vy - prevVy) / dt + 9.81;
    const az = (player.vz - prevVz) / dt;
    const cr = Math.cos(player.roll), sr = Math.sin(player.roll);
    const liftX = ux * cr + rx * sr;
    const liftY = uy * cr + ry * sr;
    const liftZ = uz * cr + rz * sr;
    const rawG = (ax * liftX + ay * liftY + az * liftZ) / 9.81;
    const pitchCentripetal = (player.speed * player.pitchRate) / 9.81;
    const targetG = clamp(rawG + pitchCentripetal * 0.35, -3.0, 9.0);
    player.gForce += (targetG - player.gForce) * Math.min(1, dt * 7.5);

    const highG = Math.max(0, Math.abs(player.gForce) - 2.8);
    const highAoa = Math.max(0, Math.abs(player.aoa) - 0.14);
    player.buffet = clamp(highG * 0.045 + highAoa * 0.48 + boost * 0.035, 0, 0.32);
    if (player.buffet > 0.02) {
      shake = Math.max(shake, player.buffet * 0.35);
    }

    if ((audioTimer -= dt) <= 0) {
      window.GameAudio?.setEngine(clamp((player.speed - 130) / 190, 0, 1), player.gForce, boost);
      audioTimer = 0.14;
    }
    if (Math.abs(player.gForce) > 4.6 && gStrainTimer <= 0) {
      gStrainTimer = 2.1;
      window.GameAudio?.gStrain?.(player.gForce);
    }
    if (player.y < 105 && lowAltTimer <= 0 && time > 6) {
      lowAltTimer = 11;
      radioSpeak('ARG-062', '«¡Pull up! ¡Estás rozando los tejados de Núremberg!»', 3.2);
    }

    // Periodic crowd screams & panic from the streets when flying low over Nuremberg.
    if (player.y < 310) {
      screamTimer -= dt;
      if (screamTimer <= 0) {
        screamTimer = rand(3.2, 6.2);
        window.GameAudio?.crowdScream?.(player.y);
      }
    }

    // Record wingman contrail breadcrumbs.
    if (Math.floor(time * 24) !== Math.floor((time - dt) * 24)) {
      const wp = getWingmanPos(0);
      wingmanTrail.push({ x: wp.x, y: wp.y, z: wp.z, bank: wp.bank });
      if (wingmanTrail.length > 26) wingmanTrail.shift();
    }

    spawnTimer -= dt;
    if (enemies.length < 7 && spawnTimer <= 0) {
      spawn();
      spawnTimer = 1.2;
    }

    // Update distant celestial spheres with 3D orbital kinematics & find closest reticle target.
    let bestTarget = null, bestScore = Math.max(50, Math.min(w, h) * 0.08);
    for (const e of enemies) {
      e.phase += dt * e.orbitSpeed;
      e.ringPhase += dt * 1.4;
      e.hitTimer = Math.max(0, e.hitTimer - dt);

      const dx = player.x - e.x, dy = player.y - e.y, dz = player.z - e.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const hDist = Math.hypot(dx, dz) || 1;
      const nx = dx / hDist, nz = dz / hDist;
      const tx = -nz * e.orbitDir, tz = nx * e.orbitDir;

      // Each target follows its own world-space route, independent of camera heading.
      const routeAngle=e.routeHeading+e.phase*e.orbitDir;
      const targetX=e.routeX+Math.cos(routeAngle)*e.routeRadius;
      const targetZ=e.routeZ+Math.sin(routeAngle)*e.routeRadius;
      const tvx=clamp((targetX-e.x)*.65,-e.orbitTanSpeed,e.orbitTanSpeed);
      const tvz=clamp((targetZ-e.z)*.65,-e.orbitTanSpeed,e.orbitTanSpeed);
      const tvy=clamp((e.routeY+Math.sin(e.phase*1.35)*e.verticalAmp-e.y)*.7,-45,45);

      const prevEvx = e.vx, prevEvz = e.vz;
      const accelRate = Math.min(1, dt * (e.type === 'fighter' ? 3.4 : e.type === 'cylinder' ? 1.6 : 2.4));
      e.vx += (tvx - e.vx) * accelRate;
      e.vy += (tvy - e.vy) * accelRate;
      e.vz += (tvz - e.vz) * accelRate;

      e.x += e.vx * dt;
      e.y = clamp(e.y + e.vy * dt, 240, 1500);
      e.z += e.vz * dt;

      const eax = (e.vx - prevEvx) / dt;
      const eaz = (e.vz - prevEvz) / dt;
      const vHoriz = Math.hypot(e.vx, e.vz) || 1;
      const latAccel = (eax * e.vz - eaz * e.vx) / vHoriz;
      const maxBank = e.type === 'fighter' ? 0.92 : 0.58;
      const targetBank = clamp(Math.atan2(latAccel, 18) + e.orbitDir * 0.14 * Math.sin(e.phase * 0.5), -maxBank, maxBank);
      e.bank += (targetBank - e.bank) * Math.min(1, dt * (e.type === 'fighter' ? 6.2 : 4.5));

      // Damage smoke trail for wounded spheres/fighters in the distance.
      if (e.hp < e.maxHp) {
        e.smokeTimer -= dt;
        if (e.smokeTimer <= 0) {
          e.smokeTimer = 0.14;
          particles.push({
            kind: 'smoke',
            x: e.x, y: e.y, z: e.z,
            vx: rand(-15, 15), vy: rand(8, 25), vz: rand(-15, 15),
            gravity: -10,
            life: 1.4, max: 1.4,
            size: rand(18, 32),
            grow: true,
            alpha: 0.45,
            color: '#2c2b2b'
          });
        }
      }

      e.attack -= dt;
      e.charge = e.attack < 1.5 ? clamp((1.5 - e.attack) / 1.5, 0, 1) : 0;
      if (e.attack <= 0 && dist < 4800) {
        e.attack = rand(4.5, 8.2);
        e.charge = 0;
        const shotSpeed = 560;
        shots.push({
          x: e.x, y: e.y, z: e.z,
          px: e.x, py: e.y, pz: e.z,
          vx: (dx / dist) * shotSpeed,
          vy: (dy / dist) * shotSpeed,
          vz: (dz / dist) * shotSpeed,
          life: 10
        });
      }

      // Enemy ships also bombard the city below with downward plasma salvos that destroy buildings on impact.
      if (e.attack < 50) {
        e.cityAttack = (e.cityAttack ?? 4.0) - dt;
        if (e.cityAttack <= 0 && dist < 5200) {
          e.cityAttack = rand(4.2, 8.5);
          const bx = e.x + rand(-260, 260) - e.x;
          const by = 8 - e.y;
          const bz = e.z + rand(-260, 260) - e.z;
          const blen = Math.hypot(bx, by, bz) || 1;
          const bSpeed = 520;
          shots.push({
            x: e.x, y: e.y, z: e.z,
            px: e.x, py: e.y, pz: e.z,
            vx: (bx / blen) * bSpeed,
            vy: (by / blen) * bSpeed,
            vz: (bz / blen) * bSpeed,
            groundTarget: true,
            life: 9
          });
        }
      }

      if (dist > 6400 || dist < 950) {
        const a = player.yaw + rand(-0.72, 0.72);
        const respawnDist = rand(2400, 4400);
        e.x = player.x + Math.sin(a) * respawnDist;
        e.z = player.z + Math.cos(a) * respawnDist;
        e.y = clamp(player.y + rand(-60, 420), 250, 1450);
        e.routeX=e.x;e.routeZ=e.z;e.routeY=e.y;
        initEnemyOrbitalVelocity(e);
        e.bank = 0;
      }

      const proj = project(e.x, e.y, e.z);
      if (proj) {
        let dScreen = Math.hypot(proj.x - w / 2, proj.y - h / 2);
        if (e === lockedTarget) dScreen -= 18;
        if (dScreen < bestScore) {
          bestScore = dScreen;
          bestTarget = e;
        }
      }

      // Close-pass Doppler flyby when an enemy fighter screams past the canopy.
      if (e.type === 'fighter' && dist < 440 && flybyTimer <= 0) {
        flybyTimer = 2.4;
        shake = Math.max(shake, 0.28);
        window.GameAudio?.flyby?.(clamp(1.2 - dist / 460, 0.35, 1.1));
      }
    }
    lockedTarget = bestTarget;

    // Progressive AIM-9X IR seeker lock acquisition & Sidewinder audio tone.
    if (lockedTarget && player.missiles > 0) {
      if (lockedTarget !== prevLockTarget) {
        lockProgress = Math.max(0.15, lockProgress * 0.3);
        prevLockTarget = lockedTarget;
      }
      lockProgress = clamp(lockProgress + dt * 1.18, 0, 1);
      lockReady = lockProgress >= 0.98;
    } else {
      lockProgress = Math.max(0, lockProgress - dt * 2.2);
      lockReady = false;
      if (lockProgress <= 0.01) prevLockTarget = null;
    }
    window.GameAudio?.setLock?.(lockProgress, lockReady);

    // Update guided AIM-9X missiles (proportional navigation + rocket smoke trail).
    for (let i = missiles.length - 1; i >= 0; i--) {
      const ms = missiles[i];
      ms.px = ms.x; ms.py = ms.y; ms.pz = ms.z;
      ms.age += dt;
      ms.life -= dt;
      ms.speed = Math.min(1260, ms.speed + 680 * dt);

      if (ms.target && enemies.includes(ms.target)) {
        const tgt = ms.target;
        const distT = Math.hypot(tgt.x - ms.x, tgt.y - ms.y, tgt.z - ms.z) || 1;
        const tLead = clamp(distT / ms.speed, 0, 1.6);
        const ax = (tgt.x + (tgt.vx || 0) * tLead) - ms.x;
        const ay = (tgt.y + (tgt.vy || 0) * tLead) - ms.y;
        const az = (tgt.z + (tgt.vz || 0) * tLead) - ms.z;
        const alen = Math.hypot(ax, ay, az) || 1;
        const curLen = Math.hypot(ms.vx, ms.vy, ms.vz) || 1;
        const turnRate = clamp(dt * (ms.age < 0.25 ? 2.8 : 7.5), 0, 1);
        const dxN = lerp(ms.vx / curLen, ax / alen, turnRate);
        const dyN = lerp(ms.vy / curLen, ay / alen, turnRate);
        const dzN = lerp(ms.vz / curLen, az / alen, turnRate);
        const nLen = Math.hypot(dxN, dyN, dzN) || 1;
        ms.vx = (dxN / nLen) * ms.speed;
        ms.vy = (dyN / nLen) * ms.speed;
        ms.vz = (dzN / nLen) * ms.speed;
      } else {
        const curLen = Math.hypot(ms.vx, ms.vy, ms.vz) || 1;
        ms.vx = (ms.vx / curLen) * ms.speed;
        ms.vy = (ms.vy / curLen) * ms.speed;
        ms.vz = (ms.vz / curLen) * ms.speed;
      }

      ms.x += ms.vx * dt;
      ms.y += ms.vy * dt;
      ms.z += ms.vz * dt;
      ms.trail.push({ x: ms.x, y: ms.y, z: ms.z });
      if (ms.trail.length > 18) ms.trail.shift();

      const dx = ms.x - ms.px, dy = ms.y - ms.py, dz = ms.z - ms.pz;
      const len = dx * dx + dy * dy + dz * dz;
      let struck = null, best = Infinity;
      for (const e of enemies) {
        const u = clamp(((e.x - ms.px) * dx + (e.y - ms.py) * dy + (e.z - ms.pz) * dz) / (len || 1), 0, 1);
        if (u < best && Math.hypot(ms.px + u * dx - e.x, ms.py + u * dy - e.y, ms.pz + u * dz - e.z) < e.size * 1.15) {
          struck = e;
          best = u;
        }
      }
      if (struck) {
        hitEnemy(struck, true);
        missiles.splice(i, 1);
        continue;
      }
      if (ms.y <= 16) {
        impactCity(ms.x, ms.z, 76, true);
        missiles.splice(i, 1);
        continue;
      }
      if (ms.life <= 0) missiles.splice(i, 1);
    }

    // Update countermeasure flares falling behind the aircraft.
    for (let i = flares.length - 1; i >= 0; i--) {
      const fl = flares[i];
      const drag = Math.max(0, 1 - 0.85 * dt);
      fl.vx *= drag; fl.vz *= drag;
      fl.vy -= 42 * dt;
      fl.x += fl.vx * dt;
      fl.y += fl.vy * dt;
      fl.z += fl.vz * dt;
      fl.life -= dt;
      if (fl.life <= 0 || fl.y <= 12) flares.splice(i, 1);
    }

    // Update falling, burning enemy ship wrecks until they crash into Nuremberg and demolish buildings.
    for (let i = wrecks.length - 1; i >= 0; i--) {
      const wr = wrecks[i];
      wr.vy -= 148 * dt;
      wr.x += wr.vx * dt;
      wr.y += wr.vy * dt;
      wr.z += wr.vz * dt;
      wr.spin += wr.spinSpeed * dt;
      wr.bank += wr.spinSpeed * 0.75 * dt;

      wr.trailTimer -= dt;
      if (wr.trailTimer <= 0) {
        wr.trailTimer = 0.045;
        particles.push({
          kind: 'smoke',
          x: wr.x + rand(-14, 14), y: wr.y + rand(-10, 10), z: wr.z + rand(-14, 14),
          vx: rand(-22, 22), vy: rand(12, 38), vz: rand(-22, 22),
          gravity: -16,
          life: 1.65, max: 1.65,
          size: rand(24, 48),
          grow: true,
          alpha: 0.62,
          color: '#22201f'
        });
        particles.push({
          kind: 'fire',
          x: wr.x + rand(-10, 10), y: wr.y + rand(-8, 8), z: wr.z + rand(-10, 10),
          vx: rand(-18, 18), vy: rand(8, 28), vz: rand(-18, 18),
          gravity: -10,
          life: 0.55, max: 0.55,
          size: rand(18, 36),
          grow: true,
          additive: true,
          alpha: 0.88,
          color: Math.random() < 0.5 ? '#ffae42' : '#ff551e'
        });
      }

      if (wr.y <= 16) {
        impactCity(wr.x, wr.z, Math.max(78, (wr.size || 72) * 1.35), true);
        wrecks.splice(i, 1);
      }
    }

    for (let i = playerShots.length - 1; i >= 0; i--) {
      const s = playerShots[i];
      s.px = s.x; s.py = s.y; s.pz = s.z;
      s.vy -= 9.81 * dt;
      const drag = Math.max(0, 1 - 0.04 * dt);
      s.vx *= drag; s.vy *= drag; s.vz *= drag;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      s.life -= dt;
      // Swept segment prevents fast rounds tunnelling through a target.
      const dx=s.x-s.px,dy=s.y-s.py,dz=s.z-s.pz,len=dx*dx+dy*dy+dz*dz;
      let struck=null,best=Infinity;
      for(const e of enemies){
        const u=clamp(((e.x-s.px)*dx+(e.y-s.py)*dy+(e.z-s.pz)*dz)/(len||1),0,1);
        if(u<best && Math.hypot(s.px+u*dx-e.x,s.py+u*dy-e.y,s.pz+u*dz-e.z)<e.size*.8){struck=e;best=u;}
      }
      if(struck){hitEnemy(struck);playerShots.splice(i,1);continue;}
      if (s.y <= 16) {
        impactCity(s.x, s.z, 36, false);
        playerShots.splice(i, 1);
        continue;
      }
      if (s.life <= 0) playerShots.splice(i, 1);
    }

    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.px = s.x; s.py = s.y; s.pz = s.z;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      s.life -= dt;
      if (s.y <= 18) {
        impactCity(s.x, s.z, 58, false);
        shots.splice(i, 1);
        continue;
      }
      // Relative swept collision accounts for both aircraft and round motion.
      const rx=s.px-(player.x-player.vx*dt),ry=s.py-(player.y-player.vy*dt),rz=s.pz-(player.z-player.vz*dt);
      const dx=(s.vx-player.vx)*dt,dy=(s.vy-player.vy)*dt,dz=(s.vz-player.vz)*dt;
      const u=clamp(-(rx*dx+ry*dy+rz*dz)/(dx*dx+dy*dy+dz*dz||1),0,1);
      const missDistance=Math.hypot(rx+dx*u,ry+dy*u,rz+dz*u);
      const vx=s.vx-player.vx,vy=s.vy-player.vy,vz=s.vz-player.vz;
      const ax=s.x-player.x,ay=s.y-player.y,az=s.z-player.z;
      const approach=-(ax*vx+ay*vy+az*vz)/(vx*vx+vy*vy+vz*vz||1);
      if(!s.groundTarget&&approach>0&&approach<2.2&&Math.hypot(ax+vx*approach,ay+vy*approach,az+vz*approach)<75) {
        showMessage('FUEGO ENTRANTE · VIRÁ / BENGALAS [F]',.3);
        if (warningTimer <= 0) {
          warningTimer = 1.45;
          window.GameAudio?.warningTone?.();
        }
      }
      if (!s.groundTarget && missDistance >= 12 && missDistance < 58 && !s.whooshed && flybyTimer <= 0) {
        s.whooshed = true;
        flybyTimer = 0.7;
        shake = Math.max(shake, 0.22);
        window.GameAudio?.flyby?.(clamp(1.1 - missDistance / 65, 0.35, 0.95));
      }
      if (!s.groundTarget && missDistance < 12) {
        player.health -= rand(7, 13);
        damageFlash = 0.72;
        shake = Math.max(shake, 0.65);
        showMessage('IMPACTO RECIBIDO · MANIOBRA EVASIVA', 1.2);
        window.GameAudio?.damage();
        shots.splice(i, 1);
        if (player.health <= 0) {
          finish(false);
          return;
        }
      } else if (s.life <= 0) {
        shots.splice(i, 1);
      }
    }

    for (let i = explosions.length - 1; i >= 0; i--) {
      explosions[i].age += dt;
      if (explosions[i].age >= explosions[i].maxAge) explosions.splice(i, 1);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.gravity) p.vy -= p.gravity * dt;
      p.life -= dt;

      // Trailing smoke wisps off falling debris chunks.
      if (p.kind === 'debris' && Math.random() < 0.45) {
        particles.push({
          kind: 'smoke',
          x: p.x, y: p.y, z: p.z,
          vx: rand(-12, 12), vy: rand(6, 18), vz: rand(-12, 12),
          gravity: -10,
          life: 0.75, max: 0.75,
          size: rand(12, 24),
          grow: true,
          alpha: 0.42,
          color: '#343230'
        });
      }
      if (p.life <= 0) particles.splice(i, 1);
    }

    updateUI();
  }

  function requestLockSafe() {
    if (!canvas.requestPointerLock) return;
    try {
      const result = canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          // Graceful fallback for embedded/sandboxed webviews where Pointer Lock is blocked.
          if (state === 'playing') {
            pointerLockFallback = true;
            ui.pause.hidden = true;
            needsRedraw = true;
            window.GameAudio?.start();
          }
        });
      }
    } catch (_) {
      if (state === 'playing') {
        pointerLockFallback = true;
        ui.pause.hidden = true;
        needsRedraw = true;
        window.GameAudio?.start();
      }
    }
  }

  function loop(t) {
    const dt = Math.min((t - last) / 1000 || 0, 0.05);
    last = t;
    update(dt);
    if (state !== 'end' && (needsRedraw || (state === 'playing' && isControlActive()))) {
      draw();
      needsRedraw = false;
    }
    requestAnimationFrame(loop);
  }

  function start() {
    reset();
    pointerLockFallback = false;
    state = 'playing';
    needsRedraw = true;
    canvas.hidden = false;
    const worldCanvas = $('world3d');
    if (worldCanvas) worldCanvas.hidden = false;
    ui.pause.hidden = true;
    ui.intro.hidden = true;
    ui.end.hidden = true;
    ui.hud.hidden = false;
    if (ui.cinemaFade?.classList) {
      ui.cinemaFade.classList.add('active');
      requestAnimationFrame(() => ui.cinemaFade?.classList?.remove('active'));
    }
    window.GameAudio?.start();
    radioSpeak('ARG-062', '«Contacto visual sobre Núremberg... no figuran en ningún radar. ¡Armas libres, ARG-061!»', 5.0);
    requestLockSafe();
  }

  $('start').addEventListener('click', start);
  $('restart').addEventListener('click', start);
  $('graphics-quality')?.addEventListener?.('change', function () {
    window.World3D?.setQuality?.(this.value);
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('click', () => {
    if (state === 'playing' && !isControlActive()) {
      window.GameAudio?.start();
      requestLockSafe();
    }
  });
  addEventListener('mousemove', e => {
    if (state === 'playing' && isControlActive()) {
      let mx = e.movementX || 0;
      let my = e.movementY || 0;
      if (pointerLockFallback && document.pointerLockElement !== canvas) {
        if (lastMouseX !== null && lastMouseY !== null) {
          mx = clamp((e.clientX ?? lastMouseX) - lastMouseX, -60, 60);
          my = clamp((e.clientY ?? lastMouseY) - lastMouseY, -60, 60);
        }
        lastMouseX = e.clientX ?? lastMouseX;
        lastMouseY = e.clientY ?? lastMouseY;
      }
      const dyaw = mx * 0.0024;
      const dpitch = -my * 0.0024;
      player.yaw += dyaw * 0.55;
      player.pitch = clamp(player.pitch + dpitch * 0.55, -0.82, 0.92);
      yawMomentum = clamp(yawMomentum + dyaw * 6.5, -2.2, 2.2);
      pitchMomentum = clamp(pitchMomentum + dpitch * 6.5, -1.8, 1.8);
      yawInput = clamp(yawInput + dyaw * 24, -1.4, 1.4);
    }
  });
  addEventListener('mousedown', e => {
    if (state === 'playing' && isControlActive()) {
      if (e.button === 0) firing = true;
      else if (e.button === 2) fireMissile();
    }
  });
  addEventListener('mouseup', e => {
    if (!e || e.button === 0 || e.button === undefined) firing = false;
  });
  addEventListener('blur', () => { keys = {}; firing = false; lastMouseX = lastMouseY = null; });
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
    if (state === 'playing' && e.code === 'KeyR' && reload <= 0 && player.ammo < 40) {
      reload = 1.3;
      showMessage('RECARGANDO CAÑÓN', 1.3);
      window.GameAudio?.reload();
    }
    if (state === 'playing' && (e.code === 'KeyE' || e.code === 'Space') && !e.repeat && isControlActive()) {
      fireMissile();
    }
    if (state === 'playing' && (e.code === 'KeyF' || e.code === 'KeyQ') && !e.repeat && isControlActive()) {
      deployFlares();
    }
    if (state === 'playing' && e.code === 'KeyM' && !e.repeat) {
      muted = !muted;
      window.GameAudio?.setEnabled(!muted);
      showMessage(muted ? 'SONIDO DESACTIVADO' : 'SONIDO ACTIVADO', 1.5);
    }
  });
  addEventListener('keyup', e => keys[e.code] = false);
  document.addEventListener('pointerlockchange', () => {
    firing = false;
    needsRedraw = true;
    const cursorCaptured = document.pointerLockElement === canvas;
    if (cursorCaptured) pointerLockFallback = false;
    canvas.classList?.toggle('cursor-captured', cursorCaptured);
    ui.pause.hidden = state !== 'playing' || cursorCaptured || pointerLockFallback;
    if (state === 'playing') {
      if (cursorCaptured || pointerLockFallback) window.GameAudio?.start();
      else { keys = {}; window.GameAudio?.stop(); }
    }
  });
  document.addEventListener('pointerlockerror', () => {
    if (state === 'playing' && !pointerLockFallback) {
      firing = false;
      keys = {};
      ui.pause.hidden = false;
      window.GameAudio?.stop();
    }
  });

  reset();requestAnimationFrame(loop);
})();
