'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, NotebookPen, Plus, Save, Columns2 } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { UiSelect } from './UiSelect';
import AiArtifactTextEditor from './AiArtifactTextEditor';
import { AiResponseContent } from './AiResponseContent';
import { NoteDraftSaver, NoteRecovery, type NoteDraftStatus } from '@/lib/note-recovery';
import { noteContentIssue, noteSelection, notesRequest, type NoteDetail, type NoteDraft, type NoteProposal, type NoteRevision, type ProjectNote } from '@/lib/project-notes';
import type { AiContextItem } from '@/lib/ai-workbench';
import '@/app/ai.css';
import './project-notes.css';

const canRecoverOffline = (error: unknown) => error instanceof TypeError || error instanceof Error && 'status' in error && Number(error.status) >= 500;

async function claimEditor(key: string): Promise<{ id: string; release: () => void }> {
  let id = crypto.randomUUID();
  try { id = sessionStorage.getItem(key) || id; } catch { /* The mounted editor still has an identity. */ }
  if (!navigator.locks) return { id: crypto.randomUUID(), release: () => {} };
  return new Promise((resolve, reject) => {
    const attempt = (candidate: string) => {
      void navigator.locks.request(`phynite-note:${candidate}`, { ifAvailable: true }, async lock => {
        if (!lock) { attempt(crypto.randomUUID()); return; }
        try { sessionStorage.setItem(key, candidate); } catch { /* Recovery remains under this editor identity. */ }
        await new Promise<void>(release => resolve({ id: candidate, release }));
      }).catch(reject);
    };
    attempt(id);
  });
}

type Props = { owner: string; projectId: string; visible: boolean; onAttach: (item: AiContextItem) => void; onSide: () => void };
export function ProjectNotesWorkspace({ owner, projectId, visible, onAttach, onSide }: Props) {
  const { t } = useLocale();
  const [opened, setOpened] = useState(visible), [notes, setNotes] = useState<ProjectNote[]>([]), [selected, setSelected] = useState(''), [visited, setVisited] = useState<string[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const createId = useRef<string | null>(null);
  if (visible && !opened) setOpened(true);
  useEffect(() => {
    if (!opened) return;
    let live = true;
    const load = async () => {
      let listed: ProjectNote[];
      try { listed = (await notesRequest<{ notes: ProjectNote[] }>(projectId)).notes; }
      catch (failure) {
        if (!canRecoverOffline(failure)) throw failure;
        const recovered = await new NoteRecovery(indexedDB).list(owner, projectId);
        listed = [...new Map(recovered.filter(d => d.checkpoint).map(d => [d.noteId, d.checkpoint!.note])).values()];
        if (!listed.length) throw failure;
        if (live) setError('Core is unavailable. Browser drafts are available below; keep or export your changes.');
      }
      if (live) { setNotes(listed); if (listed[0]) { setSelected(listed[0].id); setVisited([listed[0].id]); } }
    };
    void load().catch(failure => { if (live) setError(failure.message); });
    return () => { live = false; };
  }, [owner, projectId, opened]);
  const create = async () => {
    setBusy(true); setError(''); createId.current ??= crypto.randomUUID();
    try {
      const data = await notesRequest<NoteDetail>(projectId, '', { requestId: createId.current, name: t('Untitled note', 'Catatan baru'), text: '' });
      createId.current = null; setNotes(current => [...current.filter(n => n.id !== data.note.id), data.note]); setVisited(current => [...new Set([...current, data.note.id])]); setSelected(data.note.id);
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  };
  return <div className="project-notes"><header className="notes-toolbar"><h2><NotebookPen size={18} />{t('Notes', 'Catatan')}</h2><UiSelect compact ariaLabel={t('Project note', 'Catatan proyek')} value={selected} options={notes.map(note => ({ value: note.id, label: note.name }))} onChange={id => { setSelected(id); setVisited(current => [...new Set([...current, id])]); }} /><button type="button" disabled={busy} onClick={() => void create()}><Plus size={16} />{t('New note', 'Catatan baru')}</button><button type="button" onClick={onSide}><Columns2 size={16} />{t('Take notes beside', 'Catat di samping')}</button></header>
    {error && <p className="note-error" role="alert">{error}</p>}
    {!notes.length && !error && <p className="note-empty">{t('Keep project decisions, formulas and sources in a note. Create a note to start.', 'Simpan keputusan, rumus, dan sumber proyek dalam catatan. Buat catatan untuk memulai.')}</p>}
    {visited.map(id => <section className="note-editor-host" hidden={id !== selected} key={id}><ProjectNoteEditor owner={owner} projectId={projectId} noteId={id} onAttach={onAttach} onNote={note => setNotes(current => current.some(n => n.id === note.id) ? current.map(n => n.id === note.id ? note : n) : [...current, note])} /></section>)}
  </div>;
}

function ProjectNoteEditor({ owner, projectId, noteId, onAttach, onNote }: { owner: string; projectId: string; noteId: string; onAttach: Props['onAttach']; onNote: (note: ProjectNote) => void }) {
  const { t } = useLocale();
  const [detail, setDetail] = useState<NoteDetail>(), [draft, setDraft] = useState<NoteDraft>(), [proposals, setProposals] = useState<NoteProposal[]>([]), [history, setHistory] = useState<NoteRevision[]>([]), [compare, setCompare] = useState<NoteRevision>();
  const [status, setStatus] = useState<NoteDraftStatus>({ browserSequence: 0, coreSequence: 0 }), [error, setError] = useState(''), [busy, setBusy] = useState(false), [preview, setPreview] = useState(false), [epoch, setEpoch] = useState(0), [online, setOnline] = useState(true);
  const saver = useRef<NoteDraftSaver | null>(null), current = useRef<NoteDraft | undefined>(undefined), pendingSave = useRef<{ signature: string; id: string } | null>(null), selection = useRef({ start: 0, end: 0 });
  const callbacks = useRef({ onAttach, onNote });
  useEffect(() => { callbacks.current = { onAttach, onNote }; }, [onAttach, onNote]);
  const update = (text: string, name = current.current?.name ?? '') => {
    if (!current.current) return;
    const next = { ...current.current, text, name, sequence: current.current.sequence + 1, updatedAt: Date.now() };
    current.current = next; setDraft(next); saver.current?.update(next);
  };
  useEffect(() => {
    let live = true, release = () => {};
    const load = async () => {
      const editor = await claimEditor(`phynite:note-editor:${owner}:${projectId}:${noteId}`);
      release = editor.release; if (!live) { release(); return; }
      const key = `${owner}:${projectId}:${noteId}:${editor.id}`;
      let recovery: NoteRecovery | undefined;
      try { recovery = new NoteRecovery(indexedDB); } catch { setError(t('Browser recovery is unavailable. Keep this editor open and export a copy.', 'Recovery browser belum tersedia. Biarkan editor terbuka dan ekspor salinan.')); }
      const [savedResult, draftsResult, browserResult] = await Promise.allSettled([notesRequest<NoteDetail>(projectId, noteId), notesRequest<{ drafts: Array<NoteDraft & { id: string }> }>(projectId, `${noteId}/drafts`), recovery?.get(key)]);
      if (!live) return;
      const browser = browserResult.status === 'fulfilled' ? browserResult.value : undefined;
      if (browserResult.status === 'rejected') setError(browserResult.reason.message);
      const saved = savedResult.status === 'fulfilled' ? savedResult.value : canRecoverOffline(savedResult.reason) ? browser?.checkpoint : undefined;
      if (!saved) throw savedResult.status === 'rejected' ? savedResult.reason : new Error('Open this note online once to enable browser recovery.');
      if (savedResult.status === 'rejected') { setOnline(false); setError('Core is unavailable. Your recovered browser draft can be edited and exported.'); }
      const core = draftsResult.status === 'fulfilled' ? draftsResult.value.drafts.find(d => d.editorId === editor.id) : undefined;
      const recovered = browser && (!core || browser.sequence >= core.sequence) ? browser : core;
      const next: NoteDraft = { key, owner, projectId, noteId, editorId: editor.id, sequence: recovered?.sequence ?? 1, baseRevision: recovered?.baseRevision ?? saved.note.head, text: recovered?.text ?? saved.revision.text, name: recovered?.name ?? saved.note.name, updatedAt: Date.now(), checkpoint: saved };
      current.current = next; setDraft(next); setDetail(saved);
      saver.current = new NoteDraftSaver(async value => { if (!recovery) throw new Error('Browser recovery is unavailable. Export a copy of your draft.'); await recovery.put(value); }, async value => {
        const issue = noteContentIssue(value.text); if (issue) throw new Error(issue);
        const result = await notesRequest<{ conflict: boolean }>(projectId, `${noteId}/drafts`, value, 'PUT');
        if (result.conflict) throw new Error('This note changed in another editor. Compare or save a copy; this draft is retained.');
      }, value => { if (live) setStatus(value); });
      saver.current.update(next);
      if (recovered && recovered.baseRevision !== saved.note.head) setError(t('Recovered draft has an older base. Compare or save a copy before replacing it.', 'Draft yang dipulihkan memakai revisi lama. Bandingkan atau simpan salinan sebelum menggantinya.'));
      void notesRequest<{ proposals: NoteProposal[] }>(projectId, `${noteId}/proposals`).then(data => { if (live) setProposals(data.proposals); }).catch(failure => { if (live) setError(failure.message); });
    };
    void load().catch(failure => { if (live) setError(failure.message); });
    const connectivity = () => setOnline(navigator.onLine);
    connectivity(); window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity);
    return () => { live = false; saver.current?.dispose(); saver.current = null; release(); window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity); };
  }, [owner, projectId, noteId, t]);
  const dirty = Boolean(draft && detail && (draft.text !== detail.revision.text || draft.name !== detail.note.name || draft.baseRevision !== detail.note.head));
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty && current.current && status.browserSequence < current.current.sequence && status.coreSequence < current.current.sequence) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, status]);
  const install = (saved: NoteDetail, reset: boolean) => {
    const previous = current.current; if (!previous) return;
    const next = { ...previous, text: saved.revision.text, name: saved.note.name, baseRevision: saved.note.head, sequence: previous.sequence + 1, checkpoint: saved };
    setDetail(saved); callbacks.current.onNote(saved.note); current.current = next; setDraft(next); saver.current?.update(next); if (reset) setEpoch(value => value + 1);
  };
  const save = async (): Promise<NoteDetail | undefined> => {
    const value = current.current; if (!value) return;
    const issue = noteContentIssue(value.text); if (issue) { setError(issue); return; }
    const signature = JSON.stringify([value.baseRevision, value.text, value.name]);
    if (pendingSave.current?.signature !== signature) pendingSave.current = { signature, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      await saver.current?.flush('browser');
      const saved = await notesRequest<NoteDetail>(projectId, `${noteId}/save`, { baseRevision: value.baseRevision, text: value.text, name: value.name, requestId: pendingSave.current.id });
      pendingSave.current = null;
      if (current.current?.sequence === value.sequence) install(saved, false);
      else if (current.current) { setDetail(saved); callbacks.current.onNote(saved.note); current.current = { ...current.current, baseRevision: saved.note.head, checkpoint: saved, sequence: current.current.sequence + 1 }; setDraft(current.current); saver.current?.update(current.current); }
      return saved;
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  };
  const saveCopy = async () => {
    const value = current.current; if (!value) return;
    setBusy(true); setError('');
    try { const copy = await notesRequest<NoteDetail>(projectId, '', { requestId: crypto.randomUUID(), name: value.name.slice(0, 190) + ' copy', text: value.text }); callbacks.current.onNote(copy.note); setError(t(`Copy saved: ${copy.note.name}. Open it from Notes after refreshing the note list. Your draft is retained.`, `Salinan tersimpan: ${copy.note.name}. Buka dari Catatan setelah memuat ulang daftar. Draft Anda tetap disimpan.`)); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  };
  const attach = async () => {
    const value = current.current; if (!value) return;
    const range = selection.current;
    const saved = dirty ? await save() : detail;
    if (!saved || current.current?.text !== value.text) return;
    try {
      const context = await notesRequest<{ context: AiContextItem }>(projectId, `${noteId}/attach`, { baseRevision: saved.note.head, ...(range.end > range.start ? { selection: noteSelection(value.text, range.start, range.end) } : {}) });
      callbacks.current.onAttach(context.context);
    } catch (failure) { setError((failure as Error).message); }
  };
  const decide = async (proposal: NoteProposal, hunk: NoteProposal['hunks'][number], decision: 'accepted' | 'rejected') => {
    if (decision === 'accepted' && dirty) { setError(t('Save or compare your draft before accepting changes.', 'Simpan atau bandingkan draft sebelum menerima perubahan.')); return; }
    setBusy(true); setError('');
    try {
      await saver.current?.flush('core');
      const result = await notesRequest<NoteDetail & { proposal: NoteProposal }>(projectId, `${noteId}/decision`, { proposalId: proposal.id, hunkId: hunk.id, editorId: current.current?.editorId, decision });
      setProposals(current => current.map(p => p.id === result.proposal.id ? result.proposal : p));
      if (decision === 'accepted') install(result, true);
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  };
  const exportNote = () => {
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([draft.text], { type: 'text/markdown;charset=utf-8' })), anchor = document.createElement('a'); anchor.href = url; anchor.download = draft.name.replace(/[^\p{L}\p{N} _-]/gu, '_') + '.md'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const draftStatus = !online ? t('Offline · draft retained', 'Offline · draft dipertahankan') : status.browserError || status.coreError ? t('Draft save failed', 'Penyimpanan draft gagal') : draft && status.coreSequence >= draft.sequence ? t('Draft saved in app', 'Draft tersimpan di aplikasi') : draft && status.browserSequence >= draft.sequence ? t('Browser draft saved', 'Draft browser tersimpan') : t('Saving draft…', 'Menyimpan draft…');
  if (!detail || !draft) return <div className="note-empty">{error || t('Opening note…', 'Membuka catatan…')}</div>;
  return <article className="project-note"><div className="note-document-heading"><input aria-label={t('Note title', 'Judul catatan')} value={draft.name} maxLength={200} onChange={event => update(draft.text, event.target.value)} /><span>v{detail.note.revision}</span></div>
    <div className="note-actions"><button type="button" disabled={busy} onClick={() => void save()}><Save size={16} />{t('Save', 'Simpan')}</button><button type="button" disabled={busy} onClick={() => void attach()}>{dirty ? t('Save and attach to AI', 'Simpan dan lampirkan ke AI') : t('Attach to AI', 'Lampirkan ke AI')}</button><button type="button" onClick={() => setPreview(value => !value)} aria-pressed={preview}>{preview ? t('Source', 'Sumber') : t('Preview', 'Pratinjau')}</button><button type="button" onClick={exportNote}><Download size={15} />.md</button><button type="button" onClick={() => void notesRequest<{ revisions: NoteRevision[] }>(projectId, `${noteId}/history`).then(data => setHistory(data.revisions)).catch(failure => setError(failure.message))}>{t('History', 'Riwayat')}</button><button type="button" onClick={() => void notesRequest<{ proposals: NoteProposal[] }>(projectId, `${noteId}/proposals`).then(data => setProposals(data.proposals)).catch(failure => setError(failure.message))}>{t('Refresh AI proposals', 'Muat ulang proposal AI')}</button></div>
    <p className="note-status" role="status">{draftStatus} · {dirty ? t('Uncommitted changes', 'Perubahan belum dijadikan revisi') : t('Immutable revision saved', 'Revisi immutable tersimpan')}</p>
    {(error || status.browserError || status.coreError) && <div className="note-error" role="alert"><p>{error || status.browserError || status.coreError}</p><button type="button" onClick={() => void notesRequest<NoteDetail>(projectId, noteId).then(data => setCompare(data.revision)).catch(failure => setError(failure.message))}>{t('Compare latest', 'Bandingkan revisi terbaru')}</button><button type="button" disabled={busy} onClick={() => void saveCopy()}>{t('Save copy', 'Simpan salinan')}</button><button type="button" onClick={() => { saver.current?.update(current.current!); }}>{t('Retry draft save', 'Coba simpan draft lagi')}</button></div>}
    {compare && <section className="note-comparison"><h3>{t('Compare with saved revision', 'Bandingkan dengan revisi tersimpan')} v{compare.revision}</h3><pre>{compare.text}</pre><p>{t('Opening this revision keeps the previous editor draft in browser recovery and app history.', 'Membuka revisi ini tetap menyimpan draft editor sebelumnya di recovery browser dan riwayat aplikasi.')}</p><button type="button" onClick={() => { const copy = current.current; if (!copy) return; void notesRequest<NoteDetail>(projectId, '', { requestId: crypto.randomUUID(), name: copy.name.slice(0, 180) + ' recovered draft', text: copy.text }).then(() => notesRequest<NoteDetail>(projectId, noteId)).then(data => { install(data, true); setCompare(undefined); setError(''); }).catch(failure => setError(failure.message)); }}>{t('Keep draft as copy and open latest', 'Simpan draft sebagai salinan dan buka terbaru')}</button><button type="button" onClick={() => setCompare(undefined)}>{t('Close comparison', 'Tutup perbandingan')}</button></section>}
    {!!history.length && <details open className="note-history"><summary>{t('Revisions', 'Revisi')}</summary>{history.map(r => <button type="button" key={r.id} onClick={() => void notesRequest<{ revision: NoteRevision }>(projectId, `${noteId}/history/${r.id}`).then(data => setCompare(data.revision)).catch(failure => setError(failure.message))}>v{r.revision} · {r.createdAt} · {r.author?.kind}</button>)}</details>}
    <div hidden={preview}><AiArtifactTextEditor key={epoch} initialValue={draft.text} format="markdown" searchable ariaLabel={t('Note source editor', 'Editor sumber catatan')} disabled={busy} onChange={update} onSave={() => void save()} onSelectionChange={range => { selection.current = range; }} /></div>
    {preview && <div className="note-preview"><AiResponseContent text={draft.text} /></div>}
    {proposals.map(p => <section className="note-proposal" key={p.id}><h3>{t('AI proposal', 'Usulan AI')} · {p.status === 'open' && p.expectedHead !== detail.note.head ? t('Stale', 'Kedaluwarsa') : p.status}</h3>{p.hunks.map(h => <div key={h.id}><p>{h.reason}</p><pre className="note-before">{h.before}</pre><pre className="note-after">{h.after}</pre><span>{h.decision}</span>{h.decision === 'pending' && <><button type="button" disabled={busy || dirty || p.status !== 'open' || p.expectedHead !== detail.note.head} onClick={() => void decide(p, h, 'accepted')}>{t('Accept hunk', 'Terima bagian')}</button><button type="button" disabled={busy} onClick={() => void decide(p, h, 'rejected')}>{t('Reject', 'Tolak')}</button></>}</div>)}</section>)}
  </article>;
}
