const assert=require('node:assert/strict');
const T=require('../vendor/three.min.js');
const camera=new T.PerspectiveCamera();
const w=1280,h=720,focal=620;
for(const yaw of [-1,-.3,0,.7])for(const pitch of [-.35,0,.4])for(const roll of [-.5,0,.5]){
  const p={x:123,y:340,z:500};
  camera.aspect=w/h;camera.fov=2*Math.atan(h/(2*focal))*180/Math.PI;camera.updateProjectionMatrix();
  camera.position.set(-p.x,p.y,p.z);camera.up.set(0,1,0);
  camera.lookAt(-p.x-Math.sin(yaw)*Math.cos(pitch),p.y+Math.sin(pitch),p.z+Math.cos(yaw)*Math.cos(pitch));camera.rotateZ(-roll);camera.updateMatrixWorld();
  const x=p.x+Math.sin(yaw)*2200+120,y=p.y+Math.sin(pitch)*1800+70,z=p.z+Math.cos(yaw)*2200;
  const dx=x-p.x,dy=y-p.y,dz=z-p.z;
  const px=dx*Math.cos(yaw)-dz*Math.sin(yaw),forward=dx*Math.sin(yaw)+dz*Math.cos(yaw);
  const py=dy*Math.cos(pitch)-forward*Math.sin(pitch),depth=forward*Math.cos(pitch)+dy*Math.sin(pitch);
  const ux=px*focal/depth,uy=-py*focal/depth;
  const expectedX=w/2+ux*Math.cos(-roll)-uy*Math.sin(-roll);
  const expectedY=h/2+ux*Math.sin(-roll)+uy*Math.cos(-roll);
  const ndc=new T.Vector3(-x,y,z).project(camera);
  assert.ok(Math.abs((ndc.x+1)*w/2-expectedX)<1e-6,'horizontal world/HUD alignment');
  assert.ok(Math.abs((1-ndc.y)*h/2-expectedY)<1e-6,'vertical world/HUD alignment');
}
console.log('Camera alignment passed for 36 yaw/pitch/roll combinations.');
