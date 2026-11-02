'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, LogIn } from 'lucide-react';
import { useSession } from '../use-session';
import { notifySessionChange, subscribeToSession } from '../auth-client';
import { useSettingsAnchor } from '../use-settings-anchor';
import { useLocale } from '../locale-provider';
import { useUnsavedSettings } from '../use-unsaved-settings';
import { SettingsRow, SettingsSection } from '@/components/SettingsPage';
import { UiSelect } from '@/components/UiSelect';
import { computeCapacityChoices, computeCapacityLabel, type ComputeCatalog, type ComputeProfile } from '@/lib/compute-selection';
import { localRequest } from '@/lib/local-api';
import './settings.css';

type RuntimeState = {
  runtime: { platform?: string; error?: string; installed: Record<string, { version?: string }>; availableComponents?: string[]; downloadAvailable: boolean; requirements?: Record<string, { downloadBytes?: number; maxInstalledBytes?: number; compatible?: boolean; reason?: string }>; executables?: Record<string, string>; isolation?: { available: boolean; reason?: string }; progress?: { state?: string; component?: string; downloadedBytes?: number; totalBytes?: number; error?: string } };
  capabilities?: { solver?: string[] };
  resources: { vcpus: number; memoryMiB: number; maxParallelJobs: number; cpuCapacity?: number; memoryCapacityMiB?: number; memoryEnforcement?: string } | null;
};
type Connection = { authenticated?: boolean; configured?: boolean; account?: string; accountId?: string; persistent?: boolean };
type Project = { id: string; name: string };
type SyncProject = { project: string; enabled: boolean; state: string; message?: string; revision: number };
type SyncInventory = { projects: SyncProject[]; cloudProjects: Array<{ projectId: string; revision: number; deleted?: boolean }> };
type SyncPreview = { projectId: string; snapshotSha256: string; scope: string; transferBytes: number; artifactCount: number; missingAssets: unknown[]; cloudStorage: { bytes?: number; limitBytes?: number; availableBytes?: number } };
type CloudPreview = { executionId: string; localProjectId: string; inputSha256: string; inputBytes: number; inputs: { structure: string; calculationType: string; inputFiles: string[]; dependencies?: Array<{ filename: string; sha256: string; sizeBytes: number }> }; retention: { inputs: string; results: string }; transferScope?: string };
type CloudMode = 'paid' | 'pilot';
type CloudCatalog = { catalog: ComputeCatalog; paid?: { available: boolean; status: string }; pilot?: { available: boolean; status: string; limits?: { vcpus: number; memoryMiB: number; timeoutSeconds: number }; remainingJobs?: number; reason?: string } | null; pilotError?: string };
type CloudExecution = { id: string; projectId: string; status: string; imported: boolean };
type CloudQuote = { id: string; cloudMode: CloudMode; profile: ComputeProfile & { timeoutSeconds?: number }; estimatedMicros: number; estimatedSeconds?: number; expiresAtEpoch: number };
type CloudPrepared = { executionId: string; inputSha256: string; quote: CloudQuote | null };
type CloudActionResult = { executionId?: string; status?: string; inputSha256?: string; quote?: CloudQuote | null; execution?: { id?: string; status?: string; calculation?: { status: string } }; imported?: boolean };

function cloudIdentity(connection: Connection): string {
  return connection.authenticated ? connection.accountId ?? connection.account ?? 'connected-cloud-account' : '';
}

function validateCloudCatalog(value: CloudCatalog): CloudCatalog {
  const profiles = value.catalog?.profiles;
  if (typeof value.catalog?.region !== 'string' || !value.catalog.region || !Number.isFinite(Date.parse(value.catalog.updatedAt)) || !Array.isArray(profiles) || new Set(profiles.map(profile => profile.id)).size !== profiles.length || profiles.some(profile => !validCloudProfile(profile) || profile.hourlyQuanta !== profile.hourlyMicros / 1_000_000)) {
    throw new Error('The cloud compute catalog is invalid. Refresh before selecting a profile.');
  }
  return value;
}

function validCloudProfile(profile: ComputeProfile): boolean {
  return !!profile && typeof profile.id === 'string' && !!profile.id && Number.isSafeInteger(profile.vcpus) && profile.vcpus > 0 && Number.isSafeInteger(profile.memoryMiB) && profile.memoryMiB > 0 && Number.isSafeInteger(profile.hourlyMicros) && profile.hourlyMicros > 0;
}

function validCloudQuote(quote: CloudQuote): boolean {
  return !!quote && /^[a-f0-9]{32}$/.test(quote.id) && (quote.cloudMode === 'paid' || quote.cloudMode === 'pilot') && validCloudProfile(quote.profile) && Number.isSafeInteger(quote.estimatedMicros) && quote.estimatedMicros >= 0 && Number.isSafeInteger(quote.expiresAtEpoch) && quote.expiresAtEpoch > 0 && (quote.estimatedSeconds === undefined || Number.isSafeInteger(quote.estimatedSeconds) && quote.estimatedSeconds > 0) && (quote.profile.timeoutSeconds === undefined || Number.isSafeInteger(quote.profile.timeoutSeconds) && quote.profile.timeoutSeconds > 0);
}

export function LocalSettings({ section }: { section: 'compute' | 'account' | 'storage' }) {
  const { session } = useSession(); const { t, intlLocale } = useLocale();
  const [runtime, setRuntime] = useState<RuntimeState | null>(null);
  const [resources, setResources] = useState<RuntimeState['resources']>(null);
  const [connection, setConnection] = useState<Connection>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [sync, setSync] = useState<SyncInventory>({ projects: [], cloudProjects: [] });
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);
  const [cloudProject, setCloudProject] = useState(''); const [cloudCalculation, setCloudCalculation] = useState('');
  const [cloudCalculations, setCloudCalculations] = useState<Array<{ id: string; name: string }>>([]);
  const [cloudPreview, setCloudPreview] = useState<CloudPreview | null>(null);
  const [cloudCatalog, setCloudCatalog] = useState<CloudCatalog | null>(null); const [cloudCatalogError, setCloudCatalogError] = useState('');
  const [cloudMode, setCloudMode] = useState<CloudMode | ''>(''); const [cloudProfile, setCloudProfile] = useState('');
  const [cloudExecutions, setCloudExecutions] = useState<CloudExecution[]>([]); const [cloudHistoryError, setCloudHistoryError] = useState('');
  const [cloudPrepared, setCloudPrepared] = useState<CloudPrepared | null>(null);
  const [quoteNow, setQuoteNow] = useState(0);
  const cloudAccount = useRef(''); const cloudRefresh = useRef(0); const projectChoice = useRef('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const resourceDirty = section === 'compute' && Boolean(resources && runtime?.resources && (resources.vcpus !== runtime.resources.vcpus || resources.memoryMiB !== runtime.resources.memoryMiB || resources.maxParallelJobs !== runtime.resources.maxParallelJobs));
  useUnsavedSettings(resourceDirty);
  const installing = Boolean(runtime?.runtime.progress?.state && !['idle', 'complete', 'failed'].includes(runtime.runtime.progress.state));
  useSettingsAnchor(Boolean(session));
  const refresh = useCallback(async () => {
    const request = ++cloudRefresh.current;
    if (section === 'compute') { const next = await localRequest<RuntimeState>('runtime'); setRuntime(next); setResources(previous => previous ?? (next.resources ? { vcpus: next.resources.vcpus, memoryMiB: next.resources.memoryMiB, maxParallelJobs: next.resources.maxParallelJobs } : null)); }
    const optional = await Promise.allSettled([section === 'storage' ? Promise.resolve({} as Connection) : localRequest<Connection>('cloud'), fetch('/api/phynite/v1/projects').then(async response => {
      if (!response.ok) throw new Error('Could not read local projects.');
      return await response.json() as { projects: Project[] };
    })]);
    if (request !== cloudRefresh.current) return;
    if (optional[1].status === 'fulfilled') setProjects(optional[1].value.projects); else throw optional[1].reason;
    if (optional[0].status === 'fulfilled') {
      const connection = optional[0].value, account = cloudIdentity(connection);
      if (cloudAccount.current !== account) {
        cloudAccount.current = account;
        setCloudPreview(null); setCloudPrepared(null); setCloudExecutions([]); setCloudMode(''); setCloudProfile(''); setCloudCatalog(null); setCloudCatalogError(''); setCloudHistoryError(''); setSyncPreview(null);
      }
      setConnection(connection);
      if (connection.authenticated) {
        const connected = await Promise.allSettled([localRequest<SyncInventory>('sync'), section === 'compute' ? localRequest<CloudCatalog>('cloud/compute/catalog').then(validateCloudCatalog) : Promise.reject(new Error('Not requested')), section === 'compute' ? localRequest<{ executions: CloudExecution[] }>('cloud/compute') : Promise.resolve({ executions: [] })]);
        if (request !== cloudRefresh.current || cloudAccount.current !== account) return;
        if (connected[0].status === 'fulfilled') setSync(connected[0].value);
        if (connected[1].status === 'fulfilled') {
          const catalog = connected[1].value; setCloudCatalog(catalog); setCloudCatalogError('');
          setCloudProfile(previous => catalog.catalog.profiles.some(profile => profile.id === previous) ? previous : '');
        } else { setCloudCatalog(null); setCloudCatalogError(connected[1].reason instanceof Error ? connected[1].reason.message : 'Cloud compute catalog is unavailable.'); }
        if (connected[2].status === 'fulfilled') { setCloudExecutions(connected[2].value.executions); setCloudHistoryError(''); }
        else { setCloudExecutions([]); setCloudHistoryError(connected[2].reason instanceof Error ? connected[2].reason.message : 'Cloud execution history is unavailable.'); }
      } else { setSync({ projects: [], cloudProjects: [] }); setCloudExecutions([]); setCloudCatalog(null); }
    }
  }, [section]);
  useEffect(() => subscribeToSession(() => { void refresh().catch(() => {}); }), [refresh]);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => { if (mounted) void refresh().catch(reason => { if (mounted) setError(reason instanceof Error ? reason.message : String(reason)); }); });
    const timer = window.setInterval(() => { if (section === 'compute') void localRequest<RuntimeState>('runtime').then(next => { if (mounted) setRuntime(next); }).catch(() => {}); if (connection.authenticated) void localRequest<SyncInventory>('sync').then(next => { if (mounted) setSync(next); }).catch(() => {}); }, 3000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [refresh, connection.authenticated, section]);
  useEffect(() => {
    if (!connection.authenticated || section !== 'compute') return;
    const account = cloudIdentity(connection); let mounted = true;
    const timer = window.setInterval(() => {
      void localRequest<{ executions: CloudExecution[] }>('cloud/compute').then(value => {
        if (mounted && cloudAccount.current === account) { setCloudExecutions(value.executions); setCloudHistoryError(''); }
      }).catch(reason => { if (mounted && cloudAccount.current === account) { setCloudExecutions([]); setCloudHistoryError(reason instanceof Error ? reason.message : 'Cloud execution history is unavailable.'); } });
    }, 10000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [connection, section]);
  useEffect(() => {
    if (!cloudPrepared?.quote) return;
    const timer = window.setInterval(() => setQuoteNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cloudPrepared]);
  const act = async (path: string, method = 'POST', body?: unknown) => {
    setBusy(true); setError(''); setMessage('');
    try { const result = await localRequest<{ resources?: RuntimeState['resources'] }>(path, method, body); if (path === 'resources' && result.resources) setResources({ vcpus: result.resources.vcpus, memoryMiB: result.resources.memoryMiB, maxParallelJobs: result.resources.maxParallelJobs }); if (path === 'cloud/login' || path === 'cloud/logout') notifySessionChange(); await refresh(); setMessage(path === 'runtime/install' ? t('Installation started. Follow its progress below.', 'Pemasangan dimulai. Ikuti progresnya di bawah.') : t('Changes saved on this computer.', 'Perubahan disimpan di komputer ini.')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const refreshSettings = async () => {
    setBusy(true); setError('');
    try { await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const exportProject = async (id: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const exported = await localRequest<{ downloadUrl: string; missingAssets: unknown[] }>(`projects/${id}/export`, 'POST');
      const link = document.createElement('a'); link.href = exported.downloadUrl; link.download = 'project.phynite'; link.click();
      setMessage(exported.missingAssets.length ? t('Exported. Restricted or unlicensed assets must be selected again after import.', 'Diekspor. Aset terbatas atau tanpa lisensi terverifikasi perlu dipilih kembali setelah impor.') : t('Project export is ready.', 'Ekspor project siap.'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const importProject = async (file: File) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const transfer = await localRequest<{ importId: string; partBytes: number }>('projects/imports', 'POST', { sizeBytes: file.size, asCopy: true });
      for (let offset = 0, part = 0; offset < file.size; offset += transfer.partBytes, part++) {
        const response = await fetch(`/api/local/projects/imports/${transfer.importId}/parts/${part}`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file.slice(offset, offset + transfer.partBytes) });
        if (!response.ok) throw new Error((await response.json() as { error?: string }).error || 'Archive upload failed.');
        setMessage(t(`Importing ${Math.round(Math.min(file.size, offset + transfer.partBytes) / file.size * 100)}%…`, `Mengimpor ${Math.round(Math.min(file.size, offset + transfer.partBytes) / file.size * 100)}%…`));
      }
      const imported = await localRequest<{ missingAssets: unknown[] }>(`projects/imports/${transfer.importId}/complete`, 'POST');
      await refresh();
      setMessage(imported.missingAssets.length ? t('Imported as a copy. Select the listed restricted assets again before running.', 'Diimpor sebagai salinan. Pilih kembali aset terbatas sebelum menjalankan simulasi.') : t('Project imported as a separate copy.', 'Project diimpor sebagai salinan terpisah.'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const previewSync = async (id: string) => {
    setBusy(true); setError('');
    try { setSyncPreview(await localRequest<SyncPreview>(`sync/${id}/preview`, 'POST')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const chooseCloudProject = async (id: string) => {
    projectChoice.current = id; setCloudProject(id); setCloudCalculation(''); setCloudCalculations([]); setCloudPreview(null); setCloudPrepared(null); setError('');
    if (!id) return;
    try {
      const response = await fetch(`/api/phynite/v1/projects/${id}/calculations`, { cache: 'no-store', credentials: 'same-origin' });
      const result = await response.json() as { calculations: Array<{ id: string; name: string }>; error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not read saved calculations.');
      if (projectChoice.current === id) setCloudCalculations(result.calculations);
    } catch (reason) { if (projectChoice.current === id) setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const cloudProfiles = cloudCatalog ? computeCapacityChoices(cloudCatalog.catalog.profiles, cloudMode === 'pilot' ? cloudCatalog.pilot?.limits : {}) : [];
  const selectedCloudProfile = cloudProfiles.find(profile => profile.id === cloudProfile);
  const modeAvailable = cloudMode === 'paid' ? cloudCatalog?.paid?.available === true : cloudMode === 'pilot' && cloudCatalog?.pilot?.available === true && !!cloudCatalog.pilot.limits;
  const reviewCloud = async () => {
    if (!connection.authenticated || !modeAvailable || !selectedCloudProfile || !cloudCalculations.some(calculation => calculation.id === cloudCalculation)) return;
    const account = cloudAccount.current;
    setBusy(true); setError(''); setCloudPreview(null); setCloudPrepared(null);
    try {
      const preview = await localRequest<CloudPreview>('cloud/compute/preview', 'POST', { calculationId: cloudCalculation, cloudMode, computeProfileId: selectedCloudProfile.id });
      if (cloudAccount.current === account) { setCloudPreview(preview); await refresh(); }
    } catch (reason) { if (cloudAccount.current === account) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const cloudAction = async (action: 'prepare' | 'submit' | 'status' | 'cancel' | 'download', identifier?: string) => {
    const id = identifier ?? cloudPreview?.executionId ?? cloudPrepared?.executionId;
    if (!id || !connection.authenticated) return;
    const account = cloudAccount.current;
    let confirmation = cloudPreview?.executionId === id ? cloudPreview.inputSha256 : cloudPrepared?.executionId === id ? cloudPrepared.inputSha256 : undefined;
    if (action === 'submit' && !confirmation) return;
    if (action === 'submit' && (!cloudPrepared || cloudPrepared.executionId !== id || cloudPrepared.quote && cloudPrepared.quote.expiresAtEpoch * 1000 <= Date.now())) return;
    setBusy(true); setError(''); setMessage('');
    if (action === 'prepare') setCloudPrepared(previous => previous?.executionId === id ? null : previous);
    try {
      if (action === 'prepare' && !confirmation) {
        const saved = await localRequest<CloudActionResult>(`cloud/compute/${encodeURIComponent(id)}`);
        if (cloudAccount.current !== account) return;
        if (saved.execution?.status !== 'PREPARED' || !saved.inputSha256) throw new Error(t('Review the saved calculation before uploading new inputs.', 'Tinjau kalkulasi tersimpan sebelum mengunggah input baru.'));
        confirmation = saved.inputSha256;
      }
      const result = await localRequest<CloudActionResult>(`cloud/compute/${encodeURIComponent(id)}${action === 'status' ? '' : `/${action}`}`, action === 'status' ? 'GET' : 'POST', action === 'prepare' ? { confirmSha256: confirmation } : action === 'submit' ? { confirmSha256: confirmation, ...(cloudPrepared?.quote ? { confirmQuoteId: cloudPrepared.quote.id } : {}) } : action === 'status' ? undefined : {});
      if (cloudAccount.current !== account) return;
      if (action === 'prepare') {
        if (result.quote === undefined || result.quote && !validCloudQuote(result.quote)) throw new Error(t('The cloud estimate is incomplete. Refresh it before running.', 'Estimasi cloud belum lengkap. Perbarui sebelum menjalankan.'));
        setCloudPrepared({ executionId: id, inputSha256: confirmation!, quote: result.quote }); setCloudPreview(null); setQuoteNow(Date.now());
      }
      if (action === 'status') {
        if (result.execution?.status === 'PREPARED' && result.quote && result.inputSha256) {
          if (!validCloudQuote(result.quote)) throw new Error(t('The saved cloud estimate is incomplete. Get a new estimate before running.', 'Estimasi cloud tersimpan belum lengkap. Minta estimasi baru sebelum menjalankan.'));
          setCloudPrepared({ executionId: id, inputSha256: result.inputSha256, quote: result.quote }); setQuoteNow(Date.now());
        } else setCloudPrepared(previous => previous?.executionId === id ? null : previous);
      }
      if (action === 'submit' || action === 'cancel') { setCloudPreview(null); setCloudPrepared(null); }
      await refresh();
      if (action === 'download') setMessage(t('Verified cloud results saved in the local project.', 'Hasil cloud terverifikasi disimpan ke project lokal.'));
    } catch (reason) { if (cloudAccount.current === account) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  if (!session) return null;
  return <>
    {error && <p className="local-settings-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {section === 'compute' && <>
    <SettingsSection id="your-computer" title={t('Scientific runtime', 'Runtime ilmiah')} description={runtime?.runtime.platform ?? t('Reading this computer…', 'Memeriksa komputer…')}>
      {runtime?.capabilities?.solver && <p className="settings-group-content">{t('Worker ready for', 'Worker siap untuk')}: {runtime.capabilities.solver.length ? runtime.capabilities.solver.join(', ') : t('No solvers ready yet', 'Belum ada solver siap')}</p>}
      {(['dft', 'md'] as const).map(component => { const requirement = runtime?.runtime.requirements?.[component], installed = runtime?.runtime.installed?.[component]; return <SettingsRow key={component} title={{ dft: 'Quantum ESPRESSO', md: 'LAMMPS + OVITO analysis' }[component]} description={<>{installed ? `${t('Installed', 'Terpasang')}${installed.version ? ` · ${installed.version}` : ''}` : t('Install the verified runtime, or use an installed solver.', 'Pasang runtime terverifikasi, atau gunakan solver yang sudah terpasang.')}{requirement?.reason && <span className="settings-runtime-detail">{requirement.reason}</span>}{requirement?.downloadBytes !== undefined && <span className="settings-runtime-detail">{t('Download', 'Unduhan')}: {(requirement.downloadBytes / 1024 ** 3).toLocaleString(intlLocale, { maximumFractionDigits: 2 })} GiB{requirement.maxInstalledBytes ? ` · ${t('Disk budget', 'Anggaran disk')}: ${(requirement.maxInstalledBytes / 1024 ** 3).toLocaleString(intlLocale, { maximumFractionDigits: 2 })} GiB` : ''}</span>}</>}><button className="lab-button" disabled={busy || installing || !runtime?.runtime.availableComponents?.includes(component)} onClick={() => void act('runtime/install', 'POST', { component })}>{installed ? t('Reinstall runtime', 'Pasang ulang runtime') : t('Install runtime', 'Pasang runtime')}</button></SettingsRow>; })}
      {runtime?.runtime.error && <p className="settings-group-content" role="alert">{runtime.runtime.error}</p>}
      {runtime && !runtime.runtime.downloadAvailable && !Object.keys(runtime.runtime.requirements ?? {}).length && !runtime.runtime.error && <p className="settings-group-content">{t('This build does not include a runtime catalog for this platform. Installed compatible solvers can still be detected.', 'Build ini belum menyertakan katalog runtime untuk platform ini. Solver kompatibel yang terpasang tetap dapat dideteksi.')}</p>}
      <SettingsRow title={t('Manual LAMMPS isolation', 'Isolasi LAMMPS manual')} description={runtime?.runtime.isolation?.reason}><span>{runtime?.runtime.isolation?.available ? t('Verified', 'Terverifikasi') : t('Not available', 'Belum tersedia')}</span></SettingsRow>
      {runtime?.runtime.progress && <p className="settings-group-content" role={runtime.runtime.progress.error ? 'alert' : 'status'} aria-live="polite">{runtime.runtime.progress.component ? `${runtime.runtime.progress.component} · ` : ''}{runtime.runtime.progress.state}{runtime.runtime.progress.totalBytes && runtime.runtime.progress.totalBytes > 0 && runtime.runtime.progress.downloadedBytes !== undefined ? ` · ${Math.min(100, Math.max(0, runtime.runtime.progress.downloadedBytes / runtime.runtime.progress.totalBytes * 100)).toFixed(0)}%` : ''}{runtime.runtime.progress.error ? ` · ${runtime.runtime.progress.error}` : ''}</p>}
    </SettingsSection>
    <SettingsSection id="compute-defaults" title={t('Compute budget', 'Anggaran komputasi')} description={t('Defaults apply to new jobs. Memory is monitored across each process tree.', 'Default berlaku untuk job baru. Memori dipantau pada seluruh proses job.')}>
      {runtime?.resources && <p className="settings-group-content">{runtime.resources.cpuCapacity !== undefined ? `${t('Detected', 'Terdeteksi')}: ${runtime.resources.cpuCapacity.toLocaleString(intlLocale)} ${t('logical cores', 'core logis')}` : ''}{runtime.resources.memoryCapacityMiB !== undefined ? ` · ${(runtime.resources.memoryCapacityMiB / 1024).toLocaleString(intlLocale, { maximumFractionDigits: 2 })} GiB RAM` : ''}</p>}
      {runtime?.resources?.memoryEnforcement && <p className="settings-group-content">{t('Memory enforcement', 'Pengawasan memori')}: {runtime.resources.memoryEnforcement}. {t('Phynite observes process-tree RSS and stops jobs that exceed the budget. This watchdog is not an operating-system hard memory limit.', 'Phynite memantau RSS seluruh proses job dan menghentikan job yang melewati anggaran. Pemantauan ini bukan batas memori keras dari sistem operasi.')}</p>}
      {resources && <form className="local-settings-form" data-settings-dirty={resourceDirty || undefined} onSubmit={event => { event.preventDefault(); void act('resources', 'PUT', { vcpus: resources.vcpus, memoryMiB: resources.memoryMiB, maxParallelJobs: resources.maxParallelJobs }); }}>
        <label>CPU<input type="number" min={1} max={runtime?.resources?.cpuCapacity} step={1} required value={resources.vcpus} onChange={event => setResources({ ...resources, vcpus: Number(event.target.value) })} /></label>
        <label>{t('RAM (MiB)', 'RAM (MiB)')}<input type="number" min={1} max={runtime?.resources?.memoryCapacityMiB} step={1} required value={resources.memoryMiB} onChange={event => setResources({ ...resources, memoryMiB: Number(event.target.value) })} /></label>
        <label>{t('Parallel jobs', 'Job paralel')}<input type="number" min={1} max={runtime?.resources?.cpuCapacity} step={1} required value={resources.maxParallelJobs} onChange={event => setResources({ ...resources, maxParallelJobs: Number(event.target.value) })} /></label>
        <button className="lab-button lab-button-primary" disabled={busy}>{t('Save budget', 'Simpan anggaran')}</button>
      </form>}
    </SettingsSection>
    </>}
    {section === 'storage' && <SettingsSection id="storage" title={t('Project archives', 'Arsip project')} description={t('Export inputs, configurations, available results and checksums. Import creates a separate copy on this computer.', 'Ekspor input, konfigurasi, hasil yang tersedia dan checksum. Impor membuat salinan terpisah di komputer ini.')}>
      <div className="local-settings-form"><label>{t('Import a .phynite archive', 'Impor arsip .phynite')}<input type="file" accept=".phynite,.zip" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importProject(file); }} /></label></div>
      {!projects.length && <p className="settings-group-content">{t('No projects yet. Create a project or import an archive to get started.', 'Belum ada project. Buat project atau impor arsip untuk memulai.')}</p>}
      {projects.map(project => <SettingsRow key={project.id} title={project.name}><button className="lab-button" disabled={busy} onClick={() => void exportProject(project.id)}>{t('Export project', 'Ekspor project')}</button></SettingsRow>)}
    </SettingsSection>}
    {section === 'account' && <SettingsSection id="cloud" title="Phynite Cloud" description={t('Signing in does not upload your projects. Enable sync separately for each project.', 'Login tidak mengunggah project Anda. Aktifkan sinkronisasi untuk setiap project secara terpisah.')}>
      {connection.configured === false && <p className="settings-group-content">{t('Cloud connection is not configured in this build. Local work is available without an account.', 'Koneksi cloud belum dikonfigurasi pada build ini. Workspace lokal dapat dipakai tanpa akun.')}</p>}
      {connection.authenticated ? <div className="local-cloud-connected-card"><SettingsRow title={connection.account ?? t('Connected', 'Terhubung')} description={t('Signing out retains all local data.', 'Keluar tetap mempertahankan seluruh data lokal.')}><button className="lab-button" disabled={busy} onClick={() => void act('cloud/logout')}>{t('Sign out of cloud', 'Keluar dari cloud')}</button></SettingsRow></div> : <div className="local-cloud-login-card">
        <header><span className="local-cloud-login-mark"><Cloud size={18} aria-hidden="true" /></span><div><h3>{t('Sign in to Phynite Cloud', 'Login ke Phynite Cloud')}</h3><p>{t('Use cloud compute and enable sync per project when you are ready.', 'Gunakan komputasi cloud dan aktifkan sync per project saat Anda siap.')}</p></div></header>
        <form className="local-settings-form local-cloud-login-form" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const password = String(data.get('password') ?? ''); form.reset(); void act('cloud/login', 'POST', { identifier: String(data.get('identifier') ?? ''), password }); }}>
          <label>{t('Email or username', 'Email atau username')}<input name="identifier" autoComplete="username" required /></label><label>{t('Password', 'Kata sandi')}<input name="password" type="password" autoComplete="current-password" required /></label><button className="lab-button lab-button-primary" disabled={busy || connection.configured === false}><LogIn size={14} aria-hidden="true" />{t('Sign in', 'Login')}</button>
        </form>
        <p className="local-cloud-login-note">{t('Signing in never uploads local projects. Cloud Sync stays off until you enable it for a project.', 'Login tidak pernah mengunggah project lokal. Cloud Sync tetap mati sampai Anda mengaktifkannya untuk project.')}</p>
      </div>}
      {projects.map(project => {
        const state = sync.projects.find(item => item.project === project.id);
        return <SettingsRow key={project.id} title={project.name} description={state?.message ?? (state?.enabled ? `${state.state} · ${t('Revision', 'Revisi')} ${state.revision}` : t('Local only. A complete local copy is always retained.', 'Lokal saja. Salinan lokal lengkap selalu dipertahankan.'))}>
          <div className="local-settings-actions">{state?.state === 'conflict' && (['local', 'cloud', 'copy'] as const).map(choice => <button key={choice} className="lab-button" disabled={busy} onClick={() => void act(`sync/${project.id}/resolve`, 'POST', { choice })}>{choice === 'local' ? t('Use local', 'Pakai lokal') : choice === 'cloud' ? t('Use cloud', 'Pakai cloud') : t('Keep a copy', 'Simpan salinan')}</button>)}
          <button className="lab-button" disabled={busy || !connection.authenticated} onClick={() => state?.enabled ? void act(`sync/${project.id}/disable`) : void previewSync(project.id)}>{state?.enabled ? t('Disable sync', 'Matikan sync') : t('Enable Cloud Sync', 'Aktifkan Cloud Sync')}</button></div>
        </SettingsRow>;
      })}
      {syncPreview && <div className="local-settings-preview" role="region" aria-label={t('Review cloud upload', 'Tinjau unggahan cloud')}><h3>{t('Review Cloud Sync', 'Tinjau Cloud Sync')}</h3><p>{syncPreview.scope}</p><p>{(syncPreview.transferBytes / 1024 ** 2).toFixed(2)} MiB · {syncPreview.artifactCount} {t('chunks', 'bagian')} · {t('Cloud used', 'Cloud terpakai')}: {((syncPreview.cloudStorage.bytes ?? 0) / 1024 ** 2).toFixed(2)} MiB</p>{syncPreview.cloudStorage.limitBytes !== undefined && <p>{t('Quota', 'Kuota')}: {(syncPreview.cloudStorage.limitBytes / 1024 ** 3).toFixed(2)} GiB</p>}{syncPreview.missingAssets.length > 0 && <p>{t('Restricted assets are excluded and must be selected separately on another device.', 'Aset terbatas tidak diunggah dan perlu dipilih terpisah pada perangkat lain.')}</p>}<div className="local-settings-actions"><button className="lab-button lab-button-primary" disabled={busy} onClick={() => { void act(`sync/${syncPreview.projectId}/enable`, 'POST', { confirmSha256: syncPreview.snapshotSha256 }); setSyncPreview(null); }}>{t('Enable and upload', 'Aktifkan dan unggah')}</button><button className="lab-button" onClick={() => setSyncPreview(null)}>{t('Cancel', 'Batal')}</button></div></div>}
      {sync.cloudProjects.filter(project => !project.deleted && !projects.some(local => local.id === project.projectId)).map(project => <SettingsRow key={project.projectId} title={project.projectId} description={`${t('Cloud revision', 'Revisi cloud')} ${project.revision}`}><button className="lab-button" disabled={busy} onClick={() => void act(`sync/${project.projectId}/download`)}>{t('Download to this computer', 'Unduh ke komputer ini')}</button></SettingsRow>)}
      {sync.cloudProjects.filter(project => project.deleted).map(project => <SettingsRow key={project.projectId} title={project.projectId} description={t('In cloud Trash for up to 15 days.', 'Di Trash cloud hingga 15 hari.')}><button className="lab-button" disabled={busy} onClick={() => void act(`sync/${project.projectId}/restore`)}>{t('Restore project', 'Pulihkan project')}</button></SettingsRow>)}
    </SettingsSection>}
    {section === 'compute' && <SettingsSection id="cloud-compute" title={t('Run on cloud', 'Jalankan di cloud')} description={t('Review a saved DFT calculation and its required inputs before uploading. Cloud compute does not enable project sync. MD runs on your computer.', 'Tinjau kalkulasi DFT tersimpan dan input yang diperlukan sebelum mengunggah. Komputasi cloud tidak mengaktifkan sync project. MD berjalan di komputer Anda.')}>
      {!connection.authenticated && <p className="settings-group-content">{t('Connect your Phynite Cloud account in Settings → Account to use online compute.', 'Hubungkan akun Phynite Cloud di Pengaturan → Akun untuk menggunakan compute online.')}</p>}
      {connection.authenticated && <>
        <SettingsRow title={t('Cloud compute catalog', 'Katalog komputasi cloud')} description={cloudCatalog ? `${cloudCatalog.catalog.region} · ${t('Updated', 'Diperbarui')} ${new Date(cloudCatalog.catalog.updatedAt).toLocaleString(intlLocale)}` : t('Choose resources only after the cloud service returns its current catalog.', 'Pilih resource setelah layanan cloud memberikan katalog terkini.')}><button className="lab-button" disabled={busy} onClick={() => void refreshSettings()}>{t('Refresh catalog and history', 'Perbarui katalog dan riwayat')}</button></SettingsRow>
        {cloudCatalogError && <p className="local-settings-error" role="alert">{cloudCatalogError}</p>}
        {cloudCatalog && <p className="settings-group-content">{t('Paid compute', 'Komputasi berbayar')}: {cloudCatalog.paid?.status ?? t('Not available', 'Belum tersedia')} · {t('Pilot grant', 'Grant pilot')}: {cloudCatalog.pilot?.reason ?? cloudCatalog.pilot?.status ?? cloudCatalog.pilotError ?? t('Eligibility unavailable', 'Kelayakan belum tersedia')}</p>}
      </>}
      {connection.authenticated && <form className="local-settings-form" onSubmit={event => { event.preventDefault(); void reviewCloud(); }}>
        <label>{t('Local project', 'Project lokal')}<UiSelect ariaLabel={t('Local project', 'Project lokal')} disabled={busy} value={cloudProject} onChange={id => void chooseCloudProject(id)} options={[{ value: '', label: t('Choose a project', 'Pilih project') }, ...projects.map(project => ({ value: project.id, label: project.name }))]} /></label>
        <label>{t('Saved calculation', 'Kalkulasi tersimpan')}<UiSelect ariaLabel={t('Saved calculation', 'Kalkulasi tersimpan')} disabled={busy || !cloudProject} value={cloudCalculation} onChange={id => { setCloudCalculation(id); setCloudPreview(null); setCloudPrepared(null); }} options={[{ value: '', label: t('Choose a calculation', 'Pilih kalkulasi') }, ...cloudCalculations.map(calculation => ({ value: calculation.id, label: calculation.name }))]} /></label>
        <label>{t('Cloud funding', 'Pendanaan cloud')}<UiSelect ariaLabel={t('Cloud funding', 'Pendanaan cloud')} disabled={busy || !connection.authenticated || !cloudCatalog} value={cloudMode} onChange={mode => { if (mode === '' || mode === 'paid' || mode === 'pilot') { setCloudMode(mode); setCloudProfile(''); setCloudPreview(null); setCloudPrepared(null); } }} options={[{ value: '', label: t('Choose funding', 'Pilih pendanaan') }, { value: 'paid', label: t('Paid · Quanta balance', 'Berbayar · saldo Quanta'), disabled: cloudCatalog?.paid?.available !== true, detail: cloudCatalog?.paid?.status }, { value: 'pilot', label: t('Pilot grant', 'Grant pilot'), disabled: cloudCatalog?.pilot?.available !== true || !cloudCatalog.pilot.limits, detail: cloudCatalog?.pilot?.reason ?? cloudCatalog?.pilot?.status ?? cloudCatalog?.pilotError }]} /></label>
        <label>{t('Cloud CPU and RAM', 'CPU dan RAM cloud')}<UiSelect ariaLabel={t('Cloud CPU and RAM', 'CPU dan RAM cloud')} disabled={busy || !modeAvailable} value={cloudProfile} onChange={id => { setCloudProfile(id); setCloudPreview(null); setCloudPrepared(null); }} options={[{ value: '', label: t('Choose a catalog profile', 'Pilih profil katalog') }, ...cloudProfiles.map(profile => ({ value: profile.id, label: computeCapacityLabel(profile, intlLocale)!, detail: cloudMode === 'pilot' ? t('Uses the account’s pilot grant', 'Memakai grant pilot akun ini') : `${profile.hourlyQuanta.toLocaleString(intlLocale)} Quanta / ${t('hour', 'jam')}` }))]} /></label>
        <button className="lab-button" disabled={busy || !connection.authenticated || !cloudCalculation || !modeAvailable || !selectedCloudProfile}>{t('Review cloud inputs', 'Tinjau input cloud')}</button>
      </form>}
      {cloudPreview && <div className="local-settings-preview"><h3>{t('Review input upload', 'Tinjau unggahan input')}</h3><p>{cloudPreview.inputs.structure} · {cloudPreview.inputs.calculationType} · {(cloudPreview.inputBytes / 1024 ** 2).toFixed(2)} MiB</p><p>{cloudPreview.inputs.inputFiles.join(', ')}</p>{cloudPreview.inputs.dependencies?.map(file => <p key={file.filename}>{file.filename} · {(file.sizeBytes / 1024).toFixed(1)} KiB</p>)}<p>{cloudPreview.transferScope}</p><p>{cloudPreview.retention.inputs} {cloudPreview.retention.results}</p><div className="local-settings-actions"><button className="lab-button lab-button-primary" disabled={busy} onClick={() => void cloudAction('prepare')}>{t('Upload inputs and get estimate', 'Unggah input dan minta estimasi')}</button><button className="lab-button" disabled={busy} onClick={() => { setCloudPreview(null); setCloudPrepared(null); }}>{t('Cancel', 'Batal')}</button></div></div>}
      {cloudPrepared && <div className="local-settings-preview" role="region" aria-label={t('Confirm cloud estimate', 'Konfirmasi estimasi cloud')}><h3>{t('Review cloud estimate', 'Tinjau estimasi cloud')}</h3><p>{t('Execution', 'Eksekusi')}: {cloudPrepared.executionId}</p>{cloudPrepared.quote ? <>
        <p>{computeCapacityLabel(cloudPrepared.quote.profile, intlLocale)} · {cloudPrepared.quote.cloudMode === 'pilot' ? t('Pilot grant', 'Grant pilot') : t('Paid compute', 'Komputasi berbayar')}</p>
        <p>{t('Estimated charge', 'Perkiraan biaya')}: {(cloudPrepared.quote.estimatedMicros / 1_000_000).toLocaleString(intlLocale, { maximumFractionDigits: 6 })} Quanta{cloudPrepared.quote.estimatedSeconds !== undefined ? ` · ${cloudPrepared.quote.estimatedSeconds.toLocaleString(intlLocale)} ${t('estimated seconds', 'perkiraan detik')}` : ''}</p>
        {cloudPrepared.quote.cloudMode !== 'pilot' && <p>{t('Rate', 'Tarif')}: {(cloudPrepared.quote.profile.hourlyMicros / 1_000_000).toLocaleString(intlLocale, { maximumFractionDigits: 6 })} Quanta / {t('hour', 'jam')}</p>}
        {cloudPrepared.quote.cloudMode === 'pilot' && cloudPrepared.quote.profile.timeoutSeconds !== undefined && <p>{t('Grant maximum per job', 'Maksimum grant per job')}: {cloudPrepared.quote.profile.timeoutSeconds.toLocaleString(intlLocale)} {t('seconds', 'detik')}</p>}
        <p>{t('Estimate expires', 'Estimasi kedaluwarsa')}: {new Date(cloudPrepared.quote.expiresAtEpoch * 1000).toLocaleString(intlLocale)}</p>
        {cloudPrepared.quote.expiresAtEpoch * 1000 <= quoteNow && <p role="alert">{t('This estimate expired. Get a new estimate before running.', 'Estimasi ini kedaluwarsa. Minta estimasi baru sebelum menjalankan.')}</p>}
      </> : <p>{t('This execution uses the server’s existing compute path. No priced estimate was returned.', 'Eksekusi ini memakai jalur komputasi server yang tersedia. Estimasi biaya tidak diberikan.')}</p>}<p>{t('Saved input SHA-256', 'SHA-256 input tersimpan')}: {cloudPrepared.inputSha256}</p><div className="local-settings-actions"><button className="lab-button lab-button-primary" disabled={busy || !!cloudPrepared.quote && cloudPrepared.quote.expiresAtEpoch * 1000 <= quoteNow} onClick={() => void cloudAction('submit', cloudPrepared.executionId)}>{cloudPrepared.quote ? t('Run with this estimate', 'Jalankan dengan estimasi ini') : t('Run reviewed inputs', 'Jalankan input yang ditinjau')}</button><button className="lab-button" disabled={busy} onClick={() => void cloudAction('prepare', cloudPrepared.executionId)}>{t('Get new estimate', 'Minta estimasi baru')}</button><button className="lab-button" disabled={busy} onClick={() => setCloudPrepared(null)}>{t('Close', 'Tutup')}</button></div></div>}
      {connection.authenticated && <>
        <SettingsRow title={t('Cloud execution history', 'Riwayat eksekusi cloud')} description={t('Saved for the signed-in cloud account. Refresh a job to read its latest server status.', 'Tersimpan untuk akun cloud yang sedang login. Perbarui job untuk membaca status server terkini.')}><button className="lab-button" disabled={busy} onClick={() => void refreshSettings()}>{t('Refresh history', 'Perbarui riwayat')}</button></SettingsRow>
        {cloudHistoryError && <p className="local-settings-error" role="alert">{cloudHistoryError}</p>}
        {!cloudHistoryError && cloudExecutions.length === 0 && <p className="settings-group-content">{t('No cloud executions are saved for this account on this computer.', 'Belum ada eksekusi cloud tersimpan untuk akun ini di komputer ini.')}</p>}
        {cloudExecutions.map(execution => {
          const final = ['COMPLETED', 'FAILED', 'CANCELLED', 'CANCELED'].includes(execution.status.toUpperCase()), prepared = execution.status === 'PREPARED', review = execution.status === 'REVIEW';
          return <SettingsRow key={execution.id} title={projects.find(project => project.id === execution.projectId)?.name ?? execution.projectId} description={<>{execution.status} · {execution.id}{execution.imported ? ` · ${t('Results saved locally', 'Hasil disimpan lokal')}` : ''}{review ? ` · ${t('Inputs have not been uploaded. Review the calculation above before uploading.', 'Input belum diunggah. Tinjau kalkulasi di atas sebelum mengunggah.')}` : ''}</>}><div className="local-settings-actions"><button className="lab-button" disabled={busy} onClick={() => void cloudAction('status', execution.id)}>{t('Refresh status', 'Perbarui status')}</button>{prepared && <button className="lab-button" disabled={busy} onClick={() => void cloudAction('prepare', execution.id)}>{t('Get new estimate', 'Minta estimasi baru')}</button>}<button className="lab-button" disabled={busy || final || prepared || review || execution.status === 'CANCEL_REQUESTED'} onClick={() => void cloudAction('cancel', execution.id)}>{t('Cancel job', 'Batalkan job')}</button><button className="lab-button" disabled={busy || !final || execution.imported} onClick={() => void cloudAction('download', execution.id)}>{t('Save results locally', 'Simpan hasil lokal')}</button></div></SettingsRow>;
        })}
      </>}
    </SettingsSection>}
  </>;
}
