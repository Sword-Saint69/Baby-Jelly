import assert from 'node:assert/strict';
import { SoftBody } from '../src/physics/soft-body.js';
import { PHYS } from '../src/physics/constants.js';
import { Locomotion } from '../src/game/locomotion.ts';
import { ScatterProps } from '../src/graphics/props.ts';
import { StaticProps } from '../src/game/static-props.ts';
import { loadModel } from './load-model.mjs';

const stubScene = { add() {} };
const stubShadows = { add() {} };
const EXCLUSIONS = [
  [-0.155, -0.035, 0.17], [0.165, -0.035, 0.17], [0.165, 0.205, 0.16],
  [-0.155, 0.305, 0.18], [0, 0, 0.13],
];

function settle(body, rig) {
  for (let i = 0; i < 480; i++) { rig.step(PHYS.step); body.step(PHYS.step); rig.afterStep(); }
}

// Teleport the whole solver state (current + previous, no fling velocity) and
// let the kernel resync, mirroring what body.step leaves behind every substep.
function moveBodyTo(body, x, y, z) {
  const dx = x - body.center.x, dy = y - body.center.y, dz = z - body.center.z;
  for (let i = 0; i < body.x.length; i += 3) {
    body.x[i] += dx; body.x[i + 1] += dy; body.x[i + 2] += dz;
    body.previous[i] += dx; body.previous[i + 1] += dy; body.previous[i + 2] += dz;
    body.velocity[i] = 0; body.velocity[i + 1] = 0; body.velocity[i + 2] = 0;
  }
  body.wake();
  body.step(PHYS.step); body.step(PHYS.step);
  body.updateCenter();
}

function maxHeight(body, rig, steps) {
  let peak = body.center.y;
  for (let i = 0; i < steps; i++) {
    rig.step(PHYS.step); body.step(PHYS.step); rig.afterStep();
    peak = Math.max(peak, body.center.y);
  }
  return peak;
}

// Deterministic layout, exclusions, shadow envelope and animated anchors.
{
  const a = new ScatterProps(), b = new ScatterProps();
  const key = (p) => p.boxes.map((box) => `${box.center.x},${box.center.y},${box.center.z}`).join('|');
  assert.equal(key(a), key(b), 'scatter layout is deterministic for a fixed seed');
  assert.equal(a.boxes.length, 11, `3 blocks + 2 spools + die + 2 dominoes + books + duck + top, got ${a.boxes.length}`);
  for (const box of a.boxes) {
    const { x, y, z } = box.center;
    assert(y > 0 && y < 0.06, 'box height in tabletop range');
    for (const [ex, ez, r] of EXCLUSIONS) {
      assert(Math.hypot(x - ex, z - ez) >= r, `prop box respects the exclusion disk at (${ex},${ez})`);
    }
    assert(a.envelope.containsPoint(box.center), 'every collision box sits inside the shadow envelope');
  }
  assert(a.top && a.duck, 'spinning top and duck anchors are placed');
  let meshes = 0;
  a.group.traverse((o) => { if (o.isMesh) meshes++; });
  assert(meshes > 40, `expanded scatter has real geometry, got ${meshes} meshes`);
  a.setTopSpin(1.2, 0.1);
  assert.equal(a.top.spinner.rotation.y, 1.2);
  assert.equal(a.top.lean.rotation.x, 0.1);
  a.setDuckRock(0.05);
  assert.equal(a.duck.rocker.rotation.z, 0.05);
  a.dispose(); b.dispose();
}

// Double jump: a mid-air press buys extra height exactly once per trip.
{
  const fly = (airJump) => {
    const body = new SoftBody(loadModel()), rig = new Locomotion(body);
    settle(body, rig);
    assert(body.grounded, 'body settles grounded before the jump test');
    rig.jump();
    for (let i = 0; i < 60; i++) { rig.step(PHYS.step); body.step(PHYS.step); rig.afterStep(); }
    assert(!body.grounded, 'body is airborne when the second press lands');
    if (airJump) rig.jump();
    return maxHeight(body, rig, 240);
  };
  const single = fly(false), double = fly(true);
  assert(double > single + 0.004, `double jump clears higher (${double.toFixed(4)} vs ${single.toFixed(4)})`);
}

// Proximity animation wakes near the baby and sleeps exactly at rest.
{
  const body = new SoftBody(loadModel()), rig = new Locomotion(body);
  settle(body, rig);
  const events = [];
  const props = new StaticProps(stubScene, body, stubShadows, (e) => events.push(e));
  assert(props.visual.top && props.visual.duck, 'animated anchors exist behind the facility');
  moveBodyTo(body, props.visual.top.x, 0.05, props.visual.top.z);
  for (let i = 0; i < 240; i++) props.step(PHYS.step);
  assert.notEqual(props.visual.top.spinner.rotation.y, 0, 'top spins up near the baby');
  moveBodyTo(body, props.visual.top.x + 2, 0.05, props.visual.top.z + 2);
  for (let i = 0; i < 1200; i++) props.step(PHYS.step);
  assert.equal(props.visual.top.lean.rotation.x, 0, 'top lean settles exactly so shadows stay cached');
  const parked = props.visual.top.spinner.rotation.y;
  for (let i = 0; i < 60; i++) props.step(PHYS.step);
  assert.equal(props.visual.top.spinner.rotation.y, parked, 'parked top writes no new transforms');
  props.dispose();
}

// A hard shove into a prop knocks once, then stays quiet at rest.
{
  const body = new SoftBody(loadModel()), rig = new Locomotion(body);
  settle(body, rig);
  const events = [];
  const props = new StaticProps(stubScene, body, stubShadows, (e) => events.push(e));
  const target = props.visual.boxes[0].center;
  // Stage beside the prop to prime the previous-center tracking, then shove
  // inside it: the solver refreshes broad-phase bounds, the resolver finds
  // contact, and the center displacement reads as impact speed.
  moveBodyTo(body, target.x + 0.05, target.y + 0.05, target.z);
  body.step(PHYS.step);
  props.afterStep();
  moveBodyTo(body, target.x, target.y, target.z);
  body.step(PHYS.step);
  props.afterStep();
  assert.equal(events.length, 1, 'contact emits exactly one knock');
  assert.equal(events[0].kind, 'prop-knock');
  assert(events[0].strength > 0 && events[0].strength <= 1, 'knock strength is bounded');
  props.afterStep();
  assert.equal(events.length, 1, 'a settled body does not retrigger the knock');
  props.reset();
  props.dispose();
}

// Duck ride: board beside the duck, rock with laughter, then dismount cleanly.
{
  const body = new SoftBody(loadModel()), rig = new Locomotion(body);
  settle(body, rig);
  const events = [];
  const props = new StaticProps(stubScene, body, stubShadows, (e) => events.push(e));
  const duck = props.visual.duck;
  assert(duck, 'duck anchor exists for the ride test');
  assert.equal(props.interactionDistance, Infinity, 'no prompt from spawn');
  assert(!props.interact(), 'no interaction without a nearby hotspot');
  moveBodyTo(body, duck.x, 0.05, duck.z);
  for (let i = 0; i < 240; i++) { rig.step(PHYS.step); body.step(PHYS.step); rig.afterStep(); }
  assert(body.grounded, 'body lands grounded beside the duck');
  assert(props.interactionDistance < 0.12, 'duck offers a prompt in range');
  assert.equal(props.action, 'Ride Duck');
  body.grab = {};
  assert(!props.interact(), 'grabbing blocks boarding');
  body.grab = null;
  assert(props.interact(), 'board the duck');
  assert(props.active, 'ride owns the body');
  assert.equal(events.filter((e) => e.kind === 'duck-squeak').length, 1, 'boarding squeaks');
  let rockPeak = 0;
  for (let i = 0; i < 960; i++) {
    props.step(PHYS.step); body.step(PHYS.step); props.afterStep();
    assert(body.isFinite(), 'finite rider state');
    rockPeak = Math.max(rockPeak, Math.abs(props.visual.duck.rocker.rotation.z));
  }
  assert(rockPeak > 0.1, `ride rocks the duck visibly, peak ${rockPeak.toFixed(3)}`);
  assert(props.laughing, 'sustained rocking delights the baby');
  assert(events.filter((e) => e.kind === 'duck-squeak').length >= 2, 'long rides squeak again');
  assert(props.interact(), 'dismount on demand');
  assert(!props.active && !props.laughing, 'dismount clears ride state');
  assert(body.isFinite(), 'finite state after dismount');
  assert(body.center.y < 0.12, 'dismount rests on the floor');
  assert(body.center.x - duck.x > 0.05, 'dismount steps clear of the duck');
  // The dismounted blob boings on landing; wait for a grounded sample.
  for (let i = 0; i < 240 && !body.grounded; i++) { rig.step(PHYS.step); body.step(PHYS.step); rig.afterStep(); }
  assert(body.grounded, 'dismount settles grounded');
  assert(props.interactionDistance < 0.12, 'prompt returns after stepping off');
  props.reset();
  assert.equal(props.visual.duck.rocker.rotation.z, 0, 'reset parks the rocker');
  assert.equal(props.visual.top.spinner.rotation.y, 0, 'reset parks the top');
  props.dispose();
}

// Top flick: a touch spins it up hard without taking body ownership.
{
  const body = new SoftBody(loadModel()), rig = new Locomotion(body);
  settle(body, rig);
  const events = [];
  const props = new StaticProps(stubScene, body, stubShadows, (e) => events.push(e));
  const top = props.visual.top;
  assert(top, 'top anchor exists for the flick test');
  moveBodyTo(body, top.x, 0.05, top.z);
  for (let i = 0; i < 240; i++) { rig.step(PHYS.step); body.step(PHYS.step); rig.afterStep(); }
  assert(body.grounded, 'body lands grounded beside the top');
  assert.equal(props.action, 'Spin Top', 'the nearer hotspot wins the prompt');
  assert(props.interactionDistance < 0.12, 'top offers a prompt in range');
  assert(props.interact(), 'flick the top');
  assert(!props.active, 'a flick never owns the body');
  assert.equal(events.at(-1).kind, 'prop-knock', 'the flick clicks');
  const before = props.visual.top.spinner.rotation.y;
  for (let i = 0; i < 30; i++) props.step(PHYS.step);
  assert(props.visual.top.spinner.rotation.y - before > 0.3, 'flicked top spins hard');
  props.dispose();
}

console.log('Scatter layout, double jump, proximity animation, prop knock, duck ride and top flick verified');
