'use client';

import '@/app/lab-ui.css';
import '@/app/navigation-ui.css';
import '@/app/workspace-utilities.css';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, BookOpen, ChevronUp, Settings, CreditCard, HardDrive, LogOut, SlidersHorizontal, Tags } from 'lucide-react';
import { useResearchShell } from './ResearchShellContext';
import { hasUserProfile, signOut, type PhyniteSession } from '@/app/auth-client';
import { confirmUnsavedSettings } from '@/app/use-unsaved-settings';
import { useAccountSettings } from '@/app/use-account-settings';
import { useLocale } from '@/app/locale-provider';
import { useInboxUnread } from '@/app/use-inbox-unread';

export function ProfileAvatar({ photo, name, large = false }: { photo?: string; name: string; large?: boolean }) {
  return <span className={`lab-avatar${large ? ' lab-avatar-large' : ''}`}>{photo
    // Profile photos are validated, resized data URLs; no remote image request is needed.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={photo} alt="" /> : name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</span>;
}

export function AccountMenu({ session, variant = 'header', onNavigate }: { session: PhyniteSession; variant?: 'header' | 'sidebar' | 'rail' | 'mobile'; onNavigate?: () => void }) {
  const shell = useResearchShell();
  const { settings } = useAccountSettings(session.user.email, session.user.id);
  const { t } = useLocale();
  const local = session.mode === 'local';
  const cloudConnected = session.cloud?.authenticated === true;
  const [open, setOpen] = useState(false);
  const standaloneUnread = useInboxUnread(!local && !shell && !session.user.isDeveloper ? session.user.id : undefined);
  const hasUnread = shell ? Boolean(shell.inboxUnread) : standaloneUnread;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const focusMenu = useRef(false);
  const menuGroups = [
    [{ id: 'inbox', href: '/inbox', en: 'Inbox', idn: 'Kotak masuk', Icon: Bell }, { id: 'account', href: '/account', en: 'Settings', idn: 'Pengaturan', Icon: SlidersHorizontal }, { id: 'usage', href: '/account/usage', en: 'Usage', idn: 'Pemakaian', Icon: HardDrive }, { id: 'billing', href: '/billing', en: 'Billing', idn: 'Tagihan', Icon: CreditCard }],
    [{ id: 'pricing', href: '/pricing', en: 'Pricing', idn: 'Harga', Icon: Tags }, { id: 'guide', href: '/guide#account', en: 'Help', idn: 'Bantuan', Icon: BookOpen }],
  ] as const;
  const localMenu = [
    { href: '/account/appearance', en: 'Settings', idn: 'Pengaturan', Icon: SlidersHorizontal },
    { href: '/account/usage', en: 'Usage', idn: 'Pemakaian', Icon: HardDrive },
    { href: '/guide#account', en: 'Help', idn: 'Bantuan', Icon: BookOpen },
  ];

  useEffect(() => {
    if (!open) return;
    if (focusMenu.current) container.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    focusMenu.current = false;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = () => { setOpen(false); onNavigate?.(); };
  const localConnections = <div className={`lab-local-connection-actions${variant === 'rail' ? ' lab-local-connection-actions--rail' : ''}`} data-account-variant={variant} aria-label={t('Workspace settings', 'Pengaturan workspace')}>
    <Link href="/account/appearance" aria-label={t('Settings', 'Pengaturan')} title={t('Settings', 'Pengaturan')} onClick={onNavigate}><Settings size={16} aria-hidden="true" /><span className="lab-local-action-label">{t('Settings', 'Pengaturan')}</span></Link>
  </div>;
  if (shell && variant === 'header') return local && !hasUserProfile(session) ? localConnections : null;
  // Local workspaces always expose device settings, including without a
  // Cloud profile. Cloud connections remain available inside Settings.
  if (!hasUserProfile(session)) return local ? localConnections : null;
  return <div className={`lab-account-menu${variant === 'sidebar' ? ' lab-account-menu--sidebar' : variant === 'rail' ? ' lab-account-menu--rail' : variant === 'mobile' ? ' lab-account-menu--mobile' : ''}`} ref={container} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); toggle.current?.focus(); return; }
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) focusMenu.current = true;
      if (event.key === 'ArrowDown' || ((variant === 'sidebar' || variant === 'rail') && event.key === 'ArrowUp')) { event.preventDefault(); setOpen(true); }
      return;
    }
    const items = Array.from(container.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }}>
    <button ref={toggle} className="lab-account-toggle" type="button" aria-label={t('Account menu', 'Menu akun')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <ProfileAvatar photo={settings.avatarDataUrl} name={settings.displayName} />
      {hasUnread && <span className="lab-account-unread-dot" aria-label={t('Unread messages', 'Pesan belum dibaca')} />}
      {variant === 'sidebar' && <><span className="lab-account-sidebar-copy"><strong>{settings.displayName}</strong></span><ChevronUp className="lab-account-sidebar-chevron" size={14} aria-hidden="true" /></>}
    </button>
    {open && (
      <div className="lab-account-popover" role="menu" aria-label={t('Account settings', 'Pengaturan akun')}>
        <a className="lab-account-identity" role="menuitem" href="/profile" onClick={event => {
          if (shell && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); shell.navigate('profile', '/profile'); }
          close();
        }}>
          <div className="lab-account-identity-text">
            <strong>{local ? t('Local workspace', 'Workspace lokal') : settings.displayName}</strong>
            <span>{local ? cloudConnected ? session.cloud?.account || t('Phynite Cloud connected', 'Phynite Cloud terhubung') : t('Local only · no cloud account', 'Lokal saja · tanpa akun cloud') : session.user.email}</span>
          </div>
        </a>
        {local && <div className="lab-account-menu-group" role="group">{localMenu.map(item => <a key={item.href} role="menuitem" href={item.href} onClick={close}><item.Icon size={16} /><span>{t(item.en, item.idn)}</span></a>)}</div>}
        {!local && !session.user.isDeveloper && menuGroups.map((items, index) => <div className="lab-account-menu-group" role="group" key={index}>{items.map(item => <a role="menuitem" href={item.href} key={item.id} onClick={event => {
          if (shell && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); shell.navigate(item.id === 'inbox' ? 'inbox' : item.id === 'guide' || item.id === 'pricing' ? 'home' : item.id === 'billing' ? 'billing' : 'account', item.href); }
          close();
        }}><item.Icon size={16} /><span>{t(item.en, item.idn)}</span>{item.id === 'inbox' && hasUnread && <span className="lab-account-inbox-dot" aria-label={t('Unread messages', 'Pesan belum dibaca')} />}</a>)}</div>)}
        <div className="lab-account-logout">
          {local ? cloudConnected ? <button role="menuitem" aria-disabled={busy} onClick={async () => {
            if (busy || !confirmUnsavedSettings()) return;
            setBusy(true);
            setError('');
            try {
              await signOut({ mode: 'local' });
              setOpen(false);
              onNavigate?.();
            } catch {
              setError(t('Could not disconnect Phynite Cloud. Try again.', 'Phynite Cloud belum dapat diputus. Coba lagi.'));
            } finally {
              setBusy(false);
            }
          }}><LogOut size={16} />{busy ? t('Disconnecting cloud…', 'Memutus cloud…') : t('Sign out of Phynite Cloud', 'Keluar dari Phynite Cloud')}</button> : <Link role="menuitem" href="/account/account#cloud" onClick={close}><SlidersHorizontal size={16} /><span>{t('Connect Phynite Cloud', 'Hubungkan Phynite Cloud')}</span></Link> : <button role="menuitem" aria-disabled={busy} onClick={async () => {
            // Keep focus in the menu so a failed request leaves its error visible.
            if (busy || !confirmUnsavedSettings()) return;
            setBusy(true);
            setError('');
            try {
              await signOut();
              window.location.assign('/login');
            } catch {
              setError(t('Could not log out. Try again.', 'Belum dapat keluar. Coba lagi.'));
              setBusy(false);
            }
          }}><LogOut size={16} />{busy ? t('Logging out...', 'Keluar...') : t('Log out', 'Keluar')}</button>}
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    )}
  </div>;
}
