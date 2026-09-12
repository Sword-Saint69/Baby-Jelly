import { Box3, Vector3, type Scene } from 'three/webgpu';
import type { FacilityShadows } from '../graphics/facility-shadows.ts';
import type { SoftBody } from '../physics/soft-body.js';
import { FacilityCollision } from '../physics/facility-collision.ts';
import { Slide } from '../graphics/slide.ts';
import { SlidePhysics, SLIDE } from './slide-physics.ts';
import type { Facility } from './facilities.ts';
import type { FacilitySoundSink } from './facility-sound.ts';

const WHOOSH_MIN_INTERVAL=.25;
const WHOOSH_MIN_SPEED=.25;

/**
 * A climb-and-ride slide: board at the ladder, scramble up, push off from
 * the perch and launch out of the chute with a whoosh, laughing on fast runs.
 */
export class SlideFacility implements Facility {
  readonly id='west-slide';
  readonly label='Slide';
  readonly cameraDistance=.30;
  readonly physics:SlidePhysics;
  private readonly visual=new Slide();
  readonly collision:FacilityCollision;
  private readonly sound:FacilitySoundSink;
  private laughStarted=false;
  private time=0;
  private lastWhoosh=-WHOOSH_MIN_INTERVAL;
  constructor(scene:Scene,body:SoftBody,shadows:FacilityShadows,sound:FacilitySoundSink=()=>{}) {
    this.collision=new FacilityCollision(body);
    this.sound=sound;
    this.physics=new SlidePhysics(body);
    scene.add(this.visual.group);
    this.collision.registerBoxes(this.visual.boxes);
    shadows.add(this.visual.group,new Box3(
      new Vector3(SLIDE.x-.07,0,SLIDE.ladderZ-.03),
      new Vector3(SLIDE.x+.07,SLIDE.topY+.02,SLIDE.exitZ+.03),
    ));
  }
  get active() {return this.physics.riding;}
  get laughing() {return this.active&&this.laughStarted;}
  get action() {
    if(!this.active)return 'Climb slide';
    return this.physics.perched?'Push off':'Hop off';
  }
  get mobileAction() {
    if(!this.active)return 'Climb slide';
    return this.physics.perched?'Push off':'Hop off';
  }
  get interactionDistance() {
    if(this.active)return this.physics.perched?0:Infinity;
    return this.physics.nearby
      ?Math.hypot(this.physics.body.center.x-SLIDE.x,this.physics.body.center.z-SLIDE.ladderZ)
      :Infinity;
  }
  interact() {
    if(this.physics.perched)return this.physics.push();
    const changed=this.physics.toggle();
    if(changed)this.laughStarted=false;
    return changed;
  }
  step(h:number) {
    this.time+=h;
    this.physics.step(h);
    if(this.physics.sliding&&this.physics.speed>=SLIDE.laughSpeed)this.laughStarted=true;
    // A fresh whoosh voice every few tenths while rushing the chute.
    if(this.physics.sliding&&this.physics.speed>=WHOOSH_MIN_SPEED
      &&this.time-this.lastWhoosh>=WHOOSH_MIN_INTERVAL) {
      this.lastWhoosh=this.time;
      const center=this.physics.body.center;
      this.sound({kind:'slide-whoosh',strength:Math.min(1,this.physics.speed/.8),
        x:center.x,y:center.y,z:center.z});
    }
  }
  afterStep() {
    if(this.active)return;
    if(!this.collision.mayCollide())return;
    this.collision.resolveBoxes(this.visual.boxes);
  }
  update() {}
  reset() {this.laughStarted=false;this.time=0;this.lastWhoosh=-WHOOSH_MIN_INTERVAL;this.physics.reset();}
  dispose() {this.collision.dispose();this.visual.dispose();}
}
