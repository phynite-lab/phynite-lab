import { cartesianToFractionalWithVectors, fractionalVectorToCartesian, cellVolume, type CellVector, type CellVectors } from './crystal-cell.ts';
import { applyWorkflowGeometry, type GeometryOperation } from './workflow-geometry.ts';
import { mdModifierCatalog, type MdAnalysis, type MdFrame, type MdModifier } from './md-types.ts';

export type MdQuickAnalysis = MdAnalysis & { coordination: number[] };
export const positionAt = (f: MdFrame, i: number): CellVector => f.positions.slice(i * 3, i * 3 + 3) as CellVector;
export function propertyRange(values: number[]): [number, number] | null {
  let min = Infinity, max = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  return min === Infinity ? null : [min, max];
}
export function speciesCounts(frame: MdFrame) {
  const counts = new Map<string, number>();
  frame.species.forEach(s => counts.set(s, (counts.get(s) ?? 0) + 1));
  return Array.from(counts, ([name, count]) => ({ name, count }));
}
function filterFrame(frame: MdFrame, indices: number[]): MdFrame {
  return { ...frame, ids: indices.map(i => frame.ids[i]), species: indices.map(i => frame.species[i]), positions: indices.flatMap(i => positionAt(frame, i)), properties: Object.fromEntries(Object.entries(frame.properties).map(([k, v]) => [k, indices.map(i => v[i])])), ...(frame.stringProperties ? { stringProperties: Object.fromEntries(Object.entries(frame.stringProperties).map(([k, v]) => [k, indices.map(i => v[i])])) } : {}) };
}
function expressionMask(frame: MdFrame, expression: string) {
  if (!expression.trim() || expression.length > 500) throw new Error('Enter a property comparison, e.g. Position.Z > 5 && c_pe < -3.');
  const groups = expression.split('||').map(group => group.split('&&').map(part => {
    const m = part.trim().match(/^([\w.[\]]+)\s*(>=|<=|==|!=|>|<)\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i);
    if (!m) throw new Error('Local expressions support numeric comparisons joined with && or ||.');
    const [, key, op, raw] = m, threshold = Number(raw);
    const axis = ['Position.X', 'Position.Y', 'Position.Z'].indexOf(key);
    const values = axis < 0 ? frame.properties[key] : frame.ids.map((_, i) => frame.positions[i * 3 + axis]);
    if (!values) throw new Error('Property not found: ' + key);
    return (i: number) => ({ '>': values[i] > threshold, '<': values[i] < threshold, '>=': values[i] >= threshold, '<=': values[i] <= threshold, '==': values[i] === threshold, '!=': values[i] !== threshold })[op];
  }));
  return frame.ids.map((_, i) => Number(groups.some(group => group.every(test => test(i)))));
}
function geometryModifier(frame: MdFrame, m: MdModifier): MdFrame {
  if (m.kind === 'supercell' || m.kind === 'surface_slab') {
    if (!frame.hasCell) throw new Error('Geometry operations require a simulation cell.');
    const source = { cellVectors: frame.vectors, periodic: frame.periodic, atoms: frame.ids.map((id, i) => { const [x,y,z] = cartesianToFractionalWithVectors(positionAt(frame,i).map((v,a)=>v-frame.origin[a]) as CellVector,frame.vectors); return { id, species: frame.species[i], x,y,z }; }) };
    const values=m.params.matrix as number[];
    const operation: GeometryOperation = m.kind === 'supercell' ? {kind:'supercell',matrix:[values.slice(0,3),values.slice(3,6),values.slice(6,9)] as CellVectors} : {kind:'surface_slab',miller:m.params.miller as CellVector,layers:Number(m.params.layers),vacuumAngstrom:Number(m.params.vacuumAngstrom),termination:Number(m.params.termination)};
    const result=applyWorkflowGeometry(source,operation), indices=result.mapping.map(m=>m.sourceIndex);
    return { ...frame, ids:result.atoms.map(a=>a.id), species:result.atoms.map(a=>a.species), positions:result.atoms.flatMap(a=>fractionalVectorToCartesian([a.x,a.y,a.z],result.cellVectors)), vectors:result.cellVectors,origin:[0,0,0],periodic:result.periodic,coordinateMode:'wrapped',geometryProvenance:[...(frame.geometryProvenance??[]),result.provenance],properties:Object.fromEntries(Object.entries(frame.properties).filter(([key])=>!['ix','iy','iz','Periodic Image'].includes(key)).map(([key,values])=>[key,indices.map(i=>values[i])])),stringProperties:frame.stringProperties?Object.fromEntries(Object.entries(frame.stringProperties).map(([key,values])=>[key,indices.map(i=>values[i])])):undefined };
  }
  if (m.kind === 'wrap') return { ...frame, positions: frame.ids.flatMap((_, i) => {
    const fraction = cartesianToFractionalWithVectors(positionAt(frame, i).map((v, a) => v - frame.origin[a]) as CellVector, frame.vectors);
    return fractionalVectorToCartesian(fraction.map((v, a) => frame.periodic[a] ? v - Math.floor(v) : v) as CellVector, frame.vectors).map((v, a) => v + frame.origin[a]);
  }) };
  if (m.kind === 'slice') {
    const normal = m.params.normal as number[], d = Number(m.params.distance), length = Math.hypot(...normal);
    if (normal.length !== 3 || !normal.every(Number.isFinite) || !Number.isFinite(d) || length < 1e-9) throw new Error('Slice needs a nonzero normal and finite distance.');
    return filterFrame(frame, frame.ids.map((_, i) => i).filter(i => {
      const side = positionAt(frame, i).reduce((sum, v, a) => sum + v * normal[a] / length, 0) - d;
      return m.params.reverse ? side >= 0 : side <= 0;
    }));
  }
  if (m.kind === 'expression') {
    const selection = expressionMask(frame, String(m.params.expression));
    const selected = { ...frame, properties: { ...frame.properties, Selection: selection } };
    return m.params.action === 'remove' ? filterFrame(selected, selection.map((_, i) => i).filter(i => !selection[i])) : selected;
  }
  if (m.kind === 'replicate') {
    const repeat = m.params.repeat as number[];
    if (repeat.length !== 3 || repeat.some(v => !Number.isInteger(v) || v < 1 || v > 8)) throw new Error('Use whole repeat counts from 1 to 8.');
    if (frame.ids.length * repeat.reduce((a, b) => a * b, 1) > 100000) throw new Error('Replication exceeds 100,000 atoms.');
    const result: MdFrame = { ...frame, positions: [], ids: [], species: [], properties: Object.fromEntries(Object.keys(frame.properties).map(k => [k, []])), ...(frame.stringProperties ? { stringProperties: Object.fromEntries(Object.keys(frame.stringProperties).map(k => [k, []])) } : {}), vectors: frame.vectors.map((v, a) => v.map(x => x * repeat[a])) as CellVectors };
    for (let a = 0; a < repeat[0]; a++) for (let b = 0; b < repeat[1]; b++) for (let c = 0; c < repeat[2]; c++) {
      const offset = fractionalVectorToCartesian([a, b, c], frame.vectors);
      frame.ids.forEach((id, i) => { result.ids.push(id + '@' + [a, b, c].join(',')); result.species.push(frame.species[i]); result.positions.push(...positionAt(frame, i).map((v, axis) => v + offset[axis])); });
      Object.keys(result.properties).forEach(k => { result.properties[k] = result.properties[k].concat(frame.properties[k]); });
      if (result.stringProperties && frame.stringProperties) for (const key of Object.keys(result.stringProperties)) result.stringProperties[key].push(...frame.stringProperties[key]);
    }
    return result;
  }
  return frame;
}

/** Exact minimum-image geometry for orthogonal cells; larger/skew work uses Personal Compute. */
export function neighborGeometry(frame: MdFrame, cutoff: number, bins = 100) {
  if (!Number.isFinite(cutoff) || cutoff <= 0 || cutoff > 30) throw new Error('Neighbor cutoff must lie between 0 and 30 Å.');
  if (!Number.isInteger(bins) || bins < 10 || bins > 500) throw new Error('RDF bins must be a whole number from 10 to 500.');
  if (frame.ids.length > 3000) throw new Error('Connect Personal Compute and use Compute all frames for neighbor analysis above 3,000 atoms. All atoms remain visible.');
  const skew = frame.vectors.some((v, a) => v.some((x, b) => a !== b && Math.abs(x) > 1e-8));
  if (skew && frame.periodic.some(Boolean)) throw new Error('Connect Personal Compute and use Compute all frames for periodic neighbor analysis of a tilted cell.');
  if (frame.periodic.some((p, a) => p && cutoff > Math.abs(frame.vectors[a][a]) / 2)) throw new Error('The browser cutoff must be at most half each periodic cell length. Connect Personal Compute and use Compute all frames for larger cutoffs.');
  const coordination = Array<number>(frame.ids.length).fill(0), bonds: Array<[number, number]> = [], histogram = Array<number>(bins).fill(0);
  for (let i = 0; i < frame.ids.length; i++) for (let j = i + 1; j < frame.ids.length; j++) {
    let d2 = 0;
    for (let a = 0; a < 3; a++) {
      let d = frame.positions[i * 3 + a] - frame.positions[j * 3 + a];
      if (frame.periodic[a]) { const length = frame.vectors[a][a]; d -= Math.round(d / length) * length; }
      d2 += d * d;
    }
    if (d2 > cutoff ** 2 || d2 < 1e-16) continue;
    coordination[i]++; coordination[j]++;
    bonds.push([i, j]);
    histogram[Math.min(bins - 1, Math.floor(Math.sqrt(d2) / cutoff * bins))] += 2;
  }
  const volume = Math.abs(cellVolume(frame.vectors)), count = frame.ids.length;
  const rdf = frame.hasCell && frame.periodic.every(Boolean) ? histogram.map((h, i) => {
    const lo = i * cutoff / bins, hi = (i + 1) * cutoff / bins;
    const shell = 4 * Math.PI / 3 * (hi ** 3 - lo ** 3);
    return [(lo + hi) / 2, count ? h * volume / (count * count * shell) : 0] as [number, number];
  }) : [];
  return { coordination, bonds, rdf };
}
export function analyzeMdFrame(input: MdFrame, options: { bondCutoff?: number; rdfCutoff?: number; rdfBins?: number; modifiers?: MdModifier[] } = {}): MdQuickAnalysis {
  let frame = { ...input, properties: { ...input.properties } };
  const warnings: string[] = [], attributes: MdAnalysis['attributes'] = {};
  let bonds: Array<[number, number]> = [], rdf: Array<[number, number]> = [], coordination: number[] = [];
  const modifiers = options.modifiers ?? [{ id: 'bonds', kind: 'bonds', enabled: true, params: { cutoff: options.bondCutoff ?? 2.8 } }, ...(options.rdfCutoff ? [{ id: 'rdf', kind: 'rdf' as const, enabled: true, params: { cutoff: options.rdfCutoff, bins: options.rdfBins ?? 100 } }] : [])];
  for (const m of modifiers) {
    if (!m.enabled) continue;
    if (mdModifierCatalog[m.kind].engine) { warnings.push(mdModifierCatalog[m.kind].label + ' requires Personal Compute. Connect your computer and use Compute all frames.'); continue; }
    try {
      if (['rdf', 'bonds', 'coordination'].includes(m.kind)) {
        const geometry = neighborGeometry(frame, Number(m.params.cutoff), Math.max(10, Math.min(500, Number(m.params.bins ?? 100))));
        if (m.kind === 'bonds') bonds = geometry.bonds;
        else { coordination = geometry.coordination; frame = { ...frame, properties: { ...frame.properties, Coordination: coordination } }; }
        if (m.kind === 'rdf') { rdf = geometry.rdf; if (!rdf.length) warnings.push('Bulk g(r) normalization requires a fully periodic cell.'); }
      } else {
        const next = geometryModifier(frame, m);
        // Topology-changing steps invalidate preceding local neighbor outputs.
        if (next.ids !== frame.ids) { bonds = []; rdf = []; coordination = []; }
        frame = next;
      }
    } catch (error) { warnings.push(error instanceof Error ? error.message : 'Modifier failed.'); break; }
  }
  attributes.atoms = frame.ids.length;
  attributes['cell volume'] = Math.abs(cellVolume(frame.vectors));
  attributes.bonds = bonds.length;
  if (coordination.length) attributes['mean coordination'] = coordination.reduce((a, b) => a + b, 0) / coordination.length;
  return { frame, attributes, phases: [], rdf, bonds, dislocations: [], surface: null, warnings, engine: 'Browser', coordination };
}
export function generateDemoTrajectory(frameCount = 24, side = 4): MdFrame[] {
  const basis = [[0, 0, 0], [.5, .5, 0], [.5, 0, .5], [0, .5, .5]], a = 3.615, frames: MdFrame[] = [];
  for (let t = 0; t < frameCount; t++) {
    const positions: number[] = [], species: string[] = [], ids: string[] = [];
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) for (let z = 0; z < side; z++) for (const b of basis) {
      const i = ids.length; ids.push(String(i + 1)); species.push('Cu');
      positions.push((x + b[0]) * a + .03 * Math.sin(t * .2 + i), (y + b[1]) * a + .03 * Math.cos(t * .2 + i), (z + b[2]) * a);
    }
    frames.push({ index: t, timestep: t * 100, time: null, ids, species, positions, properties: {}, vectors: [[side * a, 0, 0], [0, side * a, 0], [0, 0, side * a]], origin: [0, 0, 0], periodic: [true, true, true], hasCell: true });
  }
  return frames;
}
