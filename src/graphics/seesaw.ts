import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CollisionBox } from '../physics/facility-collision.ts';
import { makeSwingWoodMaterial } from './wood-material.ts';
import { SEESAW } from '../game/seesaw-physics.ts';

/** Timber seesaw: a post, a rocking plank with two seats, and grab handles. */
export class Seesaw {
  readonly group=new THREE.Group();
  private readonly rocker=new THREE.Group();
  readonly boxes:CollisionBox[]=[];
  private readonly disposables:{dispose():void}[]=[];
  constructor() {
    const wood=makeSwingWoodMaterial();
    const seat=new THREE.MeshStandardNodeMaterial({color:'#b3552f',roughness:.85});
    this.disposables.push(wood,seat);
    const add=(parent:THREE.Group,mesh:THREE.Mesh)=>{
      mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
    };
    const box=(parent:THREE.Group,geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number)=>{
      this.disposables.push(geometry);
      const mesh=new THREE.Mesh(geometry,material);
      mesh.position.set(x,y,z);return add(parent,mesh);
    };
    // Static base: post, crossbar feet and fulcrum caps.
    box(this.group,new THREE.BoxGeometry(.02,SEESAW.pivot,.02),wood,SEESAW.x,SEESAW.pivot/2,SEESAW.z);
    box(this.group,new THREE.BoxGeometry(.10,.012,.03),wood,SEESAW.x,.006,SEESAW.z);
    box(this.group,new THREE.BoxGeometry(.024,.012,.05),wood,SEESAW.x,SEESAW.pivot-.004,SEESAW.z);
    // Rocker pivots about the plank axis; children are plank-local.
    this.rocker.position.set(SEESAW.x,SEESAW.pivot,SEESAW.z);
    this.group.add(this.rocker);
    box(this.rocker,new RoundedBoxGeometry(SEESAW.width,.012,SEESAW.halfLength*2,2,.004),wood,0,.006,0);
    for(const side of [-1,1]) {
      box(this.rocker,new RoundedBoxGeometry(.034,.01,.03,2,.004),seat,0,.014,side*SEESAW.seatOffset);
      const handle=new THREE.Mesh(new THREE.CylinderGeometry(.004,.004,.03,10),wood);
      this.disposables.push(handle.geometry);
      handle.position.set(0,.03,side*(SEESAW.seatOffset-.022));
      add(this.rocker,handle);
    }
    // Idle collision follows the level plank; the rocker never collides mid-ride.
    const axis=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
    this.boxes.push({
      center:axis(SEESAW.x,SEESAW.pivot+.006,SEESAW.z),
      halfSize:axis(SEESAW.width/2,.012,SEESAW.halfLength),
      xAxis:axis(1,0,0),yAxis:axis(0,1,0),zAxis:axis(0,0,1),
    });
  }
  update(angle:number) {
    // Physics rotates local (y,z) to (c*y+s*z, -s*y+c*z): a rotation.x of -angle.
    this.rocker.rotation.x=-angle;
  }
  dispose() {
    this.group.removeFromParent();
    for(const disposable of this.disposables)disposable.dispose();
  }
}
