/* eslint-disable @next/next/no-html-link-for-pages -- Vinext uses full document navigation on Cloudflare. */
'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { useSession } from './use-session';
import { RegionMenu, useLocale } from './locale-provider';
import { BrandLockup } from '@/components/BrandLockup';
import { guidePath } from '@/lib/guide-routing';

const AccountMenu = dynamic(() => import('@/components/AccountMenu').then(module => module.AccountMenu), { ssr: false });

export function Navbar({ refined = false, heroOverlay = false }: { refined?: boolean; heroOverlay?: boolean }) {
  const { session } = useSession();
  const { locale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!heroOverlay) return;
    const update = () => setScrolled(window.scrollY > 24);
    queueMicrotask(update);
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [heroOverlay]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 960) {
        setOpen(false);
      }
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!open) return;
    header.current?.querySelector<HTMLElement>('nav a')?.focus();
    const outside = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  return (
    <header
      ref={header}
      className={`studio-public-header${refined ? " public-navigation-header" : ""}`}
      data-hero-overlay={heroOverlay || undefined}
      data-scrolled={heroOverlay ? scrolled : undefined}
      data-menu-open={open}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <a className="orca-nav-brand" href="/" aria-label={t('phynite-lab home', 'Beranda phynite-lab')}>
        <BrandLockup />
      </a>

      <nav
        id="public-navigation"
        className="orca-nav-links"
        data-open={open}
        onClick={() => setOpen(false)}
        aria-label={t('Main navigation', 'Navigasi utama')}
      >
        <a href={guidePath(locale)}>{t('Documentation', 'Dokumentasi')}</a>
        <a href="/pricing">{t('Pricing', 'Harga')}</a>
        <a href="/about">{t('About', 'Tentang')}</a>
        <a href="/#questions">Q&A</a>
      </nav>

      <div className="orca-nav-actions">
        {refined && <div className="public-preferences"><RegionMenu /></div>}
        {/* Discord */}
        <a
          className="orca-social-link orca-discord-link"
          href="https://discord.gg/y54vBNxarA"
          target="_blank"
          rel="noreferrer"
          aria-label={t('Discord community', 'Komunitas Discord')}
          title="Discord"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
          </svg>
        </a>

        {/* X (Twitter) */}
        <a
          className="orca-social-link"
          href="https://x.com/phynite"
          target="_blank"
          rel="noreferrer"
          aria-label="X profile"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>

        {session ? (
          <AccountMenu session={session} />
        ) : null}

        <a className="orca-btn-primary" href={session ? '/workspace' : '/waitlist'}>
          <span>{session ? 'Workspace' : t('Join waitlist', 'Gabung waitlist')}</span>
          <ArrowUpRight size={14} />
        </a>

        <button
          ref={toggle}
          className="studio-mobile-menu"
          aria-label={t('Navigation menu', 'Menu navigasi')}
          aria-expanded={open}
          aria-controls="public-navigation"
          onClick={() => setOpen(value => !value)}
        >
          {open ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>
    </header>
  );
}
