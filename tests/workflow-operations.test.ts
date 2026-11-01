import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supercellStructure, surfaceSlabStructure, slabOrientation } from '../lib/workflow-geometry.ts';
import { cellVolume, fractionalVectorToCartesian, cartesianToFractionalWithVectors } from '../lib/crystal-cell.ts';
import { minimumImageDelta, generateNebInput, sweepDrafts } from '../lib/workflow-operations.ts';
import { createDefaultQeDraft } from '../lib/qe-defaults.ts';
import { attachBandProjections } from '../lib/band-projections.ts';
import { createFigure, datasetFromText, transformedLayer, renderFigure } from '../lib/research-figures.ts';
import { exportNumericalDataset } from '../lib/dataset-export.ts';
import { analyzeMdFrame } from '../lib/md-analysis.ts';
import { connectWorkflow, workflowOrder, defaultWorkflowCanvas, workflowEdges, remapWorkflowComponents } from '../lib/dft-workflow.ts';
import type { MaterialContext } from '../components/JobComposer.tsx';
import type { CalculationComponentInstance } from '../components/CalculationPanel.tsx';
import type { CellVectors } from '../lib/crystal-cell.ts';
const cell:CellVectors=[[3,0,0],[.5,4,0],[.2,.6,5]];
const source={cellVectors:cell,atoms:[{id:'a',species:'Si',x:.1,y:.2,z:.1},{id:'b',species:'C',x:.5,y:.5,z:.5}],periodic:[true,true,true] as [boolean,boolean,boolean]};
const material:MaterialContext={...source,name:'fixture',formula:'SiC',databaseName:'fixture',species:['Si','C'],atomCount:2};
const draft=createDefaultQeDraft();
const node=(id:string,extra:Partial<CalculationComponentInstance>={}):CalculationComponentInstance=>({id,name:id,materialId:'m',structureSourceId:'original',calculation:'Total energy',selected:true,draft,...extra});
test('general integer supercell conserves volume, identities and source lattice equivalence',()=>{
  const matrix:CellVectors=[[2,1,0],[0,2,1],[0,0,2]],out=supercellStructure(source,matrix);
  assert.equal(out.atoms.length,16);assert.equal(new Set(out.atoms.map(a=>a.id)).size,16);assert.ok(Math.abs(cellVolume(out.cellVectors)/cellVolume(cell)-8)<1e-10);
  out.atoms.forEach((a,i)=>{const original=source.atoms[out.mapping[i].sourceIndex];const p=fractionalVectorToCartesian([a.x,a.y,a.z],out.cellVectors);const f=fractionalVectorToCartesian([original.x+out.mapping[i].translation[0],original.y+out.mapping[i].translation[1],original.z+out.mapping[i].translation[2]],cell);const shift=cartesianToFractionalWithVectors(p.map((x,a)=>x-f[a]) as [number,number,number],out.cellVectors);assert.ok(shift.every(x=>Math.abs(x-Math.round(x))<1e-8));});
  assert.throws(()=>supercellStructure(source,[[1,0,0],[1,0,0],[0,0,1]]),/nonsingular/);
  const open=supercellStructure({...source,periodic:[true,true,false],atoms:[{...source.atoms[0],z:1.2}]},[[2,0,0],[0,1,0],[0,0,1]]);assert.ok(open.atoms.every(a=>a.z===1.2));
  assert.throws(()=>supercellStructure(source,[[1.5,0,0],[0,1,0],[0,0,1]]),/integer/);
});
test('Miller orientation is primitive and slabs count atomic planes, retain termination/PBC/vacuum',()=>{
  for(const hkl of [[1,1,1],[-2,3,1],[0,0,-1],[12,11,-7]] as [number,number,number][]){assert.equal(Math.round(cellVolume(slabOrientation(hkl))),1);}
  const slab=surfaceSlabStructure(source,{kind:'surface_slab',miller:[0,0,1],layers:3,vacuumAngstrom:12,termination:1});
  assert.deepEqual(slab.periodic,[true,true,false]);assert.equal(slab.atoms.length,3);assert.deepEqual(slab.mapping.map(m=>m.sourceIndex),[1,0,1]);
  const zs=slab.atoms.map(a=>fractionalVectorToCartesian([a.x,a.y,a.z],slab.cellVectors)[2]);assert.ok(Math.abs(Math.min(...zs)-6)<1e-9);assert.ok(Math.abs(slab.cellVectors[2][2]-Math.max(...zs)-6)<1e-9);
  assert.throws(()=>surfaceSlabStructure({...source,periodic:[true,true,false]},{kind:'surface_slab',miller:[0,0,1],layers:2,vacuumAngstrom:12,termination:0}),/periodic/);
});
test('skew minimum-image NEB uses Cartesian nearest image and never wraps an open axis',()=>{
  const skew:CellVectors=[[10,0,0],[9,1,0],[0,0,10]],delta:[number,number,number]=[.49,.49,.9];
  const nearest=minimumImageDelta(delta,skew,[true,true,false]);assert.equal(nearest[2],.9);assert.ok(Math.hypot(...fractionalVectorToCartesian(nearest,skew))<Math.hypot(...fractionalVectorToCartesian(delta,skew)));
  const final={...material!,atoms:material!.atoms.map(a=>({...a,x:a.x+.9}))};
  const neb=generateNebInput(draft,material,final,{finalSourceId:'structure:b',images:5,steps:100,thresholdEvAngstrom:.05,climbing:true,mapping:[]});
  assert.equal((neb.content.match(/ATOMIC_POSITIONS crystal/g)??[]).length,5);assert.match(neb.content,/num_of_images = 5/);assert.match(neb.content,/minimum_image = .false./);
  assert.throws(()=>generateNebInput(draft,material,{...final,atoms:[...final.atoms].reverse()},{finalSourceId:'b',images:5,steps:100,thresholdEvAngstrom:.05,climbing:true,mapping:[]}),/species/);
});
test('sweep preserves density cutoff and physical settings, and rejects invalid/expert rows',()=>{
  const runs=sweepDrafts(draft,{parameter:'cutoff',values:[30,50,70]});assert.deepEqual(runs.map(d=>d.cutoff),[30,50,70]);assert.ok(runs.every(d=>d.chargeDensityCutoff===draft.chargeDensityCutoff&&d.totalCharge===draft.totalCharge));
  assert.throws(()=>sweepDrafts(draft,{parameter:'k-grid',values:[2,2]}),/distinct/);assert.throws(()=>sweepDrafts({...draft,rawInput:'&CONTROL /'},{parameter:'k-grid',values:[2,4]}),/overrides/);
});
test('geometry graph accepts structure branches, forbids SCF-as-geometry and traverses NEB endpoint dependencies',()=>{
  const a=node('a',{geometry:{kind:'supercell',matrix:[[2,0,0],[0,1,0],[0,0,1]]}}),b=node('b',{structureSourceId:'a'}),neb=node('neb',{neb:{finalSourceId:'a',images:5,steps:100,thresholdEvAngstrom:.05,climbing:false,mapping:[]}});
  const materials=[{id:'m',name:'m',projectId:'p'}];assert.deepEqual(workflowOrder([a,b,neb],materials,['neb']).map(c=>c.id),['a','neb']);assert.equal(workflowEdges([a,b,neb],materials).filter(e=>e.target==='neb').length,2);
  assert.throws(()=>connectWorkflow({components:[node('scf'),a],canvas:defaultWorkflowCanvas()},materials,'scf','a'),/relaxed structure/);
  const mapped=remapWorkflowComponents([a,neb],new Map([['m','m2']]),()=>crypto.randomUUID());assert.equal(mapped.components[1].neb!.finalSourceId,mapped.components[0].id);
});
test('fatbands preserve absolute per-projector weights and export every source weight',async()=>{
  const dataset=await datasetFromText('k_distance,band_1_ev\n0,-1\n1,2',{projectId:'p',name:'fixture',filename:'bands.csv'});
  attachBandProjections(dataset,{version:1,basis:'orthogonalized-atomic-global-axes',sourceSha256:'a'.repeat(64),kpointCount:2,channels:[{id:'1',atom:1,species:'Si',wfc:1,l:0,orbital:'s',label:'Si s'}],series:[{'1':[.1,.2]}]});
  const figure=createFigure('p',[dataset]);const layer={...figure.panels[0].layers[0],projectionIds:['1']};const data=transformedLayer(dataset,layer);
  figure.panels[0].layers[0]=layer;const rendered=renderFigure(figure,[dataset]);assert.match(rendered,/data-projected-band-outline/);assert.match(rendered,/maximum 1/);
  assert.deepEqual(data.quantities[0].series[0].weights,[.1,.2]);assert.equal(data.quantities[0].series[0].weightScale,'absolute');assert.match(exportNumericalDataset(dataset,'csv').text,/projector_1/);assert.match(exportNumericalDataset(dataset,'dat').text,/0 -1 0.1/);
  assert.throws(()=>attachBandProjections(dataset,{version:1}),/match/);
});
test('MD geometry preserves particle properties and produces a usable open slab',()=>{
  const frame={index:0,timestep:0,time:0,ids:['a','b'],species:['Si','C'],positions:source.atoms.flatMap(a=>fractionalVectorToCartesian([a.x,a.y,a.z],cell)),properties:{Mass:[28,12]},vectors:cell,origin:[0,0,0] as [number,number,number],periodic:source.periodic,hasCell:true};
  const result=analyzeMdFrame(frame,{modifiers:[{id:'g',kind:'surface_slab',enabled:true,params:{miller:[0,0,1],layers:3,vacuumAngstrom:12,termination:1}}]});assert.deepEqual(result.frame.properties.Mass,[12,28,12]);assert.deepEqual(result.frame.periodic,[true,true,false]);
});
