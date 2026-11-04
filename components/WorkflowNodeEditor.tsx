'use client';
import { useEffect, useEffectEvent, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { WorkflowNodeResult } from './WorkflowNodeResult';
import { MdPotentialUploadDialog, type MdPotentialModelMetadata } from './MdPotentialUploadDialog';
import { phyniteMdPotentials } from '@/lib/phynite-api';
import { mdCloudSha256 } from '@/lib/md-cloud-api';
import type { MdPotentialAsset } from '@/lib/md-simulation-types';
import { FiguresWorkspace } from './FiguresWorkspace';
import { WorkflowFigureEditor } from './WorkflowFigureEditor';
import { CrystalBuilderEditor } from './CrystalBuilderEditor';
import { replaceWorkflowCrystalInput } from '@/lib/crystal-database-input';
import type { CrystalSourceMetadata } from './CrystalStructureInspector';
import { CalculationConfigDrawer } from './CalculationConfigDrawer';
import { MdSimulationConfigDrawer } from './MdSimulationConfigDrawer';
import { createSimulationComponentInstance, MD_SIMULATION_RECIPES, type MdSimulationComponentInstance, type MdSimulationRecipeId } from '@/lib/md-simulation-types';
import { projectWorkflowApi } from '@/lib/project-workflow-api';
import { stableWorkflowJson } from '@/lib/project-workflow';
import { WorkflowTrajectoryEditor } from './WorkflowTrajectoryEditor';
import { parseStructureFile, type ParsedStructure } from '@/lib/structure-parsers';
import { workflowBranchFields, workflowCalculationTypes, workflowMaterial, workflowQeDraft, workflowStructure } from '@/lib/project-workflow-compiler';
import { applyQeAccuracy } from '@/lib/qe-defaults';
import type { ProjectWorkflow, WorkflowNode, WorkflowAttempt } from '@/lib/project-workflow';
import { useLocale } from '@/app/locale-provider';
import { useSiteTheme } from '@/app/use-site-theme';
import { UiSelect } from './UiSelect';
import type { MdCloudPipeline } from '@/lib/md-cloud-api';

export function WorkflowNodeEditor({ node, graph, projectName, onChange, onSaveStructure, onRun, onClose, onError, owner, attempt, onInputChange, onSave, saveStatus, runDisabled = false, onOpenSource, onCanvas, attempts = [] }: {
  node: WorkflowNode; attempt?: WorkflowAttempt; graph: ProjectWorkflow; projectName: string; owner: string;
  onChange: (node: WorkflowNode) => void | boolean; onSaveStructure: (node: WorkflowNode) => Promise<void>; onRun: () => void; onClose: () => void; onError: (message: string) => void;
  onInputChange: (sourceId: string) => void; onSave:()=>Promise<void>; saveStatus:string; runDisabled?:boolean; onOpenSource?: (id:string) => void; onCanvas: () => void; attempts?: WorkflowAttempt[];
}) {
  const { t } = useLocale(), { theme } = useSiteTheme();
  const [saving, setSaving] = useState(false);
  const [stepId, setStepId] = useState('');
  const [potentials, setPotentials] = useState<MdPotentialAsset[]>([]);
  const [pendingPotential, setPendingPotential] = useState<{ files: File[]; family: MdPotentialModelMetadata['family']; elements: string[] } | null>(null);
  useEffect(() => {
    if (node.kind !== 'md') return;
    let live = true;
    void phyniteMdPotentials.list(graph.projectId).then(value => { if (live) setPotentials(value.potentials); }).catch(error => { if (live) onError(error.message); });
    return () => { live = false; };
  }, [node.kind, graph.projectId, owner, onError]);
  const patch = (configuration: Record<string, unknown>) => onChange({ ...node, configuration: { ...node.configuration, ...configuration } });
  const hydrate = useEffectEvent((structure: ParsedStructure, sha256: string) => onChange({ ...node, configuration: { ...node.configuration, structure, savedStructureSignature: stableWorkflowJson(structure) }, resources: node.resources.map(ref => ref.kind === 'structure' ? { ...ref, sha256 } : ref) }));
  const sourceResource = node.resources.find(ref => ref.kind === 'structure' && !ref.deviceOnly)?.id;
  useEffect(() => {
    if (node.kind !== 'structure' || node.configuration.structure || !sourceResource) return;
    let live = true;
    void projectWorkflowApi.input(graph.projectId, sourceResource).then(async input => {
      const structure = input.structure ?? await parseStructureFile(new File([input.text!], input.filename));
      if (live) hydrate(structure, input.sha256);
    }).catch(error => { if (live) onError(error.message); });
    return () => { live = false; };
  }, [graph.projectId, node.kind, node.configuration.structure, sourceResource, onError]);
  if (node.kind === 'structure') {
    const structure = node.configuration.structure as (ParsedStructure & CrystalSourceMetadata) | undefined;
    const source = node.configuration.legacySource as Record<string,unknown> | undefined;
    const metadata={externalId:structure?.externalId ?? (typeof source?.externalId==='string'?source.externalId:undefined),bandGap:structure?.bandGap ?? (typeof source?.bandGap==='number'&&Number.isFinite(source.bandGap)?source.bandGap:undefined)};
    return <CrystalBuilderEditor database metadata={metadata} structure={structure ? {...structure,...metadata} : { name:node.name, atoms:[], lattice:{a:5,b:5,c:5,alpha:90,beta:90,gamma:90,periodic:[true,true,true]} }} onChange={value => onChange(replaceWorkflowCrystalInput(node,value))} onSave={()=>onSaveStructure(node)} saveStatus={saveStatus} viewKey={`phynite:crystal-editor:v2:${owner}:${graph.projectId}:${node.id}`} theme={theme}/>;
  }
  if (workflowCalculationTypes[node.kind]) {
    const draft = workflowQeDraft(graph, node), material = workflowMaterial(workflowStructure(graph, node.id), projectName);
    const source = graph.edges.find(edge => edge.target === node.id);
    const needsScf = ['bands', 'dos', 'phonon', 'btp2'].includes(node.kind);
    const inputControl = <UiSelect compact label={needsScf ? t('SCF input', 'Input SCF') : t('Structure input', 'Input struktur')} value={source?.source ?? ''} options={[{ value: '', label: t('Choose an input', 'Pilih input') }, ...graph.nodes.filter(item => needsScf ? item.kind === 'scf' : ['structure', 'relax', 'extract-frame'].includes(item.kind) && item.id !== node.id).map(item => ({ value: item.id, label: item.name })), ...(needsScf ? [{ value: 'new-scf', label: t('Create a new SCF', 'Buat SCF baru') }] : [])]} onChange={onInputChange} />;
    return <div className="workflow-dft-editor"><WorkflowNodeResult attempt={attempt} owner={owner} projectId={graph.projectId} />{source?.port === 'electronic' && <p className="workflow-editor-notice">{t('Shared structure, XC, pseudopotentials, cutoffs, spin and SCF convergence are inherited from', 'Struktur, XC, pseudopotensial, cutoff, spin dan konvergensi SCF mengikuti')} <strong>{graph.nodes.find(node => node.id === source.source)?.name}</strong>. {onOpenSource && <button onClick={() => onOpenSource(source.source)}>{t('Edit source SCF','Edit SCF sumber')}</button>}</p>}
      <CalculationConfigDrawer embedded inheritedDraft={source?.port === 'electronic' ? workflowQeDraft(graph, graph.nodes.find(node => node.id === source.source)!) : undefined} inheritedModel={needsScf} workflowInput={inputControl} runDisabled={runDisabled} calculation={workflowCalculationTypes[node.kind]!} draft={draft} material={material} structureSourceId="original" structureInputOptions={[{ value: 'original', label: t('Connected structure', 'Struktur terhubung') }]} configurationSources={[]} onChange={values => { const permitted = needsScf ? Object.fromEntries(Object.entries(values).filter(([key]) => workflowBranchFields.includes(key as typeof workflowBranchFields[number]))) : values; if (needsScf && Object.keys(permitted).length !== Object.keys(values).length) onError(t('Change shared model settings on the connected SCF.', 'Ubah model bersama pada SCF yang terhubung.')); patch({ draft: { ...(node.configuration.draft as object ?? {}), ...permitted } }); }} onStructureSourceChange={() => {}} onAddRelaxationSource={() => onError(t('Add a Relaxation module on the canvas and connect its output.', 'Tambahkan modul Relaksasi di kanvas dan hubungkan output-nya.'))} onImportCalculationDraft={() => {}} onApplyAccuracy={accuracy => { if (!needsScf) patch({ draft: applyQeAccuracy(draft, accuracy) }); }} onClose={onClose} onSave={() => { void onSave().catch(error => onError(error.message)); }} saveStatus={saveStatus} onRun={onRun} />
    </div>;
  }
  if (node.kind === 'md') {
    const components = (node.configuration.components as MdSimulationComponentInstance[] | undefined) ?? [];
    const component = components.find(item => item.id === stepId) ?? components[0];
    const material = workflowMaterial(workflowStructure(graph, node.id), projectName);
    const elements = material?.species ?? [];
    const selectPotential = (assetId?: string, asset?: MdPotentialAsset) => {
      const refs = node.resources.filter(ref => ref.kind !== 'potential');
      if (assetId) refs.push({ kind: 'potential', id: assetId });
      onChange({ ...node, resources: refs, configuration: { ...node.configuration, components: components.map(item => ({ ...item, config: { ...item.config, potentialAssetId: assetId } })) } });
      if (asset) setPotentials(current => [asset, ...current.filter(item => item.id !== asset.id)]);
    };
    const uploadPotential = async (metadata: MdPotentialModelMetadata) => {
      if (!pendingPotential) return;
      setSaving(true);
      try {
        const files = pendingPotential.files;
        const uploaded = await phyniteMdPotentials.create(graph.projectId, { ...metadata, elements: metadata.family === 'meam' ? metadata.libraryElementOrder ?? [] : elements, name: files.map(file => file.name).join(' + '), units: 'metal', atomStyle: 'atomic', files: await Promise.all(files.map(async file => ({ filename: file.name, sizeBytes: file.size, sha256: await mdCloudSha256(file), role: metadata.family === 'meam' ? /library\.meam|meam\.lib/i.test(file.name) ? 'library' as const : 'parameter' as const : 'potential' as const }))) });
        await Promise.all(uploaded.uploads.map(ticket => phyniteMdPotentials.upload(ticket, files.find(file => file.name === ticket.filename)!)));
        const completed = await phyniteMdPotentials.complete(uploaded.potential.id);
        selectPotential(completed.potential.id, completed.potential); setPendingPotential(null);
      } catch (error) { onError((error as Error).message); } finally { setSaving(false); }
    };
    return <div className="workflow-md-editor md-studio"><WorkflowNodeResult attempt={attempt} owner={owner} projectId={graph.projectId} /><div className="workflow-md-steps" role="group" aria-label={t('Simulation stages', 'Tahap simulasi')}><div className="workflow-md-stage-list">{components.map((item, index) => <div className="workflow-md-stage" key={item.id}><button className="workflow-md-stage-name" title={item.config.name} aria-pressed={item.id === component?.id} onClick={() => setStepId(item.id)}>{item.config.name}</button><button aria-label={t('Move stage earlier', 'Majukan tahap')} disabled={!index} onClick={() => { const next = [...components]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; patch({ components: next }); }}><ChevronLeft size={14} aria-hidden="true" /></button><button aria-label={t('Move stage later', 'Mundurkan tahap')} disabled={index === components.length - 1} onClick={() => { const next = [...components]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; patch({ components: next }); }}><ChevronRight size={14} aria-hidden="true" /></button><button aria-label={t('Remove stage', 'Hapus tahap')} disabled={components.length === 1} onClick={() => patch({ components: components.filter(stage => stage.id !== item.id) })}><X size={14} aria-hidden="true" /></button></div>)}</div><UiSelect compact ariaLabel={t('Add simulation stage', 'Tambah tahap simulasi')} displayValue={<><Plus size={14} aria-hidden="true" /><span>{t('Add stage', 'Tambah tahap')}</span></>} value="" options={MD_SIMULATION_RECIPES.map(recipe => ({ value: recipe.id, label: recipe.name }))} onChange={recipe => { const next = createSimulationComponentInstance(recipe as MdSimulationRecipeId); if (components[0]) next.config = { ...next.config, potentialAssetId: components[0].config.potentialAssetId, boundaryType: components[0].config.boundaryType }; patch({ components: [...components, next] }); setStepId(next.id); }} /></div>{component && <MdSimulationConfigDrawer embedded component={component} materialName={material?.name ?? ''} formula={material?.formula ?? ''} totalAtoms={material?.atomCount ?? 0} mappedElements={elements} potentialAssets={potentials} onSelectPotential={assetId => selectPotential(assetId)} onUploadPotential={files => {
      const name = files[0]?.name.toLowerCase() ?? '';
      const family = files.length === 2 && files.some(file => /library\.meam|meam\.lib/i.test(file.name)) ? 'meam' : files.length !== 1 ? null : /tersoff/.test(name) ? 'tersoff' : name.endsWith('.sw') ? 'sw' : /\.alloy|setfl/.test(name) ? 'eam-alloy' : /\.eam|funcfl/.test(name) ? elements.length === 1 ? 'eam' : 'eam-alloy' : null;
      if (!family || !elements.length) onError(t('Connect a mapped structure and select supported potential files.', 'Hubungkan struktur dengan pemetaan elemen dan pilih berkas potensial yang didukung.'));
      else setPendingPotential({ files, family, elements });
    }} onChange={values => patch({ components: components.map(item => item.id === component.id ? { ...item, config: { ...item.config, ...values } } : item) })} onRunSimulation={onRun} onClose={onClose} />}{pendingPotential && <MdPotentialUploadDialog {...pendingPotential} busy={saving} onCancel={() => setPendingPotential(null)} onSubmit={metadata => void uploadPotential(metadata)} />}</div>;
  }
  if (node.kind === 'figure') return <WorkflowFigureEditor graph={graph} attempts={attempts} onCanvas={onCanvas} onOpenSource={onOpenSource} runDisabled={runDisabled} owner={owner} projectId={graph.projectId} projectName={projectName} node={node} attempt={attempt} onStyleChange={style => patch({ style })} onClose={onClose} onRun={onRun} />;
  if (node.kind === 'md-analysis') {
    const pipeline = (node.configuration.execution as { pipeline?: MdCloudPipeline } | undefined)?.pipeline ?? { version: 1, modifiers: [], typeMap: {}, periodic: [true, true, true], frameRange: { start: 0, stop: null, stride: 1 } } as MdCloudPipeline;
    const changePipeline = (next: MdCloudPipeline) => patch({ execution: { name: node.name, computeTarget: 'personal', pipeline: next } });
    return <div className="workflow-input-editor"><WorkflowNodeResult attempt={attempt} owner={owner} projectId={graph.projectId} /><UiSelect label={t('Analysis', 'Analisis')} value={pipeline.modifiers[0]?.type ?? ''} options={[{ value: '', label: t('Choose an analysis', 'Pilih analisis') }, { value: 'rdf', label: 'Radial distribution function' }, { value: 'cna', label: 'Common neighbor analysis' }, { value: 'ptm', label: 'Polyhedral template matching' }, { value: 'coordination', label: 'Coordination number' }]} onChange={kind => changePipeline({ ...pipeline, modifiers: [{ id: `analysis_${node.id}`, type: kind as 'rdf', enabled: true, params: kind === 'rdf' || kind === 'coordination' ? { cutoff: 5, bins: 200 } : {} }] })} />{['rdf', 'coordination'].includes(pipeline.modifiers[0]?.type ?? '') && <label>{t('Cutoff (Å)', 'Cutoff (Å)')}<input type="number" min="0.1" step="0.1" value={Number(pipeline.modifiers[0].params.cutoff ?? 5)} onChange={event => changePipeline({ ...pipeline, modifiers: [{ ...pipeline.modifiers[0], params: { ...pipeline.modifiers[0].params, cutoff: Number(event.target.value) } }] })} /></label>}<label>{t('Start frame', 'Frame awal')}<input type="number" min="0" value={pipeline.frameRange.start} onChange={event => changePipeline({ ...pipeline, frameRange: { ...pipeline.frameRange, start: Number(event.target.value) } })} /></label><label>{t('Frame stride', 'Interval frame')}<input type="number" min="1" value={pipeline.frameRange.stride} onChange={event => changePipeline({ ...pipeline, frameRange: { ...pipeline.frameRange, stride: Number(event.target.value) } })} /></label><p>{t('Geometry uses Å. Time stays unknown if it is not declared in the source.', 'Geometri memakai Å. Waktu tetap tidak diketahui bila tidak dinyatakan dalam sumber.')}</p><button onClick={onRun}>{t('Review run', 'Tinjau eksekusi')}</button></div>;
  }
  if (node.kind === 'trajectory') return <WorkflowTrajectoryEditor node={node} owner={owner} projectId={graph.projectId} onChange={onChange} onError={onError} />;
  if (node.legacy?.editor === 'figures' && typeof node.configuration.preservedFigureId === 'string') return <FiguresWorkspace embedded ownerId={owner} projectId={node.legacy.localId} projectName={projectName} jobs={[]} initialFigureId={node.configuration.preservedFigureId} onClose={onClose} theme={theme} />;
  if (node.legacy) return <div className="workflow-input-editor"><WorkflowNodeResult attempt={attempt} owner={owner} projectId={graph.projectId} /><p>{t('This configuration and its history are preserved in the original editor.', 'Konfigurasi dan histori ini dipertahankan di editor sebelumnya.')}</p><a className="lab-button" href={`/${node.legacy.editor === 'md' ? 'md' : 'calculation'}?legacy=1&project=${encodeURIComponent(node.legacy.localId)}${node.legacy.materialId ? `&material=${encodeURIComponent(node.legacy.materialId)}` : ''}${node.legacy.editor === 'figures' ? '&view=figures' : ''}`}>{t('Open preserved editor', 'Buka editor sebelumnya')}</a></div>;
  return <div className="workflow-input-editor"><p>{t('Connect an input on the canvas, then configure this module.', 'Hubungkan input di kanvas, lalu atur modul ini.')}</p>{node.kind === 'extract-frame' && <><label>{t('Frame index', 'Indeks frame')}<input type="number" min="0" value={Number(node.configuration.frame ?? 0)} onChange={event => patch({ frame: Number(event.target.value) })} /></label><UiSelect label={t('Coordinates', 'Koordinat')} value={String(node.configuration.coordinateUnit ?? '')} options={[{ value: '', label: t('Confirm source units', 'Konfirmasi satuan sumber') }, { value: 'angstrom', label: 'Å' }]} onChange={coordinateUnit => patch({ coordinateUnit })} /><label>{t('Element mapping (particle type = element, one per line)', 'Pemetaan elemen (tipe partikel = elemen, satu per baris)')}<textarea value={String(node.configuration.elementMapText ?? '')} onChange={event => { const text = event.target.value; const elementMap = Object.fromEntries(text.split('\n').map(line => line.split('=').map(value => value.trim())).filter(pair => pair.length === 2 && pair.every(Boolean))); patch({ elementMapText: text, elementMap }); }} placeholder="1 = Si" /></label><fieldset><legend>{t('Source periodicity', 'Periodisitas sumber')}</legend>{['X', 'Y', 'Z'].map((axis, index) => <label key={axis}><input type="checkbox" checked={Boolean((node.configuration.periodic as boolean[] | undefined)?.[index])} onChange={event => { const periodic = [...((node.configuration.periodic as boolean[] | undefined) ?? [false, false, false])]; periodic[index] = event.target.checked; patch({ periodic }); }} />{axis}</label>)}</fieldset><button onClick={() => patch({ frame: Number(node.configuration.frame ?? 0), periodic: node.configuration.periodic ?? [false, false, false] })}>{t('Confirm frame and periodicity', 'Konfirmasi frame dan periodisitas')}</button></>}</div>;
}
