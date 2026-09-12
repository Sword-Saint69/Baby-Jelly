import * as THREE from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import { FaceSkin } from './face-skin.ts';

export const JELLY_CHARACTERS={
  jelly:{label:'Jelly Baby',blurb:'classic'},
  cat:{label:'Jelly Cat',blurb:'sculpted climber, ω mouth, whiskers'},
  bear:{label:'Gummy Bear',blurb:'sculpted body with ears, arms, legs'},
  bunny:{label:'Jelly Bunny',blurb:'sculpted long-ears, buck tooth'},
} as const;

export type JellyCharacterName=keyof typeof JELLY_CHARACTERS;
export const DEFAULT_JELLY_CHARACTER:JellyCharacterName='jelly';

/** Per-character resting-face lift applied inside BabyFace sampling. */
export const CHARACTER_FACE_SHIFT:Record<JellyCharacterName,number>={
  jelly:0,
  cat:.0012,
  bear:.007,
  bunny:.002,
};

/** Horizontal face proportion per head width (baked into BabyFace layout). */
export const CHARACTER_FACE_WIDTH:Record<JellyCharacterName,number>={
  jelly:1,
  cat:.9,
  bear:.8,
  bunny:.8,
};

/** Per-organ face design: each head gets eyes, brows, blush, and a mouth
 * built for its proportions instead of one shared layout. */
export interface FaceOrganLayout {
  eyeDX:number;eyeDY:number;eyeSX:number;eyeSY:number;
  browDX:number;browDY:number;browSlant:number;browThick:number;
  blushDX:number;blushDY:number;blushS:number;
  mouthDY:number;mouthS:number;mouthShape:'smile'|'omega';
  tooth:boolean;whiskers:boolean;
}

export const CHARACTER_FACE_LAYOUT:Record<JellyCharacterName,FaceOrganLayout>={
  jelly:{eyeDX:1,eyeDY:0,eyeSX:1,eyeSY:1,browDX:1,browDY:0,browSlant:0,browThick:1,
    blushDX:1,blushDY:0,blushS:1,mouthDY:0,mouthS:1,mouthShape:'smile',tooth:false,whiskers:false},
  cat:{eyeDX:1.05,eyeDY:.002,eyeSX:1.05,eyeSY:1.1,browDX:1,browDY:.001,browSlant:.3,browThick:1.1,
    blushDX:.9,blushDY:-.010,blushS:.8,mouthDY:.002,mouthS:.85,mouthShape:'omega',tooth:false,whiskers:true},
  bear:{eyeDX:1,eyeDY:0,eyeSX:.85,eyeSY:.9,browDX:1,browDY:0,browSlant:0,browThick:1.1,
    blushDX:1,blushDY:.002,blushS:.9,mouthDY:.006,mouthS:.75,mouthShape:'smile',tooth:false,whiskers:false},
  bunny:{eyeDX:1.0,eyeDY:0,eyeSX:1.1,eyeSY:1.15,browDX:1,browDY:-.004,browSlant:-.25,browThick:.9,
    blushDX:.95,blushDY:-.002,blushS:.8,mouthDY:0,mouthS:.8,mouthShape:'smile',tooth:true,whiskers:false},
};

type Anchored={mesh:THREE.Mesh;ax:number;ay:number;offset:number;tiltZ:number;phase:number};

/** Skin-attached ear tips and muzzle details that ride the same deformed
 * surface as the face. Each character body is its own sculpted solid; these
 * small volumes sample FaceSkin anchors every frame so grabs, jumps, and
 * facilities carry them along without extra physics. */
export class CharacterFeatures {
  private readonly body:SoftBody;
  private readonly group:THREE.Group;
  private readonly jellyMaterial:THREE.Material;
  private readonly skin:FaceSkin;
  private readonly sample=new Float64Array(6);
  private readonly innerMaterial=new THREE.MeshPhysicalNodeMaterial({color:'#f2a9b8',roughness:.5,clearcoat:.3});
  private readonly creamMaterial=new THREE.MeshPhysicalNodeMaterial({color:'#f6ecd4',roughness:.5,clearcoat:.25});
  private readonly darkMaterial=new THREE.MeshPhysicalNodeMaterial({color:'#2b3a12',roughness:.3,clearcoat:.6});
  private anchored:Anchored[]=[];
  private time=0;
  private character:JellyCharacterName=DEFAULT_JELLY_CHARACTER;

  constructor(body:SoftBody,group:THREE.Group,jellyMaterial:THREE.Material) {
    this.body=body;this.group=group;this.jellyMaterial=jellyMaterial;
    this.skin=new FaceSkin(body);
    this.setCharacter(DEFAULT_JELLY_CHARACTER);
  }

  get current() {return this.character;}

  setCharacter(name:JellyCharacterName) {
    this.character=name;
    for(const feature of this.anchored){this.group.remove(feature.mesh);feature.mesh.geometry.dispose();}
    this.anchored=[];
    if(name==='cat')this.buildCat();
    else if(name==='bear')this.buildBear();
  }

  private track(mesh:THREE.Mesh,ax:number,ay:number,offset:number,tiltZ=0,phase=0) {
    mesh.frustumCulled=false;
    mesh.userData.isCharacterFeature=true;
    // Volumes, not face ink: draw with the body pass.
    mesh.renderOrder=1;
    this.group.add(mesh);
    this.anchored.push({mesh,ax,ay,offset,tiltZ,phase});
  }

  private buildCat() {
    // Ear bases are sculpted; cone tips and pink inners ride on top of them.
    // The tail is sculpted into the solid, so no nub is needed.
    for(const sign of [-1,1]) {
      const ear=new THREE.Mesh(new THREE.ConeGeometry(.005,.010,12),this.jellyMaterial);
      this.track(ear,sign*.0105,.0675,.003,sign*-.22,sign*1.7);
      const inner=new THREE.Mesh(new THREE.ConeGeometry(.0025,.0055,10),this.innerMaterial);
      inner.scale.z=.5;
      this.track(inner,sign*.0105,.0665,.006,sign*-.22,sign*1.7+.4);
    }
  }

  private buildBear() {
    // Ears, arms, and legs are sculpted into the body solid. Only the muzzle
    // highlight and nose ride on top, anchored to the sculpted muzzle.
    const snout=new THREE.Mesh(new THREE.SphereGeometry(.007,20,14),this.creamMaterial);
    snout.scale.set(1.2,.8,.8);
    this.track(snout,0,.051,.004);
    const nose=new THREE.Mesh(new THREE.SphereGeometry(.0018,12,10),this.darkMaterial);
    this.track(nose,0,.054,.009);
  }

  update(dt:number) {
    this.time+=Math.min(.05,Math.max(0,dt));
    const wobble=this.body.grabs.length>0?.12:.04;
    for(const feature of this.anchored) {
      this.skin.sample(feature.ax,feature.ay,feature.offset,this.sample);
      feature.mesh.position.set(this.sample[0],this.sample[1],this.sample[2]);
      feature.mesh.rotation.set(0,0,feature.tiltZ+Math.sin(this.time*9+feature.phase)*wobble);
    }
  }

  dispose() {
    for(const feature of this.anchored){this.group.remove(feature.mesh);feature.mesh.geometry.dispose();}
    this.anchored=[];
    this.innerMaterial.dispose();this.creamMaterial.dispose();this.darkMaterial.dispose();
  }
}
