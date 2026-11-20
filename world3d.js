/* World renderer. The X reflection keeps game-space +Z aligned with the HUD. */
(() => {
  'use strict';
  let gpu, scene, camera, sun, explosionLight, ready = false, failed = false, width = 0, height = 0;
  let scale = 1, average = 16.7, last = 0, frames = 0;
  let quality = 'auto';
  let shadowX = Infinity, shadowZ = Infinity;
  let carrier, dreadnought1, dreadnought2, wingmanMesh;
  let urbanDistricts, postPipeline;
  let riverController = null, vfxSystem = null, cockpitRig = null;
  let cachedArmorMap = null, cachedArmorPBR = null;
  const enemyPools = { sphere: [], fighter: [], cylinder: [], cross: [] };

  const T = window.THREE;
  if (!T) return;
  const sunElevation = (window.FranconiaSky?.sunElevation ?? 17.4) * Math.PI / 180;
  const sunDirection = new T.Vector3(-0.49, Math.tan(sunElevation) * Math.hypot(0.49, 0.82), 0.82).normalize();
  const renderSunDirection = new T.Vector3(-sunDirection.x, sunDirection.y, sunDirection.z);

  const riverX = z => 170 * Math.sin(z * 0.0018);

  const relief = window.FranconiaRelief;

  function regionalElevation(x, z) {
    if (!relief) {
      return 90 + 55 * Math.sin(x * 0.00041 + z * 0.00017) + 35 * Math.cos(z * 0.00051);
    }
    const last = relief.size - 1;
    const u = Math.max(0, Math.min(last, (x + relief.halfExtent) / relief.spacing));
    const v = Math.max(0, Math.min(last, (z + relief.halfExtent) / relief.spacing));
    const col = Math.min(last - 1, Math.floor(u)), row = Math.min(last - 1, Math.floor(v));
    const dx = u - col, dz = v - row, i = row * relief.size + col;
    const south = relief.bytes[i] * (1 - dx) + relief.bytes[i + 1] * dx;
    const north = relief.bytes[i + relief.size] * (1 - dx) + relief.bytes[i + relief.size + 1] * dx;
    return (south * (1 - dz) + north * dz) * relief.quantum + relief.minimum - relief.datum;
  }

  function groundY(x, z) {
    // Ease the sampled hills into the authored medieval city and water mesh.
    // Leave at least one full grid cell beneath each bank so triangles cannot bridge the water.
    const outsideTown = Math.hypot(Math.max(0, Math.abs(x) - 1850), Math.max(0, z - 4150, -z - 750));
    const nearestRiverZ = Math.max(-8600, Math.min(9880, z));
    const outsideRiver = Math.hypot(Math.max(0, Math.abs(x - riverX(nearestRiverZ)) - 380), z - nearestRiverZ);
    const blend = Math.min(1, outsideTown / 1750, outsideRiver / 1050);
    return -2 + regionalElevation(x, z) * blend * blend * (3 - 2 * blend);
  }

  let seed = 1561;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  function drawWindowsAndWeathering(x, style) {
    if (style === 1) {
      x.strokeStyle = '#362b21';
      x.lineWidth = 18;
      for (let j = 0; j <= 4; j++) {
        x.beginPath(); x.moveTo(0, j * 256); x.lineTo(1024, j * 256); x.stroke();
      }
      for (let i = 0; i <= 4; i++) {
        x.beginPath(); x.moveTo(i * 256, 0); x.lineTo(i * 256, 1024); x.stroke();
      }
      x.lineWidth = 12;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          x.beginPath();
          x.moveTo(i * 256 + 12, j * 256 + 12);
          x.lineTo((i + 1) * 256 - 12, (j + 1) * 256 - 12);
          x.stroke();
        }
      }
    }
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const a = 75 + i * 244, b = 40 + j * 245;
        x.fillStyle = '#5c5344';
        x.fillRect(a - 9, b - 10, 105, 137);
        const recess = x.createLinearGradient(a, b, a + 87, b + 118);
        recess.addColorStop(0, '#070c10');
        recess.addColorStop(0.5, '#243038');
        recess.addColorStop(1, '#10171b');
        x.fillStyle = recess;
        x.fillRect(a, b, 87, 118);
        x.fillStyle = 'rgba(0,0,0,.48)';
        x.fillRect(a, b, 87, 10);
        x.fillRect(a, b, 8, 118);
        // Subtle sky/fire reflection in medieval leaded window panes
        const warmWindow = (i + j) % 5 === 0;
        x.fillStyle = warmWindow ? 'rgba(235,155,80,.34)' : 'rgba(170,192,204,.22)';
        x.fillRect(a + 12, b + 15, 24, 37);
        x.fillStyle = '#6d6958';
        x.fillRect(a + 40, b, 5, 118);
        x.fillRect(a, b + 56, 87, 5);
        x.fillStyle = '#bfb294';
        x.fillRect(a - 12, b + 122, 111, 7);
      }
    }
    const dirt = x.createLinearGradient(0, 680, 0, 1024);
    dirt.addColorStop(0, 'rgba(32,27,20,0)');
    dirt.addColorStop(1, 'rgba(22,20,16,.58)');
    x.fillStyle = dirt;
    x.fillRect(0, 680, 1024, 344);
  }

  function materialTexture(roof, style = 0) {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const x = c.getContext('2d');
    x.fillStyle = roof ? '#6d4332' : '#b2a58e';
    x.fillRect(0, 0, 1024, 1024);
    for (let j = 0; j < 32; j++) {
      for (let i = 0; i < 24; i++) {
        const v = random();
        x.fillStyle = roof
          ? `hsl(${12 + v * 10},${28 + v * 14}%,${23 + v * 16}%)`
          : `hsl(35,${10 + v * 9}%,${48 + v * 18}%)`;
        x.fillRect(i * 45 - (j % 2) * 22, j * 32, 43, 30);
        x.fillStyle = 'rgba(0,0,0,.18)';
        x.fillRect(i * 45 - (j % 2) * 22, j * 32 + 28, 43, 3);
      }
    }
    for (let i = 0; i < 18000; i++) {
      x.fillStyle = random() > 0.5 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.07)';
      x.fillRect(random() * 1024, random() * 1024, 1 + random() * 4, 1 + random() * 3);
    }
    if (!roof) drawWindowsAndWeathering(x, style);
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  function buildArmorTexture() {
    const armorCanvas = document.createElement('canvas');
    armorCanvas.width = armorCanvas.height = 1024;
    const ac = armorCanvas.getContext('2d');
    ac.fillStyle = '#384048';
    ac.fillRect(0, 0, 1024, 1024);
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 12; i++) {
        const c = 38 + Math.floor(random() * 28);
        ac.fillStyle = `rgb(${c},${c + 5},${c + 10})`;
        ac.fillRect(i * 86 + 2, j * 64 + 2, 82, 60);
        ac.strokeStyle = 'rgba(155,172,186,.26)';
        ac.lineWidth = 1.5;
        ac.strokeRect(i * 86 + 4, j * 64 + 4, 78, 56);
        for (let k = 0; k < 4; k++) {
          ac.fillStyle = '#181e24';
          ac.fillRect(i * 86 + 12 + k * 16, j * 64 + 45, 8, 3);
        }
      }
    }
    // Glowingamber/orange energy conduits & weathering streaks
    for (let i = 0; i < 6000; i++) {
      ac.fillStyle = random() > 0.3 ? 'rgba(180,192,202,.07)' : 'rgba(14,18,22,.14)';
      ac.fillRect(random() * 1024, random() * 1024, random() * 16 + 2, 1.5);
    }
    const armorMap = new T.CanvasTexture(armorCanvas);
    armorMap.wrapS = armorMap.wrapT = T.RepeatWrapping;
    armorMap.colorSpace = T.SRGBColorSpace;
    armorMap.anisotropy = 8;
    return armorMap;
  }

  function getModels3D() {
    return (typeof window !== 'undefined' && window.Models3D)
      || (typeof globalThis !== 'undefined' && globalThis.Models3D)
      || null;
  }

  function getCity3D() {
    return (typeof window !== 'undefined' && window.City3D)
      || (typeof globalThis !== 'undefined' && globalThis.City3D)
      || null;
  }

  function getVFX3D() {
    return (typeof window !== 'undefined' && window.VFX3D)
      || (typeof globalThis !== 'undefined' && globalThis.VFX3D)
      || null;
  }

  function getCockpit3D() {
    return (typeof window !== 'undefined' && window.Cockpit3D)
      || (typeof globalThis !== 'undefined' && globalThis.Cockpit3D)
      || null;
  }

  function buildDreadnought(armorMap, hullMat, plateMat, armorPBR) {
    const models3d = getModels3D();
    if (models3d && typeof models3d.buildDreadnought === 'function') {
      return models3d.buildDreadnought(T, getSharedEnemyMaterials(armorMap, armorPBR));
    }
    const group = new T.Group();
    const darkMetal = new T.MeshStandardMaterial({
      color: 0x3b4348, map: armorMap,
      normalMap: armorPBR ? armorPBR.normalMap : null,
      normalScale: armorPBR ? new T.Vector2(1.1, 1.1) : undefined,
      roughnessMap: armorPBR ? armorPBR.roughnessMap : null,
      metalness: 0.78, roughness: armorPBR ? 1.0 : 0.34
    });
    const collarMat = new T.MeshStandardMaterial({
      color: 0x262d32, map: armorMap,
      normalMap: armorPBR ? armorPBR.normalMap : null,
      normalScale: armorPBR ? new T.Vector2(0.9, 0.9) : undefined,
      roughnessMap: armorPBR ? armorPBR.roughnessMap : null,
      metalness: 0.84, roughness: armorPBR ? 1.0 : 0.28
    });
    const plasmaGlow = new T.MeshBasicMaterial({ color: new T.Color(3.4, 1.45, 0.38) });
    const beaconGlow = new T.MeshBasicMaterial({ color: new T.Color(3.5, 0.82, 0.25) });

    // Main horizontal armored cylinder hull (like city-scale.png)
    const bodyGeo = new T.CylinderGeometry(135, 135, 1180, 28, 1);
    bodyGeo.rotateZ(Math.PI / 2);
    const body = new T.Mesh(bodyGeo, darkMetal);
    body.castShadow = true;
    group.add(body);

    // Armored collars & recessed rings along the hull
    for (const xOff of [-460, -240, 0, 240, 460]) {
      const ringGeo = new T.CylinderGeometry(152, 152, 58, 28);
      ringGeo.rotateZ(Math.PI / 2);
      const ring = new T.Mesh(ringGeo, collarMat);
      ring.position.x = xOff;
      group.add(ring);
    }

    // Beveled armored bow & stern thruster manifolds
    for (const side of [-1, 1]) {
      const capGeo = new T.CylinderGeometry(96, 136, 95, 24);
      capGeo.rotateZ(side * Math.PI / 2);
      const cap = new T.Mesh(capGeo, collarMat);
      cap.position.x = side * 620;
      group.add(cap);

      const coreGeo = new T.CylinderGeometry(64, 64, 16, 20);
      coreGeo.rotateZ(Math.PI / 2);
      const core = new T.Mesh(coreGeo, side > 0 ? plasmaGlow : collarMat);
      core.position.x = side * 668;
      group.add(core);
    }

    // Ventral hangar structure & dorsal command spine
    const keel = new T.Mesh(new T.BoxGeometry(820, 68, 145), plateMat);
    keel.position.set(0, -118, 0);
    group.add(keel);

    const tower = new T.Mesh(new T.BoxGeometry(260, 74, 92), hullMat);
    tower.position.set(-80, 148, 0);
    group.add(tower);

    // Illuminated launch bay & bridge windows
    for (let i = -3; i <= 3; i++) {
      const bayLight = new T.Mesh(new T.BoxGeometry(42, 8, 152), i % 2 === 0 ? plasmaGlow : beaconGlow);
      bayLight.position.set(i * 105, -138, 0);
      group.add(bayLight);
    }
    return group;
  }

  // Reusable 3D mesh builders for active enemies & wingman
  let sharedMats = null;
  function getSharedEnemyMaterials(armorMap, armorPBR) {
    if (sharedMats) return sharedMats;
    const models3d = getModels3D();
    if (models3d && typeof models3d.getSharedMaterials === 'function') {
      sharedMats = models3d.getSharedMaterials(T, armorMap, armorPBR);
      return sharedMats;
    }
    const nMap = armorPBR ? armorPBR.normalMap : null;
    const rMap = armorPBR ? armorPBR.roughnessMap : null;
    sharedMats = {
      sphereChrome: new T.MeshStandardMaterial({
        color: 0x8c7b6b, map: armorMap, normalMap: nMap, roughnessMap: rMap,
        bumpMap: nMap ? null : armorMap, bumpScale: 0.45,
        metalness: 0.92, roughness: rMap ? 0.55 : 0.14, envMapIntensity: 1.85
      }),
      sphereObsidian: new T.MeshStandardMaterial({
        color: 0x2c363d, map: armorMap, normalMap: nMap, roughnessMap: rMap,
        bumpMap: nMap ? null : armorMap, bumpScale: 0.38,
        metalness: 0.94, roughness: rMap ? 0.48 : 0.11, envMapIntensity: 2.1
      }),
      ringGold: new T.MeshStandardMaterial({
        color: 0xc8a878, metalness: 0.88, roughness: 0.20, envMapIntensity: 1.7
      }),
      fighterHull: new T.MeshStandardMaterial({
        color: 0x2b333a, map: armorMap, normalMap: nMap, roughnessMap: rMap,
        bumpMap: nMap ? null : armorMap, bumpScale: 0.35,
        metalness: 0.82, roughness: rMap ? 0.85 : 0.25, envMapIntensity: 1.65
      }),
      fighterWing: new T.MeshStandardMaterial({
        color: 0x3d464e, map: armorMap, normalMap: nMap, roughnessMap: rMap,
        metalness: 0.76, roughness: rMap ? 0.9 : 0.32
      }),
      canopyGold: new T.MeshStandardMaterial({
        color: 0xd8a25e, metalness: 0.95, roughness: 0.08, envMapIntensity: 2.4
      }),
      allyHull: new T.MeshStandardMaterial({
        color: 0x566368, map: armorMap, normalMap: nMap, roughnessMap: rMap,
        metalness: 0.68, roughness: rMap ? 0.95 : 0.36
      }),
      plasmaCore: new T.MeshBasicMaterial({ color: new T.Color(3.4, 1.45, 0.38) }),
      afterburner: new T.MeshBasicMaterial({ color: new T.Color(3.8, 1.32, 0.28) }),
      allyBurner: new T.MeshBasicMaterial({ color: new T.Color(1.3, 2.5, 4.0) })
    };
    return sharedMats;
  }

  function createSphereEnemyMesh(armorMap, armorPBR) {
    const mats = getSharedEnemyMaterials(armorMap, armorPBR);
    const models3d = getModels3D();
    if (models3d && typeof models3d.createSphereMesh === 'function') {
      const g = models3d.createSphereMesh(T, mats);
      if (!g.userData || !g.userData.coreSphere) {
        g.userData = Object.assign({ mats }, g.userData || {});
      }
      scene.add(g);
      return g;
    }
    const g = new T.Group();
    const coreSphere = new T.Mesh(new T.SphereGeometry(1, 28, 20), mats.sphereObsidian);
    g.add(coreSphere);

    const ring1 = new T.Mesh(new T.TorusGeometry(1.22, 0.045, 10, 36), mats.ringGold);
    ring1.rotation.x = Math.PI * 0.42;
    g.add(ring1);

    const ring2 = new T.Mesh(new T.TorusGeometry(1.08, 0.032, 8, 32), mats.ringGold);
    ring2.rotation.y = Math.PI * 0.35;
    g.add(ring2);

    const seam = new T.Mesh(new T.TorusGeometry(0.99, 0.028, 8, 32), mats.plasmaCore);
    seam.rotation.x = Math.PI * 0.5;
    g.add(seam);

    const eye = new T.Mesh(new T.SphereGeometry(0.22, 12, 10), mats.plasmaCore);
    eye.position.set(0, 0, -0.92);
    g.add(eye);

    g.userData = { coreSphere, ring1, ring2, mats };
    scene.add(g);
    return g;
  }

  function createFighterEnemyMesh(armorMap, armorPBR, isAlly = false) {
    const mats = getSharedEnemyMaterials(armorMap, armorPBR);
    const models3d = getModels3D();
    if (models3d && typeof models3d.createFighterMesh === 'function') {
      const g = models3d.createFighterMesh(T, mats, Boolean(isAlly));
      scene.add(g);
      return g;
    }
    const hullMat = isAlly && mats.allyHull ? mats.allyHull : mats.fighterHull;
    const burnerMat = isAlly && mats.allyBurner ? mats.allyBurner : mats.afterburner;
    const g = new T.Group();
    g.rotation.order = 'YXZ';

    // Sleek stealth needle fuselage
    const fuselageGeo = new T.ConeGeometry(0.28, 2.5, 8);
    fuselageGeo.rotateX(Math.PI * 0.5);
    const fuselage = new T.Mesh(fuselageGeo, hullMat);
    g.add(fuselage);

    // Swept X-delta main wing
    const wingShape = new T.Shape();
    wingShape.moveTo(0, 0.65);
    wingShape.lineTo(1.45, -0.15);
    wingShape.lineTo(1.28, -0.52);
    wingShape.lineTo(0.24, -0.45);
    wingShape.lineTo(-0.24, -0.45);
    wingShape.lineTo(-1.28, -0.52);
    wingShape.lineTo(-1.45, -0.15);
    wingShape.closePath();
    const wingGeo = new T.ExtrudeGeometry(wingShape, { depth: 0.06, bevelEnabled: false });
    wingGeo.rotateX(Math.PI * 0.5);
    const wing = new T.Mesh(wingGeo, mats.fighterWing);
    wing.position.y = 0.03;
    g.add(wing);

    // Forward canards
    const canardGeo = new T.BoxGeometry(0.95, 0.035, 0.24);
    const canard = new T.Mesh(canardGeo, mats.fighterWing);
    canard.position.set(0, 0.02, 0.52);
    g.add(canard);

    // Twin canted vertical tail fins (X-wing / V-tail profile)
    for (const side of [-1, 1]) {
      const tailGeo = new T.BoxGeometry(0.05, 0.52, 0.45);
      const tail = new T.Mesh(tailGeo, hullMat);
      tail.position.set(side * 0.26, 0.22, -0.78);
      tail.rotation.z = -side * 0.52;
      g.add(tail);

      // Twin glowing afterburner cones
      const burnerGeo = new T.ConeGeometry(0.11, 0.68, 10);
      burnerGeo.rotateX(-Math.PI * 0.5);
      const burner = new T.Mesh(burnerGeo, burnerMat);
      burner.position.set(side * 0.14, 0, -1.25);
      g.add(burner);
    }

    // Gold-tinted reflective cockpit canopy
    const canopyGeo = new T.SphereGeometry(0.16, 12, 8);
    canopyGeo.scale(0.85, 0.65, 2.2);
    const canopy = new T.Mesh(canopyGeo, mats.canopyGold);
    canopy.position.set(0, 0.14, 0.28);
    g.add(canopy);

    scene.add(g);
    return g;
  }

  function createCylinderEnemyMesh(armorMap, armorPBR) {
    const mats = getSharedEnemyMaterials(armorMap, armorPBR);
    const models3d = getModels3D();
    if (models3d && typeof models3d.createCylinderMesh === 'function') {
      const g = models3d.createCylinderMesh(T, mats);
      scene.add(g);
      return g;
    }
    const g = new T.Group();
    const bodyGeo = new T.CylinderGeometry(0.52, 0.52, 3.2, 20);
    bodyGeo.rotateZ(Math.PI * 0.5);
    g.add(new T.Mesh(bodyGeo, mats.fighterHull));

    for (const xOff of [-1.05, 0, 1.05]) {
      const collarGeo = new T.CylinderGeometry(0.58, 0.58, 0.28, 20);
      collarGeo.rotateZ(Math.PI * 0.5);
      const collar = new T.Mesh(collarGeo, mats.ringGold);
      collar.position.x = xOff;
      g.add(collar);
    }
    const slit = new T.Mesh(new T.BoxGeometry(1.8, 0.12, 1.08), mats.plasmaCore);
    g.add(slit);
    scene.add(g);
    return g;
  }

  function createCrossEnemyMesh(armorMap, armorPBR) {
    const mats = getSharedEnemyMaterials(armorMap, armorPBR);
    const models3d = getModels3D();
    if (models3d && typeof models3d.createCrossMesh === 'function') {
      const g = models3d.createCrossMesh(T, mats);
      scene.add(g);
      return g;
    }
    const g = new T.Group();
    const bar1 = new T.Mesh(new T.BoxGeometry(2.4, 0.22, 0.22), mats.fighterHull);
    const bar2 = new T.Mesh(new T.BoxGeometry(0.22, 2.4, 0.22), mats.fighterHull);
    g.add(bar1, bar2);

    const ring = new T.Mesh(new T.TorusGeometry(0.85, 0.05, 8, 28), mats.ringGold);
    g.add(ring);

    for (const [ox, oy] of [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1], [0, 0]]) {
      const r = ox === 0 && oy === 0 ? 0.38 : 0.28;
      const orb = new T.Mesh(new T.SphereGeometry(r, 16, 12), ox === 0 && oy === 0 ? mats.plasmaCore : mats.sphereChrome);
      orb.position.set(ox, oy, 0);
      g.add(orb);
    }
    scene.add(g);
    return g;
  }

  function getPooledEnemyMesh(type, armorMap) {
    const key = enemyPools[type] ? type : 'sphere';
    const pool = enemyPools[key];
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].visible) {
        pool[i].visible = true;
        return pool[i];
      }
    }
    const created = key === 'fighter' ? createFighterEnemyMesh(armorMap, cachedArmorPBR)
      : key === 'cylinder' ? createCylinderEnemyMesh(armorMap, cachedArmorPBR)
      : key === 'cross' ? createCrossEnemyMesh(armorMap, cachedArmorPBR)
      : createSphereEnemyMesh(armorMap, cachedArmorPBR);
    pool.push(created);
    return created;
  }

  function applyPBRToMaterial(mat, sourceCanvas, opts) {
    const pfx = typeof window !== 'undefined' && window.WorldPostFX;
    if (!mat || !pfx || typeof pfx.buildPBRMaps !== 'function' || !sourceCanvas) return null;
    const maps = pfx.buildPBRMaps(T, sourceCanvas, opts);
    if (!maps) return null;
    if (mat.map) {
      for (const detail of [maps.normalMap, maps.roughnessMap]) {
        detail.wrapS = mat.map.wrapS;
        detail.wrapT = mat.map.wrapT;
      }
    }
    if (mat.normalMap && mat.normalMap !== maps.normalMap) mat.normalMap.dispose?.();
    if (mat.roughnessMap && mat.roughnessMap !== maps.roughnessMap) mat.roughnessMap.dispose?.();
    mat.normalMap = maps.normalMap;
    mat.normalScale = new T.Vector2(opts.normalScale || 1.0, opts.normalScale || 1.0);
    mat.roughnessMap = maps.roughnessMap;
    mat.bumpMap = null;
    mat.roughness = 1.0;
    mat.needsUpdate = true;
    return maps;
  }

  function init() {
    try {
      const canvas = document.createElement('canvas');
      canvas.id = 'world3d';
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      document.getElementById('game').insertBefore(canvas, document.getElementById('view'));

      gpu = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
      gpu.outputColorSpace = T.SRGBColorSpace;
      gpu.toneMapping = T.ACESFilmicToneMapping;
      gpu.toneMappingExposure = 1.12;
      gpu.shadowMap.enabled = quality !== 'low';
      gpu.shadowMap.type = T.PCFSoftShadowMap;
      gpu.shadowMap.autoUpdate = false;
      gpu.shadowMap.needsUpdate = true;

      scene = new T.Scene();
      scene.scale.x = -1;
      scene.background = new T.Color('#64737e');

      camera = new T.PerspectiveCamera(65, 1, 2, 22000);

      // Cinematic dawn lighting: cool storm-sky fill, warm golden key sun & city fire uplight.
      scene.add(new T.HemisphereLight(0x88aacb, 0x2c221b, 0.46));
      sun = new T.DirectionalLight(0xffd29e, 2.52);
      sun.position.copy(sunDirection).multiplyScalar(3200);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -1350, right: 1350, top: 1350, bottom: -1350, near: 10, far: 5200 });
      sun.shadow.normalBias = 0.48;
      sun.shadow.bias = -0.00006;
      scene.add(sun, sun.target);

      // Subtle warm uplight from burning Nuremberg catching the underbellies of capital ships & fighters.
      const cityFireBounce = new T.DirectionalLight(0xff6b2a, 0.36);
      cityFireBounce.position.set(0.15, -1.0, 0.25);
      scene.add(cityFireBounce);

      // Dynamic explosion point light
      explosionLight = new T.PointLight(0xff8c38, 0, 2200, 1.45);
      scene.add(explosionLight);

      const floorWidth = relief ? relief.halfExtent * 2 : 42000;
      const floorSegments = relief ? relief.size - 1 : 168;
      const floor = new T.PlaneGeometry(floorWidth, floorWidth, floorSegments, floorSegments);
      floor.rotateX(-Math.PI / 2);
      const pos = floor.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        pos.setY(i, groundY(x, z));
      }
      floor.computeVertexNormals();

      const groundMat = new T.MeshStandardMaterial({ color: 0xb4b1a5, roughness: 0.95 });
      const ground = new T.Mesh(floor, groundMat);
      ground.receiveShadow = true;
      scene.add(ground);

      const soil = document.createElement('canvas');
      soil.width = soil.height = 1024;
      const sx = soil.getContext('2d');
      sx.fillStyle = '#5c6148';
      sx.fillRect(0, 0, 1024, 1024);
      const soilMap = new T.CanvasTexture(soil);
      soilMap.wrapS = soilMap.wrapT = T.MirroredRepeatWrapping;
      soilMap.repeat.set(16, 16);
      soilMap.anisotropy = 8;
      soilMap.colorSpace = T.SRGBColorSpace;
      groundMat.map = soilMap;

      const city3d = getCity3D();
      if (city3d && typeof city3d.enhanceValleyTerrain === 'function') {
        city3d.enhanceValleyTerrain(T, sx, soil, soilMap, groundMat, applyPBRToMaterial, random);
      } else {
        for (let i = 0; i < 42000; i++) {
          sx.fillStyle = random() > 0.5 ? 'rgba(24,30,16,.16)' : 'rgba(195,182,128,.12)';
          sx.fillRect(random() * 1024, random() * 1024, random() * 8 + 2, random() * 6 + 2);
        }
        applyPBRToMaterial(groundMat, soil, { strength: 2.0, baseRough: 0.9, roughSpread: 0.16, repeatX: 16, repeatY: 16, normalScale: 0.85 });
        groundMat.needsUpdate = true;

      }
      groundMat.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <normal_fragment_begin>', `
            #include <normal_fragment_begin>
            vec3 terrainSlope = normal;
          `)
          .replace('#include <normal_fragment_maps>', `
            #include <normal_fragment_maps>
            float detailFade = 1.0 - smoothstep(1100.0, 4300.0, length(vViewPosition));
            normal = normalize(mix(terrainSlope, normal, detailFade * 0.56));
          `);
      };

      const wallTex = materialTexture(false, 0);
      const timberTex = materialTexture(false, 1);
      const stoneTex = materialTexture(false, 2);
      const roofTex = materialTexture(true, 0);
      roofTex.wrapS = roofTex.wrapT = T.RepeatWrapping;

      const wallMat = new T.MeshStandardMaterial({ color: 0xa69f93, map: wallTex, bumpMap: wallTex, bumpScale: 0.22, roughness: 0.92 });
      const roofMat = new T.MeshStandardMaterial({ color: 0x9c7f74, map: roofTex, bumpMap: roofTex, bumpScale: 0.34, roughness: 0.82 });
      const makeFacade = tex => new T.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 0.18, roughness: 0.92 });
      const stoneMat = makeFacade(stoneTex);
      const timberMat = makeFacade(timberTex);
      const cap = new T.MeshStandardMaterial({ map: roofTex, bumpMap: roofTex, bumpScale: 0.25, color: 0x7a5244, roughness: 0.84 });

      applyPBRToMaterial(wallMat, wallTex.image, { strength: 2.0, baseRough: 0.86, roughSpread: 0.22, normalScale: 0.9 });
      applyPBRToMaterial(roofMat, roofTex.image, { strength: 2.8, baseRough: 0.78, roughSpread: 0.26, normalScale: 1.15 });
      applyPBRToMaterial(stoneMat, stoneTex.image, { strength: 2.6, baseRough: 0.88, roughSpread: 0.24, normalScale: 1.1 });
      applyPBRToMaterial(timberMat, timberTex.image, { strength: 2.2, baseRough: 0.84, roughSpread: 0.24, normalScale: 1.0 });
      if (roofMat.normalMap) {
        cap.normalMap = roofMat.normalMap;
        cap.normalScale = roofMat.normalScale;
        cap.roughnessMap = roofMat.roughnessMap;
        cap.bumpMap = null;
        cap.roughness = 1.0;
      }

      // Composite BOTH halves of photographic assets/city-materials.png (top = medieval stone, bottom = red clay roof tiles)
      const atlas = new Image();
      atlas.onload = () => {
        const halfH = Math.floor(atlas.height / 2);
        // 1. Roof clay tiles -> roofTex
        const rc = roofTex.image, rcx = rc.getContext('2d');
        rcx.drawImage(atlas, 0, halfH, atlas.width, halfH, 0, 0, rc.width, rc.height);
        roofTex.needsUpdate = true;

        // 2. Stone masonry -> stoneTex, wallTex, timberTex
        const sc = stoneTex.image, scx = sc.getContext('2d');
        scx.drawImage(atlas, 0, 0, atlas.width, halfH, 0, 0, sc.width, sc.height);
        drawWindowsAndWeathering(scx, 2);
        stoneTex.needsUpdate = true;

        const wc = wallTex.image, wcx = wc.getContext('2d');
        wcx.save();
        wcx.globalAlpha = 0.62;
        wcx.drawImage(atlas, 0, 0, atlas.width, halfH, 0, 0, wc.width, wc.height);
        wcx.restore();
        drawWindowsAndWeathering(wcx, 0);
        wallTex.needsUpdate = true;

        const tc = timberTex.image, tcx = tc.getContext('2d');
        tcx.save();
        tcx.globalAlpha = 0.48;
        tcx.drawImage(atlas, 0, 0, atlas.width, halfH, 0, 0, tc.width, tc.height);
        tcx.restore();
        drawWindowsAndWeathering(tcx, 1);
        timberTex.needsUpdate = true;

        // Refresh PBR normal & roughness maps from photographic atlas
        applyPBRToMaterial(roofMat, rc, { strength: 3.0, baseRough: 0.78, roughSpread: 0.28, normalScale: 1.25 });
        cap.normalMap = roofMat.normalMap;
        cap.normalScale = roofMat.normalScale;
        cap.roughnessMap = roofMat.roughnessMap;
        cap.bumpMap = null;
        cap.roughness = 1.0;
        cap.needsUpdate = true;
        applyPBRToMaterial(stoneMat, sc, { strength: 2.8, baseRough: 0.88, roughSpread: 0.25, normalScale: 1.2 });
        applyPBRToMaterial(wallMat, wc, { strength: 2.1, baseRough: 0.86, roughSpread: 0.22, normalScale: 0.95 });
        applyPBRToMaterial(timberMat, tc, { strength: 2.3, baseRough: 0.84, roughSpread: 0.25, normalScale: 1.05 });
      };
      if (window.CityAtlas) atlas.src = window.CityAtlas;

      const profile = new T.Shape();
      profile.moveTo(-0.5, 0); profile.lineTo(0.5, 0); profile.lineTo(0, 1); profile.closePath();
      const roofGeo = new T.ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false });
      roofGeo.translate(0, 0, -0.5);

      urbanDistricts = city3d?.createUrbanDistricts(T, scene, { stoneMat, roofMat, timberMat, wallMat, cap }, roofGeo);

      window.Woodland3D?.buildWoodland(T, scene, groundY, riverX, urbanDistricts?.courtyardTrees);

      // Pegnitz River with specular environment reflections & rippled water bump map
      const verts = [], inds = [];
      const riverSegments = 440;
      for (let i = 0; i <= riverSegments; i++) {
        const z = -8600 + i * 42;
        const x = riverX(z);
        const bankWidth = 58 + (z < -550 || z > 3950 ? 10 * Math.sin(z * 0.003) : 0);
        verts.push(x - bankWidth, -0.4, z, x + bankWidth, -0.4, z);
        if (i < riverSegments) {
          const k = i * 2;
          inds.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      const riverGeo = new T.BufferGeometry();
      riverGeo.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
      riverGeo.setIndex(inds);
      riverGeo.computeVertexNormals();
      const riverMat = new T.MeshStandardMaterial({
        color: 0x3b535c,
        roughness: 0.34,
        envMapIntensity: 0.82
      });
      const vfx3dRiver = getVFX3D();
      if (vfx3dRiver && typeof vfx3dRiver.enhanceRiverWater === 'function') {
        riverController = vfx3dRiver.enhanceRiverWater(T, riverGeo, riverMat);
      }
      const river = new T.Mesh(riverGeo, riverMat);
      river.receiveShadow = true;
      scene.add(river);

      if (city3d && typeof city3d.buildMedievalLandmarks === 'function') {
        city3d.buildMedievalLandmarks(T, scene, { stoneMat, roofMat, timberMat, wallMat, cap }, roofGeo);
      } else {
        for (const z of [350, 1200, 2150, 3000]) {
          const x = 170 * Math.sin(z * 0.0018);
          const bridge = new T.Mesh(new T.BoxGeometry(155, 4, 19), stoneMat);
          bridge.position.set(x, 5, z);
          bridge.castShadow = bridge.receiveShadow = true;
          scene.add(bridge);
          for (const edge of [-1, 1]) {
            const rail = new T.Mesh(new T.BoxGeometry(155, 2.2, 1.5), stoneMat);
            rail.position.set(x, 8, z + edge * 9);
            rail.castShadow = true;
            scene.add(rail);
          }
          for (const dx of [-48, 0, 48]) {
            const pier = new T.Mesh(new T.BoxGeometry(8, 8, 18), stoneMat);
            pier.position.set(x + dx, 0, z);
            scene.add(pier);
          }
        }

        // Twin-spired Gothic Cathedrals (St. Lorenz & St. Sebaldus)
        const addBox = (x, y, z, w, h, d, mat = stoneMat) => {
          const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
          m.position.set(x, y + h / 2, z);
          m.castShadow = m.receiveShadow = true;
          scene.add(m);
        };
        const copperSpireMat = new T.MeshStandardMaterial({ color: 0x3b4843, metalness: 0.45, roughness: 0.55 });
        for (const [x, z] of [[-460, 1300], [650, 2400]]) {
          addBox(x, 0, z, 44, 32, 104, stoneMat);
          const naveRoof = new T.Mesh(roofGeo, roofMat);
          naveRoof.position.set(x, 32, z);
          naveRoof.scale.set(46, 18, 106);
          naveRoof.castShadow = true;
          scene.add(naveRoof);
          for (const dx of [-18, 18]) {
            addBox(x + dx, 0, z - 45, 16, 68, 18, stoneMat);
            const spire = new T.Mesh(new T.ConeGeometry(12, 42, 8), copperSpireMat);
            spire.position.set(x + dx, 89, z - 45);
            spire.castShadow = true;
            scene.add(spire);
          }
        }

        // Imperial Castle (Kaiserburg) and Medieval Fortified Walls with Watchtowers
        const tower = (x, z, height, radius, round) => {
          const body = new T.Mesh(
            round ? new T.CylinderGeometry(radius, radius * 1.06, height, 18) : new T.BoxGeometry(radius * 2, height, radius * 2),
            stoneMat
          );
          body.position.set(x, height / 2, z);
          body.castShadow = body.receiveShadow = true;
          scene.add(body);
          const roof = new T.Mesh(new T.ConeGeometry(radius * 1.28, height * 0.36, round ? 18 : 4), cap);
          roof.position.set(x, height * 1.18, z);
          if (!round) roof.rotation.y = Math.PI / 4;
          roof.castShadow = true;
          scene.add(roof);
        };
        tower(-750, 2850, 98, 18, false);
        tower(-640, 2800, 68, 21, true);
        addBox(-730, 0, 2930, 165, 40, 68, stoneMat);
        for (let i = 0; i < 15; i++) {
          const x = -1600 + i * 220;
          addBox(x, 0, 3600, 215, 15, 9, stoneMat);
          tower(x, 3600, 31, 11, i % 3 === 0);
        }
        for (const x of [-1680, 1680]) {
          for (let i = 0; i < 10; i++) {
            const z = -300 + i * 400;
            addBox(x, 0, z, 9, 15, 395, stoneMat);
            tower(x, z, 30, 10, i % 2 === 0);
          }
        }
      }

      // Capital Ships Overhead:
      // 1. Sleek Black Stealth Delta Cruiser (inspired by battle-mood.png & city-scale.png)
      const hullFinish = getModels3D()?.buildHullFinish?.(T);
      cachedArmorMap = hullFinish?.colorMap ?? buildArmorTexture();
      cachedArmorPBR = hullFinish ?? window.WorldPostFX?.buildPBRMaps(T, cachedArmorMap.image, {
        strength: 2.2, baseRough: 0.34, roughSpread: 0.26
      });
      const enemyMats = getSharedEnemyMaterials(cachedArmorMap, cachedArmorPBR);
      const hullMat = enemyMats.hullMat || new T.MeshStandardMaterial({
        color: 0x2d353c, map: cachedArmorMap,
        normalMap: cachedArmorPBR ? cachedArmorPBR.normalMap : null,
        normalScale: cachedArmorPBR ? new T.Vector2(1.1, 1.1) : undefined,
        roughnessMap: cachedArmorPBR ? cachedArmorPBR.roughnessMap : null,
        metalness: 0.82, roughness: cachedArmorPBR ? 0.92 : 0.28, envMapIntensity: 1.8
      });
      const plateMat = enemyMats.plateMat || new T.MeshStandardMaterial({
        color: 0x454e56, map: cachedArmorMap,
        normalMap: cachedArmorPBR ? cachedArmorPBR.normalMap : null,
        normalScale: cachedArmorPBR ? new T.Vector2(0.95, 0.95) : undefined,
        roughnessMap: cachedArmorPBR ? cachedArmorPBR.roughnessMap : null,
        metalness: 0.74, roughness: cachedArmorPBR ? 0.98 : 0.36, envMapIntensity: 1.55
      });

      const models3d = getModels3D();
      if (models3d && typeof models3d.buildCarrier === 'function') {
        carrier = models3d.buildCarrier(T, enemyMats, random);
        carrier.position.set(580, 560, 2550);
        carrier.rotation.set(0.04, -0.22, -0.06);
        scene.add(carrier);
      } else {
        carrier = new T.Group();
        carrier.position.set(580, 560, 2550);
        carrier.rotation.set(0.04, -0.22, -0.06);

        const arrow = new T.Shape();
        arrow.moveTo(0, -980);
        arrow.lineTo(480, 660);
        arrow.lineTo(0, 440);
        arrow.lineTo(-480, 660);
        arrow.closePath();
        const hullGeo = new T.ExtrudeGeometry(arrow, {
          depth: 96, bevelEnabled: true, bevelSize: 26, bevelThickness: 20, bevelSegments: 3, steps: 1
        });
        hullGeo.rotateX(Math.PI / 2);
        const hull = new T.Mesh(hullGeo, hullMat);
        hull.castShadow = true;
        carrier.add(hull);

        const box = (x, y, z, b, h, d, mat) => {
          const mesh = new T.Mesh(new T.BoxGeometry(b, h, d), mat);
          mesh.position.set(x, y, z);
          carrier.add(mesh);
          return mesh;
        };
        box(0, 52, -210, 168, 86, 420, plateMat);
        box(0, 118, -320, 84, 52, 135, hullMat);
        for (let i = 0; i < 22; i++) {
          const z = -540 + i * 55, wPlate = 92 + (540 - z) * 0.25;
          box(0, 8, z, wPlate, 10, 36, i % 3 ? plateMat : hullMat);
        }
        for (const side of [-1, 1]) {
          for (let i = 0; i < 9; i++) {
            box(side * (102 + i * 25), 12, -160 - i * 45, 36, 22 + random() * 18, 86, plateMat);
          }
        }
        const engineGlow = new T.MeshBasicMaterial({ color: new T.Color(3.4, 1.4, 0.36) });
        for (const x of [-230, -115, 0, 115, 230]) box(x, -38, -648, 68, 34, 12, engineGlow);
        const bridgeLights = new T.MeshBasicMaterial({ color: new T.Color(2.4, 1.85, 1.05) });
        for (let i = 0; i < 9; i++) box(-36 + i * 9, 124, -390, 4.5, 4.5, 3, bridgeLights);
        scene.add(carrier);
      }

      // 2. Twin Colossal Cylindrical Motherships hovering in the cloud deck (like city-scale.png)
      dreadnought1 = buildDreadnought(cachedArmorMap, hullMat, plateMat, cachedArmorPBR);
      dreadnought1.position.set(-760, 740, 2780);
      dreadnought1.rotation.set(0.02, 0.18, -0.03);
      scene.add(dreadnought1);

      dreadnought2 = buildDreadnought(cachedArmorMap, hullMat, plateMat, cachedArmorPBR);
      dreadnought2.position.set(980, 840, 3550);
      dreadnought2.scale.setScalar(0.88);
      dreadnought2.rotation.set(-0.02, -0.28, 0.04);
      scene.add(dreadnought2);

      // Avoid coarse city-scale shadow-map self-shadowing artifacts on distant colossal hulls.
      for (const ship of [carrier, dreadnought1, dreadnought2]) {
        ship?.traverse?.(obj => { if (obj.isMesh) obj.receiveShadow = false; });
      }

      // 3. Allied Wingman F-35A 3D Mesh
      wingmanMesh = createFighterEnemyMesh(cachedArmorMap, cachedArmorPBR, true);
      wingmanMesh.scale.setScalar(18);

      // Rich Dual-Tone PMREM Reflection Environment (Cool Steel Sky + Warm Sunrise & City Fires)
      const reflectionScene = new T.Scene();
      reflectionScene.background = new T.Color(0x586874);
      const reflectionSky = new T.Mesh(
        new T.SphereGeometry(1500, 24, 12),
        new T.MeshBasicMaterial({ color: 0x7b8e9c, side: T.BackSide })
      );
      reflectionScene.add(reflectionSky);

      const horizonBand = new T.Mesh(
        new T.CylinderGeometry(1400, 1400, 520, 32, 1, true),
        new T.MeshBasicMaterial({ color: 0xd88a52, side: T.BackSide })
      );
      horizonBand.position.y = -80;
      reflectionScene.add(horizonBand);

      const groundBand = new T.Mesh(
        new T.CylinderGeometry(1380, 1380, 650, 32, 1, true),
        new T.MeshBasicMaterial({ color: 0x2b2622, side: T.BackSide })
      );
      groundBand.position.y = -580;
      reflectionScene.add(groundBand);

      const sunBox = new T.Mesh(
        new T.PlaneGeometry(780, 360),
        new T.MeshBasicMaterial({ color: 0xffe6c2 })
      );
      sunBox.position.set(-550, 260, -820);
      sunBox.lookAt(0, 0, 0);
      reflectionScene.add(sunBox);

      const fireBox = new T.Mesh(
        new T.PlaneGeometry(900, 400),
        new T.MeshBasicMaterial({ color: 0xff6e24 })
      );
      fireBox.position.set(300, -450, 700);
      fireBox.lookAt(0, 0, 0);
      reflectionScene.add(fireBox);

      const pmrem = new T.PMREMGenerator(gpu);
      const hdrEnv = (typeof window !== 'undefined' && window.WorldPostFX?.buildEquirectangularHDRI)
        ? window.WorldPostFX.buildEquirectangularHDRI(T, pmrem, renderSunDirection)
        : null;
      if (hdrEnv) {
        scene.environment = hdrEnv;
        pmrem.dispose();
        for (const mesh of [reflectionSky, horizonBand, groundBand, sunBox, fireBox]) {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
      } else {
        const environment = pmrem.fromScene(reflectionScene, 0.08, 1, 2000);
        scene.environment = environment.texture;
        pmrem.dispose();
        for (const mesh of [reflectionSky, horizonBand, groundBand, sunBox, fireBox]) {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
      }

      postPipeline = (typeof window !== 'undefined' && window.WorldPostFX?.createPostPipeline)
        ? window.WorldPostFX.createPostPipeline(T, gpu, renderSunDirection)
        : null;
      if (!postPipeline) scene.fog = new T.FogExp2('#75838b', 0.00018);
      if (postPipeline) document.getElementById('game').classList.add('hdr-world');

      const vfx3dSys = getVFX3D();
      if (vfx3dSys && typeof vfx3dSys.createVFXSystem === 'function') {
        vfxSystem = vfx3dSys.createVFXSystem(T, scene, {
          lightDirection: sunDirection,
          sceneDepth: postPipeline?.depthTexture,
          plumeLayer: postPipeline?.plumeLayer,
          explosionLight,
          enemyMats
        });
        const fires = [[-520, 930, 61], [728, 1580, 46], [-935, 2300, 70], [338, 2760, 56],
          [-260, 1740, 66], [587, 1020, 44], [-670, 3030, 57], [192, 2210, 52]];
        for (const [x, z, size] of fires) vfxSystem.addGroundFire?.(x, 3, z, size, true);
      }

      const cp3d = getCockpit3D();
      if (cp3d && typeof cp3d.createCockpit === 'function') {
        cockpitRig = cp3d.createCockpit(T, scene, { armorPBR: cachedArmorPBR });
      }

      ready = true;
      canvas.addEventListener('webglcontextlost', e => {
        e.preventDefault();
        failed = true;
        canvas.style.display = 'none';
        document.getElementById('game').classList.remove('hdr-world');
      });
    } catch (e) {
      failed = true;
      console.warn('3D renderer unavailable, using compatibility renderer', e);
      if (gpu) gpu.domElement.style.display = 'none';
    }
  }

  function updateDynamicEntities(s) {
    const t = Number(s.time) || 0;

    // 1. Subtle capital ship orbital drift & city fire/smoke animation
    if (carrier) {
      carrier.position.x = 580 + Math.sin(t * 0.08) * 90;
      carrier.position.y = 560 + Math.cos(t * 0.14) * 14;
      carrier.rotation.z = -0.06 + Math.sin(t * 0.11) * 0.03;
    }
    if (dreadnought1) {
      dreadnought1.position.x = -760 + Math.cos(t * 0.06) * 70;
      dreadnought1.position.y = 740 + Math.sin(t * 0.12) * 12;
    }
    if (dreadnought2) {
      dreadnought2.position.x = 980 - Math.sin(t * 0.05) * 80;
    }

    if (riverController && typeof riverController.update === 'function') {
      riverController.update(t);
    }

    if (vfxSystem && typeof vfxSystem.update === 'function') {
      vfxSystem.update(s, t);
    } else if (explosionLight) {
      // Fallback dynamic explosion point light when VFX3D is unavailable
      if (Array.isArray(s.explosions) && s.explosions.length > 0) {
        const ex = s.explosions[0];
        const ageRatio = Math.min(1, (ex.age || 0) / Math.max(0.1, ex.maxAge || 3));
        explosionLight.position.set(ex.x, ex.y, ex.z);
        explosionLight.intensity = Math.max(0, (1 - ageRatio * 1.4) * 18);
      } else {
        explosionLight.intensity = 0;
      }
    }

    // 3. Allied Wingman F-35A 3D Mesh
    if (wingmanMesh) {
      if (s.wingman) {
        wingmanMesh.visible = true;
        wingmanMesh.position.set(s.wingman.x, s.wingman.y, s.wingman.z);
        wingmanMesh.rotation.set(-s.player.pitch * 0.4, s.player.yaw + Math.sin(t * 0.34) * 0.12, -(s.wingman.bank || 0));
      } else {
        wingmanMesh.visible = false;
      }
    }

    // 4. Pool & update 3D Enemy Meshes (sphere, fighter, cylinder, cross)
    for (const key of ['sphere', 'fighter', 'cylinder', 'cross']) {
      const pool = enemyPools[key];
      for (let i = 0; i < pool.length; i++) pool[i].visible = false;
    }

    const enemies = Array.isArray(s.enemies) ? s.enemies : [];
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const mesh = getPooledEnemyMesh(e.type || 'sphere', cachedArmorMap);
      mesh.position.set(e.x, e.y, e.z);
      const baseScale = (e.size || 72) * 0.82;

      if (e.type === 'fighter') {
        mesh.scale.setScalar(baseScale * 0.72);
        const vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 1;
        const yaw = Math.atan2(vx, vz);
        const pitch = Math.atan2(vy, Math.hypot(vx, vz) || 1);
        mesh.rotation.set(-pitch, yaw, -(e.bank || 0));
      } else if (e.type === 'cylinder') {
        mesh.scale.setScalar(baseScale * 0.85);
        const yaw = Math.atan2(e.vx || 0, e.vz || 1);
        mesh.rotation.set(0, yaw + Math.PI * 0.5, (e.bank || 0) * 0.4);
      } else if (e.type === 'cross') {
        mesh.scale.setScalar(baseScale * 0.78);
        mesh.rotation.set(Math.sin(t + (e.phase || 0)) * 0.25, t * 0.6 + (e.phase || 0), (e.ringPhase || 0) * 0.35);
      } else {
        mesh.scale.setScalar(baseScale);
        if (mesh.userData && mesh.userData.ring1) {
          mesh.userData.ring1.rotation.z = (e.ringPhase || 0);
          mesh.userData.ring2.rotation.x = -(e.ringPhase || 0) * 0.8;
          mesh.userData.coreSphere.material = (e.variant === 1)
            ? mesh.userData.mats.sphereChrome
            : mesh.userData.mats.sphereObsidian;
        }
      }
    }

    // 5. Render falling, burning enemy ship wrecks plummeting into the city
    const wrecks = Array.isArray(s.wrecks) ? s.wrecks : [];
    for (let i = 0; i < wrecks.length; i++) {
      const w = wrecks[i];
      const mesh = getPooledEnemyMesh(w.type || 'sphere', cachedArmorMap);
      mesh.position.set(w.x, w.y, w.z);
      const baseScale = (w.size || 72) * 0.82;
      mesh.scale.setScalar(w.type === 'fighter' ? baseScale * 0.72 : baseScale * 0.85);
      mesh.rotation.set(w.spin || 0, (w.yaw || 0) + (w.spin || 0) * 0.6, w.bank || 0);
    }
  }

  function collapseBuildings(wx, wz, radius = 95) {
    if (!ready || !urbanDistricts) return 0;
    const destroyed = urbanDistricts.collapseBuildings(wx, wz, radius);
    if (destroyed) {
      gpu.shadowMap.needsUpdate = true;
      vfxSystem?.addGroundFire?.(wx, 3, wz, Math.min(95, Math.max(38, radius * 0.6)));
    }
    return destroyed;
  }

  window.World3D = {
    rendersEntities: true,
    get rendersVFX() {
      return Boolean(ready && !failed && vfxSystem);
    },
    get rendersCockpit() {
      return Boolean(ready && !failed && cockpitRig);
    },
    getCloudMist(s) {
      return (vfxSystem && typeof vfxSystem.getCloudMist === 'function')
        ? (Number(vfxSystem.getCloudMist(s)) || 0)
        : 0;
    },
    collapseBuildings,
    reset() {
      urbanDistricts?.reset();
      vfxSystem?.resetGroundFires?.();
      if (gpu) gpu.shadowMap.needsUpdate = true;
      last = 0;
    },
    setQuality(value) {
      if (!['auto', 'high', 'medium', 'low'].includes(value)) return;
      quality = value;
      scale = value === 'low' ? 0.70 : value === 'medium' ? 0.86 : 1;
      frames = 0;
      average = 16.7;
      last = 0;
      if (gpu) {
        gpu.shadowMap.enabled = value !== 'low';
        gpu.shadowMap.needsUpdate = true;
        width = height = 0;
      }
    },
    render(s) {
      if (failed) return false;
      if (!ready) init();
      if (!ready) return false;

      const now = performance.now();
      if (last && s.state === 'playing' && !document.hidden && now - last < 180) {
        average = average * 0.96 + (now - last) * 0.04;
        if (++frames % 100 === 0 && quality === 'auto') {
          if (average > 19.5) scale = Math.max(0.66, scale - 0.08);
          else if (average < 17.2) scale = Math.min(1, scale + 0.04);
        }
      }
      last = now;

      // Keep Auto/Media within a 1080p internal budget on HiDPI displays.
      const dpr = quality === 'high' ? Math.min(window.devicePixelRatio || 1, 1.5)
        : Math.min(window.devicePixelRatio || 1, Math.sqrt(2073600 / (s.w * s.h)));
      const rw = Math.max(16, Math.round(s.w * scale * dpr));
      const rh = Math.max(16, Math.round(s.h * scale * dpr));
      if (width !== rw || height !== rh) {
        width = rw;
        height = rh;
        gpu.setSize(rw, rh, false);
      }

      const p = s.player;
      const tSec = Number(s.time) || 0;
      const shakeAmt = Math.min(1.4, Number(s.shake) || 0);
      const recoilAmt = Number(p.recoil) || 0;
      const buffetAmt = Number(p.buffet) || 0;
      const camYawOff = (shakeAmt * 0.0085 + buffetAmt * 0.004) * Math.sin(tSec * 57.3);
      const camPitchOff = (shakeAmt * 0.0072 + buffetAmt * 0.0035) * Math.cos(tSec * 63.7) + recoilAmt * 0.0028;
      const camRollOff = shakeAmt * 0.011 * Math.sin(tSec * 41.9);

      const effYaw = (p.yaw || 0) + camYawOff;
      const effPitch = (p.pitch || 0) + camPitchOff;
      camera.aspect = s.w / s.h;
      camera.fov = (2 * Math.atan(s.h / (2 * s.focal)) * 180) / Math.PI;
      camera.updateProjectionMatrix();
      camera.position.set(-p.x, p.y, p.z);
      camera.up.set(0, 1, 0);
      camera.lookAt(
        -p.x - Math.sin(effYaw) * Math.cos(effPitch),
        p.y + Math.sin(effPitch),
        p.z + Math.cos(effYaw) * Math.cos(effPitch)
      );
      camera.rotateZ(-(p.roll || 0) + camRollOff);

      updateDynamicEntities(s);
      if (cockpitRig && typeof cockpitRig.update === 'function') {
        cockpitRig.update(s, camera, renderSunDirection);
      }

      // Static city: retain the shadow map until the aircraft changes shadow region.
      const gridX = Math.round(p.x / 320) * 320, gridZ = Math.round(p.z / 320) * 320;
      if (gridX !== shadowX || gridZ !== shadowZ) {
        shadowX = gridX;
        shadowZ = gridZ;
        sun.position.copy(sunDirection).multiplyScalar(3200);
        sun.position.x += gridX;
        sun.position.z += gridZ;
        sun.target.position.set(gridX, 0, gridZ);
        gpu.shadowMap.needsUpdate = true;
      }

      let sceneStats = null;
      if (postPipeline) {
        sceneStats = postPipeline.render(scene, camera, quality, rw, rh, s);
      } else {
        gpu.setRenderTarget(null);
        gpu.toneMapping = T.ACESFilmicToneMapping;
        gpu.outputColorSpace = T.SRGBColorSpace;
        gpu.render(scene, camera);
      }
      window.renderStats = {
        backend: postPipeline ? 'WebGL-HDR' : 'WebGL',
        resolution: rw + '×' + rh,
        quality,
        scale,
        frameMs: average,
        drawCalls: sceneStats ? sceneStats.calls : gpu.info.render.calls,
        triangles: sceneStats ? sceneStats.triangles : gpu.info.render.triangles
      };
      return true;
    }
  };
})();
