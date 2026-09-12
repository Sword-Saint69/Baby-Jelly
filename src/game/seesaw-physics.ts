import { Vector3 } from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import { PHYS } from '../physics/constants.js';

// Metres. A spring-balanced plank on the east side: board one end, pump with
// the rock, hop off toward the middle.
export const SEESAW={
  x:.33,z:.10,pivot:.042,halfLength:.10,width:.05,seatOffset:.068,
  maxAngle:.36,interactionRadius:.14,seatMass:.02,
};

/** Driven rocking plank; a compliant rider remains in the FEM solver. */
export class SeesawPhysics {
  angle=0;
  speed=0;
  riding=false;
  private elapsed=0;
  private readonly target=new Vector3();
  private readonly targetX:Float64Array;
  private readonly localY:Float64Array;
  private readonly localZ:Float64Array;
  private readonly stiffness:Float64Array;
  private readonly damping:Float64Array;
  readonly body:SoftBody;
  constructor(body:SoftBody) {
    this.body=body;
    const count=body.mass.length;
    this.targetX=new Float64Array(count);this.localY=new Float64Array(count);this.localZ=new Float64Array(count);
    this.stiffness=new Float64Array(count);this.damping=new Float64Array(count);
    for(let i=0;i<count;i++) {
      const j=i*3,support=Math.max(0,1-body.rest[j+1]/.027);
      this.targetX[i]=SEESAW.x+body.rest[j];
      this.localY[i]=body.rest[j+1]+.002;
      this.localZ[i]=body.rest[j+2]+SEESAW.seatOffset;
      this.stiffness[i]=650+support*6500;
      this.damping[i]=22+support*65;
    }
  }
  get nearby() {
    return !this.body.grab&&this.body.grounded
      &&Math.hypot(this.body.center.x-SEESAW.x,this.body.center.z-SEESAW.z)<SEESAW.interactionRadius;
  }
  toggle() {
    if(this.riding){this.leave();return true;}
    if(!this.nearby)return false;
    this.riding=true;this.elapsed=0;
    const c=Math.cos(this.angle),s=Math.sin(this.angle);
    for(let i=0;i<this.body.mass.length;i++) {
      const j=i*3;this.riderTarget(i,this.target,c,s);
      this.body.x[j]=this.target.x;this.body.x[j+1]=this.target.y;this.body.x[j+2]=this.target.z;
      this.body.velocity[j]=0;
      this.body.velocity[j+1]=this.speed*(this.target.z-SEESAW.z);
      this.body.velocity[j+2]=-this.speed*(this.target.y-SEESAW.pivot);
    }
    this.body.previous.set(this.body.x);this.body.wake();this.body.updateCenter();this.body.surfaceDirty=true;
    return true;
  }
  leave() {
    // Step off toward the middle and rest the lowest point on the floor,
    // retaining the jelly's current elastic deformation.
    const b=this.body,c=Math.cos(this.angle),s=Math.sin(this.angle);
    let low=Infinity;
    for(let i=0;i<b.mass.length;i++) {
      const j=i*3,y=b.x[j+1]-SEESAW.pivot,z=b.x[j+2]-SEESAW.z;
      b.x[j]-=.11;b.x[j+1]=c*y-s*z+SEESAW.pivot;
      b.x[j+2]=SEESAW.z+s*y+c*z;
      low=Math.min(low,b.x[j+1]);
    }
    for(let j=1;j<b.x.length;j+=3)b.x[j]+=PHYS.floor+.003-low;
    b.previous.set(b.x);b.velocity.fill(0);b.wake();b.updateCenter();b.surfaceDirty=true;
    this.riding=false;
  }
  reset() {this.riding=false;this.angle=0;this.speed=0;this.elapsed=0;}
  private riderTarget(i:number,out:Vector3,c:number,s:number) {
    const y=this.localY[i],z=this.localZ[i];
    out.set(this.targetX[i],SEESAW.pivot+c*y+s*z,SEESAW.z-s*y+c*z);
  }
  step(h:number) {
    this.elapsed+=h;
    const frequency=PHYS.gravity/SEESAW.halfLength;
    const energy=.5*this.speed*this.speed+frequency*(1-Math.cos(this.angle));
    const amplitude=SEESAW.maxAngle*(1-Math.exp(-this.elapsed/5));
    const targetEnergy=frequency*(1-Math.cos(amplitude));
    // Pump in phase with motion; remove energy smoothly above the target.
    const drive=this.riding?Math.max(-2,Math.min(2,(targetEnergy-energy)*.9)):0;
    const kick=this.riding&&this.elapsed<.6?.5:0;
    // An empty plank brakes at the pivot instead of rocking forever.
    const friction=this.riding?.18:2.0;
    this.speed+=(-frequency*Math.sin(this.angle)-friction*this.speed+drive*this.speed+kick)*h;
    this.angle+=this.speed*h;
    // Conservative energy ceiling prevents overshoot without clipping turning points.
    const ceiling=frequency*(1-Math.cos(SEESAW.maxAngle));
    const kinetic=ceiling-frequency*(1-Math.cos(this.angle));
    if(.5*this.speed*this.speed>kinetic)this.speed=Math.sign(this.speed)*Math.sqrt(Math.max(0,2*kinetic));
    // An empty plank eases back to level instead of rocking forever.
    if(!this.riding&&Math.abs(this.angle)<.0005&&Math.abs(this.speed)<.0005){this.angle=0;this.speed=0;return;}
    if(!this.riding)return;
    const b=this.body;b.canSleep=false;b.wake();
    const c=Math.cos(this.angle),s=Math.sin(this.angle);
    for(let i=0;i<b.mass.length;i++) {
      const j=i*3;this.riderTarget(i,this.target,c,s);
      const y=this.target.y-SEESAW.pivot,z=this.target.z-SEESAW.z;
      const stiffness=this.stiffness[i],damping=this.damping[i];
      b.velocity[j]+=(stiffness*(this.target.x-b.x[j])-damping*b.velocity[j])*h;
      b.velocity[j+1]+=(stiffness*(this.target.y-b.x[j+1])-damping*(b.velocity[j+1]-this.speed*z))*h;
      b.velocity[j+2]+=(stiffness*(this.target.z-b.x[j+2])-damping*(b.velocity[j+2]+this.speed*y))*h;
    }
  }
}
