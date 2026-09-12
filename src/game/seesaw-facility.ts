import { Box3, Vector3, type Scene } from 'three/webgpu';
import type { FacilityShadows } from '../graphics/facility-shadows.ts';
import type { SoftBody } from '../physics/soft-body.js';
import { FacilityCollision } from '../physics/facility-collision.ts';
import { Seesaw } from '../graphics/seesaw.ts';
import { SeesawPhysics, SEESAW } from './seesaw-physics.ts';
import type { Facility } from './facilities.ts';
import { FacilityMotionSound, type FacilitySoundSink } from './facility-sound.ts';

const LAUGH_ANGLE=15*Math.PI/180;

/**
 * A pump-and-rock plank: board one end, let the rock build, hop off toward
 * the middle. Creaks and rushing air come from the shared motion synthesizer.
 */
export class SeesawFacility implements Facility {
  readonly id='east-seesaw';
  readonly label='Seesaw';
  readonly cameraDistance=.28;
  readonly physics:SeesawPhysics;
  private readonly visual=new Seesaw();
  readonly collision:FacilityCollision;
  private laughStarted=false;
  private laughBeyondThreshold=false;
  private readonly audio:FacilityMotionSound;
  constructor(scene:Scene,body:SoftBody,shadows:FacilityShadows,sound:FacilitySoundSink=()=>{}) {
    this.collision=new FacilityCollision(body);
    this.audio=new FacilityMotionSound(sound,{x:SEESAW.x,y:SEESAW.pivot,z:SEESAW.z});
    this.physics=new SeesawPhysics(body);
    this.visual.update(this.physics.angle);scene.add(this.visual.group);
    this.collision.registerBoxes(this.visual.boxes);
    shadows.add(this.visual.group,new Box3(
      new Vector3(SEESAW.x-.06,0,SEESAW.z-SEESAW.halfLength-.02),
      new Vector3(SEESAW.x+.06,SEESAW.pivot+.06,SEESAW.z+SEESAW.halfLength+.02),
    ));
  }
  get active() {return this.physics.riding;}
  get laughing() {return this.active&&this.laughStarted;}
  get action() {return this.active?'Hop off':'Ride seesaw';}
  get mobileAction() {return this.active?'Hop off':'Ride seesaw';}
  get interactionDistance() {
    return this.physics.nearby
      ?Math.hypot(this.physics.body.center.x-SEESAW.x,this.physics.body.center.z-SEESAW.z)
      :Infinity;
  }
  interact() {
    const changed=this.physics.toggle();
    if(changed) {
      this.laughStarted=false;
      this.laughBeyondThreshold=this.physics.riding&&Math.abs(this.physics.angle)>=LAUGH_ANGLE;
    }
    return changed;
  }
  step(h:number) {
    this.physics.step(h);
    this.audio.swing(h,this.physics.angle,this.physics.speed,this.active);
    // Remember only a threshold crossing that happens during this ride.
    const beyondThreshold=Math.abs(this.physics.angle)>=LAUGH_ANGLE;
    if(this.active&&!this.laughBeyondThreshold&&beyondThreshold)this.laughStarted=true;
    this.laughBeyondThreshold=this.active&&beyondThreshold;
  }
  afterStep() {
    if(this.active)return;
    if(!this.collision.mayCollide())return;
    this.collision.resolveBoxes(this.visual.boxes);
  }
  update() {this.visual.update(this.physics.angle);}
  reset() {this.audio.reset();this.laughStarted=false;this.laughBeyondThreshold=false;this.physics.reset();this.update();}
  dispose() {this.collision.dispose();this.visual.group.removeFromParent();this.visual.dispose();}
}
