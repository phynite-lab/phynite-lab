import { cellVectorsFromLattice, latticeFromCellVectors, fractionalVectorToCartesian, type CellVectors, type LatticeParameters } from './crystal-cell.ts';
export function editCrystalCell(lattice: LatticeParameters, vectors: CellVectors): LatticeParameters {
  return { ...latticeFromCellVectors(vectors), periodic: lattice.periodic ? [...lattice.periodic] : undefined };
}
export function crystalMeasurement(mode: 'distance' | 'angle' | 'dihedral', points: Array<[number,number,number]>, lattice: LatticeParameters): number | null {
  const count = mode === 'distance' ? 2 : mode === 'angle' ? 3 : 4;
  if (points.length !== count) return null;
  const p = points.map(point => fractionalVectorToCartesian(point, cellVectorsFromLattice(lattice)));
  const sub = (a:number[],b:number[]) => a.map((v,i) => v-b[i]);
  const dot = (a:number[],b:number[]) => a.reduce((v,n,i) => v+n*b[i],0);
  const cross = (a:number[],b:number[]) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit = (a:number[]) => { const length=Math.hypot(...a); if (length<1e-12) throw new Error('Choose distinct, non-collinear atoms for this measurement.'); return a.map(v=>v/length); };
  if (mode==='distance') return Math.hypot(...sub(p[0],p[1]));
  if (mode==='angle') return Math.acos(Math.max(-1,Math.min(1,dot(unit(sub(p[0],p[1])),unit(sub(p[2],p[1]))))))*180/Math.PI;
  const b0=sub(p[0],p[1]), b1=unit(sub(p[2],p[1])), b2=sub(p[3],p[2]);
  const v=unit(b0.map((n,i)=>n-dot(b0,b1)*b1[i])), w=unit(b2.map((n,i)=>n-dot(b2,b1)*b1[i]));
  return Math.atan2(dot(cross(b1,v),w),dot(v,w))*180/Math.PI;
}
