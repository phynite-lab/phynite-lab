'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { legacyAccountDestination } from '../account-navigation';
import { useLocale } from '../locale-provider';

export function AccountLegacyRedirect({ section }: { section: 'computer' | 'preferences' }) {
  const { t } = useLocale();
  const destination = legacyAccountDestination(section)!;
  useEffect(() => {
    const target = legacyAccountDestination(section, window.location.hash)!;
    window.location.replace(`${target.pathname}${window.location.search}${target.hash}`);
  }, [section]);
  return <main className="workspace-loading"><Link href={`${destination.pathname}${destination.hash}`}>{t('Opening settings…', 'Membuka pengaturan…')}</Link></main>;
}
