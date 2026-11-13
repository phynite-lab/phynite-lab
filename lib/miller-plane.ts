type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a: Vec, b: Vec): Vec => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
/** h*u+k*v+l*w=offset. The offset is in reciprocal-plane periods, not Cartesian distance. */
export function millerPlane(cell: [Vec, Vec, Vec], indices: Vec, offset: number, repeats: Vec = [1, 1, 1]) {
  if (!indices.every(Number.isSafeInteger) || indices.every(n => n === 0) || !Number.isFinite(offset) || !cell.flat().every(Number.isFinite) || !repeats.every(n => Number.isFinite(n) && n > 0)) throw new Error('Choose finite lattice vectors, nonzero integer Miller indices and a finite offset.');
  const volume = dot(cell[0], cross(cell[1], cell[2]));
  if (Math.abs(volume) < 1e-12) throw new Error('Miller planes need a nonsingular lattice.');
  const reciprocal = [cross(cell[1], cell[2]), cross(cell[2], cell[0]), cross(cell[0], cell[1])];
  const normal = [0,1,2].map(i => indices.reduce((s, h, j) => s + h * reciprocal[j][i] / volume, 0)) as Vec;
  const magnitude = Math.hypot(...normal), unitNormal = normal.map(v => v / magnitude) as Vec;
  const vertices: Vec[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const a = (axis+1)%3, b = (axis+2)%3;
    if (indices[axis] === 0) continue;
    for (const u of [0, repeats[a]]) for (const v of [0, repeats[b]]) {
      const point: Vec = [0,0,0]; point[a]=u; point[b]=v; point[axis]=(offset-indices[a]*u-indices[b]*v)/indices[axis];
      if (point[axis] >= -1e-9 && point[axis] <= repeats[axis]+1e-9 && !vertices.some(p => Math.hypot(...p.map((n,i)=>n-point[i])) < 1e-8)) vertices.push(point);
    }
  }
  const cartesian = (p: Vec): Vec => [0,1,2].map(i => p.reduce((s,n,j)=>s+n*cell[j][i],0)) as Vec;
  const center = vertices.reduce((c,p)=>c.map((v,i)=>v+p[i]/vertices.length) as Vec,[0,0,0] as Vec);
  const origin = cartesian(center), first = vertices[0] && cartesian(vertices[0]);
  if (first && vertices.length > 2) {
    const x = first.map((v,i)=>v-origin[i]) as Vec, y = cross(unitNormal,x);
    vertices.sort((p,q)=>{ const angle=(v:Vec)=>{const d=cartesian(v).map((n,i)=>n-origin[i]) as Vec;return Math.atan2(dot(d,y),dot(d,x));};return angle(p)-angle(q); });
  }
  return { normal: unitNormal, spacingAngstrom: 1/magnitude, distanceAngstrom: offset/magnitude, vertices };
}
