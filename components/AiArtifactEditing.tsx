'use client';

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/app/locale-provider';
import { AiResponseContent } from './AiResponseContent';
import { aiArtifactEditableText } from '@/lib/ai-artifacts';
import type { AiArtifact, AiArtifactEdit, AiArtifactInput, AiArtifactPatch } from '@/lib/ai-workbench';

const TextEditor = lazy(() => import('./AiArtifactTextEditor'));
export type AiArtifactEditApi = {
  save: (edit: AiArtifactEdit) => Promise<AiArtifact>;
  patches: (artifactId: string) => Promise<AiArtifactPatch[]>;
  decide: (proposal: AiArtifactPatch, hunkId: string, decision: 'accepted' | 'rejected', requestId: string) => Promise<{ proposal: AiArtifactPatch; artifact: AiArtifact | null }>;
};

export function AiArtifactEditing({ artifact, latest, api, onSaved, onDirty, onPreview }: { artifact: AiArtifact; latest: boolean; api: AiArtifactEditApi; onSaved: (artifact: AiArtifact) => void; onDirty: (dirty: boolean) => void; onPreview: () => void }) {
  const { t } = useLocale();
  const source = aiArtifactEditableText(artifact) ?? '';
  const [draft, setDraft] = useState(source), [preview, setPreview] = useState(false), [epoch, setEpoch] = useState(0), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const dirty = draft !== source;
  const saving = useRef(false), pending = useRef<{ text: string; id: string } | null>(null);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  const save = async () => {
    if (saving.current || !dirty || !latest || !artifact.sha256) return;
    saving.current = true; setBusy(true); setNotice('');
    if (pending.current?.text !== draft) pending.current = { text: draft, id: 'edit_' + crypto.randomUUID().replaceAll('-', '') };
    try { const saved = await api.save({ artifactId: artifact.id, baseSha256: artifact.sha256, text: draft, requestId: pending.current.id }); onDirty(false); onSaved(saved); }
    catch (error) { setNotice(error instanceof Error ? error.message : t('Save failed. Your draft is retained.', 'Gagal menyimpan. Draf Anda tetap tersimpan.')); }
    finally { saving.current = false; setBusy(false); }
  };
  const format = artifact.kind === 'report' || artifact.kind === 'plan' ? 'markdown' : (artifact.structuredData as AiArtifactInput)?.format ?? 'text';
  return <section className="ai-artifact-editing" aria-label={t('Edit artifact', 'Edit artefak')}>
    <div className="ai-artifact-edit-actions"><strong role="status">{dirty ? t('Unsaved changes', 'Perubahan belum disimpan') : t('Saved version', 'Versi tersimpan')}</strong><button type="button" disabled={busy || !dirty || !latest} onClick={() => void save()}>{busy ? t('Saving…', 'Menyimpan…') : t('Save new version', 'Simpan versi baru')}</button><button type="button" aria-pressed={preview} onClick={() => setPreview(value => !value)}>{preview ? t('Source', 'Sumber') : t('Preview', 'Pratinjau')}</button><button type="button" disabled={busy || !dirty} onClick={() => { setDraft(source); setEpoch(n => n + 1); onDirty(false); setNotice(''); }}>{t('Discard edits', 'Buang perubahan')}</button><button type="button" disabled={dirty || busy} onClick={onPreview}>{t('Finish editing', 'Selesai mengedit')}</button></div>
    {!latest && <p role="status">{t('A newer version exists. Copy or export your draft before opening it; this source cannot overwrite the latest version.', 'Ada versi lebih baru. Salin atau ekspor draf sebelum membukanya; sumber ini tidak dapat menimpa versi terbaru.')}</p>}
    {preview && (format === 'markdown' ? <AiResponseContent text={draft} /> : <pre className="ai-artifact-code">{draft}</pre>)}
    <div hidden={preview}><Suspense fallback={<p role="status">{t('Loading editor…', 'Memuat editor…')}</p>}><TextEditor key={epoch} initialValue={draft} format={format} disabled={busy} onChange={setDraft} onSave={() => void save()} /></Suspense></div>
    <button type="button" onClick={() => { const url = URL.createObjectURL(new Blob([draft], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = (artifact.structuredData as AiArtifactInput)?.filename ?? 'artifact-draft.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>{t('Export draft', 'Ekspor draf')}</button>
    {notice && <p role="alert">{notice}</p>}
  </section>;
}

export function AiArtifactPatchReview({ artifact, api, disabled, onSaved }: { artifact: AiArtifact; api: AiArtifactEditApi; disabled?: boolean; onSaved: (artifact: AiArtifact) => void }) {
  const { t } = useLocale();
  const [proposals, setProposals] = useState<AiArtifactPatch[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const alive = useRef(true), deciding = useRef(false), receipts = useRef(new Map<string, string>());
  const refresh = useCallback(async () => { try { const rows = await api.patches(artifact.id); if (alive.current && !deciding.current) setProposals(rows); } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'Proposals unavailable.'); } }, [api, artifact.id]);
  useEffect(() => { alive.current = true; queueMicrotask(() => { if (alive.current) void refresh(); }); const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000); return () => { alive.current = false; clearInterval(timer); }; }, [refresh]);
  const decide = async (proposal: AiArtifactPatch, hunkId: string, decision: 'accepted' | 'rejected') => {
    if (deciding.current) return;
    deciding.current = true; setBusy(true); setError('');
    const key = `${proposal.id}:${proposal.revision}:${hunkId}:${decision}`;
    const requestId = receipts.current.get(key) ?? 'review_' + crypto.randomUUID().replaceAll('-', ''); receipts.current.set(key, requestId);
    try { const result = await api.decide(proposal, hunkId, decision, requestId); setProposals(rows => rows.map(row => row.id === result.proposal.id ? result.proposal : row)); if (result.artifact) onSaved(result.artifact); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t('Review failed.', 'Tinjauan gagal.')); }
    finally { deciding.current = false; setBusy(false); void refresh(); }
  };
  return <section className="ai-artifact-patches" aria-label={t('AI change proposals', 'Proposal perubahan AI')}><h3>{t('AI change proposals', 'Proposal perubahan AI')}</h3>{!proposals.length && <p>{t('No proposals for this artifact.', 'Belum ada proposal untuk artefak ini.')}</p>}{proposals.map(proposal => <section key={proposal.id}><p>{t('Source', 'Sumber')} {proposal.baseArtifactId} · {proposal.status} · {proposal.author.modelId}</p>{proposal.hunks.map(hunk => <article key={hunk.id}><strong>{hunk.reason}</strong><div><small>{t('Original text', 'Teks sumber')}</small><pre data-change="removed">{hunk.before}</pre></div><div><small>{t('Proposed text', 'Teks usulan')}</small><pre data-change="added">{hunk.after}</pre></div><div className="ai-artifact-hunk-actions"><span>{hunk.decision}</span><button type="button" disabled={disabled || busy || proposal.status !== 'open' || hunk.decision !== 'pending'} onClick={() => void decide(proposal, hunk.id, 'accepted')}>{t('Accept hunk', 'Terima hunk')}</button><button type="button" disabled={disabled || busy || proposal.status !== 'open' || hunk.decision !== 'pending'} onClick={() => void decide(proposal, hunk.id, 'rejected')}>{t('Reject hunk', 'Tolak hunk')}</button></div></article>)}</section>)}{error && <p role="alert">{error}<button type="button" onClick={() => void refresh()}>{t('Refresh proposals', 'Muat ulang proposal')}</button></p>}</section>;
}
