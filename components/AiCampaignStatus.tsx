'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/app/locale-provider';
import type { AiCampaignStatus as CampaignStatus } from '@/lib/ai-campaign';

export function AiCampaignStatus({ conversationId, campaignId }: { conversationId: string; campaignId: string }) {
  const { t } = useLocale();
  const [detail, setDetail] = useState<CampaignStatus>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [inputs, setInputs] = useState<Record<number, unknown>>({});
  const path = `/api/ai/conversations/${encodeURIComponent(conversationId)}/campaigns/${encodeURIComponent(campaignId)}`;
  const request = useCallback(async <T,>(suffix = '', body?: object): Promise<T> => {
    const response = await fetch(path + suffix, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Refresh the campaign before continuing.');
    return data as T;
  }, [path]);
  const refresh = useCallback(() => request<CampaignStatus>().then(setDetail).catch(failure => setError((failure as Error).message)), [request]);
  useEffect(() => { let live = true; const read = () => void request<CampaignStatus>().then(value => { if (live) setDetail(value); }).catch(failure => { if (live) setError((failure as Error).message); }); read(); const timer = setInterval(read, 3000); return () => { live = false; clearInterval(timer); }; }, [request]);
  const cancel = async () => {
    if (!detail) return;
    setBusy(true); setError('');
    try { await request('', { revision: detail.campaign.revision }); await refresh(); }
    catch (failure) { setError((failure as Error).message); await refresh(); }
    finally { setBusy(false); }
  };
  return <section className="ai-action-disclosure ai-campaign-status" aria-label={t('Persistent campaign', 'Kampanye persisten')}>
    <strong>{t('Campaign on your computer', 'Kampanye di komputer Anda')}</strong>
    <p>{t('Continues while the local application and worker stay active. Closing the app pauses supervision. Stop AI stops only the conversation.', 'Berlanjut selama aplikasi lokal dan worker aktif. Menutup aplikasi menjeda pengawasan. Stop AI hanya menghentikan percakapan.')}</p>
    {detail && <><p role="status">{detail.campaign.status} · {detail.campaign.usedNodeHours.toPrecision(3)} / {detail.budget.totalNodeHours} {t('reserved node-hours', 'jam node dicadangkan')}</p>
      {detail.campaign.reason && <p>{detail.campaign.reason}</p>}
      <p>{detail.budget.queueSecondsPerAttempt} s {t('queue', 'antrean')} · {detail.budget.wallSecondsPerAttempt} s {t('runtime per attempt', 'eksekusi per attempt')} · {detail.repairs.length} {t('approved repair steps', 'langkah repair disetujui')}</p>
      {detail.campaign.attempts.map((attempt, index) => <details key={index}><summary>{t('Candidate', 'Kandidat')} {attempt.candidateIndex + 1} · {t('Attempt', 'Attempt')} {attempt.attempt + 1} · {attempt.outcome ?? attempt.phase}</summary><p>{attempt.reason}</p>{attempt.diagnosis && <p>{attempt.diagnosis}</p>}<code>{attempt.requestSha256}</code><button className="ai-text-button" onClick={() => void request(`?attempt=${index}`).then(value => setInputs(current => ({ ...current, [index]: value }))).catch(failure => setError((failure as Error).message))}>{t('Inspect retained input', 'Tinjau input tersimpan')}</button>{inputs[index] !== undefined && <pre>{JSON.stringify(inputs[index], null, 2)}</pre>}</details>)}
      {detail.campaign.status === 'executing' && <button className="ai-button ai-button-secondary" onClick={() => void cancel()} disabled={busy || detail.campaign.cancelRequested}>{detail.campaign.cancelRequested ? t('Cancellation requested', 'Pembatalan diminta') : t('Cancel campaign and current job', 'Batalkan kampanye dan job aktif')}</button>}</>}
    <button className="ai-text-button" onClick={() => void refresh()}>{t('Refresh status', 'Muat ulang status')}</button>{error && <p role="alert">{error}</p>}
  </section>;
}
