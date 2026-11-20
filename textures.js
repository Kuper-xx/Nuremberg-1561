/* Photorealistic 4K procedural PBR texture & sprite atlas generator for Nuremberg 1561. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const PI = Math.PI;
  const clamp = (n, a, b) => (n < a ? a : n > b ? b : n);
  const lerp = (a, b, t) => a + (b - a) * t;
  const frac = x => x - Math.floor(x);
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const pow5 = x => {
    const x2 = x * x;
    return x2 * x2 * x;
  };

  // Precomputed linear-to-sRGB lookup table (4096 entries) for fast ACES filmic output.
  const GAMMA_LUT = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) {
    GAMMA_LUT[i] = Math.round(Math.pow(i / 4095, 1 / 2.2) * 255);
  }
  const toSRGB = v => {
    const a = v * (2.51 * v + 0.03);
    const b = v * (2.43 * v + 0.59) + 0.14;
    const mapped = a / (b > 1e-5 ? b : 1e-5);
    const c = mapped < 0 ? 0 : mapped > 1 ? 1 : mapped;
    return GAMMA_LUT[(c * 4095) | 0];
  };

  function mulberry32(seed) {
    let s = seed | 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rng = mulberry32(15610414);
  const PERM = new Uint8Array(512);
  const basePerm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) basePerm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = basePerm[i];
    basePerm[i] = basePerm[j];
    basePerm[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = basePerm[i & 255];

  const GRAD2X = new Float32Array(16);
  const GRAD2Y = new Float32Array(16);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    GRAD2X[i] = Math.cos(a);
    GRAD2Y[i] = Math.sin(a);
  }

  const GRAD3X = new Int8Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, -1, 0, 0]);
  const GRAD3Y = new Int8Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, 1, -1, -1]);
  const GRAD3Z = new Int8Array([0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 0, 1, -1]);

  function noise2(x, y) {
    const xi = x | 0;
    const yi = y | 0;
    const fx0 = x < xi ? xi - 1 : xi;
    const fy0 = y < yi ? yi - 1 : yi;
    const X = fx0 & 255;
    const Y = fy0 & 255;
    const xf = x - fx0;
    const yf = y - fy0;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);

    const px0 = PERM[X];
    const px1 = PERM[X + 1];
    const aa = PERM[px0 + Y] & 15;
    const ab = PERM[px0 + Y + 1] & 15;
    const ba = PERM[px1 + Y] & 15;
    const bb = PERM[px1 + Y + 1] & 15;

    const xf1 = xf - 1;
    const yf1 = yf - 1;
    const g00 = GRAD2X[aa] * xf + GRAD2Y[aa] * yf;
    const g10 = GRAD2X[ba] * xf1 + GRAD2Y[ba] * yf;
    const g01 = GRAD2X[ab] * xf + GRAD2Y[ab] * yf1;
    const g11 = GRAD2X[bb] * xf1 + GRAD2Y[bb] * yf1;

    const x1 = g00 + (g10 - g00) * u;
    const x2 = g01 + (g11 - g01) * u;
    return x1 + (x2 - x1) * v;
  }

  function noise3(x, y, z) {
    const xi = x | 0;
    const yi = y | 0;
    const zi = z | 0;
    const fx0 = x < xi ? xi - 1 : xi;
    const fy0 = y < yi ? yi - 1 : yi;
    const fz0 = z < zi ? zi - 1 : zi;
    const X = fx0 & 255;
    const Y = fy0 & 255;
    const Z = fz0 & 255;
    const xf = x - fx0;
    const yf = y - fy0;
    const zf = z - fz0;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);

    const A = PERM[X] + Y;
    const AA = PERM[A] + Z;
    const AB = PERM[A + 1] + Z;
    const B = PERM[X + 1] + Y;
    const BA = PERM[B] + Z;
    const BB = PERM[B + 1] + Z;

    const hAA0 = PERM[AA] & 15;
    const hBA0 = PERM[BA] & 15;
    const hAB0 = PERM[AB] & 15;
    const hBB0 = PERM[BB] & 15;
    const hAA1 = PERM[AA + 1] & 15;
    const hBA1 = PERM[BA + 1] & 15;
    const hAB1 = PERM[AB + 1] & 15;
    const hBB1 = PERM[BB + 1] & 15;

    const xf1 = xf - 1, yf1 = yf - 1, zf1 = zf - 1;
    const c000 = GRAD3X[hAA0] * xf + GRAD3Y[hAA0] * yf + GRAD3Z[hAA0] * zf;
    const c100 = GRAD3X[hBA0] * xf1 + GRAD3Y[hBA0] * yf + GRAD3Z[hBA0] * zf;
    const c010 = GRAD3X[hAB0] * xf + GRAD3Y[hAB0] * yf1 + GRAD3Z[hAB0] * zf;
    const c110 = GRAD3X[hBB0] * xf1 + GRAD3Y[hBB0] * yf1 + GRAD3Z[hBB0] * zf;
    const c001 = GRAD3X[hAA1] * xf + GRAD3Y[hAA1] * yf + GRAD3Z[hAA1] * zf1;
    const c101 = GRAD3X[hBA1] * xf1 + GRAD3Y[hBA1] * yf + GRAD3Z[hBA1] * zf1;
    const c011 = GRAD3X[hAB1] * xf + GRAD3Y[hAB1] * yf1 + GRAD3Z[hAB1] * zf1;
    const c111 = GRAD3X[hBB1] * xf1 + GRAD3Y[hBB1] * yf1 + GRAD3Z[hBB1] * zf1;

    const x1 = c000 + (c100 - c000) * u;
    const x2 = c010 + (c110 - c010) * u;
    const y1 = x1 + (x2 - x1) * v;

    const x3 = c001 + (c101 - c001) * u;
    const x4 = c011 + (c111 - c011) * u;
    const y2 = x3 + (x4 - x3) * v;

    return y1 + (y2 - y1) * w;
  }

  function fbm2(x, y, octaves = 4, lacunarity = 2.04, gain = 0.5) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise2(x * freq, y * freq) * amp;
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  }

  function billow2(x, y, octaves = 3, lacunarity = 2.05, gain = 0.5) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(noise2(x * freq, y * freq));
      sum += n * n * amp;
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  }

  function fbm3(x, y, z, octaves = 3, lacunarity = 2.06, gain = 0.5) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise3(x * freq, y * freq, z * freq) * amp;
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  }

  function ridged3(x, y, z, octaves = 2, lacunarity = 2.15, gain = 0.52) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(noise3(x * freq, y * freq, z * freq));
      sum += n * n * amp;
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  }

  function hash2i(ix, iy) {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Primary sunrise direction (upper-left, matching assets/nuremberg-dawn.png) & cool sky rim light.
  const SUN_LEN = Math.hypot(-0.56, 0.50, 0.66);
  const LX = -0.56 / SUN_LEN;
  const LY = 0.50 / SUN_LEN;
  const LZ = 0.66 / SUN_LEN;
  const H_LEN = Math.hypot(LX, LY, LZ + 1);
  const HX = LX / H_LEN;
  const HY = LY / H_LEN;
  const HZ = (LZ + 1) / H_LEN;
  const VDOTH = clamp(HZ, 0, 1);

  const RIM_LEN = Math.hypot(0.74, 0.36, -0.56);
  const RX_L = 0.74 / RIM_LEN;
  const RY_L = 0.36 / RIM_LEN;
  const RZ_L = -0.56 / RIM_LEN;

  /**
   * Cook-Torrance GGX PBR shader with Schlick Fresnel and 3D Nuremberg dawn environment reflection.
   * Writes straight RGBA directly into `data` at byte offset `idx`.
   */
  function writePBRPixel(
    data, idx,
    nx, ny, nz,
    ar, ag, ab,
    metallic, roughness, ao,
    er, eg, eb,
    alphaByte
  ) {
    const ndotv = nz > 0.004 ? nz : 0.004;
    const r = clamp(roughness, 0.07, 0.98);
    const a = r * r;
    const a2 = a * a;

    // Reflection vector R = 2*(N·V)*N - V (V = (0,0,1))
    const rfx = 2 * ndotv * nx;
    const rfy = 2 * ndotv * ny;
    const rfz = 2 * ndotv * nz - 1;

    // Sample Nuremberg dawn hemisphere IBL along R
    const horizWidth = 0.075 + r * 0.44;
    const sunAzimuth = clamp(0.54 - 0.50 * rfx + 0.14 * rfz, 0, 1);
    const cloudRip = r < 0.58 ? noise2(rfx * 2.6 + 1.4, rfy * 4.8) * (1 - r) * 0.16 : 0;

    let envR, envG, envB;
    if (rfy >= 0) {
      const skyT = clamp(rfy / 0.85, 0, 1);
      envR = lerp(0.36, 0.085, skyT) + cloudRip * 0.85;
      envG = lerp(0.45, 0.155, skyT) + cloudRip * 0.65;
      envB = lerp(0.55, 0.245, skyT) + cloudRip * 0.50;
    } else {
      const gndT = clamp(-rfy / 0.75, 0, 1);
      envR = lerp(0.24, 0.065, gndT);
      envG = lerp(0.27, 0.095, gndT);
      envB = lerp(0.23, 0.080, gndT);
    }

    const hDist = (rfy - 0.025) / horizWidth;
    const horizBand = Math.exp(-hDist * hDist);
    const horizWarm = 0.35 + 1.35 * sunAzimuth;
    envR += horizBand * lerp(0.22, 1.42, sunAzimuth) * horizWarm;
    envG += horizBand * lerp(0.24, 0.82, sunAzimuth) * horizWarm;
    envB += horizBand * lerp(0.29, 0.38, sunAzimuth) * horizWarm;

    // Direct sunrise GGX specular & diffuse
    const ndotl = Math.max(0, nx * LX + ny * LY + nz * LZ);
    const ndoth = Math.max(0, nx * HX + ny * HY + nz * HZ);
    const denom = ndoth * ndoth * (a2 - 1) + 1;
    const D = a2 / (PI * denom * denom + 1e-5);
    const k = (r + 1) * (r + 1) * 0.125;
    const G = (ndotv / (ndotv * (1 - k) + k)) * (ndotl / (ndotl * (1 - k) + k));

    const f0r = lerp(0.04, ar, metallic);
    const f0g = lerp(0.04, ag, metallic);
    const f0b = lerp(0.04, ab, metallic);

    const fv = pow5(1 - ndotv);
    const fh = pow5(1 - VDOTH);

    const fvr = f0r + (1 - f0r) * fv;
    const fvg = f0g + (1 - f0g) * fv;
    const fvb = f0b + (1 - f0b) * fv;

    const fhr = f0r + (1 - f0r) * fh;
    const fhg = f0g + (1 - f0g) * fh;
    const fhb = f0b + (1 - f0b) * fh;

    const specScale = ((D * G) / (4 * ndotv * ndotl + 0.002)) * ndotl;
    const sunR = 3.1, sunG = 2.48, sunB = 1.65;
    const invMet = 1 - metallic;
    const diffTerm = (ndotl / PI) * invMet;

    const envAO = lerp(1, ao, 0.72) * (1 - r * 0.42);
    const rimDot = Math.max(0, nx * RX_L + ny * RY_L + nz * RZ_L);
    const rim = rimDot * (1 - ndotv) * (1 - ndotv) * 0.78 * ao;

    const outR = diffTerm * (1 - fhr) * ar * sunR + specScale * fhr * sunR + invMet * ar * 0.24 * ao + fvr * envR * envAO + rim * 0.42 + er;
    const outG = diffTerm * (1 - fhg) * ag * sunG + specScale * fhg * sunG + invMet * ag * 0.29 * ao + fvg * envG * envAO + rim * 0.64 + eg;
    const outB = diffTerm * (1 - fhb) * ab * sunB + specScale * fhb * sunB + invMet * ab * 0.34 * ao + fvb * envB * envAO + rim * 0.86 + eb;

    data[idx] = toSRGB(outR);
    data[idx + 1] = toSRGB(outG);
    data[idx + 2] = toSRGB(outB);
    data[idx + 3] = alphaByte;
  }

  function createPixelSurface(width, height) {
    if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function') {
      return null;
    }
    try {
      const canvas = document.createElement('canvas');
      if (!canvas || typeof canvas.getContext !== 'function') return null;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx || typeof ctx.createImageData !== 'function' || typeof ctx.putImageData !== 'function') {
        return null;
      }
      const img = ctx.createImageData(width, height);
      if (!img || !img.data || img.data.length < width * height * 4) return null;
      return { canvas, ctx, img, data: img.data };
    } catch (_) {
      return null;
    }
  }

  function buildSphereCanvas(variant) {
    const W = 256, H = 256;
    const surface = createPixelSurface(W, H);
    if (!surface) return null;
    const { canvas, ctx, img, data } = surface;

    const cx = 128, cy = 128, R = 108, maxR = R + 18;
    const NPIX = W * H;
    const hBuf = new Float32Array(NPIX);
    const nxBuf = new Float32Array(NPIX);
    const nyBuf = new Float32Array(NPIX);
    const nzBuf = new Float32Array(NPIX);
    const plateBuf = new Float32Array(NPIX);
    const roughBuf = new Float32Array(NPIX);
    const aoBuf = new Float32Array(NPIX);
    const scorchBuf = new Float32Array(NPIX);
    const amberBuf = new Float32Array(NPIX);
    const cyanBuf = new Float32Array(NPIX);
    const aaBuf = new Uint8Array(NPIX);

    const yawA = [0.42, -0.58, 0.25][variant];
    const pitchA = [-0.26, 0.34, -0.44][variant];
    const cyA = Math.cos(yawA), syA = Math.sin(yawA);
    const cpA = Math.cos(pitchA), spA = Math.sin(pitchA);
    const seed = variant * 19.7;
    const lonPanels = variant === 1 ? 4.0 : 3.0;

    // Pass 1: single-pass 3D geometry, surface height, weathered noise & plasma seams
    for (let y = 0; y < H; y++) {
      const dy = y + 0.5 - cy;
      const rowOff = y * W;
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - cx;
        const dist = Math.hypot(dx, dy);
        if (dist > maxR) continue;

        const p = rowOff + x;
        if (dist >= R + 0.75) {
          // Soft outer plasma & dawn rim corona
          const idx = p * 4;
          const fall = Math.exp(-(dist - R) * 0.24) * smoothstep(maxR, R + 2, dist);
          const ang = Math.atan2(-dy, dx);
          const sunRim = 0.35 + 0.65 * Math.max(0, Math.cos(ang - 2.35));
          const er = (variant === 1 ? 0.18 : 0.75) * fall + sunRim * 0.28 * fall;
          const eg = (variant === 1 ? 0.62 : 0.42) * fall + sunRim * 0.24 * fall;
          const eb = (variant === 1 ? 0.92 : 0.16) * fall + sunRim * 0.18 * fall;
          const aByte = Math.round(clamp(fall * 0.62, 0, 1) * 255);
          if (aByte > 0) {
            data[idx] = toSRGB(er * 1.4);
            data[idx + 1] = toSRGB(eg * 1.4);
            data[idx + 2] = toSRGB(eb * 1.4);
            data[idx + 3] = aByte;
          }
          continue;
        }

        const rNorm = Math.min(0.9995, dist / R);
        const nx0 = dx / R;
        const ny0 = -dy / R;
        const nz0 = Math.sqrt(Math.max(1e-4, 1 - rNorm * rNorm));
        nxBuf[p] = nx0;
        nyBuf[p] = ny0;
        nzBuf[p] = nz0;
        aaBuf[p] = Math.round((dist > R - 0.75 ? clamp((R + 0.75 - dist) / 1.5, 0, 1) : 1) * 255);

        // Rotate geometric sphere coords into object-local 3D space
        const rx = nx0 * cyA - nz0 * syA;
        const rz1 = nx0 * syA + nz0 * cyA;
        const ry = ny0 * cpA - rz1 * spA;
        const rz = ny0 * spA + rz1 * cpA;

        const lat = Math.asin(clamp(ry, -1, 1));
        const lon = Math.atan2(rx, rz);

        const latScaled = lat * 2.0;
        const bandIdx = Math.floor(latScaled);
        const latFrac = latScaled - bandIdx;
        const latSeamDist = Math.min(latFrac, 1 - latFrac) * 0.5;
        const lonScaled = ((lon + PI) * lonPanels) / PI + (bandIdx & 1) * 0.5 + variant * 0.35;
        const lonIdx = Math.floor(lonScaled);
        const lonFrac = lonScaled - lonIdx;
        const merDist = Math.min(lonFrac, 1 - lonFrac) / lonPanels;

        const eqDist = Math.abs(lat);
        const tropicDist = Math.abs(Math.abs(lat) - 0.5);

        const eqGroove = smoothstep(0.068, 0.012, eqDist);
        const tropicGroove = smoothstep(0.036, 0.007, latSeamDist) * smoothstep(1.42, 1.10, Math.abs(lat));
        const merGroove = smoothstep(0.034, 0.005, merDist) * smoothstep(1.38, 1.05, Math.abs(lat));

        const irisDist = Math.hypot(rx, ry);
        const onFront = rz > 0.55;
        const irisBevel = onFront ? smoothstep(0.29, 0.23, irisDist) * smoothstep(0.17, 0.22, irisDist) : 0;
        const irisRing = onFront ? smoothstep(0.21, 0.185, irisDist) * smoothstep(0.145, 0.17, irisDist) : 0;
        const irisCore = onFront ? smoothstep(0.135, 0.02, irisDist) : 0;

        const seamDepth = Math.max(eqGroove * 0.95, tropicGroove * 0.62, merGroove * 0.52, irisBevel * 0.90);
        const macroWear = fbm3(rx * 4.4 + seed, ry * 4.4, rz * 4.4, 3);
        const brush = noise3(rx * 5.0 + seed, ry * 34.0, rz * 5.0) * 0.28;
        const pit = noise3(rx * 22.0 + seed, ry * 22.0, rz * 22.0) * 0.26;

        hBuf[p] = (macroWear * 0.042 + brush * 0.018 + pit * 0.015) - seamDepth * 0.11 - irisCore * 0.055;

        const plateId = hash2i(bandIdx + variant * 17, lonIdx);
        plateBuf[p] = (plateId - 0.5) * 0.24 + macroWear * 0.16;
        roughBuf[p] = (plateId - 0.5) * 0.10 + Math.abs(macroWear) * 0.18 + seamDepth * 0.22;
        aoBuf[p] = 1 - seamDepth * 0.58 - (onFront ? smoothstep(0.32, 0.17, irisDist) * 0.34 : 0);
        scorchBuf[p] = smoothstep(0.24, 0.55, macroWear);

        // Compute plasma turbulence only in or near emissive seams & emitter eye
        if (eqDist < 0.04 || tropicDist < 0.03 || (merDist < 0.025 && tropicDist < 0.04) || (onFront && irisDist < 0.24)) {
          const plasmaTurb = ridged3(rx * 9.5 + seed, ry * 9.5, rz * 9.5, 2);
          const eqPlasma = smoothstep(0.030, 0.003, eqDist) * (0.45 + 0.85 * plasmaTurb);
          const nodeMask = smoothstep(0.020, 0.002, merDist) * smoothstep(0.025, 0.004, tropicDist);
          const tropicLine = smoothstep(0.015, 0.002, tropicDist) * (0.25 + 0.75 * plasmaTurb);
          const irisEye = irisCore * irisCore * (1.1 + 0.55 * plasmaTurb);

          if (variant === 0) {
            amberBuf[p] = eqPlasma * 1.15 + irisEye * 1.25 + nodeMask * 0.7;
            cyanBuf[p] = tropicLine * 0.32 + irisRing * (0.45 + 0.4 * plasmaTurb);
          } else if (variant === 1) {
            cyanBuf[p] = eqPlasma * 1.18 + tropicLine * 0.65 + nodeMask * 0.75;
            amberBuf[p] = irisEye * 1.35 + irisRing * (0.40 + 0.35 * plasmaTurb);
          } else {
            const split = smoothstep(-0.15, 0.15, Math.sin(lon * 2.0 + lat * 2.0));
            const lineE = eqPlasma * 1.05 + tropicLine * 0.7 + nodeMask * 0.85;
            amberBuf[p] = lineE * split + irisEye * 1.15;
            cyanBuf[p] = lineE * (1 - split) + irisRing * (0.55 + 0.45 * plasmaTurb);
          }
        }
      }
    }

    // Pass 2: screen-space bump normal finite difference + Cook-Torrance GGX PBR shading
    const baseR = [0.24, 0.33, 0.15][variant];
    const baseG = [0.29, 0.24, 0.18][variant];
    const baseB = [0.31, 0.19, 0.23][variant];
    const baseRough = [0.27, 0.33, 0.23][variant];
    const baseMetal = [0.90, 0.87, 0.92][variant];

    for (let y = 0; y < H; y++) {
      const rowOff = y * W;
      for (let x = 0; x < W; x++) {
        const p = rowOff + x;
        const nz0 = nzBuf[p];
        if (nz0 <= 0) continue;

        const h0 = hBuf[p];
        const hL = x > 0 && nzBuf[p - 1] > 0 ? hBuf[p - 1] : h0;
        const hR = x < W - 1 && nzBuf[p + 1] > 0 ? hBuf[p + 1] : h0;
        const hU = y > 0 && nzBuf[p - W] > 0 ? hBuf[p - W] : h0;
        const hD = y < H - 1 && nzBuf[p + W] > 0 ? hBuf[p + W] : h0;

        const bump = 10.5 * (0.35 + 0.65 * nz0);
        let nx = nxBuf[p] + (hL - hR) * bump;
        let ny = nyBuf[p] + (hD - hU) * bump;
        let nz = nz0;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        nx /= nLen; ny /= nLen; nz /= nLen;

        const pVal = plateBuf[p];
        const scorch = scorchBuf[p];
        const ar = clamp(baseR * (1 + pVal) * (1 - scorch * 0.35), 0.03, 0.85);
        const ag = clamp(baseG * (1 + pVal) * (1 - scorch * 0.35), 0.03, 0.85);
        const ab = clamp(baseB * (1 + pVal) * (1 - scorch * 0.32), 0.03, 0.85);
        const rough = clamp(baseRough + roughBuf[p] + scorch * 0.14, 0.12, 0.86);
        const metal = clamp(baseMetal - scorch * 0.32, 0.25, 0.96);

        const am = amberBuf[p];
        const cyE = cyanBuf[p];
        const emR = am * 3.25 + cyE * 0.32;
        const emG = am * 1.28 + cyE * 2.15;
        const emB = am * 0.24 + cyE * 3.10;
        const limbAO = clamp(0.45 + 0.55 * Math.pow(nz0, 0.45), 0, 1);

        writePBRPixel(data, p * 4, nx, ny, nz, ar, ag, ab, metal, rough, aoBuf[p] * limbAO, emR, emG, emB, aaBuf[p]);
      }
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function buildCylinderCanvas() {
    const W = 384, H = 160;
    const surface = createPixelSurface(W, H);
    if (!surface) return null;
    const { canvas, ctx, img, data } = surface;

    const cx = 192, cy = 80, R = 54, straightHalfL = 112;
    const halfTotal = straightHalfL + R;
    const maxR = R + 18;
    const NPIX = W * H;

    const hBuf = new Float32Array(NPIX);
    const nxBuf = new Float32Array(NPIX);
    const nyBuf = new Float32Array(NPIX);
    const nzBuf = new Float32Array(NPIX);
    const plateBuf = new Float32Array(NPIX);
    const roughBuf = new Float32Array(NPIX);
    const aoBuf = new Float32Array(NPIX);
    const scorchBuf = new Float32Array(NPIX);
    const amberBuf = new Float32Array(NPIX);
    const cyanBuf = new Float32Array(NPIX);
    const aaBuf = new Uint8Array(NPIX);
    const ribPos = [-0.66, -0.34, 0.0, 0.34, 0.66];

    for (let y = 0; y < H; y++) {
      const dy = y + 0.5 - cy;
      const rowOff = y * W;
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - cx;
        const ax = clamp(dx, -straightHalfL, straightHalfL);
        const ux = dx - ax;
        const uy = -dy;
        const dist = Math.hypot(ux, uy);
        if (dist > maxR) continue;

        const p = rowOff + x;
        if (dist >= R + 0.75) {
          const idx = p * 4;
          const fall = Math.exp(-(dist - R) * 0.24) * smoothstep(maxR, R + 2, dist);
          const vpAlign = smoothstep(72, 10, Math.abs(dx - 3));
          const sternAlign = smoothstep(-95, -155, dx);
          const er = (0.35 + vpAlign * 0.85) * fall;
          const eg = (0.32 + vpAlign * 0.42 + sternAlign * 0.45) * fall;
          const eb = (0.28 + sternAlign * 0.85) * fall;
          const aByte = Math.round(clamp(fall * 0.55, 0, 1) * 255);
          if (aByte > 0) {
            data[idx] = toSRGB(er * 1.3);
            data[idx + 1] = toSRGB(eg * 1.3);
            data[idx + 2] = toSRGB(eb * 1.3);
            data[idx + 3] = aByte;
          }
          continue;
        }

        const rNorm = Math.min(0.9995, dist / R);
        const nx0 = ux / R;
        const ny0 = uy / R;
        const nz0 = Math.sqrt(Math.max(1e-4, 1 - rNorm * rNorm));
        nxBuf[p] = nx0;
        nyBuf[p] = ny0;
        nzBuf[p] = nz0;
        aaBuf[p] = Math.round((dist > R - 0.75 ? clamp((R + 0.75 - dist) / 1.5, 0, 1) : 1) * 255);

        const u = dx / halfTotal;
        const theta = Math.atan2(ny0, nz0);

        let rib = 0, ribGroove = 0;
        for (let i = 0; i < 5; i++) {
          const d = Math.abs(u - ribPos[i]);
          if (d < 0.044) {
            rib = Math.max(rib, smoothstep(0.036, 0.016, d));
            ribGroove = Math.max(ribGroove, smoothstep(0.044, 0.034, d) * smoothstep(0.022, 0.032, d));
          }
        }

        const uScaled = (u + 1.0) * 6.0;
        const stationIdx = Math.floor(uScaled);
        const uF = uScaled - stationIdx;
        const uSeamDist = Math.min(uF, 1 - uF);

        const tScaled = (theta + PI) * 4.0 + (stationIdx & 1) * 0.5;
        const tIdx = Math.floor(tScaled);
        const tF = tScaled - tIdx;
        const tSeamDist = Math.min(tF, 1 - tF);
        const panelSeam = Math.max(smoothstep(0.052, 0.010, uSeamDist), smoothstep(0.052, 0.010, tSeamDist));

        const vpU = Math.abs(u - 0.02);
        const vpY = Math.abs(ny0 - 0.04);
        const vpOuter = smoothstep(0.32, 0.28, vpU) * smoothstep(0.19, 0.14, vpY);
        const vpCore = smoothstep(0.28, 0.24, vpU) * smoothstep(0.11, 0.06, vpY);
        const mPhase = frac((u - 0.02) * 9.0);
        const mullion = smoothstep(0.022, 0.007, Math.abs(mPhase - 0.5));
        const vpWindow = vpCore * (1 - mullion * 0.92);

        const sternLouver = smoothstep(0.03, 0.005, Math.abs(frac(ny0 * 8.0) - 0.5));
        const sternVent = u < -0.75 ? smoothstep(-0.76, -0.84, u) * smoothstep(0.18, 0.04, Math.abs(ny0)) * (1 - sternLouver * 0.75) : 0;
        const bowSlit = u > 0.79 ? smoothstep(0.80, 0.86, u) * smoothstep(0.07, 0.015, Math.abs(ny0)) : 0;

        const macro = fbm3(u * 6.5, ny0 * 4.5, nz0 * 4.5, 3);
        const axialBrush = noise2(u * 4.0, theta * 46.0) * 0.24;
        const micro = noise3(u * 24.0 + 3.7, ny0 * 18.0, nz0 * 18.0) * 0.26;

        hBuf[p] = rib * 0.058 - ribGroove * 0.040 - panelSeam * 0.036 - vpOuter * 0.070 +
          (macro * 0.030 + axialBrush * 0.015 + micro * 0.013);

        const plateHash = hash2i(stationIdx + 31, tIdx);
        plateBuf[p] = (plateHash - 0.5) * 0.24 + macro * 0.16;
        roughBuf[p] = (plateHash - 0.5) * 0.10 + Math.abs(macro) * 0.18 + panelSeam * 0.20 - rib * 0.06;
        scorchBuf[p] = smoothstep(0.22, 0.58, macro) + smoothstep(-0.55, -0.95, u) * 0.35;
        aoBuf[p] = 1 - panelSeam * 0.48 - ribGroove * 0.45 - (vpOuter - vpCore) * 0.55;

        const ribNode = rib > 0.05 ? smoothstep(0.08, 0.01, Math.abs(ny0 - 0.42)) : 0;
        if (vpWindow > 0.01 || vpOuter > 0.01 || sternVent > 0.01 || bowSlit > 0.01 || ribNode > 0.01) {
          const turb = ridged3(u * 14.0, ny0 * 12.0, nz0 * 12.0, 2);
          const vpBounce = smoothstep(0.36, 0.26, vpU) * smoothstep(0.26, 0.12, vpY) * (1 - vpCore);
          amberBuf[p] = vpWindow * (1.25 + 0.55 * turb) + vpBounce * 0.24 + bowSlit * 0.85;
          cyanBuf[p] = sternVent * (0.75 + 0.5 * turb) + rib * ribNode * 0.65;
        }
      }
    }

    for (let y = 0; y < H; y++) {
      const rowOff = y * W;
      for (let x = 0; x < W; x++) {
        const p = rowOff + x;
        const nz0 = nzBuf[p];
        if (nz0 <= 0) continue;

        const h0 = hBuf[p];
        const hL = x > 0 && nzBuf[p - 1] > 0 ? hBuf[p - 1] : h0;
        const hR = x < W - 1 && nzBuf[p + 1] > 0 ? hBuf[p + 1] : h0;
        const hU = y > 0 && nzBuf[p - W] > 0 ? hBuf[p - W] : h0;
        const hD = y < H - 1 && nzBuf[p + W] > 0 ? hBuf[p + W] : h0;

        const bump = 10.0 * (0.35 + 0.65 * nz0);
        let nx = nxBuf[p] + (hL - hR) * bump;
        let ny = nyBuf[p] + (hD - hU) * bump;
        let nz = nz0;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        nx /= nLen; ny /= nLen; nz /= nLen;

        const pVal = plateBuf[p];
        const scorch = scorchBuf[p];
        const ar = clamp(0.28 * (1 + pVal) * (1 - scorch * 0.30), 0.04, 0.85);
        const ag = clamp(0.30 * (1 + pVal) * (1 - scorch * 0.32), 0.04, 0.85);
        const ab = clamp(0.29 * (1 + pVal) * (1 - scorch * 0.30), 0.04, 0.85);
        const rough = clamp(0.29 + roughBuf[p] + scorch * 0.12, 0.14, 0.85);
        const metal = clamp(0.89 - scorch * 0.28, 0.3, 0.96);

        const am = amberBuf[p];
        const cyE = cyanBuf[p];
        const emR = am * 3.4 + cyE * 0.25;
        const emG = am * 1.45 + cyE * 2.10;
        const emB = am * 0.30 + cyE * 3.15;
        const limbAO = clamp(0.42 + 0.58 * Math.pow(nz0, 0.45), 0, 1);

        writePBRPixel(data, p * 4, nx, ny, nz, ar, ag, ab, metal, rough, aoBuf[p] * limbAO, emR, emG, emB, aaBuf[p]);
      }
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function buildCrossCanvas() {
    const W = 256, H = 256;
    const surface = createPixelSurface(W, H);
    if (!surface) return null;
    const { canvas, ctx, img, data } = surface;

    const cx = 128, cy = 128, armLen = 82, armW = 11.8, centerR = 31, nodeR = 21;
    const orbs = [
      [0, 0, centerR, 1],
      [armLen, 0, nodeR, 0],
      [-armLen, 0, nodeR, 0],
      [0, armLen, nodeR, 0],
      [0, -armLen, nodeR, 0]
    ];

    const NPIX = W * H;
    const nBuf = new Float32Array(NPIX);
    const nxBuf = new Float32Array(NPIX);
    const nyBuf = new Float32Array(NPIX);
    const nzBuf = new Float32Array(NPIX);
    const typeBuf = new Uint8Array(NPIX); // 0=empty, 1=beam, 2=outerOrb, 3=hubOrb
    const orbRBuf = new Float32Array(NPIX);
    const extraBuf = new Float32Array(NPIX);
    const aoBuf = new Float32Array(NPIX);
    const aaBuf = new Uint8Array(NPIX);

    for (let y = 0; y < H; y++) {
      const dy = -(y + 0.5 - cy);
      const rowOff = y * W;
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - cx;
        const p = rowOff + x;

        let bestZ = -1;
        let nx = 0, ny = 0, nz = 1;
        let edgeDist = 999;
        let isOrb = false, orbIsHub = false, orbLocalR = 0, beamSpine = 0, collarAO = 1;

        if (Math.abs(dx) <= armLen) {
          const ady = Math.abs(dy);
          const ed = ady - armW;
          if (ed < edgeDist) edgeDist = ed;
          if (ady < armW + 0.75) {
            const rn = Math.min(0.999, ady / armW);
            const z = Math.sqrt(Math.max(1e-4, 1 - rn * rn)) * armW * 1.15;
            if (z > bestZ) {
              bestZ = z; nx = 0; ny = dy / armW;
              nz = Math.sqrt(Math.max(1e-4, 1 - rn * rn));
              beamSpine = smoothstep(4.2, 0.8, ady);
            }
          }
        }

        if (Math.abs(dy) <= armLen) {
          const adx = Math.abs(dx);
          const ed = adx - armW;
          if (ed < edgeDist) edgeDist = ed;
          if (adx < armW + 0.75) {
            const rn = Math.min(0.999, adx / armW);
            const z = Math.sqrt(Math.max(1e-4, 1 - rn * rn)) * armW * 1.15;
            if (z > bestZ) {
              bestZ = z; nx = dx / armW; ny = 0;
              nz = Math.sqrt(Math.max(1e-4, 1 - rn * rn));
              beamSpine = smoothstep(4.2, 0.8, adx);
            }
          }
        }

        for (let i = 0; i < 5; i++) {
          const ox = orbs[i][0], oy = orbs[i][1], ro = orbs[i][2];
          const d = Math.hypot(dx - ox, dy - oy);
          const ed = d - ro;
          if (ed < edgeDist) edgeDist = ed;
          if (ed > -2 && ed < 11) {
            collarAO = Math.min(collarAO, 0.52 + 0.48 * smoothstep(0, 10, ed));
          }
          if (d < ro + 0.75) {
            const rn = Math.min(0.999, d / ro);
            const z = Math.sqrt(Math.max(1e-4, 1 - rn * rn)) * ro * 1.32;
            if (z > bestZ) {
              bestZ = z;
              nx = (dx - ox) / ro;
              ny = (dy - oy) / ro;
              nz = Math.sqrt(Math.max(1e-4, 1 - rn * rn));
              isOrb = true;
              orbIsHub = !!orbs[i][3];
              orbLocalR = rn;
            }
          }
        }

        if (edgeDist > 0.75) {
          if (edgeDist < 19) {
            const fall = Math.exp(-edgeDist * 0.25) * smoothstep(19, 1.5, edgeDist);
            const hubBoost = 1 + 0.65 * smoothstep(64, 24, Math.hypot(dx, dy));
            const aByte = Math.round(clamp(fall * 0.68 * hubBoost, 0, 1) * 255);
            if (aByte > 0) {
              const idx = p * 4;
              data[idx] = toSRGB(1.35 * fall * hubBoost);
              data[idx + 1] = toSRGB(0.58 * fall * hubBoost);
              data[idx + 2] = toSRGB(0.14 * fall * hubBoost);
              data[idx + 3] = aByte;
            }
          }
          continue;
        }

        nxBuf[p] = nx; nyBuf[p] = ny; nzBuf[p] = nz;
        nBuf[p] = fbm3(dx * 0.085, dy * 0.085, nz * 1.8, 3);
        typeBuf[p] = isOrb ? (orbIsHub ? 3 : 2) : 1;
        orbRBuf[p] = orbLocalR;
        extraBuf[p] = beamSpine;
        aoBuf[p] = collarAO;
        aaBuf[p] = Math.round((edgeDist > -0.75 ? clamp((0.75 - edgeDist) / 1.5, 0, 1) : 1) * 255);
      }
    }

    for (let y = 0; y < H; y++) {
      const dy = -(y + 0.5 - cy);
      const rowOff = y * W;
      for (let x = 0; x < W; x++) {
        const p = rowOff + x;
        const kind = typeBuf[p];
        if (kind === 0) continue;

        const dx = x + 0.5 - cx;
        const n3 = nBuf[p];
        const nL = x > 0 && typeBuf[p - 1] ? nBuf[p - 1] : n3;
        const nR = x < W - 1 && typeBuf[p + 1] ? nBuf[p + 1] : n3;
        const nU = y > 0 && typeBuf[p - W] ? nBuf[p - W] : n3;
        const nD = y < H - 1 && typeBuf[p + W] ? nBuf[p + W] : n3;

        let nx = nxBuf[p] + (nL - nR) * 1.6;
        let ny = nyBuf[p] + (nD - nU) * 1.6;
        let nz = nzBuf[p];
        const nLen = Math.hypot(nx, ny, nz) || 1;
        nx /= nLen; ny /= nLen; nz /= nLen;

        let ar, ag, ab, metal, rough, ao, er = 0, eg = 0, eb = 0;
        if (kind >= 2) {
          const orbIsHub = kind === 3;
          const orbLocalR = orbRBuf[p];
          const ringGroove = smoothstep(0.065, 0.015, Math.abs(orbLocalR - 0.62));
          const core = smoothstep(0.46, 0.04, orbLocalR);
          const turb = (core > 0.01 || ringGroove > 0.01) ? ridged3(dx * 0.09, dy * 0.09, nz * 2.5, 2) : 0;
          const coreHot = core * core;
          const glow = core * (0.65 + 0.55 * turb) + ringGroove * (orbIsHub ? 0.80 : 0.45);

          ar = clamp(0.45 + n3 * 0.14 - ringGroove * 0.12, 0.08, 0.85);
          ag = clamp(0.32 + n3 * 0.10 - ringGroove * 0.10, 0.08, 0.85);
          ab = clamp(0.20 + n3 * 0.08, 0.06, 0.75);
          metal = 0.91;
          rough = clamp(0.22 + Math.abs(n3) * 0.18 + ringGroove * 0.15, 0.12, 0.75);
          ao = clamp((0.45 + 0.55 * Math.pow(nz, 0.45)) * (1 - ringGroove * 0.35), 0, 1);

          const hubGain = orbIsHub ? 1.35 : 0.95;
          er = glow * 3.1 * hubGain + coreHot * 1.4;
          eg = glow * 1.05 * hubGain + coreHot * 1.35;
          eb = glow * 0.14 * hubGain + coreHot * 0.75 + ringGroove * 0.25;
        } else {
          const beamSpine = extraBuf[p];
          const turb = beamSpine > 0.01 ? ridged3(dx * 0.10, dy * 0.10, nz * 2.0, 2) : 0;
          ar = clamp(0.28 + n3 * 0.10, 0.06, 0.7);
          ag = clamp(0.25 + n3 * 0.08, 0.06, 0.7);
          ab = clamp(0.22 + n3 * 0.07, 0.06, 0.7);
          metal = 0.86;
          rough = clamp(0.34 + Math.abs(n3) * 0.20, 0.16, 0.82);
          ao = clamp((0.42 + 0.58 * Math.pow(nz, 0.4)) * aoBuf[p] * (1 - beamSpine * 0.3), 0, 1);

          const conduit = beamSpine * (0.45 + 0.75 * turb);
          er = conduit * 2.35;
          eg = conduit * 0.92;
          eb = conduit * 0.25;
        }

        writePBRPixel(data, p * 4, nx, ny, nz, ar, ag, ab, metal, rough, ao, er, eg, eb, aaBuf[p]);
      }
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  const CLOUD_LOBES = [
    [
      [0.48, 0.58, 0.34, 0.24, 0.95],
      [0.34, 0.52, 0.22, 0.22, 0.90],
      [0.64, 0.55, 0.22, 0.20, 0.88],
      [0.44, 0.38, 0.17, 0.20, 0.92],
      [0.57, 0.43, 0.15, 0.18, 0.82],
      [0.24, 0.62, 0.16, 0.15, 0.74],
      [0.76, 0.63, 0.16, 0.14, 0.72]
    ],
    [
      [0.50, 0.58, 0.38, 0.18, 0.92],
      [0.28, 0.55, 0.22, 0.16, 0.84],
      [0.72, 0.58, 0.21, 0.15, 0.82],
      [0.39, 0.43, 0.19, 0.17, 0.86],
      [0.60, 0.46, 0.18, 0.16, 0.84],
      [0.18, 0.60, 0.14, 0.12, 0.65]
    ],
    [
      [0.34, 0.54, 0.22, 0.22, 0.94],
      [0.65, 0.56, 0.23, 0.22, 0.92],
      [0.50, 0.60, 0.26, 0.18, 0.84],
      [0.31, 0.37, 0.15, 0.18, 0.88],
      [0.67, 0.40, 0.16, 0.19, 0.88],
      [0.49, 0.48, 0.14, 0.15, 0.72]
    ]
  ];

  function buildCloudCanvas(variant) {
    const W = 320, H = 180;
    const surface = createPixelSurface(W, H);
    if (!surface) return null;
    const { canvas, ctx, img, data } = surface;

    const dens = new Float32Array(W * H);
    const lobes = CLOUD_LOBES[variant];
    const sx = variant * 13.7, sy = variant * 9.3;

    // Pass 1: evaluate volumetric cumulus density grid once
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      const ey = (v - 0.52) / 0.44;
      const ey2 = ey * ey;
      if (ey2 >= 1.05) continue;
      const rowOff = y * W;

      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        const ex = (u - 0.5) / 0.47;
        const envR2 = ex * ex + ey2;
        if (envR2 >= 1.05) continue;

        let base = 0;
        for (let i = 0; i < lobes.length; i++) {
          const lx = (u - lobes[i][0]) / lobes[i][2];
          const ly = (v - lobes[i][1]) / lobes[i][3];
          const d2 = lx * lx + ly * ly;
          if (d2 < 1.2) {
            const val = (1 - d2) * lobes[i][4];
            if (val > base) base = val;
          }
        }
        if (base <= 0.01) continue;

        const edgeMask = smoothstep(1.04, 0.48, envR2);
        const wx = fbm2(u * 2.8 + sx, v * 2.8 + sy, 2) * 0.09;
        const wy = fbm2(u * 2.8 + sx + 4.2, v * 2.8 + sy + 1.9, 2) * 0.08;
        const fbmVal = fbm2((u + wx) * 5.2 + sx, (v + wy) * 4.4 + sy, 4);
        const billow = billow2((u + wx) * 9.5 + sx, (v + wy) * 8.2 + sy, 2) * 0.24;

        const baseWisp = smoothstep(0.81 + wy * 0.95, 0.55 + wy * 0.55, v);
        const raw = (base * 0.92 + fbmVal * 0.38 + billow - 0.27) * baseWisp * edgeMask;
        if (raw > 0) dens[rowOff + x] = clamp(raw * 1.65, 0, 1);
      }
    }

    // Pass 2: volumetric self-shadowing toward upper-left sunrise via grid sampling
    const sampleDens = (fx, fy) => {
      const ix = clamp(fx | 0, 0, W - 1);
      const iy = clamp(fy | 0, 0, H - 1);
      return dens[iy * W + ix];
    };

    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      const heightMix = clamp(1 - (v - 0.22) / 0.58, 0, 1);
      const shadR = lerp(0.18, 0.34, heightMix);
      const shadG = lerp(0.23, 0.40, heightMix);
      const shadB = lerp(0.30, 0.49, heightMix);
      const rowOff = y * W;

      for (let x = 0; x < W; x++) {
        const density = dens[rowOff + x];
        if (density <= 0.015) continue;

        const d1 = sampleDens(x - 7, y - 6);
        const d2 = sampleDens(x - 15, y - 13);
        const d3 = sampleDens(x - 26, y - 22);
        const d4 = sampleDens(x - 40, y - 34);
        const tau = d1 * 0.30 + d2 * 0.35 + d3 * 0.30 + d4 * 0.25;

        const transmittance = Math.exp(-tau * 2.55);
        const sunFacing = clamp((density - d1) * 2.2 + 0.55, 0, 1);
        const powder = (1 - Math.exp(-density * 5.2)) * Math.exp(-density * 0.95);
        const silverLining = clamp(transmittance * powder * (0.65 + 0.95 * sunFacing) * 1.85, 0, 1.35);
        const directLit = clamp(transmittance * (0.45 + 0.55 * heightMix), 0, 1);

        const litR = lerp(0.86, 1.04, silverLining * 0.6);
        const litG = lerp(0.75, 0.89, silverLining * 0.6);
        const litB = lerp(0.67, 0.77, silverLining * 0.5);

        const cr = lerp(shadR, litR, directLit) + silverLining * 0.42;
        const cg = lerp(shadG, litG, directLit) + silverLining * 0.35;
        const cb = lerp(shadB, litB, directLit) + silverLining * 0.26;
        const a = smoothstep(0.015, 0.72, density) * 0.94;

        const idx = (rowOff + x) * 4;
        data[idx] = GAMMA_LUT[(clamp(cr, 0, 1) * 4095) | 0];
        data[idx + 1] = GAMMA_LUT[(clamp(cg, 0, 1) * 4095) | 0];
        data[idx + 2] = GAMMA_LUT[(clamp(cb, 0, 1) * 4095) | 0];
        data[idx + 3] = Math.round(a * 255);
      }
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function buildFireballCanvas(variant) {
    const W = 256, H = 256;
    const surface = createPixelSurface(W, H);
    if (!surface) return null;
    const { canvas, ctx, img, data } = surface;

    const cx = 128, cy = 128, maxR = 112;
    const sx = variant * 17.3 + 4.1;
    const sy = variant * 11.9 + 8.3;
    const tilt = [0.0, -0.35, 0.42][variant];
    const ct = Math.cos(tilt), st = Math.sin(tilt);

    for (let y = 0; y < H; y++) {
      const dy0 = (y + 0.5 - cy) / maxR;
      const rowOff = y * W;
      for (let x = 0; x < W; x++) {
        const dx0 = (x + 0.5 - cx) / maxR;
        const r0 = Math.hypot(dx0, dy0);
        if (r0 > 1.08) continue;

        const dx = dx0 * ct - dy0 * st;
        const dy = dx0 * st + dy0 * ct;

        const wx = fbm2(dx * 2.6 + sx, dy * 2.6 + sy, 2) * 0.24;
        const wy = fbm2(dx * 2.6 + sx + 5.7, dy * 2.6 + sy + 2.9, 2) * 0.24;
        const nFine = fbm2((dx + wx) * 5.8 + sx, (dy + wy) * 5.8 + sy, 3);
        const ridge = 1 - Math.abs(noise2((dx + wx) * 7.2 + sx, (dy + wy) * 7.2 + sy));

        const lobeWarp = fbm2(dx * 1.85 + sx, dy * 1.85 + sy, 2) * 0.34;
        const rDist = r0 + lobeWarp * (0.32 + 0.68 * r0);
        const coreFall = Math.max(0, 1 - rDist);
        const cfSmooth = coreFall * (0.80 + 0.20 * coreFall);

        const temp = clamp(
          cfSmooth * 1.15 +
          nFine * 0.34 * smoothstep(0.05, 0.7, coreFall) +
          ridge * ridge * 0.28 * smoothstep(0.08, 0.85, coreFall),
          0,
          1.25
        );

        const alpha = smoothstep(0.06, 0.34, temp) * smoothstep(1.06, 0.72, r0);
        if (alpha <= 0.005) continue;

        let rCol, gCol, bCol;
        if (temp > 0.88) {
          const t = clamp((temp - 0.88) / 0.32, 0, 1);
          rCol = 255;
          gCol = lerp(225, 254, t);
          bCol = lerp(115, 240, t);
        } else if (temp > 0.58) {
          const t = (temp - 0.58) / 0.30;
          rCol = 255;
          gCol = lerp(128, 225, t);
          bCol = lerp(28, 115, t);
        } else if (temp > 0.28) {
          const t = (temp - 0.28) / 0.30;
          rCol = lerp(205, 255, t);
          gCol = lerp(34, 128, t);
          bCol = lerp(10, 28, t);
        } else {
          const t = clamp(temp / 0.28, 0, 1);
          rCol = lerp(65, 205, t);
          gCol = lerp(14, 34, t);
          bCol = 10;
        }

        const idx = (rowOff + x) * 4;
        data[idx] = Math.round(rCol);
        data[idx + 1] = Math.round(gCol);
        data[idx + 2] = Math.round(bCol);
        data[idx + 3] = Math.round(alpha * 255);
      }
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function buildSmokeCanvas(variant) {
    const W = 256, H = 256;
    const surface = createPixelSurface(W, H);
    if (!surface) return null;
    const { canvas, ctx, img, data } = surface;

    const cx = 128, cy = 128, maxR = 110;
    const sx = variant * 15.1 + 2.7;
    const sy = variant * 12.4 + 6.1;
    const dens = new Float32Array(W * H);

    // Pass 1: evaluate turbulent billowing smoke density once
    for (let y = 0; y < H; y++) {
      const dy = (y + 0.5 - cy) / maxR;
      const rowOff = y * W;
      for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - cx) / maxR;
        const r = Math.hypot(dx, dy);
        if (r > 1.08) continue;

        const edgeMask = smoothstep(1.06, 0.45, r);
        const wx = fbm2(dx * 2.2 + sx, dy * 2.2 + sy, 2) * 0.18;
        const wy = fbm2(dx * 2.2 + sx + 3.9, dy * 2.2 + sy + 7.2, 2) * 0.18;
        const billow = billow2((dx + wx) * 3.6 + sx, (dy + wy) * 3.6 + sy, 3);
        const fbm = fbm2((dx + wx) * 5.2 + sx, (dy + wy) * 5.2 + sy, 3);

        const core = Math.max(0, 1 - r * 0.88);
        const d = (core * 0.68 + billow * 0.44 + fbm * 0.22 - 0.24) * edgeMask;
        if (d > 0) dens[rowOff + x] = clamp(d * 1.45, 0, 1);
      }
    }

    // Pass 2: directional self-shadowing from upper-left sunrise via grid lookup
    const sampleDens = (ix, iy) => {
      const cx0 = clamp(ix, 0, W - 1);
      const cy0 = clamp(iy, 0, H - 1);
      return dens[cy0 * W + cx0];
    };

    for (let y = 0; y < H; y++) {
      const rowOff = y * W;
      for (let x = 0; x < W; x++) {
        const density = dens[rowOff + x];
        if (density <= 0.015) continue;

        const dSun1 = sampleDens(x - 10, y - 10);
        const dSun2 = sampleDens(x - 24, y - 24);
        const occ = dSun1 * 0.55 + dSun2 * 0.45;
        const slope = clamp((density - dSun1) * 2.8 + 0.35, 0, 1);
        const lit = clamp(Math.exp(-occ * 3.1) * (0.32 + 0.68 * slope), 0, 1);

        const a = smoothstep(0.02, 0.72, density) * 0.92;
        const idx = (rowOff + x) * 4;
        data[idx] = Math.round(lerp(18, 152, lit));
        data[idx + 1] = Math.round(lerp(17, 134, lit));
        data[idx + 2] = Math.round(lerp(20, 124, lit));
        data[idx + 3] = Math.round(a * 255);
      }
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function buildCanopyGlassCanvas() {
    const W = 512, H = 512;
    const surface = createPixelSurface(W, H);
    if (!surface) return null;
    const { canvas, ctx, img, data } = surface;

    // 1. Optical canopy polish micro-scratches
    const scratchBuf = new Float32Array(W * H);
    const sRng = mulberry32(1561099);
    const lightAng = -2.35;
    for (let i = 0; i < 115; i++) {
      const rNorm = 0.36 + sRng() * 0.62;
      const baseAng = sRng() * TAU;
      const cx0 = 256 + Math.cos(baseAng) * rNorm * 235;
      const cy0 = 256 + Math.sin(baseAng) * rNorm * 235;
      const arcR = 28 + sRng() * 95;
      const startA = sRng() * TAU;
      const sweep = (0.35 + sRng() * 0.85) * (sRng() < 0.5 ? 1 : -1);
      const steps = Math.max(18, Math.round(Math.abs(sweep) * arcR * 1.4));
      const baseStrength = 0.25 + sRng() * 0.65;

      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const a = startA + sweep * t;
        const px = cx0 + Math.cos(a) * arcR;
        const py = cy0 + Math.sin(a) * arcR;
        const ix = px | 0, iy = py | 0;
        if (ix < 1 || ix >= W - 1 || iy < 1 || iy >= H - 1) continue;

        const tang = a + PI * 0.5;
        const gSin = Math.sin(tang - lightAng);
        const glint = gSin * gSin * gSin * gSin;
        const fadeEnd = Math.sin(t * PI);
        const val = baseStrength * fadeEnd * (0.18 + 0.82 * glint);

        const fx = px - ix, fy = py - iy;
        scratchBuf[iy * W + ix] += val * (1 - fx) * (1 - fy);
        scratchBuf[iy * W + ix + 1] += val * fx * (1 - fy);
        scratchBuf[(iy + 1) * W + ix] += val * (1 - fx) * fy;
        scratchBuf[(iy + 1) * W + ix + 1] += val * fx * fy;
      }
    }

    // 2. Pass 1: Curved polycarbonate Fresnel sheen, visor edge refraction & optical micro-scratches
    for (let y = 0; y < H; y++) {
      const ny = (y + 0.5 - 256) / 256;
      const topBias = smoothstep(0.55, -0.85, ny);
      const rowOff = y * W;

      for (let x = 0; x < W; x++) {
        const nx = (x + 0.5 - 256) / 256;
        const er = Math.hypot(nx, ny);
        const pIdx = rowOff + x;
        const scratch = scratchBuf[pIdx];

        if (er <= 0.42 && scratch <= 0.01) continue;

        const fresnel = smoothstep(0.46, 1.12, er);
        const edgeBand = smoothstep(0.76, 1.04, er);
        const frostNoise = er > 0.68 ? fbm2(x * 0.032, y * 0.032, 2) * 0.5 + 0.5 : 0;
        const sunSide = smoothstep(0.45, -0.85, nx);

        let rCol = lerp(145, 245, sunSide * 0.7 + topBias * 0.3);
        let gCol = lerp(195, 222, sunSide * 0.5 + topBias * 0.4);
        let bCol = lerp(225, 195, sunSide * 0.4);
        let alpha = fresnel * (0.038 + 0.075 * topBias) + edgeBand * (0.065 + 0.065 * frostNoise);

        // Smooth single-band visor edge chromatic refraction (warm amber inner bevel -> cool cyan rim)
        if (edgeBand > 0.02) {
          const innerRim = smoothstep(0.76, 0.89, er) * smoothstep(1.02, 0.89, er);
          const outerRim = smoothstep(0.88, 1.04, er);
          rCol = clamp(rCol + innerRim * 46 - outerRim * 28, 0, 255);
          gCol = clamp(gCol + innerRim * 16 + outerRim * 14, 0, 255);
          bCol = clamp(bCol - innerRim * 22 + outerRim * 42, 0, 255);
        }

        if (scratch > 0.01) {
          const sMask = smoothstep(0.20, 0.85, er) * 0.55 + 0.12;
          const sAmt = clamp(scratch * sMask, 0, 0.45);
          rCol = lerp(rCol, 255, 0.75);
          gCol = lerp(gCol, 236, 0.75);
          bCol = lerp(bCol, 205, 0.75);
          alpha = Math.max(alpha, sAmt * 0.42);
        }

        const aByte = Math.round(clamp(alpha, 0, 0.82) * 255);
        if (aByte > 0) {
          const idx = pIdx * 4;
          data[idx] = Math.round(clamp(rCol, 0, 255));
          data[idx + 1] = Math.round(clamp(gCol, 0, 255));
          data[idx + 2] = Math.round(clamp(bCol, 0, 255));
          data[idx + 3] = aByte;
        }
      }
    }

    // 3. Pass 2: Stamp high-altitude condensation micro-droplets only inside their tight bounding boxes
    const CELL = 16, G = 32;
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        const cxCell = (gx + 0.5) * CELL;
        const cyCell = (gy + 0.5) * CELL;
        const erCell = Math.hypot((cxCell - 256) / 256, (cyCell - 256) / 256);
        const h1 = hash2i(gx + 11, gy + 37);
        const prob = smoothstep(0.50, 0.96, erCell) * (cyCell < 280 ? 0.68 : 0.42);
        if (h1 >= prob) continue;

        const h2 = hash2i(gx + 73, gy + 19);
        const h3 = hash2i(gx + 149, gy + 89);
        const dxCenter = gx * CELL + 3.5 + h2 * (CELL - 7.0);
        const dyCenter = gy * CELL + 3.5 + h3 * (CELL - 7.0);
        const rad = 1.3 + (h1 / Math.max(0.01, prob)) * 2.7;

        const x0 = Math.max(0, Math.floor(dxCenter - rad));
        const x1 = Math.min(W - 1, Math.ceil(dxCenter + rad));
        const y0 = Math.max(0, Math.floor(dyCenter - rad));
        const y1 = Math.min(H - 1, Math.ceil(dyCenter + rad));

        for (let py = y0; py <= y1; py++) {
          const ddy = py + 0.5 - dyCenter;
          for (let px = x0; px <= x1; px++) {
            const ddx = px + 0.5 - dxCenter;
            const d = Math.hypot(ddx, ddy);
            if (d >= rad) continue;

            const rn = d / rad;
            const dnx = ddx / rad;
            const dny = -ddy / rad;
            const dnz = Math.sqrt(Math.max(0, 1 - rn * rn));

            const specDot = Math.max(0, dnx * -0.58 + dny * 0.62 + dnz * 0.52);
            const s2 = specDot * specDot;
            const s4 = s2 * s2;
            const spec = s4 * s4 * s4 * s4; // pow(..., 16)
            const refractDot = Math.max(0, dnx * 0.55 - dny * 0.55);
            const rimDark = smoothstep(0.68, 0.98, rn);

            const dAlpha = (0.14 + spec * 0.55 + refractDot * 0.22 + rimDark * 0.14) * smoothstep(1.0, 0.84, rn);
            const idx = (py * W + px) * 4;
            const curAlpha = data[idx + 3] / 255;
            if (dAlpha > curAlpha) {
              const dr = lerp(190, 255, spec) * (1 - rimDark * 0.45) + refractDot * 35;
              const dg = lerp(210, 248, spec) * (1 - rimDark * 0.45) + refractDot * 22;
              const db = lerp(228, 232, spec) * (1 - rimDark * 0.42);
              data[idx] = Math.round(clamp(dr, 0, 255));
              data[idx + 1] = Math.round(clamp(dg, 0, 255));
              data[idx + 2] = Math.round(clamp(db, 0, 255));
              data[idx + 3] = Math.round(clamp(dAlpha, 0, 0.68) * 255);
            }
          }
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function buildFighterCanvas(variant = 0) {
    const W = 256, H = 256;
    const bundle = makeCanvas(W, H);
    if (!bundle) return null;
    const { canvas, ctx } = bundle;
    if (typeof ctx.beginPath !== 'function') return canvas;

    ctx.save();
    ctx.translate(W * 0.5, H * 0.5);

    // 1. Twin afterburner plasma plumes & Mach diamonds
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {
      const ex = side * 19, ey = 72;
      const plume = ctx.createRadialGradient(ex, ey, 2, ex, ey + 24, 48);
      plume.addColorStop(0, 'rgba(255,252,235,0.98)');
      plume.addColorStop(0.26, variant === 1 ? 'rgba(130,225,255,0.85)' : 'rgba(255,162,72,0.88)');
      plume.addColorStop(0.62, 'rgba(235,72,28,0.42)');
      plume.addColorStop(1, 'rgba(235,72,28,0)');
      ctx.fillStyle = plume;
      ctx.beginPath();
      ctx.ellipse(ex, ey + 18, 12, 42, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 2. Forward-swept / stealth X-delta wing planform (inspired by Nuremberg 1561 battle reference)
    const hullGrad = ctx.createLinearGradient(-95, -90, 95, 80);
    if (variant === 1) {
      hullGrad.addColorStop(0, '#5a6872');
      hullGrad.addColorStop(0.35, '#2b353d');
      hullGrad.addColorStop(0.7, '#161d22');
      hullGrad.addColorStop(1, '#0b1014');
    } else if (variant === 2) {
      hullGrad.addColorStop(0, '#6e5849');
      hullGrad.addColorStop(0.38, '#382c26');
      hullGrad.addColorStop(0.72, '#1d1715');
      hullGrad.addColorStop(1, '#0e0b0a');
    } else {
      hullGrad.addColorStop(0, '#646b70');
      hullGrad.addColorStop(0.35, '#2e3438');
      hullGrad.addColorStop(0.7, '#171c1f');
      hullGrad.addColorStop(1, '#0a0e10');
    }

    ctx.fillStyle = hullGrad;
    ctx.beginPath();
    ctx.moveTo(0, -108);         // Needle nose
    ctx.lineTo(15, -52);         // Forward chine
    ctx.lineTo(38, -58);         // Canard tip
    ctx.lineTo(24, -28);         // Canard root
    ctx.lineTo(108, -12);        // Forward-swept main wingtip
    ctx.lineTo(96, 18);          // Wingtip weapon rail
    ctx.lineTo(30, 38);          // Trailing wing root
    ctx.lineTo(44, 82);          // Twin canted tail fin
    ctx.lineTo(22, 74);          // Right nozzle outer
    ctx.lineTo(8, 78);           // Right nozzle inner
    ctx.lineTo(0, 68);           // Center tail sting
    ctx.lineTo(-8, 78);
    ctx.lineTo(-22, 74);
    ctx.lineTo(-44, 82);
    ctx.lineTo(-30, 38);
    ctx.lineTo(-96, 18);
    ctx.lineTo(-108, -12);
    ctx.lineTo(-24, -28);
    ctx.lineTo(-38, -58);
    ctx.lineTo(-15, -52);
    ctx.closePath();
    ctx.fill();

    // 3. Specular metallic bevels & armor panel lines
    ctx.strokeStyle = 'rgba(215,222,226,0.52)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Dorsal spine & chine highlights
    const spineGrad = ctx.createLinearGradient(-18, -80, 18, 60);
    spineGrad.addColorStop(0, 'rgba(235,220,198,0.45)');
    spineGrad.addColorStop(0.5, 'rgba(90,104,112,0.28)');
    spineGrad.addColorStop(1, 'rgba(20,26,30,0.65)');
    ctx.fillStyle = spineGrad;
    ctx.beginPath();
    ctx.moveTo(0, -96);
    ctx.lineTo(14, -18);
    ctx.lineTo(10, 62);
    ctx.lineTo(-10, 62);
    ctx.lineTo(-14, -18);
    ctx.closePath();
    ctx.fill();

    // 4. Armored Gold/Amber Reflective Canopy + glowing plasma intake veins
    const canopyGrad = ctx.createLinearGradient(-10, -64, 12, -16);
    canopyGrad.addColorStop(0, '#fff2d2');
    canopyGrad.addColorStop(0.35, '#d69856');
    canopyGrad.addColorStop(0.75, '#46382b');
    canopyGrad.addColorStop(1, '#141a1d');
    ctx.fillStyle = canopyGrad;
    ctx.beginPath();
    ctx.ellipse(0, -42, 8.5, 24, 0, 0, Math.PI * 2);
    ctx.fill();

    // Glowing plasma wing seams
    ctx.strokeStyle = variant === 1 ? 'rgba(120,220,255,0.68)' : 'rgba(255,158,72,0.72)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-22, -10); ctx.lineTo(-86, -4);
    ctx.moveTo(22, -10); ctx.lineTo(86, -4);
    ctx.stroke();

    ctx.restore();
    return canvas;
  }

  const IMAGE_SOURCES = {
    dawn: 'assets/nuremberg-dawn.png',
    terrain: 'assets/terrain-realistic.png',
    anomaly: 'assets/anomaly-render.png',
    cityMaterials: 'assets/city-materials.png'
  };

  const images = { dawn: null, terrain: null, anomaly: null, cityMaterials: null };
  const loadingImages = { dawn: false, terrain: false, anomaly: false, cityMaterials: false };

  const cache = {
    spheres: [null, null, null],
    fighters: [null, null, null],
    cylinder: null,
    cross: null,
    clouds: [null, null, null],
    fireballs: [null, null, null],
    smokes: [null, null, null],
    canopyGlass: null
  };

  const normVariant = v => {
    const n = Math.floor(Number(v) || 0);
    return ((n % 3) + 3) % 3;
  };

  function getSphereCanvas(variant = 0) {
    const v = normVariant(variant);
    if (!cache.spheres[v]) cache.spheres[v] = buildSphereCanvas(v);
    return cache.spheres[v];
  }

  function getFighterCanvas(variant = 0) {
    const v = normVariant(variant);
    if (!cache.fighters[v]) cache.fighters[v] = buildFighterCanvas(v);
    return cache.fighters[v];
  }

  function getCylinderCanvas() {
    if (!cache.cylinder) cache.cylinder = buildCylinderCanvas();
    return cache.cylinder;
  }

  function getCrossCanvas() {
    if (!cache.cross) cache.cross = buildCrossCanvas();
    return cache.cross;
  }

  function getCloudCanvas(variant = 0) {
    const v = normVariant(variant);
    if (!cache.clouds[v]) cache.clouds[v] = buildCloudCanvas(v);
    return cache.clouds[v];
  }

  function getFireballCanvas(variant = 0) {
    const v = normVariant(variant);
    if (!cache.fireballs[v]) cache.fireballs[v] = buildFireballCanvas(v);
    return cache.fireballs[v];
  }

  function getSmokeCanvas(variant = 0) {
    const v = normVariant(variant);
    if (!cache.smokes[v]) cache.smokes[v] = buildSmokeCanvas(v);
    return cache.smokes[v];
  }

  function getCanopyGlassCanvas() {
    if (!cache.canopyGlass) cache.canopyGlass = buildCanopyGlassCanvas();
    return cache.canopyGlass;
  }

  function loadImages() {
    if (typeof Image === 'undefined') return false;
    for (const key of ['dawn', 'terrain', 'anomaly', 'cityMaterials']) {
      if (images[key] || loadingImages[key]) continue;
      loadingImages[key] = true;
      try {
        const img = new Image();
        img.onload = () => {
          images[key] = img;
          loadingImages[key] = false;
        };
        img.onerror = () => {
          images[key] = null;
          loadingImages[key] = false;
        };
        img.src = IMAGE_SOURCES[key];
        if (img.complete && (img.naturalWidth > 0 || img.width > 0)) {
          images[key] = img;
          loadingImages[key] = false;
        }
      } catch (_) {
        images[key] = null;
        loadingImages[key] = false;
      }
    }
    return true;
  }

  let canvasesWarmed = false;

  function init() {
    const hasImages = loadImages();
    let hasCanvases = false;
    if (!canvasesWarmed && typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
      canvasesWarmed = true;
      for (let v = 0; v < 3; v++) {
        getSphereCanvas(v);
        getFighterCanvas(v);
        getCloudCanvas(v);
        getFireballCanvas(v);
        getSmokeCanvas(v);
      }
      getCylinderCanvas();
      getCrossCanvas();
      getCanopyGlassCanvas();
      hasCanvases = !!(cache.spheres[0] || cache.cylinder || cache.cross);
    } else {
      hasCanvases = !!(cache.spheres[0] || cache.cylinder || cache.cross);
    }
    return hasImages || hasCanvases;
  }

  const api = {
    init,
    images,
    getSphereCanvas,
    getFighterCanvas,
    getCylinderCanvas,
    getCrossCanvas,
    getCloudCanvas,
    getFireballCanvas,
    getSmokeCanvas,
    getCanopyGlassCanvas
  };

  if (typeof window !== 'undefined') window.GameTextures = api;
  if (typeof globalThis !== 'undefined' && !globalThis.GameTextures) globalThis.GameTextures = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
