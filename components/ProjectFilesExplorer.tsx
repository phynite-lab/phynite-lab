'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  Cloud,
  Database,
  Download,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  phyniteCalculations,
  type PhyniteCalculation,
  type PhyniteCalculationFile,
  type PhyniteResultArtifact,
} from '@/lib/phynite-api';
import {
  createMdCloudStorageClient,
  createSameOriginMdCloudTransport,
  type MdCloudAnalysis,
  type MdCloudResultManifest,
  type MdCloudTrajectory,
} from '@/lib/md-cloud-api';

export type ProjectFilesTarget = {
  id: string;
  remoteId?: string;
  name: string;
  href: string;
  tags: Array<'QE' | 'LAMMPS' | 'MD'>;
  updatedAt: string;
};

type ExplorerRun =
  | { id: string; kind: 'qe'; name: string; type: string; status: string; createdAt: string; calculation: PhyniteCalculation }
  | { id: string; kind: 'trajectory'; name: string; type: string; status: string; createdAt: string; trajectory: MdCloudTrajectory }
  | { id: string; kind: 'analysis'; name: string; type: string; status: string; createdAt: string; analysis: MdCloudAnalysis };

type ExplorerFolder = 'input' | 'trajectory' | 'output' | 'results' | 'analysis' | 'runtime';

type ExplorerFile = {
  id: string;
  folder: ExplorerFolder;
  path: string;
  name: string;
  role: string;
  contentType: string;
  sizeBytes?: number;
  sha256?: string;
  content?: string;
  viewUrl?: string;
  downloadUrl?: string;
};

type Translate = (english: string, indonesian: string) => string;

const folderOrder: ExplorerFolder[] = ['input', 'trajectory', 'output', 'results', 'analysis', 'runtime'];

const folderLabels: Record<ExplorerFolder, [string, string]> = {
  input: ['Input', 'Input'],
  trajectory: ['Trajectory', 'Trajectory'],
  output: ['Output', 'Output'],
  results: ['Results', 'Hasil'],
  analysis: ['Analysis', 'Analisis'],
  runtime: ['Runtime files', 'File runtime'],
};

const formatBytes = (bytes?: number) => {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
};

const fileFolder = (artifact: PhyniteResultArtifact): ExplorerFolder => {
  if (artifact.role === 'input') return 'input';
  if (artifact.role === 'log') return 'output';
  if (artifact.role === 'workspace') return 'runtime';
  return 'results';
};

const fileName = (path: string) => path.split('/').filter(Boolean).at(-1) || 'artifact';
const safeRunName = (run: ExplorerRun) => `${run.type} · ${run.name}`;
const isTextFile = (file: ExplorerFile) => file.contentType.startsWith('text/') || file.contentType.includes('json') || /\.(in|out|log|txt|csv|json|xml|yaml|yml|gnu)$/i.test(file.name);
const isImageFile = (file: ExplorerFile) => file.contentType.startsWith('image/') || /\.(png|jpe?g|svg|webp)$/i.test(file.name);

const inlineFile = (file: PhyniteCalculationFile): ExplorerFile => ({
  id: file.path,
  folder: file.path.startsWith('runtime/') ? 'runtime' : 'input',
  path: file.path,
  name: file.name,
  role: file.role,
  contentType: file.contentType,
  sizeBytes: file.sizeBytes,
  content: file.content,
});

const artifactFile = (artifact: PhyniteResultArtifact): ExplorerFile => {
  const folder = fileFolder(artifact);
  return {
    id: `${folder}/${artifact.path}`,
    folder,
    path: `${folder}/${artifact.path}`,
    name: fileName(artifact.path),
    role: artifact.role,
    contentType: artifact.contentType,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    viewUrl: artifact.viewUrl,
    downloadUrl: artifact.downloadUrl,
  };
};

const downloadBlob = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

export function ProjectFilesExplorer({
  project,
  onClose,
  t,
  intlLocale,
  mode = 'dialog',
}: {
  project: ProjectFilesTarget | null;
  onClose?: () => void;
  t: Translate;
  intlLocale: string;
  mode?: 'dialog' | 'page';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mdClient = useMemo(() => createMdCloudStorageClient({ transport: createSameOriginMdCloudTransport() }), []);
  const [runs, setRuns] = useState<ExplorerRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [files, setFiles] = useState<ExplorerFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState('');
  const [openFolders, setOpenFolders] = useState<Set<ExplorerFolder>>(new Set(folderOrder));
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [remotePreview, setRemotePreview] = useState({ id: '', content: '' });
  const [previewLoadingId, setPreviewLoadingId] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const remoteId = project?.remoteId;
  const loadRuns = useCallback(async () => {
    if (!project || !remoteId) { setRuns([]); setSelectedRunId(''); return; }
    setLoadingRuns(true); setError(''); setFiles([]); setSelectedFileId('');
    const requests: Promise<ExplorerRun[]>[] = [];
    if (project.tags.includes('QE')) {
      requests.push(phyniteCalculations.list(remoteId).then(({ calculations }) => calculations.map(calculation => ({
        id: `qe:${calculation.id}`,
        kind: 'qe' as const,
        name: calculation.name,
        type: calculation.calculationType,
        status: calculation.status,
        createdAt: calculation.createdAt,
        calculation,
      }))));
    }
    if (project.tags.some(tag => tag === 'MD' || tag === 'LAMMPS')) {
      requests.push(mdClient.listTrajectories(remoteId).then(({ trajectories }) => trajectories.map(trajectory => ({
        id: `trajectory:${trajectory.id}`,
        kind: 'trajectory' as const,
        name: trajectory.name || trajectory.filename,
        type: trajectory.format.includes('lammps') ? 'LAMMPS trajectory' : 'MD trajectory',
        status: trajectory.status,
        createdAt: trajectory.createdAt,
        trajectory,
      }))));
      requests.push(mdClient.listAnalyses(remoteId).then(({ analyses }) => analyses.map(analysis => ({
        id: `analysis:${analysis.id}`,
        kind: 'analysis' as const,
        name: analysis.name || 'MD analysis',
        type: 'MD analysis',
        status: analysis.status,
        createdAt: analysis.createdAt,
        analysis,
      }))));
    }
    try {
      const settled = await Promise.allSettled(requests);
      const next = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setRuns(next);
      setSelectedRunId(current => next.some(run => run.id === current) ? current : next[0]?.id ?? '');
      if (settled.some(result => result.status === 'rejected') && !next.length) setError(t('Project files could not be loaded.', 'File project belum dapat dimuat.'));
    } catch { setError(t('Project files could not be loaded.', 'File project belum dapat dimuat.')); }
    finally { setLoadingRuns(false); }
  }, [mdClient, project, remoteId, t]);

  useEffect(() => {
    if (!project) return;
    if (mode === 'dialog' && !dialog.current?.open) dialog.current?.showModal();
    const frame = window.requestAnimationFrame(() => { void loadRuns(); });
    return () => window.cancelAnimationFrame(frame);
  }, [loadRuns, mode, project]);

  useEffect(() => {
    if (!selectedRunId) return;
    const run = runs.find(item => item.id === selectedRunId);
    if (!run) return;
    let cancelled = false;
    const load = async () => {
      const next: ExplorerFile[] = [];
      if (run.kind === 'qe') {
        const [detail, inputs] = await Promise.allSettled([
          phyniteCalculations.get(run.calculation.id),
          phyniteCalculations.files(run.calculation.id),
        ]);
        if (inputs.status === 'fulfilled') next.push(...inputs.value.files.map(inlineFile));
        if (detail.status === 'fulfilled') {
          next.push(...(detail.value.result?.artifacts ?? []).map(artifactFile));
          if (detail.value.calculation.logTail && !next.some(file => file.role === 'log')) {
            const content = detail.value.calculation.logTail.endsWith('\n') ? detail.value.calculation.logTail : `${detail.value.calculation.logTail}\n`;
            next.push({ id: 'output/execution.log', folder: 'output', path: 'output/execution.log', name: 'execution.log', role: 'log', contentType: 'text/plain', sizeBytes: new TextEncoder().encode(content).length, content });
          }
          if (detail.value.result && !next.some(file => file.id === 'results/result.json')) {
            const content = `${JSON.stringify(detail.value.result, null, 2)}\n`;
            next.push({ id: 'results/result.json', folder: 'results', path: 'results/result.json', name: 'result.json', role: 'manifest', contentType: 'application/json', sizeBytes: new TextEncoder().encode(content).length, content });
          }
        }
        if (detail.status === 'rejected' && inputs.status === 'rejected') throw detail.reason;
      } else if (run.kind === 'trajectory') {
        const detail = await mdClient.getTrajectory(run.trajectory.id);
        const trajectory = detail.trajectory;
        next.push({
          id: `trajectory/${trajectory.filename}`,
          folder: 'trajectory',
          path: `trajectory/${trajectory.filename}`,
          name: trajectory.filename,
          role: 'trajectory',
          contentType: trajectory.contentType || 'application/octet-stream',
          sizeBytes: trajectory.sizeBytes,
          sha256: trajectory.sha256,
          viewUrl: detail.downloadUrl,
          downloadUrl: detail.downloadUrl,
        });
        if (trajectory.studioSettings) {
          const content = `${JSON.stringify(trajectory.studioSettings, null, 2)}\n`;
          next.push({ id: 'analysis/studio-settings.json', folder: 'analysis', path: 'analysis/studio-settings.json', name: 'studio-settings.json', role: 'settings', contentType: 'application/json', sizeBytes: new TextEncoder().encode(content).length, content });
        }
        const record = { id: trajectory.id, projectId: trajectory.projectId, filename: trajectory.filename, format: trajectory.format, status: trajectory.status, sizeBytes: trajectory.sizeBytes, sha256: trajectory.sha256, createdAt: trajectory.createdAt, uploadedAt: trajectory.uploadedAt };
        const content = `${JSON.stringify(record, null, 2)}\n`;
        next.push({ id: 'runtime/trajectory.json', folder: 'runtime', path: 'runtime/trajectory.json', name: 'trajectory.json', role: 'runtime', contentType: 'application/json', sizeBytes: new TextEncoder().encode(content).length, content });
      } else {
        const detail = await mdClient.getAnalysis(run.analysis.id);
        const runtimeContent = `${JSON.stringify(detail.analysis, null, 2)}\n`;
        next.push({ id: 'runtime/analysis.json', folder: 'runtime', path: 'runtime/analysis.json', name: 'analysis.json', role: 'runtime', contentType: 'application/json', sizeBytes: new TextEncoder().encode(runtimeContent).length, content: runtimeContent });
        if (detail.resultManifestUrl) {
          const response = await fetch(detail.resultManifestUrl, { signal: AbortSignal.timeout(30_000) });
          if (response.ok) {
            const result = await response.json() as MdCloudResultManifest;
            const content = `${JSON.stringify(result, null, 2)}\n`;
            next.push({ id: 'results/result.json', folder: 'results', path: 'results/result.json', name: 'result.json', role: 'manifest', contentType: 'application/json', sizeBytes: new TextEncoder().encode(content).length, content });
            if ('artifacts' in result) {
              const signed = await Promise.allSettled(result.artifacts.map(async artifact => {
                const access = await mdClient.getAnalysisArtifact(run.analysis.id, artifact.path);
                return { id: `results/${artifact.path}`, folder: 'results' as const, path: `results/${artifact.path}`, name: fileName(artifact.path), role: artifact.role, contentType: artifact.contentType, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256, viewUrl: access.url, downloadUrl: access.url };
              }));
              next.push(...signed.flatMap(item => item.status === 'fulfilled' ? [item.value] : []));
            }
          }
        }
      }
      if (!cancelled) { setFiles(next); setSelectedFileId(next[0]?.id ?? ''); }
    };
    const frame = window.requestAnimationFrame(() => {
      setLoadingFiles(true); setError(''); setFiles([]); setSelectedFileId('');
      void load().catch(() => { if (!cancelled) setError(t('This run’s files are temporarily unavailable.', 'File eksekusi ini sementara belum tersedia.')); }).finally(() => { if (!cancelled) setLoadingFiles(false); });
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [mdClient, runs, selectedRunId, t]);

  const selectedRun = runs.find(run => run.id === selectedRunId);
  const selectedFile = files.find(file => file.id === selectedFileId);
  const remoteTextPreview = Boolean(selectedFile?.viewUrl && isTextFile(selectedFile) && (selectedFile.sizeBytes ?? 0) <= 1_500_000);
  const preview = selectedFile?.content ?? (remoteTextPreview && remotePreview.id === selectedFile?.id ? remotePreview.content : '');
  const previewLoading = Boolean(selectedFile && previewLoadingId === selectedFile.id);
  const visibleFiles = files.filter(file => `${file.name} ${file.path} ${file.role}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groupedFiles = folderOrder.map(folder => ({ folder, files: visibleFiles.filter(file => file.folder === folder) })).filter(group => group.files.length);

  useEffect(() => {
    if (!selectedFile?.viewUrl || !remoteTextPreview) return;
    const controller = new AbortController();
    const load = async () => {
      setPreviewLoadingId(selectedFile.id); setRemotePreview({ id: '', content: '' });
      try {
        const response = await fetch(selectedFile.viewUrl!, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
        if (!response.ok) throw new Error('preview');
        setRemotePreview({ id: selectedFile.id, content: (await response.text()).slice(0, 1_500_000) });
      } catch { if (!controller.signal.aborted) setRemotePreview({ id: selectedFile.id, content: '' }); }
      finally { if (!controller.signal.aborted) setPreviewLoadingId(''); }
    };
    void load();
    return () => controller.abort();
  }, [remoteTextPreview, selectedFile]);

  const download = async (file: ExplorerFile) => {
    if (file.content !== undefined) { downloadBlob(file.name, new Blob([file.content], { type: file.contentType })); return; }
    const remoteUrl = file.downloadUrl || file.viewUrl;
    if (remoteUrl) {
      const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(60_000) });
      if (response.ok) downloadBlob(file.name, await response.blob());
    }
  };

  const close = () => { if (dialog.current?.open) dialog.current.close(); else onClose?.(); };
  if (!project) return null;
  const hasCloudIdentity = Boolean(remoteId);

  const explorer = (
      <div className="studio-files-shell" data-mode={mode}>
        <header className="studio-files-header">
          <div className="studio-files-heading">
            <span className="studio-files-mark"><FolderOpen size={19} /></span>
            <span>
              <small>{t('Project files', 'File project')}{project.tags.length > 0 && <span className="studio-files-engine"> · {project.tags.join(' · ')}</span>}</small>
              <h2 id="project-files-title">{project.name}</h2>
            </span>
          </div>
          {mode === 'dialog' && <div className="studio-files-header-actions"><button type="button" className="studio-files-icon-button" aria-label={t('Close project files', 'Tutup file project')} onClick={close}><X size={18} /></button></div>}
        </header>

        <div className="studio-files-location">
          <Cloud size={13} /><span>{project.name}</span>{selectedRun && <><ChevronRight size={12} /><strong>{safeRunName(selectedRun)}</strong></>}{selectedFile && <><ChevronRight size={12} /><span>{selectedFile.path}</span></>}
        </div>

        <div className="studio-files-workspace">
          <aside className="studio-files-runs" aria-label={t('Project runs', 'Eksekusi project')}>
            <div className="studio-files-pane-title"><span>{t('Runs', 'Eksekusi')}</span><b>{runs.length}</b></div>
            {loadingRuns && <div className="studio-files-loading"><LoaderCircle className="studio-files-spin" size={17} />{t('Reading project…', 'Membaca project…')}</div>}
            {!loadingRuns && !hasCloudIdentity && <div className="studio-files-empty"><Database size={20} /><strong>{t('No cloud files yet', 'Belum ada file cloud')}</strong><p>{t('Run or save this project first. Its generated files will appear here.', 'Jalankan atau simpan project ini terlebih dahulu. File yang dihasilkan akan muncul di sini.')}</p></div>}
            {!loadingRuns && hasCloudIdentity && !runs.length && !error && <div className="studio-files-empty"><Folder size={20} /><strong>{t('No runs yet', 'Belum ada eksekusi')}</strong><p>{t('Files appear here after a calculation or trajectory is saved from its project workspace.', 'File muncul di sini setelah calculation atau trajectory disimpan dari workspace project.')}</p></div>}
            <div className="studio-files-run-list">{runs.map(run => <button key={run.id} type="button" data-selected={run.id === selectedRunId} onClick={() => setSelectedRunId(run.id)}><span className="studio-files-run-icon">{run.kind === 'qe' ? 'QE' : run.kind === 'trajectory' ? 'MD' : 'A'}</span><span><strong>{run.name}</strong><small>{run.type}</small></span><i data-status={run.status}>{run.status.replaceAll('_', ' ')}</i></button>)}</div>
          </aside>

          <aside className="studio-files-tree" aria-label={t('Files in selected run', 'File dalam eksekusi terpilih')}>
            <div className="studio-files-tree-toolbar">
              <label><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} type="search" placeholder={t('Filter files', 'Cari file')} aria-label={t('Filter run files', 'Cari file eksekusi')} />{query && <button type="button" onClick={() => setQuery('')} aria-label={t('Clear file filter', 'Hapus pencarian file')}><X size={12} /></button>}</label>
            </div>
            {loadingFiles && <div className="studio-files-loading"><LoaderCircle className="studio-files-spin" size={17} />{t('Reading files…', 'Membaca file…')}</div>}
            {!loadingFiles && selectedRun && !files.length && !error && <div className="studio-files-empty"><File size={20} /><strong>{t('No retained files', 'Tidak ada file tersimpan')}</strong><p>{t('This run has no files available for its current state.', 'Eksekusi ini belum memiliki file untuk statusnya saat ini.')}</p></div>}
            {!loadingFiles && groupedFiles.map(group => {
              const expanded = openFolders.has(group.folder);
              return <section key={group.folder} className="studio-files-folder"><button type="button" aria-expanded={expanded} onClick={() => setOpenFolders(current => { const next = new Set(current); if (next.has(group.folder)) next.delete(group.folder); else next.add(group.folder); return next; })}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{expanded ? <FolderOpen size={14} /> : <Folder size={14} />}<strong>{t(...folderLabels[group.folder])}</strong><span>{group.files.length}</span></button>{expanded && <div>{group.files.map(file => <button key={file.id} type="button" data-selected={file.id === selectedFileId} onClick={() => setSelectedFileId(file.id)}><FileText size={14} /><span><strong>{file.name}</strong><small>{file.path}</small></span><em>{formatBytes(file.sizeBytes)}</em></button>)}</div>}</section>;
            })}
          </aside>

          <section className="studio-files-preview" aria-label={t('File preview', 'Preview file')}>
            {error && <div className="studio-files-error" role="alert"><strong>{error}</strong><button type="button" onClick={() => void loadRuns()}>{t('Try again', 'Coba lagi')}</button></div>}
            {!selectedFile && !error && <div className="studio-files-preview-empty"><FileText size={24} /><strong>{t('Select a file to inspect it', 'Pilih file untuk memeriksanya')}</strong><p>{t('Raw content and provenance appear here. Files can only be added from the project that produced them.', 'Isi mentah dan provenance muncul di sini. File hanya dapat ditambahkan dari project yang menghasilkannya.')}</p></div>}
            {selectedFile && <>
              <header className="studio-files-preview-header"><div><span className="studio-files-file-icon"><FileText size={18} /></span><span><h3>{selectedFile.name}</h3><p>{selectedFile.path}</p></span></div><button type="button" className="lab-button" onClick={() => void download(selectedFile)}><Download size={14} />{t('Download', 'Unduh')}</button></header>
              <dl className="studio-files-provenance"><div><dt>{t('Produced by', 'Dihasilkan oleh')}</dt><dd>{selectedRun ? safeRunName(selectedRun) : '—'}</dd></div><div><dt>{t('Role', 'Peran')}</dt><dd>{selectedFile.role.replaceAll('-', ' ')}</dd></div><div><dt>{t('Format', 'Format')}</dt><dd>{selectedFile.contentType}</dd></div><div><dt>{t('Size', 'Ukuran')}</dt><dd>{formatBytes(selectedFile.sizeBytes)}</dd></div>{selectedFile.sha256 && <div><dt>SHA-256</dt><dd title={selectedFile.sha256}>{selectedFile.sha256.slice(0, 12)}…</dd></div>}<div><dt>{t('Storage', 'Penyimpanan')}</dt><dd><Cloud size={12} />{t('Private cloud', 'Cloud privat')}</dd></div></dl>
              <div className="studio-files-preview-body">
                {previewLoading && <div className="studio-files-loading"><LoaderCircle className="studio-files-spin" size={17} />{t('Opening preview…', 'Membuka preview…')}</div>}
                {!previewLoading && preview && <pre><code>{preview}</code></pre>}
                {/* Signed scientific artifacts cannot use Next Image's static host allowlist. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {!previewLoading && !preview && isImageFile(selectedFile) && selectedFile.viewUrl && <div className="studio-files-image-preview"><img src={selectedFile.viewUrl} alt={selectedFile.name} /></div>}
                {!previewLoading && !preview && !isImageFile(selectedFile) && <div className="studio-files-binary"><Database size={24} /><strong>{t('Preview is unavailable for this format', 'Preview tidak tersedia untuk format ini')}</strong><p>{t('Download the original file to inspect it with its scientific application.', 'Unduh file asli untuk memeriksanya dengan aplikasi ilmiah yang sesuai.')}</p></div>}
              </div>
            </>}
          </section>
        </div>

        <footer className="studio-files-footer"><span><ShieldCheck size={13} />{t('Generated files are immutable and keep their calculation provenance.', 'File hasil bersifat tetap dan menyimpan provenance calculation.')}</span><span><Clock3 size={13} />{project.updatedAt && Number.isFinite(Date.parse(project.updatedAt)) ? t(`Project updated ${new Date(project.updatedAt).toLocaleDateString(intlLocale)}`, `Project diperbarui ${new Date(project.updatedAt).toLocaleDateString(intlLocale)}`) : ''}</span><a href={project.href}>{t('Open project', 'Buka project')}<ExternalLink size={13} /></a></footer>
      </div>
  );
  if (mode === 'page') return <section className="studio-files-page" aria-labelledby="project-files-title">{explorer}</section>;
  return <dialog ref={dialog} className="studio-files-dialog" aria-labelledby="project-files-title" onCancel={event => { event.preventDefault(); close(); }} onClose={onClose}>{explorer}</dialog>;
}
