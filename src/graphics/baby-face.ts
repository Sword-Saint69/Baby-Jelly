import * as THREE from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import { refinePatch } from './surface-details.ts';
import { FaceSkin } from './face-skin.ts';
import { SleepBubble } from './sleep-bubble.ts';
import { FaceExpression } from './face-expression.ts';
import type { FaceOrganLayout } from './character-features.ts';

type Feature='eye'|'blush'|'brow'|'mouth'|'tongue'|'tooth'|'whisker';
type Detail={mesh:THREE.Mesh;rest:Float32Array;cx:number;cy:number;depth:number;kind:Feature;yaw:number};

export const BASELINE_FACE_LAYOUT:FaceOrganLayout={eyeDX:1,eyeDY:0,eyeSX:1,eyeSY:1,browDX:1,browDY:0,browSlant:0,browThick:1,
  blushDX:1,blushDY:0,blushS:1,mouthDY:0,mouthS:1,mouthShape:'smile',tooth:false,whiskers:false};

export class BabyFace {
  private readonly details:Detail[]=[];
  private readonly skin:FaceSkin;
  private readonly expression=new FaceExpression();
  private readonly sample=new Float64Array(6);
  private surfaceVersion=-1;
  private lastBlink=-1;
  private lastSob=-1;
  private lastLaugh=-1;
  private lastSleep=-1;
  private readonly bubble:SleepBubble;
  private readonly body:SoftBody;
  /** Per-character resting-face lift so ears/snouts don't crowd the brows. */
  faceShiftY=0;
  /** Horizontal face proportion for narrower/wider heads (scales feature cx). */
  faceWidth=1;
  private readonly whiskerBase=new THREE.Vector3();
  private readonly whiskerNormal=new THREE.Vector3();
  private readonly whiskerAlign=new THREE.Quaternion();
  private readonly whiskerYaw=new THREE.Quaternion();
  private readonly whiskerUp=new THREE.Vector3(0,0,1);
  private readonly whiskerAxisY=new THREE.Vector3(0,1,0);
  constructor(body:SoftBody,group:THREE.Group,faceWidth=1,layout:FaceOrganLayout=BASELINE_FACE_LAYOUT) {
    this.body=body;
    this.faceWidth=faceWidth;
    this.skin=new FaceSkin(body);
    this.bubble=new SleepBubble(group);
    const eye=new THREE.MeshPhysicalNodeMaterial({color:'#142905',roughness:.13,clearcoat:1,clearcoatRoughness:.06});
    const mouth=new THREE.MeshPhysicalNodeMaterial({color:'#254508',roughness:.24,clearcoat:.6});
    const tongue=new THREE.MeshPhysicalNodeMaterial({color:'#b5d641',roughness:.24,clearcoat:.5});
    const enamel=new THREE.MeshPhysicalNodeMaterial({color:'#fbf6e6',roughness:.25,clearcoat:.5});
    const blush=new THREE.MeshPhysicalNodeMaterial({color:'#edab4f',roughness:.3,transparent:true,opacity:.30,depthWrite:false});
    const add=(geometry:THREE.BufferGeometry,mat:THREE.Material,cx:number,cy:number,depth:number,kind:Feature,yaw=0)=>{
      const rest=new Float32Array(geometry.getAttribute('position').array);
      geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(rest.length),3).setUsage(THREE.DynamicDrawUsage));
      const mesh=new THREE.Mesh(geometry,mat);mesh.frustumCulled=false;
      mesh.userData.kind=kind;
      // Surface ink must render after transmission to avoid a refracted duplicate.
      mat.transparent=true;mesh.renderOrder=2;
      group.add(mesh);this.details.push({mesh,rest,cx,cy,depth,kind,yaw});
    };
    const oval=(x:number,y:number,z:number)=>new THREE.SphereGeometry(1,40,24,0,Math.PI*2,0,Math.PI/2).rotateX(Math.PI/2).scale(x,y,z);
    for(const sign of [-1,1]) {
      add(oval(.00325*layout.eyeSX,.0043*layout.eyeSY,.0015),eye,sign*.0095*this.faceWidth*layout.eyeDX,.0465+layout.eyeDY,.00010,'eye');
      add(oval(.0043*layout.blushS,.0024*layout.blushS,.00016),blush,sign*.014*this.faceWidth*layout.blushDX,.0388+layout.blushDY,.00010,'blush');
      const brow=new THREE.CatmullRomCurve3([
        new THREE.Vector3(-.0021,-.0005,0),new THREE.Vector3(0,.00045,0),new THREE.Vector3(.0021,-.0002,0),
      ]);
      const browGeometry=new THREE.TubeGeometry(brow,16,.00048*layout.browThick,8,false);
      if(layout.browSlant!==0)browGeometry.rotateZ(sign*layout.browSlant);
      add(browGeometry,mouth,sign*.0097*this.faceWidth*layout.browDX,.0542+layout.browDY,.00025,'brow');
    }
    const smile=new THREE.Shape();
    if(layout.mouthShape==='omega') {
      // Cat ω mouth: twin peaks with a center notch over a rounded chin.
      smile.moveTo(-.0048,.0016);
      smile.bezierCurveTo(-.0032,.0016,-.0028,.0018,-.0012,.0004);
      smile.bezierCurveTo(-.0004,-.0003,.0004,-.0003,.0012,.0004);
      smile.bezierCurveTo(.0028,.0018,.0032,.0016,.0048,.0016);
      smile.bezierCurveTo(.0052,-.0035,-.0048,-.0040,-.0048,.0016);
    } else {
      smile.moveTo(-.0046,.0019);smile.bezierCurveTo(-.002,.0006,.002,.0006,.0046,.002);
      smile.bezierCurveTo(.0055,-.0046,-.0048,-.0052,-.0046,.0019);
    }
    const mouthGeometry=refinePatch(new THREE.ShapeGeometry(smile,24));
    if(layout.mouthS!==1)mouthGeometry.scale(layout.mouthS,layout.mouthS,1);
    add(mouthGeometry,mouth,0,.0389+layout.mouthDY,.00018,'mouth');
    const lip=new THREE.Shape();lip.absellipse(0,0,.0024,.00125,0,Math.PI*2,false,0);
    const tongueGeometry=refinePatch(new THREE.ShapeGeometry(lip,24));
    if(layout.mouthS!==1)tongueGeometry.scale(layout.mouthS,layout.mouthS,1);
    add(tongueGeometry,tongue,0,.0368+layout.mouthDY,.00028,'tongue');
    if(layout.tooth) {
      // Buck tooth overlapping the smile's lower edge.
      const toothGeometry=new THREE.BoxGeometry(.0016,.003,0.0008,1,2,1);
      add(toothGeometry,enamel,0,.0389+layout.mouthDY-.005,.00030,'tooth');
    }
    if(layout.whiskers) {
      // Rigid feelers: only their bases are skin-anchored each frame, so the
      // tips stay out in the air instead of plastering onto the cheek.
      for(const sign of [-1,1])for(let w=0;w<3;w++) {
        const strand=new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(0,0,0),
          new THREE.Vector3(sign*.004,(w-1)*.0009,.0006),
          new THREE.Vector3(sign*.0085,(w-1)*.0016,.0012),
        );
        add(new THREE.TubeGeometry(strand,8,.00012,6,false),mouth,sign*.0115*this.faceWidth,.040,.00010,'whisker',sign>0?0:Math.PI);
      }
    }
  }
  reset() { this.expression.reset();this.bubble.reset(); }
  update(dt:number,playing=false,sleeping=false) {
    this.expression.update(dt,this.body.grabs.length>0,playing,sleeping);
    const {sob,laugh,blink,time,sleep}=this.expression;
    this.bubble.update(dt,sleep,time,this.skin);
    const version=this.body.surface.geometry.attributes.position.version;
    if(sleep===0&&this.lastSleep===0&&version===this.surfaceVersion&&blink===this.lastBlink&&sob===this.lastSob&&laugh===this.lastLaugh&&sob===0&&laugh===0)return;
    this.lastSleep=sleep;this.surfaceVersion=version;this.lastBlink=blink;this.lastSob=sob;this.lastLaugh=laugh;
    const quiver=Math.sin(time*33)*.00022*sob;
    const chuckle=(.5+.5*Math.sin(time*19))*laugh;
    for(const {mesh,rest,cx,cy,depth,kind,yaw} of this.details) {
      if(kind==='tongue')(mesh.material as THREE.Material).opacity=1-sleep;
      if(kind==='whisker') {
        this.skin.sample(cx,cy+this.faceShiftY,.00010,this.sample);
        this.whiskerBase.set(this.sample[0],this.sample[1],this.sample[2]);
        this.whiskerNormal.set(this.sample[3],this.sample[4],this.sample[5]);
        mesh.position.copy(this.whiskerBase);
        this.whiskerAlign.setFromUnitVectors(this.whiskerUp,this.whiskerNormal);
        this.whiskerYaw.setFromAxisAngle(this.whiskerAxisY,yaw);
        mesh.quaternion.copy(this.whiskerAlign).multiply(this.whiskerYaw);
        continue;
      }
      const positions=mesh.geometry.getAttribute('position');
      for(let i=0;i<positions.count;i++) {
        let x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2];
        if(kind==='eye') {
          // Fold the original oval into a thin chevron, with its point facing
          // the nose. Keeping the vertical parameter gives two distinct arms.
          // Allow for the diagonal arms so their visible width matches the brows.
          const squeezedX=x*.38+Math.sign(cx)*(.0055*Math.abs(y/.0043)-.0028);
          const squeezedY=y*.67+quiver*.35;
          const squeezedZ=z*.20;
          const close=Math.max(blink*(1-sleep),laugh*.90,sleep);
          y*=1-close*.94;z*=1-close*.88;
          // Idle blinks and giggles blend into the grabbed > < silhouette.
          y+=(1-Math.min(1,(x/.00325)**2))*laugh*.00125;
          y-=sleep*(1-Math.min(1,(x/.00325)**2))*.0010;
          x+=(squeezedX-x)*sob;
          y+=(squeezedY-y)*sob;
          z+=(squeezedZ-z)*sob;
        } else if(kind==='brow') {
          const inner=-Math.sign(cx)*x/.0021;
          y+=sob*(.0006+inner*.0011)+laugh*.00055;
          y+=quiver*.6-sleep*.0013;
        } else if(kind==='mouth'||kind==='tongue'||kind==='tooth') {
          // Transform mouth and tongue in one shared frame to keep the tongue inside.
          y+=cy-.0389;
          x*=1-sob*.22+laugh*.18;
          y*=1-sob*.48+chuckle*.32;
          y+=sob*(.0011-.0030*(x/.0046)**2)+quiver;
          y-=laugh*.0003;
          x*=1-sleep*.57;
          y*=1-sleep*.62;
          y-=cy-.0389;
        } else {
          y+=laugh*.00065+sob*.00025;
        }
        this.skin.sample(x+cx,y+cy+this.faceShiftY,Math.max(.00008,z+depth),this.sample);
        positions.setXYZ(i,this.sample[0],this.sample[1],this.sample[2]);
      }
      positions.needsUpdate=true;mesh.geometry.computeVertexNormals();
    }
  }
}
