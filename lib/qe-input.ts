export type QeMagneticDraft = {
  spin: boolean; soc: boolean; noncollinear: boolean;
  startingMagnetization: number; startingMagnetizations?: Record<string, number>;
  totalMagnetization: number; magnetizationConstraint?: 'unconstrained' | 'total';
};

export function totalMagnetizationLine(spinPolarized: boolean, spinOrbitCoupling: boolean, totalMagnetization: number, constraint: 'unconstrained' | 'total' = 'total') {
  if (!spinPolarized || spinOrbitCoupling || constraint !== 'total') return '';
  if (!Number.isFinite(totalMagnetization)) throw new Error('Total magnetization must be finite.');
  return `\n  tot_magnetization = ${totalMagnetization}`;
}

/** QE forbids starting_magnetization together with a collinear total constraint. */
export function spinInputLines(draft: QeMagneticDraft, labels: string[]) {
  const noncollinear = draft.soc || draft.noncollinear;
  if (noncollinear && draft.magnetizationConstraint === 'total') throw new Error('A total collinear magnetization constraint is unsupported with SOC/noncollinear spin. Select unconstrained magnetization or use expert input with constrained_magnetization.');
  if (!draft.spin && !noncollinear) return '  nspin = 1';
  const lines = noncollinear ? ['  noncolin = .true.', ...(draft.soc ? ['  lspinorb = .true.'] : [])] : ['  nspin = 2'];
  if (draft.magnetizationConstraint === 'total') return lines.join('\n') + totalMagnetizationLine(true, false, draft.totalMagnetization, 'total');
  for (const [index, label] of labels.entries()) {
    const value = draft.startingMagnetizations?.[label] ?? (draft.spin ? draft.startingMagnetization : 0);
    if (!Number.isFinite(value) || Math.abs(value) > 1) throw new Error(`Starting magnetization for ${label} must lie between −1 and 1 (fraction of valence electrons).`);
    lines.push(`  starting_magnetization(${index + 1}) = ${value}`);
  }
  return lines.join('\n');
}

export function hubbardInputCard(draft: { dftU: boolean; hubbardProjector?: string; hubbardCorrections?: Array<{ species: string; manifold: string; u: number }> }, labels: string[]) {
  if (!draft.dftU) return '';
  if (!draft.hubbardCorrections?.length) throw new Error('DFT+U requires an explicit QE species label, manifold (for example Fe1-3d), projector and U value. Configure the HUBBARD card or use expert input.');
  if (!['atomic', 'ortho-atomic', 'norm-atomic'].includes(draft.hubbardProjector ?? '')) throw new Error('Choose an atomic, ortho-atomic or norm-atomic Hubbard projector. Other projector types require expert input and their dependencies.');
  const seen = new Set<string>();
  return [`HUBBARD ${draft.hubbardProjector}`, ...draft.hubbardCorrections.map((correction) => {
    if (!labels.includes(correction.species)) throw new Error(`Hubbard species ${correction.species} does not occur in ATOMIC_SPECIES.`);
    if (!/^[1-7][spdf]$/.test(correction.manifold) || ('spdf'.indexOf(correction.manifold[1]) >= Number(correction.manifold[0]))) throw new Error(`Invalid Hubbard manifold ${correction.manifold}. Use an explicit orbital manifold such as 3d or 4f.`);
    if (!Number.isFinite(correction.u) || correction.u < 0) throw new Error('Hubbard U must be finite and nonnegative in eV.');
    const key = `${correction.species}-${correction.manifold}`;
    if (seen.has(key)) throw new Error(`Duplicate Hubbard correction for ${key}.`);
    seen.add(key);
    return `U ${key} ${correction.u}`;
  })].join('\n');
}

type QeMethodDraft = {
  functional: string; vdwCorrection: string; rawInput?: string;
  spin?: boolean; magnetizationConstraint?: 'unconstrained' | 'total'; totalMagnetization?: number;
  occupations?: string; noncollinear?: boolean; soc?: boolean;
  relaxCell?: boolean; ionDynamics?: string; cellDynamics?: string;
  transportScatteringModel?: string; transportChemicalPotentialStep?: number;
  transportDopingMin?: number; transportDopingMax?: number; transportDopingPoints?: number;
  transportInterpolationMultiplier?: number; transportEnergyBins?: number;
  transportTemperatureMin?: number; transportTemperatureMax?: number; transportTemperatureStep?: number;
  transportRelaxationTime?: number; transportChemicalPotentialMin?: number; transportChemicalPotentialMax?: number;
};

export function qeIonDynamicsOptions(draft: Pick<QeMethodDraft, 'relaxCell' | 'cellDynamics'>) {
  const required = (draft.cellDynamics ?? 'bfgs') === 'bfgs' ? 'bfgs' : 'damp';
  return [{ value: 'bfgs', label: 'BFGS' }, { value: 'damp', label: 'Damped dynamics' }, { value: 'fire', label: 'FIRE' }].map(option => ({
    ...option,
    disabled: Boolean(draft.relaxCell && option.value !== required),
    ...(draft.relaxCell && option.value !== required ? { detail: option.value === 'fire' ? 'FIRE requires fixed-cell relaxation.' : `Select ${required} for this cell optimizer.` } : {}),
  }));
}

function namelistValue(input: string, namelist: string, field: string, fallback: string) {
  // Quoted values and comments are whole tokens, so a title cannot impersonate a setting.
  const tokens = (input.match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|![^\n]*|&[a-z_]\w*|[a-z_]\w*|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][-+]?\d+)?|[=/]/gi) ?? []).filter(token => !token.startsWith('!'));
  let section = '';
  let selected = fallback;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index].toLowerCase();
    if (token.startsWith('&')) section = token.slice(1);
    else if (token === '/') section = '';
    else if (section === namelist && token === field && tokens[index + 1] === '=') {
      const value = tokens[index + 2];
      if (value) selected = (value.startsWith("'") || value.startsWith('"') ? value.slice(1, -1) : value).trim().toLowerCase();
    }
  }
  return selected;
}

export function qeMethodIssue(draft: QeMethodDraft, calculation: string, expert = false) {
  const raw = draft.rawInput ?? '';
  const isExpert = expert && Boolean(raw.trim());
  const occupationsVal = isExpert ? namelistValue(raw, 'system', 'occupations', 'smearing') : (draft.occupations ?? 'smearing');
  const isCollinearSpin = isExpert
    ? Number(namelistValue(raw, 'system', 'nspin', '1')) === 2
    : Boolean(draft.spin && !draft.soc && !draft.noncollinear);
  const totalMag = isExpert
    ? Number(namelistValue(raw, 'system', 'tot_magnetization', '-10000').replace(/[dD]/g, 'e'))
    : (draft.magnetizationConstraint === 'total' ? draft.totalMagnetization : -10000);
  if (occupationsVal === 'fixed' && isCollinearSpin && (totalMag === -10000 || (!isExpert && draft.magnetizationConstraint !== 'total'))) {
    return 'QE collinear spin polarization (nspin=2) with fixed occupations requires tot_magnetization. Specify a total magnetization constraint or select smearing occupations for unconstrained spin.';
  }
  if (isExpert && namelistValue(raw, 'system', 'vdw_corr', '') === 'dft-d3-bj') {
    return "QE does not recognize vdw_corr = 'dft-d3-bj'. Use vdw_corr = 'dft-d3' with dftd3_version = 4 for Becke-Johnson damping.";
  }
  if (calculation === 'Band structure') {
    const raw = draft.rawInput ?? '';
    const total = Number(namelistValue(raw, 'system', 'tot_magnetization', '-10000').replace(/[dD]/g, 'e'));
    const constraint = namelistValue(raw, 'system', 'constrained_magnetization', 'none');
    if (expert ? total !== -10000 || constraint !== 'none' : draft.spin && draft.magnetizationConstraint === 'total' && draft.totalMagnetization !== -10000) return 'QE 7.5 bands.x does not support constrained magnetization. Select unconstrained magnetization for this band workflow; keep the constrained SCF as a separate calculation.';
  }
  if (calculation === 'Structural relaxation') {
    const raw = draft.rawInput ?? '';
    const variableCell = expert ? namelistValue(raw, 'control', 'calculation', '') === 'vc-relax' : draft.relaxCell;
    if (variableCell) {
      const cell = expert ? namelistValue(raw, 'cell', 'cell_dynamics', 'bfgs') : draft.cellDynamics ?? 'bfgs';
      const ions = expert ? namelistValue(raw, 'ions', 'ion_dynamics', 'bfgs') : draft.ionDynamics ?? 'bfgs';
      const required = cell === 'bfgs' ? 'bfgs' : 'damp';
      if (ions !== required) return `Variable-cell ${cell} requires ion_dynamics=${required}. QE ignores the selected ${ions} optimizer in this combination. Select ${required}, or choose fixed-cell relaxation to use ${ions}.`;
    }
  }
  if (calculation === 'Phonon dispersion') {
    const raw = expert ? draft.rawInput ?? '' : '';
    if ((!expert && draft.functional === 'HSE') || /input_dft\s*=\s*['"](?:HSE|PBE0|B3LYP|HF)[^'"]*['"]/i.test(raw)) return 'QE 7.5 ph.x does not support hybrid DFPT. Select PBE/LDA or use a separately validated finite-displacement workflow.';
    if ((!expert && draft.vdwCorrection === 'ts-vdw') || /vdw_corr\s*=\s*['"]ts-vdw['"]/i.test(raw)) return 'QE 7.5 ph.x does not support TS-vdW DFPT. Select a supported correction or a separately validated phonon workflow.';
  }
  if (calculation === 'Thermoelectric properties') {
    if (draft.transportScatteringModel !== 'constant-relaxation-time') return 'Constant mean free path transport is unavailable: the runtime currently supports constant relaxation time only. Select that model.';
    if ([draft.transportChemicalPotentialStep, draft.transportDopingMin, draft.transportDopingMax, draft.transportDopingPoints].some((value) => value !== undefined)) return 'This saved transport draft contains unsupported doping or imposed chemical-potential step settings. Reset transport sampling to the native chemical-potential grid before running.';
    for (const [key, label, minimum, maximum] of [
      ['transportInterpolationMultiplier', 'Interpolation multiplier', 1, 12],
      ['transportEnergyBins', 'Energy bins', 500, 50000],
      ['transportTemperatureMin', 'Minimum temperature', 1, Number.MAX_SAFE_INTEGER],
      ['transportTemperatureMax', 'Maximum temperature', 1, Number.MAX_SAFE_INTEGER],
      ['transportTemperatureStep', 'Temperature step', 1, Number.MAX_SAFE_INTEGER],
    ] as const) {
      const value = draft[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum || value > maximum)) return `${label} must be a whole number from ${minimum} to ${maximum}. The requested value will not be rounded or reduced.`;
    }
    if ((draft.transportTemperatureMax ?? 900) < (draft.transportTemperatureMin ?? 100)) return 'Maximum temperature must be at least the minimum temperature.';
    if (draft.transportRelaxationTime !== undefined && (!Number.isFinite(draft.transportRelaxationTime) || draft.transportRelaxationTime <= 0)) return 'Relaxation time must be finite and positive in fs.';
    const minimum = draft.transportChemicalPotentialMin ?? -0.5;
    const maximum = draft.transportChemicalPotentialMax ?? 0.5;
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) return 'The chemical-potential window requires finite values with minimum below maximum in eV.';
  }
  return null;
}

export function supportedTransportSettings<T extends Parameters<typeof qeMethodIssue>[0]>(draft: T) {
  const issue = qeMethodIssue(draft, 'Thermoelectric properties');
  if (issue) throw new Error(issue);
  const result: Record<string, unknown> = { ...draft, transportSampling: 'chemical-potential' };
  for (const name of ['transportChemicalPotentialStep', 'transportDopingMin', 'transportDopingMax', 'transportDopingPoints']) delete result[name];
  return result;
}
