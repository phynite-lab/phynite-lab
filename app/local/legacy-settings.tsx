'use client';
import { useEffect } from 'react';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';
import { useLocale } from '../locale-provider';
export function LegacyLocalSettings() {
  const { t } = useLocale();
  useEffect(() => {
    const hash = window.location.hash;
    const target = hash === '#ai' ? '/account/ai-providers' : hash === '#cloud' ? '/account/account#cloud' : hash === '#storage' ? '/account/storage#storage' : hash === '#pseudopotentials' ? '/account/compute#pseudopotentials' : hash === '#runtime' ? '/account/compute#your-computer' : '/account/compute';
    window.location.replace(target);
  }, []);
  return <WorkspaceLoading layout="page" label={t('Opening settings…', 'Membuka pengaturan…')} />;
}
