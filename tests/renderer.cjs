// Run with: node tests/renderer.cjs
// Exercise the actual renderer with the aerial terrain loaded and in flight.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const transforms = [];
const gradient = { addColorStop() {} };
const ctx = new Proxy({ globalAlpha: 1 }, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
    if (key === 'transform') return (...args) => transforms.push(args);
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; }
});
const image = { width: 1536, height: 1024 };
const sandbox = {
  Math,
  window: { GameTextures: { init() {}, images: { terrain: image, cityMaterials: image } } }
};
vm.runInNewContext(fs.readFileSync('renderer.js', 'utf8'), sandbox);
const player = { x: 0, y: 340, z: 0, yaw: 0, pitch: 0, roll: 0 };
const state = {
  w: 1280, h: 720, focal: 700, time: 1, player,
  buildings: [{ x: 0, z: 300, w: 30, d: 30, h: 18, roof: 8, tower: false, church: false, smoke: false }]
};
sandbox.window.GameRenderer.render(ctx, state);
assert.ok(transforms.length > 0, 'terrain projects into the first frame');
assert.ok(transforms.every(values => values.every(Number.isFinite)), 'projection has finite coordinates');
const firstFrame = JSON.stringify(transforms);
transforms.length = 0;
player.z += 100;
player.yaw += 0.1;
sandbox.window.GameRenderer.render(ctx, state);
assert.ok(transforms.length > 0, 'terrain projects after moving and turning');
assert.notEqual(JSON.stringify(transforms), firstFrame, 'terrain follows the aircraft');
assert.ok(transforms.every(values => values.every(Number.isFinite)), 'moving projection has finite coordinates');
console.log('Renderer test passed: textured city renders and follows forward flight and turns.');
