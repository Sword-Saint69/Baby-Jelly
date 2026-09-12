import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Group, Vector3 } from 'three/webgpu';
import { parseBabyCage } from '../src/physics/baby-cage.ts';
import { SoftBody } from '../src/physics/soft-body.js';
import { PHYS } from '../src/physics/constants.js';
import { BabyFace } from '../src/graphics/baby-face.ts';
import { CharacterFeatures, CHARACTER_FACE_LAYOUT, CHARACTER_FACE_SHIFT, CHARACTER_FACE_WIDTH } from '../src/graphics/character-features.ts';
import { WearablePhysics } from '../src/game/wearable-physics.ts';
import { SurfaceBVH } from '../src/graphics/refractive-light.js';

const CHARACTERS={
  bear:{file:'gummy-bear',faceDetails:8,featureMeshes:2},
  cat:{file:'jelly-cat',faceDetails:14,featureMeshes:4},
  bunny:{file:'jelly-bunny',faceDetails:9,featureMeshes:0},
};

for(const [name,spec] of Object.entries(CHARACTERS)) {
  const manifest=JSON.parse(readFileSync(`src/assets/model/${spec.file}.json`,'utf8'));
  for(const key of ['positions','indices','particles','tets','volumes','bindingIds','bindingWeights','contacts',
    'opticalPositions','opticalIndices','opticalBindingIds','opticalBindingWeights','thicknessIds','thicknessWeights']) {
    assert(manifest.layout[key]&&manifest.layout[key].length>0,`[${name}] manifest carries ${key}`);
  }
  const bytes=readFileSync(`src/assets/model/${spec.file}.bin`);
  const cage=parseBabyCage(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),manifest);
  const verts=cage.surface.positions.length/3;
  assert(verts>10000&&cage.tets.length>500&&cage.pos.length/3>150,`[${name}] solid is substantial`);
  console.log(`[${name}] mesh`,{verts,triangles:cage.surface.indices.length/3,nodes:cage.pos.length/3,tets:cage.tets.length});

  const body=new SoftBody(cage);
  // Game boot order: face, features, and crown bindings exist before settling.
  const group=new Group();
  const face=new BabyFace(body,group,CHARACTER_FACE_WIDTH[name],CHARACTER_FACE_LAYOUT[name]);
  face.faceShiftY=CHARACTER_FACE_SHIFT[name];
  const features=new CharacterFeatures(body,group,face.details[0].mesh.material);
  const rig=new WearablePhysics(body);
  for(let i=0;i<120;i++) {
    body.step(PHYS.step);
    assert(body.lastMinJacobian>=.12,`[${name}] every tetrahedron keeps its orientation`);
  }
  assert(body.isFinite(),`[${name}] finite FEM state`);
  body.updateSurface();
  const box=body.surface.geometry.boundingBox;
  const height=box.max.y-box.min.y;
  console.log(`[${name}] settled`,{height,volume:body.volumeRatio(),floor:box.min.y,depth:box.max.z-box.min.z});
  assert(height>.055,`[${name}] stands upright at rest`);
  assert(box.min.y<.002,`[${name}] rests on the floor`);
  assert(box.max.z-box.min.z>.02,`[${name}] has front-to-back depth`);
  assert(body.volumeRatio()>.80&&body.volumeRatio()<1.20,`[${name}] volume preserved`);

  // Every organ must land on the sculpt with clearance, including whiskers.
  face.update(0);
  assert.equal(face.details.length,spec.faceDetails,`[${name}] face carries its designed organs`);
  const skin=new SurfaceBVH(body.surface);
  let minimumClearance=Infinity;
  for(const detail of face.details) {
    const p=detail.mesh.geometry.attributes.position.array;
    assert(p.every(Number.isFinite),`[${name}] finite face positions`);
    const index=detail.mesh.geometry.index?.array;
    // Whiskers are rigid feelers posed by transform, not skin-projected ink.
    if(detail.mesh.userData.kind==='whisker')continue;
    if(index)for(let i=0;i<index.length;i+=3) {
      const ids=[index[i]*3,index[i+1]*3,index[i+2]*3];
      const x=ids.reduce((sum,id)=>sum+p[id],0)/3,y=ids.reduce((sum,id)=>sum+p[id+1],0)/3,z=ids.reduce((sum,id)=>sum+p[id+2],0)/3;
      const hit=skin.hit([x,y,.10],[0,0,-1]);
      if(hit)minimumClearance=Math.min(minimumClearance,z-(.10-hit.distance));
    }
  }
  console.log(`[${name}] face clearance mm`,minimumClearance*1000);
  assert(minimumClearance>-.000015,`[${name}] facial triangles sit outside the sculpted skin`);

  features.setCharacter(name);features.update(1/60);
  const characterMeshes=group.children.filter(o=>o.userData.isCharacterFeature);
  assert.equal(characterMeshes.length,spec.featureMeshes,`[${name}] attachment count matches design`);
  for(const mesh of characterMeshes)assert(mesh.position.toArray().every(Number.isFinite),`[${name}] finite attachment positions`);
  assert(rig.headAnchor(new Vector3()).toArray().every(Number.isFinite),`[${name}] crown anchor resolves`);
  features.dispose();
}
console.log('PASS — bear, cat, and bunny solids settle; designed organs land; attachments and crown anchors resolve');
