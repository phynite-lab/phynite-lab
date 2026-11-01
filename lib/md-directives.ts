import type { MdDirectiveBlock, MdSimulationConfig } from './md-simulation-types.ts';
import { reorderItemsById } from './ordered-items.ts';

export const MD_DIRECTIVE_BLOCK_KINDS: MdDirectiveBlock['kind'][] = [
  'run',
  'minimize',
  'velocity',
  'thermostat',
  'barostat',
  'deform',
  'analysis',
  'checkpoint',
];

export const MD_DIRECTIVE_BLOCK_LABELS: Record<MdDirectiveBlock['kind'], { label: string; command: string; tone: string }> = {
  run: { label: 'Run', command: 'run', tone: 'blue' },
  minimize: { label: 'Minimize', command: 'minimize', tone: 'violet' },
  velocity: { label: 'Initialize velocity', command: 'velocity create', tone: 'amber' },
  thermostat: { label: 'Temperature control', command: 'fix nve / nvt / langevin', tone: 'red' },
  barostat: { label: 'Pressure control', command: 'fix npt / nph', tone: 'cyan' },
  deform: { label: 'Deformation', command: 'fix deform', tone: 'orange' },
  analysis: { label: 'Analysis', command: 'compute', tone: 'green' },
  checkpoint: { label: 'Checkpoint', command: 'write_restart', tone: 'slate' },
};

export type MdDirectiveShortcut = 'run' | 'minimization' | 'maxwell-velocity' | 'nvt' | 'npt' | 'tensile-strain' | 'msd' | 'rdf';

export const MD_DIRECTIVE_SHORTCUTS: Array<{
  id: MdDirectiveShortcut;
  label: string;
  command: string;
  tone: string;
}> = [
  { id: 'run', label: 'Run', command: 'run', tone: 'blue' },
  { id: 'minimization', label: 'Minimization', command: 'min_style · minimize', tone: 'violet' },
  { id: 'maxwell-velocity', label: 'Maxwell velocity', command: 'velocity create', tone: 'amber' },
  { id: 'nvt', label: 'NVT', command: 'fix nvt', tone: 'red' },
  { id: 'npt', label: 'NPT', command: 'fix npt', tone: 'cyan' },
  { id: 'tensile-strain', label: 'Tensile strain', command: 'fix deform', tone: 'orange' },
  { id: 'msd', label: 'MSD', command: 'compute msd', tone: 'green' },
  { id: 'rdf', label: 'RDF', command: 'compute rdf', tone: 'green' },
];

let directiveSequence = 0;

function directiveId(kind: MdDirectiveBlock['kind']) {
  directiveSequence += 1;
  return `block-${kind}-${Date.now().toString(36)}-${directiveSequence.toString(36)}`;
}

export function createMdDirectiveBlock(kind: MdDirectiveBlock['kind'], config?: MdSimulationConfig): MdDirectiveBlock {
  const source = config;
  const common = {
    timestepFs: source?.timestepFs ?? 1,
    totalSteps: source?.totalSteps ?? 10_000,
  };
  switch (kind) {
    case 'run':
      return { id: directiveId(kind), kind, enabled: true, params: { steps: source?.totalSteps ?? 10_000 } };
    case 'minimize':
      return { id: directiveId(kind), kind, enabled: true, params: { style: source?.minimizeStyle ?? 'cg', energyTolerance: source?.energyTolerance ?? 1e-8, forceTolerance: source?.forceTolerance ?? 1e-10, maxIterations: source?.maxIterations ?? 10_000, maxEvaluations: source?.maxEvaluations ?? 100_000 } };
    case 'velocity':
      return { id: directiveId(kind), kind, enabled: true, params: { temperatureK: source?.tempStartK ?? 300, seed: source?.velocitySeed ?? 4_928_459 } };
    case 'thermostat':
      return { id: directiveId(kind), kind, enabled: true, params: { ...common, style: source?.recipeId === 'langevin' ? 'langevin' : source?.recipeId === 'temp-berendsen' ? 'temp-berendsen' : source?.recipeId === 'nve' ? 'nve' : 'nvt', tempStartK: source?.tempStartK ?? 300, tempEndK: source?.tempEndK ?? 300, dampingPs: source?.recipeId === 'langevin' ? source.frictionDampingPs ?? 0.1 : source?.tempDampingPs ?? 0.1, seed: source?.velocitySeed ?? 4_928_459 } };
    case 'barostat':
      return { id: directiveId(kind), kind, enabled: true, params: { ...common, style: source?.recipeId === 'nph' || source?.recipeId === 'pressure-ramp' ? 'nph' : source?.recipeId === 'press-berendsen' ? 'press-berendsen' : 'npt', tempStartK: source?.tempStartK ?? 300, tempEndK: source?.tempEndK ?? 300, tempDampingPs: source?.tempDampingPs ?? 0.1, pressureStartBar: source?.pressureBar ?? 0, pressureEndBar: source?.pressureEndBar ?? source?.pressureBar ?? 0, pressureDampingPs: source?.pressureDampingPs ?? 1 } };
    case 'deform': {
      const mode = source?.recipeId === 'compression' || source?.recipeId === 'shear' ? source.recipeId : 'tensile';
      return { id: directiveId(kind), kind, enabled: true, params: { ...common, mode, axis: mode === 'shear' ? source?.shearPlane ?? 'xy' : mode === 'compression' ? source?.compressionAxis ?? 'z' : source?.tensileAxis ?? 'z', temperatureK: source?.tempStartK ?? 300, tempDampingPs: source?.tempDampingPs ?? 0.1, strainRatePerSecond: mode === 'shear' ? source?.shearRate ?? 1e8 : mode === 'compression' ? source?.compressionRate ?? 1e8 : source?.strainRate ?? 1e8, maxStrain: mode === 'shear' ? source?.maxShearStrain ?? 0.2 : mode === 'compression' ? source?.maxCompressionStrain ?? 0.2 : source?.maxStrain ?? 0.2 } };
    }
    case 'analysis': {
      type AnalysisStyle = Extract<MdDirectiveBlock, { kind: 'analysis' }>['params']['style'];
      const styles: AnalysisStyle[] = ['msd', 'rdf', 'vacf', 'coordination', 'cna', 'centrosymmetry', 'voronoi', 'stress-atom', 'pe-atom', 'ke-atom'];
      const configured = source?.recipeId === 'diffusion' ? 'msd' : source?.recipeId;
      const style = styles.includes(configured as AnalysisStyle) ? configured as AnalysisStyle : 'msd';
      return { id: directiveId(kind), kind, enabled: true, params: { style, totalSteps: source?.totalSteps ?? 10_000, sampleEvery: source?.sampleFrequency ?? source?.thermoFrequency ?? 100, cutoffAngstrom: source?.recipeId === 'rdf' ? source.rdfCutoffAngstrom ?? 8 : source?.analysisCutoffAngstrom ?? 3.5, bins: source?.rdfBins ?? 200, neighbors: source?.analysisNeighbors ?? 12 } };
    }
    case 'checkpoint':
      return { id: directiveId(kind), kind, enabled: true, params: { label: source?.restartLabel ?? 'checkpoint' } };
  }
}

export function createMdDirectiveShortcut(shortcut: MdDirectiveShortcut, config?: MdSimulationConfig): MdDirectiveBlock {
  if (shortcut === 'run') return createMdDirectiveBlock('run', config);
  if (shortcut === 'minimization') return createMdDirectiveBlock('minimize', config);
  if (shortcut === 'maxwell-velocity') return createMdDirectiveBlock('velocity', config);
  if (shortcut === 'nvt') {
    const block = createMdDirectiveBlock('thermostat', config);
    return block.kind === 'thermostat' ? { ...block, params: { ...block.params, style: 'nvt' } } : block;
  }
  if (shortcut === 'npt') {
    const block = createMdDirectiveBlock('barostat', config);
    return block.kind === 'barostat' ? { ...block, params: { ...block.params, style: 'npt' } } : block;
  }
  if (shortcut === 'tensile-strain') {
    const block = createMdDirectiveBlock('deform', config);
    return block.kind === 'deform' ? { ...block, params: { ...block.params, mode: 'tensile', axis: 'z' } } : block;
  }
  const block = createMdDirectiveBlock('analysis', config);
  return block.kind === 'analysis'
    ? { ...block, params: { ...block.params, style: shortcut } }
    : block;
}

export function mdDirectiveBlockTitle(block: MdDirectiveBlock): string {
  if (block.kind === 'thermostat') return block.params.style.toUpperCase();
  if (block.kind === 'barostat') return block.params.style.toUpperCase();
  if (block.kind === 'deform') return `${block.params.mode[0].toUpperCase()}${block.params.mode.slice(1)} strain`;
  if (block.kind === 'analysis') return block.params.style.toUpperCase();
  if (block.kind === 'velocity') return 'Maxwell velocity';
  return MD_DIRECTIVE_BLOCK_LABELS[block.kind].label;
}

export function duplicateMdDirectiveBlock(blocks: MdDirectiveBlock[], blockId: string, config?: MdSimulationConfig): MdDirectiveBlock[] {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index < 0 || blocks.length >= 24) return blocks;
  const source = blocks[index];
  const duplicate = { ...structuredClone(source), id: createMdDirectiveBlock(source.kind, config).id };
  return [...blocks.slice(0, index + 1), duplicate, ...blocks.slice(index + 1)];
}

export function deleteMdDirectiveBlock(blocks: MdDirectiveBlock[], blockId: string): MdDirectiveBlock[] {
  if (blocks.length <= 1) return blocks;
  return blocks.filter((block) => block.id !== blockId);
}

export function reorderMdDirectiveBlocks(blocks: MdDirectiveBlock[], sourceId: string, targetId: string): MdDirectiveBlock[] {
  return reorderItemsById(blocks, sourceId, targetId);
}

export function defaultMdDirectiveBlocks(config: MdSimulationConfig): MdDirectiveBlock[] {
  switch (config.recipeId) {
    case 'minimization': return [createMdDirectiveBlock('minimize', config)];
    case 'velocity': return [createMdDirectiveBlock('velocity', config), createMdDirectiveBlock('run', { ...config, totalSteps: 0 })];
    case 'nve':
    case 'nvt':
    case 'langevin':
    case 'temp-berendsen':
    case 'heating':
    case 'cooling':
    case 'annealing':
    case 'equilibration':
    case 'melting': return [createMdDirectiveBlock('thermostat', config)];
    case 'npt':
    case 'nph':
    case 'press-berendsen':
    case 'pressure-ramp': return [createMdDirectiveBlock('barostat', config)];
    case 'tensile':
    case 'compression':
    case 'shear': return [createMdDirectiveBlock('deform', config)];
    case 'restart': return [createMdDirectiveBlock('checkpoint', config), createMdDirectiveBlock('run', { ...config, totalSteps: 0 })];
    default: return [createMdDirectiveBlock('analysis', config)];
  }
}

function finite(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} is outside the supported range.`);
  return value;
}

function integer(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be a whole number from ${minimum} to ${maximum}.`);
  return value;
}

function numberText(value: number) {
  return Number(value.toPrecision(12)).toString();
}

function safeLabel(value: string) {
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(value)) throw new Error('Checkpoint label may use letters, numbers, dashes, and underscores.');
  return value;
}

export function compileMdDirectiveBlock(block: MdDirectiveBlock, index = 0): string {
  const suffix = String(index + 1).padStart(3, '0');
  switch (block.kind) {
    case 'run': {
      const p = block.params;
      return [`fix ph_block_${suffix}_int all nve`, `run ${integer(p.steps, 0, 100_000_000, 'Run steps')}`, `unfix ph_block_${suffix}_int`].join('\n');
    }
    case 'minimize': {
      const p = block.params;
      if (!['cg', 'fire', 'sd'].includes(p.style)) throw new Error('Minimization style is not supported.');
      return [`min_style ${p.style}`, `minimize ${numberText(finite(p.energyTolerance, 0, 1, 'Energy tolerance'))} ${numberText(finite(p.forceTolerance, 0, 1, 'Force tolerance'))} ${integer(p.maxIterations, 1, 10_000_000, 'Maximum iterations')} ${integer(p.maxEvaluations, 1, 100_000_000, 'Maximum evaluations')}`].join('\n');
    }
    case 'velocity': {
      const p = block.params;
      return `velocity all create ${numberText(Math.max(finite(p.temperatureK, 0, 100_000, 'Temperature'), 1e-6))} ${integer(p.seed, 1, 2_147_483_646, 'Velocity seed')} mom yes rot yes dist gaussian`;
    }
    case 'thermostat': {
      const p = block.params;
      const timestep = numberText(finite(p.timestepFs, 0.0001, 100, 'Timestep') / 1000);
      const steps = integer(p.totalSteps, 0, 100_000_000, 'Total steps');
      const start = numberText(finite(p.tempStartK, 0, 100_000, 'Initial temperature'));
      const end = numberText(finite(p.tempEndK, 0, 100_000, 'Final temperature'));
      const damping = numberText(finite(p.dampingPs, 1e-6, 10_000, 'Temperature damping'));
      const id = `ph_block_${suffix}`;
      if (p.style === 'nve') return [`timestep ${timestep}`, `fix ${id} all nve`, `run ${steps}`, `unfix ${id}`].join('\n');
      if (p.style === 'nvt') return [`timestep ${timestep}`, `fix ${id} all nvt temp ${start} ${end} ${damping}`, `run ${steps}`, `unfix ${id}`].join('\n');
      if (p.style === 'langevin') return [`timestep ${timestep}`, `fix ${id}_int all nve`, `fix ${id}_bath all langevin ${start} ${end} ${damping} ${integer(p.seed, 1, 2_147_483_646, 'Random seed')} zero yes`, `run ${steps}`, `unfix ${id}_bath`, `unfix ${id}_int`].join('\n');
      if (p.style === 'temp-berendsen') return [`timestep ${timestep}`, `fix ${id}_int all nve`, `fix ${id}_bath all temp/berendsen ${start} ${end} ${damping}`, `run ${steps}`, `unfix ${id}_bath`, `unfix ${id}_int`].join('\n');
      throw new Error('Temperature-control style is not supported.');
    }
    case 'barostat': {
      const p = block.params;
      const timestep = numberText(finite(p.timestepFs, 0.0001, 100, 'Timestep') / 1000);
      const steps = integer(p.totalSteps, 0, 100_000_000, 'Total steps');
      const pressure = `${numberText(finite(p.pressureStartBar, -1_000_000, 1_000_000, 'Initial pressure'))} ${numberText(finite(p.pressureEndBar, -1_000_000, 1_000_000, 'Final pressure'))} ${numberText(finite(p.pressureDampingPs, 1e-6, 100_000, 'Pressure damping'))}`;
      const id = `ph_block_${suffix}`;
      if (p.style === 'npt') return [`timestep ${timestep}`, `fix ${id} all npt temp ${numberText(finite(p.tempStartK, 0, 100_000, 'Initial temperature'))} ${numberText(finite(p.tempEndK, 0, 100_000, 'Final temperature'))} ${numberText(finite(p.tempDampingPs, 1e-6, 10_000, 'Temperature damping'))} iso ${pressure}`, `run ${steps}`, `unfix ${id}`].join('\n');
      if (p.style === 'nph') return [`timestep ${timestep}`, `fix ${id} all nph iso ${pressure}`, `run ${steps}`, `unfix ${id}`].join('\n');
      if (p.style === 'press-berendsen') return [`timestep ${timestep}`, `fix ${id}_int all nve`, `fix ${id}_bar all press/berendsen iso ${pressure}`, `run ${steps}`, `unfix ${id}_bar`, `unfix ${id}_int`].join('\n');
      throw new Error('Pressure-control style is not supported.');
    }
    case 'deform': {
      const p = block.params;
      const timestepPs = finite(p.timestepFs, 0.0001, 100, 'Timestep') / 1000;
      const steps = integer(p.totalSteps, 0, 100_000_000, 'Total steps');
      const rate = finite(p.strainRatePerSecond, 1e-12, 1e18, 'Strain rate');
      const planned = rate * 1e-12 * timestepPs * steps;
      const maximum = finite(p.maxStrain, 1e-9, 10, 'Maximum strain');
      if (planned > maximum * (1 + 1e-9)) throw new Error(`This block would reach ${planned.toPrecision(4)} strain, above the ${maximum.toPrecision(4)} safety limit.`);
      const axis = p.mode === 'shear' ? (['xy', 'xz', 'yz'].includes(p.axis) ? p.axis : null) : (['x', 'y', 'z'].includes(p.axis) ? p.axis : null);
      if (!axis) throw new Error('Deformation axis or shear plane is invalid.');
      const erate = rate * 1e-12 * (p.mode === 'compression' ? -1 : 1);
      const id = `ph_block_${suffix}`;
      return [`timestep ${numberText(timestepPs)}`, `fix ${id}_int all nvt temp ${numberText(finite(p.temperatureK, 0, 100_000, 'Temperature'))} ${numberText(finite(p.temperatureK, 0, 100_000, 'Temperature'))} ${numberText(finite(p.tempDampingPs, 1e-6, 10_000, 'Temperature damping'))}`, `fix ${id}_def all deform 1 ${axis} erate ${numberText(erate)} units box remap x`, `run ${steps}`, `unfix ${id}_def`, `unfix ${id}_int`].join('\n');
    }
    case 'analysis': {
      const p = block.params;
      const id = `ph_block_${suffix}`;
      const steps = integer(p.totalSteps, 0, 100_000_000, 'Analysis run steps');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(block.id)) throw new Error('LAMMPS block ID is invalid.');
      const output = `data/${p.style}-block-${suffix}-${block.id}`;
      if (['msd', 'rdf', 'vacf'].includes(p.style)) {
        if (steps < 1) throw new Error('Dynamic analysis requires at least one integration step.');
        const sample = integer(p.sampleEvery, 1, steps, 'Sampling interval');
        let commands: string[];
        let consumer: string;
        if (p.style === 'rdf') {
          const cutoff = finite(p.cutoffAngstrom, 1e-6, 10_000, 'RDF cutoff');
          commands = [`comm_modify cutoff ${numberText(cutoff + 2)}`, `compute ${id} all rdf ${integer(p.bins, 10, 10_000, 'RDF bins')} cutoff ${numberText(cutoff)}`];
          consumer = `c_${id}[*] file ${output}.dat mode vector`;
        } else {
          commands = [`compute ${id} all ${p.style === 'msd' ? 'msd com yes' : 'vacf'}`];
          consumer = [1, 2, 3, 4].map((component) => `c_${id}[${component}]`).join(' ') + ` file ${output}.dat`;
        }
        return [...commands, `fix ${id}_avg all ave/time ${sample} 1 ${sample} ${consumer}`, `fix ${id}_int all nve`, `run ${steps}`, `unfix ${id}_int`, `unfix ${id}_avg`, `uncompute ${id}`].join('\n');
      }
      let command: string;
      let columns = `c_${id}`;
      const prefix: string[] = [];
      if (p.style === 'coordination' || p.style === 'cna') {
        const cutoff = finite(p.cutoffAngstrom, 1e-6, 10_000, 'Analysis cutoff');
        prefix.push(`comm_modify cutoff ${numberText(cutoff + 2)}`);
        command = `${p.style === 'coordination' ? 'coord/atom cutoff' : 'cna/atom'} ${numberText(cutoff)}`;
      } else if (p.style === 'centrosymmetry') {
        const neighbors = integer(p.neighbors, 2, 20, 'Neighbor count');
        if (neighbors % 2) throw new Error('Centrosymmetry neighbor count must be even.');
        command = `centro/atom ${neighbors}`;
      } else {
        command = p.style === 'voronoi' ? 'voronoi/atom' : p.style === 'stress-atom' ? 'stress/atom NULL' : p.style === 'pe-atom' ? 'pe/atom' : p.style === 'ke-atom' ? 'ke/atom' : '';
        if (!command) throw new Error('Analysis style is not supported.');
        if (p.style === 'voronoi' || p.style === 'stress-atom') columns = Array.from({ length: p.style === 'voronoi' ? 2 : 6 }, (_, i) => `c_${id}[${i + 1}]`).join(' ');
      }
      return [...prefix, `compute ${id} all ${command}`, `dump ${id}_snapshot all custom 1 ${output}.dump id type x y z ix iy iz ${columns}`, `dump_modify ${id}_snapshot first yes sort id`, 'run 0 post no', `undump ${id}_snapshot`, `uncompute ${id}`].join('\n');
    }
    case 'checkpoint': {
      const p = block.params;
      return `write_restart data/${suffix}-${safeLabel(p.label)}.restart`;
    }
  }
}

export function validateMdDirectiveBlocks(blocks: MdDirectiveBlock[]): string {
  if (!Array.isArray(blocks) || !blocks.length) return 'Add at least one LAMMPS block.';
  if (blocks.length > 24) return 'A step can contain at most 24 LAMMPS blocks.';
  if (new Set(blocks.map((block) => block.id)).size !== blocks.length) return 'LAMMPS block IDs must be unique.';
  if (!blocks.some((block) => block.enabled)) return 'Enable at least one LAMMPS block.';
  try {
    blocks.forEach((block, index) => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(block.id)) throw new Error('LAMMPS block ID is invalid.');
      if (!MD_DIRECTIVE_BLOCK_KINDS.includes(block.kind)) throw new Error('LAMMPS block type is not supported.');
      if (typeof block.enabled !== 'boolean') throw new Error('LAMMPS block enabled state is invalid.');
      if (block.enabled) compileMdDirectiveBlock(block, index);
    });
  } catch (error) {
    return error instanceof Error ? error.message : 'LAMMPS blocks are invalid.';
  }
  return '';
}

export function validateMdDirectiveBlock(block: MdDirectiveBlock, index = 0): string {
  try {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(block.id)) throw new Error('LAMMPS block ID is invalid.');
    if (!MD_DIRECTIVE_BLOCK_KINDS.includes(block.kind)) throw new Error('LAMMPS block type is not supported.');
    if (typeof block.enabled !== 'boolean') throw new Error('LAMMPS block enabled state is invalid.');
    if (block.enabled) compileMdDirectiveBlock(block, index);
  } catch (error) {
    return error instanceof Error ? error.message : 'LAMMPS block is invalid.';
  }
  return '';
}

export function compileMdDirectiveBlocks(blocks: MdDirectiveBlock[]): string {
  const error = validateMdDirectiveBlocks(blocks);
  if (error) throw new Error(error);
  const lines: string[] = [];
  let cleanup: string[] = [];
  blocks.forEach((block, index) => {
    if (!block.enabled) return;
    let commands = compileMdDirectiveBlock(block, index).split('\n');
    const control = ['thermostat', 'barostat', 'deform'].includes(block.kind);
    if (control || block.kind === 'minimize') {
      lines.push(...cleanup);
      cleanup = [];
    }
    if (cleanup.length && (block.kind === 'run' || block.kind === 'analysis')) {
      const guard = `ph_block_${String(index + 1).padStart(3, '0')}_int`;
      commands = commands.filter((line) => line !== `fix ${guard} all nve` && line !== `unfix ${guard}`);
    }
    if (control) while (commands.at(-1)?.startsWith('unfix ')) cleanup.unshift(commands.pop()!);
    if (lines.length) lines.push('');
    lines.push(`# Block ${index + 1}: ${MD_DIRECTIVE_BLOCK_LABELS[block.kind].label}`, `print "PHYNITE_BLOCK_BEGIN ${String(index + 1).padStart(3, '0')} ${block.id} ${block.kind}"`, ...commands, `print "PHYNITE_BLOCK_END ${String(index + 1).padStart(3, '0')} ${block.id} ${block.kind}"`);
  });
  lines.push(...cleanup);
  return lines.join('\n');
}
