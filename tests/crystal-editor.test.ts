import test from 'node:test';
import assert from 'node:assert/strict';
import {editCrystalCell,crystalMeasurement} from '../lib/crystal-editor.ts';
import {cellVectorsFromLattice,type CellVectors} from '../lib/crystal-cell.ts';
import {portableWorkflow,draftInput} from '../lib/workflow-draft-bundle.ts';
import type {ProjectWorkflow} from '../lib/project-workflow.ts';
test('cell edits retain exact basis, mixed periodicity and scientific atom metadata',()=>{
  const vectors:CellVectors=[[3,.2,0],[.5,4,0],[.1,.3,20]],old={a:3,b:4,c:20,alpha:90,beta:90,gamma:90,periodic:[true,true,false] as [boolean,boolean,boolean]};
  const next=editCrystalCell(old,vectors);assert.deepEqual(cellVectorsFromLattice(next),vectors);assert.deepEqual(next.periodic,[true,true,false]);assert.notEqual(next.periodic,old.periodic);
  assert.throws(()=>editCrystalCell(old,[[0,0,0],[0,4,0],[0,0,20]]));assert.equal(old.a,3);assert.deepEqual(old.periodic,[true,true,false]);
});
test('measurements use physical basis, retain image offsets, and reject degenerate angles',()=>{
  const lattice=editCrystalCell({a:2,b:3,c:4,alpha:90,beta:90,gamma:90},[[2,0,0],[1,3,0],[0,0,4]]);
  assert.equal(crystalMeasurement('distance',[[0,0,0],[2,0,0]],lattice),4);
  assert.equal(crystalMeasurement('angle',[[1,0,0],[0,0,0],[0,0,1]],lattice),90);
  assert.ok(Math.abs(Math.abs(crystalMeasurement('dihedral',[[0,1,0],[0,0,0],[1,0,0],[1,0,1]],lattice)!)-90)<1e-9);
  assert.equal(crystalMeasurement('angle',[],lattice),null);
  assert.throws(()=>crystalMeasurement('angle',[[0,0,0],[0,0,0],[1,1,0]],lattice));
});
test('portable draft has verified input bytes and cannot carry source success/history',async()=>{
  const graph:ProjectWorkflow={version:1,projectId:'one',edges:[],groups:[],nodes:[{id:'node',name:'SCF',kind:'scf',position:{x:4,y:5},resources:[],configuration:{draft:{cutoff:60},execution:{jobId:'private'},preservedHistory:['success'],pseudopotentials:{Si:'private-key'}}}]};
  const copy=portableWorkflow(graph);assert.deepEqual(copy.nodes[0].configuration,{draft:{cutoff:60}});assert.ok(graph.nodes[0].configuration.execution);
  const input=await draftInput('str_1','structure','structure.json',new Blob(['abc']));assert.equal(atob(input.bytes),'abc');assert.equal(input.sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
