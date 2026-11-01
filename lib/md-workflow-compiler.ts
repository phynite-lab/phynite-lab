import type { MdSimulationConfig, MdSimulationComponentInstance, MdSimulationWorkflowV2, MdWorkflowStep, MdWorkflowStepKind } from './md-simulation-types.ts';

/** Shared scientific conversion without UI/runtime dependencies. */
export function workflowStepKindForRecipe(config: MdSimulationConfig): MdWorkflowStepKind {
  if (config.recipeId === 'equilibration') return config.ensemble;
  if (config.recipeId === 'melting') return 'annealing';
  return config.recipeId;
}

export function mdComponentToWorkflowStep(component: MdSimulationComponentInstance): MdWorkflowStep {
  const config = component.config;
  const base = {
    id: component.id,
    name: component.name,
    enabled: component.selected,
    ...(config.directives?.length ? { directives: structuredClone(config.directives) } : {}),
  };
  const dynamics = { timestepFs: config.timestepFs, totalSteps: config.totalSteps };
  const temperature = { ...dynamics, tempStartK: config.tempStartK, tempEndK: config.tempEndK, tempDampingPs: config.tempDampingPs ?? Math.max(config.timestepFs * 0.1, 0.01) };
  const kind = workflowStepKindForRecipe(config);
  switch (kind) {
    case 'minimization': return { ...base, kind, params: { style: config.minimizeStyle ?? 'cg', energyTolerance: config.energyTolerance ?? 1e-8, forceTolerance: config.forceTolerance ?? 1e-10, maxIterations: config.maxIterations ?? 10_000, maxEvaluations: config.maxEvaluations ?? 100_000 } };
    case 'velocity': return { ...base, kind, params: { temperatureK: config.tempStartK, velocitySeed: config.velocitySeed } };
    case 'nve': return { ...base, kind, params: dynamics };
    case 'nvt': return { ...base, kind, params: temperature };
    case 'npt': return { ...base, kind, params: { ...temperature, pressureBar: config.pressureBar, pressureEndBar: config.pressureEndBar ?? config.pressureBar, pressureDampingPs: config.pressureDampingPs ?? Math.max(config.timestepFs, 0.1) } };
    case 'nph':
    case 'pressure-ramp': return { ...base, kind, params: { ...dynamics, pressureBar: config.pressureBar, pressureEndBar: config.pressureEndBar ?? config.pressureBar, pressureDampingPs: config.pressureDampingPs ?? Math.max(config.timestepFs, 0.1) } };
    case 'langevin': return { ...base, kind, params: { ...dynamics, tempStartK: config.tempStartK, tempEndK: config.tempEndK, frictionDampingPs: config.frictionDampingPs ?? 0.1, velocitySeed: config.velocitySeed } };
    case 'temp-berendsen': return { ...base, kind, params: temperature };
    case 'press-berendsen': return { ...base, kind, params: { ...dynamics, pressureBar: config.pressureBar, pressureEndBar: config.pressureEndBar ?? config.pressureBar, pressureDampingPs: config.pressureDampingPs ?? Math.max(config.timestepFs, 0.1) } };
    case 'heating':
    case 'cooling':
    case 'annealing': return { ...base, kind, params: temperature };
    case 'tensile': return { ...base, kind, params: { ...temperature, axis: config.tensileAxis, strainRatePerSecond: config.strainRate, maxStrain: config.maxStrain } };
    case 'compression': return { ...base, kind, params: { ...temperature, axis: config.compressionAxis, strainRatePerSecond: config.compressionRate, maxStrain: config.maxCompressionStrain } };
    case 'shear': return { ...base, kind, params: { ...temperature, shearPlane: config.shearPlane, strainRatePerSecond: config.shearRate, maxStrain: config.maxShearStrain } };
    case 'diffusion': return { ...base, kind, params: temperature };
    case 'rdf': return { ...base, kind, params: { ...temperature, bins: config.rdfBins ?? 200, cutoffAngstrom: config.rdfCutoffAngstrom ?? 8, sampleEvery: config.sampleFrequency ?? config.thermoFrequency } };
    case 'vacf': return { ...base, kind, params: { ...dynamics, sampleEvery: config.sampleFrequency ?? config.thermoFrequency } };
    case 'coordination':
    case 'cna': return { ...base, kind, params: { cutoffAngstrom: config.analysisCutoffAngstrom ?? 3.5 } };
    case 'centrosymmetry': return { ...base, kind, params: { neighbors: config.analysisNeighbors ?? 12 } };
    case 'voronoi':
    case 'stress-atom':
    case 'pe-atom':
    case 'ke-atom': return { ...base, kind, params: {} };
    case 'restart': return { ...base, kind, params: { label: config.restartLabel ?? 'checkpoint' } };
  }
}

export function compileMdSimulationWorkflow(components: MdSimulationComponentInstance[], options: Partial<Pick<MdSimulationWorkflowV2, 'mode' | 'boundaryType' | 'potential' | 'manualBody' | 'output'>> = {}, fallback?: MdSimulationConfig): MdSimulationWorkflowV2 {
  const first = components[0]?.config ?? fallback;
  if (!first) throw new Error('Configure at least one MD stage.');
  let manualBody = options.manualBody;
  let isManual = options.mode ? options.mode === 'manual' : components.some((component) => component.config.mode === 'manual');

  if (manualBody === undefined) {
    if (components.length === 1) {
      const singleManual = (first.manualBody ?? '').trim();
      if (singleManual) {
        manualBody = first.manualBody;
        isManual = true;
      } else {
        isManual = options.mode ? options.mode === 'manual' : first.mode === 'manual';
      }
    } else if (components.length > 1) {
      const anyManual = components.some((c) => Boolean((c.config.manualBody ?? '').trim()));
      if (anyManual) {
        manualBody = components
          .filter((c) => c.selected !== false)
          .map((c) => (c.config.manualBody ?? '').trim() || generateMdStepInputPreview(c.config))
          .join("\n\n");
        isManual = true;
      } else {
        isManual = options.mode ? options.mode === 'manual' : first.mode === 'manual';
      }
    } else {
      isManual = options.mode ? options.mode === 'manual' : first.mode === 'manual';
    }
  } else if ((manualBody ?? '').trim()) {
    isManual = options.mode ? options.mode === 'manual' : true;
  }

  return {
    version: 2,
    mode: isManual ? 'manual' : 'guided',
    units: 'metal',
    boundaryType: options.boundaryType ?? first.boundaryType,
    potential: options.potential ?? (first.potentialAssetId ? { kind: 'project', assetId: first.potentialAssetId } : { kind: 'builtin', id: 'lj-generic', epsilonEv: first.epsilonEv, sigmaAngstrom: first.sigmaAngstrom, cutoffAngstrom: first.cutoffRadiusAngstrom }),
    steps: components.map(mdComponentToWorkflowStep),
    ...(manualBody ? { manualBody } : {}),
    output: options.output ?? { thermoFrequency: first.thermoFrequency, dumpFrequency: first.dumpFrequency, ...(first.restartEverySteps !== undefined ? { restartEverySteps: first.restartEverySteps } : {}), ...(first.productionStartPs !== undefined && first.productionEndPs !== undefined ? { productionWindow: { startPs: first.productionStartPs, endPs: first.productionEndPs } } : {}) },
  };
}

export function generateMdStepInputPreview(config: MdSimulationConfig): string {
  const timestepPs = Number((config.timestepFs / 1000).toPrecision(10));
  const common = [`# ${config.name}`, `timestep ${timestepPs}`];
  const thermostatDamping = config.tempDampingPs ?? Number((timestepPs * 100).toPrecision(8));
  const barostatDamping = config.pressureDampingPs ?? Number((timestepPs * 1000).toPrecision(8));
  const thermalIntegrator = `fix phynite_integrator all nvt temp ${config.tempStartK} ${config.tempEndK} ${thermostatDamping}`;
  switch (workflowStepKindForRecipe(config)) {
    case 'minimization':
      return [`# ${config.name}`, `min_style ${config.minimizeStyle ?? 'cg'}`, `minimize ${config.energyTolerance ?? 1e-8} ${config.forceTolerance ?? 1e-10} ${config.maxIterations ?? 10_000} ${config.maxEvaluations ?? 100_000}`].join('\n');
    case 'velocity':
      return [`# ${config.name}`, `velocity all create ${config.tempStartK} ${config.velocitySeed} mom yes rot yes dist gaussian`].join('\n');
    case 'nve':
      return [...common, 'fix phynite_integrator all nve', `run ${config.totalSteps}`, 'unfix phynite_integrator'].join('\n');
    case 'nvt':
      return [...common, `fix phynite_thermostat all nvt temp ${config.tempStartK} ${config.tempEndK} ${thermostatDamping}`, `run ${config.totalSteps}`, 'unfix phynite_thermostat'].join('\n');
    case 'npt':
      return [...common, `fix phynite_barostat all npt temp ${config.tempStartK} ${config.tempEndK} ${thermostatDamping} iso ${config.pressureBar} ${config.pressureEndBar ?? config.pressureBar} ${barostatDamping}`, `run ${config.totalSteps}`, 'unfix phynite_barostat'].join('\n');
    case 'nph':
    case 'pressure-ramp':
      return [...common, `fix phynite_barostat all nph iso ${config.pressureBar} ${config.pressureEndBar ?? config.pressureBar} ${barostatDamping}`, `run ${config.totalSteps}`, 'unfix phynite_barostat'].join('\n');
    case 'langevin':
      return [...common, 'fix phynite_integrator all nve', `fix phynite_thermostat all langevin ${config.tempStartK} ${config.tempEndK} ${config.frictionDampingPs ?? 0.1} ${config.velocitySeed} zero yes`, `run ${config.totalSteps}`, 'unfix phynite_thermostat', 'unfix phynite_integrator'].join('\n');
    case 'temp-berendsen':
      return [...common, 'fix phynite_integrator all nve', `fix phynite_thermostat all temp/berendsen ${config.tempStartK} ${config.tempEndK} ${thermostatDamping}`, `run ${config.totalSteps}`, 'unfix phynite_thermostat', 'unfix phynite_integrator'].join('\n');
    case 'press-berendsen':
      return [...common, 'fix phynite_integrator all nve', `fix phynite_barostat all press/berendsen iso ${config.pressureBar} ${config.pressureEndBar ?? config.pressureBar} ${barostatDamping}`, `run ${config.totalSteps}`, 'unfix phynite_barostat', 'unfix phynite_integrator'].join('\n');
    case 'heating':
    case 'cooling':
      return [...common, `fix phynite_thermal_ramp all nvt temp ${config.tempStartK} ${config.tempEndK} ${thermostatDamping}`, `run ${config.totalSteps}`, 'unfix phynite_thermal_ramp'].join('\n');
    case 'annealing':
      {
        const phases: Array<[string, number, number, number]> = config.totalSteps === 1
          ? [['heat', config.tempStartK, config.tempEndK, 1]]
          : config.totalSteps === 2
            ? [['heat', config.tempStartK, config.tempEndK, 1], ['cool', config.tempEndK, config.tempStartK, 1]]
            : (() => {
              const heat = Math.max(1, Math.floor(config.totalSteps * 2 / 5));
              let hold = Math.max(1, Math.floor(config.totalSteps / 5));
              let cool = config.totalSteps - heat - hold;
              if (cool < 1) { hold -= 1; cool = 1; }
              return [['heat', config.tempStartK, config.tempEndK, heat], ['hold', config.tempEndK, config.tempEndK, hold], ['cool', config.tempEndK, config.tempStartK, cool]] as Array<[string, number, number, number]>;
            })();
        return [...common, ...phases.flatMap(([id, start, end, steps]) => [
          `fix phynite_${id} all nvt temp ${start} ${end} ${thermostatDamping}`, `run ${steps}`, `unfix phynite_${id}`,
        ])].join('\n');
      }
    case 'tensile':
      return [...common, thermalIntegrator, `fix phynite_deform all deform 1 ${config.tensileAxis} erate ${config.strainRate * 1e-12} units box remap x`, `run ${config.totalSteps}`, 'unfix phynite_deform', 'unfix phynite_integrator'].join('\n');
    case 'compression':
      return [...common, thermalIntegrator, `fix phynite_deform all deform 1 ${config.compressionAxis} erate ${-Math.abs(config.compressionRate * 1e-12)} units box remap x`, `run ${config.totalSteps}`, 'unfix phynite_deform', 'unfix phynite_integrator'].join('\n');
    case 'shear':
      return [...common, thermalIntegrator, `fix phynite_deform all deform 1 ${config.shearPlane} erate ${config.shearRate * 1e-12} units box remap x`, `run ${config.totalSteps}`, 'unfix phynite_deform', 'unfix phynite_integrator'].join('\n');
    case 'diffusion':
      return [...common, '# Phynite adds the named MSD file consumer in the executed input.', 'compute phynite_msd all msd com yes', `fix phynite_msd_output all ave/time ${config.thermoFrequency} 1 ${config.thermoFrequency} c_phynite_msd[4]`, thermalIntegrator, `run ${config.totalSteps}`, 'unfix phynite_integrator', 'unfix phynite_msd_output', 'uncompute phynite_msd'].join('\n');
    case 'rdf':
      return [...common, '# Phynite adds the named RDF file consumer in the executed input.', `comm_modify cutoff ${(config.rdfCutoffAngstrom ?? 8) + 2}`, `compute phynite_rdf all rdf ${config.rdfBins ?? 200} cutoff ${config.rdfCutoffAngstrom ?? 8}`, `fix phynite_rdf_output all ave/time ${config.sampleFrequency ?? config.thermoFrequency} 1 ${config.sampleFrequency ?? config.thermoFrequency} c_phynite_rdf[*] mode vector`, thermalIntegrator, `run ${config.totalSteps}`, 'unfix phynite_integrator', 'unfix phynite_rdf_output', 'uncompute phynite_rdf'].join('\n');
    case 'vacf':
      return [...common, '# Phynite adds the named VACF file consumer in the executed input.', 'compute phynite_vacf all vacf', `fix phynite_vacf_output all ave/time ${config.sampleFrequency ?? config.thermoFrequency} 1 ${config.sampleFrequency ?? config.thermoFrequency} c_phynite_vacf[1] c_phynite_vacf[2] c_phynite_vacf[3] c_phynite_vacf[4]`, 'fix phynite_integrator all nve', `run ${config.totalSteps}`, 'unfix phynite_integrator', 'unfix phynite_vacf_output', 'uncompute phynite_vacf'].join('\n');
    case 'coordination':
      return [`# ${config.name}`, `compute phynite_coordination all coord/atom cutoff ${config.analysisCutoffAngstrom ?? 3.5}`, 'run 0 post no', 'uncompute phynite_coordination'].join('\n');
    case 'cna':
      return [`# ${config.name}`, `compute phynite_cna all cna/atom ${config.analysisCutoffAngstrom ?? 3.5}`, 'run 0 post no', 'uncompute phynite_cna'].join('\n');
    case 'centrosymmetry':
      return [`# ${config.name}`, `compute phynite_centrosymmetry all centro/atom ${config.analysisNeighbors ?? 12}`, 'run 0 post no', 'uncompute phynite_centrosymmetry'].join('\n');
    case 'voronoi':
      return [`# ${config.name}`, 'compute phynite_voronoi all voronoi/atom', 'run 0 post no', 'uncompute phynite_voronoi'].join('\n');
    case 'stress-atom':
      return [`# ${config.name}`, 'compute phynite_stress all stress/atom NULL', 'run 0 post no', 'uncompute phynite_stress'].join('\n');
    case 'pe-atom':
      return [`# ${config.name}`, 'compute phynite_pe all pe/atom', 'run 0 post no', 'uncompute phynite_pe'].join('\n');
    case 'ke-atom':
      return [`# ${config.name}`, 'compute phynite_ke all ke/atom', 'run 0 post no', 'uncompute phynite_ke'].join('\n');
    case 'restart':
      return [`# ${config.name}`, '# Checkpoint output remains managed by Phynite.', 'run 0 post no'].join('\n');
  }
}
