/** Present reported solver evidence independently from process completion. */
export function qeConvergenceDescription(summary?: Record<string, unknown>) {
  if (!summary) return '';
  if (!Array.isArray(summary.stageConvergence) || !summary.stageConvergence.length) return 'Per-stage convergence evidence unavailable. Observable refinement and physical validation have not been assessed.';
  const numeric = (value: unknown, unit: string) => typeof value === 'number' && Number.isFinite(value) ? `${value.toExponential(3)} ${unit}` : 'not reported';
  const lines = summary.stageConvergence.map((value) => {
    if (!value || typeof value !== 'object') return 'Unrecognized stage evidence; review the retained logs.';
    const stage = value as Record<string, unknown>;
    const thresholds = stage.thresholds && typeof stage.thresholds === 'object' ? stage.thresholds as Record<string, unknown> : {};
    const geometry = stage.ionicConvergence === 'not-applicable' ? '' : `; ions ${String(stage.ionicConvergence ?? 'not-reported')}; cell ${String(stage.cellConvergence ?? 'not-reported')}`;
    const residuals = [
      `SCF residual ${numeric(stage.scfResidualRy, 'Ry')} (effective threshold ${numeric(stage.scfAccuracy && typeof stage.scfAccuracy === 'object' ? (stage.scfAccuracy as Record<string, unknown>).thresholdRy : thresholds.conv_thr, 'Ry')})`,
      `maximum atomic force ${numeric(stage.maximumForceRyBohr, 'Ry/Bohr')} (threshold ${numeric(thresholds.forc_conv_thr, 'Ry/Bohr')})`,
      `pressure ${numeric(stage.pressureKbar, 'kbar')} (target ${numeric(thresholds.press, 'kbar')}; threshold ${numeric(thresholds.press_conv_thr, 'kbar')})`,
    ];
    const stress = Array.isArray(stage.stressTensorKbar) ? `; stress tensor (kbar) ${JSON.stringify(stage.stressTensorKbar)}` : '';
    return `${String(stage.stage ?? stage.log ?? 'Stage')}: electronic ${String(stage.electronicConvergence ?? 'not-reported')}; EXX ${String(stage.hybridConvergence ?? 'not-reported')}${geometry}; JOB DONE ${stage.jobDone === true ? 'yes' : 'no'}; ${residuals.join('; ')}${stress}; stopping reason ${String(stage.stoppingReason ?? 'not reported')}`;
  });
  return [...lines, 'Solver convergence concerns the configured thresholds. Observable refinement, magnetic ground state and physical validation remain separate study evidence.'].join('\n');
}
/** Only positive retained evidence qualifies a relaxation as a structure source. */
export function qeRelaxationConverged(summary?: Record<string, unknown>) {
  if (summary?.converged !== true || summary.geometryConverged !== true || summary.jobDone !== true || !Array.isArray(summary.stageConvergence)) return false;
  const stages = summary.stageConvergence.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'));
  const relaxations = stages.filter(stage => stage.calculationMode === 'relax' || stage.calculationMode === 'vc-relax');
  return relaxations.length === 1 && relaxations.every(stage => stage.jobDone === true
    && stage.electronicConvergence === 'converged'
    && qeScfAccuracyAccepted(stage)
    && stage.ionicConvergence === 'converged'
    && stage.cellConvergence === (stage.calculationMode === 'vc-relax' ? 'converged' : 'not-applicable'));
}

/** Validate numeric proof as well as its declared status, including EXX. */
export function qeScfAccuracyAccepted(stage: Record<string, unknown>) {
  const evidence = stage.scfAccuracy;
  if (!evidence || typeof evidence !== 'object') return false;
  const accuracy = evidence as Record<string, unknown>;
  const { residualRy, residualUpperRy, thresholdRy } = accuracy;
  if (accuracy.status !== 'verified' || typeof residualRy !== 'number' || !Number.isFinite(residualRy)
    || typeof residualUpperRy !== 'number' || !Number.isFinite(residualUpperRy)
    || typeof thresholdRy !== 'number' || !Number.isFinite(thresholdRy)
    || !(0 <= residualRy && residualRy <= residualUpperRy && residualUpperRy < thresholdRy)) return false;
  if (!['qe-stage-xml', 'qe-log-bound'].includes(String(accuracy.source))) return false;
  if (accuracy.source === 'qe-stage-xml' && (typeof accuracy.xmlPath !== 'string' || typeof accuracy.xmlSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(accuracy.xmlSha256))) return false;
  return ['converged', 'not-applicable'].includes(String(stage.hybridConvergence))
    && (stage.hybridFunctional !== true || stage.hybridConvergence === 'converged');
}

/** Every required solver stage must provide positive retained completion evidence. */
export function qeResultAccepted(summary: Record<string, unknown> | undefined, calculationType: string) {
  if (summary?.converged !== true || summary.jobDone !== true || !Array.isArray(summary.stageConvergence)) return false;
  const required: Record<string, string[]> = {
    'Nudged elastic band': ['neb'],
    'Total energy': ['scf'], 'Structural relaxation': ['relax'],
    'Band structure': ['scf', 'bands-nscf', 'bands-postprocess'],
    'Density of states': ['scf', 'dos-nscf'],
    'Phonon dispersion': ['scf', 'phonon', 'force-constants', 'phonon-dispersion'],
    'Thermoelectric properties': ['scf', 'nscf-transport'],
  };
  const expected = required[calculationType];
  if (!expected) return false;
  const stages = summary.stageConvergence as Array<Record<string, unknown>>;
  if (stages.some(stage => !stage || typeof stage !== 'object' || typeof stage.stage !== 'string')) return false;
  const names = stages.map(stage => String(stage.stage));
  const optional = calculationType === 'Density of states' ? ['dos-postprocess', 'projected-dos'] : calculationType === 'Band structure' ? ['projected-bands'] : [];
  if (new Set(names).size !== names.length || expected.some(name => !names.includes(name)) || names.some(name => ![...expected, ...optional].includes(name)) || (calculationType === 'Density of states' && !optional.some(name => names.includes(name)))) return false;
  const modes: Record<string, string[]> = { scf: ['scf'], relax: ['relax', 'vc-relax'], 'bands-nscf': ['bands', 'nscf'], 'dos-nscf': ['nscf'], 'nscf-transport': ['nscf'], phonon: ['phonon'] };
  return stages.every(stage => {
    const name = String(stage.stage);
    if (stage.jobDone !== true || stage.solverError === true) return false;
    if (modes[name] && !modes[name].includes(String(stage.calculationMode))) return false;
    if (name === 'neb') { const rows = stage.imageConvergence as Array<Record<string, unknown>>; const error = stage.maximumPathErrorEvAngstrom, threshold = stage.pathThresholdEvAngstrom; return stage.calculationMode === 'neb' && stage.pathConverged === true && typeof error === 'number' && typeof threshold === 'number' && Number.isFinite(error) && Number.isFinite(threshold) && threshold > 0 && error >= 0 && error <= threshold && Array.isArray(rows) && rows.length >= 3 && rows.length <= 32 && rows.every((r,i) => !!r && typeof r === 'object' && r.image === i+1 && r.electronicConverged === true && qeScfAccuracyAccepted(r) && /^[a-f0-9]{64}$/.test(String(r.sha256))); }
    if (name === 'scf' || name === 'relax') return stage.electronicConvergence === 'converged' && qeScfAccuracyAccepted(stage) && (name !== 'relax' || qeRelaxationConverged(summary));
    if (name === 'phonon') return stage.phononResponseConvergence === 'converged';
    if (name.endsWith('-nscf') || name === 'nscf-transport') return stage.electronicConvergence === 'diagonalization-completed';
    return stage.calculationMode == null;
  });
}
