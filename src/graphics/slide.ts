import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CollisionBox } from '../physics/facility-collision.ts';
import { makeSwingWoodMaterial } from './wood-material.ts';
import { SLIDE } from '../game/slide-physics.ts';

/** Timber slide: ladder up the back, platform, and a teal chute running south. */
export class Slide {
  readonly group=new THREE.Group();
  readonly boxes:CollisionBox[]=[];
  private readonly disposables:{dispose():void}[]=[];
  constructor() {
    const wood=makeSwingWoodMaterial();
    const chute=new THREE.MeshStandardNodeMaterial({color:'#3f7d7a',roughness:.5});
    this.disposables.push(wood,chute);
    const drop=SLIDE.topY-SLIDE.exitY,run=SLIDE.exitZ-SLIDE.topZ;
    const chuteLen=Math.hypot(drop,run)+.05;
    const pitch=Math.atan2(drop,run);
    const midY=(SLIDE.topY+SLIDE.exitY)/2,midZ=(SLIDE.topZ+SLIDE.exitZ)/2;
    const add=(mesh:THREE.Mesh)=>{
      mesh.castShadow=true;mesh.receiveShadow=true;this.group.add(mesh);return mesh;
    };
    const box=(geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number)=>{
      this.disposables.push(geometry);
      const mesh=new THREE.Mesh(geometry,material);
      mesh.position.set(x,y,z);return add(mesh);
    };
    // Chute bed plus raised side rails, pitched along the run.
    const bed=box(new RoundedBoxGeometry(.07,.012,chuteLen,2,.004),chute,SLIDE.x,midY-.006,midZ);
    bed.rotation.x=pitch;
    for(const side of [-1,1]) {
      const rail=box(new RoundedBoxGeometry(.008,.032,chuteLen,2,.003),wood,SLIDE.x+side*.039,midY+.008,midZ);
      rail.rotation.x=pitch;
    }
    // Platform with a back rail to lean on while perched.
    box(new RoundedBoxGeometry(.10,.014,.10,2,.004),wood,SLIDE.x,SLIDE.topY-.007,SLIDE.topZ);
    box(new RoundedBoxGeometry(.10,.03,.012,2,.003),wood,SLIDE.x,SLIDE.topY+.015,SLIDE.topZ-.048);
    // Legs under the platform and mid-chute.
    for(const [lx,lz] of [[-.042,SLIDE.topZ-.04],[.042,SLIDE.topZ-.04],[-.042,SLIDE.topZ+.04],[.042,SLIDE.topZ+.04]] as const) {
      box(new THREE.BoxGeometry(.012,SLIDE.topY,.012),wood,SLIDE.x+lx,SLIDE.topY/2,lz);
    }
    // Ladder up the back: two rails and four rungs.
    for(const side of [-1,1]) {
      box(new THREE.BoxGeometry(.01,SLIDE.topY,.01),wood,SLIDE.x+side*.03,SLIDE.topY/2,SLIDE.ladderZ);
    }
    for(let i=0;i<4;i++) {
      const rung=new THREE.Mesh(new THREE.CylinderGeometry(.005,.005,.06,10),wood);
      this.disposables.push(rung.geometry);
      rung.rotation.z=Math.PI/2;
      rung.position.set(SLIDE.x,.02+i*.022,SLIDE.ladderZ);
      add(rung);
    }
    // Idle collision: platform, stepped chute approximation, ladder base.
    const axis=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
    this.boxes.push(
      {center:axis(SLIDE.x,SLIDE.topY/2,SLIDE.topZ),halfSize:axis(.05,SLIDE.topY/2,.05),
        xAxis:axis(1,0,0),yAxis:axis(0,1,0),zAxis:axis(0,0,1)},
      {center:axis(SLIDE.x,(SLIDE.topY+midY)/2-.01,(SLIDE.topZ+midZ)/2),halfSize:axis(.035,(SLIDE.topY-midY)/2+.03,(midZ-SLIDE.topZ)/2),
        xAxis:axis(1,0,0),yAxis:axis(0,1,0),zAxis:axis(0,0,1)},
      {center:axis(SLIDE.x,midY/2,midZ),halfSize:axis(.035,midY/2+.01,(SLIDE.exitZ-midZ)/2),
        xAxis:axis(1,0,0),yAxis:axis(0,1,0),zAxis:axis(0,0,1)},
      {center:axis(SLIDE.x,SLIDE.topY/2,SLIDE.ladderZ),halfSize:axis(.035,SLIDE.topY/2,.012),
        xAxis:axis(1,0,0),yAxis:axis(0,1,0),zAxis:axis(0,0,1)},
    );
  }
  dispose() {
    this.group.removeFromParent();
    for(const disposable of this.disposables)disposable.dispose();
  }
}
