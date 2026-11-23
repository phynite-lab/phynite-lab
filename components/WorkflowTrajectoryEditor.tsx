'use client';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createMdCloudStorageClient, createSameOriginMdCloudTransport, mdCloudSha256, toMdCloudStudioSettings } from '@/lib/md-cloud-api';
import { downloadMdCloudFile } from '@/lib/md-cloud-download';
import { getMdTrajectory, saveMdTrajectory, frameXyz, frameLammpsDump, downloadMdFile } from '@/lib/md-workspace';
import { createMdSimulationWorkflowV2 } from '@/lib/md-simulation-types';
import { defaultMdSettings, type MdFrame, type MdTrajectoryRecord } from '@/lib/md-types';
import type { MdParseResult } from '@/lib/md-parser';
import { createMdWorkerClient } from '@/lib/md-worker-client';
import MdWorker from '../lib/md-worker.ts?worker';
import { toPrototypeFrame } from '@/lib/md-prototype-adapter';
import { saveWorkflowTrajectory } from '@/lib/workflow-md-input';
import type { WorkflowNode } from '@/lib/project-workflow';
import { useLocale } from '@/app/locale-provider';
import { useSiteTheme } from '@/app/use-site-theme';
const MD_MAX_BYTES = 64 * 1024 * 1024;
const loadTrajectoryCanvas = () => import('./md-prototype/components/TrajectoryCanvas').then(module => module.TrajectoryCanvas);
const TrajectoryCanvas = dynamic(loadTrajectoryCanvas, { ssr: false, loading: () => <WorkspaceLoading label="Opening 3D view…" /> });

type SelectedPreview = {
  deviceId: string;
  file: File;
  parsed: Promise<MdParseResult>;
  published?: { id: string; sha256: string };
};

async function parsePreview(blob: Blob, name: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (blob.size > MD_MAX_BYTES) throw new Error('Browser trajectory previews support 64 MiB.');
  const worker = createMdWorkerClient(() => new MdWorker({ name: 'phynite-md-parser' }), { requestTimeoutMs: 120_000 });
  const useNative = blob.size >= 64 * 1024 && (window as Window & { phyniteDesktop?: true }).phyniteDesktop === true;
  try {
    return await worker.run<MdParseResult>({ operation: 'parse', blob, name, useNative }, { signal });
  } finally {
    worker.dispose();
  }
}

export function WorkflowTrajectoryEditor({ node, owner, projectId, onChange, onError, readOnly = false }: { node: WorkflowNode; owner: string; projectId: string; onChange: (node: WorkflowNode) => void; onError: (message: string) => void; readOnly?: boolean }) {
  const { t } = useLocale(), { theme } = useSiteTheme();
  const [source, setSource] = useState<File | null>(null), [frames, setFrames] = useState<MdFrame[]>([]), [warnings, setWarnings] = useState<string[]>([]);
  const [selected, setSelected] = useState<SelectedPreview | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  useEffect(() => () => previewAbort.current?.abort(), []);
  const [frameIndex, setFrameIndex] = useState(() => { try { return Math.max(0, Number(localStorage.getItem(`phynite:workflow-md-frame:${owner}:${projectId}:${node.id}`)) || 0); } catch { return 0; } }), [busy, setBusy] = useState(false);
  const ref = node.resources.find(item => item.kind === 'trajectory');
  const resourceId = ref?.id, resourceSha = ref?.sha256, deviceOnly = ref?.deviceOnly;
  const preview = selected && (deviceOnly && selected.deviceId === resourceId
    || selected.published && selected.published.id === resourceId && selected.published.sha256 === resourceSha)
    ? selected : null;
  const resourceKey = preview ? `preview:${preview.deviceId}` : `${resourceId ?? ''}:${resourceSha ?? ''}:${!!deviceOnly}`;
  const [settledSource, setSettledSource] = useState({ key: '', loaded: false });
  const loadingSource = Boolean(resourceId && settledSource.key !== resourceKey);
  const sourceReady = settledSource.key === resourceKey && settledSource.loaded;
  useEffect(() => {
    if (!resourceId) return;
    const controller = new AbortController(); let live = true;
    void loadTrajectoryCanvas().catch(() => undefined);
    void (async () => {
      let blob: Blob, filename = String(node.configuration.filename || node.name), parsed: MdParseResult;
      if (preview) {
        blob = preview.file;
        filename = preview.file.name;
        parsed = await preview.parsed;
      } else if (deviceOnly) {
        const record = await getMdTrajectory(owner, resourceId);
        if (!record || (record.cloud?.projectId ?? record.projectId) !== projectId) throw new Error(t('This input is stored on another device. Open it on its original device and save it to the project.', 'Input tersimpan di perangkat lain. Buka dari perangkat asal lalu simpan ke project.'));
        blob = record.file; filename = record.sourceFilename ?? filename;
        parsed = await parsePreview(blob, filename, controller.signal);
      } else {
        const detail = await createMdCloudStorageClient({ transport: createSameOriginMdCloudTransport() }).getTrajectory(resourceId);
        if (detail.trajectory.projectId !== projectId || !detail.downloadUrl) throw new Error('The project input is unavailable.');
        if (detail.trajectory.sizeBytes > MD_MAX_BYTES) throw new Error('Open this large input in the preserved MD editor with Your computer. Browser previews support 64 MiB.');
        blob = await downloadMdCloudFile(detail.downloadUrl, { signal: controller.signal });
        const checksum = await mdCloudSha256(blob);
        if (checksum !== detail.trajectory.sha256 || resourceSha && checksum !== resourceSha) throw new Error('Input checksum failed. Reopen the current source.');
        parsed = await parsePreview(blob, filename, controller.signal);
      }
      if (live) { setSource(blob instanceof File && blob.name === filename ? blob : new File([blob], filename, { type: blob.type })); setFrames(parsed.frames); setWarnings(parsed.warnings); setSettledSource({ key: resourceKey, loaded: true }); }
    })().catch(error => { if (live) { setSettledSource({ key: resourceKey, loaded: false }); onError(error.message); } });
    return () => { live = false; controller.abort(); };
  }, [resourceId, resourceSha, deviceOnly, resourceKey, preview, owner, projectId, node.name, node.configuration.filename, onError, t]);
  const frame = sourceReady ? frames[Math.min(frameIndex, frames.length - 1)] : undefined;
  const frameData = useMemo(() => frame ? toPrototypeFrame({ frame, attributes: {}, phases: [], rdf: [], bonds: [], dislocations: [], surface: null, warnings: [], engine: 'Source input' }, defaultMdSettings(), frames.length) : null, [frame, frames.length]);
  const save = async (file: File, deviceId?: string) => {
    setBusy(true);
    try {
      let record: MdTrajectoryRecord | undefined;
      if (deviceId) {
        const stored = await getMdTrajectory(owner, deviceId);
        if (stored && (stored.cloud?.projectId ?? stored.projectId) === projectId) record = stored;
      }
      if (!deviceId) {
        deviceId = `md_${crypto.randomUUID()}`;
        previewAbort.current?.abort();
        const controller = new AbortController();
        previewAbort.current = controller;
        void loadTrajectoryCanvas().catch(() => undefined);
        const parsed = parsePreview(file, file.name, controller.signal);
        // Parsing can finish before the device reference is committed.
        void parsed.catch(() => undefined);
        record = { id: deviceId, owner, projectId, name: file.name, sourceFilename: file.name, file, createdAt: new Date().toISOString(), settings: defaultMdSettings(), syncState: 'local' };
        try { await saveMdTrajectory(record); }
        catch (error) { controller.abort(); throw error; }
        setSelected({ deviceId, file, parsed });
        onChange({ ...node, name: file.name, resources: [{ kind: 'trajectory', id: deviceId, deviceOnly: true }], configuration: { ...node.configuration, filename: file.name } });
      }
      const trajectory = await saveWorkflowTrajectory(projectId, file);
      if (record) {
        await createMdCloudStorageClient({ transport: createSameOriginMdCloudTransport() }).updateTrajectory(trajectory.id, { baseRevision: trajectory.revision ?? 0, studioSettings: toMdCloudStudioSettings(record.settings, record.simulationWorkflow) });
        await saveMdTrajectory({ ...record, syncState: 'synced', cloud: { trajectoryId: trajectory.id, projectId, sha256: trajectory.sha256, uploadedAt: trajectory.uploadedAt ?? new Date().toISOString(), settingsSignature: JSON.stringify([record.settings, record.simulationWorkflow ?? createMdSimulationWorkflowV2([])]) } });
      }
      setSelected(current => current?.deviceId === deviceId && current?.file === file
        ? { ...current, published: { id: trajectory.id, sha256: trajectory.sha256 } } : current);
      onChange({ ...node, name: file.name, resources: [{ kind: 'trajectory', id: trajectory.id, sha256: trajectory.sha256 }], configuration: { ...node.configuration, filename: file.name } });
    } catch (error) { onError((error as Error).message); } finally { setBusy(false); }
  };
  return <div className="workflow-trajectory-editor md-studio">{!readOnly && <div className="workflow-editor-actions flex-wrap items-end"><label className="min-w-0 flex-[1_1_240px]">{t('Import trajectory', 'Impor trajectory')}<input className="block w-full max-w-full" type="file" accept=".dump,.lammpstrj,.xyz,.cif,.data,.extxyz" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void save(file); event.target.value = ''; }} /></label>{ref?.deviceOnly && <button disabled={busy || !source} onClick={() => { if (source) void save(source, ref.id); }}>{t('Save to project', 'Simpan ke project')}</button>}</div>}
    {frame && <div className="workflow-editor-actions flex-wrap items-end"><button onClick={()=>downloadMdFile(`${node.name}.xyz`,frameXyz(frame,node.name))}>XYZ Coords</button><button onClick={()=>downloadMdFile(`${node.name}.dump`,frameLammpsDump(frame))}>LAMMPS dump</button>{source && <button onClick={()=>downloadMdFile(source.name,source,source.type)}>{t('Original file','Berkas asli')}</button>}</div>}
    {ref?.deviceOnly && <p className="workflow-editor-notice">Device-only · {t('Save this input before running or copying it to another project.', 'Simpan input sebelum menjalankan atau menyalinnya ke project lain.')}</p>}
    {sourceReady && warnings.map(warning => <p className="workflow-editor-notice" key={warning}>{warning}</p>)}
    {loadingSource ? <WorkspaceLoading label={t('Reading trajectory…', 'Membaca trajectory…')} /> : frameData ? <><div className="workflow-trajectory-viewport"><TrajectoryCanvas frameData={frameData} selectedTrajId={node.id} theme={theme} cameraStorageKey={`phynite:workflow-md-camera:${owner}:${projectId}:${node.id}`} /></div><label>{t('Frame', 'Frame')} {Math.min(frameIndex, frames.length - 1) + 1} / {frames.length}<input aria-label={t('Frame', 'Frame')} type="range" min="0" max={frames.length - 1} value={Math.min(frameIndex, frames.length - 1)} onChange={event => { const next = Number(event.target.value); setFrameIndex(next); try { localStorage.setItem(`phynite:workflow-md-frame:${owner}:${projectId}:${node.id}`, String(next)); } catch {} }} /></label></> : !resourceId && <p>{t('Import a trajectory to inspect its source frames.', 'Impor trajectory untuk memeriksa frame sumbernya.')}</p>}
  </div>;
}
