import assert from 'node:assert/strict';
import { Scene } from 'three/webgpu';
import { SoftBody } from '../src/physics/soft-body.js';
import { PHYS } from '../src/physics/constants.js';
import { loadModel } from './load-model.mjs';
import { SeesawFacility } from '../src/game/seesaw-facility.ts';
import { SEESAW } from '../src/game/seesaw-physics.ts';

const events=[];
const body=new SoftBody(loadModel());
const facility=new SeesawFacility(new Scene(),body,{add(){}},event=>events.push(event));
const physics=facility.physics;

const moveNearby=()=>{
  const dx=SEESAW.x-body.center.x,dz=SEESAW.z-body.center.z;
  for(let j=0;j<body.x.length;j+=3){body.x[j]+=dx;body.x[j+2]+=dz;}
  body.previous.set(body.x);body.velocity.fill(0);
  body.wake();body.updateCenter();body.surfaceDirty=true;body.grounded=true;
};

assert(!facility.interact(),'no ride offered far from the plank');
moveNearby();
assert(facility.interact(),'boarding starts the rock');
assert(facility.active&&!facility.laughing);

// The pump builds amplitude until laughter latches past the threshold.
let peak=0,sawLaugh=false,sawCreak=false;
for(let i=0;i<240*22;i++) {
  facility.step(PHYS.step);body.step(PHYS.step);facility.afterStep();
  assert(body.isFinite());assert(body.lastMinJacobian>=.12);
  peak=Math.max(peak,Math.abs(physics.angle));
  sawLaugh ||= facility.laughing;
  sawCreak ||= events.some(event=>event.kind==='swing-creak');
}
assert(peak>.30&&peak<=SEESAW.maxAngle+.02,'rock builds to a bounded amplitude');
assert(sawLaugh,'a high rock triggers laughter');
assert(sawCreak,'reversals creak through the shared motion sound');

// Hopping off steps toward the middle and rests on the floor.
assert(facility.interact()&&!facility.active&&!facility.laughing);
assert(body.center.x<SEESAW.x-.05,'dismount clears the plank toward the middle');
for(let i=0;i<240*3;i++){facility.step(PHYS.step);body.step(PHYS.step);facility.afterStep();}
assert(Math.abs(physics.angle)<.03,'the empty plank brakes back to level');
assert(body.isFinite());

facility.reset();assert(!facility.active&&!facility.laughing);
facility.dispose();
console.log(`Seesaw rock, laughter, creak and lifecycle passed (peak: ${peak.toFixed(3)} rad)`);
