'use client';
import { useCallback, useEffect, useState } from 'react';
import { phyniteCalculations, phyniteMdSimulations } from '@/lib/phynite-api';
import { createMdCloudStorageClient, createSameOriginMdCloudTransport } from '@/lib/md-cloud-api';
import { WorkflowTrajectoryEditor } from './WorkflowTrajectoryEditor';
import type { WorkflowAttempt } from '@/lib/project-workflow';
import { useLocale } from '@/app/locale-provider';
import Link from 'next/link';
import { useSession } from '@/app/use-session';
import { localRequest } from '@/lib/local-api';
export type NodeResultArtifact = {
  path: string;
  downloadUrl?: string;
  label?: string;
  role?: string;
  contentType?: string;
};

/** Real retained output only. An absent metric remains absent. */
export function WorkflowNodeResult({
  attempt,
  owner,
  projectId,
  onArtifactsLoaded,
}: {
  attempt?: WorkflowAttempt;
  owner?: string;
  projectId?: string;
  onArtifactsLoaded?: (artifacts: NodeResultArtifact[]) => void;
}) {
  const { t } = useLocale();
  const { session } = useSession();
  type DisplayResult = {
    summary?: Record<string, unknown>;
    error?: string;
    artifacts?: NodeResultArtifact[];
  };
  const [loaded, setLoaded] = useState<{ jobId: string; result?: DisplayResult; trajectoryId?: string; error?: string; logTail?: string } | null>(null), [preview, setPreview] = useState(false);
  const [recovery, setRecovery] = useState<{ jobId: string; available: boolean } | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<{ jobId: string; message: string } | null>(null);
  const current = loaded?.jobId === attempt?.jobId ? loaded : null, error = current?.error;
  const previewError = useCallback((message: string) => setLoaded(value => value ? { ...value, error: message } : value), []);
  useEffect(() => {
    if (!attempt?.jobId) return;
    let live = true;
    void (async () => {
      if (attempt.jobKind === 'CALCULATION') {
        const value = await phyniteCalculations.get(attempt.jobId!);
        if (live) {
          setLoaded({ jobId: attempt.jobId!, result: value.result as DisplayResult | undefined, error: value.calculation.failureReason || value.result?.error, logTail: value.calculation.logTail });
          if (value.result?.artifacts) {
            onArtifactsLoaded?.(value.result.artifacts as NodeResultArtifact[]);
          }
        }
      } else if (attempt.jobKind === 'MD_SIMULATION') {
        const value = await phyniteMdSimulations.get(attempt.jobId!);
        if (live) {
          setLoaded({ jobId: attempt.jobId!, result: value.result as DisplayResult | undefined, trajectoryId: value.simulation.resultTrajectoryId, error: value.simulation.failureReason, logTail: value.simulation.logTail });
          if (value.result?.artifacts) {
            onArtifactsLoaded?.(value.result.artifacts as NodeResultArtifact[]);
          }
        }
      } else if (attempt.jobKind === 'MD_ANALYSIS') {
        const value = await createMdCloudStorageClient({ transport: createSameOriginMdCloudTransport() }).getAnalysis(attempt.jobId!);
        if (live) {
          setLoaded({ jobId: attempt.jobId!, result: value.result ?? (value.analysis.resultSummary ? { summary: value.analysis.resultSummary } : undefined), error: value.analysis.failureReason || value.result?.error || value.diagnosticsError, logTail: value.analysis.logTail });
          if (value.result?.artifacts) {
            onArtifactsLoaded?.(value.result.artifacts as NodeResultArtifact[]);
          }
        }
      }
    })().catch(failure => { if (live) setLoaded({ jobId: attempt.jobId!, error: failure.message }); });
    return () => { live = false; };
  }, [attempt?.jobId, attempt?.jobKind, attempt?.status, onArtifactsLoaded]);
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
  const failed = attempt.status === 'failed';

  if (failed) {
    return (
      <div className="workflow-result-failed p-3 my-2 rounded-[8px] border border-[color-mix(in_srgb,var(--status-danger,#dc6b72)_40%,transparent)] bg-[color-mix(in_srgb,var(--status-danger,#dc6b72)_8%,var(--surface))] text-[12px] space-y-2">
        {attempt.error && <p className="workflow-result-error m-0" role="alert">{attempt.error}</p>}
        {error && error !== attempt.error && <p className="workflow-result-error m-0" role="alert">{error}</p>}
        {current?.logTail && (
          <details className="workflow-execution-log" open>
            <summary className="cursor-pointer text-[11px] font-semibold text-[var(--muted-ink)] hover:text-[var(--ink)]">
              {t('Execution log', 'Log eksekusi')}
            </summary>
            <pre className="mt-1 max-h-[220px] overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-[var(--ink)]">
              {current.logTail}
            </pre>
          </details>
        )}
        {recovery && recovery.jobId === attempt.jobId && recovery.available && (
          <div className="workflow-result-recovery mt-2">
            <p className="m-0 text-[11px] leading-normal">
              {t('The solver has saved output. Verify and import it without running the calculation again.', 'Solver menyimpan output. Verifikasi dan impor tanpa menjalankan kalkulasi lagi.')}
            </p>
            <button type="button" className="lab-button mt-1.5" disabled={recovering} onClick={() => void recover()}>
              {recovering ? t('Verifying saved output…', 'Memverifikasi output tersimpan…') : t('Recover saved result', 'Pulihkan hasil tersimpan')}
            </button>
          </div>
        )}
        {recoveryError && recoveryError.jobId === attempt.jobId && (
          <p className="workflow-result-error m-0" role="alert">{recoveryError.message}</p>
        )}
        {!attempt.jobId && (
          <p className="workflow-result-error m-0">
            {t('The solver did not start. Fix the issue above, then start a new run.', 'Solver belum dimulai. Perbaiki masalah di atas, lalu mulai run baru.')}
          </p>
        )}
        {session?.mode === 'local' && (
          <div>
            <Link href="/account/compute#your-computer" className="text-[11px] text-[var(--accent)] underline underline-offset-2">
              {t('Open compute setup', 'Buka setup compute')} →
            </Link>
          </div>
        )}
      </div>
    );
  }

  if (owner && projectId && current?.trajectoryId) {
    return (
      <div className="workflow-result-trajectory my-2">
        <button className="workflow-result-secondary" onClick={() => setPreview(value => !value)}>
          {preview ? t('Hide trajectory', 'Sembunyikan trajectory') : t('Inspect trajectory', 'Periksa trajectory')}
        </button>
        {preview && (
          <WorkflowTrajectoryEditor
            readOnly
            owner={owner}
            projectId={projectId}
            node={{ id: `result_${attempt.jobId}`, kind: 'trajectory', name: 'Simulation result', position: { x: 0, y: 0 }, configuration: {}, resources: [{ kind: 'trajectory', id: current.trajectoryId }] }}
            onChange={() => {}}
            onError={previewError}
          />
        )}
      </div>
    );
  }

  return null;
}
