'use client';

import { AlertCircle, CirclePause, RefreshCw, WifiOff } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import type { AiFailure } from '@/lib/ai-contract';
import { aiFailureReason, type AiTurnSummary } from '@/lib/ai-turn-status';

function FailureDetails({ failure }: { failure: AiFailure }) {
  const { t } = useLocale();
  return <details className="ai-failure-details"><summary>{t('Details', 'Detail')}</summary><dl><div><dt>{t('Code', 'Kode')}</dt><dd><code>{failure.code}</code></dd></div>{failure.requestId && <div><dt>{t('Tracking ID', 'ID pelacakan')}</dt><dd><code>{failure.requestId}</code></dd></div>}<div><dt>{t('Cause', 'Penyebab')}</dt><dd>{failure.message}</dd></div></dl>{failure.issues?.map((issue, index) => <p key={index}>{[issue.nodeId, issue.path].filter(Boolean).join(' · ')}{issue.nodeId || issue.path ? ': ' : ''}{issue.message}</p>)}</details>;
}

function FailureReason({ failure }: { failure?: AiFailure }) {
  const { locale } = useLocale();
  return <>{aiFailureReason(failure, locale)}</>;
}

export function AiTurnStatus({ runId, summary, compact = false, latest = false, retry, busy, appliedCount = 0, onReview }: { runId: string; summary?: AiTurnSummary; compact?: boolean; latest?: boolean; retry?: () => void; busy: boolean; appliedCount?: number; onReview?: () => void }) {
  const { t } = useLocale();
  if (!summary || !['failed', 'stopped'].includes(summary.status)) return null;
  const failed = summary.status === 'failed';
  return <section className="ai-turn-status" data-run-id={runId} data-status={summary.status} data-compact={compact} role={failed && latest ? 'alert' : 'status'} aria-live={latest ? undefined : 'off'} aria-label={failed ? t('Response incomplete', 'Respons belum selesai') : t('Response stopped', 'Respons dihentikan')}>
    <div className="ai-status-heading">{failed ? <AlertCircle size={16} aria-hidden="true" /> : <CirclePause size={16} aria-hidden="true" />}<strong>{failed ? t('Response incomplete', 'Respons belum selesai') : t('Response stopped', 'Respons dihentikan')}</strong></div>
    <p>{failed ? <FailureReason failure={summary.failure} /> : t('You stopped this response. Send a message when you are ready to continue.', 'Anda menghentikan respons ini. Kirim pesan saat siap melanjutkan.')}</p>
    {appliedCount > 0 && <p>{t(`${appliedCount} completed ${appliedCount === 1 ? 'action remains' : 'actions remain'} applied. Retrying starts a new turn.`, `${appliedCount} aksi yang selesai tetap berlaku. Mengulang memulai giliran baru.`)}{onReview && <button type="button" className="ai-status-link" onClick={onReview}>{t('Review actions', 'Tinjau aksi')}</button>}</p>}
    {failed && retry && <div className="ai-status-actions"><button type="button" disabled={busy} onClick={retry}><RefreshCw size={14} aria-hidden="true" />{busy ? t('Retrying…', 'Mengulang…') : t('Retry turn', 'Ulangi giliran')}</button></div>}
    {failed && summary.failure && <FailureDetails failure={summary.failure} />}
  </section>;
}

export function AiOperationNotice({ failure, title, connection = false, action, onAction, busy = false }: { failure: AiFailure; title: string; connection?: boolean; action?: string; onAction?: () => void; busy?: boolean }) {
  return <section className="ai-operation-notice" data-connection={connection} role={connection ? 'status' : 'alert'}><div className="ai-status-heading">{connection ? <WifiOff size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}<strong>{title}</strong></div><p>{failure.message}</p>{action && onAction && <div className="ai-status-actions"><button type="button" disabled={busy} onClick={onAction}><RefreshCw size={14} aria-hidden="true" />{action}</button></div>}<FailureDetails failure={failure} /></section>;
}
