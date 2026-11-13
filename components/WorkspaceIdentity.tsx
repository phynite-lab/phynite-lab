'use client';

import { Cloud, CloudCheck, CloudOff, CloudUpload, HardDrive, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { BrandLockup } from './BrandLockup';
import { useResearchShell } from './ResearchShellContext';

export type WorkspaceSaveState = 'idle' | 'saving' | 'synced' | 'local' | 'pending' | 'conflict' | 'error';

export function WorkspaceIdentity({ state, label, detail, hideSave = false }: { state: WorkspaceSaveState; label: string; detail?: string; hideSave?: boolean }) {
  const shell = useResearchShell();
  const { locale, t } = useLocale();
  const labels: Record<string, string> = { 'Saved to cloud': 'Tersimpan di cloud', 'Saving...': 'Menyimpan...', 'Saved on device': 'Tersimpan di perangkat', 'Not saved': 'Belum tersimpan', 'Checking cloud...': 'Memeriksa cloud...', 'Cloud ready': 'Cloud siap', 'Cloud unavailable': 'Cloud tidak tersedia', 'Cloud project': 'Project cloud', 'Sync conflict': 'Konflik sinkronisasi', 'Save failed': 'Penyimpanan gagal', 'Autosave': 'Simpan otomatis', 'Saved on device · Offline': 'Tersimpan di perangkat · Offline', 'Saved on device · Sync pending': 'Tersimpan di perangkat · Menunggu sinkronisasi' };
  const displayLabel = locale === 'id' ? labels[label] ?? label : label;
  const Icon = state === 'saving' ? LoaderCircle : state === 'synced' ? CloudCheck : state === 'pending' ? CloudUpload : state === 'conflict' ? TriangleAlert : state === 'error' ? CloudOff : state === 'local' ? HardDrive : Cloud;
  return <div className="workspace-identity">
    {!shell && <a href="/workspace" aria-label={t('Back to Phynite workspace', 'Kembali ke Workspace Phynite')}><BrandLockup /></a>}
    {!hideSave && <span role="status" aria-live="polite" aria-label={detail ?? displayLabel} title={detail ?? displayLabel} data-status={state} className="workspace-save-indicator">
      <Icon size={16} aria-hidden="true" className={state === 'saving' ? 'workspace-saving-icon' : undefined} />
    </span>}
  </div>;
}
