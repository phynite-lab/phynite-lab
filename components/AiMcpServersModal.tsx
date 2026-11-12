'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import type { AiMcpTool } from '@/lib/ai-mcp';

type Server = { id: string; label: string; transport: string; enabled: boolean; status: string; toolCount: number; code?: string };
type Catalogue = { servers: Server[]; tools: AiMcpTool[] };
export function AiMcpServersModal({ request, onClose }: { request: <T>(path: string, payload?: Record<string, unknown>, method?: string) => Promise<T>; onClose: () => void }) {
  const { t } = useLocale(), dialog = useRef<HTMLDialogElement>(null);
  const [catalogue, setCatalogue] = useState<Catalogue>({ servers: [], tools: [] });
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const refresh = useCallback(async (payload?: Record<string, unknown>) => {
    setBusy(true); setError('');
    try { setCatalogue(await request<Catalogue>('mcp/servers', payload, payload ? 'POST' : 'GET')); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Local connections unavailable.'); }
    finally { setBusy(false); }
  }, [request]);
  useEffect(() => { const focus = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { if (focus?.isConnected) focus.focus(); }; }, []);
  useEffect(() => { let live = true; void request<Catalogue>('mcp/servers').then(data => { if (live) setCatalogue(data); }).catch(failure => { if (live) setError(failure instanceof Error ? failure.message : 'Local connections unavailable.'); }).finally(() => { if (live) setBusy(false); }); return () => { live = false; }; }, [request]);
  return <dialog ref={dialog} className="ai-skill-modal" aria-labelledby="ai-mcp-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2 id="ai-mcp-title">{t('Local MCP connections', 'Koneksi MCP lokal')}</h2><p>{t('Connect tools you trust on this computer.', 'Hubungkan tool yang Anda percaya di komputer ini.')}</p></div><button type="button" onClick={onClose} aria-label={t('Close connections', 'Tutup koneksi')}><X size={19}/></button></header>
    <div className="ai-mcp-content">
      <p>{t('Configured programs can access local files and the network. Enable only servers you trust. Chat and research expose tools declared read-only; changes follow the conversation’s approval setting.', 'Program terkonfigurasi dapat mengakses file lokal dan jaringan. Aktifkan hanya server yang Anda percaya. Chat dan riset menampilkan tool yang dinyatakan hanya-baca; perubahan mengikuti pengaturan persetujuan percakapan.')}</p>
      <button type="button" className="ai-button ai-button-secondary" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14}/>{t('Refresh connections', 'Segarkan koneksi')}</button>
      {busy && <p role="status">{t('Checking local servers…', 'Memeriksa server lokal…')}</p>}
      {!busy && !catalogue.servers.length && <p>{t('No local servers configured. Add a private mcp/servers.json file in your Phynite data directory (default ~/.phynite-lab), then refresh. Registration and credentials stay on disk.', 'Belum ada server lokal terkonfigurasi. Tambahkan file privat mcp/servers.json di direktori data Phynite (bawaan ~/.phynite-lab), lalu segarkan. Pendaftaran dan kredensial tersimpan di disk.')}</p>}
      {catalogue.servers.map(server => <section key={server.id} className="ai-mcp-server">
        <label><input type="checkbox" checked={server.enabled} disabled={busy} onChange={event => void refresh({ serverId: server.id, enabled: event.target.checked })}/><strong>{server.label}</strong></label>
        <p>{server.transport} · {server.status === 'ready' ? t(`${server.toolCount} tools available`, `${server.toolCount} tool tersedia`) : server.status === 'disabled' ? t('Disabled', 'Nonaktif') : t('Unavailable — check local configuration', 'Tidak tersedia — periksa konfigurasi lokal')}{server.code && <code> · {server.code}</code>}</p>
        {!!catalogue.tools.filter(tool => tool.serverId === server.id).length && <ul>{catalogue.tools.filter(tool => tool.serverId === server.id).map(tool => <li key={tool.name}><code>{tool.name}</code><span>{tool.readOnly ? t('Read only', 'Hanya baca') : t('Uses action permissions', 'Memakai izin aksi')}</span></li>)}</ul>}
      </section>)}
      {error && <p role="alert">{error}</p>}
    </div>
  </dialog>;
}
