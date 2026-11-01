'use client';
import { useCallback, useEffect, useState } from 'react';
import { phyniteCalculations, phyniteMdSimulations } from '@/lib/phynite-api';
import { createMdCloudStorageClient, createSameOriginMdCloudTransport } from '@/lib/md-cloud-api';
import { WorkflowTrajectoryEditor } from './WorkflowTrajectoryEditor';
import type { WorkflowAttempt } from '@/lib/project-workflow';
import { useLocale } from '@/app/locale-provider';
import { WorkspaceLoading } from './WorkspaceLoading';
/** Real retained output only. An absent metric remains absent. */
export function WorkflowNodeResult({ attempt, owner, projectId }: { attempt?: WorkflowAttempt; owner?: string; projectId?: string }) {
  const { t } = useLocale();
  type DisplayResult = { summary?: Record<string, unknown>; artifacts?: Array<{ path: string; downloadUrl?: string; label?: string }> };
  const [loaded, setLoaded] = useState<{ jobId: string; result?: DisplayResult; trajectoryId?: string; error?: string } | null>(null), [preview, setPreview] = useState(false);
  const current = loaded?.jobId === attempt?.jobId ? loaded : null, result = current?.result, error = current?.error;
  const loading = Boolean(attempt?.jobId && ['CALCULATION', 'MD_SIMULATION', 'MD_ANALYSIS'].includes(attempt.jobKind ?? '') && !current);
  const previewError = useCallback((message: string) => setLoaded(value => value ? { ...value, error: message } : value), []);
  useEffect(() => {
    if (!attempt?.jobId) return;
    let live = true;
    void (async () => {
      if (attempt.jobKind === 'CALCULATION') {
        const value = await phyniteCalculations.get(attempt.jobId!);
        if (live) setLoaded({ jobId: attempt.jobId!, result: value.result as DisplayResult | undefined });
      } else if (attempt.jobKind === 'MD_SIMULATION') {
        const value = await phyniteMdSimulations.get(attempt.jobId!);
        if (live) setLoaded({ jobId: attempt.jobId!, result: value.result as DisplayResult | undefined, trajectoryId: value.simulation.resultTrajectoryId });
      } else if (attempt.jobKind === 'MD_ANALYSIS') {
        const value = await createMdCloudStorageClient({ transport: createSameOriginMdCloudTransport() }).getAnalysis(attempt.jobId!);
        if (live) setLoaded({ jobId: attempt.jobId!, result: value.analysis.resultSummary ? { summary: value.analysis.resultSummary } : undefined });
      }
    })().catch(failure => { if (live) setLoaded({ jobId: attempt.jobId!, error: failure.message }); });
    return () => { live = false; };
  }, [attempt?.jobId, attempt?.jobKind, attempt?.status]);
  if (!attempt) return null;
  const labels: Record<string, string> = { frameCount: t('Frames', 'Frame'), atomFrames: t('Particle frames', 'Frame partikel'), totalEnergyRy: t('Total energy (Ry)', 'Energi total (Ry)'), fermiEnergyEv: t('Fermi energy (eV)', 'Energi Fermi (eV)'), bandGapEv: t('Gap on sampled path (eV)', 'Gap pada lintasan sampel (eV)'), dosAtFermiStatesPerEv: 'DOS(EF) (states/eV)', scfIterations: t('SCF iterations', 'Iterasi SCF'), scfResidualRy: 'SCF residual (Ry)', totalForceRyBohr: t('Total force (Ry/bohr)', 'Gaya total (Ry/bohr)'), pressureKbar: t('Pressure (kbar)', 'Tekanan (kbar)'), peakPowerFactorMwPerMK2: 'Peak power factor (mW m⁻¹ K⁻²)', peakPowerFactorTemperatureK: t('Temperature at peak (K)', 'Suhu pada puncak (K)') };
  const metrics = Object.entries(result?.summary ?? {}).filter(([key, value]) => key in labels && typeof value === 'number');
  return <details className="workflow-result" open={['completed', 'reused', 'failed'].includes(attempt.status)}><summary>{t('Execution result', 'Hasil eksekusi')} · {attempt.outdated ? t('Outdated', 'Sudah berubah') : attempt.status}</summary>{attempt.error && <p role="alert">{attempt.error}</p>}{error && <p role="alert">{error}</p>}<dl>{metrics.map(([key, value]) => <div key={key}><dt>{labels[key]}</dt><dd>{String(value)}</dd></div>)}</dl><ul>{result?.artifacts?.map(artifact => <li key={artifact.path}>{artifact.downloadUrl ? <a href={artifact.downloadUrl} download>{artifact.label || artifact.path}</a> : <span>{artifact.label || artifact.path}</span>}</li>)}</ul>{owner && projectId && current?.trajectoryId && <><button onClick={() => setPreview(value => !value)}>{preview ? t('Hide trajectory', 'Sembunyikan trajectory') : t('Inspect trajectory', 'Periksa trajectory')}</button>{preview && <WorkflowTrajectoryEditor readOnly owner={owner} projectId={projectId} node={{ id: `result_${attempt.jobId}`, kind: 'trajectory', name: 'Simulation result', position: { x: 0, y: 0 }, configuration: {}, resources: [{ kind: 'trajectory', id: current.trajectoryId }] }} onChange={() => {}} onError={previewError} />}</>}{loading ? <WorkspaceLoading layout="inline" label={t('Loading result…', 'Memuat hasil…')} /> : !result && !error && <p>{t('Output will appear after the worker has finalized this attempt.', 'Output muncul setelah worker menyelesaikan percobaan ini.')}</p>}</details>;
}
