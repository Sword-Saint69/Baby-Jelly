import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CollisionBox } from '../physics/facility-collision.ts';
import { makeSwingWoodMaterial } from './wood-material.ts';

/** Deterministic RNG so the scatter layout is stable across loads/tests. */
function mulberry32(seed:number) {
  let state=seed>>>0;
  return ()=>{
    state|=0;state=state+0x6D2B79F5|0;
    let t=Math.imul(state^state>>>15,1|state);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}

interface Exclusion {x:number;z:number;r:number}
const EXCLUSIONS:Exclusion[]=[
  {x:-.155,z:-.035,r:.17}, // swing + approach
  {x:.165,z:-.035,r:.17}, // trampoline + approach
  {x:.165,z:.205,r:.16}, // bed
  {x:-.155,z:.305,r:.18}, // wearable table
  {x:0,z:0,r:.13}, // spawn / walk lanes
];

const MIN_RADIUS=.38,MAX_RADIUS=.75;
const MIN_X=-.45,MAX_X=.45,MIN_Z=-.35,MAX_Z=.55;
const MIN_SEPARATION=.055;

export const PROPS_SEED=0xC0FFEE;

/** Tier A decorative scatter with a Tier B collidable subset (blocks, spools and below). */
export class ScatterProps {
  readonly group=new THREE.Group();
  readonly boxes:CollisionBox[]=[];
  readonly envelope=new THREE.Box3();
  /** Proximity-animated anchors; null when scatter placement failed. */
  top:{lean:THREE.Group;spinner:THREE.Group;x:number;z:number}|null=null;
  duck:{rocker:THREE.Group;x:number;z:number;rotY:number}|null=null;
  /** The duck's own collision volume, excluded while the baby rides it. */
  duckBox:CollisionBox|null=null;
  setTopSpin(angle:number,lean:number) {
    if(!this.top)return;
    this.top.spinner.rotation.y=angle;this.top.lean.rotation.x=lean;
  }
  setDuckRock(rock:number) {
    if(!this.duck)return;
    this.duck.rocker.rotation.z=rock;
  }
  constructor(seed=PROPS_SEED) {
    const random=mulberry32(seed);
    const placed:{x:number;z:number}[]=[];
    const claim=(x:number,z:number,radius:number)=>{
      if(x<MIN_X||x>MAX_X||z<MIN_Z||z>MAX_Z)return false;
      for(const e of EXCLUSIONS) {
        if(Math.hypot(x-e.x,z-e.z)<e.r+radius)return false;
      }
      for(const p of placed) {
        if(Math.hypot(x-p.x,z-p.z)<MIN_SEPARATION)return false;
      }
      placed.push({x,z});
      return true;
    };
    const scatter=(radius:number)=>{
      for(let attempt=0;attempt<60;attempt++) {
        const angle=random()*Math.PI*2;
        const r=MIN_RADIUS+random()*(MAX_RADIUS-MIN_RADIUS);
        const x=Math.cos(angle)*r,z=Math.sin(angle)*r*.9+.06;
        if(claim(x,z,radius))return {x,z,rotY:random()*Math.PI*2};
      }
      return null;
    };

    const wood=makeSwingWoodMaterial();
    const threadRed=new THREE.MeshStandardNodeMaterial({color:'#b3552f',roughness:.85});
    const threadSage=new THREE.MeshStandardNodeMaterial({color:'#7d8b6f',roughness:.85});
    const pebbleGray=new THREE.MeshStandardNodeMaterial({color:'#b9b0a1',roughness:.92});
    const pebbleDark=new THREE.MeshStandardNodeMaterial({color:'#8f887b',roughness:.95});
    const crayonYellow=new THREE.MeshStandardNodeMaterial({color:'#d9a441',roughness:.55});
    const crayonTeal=new THREE.MeshStandardNodeMaterial({color:'#3f7d7a',roughness:.55});
    const leafGreen=new THREE.MeshStandardNodeMaterial({color:'#7f9a5b',roughness:.9,side:THREE.DoubleSide});
    const leafDark=new THREE.MeshStandardNodeMaterial({color:'#5f7a44',roughness:.9,side:THREE.DoubleSide});

    const blockGeo=new RoundedBoxGeometry(.032,.032,.032,2,.004);
    const spoolCoreGeo=new THREE.CylinderGeometry(.007,.007,.02,14);
    const spoolFlangeGeo=new THREE.CylinderGeometry(.012,.012,.003,16);
    const spoolThreadGeo=new THREE.CylinderGeometry(.0105,.0105,.012,16);
    const pebbleGeo=new THREE.IcosahedronGeometry(.012,1);
    const crayonGeo=new THREE.CylinderGeometry(.004,.004,.05,10);
    const crayonTipGeo=new THREE.ConeGeometry(.004,.01,10);
    const leafGeo=new THREE.CircleGeometry(.016,7);

    const addMesh=(mesh:THREE.Mesh,x:number,y:number,z:number,rotY=0)=>{
      mesh.position.set(x,y,z);mesh.rotation.y=rotY;
      mesh.castShadow=true;mesh.receiveShadow=true;
      this.group.add(mesh);return mesh;
    };
    const addCollisionBox=(x:number,y:number,z:number,hx:number,hy:number,hz:number,rotY=0)=>{
      const c=Math.cos(rotY),s=Math.sin(rotY);
      this.boxes.push({
        center:new THREE.Vector3(x,y,z),
        halfSize:new THREE.Vector3(hx,hy,hz),
        xAxis:new THREE.Vector3(c,0,-s),
        yAxis:new THREE.Vector3(0,1,0),
        zAxis:new THREE.Vector3(s,0,c),
      });
    };

    // Tier B: wooden blocks (axis-aligned or Y-rotated boxes).
    for(let i=0;i<3;i++) {
      const spot=scatter(.03);
      if(!spot)continue;
      const scale=.85+random()*.3;
      const half=.016*scale;
      const mesh=new THREE.Mesh(blockGeo,wood);
      mesh.scale.setScalar(scale);
      mesh.rotation.y=spot.rotY;
      addMesh(mesh,spot.x,half,spot.z,spot.rotY);
      addCollisionBox(spot.x,half,spot.z,half,half,half,spot.rotY);
    }

    // Tier B: thread spools standing upright (boxed approximation of cylinder).
    const threadMats=[threadRed,threadSage];
    for(let i=0;i<2;i++) {
      const spot=scatter(.025);
      if(!spot)continue;
      const thread=threadMats[i%threadMats.length];
      const core=new THREE.Mesh(spoolCoreGeo,wood);addMesh(core,spot.x,.01,spot.z);
      const top=new THREE.Mesh(spoolFlangeGeo,wood);addMesh(top,spot.x,.0215,spot.z);
      const bottom=new THREE.Mesh(spoolFlangeGeo,wood);addMesh(bottom,spot.x,.0015,spot.z);
      const wrap=new THREE.Mesh(spoolThreadGeo,thread);addMesh(wrap,spot.x,.0115,spot.z);
      addCollisionBox(spot.x,.0115,spot.z,.013,.0115,.013);
    }

    // Tier A: pebbles (no collision).
    const pebbleMats=[pebbleGray,pebbleDark,pebbleGray];
    for(let i=0;i<3;i++) {
      const spot=scatter(.02);
      if(!spot)continue;
      const mesh=new THREE.Mesh(pebbleGeo,pebbleMats[i%pebbleMats.length]);
      mesh.scale.set(.8+random()*.5,.5+random()*.15,.8+random()*.5);
      addMesh(mesh,spot.x,.006,spot.z,spot.rotY);
    }

    // Tier A: crayons lying flat (no collision). Each crayon lives in a yawed
    // subgroup so the flat-lying rotation stays unambiguous under Euler order.
    const crayonMats=[crayonYellow,crayonTeal];
    for(let i=0;i<2;i++) {
      const spot=scatter(.03);
      if(!spot)continue;
      const mat=crayonMats[i%crayonMats.length];
      const yaw=new THREE.Group();yaw.position.set(spot.x,0,spot.z);yaw.rotation.y=spot.rotY;
      const bodyM=new THREE.Mesh(crayonGeo,mat);
      bodyM.rotation.z=Math.PI/2;bodyM.position.y=.004;
      bodyM.castShadow=true;bodyM.receiveShadow=true;yaw.add(bodyM);
      const tip=new THREE.Mesh(crayonTipGeo,mat);
      tip.rotation.z=-Math.PI/2;tip.position.set(.03,.004,0);
      tip.castShadow=true;tip.receiveShadow=true;yaw.add(tip);
      this.group.add(yaw);
    }

    // Tier A: leaves lying on the table (no collision).
    const leafMats=[leafGreen,leafDark];
    for(let i=0;i<2;i++) {
      const spot=scatter(.02);
      if(!spot)continue;
      const yaw=new THREE.Group();yaw.position.set(spot.x,0,spot.z);yaw.rotation.y=spot.rotY;
      const mesh=new THREE.Mesh(leafGeo,leafMats[i%leafMats.length]);
      mesh.rotation.x=-Math.PI/2;mesh.position.y=.0015;
      mesh.castShadow=true;mesh.receiveShadow=true;yaw.add(mesh);
      this.group.add(yaw);
    }

    // Tier A: glass marbles (no collision).
    const marbleA=new THREE.MeshPhysicalNodeMaterial({color:'#9fc4d8',roughness:.08,clearcoat:1,clearcoatRoughness:.1});
    const marbleB=new THREE.MeshPhysicalNodeMaterial({color:'#d8a45e',roughness:.08,clearcoat:1,clearcoatRoughness:.1});
    const marbleGeo=new THREE.SphereGeometry(.009,20,14);
    for(const mat of [marbleA,marbleB]) {
      const spot=scatter(.02);
      if(!spot)continue;
      addMesh(new THREE.Mesh(marbleGeo,mat),spot.x,.009,spot.z,spot.rotY);
    }

    // Tier B: a single die with merged pip dots (one mesh for all 21 pips).
    {
      const spot=scatter(.025);
      if(spot) {
        const dieHalf=.012;
        const die=new THREE.Mesh(new RoundedBoxGeometry(.024,.024,.024,2,.003),
          new THREE.MeshStandardNodeMaterial({color:'#c94f3d',roughness:.35}));
        die.rotation.y=spot.rotY;addMesh(die,spot.x,dieHalf,spot.z,spot.rotY);
        const pipBase=new THREE.SphereGeometry(.0022,8,6);
        const pipGeos:THREE.BufferGeometry[]=[];
        const facePips=(n:THREE.Vector3,u:THREE.Vector3,w:THREE.Vector3,value:number)=>{
          const o=.0062;
          const layouts:Record<number,[number,number][]>={
            1:[[0,0]],2:[[-1,-1],[1,1]],3:[[-1,-1],[0,0],[1,1]],
            4:[[-1,-1],[1,-1],[-1,1],[1,1]],5:[[-1,-1],[1,-1],[0,0],[-1,1],[1,1]],
            6:[[-1,-1],[1,-1],[-1,0],[1,0],[-1,1],[1,1]],
          };
          for(const [a,b] of layouts[value]) {
            const pip=pipBase.clone();
            pip.translate(
              n.x*(dieHalf-.0016)+u.x*a*o+w.x*b*o,
              n.y*(dieHalf-.0016)+u.y*a*o+w.y*b*o,
              n.z*(dieHalf-.0016)+u.z*a*o+w.z*b*o);
            pipGeos.push(pip);
          }
        };
        const X=new THREE.Vector3(1,0,0),Y=new THREE.Vector3(0,1,0),Z=new THREE.Vector3(0,0,1);
        facePips(Y,X,Z,1);facePips(Y.clone().negate(),X,Z,6);
        facePips(Z,X,Y,2);facePips(Z.clone().negate(),X,Y,5);
        facePips(X,Z,Y,3);facePips(X.clone().negate(),Z,Y,4);
        const pips=new THREE.Mesh(mergeGeometries(pipGeos),
          new THREE.MeshStandardNodeMaterial({color:'#f3ead8',roughness:.5}));
        pipGeos.forEach(g=>g.dispose());
        pips.rotation.y=spot.rotY;addMesh(pips,spot.x,dieHalf,spot.z,spot.rotY);
        addCollisionBox(spot.x,dieHalf,spot.z,dieHalf,dieHalf,dieHalf,spot.rotY);
      }
    }

    // Tier B: two standing dominoes (tile + divider bar each).
    const dominoTile=new RoundedBoxGeometry(.02,.04,.008,2,.0015);
    const dominoBar=new THREE.BoxGeometry(.016,.0012,.0088);
    const dominoIvory=new THREE.MeshStandardNodeMaterial({color:'#efe6d2',roughness:.4});
    const dominoInk=new THREE.MeshStandardNodeMaterial({color:'#3a3a3e',roughness:.6});
    for(let i=0;i<2;i++) {
      const spot=scatter(.025);
      if(!spot)continue;
      const tile=new THREE.Mesh(dominoTile,dominoIvory);
      addMesh(tile,spot.x,.02,spot.z,spot.rotY);
      const bar=new THREE.Mesh(dominoBar,dominoInk);
      addMesh(bar,spot.x,.021,spot.z,spot.rotY);
      addCollisionBox(spot.x,.02,spot.z,.010,.020,.004,spot.rotY);
    }

    // Tier B: a short stack of three books (one box for the whole stack).
    {
      const spot=scatter(.06);
      if(spot) {
        const sizes:[number,number,number][]=[[.095,.013,.068],[.088,.012,.062],[.080,.011,.056]];
        const covers=['#a4553a','#7d8b6f','#5b6b7a'].map(color=>
          new THREE.MeshStandardNodeMaterial({color,roughness:.7}));
        const pages=new THREE.MeshStandardNodeMaterial({color:'#ece1c8',roughness:.9});
        let y=0,top=0;
        sizes.forEach(([w,h,d],i)=>{
          const yaw=spot.rotY+(i-1)*.18;
          const cover=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,2,.0015),covers[i]);
          cover.rotation.y=yaw;cover.position.set(spot.x,y+h/2,spot.z);
          cover.castShadow=true;cover.receiveShadow=true;this.group.add(cover);
          const pageBlock=new THREE.Mesh(new THREE.BoxGeometry(w-.008,h-.004,d-.006),pages);
          pageBlock.rotation.y=yaw;pageBlock.position.set(spot.x+Math.cos(yaw)*.004,y+h/2,spot.z-Math.sin(yaw)*.004);
          pageBlock.castShadow=true;pageBlock.receiveShadow=true;this.group.add(pageBlock);
          y+=h;top=y;
        });
        // Covers the fanned corners of the yawed covers (up to .18 rad).
        addCollisionBox(spot.x,top/2,spot.z,.053,top/2,.042,spot.rotY);
      }
    }

    // Tier A: a hex pencil lying flat (no collision).
    {
      const spot=scatter(.05);
      if(spot) {
        const yaw=new THREE.Group();yaw.position.set(spot.x,0,spot.z);yaw.rotation.y=spot.rotY;
        const painted=new THREE.MeshStandardNodeMaterial({color:'#d9873b',roughness:.5});
        const pine=new THREE.MeshStandardNodeMaterial({color:'#e3c893',roughness:.7});
        const graphite=new THREE.MeshStandardNodeMaterial({color:'#3a3a3e',roughness:.4});
        const brass=new THREE.MeshStandardNodeMaterial({color:'#b48d4e',metalness:.72,roughness:.3});
        const eraser=new THREE.MeshStandardNodeMaterial({color:'#c98a8a',roughness:.8});
        const parts:[THREE.BufferGeometry,THREE.Material,number,number][]=[
          [new THREE.CylinderGeometry(.0035,.0035,.09,6),painted,0,0],
          [new THREE.CylinderGeometry(.0037,.0037,.008,12),brass,-.048,0],
          [new THREE.CylinderGeometry(.0035,.0035,.007,12),eraser,-.055,0],
        ];
        for(const [geo,mat,px,py] of parts) {
          const mesh=new THREE.Mesh(geo,mat);
          mesh.rotation.z=Math.PI/2;mesh.position.set(px,.0035+py,0);
          mesh.castShadow=true;mesh.receiveShadow=true;yaw.add(mesh);
        }
        const tip=new THREE.Mesh(new THREE.ConeGeometry(.0035,.012,6),pine);
        tip.rotation.z=-Math.PI/2;tip.position.set(.051,.0035,0);
        tip.castShadow=true;tip.receiveShadow=true;yaw.add(tip);
        const lead=new THREE.Mesh(new THREE.ConeGeometry(.0012,.004,8),graphite);
        lead.rotation.z=-Math.PI/2;lead.position.set(.058,.0035,0);
        lead.castShadow=true;lead.receiveShadow=true;yaw.add(lead);
        this.group.add(yaw);
      }
    }

    // Tier A: two shirt buttons with merged thread holes (no collision).
    {
      const buttonCols=['#e8e2d4','#7a8a99'];
      const holeBase=new THREE.CylinderGeometry(.0013,.0013,.0036,8);
      const holeMat=new THREE.MeshStandardNodeMaterial({color:'#4a4a4e',roughness:.8});
      buttonCols.forEach(color=>{
        const spot=scatter(.02);
        if(!spot)return;
        const base=new THREE.Mesh(new THREE.CylinderGeometry(.011,.011,.003,16),
          new THREE.MeshStandardNodeMaterial({color,roughness:.4}));
        addMesh(base,spot.x,.0015,spot.z,spot.rotY);
        const holes:[number,number][]=[[-.0035,-.0035],[.0035,-.0035],[-.0035,.0035],[.0035,.0035]];
        const holeGeos=holes.map(([hx,hz])=>{
          const g=holeBase.clone();
          // Rotate hole offsets by the button yaw so they stay on the cap.
          const c=Math.cos(spot.rotY),s=Math.sin(spot.rotY);
          g.translate(spot.x+c*hx+s*hz,.0015,spot.z-s*hx+c*hz);
          return g;
        });
        // Holes are baked in world space, so the merged mesh sits at the origin.
        const holeMesh=new THREE.Mesh(mergeGeometries(holeGeos),holeMat);
        holeMesh.castShadow=true;holeMesh.receiveShadow=true;this.group.add(holeMesh);
        holeGeos.forEach(g=>g.dispose());
      });
    }

    // Tier B + motion: a stylized rubber duck that rocks when the baby is near.
    {
      const spot=scatter(.04);
      if(spot) {
        const yellow=new THREE.MeshStandardNodeMaterial({color:'#e8b93c',roughness:.5});
        const orange=new THREE.MeshStandardNodeMaterial({color:'#d97b2f',roughness:.55});
        const dark=new THREE.MeshStandardNodeMaterial({color:'#2e2a26',roughness:.4});
        const yaw=new THREE.Group();yaw.position.set(spot.x,0,spot.z);yaw.rotation.y=spot.rotY;
        const rocker=new THREE.Group();yaw.add(rocker);
        const add=(mesh:THREE.Mesh)=>{
          mesh.castShadow=true;mesh.receiveShadow=true;rocker.add(mesh);return mesh;
        };
        const bodyM=new THREE.Mesh(new THREE.SphereGeometry(.02,20,14),yellow);
        bodyM.scale.set(1.15,.8,.9);bodyM.position.y=.016;add(bodyM);
        const head=new THREE.Mesh(new THREE.SphereGeometry(.012,16,12),yellow);
        head.position.set(.018,.038,0);add(head);
        const beak=new THREE.Mesh(new THREE.ConeGeometry(.005,.012,10),orange);
        beak.rotation.z=-Math.PI/2;beak.scale.z=.7;beak.position.set(.032,.036,0);add(beak);
        const tail=new THREE.Mesh(new THREE.ConeGeometry(.007,.016,8),yellow);
        tail.rotation.z=.9;tail.position.set(-.024,.024,0);add(tail);
        for(const side of [-1,1]) {
          const eye=new THREE.Mesh(new THREE.SphereGeometry(.0018,8,6),dark);
          eye.position.set(.024,.042,side*.008);add(eye);
        }
        this.group.add(yaw);
        this.duck={rocker,x:spot.x,z:spot.z,rotY:spot.rotY};
        // Padded a touch beyond the static pose so the gentle rock stays inside.
        addCollisionBox(spot.x,.022,spot.z,.028,.023,.021,spot.rotY);
        this.duckBox=this.boxes[this.boxes.length-1];
      }
    }

    // Tier B + motion: a spinning top that whirs up when the baby approaches.
    {
      const spot=scatter(.03);
      if(spot) {
        const red=new THREE.MeshStandardNodeMaterial({color:'#b8433a',roughness:.4});
        const cream=new THREE.MeshStandardNodeMaterial({color:'#efe3cb',roughness:.5});
        const yaw=new THREE.Group();yaw.position.set(spot.x,0,spot.z);yaw.rotation.y=spot.rotY;
        const lean=new THREE.Group();yaw.add(lean);
        const spinner=new THREE.Group();lean.add(spinner);
        const profile:[number,number][]=[[.001,0],[.013,.002],[.015,.007],[.009,.014],[.004,.018]];
        const bulb=new THREE.Mesh(
          new THREE.LatheGeometry(profile.map(([x,y])=>new THREE.Vector2(x,y)),22),red);
        bulb.castShadow=true;bulb.receiveShadow=true;spinner.add(bulb);
        const stem=new THREE.Mesh(new THREE.CylinderGeometry(.0025,.0025,.02,10),cream);
        stem.position.y=.028;stem.castShadow=true;stem.receiveShadow=true;spinner.add(stem);
        const knob=new THREE.Mesh(new THREE.SphereGeometry(.0042,12,10),cream);
        knob.position.y=.04;knob.castShadow=true;knob.receiveShadow=true;spinner.add(knob);
        this.group.add(yaw);
        this.top={lean,spinner,x:spot.x,z:spot.z};
        // Axisymmetric, so the static box stays valid while it spins.
        addCollisionBox(spot.x,.021,spot.z,.016,.021,.016);
      }
    }

    this.envelope.makeEmpty();
    this.envelope.expandByPoint(new THREE.Vector3(MIN_X,0,MIN_Z));
    this.envelope.expandByPoint(new THREE.Vector3(MAX_X,.06,MAX_Z));
    // Tighten to actual placements while keeping a contact pad for shadows.
    const tight=new THREE.Box3();tight.makeEmpty();
    this.group.traverse(object=>{
      if(object instanceof THREE.Mesh) {
        const p=new THREE.Vector3();object.getWorldPosition(p);
        tight.expandByPoint(p);
      }
    });
    if(!tight.isEmpty()) {
      tight.expandByScalar(.03);tight.min.y=0;tight.max.y=Math.max(.04,tight.max.y);
      this.envelope.copy(tight);
    }
  }
  dispose() {
    const geometries=new Set<THREE.BufferGeometry>();
    const materials=new Set<THREE.Material>();
    this.group.traverse(object=>{
      if(object instanceof THREE.Mesh) {
        geometries.add(object.geometry as THREE.BufferGeometry);
        const mat=object.material as THREE.Material|THREE.Material[];
        if(Array.isArray(mat))mat.forEach(m=>materials.add(m));
        else materials.add(mat);
      }
    });
    geometries.forEach(g=>g.dispose());
    materials.forEach(m=>m.dispose());
    this.group.removeFromParent();this.boxes.length=0;
  }
}
