'use client';

import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  FileCode2,
  FileUp,
  GripVertical,
  Play,
  Plus,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CommittedNumberInput } from '@/components/CommittedNumberInput';
import { LabConfigurationDrawer } from '@/components/LabConfigurationDrawer';
import { UiSelect } from '@/components/UiSelect';
import {
  compileMdDirectiveBlocks,
  compileMdDirectiveBlock,
  createMdDirectiveShortcut,
  defaultMdDirectiveBlocks,
  deleteMdDirectiveBlock,
  duplicateMdDirectiveBlock,
  MD_DIRECTIVE_BLOCK_LABELS,
  MD_DIRECTIVE_SHORTCUTS,
  mdDirectiveBlockTitle,
  reorderMdDirectiveBlocks,
  validateMdDirectiveBlock,
  validateMdDirectiveBlocks,
} from '@/lib/md-directives';
import {
  MD_FORCE_FIELD_PRESETS,
  MD_SIMULATION_RECIPES,
  generateMdStepInputPreview,
  mdMechanicalStrainPlan,
  validateMdManualBody,
  validateMdSimulationConfig,
  type MdPotentialAsset,
  type MdDirectiveBlock,
  type MdSimulationComponentInstance,
  type MdSimulationConfig,
  type MdSimulationMode,
} from '@/lib/md-simulation-types';
import { cn } from '@/lib/utils';

function SectionTitle({ children, detail, code }: { children: React.ReactNode; detail?: string; code?: string }) {
  return (
    <div className="mb-2.5 flex min-w-0 items-baseline justify-between gap-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="shrink-0 font-sans text-[11px] font-semibold tracking-[-0.01em] text-[var(--surface-text)]">
          {children}
        </h3>
        {detail && <span className="min-w-0 truncate font-sans text-[10px] text-[var(--surface-muted)]">{detail}</span>}
      </div>
      {code && <code className="shrink-0 font-mono text-[9px] text-[var(--surface-muted)]">{code}</code>}
    </div>
  );
}

function NumberField({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="md-number-field block min-w-0 font-sans">
      <span className="block truncate text-[11px] font-normal text-[var(--surface-muted)]">{label}</span>
      <span className="md-number-control mt-1.5 flex h-9 min-w-0 items-center overflow-hidden rounded-[6px] border border-[var(--surface-border)] bg-[var(--surface-bg)] focus-within:border-[var(--field-focus-border)] transition-colors">
        <CommittedNumberInput
          value={value}
          min={min}
          max={max}
          step={step}
          onCommit={onChange}
          className="md-number-input min-w-0 flex-1 border-0 bg-transparent px-2.5 font-mono text-[11px] text-[var(--surface-text)] outline-none focus:ring-0"
        />
        {unit && <span className="md-number-unit shrink-0 font-mono text-[9px] text-[var(--surface-muted)]">{unit}</span>}
      </span>
    </label>
  );
}

function TextField({
  label,
  value,
  mono = false,
  onChange,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0 overflow-hidden font-sans">
      <span className="block truncate text-[11px] font-normal text-[var(--surface-muted)]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'mt-1.5 h-9 w-full min-w-0 rounded-[6px] border border-[var(--surface-border)] bg-[var(--surface-bg)] px-2.5 text-[11px] text-[var(--surface-text)] outline-none focus:border-[var(--field-focus-border)] transition-colors',
          mono ? 'font-mono' : 'font-sans'
        )}
      />
    </label>
  );
}

function ConfigSection({
  title,
  code,
  detail,
  children,
  className,
}: {
  title: string;
  code?: string;
  detail?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('md-drawer-form-section p-3.5', className)}>
      <SectionTitle detail={detail} code={code}>{title}</SectionTitle>
      <div className="md-drawer-field-grid">{children}</div>
    </section>
  );
}

type PotentialChoice = { id: string; label: string; detail: string; ready: boolean; asset?: MdPotentialAsset };

function PotentialPicker({
  selectedId,
  assets,
  mappedElements,
  onChange,
  onUpload,
}: {
  selectedId?: string;
  assets: MdPotentialAsset[];
  mappedElements: string[];
  onChange: (assetId?: string) => void;
  onUpload?: (files: File[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const choices = useMemo<PotentialChoice[]>(() => [
    { id: 'builtin:lj-generic', label: MD_FORCE_FIELD_PRESETS[0].name, detail: 'Built-in · Ar, Kr, Xe, Generic', ready: true },
    ...assets.map((asset) => ({
      id: `asset:${asset.id}`,
      label: asset.name,
      detail: `${asset.family.toUpperCase()} · ${asset.elements.join(', ')} · ${asset.files.map((file) => file.filename).join(' + ')}`,
      ready: asset.status === 'READY',
      asset,
    })),
  ], [assets]);

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return choices.filter((choice) => terms.every((term) => `${choice.label} ${choice.detail} ${choice.asset?.citation ?? ''}`.toLowerCase().includes(term)));
  }, [choices, query]);

  const selected = choices.find((choice) => choice.id === (selectedId ? `asset:${selectedId}` : 'builtin:lj-generic')) ?? choices[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    queueMicrotask(() => inputRef.current?.focus());
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div ref={wrapRef} className="md-potential-picker col-span-full relative font-sans">
      <span className="block truncate text-[11px] font-normal text-[var(--surface-muted)]">Potential</span>
      <button
        type="button"
        className="mt-1.5 flex h-9 w-full items-center justify-between rounded-[6px] border border-[var(--surface-border)] bg-[var(--surface-bg)] px-2.5 text-left transition-colors hover:border-[var(--field-focus-border)]"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1 truncate">
          <strong className="block truncate font-sans text-[11px] font-semibold text-[var(--surface-text)]">{selected.label}</strong>
          <small className="block truncate font-sans text-[10px] text-[var(--surface-muted)]">{selected.detail}</small>
        </span>
        <ChevronDown size={14} className="shrink-0 text-[var(--surface-muted)]" />
      </button>
      <button type="button" className="mt-2 text-xs underline" onClick={() => window.dispatchEvent(new Event('phynite:browse-potentials'))}>Public repositories · NIST / OpenKIM</button>
      {open && (
        <div className="md-potential-popover">
          <label className="md-picker-search">
            <Search size={14} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIndex((index) => Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const choice = filtered[activeIndex];
                  if (choice?.ready) { onChange(choice.asset?.id); setOpen(false); }
                }
              }}
              placeholder="Search family, element, file, or citation"
              aria-label="Search potentials"
            />
          </label>
          <div role="listbox" aria-label="Project potentials" className="md-potential-list">
            {filtered.map((choice, index) => {
              const mapped = !choice.asset || (mappedElements.length > 0 && mappedElements.every(element => choice.asset?.elements.includes(element)));
              return (
                <button
                  key={choice.id}
                  type="button"
                  role="option"
                  aria-selected={choice.id === selected.id}
                  aria-disabled={!choice.ready}
                  data-highlighted={index === activeIndex || undefined}
                  disabled={!choice.ready}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => { onChange(choice.asset?.id); setOpen(false); }}
                >
                  <span className="md-potential-status">
                    {choice.id === selected.id ? <Check size={13} /> : choice.ready ? <ShieldCheck size={13} /> : <AlertCircle size={13} />}
                  </span>
                  <span>
                    <strong>{choice.label}</strong>
                    <small>{choice.detail}{!choice.ready ? ' · upload incomplete' : ''}</small>
                    {choice.asset && (
                      <small className="md-potential-checks">
                        <i data-ready={choice.ready}>Integrity</i>
                        <i data-ready={mapped}>Elements</i>
                        <i data-ready={!!choice.asset.runtimeValidatedAt}>Runtime</i>
                      </small>
                    )}
                  </span>
                </button>
              );
            })}
            {!filtered.length && <p>No matching potential in this project.</p>}
          </div>
          {onUpload && (
            <>
              <button type="button" className="md-potential-upload" onClick={() => uploadRef.current?.click()}>
                <FileUp size={13} /> Upload potential files
              </button>
              <input
                ref={uploadRef}
                hidden
                multiple
                type="file"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length) onUpload(files);
                  event.target.value = '';
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

const snippets = [
  { label: 'Run steps', query: 'run steps execute', code: 'run 10000' },
  { label: 'Minimization', query: 'minimize relax geometry fire cg sd', code: 'minimize 1.0e-8 1.0e-10 10000 100000' },
  { label: 'Velocity Maxwell', query: 'velocity create initial thermal maxwell', code: 'velocity all create 300 12345 mom yes rot yes dist gaussian' },
  { label: 'Thermostat NVT', query: 'fix nvt thermostat canonical', code: 'fix thermostat all nvt temp 300 300 0.1\nrun 10000\nunfix thermostat' },
  { label: 'Barostat NPT', query: 'fix npt barostat pressure isobaric', code: 'fix barostat all npt temp 300 300 0.1 iso 1.0 1.0 1.0\nrun 10000\nunfix barostat' },
  { label: 'Tensile strain', query: 'fix deform tensile uniaxial strain', code: 'fix deformation all deform 1 z erate 0.0001 units box remap x\nrun 10000\nunfix deformation' },
  { label: 'MSD Diffusion', query: 'compute msd diffusion mean squared', code: 'compute displacement all msd com yes\nrun 10000\nuncompute displacement' },
  { label: 'Radial distribution (RDF)', query: 'compute rdf pair correlation g(r)', code: 'compute pair_rdf all rdf 200\nrun 10000\nuncompute pair_rdf' },
];

function potentialInputLines(config: MdSimulationConfig, asset: MdPotentialAsset | undefined, mappedElements: string[]): string[] {
  if (!config.potentialAssetId || !asset) {
    return [
      `pair_style lj/cut ${config.cutoffRadiusAngstrom}`,
      `pair_coeff * * ${config.epsilonEv} ${config.sigmaAngstrom} ${config.cutoffRadiusAngstrom}`,
    ];
  }
  const mapping = mappedElements.join(' ') || asset.elements.join(' ');
  const potentialFile = asset.files.find((file) => file.role === 'potential')?.filename;
  if (asset.family === 'meam') {
    const library = asset.files.find((file) => file.role === 'library')?.filename ?? '<library-file>';
    const parameter = asset.files.find((file) => file.role === 'parameter')?.filename ?? '<parameter-file>';
    return ['pair_style meam', `pair_coeff * * potential/${library} ${mapping} potential/${parameter} ${mapping}`];
  }
  const filename = `potential/${potentialFile ?? asset.files[0]?.filename ?? '<potential-file>'}`;
  if (asset.family === 'eam') return ['pair_style eam', `pair_coeff * * ${filename}`];
  const style = asset.family === 'eam-alloy' ? 'eam/alloy' : asset.family;
  return [`pair_style ${style}`, `pair_coeff * * ${filename} ${mapping}`];
}

function generateFinalInputPreview(config: MdSimulationConfig, generatedInput: string, asset: MdPotentialAsset | undefined, mappedElements: string[]): string {
  let commands = (config.manualBody ?? '').trim();
  if (!commands && config.mode === 'manual' && config.directives?.length) {
    try {
      commands = compileMdDirectiveBlocks(config.directives);
    } catch (error) {
      commands = `# Block compilation stopped: ${error instanceof Error ? error.message : 'Invalid LAMMPS block configuration.'}`;
    }
  }
  if (!commands) commands = generatedInput;
  return [
    '# Generated by Phynite MD Lab local runtime',
    '# Source, output, and provenance are managed by Phynite.',
    'units metal',
    'dimension 3',
    `boundary ${config.boundaryType}`,
    'atom_style atomic',
    'read_data data.structure',
    ...(config.recipeId === 'shear' ? ['change_box all triclinic'] : []),
    ...potentialInputLines(config, asset, mappedElements),
    'neighbor 2.0 bin',
    'neigh_modify delay 0 every 1 check yes',
    `thermo ${config.thermoFrequency}`,
    'thermo_style custom step time temp press pe ke etotal vol lx ly lz xy xz yz pxx pyy pzz pxy pxz pyz',
    'thermo_modify flush yes lost error',
    `dump phynite all custom ${config.dumpFrequency} trajectory.lammpstrj id type x y z vx vy vz`,
    'dump_modify phynite sort id first yes',
    '# Begin simulation commands',
    commands.trim(),
    '# End simulation commands',
    'dump_modify phynite first yes',
    'run 0 post no',
    'write_restart final.restart',
  ].join('\n');
}

function OutputEvidenceControls({ config, onChange }: { config: MdSimulationConfig; onChange: (patch: Partial<MdSimulationConfig>) => void }) {
  return <>
    <NumberField label="Periodic restart interval" value={config.restartEverySteps ?? 10000} unit="steps" min={1} max={100_000_000} onChange={(restartEverySteps) => onChange({ restartEverySteps })} />
    <label className="col-span-full flex items-center gap-2 text-xs"><input type="checkbox" checked={config.productionStartPs !== undefined} onChange={event => onChange(event.target.checked ? { productionStartPs: 0, productionEndPs: config.timestepFs * config.totalSteps / 1000 } : { productionStartPs: undefined, productionEndPs: undefined })} />Choose production window for sampling evidence</label>
    {config.productionStartPs !== undefined && <><NumberField label="Production start" value={config.productionStartPs} unit="ps" min={0} max={1e12} step={.1} onChange={productionStartPs => onChange({ productionStartPs })} /><NumberField label="Production end" value={config.productionEndPs ?? 0} unit="ps" min={0} max={1e12} step={.1} onChange={productionEndPs => onChange({ productionEndPs })} /></>}
    <p className="col-span-full text-[10px] text-[var(--surface-muted)]">Choose an equilibrated physical-time window across the workflow. Restart files retain solver state; continuing thermostat/barostat state requires the recorded runtime and expert replay instructions.</p>
  </>;
}

function GuidedConfiguration({
  config,
  assets,
  mappedElements,
  onChange,
  onSelectPotential,
  onUploadPotential,
}: {
  config: MdSimulationConfig;
  assets: MdPotentialAsset[];
  mappedElements: string[];
  onChange: (patch: Partial<MdSimulationConfig>) => void;
  onSelectPotential?: (assetId?: string) => void;
  onUploadPotential?: (files: File[]) => void;
}) {
  const kind = config.recipeId;
  const staticAnalysis = ['coordination', 'cna', 'centrosymmetry', 'voronoi', 'stress-atom', 'pe-atom', 'ke-atom'].includes(kind);
  const isDynamics = !['minimization', 'velocity', 'restart'].includes(kind) && !staticAnalysis;
  const hasTemperature = ['velocity', 'nvt', 'npt', 'langevin', 'temp-berendsen', 'heating', 'cooling', 'annealing', 'equilibration', 'melting', 'tensile', 'compression', 'shear', 'diffusion'].includes(kind);
  const hasRamp = ['heating', 'cooling', 'annealing', 'melting'].includes(kind);
  const mechanicalPlan = mdMechanicalStrainPlan(config);

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <ConfigSection title="Identity & Boundary">
        <TextField label="Step name" value={config.name} onChange={(name) => onChange({ name })} />
        <UiSelect
          label="Boundary"
          value={config.boundaryType}
          options={[
            { value: 'p p p', label: 'Periodic · xyz (Bulk 3D)' },
            { value: 'p p f', label: 'Periodic · xy (Slab 2D)' },
            { value: 'p f p', label: 'Periodic · xz (Slab 2D)' },
            { value: 'f p p', label: 'Periodic · yz (Slab 2D)' },
            { value: 'p f f', label: 'Periodic · x (Wire 1D)' },
            { value: 'f p f', label: 'Periodic · y (Wire 1D)' },
            { value: 'f f p', label: 'Periodic · z (Wire 1D)' },
            { value: 'f f f', label: 'Fixed (Isolated)' },
          ]}
          onChange={(boundaryType) => onChange({ boundaryType: boundaryType as MdSimulationConfig['boundaryType'] })}
          mono
        />
      </ConfigSection>

      <ConfigSection title="Interatomic Potential" detail={config.potentialAssetId ? 'Asset potential' : 'LJ fallback'}>
        <PotentialPicker
          selectedId={config.potentialAssetId}
          assets={assets}
          mappedElements={mappedElements}
          onChange={(assetId) => { onChange({ potentialAssetId: assetId }); onSelectPotential?.(assetId); }}
          onUpload={onUploadPotential}
        />
        {!config.potentialAssetId && (
          <>
            <NumberField label="LJ epsilon" value={config.epsilonEv} unit="eV" min={1e-12} max={1000} step={0.0001} onChange={(epsilonEv) => onChange({ epsilonEv })} />
            <NumberField label="LJ sigma" value={config.sigmaAngstrom} unit="Å" min={1e-6} max={1000} step={0.1} onChange={(sigmaAngstrom) => onChange({ sigmaAngstrom })} />
            <NumberField label="LJ cutoff" value={config.cutoffRadiusAngstrom} unit="Å" min={config.sigmaAngstrom} max={10_000} step={0.1} onChange={(cutoffRadiusAngstrom) => onChange({ cutoffRadiusAngstrom })} />
          </>
        )}
      </ConfigSection>

      <ConfigSection title="Simulation Parameters" code={(MD_SIMULATION_RECIPES.find((recipe) => recipe.id === kind) ?? MD_SIMULATION_RECIPES[0]).code}>
        {kind === 'minimization' && (
          <>
            <UiSelect
              label="Minimizer"
              value={config.minimizeStyle ?? 'cg'}
              options={[
                { value: 'cg', label: 'Conjugate gradient' },
                { value: 'fire', label: 'FIRE' },
                { value: 'sd', label: 'Steepest descent' },
              ]}
              onChange={(minimizeStyle) => onChange({ minimizeStyle: minimizeStyle as NonNullable<MdSimulationConfig['minimizeStyle']> })}
              mono
            />
            <NumberField label="Energy tolerance" value={config.energyTolerance ?? 1e-8} min={0} max={1} step={1e-8} onChange={(energyTolerance) => onChange({ energyTolerance })} />
            <NumberField label="Force tolerance" value={config.forceTolerance ?? 1e-10} min={0} max={1} step={1e-10} onChange={(forceTolerance) => onChange({ forceTolerance })} />
            <NumberField label="Maximum iterations" value={config.maxIterations ?? 10_000} min={1} max={10_000_000} onChange={(maxIterations) => onChange({ maxIterations })} />
            <NumberField label="Maximum evaluations" value={config.maxEvaluations ?? 100_000} min={1} max={100_000_000} onChange={(maxEvaluations) => onChange({ maxEvaluations })} />
          </>
        )}
        {kind === 'velocity' && (
          <NumberField label="Velocity seed" value={config.velocitySeed} min={1} max={2_147_483_646} onChange={(velocitySeed) => onChange({ velocitySeed })} />
        )}
        {kind === 'restart' && (
          <TextField label="Checkpoint label" value={config.restartLabel ?? 'checkpoint'} mono onChange={(restartLabel) => onChange({ restartLabel: restartLabel.replace(/[^A-Za-z0-9_-]/g, '') })} />
        )}
        {isDynamics && (
          <>
            <NumberField label="Timestep" value={config.timestepFs} unit="fs" min={0.0001} max={100} step={0.1} onChange={(timestepFs) => onChange({ timestepFs })} />
            <NumberField label="Steps" value={config.totalSteps} unit="steps" min={1} max={100_000_000} onChange={(totalSteps) => onChange({ totalSteps })} />
          </>
        )}
        {hasTemperature && (
          <NumberField label={hasRamp ? 'Start temperature' : 'Temperature'} value={config.tempStartK} unit="K" min={0} max={100_000} onChange={(tempStartK) => onChange(hasRamp ? { tempStartK } : { tempStartK, tempEndK: tempStartK })} />
        )}
        {hasRamp && (
          <NumberField label="End temperature" value={config.tempEndK} unit="K" min={0} max={100_000} onChange={(tempEndK) => onChange({ tempEndK })} />
        )}
        {['nvt', 'npt', 'heating', 'cooling', 'annealing', 'equilibration', 'melting', 'tensile', 'compression', 'shear', 'diffusion', 'rdf'].includes(kind) && (
          <NumberField label="Temperature damping" value={config.tempDampingPs ?? Math.max(config.timestepFs * 0.1, 0.01)} unit="ps" min={1e-6} max={10_000} step={0.01} onChange={(tempDampingPs) => onChange({ tempDampingPs })} />
        )}
        {(kind === 'npt' || (kind === 'equilibration' && config.ensemble === 'npt')) && (
          <>
            <NumberField label="Start pressure" value={config.pressureBar} unit="bar" min={-1_000_000} max={1_000_000} onChange={(pressureBar) => onChange({ pressureBar })} />
            <NumberField label="End pressure" value={config.pressureEndBar ?? config.pressureBar} unit="bar" min={-1_000_000} max={1_000_000} onChange={(pressureEndBar) => onChange({ pressureEndBar })} />
            <NumberField label="Pressure damping" value={config.pressureDampingPs ?? Math.max(config.timestepFs, 0.1)} unit="ps" min={1e-6} max={100_000} step={0.1} onChange={(pressureDampingPs) => onChange({ pressureDampingPs })} />
          </>
        )}
        {['nph', 'press-berendsen', 'pressure-ramp'].includes(kind) && (
          <>
            <NumberField label="Start pressure" value={config.pressureBar} unit="bar" min={-1_000_000} max={1_000_000} onChange={(pressureBar) => onChange({ pressureBar })} />
            <NumberField label="End pressure" value={config.pressureEndBar ?? config.pressureBar} unit="bar" min={-1_000_000} max={1_000_000} onChange={(pressureEndBar) => onChange({ pressureEndBar })} />
            <NumberField label="Pressure damping" value={config.pressureDampingPs ?? Math.max(config.timestepFs, 0.1)} unit="ps" min={1e-6} max={100_000} step={0.1} onChange={(pressureDampingPs) => onChange({ pressureDampingPs })} />
          </>
        )}
        {kind === 'langevin' && (
          <>
            <NumberField label="Friction damping" value={config.frictionDampingPs ?? 0.1} unit="ps" min={1e-6} max={10_000} step={0.01} onChange={(frictionDampingPs) => onChange({ frictionDampingPs })} />
            <NumberField label="Random seed" value={config.velocitySeed} min={1} max={2_147_483_646} onChange={(velocitySeed) => onChange({ velocitySeed })} />
          </>
        )}
        {kind === 'equilibration' && (
          <UiSelect
            label="Ensemble"
            value={config.ensemble}
            options={['nve', 'nvt', 'npt'].map((value) => ({ value, label: value.toUpperCase() }))}
            onChange={(ensemble) => onChange({ ensemble: ensemble as MdSimulationConfig['ensemble'] })}
            mono
          />
        )}
        {kind === 'tensile' && (
          <>
            <UiSelect label="Axis" value={config.tensileAxis} options={['x', 'y', 'z'].map((value) => ({ value, label: value.toUpperCase() }))} onChange={(tensileAxis) => onChange({ tensileAxis: tensileAxis as MdSimulationConfig['tensileAxis'] })} mono />
            <NumberField label="Strain rate" value={config.strainRate} unit="s⁻¹" min={1e-12} max={1e18} onChange={(strainRate) => onChange({ strainRate })} />
            <NumberField label="Safety limit" value={config.maxStrain} unit="ratio" min={1e-9} max={10} step={0.01} onChange={(maxStrain) => onChange({ maxStrain })} />
          </>
        )}
        {kind === 'compression' && (
          <>
            <UiSelect label="Axis" value={config.compressionAxis} options={['x', 'y', 'z'].map((value) => ({ value, label: value.toUpperCase() }))} onChange={(compressionAxis) => onChange({ compressionAxis: compressionAxis as MdSimulationConfig['compressionAxis'] })} mono />
            <NumberField label="Strain rate" value={config.compressionRate} unit="s⁻¹" min={1e-12} max={1e18} onChange={(compressionRate) => onChange({ compressionRate })} />
            <NumberField label="Safety limit" value={config.maxCompressionStrain} unit="ratio" min={1e-9} max={10} step={0.01} onChange={(maxCompressionStrain) => onChange({ maxCompressionStrain })} />
          </>
        )}
        {kind === 'shear' && (
          <>
            <UiSelect label="Shear plane" value={config.shearPlane} options={['xy', 'xz', 'yz'].map((value) => ({ value, label: value.toUpperCase() }))} onChange={(shearPlane) => onChange({ shearPlane: shearPlane as MdSimulationConfig['shearPlane'] })} mono />
            <NumberField label="Shear rate" value={config.shearRate} unit="s⁻¹" min={1e-12} max={1e18} onChange={(shearRate) => onChange({ shearRate })} />
            <NumberField label="Safety limit" value={config.maxShearStrain} unit="ratio" min={1e-9} max={10} step={0.01} onChange={(maxShearStrain) => onChange({ maxShearStrain })} />
          </>
        )}
        {kind === 'rdf' && (
          <>
            <NumberField label="RDF bins" value={config.rdfBins ?? 200} min={10} max={10_000} onChange={(rdfBins) => onChange({ rdfBins })} />
            <NumberField label="RDF cutoff" value={config.rdfCutoffAngstrom ?? 8} unit="Å" min={1e-6} max={10_000} step={0.1} onChange={(rdfCutoffAngstrom) => onChange({ rdfCutoffAngstrom })} />
          </>
        )}
        {['rdf', 'vacf'].includes(kind) && (
          <NumberField label="Sampling interval" value={config.sampleFrequency ?? config.thermoFrequency} unit="steps" min={1} max={Math.max(1, config.totalSteps)} onChange={(sampleFrequency) => onChange({ sampleFrequency })} />
        )}
        {['coordination', 'cna'].includes(kind) && (
          <NumberField label="Neighbor cutoff" value={config.analysisCutoffAngstrom ?? 3.5} unit="Å" min={1e-6} max={10_000} step={0.1} onChange={(analysisCutoffAngstrom) => onChange({ analysisCutoffAngstrom })} />
        )}
        {kind === 'centrosymmetry' && (
          <UiSelect label="Nearest neighbors" value={String(config.analysisNeighbors ?? 12)} options={[2, 4, 6, 8, 10, 12, 14, 16, 18, 20].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => onChange({ analysisNeighbors: Number(value) })} mono />
        )}
        {mechanicalPlan && (
          <div className="col-span-full rounded-[6px] border border-[var(--surface-border)] bg-[var(--surface-bg)] p-2.5 text-[10px] text-[var(--surface-muted)]">
            <span className="font-semibold text-[var(--surface-text)]">Planned strain: </span>
            <code className="font-mono font-semibold text-[var(--accent)]">{mechanicalPlan.planned.toPrecision(4)}</code>
            <span className="mt-0.5 block text-[9px]">The runtime converts s⁻¹ to ps⁻¹ and blocks runs above the configured safety limit.</span>
          </div>
        )}
      </ConfigSection>

      <ConfigSection title="Output & Trajectory" code="thermo · dump">
        <NumberField label="Thermo interval" value={config.thermoFrequency} unit="steps" min={1} max={Math.max(1, config.totalSteps)} onChange={(thermoFrequency) => onChange({ thermoFrequency })} />
        <NumberField label="Trajectory interval" value={config.dumpFrequency} unit="steps" min={1} max={Math.max(1, config.totalSteps)} onChange={(dumpFrequency) => onChange({ dumpFrequency })} />
        <OutputEvidenceControls config={config} onChange={onChange} />
      </ConfigSection>
    </div>
  );
}

type AdvancedSection = 'ensemble' | 'potential' | 'physics' | 'directives';

function AdvancedConfiguration({
  config,
  assets,
  mappedElements,
  runDisabledReason,
  onChange,
  onSelectPotential,
  onUploadPotential,
}: {
  config: MdSimulationConfig;
  assets: MdPotentialAsset[];
  mappedElements: string[];
  runDisabledReason?: string;
  onChange: (patch: Partial<MdSimulationConfig>) => void;
  onSelectPotential?: (assetId?: string) => void;
  onUploadPotential?: (files: File[]) => void;
}) {
  const [section, setSection] = useState<AdvancedSection>('ensemble');
  const isOverridden = Boolean((config.manualBody ?? '').trim());
  const manualValidation = isOverridden ? validateMdManualBody(config.manualBody ?? '') : '';
  const isDockerIssue = Boolean(runDisabledReason && runDisabledReason.toLowerCase().includes('docker'));

  const simulatedTimePs = ((config.timestepFs * config.totalSteps) / 1000).toFixed(2);

  const appendDirective = (code: string) => {
    const current = config.manualBody ?? '';
    const next = `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${code}\n`;
    onChange({ manualBody: next });
  };

  const sections: Array<{ id: AdvancedSection; label: string; icon: typeof SlidersHorizontal }> = [
    { id: 'ensemble', label: 'ENSEMBLE', icon: SlidersHorizontal },
    { id: 'potential', label: 'POTENTIAL', icon: ShieldCheck },
    { id: 'physics', label: 'PHYSICS', icon: Cpu },
    { id: 'directives', label: 'DIRECTIVES', icon: FileCode2 },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col md-advanced-container">
      <nav
        aria-label="LAMMPS parameter sections"
        className="config-manual-nav md-advanced-nav grid shrink-0 grid-cols-4 gap-1 border-b border-[var(--surface-border)] bg-[var(--surface-bg)] p-1.5"
      >
        {sections.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => setSection(item.id)}
              className={cn(
                'config-manual-tab flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-1.5 font-sans text-[11px] font-medium text-[var(--surface-muted)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--surface-text)]',
                active && 'bg-[#232323] font-semibold text-[#f4f4f5]'
              )}
            >
              <Icon size={14} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="md-advanced-body min-w-0 flex-1 overflow-y-auto">
        <div className="space-y-3 p-3 sm:p-4">
          {section === 'ensemble' && (
            <>
              <ConfigSection title="Integrator & Ensemble" code="fix">
                <UiSelect
                  label="Ensemble"
                  value={config.ensemble}
                  options={[
                    { value: 'nve', label: 'NVE · Microcanonical' },
                    { value: 'nvt', label: 'NVT · Canonical (Thermostat)' },
                    { value: 'npt', label: 'NPT · Isobaric-isothermal (Barostat)' },
                    { value: 'nph', label: 'NPH · Isobaric-isoenthalpic' },
                    { value: 'langevin', label: 'Langevin stochastic dynamics' },
                  ]}
                  onChange={(ensemble) => onChange({ ensemble: ensemble as MdSimulationConfig['ensemble'] })}
                  mono
                />
                <NumberField label="Timestep" value={config.timestepFs} unit="fs" min={0.0001} max={100} step={0.1} onChange={(timestepFs) => onChange({ timestepFs })} />
                <NumberField label="Total steps" value={config.totalSteps} unit="steps" min={1} max={100_000_000} onChange={(totalSteps) => onChange({ totalSteps })} />
                <div className="col-span-full flex items-center gap-2 rounded-[6px] border border-[var(--surface-border)] bg-[var(--surface-bg)] px-3 py-2 text-[10px]">
                  <span className="text-[var(--surface-muted)]">Simulated duration:</span>
                  <strong className="font-mono text-[11px] text-[var(--surface-text)]">{simulatedTimePs} ps</strong>
                  <span className="text-[9px] text-[var(--surface-muted)]">({(Number(simulatedTimePs) / 1000).toFixed(4)} ns)</span>
                </div>
              </ConfigSection>

              <ConfigSection title="Temperature Controls" code="fix nvt / langevin">
                <NumberField label="Start temperature" value={config.tempStartK} unit="K" min={0} max={100_000} onChange={(tempStartK) => onChange({ tempStartK })} />
                <NumberField label="Target temperature" value={config.tempEndK} unit="K" min={0} max={100_000} onChange={(tempEndK) => onChange({ tempEndK })} />
                <NumberField label="Temperature damping (Tdamp)" value={config.tempDampingPs ?? 0.1} unit="ps" min={1e-6} max={10_000} step={0.01} onChange={(tempDampingPs) => onChange({ tempDampingPs })} />
                <NumberField label="Velocity random seed" value={config.velocitySeed} min={1} max={2_147_483_646} onChange={(velocitySeed) => onChange({ velocitySeed })} />
              </ConfigSection>

              <ConfigSection title="Pressure Controls" code="fix npt / nph">
                <NumberField label="Start pressure" value={config.pressureBar} unit="bar" min={-1_000_000} max={1_000_000} onChange={(pressureBar) => onChange({ pressureBar })} />
                <NumberField label="Target pressure" value={config.pressureEndBar ?? config.pressureBar} unit="bar" min={-1_000_000} max={1_000_000} onChange={(pressureEndBar) => onChange({ pressureEndBar })} />
                <NumberField label="Pressure damping (Pdamp)" value={config.pressureDampingPs ?? 1.0} unit="ps" min={1e-6} max={100_000} step={0.1} onChange={(pressureDampingPs) => onChange({ pressureDampingPs })} />
              </ConfigSection>
            </>
          )}

          {section === 'potential' && (
            <>
              <ConfigSection title="Boundary Conditions" code="boundary">
                <UiSelect
                  label="Periodic boundary condition"
                  value={config.boundaryType}
                  options={[
                    { value: 'p p p', label: 'Periodic · xyz (Bulk 3D crystal)' },
                    { value: 'p p f', label: 'Periodic · xy (2D slab / surface)' },
                    { value: 'p f p', label: 'Periodic · xz (2D slab / surface)' },
                    { value: 'f p p', label: 'Periodic · yz (2D slab / surface)' },
                    { value: 'p f f', label: 'Periodic · x (Wire 1D)' },
                    { value: 'f p f', label: 'Periodic · y (Wire 1D)' },
                    { value: 'f f p', label: 'Periodic · z (Wire 1D)' },
                    { value: 'f f f', label: 'Fixed · Non-periodic (Isolated cluster / molecule)' },
                  ]}
                  onChange={(boundaryType) => onChange({ boundaryType: boundaryType as MdSimulationConfig['boundaryType'] })}
                  mono
                />
                <div className="col-span-full flex items-center gap-2 rounded-[6px] border border-[var(--surface-border)] bg-[var(--surface-bg)] px-3 py-2 text-[10px]">
                  <span className="text-[var(--surface-muted)]">Box symmetry:</span>
                  <strong className="font-mono text-[10px] text-[var(--surface-text,var(--ink))] font-medium">{config.recipeId === 'shear' ? 'Triclinic box tilt enabled' : 'Orthogonal / General triclinic'}</strong>
                </div>
              </ConfigSection>

              <ConfigSection title="Interatomic Potential" code="pair_style">
                <PotentialPicker
                  selectedId={config.potentialAssetId}
                  assets={assets}
                  mappedElements={mappedElements}
                  onChange={(assetId) => { onChange({ potentialAssetId: assetId }); onSelectPotential?.(assetId); }}
                  onUpload={onUploadPotential}
                />
                {!config.potentialAssetId && (
                  <>
                    <NumberField label="Lennard-Jones epsilon (well depth)" value={config.epsilonEv} unit="eV" min={1e-12} max={1000} step={0.0001} onChange={(epsilonEv) => onChange({ epsilonEv })} />
                    <NumberField label="Lennard-Jones sigma (collision diameter)" value={config.sigmaAngstrom} unit="Å" min={1e-6} max={1000} step={0.1} onChange={(sigmaAngstrom) => onChange({ sigmaAngstrom })} />
                    <NumberField label="Pair potential cutoff radius" value={config.cutoffRadiusAngstrom} unit="Å" min={config.sigmaAngstrom} max={10_000} step={0.1} onChange={(cutoffRadiusAngstrom) => onChange({ cutoffRadiusAngstrom })} />
                  </>
                )}
              </ConfigSection>

              <ConfigSection title="Neighbor List Configuration" code="neighbor / neigh_modify">
                <div className="col-span-full flex flex-wrap gap-2 text-[10px] text-[var(--surface-muted)]">
                  <span className="rounded border border-[var(--surface-border)] bg-[var(--surface-bg)] px-2 py-1 font-mono text-[9px] text-[var(--surface-text)]">skin 2.0 Å</span>
                  <span className="rounded border border-[var(--surface-border)] bg-[var(--surface-bg)] px-2 py-1 font-mono text-[9px] text-[var(--surface-text)]">style bin (O(N))</span>
                  <span className="rounded border border-[var(--surface-border)] bg-[var(--surface-bg)] px-2 py-1 font-mono text-[9px] text-[var(--surface-text)]">delay 0 every 1 check yes</span>
                </div>
              </ConfigSection>
            </>
          )}

          {section === 'physics' && (
            <>
              <ConfigSection title="Geometry Minimization" code="minimize">
                <UiSelect
                  label="Minimization algorithm"
                  value={config.minimizeStyle ?? 'cg'}
                  options={[
                    { value: 'cg', label: 'Conjugate gradient (cg)' },
                    { value: 'fire', label: 'FIRE (Fast Inertial Relaxation)' },
                    { value: 'sd', label: 'Steepest descent (sd)' },
                  ]}
                  onChange={(minimizeStyle) => onChange({ minimizeStyle: minimizeStyle as NonNullable<MdSimulationConfig['minimizeStyle']> })}
                  mono
                />
                <NumberField label="Energy tolerance (etol)" value={config.energyTolerance ?? 1e-8} min={0} max={1} step={1e-8} onChange={(energyTolerance) => onChange({ energyTolerance })} />
                <NumberField label="Force tolerance (ftol)" value={config.forceTolerance ?? 1e-10} min={0} max={1} step={1e-10} onChange={(forceTolerance) => onChange({ forceTolerance })} />
                <NumberField label="Max iteration steps" value={config.maxIterations ?? 10_000} min={1} max={10_000_000} onChange={(maxIterations) => onChange({ maxIterations })} />
                <NumberField label="Max force evaluations" value={config.maxEvaluations ?? 100_000} min={1} max={100_000_000} onChange={(maxEvaluations) => onChange({ maxEvaluations })} />
              </ConfigSection>

              <ConfigSection title="Mechanical Deformation" code="fix deform">
                <UiSelect label="Tensile deformation axis" value={config.tensileAxis} options={['x', 'y', 'z'].map((v) => ({ value: v, label: v.toUpperCase() }))} onChange={(tensileAxis) => onChange({ tensileAxis: tensileAxis as MdSimulationConfig['tensileAxis'] })} mono />
                <NumberField label="Tensile engineering strain rate" value={config.strainRate} unit="s⁻¹" min={1e-12} max={1e18} onChange={(strainRate) => onChange({ strainRate })} />
                <NumberField label="Tensile max safety strain" value={config.maxStrain} unit="ratio" min={1e-9} max={10} step={0.01} onChange={(maxStrain) => onChange({ maxStrain })} />
              </ConfigSection>

              <ConfigSection title="Structural Analysis" code="compute rdf / msd">
                <NumberField label="RDF histogram bins" value={config.rdfBins ?? 200} min={10} max={10_000} onChange={(rdfBins) => onChange({ rdfBins })} />
                <NumberField label="RDF cutoff radius" value={config.rdfCutoffAngstrom ?? 8} unit="Å" min={1e-6} max={10_000} step={0.1} onChange={(rdfCutoffAngstrom) => onChange({ rdfCutoffAngstrom })} />
                <NumberField label="Sampling interval" value={config.sampleFrequency ?? config.thermoFrequency} unit="steps" min={1} max={Math.max(1, config.totalSteps)} onChange={(sampleFrequency) => onChange({ sampleFrequency })} />
              </ConfigSection>
            </>
          )}

          {section === 'directives' && (
            <>
              <ConfigSection title="Logging & Output" code="thermo / dump">
                <NumberField label="Thermodynamic log interval" value={config.thermoFrequency} unit="steps" min={1} max={Math.max(1, config.totalSteps)} onChange={(thermoFrequency) => onChange({ thermoFrequency })} />
                <NumberField label="Trajectory dump interval" value={config.dumpFrequency} unit="steps" min={1} max={Math.max(1, config.totalSteps)} onChange={(dumpFrequency) => onChange({ dumpFrequency })} />
                <TextField label="Checkpoint restart label" value={config.restartLabel ?? 'checkpoint'} mono onChange={(restartLabel) => onChange({ restartLabel: restartLabel.replace(/[^A-Za-z0-9_-]/g, '') })} />
                <OutputEvidenceControls config={config} onChange={onChange} />
                <div className="col-span-full space-y-2 border-t border-[var(--surface-border)] pt-2.5">
                  <span className="block text-[10px] font-semibold text-[var(--surface-text)]">Thermodynamic properties recorded:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {['step', 'time', 'temp', 'press', 'pe', 'ke', 'etotal', 'vol', 'lx', 'ly', 'lz', 'pxx', 'pyy', 'pzz'].map((prop) => (
                      <span key={prop} className="rounded border border-[var(--surface-border)] bg-[var(--surface-bg)] px-2 py-0.5 font-mono text-[9px] text-[var(--surface-muted)]">
                        {prop}
                      </span>
                    ))}
                  </div>
                  <span className="mt-2 block text-[10px] font-semibold text-[var(--surface-text)]">Trajectory atom attributes:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {['id', 'type', 'x', 'y', 'z', 'vx', 'vy', 'vz'].map((col) => (
                      <span key={col} className="rounded border border-[var(--surface-border)] bg-[var(--surface-bg)] px-2 py-0.5 font-mono text-[9px] text-[#58a6ff]">
                        {col}
                      </span>
                    ))}
                    <span className="rounded border border-[var(--surface-border)] bg-[var(--surface-bg)] px-2 py-0.5 font-mono text-[9px] text-[#3fb950]">
                      sort id first yes
                    </span>
                  </div>
                </div>
              </ConfigSection>

              <ConfigSection title="Custom Directives" code="in.lammps" detail="Safe appended workflow">
                <div className="col-span-full flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] text-[var(--surface-muted)]">
                    Add extra custom LAMMPS fixes, computes, or variables appended safely to this step.
                  </p>
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold',
                    isOverridden ? 'border border-[var(--line-strong)] bg-[var(--surface-subtle)] text-[var(--surface-text,var(--ink))]' : 'border border-[var(--surface-border)] bg-[var(--surface-bg)] text-[var(--surface-muted)]'
                  )}>
                    {isOverridden ? 'Custom Directives Active' : 'Default Managed'}
                  </span>
                </div>

                <div className="col-span-full flex flex-wrap gap-1.5 py-1">
                  {snippets.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      className="rounded border border-[var(--surface-border)] bg-[var(--surface-bg)] px-2 py-1 text-[9px] font-medium text-[var(--surface-text)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--surface-text,var(--ink))]"
                      onClick={() => appendDirective(s.code)}
                    >
                      + {s.label}
                    </button>
                  ))}
                </div>

                <div className="col-span-full">
                  <textarea
                    aria-label="Custom LAMMPS directives"
                    spellCheck={false}
                    value={config.manualBody ?? ''}
                    onChange={(e) => onChange({ manualBody: e.target.value })}
                    placeholder="e.g. fix my_thermo all nvt temp 300 300 0.1&#10;run 10000"
                    className="h-32 w-full rounded-[6px] border border-[var(--surface-border)] bg-[var(--surface-bg)] p-2.5 font-mono text-[10px] text-[var(--surface-text)] outline-none focus:border-[var(--field-focus-border)]"
                  />
                </div>

                <div className="col-span-full flex flex-wrap items-center justify-between gap-2">
                  {manualValidation ? (
                    <p className="flex items-center gap-1.5 text-[10px] text-[var(--danger)]">
                      <AlertCircle size={13} className="shrink-0" />
                      <span>{manualValidation}</span>
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5 text-[10px] text-[var(--success)]">
                      <ShieldCheck size={13} className="shrink-0" />
                      <span>Directives pass syntax safety check.</span>
                    </p>
                  )}
                  {isOverridden && (
                    <button
                      type="button"
                      className="lab-secondary-button h-7 px-2 text-[9px]"
                      onClick={() => onChange({ manualBody: '' })}
                    >
                      Clear custom directives
                    </button>
                  )}
                </div>

                {isDockerIssue && (
                  <div className="col-span-full flex items-center gap-1.5 text-[10px] text-[var(--panel-accent)]">
                    <AlertCircle size={13} className="shrink-0" />
                    <span>Manual directives require personal-compute Docker runtime.</span>
                  </div>
                )}
              </ConfigSection>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LammpsBlockParameters({
  block,
  onPatch,
}: {
  block: MdDirectiveBlock;
  onPatch: (patch: Record<string, number | string>) => void;
}) {
  switch (block.kind) {
    case 'run':
      return <NumberField label="Steps" value={block.params.steps} min={0} max={100_000_000} onChange={(steps) => onPatch({ steps })} />;
    case 'minimize':
      return <>
        <UiSelect label="Algorithm" value={block.params.style} options={[{ value: 'cg', label: 'Conjugate gradient' }, { value: 'fire', label: 'FIRE' }, { value: 'sd', label: 'Steepest descent' }]} onChange={(style) => onPatch({ style })} mono />
        <NumberField label="Energy tolerance" value={block.params.energyTolerance} min={0} max={1} step={1e-8} onChange={(energyTolerance) => onPatch({ energyTolerance })} />
        <NumberField label="Force tolerance" value={block.params.forceTolerance} min={0} max={1} step={1e-10} onChange={(forceTolerance) => onPatch({ forceTolerance })} />
        <NumberField label="Maximum iterations" value={block.params.maxIterations} min={1} max={10_000_000} onChange={(maxIterations) => onPatch({ maxIterations })} />
        <NumberField label="Maximum evaluations" value={block.params.maxEvaluations} min={1} max={100_000_000} onChange={(maxEvaluations) => onPatch({ maxEvaluations })} />
      </>;
    case 'velocity':
      return <>
        <NumberField label="Temperature" value={block.params.temperatureK} unit="K" min={0} max={100_000} onChange={(temperatureK) => onPatch({ temperatureK })} />
        <NumberField label="Random seed" value={block.params.seed} min={1} max={2_147_483_646} onChange={(seed) => onPatch({ seed })} />
      </>;
    case 'thermostat':
      return <>
        <UiSelect label="Control" value={block.params.style} options={[{ value: 'nve', label: 'NVE · no thermostat' }, { value: 'nvt', label: 'NVT · Nosé-Hoover' }, { value: 'langevin', label: 'Langevin' }, { value: 'temp-berendsen', label: 'Berendsen' }]} onChange={(style) => onPatch({ style })} mono />
        <NumberField label="Timestep" value={block.params.timestepFs} unit="fs" min={0.0001} max={100} step={0.1} onChange={(timestepFs) => onPatch({ timestepFs })} />
        <NumberField label="Steps" value={block.params.totalSteps} min={0} max={100_000_000} onChange={(totalSteps) => onPatch({ totalSteps })} />
        <NumberField label="Start temperature" value={block.params.tempStartK} unit="K" min={0} max={100_000} onChange={(tempStartK) => onPatch({ tempStartK })} />
        <NumberField label="Target temperature" value={block.params.tempEndK} unit="K" min={0} max={100_000} onChange={(tempEndK) => onPatch({ tempEndK })} />
        <NumberField label="Damping" value={block.params.dampingPs} unit="ps" min={1e-6} max={10_000} step={0.01} onChange={(dampingPs) => onPatch({ dampingPs })} />
        {block.params.style === 'langevin' && <NumberField label="Random seed" value={block.params.seed} min={1} max={2_147_483_646} onChange={(seed) => onPatch({ seed })} />}
      </>;
    case 'barostat':
      return <>
        <UiSelect label="Control" value={block.params.style} options={[{ value: 'npt', label: 'NPT · temperature + pressure' }, { value: 'nph', label: 'NPH · pressure' }, { value: 'press-berendsen', label: 'Berendsen pressure' }]} onChange={(style) => onPatch({ style })} mono />
        <NumberField label="Timestep" value={block.params.timestepFs} unit="fs" min={0.0001} max={100} step={0.1} onChange={(timestepFs) => onPatch({ timestepFs })} />
        <NumberField label="Steps" value={block.params.totalSteps} min={0} max={100_000_000} onChange={(totalSteps) => onPatch({ totalSteps })} />
        {block.params.style === 'npt' && <><NumberField label="Start temperature" value={block.params.tempStartK} unit="K" min={0} max={100_000} onChange={(tempStartK) => onPatch({ tempStartK })} /><NumberField label="Target temperature" value={block.params.tempEndK} unit="K" min={0} max={100_000} onChange={(tempEndK) => onPatch({ tempEndK })} /><NumberField label="Temperature damping" value={block.params.tempDampingPs} unit="ps" min={1e-6} max={10_000} step={0.01} onChange={(tempDampingPs) => onPatch({ tempDampingPs })} /></>}
        <NumberField label="Start pressure" value={block.params.pressureStartBar} unit="bar" min={-1_000_000} max={1_000_000} onChange={(pressureStartBar) => onPatch({ pressureStartBar })} />
        <NumberField label="Target pressure" value={block.params.pressureEndBar} unit="bar" min={-1_000_000} max={1_000_000} onChange={(pressureEndBar) => onPatch({ pressureEndBar })} />
        <NumberField label="Pressure damping" value={block.params.pressureDampingPs} unit="ps" min={1e-6} max={100_000} step={0.1} onChange={(pressureDampingPs) => onPatch({ pressureDampingPs })} />
      </>;
    case 'deform': {
      const axisOptions = block.params.mode === 'shear' ? ['xy', 'xz', 'yz'] : ['x', 'y', 'z'];
      return <>
        <UiSelect label="Test" value={block.params.mode} options={[{ value: 'tensile', label: 'Tensile' }, { value: 'compression', label: 'Compression' }, { value: 'shear', label: 'Shear' }]} onChange={(mode) => onPatch({ mode, axis: mode === 'shear' ? 'xy' : 'z' })} />
        <UiSelect label={block.params.mode === 'shear' ? 'Plane' : 'Axis'} value={block.params.axis} options={axisOptions.map((axis) => ({ value: axis, label: axis.toUpperCase() }))} onChange={(axis) => onPatch({ axis })} mono />
        <NumberField label="Timestep" value={block.params.timestepFs} unit="fs" min={0.0001} max={100} step={0.1} onChange={(timestepFs) => onPatch({ timestepFs })} />
        <NumberField label="Steps" value={block.params.totalSteps} min={0} max={100_000_000} onChange={(totalSteps) => onPatch({ totalSteps })} />
        <NumberField label="Temperature" value={block.params.temperatureK} unit="K" min={0} max={100_000} onChange={(temperatureK) => onPatch({ temperatureK })} />
        <NumberField label="Temperature damping" value={block.params.tempDampingPs} unit="ps" min={1e-6} max={10_000} step={0.01} onChange={(tempDampingPs) => onPatch({ tempDampingPs })} />
        <NumberField label="Strain rate" value={block.params.strainRatePerSecond} unit="s⁻¹" min={1e-12} max={1e18} onChange={(strainRatePerSecond) => onPatch({ strainRatePerSecond })} />
        <NumberField label="Safety limit" value={block.params.maxStrain} unit="ratio" min={1e-9} max={10} step={0.01} onChange={(maxStrain) => onPatch({ maxStrain })} />
      </>;
    }
    case 'analysis': {
      const dynamic = ['msd', 'rdf', 'vacf'].includes(block.params.style);
      return <>
        <UiSelect label="Measurement" value={block.params.style} options={[
          ['msd', 'Mean squared displacement'], ['rdf', 'Radial distribution'], ['vacf', 'Velocity autocorrelation'], ['coordination', 'Coordination number'], ['cna', 'Common neighbor analysis'], ['centrosymmetry', 'Centrosymmetry'], ['voronoi', 'Voronoi'], ['stress-atom', 'Per-atom stress'], ['pe-atom', 'Potential energy / atom'], ['ke-atom', 'Kinetic energy / atom'],
        ].map(([value, label]) => ({ value, label }))} onChange={(style) => onPatch({ style })} />
        {dynamic && <NumberField label="Run steps" value={block.params.totalSteps} min={0} max={100_000_000} onChange={(totalSteps) => onPatch({ totalSteps })} />}
        {block.params.style === 'rdf' && <><NumberField label="Bins" value={block.params.bins} min={10} max={10_000} onChange={(bins) => onPatch({ bins })} /><NumberField label="Cutoff" value={block.params.cutoffAngstrom} unit="Å" min={1e-6} max={10_000} step={0.1} onChange={(cutoffAngstrom) => onPatch({ cutoffAngstrom })} /><NumberField label="Sample every" value={block.params.sampleEvery} unit="steps" min={1} max={Math.max(1, block.params.totalSteps)} onChange={(sampleEvery) => onPatch({ sampleEvery })} /></>}
        {['coordination', 'cna'].includes(block.params.style) && <NumberField label="Cutoff" value={block.params.cutoffAngstrom} unit="Å" min={1e-6} max={10_000} step={0.1} onChange={(cutoffAngstrom) => onPatch({ cutoffAngstrom })} />}
        {block.params.style === 'centrosymmetry' && <UiSelect label="Nearest neighbors" value={String(block.params.neighbors)} options={[2, 4, 6, 8, 10, 12, 14, 16, 18, 20].map((value) => ({ value: String(value), label: String(value) }))} onChange={(neighbors) => onPatch({ neighbors: Number(neighbors) })} mono />}
      </>;
    }
    case 'checkpoint':
      return <TextField label="Label" value={block.params.label} mono onChange={(label) => onPatch({ label: label.replace(/[^A-Za-z0-9_-]/g, '') })} />;
  }
}

function LammpsInputConfiguration({
  config,
  runDisabledReason,
  onChange,
}: {
  config: MdSimulationConfig;
  runDisabledReason?: string;
  onChange: (patch: Partial<MdSimulationConfig>) => void;
}) {
  const [fallbackBlocks] = useState(() => defaultMdDirectiveBlocks(config));
  const blocks = config.directives?.length ? config.directives : fallbackBlocks;
  const [editor, setEditor] = useState<'blocks' | 'expert'>(() => (config.manualBody ?? '').trim() ? 'expert' : 'blocks');
  const [addOpen, setAddOpen] = useState(false);
  const [draggedBlockId, setDraggedBlockId] = useState('');
  const blockValidation = validateMdDirectiveBlocks(blocks);
  const compiled = useMemo(() => {
    try { return compileMdDirectiveBlocks(blocks); } catch { return ''; }
  }, [blocks]);
  const hasExpertOverride = Boolean((config.manualBody ?? '').trim());
  const expertText = hasExpertOverride ? config.manualBody ?? '' : compiled;
  const expertValidation = hasExpertOverride ? validateMdManualBody(config.manualBody ?? '') : blockValidation;

  const commitBlocks = (next: MdDirectiveBlock[]) => onChange({ directives: next });
  const patchBlock = (id: string, patch: Record<string, number | string>) => commitBlocks(blocks.map((block) => block.id === id ? ({ ...block, params: { ...block.params, ...patch } } as MdDirectiveBlock) : block));
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    commitBlocks(next);
  };

  return <div className="md-block-composer">
    <div className="md-block-editor-tabs" role="tablist" aria-label="LAMMPS input editor">
      <button type="button" role="tab" aria-selected={editor === 'blocks'} onClick={() => setEditor('blocks')}><SlidersHorizontal size={14} /> Blocks <span>{blocks.length}</span></button>
      <button type="button" role="tab" aria-selected={editor === 'expert'} onClick={() => setEditor('expert')}><Terminal size={14} /> Expert {hasExpertOverride && <i>override</i>}</button>
    </div>

    {editor === 'blocks' ? <div className="md-block-workbench">
      <aside className="md-block-palette" aria-label="Add LAMMPS block">
        <strong>Command library</strong>
        <p>Add validated commands. Phynite keeps source, potential, and output ownership.</p>
        <div>
          {MD_DIRECTIVE_SHORTCUTS.map((shortcut) => <button key={shortcut.id} type="button" data-tone={shortcut.tone} onClick={() => commitBlocks([...blocks, createMdDirectiveShortcut(shortcut.id, config)])}><Plus size={12} /><span><b>{shortcut.label}</b><code>{shortcut.command}</code></span></button>)}
        </div>
      </aside>
      <section className="md-block-rack" aria-label="LAMMPS command rack">
        <header><span><strong>Simulation commands</strong><small>Executed from top to bottom</small></span><button type="button" className="lab-secondary-button md-block-add-mobile" aria-expanded={addOpen} onClick={() => setAddOpen((value) => !value)}><Plus size={13} /> Add block</button></header>
        {addOpen && <div className="md-block-mobile-palette">{MD_DIRECTIVE_SHORTCUTS.map((shortcut) => <button key={shortcut.id} type="button" onClick={() => { commitBlocks([...blocks, createMdDirectiveShortcut(shortcut.id, config)]); setAddOpen(false); }}>{shortcut.label}</button>)}</div>}
        <div className="md-block-stack">
          {blocks.map((block, index) => {
            const meta = MD_DIRECTIVE_BLOCK_LABELS[block.kind];
            const blockError = validateMdDirectiveBlock(block, index);
            const blockPreview = block.enabled && !blockError ? compileMdDirectiveBlock(block, index) : '';
            return <article
              key={block.id}
              className="md-command-block"
              data-tone={meta.tone}
              data-enabled={block.enabled}
              data-dragging={draggedBlockId === block.id || undefined}
              draggable
              onDragStart={(event) => { setDraggedBlockId(block.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', block.id); }}
              onDragOver={(event) => { if (draggedBlockId && draggedBlockId !== block.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
              onDrop={(event) => { event.preventDefault(); const sourceId = draggedBlockId || event.dataTransfer.getData('text/plain'); if (sourceId && sourceId !== block.id) commitBlocks(reorderMdDirectiveBlocks(blocks, sourceId, block.id)); setDraggedBlockId(''); }}
              onDragEnd={() => setDraggedBlockId('')}
            >
              <header>
                <GripVertical size={15} aria-label={`Drag ${mdDirectiveBlockTitle(block)} to reorder`} />
                <span><strong>{mdDirectiveBlockTitle(block)}</strong><code>{meta.command}</code></span>
                <button type="button" className="md-block-toggle" aria-pressed={block.enabled} onClick={() => commitBlocks(blocks.map((candidate) => candidate.id === block.id ? { ...candidate, enabled: !candidate.enabled } : candidate))}>{block.enabled ? 'On' : 'Off'}</button>
                <div className="md-block-actions">
                  <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${meta.label} up`}><ArrowUp size={13} /></button>
                  <button type="button" disabled={index === blocks.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${meta.label} down`}><ArrowDown size={13} /></button>
                  <button type="button" disabled={blocks.length >= 24} onClick={() => commitBlocks(duplicateMdDirectiveBlock(blocks, block.id, config))} aria-label={`Duplicate ${meta.label}`}><Copy size={13} /></button>
                  <button type="button" disabled={blocks.length === 1} onClick={() => commitBlocks(deleteMdDirectiveBlock(blocks, block.id))} aria-label={`Delete ${meta.label}`}><Trash2 size={13} /></button>
                </div>
              </header>
              <div className="md-command-block-fields"><LammpsBlockParameters block={block} onPatch={(patch) => patchBlock(block.id, patch)} /></div>
              {blockError ? <p className="md-command-block-error" role="alert"><AlertCircle size={12} />{blockError}</p> : block.enabled ? <pre className="md-command-block-preview" aria-label={`${mdDirectiveBlockTitle(block)} command preview`}><code>{blockPreview}</code></pre> : <p className="md-command-block-disabled">Disabled · retained but omitted from generated input</p>}
            </article>;
          })}
        </div>
        <footer data-valid={!blockValidation}>{blockValidation ? <><AlertCircle size={13} />{blockValidation}</> : <><ShieldCheck size={13} />{hasExpertOverride ? 'Blocks valid · Expert text currently controls this step.' : 'Blocks pass browser preflight.'}</>}</footer>
      </section>
    </div> : <div className="md-expert-editor">
      <div className="md-expert-heading">
        <span><strong>Expert LAMMPS commands</strong><small>Raw commands replace the block rack only after you edit this text.</small></span>
        <button type="button" className="lab-secondary-button" disabled={!hasExpertOverride} onClick={() => { onChange({ manualBody: '' }); setEditor('blocks'); }}>Regenerate from Blocks</button>
      </div>
      <textarea aria-label="Expert LAMMPS input" spellCheck={false} value={expertText} onChange={(event) => onChange({ manualBody: event.target.value })} />
      <div className="md-expert-status" data-valid={!expertValidation}>{expertValidation ? <><AlertCircle size={13} />{expertValidation}</> : <><ShieldCheck size={13} />{hasExpertOverride ? 'Expert input passes browser preflight and requires Docker isolation.' : 'Preview generated from validated blocks. Edit to create an Expert override.'}</>}</div>
      {runDisabledReason?.toLowerCase().includes('docker') && <p className="md-expert-runtime"><AlertCircle size={13} />Expert input requires the personal-compute Docker runtime.</p>}
    </div>}
  </div>;
}

// Kept referenced while older saved parameter tabs are migrated by the workflow
// round-trip; the visible LAMMPS input surface is the block composer above.
void AdvancedConfiguration;

function ScriptInspectorModal({
  open,
  code,
  stepName,
  portalTarget,
  onClose,
}: {
  open: boolean;
  code: string;
  stepName: string;
  portalTarget: Element;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []);
    requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0], last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="md-inspector-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="md-inspector-modal workspace-dark-surface" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Generated LAMMPS input preview">
        <header>
          <div>
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-[var(--panel-text)]" />
              <strong>Generated in.lammps ({stepName})</strong>
            </div>
            <span>Read-only managed input preview compiled from UI settings</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="lab-secondary-button" onClick={handleCopy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? 'Copied' : 'Copy script'}</span>
            </button>
            <button type="button" className="lab-icon-button" onClick={onClose} aria-label="Close inspector">
              <X size={14} />
            </button>
          </div>
        </header>
        <pre className="md-inspector-code"><code>{code}</code></pre>
      </div>
    </div>,
    portalTarget,
  );
}

export function MdSimulationConfigDrawer(props: {
  embedded?: boolean;
  component: MdSimulationComponentInstance;
  materialName: string;
  formula: string;
  totalAtoms: number;
  potentialAssets?: MdPotentialAsset[];
  mappedElements?: string[];
  generatedInput?: string;
  runDisabledReason?: string;
  onChange: (patch: Partial<MdSimulationConfig>) => void;
  onSelectPotential?: (assetId?: string) => void;
  onUploadPotential?: (files: File[]) => void;
  onSaveToLibrary?: () => void;
  onRunSimulation?: () => void;
  onClose: () => void;
}) {
  const {
    component,
    potentialAssets = [],
    mappedElements = [],
    generatedInput,
    runDisabledReason,
    onChange,
    onSelectPotential,
    onUploadPotential,
    onSaveToLibrary,
    onRunSimulation,
    onClose,
  } = props;
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [showInspector, setShowInspector] = useState(false);

  useEffect(() => {
    const updateTarget = () => {
      if (typeof document === 'undefined') return;
      const target = document.querySelector('.md-studio') ?? document.body;
      setPortalTarget(target);
    };
    updateTarget();
    window.addEventListener('resize', updateTarget);
    return () => window.removeEventListener('resize', updateTarget);
  }, []);

  const config = component.config;
  const mode: MdSimulationMode = config.mode === 'manual' ? 'manual' : 'guided';
  const preview = generatedInput ?? generateMdStepInputPreview(config);
  const validation = validateMdSimulationConfig(config);
  const potentialAsset = potentialAssets.find((a) => a.id === config.potentialAssetId);
  const finalInput = useMemo(
    () => generateFinalInputPreview(config, preview, potentialAsset, mappedElements),
    [config, preview, mappedElements, potentialAsset],
  );

  if (!portalTarget) return null;

  const drawer = (
    <>
      <LabConfigurationDrawer
        embedded={props.embedded}
        ariaLabel={`${config.name} LAMMPS configuration`}
        title={config.name}
        mode={mode}
        modes={[
          { id: 'guided', label: 'Simple' },
          { id: 'manual', label: 'Advanced' },
        ]}
        onModeChange={(nextMode: MdSimulationMode) => onChange({
          mode: nextMode,
          ...(nextMode === 'manual' && !config.directives?.length ? { directives: defaultMdDirectiveBlocks(config) } : {}),
        })}
        onClose={onClose}
        footer={(
          <>
            <span className={cn('md-config-status', (validation || runDisabledReason) && 'is-error')}>
              {(validation || runDisabledReason) ? <><AlertCircle size={13} />{validation || runDisabledReason}</> : <><Check size={13} />Configuration ready</>}
            </span>
            <button
              type="button"
              className="lab-secondary-button"
              onClick={() => setShowInspector(true)}
              title="Inspect generated in.lammps script"
            >
              <FileCode2 size={14} /> Inspect in.lammps
            </button>
            {onSaveToLibrary && (
              <button type="button" className="lab-secondary-button" onClick={onSaveToLibrary}>
                <Save size={14} /> Save to library
              </button>
            )}
            <button
              type="button"
              className="lab-primary-button"
              disabled={!onRunSimulation || !!runDisabledReason || !!validation}
              onClick={onRunSimulation}
            >
              <Play size={14} /> Run step
            </button>
          </>
        )}
      >
        {mode === 'guided' ? (
          <GuidedConfiguration
            config={config}
            assets={potentialAssets}
            mappedElements={mappedElements}
            onChange={onChange}
            onSelectPotential={onSelectPotential}
            onUploadPotential={onUploadPotential}
          />
        ) : (
          <LammpsInputConfiguration
            config={config}
            runDisabledReason={runDisabledReason}
            onChange={onChange}
          />
        )}
      </LabConfigurationDrawer>

      <ScriptInspectorModal
        open={showInspector}
        code={finalInput}
        stepName={config.name}
        portalTarget={portalTarget}
        onClose={() => setShowInspector(false)}
      />
    </>
  );

  return props.embedded ? drawer : createPortal(drawer, portalTarget);
}
