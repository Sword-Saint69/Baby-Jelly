import { Vector3, type Scene } from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import { PHYS } from '../physics/constants.js';
import type { FacilityShadows } from '../graphics/facility-shadows.ts';
import { FacilityCollision, type CollisionBox } from '../physics/facility-collision.ts';
import { ScatterProps } from '../graphics/props.ts';
import type { Facility } from './facilities.ts';
import type { FacilitySoundSink } from './facility-sound.ts';

const TOP_WAKE_RADIUS=.16;
const TOP_SPIN_RATE=14;
const TOP_SPIN_RADIUS=.12;
const DUCK_WAKE_RADIUS=.15;
const DUCK_RIDE_RADIUS=.12;
/** Gentle rocking-horse roll: peak angle, period and sit height in SI units. */
const DUCK_ROCK_MAX=.16;
const DUCK_ROCK_FREQ=Math.PI*2/1.6;
const DUCK_SIT_BASE=.033;
const DUCK_LAUGH_TIME=3;
const RIDE_SQUEAK_INTERVAL=2;
const KNOCK_MIN_SPEED=.2;
const KNOCK_MIN_INTERVAL=.18;

/**
 * Scatter props with two interactions: riding the rubber duck (a full
 * body-owning ride like the swing, with laughter and camera handoff) and
 * flicking the spinning top (a momentary impulse, no ownership change).
 */
export class StaticProps implements Facility {
  readonly id='scatter-props';
  readonly label='Duck';
  readonly cameraDistance=.26;
  readonly visual:ScatterProps;
  readonly collision:FacilityCollision;
  readonly body:SoftBody;
  private readonly sound:FacilitySoundSink;
  /** Collision set while riding: everything except the duck's own volume. */
  private readonly rideBoxes:CollisionBox[];
  private readonly restX:Float64Array;
  private readonly restY:Float64Array;
  private readonly restZ:Float64Array;
  private readonly stiffness:Float64Array;
  private readonly damping:Float64Array;
  private readonly minRestY:number;
  private readonly target=new Vector3();
  private time=0;
  private riding=false;
  private rideTime=0;
  private rockPhase=0;
  private lastRideSqueak=0;
  private topOmega=0;
  private topAngle=0;
  private duckAmp=0;
  private duckPhase=0;
  private lastKnock=-KNOCK_MIN_INTERVAL;
  private readonly prevCenter=new Vector3();
  private hasPrevCenter=false;
  constructor(scene:Scene,body:SoftBody,shadows:FacilityShadows,sound:FacilitySoundSink=()=>{}) {
    this.body=body;this.sound=sound;
    this.visual=new ScatterProps();
    this.collision=new FacilityCollision(body);
    this.collision.registerBoxes(this.visual.boxes);
    this.rideBoxes=this.visual.duckBox
      ?this.visual.boxes.filter(box=>box!==this.visual.duckBox)
      :[...this.visual.boxes];
    const count=body.mass.length;
    this.restX=new Float64Array(count);this.restY=new Float64Array(count);this.restZ=new Float64Array(count);
    this.stiffness=new Float64Array(count);this.damping=new Float64Array(count);
    let low=Infinity;
    for(let i=0;i<count;i++){low=Math.min(low,body.rest[i*3+1]);}
    this.minRestY=low;
    for(let i=0;i<count;i++){
      const j=i*3;
      this.restX[i]=body.rest[j];this.restY[i]=body.rest[j+1];this.restZ[i]=body.rest[j+2];
      const support=Math.max(0,1-body.rest[j+1]/.027);
      this.stiffness[i]=650+support*6500;
      this.damping[i]=22+support*65;
    }
    scene.add(this.visual.group);
    shadows.add(this.visual.group,this.visual.envelope);
  }
  get active() {return this.riding;}
  get laughing() {return this.riding&&this.rideTime>DUCK_LAUGH_TIME;}
  get action() {return this.riding?'Get Off Duck':this.hotspot()==='top'?'Spin Top':'Ride Duck';}
  get mobileAction() {return this.riding?'Get off':this.hotspot()==='top'?'Spin top':'Ride duck';}
  get interactionDistance() {
    // An active ride retains ownership through the shared manager.
    if(this.riding||!this.nearby())return Infinity;
    const spot=this.hotspot();
    if(!spot)return Infinity;
    const c=this.body.center,a=spot==='duck'?this.visual.duck!:this.visual.top!;
    return Math.hypot(c.x-a.x,c.z-a.z);
  }
  private nearby() {return !this.body.grab&&this.body.grounded;}
  /** Nearest available hotspot, independent of boarding conditions. */
  private hotspot(): 'duck'|'top'|null {
    const c=this.body.center,v=this.visual;
    const dDuck=v.duck?Math.hypot(c.x-v.duck.x,c.z-v.duck.z):Infinity;
    const dTop=v.top?Math.hypot(c.x-v.top.x,c.z-v.top.z):Infinity;
    const duckOk=v.duck&&dDuck<=DUCK_RIDE_RADIUS;
    const topOk=v.top&&dTop<=TOP_SPIN_RADIUS;
    if(!duckOk&&!topOk)return null;
    return dDuck<=dTop?'duck':'top';
  }
  private squeak(strength:number,x:number,y:number,z:number) {
    this.sound({kind:'duck-squeak',strength:Math.min(1,strength),x,y,z});
  }
  interact() {
    if(this.riding){this.dismount();return true;}
    const spot=this.hotspot();
    if(!spot||!this.nearby())return false;
    if(spot==='duck'){this.board();return true;}
    // A flick: overdrive the spin without taking body ownership.
    this.topOmega=TOP_SPIN_RATE*1.6;
    const top=this.visual.top!;
    this.sound({kind:'prop-knock',strength:.8,x:top.x,y:.02,z:top.z});
    return true;
  }
  /** Rider target in the duck's yawed, rolling frame for cage node i. */
  private riderTarget(i:number,rockCos:number,rockSin:number,out:Vector3) {
    const duck=this.visual.duck!;
    const c=Math.cos(duck.rotY),s=Math.sin(duck.rotY);
    const lx=this.restX[i],ly=this.restY[i]-this.minRestY+DUCK_SIT_BASE,lz=this.restZ[i];
    const rx=lx*rockCos-ly*rockSin,ry=lx*rockSin+ly*rockCos;
    out.set(duck.x+rx*c+lz*s,ry,duck.z-rx*s+lz*c);
  }
  private board() {
    const duck=this.visual.duck!;
    this.riding=true;this.rideTime=0;this.rockPhase=0;this.duckAmp=0;
    this.lastRideSqueak=this.time;
    for(let i=0;i<this.body.mass.length;i++) {
      const j=i*3;this.riderTarget(i,1,0,this.target);
      this.body.x[j]=this.target.x;this.body.x[j+1]=this.target.y;this.body.x[j+2]=this.target.z;
      this.body.velocity[j]=0;this.body.velocity[j+1]=0;this.body.velocity[j+2]=0;
    }
    this.visual.setDuckRock(0);
    this.body.previous.set(this.body.x);this.body.wake();this.body.updateCenter();this.body.surfaceDirty=true;
    this.squeak(.9,duck.x,.04,duck.z);
  }
  private dismount() {
    // Step off to the world +X side and rest the lowest point on the floor,
    // retaining the jelly's current elastic deformation.
    const b=this.body;
    let low=Infinity;
    for(let i=0;i<b.mass.length;i++)low=Math.min(low,b.x[i*3+1]);
    for(let j=0;j<b.x.length;j+=3){b.x[j]+=.10;b.x[j+1]+=PHYS.floor+.002-low;}
    b.previous.set(b.x);b.velocity.fill(0);b.wake();b.updateCenter();b.surfaceDirty=true;
    this.riding=false;
    // Resume the proximity rock where the ride left off to avoid a snap.
    const rock=this.visual.duck?rockAngleNow(this.rockPhase,this.rideTime):0;
    this.duckAmp=Math.min(1,Math.abs(rock)/.09);
    this.duckPhase=Math.PI/2*Math.sign(rock||1);
    const duck=this.visual.duck!;
    this.squeak(.6,duck.x,.04,duck.z);
  }
  step(h:number) {
    this.time+=h;
    const center=this.body.center;
    // The top whirs up as the baby approaches and coasts down as it leaves.
    // Poses snap exactly to rest so idle shadows stay cached.
    if(this.visual.top) {
      const near=Math.hypot(center.x-this.visual.top.x,center.z-this.visual.top.z)<TOP_WAKE_RADIUS;
      const target=near?TOP_SPIN_RATE:0;
      this.topOmega+=(target-this.topOmega)*(1-Math.exp(-3*h));
      if(target===0&&Math.abs(this.topOmega)<.02)this.topOmega=0;
      this.topAngle+=this.topOmega*h;
      this.visual.setTopSpin(this.topAngle,Math.min(.3,.02*this.topOmega));
    }
    if(this.riding)this.stepRide(h);
    else if(this.visual.duck) {
      // The duck rocks gently while the baby is close by.
      const near=Math.hypot(center.x-this.visual.duck.x,center.z-this.visual.duck.z)<DUCK_WAKE_RADIUS;
      const target=near?1:0;
      this.duckAmp+=(target-this.duckAmp)*(1-Math.exp(-4*h));
      if(target===0&&this.duckAmp<.002)this.duckAmp=0;
      this.duckPhase+=h*7;
      this.visual.setDuckRock(Math.sin(this.duckPhase)*.09*this.duckAmp);
    }
  }
  private stepRide(h:number) {
    const duck=this.visual.duck!;
    this.rideTime+=h;this.rockPhase+=h*DUCK_ROCK_FREQ;
    const ramp=1-Math.exp(-this.rideTime/2.5);
    const rock=DUCK_ROCK_MAX*ramp*Math.sin(this.rockPhase);
    const rockRate=DUCK_ROCK_MAX*ramp*Math.cos(this.rockPhase)*DUCK_ROCK_FREQ;
    this.visual.setDuckRock(rock);
    if(ramp>.6&&this.time-this.lastRideSqueak>RIDE_SQUEAK_INTERVAL) {
      this.lastRideSqueak=this.time;
      this.squeak(.5,duck.x,.04,duck.z);
    }
    const b=this.body;b.canSleep=false;b.wake();
    const c=Math.cos(duck.rotY),s=Math.sin(duck.rotY);
    const rockCos=Math.cos(rock),rockSin=Math.sin(rock);
    for(let i=0;i<b.mass.length;i++) {
      const j=i*3;this.riderTarget(i,rockCos,rockSin,this.target);
      // Frame velocity of a roll about local Z, expressed in world space.
      const dx=b.x[j]-duck.x,dz=b.x[j+2]-duck.z;
      const lx=dx*c-dz*s,ly=b.x[j+1];
      const fvx=-rockRate*ly*c,fvy=rockRate*lx,fvz=rockRate*ly*s;
      const stiffness=this.stiffness[i],damping=this.damping[i];
      b.velocity[j]+=(stiffness*(this.target.x-b.x[j])-damping*(b.velocity[j]-fvx))*h;
      b.velocity[j+1]+=(stiffness*(this.target.y-b.x[j+1])-damping*(b.velocity[j+1]-fvy)+PHYS.gravity)*h;
      b.velocity[j+2]+=(stiffness*(this.target.z-b.x[j+2])-damping*(b.velocity[j+2]-fvz))*h;
    }
  }
  afterStep() {
    const boxes=this.riding?this.rideBoxes:this.visual.boxes;
    const changed=boxes.length>0&&this.collision.mayCollide()
      ?this.collision.resolveBoxes(boxes)
      :false;
    // A soft wooden knock when the body thumps into a collidable prop.
    const center=this.body.center;
    if(!this.hasPrevCenter){this.prevCenter.copy(center);this.hasPrevCenter=true;return;}
    const speed=this.prevCenter.distanceTo(center)/PHYS.step;
    this.prevCenter.copy(center);
    if(!changed||speed<KNOCK_MIN_SPEED||this.time-this.lastKnock<KNOCK_MIN_INTERVAL)return;
    this.lastKnock=this.time;
    let best=boxes[0],bestDistance=Infinity;
    for(const box of boxes) {
      const distance=Math.hypot(box.center.x-center.x,box.center.y-center.y,box.center.z-center.z);
      if(distance<bestDistance){bestDistance=distance;best=box;}
    }
    this.sound({kind:'prop-knock',strength:Math.min(1,speed/1.5),
      x:best.center.x,y:best.center.y,z:best.center.z});
  }
  update() {}
  reset() {
    this.riding=false;this.rideTime=0;this.rockPhase=0;this.lastRideSqueak=0;
    this.topOmega=0;this.topAngle=0;this.duckAmp=0;this.duckPhase=0;
    this.lastKnock=-KNOCK_MIN_INTERVAL;this.hasPrevCenter=false;
    this.visual.setTopSpin(0,0);this.visual.setDuckRock(0);
  }
  dispose() {this.collision.dispose();this.visual.dispose();}
}

/** Ride rock angle at the end of a ride, so dismount resumes without a snap. */
function rockAngleNow(phase:number,rideTime:number) {
  return DUCK_ROCK_MAX*(1-Math.exp(-rideTime/2.5))*Math.sin(phase);
}
