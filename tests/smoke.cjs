// Run with: node tests/smoke.cjs
// Exercise the game loop with a minimal browser and canvas stand-in.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const listeners = {}, elements = {};
const gradient = {addColorStop(){}};
const context = new Proxy({}, {get(target, key) { return target[key] || (() => key === 'createLinearGradient' || key === 'createRadialGradient' ? gradient : undefined); }, set(target, key, value) {target[key]=value; return true;}});
function element(id) {return elements[id] ||= {id, hidden:false, style:{}, innerHTML:'', textContent:'', addEventListener(type, fn){listeners[id+':'+type]=fn;}};}
const canvas = element('view'); canvas.getContext=()=>context;
const document = {pointerLockElement:null, querySelector:()=>canvas, getElementById:element, addEventListener(type,fn){listeners['doc:'+type]=fn;}, exitPointerLock(){this.pointerLockElement=null;listeners['doc:pointerlockchange']();}};
canvas.requestPointerLock=()=>{document.pointerLockElement=canvas;listeners['doc:pointerlockchange']();};
let frame;
const calls = [];
const gameAudio = Object.fromEntries(['start','stop','setEngine','shoot','hit','explosion','damage','reload','victory','defeat','setEnabled'].map(name=>[name, (...args)=>calls.push([name,...args])]));
const sandbox = {document, innerWidth:1280, innerHeight:720, Math, console, window:{devicePixelRatio:1, GameAudio:gameAudio}, requestAnimationFrame(fn){frame=fn;}, addEventListener(type,fn){listeners['window:'+type]=fn;}};
let code=fs.readFileSync('game.js','utf8').replace('reset();requestAnimationFrame(loop);','reset();globalThis.testFinish = finish;globalThis.testState = () => ({player, enemies, explosions, particles, shots, kills, state, reload});requestAnimationFrame(loop);');
vm.runInNewContext(code,sandbox);
frame(0);
listeners['start:click']();
assert.equal(sandbox.testState().state,'playing');
assert.equal(document.pointerLockElement,canvas);

// Verify distant sphere/anomaly spawn range (>= 2000 m).
const st0 = sandbox.testState();
assert.ok(st0.enemies.length >= 7, 'initial wave spawns enemies');
for (const e of st0.enemies) {
  const dist = Math.hypot(e.x - st0.player.x, e.y - st0.player.y, e.z - st0.player.z);
  assert.ok(dist >= 2000, `enemy spawns far away (got ${Math.round(dist)}m)`);
}

// Rotating the camera must not reposition world-space enemies or their routes.
const positions=st0.enemies.map(e=>[e.x,e.y,e.z,e.routeX,e.routeY,e.routeZ]);
listeners['window:mousemove']({movementX:120,movementY:-50});
assert.deepEqual(st0.enemies.map(e=>[e.x,e.y,e.z,e.routeX,e.routeY,e.routeZ]),positions);
assert.ok(new Set(st0.enemies.map(e=>e.routeHeading)).size>1,'enemies have independent routes');

// Fire rounds and verify ammunition consumption + sound.
listeners['window:mousedown']({button:0}); frame(16); frame(166); listeners['window:mouseup']();
assert.ok(sandbox.testState().player.ammo < 40, 'firing consumes ammunition');
assert.ok(calls.some(c=>c[0]==='shoot'), 'firing triggers its sound');

// Aim directly at a distant enemy and destroy it to verify hit + Hollywood explosion.
const target = sandbox.testState().enemies[0];
// Stationary range target isolates projectile travel and collision from AI manoeuvres.
target.routeX=target.x;target.routeY=target.y;target.routeZ=target.z;
target.routeRadius=0;target.verticalAmp=0;target.vx=target.vy=target.vz=0;
const p0 = sandbox.testState().player;
const dx = target.x - p0.x, dy = target.y - p0.y, dz = target.z - p0.z;
p0.yaw = Math.atan2(dx, dz);
p0.pitch = Math.atan2(dy, Math.hypot(dx, dz));
listeners['window:mousedown']({button:0});
const hpBeforeFlight=target.hp;
let t = 200;
for (let i = 0; i < 160 && sandbox.testState().kills === 0; i++) {
  const st = sandbox.testState();
  const tdx = target.x - st.player.x, tdy = target.y - st.player.y, tdz = target.z - st.player.z;
  st.player.yaw = Math.atan2(tdx, tdz);
  st.player.pitch = Math.atan2(tdy, Math.hypot(tdx, tdz));
  t += 50;
  frame(t);
  if(i===0) assert.equal(target.hp,hpBeforeFlight,'distant target takes no instantaneous hits');
}
listeners['window:mouseup']();
assert.ok(sandbox.testState().kills >= 1, 'aimed fire destroys a distant enemy');
assert.ok(sandbox.testState().explosions.length >= 1, 'destroying enemy creates an explosion');
assert.ok(sandbox.testState().particles.length > 0, 'destroying enemy spawns explosion particles');
assert.ok(calls.some(c=>c[0]==='explosion'), 'destroying enemy triggers explosion sound');

// Reload restores ammunition.
listeners['window:keydown']({code:'KeyR',preventDefault(){}});
for(let i=1;i<=30;i++){t+=50;frame(t);}
assert.equal(sandbox.testState().player.ammo,40,'reload restores ammunition');

// Afterburner movement & pause check.
const z=sandbox.testState().player.z;
listeners['window:keydown']({code:'ShiftLeft',preventDefault(){}});t+=50;frame(t);
assert.ok(sandbox.testState().player.z>z,'flight advances');
document.exitPointerLock();const pausedZ=sandbox.testState().player.z;t+=50;frame(t);
assert.equal(sandbox.testState().player.z,pausedZ,'releasing pointer pauses the game');
assert.ok(calls.some(c=>c[0]==='stop'), 'pausing stops the engine audio');
assert.ok(calls.some(c=>c[0]==='reload'), 'reload triggers its sound');
console.log('Smoke test passed: rendering, long-range spawn, start, fire, explosion, reload, movement, sound triggers and pause.');

// Both outcomes must remove every gameplay canvas and restart cleanly.
for (const win of [true, false]) {
  sandbox.testFinish(win);
  assert.equal(sandbox.testState().state, 'end');
  assert.equal(elements.view.hidden, true);
  assert.equal(elements.world3d.hidden, true);
  assert.equal(elements.hud.hidden, true);
  assert.equal(elements['pause-hint'].hidden, true);
  assert.equal(elements.end.hidden, false);
  t += 50; frame(t);
  listeners['restart:click']();
  assert.equal(elements.view.hidden, false);
  assert.equal(elements.world3d.hidden, false);
  assert.equal(elements.end.hidden, true);
  assert.equal(sandbox.testState().state, 'playing');
}
console.log('End-screen regression passed: victory, defeat and restart.');

// A near miss at 50 m must be avoidable; a round crossing the fuselage must hit.
for (const [offset, shouldHit] of [[50,false],[0,true]]) {
  const st=sandbox.testState(),p=st.player;
  st.shots.length=0;
  for(const e of st.enemies)e.attack=100;
  const health=p.health;
  st.shots.push({x:p.x+offset,y:p.y,z:p.z-10,vx:p.vx,vy:p.vy,vz:p.vz+400,life:2});
  t+=50;frame(t);
  assert.equal(p.health<health,shouldHit,shouldHit?'swept direct hit damages aircraft':'near miss does not damage aircraft');
}
console.log('Evasion regression passed: 50 m miss and swept direct hit.');
