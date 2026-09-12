import { Vector3 } from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import { PHYS } from '../physics/constants.js';

// Metres. A timber slide tucked in the north-west: ladder up the back,
// platform, then a straight chute running south toward the middle.
export const SLIDE={
  x:-.30,topZ:-.30,exitZ:-.14,topY:.10,exitY:.018,
  ladderZ:-.355,interactionRadius:.14,
  climbTime:1.15,pushSpeed:.10,maxSpeed:.80,laughSpeed:.45,
};

export type SlideStage='climb'|'perch'|'slide';

/** Board at the ladder, climb, wait perched, then ride the chute to a launch. */
export class SlidePhysics {
  riding=false;
  stage:SlideStage='climb';
  /** Current chute speed; meaningful while sliding. */
  speed=0;
  private climbT=0;
  private slideD=0;
  private readonly target=new Vector3();
  private readonly restCenter=new Vector3();
  private readonly restOffset:Float64Array;
  private readonly stiffness:Float64Array;
  private readonly damping:Float64Array;
  readonly body:SoftBody;
  constructor(body:SoftBody) {
    this.body=body;
    const count=body.mass.length;
    this.restOffset=new Float64Array(count*3);
    this.stiffness=new Float64Array(count);this.damping=new Float64Array(count);
    for(let i=0;i<count;i++)this.restCenter.addScaledVector(new Vector3().fromArray(body.rest,i*3),body.mass[i]/body.totalMass);
    for(let i=0;i<count;i++) {
      const j=i*3;
      this.restOffset[j]=body.rest[j]-this.restCenter.x;
      this.restOffset[j+1]=body.rest[j+1]-this.restCenter.y;
      this.restOffset[j+2]=body.rest[j+2]-this.restCenter.z;
      const support=Math.max(0,1-body.rest[j+1]/.027);
      this.stiffness[i]=650+support*6500;
      this.damping[i]=22+support*65;
    }
  }
  private get pathStart() {return {x:SLIDE.x,y:SLIDE.topY+this.restCenter.y,z:SLIDE.topZ+.01};}
  private get pathEnd() {return {x:SLIDE.x,y:SLIDE.exitY+this.restCenter.y,z:SLIDE.exitZ};}
  private get pathLength() {
    const a=this.pathStart,b=this.pathEnd;
    return Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
  }
  get nearby() {
    return !this.body.grab&&this.body.grounded
      &&Math.hypot(this.body.center.x-SLIDE.x,this.body.center.z-SLIDE.ladderZ)<SLIDE.interactionRadius;
  }
  get sliding() {return this.riding&&this.stage==='slide';}
  get perched() {return this.riding&&this.stage==='perch';}
  toggle() {
    if(this.riding){this.leave();return true;}
    if(!this.nearby)return false;
    this.riding=true;this.stage='climb';this.climbT=0;this.slideD=0;this.speed=0;
    this.body.wake();
    return true;
  }
  /** Shove off from the perch; only the seated rider can push. */
  push() {
    if(!this.perched)return false;
    this.stage='slide';this.slideD=0;this.speed=SLIDE.pushSpeed;
    return true;
  }
  leave() {
    // Step off toward the middle and rest the lowest point on the floor,
    // retaining the jelly's current elastic deformation.
    const b=this.body;
    let low=Infinity;
    for(let i=0;i<b.mass.length;i++)low=Math.min(low,b.x[i*3+1]);
    for(let j=0;j<b.x.length;j+=3){b.x[j]+=.11;b.x[j+1]+=PHYS.floor+.003-low;}
    b.previous.set(b.x);b.velocity.fill(0);b.wake();b.updateCenter();b.surfaceDirty=true;
    this.riding=false;this.stage='climb';this.climbT=0;this.slideD=0;this.speed=0;
  }
  reset() {this.riding=false;this.stage='climb';this.climbT=0;this.slideD=0;this.speed=0;}
  private chutePoint(d:number,out:Vector3) {
    const a=this.pathStart,b=this.pathEnd,length=this.pathLength;
    const t=Math.max(0,Math.min(1,d/length));
    out.set(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);
  }
  private climbAnchor(out:Vector3) {
    // Ladder base to platform with an ease-in-out so the scramble reads.
    const t=this.climbT<.5?2*this.climbT*this.climbT:1-((-2*this.climbT+2)**2)/2;
    out.set(SLIDE.x,this.restCenter.y+SLIDE.topY*t,SLIDE.ladderZ+(SLIDE.topZ+.01-SLIDE.ladderZ)*t);
  }
  private servo(h:number) {
    const b=this.body;
    b.canSleep=false;b.wake();
    for(let i=0;i<b.mass.length;i++) {
      const j=i*3,stiffness=this.stiffness[i],damping=this.damping[i];
      b.velocity[j]+=(stiffness*(this.target.x+this.restOffset[j]-b.x[j])-damping*b.velocity[j])*h;
      b.velocity[j+1]+=(stiffness*(this.target.y+this.restOffset[j+1]-b.x[j+1])-damping*b.velocity[j+1])*h;
      b.velocity[j+2]+=(stiffness*(this.target.z+this.restOffset[j+2]-b.x[j+2])-damping*b.velocity[j+2])*h;
    }
  }
  step(h:number) {
    if(!this.riding)return;
    if(this.stage==='climb') {
      this.climbT=Math.min(1,this.climbT+h/SLIDE.climbTime);
      this.climbAnchor(this.target);
      this.servo(h);
      if(this.climbT>=1){this.stage='perch';this.chutePoint(0,this.target);}
      return;
    }
    if(this.stage==='perch') {
      this.chutePoint(0,this.target);
      this.servo(h);
      return;
    }
    // Gravity along the straight chute, capped so the landing stays friendly.
    const a=this.pathStart,b=this.pathEnd,length=this.pathLength;
    const slope=(a.y-b.y)/length;
    this.speed=Math.min(SLIDE.maxSpeed,this.speed+PHYS.gravity*slope*.92*h);
    this.slideD+=this.speed*h;
    this.chutePoint(this.slideD,this.target);
    if(this.slideD>=length){this.launch();return;}
    const tangent=new Vector3(b.x-a.x,b.y-a.y,b.z-a.z).normalize();
    // The whole body rides the tangent so the exit velocity is coherent.
    const body=this.body;
    body.canSleep=false;body.wake();
    for(let i=0;i<body.mass.length;i++) {
      const j=i*3;
      body.velocity[j]=tangent.x*this.speed;
      body.velocity[j+1]=tangent.y*this.speed;
      body.velocity[j+2]=tangent.z*this.speed;
    }
    body.previous.set(body.x);body.surfaceDirty=true;
  }
  private launch() {
    // Keep the chute velocity: the solver sees consistent motion, no snap.
    const a=this.pathStart,b=this.pathEnd;
    const tangent=new Vector3(b.x-a.x,b.y-a.y,b.z-a.z).normalize();
    const body=this.body;
    for(let i=0;i<body.mass.length;i++) {
      const j=i*3;
      body.velocity[j]=tangent.x*this.speed;
      body.velocity[j+1]=tangent.y*this.speed;
      body.velocity[j+2]=tangent.z*this.speed;
      body.previous[j]=body.x[j]-body.velocity[j]*PHYS.step;
      body.previous[j+1]=body.x[j+1]-body.velocity[j+1]*PHYS.step;
      body.previous[j+2]=body.x[j+2]-body.velocity[j+2]*PHYS.step;
    }
    body.wake();body.updateCenter();body.surfaceDirty=true;
    this.riding=false;this.stage='climb';this.climbT=0;this.slideD=0;
  }
}
