import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three/webgpu';
import { buildCage } from './model-cage.mjs';
import { buildOpticalModel } from './optical-model.mjs';

// Genuine character solids in the reference file's unit space (floor at
// y=-1.04, ~2.5 units tall like the jelly). Same Gaussian-metaball language as
// refs/jelly_baby_mesh.html so parts fuse with soft transitions instead of
// visibly intersecting primitives.
const CHARACTER_SDFS={
bear:`
function jellySDF(p) {
  let f = 0.0;
  // Torso and belly paunch.
  f += blobEllipsoid(p, V( 0.00, -0.10, 0.00), V(0.68, 0.78, 0.60), 1.15, 1.60);
  f += blobEllipsoid(p, V( 0.00, -0.38, 0.12), V(0.52, 0.48, 0.48), 0.65, 1.70);
  // Round head with full cheeks so the face has room to land.
  f += blobEllipsoid(p, V( 0.00,  0.78, 0.00), V(0.54, 0.48, 0.54), 1.00, 1.60);
  f += blobEllipsoid(p, V(-0.24,  0.42, 0.05), V(0.40, 0.34, 0.34), 0.80, 1.70);
  f += blobEllipsoid(p, V( 0.24,  0.42, 0.05), V(0.40, 0.34, 0.34), 0.80, 1.70);
  // Round ears.
  f += blobEllipsoid(p, V(-0.40,  1.08, -0.02), V(0.21, 0.21, 0.19), 0.60, 1.80);
  f += blobEllipsoid(p, V( 0.40,  1.08, -0.02), V(0.21, 0.21, 0.19), 0.60, 1.80);
  // Muzzle.
  f += blobEllipsoid(p, V( 0.00,  0.64, 0.42), V(0.26, 0.20, 0.22), 0.65, 1.80);
  // Arm stubs melting into the torso, with rounded paws.
  f += blobEllipsoid(p, V(-0.80, -0.05, 0.02), V(0.26, 0.48, 0.28), 0.80, 1.75);
  f += blobEllipsoid(p, V( 0.80, -0.05, 0.02), V(0.26, 0.48, 0.28), 0.80, 1.75);
  f += blobEllipsoid(p, V(-0.84, -0.48, 0.06), V(0.21, 0.21, 0.21), 0.45, 1.90);
  f += blobEllipsoid(p, V( 0.84, -0.48, 0.06), V(0.21, 0.21, 0.21), 0.45, 1.90);
  // Leg stubs, spaced for a cleft between them.
  f += blobEllipsoid(p, V(-0.34, -0.76, 0.05), V(0.30, 0.34, 0.32), 0.80, 1.80);
  f += blobEllipsoid(p, V( 0.34, -0.76, 0.05), V(0.30, 0.34, 0.32), 0.80, 1.80);
  let d = 0.42 - f;
  const bottomPlane = -1.04 - p.y;
  d = smoothIntersection(d, bottomPlane, 0.045);
  return d;
}
`,
cat:`
function jellySDF(p) {
  let f = 0.0;
  // Sleek upright torso and chest, with a groin filler so the leg groove
  // stays shallow enough for the coarse optical proxy to follow it.
  f += blobEllipsoid(p, V( 0.00, -0.05, 0.00), V(0.52, 0.80, 0.46), 1.00, 1.60);
  f += blobEllipsoid(p, V( 0.00,  0.35, 0.08), V(0.42, 0.45, 0.40), 0.60, 1.70);
  f += blobEllipsoid(p, V( 0.00, -0.34, 0.05), V(0.34, 0.34, 0.30), 0.60, 1.70);
  // Round head with cheeks for the whisker span.
  f += blobEllipsoid(p, V( 0.00,  0.85, 0.02), V(0.44, 0.40, 0.42), 0.95, 1.60);
  f += blobEllipsoid(p, V(-0.20,  0.55, 0.05), V(0.34, 0.30, 0.30), 0.70, 1.70);
  f += blobEllipsoid(p, V( 0.20,  0.55, 0.05), V(0.34, 0.30, 0.30), 0.70, 1.70);
  // Pointed ears: a base blob plus an outward-leaning tip.
  f += blobEllipsoid(p, V(-0.30,  1.12, 0.00), V(0.20, 0.22, 0.18), 0.55, 1.80);
  f += blobEllipsoid(p, V( 0.30,  1.12, 0.00), V(0.20, 0.22, 0.18), 0.55, 1.80);
  f += blobEllipsoid(p, V(-0.40,  1.32, 0.00), V(0.13, 0.17, 0.13), 0.50, 1.90);
  f += blobEllipsoid(p, V( 0.40,  1.32, 0.00), V(0.13, 0.17, 0.13), 0.50, 1.90);
  // Small muzzle and nose bump.
  f += blobEllipsoid(p, V( 0.00,  0.74, 0.34), V(0.20, 0.14, 0.16), 0.50, 1.80);
  f += blobEllipsoid(p, V( 0.00,  0.78, 0.44), V(0.07, 0.06, 0.06), 0.40, 1.90);
  // Slim arms with paws.
  f += blobEllipsoid(p, V(-0.60, -0.10, 0.02), V(0.16, 0.42, 0.18), 0.70, 1.75);
  f += blobEllipsoid(p, V( 0.60, -0.10, 0.02), V(0.16, 0.42, 0.18), 0.70, 1.75);
  f += blobEllipsoid(p, V(-0.62, -0.50, 0.05), V(0.15, 0.15, 0.15), 0.40, 1.90);
  f += blobEllipsoid(p, V( 0.62, -0.50, 0.05), V(0.15, 0.15, 0.15), 0.40, 1.90);
  // Haunches.
  f += blobEllipsoid(p, V(-0.30, -0.72, 0.02), V(0.28, 0.34, 0.30), 0.75, 1.80);
  f += blobEllipsoid(p, V( 0.30, -0.72, 0.02), V(0.28, 0.34, 0.30), 0.75, 1.80);
  // Tail curling up behind the back. Blobs overlap generously so the coarse
  // optical grid sees one continuous tail rather than isolated beads.
  f += blobEllipsoid(p, V( 0.00, -0.55, -0.40), V(0.20, 0.20, 0.20), 0.60, 1.90);
  f += blobEllipsoid(p, V( 0.00, -0.32, -0.50), V(0.195, 0.195, 0.195), 0.60, 1.90);
  f += blobEllipsoid(p, V( 0.00, -0.09, -0.55), V(0.19, 0.19, 0.19), 0.60, 1.90);
  f += blobEllipsoid(p, V( 0.00,  0.12, -0.53), V(0.185, 0.185, 0.185), 0.60, 1.90);
  let d = 0.42 - f;
  const bottomPlane = -1.04 - p.y;
  d = smoothIntersection(d, bottomPlane, 0.045);
  return d;
}
`,
bunny:`
function jellySDF(p) {
  let f = 0.0;
  // Slim torso and belly.
  f += blobEllipsoid(p, V( 0.00, -0.10, 0.00), V(0.48, 0.75, 0.44), 1.00, 1.60);
  f += blobEllipsoid(p, V( 0.00, -0.40, 0.10), V(0.40, 0.42, 0.40), 0.55, 1.70);
  // Big round head with cheeks for the face.
  f += blobEllipsoid(p, V( 0.00,  0.62, 0.02), V(0.48, 0.44, 0.46), 0.95, 1.60);
  f += blobEllipsoid(p, V(-0.20,  0.35, 0.05), V(0.34, 0.30, 0.30), 0.65, 1.70);
  f += blobEllipsoid(p, V( 0.20,  0.35, 0.05), V(0.34, 0.30, 0.30), 0.65, 1.70);
  // Long ears reaching for the top of the grid.
  f += blobEllipsoid(p, V(-0.16,  1.02, 0.00), V(0.13, 0.34, 0.13), 0.55, 1.80);
  f += blobEllipsoid(p, V( 0.16,  1.02, 0.00), V(0.13, 0.34, 0.13), 0.55, 1.80);
  f += blobEllipsoid(p, V(-0.18,  1.26, 0.00), V(0.095, 0.15, 0.095), 0.45, 1.90);
  f += blobEllipsoid(p, V( 0.18,  1.26, 0.00), V(0.095, 0.15, 0.095), 0.45, 1.90);
  // Small arms.
  f += blobEllipsoid(p, V(-0.52, -0.15, 0.05), V(0.15, 0.35, 0.16), 0.60, 1.75);
  f += blobEllipsoid(p, V( 0.52, -0.15, 0.05), V(0.15, 0.35, 0.16), 0.60, 1.75);
  // Long hind feet pointing forward, set wide for balance, over haunches,
  // with heel nubs behind so the tail-side mass cannot tip it backward.
  f += blobEllipsoid(p, V(-0.30, -0.82, 0.18), V(0.24, 0.18, 0.36), 0.60, 1.80);
  f += blobEllipsoid(p, V( 0.30, -0.82, 0.18), V(0.24, 0.18, 0.36), 0.60, 1.80);
  f += blobEllipsoid(p, V(-0.26, -0.85, -0.12), V(0.18, 0.15, 0.20), 0.50, 1.90);
  f += blobEllipsoid(p, V( 0.26, -0.85, -0.12), V(0.18, 0.15, 0.20), 0.50, 1.90);
  f += blobEllipsoid(p, V(-0.28, -0.55, 0.00), V(0.24, 0.30, 0.26), 0.60, 1.70);
  f += blobEllipsoid(p, V( 0.28, -0.55, 0.00), V(0.24, 0.30, 0.26), 0.60, 1.70);
  // Cotton puff tail, tucked close so it cannot lever the body over.
  f += blobEllipsoid(p, V( 0.00, -0.30, -0.36), V(0.17, 0.17, 0.17), 0.50, 1.90);
  let d = 0.42 - f;
  const bottomPlane = -1.04 - p.y;
  d = smoothIntersection(d, bottomPlane, 0.045);
  return d;
}
`,
};

const CHARACTER_FILES={bear:'gummy-bear',cat:'jelly-cat',bunny:'jelly-bunny'};
const INSIDE_POINT={bear:[0,.7,0],cat:[0,.8,0],bunny:[0,.6,0]};

const source=readFileSync('refs/jelly_baby_mesh.html','utf8');
const htmlSlice=source.slice(source.indexOf('const V ='),source.indexOf('// Minimal WebGPU viewer'));

export function characterDefinitions(character) {
  const begin=htmlSlice.indexOf('const V =');
  const sdfAt=htmlSlice.indexOf('function jellySDF(p)');
  const polyAt=htmlSlice.indexOf('// Marching tetrahedra polygonizer');
  if(begin<0||sdfAt<0||polyAt<0||polyAt<=sdfAt)throw new Error('Reference mesh markers changed');
  const head=htmlSlice.slice(begin,sdfAt);
  const tail=htmlSlice.slice(htmlSlice.indexOf('// ---',polyAt)>polyAt?htmlSlice.indexOf('// ---',polyAt):polyAt);
  const definitions=head+CHARACTER_SDFS[character]+'\n'+tail;
  if(!definitions.includes('const NX = 104, NY = 96, NZ = 88;'))throw new Error('Reference polygonizer dimensions changed');
  return {head,definitions};
}

export function buildCharacterModel(character) {
  const filename=CHARACTER_FILES[character];
  if(!filename)throw new Error(`Unknown character: ${character}`);
  const {head,definitions}=characterDefinitions(character);
  const sdf=new Function('THREE',head+CHARACTER_SDFS[character]+'\nreturn jellySDF;')(THREE);
  const inside=INSIDE_POINT[character];
  if(!(sdf(new THREE.Vector3(...inside))<0&&sdf(new THREE.Vector3(3,3,3))>0))throw new Error(`${character} SDF sign convention broken`);
  const model=new Function('THREE',definitions+'\nreturn {buildJellyGeometry,jellySDF};')(THREE);
  const raw=model.buildJellyGeometry();
  const scale=.07/(raw.boundingBox.max.y-raw.boundingBox.min.y);
  const bottom=raw.boundingBox.min.y;
  raw.translate(0,-bottom,0);raw.scale(scale,scale,scale);
  const p=raw.attributes.position.array,n=raw.attributes.normal.array;
  const positions=[],normals=[],indices=[],vertices=new Map();
  for(let i=0;i<p.length;i+=3) {
    const key=`${p[i]},${p[i+1]},${p[i+2]}`;
    let id=vertices.get(key);
    if(id===undefined){id=positions.length/3;vertices.set(key,id);positions.push(p[i],p[i+1],p[i+2]);normals.push(n[i],n[i+1],n[i+2]);}
    indices.push(id);
  }
  let signedVolume=0;
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    signedVolume+=(positions[a]*(positions[b+1]*positions[c+2]-positions[b+2]*positions[c+1])+
      positions[a+1]*(positions[b+2]*positions[c]-positions[b]*positions[c+2])+
      positions[a+2]*(positions[b]*positions[c+1]-positions[b+1]*positions[c]))/6;
  }
  const edges=new Map();
  for(let i=0;i<indices.length;i+=3)for(let k=0;k<3;k++){
    const a=indices[i+k],b=indices[i+(k+1)%3],key=`${Math.min(a,b)},${Math.max(a,b)}`;
    edges.set(key,(edges.get(key)||0)+1);
  }
  console.log({character,vertices:positions.length/3,triangles:indices.length/3,scale,volume:signedVolume,badEdges:[...edges.values()].filter(v=>v!==2).length});
  mkdirSync('src/assets/model',{recursive:true});
  const arrays={positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(indices),
    ...buildCage(positions,scale,bottom,sdf,signedVolume)};
  Object.assign(arrays,buildOpticalModel(definitions,scale,bottom,arrays));
  const chunks=[],layout={};let offset=0;
  for(const [name,array] of Object.entries(arrays)){
    const padding=(8-offset%8)%8;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding;}
    layout[name]={offset,length:array.length,type:array.constructor.name};chunks.push(Buffer.from(array.buffer));offset+=array.byteLength;
  }
  writeFileSync(`src/assets/model/${filename}.bin`,Buffer.concat(chunks));
  writeFileSync(`src/assets/model/${filename}.json`,JSON.stringify({sourceHash:createHash('sha256').update(definitions).digest('hex'),scale,bottom,volume:signedVolume,layout},null,2));
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href) {
  const character=process.argv[2]??'bear';
  buildCharacterModel(character);
}
