'use client';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';
import { ComputeJobReceipt, type ComputeJobBilling } from '@/components/ComputeJobReceipt';
import { LabComputeDestination } from '@/components/ComputeDestination';
import { startBrowserPoll } from '@/lib/browser-poll';

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, ChevronRight, CircleHelp, FileUp, Info, LoaderCircle, Menu, Moon, Redo2, SlidersHorizontal, Sun, Undo2, X } from 'lucide-react';
import { MdPrototypeInspector, type MdPanel } from './MdPrototypeInspector';
import { MdSimulationPanel } from './MdSimulationPanel';
import { StudyEvidenceDialog } from './StudyEvidenceDialog';
import { MdPotentialUploadDialog, type MdPotentialModelMetadata } from './MdPotentialUploadDialog';
import {
  MD_SIMULATION_RECIPES,
  createMdSimulationWorkflowV2,
  createSimulationComponentInstance,
  mdWorkflowToComponents,
  validateMdSimulationConfig,
  type MdPotentialAsset,
  type MdSimulationComponentInstance,
  type MdSimulationConfig,
  type MdSimulationConfiguration,
  type MdSimulationRecipeId,
  type MdSimulationWorkflowV2,
  type MdWorkflowStepKind,
} from '@/lib/md-simulation-types';
import { ProjectStructureSidebar } from './md-prototype/components/ProjectStructureSidebar';
import { MaterialsProjectBrowser, type MaterialsProjectMaterial } from '@/components/MaterialsProjectBrowser';
import type { TimelineMetric } from './md-prototype/types/trajectory';
import { mdFormula, toPrototypeMetric } from '@/lib/md-prototype-adapter';

import { TimeScrubber } from './md-prototype/components/TimeScrubber';
import type { MdSceneExport } from './MdTrajectoryViewport';
import { WorkspaceProductHeader } from './WorkspaceProductHeader';
import { ResearchSidebarStatusSlot, useResearchShell, useResearchNavigation } from './ResearchShellContext';
import { WorkspaceAssetGate, WorkspaceProjectGate } from './WorkspaceProjectGate';
import type { WorkspaceSaveState } from './WorkspaceIdentity';
import { useSiteTheme } from '@/app/use-site-theme';
import { defaultMdSettings, type MdAnalysis, type MdFrame, type MdSettings, type MdTrajectoryRecord } from '@/lib/md-types';
import { speciesCounts } from '@/lib/md-analysis';
import { frameTimePs, type MdParseResult } from '@/lib/md-parser';
import { createMdRunSnapshot } from '@/lib/md-run-snapshot';
import { mdBerendsenCellIssue } from '@/lib/md-simulation-preflight';
import { mdCloudFrameFromPacket, mdCloudPacketFromArtifact, mdCloudTimelineFrames, shouldUsePersonalTrajectoryImport } from '@/lib/md-cloud-import';
import { downloadMdCloudFile } from '@/lib/md-cloud-download';
import { downloadMdFile, frameStructure, frameXyz, frameLammpsDump, isMdElement, listMdTrajectories, mdLastActiveKey, dftTransferKey, removeMdTrajectory, saveMdTrajectories, saveMdTrajectory, type MdPipelineHistory } from '@/lib/md-workspace';
import { createCIF, createPOSCAR, createXSF } from '@/lib/structure-parsers';
import MdWorker from '../lib/md-worker.ts?worker';
import { createMdWorkerClient, type MdWorkerClient } from '@/lib/md-worker-client';
import { MdParseResultCache } from '@/lib/md-parse-cache';
import { AccountMenu } from '@/app/lab-header';
import type { PhyniteSession } from '@/app/auth-client';
import { MdPotentialCatalogDialog } from './MdPotentialCatalogDialog';
import { PhyniteApiError, phyniteCompute, phyniteMdConfigurations, phyniteMdPotentials, phyniteMdRuntime, phyniteMdSimulations, phyniteProjects, type MdRuntimeManifest, type MdSimulationRun, type PhyniteComputeStatus, type PhyniteProject } from '@/lib/phynite-api';
import { cn } from '@/lib/utils';
import {
  clampRightPanelWidth,
  RIGHT_PANEL_DEFAULT_WIDTH,
} from '@/lib/workspace-panel';
import { createMdCloudStorageClient, createSameOriginMdCloudTransport, fromMdCloudSimulationWorkflow, fromMdCloudStudioSettings, mdCloudContentType, mdCloudSaveKey, mdCloudSha256, toMdCloudStudioSettings, type MdCloudTrajectory } from '@/lib/md-cloud-api';
import { buildMdSidebarTrajectories, MD_SIMULATION_INELIGIBLE_REASON, mdRecordMatchesCloudSource, mdSimulationEligibility, resolveMdProjectTrajectoryCounts, resolveMdRouteTrajectory } from '@/lib/md-sidebar';
import { UiSelect } from '@/components/UiSelect';
import { useWorkspaceSaveShortcut } from '@/components/use-workspace-save-shortcut';

const Viewport = dynamic(() => import('./MdTrajectoryViewport').then(m => m.MdTrajectoryViewport), { ssr: false, loading: () => <WorkspaceLoading label="Opening 3D view…" /> });
const defaultPipeline = (): MdSettings => ({ ...defaultMdSettings(), modifiers: [{ id: 'initial-ptm', kind: 'ptm', enabled: true, params: { rmsd: .12 } }, { id: 'initial-rdf', kind: 'rdf', enabled: true, params: { cutoff: 5, bins: 100 } }], colorBy: 'Structure Type' });
type Result = { source: string; request: string; analysis: MdAnalysis };
const emptyAnalysis = (frame: MdFrame): MdAnalysis => ({ frame, attributes: { atoms: frame.ids.length }, phases: [], rdf: [], bonds: [], dislocations: [], surface: null, warnings: [], engine: 'Browser tools' });
const emptyFrame: MdFrame = { index: 0, timestep: null, time: null, ids: [], species: [], positions: [], properties: {}, vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], origin: [0, 0, 0], periodic: [false, false, false], hasCell: false };
const workspaceSignature = (settings: MdSettings, workflow: MdSimulationWorkflowV2) => JSON.stringify([settings, workflow]);
const recordProjectName = (record: MdTrajectoryRecord) => record.projectName ?? record.projectId;
const isMdCloudProject = (project: PhyniteProject) => project.tags?.includes('MD') || project.description === 'Molecular dynamics trajectories';
type UploadablePotentialFamily = 'eam' | 'eam-alloy' | 'meam' | 'tersoff' | 'sw';
const MD_WORKFLOW_SHARED_CONFIG_KEYS = [
  'boundaryType', 'potentialAssetId', 'forceFieldId', 'epsilonEv', 'sigmaAngstrom',
  'cutoffRadiusAngstrom', 'thermoFrequency', 'dumpFrequency', 'restartEverySteps', 'productionStartPs', 'productionEndPs',
] as const satisfies readonly (keyof MdSimulationConfig)[];
const requiredPotentialPairStyle = (family?: string) => ({
  eam: 'eam',
  'eam-alloy': 'eam/alloy',
  meam: 'meam',
  tersoff: 'tersoff',
  sw: 'sw',
}[family ?? ''] ?? 'lj/cut');
const inferPotentialFamily = (files: File[], mappedElements: string[]): UploadablePotentialFamily | null => {
  const names = files.map((file) => file.name.toLowerCase());
  if (files.length === 2 && names.some((name) => name.includes('library.meam') || name.includes('meam.lib'))) return 'meam';
  if (files.length !== 1) return null;
  const name = names[0];
  if (name.endsWith('.tersoff') || name.includes('tersoff')) return 'tersoff';
  if (name.endsWith('.sw')) return 'sw';
  if (name.endsWith('.eam.alloy') || name.endsWith('.alloy') || name.includes('setfl')) return 'eam-alloy';
  if (name.endsWith('.eam') || name.includes('funcfl')) return mappedElements.length === 1 ? 'eam' : 'eam-alloy';
  return null;
};

const waitForLoadPoll = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) {
    reject(new DOMException('The operation was cancelled.', 'AbortError'));
    return;
  }
  const timer = window.setTimeout(() => {
    signal.removeEventListener('abort', abort);
    resolve();
  }, milliseconds);
  const abort = () => {
    window.clearTimeout(timer);
    reject(new DOMException('The operation was cancelled.', 'AbortError'));
  };
  signal.addEventListener('abort', abort, { once: true });
});

export function MdStudio({ ownerId, session }: { ownerId: string; session?: PhyniteSession }) {
  const shell = useResearchShell();
  const integratedShell = Boolean(shell);
  const shellWidth = shell?.contentWidth;
  const lastShellLocation = useRef(shell?.location);
  const { theme, toggleTheme } = useSiteTheme();
  const [frames, setFrames] = useState<MdFrame[]>([]);
  const [analysisReceipt, setAnalysisReceipt] = useState<ComputeJobBilling | null>(null);
  const remoteFrameLoader = useRef<((index: number) => Promise<MdFrame>) | undefined>(undefined);
  const [source, setSource] = useState({ id: '', name: 'Open a trajectory', project: '' });
  const [sourceFile, setSourceFile] = useState<Blob | null>(null);
  const [records, setRecords] = useState<MdTrajectoryRecord[]>([]);
  const recordsRef = useRef(records);
  const [project, setProject] = useState(''), [projectDraft, setProjectDraft] = useState('');
  const [history, setHistory] = useState<MdPipelineHistory>(() => ({ past: [], present: defaultPipeline(), future: [] }));
  const settings = history.present;
  const [metricsResult, setMetricsResult] = useState<{ signature: string; items: TimelineMetric[] }>({ signature: '', items: [] });
  const [metricsJob, setMetricsJob] = useState({ signature: '', busy: false, message: '' });
  const metricsAbort = useRef<AbortController | null>(null);
  const activeMetricsAnalysis = useRef<string | null>(null);
  const [current, setCurrent] = useState(0), [playing, setPlaying] = useState(false);
  const [panel, setPanel] = useState<MdPanel>('inspect'), [selection, setSelection] = useState<string[]>([]);
  const [simulationComponents, setSimulationComponents] = useState<MdSimulationComponentInstance[]>([]);
  const [configuringSimulationId, setConfiguringSimulationId] = useState<string | null>(null);
  const [simulationJobs, setSimulationJobs] = useState<MdSimulationRun[]>([]);
  const [potentialAssets, setPotentialAssets] = useState<MdPotentialAsset[]>([]);
  const [catalogOpen,setCatalogOpen] = useState(false);
  useEffect(() => { const open = () => setCatalogOpen(true); window.addEventListener('phynite:browse-potentials',open); return () => window.removeEventListener('phynite:browse-potentials',open); }, []);
  const [pendingPotential, setPendingPotential] = useState<{ files: File[]; family: MdPotentialModelMetadata['family']; elements: string[] } | null>(null);
  const [studyEvidenceOpen, setStudyEvidenceOpen] = useState(false);
  const [savedConfigurations, setSavedConfigurations] = useState<MdSimulationConfiguration[]>([]);
  const [runtimeManifest, setRuntimeManifest] = useState<MdRuntimeManifest | null>(null);
  const [simulationAction, setSimulationAction] = useState('');
  const [computeStatus, setComputeStatus] = useState<PhyniteComputeStatus['compute'] | null>(null);
  const [result, setResult] = useState<Result | null>(null), [analysisError, setAnalysisError] = useState('');
  const [message, setMessage] = useState('Open a trajectory to begin'), [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true), [exporting, setExporting] = useState(false), [saving, setSaving] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'xyz' | 'dump' | 'cif' | 'poscar' | 'xsf' | 'png' | 'glb' | null>(null);
  const [importOpen, setImportOpen] = useState(false), [helpOpen, setHelpOpen] = useState(false), [drop, setDrop] = useState(false), [mobilePanel, setMobilePanel] = useState<'files' | 'inspector' | null>(null);
  const [materialsProjectOpen, setMaterialsProjectOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(232);
  const [inspectorWidth, setInspectorWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  useEffect(() => { if (shellWidth) setInspectorWidth(current => clampRightPanelWidth(current, 0, shellWidth)); }, [shellWidth]);

  useEffect(() => {
    try {
      const savedSidebar = window.localStorage.getItem('phynite_md_sidebar_width');
      const parsedSidebar = Number(savedSidebar);
      const restoredSidebar = savedSidebar && Number.isFinite(parsedSidebar)
        ? Math.max(190, Math.min(420, parsedSidebar))
        : sidebarWidth;
      if (restoredSidebar !== sidebarWidth) setSidebarWidth(restoredSidebar);

      const saved = window.localStorage.getItem('phynite_md_right_panel_width');
      if (saved) {
        const val = Number(saved);
        if (Number.isFinite(val)) setInspectorWidth(clampRightPanelWidth(val, integratedShell ? 0 : restoredSidebar, shellWidth || undefined));
      }
    } catch {}
    // Hydrate once so resizing the sidebar does not restore stale widths mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleWindowResize = () => {
      setInspectorWidth(current => clampRightPanelWidth(current, integratedShell ? 0 : sidebarWidth, shellWidth || undefined));
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [sidebarWidth, integratedShell, shellWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem('phynite_md_right_panel_width', String(inspectorWidth));
    } catch {}
  }, [inspectorWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem('phynite_md_sidebar_width', String(sidebarWidth));
    } catch {}
  }, [sidebarWidth]);
  const [cloudProjects, setCloudProjects] = useState<PhyniteProject[]>([]), [cloudProjectId, setCloudProjectId] = useState('');
  const [cloudProjectTrajectoryCounts, setCloudProjectTrajectoryCounts] = useState<Record<string, number>>({});
  const [cloudTrajectories, setCloudTrajectories] = useState<MdCloudTrajectory[]>([]), [cloudLoading, setCloudLoading] = useState(true), [cloudReady, setCloudReady] = useState(false), [cloudAction, setCloudAction] = useState(''), [cloudSaving, setCloudSaving] = useState(false), [cloudError, setCloudError] = useState('');
  const [activeCloud, setActiveCloud] = useState<MdTrajectoryRecord['cloud']>(), [cloudSyncedSettings, setCloudSyncedSettings] = useState('');
  const [online, setOnline] = useState(true);
  const [deviceHydrated, setDeviceHydrated] = useState(false);
  const legacyMdStudioApi = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null), exportRef = useRef<MdSceneExport | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const parserWorker = useRef<MdWorkerClient | null>(null), analysisWorker = useRef<MdWorkerClient | null>(null), loadSequence = useRef(0);
  const activeLoadAbort = useRef<AbortController | null>(null);
  const openingSidebarTrajectory = useRef('');
  const sidebarSelectionRequest = useRef(0);
  const activeImportAnalysis = useRef<string | null>(null);
  const parsedCacheRef = useRef(new MdParseResultCache());
  const initialCloudProject = useRef(''), initialCloudTrajectory = useRef(''), routeTrajectoryHandled = useRef(false), loadedCloudTrajectoryProject = useRef(''), deviceOpened = useRef(false), dftTransferHandled = useRef(false);
  const cloudSaveInFlight = useRef(false), cloudSaveQueued = useRef(false), cloudSaveWaiters = useRef<Array<() => void>>([]);
  const legacyMigrationInFlight = useRef(false), legacyMigrationAttempts = useRef(new Set<string>());
  const cloudTrajectoryInventory = useRef(new Map<string, { trajectories: MdCloudTrajectory[]; loadedAt: number }>());
  const cloudClient = useMemo(() => createMdCloudStorageClient({ transport: createSameOriginMdCloudTransport() }), []);
  const cloudAutosaveRef = useRef({ sourceFile, source, settings, simulationComponents, cloudProjectId, activeCloud, cloudTrajectories });
  useEffect(() => { recordsRef.current = records; }, [records]);
  useEffect(() => {
    cloudAutosaveRef.current = { sourceFile, source, settings, simulationComponents, cloudProjectId, activeCloud, cloudTrajectories };
  }, [sourceFile, source, settings, simulationComponents, cloudProjectId, activeCloud, cloudTrajectories]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    initialCloudProject.current = params.get('project')?.trim() ?? '';
    initialCloudTrajectory.current = params.get('trajectory')?.trim() ?? '';
  }, []);
  useEffect(() => {
    let cancelled = false;
    setCloudLoading(true);
    const loadProjects = async () => {
      const { projects: allProjects } = await phyniteProjects.list();
      if (cancelled) return;
      const items = allProjects.filter(isMdCloudProject);
      const inventoryCounts = await resolveMdProjectTrajectoryCounts(
        items,
        async (projectId) => {
          const trajectories = (await cloudClient.listTrajectories(projectId)).trajectories;
          cloudTrajectoryInventory.current.set(projectId, { trajectories, loadedAt: Date.now() });
          return trajectories;
        },
      );
      if (cancelled) return;
      setCloudProjects(items);
      setCloudProjectTrajectoryCounts(current => ({ ...current, ...inventoryCounts }));
      setCloudReady(true);
      const routeProject = items.find(item => item.id === initialCloudProject.current);
      if (routeProject) {
        setCloudProjectId(routeProject.id);
        setProject(routeProject.name);
        setSource(current => current.id ? current : { ...current, project: routeProject.name });
      }
      else if (initialCloudProject.current) {
        initialCloudProject.current = '';
        initialCloudTrajectory.current = '';
        const url = new URL(window.location.href); url.searchParams.delete('project'); url.searchParams.delete('trajectory'); window.history.replaceState(window.history.state, '', url);
        setMessage('That project belongs to another workspace. Choose or create an MD project.');
      }
    };
    void loadProjects().catch(() => {
      if (!cancelled) setCloudReady(false);
      if (!cancelled && initialCloudProject.current) setMessage('The cloud project could not be loaded. Device files remain available.');
    }).finally(() => { if (!cancelled) setCloudLoading(false); });
    return () => { cancelled = true; };
  }, [cloudClient]);
  const getParserWorker = useCallback(() => {
    if (!parserWorker.current) {
      parserWorker.current = createMdWorkerClient(() => new MdWorker({ name: 'phynite-md-parser' }), { requestTimeoutMs: 120_000 });
    }
    return parserWorker.current;
  }, []);
  const getAnalysisWorker = useCallback(() => {
    if (!analysisWorker.current) {
      analysisWorker.current = createMdWorkerClient(() => new MdWorker({ name: 'phynite-md-analysis' }), { requestTimeoutMs: 60_000 });
    }
    return analysisWorker.current;
  }, []);
  useEffect(() => {
    // Vite's worker import keeps the URL on the page origin in both dev and production.
    getParserWorker();
    getAnalysisWorker();
    return () => {
      activeLoadAbort.current?.abort();
      parserWorker.current?.dispose();
      analysisWorker.current?.dispose();
      parserWorker.current = null;
      analysisWorker.current = null;
    };
  }, [getAnalysisWorker, getParserWorker]);
  const runParser = useCallback(<T,>(payload: Record<string, unknown>, signal?: AbortSignal) => {
    return getParserWorker().run<T>(payload, { signal });
  }, [getParserWorker]);
  const runAnalysis = useCallback(<T,>(payload: Record<string, unknown>) => {
    return getAnalysisWorker().run<T>(payload);
  }, [getAnalysisWorker]);
  const patchSettings = useCallback((patch: Partial<MdSettings>) => {
    setHistory(h => ({ past: h.past.concat(h.present).slice(-40), present: { ...h.present, ...patch }, future: [] })); setPlaying(false);
  }, []);
  const importWithPersonalCompute = useCallback(async ({
    file,
    sourceFilename,
    displayName,
    initial,
    initialWorkflow,
    existingCloud,
    controller,
  }: {
    file: Blob | null;
    sourceFilename: string;
    displayName: string;
    initial: MdSettings;
    initialWorkflow?: MdSimulationWorkflowV2;
    existingCloud?: MdTrajectoryRecord['cloud'];
    controller: AbortController;
  }): Promise<{ parsed: MdParseResult; cloud: NonNullable<MdTrajectoryRecord['cloud']> }> => {
    const projectId = existingCloud?.projectId || cloudProjectId;
    if (!projectId) throw new Error('Open a cloud MD project and select compute for OVITO import.');

    let cloud = existingCloud;
    let pendingTrajectoryId = '';
    let finalizedSource = Boolean(existingCloud);
    let analysisId = '';
    try {
      if (!cloud) {
        if (!file) throw new Error('Choose the original trajectory to upload.');
        setMessage('Uploading the trajectory for OVITO import…');
        const sha256 = await mdCloudSha256(file);
        if (controller.signal.aborted) throw new DOMException('The operation was cancelled.', 'AbortError');
        const workflow = initialWorkflow ?? createMdSimulationWorkflowV2([]);
        const created = await cloudClient.createTrajectory(projectId, {
          filename: sourceFilename,
          name: displayName,
          contentType: mdCloudContentType(sourceFilename, file.type),
          sizeBytes: file.size,
          sha256,
          idempotencyKey: `md-import-${crypto.randomUUID()}`,
          studioSettings: toMdCloudStudioSettings(initial, initialWorkflow),
        });
        pendingTrajectoryId = created.trajectory.id;
        let trajectory = created.trajectory;
        if (created.upload) {
          await cloudClient.uploadTrajectory(created.upload, file, { signal: controller.signal });
          trajectory = (await cloudClient.completeTrajectory(trajectory.id, { sizeBytes: file.size, sha256 })).trajectory;
        }
        finalizedSource = true;
        cloud = {
          trajectoryId: trajectory.id,
          projectId,
          sha256,
          uploadedAt: trajectory.uploadedAt ?? trajectory.updatedAt,
          settingsSignature: workspaceSignature(initial, workflow),
          revision: trajectory.revision,
        };
        setCloudTrajectories(items => [trajectory, ...items.filter(item => item.id !== trajectory.id)]);
      }

      setMessage('Reading the trajectory with OVITO on selected compute…');
      const importSettings = { ...defaultMdSettings(), periodic: initial.periodic ?? [true, true, true] as [boolean, boolean, boolean] };
      const pipeline = toMdCloudStudioSettings(importSettings).pipeline;
      pipeline.frameRange = { start: 0, stop: null, stride: 1 };
      const importSource = cloud;
      const previous = (await cloudClient.listAnalyses(projectId)).analyses.find(item =>
        item.trajectoryId === importSource.trajectoryId && item.sourceSha256 === importSource.sha256 && item.status === 'COMPLETED' && item.sourceImport === true
        && JSON.stringify(item.sourceImportPeriodic) === JSON.stringify(importSettings.periodic));
      if (!previous && (!['connected', 'available'].includes(computeStatus?.status ?? '') || !computeStatus?.capabilities?.includes('md-analysis'))) {
        throw new Error('Select available compute and funding to import this trajectory with OVITO.');
      }
      const created = previous ? await cloudClient.getAnalysis(previous.id) : await cloudClient.createAnalysis(projectId, {
        trajectoryId: cloud.trajectoryId,
        pipeline,
        sourceImport: true,
        idempotencyKey: `md-import-analysis-${crypto.randomUUID()}`,
        name: `Open ${displayName}`,
      });
      analysisId = created.analysis.id;
      activeImportAnalysis.current = analysisId;
      let remote = created;
      setAnalysisReceipt(remote.analysis);
      while (!controller.signal.aborted && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(remote.analysis.status)) {
        setMessage(remote.analysis.statusMessage || `OVITO import · ${remote.analysis.status.toLowerCase()} · ${remote.analysis.progress}%`);
        await waitForLoadPoll(1250, controller.signal);
        remote = await cloudClient.getAnalysis(analysisId);
        setAnalysisReceipt(remote.analysis);
      }
      if (controller.signal.aborted) throw new DOMException('The operation was cancelled.', 'AbortError');
      if (remote.analysis.status !== 'COMPLETED') {
        throw new Error(remote.analysis.failureReason || `OVITO import ${remote.analysis.status.toLowerCase()}.`);
      }

      const timelineAccess = await cloudClient.getAnalysisArtifact(analysisId, 'timeline.json.gz');
      const timelineResponse = await fetch(timelineAccess.url, { signal: controller.signal });
      if (!timelineResponse.ok) throw new Error('Could not download the OVITO trajectory index.');
      const timeline = mdCloudTimelineFrames(await timelineResponse.json());
      let cachedArtifact = '';
      let cachedPayload: unknown;
      let loadingArtifact: Promise<unknown> | undefined;
      let loadingArtifactPath = "";
      const loadFrame = async (index: number) => {
        const reference = timeline[index];
        if (!reference) throw new Error('Frame is outside the retained trajectory.');
        let payload = cachedArtifact === reference.artifact ? cachedPayload : undefined;
        if (!payload) {
          if (loadingArtifact && loadingArtifactPath === reference.artifact) payload = await loadingArtifact;
          else {
          loadingArtifactPath = reference.artifact;
          loadingArtifact = (async () => {
          const access = await cloudClient.getAnalysisArtifact(analysisId!, reference.artifact);
          const response = await fetch(access.url, { signal: controller.signal });
          if (!response.ok) throw new Error('Could not load the retained trajectory frame.');
          const reader = response.body?.getReader();
          if (!reader) throw new Error('Trajectory frame stream is unavailable.');
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > 64 * 1024 ** 2) { await reader.cancel(); throw new Error('This frame shard exceeds the browser memory limit. Download the original result for external analysis.'); }
            chunks.push(next.value);
          }
          const buffer = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
          const parsedPayload: unknown = JSON.parse(new TextDecoder().decode(buffer));
          cachedPayload = parsedPayload;
          cachedArtifact = reference.artifact;
          return parsedPayload;
          })();
          payload = await loadingArtifact;
          }
        }
        return mdCloudFrameFromPacket(mdCloudPacketFromArtifact(payload, reference), index);
      };
      const decoded: MdFrame[] = new Array(timeline.length);
      decoded[0] = await loadFrame(0);
      const parsed: MdParseResult = { frames: decoded, index: { format: 'ovito', name: sourceFilename, offsets: [], warnings: [] }, warnings: [], loadFrame };
      return { parsed, cloud };
    } catch (error) {
      if (controller.signal.aborted && analysisId) {
        await cloudClient.cancelAnalysis(analysisId).catch(() => undefined);
      }
      if (!finalizedSource && pendingTrajectoryId) {
        await cloudClient.deleteTrajectory(pendingTrajectoryId).catch(() => undefined);
      }
      throw error;
    } finally {
      if (activeImportAnalysis.current === analysisId) activeImportAnalysis.current = null;
    }
  }, [cloudClient, cloudProjectId, computeStatus]);
  const activate = useCallback(async (file: Blob | null, sourceFilename: string, id: string, projectName: string, initial: MdSettings, persist: boolean, sequence?: number, cloud?: MdTrajectoryRecord['cloud'], displayName = sourceFilename, initialWorkflow?: MdSimulationWorkflowV2, suppliedController?: AbortController, projectCloudId?: string, databaseSource?: MdTrajectoryRecord['databaseSource']) => {
    const requestSequence = sequence ?? ++loadSequence.current;
    const controller = suppliedController ?? new AbortController();
    if (!suppliedController) {
      activeLoadAbort.current?.abort();
      activeLoadAbort.current = controller;
    }
    setLoading(true); setPlaying(false);
    try {
      let parsed: MdParseResult | undefined = parsedCacheRef.current.get(id);
      let resolvedCloud = cloud;
      if (!parsed) {
        let localError: unknown;
        const needsPersonalImport = !file || shouldUsePersonalTrajectoryImport(sourceFilename, file.size);
        if (!needsPersonalImport && file) try {
          const text = await file.text();
          if (controller.signal.aborted) throw new DOMException('The operation was cancelled.', 'AbortError');
          parsed = await runParser<MdParseResult>({ operation: 'parse', text, name: sourceFilename }, controller.signal);
        }
        catch (error) { localError = error; }
        if (controller.signal.aborted) throw localError;
        if (!parsed) {
          const personalImportReady = Boolean(['connected', 'available'].includes(computeStatus?.status ?? '') && computeStatus?.capabilities?.includes('md-analysis'));
          if (needsPersonalImport || personalImportReady) {
            const imported = await importWithPersonalCompute({ file, sourceFilename, displayName, initial, initialWorkflow, existingCloud: cloud, controller });
            parsed = imported.parsed;
            resolvedCloud = imported.cloud;
          } else {
            throw localError instanceof Error ? localError : new Error('Could not open the trajectory.');
          }
        }
        parsedCacheRef.current.set(id, parsed);
      }
      if (requestSequence !== loadSequence.current || controller.signal.aborted) return false;
      remoteFrameLoader.current = parsed.loadFrame;
      setProject(projectName); setFrames(parsed.frames); setSource({ id, name: displayName, project: projectName }); setSourceFile(file); setCurrent(0); setSelection([]); setResult(null); setAnalysisError('');
      setActiveCloud(resolvedCloud); setCloudSyncedSettings(resolvedCloud?.settingsSignature ?? ''); setCloudError('');
      setHistory({ past: [], present: initial, future: [] }); setImportWarnings(parsed.warnings); setImportOpen(false);
      setSimulationComponents(initialWorkflow ? mdWorkflowToComponents(initialWorkflow, id, displayName) : []);
      setConfiguringSimulationId(null);
      setLoading(false);
      setMessage('Opened ' + displayName + ' · ' + parsed.frames.length + ' frames');
      try { localStorage.setItem(mdLastActiveKey(ownerId), id); } catch {}
      if (persist && file) {
        const targetCloudProjectId = resolvedCloud?.projectId ?? projectCloudId ?? cloudProjectId;
        const initialWorkspaceSignature = workspaceSignature(initial, initialWorkflow ?? createMdSimulationWorkflowV2([]));
        const cloudMatchesWorkspace = resolvedCloud?.settingsSignature === initialWorkspaceSignature;
        const record: MdTrajectoryRecord = {
          id,
          owner: ownerId,
          projectId: targetCloudProjectId || projectName,
          projectName,
          name: displayName,
          sourceFilename,
          ...(databaseSource ? { databaseSource } : {}),
          file,
          createdAt: new Date().toISOString(),
          settings: initial,
          ...(initialWorkflow ? { simulationWorkflow: initialWorkflow } : {}),
          ...(resolvedCloud ? { cloud: resolvedCloud } : {}),
          syncState: resolvedCloud ? cloudMatchesWorkspace ? 'synced' : 'pending' : targetCloudProjectId ? 'pending' : 'local',
        };
        setSaving(true);
        try {
          await saveMdTrajectory(record);
          setRecords(items => items.filter(item => item.id !== id).concat(record));
        } catch {
          if (requestSequence === loadSequence.current) {
            setMessage('Opened ' + displayName + '. It could not be cached on this device, but remains available in this session.');
          }
        } finally {
          if (requestSequence === loadSequence.current) setSaving(false);
        }
      }
      return true;
    } catch (e) {
      if (requestSequence === loadSequence.current && !controller.signal.aborted) setMessage(e instanceof Error ? (e.message === 'Load failed' ? 'Could not reach the server or local compute. Check connection.' : e.message) : 'Could not open the trajectory.');
      return false;
    } finally {
      if (requestSequence === loadSequence.current) setLoading(false);
      if (activeLoadAbort.current === controller) activeLoadAbort.current = null;
    }
  }, [cloudProjectId, computeStatus, importWithPersonalCompute, ownerId, runParser]);
  useEffect(() => {
    if (deviceOpened.current) return;
    deviceOpened.current = true;
    let cancelled = false;
    listMdTrajectories(ownerId).then(items => {
      if (cancelled) return;
      setRecords(items);
      recordsRef.current = items;
      if (initialCloudProject.current) {
        setLoading(false);
        setSource(current => current.id ? current : { id: '', name: 'Choose a cloud trajectory or import a file', project: current.project });
        setMessage(current => current.startsWith('Opened ') ? current : 'Cloud project opened');
      } else {
        setLoading(false);
        setMessage(current => current.startsWith('Opened ') ? current : (items.length ? 'Choose a project to continue' : 'Create or open a project to begin'));
      }
      setDeviceHydrated(true);
    }).catch(() => { if (!cancelled) { setMessage('Device storage is unavailable. Imports remain usable for this session.'); setLoading(false); setDeviceHydrated(true); } });
    return () => {
      cancelled = true;
      deviceOpened.current = false;
    };
  }, [ownerId]);
  useEffect(() => {
    if (!cloudReady || cloudLoading || dftTransferHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('from') !== 'dft') return;
    const key = dftTransferKey(ownerId);
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      dftTransferHandled.current = true;
      const url = new URL(window.location.href);
      url.searchParams.delete('from');
      window.history.replaceState(window.history.state, '', url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '') + url.hash);
      return;
    }
    dftTransferHandled.current = true;
    const importTransfer = async () => {
      try {
        const data = JSON.parse(raw) as { owner?: string; cif?: string; name?: string; projectName?: string };
        if (data.owner !== ownerId || typeof data.cif !== 'string' || !data.cif.trim()) {
          throw new Error('The DFT transfer is invalid or belongs to another workspace.');
        }
        const requestedProjectName = data.projectName?.trim() || 'DFT structures';
        let targetProject = cloudProjects.find(item => item.name.localeCompare(requestedProjectName, undefined, { sensitivity: 'accent' }) === 0);
        if (!targetProject) {
          const created = await phyniteProjects.create({ name: requestedProjectName, description: 'Molecular dynamics trajectories', tags: ['MD'] });
          targetProject = created.project;
          setCloudProjects(items => [created.project, ...items.filter(item => item.id !== created.project.id)]);
        }
        setCloudProjectId(targetProject.id);
        setProject(targetProject.name);
        const url = new URL(window.location.href);
        url.searchParams.set('project', targetProject.id);
        url.searchParams.delete('trajectory');
        window.history.replaceState(window.history.state, '', url.pathname + `?${url.searchParams}` + url.hash);

        const fileName = data.name?.trim() || 'dft_structure.cif';
        const file = new File([data.cif], fileName, { type: 'text/plain' });
        const id = `${ownerId}:${Date.now()}:${fileName}`;
        const opened = await activate(file, fileName, id, targetProject.name, defaultPipeline(), true, undefined, undefined, fileName, undefined, undefined, targetProject.id);
        if (!opened) throw new Error('The structure could not be opened in MD Lab.');
        window.localStorage.removeItem(key);
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('from');
        window.history.replaceState(window.history.state, '', cleanUrl.pathname + (cleanUrl.searchParams.toString() ? `?${cleanUrl.searchParams}` : '') + cleanUrl.hash);
        setMessage(`Imported ${fileName} from DFT Lab · syncing to cloud`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Could not import the DFT structure.';
        setCloudError(detail);
        setMessage(`${detail} The transfer is still saved on this device.`);
      }
    };
    void importTransfer();
  }, [activate, cloudLoading, cloudProjects, cloudReady, ownerId]);
  useEffect(() => {
    const record = recordsRef.current.find(r => r.id === source.id);
    if (!record || loading) return;
    const timer = setTimeout(() => {
      setSaving(true);
      const simulationWorkflow = createMdSimulationWorkflowV2(simulationComponents);
      const expectsCloudSync = Boolean(record.cloud || cloudProjectId);
      const matchesCloud = Boolean(record.cloud && record.cloud.settingsSignature === workspaceSignature(settings, simulationWorkflow));
      const updated: MdTrajectoryRecord = {
        ...record,
        projectId: record.cloud?.projectId ?? (cloudProjectId || record.projectId),
        projectName: source.project || recordProjectName(record),
        settings,
        simulationWorkflow,
        syncState: expectsCloudSync ? matchesCloud ? 'synced' : 'pending' : 'local',
        syncError: undefined,
      };
      saveMdTrajectory(updated).then(() => {
        setRecords(items => items.map(r => r.id === updated.id ? updated : r));
      }).catch(() => {
        if (recordsRef.current.some(r => r.id === record.id)) {
          setMessage('Could not save this trajectory on the device. Export your data before closing.');
        }
      }).finally(() => setSaving(false));
    }, 450);
    return () => clearTimeout(timer);
  }, [cloudProjectId, settings, simulationComponents, source.id, source.project, loading]);
  useEffect(() => {
    const loadFrame = remoteFrameLoader.current;
    if (!loadFrame || !frames.length || frames[current]) return;
    let cancelled = false;
    void loadFrame(current).then(frame => {
      if (cancelled) return;
      setFrames(previous => {
        const next: MdFrame[] = new Array(previous.length);
        for (let i = Math.max(0, current - 1); i <= Math.min(previous.length - 1, current + 1); i++) if (previous[i]) next[i] = previous[i];
        next[current] = frame;
        return next;
      });
    }).catch(error => { if (!cancelled) setAnalysisError(error instanceof Error ? error.message : 'Could not load frame.'); });
    return () => { cancelled = true; };
  }, [current, frames, source.id]);
  const input = frames[Math.min(current, frames.length - 1)] ?? emptyFrame;
  const mapped = useMemo(() => ({ ...input, periodic: settings.periodic ?? input.periodic, species: input.species.map(s => settings.typeMap[s]?.trim() || s) }), [input, settings.typeMap, settings.periodic]);
  const pipelineSignature = JSON.stringify([source.id, settings.modifiers, settings.typeMap, settings.periodic]);
  const signature = JSON.stringify([pipelineSignature, current]);
  useEffect(() => () => metricsAbort.current?.abort(), [pipelineSignature]);
  useEffect(() => {
    if (!frames.length || !frames[current]) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setAnalysisError('');
      const compute = async () => {
        const computed = await runAnalysis<MdAnalysis>({ operation: 'analyze', frame: mapped, modifiers: settings.modifiers });
        if (!cancelled) { setResult({ source: source.id, request: signature, analysis: computed }); setMetricsResult(previous => ({ signature: pipelineSignature, items: (previous.signature === pipelineSignature ? previous.items.filter(item => item.frame !== computed.frame.index) : []).concat(toPrototypeMetric(computed, { modifiers: settings.modifiers })) })); }
      };
      void compute().catch(e => { if (!cancelled) setAnalysisError(e instanceof Error ? e.message : 'Analysis failed.'); });
    }, playing ? 0 : 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [signature, pipelineSignature, mapped, source.id, settings.modifiers, runAnalysis, playing, frames, current]);
  const analysis = result?.source === source.id ? result.analysis : emptyAnalysis(mapped);
  const busy = !!frames.length && !analysisError && result?.request !== signature;
  useEffect(() => {
    if (!playing || busy || analysisError || frames.length < 2) return;
    const timer = setTimeout(() => {
      if (current + 1 < frames.length) setCurrent(current + 1);
      else if (settings.loop) setCurrent(0);
      else setPlaying(false);
    }, 1000 / settings.fps);
    return () => clearTimeout(timer);
  }, [playing, busy, analysisError, current, frames.length, settings.fps, settings.loop]);
  const seek = useCallback((index: number) => { setPlaying(false); setCurrent(Math.max(0, Math.min(index, frames.length - 1))); }, [frames.length]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setImportOpen(false); setHelpOpen(false); }
      if ((importOpen || helpOpen) && e.key === 'Tab') {
        const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary');
        if (elements?.length) {
          const first = elements[0], last = elements[elements.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      if (importOpen || helpOpen || (e.target as HTMLElement).closest('input,textarea,select,button,[contenteditable]')) return;
      if (e.code === 'Space' && frames.length > 1) { e.preventDefault(); setPlaying(p => !p); }
      if (e.code === 'ArrowRight') seek(Math.min(current + 1, frames.length - 1));
      if (e.code === 'ArrowLeft') seek(Math.max(current - 1, 0));
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [current, frames.length, seek, importOpen, helpOpen]);

  useEffect(() => {
    loadedCloudTrajectoryProject.current = '';
    if (!cloudProjectId) { setCloudTrajectories([]); return; }
    const cachedInventory = cloudTrajectoryInventory.current.get(cloudProjectId);
    if (cachedInventory && Date.now() - cachedInventory.loadedAt < 30_000) {
      loadedCloudTrajectoryProject.current = cloudProjectId;
      setCloudTrajectories(cachedInventory.trajectories);
      setCloudProjectTrajectoryCounts(counts => ({ ...counts, [cloudProjectId]: cachedInventory.trajectories.length }));
      setCloudLoading(false);
      return;
    }
    let cancelled = false;
    setCloudLoading(true); setCloudError('');
    cloudClient.listTrajectories(cloudProjectId).then(({ trajectories }) => {
      if (!cancelled) {
        loadedCloudTrajectoryProject.current = cloudProjectId;
        cloudTrajectoryInventory.current.set(cloudProjectId, { trajectories, loadedAt: Date.now() });
        setCloudTrajectories(trajectories);
        setCloudProjectTrajectoryCounts(counts => counts[cloudProjectId] === trajectories.length
          ? counts
          : { ...counts, [cloudProjectId]: trajectories.length });
      }
    }).catch((error) => {
      if (!cancelled) setCloudError(error instanceof Error ? error.message : 'Could not load cloud trajectories.');
    }).finally(() => { if (!cancelled) setCloudLoading(false); });
    return () => { cancelled = true; };
  }, [cloudClient, cloudProjectId]);
  useEffect(() => {
    if (!cloudProjectId || loadedCloudTrajectoryProject.current !== cloudProjectId) return;
    cloudTrajectoryInventory.current.set(cloudProjectId, { trajectories: cloudTrajectories, loadedAt: Date.now() });
    setCloudProjectTrajectoryCounts(counts => counts[cloudProjectId] === cloudTrajectories.length
      ? counts
      : { ...counts, [cloudProjectId]: cloudTrajectories.length });
  }, [cloudProjectId, cloudTrajectories]);
  const computeMetrics = async () => {
    metricsAbort.current?.abort();
    const controller = new AbortController(); metricsAbort.current = controller;
    setPlaying(false); setMetricsJob({ signature: pipelineSignature, busy: true, message: 'Computing trajectory…' });
    try {
      if (cloudProjectId && activeCloud?.trajectoryId && cloudSynced) {
        if (computeStatus?.status !== 'connected' && computeStatus?.status !== 'available') throw new Error('Connect your computer before analyzing the full trajectory.');
        const pipeline = toMdCloudStudioSettings(settings).pipeline;
        pipeline.frameRange = { start: 0, stop: frames.length, stride: 1 };
        const idempotencyKey = `md-analysis-${crypto.randomUUID()}`;
        const created = await cloudClient.createAnalysis(cloudProjectId, {
          trajectoryId: activeCloud.trajectoryId,
          pipeline,
          idempotencyKey,
            name: `Analyze ${source.name}`,
        });
        const analysisId = created.analysis.id;
        activeMetricsAnalysis.current = analysisId;
        let remote = created;
      setAnalysisReceipt(remote.analysis);
        while (!controller.signal.aborted && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(remote.analysis.status)) {
          setMetricsJob({ signature: pipelineSignature, busy: true, message: remote.analysis.statusMessage || `${remote.analysis.status.toLowerCase()} · ${remote.analysis.progress}%` });
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, 1500);
            controller.signal.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
          });
          remote = await cloudClient.getAnalysis(analysisId);
        setAnalysisReceipt(remote.analysis);
        }
        if (controller.signal.aborted) {
          await cloudClient.cancelAnalysis(analysisId).catch(() => undefined);
          throw new DOMException('Aborted', 'AbortError');
        }
        if (remote.analysis.status !== 'COMPLETED') throw new Error(remote.analysis.failureReason || `Trajectory analysis ${remote.analysis.status.toLowerCase()}.`);
        const access = await cloudClient.getAnalysisArtifact(analysisId, 'timeline.json.gz');
        const response = await fetch(access.url, { signal: controller.signal });
        if (!response.ok) throw new Error('Could not download the completed trajectory metrics.');
        const payload = await response.json() as { frames?: Array<{ frame: number; timestep?: number; phases?: Array<{ name?: string; count?: number }>; attributes?: Record<string, number> }> };
        const items: TimelineMetric[] = (payload.frames ?? []).map((item) => ({
          frame: item.frame,
          timestep: item.timestep ?? item.frame,
          phases: Object.fromEntries((item.phases ?? []).map((phase) => [String(phase.name || 'Other'), Number(phase.count || 0)])),
          avgPotentialEnergy: typeof item.attributes?.PotentialEnergy === 'number' ? item.attributes.PotentialEnergy : null,
          dislocationDensity: typeof item.attributes?.DislocationDensity === 'number' ? item.attributes.DislocationDensity : undefined,
        }));
        setMetricsResult({ signature: pipelineSignature, items });
        setMetricsJob({ signature: pipelineSignature, busy: false, message: `${items.length} frames analyzed on your computer` });
        return;
      }
      for (let index = 0; index < frames.length; index++) {
        if (controller.signal.aborted) break;
        const original = frames[index] ?? await remoteFrameLoader.current?.(index);
        if (!original) throw new Error("The requested frame is unavailable.");
        const frame = { ...original, periodic: settings.periodic ?? original.periodic, species: original.species.map(s => settings.typeMap[s]?.trim() || s) };
        const computed = await runAnalysis<MdAnalysis>({ operation: 'analyze', frame, modifiers: settings.modifiers });
        if (controller.signal.aborted) break;
        const metric = toPrototypeMetric(computed, { modifiers: settings.modifiers });
        setMetricsResult(previous => ({ signature: pipelineSignature, items: (previous.signature === pipelineSignature ? previous.items.filter(item => item.frame !== index) : []).concat(metric) }));
        setMetricsJob({ signature: pipelineSignature, busy: true, message: (index + 1) + ' / ' + frames.length + ' frames computed' });
      }
      setMetricsJob(job => metricsAbort.current === controller && job.signature === pipelineSignature ? { ...job, busy: false, message: controller.signal.aborted ? 'Analysis cancelled' : frames.length + ' frames computed' } : job);
    } catch (error) { setMetricsJob(job => metricsAbort.current === controller && job.signature === pipelineSignature ? { ...job, busy: false, message: controller.signal.aborted ? 'Analysis cancelled' : error instanceof Error ? error.message : 'Trajectory analysis failed.' } : job); }
    finally { if (metricsAbort.current === controller) activeMetricsAnalysis.current = null; }
  };
  const computedMetrics = metricsResult.signature === pipelineSignature
    ? new Map(metricsResult.items.map(item => [item.frame, item]))
    : new Map<number, TimelineMetric>();
  const metrics = {
    trajectoryId: source.id,
    numFrames: frames.length,
    // Keep the time axis complete, but leave scientific values blank until that
    // exact frame has run through the active pipeline.
    timeline: frames.map(frame => computedMetrics.get(frame.index) ?? {
      frame: frame.index,
      timestep: frame.timestep ?? frame.index,
      phases: {},
      avgPotentialEnergy: null,
    }),
  };
  const importFile = (file: File) => {
    if (!hasActiveProject) { setMessage('Create or open an MD project before importing a trajectory.'); return; }
    const personalImportReady = Boolean(cloudProjectId && ['connected', 'available'].includes(computeStatus?.status ?? '') && computeStatus?.capabilities?.includes('md-analysis'));
    const maximumBytes = personalImportReady ? 64 * 1024**3 : 64 * 1024 * 1024;
    if (file.size > maximumBytes) {
      setMessage(personalImportReady
        ? 'The selected compute accepts source files up to 64 GiB, within your storage allowance.'
        : 'Files above 64 MiB need a cloud MD project and available personal or funded Cloud compute.');
      return;
    }
    void activate(file, file.name, ownerId + ':' + crypto.randomUUID(), project, defaultMdSettings(), true);
  };
  const exportData = async (format: 'xyz' | 'dump' | 'cif' | 'poscar' | 'xsf' | 'png' | 'glb') => {
    setExporting(true); setExportingFormat(format); setPlaying(false);
    try {
      const name = source.name.replace(/\.[^.]+$/, '') + '-frame-' + (analysis.frame.index + 1);
      if (format === 'png' || format === 'glb') {
        if (!exportRef.current) throw new Error('Viewport is not ready.');
        const blob = await exportRef.current(format); downloadMdFile(name + '.' + format, blob, blob.type);
      } else if (format === 'dump') {
        downloadMdFile(name + '.dump', frameLammpsDump(analysis.frame));
      } else {
        if (format !== 'xyz' && analysis.frame.species.some(s => !isMdElement(s))) throw new Error('Map particle types to chemical elements in Display before exporting a crystal format.');
        const structure = frameStructure(analysis.frame, name);
        const content = format === 'xyz' ? frameXyz(analysis.frame, name) : format === 'cif' ? createCIF(name, structure.atoms, structure.lattice) : format === 'poscar' ? createPOSCAR(name, structure.atoms, structure.lattice) : createXSF(name, structure.atoms, structure.lattice);
        downloadMdFile(name + '.' + (format === 'poscar' ? 'vasp' : format), content);
      }
      setMessage('Exported frame ' + (analysis.frame.index + 1));
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Export failed.'); }
    finally { setExporting(false); setExportingFormat(null); }
  };
  const deleteRecord = async (record: MdTrajectoryRecord) => {
    try {
      parsedCacheRef.current.delete(record.id);
      await removeMdTrajectory(ownerId, record.id);
      setRecords(items => items.filter(r => r.id !== record.id));
      setMessage('Removed saved trajectory ' + record.name);
    }
    catch { setMessage('Could not remove the saved trajectory.'); }
  };
  const createCloudProject = async (requestedName: string, openEmpty = false): Promise<boolean> => {
    const name = requestedName.trim().slice(0, 200);
    if (!name) return false;
    const duplicate = cloudProjects.some(item => item.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)
      || recordsRef.current.some(record => !record.cloud && recordProjectName(record).localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
    if (duplicate) {
      const detail = `A project named ${name} already exists.`;
      setCloudError(detail); setMessage(detail);
      return false;
    }
    setCloudAction('project'); setCloudError('');
    try {
      const { project: created } = await phyniteProjects.create({ name, description: 'Molecular dynamics trajectories', tags: ['MD'] });
      setCloudProjects(items => [created, ...items.filter(item => item.id !== created.id)]);
      setCloudProjectId(created.id); setProject(created.name);
      if (openEmpty) {
        ++loadSequence.current;
        setCloudTrajectories([]); setFrames([]); setSourceFile(null);
        setSource({ id: '', name: 'Choose a cloud trajectory or import a file', project: created.name });
        setCurrent(0); setPlaying(false); setSelection([]); setResult(null); setAnalysisError(''); setImportWarnings([]);
        setActiveCloud(undefined); setCloudSyncedSettings(''); setHistory({ past: [], present: defaultPipeline(), future: [] }); setSimulationComponents([]); setConfiguringSimulationId(null); setLoading(false);
      } else {
        setSource(currentSource => ({ ...currentSource, project: created.name }));
      }
      const url = new URL(window.location.href); url.searchParams.set('project', created.id); url.searchParams.delete('trajectory'); window.history.replaceState(window.history.state, '', url);
      setMessage(`Created ${created.name}`);
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Could not create the project.';
      setCloudError(detail); setMessage(detail);
      return false;
    }
    finally { setCloudAction(''); }
  };
  const persistCloudWorkspace = useCallback(async () => {
    if (cloudSaveInFlight.current) {
      cloudSaveQueued.current = true;
      await new Promise<void>(resolve => cloudSaveWaiters.current.push(resolve));
      return;
    }
    cloudSaveInFlight.current = true;
    setCloudSaving(true);
    setCloudError('');
    try {
      do {
        cloudSaveQueued.current = false;
        const snapshot = cloudAutosaveRef.current;
        const file = snapshot.sourceFile;
        const currentSource = snapshot.source;
        const projectId = snapshot.cloudProjectId;
        if ((!file && !snapshot.activeCloud) || !currentSource.id || !projectId) break;

        const currentSettings = snapshot.settings;
        const simulationWorkflow = createMdSimulationWorkflowV2(snapshot.simulationComponents);
        const studioSettings = toMdCloudStudioSettings(
          currentSettings,
          legacyMdStudioApi.current || !snapshot.simulationComponents.length ? undefined : simulationWorkflow,
        );
        const legacyStudioSettings = toMdCloudStudioSettings(currentSettings);
        const settingsStamp = workspaceSignature(currentSettings, simulationWorkflow);
        const existing = recordsRef.current.find(record => record.id === currentSource.id);
        const linkedCloud = snapshot.activeCloud?.projectId === projectId ? snapshot.activeCloud : undefined;
        const sourceFilename = existing?.sourceFilename
          ?? snapshot.cloudTrajectories.find(item => item.id === linkedCloud?.trajectoryId)?.filename
          ?? currentSource.name;
        let sha256 = linkedCloud?.sha256 ?? '';
        let trajectory: MdCloudTrajectory;

        if (linkedCloud) {
          const mutationId = await mdCloudSaveKey(projectId, linkedCloud.trajectoryId, settingsStamp, currentSource.name);
          const revision = linkedCloud.revision ?? 0;
          try {
            trajectory = (await cloudClient.updateTrajectory(linkedCloud.trajectoryId, {
              name: currentSource.name,
              studioSettings,
              baseRevision: revision,
              clientMutationId: mutationId,
            })).trajectory;
          } catch (error) {
            if (!(error instanceof PhyniteApiError)
              || error.code !== 'INVALID_MD_STUDIO_SETTINGS'
              || studioSettings.version !== 2) throw error;
            // A deployed version-1 API can still persist display and analysis
            // settings. Keep the workflow in the device cache, and try version 2
            // again after the next page load once the backend has been upgraded.
            legacyMdStudioApi.current = true;
            trajectory = (await cloudClient.updateTrajectory(linkedCloud.trajectoryId, {
              name: currentSource.name,
              studioSettings: legacyStudioSettings,
              baseRevision: revision,
              clientMutationId: mutationId,
            })).trajectory;
          }
        } else {
          if (!file) throw new Error("The original trajectory must be selected before uploading.");
          sha256 = await mdCloudSha256(file);
          const createInput = {
            filename: sourceFilename,
            name: currentSource.name,
            contentType: mdCloudContentType(sourceFilename, file.type),
            sizeBytes: file.size,
            sha256,
            idempotencyKey: await mdCloudSaveKey(projectId, sha256, sourceFilename, currentSource.id),
            studioSettings,
          };
          let created;
          try {
            created = await cloudClient.createTrajectory(projectId, createInput);
          } catch (error) {
            if (!(error instanceof PhyniteApiError)
              || error.code !== 'INVALID_MD_STUDIO_SETTINGS'
              || studioSettings.version !== 2) throw error;
            legacyMdStudioApi.current = true;
            created = await cloudClient.createTrajectory(projectId, {
              ...createInput,
              studioSettings: legacyStudioSettings,
            });
          }
          trajectory = created.trajectory;
          if (created.upload) {
            await cloudClient.uploadTrajectory(created.upload, file);
            trajectory = (await cloudClient.completeTrajectory(trajectory.id, {
              sizeBytes: file.size,
              sha256,
            })).trajectory;
          }
          const settingsForServer = legacyMdStudioApi.current ? legacyStudioSettings : studioSettings;
          const mutationId = await mdCloudSaveKey(projectId, trajectory.id, settingsStamp, currentSource.name);
          trajectory = (await cloudClient.updateTrajectory(trajectory.id, {
            name: currentSource.name,
            studioSettings: settingsForServer,
            baseRevision: trajectory.revision,
            clientMutationId: mutationId,
          })).trajectory;
        }

        const cloud = {
          trajectoryId: trajectory.id,
          projectId,
          sha256,
          uploadedAt: trajectory.uploadedAt ?? new Date().toISOString(),
          settingsSignature: settingsStamp,
          revision: trajectory.revision,
        };
        if (file) {
        const record: MdTrajectoryRecord = {
          id: currentSource.id,
          owner: ownerId,
          projectId,
          projectName: currentSource.project,
          name: currentSource.name,
          sourceFilename,
          file,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          settings: currentSettings,
          simulationWorkflow,
          cloud,
          syncState: 'synced',
          syncError: undefined,
        };
        await saveMdTrajectory(record);
        setRecords(items => items.filter(item => item.id !== record.id).concat(record));
        }
        setCloudTrajectories(items => [trajectory, ...items.filter(item => item.id !== trajectory.id)]);

        const latest = cloudAutosaveRef.current;
        if (latest.source.id === currentSource.id && latest.cloudProjectId === projectId) {
          cloudAutosaveRef.current = { ...latest, activeCloud: cloud };
          setActiveCloud(cloud);
          setCloudSyncedSettings(settingsStamp);
        }
      } while (cloudSaveQueued.current);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Could not save this trajectory to cloud.';
      const failedSnapshot = cloudAutosaveRef.current;
      const existing = recordsRef.current.find(record => record.id === failedSnapshot.source.id);
      if (existing) {
        const conflict = error instanceof PhyniteApiError && error.code === 'MD_TRAJECTORY_CONFLICT';
        const preserved: MdTrajectoryRecord = {
          ...existing,
          projectId: failedSnapshot.cloudProjectId || existing.projectId,
          projectName: failedSnapshot.source.project || recordProjectName(existing),
          settings: failedSnapshot.settings,
          simulationWorkflow: createMdSimulationWorkflowV2(failedSnapshot.simulationComponents),
          syncState: conflict ? 'conflict' : 'pending',
          syncError: detail,
        };
        await saveMdTrajectory(preserved).catch(() => undefined);
        setRecords(items => items.map(item => item.id === preserved.id ? preserved : item));
      }
      setCloudError(detail);
      setMessage(error instanceof PhyniteApiError && error.code === 'MD_TRAJECTORY_CONFLICT'
        ? 'Cloud changed in another session. Your device copy was preserved.'
        : `Saved on this device. Cloud sync will retry when the connection is available. ${detail}`);
    } finally {
      cloudSaveInFlight.current = false;
      setCloudSaving(false);
      cloudSaveWaiters.current.splice(0).forEach(resolve => resolve());
    }
  }, [cloudClient, ownerId]);
  useEffect(() => {
    if (!deviceHydrated || !cloudReady || cloudLoading || !online || legacyMigrationInFlight.current) return;
    const candidate = records.find(record => (
      !record.cloud
      && (record.syncState === undefined || record.syncState === 'pending')
      && record.id !== source.id
      && !legacyMigrationAttempts.current.has(record.id)
    ));
    if (!candidate) return;
    legacyMigrationAttempts.current.add(candidate.id);
    legacyMigrationInFlight.current = true;

    const migrate = async () => {
      const projectName = recordProjectName(candidate);
      let targetProject = cloudProjects.find(item => (
        item.id === candidate.projectId
        || item.name.localeCompare(projectName, undefined, { sensitivity: 'accent' }) === 0
      ));
      if (!targetProject) {
        try {
          targetProject = (await phyniteProjects.create({ name: projectName, description: 'Molecular dynamics trajectories', tags: ['MD'] })).project;
        } catch (error) {
          if (!(error instanceof PhyniteApiError) || error.status !== 409) throw error;
          const refreshed = (await phyniteProjects.list()).projects.filter(isMdCloudProject);
          setCloudProjects(refreshed);
          targetProject = refreshed.find(item => item.name.localeCompare(projectName, undefined, { sensitivity: 'accent' }) === 0);
          if (!targetProject) throw error;
        }
        setCloudProjects(items => [targetProject!, ...items.filter(item => item.id !== targetProject!.id)]);
      }

      const workflow = candidate.simulationWorkflow ?? createMdSimulationWorkflowV2([]);
      const settingsStamp = workspaceSignature(candidate.settings, workflow);
      let inventory = cloudTrajectoryInventory.current.get(targetProject.id)?.trajectories;
      if (!inventory) {
        inventory = (await cloudClient.listTrajectories(targetProject.id)).trajectories;
        cloudTrajectoryInventory.current.set(targetProject.id, { trajectories: inventory, loadedAt: Date.now() });
        setCloudProjectTrajectoryCounts(counts => ({ ...counts, [targetProject.id]: inventory!.length }));
        if (targetProject.id === cloudProjectId) setCloudTrajectories(inventory);
      }
      const existingMatches = inventory.filter(trajectory => (
        trajectory.status === 'READY' && mdRecordMatchesCloudSource(candidate, trajectory)
      ));
      if (existingMatches.length === 1) {
        const trajectory = existingMatches[0];
        const cloudSettings = fromMdCloudStudioSettings(trajectory.studioSettings);
        const cloudWorkflow = fromMdCloudSimulationWorkflow(trajectory.studioSettings) ?? createMdSimulationWorkflowV2([]);
        const cloudSignature = workspaceSignature(cloudSettings, cloudWorkflow);
        const relinked: MdTrajectoryRecord = {
          ...candidate,
          projectId: targetProject.id,
          projectName: targetProject.name,
          cloud: {
            trajectoryId: trajectory.id,
            projectId: targetProject.id,
            sha256: trajectory.sha256,
            uploadedAt: trajectory.uploadedAt ?? trajectory.updatedAt,
            settingsSignature: cloudSignature,
            revision: trajectory.revision,
          },
          syncState: cloudSignature === settingsStamp ? 'synced' : 'pending',
          syncError: undefined,
        };
        await saveMdTrajectory(relinked).catch(() => undefined);
        setRecords(items => items.map(item => item.id === relinked.id ? relinked : item));
        return;
      }
      if (existingMatches.length > 1) {
        const ambiguous: MdTrajectoryRecord = {
          ...candidate,
          syncState: 'conflict',
          syncError: 'Multiple cloud trajectories match this legacy device source. Open the intended cloud entry to relink it.',
        };
        await saveMdTrajectory(ambiguous).catch(() => undefined);
        setRecords(items => items.map(item => item.id === ambiguous.id ? ambiguous : item));
        return;
      }
      const sha256 = await mdCloudSha256(candidate.file);
      const sourceFilename = candidate.sourceFilename ?? candidate.name;
      const created = await cloudClient.createTrajectory(targetProject.id, {
        filename: sourceFilename,
        name: candidate.name,
        contentType: mdCloudContentType(sourceFilename, candidate.file.type),
        sizeBytes: candidate.file.size,
        sha256,
        idempotencyKey: await mdCloudSaveKey(targetProject.id, sha256, sourceFilename, candidate.id),
        studioSettings: toMdCloudStudioSettings(candidate.settings, candidate.simulationWorkflow),
      });
      let trajectory = created.trajectory;
      if (created.upload) {
        await cloudClient.uploadTrajectory(created.upload, candidate.file);
        trajectory = (await cloudClient.completeTrajectory(trajectory.id, { sizeBytes: candidate.file.size, sha256 })).trajectory;
      }
      trajectory = (await cloudClient.updateTrajectory(trajectory.id, {
        name: candidate.name,
        studioSettings: toMdCloudStudioSettings(candidate.settings, candidate.simulationWorkflow),
        baseRevision: trajectory.revision,
        clientMutationId: await mdCloudSaveKey(targetProject.id, trajectory.id, settingsStamp, candidate.name),
      })).trajectory;
      const migrated: MdTrajectoryRecord = {
        ...candidate,
        projectId: targetProject.id,
        projectName: targetProject.name,
        cloud: {
          trajectoryId: trajectory.id,
          projectId: targetProject.id,
          sha256,
          uploadedAt: trajectory.uploadedAt ?? trajectory.updatedAt,
          settingsSignature: settingsStamp,
          revision: trajectory.revision,
        },
        syncState: 'synced',
        syncError: undefined,
      };
      await saveMdTrajectory(migrated);
      setRecords(items => items.map(item => item.id === migrated.id ? migrated : item));
      setCloudProjectTrajectoryCounts(counts => ({ ...counts, [targetProject.id]: (counts[targetProject.id] ?? 0) + 1 }));
    };

    void migrate().catch(async (error) => {
      const detail = error instanceof Error ? error.message : 'Cloud migration failed.';
      const failed: MdTrajectoryRecord = {
        ...candidate,
        syncState: error instanceof PhyniteApiError && error.code === 'MD_TRAJECTORY_CONFLICT' ? 'conflict' : 'pending',
        syncError: detail,
      };
      await saveMdTrajectory(failed).catch(() => undefined);
      setRecords(items => items.map(item => item.id === failed.id ? failed : item));
    }).finally(() => {
      legacyMigrationInFlight.current = false;
    });
  }, [cloudClient, cloudLoading, cloudProjectId, cloudProjects, cloudReady, deviceHydrated, online, records, source.id]);
  const openCloudTrajectory = useCallback(async (trajectory: MdCloudTrajectory, cachedFallback?: MdTrajectoryRecord) => {
    const sequence = ++loadSequence.current;
    activeLoadAbort.current?.abort();
    const controller = new AbortController();
    activeLoadAbort.current = controller;
    setCloudAction(`open:${trajectory.id}`); setCloudError(''); setPlaying(false);
    const ensureCurrent = () => {
      if (controller.signal.aborted || sequence !== loadSequence.current) {
        throw new DOMException('The operation was cancelled.', 'AbortError');
      }
    };
    try {
      const detail = await cloudClient.getTrajectory(trajectory.id);
      ensureCurrent();
      if (!detail.downloadUrl) throw new Error('This trajectory has not finished uploading.');
      let file: Blob | null = null;
      let sha256 = trajectory.sha256;
      // The original stays in owner-scoped storage. Large sources are opened
      // from verified frame shards without materializing the whole file here.
      if (trajectory.sizeBytes <= 64 * 1024**2) {
      file = await downloadMdCloudFile(detail.downloadUrl, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
      });
      ensureCurrent();
      if (file.size !== trajectory.sizeBytes) throw new Error('The downloaded trajectory size does not match its cloud record.');
      sha256 = await mdCloudSha256(file);
      ensureCurrent();
      if (sha256 !== trajectory.sha256) throw new Error('The downloaded trajectory checksum does not match its cloud record.');
      }
      const cloudSettings = fromMdCloudStudioSettings(detail.trajectory.studioSettings);
      const cloudWorkflow = fromMdCloudSimulationWorkflow(detail.trajectory.studioSettings);
      const initial = cachedFallback?.settings ?? cloudSettings;
      const initialWorkflow = cachedFallback?.simulationWorkflow ?? cloudWorkflow;
      const cloud = {
        trajectoryId: trajectory.id,
        projectId: trajectory.projectId,
        sha256,
        uploadedAt: trajectory.uploadedAt ?? trajectory.updatedAt,
        settingsSignature: workspaceSignature(cloudSettings, cloudWorkflow ?? createMdSimulationWorkflowV2([])),
        revision: detail.trajectory.revision,
      };
      const projectName = cloudProjects.find(item => item.id === trajectory.projectId)?.name ?? 'Cloud project';
      ensureCurrent();
      setCloudProjectId(trajectory.projectId);
      const url = new URL(window.location.href); url.searchParams.set('project', trajectory.projectId); url.searchParams.set('trajectory', trajectory.id); window.history.replaceState(window.history.state, '', url);
      const targetRecordId = cachedFallback?.id ?? `cloud:${ownerId}:${trajectory.id}`;
      const previousParsed = cachedFallback ? parsedCacheRef.current.get(targetRecordId) : undefined;
      if (cachedFallback) parsedCacheRef.current.delete(targetRecordId);
      const opened = await activate(
        file,
        cachedFallback?.sourceFilename ?? trajectory.filename,
        targetRecordId,
        projectName,
        initial,
        true,
        sequence,
        cloud,
        cachedFallback?.name || trajectory.name || trajectory.filename,
        initialWorkflow,
        controller,
      );
      if (!opened && previousParsed) parsedCacheRef.current.set(targetRecordId, previousParsed);
      if (opened) setMessage(`Opened ${trajectory.filename} from cloud`);
      return opened;
    } catch (error) {
      if (sequence === loadSequence.current && !controller.signal.aborted) {
        const detail = error instanceof Error
          ? (error.message === 'Load failed' ? 'Could not download the cloud file. Please retry.' : error.message)
          : 'Could not open this cloud trajectory.';
        setCloudError(detail);
        setMessage(detail);
      }
      return false;
    } finally {
      if (sequence === loadSequence.current) setCloudAction('');
      if (activeLoadAbort.current === controller) activeLoadAbort.current = null;
    }
  }, [activate, cloudClient, cloudProjects, ownerId]);
  const openCachedCloudTrajectory = useCallback(async (cached: MdTrajectoryRecord, trajectory: MdCloudTrajectory) => {
    const sequence = ++loadSequence.current;
    activeLoadAbort.current?.abort();
    const controller = new AbortController();
    activeLoadAbort.current = controller;
    const projectName = cloudProjects.find(item => item.id === trajectory.projectId)?.name ?? recordProjectName(cached);
    const opened = await activate(
      cached.file,
      cached.sourceFilename ?? cached.name,
      cached.id,
      projectName,
      cached.settings,
      false,
      sequence,
      cached.cloud,
      cached.name,
      cached.simulationWorkflow,
      controller,
    );
    if (opened) {
      const url = new URL(window.location.href);
      url.searchParams.set('project', trajectory.projectId);
      url.searchParams.set('trajectory', trajectory.id);
      window.history.replaceState(window.history.state, '', url);
      return;
    }
    if (controller.signal.aborted || sequence !== loadSequence.current) return;
    parsedCacheRef.current.delete(cached.id);
    await openCloudTrajectory(trajectory, cached);
  }, [activate, cloudProjects, openCloudTrajectory]);
  useEffect(() => {
    if (routeTrajectoryHandled.current || !initialCloudTrajectory.current || !cloudReady || cloudLoading) return;
    if (!cloudProjectId || loadedCloudTrajectoryProject.current !== cloudProjectId) {
      if (cloudProjectId) return;
      routeTrajectoryHandled.current = true;
      initialCloudTrajectory.current = '';
      const url = new URL(window.location.href);
      url.searchParams.delete('trajectory');
      window.history.replaceState(window.history.state, '', url);
      setMessage('That trajectory link is incomplete. Choose a cloud MD project.');
      return;
    }
    routeTrajectoryHandled.current = true;
    const requestedId = initialCloudTrajectory.current;
    initialCloudTrajectory.current = '';
    const trajectory = resolveMdRouteTrajectory(cloudProjectId, requestedId, cloudTrajectories);
    if (!trajectory) {
      const url = new URL(window.location.href);
      url.searchParams.delete('trajectory');
      window.history.replaceState(window.history.state, '', url);
      setMessage('That trajectory does not belong to this project or is no longer available.');
      return;
    }
    void openCloudTrajectory(trajectory);
  }, [cloudLoading, cloudProjectId, cloudReady, cloudTrajectories, openCloudTrajectory]);
  const deleteCloudTrajectory = async (trajectory: MdCloudTrajectory) => {
    if (!window.confirm(`Delete ${trajectory.filename} from cloud? The device copy will remain available.`)) return;
    setCloudAction(`delete:${trajectory.id}`); setCloudError('');
    try {
      await cloudClient.deleteTrajectory(trajectory.id);
      setCloudTrajectories(items => items.filter(item => item.id !== trajectory.id));
      const linked = recordsRef.current.filter(item => item.cloud?.trajectoryId === trajectory.id);
      if (linked.length) {
        const updated = linked.map((record): MdTrajectoryRecord => {
          const local: MdTrajectoryRecord = {
            ...record,
            projectId: recordProjectName(record),
            syncState: 'local',
            syncError: undefined,
          };
          delete local.cloud;
          return local;
        });
        await saveMdTrajectories(updated);
        const updatedById = new Map(updated.map(record => [record.id, record]));
        setRecords(items => items.map(item => updatedById.get(item.id) ?? item));
      }
      if (activeCloud?.trajectoryId === trajectory.id) {
        setActiveCloud(undefined); setCloudSyncedSettings('');
        const url = new URL(window.location.href); url.searchParams.delete('trajectory'); window.history.replaceState(window.history.state, '', url);
      }
      setMessage(`Deleted ${trajectory.filename} from cloud`);
    } catch (error) { setCloudError(error instanceof Error ? error.message : 'Could not delete this cloud trajectory.'); }
    finally { setCloudAction(''); }
  };
  const clearOpenWorkspace = (nextProject = 'MD research') => {
    activeLoadAbort.current?.abort();
    ++loadSequence.current;
    setCloudProjectId(''); setCloudTrajectories([]); setProject(nextProject);
    setFrames([]); setSourceFile(null); setSource({ id: '', name: 'Open a trajectory', project: nextProject });
    setCurrent(0); setPlaying(false); setSelection([]); setResult(null); setAnalysisError(''); setImportWarnings([]);
    setActiveCloud(undefined); setCloudSyncedSettings(''); setHistory({ past: [], present: defaultPipeline(), future: [] }); setSimulationComponents([]); setConfiguringSimulationId(null); setLoading(false);
    const url = new URL(window.location.href); url.searchParams.delete('project'); url.searchParams.delete('trajectory'); window.history.replaceState(window.history.state, '', url);
  };
  const deleteSidebarProject = async (id: string) => {
    if (cloudAction) return;
    if (id.startsWith('cloud:')) {
      const projectId = id.slice(6), cloudProject = cloudProjects.find(item => item.id === projectId);
      if (!cloudProject || !window.confirm(`Delete ${cloudProject.name}? Its cloud trajectories and cached device copies will be removed.`)) return;
      setCloudAction(`project:${projectId}`); setCloudError(''); setPlaying(false);
      try {
        await phyniteProjects.delete(projectId);
        const cached = recordsRef.current.filter(record => record.cloud?.projectId === projectId);
        await Promise.allSettled(cached.map(record => removeMdTrajectory(ownerId, record.id)));
        const cachedIds = new Set(cached.map(record => record.id));
        setRecords(items => items.filter(item => !cachedIds.has(item.id)));
        setCloudProjects(items => items.filter(item => item.id !== projectId));
        const deletingOpenCloudFile = activeCloud?.projectId === projectId || cachedIds.has(source.id);
        if (cloudProjectId === projectId) {
          setCloudProjectId(''); setCloudTrajectories([]);
          const url = new URL(window.location.href); url.searchParams.delete('project'); url.searchParams.delete('trajectory'); window.history.replaceState(window.history.state, '', url);
          if (deletingOpenCloudFile || !sourceFile) clearOpenWorkspace();
        } else if (deletingOpenCloudFile) clearOpenWorkspace();
        try {
          const lastActive = localStorage.getItem(mdLastActiveKey(ownerId));
          if (lastActive && cachedIds.has(lastActive)) localStorage.removeItem(mdLastActiveKey(ownerId));
        } catch {}
        setMessage(`Deleted ${cloudProject.name}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Could not delete this cloud project.';
        setCloudError(detail); setMessage(detail);
      } finally { setCloudAction(''); }
      return;
    }
    if (id.startsWith('device:')) {
      const projectName = id.slice(7);
      const saved = recordsRef.current.filter(record => recordProjectName(record) === projectName && !record.cloud);
      const noun = saved.length === 1 ? 'trajectory' : 'trajectories';
      if (!window.confirm(`Delete ${projectName} from this device? ${saved.length} saved ${noun} will be removed.`)) return;
      const savedIds = new Set(saved.map(record => record.id));
      try {
        await Promise.all(saved.map(record => removeMdTrajectory(ownerId, record.id)));
        setRecords(items => items.filter(item => !savedIds.has(item.id)));
        if (!cloudProjectId && project === projectName) clearOpenWorkspace();
        try {
          const lastActive = localStorage.getItem(mdLastActiveKey(ownerId));
          if (lastActive && savedIds.has(lastActive)) localStorage.removeItem(mdLastActiveKey(ownerId));
        } catch {}
        setMessage(`Deleted ${projectName} from this device`);
      } catch { setMessage(`Could not delete ${projectName} from this device.`); }
    }
  };
  const renameSidebarProject = async (id: string, requestedName: string): Promise<boolean> => {
    if (cloudAction) return false;
    const name = requestedName.trim().slice(0, 200);
    if (!name) return false;
    const nameIsUsedByCloud = cloudProjects.some(item => `cloud:${item.id}` !== id && item.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
    const nameIsUsedOnDevice = recordsRef.current.some(record => !record.cloud && `device:${recordProjectName(record)}` !== id && recordProjectName(record).localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
    if (nameIsUsedByCloud || nameIsUsedOnDevice) {
      setMessage(`A project named ${name} already exists.`);
      return false;
    }
    if (id.startsWith('cloud:')) {
      const projectId = id.slice(6);
      const currentProject = cloudProjects.find(item => item.id === projectId);
      if (!currentProject) return false;
      if (currentProject.name === name) return true;
      setCloudAction(`rename-project:${projectId}`); setCloudError('');
      try {
        const { project: updatedProject } = await phyniteProjects.update(projectId, { name });
        setCloudProjects(items => items.map(item => item.id === projectId ? updatedProject : item));
        const cached = recordsRef.current.filter(record => record.cloud?.projectId === projectId);
        const migrated = cached.map(record => ({ ...record, projectId, projectName: updatedProject.name }));
        if (cloudProjectId === projectId) {
          setProject(updatedProject.name);
          setSource(currentSource => ({ ...currentSource, project: updatedProject.name }));
        }
        try {
          await saveMdTrajectories(migrated);
          const migratedById = new Map(migrated.map(record => [record.id, record]));
          setRecords(items => items.map(record => migratedById.get(record.id) ?? record));
        } catch {
          setMessage(`Renamed project to ${updatedProject.name}. Its device cache will refresh from cloud when reopened.`);
          return true;
        }
        setMessage(`Renamed project to ${updatedProject.name}`);
        return true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Could not rename this cloud project.';
        setCloudError(detail); setMessage(detail);
        return false;
      } finally { setCloudAction(''); }
    }
    if (id.startsWith('device:')) {
      const previousName = id.slice(7);
      if (previousName === name) return true;
      const saved = recordsRef.current.filter(record => recordProjectName(record) === previousName && !record.cloud);
      if (!saved.length) return false;
      const migrated = saved.map(record => ({ ...record, projectId: name, projectName: name }));
      try {
        await saveMdTrajectories(migrated);
        const migratedById = new Map(migrated.map(record => [record.id, record]));
        setRecords(items => items.map(record => migratedById.get(record.id) ?? record));
        if (!cloudProjectId && project === previousName) {
          setProject(name);
          setSource(currentSource => ({ ...currentSource, project: name }));
        }
        setMessage(`Renamed project to ${name}`);
        return true;
      } catch {
        setMessage(`Could not rename ${previousName} on this device.`);
        return false;
      }
    }
    return false;
  };
  const renameSidebarTrajectory = async (id: string, requestedName: string): Promise<boolean> => {
    if (cloudAction) return false;
    const name = requestedName.trim().slice(0, 240);
    if (!name) return false;
    if (id.startsWith('remote:')) {
      const trajectoryId = id.slice(7);
      const trajectory = cloudTrajectories.find(item => item.id === trajectoryId);
      if (!trajectory) return false;
      if ((trajectory.name || trajectory.filename) === name) return true;
      setCloudAction(`rename-trajectory:${trajectoryId}`); setCloudError('');
      try {
        const mutationId = await mdCloudSaveKey(trajectory.projectId, trajectoryId, `rename:${name}`);
        const { trajectory: updated } = await cloudClient.updateTrajectory(trajectoryId, {
          name,
          baseRevision: trajectory.revision,
          clientMutationId: mutationId,
        });
        setCloudTrajectories(items => items.map(item => item.id === trajectoryId ? updated : item));
        const cached = recordsRef.current.filter(record => record.cloud?.trajectoryId === trajectoryId);
        const migrated = cached.map(record => ({
          ...record,
          name,
          sourceFilename: record.sourceFilename ?? trajectory.filename,
          cloud: record.cloud ? { ...record.cloud, revision: updated.revision } : record.cloud,
          syncState: 'synced' as const,
          syncError: undefined,
        }));
        if (activeCloud?.trajectoryId === trajectoryId) {
          setActiveCloud(current => current ? { ...current, revision: updated.revision } : current);
          setSource(currentSource => ({ ...currentSource, name }));
        }
        try {
          await saveMdTrajectories(migrated);
          const migratedById = new Map(migrated.map(record => [record.id, record]));
          setRecords(items => items.map(record => migratedById.get(record.id) ?? record));
        } catch {
          setMessage(`Renamed trajectory to ${name}. Its device cache will refresh from cloud when reopened.`);
          return true;
        }
        setMessage(`Renamed trajectory to ${name}`);
        return true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Could not rename this cloud trajectory.';
        setCloudError(detail); setMessage(detail);
        return false;
      } finally { setCloudAction(''); }
    }
    const record = recordsRef.current.find(item => item.id === id);
    if (!record) return false;
    if (record.name === name) return true;
    const updated = { ...record, name, sourceFilename: record.sourceFilename ?? record.name };
    try {
      await saveMdTrajectory(updated);
      setRecords(items => items.map(item => item.id === id ? updated : item));
      if (source.id === id) setSource(currentSource => ({ ...currentSource, name }));
      setMessage(`Renamed trajectory to ${name}`);
      return true;
    } catch {
      setMessage(`Could not rename ${record.name} on this device.`);
      return false;
    }
  };
  const time = frameTimePs(analysis.frame, current, settings.timeStepPs);
  const noticeCount = importWarnings.length + analysis.warnings.length;
  const deviceProjects = Array.from(new Set([
    ...records.filter(record => !record.cloud).map(recordProjectName),
    ...(!cloudProjectId && !activeCloud && sourceFile && project ? [project] : []),
  ]));
  const sidebarTrajectories = buildMdSidebarTrajectories(records, cloudTrajectories, project, cloudProjectId);
  const sidebarProjects = [
    ...cloudProjects.map(item => ({
      id: `cloud:${item.id}`,
      name: item.name,
      count: item.id === cloudProjectId
        ? sidebarTrajectories.length
        : cloudProjectTrajectoryCounts[item.id] ?? item.mdTrajectoryCount ?? null,
      storage: 'cloud' as const,
    })),
    ...deviceProjects.filter(name => !cloudProjects.some(item => item.name === name)).map(name => ({ id: `device:${name}`, name, count: records.filter(record => recordProjectName(record) === name && !record.cloud).length, storage: 'device' as const })),
  ];
  const selectedSidebarProject = cloudProjectId ? `cloud:${cloudProjectId}` : deviceProjects.includes(project) ? `device:${project}` : '';
  useEffect(() => {
    if (!integratedShell || !cloudReady || !cloudProjectId) return;
    let cancelled = false;
    void phyniteProjects.update(cloudProjectId, { lastOpenedAt: new Date().toISOString() }).then(({ project: opened }) => {
      if (!cancelled) setCloudProjects(items => items.map(item => item.id === opened.id ? opened : item));
    }).catch(() => { /* A failed activity update never changes trajectory state. */ });
    return () => { cancelled = true; };
  }, [integratedShell, cloudReady, cloudProjectId]);
  const hasActiveProject = Boolean(selectedSidebarProject);
  const simulationEligibility = mdSimulationEligibility({
    hasActiveProject,
    frameCount: frames.length,
    hasSourceFile: Boolean(sourceFile || activeCloud),
  });
  const hasActiveTrajectory = simulationEligibility.eligible;
  const selectedSidebarProjectName = sidebarProjects.find(item => item.id === selectedSidebarProject)?.name ?? project;
  useEffect(() => {
    if (!hasActiveTrajectory && panel !== 'inspect') {
      setPanel('inspect');
    }
    if (!hasActiveTrajectory && mobilePanel === 'inspector') {
      setMobilePanel(null);
    }
  }, [hasActiveTrajectory, mobilePanel, panel]);
  const selectedSidebarTrajectory = cloudProjectId
    && activeCloud
    && cloudTrajectories.some(item => item.id === activeCloud.trajectoryId)
    ? `remote:${activeCloud.trajectoryId}`
    : source.id;
  const selectSidebarProject = (id: string) => {
    if (id === selectedSidebarProject) {
      if (hasActiveTrajectory || loading || sourceFile || activeCloud) {
        activeLoadAbort.current?.abort();
        ++loadSequence.current;
        setFrames([]); setSourceFile(null); setSource({ id: '', name: 'Open a trajectory', project: selectedSidebarProjectName });
        setCurrent(0); setPlaying(false); setSelection([]); setResult(null); setAnalysisError(''); setImportWarnings([]);
        setActiveCloud(undefined); setCloudSyncedSettings(''); setHistory({ past: [], present: defaultPipeline(), future: [] }); setSimulationComponents([]); setConfiguringSimulationId(null); setLoading(false);
        const url = new URL(window.location.href);
        url.searchParams.delete('trajectory');
        window.history.replaceState(window.history.state, '', url);
        setMessage(`Selected ${selectedSidebarProjectName} · choose a trajectory to open`);
      }
      setMobilePanel(null);
      return;
    }
    if (id.startsWith('cloud:')) {
      const nextId = id.slice(6), next = cloudProjects.find(item => item.id === nextId);
      if (!next) return;
      ++loadSequence.current; setCloudProjectId(nextId); setProject(next.name); setCloudError(''); setCloudTrajectories([]);
      setFrames([]); setSourceFile(null); setSource({ id: '', name: 'Choose a cloud trajectory or import a file', project: next.name });
      setCurrent(0); setPlaying(false); setSelection([]); setResult(null); setAnalysisError(''); setImportWarnings([]);
      setActiveCloud(undefined); setCloudSyncedSettings(''); setHistory({ past: [], present: defaultPipeline(), future: [] }); setSimulationComponents([]); setConfiguringSimulationId(null); setLoading(false);
      setMessage(`Opened ${next.name}`);
      const url = new URL(window.location.href); url.searchParams.set('project', nextId); url.searchParams.delete('trajectory'); window.history.replaceState(window.history.state, '', url);
    } else if (id.startsWith('device:')) {
      const nextName = id.slice(7);
      setCloudProjectId(''); setProject(nextName); setCloudError(''); setCloudTrajectories([]);
      const url = new URL(window.location.href); url.searchParams.delete('project'); url.searchParams.delete('trajectory'); window.history.replaceState(window.history.state, '', url);
      ++loadSequence.current; setFrames([]); setSourceFile(null); setSource({ id: '', name: 'Open a trajectory', project: nextName });
      setCurrent(0); setPlaying(false); setSelection([]); setResult(null); setAnalysisError(''); setImportWarnings([]);
      setActiveCloud(undefined); setCloudSyncedSettings(''); setHistory({ past: [], present: defaultPipeline(), future: [] }); setSimulationComponents([]); setConfiguringSimulationId(null); setLoading(false);
      setMessage(`Selected ${nextName} · choose a trajectory to open`);
    }
    setMobilePanel(null);
  };
  const duplicateSidebarProject = async (id: string) => {
    if (id.startsWith('device:')) {
      const projectName = id.slice(7);
      const cleanName = projectName.replace(/ copy( \d+)?$/, '');
      const existingNames = new Set([
        ...deviceProjects,
        ...cloudProjects.map(p => p.name),
      ]);
      let targetName = `${cleanName} copy`;
      let count = 1;
      while (existingNames.has(targetName)) {
        count++;
        targetName = `${cleanName} copy ${count}`;
      }
      const saved = recordsRef.current.filter(record => recordProjectName(record) === projectName && !record.cloud);
      const copies: MdTrajectoryRecord[] = saved.map((record, index) => ({
        ...record,
        id: `${ownerId}:${Date.now()}_${index}:${record.sourceFilename ?? record.name}`,
        projectId: targetName,
        projectName: targetName,
        createdAt: new Date().toISOString(),
      }));
      if (copies.length > 0) {
        await saveMdTrajectories(copies);
        setRecords(items => [...items, ...copies]);
      }
      selectSidebarProject(`device:${targetName}`);
      setMessage(`Duplicated ${projectName} as ${targetName}`);
    } else if (id.startsWith('cloud:')) {
      const projectId = id.slice(6);
      const currentProject = cloudProjects.find(item => item.id === projectId);
      if (!currentProject) return;
      const cleanName = currentProject.name.replace(/ copy( \d+)?$/, '');
      const existingNames = new Set([
        ...cloudProjects.map(p => p.name),
        ...deviceProjects,
      ]);
      let targetName = `${cleanName} copy`;
      let count = 1;
      while (existingNames.has(targetName)) {
        count++;
        targetName = `${cleanName} copy ${count}`;
      }
      await createCloudProject(targetName, true);
      setMessage(`Duplicated project as ${targetName}`);
    }
  };
  const duplicateSidebarTrajectory = async (id: string) => {
    let sourceRecord = recordsRef.current.find(r => r.id === id);
    let trajectoryName = '';
    let sourceFilename = 'trajectory';
    let fileBlob: Blob | null = null;
    let initialSettings = defaultPipeline();
    let initialWorkflow: MdSimulationWorkflowV2 | undefined;
    let targetProject = project;
    let targetProjectId = cloudProjectId;

    if (id.startsWith('remote:')) {
      const trajectoryId = id.slice(7);
      const cached = recordsRef.current.find(r => r.cloud?.trajectoryId === trajectoryId);
      if (cached) {
        sourceRecord = cached;
      } else {
        const traj = cloudTrajectories.find(item => item.id === trajectoryId);
        if (!traj) return;
        setCloudAction(`duplicate-trajectory:${trajectoryId}`);
        try {
          const detail = await cloudClient.getTrajectory(trajectoryId);
          if (!detail.downloadUrl) throw new Error('File not available.');
          try {
            const response = await fetch(detail.downloadUrl);
            if (!response.ok) throw new Error('Download failed.');
            fileBlob = await response.blob();
          } catch {
            const proxyUrl = `/api/md-cloud-download?url=${encodeURIComponent(detail.downloadUrl)}`;
            const proxyResponse = await fetch(proxyUrl);
            if (!proxyResponse.ok) throw new Error('Download failed.');
            fileBlob = await proxyResponse.blob();
          }
          sourceFilename = traj.filename;
          trajectoryName = traj.name || traj.filename;
          initialSettings = fromMdCloudStudioSettings(detail.trajectory.studioSettings);
          initialWorkflow = fromMdCloudSimulationWorkflow(detail.trajectory.studioSettings);
          targetProject = cloudProjects.find(item => item.id === traj.projectId)?.name ?? project;
          targetProjectId = traj.projectId;
        } catch (err) {
          setMessage(err instanceof Error ? err.message : 'Could not duplicate cloud trajectory.');
          return;
        } finally {
          setCloudAction('');
        }
      }
    }

    if (sourceRecord) {
      fileBlob = sourceRecord.file;
      sourceFilename = sourceRecord.sourceFilename ?? sourceRecord.name;
      trajectoryName = sourceRecord.name;
      initialSettings = sourceRecord.settings;
      initialWorkflow = sourceRecord.simulationWorkflow;
      targetProject = recordProjectName(sourceRecord);
      targetProjectId = sourceRecord.cloud?.projectId ?? (cloudProjectId || '');
    }

    if (!fileBlob) return;

    const base = trajectoryName || sourceFilename;
    const cleanBase = base.replace(/ copy( \d+)?$/, '');
    const occupiedNames = new Set(recordsRef.current.filter(r => (
      targetProjectId ? r.cloud?.projectId === targetProjectId || r.projectId === targetProjectId : recordProjectName(r) === targetProject
    )).map(r => r.name));
    let newName = `${cleanBase} copy`;
    let count = 1;
    while (occupiedNames.has(newName)) {
      count++;
      newName = `${cleanBase} copy ${count}`;
    }

    const newId = `${ownerId}:${Date.now()}:${sourceFilename}`;
    const copyRecord: MdTrajectoryRecord = {
      id: newId,
      owner: ownerId,
      projectId: targetProjectId || targetProject,
      projectName: targetProject,
      name: newName,
      sourceFilename,
      file: fileBlob,
      createdAt: new Date().toISOString(),
      settings: initialSettings,
      syncState: targetProjectId ? 'pending' : 'local',
      ...(initialWorkflow ? { simulationWorkflow: initialWorkflow } : {}),
    };

    try {
      await saveMdTrajectory(copyRecord);
      setRecords(items => items.filter(r => r.id !== newId).concat(copyRecord));
      void activate(
        copyRecord.file,
        sourceFilename,
        copyRecord.id,
        targetProject,
        initialSettings,
        false,
        undefined,
        undefined,
        newName,
        initialWorkflow,
        undefined,
        targetProjectId || undefined,
      );
      setMessage(`Duplicated ${newName}`);
    } catch {
      setMessage('Failed to duplicate trajectory.');
    }
  };
  const importFromMaterialsProject = async (incoming: MaterialsProjectMaterial[]) => {
    if (!incoming.length || !hasActiveProject) return;
    setMaterialsProjectOpen(false);
    for (let i = 0; i < incoming.length; i++) {
      const material = incoming[i];
      const name = `${material.formula}-${material.materialId}`;
      const cifContent = material.sourceData.format === 'cif' ? material.sourceData.content : createCIF(name, material.atoms, material.lattice);
      const blob = new Blob([cifContent], { type: 'text/plain' });
      const fileName = `${name}.cif`;
      const file = new File([blob], fileName, { type: 'text/plain' });
      const id = `${ownerId}:${Date.now()}_${i}:${fileName}`;
      const databaseSource = { sourceData: material.sourceData, provenance: material.provenance };
      if (i === incoming.length - 1) {
        const opened = await activate(file, fileName, id, project, defaultPipeline(), true, undefined, undefined, fileName, undefined, undefined, undefined, databaseSource);
        if (!opened) throw new Error(`Could not open ${material.materialId} in MD Lab. The database source was not substituted.`);
      } else {
        const record: MdTrajectoryRecord = {
          id,
          owner: ownerId,
          projectId: cloudProjectId || project,
          projectName: project,
          name: fileName,
          sourceFilename: fileName,
          databaseSource,
          file,
          createdAt: new Date().toISOString(),
          settings: defaultPipeline(),
          syncState: cloudProjectId ? 'pending' : 'local',
        };
        await saveMdTrajectory(record);
        setRecords(items => items.filter(item => item.id !== id).concat(record));
      }
    }
    setMessage(`Imported ${incoming.length} structure${incoming.length > 1 ? 's' : ''} from ${incoming[0]?.source ?? 'crystal database'}`);
  };
  const currentSimulationWorkflow = useMemo(() => createMdSimulationWorkflowV2(simulationComponents), [simulationComponents]);
  const currentWorkspaceSignature = useMemo(() => workspaceSignature(settings, currentSimulationWorkflow), [currentSimulationWorkflow, settings]);
  const cloudSynced = !!activeCloud && cloudSyncedSettings === currentWorkspaceSignature;
  const cloudProjectConnected = !!cloudProjectId && cloudProjects.some(item => item.id === cloudProjectId);
  const hasOpenTrajectory = Boolean((sourceFile || activeCloud) && source.id && frames.length);
  const activeRecord = hasOpenTrajectory ? records.find(record => record.id === source.id) : undefined;
  const savedOnDevice = Boolean(activeRecord);
  const cloudAutosaveSignature = hasOpenTrajectory && cloudProjectConnected
    ? `${source.id}\0${source.name}\0${cloudProjectId}\0${currentWorkspaceSignature}`
    : '';
  useEffect(() => {
    if (!cloudAutosaveSignature || loading || cloudAction || cloudSynced || activeRecord?.syncState === 'conflict' || activeRecord?.syncState === 'local') return;
    const timer = window.setTimeout(() => void persistCloudWorkspace(), activeCloud ? 650 : 900);
    return () => window.clearTimeout(timer);
  }, [activeCloud, activeRecord?.syncState, cloudAction, cloudAutosaveSignature, cloudSynced, loading, persistCloudWorkspace]);

  useEffect(() => {
    const handleOnline = () => {
      legacyMigrationAttempts.current.clear();
      setOnline(true);
      const current = recordsRef.current.find(record => record.id === cloudAutosaveRef.current.source.id);
      if (current?.syncState === 'pending' && cloudAutosaveRef.current.cloudProjectId) void persistCloudWorkspace();
    };
    const handleOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [persistCloudWorkspace]);

  useWorkspaceSaveShortcut(async () => {
    if (!hasActiveProject) {
      setMessage('Choose or create an MD project before saving');
      return;
    }
    if (!hasOpenTrajectory) {
      setMessage('Open a trajectory before saving');
      return;
    }
    await persistCloudWorkspace();
  });

  useEffect(() => {
    if (!mobilePanel) return;
    const closePanel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobilePanel(null);
    };
    window.addEventListener('keydown', closePanel);
    return () => window.removeEventListener('keydown', closePanel);
  }, [mobilePanel]);
  useEffect(() => {
    const reconcilePanels = () => {
      if (window.innerWidth >= 1280) setMobilePanel(null);
      else if (window.innerWidth >= 1024) setMobilePanel(currentPanel => currentPanel === 'inspector' ? null : currentPanel);
    };
    window.addEventListener('resize', reconcilePanels);
    return () => window.removeEventListener('resize', reconcilePanels);
  }, []);

  const headerSaveState: WorkspaceSaveState = cloudSaving || saving || (!hasOpenTrajectory && cloudLoading)
    ? 'saving'
    : activeRecord?.syncState === 'conflict'
      ? 'conflict'
    : cloudSynced || (!hasOpenTrajectory && cloudReady)
      ? 'synced'
      : hasOpenTrajectory && !savedOnDevice
        ? 'error'
        : activeRecord?.syncState === 'pending' || (hasOpenTrajectory && cloudProjectConnected && !cloudSynced)
          ? 'pending'
          : 'local';
  const headerSaveLabel = cloudSaving
    ? activeCloud ? 'Saving to cloud...' : 'Uploading to cloud...'
    : saving
      ? 'Saving...'
      : activeRecord?.syncState === 'conflict'
        ? 'Sync conflict'
      : cloudSynced
        ? 'Saved to cloud'
        : activeRecord?.syncState === 'pending' || (activeCloud && !cloudSynced)
          ? online ? 'Saved on device · Sync pending' : 'Saved on device · Offline'
          : savedOnDevice
            ? 'Saved on device'
            : hasOpenTrajectory
              ? 'Not saved'
              : cloudLoading
                ? 'Checking cloud...'
                : cloudReady
                  ? 'Cloud ready'
                  : 'Cloud unavailable';
  const refreshSimulationJobs = useCallback(async () => {
    if (!cloudProjectId) {
      setSimulationJobs([]);
      return;
    }
    try {
      const { simulations } = await phyniteMdSimulations.list(cloudProjectId);
      setSimulationJobs(simulations);
    } catch (error) {
      // A frontend can briefly be newer than the deployed control plane. Keep
      // project browsing usable while the new local-MD routes roll out.
      if (error instanceof PhyniteApiError && error.code === 'NOT_FOUND') {
        setSimulationJobs([]);
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Could not load local MD runs.');
      throw error;
    }
  }, [cloudProjectId]);

  useEffect(() => {
    void refreshSimulationJobs().catch(() => undefined);
  }, [refreshSimulationJobs]);

  const refreshMdLibrary = useCallback(async () => {
    if (!cloudProjectId) {
      setPotentialAssets([]);
      setSavedConfigurations([]);
      return;
    }
    try {
      const [potentialsResult, configurationsResult] = await Promise.all([
        phyniteMdPotentials.list(cloudProjectId),
        phyniteMdConfigurations.list(cloudProjectId),
      ]);
      setPotentialAssets(potentialsResult.potentials);
      setSavedConfigurations(configurationsResult.configurations);
    } catch (error) {
      if (error instanceof PhyniteApiError && error.code === 'NOT_FOUND') {
        setPotentialAssets([]);
        setSavedConfigurations([]);
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Could not load the MD project library.');
    }
  }, [cloudProjectId]);

  useEffect(() => {
    void refreshMdLibrary();
  }, [refreshMdLibrary]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => phyniteMdRuntime.manifest().then(({ manifest }) => {
      if (!cancelled) setRuntimeManifest(manifest);
    }).catch(() => {
      if (!cancelled) setRuntimeManifest(null);
      throw new Error("MD runtime unavailable");
    });
    const stop = startBrowserPoll(refresh, 15_000);
    return () => { cancelled = true; stop(); };
  }, []);

  useEffect(() => {
    const hasActive = simulationJobs.some((job) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status));
    if (!hasActive) return;
    return startBrowserPoll(refreshSimulationJobs, 5000, undefined, false);
  }, [simulationJobs, refreshSimulationJobs]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => phyniteCompute.status().then((result) => {
      if (!cancelled) setComputeStatus(result.mdCompute ?? result.compute);
    }).catch(() => {
      if (!cancelled) setComputeStatus(null);
      throw new Error("Compute status unavailable");
    });
    const stop = startBrowserPoll(refresh, 15_000);
    return () => { cancelled = true; stop(); };
  }, []);

  const getWorkflowDisabledReason = useCallback((components: MdSimulationComponentInstance[]) => {
    if (!hasActiveProject || !cloudProjectId) return 'Choose a cloud MD project first.';
    if (!hasActiveTrajectory || !analysis.frame.ids.length) return MD_SIMULATION_INELIGIBLE_REASON;
    if (busy || playing) return 'Pause playback and wait for the displayed frame analysis before running.';
    if (analysisError) return 'Resolve the current frame analysis error before running.';
    if (!analysis.frame.hasCell) return 'A simulation cell is required before running LAMMPS.';
    if (!activeCloud || activeCloud.projectId !== cloudProjectId || !cloudSynced) return 'Wait for the trajectory cloud save to finish.';
    const isConnected = computeStatus?.status === 'connected' || computeStatus?.status === 'available';
    if (!isConnected) {
      return computeStatus?.target === 'shared'
        ? `Cloud: ${computeStatus?.status ?? 'unavailable'}. Check funding and selected resources.`
        : 'Connect your personal computer before running MD.';
    }
    if (!computeStatus.capabilities?.includes('md-simulation')) return 'Update and restart personal compute to install the LAMMPS runtime.';
    if (!runtimeManifest?.runtime) return 'Wait for the LAMMPS runtime manifest from your computer.';
    if (analysis.frame.ids.length > (runtimeManifest.limits?.simulationAtoms ?? 100000)) return `This frame exceeds the ${(runtimeManifest.limits?.simulationAtoms ?? 100000).toLocaleString()}-atom personal runtime grant. Use a larger resource allocation or a smaller study.`;
    if (components.length) {
      const displayedBoundary = analysis.frame.periodic.map(periodic => periodic ? 'p' : 'f').join(' ');
      if (components.some(component => component.config.boundaryType !== displayedBoundary)) return 'Match the simulation Boundary to the displayed periodic directions before running this frame.';
      const unsupportedStep = components.find((item) => !runtimeManifest.stepKinds.includes(item.recipeId as MdWorkflowStepKind));
      if (unsupportedStep) return `${unsupportedStep.name} is not supported by the connected LAMMPS runtime.`;
      const missingPackage = components.map((item) => MD_SIMULATION_RECIPES.find((recipe) => recipe.id === item.recipeId)).flatMap((recipe) => recipe?.requiredPackages ?? []).find((name) => !runtimeManifest.runtime?.packages.includes(name));
      if (missingPackage) return `The connected LAMMPS runtime does not include the ${missingPackage} package.`;
      const potentialIds = new Set(components.map((item) => item.config.potentialAssetId ?? 'builtin:lj-generic'));
      if (potentialIds.size > 1) return 'A workflow uses one potential. Choose the same potential for every step.';
      const mappedSpecies = Array.from(new Set(analysis.frame.species));
      const potentialId = components[0]?.config.potentialAssetId;
      if (!potentialId) {
        const supported = new Set(['Ar', 'Kr', 'Xe', 'Generic']);
        if (!mappedSpecies.length || mappedSpecies.some((item) => !supported.has(item))) return 'Choose a verified project potential for this material. Built-in Lennard-Jones supports Ar, Kr, Xe, and Generic.';
        if (!runtimeManifest.runtime.pairStyles?.includes('lj/cut')) return 'The connected LAMMPS runtime does not provide pair_style lj/cut.';
      } else {
        const asset = potentialAssets.find((item) => item.id === potentialId);
        if (!asset || asset.projectId !== cloudProjectId) return 'The selected potential is not available in this project.';
        if (asset.status !== 'READY') return 'Wait for the selected potential to pass its integrity check.';
        if (asset.family === 'meam' && (!asset.libraryElementOrder?.length || new Set(asset.libraryElementOrder).size !== asset.elements.length || asset.elements.some(element => !asset.libraryElementOrder?.includes(element)))) return 'Upload this MEAM model again with its verified parameter index order before running.';
        if (mappedSpecies.some((item) => !isMdElement(item) || !asset.elements.includes(item))) return `Map every atom type to the selected ${asset.family.toUpperCase()} potential.`;
        const pairStyle = requiredPotentialPairStyle(asset.family);
        if (!runtimeManifest.runtime.pairStyles?.includes(pairStyle)) return `The connected LAMMPS runtime does not provide pair_style ${pairStyle}.`;
      }
      const boundaryTypes = new Set(components.map((item) => item.config.boundaryType));
      if (boundaryTypes.size > 1) return 'A workflow uses one simulation cell boundary. Choose the same boundary for every step.';
      const pressureStep = components.find((item) => (['npt', 'nph', 'press-berendsen', 'pressure-ramp'].includes(item.config.recipeId) || (item.config.recipeId === 'equilibration' && item.config.ensemble === 'npt')) && item.config.boundaryType !== 'p p p');
      if (pressureStep) return 'Pressure control requires periodic boundaries (p p p) in all directions.';
      const berendsenIssue = mdBerendsenCellIssue(createMdSimulationWorkflowV2(components), analysis.frame.vectors);
      if (berendsenIssue) return berendsenIssue;
      const manualInput = components.find((item) => (item.config.mode === 'manual' || Boolean((item.config.manualBody ?? '').trim())) && (item.config.manualBody ?? '').trim());
      if (manualInput && runtimeManifest.runtime.manualInput !== true) return 'Manual input requires an isolated Docker personal-compute runtime.';
    }
    return '';
  }, [activeCloud, analysis.frame.hasCell, analysis.frame.ids.length, analysis.frame.species, analysis.frame.periodic, analysis.frame.vectors, analysisError, busy, playing, cloudProjectId, cloudSynced, computeStatus, hasActiveProject, hasActiveTrajectory, potentialAssets, runtimeManifest]);

  const runDisabledReason = useMemo(() => getWorkflowDisabledReason(simulationComponents), [getWorkflowDisabledReason, simulationComponents]);

  const submitSimulationWorkflow = useCallback(async (components: MdSimulationComponentInstance[], name: string) => {
    const disabledReason = getWorkflowDisabledReason(components);
    if (!components.length || disabledReason || !cloudProjectId || simulationAction) return;
    const invalid = components.find((component) => validateMdSimulationConfig(component.config));
    if (invalid) {
      setMessage(validateMdSimulationConfig(invalid.config));
      setConfiguringSimulationId(invalid.id);
      return;
    }
    const runnable = components.map((component) => ({ ...component, selected: true }));
    const workflow = createMdSimulationWorkflowV2(runnable);
    // The frame and settings must be captured together before any async save.
    const capturedFrame = structuredClone(analysis.frame);
    const capturedSettings = structuredClone(settings);
    const capturedCloud = activeCloud ? { ...activeCloud } : null;
    setSimulationAction('run');
    try {
      await persistCloudWorkspace();
      const linked = capturedCloud;
      if (!linked || linked.projectId !== cloudProjectId) throw new Error('The source trajectory could not be finalized in this cloud project.');
      const snapshot = createMdRunSnapshot(capturedFrame, capturedSettings, { trajectoryId: linked.trajectoryId, sha256: linked.sha256 }, runtimeManifest?.limits?.simulationAtoms ?? 100000);
      const file = new Blob([JSON.stringify(snapshot)], { type: 'application/octet-stream' });
      const sha256 = await mdCloudSha256(file);
      const created = await cloudClient.createTrajectory(cloudProjectId, {
        filename: `frame-${capturedFrame.index}.phynite-md.json`, name: `${name} · input frame ${capturedFrame.index + 1}`,
        contentType: 'application/octet-stream', sizeBytes: file.size, sha256,
        idempotencyKey: `mdsnapshot_${crypto.randomUUID().replaceAll('-', '')}`,
      });
      let inputTrajectory = created.trajectory;
      if (created.upload) {
        await cloudClient.uploadTrajectory(created.upload, file);
        inputTrajectory = (await cloudClient.completeTrajectory(inputTrajectory.id, { sizeBytes: file.size, sha256 })).trajectory;
      }
      setCloudTrajectories(items => [inputTrajectory, ...items.filter(item => item.id !== inputTrajectory.id)]);
      const { simulation } = await phyniteMdSimulations.create(cloudProjectId, {
        trajectoryId: inputTrajectory.id,
        name,
        workflow,
        idempotencyKey: `mdrun_${crypto.randomUUID().replaceAll('-', '')}`,
      });
      setSimulationJobs((items) => [simulation, ...items.filter((item) => item.id !== simulation.id)]);
      setMessage(`Queued ${name} from displayed frame ${capturedFrame.index + 1} (${capturedFrame.ids.length} atoms) on ${computeStatus?.target === 'shared' ? 'Phynite Cloud' : 'your computer'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not queue this MD simulation.');
    } finally {
      setSimulationAction('');
    }
  }, [activeCloud, analysis.frame, settings, cloudClient, cloudProjectId, computeStatus, getWorkflowDisabledReason, persistCloudWorkspace, runtimeManifest, simulationAction]);

  const handleRunSimulation = useCallback((componentId: string) => {
    const component = simulationComponents.find((item) => item.id === componentId);
    if (component) void submitSimulationWorkflow([component], component.name);
  }, [simulationComponents, submitSimulationWorkflow]);

  const handleRunSelected = useCallback(() => {
    const selected = simulationComponents.filter((item) => item.selected);
    if (selected.length) void submitSimulationWorkflow(selected, selected.length === 1 ? selected[0].name : `${source.name} · ${selected.length} selected steps`);
  }, [simulationComponents, source.name, submitSimulationWorkflow]);

  const handleRunAll = useCallback(() => {
    if (simulationComponents.length) void submitSimulationWorkflow(simulationComponents, `${source.name} · full workflow`);
  }, [simulationComponents, source.name, submitSimulationWorkflow]);

  const handleAddSimulation = useCallback((recipeId: MdSimulationRecipeId) => {
    const materialName = source.name !== 'Open a trajectory' ? source.name : 'Current trajectory';
    const component = createSimulationComponentInstance(recipeId, source.id || 'active', materialName);
    component.config.boundaryType = analysis.frame.periodic.map(periodic => periodic ? 'p' : 'f').join(' ') as MdSimulationConfig['boundaryType'];
    setSimulationComponents((items) => {
      const shared = items[0]?.config;
      if (shared) {
        for (const key of MD_WORKFLOW_SHARED_CONFIG_KEYS) {
          (component.config as unknown as Record<string, unknown>)[key] = shared[key];
        }
      }
      return [...items, component];
    });
    setConfiguringSimulationId(component.id);
  }, [analysis.frame.periodic, source.id, source.name]);

  const handleToggleSimulation = useCallback((id: string) => {
    setSimulationComponents((items) => items.map((item) => item.id === id ? { ...item, selected: !item.selected } : item));
  }, []);

  const handleDeleteSimulation = useCallback((id: string) => {
    setSimulationComponents((items) => items.filter((item) => item.id !== id));
    setConfiguringSimulationId((currentId) => currentId === id ? null : currentId);
  }, []);

  const handleConfigureSimulation = useCallback((id: string) => {
    setConfiguringSimulationId((currentId) => currentId === id ? null : id);
  }, []);

  const handleUpdateSimulation = useCallback((id: string, patch: Partial<MdSimulationConfig>) => {
    const workflowKeys = new Set<keyof MdSimulationConfig>(MD_WORKFLOW_SHARED_CONFIG_KEYS);
    const sharedPatch = Object.fromEntries(Object.entries(patch).filter(([key]) => workflowKeys.has(key as keyof MdSimulationConfig))) as Partial<MdSimulationConfig>;
    setSimulationComponents((items) => items.map((item) => {
      const nextConfig = item.id === id ? { ...item.config, ...patch } : Object.keys(sharedPatch).length ? { ...item.config, ...sharedPatch } : item.config;
      return nextConfig === item.config ? item : { ...item, config: nextConfig, name: item.id === id ? patch.name ?? item.name : item.name };
    }));
  }, []);

  const handleDuplicateSimulation = useCallback((id: string) => {
    setSimulationComponents((items) => {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return items;
      const sourceComponent = items[index];
      const nextId = `md-comp-${crypto.randomUUID()}`;
      const copy = { ...sourceComponent, id: nextId, name: `${sourceComponent.name} copy`, config: { ...sourceComponent.config, name: `${sourceComponent.name} copy` } };
      return [...items.slice(0, index + 1), copy, ...items.slice(index + 1)];
    });
  }, []);

  const handleReorderSimulation = useCallback((sourceId: string, targetId: string) => {
    setSimulationComponents((items) => {
      const sourceIndex = items.findIndex((item) => item.id === sourceId);
      const targetIndex = items.findIndex((item) => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;
      const next = [...items];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }, []);

  const handleMoveSimulation = useCallback((id: string, direction: -1 | 1) => {
    setSimulationComponents((items) => {
      const index = items.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const handleUploadPotential = useCallback(async (files: File[], model?: MdPotentialModelMetadata) => {
    if (!cloudProjectId || !files.length || simulationAction) return;
    const elements = Array.from(new Set(analysis.frame.species));
    if (!elements.length || elements.some((item) => !isMdElement(item))) {
      setMessage('Map every atom type to a chemical element before uploading a potential.');
      return;
    }
    const family = inferPotentialFamily(files, elements);
    if (!family) {
      setMessage('Use one EAM, EAM/alloy, Tersoff, or SW file, or a MEAM library and parameter pair.');
      return;
    }
    if (!model) { setPendingPotential({ files, family, elements }); return; }
    setSimulationAction('potential-upload');
    try {
      const metadata = await Promise.all(files.map(async (file) => ({
        filename: file.name,
        sizeBytes: file.size,
        sha256: await mdCloudSha256(file),
        role: model.family === 'meam'
          ? (/library\.meam|meam\.lib/i.test(file.name) ? 'library' as const : 'parameter' as const)
          : 'potential' as const,
      })));
      const { potential, uploads } = await phyniteMdPotentials.create(cloudProjectId, {
        name: files.length === 1 ? files[0].name : files.map((file) => file.name).join(' + '),
        family: model.family,
        elements: model.family === 'meam' ? model.libraryElementOrder ?? [] : elements,
        ...(model.family === 'meam' ? { libraryElementOrder: model.libraryElementOrder } : {}),
        units: 'metal',
        atomStyle: 'atomic',
        citation: model.citation.trim(),
        license: model.license.trim(),
        modelVersion: model.modelVersion.trim(),
        validityDomain: model.validityDomain.trim(),
        validationEvidence: model.validationEvidence.trim(),
        files: metadata,
      });
      await Promise.all(uploads.map((ticket) => {
        const file = files.find((candidate) => candidate.name === ticket.filename);
        if (!file) throw new Error(`Upload ticket does not match ${ticket.filename}.`);
        return phyniteMdPotentials.upload(ticket, file);
      }));
      const completed = await phyniteMdPotentials.complete(potential.id);
      setPotentialAssets((items) => [completed.potential, ...items.filter((item) => item.id !== completed.potential.id)]);
      setSimulationComponents((items) => items.map((item) => ({ ...item, config: { ...item.config, potentialAssetId: completed.potential.id } })));
      setPendingPotential(null);
      setMessage(`Integrity checked for ${completed.potential.name}. Assess its suitability for the study conditions.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not upload the potential files.');
      await refreshMdLibrary();
    } finally {
      setSimulationAction('');
    }
  }, [analysis.frame.species, cloudProjectId, refreshMdLibrary, simulationAction]);

  const handleDeletePotential = useCallback(async (assetId: string) => {
    if (simulationAction) return;
    setSimulationAction(`potential-delete:${assetId}`);
    try {
      await phyniteMdPotentials.delete(assetId);
      setPotentialAssets((items) => items.filter((item) => item.id !== assetId));
      setSimulationComponents((items) => items.map((item) => item.config.potentialAssetId === assetId ? { ...item, config: { ...item.config, potentialAssetId: undefined } } : item));
      setMessage('Removed the project potential.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove this potential.');
    } finally {
      setSimulationAction('');
    }
  }, [simulationAction]);

  const handleSaveConfiguration = useCallback(async (componentId?: string) => {
    if (!cloudProjectId || !simulationComponents.length || simulationAction) return;
    const one = componentId ? simulationComponents.find((item) => item.id === componentId) : undefined;
    const sourceComponents = one ? [one] : simulationComponents;
    const enabledComponents = sourceComponents.some((item) => item.selected)
      ? sourceComponents
      : sourceComponents.map((item) => ({ ...item, selected: true }));
    const name = one?.name ?? `${source.name.replace(/\.[^.]+$/, '') || 'MD'} workflow`;
    setSimulationAction('configuration-save');
    try {
      const { configuration } = await phyniteMdConfigurations.create(cloudProjectId, {
        name,
        workflow: createMdSimulationWorkflowV2(enabledComponents),
      });
      setSavedConfigurations((items) => [configuration, ...items.filter((item) => item.id !== configuration.id)]);
      setMessage(`Saved ${name} to this project library.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save this configuration.');
    } finally {
      setSimulationAction('');
    }
  }, [cloudProjectId, simulationAction, simulationComponents, source.name]);

  const handleLoadConfiguration = useCallback((configuration: MdSimulationConfiguration) => {
    setSimulationComponents(mdWorkflowToComponents(configuration.workflow, source.id || 'active', source.name));
    setConfiguringSimulationId(null);
    setMessage(`Loaded ${configuration.name}.`);
  }, [source.id, source.name]);

  const handleDeleteConfiguration = useCallback(async (configurationId: string) => {
    if (simulationAction) return;
    setSimulationAction(`configuration-delete:${configurationId}`);
    try {
      await phyniteMdConfigurations.delete(configurationId);
      setSavedConfigurations((items) => items.filter((item) => item.id !== configurationId));
      setMessage('Removed the saved MD configuration.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove this configuration.');
    } finally {
      setSimulationAction('');
    }
  }, [simulationAction]);

  const handleCancelSimulation = useCallback(async (jobId: string) => {
    try {
      const { simulation } = await phyniteMdSimulations.cancel(jobId);
      setSimulationJobs((items) => items.map((item) => item.id === jobId ? simulation : item));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not cancel this simulation.');
    }
  }, []);

  const handleOpenSimulationResult = useCallback(async (job: MdSimulationRun) => {
    if (!job.resultTrajectoryId) return;
    try {
      const latest = await cloudClient.listTrajectories(job.projectId);
      setCloudTrajectories(latest.trajectories);
      const trajectory = latest.trajectories.find((item) => item.id === job.resultTrajectoryId);
      if (!trajectory) throw new Error('The finalized result trajectory is not available yet.');
      await openCloudTrajectory(trajectory);
      setPanel('inspect');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open the simulation result.');
    }
  }, [cloudClient, openCloudTrajectory]);

  useResearchNavigation('md', async (target, href) => {
    if (target === 'md' && href === '/md') return true;
    const snapshot = cloudAutosaveRef.current;
    const record = recordsRef.current.find(item => item.id === snapshot.source.id);
    if (record) await saveMdTrajectory({ ...record, settings: snapshot.settings, simulationWorkflow: createMdSimulationWorkflowV2(snapshot.simulationComponents), syncState: cloudSynced ? record.syncState : 'pending' });
    if (snapshot.source.id && online && !cloudSynced && record?.syncState !== 'conflict') await persistCloudWorkspace();
    return false;
  });
  const restoreMdNavigation = useEffectEvent(() => {
      const params = new URLSearchParams(window.location.search);
      const requestedProject = params.get('project') ?? '';
      const requestedTrajectory = params.get('trajectory') ?? '';
      if (!requestedProject) { clearOpenWorkspace(); return; }
      if (!cloudProjects.some(item => item.id === requestedProject)) { setMessage('That project belongs to another workspace. Choose an MD project.'); return; }
      if (requestedProject !== cloudProjectId || requestedTrajectory !== activeCloud?.trajectoryId) {
        initialCloudTrajectory.current = requestedTrajectory;
        routeTrajectoryHandled.current = false;
        selectSidebarProject(`cloud:${requestedProject}`);
        const url = new URL(window.location.href);
        if (requestedTrajectory) url.searchParams.set('trajectory', requestedTrajectory);
        window.history.replaceState(window.history.state, '', url);
      }
  });
  useEffect(() => {
    if (!cloudReady || cloudLoading || !shell?.location || lastShellLocation.current === shell.location) return;
    lastShellLocation.current = shell.location;
    restoreMdNavigation();
  }, [shell?.location, cloudReady, cloudLoading]);

  return <div className="calculation-shell md-studio md-prototype-shell" data-md-theme={theme} data-workspace-theme={theme} onDragOver={e => { e.preventDefault(); if (hasActiveProject && e.dataTransfer.types.includes('Files')) setDrop(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(false); }} onDrop={e => { e.preventDefault(); setDrop(false); const file = e.dataTransfer.files[0]; if (file) importFile(file); }}>
    <WorkspaceProductHeader
      className="md-header workspace-topbar"
      activeProduct="md"
      resourceOwnerId={ownerId}
      resourceUnlimited={Boolean(session?.user.isDeveloper)}
      saveState={headerSaveState}
      saveLabel={!hasOpenTrajectory && cloudProjectConnected ? 'Cloud project' : headerSaveLabel}
      saveDetail={cloudError || (cloudSynced ? `Private cloud copy in ${cloudProjects.find(item => item.id === activeCloud?.projectId)?.name ?? 'your Phynite project'}` : undefined)}
      context={hasActiveProject && (
        <nav className="workspace-product-breadcrumb" aria-label="MD Lab location">
          <span>{selectedSidebarProjectName}</span>
          <ChevronRight size={12} />
          <strong>MD Lab</strong>
          {hasActiveTrajectory && (
            <>
              <ChevronRight size={12} />
              <span>{source.name}</span>
            </>
          )}
        </nav>
      )}
      actions={<div className="workspace-product-actions workspace-topbar-actions">
        {hasActiveTrajectory && <><button type="button" disabled={!history.past.length} onClick={() => { setPlaying(false); setHistory(h => ({ past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] })); }} aria-label="Undo pipeline change" title="Undo · Ctrl Z" className="workspace-product-button workspace-product-button--icon"><Undo2 size={16} /></button>
        <button type="button" disabled={!history.future.length} onClick={() => { setPlaying(false); setHistory(h => ({ past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) })); }} aria-label="Redo pipeline change" title="Redo · Ctrl Shift Z" className="workspace-product-button workspace-product-button--icon"><Redo2 size={16} /></button>
        <span className="workspace-product-divider" aria-hidden="true" /></>}
        {!shell && <button type="button" onClick={() => setHelpOpen(true)} aria-label="Open user guide" title="User guide" className="workspace-product-button workspace-product-guide">
          <CircleHelp size={16} /><span>Guide</span>
        </button>}
        {!shell && <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Use light mode' : 'Use dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} className="workspace-product-button workspace-product-button--icon">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>}
        <button type="button" onClick={() => shell ? shell.openSidebar() : setMobilePanel(mobilePanel === 'files' ? null : 'files')} aria-label={mobilePanel === 'files' ? 'Close project panel' : 'Open project panel'} aria-pressed={mobilePanel === 'files'} className={cn('workspace-compact-panel-toggle workspace-project-panel-toggle workspace-product-button workspace-product-button--icon', mobilePanel === 'files' && 'is-active')}>
          <Menu size={16} />
        </button>
        {hasActiveTrajectory && <button type="button" onClick={() => { shell?.closeMobileNavigation(); setMobilePanel(mobilePanel === 'inspector' ? null : 'inspector'); }} aria-label={mobilePanel === 'inspector' ? 'Close inspector' : 'Open inspector'} aria-pressed={mobilePanel === 'inspector'} className={cn('workspace-compact-panel-toggle workspace-inspector-panel-toggle workspace-product-button workspace-product-button--icon', mobilePanel === 'inspector' && 'is-active')}>
          <SlidersHorizontal size={16} />
        </button>}
        {session && <AccountMenu session={session} />}
      </div>}
    />
    <div className="md-body" style={{ '--md-sidebar-width': `${sidebarWidth}px`, '--md-inspector-width': `${inspectorWidth}px` } as CSSProperties} data-mobile-panel={mobilePanel ?? ''} data-inspector={hasActiveTrajectory ? 'visible' : 'hidden'}>
      {mobilePanel && <button type="button" aria-label="Close panel" onClick={() => setMobilePanel(null)} className="workspace-panel-backdrop md-panel-backdrop" />}
      <ProjectStructureSidebar
        projects={sidebarProjects}
        activeProject={selectedSidebarProject}
        onProjectChange={selectSidebarProject}
        onCreateProject={name => createCloudProject(name, true)}
        onRenameProject={renameSidebarProject}
        onDuplicateProject={duplicateSidebarProject}
        onRemoveProject={id => void deleteSidebarProject(id)}
        trajectories={sidebarTrajectories}
        selectedId={selectedSidebarTrajectory}
        formulaMap={{ [selectedSidebarTrajectory]: mdFormula(Object.fromEntries(speciesCounts(analysis.frame).map(s => [s.name, s.count]))) }}
        onSelect={async id => {
          if (openingSidebarTrajectory.current === id || (id === selectedSidebarTrajectory && hasActiveTrajectory && !loading)) {
            setMobilePanel(null);
            return;
          }
          openingSidebarTrajectory.current = id;
          const request = ++sidebarSelectionRequest.current;
          activeLoadAbort.current?.abort();
          ++loadSequence.current;
          setMobilePanel(null);
          try {
            if (id.startsWith('remote:')) {
              const remoteId = id.slice(7);
              const trajectory = cloudTrajectories.find(item => item.id === remoteId);
              let cachedRecord = records.find(item => item.cloud?.trajectoryId === remoteId)
                ?? recordsRef.current.find(item => item.cloud?.trajectoryId === remoteId)
                ?? records.find(item => trajectory && !item.cloud && mdRecordMatchesCloudSource(item, trajectory))
                ?? recordsRef.current.find(item => trajectory && !item.cloud && mdRecordMatchesCloudSource(item, trajectory));

              if (!cachedRecord) {
                const freshRecords = await listMdTrajectories(ownerId).catch(() => []);
                if (request !== sidebarSelectionRequest.current) return;
                if (freshRecords.length) {
                  setRecords(freshRecords);
                  recordsRef.current = freshRecords;
                  cachedRecord = freshRecords.find(item => item.cloud?.trajectoryId === remoteId)
                    ?? freshRecords.find(item => trajectory && !item.cloud && mdRecordMatchesCloudSource(item, trajectory));
                }
              }

              const cachedMatchesCloud = !!trajectory && !!cachedRecord
                && cachedRecord.cloud?.trajectoryId === trajectory.id
                && (!cachedRecord.cloud?.sha256 || cachedRecord.cloud.sha256 === trajectory.sha256)
                && cachedRecord.cloud?.revision === trajectory.revision
                && cachedRecord.file.size === trajectory.sizeBytes;
              if (cachedRecord && cachedMatchesCloud) {
                await openCachedCloudTrajectory(cachedRecord, trajectory);
              } else if (trajectory) {
                await openCloudTrajectory(trajectory, cachedRecord);
              }
            } else {
              let record = records.find(item => item.id === id) ?? recordsRef.current.find(item => item.id === id);
              if (!record) {
                const items = await listMdTrajectories(ownerId).catch(() => []);
                if (request !== sidebarSelectionRequest.current) return;
                if (items.length) {
                  setRecords(items);
                  recordsRef.current = items;
                  record = items.find(item => item.id === id);
                }
              }
              if (record) {
                const matchingCloud = !record.cloud && cloudProjectId
                  ? cloudTrajectories.filter(trajectory => trajectory.status === 'READY' && mdRecordMatchesCloudSource(record!, trajectory))
                  : [];
                if (matchingCloud.length === 1) {
                  await openCloudTrajectory(matchingCloud[0], record);
                } else {
                  await activate(record.file, record.sourceFilename ?? record.name, record.id, recordProjectName(record), record.settings, false, undefined, record.cloud, record.name, record.simulationWorkflow);
                }
              }
            }
          } finally {
            if (openingSidebarTrajectory.current === id) openingSidebarTrajectory.current = '';
          }
        }}
        onRename={renameSidebarTrajectory}
        onDuplicate={duplicateSidebarTrajectory}
        onRemove={id => {
          if (id.startsWith('remote:')) {
            const trajectory = cloudTrajectories.find(item => item.id === id.slice(7));
            if (trajectory) void deleteCloudTrajectory(trajectory);
          } else {
            const record = records.find(item => item.id === id);
            if (record) void deleteRecord(record);
          }
        }}
        onOpenMaterialsProject={() => { if (hasActiveProject) setMaterialsProjectOpen(true); }}
        canImport={hasActiveProject}
        onOpenImport={() => { if (hasActiveProject) setImportOpen(true); }}
        busy={cloudAction !== ''}
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        onClose={() => setMobilePanel(null)}
      />
      <main className="md-stage">
        <div className="md-canvas-stage relative">
          {!hasActiveProject && !loading && (
            <WorkspaceProjectGate
              theme={theme}
              className="md-empty-source absolute inset-0 z-10"
              description="Select or create an MD project before importing trajectories and configuring analysis."
              actionLabel={sidebarProjects.length ? 'Choose project' : 'Create project'}
              onAction={() => {
                if (shell) shell.openSidebar(); else setMobilePanel('files');
                window.requestAnimationFrame(() => {
                  const target = sidebarProjects.length
                    ? document.querySelector<HTMLButtonElement>('.md-sidebar .workspace-selection-row > button')
                    : document.querySelector<HTMLButtonElement>('[data-md-create-project]');
                  if (sidebarProjects.length) target?.focus();
                  else target?.click();
                });
              }}
            />
          )}
          {hasActiveProject && !hasActiveTrajectory && !loading && (
            <WorkspaceAssetGate
              className="absolute inset-0 z-10"
              title={sidebarTrajectories.length ? 'Choose a trajectory' : 'Add your first trajectory'}
              description={sidebarTrajectories.length
                ? 'Open a trajectory from the project panel to continue in MD Lab.'
                : `Import a trajectory or structure into ${selectedSidebarProjectName} to start MD Lab.`}
              actionLabel={sidebarTrajectories.length ? undefined : 'Import trajectory'}
              onAction={sidebarTrajectories.length ? undefined : () => setImportOpen(true)}
            />
          )}
          {hasActiveTrajectory && (
            <Viewport
              analysis={analysis}
              settings={settings}
              sourceId={source.id}
              totalFrames={frames.length}
              theme={theme}
              exportRef={exportRef}
              selection={selection}
              onSelection={setSelection}
            />
          )}
          {loading && (
            <div className="md-loading-overlay">
              <LoaderCircle className="md-spin" size={24} />
              <strong>Reading trajectory…</strong>
            </div>
          )}
          {hasActiveTrajectory && noticeCount > 0 && (
            <details className="md-warnings">
              <summary>
                <Info size={15} aria-hidden="true" />
                <span>{noticeCount} {noticeCount === 1 ? 'note' : 'notes'} about this trajectory</span>
                <ChevronDown size={15} aria-hidden="true" />
              </summary>
              <div className="md-warnings-content">
                <p>Generated while reading the file or analyzing the current frame.</p>
                {importWarnings.length > 0 && <section aria-label="File data notes">
                  <h3>File data</h3>
                  <ul>{importWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
                </section>}
                {analysis.warnings.length > 0 && <section aria-label="Analysis notes">
                  <h3>Analysis</h3>
                  <ul>{analysis.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
                </section>}
              </div>
            </details>
          )}
          {hasActiveTrajectory && analysisError && (
            <div className="md-analysis-error" role="alert">
              {analysisError}
              <small>Showing the last available frame. Correct the modifier parameters to continue.</small>
            </div>
          )}
        </div>
        {hasActiveTrajectory && <TimeScrubber currentFrame={current} totalFrames={frames.length} isPlaying={playing} onPlayPause={() => setPlaying(value => !value)} loop={settings.loop} fps={settings.fps} timeLabel={time === null ? '—' : time.toFixed(3) + ' ps'} onSeek={seek} onLoopToggle={() => patchSettings({ loop: !settings.loop })} onFpsChange={fps => patchSettings({ fps })} />}
      </main>
      {hasActiveTrajectory && <MdPrototypeInspector
        width={inspectorWidth}
        onWidthChange={setInspectorWidth}
        sidebarWidth={sidebarWidth}
        hasActiveTrajectory={hasActiveTrajectory}
        filename={source.name}
        metrics={metrics}
        computeContent={<><LabComputeDestination requiredCapability="md-analysis" ariaLabel="Analysis compute destination" />{analysisReceipt && <ComputeJobReceipt job={analysisReceipt} />}</>}
        onComputeMetrics={() => void computeMetrics()}
        onCancelMetrics={() => {
          const analysisId = activeMetricsAnalysis.current;
          metricsAbort.current?.abort();
          if (analysisId) void cloudClient.cancelAnalysis(analysisId).catch(() => undefined);
        }}
        metricsBusy={metricsJob.signature === pipelineSignature && metricsJob.busy}
        metricsStatus={metricsJob.signature === pipelineSignature ? metricsJob.message : ""}
        onExportGlb={() => void exportData("glb")}
        onExportData={exportData}
        exporting={exporting}
        exportingFormat={exportingFormat}
        exportDisabledReason={(format) => {
          if (!frames.length) return 'Open a trajectory before exporting.';
          if (playing) return 'Pause playback before exporting the current frame.';
          if (busy || loading) return 'Wait for the current analysis to finish.';
          if (analysisError) return 'Resolve the analysis error before exporting.';
          if (['cif', 'poscar', 'xsf'].includes(format) && analysis.frame.species.some(species => !isMdElement(species))) return 'Map every particle type to a chemical element in Trajectory first.';
          return undefined;
        }}
        analysis={analysis}
        frames={frames}
        settings={settings}
        onSettings={patchSettings}
        panel={panel}
        onPanel={setPanel}
        current={current}
        onSeek={seek}
        mappedSpecies={Array.from(new Set(input.species))}
        simulationContent={hasActiveTrajectory ?
          <MdSimulationPanel
            onStudyEvidence={() => setStudyEvidenceOpen(true)}
            activeStructureName={source.name !== 'Open a trajectory' ? source.name : undefined}
            formula={mdFormula(analysis.frame.species.reduce((acc, s) => ({ ...acc, [s]: (acc[s] || 0) + 1 }), {} as Record<string, number>))}
            totalAtoms={analysis.frame.ids.length || undefined}
            projectName={project || undefined}
            components={simulationComponents}
            onAddSimulation={handleAddSimulation}
            onToggleSimulation={handleToggleSimulation}
            onDeleteSimulation={handleDeleteSimulation}
            onDuplicateSimulation={handleDuplicateSimulation}
            onReorderSimulation={handleReorderSimulation}
            onMoveSimulation={handleMoveSimulation}
            onConfigureSimulation={handleConfigureSimulation}
            activeConfigurationId={configuringSimulationId}
            onChangeConfiguration={handleUpdateSimulation}
            jobs={simulationJobs}
            onRunSimulation={handleRunSimulation}
            onRunSelected={handleRunSelected}
            onRunAll={handleRunAll}
            onCancelSimulation={handleCancelSimulation}
            onOpenResultTrajectory={handleOpenSimulationResult}
            potentialAssets={potentialAssets}
            mappedElements={Array.from(new Set(analysis.frame.species))}
            onUploadPotential={handleUploadPotential}
            onDeletePotential={handleDeletePotential}
            configurations={savedConfigurations}
            onSaveConfiguration={handleSaveConfiguration}
            onLoadConfiguration={handleLoadConfiguration}
            onDeleteConfiguration={handleDeleteConfiguration}
            computeStatus={computeStatus}
            runtimeManifest={runtimeManifest}
            busyAction={simulationAction}
            runDisabledReason={runDisabledReason}
            getStepDisabledReason={(comp) => getWorkflowDisabledReason([comp])}
            onClose={() => setMobilePanel(null)}
          />
        : undefined}
      />}
    </div>
    {hasActiveProject && <ResearchSidebarStatusSlot section="md"><footer className="md-statusbar"><span role="status" aria-live="polite">{message}</span><span>{!hasActiveTrajectory ? 'No trajectory selected' : `${analysis.frame.ids.length.toLocaleString()} atoms · Frame ${analysis.frame.index + 1} · ${selection.length} selected`}</span></footer></ResearchSidebarStatusSlot>}
    {studyEvidenceOpen && <StudyEvidenceDialog key={`${ownerId}:${cloudProjectId || project}:md`} storageKey={`phynite:study-evidence:${ownerId}:${cloudProjectId || project}:md`} onClose={() => setStudyEvidenceOpen(false)} />}
    {catalogOpen && <MdPotentialCatalogDialog projectId={cloudProjectId ?? ''} elements={Array.from(new Set(analysis.frame.species))} onClose={() => setCatalogOpen(false)} onImported={asset => { setPotentialAssets(current => [...current.filter(p=>p.id!==asset.id),asset]); setMessage(`Imported ${asset.name}; choose it from the project potential library.`); setCatalogOpen(false); }} />}
    {pendingPotential && <MdPotentialUploadDialog files={pendingPotential.files} family={pendingPotential.family} elements={pendingPotential.elements} busy={simulationAction === 'potential-upload'} onCancel={() => setPendingPotential(null)} onSubmit={model => void handleUploadPotential(pendingPotential.files, model)} />}
    <input ref={fileInput} type="file" hidden accept=".dump,.lammpstrj,.xyz,.extxyz,.cif,.vasp,.poscar,.contcar,.xsf,.axsf,.pdb,.in,.pwi,.pw,.qe,.out,.pwo,.data,.lmp,.txt,.json" onChange={e => { const file = e.target.files?.[0]; if (file) importFile(file); e.target.value = ''; }} />
    {drop && <div className="md-drop-overlay"><FileUp size={32} /><strong>Drop a trajectory or structure</strong><span>LAMMPS · XYZ · CIF · POSCAR · QE · PDB</span></div>}
    {(importOpen || helpOpen) && <div className="md-dialog-backdrop" onClick={() => { setImportOpen(false); setHelpOpen(false); }}><section ref={dialog} className="md-dialog" role="dialog" aria-modal="true" aria-label={importOpen ? 'Import trajectory' : 'MD Lab help'} onClick={e => e.stopPropagation()}><header><h2>{importOpen ? 'Open a trajectory or structure' : 'Explore MD Lab'}</h2><button className="md-icon" aria-label="Close dialog" autoFocus onClick={() => { setImportOpen(false); setHelpOpen(false); }}><X size={17} /></button></header>
      {importOpen && <><p>Open simulation output, inspect each frame, and build an analysis pipeline. The source file and every workspace change are saved automatically to the selected cloud project.</p><div className="md-field"><UiSelect label="Project" value={selectedSidebarProject} options={sidebarProjects.map(item => ({ value: item.id, label: item.name }))} onChange={selectSidebarProject} /></div><form className="md-new-project" onSubmit={e => { e.preventDefault(); const name = projectDraft.trim(); if (!name) return; setProjectDraft(''); void createCloudProject(name, true).then(created => { if (created) setImportOpen(false); }); }}><input aria-label="New MD project" placeholder="New cloud project name" value={projectDraft} onChange={e => setProjectDraft(e.target.value)} /><button className="md-button" disabled={!projectDraft.trim() || cloudAction !== ''}>Create</button></form><button className="md-file-drop" disabled={!hasActiveProject} onClick={() => fileInput.current?.click()}><FileUp size={28} /><strong>Choose a file</strong><span>or drag and drop it here</span><small>LAMMPS dump / data · XYZ / extXYZ · CIF · POSCAR · XSF · PDB · QE</small></button><p className="md-note">Browser imports: 64 MiB and up to 1,000,000 atoms per frame. Your computer can import larger sources up to 64 GiB within your storage allowance and available memory.</p></>}
      {helpOpen && <><p>MD Lab provides a dedicated workspace for trajectory inspection and scientific analysis.</p><ol><li>Open a cloud trajectory or import a simulation file.</li><li>Add modifiers in order. Inspect distributions, g(r), and trajectory time series.</li><li>Use the floating tools to select, measure, slice, switch views, or capture an image.</li><li>Export a frame or send a filtered structure to DFT Lab for DFT.</li></ol><p><kbd>Space</kbd> play / pause · <kbd>←</kbd> <kbd>→</kbd> seek · <kbd>Esc</kbd> close dialog</p><p className="md-note">Playback waits for each full frame to finish processing. FPS is the requested maximum.</p></>}
    </section></div>}
    <MaterialsProjectBrowser
      open={materialsProjectOpen}
      databaseName={project || 'MD Project'}
      onClose={() => setMaterialsProjectOpen(false)}
      onImport={importFromMaterialsProject}
    />
  </div>;
}
