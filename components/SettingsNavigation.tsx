'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Bell, Cpu, CreditCard, HardDrive, Search, ShieldCheck, SlidersHorizontal, UserRound, Gauge, Sparkles, X } from 'lucide-react';
import { searchSettingsSections, searchSettingsControls } from '@/app/account-navigation';
import { useLocale } from '@/app/locale-provider';
import { useResearchShell } from './ResearchShellContext';
import { useSession } from '@/app/use-session';
import { hasUserProfile } from '@/app/auth-client';
import '@/app/account/settings.css';

const icons = { profile: UserRound, appearance: SlidersHorizontal, notifications: Bell, compute: Cpu, 'ai-providers': Sparkles, usage: Gauge, storage: HardDrive, billing: CreditCard, privacy: ShieldCheck };
const groups = [{ id: 'ai', en: 'AI providers', idn: 'Provider AI' }, { id: 'research', en: 'Research', idn: 'Riset' }, { id: 'device', en: 'This device', idn: 'Perangkat ini' }, { id: 'personal', en: 'Your profile', idn: 'Profil Anda' }, { id: 'account', en: 'Account & billing', idn: 'Akun & tagihan' }] as const;

export function SettingsNavigation({ onNavigate, className = '' }: { onNavigate?: () => void; className?: string }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const shell = useResearchShell();
  const { session } = useSession();
  const hideProfile = session?.mode === 'local' && !hasUserProfile(session);
  const [query, setQuery] = useState('');
  const sections = searchSettingsSections(query).filter(section => (!hideProfile || section.id !== 'profile') && (session?.mode === 'local' || section.id !== 'ai-providers'));
  const controls = searchSettingsControls(query).filter(control => (!hideProfile || control.section !== 'profile') && (session?.mode === 'local' || control.section !== 'ai-providers'));
  const visit = (event: React.MouseEvent<HTMLAnchorElement>, href: string, billing: boolean) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = new URL(href, window.location.href);
    if (url.pathname === window.location.pathname && url.search === window.location.search) {
      event.preventDefault(); window.history.pushState(window.history.state, '', href); shell?.closeMobileNavigation();
      window.dispatchEvent(new Event('phynite:settings-anchor'));
    } else if (shell) { event.preventDefault(); shell.navigate(billing ? 'billing' : 'account', href); }
    onNavigate?.();
  };
  return <nav className={`settings-navigation ${className}`} aria-label={t('Settings sections', 'Bagian pengaturan')}>
    <Link className="settings-back" href="/workspace" onClick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (shell) { event.preventDefault(); shell.navigate('home', '/workspace'); }
      onNavigate?.();
    }}><ArrowLeft size={16} />{t('Back to workspace', 'Kembali ke workspace')}</Link>
    <h2>{t('Settings', 'Pengaturan')}</h2>
    <label className="settings-search"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search settings', 'Cari pengaturan')} aria-label={t('Search settings', 'Cari pengaturan')} />{query && <button type="button" onClick={() => setQuery('')} aria-label={t('Clear settings search', 'Kosongkan pencarian pengaturan')}><X size={14} /></button>}</label>
    <div className="settings-navigation-scroll">{groups.map(group => {
      const items = sections.filter(section => section.group === group.id);
      return items.length > 0 && <section className="settings-nav-group" key={group.id} aria-labelledby={`settings-group-${group.id}`}><h3 id={`settings-group-${group.id}`}>{t(group.en, group.idn)}</h3>{group.id === 'device' && session?.mode === 'local' && !query.trim() && <Link className="settings-runtime-link" href="/local" onClick={onNavigate} aria-current={pathname === '/local' ? 'page' : undefined}><Cpu size={17} />{t('Local runtime & cloud', 'Runtime lokal & cloud')}</Link>}{items.map(item => {
        const Icon = icons[item.id];
        return <Link key={item.id} href={item.href} aria-current={pathname === item.href || item.id === 'billing' && pathname.startsWith('/billing/') ? 'page' : undefined} onClick={event => visit(event, item.href, item.id === 'billing')}><Icon size={17} /><span>{t(item.en, item.idn)}</span></Link>;
      })}</section>;
    })}
    {controls.length > 0 && <section className="settings-nav-group settings-search-results" aria-label={t('Matching settings', 'Pengaturan yang cocok')}><h3>{t('Settings', 'Pengaturan')}</h3>{controls.map(item => <Link key={item.href} href={item.href} onClick={event => visit(event, item.href, item.section === 'billing')}><Search size={15} /><span>{t(item.en, item.idn)}</span></Link>)}</section>}
    {sections.length === 0 && controls.length === 0 && <p className="settings-search-empty" role="status">{t('No matching settings. Try “compute”, “storage”, or “email”.', 'Pengaturan tidak ditemukan. Coba “komputasi”, “penyimpanan”, atau “email”.')}</p>}</div>
  </nav>;
}
