'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Server, Plus, Trash2, RefreshCw, CheckCircle2, XCircle, Pencil, Star, Sparkles } from 'lucide-react';
import { useLocale } from '../locale-provider';
import type { HpcAuthKind, HpcClusterProfile, HpcScheduler } from '@/lib/hpc-profile';
import { localRequest } from '@/lib/local-api';

type ProbeResult = {
  ok: boolean;
  latencyMs: number;
  system?: string;
  error?: string;
  schedulers: Record<string, boolean>;
  solvers: Record<string, string | null>;
  scratchWritable?: boolean;
  suggestedScratchRoot?: string;
  mpi?: {
    mpirun?: string | null;
    mpiexec?: string | null;
    srunPlugins?: string[];
    qeMpi?: string | null;
  };
  python?: {
    executable?: string | null;
    version?: string | null;
    versionOk?: boolean;
    packagesOk?: boolean;
    missingPackages?: string[];
    suggestedExecutable?: string | null;
    suggestedVersion?: string | null;
  };
  runtimeWarnings?: string[];
  suggestedMpiLauncher?: string[];
  suggestedPythonExecutable?: string;
};

export function HpcClustersSection({ localMode = false }: { localMode?: boolean }) {
  const { t } = useLocale();
  const [clusters, setClusters] = useState<HpcClusterProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingIdRef = useRef(editingId);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResult | null>>({});
  const [probing, setProbing] = useState<Record<string, boolean>>({});
  const [settingUpVenv, setSettingUpVenv] = useState<Record<string, boolean>>({});
  const [setupVenvStatus, setSetupVenvStatus] = useState<Record<string, { ok: boolean; message: string } | null>>({});

  // Form state
  const [name, setName] = useState('');
  const [scheduler, setScheduler] = useState<HpcScheduler>('slurm');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authKind, setAuthKind] = useState<HpcAuthKind>('key');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [scratchRoot, setScratchRoot] = useState('');
  const [partition, setPartition] = useState('');
  const [nodes, setNodes] = useState('1');
  const [ranksPerNode, setRanksPerNode] = useState('32');
  const [wallHours, setWallHours] = useState('4');
  const [modulesText, setModulesText] = useState('');
  const [mpiLauncherText, setMpiLauncherText] = useState('srun --mpi=pmix --ntasks={ranks}');
  const [launcherEdited, setLauncherEdited] = useState(false);
  const [pythonExecutable, setPythonExecutable] = useState('');
  const [saving, setSaving] = useState(false);
  const [detectingScratch, setDetectingScratch] = useState(false);
  const scratchRequest = useRef(0);
  const [detectMessage, setDetectMessage] = useState('');
  const [formError, setFormError] = useState('');

  const fetchClusters = useCallback(async () => {
    if (!localMode) { setLoading(false); return; }
    try {
      setLoading(true);
      setError('');
      const data = await localRequest<{ clusters?: unknown }>('hpc/clusters');
      setClusters(Array.isArray(data.clusters) ? data.clusters as HpcClusterProfile[] : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load clusters.', 'Gagal memuat kluster.'));
    } finally {
      setLoading(false);
    }
  }, [localMode, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchClusters(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchClusters]);

  const handleTestProbe = async (id: string) => {
    setProbing(prev => ({ ...prev, [id]: true }));
    try {
      const data = await localRequest<{ probe?: ProbeResult }>(`hpc/clusters/${id}/probe`, 'POST');
      if (data.probe) setProbeResults(prev => ({ ...prev, [id]: data.probe! }));
    } catch {
      setProbeResults(prev => ({
        ...prev,
        [id]: { ok: false, latencyMs: 0, error: 'Connection test failed', schedulers: {}, solvers: {} },
      }));
    } finally {
      setProbing(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleAutoSetupVenv = async (id: string) => {
    setSettingUpVenv(prev => ({ ...prev, [id]: true }));
    setSetupVenvStatus(prev => ({ ...prev, [id]: null }));
    try {
      const data = await localRequest<{
        ok: boolean;
        pythonExecutable?: string;
        probe?: ProbeResult;
        cluster?: HpcClusterProfile;
        error?: string;
        packages?: string[];
      }>(`hpc/clusters/${id}/setup-venv`, 'POST');
      if (data.ok && data.cluster) {
        if (data.probe) setProbeResults(prev => ({ ...prev, [id]: data.probe! }));
        setClusters(prev => prev.map(c => c.id === id ? data.cluster! : c));
        if (data.pythonExecutable && editingIdRef.current === id) {
          setPythonExecutable(data.pythonExecutable);
        }
        setSetupVenvStatus(prev => ({
          ...prev,
          [id]: {
            ok: true,
            message: t(`Python environment configured: ${data.pythonExecutable}`, `Environment Python siap: ${data.pythonExecutable}`),
          },
        }));
      } else {
        throw new Error(data.error || t('Venv setup failed.', 'Setup venv gagal.'));
      }
    } catch (err) {
      setSetupVenvStatus(prev => ({
        ...prev,
        [id]: {
          ok: false,
          message: err instanceof Error ? err.message : t('Venv setup failed.', 'Setup venv gagal.'),
        },
      }));
    } finally {
      setSettingUpVenv(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('Are you sure you want to remove this HPC cluster profile?', 'Yakin ingin menghapus profil kluster HPC ini?'))) return;
    try {
      await localRequest(`hpc/clusters/${id}`, 'DELETE');
      await fetchClusters();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete cluster.');
    }
  };

  const buildConnectionPayload = (existing?: HpcClusterProfile) => ({
    ...existing?.connection,
    host,
    port: Number(port) || 22,
    username,
    authKind,
    ...(authKind === 'key' ? { privateKeyPath: privateKeyPath.trim() || undefined } : {}),
  });

  const handleDetectScratch = async () => {
    const requestId = ++scratchRequest.current;
    const existing = editingId ? clusters.find(cluster => cluster.id === editingId) : undefined;
    setDetectingScratch(true);
    setFormError('');
    setDetectMessage('');
    try {
      const data = await localRequest<{ scratchRoot?: string }>('hpc/clusters/detect-scratch', 'POST', {
        connection: buildConnectionPayload(existing),
      });
      if (requestId !== scratchRequest.current) return;
      if (!data.scratchRoot) {
        throw new Error(t('Could not detect a writable scratch path.', 'Tidak dapat mendeteksi path scratch yang bisa ditulisi.'));
      }
      setScratchRoot(data.scratchRoot);
      setDetectMessage(t(`Detected writable path: ${data.scratchRoot}`, `Terdeteksi path writable: ${data.scratchRoot}`));
    } catch (err) {
      if (requestId === scratchRequest.current) {
        setFormError(err instanceof Error ? err.message : t('Failed to auto-detect remote scratch root.', 'Gagal mendeteksi direktori scratch remote secara otomatis.'));
      }
    } finally {
      if (requestId === scratchRequest.current) setDetectingScratch(false);
    }
  };

  const applySuggestedScratch = async (cluster: HpcClusterProfile, suggested: string) => {
    try {
      setError('');
      await localRequest(`hpc/clusters/${encodeURIComponent(cluster.id)}`, 'PUT', {
        ...cluster,
        storage: { ...cluster.storage, scratchRoot: suggested },
      });
      await fetchClusters();
      await handleTestProbe(cluster.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not update scratch root.', 'Gagal memperbarui direktori scratch.'));
    }
  };

  const applyRecommendedRuntime = async (cluster: HpcClusterProfile, probe: ProbeResult) => {
    try {
      setError('');
      const nextRuntime = {
        ...cluster.runtime,
        ...(probe.suggestedMpiLauncher?.length ? { mpiLauncher: probe.suggestedMpiLauncher } : {}),
        ...(probe.suggestedPythonExecutable ? { pythonExecutable: probe.suggestedPythonExecutable } : {}),
      };
      await localRequest(`hpc/clusters/${encodeURIComponent(cluster.id)}`, 'PUT', {
        ...cluster,
        runtime: nextRuntime,
      });
      await fetchClusters();
      await handleTestProbe(cluster.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not update runtime settings.', 'Gagal memperbarui pengaturan runtime.'));
    }
  };

  const handleSaveCluster = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    setDetectMessage('');

    const rawModules = modulesText.split('\n').map(module => module.trim()).filter(Boolean);
    const existing = editingId ? clusters.find(cluster => cluster.id === editingId) : undefined;
    const launcherArgs = mpiLauncherText.trim()
      ? mpiLauncherText.trim().split(/\s+/)
      : (scheduler === 'slurm' ? ['srun', '--mpi=pmix', '--ntasks={ranks}'] : ['mpiexec', '-n', '{ranks}']);

    const trimmedScratch = scratchRoot.trim();
    const payload = {
      name,
      scheduler,
      isDefault: editingId ? Boolean(clusters.find(cluster => cluster.id === editingId)?.isDefault) : clusters.length === 0,
      connection: buildConnectionPayload(existing),
      storage: {
        ...existing?.storage,
        scratchRoot: trimmedScratch,
        purgeWavefunctions: existing?.storage.purgeWavefunctions ?? true,
      },
      runtime: {
        environmentModules: rawModules,
        mpiLauncher: !launcherEdited && existing ? existing.runtime.mpiLauncher : launcherArgs,
        ...(pythonExecutable.trim() ? { pythonExecutable: pythonExecutable.trim() } : {}),
      },
      defaults: {
        ...existing?.defaults,
        nodes: Number(nodes) || 1,
        ranksPerNode: Number(ranksPerNode) || 32,
        wallSeconds: (Number(wallHours) || 4) * 3600,
        memoryMiBPerNode: existing?.defaults.memoryMiBPerNode ?? 65536,
        queue: partition.trim() || undefined,
      },
    };

    try {
      await localRequest(editingId ? `hpc/clusters/${encodeURIComponent(editingId)}` : 'hpc/clusters', editingId ? 'PUT' : 'POST', payload);
      setShowModal(false);
      resetForm();
      await fetchClusters();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save cluster.');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    scratchRequest.current += 1;
    setDetectingScratch(false);
    setEditingId(null);
    setScheduler('slurm');
    setName('');
    setHost('');
    setPort('22');
    setUsername('');
    setAuthKind('key');
    setPrivateKeyPath('');
    setScratchRoot('');
    setPartition('');
    setNodes('1');
    setRanksPerNode('32');
    setWallHours('4');
    setModulesText('');
    setMpiLauncherText('srun --mpi=pmix --ntasks={ranks}');
    setLauncherEdited(false);
    setPythonExecutable('');
    setDetectMessage('');
    setFormError('');
  };

  const editCluster = (cluster: HpcClusterProfile) => {
    setEditingId(cluster.id);
    setName(cluster.name);
    setScheduler(cluster.scheduler);
    setHost(cluster.connection.host);
    setPort(String(cluster.connection.port));
    setUsername(cluster.connection.username);
    setAuthKind(cluster.connection.authKind);
    setPrivateKeyPath(cluster.connection.privateKeyPath ?? '');
    setScratchRoot(cluster.storage.scratchRoot);
    setPartition(cluster.defaults.queue ?? '');
    setNodes(String(cluster.defaults.nodes));
    setRanksPerNode(String(cluster.defaults.ranksPerNode));
    setWallHours(String(cluster.defaults.wallSeconds / 3600));
    setModulesText((cluster.runtime?.environmentModules ?? []).join('\n'));
    setMpiLauncherText((cluster.runtime?.mpiLauncher ?? []).join(' '));
    setLauncherEdited(false);
    setPythonExecutable(cluster.runtime?.pythonExecutable ?? '');
    setDetectMessage('');
    setFormError('');
    setShowModal(true);
  };

  const setDefaultCluster = async (cluster: HpcClusterProfile) => {
    try {
      await localRequest(`hpc/clusters/${encodeURIComponent(cluster.id)}`, 'PUT', { ...cluster, isDefault: true });
      await fetchClusters();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not set the default cluster.', 'Default kluster belum dapat diubah.'));
    }
  };

  return (
    <div className="hpc-clusters-section">
      <div className="hpc-section-header">
        <div>
          <h4>{t('Connected Clusters', 'Kluster Terhubung')}</h4>
          <p className="lab-caption">
            {localMode
              ? t('Submit Quantum ESPRESSO jobs to your institution’s Slurm or OpenPBS cluster through this local workspace.', 'Kirim job Quantum ESPRESSO ke kluster Slurm atau OpenPBS institusi melalui workspace lokal ini.')
              : t('HPC profiles and SSH probes run only in the local Phynite workspace.', 'Profil HPC dan probe SSH hanya berjalan di workspace Phynite lokal.')}
          </p>
        </div>
        {localMode && <button
          type="button"
          className="lab-button lab-button-primary"
          onClick={() => { resetForm(); setShowModal(true); }}
        >
          <Plus size={15} />
          {t('Add Cluster', 'Tambah Kluster')}
        </button>}
      </div>

      {loading && <p className="lab-caption">{t('Loading clusters…', 'Memuat daftar kluster…')}</p>}
      {error && <p className="settings-notice" role="alert">{error}</p>}

      {!localMode && <div className="hpc-empty-state"><Server size={32} /><p>{t('Open the local Phynite application to add and probe SSH cluster profiles. Hosted Phynite never stores private-key paths.', 'Buka aplikasi Phynite lokal untuk menambah dan menguji profil kluster SSH. Phynite hosted tidak pernah menyimpan path kunci privat.')}</p></div>}
      {localMode && !loading && clusters.length === 0 && (
        <div className="hpc-empty-state">
          <Server size={32} />
          <p>{t('No HPC clusters configured yet. Add your institution’s Slurm or PBS cluster to get started.', 'Belum ada kluster HPC. Tambahkan kluster Slurm atau PBS institusi Anda untuk memulai.')}</p>
        </div>
      )}

      <div className="hpc-cluster-list">
        {clusters.map((c) => {
          const probe = probeResults[c.id];
          const isProbing = probing[c.id];
          return (
            <div key={c.id} className="hpc-cluster-card">
              <div className="hpc-cluster-card-header">
                <div>
                  <strong>{c.name}</strong>
                  <span className="hpc-tag">{c.scheduler.toUpperCase()}</span>
                  {c.isDefault && <span className="hpc-tag hpc-tag-default">{t('Default', 'Default')}</span>}
                </div>
                <div className="hpc-cluster-actions">
                  <button
                    type="button"
                    className="lab-button"
                    onClick={() => editCluster(c)}
                    aria-label={t('Edit cluster', 'Edit kluster')}
                  >
                    <Pencil size={13} />
                  </button>
                  {!c.isDefault && <button
                    type="button"
                    className="lab-button"
                    onClick={() => void setDefaultCluster(c)}
                    aria-label={t('Set default cluster', 'Jadikan kluster default')}
                  >
                    <Star size={13} />
                  </button>}
                  <button
                    type="button"
                    className="lab-button"
                    disabled={isProbing}
                    onClick={() => void handleTestProbe(c.id)}
                  >
                    <RefreshCw size={13} className={isProbing ? 'animate-spin' : ''} />
                    {isProbing ? t('Testing…', 'Menguji…') : t('Test Probe', 'Uji Probe')}
                  </button>
                  <button
                    type="button"
                    className="lab-button"
                    disabled={settingUpVenv[c.id]}
                    onClick={() => void handleAutoSetupVenv(c.id)}
                    title={t('Set up isolated Python virtualenv with ase, pymatgen, seekpath, spglib on cluster', 'Siapkan venv Python terisolasi dengan ase, pymatgen, seekpath, spglib di cluster')}
                  >
                    <Sparkles size={13} className={settingUpVenv[c.id] ? 'animate-spin' : ''} />
                    {settingUpVenv[c.id] ? t('Setting up venv…', 'Menyiapkan venv…') : t('Auto Setup Venv', 'Auto Setup Venv')}
                  </button>
                  <button
                    type="button"
                    className="lab-button lab-button-danger"
                    onClick={() => void handleDelete(c.id)}
                    aria-label={t('Delete cluster', 'Hapus kluster')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div className="hpc-cluster-details">
                <div><span>{t('Host', 'Host')}:</span> <code>{c.connection.username}@{c.connection.host}:{c.connection.port}</code></div>
                <div><span>{t('Scratch', 'Scratch')}:</span> <code>{c.storage.scratchRoot}</code></div>
                <div><span>{t('Allocation', 'Alokasi')}:</span> {c.defaults.nodes} node(s) · {c.defaults.ranksPerNode} ranks/node · {Math.round(c.defaults.wallSeconds / 3600)}h max</div>
                {c.defaults.queue && <div><span>{t('Partition', 'Partisi')}:</span> <code>{c.defaults.queue}</code></div>}
                {c.runtime.environmentModules.length > 0 && <div><span>{t('Environment Modules', 'Environment Modules')}:</span> <code>{c.runtime.environmentModules.join(' · ')}</code></div>}
                {c.runtime.mpiLauncher.length > 0 && <div><span>{t('MPI Launcher', 'MPI Launcher')}:</span> <code>{c.runtime.mpiLauncher.join(' ')}</code></div>}
                {c.runtime.pythonExecutable && <div><span>{t('Python', 'Python')}:</span> <code>{c.runtime.pythonExecutable}</code></div>}
                {c.profileSha256 && <div><span>{t('Profile checksum', 'Checksum profil')}:</span> <code className="hpc-checksum">{c.profileSha256}</code></div>}
              </div>

              {probe && (
                <>
                  <div className={`hpc-probe-result ${probe.ok ? 'hpc-probe-ok' : 'hpc-probe-fail'}`}>
                    {probe.ok ? (
                      <>
                        <CheckCircle2 size={15} />
                        <span>{t('Connected', 'Terhubung')} ({probe.latencyMs}ms) · {probe.system}</span>
                        {probe.solvers?.qe && <small>· pw.x: {probe.solvers.qe}</small>}
                        {probe.python?.version && <small>· python: {probe.python.version}</small>}
                      </>
                    ) : (
                      <>
                        <XCircle size={15} />
                        <span>{t('Probe failed', 'Uji koneksi gagal')}: {probe.error}</span>
                      </>
                    )}
                  </div>
                  {probe.ok && probe.runtimeWarnings && probe.runtimeWarnings.length > 0 && (
                    <div className="hpc-probe-result hpc-probe-fail" role="alert" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                      <span>{probe.runtimeWarnings.join(' ')}</span>
                      {(probe.suggestedMpiLauncher?.length || probe.suggestedPythonExecutable) && (
                        <button type="button" className="lab-button" onClick={() => void applyRecommendedRuntime(c, probe)}>
                          {t('Apply recommended runtime', 'Terapkan pengaturan runtime')}
                        </button>
                      )}
                    </div>
                  )}
                  {probe.ok && probe.scratchWritable === false && (
                    <div className="hpc-probe-result hpc-probe-fail" role="alert" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                      <span>
                        {t(
                          `Scratch root '${c.storage.scratchRoot}' is not writable on this cluster.`,
                          `Direktori scratch '${c.storage.scratchRoot}' tidak bisa ditulisi di kluster ini.`,
                        )}
                        {probe.suggestedScratchRoot ? ` ${t('Detected:', 'Terdeteksi:')} ${probe.suggestedScratchRoot}` : ''}
                      </span>
                      {probe.suggestedScratchRoot && (
                        <button
                          type="button"
                          className="lab-button"
                          onClick={() => void applySuggestedScratch(c, probe.suggestedScratchRoot!)}
                        >
                          {t('Use detected path', 'Gunakan path terdeteksi')}
                        </button>
                      )}
                    </div>
                  )}
                  {setupVenvStatus[c.id] && (
                    <div className={`hpc-probe-result ${setupVenvStatus[c.id]!.ok ? 'hpc-probe-ok' : 'hpc-probe-fail'}`} role={setupVenvStatus[c.id]!.ok ? 'status' : 'alert'}>
                      {setupVenvStatus[c.id]!.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                      <span>{setupVenvStatus[c.id]!.message}</span>
                    </div>
                  )}
                </>
              )}
              {!probe && setupVenvStatus[c.id] && (
                <div className={`hpc-probe-result ${setupVenvStatus[c.id]!.ok ? 'hpc-probe-ok' : 'hpc-probe-fail'}`} role={setupVenvStatus[c.id]!.ok ? 'status' : 'alert'} style={{ marginTop: '8px' }}>
                  {setupVenvStatus[c.id]!.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  <span>{setupVenvStatus[c.id]!.message}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showModal && (
        <div className="lab-modal-overlay">
          <div className="lab-modal-content">
            <header className="lab-modal-header">
              <h3>{editingId ? t('Edit HPC Cluster Profile', 'Edit Profil Kluster HPC') : t('Add HPC Cluster Profile', 'Tambah Profil Kluster HPC')}</h3>
              <button type="button" className="lab-button lab-button-quiet" onClick={() => { resetForm(); setShowModal(false); }}>✕</button>
            </header>
            <form onSubmit={handleSaveCluster} className="hpc-modal-form">
              {formError && <p className="settings-notice" role="alert">{formError}</p>}
              <div className="lab-field-grid">
                <label>
                  <span>{t('Profile Name', 'Nama Profil')}</span>
                  <input type="text" required placeholder="misal: BRIN Mahameru - DFT" value={name} onChange={e => setName(e.target.value)} />
                </label>
                <label>
                  <span>{t('Scheduler Type', 'Tipe Scheduler')}</span>
                  <select value={scheduler} onChange={e => {
                      const next = e.target.value as HpcScheduler;
                      setScheduler(next);
                      if (!launcherEdited) {
                        setMpiLauncherText(next === 'slurm' ? 'srun --mpi=pmix --ntasks={ranks}' : 'mpiexec -n {ranks}');
                        setLauncherEdited(true);
                      }
                    }}>
                    <option value="slurm">Slurm Workload Manager</option>
                    <option value="pbs">OpenPBS / PBS Pro</option>
                  </select>
                </label>
              </div>

              <div className="lab-field-grid">
                <label>
                  <span>{t('Login Host', 'Host Login Node')}</span>
                  <input type="text" required disabled={detectingScratch || saving} placeholder="login2.hpc.brin.go.id" value={host} onChange={e => setHost(e.target.value)} />
                </label>
                <label>
                  <span>{t('Port', 'Port')}</span>
                  <input type="number" required disabled={detectingScratch || saving} value={port} onChange={e => setPort(e.target.value)} />
                </label>
              </div>

              <div className="lab-field-grid">
                <label>
                  <span>{t('SSH Username', 'Username SSH')}</span>
                  <input type="text" required disabled={detectingScratch || saving} placeholder="user" value={username} onChange={e => setUsername(e.target.value)} />
                </label>
                <label>
                  <span>{t('Authentication', 'Autentikasi')}</span>
                  <select disabled={detectingScratch || saving} value={authKind} onChange={e => setAuthKind(e.target.value as HpcAuthKind)}>
                    <option value="key">Private key</option>
                    <option value="agent">SSH agent</option>
                  </select>
                </label>
                <label>
                  <span>{t('Private Key Path (Local)', 'Path Kunci Privat (Lokal)')}</span>
                  <input type="text" disabled={authKind !== 'key' || detectingScratch || saving} placeholder="/Users/name/.ssh/id_ed25519" value={privateKeyPath} onChange={e => setPrivateKeyPath(e.target.value)} />
                </label>
              </div>

              <div className="lab-field-grid">
                <label style={{ gridColumn: '1 / -1' }}>
                  <span>{t('Remote Scratch Root (optional)', 'Direktori Scratch Remote (opsional)')}</span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      disabled={detectingScratch || saving}
                      style={{ flex: 1 }}
                      placeholder={t('Leave blank to auto-detect via SSH', 'Kosongkan untuk deteksi otomatis via SSH')}
                      value={scratchRoot}
                      onChange={e => { setScratchRoot(e.target.value); setDetectMessage(''); }}
                    />
                    <button
                      type="button"
                      className="lab-button"
                      disabled={detectingScratch || saving || !host.trim() || !username.trim() || (authKind === 'key' && !privateKeyPath.trim())}
                      onClick={() => void handleDetectScratch()}
                    >
                      {detectingScratch ? t('Detecting…', 'Mendeteksi…') : t('Auto-detect', 'Deteksi otomatis')}
                    </button>
                  </div>
                  <small style={{ color: 'var(--muted, #666)', fontSize: '11px', marginTop: '2px' }}>
                    {detectMessage || t(
                      'Leave blank to detect $SCRATCH or $HOME/phynite-work automatically over SSH when saving.',
                      'Kosongkan agar otomatis mendeteksi $SCRATCH atau $HOME/phynite-work lewat SSH saat disimpan.',
                    )}
                  </small>
                </label>
                <label style={{ gridColumn: '1 / -1' }}>
                  <span>{t('Default Partition/Queue', 'Partisi / Antrean Default')}</span>
                  <input type="text" placeholder="misal: cpu, normal" value={partition} onChange={e => setPartition(e.target.value)} />
                </label>
              </div>

              <div className="lab-field-grid">
                <label>
                  <span>{t('Default Nodes', 'Jumlah Node Default')}</span>
                  <input type="number" min="1" max="4096" value={nodes} onChange={e => setNodes(e.target.value)} />
                </label>
                <label>
                  <span>{t('Ranks per Node', 'Ranks per Node')}</span>
                  <input type="number" min="1" max="1024" value={ranksPerNode} onChange={e => setRanksPerNode(e.target.value)} />
                </label>
                <label>
                  <span>{t('Max Walltime (Hours)', 'Max Walltime (Jam)')}</span>
                  <input type="number" min="1" max="720" value={wallHours} onChange={e => setWallHours(e.target.value)} />
                </label>
              </div>

              <div className="lab-field-grid">
                <label style={{ gridColumn: '1 / -1' }}>
                  <span>{t('Environment Modules (one per line)', 'Environment Modules (satu per baris)')}</span>
                  <textarea
                    rows={4}
                    placeholder={'intel/2024.0\nimpi/2021.11.0\nmkl\nmaterials/qe/7.2-impi'}
                    value={modulesText}
                    onChange={event => setModulesText(event.target.value)}
                    aria-label={t('Environment Modules (one per line)', 'Environment Modules (satu per baris)')}
                  />
                  <small style={{ color: 'var(--muted, #666)', fontSize: '11px', marginTop: '2px' }}>
                    {t('Loaded before Quantum ESPRESSO. Enter module names only, one per line.', 'Di-load sebelum Quantum ESPRESSO. Masukkan nama modul saja, satu per baris.')}
                  </small>
                </label>
              </div>

              <div className="lab-field-grid">
                <label style={{ gridColumn: '1 / -1' }}>
                  <span>{t('MPI Launcher Command', 'Perintah MPI Launcher')}</span>
                  <input
                    type="text"
                    placeholder="srun --mpi=pmix --ntasks={ranks}"
                    value={mpiLauncherText}
                    onChange={event => { setLauncherEdited(true); setMpiLauncherText(event.target.value); }}
                    aria-label={t('MPI Launcher Command', 'Perintah MPI Launcher')}
                  />
                  <small style={{ color: 'var(--muted, #666)', fontSize: '11px', marginTop: '2px' }}>
                    {t('Use {ranks} for total MPI ranks. Use mpirun -np {ranks} on Slurm clusters without PMIx.', 'Gunakan {ranks} untuk jumlah total MPI rank. Gunakan mpirun -np {ranks} pada kluster Slurm tanpa PMIx.')}
                  </small>
                </label>
                <label style={{ gridColumn: '1 / -1' }}>
                  <span>{t('Python Executable (optional)', 'Python Executable (opsional)')}</span>
                  <input
                    type="text"
                    placeholder="/path/to/conda/envs/science/bin/python3"
                    value={pythonExecutable}
                    onChange={event => setPythonExecutable(event.target.value)}
                    aria-label={t('Python Executable (optional)', 'Python Executable (opsional)')}
                  />
                  <small style={{ color: 'var(--muted, #666)', fontSize: '11px', marginTop: '2px' }}>
                    {t('Requires Python 3.10+ with numpy, scipy, matplotlib, seekpath, and spglib. Leave empty to auto-detect from modules or Conda.', 'Memerlukan Python 3.10+ dengan numpy, scipy, matplotlib, seekpath, dan spglib. Kosongkan untuk deteksi otomatis dari modul atau Conda.')}
                  </small>
                  {editingId && (
                    <div style={{ marginTop: '8px' }}>
                      <button
                        type="button"
                        className="lab-button"
                        disabled={settingUpVenv[editingId]}
                        onClick={() => void handleAutoSetupVenv(editingId)}
                      >
                        <Sparkles size={13} className={settingUpVenv[editingId] ? 'animate-spin' : ''} />
                        {settingUpVenv[editingId]
                          ? t('Configuring venv on cluster…', 'Menyiapkan venv di kluster…')
                          : t('1-Click Auto Setup Venv (ase, pymatgen, seekpath)', '1-Click Auto Setup Venv (ase, pymatgen, seekpath)')}
                      </button>
                      {setupVenvStatus[editingId] && (
                        <p
                          style={{
                            fontSize: '12px',
                            color: setupVenvStatus[editingId]!.ok ? 'var(--accent, #10b981)' : 'var(--danger, #ef4444)',
                            marginTop: '4px',
                          }}
                          role={setupVenvStatus[editingId]!.ok ? 'status' : 'alert'}
                        >
                          {setupVenvStatus[editingId]!.message}
                        </p>
                      )}
                    </div>
                  )}
                </label>
              </div>

              <div className="lab-modal-footer">
                <button type="button" className="lab-button" onClick={() => { resetForm(); setShowModal(false); }}>{t('Cancel', 'Batal')}</button>
                <button type="submit" className="lab-button lab-button-primary" disabled={saving || detectingScratch || Boolean(editingId && settingUpVenv[editingId])}>
                  {saving
                    ? (!scratchRoot.trim()
                        ? t('Detecting scratch & saving…', 'Mendeteksi scratch & menyimpan…')
                        : t('Saving…', 'Menyimpan…'))
                    : editingId
                      ? t('Update Cluster Profile', 'Perbarui Profil Kluster')
                      : t('Save Cluster Profile', 'Simpan Profil Kluster')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
