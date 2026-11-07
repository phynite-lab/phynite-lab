'use client';
import { useCallback, useEffect, useState } from 'react';
import { phyniteCalculations, phyniteMdSimulations } from '@/lib/phynite-api';
import { createMdCloudStorageClient, createSameOriginMdCloudTransport } from '@/lib/md-cloud-api';
import { WorkflowTrajectoryEditor } from './WorkflowTrajectoryEditor';
import type { WorkflowAttempt } from '@/lib/project-workflow';
import { useLocale } from '@/app/locale-provider';
import { WorkspaceLoading } from './WorkspaceLoading';
import Link from 'next/link';
import { useSession } from '@/app/use-session';
import { localRequest } from '@/lib/local-api';
/** Real retained output only. An absent metric remains absent. */
export function WorkflowNodeResult({ attempt, owner, projectId }: { attempt?: WorkflowAttempt; owner?: string; projectId?: string }) {
  const { t } = useLocale();
  const { session } = useSession();
  type DisplayResult = { summary?: Record<string, unknown>; error?: string; artifacts?: Array<{ path: string; downloadUrl?: string; label?: string }> };
  const [loaded, setLoaded] = useState<{ jobId: string; result?: DisplayResult; trajectoryId?: string; error?: string; logTail?: string } | null>(null), [preview, setPreview] = useState(false);
  const [recovery, setRecovery] = useState<{ jobId: string; available: boolean } | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<{ jobId: string; message: string } | null>(null);
  const current = loaded?.jobId === attempt?.jobId ? loaded : null, result = current?.result, error = current?.error;
  const loading = Boolean(attempt?.jobId && ['CALCULATION', 'MD_SIMULATION', 'MD_ANALYSIS'].includes(attempt.jobKind ?? '') && !current);
  const previewError = useCallback((message: string) => setLoaded(value => value ? { ...value, error: message } : value), []);
  useEffect(() => {
    if (!attempt?.jobId) return;
    let live = true;
    void (async () => {
      if (attempt.jobKind === 'CALCULATION') {
        const value = await phyniteCalculations.get(attempt.jobId!);
        if (live) setLoaded({ jobId: attempt.jobId!, result: value.result as DisplayResult | undefined, error: value.calculation.failureReason || value.result?.error, logTail: value.calculation.logTail });
      } else if (attempt.jobKind === 'MD_SIMULATION') {
        const value = await phyniteMdSimulations.get(attempt.jobId!);
        if (live) setLoaded({ jobId: attempt.jobId!, result: value.result as DisplayResult | undefined, trajectoryId: value.simulation.resultTrajectoryId, error: value.simulation.failureReason, logTail: value.simulation.logTail });
      } else if (attempt.jobKind === 'MD_ANALYSIS') {
        const value = await createMdCloudStorageClient({ transport: createSameOriginMdCloudTransport() }).getAnalysis(attempt.jobId!);
        if (live) setLoaded({ jobId: attempt.jobId!, result: value.result ?? (value.analysis.resultSummary ? { summary: value.analysis.resultSummary } : undefined), error: value.analysis.failureReason || value.result?.error || value.diagnosticsError, logTail: value.analysis.logTail });
      }
    })().catch(failure => { if (live) setLoaded({ jobId: attempt.jobId!, error: failure.message }); });
    return () => { live = false; };
  }, [attempt?.jobId, attempt?.jobKind, attempt?.status]);
  useEffect(() => {
    if (session?.mode !== 'local' || attempt?.status !== 'failed' || !attempt.jobId) return;
    const jobId = attempt.jobId;
    let live = true;
    void localRequest<{ available: boolean }>(`jobs/${jobId}/recovery`).then(value => {
      if (live) setRecovery({ jobId, available: value.available });
    }).catch(() => { if (live) setRecovery({ jobId, available: false }); });
    return () => { live = false; };
  }, [session?.mode, attempt?.jobId, attempt?.status]);
  const recover = async () => {
    if (!attempt?.jobId || recovering) return;
    setRecovering(true); setRecoveryError(null);
    try {
      await localRequest(`jobs/${attempt.jobId}/recover`, 'POST');
      setRecovery({ jobId: attempt.jobId, available: false });
      window.dispatchEvent(new Event('phynite:workflow-result-change'));
    } catch (failure) { setRecoveryError({ jobId: attempt.jobId, message: (failure as Error).message }); }
    finally { setRecovering(false); }
  };
  if (!attempt) return null;
  const labels: Record<string, string> = { frameCount: t('Frames', 'Frame'), atomFrames: t('Particle frames', 'Frame partikel'), totalEnergyRy: t('Total energy (Ry)', 'Energi total (Ry)'), fermiEnergyEv: t('Fermi energy (eV)', 'Energi Fermi (eV)'), bandGapEv: t('Gap on sampled path (eV)', 'Gap pada lintasan sampel (eV)'), dosAtFermiStatesPerEv: 'DOS(EF) (states/eV)', scfIterations: t('SCF iterations', 'Iterasi SCF'), scfResidualRy: 'SCF residual (Ry)', totalForceRyBohr: t('Total force (Ry/bohr)', 'Gaya total (Ry/bohr)'), pressureKbar: t('Pressure (kbar)', 'Tekanan (kbar)'), peakPowerFactorMwPerMK2: 'Peak power factor (mW m⁻¹ K⁻²)', peakPowerFactorTemperatureK: t('Temperature at peak (K)', 'Suhu pada puncak (K)') };
  const metrics = Object.entries(result?.summary ?? {}).filter(([key, value]) => key in labels && typeof value === 'number');
  const failed = attempt.status === 'failed';
  return <details className={`workflow-result workflow-result--${attempt.status}`} open={['completed', 'reused', 'failed'].includes(attempt.status)}>
    <summary><span className="workflow-result-summary"><span className="workflow-result-status-dot" aria-hidden="true" />{t('Execution result', 'Hasil eksekusi')}</span><span className="workflow-result-state">{attempt.status}</span></summary>
    <div className="workflow-result-body">
      {attempt.error && <p className="workflow-result-error" role="alert">{attempt.error}</p>}
      {error && error !== attempt.error && <p className="workflow-result-error" role="alert">{error}</p>}
      {current?.logTail && <details className="workflow-execution-log" open={failed}><summary>{t('Execution log', 'Log eksekusi')}</summary><pre>{current.logTail}</pre></details>}
      {failed && recovery && recovery.jobId === attempt.jobId && recovery.available && <div className="workflow-result-recovery"><p>{t('The solver has saved output. Verify and import it without running the calculation again.', 'Solver menyimpan output. Verifikasi dan impor tanpa menjalankan kalkulasi lagi.')}</p><button type="button" className="lab-button" disabled={recovering} onClick={() => void recover()}>{recovering ? t('Verifying saved output…', 'Memverifikasi output tersimpan…') : t('Recover saved result', 'Pulihkan hasil tersimpan')}</button></div>}
      {recoveryError && recoveryError.jobId === attempt.jobId && <p className="workflow-result-error" role="alert">{recoveryError.message}</p>}
      {failed && !attempt.jobId && <p className="workflow-result-error">{t('The solver did not start. Fix the issue above, then start a new run.', 'Solver belum dimulai. Perbaiki masalah di atas, lalu mulai run baru.')}</p>}
      {failed && session?.mode === 'local' && <Link href="/account/compute#your-computer">{t('Open compute setup', 'Buka setup compute')} →</Link>}
      {!!metrics.length && <dl className="workflow-result-metrics">{metrics.map(([key, value]) => <div key={key}><dt>{labels[key]}</dt><dd>{String(value)}</dd></div>)}</dl>}
      {result?.artifacts?.length ? <ul className="workflow-result-artifacts">{result.artifacts.map(artifact => <li key={artifact.path}>{artifact.downloadUrl ? <a href={artifact.downloadUrl} download>{artifact.label || artifact.path}</a> : <span>{artifact.label || artifact.path}</span>}</li>)}</ul> : null}
      {owner && projectId && current?.trajectoryId && <><button className="workflow-result-secondary" onClick={() => setPreview(value => !value)}>{preview ? t('Hide trajectory', 'Sembunyikan trajectory') : t('Inspect trajectory', 'Periksa trajectory')}</button>{preview && <WorkflowTrajectoryEditor readOnly owner={owner} projectId={projectId} node={{ id: `result_${attempt.jobId}`, kind: 'trajectory', name: 'Simulation result', position: { x: 0, y: 0 }, configuration: {}, resources: [{ kind: 'trajectory', id: current.trajectoryId }] }} onChange={() => {}} onError={previewError} />}</>}
      {loading ? <WorkspaceLoading layout="inline" label={t('Loading result…', 'Memuat hasil…')} /> : !result && !error && !failed && <p>{t('Output will appear after the worker has finalized this attempt.', 'Output muncul setelah worker menyelesaikan percobaan ini.')}</p>}
    </div>
  </details>;
}
