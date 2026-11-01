/* eslint-disable @next/next/no-html-link-for-pages -- Vinext uses full document navigation on Cloudflare. */
'use client';

import { LanguageControl, useLocale } from './locale-provider';
import { BrandLockup } from '@/components/BrandLockup';
import { useSession } from './use-session';
import { usePathname } from 'next/navigation';
import { supportEmail, supportHref } from '@/lib/support';
import { ANALYTICS_PREFERENCES_EVENT } from '@/lib/analytics-client';
import { guidePath, guideRoute } from '@/lib/guide-routing';

export function Footer({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useLocale();
  const pathname = usePathname();
  const refined = Boolean(guideRoute(pathname)) || ['/', '/about', '/waitlist', '/login', '/register', '/pricing', '/contact', '/privacy', '/terms'].includes(pathname ?? '');
  const { session } = useSession();
  const groups = refined ? [
    { title: t('Product', 'Produk'), links: [['DFT Lab', guidePath(locale, 'quickstart-silicon')], ['MD Lab', guidePath(locale, 'quickstart-md')], ['Figure Lab', guidePath(locale, 'figures')], [t('Pricing', 'Harga'), '/pricing']] },
    { title: t('Resources', 'Sumber belajar'), links: [[t('Documentation', 'Dokumentasi'), guidePath(locale)], [t('Personal compute', 'Komputasi pribadi'), guidePath(locale, 'local-compute')]] },
    { title: 'Phynite', links: [[t('About & founders', 'Tentang & founder'), '/about'], [t('Join waitlist', 'Gabung waitlist'), '/waitlist'], [t('Contact', 'Kontak'), '/contact'], [supportEmail, supportHref], [t('GitHub organization', 'Organisasi GitHub'), 'https://github.com/phynite-lab'], [t('Privacy', 'Privasi'), '/privacy'], [t('Terms', 'Ketentuan'), '/terms']] },
  ] : [
    { title: t('Research', 'Riset'), links: [['Workspace', session ? '/workspace' : '/waitlist'], ['DFT Lab', session ? '/calculation' : '/waitlist'], ['MD Lab', session ? '/md' : '/waitlist'], ['Figure Lab', session ? '/calculation?view=figures' : '/waitlist']] },
    { title: t('Resources', 'Sumber belajar'), links: [[t('Documentation', 'Dokumentasi'), guidePath(locale)], [t('First calculation', 'Kalkulasi pertama'), guidePath(locale, 'quickstart-silicon')], [t('Keyboard shortcuts', 'Pintasan keyboard'), guidePath(locale, 'shortcuts')]] },
    { title: t('Account', 'Akun'), links: [[t('Plans', 'Paket'), '/pricing'], [t('Billing & usage', 'Tagihan & pemakaian'), '/billing'], [t('Personal compute', 'Komputasi pribadi'), guidePath(locale, 'local-compute')]] },
    { title: 'Phynite', links: [[t('Join waitlist', 'Gabung waitlist'), '/waitlist'], [t('Contact', 'Kontak'), '/contact'], [supportEmail, supportHref], [t('Privacy', 'Privasi'), '/privacy'], [t('Terms', 'Ketentuan'), '/terms'], [t('Availability', 'Ketersediaan'), guidePath(locale, 'roadmap')], [t('GitHub organization', 'Organisasi GitHub'), 'https://github.com/phynite-lab']] },
  ];
  return <footer className={`site-footer${refined ? " public-design-footer" : ""}${compact || refined ? ' site-footer-compact' : ''}`}><div className="footer-inner"><div className="footer-primary"><div className="footer-brand"><a className="footer-wordmark-small" href="/" aria-label={t('Phynite home', 'Beranda Phynite')}><BrandLockup /></a><p>{t('Materials research, from atom to figure.', 'Riset material, dari atom hingga figur.')}</p>{!compact && <div className="footer-actions"><a className="footer-action footer-action-primary" href="/waitlist">{t('Join waitlist', 'Gabung waitlist')}</a></div>}</div><nav className="footer-links" aria-label={t('Footer navigation', 'Navigasi footer')}>{groups.map(group => <div className="footer-link-group" key={group.title}><p>{group.title}</p>{group.links.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</div>)}</nav></div><div className="footer-meta"><p>© 2026 Phynite Lab.</p><div className="footer-preferences"><button type="button" className="footer-cookie-preferences" onClick={() => window.dispatchEvent(new Event(ANALYTICS_PREFERENCES_EVENT))}>{t('Cookies & privacy', 'Cookie & privasi')}</button><LanguageControl /></div></div>{!compact && !refined && <div className="footer-wordmark-stage" aria-hidden="true"><p className="footer-wordmark-large">phynite-lab</p></div>}</div></footer>;
}
