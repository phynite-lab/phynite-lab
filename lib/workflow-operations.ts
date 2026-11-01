import type { JobDraft, MaterialContext } from '../components/JobComposer.tsx';
import { generateQuantumEspressoInputFiles } from './qe-workflow.ts';
import { cartesianToFractionalWithVectors, fractionalVectorToCartesian, type CellVectors, type CellVector } from './crystal-cell.ts';

export type ParameterSweep = { parameter: 'cutoff' | 'k-grid'; values: number[] };
export type NebOperation = { finalSourceId: string; intermediateSourceId?: string; images: number; steps: number; thresholdEvAngstrom: number; climbing: boolean; mapping: number[] };
export function sweepDrafts(draft: JobDraft, sweep: ParameterSweep) {
  if (!['cutoff', 'k-grid'].includes(sweep.parameter) || !Array.isArray(sweep.values) || sweep.values.length < 2 || sweep.values.length > 32 || new Set(sweep.values).size !== sweep.values.length || sweep.values.some(v => !Number.isFinite(v) || v <= 0 || (sweep.parameter === 'k-grid' && (!Number.isInteger(v) || v > 128)) || (sweep.parameter === 'cutoff' && v > 2000))) throw new Error('A sweep needs 2–32 distinct positive values (mesh: integers up to 128; cutoff: up to 2000 Ry).');
  if (draft.rawInput.trim() || draft.cellParameters || draft.atomicPositions) throw new Error('Reset expert/structure overrides before running a parameter sweep.');
  return sweep.values.map(value => sweep.parameter === 'cutoff' ? { ...draft, cutoffPolicy: 'manual' as const, cutoff: value } : { ...draft, kPoint: value, kPointY: value, kPointZ: value });
}
/** Exact closest periodic image using reciprocal bounds; refuses pathological enumeration. */
export function minimumImageDelta(delta: CellVector, cell: CellVectors, periodic: boolean[]): CellVector {
  let best = delta.map((x, a) => periodic[a] ? x-Math.round(x) : x) as CellVector;
  let distance = Math.hypot(...fractionalVectorToCartesian(best, cell));
  const reciprocal = [0, 1, 2].map(a => cartesianToFractionalWithVectors([+(a===0), +(a===1), +(a===2)], cell));
  const bounds = delta.map((x, a) => { const r = distance*Math.hypot(...reciprocal.map(row => row[a]))+1e-9; return periodic[a] ? [Math.ceil(x-r), Math.floor(x+r)] : [0, 0]; });
  if (bounds.reduce((n, [lo, hi]) => n*(hi-lo+1), 1) > 100000) throw new Error('NEB cell is too skewed for unambiguous bounded minimum-image mapping. Reduce the cell basis.');
  for (let i=bounds[0][0]; i<=bounds[0][1]; i++) for (let j=bounds[1][0]; j<=bounds[1][1]; j++) for (let k=bounds[2][0]; k<=bounds[2][1]; k++) { const d: CellVector = [delta[0]-i,delta[1]-j,delta[2]-k]; const length=Math.hypot(...fractionalVectorToCartesian(d,cell)); if(length<distance-1e-10){best=d;distance=length;} }
  return best;
}
export function generateNebInput(draft: JobDraft, initial: MaterialContext, final: MaterialContext, operation: NebOperation, intermediate?: MaterialContext) {
  if (!initial || !final || !initial.atoms.length || draft.rawInput.trim() || draft.cellParameters || draft.atomicPositions) throw new Error('NEB needs explicit structure inputs and generated electronic settings. Reset expert geometry overrides.');
  if (!Number.isInteger(operation.images) || operation.images < 3 || operation.images > 32 || !Number.isInteger(operation.steps) || operation.steps < 1 || operation.steps > 10000 || !Number.isFinite(operation.thresholdEvAngstrom) || operation.thresholdEvAngstrom <= 0 || operation.thresholdEvAngstrom > 10) throw new Error('NEB requires 3–32 images, 1–10000 steps and a positive path threshold up to 10 eV/Å.');
  if(initial.atoms.some(a=>![a.x,a.y,a.z].every(Number.isFinite))) throw new Error('NEB positions must be finite fractional coordinates.');
  const n=initial.atoms.length, mapping=operation.mapping.length ? operation.mapping : initial.atoms.map((_,i)=>i);
  if(mapping.length!==n || new Set(mapping).size!==n || mapping.some(i=>!Number.isInteger(i)||i<0||i>=n)) throw new Error('NEB atom mapping must be a permutation of all final atom indices (0 based).');
  const cell=initial.cellVectors as CellVectors, periodic=initial.periodic ?? [true,true,true];
  for(const other of [final,...(intermediate?[intermediate]:[])]) if(other.atoms.length!==n || other.atoms.some(a=>![a.x,a.y,a.z].every(Number.isFinite)) || other.cellVectors.some((row,a)=>row.some((v,b)=>!Number.isFinite(v)||Math.abs(v-cell[a][b])>1e-7)) || (other.periodic??[true,true,true]).some((p,a)=>p!==periodic[a])) throw new Error('NEB structures must share atom count, cell in Å, and periodic boundaries.');
  const ordered=final.atoms.map((_,i)=>final.atoms[mapping[i]]);
  if(initial.atoms.some((atom,i)=>atom.species!==ordered[i].species || intermediate && atom.species!==intermediate.atoms[i].species)) throw new Error('NEB mapping must preserve every species. Intermediate atoms use initial ordering.');
  const anchors=[initial.atoms,...(intermediate?[intermediate.atoms]:[]),ordered];
  const frames=anchors.map(atoms=>atoms.map(a=>[a.x,a.y,a.z] as CellVector));
  for(let segment=1;segment<frames.length;segment++) frames[segment]=frames[segment].map((position,i)=>{const d=minimumImageDelta(position.map((v,a)=>v-frames[segment-1][i][a]) as CellVector,cell,periodic);return d.map((v,a)=>v+frames[segment-1][i][a]) as CellVector;});
  const images=Array.from({length:operation.images},(_,image)=>{const t=image/(operation.images-1)*(frames.length-1), segment=Math.min(frames.length-2,Math.floor(t)), f=t-segment; return frames[segment].map((a,i)=>a.map((v,axis)=>v+(frames[segment+1][i][axis]-v)*f) as CellVector);});
  const pathLength=images.slice(1).reduce((total,frame,i)=>total+Math.sqrt(frame.reduce((sum,position,a)=>sum+fractionalVectorToCartesian(position.map((v,axis)=>v-images[i][a][axis]) as CellVector,cell).reduce((s,v)=>s+v*v,0),0)),0);
  if(pathLength<1e-8) throw new Error('NEB endpoints define no displacement under the selected periodic mapping. Choose distinct states or an intermediate structure.');
  const pw=generateQuantumEspressoInputFiles({...draft,calculations:['Total energy']},'Total energy',initial)[0].content;
  const lines=pw.split('\n'), index=lines.findIndex(line=>/^ATOMIC_POSITIONS\b/.test(line.trim()));
  if(index<0) throw new Error('NEB engine input has no atomic position card.');
  lines.splice(index,n+1);
  const positions=images.map((atoms,i)=>`${i===0?'FIRST_IMAGE':i===images.length-1?'LAST_IMAGE':'INTERMEDIATE_IMAGE'}\nATOMIC_POSITIONS crystal\n${atoms.map((f,a)=>`${initial.atoms[a].label ?? initial.atoms[a].species} ${f.map(v=>v.toFixed(12)).join(' ')}`).join('\n')}`).join('\n');
  return { name:'neb.in', content:`BEGIN\nBEGIN_PATH_INPUT\n&PATH\n string_method = 'neb',\n restart_mode = 'from_scratch',\n num_of_images = ${operation.images},\n nstep_path = ${operation.steps},\n opt_scheme = 'broyden',\n CI_scheme = '${operation.climbing?'auto':'no-CI'}',\n path_thr = ${operation.thresholdEvAngstrom},\n minimum_image = .false.,\n first_last_opt = .false.,\n/\nEND_PATH_INPUT\nBEGIN_ENGINE_INPUT\n${lines.join('\n')}\nBEGIN_POSITIONS\n${positions}\nEND_POSITIONS\nEND_ENGINE_INPUT\nEND\n`, provenance:{interpolation:'piecewise-linear-minimum-image',mapping,periodic,images:operation.images,thresholdEvAngstrom:operation.thresholdEvAngstrom} };
}
