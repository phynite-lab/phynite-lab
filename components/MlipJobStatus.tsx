'use client';
import { useEffect, useState } from 'react';
import { useLocale } from '@/app/locale-provider';
import type { MlipResult } from '@/lib/mlip-contract';

type Job = { id: string; revision: number; status: string; reason?: string; result?: MlipResult; resultSha256?: string };
export function MlipJobStatus({ conversationId, jobId }: { conversationId: string; jobId: string }) {
  const { t } = useLocale();
  const [job, setJob] = useState<Job>(), [error, setError] = useState('');
  const path = `/api/ai/conversations/${encodeURIComponent(conversationId)}/mlip/${encodeURIComponent(jobId)}`;
  useEffect(() => { let live = true; const read = async () => { try { const response = await fetch(path, { cache: 'no-store' }); const value = await response.json() as Job & { error?: string }; if (!response.ok) throw new Error(value.error ?? 'MLIP read failed.'); if (live) { setJob(value); setError(''); } } catch (failure) { if (live) setError((failure as Error).message); } }; void read(); const timer = setInterval(() => void read(), 3000); return () => { live = false; clearInterval(timer); }; }, [path]);
  const cancel = async () => { if (!job) return; try { const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: job.revision }) }); if (!response.ok) throw new Error('Refresh the MLIP status and retry cancellation.'); } catch (failure) { setError((failure as Error).message); } };
  return <div className="ai-action-result"><strong>MACE-MP-0b3 medium · CPU / float64</strong><p role="status">{job?.status ?? t('Reading status…', 'Membaca status…')}</p>{job?.reason && <p>{job.reason}</p>}{job?.result && <><p>{job.result.energyPerAtomEv} eV/atom · {job.result.converged ? t('Force criterion satisfied', 'Kriteria gaya terpenuhi') : t('Force criterion unmet; review before screening', 'Kriteria gaya belum terpenuhi; tinjau sebelum screening')}</p><details><summary>{t('Exact result and provenance', 'Hasil lengkap dan provenance')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 280, overflow: 'auto' }}>{JSON.stringify({ result: job.result, sha256: job.resultSha256 }, null, 2)}</pre></details></>}{job && ['queued', 'running'].includes(job.status) && <button className="ai-button ai-button-secondary" onClick={() => void cancel()}>{t('Cancel MLIP job', 'Batalkan job MLIP')}</button>}{error && <p role="alert">{error}</p>}</div>;
}
