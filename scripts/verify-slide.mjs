import assert from 'node:assert/strict';
import { Scene } from 'three/webgpu';
import { SoftBody } from '../src/physics/soft-body.js';
import { PHYS } from '../src/physics/constants.js';
import { loadModel } from './load-model.mjs';
import { SlideFacility } from '../src/game/slide-facility.ts';
import { SLIDE } from '../src/game/slide-physics.ts';

const events=[];
const body=new SoftBody(loadModel());
const facility=new SlideFacility(new Scene(),body,{add(){}},event=>events.push(event));
const physics=facility.physics;

const moveNearLadder=()=>{
  const dx=SLIDE.x-body.center.x,dz=SLIDE.ladderZ-body.center.z;
  for(let j=0;j<body.x.length;j+=3){body.x[j]+=dx;body.x[j+2]+=dz;}
  body.previous.set(body.x);body.velocity.fill(0);
  body.wake();body.updateCenter();body.surfaceDirty=true;body.grounded=true;
};

assert(!facility.interact(),'empty ladder base offers no ride');
moveNearLadder();
assert(facility.interact(),'boarding at the ladder starts the climb');
assert(facility.active&&!facility.laughing);

// Climb the ladder to the perch.
for(let i=0;i<240*2;i++) {
  facility.step(PHYS.step);body.step(PHYS.step);facility.afterStep();
  assert(body.isFinite());assert(body.lastMinJacobian>=.12);
  if(physics.perched)break;
}
assert(physics.perched,'the scramble ends seated at the top');
assert(Math.abs(body.center.x-SLIDE.x)<.03&&Math.abs(body.center.z-SLIDE.topZ)<.04);
assert(body.center.y>SLIDE.topY,'the perch sits above the platform');

// Push off and ride the chute to a launch.
assert(facility.interact(),'a second press shoves off');
assert(physics.sliding);
let launched=false,sawLaugh=false,steps=0;
for(let i=0;i<240*4&&!launched;i++) {
  facility.step(PHYS.step);body.step(PHYS.step);facility.afterStep();
  assert(body.isFinite());assert(body.lastMinJacobian>=.12);
  sawLaugh ||= facility.laughing;steps++;
  launched=!facility.active;
}
assert(launched,'the chute ends in a launch');
assert(sawLaugh,'a fast run laughs on the way down');
const whoosh=events.filter(event=>event.kind==='slide-whoosh');
assert(whoosh.length>=1,'the rush plays a whoosh');
assert(whoosh.every(event=>event.strength>0&&event.strength<=1),'whoosh strength stays bounded');

// The launch carries south past the exit before settling.
const exitZ=body.center.z;
for(let i=0;i<240*2;i++) {
  facility.step(PHYS.step);body.step(PHYS.step);facility.afterStep();
  assert(body.isFinite());
}
assert(body.grounded,'the rider lands back on the floor');
assert(exitZ>SLIDE.exitZ-.05,'momentum carries beyond the chute exit');

// Bailing mid-climb steps off safely.
moveNearLadder();events.length=0;
assert(facility.interact());
for(let i=0;i<30;i++){facility.step(PHYS.step);body.step(PHYS.step);facility.afterStep();}
assert(facility.active&&!physics.perched,'still scrambling after a few steps');
assert(facility.interact()&&!facility.active,'hopping off ends the ride');
assert(body.isFinite());

facility.reset();assert(!facility.active&&!facility.laughing);
facility.dispose();
console.log(`Slide climb, push, launch and bail passed (chute steps: ${steps}, whooshes: ${whoosh.length})`);
