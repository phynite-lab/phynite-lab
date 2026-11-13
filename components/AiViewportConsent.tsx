'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, LoaderCircle } from 'lucide-react';
import { activeViewports, viewportChecksum } from '@/lib/ai-viewport';
import type { AiContextRef } from '@/lib/ai-workbench';
import { useLocale } from '@/app/locale-provider';

async function request<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  const reply = await fetch(`/api/ai/conversations/${path}`, { signal, cache: 'no-store', ...(payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
  const data = await reply.json() as T & { error?: string }; if (!reply.ok) throw new Error(data.error ?? 'Capture request failed.'); return data;
}
type Permission = { enabled: boolean; revision: number };
export function AiViewportConsent({ owner, conversationId, visible, ensureConversation, onStatusChange }: { onStatusChange?: (enabled: boolean) => void; owner: string; conversationId?: string; visible: boolean; ensureConversation: () => Promise<{ id: string }> }) {
  const { t } = useLocale();
  const [permission, setPermission] = useState<Permission>({ enabled: false, revision: 0 }), [busy, setBusy] = useState(false), [capturing, setCapturing] = useState(false), [error, setError] = useState('');
  useEffect(() => { onStatusChange?.(permission.enabled); }, [permission.enabled, onStatusChange]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { if (!conversationId) return; const abort = new AbortController(); void request<Permission>(`${conversationId}/viewport`, undefined, abort.signal).then(setPermission).catch(() => {}); return () => abort.abort(); }, [conversationId]);
  useEffect(() => {
    if (!conversationId || !permission.enabled || !visible) return;
    const abort = new AbortController(); controller.current = abort;
    let active = false;
    const poll = async () => {
      if (active || abort.signal.aborted) return; active = true;
      try {
        const latest = await request<Permission>(`${conversationId}/viewport`, undefined, abort.signal);
        if (!latest.enabled || latest.revision !== permission.revision) { setPermission(latest); abort.abort(); return; }
        const { captures } = await request<{ captures: Array<{ id: string; projectKey: string; source: { ref: AiContextRef }; status: string }> }>(`${conversationId}/captures`, undefined, abort.signal);
        for (const capture of captures.filter(c => c.status === 'pending')) {
          setCapturing(true);
          try {
            const snapshot = await activeViewports.capture(owner, capture.projectKey, capture.source.ref, abort.signal);
            const sha256 = await viewportChecksum(snapshot.blob); abort.signal.throwIfAborted();
            const { attachment } = await request<{ attachment: { id: string } }>(`${conversationId}/attachments`, { filename: `viewport-${capture.id}.png`, sizeBytes: snapshot.blob.size, sha256 }, abort.signal);
            const upload = await fetch(`/api/ai/conversations/${conversationId}/attachments/${attachment.id}/content`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: snapshot.blob, signal: abort.signal });
            if (!upload.ok) throw new Error('The viewport image upload failed.');
            await request(`${conversationId}/captures/${capture.id}`, { attachmentId: attachment.id, metadata: snapshot.metadata }, abort.signal);
          } catch (failure) {
            if (!abort.signal.aborted) await request(`${conversationId}/captures/${capture.id}`, { error: failure instanceof Error ? failure.message : 'Viewport capture failed.' }, abort.signal).catch(() => {});
          } finally { if (!abort.signal.aborted) setCapturing(false); }
        }
      } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : 'Viewport capture failed.'); }
      finally { active = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 500);
    return () => { abort.abort(); clearInterval(timer); controller.current = null; };
  }, [conversationId, permission.enabled, permission.revision, visible, owner]);
  const label = capturing ? t('Capturing viewport…', 'Mengambil gambar viewport…') : permission.enabled ? t('Capture allowed', 'Capture diizinkan') : t('Allow capture', 'Izinkan capture');
  return <button type="button" className="ai-task-chip ai-toolbar-toggle" aria-label={error ? `${label}: ${error}` : label} aria-pressed={permission.enabled} aria-live="polite" data-capturing={capturing} disabled={busy} title={error || `${label} · ${t('Allow visible scientific viewport images in this conversation. Revoking cancels pending captures; images already delivered remain in the conversation.', 'Izinkan gambar viewport ilmiah yang terlihat pada percakapan ini. Pencabutan membatalkan capture tertunda; gambar yang sudah dikirim tetap ada.')}`} onClick={() => {
    if (permission.enabled) { controller.current?.abort(); setCapturing(false); }
    setBusy(true); setError('');
    void ensureConversation().then(async c => {
      const latest = await request<Permission>(`${c.id}/viewport`);
      setPermission(await request<Permission>(`${c.id}/viewport`, { enabled: !permission.enabled, revision: latest.revision }));
    }).catch(failure => setError(failure.message)).finally(() => setBusy(false));
  }}>{busy || capturing ? <LoaderCircle size={17} aria-hidden="true" /> : permission.enabled ? <Camera size={17} aria-hidden="true" /> : <CameraOff size={17} aria-hidden="true" />}<span>{label}</span></button>;
}
