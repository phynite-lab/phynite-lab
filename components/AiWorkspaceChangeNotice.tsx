'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/app/locale-provider';
import { CALCULATION_WORKSPACE_STORAGE_KEY, getCalculationWorkspaceSnapshot, replaceCalculationWorkspaceSnapshot, type StoredWorkspaceSnapshot } from '@/lib/workspace-storage';

/** A separate AI tab cannot replace an editor's unsaved research. Recovery is explicit and keeps a copy. */
export function AiWorkspaceChangeNotice({ owner, visible }: { owner: string; visible: boolean }) {
  const { t } = useLocale();
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const storage = (event: StorageEvent) => { if (event.key === `phynite:ai-project-change:${owner}`) setChanged(true); };
    const conflict = () => setChanged(true);
    window.addEventListener('storage', storage); window.addEventListener('phynite:workspace-revision-conflict', conflict);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener('phynite:workspace-revision-conflict', conflict); };
  }, [owner]);
  if (!changed || !visible) return null;
  const reload = async () => {
    setBusy(true); setError('');
    try {
      const result = await fetch('/api/phynite/v1/workspace', { cache: 'no-store' });
      if (!result.ok) throw new Error(t('Saved workspace could not be loaded.', 'Workspace tersimpan belum dapat dimuat.'));
      const remote = await result.json() as { workspace: StoredWorkspaceSnapshot | null };
      const local = getCalculationWorkspaceSnapshot();
      if (local) {
        const blob = new Blob([local], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = `phynite-local-workspace-${Date.now()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
        // Keep a durable device copy even when the browser requires another click for a download.
        localStorage.setItem(`phynite:workspace-conflict-backup:${owner}:${Date.now()}`, local);
      }
      if (remote.workspace) replaceCalculationWorkspaceSnapshot(remote.workspace);
      else localStorage.removeItem(CALCULATION_WORKSPACE_STORAGE_KEY);
      window.location.reload();
    } catch (failure) { setError((failure as Error).message); setBusy(false); }
  };
  return <div className="research-navigation-error" role="status"><span>{t('Saved research changed in another tab. Your current local work has been kept.', 'Riset tersimpan berubah di tab lain. Pekerjaan lokal Anda tetap disimpan.')}{error && <span role="alert"> {error}</span>}</span><button disabled={busy} onClick={() => void reload()}>{t('Keep a local copy & load saved workspace', 'Simpan salinan lokal & muat workspace tersimpan')}</button></div>;
}
