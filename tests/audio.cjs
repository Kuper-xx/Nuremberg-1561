// Verify the offline audio graph, effects and mute behavior with a Web Audio stub.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
let sources = 0;
const param = () => ({ value: 0, cancelScheduledValues() {}, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
function node() { return { gain: param(), frequency: param(), Q: param(), playbackRate: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {}, start() { sources++; }, stop() {} }; }
class AudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 800; this.state = 'running'; this.destination = {}; }
  createGain() { return node(); }
  createDynamicsCompressor() { return node(); }
  createBuffer(ch, n, rate) { return { duration: n / rate, getChannelData: () => new Float32Array(n) }; }
  createBufferSource() { return node(); }
  createBiquadFilter() { return node(); }
  createConvolver() { return node(); }
  createOscillator() { return node(); }
}
const sandbox = { window: { AudioContext }, Math };
vm.runInNewContext(fs.readFileSync('audio.js', 'utf8'), sandbox);
const audio = sandbox.window.GameAudio;
audio.start();
assert.ok(sources >= 5, 'engine airflow, rumble and turbine sources start');
for (const method of ['shoot', 'hit', 'explosion', 'cityImpact', 'crashImpact', 'crowdScream', 'damage', 'reload', 'victory', 'defeat']) {
  const before = sources;
  audio[method]();
  assert.ok(sources > before, method + ' creates audio sources');
}
audio.setEngine(.8);
audio.setEnabled(false);
const before = sources;
audio.shoot();
assert.equal(sources, before, 'mute suppresses effects');
audio.setEnabled(true);
audio.stop();
console.log('Audio test passed: engine, effects, mute and stop.');
